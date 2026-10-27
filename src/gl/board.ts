import { BoxGeometry, Color, ExtrudeGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, Path, PlaneGeometry, Quaternion, Shape, Vector3 } from "three";
import { C, canvasTexture, col, Level, ramp, rng } from "./kit";
import type { Frame, TagSpec } from "./kit";
import { MCU_ON_BOARD, O_BOARD } from "./world";

/** board size (mm) and where the microcontroller sits on it */
const B = 36;
const MX = MCU_ON_BOARD[0] * 1000, MY = MCU_ON_BOARD[1] * 1000;

interface Part {
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
  rot?: number;
  color: string;
  z?: number;
  /** silkscreen reference designator */
  ref?: string;
  /** draw gold pads at the two ends (passives) */
  ends?: boolean;
  /** a dark opening on top (connectors): x, y offset, w, h */
  open?: [number, number, number, number];
  /** leads: count per long side, pitch (mm) */
  leads?: [number, number];
}

function parts(r: () => number): Part[] {
  const P: Part[] = [
    { x: -7, y: 8, w: 3, h: 3, d: 0.9, color: "#262522", ref: "U2" },
    { x: -9.6, y: 0.4, w: 2.5, h: 2, d: 0.9, color: "#c9c5bb", ref: "U3" },
    { x: -9.8, y: -11, w: 4.9, h: 3.9, d: 1.5, color: "#262522", ref: "U4", leads: [4, 1.27] },
    { x: -11, y: 12.6, w: 2.9, h: 1.6, d: 1.1, color: "#262522", ref: "U5", leads: [3, 0.95] },
    { x: 14.3, y: 5.6, w: 3.2, h: 2.5, d: 0.8, color: "#c9c5bb", ref: "Y1" },
    { x: -1, y: 15.1, w: 8.9, h: 6.4, d: 3.2, color: "#b9b6ae", ref: "J1", open: [0, 3.1, 7.6, 0.4] },
    { x: 15.6, y: -8.4, w: 4.2, h: 6, d: 2.9, color: "#e9dfc8", ref: "J3", open: [1.9, 0, 0.4, 4.6] },
    { x: -3.5, y: -15.2, w: 8, h: 4.2, d: 2.9, color: "#e9dfc8", ref: "J4", open: [0, -1.9, 6.6, 0.4] },
    { x: 12.8, y: 10.2, w: 3, h: 2.6, d: 1.4, color: "#c9c5bb", ref: "SW1" },
    { x: 8.6, y: 13, w: 1.6, h: 0.8, d: 0.6, color: "#e05a2b", ends: true, ref: "D1" },
    { x: 8.6, y: 11, w: 1.6, h: 0.8, d: 0.6, color: "#4c9a6a", ends: true, ref: "D2" },
  ];
  // decoupling caps at the microcontroller's corners, others in tidy rows
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P.push({ x: MX + sx * 7.3, y: MY + sy * 7.3, w: 1, h: 0.5, d: 0.5, rot: Math.PI / 4 * sx * sy, color: "#c49d68", ends: true });
  const rows: [number, number, number, number, boolean][] = [
    [-12.2, 4.2, 0, 1.3, true],
    [-3.6, 7.5, 1.3, 0, false],
    [-10.2, 10.4, 1.3, 0, true],
    [14.6, 2.6, 0, -1.25, false],
    [-11.5, -4.6, 1.25, 0, true],
    [-2.6, -11, 0, 1.25, false],
    [12.8, -5.5, 0, 1.25, true],
  ];
  for (const [x0, y0, dx, dy, caps] of rows) {
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const cap = caps ? r() > 0.25 : r() > 0.75;
      P.push({ x: x0 + dx * i, y: y0 + dy * i, w: 1, h: 0.5, d: cap ? 0.5 : 0.35, rot: dx ? Math.PI / 2 : 0, color: cap ? "#c49d68" : "#22211f", ends: true });
    }
  }
  return P;
}

