import * as THREE from "three";
import { blobTexture } from "./textures";

/** How an object sits in your hand when you pick it up. */
export interface HandPose {
  /** rotation toward the camera around the screen's x axis (0 = upright, PI/2 = top faces you) */
  tilt: number;
  /** base turn around its own up axis */
  yaw: number;
  /** share of the free area it fills */
  fill: number;
}

export interface TickState {
  hover: boolean;
  held: boolean;
  /** a 0..1 measure of how "picked up" it is */
  hold: number;
  reduced: boolean;
}

/** Something on the desk you can hover and pick up. */
export interface Prop {
  id: string;
  name: string;
  meta: string;
  /** which story the hand panel shows */
  panel: string;
  station: string;
  group: THREE.Group;
  hit: THREE.Mesh;
  blob: THREE.Mesh | null;
  blobOpacity: number;
  /** bounding sphere in the group's local space */
  center: THREE.Vector3;
  radius: number;
  top: number;
  hand: HandPose;
  liftHeight: number;
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  baseScale: number;
  lift: number;
  liftV: number;
  /** per-frame animation; return true while it still needs frames */
  tick?: (t: number, dt: number, s: TickState) => boolean;
  /** clicking it while held (e.g. the laptop shows the next clip) */
  onHandClick?: () => void;
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let blobRect: THREE.MeshBasicMaterial | null = null;
let blobRound: THREE.MeshBasicMaterial | null = null;

function blobMaterial(round: boolean, opacity: number) {
  if (!blobRect) {
    const make = (tex: THREE.Texture) =>
      new THREE.MeshBasicMaterial({
        color: 0x2a1708,
        alphaMap: tex,
        transparent: true,
        depthWrite: false,
        opacity: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    blobRect = make(blobTexture(false));
    blobRound = make(blobTexture(true));
  }
  const m = (round ? blobRound! : blobRect!).clone();
  m.opacity = opacity;
  return m;
}

export interface PropSpec {
  id: string;
  name: string;
  meta: string;
  panel: string;
  station: string;
  group: THREE.Group;
  hand?: Partial<HandPose>;
  liftHeight?: number;
  /** contact shadow: footprint scale and shape */
  blob?: { round?: boolean; scale?: number; opacity?: number } | false;
  tick?: Prop["tick"];
  onHandClick?: () => void;
}

const box = new THREE.Box3();
const size = new THREE.Vector3();
const ctr = new THREE.Vector3();

/** Turn a built group (already placed on the desk) into a prop: hit box, contact shadow, rest pose. */
export function makeProp(scene: THREE.Object3D, spec: PropSpec): Prop {
  const g = spec.group;
  g.updateMatrixWorld(true);
  // local bounds: measure with the group at identity
  const saved = { p: g.position.clone(), q: g.quaternion.clone(), s: g.scale.clone() };
  g.position.set(0, 0, 0);
  g.quaternion.identity();
  g.scale.set(1, 1, 1);
  g.updateMatrixWorld(true);
  box.makeEmpty();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material !== hitMat) {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
      box.union(b);
    }
  });
  box.getSize(size);
  box.getCenter(ctr);
  g.position.copy(saved.p);
  g.quaternion.copy(saved.q);
  g.scale.copy(saved.s);

  const hit = new THREE.Mesh(unitBox, hitMat);
  hit.scale.set(Math.max(size.x, 0.6) + 0.15, Math.max(size.y, 0.3) + 0.15, Math.max(size.z, 0.6) + 0.15);
  hit.position.copy(ctr);
  hit.userData.noBake = true;
  g.add(hit);

  let blob: THREE.Mesh | null = null;
  const blobOpacity = spec.blob === false ? 0 : (spec.blob?.opacity ?? 0.42);
  if (spec.blob !== false) {
    const s = spec.blob?.scale ?? 1.25;
    blob = new THREE.Mesh(blobGeo, blobMaterial(!!spec.blob?.round, blobOpacity));
    const worldCtr = ctr.clone().applyQuaternion(g.quaternion).add(g.position);
    blob.position.set(worldCtr.x, 0.004, worldCtr.z);
    blob.rotation.y = new THREE.Euler().setFromQuaternion(g.quaternion, "YXZ").y;
    blob.scale.set(size.x * s + 0.3, 1, size.z * s + 0.3);
    blob.renderOrder = 1;
    blob.userData.noBake = true;
    scene.add(blob);
  }

  scene.add(g);
  return {
    id: spec.id,
    name: spec.name,
    meta: spec.meta,
    panel: spec.panel,
    station: spec.station,
    group: g,
    hit,
    blob,
    blobOpacity,
    center: ctr.clone(),
    radius: Math.max(size.length() / 2, 0.3),
    top: box.max.y,
    hand: { tilt: 0.9, yaw: 0, fill: 0.8, ...spec.hand },
    liftHeight: spec.liftHeight ?? 0.45,
    basePos: g.position.clone(),
    baseQuat: g.quaternion.clone(),
    baseScale: g.scale.x,
    lift: 0,
    liftV: 0,
    tick: spec.tick,
    onHandClick: spec.onHandClick,
  };
}
