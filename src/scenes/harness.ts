import * as THREE from "three";
import { agentic } from "../content";
import { glow, ink, lineMat, smoothstep } from "../core/util";
import { placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * The agentic era. Every change takes the same path, whoever or whatever
 * wrote it — so you fly that path: six gates, and a change ahead of you
 * that has to clear each one.
 */
export function createHarness(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0.42);
  const group = placed(f);
  env.world.addMarker(f);

  const GX = 6;
  const GY = 9;
  const GAP = 17;
  const gates = agentic.harness.map((h, i) => {
    const z = -i * GAP;
    const g = new THREE.Group();
    g.position.set(GX, GY, z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6.5, 0.09, 8, 96),
      new THREE.MeshBasicMaterial({ color: ink.body.clone() }),
    );
    g.add(ring);
    // tick marks around the gate, like a reticle
    const ticks: THREE.Vector3[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r0 = 7;
      const r1 = k % 6 === 0 ? 8.2 : 7.5;
      ticks.push(new THREE.Vector3(Math.cos(a) * r0, Math.sin(a) * r0, 0), new THREE.Vector3(Math.cos(a) * r1, Math.sin(a) * r1, 0));
    }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), lineMat(ink.faint)));
    // a post down to the ground
    g.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -8.2, 0), new THREE.Vector3(0, -GY, 0)]), lineMat(ink.line)),
    );
    group.add(g);
    env.labels.add("harness", g, `<b>${String(i + 1).padStart(2, "0")}</b> ${h.step}`, {
      offset: new THREE.Vector3(0, 9.6, 0),
      maxDist: 42,
      cls: "tag",
    });
    env.labels.add("harness", g, h.note, { offset: new THREE.Vector3(0, -9.6, 0), maxDist: 30, cls: "year" });
    return { g, ring, z };
  });

  // the change: a small block with a trail
  const change = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.8) }));
  change.add(cube);
  const TR = 30;
  const trailPos = new Float32Array(TR * 3);
  const trail = new THREE.Line(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(trailPos, 3)),
    lineMat(ink.accent, 0.6),
  );
  trail.frustumCulled = false;
  group.add(change, trail);
  const changeLabel = env.labels.add("harness", change, "your diff", { offset: new THREE.Vector3(0, 1.8, 0), cls: "accent", maxDist: 80 });

  const END = -(agentic.harness.length - 1) * GAP;
  const lis = () => Array.from(document.querySelectorAll<HTMLLIElement>("#agentic .gates li"));
  let lastGate = -2;
  const hist: THREE.Vector3[] = [];

  return {
    id: "harness",
    group,
    stops: [
      {
        id: "agentic",
        vh: 230,
        keys: [
          key(-6, 13, 34, GX - 2, GY, -10),
          key(GX - 1.5, GY + 0.4, 10, GX, GY, -30),
          key(GX - 1, GY + 0.4, -28, GX, GY, -60),
          key(GX - 1.5, GY + 0.6, -62, GX, GY, END - 30),
          key(GX + 10, GY + 10, END - 22, GX, GY - 2, END - 70),
        ],
      },
    ],
    update(ctx) {
      // the change leads the camera through the gates
      const cz = 22 + (END - 14 - 22) * smoothstep(0.02, 0.92, ctx.u);
      change.position.set(GX, GY + Math.sin(ctx.time * 3) * 0.3, cz);
      cube.rotation.set(ctx.time * 1.2, ctx.time * 0.9, 0);
      hist.unshift(change.position.clone());
      if (hist.length > TR) hist.pop();
      hist.forEach((p, i) => trailPos.set([p.x, p.y, p.z + i * 0.06], i * 3));
      for (let i = hist.length; i < TR; i++) trailPos.set([change.position.x, change.position.y, change.position.z], i * 3);
      trail.geometry.attributes.position.needsUpdate = true;

      // a gate lights as the change clears it
      let current = -1;
      gates.forEach((g, i) => {
        const passed = cz < g.z;
        if (passed) current = i;
        const near = 1 - smoothstep(0, 10, Math.abs(cz - g.z));
        const mat = g.ring.material as THREE.MeshBasicMaterial;
        mat.color.copy(passed || near > 0.2 ? ink.accent : ink.body).multiplyScalar(1 + near * 1.2);
        g.g.rotation.z = (passed ? 1 : 0) * Math.PI * 0.25 + Math.sin(ctx.time * 0.5 + i) * 0.05;
      });
      changeLabel.alpha = smoothstep(0, 0.05, ctx.u);
      if (current !== lastGate) {
        lastGate = current;
        lis().forEach((li, i) => li.classList.toggle("on", i <= current));
      }
    },
  };
}
