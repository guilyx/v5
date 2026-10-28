/**
 * A small PDDL planner: an s-expression parser, a grounder, and A* over STRIPS states.
 * The domain and problem it solves are the same text the page shows, parsed at run time.
 * A nod to PythonPDDL, which does this (and much more) with a hand-written parser too.
 *
 * Supports :strips with untyped parameters, conjunctive preconditions and goals, and
 * add/delete effects. Heuristic: h_max, which is admissible, so A* returns optimal plans.
 */

type SExp = string | SExp[];

export function parse(text: string): SExp[] {
  const tokens = text
    .replace(/;[^\n]*/g, "")
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  let i = 0;
  const read = (): SExp => {
    const t = tokens[i++];
    if (t === "(") {
      const list: SExp[] = [];
      while (tokens[i] !== ")") {
        if (i >= tokens.length) throw new Error("PDDL: missing )");
        list.push(read());
      }
      i++;
      return list;
    }
    if (t === ")") throw new Error("PDDL: unexpected )");
    return t;
  };
  const out: SExp[] = [];
  while (i < tokens.length) out.push(read());
  return out;
}

type Atom = string[];
interface Schema {
  name: string;
  params: string[];
  pre: Atom[];
  add: Atom[];
  del: Atom[];
}

const isList = (x: SExp): x is SExp[] => Array.isArray(x);
const atoms = (x: SExp): Atom[] => {
  if (!isList(x) || !x.length) return [];
  if (x[0] === "and") return x.slice(1).flatMap(atoms);
  return [x as Atom];
};
const section = (def: SExp[], key: string) => def.find((d) => isList(d) && d[0] === key) as SExp[] | undefined;

export interface Domain {
  name: string;
  actions: Schema[];
}

export function parseDomain(text: string): Domain {
  const [def] = parse(text) as SExp[][];
  const head = def[1] as SExp[];
  const actions: Schema[] = [];
  for (const d of def.slice(2)) {
    if (!isList(d) || d[0] !== ":action") continue;
    const name = d[1] as string;
    const get = (k: string) => d[d.indexOf(k) + 1];
    const params = (get(":parameters") as string[]) ?? [];
    const eff = get(":effect");
    const add: Atom[] = [];
    const del: Atom[] = [];
    for (const e of isList(eff) && eff[0] === "and" ? eff.slice(1) : [eff]) {
      if (isList(e) && e[0] === "not") del.push(e[1] as Atom);
      else if (isList(e)) add.push(e as Atom);
    }
    actions.push({ name, params, pre: atoms(get(":precondition")), add, del });
  }
  return { name: head[1] as string, actions };
}

export interface Problem {
  objects: string[];
  init: Atom[];
  goal: Atom[];
}

export function parseProblem(text: string): Problem {
  const [def] = parse(text) as SExp[][];
  const objects = (section(def, ":objects") ?? []).slice(1) as string[];
  const init = ((section(def, ":init") ?? []).slice(1) as Atom[]).filter(isList);
  const goal = atoms((section(def, ":goal") ?? [":goal", []])[1]);
  return { objects, init, goal };
}

export interface Step {
  name: string;
  args: string[];
}

export interface PlanResult {
  plan: Step[] | null;
  expanded: number;
  /** ground actions and facts after grounding */
  actions: number;
  facts: number;
}

