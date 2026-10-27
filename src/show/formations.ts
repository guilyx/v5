/**
 * The choreography. Every act is a drawing painted on a small offscreen canvas,
 * then sampled into exactly N drone positions on a hex lattice, the way real
 * show designers space their drones. Paint colour becomes LED colour, paint
 * alpha becomes density (outlines dense, fills sparse), and a second "tag"
 * canvas marks drones for motion: the pendulum's pole, signals running along a
 * trace. Drones are then matched act-to-act along a Hilbert curve so each one
 * keeps roughly its place in the picture and the transitions read as one move.
 */

export type Variant = "wide" | "narrow";
/** Design units of the formation box; the show maps them into the sky. */
export const BOX: Record<Variant, { w: number; h: number }> = {
  wide: { w: 320, h: 160 },
  narrow: { w: 240, h: 170 },
};

export const MOTION = { none: 0, pendulum: 1, flow: 2, heal: 3 } as const;

export interface Style {
  /** 0 = everyone leaves together, 0.6 = a long ripple of departures */
  spread: number;
  /** vertical lift in the middle of the flight, design units */
  arc: number;
  /** swirl around the centre in the middle of the flight, radians */
  spin: number;
  /** 1 = rise first, then travel (take-off from the barge) */
  launch: number;
}

export interface Formation {
  name: string;
  pos: Float32Array;
  col: Float32Array;
  prm: Float32Array;
  delay: Float32Array;
  style: Style;
  motion: number;
  live: boolean;
  pivot: [number, number];
}

type Delay = "x" | "-x" | "y" | "r" | "rand";
type Paint = (g: CanvasRenderingContext2D, t: CanvasRenderingContext2D, w: number, h: number, narrow: boolean) => [number, number] | void;

interface Spec {
  name: string;
  paint?: Paint;
  style: Style;
  delay: Delay;
  motion?: number;
  depth?: number;
  live?: boolean;
}

const WARM = "#fff1da";
const CREAM = "#ffdcae";
const AMBER = "#ffb547";
const CORAL = "#ff7a62";
const ICE = "#bfe0ff";
const DIM = "#a89a86";

const SANS = '"Geist Variable", system-ui, sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

// ---------------------------------------------------------------- small utils

export function hash(a: number, b: number, s: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

/** Paint a polyline on the tag canvas with a value rising from t0 to t1 along it. */
function tagLine(t: CanvasRenderingContext2D, pts: number[], t0: number, t1: number, width: number) {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  let run = 0;
  t.lineWidth = width;
  t.lineCap = "round";
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < steps; k++) {
      const a = k / steps, b = (k + 1) / steps;
      const v = t0 + (t1 - t0) * ((run + len * (a + b) * 0.5) / total);
      const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
      t.strokeStyle = `rgb(${c},${c},${c})`;
      t.beginPath();
      t.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a);
      t.lineTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
      t.stroke();
    }
    run += len;
  }
}

function polyline(g: CanvasRenderingContext2D, pts: number[]) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
}

/** Centre a block of text lines on its real ink, scaled to fit a box. */
function text(
  g: CanvasRenderingContext2D,
  lines: string[],
  font: (px: number) => string,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number,
  lead = 1,
) {
  g.font = font(100);
  let wide = 0;
  for (const l of lines) {
    const m = g.measureText(l);
    wide = Math.max(wide, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  }
  const first = g.measureText(lines[0]);
  const last = g.measureText(lines[lines.length - 1]);
  const inkH = (first.actualBoundingBoxAscent + last.actualBoundingBoxDescent) / 100 + (lines.length - 1) * lead;
  const px = Math.min((maxW / wide) * 100, maxH / inkH);
  g.font = font(px);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const asc = g.measureText(lines[0]).actualBoundingBoxAscent;
  const total = inkH * px;
  let y = cy - total / 2 + asc;
  for (const l of lines) {
    const m = g.measureText(l);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    g.fillText(l, cx - w / 2 + m.actualBoundingBoxLeft, y);
    y += px * lead;
  }
  return px;
}

// ---------------------------------------------------------------- the acts

const paintName: Paint = (g, _t, w, h, narrow) => {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, WARM);
  grad.addColorStop(1, CREAM);
  g.fillStyle = grad;
  const lines = narrow ? ["Erwin", "Lejeune"] : ["Erwin Lejeune"];
  text(g, lines, (px) => `italic 400 ${px}px ${SERIF}`, w / 2, h / 2, w * 0.95, h * 0.9, 0.92);
};

