/**
 * Storyboard plates: one small line drawing per act, in a 1000×600 frame.
 * Each plate draws itself as the act plays (t: 0 → 1) and says where the three
 * dots of the mark sit at that moment, so they can match-cut from act to act.
 */

export type Pt = [number, number];
export interface Plate {
  update(t: number): void;
  dots(t: number): Pt[];
  /** dot radius in plate units */
  r: number;
}

const NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent.appendChild(n);
  return n;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const range = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** a seeded generator, so every plate draws the same each visit */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a polyline you can ask "where are you at fraction f of your length?" */
class Poly {
  cum: number[] = [0];
  len = 0;
  constructor(public pts: Pt[]) {
    for (let i = 1; i < pts.length; i++) {
      this.len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.cum.push(this.len);
    }
  }
  at(f: number): Pt {
    const d = clamp01(f) * this.len;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] < d) lo = m;
      else hi = m;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const k = (d - this.cum[lo]) / seg;
    const a = this.pts[lo];
    const b = this.pts[hi];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  heading(f: number): number {
    const a = this.at(f - 0.004);
    const b = this.at(f + 0.004);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  d(): string {
    return "M" + this.pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L");
  }
}

/** rounded-corner polyline through waypoints (quadratic corners, sampled) */
function rounded(way: Pt[], rad: number): Pt[] {
  const out: Pt[] = [way[0]];
  for (let i = 1; i < way.length - 1; i++) {
    const [a, b, c] = [way[i - 1], way[i], way[i + 1]];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(rad, l1 / 2, l2 / 2);
    const p: Pt = [b[0] + ((a[0] - b[0]) * r) / l1, b[1] + ((a[1] - b[1]) * r) / l1];
    const q: Pt = [b[0] + ((c[0] - b[0]) * r) / l2, b[1] + ((c[1] - b[1]) * r) / l2];
    out.push(p);
    for (let k = 1; k < 8; k++) {
      const u = k / 8;
      out.push([
        (1 - u) * (1 - u) * p[0] + 2 * (1 - u) * u * b[0] + u * u * q[0],
        (1 - u) * (1 - u) * p[1] + 2 * (1 - u) * u * b[1] + u * u * q[1],
      ]);
    }
    out.push(q);
  }
  out.push(way[way.length - 1]);
  return out;
}

