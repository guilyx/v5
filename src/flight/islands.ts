import { BufferGeometry, CylinderGeometry, Vector3 } from "three";
import { Builder, rng, lin, mat, box, gable, pyramid, cyl, cone, blob, smooth, type Rand } from "./geo";

type RGB = [number, number, number];
type Pt = [number, number];

export interface Fall {
  /** world position of the lip */
  x: number;
  y: number;
  z: number;
  /** outward horizontal direction */
  dx: number;
  dz: number;
  w: number;
  drop: number;
}

export interface Island {
  key: string;
  pos: Vector3;
  R: number;
  /** local terrain height (y relative to pos.y), or null outside */
  heightAt(x: number, z: number): number | null;
  geo: BufferGeometry;
  falls: Fall[];
  /** named local points used by the route (pads, rings) */
  spots: Record<string, Vector3>;
}

// ---------- palette (sRGB, converted to linear) ----------
const P = {
  grass: lin("#9fd07f"),
  grass2: lin("#8cc674"),
  grass3: lin("#b2da8e"),
  band: lin("#78b464"),
  sand: lin("#f1d7a2"),
  sand2: lin("#e8c88d"),
  beach: lin("#f8e7c4"),
  sandBand: lin("#e2bf86"),
  strata: ["#f0c49b", "#e2ab82", "#d19473", "#bd7e66", "#a66b5b", "#8f5d55"].map(lin),
  water: lin("#62c4dc"),
  lagoon: lin("#3fbfc6"),
  shallow: lin("#8fe0d4"),
  bank: lin("#d9c79a"),
  cream: lin("#fbf3e3"),
  white: lin("#ffffff"),
  stone: lin("#efe0c3"),
  slate: lin("#7d8aa3"),
  mansard: lin("#8994ab"),
  terracotta: lin("#dc7650"),
  danish: lin("#b4513f"),
  leaf: ["#5fae6b", "#4f9d62", "#78bf6f", "#69b25f"].map(lin),
  palm: lin("#5aa865"),
  trunk: lin("#9a6b4f"),
  palmTrunk: lin("#b48a62"),
  glass: ["#d8ecf5", "#bcdbee", "#eef5f8", "#cfe3ef"].map(lin),
  crown: lin("#94afc2"),
  band2: lin("#8fb4cc"),
  ink: lin("#2d3448"),
  pin: lin("#d0d6e0"),
  paving: lin("#efe6d4"),
  soil: lin("#c9a27a"),
  vine: lin("#4e8c4f"),
  hedge: lin("#4f8c5c"),
  mazeFloor: lin("#f4ead2"),
  accent: lin("#ff7a3d"),
  red: lin("#e8572a"),
  yellow: lin("#f4c247"),
  grey: lin("#9aa2ae"),
  asphalt: lin("#8b919c"),
  roofGrey: lin("#e6e3dc"),
  blue: lin("#3e7cc9"),
  glassDoor: lin("#a5d4ea"),
  odense: ["#f4c95d", "#f19a8b", "#f2b46b", "#9fd8c0", "#a9cbee", "#f7efe3", "#e88f6a"].map(lin),
  hangar: lin("#e9ecef"),
  hangarDark: lin("#3b4356"),
  padWhite: lin("#fbfaf6"),
};

// ---------- helpers ----------
function makeOutline(R: number, r: Rand) {
  const a = [r() * 6.28, r() * 6.28, r() * 6.28];
  return (th: number) => R * (1 + 0.07 * Math.sin(3 * th + a[0]) + 0.045 * Math.sin(5 * th + a[1]) + 0.025 * Math.sin(8 * th + a[2]));
}

function polyDist(x: number, z: number, pts: Pt[]) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const vx = bx - ax,
      vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const dx = x - (ax + vx * t),
      dz = z - (az + vz * t);
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  return best;
}

/** Densify a polyline (Catmull-Rom-ish via midpoint smoothing). */
function densify(pts: Pt[], step = 0.7): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n,
        t2 = t * t,
        t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

interface TerrainOpts {
  R: number;
  seed: number;
  h: (x: number, z: number) => number;
  color: (x: number, z: number, y: number) => RGB;
  band: RGB;
  depth?: number;
}

