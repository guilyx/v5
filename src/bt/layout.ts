import { isShown, type BTNode } from "./model";

/**
 * Two layouts of the same tree.
 *  - wide: left-to-right, like Groot's horizontal layout. Depth goes right, siblings
 *    stack down, a parent sits level with its first child. Edges leave a parent's
 *    right port, run down their own lane (a ribbon cable, never crossing) and turn
 *    into the child's left port.
 *  - narrow (phones): an indented outline. Every child hangs off its parent's trunk.
 */
export type Mode = "wide" | "narrow";

export interface Pt {
  x: number;
  y: number;
}

export interface Edge {
  parent: BTNode;
  child: BTNode;
  /** x,y pairs (board px) */
  pts: number[];
  /** cumulative length per point */
  cum: number[];
  len: number;
  lane: number;
}

export const PORT_Y = 34;
const WIDE_COLS = [284, 270, 370, 410, 380];
const WIDE_GAP = 112;
const NARROW_BASE = 352;
const NARROW_IND = 24;

export function colX(depth: number): number {
  let x = 0;
  for (let i = 0; i < depth; i++) x += (WIDE_COLS[i] ?? 380) + WIDE_GAP;
  return x;
}

export function cardWidth(n: BTNode, mode: Mode): number {
  if (mode === "narrow") return NARROW_BASE - n.depth * NARROW_IND;
  if (n.type === "project") return 540;
  return WIDE_COLS[n.depth] ?? 380;
}

/** lays the shown nodes out; returns the bounds */
export function layoutTree(nodes: BTNode[], mode: Mode) {
  const root = nodes[0];
  const hasKids = (n: BTNode) => n.open && n.kids.length > 0;
  if (mode === "wide") {
    const place = (n: BTNode, y: number): number => {
      n.x = colX(n.depth);
      n.y = y;
      if (!hasKids(n)) return y + n.h;
      let cy = y;
      let end = y;
      n.kids.forEach((k, i) => {
        if (i) cy += n.depth === 0 ? 170 : hasKids(n.kids[i - 1]) || k.steps.length ? 110 : 18;
        end = place(k, cy);
        cy = end;
      });
      return Math.max(y + n.h, end);
    };
    place(root, 0);
  } else {
    const place = (n: BTNode, y: number): number => {
      n.x = n.depth * NARROW_IND;
      n.y = y;
      let cy = y + n.h;
      if (!hasKids(n)) return cy;
      cy += 14;
      n.kids.forEach((k, i) => {
        if (i) cy += n.depth === 0 ? 44 : hasKids(n.kids[i - 1]) ? 30 : 12;
        cy = place(k, cy);
      });
      return cy;
    };
    place(root, 0);
  }
  return boundsOf(nodes.filter(isShown));
}

export function boundsOf(list: BTNode[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of list) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { x0, y0, x1, y1 };
}

/** a node's subtree as drawn right now */
export function subtree(n: BTNode): BTNode[] {
  const out: BTNode[] = [n];
  if (n.open) for (const k of n.kids) out.push(...subtree(k));
  return out;
}

// ─── ports and edges ────────────────────────────────────────────────────────────

/** positions use the animated coordinates (ax, ay) */
export function inPort(n: BTNode): Pt {
  return { x: n.ax, y: n.ay + PORT_Y };
}
export function outPort(n: BTNode, mode: Mode): Pt {
  return mode === "wide" ? { x: n.ax + n.w, y: n.ay + PORT_Y } : { x: n.ax + 13, y: n.ay + n.h };
}

