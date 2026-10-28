/**
 * The maze itself: a deterministic, seeded grid with carved rooms.
 *
 * Plain TypeScript, no three.js, so the minimap can draw it the moment the page loads.
 * Cells at odd coordinates are corridors, cells at even coordinates are wall lines, the
 * way a "block" maze works. The renderer draws wall cells as thin slabs, so the toy
 * looks like a wooden labyrinth while the planner works on a plain grid.
 */

export const W = 57;
export const H = 57;

export const FLOOR = 0;
export const WALL = 1;
/** floor with a prop standing on it: not walkable, but not a wall either */
export const BLOCK = 2;

export interface RoomDef {
  id: string;
  /** name painted on the floor and on the minimap */
  name: string;
  /** small line painted under the name */
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** floor tint */
  tint: string;
  /** paint colour for the floor lettering */
  ink: string;
  /** where the tour parks the robot, relative to the room */
  anchor: [number, number];
  /** props that make cells unwalkable, relative to the room: [x, y, w, h] */
  blocks?: [number, number, number, number][];
  /** where the name is painted, relative to the room: [left edge, vertical centre] in cells */
  label: [number, number];
  /** short name for the minimap */
  short: string;
  /** a dark floor: the map draws it lighter, with a light label */
  dark?: boolean;
}

// Chronological, snaking: left to right, then back, four rows. Odd x/y and odd sizes so every room
// sits on the corridor lattice.
export const ROOMS: RoomDef[] = [
  {
    id: "start", name: "Erwin Lejeune", short: "Start", sub: "HEAD OF ROBOTICS", x: 3, y: 3, w: 9, h: 7,
    tint: "#f1e3c8", ink: "#8a5a2b", anchor: [2, 4], label: [0.5, 1.15],
  },
  {
    id: "nantes", name: "Nantes", short: "Nantes", sub: "2014–2018 · ELECTRONICS", x: 17, y: 3, w: 7, h: 7,
    tint: "#cfe2e6", ink: "#2f6370", anchor: [3, 4], label: [0.4, 6.1],
    blocks: [[1, 1, 3, 1], [5, 1, 1, 1]],
  },
  {
    id: "hiventive", name: "Hiventive", short: "Hiventive", sub: "2018–2019 · BORDEAUX", x: 29, y: 3, w: 9, h: 9,
    tint: "#2d2f35", ink: "#f0d28c", anchor: [4, 6], label: [0.5, 8.1], dark: true,
  },
  {
    id: "coimbra", name: "Coimbra", short: "Coimbra", sub: "2019 · TWO MAZES, TWO WINS", x: 43, y: 3, w: 11, h: 11,
    tint: "#f4dda6", ink: "#8a5d12", anchor: [5, 8], label: [0.5, 10.1],
    blocks: [[3, 2, 5, 5], [1, 4, 1, 1], [9, 4, 1, 1]],
  },
  {
    id: "centrale", name: "Centrale Nantes", short: "Centrale", sub: "2019–2021 · RESEARCH", x: 43, y: 19, w: 11, h: 9,
    tint: "#dcd8f2", ink: "#4b428f", anchor: [5, 5], label: [0.5, 8.1],
    // posters, the pendulum, and the blocks table (the tour parks the robot in front of it)
    blocks: [[1, 0, 4, 1], [6, 0, 4, 1], [9, 5, 1, 1], [4, 6, 3, 1]],
  },
  {
    id: "coalescent", name: "Coalescent", short: "Coalescent", sub: "2021–2022 · ODENSE", x: 29, y: 17, w: 11, h: 11,
    tint: "#d3ead2", ink: "#2f6b3a", anchor: [3, 5], label: [0.5, 10.1],
    blocks: [[2, 2, 7, 1], [2, 7, 7, 1], [6, 5, 1, 1]],
  },
  // TII: four rooms, one per thing I built there
  {
    id: "tii-c2", name: "Command & Control", short: "TII · C2", sub: "TII · 2022–2026 · ABU DHABI", x: 15, y: 17, w: 11, h: 11,
    tint: "#2b3138", ink: "#ffb49c", anchor: [5, 7], label: [0.5, 10.1], dark: true,
    // the ops table in the middle, the wall of screens up north
    blocks: [[4, 3, 3, 2], [1, 0, 9, 1]],
  },
  {
    id: "tii-swarm", name: "Swarm Control", short: "TII · Swarm", sub: "TII · DECENTRALIZED FLOCKING", x: 3, y: 17, w: 9, h: 11,
    tint: "#f6d3c6", ink: "#9a3f22", anchor: [4, 8], label: [0.5, 10.1],
    blocks: [[2, 6, 1, 1], [6, 4, 1, 1]],
  },
  {
    id: "tii-bt", name: "Orchestration", short: "TII · BTs", sub: "TII · MULTI-ROBOT BEHAVIOR TREES", x: 3, y: 31, w: 11, h: 11,
    tint: "#efe0cf", ink: "#8a4a2b", anchor: [5, 6], label: [0.5, 10.1],
    // the tree on the north wall, and the charging docks
    blocks: [[0, 0, 11, 1]],
  },
  {
    id: "tii-track", name: "Plan & Track", short: "TII · M4", sub: "TII × CALTECH · M4 OUTDOORS", x: 17, y: 31, w: 13, h: 11,
    tint: "#e6dcc0", ink: "#6b5320", anchor: [1, 9], label: [0.5, 10.1],
    blocks: [[0, 0, 13, 1]],
  },
  {
    id: "unchained", name: "Unchained Labs", short: "Unchained", sub: "2024– · FOUNDER", x: 33, y: 33, w: 7, h: 7,
    tint: "#d6e6f5", ink: "#2c5687", anchor: [1, 4], label: [0.4, 6.1],
  },
  {
    id: "sirb", name: "SIRB.AI", short: "SIRB.AI", sub: "2026– · HEAD OF ROBOTICS", x: 43, y: 31, w: 11, h: 11,
    tint: "#f2e2b8", ink: "#7a5a12", anchor: [5, 6], label: [0.5, 10.1],
    // the agent's console on the north wall
    blocks: [[3, 0, 5, 1]],
  },
  {
    id: "projects", name: "Projects", short: "Projects", sub: "THINGS I BUILT", x: 41, y: 45, w: 13, h: 9,
    tint: "#e4dcf0", ink: "#55407f", anchor: [6, 6], label: [0.5, 8.1],
    blocks: [[0, 0, 13, 1], [1, 4, 2, 1], [4, 4, 2, 1], [7, 4, 2, 1], [10, 4, 2, 1]],
  },
  {
    id: "photos", name: "Off the clock", short: "Photos", sub: "PHOTOGRAPHS", x: 27, y: 45, w: 9, h: 9,
    tint: "#f6dbe0", ink: "#93364c", anchor: [4, 4], label: [0.5, 8.1],
  },
  {
    id: "exit", name: "Exit", short: "Exit", sub: "SAY HELLO", x: 9, y: 45, w: 5, h: 9,
    tint: "#d4ead8", ink: "#2c6a45", anchor: [2, 4], label: [0.4, 8.1],
    blocks: [[3, 1, 1, 1]],
  },
];