/** Floating island body: a polar-grid top plus a stratified rock cone hanging under it. */
function terrain(b: Builder, r: Rand, o: TerrainOpts) {
  const { R } = o;
  const outline = makeOutline(R, r);
  const NR = Math.round(R / 0.85);
  const S = Math.round(R * 4.6);
  const ring: Vector3[][] = [];
  const centre = V(0, o.h(0, 0), 0);
  for (let i = 1; i <= NR; i++) {
    const row: Vector3[] = [];
    for (let j = 0; j < S; j++) {
      let th = ((j + (i % 2) * 0.5) / S) * Math.PI * 2;
      let rr = (i / NR) * outline(th);
      if (i < NR) {
        th += (r() - 0.5) * (0.5 / S) * Math.PI * 2;
        rr += (r() - 0.5) * 0.45 * (R / NR);
      }
      const x = Math.cos(th) * rr,
        z = Math.sin(th) * rr;
      row.push(V(x, o.h(x, z), z));
    }
    ring.push(row);
  }
  const faceColor = (a: Vector3, bb: Vector3, c: Vector3) => {
    const x = (a.x + bb.x + c.x) / 3,
      z = (a.z + bb.z + c.z) / 3,
      y = (a.y + bb.y + c.y) / 3;
    return o.color(x, z, y);
  };
  // centre fan
  for (let j = 0; j < S; j++) {
    const a = ring[0][j],
      c = ring[0][(j + 1) % S];
    b.triUp(centre, a, c, faceColor(centre, a, c), 0.06);
  }
  for (let i = 0; i < NR - 1; i++) {
    const A = ring[i],
      B = ring[i + 1];
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      // alternate rings are offset by half a step; pick the diagonal that follows it
      if (i % 2 === 0) {
        b.triUp(A[j], B[j], B[j1], faceColor(A[j], B[j], B[j1]), 0.06);
        b.triUp(A[j], B[j1], A[j1], faceColor(A[j], B[j1], A[j1]), 0.06);
      } else {
        b.triUp(A[j], B[j], A[j1], faceColor(A[j], B[j], A[j1]), 0.06);
        b.triUp(A[j1], B[j], B[j1], faceColor(A[j1], B[j], B[j1]), 0.06);
      }
    }
  }
  // underside
  const ds = Math.min(1.35, R / 13) * (o.depth ?? 1);
  const levels = [
    { y: -0.5, s: 1.0 },
    { y: -1.7 * ds, s: 0.95 },
    { y: -3.4 * ds, s: 0.82 },
    { y: -5.5 * ds, s: 0.62 },
    { y: -7.9 * ds, s: 0.4 },
    { y: -10.3 * ds, s: 0.2 },
  ];
  const edge = ring[NR - 1];
  const rows: Vector3[][] = [edge];
  levels.forEach((L, li) => {
    rows.push(
      edge.map((p, j) => {
        const k = L.s * (li === 0 ? 1.0 : 1 + (r() - 0.5) * 0.14);
        const y = li === 0 ? p.y + L.y : L.y + (r() - 0.5) * 0.5;
        const wob = li === 0 ? 0 : Math.sin(j * 0.9 + li) * 0.04;
        return V(p.x * (k + wob), y, p.z * (k + wob));
      }),
    );
  });
  const tip = V((r() - 0.5) * R * 0.1, -12.6 * ds, (r() - 0.5) * R * 0.1);
  for (let li = 0; li < rows.length - 1; li++) {
    const A = rows[li],
      B = rows[li + 1];
    const col = li === 0 ? o.band : P.strata[Math.min(P.strata.length - 1, li - 1)];
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      const ax = V(0, (A[j].y + B[j].y) / 2, 0);
      b.quad(A[j], B[j], B[j1], A[j1], col, 0.07, ax);
    }
  }
  const last = rows[rows.length - 1];
  for (let j = 0; j < S; j++) {
    b.tri(last[j], tip, last[(j + 1) % S], P.strata[5], 0.07, V(0, tip.y + 2, 0));
  }
  // a few floating pebbles under the island
  for (let k = 0; k < 4; k++) {
    const th = r() * Math.PI * 2,
      rr = R * (0.5 + r() * 0.5);
    const s = 0.6 + r() * 1.1;
    b.add(blob(0), mat(Math.cos(th) * rr, -4 - r() * 6 * ds, Math.sin(th) * rr, s, s * 0.8, s, r() * 6), P.strata[2 + (k % 3)], 0.08);
  }
  const inside = (x: number, z: number) => Math.hypot(x, z) < outline(Math.atan2(z, x)) - 0.2;
  return { outline, inside };
}

function house(b: Builder, x: number, y: number, z: number, w: number, d: number, hw: number, hr: number, rot: number, wall: RGB, roof: RGB) {
  b.add(box(), mat(x, y - 0.2, z, w, hw + 0.2, d, rot), wall, 0.03);
  b.add(gable(), mat(x, y + hw, z, w * 1.12, hr, d * 1.08, rot), roof, 0.03);
}

function tree(b: Builder, r: Rand, x: number, y: number, z: number, s = 1) {
  b.add(cyl(5), mat(x, y - 0.1, z, 0.16 * s, 0.6 * s, 0.16 * s), P.trunk, 0.04);
  const leaf = P.leaf[Math.floor(r() * P.leaf.length)];
  b.add(blob(0), mat(x, y + 0.85 * s, z, 0.95 * s, 1.05 * s, 0.95 * s, r() * 6), leaf, 0.07);
}

function pine(b: Builder, r: Rand, x: number, y: number, z: number, s = 1) {
  b.add(cyl(5), mat(x, y - 0.1, z, 0.14 * s, 0.5 * s, 0.14 * s), P.trunk, 0.04);
  const leaf = P.leaf[Math.floor(r() * 2)];
  b.add(cone(6), mat(x, y + 0.3 * s, z, 0.9 * s, 1.0 * s, 0.9 * s, r() * 6), leaf, 0.06);
  b.add(cone(6), mat(x, y + 0.85 * s, z, 0.62 * s, 0.8 * s, 0.62 * s, r() * 6), leaf, 0.06);
}

function palm(b: Builder, r: Rand, x: number, y: number, z: number, s = 1) {
  const lean = (r() - 0.5) * 0.5;
  for (let k = 0; k < 4; k++) {
    b.add(cyl(5, 0.85), mat(x + lean * k * 0.12 * s, y + k * 0.45 * s - 0.1, z, 0.17 * s, 0.5 * s, 0.17 * s), P.palmTrunk, 0.05);
  }
  const tx = x + lean * 0.5 * s,
    ty = y + 1.85 * s,
    tz = z;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + r();
    const m = mat(tx + Math.cos(a) * 0.45 * s, ty - 0.12 * s, tz + Math.sin(a) * 0.45 * s, 0.9 * s, 0.08 * s, 0.32 * s, -a);
    b.add(box(), m, P.palm, 0.08);
  }
}

