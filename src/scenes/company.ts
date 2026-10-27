import * as THREE from "three";
import { blueprint, glow, ink, lineMat } from "../core/util";
import { anchor, Path, placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * 2024 — now, Unchained Labs. Local-first agents: everything happens inside
 * the client's own box. A spoken intent comes in as a waveform, Kymatics
 * routes it through a graph of agents, and build jobs stack up in the queue.
 */
export function createCompany(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0.18);
  const group = placed(f);
  env.world.addMarker(f);
  const L = (html: string, x: number, y: number, z: number, cls = "", maxDist = 150) =>
    env.labels.add("company", anchor(group, x, y, z), html, { cls, maxDist });

  const OX = 18; // the whole rig sits right of the route; the panel is on the left

  // the client's infrastructure: nothing leaves this box
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(50, 22, 30)), lineMat(ink.muted, 0.7));
  box.position.set(OX + 10, 11, -4);
  group.add(box);
  const floorGrid = new THREE.GridHelper(50, 25, ink.line, ink.line);
  floorGrid.scale.z = 30 / 50;
  floorGrid.position.set(OX + 10, 0.06, -4);
  group.add(floorGrid);
  L("your models · your data · your infra", OX + 10, 23.6, -4, "tag");

  // the spoken intent
  const BARS = 28;
  const wave = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 1, 0.34),
    new THREE.MeshBasicMaterial({ color: ink.body }),
    BARS,
  );
  group.add(wave);
  const WX = OX - 10;
  L("spoken intent", WX, 3.2, -4);

  // Kymatics: a small DAG of agents
  const nodes: { p: THREE.Vector3; name: string }[] = [
    { p: new THREE.Vector3(OX - 3, 10, -4), name: "stt" },
    { p: new THREE.Vector3(OX + 4, 13, -10), name: "plan" },
    { p: new THREE.Vector3(OX + 4, 8, 2), name: "retrieve" },
    { p: new THREE.Vector3(OX + 12, 15, -12), name: "code" },
    { p: new THREE.Vector3(OX + 12, 10, -4), name: "test" },
    { p: new THREE.Vector3(OX + 12, 5, 4), name: "docs" },
    { p: new THREE.Vector3(OX + 20, 12, -8), name: "review" },
    { p: new THREE.Vector3(OX + 20, 7, 1), name: "merge" },
  ];
  const links: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 4],
    [2, 5],
    [3, 6],
    [4, 6],
    [5, 7],
    [6, 7],
  ];
  const nodeMeshes = nodes.map((n, i) => {
    const m = blueprint(i === 0 ? new THREE.OctahedronGeometry(1.3) : new THREE.BoxGeometry(2, 2, 2), {
      fill: new THREE.Color("#1d2130"),
      edge: ink.body,
      threshold: 1,
    });
    m.position.copy(n.p);
    group.add(m);
    env.labels.add("company", m, n.name, { offset: new THREE.Vector3(0, 2.3, 0), maxDist: 120 });
    return m;
  });
  const paths = links.map(([a, b]) => {
    const pa = nodes[a].p;
    const pb = nodes[b].p;
    const mid = pa.clone().lerp(pb, 0.5).add(new THREE.Vector3(0, 1.6, 0));
    const pts = new THREE.QuadraticBezierCurve3(pa, mid, pb).getPoints(24);
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(ink.muted, 0.8)));
    return new Path(pts);
  });
  // wave → stt, merge → queue
  const inPath = new Path([new THREE.Vector3(WX + 2, 4, -4), new THREE.Vector3(OX - 6, 9, -4), nodes[0].p.clone()]);
  const QX = OX + 30;
  const outPath = new Path([nodes[7].p.clone(), new THREE.Vector3(QX - 3, 6, 1), new THREE.Vector3(QX, 2, -4)]);
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inPath.pts), lineMat(ink.muted, 0.6)));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outPath.pts), lineMat(ink.muted, 0.6)));
  L("kymatics · graph-based orchestration", OX + 10, 19, -14, "accent");

  // packets: one per link, offset in time, so the graph always looks busy
  const PK = links.length + 2;
  const packets = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.55, 0.55, 0.55),
    new THREE.MeshBasicMaterial({ color: glow(ink.accent, 2.2) }),
    PK,
  );
  group.add(packets);

  // the queue of build jobs
  const JOBS = 10;
  const jobs = Array.from({ length: JOBS }, (_, i) => {
    const j = blueprint(new THREE.BoxGeometry(3.2, 0.9, 3.2), { fill: new THREE.Color("#1d2130"), edge: ink.faint });
    j.position.set(QX, 0.45 + i * 1.05, -4);
    group.add(j);
    return j;
  });
  const queueLabel = L("", QX + 4.5, 4, -4);

  const m = new THREE.Matrix4();
  let lastCount = -1;

  return {
    id: "company",
    group,
    stops: [
      {
        id: "company",
        vh: 160,
        keys: [key(58, 30, 46, 14, 9, -4), key(38, 16, 30, 18, 10, -4), key(24, 26, -26, 8, 10, -70)],
      },
    ],
    update(ctx) {
      const t = ctx.time;
      // speech: bursts of amplitude, like words
      const talking = Math.sin(t * 0.9) > -0.2;
      for (let i = 0; i < BARS; i++) {
        const env_ = talking ? 0.4 + 0.6 * Math.abs(Math.sin(t * 7 + i * 0.7) * Math.sin(t * 2.3 + i * 0.31)) : 0.06;
        m.makeScale(1, 0.2 + env_ * 6, 1).setPosition(WX, 0.1 + (0.2 + env_ * 6) / 2, -4 - (BARS / 2) * 0.5 + i * 0.5);
        wave.setMatrixAt(i, m);
      }
      wave.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < links.length; i++) {
        const k = (t * 0.6 + i * 0.37) % 1;
        const p = paths[i].at(k);
        m.makeTranslation(p.x, p.y, p.z);
        packets.setMatrixAt(i, m);
      }
      const pin = inPath.at((t * 0.5) % 1);
      packets.setMatrixAt(links.length, m.makeTranslation(pin.x, pin.y, pin.z));
      const pout = outPath.at((t * 0.5 + 0.5) % 1);
      packets.setMatrixAt(links.length + 1, m.makeTranslation(pout.x, pout.y, pout.z));
      packets.instanceMatrix.needsUpdate = true;

      nodeMeshes.forEach((n, i) => (n.rotation.y = t * 0.4 + i));

      // jobs stack up one per cycle, then the queue drains
      const count = 1 + (Math.floor(t / 2) % JOBS);
      if (count !== lastCount) {
        lastCount = count;
        jobs.forEach((j, i) => (j.visible = i < count));
        queueLabel.el.innerHTML = `build jobs<br>${count} queued`;
      }
    },
  };
}
