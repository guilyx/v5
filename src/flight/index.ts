import {
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  InstancedMesh,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Quaternion,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { buildIslands } from "./islands";
import { buildRoute } from "./route";
import { buildDrone, buildWingGeometry } from "./drone";
import { buildClouds, buildFalls, buildPuffs, buildSkyDome, dotTexture, shadowTexture, SKY, SUN_DIR } from "./sky";
import { lin } from "./geo";
import { LEGS } from "../legs";
import type { Journey } from "../journey";

const UP = new Vector3(0, 1, 0);
const RING_R = 1.75;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Critically damped spring (implicit, stable at any dt). */
function spring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * w;
  const oo = w * w;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  return [(f * x + dt * v + hhoo * target) * inv, (v + hoo * (target - x)) * inv];
}
class Spring3 {
  x = new Vector3();
  v = new Vector3();
  step(t: Vector3, w: number, dt: number) {
    [this.x.x, this.v.x] = spring(this.x.x, this.v.x, t.x, w, dt);
    [this.x.y, this.v.y] = spring(this.x.y, this.v.y, t.y, w, dt);
    [this.x.z, this.v.z] = spring(this.x.z, this.v.z, t.z, w, dt);
  }
  snap(t: Vector3) {
    this.x.copy(t);
    this.v.set(0, 0, 0);
  }
}

