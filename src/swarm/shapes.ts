/**
 * Formations. Each one is drawn on a small offscreen canvas — ink in black,
 * the highlighted part in red — and sampled on a hex grid, so the drones
 * sit evenly spaced like a real drone show. Points are normalized to a
 * height of 1 and sorted left to right, so drone i always travels roughly
 * sideways between formations instead of crossing the whole sky.
 */

export interface Formation {
  /** xyz per drone, height-normalized, centred on the origin */
  pos: Float32Array;
  /** 1 where the drone shows the accent colour */
  accent: Uint8Array;
  /** width / height, for fitting the formation into its slot on screen */
  aspect: number;
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(pts: [number, number, number, number][], n: number, aspect: number): Formation {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pos = new Float32Array(n * 3);
  const accent = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    accent[i] = p[3];
  }
  return { pos, accent, aspect };
}

/** Rasterize a drawing and pick `n` evenly spread points inside it. */
export function fromDrawing(w: number, h: number, draw: Draw, n: number, seed = 1, depth = 0.05): Formation {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.lineCap = "round";
  g.lineJoin = "round";
  draw(g, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 128;
  const isAccent = (x: number, y: number) => {
    const k = (y * w + x) * 4;
    return px[k] > 160 && px[k + 1] < 110 ? 1 : 0;
  };
  let area = 0;
  for (let k = 3; k < px.length; k += 4) if (px[k] > 128) area++;

  const r = rng(seed);
  let s = Math.sqrt(area / n);
  let pts: [number, number, number, number][] = [];
  for (let iter = 0; iter < 10; iter++) {
    pts = [];
    const rowH = s * 0.866;
    let row = 0;
    for (let y = rowH / 2; y < h; y += rowH, row++) {
      for (let x = row % 2 ? s : s / 2; x < w; x += s) {
        const jx = Math.round(x + (r() - 0.5) * s * 0.2);
        const jy = Math.round(y + (r() - 0.5) * s * 0.2);
        if (inside(jx, jy)) pts.push([jx, jy, 0, isAccent(jx, jy)]);
      }
    }
    const ratio = pts.length / n;
    if (Math.abs(ratio - 1) < 0.02) break;
    s *= Math.sqrt(ratio);
  }
  // exact count: drop at random, or top up with random inside pixels
  while (pts.length > n) pts.splice(Math.floor(r() * pts.length), 1);
  while (pts.length < n) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    if (inside(x, y)) pts.push([x, y, 0, isAccent(x, y)]);
  }
  for (const p of pts) {
    p[0] = (p[0] - w / 2) / h;
    p[1] = (h / 2 - p[1]) / h;
    p[2] = (r() - 0.5) * depth + (p[3] ? 0.02 : 0);
  }
  return finish(pts, n, w / h);
}

const INK = "#000";
const HOT = "#f00";

/* ---------------- the chapters ---------------- */

const chip: Draw = (g) => {
  g.fillStyle = INK;
  for (let k = 0; k < 6; k++) {
    const t = 62 + k * 23;
    g.fillRect(t - 4, 18, 9, 30); // top
    g.fillRect(t - 4, 192, 9, 30); // bottom
    g.fillRect(18, t - 4, 30, 9); // left
    g.fillRect(192, t - 4, 30, 9); // right
  }
  g.strokeStyle = INK;
  g.lineWidth = 15;
  g.beginPath();
  g.roundRect(56, 56, 128, 128, 14);
  g.stroke();
  g.fillStyle = HOT;
  g.beginPath();
  g.roundRect(94, 94, 52, 52, 6);
  g.fill();
};

