import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit } from "./kit";
import { clay } from "./gfx";

/**
 * The outdoors, from TII on: what grows and stands in the Emirates. Date palms and the ghaf (the
 * national tree), dunes, gravel and rocks, mangroves at the water's edge, flamingos in the lagoon,
 * a camel that crosses when it likes. All primitives, merged into each room's kit.
 */

const TRUNK = "#9a7552";
const FROND = "#5e8a3a";
const FROND_DARK = "#4a7230";

/** a date palm: a ringed trunk that leans a little, a crown of drooping fronds, a bunch of dates */
export function palm(k: Kit, x: number, z: number, h = 2.3, lean = 0.08, seed = 0) {
  const segs = 7;
  let px = x;
  let pz = z;
  const dir = seed * 2.4;
  for (let i = 0; i < segs; i++) {
    const y0 = (h * i) / segs;
    const r = 0.11 - i * 0.006;
    const g = new THREE.CylinderGeometry(r * 0.92, r, h / segs + 0.01, 9);
    g.translate(px, y0 + h / segs / 2, pz);
    k.add(g, i % 2 ? TRUNK : "#8a6646");
    px += Math.cos(dir) * lean * (i / segs) * 0.5;
    pz += Math.sin(dir) * lean * (i / segs) * 0.5;
  }
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const droop = 0.35 + (i % 3) * 0.2;
    const len = 1.05 + (i % 2) * 0.22;
    // three flat segments, each bending further down
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < 3; j++) {
      const th = 0.25 - droop * j * 0.75;
      const seg = len / 3;
      const g = new THREE.BoxGeometry(seg + 0.02, 0.02, 0.22 * (1 - j * 0.28));
      g.translate(seg / 2, 0, 0);
      g.rotateZ(th);
      g.translate(cx, cy, 0);
      cx += Math.cos(th) * seg;
      cy += Math.sin(th) * seg;
      g.rotateY(-a);
      g.translate(px, h + 0.02, pz);
      k.add(g, i % 2 ? FROND : FROND_DARK);
    }
  }
  const dates = new THREE.SphereGeometry(0.13, 8, 6);
  dates.scale(1, 1.3, 1);
  dates.translate(px + 0.12, h - 0.18, pz + 0.05);
  k.add(dates, "#b7612b");
}

/** the ghaf: a short trunk and a wide, low, drooping crown */
export function ghaf(k: Kit, x: number, z: number, s = 1, seed = 1) {
  k.cyl(0.09 * s, 0.13 * s, 1.0 * s, x, 0.5 * s, z, "#6f5a44", 9);
  const blobs: [number, number, number, number][] = [
    [0, 1.25, 0, 0.75],
    [0.55, 1.05, 0.2, 0.55],
    [-0.5, 1.1, -0.15, 0.6],
    [0.1, 1.05, 0.55, 0.5],
    [-0.15, 1.12, -0.55, 0.52],
  ];
  blobs.forEach(([bx, by, bz, br], i) => {
    const g = new THREE.SphereGeometry(br * s, 12, 8);
    g.scale(1, 0.62, 1);
    g.rotateY(seed + i);
    g.translate(x + bx * s, by * s, z + bz * s);
    k.add(g, i % 2 ? "#7d9a4e" : "#6c8a42");
  });
}

/** a desert shrub: a few round tufts */
export function shrub(k: Kit, x: number, z: number, s = 1, color = "#9aa25a") {
  for (let i = 0; i < 4; i++) {
    const a = i * 2.1;
    const g = new THREE.SphereGeometry(0.16 * s * (1 - i * 0.12), 8, 6);
    g.scale(1, 0.75, 1);
    g.translate(x + Math.cos(a) * 0.12 * s, 0.1 * s, z + Math.sin(a) * 0.12 * s);
    k.add(g, color);
  }
}

/** a rock: a squashed, turned icosahedron */
export function rock(k: Kit, x: number, z: number, s = 0.3, seed = 0, color = "#b08a63") {
  const g = new THREE.IcosahedronGeometry(s, 0);
  g.scale(1.2, 0.62, 0.95);
  g.rotateY(seed);
  g.rotateX(seed * 0.3);
  g.translate(x, s * 0.35, z);
  k.add(g, color);
}

/** a dune: the top of a flattened ellipsoid, rising out of the floor */
export function dune(k: Kit, x: number, z: number, rx: number, rz: number, h: number, yaw = 0, color = "#e8c88f") {
  const g = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(rx, h, rz);
  g.rotateY(yaw);
  g.translate(x, -0.02, z);
  k.add(g, color);
}

/** a mangrove: arching roots in the water, a dense dark crown */
export function mangrove(k: Kit, x: number, z: number, s = 1, seed = 0) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + seed;
    const g = new THREE.CylinderGeometry(0.025 * s, 0.035 * s, 0.6 * s, 6);
    g.translate(0, 0.3 * s, 0);
    g.rotateZ(0.6);
    g.rotateY(-a);
    g.translate(x + Math.cos(a) * 0.32 * s, 0, z + Math.sin(a) * 0.32 * s);
    k.add(g, "#6a5a48");
  }
  k.cyl(0.06 * s, 0.08 * s, 0.7 * s, x, 0.55 * s, z, "#6a5a48", 8);
  for (const [bx, by, bz, br] of [
    [0, 1.0, 0, 0.5],
    [0.35, 0.9, 0.1, 0.36],
    [-0.3, 0.92, -0.12, 0.38],
  ]) {
    const g = new THREE.SphereGeometry(br * s, 10, 8);
    g.scale(1, 0.72, 1);
    g.translate(x + bx * s, by * s, z + bz * s);
    k.add(g, "#3f6a3a");
  }
}

