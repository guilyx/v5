import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Maze, type RoomDef, W, H, WALL, idx, rng } from "./layout";
import { SANS, roundRect } from "./paint";
import { PAL, blobTexture, clay } from "./gfx";
import { Kit, cellAt, detOf, glow, gx, gz, instanceBoxes, paintStat, paintWord, wallScreen } from "./kit";
import { buildM4 } from "./m4";
import { camel, dune, ghaf, palm, shrub, windsock } from "./outdoor";
import type { Ctx, Det, Fx, Interactable } from "./props";

/**
 * The TII years, four rooms: the C2 system an operator runs a fleet from, decentralised swarm
 * control (the flocking paper), behavior trees orchestrating a team of robots, and planning and
 * tracking around costmaps (M4 outdoors, with Caltech). Every one of them is something to play with.
 */

/* ============================================================== shared pieces */

function droneGeometry(scale: number) {
  const k = new Kit();
  k.box(0.1, 0.05, 0.1, 0, 0, 0, "#ffffff");
  for (const a of [Math.PI / 4, -Math.PI / 4]) k.box(0.34, 0.018, 0.03, 0, 0, 0, "#ffffff", a);
  for (const [x, z] of [
    [0.12, 0.12],
    [0.12, -0.12],
    [-0.12, 0.12],
    [-0.12, -0.12],
  ])
    k.cyl(0.075, 0.075, 0.01, x, 0.025, z, "#cfd3d8", 14);
  const g = mergeGeometries(k.parts);
  g.scale(scale, scale, scale);
  return g;
}

function roverGeometry() {
  const k = new Kit();
  k.box(0.46, 0.14, 0.32, 0, 0.14, 0, "#ffffff");
  k.box(0.3, 0.05, 0.26, -0.04, 0.235, 0, "#ffffff");
  k.box(0.04, 0.06, 0.22, 0.24, 0.16, 0, "#2b2a31");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.07, 0.07, 0.05, sx * 0.15, 0.07, sz * 0.18, "#2b2a31", 12, [Math.PI / 2, 0, 0]);
  k.cyl(0.035, 0.035, 0.05, -0.1, 0.285, 0, "#2b2a31", 10);
  return mergeGeometries(k.parts);
}

const shadowMat = () => new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 });

/** steer a point toward a target: accelerate within limits, a little damping */
function fly(p: THREE.Vector3, v: THREE.Vector3, target: THREE.Vector3, vmax: number, dt: number, accel = 4) {
  const want = target.clone().sub(p);
  const d = want.length();
  const speed = Math.min(vmax, Math.sqrt(2 * accel * 0.8 * d));
  if (d > 1e-4) want.multiplyScalar(speed / d);
  const dv = want.sub(v);
  const lim = accel * dt;
  if (dv.length() > lim) dv.setLength(lim);
  v.add(dv);
  p.addScaledVector(v, dt);
  return d;
}

