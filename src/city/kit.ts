import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  type ColorRepresentation,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Opts {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** 1 = lit at night (windows, lamps); 2 = lit day and night (LEDs) */
  glow?: number;
  /** random colour jitter, 0..1 */
  jitter?: number;
  /** Euler order for the rotation (default XYZ) */
  order?: "XYZ" | "YXZ" | "ZXY" | "XZY" | "YZX" | "ZYX";
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

/** Tiny seeded RNG so the city is the same on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A toy-block geometry builder. Every part is flat-shaded, vertex-coloured and
 * merged into one BufferGeometry, so a whole building is one draw call.
 * With `assembled`, parts are grouped into blocks (pivot + delay) that the
 * vertex shader springs into place one after another.
 */
export class Kit {
  private parts: BufferGeometry[] = [];
  private pivot = new Vector3();
  private delay = 0;
  private rand = rng(7);
  /** latest block start, so the caller knows when the building is done */
  maxDelay = 0;
  constructor(private assembled = false) {}

  /** Following parts form one block that lands on `pivot` after `delay` seconds. */
  block(x: number, y: number, z: number, delay: number) {
    this.pivot.set(x, y, z);
    this.delay = delay;
    this.maxDelay = Math.max(this.maxDelay, delay);
    return this;
  }

  add(src: BufferGeometry, x: number, y: number, z: number, color: ColorRepresentation, o: Opts = {}) {
    const g = src.index ? src.toNonIndexed() : src;
    g.deleteAttribute("uv");
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.order ?? "XYZ");
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    _c.set(color);
    if (o.jitter) _c.offsetHSL((this.rand() - 0.5) * 0.04 * o.jitter, 0, (this.rand() - 0.5) * 0.12 * o.jitter);
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n).fill(o.glow ?? 0);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.setAttribute("glow", new Float32BufferAttribute(glow, 1));
    if (this.assembled) {
      const piv = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        piv[i * 3] = this.pivot.x;
        piv[i * 3 + 1] = this.pivot.y;
        piv[i * 3 + 2] = this.pivot.z;
      }
      g.setAttribute("aPivot", new Float32BufferAttribute(piv, 3));
      g.setAttribute("aDelay", new Float32BufferAttribute(new Float32Array(n).fill(this.delay), 1));
    }
    this.parts.push(g);
    return this;
  }

  /** box standing on y */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: ColorRepresentation, o?: Opts) {
    return this.add(new BoxGeometry(w, h, d), x, y + (h * (o?.sy ?? 1)) / 2, z, color, o);
  }
  /** cylinder standing on y */
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: ColorRepresentation, o?: Opts) {
    return this.add(new CylinderGeometry(rt, rb, h, seg), x, y + (h * (o?.sy ?? 1)) / 2, z, color, o);
  }
  cone(r: number, h: number, seg: number, x: number, y: number, z: number, color: ColorRepresentation, o?: Opts) {
    return this.add(new ConeGeometry(r, h, seg), x, y + (h * (o?.sy ?? 1)) / 2, z, color, o);
  }
  /** low-poly ball centred on y */
  ball(r: number, x: number, y: number, z: number, color: ColorRepresentation, o?: Opts, detail = 0) {
    return this.add(new IcosahedronGeometry(r, detail), x, y, z, color, o);
  }
  /** gable roof (triangular prism) standing on y, ridge along local z */
  gable(w: number, h: number, d: number, x: number, y: number, z: number, color: ColorRepresentation, o?: Opts) {
    const hw = w / 2;
    const hd = d / 2;
    // two triangles (ends) + two slopes + base
    const p = [
      // front end
      -hw, 0, hd, hw, 0, hd, 0, h, hd,
      // back end
      hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
      // right slope
      hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,
      // left slope
      -hw, 0, -hd, -hw, 0, hd, 0, h, hd, -hw, 0, -hd, 0, h, hd, 0, h, -hd,
      // base
      -hw, 0, hd, -hw, 0, -hd, hw, 0, -hd, -hw, 0, hd, hw, 0, -hd, hw, 0, hd,
    ];
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return this.add(g, x, y, z, color, o);
  }

  get empty() {
    return this.parts.length === 0;
  }

  build(): BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A flat polygon (CCW in x/z) as a cap at height y — for islands and plazas. */
export function capGeometry(pts: [number, number][], y: number): BufferGeometry {
  // fan from the centroid: island outlines are star-shaped around it
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x;
    cz += z;
  }
  cx /= pts.length;
  cz /= pts.length;
  const p: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    p.push(cx, y, cz, bx, y, bz, ax, y, az);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Vertical walls along a closed outline, from y0 to y1, top edge optionally inset. */
export function wallGeometry(pts: [number, number][], y0: number, y1: number, flare = 0): BufferGeometry {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x;
    cz += z;
  }
  cx /= pts.length;
  cz /= pts.length;
  const p: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    // bottom flares out slightly so the slab reads as a soft cake
    const fa = 1 + flare / Math.hypot(ax - cx, az - cz);
    const fb = 1 + flare / Math.hypot(bx - cx, bz - cz);
    const a0x = cx + (ax - cx) * fa;
    const a0z = cz + (az - cz) * fa;
    const b0x = cx + (bx - cx) * fb;
    const b0z = cz + (bz - cz) * fb;
    p.push(a0x, y0, a0z, bx, y1, bz, b0x, y0, b0z, a0x, y0, a0z, ax, y1, az, bx, y1, bz);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
