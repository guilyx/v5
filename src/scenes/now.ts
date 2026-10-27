import * as THREE from "three";
import { blueprint, glow, ink, lineMat, smoothstep } from "../core/util";
import { anchor, placed } from "./kit";
import { key, stopProgress, type Scene, type SceneEnv, type StopDef } from "./types";

/**
 * 2026 — now, SIRB.AI. The fleet heals itself: a drone faults, drops, and an
 * agent brings it back. Then the two systems behind that, drawn: a mission
 * tree densified into the actions it really is, and every fault on one
 * timeline with an agent reading the window.
 */

function drone(): THREE.Group {
  const g = new THREE.Group();
  const body = blueprint(new THREE.BoxGeometry(1.4, 0.45, 1.4), { edge: ink.body });
  g.add(body);
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.16), new THREE.MeshBasicMaterial({ color: ink.faint }));
    arm.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    arm.rotation.y = -a;
    const rotor = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ink.muted, side: THREE.DoubleSide }),
    );
    rotor.position.set(Math.cos(a) * 1.55, 0.12, Math.sin(a) * 1.55);
    g.add(arm, rotor);
  }
  return g;
}

export function createNow(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0.28);
  const group = placed(f);
  env.world.addMarker(f);
  const L = (html: string, x: number, y: number, z: number, cls = "", maxDist = 140) =>
    env.labels.add("now", anchor(group, x, y, z), html, { cls, maxDist });

  /* ---------------- the self-healing ring ---------------- */
  const RC = new THREE.Vector3(-8, 12, 0);
  const RN = 10;
  const fleet = Array.from({ length: RN }, (_, i) => {
    const d = drone();
    const a = (i / RN) * Math.PI * 2;
    d.position.set(RC.x + Math.cos(a) * 13, RC.y, RC.z + Math.sin(a) * 13);
    group.add(d);
    return d;
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.6), wireframe: true }));
  core.position.copy(RC);
  group.add(core);
  const heal = new THREE.Mesh(
    new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.5), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  heal.position.copy(RC);
  group.add(heal);
  const faultLabel = env.labels.add("now", fleet[2], "", { offset: new THREE.Vector3(0, 2.6, 0), maxDist: 120 });
  L("self-healing layer", RC.x, RC.y + 6, RC.z, "accent");
  L("umex 2026 · abu dhabi", RC.x, 0.4, RC.z + 17, "year");

  /* ---------------- behavior tree → action graph ---------------- */
  type Kind = "fallback" | "sequence" | "cond" | "action";
  const BZ = -54;
  const tree: { name: string; kind: Kind; parent: number; depth: number }[] = [];
  const add = (name: string, kind: Kind, parent: number) => {
    tree.push({ name, kind, parent, depth: parent < 0 ? 0 : tree[parent].depth + 1 });
    return tree.length - 1;
  };
  const root = add("mission", "fallback", -1);
  const survey = add("survey", "sequence", root);
  add("battery ok?", "cond", survey);
  const takeoff = add("Takeoff", "action", survey);
  const transit = add("transit", "sequence", survey);
  add("link ok?", "cond", transit);
  add("geofence ok?", "cond", transit);
  const go = add("GoToZone", "action", transit);
  const search = add("search", "fallback", survey);
  add("contact?", "cond", search);
  const sweep = add("Sweep", "action", search);
  const trk = add("Track", "action", survey);
  const ret = add("Return", "action", survey);
  const abort = add("abort", "sequence", root);
  add("fault?", "cond", abort);
  const land = add("Land", "action", abort);

  // tree layout: leaves spread evenly, parents centred over children
  const kids = tree.map((_, i) => tree.map((n, j) => (n.parent === i ? j : -1)).filter((j) => j >= 0));
  let leaf = 0;
  const tx: number[] = [];
  const place = (i: number): number => {
    if (!kids[i].length) return (tx[i] = leaf++);
    const xs = kids[i].map(place);
    return (tx[i] = (xs[0] + xs[xs.length - 1]) / 2);
  };
  place(root);
  const treePos = tree.map((n, i) => new THREE.Vector3((tx[i] - (leaf - 1) / 2) * 3.3, 27 - n.depth * 5.2, BZ));
  // the densified graph: six actions on a line, Land below
  const graphPos = new Map<number, THREE.Vector3>([
    [takeoff, new THREE.Vector3(-16, 15, BZ)],
    [go, new THREE.Vector3(-8, 15, BZ)],
    [sweep, new THREE.Vector3(0, 15, BZ)],
    [trk, new THREE.Vector3(8, 15, BZ)],
    [ret, new THREE.Vector3(16, 15, BZ)],
    [land, new THREE.Vector3(0, 6, BZ)],
  ]);
  const geoFor = (k: Kind) =>
    k === "action"
      ? new THREE.BoxGeometry(2.6, 1.3, 0.6)
      : k === "cond"
        ? new THREE.OctahedronGeometry(0.85)
        : new THREE.BoxGeometry(1.3, 1.3, 1.3);
  const btNodes = tree.map((n, i) => {
    const m = blueprint(geoFor(n.kind), {
      fill: n.kind === "action" ? new THREE.Color("#22263a") : ink.raised,
      edge: n.kind === "action" ? ink.heading : n.kind === "cond" ? ink.muted : ink.body,
      threshold: 1,
    });
    m.position.copy(treePos[i]);
    group.add(m);
    const label = env.labels.add(
      "now",
      m,
      n.kind === "fallback" ? `? ${n.name}` : n.kind === "sequence" ? `→ ${n.name}` : n.name,
      { offset: new THREE.Vector3(0, n.kind === "action" ? -1.5 : -1.4, 0), maxDist: 100, cls: n.kind === "action" ? "" : "year" },
    );
    return { m, label };
  });
  const treeEdgePos = new Float32Array(tree.length * 6);
  const treeEdges = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(treeEdgePos, 3)),
    new THREE.LineBasicMaterial({ color: ink.faint, transparent: true }),
  );
  treeEdges.frustumCulled = false;
  group.add(treeEdges);

  const graphEdges: { a: number; b: number; guard?: string; weak?: boolean }[] = [
    { a: takeoff, b: go, guard: "link ∧ geofence" },
    { a: go, b: sweep, weak: true },
    { a: sweep, b: trk, guard: "contact" },
    { a: trk, b: ret },
    { a: go, b: land, guard: "fault" },
    { a: sweep, b: land, guard: "fault" },
    { a: trk, b: land, guard: "fault" },
  ];
  const gLines = graphEdges.map((e) => {
    const pa = graphPos.get(e.a)!;
    const pb = graphPos.get(e.b)!;
    const dir = pb.clone().sub(pa).normalize();
    const a = pa.clone().addScaledVector(dir, 1.6);
    const b = pb.clone().addScaledVector(dir, -1.6);
    const mat = new THREE.LineBasicMaterial({ color: e.weak ? glow(ink.accent, 1.5) : ink.body, transparent: true, opacity: 0 });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 10), new THREE.MeshBasicMaterial({ color: mat.color, transparent: true, opacity: 0 }));
    head.position.copy(b);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(line, head);
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.9, 0));
    const lab = e.guard
      ? env.labels.add("now", anchor(group, mid.x, mid.y, mid.z), `[${e.guard}]`, { maxDist: 100, cls: "year" })
      : e.weak
        ? env.labels.add("now", anchor(group, mid.x, mid.y + 1.4, mid.z), "weakest branch · 0.71", { maxDist: 100, cls: "accent" })
        : null;
    return { line, head, lab, weak: !!e.weak };
  });
  const btCaption = L("16 nodes", 0, 30.5, BZ, "tag", 110);

  /* ---------------- faults on one timeline ---------------- */
  const FZ = -104;
  const comps = ["nav", "perception", "comms", "planner", "bt"];
  const compMeshes = comps.map((c, i) => {
    const m = blueprint(new THREE.BoxGeometry(3.6, 1.6, 1.6), { edge: ink.muted });
    m.position.set(-34, 16 - i * 2.6, FZ);
    group.add(m);
    env.labels.add("now", m, c, { offset: new THREE.Vector3(-3.4, 0, 0), maxDist: 100 });
    return m;
  });
  const TL0 = -24;
  const TL1 = 10;
  const lane = new THREE.Mesh(new THREE.BoxGeometry(TL1 - TL0, 0.12, 2.6), new THREE.MeshBasicMaterial({ color: ink.raised }));
  lane.position.set((TL0 + TL1) / 2, 6, FZ);
  group.add(lane);
  group.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(TL1 - TL0, 0.12, 2.6)),
      lineMat(ink.faint),
    ).translateX((TL0 + TL1) / 2).translateY(6).translateZ(FZ),
  );
  L("one ordered event table", (TL0 + TL1) / 2, 3.6, FZ + 1.4);
  // events: a fixed tape that scrolls right to left; comms flaps, then planner dies
  const EV = 70;
  const events: { t: number; c: number }[] = [];
  for (let k = 0; k < EV; k++) {
    const t = k * 0.55;
    const flap = k > 18 && k < 30 && k % 2 === 0;
    const death = k === 46;
    events.push({ t, c: flap ? 2 : death ? 3 : [0, 1, 4][k % 3] });
  }
  const evMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.2, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff }), EV);
  events.forEach((e, k) => evMesh.setColorAt(k, e.c === 2 || e.c === 3 ? ink.heading : ink.faint));
  group.add(evMesh);
  const windowBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(7, 2.6, 3.2)), lineMat(glow(ink.accent, 1.4)));
  windowBox.position.set(-2, 6.6, FZ);
  group.add(windowBox);
  const verdict = L("", -2, 9.6, FZ, "accent", 110);
  const linkMat = lineMat(ink.faint, 0.5);
  for (const m of compMeshes)
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([m.position.clone().setX(-32.2), new THREE.Vector3(TL0, 6.2, FZ)]), linkMat));

  const stops: StopDef[] = [
    { id: "now", vh: 150, keys: [key(22, 26, 44, -14, 11, 0), key(6, 18, 30, -14, 11, -2)] },
    { id: "now-bt", vh: 130, keys: [key(8, 18, BZ + 34, -4, 17, BZ), key(2, 17, BZ + 30, -5, 16, BZ)] },
    { id: "now-fmr", vh: 140, keys: [key(-16, 14, FZ + 30, -5, 9, FZ), key(-12, 13, FZ + 26, -3, 9, FZ)] },
  ];

  const m4 = new THREE.Matrix4();
  let lastVerdict = "";

  return {
    id: "now",
    group,
    stops,
    update(ctx) {
      const t = ctx.time;
      /* ring: drone 2 faults every 7 s and is brought back */
      const c = t % 7;
      fleet.forEach((d, i) => {
        const a = (i / RN) * Math.PI * 2 + t * 0.12;
        const faulted = i === 2 && c > 2 && c < 4.6;
        const drop = i === 2 ? smoothstep(2, 2.6, c) * (1 - smoothstep(4.4, 5.2, c)) : 0;
        d.position.set(RC.x + Math.cos(a) * 13, RC.y - drop * 4 + Math.sin(t * 2 + i) * 0.25, RC.z + Math.sin(a) * 13);
        d.rotation.y = -a;
        d.rotation.z = faulted ? Math.sin(t * 14) * 0.25 : 0;
      });
      const healing = smoothstep(3.4, 3.6, c) * (1 - smoothstep(4.6, 5.2, c));
      const hp = smoothstep(3.4, 4.6, c);
      heal.scale.setScalar(1 + hp * 13);
      (heal.material as THREE.MeshBasicMaterial).opacity = healing * (1 - hp * 0.6);
      core.rotation.set(t * 0.5, t * 0.7, 0);
      const fl = c > 2 && c < 3.4 ? "fault · link lost" : c >= 3.4 && c < 5.2 ? "recovering" : "";
      if (faultLabel.el.innerHTML !== fl) faultLabel.el.innerHTML = fl;
      faultLabel.alpha = fl ? 1 : 0;

      /* tree → graph */
      const bt = stopProgress(stops, ctx.u, 1);
      const d = smoothstep(0.2, 0.62, bt);
      const risk = smoothstep(0.66, 0.82, bt);
      tree.forEach((n, i) => {
        const node = btNodes[i];
        if (n.kind === "action") {
          node.m.position.lerpVectors(treePos[i], graphPos.get(i)!, d);
        } else {
          // control flow and conditions collapse into the arrows
          const towards = graphPos.get(go)!;
          node.m.position.lerpVectors(treePos[i], towards, d * 0.4);
          node.m.scale.setScalar(Math.max(0.001, 1 - d));
          node.label.alpha = 1 - smoothstep(0, 0.5, d);
        }
      });
      tree.forEach((n, i) => {
        const p = n.parent >= 0 ? btNodes[n.parent].m.position : btNodes[i].m.position;
        const q = btNodes[i].m.position;
        treeEdgePos.set([p.x, p.y - 0.7, p.z, q.x, q.y + 0.7, q.z], i * 6);
      });
      treeEdges.geometry.attributes.position.needsUpdate = true;
      (treeEdges.material as THREE.LineBasicMaterial).opacity = 1 - smoothstep(0.1, 0.5, d);
      gLines.forEach((g) => {
        const o = smoothstep(0.6, 1, d) * (g.weak ? 1 : 0.85);
        (g.line.material as THREE.LineBasicMaterial).opacity = o;
        (g.head.material as THREE.MeshBasicMaterial).opacity = o;
        if (g.lab) g.lab.alpha = g.weak ? risk : smoothstep(0.7, 1, d);
      });
      const cap = d < 0.5 ? "16 nodes" : risk < 0.5 ? "6 actions" : "6 actions · scored";
      if (btCaption.el.innerHTML !== cap) btCaption.el.innerHTML = cap;

      /* the event tape */
      const tape = (t * 1.6) % (EV * 0.55 + 10);
      events.forEach((e, k) => {
        const x = TL1 - (tape - e.t) * 2;
        const show = x > TL0 && x < TL1;
        m4.makeTranslation(show ? x : 0, show ? 6.75 : -100, FZ + (e.c - 2) * 0.25);
        evMesh.setMatrixAt(k, m4);
      });
      evMesh.instanceMatrix.needsUpdate = true;
      // what the agent sees in its window
      let flaps = 0;
      let deaths = 0;
      events.forEach((e) => {
        const x = TL1 - (tape - e.t) * 2;
        if (Math.abs(x + 2) < 3.5) {
          if (e.c === 2) flaps++;
          if (e.c === 3) deaths++;
        }
      });
      const v = deaths ? "planner died → restart via deps" : flaps >= 2 ? "comms flapping → suppress" : "nominal";
      if (v !== lastVerdict) {
        lastVerdict = v;
        verdict.el.innerHTML = v;
      }
      // restart order lights up when the planner dies
      compMeshes.forEach((m, i) => {
        const on = deaths > 0 && (i === 3 || i === 4 || i === 2);
        m.scale.setScalar(on ? 1 + Math.sin(t * 8 + i) * 0.04 : 1);
      });
    },
  };
}
