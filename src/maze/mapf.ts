/**
 * Multi-agent pathfinding, two ways, from the survey I wrote at Centrale.
 *
 * - Conflict-Based Search (Sharon et al., 2015): optimal for the sum of costs. A high level searches
 *   a tree of constraints; each node plans every agent alone (space-time A*) under its constraints,
 *   finds the first collision between two of them, and branches: one child forbids it to the first
 *   agent, the other to the second.
 * - Prioritized planning: agents plan one after another, each around the reservations of those
 *   before it. Fast, but neither optimal nor complete: an early agent can wall a later one in.
 *
 * Grids are 4-connected, every move or wait costs 1, and an agent that has arrived stays put.
 */

export type Cell = [number, number];

export interface Grid {
  w: number;
  h: number;
  free(x: number, y: number): boolean;
}

export interface Result {
  paths: Cell[][] | null;
  /** sum of costs: each agent's arrival time */
  soc: number;
  makespan: number;
  /** CBS: constraint-tree nodes expanded; prioritized: agents planned */
  expanded: number;
  /** the collisions CBS found and branched on, as (x, y, t) */
  conflicts: [number, number, number][];
  ms: number;
  /** prioritized only: the agent that found no way through */
  failed?: number;
}

const MOVES: Cell[] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** distances to a goal over the free cells: a perfect heuristic for one agent alone */
function distances(g: Grid, [gx, gy]: Cell) {
  const d = new Int32Array(g.w * g.h).fill(-1);
  const q = [gx + gy * g.w];
  d[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    const x = c % g.w;
    const y = (c / g.w) | 0;
    for (let k = 1; k < 5; k++) {
      const nx = x + MOVES[k][0];
      const ny = y + MOVES[k][1];
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || !g.free(nx, ny)) continue;
      const n = nx + ny * g.w;
      if (d[n] >= 0) continue;
      d[n] = d[c] + 1;
      q.push(n);
    }
  }
  return d;
}

/** a binary heap on f, then on larger g (deeper first) */
class Heap<T extends { f: number; g: number }> {
  a: T[] = [];
  push(n: T) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
  private less(x: T, y: T) {
    return x.f < y.f || (x.f === y.f && x.g > y.g);
  }
}

/** what an agent may not do: be at a cell at t, or move a→b arriving at t */
interface Constraints {
  vertex: Set<string>;
  edge: Set<string>;
  /** the last time any vertex constraint sits on each cell: an agent can only stop for good after it */
  lastAt: Map<number, number>;
}

function spaceTime(g: Grid, start: Cell, goal: Cell, h: Int32Array, c: Constraints, horizon: number): Cell[] | null {
  type N = { x: number; y: number; t: number; g: number; f: number; p: N | null };
  const goalIdx = goal[0] + goal[1] * g.w;
  const settle = c.lastAt.get(goalIdx) ?? -1;
  const open = new Heap<N>();
  const h0 = h[start[0] + start[1] * g.w];
  if (h0 < 0) return null;
  open.push({ x: start[0], y: start[1], t: 0, g: 0, f: h0, p: null });
  const seen = new Set<number>();
  const W = g.w * g.h;
  let iter = 0;
  while (open.size && iter++ < 20000) {
    const n = open.pop();
    if (n.x === goal[0] && n.y === goal[1] && n.t > settle) {
      const out: Cell[] = [];
      for (let q: N | null = n; q; q = q.p) out.push([q.x, q.y]);
      return out.reverse();
    }
    if (n.t >= horizon) continue;
    for (const [dx, dy] of MOVES) {
      const x = n.x + dx;
      const y = n.y + dy;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h || !g.free(x, y)) continue;
      const t = n.t + 1;
      if (c.vertex.has(`${x},${y},${t}`)) continue;
      if (c.edge.has(`${n.x},${n.y},${x},${y},${t}`)) continue;
      const key = (x + y * g.w) + t * W;
      if (seen.has(key)) continue;
      seen.add(key);
      const hh = h[x + y * g.w];
      if (hh < 0) continue;
      open.push({ x, y, t, g: n.g + 1, f: n.g + 1 + hh, p: n });
    }
  }
  return null;
}

const at = (p: Cell[], t: number) => p[Math.min(t, p.length - 1)];
/** an agent's cost: the time it reaches its goal for good (trailing waits don't count) */
function cost(p: Cell[]) {
  let n = p.length - 1;
  while (n > 0 && p[n][0] === p[n - 1][0] && p[n][1] === p[n - 1][1]) n--;
  return n;
}

/** the first collision between two paths, if any */
function firstConflict(paths: Cell[][]) {
  const T = Math.max(...paths.map((p) => p.length));
  for (let t = 1; t < T + 1; t++)
    for (let i = 0; i < paths.length; i++)
      for (let j = i + 1; j < paths.length; j++) {
        const a = at(paths[i], t);
        const b = at(paths[j], t);
        if (a[0] === b[0] && a[1] === b[1]) return { kind: "vertex" as const, i, j, t, a };
        const pa = at(paths[i], t - 1);
        const pb = at(paths[j], t - 1);
        if (pa[0] === b[0] && pa[1] === b[1] && pb[0] === a[0] && pb[1] === a[1]) return { kind: "edge" as const, i, j, t, a: pa, b: pb };
      }
  return null;
}

