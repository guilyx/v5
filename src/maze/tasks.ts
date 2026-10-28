import * as THREE from "three";
import { BLOCK as SOLID, FLOOR, type Maze, worldToCell } from "./layout";
import { ARM_BASE, type Joints, STOW, solveIK } from "./arm";
import { DECK_RISE, DECK_TOP } from "./m4";
import { DockFx, type Pose2, angleDiff, cameraEstimate, denseScan, icp } from "./dock";
import { type Spot, BLOCK, BlocksTable, TOP } from "./blocks";
import { type Step as PlanStep, BLOCKS_DOMAIN, blocksProblem, parseDomain, parseProblem, solve } from "./pddl";
import type { Motion, Step } from "./motion";
import { type Fx, type Interactable, TROLLEY, type Trolley } from "./props";

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
  maze: Maze;
  motion: Motion;
  /** where the LiDAR is, in world space */
  lidarAt(): { x: number; z: number; y: number };
  /** the robot's camera, posed where its lens is */
  eye(): THREE.PerspectiveCamera;
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
  /** the trolley's pose in the robot's frame, while it's lifted or hooked */
  private rel: Pose2 | null = null;
  /** the grip point on the handle, robot-local and unscaled, while hooked */
  private hookLocal: [number, number, number] = [0.3, 0.7, -0.16];
  /** what the docking perception shows */
  fx = new DockFx();

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
      const t = this.trolley;
      if (this.running === "trolley") return [{ id: "stop", label: "Stop" }];
      const there = t.at === "home" ? "to checkout" : "back";
      if (t.mode === "lifted")
        return [
          { id: "carry", label: `Carry it ${there}`, primary: true },
          { id: "down", label: "Put it down" },
        ];
      if (t.mode === "hooked")
        return [
          { id: "drag", label: t.at === "home" ? "Push it to checkout" : "Pull it back", primary: true },
          { id: "unhook", label: "Let go" },
        ];
      return [
        { id: "lidar", label: "Dock under · LiDAR + ICP", primary: true },
        { id: "camera", label: "Dock under · camera" },
        { id: "hook", label: "Hook the handle · camera" },
      ];
    }
    const ix = this.ix.find((i) => i.id === id);
    const own = ix?.actions?.() ?? [];
    if (ix?.kind === "passive" && id !== "pendulum") return [...own, { id: "go", label: "Go there" }];
    return own;
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
      if (action === "lidar") this.dockLidar();
      else if (action === "camera") this.viaCamera("under");
      else if (action === "hook") this.viaCamera("hook");
      else if (action === "carry" || action === "drag") this.move();
      else if (action === "down" || action === "unhook" || action === "stop") this.host.run([...this.release(), this.done()]);
    } else {
      // things that act on their own (the swarm's faults)
      this.ix.find((i) => i.id === id)?.run?.(action);
      this.host.changed();
    }
  }

  /** every frame: a lifted or hooked trolley goes where the robot takes it */
  update(now: number) {
    const t = this.trolley;
    if (t && t.mode !== "free" && this.rel) {
      const m = this.host.motion;
      const S = this.host.scale;
      const c = Math.cos(m.heading);
      const sn = Math.sin(m.heading);
      const r = this.rel;
      // on the deck: it rises once the deck reaches the frame
      const lift = t.mode === "lifted" ? Math.max(0, (DECK_TOP + 0.005 + DECK_RISE * m.lift) * S - TROLLEY.frameY) : 0;
      t.setPose(m.x + r.x * c - r.z * sn, m.z + r.x * sn + r.z * c, m.heading + r.yaw, lift);
    }
    if (t) this.fx.at.set(t.pose.x, 1.75, t.pose.z);
    return this.fx.update(now);
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
    const m = this.host.motion;
    if (this.table?.holding) this.table.recover();
    if (this.trolley?.mode === "lifted") steps.push(...this.putDownSteps());
    else if (this.trolley?.mode === "hooked") steps.push(...this.unhookSteps());
    else {
      if (!m.stowed || m.grip > 0.01) steps.push({ kind: "grip", open: 0, dur: 0.15 }, { kind: "arm", q: STOW, dur: 0.45 });
      if (m.lift > 0.01) steps.push({ kind: "lift", to: 0, dur: 0.6 });
      if (this.running === "trolley") {
        this.trolley?.status("idle");
        this.fx.clear();
      }
    }
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
    // stand so the arm, on the robot's left side, is centred on the table
    const wh = HALF_PI;
    const wx = t.x + ARM_BASE.z * this.host.scale * Math.sin(wh);
    const wz = t.z - (0.25 + 0.05 + 0.4);
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

  /** where the map says the trolley is: the middle of its spot, square to the aisle */
  private prior(): Pose2 {
    const t = this.trolley!;
    const c = t.at === "home" ? t.home : t.checkout;
    return { x: c[0], z: c[1], yaw: 0 };
  }
  private behind(p: Pose2, d: number): [number, number] {
    return [p.x - Math.cos(p.yaw) * d, p.z - Math.sin(p.yaw) * d];
  }
  private start(): boolean {
    const t = this.trolley;
    if (!t || t.mode !== "free" || this.running) return false;
    this.fx.clear();
    return true;
  }
  private fail(why: string) {
    this.fx.say("Docking", [why], "#e4572e");
    this.trolley?.status("idle");
    this.running = null;
    this.host.changed();
  }

  /** LiDAR: look at it from behind its spot, find the bright legs, fit them with ICP, go under */
  private dockLidar() {
    if (!this.start()) return;
    const t = this.trolley!;
    const pre = this.release();
    const prior = this.prior();
    const [sx, sz] = this.behind(prior, 1.5);
    const steps: Step[] = [
      ...this.approach(sx, sz, prior.yaw, 1.2),
      {
        kind: "call",
        fn: () => {
          t.status("scanning");
          this.fx.say("LiDAR + ICP", ["One sweep: looking for bright returns"], "#e8850f");
        },
      },
      { kind: "wait", t: 0.5 },
      { kind: "call", fn: () => this.icpThenDock() },
    ];
    this.running = "trolley";
    this.host.changed();
    if (!this.host.driveThen(worldToCell(sx, sz), pre, steps)) this.fail("Can't get behind it from here.");
  }

  private icpThenDock() {
    const t = this.trolley!;
    const o = this.host.lidarAt();
    const pts = denseScan(this.host.maze, o.x, o.z, this.host.motion.heading, t.legs(), [t.pose.x, t.pose.z], this.host.rand);
    this.fx.showScan(pts, o.y);
    const res = icp(
      pts.filter((p) => p.hot),
      this.prior(),
      o,
    );
    if (!res) return this.fail("Not enough reflective legs in view.");
    this.fx.showIcp(res);
    this.host.run(this.underSteps(res.pose, "LiDAR + ICP", this.fx.icpDuration + 0.4));
  }

  /** camera: look from further back, then again from the pre-dock pose, then go under or hook it */
  private viaCamera(goal: "under" | "hook") {
    if (!this.start()) return;
    const t = this.trolley!;
    const pre = this.release();
    const prior = this.prior();
    const [vx, vz] = this.behind(prior, 2.6);
    const steps: Step[] = [
      ...this.approach(vx, vz, prior.yaw, 1.2),
      {
        kind: "call",
        fn: () => {
          t.status("scanning");
          this.fx.say("Camera", ["Looking for the legs' feet in the image"]);
        },
      },
      { kind: "wait", t: 0.5 },
      { kind: "call", fn: () => this.cameraLook(goal, 1) },
    ];
    this.running = "trolley";
    this.host.changed();
    if (!this.host.driveThen(worldToCell(vx, vz), pre, steps)) this.fail("Can't get a view of it from here.");
  }

  private cameraLook(goal: "under" | "hook", stage: number) {
    const t = this.trolley!;
    const est = cameraEstimate(this.host.eye(), this.host.maze, t.legs(), this.host.rand);
    if (!est) return this.fail("Fewer than three legs in view.");
    this.fx.showCamera(est, stage);
    if (stage === 1) {
      // nearer, each pixel covers less floor: drive in along this estimate's axis and look again,
      // from just far enough that the near legs' feet are still in the bottom of the image
      const [nx, nz] = this.behind(est.pose, 2.0);
      this.host.run([
        { kind: "wait", t: 1.4 },
        ...this.approach(nx, nz, est.pose.yaw, 0.9),
        { kind: "wait", t: 0.3 },
        { kind: "call", fn: () => this.cameraLook(goal, 2) },
      ]);
    } else this.host.run(goal === "under" ? this.underSteps(est.pose, "Camera", 1.6) : this.hookSteps(est.pose, 1.6));
  }

  /** from an estimate: line up behind it, drive in under the frame, measure, lift */
  private underSteps(est: Pose2, method: string, delay: number): Step[] {
    const t = this.trolley!;
    const [px, pz] = this.behind(est, 1.45);
    return [
      { kind: "wait", t: delay },
      { kind: "call", fn: () => t.status("locked") },
      ...this.approach(px, pz, est.yaw, 0.8),
      { kind: "line", to: [est.x, est.z], speed: 0.5 },
      {
        kind: "call",
        fn: () => {
          const m = this.host.motion;
          // how well it did, against where the trolley really is (the robot never knows this)
          this.fx.result(method, Math.hypot(m.x - t.pose.x, m.z - t.pose.z), angleDiff(m.heading, t.pose.yaw));
          this.attach("lifted");
        },
      },
      { kind: "lift", to: 1, dur: 1.0 },
      this.done(),
    ];
  }

  /** from an estimate: stand behind the handle, reach it with the arm, close the gripper */
  private hookSteps(est: Pose2, delay: number): Step[] {
    const t = this.trolley!;
    const S = this.host.scale;
    const [hx, hz] = this.behind(est, HOOK_GAP);
    // the bar runs across the trolley; grip it in line with the arm, which is off to the robot's left
    const side = ARM_BASE.z * S;
    const grip = new THREE.Vector3(
      est.x + Math.cos(est.yaw) * TROLLEY.handleX - Math.sin(est.yaw) * side,
      TROLLEY.handleY,
      est.z + Math.sin(est.yaw) * TROLLEY.handleX + Math.cos(est.yaw) * side,
    );
    const above = grip.clone().setY(grip.y + 0.16);
    // where the gripper holds the bar, in the robot's frame: letting go starts from there
    this.hookLocal = this.local(grip, hx, hz, est.yaw);
    return [
      { kind: "wait", t: delay },
      { kind: "call", fn: () => t.status("locked") },
      ...this.approach(hx, hz, est.yaw, 0.7),
      { kind: "grip", open: 1, dur: 0.2 },
      { kind: "arm", q: this.ik(above, hx, hz, est.yaw), dur: 0.6 },
      { kind: "arm", q: this.ik(grip, hx, hz, est.yaw), dur: 0.35 },
      { kind: "grip", open: 0.3, dur: 0.2 },
      {
        kind: "call",
        fn: () => {
          // the gripper can sit anywhere along the bar: what counts is how far off it is across it
          const h = t.handle();
          const across = Math.abs((grip.x - h.x) * Math.cos(t.pose.yaw) + (grip.z - h.z) * Math.sin(t.pose.yaw));
          this.fx.result("Camera", across, angleDiff(this.host.motion.heading, t.pose.yaw), "Hooked: gripper across the bar");
          this.attach("hooked");
        },
      },
      this.done(),
    ];
  }

  /** the trolley rides with the robot from here: lifted on the deck, or hooked to the arm */
  private attach(mode: "lifted" | "hooked") {
    const t = this.trolley!;
    const m = this.host.motion;
    const dx = t.pose.x - m.x;
    const dz = t.pose.z - m.z;
    const c = Math.cos(m.heading);
    const sn = Math.sin(m.heading);
    this.rel = { x: dx * c + dz * sn, z: -dx * sn + dz * c, yaw: t.pose.yaw - m.heading };
    t.mode = mode;
    t.status(mode);
    // its spot is free while it travels
    const [cx, cy] = t.at === "home" ? t.homeCell : t.checkoutCell;
    this.host.setCell(cx, cy, FLOOR);
    this.host.changed();
  }

  /** where the robot has to be (facing +x) for the trolley it carries to sit on a spot */
  private robotFor(spot: [number, number]): [number, number] {
    const r = this.rel!;
    return [spot[0] - r.x, spot[1] - r.z];
  }

  /** carry or drag it to the other spot, square to the aisle */
  private move() {
    const t = this.trolley!;
    if (t.mode === "free" || this.running) return;
    const to = t.at === "home" ? "checkout" : "home";
    const [x, z] = this.robotFor(to === "home" ? t.home : t.checkout);
    this.running = "trolley";
    this.host.changed();
    this.host.run([
      { kind: "turn", heading: 0 },
      { kind: "line", to: [x, z], speed: t.mode === "lifted" ? 0.9 : 0.75 },
      { kind: "call", fn: () => (t.at = to) },
      this.done(),
    ]);
  }

  /**
   * If it's between spots, take it on to the nearer one. Returns the steps, and where the robot
   * ends up, so what follows can be planned now (these steps run ahead of whatever comes next).
   */
  private finishAt(): { steps: Step[]; x: number; z: number; h: number } {
    const t = this.trolley!;
    const m = this.host.motion;
    const near = Math.abs(t.pose.x - t.home[0]) <= Math.abs(t.pose.x - t.checkout[0]) ? "home" : "checkout";
    const spot = near === "home" ? t.home : t.checkout;
    const steps: Step[] = [];
    let end = { x: m.x, z: m.z, h: m.heading };
    if (Math.hypot(t.pose.x - spot[0], t.pose.z - spot[1]) > 0.05) {
      const [x, z] = this.robotFor(spot);
      steps.push({ kind: "turn", heading: 0 }, { kind: "line", to: [x, z], speed: 0.8 });
      end = { x, z, h: 0 };
    }
    steps.push({ kind: "call", fn: () => (t.at = near) });
    return { steps, ...end };
  }

  /** the trolley stands on its own again: it settles a little, and its spot is an obstacle */
  private detach() {
    const t = this.trolley!;
    const rand = this.host.rand;
    t.mode = "free";
    this.rel = null;
    t.setPose(t.pose.x + (rand() - 0.5) * 0.04, t.pose.z + (rand() - 0.5) * 0.04, t.pose.yaw + (rand() - 0.5) * 0.08);
    t.status("idle");
    const [cx, cy] = t.at === "home" ? t.homeCell : t.checkoutCell;
    this.host.setCell(cx, cy, SOLID);
    this.host.changed();
  }

  private putDownSteps(): Step[] {
    const f = this.finishAt();
    return [
      ...f.steps,
      { kind: "lift", to: 0, dur: 0.9 },
      { kind: "call", fn: () => this.detach() },
      // out the way it came in, between the legs
      { kind: "line", to: [f.x - Math.cos(f.h) * 1.45, f.z - Math.sin(f.h) * 1.45], speed: 0.8 },
    ];
  }

  private unhookSteps(): Step[] {
    const f = this.finishAt();
    const g = this.hookLocal;
    return [
      ...f.steps,
      { kind: "grip", open: 1, dur: 0.2 },
      { kind: "arm", q: solveIK(g[0], g[1] + 0.14, g[2]).q, dur: 0.3 },
      { kind: "call", fn: () => this.detach() },
      { kind: "line", to: [f.x - Math.cos(f.h) * 0.45, f.z - Math.sin(f.h) * 0.45], speed: 0.8 },
      { kind: "arm", q: STOW, dur: 0.5 },
    ];
  }
}

/** robot centre to trolley centre when hooked: the arm reaches up and forward to the handle */
const HOOK_GAP = 1.16;
