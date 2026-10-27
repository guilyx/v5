import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  Euler,
  type Material,
} from "three";
import { Kit, rng } from "./kit";
import { P } from "./palette";
import { PLATEAU_Y } from "./layout";
import { blossomTree, droneGeometry, meepleGeometry, palmTree, roundTree, rollerGeometry, winsX, winsZ } from "./props";

/** Something alive inside a landmark. `t` is the scene clock in seconds. */
export interface Actor {
  update(t: number, dt: number, night: number): void;
}

export interface Spec {
  id: string;
  district: string;
  x: number;
  z: number;
  /** base height, default the island top */
  y?: number;
  /** extra yaw on top of facing away from the table's centre */
  turn?: number;
  /** footprint radius (keeps trees away) */
  r: number;
  /** the empty plot waiting for the building, width × depth */
  plot: [number, number];
  /** camera framing: radius to keep in view, look-at height, azimuth nudge, elevation */
  view: { r: number; up: number; az?: number; el?: number; at?: [number, number] };
  build(k: Kit): void;
  life?(g: Group, mat: Material): Actor;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

function plaza(k: Kit, w: number, d: number, color: string = P.stone) {
  k.block(0, 0, 0, 0).box(w, 0.06, d, 0, 0, 0, color);
}

function treeBlock(k: Kit, x: number, y: number, z: number, delay: number, s = 1, crown: string = P.sage) {
  k.block(x, y, z, delay);
  roundTree(k, x, y, z, s, crown);
}

function setInstance(mesh: InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, s: number, roll = 0, pitch = 0) {
  _e.set(pitch, yaw, roll, "YXZ");
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(s, s, s));
  mesh.setMatrixAt(i, _m);
}

function instanced(geo: ReturnType<typeof droneGeometry>, mat: Material, n: number, colors: string[]) {
  const m = new InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) m.setColorAt(i, _c.set(colors[i % colors.length]));
  m.frustumCulled = false;
  return m;
}

const PASTELS = ["#fffaf0", "#cfe9dc", "#ffd7c2", "#d9cff0", "#fbe7a8", "#cfe1f2"];

/* ------------------------------------------------------------------ maze --- */

const MN = 7;
const MCS = 0.27;
const MHALF = (MN * MCS) / 2;
const cellX = (c: number) => -MHALF + (c + 0.5) * MCS;
const cellZ = (r: number) => -MHALF + (r + 0.5) * MCS;

/** a perfect maze, entrance at the front-left cell, exit at the back-right */
function makeMaze() {
  const rand = rng(2019);
  const south = Array.from({ length: MN }, () => Array(MN).fill(true) as boolean[]);
  const east = Array.from({ length: MN }, () => Array(MN).fill(true) as boolean[]);
  const seen = Array.from({ length: MN }, () => Array(MN).fill(false) as boolean[]);
  const stack: [number, number][] = [[MN - 1, 0]];
  seen[MN - 1][0] = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const opts: [number, number][] = [];
    if (r > 0 && !seen[r - 1][c]) opts.push([r - 1, c]);
    if (r < MN - 1 && !seen[r + 1][c]) opts.push([r + 1, c]);
    if (c > 0 && !seen[r][c - 1]) opts.push([r, c - 1]);
    if (c < MN - 1 && !seen[r][c + 1]) opts.push([r, c + 1]);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [nr, nc] = opts[Math.floor(rand() * opts.length)];
    if (nr > r) south[r][c] = false;
    else if (nr < r) south[nr][c] = false;
    else if (nc > c) east[r][c] = false;
    else east[r][nc] = false;
    seen[nr][nc] = true;
    stack.push([nr, nc]);
  }
  // breadth-first distances from the entrance, and the path to the exit
  const dist = Array.from({ length: MN }, () => Array(MN).fill(-1) as number[]);
  const prev = new Map<number, number>();
  const q: [number, number][] = [[MN - 1, 0]];
  dist[MN - 1][0] = 0;
  while (q.length) {
    const [r, c] = q.shift()!;
    const nb: [number, number, boolean][] = [
      [r - 1, c, r > 0 && !south[r - 1][c]],
      [r + 1, c, r < MN - 1 && !south[r][c]],
      [r, c - 1, c > 0 && !east[r][c - 1]],
      [r, c + 1, c < MN - 1 && !east[r][c]],
    ];
    for (const [nr, nc, open] of nb) {
      if (!open || dist[nr][nc] >= 0) continue;
      dist[nr][nc] = dist[r][c] + 1;
      prev.set(nr * MN + nc, r * MN + c);
      q.push([nr, nc]);
    }
  }
  const path: [number, number][] = [];
  let cur: number | undefined = 0 * MN + (MN - 1);
  while (cur !== undefined) {
    path.unshift([Math.floor(cur / MN), cur % MN]);
    cur = prev.get(cur);
  }
  let maxD = 0;
  for (const row of dist) for (const d of row) maxD = Math.max(maxD, d);
  return { south, east, dist, maxD, path };
}

/* ------------------------------------------------------------- the specs --- */

