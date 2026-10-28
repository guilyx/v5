import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOOR, H, type Maze, ROOMS, W, cellToWorld, idx, worldToCell } from "./layout";
import { nearestFree, pointClear, smooth } from "./astar";
import { buildFloor } from "./floor";
import { buildWalls } from "./walls";
import { LIGHT, PAL, blobMaterial, clay } from "./gfx";
import { TRACK, WHEEL_R, buildM4 } from "./m4";
import { ALT, Motion, type Pose, Rehearsal, type Step } from "./motion";
import { FLY, type Mode, type ModalPlan, type PlanKind, ROLL, canFly, planModal, weights } from "./modal";
import { buildCostmaps } from "./costmap";
import { Lidar, type PathPiece, PathDots, Tracks } from "./fx";
import { Atlas } from "./paint";
import { type Fx, buildRooms } from "./props";

export interface Insets {
  right: number;
  bottom: number;
  top: number;
}

export type MotionState = "roll" | "fly" | "takeoff" | "landing";

export interface PlanRow {
  kind: PlanKind;
  time: number;
  energy: number;
  morphs: number;
  states: number;
  flown: number;
}

export interface MazeEvents {
  room(i: number): void;
  pose(x: number, z: number, heading: number, flying: boolean): void;
  plan(info: { expanded: number; steps: number; room: number; preview: boolean; kind: PlanKind; morphs: number }): void;
  /** all three planners on the same query; null where one has no solution */
  plans(info: { rows: Record<PlanKind, PlanRow | null>; chosen: PlanKind; preview: boolean }): void;
  mode(state: MotionState): void;
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
  /** morph: take off, or land */
  fly(): void;
  setKind(k: PlanKind): void;
  /** 0 = save energy, 1 = save time */
  setPref(p: number): void;
  costmap(on: boolean): void;
  stats(): { cpu: number; upd: number; calls: number; tris: number; dpr: number; frames: number; programs: number; textures: number; geometries: number; pose: { x: number; z: number; alt: number; fold: number; mode: number; steps: number } };
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
  const costmaps = buildCostmaps(maze);
  const floor = buildFloor(maze, costmaps);
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

