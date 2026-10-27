import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { setAnisotropy } from "./kit";
import { buildDesk, buildRoom, STATION_X } from "./world";
import { LightRig, LIGHT_MODES, modeForHour, type LightMode } from "./light";
import { Rig } from "./rig";
import type { Prop } from "./props";
import type { Build } from "./objects/common";
import { buildCentrale, buildCoalescent, buildCoimbra, buildHero, buildHiventive, buildLead, buildSchool, buildSirb, buildTii, buildUnchained } from "./objects/journey";
import { buildAfter } from "./objects/after";
import { HandPanel } from "./hand";

/* The desk: one renderer, one scene, one soft sun. It only draws a frame when something
   changed (scroll, pointer, an object moving, a video frame), and sleeps otherwise. */

const YEARS: [string, number][] = [
  ["hero", 2014],
  ["school", 2014],
  ["hiventive", 2018],
  ["coimbra", 2019],
  ["centrale", 2020],
  ["coalescent", 2021],
  ["tii", 2022],
  ["lead", 2024],
  ["unchained", 2024.9],
  ["sirb", 2026],
  ["after", 2026.4],
];
const JUMPS: [number, string][] = [
  [2014, "school"],
  [2018, "hiventive"],
  [2019, "coimbra"],
  [2020, "centrale"],
  [2021, "coalescent"],
  [2022, "tii"],
  [2024, "lead"],
  [2026, "sirb"],
];

function yearAt(x: number) {
  if (x <= STATION_X.hero) return 2014;
  for (let i = 0; i < YEARS.length - 1; i++) {
    const [a, ya] = YEARS[i];
    const [b, yb] = YEARS[i + 1];
    const xa = STATION_X[a];
    const xb = STATION_X[b];
    if (x <= xb) return ya + ((x - xa) / (xb - xa)) * (yb - ya);
  }
  return YEARS[YEARS.length - 1][1];
}

interface Held {
  prop: Prop;
  k: number;
  target: 0 | 1;
}

