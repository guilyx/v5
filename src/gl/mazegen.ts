import { rng } from "./kit";

/** the circuitry at the bottom of the dive: a braided maze, 96 x 96 cells of 6 µm */
export const N = 96;
export const CELL_UM = 6;

export interface MazeData {
  /** wall on the east side of cell (x, y) */
  east: Uint8Array;
  /** wall on the north side of cell (x, y) */
  north: Uint8Array;
}

let cached: MazeData | null = null;

export function maze(): MazeData {
  if (cached) return cached;
  const r = rng(2014);
  const east = new Uint8Array(N * N).fill(1);
  const north = new Uint8Array(N * N).fill(1);
  const seen = new Uint8Array(N * N);
  // depth-first carving: long corridors, like routed metal
  const stack = [(N >> 1) * N + (N >> 1)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % N, y = (c / N) | 0;
    const opts: number[] = [];
    if (x + 1 < N && !seen[c + 1]) opts.push(0);
    if (y + 1 < N && !seen[c + N]) opts.push(1);
    if (x > 0 && !seen[c - 1]) opts.push(2);
    if (y > 0 && !seen[c - N]) opts.push(3);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const d = opts[Math.floor(r() * opts.length)];
    const nx = d === 0 ? c + 1 : d === 1 ? c + N : d === 2 ? c - 1 : c - N;
    if (d === 0) east[c] = 0;
    else if (d === 1) north[c] = 0;
    else if (d === 2) east[c - 1] = 0;
    else north[c - N] = 0;
    seen[nx] = 1;
    stack.push(nx);
  }
  // braid: open some dead ends so a planner has real choices
  for (let c = 0; c < N * N; c++) {
    const x = c % N, y = (c / N) | 0;
    const walls = [x + 1 < N ? east[c] : 1, y + 1 < N ? north[c] : 1, x > 0 ? east[c - 1] : 1, y > 0 ? north[c - N] : 1];
    if (walls.reduce((a, b) => a + b, 0) !== 3 || r() > 0.35) continue;
    const d = [0, 1, 2, 3].filter((k) => walls[k] && (k === 0 ? x + 1 < N : k === 1 ? y + 1 < N : k === 2 ? x > 0 : y > 0));
    if (!d.length) continue;
    const k = d[Math.floor(r() * d.length)];
    if (k === 0) east[c] = 0;
    else if (k === 1) north[c] = 0;
    else if (k === 2) east[c - 1] = 0;
    else north[c - N] = 0;
  }
  cached = { east, north };
  return cached;
}

/** can you step from cell c in direction d (0 E, 1 N, 2 W, 3 S)? */
export function open(m: MazeData, c: number, d: number) {
  const x = c % N, y = (c / N) | 0;
  if (d === 0) return x + 1 < N && !m.east[c];
  if (d === 1) return y + 1 < N && !m.north[c];
  if (d === 2) return x > 0 && !m.east[c - 1];
  return y > 0 && !m.north[c - N];
}

/** A* with a Manhattan heuristic; returns the cells from a to b */
export function plan(m: MazeData, a: number, b: number): number[] {
  const g = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const bx = b % N, by = (b / N) | 0;
  const h = (c: number) => Math.abs((c % N) - bx) + Math.abs(((c / N) | 0) - by);
  // a small binary heap of [f, cell]
  const heap: [number, number][] = [];
  const push = (it: [number, number]) => {
    heap.push(it);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let k = i;
        if (l < heap.length && heap[l][0] < heap[k][0]) k = l;
        if (r < heap.length && heap[r][0] < heap[k][0]) k = r;
        if (k === i) break;
        [heap[k], heap[i]] = [heap[i], heap[k]];
        i = k;
      }
    }
    return top;
  };
  g[a] = 0;
  push([h(a), a]);
  const step = [1, N, -1, -N];
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === b) break;
    for (let d = 0; d < 4; d++) {
      if (!open(m, c, d)) continue;
      const nb = c + step[d];
      if (closed[nb] || g[c] + 1 >= g[nb]) continue;
      g[nb] = g[c] + 1;
      from[nb] = c;
      push([g[nb] + h(nb), nb]);
    }
  }
  if (from[b] < 0 && a !== b) return [a];
  const path = [b];
  while (path[path.length - 1] !== a) path.push(from[path[path.length - 1]]);
  return path.reverse();
}