/** Water ribbon along a polyline, slightly above the carved bed. */
function ribbon(b: Builder, pts: Pt[], w: number, y: number, color: RGB, r: Rand) {
  const d = densify(pts, 0.8);
  let prevL: Vector3 | null = null,
    prevR: Vector3 | null = null;
  for (let i = 0; i < d.length; i++) {
    const p = d[i];
    const q = d[Math.min(d.length - 1, i + 1)];
    const o = d[Math.max(0, i - 1)];
    let tx = q[0] - o[0],
      tz = q[1] - o[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const ww = (w / 2) * (1 + (r() - 0.5) * 0.12);
    const L = V(p[0] - tz * ww, y, p[1] + tx * ww);
    const Rr = V(p[0] + tz * ww, y, p[1] - tx * ww);
    if (prevL && prevR) {
      b.triUp(prevL, prevR, Rr, color, 0.03);
      b.triUp(prevL, Rr, L, color, 0.03);
    }
    prevL = L;
    prevR = Rr;
  }
}

function fallAt(pos: Vector3, pts: Pt[], w: number, y: number, drop: number): Fall {
  const a = pts[pts.length - 2],
    c = pts[pts.length - 1];
  let dx = c[0] - a[0],
    dz = c[1] - a[1];
  const l = Math.hypot(dx, dz);
  dx /= l;
  dz /= l;
  return { x: pos.x + c[0], y: pos.y + y, z: pos.z + c[1], dx, dz, w, drop };
}

function scatter(r: Rand, n: number, R: number, ok: (x: number, z: number) => boolean, place: (x: number, z: number) => void) {
  let placed = 0,
    tries = 0;
  while (placed < n && tries < n * 30) {
    tries++;
    const th = r() * Math.PI * 2,
      rr = Math.sqrt(r()) * R;
    const x = Math.cos(th) * rr,
      z = Math.sin(th) * rr;
    if (ok(x, z)) {
      place(x, z);
      placed++;
    }
  }
}

function pad(b: Builder, x: number, y: number, z: number, s = 1) {
  b.add(cyl(16), mat(x, y - 0.3, z, 3.0 * s, 0.42, 3.0 * s), P.accent, 0.0);
  b.add(cyl(16), mat(x, y - 0.3, z, 2.55 * s, 0.44, 2.55 * s), P.padWhite, 0.0);
  // a cross for the drone pad
  b.add(box(), mat(x, y - 0.3, z, 1.5 * s, 0.46, 0.22 * s, Math.PI / 4), P.accent, 0.0);
  b.add(box(), mat(x, y - 0.3, z, 1.5 * s, 0.46, 0.22 * s, -Math.PI / 4), P.accent, 0.0);
}

function flag(b: Builder, x: number, y: number, z: number, color: RGB) {
  b.add(cyl(4), mat(x, y, z, 0.06, 1.1, 0.06), P.white, 0);
  b.add(box(), mat(x + 0.22, y + 0.78, z, 0.42, 0.28, 0.04), color, 0);
}

/** Perfect maze by depth-first search, rendered as hedge walls. */
function maze(b: Builder, r: Rand, cx: number, y: number, cz: number, n: number, cell: number, robotColor: RGB) {
  const size = n * cell;
  const x0 = cx - size / 2,
    z0 = cz - size / 2;
  b.add(box(), mat(cx, y - 0.25, cz, size + 0.5, 0.33, size + 0.5), P.mazeFloor, 0.02);
  // walls[i][j] = [east, south]
  const east = Array.from({ length: n }, () => Array(n).fill(true));
  const south = Array.from({ length: n }, () => Array(n).fill(true));
  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb: [number, number, number][] = [];
    if (i > 0 && !seen[i - 1][j]) nb.push([i - 1, j, 0]);
    if (i < n - 1 && !seen[i + 1][j]) nb.push([i + 1, j, 1]);
    if (j > 0 && !seen[i][j - 1]) nb.push([i, j - 1, 2]);
    if (j < n - 1 && !seen[i][j + 1]) nb.push([i, j + 1, 3]);
    if (!nb.length) {
      stack.pop();
      continue;
    }
    const [ni, nj, dir] = nb[Math.floor(r() * nb.length)];
    if (dir === 0) east[ni][j] = false;
    if (dir === 1) east[i][j] = false;
    if (dir === 2) south[i][nj] = false;
    if (dir === 3) south[i][j] = false;
    seen[ni][nj] = true;
    stack.push([ni, nj]);
  }
  const t = 0.14,
    h = 0.42;
  const yy = y + 0.05;
  // outer walls, with an entrance at (0,0) west and an exit at (n-1,n-1) east
  b.add(box(), mat(cx, yy, z0, size + t, h, t), P.hedge, 0.05);
  b.add(box(), mat(cx, yy, z0 + size, size + t, h, t), P.hedge, 0.05);
  b.add(box(), mat(x0, yy, cz + cell / 2, t, h, size - cell + t), P.hedge, 0.05);
  b.add(box(), mat(x0 + size, yy, cz - cell / 2, t, h, size - cell + t), P.hedge, 0.05);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = x0 + i * cell,
        z = z0 + j * cell;
      if (east[i][j] && i < n - 1) b.add(box(), mat(x + cell, yy, z + cell / 2, t, h, cell + t), P.hedge, 0.05);
      if (south[i][j] && j < n - 1) b.add(box(), mat(x + cell / 2, yy, z + cell, cell + t, h, t), P.hedge, 0.05);
    }
  // the robot, mid-run, and the flag at the exit
  b.add(box(), mat(x0 + cell * 0.5 + cell * Math.floor(n / 2), yy, z0 + cell * 0.5 + cell * Math.floor(n / 2), 0.32, 0.26, 0.32), robotColor, 0);
  flag(b, x0 + size + 0.35, yy, z0 + size - cell / 2, P.accent);
}

// =====================================================================
// The five places
// =====================================================================

