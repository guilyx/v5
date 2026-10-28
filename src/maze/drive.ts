/**
 * Differential-drive kinematics with a pure-pursuit controller, the way a real mobile robot
 * follows a planned path: it turns on the spot when the path starts behind it, then carves
 * smooth arcs toward a point a little way ahead on the path.
 */
export class Drive {
  x = 0;
  z = 0;
  heading = 0;
  v = 0;
  w = 0;
  /** path legs as a polyline, with cumulative arc length */
  path: [number, number][] = [];
  cum: number[] = [];
  /** progress along the path (arc length of the closest point) */
  s = 0;
  active = false;
  vmax = 6.2;
  wmax = 7.5;
  accel = 14;
  lookahead = 0.7;
  /** total distance driven, for the wheels and the trail */
  odo = 0;

  setPath(pts: [number, number][]) {
    this.path = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++)
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.s = 0;
    this.active = pts.length > 1;
  }

  /** append a leg (keyboard driving keeps extending the path without stopping) */
  extend(pt: [number, number]) {
    const last = this.path[this.path.length - 1];
    this.path.push(pt);
    this.cum.push(this.cum[this.cum.length - 1] + Math.hypot(pt[0] - last[0], pt[1] - last[1]));
    this.active = true;
  }

  get length() {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }
  get remaining() {
    return this.length - this.s;
  }

  pointAt(s: number): [number, number] {
    const p = this.path;
    if (s <= 0) return p[0];
    for (let i = 1; i < p.length; i++) {
      if (this.cum[i] >= s) {
        const t = (s - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
        return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
      }
    }
    return p[p.length - 1];
  }

  /** closest arc length to the robot, searched a little ahead of the current progress */
  private project() {
    const p = this.path;
    let best = this.s;
    let bd = Infinity;
    for (let i = 1; i < p.length; i++) {
      if (this.cum[i] < this.s - 0.01) continue;
      if (this.cum[i - 1] > this.s + 2.5) break;
      const ax = p[i - 1][0];
      const az = p[i - 1][1];
      const dx = p[i][0] - ax;
      const dz = p[i][1] - az;
      const L2 = dx * dx + dz * dz || 1e-6;
      let t = ((this.x - ax) * dx + (this.z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = (ax + dx * t - this.x) ** 2 + (az + dz * t - this.z) ** 2;
      const s = this.cum[i - 1] + t * Math.sqrt(L2);
      if (d < bd && s >= this.s - 0.01) {
        bd = d;
        best = s;
      }
    }
    this.s = Math.max(this.s, best);
  }

  update(dt: number) {
    if (!this.active) {
      // coast to a stop
      this.v = Math.max(0, this.v - this.accel * dt);
      this.w *= Math.exp(-dt * 12);
      return false;
    }
    this.project();
    const rem = this.remaining;
    const end = this.path[this.path.length - 1];
    if (rem < 0.04 && Math.hypot(end[0] - this.x, end[1] - this.z) < 0.08) {
      this.x = end[0];
      this.z = end[1];
      this.active = false;
      this.v = 0;
      this.w = 0;
      return true;
    }
    const [tx, tz] = this.pointAt(Math.min(this.length, this.s + this.lookahead));
    let a = Math.atan2(tz - this.z, tx - this.x) - this.heading;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    const dist = Math.hypot(tx - this.x, tz - this.z);

    let vt: number;
    let wt: number;
    if (Math.abs(a) > 1.1 && dist > 0.05) {
      // spin in place to face the path
      vt = 0;
      wt = Math.sign(a) * this.wmax;
    } else {
      const brake = Math.sqrt(2 * this.accel * 0.55 * Math.max(0, rem));
      vt = Math.min(this.vmax * (1 - 0.55 * Math.min(1, Math.abs(a) / 1.1)), brake + 0.25);
      const L = Math.max(0.2, dist);
      wt = (2 * Math.max(vt, 0.6) * Math.sin(a)) / L;
      wt = Math.max(-this.wmax, Math.min(this.wmax, wt));
    }
    const dv = vt - this.v;
    this.v += Math.sign(dv) * Math.min(Math.abs(dv), this.accel * dt);
    this.w += (wt - this.w) * Math.min(1, dt * 18);
    this.heading += this.w * dt;
    const step = this.v * dt;
    this.x += Math.cos(this.heading) * step;
    this.z += Math.sin(this.heading) * step;
    this.odo += step;
    return false;
  }
}