function ringGeometry(a: string, b: string) {
  const g = new TorusGeometry(RING_R, 0.15, 8, 48).toNonIndexed();
  const p = g.getAttribute("position");
  const ca = lin(a),
    cb = lin(b);
  const col: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const seg = Math.floor(((Math.atan2(y, x) + Math.PI) / (Math.PI * 2)) * 12);
    const c = seg % 2 ? ca : cb;
    for (let k = 0; k < 3; k++) col.push(c[0], c[1], c[2]);
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function startFlight(canvas: HTMLCanvasElement, j: Journey) {
  const params = new URLSearchParams(location.search);
  const perfOn = params.has("perf");
  const auto = navigator.webdriver; // headless checks: keep the resolution fixed
  const maxDpr = j.coarse ? 1.5 : 2;
  let dpr = Math.min(devicePixelRatio || 1, maxDpr);

  const renderer = new WebGLRenderer({
    canvas,
    antialias: (devicePixelRatio || 1) < 1.5,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(dpr);
  renderer.info.autoReset = true;

  const scene = new Scene();
  scene.background = SKY.horizon;
  scene.fog = new Fog(SKY.horizon, 70, 300);
  const camera = new PerspectiveCamera(48, 1, 0.1, 900);

  // ---------- light ----------
  const hemi = new HemisphereLight(new Color("#dcecff"), new Color("#f2c7a8"), 2.1);
  scene.add(hemi);
  const sun = new DirectionalLight(new Color("#fff1dc"), 2.5);
  sun.castShadow = true;
  const sm = j.coarse ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const S = 32;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 160 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // ---------- world ----------
  const sky = buildSkyDome();
  scene.add(sky);
  const islands = buildIslands();
  const islandMat = new MeshLambertMaterial({ vertexColors: true });
  for (const i of islands) {
    const m = new Mesh(i.geo, islandMat);
    m.position.copy(i.pos);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  const route = buildRoute(islands);
  const falls = buildFalls(islands.flatMap((i) => i.falls));
  scene.add(falls.mesh);

  // the planned route as a dotted line
  let dotMat: ShaderMaterial | null = null;
  {
    const pts: number[] = [];
    const p = new Vector3();
    for (let L = 3; L < route.total - 3; L += 1.5) {
      route.curve.getPoint(route.tAt(L), p);
      pts.push(p.x, p.y, p.z);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const dots = new Points(
      g,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { map: { value: dotTexture() }, scale: { value: 1 }, maxSize: { value: 7 }, fogColor: { value: SKY.horizon } },
        vertexShader: /* glsl */ `
          uniform float scale, maxSize;
          varying float vA;
          varying float vFog;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float z = -mv.z;
            gl_PointSize = min(0.2 * scale / z, maxSize);
            vA = smoothstep(2.0, 6.0, z);
            vFog = smoothstep(70.0, 260.0, z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform vec3 fogColor;
          varying float vA;
          varying float vFog;
          void main() {
            vec4 t = texture2D(map, gl_PointCoord);
            gl_FragColor = vec4(mix(vec3(1.0), fogColor, vFog), t.a * vA * 0.95);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dotMat = dots.material as ShaderMaterial;
    dots.renderOrder = 1;
    scene.add(dots);
  }

  // clouds: avoid the route
  {
    const avoid: Vector3[] = [];
    for (let L = 0; L < route.total; L += 4) avoid.push(route.curve.getPoint(route.tAt(L)));
    const isl = islands.map((i) => ({ x: i.pos.x, z: i.pos.z, R: i.R, y: i.pos.y }));
    scene.add(buildClouds(), buildPuffs(avoid, isl));
  }

  // rings at waypoints 1…6
  const ringTodo = ringGeometry("#ffffff", "#ff7a3d");
  const ringDone = ringGeometry("#ffffff", "#2fbf7f");
  const ringMat = new MeshLambertMaterial({ vertexColors: true, emissive: new Color("#ffffff"), emissiveIntensity: 0.22 });
  const rings: Mesh[] = [];
  const tan = new Vector3();
  for (let k = 1; k < LEGS; k++) {
    const m = new Mesh(ringTodo, ringMat);
    m.position.copy(route.points[k]);
    route.curve.getTangent(route.tAt(route.wp[k]), tan);
    m.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tan);
    scene.add(m);
    rings[k] = m;
  }
  const flashMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
  const flash = new Mesh(new TorusGeometry(RING_R, 0.07, 6, 48), flashMat);
  flash.visible = false;
  scene.add(flash);
  let flashT = 1;

  // the drone and its soft shadow
  const drone = buildDrone();
  drone.group.scale.setScalar(1.25);
  scene.add(drone.group);
  const shadow = new Mesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  shadow.renderOrder = 1;
  scene.add(shadow);

  // the swarm: six wingmen join at the TII ring and park on the SIRB.AI apron
  const WING = 6;
  const wings = new InstancedMesh(buildWingGeometry(), new MeshLambertMaterial({ vertexColors: true }), WING);
  wings.castShadow = true;
  wings.frustumCulled = false;
  wings.visible = false;
  scene.add(wings);
  const wPos = Array.from({ length: WING }, () => new Spring3());
  const W_OFF: [number, number, number][] = [
    [-1.4, 0.3, 1.4],
    [1.4, 0.3, 1.4],
    [-2.6, 0.7, 2.8],
    [2.6, 0.7, 2.8],
    [-3.6, 1.1, 4.2],
    [3.6, 1.1, 4.2],
  ];
  const W_K = [5.4, 5.8, 4.6, 5.0, 4.0, 4.3];
  const apron = Array.from({ length: WING }, (_, k) => islands[4].spots[`apron${k}`].clone().add(islands[4].pos));
  const qPark = new Quaternion().setFromAxisAngle(UP, Math.PI / 2);
  const wq = new Quaternion();
  const wS = new Vector3();
  const wT = new Vector3();
  const wR = new Vector3();
  let wingsInit = false;

  const groundAt = (x: number, z: number): number | null => {
    let best: number | null = null;
    for (const i of islands) {
      const dx = x - i.pos.x,
        dz = z - i.pos.z;
      if (dx * dx + dz * dz > i.R * i.R * 1.3) continue;
      const h = i.heightAt(dx, dz);
      if (h !== null && (best === null || h + i.pos.y > best)) best = h + i.pos.y;
    }
    return best;
  };

  // ---------- flight state ----------
  let L = 0,
    Lv = 0,
    uS = 0,
    uV = 0;
  let ox = 0,
    oxv = 0,
    oy = 0,
    oyv = 0;
  const pos = new Vector3();
  const prev = new Vector3();
  const velS = new Vector3();
  const velPrev = new Vector3();
  const accS = new Vector3();
  const base = new Vector3();
  const T = new Vector3();
  const head = new Vector3(0, 0, 1);
  const camHead = new Vector3(0, 0, 1);
  const right = new Vector3();
  const q = new Quaternion();
  const qT = new Quaternion();
  const m4 = new Matrix4();
  const camPos = new Spring3();
  const camLook = new Spring3();
  let rpm = 0,
    propA = 0,
    time = 0,
    lastInput = performance.now();
  const logged: boolean[] = [];
  const droneFwd = new Vector3();
  const xAxis = new Vector3();
  let prevL = 0,
    lastU = -1,
    camInit = false,
    telAcc = 0;
  const tmp = new Vector3(),
    tmp2 = new Vector3(),
    tmp3 = new Vector3();

  const frameAt = (Lval: number, p: Vector3, t: Vector3) => {
    const tt = route.tAt(Lval);
    route.curve.getPoint(tt, p);
    route.curve.getTangent(tt, t);
  };
  // initial heading: the direction of the first leg
  frameAt(6, tmp, tmp2);
  head.set(tmp.x - route.points[0].x, 0, tmp.z - route.points[0].z).normalize();
  camHead.copy(head);
  droneFwd.copy(head);

  // At each waypoint the camera eases out of the chase into a fixed three-quarter view of the
  // island (a diorama), so you can read the log while the drone threads the ring.
  const ISL = [0, 1, 2, 0, 3, 4, 4, 4];
  // per waypoint: focus on the island (local), then distance back, to the side, and up
  const DIO: [number, number, number, number, number, number][] = [
    [0, 0, 0, 0, 0, 0],
    [-1.5, 0, 0.5, 26, -13, 12.5],
    [0.5, 1.4, -0.8, 26, 13, 12.5],
    [1.5, 0, 0.5, 26, -13, 12.5],
    [1.5, 0, -1, 26, 13, 12.5],
    [-8, 0, -4, 32, 15, 15],
    [6, 1, -6, 24, 21, 17],
    [0, 0, 0, 0, 0, 0],
  ];
  const dioPos: Vector3[] = [];
  const dioLook: Vector3[] = [];
  for (let k = 0; k <= LEGS; k++) {
    const t = route.curve.getTangent(route.tAt(route.wp[k]));
    const h = new Vector3(t.x, 0, t.z);
    if (h.lengthSq() < 1e-3) h.copy(head);
    h.normalize();
    const r = new Vector3().crossVectors(h, UP).normalize();
    const isl = islands[ISL[k]];
    const [fx, fy, fz, D, S, H] = DIO[k];
    const f = new Vector3(fx, fy, fz).add(isl.pos);
    dioPos[k] = f.clone().addScaledVector(h, -D).addScaledVector(r, S).addScaledVector(UP, H);
    dioLook[k] = f.clone().addScaledVector(UP, -1.5).lerp(route.points[k], 0.3);
  }

  function cameraTarget(outPos: Vector3, outLook: Vector3, d: number, uu: number) {
    right.crossVectors(camHead, UP).normalize();
    const k = Math.min(LEGS, Math.round(uu));
    // with the swarm along, the camera backs off to keep the whole V in front of it
    const swarmCam = smooth(4.5, 4.95, uu);
    // the chase: tight behind the drone, follows your steering
    outPos
      .copy(base)
      .addScaledVector(right, ox * 0.62)
      .addScaledVector(UP, oy * 0.5 + 1.6 + 2.4 * swarmCam)
      .addScaledVector(camHead, -5.4 - 5.2 * swarmCam);
    outLook.copy(pos).addScaledVector(camHead, 2.6);
    // near a waypoint: the island diorama
    if (d > 0 && k > 0 && k < LEGS) {
      const e = d * d * (3 - 2 * d);
      outPos.lerp(dioPos[k], e);
      outLook.lerp(dioLook[k], e);
    }
    // take-off: a low three-quarter view of the drone on the pad
    const pre = 1 - smooth(0.0, 0.32, uu);
    if (pre > 0) {
      const p0 = route.points[0];
      tmp3.crossVectors(head, UP).normalize();
      tmp.copy(p0).addScaledVector(head, -4.0).addScaledVector(tmp3, -1.8).addScaledVector(UP, 2.05);
      tmp2.copy(p0).addScaledVector(head, 3.0).addScaledVector(tmp3, 0.35).addScaledVector(UP, 0.55);
      outPos.lerp(tmp, pre);
      outLook.lerp(tmp2, pre);
    }
    // landing: pull back to show Abu Dhabi, the pad and the hangar
    const end = smooth(LEGS - 0.42, LEGS, uu);
    if (end > 0) {
      const p7 = route.points[LEGS];
      tmp.set(p7.x - 5.5, p7.y + 9.5, p7.z - 8.5);
      tmp2.set(p7.x + 2.6, p7.y + 0.2, p7.z + 1.8);
      outPos.lerp(tmp, end);
      outLook.lerp(tmp2, end);
    }
  }

  // ---------- sizing ----------
  let W = 1,
    H = 1;
  function resize() {
    const r = j.stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 62 : 48;
    // point size in pixels for a 1-unit dot at distance 1
    if (dotMat) {
      dotMat.uniforms.scale.value = (H * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      dotMat.uniforms.maxSize.value = 7 * dpr;
    }
    applyViewOffset();
    j.wake();
  }
  let viewS = { sx: 0, sy: 0 };
  function applyViewOffset() {
    const lay = j.layout();
    const e = smooth(LEGS - 0.4, LEGS, uS);
    const pre = 1 - smooth(0, 0.3, uS);
    const sx = mix(lay.sx, lay.sxEnd, e),
      sy = mix(mix(lay.sy, lay.syEnd, e), lay.syPre, pre);
    if (Math.abs(sx - viewS.sx) < 1e-4 && Math.abs(sy - viewS.sy) < 1e-4 && camera.view) return;
    viewS = { sx, sy };
    camera.setViewOffset(W, H, -sx * W, sy * H, W, H);
    camera.updateProjectionMatrix();
  }

  // ---------- simulation ----------
  let shownWp = -1,
    targetWp = -1,
    rmTimer = 0;
  function simulate(dt: number) {
    const uT = j.u;
    if (j.reduced) {
      // leg to leg, no flying: sit at the nearest waypoint, cross-fade between them
      const k = Math.min(LEGS, Math.max(0, Math.round(uT)));
      if (k !== targetWp) {
        targetWp = k;
        if (shownWp < 0) shownWp = k;
        else {
          canvas.style.opacity = "0";
          clearTimeout(rmTimer);
          rmTimer = window.setTimeout(() => {
            shownWp = targetWp;
            camInit = false;
            wake();
            requestAnimationFrame(() => (canvas.style.opacity = ""));
          }, 150);
        }
      }
      const k2 = shownWp;
      uS = k2;
      L = route.wp[k2];
      ox = oy = 0;
    } else {
      [uS, uV] = spring(uS, uV, uT, 13, dt);
      [L, Lv] = spring(L, Lv, route.lengthAt(uT), 13, dt);
    }
    const env = smooth(0.02, 0.3, uS) * (1 - smooth(LEGS - 0.35, LEGS - 0.02, uS));
    // steering: the visitor's hand, or the autopilot back onto the dotted line
    const manual = j.steer.active;
    if (manual || uT !== lastU) {
      lastInput = performance.now();
      lastU = uT;
    }
    // between the Abu Dhabi towers the corridor narrows
    const avenue = smooth(5.25, 5.6, uT) * (1 - smooth(6.35, 6.7, uT));
    const tx = manual ? j.steer.x * 3.1 * (1 - 0.65 * avenue) : 0;
    const ty = manual ? j.steer.y * 1.5 : 0;
    if (!j.reduced) {
      [ox, oxv] = spring(ox, oxv, tx * env, manual ? 5.5 : 2.4, dt);
      [oy, oyv] = spring(oy, oyv, ty * env, manual ? 5.5 : 2.4, dt);
    }

    frameAt(L, base, T);
    tmp.set(T.x, 0, T.z);
    if (tmp.lengthSq() > 0.04) {
      tmp.normalize();
      camHead.lerp(tmp, 1 - Math.exp(-dt * 5)).normalize();
    }
    right.crossVectors(camHead, UP).normalize();
    prev.copy(pos);
    pos.copy(base).addScaledVector(right, ox).addScaledVector(UP, oy);
    // a gentle hover bob when airborne
    const airborne = env > 0.02;
    if (airborne && !j.reduced) pos.y += Math.sin(time * 2.1) * 0.05 * env;
    // never below the ground
    const g = groundAt(pos.x, pos.z);
    if (g !== null && airborne && pos.y < g + 1.0) pos.y = mix(pos.y, g + 1.0, 0.6);

    // ring passes (forward only)
    if (!j.reduced) {
      for (let k = 1; k < LEGS; k++) {
        const w = route.wp[k];
        if (!logged[k] && L >= w - 0.05 && prevL < w - 0.05 + 1e-6) {
          const clean = Math.hypot(ox, oy) < RING_R * 0.8;
          logged[k] = true;
          rings[k].geometry = ringDone;
          flash.position.copy(rings[k].position);
          flash.quaternion.copy(rings[k].quaternion);
          flashT = 0;
          flash.visible = true;
          j.onRing(k, clean);
        }
      }
    } else {
      for (let k = 1; k < LEGS; k++) if (!logged[k] && uS >= k) {
        logged[k] = true;
        rings[k].geometry = ringDone;
      }
    }
    prevL = L;

    // attitude from the motion: tilt along the acceleration, like a real quadcopter
    const vel = tmp.subVectors(pos, prev).divideScalar(Math.max(dt, 1e-3));
    if (j.reduced || dt === 0) vel.set(0, 0, 0);
    velS.lerp(vel, 1 - Math.exp(-dt * 10));
    const acc = tmp2.subVectors(velS, velPrev).divideScalar(Math.max(dt, 1e-3));
    velPrev.copy(velS);
    accS.lerp(acc, 1 - Math.exp(-dt * 7));
    const thrust = tmp3.copy(accS).addScaledVector(velS, 0.16);
    thrust.y += 9.8;
    if (!airborne || j.reduced) thrust.set(0, 1, 0);
    thrust.normalize();
    const tilt = Math.acos(Math.min(1, thrust.y));
    const maxTilt = 0.62;
    if (tilt > maxTilt) {
      const hz = Math.hypot(thrust.x, thrust.z);
      thrust.set((thrust.x / hz) * Math.sin(maxTilt), Math.cos(maxTilt), (thrust.z / hz) * Math.sin(maxTilt));
    }
    // heading follows the route (and the velocity when there is some)
    const hv = Math.hypot(velS.x, velS.z);
    if (hv > 1.2 && airborne) tmp.set(velS.x, 0, velS.z).normalize();
    else tmp.copy(camHead);
    if (uS < 0.02) tmp.copy(head);
    droneFwd.lerp(tmp, j.reduced ? 1 : 1 - Math.exp(-dt * 6)).normalize();
    const zAxis = tmp2.copy(droneFwd).negate();
    zAxis.addScaledVector(thrust, -zAxis.dot(thrust)).normalize();
    xAxis.crossVectors(thrust, zAxis);
    m4.makeBasis(xAxis, thrust, zAxis);
    qT.setFromRotationMatrix(m4);
    if (!camInit || j.reduced) q.copy(qT);
    else q.slerp(qT, 1 - Math.exp(-dt * 12));
    drone.group.position.copy(pos);
    drone.body.quaternion.copy(q);

    // propellers: off on the pads, spooling up as soon as you throttle
    const rpmT = airborne || (uT > 0.002 && uT < LEGS - 0.002) ? 0.82 + Math.min(0.18, accS.length() * 0.01) : 0;
    rpm += (rpmT - rpm) * (1 - Math.exp(-dt * (rpmT > rpm ? 3.5 : 1.6)));
    if (j.reduced) rpm = rpmT;
    if (rpm < 0.004) rpm = 0;
    propA += (j.reduced ? 0 : rpm * 55 * dt);
    const discOp = smooth(0.3, 0.65, rpm);
    drone.discMat.opacity = discOp * 0.95;
    drone.disc.rotation = propA * 0.11;
    drone.props.forEach((p, i) => {
      p.rotation.y = (i % 3 === 0 ? 1 : -1) * propA + i;
      drone.blades[i].visible = discOp < 0.85;
    });

    // the swarm
    const join = smooth(4.5, 4.95, uS);
    const park = smooth(6.45, 6.97, uS);
    let wingsMoving = false;
    if (join <= 0.001) {
      wings.visible = false;
      wingsInit = false;
    } else {
      wings.visible = true;
      wR.crossVectors(droneFwd, UP).normalize();
      const spread = (1 + 2.5 * (1 - join)) * (1 - 0.3 * avenue);
      for (let i = 0; i < WING; i++) {
        const [a, b2, c] = W_OFF[i];
        const wander = j.reduced ? 0 : (1 - park) * 0.18;
        wT.copy(pos)
          .addScaledVector(wR, a * spread + Math.sin(time * 1.3 + i * 1.7) * wander)
          .addScaledVector(UP, b2 + (1 - join) * 3 + Math.sin(time * 1.7 + i) * wander)
          .addScaledVector(droneFwd, -c * spread);
        wT.lerp(apron[i], park);
        if (!wingsInit || j.reduced || !camInit) wPos[i].snap(wT);
        else wPos[i].step(wT, W_K[i] * (1 + park), dt);
        if (park > 0 && wPos[i].v.lengthSq() > 1e-5) wingsMoving = true; // settling onto the apron
        wq.copy(q).slerp(qPark, park);
        wS.setScalar(0.85 * join * drone.group.scale.x);
        m4.compose(wPos[i].x, wq, wS);
        wings.setMatrixAt(i, m4);
      }
      wingsInit = true;
      wings.instanceMatrix.needsUpdate = true;
    }

    // soft shadow on whatever island is below
    if (g !== null) {
      const hgt = Math.max(0, pos.y - g);
      shadow.visible = true;
      shadow.position.set(pos.x, g + 0.04, pos.z);
      shadow.scale.setScalar(1.3 + hgt * 0.12);
      (shadow.material as MeshBasicMaterial).opacity = Math.max(0.12, 0.85 - hgt * 0.09);
    } else shadow.visible = false;

    // camera
    const f = uS - Math.floor(uS);
    const d = 1 - smooth(0.0, 0.3, Math.min(f, 1 - f));
    cameraTarget(tmp, tmp2, d, uS);
    if (!camInit || j.reduced) {
      camPos.snap(tmp);
      camLook.snap(tmp2);
      camInit = true;
    } else {
      camPos.step(tmp, 9, dt);
      camLook.step(tmp2, 12, dt);
    }
    camera.position.copy(camPos.x);
    // bank the camera a touch with the drone
    const roll = j.reduced ? 0 : Math.max(-0.12, Math.min(0.12, -accS.dot(right) * 0.004));
    camera.up.set(0, 1, 0).addScaledVector(right, roll).normalize();
    camera.lookAt(camLook.x);
    sky.position.copy(camera.position);
    applyViewOffset();

    // the sun's shadow box follows the drone
    sun.target.position.set(Math.round(pos.x), Math.round(pos.y) - 2, Math.round(pos.z));
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 70);

    // ring flash + the next ring breathing
    if (flashT < 1) {
      flashT = Math.min(1, flashT + dt / 0.6);
      flash.scale.setScalar(1 + flashT * 1.1);
      flashMat.opacity = (1 - flashT) * 0.9;
      if (flashT >= 1) flash.visible = false;
    }
    const next = Math.min(LEGS - 1, Math.max(1, Math.floor(uS) + 1));
    for (let k = 1; k < LEGS; k++) rings[k].scale.setScalar(k === next && !logged[k] && !j.reduced ? 1 + Math.sin(time * 4) * 0.04 : 1);

    falls.mat.uniforms.time.value = time;

    // instruments (1 unit ≈ 1 m)
    telAcc += dt;
    if (telAcc > 0.12) {
      telAcc = 0;
      const below = g ?? -30;
      j.telemetry(pos.y - below, hv * 3.6);
    }

    return {
      moving:
        Math.abs(L - route.lengthAt(uT)) > 0.002 ||
        Math.abs(Lv) > 0.002 ||
        Math.abs(oxv) + Math.abs(oyv) > 0.002 ||
        camPos.v.lengthSq() > 1e-6 ||
        flashT < 1 ||
        wingsMoving ||
        Math.abs(rpm - rpmT) > 0.003,
      airborne: rpm > 0,
    };
  }

  // ---------- loop: render on demand ----------
  let running = false,
    last = 0,
    visible = true,
    onScreen = true,
    frame = 0,
    slowFrames = 0;
  const perf = { cpu: 0, sim: 0, frames: 0, calls: 0, tris: 0, dpr, hist: [] as number[] };
  let perfEl: HTMLElement | null = null;
  if (perfOn) {
    perfEl = document.createElement("div");
    perfEl.className = "perf";
    document.body.appendChild(perfEl);
  }
  (window as unknown as { __flight: object }).__flight = {
    perf,
    renderer,
    debug: () => ({ ox: +ox.toFixed(2), oy: +oy.toFixed(2), u: +uS.toFixed(3), steer: { ...j.steer } }),
  };

  function tick(now: number) {
    if (!visible || !onScreen) {
      running = false;
      return;
    }
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, Math.max(0, raw));
    last = now;
    const t0 = performance.now();
    time += dt;
    const st = simulate(dt);
    perf.sim = perf.sim * 0.95 + (performance.now() - t0) * 0.05;
    const idle = st.airborne && !st.moving && performance.now() - lastInput > 2500;
    // hovering with nothing to do: 30 fps is plenty for spinning props
    frame++;
    if (!idle || frame % 2 === 0 || j.reduced) renderer.render(scene, camera);
    const cpu = performance.now() - t0;
    perf.cpu = perf.cpu * 0.95 + cpu * 0.05;
    if (perfOn && perf.hist.length < 4000) perf.hist.push(cpu);
    perf.frames++;
    perf.calls = renderer.info.render.calls;
    perf.tris = renderer.info.render.triangles;
    if (perfEl && perf.frames % 10 === 0)
      perfEl.textContent = `cpu ${perf.cpu.toFixed(2)} ms/frame (sim ${perf.sim.toFixed(2)})\ncalls ${perf.calls} · tris ${(perf.tris / 1000).toFixed(1)}k\ndpr ${dpr} · ${Math.round(1 / Math.max(raw, 1e-3))} fps`;
    // adaptive resolution: if frames keep running long, drop the pixel ratio a notch
    if (!auto && raw > 0.026 && raw < 0.2) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      perf.dpr = dpr;
      renderer.setPixelRatio(dpr);
      slowFrames = 0;
    }
    // on a pad, or hovering untouched for a while (blur discs look the same frozen): sleep
    if (!j.reduced && !st.moving && (!st.airborne || performance.now() - lastInput > 7000)) {
      running = false;
      return;
    }
    if (j.reduced && !st.moving) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
  }
  function wake() {
    if (running || !visible || !onScreen) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }

  document.addEventListener("visibilitychange", () => {
    visible = document.visibilityState === "visible";
    if (visible) wake();
  });
  new IntersectionObserver((e) => {
    onScreen = e[0].isIntersecting;
    if (onScreen) wake();
  }).observe(j.stage);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    running = false;
  });
  canvas.addEventListener("webglcontextrestored", () => wake());

  addEventListener("resize", resize);
  resize();
  j.wake = wake;
  j.flightOn = true;
  // first frame, then fade the canvas in over the CSS sky
  last = performance.now();
  simulate(0);
  renderer.render(scene, camera);
  requestAnimationFrame(() => document.documentElement.classList.add("gl-ready"));
  wake();
}
