import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOOR, H, type Maze, ROOMS, type RoomDef, W, idx, rng, wallRuns } from "./layout";
import { Atlas, SANS, SERIF, fitText, quad, roundRect, spaced, spacedWidth, wrap } from "./paint";
import { PAL, blobTexture, clay, plain, tint } from "./gfx";
import { buildRobot } from "./robot";
import { type Cell, planAll } from "./mapf";
import { PHOTOS, PROJECTS } from "../media";
import { BlocksTable } from "./blocks";

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
}

/** the trolley in the supermarket: it can be docked to and pushed around */
export interface Trolley {
  group: THREE.Group;
  /** trolley centres: where it starts, and the checkout */
  home: [number, number];
  checkout: [number, number];
  /** grid cell under each spot */
  homeCell: [number, number];
  checkoutCell: [number, number];
  at: "home" | "checkout";
  docked: boolean;
  setPose(x: number, z: number): void;
  /** world position of the handle bar, for a trolley centred at x */
  handle(x: number): THREE.Vector3;
  /** the detection box: searching, locked while docking, docked */
  status(s: "idle" | "locked" | "docked"): void;
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
  ix?: Interactable[];
  table?: BlocksTable;
  trolley?: Trolley;
  /** animate; return true while it still needs frames */
  update?(now: number, dt: number, inside: boolean): boolean;
  /** clickable meshes, with a handler */
  pick?: { object: THREE.Object3D; hit: (face: number) => void }[];
  /** called once when the robot first gets close: load the heavier media */
  approach?(): void;
  /** the scene is going to sleep: stop anything that runs on its own (video) */
  sleep?(): void;
}

const gx = (x: number) => x - W / 2;
const gz = (z: number) => z - H / 2;
const cellAt = (r: RoomDef, rx: number, ry: number): [number, number] => [gx(r.x + rx + 0.5), gz(r.y + ry + 0.5)];

/** collects tinted primitives and merges them into one mesh */
class Kit {
  parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
    this.parts.push(tint(plain(g), color));
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color);
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 18, rot?: [number, number, number]) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rot) {
      g.rotateX(rot[0]);
      g.rotateY(rot[1]);
      g.rotateZ(rot[2]);
    }
    g.translate(x, y, z);
    return this.add(g, color);
  }
  mesh(opts: { emissive?: number } = {}) {
    const m = new THREE.Mesh(mergeGeometries(this.parts), clay({ vertexColors: true, emissive: opts.emissive }));
    return m;
  }
}

/** brighten an object's clay materials while it's pointed at */
function glow(objs: THREE.Object3D[]) {
  const mats: { m: THREE.ShaderMaterial; base: number }[] = [];
  for (const o of objs)
    o.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && m.uniforms?.uEmissive && !mats.some((x) => x.m === m)) mats.push({ m, base: m.uniforms.uEmissive.value });
    });
  return (on: boolean) => {
    for (const { m, base } of mats) m.uniforms.uEmissive.value = on ? Math.min(1, base + 0.3) : base;
  };
}

const detOf = (key: string, cls: string, label = cls): Det => ({ key, cls, label, box: new THREE.Box3() });
/** boxes of an instanced mesh's instances, from its geometry's bounds */
function instanceBoxes(mesh: THREE.InstancedMesh, dets: Det[], grow = 0) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const m = new THREE.Matrix4();
  dets.forEach((d, i) => {
    mesh.getMatrixAt(i, m);
    d.box.copy(geo.boundingBox!).applyMatrix4(m).expandByScalar(grow);
  });
}

/** an invisible box that only the hover ray sees (the ray doesn't skip hidden meshes) */
function hitBox(w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  m.visible = false;
  return m;
}

/* ============================================================== floor lettering for every room */

const PX = 112; // atlas pixels per world unit

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

/** a small painted word on the floor */
function paintWord(ctx: Ctx, text: string, color: string, x: number, z: number, px = 34, tracking = 5) {
  const c = ctx.atlas.ctx;
  c.font = `700 ${px}px ${SANS}`;
  const w = spacedWidth(c, text, tracking) + 12;
  const h = px * 1.3;
  ctx.atlas.queue(
    w,
    h,
    (k) => {
      k.font = `700 ${px}px ${SANS}`;
      k.fillStyle = color;
      k.textBaseline = "middle";
      spaced(k, text, 6, h / 2 + 1, tracking);
    },
    (uv) => ctx.decals.push(quad(x, 0.005, z, w / PX, h / PX, uv)),
  );
}