/** ground the domain over the problem's objects, then A* with h_max */
export function solve(domain: Domain, prob: Problem, maxExpand = 50000): PlanResult {
  const factId = new Map<string, number>();
  const id = (a: Atom) => {
    const k = a.join(" ");
    let v = factId.get(k);
    if (v === undefined) {
      v = factId.size;
      factId.set(k, v);
    }
    return v;
  };
  for (const a of prob.init) id(a);
  for (const a of prob.goal) id(a);

  // grounding: every assignment of objects to parameters
  interface Ground {
    name: string;
    args: string[];
    pre: number[];
    add: number[];
    del: number[];
  }
  const ground: Ground[] = [];
  for (const s of domain.actions) {
    const n = s.params.length;
    const total = prob.objects.length ** n;
    for (let c = 0; c < total; c++) {
      const args: string[] = [];
      let r = c;
      for (let p = 0; p < n; p++) {
        args.push(prob.objects[r % prob.objects.length]);
        r = Math.floor(r / prob.objects.length);
      }
      const bind = (a: Atom) => a.map((t) => (t.startsWith("?") ? args[s.params.indexOf(t)] : t));
      ground.push({ name: s.name, args, pre: s.pre.map((a) => id(bind(a))), add: s.add.map((a) => id(bind(a))), del: s.del.map((a) => id(bind(a))) });
    }
  }
  const F = factId.size;
  const goal = prob.goal.map(id);

  // h_max: the cost of the most expensive goal fact in the delete relaxation
  const cost = new Float64Array(F);
  const hmax = (state: Uint8Array) => {
    cost.fill(Infinity);
    for (let f = 0; f < F; f++) if (state[f]) cost[f] = 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (const a of ground) {
        let c = 0;
        for (const p of a.pre) c = Math.max(c, cost[p]);
        if (c === Infinity) continue;
        for (const e of a.add)
          if (cost[e] > c + 1) {
            cost[e] = c + 1;
            changed = true;
          }
      }
    }
    let h = 0;
    for (const gf of goal) h = Math.max(h, cost[gf]);
    return h;
  };

  const start = new Uint8Array(F);
  for (const a of prob.init) start[id(a)] = 1;
  const key = (s: Uint8Array) => s.join("");
  const isGoal = (s: Uint8Array) => goal.every((g) => s[g]);

  interface Node {
    s: Uint8Array;
    g: number;
    f: number;
    parent: Node | null;
    act: Ground | null;
  }
  const open: Node[] = [];
  const push = (n: Node) => {
    open.push(n);
    let k = open.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (open[p].f < open[k].f || (open[p].f === open[k].f && open[p].g >= open[k].g)) break;
      [open[p], open[k]] = [open[k], open[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        const better = (a: number, b: number) => open[a].f < open[b].f || (open[a].f === open[b].f && open[a].g > open[b].g);
        if (l < open.length && better(l, m)) m = l;
        if (r < open.length && better(r, m)) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k], open[m]];
        k = m;
      }
    }
    return top;
  };

  const best = new Map<string, number>();
  push({ s: start, g: 0, f: hmax(start), parent: null, act: null });
  best.set(key(start), 0);
  let expanded = 0;
  while (open.length && expanded < maxExpand) {
    const n = pop();
    if ((best.get(key(n.s)) ?? Infinity) < n.g) continue;
    expanded++;
    if (isGoal(n.s)) {
      const plan: Step[] = [];
      for (let c: Node | null = n; c && c.act; c = c.parent) plan.push({ name: c.act.name, args: c.act.args });
      plan.reverse();
      return { plan, expanded, actions: ground.length, facts: F };
    }
    for (const a of ground) {
      if (!a.pre.every((p) => n.s[p])) continue;
      const s = n.s.slice();
      for (const d of a.del) s[d] = 0;
      for (const ad of a.add) s[ad] = 1;
      const k = key(s);
      const g = n.g + 1;
      if ((best.get(k) ?? Infinity) <= g) continue;
      best.set(k, g);
      const h = hmax(s);
      if (h === Infinity) continue;
      push({ s, g, f: g + h, parent: n, act: a });
    }
  }
  return { plan: null, expanded, actions: ground.length, facts: F };
}

/* ------------------------------------------------------------------ the blocks world on Centrale's table */

export const BLOCKS_DOMAIN = `(define (domain blocks)
  (:requirements :strips)
  (:predicates (on ?x ?y) (ontable ?x) (clear ?x) (holding ?x) (handempty))
  (:action pick-up
    :parameters (?x)
    :precondition (and (clear ?x) (ontable ?x) (handempty))
    :effect (and (holding ?x) (not (ontable ?x)) (not (clear ?x)) (not (handempty))))
  (:action put-down
    :parameters (?x)
    :precondition (holding ?x)
    :effect (and (ontable ?x) (clear ?x) (handempty) (not (holding ?x))))
  (:action stack
    :parameters (?x ?y)
    :precondition (and (holding ?x) (clear ?y))
    :effect (and (on ?x ?y) (clear ?x) (handempty) (not (holding ?x)) (not (clear ?y))))
  (:action unstack
    :parameters (?x ?y)
    :precondition (and (on ?x ?y) (clear ?x) (handempty))
    :effect (and (holding ?x) (clear ?y) (not (on ?x ?y)) (not (clear ?x)) (not (handempty)))))`;

/** stacks bottom to top, e.g. [["b", "a"], ["c"], ["d"]] */
export type Stacks = string[][];

export function blocksProblem(name: string, init: Stacks, goal: Stacks) {
  const objs = init.flat();
  const facts = (st: Stacks, withState: boolean) => {
    const out: string[] = [];
    for (const s of st)
      s.forEach((b, i) => {
        out.push(i === 0 ? `(ontable ${b})` : `(on ${b} ${s[i - 1]})`);
        if (withState && i === s.length - 1) out.push(`(clear ${b})`);
      });
    return out;
  };
  return `(define (problem ${name})
  (:domain blocks)
  (:objects ${objs.join(" ")})
  (:init (handempty)
    ${facts(init, true).join(" ")})
  (:goal (and ${facts(goal, false).join(" ")})))`;
}
