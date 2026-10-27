import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Ray,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Timeline } from "../timeline";
import { Arm, DIM, type Q, SHOULDER_Y, solve, solveDir, zeroQ } from "./arm";
import { PAL, clamp, lerp, minjerk, near, ramp, smooth } from "./kit";
import { ITEM_SCALE, type Item, SWARM_SPOTS, buildItems } from "./objects";
import { CELL, buildStudio, slot } from "./studio";

/* ── one pick-and-place cycle, as fractions of a chapter's scroll ─────────── */
const PH = { down: 0.07, grip: 0.12, up: 0.19, show: 0.33, showEnd: 0.57, over: 0.7, place: 0.76, release: 0.8, retreat: 0.85 };
const FL = { open: 0.62, back: 0.69, land: 0.9 }; // the drone: let go, back off, it flies to the shelf
const ADV = 0.86; // the conveyor brings the next object from here to the end of the chapter
const PI = Math.PI;

type Shot = { t: Vector3; az: number; el: number; R: number };
const shot = (x: number, y: number, z: number, az: number, el: number, R: number): Shot => ({ t: new Vector3(x, y, z), az, el, R });

interface Plan {
  item: Item;
  ag: number; // finger axis angle at the pick
  pre: Vector3;
  pick: Vector3;
  q6g: number;
  qPre: Q;
  qPick: Q;
  show: Vector3;
  qShowA: Q;
  qShowB: Q;
  prePlace: Vector3;
  place: Vector3;
  q6p: number;
  qPrePlace: Q;
  qPlace: Q;
  qRetreat: Q;
  rel: Matrix4;
  pickWorld: Matrix4;
  restWorld: Matrix4;
  releaseWorld: Matrix4;
  hoverPos: Vector3;
}

export interface Workshop {
  wake(): void;
}