/** a big number with a caption, painted like a floor marking */
function paintStat(ctx: Ctx, big: string, small: string, color: string, x: number, z: number) {
  const c = ctx.atlas.ctx;
  c.font = `italic 400 92px ${SERIF}`;
  const bw = c.measureText(big).width;
  c.font = `700 22px ${SANS}`;
  const sw = spacedWidth(c, small, 4);
  const w = Math.max(bw, sw) + 20;
  const h = 128;
  ctx.atlas.queue(
    w,
    h,
    (k) => {
      k.fillStyle = color;
      k.globalAlpha = 0.85;
      k.textAlign = "left";
      k.font = `italic 400 92px ${SERIF}`;
      k.fillText(big, (w - bw) / 2, 78);
      k.font = `700 22px ${SANS}`;
      spaced(k, small, (w - sw) / 2, 112, 4);
    },
    (uv) => ctx.decals.push(quad(x, 0.005, z, w / PX, h / PX, uv)),
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

/* ============================================================== 01 · Nantes, electronics */

function nantes(ctx: Ctx, r: RoomDef): Fx {
  const kit = new Kit();
  // a giant resistor lying on the floor, with its colour bands
  const [rx, rz] = cellAt(r, 2, 1);
  const y = 0.3;
  kit.cyl(0.2, 0.2, 1.3, rx, y, rz, "#ead7ae", 24, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.24, 20, 12);
    cap.scale(0.55, 1, 1);
    cap.translate(rx + s * 0.62, y, rz);
    kit.add(cap, "#ead7ae");
    kit.cyl(0.028, 0.028, 0.5, rx + s * 0.95, y, rz, "#9aa0a6", 8, [0, 0, Math.PI / 2]);
    kit.cyl(0.028, 0.028, y, rx + s * 1.2, y / 2, rz, "#9aa0a6", 8);
  }
  ["#7a4a2a", "#1f1f22", "#c8352b", "#c9a23c"].forEach((col, i) => {
    kit.cyl(0.212, 0.212, 0.1, rx - 0.42 + i * 0.24 + (i === 3 ? 0.12 : 0), y, rz, col, 24, [0, 0, Math.PI / 2]);
  });
  // an electrolytic capacitor standing up
  const [cx, cz] = cellAt(r, 5, 1);
  kit.cyl(0.3, 0.3, 0.78, cx, 0.5, cz, "#3567a8", 28);
  kit.cyl(0.29, 0.3, 0.03, cx, 0.9, cz, "#c9ccd2", 28);
  kit.box(0.08, 0.7, 0.04, cx - 0.12, 0.5, cz + 0.28, "#d5e3f4");
  kit.cyl(0.025, 0.025, 0.12, cx - 0.1, 0.06, cz, "#9aa0a6", 8);
  kit.cyl(0.025, 0.025, 0.12, cx + 0.1, 0.06, cz, "#9aa0a6", 8);
  const g = new THREE.Group();
  g.add(kit.mesh());

  // a breadboard painted on the floor
  const bw = 640;
  const bh = 190;
  ctx.atlas.queue(
    bw,
    bh,
    (k) => {
      k.fillStyle = "#fbfaf5";
      k.globalAlpha = 0.9;
      roundRect(k, 0, 0, bw, bh, 18);
      k.fill();
      k.globalAlpha = 1;
      k.fillStyle = "#c8352b";
      k.fillRect(24, 16, bw - 48, 4);
      k.fillStyle = "#3567a8";
      k.fillRect(24, bh - 20, bw - 48, 4);
      k.fillStyle = "#6f7a80";
      for (let row = 0; row < 5; row++)
        for (let col = 0; col < 26; col++) {
          k.fillRect(30 + col * 23, 34 + row * 25, 9, 9);
        }
      k.fillStyle = "#b9c4c8";
      k.fillRect(24, bh / 2 + 22, bw - 48, 3);
    },
    (uv) => {
      const [x, z] = cellAt(r, 3, 3.5);
      ctx.decals.push(quad(x, 0.004, z, 5.4, (5.4 * bh) / bw, uv));
    },
  );
  return { room: 1, group: g };
}

/* ============================================================== 02 · Hiventive, the chip */

function hiventive(ctx: Ctx, r: RoomDef): Fx {
  const m = ctx.maze;
  const kit = new Kit();
  // gold pins on the outside of the package, wherever the wall is closed
  const pinAt = (x: number, y: number, ox: number, oz: number) => {
    if (m.grid[idx(x, y)] === FLOOR) return;
    const cx = gx(x + 0.5) + ox * 0.31;
    const cz = gz(y + 0.5) + oz * 0.31;
    kit.box(ox ? 0.26 : 0.13, 0.08, ox ? 0.13 : 0.26, cx, 0.04, cz, PAL.gold);
  };
  for (let x = r.x; x < r.x + r.w; x++) {
    pinAt(x, r.y - 1, 0, -1);
    pinAt(x, r.y + r.h, 0, 1);
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    pinAt(r.x - 1, y, -1, 0);
    pinAt(r.x + r.w, y, 1, 0);
  }
  const g = new THREE.Group();
  g.add(kit.mesh({ emissive: 0.15 }));

  // the die, painted on the package
  const S = 600;
  ctx.atlas.queue(
    S,
    S,
    (k) => {
      const gold = "#e9c97c";
      k.fillStyle = "#43464e";
      roundRect(k, 0, 0, S, S, 26);
      k.fill();
      // bond wires from the die to the edges
      k.strokeStyle = gold;
      k.globalAlpha = 0.55;
      k.lineWidth = 3;
      const inner = 150;
      for (let i = 0; i < 9; i++) {
        const t = inner + ((S - 2 * inner) * (i + 0.5)) / 9;
        const o = (i + 0.5) * (S / 9);
        k.beginPath();
        k.moveTo(t, inner);
        k.lineTo(o, 6);
        k.moveTo(t, S - inner);
        k.lineTo(o, S - 6);
        k.moveTo(inner, t);
        k.lineTo(6, o);
        k.moveTo(S - inner, t);
        k.lineTo(S - 6, o);
        k.stroke();
      }
      k.globalAlpha = 1;
      k.fillStyle = "#5c616b";
      roundRect(k, inner, inner, S - 2 * inner, S - 2 * inner, 10);
      k.fill();
      k.strokeStyle = "rgba(233,201,124,0.35)";
      k.lineWidth = 2;
      for (let i = 1; i < 6; i++) {
        const t = inner + ((S - 2 * inner) * i) / 6;
        k.beginPath();
        k.moveTo(t, inner + 8);
        k.lineTo(t, S - inner - 8);
        k.moveTo(inner + 8, t);
        k.lineTo(S - inner - 8, t);
        k.stroke();
      }
      k.fillStyle = "#43464e";
      roundRect(k, S / 2 - 120, S / 2 - 70, 240, 140, 12);
      k.fill();
      k.fillStyle = gold;
      k.textAlign = "center";
      k.textBaseline = "middle";
      k.font = `700 64px ${SANS}`;
      k.fillText("STM32", S / 2, S / 2 - 14);
      k.font = `600 24px ${SANS}`;
      k.fillText("SystemC / TLM", S / 2, S / 2 + 38);
      // the peripherals he modelled, on the die's edges
      k.font = `700 28px ${SANS}`;
      k.fillText("TIM", S / 2 - 90, inner - 26);
      k.fillText("I2C", S / 2 + 90, inner - 26);
      k.fillText("GPIO", S / 2, S - inner + 28);
      k.save();
      k.translate(inner - 28, S / 2);
      k.rotate(-Math.PI / 2);
      k.fillText("USART", 0, 0);
      k.restore();
      k.save();
      k.translate(S - inner + 28, S / 2);
      k.rotate(Math.PI / 2);
      k.fillText("CAN", 0, 0);
      k.restore();
      // pin 1
      k.beginPath();
      k.arc(40, 40, 13, 0, Math.PI * 2);
      k.fill();
    },
    (uv) => {
      const [x, z] = cellAt(r, 4, 3.4);
      ctx.decals.push(quad(x, 0.004, z, 6.2, 6.2, uv));
    },
  );
  return { room: 2, group: g };
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
  const [px, pz] = cellAt(r, 9, 5);
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
  const [bx, bz] = cellAt(r, 5, 6);
  const table = new BlocksTable(bx, bz, "#7d72c4", "#3e3567");
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
    },
    update(now) {
      if (ctx.reduced) return false;
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

  // the trolley: built around its own origin so it can be docked to and pushed
  const [tx, tz] = cellAt(r, 6, 5);
  const [ox, oz] = cellAt(r, 9, 5);
  const tg = new THREE.Group();
  tg.position.set(tx, 0, tz);
  g.add(tg);
  const t = new Kit();
  const steel = "#9fb0bd";
  const L = 0.86;
  const D = 0.56;
  const yb = 0.42;
  t.box(L, 0.025, D, 0, yb, 0, steel);
  for (const h of [0.12, 0.25, 0.38]) {
    t.box(L, 0.022, 0.022, 0, yb + h, -D / 2, steel);
    t.box(L, 0.022, 0.022, 0, yb + h, D / 2, steel);
    t.box(0.022, 0.022, D, -L / 2, yb + h, 0, steel);
    t.box(0.022, 0.022, D, L / 2, yb + h, 0, steel);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    t.box(0.025, 0.4, 0.025, (sx * L) / 2, yb + 0.2, (sz * D) / 2, steel);
    t.box(0.03, yb, 0.03, (sx * (L - 0.1)) / 2, yb / 2, (sz * (D - 0.1)) / 2, steel);
    t.cyl(0.05, 0.05, 0.035, (sx * (L - 0.1)) / 2, 0.05, (sz * (D - 0.1)) / 2, "#2f3336", 10, [Math.PI / 2, 0, 0]);
  }
  t.box(L - 0.1, 0.02, D - 0.08, 0, 0.13, 0, steel);
  const HANDLE_X = -L / 2 - 0.12;
  const HANDLE_Y = yb + 0.48;
  t.box(0.03, 0.03, D + 0.08, HANDLE_X, HANDLE_Y, 0, "#2f7d4f");
  for (const sz of [-1, 1]) t.box(0.16, 0.025, 0.025, -L / 2 - 0.06, yb + 0.44, (sz * D) / 2, steel);
  const body = t.mesh();
  tg.add(body);

  // trolley detection: a box that locks on when the robot is in the room
  const det = new Kit();
  const bw = L + 0.42;
  const bh = 1.05;
  const bd = D + 0.24;
  const e = 0.022;
  const cx = -0.06;
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
  const tagTex = new THREE.CanvasTexture(tagC);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const drawTag = (text: string, color: string) => {
    tk.clearRect(0, 0, 320, 64);
    tk.fillStyle = color;
    roundRect(tk, 0, 0, 320, 64, 12);
    tk.fill();
    tk.fillStyle = "#fff";
    tk.font = `700 32px ${SANS}`;
    tk.textBaseline = "middle";
    spaced(tk, text, 22, 34, 3);
    tagTex.needsUpdate = true;
  };
  drawTag("TROLLEY 0.97", PAL.accent);
  const tagMat = clay({ map: tagTex, emissive: 1, transparent: true, opacity: 0 });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.18), tagMat);
  tag.position.set(cx - bw / 2 + 0.45, bh + 0.15, bd / 2);
  tag.rotation.x = -0.6;
  tg.add(tag);

  // the checkout, painted on the floor where the trolley can be pushed
  paintWord(ctx, "CHECKOUT", r.ink, ox, oz + 0.85, 26, 5);

  let state: "idle" | "locked" | "docked" = "idle";
  const trolley: Trolley = {
    group: tg,
    home: [tx, tz],
    checkout: [ox, oz],
    homeCell: [r.x + 6, r.y + 5],
    checkoutCell: [r.x + 9, r.y + 5],
    at: "home",
    docked: false,
    setPose(x, z) {
      tg.position.set(x, 0, z);
    },
    handle(x) {
      return new THREE.Vector3(x + HANDLE_X, HANDLE_Y, tz);
    },
    status(st) {
      state = st;
      if (st === "idle") drawTag("TROLLEY 0.97", PAL.accent);
      else if (st === "locked") drawTag("DOCKING", PAL.search);
      else drawTag("DOCKED", "#2f8f5b");
      detMat.uniforms.uColor.value.set(st === "idle" ? PAL.accent : st === "locked" ? PAL.search : "#2f8f5b");
      ctx.kick();
    },
  };
  const ix: Interactable[] = [
    {
      id: "trolley",
      room: 5,
      name: "Trolley",
      kind: "active",
      blurb: "The in-store robot's perception finds it. Dock with the arm on the handle, then push it to the checkout and back.",
      targets: [body],
      anchor: () => new THREE.Vector3(tg.position.x, 1.35, tg.position.z),
      highlight: glow([body]),
    },
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
    },
    update(now, dt, inside) {
      const target = inside || state !== "idle" ? 1 : 0;
      const prevK = k;
      k += (target - k) * Math.min(1, dt * (ctx.reduced ? 100 : 5));
      const flick = ctx.reduced || state !== "idle" ? 1 : 0.85 + 0.15 * Math.sin(now * 6);
      detMat.uniforms.uOpacity.value = k * flick;
      tagMat.uniforms.uOpacity.value = k;
      detMesh.visible = tag.visible = k > 0.01;
      return Math.abs(k - prevK) > 0.001 || (inside && !ctx.reduced && state === "idle");
    },
  };
}

