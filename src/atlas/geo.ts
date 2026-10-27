/** Small vector + globe math shared by the WebGL globe, the flat fallback and the DOM pins. */

export type V3 = [number, number, number];
export const DEG = Math.PI / 180;

/** Latitude/longitude in degrees → unit vector. Longitude 0 faces +z, 90° E faces +x, north is +y. */
export function ll(lat: number, lon: number): V3 {
  const p = lat * DEG;
  const l = lon * DEG;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

export function toLatLon(v: V3): [number, number] {
  const n = len(v) || 1;
  return [Math.asin(clamp(v[1] / n, -1, 1)) / DEG, Math.atan2(v[0], v[2]) / DEG];
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Angle between two unit vectors, in radians. */
export const angle = (a: V3, b: V3) => Math.acos(clamp(dot(a, b), -1, 1));

/** Great-circle interpolation between unit vectors. */
export function slerp(a: V3, b: V3, t: number): V3 {
  const w = angle(a, b);
  if (w < 1e-5) return a;
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

/** Rotate around the polar (y) axis. */
export function rotY(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** Rotate v around a unit axis k (Rodrigues). */
export function rotAxis(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/**
 * Where the sun is overhead right now (declination + hour angle, no equation of time):
 * good to a degree or two, which is all a soft terminator needs.
 */
export function sunDir(date = new Date()): V3 {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86400000;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const lon = -15 * (hours - 12);
  return ll(decl, lon);
}

/** A great-circle route lifted off the surface and bowed sideways a little, like a flight path drawn on a map. */
export function arcPoint(a: V3, b: V3, t: number, lift: number, bow: number): V3 {
  const p = slerp(a, b, t);
  const s = Math.sin(Math.PI * t);
  const side = norm(cross(a, b));
  const q = norm(add(p, scale(side, bow * s)));
  return scale(q, 1 + lift * s);
}

export function arcShape(a: V3, b: V3) {
  const w = angle(a, b);
  return { lift: Math.min(0.2, 0.012 + w * 0.1), bow: Math.min(0.14, w * 0.2) };
}

/** A camera that orbits the globe, always looking at its centre, north kept up. */
export interface Cam {
  c: V3; // unit direction from globe centre to camera
  d: number; // distance from globe centre (globe radius = 1)
  pos: V3;
  right: V3;
  up: V3;
  W: number;
  H: number;
  cx: number; // where the globe centre lands on screen (css px)
  cy: number;
  f: number; // focal length in css px
  fov: number; // vertical, radians
}

export function makeCam(c: V3, d: number, W: number, H: number, cx: number, cy: number, fov: number): Cam {
  let right = cross([0, 1, 0], c);
  if (len(right) < 1e-4) right = [1, 0, 0];
  right = norm(right);
  const up = cross(c, right);
  return { c, d, pos: scale(c, d), right, up, W, H, cx, cy, f: H / 2 / Math.tan(fov / 2), fov };
}

/** Project a world point to css px. Returns null behind the camera. */
export function project(cam: Cam, p: V3): { x: number; y: number; z: number } | null {
  const v = sub(p, cam.pos);
  const z = -dot(v, cam.c);
  if (z <= 1e-3) return null;
  return { x: cam.cx + (dot(v, cam.right) / z) * cam.f, y: cam.cy - (dot(v, cam.up) / z) * cam.f, z };
}

/** How far a point is from being hidden by the globe: > 0 visible, < 0 behind. Works for lifted points too. */
export function facing(cam: Cam, p: V3): number {
  const r = len(p);
  // visible while the angle from the view axis is under acos(1/d) + acos(1/r)
  const horizon = 1 / (cam.d * r) - Math.sqrt(Math.max(0, 1 - 1 / (r * r))) * Math.sqrt(Math.max(0, 1 - 1 / (cam.d * cam.d)));
  return dot(p, cam.c) / r - horizon;
}

/** Radius of the globe's outline on screen, in css px. */
export function silhouette(cam: Cam): number {
  const a = Math.asin(Math.min(1, 1 / cam.d));
  return Math.tan(a) * cam.f;
}