const paintChip: Paint = (g, t, w, h, narrow) => {
  const cx = w / 2, cy = h / 2;
  const S = Math.min(h * 0.54, w * (narrow ? 0.46 : 0.28));
  const pins = 6;
  const pl = S * 0.1, pw = S * 0.04;
  // traces: from the board edge into each pin, signals flow inward
  g.strokeStyle = DIM;
  g.lineWidth = S * 0.016;
  g.lineCap = "round";
  g.lineJoin = "round";
  const reachX = narrow ? w * 0.48 : w * 0.46;
  const reachY = h * 0.47;
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < pins; k++) {
      const u = -S / 2 + (S * (k + 1)) / (pins + 1);
      const fan = (k - (pins - 1) / 2) / ((pins - 1) / 2); // -1..1
      let pts: number[];
      if (side === 0 || side === 2) {
        // left / right: out, bend, out to the edge
        const dir = side === 0 ? -1 : 1;
        const x0 = cx + dir * (S / 2 + pl);
        const y0 = cy + u;
        const bend = S * (0.12 + 0.05 * Math.abs(fan));
        const x1 = x0 + dir * bend;
        const y2 = y0 + fan * S * 0.28;
        const x2 = x1 + dir * Math.abs(y2 - y0);
        pts = [cx + dir * reachX, y2, x2, y2, x1, y0, x0, y0];
      } else {
        const dir = side === 1 ? -1 : 1;
        const x0 = cx + u;
        const y0 = cy + dir * (S / 2 + pl);
        const y1 = y0 + dir * S * 0.1;
        const x2 = x0 + fan * S * (narrow ? 0.35 : 0.55);
        const y2 = y1 + dir * Math.abs(x2 - x0) * 0.6;
        pts = [x2, cy + dir * reachY, x2, y2, x0, y1, x0, y0];
      }
      polyline(g, pts);
      g.stroke();
      tagLine(t, pts, 0, 1, S * 0.03);
    }
  }
  // package
  rrect(g, cx - S / 2, cy - S / 2, S, S, S * 0.06);
  g.strokeStyle = WARM;
  g.lineWidth = S * 0.028;
  g.stroke();
  // pins
  g.fillStyle = AMBER;
  for (let k = 0; k < pins; k++) {
    const u = -S / 2 + (S * (k + 1)) / (pins + 1);
    g.fillRect(cx - S / 2 - pl, cy + u - pw / 2, pl, pw);
    g.fillRect(cx + S / 2, cy + u - pw / 2, pl, pw);
    g.fillRect(cx + u - pw / 2, cy - S / 2 - pl, pw, pl);
    g.fillRect(cx + u - pw / 2, cy + S / 2, pw, pl);
  }
  // pin one
  circle(g, cx - S / 2 + S * 0.14, cy - S / 2 + S * 0.14, S * 0.04);
  g.fill();
  // die + label
  g.fillStyle = WARM;
  text(g, ["STM32"], (px) => `800 ${px}px ${SANS}`, cx, cy + S * 0.04, S * 0.74, S * 0.26);
};

