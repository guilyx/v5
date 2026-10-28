import { FLOOR, H, type Maze, W, idx } from "./layout";

/**
 * Multi-modal A* for a robot that can roll and fly, like M4.
 *
 * The search runs over (cell, mode) states. Rolling moves need floor; flying moves pass over
 * walls and props but not the board's frame; switching mode (a morph) happens in place, only
 * where the robot can stand. Every edge costs energy plus a weight times time, so one slider
 * trades a cheap, slow roll against an expensive, quick flight.
 *
 * The heuristic stays admissible: the octile distance times the cheapest per-cell cost of
 * either mode, plus one morph when the robot is in the air, because every plan ends landed.
 */

export const ROLL = 0;
export const FLY = 1;
export type Mode = typeof ROLL | typeof FLY;
export type PlanKind = "hybrid" | "roll" | "fly";

/**
 * The cost model, per cell travelled and per morph. Time in seconds; energy in arbitrary units.
 * Flying is faster but burns several times the energy of rolling; a morph costs a second.
 */
export const MODEL = {
  roll: { t: 0.3, e: 1 },
  fly: { t: 0.12, e: 3.5 },
  morph: { t: 1.0, e: 2 },
};

export interface Weights {
  /** weight on time against energy */
  w: number;
  roll: number;
  fly: number;
  morph: number;
  /** extra rolling cost near walls, from the costmap (0..1 per cell) */
  inflation: number;
}

/** pref 0 = save energy, 1 = save time */
export function weights(pref: number): Weights {
  const w = 1 * Math.pow(40, pref);
  return {
    w,
    roll: MODEL.roll.e + w * MODEL.roll.t,
    fly: MODEL.fly.e + w * MODEL.fly.t,
    morph: MODEL.morph.e + w * MODEL.morph.t,
    inflation: 0.6,
  };
}

export interface Segment {
  mode: Mode;
  cells: number[];
}

export interface ModalPlan {
  kind: PlanKind;
  segs: Segment[];
  /** closed states in order, packed as cell * 2 + mode */
  expanded: number[];
  cost: number;
  time: number;
  energy: number;
  morphs: number;
  /** cells travelled, rolling and flying */
  rolled: number;
  flown: number;
}

const SQ2 = Math.SQRT2;
const NB: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2],
];

const N = W * H * 2;
const g = new Float32Array(N);
const f = new Float32Array(N);
const parent = new Int32Array(N);
const state = new Uint8Array(N);
// a state can be pushed once per incoming edge: eight moves and a morph
const heap = new Int32Array(N * 9);

export const canRoll = (m: Maze, x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m.grid[idx(x, y)] === FLOOR;
/** anywhere inside the frame: flying clears the walls and the props */
export const canFly = (_m: Maze, x: number, y: number) => x > 0 && y > 0 && x < W - 1 && y < H - 1;

/**
 * @param cost rolling cost per cell from the costmap, 0..1 (inflation near walls)
 */
export function planModal(
  m: Maze,
  cost: Float32Array,
  sx: number,
  sy: number,
  sMode: Mode,
  gx: number,
  gy: number,
  kind: PlanKind,
  wt: Weights,
): ModalPlan | null {
  if (!canRoll(m, gx, gy)) return null;
  if (sMode === ROLL ? !canRoll(m, sx, sy) : !canFly(m, sx, sy)) return null;
  const rollMoves = kind !== "fly";
  const flyMoves = kind !== "roll";
  const cmin = Math.min(rollMoves ? wt.roll : Infinity, flyMoves ? wt.fly : Infinity);
  const goalCell = idx(gx, gy);
  const startCell = idx(sx, sy);
  // a roll-only plan may still land first if it starts in the air; a fly-only plan may only
  // morph where it starts and where it ends
  const canMorphAt = (c: number) =>
    m.grid[c] === FLOOR && (kind === "hybrid" || c === startCell || c === goalCell);

  const h = (c: number, mode: number) => {
    const x = c % W;
    const y = (c - x) / W;
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return (Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy)) * cmin + (mode === FLY ? wt.morph : 0);
  };

  state.fill(0);
  let n = 0;
  const push = (s: number) => {
    let k = n++;
    heap[k] = s;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    heap[0] = heap[--n];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let s = k;
      if (l < n && f[heap[l]] < f[heap[s]]) s = l;
      if (r < n && f[heap[r]] < f[heap[s]]) s = r;
      if (s === k) break;
      [heap[s], heap[k]] = [heap[k], heap[s]];
      k = s;
    }
    return top;
  };
  const relax = (from: number, to: number, c: number) => {
    if (state[to] === 2) return;
    const ng = g[from] + c;
    if (state[to] === 1 && ng >= g[to]) return;
    g[to] = ng;
    f[to] = ng + h(to >> 1, to & 1) * 1.001;
    parent[to] = from;
    state[to] = 1;
    push(to);
  };

  const s0 = startCell * 2 + sMode;
  const goal = goalCell * 2 + ROLL;
  g[s0] = 0;
  f[s0] = h(startCell, sMode);
  parent[s0] = -1;
  state[s0] = 1;
  push(s0);
  const expanded: number[] = [];
  while (n > 0) {
    const cur = pop();
    if (state[cur] === 2) continue;
    state[cur] = 2;
    expanded.push(cur);
    if (cur === goal) break;
    const c = cur >> 1;
    const mode = cur & 1;
    const cx = c % W;
    const cy = (c - cx) / W;
    // morph in place
    if (canMorphAt(c)) relax(cur, c * 2 + (1 - mode), wt.morph);
    for (const [dx, dy, d] of NB) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (mode === ROLL) {
        if (!rollMoves || !canRoll(m, nx, ny)) continue;
        if (dx && dy && (!canRoll(m, cx + dx, cy) || !canRoll(m, cx, cy + dy))) continue;
        const ni = idx(nx, ny);
        relax(cur, ni * 2 + ROLL, d * wt.roll * (1 + wt.inflation * cost[ni]));
      } else {
        if (!flyMoves || !canFly(m, nx, ny)) continue;
        relax(cur, idx(nx, ny) * 2 + FLY, d * wt.fly);
      }
    }
  }
  if (state[goal] !== 2) return null;

  // walk back, then split into segments by mode
  const chain: number[] = [];
  for (let s = goal; s !== -1; s = parent[s]) chain.push(s);
  chain.reverse();
  const segs: Segment[] = [];
  let time = 0;
  let energy = 0;
  let morphs = 0;
  let rolled = 0;
  let flown = 0;
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i] >> 1;
    const mode = (chain[i] & 1) as Mode;
    const last = segs[segs.length - 1];
    if (!last || last.mode !== mode) segs.push({ mode, cells: [c] });
    else last.cells.push(c);
    if (i === 0) continue;
    const pc = chain[i - 1] >> 1;
    const pm = chain[i - 1] & 1;
    if (pc === c && pm !== mode) {
      morphs++;
      time += MODEL.morph.t;
      energy += MODEL.morph.e;
      continue;
    }
    const d = Math.hypot((c % W) - (pc % W), Math.floor(c / W) - Math.floor(pc / W));
    const k = mode === ROLL ? MODEL.roll : MODEL.fly;
    time += d * k.t;
    energy += d * k.e;
    if (mode === ROLL) rolled += d;
    else flown += d;
  }
  return { kind, segs, expanded, cost: g[goal], time, energy, morphs, rolled, flown };
}
