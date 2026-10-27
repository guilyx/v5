import * as THREE from "three";
import { add, bake, canvasTex, cyl, fitText, FONT_SANS, FONT_SERIF, mat, paperFill, rbox, ribbon, rng, textLines, wrapText } from "../kit";
import { makeProp, type Prop, type PropSpec } from "../props";
import { STATION_X } from "../world";
import { PAL, drawMark, printed, sticker, type Build } from "./common";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, material: THREE.Material, seg = 8) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = add(parent, new THREE.CylinderGeometry(r, r, len, seg), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  return m;
}

function lathe(points: [number, number][], seg = 36) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}

function prop(b: Build, spec: PropSpec): Prop {
  const p = makeProp(b.scene, spec);
  b.props.push(p);
  return p;
}

/** decoration: placed with a contact shadow, but no hover */
function deco(b: Build, g: THREE.Group, blob: PropSpec["blob"] = {}) {
  makeProp(b.scene, { id: "", name: "", meta: "", panel: "", station: "", group: g, blob });
  b.deco.push(g);
}

/* ------------------------------------------------------------------ hero */

export function buildHero(b: Build) {
  const X = STATION_X.hero;
  const r = rng(5);

  // a pilea in a terracotta pot
  const plant = new THREE.Group();
  add(plant, lathe([[0, 0.12], [0.64, 0.12], [0.7, 0.16], [0.86, 1.2], [0.93, 1.24], [0.93, 1.36], [0.84, 1.36], [0.79, 1.26], [0, 1.26]], 40), mat(PAL.terracotta, { rough: 0.9 }));
  add(plant, cyl(1.02, 0.94, 0.12, 40), mat(0xa9583a, { rough: 0.9 }), 0, 0.06, 0);
  add(plant, cyl(0.8, 0.8, 0.04, 32), mat(0x3a2a1e, { rough: 1 }), 0, 1.25, 0);
  const stemMat = mat(0x6f8f45, { rough: 0.8 });
  const leafMats = [mat(0x5b8a43, { rough: 0.55 }), mat(0x6c9b4f, { rough: 0.55 }), mat(0x4d7a39, { rough: 0.55 })];
  for (let i = 0; i < 17; i++) {
    const a = i * 2.39996 + r() * 0.3;
    const rr = 0.25 + (i / 17) * 1.15 + r() * 0.15;
    const h = 1.6 + (1 - i / 17) * 1.6 + r() * 0.4;
    const tip = V(Math.cos(a) * rr, h, Math.sin(a) * rr);
    rod(plant, V(Math.cos(a) * 0.1, 1.25, Math.sin(a) * 0.1), tip, 0.025, stemMat, 5);
    const s = 0.36 + r() * 0.2;
    const leaf = add(plant, cyl(s, s, 0.025, 18), leafMats[i % 3], tip.x, tip.y, tip.z);
    const out = V(Math.cos(a), 0, Math.sin(a));
    const n = out.multiplyScalar(0.55 + r() * 0.3).add(V(0, 1, 0)).normalize();
    leaf.quaternion.setFromUnitVectors(V(0, 1, 0), n);
  }
  bake(plant);
  plant.position.set(X - 1.2, 0, -3.4);
  deco(b, plant, { round: true, scale: 1.3, opacity: 0.4 });

  // a mug on a cork coaster, with the brand mark on it
  const mug = new THREE.Group();
  const wall: [number, number][] = [];
  for (let i = 0; i <= 10; i++) wall.push([0.72 - Math.sin((i / 10) * Math.PI) * 0.02, 0.1 + (i / 10) * 1.25]);
  const prof: [number, number][] = [[0, 0.02], [0.6, 0], [0.7, 0.06], ...wall, [0.7, 1.42], [0.63, 1.42], [0.63, 0.16], [0, 0.16]];
  const vSpan = [2 / (prof.length - 1), 12 / (prof.length - 1)];
  const glaze = canvasTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = "#eee3cf";
    ctx.fillRect(0, 0, w, h);
    const y0 = (1 - vSpan[1]) * h;
    const y1 = (1 - vSpan[0]) * h;
    ctx.fillStyle = "#2f4f6b";
    ctx.fillRect(0, (1 - vSpan[1]) * h - 6, w, 10);
    const s = (y1 - y0) * 0.62;
    drawMark(ctx, w / 2 - s / 2, (y0 + y1) / 2 - s / 2 + 6, s, "#2a2119", "#b03b16");
  });
  add(mug, lathe(prof, 48), mat(0xffffff, { map: glaze, rough: 0.32 }), 0, 0.07, 0, 0, Math.PI, 0);
  add(mug, cyl(0.62, 0.62, 0.02, 32), mat(0x3a2414, { rough: 0.12 }), 0, 1.25, 0);
  const handle = add(mug, new THREE.TorusGeometry(0.36, 0.085, 10, 24, Math.PI), mat(0xeee3cf, { rough: 0.32 }), 0.7, 0.8, 0, 0, 0, -Math.PI / 2);
  handle.castShadow = true;
  add(mug, cyl(1.0, 1.0, 0.07, 40), mat(0xb88d5e, { rough: 0.95 }), 0, 0.035, 0);
  bake(mug);
  mug.position.set(X + 2.6, 0, 0.9);
  mug.rotation.y = -0.35;
  deco(b, mug, { round: true, scale: 1.1, opacity: 0.45 });

  // his glasses, folded
  const gl = new THREE.Group();
  const rim = mat(0x3a2416, { rough: 0.35 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xd8e6ee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22 });
  for (const sx of [-0.52, 0.52]) {
    add(gl, new THREE.TorusGeometry(0.42, 0.055, 8, 36), rim, sx, 0.32, 0, -1.25, 0, 0);
    const l = add(gl, new THREE.CircleGeometry(0.4, 32), lens, sx, 0.32, 0.005, -1.25, 0, 0);
    l.castShadow = false;
    l.userData.noBake = true;
    rod(gl, V(sx * 1.85, 0.42, 0.06), V(sx * 1.85 - Math.sign(sx) * 0.1, 0.1, -1.6), 0.04, rim, 6);
  }
  add(gl, new THREE.TorusGeometry(0.16, 0.045, 6, 16, Math.PI), rim, 0, 0.5, 0.12, -1.25, 0, 0);
  bake(gl);
  gl.position.set(X - 0.9, 0, 1.9);
  gl.rotation.y = 0.5;
  deco(b, gl, { scale: 0.9, opacity: 0.3 });
}

/* ------------------------------------------------------------------ 2014: books */

