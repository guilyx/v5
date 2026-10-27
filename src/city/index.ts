import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { LAST_STOP, lookAt } from "../sky";
import { STOP_PLACE, placeById, type Place } from "../content";
import { SPECS, type Actor, type Spec } from "./landmarks";
import { buildWorld, type Plot } from "./world";
import { Kit } from "./kit";
import { U, buildMaterials, toyMaterial } from "./materials";
import { DISTRICTS, TOP_Y } from "./layout";

export interface CityOptions {
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  reduced: boolean;
  onPick(id: string): void;
}

export interface City {
  setProgress(c: number): void;
  focus(id: string | null): void;
  highlight(id: string | null): void;
  turn(dir: number): void;
  setVisible(v: boolean): void;
  /** where a place is on screen (for tests and the perf overlay) */
  screenOf(id: string): [number, number] | null;
  stats(): { calls: number; triangles: number; cpuMs: number; stepMs: number; fps: number; dpr: number; frames: number; shadowRenders: number };
}

interface Landmark {
  spec: Spec;
  place: Place;
  group: Group;
  uBuild: { value: number };
  total: number;
  want: boolean;
  life?: Actor;
  lifeGroup: Group;
  lifeShown: boolean;
  lift: number;
  liftTo: number;
  theta: number;
  baseY: number;
  height: number;
  proxy: Mesh;
  pool: number;
  poolOn: boolean;
}

