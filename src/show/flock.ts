/**
 * Act V: the drones break formation and flock. Each one steers only by
 * accelerations from its nearest neighbours (separation, alignment, cohesion),
 * at most seven of them, as starlings are thought to do, plus a slow migration
 * point that keeps the flock on stage and a "hawk" at the visitor's cursor.
 * Neighbours come from a uniform grid (linked lists in typed arrays, own cell
 * first), so a step over 1,500 drones costs about a millisecond, and the sim
 * only runs while this act is on screen.
 */

const CELL = 12;
const NX = 36, NY = 20, NZ = 12;

// the 27 neighbouring cells, own cell first so the early exit keeps the closest
const OFFSETS: number[] = [];
for (let r = 0; r <= 3; r++)
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === r) OFFSETS.push(dx, dy, dz);

export class Flock {
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  private readonly head = new Int32Array(NX * NY * NZ);
  private readonly next: Int32Array;
  private readonly cellOf: Int32Array;
  private hawkX = 0;
  private hawkY = 0;
  private hawkOn = false;
  private acc = 0;

  constructor(readonly n: number) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.next = new Int32Array(n);
    this.cellOf = new Int32Array(n * 3);
  }

  init(from: Float32Array) {
    this.pos.set(from);
    for (let i = 0; i < this.n; i++) {
      const x = from[i * 3], y = from[i * 3 + 1];
      const r = Math.sqrt(x * x + y * y) + 1;
      // break formation in a swirl, as a murmuration lifts off
      const jx = Math.sin(i * 12.9898) * 43758.5453, jy = Math.sin(i * 78.233) * 12543.21;
      this.vel[i * 3] = (-y / r) * 42 + (x / r) * 10 + (jx - Math.floor(jx) - 0.5) * 30;
      this.vel[i * 3 + 1] = (x / r) * 30 + (y / r) * 10 + (jy - Math.floor(jy) - 0.5) * 30;
      this.vel[i * 3 + 2] = Math.sin(i * 3.7) * 16;
    }
    this.acc = 0;
  }

  hawk(x: number, y: number, on: boolean) {
    this.hawkX = x;
    this.hawkY = y;
    this.hawkOn = on;
  }

  /** Advance on a fixed 1/60 s step (at most two per frame). */
  update(dt: number, t: number) {
    this.acc = Math.min(this.acc + dt, 2 / 60);
    while (this.acc >= 1 / 60 - 1e-4) {
      this.step(1 / 60, t);
      this.acc -= 1 / 60;
    }
  }

  step(dt: number, t: number) {
    const { n, pos, vel, head, next, cellOf } = this;
    const ox = (NX * CELL) / 2, oy = (NY * CELL) / 2, oz = (NZ * CELL) / 2;
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let cx = ((pos[i3] + ox) / CELL) | 0, cy = ((pos[i3 + 1] + oy) / CELL) | 0, cz = ((pos[i3 + 2] + oz) / CELL) | 0;
      cx = cx < 0 ? 0 : cx >= NX ? NX - 1 : cx;
      cy = cy < 0 ? 0 : cy >= NY ? NY - 1 : cy;
      cz = cz < 0 ? 0 : cz >= NZ ? NZ - 1 : cz;
      cellOf[i3] = cx;
      cellOf[i3 + 1] = cy;
      cellOf[i3 + 2] = cz;
      const c = (cz * NY + cy) * NX + cx;
      next[i] = head[c];
      head[c] = i;
    }
    // the migration point: a slow figure-eight through the stage
    const gx = Math.sin(t * 0.21) * 92;
    const gy = Math.sin(t * 0.37 + 1.1) * 22 - 2;
    const gz = Math.sin(t * 0.16) * 26;
    const R2 = CELL * CELL, S2 = 4.2 * 4.2;
    const vmax = this.hawkOn ? 105 : 72, vmin = 30, amax = 280;
    const hx0 = this.hawkX, hy0 = this.hawkY, hawk = this.hawkOn;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      const vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      const cx = cellOf[i3], cy = cellOf[i3 + 1], cz = cellOf[i3 + 2];
      let cnt = 0, mx = 0, my = 0, mz = 0, wx = 0, wy = 0, wz = 0, sx = 0, sy = 0, sz = 0;
      for (let o = 0; o < OFFSETS.length && cnt < 7; o += 3) {
        const xx = cx + OFFSETS[o], yy = cy + OFFSETS[o + 1], zz = cz + OFFSETS[o + 2];
        if (xx < 0 || yy < 0 || zz < 0 || xx >= NX || yy >= NY || zz >= NZ) continue;
        for (let j = head[(zz * NY + yy) * NX + xx]; j !== -1; j = next[j]) {
          if (j === i) continue;
          const j3 = j * 3;
          const ex = px - pos[j3], ey = py - pos[j3 + 1], ez = pz - pos[j3 + 2];
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 > R2) continue;
          mx += pos[j3];
          my += pos[j3 + 1];
          mz += pos[j3 + 2];
          wx += vel[j3];
          wy += vel[j3 + 1];
          wz += vel[j3 + 2];
          if (d2 < S2) {
            const k = 1 / (d2 + 0.6);
            sx += ex * k;
            sy += ey * k;
            sz += ez * k;
          }
          if (++cnt >= 7) break;
        }
      }
      // each bird wanders a little on its own, so the flock never moves as a rigid block
      const ph = i * 0.731 + t * 1.3;
      let ax = (gx - px) * 0.42 - vx * 0.05 + Math.sin(ph) * 30;
      let ay = (gy - py) * 0.6 - vy * 0.05 + Math.cos(ph * 1.17) * 30;
      let az = (gz - pz) * 0.42 - vz * 0.05 + Math.sin(ph * 0.83) * 20;
      if (cnt) {
        const inv = 1 / cnt;
        ax += (wx * inv - vx) * 2.2 + (mx * inv - px) * 0.9 + sx * 110;
        ay += (wy * inv - vy) * 2.2 + (my * inv - py) * 0.9 + sy * 110;
        az += (wz * inv - vz) * 2.2 + (mz * inv - pz) * 0.9 + sz * 110;
      }
      // a soft stage: never wander off into the city
      if (px > 150) ax -= (px - 150) * 6;
      else if (px < -150) ax -= (px + 150) * 6;
      if (py > 50) ay -= (py - 50) * 9;
      else if (py < -60) ay -= (py + 60) * 9;
      if (pz > 55) az -= (pz - 55) * 6;
      else if (pz < -55) az -= (pz + 55) * 6;
      if (hawk) {
        const hx = px - hx0, hy = py - hy0;
        const d2 = hx * hx + hy * hy;
        if (d2 < 2304 && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const f = ((48 - d) / 48) * 1000;
          ax += (hx / d) * f;
          ay += (hy / d) * f;
          az += (i & 1 ? 1 : -1) * f * 0.25;
        }
      }
      const a2 = ax * ax + ay * ay + az * az;
      if (a2 > amax * amax) {
        const k = amax / Math.sqrt(a2);
        ax *= k;
        ay *= k;
        az *= k;
      }
      let nvx = vx + ax * dt, nvy = vy + ay * dt, nvz = vz + az * dt;
      const v2 = nvx * nvx + nvy * nvy + nvz * nvz;
      if (v2 > vmax * vmax) {
        const k = vmax / Math.sqrt(v2);
        nvx *= k;
        nvy *= k;
        nvz *= k;
      } else if (v2 < vmin * vmin && v2 > 1e-6) {
        const k = vmin / Math.sqrt(v2);
        nvx *= k;
        nvy *= k;
        nvz *= k;
      }
      vel[i3] = nvx;
      vel[i3 + 1] = nvy;
      vel[i3 + 2] = nvz;
    }
    for (let i = 0; i < n * 3; i++) pos[i] += vel[i] * dt;
  }
}