/** catmull-rom through points, sampled */
function smooth(way: Pt[], per = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < way.length - 1; i++) {
    const p0 = way[Math.max(0, i - 1)];
    const p1 = way[i];
    const p2 = way[i + 1];
    const p3 = way[Math.min(way.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(way[way.length - 1]);
  return out;
}

/** a path that draws on: 0 = hidden, 1 = fully drawn */
function drawable(d: string, cls: string, parent: Element) {
  const p = el("path", { d, class: cls, pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1 }, parent);
  let last = -1;
  return (f: number) => {
    const v = Math.round(clamp01(f) * 1000) / 1000;
    if (v === last) return;
    last = v;
    p.setAttribute("stroke-dashoffset", String(1 - v));
  };
}

function setter(node: Element, name: string) {
  let last = "";
  return (v: string) => {
    if (v !== last) {
      last = v;
      node.setAttribute(name, v);
    }
  };
}

/* ───────────────────────── I. Nantes, 2014 — an oscilloscope ───────────────────────── */
function scope(svg: SVGSVGElement): Plate {
  const X0 = 60;
  const X1 = 940;
  const g = el("g", {}, svg);
  let grid = "";
  for (let i = 0; i <= 10; i++) grid += `M${X0 + i * 88} 60V540`;
  for (let j = 0; j <= 6; j++) grid += `M${X0} ${60 + j * 80}H${X1}`;
  el("path", { d: grid, class: "pl-faint" }, g);
  let ticks = "";
  for (let x = X0; x <= X1; x += 17.6) ticks += `M${x.toFixed(1)} 294V306`;
  for (let y = 60; y <= 540; y += 16) ticks += `M494 ${y}H506`;
  el("path", { d: ticks, class: "pl-thin" }, g);

  const f = (x: number) => {
    const a = 150 * (0.5 + 0.5 * Math.sin((Math.PI * (x - X0)) / 880));
    return 270 - a * Math.sin((2 * Math.PI * (x - X0)) / 280);
  };
  const pts: Pt[] = [];
  for (let x = X0; x <= X1; x += 4) pts.push([x, f(x)]);
  const wave = new Poly(pts);
  // a clock line underneath: the digital side of the same story
  const clk: Pt[] = [];
  let hi = false;
  for (let x = X0; x <= X1; x += 55) {
    clk.push([x, hi ? 455 : 495]);
    hi = !hi;
    clk.push([x, hi ? 455 : 495]);
  }
  const clock = new Poly(clk);
  const drawClock = drawable(clock.d(), "pl-thin", g);
  const drawGlow = drawable(wave.d(), "pl-glow", g);
  const drawWave = drawable(wave.d(), "pl-gold", g);
  const head = el("circle", { r: 5, class: "pl-cream" }, g);
  const hx = setter(head, "cx");
  const hy = setter(head, "cy");
  const ho = setter(head, "opacity");
  const peaks = [0, 1, 2].map((k) => X0 + 280 * (0.25 + k));

  const prog = (t: number) => ease(range(t, 0.04, 0.8));
  return {
    r: 10,
    update(t) {
      const p = prog(t);
      drawWave(p);
      drawGlow(p);
      drawClock(p);
      const [x, y] = wave.at(p);
      hx(x.toFixed(1));
      hy(y.toFixed(1));
      ho(p > 0.001 && p < 0.999 ? "1" : "0");
    },
    dots(t) {
      const xh = X0 + prog(t) * (X1 - X0);
      // the dots ride the beam and drop off, one per crest
      return peaks.map((px) => {
        const x = Math.min(px, xh);
        return [x, f(x)] as Pt;
      });
    },
  };
}

/* ───────────────────────── II. Bordeaux, 2018 — a virtual STM32 ───────────────────────── */
function chip(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  const cx = 330;
  const cy = 300;
  const H = 115;
  // the model: dashed, there from the start
  let pins = "";
  for (let k = 0; k < 10; k++) {
    const o = -90 + k * 20;
    pins += `M${cx + o} ${cy - H}V${cy - H - 22}M${cx + o} ${cy + H}V${cy + H + 22}`;
    pins += `M${cx - H} ${cy + o}H${cx - H - 22}M${cx + H} ${cy + o}H${cx + H + 22}`;
  }
  el("rect", { x: cx - H, y: cy - H, width: 2 * H, height: 2 * H, rx: 8, class: "pl-dash" }, g);
  el("path", { d: pins, class: "pl-dash" }, g);
  // the silicon, drawn over the model
  const body = `M${cx - H + 8} ${cy - H}H${cx + H - 8}Q${cx + H} ${cy - H} ${cx + H} ${cy - H + 8}V${cy + H - 8}Q${cx + H} ${cy + H} ${cx + H - 8} ${cy + H}H${cx - H + 8}Q${cx - H} ${cy + H} ${cx - H} ${cy + H - 8}V${cy - H + 8}Q${cx - H} ${cy - H} ${cx - H + 8} ${cy - H}Z`;
  const drawBody = drawable(body, "pl-line", g);
  const drawPins = drawable(pins, "pl-line", g);
  const die = el("rect", { x: cx - 52, y: cy - 52, width: 104, height: 104, class: "pl-thin", opacity: 0 }, g);
  const dieO = setter(die, "opacity");
  el("circle", { cx: cx - H + 22, cy: cy - H + 22, r: 6, class: "pl-thin" }, g);

  const names = ["TIM", "I2C", "CAN", "GPIO", "USART"];
  const pinIdx = [0, 2, 4, 7, 9];
  const traces: Poly[] = [];
  const drawTr: ((f: number) => void)[] = [];
  const pulses: ((v: string) => void)[] = [];
  const blocks: SVGGElement[] = [];
  names.forEach((name, i) => {
    const yc = 99 + i * 95;
    const yp = cy - 90 + pinIdx[i] * 20;
    const xm = 520 + i * 12;
    const tr = new Poly([
      [cx + H + 22, yp],
      [xm, yp],
      [xm, yc],
      [600, yc],
    ]);
    traces.push(tr);
    drawTr.push(drawable(tr.d(), "pl-thin", g));
    const pulse = el("path", { d: tr.d(), class: "pl-gold", pathLength: 1, "stroke-dasharray": "0.1 2", "stroke-dashoffset": 0.1, opacity: 0 }, g);
    const po = setter(pulse, "stroke-dashoffset");
    const pv = setter(pulse, "opacity");
    pulses.push((v) => {
      const [off, op] = v.split("|");
      po(off);
      pv(op);
    });
    const b = el("g", { opacity: 0 }, g);
    el("rect", { x: 600, y: yc - 29, width: 170, height: 58, rx: 6, class: "pl-fill" }, b);
    el("text", { x: 622, y: yc + 9, class: "pl-label" }, b).textContent = name;
    blocks.push(b);
  });
  const blockO = blocks.map((b) => setter(b, "opacity"));
  // QEMU, on the host side
  const q = el("g", { opacity: 0 }, g);
  el("rect", { x: 40, y: 262, width: 120, height: 76, rx: 6, class: "pl-dash" }, q);
  el("text", { x: 58, y: 309, class: "pl-label" }, q).textContent = "QEMU";
  el("path", { d: `M${cx - H - 22} 290H176V300H160`, class: "pl-dash" }, q);
  const qO = setter(q, "opacity");

  const riders = [0, 2, 4];
  return {
    r: 10,
    update(t) {
      drawBody(ease(range(t, 0.02, 0.32)));
      drawPins(ease(range(t, 0.1, 0.38)));
      dieO(range(t, 0.25, 0.4).toFixed(2));
      qO(range(t, 0.3, 0.45).toFixed(2));
      drawTr.forEach((d, i) => d(ease(range(t, 0.22 + i * 0.04, 0.48 + i * 0.04))));
      blockO.forEach((s, i) => s(range(t, 0.36 + i * 0.04, 0.5 + i * 0.04).toFixed(2)));
      const on = range(t, 0.5, 0.56);
      pulses.forEach((s, i) => {
        const ph = (t * 3.2 + i * 0.23) % 1;
        s(`${(0.1 - ph * 1.1).toFixed(3)}|${(on * 0.95).toFixed(2)}`);
      });
    },
    dots(t) {
      const k = ease(range(t, 0.55, 0.85));
      return riders.map((ri) => traces[ri].at(k));
    },
  };
}

/* ───────────────────────── III. Coimbra, 2019 — the maze ───────────────────────── */
function maze(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  const C = 15;
  const R = 9;
  const S = 56;
  const ox = 80;
  const oy = 48;
  const rnd = rng(19);
  // walls[c][r]: right, bottom
  const right = Array.from({ length: C * R }, () => true);
  const bottom = Array.from({ length: C * R }, () => true);
  const seen = new Uint8Array(C * R);
  const id = (c: number, r: number) => r * C + c;
  const stack: [number, number][] = [[0, R - 1]];
  seen[id(0, R - 1)] = 1;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const nb: [number, number][] = [];
    if (c > 0 && !seen[id(c - 1, r)]) nb.push([c - 1, r]);
    if (c < C - 1 && !seen[id(c + 1, r)]) nb.push([c + 1, r]);
    if (r > 0 && !seen[id(c, r - 1)]) nb.push([c, r - 1]);
    if (r < R - 1 && !seen[id(c, r + 1)]) nb.push([c, r + 1]);
    if (!nb.length) {
      stack.pop();
      continue;
    }
    const [nc, nr] = nb[Math.floor(rnd() * nb.length)];
    if (nc > c) right[id(c, r)] = false;
    if (nc < c) right[id(nc, nr)] = false;
    if (nr > r) bottom[id(c, r)] = false;
    if (nr < r) bottom[id(nc, nr)] = false;
    seen[id(nc, nr)] = 1;
    stack.push([nc, nr]);
  }
  // BFS from the start: gives the solution and an order to reveal the walls in
  const start: [number, number] = [0, R - 1];
  const goal: [number, number] = [C - 1, 0];
  const dist = new Int32Array(C * R).fill(-1);
  const prev = new Int32Array(C * R).fill(-1);
  const q: number[] = [id(...start)];
  dist[q[0]] = 0;
  while (q.length) {
    const cur = q.shift()!;
    const c = cur % C;
    const r = (cur / C) | 0;
    const go = (nc: number, nr: number, open: boolean) => {
      const n = id(nc, nr);
      if (open && dist[n] < 0) {
        dist[n] = dist[cur] + 1;
        prev[n] = cur;
        q.push(n);
      }
    };
    if (c < C - 1) go(c + 1, r, !right[cur]);
    if (c > 0) go(c - 1, r, !right[id(c - 1, r)]);
    if (r < R - 1) go(c, r + 1, !bottom[cur]);
    if (r > 0) go(c, r - 1, !bottom[id(c, r - 1)]);
  }
  const order = Array.from({ length: C * R }, (_, i) => i).sort((a, b) => dist[a] - dist[b]);
  let walls = "";
  for (const i of order) {
    const c = i % C;
    const r = (i / C) | 0;
    const x = ox + c * S;
    const y = oy + r * S;
    if (right[i] && c < C - 1) walls += `M${x + S} ${y}V${y + S}`;
    if (bottom[i] && r < R - 1) walls += `M${x} ${y + S}H${x + S}`;
  }
  el("rect", { x: ox, y: oy, width: C * S, height: R * S, class: "pl-line" }, g);
  const drawWalls = drawable(walls, "pl-line", g);
  const path: Pt[] = [];
  for (let n = id(...goal); n >= 0; n = prev[n]) path.unshift([ox + (n % C) * S + S / 2, oy + ((n / C) | 0) * S + S / 2]);
  const sol = new Poly(path);
  const drawGlow = drawable(sol.d(), "pl-glow", g);
  const drawSol = drawable(sol.d(), "pl-gold", g);
  const s0 = path[0];
  const s1 = path[path.length - 1];
  el("rect", { x: s0[0] - 17, y: s0[1] - 17, width: 34, height: 34, class: "pl-thin" }, g);
  el("circle", { cx: s1[0], cy: s1[1], r: 19, class: "pl-thin" }, g);

  const solve = (t: number) => range(t, 0.32, 0.86);
  return {
    r: 10,
    update(t) {
      drawWalls(ease(range(t, 0.02, 0.4)));
      const p = solve(t);
      drawSol(p);
      drawGlow(p);
    },
    dots(t) {
      return [s0, s1, sol.at(solve(t))];
    },
  };
}

/* ───────────────────────── IV. Nantes, 2020 — multi-agent pathfinding ───────────────────────── */
function mapf(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  const S = 64;
  const ox = 116;
  const oy = 108;
  const P = (c: number, r: number): Pt => [ox + c * S, oy + r * S];
  const obstacles = ["2,3", "6,1", "6,4", "11,2", "1,5", "10,6", "4,0"];
  let edges = "";
  for (let r = 0; r < 7; r++) edges += `M${ox} ${oy + r * S}H${ox + 12 * S}`;
  for (let c = 0; c < 13; c++) edges += `M${ox + c * S} ${oy}V${oy + 6 * S}`;
  el("path", { d: edges, class: "pl-faint" }, g);
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 13; c++) {
      const [x, y] = P(c, r);
      if (obstacles.includes(`${c},${r}`)) el("rect", { x: x - 15, y: y - 15, width: 30, height: 30, class: "pl-fill" }, g);
      else el("circle", { cx: x, cy: y, r: 3.4, class: "pl-dot" }, g);
    }
  const walk = (...legs: [number, number][]) => {
    const cells: [number, number][] = [legs[0]];
    for (let i = 1; i < legs.length; i++) {
      let [c, r] = cells[cells.length - 1];
      const [tc, tr] = legs[i];
      while (c !== tc || r !== tr) {
        c += Math.sign(tc - c);
        if (c === tc) r += r === tr ? 0 : Math.sign(tr - r);
        cells.push([c, r]);
      }
    }
    return cells;
  };
  // three agents, three routes that cross without ever sharing a node at the same step
  const routes = [walk([0, 1], [5, 1], [5, 5], [12, 5]), walk([12, 0], [8, 0], [8, 6], [2, 6]), walk([3, 6], [3, 3], [10, 3], [10, 1])];
  const T = 16;
  const trails = routes.map((cells, i) => {
    const poly = new Poly(cells.map(([c, r]) => P(c, r)));
    const [gx, gy] = P(...cells[cells.length - 1]);
    el("rect", { x: gx - 13, y: gy - 13, width: 26, height: 26, class: i === 2 ? "pl-gold" : "pl-thin", fill: "none" }, g);
    return { cells, draw: drawable(poly.d(), i === 2 ? "pl-gold" : "pl-line", g) };
  });
  const tau = (t: number) => ease(range(t, 0.08, 0.86)) * T;
  const pos = (cells: [number, number][], k: number): Pt => {
    const n = cells.length - 1;
    const a = Math.min(Math.floor(k), n);
    const b = Math.min(a + 1, n);
    const f = Math.min(k - a, 1);
    const [x0, y0] = P(...cells[a]);
    const [x1, y1] = P(...cells[b]);
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  };
  return {
    r: 11,
    update(t) {
      const k = tau(t);
      trails.forEach((tr) => tr.draw(k / (tr.cells.length - 1)));
    },
    dots(t) {
      const k = tau(t);
      return routes.map((cells) => pos(cells, k));
    },
  };
}

