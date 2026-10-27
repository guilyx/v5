import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { MeshLambertMaterial } from "three";
import { Builder, blob, lin, mat, rng } from "./geo";
import type { Fall } from "./islands";

export const SKY = {
  top: new Color("#6aaae6"),
  mid: new Color("#a9d3f4"),
  horizon: new Color("#fcefe2"),
  below: new Color("#eaf0f6"),
  sun: new Color("#fff1d6"),
};

export const SUN_DIR = new Vector3(-0.55, 0.62, -0.56).normalize();

export function buildSkyDome() {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      top: { value: SKY.top },
      mid: { value: SKY.mid },
      horizon: { value: SKY.horizon },
      below: { value: SKY.below },
      sunCol: { value: SKY.sun },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, mid, horizon, below, sunCol, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.2, y));
        c = mix(c, top, smoothstep(0.2, 0.8, y));
        c = mix(c, below, smoothstep(0.0, -0.3, y));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 900.0) * 1.4 + pow(s, 40.0) * 0.16 + pow(s, 5.0) * 0.07);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new Mesh(new SphereGeometry(400, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** One soft cumulus puff, drawn once on a canvas. Red = light, alpha = shape. */
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const r = rng(9);
  const blobs: [number, number, number][] = [];
  for (let k = 0; k < 14; k++) {
    const x = 50 + r() * 156;
    const rad = 22 + r() * 26 * (1 - Math.abs(x - 128) / 160);
    blobs.push([x, 84 - rad * 0.55 - r() * 10, rad]);
  }
  for (let k = 0; k < 6; k++) blobs.push([64 + k * 26, 92, 20]);
  for (const [x, y, rad] of blobs) {
    const grd = g.createRadialGradient(x, y - rad * 0.3, rad * 0.1, x, y, rad);
    grd.addColorStop(0, "rgba(255,0,0,1)");
    grd.addColorStop(0.62, "rgba(235,0,0,1)");
    grd.addColorStop(0.86, "rgba(200,0,0,0.75)");
    grd.addColorStop(1, "rgba(180,0,0,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // flatten and shade the base
  const fade = g.createLinearGradient(0, 70, 0, 112);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = fade;
  g.fillRect(0, 96, 256, 32);
  return new CanvasTexture(c);
}

/** The soft cloud sea far below the islands: instanced camera-facing billboards. */
export function buildClouds() {
  const r = rng(77);
  const offs: number[] = [];
  const scl: number[] = [];
  const shade: number[] = [];
  // the cloud sea far below
  for (let k = 0; k < 56; k++) {
    const x = -120 + r() * 340,
      z = -160 + r() * 330;
    const w = 46 + r() * 40;
    offs.push(x, -34 - r() * 6, z);
    scl.push(w, w * 0.42);
    shade.push(0.94 + r() * 0.06);
  }
  const base = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setAttribute("offset", new InstancedBufferAttribute(new Float32Array(offs), 3));
  geo.setAttribute("scale", new InstancedBufferAttribute(new Float32Array(scl), 2));
  geo.setAttribute("shade", new InstancedBufferAttribute(new Float32Array(shade), 1));
  geo.instanceCount = shade.length;
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: puffTexture() },
      lit: { value: new Color("#ffffff") },
      dim: { value: new Color("#e6edf7") },
      fogColor: { value: SKY.horizon },
      fogNear: { value: 70 },
      fogFar: { value: 300 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 offset;
      attribute vec2 scale;
      attribute float shade;
      varying vec2 vUv;
      varying float vFog;
      varying float vShade;
      uniform float fogNear, fogFar;
      void main() {
        vUv = uv;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(offset, 1.0);
        mv.xy += position.xy * scale;
        vFog = smoothstep(fogNear, fogFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 lit, dim, fogColor;
      varying vec2 vUv;
      varying float vFog;
      varying float vShade;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.02) discard;
        vec3 c = mix(dim, lit, t.r) * vShade;
        c = mix(c, fogColor, vFog * 0.85);
        gl_FragColor = vec4(c, t.a);
        #include <colorspace_fragment>
      }`,
  });
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 1;
  return m;
}

/** Chunky low-poly cumulus at flight level, kept off the route and clear of the islands. */
export function buildPuffs(avoid: Vector3[], islands: { x: number; z: number; R: number; y: number }[]) {
  const r = rng(31);
  const b = new Builder(r);
  const top = lin("#ffffff");
  const under = lin("#dfe7f3");
  const near = (x: number, y: number, z: number, d: number) => {
    for (const p of avoid) if ((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 < d * d) return true;
    return false;
  };
  let placed = 0,
    tries = 0;
  while (placed < 30 && tries < 3000) {
    tries++;
    const x = -95 + r() * 290,
      z = -125 + r() * 270,
      y = -9 + r() * 24;
    const w = 5 + r() * 7;
    if (near(x, y, z, w + 5.5)) continue;
    let bad = false;
    for (const i of islands) if (Math.hypot(i.x - x, i.z - z) < i.R + w + 3 && y > i.y - 16) bad = true;
    if (bad) continue;
    const n = 3 + Math.floor(r() * 4);
    const rot = r() * Math.PI;
    const cx = Math.cos(rot),
      cz = Math.sin(rot);
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : k / (n - 1) - 0.5;
      const s = w * (0.55 + 0.45 * (1 - Math.abs(t) * 1.6)) * (0.85 + r() * 0.3);
      const px = x + cx * t * w * 1.5 + (r() - 0.5) * w * 0.3;
      const pz = z + cz * t * w * 1.5 + (r() - 0.5) * w * 0.3;
      b.add(blob(1), mat(px, y + s * 0.18, pz, s, s * 0.72, s * 0.9, r() * 6), (_f, ny) => (ny < -0.25 ? under : top), 0.035);
    }
    placed++;
  }
  const m = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: new Color("#ffffff"), emissiveIntensity: 0.32 }));
  return m;
}

export function buildFalls(falls: Fall[]) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const SEG = 10;
  for (const f of falls) {
    const base = pos.length / 3;
    const px = -f.dz,
      pz = f.dx;
    for (let i = 0; i <= SEG; i++) {
      const v = i / SEG;
      const out = 0.25 + 1.4 * Math.sqrt(v);
      const y = f.y - v * f.drop;
      const w = (f.w / 2) * (1 + v * 0.35);
      for (const s of [-1, 1]) {
        pos.push(f.x + f.dx * out + px * w * s, y, f.z + f.dz * out + pz * w * s);
        uv.push(s < 0 ? 0 : 1, v);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { time: { value: 0 }, water: { value: new Color("#7fd3e6") } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 water;
      varying vec2 vUv;
      void main() {
        float stripes = 0.5 + 0.5 * sin(vUv.x * 46.0 + sin(vUv.x * 11.0) * 3.0);
        float flow = fract(vUv.y * 2.2 - time * 0.8 + stripes * 0.35);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float a = (1.0 - smoothstep(0.35, 1.0, vUv.y)) * (0.5 + 0.4 * stripes) * edge;
        vec3 c = mix(water, vec3(1.0), 0.3 + 0.55 * smoothstep(0.55, 1.0, flow) * stripes);
        gl_FragColor = vec4(c, a * 0.9);
        #include <colorspace_fragment>
      }`,
  });
  const m = new Mesh(g, mat);
  m.renderOrder = 1;
  return { mesh: m, mat };
}

export function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.95)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 63);
  grd.addColorStop(0, "rgba(30,40,80,0.55)");
  grd.addColorStop(0.45, "rgba(30,40,80,0.32)");
  grd.addColorStop(1, "rgba(30,40,80,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}
