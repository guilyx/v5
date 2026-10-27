import { CylinderGeometry, type BufferGeometry } from "three";
import { Kit } from "./kit";
import { P } from "./palette";
import type { TreeKind } from "./layout";

/** Small reusable models. Each draws into a Kit at (x, y, z). */

export function roundTree(k: Kit, x: number, y: number, z: number, s = 1, crown: string = P.sage) {
  k.cyl(0.028 * s, 0.04 * s, 0.17 * s, 5, x, y, z, P.trunk);
  k.ball(0.17 * s, x, y + 0.27 * s, z, crown, { jitter: 1 });
}

export function blossomTree(k: Kit, x: number, y: number, z: number, s = 1) {
  k.cyl(0.026 * s, 0.038 * s, 0.16 * s, 5, x, y, z, P.trunk);
  k.ball(0.15 * s, x, y + 0.25 * s, z, "#f2c4cf", { jitter: 1 });
  k.ball(0.1 * s, x + 0.08 * s, y + 0.33 * s, z - 0.03 * s, "#f6d3db", { jitter: 1 });
}

export function pineTree(k: Kit, x: number, y: number, z: number, s = 1) {
  k.cyl(0.025 * s, 0.035 * s, 0.1 * s, 5, x, y, z, P.trunk);
  k.cone(0.2 * s, 0.3 * s, 6, x, y + 0.08 * s, z, P.pine, { jitter: 1 });
  k.cone(0.15 * s, 0.26 * s, 6, x, y + 0.24 * s, z, P.pine, { jitter: 1 });
  k.cone(0.09 * s, 0.2 * s, 6, x, y + 0.38 * s, z, "#8db398", { jitter: 1 });
}

export function oliveTree(k: Kit, x: number, y: number, z: number, s = 1) {
  k.cyl(0.03 * s, 0.045 * s, 0.14 * s, 5, x, y, z, "#a88a72");
  k.ball(0.13 * s, x - 0.05 * s, y + 0.2 * s, z, "#aab996", { jitter: 1 });
  k.ball(0.11 * s, x + 0.07 * s, y + 0.24 * s, z + 0.03 * s, "#b6c3a2", { jitter: 1 });
}

export function palmTree(k: Kit, x: number, y: number, z: number, s = 1, spin = 0) {
  const lean = 0.035 * s;
  for (let i = 0; i < 3; i++) k.cyl(0.026 * s, 0.032 * s, 0.17 * s, 5, x + i * lean, y + i * 0.16 * s, z, "#c49a74");
  const tx = x + 3 * lean;
  const ty = y + 0.5 * s;
  for (let i = 0; i < 6; i++) {
    const a = spin + (i / 6) * Math.PI * 2;
    k.box(0.07 * s, 0.018 * s, 0.26 * s, tx + Math.sin(a) * 0.11 * s, ty - 0.03 * s, z + Math.cos(a) * 0.11 * s, i % 2 ? "#8fbb7f" : "#7fae74", {
      ry: a,
      rx: 0.38,
      order: "YXZ",
    });
  }
  k.ball(0.04 * s, tx, ty, z, "#a88a5f");
}

export function tree(kind: TreeKind, k: Kit, x: number, y: number, z: number, s: number, spin: number) {
  if (kind === "pine") pineTree(k, x, y, z, s);
  else if (kind === "palm") palmTree(k, x, y, z, s, spin);
  else if (kind === "olive") oliveTree(k, x, y, z, s);
  else if (kind === "blossom") blossomTree(k, x, y, z, s);
  else roundTree(k, x, y, z, s);
}

/** windows along a face that looks down +z (at depth z) */
export function winsZ(k: Kit, n: number, xa: number, xb: number, y: number, z: number, w = 0.12, h = 0.15) {
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (xa + xb) / 2 : xa + ((xb - xa) * i) / (n - 1);
    k.box(w, h, 0.03, x, y, z, P.glass, { glow: 1 });
  }
}

/** windows along a face that looks down ±x (at x) */
export function winsX(k: Kit, n: number, za: number, zb: number, y: number, x: number, w = 0.12, h = 0.15) {
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? (za + zb) / 2 : za + ((zb - za) * i) / (n - 1);
    k.box(0.03, h, w, x, y, z, P.glass, { glow: 1 });
  }
}

/** a quadcopter, about 1 unit wide; instances scale it down */
export function droneGeometry(): BufferGeometry {
  const k = new Kit();
  k.box(0.9, 0.08, 0.12, 0, -0.04, 0, P.white, { ry: Math.PI / 4 });
  k.box(0.9, 0.08, 0.12, 0, -0.04, 0, P.white, { ry: -Math.PI / 4 });
  k.box(0.28, 0.16, 0.28, 0, -0.08, 0, P.white);
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    k.cyl(0.17, 0.17, 0.04, 8, x * 0.32, 0.03, z * 0.32, P.silver);
  k.ball(0.17, 0, -0.14, 0, P.white, { glow: 2 }, 1);
  return k.build();
}

/** a little person, like a board-game pawn */
export function meepleGeometry(): BufferGeometry {
  const k = new Kit();
  k.cyl(0.045, 0.062, 0.13, 8, 0, 0, 0, P.white);
  k.ball(0.05, 0, 0.18, 0, P.white, {}, 1);
  return k.build();
}

/** a small wheeled robot, facing +z */
export function rollerGeometry(): BufferGeometry {
  const k = new Kit();
  k.cyl(0.07, 0.075, 0.05, 10, 0, 0.015, 0, P.white);
  k.ball(0.052, 0, 0.075, 0, P.powder, {}, 1);
  k.box(0.04, 0.02, 0.02, 0, 0.045, 0.066, P.mint, { glow: 2 });
  for (const sx of [-1, 1]) k.add(new CylinderGeometry(0.032, 0.032, 0.02, 8), sx * 0.074, 0.032, 0, P.charcoal, { rz: Math.PI / 2 });
  return k.build();
}