const paintMaze: Paint = (g, t, w, h, narrow) => {
  const cols = narrow ? 7 : 12, rows = narrow ? 5 : 5;
  const c = Math.min((w * 0.95) / cols, (h * 0.9) / rows);
  const ox = (w - cols * c) / 2, oy = (h - rows * c) / 2;
  // a perfect maze, carved by a seeded depth-first search
  const r = rng(narrow ? 11 : 29);
  const right = Array.from({ length: rows }, () => Array<boolean>(cols).fill(true));
  const down = Array.from({ length: rows }, () => Array<boolean>(cols).fill(true));
  const seen = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [y, x] = stack[stack.length - 1];
    const options: [number, number][] = [];
    if (x > 0 && !seen[y][x - 1]) options.push([y, x - 1]);
    if (x < cols - 1 && !seen[y][x + 1]) options.push([y, x + 1]);
    if (y > 0 && !seen[y - 1][x]) options.push([y - 1, x]);
    if (y < rows - 1 && !seen[y + 1][x]) options.push([y + 1, x]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [ny, nx] = options[Math.floor(r() * options.length)];
    if (ny === y) right[y][Math.min(x, nx)] = false;
    else down[Math.min(y, ny)][x] = false;
    seen[ny][nx] = true;
    stack.push([ny, nx]);
  }
  const entry = Math.floor(rows / 2), exit = rows - 1 - Math.floor(rows / 3);
  // walls
  g.strokeStyle = WARM;
  g.lineWidth = c * 0.085;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox + cols * c, oy);
  g.moveTo(ox, oy + rows * c);
  g.lineTo(ox + cols * c, oy + rows * c);
  g.moveTo(ox, oy);
  g.lineTo(ox, oy + entry * c);
  g.moveTo(ox, oy + (entry + 1) * c);
  g.lineTo(ox, oy + rows * c);
  g.moveTo(ox + cols * c, oy);
  g.lineTo(ox + cols * c, oy + exit * c);
  g.moveTo(ox + cols * c, oy + (exit + 1) * c);
  g.lineTo(ox + cols * c, oy + rows * c);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (x < cols - 1 && right[y][x]) {
        g.moveTo(ox + (x + 1) * c, oy + y * c);
        g.lineTo(ox + (x + 1) * c, oy + (y + 1) * c);
      }
      if (y < rows - 1 && down[y][x]) {
        g.moveTo(ox + x * c, oy + (y + 1) * c);
        g.lineTo(ox + (x + 1) * c, oy + (y + 1) * c);
      }
    }
  g.stroke();
  // the solution, by breadth-first search
  const prev = new Map<number, number>();
  const start = entry * cols, goal = exit * cols + cols - 1;
  const q = [start];
  prev.set(start, -1);
  while (q.length) {
    const id = q.shift()!;
    if (id === goal) break;
    const y = Math.floor(id / cols), x = id % cols;
    const next: number[] = [];
    if (x > 0 && !right[y][x - 1]) next.push(id - 1);
    if (x < cols - 1 && !right[y][x]) next.push(id + 1);
    if (y > 0 && !down[y - 1][x]) next.push(id - cols);
    if (y < rows - 1 && !down[y][x]) next.push(id + cols);
    for (const n of next)
      if (!prev.has(n)) {
        prev.set(n, id);
        q.push(n);
      }
  }
  const path: number[] = [];
  for (let id = goal; id !== -1; id = prev.get(id)!) path.unshift(id);
  const pts: number[] = [ox - c * 0.6, oy + (entry + 0.5) * c];
  for (const id of path) pts.push(ox + ((id % cols) + 0.5) * c, oy + (Math.floor(id / cols) + 0.5) * c);
  pts.push(ox + cols * c + c * 0.6, oy + (exit + 0.5) * c);
  g.strokeStyle = AMBER;
  g.lineWidth = c * 0.12;
  g.lineJoin = "round";
  polyline(g, pts);
  g.stroke();
  tagLine(t, pts, 0, 1, c * 0.2);
};

const paintPendulum: Paint = (g, t, w, h, narrow) => {
  const cx = w / 2;
  const railY = h * 0.84;
  const cartW = narrow ? w * 0.36 : w * 0.21, cartH = h * 0.15;
  const wheelR = h * 0.04;
  const cartTop = railY - wheelR * 2 - cartH;
  const poleTop = h * 0.07;
  // rail, with ticks
  g.strokeStyle = DIM;
  g.lineWidth = h * 0.012;
  g.lineCap = "round";
  const rail = [w * 0.08, railY, w * 0.92, railY];
  polyline(g, rail);
  g.stroke();
  for (let i = 0; i <= 12; i++) {
    const x = w * 0.1 + (w * 0.8 * i) / 12;
    g.beginPath();
    g.moveTo(x, railY + h * 0.02);
    g.lineTo(x, railY + h * 0.045);
    g.stroke();
  }
  t.strokeStyle = "rgb(0,0,0)";
  t.lineWidth = h * 0.08;
  polyline(t, rail);
  t.stroke();
  // cart and wheels
  g.strokeStyle = WARM;
  g.lineWidth = h * 0.016;
  rrect(g, cx - cartW / 2, cartTop, cartW, cartH, h * 0.025);
  g.stroke();
  for (const s of [-1, 1]) {
    circle(g, cx + s * cartW * 0.3, railY - wheelR, wheelR);
    g.stroke();
  }
  t.fillStyle = "rgb(128,128,128)";
  t.fillRect(cx - cartW / 2 - 6, cartTop - 4, cartW + 12, railY - cartTop - 2);
  // pole and bob
  g.strokeStyle = AMBER;
  g.lineWidth = h * 0.026;
  g.beginPath();
  g.moveTo(cx, cartTop);
  g.lineTo(cx, poleTop + h * 0.05);
  g.stroke();
  g.fillStyle = AMBER;
  circle(g, cx, poleTop + h * 0.03, h * 0.065);
  g.fill();
  g.fillStyle = WARM;
  circle(g, cx, cartTop, h * 0.022);
  g.fill();
  t.strokeStyle = "rgb(255,255,255)";
  t.fillStyle = "rgb(255,255,255)";
  t.lineWidth = h * 0.06;
  t.beginPath();
  t.moveTo(cx, cartTop);
  t.lineTo(cx, poleTop + h * 0.05);
  t.stroke();
  circle(t, cx, poleTop + h * 0.03, h * 0.1);
  t.fill();
  return [cx, cartTop];
};

