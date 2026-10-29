/**
 * The maze itself: a deterministic, seeded grid with carved rooms.
 *
 * Plain TypeScript, no three.js, so the minimap can draw it the moment the page loads.
 * Cells at odd coordinates are corridors, cells at even coordinates are wall lines, the
 * way a "block" maze works. The renderer draws wall cells as thin slabs, so the toy
 * looks like a wooden labyrinth while the planner works on a plain grid.
 */

export const W = 61;
export const H = 57;

export const FLOOR = 0;
export const WALL = 1;
/** floor with a prop standing on it: not walkable, but not a wall either */
export const BLOCK = 2;
/** open floor the robot keeps out of: another fleet's work area */
export const ZONE = 3;

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
  /** open floor the robot stays out of, relative to the room */
  zones?: [number, number, number, number][];
  /** where the name is painted, relative to the room: [left edge, vertical centre] in cells */
  label: [number, number];
  /** short name for the minimap */
  short: string;
  /** a dark floor: the map draws it lighter, with a light label */
  dark?: boolean;
  /** outdoors, what the ground is like (indoor rooms have none) */
  ground?: Ground;
  /** on a beach, where the sea starts, as a fraction of the room's depth */
  sea?: number;
}

/**
 * The maze is a building, then the outdoors: the years in France, Portugal and Denmark are rooms
 * inside; from TII on, the rooms are out under the Abu Dhabi sun. One door leads out.
 */
export const OUTDOOR = { south: 30, west: { y: 16, x: 26 } };
export const outdoors = (x: number, y: number) => y >= OUTDOOR.south || (y >= OUTDOOR.west.y && x <= OUTDOOR.west.x);
/** the door out: through Coalescent's west wall, across a corridor, out through the facade */
export const MAIN_DOOR: [number, number] = [26, 21];

/** the building's outer wall: outdoor cells that touch the inside */
export function facade(x: number, y: number) {
  if (!outdoors(x, y)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!outdoors(x + dx, y + dy)) return true;
  return false;
}

/** what the ground is outdoors, in the floor shader's terms */
export const GROUND = { sand: 1, dunes: 2, gravel: 3, lagoon: 4, beach: 5, paving: 6, solar: 7 } as const;
export type Ground = keyof typeof GROUND;

