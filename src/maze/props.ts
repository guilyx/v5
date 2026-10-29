import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Maze, ROOMS, type RoomDef, W, rng, wallRuns } from "./layout";
import { Atlas, SANS, SERIF, fitText, quad, roundRect, spaced, spacedWidth, wrap } from "./paint";
import { PAL, blobTexture, clay } from "./gfx";
import { Kit, PX, cellAt, detOf, glow, gx, gz, hitBox, instanceBoxes, paintWord, wallScreen } from "./kit";
import { buildRobot } from "./robot";
import { PHOTOS, PROJECTS } from "../media";
import { BlocksTable } from "./blocks";
import { RANGE, SHORT, SwarmNet } from "./swarm";

type Cell = [number, number];
import { c2, orchestration, planTrack, swarmControl } from "./tii";
import { hiventive } from "./hiventive";
import { nantes } from "./nantes";
import { warehouse } from "./warehouse";
import { backroom } from "./cmr";
import { flamingoGeometry, lanterns, mangrove, palm, parasol, shrub } from "./outdoor";

/**
 * The rooms. Each chapter gets a few props built from primitives, merged so a room costs one
 * or two draw calls, plus whatever it paints on the floor (all floor paint shares one atlas).
 */

export interface Ctx {
  maze: Maze;
  atlas: Atlas;
  decals: THREE.BufferGeometry[];
  reduced: boolean;
  robot: { x: number; z: number; alt: number; heading: number; flying: boolean };
  kick: () => void;
  emit: (type: "photo" | "project", value: number | string | null) => void;
}

/** something in a room you can point at: a card shows what it is and what you can do with it */
export interface Interactable {
  id: string;
  room: number;
  name: string;
  /** active: you ask the robot to do something with it; passive: it reacts to the robot on its own */
  kind: "active" | "passive";
  blurb: string;
  /** what the hover ray tests */
  targets: THREE.Object3D[];
  /** where the card points, in world space */
  anchor(): THREE.Vector3;
  highlight(on: boolean): void;
  /** things it does on its own, at your request (the swarm's faults) */
  actions?(): { id: string; label: string; primary?: boolean }[];
  run?(action: string): void;
  /** what it's saying right now (a protocol's messages), for the story's "Try it" box */
  live?(): string;
}

/**
 * The trolley in the supermarket, built for robots that dock underneath: four legs wrapped in
 * retro-reflective tape (bright to a LiDAR), a frame high enough for M4 to drive under and lift,
 * a fiducial tag on the handle side for cameras, and a handle an arm can hook.
 */
export const TROLLEY = {
  /** leg centres, in the trolley's frame (x along its length, the handle at -x) */
  legX: 0.55,
  legZ: 0.44,
  legR: 0.03,
  /** underside of the frame, where a lift deck pushes */
  frameY: 0.62,
  handleX: -0.74,
  handleY: 1.0,
  halfL: 0.6,
  halfD: 0.49,
};
export type TrolleyState = "idle" | "scanning" | "locked" | "lifted" | "hooked";

export interface Trolley {
  group: THREE.Group;
  /** trolley centres: where it starts, and the checkout */
  home: [number, number];
  checkout: [number, number];
  /** grid cell under each spot */
  homeCell: [number, number];
  checkoutCell: [number, number];
  at: "home" | "checkout";
  /** free on its wheels, lifted on a robot's deck, or hooked to a robot's arm */
  mode: "free" | "lifted" | "hooked";
  /** where it really is; the robot only ever has an estimate */
  pose: { x: number; z: number; yaw: number };
  setPose(x: number, z: number, yaw: number, lift?: number): void;
  /** leg centres in world space, front left, front right, back left, back right */
  legs(): [number, number][];
  /** world position of the middle of the handle bar */
  handle(): THREE.Vector3;
  status(s: TrolleyState): void;
}

/** something the robot's camera can detect: a class, a label, and where it is right now */
export interface Det {
  key: string;
  cls: string;
  label: string;
  box: THREE.Box3;
}

export interface Fx {
  room: number;
  group: THREE.Group;
  /** report the detectable objects, with up-to-date boxes */
  detect?(out: Det[]): void;
  /** a live readout drawn over the scene (the swarm's network health) */
  hud?(): { at: THREE.Vector3; title: string; lines: string[]; color: string } | null;
  ix?: Interactable[];
  table?: BlocksTable;
  trolley?: Trolley;
  /** animate; return true while it still needs frames */
  update?(now: number, dt: number, inside: boolean, near: boolean): boolean;
  /** clickable meshes, with a handler */
  pick?: { object: THREE.Object3D; hit: (face: number) => void }[];
  /** called once when the robot first gets close: load the heavier media */
  approach?(): void;
  /** the scene is going to sleep: stop anything that runs on its own (video) */
  sleep?(): void;
}

/* ============================================================== floor lettering for every room */


function paintLabel(ctx: Ctx, r: RoomDef) {
  const c = ctx.atlas.ctx;
  const nameFont = (px: number) => `italic 400 ${px}px ${SERIF}`;
  const subFont = (px: number) => `650 ${px}px ${SANS}`;
  const big = r.id === "start" ? 1.18 : 1;
  const namePx = fitText(c, r.name, nameFont, Math.round(128 * big), (r.w - 0.9) * PX);
  c.font = nameFont(namePx);
  const nameW = c.measureText(r.name).width;
  c.font = subFont(27);
  const subW = spacedWidth(c, r.sub, 6);
  const w = Math.max(nameW, subW) + 16;
  const h = namePx * 0.98 + 44;
  ctx.atlas.queue(
    w,
    h,
    (k) => {
      k.fillStyle = r.ink;
      k.globalAlpha = 0.92;
      const right = r.id !== "start";
      k.font = nameFont(namePx);
      k.textBaseline = "alphabetic";
      k.fillText(r.name, right ? w - 8 - nameW : 6, namePx * 0.78);
      k.font = subFont(27);
      spaced(k, r.sub, right ? w - 6 - subW : 8, namePx * 0.78 + 38, 6);
    },
    (uv) => {
      const ww = w / PX;
      const hh = h / PX;
      // names sit bottom-right in each room, clear of the map card; the entrance keeps its title top-left
      const cx = r.id === "start" ? gx(r.x + r.label[0]) + ww / 2 : gx(r.x + r.w - r.label[0]) - ww / 2;
      ctx.decals.push(quad(cx, 0.004, gz(r.y + r.label[1]), ww, hh, uv));
    },
  );
}

/* ============================================================== 00 · the entrance */

function start(ctx: Ctx, r: RoomDef): Fx {
  // the brand mark, painted large: three dots joined by an open path
  const S = 360;
  ctx.atlas.queue(
    S,
    S,
    (k) => {
      const a: [number, number] = [S / 2, 46];
      const b: [number, number] = [46, S - 60];
      const c: [number, number] = [S - 46, S - 60];
      k.strokeStyle = r.ink;
      k.globalAlpha = 0.5;
      k.lineWidth = 12;
      k.lineCap = "round";
      k.lineJoin = "round";
      k.beginPath();
      k.moveTo(...a);
      k.lineTo(...b);
      k.lineTo(...c);
      k.stroke();
      k.globalAlpha = 0.9;
      for (const [p, col] of [[a, r.ink], [b, r.ink], [c, PAL.accent]] as const) {
        k.fillStyle = col;
        k.beginPath();
        k.arc(p[0], p[1], 30, 0, Math.PI * 2);
        k.fill();
      }
    },
    (uv) => {
      const [x, z] = cellAt(r, 6.4, 4);
      ctx.decals.push(quad(x, 0.004, z, 2.7, 2.7, uv));
    },
  );
  // a charging dock painted where the robot wakes up
  ctx.atlas.queue(
    150,
    150,
    (k) => {
      k.strokeStyle = r.ink;
      k.globalAlpha = 0.55;
      k.lineWidth = 7;
      k.setLineDash([16, 12]);
      roundRect(k, 8, 8, 134, 134, 30);
      k.stroke();
    },
    (uv) => {
      const [x, z] = cellAt(r, r.anchor[0], r.anchor[1]);
      ctx.decals.push(quad(x, 0.004, z, 1.15, 1.15, uv));
    },
  );
  // a small flag at the way in
  const kit = new Kit();
  const fx = gx(0.5);
  const fz = gz(r.y + 2.5) - 0.62;
  kit.cyl(0.03, 0.03, 1.5, fx, 0.75 + 0.86, fz, "#6b4a2b", 8);
  const flag = new THREE.BufferGeometry();
  flag.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.62, -0.18, 0, 0, -0.36, 0, 0, 0, 0, 0, -0.36, 0, 0.62, -0.18, 0], 3));
  flag.computeVertexNormals();
  flag.translate(fx + 0.03, 2.3, fz);
  kit.add(flag, PAL.accent);
  const g = new THREE.Group();
  g.add(kit.mesh());
  return { room: 0, group: g };
}

/* ============================================================== 03 · Coimbra, a maze in the maze */

