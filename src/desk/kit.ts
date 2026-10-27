import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* Small helpers shared by every object on the desk.
   Units: 1 = 10 cm, give or take; the desk top is the plane y = 0. */

const geoCache = new Map<string, THREE.BufferGeometry>();

/** A rounded box, cached by size so identical parts share one geometry. */
export function rbox(w: number, h: number, d: number, r = 0.06, seg = 3): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  // tiny parts (pins, LEDs) don't need smooth corners: keep their triangle count low
  if (Math.min(w, h, d) < 0.13) seg = 1;
  const key = `rb:${w}:${h}:${d}:${rr}:${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, seg, Math.max(rr, 0.001));
    geoCache.set(key, g);
  }
  return g;
}

export function cyl(rt: number, rb: number, h: number, seg = 24): THREE.BufferGeometry {
  const key = `cy:${rt}:${rb}:${h}:${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }
  return g;
}

export interface MatOpts {
  rough?: number;
  metal?: number;
  map?: THREE.Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  alphaTest?: number;
  env?: number;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** A soft standard material; plain colours are cached and shared. */
export function mat(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = o.map ? "" : `m:${new THREE.Color(color).getHexString()}:${o.rough ?? 0.7}:${o.metal ?? 0}:${o.emissive ?? 0}:${o.emissiveIntensity ?? 1}:${o.side ?? 0}:${o.env ?? 1}`;
  if (key) {
    const hit = matCache.get(key);
    if (hit) return hit;
  }
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.7,
    metalness: o.metal ?? 0,
    map: o.map ?? null,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    side: o.side ?? THREE.FrontSide,
    alphaTest: o.alphaTest ?? 0,
    envMapIntensity: o.env ?? 1,
  });
  if (key) matCache.set(key, m);
  return m;
}

/** Place a mesh in a parent; everything casts and receives the one soft shadow. */
export function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Merge all static meshes under `group` by material: one draw call per material.
    Meshes listed in `keep` (things that animate) are left alone. */
export function bake(group: THREE.Group, keep: THREE.Object3D[] = []): void {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  const remove: THREE.Mesh[] = [];
  const skip = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => skip.add(o));

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || Array.isArray(m.material) || m.userData.noBake) return;
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const entry = byMat.get(m.material) ?? { geos: [], cast: false };
    entry.geos.push(g);
    entry.cast ||= m.castShadow;
    byMat.set(m.material, entry);
    remove.push(m);
  });

  for (const m of remove) m.parent?.remove(m);
  for (const [material, { geos, cast }] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/* ---------- canvas textures ---------- */

let maxAniso = 4;
export function setAnisotropy(n: number) {
  maxAniso = n;
}

export function canvasTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/** Deterministic random numbers, so the desk is laid out the same way for everyone. */
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

/** Fill a canvas with paper: a warm off-white with a little fibre. */
export function paperFill(ctx: CanvasRenderingContext2D, w: number, h: number, base = "#f7f1e6", seed = 7) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  const n = Math.round((w * h) / 260);
  for (let i = 0; i < n; i++) {
    const a = r() * 0.05;
    ctx.fillStyle = r() > 0.5 ? `rgba(120,90,50,${a})` : `rgba(255,255,255,${a * 1.5})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
  }
}

/** Greyed-out lines that read as "text" from a distance, without claiming anything. */
export function textLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  lines: number,
  lh: number,
  seed: number,
  color = "rgba(50,40,30,0.42)",
) {
  const r = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < lines; i++) {
    const last = i === lines - 1 || r() < 0.12;
    const ww = last ? w * (0.35 + r() * 0.4) : w * (0.92 + r() * 0.08);
    ctx.fillRect(x, y + i * lh, ww, Math.max(2, lh * 0.36));
  }
}

export const FONT_SANS = '"Geist Variable", "Geist", system-ui, sans-serif';
export const FONT_SERIF = '"Instrument Serif", Georgia, serif';

/** Write text that shrinks to fit a width. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, font: (px: number) => string, px: number) {
  let size = px;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxW && size > 8) {
    size -= 1;
    ctx.font = font(size);
  }
  ctx.fillText(text, x, y);
}

/** Word-wrap text into a box. Returns the y after the last line. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): number {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

/** A thin flat ribbon following a curve, lying on its side (for lanyards, cables seen from above). */
export function ribbon(points: THREE.Vector3[], width: number, segments = 64): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.crossVectors(tan, up).normalize().multiplyScalar(width / 2);
    pos.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z);
    uv.push(t * curve.getLength() / width, 1, t * curve.getLength() / width, 0);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the ribbon faces up
  const n = g.attributes.normal;
  if (n.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}
