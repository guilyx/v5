import { Drive } from "./drive";
import { FLY, type Mode, ROLL } from "./modal";

/** flying height above the floor: clear of the walls (0.62) and of the frame (0.86) */
export const ALT = 1.75;
const MORPH_T = 1.25;

export type Step =
  | { kind: "roll"; pts: [number, number][] }
  | { kind: "fly"; pts: [number, number][] }
  | { kind: "morph"; to: Mode };

const ease = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** fold and altitude through a morph, t in seconds since it started */
function morphPose(to: Mode, t: number, dur = MORPH_T) {
  const k = t / dur;
  if (to === FLY) return { fold: ease(0, 0.44, k), alt: ALT * ease(0.36, 1, k) };
  return { fold: 1 - ease(0.5, 1, k), alt: ALT * (1 - ease(0, 0.56, k)) };
}

const pathLength = (pts: [number, number][]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
};

/**
 * Executes a multi-modal plan: rolling legs with the pure-pursuit drive, flying legs with a
 * holonomic follower (a quadrotor doesn't need to face where it goes), and morphs in between:
 * legs fold, rotors spin up, it climbs; or it descends, settles, and the wheels come down.
 */
export class Motion {
  drive = new Drive();
  x = 0;
  z = 0;
  heading = 0;
  alt = 0;
  fold = 0;
  /** the mode it is in, or is morphing into */
  mode: Mode = ROLL;
  morph: { to: Mode; t: number } | null = null;
  steps: Step[] = [];
  /** world-space velocity while flying */
  vx = 0;
  vz = 0;
  /** forward / lateral acceleration, smoothed, for banking */
  aFwd = 0;
  aLat = 0;
  /** keys while flying: a direction in the board's frame */
  manual = { x: 0, y: 0 };
  /** flight leg being followed */
  private fly: { pts: [number, number][]; cum: number[]; s: number } | null = null;
  /** arc length of the legs already finished, so path dots can hide behind the robot */
  private done = 0;
  odo = 0;
  readonly vFly = 5.4;
  private aFly = 11;

  constructor(private bounds: { x: number; z: number }) {}

  get active() {
    return !!this.morph || this.steps.length > 0;
  }
  get flying() {
    return this.mode === FLY && !this.morph;
  }
  /** ground speed */
  get speed() {
    return this.mode === FLY || this.morph ? Math.hypot(this.vx, this.vz) : Math.abs(this.drive.v);
  }
  /** distance travelled along the current plan */
  get progress() {
    if (this.fly) return this.done + this.fly.s;
    if (this.steps[0]?.kind === "roll") return this.done + this.drive.s;
    return this.done;
  }

  setSteps(steps: Step[]) {
    this.steps = steps.slice();
    this.done = 0;
    this.fly = null;
    this.drive.active = false;
    this.begin();
  }
  cancel() {
    this.steps = [];
    this.fly = null;
    this.drive.active = false;
  }
  /** jump straight to a pose (reduced motion) */
  place(x: number, z: number, heading: number, mode: Mode) {
    this.cancel();
    this.morph = null;
    this.x = this.drive.x = x;
    this.z = this.drive.z = z;
    this.heading = this.drive.heading = heading;
    this.mode = mode;
    this.fold = mode === FLY ? 1 : 0;
    this.alt = mode === FLY ? ALT : 0;
    this.vx = this.vz = 0;
    this.drive.v = this.drive.w = 0;
  }