const maze: Draw = (g, w) => {
  // a small perfect maze, then the path through it in the accent
  const n = 5;
  const cell = (w - 20) / n;
  const o = 10;
  const r = rng(2019);
  const walls = Array.from({ length: n * n }, () => [true, true, true, true]); // N E S W
  const seen = new Set([0]);
  const stack = [0];
  const nb = (i: number) =>
    [
      [i - n, 0, 2],
      [i % n < n - 1 ? i + 1 : -1, 1, 3],
      [i + n, 2, 0],
      [i % n > 0 ? i - 1 : -1, 3, 1],
    ].filter(([j]) => j >= 0 && j < n * n && !seen.has(j));
  while (stack.length) {
    const i = stack[stack.length - 1];
    const opts = nb(i);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [j, a, b] = opts[Math.floor(r() * opts.length)];
    walls[i][a] = false;
    walls[j][b] = false;
    seen.add(j);
    stack.push(j);
  }
  walls[0][3] = false;
  walls[n * n - 1][1] = false;
  // breadth-first path from the entry to the exit
  const prev = new Map<number, number>([[0, -1]]);
  const q = [0];
  while (q.length) {
    const i = q.shift()!;
    const step: [number, number][] = [
      [i - n, 0],
      [i + 1, 1],
      [i + n, 2],
      [i - 1, 3],
    ];
    for (const [j, d] of step) {
      if (walls[i][d] || j < 0 || j >= n * n || prev.has(j)) continue;
      if (d === 1 && i % n === n - 1) continue;
      if (d === 3 && i % n === 0) continue;
      prev.set(j, i);
      q.push(j);
    }
  }
  g.strokeStyle = INK;
  g.lineWidth = 9;
  g.beginPath();
  for (let i = 0; i < n * n; i++) {
    const x = o + (i % n) * cell;
    const y = o + Math.floor(i / n) * cell;
    if (walls[i][0]) (g.moveTo(x, y), g.lineTo(x + cell, y));
    if (walls[i][3]) (g.moveTo(x, y), g.lineTo(x, y + cell));
    if (i % n === n - 1 && walls[i][1]) (g.moveTo(x + cell, y), g.lineTo(x + cell, y + cell));
    if (i >= n * (n - 1) && walls[i][2]) (g.moveTo(x, y + cell), g.lineTo(x + cell, y + cell));
  }
  g.stroke();
  const path: number[] = [];
  for (let i = n * n - 1; i !== -1; i = prev.get(i)!) path.unshift(i);
  g.strokeStyle = HOT;
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(o - 4, o + cell / 2);
  for (const i of path) g.lineTo(o + (i % n) * cell + cell / 2, o + Math.floor(i / n) * cell + cell / 2);
  g.lineTo(o + n * cell + 4, o + (n - 0.5) * cell);
  g.stroke();
};

const paths: Draw = (g) => {
  // a grid of waypoints and three agents' routes through it, none colliding
  g.fillStyle = INK;
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      g.beginPath();
      g.arc(20 + i * 40, 20 + j * 40, 5.5, 0, Math.PI * 2);
      g.fill();
    }
  const routes = [
    [
      [20, 20],
      [140, 20],
      [140, 140],
      [220, 140],
    ],
    [
      [20, 220],
      [20, 100],
      [100, 100],
      [100, 20],
    ],
    [
      [220, 60],
      [180, 60],
      [180, 220],
      [60, 220],
    ],
  ];
  g.strokeStyle = HOT;
  g.lineWidth = 8;
  for (const rt of routes) {
    g.beginPath();
    rt.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(rt[0][0], rt[0][1], 13, 0, Math.PI * 2);
    g.fill();
  }
};

const cart: Draw = (g) => {
  g.strokeStyle = INK;
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(14, 36);
  g.lineTo(52, 36);
  g.lineTo(88, 152);
  g.lineTo(222, 152);
  g.stroke();
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(62, 66);
  g.lineTo(246, 66);
  g.lineTo(222, 128);
  g.lineTo(80, 128);
  g.closePath();
  g.stroke();
  g.lineWidth = 6;
  g.beginPath();
  for (const x of [112, 148, 184]) {
    g.moveTo(x, 70);
    g.lineTo(x - 4, 124);
  }
  g.moveTo(70, 97);
  g.lineTo(234, 97);
  g.stroke();
  g.fillStyle = HOT;
  for (const x of [108, 200]) {
    g.beginPath();
    g.arc(x, 186, 17, 0, Math.PI * 2);
    g.fill();
  }
};

const bird: Draw = (g) => {
  // a swallow, wings up, heading right
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(150, 118, 54, 17, -0.08, 0, Math.PI * 2);
  g.fill();
  // far wing
  g.beginPath();
  g.moveTo(138, 108);
  g.quadraticCurveTo(108, 52, 34, 26);
  g.quadraticCurveTo(84, 74, 112, 120);
  g.closePath();
  g.fill();
  // near wing
  g.beginPath();
  g.moveTo(160, 104);
  g.quadraticCurveTo(168, 40, 138, 4);
  g.quadraticCurveTo(190, 50, 186, 112);
  g.closePath();
  g.fill();
  // forked tail
  g.beginPath();
  g.moveTo(104, 112);
  g.lineTo(38, 132);
  g.lineTo(76, 120);
  g.lineTo(30, 150);
  g.lineTo(104, 128);
  g.closePath();
  g.fill();
  // head and beak, in the accent
  g.fillStyle = HOT;
  g.beginPath();
  g.arc(206, 108, 15, 0, Math.PI * 2);
  g.moveTo(218, 102);
  g.lineTo(240, 108);
  g.lineTo(218, 114);
  g.fill();
};