export function buildSchool(b: Build) {
  const X = STATION_X.school;
  const books = new THREE.Group();
  const specs = [
    { w: 4.5, t: 0.62, d: 3.2, col: 0x2d5a5d, title: "NANTES UNIVERSITÉ", sub: "B.Sc. Electronics Engineering", ry: 0.02, ox: 0, oz: 0 },
    { w: 4.1, t: 0.5, d: 3.0, col: 0xc08f33, title: "YNOV BORDEAUX", sub: "M.Sc. Computer Eng. & Aeronautics", ry: 0.13, ox: 0.3, oz: -0.12 },
    { w: 3.8, t: 0.56, d: 2.8, col: 0x7a2d29, title: "CENTRALE NANTES", sub: "M.Sc. Control & Robotics", ry: -0.07, ox: -0.2, oz: 0.06 },
  ];
  const pages = mat(0xf3ead6, { rough: 0.95 });
  let y = 0;
  for (const s of specs) {
    const bk = new THREE.Group();
    bk.position.set(s.ox, y, s.oz);
    bk.rotation.y = s.ry;
    const cover = mat(s.col, { rough: 0.62 });
    add(bk, rbox(s.w, 0.07, s.d, 0.03), cover, 0, s.t - 0.035, 0);
    add(bk, rbox(s.w, 0.07, s.d, 0.03), cover, 0, 0.035, 0);
    add(bk, rbox(s.w, s.t, 0.14, 0.06), cover, 0, s.t / 2, s.d / 2 - 0.07);
    add(bk, rbox(s.w - 0.16, s.t - 0.12, s.d - 0.16, 0.02), pages, 0, s.t / 2, -0.05);
    const label = sticker(s.w * 0.94, s.t * 0.66, 1024, (ctx, w, h) => {
      ctx.fillStyle = hex(s.col);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, w, h * 0.5);
      ctx.strokeStyle = "#e3c27a";
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = "#f0d590";
      ctx.textBaseline = "middle";
      fitText(ctx, s.title, 34, h / 2 + 2, w * 0.46, (px) => `600 ${px}px ${FONT_SANS}`, Math.round(h * 0.42));
      ctx.textAlign = "right";
      fitText(ctx, s.sub, w - 34, h / 2 + 2, w * 0.44, (px) => `italic ${px}px ${FONT_SERIF}`, Math.round(h * 0.5));
    }, 0.5);
    label.position.set(0, s.t / 2, s.d / 2 + 0.003);
    label.userData.noBake = true;
    bk.add(label);
    books.add(bk);
    y += s.t;
  }
  // the top cover carries a title
  const topBook = specs[2];
  const cover = printed(topBook.w * 0.62, topBook.d * 0.5, 512, (ctx, w, h) => {
    ctx.fillStyle = hex(topBook.col);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#efd28a";
    ctx.textAlign = "center";
    ctx.font = `italic ${Math.round(h * 0.3)}px ${FONT_SERIF}`;
    ctx.fillText("Control", w / 2, h * 0.38);
    ctx.fillText("& Robotics", w / 2, h * 0.7);
    ctx.fillRect(w * 0.3, h * 0.84, w * 0.4, 3);
  }, { rough: 0.55 });
  cover.position.set(topBook.ox, y + 0.002, topBook.oz - 0.2);
  cover.rotation.y = topBook.ry;
  cover.userData.noBake = true;
  books.add(cover);
  bake(books);
  books.position.set(X - 0.4, 0, -0.5);
  books.rotation.y = -0.12;
  prop(b, {
    id: "books",
    name: "Three textbooks",
    meta: "Nantes · Bordeaux · Centrale, 2014–2021",
    panel: "station:school",
    station: "school",
    group: books,
    hand: { tilt: 0.55, yaw: 0.35, fill: 0.85 },
  });

  // a scientific calculator, for an electronics student
  const calc = new THREE.Group();
  add(calc, rbox(1.8, 0.2, 2.8, 0.14), mat(0x2e3033, { rough: 0.6 }));
  const face = printed(1.6, 2.6, 384, (ctx, w, h) => {
    ctx.fillStyle = "#2e3033";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#9fae97";
    ctx.beginPath();
    ctx.roundRect(w * 0.08, h * 0.06, w * 0.84, h * 0.2, 8);
    ctx.fill();
    ctx.fillStyle = "#2a3326";
    ctx.font = `500 ${Math.round(h * 0.07)}px ${FONT_SANS}`;
    ctx.textAlign = "right";
    ctx.fillText("3.14159", w * 0.86, h * 0.22);
    const cols = 5;
    const rows = 7;
    for (let rr = 0; rr < rows; rr++)
      for (let c = 0; c < cols; c++) {
        const kx = w * 0.08 + (c * w * 0.84) / cols;
        const ky = h * 0.32 + (rr * h * 0.64) / rows;
        ctx.fillStyle = rr === rows - 1 && c === cols - 1 ? "#c0532d" : rr < 2 ? "#4b4f55" : "#d9d4c8";
        ctx.beginPath();
        ctx.roundRect(kx + 3, ky + 3, w * 0.84 / cols - 6, h * 0.64 / rows - 8, 6);
        ctx.fill();
      }
  });
  face.position.y = 0.101;
  calc.add(face);
  calc.position.set(X + 3.6, 0, 1.6);
  calc.rotation.y = 0.28;
  deco(b, calc, { opacity: 0.35 });

  // a pencil
  const pencil = new THREE.Group();
  add(pencil, new THREE.CylinderGeometry(0.075, 0.075, 2.6, 6), mat(0xe2a92e, { rough: 0.55 }), 0, 0, 0, 0, 0, Math.PI / 2);
  add(pencil, new THREE.CylinderGeometry(0.075, 0.012, 0.32, 6), mat(0xe2c39a, { rough: 0.8 }), 1.46, 0, 0, 0, 0, -Math.PI / 2);
  add(pencil, cyl(0.078, 0.078, 0.14, 12), mat(PAL.steel, { metal: 0.7, rough: 0.35 }), -1.36, 0, 0, 0, 0, Math.PI / 2);
  add(pencil, cyl(0.075, 0.075, 0.18, 12), mat(0xd99a97, { rough: 0.8 }), -1.5, 0, 0, 0, 0, Math.PI / 2);
  bake(pencil);
  pencil.position.set(X - 3.2, 0.075, 2.3);
  pencil.rotation.y = -0.5;
  deco(b, pencil, { opacity: 0.3, scale: 1 });
}

/* ------------------------------------------------------------------ 2018: the chip */

function pcbTexture() {
  return canvasTex(1024, 666, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#1e4f8f");
    g.addColorStop(1, "#173f75");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r = rng(18);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // traces with 45° bends
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = r() < 0.7 ? "rgba(70,130,205,0.75)" : "rgba(214,180,96,0.65)";
      ctx.lineWidth = 3 + Math.floor(r() * 3);
      let x = r() * w;
      let y = r() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        const len = 30 + r() * 160;
        const dir = Math.floor(r() * 8) * (Math.PI / 4);
        x += Math.cos(dir) * len;
        y += Math.sin(dir) * len;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = "#d9b764";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // mounting holes
    for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) {
      ctx.fillStyle = "#d9b764";
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f1a26";
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fill();
    }
    // silkscreen
    ctx.strokeStyle = "rgba(240,244,248,0.85)";
    ctx.lineWidth = 3;
    ctx.strokeRect(w * 0.45, h * 0.27, w * 0.32, h * 0.46);
    ctx.fillStyle = "rgba(240,244,248,0.9)";
    ctx.font = `600 30px ${FONT_SANS}`;
    ctx.fillText("U1", w * 0.45, h * 0.24);
    ctx.fillText("USB", w * 0.04, h * 0.42);
    ctx.fillText("RST", w * 0.78, h * 0.2);
    ctx.fillText("PWR", w * 0.86, h * 0.84);
  });
}