export async function startDesk(canvas: HTMLCanvasElement) {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  const perf = params.has("perf") || import.meta.env.DEV;
  const small = Math.min(innerWidth, innerHeight) < 700 || matchMedia("(pointer: coarse)").matches;
  const dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, powerPreference: "high-performance", stencil: false });
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const avatar = await new Promise<HTMLImageElement | null>((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = "/avatar.webp";
  });

  /* ---------- the world ---------- */
  const tb = performance.now();
  buildDesk(scene, small);
  const room = buildRoom(scene);
  let raf = 0;
  const requestRender = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const b: Build = { scene, props: [], small, avatar, deco: [] };
  // build chapter by chapter, handing the main thread back in between so scrolling stays smooth
  let longest = 0;
  for (const build of [buildHero, buildSchool, buildHiventive, buildCoimbra, buildCentrale, buildCoalescent, buildTii, buildLead, buildUnchained, buildSirb]) {
    const t = performance.now();
    build(b);
    longest = Math.max(longest, performance.now() - t);
    await new Promise((r) => setTimeout(r, 0));
  }
  const after = buildAfter(b, requestRender, reduced);
  const buildMs = performance.now() - tb;
  const props = b.props;
  const byId = new Map(props.map((p) => [p.id, p]));
  const hits = props.map((p) => p.hit);
  const hitToProp = new Map(props.map((p) => [p.hit as THREE.Object3D, p]));

  /* ---------- light ---------- */
  const hourParam = params.get("light") as LightMode | null;
  const startMode: LightMode = hourParam && LIGHT_MODES.includes(hourParam) ? hourParam : modeForHour(new Date().getHours() + new Date().getMinutes() / 60);
  const light = new LightRig(scene, renderer, startMode, small);
  light.onLamp = (v) => {
    after.lamp(v);
    room.sky.color.copy(light.skyTint);
  };
  after.lamp(startMode === "evening" ? 1 : 0);
  room.sky.color.copy(light.skyTint);
  scene.background = light.background;
  scene.fog = new THREE.Fog(light.background, 70, 260);

  /* ---------- camera ---------- */
  const rig = new Rig();
  scene.add(rig.camera);
  const veilMat = new THREE.MeshBasicMaterial({ color: 0x1e140b, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), veilMat);
  veil.position.z = -13;
  veil.renderOrder = 10;
  veil.visible = false;
  rig.camera.add(veil);

  const measure = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    rig.measure(innerWidth, innerHeight);
    rig.poseAt(scrollY, rig.target);
    requestRender();
  };
  measure();
  Object.assign(rig.current, rig.target);
  rig.update(0, true);

  /* ---------- the DOM around it ---------- */
  const tag = document.querySelector<HTMLElement>(".tag")!;
  const tagName = tag.querySelector("b")!;
  const tagMeta = tag.querySelector("span")!;
  const ruler = document.querySelector<HTMLElement>(".ruler")!;
  const track = ruler.querySelector<HTMLElement>(".ruler-track")!;
  const cursor = ruler.querySelector<HTMLElement>(".ruler-cursor")!;
  const yearBtns: HTMLButtonElement[] = [];
  for (let y = 2014; y <= 2026; y++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(y);
    btn.setAttribute("aria-label", `Go to ${y}`);
    btn.addEventListener("click", () => {
      let st = "school";
      for (const [yy, s] of JUMPS) if (yy <= y) st = s;
      const a = rig.anchors.find((an) => an.station === st);
      if (a) window.scrollTo({ top: a.y, behavior: reduced ? "auto" : "smooth" });
    });
    track.append(btn);
    yearBtns.push(btn);
  }
  const lightBtn = document.querySelector<HTMLButtonElement>(".light-btn")!;
  const lightLabel = lightBtn.querySelector<HTMLElement>(".light-label")!;
  const syncLightBtn = () => {
    lightLabel.textContent = light.label();
    lightBtn.dataset.mode = light.mode;
    lightBtn.setAttribute("aria-label", `Light: ${light.label()}. Change the time of day`);
    lightBtn.title = "Change the time of day";
  };
  lightBtn.addEventListener("click", () => {
    const next = LIGHT_MODES[(LIGHT_MODES.indexOf(light.mode) + 1) % LIGHT_MODES.length];
    light.setMode(next, reduced);
    syncLightBtn();
    requestRender();
  });
  syncLightBtn();

  /* ---------- holding things ---------- */
  const held: Held[] = [];
  let holding: Prop | null = null;
  let holdScroll = 0;
  const viewer = document.querySelector<HTMLDialogElement>(".viewer");

  const hand = new HandPanel({
    close: () => putBack(),
    laptopStep: (d) => after.laptop.show(after.laptop.index + d),
    photoStep: (d) => {
      if (!holding || !holding.panel.startsWith("photo:")) return;
      const i = Number(holding.panel.split(":")[1]);
      const n = after.photos.length;
      pickUp(byId.get(`photo-${(i + d + n) % n}`)!, false);
    },
    openPhoto: (i) => {
      const link = document.querySelectorAll<HTMLAnchorElement>(".polaroids a[data-photo]")[i];
      link?.click();
    },
  });
  after.laptop.onChange = () => {
    if (holding?.id === "laptop") showPanel(holding, false);
  };
  const showPanel = (p: Prop, focus: boolean) =>
    hand.show(p.panel, p.name, { projects: after.laptop.projects, laptopIndex: after.laptop.index, photos: after.photos }, focus);

  function pickUp(p: Prop, focus: boolean) {
    if (holding === p) return;
    if (holding) release(holding);
    holding = p;
    holdScroll = scrollY;
    let h = held.find((x) => x.prop === p);
    if (!h) {
      h = { prop: p, k: 0, target: 1 };
      held.push(h);
    }
    h.target = 1;
    p.group.traverse((o) => (o.castShadow = false));
    if (p.panel.startsWith("photo:") || p.id === "photos") after.loadAtlas();
    if (p.id === "laptop") after.laptop.setActive(true);
    root.classList.add("holding");
    setHover(null);
    showPanel(p, focus);
    requestRender();
  }
  function release(p: Prop) {
    const h = held.find((x) => x.prop === p);
    if (h) h.target = 0;
  }
  function putBack() {
    if (!holding) return;
    release(holding);
    holding = null;
    root.classList.remove("holding");
    hand.hide();
    requestRender();
  }
  const pickById = (id: string, focus: boolean) => {
    const p = byId.get(id === "photos" ? "photo-11" : id);
    if (p) pickUp(p, focus);
  };
  document.querySelectorAll<HTMLButtonElement>(".pick[data-obj]").forEach((btn) =>
    btn.addEventListener("click", (e) => pickById(btn.dataset.obj!, (e as PointerEvent).pointerType === "" || e.detail === 0)),
  );
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && holding && !viewer?.open) {
      e.preventDefault();
      putBack();
    }
  });

  /* ---------- pointer: hover, click, drag ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerIn = false;
  let pointerDirty = false;
  let hovered: Prop | null = null;
  let down: { x: number; y: number; t: number; sx: number; camX: number; id: number } | null = null;
  let dragging = false;

  function setHover(p: Prop | null) {
    if (p === hovered) return;
    hovered = p;
    canvas.classList.toggle("hovering", !!p);
    if (p) {
      tagName.textContent = p.name;
      tagMeta.textContent = p.meta;
    }
    tag.classList.toggle("on", !!p);
    requestRender();
  }
  function pick(): Prop | null {
    ray.setFromCamera(ndc, rig.camera);
    const hit = ray.intersectObjects(hits, false)[0];
    return hit ? (hitToProp.get(hit.object) ?? null) : null;
  }
  const setNdc = (e: PointerEvent) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  };

  canvas.addEventListener("pointermove", (e) => {
    setNdc(e);
    pointerIn = true;
    if (e.pointerType === "mouse" && !reduced) rig.setPointer(ndc.x, ndc.y);
    if (down && down.id === e.pointerId) {
      const dx = e.clientX - down.x;
      if (!dragging && Math.abs(dx) > 7 && !holding) {
        dragging = true;
        canvas.classList.add("dragging");
        setHover(null);
      }
      if (dragging) {
        // drag the desk: move along it by as much desk as the pointer travelled
        const worldPerPx = (2 * rig.current.dist * Math.tan((rig.camera.fov * Math.PI) / 360)) / innerHeight;
        const x = down.camX - dx * worldPerPx;
        const lo = STATION_X.hero;
        const hi = STATION_X.after;
        window.scrollTo({ top: rig.scrollForX(Math.max(lo, Math.min(hi, x))), behavior: "instant" as ScrollBehavior });
      }
    }
    if (e.pointerType === "mouse") pointerDirty = true;
    requestRender();
  });
  canvas.addEventListener("pointerleave", () => {
    pointerIn = false;
    rig.setPointer(0, 0);
    setHover(null);
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    setNdc(e);
    down = { x: e.clientX, y: e.clientY, t: performance.now(), sx: scrollY, camX: rig.current.x, id: e.pointerId };
    dragging = false;
    if (e.pointerType === "mouse") canvas.setPointerCapture(e.pointerId);
  });
  const endPointer = (e: PointerEvent, cancelled: boolean) => {
    if (!down || down.id !== e.pointerId) return;
    const wasDrag = dragging;
    down = null;
    dragging = false;
    canvas.classList.remove("dragging");
    if (cancelled || wasDrag) return;
    setNdc(e);
    const p = pick();
    if (holding) {
      if (p === holding) holding.onHandClick?.();
      else if (p && p.panel.startsWith("photo:") && holding.panel.startsWith("photo:")) pickUp(p, false);
      else if (!p || p !== holding) putBack();
    } else if (p) pickUp(p, false);
  };
  canvas.addEventListener("pointerup", (e) => endPointer(e, false));
  canvas.addEventListener("pointercancel", (e) => endPointer(e, true));

  addEventListener(
    "scroll",
    () => {
      if (holding && Math.abs(scrollY - holdScroll) > 80) putBack();
      requestRender();
    },
    { passive: true },
  );
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(measure, 80);
    measure();
  });
  new ResizeObserver(() => measure()).observe(document.querySelector("main")!);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) after.laptop.setActive(false);
    else requestRender();
  });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    root.classList.add("desk-failed");
    root.classList.remove("desk-ready");
  });

  /* ---------- the frame ---------- */
  const qTmp = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const vTmp = new THREE.Vector3();
  const vHand = new THREE.Vector3();
  const vDesk = new THREE.Vector3();
  const qHand = new THREE.Quaternion();
  const qDesk = new THREE.Quaternion();
  const axX = new THREE.Vector3(1, 0, 0);
  const axY = new THREE.Vector3(0, 1, 0);
  const axZ = new THREE.Vector3(0, 0, 1);
  const stats = { logicMs: 0, renderMs: 0, maxLogicMs: 0, buildMs, longestBuildTaskMs: longest, calls: 0, triangles: 0, frames: 0, shadowUpdates: 0, textures: 0, geometries: 0 };
  if (perf)
    (window as unknown as { __desk: unknown }).__desk = {
      stats,
      /** where a prop sits on screen, for tests */
      where(id: string) {
        const p = byId.get(id);
        if (!p) return null;
        const v = p.center.clone().applyQuaternion(p.group.quaternion).multiplyScalar(p.group.scale.x).add(p.group.position).project(rig.camera);
        return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
      },
      scene,
      holding: () => holding?.id ?? null,
      pickAt(x: number, y: number) {
        ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
        return pick()?.id ?? null;
      },
    };
  let last = performance.now();
  let first = true;
  let atlasAsked = false;

  /** where the held object floats: beside the paper, filling part of the free space */
  function handPose(p: Prop, t: number, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const W = innerWidth;
    const H = innerHeight;
    let fx: number, fy: number, fw: number, fh: number;
    if (W < 860) {
      const r = hand.open ? hand.rect() : { top: H * 0.55 };
      fx = 0;
      fw = W;
      fy = 70;
      fh = Math.max(160, r.top - 12 - fy);
    } else {
      const r = hand.open ? hand.rect() : { right: 40 + Math.min(480, W * 0.36) };
      fx = r.right + 24;
      fw = W - fx - 24;
      fy = 70;
      fh = H - 100;
    }
    const cam = rig.camera;
    vTmp.set(((fx + fw / 2) / W) * 2 - 1, -((fy + fh / 2) / H) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const D = 9;
    pos.copy(cam.position).addScaledVector(vTmp, D);
    const pxPerUnit = H / (2 * D * Math.tan((cam.fov * Math.PI) / 360));
    const scale = Math.min(3.2, (0.5 * p.hand.fill * Math.min(fw, fh)) / pxPerUnit / p.radius);
    const sway = reduced ? 0 : Math.sin(t * 0.55) * 0.28;
    const bob = reduced ? 0 : Math.sin(t * 0.9) * 0.05;
    qTilt.setFromAxisAngle(axX, p.hand.tilt + bob);
    qYaw.setFromAxisAngle(axY, p.hand.yaw + sway);
    quat.copy(cam.quaternion).multiply(qTilt).multiply(qYaw);
    // put the object's own centre on that point
    pos.sub(vDesk.copy(p.center).multiplyScalar(scale).applyQuaternion(quat));
    return scale;
  }

  function frame(now: number) {
    raf = 0;
    const t0 = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    let busy = false;
    let shadow = false;

    // camera from scroll
    rig.poseAt(scrollY, rig.target);
    busy = rig.update(dt, reduced) || busy;
    const overview = rig.overview(scrollY);
    light.follow(rig.current.x, overview);

    // hover
    if (pointerDirty && pointerIn && !dragging) {
      pointerDirty = false;
      const p = pick();
      setHover(p && !holding ? p : null);
    }

    // springs and per-object animation
    const holdK = new Map(held.map((h) => [h.prop, h.k]));
    for (const p of props) {
      const target = p === hovered && !holding ? 1 : 0;
      if (reduced) {
        if (p.lift !== target) shadow = true;
        p.lift = target;
        p.liftV = 0;
      } else if (target !== p.lift || p.liftV !== 0) {
        const k = 240;
        const c = 2 * 0.52 * Math.sqrt(k);
        p.liftV += (k * (target - p.lift) - c * p.liftV) * dt;
        p.lift += p.liftV * dt;
        if (Math.abs(target - p.lift) < 0.0005 && Math.abs(p.liftV) < 0.0005) {
          p.lift = target;
          p.liftV = 0;
        } else busy = true;
        shadow = true;
      }
      const hk = holdK.get(p) ?? 0;
      if (!hk) {
        p.group.position.copy(p.basePos);
        p.group.position.y += p.lift * p.liftHeight;
        p.group.quaternion.copy(p.baseQuat).multiply(qTmp.setFromAxisAngle(axZ, p.lift * 0.03));
        p.group.scale.setScalar(p.baseScale);
      }
      if (p.blob) {
        const m = p.blob.material as THREE.MeshBasicMaterial;
        m.opacity = p.blobOpacity * (1 - 0.5 * Math.min(1, p.lift) - 0.9 * hk);
      }
      if (p.tick && p.tick(t, dt, { hover: p === hovered, held: p === holding, hold: hk, reduced })) {
        busy = true;
        shadow = true;
      }
    }

    // things in (or on their way to, or back from) your hand
    for (let i = held.length - 1; i >= 0; i--) {
      const h = held[i];
      const p = h.prop;
      const speed = reduced ? 100 : 1 / 0.62;
      h.k = h.target ? Math.min(1, h.k + dt * speed) : Math.max(0, h.k - dt * speed);
      const e = h.k < 0.5 ? 4 * h.k * h.k * h.k : 1 - Math.pow(-2 * h.k + 2, 3) / 2;
      const scale = handPose(p, t, vHand, qHand);
      vDesk.copy(p.basePos);
      vDesk.y += p.lift * p.liftHeight;
      qDesk.copy(p.baseQuat);
      p.group.position.lerpVectors(vDesk, vHand, e);
      p.group.position.y += Math.sin(Math.PI * e) * 1.2;
      p.group.quaternion.slerpQuaternions(qDesk, qHand, e);
      p.group.scale.setScalar(p.baseScale + (scale - p.baseScale) * e);
      // in hand it sways gently (frames needed); with reduced motion it rests, and the loop can sleep
      if (!(reduced && h.k === 1 && h.target === 1)) busy = true;
      if (h.k > 0 && h.k < 1) shadow = true;
      if (h.k === 0 && h.target === 0) {
        held.splice(i, 1);
        p.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m !== p.hit) o.castShadow = true;
        });
        if (p.id === "laptop") after.laptop.setActive(false);
        shadow = true;
      }
    }
    const veilK = held.reduce((m, h) => Math.max(m, h.target ? h.k : h.k * 0.9), 0);
    veilMat.opacity = 0.42 * veilK;
    veil.visible = veilK > 0.001;

    // light
    if (light.update(dt)) busy = true;
    if (light.dirty) {
      shadow = true;
      light.dirty = false;
      (scene.fog as THREE.Fog).color.copy(light.background);
    }

    // the laptop plays while it's in view
    const nearLaptop = !overview && Math.abs(rig.current.x - STATION_X.after) < 9;
    after.laptop.setActive(nearLaptop || holding?.id === "laptop");
    if (!atlasAsked && (rig.current.x > STATION_X.sirb - 4 || overview)) {
      atlasAsked = true;
      after.loadAtlas();
    }

    // DOM: hover tag, ruler
    if (hovered) {
      vTmp.set(0, hovered.top * hovered.group.scale.y + 0.45, 0);
      vTmp.add(hovered.center.clone().setY(0)).applyQuaternion(hovered.group.quaternion).add(hovered.group.position);
      vTmp.project(rig.camera);
      const x = (vTmp.x * 0.5 + 0.5) * innerWidth;
      const y = (-vTmp.y * 0.5 + 0.5) * innerHeight;
      tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 10px))`;
    }
    const year = yearAt(rig.current.x);
    const frac = Math.max(0, Math.min(1, (year - 2014) / 12));
    cursor.style.transform = `translateX(${(frac * track.clientWidth).toFixed(1)}px)`;
    const cy = Math.min(2026, Math.floor(year + 0.02));
    yearBtns.forEach((btn, i) => (2014 + i === cy ? btn.setAttribute("aria-current", "true") : btn.removeAttribute("aria-current")));
    ruler.hidden = overview || first || rig.current.x < STATION_X.school * 0.45;

    if (shadow || first) {
      renderer.shadowMap.needsUpdate = true;
      stats.shadowUpdates++;
    }
    const t1 = performance.now();
    renderer.render(scene, rig.camera);
    const t2 = performance.now();

    if (first) {
      first = false;
      root.classList.add("desk-ready");
      lightBtn.hidden = false;
      requestRender();
    }
    if (busy) requestRender();

    stats.frames++;
    stats.logicMs = stats.logicMs * 0.9 + (t1 - t0) * 0.1;
    stats.renderMs = stats.renderMs * 0.9 + (t2 - t1) * 0.1;
    stats.maxLogicMs = Math.max(stats.maxLogicMs, t1 - t0);
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    stats.textures = renderer.info.memory.textures;
    stats.geometries = renderer.info.memory.geometries;
  }

  // compile every material before the first frame, so scrolling never stalls on a shader
  await renderer.compileAsync(scene, rig.camera).catch(() => {});
  requestRender();
}
