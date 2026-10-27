import { BufferGeometry, Group, InstancedMesh, Material, Mesh } from "three";
import { PAL, at, ball, box, capsule, cyl, merge, ring } from "./kit";

/**
 * One toy-like object per chapter. Origin = bottom centre, front = +Z.
 * The gripper closes along `axis` across a width `w`, at height `gy` above the bottom.
 */
export interface Item {
  key: string;
  label: string;
  group: Group;
  w: number;
  gy: number;
  axis: "x" | "z";
  h: number;
  /** how far the top tips toward you while the arm shows you the object (radians) */
  tilt: number;
  kind: "place" | "fly" | "swarm";
  /** spinning props (drone) or the seven little drones (swarm) */
  extra?: InstancedMesh;
  radius: number;
}

const TAU = Math.PI * 2;
/** objects are modelled at toy scale and enlarged so they read next to the arm */
export const ITEM_SCALE = 1.3;

function item(mat: Material, parts: BufferGeometry[], o: Omit<Item, "group" | "radius">): Item {
  const group = new Group();
  const mesh = new Mesh(merge(parts), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const bs = mesh.geometry.boundingSphere!;
  const k = ITEM_SCALE;
  return { ...o, w: o.w * k, gy: o.gy * k, h: o.h * k, group, radius: (bs.radius + bs.center.length() * 0.5) * k };
}

function bookAndCap(mat: Material): Item {
  const p: BufferGeometry[] = [
    at(box(0.27, 0.01, 0.2, PAL.slate, 0.004), 0, 0.005, 0),
    at(box(0.255, 0.05, 0.188, PAL.paper, 0.004), 0.004, 0.035, 0),
    at(box(0.27, 0.01, 0.2, PAL.slate, 0.004), 0, 0.065, 0),
    at(box(0.014, 0.07, 0.2, PAL.slate, 0.006), -0.13, 0.035, 0),
    at(box(0.1, 0.003, 0.014, PAL.joint), 0.03, 0.0715, 0.04),
    // mortarboard
    at(cyl(0.07, 0.078, 0.06, PAL.graphite, 28), 0, 0.1, 0),
    at(box(0.18, 0.014, 0.18, PAL.graphite, 0.004), 0, 0.137, 0),
    at(cyl(0.012, 0.012, 0.008, PAL.joint, 12), 0, 0.148, 0),
    at(box(0.006, 0.004, 0.11, PAL.joint), 0.045, 0.146, 0.045, 0, Math.PI / 4),
    at(cyl(0.0035, 0.0035, 0.07, PAL.joint, 6), 0.084, 0.11, 0.084),
    at(cyl(0.004, 0.012, 0.022, PAL.joint, 10), 0.084, 0.07, 0.084),
  ];
  return item(mat, p, { key: "cap", label: "a book and a cap", w: 0.2, gy: 0.04, axis: "z", h: 0.15, tilt: 0.14, kind: "place" });
}

function chipBoard(mat: Material): Item {
  const p: BufferGeometry[] = [
    at(box(0.3, 0.018, 0.21, PAL.sage, 0.006), 0, 0.009, 0),
    at(box(0.13, 0.024, 0.13, PAL.graphite, 0.005), 0, 0.03, 0),
    at(cyl(0.009, 0.009, 0.004, PAL.joint, 12), -0.045, 0.043, 0.045),
    at(box(0.07, 0.002, 0.012, "#55545a"), 0.012, 0.0425, -0.01),
  ];
  // gull-wing pins on four sides
  for (let i = 0; i < 6; i++) {
    const t = -0.05 + i * 0.02;
    p.push(at(box(0.008, 0.006, 0.026, PAL.steel), t, 0.022, 0.074));
    p.push(at(box(0.008, 0.006, 0.026, PAL.steel), t, 0.022, -0.074));
    p.push(at(box(0.026, 0.006, 0.008, PAL.steel), 0.074, 0.022, t));
    p.push(at(box(0.026, 0.006, 0.008, PAL.steel), -0.074, 0.022, t));
  }
  // a header row and a few small parts
  for (let i = 0; i < 7; i++) p.push(at(box(0.016, 0.014, 0.016, PAL.graphite, 0.002), -0.105 + i * 0.019 + 0.057, 0.025, -0.09));
  p.push(at(box(0.026, 0.016, 0.018, PAL.arm, 0.004), 0.115, 0.026, 0.04));
  p.push(at(box(0.026, 0.016, 0.018, PAL.arm, 0.004), 0.115, 0.026, 0.0));
  p.push(at(cyl(0.012, 0.012, 0.024, PAL.joint, 14), -0.115, 0.03, 0.06));
  p.push(at(ring(0.009, 0.003, PAL.steel, 14), 0.13, 0.019, -0.088, Math.PI / 2));
  p.push(at(ring(0.009, 0.003, PAL.steel, 14), -0.13, 0.019, -0.088, Math.PI / 2));
  return item(mat, p, { key: "chip", label: "a chip on its board", w: 0.21, gy: 0.01, axis: "z", h: 0.045, tilt: 0.62, kind: "place" });
}

function mazeCube(mat: Material): Item {
  const S = 0.2;
  const p: BufferGeometry[] = [
    at(box(S, 0.14, S, PAL.arm, 0.022), 0, 0.07, 0),
    at(box(S - 0.02, 0.012, S - 0.02, PAL.joint, 0.004), 0, 0.142, 0),
  ];
  // a 5×5 maze on the top face, in grid units
  const c = 0.034;
  const o = -2.5 * c;
  const walls: [number, number, number, number][] = [
    [1, 0, 5, 0], [0, 5, 4, 5], [0, 0, 0, 5], [5, 0, 5, 5],
    [0, 1, 3, 1], [1, 2, 2, 2], [3, 2, 5, 2], [0, 3, 1, 3], [2, 3, 4, 3], [1, 4, 3, 4], [4, 4, 5, 4],
    [4, 1, 4, 2], [1, 2, 1, 3], [3, 3, 3, 4], [2, 4, 2, 5], [2, 1, 2, 2],
  ];
  const t = 0.009;
  for (const [x0, z0, x1, z1] of walls) {
    const w = Math.abs(x1 - x0) * c + t;
    const d = Math.abs(z1 - z0) * c + t;
    p.push(at(box(w, 0.028, d, PAL.graphite, 0.003), o + ((x0 + x1) / 2) * c, 0.162, o + ((z0 + z1) / 2) * c));
  }
  p.push(at(ball(0.012, PAL.steel, 14, 10), o + 3.5 * c, 0.16, o + 2.5 * c));
  return item(mat, p, { key: "maze", label: "a maze cube", w: 0.2, gy: 0.07, axis: "x", h: 0.18, tilt: 0.58, kind: "place" });
}

function paperStack(mat: Material): Item {
  const p: BufferGeometry[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const rot = [0.03, -0.05, 0.02, -0.025, 0.045, 0][i];
    p.push(at(box(0.21, 0.007, 0.28, i === n - 1 ? PAL.paper : "#f1ede4"), 0, 0.0035 + i * 0.0078, 0, 0, rot));
  }
  const top = 0.0035 + (n - 1) * 0.0078 + 0.0045;
  p.push(at(box(0.12, 0.002, 0.014, PAL.slate), -0.025, top, -0.095));
  p.push(at(box(0.07, 0.002, 0.009, PAL.clay), -0.05, top, -0.07));
  for (let i = 0; i < 9; i++) p.push(at(box(i % 4 === 3 ? 0.1 : 0.15, 0.0015, 0.006, PAL.line), i % 4 === 3 ? -0.025 : 0, top, -0.04 + i * 0.019));
  // binder clip
  p.push(at(box(0.07, 0.02, 0.03, PAL.graphite, 0.006), 0, top - 0.004, -0.135));
  p.push(at(ring(0.018, 0.0025, PAL.steel, 16), -0.02, top + 0.012, -0.15, 0.6, 0, 0));
  p.push(at(ring(0.018, 0.0025, PAL.steel, 16), 0.02, top + 0.012, -0.15, 0.6, 0, 0));
  return item(mat, p, { key: "papers", label: "a stack of papers", w: 0.21, gy: 0.022, axis: "x", h: 0.06, tilt: 0.72, kind: "place" });
}

function trolley(mat: Material): Item {
  const p: BufferGeometry[] = [];
  for (const [x, z] of [[-0.08, -0.055], [0.08, -0.055], [-0.08, 0.055], [0.08, 0.055]]) {
    p.push(at(cyl(0.02, 0.02, 0.014, PAL.graphite, 16), x, 0.02, z, Math.PI / 2));
    p.push(at(cyl(0.005, 0.005, 0.05, PAL.steel, 6), x, 0.055, z));
  }
  p.push(at(box(0.19, 0.01, 0.12, PAL.steel, 0.003), 0, 0.08, 0));
  // basket: bottom, four walls, and wire lines
  const bw = 0.23;
  const bd = 0.15;
  const by = 0.1;
  const bh = 0.11;
  p.push(at(box(bw - 0.03, 0.008, bd - 0.01, PAL.arm), 0.01, by, 0));
  p.push(at(box(bw, bh, 0.008, PAL.arm, 0.003), 0, by + bh / 2, bd / 2));
  p.push(at(box(bw, bh, 0.008, PAL.arm, 0.003), 0, by + bh / 2, -bd / 2));
  p.push(at(box(0.008, bh, bd, PAL.arm, 0.003), bw / 2, by + bh / 2, 0));
  p.push(at(box(0.008, bh, bd, PAL.arm, 0.003), -bw / 2, by + bh / 2, 0));
  for (let i = 1; i < 7; i++) {
    const x = -bw / 2 + (i * bw) / 7;
    p.push(at(box(0.004, bh * 0.86, 0.004, PAL.graphite), x, by + bh / 2, bd / 2 + 0.006));
  }
  for (let i = 1; i < 3; i++) {
    const z = -bd / 2 + (i * bd) / 3;
    p.push(at(box(0.004, bh * 0.86, 0.004, PAL.graphite), bw / 2 + 0.006, by + bh / 2, z));
  }
  p.push(at(box(bw + 0.012, 0.01, 0.014, PAL.graphite, 0.003), 0, by + bh, bd / 2));
  p.push(at(box(bw + 0.012, 0.01, 0.014, PAL.graphite, 0.003), 0, by + bh, -bd / 2));
  // handle
  p.push(at(cyl(0.008, 0.008, bd + 0.02, PAL.joint, 12), -bw / 2 - 0.05, by + bh + 0.035, 0, Math.PI / 2));
  p.push(at(box(0.06, 0.008, 0.008, PAL.graphite), -bw / 2 - 0.025, by + bh + 0.018, bd / 2 - 0.005, 0, 0, 0.6));
  p.push(at(box(0.06, 0.008, 0.008, PAL.graphite), -bw / 2 - 0.025, by + bh + 0.018, -bd / 2 + 0.005, 0, 0, 0.6));
  return item(mat, p, { key: "trolley", label: "a shopping trolley", w: bd, gy: by + bh - 0.03, axis: "z", h: by + bh + 0.04, tilt: 0.06, kind: "place" });
}

function drone(mat: Material): Item {
  const p: BufferGeometry[] = [
    at(box(0.11, 0.042, 0.13, PAL.arm, 0.018), 0, 0.05, 0),
    at(box(0.07, 0.014, 0.08, PAL.joint, 0.006), 0, 0.075, -0.005),
    at(box(0.04, 0.02, 0.012, PAL.graphite, 0.004), 0, 0.05, 0.066),
    at(cyl(0.008, 0.008, 0.004, "#7fa7c9", 10), 0, 0.05, 0.073, Math.PI / 2),
    at(box(0.34, 0.012, 0.018, PAL.graphite, 0.004), 0, 0.052, 0, 0, Math.PI / 4),
    at(box(0.34, 0.012, 0.018, PAL.graphite, 0.004), 0, 0.052, 0, 0, -Math.PI / 4),
    // skids
    at(box(0.012, 0.03, 0.012, PAL.graphite), 0.035, 0.02, 0.04),
    at(box(0.012, 0.03, 0.012, PAL.graphite), -0.035, 0.02, 0.04),
    at(box(0.012, 0.03, 0.012, PAL.graphite), 0.035, 0.02, -0.04),
    at(box(0.012, 0.03, 0.012, PAL.graphite), -0.035, 0.02, -0.04),
    at(box(0.012, 0.008, 0.13, PAL.graphite, 0.003), 0.035, 0.004, 0),
    at(box(0.012, 0.008, 0.13, PAL.graphite, 0.003), -0.035, 0.004, 0),
  ];
  const m = 0.12;
  for (const [x, z] of [[m, m], [-m, m], [m, -m], [-m, -m]]) {
    p.push(at(cyl(0.02, 0.022, 0.03, PAL.graphite, 18), x, 0.063, z));
    p.push(at(cyl(0.021, 0.021, 0.006, PAL.joint, 18), x, 0.08, z));
  }
  const it = item(mat, p, { key: "drone", label: "a drone", w: 0.11, gy: 0.05, axis: "x", h: 0.09, tilt: 0.3, kind: "fly" });
  const prop = merge([at(box(0.15, 0.004, 0.018, PAL.graphite, 0.002), 0, 0, 0, 0, 0.2), at(cyl(0.008, 0.008, 0.012, PAL.steel, 10), 0, 0, 0)]);
  const props = new InstancedMesh(prop, mat, 4);
  props.castShadow = true;
  props.userData.motors = [[m, m], [-m, m], [m, -m], [-m, -m]];
  it.group.add(props);
  it.extra = props;
  return it;
}

function micWave(mat: Material): Item {
  const p: BufferGeometry[] = [
    at(cyl(0.135, 0.14, 0.022, PAL.graphite, 40), 0, 0.011, 0),
    at(cyl(0.12, 0.12, 0.004, PAL.rubber, 40), 0, 0.024, 0),
    // stand + mic
    at(cyl(0.008, 0.01, 0.12, PAL.steel, 10), 0, 0.085, 0),
    at(ring(0.04, 0.006, PAL.graphite, 24), 0, 0.17, 0, 0, Math.PI / 2),
    at(capsule(0.034, 0.06, PAL.graphite), 0, 0.2, 0),
    at(cyl(0.0355, 0.0355, 0.016, PAL.joint, 24), 0, 0.185, 0),
    at(cyl(0.006, 0.006, 0.04, PAL.steel, 8), 0.04, 0.17, 0, 0, 0, Math.PI / 2),
  ];
  // the sound wave: a ring of bars around the mic
  const N = 18;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const h = 0.025 + 0.06 * Math.abs(Math.sin(a * 2.5 + 0.4)) * (0.6 + 0.4 * Math.cos(a * 1.5));
    p.push(at(box(0.016, h, 0.016, i % 3 === 0 ? PAL.arm : PAL.joint, 0.005), Math.sin(a) * 0.098, 0.026 + h / 2, Math.cos(a) * 0.098, 0, a));
  }
  return item(mat, p, { key: "mic", label: "a microphone and its sound wave", w: 0.068, gy: 0.2, axis: "x", h: 0.25, tilt: 0.12, kind: "place" });
}