export function buildHiventive(b: Build) {
  const X = STATION_X.hiventive;
  const board = new THREE.Group();
  add(board, rbox(4.2, 0.12, 2.7, 0.05), mat(0xffffff, { map: pcbTexture(), rough: 0.45 }), 0, 0.06, 0);
  const chipMat = mat(0x1b1b1d, { rough: 0.45 });
  add(board, rbox(1.15, 0.14, 1.15, 0.03), chipMat, 0.45, 0.19, 0);
  const pin = mat(0xc9ccd0, { metal: 0.85, rough: 0.3 });
  const pinGeo = rbox(0.045, 0.03, 0.18, 0.01);
  for (let i = 0; i < 12; i++) {
    const o = -0.48 + (i * 0.96) / 11;
    add(board, pinGeo, pin, 0.45 + o, 0.135, 0.66);
    add(board, pinGeo, pin, 0.45 + o, 0.135, -0.66);
    add(board, pinGeo, pin, 0.45 - 0.66, 0.135, o, 0, Math.PI / 2, 0);
    add(board, pinGeo, pin, 0.45 + 0.66, 0.135, o, 0, Math.PI / 2, 0);
  }
  const chipTop = printed(1.0, 1.0, 256, (ctx, w, h) => {
    ctx.fillStyle = "#1b1b1d";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d8d8d4";
    ctx.font = `600 ${Math.round(h * 0.2)}px ${FONT_SANS}`;
    ctx.textAlign = "center";
    ctx.fillText("STM32", w / 2, h * 0.48);
    ctx.font = `500 ${Math.round(h * 0.09)}px ${FONT_SANS}`;
    ctx.fillStyle = "#9a9a96";
    ctx.fillText("virtual prototype", w / 2, h * 0.66);
    ctx.beginPath();
    ctx.arc(w * 0.16, h * 0.84, 8, 0, Math.PI * 2);
    ctx.fill();
  }, { rough: 0.5 });
  chipTop.position.set(0.45, 0.262, 0);
  chipTop.userData.noBake = true;
  board.add(chipTop);
  // pin headers along both long edges
  const black = mat(0x151515, { rough: 0.6 });
  const gold = mat(0xd6b24f, { metal: 0.9, rough: 0.3 });
  for (const z of [-1.1, 1.1]) {
    add(board, rbox(3.5, 0.22, 0.24, 0.03), black, 0.15, 0.23, z);
    for (let i = 0; i < 18; i++) add(board, rbox(0.06, 0.3, 0.06, 0.01), gold, -1.55 + i * 0.2, 0.42, z);
  }
  add(board, rbox(0.62, 0.28, 0.6, 0.05), mat(0xc7cacf, { metal: 0.9, rough: 0.25 }), -1.86, 0.26, 0);
  add(board, rbox(0.44, 0.14, 0.18, 0.06), mat(0xd2d4d8, { metal: 0.9, rough: 0.2 }), -0.85, 0.19, 0.55);
  add(board, rbox(0.32, 0.08, 0.32, 0.02), pin, 1.55, 0.16, -0.62);
  add(board, cyl(0.1, 0.1, 0.1, 16), black, 1.55, 0.22, -0.62);
  for (let i = 0; i < 6; i++) add(board, rbox(0.16, 0.08, 0.09, 0.02), i % 2 ? mat(0xcdb78f, { rough: 0.6 }) : black, -0.6 + (i % 3) * 0.24, 0.16, -0.5 - Math.floor(i / 3) * 0.2);
  const ledG = mat(0x40ff80, { emissive: 0x30ff70, emissiveIntensity: 2.2, rough: 0.3 });
  const ledR = mat(0xff5540, { emissive: 0xff4020, emissiveIntensity: 1.8, rough: 0.3 });
  add(board, rbox(0.14, 0.07, 0.09, 0.02), ledG, 1.6, 0.155, 0.65);
  add(board, rbox(0.14, 0.07, 0.09, 0.02), ledR, 1.6, 0.155, 0.45);
  bake(board, [chipTop]);
  board.position.set(X + 0.1, 0, -0.5);
  board.rotation.y = -0.1;
  prop(b, {
    id: "board",
    name: "STM32-style dev board",
    meta: "Hiventive, Bordeaux · 2018–2019",
    panel: "station:hiventive",
    station: "hiventive",
    group: board,
    hand: { tilt: 1.15, yaw: -0.2, fill: 0.85 },
  });

  // its USB cable, trailing off the back of the desk
  const cable = new THREE.Group();
  const start = V(-2.25, 0.26, 0).applyAxisAngle(V(0, 1, 0), -0.1).add(board.position);
  const curve = new THREE.CatmullRomCurve3([
    start,
    start.clone().add(V(-0.7, -0.14, -0.05)),
    start.clone().add(V(-1.5, -0.2, -0.7)),
    start.clone().add(V(-1.4, -0.2, -2.4)),
    start.clone().add(V(-0.4, -0.2, -4.2)),
    start.clone().add(V(-0.9, -0.2, -7.6)),
  ]);
  add(cable, new THREE.TubeGeometry(curve, 80, 0.06, 8), mat(0x2b2b2d, { rough: 0.55 }));
  add(cable, rbox(0.46, 0.18, 0.3, 0.06), mat(0x2b2b2d, { rough: 0.55 }), start.x - 0.2, 0.2, start.z);
  cable.traverse((o) => (o.castShadow = true));
  bake(cable);
  b.scene.add(cable);
  b.deco.push(cable);

  // a magnifier for reading part numbers
  const mag = new THREE.Group();
  add(mag, new THREE.TorusGeometry(0.62, 0.07, 10, 40), mat(0x2b2b2d, { rough: 0.4 }), 0, 0.08, 0, Math.PI / 2, 0, 0);
  const glass = add(mag, new THREE.CircleGeometry(0.6, 40), new THREE.MeshStandardMaterial({ color: 0xe8f0f2, roughness: 0.04, transparent: true, opacity: 0.18 }), 0, 0.08, 0, -Math.PI / 2, 0, 0);
  glass.castShadow = false;
  glass.userData.noBake = true;
  add(mag, cyl(0.1, 0.12, 1.5, 12), mat(0x5a3b26, { rough: 0.5 }), 1.3, 0.1, 0, 0, 0, Math.PI / 2);
  bake(mag, [glass]);
  mag.position.set(X + 3.3, 0, 1.9);
  mag.rotation.y = 0.5;
  deco(b, mag, { round: true, opacity: 0.25 });
}

/* ------------------------------------------------------------------ 2019: the maze */

function makeMaze(n: number, seed: number) {
  const r = rng(seed);
  // walls[y][x] = [north, east, south, west]
  const walls = Array.from({ length: n }, () => Array.from({ length: n }, () => [true, true, true, true]));
  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  const dirs: [number, number, number, number][] = [[0, -1, 0, 2], [1, 0, 1, 3], [0, 1, 2, 0], [-1, 0, 3, 1]];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = dirs.filter(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < n && ny < n && !seen[ny][nx];
    });
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [dx, dy, a, bb] = opts[Math.floor(r() * opts.length)];
    walls[y][x][a] = false;
    walls[y + dy][x + dx][bb] = false;
    seen[y + dy][x + dx] = true;
    stack.push([x + dx, y + dy]);
  }
  // breadth-first path from the corner to the opposite corner
  const prev = new Map<string, string>();
  const q: [number, number][] = [[0, 0]];
  const key = (x: number, y: number) => `${x},${y}`;
  prev.set(key(0, 0), "");
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === n - 1 && y === n - 1) break;
    dirs.forEach(([dx, dy, a]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (!walls[y][x][a] && !prev.has(key(nx, ny))) {
        prev.set(key(nx, ny), key(x, y));
        q.push([nx, ny]);
      }
    });
  }
  const path: [number, number][] = [];
  let k = key(n - 1, n - 1);
  while (k) {
    const [x, y] = k.split(",").map(Number);
    path.unshift([x, y]);
    k = prev.get(k)!;
  }
  return { walls, path };
}

