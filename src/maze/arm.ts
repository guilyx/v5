import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PAL, clay, plain, tint } from "./gfx";

/**
 * A small arm on M4's left flank: a turret (yaw), a shoulder and an elbow (pitch), and a wrist
 * that always keeps the gripper pointing straight down, so picking and placing is a 3-DOF problem
 * with a closed-form solution. It folds flat along the side to stow (the middle of the back is
 * the lift deck's), and stays stowed in the air.
 *
 * All lengths are in the robot's local, unscaled frame (+x forward, +y up, +z right of the nose).
 */

/** where the turret is mounted: on a bracket off the left side of the shell */
export const ARM_BASE = { x: -0.04, y: 0.34, z: -0.16 };
const TURRET_H = 0.08;
export const L1 = 0.46;
export const L2 = 0.47;
/** wrist to the grip point between the fingers */
export const LG = 0.12;
const SHOULDER_Y = ARM_BASE.y + TURRET_H;

/** yaw, shoulder, elbow */
export type Joints = [number, number, number];
/** folded along the side: the upper arm points back, the forearm folds forward over it */
export const STOW: Joints = [0, Math.PI + 0.12, -Math.PI - 0.07];

export interface ArmParts {
  group: THREE.Group;
  /** the point between the fingertips; carried objects are attached here */
  grip: THREE.Group;
  /** pose the arm: joints, and how far the gripper is open (0 closed, 1 open) */
  set(q: Joints, open: number): void;
}

export function buildArm(shared?: THREE.Material): ArmParts {
  const mat = shared ?? clay({ vertexColors: true });
  const part = (geos: [THREE.BufferGeometry, THREE.ColorRepresentation][]) =>
    new THREE.Mesh(mergeGeometries(geos.map(([g, c]) => tint(plain(g), c))), mat);
  const white = PAL.robot;
  const dark = "#3a3840";

  const group = new THREE.Group();
  group.position.set(ARM_BASE.x, ARM_BASE.y, ARM_BASE.z);
  group.add(
    part([
      [new THREE.CylinderGeometry(0.05, 0.055, 0.02, 20).translate(0, 0.01, 0), dark],
      // the bracket back to the shell
      [new THREE.BoxGeometry(0.09, 0.03, 0.06).translate(0, -0.005, 0.04), dark],
    ]),
  );

  const turret = new THREE.Group();
  turret.add(
    part([
      [new THREE.CylinderGeometry(0.04, 0.045, TURRET_H, 16).translate(0, TURRET_H / 2, 0), white],
      [new THREE.CylinderGeometry(0.032, 0.032, 0.09, 14).rotateX(Math.PI / 2).translate(0, TURRET_H, 0), dark],
    ]),
  );
  group.add(turret);

  const shoulder = new THREE.Group();
  shoulder.position.y = TURRET_H;
  shoulder.add(
    part([
      [new THREE.BoxGeometry(L1, 0.034, 0.042).translate(L1 / 2, 0, 0), white],
      [new THREE.BoxGeometry(L1 * 0.6, 0.012, 0.044).translate(L1 * 0.5, 0.012, 0), PAL.accent],
    ]),
  );
  turret.add(shoulder);

  const elbow = new THREE.Group();
  elbow.position.x = L1;
  elbow.add(
    part([
      [new THREE.CylinderGeometry(0.028, 0.028, 0.06, 14).rotateX(Math.PI / 2), dark],
      [new THREE.BoxGeometry(L2, 0.03, 0.034).translate(L2 / 2, 0, 0), white],
    ]),
  );
  shoulder.add(elbow);

  const wrist = new THREE.Group();
  wrist.position.x = L2;
  // the gripper points along the wrist's +x; the wrist pitch turns that straight down
  wrist.add(
    part([
      [new THREE.CylinderGeometry(0.024, 0.024, 0.05, 12).rotateX(Math.PI / 2), dark],
      // the gripper rail the fingers slide along
      [new THREE.BoxGeometry(0.04, 0.29, 0.03).translate(0.035, 0, 0), dark],
    ]),
  );
  elbow.add(wrist);
  // the fingers close across the arm's plane: on a bar, they straddle it
  const fingerGeo = mergeGeometries([tint(plain(new THREE.BoxGeometry(0.075, 0.016, 0.03).translate(0.075 + 0.0375, 0, 0)), PAL.accent)]);
  const fingers = [new THREE.Mesh(fingerGeo, mat), new THREE.Mesh(fingerGeo, mat)];
  for (const f of fingers) wrist.add(f);
  const grip = new THREE.Group();
  grip.position.x = LG;
  wrist.add(grip);

  return {
    group,
    grip,
    set(q, open) {
      turret.rotation.y = q[0];
      shoulder.rotation.z = q[1];
      elbow.rotation.z = q[2];
      wrist.rotation.z = -(q[1] + q[2]) - Math.PI / 2;
      // closed, the fingers just touch a block's faces; open, they clear it
      const y = 0.094 + 0.04 * open;
      fingers[0].position.y = y;
      fingers[1].position.y = -y;
    },
  };
}

/**
 * Closed-form IK for a grip point (robot-local, unscaled), with the gripper pointing down.
 * Elbow up. When the point is out of reach, the arm stretches toward it and `reach` is false.
 */
export function solveIK(px: number, py: number, pz: number): { q: Joints; reach: boolean } {
  const dx = px - ARM_BASE.x;
  const dz = pz - ARM_BASE.z;
  const r = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  // the wrist sits a gripper-length above the grip point
  const h = py + LG - SHOULDER_Y;
  const D = (r * r + h * h - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const reach = D >= -1 && D <= 1;
  const q2 = -Math.acos(Math.max(-1, Math.min(1, D)));
  const q1 = Math.atan2(h, r) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
  return { q: [yaw, q1, q2], reach };
}