export class Board extends Level {
  constructor(mobile: boolean) {
    super(-3, O_BOARD, -3.1, -0.45);
    const r = rng(36);
    const list = parts(r);
    const S = mobile ? 1536 : 2048;
    const X = (mm: number) => ((mm + B / 2) / B) * S;
    const Y = (mm: number) => ((B / 2 - mm) / B) * S;
    const L = (mm: number) => (mm / B) * S;

    const tex = canvasTexture(S, (g) => {
      g.clearRect(0, 0, S, S);
      // outline with rounded corners: everything outside stays transparent
      g.save();
      g.beginPath();
      g.roundRect(X(-18), Y(18), L(36), L(36), L(2.4));
      g.clip();
      g.fillStyle = C.pcb;
      g.fillRect(0, 0, S, S);
      // a faint copper pour on the inner layer, seen through the mask
      g.strokeStyle = "rgba(255,255,255,0.03)";
      g.lineWidth = L(0.1);
      for (let k = -40; k < 40; k++) {
        g.beginPath();
        g.moveTo(X(k), Y(-18));
        g.lineTo(X(k + 36), Y(18));
        g.stroke();
      }
      g.lineCap = "round";
      g.lineJoin = "round";

      const vias: [number, number][] = [];
      const trace = (pts: [number, number][], w = 0.2, color = C.trace) => {
        g.strokeStyle = color;
        g.lineWidth = L(w);
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
        g.stroke();
      };

      // fan-out from the microcontroller's 64 pins: out, a 45-degree spread, then straight on
      const sides = [
        { o: [0, 1], t: [1, 0], room: 18 - 1.6 - (MY + 7) },
        { o: [1, 0], t: [0, -1], room: 18 - 1.6 - (MX + 7) },
        { o: [0, -1], t: [-1, 0], room: 18 - 1.6 + (MY - 7) },
        { o: [-1, 0], t: [0, 1], room: MX - 7 + 14.2 },
      ];
      for (const sd of sides) {
        const k = Math.min(2.3, 1 + (sd.room - 1.2) / 3.75);
        for (let i = 0; i < 16; i++) {
          if (r() < 0.22) continue;
          const u = -3.75 + 0.5 * i, ut = u * k, dlt = ut - u;
          const at = (out: number, along: number): [number, number] => [MX + sd.o[0] * out + sd.t[0] * along, MY + sd.o[1] * out + sd.t[1] * along];
          const free = sd.room - Math.abs(dlt);
          const run = Math.max(0.3, free * (0.35 + 0.65 * r()));
          const end = at(7.2 + Math.abs(dlt) + run, ut);
          trace([at(6.2, u), at(7.2, u), at(7.2 + Math.abs(dlt), ut), end], 0.18);
          vias.push(end);
        }
      }
      // longer runs between parts, with 45-degree bends, some on the other layer
      const walk = (x: number, y: number, n: number, dim: boolean) => {
        const pts: [number, number][] = [[x, y]];
        let dir = r() < 0.5 ? 0 : 2;
        for (let i = 0; i < n; i++) {
          const len = 1.5 + r() * 4;
          const a = (dir * Math.PI) / 4;
          x = Math.max(-16, Math.min(16, x + Math.cos(a) * len));
          y = Math.max(-16, Math.min(16, y + Math.sin(a) * len));
          pts.push([x, y]);
          dir = (dir + (r() < 0.5 ? 1 : 7)) % 8;
          if (dir % 2 === 1 && r() < 0.5) dir = (dir + 1) % 8;
        }
        trace(pts, dim ? 0.16 : 0.2, dim ? "#346a51" : C.trace);
        vias.push([x, y]);
      };
      for (let i = 0; i < 26; i++) {
        const x = -15 + r() * 14, y = -14 + r() * 28;
        if (x > MX - 8 && y < MY + 8 && y > MY - 8) continue;
        walk(x, y, 3 + Math.floor(r() * 3), r() < 0.45);
      }
      // the power rails: two wide traces
      trace([[-16.2, 7.7], [-13.5, 7.7], [-12.5, 8.7], [-12.5, 11.2]], 0.6);
      trace([[-16.2, 5.5], [-14, 5.5], [-11, 2.5], [-6, 2.5], [-3, -0.5], [MX - 7.5, -0.5]], 0.5);

      // vias: gold rings
      for (const [x, y] of vias) {
        g.fillStyle = C.gold;
        g.beginPath();
        g.arc(X(x), Y(y), L(0.3), 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#1b2c25";
        g.beginPath();
        g.arc(X(x), Y(y), L(0.14), 0, Math.PI * 2);
        g.fill();
      }
      // the microcontroller's pads
      g.fillStyle = C.gold;
      for (const sd of sides)
        for (let i = 0; i < 16; i++) {
          const u = -3.75 + 0.5 * i;
          const cx = MX + sd.o[0] * 5.9 + sd.t[0] * u, cy = MY + sd.o[1] * 5.9 + sd.t[1] * u;
          const w = sd.o[0] ? 1.2 : 0.28, h = sd.o[0] ? 0.28 : 1.2;
          g.fillRect(X(cx - w / 2), Y(cy + h / 2), L(w), L(h));
        }
      // pads under the parts
      for (const p of list) {
        g.save();
        g.translate(X(p.x), Y(p.y));
        g.rotate(-(p.rot ?? 0));
        g.fillStyle = C.gold;
        if (p.ends) {
          g.fillRect(L(-p.w / 2 - 0.15), L(-p.h / 2 - 0.05), L(0.5), L(p.h + 0.1));
          g.fillRect(L(p.w / 2 - 0.35), L(-p.h / 2 - 0.05), L(0.5), L(p.h + 0.1));
        } else g.fillRect(L(-p.w / 2 - 0.2), L(-p.h / 2 - 0.2), L(p.w + 0.4), L(p.h + 0.4));
        g.restore();
      }
      // edge pads, labelled
      const labels = ["5V", "G", "TX1", "RX1", "TX2", "RX2", "SDA", "SCL"];
      g.font = `600 ${L(0.95)}px "Geist Variable", sans-serif`;
      g.textBaseline = "middle";
      labels.forEach((t, i) => {
        const y = 7.7 - i * 2.2;
        g.fillStyle = C.gold;
        g.beginPath();
        g.roundRect(X(-17.2), Y(y + 0.75), L(1.9), L(1.5), L(0.35));
        g.fill();
        g.fillStyle = "#efe9dc";
        g.fillText(t, X(-14.9), Y(y));
      });
      // mounting holes: a gold ring around a hole straight through
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        g.fillStyle = C.gold;
        g.beginPath();
        g.arc(X(sx * 15.25), Y(sy * 15.25), L(2.3), 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = "destination-out";
        g.beginPath();
        g.arc(X(sx * 15.25), Y(sy * 15.25), L(1.6), 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = "source-over";
      }
      // silkscreen: outlines, pin-1 dots, reference designators, a forward arrow
      g.strokeStyle = "#efe9dc";
      g.fillStyle = "#efe9dc";
      g.lineWidth = L(0.13);
      g.strokeRect(X(MX - 6.6), Y(MY + 6.6), L(13.2), L(13.2));
      g.beginPath();
      g.arc(X(MX - 7.2), Y(MY + 7.2), L(0.35), 0, Math.PI * 2);
      g.fill();
      g.font = `600 ${L(1.0)}px "Geist Variable", sans-serif`;
      g.textAlign = "center";
      g.fillText("U1", X(MX + 7.6), Y(MY - 7.9));
      for (const p of list) {
        if (!p.ref) continue;
        g.save();
        g.translate(X(p.x), Y(p.y));
        g.rotate(-(p.rot ?? 0));
        if (!p.ends) g.strokeRect(L(-p.w / 2 - 0.45), L(-p.h / 2 - 0.45), L(p.w + 0.9), L(p.h + 0.9));
        g.restore();
        const below = p.y > 13 ? -p.h / 2 - 1.1 : p.h / 2 + 1.1;
        g.fillText(p.ref, X(p.x), Y(p.y + below));
      }
      g.beginPath();
      g.moveTo(X(3), Y(-16.4));
      g.lineTo(X(9), Y(-16.4));
      g.stroke();
      g.beginPath();
      g.moveTo(X(9.8), Y(-16.4));
      g.lineTo(X(8.6), Y(-15.8));
      g.lineTo(X(8.6), Y(-17));
      g.closePath();
      g.fill();
      g.textAlign = "left";
      g.fillText("FWD", X(10.4), Y(-16.4));
      g.restore();
    });

    // the board itself: a slab with rounded corners and four holes, the printed face on top
    const outline = new Shape();
    outline.moveTo(-18 + 2.4, -18);
    outline.lineTo(18 - 2.4, -18);
    outline.quadraticCurveTo(18, -18, 18, -18 + 2.4);
    outline.lineTo(18, 18 - 2.4);
    outline.quadraticCurveTo(18, 18, 18 - 2.4, 18);
    outline.lineTo(-18 + 2.4, 18);
    outline.quadraticCurveTo(-18, 18, -18, 18 - 2.4);
    outline.lineTo(-18, -18 + 2.4);
    outline.quadraticCurveTo(-18, -18, -18 + 2.4, -18);
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const h = new Path();
      h.absarc(sx * 15.25, sy * 15.25, 1.6, 0, Math.PI * 2, true);
      outline.holes.push(h);
    }
    const slab = new Mesh(new ExtrudeGeometry(outline, { depth: 1.58, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -1.6), new MeshToonMaterial({ color: col("#1f4436"), gradientMap: ramp() }));
    const face = new Mesh(new PlaneGeometry(B, B), new MeshBasicMaterial({ map: tex, alphaTest: 0.5 }));
    face.position.z = 0.002;
    this.group.add(slab, face);

    // the parts, as instanced boxes with banded shading
    const boxes: { m: Matrix4; c: Color }[] = [];
    const q = new Quaternion(), z = new Vector3(0, 0, 1);
    const box = (x: number, y: number, zb: number, w: number, h: number, d: number, rot: number, c: string) => {
      q.setFromAxisAngle(z, rot);
      boxes.push({ m: new Matrix4().compose(new Vector3(x, y, zb + d / 2), q, new Vector3(w, h, d)), c: new Color(c) });
    };
    for (const p of list) {
      const rot = p.rot ?? 0;
      if (p.ends) {
        box(p.x, p.y, 0, p.w * 0.6, p.h, p.d, rot, p.color);
        for (const s of [-1, 1]) box(p.x + Math.cos(rot) * s * p.w * 0.4, p.y + Math.sin(rot) * s * p.w * 0.4, 0, p.w * 0.2, p.h, p.d * 0.98, rot, "#d6d2c8");
      } else box(p.x, p.y, p.z ?? 0, p.w, p.h, p.d, rot, p.color);
      if (p.leads) {
        const [n, pitch] = p.leads;
        for (let i = 0; i < n; i++)
          for (const s of [-1, 1]) {
            const ox = (i - (n - 1) / 2) * pitch;
            box(p.x + ox, p.y + s * (p.h / 2 + 0.35), 0, 0.4, 0.8, 0.25, 0, "#c8c4ba");
          }
      }
    }
    // connector openings and the button's cap
    for (const p of list) if (p.open) box(p.x + p.open[0], p.y + p.open[1], p.d - 0.3, p.open[2], p.open[3], 0.34, 0, "#2b2620");
    box(12.8, 10.2, 1.4, 1.4, 1.4, 0.35, 0, "#262522");
    const im = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshToonMaterial({ gradientMap: ramp() }), boxes.length);
    boxes.forEach((b, i) => {
      im.setMatrixAt(i, b.m);
      im.setColorAt(i, b.c);
    });
    this.group.add(im);
  }

  tags(): TagSpec[] {
    return [];
  }

  update(_fr: Frame) {}
}