const network: Draw = (g) => {
  const nodes = [
    [130, 110],
    [40, 46],
    [62, 186],
    [214, 40],
    [236, 160],
    [146, 206],
    [118, 22],
  ];
  const edges = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [1, 6],
    [6, 3],
    [2, 5],
    [4, 5],
    [1, 2],
  ];
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.beginPath();
  for (const [a, b] of edges) {
    g.moveTo(nodes[a][0], nodes[a][1]);
    g.lineTo(nodes[b][0], nodes[b][1]);
  }
  g.stroke();
  nodes.forEach(([x, y], i) => {
    g.fillStyle = i === 0 ? HOT : INK;
    g.beginPath();
    g.arc(x, y, i === 0 ? 24 : 16, 0, Math.PI * 2);
    g.fill();
  });
};

function textDrawing(parts: [string, string][], font: string, size: number): { w: number; h: number; draw: Draw } {
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `${font.replace("SIZE", String(size))}`;
  const widths = parts.map(([t]) => m.measureText(t).width);
  const w = Math.ceil(widths.reduce((a, b) => a + b, 0) + size * 0.2);
  const h = Math.ceil(size * 1.1);
  return {
    w,
    h,
    draw: (g) => {
      g.font = font.replace("SIZE", String(size));
      g.textBaseline = "middle";
      let x = size * 0.1;
      parts.forEach(([t, c], i) => {
        g.fillStyle = c;
        g.fillText(t, x, h * 0.52);
        x += widths[i];
      });
    },
  };
}

/** A sphere of drones with a ring of them lit — the swarm that heals itself. */
function sphere(n: number): Formation {
  const pts: [number, number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const ax = [0.35, 0.86, 0.37];
  const al = Math.hypot(...ax);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rr = Math.sqrt(1 - y * y);
    const th = golden * i;
    const x = Math.cos(th) * rr;
    const z = Math.sin(th) * rr;
    const band = Math.abs((x * ax[0] + y * ax[1] + z * ax[2]) / al) < 0.09 ? 1 : 0;
    pts.push([x * 0.5, y * 0.5, z * 0.5, band]);
  }
  return finish(pts, n, 1);
}

/** Out of sight, above the top of the screen, in a loose band. */
function park(n: number): Formation {
  const r = rng(7);
  const pts: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([(r() - 0.5) * 3, (r() - 0.5) * 0.4, (r() - 0.5) * 0.6, 0]);
  return finish(pts, n, 3);
}

/** The base cloud the hero murmuration is animated from. */
function cloud(n: number): Formation {
  const r = rng(11);
  const pts: [number, number, number, number][] = [];
  while (pts.length < n) {
    const x = r() * 2 - 1;
    const y = r() * 2 - 1;
    const z = r() * 2 - 1;
    if (x * x + y * y + z * z > 1) continue;
    pts.push([x * 0.75, y * 0.32, z * 0.42, 0]);
  }
  return finish(pts, n, 1.5);
}

export type StageName = "murmur" | "chip" | "maze" | "paths" | "cart" | "bird" | "minus" | "network" | "sphere" | "park" | "hello";

export function buildFormations(n: number): Record<StageName, Formation> {
  const minus = textDrawing(
    [
      ["−", INK],
      ["74", HOT],
      ["%", INK],
    ],
    '700 SIZEpx "Geist Variable", sans-serif',
    200,
  );
  const hello = textDrawing(
    [
      ["hello", INK],
      [".", HOT],
    ],
    'italic 400 SIZEpx "Instrument Serif", serif',
    220,
  );
  return {
    murmur: cloud(n),
    chip: fromDrawing(240, 240, chip, n, 1),
    maze: fromDrawing(240, 240, maze, n, 2),
    paths: fromDrawing(240, 240, paths, n, 3),
    cart: fromDrawing(260, 210, cart, n, 4),
    bird: fromDrawing(250, 160, bird, n, 5),
    minus: fromDrawing(minus.w, minus.h, minus.draw, n, 6),
    network: fromDrawing(270, 230, network, n, 7),
    sphere: sphere(n),
    park: park(n),
    hello: fromDrawing(hello.w, hello.h, hello.draw, n, 8),
  };
}