function trophy(kit: Kit, x: number, z: number, scale = 1.55) {
  const t = new Kit();
  t.box(0.5, 0.14, 0.5, 0, 0.07, 0, "#5b3b25");
  t.box(0.36, 0.1, 0.36, 0, 0.19, 0, "#6e4a30");
  t.cyl(0.11, 0.11, 0.03, 0, 0.255, 0, PAL.gold, 18);
  t.cyl(0.035, 0.06, 0.18, 0, 0.35, 0, PAL.gold, 12);
  // the cup: up the outside, over the lip, down the inside
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push(new THREE.Vector2(0.04 + 0.17 * Math.pow(Math.sin((k * Math.PI) / 2), 0.7), 0.43 + k * 0.3));
  }
  pts.push(new THREE.Vector2(0.2, 0.74), new THREE.Vector2(0.18, 0.725), new THREE.Vector2(0.14, 0.6), new THREE.Vector2(0.001, 0.58));
  t.add(new THREE.LatheGeometry(pts, 24), PAL.gold);
  for (const s of [-1, 1]) {
    const hnd = new THREE.TorusGeometry(0.075, 0.02, 6, 14, Math.PI);
    hnd.rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2);
    hnd.translate(s * 0.2, 0.6, 0);
    t.add(hnd, PAL.gold);
  }
  const g = mergeGeometries(t.parts);
  g.scale(scale, scale, scale);
  g.translate(x, 0, z);
  kit.parts.push(g);
}

function coimbra(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  // the platform: cells 3..7 x 2..6 of the room
  const px0 = gx(r.x + 3);
  const pz0 = gz(r.y + 2);
  const size = 5;
  const top = 0.2;
  const base = new Kit();
  base.box(size - 0.1, top, size - 0.1, px0 + size / 2, top / 2, pz0 + size / 2, "#fbf7ef");
  base.box(size + 0.02, 0.05, size + 0.02, px0 + size / 2, 0.025, pz0 + size / 2, "#c9b48f");
  trophy(base, ...cellAt(r, 1, 4));
  trophy(base, ...cellAt(r, 9, 4));
  g.add(base.mesh({ emissive: 0.05 }));
  paintWord(ctx, "MAPPED", r.ink, ...(cellAt(r, 1, 5.15) as [number, number]), 26, 4);
  paintWord(ctx, "UNMAPPED", r.ink, ...(cellAt(r, 9, 5.15) as [number, number]), 26, 4);

  // a small seeded maze on top, solved forever by a small robot
  const N = 13;
  const c = (size - 0.4) / N;
  const ox = px0 + 0.2;
  const oz = pz0 + 0.2;
  const rand = rng(2019);
  const grid = new Uint8Array(N * N).fill(1);
  const stack: Cell[] = [[1, 1]];
  grid[1 * N + 1] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = ([[2, 0], [-2, 0], [0, 2], [0, -2]] as Cell[]).filter(
      ([dx, dy]) => x + dx > 0 && y + dy > 0 && x + dx < N - 1 && y + dy < N - 1 && grid[(y + dy) * N + x + dx],
    );
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = opts[Math.floor(rand() * opts.length)];
    grid[(y + dy / 2) * N + x + dx / 2] = 0;
    grid[(y + dy) * N + x + dx] = 0;
    stack.push([x + dx, y + dy]);
  }
  grid[1 * N + 0] = 0; // way in
  grid[(N - 2) * N + N - 1] = 0; // way out
  const runs = wallRuns(N, N, (x, y) => x >= 0 && y >= 0 && x < N && y < N && grid[y * N + x] === 1, () => 0, 0.3);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), clay({ bevel: true, color: "#5f86c9" }), runs.length);
  const mt = new THREE.Matrix4();
  runs.forEach((b, i) => {
    mt.makeScale(b.sx * c, 0.13, b.sz * c);
    mt.setPosition(ox + b.cx * c, top + 0.065, oz + b.cz * c);
    walls.setMatrixAt(i, mt);
  });
  g.add(walls);

  // breadth-first solution from the way in to the way out
  const prev = new Int32Array(N * N).fill(-2);
  const q = [1 * N + 0];
  prev[q[0]] = -1;
  while (q.length) {
    const cur = q.shift()!;
    const x = cur % N;
    const y = (cur - x) / N;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || grid[ny * N + nx] || prev[ny * N + nx] !== -2) continue;
      prev[ny * N + nx] = cur;
      q.push(ny * N + nx);
    }
  }
  const sol: [number, number][] = [];
  for (let k = (N - 2) * N + N - 1; k !== -1; k = prev[k]) {
    const x = k % N;
    sol.push([ox + (x + 0.5) * c, oz + ((k - x) / N + 0.5) * c]);
  }
  sol.reverse();
  const mini = buildRobot(0.42);
  mini.root.position.y = top;
  g.add(mini.root);
  let s = 0;
  let pause = 0;
  const speed = 1.15;
  const place = () => {
    const i = Math.min(sol.length - 2, Math.floor(s));
    const t = s - i;
    const [ax, az] = sol[i];
    const [bx, bz] = sol[i + 1];
    mini.root.position.x = ax + (bx - ax) * t;
    mini.root.position.z = az + (bz - az) * t;
    const want = -Math.atan2(bz - az, bx - ax);
    let d = want - mini.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    mini.root.rotation.y += d * 0.35;
  };
  place();
  const mini0 = detOf("coimbra-robot", "robot");
  return {
    room: 3,
    group: g,
    detect(out) {
      out.push(mini0);
      mini0.box.setFromObject(mini.root);
    },
    update(now, dt) {
      if (ctx.reduced) return false;
      mini.puck.rotation.y = now * 9;
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) s = 0;
        return true;
      }
      s += (dt * speed) / c / 1.0;
      if (s >= sol.length - 1.001) {
        s = sol.length - 1.001;
        pause = 1.4;
      }
      place();
      mini.wheels.forEach((w) => (w.rotation.z -= dt * 8));
      return true;
    },
  };
}

/* ============================================================== 04 · Centrale, the papers */

