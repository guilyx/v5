import * as THREE from "three";
import { ink } from "./util";

/**
 * The companion flock. A boids simulation — separation, alignment, cohesion —
 * with one extra force pulling each bird toward a goal the current scene
 * sets. It escorts the camera between chapters, and in the swarm chapter it
 * becomes the formation, the coverage sweep and the triangulation.
 *
 * It's a nod to the bird-inspired flocking paper, and it's drawn in the
 * brand's `agent` grey: texture, not decoration.
 */
export type FlockGoal =
  | { kind: "escort" }
  | { kind: "orbit"; center: THREE.Vector3; radius: number; height: number; speed: number }
  | { kind: "slots"; slots: THREE.Vector3[]; speed?: number };

const up = new THREE.Vector3(0, 1, 0);

export class Flock {
  readonly mesh: THREE.InstancedMesh;
  readonly count: number;
  goal: FlockGoal = { kind: "escort" };
  /** Mouse "predator": a world point the birds steer away from. */
  readonly threat = new THREE.Vector3(1e9, 0, 0);

  private pos: THREE.Vector3[] = [];
  private vel: THREE.Vector3[] = [];
  private phase: number[] = [];
  private grid = new Map<number, number[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private fwd = new THREE.Vector3(0, 0, 1);
  private tmp = new THREE.Vector3();
  private escortTarget = new THREE.Vector3();
  private colors: THREE.Color[] = [];
  private highlight = new Set<number>();

  constructor(count: number) {
    this.count = count;
    const geo = new THREE.ConeGeometry(0.26, 1.05, 3).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.pos.push(new THREE.Vector3((Math.random() - 0.5) * 40, 10 + Math.random() * 20, (Math.random() - 0.5) * 40));
      this.vel.push(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(8));
      this.phase.push(Math.random() * Math.PI * 2);
      const c = ink.muted.clone().multiplyScalar(0.85 + Math.random() * 0.4);
      this.colors.push(c);
      this.mesh.setColorAt(i, c);
    }
  }

