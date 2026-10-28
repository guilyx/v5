import * as THREE from "three";
import { H, type Maze, W } from "./layout";
import { solidAt } from "./floor";
import { drawTag, lineClear } from "./sensors";
import { TROLLEY } from "./props";

/**
 * How M4 finds a trolley precisely enough to drive under it, two ways.
 *
 * LiDAR + ICP: the legs carry retro-reflective tape, so their returns come back bright. One
 * sweep of the front LiDAR, keep the bright returns, and align a model of the four legs to them
 * with point-to-point ICP, starting from where the map says the trolley should be. A few mm.
 *
 * Camera: find the legs' feet in the image, cast each pixel's ray down to the floor, and fit the
 * leg template to those floor points (a ground-plane PnP). Pixel noise grows with distance, so
 * the robot looks once from afar, drives closer, and looks again. A centimetre or two.
 */

export interface Pose2 {
  x: number;
  z: number;
  yaw: number;
}

const T = TROLLEY;
/** leg centres in the trolley's frame, in the order Trolley.legs() reports them */
export const TEMPLATE: [number, number][] = [
  [T.legX, -T.legZ],
  [T.legX, T.legZ],
  [-T.legX, -T.legZ],
  [-T.legX, T.legZ],
];
const LEG_NAMES = ["leg 1", "leg 2", "leg 3", "leg 4"];

/** the legs as a point cloud: a ring of points around each one, what ICP aligns, with their outward normals */
const RING = 24;
const MODEL: [number, number][] = TEMPLATE.flatMap(([x, z]) =>
  Array.from({ length: RING }, (_, i): [number, number] => [x + Math.cos((i / RING) * Math.PI * 2) * T.legR, z + Math.sin((i / RING) * Math.PI * 2) * T.legR]),
);
const NORMAL: number[] = TEMPLATE.flatMap(() => Array.from({ length: RING }, (_, i) => (i / RING) * Math.PI * 2));

const apply = (p: Pose2, x: number, z: number): [number, number] => {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [p.x + x * c - z * s, p.z + x * s + z * c];
};
const gauss = (rand: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** the rigid transform that best maps src (a frame's points) onto dst (world points): 2D Kabsch */
function fit(src: [number, number][], dst: [number, number][]): Pose2 {
  const n = src.length;
  let psx = 0;
  let psz = 0;
  let qsx = 0;
  let qsz = 0;
  for (let i = 0; i < n; i++) {
    psx += src[i][0];
    psz += src[i][1];
    qsx += dst[i][0];
    qsz += dst[i][1];
  }
  psx /= n;
  psz /= n;
  qsx /= n;
  qsz /= n;
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - psx;
    const pz = src[i][1] - psz;
    const qx = dst[i][0] - qsx;
    const qz = dst[i][1] - qsz;
    dot += px * qx + pz * qz;
    cross += px * qz - pz * qx;
  }
  const yaw = Math.atan2(cross, dot);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: qsx - (psx * c - psz * s), z: qsz - (psx * s + psz * c), yaw };
}

/* ------------------------------------------------------------------ LiDAR */

export interface ScanPoint {
  x: number;
  z: number;
  hot: boolean;
}

/**
 * One sweep of the front LiDAR (270°): legs are circles (exact ray intersections, bright), and the
 * rest of the world is the grid, marched. The trolley's own cell is blocked for the planner only.
 */
export function denseScan(m: Maze, ox: number, oz: number, heading: number, legs: [number, number][], centre: [number, number], rand: () => number) {
  const out: ScanPoint[] = [];
  const fov = Math.PI * 1.5;
  const n = 540;
  for (let i = 0; i < n; i++) {
    const a = heading - fov / 2 + (fov * i) / (n - 1);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let best = Infinity;
    let hot = false;
    for (const [lx, lz] of legs) {
      const fx = ox - lx;
      const fz = oz - lz;
      const b = fx * dx + fz * dz;
      const disc = b * b - (fx * fx + fz * fz - T.legR * T.legR);
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0.05 && t < best) {
        best = t;
        hot = true;
      }
    }
    for (let t = 0.12; t < Math.min(best, 6); t += 0.02) {
      const wx = ox + dx * t;
      const wz = oz + dz * t;
      if ((wx - centre[0]) ** 2 + (wz - centre[1]) ** 2 < 0.8) continue;
      if (solidAt(m, wx + W / 2, wz + H / 2) > 0.25) {
        best = t;
        hot = false;
        break;
      }
    }
    if (best > 6) continue;
    const r = best + gauss(rand) * 0.006;
    out.push({ x: ox + dx * r, z: oz + dz * r, hot });
  }
  return out;
}