function posterCanvas(kicker: string, title: string, art: (k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void) {
  const cw = 1024;
  const ch = 640;
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const k = cv.getContext("2d")!;
  k.fillStyle = "#fffdf8";
  k.fillRect(0, 0, cw, ch);
  k.fillStyle = "#4b428f";
  k.fillRect(0, 0, cw, 14);
  k.fillStyle = "#4b428f";
  k.font = `700 32px ${SANS}`;
  spaced(k, kicker, 56, 82, 5);
  k.fillStyle = "#1f1a2e";
  k.font = `italic 400 84px ${SERIF}`;
  const lines = wrap(k, title, cw - 112);
  lines.forEach((l, i) => k.fillText(l, 56, 172 + i * 84));
  art(k, 56, 196 + lines.length * 84, cw - 112, ch - (226 + lines.length * 84));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function centrale(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const posters = [
    {
      kicker: "PREPRINT · 2021",
      title: "Survey of the Multi-Agent Pathfinding Solutions",
      x: 3,
      art: (k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
        // three agents sharing a grid
        const n = 12;
        const s = Math.min(h / 4, w / n);
        k.strokeStyle = "#d9d4ec";
        k.lineWidth = 2;
        for (let i = 0; i <= n; i++) {
          k.beginPath();
          k.moveTo(x + i * s, y);
          k.lineTo(x + i * s, y + 4 * s);
          k.stroke();
        }
        for (let j = 0; j <= 4; j++) {
          k.beginPath();
          k.moveTo(x, y + j * s);
          k.lineTo(x + n * s, y + j * s);
          k.stroke();
        }
        const paths: [string, number[][]][] = [
          ["#e4572e", [[0, 0], [4, 0], [4, 2], [11, 2]]],
          ["#3a6bf0", [[0, 3], [7, 3], [7, 0], [11, 0]]],
          ["#2f8f6b", [[11, 3], [9, 3], [9, 1], [2, 1]]],
        ];
        k.lineWidth = 7;
        k.lineCap = "round";
        k.lineJoin = "round";
        for (const [col, p] of paths) {
          k.strokeStyle = col;
          k.beginPath();
          p.forEach(([a, b], i) => (i ? k.lineTo : k.moveTo).call(k, x + (a + 0.5) * s, y + (b + 0.5) * s));
          k.stroke();
          k.fillStyle = col;
          k.beginPath();
          k.arc(x + (p[0][0] + 0.5) * s, y + (p[0][1] + 0.5) * s, s * 0.28, 0, 7);
          k.fill();
        }
      },
    },
    {
      kicker: "PREPRINT · 2021",
      title: "Real-time Jitter Measurements under ROS2: the Inverted Pendulum Case",
      x: 8,
      art: (k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
        // an inverted pendulum on a cart
        const cx = x + w * 0.3;
        const base = y + h - 10;
        k.strokeStyle = "#1f1a2e";
        k.lineWidth = 4;
        k.beginPath();
        k.moveTo(x, base);
        k.lineTo(x + w * 0.6, base);
        k.stroke();
        k.fillStyle = "#4b428f";
        roundRect(k, cx - 60, base - 54, 120, 44, 8);
        k.fill();
        k.lineWidth = 8;
        k.strokeStyle = "#1f1a2e";
        k.beginPath();
        k.moveTo(cx, base - 54);
        k.lineTo(cx + 40, Math.max(y + 10, base - 54 - h * 0.75));
        k.stroke();
        k.fillStyle = "#e4572e";
        k.beginPath();
        k.arc(cx + 40, Math.max(y + 10, base - 54 - h * 0.75), 18, 0, 7);
        k.fill();
        k.fillStyle = "#4b428f";
        k.font = `600 30px ${SANS}`;
        k.fillText("ROS 2 · Xenomai · latency", x + w * 0.62, base - 30);
      },
    },
  ];
  const kit = new Kit();
  const posterDets: Det[] = [];
  const pw = 4.3;
  const ph = 2.69;
  const lean = 0.56;
  for (const p of posters) {
    const tex = posterCanvas(p.kicker, p.title, p.art);
    const [x] = cellAt(r, p.x - 0.5, 0);
    const z = gz(r.y) + 0.8;
    const y0 = 0.16;
    const yc = y0 + (ph / 2) * Math.cos(lean);
    const zc = z - (ph / 2) * Math.sin(lean);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), clay({ map: tex, emissive: 0.25 }));
    // sit the print just in front of its board, along the board's normal (no z-fighting)
    plane.position.set(x, yc + 0.045 * Math.sin(lean), zc + 0.045 * Math.cos(lean));
    plane.rotation.x = -lean;
    g.add(plane);
    plane.updateMatrixWorld();
    const d = detOf(`poster-${p.x}`, "poster");
    d.box.setFromObject(plane);
    posterDets.push(d);
    // the board and its easel
    const board = new THREE.BoxGeometry(pw + 0.14, ph + 0.14, 0.05);
    board.rotateX(-lean);
    board.translate(x, yc, zc);
    kit.add(board, "#3e3567");
    for (const s of [-1, 1]) kit.box(0.07, 0.07, 0.6, x + s * (pw / 2 - 0.2), 0.08, z - 0.15, "#3e3567");
  }

  // an inverted pendulum that balances while you watch
  const [px, pz] = cellAt(r, 9, 3);
  kit.box(1.25, 0.06, 0.2, px, 0.03, pz, "#3e3567");
  kit.box(0.05, 0.2, 0.2, px - 0.62, 0.1, pz, "#3e3567");
  kit.box(0.05, 0.2, 0.2, px + 0.62, 0.1, pz, "#3e3567");
  g.add(kit.mesh());
  const cart = new THREE.Group();
  const ck = new Kit();
  ck.box(0.28, 0.12, 0.2, 0, 0.11, 0, "#7d72c4");
  ck.cyl(0.035, 0.035, 0.22, 0, 0.17, 0, "#2f2a45", 10, [Math.PI / 2, 0, 0]);
  cart.add(ck.mesh());
  const pole = new THREE.Group();
  const pk = new Kit();
  pk.cyl(0.018, 0.018, 0.85, 0, 0.425, 0, "#2f2a45", 8);
  const bob = new THREE.SphereGeometry(0.07, 14, 10);
  bob.translate(0, 0.86, 0);
  pk.add(bob, PAL.accent);
  pole.add(pk.mesh());
  pole.position.y = 0.17;
  cart.add(pole);
  cart.position.set(px, 0, pz);
  cart.scale.setScalar(1.35);
  g.add(cart);

  // the blocks world: a table, four blocks, and a PDDL plan for the arm to carry out
  const [bx, bz] = cellAt(r, 8, 7);
  const table = new BlocksTable(bx, bz, "#7d72c4", "#3e3567");
  // the MAPF testbed, on its raised floor
  const wh = warehouse(ctx, 4, gx(r.x), gz(r.y + 3));
  g.add(wh.group);
  g.add(table.group);
  const tableGlow = glow(table.targets);
  const pendulumGlow = glow([cart]);
  // the pole is too thin to point at: an invisible box around the bench catches the pointer
  const pendulumHit = hitBox(1.5, 1.5, 0.7, px, 0.75, pz);
  g.add(pendulumHit);
  const ix: Interactable[] = [
    {
      id: "blocks",
      room: 4,
      name: "Blocks world",
      kind: "active",
      blurb: "A STRIPS problem on a table. The planner reads the PDDL, finds the shortest plan, and the arm carries it out.",
      targets: table.targets,
      anchor: () => new THREE.Vector3(bx, 1.05, bz),
      highlight: tableGlow,
    },
    {
      id: "pendulum",
      room: 4,
      name: "Inverted pendulum",
      kind: "passive",
      blurb: "Balancing on a cart: the test bench of the ROS 2 jitter paper. It keeps itself up.",
      targets: [cart, pendulumHit],
      anchor: () => new THREE.Vector3(px, 1.45, pz),
      highlight: pendulumGlow,
    },
    wh.ix,
  ];
  const blockDets = Object.keys(table.blocks).map((n) => detOf(`block-${n}`, "block", `block ${n.toUpperCase()}`));
  const cartDet = detOf("pendulum", "pendulum");
  return {
    room: 4,
    group: g,
    ix,
    table,
    detect(out) {
      blockDets.forEach((d) => d.box.setFromObject(table.blocks[d.key.slice(6)]));
      cartDet.box.setFromObject(cart);
      out.push(...blockDets, cartDet, ...posterDets);
      wh.detect(out);
    },
    hud: () => wh.hud(),
    update(now, dt) {
      wh.update(now, dt);
      if (ctx.reduced) return true;
      const th = 0.16 * Math.sin(now * 2.3) + 0.05 * Math.sin(now * 5.1);
      pole.rotation.z = -th;
      cart.position.x = px + 0.3 * Math.sin(now * 2.3 + 0.5);
      return true;
    },
  };
}

/* ============================================================== 05 · Coalescent, the supermarket */

