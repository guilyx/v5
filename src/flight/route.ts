import { CatmullRomCurve3, Vector3 } from "three";
import type { Island } from "./islands";
import { LEGS, dwell } from "../legs";

export interface Route {
  curve: CatmullRomCurve3;
  /** arc length at each waypoint */
  wp: number[];
  total: number;
  /** waypoint positions (ring centres, pads) */
  points: Vector3[];
  /** progress u → arc length */
  lengthAt(u: number): number;
  /** arc length → curve parameter */
  tAt(L: number): number;
}

/** Height of the pad surface above the pad's anchor, where the drone's feet rest. */
export const PAD_TOP = 0.17;

export function buildRoute(isl: Island[]): Route {
  const [N, B, C, O, A] = isl;
  const W = (i: Island, v: Vector3) => v.clone().add(i.pos);
  const padN = W(N, N.spots.pad);
  const padA = W(A, A.spots.pad);
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

  const pts: Vector3[] = [];
  const wpIdx: number[] = [];
  const add = (p: Vector3, isWp = false) => {
    if (isWp) wpIdx.push(pts.length);
    pts.push(p);
  };
  // 0 · take-off from Nantes
  add(v(padN.x, padN.y + PAD_TOP, padN.z), true);
  add(v(padN.x + 0.05, padN.y + 2.6, padN.z + 0.5));
  add(v(-1, 5.6, 2));
  add(v(5, 6.2, 18));
  add(v(11, 3.8, 40));
  // 1 · Bordeaux
  add(W(B, B.spots.ring), true);
  add(v(10, 3.8, 68));
  add(v(-6, 6.8, 88));
  // 2 · Coimbra
  add(W(C, C.spots.ring), true);
  add(v(-37, 7.5, 118));
  add(v(-53, 9, 111));
  add(v(-57, 10, 89));
  add(v(-45, 10, 58));
  add(v(-23, 8, 26));
  // 3 · Nantes, again
  add(W(N, N.spots.ring), true);
  add(v(14, 7.5, -28));
  add(v(32, 9.5, -54));
  // 4 · Odense
  add(W(O, O.spots.ring), true);
  add(v(58, 10, -82));
  add(v(84, 10, -70));
  add(v(106, 7, -44));
  // 5, 6 · Abu Dhabi
  add(W(A, A.spots.ring1), true);
  add(W(A, A.spots.ring2), true);
  add(v(padA.x - 3, padA.y + 3.2, padA.z - 1.4));
  add(v(padA.x - 0.05, padA.y + 1.3, padA.z - 0.1));
  // 7 · landing at SIRB.AI
  add(v(padA.x, padA.y + PAD_TOP, padA.z), true);

  const curve = new CatmullRomCurve3(pts, false, "centripetal", 0.5);
  const DIV = (pts.length - 1) * 200;
  curve.arcLengthDivisions = DIV;
  const lengths = curve.getLengths(DIV);
  const total = lengths[DIV];
  const wp = wpIdx.map((i) => lengths[i * 200]);

  return {
    curve,
    wp,
    total,
    points: wpIdx.map((i) => pts[i].clone()),
    lengthAt(u: number) {
      if (u <= 0) return 0;
      if (u >= LEGS) return total;
      const k = Math.floor(u);
      return wp[k] + (wp[k + 1] - wp[k]) * dwell(u - k);
    },
    tAt(L: number) {
      return curve.getUtoTmapping(0, Math.max(0, Math.min(total, L)));
    },
  };
}