/* ───────────────────────── V. Odense, 2021 — a robot in a supermarket ───────────────────────── */
function store(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  el("path", { d: "M300 560H40V40H960V560H420", class: "pl-line" }, g);
  for (let i = 0; i < 6; i++) {
    const x = 160 + i * 130;
    el("rect", { x, y: 130, width: 46, height: 280, rx: 3, class: "pl-fill" }, g);
    let d = "";
    for (let y = 170; y < 410; y += 40) d += `M${x} ${y}h46`;
    el("path", { d, class: "pl-faint" }, g);
  }
  // checkouts by the door
  for (let i = 0; i < 3; i++) el("rect", { x: 470 + i * 110, y: 492, width: 70, height: 30, rx: 3, class: "pl-faint" }, g);
  const way: Pt[] = [
    [96, 500],
    [96, 86],
    [248, 86],
    [248, 460],
    [508, 460],
    [508, 86],
    [768, 86],
    [768, 460],
    [900, 460],
    [900, 120],
  ];
  const route = new Poly(rounded(way, 34));
  el("path", { d: route.d(), class: "pl-dash" }, g);
  const drawGlow = drawable(route.d(), "pl-glow", g);
  const drawRoute = drawable(route.d(), "pl-gold", g);
  // a trolley in the next aisle, and the box that says the robot has seen it
  const tx = 378;
  const ty = 262;
  const cart = el("g", { transform: `translate(${tx} ${ty})` }, g);
  el("path", { d: "M-20 -26H20L15 14H-15Z M-20 -26L-26 -36", class: "pl-line" }, cart);
  el("circle", { cx: -11, cy: 22, r: 4, class: "pl-thin" }, cart);
  el("circle", { cx: 11, cy: 22, r: 4, class: "pl-thin" }, cart);
  const box = el("path", {
    d: `M${tx - 44} ${ty - 34}v-16h16M${tx + 28} ${ty - 50}h16v16M${tx + 44} ${ty + 30}v16h-16M${tx - 28} ${ty + 46}h-16v-16`,
    class: "pl-gold",
    opacity: 0,
  }, g);
  const boxO = setter(box, "opacity");
  // the lidar fan in front of the robot
  const fan = el("path", { d: "M0 0L120 -46A128 128 0 0 1 120 46Z", fill: "rgba(232,182,96,0.1)", stroke: "none" }, g);
  const fanT = setter(fan, "transform");

  const drive = (t: number) => ease(range(t, 0.06, 0.88));
  return {
    r: 10,
    update(t) {
      const p = drive(t);
      drawRoute(p);
      drawGlow(p);
      const [x, y] = route.at(p);
      const a = (route.heading(p) * 180) / Math.PI;
      fanT(`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(1)})`);
      const seen = Math.hypot(x - tx, y - ty) < 175 ? 1 : p > 0.42 ? 0.55 : 0;
      boxO(String(seen));
    },
    dots(t) {
      return [way[0], way[way.length - 1], route.at(drive(t))];
    },
  };
}