  /** Light up a few birds in the accent — the "one active element" of a view. */
  setHighlight(indices: number[]) {
    for (const i of this.highlight) this.mesh.setColorAt(i, this.colors[i]);
    this.highlight = new Set(indices);
    for (const i of indices) this.mesh.setColorAt(i, ink.accent.clone().multiplyScalar(2.2));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Snap everyone near a point — used after a menu jump so the flock doesn't stream across the map. */
  regroup(center: THREE.Vector3) {
    for (let i = 0; i < this.count; i++) {
      this.pos[i].set(
        center.x + (Math.random() - 0.5) * 30,
        center.y + (Math.random() - 0.5) * 12,
        center.z + (Math.random() - 0.5) * 30,
      );
    }
  }

  private cellKey(x: number, y: number, z: number) {
    return ((x + 512) & 1023) | (((y + 512) & 1023) << 10) | (((z + 512) & 1023) << 20);
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, speedScale = 1) {
    dt = Math.min(dt, 1 / 30);
    const cell = 6;
    this.grid.clear();
    for (let i = 0; i < this.count; i++) {
      const p = this.pos[i];
      const k = this.cellKey(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell));
      let b = this.grid.get(k);
      if (!b) this.grid.set(k, (b = []));
      b.push(i);
    }

    const goal = this.goal;
    if (goal.kind === "escort") {
      // up and to the right of the line of sight, far enough to stay in the margin
      const f = camera.getWorldDirection(this.tmp).clone();
      const right = f.clone().cross(up).normalize();
      this.escortTarget
        .copy(camera.position)
        .addScaledVector(f, 120)
        .addScaledVector(right, 34)
        .addScaledVector(up, 34 + Math.sin(time * 0.4) * 4);
    }
    const anchorPt =
      goal.kind === "escort" ? this.escortTarget : goal.kind === "orbit" ? goal.center : goal.slots[0];
    if (anchorPt.distanceTo(this.pos[0]) > 260) this.regroup(anchorPt);

    const slotMode = goal.kind === "slots";
    const maxSpeed = (slotMode ? 52 : goal.kind === "escort" ? 40 : 18) * speedScale;
    const maxForce = slotMode ? 110 : 26;
    const wSep = 1.6;
    const wAli = slotMode ? 0.25 : 0.9;
    const wCoh = slotMode ? 0.1 : 0.7;
    const wGoal = slotMode ? 2.4 : 1.0;

    const sep = new THREE.Vector3();
    const ali = new THREE.Vector3();
    const coh = new THREE.Vector3();
    const acc = new THREE.Vector3();
    const target = new THREE.Vector3();
    const d = new THREE.Vector3();

    for (let i = 0; i < this.count; i++) {
      const p = this.pos[i];
      const v = this.vel[i];
      sep.set(0, 0, 0);
      ali.set(0, 0, 0);
      coh.set(0, 0, 0);
      let n = 0;
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      const cz = Math.floor(p.z / cell);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const b = this.grid.get(this.cellKey(cx + ox, cy + oy, cz + oz));
            if (!b) continue;
            for (const j of b) {
              if (j === i) continue;
              d.subVectors(p, this.pos[j]);
              const dist2 = d.lengthSq();
              if (dist2 > 36) continue;
              if (dist2 < 4.4 && dist2 > 1e-6) sep.addScaledVector(d, 1 / dist2);
              ali.add(this.vel[j]);
              coh.add(this.pos[j]);
              n++;
            }
          }
      acc.set(0, 0, 0);
      if (n > 0) {
        ali.divideScalar(n).setLength(maxSpeed).sub(v).clampLength(0, maxForce);
        coh.divideScalar(n).sub(p).setLength(maxSpeed).sub(v).clampLength(0, maxForce);
        acc.addScaledVector(ali, wAli).addScaledVector(coh, wCoh);
      }
      if (sep.lengthSq() > 0) acc.addScaledVector(sep.setLength(maxSpeed).sub(v).clampLength(0, maxForce * 1.4), wSep);

      // goal
      const ph = this.phase[i];
      if (goal.kind === "escort") {
        target.copy(this.escortTarget);
        target.x += Math.cos(ph) * 14;
        target.y += Math.sin(ph * 1.7) * 6;
        target.z += Math.sin(ph) * 14;
      } else if (goal.kind === "orbit") {
        const a = ph + time * goal.speed;
        const r = goal.radius * (0.75 + 0.25 * Math.sin(ph * 3.1));
        target.set(
          goal.center.x + Math.cos(a) * r,
          goal.center.y + goal.height * Math.sin(ph * 2 + time * 0.5),
          goal.center.z + Math.sin(a) * r,
        );
      } else {
        target.copy(goal.slots[i % goal.slots.length]);
      }
      d.subVectors(target, p);
      const dist = d.length();
      const slow = slotMode ? 6 : 14;
      d.setLength(maxSpeed * Math.min(1, dist / slow)).sub(v).clampLength(0, maxForce * (slotMode ? 1.8 : 1));
      acc.addScaledVector(d, wGoal);

      // the pointer is a hawk
      d.subVectors(p, this.threat);
      const td = d.length();
      if (td < 14) acc.addScaledVector(d.normalize(), (14 - td) * 6);

      v.addScaledVector(acc, dt);
      const sp = v.length();
      if (sp > maxSpeed) v.multiplyScalar(maxSpeed / sp);
      if (slotMode && dist < 1.5) v.multiplyScalar(0.9);
      p.addScaledVector(v, dt);
      if (p.y < 1.5) {
        p.y = 1.5;
        v.y = Math.abs(v.y);
      }

      if (v.lengthSq() > 0.01) this.q.setFromUnitVectors(this.fwd, this.tmp.copy(v).normalize());
      this.m.compose(p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
