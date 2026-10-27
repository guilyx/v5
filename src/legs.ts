/**
 * The flight plan, shared by the page (no three.js) and the 3D scene.
 * Waypoint k is log entry k; leg k flies waypoint k → k+1.
 * Weights are how many screens of scroll each leg takes.
 */
export const LEG_WEIGHTS = [1.0, 1.0, 1.45, 1.05, 1.2, 0.62, 0.7];
export const LEGS = LEG_WEIGHTS.length; // 7 legs, 8 log entries
/** Screens of scroll spent parked on the pad after landing. */
export const END_HOLD = 0.5;
export const TOTAL_SCREENS = LEG_WEIGHTS.reduce((a, b) => a + b, 0) + END_HOLD;

const STARTS: number[] = [];
for (let i = 0, s = 0; i < LEG_WEIGHTS.length; s += LEG_WEIGHTS[i++]) STARTS.push(s);

/** Scroll (in screens from the top of the flight) → route progress u ∈ [0, LEGS]. */
export function uFromScreens(s: number): number {
  if (s <= 0) return 0;
  for (let k = 0; k < LEGS; k++) {
    const w = LEG_WEIGHTS[k];
    if (s < STARTS[k] + w) return k + (s - STARTS[k]) / w;
  }
  return LEGS;
}

/** Inverse: where to scroll to sit at progress u. */
export function screensFromU(u: number): number {
  if (u <= 0) return 0;
  if (u >= LEGS) return STARTS[LEGS - 1] + LEG_WEIGHTS[LEGS - 1];
  const k = Math.floor(u);
  return STARTS[k] + (u - k) * LEG_WEIGHTS[k];
}

/** Inside a leg: slow over the islands, quicker between them. */
export function dwell(f: number): number {
  const c = 0.6;
  return f - (c * Math.sin(2 * Math.PI * f)) / (2 * Math.PI);
}
