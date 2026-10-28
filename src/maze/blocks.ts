import * as THREE from "three";
import { SANS } from "./paint";
import { clay } from "./gfx";
import type { Stacks } from "./pddl";

/**
 * Centrale's table: four lettered blocks on four slots, the blocks world from every planning
 * course. The table knows where each block is; the robot's arm moves them, step by step,
 * as a PDDL plan says.
 */

export const BLOCK = 0.2;
export const TOP = 0.32;
const SLOTS = 4;
const SPACING = 0.27;
export const NAMES = ["a", "b", "c", "d"];
const COLORS: Record<string, string> = { a: "#e4572e", b: "#3a6bf0", c: "#f1b33b", d: "#2f9b78" };

/** where a block goes: a table slot, or on top of another block */
export type Spot = { slot: number } | { on: string };

function letterTexture(letter: string, color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const k = c.getContext("2d")!;
  k.fillStyle = color;
  k.fillRect(0, 0, 128, 128);
  k.strokeStyle = "rgba(0,0,0,0.12)";
  k.lineWidth = 8;
  k.strokeRect(4, 4, 120, 120);
  k.fillStyle = "#fffaf1";
  k.font = `700 84px ${SANS}`;
  k.textAlign = "center";
  k.textBaseline = "middle";
  k.fillText(letter.toUpperCase(), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BlocksTable {
  group = new THREE.Group();
  blocks: Record<string, THREE.Mesh> = {};
  /** per slot, bottom to top */
  slots: string[][] = [["b", "a"], [], ["d", "c"], []];
  goal: Stacks = [["a", "b", "c"], ["d"]];
  /** meshes that the hover ray tests */
  targets: THREE.Object3D[] = [];
  readonly x: number;
  readonly z: number;
  private held: string | null = null;

  constructor(x: number, z: number, tableColor: string, dark: string) {
    this.x = x;
    this.z = z;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.06, 0.5), clay({ color: tableColor, bevel: true }));
    top.position.set(x, TOP - 0.03, z);
    this.group.add(top);
    this.targets.push(top);
    const legs = new THREE.Group();
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TOP - 0.06, 0.05), clay({ color: dark }));
        leg.position.set(x + sx * 0.62, (TOP - 0.06) / 2, z + sz * 0.2);
        legs.add(leg);
      }
    this.group.add(legs);
    // slot marks on the table top
    for (let i = 0; i < SLOTS; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 0.04, BLOCK + 0.04), new THREE.MeshBasicMaterial({ color: "#fffaf1", transparent: true, opacity: 0.35 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(this.slotX(i), TOP + 0.002, z);
      this.group.add(m);
    }
    const geo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
    for (const n of NAMES) {
      const b = new THREE.Mesh(geo, clay({ map: letterTexture(n, COLORS[n]), bevel: false }));
      b.name = `block-${n}`;
      this.blocks[n] = b;
      this.group.add(b);
      this.targets.push(b);
    }
    this.layout();
  }

  slotX(i: number) {
    return this.x + (i - (SLOTS - 1) / 2) * SPACING;
  }

  /** put every block mesh where the state says */
  layout() {
    this.slots.forEach((st, i) =>
      st.forEach((n, lvl) => {
        const b = this.blocks[n];
        if (b.parent !== this.group) this.group.attach(b);
        b.position.set(this.slotX(i), TOP + BLOCK / 2 + lvl * BLOCK, this.z);
        b.rotation.set(0, 0, 0);
        b.scale.setScalar(1);
      }),
    );
  }

  /** the stacks as a planner sees them: no slots, just towers */
  stacks(): Stacks {
    return this.slots.filter((s) => s.length).map((s) => s.slice());
  }

  /** world centre of a block's resting place, for a given (simulated) slot state */
  static centre(slots: string[][], table: BlocksTable, spot: Spot): THREE.Vector3 {
    if ("slot" in spot) return new THREE.Vector3(table.slotX(spot.slot), TOP + BLOCK / 2 + slots[spot.slot].length * BLOCK, table.z);
    const i = slots.findIndex((s) => s.includes(spot.on));
    return new THREE.Vector3(table.slotX(i), TOP + BLOCK / 2 + slots[i].length * BLOCK, table.z);
  }
  static where(slots: string[][], n: string) {
    const i = slots.findIndex((s) => s.includes(n));
    return { slot: i, level: slots[i].indexOf(n) };
  }

  /** the arm picks a block up: it leaves the table and rides on the gripper */
  take(n: string, grip: THREE.Object3D) {
    const { slot } = BlocksTable.where(this.slots, n);
    this.slots[slot].pop();
    this.held = n;
    grip.attach(this.blocks[n]);
  }
  /** and puts it down */
  place(n: string, spot: Spot) {
    const slot = "slot" in spot ? spot.slot : BlocksTable.where(this.slots, spot.on).slot;
    this.slots[slot].push(n);
    this.held = null;
    this.layout();
  }
  /** drop whatever the gripper holds back where it can go (a plan was interrupted) */
  recover() {
    if (!this.held) return;
    const free = this.slots.findIndex((s) => !s.length);
    const shortest = this.slots.reduce((m, s, i) => (s.length < this.slots[m].length ? i : m), 0);
    this.slots[free >= 0 ? free : shortest].push(this.held);
    this.held = null;
    this.layout();
  }
  get holding() {
    return this.held;
  }

  /** a new goal: random towers of at most three, different from where the blocks are now */
  newGoal(rand: () => number) {
    const now = JSON.stringify(normal(this.stacks()));
    for (let tries = 0; tries < 50; tries++) {
      const order = NAMES.slice().sort(() => rand() - 0.5);
      const g: Stacks = [];
      for (const n of order) {
        const open = g.filter((s) => s.length < 3);
        if (!open.length || rand() < 0.35) g.push([n]);
        else open[Math.floor(rand() * open.length)].push(n);
      }
      if (g.length > SLOTS) continue;
      if (JSON.stringify(normal(g)) === now) continue;
      this.goal = g;
      return;
    }
  }
}

/** stacks in a canonical order, to compare configurations */
const normal = (s: Stacks) => s.map((t) => t.join("")).sort();