function arc(pts: number[], cx: number, cy: number, r: number, a0: number, a1: number, seg = 7) {
  for (let i = 1; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

/** down a vertical lane at x from (x0,y0) to (x1,y1): horizontal, corner, vertical, corner, horizontal */
function laneRoute(pts: number[], x0: number, y0: number, lane: number, x1: number, y1: number) {
  const dy = y1 - y0;
  if (Math.abs(dy) < 0.5) {
    pts.push(x1, y1);
    return;
  }
  const down = dy > 0 ? 1 : -1;
  const goingLeft = lane < x0;
  const r = Math.max(0, Math.min(16, Math.abs(dy) / 2, Math.abs(lane - x0) - 0.5, Math.abs(x1 - lane) - 0.5));
  if (r < 1) {
    pts.push(lane, y0, lane, y1, x1, y1);
    return;
  }
  const hx = goingLeft ? -1 : 1;
  // first corner: arrive horizontally, leave vertically
  pts.push(lane - hx * r, y0);
  arc(pts, lane - hx * r, y0 + down * r, r, down > 0 ? -Math.PI / 2 : Math.PI / 2, hx > 0 ? 0 : down > 0 ? -Math.PI : Math.PI, 7);
  pts.push(lane, y1 - down * r);
  // second corner: arrive vertically, leave horizontally to the right
  arc(pts, lane + r, y1 - down * r, r, Math.PI, down > 0 ? Math.PI / 2 : (3 * Math.PI) / 2, 7);
  pts.push(x1, y1);
}

function measure(pts: number[]) {
  const cum: number[] = [0];
  let L = 0;
  for (let i = 2; i < pts.length; i += 2) {
    L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    cum.push(L);
  }
  return { cum, len: L };
}

export function buildEdges(nodes: BTNode[], mode: Mode): Edge[] {
  const edges: Edge[] = [];
  const visit = (p: BTNode) => {
    if (!p.open || !p.kids.length) return;
    const n = p.kids.length;
    const P = outPort(p, mode);
    // later siblings first, so an earlier (already ticked) edge draws over a shared trunk
    for (let i = n - 1; i >= 0; i--) {
      const c = p.kids[i];
      const C = inPort(c);
      const pts: number[] = [P.x, P.y];
      let lane: number;
      if (mode === "wide") {
        const gap = Math.min(8, 40 / Math.max(1, n - 1));
        lane = P.x + 22 + (n - 1 - i) * gap;
        laneRoute(pts, P.x, P.y, lane, C.x, C.y);
      } else {
        lane = P.x;
        const r = Math.max(1, Math.min(10, C.x - lane - 1, C.y - P.y));
        pts.push(lane, C.y - r);
        arc(pts, lane + r, C.y - r, r, Math.PI, Math.PI / 2, 6);
        pts.push(C.x, C.y);
      }
      const m = measure(pts);
      edges.push({ parent: p, child: c, pts, cum: m.cum, len: m.len, lane });
    }
    for (const c of p.kids) visit(c);
  };
  visit(nodes[0]);
  return edges;
}

/** point and heading at distance d along a polyline */
export function along(pts: number[], cum: number[], d: number, out: { x: number; y: number; a: number }) {
  const L = cum[cum.length - 1];
  const t = Math.max(0, Math.min(L, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = (t - cum[i - 1]) / seg;
  const x0 = pts[(i - 1) * 2];
  const y0 = pts[(i - 1) * 2 + 1];
  const x1 = pts[i * 2];
  const y1 = pts[i * 2 + 1];
  out.x = x0 + (x1 - x0) * u;
  out.y = y0 + (y1 - y0) * u;
  if (x1 !== x0 || y1 !== y0) out.a = Math.atan2(y1 - y0, x1 - x0);
  return out;
}

// ─── the robot's routes ────────────────────────────────────────────────────────

export interface Route {
  pts: number[];
  cum: number[];
  len: number;
}

const STATION_BACK = { wide: 44, narrow: 18 };

/** where the robot waits for a node: on its incoming edge, just before the port */
export function station(n: BTNode, edges: Map<BTNode, Edge>, mode: Mode): Pt {
  const e = edges.get(n);
  if (!e) return { x: n.ax - 34, y: n.ay + PORT_Y };
  const o = { x: 0, y: 0, a: 0 };
  along(e.pts, e.cum, e.len - STATION_BACK[mode], o);
  return { x: o.x, y: o.y };
}

/** follows the drawn edges from one node's station to another's */
export function route(from: BTNode, to: BTNode, edges: Map<BTNode, Edge>, mode: Mode): Route {
  const pts: number[] = [];
  const push = (x: number, y: number) => {
    const n = pts.length;
    if (n && Math.abs(pts[n - 2] - x) < 0.01 && Math.abs(pts[n - 1] - y) < 0.01) return;
    pts.push(x, y);
  };
  const s0 = station(from, edges, mode);
  push(s0.x, s0.y);

  const anc = new Set<BTNode>();
  for (let a: BTNode | null = from; a; a = a.parent) anc.add(a);
  const chain: BTNode[] = [];
  for (let a: BTNode | null = to; a; a = a.parent) chain.unshift(a);
  const bi = chain.findIndex((c) => !anc.has(c));
  if (bi < 0) {
    const m = measure(pts);
    return { pts, ...m };
  }
  const B = chain[bi];
  let cur: BTNode;
  if (B.parent === from) {
    // down into a child: through the card, out of its port
    const i = inPort(from);
    const o = outPort(from, mode);
    push(i.x, i.y);
    push(o.x, o.y);
    cur = from;
  } else {
    // hop: back along our own edge to the lane of the target branch, then down it
    const e = edges.get(B)!;
    const tmp: number[] = [];
    const end = inPort(B);
    laneRoute(tmp, s0.x, s0.y, e.lane, end.x, end.y);
    for (let k = 0; k < tmp.length; k += 2) push(tmp[k], tmp[k + 1]);
    if (B === to) return trimTo(pts, station(to, edges, mode));
    const o = outPort(B, mode);
    push(o.x, o.y);
    cur = B;
  }
  for (let k = chain.indexOf(cur) + 1; k < chain.length; k++) {
    const c = chain[k];
    const e = edges.get(c)!;
    for (let j = 0; j < e.pts.length; j += 2) push(e.pts[j], e.pts[j + 1]);
    if (c !== to) {
      const o = outPort(c, mode);
      push(o.x, o.y);
    }
  }
  return trimTo(pts, station(to, edges, mode));
}

/** cut the route where it reaches the target station */
function trimTo(pts: number[], s: Pt): Route {
  // find the closest point on the last segments to the station and stop there
  let best = pts.length - 2;
  let bestD = Infinity;
  let bx = s.x;
  let by = s.y;
  for (let i = pts.length - 4; i >= Math.max(0, pts.length - 40); i -= 2) {
    const x0 = pts[i];
    const y0 = pts[i + 1];
    const x1 = pts[i + 2];
    const y1 = pts[i + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((s.x - x0) * dx + (s.y - y0) * dy) / l2));
    const px = x0 + dx * u;
    const py = y0 + dy * u;
    const d = Math.hypot(px - s.x, py - s.y);
    if (d < bestD - 1e-6) {
      bestD = d;
      best = i;
      bx = px;
      by = py;
    }
  }
  const out = pts.slice(0, best + 2);
  out.push(bx, by);
  const m = measure(out);
  return { pts: out, ...m };
}
