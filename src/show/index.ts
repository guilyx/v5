import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import { buildCity } from "./city";
import { Drones } from "./drones";
import { Flock } from "./flock";
import { ACTS, BOX, barge, Choreography, FLOCK_INDEX, match, presetStrokes, relabel, strokesToTargets, type Formation, type Variant } from "./formations";

/** What the page tells the show. */
export interface Bridge {
  /** Timeline position: 0 = overture, 1..8 = acts, 9 = "hello" (fractions = in between). */
  target: number;
  /** Whether any of the sky is on screen. */
  awake: boolean;
  reduced: boolean;
}

export interface Show {
  readonly drones: number;
  wake(): void;
  ripple(x: number, y: number): void;
  pointer(x: number, y: number, on: boolean): void;
  stroke(points: number[]): void;
  shape(name: string): void;
  clear(): void;
  stats(): Record<string, number>;
}

const CAM_Y = 6;
const PLANE = 260; // the formation plane, metres in front of the spectator

export function startShow(canvas: HTMLCanvasElement, bridge: Bridge, onReady: () => void): Show {
  const narrowView = () => innerWidth / innerHeight < 0.85 || innerWidth < 700;
  const n = narrowView() ? 1000 : 1500;
  const renderer = new WebGLRenderer({ canvas, antialias: devicePixelRatio < 1.5, powerPreference: "high-performance", alpha: false });
  renderer.setClearColor(0x03050b, 1);
  const scene = new Scene();
  const cam = new PerspectiveCamera(40, 1, 1, 6000);
  cam.position.set(0, CAM_Y, 0);

  const city = buildCity();
  for (const o of city.objects) scene.add(o);
  const drones = new Drones(n);
  scene.add(drones.mirror, drones.points);
  const flock = new Flock(n);

  let variant: Variant = narrowView() ? "narrow" : "wide";
  const origin = drones.u.uOrigin.value;
  let show: Choreography | null = null;
  let F: Formation[] = [];

  const toDesign = (x: number, y: number, z: number): [number, number, number] => {
    const s = drones.u.uScale.value;
    return [(x - origin.x) / s, (y - origin.y) / s, (z - origin.z) / s];
  };
  const bargeAt = (): [number, number, number] => [origin.x, 1.4, -PLANE + 10];

  // ------------------------------------------------------------ layout

  function layout() {
    const w = innerWidth, h = innerHeight;
    const narrow = narrowView();
    renderer.setPixelRatio(Math.min(devicePixelRatio, narrow ? 1.5 : 2));
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = narrow ? 58 : 40;
    cam.updateProjectionMatrix();
    // lens shift: keep the camera level (towers stay vertical) and slide the horizon down the screen
    const horizon = narrow ? 0.5 : 0.6;
    const pm = cam.projectionMatrix.elements;
    pm[9] = 2 * horizon - 1;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const X = pm[0], Y = pm[5], b = pm[9];
    const box = BOX[narrow ? "narrow" : "wide"];
    // on wide screens the show plays in the space to the right of the programme card
    const dockX = Math.min(36, Math.max(16, w * 0.024));
    const cardRight = dockX + Math.min(448, w - 2 * dockX) + 28;
    const room = (w - 28 - cardRight) / w;
    const cx = narrow ? 0.5 : (cardRight / w + (w - 28) / w) / 2;
    const cy = narrow ? 0.245 : 0.29;
    const sW = ((narrow ? 0.9 : Math.min(0.5, room * 0.96)) * 2 * PLANE) / X / box.w;
    const sH = ((narrow ? 0.31 : 0.4) * 2 * PLANE) / Y / box.h;
    drones.u.uScale.value = Math.min(sW, sH);
    origin.set(((cx * 2 - 1) * PLANE) / X, CAM_Y + ((1 - cy * 2 + b) * PLANE) / Y, -PLANE);
    const px = (Y * renderer.getDrawingBufferSize(buf).y) / 2;
    drones.u.uPx.value = px;
    city.uniforms.uPx.value = px;
    const v: Variant = narrow ? "narrow" : "wide";
    if (v !== variant || !F.length) {
      variant = v;
      const t0 = performance.now();
      show = new Choreography(n, variant, barge(n, toDesign, bargeAt()));
      show.ensure(1);
      F = show.list;
      buildMs = firstMs = performance.now() - t0;
      idleBuild();
      relabeled = false;
      pair = -1;
      flockOn = false;
    } else if (!relabeled) {
      // the barge floats on the water in world space: re-express it for the new framing
      F[0].pos = barge(n, toDesign, bargeAt()).pos;
      pair = -1;
    }
    wake();
  }
  const buf = new Vector2();
  // the remaining acts are built one per idle slot
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  function idleBuild() {
    const c = show;
    if (!c || c.done) return;
    const step = () => {
      if (c !== show) return;
      const t0 = performance.now();
      if (c.next()) {
        buildMs += performance.now() - t0;
        idleBuild();
      }
    };
    if (idle) idle(step, { timeout: 600 });
    else setTimeout(step, 30);
  }
  let buildMs = 0, firstMs = 0;
  let relabeled = false;

  // ------------------------------------------------------------ pointer → sky

  const ray = new Vector3();
  function skyPoint(x: number, y: number): [number, number] {
    ray.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = (origin.z - cam.position.z) / ray.z;
    const wx = cam.position.x + ray.x * t, wy = Math.max(4, cam.position.y + ray.y * t);
    const s = drones.u.uScale.value;
    return [(wx - origin.x) / s, (wy - origin.y) / s];
  }

  // ------------------------------------------------------------ state

  let time = 0;
  let sNow = bridge.target;
  let intro = bridge.reduced || bridge.target > 0.25 ? 1 : -0.12;
  let pair = -1;
  let flockOn = false;
  let flockFull = false;
  let ripSlot = 0;
  let hawkUntil = 0;
  let px = 0, py = 0, camX = 0, camY = 0;
  let lastInput = performance.now();
  let strokes: number[][] = [];
  let cTarget = 0;
  const scratch = new Float32Array(n * 3);
  const scratchCol = new Float32Array(n * 3);

  function flyDrawing() {
    const u = drones.u;
    const tg = strokesToTargets(strokes, n);
    drones.snapshot(scratch);
    const assign = match(scratch, tg.pos, n);
    const to = new Float32Array(n * 3), toCol = new Float32Array(n * 3), order = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = assign[i];
      to.set(tg.pos.subarray(j * 3, j * 3 + 3), i * 3);
      toCol.set(tg.col.subarray(j * 3, j * 3 + 3), i * 3);
      order[i] = tg.order[j];
    }
    if (u.uC.value >= 0.999 && cTarget === 1) {
      drones.overrideNow(scratch, scratchCol);
      drones.setOverride(scratch, scratchCol, to, toCol, order);
      u.uCmix.value = 0;
    } else if (u.uC.value > 0) {
      // caught mid-way between the show and a drawing: fly on from where the drones are
      drones.setOverride(scratch, toCol, to, toCol, order);
      u.uC.value = 1;
      u.uCmix.value = 0;
    } else {
      drones.setOverride(to, toCol, to, toCol, order);
      u.uCmix.value = 1;
    }
    cTarget = 1;
    if (bridge.reduced) {
      u.uC.value = 1;
      u.uCmix.value = 1;
    }
    wake();
  }

  // ------------------------------------------------------------ the frame

  function update(dt: number) {
    const u = drones.u;
    const k = bridge.reduced ? 1 : 1 - Math.exp(-dt / 0.07);
    sNow += (bridge.target - sNow) * k;
    if (Math.abs(bridge.target - sNow) < 1e-4) sNow = bridge.target;

    // the take-off from the barge, once, on arrival
    if (intro < 1) intro = Math.min(1, intro + dt / (sNow > 0.05 ? 0.8 : 4.2));

    let j: number, uT: number;
    if (intro < 1) {
      j = 0;
      uT = Math.max(0, intro);
    } else {
      const fi = Math.min(sNow + 1, ACTS - 1);
      j = Math.min(Math.floor(fi), ACTS - 2);
      show!.ensure(j + 1);
      uT = Math.min(1, Math.max(0, (fi - j - 0.3) / 0.4));
      // with reduced motion the acts cut from one to the next instead of flying
      if (bridge.reduced) uT = uT < 0.5 ? 0 : 1;
    }
    if (j !== pair) {
      drones.setPair(F[j], F[j + 1]);
      pair = j;
    }
    u.uT.value = uT;

    // Act V: the flock is alive while any of it is on stage
    const live = j === FLOCK_INDEX - 1 ? uT : j === FLOCK_INDEX ? 1 - uT : 0;
    if (live > 0) {
      const still = F[j === FLOCK_INDEX ? j + 1 : j];
      if (!flockOn) {
        flock.init(still.pos);
        flockOn = true;
        flockFull = false;
        if (bridge.reduced) for (let s = 0; s < 150; s++) flock.step(1 / 60, s / 60);
      }
      if (live >= 1) flockFull = true;
      else if (flockFull) {
        // the flock is leaving for a formation: hand each drone the nearest slot from where it is now
        const perm = match(flock.pos, still.pos, n);
        for (const f of F) if (!f.live) relabel(f, perm);
        relabeled = true;
        flockFull = false;
        drones.setPair(F[j], F[j + 1]);
      }
      if (performance.now() > hawkUntil && hawkUntil) {
        flock.hawk(0, 0, false);
        hawkUntil = 0;
      }
      if (!bridge.reduced) flock.update(dt, time);
      drones.setLive(j === FLOCK_INDEX ? "a" : "b", flock.pos);
    } else flockOn = false;

    // the visitor's drawing fades in and out on its own clock
    if (u.uC.value !== cTarget) {
      const rate = dt / (cTarget ? 2.4 : 2.0);
      u.uC.value = cTarget ? Math.min(1, u.uC.value + rate) : Math.max(0, u.uC.value - rate);
    }
    if (u.uCmix.value < 1) u.uCmix.value = Math.min(1, u.uCmix.value + dt / 2.2);

    // a little parallax from the pointer
    camX += (px * 3 - camX) * (1 - Math.exp(-dt / 0.25));
    camY += (py * 1.2 - camY) * (1 - Math.exp(-dt / 0.25));
    cam.position.set(camX, CAM_Y + camY, 0);

    u.uTime.value = time;
    city.uniforms.uTime.value = time;
  }

  function busy() {
    const u = drones.u;
    return sNow !== bridge.target || intro < 1 || u.uC.value !== cTarget || u.uCmix.value < 1 || Math.abs(px * 3 - camX) > 0.01;
  }

  let raf = 0;
  let last = 0;
  let cpu = 0, cpuUpdate = 0, fps = 60, frames = 0, odd = false;
  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    // idle and settled: half rate is plenty for twinkling lights
    const idle = now - lastInput > 12000 && !busy() && !flockOn;
    odd = !odd;
    if (!(idle && odd)) {
      const t0 = performance.now();
      if (!bridge.reduced) time += idle ? dt * 2 : dt;
      update(dt);
      const t1 = performance.now();
      renderer.render(scene, cam);
      const spent = performance.now() - t0;
      cpu += (spent - cpu) * 0.05;
      cpuUpdate += (t1 - t0 - cpuUpdate) * 0.05;
      fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
      if (++frames === 1) onReady();
    }
    if (bridge.awake && !document.hidden && (!bridge.reduced || busy())) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (!raf && bridge.awake && !document.hidden && F.length) {
      raf = requestAnimationFrame(frame);
    }
  }

  layout();
  addEventListener("resize", layout);
  document.addEventListener("visibilitychange", wake);

  return {
    drones: n,
    wake() {
      lastInput = performance.now();
      wake();
    },
    ripple(x, y) {
      if (bridge.reduced) return;
      const [dx, dy] = skyPoint(x, y);
      drones.u.uRip.value[ripSlot].set(dx, dy, time, 1);
      ripSlot = (ripSlot + 1) % 4;
      if (flockOn) {
        flock.hawk(dx, dy, true);
        hawkUntil = performance.now() + 700;
      }
      lastInput = performance.now();
      wake();
    },
    pointer(x, y, on) {
      lastInput = performance.now();
      if (on && matchMedia("(pointer: fine)").matches) {
        px = (x / innerWidth) * 2 - 1;
        py = -((y / innerHeight) * 2 - 1);
      }
      if (flockOn && !hawkUntil) {
        const [dx, dy] = skyPoint(x, y);
        flock.hawk(dx, dy, on);
      }
      wake();
    },
    stroke(points) {
      const s: number[] = [];
      for (let i = 0; i < points.length; i += 2) {
        const [x, y] = skyPoint(points[i], points[i + 1]);
        const l = s.length;
        if (l && Math.hypot(x - s[l - 2], y - s[l - 1]) < 0.6) continue;
        s.push(x, y);
      }
      if (!s.length) return;
      strokes.push(s);
      flyDrawing();
    },
    shape(name) {
      strokes = presetStrokes(name, variant);
      flyDrawing();
    },
    clear() {
      strokes = [];
      cTarget = 0;
      if (bridge.reduced) drones.u.uC.value = 0;
      wake();
    },
    stats() {
      const info = renderer.info.render;
      return { cpu, update: cpuUpdate, calls: info.calls, triangles: info.triangles, points: info.points, fps, intro, pair, s: sNow, frames, buildMs, firstMs, drones: n };
    },
  };
}