function nantes(): Island {
  const pos = V(0, 0, 0);
  const R = 13;
  const r = rng(11);
  const b = new Builder(r);
  const river: Pt[] = [
    [14.5, -1.5],
    [8, 0.2],
    [3, 1.8],
    [-2, 1.4],
    [-7, 2.8],
    [-14.5, 3.6],
  ];
  const padP = V(-3.5, 0, -7.6);
  const campus = { x: 6.5, z: -6.5 };
  const h = (x: number, z: number) => {
    let y = 0.14 + 0.16 * Math.sin(x * 0.45 + 1) * Math.cos(z * 0.38);
    const d = polyDist(x, z, river);
    y = y * smooth(1.2, 2.6, d) + -0.42 * (1 - smooth(1.2, 2.6, d));
    const dp = Math.hypot(x - padP.x, z - padP.z);
    y = y + (0.16 - y) * (1 - smooth(2.0, 3.0, dp));
    return y;
  };
  const color = (x: number, z: number, y: number): RGB => {
    const d = polyDist(x, z, river);
    if (d < 1.9 || y < -0.05) return P.bank;
    const n = Math.sin(x * 1.3) * Math.cos(z * 1.1);
    return n > 0.4 ? P.grass3 : n < -0.3 ? P.grass2 : P.grass;
  };
  const { inside } = terrain(b, r, { R, seed: 11, h, color, band: P.band });
  ribbon(b, river, 2.5, -0.1, P.water, r);
  padP.y = h(padP.x, padP.z) + 0.12;
  pad(b, padP.x, padP.y, padP.z, 0.82);
  // bridges
  for (const bx of [-0.5, 5.6]) {
    const zc = bx < 2 ? 1.6 : 0.9;
    b.add(box(), mat(bx, 0.05, zc, 0.8, 0.16, 4.2, 0.12), P.stone, 0.02);
    b.add(box(), mat(bx - 0.36, 0.2, zc, 0.07, 0.16, 4.2, 0.12), P.white, 0);
    b.add(box(), mat(bx + 0.36, 0.2, zc, 0.07, 0.16, 4.2, 0.12), P.white, 0);
  }
  // a harbour crane on the east bank
  {
    const cx = 9.8,
      cz = -2.4,
      cy = h(cx, cz);
    b.add(box(), mat(cx, cy, cz, 0.36, 3.4, 0.36), P.yellow, 0.03);
    b.add(box(), mat(cx + 0.9, cy + 3.3, cz, 3.6, 0.3, 0.3), P.yellow, 0.03);
    b.add(box(), mat(cx - 0.75, cy + 3.05, cz, 0.6, 0.5, 0.5), P.ink, 0.03);
    b.add(box(), mat(cx + 2.4, cy + 2.2, cz, 0.04, 1.1, 0.04), P.ink, 0);
  }
  // townhouses along both banks, ridges parallel to the river
  const dense = densify(river, 1.15);
  for (let i = 2; i < dense.length - 2; i++) {
    const [x, z] = dense[i];
    const [x2, z2] = dense[i + 1];
    const phi = Math.atan2(z2 - z, x2 - x);
    const rot = Math.PI / 2 - phi;
    for (const side of [-1, 1]) {
      for (const off of [2.35, 3.55]) {
        if (r() < 0.22) continue;
        const nx = -Math.sin(phi) * side,
          nz = Math.cos(phi) * side;
        const hx = x + nx * off,
          hz = z + nz * off;
        if (!inside(hx * 1.12, hz * 1.12)) continue;
        if (Math.hypot(hx - padP.x, hz - padP.z) < 3.2) continue;
        if (Math.hypot(hx - campus.x, hz - campus.z) < 4.3) continue;
        if (Math.abs(hx - 9.8) < 1.3 && Math.abs(hz + 2.4) < 1.3) continue;
        if ((Math.abs(hx + 0.5) < 0.9 || Math.abs(hx - 5.6) < 0.9) && off < 3) continue;
        const hw = 0.7 + r() * 0.5;
        house(b, hx, h(hx, hz), hz, 0.95, 0.85, hw, 0.42, rot, r() < 0.7 ? P.cream : P.white, P.slate);
      }
    }
  }
  // the campus where the research happened: modern blocks + a grid with three robots
  {
    const y = h(campus.x, campus.z);
    b.add(box(), mat(campus.x + 1.2, y - 0.2, campus.z - 1.2, 3.2, 1.5, 1.6, 0.5), P.white, 0.02);
    b.add(box(), mat(campus.x + 1.2, y + 0.55, campus.z - 1.2, 3.25, 0.28, 1.65, 0.5), P.glass[1], 0.0);
    b.add(box(), mat(campus.x - 1.4, y - 0.2, campus.z - 0.4, 1.4, 1.1, 2.6, 0.5), P.stone, 0.02);
    // the multi-agent grid: 4×4 checker plaza with three robots on it
    const gx = campus.x + 0.6,
      gz = campus.z + 2.0;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        b.add(box(), mat(gx + (i - 1.5) * 0.6, y - 0.2, gz + (j - 1.5) * 0.6, 0.58, 0.26, 0.58), (i + j) % 2 ? P.paving : P.white, 0);
      }
    const bots: [number, number, RGB][] = [
      [0, 1, P.red],
      [2, 3, P.blue],
      [3, 0, P.yellow],
    ];
    for (const [i, j, c] of bots) b.add(box(), mat(gx + (i - 1.5) * 0.6, y + 0.06, gz + (j - 1.5) * 0.6, 0.3, 0.24, 0.3), c, 0);
  }
  // trees on the open ground
  scatter(r, 34, R * 0.95, (x, z) => {
    if (!inside(x * 1.08, z * 1.08)) return false;
    if (polyDist(x, z, river) < 4.4) return false;
    if (Math.hypot(x - padP.x, z - padP.z) < 3.0) return false;
    if (Math.hypot(x - campus.x, z - campus.z) < 4.4) return false;
    return true;
  }, (x, z) => (r() < 0.6 ? tree(b, r, x, h(x, z), z, 0.8 + r() * 0.4) : pine(b, r, x, h(x, z), z, 0.8 + r() * 0.4)));

  return {
    key: "nantes",
    pos,
    R,
    heightAt: (x, z) => (inside(x, z) ? h(x, z) : null),
    geo: b.build(),
    falls: [fallAt(pos, river, 2.1, -0.1, 11)],
    spots: { pad: padP, ring: V(4.5, 4.4, 8.5) },
  };
}

