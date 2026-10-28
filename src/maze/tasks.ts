import * as THREE from "three";
import { BLOCK as SOLID, FLOOR, worldToCell } from "./layout";
import { type Joints, STOW, solveIK } from "./arm";
import { type Spot, BLOCK, BlocksTable, TOP } from "./blocks";
import { type Step as PlanStep, BLOCKS_DOMAIN, blocksProblem, parseDomain, parseProblem, solve } from "./pddl";
import type { Motion, Step } from "./motion";
import type { Fx, Interactable, Trolley } from "./props";

/**
 * Active interactions: what the robot does when you ask it to do something with an object.
 * Each one compiles to a list of motion steps (drive there, line up, move the arm, grip, and
 * callbacks that move objects at the right moment), so the executor runs them like any plan.
 */

export interface IxAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface PddlView {
  domain: string;
  problem: string;
  init: string[][];
  goal: string[][];
  plan: { text: string; state: "todo" | "now" | "done" }[];
  expanded: number;
  grounded: number;
  facts: number;
  running: boolean;
  /** a short line under the plan */
  note: string;
}

export interface TaskHost {
  motion: Motion;
  /** the robot's scale: the arm's IK works in the robot's unscaled frame */
  scale: number;
  grip: THREE.Object3D;
  /** run `before`, plan a drive to a cell, then run `after`; false when there's no way there */
  driveThen(cell: [number, number], before: Step[], after: Step[]): boolean;
  /** run steps right away (no drive) */
  run(steps: Step[]): void;
  goRoom(room: number): void;
  /** a grid cell's content changed (the trolley moved) */
  setCell(x: number, y: number, v: number): void;
  /** what you can do with something changed */
  changed(): void;
  pddl(v: PddlView): void;
  rand(): number;
}

const HALF_PI = Math.PI / 2;

export class Tasks {
  private table?: BlocksTable;
  private trolley?: Trolley;
  ix: Interactable[] = [];
  private pddlView: PddlView | null = null;
  private running: "blocks" | "trolley" | null = null;

  constructor(private host: TaskHost, rooms: Fx[]) {
    for (const f of rooms) {
      if (f.table) this.table = f.table;
      if (f.trolley) this.trolley = f.trolley;
      if (f.ix) this.ix.push(...f.ix);
    }
    if (this.table) this.refreshPddl();
  }

  /** what you can do with an object right now */
  actions(id: string): IxAction[] {
    if (id === "blocks") {
      if (this.running === "blocks") return [{ id: "stop", label: "Stop" }];
      return [
        { id: "solve", label: "Solve with PDDL", primary: true },
        { id: "goal", label: "New goal" },
      ];
    }
    if (id === "trolley" && this.trolley) {
      if (this.running === "trolley") return [];
      if (!this.trolley.docked) return [{ id: "dock", label: "Detect & dock", primary: true }];
      return [
        this.trolley.at === "home"
          ? { id: "push", label: "Push to checkout", primary: true }
          : { id: "back", label: "Push back to the aisle", primary: true },
        { id: "undock", label: "Undock" },
      ];
    }
    const ix = this.ix.find((i) => i.id === id);
    if (ix?.kind === "passive" && id !== "pendulum") return [{ id: "go", label: "Go there" }];
    return [];
  }

  run(id: string, action: string) {
    if (id === "blocks") {
      if (action === "solve") this.solveBlocks();
      else if (action === "goal") this.newGoal();
      else if (action === "stop") this.host.run(this.release());
    } else if (action === "go") {
      const ix = this.ix.find((i) => i.id === id);
      if (ix) this.host.goRoom(ix.room);
    } else if (id === "trolley") {
      if (action === "dock") this.dock();
      else if (action === "push") this.push(true);
      else if (action === "back") this.push(false);
      else if (action === "undock") this.host.run([...this.undockSteps(), this.done()]);
    }
  }

