import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PAL, blobMaterial, clay, plain, tint } from "./gfx";

/**
 * A small differential-drive robot: round body, two wheels, a caster, a face, and a LiDAR puck
 * that spins on top. Built from primitives; the static parts are merged into one mesh.
 */
export function buildRobot(scale = 1, bodyColor: THREE.ColorRepresentation = PAL.robot, accent: THREE.ColorRepresentation = PAL.accent) {
  const root = new THREE.Group();
  const R = 0.3;

  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: THREE.ColorRepresentation) => parts.push(tint(plain(g), c));

  // body: a short rounded drum
  const body = new THREE.CylinderGeometry(R, R * 0.98, 0.2, 32);
  body.translate(0, 0.19, 0);
  add(body, bodyColor);
  const dome = new THREE.SphereGeometry(R, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.28);
  dome.scale(1, 0.55, 1);
  dome.translate(0, 0.29 - R * 0.55 * Math.cos(Math.PI * 0.28) + 0.0, 0);
  add(dome, bodyColor);
  // bumper ring in the accent colour
  const bumper = new THREE.TorusGeometry(R * 1.0, 0.03, 8, 36);
  bumper.rotateX(Math.PI / 2);
  bumper.translate(0, 0.11, 0);
  add(bumper, accent);
  // face: a dark visor on the front (+x)
  const visor = new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.11, 24, 1, true, -0.62, 1.24);
  visor.rotateY(Math.PI / 2);
  visor.translate(0, 0.21, 0);
  add(visor, "#2a2830");
  // lidar mast
  const mast = new THREE.CylinderGeometry(0.06, 0.07, 0.07, 16);
  mast.translate(-0.02, 0.34, 0);
  add(mast, "#3a3840");
  // caster
  const caster = new THREE.SphereGeometry(0.045, 10, 8);
  caster.translate(-0.2, 0.045, 0);
  add(caster, "#3a3840");

  const chassis = new THREE.Mesh(mergeGeometries(parts), clay({ vertexColors: true }));
  root.add(chassis);

  // eyes: two soft capsules on the visor; they blink and close when the robot sleeps
  const eyeGeo = new THREE.CapsuleGeometry(0.022, 0.035, 4, 8);
  const eyeMat = clay({ color: "#9ff0ff", emissive: 0.85 });
  const eyes = new THREE.Group();
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(R * 0.97, 0.215, s * 0.075);
    eyes.add(e);
  }
  root.add(eyes);

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.05, 20);
  wheelGeo.rotateX(Math.PI / 2);
  const hub = new THREE.BoxGeometry(0.12, 0.03, 0.052);
  const wheelMerged = mergeGeometries([tint(plain(wheelGeo), "#34323a"), tint(plain(hub), accent)]);
  const wheelMat = clay({ vertexColors: true });
  const wheels: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wheelMerged, wheelMat);
    w.position.set(0.03, 0.095, s * (R + 0.01));
    root.add(w);
    wheels.push(w);
  }

  // the LiDAR puck: a drum with one bright window, so you can see it spin
  const puck = new THREE.Group();
  const drum = new THREE.CylinderGeometry(0.085, 0.085, 0.08, 20);
  const window = new THREE.BoxGeometry(0.03, 0.035, 0.1);
  window.translate(0.075, 0, 0);
  const cap = new THREE.CylinderGeometry(0.07, 0.085, 0.02, 20);
  cap.translate(0, 0.05, 0);
  const lidar = new THREE.Mesh(
    mergeGeometries([tint(plain(drum), "#2f2d35"), tint(plain(window), accent), tint(plain(cap), "#47454e")]),
    clay({ vertexColors: true }),
  );
  puck.add(lidar);
  puck.position.set(-0.02, 0.415, 0);
  root.add(puck);

  // soft contact shadow
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), blobMaterial(0.9));
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0.04, 0.003, 0.05);
  blob.renderOrder = 1;
  root.add(blob);

  root.scale.setScalar(scale);
  return { root, eyes, wheels, puck, chassis };
}

export type RobotParts = ReturnType<typeof buildRobot>;