export const SPECS: Spec[] = [
  {
    id: "nantes-uni",
    district: "nantes",
    x: -6.95,
    z: -0.15,
    r: 1.15,
    plot: [2.2, 1.65],
    view: { r: 2.7, up: 0.55, az: -0.25 },
    build(k) {
      plaza(k, 2.3, 1.75);
      k.block(0, 0.06, 0.62, 0.08).box(1.12, 0.04, 0.34, 0, 0.06, 0.62, P.cream).box(1.0, 0.04, 0.22, 0, 0.1, 0.6, P.cream);
      k.block(0, 0.06, -0.2, 0.14).box(1.3, 0.66, 0.8, 0, 0.06, -0.2, P.cream);
      for (const sx of [-1, 1]) {
        winsX(k, 3, -0.45, 0.05, 0.2, sx * 0.66, 0.11, 0.14);
        winsX(k, 3, -0.45, 0.05, 0.44, sx * 0.66, 0.11, 0.14);
      }
      k.block(0, 0.72, -0.2, 0.36).gable(1.42, 0.34, 0.92, 0, 0.72, -0.2, P.slate);
      for (let i = 0; i < 4; i++) {
        const x = -0.39 + i * 0.26;
        k.block(x, 0.14, 0.36, 0.24 + i * 0.05).cyl(0.045, 0.052, 0.48, 8, x, 0.14, 0.36, P.white);
      }
      k.block(0, 0.62, 0.32, 0.5).box(1.02, 0.07, 0.38, 0, 0.62, 0.31, P.cream).gable(1.04, 0.21, 0.38, 0, 0.69, 0.31, P.peach);
      k.block(0, 0.06, 0.2, 0.3).box(0.26, 0.34, 0.03, 0, 0.1, 0.21, P.plum);
      for (const sx of [-1, 1]) {
        const x = sx * 0.98;
        k.block(x, 0.06, -0.12, 0.2).box(0.56, 0.5, 0.7, x, 0.06, -0.12, P.apricot);
        winsZ(k, 2, x - 0.13, x + 0.13, 0.15, 0.24, 0.11, 0.13);
        winsZ(k, 2, x - 0.13, x + 0.13, 0.35, 0.24, 0.11, 0.13);
        k.block(x, 0.56, -0.12, 0.42).gable(0.76, 0.22, 0.62, x, 0.56, -0.12, P.terracotta, { ry: Math.PI / 2 });
      }
      k.block(0, 1.0, -0.2, 0.66).cyl(0.012, 0.012, 0.44, 5, 0, 1.0, -0.2, P.plum).box(0.22, 0.13, 0.012, 0.11, 1.28, -0.2, P.sky);
      treeBlock(k, -0.92, 0.06, 0.6, 0.55);
      treeBlock(k, 0.92, 0.06, 0.6, 0.6);
    },
  },
  {
    id: "hiventive",
    district: "bordeaux",
    x: -2.95,
    z: 5.35,
    r: 0.95,
    plot: [1.65, 1.6],
    view: { r: 3.0, up: 0.55, at: [-3.55, 4.8], az: 0.12 },
    build(k) {
      plaza(k, 1.75, 1.7);
      const fl = 0.38;
      for (let f = 0; f < 3; f++) {
        const y = 0.06 + f * fl;
        k.block(0, y, 0, 0.1 + f * 0.13).box(1.15, 0.34, 1.1, 0, y, 0, P.powder);
        winsZ(k, 4, -0.39, 0.39, y + 0.09, 0.56, 0.15, 0.17);
        winsX(k, 3, -0.32, 0.32, y + 0.09, 0.585, 0.15, 0.17);
        winsX(k, 3, -0.32, 0.32, y + 0.09, -0.585, 0.15, 0.17);
        k.box(1.23, 0.04, 1.18, 0, y + 0.34, 0, P.paper);
      }
      k.block(0, 0.06, 0.6, 0.2).box(0.32, 0.24, 0.03, 0, 0.06, 0.565, P.plum).box(0.56, 0.03, 0.26, 0, 0.32, 0.66, P.peach);
      // the giant chip on the roof
      const cy = 0.06 + 3 * fl + 0.04;
      k.block(0, cy, 0, 0.62).box(0.62, 0.06, 0.62, 0, cy, 0, "#5b5470");
      const by = cy + 0.06;
      k.block(0, by, 0, 0.72)
        .box(0.92, 0.14, 0.92, 0, by, 0, P.charcoal)
        .box(0.5, 0.012, 0.5, 0, by + 0.14, 0, "#5b5470")
        .cyl(0.045, 0.045, 0.012, 10, -0.32, by + 0.14, 0.32, "#8e86a6")
        .ball(0.028, 0.18, by + 0.16, -0.18, P.mint, { glow: 2 });
      let n = 0;
      for (let s = 0; s < 4; s++) {
        const rot = (s * Math.PI) / 2;
        for (let i = 0; i < 7; i++) {
          const u = -0.36 + i * 0.12;
          const at = (d: number): [number, number] => [u * Math.cos(rot) + d * Math.sin(rot), d * Math.cos(rot) - u * Math.sin(rot)];
          const [hx, hz] = at(0.5);
          const [vx, vz] = at(0.545);
          k.block(vx, cy, vz, 0.86 + n++ * 0.012)
            .box(0.05, 0.03, 0.1, hx, by + 0.03, hz, P.silver, { ry: rot })
            .box(0.05, by + 0.06 - cy, 0.03, vx, cy, vz, P.silver, { ry: rot });
        }
      }
    },
  },
  {
    id: "ynov",
    district: "bordeaux",
    x: -4.35,
    z: 4.1,
    r: 0.65,
    plot: [1.05, 0.95],
    view: { r: 2.2, up: 0.4 },
    build(k) {
      plaza(k, 1.15, 1.05);
      k.block(0, 0.06, -0.05, 0.12).box(0.82, 0.52, 0.62, 0, 0.06, -0.05, P.peach);
      winsZ(k, 3, -0.26, 0.26, 0.34, 0.27, 0.12, 0.14);
      winsZ(k, 2, -0.26, 0.26, 0.12, 0.27, 0.12, 0.14);
      k.box(0.16, 0.22, 0.03, 0, 0.06, 0.27, P.plum);
      winsX(k, 2, -0.2, 0.1, 0.34, 0.42, 0.12, 0.14);
      winsX(k, 2, -0.2, 0.1, 0.34, -0.42, 0.12, 0.14);
      k.block(0, 0.58, -0.05, 0.34).box(0.88, 0.05, 0.68, 0, 0.58, -0.05, P.paper);
      // aeronautics: a little plane on a pole
      const py = 0.98;
      k.block(0.12, 0.63, -0.05, 0.52)
        .cyl(0.012, 0.012, 0.34, 5, 0.12, 0.63, -0.05, P.plum)
        .box(0.38, 0.06, 0.06, 0.12, py, -0.05, P.white)
        .box(0.1, 0.018, 0.44, 0.14, py + 0.025, -0.05, P.sky)
        .box(0.06, 0.014, 0.16, -0.04, py + 0.03, -0.05, P.sky)
        .box(0.07, 0.08, 0.014, -0.045, py + 0.04, -0.05, P.peach);
      treeBlock(k, 0.44, 0.06, 0.36, 0.5, 0.8);
    },
  },
  {
    id: "maze",
    district: "coimbra",
    x: 2.4,
    z: 7.0,
    y: PLATEAU_Y,
    r: 1.6,
    plot: [1.95, 1.95],
    turn: 0.35,
    view: { r: 2.6, up: 0.15, el: 0.66 },
    build(k) {
      const mz = makeMaze();
      const T = 0.055;
      const H = 0.17;
      k.block(0, 0, 0, 0).box(MN * MCS + 0.18, 0.05, MN * MCS + 0.18, 0, 0, 0, "#ece0c6");
      const d = (r: number, c: number) => 0.18 + 0.85 * (mz.dist[r][c] / mz.maxD);
      const hedge = (x: number, z: number, w: number, dd: number, delay: number) =>
        k.block(x, 0.05, z, delay).box(w, H, dd, x, 0.05, z, P.hedge, { jitter: 1 });
      for (let c = 0; c < MN; c++) hedge(cellX(c), -MHALF, MCS + T, T, d(0, c));
      for (let r = 0; r < MN; r++) hedge(-MHALF, cellZ(r), T, MCS + T, d(r, 0));
      for (let r = 0; r < MN; r++)
        for (let c = 0; c < MN; c++) {
          if (mz.south[r][c] && !(r === MN - 1 && c === 0)) hedge(cellX(c), cellZ(r) + MCS / 2, MCS + T, T, d(r, c));
          if (mz.east[r][c] && !(r === 0 && c === MN - 1)) hedge(cellX(c) + MCS / 2, cellZ(r), T, MCS + T, d(r, c));
        }
      // two trophies by the exit: mapped and unmapped
      [-0.45, -0.05].forEach((z, i) => {
        const x = MHALF + 0.3;
        k.block(x, 0, z, 1.1 + i * 0.15)
          .box(0.17, 0.1, 0.17, x, 0, z, P.stone)
          .box(0.1, 0.025, 0.1, x, 0.1, z, P.gold)
          .cyl(0.018, 0.018, 0.06, 6, x, 0.125, z, P.gold)
          .cyl(0.08, 0.035, 0.1, 10, x, 0.18, z, P.gold)
          .box(0.024, 0.055, 0.024, x - 0.085, 0.2, z, P.gold)
          .box(0.024, 0.055, 0.024, x + 0.085, 0.2, z, P.gold);
      });
      k.block(-MHALF - 0.28, 0, 0.5, 0.9);
      roundTree(k, -MHALF - 0.28, 0, 0.5, 0.75, "#aab996");
    },
    life(g, mat) {
      const mz = makeMaze();
      const pts: [number, number][] = [[cellX(0), MHALF + 0.22]];
      for (const [r, c] of mz.path) pts.push([cellX(c), cellZ(r)]);
      pts.push([MHALF + 0.14, cellZ(0)]);
      const bot = new Mesh(rollerGeometry(), mat);
      bot.scale.setScalar(1.15);
      g.add(bot);
      // the robot leaves a glowing trail of the cells it has solved
      const tileGeo = new Kit().box(MCS * 0.5, 0.012, MCS * 0.5, 0, 0, 0, P.peach, { glow: 2 }).build();
      const trail = new InstancedMesh(tileGeo, mat, pts.length);
      trail.frustumCulled = false;
      g.add(trail);
      const speed = 1.7;
      const runT = (pts.length - 1) / speed;
      const cycle = runT + 2.2;
      let yaw = 0;
      return {
        update(t, dt) {
          const u = t % cycle;
          const s = Math.min(u * speed, pts.length - 1.0001);
          const i = Math.floor(s);
          const f = s - i;
          const [ax, az] = pts[i];
          const [bx, bz] = pts[Math.min(i + 1, pts.length - 1)];
          const ease = f * f * (3 - 2 * f);
          bot.position.set(ax + (bx - ax) * ease, 0.05, az + (bz - az) * ease);
          const want = Math.atan2(bx - ax, bz - az);
          let dy = want - yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          yaw += dy * Math.min(1, dt * 12);
          bot.rotation.y = yaw;
          const pop = u < 0.25 ? u / 0.25 : u > cycle - 0.3 ? (cycle - u) / 0.3 : 1;
          bot.scale.setScalar(1.15 * Math.max(pop, 0.001));
          for (let k = 0; k < pts.length; k++) {
            const on = k >= 1 && k < pts.length - 1 && k <= i && u < cycle - 0.3;
            setInstance(trail, k, pts[k][0], 0.052, pts[k][1], 0, on ? 1 : 0);
          }
          trail.instanceMatrix.needsUpdate = true;
        },
      };
    },
  },
  {
    id: "centrale",
    district: "nantes",
    x: -5.2,
    z: -2.45,
    r: 1.0,
    plot: [1.9, 1.55],
    view: { r: 2.7, up: 0.45, az: 0.2 },
    build(k) {
      plaza(k, 2.0, 1.65);
      k.block(-0.2, 0.06, -0.15, 0.12)
        .box(1.3, 0.52, 0.86, -0.2, 0.06, -0.15, "#f1eee8")
        .box(1.33, 0.16, 0.89, -0.2, 0.24, -0.15, P.glass, { glow: 1 });
      for (let i = 0; i < 7; i++) k.box(0.035, 0.52, 0.05, -0.8 + i * 0.2, 0.06, 0.295, P.sage);
      k.block(0.62, 0.06, 0.05, 0.25).box(0.44, 0.84, 0.56, 0.62, 0.06, 0.05, "#cfe3c9");
      for (const y of [0.2, 0.42, 0.64]) winsZ(k, 2, 0.53, 0.71, y, 0.34, 0.12, 0.14);
      k.box(0.5, 0.04, 0.62, 0.62, 0.9, 0.05, P.paper);
      k.block(-0.2, 0.58, -0.15, 0.36).box(1.36, 0.03, 0.92, -0.2, 0.58, -0.15, P.paper);
      // the rooftop grid where three agents share the cells
      const gs = 0.19;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const x = -0.2 + (j - 1.5) * gs;
          const z = -0.15 + (i - 1.5) * gs;
          k.block(x, 0.61, z, 0.45 + (i + j) * 0.035).box(gs * 0.92, 0.025, gs * 0.92, x, 0.61, z, (i + j) % 2 ? "#e6dff2" : "#d3c8e8");
        }
      // the rail of the inverted pendulum
      k.block(-0.3, 0.06, 0.62, 0.6)
        .box(0.9, 0.03, 0.06, -0.3, 0.06, 0.62, P.charcoal)
        .box(0.04, 0.07, 0.08, -0.75, 0.06, 0.62, P.charcoal)
        .box(0.04, 0.07, 0.08, 0.15, 0.06, 0.62, P.charcoal);
      treeBlock(k, 0.72, 0.06, 0.62, 0.68, 0.9);
    },
    life(g, mat) {
      const gs = 0.19;
      const ring: [number, number][] = [
        [0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0],
      ];
      const pos = ([i, j]: [number, number]): [number, number] => [-0.2 + (j - 1.5) * gs, -0.15 + (i - 1.5) * gs];
      const agentGeo = new Kit().cyl(0.055, 0.06, 0.07, 10, 0, 0, 0, P.white).ball(0.022, 0, 0.085, 0, P.white, { glow: 2 }).build();
      const agents = instanced(agentGeo, mat, 3, [P.peach, P.sky, P.butter]);
      g.add(agents);
      // inverted pendulum on a cart
      const cart = new Mesh(new Kit().box(0.15, 0.07, 0.11, 0, 0, 0, P.peach).build(), mat);
      const pole = new Group();
      pole.add(new Mesh(new Kit().cyl(0.011, 0.011, 0.42, 5, 0, 0, 0, P.charcoal).ball(0.036, 0, 0.43, 0, P.butter, { glow: 2 }).build(), mat));
      pole.position.y = 0.07;
      cart.add(pole);
      g.add(cart);
      return {
        update(t) {
          const step = t / 0.6;
          const base = Math.floor(step);
          const f = Math.min(1, (step - base) * 1.6);
          const e = f * f * (3 - 2 * f);
          for (let a = 0; a < 3; a++) {
            const [ax, az] = pos(ring[(base + a * 4) % 12]);
            const [bx, bz] = pos(ring[(base + a * 4 + 1) % 12]);
            setInstance(agents, a, ax + (bx - ax) * e, 0.635, az + (bz - az) * e, 0, 1);
          }
          agents.instanceMatrix.needsUpdate = true;
          cart.position.set(-0.3 + 0.3 * Math.sin(0.9 * t), 0.09, 0.62);
          pole.rotation.z = -0.24 * Math.sin(0.9 * t + 0.9) + 0.04 * Math.sin(2.7 * t);
        },
      };
    },
  },
  {
    id: "coalescent",
    district: "odense",
    x: -1.6,
    z: -6.2,
    r: 1.15,
    plot: [2.0, 1.5],
    view: { r: 2.6, up: 0.25, el: 0.72, az: 0.15 },
    build(k) {
      k.block(0, 0, 0, 0).box(2.12, 0.06, 1.62, 0, 0, 0, "#efe9df");
      k.block(0, 0.06, -0.77, 0.1).box(2.12, 0.62, 0.08, 0, 0.06, -0.77, P.mint).box(1.2, 0.14, 0.03, 0, 0.48, -0.715, P.peach, { glow: 2 });
      k.block(-1.02, 0.06, 0, 0.16).box(0.08, 0.62, 1.62, -1.02, 0.06, 0, P.mint);
      winsX(k, 3, -0.45, 0.45, 0.3, -1.065, 0.2, 0.18);
      k.block(1.02, 0.06, 0, 0.2).box(0.08, 0.2, 1.62, 1.02, 0.06, 0, "#d6ebdf");
      k.block(-0.64, 0.06, 0.77, 0.22).box(0.86, 0.14, 0.06, -0.64, 0.06, 0.77, "#d6ebdf");
      k.block(0.7, 0.06, 0.77, 0.24).box(0.66, 0.14, 0.06, 0.7, 0.06, 0.77, "#d6ebdf");
      k.block(0, 0.68, -0.58, 0.3).box(2.2, 0.05, 0.5, 0, 0.68, -0.56, P.paper);
      const goods = [P.peach, P.butter, P.sky, P.rose, P.mint, P.lilac];
      for (let s = 0; s < 3; s++) {
        const z = -0.36 + s * 0.36;
        k.block(-0.15, 0.06, z, 0.36 + s * 0.1).box(1.2, 0.26, 0.14, -0.15, 0.06, z, "#f7f2ea");
        for (const side of [-1, 1])
          for (let row = 0; row < 2; row++)
            for (let i = 0; i < 8; i++)
              k.box(0.11, 0.07, 0.03, -0.64 + i * 0.141, 0.1 + row * 0.1, z + side * 0.078, goods[(i + row * 3 + s * 2 + (side > 0 ? 1 : 0)) % 6], { jitter: 1 });
      }
      k.block(0.78, 0.06, 0.42, 0.62).box(0.22, 0.18, 0.34, 0.78, 0.06, 0.42, P.paper).box(0.23, 0.02, 0.35, 0.78, 0.24, 0.42, P.charcoal);
      // a trolley, parked where the robot turns
      const tx = 0.74;
      const tz = -0.42;
      k.block(tx, 0.06, tz, 0.7)
        .box(0.22, 0.11, 0.14, tx, 0.12, tz, P.silver)
        .box(0.2, 0.012, 0.12, tx, 0.1, tz, P.charcoal)
        .box(0.02, 0.05, 0.16, tx - 0.13, 0.21, tz, P.charcoal);
      for (const [wx, wz] of [
        [-0.08, -0.05],
        [-0.08, 0.05],
        [0.08, -0.05],
        [0.08, 0.05],
      ])
        k.box(0.014, 0.06, 0.014, tx + wx, 0.06, tz + wz, P.charcoal);
    },
    life(g, mat) {
      const robot = new Mesh(
        new Kit()
          .box(0.13, 0.07, 0.17, 0, 0, 0, P.white)
          .cyl(0.014, 0.014, 0.26, 5, 0, 0.07, -0.03, P.silver)
          .box(0.08, 0.06, 0.05, 0, 0.3, -0.03, P.white)
          .build(),
        mat,
      );
      const ledMat = new MeshBasicMaterial({ color: P.mint });
      const led = new Mesh(new BoxGeometry(0.06, 0.022, 0.012), ledMat);
      led.position.set(0, 0.33, -0.0);
      robot.add(led);
      g.add(robot);
      // a loop around the middle aisle; it slows and lights up passing the trolley
      const loop: [number, number][] = [
        [-0.86, -0.18],
        [0.56, -0.18],
        [0.56, 0.18],
        [-0.86, 0.18],
      ];
      const lens = loop.map((p, i) => Math.hypot(loop[(i + 1) % 4][0] - p[0], loop[(i + 1) % 4][1] - p[1]));
      const total = lens.reduce((a, b) => a + b, 0);
      const seen = new Color(P.peach);
      const calm = new Color(P.mint);
      let yaw = 0;
      return {
        update(t, dt) {
          let d = (t * 0.32) % total;
          let i = 0;
          while (d > lens[i]) d -= lens[i++];
          const [ax, az] = loop[i];
          const [bx, bz] = loop[(i + 1) % 4];
          const f = d / lens[i];
          const x = ax + (bx - ax) * f;
          const z = az + (bz - az) * f;
          robot.position.set(x, 0.07, z);
          const want = Math.atan2(bx - ax, bz - az);
          let dy = want - yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          yaw += dy * Math.min(1, dt * 6);
          robot.rotation.y = yaw;
          const near = Math.hypot(x - 0.74, z + 0.42) < 0.5;
          ledMat.color.copy(near ? seen : calm);
        },
      };
    },
  },
  {
    id: "tii",
    district: "abudhabi",
    x: 4.85,
    z: -1.25,
    r: 1.0,
    plot: [1.6, 1.6],
    view: { r: 3.6, up: 1.75, el: 0.42 },
    build(k) {
      k.block(0, 0, 0, 0).box(1.7, 0.14, 1.7, 0, 0, 0, P.stone).box(1.25, 0.03, 1.25, 0, 0.14, 0, P.paper);
      for (let f = 0; f < 8; f++) {
        const y = 0.17 + f * 0.4;
        const s = 0.98 - f * 0.03;
        const ry = f * 0.1;
        k.block(0, y, 0, 0.14 + f * 0.1)
          .box(s, 0.31, s, 0, y, 0, "#f3e9d8", { ry })
          .box(s + 0.025, 0.17, s + 0.025, 0, y + 0.08, 0, P.glass, { ry, glow: 1 })
          .box(s + 0.08, 0.09, s + 0.08, 0, y + 0.31, 0, P.paper, { ry });
      }
      const top = 0.17 + 8 * 0.4;
      k.block(0, top, 0, 1.0)
        .cyl(0.28, 0.38, 0.26, 8, 0, top, 0, P.powder)
        .cyl(0.03, 0.05, 0.62, 6, 0, top + 0.26, 0, P.paper)
        .ball(0.055, 0, top + 0.9, 0, "#ff9a7a", { glow: 2 });
      k.block(0, 0.17, 0.5, 0.2).box(0.36, 0.22, 0.04, 0, 0.17, 0.5, P.plum);
      for (const sx of [-1, 1]) {
        k.block(sx * 0.66, 0.14, 0.62, 0.5 + sx * 0.05);
        palmTree(k, sx * 0.66, 0.14, 0.62, 0.9, sx);
      }
    },
    life(g, mat) {
      // a flock circling the tower, the idea behind the IROS flocking paper
      const drones = instanced(droneGeometry(), mat, 12, PASTELS);
      g.add(drones);
      return {
        update(t) {
          for (let i = 0; i < 12; i++) {
            const a = 0.5 * t + i * 0.21 + 0.12 * Math.sin(0.9 * t + i);
            const r = 1.5 + 0.22 * Math.sin(0.7 * t + i * 1.3);
            const y = 2.7 + 0.32 * Math.sin(1.1 * t + i * 0.7) + 0.2 * Math.sin(0.4 * t);
            setInstance(drones, i, Math.cos(a) * r, y, Math.sin(a) * r, Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI, 0.34, 0.25);
          }
          drones.instanceMatrix.needsUpdate = true;
        },
      };
    },
  },
  {
    id: "tii-team",
    district: "abudhabi",
    x: 6.85,
    z: -0.75,
    r: 1.05,
    plot: [1.8, 1.45],
    view: { r: 2.9, up: 0.55, az: -0.2 },
    build(k) {
      plaza(k, 1.9, 1.55);
      k.block(0, 0.06, -0.25, 0.1).box(1.5, 0.4, 0.8, 0, 0.06, -0.25, P.apricot);
      winsZ(k, 6, -0.6, 0.6, 0.18, 0.16, 0.13, 0.15);
      k.block(0, 0.46, -0.25, 0.28).box(1.5, 0.36, 0.8, 0, 0.46, -0.25, "#f8dcc4");
      winsZ(k, 6, -0.6, 0.6, 0.56, 0.16, 0.13, 0.15);
      winsX(k, 2, -0.45, -0.05, 0.56, 0.76, 0.13, 0.15);
      winsX(k, 2, -0.45, -0.05, 0.56, -0.76, 0.13, 0.15);
      k.block(0, 0.82, -0.25, 0.45)
        .box(1.56, 0.05, 0.86, 0, 0.82, -0.25, P.paper)
        .box(1.56, 0.06, 0.03, 0, 0.87, 0.17, P.paper)
        .box(1.56, 0.06, 0.03, 0, 0.87, -0.67, P.paper)
        .box(0.03, 0.06, 0.86, 0.77, 0.87, -0.25, P.paper)
        .box(0.03, 0.06, 0.86, -0.77, 0.87, -0.25, P.paper);
      k.block(-0.5, 0.87, -0.45, 0.6).ball(0.1, -0.55, 0.92, -0.5, P.sage, { jitter: 1 }).ball(0.08, -0.4, 0.91, -0.52, P.grassDark, { jitter: 1 });
      k.block(0, 0.06, 0.16, 0.2).box(0.3, 0.26, 0.03, 0, 0.06, 0.165, P.plum);
    },
    life(g, mat) {
      // a team of nine
      const team = instanced(meepleGeometry(), mat, 9, [P.peach, P.sky, P.butter, P.mint, P.lilac, P.rose, "#fffaf0", P.powder, P.apricot]);
      g.add(team);
      const spots: [number, number, number][] = [];
      for (let i = 0; i < 9; i++) {
        const a = -1.15 + (i / 8) * 2.3;
        spots.push([Math.sin(a) * 0.62, 0.4 + Math.cos(a) * 0.22, a + Math.PI]);
      }
      // M4: a robot that rolls, then flies (joint program with Caltech)
      const m4 = new Group();
      m4.add(new Mesh(new Kit().box(0.2, 0.07, 0.16, 0, -0.035, 0, P.white).box(0.05, 0.02, 0.02, 0, 0.0, 0.085, P.mint, { glow: 2 }).build(), mat));
      const wheels = new InstancedMesh(new Kit().cyl(0.06, 0.06, 0.022, 10, 0, -0.011, 0, P.peach).build(), mat, 4);
      wheels.frustumCulled = false;
      m4.add(wheels);
      g.add(m4);
      return {
        update(t) {
          for (let i = 0; i < 9; i++) {
            const [x, z, yaw] = spots[i];
            const hop = Math.max(0, Math.sin(2.2 * t + i * 0.9));
            setInstance(team, i, x, 0.06 + 0.04 * hop * hop * hop, z, yaw, 1);
          }
          team.instanceMatrix.needsUpdate = true;
          const u = t % 10;
          const fold = u < 5 ? 0 : u < 6 ? u - 5 : u < 9 ? 1 : 10 - u;
          const flyF = u < 6 ? 0 : u < 7 ? u - 6 : u < 8 ? 1 : u < 9 ? 9 - u : 0;
          const fly = flyF * flyF * (3 - 2 * flyF);
          const ang = u < 5 ? u * 1.25 : 5 * 1.25;
          m4.position.set(0.2 + Math.cos(ang) * 0.3, 0.92 + 0.045 + fly * 0.55, -0.25 + Math.sin(ang) * 0.2);
          m4.rotation.y = -ang;
          const tilt = (1 - fold) * (Math.PI / 2);
          for (let w = 0; w < 4; w++) {
            const sx = w < 2 ? -1 : 1;
            const sz = w % 2 ? -1 : 1;
            _e.set(0, 0, sx * tilt, "XYZ");
            _m.compose(_p.set(sx * (0.12 + 0.03 * fold), 0, sz * 0.075), _q.setFromEuler(_e), _s.set(1, 1, 1));
            wheels.setMatrixAt(w, _m);
          }
          wheels.instanceMatrix.needsUpdate = true;
        },
      };
    },
  },
  {
    id: "unchained",
    district: "remote",
    x: 3.25,
    z: -6.05,
    r: 0.9,
    plot: [1.55, 1.35],
    view: { r: 2.5, up: 0.5, az: -0.2 },
    build(k) {
      plaza(k, 1.65, 1.45);
      k.block(0, 0.06, -0.15, 0.1).box(1.1, 0.5, 0.76, 0, 0.06, -0.15, P.lilac);
      k.box(0.42, 0.34, 0.03, -0.22, 0.06, 0.235, "#8f7fb0");
      winsZ(k, 2, 0.14, 0.38, 0.3, 0.24, 0.13, 0.15);
      winsX(k, 2, -0.35, 0.05, 0.3, 0.56, 0.13, 0.15);
      for (let i = 0; i < 3; i++) {
        const x = -0.367 + i * 0.367;
        k.block(x, 0.56, -0.15, 0.3 + i * 0.1).gable(0.37, 0.24, 0.8, x, 0.56, -0.15, P.cream);
      }
      // Kymatics: a graph of agents on the roof
      const nodes: [number, number][] = [
        [-0.33, 0.98],
        [-0.12, 1.2],
        [0.1, 0.96],
        [0.3, 1.18],
        [0.02, 1.38],
      ];
      const edges = [
        [0, 1],
        [1, 2],
        [2, 3],
        [1, 4],
        [3, 4],
        [0, 2],
      ];
      const z = -0.42;
      k.block(0, 0.72, z, 0.7).box(0.025, 0.36, 0.025, -0.42, 0.72, z, P.plum).box(0.025, 0.36, 0.025, 0.42, 0.72, z, P.plum);
      edges.forEach(([a, b], i) => {
        const [ax, ay] = nodes[a];
        const [bx, by] = nodes[b];
        const len = Math.hypot(bx - ax, by - ay);
        k.block((ax + bx) / 2, (ay + by) / 2, z, 0.8 + i * 0.04).add(new BoxGeometry(len, 0.018, 0.018), (ax + bx) / 2, (ay + by) / 2, z, P.plum, {
          rz: Math.atan2(by - ay, bx - ax),
        });
      });
      const nodeCol = [P.mint, P.peach, P.butter, P.sky, P.rose];
      nodes.forEach(([x, y], i) => k.block(x, y, z, 0.95 + i * 0.05).ball(0.055, x, y, z, nodeCol[i], { glow: 2 }, 1));
      // the queue of build jobs leaves on a conveyor
      k.block(0.1, 0.06, 0.55, 0.55)
        .box(1.12, 0.04, 0.18, 0.1, 0.13, 0.55, P.charcoal)
        .box(1.12, 0.03, 0.02, 0.1, 0.16, 0.45, P.silver)
        .box(1.12, 0.03, 0.02, 0.1, 0.16, 0.65, P.silver);
      for (const x of [-0.38, 0.1, 0.58]) k.box(0.03, 0.07, 0.14, x, 0.06, 0.55, P.charcoal);
    },
    life(g, mat) {
      const crates = instanced(new Kit().box(0.1, 0.09, 0.1, 0, 0, 0, P.white).box(0.104, 0.02, 0.104, 0, 0.05, 0, P.white).build(), mat, 6, [
        P.peach,
        P.butter,
        P.mint,
        P.sky,
        P.rose,
        P.lilac,
      ]);
      g.add(crates);
      return {
        update(t) {
          for (let i = 0; i < 6; i++) {
            const u = (t * 0.11 + i / 6) % 1;
            const s = Math.min(1, u / 0.06, (1 - u) / 0.06);
            setInstance(crates, i, -0.4 + u * 1.0, 0.17, 0.55, 0, Math.max(s, 0.001));
          }
          crates.instanceMatrix.needsUpdate = true;
        },
      };
    },
  },
  {
    id: "sirb",
    district: "abudhabi",
    x: 5.45,
    z: 2.2,
    r: 1.35,
    plot: [1.7, 1.7],
    view: { r: 3.3, up: 1.25, el: 0.5 },
    build(k) {
      k.block(0, 0, 0, 0).cyl(1.25, 1.3, 0.08, 6, 0, 0, 0, "#e2e6ee");
      k.block(0, 0.08, 0, 0.12).cyl(1.06, 1.06, 0.012, 6, 0, 0.08, 0, P.peach).cyl(0.97, 0.97, 0.016, 6, 0, 0.08, 0, "#e9ecf2");
      k.cyl(0.2, 0.2, 0.02, 16, 0, 0.08, 0, P.lavender);
      let n = 0;
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) {
          if (i === 2 && j === 2) continue;
          const x = (j - 2) * 0.32;
          const z = (i - 2) * 0.32;
          k.block(x, 0.09, z, 0.25 + n++ * 0.015).cyl(0.075, 0.075, 0.014, 8, x, 0.09, z, P.lavender, { glow: 1 });
        }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.block(Math.sin(a) * 1.18, 0.08, Math.cos(a) * 1.18, 0.6 + i * 0.04).ball(0.04, Math.sin(a) * 1.18, 0.11, Math.cos(a) * 1.18, P.butter, { glow: 2 });
      }
      // hangar and control mast behind the pad
      k.block(0, 0, -1.65, 0.45)
        .box(1.0, 0.34, 0.56, 0, 0, -1.65, P.lavender)
        .add(new CylinderGeometry(0.28, 0.28, 1.02, 12), 0, 0.34, -1.65, P.paper, { rz: Math.PI / 2 })
        .box(0.5, 0.28, 0.03, 0, 0, -1.36, P.charcoal);
      k.block(0.78, 0, -1.25, 0.6)
        .cyl(0.04, 0.05, 0.7, 6, 0.78, 0, -1.25, P.paper)
        .box(0.22, 0.14, 0.22, 0.78, 0.7, -1.25, P.glass, { glow: 1 })
        .box(0.26, 0.03, 0.26, 0.78, 0.84, -1.25, P.paper);
    },
    life(g, mat) {
      // the sirb: parked on the pad by day, flying together at night
      const drones = instanced(droneGeometry(), mat, 24, ["#fffaf0", "#d9cff0", "#ffd7c2", "#cfe9dc"]);
      g.add(drones);
      const docks: [number, number][] = [];
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) if (!(i === 2 && j === 2)) docks.push([(j - 2) * 0.32, (i - 2) * 0.32]);
      let flyT = 0;
      return {
        update(t, dt, night) {
          flyT = night > 0.5 ? Math.min(flyT + dt, 6) : Math.max(flyT - dt * 1.5, 0);
          for (let i = 0; i < 24; i++) {
            const p = Math.min(1, Math.max(0, (flyT - i * 0.07) / 1.6));
            const e = p * p * (3 - 2 * p);
            const a = (i / 24) * Math.PI * 2 + 0.35 * t;
            const r = 0.95 + 0.18 * Math.sin(3 * a + 0.8 * t);
            const fy = 2.2 + 0.28 * Math.sin(2 * a - 1.1 * t);
            const [dx, dz] = docks[i];
            const x = dx + (Math.cos(a) * r - dx) * e;
            const z = dz + (Math.sin(a) * r - dz) * e;
            const y = 0.16 + (fy - 0.16) * e + Math.sin(Math.PI * e) * 0.4;
            const yaw = e > 0.5 ? Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI : 0;
            setInstance(drones, i, x, y + (e > 0.99 ? 0.03 * Math.sin(2 * t + i) : 0), z, yaw, 0.3, e * 0.2);
          }
          drones.instanceMatrix.needsUpdate = true;
        },
      };
    },
  },
  {
    id: "clanker",
    district: "remote",
    x: 5.0,
    z: -7.25,
    r: 0.7,
    plot: [1.05, 0.9],
    view: { r: 2.0, up: 0.4 },
    build(k) {
      k.block(0, 0, 0, 0).box(1.15, 0.05, 1.0, 0, 0, 0, "#dfeccf");
      k.block(-0.08, 0.05, -0.1, 0.12).box(0.62, 0.38, 0.5, -0.08, 0.05, -0.1, P.rose);
      winsZ(k, 2, -0.3, -0.06, 0.2, 0.16, 0.11, 0.13);
      k.box(0.13, 0.24, 0.03, 0.12, 0.05, 0.16, P.plum);
      k.block(-0.08, 0.43, -0.1, 0.3).gable(0.6, 0.26, 0.74, -0.08, 0.43, -0.1, P.plum, { ry: Math.PI / 2 });
      k.block(-0.28, 0.5, -0.2, 0.4).box(0.07, 0.18, 0.07, -0.28, 0.5, -0.2, P.clayDark);
      k.block(0.1, 0.6, -0.1, 0.5).cyl(0.01, 0.01, 0.42, 5, 0.1, 0.6, -0.1, P.charcoal).ball(0.03, 0.1, 1.03, -0.1, "#ff9a7a", { glow: 2 });
      // the home server, with an agent in front of it
      k.block(0.42, 0.05, -0.15, 0.42).box(0.17, 0.32, 0.18, 0.42, 0.05, -0.15, P.charcoal);
      for (const y of [0.12, 0.2, 0.28]) k.box(0.12, 0.018, 0.012, 0.42, y, -0.055, P.mint, { glow: 2 });
      k.block(0.38, 0.05, 0.3, 0.55);
      blossomTree(k, 0.38, 0.05, 0.3, 0.8);
    },
  },
  {
    id: "court",
    district: "remote",
    x: 4.75,
    z: -5.45,
    r: 0.7,
    plot: [0.66, 1.06],
    turn: Math.PI / 2,
    view: { r: 2.0, up: 0.3 },
    build(k) {
      k.block(0, 0, 0, 0).box(0.74, 0.04, 1.14, 0, 0, 0, "#e7e1d6").box(0.62, 0.012, 1.02, 0, 0.04, 0, P.court);
      const L = "#fff7ef";
      k.block(0, 0.05, 0, 0.15)
        .box(0.62, 0.006, 0.014, 0, 0.052, 0.5, L)
        .box(0.62, 0.006, 0.014, 0, 0.052, -0.5, L)
        .box(0.014, 0.006, 1.0, 0.303, 0.052, 0, L)
        .box(0.014, 0.006, 1.0, -0.303, 0.052, 0, L)
        .box(0.62, 0.006, 0.014, 0, 0.052, 0, L)
        .cyl(0.1, 0.1, 0.004, 16, 0, 0.052, 0, L)
        .cyl(0.087, 0.087, 0.005, 16, 0, 0.053, 0, P.court)
        .box(0.2, 0.005, 0.2, 0, 0.052, 0.39, "#e48f6f")
        .box(0.2, 0.005, 0.2, 0, 0.052, -0.39, "#e48f6f");
      for (const s of [-1, 1])
        k.block(0, 0.04, s * 0.56, 0.3 + (s + 1) * 0.05)
          .cyl(0.012, 0.012, 0.36, 5, 0, 0.04, s * 0.57, P.charcoal)
          .box(0.2, 0.13, 0.012, 0, 0.3, s * 0.54, P.white)
          .cyl(0.04, 0.04, 0.008, 10, 0, 0.32, s * 0.5, "#e8814d");
    },
    life(g, mat) {
      const ball = new Mesh(new Kit().ball(0.03, 0, 0, 0, "#e8814d", {}, 1).build(), mat);
      g.add(ball);
      return {
        update(t) {
          ball.position.set(0.08 * Math.sin(1.3 * t), 0.08 + 0.2 * Math.abs(Math.sin(3.2 * t)), 0.32 * Math.sin(0.6 * t));
        },
      };
    },
  },
];
