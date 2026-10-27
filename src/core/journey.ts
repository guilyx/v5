import * as THREE from "three";
import type { Scene } from "../scenes/types";
import { clamp, damp, smoothstep } from "./util";

interface StopRuntime {
  el: HTMLElement;
  scene: number;
  start: number; // first key index
  top: number; // scroll offset where this stop begins
}

/**
 * Scroll → flight. Every DOM stop owns a run of camera keys; scrolling through
 * the stop moves the camera through them along two centripetal Catmull-Rom
 * splines, one for position and one for where it looks. The camera chases
 * the scroll with exponential damping, so a flick of the wheel turns into a
 * glide instead of a jump.
 *
 * Each stop dwells on its own keys for most of its scroll and only spends the
 * last stretch (TRANSIT) flying to the next stop, so a panel and the scene it
 * describes are on screen together.
 */
export const TRANSIT = 0.22;
export class Journey {
  private posCurve!: THREE.CatmullRomCurve3;
  private lookCurve!: THREE.CatmullRomCurve3;
  private stops: StopRuntime[] = [];
  private sceneRange: { a: number; b: number }[] = [];
  private nKeys = 0;
  private maxScroll = 1;

  /** Damped position along the key list, in key units. */
  idx = 0;
  /** Lets the final shot pull back far enough for the whole route to fit the screen. */
  fitScale = 1;
  private target = 0;
  private velocity = 0;
  private look = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private parallax = new THREE.Vector2();
  private bank = 0;
  private prevYaw = 0;
  readonly focus: number[];
  readonly u: number[];

  constructor(
    private scenes: Scene[],
    private camera: THREE.PerspectiveCamera,
    private reduced: boolean,
  ) {
    const pos: THREE.Vector3[] = [];
    const look: THREE.Vector3[] = [];
    scenes.forEach((s, si) => {
      s.group.updateMatrixWorld(true);
      const a = pos.length;
      for (const stop of s.stops) {
        const el = document.getElementById(stop.id);
        if (!el) throw new Error(`missing stop #${stop.id}`);
        this.stops.push({ el, scene: si, start: pos.length, top: 0 });
        for (const k of stop.keys) {
          pos.push(k.world ? k.pos.clone() : s.group.localToWorld(k.pos.clone()));
          look.push(k.world ? k.look.clone() : s.group.localToWorld(k.look.clone()));
        }
      }
      this.sceneRange.push({ a, b: pos.length });
    });
    this.nKeys = pos.length;
    this.posCurve = new THREE.CatmullRomCurve3(pos, false, "centripetal");
    this.lookCurve = new THREE.CatmullRomCurve3(look, false, "centripetal");
    this.focus = scenes.map(() => 0);
    this.u = scenes.map(() => 0);
    this.measure();
    addEventListener("resize", () => this.measure());
    this.idx = this.target = this.scrollToIdx(scrollY);
    this.place(0, true);
  }

  measure() {
    for (const s of this.stops) s.top = s.el.getBoundingClientRect().top + scrollY;
    this.stops[0].top = 0;
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  }

  private scrollToIdx(y: number): number {
    const n = this.stops.length;
    for (let j = n - 1; j >= 0; j--) {
      const s = this.stops[j];
      if (y >= s.top) {
        const nextTop = j + 1 < n ? this.stops[j + 1].top : this.maxScroll;
        const nextStart = j + 1 < n ? this.stops[j + 1].start : this.nKeys - 1;
        const t = clamp((y - s.top) / Math.max(1, nextTop - s.top));
        const last = nextStart - 1; // this stop's own last key
        if (j + 1 >= n) return s.start + t * (nextStart - s.start);
        if (last <= s.start) return s.start + smoothstep(1 - TRANSIT, 1, t) * (nextStart - s.start);
        const dwell = clamp(t / (1 - TRANSIT));
        const fly = clamp((t - (1 - TRANSIT)) / TRANSIT);
        return s.start + dwell * (last - s.start) + fly * (nextStart - last);
      }
    }
    return 0;
  }

  /** Scroll offset of a stop, for menu jumps. */
  topOf(stopId: string): number | null {
    const s = this.stops.find((x) => x.el.id === stopId);
    return s ? s.top : null;
  }

  /** Overall progress 0..1, for the HUD rail. */
  get progress() {
    return this.idx / (this.nKeys - 1);
  }

  get speed() {
    return this.velocity;
  }

  activeScene(): number {
    let best = 0;
    for (let i = 0; i < this.scenes.length; i++) if (this.idx >= this.sceneRange[i].a - 0.5) best = i;
    return best;
  }

  update(dt: number, pointer: THREE.Vector2) {
    this.target = this.scrollToIdx(scrollY);
    const prev = this.idx;
    this.idx = this.reduced ? this.target : damp(this.idx, this.target, 3.2, dt);
    if (Math.abs(this.idx - this.target) < 1e-4) this.idx = this.target;
    this.velocity = dt > 0 ? (this.idx - prev) / dt : 0;

    for (let i = 0; i < this.scenes.length; i++) {
      const r = this.sceneRange[i];
      const end = i + 1 < this.scenes.length ? this.sceneRange[i + 1].a : this.nKeys - 1;
      const u = (this.idx - r.a) / Math.max(1e-3, end - r.a);
      this.u[i] = u;
      const out = Math.max(-u, u - 1, 0);
      this.focus[i] = 1 - smoothstep(0, 0.45, out);
    }
    this.place(dt, false, pointer);
  }

  private place(dt: number, snap: boolean, pointer?: THREE.Vector2) {
    const t = clamp(this.idx / (this.nKeys - 1));
    const p = this.posCurve.getPoint(t);
    this.lookTarget.copy(this.lookCurve.getPoint(t));
    p.sub(this.lookTarget).multiplyScalar(this.fitScale).add(this.lookTarget);
    if (snap || this.reduced) this.look.copy(this.lookTarget);
    else this.look.lerp(this.lookTarget, 1 - Math.exp(-8 * dt));

    if (pointer && !this.reduced) {
      this.parallax.x = damp(this.parallax.x, pointer.x, 2.5, dt);
      this.parallax.y = damp(this.parallax.y, pointer.y, 2.5, dt);
    }
    this.camera.position.copy(p);
    this.camera.lookAt(this.look);
    // a little hand-held drift and bank, so the flight has weight
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(right, this.parallax.x * 1.6).addScaledVector(upv, this.parallax.y * 0.9);
    this.camera.lookAt(this.look);

    const fwd = this.look.clone().sub(p);
    const yaw = Math.atan2(fwd.x, fwd.z);
    let dy = yaw - this.prevYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.prevYaw = yaw;
    if (!snap && dt > 0 && !this.reduced) {
      this.bank = damp(this.bank, clamp((dy / dt) * 0.08, -0.12, 0.12), 3, dt);
      this.camera.rotateZ(this.bank);
    }
  }

  /** Distance the camera has covered along the route, for the trail glow. */
  sceneRangeOf(i: number) {
    return this.sceneRange[i];
  }
}
