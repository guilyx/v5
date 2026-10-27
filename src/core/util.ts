import * as THREE from "three";

/** Ink & Iris, from guilyx/branding. The accent is the only saturated colour. */
export const ink = {
  bg: new THREE.Color("#12141b"),
  deep: new THREE.Color("#0b0c11"),
  raised: new THREE.Color("#1a1d26"),
  line: new THREE.Color("#2c3040"),
  heading: new THREE.Color("#e8eaf0"),
  body: new THREE.Color("#aeb3c2"),
  muted: new THREE.Color("#858b9c"),
  faint: new THREE.Color("#616779"),
  accent: new THREE.Color("#8b95f0"),
} as const;

/** A colour pushed past 1.0 so the bloom pass picks it up. */
export function glow(c: THREE.Color, k: number): THREE.Color {
  return c.clone().multiplyScalar(k);
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0 over [a, b], with soft shoulders of width `edge`. */
export const window01 = (a: number, b: number, v: number, edge = 0.08) =>
  smoothstep(a - edge, a + edge, v) * (1 - smoothstep(b - edge, b + edge, v));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Frame-rate independent exponential damping. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Deterministic PRNG so every visitor sees the same maze, grid and sky. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/* ---------- shared materials & helpers ---------- */

const lineMats = new Map<string, THREE.LineBasicMaterial>();
/** Hairline material, cached by colour + opacity. */
export function lineMat(c: THREE.Color, opacity = 1): THREE.LineBasicMaterial {
  const key = c.getHexString() + opacity.toFixed(2);
  let m = lineMats.get(key);
  if (!m) {
    m = new THREE.LineBasicMaterial({ color: c, transparent: opacity < 1, opacity, fog: true });
    lineMats.set(key, m);
  }
  return m;
}

/** A dark solid with hairline edges — the blueprint look every scene shares. */
export function blueprint(
  geo: THREE.BufferGeometry,
  opts: { fill?: THREE.Color; edge?: THREE.Color; edgeOpacity?: number; threshold?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: opts.fill ?? ink.raised,
      roughness: 0.85,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, opts.threshold ?? 20),
    lineMat(opts.edge ?? ink.faint, opts.edgeOpacity ?? 1),
  );
  g.add(mesh, edges);
  return g;
}

export function basic(c: THREE.Color, opacity = 1, extra: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({
    color: c,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    ...extra,
  });
}

/** A polyline from points. */
export function polyline(points: THREE.Vector3[], mat: THREE.Material): THREE.Line {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat);
}

/** Soft round sprite texture, generated once, used for glows and stars. */
let dotTex: THREE.Texture | null = null;
export function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

/** A glow halo — additive sprite. */
export function halo(c: THREE.Color, size: number, opacity = 0.6): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: dotTexture(),
      color: c,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  s.scale.setScalar(size);
  return s;
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const isCoarse = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
