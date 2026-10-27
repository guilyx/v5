import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  BoxGeometry,
  ConeGeometry,
} from "three";

/** Small deterministic PRNG so every island is the same on every visit. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rand = ReturnType<typeof rng>;

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _c = new Color();
/** sRGB hex → linear rgb triple (vertex colours are read as linear). */
export function lin(hex: number | string): [number, number, number] {
  _c.set(hex as number);
  return [_c.r, _c.g, _c.b];
}

const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const n = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();
const cen = new Vector3();

/**
 * Accumulates flat-shaded, vertex-coloured triangles into one geometry,
 * so a whole island is a single draw call.
 */
export class Builder {
  pos: number[] = [];
  col: number[] = [];
  constructor(private rand: Rand) {}

  /** Push a triangle; if `outFrom` is given the winding is fixed to face away from it. */
  tri(a: Vector3, b: Vector3, c: Vector3, color: [number, number, number], jitter = 0.05, outFrom?: Vector3) {
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-10) return;
    if (outFrom) {
      cen.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(outFrom);
      if (n.dot(cen) < 0) {
        const t = b;
        b = c;
        c = t;
      }
    }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const k = 1 + (this.rand() - 0.5) * 2 * jitter;
    const r = color[0] * k,
      g = color[1] * k,
      bl = color[2] * k;
    this.col.push(r, g, bl, r, g, bl, r, g, bl);
  }

  /** Triangle whose winding must face up (+y). */
  triUp(a: Vector3, b: Vector3, c: Vector3, color: [number, number, number], jitter = 0.05) {
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    if (n.y < 0) this.tri(a, c, b, color, jitter);
    else this.tri(a, b, c, color, jitter);
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: [number, number, number], jitter = 0.05, outFrom?: Vector3) {
    this.tri(a, b, c, color, jitter, outFrom);
    this.tri(a, c, d, color, jitter, outFrom);
  }

  /** Add a three.js primitive, transformed, one colour per face (or per-face callback). */
  add(
    geo: BufferGeometry,
    m: Matrix4,
    color: [number, number, number] | ((face: number, ny: number) => [number, number, number]),
    jitter = 0.05,
  ) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i += 3) {
      va.fromBufferAttribute(p, i).applyMatrix4(m);
      vb.fromBufferAttribute(p, i + 1).applyMatrix4(m);
      vc.fromBufferAttribute(p, i + 2).applyMatrix4(m);
      let c: [number, number, number];
      if (typeof color === "function") {
        e1.subVectors(vb, va);
        e2.subVectors(vc, va);
        n.crossVectors(e1, e2).normalize();
        c = color(i / 3, n.y);
      } else c = color;
      this.tri(va, vb, vc, c, jitter);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }

  merge(other: Builder) {
    for (const v of other.pos) this.pos.push(v);
    for (const v of other.col) this.col.push(v);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- transforms ----------
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const Y = new Vector3(0, 1, 0);
export function mat(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0): Matrix4 {
  _q.setFromAxisAngle(Y, rotY);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  return new Matrix4().compose(_p, _q, _s);
}

// ---------- primitives (unit sized; scale with mat) ----------
/** Unit box sitting on y=0. */
export const box = () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
/** Gable roof prism, ridge along z, base on y=0, 1×1×1. */
export function gable(): BufferGeometry {
  const g = new BufferGeometry();
  const x = 0.5,
    z = 0.5,
    h = 1;
  // prettier-ignore
  const v = [
    -x,0,z,  0,h,z,  -x,0,-z,   -x,0,-z, 0,h,z, 0,h,-z,   // left slope
     x,0,-z, 0,h,-z,  x,0,z,     x,0,z,  0,h,-z, 0,h,z,   // right slope
    -x,0,z,  x,0,z,   0,h,z,                              // front gable
     x,0,-z, -x,0,-z, 0,h,-z,                             // back gable
  ];
  g.setAttribute("position", new Float32BufferAttribute(v, 3));
  return g;
}
/** Hip/pyramid roof, base on y=0. */
export const pyramid = (sides = 4) => new ConeGeometry(0.7071, 1, sides, 1).rotateY(Math.PI / sides).translate(0, 0.5, 0);
export const cyl = (seg = 7, top = 1) => new CylinderGeometry(0.5 * top, 0.5, 1, seg, 1).translate(0, 0.5, 0);
export const cone = (seg = 6) => new ConeGeometry(0.5, 1, seg, 1).translate(0, 0.5, 0);
export const blob = (detail = 0) => new IcosahedronGeometry(0.5, detail);