  /** every frame: a docked trolley goes where the robot pushes it */
  update() {
    const t = this.trolley;
    if (!t?.docked) return;
    const m = this.host.motion;
    t.setPose(m.x + Math.cos(m.heading) * DOCK_GAP, m.z + Math.sin(m.heading) * DOCK_GAP);
  }

  get busy() {
    return this.running !== null;
  }

  /**
   * Before the robot does anything else: let go of what it holds. A held block drops back on the
   * table, a docked trolley is released, and the arm folds. Returns the steps to run first.
   */
  release(): Step[] {
    const steps: Step[] = [];
    if (this.table?.holding) this.table.recover();
    if (this.trolley?.docked) steps.push(...this.undockSteps());
    else if (!this.host.motion.stowed || this.host.motion.grip > 0.01)
      steps.push({ kind: "grip", open: 0, dur: 0.15 }, { kind: "arm", q: STOW, dur: 0.45 });
    if (this.running) {
      const v = this.running === "blocks" ? this.pddlView : null;
      this.running = null;
      if (v) {
        // the plan is void now: show where the blocks really are, and what's left undone
        v.running = false;
        for (const p of v.plan) if (p.state === "now") p.state = "todo";
        v.init = this.table!.stacks();
        v.problem = blocksProblem("table", v.init, this.table!.goal);
        v.note = "Stopped. Solve again to finish from here.";
        this.host.pddl(v);
      }
      this.host.changed();
    }
    return steps;
  }

  private done(): Step {
    return {
      kind: "call",
      fn: () => {
        this.running = null;
        this.host.changed();
      },
    };
  }

  /** robot-local, unscaled coordinates of a world point, for a robot standing at (x, z, h) */
  private local(p: THREE.Vector3, x: number, z: number, h: number): [number, number, number] {
    const dx = p.x - x;
    const dz = p.z - z;
    const s = this.host.scale;
    return [(dx * Math.cos(h) + dz * Math.sin(h)) / s, p.y / s, (-dx * Math.sin(h) + dz * Math.cos(h)) / s];
  }
  private ik(p: THREE.Vector3, x: number, z: number, h: number): Joints {
    return solveIK(...this.local(p, x, z, h)).q;
  }

  /** turn to face a point, roll straight to it, then turn to a final heading */
  private approach(x: number, z: number, heading: number, speed = 1.4): Step[] {
    return [
      { kind: "turn", toward: [x, z] },
      { kind: "line", to: [x, z], speed },
      { kind: "turn", heading },
    ];
  }

  /* ---------------------------------------------------------------- blocks world */

  private refreshPddl(plan: PlanStep[] | null = null, expanded = 0, grounded = 0, facts = 0, note = "") {
    const t = this.table!;
    const init = t.stacks();
    this.pddlView = {
      domain: BLOCKS_DOMAIN,
      problem: blocksProblem("table", init, t.goal),
      init,
      goal: t.goal.map((s) => s.slice()),
      plan: (plan ?? []).map((s) => ({ text: `(${s.name} ${s.args.join(" ")})`, state: "todo" as const })),
      expanded,
      grounded,
      facts,
      running: false,
      note,
    };
    this.host.pddl(this.pddlView);
  }

  private newGoal() {
    if (!this.table || this.running) return;
    this.table.newGoal(this.host.rand);
    this.refreshPddl(null, 0, 0, 0, "New goal. Solve to plan it.");
    this.host.changed();
  }