const empty = (): Constraints => ({ vertex: new Set(), edge: new Set(), lastAt: new Map() });
function forbidAt(c: Constraints, w: number, x: number, y: number, t: number) {
  c.vertex.add(`${x},${y},${t}`);
  const key = x + y * w;
  c.lastAt.set(key, Math.max(c.lastAt.get(key) ?? -1, t));
}

function constraintsFor(list: Con[], agent: number, w: number): Constraints {
  const c = empty();
  for (const k of list) {
    if (k.agent !== agent) continue;
    if (k.edge) c.edge.add(`${k.edge[0]},${k.edge[1]},${k.edge[2]},${k.edge[3]},${k.t}`);
    else forbidAt(c, w, k.x, k.y, k.t);
  }
  return c;
}

interface Con {
  agent: number;
  x: number;
  y: number;
  t: number;
  edge?: [number, number, number, number];
}

export function cbs(g: Grid, starts: Cell[], goals: Cell[], opts: { limit?: number; horizon?: number } = {}): Result {
  const t0 = performance.now();
  const limit = opts.limit ?? 500;
  const horizon = opts.horizon ?? 90;
  const hs = goals.map((goal) => distances(g, goal));
  const plan = (i: number, cons: Con[]) => spaceTime(g, starts[i], goals[i], hs[i], constraintsFor(cons, i, g.w), horizon);
  type Node = { cons: Con[]; paths: Cell[][]; f: number; g: number };
  const rootPaths: Cell[][] = [];
  for (let i = 0; i < starts.length; i++) {
    const p = plan(i, []);
    if (!p) return { paths: null, soc: 0, makespan: 0, expanded: 0, conflicts: [], ms: performance.now() - t0 };
    rootPaths.push(p);
  }
  const soc = (ps: Cell[][]) => ps.reduce((s, p) => s + cost(p), 0);
  const open = new Heap<Node>();
  open.push({ cons: [], paths: rootPaths, f: soc(rootPaths), g: 0 });
  const conflicts: [number, number, number][] = [];
  let expanded = 0;
  while (open.size && expanded < limit) {
    const n = open.pop();
    expanded++;
    const c = firstConflict(n.paths);
    if (!c) {
      return {
        paths: n.paths,
        soc: n.f,
        makespan: Math.max(...n.paths.map(cost)),
        expanded,
        conflicts,
        ms: performance.now() - t0,
      };
    }
    conflicts.push([c.a[0], c.a[1], c.t]);
    for (const agent of [c.i, c.j]) {
      let con: Con;
      if (c.kind === "vertex") con = { agent, x: c.a[0], y: c.a[1], t: c.t };
      else {
        const from = agent === c.i ? c.a : c.b;
        const to = agent === c.i ? c.b : c.a;
        con = { agent, x: to[0], y: to[1], t: c.t, edge: [from[0], from[1], to[0], to[1]] };
      }
      const cons = [...n.cons, con];
      const p = plan(agent, cons);
      if (!p) continue;
      const paths = n.paths.slice();
      paths[agent] = p;
      // fewer conflicts first, among equal costs: g counts down with depth
      open.push({ cons, paths, f: soc(paths), g: -cons.length });
    }
  }
  return { paths: null, soc: 0, makespan: 0, expanded, conflicts, ms: performance.now() - t0 };
}

export function prioritized(g: Grid, starts: Cell[], goals: Cell[], horizon = 90): Result {
  const t0 = performance.now();
  // everyone planned so far, as constraints on the next agent: their cells, their moves reversed
  // (no swapping places), and their goals once they've arrived
  const c = empty();
  const paths: Cell[][] = [];
  for (let i = 0; i < starts.length; i++) {
    const parked = paths.map((p) => p[p.length - 1]);
    const own = { ...c, vertex: new Set(c.vertex), lastAt: new Map(c.lastAt) };
    paths.forEach((p, k) => {
      for (let t = p.length; t <= horizon; t++) forbidAt(own, g.w, parked[k][0], parked[k][1], t);
    });
    const p = spaceTime(g, starts[i], goals[i], distances(g, goals[i]), own, horizon);
    if (!p) return { paths: null, soc: 0, makespan: 0, expanded: i + 1, conflicts: [], ms: performance.now() - t0, failed: i };
    paths.push(p);
    for (let t = 0; t < p.length; t++) {
      forbidAt(c, g.w, p[t][0], p[t][1], t);
      if (t > 0) c.edge.add(`${p[t][0]},${p[t][1]},${p[t - 1][0]},${p[t - 1][1]},${t}`);
    }
  }
  return { paths, soc: paths.reduce((s, p) => s + cost(p), 0), makespan: Math.max(...paths.map(cost)), expanded: starts.length, conflicts: [], ms: performance.now() - t0 };
}
