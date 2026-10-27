import {
  BoxGeometry,
  CircleGeometry,
  CubicBezierCurve3,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C, canvasTexture, col, Level, ramp, rng, sstep } from "./kit";
import type { Frame, TagSpec } from "./kit";
import { CELL_UM, maze, N } from "./mazegen";
import { O_DIE, O_MAZE, O_PKG } from "./world";

/** die size and the blocks drawn on it (mm, from the die's centre) */
const DIE = 2.6;
const WIN = 2.8; // half-size of the decapped window
type Rect = [number, number, number, number]; // x0, y0, x1, y1
const MAZE_C = [(O_MAZE[0] - O_DIE[0]) * 1000, (O_MAZE[1] - O_DIE[1]) * 1000];
const MAZE_HALF = (N * CELL_UM) / 2000;
const BLOCKS: { name: string; r: Rect; kind: "flash" | "sram" | "logic" | "core"; tint: string; label?: string }[] = [
  { name: "flash", r: [-1.05, 0.25, -0.05, 1.05], kind: "flash", tint: "#565a80" },
  { name: "sram", r: [0.05, 0.35, 1.05, 1.05], kind: "sram", tint: "#5f507c" },
  { name: "core", r: [MAZE_C[0] - MAZE_HALF - 0.06, MAZE_C[1] - MAZE_HALF - 0.06, MAZE_C[0] + MAZE_HALF + 0.06, MAZE_C[1] + MAZE_HALF + 0.06], kind: "core", tint: "#4f4466", label: "Core" },
  { name: "tim", r: [-1.05, -0.15, -0.6, 0.2], kind: "logic", tint: "#5d4f73", label: "TIM" },
  { name: "i2c", r: [-1.05, -0.58, -0.6, -0.22], kind: "logic", tint: "#55506f", label: "I2C" },
  { name: "can", r: [-0.53, -0.58, -0.14, 0.2], kind: "logic", tint: "#5a4a6e", label: "CAN" },
  { name: "usart", r: [0.7, -0.58, 1.05, 0.28], kind: "logic", tint: "#585275", label: "USART" },
  { name: "gpio", r: [-1.05, -1.05, 1.05, -0.68], kind: "logic", tint: "#534c6c", label: "GPIO" },
];