  private solveBlocks() {
    const t = this.table;
    if (!t) return;
    const pre = this.release();
    const domain = parseDomain(BLOCKS_DOMAIN);
    const problemText = blocksProblem("table", t.stacks(), t.goal);
    const res = solve(domain, parseProblem(problemText));
    if (!res.plan) {
      this.refreshPddl(null, res.expanded, res.actions, res.facts, "No plan found.");
      return;
    }
    if (!res.plan.length) {
      this.refreshPddl([], res.expanded, res.actions, res.facts, "Already at the goal. Try a new goal.");
      return;
    }
    this.refreshPddl(res.plan, res.expanded, res.actions, res.facts, "");
    const view = this.pddlView!;
    view.running = true;
    view.note = "Driving to the table.";
    this.host.pddl(view);

    // where the robot works: in front of the table, facing it
    const wx = t.x;
    const wz = t.z - (0.25 + 0.05 + 0.4);
    const wh = HALF_PI;
    const steps: Step[] = [...this.approach(wx, wz, wh, 1.2)];
    steps.push({ kind: "grip", open: 1, dur: 0.2 });

    // simulate the table while compiling, so every motion targets where the blocks will be
    const slots = t.slots.map((s) => s.slice());
    // the carried block has to clear every tower as the arm swings over: its bottom above the tallest
    const top = () => Math.max(...slots.map((s) => s.length)) * BLOCK + TOP;
    const over = (c: THREE.Vector3) => c.clone().setY(Math.max(top() + BLOCK / 2 + 0.07, c.y + 0.12));
    let held = "";
    let from = 0;
    const tick = (i: number, state: "now" | "done") => ({
      kind: "call" as const,
      fn: () => {
        view.plan[i].state = state;
        if (state === "done") view.init = t.stacks();
        view.note = state === "done" && i === view.plan.length - 1 ? `Done: ${view.plan.length} actions.` : "";
        this.host.pddl(view);
      },
    });
    res.plan.forEach((a, i) => {
      steps.push(tick(i, "now"));
      const n = a.args[0];
      if (a.name === "pick-up" || a.name === "unstack") {
        const w = BlocksTable.where(slots, n);
        from = w.slot;
        const c = BlocksTable.centre(slots, t, { slot: w.slot });
        c.y -= BLOCK; // centre() gives the next free level; the block is one below
        const up = over(c);
        steps.push(
          { kind: "arm", q: this.ik(up, wx, wz, wh), dur: 0.55 },
          { kind: "arm", q: this.ik(c, wx, wz, wh), dur: 0.35 },
          { kind: "grip", open: 0, dur: 0.2 },
          { kind: "call", fn: () => t.take(n, this.host.grip) },
          { kind: "arm", q: this.ik(up, wx, wz, wh), dur: 0.35 },
        );
        slots[w.slot].pop();
        held = n;
      } else {
        let spot: Spot;
        if (a.name === "stack") spot = { on: a.args[1] };
        else {
          // the empty slot nearest to where the block came from
          let best = -1;
          slots.forEach((s, k) => {
            if (!s.length && (best < 0 || Math.abs(k - from) < Math.abs(best - from))) best = k;
          });
          spot = { slot: best };
        }
        const c = BlocksTable.centre(slots, t, spot);
        const up = over(c);
        const sp = spot;
        const blk = held;
        steps.push(
          { kind: "arm", q: this.ik(up, wx, wz, wh), dur: 0.55 },
          { kind: "arm", q: this.ik(c, wx, wz, wh), dur: 0.35 },
          { kind: "grip", open: 1, dur: 0.2 },
          { kind: "call", fn: () => t.place(blk, sp) },
          { kind: "arm", q: this.ik(up, wx, wz, wh), dur: 0.3 },
        );
        const slot = "slot" in spot ? spot.slot : BlocksTable.where(slots, spot.on).slot;
        slots[slot].push(held);
        held = "";
      }
      steps.push(tick(i, "done"));
    });
    steps.push(
      { kind: "grip", open: 0, dur: 0.2 },
      { kind: "arm", q: STOW, dur: 0.6 },
      {
        kind: "call",
        fn: () => {
          this.running = null;
          view.running = false;
          view.init = t.stacks();
          view.problem = blocksProblem("table", view.init, t.goal);
          this.host.pddl(view);
          this.host.changed();
        },
      },
    );
    this.running = "blocks";
    this.host.changed();
    const cell = worldToCell(wx, wz);
    if (!this.host.driveThen(cell, pre, steps)) {
      this.running = null;
      view.running = false;
      view.note = "Can't reach the table from here.";
      this.host.pddl(view);
    }
  }

