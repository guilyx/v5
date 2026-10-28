import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PAL, clay, plain, tint } from "./gfx";

/**
 * A toy version of Caltech's M4, the multi-modal robot that rolls and flies: a low body on four
 * legs, and at the end of each leg a shrouded wheel with a propeller inside. To take off, the
 * legs swing up and out until the wheels lie flat, and the four wheels become four rotors.
 *
 * Built from primitives. Hierarchy: root (pose) → lift (sitting / tilt) → body + four hips;
 * each hip swings about the robot's long axis, carrying its leg and wheel.
 */

/** body height of the hips above the ground while rolling */
const HIP_Y = 0.3;
/** leg length, hip to axle */
const LEG = 0.18;
/** axle stub: how far the wheel sits outboard of the leg */
const STUB = 0.1;
const HIP_X = 0.22;
const HIP_Z = 0.14;
export const WHEEL_R = 0.12;
/** half the track: centre of the robot to the middle of a wheel, while rolling */
export const TRACK = HIP_Z + STUB;
/** the body drops this far when the legs fold on the ground */
const SIT = 0.21;

export interface M4Parts {
  root: THREE.Group;
  lift: THREE.Group;
  hips: THREE.Group[];
  wheels: THREE.Group[];
  props: THREE.Object3D[];
  blurs: THREE.Mesh[];
  eyes: THREE.Group;
  puck: THREE.Group;
  /** fold the legs: 0 rolling, 1 flying */
  setMorph(k: number): void;
  /**
   * Roll the wheels (radians rolled forward, per side: -z then +z) and spin the props (radians);
   * blur 0..1 swaps the blades for spinning discs.
   */
  setSpin(neg: number, pos: number, prop: number, blur: number): void;
  /** fade the ghost in and out (no effect on the real robot) */
  setOpacity(o: number): void;
}