function bordeaux(): Island {
  const pos = V(18, -3, 54);
  const R = 12;
  const r = rng(23);
  const b = new Builder(r);
  // the crescent: an arc of river along the east side
  const arcC = { x: -8.5, z: 0 },
    arcR = 12.6;
  const river: Pt[] = [];
  for (let a = -76; a <= 76; a += 8) {
    const t = (a * Math.PI) / 180;
    river.push([arcC.x + Math.cos(t) * arcR, arcC.z + Math.sin(t) * arcR]);
  }
  const chip = { x: -3.8, z: 0.2 };
  const h = (x: number, z: number) => {
    let y = 0.12 + 0.12 * Math.sin(x * 0.5) * Math.cos(z * 0.45 + 0.5);
    const d = Math.abs(Math.hypot(x - arcC.x, z - arcC.z) - arcR);
    y = y * smooth(1.1, 2.4, d) + -0.42 * (1 - smooth(1.1, 2.4, d));
    const dc = Math.max(Math.abs(x - chip.x), Math.abs(z - chip.z));
    y = y + (0.14 - y) * (1 - smooth(2.6, 3.4, dc));
    return y;
  };
  const vines = (x: number, z: number) => x < -6.4 && x > -11.5 && Math.abs(z) < 5.2;
  const color = (x: number, z: number, y: number): RGB => {
    if (y < -0.05) return P.bank;
    if (vines(x, z)) return P.soil;
    const n = Math.sin(x * 1.1 + 2) * Math.cos(z * 1.3);
    return n > 0.45 ? P.grass3 : n < -0.35 ? P.grass2 : P.grass;
  };
  const { inside } = terrain(b, r, { R, seed: 23, h, color, band: P.band });
  ribbon(b, river, 2.3, -0.1, P.water, r);
  // the crescent of stone facades on the inner bank
  for (let a = -54; a <= 54; a += 6.2) {
    const t = (a * Math.PI) / 180;
    const rr = arcR - 2.45;
    const x = arcC.x + Math.cos(t) * rr,
      z = arcC.z + Math.sin(t) * rr;
    const rot = -t;
    const hw = 1.25 + (Math.abs(a) < 8 ? 0.35 : 0);
    b.add(box(), mat(x, h(x, z) - 0.2, z, 1.0, hw + 0.2, 1.05, rot + Math.PI / 2), P.stone, 0.02);
    b.add(gable(), mat(x, h(x, z) + hw, z, 0.85, 0.36, 1.0 * 1.04, rot), P.mansard, 0.03);
  }
  // stone bridge across the crescent
  b.add(box(), mat(arcC.x + arcR, 0.02, 0, 3.8, 0.2, 0.75), P.stone, 0.02);
  for (let k = -1; k <= 1; k++) b.add(box(), mat(arcC.x + arcR + k * 1.1, -0.42, 0, 0.3, 0.46, 0.75), P.stone, 0.02);
  // the plaza with a microcontroller in it (the virtual STM32)
  {
    const y = h(chip.x, chip.z);
    b.add(box(), mat(chip.x, y - 0.25, chip.z, 5.2, 0.3, 5.2), P.paving, 0.01);
    b.add(box(), mat(chip.x, y, chip.z, 2.6, 0.26, 2.6), P.ink, 0.0);
    for (let k = 0; k < 7; k++) {
      const o = -1.05 + k * 0.35;
      b.add(box(), mat(chip.x + o, y - 0.02, chip.z - 1.48, 0.13, 0.12, 0.38), P.pin, 0);
      b.add(box(), mat(chip.x + o, y - 0.02, chip.z + 1.48, 0.13, 0.12, 0.38), P.pin, 0);
      b.add(box(), mat(chip.x - 1.48, y - 0.02, chip.z + o, 0.38, 0.12, 0.13), P.pin, 0);
      b.add(box(), mat(chip.x + 1.48, y - 0.02, chip.z + o, 0.38, 0.12, 0.13), P.pin, 0);
    }
    b.add(cyl(10), mat(chip.x - 0.85, y + 0.24, chip.z - 0.85, 0.28, 0.04, 0.28), P.grey, 0);
  }
  // vineyard rows on the west side
  for (let k = 0; k < 7; k++) {
    const x = -7 - k * 0.7;
    const len = 9.6 - Math.abs(k - 3) * 0.8;
    if (!inside(x * 1.1, 0)) continue;
    b.add(box(), mat(x, h(x, 0) - 0.05, 0, 0.26, 0.34, len), P.vine, 0.06);
  }
  scatter(r, 22, R * 0.95, (x, z) => {
    if (!inside(x * 1.1, z * 1.1)) return false;
    const d = Math.abs(Math.hypot(x - arcC.x, z - arcC.z) - arcR);
    if (d < 3.9 && x < arcC.x + arcR) return false;
    if (d < 1.8) return false;
    if (vines(x, z) || vines(x - 0.6, z)) return false;
    if (Math.max(Math.abs(x - chip.x), Math.abs(z - chip.z)) < 3.2) return false;
    return true;
  }, (x, z) => tree(b, r, x, h(x, z), z, 0.75 + r() * 0.4));
  return {
    key: "bordeaux",
    pos,
    R,
    heightAt: (x, z) => (inside(x, z) ? h(x, z) : null),
    geo: b.build(),
    falls: [fallAt(pos, river, 1.9, -0.1, 10)],
    spots: { ring: V(chip.x, 4.6, chip.z) },
  };
}