const clock = (t: number) => {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/* ============================================================== 06 · TII, command & control */

type Mission = "idle" | "survey" | "escort" | "perimeter" | "rtb";

interface Unit {
  name: string;
  kind: "uav" | "ugv";
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  home: THREE.Vector3;
  route: THREE.Vector3[];
  wp: number;
  task: string;
  battery: number;
  heading: number;
}

export function c2(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const X = (rx: number) => gx(r.x + rx);
  const Z = (rz: number) => gz(r.y + rz);
  // the ops table, in the middle: its top is a live map of the room
  const [tcx, tcz] = [X(5.5), Z(4)];
  const tk = new Kit();
  tk.box(2.8, 0.1, 1.8, tcx, 0.78, tcz, "#1d2126");
  tk.box(2.5, 0.72, 1.4, tcx, 0.37, tcz, "#2a2f36");
  tk.box(2.9, 0.04, 1.9, tcx, 0.835, tcz, "#ff8a65");
  const table = tk.mesh();
  g.add(table);
  const mapCv = document.createElement("canvas");
  mapCv.width = 560;
  mapCv.height = 360;
  const mk = mapCv.getContext("2d")!;
  const mapTex = new THREE.CanvasTexture(mapCv);
  mapTex.colorSpace = THREE.SRGBColorSpace;
  const holo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.67), clay({ map: mapTex, emissive: 1 }));
  holo.rotation.x = -Math.PI / 2;
  holo.position.set(tcx, 0.86, tcz);
  g.add(holo);

  // the video wall: units, the mission, and the whole maze as the operator sees it
  const screens = [0, 1, 2].map(() => wallScreen(3.1, 1.85, 840, 500));
  screens.forEach((s, i) => {
    s.stand(X(1.75 + i * 3.75), 0.2, Z(0.85));
    g.add(s.group);
  });
  // pads: drones along the south wall, rovers at the east wall
  const padK = new Kit();
  const units: Unit[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Vector3(X(1.6 + i * 2.2), 0.12, Z(8.3));
    padK.cyl(0.38, 0.38, 0.02, p.x, 0.01, p.z, "#3b434c", 20);
    padK.cyl(0.3, 0.3, 0.024, p.x, 0.012, p.z, "#ff8a65", 20);
    units.push({ name: `UAV-${i + 1}`, kind: "uav", pos: p.clone(), vel: new THREE.Vector3(), home: p, route: [], wp: 0, task: "on pad", battery: 100, heading: -Math.PI / 2 });
  }
  for (let i = 0; i < 2; i++) {
    // clear of the door from the building, which opens at row 4 of the east wall
    const p = new THREE.Vector3(X(10.2), 0, Z(6.6 + i * 1.6));
    padK.box(0.8, 0.02, 0.7, p.x, 0.01, p.z, "#3b434c");
    units.push({ name: `UGV-${i + 1}`, kind: "ugv", pos: p.clone(), vel: new THREE.Vector3(), home: p, route: [], wp: 0, task: "docked", battery: 100, heading: Math.PI });
  }
  g.add(padK.mesh());
  paintWord(ctx, "SECTOR B", r.ink, X(9), Z(2.4), 26, 5);

  // out in the desert: the screens ride on a command trailer, a palm for shade, a windsock for the drones
  const out = new Kit();
  out.box(10.2, 1.45, 0.5, X(5.5), 0.95, Z(0.02), "#e9e4d8");
  out.box(10.2, 0.08, 0.52, X(5.5), 1.7, Z(0.02), "#c9c2b2");
  for (const wx of [1.2, 2.0, 9.0, 9.8]) out.cyl(0.2, 0.2, 0.14, X(wx), 0.2, Z(0.3), "#2b2a31", 14, [Math.PI / 2, 0, 0]);
  out.box(1.4, 0.08, 0.08, X(5.5), 1.95, Z(0.0), "#9aa0ab");
  out.cyl(0.02, 0.02, 0.9, X(10.1), 2.15, Z(0.0), "#9aa0ab", 6);
  palm(out, X(0.5), Z(10.4), 2.35, 0.15, 1);
  shrub(out, X(0.2), Z(9.6), 0.9);
  shrub(out, X(10.6), Z(1.0), 0.8);
  g.add(out.mesh());
  const sock = windsock();
  sock.group.position.set(X(10.5), 0, Z(0.6));
  g.add(sock.group);

  const uavs = units.filter((u) => u.kind === "uav");
  const ugvs = units.filter((u) => u.kind === "ugv");
  const dMesh = new THREE.InstancedMesh(droneGeometry(1.25), clay({ vertexColors: true }), uavs.length);
  const gMesh = new THREE.InstancedMesh(roverGeometry(), clay({ vertexColors: true }), ugvs.length);
  const sh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2), shadowMat(), units.length);
  sh.renderOrder = 1;
  const colors = ["#f7f3ea", "#f7f3ea", "#f7f3ea", "#f7f3ea"];
  colors.forEach((c, i) => dMesh.setColorAt(i, new THREE.Color(c)));
  ugvs.forEach((_, i) => gMesh.setColorAt(i, new THREE.Color(i ? "#ffcf9e" : "#ffd8c8")));
  g.add(dMesh, gMesh, sh);

  let mission: Mission = "idle";
  let missionAt = 0;
  const log: string[] = [];
  let now0 = 0;
  const say = (s: string) => {
    log.push(`${clock(now0)}  ${s}`);
    if (log.length > 7) log.shift();
  };
  say("C2 online · 6 units on the net");

  // routes for each mission, in world space
  const at = (rx: number, rz: number, y = 1.4) => new THREE.Vector3(X(rx), y, Z(rz));
  const assign = (m: Mission) => {
    mission = m;
    missionAt = now0;
    const lanes = [7.4, 8.4, 9.4, 10.4];
    uavs.forEach((u, i) => {
      u.wp = 0;
      if (m === "survey") {
        // a lawnmower strip each over sector B
        u.route = [at(lanes[i], 1.8), at(lanes[i], 8.6), at(lanes[i], 1.8)];
        u.task = `survey lane ${i + 1}`;
      } else if (m === "perimeter") {
        u.route = [[1, 1.5], [10, 1.5], [10, 9.5], [1, 9.5]].map(([x, z]) => at(x, z, 1.6)).slice(i, i + 1);
        u.task = "hold station";
      } else if (m === "rtb" || m === "idle") {
        u.route = [u.home.clone().setY(1.2), u.home.clone()];
        u.task = "return to base";
      } else u.task = "escort M4";
    });
    // rovers can't go through the table: a leg that would is taken round its south side
    const roundTable = (u: Unit) => {
      const out: THREE.Vector3[] = [];
      let from = u.pos.clone();
      for (const p of u.route) {
        const lx = (v: THREE.Vector3) => v.x - X(0);
        const lz = (v: THREE.Vector3) => v.z - Z(0);
        let hit = false;
        for (let t = 0; t <= 1; t += 0.05) {
          const x = lx(from) + (lx(p) - lx(from)) * t;
          const z = lz(from) + (lz(p) - lz(from)) * t;
          if (x > 3.4 && x < 7.6 && z > 2.4 && z < 5.6) hit = true;
        }
        if (hit) out.push(at(lx(from), 6.4, 0), at(lx(p), 6.4, 0));
        out.push(p);
        from = p;
      }
      u.route = out;
    };
    ugvs.forEach((u, i) => {
      u.wp = 0;
      if (m === "survey") {
        // the rovers patrol the west side, clear of the table
        const loop = [[1.2, 2.2], [3, 2.2], [3, 9], [1.2, 9]].map(([x, z]) => at(x, z, 0));
        u.route = i ? loop.slice(2).concat(loop.slice(0, 2)) : loop;
        u.task = "patrol west";
      } else if (m === "perimeter") {
        u.route = [at(5.5, i ? 9.6 : 1.9, 0)];
        u.task = "hold gate";
      } else if (m === "rtb" || m === "idle") {
        u.route = [at(9, u.home.z - gz(r.y), 0), u.home.clone()];
        u.task = "return to dock";
      } else u.task = "escort M4";
      roundTable(u);
    });
    say(`Operator → all units: ${m === "rtb" ? "return to base" : m === "survey" ? "survey sector B" : m === "escort" ? "escort M4" : "form a perimeter"}`);
    ctx.kick();
  };

  const inside = () => ctx.robot.x > X(0) && ctx.robot.x < X(r.w) && ctx.robot.z > Z(0) && ctx.robot.z < Z(r.h);

  /* the operator's views: drawn a few times a second */
  const mazeCv = document.createElement("canvas");
  let mazeDrawn = false;
  let wallTick = 1;
  const drawMaze = (m: Maze) => {
    mazeCv.width = W * 8;
    mazeCv.height = H * 8;
    const k = mazeCv.getContext("2d")!;
    k.fillStyle = "#151a1f";
    k.fillRect(0, 0, mazeCv.width, mazeCv.height);
    k.fillStyle = "#3d4a57";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m.grid[idx(x, y)] === WALL) k.fillRect(x * 8 + 2, y * 8 + 2, 4, 4);
    mazeDrawn = true;
  };
  const draw = (now: number) => {
    // the table: the room, sector B, the units and where they're headed
    const k = mk;
    const sx = 560 / r.w;
    const sz = 360 / r.h;
    k.fillStyle = "#10161c";
    k.fillRect(0, 0, 560, 360);
    k.strokeStyle = "rgba(255,138,101,0.18)";
    k.lineWidth = 1;
    for (let i = 0; i <= r.w; i++) {
      k.beginPath();
      k.moveTo(i * sx, 0);
      k.lineTo(i * sx, 360);
      k.stroke();
    }
    for (let i = 0; i <= r.h; i++) {
      k.beginPath();
      k.moveTo(0, i * sz);
      k.lineTo(560, i * sz);
      k.stroke();
    }
    if (mission === "survey") {
      k.fillStyle = "rgba(255,138,101,0.16)";
      k.fillRect(6.9 * sx, 1.3 * sz, 4 * sx, 7.8 * sz);
    }
    k.fillStyle = "#2a323b";
    k.fillRect(4 * sx, 3 * sz, 3 * sx, 2 * sz);
    const toMap = (p: THREE.Vector3) => [(p.x - X(0)) * sx, (p.z - Z(0)) * sz] as const;
    for (const u of units) {
      const [mx, mz] = toMap(u.pos);
      const tgt = u.route[u.wp];
      if (tgt && mission !== "idle") {
        const [txx, tzz] = toMap(tgt);
        k.strokeStyle = "rgba(127,209,199,0.6)";
        k.setLineDash([5, 5]);
        k.beginPath();
        k.moveTo(mx, mz);
        k.lineTo(txx, tzz);
        k.stroke();
        k.setLineDash([]);
      }
      k.fillStyle = u.battery < 25 ? "#ff6b5a" : u.kind === "uav" ? "#7fd1c7" : "#ffcf9e";
      k.save();
      k.translate(mx, mz);
      k.rotate(u.heading);
      k.beginPath();
      if (u.kind === "uav") {
        k.moveTo(11, 0);
        k.lineTo(-7, 7);
        k.lineTo(-7, -7);
      } else k.rect(-8, -6, 16, 12);
      k.fill();
      k.restore();
      k.fillStyle = "#cfe7e3";
      k.font = `600 13px ${SANS}`;
      k.fillText(u.name, mx + 10, mz - 8);
    }
    if (inside()) {
      const [mx, mz] = toMap(new THREE.Vector3(ctx.robot.x, 0, ctx.robot.z));
      k.fillStyle = PAL.accent;
      k.beginPath();
      k.arc(mx, mz, 8, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = "#ffd3c7";
      k.fillText("M4", mx + 11, mz + 4);
    }
    mapTex.needsUpdate = true;
    // the wall changes slower than the table: every other time
    if ((wallTick = (wallTick + 1) % 2)) return;

    // screen 1: the units
    const [s1, s2, s3] = screens;
    let q = s1.k;
    q.fillStyle = "#11161b";
    q.fillRect(0, 0, s1.cw, s1.ch);
    q.fillStyle = "#ffb49c";
    q.font = `700 30px ${SANS}`;
    q.fillText("UNITS", 34, 56);
    q.font = `600 26px ${SANS}`;
    units.forEach((u, i) => {
      const y = 112 + i * 62;
      q.fillStyle = "#e6eef0";
      q.fillText(u.name, 34, y);
      q.fillStyle = "#93a7b3";
      q.fillText(u.task, 190, y);
      q.fillStyle = "#2a333c";
      roundRect(q, 560, y - 22, 180, 24, 6);
      q.fill();
      q.fillStyle = u.battery < 25 ? "#ff6b5a" : "#7fd1c7";
      roundRect(q, 560, y - 22, 1.8 * u.battery, 24, 6);
      q.fill();
      // link bars: weaker the further it is from the table
      const link = Math.max(1, 4 - Math.floor(u.pos.distanceTo(new THREE.Vector3(tcx, 0.8, tcz)) / 2.4));
      for (let b = 0; b < 4; b++) {
        q.fillStyle = b < link ? "#7fd1c7" : "#2a333c";
        q.fillRect(770 + b * 12, y - 6 - b * 6, 8, 8 + b * 6);
      }
    });
    s1.flush();

    // screen 2: the mission, and the log
    q = s2.k;
    q.fillStyle = "#11161b";
    q.fillRect(0, 0, s2.cw, s2.ch);
    q.fillStyle = "#ffb49c";
    q.font = `700 30px ${SANS}`;
    q.fillText("MISSION", 34, 56);
    q.fillStyle = "#ffffff";
    q.font = `700 46px ${SANS}`;
    const title = { idle: "Standing by", survey: "Survey sector B", escort: "Escort M4", perimeter: "Hold the perimeter", rtb: "Return to base" }[mission];
    q.fillText(title, 34, 120);
    q.font = `500 24px ${SANS}`;
    q.fillStyle = "#93a7b3";
    q.fillText(mission === "idle" ? "Pick a mission on the table" : `T+${clock(now - missionAt)}`, 34, 160);
    q.font = `500 23px ui-monospace, Menlo, monospace`;
    log.forEach((line, i) => {
      q.fillStyle = i === log.length - 1 ? "#e6eef0" : "#7d8f9b";
      q.fillText(line, 34, 222 + i * 38);
    });
    s2.flush();

    // screen 3: the common operating picture, the whole maze, M4 on it
    q = s3.k;
    q.fillStyle = "#11161b";
    q.fillRect(0, 0, s3.cw, s3.ch);
    q.fillStyle = "#ffb49c";
    q.font = `700 30px ${SANS}`;
    q.fillText("COMMON OPERATING PICTURE", 34, 56);
    if (mazeDrawn) {
      const scale = Math.min((s3.cw - 68) / mazeCv.width, (s3.ch - 100) / mazeCv.height);
      const ox = (s3.cw - mazeCv.width * scale) / 2;
      const oy = 80;
      q.drawImage(mazeCv, ox, oy, mazeCv.width * scale, mazeCv.height * scale);
      const px = ox + (ctx.robot.x + W / 2) * 8 * scale;
      const pz = oy + (ctx.robot.z + H / 2) * 8 * scale;
      q.fillStyle = PAL.accent;
      q.beginPath();
      q.arc(px, pz, 9, 0, Math.PI * 2);
      q.fill();
      q.strokeStyle = "rgba(228,87,46,0.5)";
      q.lineWidth = 3;
      q.beginPath();
      q.arc(px, pz, 16 + 6 * Math.sin(now * 4), 0, Math.PI * 2);
      q.stroke();
      q.strokeStyle = "#ffb49c";
      q.strokeRect(ox + r.x * 8 * scale, oy + r.y * 8 * scale, r.w * 8 * scale, r.h * 8 * scale);
    }
    s3.flush();
  };

  const mt = new THREE.Matrix4();
  const qn = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  let drawAt = -1;
  const place = () => {
    uavs.forEach((u, i) => {
      e.set(THREE.MathUtils.clamp(u.vel.z * 0.15, -0.35, 0.35), -u.heading, THREE.MathUtils.clamp(-u.vel.x * 0.15, -0.35, 0.35));
      qn.setFromEuler(e);
      mt.compose(u.pos, qn, one);
      dMesh.setMatrixAt(i, mt);
    });
    ugvs.forEach((u, i) => {
      qn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -u.heading);
      mt.compose(u.pos, qn, one);
      gMesh.setMatrixAt(i, mt);
    });
    units.forEach((u, i) => {
      mt.makeTranslation(u.pos.x + 0.2 * Math.min(1, u.pos.y), 0.006, u.pos.z + 0.18 * Math.min(1, u.pos.y));
      sh.setMatrixAt(i, mt);
    });
    dMesh.instanceMatrix.needsUpdate = gMesh.instanceMatrix.needsUpdate = sh.instanceMatrix.needsUpdate = true;
    dMesh.computeBoundingSphere();
    gMesh.computeBoundingSphere();
  };
  place();

  const tableGlow = glow([table, holo]);
  const ix: Interactable[] = [
    {
      id: "c2",
      room: 0,
      name: "C2 console",
      kind: "active",
      blurb: "One picture of the whole fleet, and one place to task it. Send the drones and rovers on a mission; the table and the wall follow along.",
      targets: [table, holo, ...screens.map((s) => s.face)],
      anchor: () => new THREE.Vector3(tcx, 1.7, tcz),
      highlight: tableGlow,
      actions: () => [
        { id: "survey", label: "Survey sector B", primary: true },
        { id: "escort", label: "Escort M4" },
        { id: "perimeter", label: "Hold the perimeter" },
        { id: "rtb", label: "Return to base" },
      ],
      run: (a) => assign(a as Mission),
    },
  ];
  const dets = [...uavs.map((u) => detOf(`c2-${u.name}`, "drone")), ...ugvs.map((u) => detOf(`c2-${u.name}`, "robot"))];

  return {
    room: 0,
    group: g,
    ix,
    detect(out) {
      instanceBoxes(dMesh, dets.slice(0, uavs.length), 0.04);
      const gd = dets.slice(uavs.length);
      instanceBoxes(gMesh, gd);
      out.push(...dets);
    },
    update(now, dt, _inside, near) {
      now0 = now;
      if (!mazeDrawn) drawMaze(ctx.maze);
      const escort = mission === "escort";
      const here = inside();
      for (const u of units) {
        const air = u.kind === "uav";
        let target = u.route[u.wp] ?? u.home;
        if (escort) {
          const i = units.indexOf(u);
          const a = (i / units.length) * Math.PI * 2 + now * 0.5;
          const cx = here ? ctx.robot.x : tcx;
          const cz = here ? ctx.robot.z : tcz + 2.5;
          target = new THREE.Vector3(cx + Math.cos(a) * (air ? 1.3 : 1.0), air ? 1.3 + (ctx.robot.flying ? ctx.robot.alt : 0) : 0, cz + Math.sin(a) * (air ? 1.3 : 1.0));
          // keep it in the room
          target.x = THREE.MathUtils.clamp(target.x, X(0.6), X(r.w - 0.6));
          target.z = THREE.MathUtils.clamp(target.z, Z(1.4), Z(r.h - 0.6));
        }
        const d = air ? fly(u.pos, u.vel, target, 2.2, dt) : fly(u.pos, u.vel, target, 1.1, dt, 3);
        if (!air) u.pos.y = 0;
        if (u.vel.lengthSq() > 0.02) u.heading = Math.atan2(u.vel.z, u.vel.x);
        if (!escort && d < 0.15 && u.route.length) {
          if (u.wp < u.route.length - 1) u.wp++;
          else if (mission === "survey") {
            u.wp = 0;
            if (u === units[0]) say(`${u.name} lane done, sweeping again`);
          }
        }
        const flying = air ? u.pos.y > 0.2 : u.vel.lengthSq() > 0.01;
        u.battery = THREE.MathUtils.clamp(u.battery + (flying ? -0.35 : 2.5) * dt, 0, 100);
        // low battery: this one goes home on its own, and says so
        if (u.battery < 22 && mission !== "rtb" && u.route[u.route.length - 1] !== u.home) {
          u.route = [u.home.clone().setY(air ? 1.2 : 0), u.home.clone()];
          u.wp = 0;
          u.task = "low battery: RTB";
          say(`${u.name} battery 22% → returning to base`);
        }
        if (mission === "rtb" && d < 0.15 && u.wp === u.route.length - 1 && u.task !== (air ? "on pad" : "docked")) {
          u.task = air ? "on pad" : "docked";
          say(`${u.name} ${air ? "landed" : "docked"}`);
        }
      }
      place();
      // the afternoon shamal swings the windsock
      sock.sock.rotation.y = 0.5 + 0.25 * Math.sin(now * 0.7) + 0.08 * Math.sin(now * 3.1);
      sock.sock.rotation.z = -0.15 - 0.1 * Math.sin(now * 1.3);
      // the screens redraw while you can see them
      if (near && now - drawAt > 0.33) {
        drawAt = now;
        draw(now);
      }
      return true;
    },
  };
}