function trophy(label: string) {
  const g = new THREE.Group();
  const walnut = mat(0x4a2c1a, { rough: 0.45 });
  add(g, rbox(0.95, 0.42, 0.95, 0.05), walnut, 0, 0.21, 0);
  add(g, rbox(0.66, 0.16, 0.66, 0.04), walnut, 0, 0.5, 0);
  const goldM = mat(PAL.gold, { metal: 1, rough: 0.26 });
  add(g, lathe([[0, 0], [0.26, 0], [0.26, 0.05], [0.09, 0.12], [0.06, 0.55], [0.12, 0.64], [0.38, 0.8], [0.47, 1.2], [0.5, 1.26], [0.45, 1.26], [0.41, 0.86], [0.12, 0.7], [0, 0.7]], 36), goldM, 0, 0.58, 0);
  for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(0.2, 0.035, 8, 18, Math.PI), goldM, s * 0.47, 1.6, 0, 0, 0, s < 0 ? Math.PI / 2 : -Math.PI / 2);
  const plaque = sticker(0.74, 0.26, 384, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, "#e2c27a");
    gr.addColorStop(1, "#b48a3d");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#3c2a12";
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(h * 0.26)}px ${FONT_SANS}`;
    ctx.fillText("MAZE", w / 2, h * 0.38);
    ctx.font = `italic ${Math.round(h * 0.42)}px ${FONT_SERIF}`;
    ctx.fillText(label, w / 2, h * 0.82);
  }, 0.4);
  plaque.position.set(0, 0.21, 0.476);
  plaque.userData.noBake = true;
  g.add(plaque);
  bake(g, [plaque]);
  return g;
}

export function buildCoimbra(b: Build) {
  const X = STATION_X.coimbra;
  const n = 7;
  const cell = 0.62;
  const size = n * cell;
  const { walls, path } = makeMaze(n, 2019);
  const maze = new THREE.Group();
  const birch = mat(0xdcbc8f, { rough: 0.7 });
  const wallMat = mat(0xe9d2ab, { rough: 0.65 });
  add(maze, rbox(size + 0.5, 0.2, size + 0.5, 0.08), birch, 0, 0.1, 0);
  add(maze, rbox(size, 0.02, size, 0.005), mat(0x9c7a52, { rough: 0.9 }), 0, 0.205, 0);
  const wh = 0.36;
  const t = 0.09;
  const o = -size / 2;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const w = walls[y][x];
      const cx = o + x * cell;
      const cz = o + y * cell;
      if (w[0] && !(x === 0 && y === 0)) add(maze, rbox(cell + t, wh, t, 0.02), wallMat, cx + cell / 2, 0.2 + wh / 2, cz);
      if (w[3]) add(maze, rbox(t, wh, cell + t, 0.02), wallMat, cx, 0.2 + wh / 2, cz + cell / 2);
      if (y === n - 1 && w[2] && x !== n - 1) add(maze, rbox(cell + t, wh, t, 0.02), wallMat, cx + cell / 2, 0.2 + wh / 2, cz + cell);
      if (x === n - 1 && w[1]) add(maze, rbox(t, wh, cell + t, 0.02), wallMat, cx + cell, 0.2 + wh / 2, cz + cell / 2);
    }
  // the robot
  const bot = new THREE.Group();
  add(bot, rbox(0.34, 0.18, 0.34, 0.08), mat(0xf4f1ea, { rough: 0.45 }), 0, 0.15, 0);
  add(bot, cyl(0.07, 0.07, 0.08, 12), mat(0x222222, { rough: 0.4 }), 0, 0.28, -0.04);
  add(bot, rbox(0.12, 0.04, 0.05, 0.015), mat(0xff6a3d, { emissive: 0xff5a2a, emissiveIntensity: 1.4 }), 0, 0.17, 0.17);
  for (const s of [-1, 1]) add(bot, cyl(0.09, 0.09, 0.05, 14), mat(0x1d1d1d, { rough: 0.8 }), s * 0.19, 0.09, 0, 0, 0, Math.PI / 2);
  bake(bot);
  const cellPos = (p: [number, number]) => V(o + p[0] * cell + cell / 2, 0.21, o + p[1] * cell + cell / 2);
  bot.position.copy(cellPos(path[0]));
  maze.add(bot);
  bake(maze, [bot]);
  maze.position.set(X - 0.9, 0, -0.6);
  maze.rotation.y = 0.12;

  let s = 0;
  let pause = 0;
  const a = V(0, 0, 0);
  const bb = V(0, 0, 0);
  prop(b, {
    id: "maze",
    name: "Maze and its robot",
    meta: "Ingeniarius, Coimbra · 2019",
    panel: "station:coimbra",
    station: "coimbra",
    group: maze,
    hand: { tilt: 1.05, yaw: 0.2, fill: 0.85 },
    tick: (_t, dt, st) => {
      if (!(st.hover || st.held) || st.reduced) return false;
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) s = 0;
        return true;
      }
      s += dt * 2.6;
      if (s >= path.length - 1) {
        s = path.length - 1;
        pause = 0.9;
      }
      const i = Math.min(Math.floor(s), path.length - 2);
      const f = s - i;
      a.copy(cellPos(path[i]));
      bb.copy(cellPos(path[i + 1]));
      bot.position.lerpVectors(a, bb, f);
      const target = Math.atan2(bb.x - a.x, bb.z - a.z);
      let d = target - bot.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      bot.rotation.y += d * Math.min(1, dt * 14);
      return true;
    },
  });

  const t1 = trophy("mapped");
  t1.position.set(X + 3.1, 0, -2.3);
  t1.rotation.y = -0.18;
  prop(b, { id: "trophy-mapped", name: "Trophy: mapped maze", meta: "Won · Coimbra, 2019", panel: "station:coimbra", station: "coimbra", group: t1, hand: { tilt: 0.22, yaw: 0, fill: 0.7 }, blob: { round: true, scale: 1.2 } });
  const t2 = trophy("unmapped");
  t2.position.set(X + 3.6, 0, 0.2);
  t2.rotation.y = -0.32;
  prop(b, { id: "trophy-unmapped", name: "Trophy: unmapped maze", meta: "Won · Coimbra, 2019", panel: "station:coimbra", station: "coimbra", group: t2, hand: { tilt: 0.22, yaw: 0, fill: 0.7 }, blob: { round: true, scale: 1.2 } });
}

/* ------------------------------------------------------------------ 2020: papers */

type Figure = "mapf" | "pendulum" | "flock";

function drawFigure(ctx: CanvasRenderingContext2D, kind: Figure, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(40,30,20,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "mapf") {
    const n = 7;
    const c = Math.min(w, h) / (n + 1);
    const ox = x + (w - c * n) / 2;
    const oy = y + (h - c * n) / 2;
    ctx.strokeStyle = "rgba(40,30,20,0.18)";
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + i * c, oy);
      ctx.lineTo(ox + i * c, oy + n * c);
      ctx.moveTo(ox, oy + i * c);
      ctx.lineTo(ox + n * c, oy + i * c);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(40,30,20,0.55)";
    for (const [i, j] of [[2, 1], [2, 2], [4, 4], [5, 4], [1, 5]]) ctx.fillRect(ox + i * c + 2, oy + j * c + 2, c - 4, c - 4);
    const paths: [string, [number, number][]][] = [
      ["#b03b16", [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3]]],
      ["#233f7a", [[6, 0], [5, 0], [4, 0], [4, 1], [4, 2], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6]]],
      ["#3d7a4a", [[0, 6], [1, 6], [2, 6], [2, 5], [2, 4], [3, 4], [4, 5], [5, 5], [6, 5], [6, 6]]],
    ];
    for (const [col, p] of paths) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.beginPath();
      p.forEach(([i, j], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, ox + (i + 0.5) * c, oy + (j + 0.5) * c));
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(ox + (p[0][0] + 0.5) * c, oy + (p[0][1] + 0.5) * c, c * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "pendulum") {
    // a cart and pole on the left, a jitter histogram on the right
    const cx = x + w * 0.27;
    const base = y + h * 0.78;
    ctx.strokeStyle = "rgba(40,30,20,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.05, base + 14);
    ctx.lineTo(x + w * 0.5, base + 14);
    ctx.stroke();
    ctx.strokeRect(cx - 34, base - 18, 68, 28);
    ctx.beginPath();
    ctx.arc(cx - 20, base + 12, 6, 0, Math.PI * 2);
    ctx.arc(cx + 20, base + 12, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#b03b16";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, base - 18);
    ctx.lineTo(cx + h * 0.22, y + h * 0.16);
    ctx.stroke();
    ctx.fillStyle = "#b03b16";
    ctx.beginPath();
    ctx.arc(cx + h * 0.22, y + h * 0.16, 9, 0, Math.PI * 2);
    ctx.fill();
    const hx = x + w * 0.56;
    const hw = w * 0.38;
    const bars = [2, 5, 11, 22, 34, 26, 14, 7, 3, 2, 1];
    bars.forEach((v, i) => {
      ctx.fillStyle = i === 4 ? "#233f7a" : "rgba(35,63,122,0.55)";
      const bh = (v / 34) * h * 0.66;
      ctx.fillRect(hx + (i * hw) / bars.length, base + 14 - bh, hw / bars.length - 3, bh);
    });
  } else {
    // a flock: chevrons in loose formation, with velocity ticks
    const r = rng(2024);
    for (let i = 0; i < 26; i++) {
      const px = x + w * (0.12 + 0.76 * r());
      const py = y + h * (0.18 + 0.64 * r());
      const a = -0.5 + r() * 0.3;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.fillStyle = i % 9 === 0 ? "#b03b16" : "rgba(35,40,60,0.75)";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(35,63,122,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(30, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function paperSheet(title: string, venue: string, fig: Figure, seed: number, w = 2.8, d = 3.9, px = 1100) {
  const g = new THREE.Group();
  const shade = mat(0xece4d4, { rough: 0.95 });
  add(g, rbox(w, 0.025, d, 0.006), shade, 0.06, 0.0125, 0.05, 0, 0.03, 0);
  add(g, rbox(w, 0.025, d, 0.006), shade, -0.03, 0.0375, 0.02, 0, -0.02, 0);
  add(g, rbox(w, 0.025, d, 0.006), mat(PAL.paper, { rough: 0.95 }), 0, 0.0625, 0);
  const sheet = printed(w - 0.02, d - 0.02, px, (ctx, cw, ch) => {
    paperFill(ctx, cw, ch, "#f8f3e8", seed);
    const m = cw * 0.09;
    ctx.fillStyle = "#16110c";
    ctx.textAlign = "center";
    ctx.font = `${Math.round(cw * 0.07)}px ${FONT_SERIF}`;
    let y = wrapText(ctx, title, cw / 2, ch * 0.1, cw - m * 1.8, cw * 0.074);
    ctx.font = `500 ${Math.round(cw * 0.028)}px ${FONT_SANS}`;
    ctx.fillStyle = "#5a4a3c";
    ctx.fillText(venue, cw / 2, y + cw * 0.01);
    y += cw * 0.06;
    ctx.textAlign = "left";
    ctx.font = `600 ${Math.round(cw * 0.026)}px ${FONT_SANS}`;
    ctx.fillStyle = "#2a2119";
    ctx.fillText("Abstract", m * 1.6, y + cw * 0.02);
    textLines(ctx, m * 1.6, y + cw * 0.045, cw - m * 3.2, 5, cw * 0.026, seed + 1);
    y += cw * 0.2;
    const colW = (cw - m * 2 - cw * 0.04) / 2;
    const figH = ch * 0.24;
    drawFigure(ctx, fig, m, y, colW, figH);
    textLines(ctx, m, y + figH + cw * 0.03, colW, Math.floor((ch - (y + figH) - m * 1.3) / (cw * 0.026)), cw * 0.026, seed + 2);
    textLines(ctx, m + colW + cw * 0.04, y, colW, Math.floor((ch - y - m * 1.3) / (cw * 0.026)), cw * 0.026, seed + 3);
    ctx.fillStyle = "rgba(60,50,40,0.5)";
    ctx.font = `500 ${Math.round(cw * 0.022)}px ${FONT_SANS}`;
    ctx.textAlign = "center";
    ctx.fillText("1", cw / 2, ch - m * 0.55);
  }, { rough: 0.92 });
  sheet.position.y = 0.0755;
  sheet.userData.noBake = true;
  g.add(sheet);
  add(g, rbox(0.3, 0.02, 0.045, 0.008), mat(PAL.steel, { metal: 0.9, rough: 0.3 }), -w / 2 + 0.28, 0.085, -d / 2 + 0.28, 0, Math.PI / 4, 0);
  bake(g, [sheet]);
  return g;
}

function fountainPen() {
  const pen = new THREE.Group();
  const lacquer = mat(0x1d2a48, { rough: 0.22 });
  const gold = mat(PAL.gold, { metal: 1, rough: 0.25 });
  add(pen, cyl(0.1, 0.09, 1.9, 20), lacquer, 0, 0, 0, 0, 0, Math.PI / 2);
  add(pen, cyl(0.108, 0.108, 1.05, 20), lacquer, -1.3, 0, 0, 0, 0, Math.PI / 2);
  add(pen, cyl(0.112, 0.112, 0.07, 20), gold, -0.8, 0, 0, 0, 0, Math.PI / 2);
  add(pen, rbox(0.85, 0.035, 0.06, 0.015), gold, -1.3, 0.12, 0);
  add(pen, new THREE.SphereGeometry(0.108, 16, 10), lacquer, -1.83, 0, 0);
  add(pen, new THREE.CylinderGeometry(0.0, 0.085, 0.36, 16), gold, 1.12, 0, 0, 0, 0, -Math.PI / 2);
  bake(pen);
  return pen;
}

export function buildCentrale(b: Build) {
  const X = STATION_X.centrale;
  const papers = new THREE.Group();
  const p1 = paperSheet("Survey of the Multi-Agent Pathfinding Solutions", "Preprint · 2021", "mapf", 41);
  p1.position.set(-1.55, 0, -0.1);
  p1.rotation.y = 0.1;
  const p2 = paperSheet("Real-time Jitter Measurements under ROS2: the Inverted Pendulum Case", "Preprint · 2021", "pendulum", 52);
  p2.position.set(1.45, 0.1, 0.15);
  p2.rotation.y = -0.08;
  papers.add(p1, p2);
  papers.position.set(X, 0, -0.9);
  prop(b, {
    id: "papers",
    name: "Two research papers",
    meta: "Centrale Nantes · preprints, 2021",
    panel: "station:centrale",
    station: "centrale",
    group: papers,
    hand: { tilt: 1.36, yaw: 0, fill: 1.0 },
    liftHeight: 0.35,
  });

  const pen = fountainPen();
  pen.position.set(X + 0.8, 0.1, 2.1);
  pen.rotation.y = 0.32;
  deco(b, pen, { opacity: 0.3 });
}

/* ------------------------------------------------------------------ 2021: the store */

function wireTexture() {
  const t = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 7;
    for (let i = 0; i <= 8; i++) {
      const p = (i * w) / 8;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }
  });
  return t;
}

export function buildCoalescent(b: Build) {
  const X = STATION_X.coalescent;
  // a toy shopping trolley
  const tr = new THREE.Group();
  const L = 2.5;
  const W = 1.7;
  const H = 1.25;
  const y0 = 0.62;
  const wire = wireTexture();
  const mesh = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.75, roughness: 0.35, alphaMap: wire, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
  wire.wrapS = wire.wrapT = THREE.RepeatWrapping;
  const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h);
  add(tr, plane(L, W), mesh, 0, y0, 0, -Math.PI / 2, 0, 0);
  add(tr, plane(L, H), mesh, 0, y0 + H / 2, W / 2);
  add(tr, plane(L, H), mesh, 0, y0 + H / 2, -W / 2);
  add(tr, plane(W, H), mesh, L / 2, y0 + H / 2, 0, 0, Math.PI / 2, 0);
  add(tr, plane(W, H), mesh, -L / 2, y0 + H / 2, 0, 0, Math.PI / 2, 0);
  const steel = mat(0xc4c7cc, { metal: 0.8, rough: 0.3 });
  const c = [V(-L / 2, 0, -W / 2), V(L / 2, 0, -W / 2), V(L / 2, 0, W / 2), V(-L / 2, 0, W / 2)];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const bq = c[(i + 1) % 4];
    rod(tr, a.clone().setY(y0), bq.clone().setY(y0), 0.035, steel);
    rod(tr, a.clone().setY(y0 + H), bq.clone().setY(y0 + H), 0.04, steel);
    rod(tr, a.clone().setY(y0), a.clone().setY(y0 + H), 0.035, steel);
    rod(tr, a.clone().setY(0.2), a.clone().setY(y0), 0.035, steel);
  }
  rod(tr, V(-L / 2, 0.2, -W / 2), V(L / 2, 0.2, -W / 2), 0.035, steel);
  rod(tr, V(-L / 2, 0.2, W / 2), V(L / 2, 0.2, W / 2), 0.035, steel);
  const tire = mat(0x252525, { rough: 0.8 });
  for (const p of c) add(tr, cyl(0.15, 0.15, 0.09, 16), tire, p.x * 0.92, 0.15, p.z * 0.92, Math.PI / 2, 0, 0);
  const red = mat(0xc23a28, { rough: 0.45 });
  rod(tr, V(-L / 2 - 0.35, y0 + H + 0.32, -W / 2), V(-L / 2 - 0.35, y0 + H + 0.32, W / 2), 0.075, red, 14);
  for (const z of [-W / 2, W / 2]) rod(tr, V(-L / 2, y0 + H, z), V(-L / 2 - 0.35, y0 + H + 0.32, z), 0.035, steel);
  bake(tr);
  tr.position.set(X - 2.0, 0, 0.7);
  tr.rotation.y = 0.42;
  prop(b, {
    id: "trolley",
    name: "Toy shopping trolley",
    meta: "Coalescent, Odense · 2021–2022",
    panel: "station:coalescent",
    station: "coalescent",
    group: tr,
    hand: { tilt: 0.42, yaw: -0.5, fill: 0.8 },
  });

  // a little in-store robot
  const bot = new THREE.Group();
  add(bot, rbox(1.5, 0.36, 1.3, 0.16), mat(0x34373b, { rough: 0.5 }), 0, 0.18, 0);
  add(bot, rbox(1.3, 1.85, 1.12, 0.32), mat(0xf3f0e9, { rough: 0.4 }), 0, 0.36 + 0.92, 0);
  add(bot, rbox(1.32, 0.1, 1.14, 0.05), mat(0xb03b16, { rough: 0.5 }), 0, 0.95, 0);
  const head = new THREE.Group();
  head.position.y = 2.2;
  add(head, rbox(1.34, 0.36, 1.16, 0.16), mat(0x1c2730, { rough: 0.15, metal: 0.2 }), 0, 0, 0);
  add(head, rbox(1.12, 0.22, 0.95, 0.1), mat(0xf3f0e9, { rough: 0.4 }), 0, 0.27, 0);
  add(head, cyl(0.26, 0.28, 0.22, 24), mat(0x2a2c2f, { rough: 0.35 }), 0, 0.48, 0);
  const eyes = new THREE.MeshBasicMaterial({ color: 0x8fe7ff, toneMapped: false });
  for (const s of [-0.24, 0.24]) {
    const e = add(head, new THREE.CircleGeometry(0.065, 16), eyes, s, 0.0, 0.585);
    e.castShadow = false;
  }
  bake(head);
  bot.add(head);
  bake(bot, [head]);
  bot.position.set(X + 2.4, 0, -1.6);
  bot.rotation.y = -0.35;
  let look = 0;
  prop(b, {
    id: "storebot",
    name: "In-store robot",
    meta: "Coalescent, Odense · 2021–2022",
    panel: "station:coalescent",
    station: "coalescent",
    group: bot,
    hand: { tilt: 0.2, yaw: 0.3, fill: 0.75 },
    tick: (_t, dt, st) => {
      const target = st.hover && !st.reduced ? -0.75 : 0;
      look += (target - look) * Math.min(1, dt * 6);
      head.rotation.y = look;
      return Math.abs(target - look) > 0.002;
    },
  });
}

/* ------------------------------------------------------------------ 2022: many robots */

export function buildTii(b: Build) {
  const X = STATION_X.tii;
  const drone = new THREE.Group();
  const shell = mat(0x2d2f33, { rough: 0.42 });
  add(drone, rbox(1.05, 0.34, 1.4, 0.14), shell, 0, 0.42, 0);
  add(drone, rbox(0.82, 0.12, 1.06, 0.06), mat(0x3d4046, { rough: 0.35 }), 0, 0.63, 0);
  add(drone, rbox(0.56, 0.03, 1.42, 0.01), mat(0xb03b16, { rough: 0.6 }), 0, 0.6, 0);
  const arm = mat(0x26282b, { rough: 0.5 });
  const motorM = mat(0x46494e, { metal: 0.6, rough: 0.35 });
  const propM = mat(0xdadcdf, { rough: 0.35 });
  const motors: THREE.Group[] = [];
  const R = 1.2;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const end = V(sx * R, 0.45, sz * R);
    rod(drone, V(sx * 0.3, 0.45, sz * 0.3), end, 0.07, arm, 10);
    add(drone, cyl(0.17, 0.17, 0.22, 20), motorM, end.x, 0.56, end.z);
    rod(drone, V(sx * 0.3, 0.3, sz * 0.4), V(sx * 0.42, 0.0, sz * 0.62), 0.03, arm, 6);
    const pg = new THREE.Group();
    pg.position.set(end.x, 0.7, end.z);
    add(pg, rbox(1.12, 0.025, 0.13, 0.012), propM, 0, 0, 0);
    add(pg, cyl(0.06, 0.06, 0.06, 12), motorM, 0, 0.02, 0);
    pg.rotation.y = sx * sz * 0.6;
    drone.add(pg);
    motors.push(pg);
  }
  add(drone, new THREE.SphereGeometry(0.16, 16, 12), mat(0x151515, { rough: 0.3 }), 0, 0.22, 0.6);
  add(drone, cyl(0.07, 0.07, 0.05, 16), mat(0x5e7f9a, { rough: 0.05, metal: 0.4 }), 0, 0.22, 0.75, Math.PI / 2, 0, 0);
  bake(drone, motors);
  drone.position.set(X - 1.6, 0, -0.9);
  drone.rotation.y = 0.5;
  let spin = 0;
  prop(b, {
    id: "drone",
    name: "Quadcopter",
    meta: "TII, Abu Dhabi · 2022–2024",
    panel: "station:tii",
    station: "tii",
    group: drone,
    hand: { tilt: 0.55, yaw: 0.3, fill: 0.85 },
    liftHeight: 0.9,
    tick: (_t, dt, st) => {
      const target = (st.hover || st.held) && !st.reduced ? 26 : 0;
      spin += (target - spin) * Math.min(1, dt * 2.5);
      motors.forEach((m, i) => (m.rotation.y += spin * dt * (i % 3 === 0 ? 1 : -1)));
      return spin > 0.05 || target > 0;
    },
  });

  const iros = paperSheet("Decentralized Acceleration-Based Bird-Inspired Flocking", "IEEE/RSJ IROS 2024", "flock", 77);
  iros.position.set(X + 2.3, 0, 0.2);
  iros.rotation.y = -0.12;
  prop(b, {
    id: "iros",
    name: "The IROS 2024 paper",
    meta: "Bird-inspired flocking",
    panel: "station:tii",
    station: "tii",
    group: iros,
    hand: { tilt: 1.34, yaw: 0, fill: 0.95 },
    liftHeight: 0.35,
  });
}

/* ------------------------------------------------------------------ 2024: the team */

function stickyNote(color: string, big: string, small: string, seed: number) {
  const tex = canvasTex(512, 512, (ctx, w, h) => {
    paperFill(ctx, w, h, color, seed);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,0.18)");
    g.addColorStop(0.16, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(120,80,20,0.12)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#231a12";
    ctx.textAlign = "center";
    ctx.font = `italic ${big.length > 6 ? 112 : 170}px ${FONT_SERIF}`;
    ctx.fillText(big, w / 2, h * 0.5);
    ctx.font = `italic 74px ${FONT_SERIF}`;
    ctx.fillText(small, w / 2, h * 0.75);
    ctx.strokeStyle = "rgba(35,26,18,0.75)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    const y = h * 0.82;
    ctx.moveTo(w * 0.24, y);
    ctx.quadraticCurveTo(w * 0.5, y + 10, w * 0.76, y - 4);
    ctx.stroke();
  });
  const geo = new THREE.PlaneGeometry(1.95, 1.95, 1, 12).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > 0.35) pos.setY(i, Math.pow(z - 0.35, 2) * 0.22);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(0xffffff, { map: tex, rough: 0.8, side: THREE.DoubleSide }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildLead(b: Build) {
  const X = STATION_X.lead;
  const notes = new THREE.Group();
  const n1 = stickyNote("#f6dc6c", "−74%", "onboard CPU", 3);
  n1.position.set(-1.25, 0.012, -0.85);
  n1.rotation.y = 0.07;
  const n2 = stickyNote("#f5b38c", "−52%", "bandwidth", 4);
  n2.position.set(1.0, 0.016, -1.05);
  n2.rotation.y = -0.09;
  const n3 = stickyNote("#bfe2c6", "team of 9", "engineers", 5);
  n3.position.set(-0.1, 0.02, 1.15);
  n3.rotation.y = 0.04;
  notes.add(n1, n2, n3);
  notes.position.set(X - 0.4, 0, -0.5);
  prop(b, {
    id: "notes",
    name: "Three sticky notes",
    meta: "TII team lead · 2024–2026",
    panel: "station:lead",
    station: "lead",
    group: notes,
    hand: { tilt: 1.2, yaw: 0, fill: 0.95 },
    blob: { opacity: 0.22, scale: 1.0 },
    liftHeight: 0.3,
  });

  // a pen cup
  const cup = new THREE.Group();
  add(cup, lathe([[0, 0], [0.6, 0], [0.62, 0.05], [0.62, 1.5], [0.56, 1.5], [0.56, 0.08], [0, 0.08]], 32), mat(0x3e5b4a, { rough: 0.5 }));
  const pens = [mat(0x1d2a48, { rough: 0.3 }), mat(0xb03b16, { rough: 0.4 }), mat(0x222222, { rough: 0.4 }), mat(0xe2a92e, { rough: 0.5 })];
  const pr = rng(9);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    const base = V(Math.cos(a) * 0.25, 0.1, Math.sin(a) * 0.25);
    const top = V(Math.cos(a) * 0.6, 2.2 + pr() * 0.5, Math.sin(a) * 0.6);
    rod(cup, base, top, 0.07, pens[i % 4], 8);
  }
  bake(cup);
  cup.position.set(X + 3.2, 0, -2.6);
  deco(b, cup, { round: true, scale: 1.2, opacity: 0.4 });

  // a whiteboard marker
  const mk = new THREE.Group();
  add(mk, cyl(0.13, 0.13, 1.5, 18), mat(0xf2f0ea, { rough: 0.5 }), 0, 0, 0, 0, 0, Math.PI / 2);
  add(mk, cyl(0.14, 0.14, 0.55, 18), mat(0x233f7a, { rough: 0.45 }), -0.95, 0, 0, 0, 0, Math.PI / 2);
  bake(mk);
  mk.position.set(X + 2.9, 0.13, 1.7);
  mk.rotation.y = -0.6;
  deco(b, mk, { opacity: 0.3 });
}

/* ------------------------------------------------------------------ 2024: say it */

export function buildUnchained(b: Build) {
  const X = STATION_X.unchained;
  const mic = new THREE.Group();
  const dark = mat(0x26282b, { metal: 0.4, rough: 0.4 });
  add(mic, cyl(0.6, 0.68, 0.16, 40), mat(0x2c2e31, { metal: 0.3, rough: 0.55 }), 0, 0.08, 0);
  add(mic, cyl(0.06, 0.06, 1.6, 12), mat(0xa9acb1, { metal: 0.9, rough: 0.3 }), 0, 0.95, 0);
  const capsule = new THREE.Group();
  capsule.position.set(0, 2.15, 0);
  capsule.rotation.x = 0.35;
  const grille = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#8d9095";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#3b3d41";
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < w; x += 8) ctx.fillRect(x, y, 4, 4);
  });
  grille.wrapS = grille.wrapT = THREE.RepeatWrapping;
  grille.repeat.set(6, 3);
  add(capsule, new THREE.CapsuleGeometry(0.44, 0.9, 8, 24), mat(0xffffff, { map: grille, metal: 0.6, rough: 0.5 }), 0, 0.25, 0);
  add(capsule, cyl(0.46, 0.46, 0.2, 32), dark, 0, -0.05, 0);
  add(capsule, new THREE.TorusGeometry(0.56, 0.05, 8, 24, Math.PI), dark, 0, -0.05, 0, 0, Math.PI / 2, Math.PI);
  mic.add(capsule);
  bake(mic);
  mic.position.set(X - 1.9, 0, -1.6);
  mic.rotation.y = 0.6;
  prop(b, {
    id: "mic",
    name: "Microphone",
    meta: "Unchained Labs · Kymatics",
    panel: "station:unchained",
    station: "unchained",
    group: mic,
    hand: { tilt: 0.3, yaw: 0.4, fill: 0.75 },
    blob: { round: true, scale: 1.1 },
  });

  const cable = new THREE.Group();
  const s0 = mic.position.clone().add(V(-0.3, 0.06, -0.7));
  add(cable, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([s0, s0.clone().add(V(-0.7, 0, -0.9)), s0.clone().add(V(-0.2, 0, -2.2)), s0.clone().add(V(1.2, 0, -2.6)), s0.clone().add(V(2.6, 0, -3.6)), s0.clone().add(V(2.2, 0, -5.2))]), 80, 0.055, 6), mat(0x1f1f21, { rough: 0.6 }));
  cable.traverse((o) => (o.castShadow = true));
  bake(cable);
  b.scene.add(cable);
  b.deco.push(cable);

  // a notepad: a voice, a graph of agents, a queue of jobs
  const pad = new THREE.Group();
  add(pad, rbox(2.7, 0.05, 3.6, 0.03), mat(0xa47b4f, { rough: 0.9 }), 0, 0.025, 0);
  add(pad, rbox(2.62, 0.1, 3.48, 0.02), mat(0xf1eadc, { rough: 0.95 }), 0, 0.1, 0.03);
  const page = printed(2.58, 3.38, 720, (ctx, w, h) => {
    paperFill(ctx, w, h, "#fbf7ee", 88);
    ctx.strokeStyle = "rgba(90,140,200,0.35)";
    ctx.lineWidth = 2;
    for (let y = h * 0.14; y < h; y += h * 0.045) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(200,70,50,0.45)";
    ctx.beginPath();
    ctx.moveTo(w * 0.12, 0);
    ctx.lineTo(w * 0.12, h);
    ctx.stroke();
    const pen = "#233f7a";
    ctx.strokeStyle = pen;
    ctx.fillStyle = pen;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // a voice
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const x = w * 0.2 + (i / 60) * w * 0.6;
      const env = Math.sin((i / 60) * Math.PI);
      ctx.lineTo(x, h * 0.19 + Math.sin(i * 1.3) * env * h * 0.045 * (0.6 + 0.4 * Math.sin(i * 0.37)));
    }
    ctx.stroke();
    const arrow = (x: number, y0: number, y1: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.moveTo(x - 14, y1 - 16);
      ctx.lineTo(x, y1);
      ctx.lineTo(x + 14, y1 - 16);
      ctx.stroke();
    };
    arrow(w * 0.5, h * 0.27, h * 0.34);
    // a graph of agents
    const nodes = [[0.5, 0.4], [0.3, 0.5], [0.7, 0.49], [0.4, 0.6], [0.62, 0.61]].map(([x, y]) => [x * w, y * h]);
    const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [1, 2]];
    ctx.lineWidth = 4;
    for (const [a, bq] of edges) {
      ctx.beginPath();
      ctx.moveTo(nodes[a][0], nodes[a][1]);
      ctx.lineTo(nodes[bq][0], nodes[bq][1]);
      ctx.stroke();
    }
    nodes.forEach(([x, y], i) => {
      ctx.fillStyle = "#fbf7ee";
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (i === 0) {
        ctx.fillStyle = "#b03b16";
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    arrow(w * 0.5, h * 0.67, h * 0.74);
    // a queue of jobs
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      const y = h * 0.77 + i * h * 0.05;
      ctx.strokeRect(w * 0.28, y, w * 0.44, h * 0.038);
      if (i < 2) {
        ctx.beginPath();
        ctx.moveTo(w * 0.31, y + h * 0.02);
        ctx.lineTo(w * 0.33, y + h * 0.03);
        ctx.lineTo(w * 0.36, y + h * 0.008);
        ctx.stroke();
      }
    }
  });
  page.position.y = 0.152;
  page.userData.noBake = true;
  pad.add(page);
  const ring = mat(0xb9bcc1, { metal: 0.9, rough: 0.3 });
  for (let i = 0; i < 11; i++) add(pad, new THREE.TorusGeometry(0.12, 0.022, 6, 14), ring, -1.1 + i * 0.22, 0.12, -1.72, 0, Math.PI / 2, 0);
  bake(pad, [page]);
  pad.position.set(X + 1.5, 0, 0.1);
  pad.rotation.y = -0.1;
  prop(b, {
    id: "notepad",
    name: "Notepad: voice → graph → jobs",
    meta: "Kymatics · 2024–now",
    panel: "station:unchained",
    station: "unchained",
    group: pad,
    hand: { tilt: 1.2, yaw: 0, fill: 0.95 },
    liftHeight: 0.35,
  });
}

/* ------------------------------------------------------------------ 2026: sirb */

function paperBird() {
  // a folded paper bird seen from above: a swept chevron with a keel, flat-shaded so the folds catch the light
  const p: Record<string, number[]> = {
    nose: [0, 0.34, 0.78],
    notch: [0, 0.4, -0.12],
    keel: [0, 0.02, 0.18],
    wl: [-0.95, 0.66, -0.62],
    wr: [0.95, 0.66, -0.62],
  };
  const tri = (a: string, b: string, c: string) => [...p[a], ...p[b], ...p[c]];
  const pos = [...tri("nose", "notch", "wl"), ...tri("nose", "wr", "notch"), ...tri("nose", "keel", "notch"), ...tri("nose", "notch", "keel")];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildSirb(b: Build) {
  const X = STATION_X.sirb;
  const badge = new THREE.Group();
  add(badge, rbox(2.35, 0.06, 3.35, 0.14), mat(0xfbfaf7, { rough: 0.35 }), 0, 0.03, 0);
  const face = printed(2.25, 3.25, 720, (ctx, w, h) => {
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#18222f";
    ctx.fillRect(0, 0, w, h * 0.19);
    ctx.fillStyle = "#f6f1e6";
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(w * 0.085)}px ${FONT_SANS}`;
    ctx.fillText("UMEX 2026", w / 2, h * 0.125);
    ctx.fillStyle = "#18222f";
    ctx.font = `700 ${Math.round(w * 0.12)}px ${FONT_SANS}`;
    ctx.fillText("SIRB.AI", w / 2, h * 0.31);
    const r = w * 0.2;
    const cy = h * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (b.avatar) ctx.drawImage(b.avatar, w / 2 - r, cy - r, r * 2, r * 2);
    else {
      ctx.fillStyle = "#d9cdb8";
      ctx.fillRect(w / 2 - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.strokeStyle = "#b03b16";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, cy, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#1f1914";
    ctx.font = `${Math.round(w * 0.11)}px ${FONT_SERIF}`;
    ctx.fillText("Erwin Lejeune", w / 2, h * 0.76);
    ctx.fillStyle = "#5a4a3c";
    ctx.font = `500 ${Math.round(w * 0.055)}px ${FONT_SANS}`;
    ctx.fillText("Head of Robotics", w / 2, h * 0.83);
    ctx.fillStyle = "#b03b16";
    ctx.fillRect(0, h * 0.93, w, h * 0.07);
  }, { rough: 0.4 });
  face.position.y = 0.062;
  face.userData.noBake = true;
  badge.add(face);
  const clip = mat(0xc4c7cc, { metal: 0.9, rough: 0.28 });
  add(badge, rbox(0.55, 0.07, 0.4, 0.05), clip, 0, 0.08, -1.72);
  add(badge, new THREE.TorusGeometry(0.17, 0.035, 8, 20), clip, 0, 0.06, -2.02, Math.PI / 2, 0, 0);
  bake(badge, [face]);
  badge.position.set(X - 1.2, 0, 0.9);
  badge.rotation.y = 0.1;
  prop(b, {
    id: "badge",
    name: "UMEX 2026 badge",
    meta: "SIRB.AI · Head of Robotics",
    panel: "station:sirb",
    station: "sirb",
    group: badge,
    hand: { tilt: 1.34, yaw: 0, fill: 0.95 },
    liftHeight: 0.35,
  });

  // its lanyard, coiled on the desk
  const ly = canvasTex(512, 64, (ctx, w, h) => {
    ctx.fillStyle = "#18222f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e9e2d2";
    ctx.font = `700 ${Math.round(h * 0.5)}px ${FONT_SANS}`;
    ctx.textBaseline = "middle";
    for (let x = 10; x < w; x += 190) ctx.fillText("SIRB.AI", x, h / 2 + 2);
  });
  ly.wrapS = THREE.RepeatWrapping;
  ly.repeat.set(1 / 8, 1);
  const o = badge.position;
  const lan = new THREE.Mesh(
    ribbon(
      [V(0, 0.03, -2.05), V(0.4, 0.03, -2.9), V(1.5, 0.03, -3.5), V(3.0, 0.03, -3.0), V(3.4, 0.03, -1.6), V(2.6, 0.03, -0.6), V(1.6, 0.03, -1.3), V(1.0, 0.03, -2.4), V(0.2, 0.03, -2.1)].map((p) => p.add(o)),
      0.3,
      120,
    ),
    mat(0xffffff, { map: ly, rough: 0.7, side: THREE.DoubleSide }),
  );
  lan.receiveShadow = true;
  lan.castShadow = false;
  b.scene.add(lan);
  b.deco.push(lan);

  // sirb is Arabic for a flock: five paper birds, flying for the window
  const flock = new THREE.Group();
  const birdGeo = paperBird();
  const paperM = new THREE.MeshStandardMaterial({ color: 0xf6f0e3, roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
  const slots = [[0, -1.3], [-0.95, -0.45], [0.95, -0.45], [-1.9, 0.4], [1.9, 0.4]];
  const birds = slots.map(([x, z], i) => {
    const m = new THREE.Mesh(birdGeo, i === 0 ? mat(0xb03b16, { rough: 0.8, side: THREE.DoubleSide }) : paperM);
    m.position.set(x, 0, z);
    m.rotation.y = Math.PI;
    m.scale.setScalar(i === 0 ? 1.05 : 0.9);
    m.castShadow = true;
    m.receiveShadow = true;
    flock.add(m);
    return m;
  });
  flock.position.set(X + 2.6, 0, -1.5);
  flock.rotation.y = 0.15;
  let rise = 0;
  prop(b, {
    id: "flock",
    name: "A paper flock",
    meta: "سرب, sirb: a flock",
    panel: "station:sirb",
    station: "sirb",
    group: flock,
    hand: { tilt: 0.65, yaw: 0, fill: 0.85 },
    liftHeight: 0.25,
    blob: { opacity: 0.25 },
    tick: (t, dt, st) => {
      const target = (st.hover || st.held) && !st.reduced ? 1 : 0;
      rise += (target - rise) * Math.min(1, dt * 3);
      birds.forEach((m, i) => {
        const k = Math.max(0, Math.min(1, rise * 1.6 - i * 0.12));
        m.position.y = k * (0.5 + 0.12 * Math.sin(t * 3 + i));
        m.rotation.z = k * 0.12 * Math.sin(t * 4 + i * 1.3);
      });
      return Math.abs(target - rise) > 0.002 || target > 0;
    },
  });
}
