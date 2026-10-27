/**
 * The physical nesting of the zoom, in metres (float64), measured from the very
 * bottom of the dive: the centre of the circuitry maze.
 *
 * Every level keeps its own geometry in its own unit (10^k m) and is drawn
 * scaled by 10^(k - s) around the focus point, so nothing ever needs huge or
 * tiny float32 coordinates: the camera never moves, the world does.
 */
export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

export const R_EARTH = 6.371e6;
export const AD = { lat: 24.454, lon: 54.377 };
/** drones fly this high above the water */
export const ALT = 30;
/** the drone we dive into: the apex of the formation, relative to its centroid */
export const APEX: V3 = [0, 40.4, 0];
/** the swarm hovers about 1.5 km off the Abu Dhabi coast */
export const SWARM_FROM_AD: V3 = [-4000, 4000, 0];

// bottom-up
export const O_MAZE: V3 = [0, 0, 0];
/** die centre; the die's top face is z = 0. The chip level's origin. */
export const O_DIE: V3 = [-0.0003, 0.00022, 0];
export const O_PKG: V3 = O_DIE;
/** board top surface, just under the package's standoff */
export const BOARD_TOP = -0.00095;
/** where the microcontroller sits on the board, from the board's centre (metres) */
export const MCU_ON_BOARD: [number, number] = [0.0055, -0.004];
export const O_BOARD: V3 = [O_PKG[0] - MCU_ON_BOARD[0], O_PKG[1] - MCU_ON_BOARD[1], BOARD_TOP];
/** the drone's own origin is its flight controller's top face */
export const O_DRONE: V3 = O_BOARD;
/** the water surface right under the formation's centroid */
export const O_SEA: V3 = [O_DRONE[0] - APEX[0], O_DRONE[1] - APEX[1], O_DRONE[2] - ALT];
export const O_AD: V3 = sub(O_SEA, SWARM_FROM_AD);
export const O_EARTH: V3 = [O_AD[0], O_AD[1], O_AD[2] - R_EARTH];

/** What each chapter frames (centre of view, metres). Keys are the stop ids in index.html. */
export const FRAME: Record<string, V3> = {
  now: O_AD,
  sirb: add(O_AD, [34e3, 30e3, 0]),
  unchained: add(O_SEA, [1300, -1000, 0]),
  "tii-lead": add(O_SEA, [0, 0, ALT]),
  tii: add(O_DRONE, [0, 0, 0.03]),
  coalescent: add(O_DRONE, [0, 0, 0.03]),
  centrale: O_BOARD,
  coimbra: add(O_PKG, [0, 0, 0.00055]),
  hiventive: O_DIE,
  nantes: O_MAZE,
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The point the camera looks at, for exponent s. Between two chapters the next
 * framing centre slides to the middle of the screen while you zoom toward it:
 * its on-screen offset only ever shrinks, so the zoom never swings sideways.
 */
export function focusAt(s: number, stops: { id: string; s: number }[]): V3 {
  const n = stops.length;
  if (s >= stops[0].s) return FRAME[stops[0].id];
  if (s <= stops[n - 1].s) return FRAME[stops[n - 1].id];
  let i = 0;
  while (i < n - 2 && s < stops[i + 1].s) i++;
  const a = stops[i], b = stops[i + 1];
  const t = (a.s - s) / (a.s - b.s);
  const w = (1 - smooth(t)) * Math.pow(10, s - a.s);
  const ga = FRAME[a.id], gb = FRAME[b.id];
  return [gb[0] + (ga[0] - gb[0]) * w, gb[1] + (ga[1] - gb[1]) * w, gb[2] + (ga[2] - gb[2]) * w];
}
