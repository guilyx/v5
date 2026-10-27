import { LAND_RLE, LAND_STEP } from "./land-data";

export interface LandDots {
  /** xyz per dot on the unit sphere, sorted coarse → fine */
  positions: Float32Array;
  /** 0 = every 1°, 1 = every 0.5°, 2 = every 0.25°; the coarse grids are subsets of the fine one */
  levels: Float32Array;
  /** dots per level */
  counts: [number, number, number];
}

let cache: LandDots | null = null;

/** Decode the run-length rows into a halftone lattice of land dots. */
export function landDots(): LandDots {
  if (cache) return cache;
  const bin = atob(LAND_RLE);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let o = 0;
  const varint = () => {
    let v = 0;
    let s = 0;
    for (;;) {
      const b = bytes[o++];
      v |= (b & 0x7f) << s;
      if (b < 0x80) return v;
      s += 7;
    }
  };

  const buckets: number[][] = [[], [], []];
  const rows = Math.round(180 / LAND_STEP);
  const D = Math.PI / 180;
  for (let k = 0; k < rows; k++) {
    const lat = 90 - (k + 0.5) * LAND_STEP;
    const n = Math.max(1, Math.round((360 * Math.cos(lat * D)) / LAND_STEP));
    const cp = Math.cos(lat * D);
    const sp = Math.sin(lat * D);
    let j = 0;
    let land = false;
    while (j < n) {
      const run = varint();
      if (land) {
        for (let q = j; q < j + run; q++) {
          const lon = (-180 + ((q + 0.5) * 360) / n) * D;
          const level = k % 4 === 0 && q % 4 === 0 ? 0 : k % 2 === 0 && q % 2 === 0 ? 1 : 2;
          buckets[level].push(cp * Math.sin(lon), sp, cp * Math.cos(lon));
        }
      }
      j += run;
      land = !land;
    }
  }

  const counts: [number, number, number] = [buckets[0].length / 3, buckets[1].length / 3, buckets[2].length / 3];
  const total = counts[0] + counts[1] + counts[2];
  const positions = new Float32Array(total * 3);
  const levels = new Float32Array(total);
  let off = 0;
  buckets.forEach((b, lvl) => {
    positions.set(b, off * 3);
    levels.fill(lvl, off, off + b.length / 3);
    off += b.length / 3;
  });
  cache = { positions, levels, counts };
  return cache;
}
