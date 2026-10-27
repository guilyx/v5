import { Group, Material, Mesh, Object3D } from "three";
import { PAL, at, axle, box, cyl, merge, ring } from "./kit";

/**
 * A six-axis arm on a pedestal.
 *   q1 base yaw · q2 shoulder pitch · q3 elbow pitch · q4 forearm roll · q5 wrist pitch · q6 tool roll
 * Pitch angles are measured from vertical, positive leaning toward the arm's front.
 */
export const DIM = {
  pedestal: 0.46, // top of the pedestal = arm root
  shoulder: 0.3, // root → shoulder axis
  L1: 0.95, // shoulder → elbow
  L2: 0.86, // elbow → wrist
  L3: 0.3, // wrist axis → tool centre point (between the fingertips)
};
export const SHOULDER_Y = DIM.pedestal + DIM.shoulder;
const FINGER_LEN = 0.17;
const PALM_Y = DIM.L3 - 0.135; // palm sits this far along the tool axis

export type Q = [number, number, number, number, number, number];
export const zeroQ = (): Q => [0, 0, 0, 0, 0, 0];

/**
 * Analytic IK: base yaw + 2-link planar + wrist pitch.
 * Target: tool centre point (x, y, z) in world, tool direction `phi` from vertical in the arm's
 * plane (π = straight down), and tool roll q6. Returns false if the point had to be clamped.
 */
export function solve(x: number, y: number, z: number, phi: number, q6: number, out: Q, q1Hint?: number): boolean {
  const { L1, L2, L3 } = DIM;
  let q1 = Math.atan2(x, z);
  let r = Math.hypot(x, z);
  if (q1Hint !== undefined && r < 0.08) q1 = q1Hint;
  const sy = y - SHOULDER_Y;
  let wr = r - L3 * Math.sin(phi);
  let wy = sy - L3 * Math.cos(phi);
  let d = Math.hypot(wr, wy);
  let ok = true;
  const dMax = L1 + L2 - 1e-3;
  const dMin = Math.abs(L1 - L2) + 0.05;
  if (d > dMax || d < dMin) {
    const k = (d > dMax ? dMax : dMin) / Math.max(d, 1e-6);
    wr *= k;
    wy *= k;
    d = Math.hypot(wr, wy);
    ok = false;
  }
  const c3 = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const q3 = Math.acos(Math.max(-1, Math.min(1, c3)));
  const q2 = Math.atan2(wr, wy) - Math.atan2(L2 * Math.sin(q3), L1 + L2 * Math.cos(q3));
  out[0] = q1;
  out[1] = q2;
  out[2] = q3;
  out[3] = 0;
  out[4] = phi - q2 - q3;
  out[5] = q6;
  return ok;
}

/**
 * Same chain, but the tool may point anywhere: the base and the two links place the wrist,
 * then forearm roll (q4) and wrist pitch (q5) aim the tool along the unit vector d.
 * This is what lets the arm stand in profile and still turn its "head" to look at you.
 */
export function solveDir(px: number, py: number, pz: number, dx: number, dy: number, dz: number, q6: number, out: Q, yaw?: number): boolean {
  const { L1, L2, L3 } = DIM;
  const wx = px - L3 * dx;
  const wz = pz - L3 * dz;
  const q1 = yaw ?? Math.atan2(wx, wz);
  // wrist in the arm's plane (signed radius along the yaw direction)
  let wr = wx * Math.sin(q1) + wz * Math.cos(q1);
  let wy = py - L3 * dy - SHOULDER_Y;
  let d = Math.hypot(wr, wy);
  let ok = true;
  const dMax = L1 + L2 - 1e-3;
  if (d > dMax) {
    wr *= dMax / d;
    wy *= dMax / d;
    d = dMax;
    ok = false;
  }
  const q3 = Math.acos(Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2))));
  const q2 = Math.atan2(wr, wy) - Math.atan2(L2 * Math.sin(q3), L1 + L2 * Math.cos(q3));
  // tool direction in the forearm frame: undo the yaw, then the summed pitch
  const a = q2 + q3;
  const c1 = Math.cos(q1);
  const s1 = Math.sin(q1);
  const x1 = dx * c1 - dz * s1;
  const z1 = dx * s1 + dz * c1;
  const fy = dy * Math.cos(a) + z1 * Math.sin(a);
  const fz = -dy * Math.sin(a) + z1 * Math.cos(a);
  let q5 = Math.acos(Math.max(-1, Math.min(1, fy)));
  let q4 = q5 > 1e-4 ? Math.atan2(x1, fz) : 0;
  // keep the forearm roll small: (q4, q5) and (q4 ± π, −q5) aim the same way
  if (q4 > Math.PI / 2) {
    q4 -= Math.PI;
    q5 = -q5;
  } else if (q4 < -Math.PI / 2) {
    q4 += Math.PI;
    q5 = -q5;
  }
  out[0] = q1;
  out[1] = q2;
  out[2] = q3;
  out[3] = q4;
  out[4] = q5;
  out[5] = q6;
  return ok;
}

export class Arm {
  readonly root = new Group();
  readonly turret = new Group();
  readonly shoulder = new Group();
  readonly elbow = new Group();
  readonly roll = new Group();
  readonly wrist = new Group();
  readonly tool = new Group();
  readonly tcp = new Object3D();
  private readonly fingers: Mesh[] = [];
  readonly meshes: Mesh[] = [];