interface Shot {
  x: number;
  y: number;
  z: number;
  r: number;
  az: number;
  el: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

export function startCity(opts: CityOptions): City {
  const { canvas, labels, reduced } = opts;
  const mobile = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  const maxDpr = mobile ? 1.5 : 2;
  let dpr = Math.min(devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new Scene();
  const camera = new PerspectiveCamera(18, 1, 2, 700);

  /* light: a soft sky and one sun that crosses the day */
  const hemi = new HemisphereLight("#ffffff", "#cccccc", 1.4);
  scene.add(hemi);
  const sun = new DirectionalLight("#ffffff", 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -13.5;
  sc.right = 13.5;
  sc.top = 13.5;
  sc.bottom = -13.5;
  sc.near = 5;
  sc.far = 95;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  sun.shadow.intensity = 0.62;
  scene.add(sun);
  scene.add(sun.target);

  const toy = toyMaterial();

  /* landmarks */
  const lms: Landmark[] = [];
  const keepOut: { x: number; z: number; r: number }[] = [];
  const poolSpots: { x: number; z: number; r: number; y: number }[] = [];
  const plots: Plot[] = [];
  SPECS.forEach((spec, i) => {
    const place = placeById.get(spec.id)!;
    const kit = new Kit(true);
    spec.build(kit);
    const total = kit.maxDelay + 0.95;
    const geo = kit.build();
    const uBuild = { value: 0 };
    const { m, d } = buildMaterials(uBuild);
    const mesh = new Mesh(geo, m);
    mesh.customDepthMaterial = d;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const group = new Group();
    const baseY = spec.y ?? TOP_Y;
    group.position.set(spec.x, baseY, spec.z);
    const theta = Math.atan2(spec.x, spec.z);
    group.rotation.y = theta + (spec.turn ?? 0);
    group.add(mesh);
    const lifeGroup = new Group();
    lifeGroup.visible = false;
    group.add(lifeGroup);
    const life = spec.life?.(lifeGroup, toy);
    const bb = geo.boundingBox!;
    const size = bb.getSize(new Vector3());
    const center = bb.getCenter(new Vector3());
    const proxy = new Mesh(new BoxGeometry(size.x + 0.15, size.y + 0.15, size.z + 0.15));
    proxy.position.copy(center);
    proxy.visible = false;
    proxy.userData.lm = i;
    group.add(proxy);
    scene.add(group);
    keepOut.push({ x: spec.x, z: spec.z, r: spec.r });
    const fx = spec.x + Math.sin(group.rotation.y) * spec.r * 0.75;
    const fz = spec.z + Math.cos(group.rotation.y) * spec.r * 0.75;
    poolSpots.push({ x: fx, z: fz, r: spec.r * 1.15, y: baseY });
    plots.push({ x: spec.x, z: spec.z, y: baseY, w: spec.plot[0], d: spec.plot[1], ry: group.rotation.y });
    lms.push({
      spec,
      place,
      group,
      uBuild,
      total,
      want: false,
      life,
      lifeGroup,
      lifeShown: false,
      lift: 0,
      liftTo: 0,
      theta,
      baseY,
      height: bb.max.y,
      proxy,
      pool: i,
      poolOn: true,
    });
  });
  const byId = new Map(lms.map((l) => [l.spec.id, l]));

  const world = buildWorld(toy, keepOut, poolSpots, plots);
  scene.add(world.group);

  /* camera shots for each stop on the journey */
  const shotFor = (l: Landmark): Shot => {
    const v = l.spec.view;
    const at = v.at ?? [l.spec.x, l.spec.z];
    return { x: at[0], y: l.baseY + v.up, z: at[1], r: v.r * 1.18, az: l.theta + (v.az ?? 0), el: v.el ?? 0.58 };
  };
  const overview = (az: number, el: number, r: number): Shot => ({ x: 0.2, y: 0.2, z: 0.3, r, az, el });
  const stops: Shot[] = STOP_PLACE.map((id, i) =>
    id ? shotFor(byId.get(id)!) : i === 0 ? overview(-0.95, 0.6, 12.1) : overview(-0.45, 0.66, 11.1),
  );
  // unwrap azimuths so each glide takes the short way round
  for (let i = 1; i < stops.length; i++) {
    while (stops[i].az - stops[i - 1].az > Math.PI) stops[i].az -= TAU;
    while (stops[i].az - stops[i - 1].az < -Math.PI) stops[i].az += TAU;
  }

  /* composition: on wide screens the city sits right of the text column; on phones, above the card */
  let W = 1;
  let H = 1;
  let wide = true;
  let cx = 0.64;
  let cy = 0.5;
  const tanHalf = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  function resize() {
    W = innerWidth;
    H = innerHeight;
    wide = W / H > 1.05 && W > 760;
    cx = wide ? 0.665 : 0.5;
    cy = wide ? 0.5 : 0.34;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, -(cx - 0.5) * W, -(cy - 0.5) * H, W, H);
    camera.updateProjectionMatrix();
    dirty = true;
    camMoved = true;
  }
  const distFor = (r: number) => {
    const availV = tanHalf * (wide ? 0.84 : 0.64);
    const availH = tanHalf * camera.aspect * (wide ? 2 * (1 - cx) * 0.93 : 0.94);
    return r / Math.min(availV, availH);
  };

  /* state */
  let progress = 0;
  let focusId: string | null = null;
  let focusMix = 0;
  let lastFocus: Shot | null = null;
  let hoverId: string | null = null;
  let legendId: string | null = null;
  let userAz = 0;
  let userEl = 0;
  let vAz = 0;
  let dragging = false;
  let lastInput = performance.now();
  let lastDrag = 0;
  let dirty = true;
  let camMoved = true;
  let visible = true;
  const cur: Shot = { ...stops[0] };
  let curDist = 0;
  let clock = 0;
  let lastLookC = -1;
  let shadowsDirty = true;
  let intro = reduced ? 1 : 0;

  function desiredShot(): Shot {
    const c = Math.min(Math.max(progress, 0), LAST_STOP);
    const i = Math.min(Math.floor(c), LAST_STOP - 1);
    const f = c - i;
    const g = smooth(0.2, 0.8, f);
    const a = stops[i];
    const b = stops[i + 1];
    const arc = Math.sin(Math.PI * g);
    const s: Shot = {
      x: lerp(a.x, b.x, g),
      y: lerp(a.y, b.y, g),
      z: lerp(a.z, b.z, g),
      r: lerp(a.r, b.r, g) * (1 + 0.32 * arc * (a.r < 6 && b.r < 6 ? 1 : 0.2)),
      az: lerp(a.az, b.az, g),
      el: lerp(a.el, b.el, g) + 0.06 * arc,
    };
    if (focusId || focusMix > 0.001) {
      const fl = focusId ? byId.get(focusId) : null;
      if (fl) lastFocus = shotFor(fl);
      if (lastFocus) {
        const k = smooth(0, 1, focusMix);
        let faz = lastFocus.az;
        while (faz - s.az > Math.PI) faz -= TAU;
        while (faz - s.az < -Math.PI) faz += TAU;
        s.x = lerp(s.x, lastFocus.x, k);
        s.y = lerp(s.y, lastFocus.y, k);
        s.z = lerp(s.z, lastFocus.z, k);
        s.r = lerp(s.r, lastFocus.r * 1.1, k);
        s.az = lerp(s.az, faz, k);
        s.el = lerp(s.el, lastFocus.el, k);
      }
    }
    // first appearance: the camera swoops in onto the table
    const e = 1 - Math.pow(1 - intro, 3);
    s.r *= 1 + 0.5 * (1 - e);
    s.az += userAz - 0.75 * (1 - e);
    s.el = Math.min(1.25, Math.max(0.22, s.el + userEl + 0.22 * (1 - e)));
    return s;
  }

  /* lights follow the time of day */
  const tmpC = new Color();
  const waterC = new Color();
  function applyLook() {
    const L = lookAt(progress);
    hemi.color.setRGB(...L.sky, SRGBColorSpace);
    hemi.groundColor.setRGB(...L.ground, SRGBColorSpace);
    // Lambert divides by π: these scale the keyframes into a bright, pastel range
    hemi.intensity = L.hemiI * 1.7;
    sun.color.setRGB(...L.sun, SRGBColorSpace);
    sun.intensity = L.sunI * 1.2;
    sun.position.set(Math.sin(L.az) * Math.cos(L.el), Math.sin(L.el), Math.cos(L.az) * Math.cos(L.el)).multiplyScalar(45);
    sun.shadow.intensity = lerp(0.62, 0.35, L.night);
    U.uNight.value = L.night;
    waterC.setRGB(...L.water, SRGBColorSpace);
    shadowsDirty = true;
    return L;
  }
  let look = applyLook();

  /* labels: district names at the island edge nearest the camera, and a hover tag */
  const districtEls = DISTRICTS.map((d) => {
    const el = document.createElement("div");
    el.className = "district";
    el.innerHTML = `<b>${d.name}</b><span>${d.country}</span>`;
    labels.appendChild(el);
    return el;
  });
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.setAttribute("role", "status");
  labels.appendChild(tag);
  let tagFor: string | null = null;
  const v3 = new Vector3();
  const camXZ = new Vector2();
  function project(x: number, y: number, z: number): [number, number, boolean] {
    v3.set(x, y, z).project(camera);
    return [(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H, v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1];
  }
  let shownDistricts = "";
  function updateLabels() {
    camXZ.set(camera.position.x, camera.position.z);
    const c = progress;
    const overviewMode = (c < 0.45 || c > 9.55) && !focusId;
    const focusPlace = focusId ? byId.get(focusId)?.spec.district : STOP_PLACE[Math.round(c)] ? byId.get(STOP_PLACE[Math.round(c)]!)!.spec.district : null;
    let key = "";
    DISTRICTS.forEach((d, i) => {
      const show = overviewMode || d.id === focusPlace;
      key += show ? "1" : "0";
      const dx = camXZ.x - d.x;
      const dz = camXZ.y - d.z;
      const len = Math.hypot(dx, dz) || 1;
      const [x, y, ok] = project(d.x + (dx / len) * d.r * 0.98, 0.5, d.z + (dz / len) * d.r * 0.98);
      districtEls[i].style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -30%)`;
      districtEls[i].classList.toggle("on", show && ok);
    });
    if (key !== shownDistricts) shownDistricts = key;
    const tid = hoverId ?? legendId;
    if (tid) {
      const l = byId.get(tid)!;
      const top = l.height + l.lift + 0.25;
      const [x, y] = project(l.group.position.x, l.baseY + top, l.group.position.z);
      tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      const key = tid + (hoverId && hoverId !== focusId ? "+" : "");
      if (tagFor !== key) {
        tagFor = key;
        tag.innerHTML = `<b>${l.place.name}</b><span>${l.place.where} · ${l.place.when}</span>${key.endsWith("+") ? "<i>Click to open</i>" : ""}`;
      }
      tag.classList.add("on");
    } else if (tagFor) {
      tagFor = null;
      tag.classList.remove("on");
    }
  }

  /* picking */
  const ray = new Raycaster();
  const ndc = new Vector2();
  let pointerFresh = false;
  let pointerInside = false;
  function pick(px: number, py: number): Landmark | null {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const proxies = lms.filter((l) => l.uBuild.value > l.total * 0.5).map((l) => l.proxy);
    const hit = ray.intersectObjects(proxies, false)[0];
    return hit ? lms[hit.object.userData.lm as number] : null;
  }
  let px = 0;
  let py = 0;
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let dragId = -1;
  let lastMoveT = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragId = e.pointerId;
    downX = px = e.clientX;
    downY = py = e.clientY;
    downT = performance.now();
    lastMoveT = downT;
    vAz = 0;
    dragging = false;
    lastInput = downT;
    if (e.pointerType === "mouse") canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    lastInput = performance.now();
    if (e.pointerType === "mouse") {
      pointerFresh = true;
      pointerInside = true;
    }
    if (e.pointerId === dragId) {
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
        dragging = true;
        canvas.classList.add("grabbing");
      }
      if (dragging) {
        const now = performance.now();
        const k = 5.2 / Math.max(W, 600);
        userAz -= dx * k;
        if (e.pointerType === "mouse") userEl = Math.min(0.5, Math.max(-0.3, userEl + dy * 0.0028));
        vAz = (-dx * k) / Math.max(0.008, (now - lastMoveT) / 1000);
        lastMoveT = now;
        lastDrag = now;
        camMoved = true;
        wake();
      }
    }
    px = e.clientX;
    py = e.clientY;
    wake();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = -1;
    canvas.classList.remove("grabbing");
    if (!dragging && performance.now() - downT < 600 && e.type === "pointerup") {
      const l = pick(e.clientX, e.clientY);
      if (l) opts.onPick(l.spec.id);
    }
    if (performance.now() - lastMoveT > 80) vAz = 0;
    dragging = false;
    wake();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => {
    pointerInside = false;
    pointerFresh = true;
    wake();
  });

  /* loop */
  let raf = 0;
  let last = performance.now();
  let frames = 0;
  let cpuAcc = 0;
  let cpuMs = 0;
  let stepAcc = 0;
  let stepMs = 0;
  let shadowRenders = 0;
  let fps = 0;
  let fpsT = performance.now();
  let fpsN = 0;
  let slowFrames = 0;
  let lastDprDrop = 0;
  let skip = false;
  let poolsDirty = true;

  function step(dt: number) {
    let busy = false;
    clock += dt;
    U.uTime.value = clock;
    const now = performance.now();

    if (Math.abs(progress - lastLookC) > 1e-4) {
      look = applyLook();
      lastLookC = progress;
      busy = true;
    }

    if (intro < 1) {
      intro = Math.min(1, intro + dt / 2.2);
      busy = true;
    }

    // focus blend
    const fTo = focusId ? 1 : 0;
    if (Math.abs(focusMix - fTo) > 1e-3) {
      focusMix = reduced ? fTo : focusMix + Math.sign(fTo - focusMix) * Math.min(Math.abs(fTo - focusMix), dt * 1.6);
      busy = true;
    }

    // turntable inertia, idle spin in the overviews, and a gentle return in the chapters
    if (!dragging && Math.abs(vAz) > 1e-4) {
      userAz += vAz * dt;
      vAz *= Math.exp(-dt * 4.5);
      busy = true;
    }
    const inOverview = progress < 0.35 || progress > 9.65;
    const idleFor = now - lastInput;
    if (!reduced && inOverview && !dragging && idleFor > 2500 && !focusId) {
      userAz += dt * 0.045;
      busy = true;
    }
    if (!inOverview && !dragging && now - lastDrag > 1600) {
      const home = Math.round(userAz / TAU) * TAU;
      if (Math.abs(userAz - home) > 1e-4 || Math.abs(userEl) > 1e-4) {
        const k = reduced ? 1 : 1 - Math.exp(-dt * 2.2);
        userAz += (home - userAz) * k;
        userEl += (0 - userEl) * k;
        busy = true;
      }
    }

    // camera: short smoothing only, so scrolling never feels late
    const want = desiredShot();
    const k = reduced ? 1 : 1 - Math.exp(-dt / 0.09);
    const prev = cur.x + cur.y + cur.z + cur.r + cur.az + cur.el;
    cur.x += (want.x - cur.x) * k;
    cur.y += (want.y - cur.y) * k;
    cur.z += (want.z - cur.z) * k;
    cur.r += (want.r - cur.r) * k;
    cur.az += (want.az - cur.az) * k;
    cur.el += (want.el - cur.el) * k;
    const moved = Math.abs(cur.x + cur.y + cur.z + cur.r + cur.az + cur.el - prev) > 1e-5;
    if (moved || camMoved) {
      curDist = distFor(cur.r);
      const ce = Math.cos(cur.el);
      camera.position.set(cur.x + Math.sin(cur.az) * ce * curDist, cur.y + Math.sin(cur.el) * curDist, cur.z + Math.cos(cur.az) * ce * curDist);
      camera.lookAt(cur.x, cur.y, cur.z);
      camera.updateMatrixWorld();
      busy = true;
    }

    // build / unbuild, hover lift
    for (const l of lms) {
      const ch = l.place.chapter;
      const on = (ch >= 10 ? progress > 9.55 : l.want ? progress >= ch - 0.6 : progress >= ch - 0.42) || focusId === l.spec.id;
      l.want = on;
      const u = l.uBuild.value;
      if (on && u < l.total) {
        l.uBuild.value = reduced ? l.total : Math.min(l.total, u + dt);
        busy = true;
        shadowsDirty = true;
      } else if (!on && u > 0) {
        l.uBuild.value = reduced ? 0 : Math.max(0, u - dt * 2.4);
        busy = true;
        shadowsDirty = true;
      }
      const built = l.uBuild.value >= l.total - 0.35;
      if (built !== l.lifeShown) {
        l.lifeShown = built;
        l.lifeGroup.visible = built;
        if (built && reduced) l.life?.update(4, 10, look.night);
        busy = true;
      }
      const poolOn = l.uBuild.value > l.total * 0.6;
      if (poolOn !== l.poolOn) {
        l.poolOn = poolOn;
        world.pools.setColorAt(l.pool, tmpC.setScalar(poolOn ? 1 : 0));
        poolsDirty = true;
      }
      l.liftTo = hoverId === l.spec.id || legendId === l.spec.id ? 0.1 : 0;
      if (Math.abs(l.lift - l.liftTo) > 1e-4) {
        l.lift += (l.liftTo - l.lift) * (reduced ? 1 : 1 - Math.exp(-dt * 16));
        l.group.position.y = l.baseY + l.lift;
        busy = true;
        shadowsDirty = true;
      }
      if (l.lifeShown && l.life && !reduced) l.life.update(clock, dt, look.night);
    }
    if (poolsDirty && world.pools.instanceColor) {
      world.pools.instanceColor.needsUpdate = true;
      poolsDirty = false;
    }
    if (reduced && busy) for (const l of lms) if (l.lifeShown) l.life?.update(4, 10, look.night);
    world.update(clock, dt, look.night, waterC, reduced);

    // hover
    if (pointerFresh && !dragging) {
      pointerFresh = false;
      const l = pointerInside ? pick(px, py) : null;
      const id = l ? l.spec.id : null;
      if (id !== hoverId) {
        hoverId = id;
        canvas.classList.toggle("pointing", !!id);
        busy = true;
      }
    }
    camMoved = false;
    return busy;
  }

  function frame(now: number) {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t0 = performance.now();
    const busy = step(dt) || dirty;
    const t1 = performance.now();
    const ambient = !reduced;
    const idle = !busy && now - lastInput > 8000;
    // ambient-only frames after a while without input run at half rate
    skip = idle ? !skip : false;
    if (busy || (ambient && !skip)) {
      if (shadowsDirty) {
        renderer.shadowMap.needsUpdate = true;
        shadowsDirty = false;
        shadowRenders++;
      }
      renderer.render(scene, camera);
      updateLabels();
      dirty = false;
      frames++;
      fpsN++;
      stepAcc += t1 - t0;
      cpuAcc += performance.now() - t0;
      if (frames % 30 === 0) {
        cpuMs = cpuAcc / 30;
        stepMs = stepAcc / 30;
        cpuAcc = 0;
        stepAcc = 0;
      }
      // adaptive resolution: step down if frames are consistently slow
      if (!idle && dt > 0.026) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 45 && dpr > 1 && now - lastDprDrop > 3000) {
        dpr = Math.max(1, dpr - 0.25);
        renderer.setPixelRatio(dpr);
        renderer.setSize(W, H, false);
        lastDprDrop = now;
        slowFrames = 0;
      }
    }
    if (now - fpsT > 1000) {
      fps = (fpsN * 1000) / (now - fpsT);
      fpsN = 0;
      fpsT = now;
    }
    if (ambient || busy) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!raf && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  addEventListener("resize", () => {
    resize();
    wake();
  });
  document.addEventListener("visibilitychange", wake);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    visible = false;
    document.documentElement.classList.add("no-webgl");
  });

  resize();
  // start the camera at the first stop, already in place
  Object.assign(cur, desiredShot());
  wake();
  requestAnimationFrame(() => canvas.classList.add("ready"));

  return {
    setProgress(c) {
      if (c !== progress) {
        progress = c;
        lastInput = performance.now();
        wake();
      }
    },
    focus(id) {
      focusId = id;
      if (id) {
        lastInput = performance.now();
        userEl = 0;
        vAz = 0;
        const home = Math.round(userAz / TAU) * TAU;
        userAz = home;
      }
      wake();
    },
    highlight(id) {
      legendId = id;
      lastInput = performance.now();
      wake();
    },
    turn(dir) {
      vAz = dir * 1.6;
      lastInput = performance.now();
      lastDrag = performance.now();
      wake();
    },
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      if (v) {
        dirty = true;
        wake();
      }
    },
    screenOf(id) {
      const l = byId.get(id);
      if (!l) return null;
      const [x, y] = project(l.group.position.x, l.baseY + l.height * 0.5, l.group.position.z);
      return [x, y];
    },
    stats() {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        cpuMs: Math.round(cpuMs * 100) / 100,
        stepMs: Math.round(stepMs * 100) / 100,
        fps: Math.round(fps),
        dpr,
        frames,
        shadowRenders,
      };
    },
  };
}
