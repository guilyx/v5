import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SRGBColorSpace,
} from "three";
import { Builder, rng, lin, mat, box, cyl, blob } from "./geo";

/** Radial blur texture for spinning propellers. */
function blurTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 63);
  grd.addColorStop(0, "rgba(60,70,95,0.0)");
  grd.addColorStop(0.2, "rgba(60,70,95,0.16)");
  grd.addColorStop(0.78, "rgba(60,70,95,0.1)");
  grd.addColorStop(0.93, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(64, 64, 63, 0, Math.PI * 2);
  g.fill();
  // two faint blade streaks so the disc reads as motion
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(30,36,56,0.12)";
  for (let k = 0; k < 2; k++) {
    g.save();
    g.translate(64, 64);
    g.rotate(k * Math.PI);
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 62, -0.25, 0.25);
    g.closePath();
    g.fill();
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.center.set(0.5, 0.5);
  return t;
}

export interface Drone {
  group: Group;
  /** inner group that receives attitude */
  body: Group;
  props: Group[];
  blades: Mesh[];
  discMat: MeshBasicMaterial;
  bladeMat: MeshLambertMaterial;
  disc: CanvasTexture;
}

export const ARM = 0.34;

export function buildDrone(): Drone {
  const r = rng(5);
  const b = new Builder(r);
  const white = lin("#fbfbf8");
  const shell = lin("#eef0f3");
  const dark = lin("#2c3346");
  const arm = lin("#4a5368");
  const accent = lin("#ff6a33");
  const lensC = lin("#1b2030");
  const green = lin("#3ee08a");
  const red = lin("#ff4d4d");
  const Y = 0.2; // body centre height above the feet

  // central body
  b.add(box(), mat(0, Y - 0.06, 0, 0.36, 0.13, 0.46), shell, 0.02);
  b.add(blob(1), mat(0, Y + 0.07, -0.02, 0.32, 0.16, 0.42), white, 0.02);
  b.add(box(), mat(0, Y + 0.13, -0.02, 0.06, 0.03, 0.3), accent, 0);
  // battery pack on the back
  b.add(box(), mat(0, Y - 0.02, 0.27, 0.22, 0.1, 0.12), dark, 0.02);
  // camera gimbal at the nose
  b.add(blob(1), mat(0, Y - 0.1, -0.24, 0.12, 0.12, 0.12), dark, 0.02);
  b.add(cyl(10), mat(0, Y - 0.12, -0.3, 0.06, 0.03, 0.06).multiply(mat(0, 0, 0).makeRotationX(Math.PI / 2)), lensC, 0);
  // arms + motors (X configuration)
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const ang = Math.atan2(sx, sz);
    b.add(box(), mat((sx * ARM) / 2, Y - 0.03, (sz * ARM) / 2, 0.05, 0.04, ARM * 1.414, ang), arm, 0.02);
    b.add(cyl(10), mat(sx * ARM, Y - 0.05, sz * ARM, 0.1, 0.1, 0.1), dark, 0.02);
    // LEDs: green at the front, red at the back
    b.add(box(), mat(sx * ARM, Y - 0.085, sz * ARM, 0.05, 0.03, 0.05), sz < 0 ? green : red, 0);
  }
  // landing skids
  for (const sx of [-1, 1]) {
    b.add(box(), mat(sx * 0.14, 0, 0, 0.035, 0.03, 0.46), white, 0);
    b.add(box(), mat(sx * 0.12, 0.02, -0.1, 0.03, 0.14, 0.03), arm, 0);
    b.add(box(), mat(sx * 0.12, 0.02, 0.12, 0.03, 0.14, 0.03), arm, 0);
  }
  const bodyMesh = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));

  const body = new Group();
  body.add(bodyMesh);
  const group = new Group();
  group.add(body);

  const disc = blurTexture();
  const discMat = new MeshBasicMaterial({ map: disc, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
  const bladeMat = new MeshLambertMaterial({ color: "#3a4256" });
  const discGeo = new CircleGeometry(0.24, 28).rotateX(-Math.PI / 2);
  const bladeGeo = new BoxGeometry(0.44, 0.012, 0.045);
  const props: Group[] = [];
  const blades: Mesh[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const p = new Group();
    p.position.set(sx * ARM, Y + 0.02, sz * ARM);
    const d = new Mesh(discGeo, discMat);
    d.renderOrder = 2;
    const bl = new Mesh(bladeGeo, bladeMat);
    p.add(d, bl);
    body.add(p);
    props.push(p);
    blades.push(bl);
  }
  return { group, body, props, blades, discMat, bladeMat, disc };
}

/** A smaller, simpler drone for the swarm: one merged geometry, drawn instanced. */
export function buildWingGeometry() {
  const b = new Builder(rng(8));
  const white = lin("#f6f7f9");
  const dark = lin("#2c3346");
  const arm = lin("#4a5368");
  const stripe = lin("#2fbf7f");
  const disc = lin("#c9d1de");
  const Y = 0.2;
  b.add(box(), mat(0, Y - 0.06, 0, 0.34, 0.13, 0.44), white, 0.02);
  b.add(blob(0), mat(0, Y + 0.06, 0, 0.3, 0.14, 0.38), white, 0.02);
  b.add(box(), mat(0, Y + 0.12, 0, 0.06, 0.03, 0.28), stripe, 0);
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    b.add(box(), mat((sx * ARM) / 2, Y - 0.03, (sz * ARM) / 2, 0.05, 0.04, ARM * 1.414, Math.atan2(sx, sz)), arm, 0.02);
    b.add(cyl(8), mat(sx * ARM, Y - 0.05, sz * ARM, 0.1, 0.1, 0.1), dark, 0.02);
    b.add(cyl(14), mat(sx * ARM, Y + 0.05, sz * ARM, 0.44, 0.012, 0.44), disc, 0);
  }
  for (const sx of [-1, 1]) b.add(box(), mat(sx * 0.13, 0, 0, 0.035, 0.03, 0.42), white, 0);
  return b.build();
}
