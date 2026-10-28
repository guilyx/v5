import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOOR, H, type Maze, ROOMS, W, cellToWorld, idx, worldToCell } from "./layout";
import { astar, nearestFree, smooth } from "./astar";
import { buildFloor } from "./floor";
import { buildWalls } from "./walls";
import { LIGHT, PAL, clay } from "./gfx";
import { buildRobot } from "./robot";
import { Drive } from "./drive";
import { Lidar, PathDots, Tracks } from "./fx";
import { Atlas } from "./paint";
import { type Fx, buildRooms } from "./props";

export interface Insets {
  right: number;
  bottom: number;
  top: number;
}

export interface MazeEvents {
  room(i: number): void;
  pose(x: number, z: number, heading: number): void;
  plan(info: { expanded: number; steps: number; room: number; preview: boolean }): void;
  arrive(room: number): void;
  autopilot(on: boolean, progress: number): void;
  photo(i: number): void;
  project(key: string | null): void;
}

export interface MazeApi {
  goRoom(i: number): void;
  goCell(x: number, y: number): void;
  step(dir: number): void;
  solve(on: boolean): void;
  keys(kx: number, ky: number): void;
  pause(p: boolean): void;
  layout(): void;
  wake(): void;
  slowmo(k: number): void;
  stats(): { cpu: number; upd: number; calls: number; tris: number; dpr: number; frames: number; programs: number; textures: number; geometries: number };
}