export interface Maze {
  grid: Uint8Array;
  /** room index per cell (interior only), -1 elsewhere */
  roomOf: Int8Array;
  /** room index of the wall ring around each room, -1 elsewhere */
  ringOf: Int8Array;
  start: [number, number];
  anchors: [number, number][];
  /** openings in the outer frame */
  gaps: [number, number][];
}

export const idx = (x: number, y: number) => y * W + x;

/** mulberry32: tiny, fast, good enough for a maze */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 808;
const BRAID = 0.3;

export function buildMaze(seed = SEED): Maze {
  const rand = rng(seed);
  const grid = new Uint8Array(W * H).fill(WALL);
  const roomOf = new Int8Array(W * H).fill(-1);
  const ringOf = new Int8Array(W * H).fill(-1);

  ROOMS.forEach((r, i) => {
    for (let y = r.y - 1; y <= r.y + r.h; y++)
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        if (inside) roomOf[idx(x, y)] = i;
        else ringOf[idx(x, y)] = i;
      }
  });

  const isMazeCell = (x: number, y: number) =>
    x > 0 && y > 0 && x < W - 1 && y < H - 1 && x % 2 === 1 && y % 2 === 1 && roomOf[idx(x, y)] < 0 && ringOf[idx(x, y)] < 0;

  // 1. recursive backtracker over the corridor lattice, rooms excluded
  const seen = new Uint8Array(W * H);
  const stack: [number, number][] = [[1, 1]];
  seen[idx(1, 1)] = 1;
  grid[idx(1, 1)] = FLOOR;
  const dirs: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = dirs.filter(([dx, dy]) => isMazeCell(cx + dx, cy + dy) && !seen[idx(cx + dx, cy + dy)]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[Math.floor(rand() * options.length)];
    const nx = cx + dx;
    const ny = cy + dy;
    grid[idx(cx + dx / 2, cy + dy / 2)] = FLOOR;
    grid[idx(nx, ny)] = FLOOR;
    seen[idx(nx, ny)] = 1;
    stack.push([nx, ny]);
  }

  // 2. carve rooms
  ROOMS.forEach((r) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[idx(x, y)] = FLOOR;
  });

  // 3. props
  ROOMS.forEach((r) => {
    for (const [bx, by, bw, bh] of r.blocks ?? [])
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) grid[idx(r.x + x, r.y + y)] = BLOCK;
  });

  // 4. doors: one or two per side, where the corridor lattice continues outside
  ROOMS.forEach((r) => {
    const sides: { cells: [number, number][]; out: [number, number] }[] = [
      { cells: [], out: [0, -1] },
      { cells: [], out: [0, 1] },
      { cells: [], out: [-1, 0] },
      { cells: [], out: [1, 0] },
    ];
    for (let x = r.x; x < r.x + r.w; x += 2) {
      sides[0].cells.push([x, r.y - 1]);
      sides[1].cells.push([x, r.y + r.h]);
    }
    for (let y = r.y; y < r.y + r.h; y += 2) {
      sides[2].cells.push([r.x - 1, y]);
      sides[3].cells.push([r.x + r.w, y]);
    }
    for (const side of sides) {
      const ok = side.cells.filter(
        ([x, y]) => isMazeCell(x + side.out[0], y + side.out[1]) && grid[idx(x - side.out[0], y - side.out[1])] === FLOOR,
      );
      if (!ok.length) continue;
      const n = ok.length >= 5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const pick = ok.splice(Math.floor(rand() * ok.length), 1)[0];
        if (pick) grid[idx(pick[0], pick[1])] = FLOOR;
      }
    }
  });

  // 5. braid: open some dead ends so the tour has shortcuts and the maze has loops
  for (let y = 1; y < H - 1; y += 2)
    for (let x = 1; x < W - 1; x += 2) {
      if (!isMazeCell(x, y)) continue;
      const walls = dirs.filter(([dx, dy]) => grid[idx(x + dx / 2, y + dy / 2)] === WALL);
      if (walls.length < 3 || rand() > BRAID) continue;
      const opts = walls.filter(([dx, dy]) => isMazeCell(x + dx, y + dy));
      if (!opts.length) continue;
      const [dx, dy] = opts[Math.floor(rand() * opts.length)];
      grid[idx(x + dx / 2, y + dy / 2)] = FLOOR;
    }

  // 6. the way in and the way out
  const s = ROOMS[0];
  const gaps: [number, number][] = [[0, s.y + 2]];
  for (let x = 0; x < s.x; x++) grid[idx(x, s.y + 2)] = FLOOR;
  // out through whichever side of the frame the exit is nearer
  const e = ROOMS[ROOMS.length - 1];
  if (e.x + e.w / 2 < W / 2) {
    gaps.push([0, e.y + 4]);
    for (let x = 0; x < e.x; x++) grid[idx(x, e.y + 4)] = FLOOR;
  } else {
    gaps.push([W - 1, e.y + 4]);
    for (let x = e.x + e.w; x < W; x++) grid[idx(x, e.y + 4)] = FLOOR;
  }

  const anchors = ROOMS.map((r) => [r.x + r.anchor[0], r.y + r.anchor[1]] as [number, number]);
  return { grid, roomOf, ringOf, start: anchors[0], anchors, gaps };
}

