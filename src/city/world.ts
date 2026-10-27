import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector2,
  Vector3,
  Euler,
  type Material,
} from "three";
import { Kit, capGeometry, rng, wallGeometry } from "./kit";
import { BEACH_Y, BRIDGES, DISC_R, DISTRICTS, PLATEAU_Y, TOP_Y, WATER_Y, districtById, outline } from "./layout";
import { P } from "./palette";
import { tree } from "./props";
import { U } from "./materials";

export interface Exclusion {
  x: number;
  z: number;
  r: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** soft radial dot, for night light pools and the floor shadow */
function radialTexture(size = 64, inner = 0.0) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  return t;
}

/** Shallows and foam around the islands, painted once into a small texture. */
function shoreTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const px = (v: number) => ((v + DISC_R) / (2 * DISC_R)) * S;
  const OFF = 4000;
  const shape = (d: (typeof DISTRICTS)[number], scale: number) => {
    const pts = outline(d, scale);
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(px(x) - OFF, px(z)) : g.moveTo(px(x) - OFF, px(z))));
    g.closePath();
  };
  // shallows: green channel, wide blur (drawn as an offset shadow so every browser blurs it)
  g.shadowOffsetX = OFF;
  for (const d of DISTRICTS) {
    g.shadowColor = "rgb(0,255,0)";
    g.shadowBlur = 26;
    g.fillStyle = "rgb(0,255,0)";
    shape(d, 1.12);
    g.fill();
  }
  // foam: red channel, a thin soft ring hugging the beach
  g.globalCompositeOperation = "lighter";
  for (const d of DISTRICTS) {
    g.shadowColor = "rgb(255,0,0)";
    g.shadowBlur = 5;
    g.strokeStyle = "rgb(255,0,0)";
    g.lineWidth = 3.5;
    shape(d, 1.045);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.flipY = false;
  return t;
}