const paintTrolley: Paint = (g, _t, w, h, narrow) => {
  const cw = narrow ? w * 0.7 : h * 1.02;
  const ch = cw * 0.74;
  const x0 = (w - cw) / 2, y0 = (h - ch) / 2 + ch * 0.03;
  const P = (u: number, v: number): [number, number] => [x0 + u * cw, y0 + v * ch];
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = WARM;
  const lw = cw * 0.016;
  g.lineWidth = lw;
  const line = (...uv: number[]) => {
    g.beginPath();
    for (let i = 0; i < uv.length; i += 2) {
      const [x, y] = P(uv[i], uv[i + 1]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  // basket
  line(0.2, 0.2, 0.95, 0.2, 0.84, 0.6, 0.27, 0.6, 0.2, 0.2);
  g.globalAlpha = 0.6;
  g.lineWidth = lw * 0.6;
  for (let i = 1; i < 9; i++) {
    const a = i / 9;
    line(0.2 + 0.75 * a, 0.2, 0.27 + 0.57 * a, 0.6);
  }
  line(0.235, 0.4, 0.895, 0.4);
  g.globalAlpha = 1;
  g.lineWidth = lw;
  // handle
  line(0.2, 0.2, 0.12, 0.08);
  g.lineWidth = lw * 2.2;
  line(0.06, 0.07, 0.15, 0.07);
  g.lineWidth = lw;
  // chassis and tray
  line(0.27, 0.6, 0.3, 0.84, 0.86, 0.84);
  line(0.84, 0.6, 0.86, 0.84);
  line(0.34, 0.74, 0.84, 0.74);
  // wheels
  for (const u of [0.34, 0.8]) {
    const [x, y] = P(u, 0.92);
    line(u, 0.84, u, 0.87);
    circle(g, x, y, cw * 0.045);
    g.stroke();
  }
  // the detection: amber corner brackets and a label tab
  const m = cw * 0.06;
  const bx0 = x0 - m * 0.2, by0 = y0 - m * 0.4, bx1 = x0 + cw + m * 0.2, by1 = y0 + ch + m * 0.1;
  const L = cw * 0.16;
  g.strokeStyle = AMBER;
  g.lineWidth = lw * 1.3;
  g.beginPath();
  g.moveTo(bx0, by0 + L);
  g.lineTo(bx0, by0);
  g.lineTo(bx0 + L, by0);
  g.moveTo(bx1 - L, by0);
  g.lineTo(bx1, by0);
  g.lineTo(bx1, by0 + L);
  g.moveTo(bx1, by1 - L);
  g.lineTo(bx1, by1);
  g.lineTo(bx1 - L, by1);
  g.moveTo(bx0 + L, by1);
  g.lineTo(bx0, by1);
  g.lineTo(bx0, by1 - L);
  g.stroke();
  g.lineWidth = lw;
  g.strokeRect(bx0, by0 - cw * 0.085, cw * 0.28, cw * 0.06);
};

const paintMinus: Paint = (g, _t, w, h) => {
  const grad = g.createLinearGradient(w * 0.15, 0, w * 0.85, 0);
  grad.addColorStop(0, CREAM);
  grad.addColorStop(0.45, AMBER);
  grad.addColorStop(1, CORAL);
  g.fillStyle = grad;
  text(g, ["−74%"], (px) => `700 ${px}px ${SANS}`, w / 2, h * 0.41, w * 0.9, h * 0.66);
  g.fillStyle = WARM;
  g.globalAlpha = 0.9;
  text(g, ["ONBOARD CPU"], (px) => `600 ${px}px ${SANS}`, w / 2, h * 0.87, w * 0.62, h * 0.13);
  g.globalAlpha = 1;
};

const paintGraph: Paint = (g, t, w, h, narrow) => {
  const r = rng(7);
  g.lineCap = "round";
  // the voice: a waveform
  const wx0 = w * 0.04, wx1 = w * (narrow ? 0.24 : 0.25), cy = h * 0.5;
  const bars = narrow ? 9 : 13;
  g.strokeStyle = ICE;
  g.lineWidth = (wx1 - wx0) / bars * 0.42;
  for (let i = 0; i < bars; i++) {
    const x = wx0 + ((i + 0.5) / bars) * (wx1 - wx0);
    const env = Math.sin(((i + 0.5) / bars) * Math.PI);
    const amp = h * (0.06 + 0.3 * env * (0.45 + 0.55 * r()));
    g.beginPath();
    g.moveTo(x, cy - amp);
    g.lineTo(x, cy + amp);
    g.stroke();
  }
  // the graph of agents
  const gx0 = w * (narrow ? 0.34 : 0.34), gx1 = w * (narrow ? 0.66 : 0.68);
  const nodes: [number, number, number][] = [
    [gx0, cy, 1.25],
    [gx0 + (gx1 - gx0) * 0.42, cy - h * 0.27, 1],
    [gx0 + (gx1 - gx0) * 0.42, cy + h * 0.02, 1],
    [gx0 + (gx1 - gx0) * 0.42, cy + h * 0.3, 1],
    [gx1, cy - h * 0.16, 1],
    [gx1, cy + h * 0.2, 1],
  ];
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [2, 5], [3, 5],
  ];
  const nr = h * 0.045;
  g.strokeStyle = WARM;
  g.lineWidth = h * 0.011;
  g.globalAlpha = 0.75;
  const link = (a: [number, number], b: [number, number]) => {
    const pts = [a[0], a[1], b[0], b[1]];
    polyline(g, pts);
    g.stroke();
    tagLine(t, pts, 0, 1, h * 0.035);
  };
  link([wx1 + w * 0.02, cy], [gx0 - nr * 1.3, cy]);
  for (const [a, b] of edges) link([nodes[a][0], nodes[a][1]], [nodes[b][0], nodes[b][1]]);
  // into the queue
  const qx0 = w * (narrow ? 0.76 : 0.78), qx1 = w * 0.96;
  for (const n of [4, 5]) link([nodes[n][0], nodes[n][1]], [qx0 - w * 0.015, cy + (n === 4 ? -h * 0.06 : h * 0.06)]);
  g.globalAlpha = 1;
  for (const [x, y, s] of nodes) {
    g.fillStyle = WARM;
    circle(g, x, y, nr * s);
    g.fill();
    t.fillStyle = "rgb(0,0,0)";
    t.globalCompositeOperation = "destination-out";
    circle(t, x, y, nr * s * 1.2);
    t.fill();
    t.globalCompositeOperation = "source-over";
  }
  // the queue of build jobs
  const jobs = 5, jh = h * 0.11, gap = h * 0.045;
  const qy0 = cy - (jobs * jh + (jobs - 1) * gap) / 2;
  for (let i = 0; i < jobs; i++) {
    const y = qy0 + i * (jh + gap);
    rrect(g, qx0, y, qx1 - qx0, jh, jh * 0.3);
    g.fillStyle = AMBER;
    g.globalAlpha = 0.3;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = i === 0 ? CORAL : AMBER;
    g.lineWidth = h * 0.014;
    g.stroke();
  }
};

const paintSirb: Paint = (g, _t, w, h) => {
  const grad = g.createLinearGradient(w * 0.1, 0, w * 0.9, 0);
  grad.addColorStop(0, WARM);
  grad.addColorStop(0.55, AMBER);
  grad.addColorStop(1, CORAL);
  g.fillStyle = grad;
  text(g, ["SIRB.AI"], (px) => `700 ${px}px ${SANS}`, w / 2, h * 0.4, w * 0.92, h * 0.58);
  g.fillStyle = WARM;
  g.globalAlpha = 0.9;
  text(g, ["UMEX 2026"], (px) => `600 ${px}px ${SANS}`, w / 2, h * 0.86, w * 0.5, h * 0.13);
  g.globalAlpha = 1;
};

const paintHello: Paint = (g, t, w, h) => {
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, WARM);
  grad.addColorStop(1, CREAM);
  g.fillStyle = grad;
  text(g, ["hello"], (px) => `italic 400 ${px}px ${SERIF}`, w / 2, h / 2, w * 0.86, h * 0.86);
  // a shimmer sweeps through the word, left to right
  const tg = t.createLinearGradient(0, 0, w, 0);
  tg.addColorStop(0, "rgb(0,0,0)");
  tg.addColorStop(1, "rgb(255,255,255)");
  t.fillStyle = tg;
  t.fillRect(0, 0, w, h);
};

const SPECS: Spec[] = [
  { name: "overture", paint: paintName, style: { spread: 0.55, arc: 0, spin: 0, launch: 1 }, delay: "x" },
  { name: "chip", paint: paintChip, style: { spread: 0.5, arc: 26, spin: 0, launch: 0 }, delay: "x", motion: MOTION.flow },
  { name: "maze", paint: paintMaze, style: { spread: 0.45, arc: 0, spin: 1.3, launch: 0 }, delay: "r", motion: MOTION.flow },
  { name: "pendulum", paint: paintPendulum, style: { spread: 0.5, arc: -18, spin: 0, launch: 0 }, delay: "y", motion: MOTION.pendulum },
  { name: "trolley", paint: paintTrolley, style: { spread: 0.5, arc: 22, spin: 0, launch: 0 }, delay: "-x" },
  { name: "flock", style: { spread: 0.35, arc: 0, spin: 0, launch: 0 }, delay: "rand", live: true },
  { name: "minus", paint: paintMinus, style: { spread: 0.4, arc: 0, spin: 0, launch: 0 }, delay: "r" },
  { name: "graph", paint: paintGraph, style: { spread: 0.55, arc: 14, spin: 0, launch: 0 }, delay: "x", motion: MOTION.flow },
  { name: "sirb", paint: paintSirb, style: { spread: 0.45, arc: 0, spin: 2.2, launch: 0 }, delay: "r", motion: MOTION.heal },
  { name: "hello", paint: paintHello, style: { spread: 0.55, arc: 10, spin: 0, launch: 0 }, delay: "x", motion: MOTION.flow },
];

/** Formation index of each act (0 is the barge). */
export const FLOCK_INDEX = 1 + SPECS.findIndex((s) => s.live);

// ---------------------------------------------------------------- sampling

interface Raw {
  pos: Float32Array;
  col: Float32Array;
  prm: Float32Array;
}

function sample(spec: Spec, n: number, variant: Variant, seed: number): { raw: Raw; pivot: [number, number] } {
  const { w: W, h: H } = BOX[variant];
  const k = 2; // canvas px per design unit
  const cw = W * k, ch = H * k;
  const ink = document.createElement("canvas");
  const tag = document.createElement("canvas");
  ink.width = tag.width = cw;
  ink.height = tag.height = ch;
  const g = ink.getContext("2d", { willReadFrequently: true })!;
  const t = tag.getContext("2d", { willReadFrequently: true })!;
  const px = spec.paint!(g, t, cw, ch, variant === "narrow");
  const pivot: [number, number] = px ? [px[0] / k - W / 2, H / 2 - px[1] / k] : [0, 0];
  const a = g.getImageData(0, 0, cw, ch).data;
  const b = t.getImageData(0, 0, cw, ch).data;

  // count lattice points the paint accepts at spacing sp (deterministic per lattice cell)
  const lattice = (sp: number, out: number[] | null) => {
    const rowH = sp * 0.8660254;
    const rows = Math.floor(H / rowH), cols = Math.floor(W / sp);
    const y0 = -((rows * rowH) / 2), x0 = -((cols * sp) / 2);
    let c = 0;
    for (let iy = 0; iy <= rows; iy++) {
      const off = iy & 1 ? sp * 0.5 : 0;
      for (let ix = 0; ix <= cols; ix++) {
        const x = x0 + ix * sp + off - sp * 0.25 + (hash(ix, iy, seed) - 0.5) * 0.24 * sp;
        const y = y0 + iy * rowH + (hash(ix, iy, seed + 1) - 0.5) * 0.24 * sp;
        const u = Math.round((x + W / 2) * k), v = Math.round((H / 2 - y) * k);
        if (u < 0 || v < 0 || u >= cw || v >= ch) continue;
        const i = (v * cw + u) * 4;
        const alpha = a[i + 3];
        if (alpha === 0 || hash(ix, iy, seed + 2) * 255 >= alpha) continue;
        c++;
        if (out) out.push(x, y, i);
      }
    }
    return c;
  };
  // first guess from how much paint there is, then a short bisection
  let paint = 0;
  for (let i = 3; i < a.length; i += 4) paint += a[i];
  const area = ((paint / 255) * W * H) / (cw * ch);
  const guess = Math.sqrt(area / (0.866 * n));
  let lo = guess * 0.55, hi = guess * 1.6;
  while (lattice(lo, null) < n && lo > 0.3) lo *= 0.8;
  for (let it = 0; it < 9; it++) {
    const mid = (lo + hi) / 2;
    if (lattice(mid, null) >= n) lo = mid;
    else hi = mid;
  }
  const pts: number[] = [];
  lattice(lo, pts);
  // drop the surplus at random so exactly n remain
  const count = pts.length / 3;
  const order = Array.from({ length: count }, (_, i) => i);
  const r = rng(seed * 7 + 3);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), prm = new Float32Array(n);
  const depth = spec.depth ?? 4;
  for (let d = 0; d < n; d++) {
    const s = order[d % count];
    const i = pts[s * 3 + 2];
    pos[d * 3] = pts[s * 3];
    pos[d * 3 + 1] = pts[s * 3 + 1];
    pos[d * 3 + 2] = (r() - 0.5) * depth * 2;
    col[d * 3] = a[i] / 255;
    col[d * 3 + 1] = a[i + 1] / 255;
    col[d * 3 + 2] = a[i + 2] / 255;
    prm[d] = b[i + 3] > 127 ? b[i] / 255 : -1;
  }
  return { raw: { pos, col, prm }, pivot };
}