/* ───────────────────────── VI. Abu Dhabi, 2022 — bird-inspired flocking ───────────────────────── */
function flock(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  // wind lines
  for (let i = 0; i < 5; i++) {
    const y = 110 + i * 95;
    el("path", { d: `M-20 ${y + 40}C220 ${y - 50} 520 ${y + 90} 1020 ${y - 10}`, class: "pl-faint" }, g);
  }
  const c = (s: number): Pt => [110 + 780 * s, 360 - 120 * Math.sin(Math.PI * s) + 40 * Math.sin(3 * Math.PI * s + 0.6)];
  const trail: Pt[] = [];
  for (let s = 0; s <= 1.0001; s += 0.01) trail.push(c(s));
  const trailPoly = new Poly(trail);
  const drawTrail = drawable(trailPoly.d(), "pl-dash", g);
  const rnd = rng(2024);
  const N = 40;
  const slots: { x: number; y: number; ph: number }[] = [];
  const leaders: Pt[] = [
    [34, -42],
    [62, 0],
    [34, 42],
  ];
  while (slots.length < N) {
    const x = -rnd() * 300 + 10;
    const spread = 50 + (-x / 300) * 150;
    const y = (rnd() - 0.5) * 2 * spread;
    if (slots.some((o) => Math.hypot(o.x - x, o.y - y) < 30)) continue;
    if (leaders.some(([lx, ly]) => Math.hypot(lx - x, ly - y) < 34)) continue;
    slots.push({ x, y, ph: rnd() * 6.28 });
  }
  const birds = slots.map(() => el("path", { d: "M-14 -9L0 0L-14 9", class: "pl-line" }, g));
  const sets = birds.map((b) => setter(b, "transform"));
  const sOf = (t: number) => 0.06 + 0.86 * t;
  const frame = (t: number) => {
    const s = sOf(t);
    const p = c(s);
    const q = c(s + 0.004);
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    return { p, a, cos: Math.cos(a), sin: Math.sin(a) };
  };
  return {
    r: 9,
    update(t) {
      const f = frame(t);
      drawTrail(sOf(t));
      slots.forEach((sl, i) => {
        const wx = sl.x + Math.sin(t * 11 + sl.ph) * 6;
        const wy = sl.y + Math.cos(t * 9 + sl.ph * 1.3) * 7;
        const x = f.p[0] + wx * f.cos - wy * f.sin;
        const y = f.p[1] + wx * f.sin + wy * f.cos;
        const a = (f.a * 180) / Math.PI + Math.sin(t * 13 + sl.ph) * 8;
        sets[i](`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(1)})`);
      });
    },
    dots(t) {
      const f = frame(t);
      return leaders.map(([lx, ly]) => [f.p[0] + lx * f.cos - ly * f.sin, f.p[1] + lx * f.sin + ly * f.cos] as Pt);
    },
  };
}