/* ============================================================== 07 · TII, decentralised swarm control */

export function swarmControl(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const X = (rx: number) => gx(r.x + rx);
  const Z = (rz: number) => gz(r.y + rz);
  const N = 24;
  const K_NN = 7;
  const pillars: [number, number][] = [cellAt(r, 2, 6), cellAt(r, 6, 4)];
  // out over the dunes: two date palms for the flock to flow round, dunes in the corners
  const pk = new Kit();
  pillars.forEach(([x, z], i) => palm(pk, x, z, 2.5, 0.12, i * 2 + 0.5));
  dune(pk, X(8.6), Z(0.7), 1.3, 1.0, 0.42, 0.4, "#ebc98c");
  dune(pk, X(0.9), Z(10.2), 1.6, 1.1, 0.4, -0.3, "#ebc98c");
  shrub(pk, X(8.4), Z(2.4), 0.9);
  shrub(pk, X(1.9), Z(9.6), 0.8);
  g.add(pk.mesh());
  // what the new swarm autonomy architecture saved, painted on the floor
  paintStat(ctx, "−74%", "ONBOARD CPU", r.ink, ...cellAt(r, 1.6, 0.9));
  paintStat(ctx, "−52%", "NETWORK BANDWIDTH", r.ink, ...cellAt(r, 6.4, 0.9));
  const drones = new THREE.InstancedMesh(droneGeometry(1.1), clay({ vertexColors: true }), N);
  g.add(drones);
  const sh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2), shadowMat(), N);
  sh.renderOrder = 1;
  g.add(sh);

  // one drone's view: lines to its seven neighbours, and arrows for what it's doing about them
  const nbGeo = new THREE.BufferGeometry();
  nbGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(K_NN * 6), 3));
  const nbLines = new THREE.LineSegments(nbGeo, new THREE.LineBasicMaterial({ color: "#3a6bf0", transparent: true, opacity: 0.8, depthTest: false }));
  nbLines.frustumCulled = false;
  nbLines.visible = false;
  nbLines.renderOrder = 6;
  const arrows = [
    new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0xe4572e, 0.12, 0.08),
    new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0x3a6bf0, 0.12, 0.08),
    new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0x2f8f5b, 0.12, 0.08),
  ];
  for (const a of arrows) {
    a.visible = false;
    (a.line.material as THREE.Material).depthTest = false;
    (a.cone.material as THREE.Material).depthTest = false;
    a.renderOrder = 7;
    g.add(a);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 32), new THREE.MeshBasicMaterial({ color: "#3a6bf0", depthTest: false }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 7;
  g.add(nbLines, ring);

  const pos = Array.from({ length: N }, () => new THREE.Vector3());
  const vel = Array.from({ length: N }, () => new THREE.Vector3());
  const acc = Array.from({ length: N }, () => new THREE.Vector3());
  const parts = Array.from({ length: N }, () => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const rand = rng(77);
  for (let i = 0; i < N; i++) {
    pos[i].set(X(r.w / 2 - 1.5 + rand() * 3), 1.2 + rand() * 0.6, Z(r.h / 2 - 1.5 + rand() * 3));
    vel[i].set(1 + rand() * 0.4, 0, rand() - 0.5).setLength(0.9);
  }
  const rules = { sep: true, ali: true, coh: true, predator: false, leader: false, show: false };
  const nb: number[][] = Array.from({ length: N }, () => []);
  const goal = new THREE.Vector3();
  let polar = 1;
  let flocks = 1;
  let nnd = 0;
  const tmp = new THREE.Vector3();

  const step = (now: number, dt: number) => {
    // the migration goal: a slow loop round the room, or M4 if it leads
    const inside = ctx.robot.x > X(0) && ctx.robot.x < X(r.w) && ctx.robot.z > Z(0) && ctx.robot.z < Z(r.h);
    if (rules.leader && inside) goal.set(ctx.robot.x, (ctx.robot.flying ? ctx.robot.alt : 0.6) + 0.9, ctx.robot.z);
    else goal.set(X(r.w / 2) + Math.cos(now * 0.35) * 2.4, 1.5, Z(r.h / 2) + Math.sin(now * 0.35) * 3.4);
    for (let i = 0; i < N; i++) {
      // each drone only knows its seven nearest neighbours: topological, like starlings
      const order = [...Array(N).keys()].filter((j) => j !== i).sort((a, b) => pos[a].distanceToSquared(pos[i]) - pos[b].distanceToSquared(pos[i]));
      nb[i] = order.slice(0, K_NN);
      const [sep, ali, coh] = parts[i];
      sep.set(0, 0, 0);
      ali.set(0, 0, 0);
      coh.set(0, 0, 0);
      for (const j of nb[i]) {
        tmp.subVectors(pos[i], pos[j]);
        const d = tmp.length();
        if (d < 0.55 && d > 1e-4) sep.addScaledVector(tmp, (0.55 - d) / (d * 0.55));
        ali.add(vel[j]);
        coh.add(pos[j]);
      }
      ali.multiplyScalar(1 / K_NN).sub(vel[i]);
      coh.multiplyScalar(1 / K_NN).sub(pos[i]);
      sep.multiplyScalar(rules.sep ? 5 : 0);
      ali.multiplyScalar(rules.ali ? 2.2 : 0);
      coh.multiplyScalar(rules.coh ? 1.6 : 0);
      const a = acc[i].copy(sep).add(ali).add(coh);
      // migration, altitude, walls, pillars, and the predator
      a.addScaledVector(tmp.subVectors(goal, pos[i]).setLength(Math.min(1, pos[i].distanceTo(goal))), 0.6);
      a.y += (1.5 - pos[i].y) * 1.5;
      const m = 0.9;
      if (pos[i].x < X(m)) a.x += 4 * (X(m) - pos[i].x);
      if (pos[i].x > X(r.w - m)) a.x -= 4 * (pos[i].x - X(r.w - m));
      if (pos[i].z < Z(m + 0.6)) a.z += 4 * (Z(m + 0.6) - pos[i].z);
      if (pos[i].z > Z(r.h - m)) a.z -= 4 * (pos[i].z - Z(r.h - m));
      for (const [px, pz] of pillars) {
        tmp.set(pos[i].x - px, 0, pos[i].z - pz);
        const d = tmp.length();
        if (d < 1.0 && d > 1e-3) a.addScaledVector(tmp, (1.0 - d) * 9 / d);
      }
      if (rules.predator) {
        tmp.set(pos[i].x - ctx.robot.x, 0, pos[i].z - ctx.robot.z);
        const d = tmp.length();
        if (d < 2.2 && d > 1e-3) a.addScaledVector(tmp, ((2.2 - d) * 7) / d);
      }
    }
    for (let i = 0; i < N; i++) {
      vel[i].addScaledVector(acc[i], dt);
      // birds don't hover: a minimum and a maximum speed
      const s = vel[i].length();
      if (s > 1.7) vel[i].multiplyScalar(1.7 / s);
      if (s < 0.55 && s > 1e-4) vel[i].multiplyScalar(0.55 / s);
      pos[i].addScaledVector(vel[i], dt);
    }
  };

  const mt = new THREE.Matrix4();
  const qn = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const place = () => {
    const sum = new THREE.Vector3();
    let sp = 0;
    for (let i = 0; i < N; i++) {
      const yaw = Math.atan2(vel[i].z, vel[i].x);
      e.set(THREE.MathUtils.clamp(acc[i].z * 0.04, -0.4, 0.4), -yaw, THREE.MathUtils.clamp(-acc[i].x * 0.04, -0.4, 0.4));
      qn.setFromEuler(e);
      mt.compose(pos[i], qn, one);
      drones.setMatrixAt(i, mt);
      // coloured by heading: one colour when they agree
      col.setHSL(((yaw / (Math.PI * 2)) % 1 + 1) % 1, 0.55, 0.62);
      drones.setColorAt(i, col);
      mt.makeTranslation(pos[i].x + 0.3, 0.006, pos[i].z + 0.26);
      sh.setMatrixAt(i, mt);
      sum.add(vel[i]);
      sp += vel[i].length();
    }
    polar = sp > 0 ? sum.length() / sp : 0;
    // flocks: drones within a metre of each other, chained
    const parent = [...Array(N).keys()];
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    let nsum = 0;
    for (let i = 0; i < N; i++) {
      let best = Infinity;
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const d = pos[i].distanceTo(pos[j]);
        best = Math.min(best, d);
        if (j > i && d < 1.0) parent[find(i)] = find(j);
      }
      nsum += best;
    }
    nnd = nsum / N;
    flocks = new Set([...Array(N).keys()].map(find)).size;
    drones.instanceMatrix.needsUpdate = true;
    if (drones.instanceColor) drones.instanceColor.needsUpdate = true;
    sh.instanceMatrix.needsUpdate = true;
    drones.computeBoundingSphere();
    // the shown drone's neighbourhood
    nbLines.visible = ring.visible = rules.show;
    for (const a of arrows) a.visible = rules.show;
    if (rules.show) {
      const p = nbGeo.attributes.position as THREE.BufferAttribute;
      nb[0].forEach((j, k) => {
        p.setXYZ(k * 2, pos[0].x, pos[0].y, pos[0].z);
        p.setXYZ(k * 2 + 1, pos[j].x, pos[j].y, pos[j].z);
      });
      p.needsUpdate = true;
      ring.position.copy(pos[0]);
      parts[0].forEach((v, k) => {
        const L = Math.min(1.2, v.length() * 0.35);
        arrows[k].position.copy(pos[0]);
        if (L > 0.02) arrows[k].setDirection(tmp.copy(v).normalize());
        arrows[k].setLength(Math.max(0.05, L), 0.1, 0.07);
      });
    }
  };
  place();

  const ix: Interactable[] = [
    {
      id: "flocking",
      room: 0,
      name: "Bird-inspired flocking",
      kind: "passive",
      blurb: "No leader, no plan: each drone steers by acceleration from its seven nearest neighbours. Turn the rules off one by one, or chase them with M4.",
      targets: [drones],
      anchor: () => {
        const c = new THREE.Vector3();
        for (const p of pos) c.add(p);
        return c.multiplyScalar(1 / N).add(new THREE.Vector3(0, 0.6, 0));
      },
      highlight: glow([drones]),
      actions: () => [
        { id: "predator", label: rules.predator ? "M4 stops chasing" : "M4 is a predator", primary: true },
        { id: "leader", label: rules.leader ? "No leader" : "Follow M4" },
        { id: "sep", label: `Separation: ${rules.sep ? "on" : "off"}` },
        { id: "ali", label: `Alignment: ${rules.ali ? "on" : "off"}` },
        { id: "coh", label: `Cohesion: ${rules.coh ? "on" : "off"}` },
        { id: "show", label: rules.show ? "Hide one drone's view" : "Show one drone's view" },
      ],
      run: (a) => {
        if (a in rules) {
          const key = a as keyof typeof rules;
          rules[key] = !rules[key];
          if (key === "predator" && rules.predator) rules.leader = false;
          if (key === "leader" && rules.leader) rules.predator = false;
        }
        ctx.kick();
      },
    },
  ];
  const dets = Array.from({ length: N }, (_, i) => detOf(`flock-${i}`, "drone"));
  return {
    room: 0,
    group: g,
    ix,
    detect(out) {
      instanceBoxes(drones, dets, 0.04);
      out.push(...dets);
    },
    hud() {
      const c = new THREE.Vector3();
      for (const p of pos) c.add(p);
      c.multiplyScalar(1 / N).y = 2.6;
      const on = (b: boolean, s: string) => `${s}${b ? "✓" : "✗"}`;
      return {
        at: c,
        title: "Decentralised flocking",
        lines: [
          `polarization ${polar.toFixed(2)} · ${flocks} ${flocks === 1 ? "flock" : "flocks"} · nearest ${nnd.toFixed(2)} m`,
          `rules ${on(rules.sep, "S")} ${on(rules.ali, "A")} ${on(rules.coh, "C")} · 7 neighbours each${rules.predator ? " · fleeing M4" : rules.leader ? " · following M4" : ""}`,
        ],
        color: polar > 0.8 && flocks === 1 ? "#2f8f5b" : "#e8850f",
      };
    },
    update(now, dt) {
      if (ctx.reduced) return false;
      let left = Math.min(dt, 0.1);
      while (left > 1e-4) {
        const h = Math.min(left, 1 / 50);
        step(now, h);
        left -= h;
      }
      place();
      return true;
    },
  };
}

