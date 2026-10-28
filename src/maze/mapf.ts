/**
 * Prioritized multi-agent pathfinding: each agent runs a space-time A* in turn and reserves
 * the cells (and edges) it will use at each timestep, so later agents plan around it.
 * Small, but it is the real idea behind the solvers in PyMAPF.
 */

export type Cell = [number, number];

export function planAll(
  free: (x: number, y: number) => boolean,
  starts: Cell[],
  goals: Cell[],
  blocked: Set<string>,
  horizon = 48,
): Cell[][] {
  const vres = new Set<string>(); // "x,y,t"
  const eres = new Set<string>(); // "x1,y1,x2,y2,t"  (move from 1 to 2 arriving at t)
  const parked = new Map<string, number>(); // cell -> time an agent parks there for good
  const paths: Cell[][] = [];
  const key = (x: number, y: number) => `${x},${y}`;

  for (let a = 0; a < starts.length; a++) {
    const path = spaceTimeAStar(free, starts[a], goals[a], vres, eres, parked, blocked, horizon) ?? [starts[a]];
    paths.push(path);
    for (let t = 0; t < path.length; t++) {
      const [x, y] = path[t];
      vres.add(`${x},${y},${t}`);
      if (t > 0) {
        const [px, py] = path[t - 1];
        eres.add(`${px},${py},${x},${y},${t}`);
      }
    }
    const [gx, gy] = path[path.length - 1];
    parked.set(key(gx, gy), path.length - 1);
  }
  return paths;
}

function spaceTimeAStar(
  free: (x: number, y: number) => boolean,
  [sx, sy]: Cell,
  [gx, gy]: Cell,
  vres: Set<string>,
  eres: Set<string>,
  parked: Map<string, number>,
  blocked: Set<string>,
  horizon: number,
): Cell[] | null {
  type Node = { x: number; y: number; t: number; g: number; f: number; p: Node | null };
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
  const open: Node[] = [{ x: sx, y: sy, t: 0, g: 0, f: h(sx, sy), p: null }];
  const seen = new Set<string>();
  const moves: Cell[] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const occupied = (x: number, y: number, t: number) => {
    if (vres.has(`${x},${y},${t}`)) return true;
    const p = parked.get(`${x},${y}`);
    return p !== undefined && t >= p;
  };
  // the goal must stay free after we arrive, or someone later would walk through us
  const lastUse = (x: number, y: number) => {
    let last = -1;
    for (let t = 0; t <= horizon; t++) if (vres.has(`${x},${y},${t}`)) last = t;
    return last;
  };
  const goalFreeAfter = lastUse(gx, gy);
  let iter = 0;
  while (open.length && iter++ < 6000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].g > open[bi].g)) bi = i;
    const n = open.splice(bi, 1)[0];
    if (n.x === gx && n.y === gy && n.t > goalFreeAfter) {
      const out: Cell[] = [];
      for (let c: Node | null = n; c; c = c.p) out.push([c.x, c.y]);
      return out.reverse();
    }
    if (n.t >= horizon) continue;
    for (const [dx, dy] of moves) {
      const x = n.x + dx;
      const y = n.y + dy;
      const t = n.t + 1;
      if (!free(x, y) || blocked.has(`${x},${y}`)) continue;
      if (occupied(x, y, t)) continue;
      if (eres.has(`${x},${y},${n.x},${n.y},${t}`)) continue; // no swapping places
      const k = `${x},${y},${t}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const g = n.g + 1;
      open.push({ x, y, t, g, f: g + h(x, y), p: n });
    }
  }
  return null;
}