/* ============================================================== 06 · TII, the swarm room */

function tii(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const m = ctx.maze;
  const N = 6;
  const colors = ["#3a9d8f", "#e2a93c", "#9a5fb4", "#4b8fd6", "#e06f8b", "#69a84f"];

  // a smaller robot body, instanced
  const k = new Kit();
  k.cyl(0.2, 0.2, 0.15, 0, 0.13, 0, "#ffffff", 20);
  k.cyl(0.16, 0.2, 0.05, 0, 0.23, 0, "#ffffff", 20);
  const visor = new THREE.CylinderGeometry(0.203, 0.203, 0.07, 16, 1, true, -0.6, 1.2);
  visor.rotateY(Math.PI / 2);
  visor.translate(0, 0.15, 0);
  k.add(visor, "#3a3840");
  k.cyl(0.055, 0.055, 0.06, 0, 0.28, 0, "#3a3840", 12);
  for (const s of [-1, 1]) k.cyl(0.065, 0.065, 0.04, 0.02, 0.065, s * 0.2, "#3a3840", 12, [Math.PI / 2, 0, 0]);
  const bodyGeo = mergeGeometries(k.parts);
  bodyGeo.scale(1.3, 1.3, 1.3);
  const agents = new THREE.InstancedMesh(bodyGeo, clay({ vertexColors: true }), N);
  colors.forEach((c, i) => agents.setColorAt(i, new THREE.Color(c)));
  g.add(agents);
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    N,
  );
  shadows.renderOrder = 1;
  g.add(shadows);
  // the numbers of this chapter, painted on the floor
  paintStat(ctx, "−74%", "ONBOARD CPU", r.ink, ...cellAt(r, 1.6, 0.55));
  paintStat(ctx, "−52%", "NETWORK BANDWIDTH", r.ink, ...cellAt(r, 8.4, 0.55));
  paintStat(ctx, "9", "ENGINEERS", r.ink, ...cellAt(r, 1.0, 8.6));

  // their planned paths, as dots in each agent's colour
  const MAXD = 260;
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), MAXD);
  // colours must exist before the first draw, or the shader is built without them
  for (let i = 0; i < MAXD; i++) dots.setColorAt(i, new THREE.Color(colors[i % N]));
  dots.count = 0;
  dots.frustumCulled = false;
  g.add(dots);
  const dotMeta: { agent: number; t: number }[] = [];

  const inRoom = (x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && m.grid[idx(x, y)] === FLOOR;
  const pos: Cell[] = [];
  for (let i = 0; i < N; i++) pos.push([r.x + 2 + (i % 3) * 3, r.y + 2 + Math.floor(i / 3) * 6]);
  const heading = new Float32Array(N);
  let paths: Cell[][] = pos.map((p) => [p]);
  let t0 = 0;
  let round = 0;
  let waitUntil = 0;
  const STEP = 0.34;
  const SHOW = 0.75; // the plans are drawn first, then everyone moves
  const ring: Cell[] = [[3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2], [0, -3], [2, -2]];

  const replan = (now: number) => {
    const [rx, ry] = [Math.floor(ctx.robot.x + W / 2), Math.floor(ctx.robot.z + H / 2)];
    const insideRoom = rx >= r.x && ry >= r.y && rx < r.x + r.w && ry < r.y + r.h;
    const cx = insideRoom ? rx : r.x + Math.floor(r.w / 2);
    const cy = insideRoom ? ry : r.y + Math.floor(r.h / 2);
    const taken = new Set<string>();
    const goals: Cell[] = [];
    for (let i = 0; i < N; i++) {
      const [dx, dy] = ring[(i + round) % ring.length];
      let best: Cell = pos[i];
      let bd = Infinity;
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          if (!inRoom(x, y) || taken.has(`${x},${y}`) || (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1)) continue;
          const d = (x - cx - dx) ** 2 + (y - cy - dy) ** 2;
          if (d < bd) {
            bd = d;
            best = [x, y];
          }
        }
      taken.add(`${best[0]},${best[1]}`);
      goals.push(best);
    }
    const blocked = new Set<string>();
    if (insideRoom) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!dx || !dy) blocked.add(`${rx + dx},${ry + dy}`);
    paths = planAll(inRoom, pos.map((p) => [p[0], p[1]] as Cell), goals, blocked, 40);
    t0 = now + SHOW;
    round++;
    // draw the plans
    dotMeta.length = 0;
    let n = 0;
    const mt = new THREE.Matrix4();
    const col = new THREE.Color();
    paths.forEach((p, a) => {
      for (let t = 1; t < p.length && n < MAXD; t++) {
        for (const f of [0.5, 1]) {
          const x = p[t - 1][0] + (p[t][0] - p[t - 1][0]) * f;
          const y = p[t - 1][1] + (p[t][1] - p[t - 1][1]) * f;
          if (f === 0.5 && p[t][0] === p[t - 1][0] && p[t][1] === p[t - 1][1]) continue;
          mt.makeTranslation(gx(x + 0.5), 0.011, gz(y + 0.5));
          dots.setMatrixAt(n, mt);
          dots.setColorAt(n, col.set(colors[a]));
          dotMeta.push({ agent: a, t: t - 1 + f });
          n++;
        }
      }
    });
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
  };

  const mt = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p3 = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const place = (now: number, dt: number) => {
    const tt = Math.max(0, (now - t0) / STEP);
    for (let a = 0; a < N; a++) {
      const p = paths[a];
      const i = Math.min(p.length - 1, Math.floor(tt));
      const j = Math.min(p.length - 1, i + 1);
      let f = Math.min(1, tt - i);
      f = f * f * (3 - 2 * f);
      const x = p[i][0] + (p[j][0] - p[i][0]) * f;
      const y = p[i][1] + (p[j][1] - p[i][1]) * f;
      if (p[j][0] !== p[i][0] || p[j][1] !== p[i][1]) {
        const want = Math.atan2(p[j][1] - p[i][1], p[j][0] - p[i][0]);
        let d = want - heading[a];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        heading[a] += d * Math.min(1, dt * 14);
      }
      p3.set(gx(x + 0.5), 0, gz(y + 0.5));
      q.setFromAxisAngle(up, -heading[a]);
      mt.compose(p3, q, one);
      agents.setMatrixAt(a, mt);
      mt.makeTranslation(p3.x + 0.03, 0.004, p3.z + 0.04);
      shadows.setMatrixAt(a, mt);
      pos[a] = p[Math.min(p.length - 1, Math.round(tt))];
    }
    agents.instanceMatrix.needsUpdate = true;
    agents.computeBoundingSphere();
    shadows.instanceMatrix.needsUpdate = true;
    // dots the agents have passed disappear
    const mtd = new THREE.Matrix4();
    dotMeta.forEach((d, n) => {
      if (d.t < tt - 0.2) dots.setMatrixAt(n, zero);
      else {
        const p = paths[d.agent];
        const i = Math.floor(d.t);
        const f = d.t - i;
        const a0 = p[i];
        const a1 = p[Math.min(p.length - 1, i + 1)];
        mtd.makeTranslation(gx(a0[0] + (a1[0] - a0[0]) * f + 0.5), 0.011, gz(a0[1] + (a1[1] - a0[1]) * f + 0.5));
        dots.setMatrixAt(n, mtd);
      }
    });
    dots.instanceMatrix.needsUpdate = true;
    return tt;
  };
  place(0, 0);
  const ix: Interactable[] = [
    {
      id: "mapf",
      room: 6,
      name: "MAPF swarm",
      kind: "passive",
      blurb: "Six robots plan around you with prioritized space-time A*: each reserves its cells in time so nobody collides. Drive in and they ring you.",
      targets: [agents],
      anchor: () => {
        const c = new THREE.Vector3(gx(r.x + r.w / 2), 1.1, gz(r.y + r.h / 2));
        return c;
      },
      highlight: glow([agents]),
    },
  ];

  const agentDets = colors.map((_, i) => detOf(`agent-${i}`, "robot"));
  return {
    room: 6,
    group: g,
    ix,
    detect(out) {
      instanceBoxes(agents, agentDets);
      out.push(...agentDets);
    },
    update(now, dt, inside) {
      if (ctx.reduced) {
        if (inside && round === 0) {
          replan(now);
          t0 = now - 100;
          place(now, 1);
          return true;
        }
        return false;
      }
      const longest = Math.max(...paths.map((p) => p.length));
      const tt = place(now, dt);
      if (tt > longest) {
        if (!waitUntil) waitUntil = now + 0.5;
        if (now > waitUntil && inside) {
          waitUntil = 0;
          // everyone at the goal: snap and plan the next lap around the robot
          paths.forEach((p, a) => (pos[a] = p[p.length - 1]));
          replan(now);
        }
      }
      return inside || tt <= longest + 0.5;
    },
  };
}