export interface IcpResult {
  pose: Pose2;
  /** the estimate after each iteration, and how well it fits */
  iters: { pose: Pose2; rmse: number; matched: number }[];
}

/**
 * Point-to-point ICP of the leg model to the bright returns, from a starting guess. A LiDAR only
 * sees the near side of a leg, so returns only pair with model points that face the sensor:
 * otherwise a thin leg's arc fits just as well on the back of the model's circle, a few cm off.
 */
export function icp(hot: ScanPoint[], init: Pose2, origin: { x: number; z: number }, maxIt = 25): IcpResult | null {
  if (hot.length < 6) return null;
  let pose = { ...init };
  const iters: IcpResult["iters"] = [];
  const facing = (p: Pose2) => {
    const out: { k: number; x: number; z: number }[] = [];
    for (let k = 0; k < MODEL.length; k++) {
      const [wx, wz] = apply(p, MODEL[k][0], MODEL[k][1]);
      const a = NORMAL[k] + p.yaw;
      if (Math.cos(a) * (origin.x - wx) + Math.sin(a) * (origin.z - wz) > 0) out.push({ k, x: wx, z: wz });
    }
    return out;
  };
  const err = (p: Pose2) => {
    const vis = facing(p);
    let e = 0;
    for (const h of hot) {
      let bd = Infinity;
      for (const m of vis) bd = Math.min(bd, (m.x - h.x) ** 2 + (m.z - h.z) ** 2);
      e += bd;
    }
    return Math.sqrt(e / hot.length);
  };
  iters.push({ pose: { ...pose }, rmse: err(pose), matched: 0 });
  for (let it = 0; it < maxIt; it++) {
    // each bright return pairs with the nearest model point it could have hit, if that's near enough to be its leg
    const vis = facing(pose);
    const src: [number, number][] = [];
    const dst: [number, number][] = [];
    for (const h of hot) {
      let bd = Infinity;
      let bm = -1;
      for (const m of vis) {
        const d = (m.x - h.x) ** 2 + (m.z - h.z) ** 2;
        if (d < bd) {
          bd = d;
          bm = m.k;
        }
      }
      if (bd < 0.3 * 0.3) {
        src.push(MODEL[bm]);
        dst.push([h.x, h.z]);
      }
    }
    if (src.length < 6) return null;
    const next = fit(src, dst);
    const moved = Math.hypot(next.x - pose.x, next.z - pose.z) + Math.abs(angleDiff(next.yaw, pose.yaw)) * 0.5;
    pose = next;
    iters.push({ pose: { ...pose }, rmse: err(pose), matched: src.length });
    if (moved < 2e-5) break;
  }
  return { pose, iters };
}

/* ------------------------------------------------------------------ camera */

export interface Keypoint {
  name: string;
  /** where the pixel's ray meets the floor: the leg's foot, as the camera measured it */
  x: number;
  z: number;
}
export interface CamResult {
  pose: Pose2;
  keypoints: Keypoint[];
  /** a rough 1-sigma of the position, from the pixel noise and the range */
  sigma: number;
}

const IMG_H = 400;
/** pixel noise of the keypoint detector, in a 640 × 400 image */
const PX = 1.2;

export function cameraEstimate(cam: THREE.PerspectiveCamera, m: Maze, legs: [number, number][], rand: () => number): CamResult | null {
  const imgW = IMG_H * cam.aspect;
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const src: [number, number][] = [];
  const dst: [number, number][] = [];
  const keypoints: Keypoint[] = [];
  let range = 0;
  legs.forEach(([lx, lz], i) => {
    const foot = new THREE.Vector3(lx, 0.02, lz);
    if (!lineClear(m, cam.position, foot)) return;
    v.copy(foot).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.1) return;
    v.copy(foot).project(cam);
    if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return;
    // the detector finds the foot to within a pixel or so
    const u = ((v.x + 1) / 2) * imgW + gauss(rand) * PX;
    const w = ((1 - v.y) / 2) * IMG_H + gauss(rand) * PX;
    // and its ray goes back down to the floor
    v.set((u / imgW) * 2 - 1, 1 - (w / IMG_H) * 2, 0.5).unproject(cam);
    dir.copy(v).sub(cam.position).normalize();
    if (dir.y > -1e-3) return;
    const t = (0.02 - cam.position.y) / dir.y;
    const gx = cam.position.x + dir.x * t;
    const gz = cam.position.z + dir.z * t;
    src.push(TEMPLATE[i]);
    dst.push([gx, gz]);
    keypoints.push({ name: LEG_NAMES[i], x: gx, z: gz });
    range = Math.max(range, Math.hypot(lx - cam.position.x, lz - cam.position.z));
  });
  if (src.length < 3) return null;
  const f = IMG_H / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  return { pose: fit(src, dst), keypoints, sigma: (range * range * PX) / (f * cam.position.y) / Math.sqrt(src.length) };
}