/* ============================================================== 08 · TII, behavior-tree orchestration */

type Status = "S" | "F" | "R";
interface BtNode {
  name: string;
  kind: "seq" | "sel" | "cond" | "act";
  kids?: BtNode[];
  fn?: (b: Bot) => Status;
  /** what it returned on the last tick, if it was ticked */
  last?: Status;
}
interface Bot {
  name: string;
  color: string;
  cell: [number, number];
  pos: THREE.Vector3;
  heading: number;
  path: [number, number][];
  goal: string;
  battery: number;
  task: number;
  doing: number;
  patrol: [number, number][];
  pi: number;
  replans: number;
  lamp: string;
}

function tick(n: BtNode, b: Bot, seen: Set<BtNode>): Status {
  seen.add(n);
  let s: Status;
  if (n.kind === "seq") {
    s = "S";
    for (const k of n.kids!) {
      const r = tick(k, b, seen);
      if (r !== "S") {
        s = r;
        break;
      }
    }
  } else if (n.kind === "sel") {
    s = "F";
    for (const k of n.kids!) {
      const r = tick(k, b, seen);
      if (r !== "F") {
        s = r;
        break;
      }
    }
  } else s = n.fn!(b);
  n.last = s;
  return s;
}

export function orchestration(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const C = (cx: number, cz: number) => cellAt(r, cx, cz);
  // the room's own grid, for paths: blocked cells are the wall screen, docks and stations
  const blocked = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (let x = 0; x < r.w; x++) blocked.add(key(x, 0));
  const docks: [number, number][] = [
    [0, 3],
    [0, 5],
    [0, 7],
  ];
  const stations: [number, number][] = [
    [9, 2],
    [6, 7],
    [9, 9],
  ];
  const stationState = stations.map(() => ({ open: false, by: -1, at: 0 }));
  const barrier = new Set<string>();
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < r.w && y < r.h && !blocked.has(key(x, y)) && !barrier.has(key(x, y));
  const astar = (from: [number, number], to: [number, number]): [number, number][] | null => {
    const open: [number, number, number][] = [[from[0], from[1], 0]];
    const came = new Map<string, string>();
    const gs = new Map<string, number>([[key(...from), 0]]);
    const h = (x: number, y: number) => Math.abs(x - to[0]) + Math.abs(y - to[1]);
    while (open.length) {
      open.sort((a, b) => a[2] - b[2]);
      const [x, y] = open.shift()!;
      if (x === to[0] && y === to[1]) {
        const out: [number, number][] = [[x, y]];
        let k = key(x, y);
        while (came.has(k)) {
          k = came.get(k)!;
          out.push(k.split(",").map(Number) as [number, number]);
        }
        return out.reverse();
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        // the goal may itself be a dock or a station: you stand next to it, but it's reachable
        if (!(free(nx, ny) || (nx === to[0] && ny === to[1]))) continue;
        const ng = gs.get(key(x, y))! + 1;
        if (ng < (gs.get(key(nx, ny)) ?? Infinity)) {
          gs.set(key(nx, ny), ng);
          came.set(key(nx, ny), key(x, y));
          open.push([nx, ny, ng + h(nx, ny)]);
        }
      }
    }
    return null;
  };

  // props: docks on the west wall, stations (inspection points) in the room
  const pk = new Kit();
  for (const [x, y] of docks) {
    const [wx, wz] = C(x, y);
    pk.box(0.18, 0.5, 0.7, wx - 0.38, 0.25, wz, "#5a5f68");
    pk.box(0.04, 0.12, 0.3, wx - 0.28, 0.32, wz, "#3a6bf0");
    blocked.add(key(x, y));
  }
  g.add(pk.mesh());
  // the stations are solar panels out in the sun (the robots inspect them), each with its status lamp
  const lamps = stations.map(([x, y]) => {
    const [wx, wz] = C(x, y);
    const k = new Kit();
    for (const sx of [-0.32, 0.32]) k.box(0.05, 0.45, 0.05, wx + sx, 0.22, wz + 0.1, "#8a8f98");
    const panel = new THREE.BoxGeometry(0.92, 0.04, 0.7);
    panel.rotateX(0.5);
    panel.translate(wx, 0.5, wz);
    k.add(panel, "#22355a");
    for (let i = -1; i <= 1; i++) {
      const line = new THREE.BoxGeometry(0.012, 0.045, 0.7);
      line.rotateX(0.5);
      line.translate(wx + i * 0.23, 0.505, wz);
      k.add(line, "#8fa6c9");
    }
    k.cyl(0.02, 0.02, 0.5, wx + 0.42, 0.55, wz - 0.25, "#8a8f98", 6);
    g.add(k.mesh());
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), clay({ color: "#2f8f5b", emissive: 0.9 }));
    lamp.position.set(wx + 0.42, 0.84, wz - 0.25);
    g.add(lamp);
    blocked.add(key(x, y));
    return lamp;
  });
  // more of the farm along the south edge, and a palm by the docks
  const farm = new Kit();
  palm(farm, C(0, 9)[0] - 0.1, C(0, 9)[1] + 0.3, 2.2, 0.1, 3);
  g.add(farm.mesh());
  blocked.add(key(0, 9));
  const barrierMesh = new THREE.Group();
  g.add(barrierMesh);

  // the three robots
  const bodies: THREE.Mesh[] = [];
  const crews: { name: string; color: string; patrol: [number, number][] }[] = [
    { name: "R1", color: "#3a9d8f", patrol: [[2, 2], [5, 2], [5, 5], [2, 5]] },
    { name: "R2", color: "#e2a93c", patrol: [[3, 8], [3, 10], [8, 10], [8, 6]] },
    { name: "R3", color: "#9a5fb4", patrol: [[7, 3], [10, 4], [10, 7], [7, 5]] },
  ];
  const bots: Bot[] = crews.map((d) => {
    const m = new THREE.Mesh(roverGeometry(), clay({ color: d.color }));
    bodies.push(m);
    g.add(m);
    const [wx, wz] = C(...d.patrol[0]);
    return { ...d, cell: d.patrol[0], pos: new THREE.Vector3(wx, 0, wz), heading: 0, path: [], goal: "", battery: 70 + Math.random() * 30, task: -1, doing: 0, pi: 0, replans: 0, lamp: "#2f8f5b" };
  });
  const lampsOnBots = bots.map((_, i) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), clay({ color: "#2f8f5b", emissive: 1 }));
    bodies[i].add(l);
    l.position.set(-0.1, 0.33, 0);
    return l;
  });

  // movement: along A* paths, cell to cell; wait if a teammate is in the way
  const occupied = (c: [number, number], me: Bot) => bots.some((o) => o !== me && ((o.cell[0] === c[0] && o.cell[1] === c[1]) || (o.path[0] && o.path[0][0] === c[0] && o.path[0][1] === c[1])));
  /** go to a cell; "R" while moving, "S" there, "F" when there's no way */
  const goTo = (b: Bot, to: [number, number], label: string): Status => {
    if (b.cell[0] === to[0] && b.cell[1] === to[1] && !b.path.length) return "S";
    if (b.goal !== label || (b.path.length && !free(...b.path[0]) && !(b.path[0][0] === to[0] && b.path[0][1] === to[1]))) {
      const p = astar(b.cell, to);
      if (!p) return "F";
      if (b.goal === label) b.replans++;
      b.path = p.slice(1);
      b.goal = label;
    }
    return "R";
  };
  const near = (a: [number, number]): [number, number] => {
    // a free cell beside a dock or a station
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ])
      if (free(a[0] + dx, a[1] + dy)) return [a[0] + dx, a[1] + dy];
    return a;
  };

  // the trees: one per robot, and the orchestrator's
  const cond = (name: string, f: (b: Bot) => boolean): BtNode => ({ name, kind: "cond", fn: (b) => (f(b) ? "S" : "F") });
  const act = (name: string, fn: (b: Bot) => Status): BtNode => ({ name, kind: "act", fn });
  const robotTree = (): BtNode => ({
    name: "?",
    kind: "sel",
    kids: [
      {
        name: "→ Recharge",
        kind: "seq",
        kids: [
          cond("battery < 25%", (b) => b.battery < 25 || b.goal === "charge-on"),
          act("go to dock", (b) => goTo(b, near(docks[bots.indexOf(b)]), "dock")),
          act("charge", (b) => {
            b.goal = "charge-on";
            b.battery = Math.min(100, b.battery + 6);
            if (b.battery >= 95) {
              b.goal = "";
              return "S";
            }
            return "R";
          }),
        ],
      },
      {
        name: "→ Inspect",
        kind: "seq",
        kids: [
          cond("task assigned?", (b) => b.task >= 0),
          {
            name: "? reach station",
            kind: "sel",
            kids: [
              act("go to station", (b) => goTo(b, near(stations[b.task]), `st${b.task}`)),
              act("hand over", (b) => {
                // no way there: give the task back, the orchestrator picks someone else
                stationState[b.task].by = -1;
                b.task = -1;
                return "F";
              }),
            ],
          },
          act("inspect", (b) => {
            b.doing += 0.2;
            return b.doing >= 2.4 ? "S" : "R";
          }),
          act("report", (b) => {
            stationState[b.task].open = false;
            stationState[b.task].by = -1;
            b.task = -1;
            b.doing = 0;
            return "S";
          }),
        ],
      },
      act("patrol", (b) => {
        const st = goTo(b, b.patrol[b.pi], `p${b.pi}`);
        if (st === "S") b.pi = (b.pi + 1) % b.patrol.length;
        return "R";
      }),
    ],
  });
  const trees = bots.map(() => robotTree());
  const orchestrator: BtNode = {
    name: "→ Dispatch",
    kind: "seq",
    kids: [
      cond("anomaly open?", () => stationState.some((s) => s.open && s.by < 0)),
      act("nearest free robot", () => {
        const si = stationState.findIndex((s) => s.open && s.by < 0);
        const [sx, sy] = stations[si];
        const cand = bots.filter((b) => b.task < 0 && b.battery >= 25).sort((a, b) => Math.hypot(a.cell[0] - sx, a.cell[1] - sy) - Math.hypot(b.cell[0] - sx, b.cell[1] - sy));
        if (!cand.length) return "F";
        cand[0].task = si;
        cand[0].doing = 0;
        stationState[si].by = bots.indexOf(cand[0]);
        say(`${cand[0].name} ← inspect station ${si + 1}`);
        return "S";
      }),
    ],
  };
  const log: string[] = [];
  const say = (s: string) => {
    log.push(s);
    if (log.length > 4) log.shift();
  };

  // the wall: the trees, coloured by what each node returned on the last tick
  const scr = wallScreen(10.2, 2.9, 2048, 584, 0.22);
  scr.stand(gx(r.x + r.w / 2), 0.15, gz(r.y) + 0.75);
  g.add(scr.group);
  const statusCol = (n: BtNode, seen: Set<BtNode>) => (!seen.has(n) ? "#3b3f46" : n.last === "S" ? "#2f8f5b" : n.last === "R" ? "#d98a1b" : "#c2412b");
  const drawTree = (seens: Set<BtNode>[], oseen: Set<BtNode>) => {
    const k = scr.k;
    k.fillStyle = "#15181d";
    k.fillRect(0, 0, scr.cw, scr.ch);
    k.font = `700 26px ${SANS}`;
    k.fillStyle = "#ffcfae";
    k.fillText("BEHAVIOR TREES · ticked at 5 Hz", 28, 44);
    k.font = `600 20px ${SANS}`;
    const legend: [string, string][] = [
      ["#2f8f5b", "success"],
      ["#d98a1b", "running"],
      ["#c2412b", "failure"],
      ["#3b3f46", "not ticked"],
    ];
    legend.forEach(([c, t], i) => {
      k.fillStyle = c;
      k.fillRect(1500 + i * 135, 28, 18, 18);
      k.fillStyle = "#c9ced6";
      k.fillText(t, 1524 + i * 135, 44);
    });
    const box = (x: number, y: number, w: number, label: string, fill: string, kind: BtNode["kind"]) => {
      k.fillStyle = fill;
      roundRect(k, x, y, w, 34, kind === "cond" ? 17 : 6);
      k.fill();
      k.fillStyle = "#fff";
      k.font = `${kind === "seq" || kind === "sel" ? 700 : 500} 18px ${SANS}`;
      k.fillText(label, x + 10, y + 23);
    };
    const edge = (x1: number, y1: number, x2: number, y2: number) => {
      k.strokeStyle = "#565c66";
      k.lineWidth = 2;
      k.beginPath();
      k.moveTo(x1, y1);
      k.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
      k.stroke();
    };
    // the orchestrator, on the left
    const ox = 28;
    box(ox, 90, 230, orchestrator.name, statusCol(orchestrator, oseen), "seq");
    orchestrator.kids!.forEach((n, i) => {
      edge(ox + 115, 124, ox + 115, 170 + i * 52);
      box(ox, 170 + i * 52, 230, n.name, statusCol(n, oseen), n.kind);
    });
    k.font = `500 18px ui-monospace, Menlo, monospace`;
    log.forEach((line, i) => {
      k.fillStyle = i === log.length - 1 ? "#e6eef0" : "#7d8f9b";
      k.fillText(line, ox, 330 + i * 30);
    });
    // a tree per robot: the root, its three branches side by side, each branch's children stacked under it
    trees.forEach((t, bi) => {
      const seen = seens[bi];
      const x0 = 330 + bi * 572;
      const b = bots[bi];
      k.fillStyle = b.color;
      k.beginPath();
      k.arc(x0 + 10, 70, 10, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = "#e6eef0";
      k.font = `700 23px ${SANS}`;
      k.fillText(`${b.name} · battery ${Math.round(b.battery)}%${b.replans ? ` · ${b.replans} replans` : ""}`, x0 + 28, 78);
      box(x0 + 246, 96, 64, t.name, statusCol(t, seen), "sel");
      t.kids!.forEach((br, i) => {
        const bx = x0 + i * 188;
        edge(x0 + 278, 130, bx + 90, 166);
        box(bx, 166, 180, br.name, statusCol(br, seen), br.kind);
        let y = 216;
        for (const leaf of br.kids ?? []) {
          edge(bx + 12, y - 16, bx + 12, y + 17);
          box(bx, y, 180, leaf.name, statusCol(leaf, seen), leaf.kind);
          y += 42;
          for (const ll of leaf.kids ?? []) {
            box(bx + 22, y, 158, ll.name, statusCol(ll, seen), ll.kind);
            y += 42;
          }
        }
      });
    });
    scr.flush();
  };

  let tickAt = -1;
  let onScreen = true;
  const step = (now: number, dt: number) => {
    if (now - tickAt >= 0.2) {
      tickAt = now;
      const oseen = new Set<BtNode>();
      tick(orchestrator, bots[0], oseen);
      const seens = bots.map((b, i) => {
        const s = new Set<BtNode>();
        tick(trees[i], b, s);
        return s;
      });
      // battery drains as they drive; lamps show the branch that's running
      bots.forEach((b, i) => {
        const t = trees[i];
        const active = t.kids!.find((k) => seens[i].has(k) && k.last !== "F");
        b.lamp = active === t.kids![0] ? "#3a6bf0" : active === t.kids![1] ? "#d98a1b" : "#2f8f5b";
        (lampsOnBots[i].material as THREE.ShaderMaterial).uniforms.uColor.value.set(b.lamp);
      });
      stationState.forEach((s, i) => (lamps[i].material as THREE.ShaderMaterial).uniforms.uColor.value.set(s.open ? (s.by >= 0 ? "#d98a1b" : "#e4572e") : "#2f8f5b"));
      if (onScreen) drawTree(seens, oseen);
    }
    for (const b of bots) {
      if (b.goal !== "charge-on") b.battery = Math.max(0, b.battery - dt * 0.6);
      const next = b.path[0];
      if (!next) continue;
      if (occupied(next, b)) continue;
      const [wx, wz] = C(...next);
      const d = Math.hypot(wx - b.pos.x, wz - b.pos.z);
      const want = Math.atan2(wz - b.pos.z, wx - b.pos.x);
      let dh = want - b.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      b.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * 6);
      if (Math.abs(dh) < 0.6) {
        const s = Math.min(d, dt * 1.1);
        b.pos.x += (Math.cos(want) * s);
        b.pos.z += (Math.sin(want) * s);
      }
      if (d < 0.04) {
        b.cell = next;
        b.path.shift();
      }
    }
    bots.forEach((b, i) => {
      bodies[i].position.copy(b.pos);
      bodies[i].rotation.y = -b.heading;
    });
  };

  const raise = () => {
    const closed = stationState.map((s, i) => (!s.open ? i : -1)).filter((i) => i >= 0);
    if (!closed.length) return;
    const i = closed[Math.floor(Math.random() * closed.length)];
    stationState[i].open = true;
    stationState[i].by = -1;
    say(`station ${i + 1}: anomaly raised`);
  };
  const block = () => {
    // a barrier across the middle of the room: whoever was going through it replans
    if (barrier.size) {
      barrier.clear();
      barrierMesh.clear();
      say("barrier removed");
      return;
    }
    for (let y = 2; y <= 7; y++) if (free(7, y) && !bots.some((b) => b.cell[0] === 7 && b.cell[1] === y)) barrier.add(key(7, y));
    for (const k of barrier) {
      const [x, y] = k.split(",").map(Number);
      const [wx, wz] = C(x, y);
      const kit = new Kit();
      kit.cyl(0.04, 0.22, 0.55, wx, 0.28, wz, "#f08a3c", 12);
      kit.box(0.06, 0.06, 0.9, wx, 0.5, wz, "#fffaf1");
      barrierMesh.add(kit.mesh());
    }
    say("barrier across the middle: replanning");
  };

  const ix: Interactable[] = [
    {
      id: "bt",
      room: 0,
      name: "Behavior trees",
      kind: "active",
      blurb: "Three robots, a tree each, ticked five times a second, and an orchestrator that hands out work. Raise an anomaly, drain a battery, or block the way, and watch the trees switch branches.",
      targets: [scr.face, ...bodies],
      anchor: () => new THREE.Vector3(gx(r.x + r.w / 2), 1.6, gz(r.y + 4)),
      highlight: glow([scr.face, ...bodies]),
      actions: () => [
        { id: "anomaly", label: "Raise an anomaly", primary: true },
        { id: "battery", label: "Drain a battery" },
        { id: "block", label: barrier.size ? "Remove the barrier" : "Block the middle" },
      ],
      run: (a) => {
        if (a === "anomaly") raise();
        else if (a === "battery") {
          const b = bots.filter((x) => x.goal !== "charge-on").sort((x, y) => y.battery - x.battery)[0];
          if (b) {
            b.battery = 14;
            say(`${b.name} battery 14%`);
            if (b.task >= 0) {
              stationState[b.task].by = -1;
              say(`${b.name} hands station ${b.task + 1} back`);
              b.task = -1;
            }
          }
        } else if (a === "block") block();
        ctx.kick();
      },
    },
  ];
  const dets = bots.map((b) => detOf(`bt-${b.name}`, "robot"));
  return {
    room: 0,
    group: g,
    ix,
    detect(out) {
      dets.forEach((d, i) => d.box.setFromObject(bodies[i]));
      out.push(...dets);
    },
    update(now, dt, _inside, isNear) {
      onScreen = isNear;
      step(now, ctx.reduced ? 0.2 : dt);
      return !ctx.reduced;
    },
  };
}