// Chronological, snaking: left to right, then back, four rows. Odd x/y and odd sizes so every room
// sits on the corridor lattice.
export const ROOMS: RoomDef[] = [
  {
    id: "start", name: "Erwin Lejeune", short: "Start", sub: "HEAD OF ROBOTICS", x: 3, y: 3, w: 9, h: 7,
    tint: "#f1e3c8", ink: "#8a5a2b", anchor: [2, 4], label: [0.5, 1.15],
  },
  {
    id: "nantes", name: "Nantes", short: "Nantes", sub: "2014–2018 · ELECTRONICS", x: 15, y: 3, w: 9, h: 11,
    tint: "#cfe2e6", ink: "#2f6370", anchor: [1, 9], label: [0.5, 10.1],
    // the scope and the generator on the north wall, the RC filter, the workbench with the FPGA board
    blocks: [[0, 0, 9, 1], [1, 2, 3, 1], [5, 2, 1, 1], [2, 5, 5, 4]],
  },
  {
    id: "hiventive", name: "Hiventive", short: "Hiventive", sub: "2018–2019 · BORDEAUX", x: 27, y: 3, w: 11, h: 11,
    tint: "#2d2f35", ink: "#f0d28c", anchor: [5, 7], label: [0.5, 10.1], dark: true,
    // the logic analyser on the north wall, the weather mast, the CAN node, the UART terminal
    blocks: [[2, 0, 7, 1], [1, 3, 1, 1], [9, 3, 1, 1], [9, 7, 1, 1]],
  },
  {
    id: "coimbra", name: "Coimbra", short: "Coimbra", sub: "2019 · TWO MAZES, TWO WINS", x: 47, y: 3, w: 11, h: 11,
    tint: "#f4dda6", ink: "#8a5d12", anchor: [5, 8], label: [0.5, 10.1],
    blocks: [[3, 2, 5, 5], [1, 4, 1, 1], [9, 4, 1, 1]],
  },
  {
    id: "centrale", name: "Centrale Nantes", short: "Centrale", sub: "2019–2021 · RESEARCH", x: 47, y: 17, w: 11, h: 11,
    tint: "#dcd8f2", ink: "#4b428f", anchor: [8, 6], label: [0.5, 10.1],
    // posters; the MAPF warehouse, fenced; the blocks table; the pendulum
    blocks: [[1, 0, 4, 1], [6, 0, 4, 1], [0, 3, 6, 6], [7, 7, 3, 1], [9, 3, 1, 1]],
  },
  {
    id: "coalescent", name: "Coalescent", short: "Coalescent", sub: "2021–2022 · ODENSE", x: 29, y: 17, w: 15, h: 11,
    tint: "#d3ead2", ink: "#2f6b3a", anchor: [3, 5], label: [5.4, 10.1],
    // the shelves, M4's trolley, the fleet manager's screen; the backroom is the AMRs' alone
    blocks: [[2, 2, 7, 1], [2, 7, 7, 1], [6, 5, 1, 1], [10, 0, 5, 1]],
    zones: [[10, 1, 5, 10]],
  },
  // TII: four rooms, one per thing I built there, all of them outdoors
  {
    id: "tii-c2", name: "Command & Control", short: "TII · C2", sub: "TII · 2022–2026 · ABU DHABI", x: 15, y: 17, w: 11, h: 11,
    tint: "#e9cf9f", ink: "#8a3b1c", anchor: [5, 7], label: [0.5, 10.1], ground: "sand",
    // the ops table, the screens on their trailer up north with the windsock, a palm in the corner
    blocks: [[4, 3, 3, 2], [0, 0, 11, 1], [0, 10, 1, 1]],
  },
  {
    id: "tii-swarm", name: "Swarm Control", short: "TII · Swarm", sub: "TII · DECENTRALIZED FLOCKING", x: 3, y: 17, w: 9, h: 11,
    tint: "#f0c98a", ink: "#9a3f22", anchor: [4, 8], label: [0.5, 10.1], ground: "dunes",
    // two date palms the flock flies around, and dunes in two corners
    blocks: [[2, 6, 1, 1], [6, 4, 1, 1], [7, 0, 2, 2], [0, 9, 2, 2]],
  },
  {
    id: "tii-bt", name: "Orchestration", short: "TII · BTs", sub: "TII · MULTI-ROBOT BEHAVIOR TREES", x: 3, y: 31, w: 11, h: 11,
    tint: "#dcd3bd", ink: "#8a4a2b", anchor: [5, 6], label: [0.5, 10.1], ground: "solar",
    // the tree on its billboard; the charging docks, the solar panels the robots inspect, a palm
    blocks: [[0, 0, 11, 1], [0, 3, 1, 1], [0, 5, 1, 1], [0, 7, 1, 1], [0, 9, 1, 1], [9, 2, 1, 1], [6, 7, 1, 1], [9, 9, 1, 1]],
  },
  {
    id: "tii-track", name: "Plan & Track", short: "TII · M4", sub: "TII × CALTECH · M4 OUTDOORS", x: 17, y: 31, w: 13, h: 11,
    tint: "#cfb895", ink: "#6b4320", anchor: [1, 9], label: [0.5, 10.1], ground: "gravel",
    blocks: [[0, 0, 13, 1]],
  },
  {
    id: "unchained", name: "Unchained Labs", short: "Unchained", sub: "2024– · FOUNDER · REMOTE", x: 33, y: 31, w: 11, h: 11,
    tint: "#f3e7cf", ink: "#2c5687", anchor: [5, 6], label: [0.5, 7.15], ground: "beach",
    // a desk on the sand, two palms, and the sea along the south (no wading)
    blocks: [[1, 6, 2, 1], [0, 0, 1, 1], [10, 0, 1, 1]],
    zones: [[0, 8, 11, 3]],
  },
  {
    id: "sirb", name: "SIRB.AI", short: "SIRB.AI", sub: "2026– · HEAD OF ROBOTICS", x: 47, y: 31, w: 11, h: 11,
    tint: "#dfdcbc", ink: "#6a4a10", anchor: [5, 6], label: [0.5, 10.1], ground: "lagoon",
    // the agent's console on the north side; the lagoon, with its flamingos, to the south-west
    blocks: [[3, 0, 5, 1]],
    zones: [[0, 7, 5, 4]],
  },
  {
    id: "projects", name: "Projects", short: "Projects", sub: "THINGS I BUILT", x: 45, y: 45, w: 13, h: 9,
    tint: "#e4d0ad", ink: "#55407f", anchor: [6, 6], label: [0.5, 8.1], ground: "paving",
    // screens on the north wall and on stands; lantern posts, and a palm
    blocks: [[0, 0, 13, 1], [1, 4, 2, 1], [4, 4, 2, 1], [7, 4, 2, 1], [10, 4, 2, 1], [0, 2, 1, 1], [12, 2, 1, 1], [0, 6, 1, 1], [12, 6, 1, 1], [0, 8, 1, 1]],
  },
  {
    id: "photos", name: "Off the clock", short: "Photos", sub: "PHOTOGRAPHS", x: 27, y: 45, w: 9, h: 9,
    tint: "#f4e0d2", ink: "#93364c", anchor: [4, 4], label: [0.5, 8.1], ground: "beach", sea: 0.93,
    // a palm and a parasol at the water's edge
    blocks: [[0, 8, 1, 1], [2, 8, 1, 1]],
  },
  {
    id: "exit", name: "Exit", short: "Exit", sub: "SAY HELLO", x: 9, y: 45, w: 5, h: 9,
    tint: "#ecd19b", ink: "#2c6a45", anchor: [2, 4], label: [0.4, 8.1], ground: "sand",
    // the mailbox, and two palms by the way out
    blocks: [[3, 1, 1, 1], [0, 0, 1, 1], [0, 8, 1, 1]],
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
  // corridors never cross from the building to the outdoors: only the main door does
  const sameSide = (ax: number, ay: number, bx: number, by: number) => outdoors(ax, ay) === outdoors(bx, by);

  // 1. recursive backtracker over the corridor lattice, rooms excluded, once inside and once out
  const seen = new Uint8Array(W * H);
  const dirs: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  for (const [x0, y0] of [[1, 1], [1, H - 2]] as [number, number][]) {
    const stack: [number, number][] = [[x0, y0]];
    seen[idx(x0, y0)] = 1;
    grid[idx(x0, y0)] = FLOOR;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const options = dirs.filter(
        ([dx, dy]) => isMazeCell(cx + dx, cy + dy) && !seen[idx(cx + dx, cy + dy)] && sameSide(cx, cy, cx + dx, cy + dy),
      );
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
  }

  // 2. carve rooms
  ROOMS.forEach((r) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[idx(x, y)] = FLOOR;
  });

  // 3. props, and the areas the robot keeps out of
  ROOMS.forEach((r) => {
    for (const [bx, by, bw, bh] of r.zones ?? [])
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) grid[idx(r.x + x, r.y + y)] = ZONE;
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
        ([x, y]) =>
          isMazeCell(x + side.out[0], y + side.out[1]) &&
          grid[idx(x - side.out[0], y - side.out[1])] === FLOOR &&
          sameSide(r.x, r.y, x + side.out[0], y + side.out[1]),
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
      const opts = walls.filter(([dx, dy]) => isMazeCell(x + dx, y + dy) && sameSide(x, y, x + dx, y + dy));
      if (!opts.length) continue;
      const [dx, dy] = opts[Math.floor(rand() * opts.length)];
      grid[idx(x + dx / 2, y + dy / 2)] = FLOOR;
    }

  // 6. the door out of the building, straight through from Coalescent's west wall
  const [ddx, ddy] = MAIN_DOOR;
  grid[idx(ddx, ddy)] = FLOOR;
  grid[idx(ddx + 2, ddy)] = FLOOR;

  // 7. the way in and the way out
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

