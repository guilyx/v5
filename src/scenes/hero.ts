import * as THREE from "three";
import { easeInOut, glow, halo, ink, lineMat, polyline } from "../core/util";
import { anchor, placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * Launch. The apex waypoint, a launch pad of range rings, and the mark itself
 * standing over it at monument scale — turning only in 120° steps, the one
 * rotation the brand allows, because the mark lands back on itself.
 */
export function createHero(env: SceneEnv): Scene {
  const f = env.world.frame(0, 0);
  const group = placed(f);
  env.world.addMarker(f);

  // the mark, from the 32×32 construction grid (y flipped), centred on its centroid
  const mark = new THREE.Group();
  const S = 1.0;
  const raw = [
    [16, 8.5],
    [8.5, 21],
    [23.5, 21],
  ];
  const cx = (16 + 8.5 + 23.5) / 3;
  const cy = (8.5 + 21 + 21) / 3;
  const pts = raw.map(([x, y]) => new THREE.Vector3((x - cx) * S, -(y - cy) * S, 0));
  const nodeGeo = new THREE.SphereGeometry(2.1 * S, 32, 16);
  const nodeMat = new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.5) });
  for (const p of pts) {
    const n = new THREE.Mesh(nodeGeo, nodeMat);
    n.position.copy(p);
    mark.add(n);
    const h = halo(ink.accent, 11, 0.3);
    h.position.copy(p);
    mark.add(h);
  }
  // open path — two straight segments, no closing one, on purpose
  const routeMat = new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.2), transparent: true, opacity: 0.45 });
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(0.3, 0.3, len, 8, 1);
    const m = new THREE.Mesh(g, routeMat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  mark.add(seg(pts[0], pts[1]), seg(pts[1], pts[2]));
  const markHolder = new THREE.Group();
  markHolder.position.set(0, 30, 0);
  markHolder.add(mark);
  group.add(markHolder);

  // launch pad: range rings and ticks
  const pad = new THREE.Group();
  for (let r = 10; r <= 70; r += 12) {
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 129 }, (_, i) => {
          const a = (i / 128) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * r, 0.08, Math.sin(a) * r);
        }),
      ),
      lineMat(r === 34 ? ink.muted : ink.line, r === 34 ? 0.8 : 1),
    );
    pad.add(ring);
  }
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r0 = 70;
    const r1 = i % 3 === 0 ? 76 : 73;
    pad.add(
      polyline(
        [new THREE.Vector3(Math.cos(a) * r0, 0.08, Math.sin(a) * r0), new THREE.Vector3(Math.cos(a) * r1, 0.08, Math.sin(a) * r1)],
        lineMat(ink.faint),
      ),
    );
  }
  // a sweep pulse expanding outward
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.99, 1, 128).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: ink.accent, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  pulse.position.y = 0.1;
  pad.add(pulse);
  group.add(pad);

  env.labels.add("hero", anchor(group, 0, 0.5, -76), "heading 329° · leg 1 of 2", { cls: "year deco", maxDist: 200 });
  env.labels.add("hero", anchor(group, 52, 0.5, 52), "range 70 m", { cls: "deco", maxDist: 200 });

  const flockCenter = new THREE.Vector3();
  let step = 0;
  let stepT = 0;

  return {
    id: "hero",
    group,
    stops: [
      {
        id: "top",
        vh: 110,
        keys: [key(16, 24, 64, -12, 24, 0), key(4, 44, 10, 0, 10, -90)],
      },
    ],
    update(ctx) {
      // a 120° turn every few seconds, eased; the mark is never caught mid-way for long
      stepT += ctx.dt / (ctx.reduced ? 8 : 3.2);
      if (stepT >= 1) {
        stepT = 0;
        step++;
      }
      const turning = Math.max(0, (stepT - 0.7) / 0.3);
      mark.rotation.z = -(step + easeInOut(turning)) * ((Math.PI * 2) / 3);
      markHolder.rotation.y = Math.sin(ctx.time * 0.3) * 0.35 + ctx.pointer.x * 0.25;
      markHolder.position.y = 30 + Math.sin(ctx.time * 0.8) * 0.8;

      const p = (ctx.time * 0.25) % 1;
      pulse.scale.setScalar(4 + p * 70);
      (pulse.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p);
    },
    steer(ctx) {
      group.localToWorld(flockCenter.set(0, 30, 0));
      env.flock.goal = { kind: "orbit", center: flockCenter, radius: 30, height: 9, speed: ctx.reduced ? 0.1 : 0.32 };
    },
  };
}
