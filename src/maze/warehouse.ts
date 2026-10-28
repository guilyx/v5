import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SANS } from "./paint";
import { blobTexture, clay } from "./gfx";
import { Kit, detOf, glow, hitBox } from "./kit";
import { type Cell, type Grid, type Result, cbs, prioritized } from "./mapf";
import type { Ctx, Det, Interactable } from "./props";

/**
 * Centrale's MAPF testbed: a small warehouse on a raised floor. Robots fetch totes from the shelves
 * and drop them on the conveyor, forever. Each time one finishes a job, every robot is replanned
 * together, with CBS (optimal, collision-free) or prioritized planning (quicker, and it can fail).
 */

const N = 12; // grid cells across, half a board cell each
const CELL = 0.5;
const TICK = 0.42; // seconds per timestep
const TOP = 0.1; // the platform's top
const MAX = 8;
const COLORS = ["#e4572e", "#3a6bf0", "#2f9b78", "#f1b33b", "#8a5cd0", "#e98aa5", "#1fa3b8", "#7a8a2a"];

const shelf = (x: number, y: number) => (y === 2 || y === 5 || y === 8) && x >= 1 && x <= 7;

interface Bot {
  cell: Cell;
  goal: Cell;
  job: "pick" | "drop";
  carrying: boolean;
  path: Cell[];
  heading: number;
  color: THREE.Color;
  /** ticks spent at a pick or drop */
  hold: number;
}

