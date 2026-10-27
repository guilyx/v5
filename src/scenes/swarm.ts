import * as THREE from "three";
import { glow, ink, lineMat, rng, smoothstep } from "../core/util";
import { anchor, drawableLine, Path, placed } from "./kit";
import { key, stopProgress, type Scene, type SceneEnv, type StopDef } from "./types";

/**
 * 2022 — 2024, TII. The turn in the route, and the turn in the career: one
 * robot to many. The companion flock stops escorting and does the job —
 * murmuration first (the bird-inspired flocking from IROS 2024), then the
 * system it grew into: plan around the no-fly layers, hold a wedge behind a
 * virtual leader, split the zone into Voronoi cells and sweep them, and
 * triangulate a contact from three bearings.
 */
export function createSwarm(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0);
  const group = placed(f);
  const L = (html: string, x: number, y: number, z: number, cls = "", maxDist = 260) =>
    env.labels.add("swarm", anchor(group, x, y, z), html, { cls, maxDist });

  const N = env.flock.count;
  const toWorld = (v: THREE.Vector3) => group.localToWorld(v);

  /* ---------------- murmuration ---------------- */
  const murmur = new THREE.Vector3(10, 42, 10);
  const murmurLabel = L("bird-inspired flocking · iros 2024", 10, 66, 10, "accent");

  /* ---------------- costmap layers + global plan ---------------- */
  const noFly: { x: number; z: number; r: number }[] = [
    { x: -28, z: 42, r: 11 },
    { x: -6, z: 8, r: 9 },
    { x: 18, z: 44, r: 9 },
  ];
  const layers = new THREE.Group();
  for (const z of noFly) {
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(z.r, z.r, 12, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: ink.muted, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide }),
    );
    cyl.position.set(z.x, 6, z.z);
    const rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * z.r, 0, Math.sin((i / 64) * Math.PI * 2) * z.r)),
      ),
      lineMat(ink.muted, 0.55),
    );
    rim.position.set(z.x, 0.2, z.z);
    const top = rim.clone();
    top.position.y = 12;
    layers.add(cyl, rim, top);
  }
  group.add(layers);
  L("costmap · no-fly layer", -28, 15, 42);

  const planPts = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-72, 0, 34),
      new THREE.Vector3(-46, 0, 22),
      new THREE.Vector3(-22, 0, 24),
      new THREE.Vector3(6, 0, 26),
      new THREE.Vector3(30, 0, 22),
      new THREE.Vector3(52, 0, 20),
    ],
    false,
    "centripetal",
  ).getSpacedPoints(200);
  const plan = new Path(planPts);
  const planLine = drawableLine(
    planPts.map((p) => p.clone().setY(0.3)),
    new THREE.LineBasicMaterial({ color: ink.accent, transparent: true, opacity: 0.85 }),
  );
  group.add(planLine.line);
  const planLabel = L("global plan", -72, 2, 40, "accent");

  // the wedge: row r holds 2r+1 slots, behind the leader
  const wedge: { side: number; back: number }[] = [];
  for (let r = 0; wedge.length < N; r++)
    for (let c = -r; c <= r && wedge.length < N; c++) wedge.push({ side: c * 2.3, back: r * 2.3 });
  const leader = new THREE.Mesh(new THREE.OctahedronGeometry(1.3), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.8) }));
  group.add(leader);
  const leaderLabel = env.labels.add("swarm", leader, "virtual leader", { offset: new THREE.Vector3(0, 4, 0), cls: "accent", maxDist: 260 });
  // links across the mesh, between neighbouring slots
  const linkPairs: [number, number][] = [];
  for (let i = 0; i < Math.min(N, 64); i++)
    for (let j = i + 1; j < Math.min(N, 64); j++) {
      const a = wedge[i];
      const b = wedge[j];
      if (Math.hypot(a.side - b.side, a.back - b.back) < 3.4) linkPairs.push([i, j]);
    }
  const linkPos = new Float32Array(linkPairs.length * 6);
  const linkGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
  const links = new THREE.LineSegments(linkGeo, lineMat(ink.muted, 0.35));
  links.frustumCulled = false;
  group.add(links);

  /* ---------------- coverage ---------------- */
  const ZC = new THREE.Vector3(54, 0, 20);
  const Z = 96;
  const G = 48;
  const T = Z / G;
  const zr = rng(2024);
  const seeds = Array.from({ length: 6 }, () => new THREE.Vector2(ZC.x - Z / 2 + 10 + zr() * (Z - 20), ZC.z - Z / 2 + 10 + zr() * (Z - 20)));
  // spread seeds a little so cells aren't slivers
  for (let it = 0; it < 30; it++)
    for (const a of seeds)
      for (const b of seeds) {
        if (a === b) continue;
        const d = a.distanceTo(b);
        if (d < 30) a.addScaledVector(a.clone().sub(b).normalize(), (30 - d) * 0.1);
      }
  const tileX = (i: number) => ZC.x - Z / 2 + T * (i + 0.5);
  const tileZ = (j: number) => ZC.z - Z / 2 + T * (j + 0.5);
  const owner: number[] = [];
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      let best = 0;
      let bd = Infinity;
      seeds.forEach((s, k) => {
        const d = (tileX(i) - s.x) ** 2 + (tileZ(j) - s.y) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      owner.push(best);
    }
  // boustrophedon order inside each cell
  const cellTiles: number[][] = seeds.map(() => []);
  for (let j = 0; j < G; j++) {
    const row = Array.from({ length: G }, (_, i) => i);
    if (j % 2) row.reverse();
    for (const i of row) cellTiles[owner[j * G + i]].push(j * G + i);
  }
  const tiles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(T * 0.9, T * 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    G * G,
  );
  const m4 = new THREE.Matrix4();
  const black = new THREE.Color(0, 0, 0);
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      m4.makeTranslation(tileX(i), 0.15, tileZ(j));
      tiles.setMatrixAt(j * G + i, m4);
      tiles.setColorAt(j * G + i, black);
    }
  group.add(tiles);
  const bpts: number[] = [];
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const o = owner[j * G + i];
      const x0 = ZC.x - Z / 2 + i * T;
      const z0 = ZC.z - Z / 2 + j * T;
      if (i + 1 < G && owner[j * G + i + 1] !== o) bpts.push(x0 + T, 0.25, z0, x0 + T, 0.25, z0 + T);
      if (j + 1 < G && owner[(j + 1) * G + i] !== o) bpts.push(x0, 0.25, z0 + T, x0 + T, 0.25, z0 + T);
    }
  const borders = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(bpts, 3)),
    new THREE.LineBasicMaterial({ color: ink.accent, transparent: true, opacity: 0 }),
  );
  group.add(borders);
  const zoneEdge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ZC.x - Z / 2, 0.25, ZC.z - Z / 2),
      new THREE.Vector3(ZC.x + Z / 2, 0.25, ZC.z - Z / 2),
      new THREE.Vector3(ZC.x + Z / 2, 0.25, ZC.z + Z / 2),
      new THREE.Vector3(ZC.x - Z / 2, 0.25, ZC.z + Z / 2),
    ]),
    lineMat(ink.body, 0.7),
  );
  group.add(zoneEdge);
  L("task zone", ZC.x - Z / 2 + 8, 1, ZC.z - Z / 2 - 3);
  const cellLabels = seeds.map((s, k) => L(`cell ${k + 1}`, s.x, 1, s.y, "year"));
  const coverLabel = L("", ZC.x + Z / 2 + 10, 1, ZC.z, "");

  /* ---------------- triangulation ---------------- */
  const target = new THREE.Vector3(70, 0, 38);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.6), transparent: true, opacity: 0, depthWrite: false }),
  );
  ring.position.copy(target).setY(0.4);
  group.add(ring);
  const watchers = [0, 1, 2].map((k) => {
    const a = (k / 3) * Math.PI * 2 + 0.6;
    return new THREE.Vector3(target.x + Math.cos(a) * 30, 14, target.z + Math.sin(a) * 30);
  });
  const bearings = watchers.map(() => {
    const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: ink.accent, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0 }));
    l.frustumCulled = false;
    group.add(l);
    return l;
  });
  const contactLabel = L("contact · 3 bearings", target.x, 4, target.z, "accent");

  /* ---------------- stops ---------------- */
  const stops: StopDef[] = [
    { id: "swarm", vh: 150, keys: [key(-60, 30, -34, 12, 38, 8), key(-34, 62, 48, 14, 36, 4)] },
    { id: "swarm-formation", vh: 130, keys: [key(-14, 118, 112, -10, 0, 26), key(18, 100, 104, 14, 0, 22)] },
    { id: "swarm-coverage", vh: 130, keys: [key(56, 132, 104, 54, 0, 18), key(80, 96, 98, 56, 0, 16)] },
    { id: "swarm-triangulate", vh: 120, keys: [key(104, 54, 88, 68, 4, 34), key(76, 48, 100, 66, 4, 36)] },
  ];

  let lastCover = -1;
  const cellBoids: number[][] = seeds.map(() => []);
  for (let i = 0; i < N; i++) cellBoids[i % seeds.length].push(i);
  const slots = Array.from({ length: N }, () => new THREE.Vector3());
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tileColor = new THREE.Color();

  const phase = (u: number) => ({
    murmur: stopProgress(stops, u, 0),
    form: stopProgress(stops, u, 1),
    cover: stopProgress(stops, u, 2),
    tri: stopProgress(stops, u, 3),
  });

  return {
    id: "swarm",
    group,
    stops,
    update(ctx) {
      const p = phase(ctx.u);
      const formOn = smoothstep(0.85, 1, p.murmur);
      const planDraw = smoothstep(0, 0.45, p.form);
      planLine.set(Math.max(planDraw, p.cover > 0 ? 1 : 0));
      layers.visible = formOn > 0 || p.form > 0;
      planLabel.alpha = smoothstep(0.02, 0.2, p.form) * (1 - smoothstep(0.3, 0.6, p.cover));
      murmurLabel.alpha = 1 - smoothstep(0.6, 0.95, p.murmur);

      // leader along the plan, after the plan has drawn
      const lead = smoothstep(0.25, 1, p.form);
      plan.at(lead, leader.position).setY(16);
      plan.dir(Math.min(0.995, Math.max(0.005, lead)), dir);
      leader.visible = p.form > 0.05 && p.cover < 0.2;
      leader.rotation.y = ctx.time;
      leaderLabel.alpha = leader.visible ? 1 : 0;
      side.set(-dir.z, 0, dir.x);
      for (let i = 0; i < N; i++) {
        const w = wedge[i];
        slots[i].copy(leader.position).addScaledVector(dir, -w.back - 3).addScaledVector(side, w.side);
      }
      links.visible = leader.visible;
      if (links.visible) {
        linkPairs.forEach(([a, b], k) => {
          linkPos.set([slots[a].x, slots[a].y, slots[a].z, slots[b].x, slots[b].y, slots[b].z], k * 6);
        });
        linkGeo.attributes.position.needsUpdate = true;
      }

      // coverage
      (borders.material as THREE.LineBasicMaterial).opacity = 0.55 * smoothstep(0, 0.15, p.cover);
      const cov = smoothstep(0.08, 0.95, p.cover);
      cellLabels.forEach((l) => (l.alpha = smoothstep(0, 0.15, p.cover) * (1 - smoothstep(0.1, 0.4, p.tri))));
      const coveredKey = Math.floor(cov * 400);
      if (coveredKey !== lastCover) {
        lastCover = coveredKey;
        let total = 0;
        let done = 0;
        cellTiles.forEach((list) => {
          const k = Math.floor(cov * list.length);
          list.forEach((t, idx) => {
            tiles.setColorAt(t, idx < k ? tileColor.copy(ink.line).multiplyScalar(1.5) : black);
          });
          total += list.length;
          done += k;
        });
        tiles.instanceColor!.needsUpdate = true;
        coverLabel.el.innerHTML = `coverage<br>${Math.round((100 * done) / total)}%`;
      }
      coverLabel.alpha = smoothstep(0, 0.1, p.cover) * (1 - smoothstep(0.2, 0.5, p.tri));

      // triangulation
      const triOn = smoothstep(0, 0.3, p.tri);
      (ring.material as THREE.MeshBasicMaterial).opacity = triOn * (0.5 + 0.5 * Math.sin(ctx.time * 5));
      ring.scale.setScalar(2 + ((ctx.time * 0.8) % 1) * 4 * triOn);
      const reach = smoothstep(0.2, 0.75, p.tri);
      bearings.forEach((b, k) => {
        const pos = b.geometry.attributes.position as THREE.BufferAttribute;
        tmp.copy(watchers[k]).lerp(target, reach);
        pos.setXYZ(0, watchers[k].x, watchers[k].y, watchers[k].z);
        pos.setXYZ(1, tmp.x, tmp.y, tmp.z);
        pos.needsUpdate = true;
        b.computeLineDistances();
        (b.material as THREE.LineDashedMaterial).opacity = triOn;
      });
      contactLabel.alpha = smoothstep(0.7, 0.85, p.tri);
    },
    steer(ctx) {
      const p = phase(ctx.u);
      const fl = env.flock;
      if (p.form <= 0.04) {
        fl.goal = { kind: "orbit", center: toWorld(murmur.clone()), radius: 40, height: 14, speed: ctx.reduced ? 0.08 : 0.28 };
        return;
      }
      if (p.tri > 0.05) {
        // three clusters, each watching the target from its bearing
        for (let i = 0; i < N; i++) {
          const w = watchers[i % 3];
          const a = (i / N) * Math.PI * 14;
          tmp.set(w.x + Math.cos(a) * 3.2, w.y + Math.sin(a * 1.3) * 1.5, w.z + Math.sin(a) * 3.2);
          slots[i].copy(toWorld(tmp));
        }
        fl.goal = { kind: "slots", slots };
        fl.setHighlight([0, 1, 2]);
        return;
      }
      if (p.cover > 0.04) {
        // each cell's birds ride the sweep frontier of their cell
        const cov = smoothstep(0.08, 0.95, p.cover);
        cellBoids.forEach((boids, c) => {
          const list = cellTiles[c];
          const k = Math.max(1, Math.floor(cov * list.length));
          boids.forEach((bi, j) => {
            const t = list[Math.max(0, k - 1 - ((j * 3) % Math.min(k, 40)))];
            const ti = t % G;
            const tj = Math.floor(t / G);
            tmp.set(tileX(ti), 7 + (j % 3) * 1.2, tileZ(tj));
            slots[bi].copy(toWorld(tmp));
          });
        });
        fl.goal = { kind: "slots", slots };
        return;
      }
      // formation: slots already computed in local space by update()
      for (let i = 0; i < N; i++) toWorld(slots[i]);
      fl.goal = { kind: "slots", slots };
      fl.setHighlight([0]);
    },
  };
}
