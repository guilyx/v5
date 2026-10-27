import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Euler,
  Fog,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildFormations, type Formation, type StageName } from "./shapes";

/**
 * The swarm. One instanced mesh of small quadcopters. Scroll position picks
 * the two formations to blend between and how far along the blend is — no
 * easing on the scroll itself, so the drones answer the wheel immediately;
 * a stiff spring on each drone only rounds off the motion.
 */

const INK = new Color("#1c1c22");
const ACCENT = new Color("#ff5a1f");
const PAPER = new Color("#f3f0e8");
const FOV = 35;
const DIST = 100;
const VIEW_H = 2 * DIST * Math.tan(((FOV / 2) * Math.PI) / 180);

/** How much of its slot each formation fills. */
const FILL: Partial<Record<StageName, number>> = { murmur: 1.5, sphere: 0.92 };

interface Slot {
  x: number;
  y: number;
  /** tallest and widest a formation may be here, in world units */
  scale: number;
  width: number;
}
interface Stage {
  el: HTMLElement;
  name: StageName;
  center: number;
}

function droneGeometry() {
  const parts: BufferGeometry[] = [new BoxGeometry(0.56, 0.17, 0.56)];
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const arm = new BoxGeometry(1.2, 0.06, 0.08);
    arm.rotateY(a);
    parts.push(arm);
  }
  for (const [x, z] of [
    [0.42, 0.42],
    [-0.42, 0.42],
    [0.42, -0.42],
    [-0.42, -0.42],
  ]) {
    const r = new CylinderGeometry(0.24, 0.24, 0.03, 12);
    r.translate(x, 0.07, z);
    parts.push(r);
  }
  return mergeGeometries(parts)!;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function startSwarm(canvas: HTMLCanvasElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = innerWidth <= 900 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const N = small ? 640 : 1100;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(devicePixelRatio || 1, 2);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 1, 400);
  camera.position.set(0, 0, DIST);
  scene.add(new HemisphereLight(0xffffff, 0xe6ddcc, 2.1));
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 7, 8);
  scene.add(sun);
  scene.fog = new Fog(PAPER, DIST - 4, DIST + 40);

  const mesh = new InstancedMesh(droneGeometry(), new MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 }), N);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(N * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const forms = buildFormations(N);
  const stages: Stage[] = Array.from(document.querySelectorAll<HTMLElement>("[data-stage]")).map((el) => ({
    el,
    name: el.dataset.stage as StageName,
    center: 0,
  }));

  // per-drone personality: start delay, how it arcs between formations, its yaw
  const delay = new Float32Array(N);
  const arc = new Float32Array(N * 3);
  const yaw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delay[i] = (i / N) * 0.28 + Math.random() * 0.08;
    arc[i * 3] = (Math.random() - 0.5) * 0.3;
    arc[i * 3 + 1] = (Math.random() - 0.2) * 0.5;
    arc[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
    yaw[i] = Math.random() * Math.PI * 2;
  }

  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  let slotText: Slot = { x: 0, y: 0, scale: 1, width: 1 };
  let slotPark: Slot = { x: 0, y: 0, scale: 1, width: 1 };
  let droneSize = 1;
  let viewW = VIEW_H;
  let w = innerWidth;
  let h = innerHeight;

  /** Where formations go: beside the text on wide screens, above it on narrow ones. */
  const layout = () => {
    w = innerWidth;
    h = innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewW = VIEW_H * camera.aspect;
    const k = VIEW_H / h; // world units per css pixel
    const toWorld = (px: number, py: number, hPx: number, wPx: number): Slot => ({
      x: (px / w - 0.5) * viewW,
      y: (0.5 - py / h) * VIEW_H,
      scale: hPx * k,
      width: wPx * k,
    });
    const text = document.querySelector<HTMLElement>(".chapter .col-text");
    const gutter = Math.max(20, Math.min(64, w * 0.05));
    if (w > 900 && text) {
      const left = text.getBoundingClientRect().right + 48;
      const right = w - gutter;
      slotText = toWorld((left + right) / 2, h * 0.5, Math.min(h * 0.6, 620), (right - left) * 0.92);
    } else {
      const top = 76;
      const bottom = h * 0.44;
      slotText = toWorld(w / 2, (top + bottom) / 2 + 6, bottom - top - 16, (w - gutter * 2) * 0.95);
    }
    slotPark = { ...slotText, y: VIEW_H * 0.5 + slotText.scale * 0.6 };
    droneSize = slotText.scale * (w > 900 ? 0.018 : 0.019);
    for (const s of stages) {
      const r = s.el.getBoundingClientRect();
      s.center = r.top + scrollY + Math.min(r.height, h) / 2;
    }
  };

  const slotOf = (name: StageName) => (name === "park" ? slotPark : slotText);

  // pointer, projected onto the formation plane
  const mouse = { x: 1e6, y: 1e6 };
  addEventListener("pointermove", (e) => {
    mouse.x = (e.clientX / w - 0.5) * viewW;
    mouse.y = (0.5 - e.clientY / h) * VIEW_H;
  });
  document.addEventListener("pointerleave", () => (mouse.x = mouse.y = 1e6));

  /** A formation's drone i at time t, in world space. */
  const tmpA = new Float32Array(3);
  const tmpB = new Float32Array(3);
  const place = (f: Formation, name: StageName, i: number, t: number, out: Float32Array) => {
    const s = slotOf(name);
    const fill = FILL[name] ?? 1;
    const sc = name === "park" ? s.scale : Math.min(s.scale * fill, (s.width / f.aspect) * Math.min(1, fill));
    let x = f.pos[i * 3];
    let y = f.pos[i * 3 + 1];
    let z = f.pos[i * 3 + 2];
    if (name === "murmur") {
      // fold, twist and breathe: a murmuration, not a blob
      y += Math.sin(x * 3.1 + t * 0.9) * 0.15 + Math.sin(z * 4 - t * 0.7) * 0.05;
      const tw = x * 1.1 + Math.sin(t * 0.35) * 0.7;
      const c = Math.cos(tw);
      const sn = Math.sin(tw);
      const y2 = y * c - z * sn;
      z = y * sn + z * c;
      y = y2;
      x = x * (1 + 0.1 * Math.sin(t * 0.5 + y * 3)) + Math.sin(t * 0.3) * 0.06;
      x += Math.sin(t * 1.7 + i * 1.3) * 0.01;
      y += Math.cos(t * 1.3 + i * 0.7) * 0.01;
    } else if (name !== "park") {
      // a slow turn, so the formation reads as built from drones in space
      const a = name === "sphere" ? t * 0.35 : Math.sin(t * 0.3) * 0.22;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const x2 = x * c + z * sn;
      z = -x * sn + z * c;
      x = x2;
      y += Math.sin(t * 1.6 + i * 0.37) * 0.004;
    }
    out[0] = s.x + x * sc;
    out[1] = s.y + y * sc;
    out[2] = z * sc;
  };

  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const sv = new Vector3();
  const col = mesh.instanceColor.array as Float32Array;

  let time = 0;
  let last = performance.now();
  let slow = 0;
  let asleep = false;
  let first = true;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (!reduced) time += dt;

    // which two formations, and how far between them
    const focus = scrollY + h / 2;
    let a = 0;
    while (a < stages.length - 1 && focus >= stages[a + 1].center) a++;
    const b = Math.min(a + 1, stages.length - 1);
    const span = stages[b].center - stages[a].center;
    const t = span > 0 ? smooth(0.15, 0.85, (focus - stages[a].center) / span) : 0;
    const A = stages[a].name;
    const B = stages[b].name;

    // nothing to draw while the drones wait above the page
    const parked = A === "park" && (B === "park" || t === 0);
    if (parked && asleep) return;

    const cpu0 = performance.now();
    const fa = forms[A];
    const fb = forms[B];
    const repelR = VIEW_H * 0.1;
    let maxV = 0;
    for (let i = 0; i < N; i++) {
      place(fa, A, i, time, tmpA);
      place(fb, B, i, time, tmpB);
      const ti = ease(Math.min(1, Math.max(0, (t - delay[i]) / 0.64)));
      const lift = Math.sin(Math.PI * ti) * slotText.scale * (reduced ? 0 : 1);
      let tx = tmpA[0] + (tmpB[0] - tmpA[0]) * ti + arc[i * 3] * lift;
      let ty = tmpA[1] + (tmpB[1] - tmpA[1]) * ti + arc[i * 3 + 1] * lift;
      const tz = tmpA[2] + (tmpB[2] - tmpA[2]) * ti + arc[i * 3 + 2] * lift;

      if (!reduced) {
        const dx = tx - mouse.x;
        const dy = ty - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < repelR * repelR) {
          const d = Math.sqrt(d2) + 1e-4;
          const push = (1 - d / repelR) ** 2 * repelR * 0.9;
          tx += (dx / d) * push;
          ty += (dy / d) * push;
        }
      }

      const j = i * 3;
      if (reduced || first) {
        pos[j] = tx;
        pos[j + 1] = ty;
        pos[j + 2] = tz;
      } else {
        // stiff, slightly underdamped spring: answers fast, settles with a touch of life
        const k = 120;
        const c = 17;
        for (let ax = 0; ax < 3; ax++) {
          const target = ax === 0 ? tx : ax === 1 ? ty : tz;
          vel[j + ax] += ((target - pos[j + ax]) * k - vel[j + ax] * c) * dt;
          pos[j + ax] += vel[j + ax] * dt;
        }
      }
      const vx = vel[j];
      const vz = vel[j + 2];
      maxV = Math.max(maxV, Math.abs(vx) + Math.abs(vel[j + 1]) + Math.abs(vz));

      // bank into the direction of travel
      const bank = 0.035 / Math.max(0.2, droneSize);
      // tipped toward the camera so you see rotors, not a side-on sliver
      e.set(1 + Math.max(-0.5, Math.min(0.5, vz * bank)), yaw[i] + time * 0.2, Math.max(-0.5, Math.min(0.5, -vx * bank)), "XZY");
      q.setFromEuler(e);
      p.set(pos[j], pos[j + 1], pos[j + 2]);
      sv.setScalar(droneSize);
      m.compose(p, q, sv);
      m.toArray(mesh.instanceMatrix.array, i * 16);

      const ca = fa.accent[i] ? ACCENT : INK;
      const cb = fb.accent[i] ? ACCENT : INK;
      col[j] = ca.r + (cb.r - ca.r) * ti;
      col[j + 1] = ca.g + (cb.g - ca.g) * ti;
      col[j + 2] = ca.b + (cb.b - ca.b) * ti;
    }
    first = false;
    if (import.meta.env.DEV) (window as unknown as { __swarmCpu: number }).__swarmCpu = performance.now() - cpu0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;

    asleep = parked && maxV < 0.05;
    canvas.style.visibility = asleep ? "hidden" : "visible";
    renderer.render(scene, camera);

    // a slower GPU gets fewer pixels rather than dropped frames
    if (dt > 1 / 45) slow++;
    else slow = Math.max(0, slow - 1);
    if (slow > 60 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.5);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      slow = 0;
    }
  };

  layout();
  addEventListener("resize", layout);
  new ResizeObserver(() => layout()).observe(document.body);
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
    canvas.classList.add("ready");
  });
}