  /* ---------------------------------------------------------------- trolley */

  private dockPose() {
    const t = this.trolley!;
    const c = t.at === "home" ? t.home : t.checkout;
    const h = t.handle(c[0]);
    return { x: h.x - ARM_TO_HANDLE, z: c[1], handle: h };
  }

  private dock() {
    const t = this.trolley;
    if (!t || t.docked || this.running) return;
    const pre = this.release();
    const d = this.dockPose();
    const preX = d.x - 0.65;
    const above = d.handle.clone();
    above.y += 0.14;
    const steps: Step[] = [
      ...this.approach(preX, d.z, 0, 1.2),
      { kind: "call", fn: () => t.status("locked") },
      { kind: "wait", t: 0.25 },
      { kind: "line", to: [d.x, d.z], speed: 0.7 },
      { kind: "grip", open: 1, dur: 0.2 },
      { kind: "arm", q: this.ik(above, d.x, d.z, 0), dur: 0.55 },
      { kind: "arm", q: this.ik(d.handle, d.x, d.z, 0), dur: 0.3 },
      { kind: "grip", open: 0.25, dur: 0.2 },
      {
        kind: "call",
        fn: () => {
          t.docked = true;
          t.status("docked");
          // the robot now carries the trolley's cell with it
          const [hx, hy] = t.at === "home" ? t.homeCell : t.checkoutCell;
          this.host.setCell(hx, hy, FLOOR);
        },
      },
      this.done(),
    ];
    this.running = "trolley";
    this.host.changed();
    if (!this.host.driveThen(worldToCell(preX, d.z), pre, steps)) {
      this.running = null;
      this.host.changed();
    }
  }

  private push(toCheckout: boolean) {
    const t = this.trolley;
    if (!t?.docked || this.running) return;
    const target = toCheckout ? t.checkout : t.home;
    const x = t.handle(target[0]).x - ARM_TO_HANDLE;
    this.running = "trolley";
    this.host.changed();
    this.host.run([
      { kind: "line", to: [x, target[1]], speed: 1.0 },
      {
        kind: "call",
        fn: () => {
          t.at = toCheckout ? "checkout" : "home";
        },
      },
      this.done(),
    ]);
  }

  private undockSteps(): Step[] {
    const t = this.trolley!;
    // stopped halfway? push it on to the nearer spot first, so it never ends up between cells
    const px = t.group.position.x;
    const at = Math.abs(px - t.home[0]) <= Math.abs(px - t.checkout[0]) ? "home" : "checkout";
    const spot = at === "home" ? t.home : t.checkout;
    const x = t.handle(spot[0]).x - ARM_TO_HANDLE;
    const z = spot[1];
    const above = t.handle(spot[0]);
    above.y += 0.16;
    return [
      { kind: "line", to: [x, z], speed: 1.0 },
      { kind: "grip", open: 1, dur: 0.2 },
      { kind: "arm", q: this.ik(above, x, z, 0), dur: 0.3 },
      {
        kind: "call",
        fn: () => {
          t.at = at;
          t.docked = false;
          t.status("idle");
          t.setPose(spot[0], spot[1]);
          // the spot it stands on is an obstacle again
          const [hx, hy] = at === "home" ? t.homeCell : t.checkoutCell;
          this.host.setCell(hx, hy, SOLID);
          this.host.changed();
        },
      },
      { kind: "line", to: [x - 0.45, z], speed: 0.9 },
      { kind: "arm", q: STOW, dur: 0.5 },
    ];
  }
}

/** robot centre to handle, along its heading, when docked: the arm reaches forward and up */
const ARM_TO_HANDLE = 0.385;
/** robot centre to trolley centre when docked */
const DOCK_GAP = ARM_TO_HANDLE + 0.55;