export function startMaze(
  canvas: HTMLCanvasElement,
  maze: Maze,
  opts: { reduced: boolean; insets: () => Insets; mobile: boolean; startRoom?: number },
  ev: MazeEvents,
): MazeApi {
  const reduced = opts.reduced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const maxDpr = opts.mobile ? 1.5 : 2;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.table);
  scene.fog = new THREE.Fog(PAL.table, 40, 80);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);

  /* ---------------------------------------------------------------- the board */
  const floor = buildFloor(maze);
  scene.add(floor.mesh);
  scene.add(buildWalls(maze));
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.7, H + 0.02), clay({ color: PAL.frame }));
  slab.position.y = -0.352;
  scene.add(slab);
  // the board's shadow on the table
  const sc = document.createElement("canvas");
  sc.width = 256;
  sc.height = 200;
  const sk = sc.getContext("2d")!;
  sk.shadowColor = "rgba(80,55,30,0.55)";
  sk.shadowBlur = 22;
  sk.fillStyle = "rgba(80,55,30,0.55)";
  sk.fillRect(26, 26, 204, 148);
  const stex = new THREE.CanvasTexture(sc);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.25, H * 1.35).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false }),
  );
  shadow.position.set(0.9, -0.69, 0.9);
  scene.add(shadow);

  /* ---------------------------------------------------------------- the robot */
  const bot = buildRobot(1.22);
  scene.add(bot.root);
  const drive = new Drive();
  // a link to a room (#room-coimbra) starts the robot there
  [drive.x, drive.z] = cellToWorld(...maze.anchors[opts.startRoom ?? 0]);
  drive.heading = -Math.PI / 2;
  const dots = new PathDots();
  scene.add(dots.mesh);
  const tracks = new Tracks();
  scene.add(tracks.mesh);
  const lidar = new Lidar(maze);
  scene.add(lidar.points);

  /* ---------------------------------------------------------------- the rooms */
  const atlas = new Atlas(2048);
  const decals: THREE.BufferGeometry[] = [];
  const robotPos = { x: drive.x, z: drive.z };
  let raf = 0;
  const ctx = {
    maze,
    atlas,
    decals,
    reduced,
    robot: robotPos,
    kick: () => kick(),
    emit: (type: "photo" | "project", v: number | string | null) => {
      if (type === "photo") ev.photo(v as number);
      else ev.project(v as string | null);
    },
  };
  const rooms: Fx[] = buildRooms(ctx);
  for (const f of rooms) scene.add(f.group);
  atlas.flush();
  const paintMesh = new THREE.Mesh(mergeGeometries(decals), clay({ map: atlas.texture(), transparent: true, emissive: 0.1 }));
  paintMesh.renderOrder = 1;
  scene.add(paintMesh);
  const pickables = rooms.flatMap((f) => f.pick ?? []);
  const approached = new Set<number>();
  const roomCenter = ROOMS.map((r) => cellToWorld(r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2));

  /* ---------------------------------------------------------------- camera */
  const PITCH = THREE.MathUtils.degToRad(54);
  const look = new THREE.Vector3(drive.x, 0, drive.z);
  let camDist = 30;
  let width = 1;
  let height = 1;
  function layout() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    const ins = opts.insets();
    const cw = Math.max(200, width - ins.right);
    const ch = Math.max(200, height - ins.top - ins.bottom);
    const ppc = THREE.MathUtils.clamp(Math.min(cw / 16.5, ch / 11), opts.mobile ? 36 : 40, 74);
    const dy = ins.top / 2 - ins.bottom / 2; // content centre relative to screen centre
    const fullW = width + ins.right;
    const fullH = height + 2 * Math.abs(dy);
    const offY = dy < 0 ? -2 * dy : 0;
    camera.aspect = fullW / fullH;
    camera.setViewOffset(fullW, fullH, ins.right, offY, width, height);
    camDist = fullH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * ppc);
    camera.far = camDist * 4;
    camera.updateProjectionMatrix();
    LIGHT.uFogNear.value = camDist * 1.18;
    LIGHT.uFogFar.value = camDist * 2.5;
    (scene.fog as THREE.Fog).near = LIGHT.uFogNear.value;
    (scene.fog as THREE.Fog).far = LIGHT.uFogFar.value;
    lidar.uniforms.uScale.value = (fullH * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    placeCamera();
    kick();
  }
  function placeCamera() {
    camera.position.set(look.x, Math.sin(PITCH) * camDist, look.z + Math.cos(PITCH) * camDist);
    camera.lookAt(look);
  }

  /* ---------------------------------------------------------------- planning */
  let pending: { pts: [number, number][]; at: number } | null = null;
  let tourTarget = -1;
  let current = -1;
  let goalRoom = -1;
  let fadeDotsAt = 0;
  let awakeUntil = 0;
  let spin = 0;
  const keys = { x: 0, y: 0 };
  const auto = { on: false, until: 0, start: 0 };
  const DWELL = 7;
  // one clock for everything; its speed can be changed (slow motion for screenshots in ?perf mode)
  let simT = performance.now() / 1000;
  let lastReal = simT;
  let timeScale = 1;
  const clock = () => {
    const r = performance.now() / 1000;
    simT += (r - lastReal) * timeScale;
    lastReal = r;
    return simT;
  };

  function robotCell(): [number, number] {
    const [cx, cy] = worldToCell(drive.x, drive.z);
    return nearestFree(maze, cx, cy) ?? [cx, cy];
  }

  function planTo(tx: number, ty: number, dry = false) {
    const goal = nearestFree(maze, tx, ty);
    if (!goal) return false;
    const [sx, sy] = robotCell();
    const plan = astar(maze, sx, sy, goal[0], goal[1]);
    if (!plan) return false;
    const now = clock();
    const pts = smooth(maze, plan.cells, [drive.x, drive.z]);
    const searchDur = reduced ? 0 : THREE.MathUtils.clamp(plan.expanded.length * 0.004, 0.16, 0.55);
    floor.showSearch(plan.expanded, now, searchDur);
    goalRoom = maze.roomOf[idx(goal[0], goal[1])];
    const [gwx, gwz] = cellToWorld(goal[0], goal[1]);
    floor.uniforms.uGoal.value.set(gwx, gwz, 1, 0);
    ev.plan({ expanded: plan.expanded.length, steps: plan.cells.length - 1, room: goalRoom, preview: dry });
    fadeDotsAt = 0;
    if (dry) {
      // only a suggestion: draw the search and the route, but stay put
      dots.set(pts, now + searchDur * 0.6);
      floor.uniforms.uGoal.value.z = 0;
      wake();
      return true;
    }
    if (reduced) {
      // no driving animation: the robot is simply there, the plan stays drawn for a moment
      dots.set(pts, now);
      const last = pts[pts.length - 1];
      const prev = pts[Math.max(0, pts.length - 2)];
      drive.active = false;
      drive.x = last[0];
      drive.z = last[1];
      if (pts.length > 1) drive.heading = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
      look.set(drive.x, 0, drive.z);
      fadeDotsAt = now + 1.6;
      arrived(now);
    } else {
      dots.set(pts, now + searchDur * 0.6);
      drive.active = false;
      pending = { pts, at: now + searchDur * (drive.v > 0.5 ? 0.3 : 0.75) };
    }
    wake();
    return true;
  }

  function arrived(now: number) {
    floor.uniforms.uGoal.value.z = 0;
    fadeDotsAt = Math.max(fadeDotsAt, now + 0.15);
    const r = maze.roomOf[idx(...robotCell())];
    ev.arrive(r);
    if (auto.on && r === tourTarget) {
      auto.start = now;
      auto.until = now + DWELL;
    }
  }

  function goRoom(i: number) {
    i = THREE.MathUtils.clamp(i, 0, ROOMS.length - 1);
    tourTarget = i;
    const [ax, ay] = maze.anchors[i];
    planTo(ax, ay);
  }

  function goCell(x: number, y: number) {
    solve(false);
    if (planTo(x, y)) tourTarget = goalRoom;
  }

  function step(dir: number) {
    let base = tourTarget >= 0 ? tourTarget : current;
    if (base < 0) {
      // in a corridor with no target: pick the closest room
      let bd = Infinity;
      roomCenter.forEach(([x, z], i) => {
        const d = (x - drive.x) ** 2 + (z - drive.z) ** 2;
        if (d < bd) {
          bd = d;
          base = i;
        }
      });
    }
    const next = THREE.MathUtils.clamp(base + dir, 0, ROOMS.length - 1);
    if (next === base && current === base) return;
    if (auto.on) auto.until = 0;
    goRoom(next);
  }

  function solve(on: boolean) {
    if (auto.on === on) return;
    auto.on = on;
    auto.until = 0;
    if (on) {
      const from = current >= 0 ? current : tourTarget;
      goRoom(from >= ROOMS.length - 1 ? 0 : from + 1);
    }
    ev.autopilot(on, 0);
    wake();
  }

  /* ---------------------------------------------------------------- input */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function toNdc(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function floorCell(): [number, number] | null {
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return worldToCell(hit.x, hit.z);
  }
  let down: { x: number; y: number; t: number; type: string } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType };
    wake();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const d = down;
    down = null;
    if (Math.hypot(dx, dy) < 9) {
      toNdc(e);
      if (pickables.length) {
        const hits = ray.intersectObjects(pickables.map((p) => p.object), false);
        if (hits.length) {
          const p = pickables.find((pp) => pp.object === hits[0].object);
          if (p && hits[0].faceIndex != null) {
            p.hit(hits[0].faceIndex);
            return;
          }
        }
      }
      const c = floorCell();
      if (c) goCell(c[0], c[1]);
    } else if (d.type !== "mouse" && Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.4 && performance.now() - d.t < 700) {
      step(dy < 0 ? 1 : -1);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    toNdc(e);
    const c = floorCell();
    const u = floor.uniforms.uHover.value as THREE.Vector3;
    if (c && c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H && maze.grid[idx(c[0], c[1])] === FLOOR) {
      const [x, z] = cellToWorld(c[0], c[1]);
      if (u.x !== x || u.y !== z || u.z !== 1) {
        u.set(x, z, 1);
        canvas.style.cursor = "pointer";
        kick();
      }
    } else if (u.z !== 0) {
      u.z = 0;
      canvas.style.cursor = "";
      kick();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    (floor.uniforms.uHover.value as THREE.Vector3).z = 0;
    kick();
  });

  /* ---------------------------------------------------------------- loop */
  let last = clock();
  let paused = false;
  let blinkAt = clock() + 3;
  let cpu = 0;
  let upd = 0;
  let frames = 0;
  let calls = 0;
  let tris = 0;
  let slowFrames = 0;
  let poseAt = 0;
  const lastPose = [drive.x, drive.z];
  let wasAwake = true;

  function wake() {
    awakeUntil = clock() + 16;
    kick();
  }
  function kick() {
    if (!raf && !paused && !document.hidden) {
      last = clock();
      raf = requestAnimationFrame(frame);
    }
  }

  function keyStep() {
    if (!keys.x && !keys.y) return;
    if (drive.active && drive.remaining > 0.45) return;
    const from = drive.active ? worldToCell(...drive.path[drive.path.length - 1]) : robotCell();
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && maze.grid[idx(x, y)] === FLOOR;
    const opts2: [number, number][] = [[keys.x, keys.y], [keys.x, 0], [0, keys.y]];
    for (const [dx, dy] of opts2) {
      if (!dx && !dy) continue;
      const nx = from[0] + dx;
      const ny = from[1] + dy;
      if (!free(nx, ny)) continue;
      if (dx && dy && (!free(from[0] + dx, from[1]) || !free(from[0], from[1] + dy))) continue;
      const pt = cellToWorld(nx, ny);
      if (drive.active) drive.extend(pt);
      else drive.setPath([[drive.x, drive.z], pt]);
      tourTarget = -1;
      return;
    }
  }

  function frame() {
    raf = 0;
    const t0 = performance.now();
    const now = clock();
    const dt = Math.min(0.05, Math.max(0.0001, now - last));
    last = now;
    let busy = false;

    if (pending && now >= pending.at) {
      drive.setPath(pending.pts);
      pending = null;
    }
    keyStep();
    const was = drive.active;
    const done = drive.update(dt);
    if (done) arrived(now);
    if (was || drive.v > 0.01 || pending) {
      busy = true;
      awakeUntil = Math.max(awakeUntil, now + 6);
    }
    robotPos.x = drive.x;
    robotPos.z = drive.z;

    // robot pose, wheels, LiDAR, eyes
    bot.root.position.set(drive.x, 0, drive.z);
    bot.root.rotation.y = -drive.heading;
    const vl = drive.v - drive.w * 0.3;
    const vr = drive.v + drive.w * 0.3;
    bot.wheels[0].rotation.z -= (vl / 0.095) * dt;
    bot.wheels[1].rotation.z -= (vr / 0.095) * dt;
    const awake = now < awakeUntil || auto.on;
    const targetSpin = awake && !reduced ? 13 : 0;
    spin += (targetSpin - spin) * Math.min(1, dt * 4);
    if (spin < 0.05 && !awake) spin = 0;
    bot.puck.rotation.y += spin * dt;
    let eye = awake ? 1 : 0.14;
    if (awake && now > blinkAt) {
      if (now > blinkAt + 0.13) blinkAt = now + 2.5 + Math.random() * 3;
      else eye = 0.1;
    }
    for (const e of bot.eyes.children) e.scale.y += (eye - e.scale.y) * Math.min(1, dt * 16);
    if (Math.abs(bot.eyes.children[0].scale.y - eye) > 0.02) busy = true;
    if (spin > 0) busy = true;

    tracks.update(now, drive.x, drive.z, drive.heading, drive.odo);
    if (!reduced) lidar.update(now, dt, drive.x, drive.z, spin);
    else lidar.uniforms.uTime.value = now;
    if (dots.length) {
      const drawing = dots.update(now, drive.active ? drive.s : 0, reduced);
      if (fadeDotsAt && now > fadeDotsAt) {
        dots.uniforms.uFade.value = Math.max(0, dots.uniforms.uFade.value - dt * 3);
        if (dots.uniforms.uFade.value <= 0) {
          dots.clear();
          fadeDotsAt = 0;
        } else busy = true;
      }
      if (drawing) busy = true;
    }
    floor.uniforms.uTime.value = now;

    // which room are we in?
    const [cx, cy] = worldToCell(drive.x, drive.z);
    const r = cx >= 0 && cy >= 0 && cx < W && cy < H ? maze.roomOf[idx(cx, cy)] : -1;
    if (r >= 0 && r !== current) {
      current = r;
      ev.room(r);
    }
    if ((drive.x !== lastPose[0] || drive.z !== lastPose[1]) && now - poseAt > 1 / 30) {
      poseAt = now;
      lastPose[0] = drive.x;
      lastPose[1] = drive.z;
      ev.pose(drive.x, drive.z, drive.heading);
    }

    // the Solve tour waits in each room, then moves on
    if (auto.on && auto.until && !drive.active && !pending) {
      ev.autopilot(true, Math.min(1, (now - auto.start) / DWELL));
      if (now >= auto.until) {
        auto.until = 0;
        if (tourTarget >= ROOMS.length - 1) solve(false);
        else goRoom(tourTarget + 1);
      }
    }

    // camera: follows the robot with a short damping
    const lead = reduced ? 0 : 0.5 * (drive.v / drive.vmax);
    // stop following a little before the board's edge, so the view stays mostly on the toy
    const tx = THREE.MathUtils.clamp(drive.x + Math.cos(drive.heading) * lead, -W / 2 + 7, W / 2 - 7);
    const tz = THREE.MathUtils.clamp(drive.z + Math.sin(drive.heading) * lead, -H / 2 + 8, H / 2 - 4);
    const k = reduced ? 1 : 1 - Math.exp(-dt / 0.16);
    look.x += (tx - look.x) * k;
    look.z += (tz - look.z) * k;
    if (Math.abs(tx - look.x) + Math.abs(tz - look.z) > 0.002) busy = true;
    placeCamera();

    // rooms near the camera animate; heavy media loads as the robot approaches
    if (wasAwake && !awake) for (const f of rooms) f.sleep?.();
    wasAwake = awake;
    for (const f of rooms) {
      const [rx, rz] = roomCenter[f.room];
      const d2 = (rx - look.x) ** 2 + (rz - look.z) ** 2;
      if (f.approach && !approached.has(f.room) && (rx - drive.x) ** 2 + (rz - drive.z) ** 2 < 17 * 17) {
        approached.add(f.room);
        f.approach();
      }
      if (f.update && d2 < 22 * 22 && awake) {
        if (f.update(now, dt, current === f.room && r === f.room)) busy = true;
      }
    }

    const tu = performance.now() - t0;
    upd = upd ? upd * 0.95 + tu * 0.05 : tu;
    renderer.render(scene, camera);
    const ft = performance.now() - t0;
    cpu = cpu ? cpu * 0.95 + ft * 0.05 : ft;
    frames++;
    calls = renderer.info.render.calls;
    tris = renderer.info.render.triangles;

    // a frame that took far too long on a busy GPU: render fewer pixels
    if (dt > 0.034 && busy) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 40 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      layout();
      slowFrames = 0;
    }

    if (busy || now < awakeUntil || auto.on) kick();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      for (const f of rooms) f.sleep?.();
      wasAwake = false;
    } else wake();
  });
  window.addEventListener("resize", () => layout());

  if (/[?&]perf\b/.test(location.search)) (window as unknown as { __scene: THREE.Scene }).__scene = scene;
  layout();
  ev.pose(drive.x, drive.z, drive.heading);
  wake();
  if (!reduced && (opts.startRoom ?? 0) === 0) {
    // first thing a visitor sees: the planner searching for the way to the first room
    setTimeout(() => {
      if (drive.active || pending || dots.length) return;
      tourTarget = 0;
      const [ax, ay] = maze.anchors[1];
      planTo(ax, ay, true);
    }, 1100);
  }

  return {
    goRoom: (i) => {
      goRoom(i);
    },
    goCell,
    step,
    solve,
    keys(kx, ky) {
      keys.x = kx;
      keys.y = ky;
      if (kx || ky) {
        solve(false);
        pending = null;
        if (dots.length) fadeDotsAt = clock();
        floor.uniforms.uGoal.value.z = 0;
        wake();
      }
    },
    pause(p) {
      paused = p;
      if (p) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    },
    layout,
    wake,
    slowmo: (k: number) => {
      clock();
      timeScale = k;
    },
    stats: () => ({ cpu, upd, calls, tris, dpr, frames, programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }),
  };
}