  /** start the step at the head of the queue */
  private begin() {
    const s = this.steps[0];
    if (!s) return;
    if (s.kind === "morph") {
      if (s.to === this.mode && !this.morph) {
        this.steps.shift();
        this.begin();
        return;
      }
      if (!this.morph) {
        this.morph = { to: s.to, t: 0 };
        this.mode = s.to;
        this.drive.v = this.drive.w = 0;
      }
    } else if (s.kind === "roll") {
      this.drive.x = this.x;
      this.drive.z = this.z;
      this.drive.heading = this.heading;
      this.drive.setPath(s.pts);
    } else {
      const cum = [0];
      for (let i = 1; i < s.pts.length; i++)
        cum.push(cum[i - 1] + Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]));
      this.fly = { pts: s.pts, cum, s: 0 };
    }
  }
  private next() {
    const s = this.steps.shift();
    if (s && s.kind !== "morph") this.done += pathLength(s.pts);
    this.fly = null;
    this.begin();
  }

  /** returns true on the frame the plan finishes */
  update(dt: number, reduced: boolean): boolean {
    const had = this.active;
    // a morph runs to its end even if the plan behind it changes
    if (this.morph) {
      this.morph.t += reduced ? MORPH_T : dt;
      const p = morphPose(this.morph.to, this.morph.t);
      this.fold = p.fold;
      this.alt = p.alt;
      this.hover(dt, 0, 0);
      if (this.morph.t >= MORPH_T) {
        this.morph = null;
        this.fold = this.mode === FLY ? 1 : 0;
        this.alt = this.mode === FLY ? ALT : 0;
        // carry on with the queue: drops a morph that's now done, starts one that isn't
        this.begin();
      }
    } else {
      const s = this.steps[0];
      if (s?.kind === "roll") {
        this.rollStep(dt);
        if (!this.drive.active) this.next();
      } else if (s?.kind === "fly") {
        if (this.flyStep(dt)) this.next();
      } else if (this.mode === FLY) {
        // no plan: hold position, or fly by hand
        this.hover(dt, this.manual.x * this.vFly * 0.8, this.manual.y * this.vFly * 0.8);
      } else {
        this.rollStep(dt);
      }
    }
    return had && !this.active;
  }

  private rollStep(dt: number) {
    this.drive.update(dt);
    const step = Math.hypot(this.drive.x - this.x, this.drive.z - this.z);
    this.odo += step;
    this.x = this.drive.x;
    this.z = this.drive.z;
    this.heading = this.drive.heading;
    this.vx = this.vz = 0;
  }

  /** accelerate toward a target velocity, bank into it, and yaw toward the direction of travel */
  private hover(dt: number, tvx: number, tvz: number) {
    const dvx = tvx - this.vx;
    const dvz = tvz - this.vz;
    const dv = Math.hypot(dvx, dvz);
    const lim = this.aFly * dt;
    const k = dv > lim ? lim / dv : 1;
    const ax = (dvx * k) / Math.max(dt, 1e-4);
    const az = (dvz * k) / Math.max(dt, 1e-4);
    this.vx += dvx * k;
    this.vz += dvz * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    // stay inside the frame
    const bx = this.bounds.x;
    const bz = this.bounds.z;
    if (Math.abs(this.x) > bx) {
      this.x = Math.sign(this.x) * bx;
      this.vx = 0;
    }
    if (Math.abs(this.z) > bz) {
      this.z = Math.sign(this.z) * bz;
      this.vz = 0;
    }
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.4) {
      let a = Math.atan2(this.vz, this.vx) - this.heading;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      this.heading += Math.sign(a) * Math.min(Math.abs(a), 4.5 * dt);
    }
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const f = 1 - Math.exp(-dt * 8);
    this.aFwd += (ax * c + az * s - this.aFwd) * f;
    this.aLat += (-ax * s + az * c - this.aLat) * f;
    this.odo += sp * dt;
    this.drive.x = this.x;
    this.drive.z = this.z;
    this.drive.heading = this.heading;
  }

  /** follow the flight leg; true when it's done */
  private flyStep(dt: number) {
    const fl = this.fly!;
    const p = fl.pts;
    // progress: closest point on the polyline, never going backwards
    let best = fl.s;
    let bd = Infinity;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1][0];
      const az = p[i - 1][1];
      const dx = p[i][0] - ax;
      const dz = p[i][1] - az;
      const L2 = dx * dx + dz * dz || 1e-6;
      const t = Math.max(0, Math.min(1, ((this.x - ax) * dx + (this.z - az) * dz) / L2));
      const d = (ax + dx * t - this.x) ** 2 + (az + dz * t - this.z) ** 2;
      const s = fl.cum[i - 1] + t * Math.sqrt(L2);
      if (d < bd && s >= fl.s - 0.01) {
        bd = d;
        best = s;
      }
    }
    fl.s = Math.max(fl.s, best);
    const L = fl.cum[fl.cum.length - 1];
    const rem = L - fl.s;
    const end = p[p.length - 1];
    const toEnd = Math.hypot(end[0] - this.x, end[1] - this.z);
    if (rem < 0.04 && toEnd < 0.06 && Math.hypot(this.vx, this.vz) < 0.35) {
      this.x = end[0];
      this.z = end[1];
      this.vx = this.vz = 0;
      return true;
    }
    // aim a little ahead on the leg, and brake so it stops on the landing spot
    const look = Math.min(L, fl.s + 0.9);
    let tx = end[0];
    let tz = end[1];
    for (let i = 1; i < p.length; i++)
      if (fl.cum[i] >= look) {
        const t = (look - fl.cum[i - 1]) / Math.max(1e-6, fl.cum[i] - fl.cum[i - 1]);
        tx = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
        tz = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
        break;
      }
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dl = Math.hypot(dx, dz) || 1;
    const v = Math.min(this.vFly, Math.sqrt(2 * this.aFly * 0.7 * Math.max(0, toEnd)) + 0.05);
    this.hover(dt, (dx / dl) * v, (dz / dl) * v);
    return false;
  }
}