/* ============================================================== 09 · TII × Caltech, plan and track */

type Ctrl = "pursuit" | "stanley" | "mpc";

export function planTrack(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const X = (rx: number) => gx(r.x + rx);
  const Z = (rz: number) => gz(r.y + rz);
  // the field: a fine costmap over the room, 0.25 per cell
  const RES = 0.25;
  const fx0 = X(0.2);
  const fz0 = Z(1.2);
  const FW = Math.floor((r.w - 0.4) / RES);
  const FH = Math.floor((r.h - 1.4) / RES);
  const rocks: { x: number; z: number; r: number; mine: boolean; mesh: THREE.Mesh }[] = [];
  const rockMat = clay({ color: "#a2927a", bevel: true });
  const addRock = (x: number, z: number, rad: number, mine = false) => {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rad, 0), rockMat);
    m.position.set(x, rad * 0.55, z);
    m.rotation.set(rad * 3, rad * 7, rad * 5);
    m.scale.y = 0.7;
    g.add(m);
    rocks.push({ x, z, r: rad, mine, mesh: m });
  };
  const rand = rng(31);
  for (let i = 0; i < 9; i++) addRock(X(3 + rand() * 7), Z(2.2 + rand() * 7.6), 0.25 + rand() * 0.25);
  // gravel plain: shrubs for the look, two ghaf trees it has to go round
  const sk = new Kit();
  for (let i = 0; i < 14; i++) shrub(sk, X(0.6 + rand() * (r.w - 1.2)), Z(1.6 + rand() * (r.h - 2.2)), 0.55 + rand() * 0.3, i % 2 ? "#8ea05a" : "#a9b56b");
  const trees: { x: number; z: number; r: number }[] = [
    { x: X(3.2), z: Z(2.4), r: 0.35 },
    { x: X(9.6), z: Z(9.6), r: 0.35 },
  ];
  trees.forEach((t, i) => ghaf(sk, t.x, t.z, 1.05, i * 2));
  g.add(sk.mesh());
  // and a camel, who crosses when you ask, and has right of way
  const cam = camel();
  cam.group.scale.setScalar(0.6);
  g.add(cam.group);
  const walker = { x: X(r.w - 0.9), z: Z(r.h - 0.5), r: 0.5, heading: Math.PI, from: 0, to: 0, t: -1, lane: 0 };
  const start: [number, number] = [X(1.2), Z(r.h / 2 + 0.5)];
  const goalPt: [number, number] = [X(r.w - 1.2), Z(r.h / 2 + 0.5)];
  for (const [px, pz] of [start, goalPt]) {
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: r.ink }));
    pad.position.set(px, 0.008, pz);
    g.add(pad);
  }

  const cost = new Float32Array(FW * FH);
  const ROBOT_R = 0.38;
  const costTex = new THREE.DataTexture(new Uint8Array(FW * FH * 4), FW, FH, THREE.RGBAFormat);
  costTex.magFilter = THREE.NearestFilter;
  const costPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(FW * RES, FH * RES).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: costTex, transparent: true, depthWrite: false }),
  );
  costPlane.position.set(fx0 + (FW * RES) / 2, 0.007, fz0 + (FH * RES) / 2);
  costPlane.renderOrder = 1;
  g.add(costPlane);
  // you are an obstacle too: park M4 in its way and it plans round you
  const you = { x: 0, z: 0, r: 0.45, on: false };
  const rebuild = () => {
    const data = costTex.image.data as Uint8Array;
    const obstacles = [...rocks, ...trees, walker, ...(you.on ? [you] : [])];
    for (let j = 0; j < FH; j++)
      for (let i = 0; i < FW; i++) {
        const x = fx0 + (i + 0.5) * RES;
        const z = fz0 + (j + 0.5) * RES;
        let c = 0;
        for (const k of obstacles) {
          const d = Math.hypot(x - k.x, z - k.z) - k.r;
          if (d < ROBOT_R) c = 1;
          else c = Math.max(c, Math.exp(-3.2 * (d - ROBOT_R)) * 0.85);
        }
        cost[j * FW + i] = c;
        // the texture's rows run the other way up
        const o = ((FH - 1 - j) * FW + i) * 4;
        if (c >= 1) data.set([122, 64, 227, 150], o);
        else if (c > 0.05) data.set([232, Math.round(67 + 150 * (1 - c)), 47, Math.round(150 * c)], o);
        else data.set([0, 0, 0, 0], o);
      }
    costTex.needsUpdate = true;
  };
  rebuild();

  // A* over the costmap, then pull the string through cells with no lethal cost
  const cellOf = (x: number, z: number): [number, number] => [Math.floor((x - fx0) / RES), Math.floor((z - fz0) / RES)];
  const lethal = (i: number, j: number) => i < 0 || j < 0 || i >= FW || j >= FH || cost[j * FW + i] >= 1;
  const plan = (a: [number, number], b: [number, number]) => {
    const [si, sj] = cellOf(...a);
    const [ti, tj] = cellOf(...b);
    const gs = new Float32Array(FW * FH).fill(Infinity);
    const came = new Int32Array(FW * FH).fill(-1);
    const open: [number, number][] = [[sj * FW + si, 0]];
    gs[sj * FW + si] = 0;
    const done = new Uint8Array(FW * FH);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][1] < open[bi][1]) bi = k;
      const [c] = open.splice(bi, 1)[0];
      if (done[c]) continue;
      done[c] = 1;
      const ci = c % FW;
      const cj = Math.floor(c / FW);
      if (ci === ti && cj === tj) break;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (lethal(ni, nj)) continue;
          const n = nj * FW + ni;
          const step = Math.hypot(di, dj) * (1 + 6 * cost[n]);
          if (gs[c] + step < gs[n]) {
            gs[n] = gs[c] + step;
            came[n] = c;
            open.push([n, gs[n] + Math.hypot(ti - ni, tj - nj)]);
          }
        }
    }
    let c = tj * FW + ti;
    if (came[c] < 0) return null;
    const cells: [number, number][] = [];
    while (c >= 0) {
      cells.push([fx0 + ((c % FW) + 0.5) * RES, fz0 + (Math.floor(c / FW) + 0.5) * RES]);
      c = came[c];
    }
    cells.reverse();
    cells[0] = a;
    cells[cells.length - 1] = b;
    // densify into a smooth path: a little averaging, then points every 10 cm
    const sm = cells.map((p, i) => {
      if (i === 0 || i === cells.length - 1) return p;
      const q = cells[Math.max(0, i - 2)];
      const w = cells[Math.min(cells.length - 1, i + 2)];
      return [(q[0] + p[0] * 2 + w[0]) / 4, (q[1] + p[1] * 2 + w[1]) / 4] as [number, number];
    });
    const out: [number, number][] = [sm[0]];
    for (let i = 1; i < sm.length; i++) {
      const [ax, az] = sm[i - 1];
      const [bx, bz] = sm[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1));
      for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    return out;
  };

  // the field unit: a smaller M4
  const unit = buildM4({ scale: 0.85 });
  g.add(unit.root);
  const st = { x: start[0], z: start[1], h: 0, v: 0, w: 0, roll: 0 };
  let path: [number, number][] = plan(start, goalPt) ?? [start, goalPt];
  let toGoal = true;
  let ctrl: Ctrl = "pursuit";
  let wind = false;
  let gust = 0;
  let replans = 0;
  const errs: { t: number; e: number }[] = [];
  let nearest = 0;

  const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: "#2a55cc", dashSize: 0.12, gapSize: 0.08 }));
  pathLine.position.y = 0.03;
  g.add(pathLine);
  const setPathLine = () => {
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry().setFromPoints(path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    pathLine.computeLineDistances();
  };
  setPathLine();
  const TR = 400;
  const trailPos = new Float32Array(TR * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: PAL.accent }));
  trail.frustumCulled = false;
  g.add(trail);
  let trailN = 0;

  /** nearest path point, and the signed cross-track error (left of the path is positive) */
  const track = (x: number, z: number) => {
    let bi = nearest;
    let bd = Infinity;
    for (let i = Math.max(0, nearest - 5); i < Math.min(path.length, nearest + 40); i++) {
      const d = (path[i][0] - x) ** 2 + (path[i][1] - z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const a = path[Math.max(0, bi - 1)];
    const b = path[Math.min(path.length - 1, bi + 1)];
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const e = -Math.sin(th) * (x - path[bi][0]) + Math.cos(th) * (z - path[bi][1]);
    return { i: bi, e, th };
  };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  const controlStep = (dt: number) => {
    const t = track(st.x, st.z);
    nearest = t.i;
    let v = 1.0;
    let w = 0;
    const remaining = (path.length - 1 - t.i) * 0.1;
    v = Math.min(1.0, 0.25 + remaining * 0.8);
    if (ctrl === "pursuit") {
      const look = path[Math.min(path.length - 1, t.i + 7)];
      const alpha = wrap(Math.atan2(look[1] - st.z, look[0] - st.x) - st.h);
      w = (2 * v * Math.sin(alpha)) / 0.7;
    } else if (ctrl === "stanley") {
      w = 2.2 * (wrap(t.th - st.h) + Math.atan2(-2.5 * t.e, v + 0.2));
    } else {
      // sampling MPC: try steering commands over a short horizon, keep the cheapest
      let best = Infinity;
      for (let k = -8; k <= 8; k++) {
        const wc = (k / 8) * 2.4;
        let x = st.x;
        let z = st.z;
        let h = st.h;
        let c = 0;
        let ni = t.i;
        for (let s = 0; s < 10; s++) {
          h += wc * 0.1;
          x += Math.cos(h) * v * 0.1;
          z += Math.sin(h) * v * 0.1;
          let bd = Infinity;
          for (let i = ni; i < Math.min(path.length, ni + 20); i++) {
            const d = (path[i][0] - x) ** 2 + (path[i][1] - z) ** 2;
            if (d < bd) {
              bd = d;
              ni = i;
            }
          }
          const [ci, cj] = cellOf(x, z);
          c += bd * 10 + (lethal(ci, cj) ? 50 : cost[cj * FW + ci] * 0.25);
        }
        c += Math.abs(wc - st.w) * 0.15;
        if (c < best) {
          best = c;
          w = wc;
        }
      }
    }
    w = THREE.MathUtils.clamp(w, -2.4, 2.4);
    st.w += (w - st.w) * Math.min(1, dt * 8);
    st.v += (v - st.v) * Math.min(1, dt * 3);
    st.h += st.w * dt;
    st.x += Math.cos(st.h) * st.v * dt;
    st.z += Math.sin(st.h) * st.v * dt;
    if (wind) {
      // gusts push it sideways: what the controller has to fight
      gust += (Math.sin(performance.now() * 0.0013) * 0.5 + (Math.random() - 0.5) * 0.6 - gust) * dt * 2;
      st.x += -Math.sin(st.h) * gust * dt;
      st.z += Math.cos(st.h) * gust * dt;
    }
    st.roll += st.v * dt;
    errs.push({ t: performance.now() / 1000, e: t.e });
    while (errs.length && errs[0].t < performance.now() / 1000 - 16) errs.shift();
    // at the end of the path: turn round and plan back
    if (t.i >= path.length - 2 && Math.hypot(path[path.length - 1][0] - st.x, path[path.length - 1][1] - st.z) < 0.15) {
      toGoal = !toGoal;
      const p = plan([st.x, st.z], toGoal ? goalPt : start);
      if (p) path = p;
      nearest = 0;
      setPathLine();
    }
  };

  // the wall: cross-track error over the last 16 s
  const scr = wallScreen(6.4, 2.1, 1400, 460, 0.22);
  scr.stand(X(r.w / 2), 0.15, Z(0.75));
  g.add(scr.group);
  const NAMES: Record<Ctrl, string> = { pursuit: "Pure pursuit", stanley: "Stanley", mpc: "Sampling MPC" };
  const rms = () => Math.sqrt(errs.reduce((s, x) => s + x.e * x.e, 0) / Math.max(1, errs.length));
  const drawPlot = () => {
    const k = scr.k;
    k.fillStyle = "#16181b";
    k.fillRect(0, 0, scr.cw, scr.ch);
    k.fillStyle = "#ffd59a";
    k.font = `700 30px ${SANS}`;
    k.fillText(`CROSS-TRACK ERROR · ${NAMES[ctrl].toUpperCase()}${wind ? " · WIND" : ""}`, 32, 50);
    k.fillStyle = "#c9ced6";
    k.font = `600 26px ${SANS}`;
    k.fillText(`RMS ${(rms() * 100).toFixed(1)} cm · ${replans} replans`, 1000, 50);
    const x0 = 32;
    const y0 = 250;
    const pw = scr.cw - 64;
    k.strokeStyle = "#3b3f46";
    k.lineWidth = 2;
    for (const e of [-0.2, -0.1, 0, 0.1, 0.2]) {
      const y = y0 - e * 800;
      k.beginPath();
      k.moveTo(x0, y);
      k.lineTo(x0 + pw, y);
      k.stroke();
      k.fillStyle = "#7d8f9b";
      k.font = `500 18px ${SANS}`;
      k.fillText(`${e > 0 ? "+" : ""}${(e * 100).toFixed(0)} cm`, x0 + 4, y - 6);
    }
    const tNow = performance.now() / 1000;
    k.strokeStyle = PAL.accent;
    k.lineWidth = 3;
    k.beginPath();
    errs.forEach((p, i) => {
      const x = x0 + pw - ((tNow - p.t) / 16) * pw;
      const y = y0 - THREE.MathUtils.clamp(p.e, -0.25, 0.25) * 800;
      if (i) k.lineTo(x, y);
      else k.moveTo(x, y);
    });
    k.stroke();
    scr.flush();
  };

  const placeUnit = (dt: number) => {
    unit.root.position.set(st.x, 0, st.z);
    unit.root.rotation.y = -st.h;
    unit.setSpin(st.roll * 9 + st.w * dt, st.roll * 9 - st.w * dt, 0, 0);
    if (trailN < TR) trailN++;
    else trailPos.copyWithin(0, 3);
    trailPos.set([st.x, 0.025, st.z], (trailN - 1) * 3);
    trailGeo.setDrawRange(0, trailN);
    trailGeo.attributes.position.needsUpdate = true;
  };
  placeUnit(0);

  const dropRock = () => {
    // in the way: a little ahead on the path
    const p = path[Math.min(path.length - 1, nearest + 14)];
    if (!p || Math.hypot(p[0] - st.x, p[1] - st.z) < 0.9) return;
    addRock(p[0] + (Math.random() - 0.5) * 0.15, p[1] + (Math.random() - 0.5) * 0.15, 0.32, true);
    rebuild();
    const np = plan([st.x, st.z], toGoal ? goalPt : start);
    if (np) {
      path = np;
      nearest = 0;
      replans++;
      setPathLine();
    }
  };
  const clearMine = () => {
    for (let i = rocks.length - 1; i >= 0; i--)
      if (rocks[i].mine) {
        g.remove(rocks[i].mesh);
        rocks.splice(i, 1);
      }
    rebuild();
    const np = plan([st.x, st.z], toGoal ? goalPt : start);
    if (np) {
      path = np;
      nearest = 0;
      setPathLine();
    }
  };

  /** the camel walks across the field, through the path ahead; the planner goes round it as it goes */
  const camelCross = () => {
    if (walker.t >= 0) return;
    const p = path[Math.min(path.length - 1, nearest + 18)] ?? [X(r.w / 2), Z(r.h / 2)];
    walker.lane = THREE.MathUtils.clamp(p[0], X(2.5), X(r.w - 2.5));
    walker.x = walker.lane;
    walker.from = Z(1.3);
    walker.to = Z(r.h - 0.4);
    walker.z = walker.from;
    walker.heading = Math.PI / 2;
    walker.t = 0;
  };
  let camelAt = 0;

  const ix: Interactable[] = [
    {
      id: "field",
      room: 0,
      name: "M4, outdoors",
      kind: "active",
      blurb: "A costmap of the rocks, A* through it, and a controller tracking the path. Drop a rock in its way, stand in its way, switch controllers, add wind; the wall plots the cross-track error.",
      targets: [unit.root, ...rocks.map((k) => k.mesh), scr.face],
      anchor: () => new THREE.Vector3(st.x, 1.4, st.z),
      highlight: glow([unit.root]),
      actions: () => [
        { id: "rock", label: "Drop a rock in its way", primary: true },
        { id: "ctrl", label: `Controller: ${NAMES[ctrl]} → ${NAMES[ctrl === "pursuit" ? "stanley" : ctrl === "stanley" ? "mpc" : "pursuit"]}` },
        { id: "wind", label: wind ? "Calm" : "Wind gusts" },
        { id: "camel", label: "Camel crossing" },
        ...(rocks.some((k) => k.mine) ? [{ id: "clear", label: "Clear your rocks" }] : []),
      ],
      run: (a) => {
        if (a === "camel") camelCross();
        else if (a === "rock") dropRock();
        else if (a === "ctrl") {
          ctrl = ctrl === "pursuit" ? "stanley" : ctrl === "stanley" ? "mpc" : "pursuit";
          errs.length = 0;
        } else if (a === "wind") wind = !wind;
        else if (a === "clear") clearMine();
        ctx.kick();
      },
    },
  ];
  const det: Det = detOf("field-m4", "robot");
  const camelDet: Det = detOf("camel", "camel");
  let plotAt = -1;
  return {
    room: 0,
    group: g,
    ix,
    detect(out) {
      det.box.setFromObject(unit.root);
      camelDet.box.setFromObject(cam.group);
      out.push(det, camelDet);
    },
    hud() {
      return {
        at: new THREE.Vector3(st.x, 1.9, st.z),
        title: `Tracking · ${NAMES[ctrl]}`,
        lines: [`cross-track RMS ${(rms() * 100).toFixed(1)} cm · ${replans} replans${wind ? " · wind" : ""}`],
        color: rms() < 0.05 ? "#2f8f5b" : "#e8850f",
      };
    },
    update(now, dt, inside, near) {
      if (ctx.reduced) return false;
      // M4 in the field: if it has moved, and stands near what's left of the path, replan round it
      const moved = Math.hypot(ctx.robot.x - you.x, ctx.robot.z - you.z) > 0.3;
      if (inside !== you.on || (inside && moved)) {
        you.on = inside && !ctx.robot.flying;
        you.x = ctx.robot.x;
        you.z = ctx.robot.z;
        rebuild();
        const blocking = you.on && path.slice(nearest).some(([x, z]) => Math.hypot(x - you.x, z - you.z) < you.r + ROBOT_R + 0.1);
        if (blocking || !you.on) {
          const np = plan([st.x, st.z], toGoal ? goalPt : start);
          if (np) {
            path = np;
            nearest = 0;
            if (blocking) replans++;
            setPathLine();
          }
        }
      }
      // the camel: walk, and every half second tell the costmap where it is
      if (walker.t >= 0) {
        walker.t += dt;
        walker.z = Math.min(walker.to, walker.from + walker.t * 0.45);
        cam.stride(walker.t * 5, 1);
        if (now - camelAt > 0.5 || walker.z >= walker.to) {
          camelAt = now;
          rebuild();
          const blocking = path.slice(nearest).some(([x, z]) => Math.hypot(x - walker.x, z - walker.z) < walker.r + ROBOT_R + 0.15);
          if (blocking) {
            const np = plan([st.x, st.z], toGoal ? goalPt : start);
            if (np) {
              path = np;
              nearest = 0;
              replans++;
              setPathLine();
            }
          }
        }
        if (walker.z >= walker.to) walker.t = -1;
      } else cam.stride(0, 0);
      cam.group.position.set(walker.x, 0, walker.z);
      cam.group.rotation.y = -walker.heading;
      let left = Math.min(dt, 0.1);
      while (left > 1e-4) {
        const h = Math.min(left, 1 / 30);
        controlStep(h);
        left -= h;
      }
      placeUnit(dt);
      if (near && now - plotAt > 0.25) {
        plotAt = now;
        drawPlot();
      }
      return true;
    },
  };
}
