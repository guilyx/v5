/**
 * The conductor. Reads the scroll position, the drag and the zoom, asks the timeline where the
 * camera should be, and draws one frame with whichever globe is available: the WebGL one, or the
 * flat Canvas 2D plate until (or unless) WebGL is there. It stops drawing when nothing moves,
 * when sheets of paper cover the globe, and when the tab is hidden.
 */
import { Timeline, type TimelineState } from "./timeline";
import { Overlay } from "./overlay";
import { Plate, type Frame } from "./plate";
import { landDots } from "./land";
import { clamp, makeCam, rotAxis, rotY, smoother, sunDir, norm, cross, type Cam, type V3 } from "./geo";
import { HERO_VIEW, LEGS, type Place } from "./places";
import type { Globe } from "./globe";

const FOV_REF = (28 * Math.PI) / 180;
export const NARROW = "(max-width: 759px), (max-aspect-ratio: 4/5)";

export interface AtlasHooks {
  openPhotos: (place: Place) => void;
  onChapter: (index: number, state: TimelineState) => void;
}

export class Atlas {
  timeline = new Timeline();
  private overlay: Overlay;
  private plate: Plate;
  private globe: Globe | null = null;
  private plateCanvas: HTMLCanvasElement;
  private glCanvas: HTMLCanvasElement;
  private stage: HTMLElement;
  private recenter: HTMLButtonElement | null;
  private W = 1;
  private H = 1;
  private narrow = false;
  private f = 1000;
  private cx = 0;
  private cy = 0;
  private dpr = 1;
  private smoothY = window.scrollY;
  private lastY = window.scrollY;
  private raf = 0;
  private last = 0;
  private lastInput = performance.now();
  private lastPlate = 0;
  private plateDirty = true;
  private start = performance.now();
  private reduced: boolean;
  private frame: Frame = { sun: sunDir(), legs: new Float32Array(LEGS.length), activeLeg: -1, time: 0, ghost: 0 };
  private drift = { hero: 0, finale: 0, speed: 0 };
  private user = { yaw: 0, pitch: 0, zoom: 1, vyaw: 0, vpitch: 0, returning: false, dragging: false };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private chapter = -2;
  private stopKey: string | null = null;
  private cam: Cam | null = null;
  private flat = false;
  /** dev-only: rolling average of CPU time per frame, in ms */
  stats = { cpu: 0, cpuTotal: 0, cpuMax: 0, frames: 0, calls: 0, triangles: 0, points: 0 };

  constructor(
    root: HTMLElement,
    private hooks: AtlasHooks,
  ) {
    this.stage = root;
    this.plateCanvas = root.querySelector<HTMLCanvasElement>("#plate")!;
    this.glCanvas = root.querySelector<HTMLCanvasElement>("#globe")!;
    this.recenter = document.querySelector<HTMLButtonElement>(".recenter");
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.timeline.reduced = this.reduced;
    if (this.reduced) this.frame.ghost = 1;
    this.plate = new Plate(this.plateCanvas, landDots());
    this.overlay = new Overlay(root, {
      onPlace: (p) => {
        if (this.user.dragging) return;
        if (p.photos) this.hooks.openPhotos(p);
        else this.goTo(p.chapter ?? p.key);
      },
    });

    this.resize();
    this.timeline.measure();
    this.bind();
    this.kick();
  }

  /** Swap the flat plate for the WebGL globe. */
  async upgrade() {
    const [{ Globe }, land] = await Promise.all([import("./globe"), Promise.resolve(landDots())]);
    try {
      this.globe = new Globe(this.glCanvas, land);
    } catch {
      return; // the plate stays
    }
    this.globe.resize(this.W, this.H, this.dpr);
    this.render(true);
    this.stage.classList.add("has-gl");
    // the flat plate has done its job; give its pixels back once the globe has faded in
    setTimeout(() => {
      this.plateCanvas.width = this.plateCanvas.height = 0;
    }, 800);
    this.kick();
  }

  /** No WebGL: the flat plate is the map. It redraws only when the view settles, so no idle spin. */
  setFlat() {
    this.flat = true;
    this.frame.ghost = 1;
    this.kick();
  }

  goTo(key: string) {
    const y = this.timeline.yFor(key);
    if (y === undefined) return;
    this.user.returning = true;
    window.scrollTo({ top: y, behavior: this.reduced ? "auto" : "smooth" });
  }