export function buildM4(o: { ghost?: THREE.ColorRepresentation; scale?: number } = {}): M4Parts {
  const ghost = o.ghost !== undefined;
  const root = new THREE.Group();
  const lift = new THREE.Group();
  root.add(lift);

  // one material for everything on the ghost; vertex colours on the real robot
  const ghostMat = ghost ? clay({ color: o.ghost, transparent: true, opacity: 0.34, emissive: 0.5 }) : null;
  const mat = ghostMat ?? clay({ vertexColors: true });
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: THREE.ColorRepresentation) => parts.push(tint(plain(g), c));

  // body: a low rounded shell, front faces +x
  const shell = new THREE.CapsuleGeometry(0.13, 0.36, 6, 18);
  shell.rotateZ(Math.PI / 2);
  shell.scale(1, 0.62, 1.08);
  shell.translate(0, HIP_Y + 0.02, 0);
  add(shell, PAL.robot);
  // a red stripe along the spine, and a dark belly pan
  const stripe = new THREE.BoxGeometry(0.46, 0.012, 0.07);
  stripe.translate(-0.02, HIP_Y + 0.105, 0);
  add(stripe, PAL.accent);
  const belly = new THREE.BoxGeometry(0.5, 0.05, 0.2);
  belly.translate(0, HIP_Y - 0.065, 0);
  add(belly, "#3a3840");
  // face: a dark visor on the nose
  const visor = new THREE.SphereGeometry(0.11, 18, 10, -0.75, 1.5, Math.PI * 0.32, Math.PI * 0.34);
  visor.rotateY(Math.PI / 2);
  visor.scale(1.05, 0.8, 1.15);
  visor.translate(0.19, HIP_Y + 0.02, 0);
  add(visor, "#2a2830");
  // hip housings, where the legs swing
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const h = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 14);
      h.rotateZ(Math.PI / 2);
      h.translate(sx * HIP_X, HIP_Y, sz * (HIP_Z - 0.01));
      add(h, "#47454e");
    }
  // lidar mast
  const mast = new THREE.CylinderGeometry(0.045, 0.055, 0.05, 14);
  mast.translate(-0.08, HIP_Y + 0.12, 0);
  add(mast, "#3a3840");
  const chassis = new THREE.Mesh(mergeGeometries(parts), mat);
  lift.add(chassis);

  // eyes on the visor; they blink and close when the robot sleeps
  const eyes = new THREE.Group();
  if (!ghost) {
    const eyeGeo = new THREE.CapsuleGeometry(0.018, 0.028, 4, 8);
    const eyeMat = clay({ color: "#9ff0ff", emissive: 0.85 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(0.286, HIP_Y + 0.035, s * 0.05);
      eyes.add(e);
    }
  }
  lift.add(eyes);

  // the LiDAR puck, with one bright window so you can see it spin
  const puck = new THREE.Group();
  if (!ghost) {
    const drum = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 18);
    const win = new THREE.BoxGeometry(0.025, 0.028, 0.08);
    win.translate(0.062, 0, 0);
    const cap = new THREE.CylinderGeometry(0.058, 0.07, 0.016, 18);
    cap.translate(0, 0.038, 0);
    puck.add(
      new THREE.Mesh(
        mergeGeometries([tint(plain(drum), "#2f2d35"), tint(plain(win), PAL.accent), tint(plain(cap), "#47454e")]),
        clay({ vertexColors: true }),
      ),
    );
  }
  puck.position.set(-0.08, HIP_Y + 0.175, 0);
  lift.add(puck);

  // legs and wheels
  const legParts = [
    tint(plain(new THREE.BoxGeometry(0.05, LEG, 0.036).translate(0, -LEG / 2, 0)), "#47454e"),
    tint(plain(new THREE.CylinderGeometry(0.018, 0.018, STUB, 10).rotateX(Math.PI / 2).translate(0, -LEG, STUB / 2)), "#3a3840"),
  ];
  const legGeo = mergeGeometries(legParts);
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.018, 0.026, 10, 30);
  const shroud = new THREE.CylinderGeometry(WHEEL_R - 0.035, WHEEL_R - 0.035, 0.06, 30, 1, true);
  shroud.rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.026, 0.026, 0.07, 12);
  hub.rotateX(Math.PI / 2);
  const tread: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    // little lugs on the tyre so you can see it roll
    const a = (k / 6) * Math.PI * 2;
    const lug = new THREE.BoxGeometry(0.03, 0.022, 0.066);
    lug.translate(Math.cos(a) * (WHEEL_R - 0.004), Math.sin(a) * (WHEEL_R - 0.004), 0);
    tread.push(tint(plain(lug), PAL.accent));
  }
  const wheelGeo = mergeGeometries([
    tint(plain(tyre), "#34323a"),
    tint(plain(shroud), "#4a4850"),
    tint(plain(hub), PAL.accent),
    ...tread,
  ]);
  const bladeGeo = mergeGeometries([
    tint(plain(new THREE.BoxGeometry(WHEEL_R * 1.55, 0.024, 0.008)), "#f2ece2"),
    tint(plain(new THREE.BoxGeometry(0.024, WHEEL_R * 1.55, 0.008)), "#f2ece2"),
  ]);
  const blurMat = new THREE.MeshBasicMaterial({
    color: ghost ? o.ghost : "#fffaf1",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const blurGeo = new THREE.CircleGeometry(WHEEL_R - 0.04, 28);

  const hips: THREE.Group[] = [];
  const wheels: THREE.Group[] = [];
  const props: THREE.Object3D[] = [];
  const blurs: THREE.Mesh[] = [];
  for (const sx of [1, -1])
    for (const sz of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * HIP_X, HIP_Y, sz * HIP_Z);
      hip.userData.side = sz;
      // the leg is built for the +z side; the -z side is the same leg turned around
      if (sz < 0) hip.scale.z = -1;
      hip.add(new THREE.Mesh(legGeo, mat));
      const wheel = new THREE.Group();
      wheel.position.set(0, -LEG, STUB);
      wheel.add(new THREE.Mesh(wheelGeo, mat));
      const prop = new THREE.Mesh(bladeGeo, ghostMat ?? clay({ vertexColors: true, side: THREE.DoubleSide }));
      wheel.add(prop);
      const blur = new THREE.Mesh(blurGeo, blurMat);
      blur.position.z = 0.012;
      wheel.add(blur);
      hip.add(wheel);
      lift.add(hip);
      hips.push(hip);
      wheels.push(wheel);
      props.push(prop);
      blurs.push(blur);
    }

  root.scale.setScalar(o.scale ?? 1);
  let fade = 1;

  return {
    root,
    lift,
    hips,
    wheels,
    props,
    blurs,
    eyes,
    puck,
    setMorph(k) {
      const a = (smooth(k) * Math.PI) / 2;
      // each leg swings up and out: +z legs about -x, the mirrored -z legs about +x
      for (const h of hips) h.rotation.x = (h.userData.side as number) > 0 ? -a : a;
      lift.position.y = sitDrop(k);
    },
    setSpin(neg, pos, prop, blur) {
      wheels.forEach((w, i) => {
        // a mirror along z leaves rotations about z alone, so both sides roll forward the same way
        w.rotation.z = -((hips[i].userData.side as number) < 0 ? neg : pos);
      });
      for (const p of props) p.rotation.z = prop;
      blurMat.opacity = blur * (ghost ? 0.25 : 0.42) * fade;
      for (const p of props) p.visible = blur < 0.85;
    },
    setOpacity(o) {
      fade = o;
      if (ghostMat) ghostMat.uniforms.uOpacity.value = 0.34 * o;
    },
  };
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/** how far the body drops as the legs fold: it ends up resting on its belly pan */
export const sitDrop = (k: number) => -SIT * Math.min(1, smooth(k) * 1.6);