/** the seven little drones of the swarm, in a hex formation */
export const SWARM_SPOTS: [number, number][] = [[0, 0], ...Array.from({ length: 6 }, (_, i): [number, number] => [Math.sin((i * TAU) / 6) * 0.064, Math.cos((i * TAU) / 6) * 0.064])];

function swarm(mat: Material): Item {
  const p: BufferGeometry[] = [
    at(cyl(0.112, 0.116, 0.026, PAL.graphite, 6), 0, 0.013, 0, 0, Math.PI / 6),
    at(cyl(0.1, 0.1, 0.004, PAL.rubber, 6), 0, 0.027, 0, 0, Math.PI / 6),
  ];
  for (const [x, z] of SWARM_SPOTS) p.push(at(ring(0.018, 0.003, PAL.joint, 18), x, 0.029, z, Math.PI / 2));
  const it = item(mat, p, { key: "swarm", label: "a swarm, in formation", w: 0.194, gy: 0.013, axis: "x", h: 0.06, tilt: 0.55, kind: "swarm" });
  const mini = merge([
    at(cyl(0.017, 0.019, 0.014, PAL.arm, 16), 0, 0.007, 0),
    at(cyl(0.008, 0.008, 0.006, PAL.joint, 10), 0, 0.016, 0),
    at(box(0.06, 0.005, 0.007, PAL.graphite), 0, 0.009, 0, 0, Math.PI / 4),
    at(box(0.06, 0.005, 0.007, PAL.graphite), 0, 0.009, 0, 0, -Math.PI / 4),
    ...[0, 1, 2, 3].map((i) => at(cyl(0.007, 0.007, 0.008, PAL.joint, 10), Math.cos(i * 1.571 + 0.785) * 0.022, 0.012, Math.sin(i * 1.571 + 0.785) * 0.022)),
  ]);
  const drones = new InstancedMesh(mini, mat, SWARM_SPOTS.length);
  drones.castShadow = true;
  it.group.add(drones);
  it.extra = drones;
  return it;
}

export function buildItems(mat: Material): Item[] {
  return [bookAndCap(mat), chipBoard(mat), mazeCube(mat), paperStack(mat), trolley(mat), drone(mat), micWave(mat), swarm(mat)];
}