/* ============================================================== 07 · Unchained Labs, agents at home */

function unchained(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  // a little graph: intent -> three agents -> a queue of build jobs
  const node = (rx: number, ry: number) => cellAt(r, rx, ry);
  const nodes = [node(0.7, 2), node(3, 0.8), node(3, 2), node(3, 3.2), node(5.4, 2)];
  const edges: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4]];
  const kit = new Kit();
  const ncol = ["#2c5687", "#4b8fd6", "#4b8fd6", "#4b8fd6", "#2c5687"];
  nodes.forEach(([x, z], i) => {
    kit.cyl(0.32, 0.34, 0.12, x, 0.06, z, ncol[i], 28);
    kit.cyl(0.24, 0.24, 0.02, x, 0.13, z, "#eaf2fb", 28);
  });
  // the queue: build jobs stacked by the last node
  const [qx, qz] = node(5.4, 3.5);
  for (let i = 0; i < 4; i++) kit.box(0.42, 0.14, 0.3, qx, 0.07 + i * 0.15, qz, i % 2 ? "#f1b33b" : "#f4ecd8");
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
  const col = new THREE.Color();

  // each drone flies itself: an acceleration toward its slot, damping, and separation from its
  // neighbours. The slot is on a slow circle over the room, or, when M4 is in the room, around M4.
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const acc = new Float32Array(N * 3);
  let lead = 0;
  const circle = (i: number, now: number, out: number[]) => {
    const ph = (i / N) * Math.PI * 2;
    const lane = i % 3;
    const th = now * (0.42 + lane * 0.05) + ph;
    const rad = 2.1 + lane * 0.55 + 0.35 * Math.sin(now * 0.6 + i * 1.3);
    out[0] = cx + Math.cos(th) * rad;
    out[1] = 1.55 + lane * 0.28 + 0.16 * Math.sin(now * 1.1 + i * 2.1);
    out[2] = cz + Math.sin(th) * rad * 0.82;
  };
  const around = (i: number, now: number, out: number[]) => {
    // an escort: a loose ring around a point just ahead of the robot, near its camera's height,
    // so you see them from the robot's own view too
    const ph = (i / N) * Math.PI * 2 + now * 0.55;
    const lane = i % 3;
    const rad = 0.95 + lane * 0.45;
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
    circle(i, 0, a);
    pos.set(a, i * 3);
  }
  const step = (now: number, dt: number) => {
    for (let i = 0; i < N; i++) {
      circle(i, now, a);
      if (lead > 0.001) {
        around(i, now, b);
        for (let k = 0; k < 3; k++) a[k] += (b[k] - a[k]) * lead;
      }
      const o = i * 3;
      for (let k = 0; k < 3; k++) acc[o + k] = 16 * (a[k] - pos[o + k]) - 6.5 * vel[o + k];
    }
    // keep a little distance from each other (and from the robot)
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
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
    const ry = ctx.robot.flying ? ctx.robot.alt + 0.25 : 0.55;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const dx = pos[o] - ctx.robot.x;
      const dz = pos[o + 2] - ctx.robot.z;
      const dy = pos[o + 1] - ry;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.8 && lead > 0.01) {
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
      if (i === fault) {
        const t = now - faultAt;
        const dip = t < 0.7 ? t / 0.7 : Math.max(0, 1 - (t - 0.7) / 1.4);
        y -= dip * 0.75;
        drones.setColorAt(i, col.copy(white).lerp(red, Math.min(1, dip * 1.6)));
      }
      p.set(pos[o], y, pos[o + 2]);
      // face where it flies, bank into its acceleration
      const yaw = Math.atan2(vel[o + 2], vel[o]);
      e.set(THREE.MathUtils.clamp(acc[o + 2] * 0.01, -0.4, 0.4), -yaw, THREE.MathUtils.clamp(-acc[o] * 0.01, -0.4, 0.4));
      q.setFromEuler(e);
      mt.compose(p, q, one);
      drones.setMatrixAt(i, mt);
      mt.makeTranslation(p.x + 0.35, 0.005, p.z + 0.3);
      shadows.setMatrixAt(i, mt);
    }
    drones.instanceMatrix.needsUpdate = true;
    drones.computeBoundingSphere();
    shadows.instanceMatrix.needsUpdate = true;
    if (drones.instanceColor) drones.instanceColor.needsUpdate = true;
  };
  place(0);
  const ix: Interactable[] = [
    {
      id: "flock",
      room: 8,
      name: "Swarm",
      kind: "passive",
      blurb: "Thirty drones, each steering by acceleration toward its place in the flock. Come into the room, rolling or flying, and they flock with you.",
      targets: [drones],
      anchor: () => {
        let x = 0;
        let y = 0;
        let z = 0;
        for (let i = 0; i < N; i++) {
          x += pos[i * 3];
          y += pos[i * 3 + 1];
          z += pos[i * 3 + 2];
        }
        return new THREE.Vector3(x / N, y / N + 0.5, z / N);
      },
      highlight: glow([drones]),
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
    },
    update(now, dt, inside) {
      if (ctx.reduced) return false;
      lead += ((inside ? 1 : 0) - lead) * Math.min(1, dt * 1.6);
      // every few seconds one drone fails, drops, and the layer recovers it
      if (now - faultAt > 4.5) {
        if (fault >= 0) drones.setColorAt(fault, white);
        fault = Math.floor((now * 7.3) % N);
        faultAt = now;
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
  // finish line across the way out
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
      const gxw = gx(r.x + r.w + 0.5);
      const gzw = gz(r.y + 4.5);
      ctx.decals.push(quad(gxw, 0.004, gzw, 0.5, 1.0, uv));
    },
  );
  // an arrow painted toward it
  ctx.atlas.queue(
    260,
    120,
    (k) => {
      k.fillStyle = r.ink;
      k.globalAlpha = 0.7;
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
      const [x, z] = cellAt(r, 2.6, 4);
      ctx.decals.push(quad(x, 0.004, z, 1.9, 0.88, uv));
    },
  );
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
  tii,
  unchained,
  sirb,
  projects,
  photos,
  exit,
};

export function buildRooms(ctx: Ctx): Fx[] {
  return ROOMS.map((r) => {
    paintLabel(ctx, r);
    return BUILDERS[r.id](ctx, r);
  });
}