export function startWorkshop(canvas: HTMLCanvasElement, tl: Timeline, video: HTMLVideoElement): Workshop {
  const reduced = tl.reduced;
  const stats = { cpu: 0, upd: 0, frames: 0, calls: 0, tris: 0, dpr: 0 };
  const showStats = import.meta.env.DEV || location.search.includes("stats");
  if (showStats) (window as unknown as { __ws: typeof stats }).__ws = stats;

  /* ── renderer, scene, light ─────────────────────────────────────────────── */
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  let dpr = Math.min(window.devicePixelRatio || 1, tl.mobile ? 1.5 : 2);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(PAL.bg);
  scene.fog = new Fog(PAL.bg, 11, 26);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  scene.add(new HemisphereLight("#fffaf1", "#d2c9b8", 0.85));
  const key = new DirectionalLight("#fff3e2", 2.3);
  key.position.set(-2.4, 6.2, 4.4);
  key.target.position.set(0.1, 0.5, -0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(tl.mobile ? 1024 : 2048, tl.mobile ? 1024 : 2048);
  const sc = key.shadow.camera;
  sc.left = -3.4;
  sc.right = 3.6;
  sc.top = 3.2;
  sc.bottom = -2.6;
  sc.near = 2;
  sc.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 5;
  scene.add(key, key.target);
  const rim = new DirectionalLight("#e8eeff", 0.55);
  rim.position.set(4, 3, -2);
  scene.add(rim);

  const plastic = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
  const studio = buildStudio(plastic);
  scene.add(studio.group);
  const arm = new Arm(plastic);
  scene.add(arm.root);
  const items = buildItems(plastic);
  for (const it of items) {
    it.group.matrixAutoUpdate = false;
    scene.add(it.group);
  }
  const N = items.length;

  const camera = new PerspectiveCamera(30, 1, 0.1, 60);

  /* ── shots ──────────────────────────────────────────────────────────────── */
  const HERO = shot(0.32, 0.9, 0.05, 0.56, 0.16, 1.95);
  const WORK = shot(0.05, 0.92, -0.1, 0.44, 0.2, 2.1);
  const sn = studio.screenNormal;
  const BENCH: Shot = {
    t: studio.screenCenter.clone().add(new Vector3(-0.1, -0.06, 0)),
    az: Math.atan2(sn.x, sn.z) + 0.3,
    el: 0.1,
    R: 0.9,
  };
  const END = shot(-0.42, 0.8, -0.38, 0.06, 0.2, 1.6);
  const camAz = WORK.az;
  const toCam = new Vector3(Math.sin(camAz), 0, Math.cos(camAz));
  const SHOW_AZ = camAz - 0.62; // the arm holds things out to its left, so you see it in profile

  /* ── plans: every pose of every cycle, solved once ──────────────────────── */
  const B = CELL.belt;
  const v = new Vector3();
  const q = new Quaternion();
  const S = ITEM_SCALE;
  const one = new Vector3(S, S, S);
  const yawQ = (a: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a);
  const tcpWorld = (jq: Q, w: number) => {
    arm.apply(jq, 0, w);
    arm.root.updateMatrixWorld(true);
    return arm.tcp.matrixWorld.clone();
  };
  const sol = (p: Vector3, phi: number, q6: number, hint?: number): Q => {
    const out = zeroQ();
    const ok = solve(p.x, p.y, p.z, phi, q6, out, hint);
    if (!ok && import.meta.env.DEV) console.warn("IK clamped", p.toArray(), phi);
    return out;
  };
  const solD = (p: Vector3, d: Vector3, q6: number): Q => {
    const out = zeroQ();
    const ok = solveDir(p.x, p.y, p.z, d.x, d.y, d.z, q6, out);
    if (!ok && import.meta.env.DEV) console.warn("IK clamped (dir)", p.toArray());
    return out;
  };

  /** a look pose: the base turns a little away (`side`) so the arm reads in profile, the head turns to T */
  const pw = new Vector3();
  const pdir = new Vector3();
  const pointAt = (T: Vector3, out: Q, q6: number, side = -0.62) => {
    const yaw = Math.atan2(T.x, T.z) + side;
    pw.set(Math.sin(yaw) * 0.46, SHOULDER_Y + 0.96, Math.cos(yaw) * 0.46);
    pdir.subVectors(T, pw).normalize();
    solveDir(pw.x + DIM.L3 * pdir.x, pw.y + DIM.L3 * pdir.y, pw.z + DIM.L3 * pdir.z, pdir.x, pdir.y, pdir.z, q6, out);
    return out;
  };

  /** roll q6 so the held object's front faces the camera */
  const faceCamera = (jq: Q, rel: Matrix4, up: Vector3, w: number) => {
    const fwd = new Vector3();
    const want = toCam.clone().addScaledVector(up, -toCam.dot(up)).normalize();
    const score = (q6: number) => {
      const t = zeroQ();
      for (let k = 0; k < 6; k++) t[k] = jq[k];
      t[5] = q6;
      const m = tcpWorld(t, w).multiply(rel);
      fwd.setFromMatrixColumn(m, 2);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      return fwd;
    };
    const f0 = score(0).clone();
    const delta = Math.atan2(new Vector3().crossVectors(f0, want).dot(up), f0.dot(want));
    const a = score(-delta).dot(want);
    const b = score(delta).dot(want);
    return a >= b ? -delta : delta;
  };

  const towardViewer = (d: number, y: number) => new Vector3(Math.sin(camAz) * d, y, Math.cos(camAz) * d);
  const plans: Plan[] = [];
  let prevQ6 = 0;
  for (let i = 0; i < N; i++) {
    const it = items[i];
    const pick = new Vector3(B.pickX, B.y + it.gy, B.z);
    const pre = pick.clone().add(new Vector3(0, 0.3, 0));
    const q1g = Math.atan2(pick.x, pick.z);
    const ag0 = it.axis === "z" ? PI / 2 : 0;
    // fingers are symmetric: take whichever of the two equivalent rolls is closer
    let q6g = near(q1g - ag0, prevQ6);
    if (Math.abs(q6g + PI - prevQ6) < Math.abs(q6g - prevQ6)) q6g += PI;
    else if (Math.abs(q6g - PI - prevQ6) < Math.abs(q6g - prevQ6)) q6g -= PI;
    const ag = q1g - q6g;
    const qPick = sol(pick, PI, q6g);
    const qPre = sol(pre, PI, q6g);
    const pickWorld = new Matrix4().compose(new Vector3(B.pickX, B.y, B.z), new Quaternion(), one);
    const rel = tcpWorld(qPick, it.w).invert().multiply(pickWorld);

    // show it to you: held out to the side, top tipped toward the camera, front turned to face you
    const show = new Vector3(Math.sin(SHOW_AZ) * 1.32, 1.26 + it.gy - it.h * 0.5, Math.cos(SHOW_AZ) * 1.32);
    const up = new Vector3(0, 1, 0).addScaledVector(toCam, Math.tan(it.tilt)).normalize();
    const dir = up.clone().negate();
    const q6c = near(faceCamera(solD(show, dir, 0), rel, up, it.w), q6g);
    const qShowA = solD(show, dir, q6c - 0.55);
    const qShowB = solD(show.clone().add(new Vector3(0, 0.035, 0)), dir, q6c + 0.55);

    const sl = slot(i);
    const place = sl.pos.clone().add(new Vector3(0, it.gy + 0.002, 0));
    const prePlace = place.clone().add(new Vector3(0, 0.32, 0));
    const q1p = Math.atan2(place.x, place.z);
    const q6p = near(q1p - ag - sl.yaw, q6c + 0.55);
    const qPlace = sol(place, PI, q6p);
    const qPrePlace = sol(prePlace, PI, q6p);

    const back = show.clone().add(new Vector3(-Math.sin(SHOW_AZ) * 0.32, 0.18, -Math.cos(SHOW_AZ) * 0.32));
    const qRetreat = sol(back, PI * 1.04, q6c + 0.55);

    const restWorld =
      it.kind === "fly" ? new Matrix4().compose(sl.pos, yawQ(sl.yaw), one) : tcpWorld(qPlace, it.w).multiply(rel);
    const releaseWorld = tcpWorld(qShowB, it.w).multiply(rel);
    const hoverPos = sl.pos.clone().add(new Vector3(0, 0.4, 0));
    plans.push({ item: it, ag, pre, pick, q6g, qPre, qPick, show, qShowA, qShowB, prePlace, place, q6p, qPlace, qPrePlace, qRetreat, rel, pickWorld, restWorld, releaseWorld, hoverPos });
    prevQ6 = it.kind === "fly" ? q6c + 0.55 : q6p;
  }
  const qRest = pointAt(towardViewer(2.4, 1.15), zeroQ(), near(0, prevQ6));
  const qWatch = pointAt(studio.screenCenter, zeroQ(), qRest[5], 0.5);

  /* ── state ──────────────────────────────────────────────────────────────── */
  let sDisp = tl.s;
  let kbDisp = tl.kb;
  let kcDisp = tl.kc;
  const look = new Vector3().copy(towardViewer(2.2, 1.15)); // where the arm looks while following
  const lookGoal = look.clone();
  const orbit = { yaw: 0, pitch: 0, goalYaw: 0, goalPitch: 0 };
  let air = reduced ? 0 : 1; // drones in the air (they land when you leave them alone)
  let lastInput = performance.now();
  let focusIdx = -1;
  let focusShown = -1;
  let focusT = 0;
  let focusStart = 0;
  let waveStart = -1e9;
  let videoTex: VideoTexture | null = null;
  let posterTex: Texture | null = null;
  let clipRatio = 16 / 9;
  const qCur = zeroQ();
  const qTmp = zeroQ();
  let grip = 1;
  let gripW = 0.2;
  let mode = "Follow";
  // the arm wakes up when you arrive (only if you land on the first screen)
  const qSleep: Q = [-0.35, -0.42, 2.35, 0, 1.05, qRest[5]];
  let introStart = -1;
  const introOn = !reduced && tl.s < -0.6;

  const cp = (a: Q, out: Q) => {
    for (let k = 0; k < 6; k++) out[k] = a[k];
  };
  const lerpQ = (a: Q, b: Q, t: number, out: Q) => {
    for (let k = 0; k < 6; k++) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
  };
  const cart = (a: Vector3, b: Vector3, t: number, phi: number, q6: number, out: Q) => {
    v.lerpVectors(a, b, t);
    solve(v.x, v.y, v.z, phi, q6, out);
  };

  /** the arm during chapter i at phase p; returns the gripper opening */
  function chapterPose(i: number, p: number, out: Q): number {
    const P = plans[i];
    const next = i < N - 1 ? plans[i + 1].qPre : qRest;
    if (p < PH.down) {
      mode = "Pick";
      cart(P.pre, P.pick, minjerk(ramp(p, 0, PH.down)), PI, P.q6g, out);
      return 1;
    }
    if (p < PH.grip) {
      mode = "Grip";
      cp(P.qPick, out);
      return 1 - smooth(ramp(p, PH.down, PH.grip));
    }
    if (p < PH.up) {
      mode = "Lift";
      cart(P.pick, P.pre, minjerk(ramp(p, PH.grip, PH.up)), PI, P.q6g, out);
      return 0;
    }
    if (p < PH.show) {
      mode = "Present";
      lerpQ(P.qPre, P.qShowA, minjerk(ramp(p, PH.up, PH.show)), out);
      return 0;
    }
    if (p < PH.showEnd) {
      mode = "Present";
      lerpQ(P.qShowA, P.qShowB, smooth(ramp(p, PH.show, PH.showEnd)), out);
      return 0;
    }
    if (P.item.kind === "fly") {
      if (p < FL.open) {
        mode = "Release";
        cp(P.qShowB, out);
        return smooth(ramp(p, PH.showEnd, FL.open));
      }
      mode = "Return";
      if (p < FL.back) lerpQ(P.qShowB, P.qRetreat, minjerk(ramp(p, FL.open, FL.back)), out);
      else lerpQ(P.qRetreat, next, minjerk(ramp(p, FL.back, 1)), out);
      return 1;
    }
    if (p < PH.over) {
      mode = "Place";
      lerpQ(P.qShowB, P.qPrePlace, minjerk(ramp(p, PH.showEnd, PH.over)), out);
      return 0;
    }
    if (p < PH.place) {
      mode = "Place";
      cart(P.prePlace, P.place, minjerk(ramp(p, PH.over, PH.place)), PI, P.q6p, out);
      return 0;
    }
    if (p < PH.release) {
      mode = "Release";
      cp(P.qPlace, out);
      return smooth(ramp(p, PH.place, PH.release));
    }
    mode = "Return";
    if (p < PH.retreat) cart(P.place, P.prePlace, minjerk(ramp(p, PH.release, PH.retreat)), PI, P.q6p, out);
    else lerpQ(P.qPrePlace, next, minjerk(ramp(p, PH.retreat, 1)), out);
    return 1;
  }

  /** under reduced motion the cycle jumps between three still frames */
  function quantize(s: number): number {
    if (s < 0) return s < -0.4 ? -1 : 0;
    const i = Math.floor(s);
    if (i >= N) return N;
    const p = s - i;
    return p < 0.1 ? i : p < 0.84 ? i + (PH.show + PH.showEnd) / 2 : i + 0.999;
  }

  /* ── camera fit to the free part of the screen ──────────────────────────── */
  const camT = new Vector3();
  function placeCamera(s: number) {
    const k0 = smooth(ramp(s, -1, -0.15));
    let az = lerp(HERO.az, WORK.az, k0);
    let el = lerp(HERO.el, WORK.el, k0);
    let R = lerp(HERO.R, WORK.R, k0);
    camT.lerpVectors(HERO.t, WORK.t, k0);
    if (s >= 0 && s < N && !reduced) {
      const i = Math.floor(s);
      const p = s - i;
      // lean in while the arm shows you the object, back out to watch it placed
      const w = smooth(ramp(p, 0.2, 0.36)) * (1 - smooth(ramp(p, 0.6, 0.74)));
      const P = plans[i];
      v.copy(P.show).setY(P.show.y - P.item.h * 0.35);
      camT.lerp(v, 0.72 * w);
      R = Math.exp(lerp(Math.log(R), Math.log(0.9), w));
      el = lerp(el, 0.03, w);
    }
    const kb = smooth(kbDisp);
    az = lerp(az, BENCH.az, kb);
    el = lerp(el, BENCH.el, kb);
    R = lerp(R, BENCH.R, kb);
    camT.lerp(BENCH.t, kb);
    const kc = smooth(kcDisp);
    az = lerp(az, END.az, kc);
    el = lerp(el, END.el, kc);
    R = lerp(R, END.R, kc);
    camT.lerp(END.t, kc);
    az += orbit.yaw;
    el = clamp(el + orbit.pitch, 0.02, 0.5);

    const { rect, vw, vh } = tl;
    const half = MathUtils.degToRad(camera.fov / 2);
    const tv = Math.tan(half);
    const fitV = Math.atan((tv * rect.h) / vh);
    const fitH = Math.atan((tv * rect.w) / vh);
    const D = (R / Math.sin(Math.min(fitV, fitH))) * 0.96;
    camera.position.set(camT.x + D * Math.cos(el) * Math.sin(az), camT.y + D * Math.sin(el), camT.z + D * Math.cos(el) * Math.cos(az));
    camera.lookAt(camT);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    camera.setViewOffset(vw, vh, vw / 2 - cx, vh / 2 - cy, vw, vh);
    camera.updateMatrixWorld();
  }

  /* ── objects ────────────────────────────────────────────────────────────── */
  const pos = new Vector3();
  const scl = new Vector3();
  const qa = new Quaternion();
  const qb = new Quaternion();
  const pa = new Vector3();
  const pb = new Vector3();
  const restPose = new Matrix4();
  const tmpM = new Matrix4();
  const dummy = new Object3D();
  const UP = new Vector3(0, 1, 0);
  const held = new Matrix4();

  /** world pose of item k when nothing overrides it (rest = on the shelf / in the air) */
  function itemPose(k: number, s: number, t: number, out: Matrix4): "belt" | "held" | "rest" | "fly" {
    const P = plans[k];
    const i = Math.floor(s);
    const p = s - i;
    if (k > i || (k === i && p < PH.grip)) {
      const c = s < 0 ? 0 : Math.min(N, i + smooth(ramp(p, ADV, 1)));
      const u = k - c;
      out.compose(pos.set(B.pickX + u * B.gap, B.y, B.z), qa.identity(), one);
      return "belt";
    }
    const isFly = P.item.kind === "fly";
    const drop = isFly ? PH.showEnd + (FL.open - PH.showEnd) * 0.5 : (PH.place + PH.release) / 2;
    if (k === i && p < drop) {
      out.multiplyMatrices(held, P.rel);
      return "held";
    }
    if (!isFly) {
      out.copy(P.restWorld);
      return "rest";
    }
    // the drone: from where it was let go, up and over to its spot above the shelf
    const tf = k === i ? smooth(ramp(p, FL.open, FL.land)) : 1;
    P.restWorld.decompose(pb, qb, scl);
    pb.lerp(P.hoverPos, air);
    pb.y += Math.sin(t * 2.1) * 0.012 * air;
    if (tf < 1) {
      P.releaseWorld.decompose(pa, qa, scl);
      pos.lerpVectors(pa, pb, tf);
      pos.y += Math.sin(tf * PI) * 0.22;
      qa.slerp(qb, tf);
      out.compose(pos, qa, one);
      return "fly";
    }
    qb.multiply(q.setFromAxisAngle(new Vector3(1, 0, 0.6).normalize(), Math.sin(t * 1.3) * 0.04 * air));
    out.compose(pb, qb, one);
    return "rest";
  }

  const focusPose = new Matrix4();
  function placeItems(s: number, t: number) {
    arm.root.updateMatrixWorld(true);
    held.copy(arm.tcp.matrixWorld);
    const i = Math.floor(s);
    const p = s - i;
    // belt texture travels with the queue
    const c = s < 0 ? 0 : Math.min(N, i + smooth(ramp(p, ADV, 1)));
    studio.beltTex.offset.x = (c * B.gap) / 0.2;

    for (let k = 0; k < N; k++) {
      const it = items[k];
      const state = itemPose(k, s, t, it.group.matrix);
      if (k === focusShown && focusT > 0) {
        // the story: the object floats to the front of the stage, turning slowly
        restPose.copy(it.group.matrix);
        restPose.decompose(pa, qa, scl);
        const dir = v.set(0, 0, -1).applyQuaternion(camera.quaternion);
        // close enough that it fills about half of the free stage, whatever the screen
        const frac = Math.min(tl.rect.h, tl.rect.w) / tl.vh;
        const fd = (it.radius * 2 * 1.6) / (0.5 * frac * 2 * Math.tan(MathUtils.degToRad(camera.fov / 2)));
        pb.copy(camera.position).addScaledVector(dir, Math.max(1.2, fd));
        pb.y -= 0.06;
        const spin = reduced ? 0 : (1 - Math.exp(-(t - focusStart) * 0.35)) * 2.4 - 0.5;
        const face = Math.atan2(camera.position.x - pb.x, camera.position.z - pb.z);
        qb.setFromAxisAngle(UP, face + spin);
        qb.premultiply(q.setFromAxisAngle(v.set(Math.cos(face), 0, -Math.sin(face)), 0.32));
        const e = smooth(focusT);
        pos.lerpVectors(pa, pb, e);
        pos.y += Math.sin(e * PI) * 0.15;
        qa.slerp(qb, e);
        const sz = lerp(1, 1.6, e) * S;
        focusPose.compose(pos, qa, scl.set(sz, sz, sz));
        // centre the object on its own middle rather than its base
        tmpM.makeTranslation(0, (-it.h * 0.5 * e) / S, 0);
        it.group.matrix.multiplyMatrices(focusPose, tmpM);
      }
      it.group.matrixWorldNeedsUpdate = true;

      // props and little drones
      const ex = it.extra;
      if (ex && it.kind === "fly") {
        const motors = ex.userData.motors as [number, number][];
        const spinning = state === "fly" || (state === "rest" && air > 0.02);
        for (let n = 0; n < 4; n++) {
          dummy.position.set(motors[n][0], 0.087, motors[n][1]);
          dummy.rotation.set(0, spinning ? t * 21 * (n % 2 ? 1 : -1) + n : n * 0.7, 0);
          dummy.updateMatrix();
          ex.setMatrixAt(n, dummy.matrix);
        }
        ex.instanceMatrix.needsUpdate = true;
      } else if (ex && it.kind === "swarm") {
        let lift = 0;
        if (k < i) lift = 1;
        else if (k === i) lift = ramp(p, PH.retreat, 1);
        lift = smooth(lift) * air;
        for (let n = 0; n < SWARM_SPOTS.length; n++) {
          const [x, z] = SWARM_SPOTS[n];
          const a = t * 0.5 * lift;
          const sx = x * (1 + lift * 0.9);
          const sz = z * (1 + lift * 0.9);
          dummy.position.set(sx * Math.cos(a) - sz * Math.sin(a), 0.03 + lift * (0.2 + Math.sin(t * 1.7 + n * 1.3) * 0.015), sx * Math.sin(a) + sz * Math.cos(a));
          dummy.rotation.set(0, -a, 0);
          dummy.updateMatrix();
          ex.setMatrixAt(n, dummy.matrix);
        }
        ex.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /* ── input ──────────────────────────────────────────────────────────────── */
  const ndc = new Vector2(0, 0);
  let hasPointer = false;
  let hoverIdx = -1;
  const ray = new Ray();
  const tip = document.querySelector<HTMLElement>(".tip");
  const railLabels = Array.from(document.querySelectorAll<HTMLButtonElement>(".rail button")).map((b) => b.getAttribute("aria-label") ?? "");

  const setRay = (cx: number, cy: number) => {
    ndc.set((cx / tl.vw) * 2 - 1, -(cy / tl.vh) * 2 + 1);
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
  };

  function updateLookGoal() {
    if (!hasPointer || reduced) {
      lookGoal.copy(towardViewer(2.2, 1.15));
      return;
    }
    // intersect the pointer ray with a plane between the arm and you
    const n = v.set(Math.sin(camAz), 0, Math.cos(camAz));
    const p0 = towardViewer(1.9, 1.1);
    const denom = n.dot(ray.direction);
    if (Math.abs(denom) < 1e-4) return;
    const tt = pa.copy(p0).sub(ray.origin).dot(n) / denom;
    lookGoal.copy(ray.origin).addScaledVector(ray.direction, tt);
    lookGoal.y = clamp(lookGoal.y, 0.25, 2.6);
    const lat = new Vector3(Math.cos(camAz), 0, -Math.sin(camAz));
    const off = clamp(pa.copy(lookGoal).sub(p0).dot(lat), -2.4, 2.4);
    lookGoal.copy(p0).addScaledVector(lat, off).setY(lookGoal.y);
  }

  /** how far the cursor's look point sits left/right of straight ahead */
  const lookLat = () => (look.x - Math.sin(camAz) * 1.9) * Math.cos(camAz) - (look.z - Math.cos(camAz) * 1.9) * Math.sin(camAz);

  function pickAt(): number {
    const s = sDisp;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < N; k++) {
      const st = itemPose(k, s, 0, tmpM);
      if (st === "belt" || st === "held") continue;
      const it = items[k];
      tmpM.decompose(pa, qa, scl);
      pa.y += it.h * 0.5;
      const d = ray.distanceSqToPoint(pa);
      const r = Math.max(0.16, it.radius * 0.9);
      if (d < r * r) {
        const along = pa.sub(ray.origin).dot(ray.direction);
        if (along < bestD) {
          bestD = along;
          best = k;
        }
      }
    }
    return best;
  }

  const stageActive = () => tl.zone === "hero" || tl.zone === "journey" || tl.zone === "contact";
  let drag: { x: number; y: number; yaw: number; pitch: number; moved: boolean; id: number } | null = null;

  window.addEventListener(
    "pointermove",
    (e) => {
      lastInput = performance.now();
      if (e.pointerType === "mouse") {
        hasPointer = true;
        setRay(e.clientX, e.clientY);
        updateLookGoal();
      }
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        orbit.goalYaw = clamp(drag.yaw - dx * 0.0042, -0.55, 0.55);
        orbit.goalPitch = clamp(drag.pitch + dy * 0.0026, -0.16, 0.22);
      }
      if (e.target === canvas && !drag && stageActive() && focusIdx < 0) {
        const k = pickAt();
        if (k !== hoverIdx) {
          hoverIdx = k;
          canvas.classList.toggle("hovering", k >= 0);
          if (tip) {
            tip.textContent = k >= 0 ? `${railLabels[k]} · open` : "";
            tip.classList.toggle("on", k >= 0);
          }
        }
        if (tip && k >= 0) tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
      } else if (hoverIdx >= 0 && e.target !== canvas) {
        hoverIdx = -1;
        canvas.classList.remove("hovering");
        tip?.classList.remove("on");
      }
      wake();
    },
    { passive: true },
  );
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, yaw: orbit.goalYaw, pitch: orbit.goalPitch, moved: false, id: e.pointerId };
    if (e.pointerType === "mouse") canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
    setRay(e.clientX, e.clientY);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasClick = !drag.moved && e.type === "pointerup";
    drag = null;
    canvas.classList.remove("dragging");
    orbit.goalYaw = 0;
    orbit.goalPitch = 0;
    if (wasClick && stageActive()) {
      setRay(e.clientX, e.clientY);
      const k = pickAt();
      if (k >= 0) window.dispatchEvent(new CustomEvent("ws:pick", { detail: k }));
    }
    wake();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  for (const ev of ["scroll", "keydown", "touchstart", "wheel"]) window.addEventListener(ev, () => ((lastInput = performance.now()), wake()), { passive: true });

  window.addEventListener("ws:focus", (e) => {
    const k = (e as CustomEvent<number>).detail;
    focusIdx = k;
    if (k >= 0) {
      focusShown = k;
      focusStart = performance.now() / 1000;
      if (reduced) focusT = 1;
    } else if (reduced) focusT = 0;
    hoverIdx = -1;
    tip?.classList.remove("on");
    wake();
  });
  window.addEventListener("ws:wave", () => {
    if (!reduced) waveStart = performance.now() / 1000;
    wake();
  });

  /* ── the monitor ────────────────────────────────────────────────────────── */
  const loader = new TextureLoader();
  function fitScreen() {
    const { w, h } = CELL.screen;
    const r = w / h;
    studio.screen.scale.set(clipRatio < r ? clipRatio / r : 1, clipRatio > r ? r / clipRatio : 1, 1);
  }
  function showPoster(src: string) {
    loader.load(src, (t) => {
      t.colorSpace = SRGBColorSpace;
      posterTex?.dispose();
      posterTex = t;
      if (video.paused || video.readyState < 2) {
        studio.screenMat.map = t;
        studio.screenMat.color.set("#ffffff");
        studio.screenMat.needsUpdate = true;
      }
      wake();
    });
  }
  window.addEventListener("ws:clip", (e) => {
    const d = (e as CustomEvent<{ poster: string; ratio: number }>).detail;
    clipRatio = d.ratio;
    fitScreen();
    showPoster(d.poster);
  });
  video.addEventListener("playing", () => {
    if (!videoTex) {
      videoTex = new VideoTexture(video);
      videoTex.colorSpace = SRGBColorSpace;
    }
    studio.screenMat.map = videoTex;
    studio.screenMat.color.set("#ffffff");
    studio.screenMat.needsUpdate = true;
    wake();
  });
  showPoster(video.poster);
  type RVFC = (cb: () => void) => number;
  const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
  const onVideoFrame = () => {
    if (videoTex && kbDisp > 0.02) wake();
    rvfc?.(onVideoFrame);
  };
  if (rvfc) rvfc(onVideoFrame);
  else setInterval(() => !video.paused && kbDisp > 0.02 && wake(), 33);

  if (showStats) {
    // test hook: where an object is on screen right now
    (window as unknown as { __wsProject: (k: number) => number[] }).__wsProject = (k: number) => {
      items[k].group.matrix.decompose(pa, qa, scl);
      pa.y += items[k].h * 0.5;
      pa.project(camera);
      return [((pa.x + 1) / 2) * tl.vw, ((1 - pa.y) / 2) * tl.vh];
    };
  }

  /* ── loop ───────────────────────────────────────────────────────────────── */
  let running = false;
  let last = 0;
  const intervals: number[] = [];
  let lastHud = 0;
  const pd = {
    mode: document.querySelector(".pd-mode"),
    grip: document.querySelector(".pd-grip"),
    q: Array.from(document.querySelectorAll(".pd-q dd")),
  };

  function size() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) renderer.setSize(w, h, false);
    camera.aspect = tl.vw / tl.vh;
    camera.updateProjectionMatrix();
  }

  function frame(nowMs: number) {
    const now = nowMs / 1000;
    const dt = Math.min(0.05, last ? now - last : 1 / 60);
    if (last) {
      intervals.push(now - last);
      if (intervals.length > 40) intervals.shift();
    }
    last = now;
    const c0 = performance.now();
    let busy = false;

    // timeline: short smoothing only, so the arm answers the wheel straight away
    const target = reduced ? quantize(tl.s) : tl.s;
    const ks = reduced ? 1 : 1 - Math.exp(-dt / 0.07);
    sDisp += (target - sDisp) * ks;
    kbDisp += (tl.kb - kbDisp) * ks;
    kcDisp += (tl.kc - kcDisp) * ks;
    if (Math.abs(target - sDisp) < 1e-4) sDisp = target;
    else busy = true;
    if (Math.abs(tl.kb - kbDisp) < 1e-4) kbDisp = tl.kb;
    else busy = true;
    if (Math.abs(tl.kc - kcDisp) < 1e-4) kcDisp = tl.kc;
    else busy = true;

    // the arm's gaze trails the cursor like a servo
    const kl = reduced ? 1 : 1 - Math.exp(-dt / 0.22);
    look.lerp(lookGoal, kl);
    if (look.distanceToSquared(lookGoal) > 1e-6) busy = true;
    else look.copy(lookGoal);

    const ko = 1 - Math.exp(-dt / (drag ? 0.05 : 0.35));
    orbit.yaw += (orbit.goalYaw - orbit.yaw) * ko;
    orbit.pitch += (orbit.goalPitch - orbit.pitch) * ko;
    if (Math.abs(orbit.yaw - orbit.goalYaw) + Math.abs(orbit.pitch - orbit.goalPitch) > 1e-4) busy = true;

    const resting = performance.now() - lastInput > 7000;
    const airGoal = reduced || resting ? 0 : 1;
    air += (airGoal - air) * (1 - Math.exp(-dt / 0.5));
    if (Math.abs(airGoal - air) < 1e-3) air = airGoal;
    else busy = true;

    const f0 = focusT;
    if (!reduced) focusT = clamp(focusT + (focusIdx >= 0 ? dt : -dt) / 0.7, 0, 1);
    if (focusT !== f0 || (focusIdx >= 0 && now - focusStart < 9)) busy = true;
    if (focusT === 0 && focusIdx < 0) focusShown = -1;

    // ── the arm ──
    const s = sDisp;
    pointAt(look, qTmp, qRest[5]);
    const qFollow = qTmp;
    if (s < 0) {
      const w = smooth(ramp(s, -0.6, 0));
      lerpQ(qFollow, plans[0].qPre, w, qCur);
      grip = 1;
      gripW = items[0].w;
      mode = w < 0.5 ? "Follow" : "Pick";
    } else if (s < N) {
      const i = Math.floor(s);
      grip = chapterPose(i, s - i, qCur);
      gripW = items[i].w;
      const p = s - i;
      if (!reduced && p > PH.show - 0.05 && p < PH.showEnd + 0.05) {
        // while it shows you the object, it tilts it a little toward your cursor
        const w = smooth(ramp(p, PH.show - 0.05, PH.show + 0.03)) * (1 - smooth(ramp(p, PH.showEnd - 0.03, PH.showEnd + 0.05)));
        const lx = clamp(lookLat() * 0.1, -0.18, 0.18);
        const ly = clamp((look.y - 1.1) * 0.18, -0.15, 0.15);
        qCur[0] += lx * w;
        qCur[4] -= ly * w;
        qCur[3] += lx * 0.8 * w;
      }
    } else {
      cp(qRest, qCur);
      grip = 1;
      mode = "Rest";
    }
    if (kbDisp > 0) {
      lerpQ(qCur, qWatch, smooth(kbDisp), qCur);
      if (kbDisp > 0.5) mode = "Watch";
    }
    if (kcDisp > 0) {
      lerpQ(qCur, qFollow, smooth(kcDisp), qCur);
      if (kcDisp > 0.5) mode = "Follow";
    }
    if (introOn) {
      if (introStart < 0) introStart = now;
      const k = minjerk(clamp((now - introStart - 0.35) / 1.7, 0, 1));
      if (k < 1) {
        lerpQ(qSleep, qCur, k, qCur);
        busy = true;
      }
    }
    const wt = now - waveStart;
    if (wt < 1.8) {
      const env = Math.sin((wt / 1.8) * PI);
      qCur[4] += Math.sin(wt * 11) * 0.32 * env;
      qCur[5] += Math.sin(wt * 7) * 0.4 * env;
      grip = 1 - 0.6 * env * (0.5 + 0.5 * Math.sin(wt * 14));
      mode = "Wave";
      busy = true;
    }
    arm.apply(qCur, grip, gripW);
    placeCamera(s);
    placeItems(s, now);

    // anything alive in the air keeps the loop going; otherwise we sleep
    if (air > 0.001 && s > 5 + FL.open) busy = true;
    // video frames wake the loop themselves (below); no need to spin at 60 fps for a 30 fps clip

    const cu = performance.now();
    renderer.render(scene, camera);
    const c1 = performance.now();
    stats.upd = stats.upd ? stats.upd * 0.95 + (cu - c0) * 0.05 : cu - c0;
    stats.cpu = stats.cpu ? stats.cpu * 0.95 + (c1 - c0) * 0.05 : c1 - c0;
    stats.frames++;
    stats.calls = renderer.info.render.calls;
    stats.tris = renderer.info.render.triangles;
    stats.dpr = dpr;

    if (c1 - lastHud > 90) {
      lastHud = c1;
      if (pd.mode) pd.mode.textContent = mode;
      if (pd.grip) pd.grip.textContent = grip > 0.95 ? "grip open" : grip < 0.05 ? "grip closed" : "gripping…";
      for (let k = 0; k < 6; k++) {
        const deg = MathUtils.radToDeg(MathUtils.euclideanModulo(qCur[k] + PI, 2 * PI) - PI);
        pd.q[k].textContent = `${deg < 0 ? "−" : ""}${Math.abs(deg).toFixed(1)}°`;
      }
    }

    // adaptive resolution: if frames are slow while animating, render fewer pixels
    if (busy && intervals.length >= 40 && dpr > 1) {
      const sorted = [...intervals].sort((a, b) => a - b);
      if (sorted[20] > 1 / 40) {
        dpr = Math.max(1, dpr - 0.25);
        renderer.setPixelRatio(dpr);
        size();
        intervals.length = 0;
      }
    }

    if (busy && !document.hidden && !tl.covered) requestAnimationFrame(frame);
    else {
      running = false;
      last = 0;
      intervals.length = 0;
    }
  }

  function wake() {
    if (running || document.hidden || tl.covered) return;
    running = true;
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => {
    size();
    wake();
  });
  document.addEventListener("visibilitychange", wake);

  size();
  updateLookGoal();
  look.copy(lookGoal);
  // first frame, then fade the canvas in
  running = true;
  frame(performance.now());
  requestAnimationFrame(() => canvas.classList.add("ready"));
  return { wake };
}