/** a beach parasol, striped */
export function parasol(k: Kit, x: number, z: number, color = "#e4572e", h = 1.5) {
  k.cyl(0.025, 0.025, h, x, h / 2, z, "#f4ecd8", 8);
  for (let i = 0; i < 8; i++) {
    const g = new THREE.ConeGeometry(0.75, 0.32, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4);
    g.translate(x, h + 0.04, z);
    k.add(g, i % 2 ? color : "#fffaf1");
  }
}

/** a flamingo, standing on one leg: its geometry, for instancing */
export function flamingoGeometry() {
  const k = new Kit();
  const pink = "#f39aa6";
  const body = new THREE.SphereGeometry(0.13, 12, 8);
  body.scale(1.35, 0.85, 0.8);
  body.translate(0, 0.62, 0);
  k.add(body, pink);
  // the neck, an S in two pieces, and the head with its black-tipped beak
  const n1 = new THREE.CylinderGeometry(0.022, 0.026, 0.3, 6);
  n1.rotateZ(0.5);
  n1.translate(0.14, 0.8, 0);
  k.add(n1, pink);
  const n2 = new THREE.CylinderGeometry(0.02, 0.022, 0.26, 6);
  n2.rotateZ(-0.35);
  n2.translate(0.1, 1.04, 0);
  k.add(n2, pink);
  const head = new THREE.SphereGeometry(0.045, 8, 6);
  head.translate(0.15, 1.17, 0);
  k.add(head, pink);
  const beak = new THREE.ConeGeometry(0.022, 0.1, 6);
  beak.rotateZ(Math.PI / 2 + 0.9);
  beak.translate(0.2, 1.13, 0);
  k.add(beak, "#2b2118");
  k.cyl(0.012, 0.012, 0.56, 0, 0.28, 0, "#e88a96", 5);
  const bent = new THREE.CylinderGeometry(0.011, 0.011, 0.26, 5);
  bent.rotateZ(1.2);
  bent.translate(-0.08, 0.5, 0.03);
  k.add(bent, "#e88a96");
  return mergeGeometries(k.parts);
}

/** a camel: a group, so its legs can walk */
export function camel() {
  const g = new THREE.Group();
  g.name = "camel";
  const coat = "#c99a62";
  const dark = "#a77a48";
  const k = new Kit();
  const body = new THREE.SphereGeometry(0.42, 14, 10);
  body.scale(1.5, 0.8, 0.75);
  body.translate(0, 1.15, 0);
  k.add(body, coat);
  const hump = new THREE.SphereGeometry(0.3, 12, 8);
  hump.scale(1.1, 1, 0.9);
  hump.translate(-0.05, 1.45, 0);
  k.add(hump, coat);
  const neck = new THREE.CylinderGeometry(0.1, 0.15, 0.75, 8);
  neck.rotateZ(-0.75);
  neck.translate(0.78, 1.42, 0);
  k.add(neck, coat);
  const head = new THREE.BoxGeometry(0.36, 0.16, 0.16);
  head.translate(1.1, 1.72, 0);
  k.add(head, coat);
  for (const s of [-1, 1]) k.box(0.05, 0.08, 0.03, 1.0, 1.82, s * 0.06, dark);
  // a saddle blanket, red as in the races
  k.box(0.5, 0.05, 0.62, -0.08, 1.38, 0, "#b8322a");
  g.add(k.mesh());
  const legs: THREE.Object3D[] = [];
  for (const [lx, lz] of [
    [0.42, 0.18],
    [0.42, -0.18],
    [-0.42, 0.18],
    [-0.42, -0.18],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(lx, 1.0, lz);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 1.0, 7), clay({ color: dark }));
    leg.position.y = -0.5;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }
  return {
    group: g,
    /** walk cycle: phase in radians */
    stride(phase: number, amount: number) {
      legs.forEach((l, i) => (l.rotation.z = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.35 * amount));
    },
  };
}

/** a windsock on a mast, for the drones: the sock is its own object, to swing with the wind */
export function windsock() {
  const g = new THREE.Group();
  const k = new Kit();
  k.cyl(0.03, 0.04, 2.1, 0, 1.05, 0, "#cfd3d8", 8);
  g.add(k.mesh());
  const sock = new THREE.Group();
  const sk = new Kit();
  for (let i = 0; i < 5; i++) {
    const r0 = 0.14 - i * 0.02;
    const c = new THREE.CylinderGeometry(r0 - 0.02, r0, 0.14, 12, 1, true);
    c.rotateZ(Math.PI / 2);
    c.translate(0.08 + i * 0.14, 0, 0);
    sk.add(c, i % 2 ? "#fffaf1" : "#f07a2b");
  }
  const sm = sk.mesh();
  (sm.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
  sock.add(sm);
  sock.position.y = 2.0;
  g.add(sock);
  return { group: g, sock };
}

/** lanterns hung on a line between two posts, for the evening */
export function lanterns(k: Kit, ax: number, az: number, bx: number, bz: number, n = 7, h = 2.0) {
  for (const [x, z] of [
    [ax, az],
    [bx, bz],
  ])
    k.cyl(0.035, 0.04, h, x, h / 2, z, "#6b4a2b", 8);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const sag = Math.sin(t * Math.PI) * 0.35;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const g = new THREE.CylinderGeometry(0.06, 0.08, 0.16, 8);
    g.translate(x, h - sag - 0.12, z);
    k.add(g, i % 3 === 0 ? "#f1b33b" : i % 3 === 1 ? "#e4572e" : "#3a9d8f");
  }
}
