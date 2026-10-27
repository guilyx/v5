import * as THREE from "three";
import { glow, ink, smoothstep } from "../core/util";
import { NODES } from "../core/world";
import { anchor, placed } from "./kit";
import { key, type CamKey, type Scene, type SceneEnv } from "./types";

/**
 * Open Channel — the third waypoint, where the path stops. The node
 * broadcasts; then the camera climbs until the route you just flew reads as
 * what it always was: the mark. Three nodes, and a path left open.
 */
export function createChannel(env: SceneEnv): Scene {
  const f = env.world.frame(1, 1.0);
  const group = placed(f);

  // broadcast: rings leaving the node on a loop
  const RINGS = 5;
  const rings = Array.from({ length: RINGS }, () => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.2), transparent: true, opacity: 0, depthWrite: false }),
    );
    m.position.y = 0.3;
    group.add(m);
    return m;
  });
  env.labels.add("channel", anchor(group, 0, 12, 0), "open channel", { cls: "accent", maxDist: 160 });

  // names for the three waypoints, legible only from the top
  const centroid = NODES.apex.clone().add(NODES.left).add(NODES.right).divideScalar(3);
  group.updateMatrixWorld(true);
  const nodeLabels = (
    [
      [NODES.apex, "2018 · launch"],
      [NODES.left, "2022 · one robot to many"],
      [NODES.right, "now · open channel"],
    ] as const
  ).map(([p, text]) => {
    const local = group.worldToLocal(p.clone().add(new THREE.Vector3(0, 0, p === NODES.apex ? -125 : 125)));
    return env.labels.add("channel", anchor(group, local.x, local.y, local.z), text, { cls: "tag", maxDist: 6000 });
  });

  // frame the bounding box, not the centroid, so the mark sits centred on screen
  const boxZ = (NODES.apex.z + NODES.left.z) / 2;
  const reveal: CamKey = {
    pos: new THREE.Vector3(centroid.x, REVEAL_D, boxZ + REVEAL_D * 0.2),
    look: new THREE.Vector3(centroid.x, 0, boxZ + 34),
    world: true,
  };
  const mid: CamKey = {
    pos: new THREE.Vector3(NODES.right.x - 120, 360, NODES.right.z + 220),
    look: new THREE.Vector3(NODES.right.x - 260, 0, NODES.right.z - 60),
    world: true,
  };

  const centre = new THREE.Vector3();
  let revealAmt = 0;

  return {
    id: "channel",
    group,
    stops: [
      { id: "channel", vh: 130, keys: [key(-28, 14, 30, -6, 7, -12), key(-44, 40, 70, -8, 4, 4)] },
      { id: "contact", vh: 190, keys: [mid, reveal] },
    ],
    update(ctx) {
      for (let i = 0; i < RINGS; i++) {
        const p = (ctx.time * 0.18 + i / RINGS) % 1;
        rings[i].scale.setScalar(3 + p * 60);
        (rings[i].material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p) * (1 - revealAmt);
      }
      revealAmt = smoothstep(0.6, 0.95, ctx.u);
      for (const l of nodeLabels) l.alpha = revealAmt;
    },
    steer(ctx) {
      group.localToWorld(centre.set(0, 10, 0));
      env.flock.goal = { kind: "orbit", center: centre, radius: 22, height: 7, speed: ctx.reduced ? 0.08 : 0.3 };
    },
  };
}

const REVEAL_D = 1420;

/** How far the last shot has to pull back to fit the whole mark on this screen. */
export function revealFit(aspect: number, fovDeg: number, amount: number) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const base = REVEAL_D * (Math.tan(THREE.MathUtils.degToRad(25)) / tanHalf);
  const need = Math.max(base, 1500 / (2 * tanHalf * aspect));
  return 1 + amount * (need / REVEAL_D - 1);
}
