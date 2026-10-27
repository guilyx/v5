import * as THREE from "three";
import { STATION_X } from "./world";

/* The camera is a dolly on a rail along the desk. Scroll position maps straight to a place on
   the rail (no inertia): each chapter has a resting pose, and between two chapters the camera
   moves on a curve that lingers near each one and travels quickly between them. */

export interface Pose {
  x: number;
  z: number;
  dist: number;
  pitch: number;
  yaw: number;
  /** where the look-at point lands on screen, as fractions of the viewport */
  cx: number;
  cy: number;
}

interface Frame {
  w: number;
  d: number;
  z?: number;
  pitch?: number;
  yaw?: number;
}

/** How much desk each chapter wants in view (width, depth) and small changes of angle. */
const FRAMES: Record<string, Frame> = {
  hero: { w: 10.5, d: 8.6, z: -0.8, pitch: 0.9, yaw: -0.06 },
  school: { w: 12.5, d: 9, z: -0.6, pitch: 0.95, yaw: 0.04 },
  hiventive: { w: 11.5, d: 8.4, z: -0.5, pitch: 1.0, yaw: -0.03 },
  coimbra: { w: 12.5, d: 9, z: -0.8, pitch: 0.98, yaw: 0.05 },
  centrale: { w: 12.5, d: 9, z: -0.6, pitch: 1.02, yaw: -0.04 },
  coalescent: { w: 13, d: 9.4, z: -1.2, pitch: 0.86, yaw: 0.06 },
  tii: { w: 13, d: 9.2, z: -0.8, pitch: 0.95, yaw: -0.05 },
  lead: { w: 12, d: 8.8, z: -0.6, pitch: 1.02, yaw: 0.04 },
  unchained: { w: 12.5, d: 9, z: -0.8, pitch: 0.93, yaw: -0.04 },
  sirb: { w: 13, d: 9.2, z: -0.6, pitch: 0.98, yaw: 0.04 },
  after: { w: 19, d: 11.5, z: -0.6, pitch: 0.9, yaw: -0.02 },
};

const OVERVIEW: Pose = { x: 62, z: -2, dist: 116, pitch: 0.52, yaw: 0.74, cx: 0.5, cy: 0.54 };

const ease = (t: number) => {
  const s = t * t * t * (t * (t * 6 - 15) + 10);
  return 0.14 * t + 0.86 * s;
};

export interface Anchor {
  station: string;
  y: number;
  pose: Pose;
}

