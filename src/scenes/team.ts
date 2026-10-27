import * as THREE from "three";
import { rework } from "../content";
import { blueprint, easeInOut, glow, ink, lineMat, smoothstep } from "../core/util";
import { anchor, placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * 2024 — 2026, leading the team. The rework as two bars that shrink while you
 * watch (−74% CPU, −52% bandwidth), the team as a graph of nine, and the
 * Caltech M4 — a rover whose wheels fold up into rotors.
 */
export function createTeam(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0.09);
  const group = placed(f);
  env.world.addMarker(f);
  const L = (html: string, x: number, y: number, z: number, cls = "", maxDist = 150) =>
    env.labels.add("team", anchor(group, x, y, z), html, { cls, maxDist });

  /* ---------------- the rework ---------------- */
  const H = 16;
  const bars: { after: THREE.Group; target: number }[] = [];
  [
    { name: "onboard cpu", cut: rework.cpu, x: -30 },
    { name: "bandwidth", cut: rework.bandwidth, x: -21 },
  ].forEach((b) => {
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.4, H, 3.4)), lineMat(ink.faint, 0.8));
    ghost.position.set(b.x, H / 2, 0);
    group.add(ghost);
    const after = blueprint(new THREE.BoxGeometry(3.4, 1, 3.4).translate(0, 0.5, 0), { fill: new THREE.Color("#232737"), edge: ink.accent });
    after.position.set(b.x, 0, 0);
    after.scale.y = H;
    group.add(after);
    bars.push({ after, target: H * (1 - b.cut / 100) });
    L(`<b>−${b.cut}%</b>${b.name}`, b.x, H + 3.2, 0, "stat");
  });
  L("swarm autonomy rework · before / after", -25.5, 0.4, 4.2, "year");

  /* ---------------- the team ---------------- */
  const hub = new THREE.Vector3(-52, 17, -22);
  const lead = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 12), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.6) }));
  lead.position.copy(hub);
  group.add(lead);
  const clusters = [
    { name: "autonomy", n: 4, a: 0 },
    { name: "infrastructure", n: 3, a: (Math.PI * 2) / 3 },
    { name: "platform integration", n: 2, a: (Math.PI * 4) / 3 },
  ];
  const people: { mesh: THREE.Mesh; c: number; k: number }[] = [];
  const clusterHubs: THREE.Object3D[] = [];
  const personGeo = new THREE.SphereGeometry(0.7, 16, 10);
  const personMat = new THREE.MeshBasicMaterial({ color: ink.body });
  clusters.forEach((c, ci) => {
    const h = new THREE.Object3D();
    group.add(h);
    clusterHubs.push(h);
    env.labels.add("team", h, c.name, { offset: new THREE.Vector3(0, 3.4, 0), maxDist: 150 });
    for (let k = 0; k < c.n; k++) {
      const m = new THREE.Mesh(personGeo, personMat);
      group.add(m);
      people.push({ mesh: m, c: ci, k });
    }
  });
  const edgePos = new Float32Array((clusters.length + people.length) * 6);
  const edgeGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
  const edges = new THREE.LineSegments(edgeGeo, lineMat(ink.muted, 0.6));
  edges.frustumCulled = false;
  group.add(edges);
  L(`${rework.team} engineers`, hub.x, hub.y - 3.4, hub.z, "accent");
  L(`demos → ${rework.contracts}`, hub.x, hub.y + 9, hub.z, "tag");

  /* ---------------- Caltech M4 ---------------- */
  const m4 = new THREE.Group();
  const chassis = blueprint(new THREE.BoxGeometry(3.2, 0.9, 4.4), { edge: ink.body });
  chassis.position.y = 0;
  m4.add(chassis);
  const units: { pivot: THREE.Group; spin: THREE.Group; side: number }[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 2.3, 0, sz * 1.6);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.2, 8, 28), new THREE.MeshBasicMaterial({ color: ink.muted }));
    spin.add(tire);
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.28), new THREE.MeshBasicMaterial({ color: ink.body }));
      blade.rotation.z = (k / 3) * Math.PI;
      spin.add(blade);
    }
    // in roll mode the wheel stands in the x = const plane
    spin.rotation.y = Math.PI / 2;
    pivot.add(spin);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.18), new THREE.MeshBasicMaterial({ color: ink.faint }));
    arm.position.x = -sx * 0.7;
    pivot.add(arm);
    m4.add(pivot);
    units.push({ pivot, spin, side: sx });
  }
  m4.position.set(-22, 1.35, 6);
  group.add(m4);
  const m4Label = env.labels.add("team", m4, "caltech m4 · rolling", { offset: new THREE.Vector3(0, 4.4, 0), cls: "accent", maxDist: 120 });
  L("joint program with caltech", -20, 0.3, 11, "year");

  return {
    id: "team",
    group,
    stops: [
      {
        id: "team",
        vh: 170,
        keys: [key(-26, 24, 50, -16, 9, 0), key(-2, 14, 34, -20, 7, 2), key(-30, 24, 26, -46, 13, -14)],
      },
    ],
    update(ctx) {
      // bars shrink as the chapter plays
      const s = easeInOut(smoothstep(0.02, 0.45, ctx.u));
      for (const b of bars) b.after.scale.y = H + (b.target - H) * s;

      // the team orbits its lead
      const t = ctx.time * 0.25;
      clusters.forEach((c, ci) => {
        const a = c.a + t;
        clusterHubs[ci].position.set(hub.x + Math.cos(a) * 9, hub.y + Math.sin(a * 2) * 1.2, hub.z + Math.sin(a) * 9);
      });
      let e = 0;
      clusterHubs.forEach((h) => {
        edgePos.set([hub.x, hub.y, hub.z, h.position.x, h.position.y, h.position.z], e);
        e += 6;
      });
      for (const p of people) {
        const h = clusterHubs[p.c].position;
        const a = (p.k / clusters[p.c].n) * Math.PI * 2 + t * 2;
        p.mesh.position.set(h.x + Math.cos(a) * 2.6, h.y + Math.sin(a) * 2.6 * 0.5, h.z + Math.sin(a) * 2.6);
        edgePos.set([h.x, h.y, h.z, p.mesh.position.x, p.mesh.position.y, p.mesh.position.z], e);
        e += 6;
      }
      edgeGeo.attributes.position.needsUpdate = true;

      // M4: roll, fold wheels into rotors, fly, land, unfold — on a 10 s loop
      const c = ctx.time % 10;
      const fold = smoothstep(2.6, 3.6, c) * (1 - smoothstep(8.6, 9.6, c));
      const lift = smoothstep(3.6, 4.6, c) * (1 - smoothstep(7.4, 8.6, c));
      const rollX = c < 3 ? c * 1.4 : c > 9.6 ? (c - 10) * 1.4 + 0 : 4.2;
      m4.position.set(-22 + rollX - 2.1, 1.35 + lift * 7 + Math.sin(ctx.time * 3) * 0.1 * lift, 6);
      for (const u of units) {
        u.pivot.rotation.z = -u.side * fold * (Math.PI / 2);
        if (fold > 0.95) u.spin.rotation.z += ctx.dt * 30;
        else u.spin.rotation.z -= ctx.dt * (c < 3 || c > 9.6 ? 2.4 : 0);
      }
      const mode = fold > 0.95 ? (lift > 0.5 ? "flying" : "rotors up") : fold > 0.05 ? "transforming" : "rolling";
      const html = `caltech m4 · ${mode}`;
      if (m4Label.el.innerHTML !== html) m4Label.el.innerHTML = html;
    },
  };
}