  constructor(mat: Material) {
    const { L1, L2 } = DIM;
    const add = (parent: Object3D, parts: Parameters<typeof merge>[0]) => {
      const m = new Mesh(merge(parts), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };

    // pedestal: static, lives under root
    const ped = new Group();
    add(ped, [
      at(cyl(0.44, 0.46, 0.04, PAL.graphite, 40), 0, 0.02, 0),
      at(cyl(0.34, 0.37, DIM.pedestal - 0.08, PAL.armShade, 40), 0, 0.04 + (DIM.pedestal - 0.08) / 2, 0),
      at(cyl(0.355, 0.355, 0.035, PAL.joint, 40), 0, DIM.pedestal - 0.1, 0),
      at(cyl(0.33, 0.34, 0.04, PAL.graphite, 40), 0, DIM.pedestal - 0.02, 0),
      // four bolts on the foot
      ...[0, 1, 2, 3].map((i) => at(cyl(0.022, 0.022, 0.02, PAL.steel, 10), Math.cos(i * 1.571 + 0.785) * 0.39, 0.05, Math.sin(i * 1.571 + 0.785) * 0.39)),
    ]);
    this.root.add(ped);

    // q1: turret
    this.turret.position.y = DIM.pedestal;
    this.root.add(this.turret);
    add(this.turret, [
      at(cyl(0.29, 0.31, 0.12, PAL.arm, 40), 0, 0.06, 0),
      at(ring(0.27, 0.012, PAL.graphite, 40), 0, 0.122, 0, Math.PI / 2),
      // shoulder column, offset back so the upper arm has room
      at(box(0.36, 0.26, 0.3, PAL.arm, 0.07), 0, 0.2, -0.02),
    ]);

    // q2: shoulder
    this.shoulder.position.y = DIM.shoulder;
    this.turret.add(this.shoulder);
    add(this.shoulder, [
      axle(0.165, 0.42, PAL.joint),
      at(axle(0.11, 0.44, PAL.graphite), 0, 0, 0),
      at(ring(0.165, 0.012, PAL.graphite, 36), 0.212, 0, 0, 0, Math.PI / 2),
      at(ring(0.165, 0.012, PAL.graphite, 36), -0.212, 0, 0, 0, Math.PI / 2),
      at(box(0.2, L1 - 0.12, 0.23, PAL.arm, 0.085), 0, L1 / 2, 0),
      at(box(0.205, 0.05, 0.235, PAL.armShade, 0.02), 0, L1 * 0.3, 0),
    ]);

    // q3: elbow
    this.elbow.position.y = L1;
    this.shoulder.add(this.elbow);
    add(this.elbow, [
      axle(0.13, 0.32, PAL.joint),
      at(axle(0.085, 0.34, PAL.graphite), 0, 0, 0),
      at(ring(0.13, 0.01, PAL.graphite, 32), 0.162, 0, 0, 0, Math.PI / 2),
      at(ring(0.13, 0.01, PAL.graphite, 32), -0.162, 0, 0, 0, Math.PI / 2),
    ]);

    // q4: forearm roll (kept near zero, it only adds a tilt)
    this.elbow.add(this.roll);
    add(this.roll, [
      at(cyl(0.1, 0.11, 0.1, PAL.graphite, 28), 0, 0.12, 0),
      at(box(0.155, L2 - 0.22, 0.165, PAL.arm, 0.07), 0, 0.17 + (L2 - 0.22) / 2, 0),
      at(cyl(0.085, 0.085, 0.05, PAL.armShade, 28), 0, L2 - 0.1, 0),
    ]);

    // q5: wrist pitch
    this.wrist.position.y = L2;
    this.roll.add(this.wrist);
    add(this.wrist, [axle(0.088, 0.21, PAL.joint), at(axle(0.055, 0.225, PAL.graphite), 0, 0, 0)]);

    // q6: tool roll + gripper
    this.wrist.add(this.tool);
    add(this.tool, [
      at(cyl(0.07, 0.075, 0.07, PAL.graphite, 28), 0, 0.075, 0),
      at(cyl(0.078, 0.078, 0.014, PAL.joint, 28), 0, 0.115, 0),
      at(box(0.36, 0.05, 0.1, PAL.graphite, 0.018), 0, PALM_Y - 0.02, 0),
      at(box(0.33, 0.012, 0.08, PAL.steel, 0.004), 0, PALM_Y + 0.008, 0),
    ]);
    for (const side of [-1, 1]) {
      const f = add(this.tool, [
        at(box(0.032, FINGER_LEN, 0.075, PAL.arm, 0.012), 0, FINGER_LEN / 2, 0),
        at(box(0.012, 0.07, 0.062, PAL.rubber, 0.004), -side * 0.018, FINGER_LEN - 0.045, 0),
      ]);
      f.position.set(side * 0.1, PALM_Y, 0);
      f.userData.side = side;
      this.fingers.push(f);
    }
    this.tcp.position.y = DIM.L3;
    this.tool.add(this.tcp);
  }

  /** grip: 0 closed on an object of width w, 1 fully open. */
  apply(q: Q, grip: number, w: number) {
    this.turret.rotation.y = q[0];
    this.shoulder.rotation.x = q[1];
    this.elbow.rotation.x = q[2];
    this.roll.rotation.y = q[3];
    this.wrist.rotation.x = q[4];
    this.tool.rotation.y = q[5];
    const half = Math.min(0.18, w / 2 + 0.016 + grip * 0.055);
    for (const f of this.fingers) f.position.x = f.userData.side * half;
  }
}