function drawDie(S: number) {
  const r = rng(32);
  return canvasTexture(S, (g) => {
    const X = (mm: number) => ((mm + DIE / 2) / DIE) * S;
    const Y = (mm: number) => ((DIE / 2 - mm) / DIE) * S;
    const L = (mm: number) => (mm / DIE) * S;
    g.fillStyle = C.die;
    g.fillRect(0, 0, S, S);
    // the pad ring
    g.fillStyle = "#3e3852";
    g.fillRect(0, 0, S, L(0.22));
    g.fillRect(0, S - L(0.22), S, L(0.22));
    g.fillRect(0, 0, L(0.22), S);
    g.fillRect(S - L(0.22), 0, L(0.22), S);
    g.strokeStyle = "rgba(207,152,98,0.65)";
    g.lineWidth = L(0.012);
    g.strokeRect(L(0.03), L(0.03), S - L(0.06), S - L(0.06));
    for (let k = 0; k < 4; k++)
      for (let i = 0; i < 16; i++) {
        const u = -1.1 + (2.2 * i) / 15;
        const o = 1.3 - 0.12;
        const [x, y] = k === 0 ? [u, o] : k === 1 ? [o, -u] : k === 2 ? [-u, -o] : [-o, u];
        g.fillStyle = "#6d6487";
        const io = k % 2 ? [0.16, 0.07] : [0.07, 0.16];
        g.fillRect(X(x - (io[0] * 1.6) / 2), Y(y + (io[1] * 1.6) / 2), L(io[0] * 1.6), L(io[1] * 1.6));
        g.fillStyle = C.gold;
        g.fillRect(X(x - 0.045), Y(y + 0.045), L(0.09), L(0.09));
      }
    // power straps between blocks
    g.fillStyle = "rgba(207,152,98,0.18)";
    for (let x = -1.0; x < 1.05; x += 0.33) g.fillRect(X(x), Y(1.08), L(0.022), L(2.16));
    for (let y = -1.0; y < 1.05; y += 0.41) g.fillRect(X(-1.08), Y(y), L(2.16), L(0.018));
    const m = maze();
    for (const b of BLOCKS) {
      const [x0, y0, x1, y1] = b.r;
      g.fillStyle = b.tint;
      g.fillRect(X(x0), Y(y1), L(x1 - x0), L(y1 - y0));
      g.save();
      g.beginPath();
      g.rect(X(x0), Y(y1), L(x1 - x0), L(y1 - y0));
      g.clip();
      if (b.kind === "flash" || b.kind === "sram") {
        // memory arrays: a dense, regular weave
        const p = b.kind === "flash" ? 0.0075 : 0.011;
        g.fillStyle = "rgba(240,232,214,0.10)";
        for (let y = y0; y < y1; y += p) g.fillRect(X(x0), Y(y), L(x1 - x0), Math.max(1, L(p * 0.35)));
        g.fillStyle = "rgba(207,152,98,0.30)";
        for (let x = x0 + 0.03; x < x1; x += 0.065) g.fillRect(X(x), Y(y1), Math.max(1, L(0.006)), L(y1 - y0));
        // decoder strip
        g.fillStyle = "rgba(20,16,30,0.25)";
        g.fillRect(X(x0), Y(y1), L(0.06), L(y1 - y0));
      } else if (b.kind === "logic") {
        // standard-cell rows of random widths, then some routing on top
        const rh = 0.012;
        for (let y = y0; y < y1; y += rh) {
          let x = x0;
          while (x < x1) {
            const w = 0.006 + r() * 0.03;
            g.fillStyle = `rgba(${r() < 0.5 ? "240,232,214" : "20,16,30"},${(0.05 + r() * 0.12).toFixed(3)})`;
            g.fillRect(X(x), Y(y + rh * 0.9), L(w * 0.92), L(rh * 0.8));
            x += w;
          }
        }
        g.strokeStyle = "rgba(207,152,98,0.42)";
        g.lineWidth = Math.max(1, L(0.004));
        for (let i = 0; i < 26; i++) {
          let x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
          g.beginPath();
          g.moveTo(X(x), Y(y));
          for (let k = 0; k < 3; k++) {
            if (k % 2) y = Math.min(y1, Math.max(y0, y + (r() - 0.5) * 0.25));
            else x = Math.min(x1, Math.max(x0, x + (r() - 0.5) * 0.3));
            g.lineTo(X(x), Y(y));
          }
          g.stroke();
        }
      } else {
        // the core: the same maze the last level draws in full, at this coarse scale
        const c = CELL_UM / 1000, ox = MAZE_C[0] - MAZE_HALF, oy = MAZE_C[1] - MAZE_HALF;
        g.fillStyle = "rgba(207,152,98,0.78)";
        const w = Math.max(1, L(c * 0.2));
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            const i = y * N + x;
            if (m.east[i] || x === N - 1) g.fillRect(X(ox + (x + 1) * c) - w / 2, Y(oy + (y + 1) * c) - w / 2, w, L(c) + w);
            if (m.north[i] || y === N - 1) g.fillRect(X(ox + x * c) - w / 2, Y(oy + (y + 1) * c) - w / 2, L(c) + w, w);
            if (x === 0) g.fillRect(X(ox) - w / 2, Y(oy + (y + 1) * c) - w / 2, w, L(c) + w);
            if (y === 0) g.fillRect(X(ox + x * c) - w / 2, Y(oy) - w / 2, L(c) + w, w);
          }
      }
      g.restore();
      g.strokeStyle = "rgba(240,232,214,0.32)";
      g.lineWidth = Math.max(1, L(0.006));
      g.strokeRect(X(x0), Y(y1), L(x1 - x0), L(y1 - y0));
    }
  });
}

function drawFrame() {
  // the cavity floor: the lead frame's fingers reaching in toward a silver paddle
  return canvasTexture(1024, (g, S) => {
    const X = (mm: number) => ((mm + WIN) / (2 * WIN)) * S;
    const Y = (mm: number) => ((WIN - mm) / (2 * WIN)) * S;
    g.fillStyle = "#2a2826";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#a7a49c";
    g.fillRect(X(-1.6), Y(1.6), X(1.6) - X(-1.6), Y(-1.6) - Y(1.6));
    g.fillStyle = "#c9a65c";
    for (let k = 0; k < 4; k++)
      for (let i = 0; i < 16; i++) {
        const u = -1.1 + (2.2 * i) / 15;
        const tip = u * 1.55, out = u * 2.25;
        const pts: [number, number][] = [
          [tip - 0.06, 2.15],
          [tip + 0.06, 2.15],
          [out + 0.12, 2.9],
          [out - 0.12, 2.9],
        ];
        g.beginPath();
        pts.forEach(([a, o], j) => {
          const [x, y] = k === 0 ? [a, o] : k === 1 ? [o, -a] : k === 2 ? [-a, -o] : [-o, a];
          if (j) g.lineTo(X(x), Y(y));
          else g.moveTo(X(x), Y(y));
        });
        g.closePath();
        g.fill();
      }
  });
}

/**
 * The microcontroller: a 64-pin package that decaps as you zoom, showing gold
 * bond wires and the die, whose floorplan has the five peripherals he modelled.
 */
export class Chip extends Level {
  private lid: Mesh<PlaneGeometry, MeshToonMaterial>;