/** A loose cloud: where the flock starts in the precomputed chain (the live sim replaces it). */
function cloud(n: number, variant: Variant): Raw {
  const { w: W, h: H } = BOX[variant];
  const r = rng(99);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), prm = new Float32Array(n).fill(-1);
  const warm = [1, 0.945, 0.855], amber = [1, 0.78, 0.45];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, u = r() * 2 - 1, rad = Math.cbrt(r());
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(a) * s * rad * W * 0.3;
    pos[i * 3 + 1] = u * rad * H * 0.3;
    pos[i * 3 + 2] = Math.sin(a) * s * rad * 40;
    const m = r() < 0.3 ? amber : warm;
    col.set(m, i * 3);
  }
  return { pos, col, prm };
}

// ---------------------------------------------------------------- matching

function hilbert(x: number, y: number, n = 1024): number {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

function curveOrder(pos: Float32Array, n: number): Int32Array {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = 1023 / Math.max(1e-6, maxX - minX), sy = 1023 / Math.max(1e-6, maxY - minY);
  const key = new Float64Array(n);
  for (let i = 0; i < n; i++) key[i] = hilbert(Math.round((pos[i * 3] - minX) * sx), Math.round((pos[i * 3 + 1] - minY) * sy)) + i / n;
  const idx = Int32Array.from({ length: n }, (_, i) => i);
  idx.sort((p, q) => key[p] - key[q]);
  return idx;
}

/** For each drone (at `from`), which target index it should take. */
export function match(from: Float32Array, to: Float32Array, n: number): Int32Array {
  const a = curveOrder(from, n), b = curveOrder(to, n);
  const assign = new Int32Array(n);
  for (let k = 0; k < n; k++) assign[a[k]] = b[k];
  return assign;
}

function permute3(src: Float32Array, perm: Int32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < perm.length; i++) {
    const j = perm[i] * 3;
    out[i * 3] = src[j];
    out[i * 3 + 1] = src[j + 1];
    out[i * 3 + 2] = src[j + 2];
  }
  return out;
}