function coimbra(): Island {
  const pos = V(-30, 2, 106);
  const R = 13;
  const r = rng(37);
  const b = new Builder(r);
  const hill = { x: -4.2, z: -3.4, r: 7.6, h: 5.4 };
  const mazes = [
    { x: 3.2, z: 2.6 },
    { x: 7.4, z: -2.6 },
  ];
  const h = (x: number, z: number) => {
    let y = 0.12 + 0.14 * Math.sin(x * 0.6) * Math.cos(z * 0.5);
    const d = Math.hypot(x - hill.x, z - hill.z) / hill.r;
    if (d < 1) y += hill.h * (1 - d * d) * (1 - d * d);
    for (const m of mazes) {
      const dm = Math.max(Math.abs(x - m.x), Math.abs(z - m.z));
      y = y + (0.12 - y) * (1 - smooth(2.4, 3.2, dm));
    }
    return y;
  };
  const color = (x: number, z: number, y: number): RGB => {
    if (y > 1.2) return P.grass3;
    const n = Math.sin(x * 1.2 + 1) * Math.cos(z * 1.4);
    return n > 0.45 ? P.grass3 : n < -0.35 ? P.grass2 : P.grass;
  };
  const { inside } = terrain(b, r, { R, seed: 37, h, color, band: P.band });
  // terraced town on the hill: white walls, terracotta roofs
  for (const d of [1.7, 3.0, 4.3, 5.6, 6.8]) {
    const n = Math.floor((Math.PI * 2 * d) / 1.05);
    for (let k = 0; k < n; k++) {
      if (r() < 0.25) continue;
      const a = (k / n) * Math.PI * 2 + d;
      const x = hill.x + Math.cos(a) * d,
        z = hill.z + Math.sin(a) * d;
      if (!inside(x * 1.1, z * 1.1)) continue;
      const rot = -a;
      house(b, x, h(x, z) - 0.05, z, 0.82, 0.7, 0.55 + r() * 0.35, 0.34, rot, r() < 0.8 ? P.white : P.cream, P.terracotta);
    }
  }
  // a tower at the top of the hill
  {
    const y = h(hill.x, hill.z);
    b.add(box(), mat(hill.x, y - 0.3, hill.z, 1.1, 3.6, 1.1), P.cream, 0.02);
    b.add(box(), mat(hill.x, y + 2.6, hill.z, 1.25, 0.2, 1.25), P.white, 0.0);
    b.add(pyramid(4), mat(hill.x, y + 3.3, hill.z, 1.2, 0.95, 1.2), P.terracotta, 0.02);
    b.add(box(), mat(hill.x, y + 2.1, hill.z + 0.56, 0.42, 0.42, 0.05), P.ink, 0);
  }
  // the two maze competitions: one mapped, one unmapped
  maze(b, r, mazes[0].x, h(mazes[0].x, mazes[0].z), mazes[0].z, 5, 0.78, P.red);
  maze(b, r, mazes[1].x, h(mazes[1].x, mazes[1].z), mazes[1].z, 5, 0.78, P.blue);
  scatter(r, 26, R * 0.95, (x, z) => {
    if (!inside(x * 1.08, z * 1.08)) return false;
    if (Math.hypot(x - hill.x, z - hill.z) < 7.6) return false;
    for (const m of mazes) if (Math.max(Math.abs(x - m.x), Math.abs(z - m.z)) < 2.9) return false;
    return true;
  }, (x, z) => (r() < 0.5 ? pine(b, r, x, h(x, z), z, 0.8 + r() * 0.5) : tree(b, r, x, h(x, z), z, 0.8 + r() * 0.4)));
  return {
    key: "coimbra",
    pos,
    R,
    heightAt: (x, z) => (inside(x, z) ? h(x, z) : null),
    geo: b.build(),
    falls: [],
    spots: { ring: V(5.2, 4.4, 0.2) },
  };
}

function odense(): Island {
  const pos = V(44, 4, -70);
  const R = 12;
  const r = rng(53);
  const b = new Builder(r);
  const canalA: Pt[] = [
    [-12.8, 1.4],
    [-6, 1.2],
    [-1.6, 1.4],
    [2.2, 1.6],
  ];
  const canalB: Pt[] = [
    [-2.2, -12.8],
    [-2.0, -6],
    [-1.8, 1.4],
  ];
  const market = { x: 6.2, z: -3.2 };
  const lot = { x: 6.2, z: 1.4 };
  const h = (x: number, z: number) => {
    let y = 0.14 + 0.1 * Math.sin(x * 0.7) * Math.cos(z * 0.6);
    const d = Math.min(polyDist(x, z, canalA), polyDist(x, z, canalB));
    y = y * smooth(0.9, 1.6, d) + -0.42 * (1 - smooth(0.9, 1.6, d));
    const dm = Math.max(Math.abs(x - market.x) / 3.4, Math.abs(z - (market.z + 2)) / 4.4);
    y = y + (0.14 - y) * (1 - smooth(0.9, 1.15, dm));
    return y;
  };
  const color = (x: number, z: number, y: number): RGB => {
    if (y < -0.05) return P.stone;
    const n = Math.sin(x * 1.3) * Math.cos(z * 1.2 + 1);
    return n > 0.45 ? P.grass3 : n < -0.35 ? P.grass2 : P.grass;
  };
  const { inside } = terrain(b, r, { R, seed: 53, h, color, band: P.band });
  ribbon(b, canalA, 1.5, -0.1, P.water, r);
  ribbon(b, canalB, 1.5, -0.1, P.water, r);
  // colourful gabled houses facing the canals
  const lineUp = (pts: Pt[]) => {
    const d = densify(pts, 0.9);
    for (let i = 1; i < d.length - 1; i++) {
      const [x, z] = d[i];
      const [x2, z2] = d[i + 1];
      const phi = Math.atan2(z2 - z, x2 - x);
      for (const side of [-1, 1]) {
        if (r() < 0.12) continue;
        const nx = -Math.sin(phi) * side,
          nz = Math.cos(phi) * side;
        const hx = x + nx * 1.65,
          hz = z + nz * 1.65;
        if (!inside(hx * 1.12, hz * 1.12)) continue;
        if (Math.min(polyDist(hx, hz, canalA), polyDist(hx, hz, canalB)) < 1.3) continue;
        if (Math.abs(hx - market.x) < 4 && hz > -6 && hz < 4) continue;
        const wall = P.odense[Math.floor(r() * P.odense.length)];
        // gable end faces the water
        house(b, hx, h(hx, hz), hz, 0.72, 0.95, 0.75 + r() * 0.45, 0.62, -phi, wall, P.danish);
      }
    }
  };
  lineUp(canalA);
  lineUp(canalB);
  // little bridges
  b.add(box(), mat(-6.2, 0.02, 1.25, 0.7, 0.16, 2.3), P.white, 0);
  b.add(box(), mat(-2.0, 0.02, -6.0, 2.3, 0.16, 0.7), P.white, 0);
  // the supermarket, its car park, trolleys and the store robot
  {
    const y = 0.14;
    b.add(box(), mat(market.x, y - 0.2, market.z, 5.4, 1.55, 3.4), P.cream, 0.02);
    b.add(box(), mat(market.x, y + 1.35, market.z, 5.6, 0.14, 3.6), P.roofGrey, 0.01);
    b.add(box(), mat(market.x, y + 0.92, market.z + 1.72, 5.42, 0.32, 0.06), P.blue, 0);
    b.add(box(), mat(market.x, y - 0.1, market.z + 1.72, 1.4, 0.85, 0.08), P.glassDoor, 0);
    b.add(box(), mat(market.x + 1.6, y + 1.48, market.z - 0.5, 1.2, 0.3, 0.9), P.grey, 0.02);
    b.add(box(), mat(lot.x, y - 0.22, lot.z + 0.2, 5.6, 0.26, 2.7), P.asphalt, 0.02);
    for (let k = 0; k < 6; k++) b.add(box(), mat(lot.x - 2.3 + k * 0.92, y + 0.04, lot.z + 0.6, 0.06, 0.02, 1.2), P.white, 0);
    for (let k = 0; k < 5; k++) b.add(box(), mat(market.x - 2.3 + k * 0.24, y + 0.03, market.z + 2.25, 0.2, 0.18, 0.3), P.grey, 0.04);
    for (let k = 0; k < 4; k++) b.add(box(), mat(market.x + 1.4 + k * 0.24, y + 0.03, market.z + 2.25, 0.2, 0.18, 0.3), P.grey, 0.04);
    // the robot by the door: a white body with a dark sensor head
    b.add(cyl(10), mat(market.x - 0.9, y + 0.02, market.z + 2.3, 0.42, 0.75, 0.42), P.white, 0);
    b.add(cyl(10), mat(market.x - 0.9, y + 0.77, market.z + 2.3, 0.3, 0.14, 0.3), P.ink, 0);
    b.add(box(), mat(market.x - 0.9, y + 0.5, market.z + 2.52, 0.2, 0.08, 0.02), P.accent, 0);
  }
  scatter(r, 22, R * 0.95, (x, z) => {
    if (!inside(x * 1.08, z * 1.08)) return false;
    if (Math.min(polyDist(x, z, canalA), polyDist(x, z, canalB)) < 3.0) return false;
    if (Math.abs(x - market.x) < 3.4 && z > -5.4 && z < 3.2) return false;
    return true;
  }, (x, z) => tree(b, r, x, h(x, z), z, 0.75 + r() * 0.4));
  return {
    key: "odense",
    pos,
    R,
    heightAt: (x, z) => (inside(x, z) ? h(x, z) : null),
    geo: b.build(),
    falls: [fallAt(pos, canalA.slice().reverse(), 1.3, -0.1, 9), fallAt(pos, canalB.slice().reverse(), 1.3, -0.1, 9)],
    spots: { ring: V(0.8, 4.9, -1.2) },
  };
}

