import * as THREE from "three";
import type { Flock } from "../core/flock";
import type { Labels } from "../core/labels";
import type { World } from "../core/world";
import type { Tier } from "../core/engine";

/** A camera keyframe in the scene's local frame: -Z is the direction of travel. */
export interface CamKey {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Already in world space — for shots framed against the whole route, not one scene. */
  world?: boolean;
}

export const key = (px: number, py: number, pz: number, lx: number, ly: number, lz: number): CamKey => ({
  pos: new THREE.Vector3(px, py, pz),
  look: new THREE.Vector3(lx, ly, lz),
});

/**
 * One DOM stop. Its scroll length is spread evenly over its keys, and the
 * camera heads for the next stop's first key during the last stretch.
 */
export interface StopDef {
  id: string;
  vh: number;
  keys: CamKey[];
}

/**
 * Progress through one of a scene's stops, 0..1, from the scene-wide `u`.
 * Stops share the scene's span in proportion to how many keys they hold.
 */
export function stopProgress(stops: StopDef[], u: number, i: number): number {
  const total = stops.reduce((n, s) => n + s.keys.length, 0);
  let before = 0;
  for (let j = 0; j < i; j++) before += stops[j].keys.length;
  const a = before / total;
  const b = (before + stops[i].keys.length) / total;
  return Math.min(1, Math.max(0, (u - a) / (b - a)));
}

export interface FrameCtx {
  dt: number;
  time: number;
  /** Progress across all of this scene's stops: 0 at the first, 1 at the end. Unclamped. */
  u: number;
  /** 1 while the camera is inside this scene, fading to 0 just outside it. */
  focus: number;
  camera: THREE.PerspectiveCamera;
  pointer: THREE.Vector2;
  reduced: boolean;
}

export interface SceneEnv {
  world: World;
  labels: Labels;
  flock: Flock;
  tier: Tier;
}

export interface Scene {
  id: string;
  group: THREE.Group;
  stops: StopDef[];
  update(ctx: FrameCtx): void;
  /** Called only while this scene owns the camera — steer the companion flock. */
  steer?(ctx: FrameCtx): void;
  /** Meshes that respond to a click, with what to do. */
  clickables?: { object: THREE.Object3D; onClick: () => void; hint?: string }[];
}