function coalescent(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const kit = new Kit();
  const rand = rng(2021);
  const products: { x: number; y: number; z: number; w: number; h: number; d: number; c: string }[] = [];
  const palette = ["#e4572e", "#f1b33b", "#3a9d8f", "#f4ecd8", "#2d4f8c", "#e98aa5", "#7cb35b", "#f08a3c"];
  for (const row of [2, 7]) {
    const x0 = gx(r.x + 2);
    const len = 7;
    const zc = gz(r.y + row + 0.5);
    const xc = x0 + len / 2;
    kit.box(len, 0.1, 0.84, xc, 0.05, zc, "#5d6b63");
    kit.box(len, 1.05, 0.05, xc, 0.6, zc, "#e9ece6");
    for (const s of [-1, 1]) kit.box(0.06, 1.12, 0.84, xc + s * (len / 2 - 0.03), 0.56, zc, "#5d6b63");
    for (const lvl of [0.14, 0.47, 0.8]) {
      for (const side of [-1, 1]) {
        kit.box(len - 0.1, 0.03, 0.38, xc, lvl, zc + side * 0.21, "#cfd6cf");
        let x = x0 + 0.12;
        let col = palette[Math.floor(rand() * palette.length)];
        while (x < x0 + len - 0.35) {
          const w = 0.14 + rand() * 0.16;
          if (rand() < 0.22) col = palette[Math.floor(rand() * palette.length)];
          products.push({ x: x + w / 2, y: lvl + 0.015, z: zc + side * 0.22, w, h: 0.14 + rand() * 0.15, d: 0.24 + rand() * 0.08, c: col });
          x += w + 0.02;
        }
      }
    }
  }
  g.add(kit.mesh());
  const prod = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), clay({ bevel: true }), products.length);
  const mt = new THREE.Matrix4();
  const col = new THREE.Color();
  products.forEach((p, i) => {
    mt.makeScale(p.w, p.h, p.d);
    mt.setPosition(p.x, p.y + p.h / 2, p.z);
    prod.setMatrixAt(i, mt);
    prod.setColorAt(i, col.set(p.c));
  });
  g.add(prod);

  // the trolley: built around its own origin, so it can be docked to, lifted and moved
  const [tx, tz] = cellAt(r, 6, 5);
  const [ox, oz] = cellAt(r, 9, 5);
  const tg = new THREE.Group();
  g.add(tg);
  const T = TROLLEY;
  const t = new Kit();
  const steel = "#9fb0bd";
  const dark = "#2f3336";
  const L = T.halfL * 2;
  const D = T.halfD * 2;
  const yb = T.frameY + 0.05;
  // casters and legs, at the corners of the frame
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const lx = sx * T.legX;
      const lz = sz * T.legZ;
      t.cyl(0.045, 0.045, 0.032, lx, 0.045, lz, dark, 12, [Math.PI / 2, 0, 0]);
      t.box(0.05, 0.05, 0.05, lx, 0.1, lz, "#5d6b63");
      t.cyl(0.022, 0.022, T.frameY - 0.12, lx, (T.frameY + 0.12) / 2, lz, steel, 10);
    }
  // the frame M4's deck pushes on, and the plate in its middle
  for (const sz of [-1, 1]) t.box(T.legX * 2 + 0.06, 0.04, 0.04, 0, T.frameY + 0.02, sz * T.legZ, steel);
  for (const sx of [-1, 1]) t.box(0.04, 0.04, T.legZ * 2, sx * T.legX, T.frameY + 0.02, 0, steel);
  t.box(0.46, 0.022, T.legZ * 2, 0, T.frameY + 0.011, 0, "#5d6b63");
  // the basket
  t.box(L, 0.025, D, 0, yb, 0, steel);
  for (const h of [0.12, 0.25, 0.38]) {
    t.box(L, 0.022, 0.022, 0, yb + h, -D / 2, steel);
    t.box(L, 0.022, 0.022, 0, yb + h, D / 2, steel);
    t.box(0.022, 0.022, D, -L / 2, yb + h, 0, steel);
    t.box(0.022, 0.022, D, L / 2, yb + h, 0, steel);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.box(0.025, 0.4, 0.025, (sx * L) / 2, yb + 0.2, (sz * D) / 2, steel);
  // the handle, on the -x side, with its brackets
  t.box(0.03, 0.03, D + 0.06, T.handleX, T.handleY, 0, "#2f7d4f");
  for (const sz of [-1, 1]) t.box(T.handleX + L / 2 + 0.04, 0.025, 0.025, (T.handleX - L / 2) / 2, T.handleY - 0.04, (sz * D) / 2 - 0.02, steel);
  // a few groceries in the basket
  const goods = ["#e4572e", "#f1b33b", "#3a9d8f", "#2d4f8c", "#e98aa5"];
  goods.forEach((c, i) => t.box(0.2 + (i % 2) * 0.06, 0.16 + (i % 3) * 0.05, 0.2, -0.36 + i * 0.18, yb + 0.1 + (i % 3) * 0.025, ((i * 37) % 5) * 0.08 - 0.16, c));
  const body = t.mesh();
  tg.add(body);
  // retro-reflective bands on the legs, at the height of M4's LiDAR
  const bands = new Kit();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bands.cyl(T.legR - 0.002, T.legR - 0.002, 0.16, sx * T.legX, 0.28, sz * T.legZ, "#f4f8fb", 12);
  tg.add(bands.mesh({ emissive: 0.75 }));
  // a fiducial tag on the handle side, for camera pose estimation
  const tagCv = document.createElement("canvas");
  tagCv.width = tagCv.height = 128;
  const tgk = tagCv.getContext("2d")!;
  tgk.fillStyle = "#fff";
  tgk.fillRect(0, 0, 128, 128);
  tgk.fillStyle = "#111";
  tgk.fillRect(8, 8, 112, 112);
  const bits = [0b011010, 0b100111, 0b110001, 0b001101, 0b101100, 0b010011];
  bits.forEach((row, y) => {
    for (let x = 0; x < 6; x++) if ((row >> x) & 1) tgk.fillRect(24 + x * 13.3, 24 + y * 13.3, 13.3, 13.3);
  });
  const tagTex = new THREE.CanvasTexture(tagCv);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const fid = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), clay({ map: tagTex, emissive: 0.3 }));
  fid.position.set(-L / 2 - 0.014, yb + 0.22, 0);
  fid.rotation.y = -Math.PI / 2;
  tg.add(fid);

  // trolley detection: a box that locks on when the robot is in the room
  const det = new Kit();
  const bw = L + 0.42;
  const bh = 1.28;
  const bd = D + 0.24;
  const e = 0.022;
  const cx = -0.08;
  for (const y of [0, bh]) {
    det.box(bw, e, e, cx, y + 0.01, -bd / 2, "#ffffff");
    det.box(bw, e, e, cx, y + 0.01, bd / 2, "#ffffff");
    det.box(e, e, bd, cx - bw / 2, y + 0.01, 0, "#ffffff");
    det.box(e, e, bd, cx + bw / 2, y + 0.01, 0, "#ffffff");
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) det.box(e, bh, e, cx + (sx * bw) / 2, bh / 2 + 0.01, (sz * bd) / 2, "#ffffff");
  const detMesh = det.mesh({ emissive: 0.6 });
  const detMat = detMesh.material as THREE.ShaderMaterial;
  detMat.transparent = true;
  detMat.depthWrite = false;
  detMat.uniforms.uOpacity.value = 0;
  detMat.uniforms.uColor.value.set(PAL.accent);
  tg.add(detMesh);
  // its tag, redrawn when the state changes
  const tagC = document.createElement("canvas");
  tagC.width = 320;
  tagC.height = 64;
  const tk = tagC.getContext("2d")!;
  const stateTex = new THREE.CanvasTexture(tagC);
  stateTex.colorSpace = THREE.SRGBColorSpace;
  const drawTag = (text: string, color: string) => {
    tk.clearRect(0, 0, 320, 64);
    tk.fillStyle = color;
    roundRect(tk, 0, 0, 320, 64, 12);
    tk.fill();
    tk.fillStyle = "#fff";
    tk.font = `700 32px ${SANS}`;
    tk.textBaseline = "middle";
    spaced(tk, text, 22, 34, 3);
    stateTex.needsUpdate = true;
  };
  drawTag("TROLLEY 0.97", PAL.accent);
  const tagMat = clay({ map: stateTex, emissive: 1, transparent: true, opacity: 0 });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.18), tagMat);
  tag.position.set(cx - bw / 2 + 0.45, bh + 0.15, bd / 2);
  tag.rotation.x = -0.6;
  tg.add(tag);

  // the checkout, painted on the floor where the trolley can be taken
  paintWord(ctx, "CHECKOUT", r.ink, ox, oz + 0.85, 26, 5);
  // the backroom, and the fleet that works it
  const br = backroom(ctx, r, 5);
  g.add(br.group);

  let state: TrolleyState = "idle";
  const STATES: Record<TrolleyState, [string, string]> = {
    idle: ["TROLLEY 0.97", PAL.accent],
    scanning: ["SCANNING", PAL.search],
    locked: ["LOCKED", PAL.search],
    lifted: ["LIFTED", "#2f8f5b"],
    hooked: ["HOOKED", "#2f8f5b"],
  };
  const trolley: Trolley = {
    group: tg,
    home: [tx, tz],
    checkout: [ox, oz],
    homeCell: [r.x + 6, r.y + 5],
    checkoutCell: [r.x + 9, r.y + 5],
    at: "home",
    mode: "free",
    pose: { x: 0, z: 0, yaw: 0 },
    setPose(x, z, yaw, lift = 0) {
      this.pose.x = x;
      this.pose.z = z;
      this.pose.yaw = yaw;
      tg.position.set(x, lift, z);
      tg.rotation.y = -yaw;
    },
    legs() {
      const { x, z, yaw } = this.pose;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      return [
        [T.legX, -T.legZ],
        [T.legX, T.legZ],
        [-T.legX, -T.legZ],
        [-T.legX, T.legZ],
      ].map(([lx, lz]) => [x + lx * c - lz * sn, z + lx * sn + lz * c] as [number, number]);
    },
    handle() {
      const { x, z, yaw } = this.pose;
      return new THREE.Vector3(x + Math.cos(yaw) * T.handleX, T.handleY + tg.position.y, z + Math.sin(yaw) * T.handleX);
    },
    status(st) {
      state = st;
      const [text, color] = STATES[st];
      drawTag(text, color);
      detMat.uniforms.uColor.value.set(color);
      ctx.kick();
    },
  };
  // left a little askew by whoever parked it: that's what the docking has to find out
  trolley.setPose(tx + 0.05, tz - 0.04, 0.09);
  const ix: Interactable[] = [
    {
      id: "trolley",
      room: 5,
      name: "Trolley",
      kind: "active",
      blurb: "Its legs carry retro-reflective tape. M4 finds them in its LiDAR, fits them with ICP, drives underneath and lifts. Or it estimates the pose with its camera, and lifts it or hooks the handle.",
      targets: [body],
      anchor: () => new THREE.Vector3(tg.position.x, 1.45, tg.position.z),
      highlight: glow([body]),
    },
    br.ix,
  ];

  let k = 0;
  const trolleyDet = detOf("trolley", "trolley");
  return {
    room: 5,
    group: g,
    ix,
    trolley,
    detect(out) {
      trolleyDet.box.setFromObject(body);
      out.push(trolleyDet);
      br.detect(out);
    },
    hud: () => br.hud(),
    update(now, dt, inside, near) {
      br.update(now, dt, near);
      const target = inside || state !== "idle" ? 1 : 0;
      k += (target - k) * Math.min(1, dt * (ctx.reduced ? 100 : 5));
      const flick = ctx.reduced || state !== "idle" ? 1 : 0.85 + 0.15 * Math.sin(now * 6);
      detMat.uniforms.uOpacity.value = k * flick;
      tagMat.uniforms.uOpacity.value = k;
      detMesh.visible = tag.visible = k > 0.01;
      // the backroom's fleet never stops
      return true;
    },
  };
}

/* ============================================================== 07 · Unchained Labs, agents at home */