/* ------------------------------------------------------------------ what it looks like */

const COL_SCAN = new THREE.Color("#e4572e");
const COL_HOT = new THREE.Color("#f3fdff");
const COL_ICP = "#e8850f";
const COL_OK = "#2f8f5b";
const COL_CAM = "#3a6bf0";

export interface DockLabel {
  title: string;
  lines: string[];
  color: string;
}

/** the docking perception, drawn in the scene: the scan, the leg clusters, ICP's guesses, the camera's estimate */
export class DockFx {
  group = new THREE.Group();
  private scan: THREE.Points;
  private scanPos: THREE.BufferAttribute;
  private scanCol: THREE.BufferAttribute;
  private scanMat: THREE.PointsMaterial;
  private model: THREE.LineSegments;
  private modelMat: THREE.LineBasicMaterial;
  private box: THREE.LineSegments;
  private boxMat: THREE.LineBasicMaterial;
  private icpRun: { res: IcpResult; t0: number } | null = null;
  private fadeAt = 0;
  private now = 0;
  label: DockLabel | null = null;
  keypoints: Keypoint[] = [];
  /** where the label sits */
  at = new THREE.Vector3();
  /** seconds per ICP iteration, as shown */
  readonly step = 0.32;

  constructor() {
    const max = 600;
    const g = new THREE.BufferGeometry();
    this.scanPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.scanCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    g.setAttribute("position", this.scanPos);
    g.setAttribute("color", this.scanCol);
    g.setDrawRange(0, 0);
    // drawn over everything: the scan is at leg height, under the basket
    this.scanMat = new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, depthWrite: false, depthTest: false });
    this.scan = new THREE.Points(g, this.scanMat);
    this.scan.frustumCulled = false;
    this.scan.renderOrder = 5;

    // the leg model: four circles and the rectangle between them, in the trolley's frame
    const pts: number[] = [];
    const seg = (a: [number, number], b: [number, number]) => pts.push(a[0], 0, a[1], b[0], 0, b[1]);
    for (const [x, z] of TEMPLATE)
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2;
        seg([x + Math.cos(a0) * 0.07, z + Math.sin(a0) * 0.07], [x + Math.cos(a1) * 0.07, z + Math.sin(a1) * 0.07]);
      }
    const [a, b, c, d] = TEMPLATE;
    seg(a, b);
    seg(b, d);
    seg(d, c);
    seg(c, a);
    seg([0, -0.1], [0, 0.1]);
    seg([-0.1, 0], [0.1, 0]);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.modelMat = new THREE.LineBasicMaterial({ color: COL_ICP, transparent: true, depthTest: false });
    this.model = new THREE.LineSegments(mg, this.modelMat);
    this.model.renderOrder = 6;
    this.model.visible = false;

    // the camera's estimate: the trolley's outline, as a wire box
    const bg = new THREE.EdgesGeometry(new THREE.BoxGeometry(T.halfL * 2, 1.1, T.halfD * 2).translate(0, 0.55, 0));
    this.boxMat = new THREE.LineBasicMaterial({ color: COL_CAM, transparent: true, depthTest: false });
    this.box = new THREE.LineSegments(bg, this.boxMat);
    this.box.renderOrder = 6;
    this.box.visible = false;
    this.group.add(this.scan, this.model, this.box);
  }

  private place(o: THREE.Object3D, p: Pose2, y: number) {
    o.position.set(p.x, y, p.z);
    o.rotation.set(0, -p.yaw, 0);
  }

  say(title: string, lines: string[], color = COL_CAM) {
    this.label = { title, lines, color };
  }

  showScan(pts: ScanPoint[], y: number) {
    const n = Math.min(pts.length, this.scanPos.count);
    for (let i = 0; i < n; i++) {
      this.scanPos.setXYZ(i, pts[i].x, y, pts[i].z);
      const c = pts[i].hot ? COL_HOT : COL_SCAN;
      this.scanCol.setXYZ(i, c.r, c.g, c.b);
    }
    this.scan.geometry.setDrawRange(0, n);
    this.scanPos.needsUpdate = true;
    this.scanCol.needsUpdate = true;
    this.scanMat.opacity = 1;
    this.fadeAt = 0;
  }

  showIcp(res: IcpResult) {
    this.icpRun = { res, t0: -1 };
    this.model.visible = true;
    this.modelMat.color.set(COL_ICP);
    this.box.visible = false;
    this.keypoints = [];
  }
  get icpDuration() {
    return this.icpRun ? this.icpRun.res.iters.length * this.step + 0.4 : 0;
  }

  showCamera(r: CamResult, stage: number) {
    this.icpRun = null;
    this.model.visible = false;
    this.box.visible = true;
    this.place(this.box, r.pose, 0.002);
    this.keypoints = r.keypoints;
    this.say(`Camera · look ${stage} of 2`, [
      `${r.keypoints.length} leg keypoints → floor rays → pose`,
      `x ${r.pose.x.toFixed(3)}  z ${r.pose.z.toFixed(3)}  θ ${THREE.MathUtils.radToDeg(r.pose.yaw).toFixed(1)}°`,
      `± ${(r.sigma * 1000).toFixed(0)} mm, ${stage === 1 ? "closer will be better" : "good enough to go under"}`,
    ]);
  }

  /** how the docking went, measured against where the trolley really is */
  result(method: string, offset: number, dyaw: number, what = "Centred under it") {
    this.say(
      `${method} · docked`,
      [`${what}: ${(offset * 1000).toFixed(0)} mm off, ${Math.abs(THREE.MathUtils.radToDeg(dyaw)).toFixed(1)}° off`],
      COL_OK,
    );
    this.modelMat.color.set(COL_OK);
    this.boxMat.color.set(COL_OK);
    this.fadeAt = this.now + 3.5;
  }

  clear() {
    this.label = null;
    this.keypoints = [];
    this.icpRun = null;
    this.model.visible = false;
    this.box.visible = false;
    this.scan.geometry.setDrawRange(0, 0);
    this.boxMat.color.set(COL_CAM);
    this.boxMat.opacity = this.modelMat.opacity = 1;
  }

  /** true while something is still animating */
  update(now: number) {
    this.now = now;
    let busy = false;
    const run = this.icpRun;
    if (run) {
      if (run.t0 < 0) run.t0 = now;
      const k = Math.min(run.res.iters.length - 1, Math.floor((now - run.t0) / this.step));
      const it = run.res.iters[k];
      this.place(this.model, it.pose, 0.29);
      const done = k === run.res.iters.length - 1;
      this.say(
        "LiDAR + ICP",
        [
          `iteration ${k} of ${run.res.iters.length - 1}${done ? ", converged" : ""}`,
          `${it.matched || "–"} bright returns matched · RMSE ${(it.rmse * 1000).toFixed(1)} mm`,
          `x ${it.pose.x.toFixed(3)}  z ${it.pose.z.toFixed(3)}  θ ${THREE.MathUtils.radToDeg(it.pose.yaw).toFixed(1)}°`,
        ],
        done ? COL_OK : COL_ICP,
      );
      if (done) {
        this.modelMat.color.set(COL_OK);
        this.icpRun = null;
      }
      busy = true;
    }
    if (this.fadeAt && now > this.fadeAt) {
      const f = Math.max(0, 1 - (now - this.fadeAt) / 1.2);
      this.scanMat.opacity = this.modelMat.opacity = this.boxMat.opacity = f;
      if (f <= 0) {
        this.fadeAt = 0;
        this.clear();
      } else busy = true;
    }
    return busy;
  }

  /** the label and the keypoints, on the 2D canvas over the scene */
  draw2D(k: CanvasRenderingContext2D, cam: THREE.Camera, w: number, h: number, font: string) {
    const v = new THREE.Vector3();
    const toScreen = (x: number, y: number, z: number) => {
      v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -0.05) return null;
      v.set(x, y, z).project(cam);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h] as const;
    };
    k.font = `650 11.5px ${font}`;
    k.textBaseline = "middle";
    for (const kp of this.keypoints) {
      const p = toScreen(kp.x, 0.02, kp.z);
      if (!p) continue;
      k.strokeStyle = COL_CAM;
      k.lineWidth = 2;
      k.beginPath();
      k.arc(p[0], p[1], 6, 0, Math.PI * 2);
      k.stroke();
      k.fillStyle = "#fffaf1";
      k.beginPath();
      k.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
      k.fill();
      const tw = k.measureText(kp.name).width;
      k.fillStyle = "rgba(43,33,24,0.72)";
      k.beginPath();
      k.roundRect(p[0] + 9, p[1] - 9, tw + 10, 18, 5);
      k.fill();
      k.fillStyle = "#fffaf1";
      k.fillText(kp.name, p[0] + 14, p[1] + 0.5);
    }
    const L = this.label;
    if (!L) return;
    const p = toScreen(this.at.x, this.at.y, this.at.z);
    if (p) drawTag(k, p[0], p[1], L.title, L.lines, L.color, w, h, font);
  }

  get active() {
    return !!this.label || this.keypoints.length > 0;
  }
}

export { apply as poseApply, fit as fitPose };
