import * as THREE from "three";
import { blueprint, glow, ink, lineMat, rng, smoothstep } from "../core/util";
import { anchor, canvasTexture, Path, placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * 2021 — 2022, Odense. A robot working supermarket aisles: the costmap
 * around the shelves, a global plan through them, a lidar fan that actually
 * raycasts against the shelving, and a trolley tracked inside a box.
 */
export function createField(env: SceneEnv): Scene {
  const f = env.world.frame(0, 0.68);
  const group = placed(f);
  env.world.addMarker(f);
  const L = (html: string, x: number, y: number, z: number, cls = "") =>
    env.labels.add("field", anchor(group, x, y, z), html, { cls, maxDist: 150 });

  // shelving: five gondolas, aisles between them
  const shelfX = [-24, -12, 0, 12, 24];
  const SL = 36; // length along z
  const SW = 2.4;
  const SH = 5;
  const boxes: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const r = rng(2022);
  const productGeo = new THREE.BoxGeometry(1, 1, 1);
  const products: THREE.Matrix4[] = [];
  const productColors: THREE.Color[] = [];
  const tones = [ink.faint, ink.muted, ink.body, ink.line];
  for (const x of shelfX) {
    const s = blueprint(new THREE.BoxGeometry(SW, SH, SL), { fill: new THREE.Color("#171a22"), edge: ink.faint });
    s.position.set(x, SH / 2, 0);
    group.add(s);
    boxes.push({ x0: x - SW / 2 - 0.5, x1: x + SW / 2 + 0.5, z0: -SL / 2, z1: SL / 2 });
    // shelf boards + stock on both faces
    for (const side of [-1, 1]) {
      for (let lvl = 0; lvl < 3; lvl++) {
        const y = 0.6 + lvl * 1.5;
        let z = -SL / 2 + 0.6;
        while (z < SL / 2 - 0.8) {
          const w = 0.5 + r() * 1.1;
          const hgt = 0.5 + r() * 0.8;
          const d = 0.5 + r() * 0.3;
          if (r() > 0.12) {
            products.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(x + side * (SW / 2 + d / 2), y + hgt / 2, z + w / 2),
                new THREE.Quaternion(),
                new THREE.Vector3(d, hgt, w * 0.92),
              ),
            );
            productColors.push(tones[Math.floor(r() * tones.length)].clone().multiplyScalar(0.35 + r() * 0.35));
          }
          z += w + 0.08;
        }
      }
    }
  }
  const stock = new THREE.InstancedMesh(productGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), products.length);
  products.forEach((m, i) => {
    stock.setMatrixAt(i, m);
    stock.setColorAt(i, productColors[i]);
  });
  group.add(stock);

  // costmap: shelves inflated, painted on a canvas laid on the floor
  const FW = 70;
  const FD = 56;
  const cost = canvasTexture(560, 448, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const sx = w / FW;
    const sz = h / FD;
    for (const b of boxes) {
      for (let k = 6; k >= 0; k--) {
        const pad = k * 0.55;
        g.fillStyle = `rgba(133,139,156,${0.02 + (6 - k) * 0.012})`;
        g.fillRect(
          (b.x0 - pad + FW / 2) * sx,
          (b.z0 - pad + FD / 2) * sz,
          (b.x1 - b.x0 + pad * 2) * sx,
          (b.z1 - b.z0 + pad * 2) * sz,
        );
      }
    }
    g.strokeStyle = "rgba(174,179,194,0.08)";
    for (let x = 0; x <= w; x += sx) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y <= h; y += sz) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FW, FD).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: cost, transparent: true, depthWrite: false }),
  );
  floor.position.y = 0.05;
  group.add(floor);

  // global plan: in at the front, snake through two aisles, out the back
  const raw = [
    new THREE.Vector3(30, 0, 25),
    new THREE.Vector3(6, 0, 25),
    new THREE.Vector3(6, 0, -23),
    new THREE.Vector3(-6, 0, -23),
    new THREE.Vector3(-6, 0, 23),
    new THREE.Vector3(-18, 0, 23),
    new THREE.Vector3(-18, 0, -26),
  ];
  const smooth = new THREE.CatmullRomCurve3(raw, false, "centripetal", 0.2).getSpacedPoints(240);
  const plan = new Path(smooth);
  const planLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(smooth.map((p) => p.clone().setY(0.12))),
    new THREE.LineDashedMaterial({ color: ink.accent, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.9 }),
  );
  planLine.computeLineDistances();
  group.add(planLine);

  // the robot
  const robot = new THREE.Group();
  const base = blueprint(new THREE.CylinderGeometry(1.3, 1.4, 1, 24), { fill: ink.raised, edge: ink.accent });
  base.position.y = 0.6;
  const mast = blueprint(new THREE.CylinderGeometry(0.28, 0.28, 4.6, 10), { edge: ink.muted });
  mast.position.y = 3.3;
  const head = blueprint(new THREE.BoxGeometry(1.6, 0.8, 0.9), { edge: ink.body });
  head.position.set(0, 5.6, -0.2);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.8) }));
  eye.position.set(0, 5.62, -0.68);
  robot.add(base, mast, head, eye);
  group.add(robot);

  // lidar: 271 rays over 270°, intersected with the shelves in 2D
  const RAYS = 271;
  const rayPos = new Float32Array(RAYS * 6);
  const rayGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(rayPos, 3));
  const rays = new THREE.LineSegments(rayGeo, lineMat(ink.accent, 0.08));
  rays.frustumCulled = false;
  const hitPos = new Float32Array(RAYS * 3);
  const hitGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(hitPos, 3));
  const hits = new THREE.Points(hitGeo, new THREE.PointsMaterial({ color: glow(ink.heading, 1.2), size: 0.28 }));
  hits.frustumCulled = false;
  group.add(rays, hits);

  // a trolley, pushed slowly up the aisle at x = -6, and the box tracking it
  const trolley = new THREE.Group();
  const basket = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.1, 2.4)), lineMat(ink.body));
  basket.position.y = 1.6;
  const legs = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.7, 1.05, -1.1),
      new THREE.Vector3(-0.6, 0.15, -1),
      new THREE.Vector3(0.7, 1.05, -1.1),
      new THREE.Vector3(0.6, 0.15, -1),
      new THREE.Vector3(-0.7, 1.05, 1.1),
      new THREE.Vector3(-0.6, 0.15, 1),
      new THREE.Vector3(0.7, 1.05, 1.1),
      new THREE.Vector3(0.6, 0.15, 1),
      new THREE.Vector3(-0.8, 2.2, 1.3),
      new THREE.Vector3(0.8, 2.2, 1.3),
    ]),
    lineMat(ink.muted),
  );
  trolley.add(basket, legs);
  const track = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.4, 2.8, 3.2)), lineMat(ink.accent, 0.9));
  track.position.y = 1.4;
  trolley.add(track);
  group.add(trolley);
  const trolleyLabel = env.labels.add("field", trolley, "trolley · 0.94", { cls: "accent", offset: new THREE.Vector3(0, 3.6, 0), maxDist: 110 });

  L("global plan", 30, 0.5, 27, "accent");
  L("costmap · inflation 3.3 m", -30, 0.5, 21);
  L("odense · coalescent · 2021", 26, 0.5, -26, "year");
  env.labels.add("field", robot, "lidar · 270°", { offset: new THREE.Vector3(0, 7.2, 0), maxDist: 110 });

  const dir = new THREE.Vector3();
  const tmpBoxes = boxes.map((b) => ({ ...b }));
  const trolleyBox = { x0: 0, x1: 0, z0: 0, z1: 0 };

  return {
    id: "field",
    group,
    stops: [
      {
        id: "field",
        vh: 170,
        keys: [key(40, 48, 52, -6, 0, 0), key(6, 7, 38, 4, 3, -12), key(-36, 34, -38, -10, 0, -4)],
      },
    ],
    update(ctx) {
      // the robot drives as you scroll, and idles forward a touch so it never looks parked
      const drive = smoothstep(-0.25, 1.05, ctx.u) * 0.94 + 0.03 + Math.sin(ctx.time * 0.6) * 0.002;
      plan.at(drive, robot.position);
      plan.dir(drive, dir);
      robot.rotation.y = Math.atan2(-dir.x, -dir.z);

      const tz = 14 - ((ctx.time * 1.4) % 30);
      trolley.position.set(-6, 0, tz);
      trolley.rotation.y = 0;
      trolleyBox.x0 = -7;
      trolleyBox.x1 = -5;
      trolleyBox.z0 = tz - 1.3;
      trolleyBox.z1 = tz + 1.3;
      const near = robot.position.distanceTo(trolley.position) < 26;
      track.visible = near;
      trolleyLabel.alpha = near ? 1 : 0;

      const ox = robot.position.x;
      const oz = robot.position.z;
      const yaw = robot.rotation.y;
      const all = [...tmpBoxes, trolleyBox];
      for (let i = 0; i < RAYS; i++) {
        const a = yaw + ((i / (RAYS - 1)) * 1.5 - 0.75) * Math.PI;
        const dx = Math.sin(a) * -1;
        const dz = Math.cos(a) * -1;
        let tMin = 22;
        for (const b of all) {
          // slab test
          const tx0 = (b.x0 - ox) / dx;
          const tx1 = (b.x1 - ox) / dx;
          const tz0 = (b.z0 - oz) / dz;
          const tz1 = (b.z1 - oz) / dz;
          const tn = Math.max(Math.min(tx0, tx1), Math.min(tz0, tz1));
          const tf = Math.min(Math.max(tx0, tx1), Math.max(tz0, tz1));
          if (tf >= tn && tn > 0 && tn < tMin) tMin = tn;
        }
        const hx = ox + dx * tMin;
        const hz = oz + dz * tMin;
        rayPos.set([ox, 1.2, oz, hx, 1.2, hz], i * 6);
        hitPos.set(tMin < 22 ? [hx, 1.2, hz] : [ox, -50, oz], i * 3);
      }
      rayGeo.attributes.position.needsUpdate = true;
      hitGeo.attributes.position.needsUpdate = true;
    },
  };
}