function abuDhabi(): Island {
  const pos = V(134, -2, -22);
  const R = 24;
  const r = rng(71);
  const b = new Builder(r);
  const lagoon = { x: -3, z: 13.5, r: 8.8 };
  // the same outline terrain() will draw (same seed, first draws), so the hangar stays on the island
  const edge = makeOutline(R, rng(71))(Math.atan2(-3.5, 19));
  const hangar = { x: Math.min(18.8, edge - 3.4), z: -3.5 };
  const padP = V(hangar.x - 7.2, 0, -3.5);
  const apron: Vector3[] = [];
  const h = (x: number, z: number) => {
    let y = 0.1 + 0.1 * Math.sin(x * 0.4) * Math.cos(z * 0.5);
    // dunes in the west
    const dw = smooth(-5, -10, x);
    if (dw > 0) {
      const s = Math.sin(x * 0.42 + 1.6 * Math.sin(z * 0.19));
      y += dw * 1.25 * Math.pow(Math.max(0, s), 1.4) + dw * 0.25 * Math.sin(z * 0.6 + x * 0.2);
    }
    // the lagoon, open to the edge in the south
    const dl = Math.hypot(x - lagoon.x, (z - lagoon.z) * 0.9) - lagoon.r;
    const south = z > lagoon.z ? Math.abs(x - lagoon.x) - lagoon.r * 0.85 : dl;
    const dd = Math.min(dl, south);
    y = y * smooth(-0.6, 0.9, dd) + -0.6 * (1 - smooth(-0.6, 0.9, dd));
    const dp = Math.hypot(x - padP.x, z - padP.z);
    y = y + (0.12 - y) * (1 - smooth(5.5, 7.5, Math.min(dp, Math.hypot(x - hangar.x, z - hangar.z))));
    return y;
  };
  const color = (x: number, z: number, y: number): RGB => {
    const dl = Math.hypot(x - lagoon.x, (z - lagoon.z) * 0.9) - lagoon.r;
    if (y < -0.2) return P.beach;
    if (dl < 2.2 || (z > lagoon.z && Math.abs(x - lagoon.x) < lagoon.r + 2.0)) return P.beach;
    return Math.sin(x * 0.9 + z * 0.3) > 0.3 ? P.sand2 : P.sand;
  };
  const { inside } = terrain(b, r, { R, seed: 71, h, color, band: P.sandBand, depth: 1 });
  // sea in the lagoon (deep centre + light shallows)
  const ringPts = (rad: number, sq = 0.9): Pt[] => {
    const pts: Pt[] = [];
    for (let k = 0; k <= 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      pts.push([lagoon.x + Math.cos(a) * rad, lagoon.z + (Math.sin(a) * rad) / sq]);
    }
    return pts;
  };
  const fan = (pts: Pt[], y: number, c: RGB) => {
    const cc = V(lagoon.x, y, lagoon.z + 1);
    for (let k = 0; k < pts.length - 1; k++) b.triUp(cc, V(pts[k][0], y, pts[k][1]), V(pts[k + 1][0], y, pts[k + 1][1]), c, 0.03);
  };
  fan(ringPts(lagoon.r + 0.5), -0.16, P.shallow);
  fan(ringPts(lagoon.r - 1.2), -0.13, P.lagoon);
  // the channel to the edge
  const channel: Pt[] = [
    [lagoon.x, lagoon.z + 4],
    [lagoon.x + 0.4, lagoon.z + 8],
    [lagoon.x + 0.6, 24.6],
  ];
  ribbon(b, channel, 2 * lagoon.r * 0.82, -0.16, P.shallow, r);
  ribbon(b, channel, 2 * lagoon.r * 0.6, -0.13, P.lagoon, r);
  // towers: two clusters either side of an avenue the route flies down
  const towers: { x: number; z: number; s: number; h: number }[] = [];
  const north = { x0: -2, x1: 12, z0: -19, z1: -11.2 };
  const south = { x0: -1, x1: 8, z0: -0.5, z1: 4 };
  for (const cl of [north, south]) {
    for (let x = cl.x0; x <= cl.x1; x += 2.9) {
      for (let z = cl.z0; z <= cl.z1; z += 2.9) {
        const tx = x + (r() - 0.5) * 0.8,
          tz = z + (r() - 0.5) * 0.8;
        if (!inside(tx * 1.15, tz * 1.15)) continue;
        if (Math.hypot(tx - lagoon.x, tz - lagoon.z) < lagoon.r + 2.5) continue;
        if (Math.hypot(tx - padP.x, tz - padP.z) < 5) continue;
        const near = cl === north ? tz > -13 : tz < 1;
        const tall = cl === north ? (near ? 4 + r() * 4 : 6 + r() * 8) : 2.4 + r() * 2.6;
        towers.push({ x: tx, z: tz, s: 1.3 + r() * 0.8, h: tall });
      }
    }
  }
  for (const t of towers) {
    const y = h(t.x, t.z) - 0.2;
    const g = P.glass[Math.floor(r() * P.glass.length)];
    const kind = r();
    if (kind < 0.35) {
      b.add(cyl(8), mat(t.x, y, t.z, t.s, t.h, t.s), g, 0.02);
      b.add(cyl(8, 0.6), mat(t.x, y + t.h, t.z, t.s * 0.8, 0.8, t.s * 0.8), P.crown, 0.02);
    } else if (kind < 0.7) {
      b.add(box(), mat(t.x, y, t.z, t.s, t.h * 0.62, t.s, 0.2), g, 0.02);
      b.add(box(), mat(t.x, y + t.h * 0.62, t.z, t.s * 0.75, t.h * 0.38, t.s * 0.75, 0.2), g, 0.02);
      b.add(box(), mat(t.x, y + t.h, t.z, t.s * 0.5, 0.35, t.s * 0.5, 0.2), P.crown, 0.02);
    } else {
      b.add(box(), mat(t.x, y, t.z, t.s, t.h, t.s * 0.8, 0.6), g, 0.02);
      b.add(pyramid(4), mat(t.x, y + t.h, t.z, t.s * 0.9, 1.2, t.s * 0.7), P.crown, 0.02);
    }
    // a few dark window bands on the square towers
    if (kind >= 0.35) {
      const rot = kind < 0.7 ? 0.2 : 0.6;
      const top = kind < 0.7 ? t.h * 0.62 : t.h;
      const sz = kind < 0.7 ? t.s : t.s;
      const sd = kind < 0.7 ? t.s : t.s * 0.8;
      for (let k = 1.2; k < top - 0.5; k += 1.3) b.add(box(), mat(t.x, y + k, t.z, sz * 1.012, 0.16, sd * 1.012, rot), P.band2, 0);
    }
  }
  // SIRB.AI: the landing pad, the hangar and parked drones on the apron
  padP.y = h(padP.x, padP.z) + 0.12;
  pad(b, padP.x, padP.y, padP.z, 1.1);
  {
    const y = h(hangar.x, hangar.z);
    // half-cylinder hangar lying east-west, its open door facing the pad (west)
    const halfCyl = new CylinderGeometry(1, 1, 1, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
    b.add(halfCyl, mat(hangar.x, y - 0.1, hangar.z, 2.5, 2.3, 5, Math.PI / 2), P.hangar, 0.02);
    b.add(box(), mat(hangar.x - 2.53, y - 0.1, hangar.z, 0.08, 1.9, 2.9), P.hangarDark, 0);
    b.add(box(), mat(hangar.x - 2.5, y + 2.1, hangar.z, 0.1, 0.28, 1.8), P.accent, 0);
    // apron with six small pads: the swarm parks here after the flight
    b.add(box(), mat(hangar.x - 3.6, y - 0.2, hangar.z, 3.2, 0.25, 7.8), P.paving, 0.01);
    for (let k = 0; k < 6; k++) {
      const x = hangar.x - 4.3 + (k % 2) * 1.5,
        z = hangar.z - 2.5 + Math.floor(k / 2) * 2.5;
      b.add(cyl(12), mat(x, y - 0.02, z, 1.0, 0.09, 1.0), P.accent, 0);
      b.add(cyl(12), mat(x, y - 0.02, z, 0.82, 0.1, 0.82), P.padWhite, 0);
      apron.push(V(x, y + 0.08, z));
    }
  }
  // palms around the lagoon
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + r() * 0.2;
    if (Math.sin(a) > 0.55) continue; // the channel side
    const rr = lagoon.r + 1.4 + r() * 1.4;
    const x = lagoon.x + Math.cos(a) * rr,
      z = lagoon.z + (Math.sin(a) * rr) / 0.9;
    if (!inside(x * 1.06, z * 1.06)) continue;
    palm(b, r, x, h(x, z), z, 0.9 + r() * 0.35);
  }
  scatter(r, 10, R * 0.9, (x, z) => x > -2 && x < 12 && z > 6 && z < 12 && inside(x, z) && Math.hypot(x - lagoon.x, z - lagoon.z) > lagoon.r + 2.4, (x, z) =>
    palm(b, r, x, h(x, z), z, 0.85 + r() * 0.3),
  );
  return {
    key: "abudhabi",
    pos,
    R,
    heightAt: (x, z) => (inside(x, z) ? h(x, z) : null),
    geo: b.build(),
    falls: [{ x: pos.x + lagoon.x + 0.6, y: pos.y - 0.14, z: pos.z + 24.0, dx: 0, dz: 1, w: 12, drop: 14 }],
    spots: { ring1: V(-13, 5.6, -7), ring2: V(4.5, 6.2, -6.5), pad: padP, ...Object.fromEntries(apron.map((p, k) => [`apron${k}`, p])) },
  };
}

export function buildIslands(): Island[] {
  return [nantes(), bordeaux(), coimbra(), odense(), abuDhabi()];
}