function permute1(src: Float32Array, perm: Int32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < perm.length; i++) out[i] = src[perm[i]];
  return out;
}

/** Relabel every drone at once (keeps act-to-act matching intact). */
export function relabel(f: Formation, perm: Int32Array) {
  f.pos = permute3(f.pos, perm);
  f.col = permute3(f.col, perm);
  f.prm = permute1(f.prm, perm);
  f.delay = permute1(f.delay, perm);
}

function delays(pos: Float32Array, n: number, by: Delay, seed: number): Float32Array {
  const key = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    key[i] = by === "x" ? x : by === "-x" ? -x : by === "y" ? -y : by === "r" ? Math.hypot(x, y * 1.6) : hash(i, 0, seed);
  }
  let lo = Infinity, hi = -Infinity;
  for (const k of key) {
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ((key[i] - lo) / Math.max(1e-6, hi - lo)) * 0.86 + hash(i, 7, seed) * 0.14;
  return out;
}

// ---------------------------------------------------------------- the barge

/** Drones parked in rows on a barge, given in design units for the current layout. */
export function barge(n: number, toDesign: (x: number, y: number, z: number) => [number, number, number], at: [number, number, number]): Raw {
  const rows = 24;
  const cols = Math.ceil(n / rows);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), prm = new Float32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const wx = at[0] + (c / (cols - 1) - 0.5) * 120;
    const wz = at[2] + (r / (rows - 1) - 0.5) * 46;
    const p = toDesign(wx, 1.4, wz);
    pos.set(p, i * 3);
    col.set([0.32, 0.42, 0.72], i * 3);
  }
  return { pos, col, prm };
}