  constructor(mobile: boolean) {
    super(-3, O_PKG, -3.65, -0.9);
    const ink = new MeshToonMaterial({ color: col("#24231f"), gradientMap: ramp() });
    const body = new Shape();
    body.moveTo(-5, -5);
    body.lineTo(5, -5);
    body.lineTo(5, 5);
    body.lineTo(-5, 5);
    body.lineTo(-5, -5);
    const hole = new Path();
    hole.moveTo(-WIN, -WIN);
    hole.lineTo(-WIN, WIN);
    hole.lineTo(WIN, WIN);
    hole.lineTo(WIN, -WIN);
    hole.lineTo(-WIN, -WIN);
    body.holes.push(hole);
    this.group.add(new Mesh(new ExtrudeGeometry(body, { depth: 1.4, bevelEnabled: false }).translate(0, 0, -0.85), ink));
    const dimple = new Mesh(new CircleGeometry(0.42, 32), new MeshBasicMaterial({ color: col("#141311") }));
    dimple.position.set(-3.9, 3.9, 0.552);
    this.group.add(dimple);

    const floor = new Mesh(new PlaneGeometry(2 * WIN, 2 * WIN), new MeshBasicMaterial({ map: drawFrame() }));
    floor.position.z = -0.21;
    const die = new Mesh(new BoxGeometry(DIE, DIE, 0.2), new MeshToonMaterial({ color: col("#5b5768"), gradientMap: ramp() }));
    die.position.z = -0.1;
    const top = new Mesh(new PlaneGeometry(DIE, DIE), new MeshBasicMaterial({ map: drawDie(mobile ? 1536 : 2048) }));
    top.position.z = 0.0006;
    this.group.add(floor, die, top);

    // 64 gull-wing leads, each from three boxes
    const leads = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshToonMaterial({ color: col(C.silver), gradientMap: ramp() }), 64 * 3);
    const mt = new Matrix4(), q = new Quaternion(), zAxis = new Vector3(0, 0, 1);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      q.setFromAxisAngle(zAxis, (k * Math.PI) / 2);
      for (let i = 0; i < 16; i++) {
        const u = -3.75 + 0.5 * i;
        // in the frame of the +y side: x along the side, y outward
        const parts: [number, number, number, number, number, number][] = [
          [u, 5.25, -0.2, 0.22, 0.5, 0.15],
          [u, 5.56, -0.52, 0.22, 0.14, 0.72],
          [u, 5.95, -0.88, 0.22, 0.78, 0.13],
        ];
        for (const [x, y, z, w, h, d] of parts) {
          const p = new Vector3(x, y, z).applyQuaternion(q);
          mt.compose(p, q, new Vector3(w, h, d));
          leads.setMatrixAt(n++, mt);
        }
      }
    }
    this.group.add(leads);

    // bond wires: pad on the die to the tip of its finger
    const wires = [];
    for (let k = 0; k < 4; k++)
      for (let i = 0; i < 16; i++) {
        const u = -1.1 + (2.2 * i) / 15;
        const rot = (v: Vector3) => (k === 0 ? v : k === 1 ? new Vector3(v.y, -v.x, v.z) : k === 2 ? new Vector3(-v.x, -v.y, v.z) : new Vector3(-v.y, v.x, v.z));
        const a = rot(new Vector3(u, 1.18, 0.01));
        const b = rot(new Vector3(u * 1.55, 2.2, -0.2));
        const c1 = rot(new Vector3(u * 1.05, 1.3, 0.42));
        const c2 = rot(new Vector3(u * 1.4, 1.85, 0.36));
        wires.push(new TubeGeometry(new CubicBezierCurve3(a, c1, c2, b), 14, 0.0125, 5, false));
      }
    this.group.add(new Mesh(mergeGeometries(wires)!, new MeshToonMaterial({ color: col("#ddb862"), gradientMap: ramp() })));

    // the lid over the window, lifted off as you dive (decapping)
    this.lid = new Mesh(new PlaneGeometry(2 * WIN, 2 * WIN), new MeshToonMaterial({ color: col("#24231f"), gradientMap: ramp(), transparent: true }));
    this.lid.position.z = 0.55;
    this.group.add(this.lid);
  }

  tags(): TagSpec[] {
    return BLOCKS.filter((b) => b.label).map((b) => ({
      at: [(b.r[0] + b.r[2]) / 2, (b.r[1] + b.r[3]) / 2, 0.01],
      text: b.label!,
      sLow: -3.0,
      sHigh: -2.22,
      cls: "die",
    }));
  }

  update(fr: Frame) {
    const o = sstep(-2.32, -2.0, fr.s);
    const m = this.lid.material;
    m.opacity = o;
    m.depthWrite = o > 0.99;
    this.lid.visible = o > 0.01;
  }
}