  /* ---------------------------------------------------------------- the robot: a toy M4 */
  const SCALE = 1.3;
  const bot = buildM4({ scale: SCALE });
  scene.add(bot.root);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), blobMaterial(0.9));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 1;
  scene.add(blob);
  // its ghost rehearses each plan before the robot sets off
  const ghost = buildM4({ scale: SCALE, ghost: PAL.search });
  ghost.root.visible = false;
  scene.add(ghost.root);
  let rehearsal: { r: Rehearsal; at: number } | null = null;

  const motion = new Motion({ x: W / 2 - 1.3, z: H / 2 - 1.3 });
  const drive = motion.drive;
  // a link to a room (#room-coimbra) starts the robot there
  [motion.x, motion.z] = cellToWorld(...maze.anchors[opts.startRoom ?? 0]);
  motion.heading = -Math.PI / 2;
  [drive.x, drive.z, drive.heading] = [motion.x, motion.z, motion.heading];

  const dots = new PathDots();
  scene.add(dots.mesh, dots.rings);
  const preview = new PathDots(900, { alpha: 0.42, size: 0.05 });
  scene.add(preview.mesh, preview.rings);
  const tracks = new Tracks();
  scene.add(tracks.mesh);
  const lidar = new Lidar(maze);
  scene.add(lidar.points);

  /* ---------------------------------------------------------------- the rooms */
  const atlas = new Atlas(2048);
  const decals: THREE.BufferGeometry[] = [];
  const robotPos = { x: motion.x, z: motion.z };
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
  const look = new THREE.Vector3(motion.x, 0, motion.z);
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
    camera.position.set(look.x, look.y + Math.sin(PITCH) * camDist, look.z + Math.cos(PITCH) * camDist);
    camera.lookAt(look);
  }

  /* ---------------------------------------------------------------- planning */
  let pending: { steps: Step[]; at: number } | null = null;
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

  /** the robot's cell and mode, as the planner sees them */
  function robotState(): { cell: [number, number]; mode: Mode } {
    const mode: Mode = motion.mode;
    const [cx, cy] = worldToCell(motion.x, motion.z);
    if (mode === FLY && canFly(maze, cx, cy)) return { cell: [cx, cy], mode };
    return { cell: nearestFree(maze, cx, cy) ?? [cx, cy], mode: ROLL };
  }
  function robotCell(): [number, number] {
    return robotState().cell;
  }

  let kind: PlanKind = "hybrid";
  let wts = weights(0.55);
  const KINDS: PlanKind[] = ["hybrid", "roll", "fly"];
  /** run all three planners to the same goal; returns the one to drive, falling back to hybrid */
  function solveAll(gx: number, gy: number) {
    const st = robotState();
    const out = {} as Record<PlanKind, ModalPlan | null>;
    for (const k of KINDS) out[k] = planModal(maze, costmaps.rollCell, st.cell[0], st.cell[1], st.mode, gx, gy, k, wts);
    const rows = {} as Record<PlanKind, PlanRow | null>;
    for (const k of KINDS) {
      const p = out[k];
      rows[k] = p ? { kind: k, time: p.time, energy: p.energy, morphs: p.morphs, states: p.expanded.length, flown: p.flown } : null;
    }
    const chosen = out[kind] ? kind : "hybrid";
    return { plan: out[chosen], chosen, rows, start: st };
  }

  /** turn a plan into motion steps (smoothed legs, morphs between) and path pieces to draw */
  function realize(plan: ModalPlan, startMode: Mode) {
    const steps: Step[] = [];
    const pieces: PathPiece[] = [];
    let first = true;
    let prev: Mode = startMode;
    for (const seg of plan.segs) {
      if (seg.mode !== prev) steps.push({ kind: "morph", to: seg.mode });
      const from: [number, number] | undefined = first ? [motion.x, motion.z] : undefined;
      let pts: [number, number][];
      if (seg.mode === ROLL) pts = smooth(maze, seg.cells, from, 0.44);
      else {
        // flying, the whole board is open: one straight line from take-off to landing
        const a = from ?? cellToWorld(seg.cells[0] % W, Math.floor(seg.cells[0] / W));
        const last = seg.cells[seg.cells.length - 1];
        pts = [a, cellToWorld(last % W, Math.floor(last / W))];
      }
      if (pts.length > 1 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) + (pts.length - 2) > 1e-3) {
        steps.push({ kind: seg.mode === ROLL ? "roll" : "fly", pts });
        pieces.push({ mode: seg.mode, pts, climb: !(first && motion.mode === FLY && !motion.morph) });
      }
      prev = seg.mode;
      first = false;
    }
    return { steps, pieces };
  }

  function emitRows(rows: Record<PlanKind, PlanRow | null>, chosen: PlanKind, isPreview: boolean) {
    ev.plans({ rows, chosen, preview: isPreview });
  }

  /* hover: plan to the cell under the cursor and draw it faintly, without moving */
  let hoverCell: [number, number] | null = null;
  let lastGoal: [number, number] | null = null;
  function previewTo(c: [number, number] | null) {
    hoverCell = c;
    if (!c) {
      preview.clear();
      kick();
      return;
    }
    const goal = nearestFree(maze, c[0], c[1]);
    if (!goal) return;
    const res = solveAll(goal[0], goal[1]);
    emitRows(res.rows, res.chosen, true);
    if (!res.plan) {
      preview.clear();
      return;
    }
    const { pieces } = realize(res.plan, res.start.mode);
    preview.set(pieces, 0, ALT);
    preview.update(0, 0, true);
    kick();
  }

  function planTo(tx: number, ty: number, dry = false) {
    const goal = nearestFree(maze, tx, ty);
    if (!goal) return false;
    const res = solveAll(goal[0], goal[1]);
    const plan = res.plan;
    if (!plan) return false;
    lastGoal = goal;
    emitRows(res.rows, res.chosen, dry);
    const now = clock();
    const { steps, pieces } = realize(plan, res.start.mode);
    const searchDur = reduced ? 0 : THREE.MathUtils.clamp(plan.expanded.length * 0.0028, 0.16, 0.6);
    floor.showSearch(plan.expanded, now, searchDur);
    goalRoom = maze.roomOf[idx(goal[0], goal[1])];
    const [gwx, gwz] = cellToWorld(goal[0], goal[1]);
    floor.uniforms.uGoal.value.set(gwx, gwz, 1, 0);
    let rolled = 0;
    for (const sg of plan.segs) if (sg.mode === ROLL) rolled += sg.cells.length - 1;
    ev.plan({ expanded: plan.expanded.length, steps: rolled + Math.round(plan.flown), room: goalRoom, preview: dry, kind: res.chosen, morphs: plan.morphs });
    fadeDotsAt = 0;
    preview.clear();
    if (dry) {
      // only a suggestion: draw the search and the route, but stay put
      dots.set(pieces, now + searchDur * 0.6, ALT);
      floor.uniforms.uGoal.value.z = 0;
      wake();
      return true;
    }
    if (reduced) {
      // no animation: the robot is simply there, landed, and the plan stays drawn for a moment
      dots.set(pieces, now, ALT);
      const lastPiece = pieces[pieces.length - 1];
      const end = lastPiece ? lastPiece.pts[lastPiece.pts.length - 1] : [motion.x, motion.z];
      const prevPt = lastPiece && lastPiece.pts.length > 1 ? lastPiece.pts[lastPiece.pts.length - 2] : [motion.x, motion.z];
      const h = Math.hypot(end[0] - prevPt[0], end[1] - prevPt[1]) > 1e-3 ? Math.atan2(end[1] - prevPt[1], end[0] - prevPt[0]) : motion.heading;
      motion.place(end[0], end[1], h, ROLL);
      look.set(motion.x, 0, motion.z);
      fadeDotsAt = now + 1.6;
      arrived(now);
    } else {
      dots.set(pieces, now + searchDur * 0.6, ALT);
      motion.cancel();
      pending = { steps, at: now + searchDur * (motion.speed > 0.5 ? 0.3 : 0.75) };
      // the ghost runs the plan first, fast, so you see what's about to happen
      rehearsal = { r: new Rehearsal(currentPose(), steps), at: now + searchDur * 0.45 };
    }
    wake();
    return true;
  }

  function currentPose(): Pose {
    return { x: motion.x, z: motion.z, heading: motion.heading, alt: motion.alt, fold: motion.fold, rotor: rotor };
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

  /** F: take off where it stands, or land; over a wall it first hops to the nearest floor */
  function toggleFly() {
    if (motion.morph) return;
    solve(false);
    pending = null;
    motion.cancel();
    if (dots.length) fadeDotsAt = clock();
    floor.uniforms.uGoal.value.z = 0;
    lastInput = clock();
    if (motion.mode === ROLL) {
      if (reduced) motion.place(motion.x, motion.z, motion.heading, FLY);
      else motion.setSteps([{ kind: "morph", to: FLY }]);
    } else {
      const [cx, cy] = worldToCell(motion.x, motion.z);
      const steps: Step[] = [];
      if (!(maze.grid[idx(cx, cy)] === FLOOR && pointClear(maze, motion.x, motion.z, 0.42))) {
        const c = nearestFree(maze, cx, cy);
        if (c) steps.push({ kind: "fly", pts: [[motion.x, motion.z], cellToWorld(c[0], c[1])] });
      }
      steps.push({ kind: "morph", to: ROLL });
      if (reduced) {
        const last = steps.length > 1 ? (steps[0] as { pts: [number, number][] }).pts[1] : [motion.x, motion.z];
        motion.place(last[0], last[1], motion.heading, ROLL);
      } else motion.setSteps(steps);
    }
    wake();
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
        const d = (x - motion.x) ** 2 + (z - motion.z) ** 2;
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
        queuePreview(c);
        kick();
      }
    } else if (u.z !== 0) {
      u.z = 0;
      canvas.style.cursor = "";
      queuePreview(null);
      kick();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    (floor.uniforms.uHover.value as THREE.Vector3).z = 0;
    queuePreview(null);
    kick();
  });
  // at most one preview plan per frame, however fast the mouse moves
  let previewQueued: [number, number] | null | undefined;
  function queuePreview(c: [number, number] | null) {
    const first = previewQueued === undefined;
    previewQueued = c;
    if (first)
      requestAnimationFrame(() => {
        const q = previewQueued;
        previewQueued = undefined;
        previewTo(q ?? null);
      });
  }

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
  const lastPose = [motion.x, motion.z];
  let wasAwake = true;
  let rotor = 0;
  let propAngle = 0;
  const roll = { neg: 0, pos: 0 };
  let lastInput = clock();
  let costOn = true;
  let costVis = 0;
  let modeState: MotionState = "roll";

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
    if (motion.mode === FLY || motion.morph || motion.active) return;
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
      motion.setSteps(pending.steps);
      pending = null;
    }
    keyStep();
    motion.manual.x = motion.mode === FLY ? keys.x : 0;
    motion.manual.y = motion.mode === FLY ? keys.y : 0;
    const was = motion.active || drive.active;
    const done = motion.update(dt, reduced);
    if (done) arrived(now);
    const flyingNow = motion.mode === FLY || !!motion.morph;
    if (was || motion.speed > 0.01 || pending || motion.morph) {
      busy = true;
      awakeUntil = Math.max(awakeUntil, now + 6);
      lastInput = Math.max(lastInput, now);
    }
    // flying is expensive: left alone in the air, it lands by itself
    if (motion.flying && !motion.active && !keys.x && !keys.y && !auto.on && now - lastInput > 14) toggleFly();
    robotPos.x = motion.x;
    robotPos.z = motion.z;

    // robot pose: legs, rotors, wheels, banking
    const tRotor = THREE.MathUtils.clamp((motion.fold - 0.25) / 0.45, 0, 1);
    rotor += (tRotor - rotor) * Math.min(1, dt * 5);
    if (rotor < 0.002) rotor = 0;
    propAngle += rotor * 55 * dt;
    if (!flyingNow || motion.fold < 0.05) {
      const k = 1 / (WHEEL_R * SCALE);
      roll.neg += (drive.v + drive.w * TRACK * SCALE) * k * dt;
      roll.pos += (drive.v - drive.w * TRACK * SCALE) * k * dt;
    }
    bot.setMorph(motion.fold);
    bot.setSpin(roll.neg, roll.pos, propAngle, rotor > 0.55 ? 1 : 0);
    const bob = motion.alt > 0.05 && !reduced ? Math.sin(now * 2.1) * 0.035 * (motion.alt / ALT) : 0;
    bot.root.position.set(motion.x, motion.alt + bob, motion.z);
    bot.root.rotation.y = -motion.heading;
    const air = motion.alt / ALT;
    bot.lift.rotation.z = THREE.MathUtils.clamp(-motion.aFwd * 0.03, -0.32, 0.32) * air;
    bot.lift.rotation.x = THREE.MathUtils.clamp(motion.aLat * 0.03, -0.32, 0.32) * air;
    blob.position.set(motion.x + 0.03, 0.004, motion.z + 0.04);
    blob.scale.setScalar(1 + air * 0.55);
    (blob.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - 0.6 * air);
    if (rotor > 0 || bob) busy = true;
    const state: MotionState = motion.morph ? (motion.morph.to === FLY ? "takeoff" : "landing") : motion.mode === FLY ? "fly" : "roll";
    if (state !== modeState) {
      modeState = state;
      ev.mode(state);
    }

    // the ghost: a quick rehearsal of the plan, then it fades
    if (rehearsal) {
      const t = now - rehearsal.at;
      if (t >= 0) {
        const p = rehearsal.r.at(t);
        ghost.root.visible = true;
        ghost.root.position.set(p.x, p.alt, p.z);
        ghost.root.rotation.y = -p.heading;
        ghost.setMorph(p.fold);
        ghost.setSpin(0, 0, now * 40, p.rotor > 0.5 ? 1 : 0);
        const out = t - rehearsal.r.duration;
        ghost.setOpacity(Math.min(1, t / 0.12) * (out > 0 ? Math.max(0, 1 - out / 0.35) : 1));
        if (out > 0.35) {
          rehearsal = null;
          ghost.root.visible = false;
        }
      }
      busy = true;
    }

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

    if (!flyingNow) tracks.update(now, motion.x, motion.z, motion.heading, motion.odo);
    else tracks.uniforms.uTime.value = now;
    const up = motion.fold > 0.5;
    if (!reduced) lidar.update(now, dt, motion.x, motion.z, spin, up ? 0.7 : 0.3, up ? 0.78 : 0.5);
    else lidar.uniforms.uTime.value = now;
    // the local costmap follows the robot, and switches layers as it morphs
    costVis += ((costOn ? 1 : 0) - costVis) * Math.min(1, dt * (reduced ? 60 : 6));
    if (Math.abs(costVis - (costOn ? 1 : 0)) > 0.004) busy = true;
    else costVis = costOn ? 1 : 0;
    floor.uniforms.uCostWin.value.set(motion.x, motion.z, 6.5, costVis);
    floor.uniforms.uCostFly.value = motion.fold;
    if (dots.length) {
      const drawing = dots.update(now, motion.active ? motion.progress : 0, reduced);
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
    const [cx, cy] = worldToCell(motion.x, motion.z);
    const r = cx >= 0 && cy >= 0 && cx < W && cy < H ? maze.roomOf[idx(cx, cy)] : -1;
    if (r >= 0 && r !== current) {
      current = r;
      ev.room(r);
    }
    if ((motion.x !== lastPose[0] || motion.z !== lastPose[1]) && now - poseAt > 1 / 30) {
      poseAt = now;
      lastPose[0] = motion.x;
      lastPose[1] = motion.z;
      ev.pose(motion.x, motion.z, motion.heading, flyingNow);
    }

    // the Solve tour waits in each room, then moves on
    if (auto.on && auto.until && !motion.active && !pending) {
      ev.autopilot(true, Math.min(1, (now - auto.start) / DWELL));
      if (now >= auto.until) {
        auto.until = 0;
        if (tourTarget >= ROOMS.length - 1) solve(false);
        else goRoom(tourTarget + 1);
      }
    }

    // camera: follows the robot with a short damping
    const lead = reduced ? 0 : 0.5 * Math.min(1, motion.speed / drive.vmax);
    // stop following a little before the board's edge, so the view stays mostly on the toy
    const tx = THREE.MathUtils.clamp(motion.x + Math.cos(motion.heading) * lead, -W / 2 + 7, W / 2 - 7);
    const tz = THREE.MathUtils.clamp(motion.z + Math.sin(motion.heading) * lead, -H / 2 + 8, H / 2 - 4);
    const ty = motion.alt * 0.45;
    const k = reduced ? 1 : 1 - Math.exp(-dt / 0.16);
    look.x += (tx - look.x) * k;
    look.z += (tz - look.z) * k;
    look.y += (ty - look.y) * k;
    if (Math.abs(tx - look.x) + Math.abs(tz - look.z) + Math.abs(ty - look.y) > 0.002) busy = true;
    placeCamera();

    // rooms near the camera animate; heavy media loads as the robot approaches
    if (wasAwake && !awake) for (const f of rooms) f.sleep?.();
    wasAwake = awake;
    for (const f of rooms) {
      const [rx, rz] = roomCenter[f.room];
      const d2 = (rx - look.x) ** 2 + (rz - look.z) ** 2;
      if (f.approach && !approached.has(f.room) && (rx - motion.x) ** 2 + (rz - motion.z) ** 2 < 17 * 17) {
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
  ev.pose(motion.x, motion.z, motion.heading, false);
  wake();
  if (!reduced && (opts.startRoom ?? 0) === 0) {
    // first thing a visitor sees: the planner searching for the way to the first room
    setTimeout(() => {
      if (motion.active || pending || dots.length) return;
      tourTarget = 0;
      const [ax, ay] = maze.anchors[1];
      planTo(ax, ay, true);
    }, 1100);
  }

  /** re-run the planners for what's under the cursor (or the last goal), after a setting changes */
  function refreshRows() {
    if (hoverCell) previewTo(hoverCell);
    else if (lastGoal) {
      const res = solveAll(lastGoal[0], lastGoal[1]);
      emitRows(res.rows, res.chosen, true);
    }
    kick();
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
        if (motion.active && !motion.morph) motion.cancel();
        if (dots.length) fadeDotsAt = clock();
        floor.uniforms.uGoal.value.z = 0;
        lastInput = clock();
        wake();
      }
    },
    fly: toggleFly,
    setKind(k) {
      kind = k;
      refreshRows();
    },
    setPref(p) {
      wts = weights(p);
      refreshRows();
    },
    costmap(on) {
      costOn = on;
      wake();
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
    stats: () => ({
      cpu,
      upd,
      calls,
      tris,
      dpr,
      frames,
      programs: renderer.info.programs?.length ?? 0,
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      pose: { x: motion.x, z: motion.z, alt: motion.alt, fold: motion.fold, mode: motion.mode, steps: motion.steps.length },
    }),
  };
}