export const walkable = (m: Maze, x: number, y: number) =>
  x >= 0 && y >= 0 && x < W && y < H && m.grid[idx(x, y)] === FLOOR;

/** world position (x, z) of a cell centre; the board is centred on the origin */
export const cellToWorld = (x: number, y: number): [number, number] => [x - W / 2 + 0.5, y - H / 2 + 0.5];
export const worldToCell = (wx: number, wz: number): [number, number] => [
  Math.floor(wx + W / 2),
  Math.floor(wz + H / 2),
];

export type Run = { cx: number; cz: number; sx: number; sz: number; g: number; v: boolean };

/**
 * Turn a grid of wall cells into a few long slabs: one box per straight run, split where the
 * colour group changes. Coordinates are in cells (edge-based).
 */
export function wallRuns(w: number, h: number, wall: (x: number, y: number) => boolean, group: (x: number, y: number) => number, t: number) {
  const runs: Run[] = [];
  const covered = new Uint8Array(w * h);
  for (const vertical of [false, true]) {
    const lines = vertical ? w : h;
    const len = vertical ? h : w;
    for (let a = 0; a < lines; a++) {
      const at = (i: number) => (vertical ? [a, i] : [i, a]) as [number, number];
      let i = 0;
      while (i < len) {
        if (!wall(...at(i))) {
          i++;
          continue;
        }
        const g = group(...at(i));
        let j = i;
        while (j + 1 < len && wall(...at(j + 1)) && group(...at(j + 1)) === g) j++;
        const before = i > 0 && wall(...at(i - 1));
        const after = j + 1 < len && wall(...at(j + 1));
        if (j > i || before || after) {
          const s0 = i + 0.5 - (before ? 0.5 : t / 2);
          const s1 = j + 0.5 + (after ? 0.5 : t / 2);
          const mid = (s0 + s1) / 2;
          const span = s1 - s0;
          if (vertical) runs.push({ cx: a + 0.5, cz: mid, sx: t, sz: span, g, v: true });
          else runs.push({ cx: mid, cz: a + 0.5, sx: span, sz: t, g, v: false });
          for (let k = i; k <= j; k++) {
            const [x, y] = at(k);
            covered[y * w + x] = 1;
          }
        }
        i = j + 1;
      }
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (wall(x, y) && !covered[y * w + x]) runs.push({ cx: x + 0.5, cz: y + 0.5, sx: t, sz: t, g: group(x, y), v: false });
  return runs;
}