function unchained(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  // a little graph: intent -> three agents -> a queue of build jobs
  const node = (rx: number, ry: number) => cellAt(r, rx, ry);
  const nodes = [node(3.1, 3.2), node(5.4, 2), node(5.4, 3.2), node(5.4, 4.4), node(7.8, 3.2)];
  const edges: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4]];
  const kit = new Kit();
  const ncol = ["#2c5687", "#4b8fd6", "#4b8fd6", "#4b8fd6", "#2c5687"];
  nodes.forEach(([x, z], i) => {
    kit.cyl(0.32, 0.34, 0.12, x, 0.06, z, ncol[i], 28);
    kit.cyl(0.24, 0.24, 0.02, x, 0.13, z, "#eaf2fb", 28);
  });
  // the queue: build jobs stacked by the last node
  const [qx, qz] = node(7.8, 4.7);
  for (let i = 0; i < 4; i++) kit.box(0.42, 0.14, 0.3, qx, 0.07 + i * 0.15, qz, i % 2 ? "#f1b33b" : "#f4ecd8");
  // remote, from Abu Dhabi: a desk on the sand by the sea, under a parasol, between two palms
  const [dx, dz] = cellAt(r, 1.5, 6);
  kit.box(1.5, 0.05, 0.62, dx, 0.62, dz, "#c9a36a");
  for (const sx of [-0.68, 0.68]) for (const sz of [-0.24, 0.24]) kit.box(0.04, 0.6, 0.04, dx + sx, 0.3, dz + sz, "#9a7552");
  kit.box(0.5, 0.025, 0.34, dx - 0.2, 0.66, dz + 0.04, "#3c3e45");
  const lid = new THREE.BoxGeometry(0.5, 0.32, 0.02);
  lid.rotateX(0.25);
  lid.translate(dx - 0.2, 0.83, dz - 0.14);
  kit.add(lid, "#3c3e45");
  kit.box(0.44, 0.26, 0.005, dx - 0.2, 0.83, dz - 0.125, "#4b8fd6");
  kit.cyl(0.05, 0.04, 0.12, dx + 0.4, 0.7, dz, "#fffaf1", 10);
  kit.box(0.42, 0.42, 0.04, dx + 0.1, 0.25, dz + 0.65, "#e4572e");
  kit.box(0.42, 0.04, 0.42, dx + 0.1, 0.45, dz + 0.45, "#e4572e");
  parasol(kit, ...cellAt(r, 3.3, 6.1), "#2c5687", 1.7);
  palm(kit, ...cellAt(r, 0, 0), 2.4, 0.18, 0.4);
  palm(kit, ...cellAt(r, 10, 0), 2.2, 0.14, 2.2);
  shrub(kit, ...cellAt(r, 9.6, 6.6), 0.9);
  g.add(kit.mesh());
  ctx.atlas.queue(
    760,
    470,
    (k) => {
      const s = 760 / 6.6;
      k.strokeStyle = "#2c5687";
      k.globalAlpha = 0.5;
      k.lineWidth = 6;
      k.setLineDash([2, 14]);
      k.lineCap = "round";
      const toPx = ([x, z]: [number, number]) => [(x - nodes[0][0] + 0.6) * s, (z - nodes[1][1] + 0.5) * s] as const;
      for (const [a, b] of edges) {
        const [ax, az] = toPx(nodes[a]);
        const [bx, bz] = toPx(nodes[b]);
        k.beginPath();
        k.moveTo(ax, az);
        k.lineTo(bx, bz);
        k.stroke();
      }
    },
    (uv) => {
      const x0 = nodes[0][0] - 0.6;
      const z0 = nodes[1][1] - 0.5;
      ctx.decals.push(quad(x0 + 3.3, 0.004, z0 + 2.05, 6.6, 4.1, uv));
    },
  );
  paintWord(ctx, "INTENT", r.ink, nodes[0][0], nodes[0][1] + 0.55, 24, 4);
  paintWord(ctx, "AGENTS", r.ink, nodes[3][0], nodes[3][1] + 0.55, 24, 4);
  paintWord(ctx, "JOBS", r.ink, qx, qz + 0.45, 24, 4);

  // pulses running along the edges
  const P = edges.length;
  const pulses = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), clay({ color: "#f1b33b", emissive: 0.7 }), P);
  g.add(pulses);
  const mt = new THREE.Matrix4();
  const place = (now: number) => {
    edges.forEach(([a, b], i) => {
      const t = (now * 0.55 + (i < 3 ? 0 : 0.5) + i * 0.13) % 1;
      const [ax, az] = nodes[a];
      const [bx, bz] = nodes[b];
      mt.makeTranslation(ax + (bx - ax) * t, 0.2 + Math.sin(t * Math.PI) * 0.1, az + (bz - az) * t);
      pulses.setMatrixAt(i, mt);
    });
    pulses.instanceMatrix.needsUpdate = true;
  };
  place(0.3);
  return {
    room: 7,
    group: g,
    update(now) {
      if (ctx.reduced) return false;
      place(now);
      return true;
    },
  };
}

/* ============================================================== 08 · SIRB.AI, the flock */