  private bind() {
    addEventListener("scroll", () => this.onScroll(), { passive: true });
    addEventListener("resize", () => {
      this.resize();
      this.timeline.measure();
      this.kick();
    });
    document.addEventListener("visibilitychange", () => this.kick());
    // the page reflows as fonts, images and clips arrive: keep the scroll keyframes honest
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        this.timeline.measure();
        this.kick();
      });
    }).observe(document.querySelector("main")!);
    setInterval(() => {
      this.frame.sun = sunDir();
      this.plateDirty = true;
      this.kick();
    }, 60_000);

    // drag to turn, with inertia
    const st = this.stage;
    st.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest(".pin, button, a")) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      st.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
      this.user.dragging = this.pointers.size === 1;
      this.user.returning = false;
      this.user.vyaw = this.user.vpitch = 0;
      st.classList.add("is-dragging");
      this.touch();
    });
    st.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size >= 2) {
        const d = this.pinchDist();
        if (this.pinch > 0 && d > 0) this.zoomBy(this.pinch / d);
        this.pinch = d;
      } else if (this.cam) {
        const k = (this.cam.d - 1) / this.cam.f;
        const touch = e.pointerType === "touch";
        const yaw = -dx * k * 1.15;
        const pitch = touch ? 0 : dy * k;
        this.user.yaw += yaw;
        this.user.pitch = clamp(this.user.pitch + pitch, -1.2, 1.2);
        const dt = Math.max(8, e.timeStamp - (this.lastMoveT || e.timeStamp - 16)) / 1000;
        this.user.vyaw = this.user.vyaw * 0.4 + (yaw / dt) * 0.6;
        this.user.vpitch = this.user.vpitch * 0.4 + (pitch / dt) * 0.6;
        this.lastMoveT = e.timeStamp;
      }
      this.touch();
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size < 2) this.pinch = 0;
      if (this.pointers.size === 0) {
        this.user.dragging = false;
        st.classList.remove("is-dragging");
        if (e.timeStamp - this.lastMoveT > 80 || e.type === "pointercancel") this.user.vyaw = this.user.vpitch = 0;
      }
      this.touch();
    };
    st.addEventListener("pointerup", end);
    st.addEventListener("pointercancel", end);

    // ctrl + wheel (and trackpad pinch) zooms; a plain wheel keeps scrolling the journey
    addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey || !st.contains(e.target as Node)) return;
        e.preventDefault();
        this.zoomBy(Math.exp(e.deltaY * 0.01));
        this.touch();
      },
      { passive: false },
    );

    this.recenter?.addEventListener("click", () => {
      this.user.returning = true;
      this.touch();
    });
  }

  private lastMoveT = 0;

  private pinchDist() {
    const [a, b] = Array.from(this.pointers.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private zoomBy(f: number) {
    this.user.returning = false;
    this.user.zoom = clamp(this.user.zoom * f, 0.45, 1.8);
  }

  private onScroll() {
    const y = window.scrollY;
    if (Math.abs(y - this.lastY) > 3 && !this.user.dragging) this.user.returning = true;
    this.lastY = y;
    this.touch();
  }

  private touch() {
    this.lastInput = performance.now();
    this.plateDirty = true;
    this.kick();
  }

  private kick() {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private resize() {
    this.W = Math.max(1, window.innerWidth);
    this.H = Math.max(1, window.innerHeight);
    // same switch as the CSS: phones, and tablets held upright, stack the globe over the card
    this.narrow = matchMedia(NARROW).matches;
    const phone = this.W < 760 || matchMedia("(pointer: coarse)").matches;
    this.dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
    if (this.globe) this.globe.resize(this.W, this.H, this.dpr);
    else this.plate.resize(this.W, this.H, this.dpr);
    this.plateDirty = true;
    this.layout();
  }

  /** Where the globe's centre sits and how big the title-page globe is; the hero's CSS reads it back. */
  private layout() {
    const { W, H } = this;
    const focalH = this.narrow ? Math.min(H, W * 1.1) : Math.min(H, W * 0.9);
    this.f = focalH / 2 / Math.tan(FOV_REF / 2);
    const heroR = Math.tan(Math.asin(1 / HERO_VIEW.d)) * this.f;
    this.cx = this.narrow ? W / 2 : W * 0.64;
    this.cy = this.narrow ? clamp(heroR + 76, H * 0.31, H * 0.45) : H * 0.53;
    document.documentElement.style.setProperty("--globe-bottom", `${Math.round(this.cy + heroR)}px`);
  }

  private makeCamera(st: TimelineState): Cam {
    const { W, H, user, drift, f, cx, cy } = this;
    const fov = 2 * Math.atan(H / 2 / f);

    let c: V3 = st.c;
    if (st.drift === "hero") c = rotY(c, drift.hero);
    else if (st.drift === "finale") c = rotY(c, drift.finale);
    if (user.yaw) c = rotY(c, user.yaw);
    if (user.pitch) {
      const right = norm(cross([0, 1, 0], c));
      c = norm(rotAxis(c, right, -user.pitch));
      if (Math.abs(c[1]) > 0.985) c = norm([c[0], Math.sign(c[1]) * 0.985, c[2]]);
    }
    const d = 1 + (st.d - 1) * user.zoom;
    return makeCam(c, d, W, H, cx, cy, fov);
  }

  private tick(now: number) {
    this.raf = 0;
    if (document.hidden) return;
    const t0 = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;

    // scroll: short smoothing only, so the globe answers the wheel straight away
    const y = window.scrollY;
    const gap = y - this.smoothY;
    if (Math.abs(gap) > this.H * 4 || this.reduced) this.smoothY = y;
    else this.smoothY += gap * (1 - Math.exp(-dt / 0.07));
    if (Math.abs(y - this.smoothY) < 0.3) this.smoothY = y;
    const scrolling = this.smoothY !== y;

    const st = this.timeline.at(this.smoothY);
    const covered = this.timeline.isCovered(this.smoothY) && this.timeline.isCovered(y);

    // drag inertia, and the drift back to the route once you scroll again
    const u = this.user;
    if (!u.dragging) {
      if (Math.abs(u.vyaw) + Math.abs(u.vpitch) > 1e-4) {
        u.yaw += u.vyaw * dt;
        u.pitch = clamp(u.pitch + u.vpitch * dt, -1.2, 1.2);
        const k = Math.exp(-dt / 0.45);
        u.vyaw *= k;
        u.vpitch *= k;
      } else u.vyaw = u.vpitch = 0;
      if (u.returning) {
        const k = Math.exp(-dt / 0.28);
        u.yaw *= k;
        u.pitch *= k;
        u.zoom = 1 + (u.zoom - 1) * k;
        u.vyaw *= k;
        u.vpitch *= k;
        if (Math.abs(u.yaw) + Math.abs(u.pitch) + Math.abs(u.zoom - 1) < 1e-4) {
          u.yaw = u.pitch = 0;
          u.zoom = 1;
          u.returning = false;
        }
      }
    }
    const offRoute = Math.abs(u.yaw) + Math.abs(u.pitch) > 0.04 || Math.abs(u.zoom - 1) > 0.04;
    this.recenter?.classList.toggle("is-shown", offRoute && !u.returning && !covered);

    // the slow turn of the globe on the title page and at the end (stops when you leave it alone)
    const idle = now - this.lastInput;
    const driftOn = !this.reduced && !this.flat && !u.dragging && st.drift !== null && idle < 25000;
    this.drift.speed += ((driftOn ? 0.045 : 0) - this.drift.speed) * (1 - Math.exp(-dt / 0.8));
    const heroTurn = st.drift === "hero" && y < 4;
    if (heroTurn) this.drift.hero += this.drift.speed * dt;
    if (st.drift === "finale") this.drift.finale += this.drift.speed * dt;
    const drifting = this.drift.speed > 1e-4 && (heroTurn || st.drift === "finale");

    // the pencilled route draws itself once, on arrival
    if (!this.reduced && !this.flat) this.frame.ghost = smoother(clamp((now - this.start - 350) / 1600, 0, 1));
    this.frame.time = now / 1000;
    this.frame.legs.set(st.legs);
    this.frame.activeLeg = st.activeLeg;

    const marching = !this.reduced && !this.flat && st.activeLeg >= 0 && idle < 6000;
    // ambient motion (the slow turn, the marching dashes, the intro) only matters while the globe is in sight
    const ambient = !covered && (drifting || this.frame.ghost < 1 || marching);
    const moving = scrolling || u.dragging || Math.abs(u.vyaw) + Math.abs(u.vpitch) > 1e-4 || u.returning || ambient;

    if (moving) this.plateDirty = true;
    if (!covered) this.render(false, st);
    if (st.chapter !== this.chapter || st.stopKey !== this.stopKey) {
      this.chapter = st.chapter;
      this.stopKey = st.stopKey;
      this.hooks.onChapter(st.chapter, st);
    }

    if (!covered) {
      const cpu = performance.now() - t0;
      this.stats.cpu = this.stats.cpu * 0.95 + cpu * 0.05;
      this.stats.cpuTotal += cpu;
      this.stats.cpuMax = Math.max(this.stats.cpuMax, cpu);
      this.stats.frames++;
    }

    if (moving || (!this.globe && this.plateDirty && !covered)) this.kick();
  }

  private render(force: boolean, st = this.timeline.at(this.smoothY)) {
    const cam = this.makeCamera(st);
    this.cam = cam;
    if (this.globe) {
      this.globe.render(cam, this.frame);
      const s = this.globe.stats();
      this.stats.calls = s.calls;
      this.stats.triangles = s.triangles;
      this.stats.points = s.points;
      this.overlay.update(cam, st);
      return;
    }
    // flat plate: redraw at most ~8 times a second while moving, and once when it settles
    const now = performance.now();
    const settled = Math.abs(window.scrollY - this.smoothY) < 0.5 && !this.user.dragging;
    if (force || (this.plateDirty && (settled || now - this.lastPlate > 120))) {
      this.plate.render(cam, this.frame);
      this.overlay.update(cam, st);
      this.lastPlate = now;
      if (settled) this.plateDirty = false;
    }
  }
}
