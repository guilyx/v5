import { Camera, clamp, ease, lerp, mixShot, smooth, type Projected, type Shot } from "./cam";
import { IDLE, RUNNING, SUCCESS, isShown, readTree, statusAt, type BTNode } from "./model";
import {
  PORT_Y,
  along,
  boundsOf,
  buildEdges,
  cardWidth,
  layoutTree,
  route,
  station,
  subtree,
  type Edge,
  type Mode,
  type Route,
} from "./layout";
import type { FrameData, Layer, RobotPose } from "./layer";

/** a camera shot plus where on screen its target sits */
interface View extends Shot {
  cx: number;
  cy: number;
}
interface StepShot {
  k0: number;
  k1: number;
  start: View;
  end: View;
}

const LAST = 13;
const END = 13.75;
const STATUS_TEXT = ["Idle", "Running", "Success"];
const GLYPH: Record<string, string> = {
  action: "g-act",
  condition: "g-cond",
  project: "g-clip",
  paper: "g-doc",
  sequence: "g-seq",
  parallel: "g-par",
};
const LED = ["#94a3b8", "#f59e0b", "#22c55e"];

export interface Board {
  attach(layer: Layer): void;
}

export function startBoard(): Board | null {
  const section = document.querySelector<HTMLElement>("section.tree");
  const stage = section?.querySelector<HTMLElement>(".stage");
  const list = stage?.querySelector<HTMLElement>(".bt");
  if (!section || !stage || !list) return null;
  const html = document.documentElement;
  const hero = stage.querySelector<HTMLElement>(".hero")!;
  const outro = stage.querySelector<HTMLElement>(".outro")!;
  const bb = stage.querySelector<HTMLElement>(".bb")!;
  const bbRows = Array.from(bb.querySelectorAll<HTMLElement>(".bb-list > div"));
  const bbCount = bb.querySelector<HTMLElement>(".bb-count")!;
  const bbToggle = bb.querySelector<HTMLButtonElement>(".bb-toggle")!;
  const dock = stage.querySelector<HTMLElement>(".dock")!;
  const tickBtns = Array.from(dock.querySelectorAll<HTMLButtonElement>(".ticks button"));
  const dockYear = dock.querySelector<HTMLElement>(".dock-year")!;
  const dockLabel = dock.querySelector<HTMLElement>(".dock-label")!;
  const recenterBtn = dock.querySelector<HTMLButtonElement>("[data-act=recenter]")!;
  const playBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-act=play]"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const nodes = readTree(list);
  const root = nodes[0];
  const byStep = new Map<number, BTNode>();
  for (const n of nodes) for (const s of n.steps) byStep.set(s, n);
  const focusOf = (k: number): BTNode => {
    if (k >= LAST) return byStep.get(12)!;
    for (let i = Math.max(0, Math.floor(k)); i > 0; i--) if (byStep.has(i)) return byStep.get(i)!;
    return root;
  };

  // ── decorate cards: glyphs, status chips, expand buttons ──
  for (const n of nodes) {
    const el = n.el;
    el.classList.add(`t-${n.type}`);
    if (n.kids.length) el.classList.add("has-kids");
    if (!el.querySelector(".node-head")) el.classList.add("leaf");
    const head = el.querySelector(".node-head");
    const state = document.createElement("span");
    state.className = "state";
    state.setAttribute("aria-hidden", "true");
    state.innerHTML = "<i></i><b>Idle</b>";
    if (head) head.append(state);
    else {
      const title = el.querySelector(".node-title")!;
      const g = document.createElement("span");
      g.className = "glyph";
      g.setAttribute("aria-hidden", "true");
      g.innerHTML = `<svg><use href="#${GLYPH[n.type] ?? "g-act"}"/></svg>`;
      const target = el.classList.contains("node--project") ? el.querySelector(".proj-body")! : el;
      target.prepend(state);
      title.prepend(g);
    }
    if (n.collapsible) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "more";
      b.setAttribute("aria-expanded", "false");
      b.innerHTML = `<span>+</span> ${n.el.dataset.more}`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        toggle(n);
      });
      el.append(b);
      el.parentElement!.classList.add("closed");
    }
  }

  // year marks on the board, left of each chapter (wide layout only)
  const marks: { n: BTNode; el: HTMLElement; w: number; dx: number; dy: number }[] = [];
  const markLayer = document.createElement("div");
  markLayer.className = "marks";
  markLayer.setAttribute("aria-hidden", "true");
  list.before(markLayer);
  for (const n of nodes) {
    if (!n.steps.length) continue;
    const y = n.el.querySelector(".node-years")?.textContent?.match(/\d{4}/)?.[0];
    if (!y) continue;
    const el = document.createElement("span");
    el.className = "mark";
    el.textContent = y;
    markLayer.append(el);
    marks.push({ n, el, w: 0, dx: 0, dy: 0 });
  }

  // ── state ──
  const cam = new Camera();
  let layer: Layer | null = null;
  let mode: Mode = "wide";
  let W = 0;
  let H = 0;
  let stepH = 1;
  let secTop = 0;
  let pt = 0; // target progress (from scroll)
  let p = 0; // shown progress (short smoothing)
  let edges: Edge[] = [];
  const edgeOf = new Map<BTNode, Edge>();
  let edgeStates = new Float32Array(0);
  let routes = new Map<number, Route>();
  let shots: StepShot[] = [];
  let overview: View | null = null;
  let heroShot: View | null = null;
  let bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const user = { x: 0, y: 0, z: 1 };
  let userAnim: { from: typeof user; t0: number } | null = null;
  let lastStep = -1;
  let playing = false;
  let layoutAnim: { t0: number; from: Map<BTNode, { x: number; y: number }> } | null = null;
  let running = false;
  let lastT = performance.now();
  let lastInput = performance.now();
  let dirty = true;
  let inView = true;
  const view: View = { x: 0, y: 0, zoom: 1, pitch: 0.3, cx: 0, cy: 0 };
  const prevView: View = { ...view };
  const pose: RobotPose = { visible: true, x: 0, y: 0, a: 0, scale: 1, speed: 0, led: LED[0] };
  let prevPose = { x: 0, y: 0 };
  let movingUntil = 0;
  let moving = false;
  const focusLevel = new Map<BTNode, number>();
  // ?perf shows this; window.__bt exposes it. cpu = whole frame, gl = three.js render call, all ms (moving averages)
  const perf = { frames: 0, cpu: 0, gl: 0, max: 0, calls: 0, tris: 0, last: 0, log: [] as number[][] };
  const perfEl = location.search.includes("perf") ? document.createElement("div") : null;
  if (perfEl) {
    perfEl.className = "perf";
    document.body.append(perfEl);
  }
  (window as unknown as { __bt: typeof perf }).__bt = perf;

  // ── geometry ──
  function measure() {
    for (const n of nodes) {
      n.el.style.width = `${cardWidth(n, mode)}px`;
    }
    for (const n of nodes) {
      if (!isShown(n)) continue;
      n.w = cardWidth(n, mode);
      n.h = n.el.offsetHeight;
    }
    for (const m of marks) m.w = m.el.offsetWidth;
  }

  function relayout(animate: boolean) {
    const from = new Map<BTNode, { x: number; y: number }>();
    for (const n of nodes) if (!Number.isNaN(n.ax)) from.set(n, { x: n.ax, y: n.ay });
    bounds = layoutTree(nodes, mode);
    placeMarks();
    if (animate && !reduced) {
      for (const n of nodes) {
        if (!from.has(n)) {
          // new nodes grow out of their parent
          const pa = n.parent!;
          from.set(n, { x: pa.ax + 40, y: pa.ay });
        }
      }
      layoutAnim = { t0: performance.now(), from };
    } else {
      for (const n of nodes) {
        n.ax = n.x;
        n.ay = n.y;
      }
      layoutAnim = null;
    }
    rebuildGraph();
    computeShots();
    dirty = true;
    kick();
  }

  /** a year sits left of its chapter, or below whatever card is already there */
  function placeMarks() {
    const shown = nodes.filter(isShown);
    for (const m of marks) {
      // above the chapter card, flush with its left edge
      const x0 = m.n.x + 2;
      const x1 = x0 + m.w;
      const y = m.n.y - 16;
      const hit = shown.find((o) => o !== m.n && o.x < x1 && o.x + o.w > x0 && o.y < y + 8 && o.y + o.h > y - 96);
      m.dx = x0 - m.n.x;
      m.dy = hit ? NaN : y - m.n.y;
    }
  }

  const coreCache = new Map<BTNode, BTNode[]>();
  function rebuildGraph() {
    coreCache.clear();
    edges = buildEdges(nodes, mode);
    edgeOf.clear();
    for (const e of edges) edgeOf.set(e.child, e);
    edgeStates = new Float32Array(edges.length * 4);
    layer?.setGraph(edges, bounds);
    routes = new Map();
    let prev = root;
    for (let k = 1; k <= 12; k++) {
      const f = byStep.get(k);
      if (!f || f === prev) continue;
      routes.set(k, route(prev, f, edgeOf, mode));
      prev = f;
    }
  }

  function freeArea(k: number) {
    if (k >= LAST) {
      // leave room for the closing card
      return mode === "wide"
        ? { l: 44 + 380 + 40, t: 56 + 30, r: W - 24 - 340 - 40, b: H - 112 }
        : { l: 16, t: 300, r: W - 16, b: H - 150 };
    }
    if (mode === "wide") {
      const right = W - 24 - 340 - 36;
      if (k === 0) return { l: Math.max(W * 0.46, 560), t: 56 + 30, r: W - 30, b: H - 120 };
      return { l: 44, t: 56 + 34, r: right, b: H - 118 };
    }
    if (k === 0) return { l: 12, t: H * 0.7, r: W - 12, b: H - 84 };
    return { l: 14, t: 52 + 16, r: W - 14, b: H - 146 };
  }

  function fitRect(r: { x0: number; y0: number; x1: number; y1: number }, k: number, pitch: number): { start: View; end: View } {
    const fa = freeArea(k);
    const fw = fa.r - fa.l;
    const fh = fa.b - fa.t;
    const pad = mode === "wide" ? 36 : 10;
    const rw = r.x1 - r.x0 + pad * 2;
    const rh = r.y1 - r.y0 + pad * 2;
    const zMax = mode === "wide" ? 1.12 : Math.min(1.12, fw / 352);
    const zMin = mode === "wide" ? 1.0 : Math.min(1.0, fw / 352);
    let z = Math.min(fw / rw, (fh / rh) * 0.94, zMax);
    const cx = fa.l + fw / 2;
    const cy = fa.t + fh / 2;
    const x = (r.x0 + r.x1) / 2;
    if (z >= zMin || rh * zMin <= fh) {
      const v: View = { x, y: (r.y0 + r.y1) / 2, zoom: z, pitch, cx, cy };
      return { start: v, end: { ...v } };
    }
    z = Math.min(zMin, fw / rw);
    const win = (fh / z) * 0.94;
    const start: View = { x, y: r.y0 - pad + win / 2, zoom: z, pitch, cx, cy };
    const end: View = { x, y: r.y1 + pad - win / 2, zoom: z, pitch, cx, cy };
    return { start, end };
  }

  /** a chapter's own subtree, without the papers you have to click open */
  const core = (n: BTNode) => subtree(n).filter((m) => m === n || !m.parent || !m.parent.collapsible);

  function computeShots() {
    shots = [];
    const pitch = mode === "wide" ? 0.3 : 0.24;
    for (let k = 1; k <= 12; k++) {
      const n = byStep.get(k);
      if (!n) continue;
      if (shots.length && shots[shots.length - 1].k1 === k - 1 && byStep.get(k - 1) === n) {
        shots[shots.length - 1].k1 = k;
        continue;
      }
      const fit = fitRect(boundsOf(core(n)), k, pitch);
      shots.push({ k0: k, k1: k, ...fit });
    }
    // the opening shot: the root and the first branch, the tree running off to the right
    if (mode === "wide") {
      const learn = byStep.get(1)!;
      const fa = freeArea(0);
      // the tree starts just right of the hero text and runs off the edge
      const heroRight = hero.offsetLeft + hero.offsetWidth;
      const zoom = clamp((W - heroRight) / 1050, 0.6, 0.86);
      const x = learn.x + 160;
      heroShot = {
        x,
        y: learn.y + 230,
        zoom,
        pitch: 0.42,
        cx: Math.max(fa.l, heroRight + 56) + (x - root.x) * zoom,
        cy: H * 0.47,
      };
      void fa;
    } else {
      const fit = fitRect(boundsOf([root, byStep.get(1)!]), 0, 0.3);
      heroShot = { ...fit.start, y: root.y + 120, zoom: fit.start.zoom * 1.02 };
    }
    // the closing shot: the whole tree, tilted back
    // fitted through the real projection, so the far end (2014) and the near end (now) both show
    const fa = freeArea(LAST);
    const all = bounds;
    const fw = fa.r - fa.l;
    const fh = fa.b - fa.t;
    const v: View = {
      x: (all.x0 + all.x1) / 2,
      y: all.y0 + (all.y1 - all.y0) * 0.62,
      zoom: 1.2,
      pitch: mode === "wide" ? 1.02 : 1.0,
      cx: fa.l + fw / 2,
      cy: fa.t + fh / 2,
    };
    const tc = new Camera();
    const q: Projected = { x: 0, y: 0, s: 1 };
    const extent = () => {
      tc.set(v, W, H, v.cx, v.cy);
      let t = Infinity;
      let b = -Infinity;
      let l = Infinity;
      let r = -Infinity;
      for (const [px, py] of [
        [all.x0, all.y0],
        [all.x1, all.y0],
        [all.x0, all.y1],
        [all.x1, all.y1],
      ]) {
        tc.project(px, py, q);
        t = Math.min(t, q.y);
        b = Math.max(b, q.y);
        l = Math.min(l, q.x);
        r = Math.max(r, q.x);
      }
      return { t, b, l, r };
    };
    if (mode === "narrow") {
      // phones: pull back over the branches that are still running
      v.x = (all.x0 + all.x1) / 2;
      v.y = all.y1 - 900;
      v.pitch = 0.62;
      v.zoom = ((W - 40) / (all.x1 - all.x0)) * 0.5;
      v.cx = W / 2;
      v.cy = (fa.t + fa.b) / 2;
      overview = v;
      return;
    }
    for (let i = 0; i < 120; i++) {
      const e = extent();
      // keep it centred in the free area, then shrink until it fits
      v.cy += ((fa.t - e.t) + (fa.b - e.b)) / 2;
      v.cx += ((fa.l - e.l) + (fa.r - e.r)) / 2;
      const e2 = extent();
      if (e2.t >= fa.t - 1 && e2.b <= fa.b + 1 && e2.l >= fa.l - 1 && e2.r <= fa.r + 1) break;
      v.zoom *= 0.95;
    }
    overview = v;
  }

  function shotFor(k: number) {
    return shots.find((s) => k >= s.k0 && k <= s.k1) ?? null;
  }

  /** where the camera wants to be at progress q, before the user's own pan/zoom */
  const tmpA: View = { ...view };
  const tmpB: View = { ...view };
  function baseView(q: number, out: View): View {
    const k = Math.min(LAST, Math.floor(q));
    const f = q - k;
    const at = (kk: number, phase: "start" | "end"): View => {
      if (kk <= 0) return heroShot!;
      if (kk >= LAST) return overview!;
      const s = shotFor(kk)!;
      return s[phase];
    };
    const dwell = (s: StepShot, qq: number): View => {
      const a = s.k0 + 0.3;
      const b = s.k1 + 0.86;
      return mixView(s.start, s.end, smooth((qq - a) / (b - a)), tmpB);
    };
    if (k <= 0) return copyView(heroShot!, out);
    if (k >= LAST) {
      const from = dwell(shotFor(12)!, 12.99);
      const t = reduced ? (f > 0.3 ? 1 : 0) : ease(f / 0.6);
      mixView(from, overview!, t, out);
      if (!reduced) out.pitch -= 0.1 * Math.sin(Math.PI * t);
      return out;
    }
    const s = shotFor(k)!;
    if (k > s.k0 || f >= 0.3) return copyView(dwell(s, q), out);
    // transition from the previous shot
    const prev = k - 1 <= 0 ? heroShot! : (() => { const ps = shotFor(k - 1)!; return copyView(dwell(ps, k - 1 + 0.999), tmpA); })();
    const to = at(k, "start");
    const t = reduced ? 1 : ease(f / 0.3);
    mixView(prev, to, t, out);
    if (!reduced) {
      const dist = Math.hypot(to.x - prev.x, to.y - prev.y);
      const dip = clamp(dist / 2600, 0.04, 0.24);
      out.zoom *= 1 - dip * Math.sin(Math.PI * t);
      out.pitch += 0.1 * Math.sin(Math.PI * t);
    }
    return out;
  }

  function mixView(a: View, b: View, t: number, out: View): View {
    mixShot(a, b, t, out);
    out.cx = lerp(a.cx, b.cx, t);
    out.cy = lerp(a.cy, b.cy, t);
    return out;
  }
  function copyView(a: View, out: View): View {
    out.x = a.x;
    out.y = a.y;
    out.zoom = a.zoom;
    out.pitch = a.pitch;
    out.cx = a.cx;
    out.cy = a.cy;
    return out;
  }

  // ── sizing ──
  function resize() {
    const w = stage!.clientWidth;
    const h = stage!.clientHeight;
    if (!w || !h) return;
    if (w === W && h === H) return;
    const newMode: Mode = w >= 900 && w / h > 1.1 ? "wide" : "narrow";
    const modeChanged = newMode !== mode || !W;
    W = w;
    H = h;
    mode = newMode;
    html.classList.toggle("bt-wide", mode === "wide");
    html.classList.toggle("bt-narrow", mode === "narrow");
    stepH = Math.round(h * (mode === "wide" ? 0.95 : 0.85));
    section!.style.height = `${Math.round(END * stepH + h)}px`;
    secTop = section!.getBoundingClientRect().top + scrollY;
    layer?.resize(w, h);
    if (modeChanged) {
      measure();
      relayout(false);
    } else {
      computeShots();
    }
    readScroll();
    p = pt;
    dirty = true;
    kick();
  }

  function readScroll() {
    pt = clamp((scrollY - secTop) / stepH, 0, END);
  }

  // ── per frame ──
  const proj: Projected = { x: 0, y: 0, s: 1 };

  function frame(now: number) {
    running = false;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const c0 = performance.now();
    let glCost = 0;

    if (playing) {
      const f = pt - Math.floor(pt);
      const v = f < 0.3 ? 0.3 / 1.0 : 0.7 / 3.6;
      const next = Math.min(END, pt + dt * v);
      scrollTo(0, secTop + next * stepH);
      pt = next;
      if (next >= END - 0.001) setPlaying(false);
      lastInput = now;
    }

    // short smoothing only: the board answers the wheel right away
    if (reduced) p = pt;
    else {
      const k = 1 - Math.exp(-dt / 0.065);
      p += (pt - p) * k;
      if (Math.abs(pt - p) < 0.0004) p = pt;
    }

    // layout animation (a node opened or closed)
    let animating = false;
    if (layoutAnim) {
      const t = clamp((now - layoutAnim.t0) / 420, 0, 1);
      const e = ease(t);
      for (const n of nodes) {
        const f = layoutAnim.from.get(n);
        n.ax = f ? lerp(f.x, n.x, e) : n.x;
        n.ay = f ? lerp(f.y, n.y, e) : n.y;
      }
      rebuildGraph();
      if (t >= 1) layoutAnim = null;
      animating = true;
    }

    // step change: the camera goes back to following the tick
    const step = Math.min(LAST, Math.floor(p));
    if (step !== lastStep) {
      if (lastStep >= 0 && (user.x || user.y || user.z !== 1)) recenter();
      lastStep = step;
    }
    if (userAnim) {
      const t = clamp((now - userAnim.t0) / 450, 0, 1);
      const e = ease(t);
      user.x = lerp(userAnim.from.x, 0, e);
      user.y = lerp(userAnim.from.y, 0, e);
      user.z = Math.exp(lerp(Math.log(userAnim.from.z), 0, e));
      if (t >= 1) userAnim = null;
      animating = true;
    }

    baseView(p, view);
    view.x += user.x;
    view.y += user.y;
    view.zoom = clamp(view.zoom * user.z, 0.06, 2.4);
    const camMoved =
      Math.abs(view.x - prevView.x) > 0.01 ||
      Math.abs(view.y - prevView.y) > 0.01 ||
      Math.abs(view.zoom / prevView.zoom - 1) > 1e-5 ||
      Math.abs(view.pitch - prevView.pitch) > 1e-5 ||
      Math.abs(view.cx - prevView.cx) > 0.01 ||
      Math.abs(view.cy - prevView.cy) > 0.01;
    copyView(view, prevView);
    cam.set(view, W, H, view.cx, view.cy);
    if (camMoved || animating) movingUntil = now + 180;
    const isMoving = now < movingUntil;
    if (isMoving !== moving) {
      moving = isMoving;
      list!.classList.toggle("moving", moving);
      markLayer.classList.toggle("moving", moving);
    }

    if (camMoved || animating || dirty) placeCards();
    if (p !== lastP || dirty || animating) updateStatuses(now);
    updateRobot(dt);
    updateChrome();
    if (now - perf.last > 250) {
      updateVideos();
      perf.last = now;
    }

    const sleeping = now - lastInput > 20000;
    const ambient = !reduced && !sleeping && inView;
    if (layer && inView) {
      updateFrames(dt);
      const g0 = performance.now();
      const r = layer.render(cam, pose, now / 1000, ambient, dt);
      const gc = performance.now() - g0;
      glCost = gc;
      perf.gl = perf.gl ? perf.gl * 0.95 + gc * 0.05 : gc;
      perf.calls = r.calls;
      perf.tris = r.tris;
    }
    dirty = false;

    const cost = performance.now() - c0;
    perf.frames++;
    perf.cpu = perf.cpu ? perf.cpu * 0.95 + cost * 0.05 : cost;
    perf.max = Math.max(perf.max, cost);
    perf.log.push([cost, glCost]);
    if (perf.log.length > 2000) perf.log.shift();
    if (perfEl)
      perfEl.textContent = `${perf.cpu.toFixed(2)} ms/frame CPU (${perf.gl.toFixed(2)} in three.js) · ${perf.calls} draw calls · ${perf.tris} tris`;

    const busy = playing || animating || isMoving || Math.abs(pt - p) > 0 || (ambient && layer?.kind === "gl") || pose.speed > 0.5;
    if (busy && inView) kick();
  }

  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function placeCards() {
    const snap = !moving;
    const dpr = devicePixelRatio || 1;
    for (const n of nodes) {
      const shown = isShown(n);
      if (!shown) continue;
      cam.project(n.ax, n.ay + PORT_Y, proj);
      const s = proj.s;
      let x = proj.x;
      let y = proj.y - PORT_Y * s;
      const vis = x < W + 40 && y < H + 40 && x + n.w * s > -40 && y + n.h * s > -40 && s > 0.02;
      if (vis !== n.vis) {
        n.vis = vis;
        n.el.style.visibility = vis ? "" : "hidden";
      }
      if (!vis) continue;
      if (snap) {
        x = Math.round(x * dpr) / dpr;
        y = Math.round(y * dpr) / dpr;
      }
      n.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${s.toFixed(4)})`;
      n.el.classList.toggle("far", s < 0.42);
    }
    if (mode === "wide") {
      for (const m of marks) {
        if (Number.isNaN(m.dy)) {
          m.el.style.visibility = "hidden";
          continue;
        }
        cam.project(m.n.ax + m.dx, m.n.ay + m.dy, proj);
        const s = proj.s;
        const x = proj.x;
        const y = proj.y - 96 * s;
        const vis = s > 0.2 && x < W && y < H && x + m.w * s > 0 && y + 130 * s > 0;
        m.el.style.visibility = vis ? "" : "hidden";
        if (vis) m.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${s.toFixed(4)})`;
      }
    }
  }

  let lastP = 0;
  function updateStatuses(now: number) {
    const forward = p >= lastP;
    for (const n of nodes) {
      const s = statusAt(n, p);
      if (s === n.status) continue;
      const before = n.status;
      n.status = s;
      const el = n.el;
      el.classList.toggle("is-run", s === RUNNING);
      el.classList.toggle("is-ok", s === SUCCESS);
      const b = el.querySelector(".state b");
      if (b) b.textContent = STATUS_TEXT[s];
      // a ring when a node returns SUCCESS (Web Animations: no forced layout mid-frame)
      if (forward && s === SUCCESS && before === RUNNING && !reduced && n.vis) {
        el.animate([{ outline: "0 solid rgba(31,157,85,.5)", outlineOffset: "0px" }, { outline: "14px solid rgba(31,157,85,0)", outlineOffset: "2px" }], {
          duration: 700,
          easing: "cubic-bezier(.22,1,.36,1)",
        });
      }
      dirty = true;
    }
    // edges: the tick fills each edge on its way to the child
    edges.forEach((e, i) => {
      const c = e.child;
      const span = c.steps.length ? 0.22 : 0.07;
      const t = smooth((p - (c.run - span)) / span);
      const st = c.status === SUCCESS ? 2 : c.status === RUNNING || t > 0 ? 1 : 0;
      edgeStates[i * 4] = t * e.len;
      edgeStates[i * 4 + 1] = st;
      edgeStates[i * 4 + 2] = e.len;
      edgeStates[i * 4 + 3] = (c.index * 173) % 460;
    });
    layer?.setEdgeStates(edgeStates);

    // blackboard: the latest value per key, in the order they were written
    const latest = new Map<string, HTMLElement>();
    for (const r of bbRows) if (Number(r.dataset.at) <= p) latest.set(r.dataset.key!, r);
    let shown = 0;
    let newest: HTMLElement | null = null;
    let newestAt = -1;
    for (const r of bbRows) {
      const on = latest.get(r.dataset.key!) === r;
      if (on) {
        shown++;
        const at = Number(r.dataset.at);
        if (at > newestAt) {
          newestAt = at;
          newest = r;
        }
      }
      if (r.hidden === on) {
        r.hidden = !on;
        if (on && forward && p - Number(r.dataset.at) < 0.25 && !reduced) {
          r.animate([{ backgroundColor: "rgba(245,158,11,.32)" }, { backgroundColor: "rgba(245,158,11,0)" }], { duration: 1600, easing: "ease-out" });
        }
      }
    }
    for (const r of bbRows) r.classList.toggle("latest", r === newest);
    bb.classList.toggle("empty", shown === 0);
    const count = shown ? `${shown} ${shown === 1 ? "key" : "keys"}` : "";
    if (bbCount.textContent !== count) bbCount.textContent = count;
    if (newest && newest !== lastNewest) {
      lastNewest = newest;
      const row = newest;
      // keep the newest value in view; read layout next frame, before anything is written
      requestAnimationFrame(() => {
        const listEl = row.parentElement!;
        const top = row.offsetTop - listEl.clientHeight + row.offsetHeight + 8;
        if (top > listEl.scrollTop) listEl.scrollTop = top;
      });
    }
    lastP = p;
    void now;
  }
  let lastNewest: HTMLElement | null = null;

  function updateRobot(dt: number) {
    const k = Math.min(LAST, Math.floor(p));
    const f = p - k;
    const o = { x: 0, y: 0, a: 0 };
    const r = routes.get(k);
    if (r && k <= 12) {
      const e = reduced ? (f > 0.15 ? 1 : 0) : ease((f - 0.02) / 0.25);
      along(r.pts, r.cum, e * r.len, o);
    } else {
      // parked at the station of whatever node the tick is on
      const n = focusOf(k);
      const s = station(n, edgeOf, mode);
      o.x = s.x;
      o.y = s.y;
      o.a = 0;
      // keep the heading it arrived with
      for (let kk = Math.min(12, k); kk >= 1; kk--) {
        const rr = routes.get(kk);
        if (rr) {
          along(rr.pts, rr.cum, rr.len, o);
          o.x = s.x;
          o.y = s.y;
          break;
        }
      }
    }
    const dist = Math.hypot(o.x - prevPose.x, o.y - prevPose.y);
    pose.speed = dt > 0 ? dist / dt : 0;
    prevPose = { x: o.x, y: o.y };
    pose.x = o.x;
    pose.y = o.y;
    // smooth the heading a touch so corners read as turns
    let da = o.a - pose.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    pose.a += reduced ? da : da * Math.min(1, dt * 14);
    pose.scale = mode === "wide" ? 1.3 : 0.78;
    const focus = focusOf(p);
    pose.led = LED[focus.status];
  }

  function updateFrames(dt: number) {
    const list: FrameData[] = [];
    const cur = focusOf(p);
    const pad = mode === "wide" ? 26 : 7;
    for (const n of nodes) {
      if (!n.steps.length) continue;
      const target = n === cur && p >= 0.6 && p < LAST ? 1 : 0;
      const prev = focusLevel.get(n) ?? 0;
      const lv = reduced ? target : prev + (target - prev) * Math.min(1, dt * 6);
      focusLevel.set(n, lv);
      let sub = coreCache.get(n);
      if (!sub) {
        sub = core(n);
        coreCache.set(n, sub);
      }
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const m of sub) {
        x0 = Math.min(x0, m.ax);
        y0 = Math.min(y0, m.ay);
        x1 = Math.max(x1, m.ax + m.w);
        y1 = Math.max(y1, m.ay + m.h);
      }
      list.push({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, state: n.status, focus: lv });
    }
    layer!.setFrames(list);
  }

  function updateChrome() {
    // the opening card slides away as the first tick goes out
    const hf = clamp(p / 0.32, 0, 1);
    hero.style.opacity = String(1 - hf);
    hero.style.transform = hf ? `translate3d(0,${(-36 * hf).toFixed(1)}px,0)` : "";
    const heroGone = hf >= 1;
    if (hero.inert !== heroGone) {
      hero.inert = heroGone;
      hero.style.visibility = heroGone ? "hidden" : "";
    }
    stage!.classList.toggle("ticking", p > 0.45);
    const of = clamp((p - (LAST + 0.25)) / 0.3, 0, 1);
    outro.style.opacity = String(of);
    outro.style.transform = `translate3d(0,${((1 - of) * 16).toFixed(1)}px,0)`;
    outro.classList.toggle("on", of > 0.01);

    const k = Math.min(LAST, Math.floor(p + 0.0001));
    const stepIdx = k >= 13 ? 13 : k === 11 ? 10 : k;
    const btn = tickBtns.find((b) => Number(b.dataset.step) === stepIdx) ?? tickBtns[0];
    if (!btn.hasAttribute("aria-current")) {
      tickBtns.forEach((b) => b.removeAttribute("aria-current"));
      btn.setAttribute("aria-current", "step");
      dockYear.textContent = btn.dataset.year ?? "";
      dockLabel.textContent = btn.textContent ?? "";
    }
    dock.style.setProperty("--p", (Math.min(p, LAST) / LAST).toFixed(4));
    recenterBtn.hidden = !(Math.abs(user.x) > 1 || Math.abs(user.y) > 1 || Math.abs(user.z - 1) > 0.01);
  }

  const playingVids = new Set<HTMLVideoElement>();
  function updateVideos() {
    if (reduced) return;
    const cur = focusOf(p);
    const want: { v: HTMLVideoElement; d: number }[] = [];
    for (const n of nodes) {
      if (n.type !== "project" || !isShown(n) || !n.vis || n.status === IDLE) continue;
      let inFocus = false;
      for (let a: BTNode | null = n; a; a = a.parent) if (a === cur) inFocus = true;
      if (!inFocus) continue;
      cam.project(n.ax + n.w / 2, n.ay + n.h / 2, proj);
      if (proj.s < 0.5 || proj.x < 0 || proj.x > W || proj.y < 0 || proj.y > H) continue;
      want.push({ v: n.el.querySelector("video")!, d: Math.abs(proj.y - H / 2) });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set(want.slice(0, 2).map((w) => w.v));
    for (const v of keep) {
      if (!playingVids.has(v)) {
        if (!v.src && v.dataset.src) v.src = v.dataset.src;
        v.play().catch(() => {});
        playingVids.add(v);
      }
    }
    for (const v of Array.from(playingVids)) {
      if (!keep.has(v)) {
        v.pause();
        playingVids.delete(v);
      }
    }
  }

  // ── interaction ──
  function setPlaying(on: boolean) {
    playing = on;
    for (const b of playBtns) {
      b.classList.toggle("is-playing", on);
      const use = b.querySelector("use");
      if (b.classList.contains("dock-play")) {
        use?.setAttribute("href", on ? "#g-pause" : "#g-play");
        b.setAttribute("aria-label", on ? "Pause" : "Play");
      }
    }
    if (on) kick();
  }

  function goto(k: number) {
    setPlaying(false);
    const target = k <= 0 ? 0 : Math.min(END - 0.05, k + 0.42);
    scrollTo({ top: secTop + target * stepH, behavior: reduced ? "auto" : "smooth" });
  }
  const current = () => Math.round(clamp(p - 0.42, 0, LAST));

  for (const b of playBtns)
    b.addEventListener("click", () => {
      if (playing) return setPlaying(false);
      if (pt >= END - 0.06) {
        scrollTo(0, secTop);
        pt = 0;
      } else if (b.closest(".hero") && pt < 0.05) pt = 0;
      lastT = performance.now();
      setPlaying(true);
    });
  dock.querySelector("[data-act=prev]")!.addEventListener("click", () => goto(current() - 1));
  dock.querySelector("[data-act=next]")!.addEventListener("click", () => goto(current() + 1));
  recenterBtn.addEventListener("click", () => recenter());
  for (const b of tickBtns) b.addEventListener("click", () => goto(Number(b.dataset.step)));
  bbToggle.addEventListener("click", () => {
    const open = !bb.classList.contains("open");
    bb.classList.toggle("open", open);
    bbToggle.setAttribute("aria-expanded", String(open));
  });

  function recenter() {
    userAnim = { from: { ...user }, t0: performance.now() };
    kick();
  }

  function toggle(n: BTNode) {
    n.open = !n.open;
    const li = n.el.parentElement!;
    li.classList.toggle("closed", !n.open);
    const btn = n.el.querySelector<HTMLButtonElement>(".more")!;
    btn.setAttribute("aria-expanded", String(n.open));
    btn.querySelector("span")!.textContent = n.open ? "−" : "+";
    for (const k of subtree(n)) if (k !== n) k.el.classList.toggle("entering", n.open);
    measure();
    relayout(true);
    requestAnimationFrame(() => {
      for (const k of subtree(n)) k.el.classList.remove("entering");
    });
    if (n.open && mode === "wide") {
      // look at what just opened
      const base = baseView(p, { ...view });
      const r = boundsOf(subtree(n));
      const fa = freeArea(5);
      const z = Math.min(1.04, (fa.r - fa.l) / (r.x1 - r.x0 + 80));
      const cxBoard = (r.x0 + r.x1) / 2;
      userAnim = null;
      const from = { ...user };
      const to = { x: cxBoard - base.x, y: (r.y0 + r.y1) / 2 - base.y, z: z / base.zoom };
      const t0 = performance.now();
      const step = () => {
        const t = clamp((performance.now() - t0) / 450, 0, 1);
        const e = ease(t);
        user.x = lerp(from.x, to.x, e);
        user.y = lerp(from.y, to.y, e);
        user.z = Math.exp(lerp(Math.log(from.z), Math.log(to.z), e));
        kick();
        if (t < 1) requestAnimationFrame(step);
      };
      step();
    } else if (!n.open) recenter();
  }

  // drag to pan, pinch / ctrl+wheel to zoom
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  let pinch: { d: number; mx: number; my: number } | null = null;
  const isUI = (t: EventTarget | null) => t instanceof Element && !!t.closest("a, button, .bb, .dock, .hero, video, input");

  function panBy(dx: number, dy: number, fromX: number, fromY: number) {
    const a = cam.unproject(fromX, fromY);
    const b = cam.unproject(fromX + dx, fromY + dy);
    if (!a || !b) return;
    user.x -= b.x - a.x;
    user.y -= b.y - a.y;
    userAnim = null;
    lastInput = performance.now();
    kick();
  }
  function zoomAt(factor: number, sx: number, sy: number) {
    const before = cam.unproject(sx, sy);
    const base = view.zoom / user.z;
    user.z = clamp(user.z * factor, 0.08 / base, 2.2 / base);
    userAnim = null;
    baseView(p, view);
    view.x += user.x;
    view.y += user.y;
    view.zoom = clamp(view.zoom * user.z, 0.06, 2.4);
    cam.set(view, W, H, view.cx, view.cy);
    const after = cam.unproject(sx, sy);
    if (before && after) {
      user.x += before.x - after.x;
      user.y += before.y - after.y;
    }
    lastInput = performance.now();
    kick();
  }

  stage.addEventListener("pointerdown", (e) => {
    if (playing && !isUI(e.target)) setPlaying(false);
    lastInput = performance.now();
    if (isUI(e.target) && !(e.target as Element).closest(".node")) return;
    if ((e.target as Element).closest("a, button, video")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
    }
  });
  stage.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const rect = stage.getBoundingClientRect();
    const cur = { x: e.clientX, y: e.clientY };
    if (pinch && pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      zoomAt(d / pinch.d, mx - rect.left, my - rect.top);
      panBy(mx - pinch.mx, my - pinch.my, pinch.mx - rect.left, pinch.my - rect.top);
      pinch = { d, mx, my };
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    if (!drag.moved) {
      const tx = cur.x - drag.x;
      const ty = cur.y - drag.y;
      if (Math.hypot(tx, ty) < 5) return;
      // on touch, vertical moves belong to the page scroll
      if (e.pointerType !== "mouse" && Math.abs(ty) > Math.abs(tx)) {
        pointers.delete(e.pointerId);
        drag = null;
        return;
      }
      drag.moved = true;
      stage.classList.add("dragging");
      stage.setPointerCapture(e.pointerId);
    }
    pointers.set(e.pointerId, cur);
    panBy(e.pointerType === "mouse" ? dx : dx, e.pointerType === "mouse" ? dy : 0, prev.x - rect.left, prev.y - rect.top);
  });
  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) {
        // swallow the click that ends a drag
        const stop = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
      }
      drag = null;
      stage.classList.remove("dragging");
    }
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener(
    "wheel",
    (e) => {
      lastInput = performance.now();
      if (playing) setPlaying(false);
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * 0.0028), e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );
  // a click on a card with something folded inside opens it
  list.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".node");
    if (!el || (e.target as Element).closest("a, button")) return;
    const n = nodes.find((m) => m.el === el);
    if (!n) return;
    if (n.collapsible) toggle(n);
    else if (n.type === "project") {
      const v = el.querySelector("video")!;
      openViewer(v, el.querySelector(".node-title")!.textContent ?? "");
    }
  });

  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as Element;
    if (t.closest("input, textarea, select, dialog, .gallery")) return;
    const r = section.getBoundingClientRect();
    if (r.bottom < H * 0.5 || r.top > 1) return;
    lastInput = performance.now();
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      goto(current() + 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      if (current() <= 0 && pt < 0.05) return;
      e.preventDefault();
      goto(current() - 1);
    } else if (e.key === "Escape") setPlaying(false);
  });
  // keyboard users: tabbing into a card brings its chapter on screen
  list.addEventListener("focusin", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".node");
    const n = el && nodes.find((m) => m.el === el);
    if (!n) return;
    let a: BTNode | null = n;
    while (a && !a.steps.length) a = a.parent;
    const k = a ? a.steps[0] : 0;
    if (Math.round(clamp(p - 0.42, 0, LAST)) !== k) {
      setPlaying(false);
      scrollTo(0, secTop + (k <= 0 ? 0 : k + 0.42) * stepH);
    }
  });
  addEventListener("touchstart", () => {
    lastInput = performance.now();
    if (playing) setPlaying(false);
  }, { passive: true });

  addEventListener(
    "scroll",
    () => {
      readScroll();
      lastInput = performance.now();
      kick();
    },
    { passive: true },
  );
  let rt = 0;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = window.setTimeout(resize, 120);
  });
  new IntersectionObserver((ents) => {
    for (const en of ents) inView = en.isIntersecting;
    if (inView) kick();
  }).observe(section);
  document.fonts?.ready.then(() => {
    measure();
    relayout(false);
  });

  html.classList.add("board-on");
  resize();
  hero.style.opacity = "1";
  kick();

  return {
    attach(l: Layer) {
      layer = l;
      l.resize(W, H);
      l.setGraph(edges, bounds);
      stage.classList.add(`has-${l.kind}`);
      dirty = true;
      kick();
    },
  };
}

/** big clip viewer */
function openViewer(v: HTMLVideoElement, title: string) {
  const dlg = document.querySelector<HTMLDialogElement>("dialog.viewer");
  if (!dlg) return;
  const media = dlg.querySelector(".viewer-media")!;
  media.innerHTML = "";
  const big = document.createElement("video");
  big.muted = true;
  big.loop = true;
  big.playsInline = true;
  big.controls = true;
  big.poster = v.poster;
  big.src = v.dataset.src ?? v.src;
  media.append(big);
  dlg.querySelector(".viewer-cap")!.textContent = title;
  dlg.showModal();
  big.play().catch(() => {});
}
