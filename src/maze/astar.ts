import { FLOOR, H, W, type Maze, idx } from "./layout";

/* Grid helpers shared by the planners: snapping a click to floor, clearance checks, smoothing. */

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
      const half = v === 2 ? 0.44 : v === 3 ? 0.5 : 0.17;
      const ox = Math.max(Math.abs(gx - (x + 0.5)) - half, 0);
      const oz = Math.max(Math.abs(gz - (z + 0.5)) - half, 0);
      if (ox * ox + oz * oz < radius * radius) return false;
    }
  return true;
}

/** String-pull the grid path into a few straight legs the robot can drive. */
export function smooth(m: Maze, cells: number[], from?: [number, number], radius = 0.34): [number, number][] {
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
    while (j + 1 < pts.length && segmentClear(m, pts[i][0], pts[i][1], pts[j + 1][0], pts[j + 1][1], radius)) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