export function warehouse(ctx: Ctx, room: number, x0: number, z0: number) {
  const g = new THREE.Group();
  const W = (c: number) => x0 + (c + 0.5) * CELL;
  const Z = (r: number) => z0 + (r + 0.5) * CELL;
  const grid: Grid = { w: N, h: N, free: (x, y) => !shelf(x, y) };
  const rand = Math.random;

  /* ------------------------------------------------------------ the floor, the racks, the conveyor */
  const cv = document.createElement("canvas");
  cv.width = cv.height = 768;
  const k = cv.getContext("2d")!;
  const px = 768 / N;
  k.fillStyle = "#e9e6f2";
  k.fillRect(0, 0, 768, 768);
  k.strokeStyle = "rgba(75,66,143,0.18)";
  k.lineWidth = 2;
  for (let i = 0; i <= N; i++) {
    k.beginPath();
    k.moveTo(i * px, 0);
    k.lineTo(i * px, 768);
    k.moveTo(0, i * px);
    k.lineTo(768, i * px);
    k.stroke();
  }
  // pick faces along the racks, the drop line along the conveyor
  k.fillStyle = "rgba(241,179,59,0.25)";
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!shelf(x, y) && (shelf(x, y - 1) || shelf(x, y + 1))) k.fillRect(x * px + 4, y * px + 4, px - 8, px - 8);
  k.fillStyle = "rgba(47,155,120,0.3)";
  for (let y = 0; y < N; y++) k.fillRect((N - 1) * px + 4, y * px + 4, px - 8, px - 8);
  k.fillStyle = "#4b428f";
  k.font = `700 26px ${SANS}`;
  k.textAlign = "left";
  k.fillText("MAPF TESTBED", 10, 768 - 16);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const size = N * CELL;
  const platform = new THREE.Mesh(new THREE.BoxGeometry(size + 0.12, TOP, size + 0.12), clay({ color: "#3e3567", bevel: true }));
  platform.position.set(x0 + size / 2, TOP / 2, z0 + size / 2);
  g.add(platform);
  const floorTop = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), clay({ map: tex, emissive: 0.15 }));
  floorTop.position.set(x0 + size / 2, TOP + 0.002, z0 + size / 2);
  g.add(floorTop);
  const kit = new Kit();
  const bins = ["#e4572e", "#3a6bf0", "#f1b33b", "#2f9b78", "#e98aa5"];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!shelf(x, y)) continue;
      const cx = W(x);
      const cz = Z(y);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(0.03, 0.42, 0.03, cx + sx * 0.21, TOP + 0.21, cz + sz * 0.2, "#5c5a72");
      for (const h of [0.12, 0.27, 0.42]) kit.box(0.46, 0.02, 0.44, cx, TOP + h, cz, "#8a86a8");
      for (const [i, h] of [0.13, 0.28].entries()) kit.box(0.17, 0.11, 0.3, cx + (i ? 0.1 : -0.1), TOP + h + 0.065, cz, bins[(x * 3 + y + i) % bins.length]);
    }
  // the conveyor down the east side, and its rollers
  const cx = W(N - 1);
  kit.box(0.4, 0.06, size, cx, TOP + 0.08, z0 + size / 2, "#2f2a45");
  for (let i = 0; i < N * 3; i++) kit.cyl(0.02, 0.02, 0.36, cx, TOP + 0.115, z0 + (i + 0.5) * (size / (N * 3)), "#9a96b8", 6, [0, 0, Math.PI / 2]);
  // a low fence round the rest
  for (const s of [0, size]) kit.box(size, 0.08, 0.03, x0 + size / 2, TOP + 0.06, z0 + s, "#f1b33b");
  kit.box(0.03, 0.08, size, x0, TOP + 0.06, z0 + size / 2, "#f1b33b");
  const racks = kit.mesh();
  g.add(racks);

  /* ------------------------------------------------------------ the robots */
  const botGeo = (() => {
    const b = new Kit();
    b.box(0.4, 0.1, 0.4, 0, 0.06, 0, "#ffffff");
    b.box(0.34, 0.02, 0.34, 0, 0.12, 0, "#e8e6ee");
    b.box(0.05, 0.04, 0.24, 0.19, 0.07, 0, "#2b2a31");
    return mergeGeometries(b.parts);
  })();
  const bodies = new THREE.InstancedMesh(botGeo, clay({ vertexColors: true }), MAX);
  const lights = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 14), clay({ emissive: 1 }), MAX);
  const totes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.14, 0.2), clay({ bevel: true }), MAX + 12);
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.5 }), MAX);
  shadows.renderOrder = 1;
  for (const m of [bodies, lights, totes, shadows]) m.frustumCulled = false;
  g.add(bodies, lights, totes, shadows);
  // planned paths, as dots, and the conflicts CBS resolved, as rings
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.06, 10).rotateX(-Math.PI / 2), clay({ emissive: 0.7 }), MAX * 40);
  dots.frustumCulled = false;
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.13, 0.19, 20).rotateX(-Math.PI / 2), clay({ color: "#e4572e", emissive: 1, transparent: true }), 64);
  rings.frustumCulled = false;
  g.add(dots, rings);

  const bots: Bot[] = [];
  const homes: Cell[] = [[0, 11], [2, 11], [4, 11], [6, 11], [8, 11], [0, 0], [3, 0], [6, 0]];
  const addBot = () => {
    const i = bots.length;
    const home = homes.find((h) => !bots.some((b) => b.cell[0] === h[0] && b.cell[1] === h[1])) ?? homes[i];
    bots.push({ cell: [home[0], home[1]], goal: [home[0], home[1]], job: "pick", carrying: false, path: [home], heading: -Math.PI / 2, color: new THREE.Color(COLORS[i % COLORS.length]), hold: 0 });
  };
  for (let i = 0; i < 5; i++) addBot();

  // totes riding the conveyor north, once dropped
  const riding: { z: number; color: THREE.Color }[] = [];

  /* ------------------------------------------------------------ jobs and planning */
  let solver: "cbs" | "prioritized" = "cbs";
  let last: (Result & { solver: string; agents: number }) | null = null;
  let delivered = 0;
  let conflictsAt = -9;
  let tick = 0;
  let tickAt = 0;
  let wantReplan = false;
  const taken = (c: Cell, except: number) => bots.some((b, i) => i !== except && b.goal[0] === c[0] && b.goal[1] === c[1]);
  const pickCells: Cell[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N - 1; x++) if (!shelf(x, y) && (shelf(x, y - 1) || shelf(x, y + 1))) pickCells.push([x, y]);

  function nextGoal(i: number, far = false) {
    const b = bots[i];
    if (b.job === "pick") {
      // a pick face nobody else is heading to; for a rush, one well away
      const opts = pickCells.filter((c) => !taken(c, i) && (!far || Math.abs(c[0] - b.cell[0]) + Math.abs(c[1] - b.cell[1]) > 6));
      const list = opts.length ? opts : pickCells.filter((c) => !taken(c, i));
      b.goal = list[Math.floor(rand() * list.length)];
    } else {
      // the nearest free spot on the conveyor
      let best: Cell = [N - 1, b.cell[1]];
      let bd = 1e9;
      for (let y = 0; y < N; y++) {
        const c: Cell = [N - 1, y];
        if (taken(c, i)) continue;
        const d = Math.abs(y - b.cell[1]) + (N - 1 - b.cell[0]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      b.goal = best;
    }
  }

  function replan(now: number) {
    const starts = bots.map((b) => b.cell);
    const goals = bots.map((b) => b.goal);
    let res = solver === "cbs" ? cbs(grid, starts, goals, { limit: 400 }) : prioritized(grid, starts, goals);
    const used = solver;
    if (!res.paths && solver === "cbs") res = { ...prioritized(grid, starts, goals), expanded: res.expanded };
    last = { ...res, solver: used, agents: bots.length };
    if (res.paths) bots.forEach((b, i) => (b.path = res.paths![i]));
    else bots.forEach((b) => (b.path = [b.cell]));
    conflictsAt = now;
    tick = 0;
    tickAt = now;
    layoutPaths();
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  function layoutPaths() {
    let n = 0;
    bots.forEach((b) => {
      for (let t = tick + 1; t < b.path.length && n < dots.count; t++) {
        const [x, y] = b.path[t];
        m4.makeTranslation(W(x), TOP + 0.006, Z(y));
        dots.setMatrixAt(n, m4);
        dots.setColorAt(n, b.color);
        n++;
      }
    });
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    const cs = last?.conflicts ?? [];
    rings.count = Math.min(64, cs.length);
    cs.slice(0, 64).forEach(([x, y], i) => {
      m4.makeTranslation(W(x), TOP + 0.01, Z(y));
      rings.setMatrixAt(i, m4);
    });
    rings.instanceMatrix.needsUpdate = true;
  }
  // the instanced dots start with room for every instance
  dots.count = MAX * 40;

  /** a timestep ends: robots at their goal pick or drop, then everyone is replanned together */
  function step(now: number) {
    tick++;
    tickAt = now;
    bots.forEach((b) => (b.cell = b.path[Math.min(tick, b.path.length - 1)]));
    let changed = false;
    bots.forEach((b, i) => {
      if (b.cell[0] !== b.goal[0] || b.cell[1] !== b.goal[1]) return;
      if (b.hold < 1) {
        b.hold++;
        return;
      }
      b.hold = 0;
      if (b.job === "pick") {
        b.carrying = true;
        b.job = "drop";
      } else {
        b.carrying = false;
        b.job = "pick";
        delivered++;
        riding.push({ z: Z(b.cell[1]), color: b.color.clone() });
        if (riding.length > 12) riding.shift();
      }
      nextGoal(i);
      changed = true;
    });
    const stuck = bots.some((b) => tick >= b.path.length - 1 && (b.cell[0] !== b.goal[0] || b.cell[1] !== b.goal[1]));
    if (changed || stuck || wantReplan) {
      wantReplan = false;
      replan(now);
    } else layoutPaths();
  }

  bots.forEach((_, i) => nextGoal(i));
  let started = false;

  /* ------------------------------------------------------------ what you can do */
  const hit = hitBox(size, 0.6, size, x0 + size / 2, 0.3, z0 + size / 2);
  g.add(hit);
  const ix: Interactable = {
    id: "warehouse",
    room,
    name: "MAPF warehouse",
    kind: "active",
    blurb: "Robots fetch totes and drop them on the conveyor. Every time one finishes a job, all of them are replanned together: CBS finds the cheapest collision-free plan; prioritized planning is quicker but can box a robot in.",
    targets: [racks, platform, hit],
    anchor: () => new THREE.Vector3(x0 + size / 2, 1.0, z0 + size / 2),
    highlight: glow([racks, platform]),
    actions: () => [
      { id: "rush", label: "Rush hour: new jobs for all", primary: true },
      { id: "solver", label: solver === "cbs" ? "Switch to prioritized" : "Switch to CBS" },
      { id: "robots", label: bots.length < MAX ? "Add a robot" : "Back to five robots" },
    ],
    live: () => {
      if (!last) return "planning…";
      const rows = bots.map((b, i) => {
        const rest = b.path.slice(Math.min(tick, b.path.length - 1)).map(([x, y]) => `${x},${y}`);
        return `robot ${i + 1} ${b.job === "drop" ? "→ conveyor" : "→ shelf   "} ${rest.slice(0, 9).join(" ")}${rest.length > 9 ? " …" : ""}`;
      });
      const head = last.paths
        ? last.solver === "cbs"
          ? `CBS · ${last.expanded} constraint-tree nodes · ${last.conflicts.length} conflicts resolved`
          : `prioritized · ${last.agents} agents, in order`
        : `${last.solver} · no plan this step`;
      return `${head}\nsum of costs ${last.soc} · makespan ${last.makespan} · ${last.ms.toFixed(1)} ms\n\n${rows.join("\n")}`;
    },
    run: (a) => {
      // takes effect at the end of the current timestep, so nobody jumps
      if (a === "rush") {
        bots.forEach((b) => (b.hold = 0));
        bots.forEach((_, i) => nextGoal(i, true));
      } else if (a === "solver") solver = solver === "cbs" ? "prioritized" : "cbs";
      else if (a === "robots") {
        if (bots.length < MAX) {
          addBot();
          nextGoal(bots.length - 1);
        } else bots.splice(5);
      }
      wantReplan = true;
      ctx.kick();
    },
  };

  const dets: Det[] = [detOf("warehouse", "shelf", "racks")];
  const botDets = Array.from({ length: MAX }, (_, i) => detOf(`agv-${i}`, "robot", `robot ${i + 1}`));
  const rv = new THREE.Vector3();
  return {
    group: g,
    ix,
    detect(out: Det[]) {
      dets[0].box.setFromObject(racks);
      out.push(dets[0]);
      bots.forEach((b, i) => {
        const [x, y] = b.path[Math.min(tick, b.path.length - 1)];
        botDets[i].box.setFromCenterAndSize(rv.set(W(x), TOP + 0.1, Z(y)), new THREE.Vector3(0.36, 0.22, 0.36));
        out.push(botDets[i]);
      });
    },
    hud() {
      if (!last) return null;
      const lines = [
        `${bots.length} robots · ${delivered} totes delivered`,
        last.paths
          ? last.solver === "cbs"
            ? `CBS: ${last.expanded} tree nodes, ${last.conflicts.length} conflicts resolved`
            : `prioritized: ${last.agents} agents, one after another`
          : `${last.solver}: no plan this step, waiting`,
        last.paths ? `sum of costs ${last.soc} · makespan ${last.makespan} · ${last.ms.toFixed(1)} ms` : `${last.failed !== undefined ? `robot ${last.failed + 1} boxed in` : "limit reached"}`,
      ];
      return { at: new THREE.Vector3(x0 + size / 2, 1.3, z0 + size / 2), title: `MAPF · ${solver === "cbs" ? "CBS" : "prioritized"}`, lines, color: "#4b428f" };
    },
    update(now: number, dt: number) {
      if (!started) {
        started = true;
        replan(now);
      }
      if (now - tickAt > TICK * 4) tickAt = now - TICK; // back from a pause: don't rush
      while (now - tickAt >= TICK) step(tickAt + TICK);
      const u = Math.min(1, (now - tickAt) / TICK);
      const e = u * u * (3 - 2 * u);
      let nt = 0;
      bots.forEach((b, i) => {
        const a = b.path[Math.min(tick, b.path.length - 1)];
        const c = b.path[Math.min(tick + 1, b.path.length - 1)];
        const x = W(a[0]) + (W(c[0]) - W(a[0])) * e;
        const z = Z(a[1]) + (Z(c[1]) - Z(a[1])) * e;
        if (c[0] !== a[0] || c[1] !== a[1]) {
          const want = Math.atan2(c[1] - a[1], c[0] - a[0]);
          let d = want - b.heading;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          b.heading += d * Math.min(1, u * 3);
        }
        q.setFromAxisAngle(up, -b.heading);
        m4.compose(pos.set(x, TOP, z), q, one);
        bodies.setMatrixAt(i, m4);
        bodies.setColorAt(i, b.color.clone().lerp(new THREE.Color("#ffffff"), 0.3));
        m4.makeTranslation(x, TOP + 0.14, z);
        lights.setMatrixAt(i, m4);
        lights.setColorAt(i, b.color);
        m4.makeTranslation(x + 0.02, TOP + 0.003, z + 0.03);
        shadows.setMatrixAt(i, m4);
        if (b.carrying) {
          m4.compose(pos.set(x, TOP + 0.23, z), q, one);
          totes.setMatrixAt(nt, m4);
          totes.setColorAt(nt, b.color);
          nt++;
        }
      });
      // totes on the conveyor roll north and drop off its end
      for (let i = riding.length - 1; i >= 0; i--) {
        const t = riding[i];
        t.z -= 0.4 * dt;
        if (t.z < z0 + 0.1) {
          riding.splice(i, 1);
          continue;
        }
        m4.makeTranslation(W(N - 1), TOP + 0.18, t.z);
        totes.setMatrixAt(nt, m4);
        totes.setColorAt(nt, t.color);
        nt++;
      }
      for (const m of [bodies, lights, shadows]) {
        m.count = bots.length;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      totes.count = nt;
      totes.instanceMatrix.needsUpdate = true;
      if (totes.instanceColor) totes.instanceColor.needsUpdate = true;
      const fade = Math.max(0, 1 - (now - conflictsAt) / 1.6);
      (rings.material as THREE.ShaderMaterial).uniforms.uOpacity.value = fade;
      rings.visible = fade > 0 && rings.count > 0;
      return true;
    },
  };
}