function waterMaterial() {
  const m = new MeshLambertMaterial({ color: "#a5cbdd" });
  const shore = shoreTexture();
  const uniforms = {
    uShore: { value: shore },
    uShallow: { value: new Color("#cfe6ee") },
    uFoam: { value: new Color("#ffffff") },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms, { uTime: U.uTime, uNight: U.uNight });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvXZ = (modelMatrix * vec4(position, 1.0)).xz;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vXZ;
        uniform sampler2D uShore;
        uniform vec3 uShallow;
        uniform vec3 uFoam;
        uniform float uTime;
        uniform float uNight;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 suv = vXZ / ${(2 * DISC_R).toFixed(1)} + 0.5;
        vec4 sh = texture2D(uShore, suv);
        float shallow = sh.g;
        float pulse = 0.6 + 0.4 * sin(uTime * 1.3 + shallow * 9.0 + vXZ.x * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, shallow * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, clamp(sh.r * pulse, 0.0, 1.0) * 0.8);
        float rip = sin(vXZ.x * 2.3 + uTime * 0.9 + sin(vXZ.y * 1.9 - uTime * 0.7) * 1.6) * sin(vXZ.y * 2.7 - uTime * 0.8);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // the lagoon keeps its own colour whatever the light does
        totalEmissiveRadiance += diffuseColor.rgb * mix(0.3, 0.12, uNight);
        totalEmissiveRadiance += vec3(pow(max(rip, 0.0), 14.0)) * mix(0.16, 0.045, uNight) * (1.0 - shallow * 0.5);`,
      );
  };
  m.customProgramCacheKey = () => "water";
  return { m, uniforms };
}

/** An arched bridge from a to b. */
function bridge(k: Kit, a: Vector2, b: Vector2, lamps: Vector3[]) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const yaw = Math.atan2(dir.x, dir.y);
  const N = 11;
  const rise = 0.34;
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const tm = (t0 + t1) / 2;
    const y0 = TOP_Y - 0.03 + Math.sin(Math.PI * t0) * rise;
    const y1 = TOP_Y - 0.03 + Math.sin(Math.PI * t1) * rise;
    const ym = (y0 + y1) / 2;
    const pitch = -Math.atan2(y1 - y0, len / N);
    const cx = a.x + dir.x * tm;
    const cz = a.y + dir.y * tm;
    k.box(0.36, 0.05, (len / N) * 1.04, cx, ym - 0.025, cz, P.paper, { ry: yaw, rx: pitch, order: "YXZ" });
    for (const side of [-1, 1]) {
      const ox = Math.cos(yaw) * 0.17 * side;
      const oz = -Math.sin(yaw) * 0.17 * side;
      k.box(0.035, 0.035, (len / N) * 1.04, cx + ox, ym + 0.1, cz + oz, P.peach, { ry: yaw, rx: pitch, order: "YXZ" });
      if (i % 2 === 0) k.box(0.025, 0.12, 0.025, cx + ox, ym - 0.01, cz + oz, P.peach);
    }
  }
  for (const t of [0.3, 0.7]) {
    const cx = a.x + dir.x * t;
    const cz = a.y + dir.y * t;
    const top = TOP_Y - 0.06 + Math.sin(Math.PI * t) * rise;
    k.cyl(0.07, 0.09, top - WATER_Y + 0.05, 8, cx, WATER_Y - 0.05, cz, P.stone);
  }
  // lamps at both ends
  for (const t of [-0.02, 1.02]) {
    const side = t < 0.5 ? 1 : -1;
    const ox = Math.cos(yaw) * 0.26 * side;
    const oz = -Math.sin(yaw) * 0.26 * side;
    const x = a.x + dir.x * t + ox;
    const z = a.y + dir.y * t + oz;
    k.cyl(0.014, 0.018, 0.36, 5, x, TOP_Y, z, P.plum);
    k.ball(0.045, x, TOP_Y + 0.4, z, "#ffe2a6", { glow: 1 });
    lamps.push(new Vector3(x, TOP_Y + 0.01, z));
  }
}

/** an empty plot where a building will land */
export interface Plot {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  ry: number;
}

export interface World {
  group: Group;
  pools: InstancedMesh;
  poolMat: MeshBasicMaterial;
  update(t: number, dt: number, night: number, water: Color, reduced: boolean): void;
}

/**
 * Everything that never assembles: the turntable, the lagoon, the islands,
 * bridges, trees and the little ambient life (boat, birds, clouds).
 * Landmark footprints are passed in so trees stay clear of them.
 */
export function buildWorld(
  toy: Material,
  keepOut: Exclusion[],
  poolSpots: { x: number; z: number; r: number; y: number }[],
  plots: Plot[],
): World {
  const group = new Group();

  /* turntable: a clay plinth with a raised lip, on a darker spinning base */
  const plinth = new Kit();
  plinth.cyl(DISC_R + 0.55, DISC_R + 0.3, 1.9, 72, 0, -1.85, 0, P.clay);
  plinth.cyl(DISC_R + 0.62, DISC_R + 0.62, 0.08, 72, 0, -1.93, 0, P.clayDark);
  plinth.cyl(9.4, 9.0, 0.55, 48, 0, -2.5, 0, P.base);
  plinth.cyl(9.55, 9.55, 0.06, 48, 0, -1.99, 0, P.gold);
  const lip = new LatheGeometry(
    [new Vector2(DISC_R - 0.05, 0.05), new Vector2(DISC_R, 0.34), new Vector2(DISC_R + 0.52, 0.34), new Vector2(DISC_R + 0.58, 0.04)],
    96,
  );
  plinth.add(lip, 0, 0, 0, P.cream);
  // year ticks around the lip, 2014 → 2026
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + 0.2;
    plinth.box(0.06, 0.02, 0.22, Math.sin(a) * (DISC_R + 0.27), 0.34, Math.cos(a) * (DISC_R + 0.27), i % 4 === 0 ? P.terracotta : P.clay, { ry: a });
  }
  const plinthMesh = new Mesh(plinth.build(), toy);
  plinthMesh.receiveShadow = true;
  group.add(plinthMesh);

  /* the floor shadow under the table */
  const floor = new Mesh(
    new PlaneGeometry(34, 34),
    new MeshBasicMaterial({ map: radialTexture(128, 0.25), color: "#3a2a44", transparent: true, opacity: 0.32, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.62;
  floor.renderOrder = -1;
  group.add(floor);

  /* water */
  const water = waterMaterial();
  const waterMesh = new Mesh(new CircleGeometry(DISC_R + 0.02, 96), water.m);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = WATER_Y;
  waterMesh.receiveShadow = true;
  group.add(waterMesh);

  /* islands */
  const land = new Kit();
  for (const d of DISTRICTS) {
    const beach = outline(d, 1);
    const top = outline(d, 0.93);
    const sandCol = d.id === "abudhabi" ? "#f2e2bf" : "#f1e2c4";
    land.add(wallGeometry(beach, -0.05, BEACH_Y, 0.08), 0, 0, 0, P.sandDark);
    land.add(capGeometry(beach, BEACH_Y), 0, 0, 0, sandCol);
    land.add(wallGeometry(top, BEACH_Y, TOP_Y, 0.02), 0, 0, 0, d.edge);
    land.add(capGeometry(top, TOP_Y), 0, 0, 0, d.grass);
    if (d.plateau) {
      const hill = { ...d, r: d.plateau, seed: d.seed + 4 };
      land.add(wallGeometry(outline(hill, 1.08), TOP_Y, PLATEAU_Y - 0.02, 0.18), 0, 0, 0, "#e3b996");
      land.add(capGeometry(outline(hill, 1.08), PLATEAU_Y - 0.02), 0, 0, 0, "#e8cfa6");
      land.add(capGeometry(outline(hill, 1.0), PLATEAU_Y), 0, 0, 0, d.grass);
    }
  }

  /* empty plots, waiting for their buildings (the plazas cover them) */
  for (const p of plots) {
    land.box(p.w, 0.014, p.d, p.x, p.y, p.z, "#e3d3b8", { ry: p.ry });
    land.box(p.w - 0.1, 0.016, p.d - 0.1, p.x, p.y, p.z, "#f5ecdc", { ry: p.ry });
  }

  /* bridges, with a lamp at each end */
  const lamps: Vector3[] = [];
  for (const [a, b] of BRIDGES) {
    const A = districtById.get(a)!;
    const B = districtById.get(b)!;
    const dir = new Vector2(B.x - A.x, B.z - A.z).normalize();
    const pa = new Vector2(A.x, A.z).addScaledVector(dir, A.r * 0.9);
    const pb = new Vector2(B.x, B.z).addScaledVector(dir, -B.r * 0.9);
    bridge(land, pa, pb, lamps);
    keepOut.push({ x: pa.x, z: pa.y, r: 0.45 }, { x: pb.x, z: pb.y, r: 0.45 });
  }

  /* trees, scattered with a fixed seed, clear of buildings and each other */
  const rand = rng(42);
  const placed: Exclusion[] = [];
  for (const d of DISTRICTS) {
    let made = 0;
    for (let tries = 0; tries < 400 && made < d.treeCount; tries++) {
      const a = rand() * Math.PI * 2;
      const rr = d.r * 0.8 * Math.sqrt(0.15 + rand() * 0.85);
      const x = d.x + Math.cos(a) * rr;
      const z = d.z + Math.sin(a) * rr;
      if (d.plateau && Math.hypot(x - d.x, z - d.z) < d.plateau * 1.25) continue;
      if (keepOut.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + 0.18)) continue;
      if (placed.some((e) => Math.hypot(x - e.x, z - e.z) < 0.36)) continue;
      const kind = d.trees[Math.floor(rand() * d.trees.length)];
      tree(kind, land, x, TOP_Y, z, 0.8 + rand() * 0.45, rand() * 6);
      placed.push({ x, z, r: 0.2 });
      made++;
    }
  }
  // Bordeaux gets a few rows of vines
  {
    const d = districtById.get("bordeaux")!;
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 6; i++) {
        const x = d.x + 0.25 + i * 0.2;
        const z = d.z - 1.25 + row * 0.24;
        if (keepOut.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + 0.05)) continue;
        land.ball(0.075, x, TOP_Y + 0.06, z, "#7fa66f", { jitter: 1, sy: 0.8 });
      }
  }
  // a few rocks in the water
  for (const [x, z, s] of [
    [-1.2, 2.2, 0.22],
    [1.6, -3.2, 0.18],
    [-8.8, 3.6, 0.2],
    [8.6, -3.9, 0.17],
    [0.2, 9.6, 0.15],
  ])
    land.ball(s, x, WATER_Y + 0.02, z, "#cfc6bd", { sy: 0.6, jitter: 1 });

  const landMesh = new Mesh(land.build(), toy);
  landMesh.castShadow = true;
  landMesh.receiveShadow = true;
  group.add(landMesh);

  /* clouds: one mesh, slowly circling high above */
  const clouds = new Kit();
  const cr = rng(9);
  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.6;
    const R = 7.5 + cr() * 2;
    const cx = Math.cos(a) * R;
    const cz = Math.sin(a) * R;
    const cy = 8.6 + cr() * 1.2;
    for (let i = 0; i < 5; i++)
      clouds.ball(0.45 + cr() * 0.35, cx + (i - 2) * 0.42, cy + cr() * 0.25, cz + (cr() - 0.5) * 0.5, "#ffffff", { sy: 0.7, jitter: 0.4 }, 1);
  }
  const cloudMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: "#ffffff", emissiveIntensity: 0.4 });
  const cloudMesh = new Mesh(clouds.build(), cloudMat);
  group.add(cloudMesh);

  /* a boat circling the lagoon */
  const boatKit = new Kit();
  boatKit.box(0.4, 0.08, 0.15, 0, 0, 0, P.white).box(0.14, 0.08, 0.1, 0.24, 0, 0, P.white, { ry: Math.PI / 4, sz: 1 });
  boatKit.cyl(0.009, 0.009, 0.36, 5, 0.02, 0.08, 0, P.plum);
  boatKit.gable(0.24, 0.3, 0.012, 0.0, 0.1, 0, P.peach, { ry: 0 });
  const boat = new Mesh(boatKit.build(), toy);
  group.add(boat);

  /* birds: little V shapes, flapping by scaling */
  const birdGeo = new BufferGeometry();
  birdGeo.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0.06, -0.13, 0.05, -0.03, 0, 0, -0.03, 0, 0, 0.06, 0, 0, -0.03, 0.13, 0.05, -0.03], 3),
  );
  const birds = new InstancedMesh(birdGeo, new MeshBasicMaterial({ color: "#fffaf2", side: DoubleSide }), 7);
  birds.frustumCulled = false;
  group.add(birds);

  /* warm pools of light on the ground at night */
  const poolMat = new MeshBasicMaterial({
    map: radialTexture(64),
    color: "#ffb766",
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const spots = [...poolSpots, ...lamps.map((l) => ({ x: l.x, z: l.z, r: 0.55, y: l.y }))];
  const pg = new PlaneGeometry(1, 1);
  pg.rotateX(-Math.PI / 2);
  const pools = new InstancedMesh(pg, poolMat, spots.length);
  spots.forEach((s, i) => {
    _m.compose(_p.set(s.x, s.y + 0.012, s.z), _q.identity(), _s.set(s.r * 2, 1, s.r * 2));
    pools.setMatrixAt(i, _m);
    pools.setColorAt(i, new Color(1, 1, 1));
  });
  pools.renderOrder = 2;
  pools.frustumCulled = false;
  group.add(pools);

  const lagoon = { x: -1.1, z: 0.4, r: 1.75 };
  return {
    group,
    pools,
    poolMat,
    update(t, _dt, night, waterCol, reduced) {
      water.m.color.copy(waterCol);
      water.uniforms.uShallow.value.copy(waterCol).lerp(new Color(night > 0.5 ? "#8c88ba" : "#e9f4f2"), 0.55);
      water.uniforms.uFoam.value.set(night > 0.5 ? "#9aa5d6" : "#ffffff");
      poolMat.opacity = night * 0.6;
      cloudMat.emissiveIntensity = 0.4 - night * 0.3;
      const tt = reduced ? 6 : t;
      cloudMesh.rotation.y = tt * 0.012;
      const ba = -tt * 0.16;
      boat.position.set(lagoon.x + Math.cos(ba) * lagoon.r, WATER_Y + 0.04 + Math.sin(tt * 2.1) * 0.012, lagoon.z + Math.sin(ba) * lagoon.r);
      boat.rotation.set(Math.sin(tt * 1.7) * 0.05, -ba + Math.PI, Math.sin(tt * 1.3) * 0.04);
      const day = Math.max(0, 1 - night * 1.6);
      for (let i = 0; i < 7; i++) {
        const a = tt * 0.22 + i * 0.16 + Math.sin(tt * 0.5 + i) * 0.05;
        const R = 6.2 + Math.sin(i * 1.7) * 0.6 + Math.sin(tt * 0.3) * 0.4;
        const y = 4.4 + Math.sin(tt * 0.8 + i * 1.1) * 0.25 + (i % 3) * 0.15;
        const flap = reduced ? 0.6 : Math.sin(tt * 9 + i * 1.3);
        _e.set(0, Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI, 0);
        _m.compose(_p.set(Math.cos(a) * R, y, Math.sin(a) * R), _q.setFromEuler(_e), _s.set(day, day * flap, day));
        birds.setMatrixAt(i, _m);
      }
      birds.instanceMatrix.needsUpdate = true;
    },
  };
}