// ---------------------------------------------------------------- the show

/** Total formations in the show, barge included. */
export const ACTS = SPECS.length + 1;

/**
 * Builds the acts in order, each matched to the one before. The barge and the
 * overture are built up front; the rest are built in idle time (or on demand
 * if the visitor scrolls ahead), so first paint never waits on all of them.
 */
export class Choreography {
  readonly list: Formation[];
  constructor(
    readonly n: number,
    readonly variant: Variant,
    pad: Raw,
  ) {
    this.list = [
      {
        name: "barge",
        ...pad,
        delay: new Float32Array(n),
        style: { spread: 0, arc: 0, spin: 0, launch: 0 },
        motion: MOTION.none,
        live: false,
        pivot: [0, 0],
      },
    ];
  }

  get done() {
    return this.list.length >= ACTS;
  }

  /** Build the next act; false once everything is built. */
  next(): boolean {
    if (this.done) return false;
    const k = this.list.length - 1;
    const spec = SPECS[k];
    const { n, variant } = this;
    const { raw, pivot } = spec.live ? { raw: cloud(n, variant), pivot: [0, 0] as [number, number] } : sample(spec, n, variant, 17 + k * 31);
    const assign = match(this.list[k].pos, raw.pos, n);
    const pos = permute3(raw.pos, assign);
    this.list.push({
      name: spec.name,
      pos,
      col: permute3(raw.col, assign),
      prm: permute1(raw.prm, assign),
      delay: delays(pos, n, spec.delay, k + 5),
      style: spec.style,
      motion: spec.motion ?? MOTION.none,
      live: !!spec.live,
      pivot,
    });
    return true;
  }

