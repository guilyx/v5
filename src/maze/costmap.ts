import { H, type Maze, W, idx } from "./layout";
import { FRAME_H, solidAt } from "./floor";

/**
 * Costmaps, the way a ROS 2 navigation stack builds them: obstacles are lethal, a band the
 * size of the robot around them is "inscribed" (the centre can't go there without touching),
 * and cost decays exponentially out to an inflation radius.
 *
 * Two layers, because M4 has two bodies: rolling, every wall and prop is an obstacle; flying,
 * only the board's frame is, and the walls below are just "overflown".
 *
 * Values follow nav2: 254 lethal, 253 inscribed, 1..252 inflated, 0 free.
 */

/** texels per cell: fine enough that every thin wall slab lands on at least one texel centre */
export const CM_SUB = 4;
const LETHAL = 254;
const INSCRIBED = 253;
const OVERFLY = 70;

export interface Costmaps {
  /** RG bytes, CM_SUB texels per cell: R = rolling cost, G = flying cost */
  data: Uint8Array;
  width: number;
  height: number;
  /** rolling cost per cell, 0..1, sampled at the cell centre; feeds the planner */
  rollCell: Float32Array;
}

/** two-pass chamfer distance (in texels) to the nearest marked texel */
function distance(mask: Uint8Array, w: number, h: number) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  return d;
}

function inflate(dist: number, inscribed: number, radius: number, decay: number) {
  if (dist <= 0) return LETHAL;
  if (dist < inscribed) return INSCRIBED;
  if (dist > radius) return 0;
  return Math.max(1, Math.round(252 * Math.exp(-decay * (dist - inscribed))));
}

export function buildCostmaps(m: Maze): Costmaps {
  const w = W * CM_SUB;
  const h = H * CM_SUB;
  const rollMask = new Uint8Array(w * h);
  const frameMask = new Uint8Array(w * h);
  const overfly = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = (x + 0.5) / CM_SUB;
      const gz = (y + 0.5) / CM_SUB;
      const s = solidAt(m, gx, gz);
      const i = y * w + x;
      if (s > 0) rollMask[i] = 1;
      if (s >= FRAME_H - 1e-3) frameMask[i] = 1;
      else if (s > 0) overfly[i] = 1;
    }
  const texel = 1 / CM_SUB;
  const dRoll = distance(rollMask, w, h);
  const dFly = distance(frameMask, w, h);
  const data = new Uint8Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    // rolling: M4's half-width is ~0.3 cells; inflate out to a cell
    data[i * 2] = inflate(dRoll[i] * texel, 0.32, 1.05, 3.2);
    // flying: the rotors spread wider, but only the frame stands in the way
    const f = inflate(dFly[i] * texel, 0.5, 1.2, 2.6);
    data[i * 2 + 1] = Math.max(f, overfly[i] ? OVERFLY : 0);
  }
  const rollCell = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = (y * CM_SUB + (CM_SUB >> 1)) * w + x * CM_SUB + (CM_SUB >> 1);
      rollCell[idx(x, y)] = Math.min(1, data[t * 2] / 252);
    }
  return { data, width: w, height: h, rollCell };
}