/* ───────────────────────── VII. Abu Dhabi, 2024 — outdoor planning for M4 ───────────────────────── */
function topo(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  const hill = (cx: number, cy: number, n: number, step: number, a: number[], ph: number[]) => {
    for (let k = 1; k <= n; k++) {
      const pts: string[] = [];
      for (let i = 0; i <= 72; i++) {
        const th = (i / 72) * Math.PI * 2;
        const r = k * step * (1 + a[0] * Math.sin(3 * th + ph[0] + k * 0.15) + a[1] * Math.sin(5 * th + ph[1]));
        pts.push(`${(cx + r * Math.cos(th)).toFixed(1)} ${(cy + r * Math.sin(th) * 0.82).toFixed(1)}`);
      }
      el("path", { d: "M" + pts.join("L") + "Z", class: k % 3 === 0 ? "pl-thin" : "pl-faint" }, g);
    }
  };
  hill(300, 250, 8, 27, [0.14, 0.07], [1.1, 0.3]);
  hill(720, 420, 7, 31, [0.12, 0.08], [0.4, 2.0]);
  // the plan: roll, fly over the hill, roll again
  const roll1 = smooth([
    [70, 545],
    [170, 500],
    [250, 470],
  ]);
  const fly: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const x0 = 250;
    const y0 = 470;
    const x1 = 560;
    const y1 = 215;
    fly.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - Math.sin(Math.PI * u) * 150]);
  }
  const roll2 = smooth([
    [560, 215],
    [680, 170],
    [800, 205],
    [935, 105],
  ]);
  const all = new Poly([...roll1, ...fly.slice(1), ...roll2.slice(1)]);
  el("path", { d: all.d(), class: "pl-dash" }, g);
  const L1 = new Poly(roll1);
  const LF = new Poly(fly);
  const L2 = new Poly(roll2);
  const tot = L1.len + LF.len + L2.len;
  const d1 = drawable(L1.d(), "pl-gold", g);
  const d2 = drawable(L2.d(), "pl-gold", g);
  const hops = fly.filter((_, i) => i % 2 === 0).map(([x, y]) => el("circle", { cx: x, cy: y, r: 3.6, class: "pl-goldfill", opacity: 0 }, g));
  const hopO = hops.map((h) => setter(h, "opacity"));
  for (const [x, y] of [
    [250, 470],
    [560, 215],
  ] as Pt[])
    el("path", { d: `M${x - 9} ${y}h18M${x} ${y - 9}v18`, class: "pl-line" }, g);
  const go = (t: number) => ease(range(t, 0.06, 0.88));
  return {
    r: 10,
    update(t) {
      const d = go(t) * tot;
      d1(d / L1.len);
      const fd = (d - L1.len) / LF.len;
      hopO.forEach((s, i) => s(fd >= i / (hops.length - 1) - 0.001 ? "1" : "0"));
      d2((d - L1.len - LF.len) / L2.len);
    },
    dots(t) {
      return [[70, 545], [935, 105], all.at(go(t))];
    },
  };
}

