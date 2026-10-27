import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** One palette for the whole studio: warm white plastic, graphite, one signal yellow. */
export const PAL = {
  arm: "#f1ede5",
  armShade: "#e2ddd2",
  joint: "#f2ae1c",
  graphite: "#2b2a2e",
  rubber: "#424148",
  steel: "#b5b3ad",
  birch: "#dcc6a0",
  birchEdge: "#cdb48a",
  bone: "#e8e2d6",
  slate: "#566682",
  sage: "#7f9c86",
  clay: "#c8694c",
  paper: "#fbf9f3",
  line: "#9b968b",
  cyc: "#e6e2da",
  bg: "#e9e5dd",
  screen: "#141416",
} as const;

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

/** Bake one flat colour into a geometry so many parts can share one material and one draw call. */
export function paint(geo: BufferGeometry, hex: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of ["uv", "uv1", "uv2"]) if (g.getAttribute(name)) g.deleteAttribute(name);
  _c.set(hex);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/** Move/rotate/scale a part in place. Rotations are XYZ Euler in radians. */
export function at(geo: BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

export const box = (w: number, h: number, d: number, hex: string, r = 0, seg = 2) =>
  paint(r > 0 ? new RoundedBoxGeometry(w, h, d, seg, r) : new BoxGeometry(w, h, d), hex);
export const cyl = (rt: number, rb: number, h: number, hex: string, seg = 28) =>
  paint(new CylinderGeometry(rt, rb, h, seg, 1), hex);
/** A cylinder lying along X (joint axles). */
export const axle = (r: number, len: number, hex: string, seg = 32) =>
  at(paint(new CylinderGeometry(r, r, len, seg, 1), hex), 0, 0, 0, 0, 0, Math.PI / 2);
export const ball = (r: number, hex: string, ws = 18, hs = 12) => paint(new SphereGeometry(r, ws, hs), hex);
export const ring = (R: number, r: number, hex: string, ts = 28) => paint(new TorusGeometry(R, r, 8, ts), hex);
export const capsule = (r: number, len: number, hex: string) => paint(new CapsuleGeometry(r, len, 6, 16), hex);

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error("merge failed");
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Linear ramp of x from a..b, clamped to 0..1. */
export const ramp = (x: number, a: number, b: number) => clamp((x - a) / (b - a), 0, 1);
export const smooth = (t: number) => t * t * (3 - 2 * t);
/** Minimum-jerk profile: zero velocity and acceleration at both ends, like a real joint move. */
export const minjerk = (t: number) => t * t * t * (10 + t * (-15 + 6 * t));
/** The equivalent of `a` (mod 2π) closest to `ref`, so interpolations never spin the long way. */
export const near = (a: number, ref: number) => a + Math.round((ref - a) / (Math.PI * 2)) * Math.PI * 2;