  ensure(index: number) {
    while (this.list.length <= index && this.next());
  }
}

// ---------------------------------------------------------------- drawings by the visitor

/**
 * Resample the visitor's strokes (design units) into n evenly spaced targets.
 * Returns positions, a gradient colour along the drawing and the drawing order,
 * so drones can retrace the strokes in the order they were drawn.
 */
export function strokesToTargets(strokes: number[][], n: number): { pos: Float32Array; col: Float32Array; order: Float32Array } {
  const segs: { x0: number; y0: number; x1: number; y1: number; len: number }[] = [];
  let total = 0;
  for (const s of strokes) {
    for (let i = 2; i < s.length; i += 2) {
      const len = Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
      if (len < 1e-4) continue;
      segs.push({ x0: s[i - 2], y0: s[i - 1], x1: s[i], y1: s[i + 1], len });
      total += len;
    }
  }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), order = new Float32Array(n);
  const r = rng(strokes.length * 13 + Math.round(total));
  const stops = [
    [1, 0.95, 0.86],
    [1, 0.71, 0.28],
    [1, 0.48, 0.38],
  ];
  if (!segs.length) {
    // a dot: a small sphere of drones
    const s = strokes[0] ?? [0, 0];
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, u = r() * 2 - 1, rad = 6 * Math.cbrt(r()), q = Math.sqrt(1 - u * u);
      pos.set([s[0] + Math.cos(a) * q * rad, s[1] + u * rad, Math.sin(a) * q * rad], i * 3);
      col.set(stops[1], i * 3);
      order[i] = r();
    }
    return { pos, col, order };
  }
  const gap = total / n;
  const crowd = Math.max(0, 1.6 / gap - 1); // dense drawings get depth instead of overlapping
  let seg = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) * gap;
    while (seg < segs.length - 1 && acc + segs[seg].len < d) acc += segs[seg++].len;
    const s = segs[seg];
    const into = Math.min(1, Math.max(0, (d - acc) / s.len));
    const nx = -(s.y1 - s.y0) / s.len, ny = (s.x1 - s.x0) / s.len;
    const j = (r() - 0.5) * 1.2;
    pos[i * 3] = s.x0 + (s.x1 - s.x0) * into + nx * j;
    pos[i * 3 + 1] = s.y0 + (s.y1 - s.y0) * into + ny * j;
    pos[i * 3 + 2] = (r() - 0.5) * (2 + crowd * 7);
    const u = i / (n - 1);
    const a = u < 0.5 ? stops[0] : stops[1], b = u < 0.5 ? stops[1] : stops[2];
    const f = u < 0.5 ? u * 2 : (u - 0.5) * 2;
    col[i * 3] = a[0] + (b[0] - a[0]) * f;
    col[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
    col[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
    order[i] = u;
  }
  return { pos, col, order };
}

/** Preset drawings for the "or try" buttons (and keyboard users), in design units. */
export function presetStrokes(name: string, variant: Variant): number[][] {
  const { w: W, h: H } = BOX[variant];
  const R = Math.min(W, H) * 0.42;
  const pts: number[] = [];
  const N = 160;
  if (name === "circle") {
    for (let i = 0; i <= N; i++) {
      const a = Math.PI / 2 - (i / N) * Math.PI * 2;
      pts.push(Math.cos(a) * R, Math.sin(a) * R);
    }
  } else if (name === "star") {
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? R * 0.42 : R;
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  } else if (name === "heart") {
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push((x / 17) * R, (y / 17) * R + R * 0.1);
    }
  } else {
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      pts.push((u - 0.5) * W * 0.9, Math.sin(u * Math.PI * 4) * H * 0.28);
    }
  }
  return [pts];
}