function sirb(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const N = 30;
  const k = new Kit();
  k.box(0.1, 0.05, 0.1, 0, 0, 0, "#ffffff");
  for (const a of [Math.PI / 4, -Math.PI / 4]) k.box(0.34, 0.018, 0.03, 0, 0, 0, "#ffffff", a);
  for (const [x, z] of [[0.12, 0.12], [0.12, -0.12], [-0.12, 0.12], [-0.12, -0.12]]) k.cyl(0.075, 0.075, 0.01, x, 0.025, z, "#cfd3d8", 14);
  const droneGeo = mergeGeometries(k.parts);
  droneGeo.scale(1.35, 1.35, 1.35);
  const drones = new THREE.InstancedMesh(droneGeo, clay({ vertexColors: true }), N);
  const white = new THREE.Color("#f7f3ea");
  const red = new THREE.Color(PAL.accent);
  const amber = new THREE.Color("#f0a43a");
  const grey = new THREE.Color("#8d8780");
  for (let i = 0; i < N; i++) drones.setColorAt(i, white);
  g.add(drones);
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.6 }),
    N,
  );
  shadows.renderOrder = 1;
  g.add(shadows);
  const [cx, cz] = [gx(r.x + r.w / 2), gz(r.y + r.h / 2 - 0.6)];
  const mt = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let fault = -1;
  let faultAt = 0;
  let clock = 0;
  const col = new THREE.Color();

  // the radio network: who hears whom, the groups, λ₂
  const net = new SwarmNet(N);
  const MAXL = (N * (N - 1)) / 2;
  const linkPos = new Float32Array(MAXL * 6);
  const linkCol = new Float32Array(MAXL * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
  linkGeo.setAttribute("color", new THREE.BufferAttribute(linkCol, 3));
  linkGeo.setDrawRange(0, 0);
  const links = new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false }));
  links.frustumCulled = false;
  links.renderOrder = 3;
  g.add(links);
  const cGood = new THREE.Color(PAL.search);
  const cWeak = new THREE.Color("#c9d6f5");
  const cJam = new THREE.Color(PAL.accent);
  // the jammer's bubble
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(1, 28, 16),
    new THREE.MeshBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.1, depthWrite: false }),
  );
  bubble.visible = false;
  g.add(bubble);

  // each drone flies itself: an acceleration toward its slot, damping, and separation from its
  // neighbours. The slot is on a slow circle over the room, or, when M4 is in the room, around M4.
  // Slots go by rank among the drones still flying, so the formation closes up after a failure.
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const acc = new Float32Array(N * 3);
  const rank = new Int16Array(N);
  let flying = N;
  let lead = 0;
  const circle = (i: number, now: number, out: number[]) => {
    const ph = (rank[i] / flying) * Math.PI * 2;
    const lane = i % 3;
    const th = now * (0.42 + lane * 0.05) + ph;
    const rad = (2.1 + lane * 0.55 + 0.35 * Math.sin(now * 0.6 + i * 1.3)) * net.spread;
    out[0] = cx + Math.cos(th) * rad;
    out[1] = 1.55 + lane * 0.28 + 0.16 * Math.sin(now * 1.1 + i * 2.1);
    out[2] = cz + Math.sin(th) * rad * 0.82;
  };
  const around = (i: number, now: number, out: number[]) => {
    // an escort: a loose ring around a point just ahead of the robot, near its camera's height,
    // so you see them from the robot's own view too
    const ph = (rank[i] / flying) * Math.PI * 2 + now * 0.55;
    const lane = i % 3;
    const rad = (0.95 + lane * 0.45) * net.spread;
    // a ring squashed along the heading, so the nearest drone stays a body length ahead
    const ahead = 2.2;
    const h = ctx.robot.heading;
    const f = ahead + Math.cos(ph) * rad * 0.55;
    const l = Math.sin(ph) * rad;
    out[0] = ctx.robot.x + Math.cos(h) * f - Math.sin(h) * l;
    out[1] = (ctx.robot.flying ? ctx.robot.alt - 0.1 : 0.55) + lane * 0.26 + 0.12 * Math.sin(now * 1.3 + i);
    out[2] = ctx.robot.z + Math.sin(h) * f + Math.cos(h) * l;
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    rank[i] = i;
    circle(i, 0, a);
    pos.set(a, i * 3);
  }
  const step = (now: number, dt: number) => {
    flying = 0;
    for (let i = 0; i < N; i++) if (net.alive[i]) rank[i] = flying++;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      if (!net.alive[i]) {
        // failed: it falls, and lies where it lands
        acc[o] = -4 * vel[o];
        acc[o + 2] = -4 * vel[o + 2];
        acc[o + 1] = pos[o + 1] > 0.06 ? -9 : 0;
        if (pos[o + 1] <= 0.06) {
          pos[o + 1] = 0.06;
          vel[o + 1] = 0;
        }
        continue;
      }
      circle(i, now, a);
      if (lead > 0.001) {
        around(i, now, b);
        for (let k = 0; k < 3; k++) a[k] += (b[k] - a[k]) * lead;
      }
      if (net.lost[i]) {
        // cut off: head back toward the nearest drone still in the main group
        let bd = Infinity;
        let bj = -1;
        for (let j = 0; j < N; j++) {
          if (j === i || !net.alive[j] || net.lost[j] || net.radioDown[j]) continue;
          const d = (pos[j * 3] - pos[o]) ** 2 + (pos[j * 3 + 2] - pos[o + 2]) ** 2;
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        if (bj >= 0) {
          const d = Math.sqrt(bd) || 1;
          a[0] = pos[bj * 3] + ((pos[o] - pos[bj * 3]) / d) * 0.5;
          a[1] = pos[bj * 3 + 1];
          a[2] = pos[bj * 3 + 2] + ((pos[o + 2] - pos[bj * 3 + 2]) / d) * 0.5;
        }
      }
      for (let k = 0; k < 3; k++) acc[o + k] = 16 * (a[k] - pos[o + k]) - 6.5 * vel[o + k];
    }
    // keep a little distance from each other (and from the robot)
    for (let i = 0; i < N; i++) {
      if (!net.alive[i]) continue;
      for (let j = i + 1; j < N; j++) {
        if (!net.alive[j]) continue;
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 0.3 || d2 < 1e-6) continue;
        const f = (0.3 - d2) * 40;
        acc[i * 3] += dx * f;
        acc[i * 3 + 1] += dy * f;
        acc[i * 3 + 2] += dz * f;
        acc[j * 3] -= dx * f;
        acc[j * 3 + 1] -= dy * f;
        acc[j * 3 + 2] -= dz * f;
      }
    }
    const ry = ctx.robot.flying ? ctx.robot.alt + 0.25 : 0.55;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const dx = pos[o] - ctx.robot.x;
      const dz = pos[o + 2] - ctx.robot.z;
      const dy = pos[o + 1] - ry;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (net.alive[i] && d2 < 0.8 && lead > 0.01) {
        const f = (0.8 - d2) * 30;
        acc[o] += dx * f;
        acc[o + 1] += Math.abs(dy) * f * 0.5;
        acc[o + 2] += dz * f;
      }
      for (let k = 0; k < 3; k++) {
        vel[o + k] += acc[o + k] * dt;
        pos[o + k] += vel[o + k] * dt;
      }
    }
  };

  const place = (now: number) => {
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      let y = pos[o + 1];
      let c = net.alive[i] ? (net.lost[i] ? amber : white) : grey;
      if (i === fault && net.alive[i]) {
        const t = now - faultAt;
        const dip = t < 0.7 ? t / 0.7 : Math.max(0, 1 - (t - 0.7) / 1.4);
        y -= dip * 0.75;
        c = col.copy(white).lerp(red, Math.min(1, dip * 1.6));
      }
      drones.setColorAt(i, c);
      p.set(pos[o], y, pos[o + 2]);
      // face where it flies, bank into its acceleration; a fallen one lies tilted
      const yaw = Math.atan2(vel[o + 2], vel[o]);
      if (net.alive[i]) e.set(THREE.MathUtils.clamp(acc[o + 2] * 0.01, -0.4, 0.4), -yaw, THREE.MathUtils.clamp(-acc[o] * 0.01, -0.4, 0.4));
      else e.set(0.35, i, 0.2);
      q.setFromEuler(e);
      mt.compose(p, q, one);
      drones.setMatrixAt(i, mt);
      mt.makeTranslation(p.x + 0.35 * Math.min(1, y), 0.005, p.z + 0.3 * Math.min(1, y));
      shadows.setMatrixAt(i, mt);
    }
    drones.instanceMatrix.needsUpdate = true;
    drones.computeBoundingSphere();
    shadows.instanceMatrix.needsUpdate = true;
    if (drones.instanceColor) drones.instanceColor.needsUpdate = true;
    // the radio links: blue when strong, pale at the edge of range, red where the jammer cuts them
    for (let k = 0; k < net.pairs; k++) {
      const i = net.pairA[k];
      const j = net.pairB[k];
      linkPos.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], k * 6);
      const qk = net.pairQ[k];
      if (qk < 0) col.copy(cJam);
      else col.copy(cWeak).lerp(cGood, Math.min(1, qk * 1.6));
      linkCol.set([col.r, col.g, col.b, col.r, col.g, col.b], k * 6);
    }
    linkGeo.setDrawRange(0, net.pairs * 2);
    linkGeo.attributes.position.needsUpdate = true;
    linkGeo.attributes.color.needsUpdate = true;
    const jam = net.jam;
    bubble.visible = !!jam;
    if (jam) {
      bubble.position.set(jam.x, jam.y, jam.z);
      bubble.scale.setScalar(jam.r * (1 + 0.04 * Math.sin(now * 9)));
    }
  };
  place(0);

  const centroid = () => {
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (!net.alive[i]) continue;
      x += pos[i * 3];
      y += pos[i * 3 + 1];
      z += pos[i * 3 + 2];
      n++;
    }
    n = Math.max(1, n);
    return new THREE.Vector3(x / n, y / n, z / n);
  };
  // the self-healing layer: an agent reads the swarm's telemetry, says what it sees, works out why, and acts
  type Entry = { t: number; kind: "!" | "?" | ">" | "ok"; text: string };
  const agentLog: Entry[] = [];
  const agentSay = (kind: Entry["kind"], text: string) => {
    agentLog.push({ t: clock, kind, text });
    if (agentLog.length > 9) agentLog.shift();
  };
  let healing: { since: number; what: "mesh" | "fail" | "range" | "revive" } | null = null;
  let jamNoted = false;
  let dropout = -1;
  const uav = (i: number) => `UAV-${String(i + 1).padStart(2, "0")}`;
  const screen = wallScreen(5.4, 2.1, 1400, 544, 0.24);
  screen.stand(gx(r.x + 5.5), 0.15, gz(r.y) + 0.75);
  g.add(screen.group);
  // سرب: a flock. The lagoon has its own, flamingos, and mangroves along its edge
  const lagoon = new Kit();
  mangrove(lagoon, ...cellAt(r, 0.1, 7.2), 1, 0.3);
  mangrove(lagoon, ...cellAt(r, 4.3, 10.2), 0.9, 1.7);
  mangrove(lagoon, ...cellAt(r, 0.2, 10.3), 0.8, 2.9);
  g.add(lagoon.mesh());
  const FL = 9;
  const flamingos = new THREE.InstancedMesh(flamingoGeometry(), clay({ vertexColors: true }), FL);
  const flRand = rng(2026);
  const flock = Array.from({ length: FL }, () => ({
    x: cellAt(r, 0.9 + flRand() * 3.3, 7.6 + flRand() * 2.6)[0],
    z: cellAt(r, 0.9 + flRand() * 3.3, 7.6 + flRand() * 2.6)[1],
    yaw: flRand() * Math.PI * 2,
    ph: flRand() * 6,
  }));
  const flM = new THREE.Matrix4();
  const flQ = new THREE.Quaternion();
  const flS = new THREE.Vector3(1.15, 1.15, 1.15);
  const flUp = new THREE.Vector3(0, 1, 0);
  const placeFlamingos = (now: number) => {
    flock.forEach((f, i) => {
      flQ.setFromAxisAngle(flUp, f.yaw + 0.15 * Math.sin(now * 0.4 + f.ph));
      flM.compose(new THREE.Vector3(f.x, -0.02 + 0.01 * Math.sin(now * 1.7 + f.ph), f.z), flQ, flS);
      flamingos.setMatrixAt(i, flM);
    });
    flamingos.instanceMatrix.needsUpdate = true;
  };
  placeFlamingos(0);
  g.add(flamingos);
  const birdDets = flock.map((_, i) => detOf(`flamingo-${i}`, "bird", "flamingo"));
  const readiness = () =>
    THREE.MathUtils.clamp(0.45 * (net.count / N) + 0.35 * Math.min(1, net.lambda2 / 1.5) + 0.2 * (net.groups === 1 ? 1 : 0) - (net.jam ? 0.1 : 0), 0, 1);
  const drawConsole = () => {
    const k = screen.k;
    k.fillStyle = "#15171b";
    k.fillRect(0, 0, screen.cw, screen.ch);
    k.fillStyle = "#f2d27a";
    k.font = `700 30px ${SANS}`;
    k.fillText("SELF-HEALING AGENT", 32, 52);
    const rd = readiness();
    const go = rd >= 0.75;
    k.textAlign = "right";
    k.fillStyle = go ? "#7fd18a" : "#ff8a65";
    k.font = `700 30px ${SANS}`;
    k.fillText(`MISSION READINESS ${rd.toFixed(2)} · ${go ? "GO" : "HOLD"}`, screen.cw - 32, 52);
    k.textAlign = "left";
    const tags: Record<Entry["kind"], [string, string]> = {
      "!": ["▲", "#ff6b5a"],
      "?": ["⋯", "#f0b04a"],
      ">": ["→", "#7aa7ff"],
      ok: ["✓", "#7fd18a"],
    };
    agentLog.forEach((e, i) => {
      const y = 108 + i * 48;
      k.font = `500 23px ui-monospace, Menlo, monospace`;
      k.fillStyle = "#6c7884";
      const s0 = Math.floor(e.t);
      k.fillText(`${String(Math.floor(s0 / 60) % 60).padStart(2, "0")}:${String(s0 % 60).padStart(2, "0")}`, 32, y);
      k.fillStyle = tags[e.kind][1];
      k.font = `700 26px ${SANS}`;
      k.fillText(tags[e.kind][0], 130, y);
      k.fillStyle = i === agentLog.length - 1 ? "#f3f5f7" : "#c6ccd3";
      k.font = `${e.kind === "!" ? 650 : 500} 25px ${SANS}`;
      k.fillText(e.text, 170, y);
    });
    screen.flush();
  };
  agentSay(">", "watching 30 drones: heartbeats, links, motors, batteries");
  let drawAt = -1;

  const ix: Interactable[] = [
    {
      id: "flock",
      room: 8,
      name: "Swarm",
      kind: "passive",
      blurb: "Thirty drones on a mesh radio: each only hears its neighbours. Come in and they flock with you. Jam them, fail one, or cut the range, and watch the network heal.",
      targets: [drones],
      anchor: () => centroid().add(new THREE.Vector3(0, 0.5, 0)),
      highlight: glow([drones]),
      actions: () => [
        { id: "jam", label: "Jam the radio", primary: true },
        { id: "fail", label: "Fail a drone" },
        { id: "range", label: net.target === SHORT ? "Full radio range" : "Short radio range" },
        ...(net.count < N ? [{ id: "revive", label: "Bring them back" }] : []),
      ],
      run: (action) => {
        if (action === "jam") {
          // a jammer off to one side of the flock, for eight seconds: it cuts off part of it
          const c = centroid();
          let fx = c.x;
          let fz = c.z;
          for (let i = 0; i < N; i++) {
            if (!net.alive[i]) continue;
            const d = Math.hypot(pos[i * 3] - c.x, pos[i * 3 + 2] - c.z);
            if (d > Math.hypot(fx - c.x, fz - c.z)) [fx, fz] = [pos[i * 3], pos[i * 3 + 2]];
          }
          net.jam = { x: c.x + (fx - c.x) * 0.75, y: c.y, z: c.z + (fz - c.z) * 0.75, r: 1.0, until: clock + 8 };
          jamNoted = false;
        } else if (action === "fail") {
          const h = net.hub();
          if (h >= 0) {
            net.alive[h] = 0;
            agentSay("!", `${uav(h)} losing altitude, motor 3 current spike`);
            agentSay("?", "a motor failure, not the link: it was the best-connected drone");
            agentSay(">", "clear its landing zone, give its slot to the others, flag it for inspection");
            healing = { since: clock, what: "fail" };
          }
        } else if (action === "range") {
          net.target = net.target === SHORT ? RANGE : SHORT;
          if (net.target === SHORT) {
            agentSay("!", "link margins down across the swarm");
            agentSay("?", "the radio range has dropped: interference, or terrain");
            agentSay(">", "tighten the formation so neighbours stay in reach");
          } else agentSay(">", "range back: open the formation up again");
          healing = { since: clock, what: "range" };
        } else if (action === "revive") {
          agentSay(">", `operator: ${N - net.count} drones back in service, re-slotting them`);
          net.alive.fill(1);
          healing = { since: clock, what: "revive" };
        }
        ctx.kick();
      },
    },
  ];
  const droneDets = Array.from({ length: N }, (_, i) => detOf(`drone-${i}`, "drone"));
  return {
    room: 8,
    group: g,
    ix,
    detect(out) {
      instanceBoxes(drones, droneDets, 0.04);
      out.push(...droneDets);
      instanceBoxes(flamingos, birdDets, 0.02);
      out.push(...birdDets);
    },
    hud() {
      const lost = net.lost.reduce((s, v) => s + v, 0);
      const lines = [
        `${net.count} of ${N} flying · ${net.links} links${net.jammedLinks ? ` · ${net.jammedLinks} jammed` : ""}`,
        `${net.groups} ${net.groups === 1 ? "group" : "groups"} · λ₂ ${net.lambda2.toFixed(2)}${net.groups > 1 ? " (split)" : ""}`,
      ];
      if (lost) lines.push(`${lost} cut off, flying back to the group`);
      if (net.jam) lines.push(`jammed for ${Math.max(0, net.jam.until - clock).toFixed(0)} s`);
      if (net.target === SHORT) lines.push(`short range ${net.range.toFixed(2)}: formation at ${Math.round(net.spread * 100)}%`);
      const ok = net.groups === 1 && !lost;
      return { at: centroid().add(new THREE.Vector3(0, 1.1, 0)), title: "Swarm network", lines, color: ok ? "#2f8f5b" : "#e8850f" };
    },
    update(now, dt, inside, near) {
      placeFlamingos(now);
      clock = now;
      if (ctx.reduced) {
        net.update(pos, now, dt);
        place(now);
        if (near && now - drawAt > 0.5) {
          drawAt = now;
          drawConsole();
        }
        return false;
      }
      lead += ((inside ? 1 : 0) - lead) * Math.min(1, dt * 1.6);
      // now and then one drone's radio drops out: it dips, the agent notices and the layer recovers it
      if (now - faultAt > 9) {
        if (fault >= 0) net.radioDown[fault] = 0;
        fault = Math.floor((now * 7.3) % N);
        faultAt = now;
        if (net.alive[fault]) {
          dropout = fault;
          agentSay("!", `${uav(fault)} heartbeat lost`);
          agentSay("?", "IMU and motors nominal: a radio dropout");
          agentSay(">", "hold its position, retry the link");
        }
      }
      net.radioDown[fault] = net.alive[fault] && now - faultAt < 1.6 ? 1 : 0;
      if (dropout >= 0 && !net.radioDown[dropout]) {
        agentSay("ok", `${uav(dropout)} back on the mesh in 1.6 s`);
        dropout = -1;
      }
      net.update(pos, now, dt);
      // the agent's reading of the network
      if (net.jam && !jamNoted) {
        const lost = net.lost.reduce((s, v) => s + v, 0);
        if (lost > 0) {
          jamNoted = true;
          agentSay("!", `${lost} drones lost the mesh at once, all in one place`);
          agentSay("?", "wideband noise on the link: jamming");
          agentSay(">", "send the cut-off drones back toward the group; request a channel hop");
          healing = { since: now, what: "mesh" };
        }
      }
      if (healing && now - healing.since > 1.2) {
        const lost = net.lost.reduce((s, v) => s + v, 0);
        const settled = Math.abs(net.range - net.target) < 0.02;
        const took = (now - healing.since).toFixed(1);
        if (healing.what === "mesh" && net.groups === 1 && !lost) {
          agentSay("ok", `mesh whole again in ${took} s, λ₂ ${net.lambda2.toFixed(2)}`);
          healing = null;
        } else if (healing.what === "fail" && net.groups === 1) {
          agentSay("ok", `formation closed up: ${net.count} flying, one group`);
          healing = null;
        } else if (healing.what === "range" && settled) {
          agentSay("ok", `formation at ${Math.round(net.spread * 100)}%, ${net.groups === 1 ? "still one group" : `${net.groups} groups`}`);
          healing = null;
        } else if (healing.what === "revive" && now - healing.since > 2.5) {
          agentSay("ok", `all ${N} flying, λ₂ ${net.lambda2.toFixed(2)}`);
          healing = null;
        }
      }
      if (near && now - drawAt > 0.33) {
        drawAt = now;
        drawConsole();
      }
      // small fixed steps keep the flock stable on a slow frame
      let left = Math.min(dt, 0.1);
      while (left > 1e-4) {
        const h = Math.min(left, 1 / 60);
        step(now, h);
        left -= h;
      }
      place(now);
      return true;
    },
  };
}