export class Rig {
  camera: THREE.PerspectiveCamera;
  anchors: Anchor[] = [];
  overviewStart = 0;
  overviewEnd = 0;
  current: Pose;
  target: Pose;
  /** pointer parallax, -1..1 */
  private par = { x: 0, y: 0, tx: 0, ty: 0 };
  private w = 1;
  private h = 1;
  mobile = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    this.current = { ...OVERVIEW };
    this.target = { ...OVERVIEW };
  }

  /** Read the chapter positions from the page. Call on resize. */
  measure(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.mobile = w < 860;
    this.camera.aspect = w / h;
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".station[data-station]"));
    const sy = window.scrollY;
    this.anchors = sections.map((el) => {
      const station = el.dataset.station!;
      const r = el.getBoundingClientRect();
      const top = r.top + sy;
      let y = top + r.height / 2 - h / 2;
      if (station === "hero") y = 0;
      return { station, y: Math.max(0, y), pose: this.stationPose(station) };
    });
    const read = document.getElementById("read");
    const last = this.anchors[this.anchors.length - 1];
    const readTop = read ? read.getBoundingClientRect().top + sy : last.y + h;
    this.overviewStart = last.y + h * 0.35;
    this.overviewEnd = Math.max(this.overviewStart + 1, readTop + h * 0.15);
  }

  /** the part of the screen not covered by the paper card */
  freeRect(station = "") {
    const w = this.w;
    const h = this.h;
    if (this.mobile) {
      const top = 104;
      const bottom = h * (station === "hero" ? 0.44 : 0.5);
      return { x: 0, y: top, w, h: bottom - top };
    }
    const cardW = station === "hero" ? Math.min(592, w * 0.44) : Math.min(480, w * 0.36);
    const cardRight = 40 + cardW + 28;
    return { x: cardRight, y: 76, w: w - cardRight - 24, h: h - 76 - 92 };
  }

  stationPose(station: string, free = this.freeRect(station)): Pose {
    const f = FRAMES[station];
    const pitch = f.pitch ?? 0.96;
    const fw = this.mobile ? Math.min(f.w * 0.7, 9) : f.w;
    const fd = this.mobile ? Math.min(f.d * 0.7, 7) : f.d;
    const ppu = Math.min(free.w / fw, free.h / (fd * Math.sin(pitch) + 1.6 * Math.cos(pitch)));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = this.h / (2 * tanHalf * ppu);
    return {
      x: STATION_X[station] + (this.mobile && station === "after" ? -2.2 : 0),
      z: f.z ?? -0.7,
      dist,
      pitch,
      yaw: f.yaw ?? 0,
      cx: (free.x + free.w / 2) / this.w,
      cy: (free.y + free.h / 2) / this.h,
    };
  }

  /** The pose the page's scroll position asks for. */
  poseAt(y: number, out: Pose = { ...OVERVIEW }): Pose {
    const a = this.anchors;
    if (!a.length) return Object.assign(out, OVERVIEW);
    if (y <= a[0].y) return Object.assign(out, a[0].pose);
    const last = a[a.length - 1];
    if (y >= last.y) {
      const t = Math.min(1, Math.max(0, (y - this.overviewStart) / (this.overviewEnd - this.overviewStart)));
      return lerpPose(last.pose, OVERVIEW, t * t * (3 - 2 * t), out);
    }
    let i = 0;
    while (i < a.length - 2 && y > a[i + 1].y) i++;
    const t = (y - a[i].y) / Math.max(1, a[i + 1].y - a[i].y);
    return lerpPose(a[i].pose, a[i + 1].pose, ease(Math.min(1, Math.max(0, t))), out);
  }

  /** Inverse of poseAt along the journey: the scroll position that puts the camera at desk x. */
  scrollForX(x: number): number {
    const a = this.anchors;
    let lo = a[0].y;
    let hi = a[a.length - 1].y;
    const p = { ...OVERVIEW };
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      if (this.poseAt(mid, p).x < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** past the last chapter: the camera has pulled back to look along the whole desk */
  overview(y: number) {
    return y > this.overviewStart + 10;
  }

  setPointer(nx: number, ny: number) {
    this.par.tx = nx;
    this.par.ty = ny;
  }

  /** Move the camera toward the target pose. Returns true while it is still moving. */
  update(dt: number, snap: boolean): boolean {
    const c = this.current;
    const t = this.target;
    const k = snap ? 1 : 1 - Math.exp(-dt * 13);
    const kp = snap ? 1 : 1 - Math.exp(-dt * 5);
    let moving = false;
    for (const key of ["x", "z", "dist", "pitch", "yaw", "cx", "cy"] as const) {
      const d = t[key] - c[key];
      c[key] += d * k;
      if (Math.abs(d) > (key === "x" || key === "dist" ? 0.002 : 0.00005)) moving = true;
    }
    const p = this.par;
    p.x += (p.tx - p.x) * kp;
    p.y += (p.ty - p.y) * kp;
    if (Math.abs(p.tx - p.x) > 0.001 || Math.abs(p.ty - p.y) > 0.001) moving = true;
    if (snap) {
      p.x = 0;
      p.y = 0;
    }
    this.apply();
    return moving;
  }

  private apply() {
    const c = this.current;
    const cam = this.camera;
    const yaw = c.yaw + this.par.x * 0.035;
    const pitch = c.pitch + this.par.y * 0.02;
    const cp = Math.cos(pitch);
    cam.position.set(c.x + Math.sin(yaw) * cp * c.dist, Math.sin(pitch) * c.dist, c.z + Math.cos(yaw) * cp * c.dist);
    cam.lookAt(c.x, 0, c.z);
    cam.setViewOffset(this.w, this.h, this.w * (0.5 - c.cx), this.h * (0.5 - c.cy), this.w, this.h);
    cam.updateMatrixWorld();
  }
}

function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.dist = a.dist + (b.dist - a.dist) * t;
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.yaw = a.yaw + (b.yaw - a.yaw) * t;
  out.cx = a.cx + (b.cx - a.cx) * t;
  out.cy = a.cy + (b.cy - a.cy) * t;
  return out;
}