/* ───────────────────────── VIII. Abu Dhabi, 2026 — a swarm that heals itself ───────────────────────── */
function swarm(svg: SVGSVGElement): Plate {
  const g = el("g", {}, svg);
  el("path", { d: "M40 548H960", class: "pl-thin" }, g);
  let pads = "";
  for (let x = 120; x <= 880; x += 95) pads += `M${x - 14} 548v-8M${x + 14} 548v-8`;
  el("path", { d: pads, class: "pl-faint" }, g);
  const N = 30;
  const base: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const r = 262 * Math.sqrt((i + 0.6) / N);
    const th = i * 2.39996 + 0.8;
    base.push([500 + r * Math.cos(th), 268 + r * Math.sin(th) * 0.68]);
  }
  const F = 21; // the drone that faults
  const form = el("g", {}, g);
  let links = "";
  let flinks = "";
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const d = Math.hypot(base[i][0] - base[j][0], base[i][1] - base[j][1]);
      if (d < 100) {
        const seg = `M${base[i][0].toFixed(1)} ${base[i][1].toFixed(1)}L${base[j][0].toFixed(1)} ${base[j][1].toFixed(1)}`;
        if (i === F || j === F) flinks += seg;
        else links += seg;
      }
    }
  el("path", { d: links, class: "pl-faint" }, form);
  const fl = el("path", { d: flinks, class: "pl-faint" }, form);
  const flO = setter(fl, "opacity");
  const glyph = "M-8 -8L8 8M-8 8L8 -8M-12 -8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M4 -8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M-12 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M4 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0";
  const drones = base.map(([x, y], i) => (i < 3 ? null : el("path", { d: glyph, class: "pl-thin", transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, form)));
  const fT = setter(drones[F]!, "transform");
  const ring = el("circle", { r: 20, class: "pl-gold", opacity: 0 }, form);
  const rX = setter(ring, "cx");
  const rY = setter(ring, "cy");
  const rR = setter(ring, "r");
  const rO = setter(ring, "opacity");
  const formT = setter(form, "transform");

  const xf = (t: number) => ({ dy: -24 * t + 10, rot: (5 * t - 2.5) * (Math.PI / 180) });
  const apply = (t: number, [x, y]: Pt): Pt => {
    const { dy, rot } = xf(t);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const px = x - 500;
    const py = y - 290;
    return [500 + px * c - py * s, 290 + px * s + py * c + dy];
  };
  return {
    r: 10,
    update(t) {
      const { dy, rot } = xf(t);
      formT(`translate(0 ${dy.toFixed(1)}) rotate(${((rot * 180) / Math.PI).toFixed(2)} 500 290)`);
      const u = range(t, 0.3, 0.74);
      const k = Math.sin(Math.PI * u);
      const [bx, by] = base[F];
      const x = bx + 74 * k;
      const y = by - 46 * k;
      fT(`translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      flO((1 - k).toFixed(2));
      rX(x.toFixed(1));
      rY(y.toFixed(1));
      rR((22 + 8 * Math.sin(u * Math.PI * 6)).toFixed(1));
      rO((u > 0 && u < 1 ? Math.min(1, k * 2.5) : 0).toFixed(2));
    },
    dots(t) {
      return [apply(t, base[0]), apply(t, base[1]), apply(t, base[2])];
    },
  };
}

const builders: Record<string, (svg: SVGSVGElement) => Plate> = { scope, chip, maze, mapf, store, flock, topo, swarm };

export function buildPlate(kind: string, svg: SVGSVGElement): Plate | undefined {
  const b = builders[kind];
  return b ? b(svg) : undefined;
}
