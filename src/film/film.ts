/**
 * The film: the page scroll is the playhead. Every scene is a layer in one fixed
 * screen; the scroll position picks the scene and how far into it we are.
 * No easing on scroll: what you scroll is what you see, this frame.
 */
import { buildPlate, type Plate, type Pt } from "./plates";

export type Kind = "open" | "title" | "act" | "reel" | "stills" | "credits" | "fin";

type Box = { x: number; y: number; w: number; h: number };
type Anchor = { p: Pt[]; r: number; path: number };

export interface Scene {
  i: number;
  el: HTMLElement;
  id: string;
  kind: Kind;
  label: string;
  short: string;
  base: number; // vh
  start: number; // px
  dur: number; // px
  inPx: number;
  outPx: number;
  overflow: number;
  plate?: Plate;
  svg?: SVGSVGElement;
  box?: Box;
  vars: Map<string, string>;
}

const LIT: Record<Kind, boolean> = { open: false, title: false, act: true, reel: true, stills: true, credits: false, fin: false };
/** [vh when data-dur="auto", entrance vh, exit vh] */
const WIN: Record<Kind, [number, number, number]> = {
  open: [0, 0, 0],
  title: [0, 30, 24],
  act: [0, 22, 18],
  reel: [0, 16, 14],
  stills: [64, 18, 14],
  credits: [26, 8, 14],
  fin: [0, 34, 0],
};
const MARK: Pt[] = [
  [16, 8.5],
  [8.5, 21],
  [23.5, 21],
];
/** the film's nominal running time, for the timecode: eight minutes for eight years */
const RUNTIME = 8 * 60;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => x * x * (3 - 2 * x);
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Film {
  scenes: Scene[] = [];
  total = 0;
  vh = 0;
  y = 0;
  cur = -1;
  readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  playing = false;

  /** called when the active scene changes */
  onScene: ((s: Scene, prev: Scene | null) => void)[] = [];
  /** called every frame with the active scene and the px into it */
  onFrame: ((s: Scene, local: number) => void)[] = [];
  onPlayState: ((playing: boolean) => void)[] = [];
  /** run before measuring (to size things scenes depend on) and after */
  beforeLayout: (() => void)[] = [];
  onLayout: (() => void)[] = [];

  private screen = document.getElementById("screen")!;
  private runway = document.getElementById("runway")!;
  private dotEls: SVGCircleElement[];
  private dotPath: SVGPathElement;
  private dotCache: string[] = [];
  private headerBox: Box = { x: 0, y: 0, w: 32, h: 32 };
  private screenH = 0;
  private queued = false;
  private anim = 0;
  private autoY = 0;
  private lastTs = 0;
  private perf: number[] = [];

  constructor() {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".screen > .scene"));
    this.scenes = els.map((el, i) => {
      const kind = el.dataset.kind as Kind;
      const svg = el.querySelector<SVGSVGElement>(".plate-frame svg") ?? undefined;
      const sc: Scene = {
        i,
        el,
        id: el.id,
        kind,
        label: el.dataset.label ?? el.id,
        short: el.dataset.short ?? el.id,
        base: el.dataset.dur === "auto" ? WIN[kind][0] : Number(el.dataset.dur),
        start: 0,
        dur: 1,
        inPx: 0,
        outPx: 0,
        overflow: 0,
        svg,
        plate: svg && el.dataset.plate ? buildPlate(el.dataset.plate, svg) : undefined,
        vars: new Map(),
      };
      return sc;
    });
    this.stageReveals();
    const dots = document.getElementById("dots")!;
    this.dotEls = Array.from(dots.querySelectorAll("circle"));
    this.dotPath = dots.querySelector("path")!;

  }

  /** lay out and start listening; call once everything is wired */
  start() {
    this.layout();
    this.frame();
    addEventListener("scroll", () => this.queue(), { passive: true });
    let lastW = innerWidth;
    let lastH = innerHeight;
    let rt = 0;
    addEventListener("resize", () => {
      // phones resize the viewport as the URL bar slides; only re-lay out for real changes
      if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 140) return;
      lastW = innerWidth;
      lastH = innerHeight;
      clearTimeout(rt);
      rt = window.setTimeout(() => this.relayout(), 120);
    });
    document.fonts?.ready.then(() => this.relayout());

    // anything that means "I'm driving now" stops autoplay and running jumps
    const stop = () => {
      this.pause();
      this.cancelJump();
    };
    addEventListener("wheel", stop, { passive: true });
    addEventListener("touchstart", stop, { passive: true });
    addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) stop();
    });
  }

  /** mark the elements that reveal in sequence as a scene enters */
  private stageReveals() {
    const tag = (sel: string, cls: string) => document.querySelectorAll(sel).forEach((n) => n.classList.add(cls));
    tag(".act-role, .slate, .title-sub, .reel-head, .stills-head, .fin-sub", "rv1");
    tag(".act-copy, .fin-mail, .reel-stage", "rv2");
    tag(".act-line, .act-stat, .act-stats, .act-note, .fin-links, .fin-replay, .clips", "rv3");
  }

  // ───────────────────────── layout ─────────────────────────
  layout() {
    for (const f of this.beforeLayout) f();
    this.vh = innerHeight;
    this.screenH = this.screen.clientHeight;
    const vh = this.vh / 100;
    this.screen.classList.add("measuring");
    for (const s of this.scenes) {
      s.el.style.setProperty("--shift", "0px");
      s.vars.set("--shift", "0px");
    }
    let start = 0;
    for (const s of this.scenes) {
      const [, inVh, outVh] = WIN[s.kind];
      s.inPx = inVh * vh;
      s.outPx = outVh * vh;
      s.overflow = Math.max(0, Math.ceil(s.el.scrollHeight - this.screenH));
      s.dur = Math.max(s.base * vh + s.overflow, s.inPx + s.outPx + 40);
      s.start = start;
      start += s.dur;
      const anchor = s.svg ?? s.el.querySelector<HTMLElement>("[data-anchor]");
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        s.box = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    this.screen.classList.remove("measuring");
    const last = this.scenes[this.scenes.length - 1];
    this.total = last.start + last.dur;
    this.runway.style.height = `${Math.ceil(this.total + innerHeight)}px`;
    const m = document.querySelector(".bar-top .mark")!.getBoundingClientRect();
    this.headerBox = { x: m.left, y: m.top, w: m.width, h: m.height };
    this.dotCache = [];
    for (const f of this.onLayout) f();
  }

  /** re-lay out and stay at the same moment of the film */
  relayout() {
    const s = this.scenes[Math.max(0, this.cur)];
    const f = s ? (this.y - s.start) / s.dur : 0;
    this.layout();
    if (s) window.scrollTo(0, Math.round(s.start + f * s.dur));
    this.frame();
  }

  // ───────────────────────── per frame ─────────────────────────
  queue() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.frame();
    });
  }

  indexAt(y: number) {
    let i = 0;
    while (i < this.scenes.length - 1 && y >= this.scenes[i + 1].start) i++;
    return i;
  }

  frame() {
    const t0 = performance.now();
    const y = Math.min(Math.max(window.scrollY, 0), this.total);
    this.y = y;
    const i = this.indexAt(y);
    if (i !== this.cur) this.activate(i);
    const s = this.scenes[i];
    const local = y - s.start;
    this.applyScene(s, local);
    this.applyDots(s, local);
    for (const f of this.onFrame) f(s, local);
    if (import.meta.env.DEV) {
      // dev-only: CPU time of one playhead update (scene, plate, dots, scrubber, reel)
      const dt = performance.now() - t0;
      this.perf.push(dt);
      if (this.perf.length > 4000) this.perf.shift();
      const sorted = [...this.perf].sort((a, b) => a - b);
      (window as unknown as { __film: unknown }).__film = {
        avgMs: +(this.perf.reduce((a, b) => a + b, 0) / this.perf.length).toFixed(3),
        p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(3),
        maxMs: +sorted[sorted.length - 1].toFixed(3),
        frames: this.perf.length,
      };
    }
  }

  private activate(i: number) {
    const prev = this.cur >= 0 ? this.scenes[this.cur] : null;
    prev?.el.classList.remove("on");
    this.cur = i;
    const s = this.scenes[i];
    s.el.classList.add("on");
    // the scenes either side stand by in place, so a cut to them is instant
    this.scenes.forEach((x) => x.el.classList.toggle("near", Math.abs(x.i - i) === 1));
    for (const f of this.onScene) f(s, prev);
  }

  private set(s: Scene, k: string, v: string) {
    if (s.vars.get(k) === v) return;
    s.vars.set(k, v);
    s.el.style.setProperty(k, v);
  }

  inOut(s: Scene, local: number) {
    const inV = s.inPx ? smooth(clamp01(local / s.inPx)) : 1;
    const outV = s.outPx ? smooth(clamp01((local - (s.dur - s.outPx)) / s.outPx)) : 0;
    return [inV, outV];
  }

  shiftAt(s: Scene, local: number) {
    return -Math.min(Math.max(local - s.inPx * 0.5, 0), s.overflow);
  }

  plateT(s: Scene, local: number) {
    if (this.reduced) return 0.8;
    return clamp01((local - s.inPx * 0.35) / (s.dur - s.inPx * 0.35 - s.outPx * 0.6));
  }

  private applyScene(s: Scene, local: number) {
    const [inV, outV] = this.inOut(s, local);
    const prev = this.scenes[s.i - 1];
    const next = this.scenes[s.i + 1];
    this.set(s, "--in", inV.toFixed(3));
    this.set(s, "--out", outV.toFixed(3));
    this.set(s, "--t", (local / s.dur).toFixed(4));
    if (s.overflow) this.set(s, "--shift", `${this.shiftAt(s, local).toFixed(1)}px`);

    if (s.kind === "open") {
      const f = local / s.dur;
      this.set(s, "--push", f.toFixed(4));
      this.set(s, "--fade", clamp01((f - 0.16) / 0.4).toFixed(3));
      this.set(s, "--shut", easeIO(clamp01((f - 0.4) / 0.6)).toFixed(4));
    }
    if (s.kind === "act") {
      const frame = (prev?.kind === "act" ? 1 : inV) * (next?.kind === "act" ? 1 : 1 - outV);
      this.set(s, "--frame", frame.toFixed(3));
      s.plate?.update(this.plateT(s, local));
    }
    const lit = LIT[s.kind] ? (prev && LIT[prev.kind] ? 1 : inV) * (next && LIT[next.kind] ? 1 : 1 - outV) : 0;
    const l = lit.toFixed(3);
    if (this.screen.dataset.lit !== l) {
      this.screen.dataset.lit = l;
      this.screen.style.setProperty("--lit", l);
    }
  }

  // ───────────────────────── the three dots ─────────────────────────
  private anchor(s: Scene, local: number): Anchor {
    if (s.kind === "act" && s.plate && s.box) {
      const t = this.plateT(s, local);
      const k = this.reduced ? 1 : 1 + (local / s.dur) * 0.035;
      const b = s.box;
      const sc = (b.w / 1000) * k;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2 + this.shiftAt(s, local);
      return {
        p: s.plate.dots(t).map(([x, y]) => [cx + (x - 500) * sc, cy + (y - 300) * sc] as Pt),
        r: s.plate.r * sc,
        path: 0,
      };
    }
    if ((s.kind === "title" || s.kind === "fin") && s.box) {
      const b = s.box;
      const k = b.w / 32;
      const dy = this.shiftAt(s, local);
      return { p: MARK.map(([x, y]) => [b.x + x * k, b.y + y * k + dy] as Pt), r: 2.3 * k, path: 1 };
    }
    const b = this.headerBox;
    const k = b.w / 32;
    return { p: MARK.map(([x, y]) => [b.x + x * k, b.y + y * k] as Pt), r: 2.1 * k, path: 0 };
  }

  private applyDots(s: Scene, local: number) {
    const prev = this.scenes[s.i - 1];
    const next = this.scenes[s.i + 1];
    let a: Anchor;
    let op = 1;
    let f = -1;
    let from: Anchor | null = null;
    let to: Anchor | null = null;
    if (next && s.outPx && local > s.dur - s.outPx) {
      from = this.anchor(s, s.dur - s.outPx);
      to = this.anchor(next, next.inPx);
      f = (0.5 * (local - (s.dur - s.outPx))) / s.outPx;
    } else if (prev && s.inPx && local < s.inPx) {
      from = this.anchor(prev, prev.dur - prev.outPx);
      to = this.anchor(s, s.inPx);
      f = 0.5 + (0.5 * local) / s.inPx;
    }
    if (from && to) {
      if (this.reduced) {
        // a plain cut, with a blink instead of a flight
        op = clamp01(Math.abs(f - 0.5) * 6);
        a = f < 0.5 ? from : to;
      } else {
        a = { p: [], r: 0, path: 0 };
        for (let i = 0; i < 3; i++) {
          const fi = easeIO(clamp01((f - i * 0.06) / 0.88));
          const [x0, y0] = from.p[i];
          const [x1, y1] = to.p[i];
          const dx = x1 - x0;
          const dy = y1 - y0;
          const bend = [-0.22, 0.1, 0.24][i];
          const mx = (x0 + x1) / 2 - dy * bend;
          const my = (y0 + y1) / 2 + dx * bend;
          const u = 1 - fi;
          a.p.push([u * u * x0 + 2 * u * fi * mx + fi * fi * x1, u * u * y0 + 2 * u * fi * my + fi * fi * y1]);
        }
        const ef = easeIO(clamp01(f));
        a.r = from.r + (to.r - from.r) * ef;
        a.path = to.path ? clamp01((f - 0.55) / 0.45) : from.path ? 1 - clamp01(f / 0.4) : 0;
      }
    } else a = this.anchor(s, local);

    // the open path of the mark, drawn only when the dots form the mark
    const pathVis = a.path;
    const vals = [
      ...a.p.flatMap(([x, y]) => [x.toFixed(1), y.toFixed(1)]),
      a.r.toFixed(2),
      op.toFixed(2),
      pathVis.toFixed(3),
    ];
    if (vals.every((v, i) => this.dotCache[i] === v)) return;
    this.dotCache = vals;
    this.dotEls.forEach((c, i) => {
      c.setAttribute("cx", vals[i * 2]);
      c.setAttribute("cy", vals[i * 2 + 1]);
      c.setAttribute("r", vals[6]);
      c.setAttribute("opacity", vals[7]);
    });
    const [p0, p1, p2] = a.p;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    this.dotPath.setAttribute("d", `M${vals[0]} ${vals[1]}L${vals[2]} ${vals[3]}L${vals[4]} ${vals[5]}`);
    this.dotPath.setAttribute("stroke-dasharray", `${len.toFixed(1)} ${len.toFixed(1)}`);
    this.dotPath.setAttribute("stroke-dashoffset", (len * (1 - pathVis)).toFixed(1));
    this.dotPath.setAttribute("stroke-width", Math.max(1.2, a.r * 0.22).toFixed(2));
  }

  // ───────────────────────── moving the playhead ─────────────────────────
  /** where a scene "reads": just after its entrance */
  settle(s: Scene) {
    return s.kind === "open" ? 0 : Math.round(s.start + s.inPx + 2);
  }

  timecode(y = this.y) {
    const secs = (y / this.total) * RUNTIME;
    const mm = Math.floor(secs / 60);
    const ss = Math.floor(secs % 60);
    const ff = Math.floor((secs % 1) * 24);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(mm)}:${p(ss)}:${p(ff)}`;
  }

  jumpTo(y: number, animate = true) {
    this.cancelJump();
    y = Math.max(0, Math.min(this.total, Math.round(y)));
    const from = window.scrollY;
    const dist = Math.abs(y - from);
    if (!animate || this.reduced || dist < 4) {
      window.scrollTo(0, y);
      this.frame();
      return;
    }
    const ms = Math.min(1100, 380 + (dist / this.vh) * 22);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = clamp01((now - t0) / ms);
      window.scrollTo(0, Math.round(from + (y - from) * easeIO(k)));
      this.frame();
      if (k < 1) this.anim = requestAnimationFrame(step);
      else this.anim = 0;
    };
    this.anim = requestAnimationFrame(step);
  }

  cancelJump() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = 0;
  }

  jumpToScene(i: number, animate = true) {
    const s = this.scenes[Math.max(0, Math.min(this.scenes.length - 1, i))];
    this.jumpTo(this.settle(s), animate);
  }

  step(dir: 1 | -1) {
    const s = this.scenes[this.cur];
    const atSettle = Math.abs(this.y - this.settle(s)) < 8;
    if (dir < 0 && !atSettle && this.y > this.settle(s)) this.jumpToScene(this.cur);
    else this.jumpToScene(this.cur + dir);
  }

  sceneOf(node: Node | null): Scene | undefined {
    const el = node instanceof Element ? node.closest<HTMLElement>(".screen > .scene") : null;
    return el ? this.scenes.find((s) => s.el === el) : undefined;
  }

  // ───────────────────────── autoplay (Space) ─────────────────────────
  private speed(s: Scene, local: number) {
    // vh per second: unhurried where there is something to read, brisk through the cuts
    const inHold = local > s.inPx && local < s.dur - s.outPx;
    switch (s.kind) {
      case "open":
        return 26;
      case "credits":
        return inHold ? 8 : 20;
      case "reel": {
        // linger while a frame sits in the gate, pull down briskly between frames
        const x = ((local - s.inPx * 0.7) / (s.dur - (s.inPx + s.outPx) * 0.7)) * 7;
        return inHold ? (Math.abs(x - Math.round(x)) < 0.19 ? 6 : 30) : 22;
      }
      case "title":
      case "fin":
        return inHold ? 12 : 22;
      default:
        return inHold ? 9 : 24;
    }
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (this.playing) return;
    if (this.y >= this.total - 2) window.scrollTo(0, 0);
    this.cancelJump();
    this.playing = true;
    this.autoY = window.scrollY;
    this.lastTs = performance.now();
    for (const f of this.onPlayState) f(true);
    const tick = (now: number) => {
      if (!this.playing) return;
      // someone dragged the scrollbar: they're driving now
      if (Math.abs(window.scrollY - Math.round(this.autoY)) > 3) return this.pause();
      const dt = Math.min(0.05, (now - this.lastTs) / 1000);
      this.lastTs = now;
      const s = this.scenes[this.indexAt(this.autoY)];
      this.autoY = Math.min(this.total, this.autoY + (this.speed(s, this.autoY - s.start) * this.vh * dt) / 100);
      window.scrollTo(0, Math.round(this.autoY));
      this.frame();
      if (this.autoY >= this.total) return this.pause();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    for (const f of this.onPlayState) f(false);
  }
}
