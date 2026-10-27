/**
 * The tree is the markup: nested <ol>/<li> with one <article class="node"> each,
 * the way a BehaviorTree.CPP XML nests its nodes. This reads it back, and works out
 * when every node starts RUNNING and returns SUCCESS during the replay.
 *
 * Time here is "progress": 0 at the top of the page, +1 per tick (one chapter).
 */

export const IDLE = 0;
export const RUNNING = 1;
export const SUCCESS = 2;
export type Status = 0 | 1 | 2;

export interface BTNode {
  id: string;
  el: HTMLElement;
  type: string;
  parent: BTNode | null;
  kids: BTNode[];
  depth: number;
  /** progress at which it starts RUNNING / returns SUCCESS (Infinity = never) */
  run: number;
  ok: number;
  /** the ticks this node is the focus of */
  steps: number[];
  /** has children hidden until clicked */
  collapsible: boolean;
  open: boolean;
  status: Status;
  /** layout (board px): size, target position, and the animated position */
  w: number;
  h: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
  /** projected scale last frame, for culling and level of detail */
  vis: boolean;
  index: number;
}

export function readTree(root: HTMLElement): BTNode[] {
  const all: BTNode[] = [];
  const walk = (li: Element, parent: BTNode | null, depth: number) => {
    const el = li.querySelector(":scope > .node") as HTMLElement | null;
    if (!el) return;
    const d = el.dataset;
    const node: BTNode = {
      id: d.id!,
      el,
      type: d.type ?? "action",
      parent,
      kids: [],
      depth,
      run: d.run ? Number(d.run) : NaN,
      ok: d.ok ? Number(d.ok) : NaN,
      steps: d.step ? d.step.split(/\s+/).map(Number) : [],
      collapsible: !!d.more,
      open: !d.more,
      status: IDLE,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      ax: NaN,
      ay: NaN,
      vis: true,
      index: all.length,
    };
    if (d.final === "running") node.ok = Infinity;
    all.push(node);
    if (parent) parent.kids.push(node);
    const kids = li.querySelector(":scope > ol.kids");
    if (kids) for (const k of Array.from(kids.children)) walk(k, node, depth + 1);
  };
  const first = root.querySelector(":scope > li");
  if (first) walk(first, null, 0);
  timeTree(all);
  return all;
}

/**
 * Chapters say which tick they belong to; their children are timed from the parent's
 * semantics. A Sequence runs its children one after the other; a Parallel starts them
 * all at once and they finish one by one. Nothing ever fails: every condition in this
 * tree held, and the replay only shows what happened.
 */
function timeTree(all: BTNode[]) {
  for (const n of all) {
    if (!n.steps.length) continue;
    const k = n.steps[0];
    const span = n.steps.length;
    if (Number.isNaN(n.run)) n.run = k + 0.27;
    if (Number.isNaN(n.ok)) n.ok = k + span - 0.1;
    const a = k + 0.36;
    const b = k + span - 0.16;
    const kids = n.kids;
    const m = kids.length;
    kids.forEach((c, i) => {
      if (n.type === "parallel") {
        if (Number.isNaN(c.run)) c.run = a;
        if (Number.isNaN(c.ok)) c.ok = a + 0.08 + ((b - a - 0.08) * (i + 1)) / m;
      } else {
        const slot = (b - a) / m;
        if (Number.isNaN(c.run)) c.run = a + slot * i;
        if (Number.isNaN(c.ok)) c.ok = a + slot * (i + 0.82);
      }
    });
  }
  // anything left (expanded papers, …) mirrors its parent
  for (const n of all) {
    if (Number.isNaN(n.run)) n.run = n.parent ? n.parent.run : 0;
    if (Number.isNaN(n.ok)) n.ok = n.parent ? n.parent.ok : Infinity;
  }
}

export function statusAt(n: BTNode, p: number): Status {
  return p >= n.ok ? SUCCESS : p >= n.run ? RUNNING : IDLE;
}

/** visible = not inside a collapsed node */
export function isShown(n: BTNode): boolean {
  for (let a = n.parent; a; a = a.parent) if (!a.open) return false;
  return true;
}