export interface Pose {
  x: number;
  z: number;
  heading: number;
  alt: number;
  fold: number;
  /** 0..1, how fast the rotors spin */
  rotor: number;
}

/**
 * A fast replay of a plan, for the ghost that previews the motion before the robot sets off.
 * It's a timeline, not a simulation: constant speed along each leg, quick morphs.
 */
export class Rehearsal {
  private keys: { t: number; dur: number; step: Step | null; from: Pose; len: number }[] = [];
  duration = 0;
  constructor(start: Pose, steps: Step[], speed = { roll: 13, fly: 17, morph: 0.42 }) {
    let pose = { ...start };
    let t = 0;
    for (const s of steps) {
      if (s.kind === "morph") {
        const dur = speed.morph;
        this.keys.push({ t, dur, step: s, from: pose, len: 0 });
        const e = morphPose(s.to, MORPH_T);
        pose = { ...pose, fold: e.fold, alt: e.alt, rotor: s.to === FLY ? 1 : 0 };
        t += dur;
      } else {
        const len = pathLength(s.pts);
        if (len < 1e-3) continue;
        const dur = len / (s.kind === "roll" ? speed.roll : speed.fly);
        this.keys.push({ t, dur, step: s, from: pose, len });
        const a = s.pts[s.pts.length - 2];
        const b = s.pts[s.pts.length - 1];
        pose = { ...pose, x: b[0], z: b[1], heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
        t += dur;
      }
    }
    this.duration = t;
    this.keys.push({ t, dur: 0, step: null, from: pose, len: 0 });
  }
  at(t: number): Pose {
    const k = this.keys.find((kk) => t < kk.t + kk.dur) ?? this.keys[this.keys.length - 1];
    const s = k.step;
    if (!s) return k.from;
    const u = Math.min(1, Math.max(0, (t - k.t) / Math.max(1e-6, k.dur)));
    if (s.kind === "morph") {
      const p = morphPose(s.to, u * MORPH_T);
      return { ...k.from, fold: p.fold, alt: p.alt, rotor: s.to === FLY ? Math.min(1, u * 2) : 1 - u };
    }
    // position along the polyline
    let d = u * k.len;
    const p = s.pts;
    for (let i = 1; i < p.length; i++) {
      const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (d <= L || i === p.length - 1) {
        const f = L > 0 ? Math.min(1, d / L) : 1;
        return {
          ...k.from,
          x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f,
          z: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f,
          heading: Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]),
        };
      }
      d -= L;
    }
    return k.from;
  }
}
