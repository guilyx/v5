import { AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { Frame, Level } from "./kit";
import { col, C, loadTexture } from "./kit";
import { focusAt } from "./world";
import type { V3 } from "./world";
import { Earth } from "./earth";
import { Gulf } from "./gulf";
import { Sea } from "./sea";
import { Drone } from "./drone";
import { Board } from "./board";
import { Chip } from "./chip";
import { Maze } from "./maze";

export interface View {
  w: number;
  h: number;
  /** the free area's centre (CSS px): the zoom point sits here */
  fx: number;
  fy: number;
  /** CSS px that 10^s metres span */
  ref: number;
  dpr: number;
  mobile: boolean;
}

interface Tag {
  el: HTMLElement;
  level: Level;
  at: Vector3;
  sLow: number;
  sHigh: number;
  /** optional extra visibility test (e.g. the far side of the globe) */
  test?: () => boolean;
  shown: number;
}

/** camera distance to the focal plane, in view units */
const D = 2.5;

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.02, 6000);
  readonly levels: Level[] = [];
  private tags: Tag[] = [];
  private view!: View;
  private pointerPx: { x: number; y: number } | null = null;
  private down: { x: number; y: number; moved: number } | null = null;
  private earth!: Earth;
  private last: Frame | null = null;
  private dirty = true;
  /** cost meter: ms of main-thread work per drawn frame (scene update, render submit), smoothed */
  stats = { cpu: 0, update: 0, submit: 0, calls: 0, tris: 0, frames: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
    private stops: { id: string; s: number }[],
    private tagLayer: HTMLElement,
    private reduced: boolean,
    private kick: () => void,
    dpr: number,
  ) {
    this.renderer = new WebGLRenderer({ canvas, context, antialias: dpr < 1.5, powerPreference: "high-performance", stencil: false });
    this.renderer.setClearColor(col(C.paper2), 1);
    this.camera.position.set(0, 0, D);
    this.camera.lookAt(0, 0, 0);
    // one light rig for every level: soft sky, a sun from the upper left
    const sun = new DirectionalLight(0xffffff, 2.1);
    sun.position.set(-0.55, 0.75, 1.15);
    this.scene.add(sun, new AmbientLight(0xffffff, 0.55), new HemisphereLight(0xfff6e6, 0x403a33, 0.5));
    this.bindPointer();
  }

  async init() {
    const [earthTex, gulfTex, bayTex] = await Promise.all([
      loadTexture("/geo/earth.png"),
      loadTexture("/geo/gulf.png"),
      loadTexture("/geo/bay.png"),
    ]);
    this.earth = new Earth(earthTex);
    const levels = [this.earth, new Gulf(gulfTex, bayTex), new Sea(bayTex), new Drone(), new Board(this.view.mobile), new Chip(this.view.mobile), new Maze(this.reduced)];
    for (const l of levels) {
      this.levels.push(l);
      this.scene.add(l.group);
      l.group.visible = false;
    }
    for (const l of levels) for (const t of l.tags()) this.tag(l, t.at, t.text, t.sLow, t.sHigh, t.cls, t.test);
    // compile everything up front so the first trip down doesn't hitch
    for (const l of levels) l.group.visible = true;
    this.renderer.compile(this.scene, this.camera);
    for (const l of levels) l.group.visible = false;
  }

  private tag(level: Level, at: V3, text: string, sLow: number, sHigh: number, cls: string, test?: () => boolean) {
    const el = document.createElement("div");
    el.className = `tag ${cls}`;
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
    this.tagLayer.appendChild(el);
    this.tags.push({ el, level, at: new Vector3(...at), sLow, sHigh, test, shown: -1 });
  }

  setView(v: View) {
    const prev = this.view;
    this.view = v;
    if (!prev || prev.w !== v.w || prev.h !== v.h || prev.dpr !== v.dpr) {
      this.renderer.setPixelRatio(v.dpr);
      this.renderer.setSize(v.w, v.h, false);
    }
    // an off-axis projection puts the zoom point at the centre of the free area
    const fullW = 2 * Math.max(v.fx, v.w - v.fx);
    const fullH = 2 * Math.max(v.fy, v.h - v.fy);
    this.camera.aspect = fullW / fullH;
    this.camera.fov = (2 * Math.atan(fullH / v.ref / 2 / D) * 180) / Math.PI;
    this.camera.setViewOffset(fullW, fullH, fullW / 2 - v.fx, fullH / 2 - v.fy, v.w, v.h);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private bindPointer() {
    const c = this.canvas;
    const at = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
    c.addEventListener("pointermove", (e) => {
      const p = at(e);
      if (this.down) {
        const dx = p.x - this.down.x, dy = p.y - this.down.y;
        this.down.moved += Math.abs(dx) + Math.abs(dy);
        if (this.last && this.last.s > 6.75) {
          this.earth.drag(dx, dy, this.view.ref);
          this.dirty = true;
        }
        this.down.x = p.x;
        this.down.y = p.y;
      }
      this.pointerPx = p;
      this.kick();
    });
    c.addEventListener("pointerdown", (e) => {
      this.down = { ...at(e), moved: 0 };
      if (this.last && this.last.s > 6.75 && e.pointerType === "mouse") {
        c.setPointerCapture(e.pointerId);
        c.classList.add("grabbing");
      }
    });
    const up = (e: PointerEvent) => {
      if (this.down && this.down.moved < 8 && this.last) {
        const p = this.toFocal(at(e), this.last);
        for (const l of this.levels) if (l.group.visible && l.click(p, this.last)) break;
        this.dirty = true;
      }
      if (this.down && this.last && this.last.s > 6.75) this.earth.release();
      this.down = null;
      c.classList.remove("grabbing");
      this.kick();
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", () => {
      this.down = null;
      c.classList.remove("grabbing");
    });
    c.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") this.pointerPx = null;
      this.kick();
    });
  }

  /** a screen point projected onto the focal plane, in metres */
  private toFocal(p: { x: number; y: number }, fr: Frame): V3 {
    const u = Math.pow(10, fr.s) / this.view.ref;
    return [fr.F[0] + (p.x - this.view.fx) * u, fr.F[1] - (p.y - this.view.fy) * u, fr.F[2]];
  }

  /** Draw one frame at exponent s. Returns true while something still moves. */
  frame(s: number, dt: number, t: number): boolean {
    const t0 = performance.now();
    const F = focusAt(s, this.stops);
    const fr: Frame = { s, F, dt, t, reduced: this.reduced, ref: this.view.ref, dpr: this.view.dpr, pointer: null, camera: this.camera };
    if (this.pointerPx) fr.pointer = this.toFocal(this.pointerPx, fr);
    const moved = !this.last || this.last.s !== s || this.dirty;
    let animating = false;
    for (const l of this.levels) {
      const vis = l.visibleAt(s);
      l.group.visible = vis;
      if (!vis) continue;
      l.place(fr);
      l.update(fr);
      if (l.animating(fr)) animating = true;
    }
    // cursor hints: grab the globe, aim at the maze
    this.canvas.classList.toggle("grab", s > 6.75);
    this.canvas.classList.toggle("aim", s < -3.3);
    if (moved || animating) {
      this.scene.updateMatrixWorld();
      this.placeTags(s);
      const t1 = performance.now();
      this.renderer.render(this.scene, this.camera);
      const t2 = performance.now();
      const st = this.stats;
      st.calls = this.renderer.info.render.calls;
      st.tris = this.renderer.info.render.triangles;
      st.frames++;
      st.update = st.update * 0.9 + (t1 - t0) * 0.1;
      st.submit = st.submit * 0.9 + (t2 - t1) * 0.1;
      st.cpu = st.update + st.submit;
    }
    this.dirty = false;
    this.last = fr;
    return animating;
  }

  private v = new Vector3();
  private placeTags(s: number) {
    const { w, h } = this.view;
    for (const tg of this.tags) {
      let o = 0;
      if (tg.level.group.visible && s >= tg.sLow && s <= tg.sHigh && (!tg.test || tg.test())) {
        o = Math.min(1, (s - tg.sLow) / 0.12, (tg.sHigh - s) / 0.12);
      }
      if (o > 0.01) {
        this.v.copy(tg.at).applyMatrix4(tg.level.group.matrixWorld).project(this.camera);
        const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) o = 0;
        else tg.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      }
      const q = Math.round(o * 100) / 100;
      if (q !== tg.shown) {
        tg.el.style.opacity = String(q);
        tg.shown = q;
      }
    }
  }
}
