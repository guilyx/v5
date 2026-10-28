import { FLOOR, H, W, type Maze, idx } from "./layout";

export interface Plan {
  /** cell indices from start to goal (inclusive) */
  cells: number[];
  /** cells in the order A* closed them; drawn as the search frontier */
  expanded: number[];
}

const SQ2 = Math.SQRT2;
const NB: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2],
];

// buffers reused between plans: a plan allocates nothing but its result
const g = new Float32Array(W * H);
const parent = new Int32Array(W * H);
const state = new Uint8Array(W * H); // 0 new, 1 open, 2 closed
const heap = new Int32Array(W * H * 4);
const f = new Float32Array(W * H);

/** 8-connected A*, octile heuristic, no cutting corners past a wall. */
export function astar(m: Maze, sx: number, sy: number, gx: number, gy: number): Plan | null {
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m.grid[idx(x, y)] === FLOOR;
  if (!free(sx, sy) || !free(gx, gy)) return null;
  state.fill(0);
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy);
  };
  let n = 0;
  const push = (i: number) => {
    let k = n++;
    heap[k] = i;
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

  const s = idx(sx, sy);
  const goal = idx(gx, gy);
  g[s] = 0;
  f[s] = h(sx, sy);
  parent[s] = -1;
  state[s] = 1;
  push(s);
  const expanded: number[] = [];
  while (n > 0) {
    const cur = pop();
    if (state[cur] === 2) continue;
    state[cur] = 2;
    expanded.push(cur);
    if (cur === goal) break;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (const [dx, dy, c] of NB) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      if (state[ni] === 2) continue;
      const ng = g[cur] + c;
      if (state[ni] === 1 && ng >= g[ni]) continue;
      g[ni] = ng;
      // slight tie-break toward the goal keeps the frontier tidy
      f[ni] = ng + h(nx, ny) * 1.001;
      parent[ni] = cur;
      state[ni] = 1;
      push(ni);
    }
  }
  if (state[goal] !== 2) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = parent[c]) cells.push(c);
  cells.reverse();
  return { cells, expanded };
}

/** Breadth-first flood: the closest walkable cell to (x, y). Used when a click lands on a wall. */
export function nearestFree(m: Maze, x: number, y: number): [number, number] | null {
  x = Math.max(0, Math.min(W - 1, x));
  y = Math.max(0, Math.min(H - 1, y));
  if (m.grid[idx(x, y)] === FLOOR) return [x, y];
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let r = 1; r < 6 && !best; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || m.grid[idx(nx, ny)] !== FLOOR) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = [nx, ny];
        }
      }
  return best;
}

/**
 * Is the straight segment between two world points drivable? Samples it, and keeps the
 * robot's radius clear of the thin walls and of props.
 */
export function segmentClear(m: Maze, ax: number, az: number, bx: number, bz: number, radius = 0.34) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 0.12));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!pointClear(m, ax + (bx - ax) * t, az + (bz - az) * t, radius)) return false;
  }
  return true;
}

export function pointClear(m: Maze, wx: number, wz: number, radius: number) {
  const gx = wx + W / 2;
  const gz = wz + H / 2;
  const cx = Math.floor(gx);
  const cz = Math.floor(gz);
  if (cx < 0 || cz < 0 || cx >= W || cz >= H || m.grid[idx(cx, cz)] !== FLOOR) return false;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const v = m.grid[idx(x, z)];
      if (v === FLOOR) continue;
      // walls are drawn thin (the slab sits on the cell's centre line); props fill most of their cell
      const half = v === 2 ? 0.44 : 0.17;
      const ox = Math.max(Math.abs(gx - (x + 0.5)) - half, 0);
      const oz = Math.max(Math.abs(gz - (z + 0.5)) - half, 0);
      if (ox * ox + oz * oz < radius * radius) return false;
    }
  return true;
}

/** String-pull the grid path into a few straight legs the robot can drive. */
export function smooth(m: Maze, cells: number[], from?: [number, number]): [number, number][] {
  const pts: [number, number][] = cells.map((c) => {
    const x = c % W;
    const y = (c - x) / W;
    return [x - W / 2 + 0.5, y - H / 2 + 0.5];
  });
  if (from) pts[0] = from;
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && segmentClear(m, pts[i][0], pts[i][1], pts[j + 1][0], pts[j + 1][1])) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