/* ============================================================== 09 · Projects, clips on screens */

function projects(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const sw = 2.5;
  const sh = sw * (9 / 16);
  const cap = 0.39;
  // slot layout in the poster atlas: 4 x 2 frames of 512 x (288 + 60)
  const AW = 2048;
  const SWp = 512;
  const SHp = 368;
  const atlas = document.createElement("canvas");
  atlas.width = AW;
  atlas.height = 1024;
  const ak = atlas.getContext("2d")!;
  const slot = (i: number) => [(i % 4) * SWp, Math.floor(i / 4) * SHp] as const;
  PROJECTS.forEach((p, i) => {
    const [x, y] = slot(i);
    ak.fillStyle = "#24222b";
    ak.fillRect(x, y, SWp, 288);
    ak.fillStyle = "#3a3742";
    ak.fillRect(x, y + 288, SWp, 80);
    ak.fillStyle = "#fffaf1";
    ak.font = `650 44px ${SANS}`;
    ak.textBaseline = "middle";
    ak.fillText(p.title, x + 22, y + 288 + 42);
  });
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  type Screen = { x: number; y: number; z: number; lean: number; key: string; front: [number, number] };
  const screens: Screen[] = [];
  const frames = new Kit();
  const faces: THREE.BufferGeometry[] = [];
  const place = (i: number, x: number, z: number, y0: number, lean: number, stand: boolean) => {
    const H2 = sh + cap;
    const yc = y0 + (H2 / 2) * Math.cos(lean);
    const zc = z - (H2 / 2) * Math.sin(lean);
    const fr = new THREE.BoxGeometry(sw + 0.12, H2 + 0.12, 0.06);
    fr.rotateX(-lean);
    fr.translate(x, yc - 0.06 * Math.sin(lean), zc - 0.06 * Math.cos(lean));
    frames.add(fr, "#2b2930");
    if (stand) {
      frames.box(0.08, y0 + 0.3, 0.08, x, (y0 + 0.3) / 2, zc - 0.1, "#2b2930");
      frames.box(1.2, 0.05, 0.5, x, 0.025, zc - 0.1, "#2b2930");
    }
    const [sx, sy] = slot(i);
    const u0 = sx / AW;
    const u1 = (sx + SWp) / AW;
    const v1 = 1 - sy / 1024;
    const v0 = 1 - (sy + SHp) / 1024;
    const f = quad(0, 0, 0, sw, H2, [u0, v0, u1, v1], 0, 0);
    f.rotateX(-lean);
    f.translate(x, yc, zc);
    faces.push(f);
    screens.push({ x, y: yc + (cap / 2) * Math.cos(lean), z: zc - (cap / 2) * Math.sin(lean) + 0.006, lean, key: PROJECTS[i].key, front: [x, zc + 1.3] });
  };
  // four leaning on the north wall, four on stands in the middle
  for (let i = 0; i < 4; i++) place(i, gx(r.x + 0.4 + 1.55 + i * 3.15), gz(r.y) + 0.62, 0.12, 0.38, false);
  for (let i = 0; i < 4; i++) place(i + 4, gx(r.x + 2 + i * 3), gz(r.y + 4.5) + 0.12, 0.3, 0.2, true);
  g.add(frames.mesh());
  // an open-air courtyard: lanterns strung across, a palm in the corner
  const court = new Kit();
  for (const row of [2, 6]) lanterns(court, ...cellAt(r, 0, row), ...cellAt(r, 12, row), 11, 2.1);
  palm(court, ...cellAt(r, 0, 8), 2.2, 0.12, 0.7);
  g.add(court.mesh());
  const faceMesh = new THREE.Mesh(mergeGeometries(faces), clay({ map: tex, emissive: 0.55 }));
  g.add(faceMesh);

  // one clip plays at a time, on the screen the robot is standing at
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.crossOrigin = "anonymous";
  const vtex = new THREE.VideoTexture(video);
  vtex.colorSpace = THREE.SRGBColorSpace;
  const vmat = clay({ map: vtex, emissive: 0.55 });
  const vplane = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), vmat);
  vplane.visible = false;
  g.add(vplane);
  let current = -1;
  let loaded = false;

  const pick = {
    object: faceMesh,
    hit: (face: number) => {
      const i = Math.floor(face / 2);
      ctx.emit("project", PROJECTS[i]?.key ?? null);
    },
  };

  const screenDets = screens.map((sc, i) => {
    const d = detOf(`screen-${i}`, "monitor");
    d.box.set(new THREE.Vector3(sc.x - sw / 2, sc.y - sh / 2, sc.z - 0.15), new THREE.Vector3(sc.x + sw / 2, sc.y + sh / 2, sc.z + 0.15));
    return d;
  });
  return {
    room: 9,
    group: g,
    pick: [pick],
    detect(out) {
      out.push(...screenDets);
    },
    approach() {
      if (loaded) return;
      loaded = true;
      PROJECTS.forEach((p, i) => {
        const img = new Image();
        img.decoding = "async";
        img.src = `/work/${p.key}.webp`;
        img.onload = () => {
          const [x, y] = slot(i);
          // cover-fit into 16:9
          const ar = img.width / img.height;
          const tw = 512;
          const th = 288;
          let sx = 0;
          let sy = 0;
          let sw2 = img.width;
          let sh2 = img.height;
          if (ar > tw / th) {
            sw2 = img.height * (tw / th);
            sx = (img.width - sw2) / 2;
          } else {
            sh2 = img.width / (tw / th);
            sy = (img.height - sh2) / 2;
          }
          ak.drawImage(img, sx, sy, sw2, sh2, x, y, tw, th);
          tex.needsUpdate = true;
          ctx.kick();
        };
      });
    },
    sleep() {
      video.pause();
      vplane.visible = false;
      current = -1;
    },
    update(_now, _dt, inside) {
      let best = -1;
      if (inside && !ctx.reduced) {
        let bd = 2.4 * 2.4;
        screens.forEach((s, i) => {
          const d = (ctx.robot.x - s.front[0]) ** 2 + (ctx.robot.z - s.front[1]) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
      }
      if (best !== current) {
        current = best;
        if (best < 0) {
          video.pause();
          vplane.visible = false;
          ctx.emit("project", null);
        } else {
          const s = screens[best];
          const p = PROJECTS[best];
          video.src = `/work/${p.key}.mp4`;
          video.play().catch(() => {});
          // crop non-16:9 clips to fill the screen
          const ar = p.w / p.h;
          const want = 16 / 9;
          vtex.repeat.set(1, 1);
          vtex.offset.set(0, 0);
          if (ar < want) {
            vtex.repeat.y = ar / want;
            vtex.offset.y = (1 - vtex.repeat.y) / 2;
          }
          vplane.position.set(s.x, s.y, s.z + 0.004);
          vplane.rotation.x = -s.lean;
          vplane.visible = true;
          ctx.emit("project", p.key);
        }
      }
      return current >= 0;
    },
  };
}

/* ============================================================== 10 · Photos, prints on the floor */

function photos(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const cv = document.createElement("canvas");
  cv.width = cv.height = 2048;
  const k = cv.getContext("2d")!;
  const S = 512;
  const rand = rng(2023);
  const geos: THREE.BufferGeometry[] = [];
  const frames: { x: number; y: number; w: number; h: number }[] = [];
  const cols = [1.2, 3.4, 5.6, 7.8];
  const rows = [1.35, 3.65, 5.95];
  PHOTOS.forEach((p, i) => {
    const portrait = p.h > p.w;
    const ar = p.w / p.h;
    // the print: white border, photo inside, all within a 512 slot
    const pw = portrait ? 300 : 470;
    const ph = Math.round((pw - 28) / ar) + 28 + (portrait ? 0 : 0);
    const sx = (i % 4) * S + (S - pw) / 2;
    const sy = Math.floor(i / 4) * S + (S - ph) / 2;
    k.fillStyle = "#fffdf7";
    k.fillRect(sx, sy, pw, ph);
    k.fillStyle = "#e3ddd2";
    k.fillRect(sx + 14, sy + 14, pw - 28, ph - 28);
    frames.push({ x: sx + 14, y: sy + 14, w: pw - 28, h: ph - 28 });
    const uv: [number, number, number, number] = [sx / 2048, 1 - (sy + ph) / 2048, (sx + pw) / 2048, 1 - sy / 2048];
    const wW = (pw / 470) * 1.95;
    const wH = (ph / 470) * 1.95;
    const [x, z] = cellAt(r, cols[i % 4] - 0.5, rows[Math.floor(i / 4)] - 0.5);
    geos.push(quad(x, 0.006 + i * 0.0006, z, wW, wH, uv, (rand() - 0.5) * 0.36));
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const prints = new THREE.Mesh(mergeGeometries(geos), clay({ map: tex, emissive: 0.12 }));
  prints.renderOrder = 1;
  g.add(prints);
  // the photos are laid out on the sand, by the sea
  const beach = new Kit();
  palm(beach, ...cellAt(r, 0, 8), 2.2, 0.2, 1.1);
  parasol(beach, ...cellAt(r, 2, 8), "#93364c", 1.4);
  g.add(beach.mesh());
  let loaded = false;
  return {
    room: 10,
    group: g,
    pick: [{ object: prints, hit: (face) => ctx.emit("photo", Math.floor(face / 2)) }],
    approach() {
      if (loaded) return;
      loaded = true;
      PHOTOS.forEach((p, i) => {
        const img = new Image();
        img.decoding = "async";
        img.src = `/photos/${p.file}-800.webp`;
        img.onload = () => {
          const f = frames[i];
          k.drawImage(img, f.x, f.y, f.w, f.h);
          tex.needsUpdate = true;
          ctx.kick();
        };
      });
    },
  };
}

/* ============================================================== 11 · the exit */

function exit(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  // the way out leaves through the frame on whichever side it's nearer: finish line, and an arrow to it
  const west = r.x + r.w / 2 < W / 2;
  ctx.atlas.queue(
    96,
    192,
    (k) => {
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 4; x++) {
          k.fillStyle = (x + y) % 2 ? "#2b2118" : "#fffaf1";
          k.fillRect(x * 24, y * 24, 24, 24);
        }
    },
    (uv) => {
      const gxw = gx(west ? r.x - 0.5 : r.x + r.w + 0.5);
      const gzw = gz(r.y + 4.5);
      ctx.decals.push(quad(gxw, 0.004, gzw, 0.5, 1.0, uv));
    },
  );
  ctx.atlas.queue(
    260,
    120,
    (k) => {
      k.fillStyle = r.ink;
      k.globalAlpha = 0.7;
      if (west) {
        k.translate(260, 0);
        k.scale(-1, 1);
      }
      k.beginPath();
      k.moveTo(10, 44);
      k.lineTo(170, 44);
      k.lineTo(170, 12);
      k.lineTo(250, 60);
      k.lineTo(170, 108);
      k.lineTo(170, 76);
      k.lineTo(10, 76);
      k.closePath();
      k.fill();
    },
    (uv) => {
      const [x, z] = cellAt(r, west ? 1.4 : 2.6, 4);
      ctx.decals.push(quad(x, 0.004, z, 1.9, 0.88, uv));
    },
  );
  const oasis = new Kit();
  palm(oasis, ...cellAt(r, 0, 0), 2.3, 0.15, 0.2);
  palm(oasis, ...cellAt(r, 0, 8), 2.1, 0.12, 1.9);
  shrub(oasis, ...cellAt(r, 4.2, 7.0), 0.8);
  g.add(oasis.mesh());
  // a mailbox, because the exit is where you write to him
  const [mx, mz] = cellAt(r, 3, 1);
  const kit = new Kit();
  kit.box(0.08, 0.62, 0.08, 0, 0.31, 0, "#6b4a2b");
  kit.box(0.5, 0.3, 0.32, 0, 0.74, 0, "#2f6b45");
  const lid = new THREE.CylinderGeometry(0.16, 0.16, 0.5, 18, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  lid.rotateX(-Math.PI / 2);
  lid.translate(0, 0.89, 0);
  kit.add(lid, "#2f6b45");
  kit.box(0.03, 0.26, 0.03, 0.2, 1.0, 0.18, PAL.accent);
  kit.box(0.12, 0.08, 0.03, 0.25, 1.1, 0.18, PAL.accent);
  const letter = new THREE.BoxGeometry(0.06, 0.16, 0.24);
  letter.rotateZ(0.3);
  letter.translate(-0.26, 0.82, 0);
  kit.add(letter, "#fffaf1");
  const box = kit.mesh();
  box.scale.setScalar(1.45);
  box.position.set(mx, 0, mz);
  g.add(box);
  return { room: 11, group: g };
}

const BUILDERS: Record<string, (ctx: Ctx, r: RoomDef) => Fx> = {
  start,
  nantes,
  hiventive,
  coimbra,
  centrale,
  coalescent,
  "tii-c2": c2,
  "tii-swarm": swarmControl,
  "tii-bt": orchestration,
  "tii-track": planTrack,
  unchained,
  sirb,
  projects,
  photos,
  exit,
};

export function buildRooms(ctx: Ctx): Fx[] {
  return ROOMS.map((r, i) => {
    paintLabel(ctx, r);
    // rooms are known by id; their index (and their objects') comes from the layout
    const fx = BUILDERS[r.id](ctx, r);
    fx.room = i;
    for (const x of fx.ix ?? []) x.room = i;
    return fx;
  });
}
