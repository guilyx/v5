import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  FrontSide,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  Points,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "./formations";

/**
 * The set: a night sky with a thin moon, a skyline of extruded towers whose
 * windows are lit procedurally (they twinkle as people switch lights on and
 * off), a corniche of sodium lamps, and the water. Reflections are the scene
 * drawn again upside down, rippled in the shader, under a translucent sea.
 * Everything is a single draw each: no textures, no render targets.
 */

export const SHORE_Z = -1460;

const HAZE = new Vector3(0.115, 0.085, 0.12);

const NOISE = /* glsl */ `
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

export interface City {
  objects: (Mesh | Points)[];
  uniforms: { uTime: { value: number }; uPx: { value: number } };
}

// ---------------------------------------------------------------- sky

function sky(time: { value: number }) {
  const geo = new SphereGeometry(4500, 32, 16);
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { uTime: time, uMoon: { value: new Vector3(-0.36, 0.25, -0.9).normalize() }, uHaze: { value: HAZE } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoon; uniform vec3 uHaze;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        // below the horizon the sea mirrors the sky, a little darker
        float below = step(d.y, 0.0);
        float h = abs(d.y);
        vec3 zen = vec3(0.010, 0.016, 0.040);
        vec3 mid = vec3(0.028, 0.040, 0.088);
        vec3 col = mix(uHaze, mid, smoothstep(0.0, 0.13, h));
        col = mix(col, zen, smoothstep(0.1, 0.7, h));
        // the city's glow, warm and low, strongest straight ahead
        float ahead = smoothstep(-0.2, -1.0, d.z);
        col += vec3(0.20, 0.10, 0.045) * exp(-max(h, 0.0) * 30.0) * (0.45 + 0.55 * ahead);
        // a thin crescent
        float md = distance(d, uMoon);
        float disc = smoothstep(0.0092, 0.0084, md);
        float bite = smoothstep(0.0078, 0.0088, distance(d, uMoon + vec3(0.0042, 0.0022, 0.0)));
        col += vec3(1.0, 0.93, 0.8) * disc * bite * 0.92;
        col += vec3(0.45, 0.5, 0.65) * exp(-md * 26.0) * 0.06;
        col *= 1.0 - below * 0.45;
        // dither, so the dark gradient never bands
        col += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function stars(time: { value: number }, px: { value: number }) {
  const r = rng(404);
  const n = 420;
  const pos = new Float32Array(n * 3), k = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const el = 0.1 + Math.pow(r(), 0.7) * 1.3;
    const az = r() * Math.PI * 2;
    const R = 4000;
    pos.set([Math.cos(el) * Math.sin(az) * R, Math.sin(el) * R, -Math.cos(el) * Math.cos(az) * R], i * 3);
    k.set([0.4 + Math.pow(r(), 3) * 1.4, r() * 6.28], i * 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aK", new BufferAttribute(k, 2));
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: time, uPx: px },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPx;
      attribute vec2 aK;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.9999;
        float tw = 0.7 + 0.3 * sin(uTime * (0.6 + aK.y * 0.3) + aK.y * 10.0);
        vA = aK.x * tw * smoothstep(0.08, 0.3, normalize(position).y);
        gl_PointSize = max(2.0, 2.2 * uPx / 900.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(c, c) * 5.0) * vA * 0.5;
        gl_FragColor = vec4(vec3(0.85, 0.88, 1.0) * a, 1.0);
      }`,
  });
  const pts = new Points(geo, mat);
  pts.renderOrder = 4;
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------- skyline

interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: number;
}

function towers(): Tower[] {
  const r = rng(2026);
  const out: Tower[] = [];
  const crowd = (x: number) =>
    1 + 0.95 * Math.exp(-(((x - 360) / 240) ** 2)) + 0.55 * Math.exp(-(((x + 470) / 210) ** 2)) + 0.4 * Math.exp(-(((x + 1080) / 170) ** 2));
  const rows = [
    { z: -1530, jitter: 30, hMin: 12, hMax: 40, wMin: 16, wMax: 44, gap: 12 },
    { z: -1880, jitter: 50, hMin: 24, hMax: 62, wMin: 22, wMax: 50, gap: 28 },
    { z: -2380, jitter: 80, hMin: 36, hMax: 84, wMin: 30, wMax: 70, gap: 50 },
  ];
  for (const row of rows) {
    let x = -2100 + r() * 40;
    while (x < 2100) {
      const w = row.wMin + r() * (row.wMax - row.wMin);
      const h = (row.hMin + Math.pow(r(), 1.6) * (row.hMax - row.hMin)) * crowd(x) * (0.8 + r() * 0.4);
      const roll = r();
      const kind = h > 75 && roll < 0.35 ? 3 : roll < 0.3 ? 0 : roll < 0.55 ? 1 : roll < 0.75 ? 2 : roll < 0.9 ? 4 : 0;
      out.push({ x: x + w / 2, z: row.z - r() * row.jitter, w, d: w * (0.6 + r() * 0.6), h, kind });
      x += w + r() * row.gap + (r() < 0.12 ? 60 : 0);
    }
  }
  // a few landmark silhouettes: five curved towers on the left, a needle right of centre
  [-980, -925, -870, -820, -770].forEach((x, i) =>
    out.push({ x, z: -1990 - i * 14, w: 30, d: 30, h: [96, 124, 108, 116, 90][i], kind: 2 }),
  );
  out.push({ x: 420, z: -1960, w: 24, d: 24, h: 150, kind: 3 });
  out.push({ x: 300, z: -2040, w: 46, d: 40, h: 108, kind: 1 });
  return out;
}

function towerGeometry(t: Tower, seed: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    parts.push(g.toNonIndexed());
  };
  const profile = (shape: Shape, depth: number) => {
    const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
    g.translate(t.x, 0, t.z - depth / 2);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  if (t.kind === 1) {
    box(t.w, t.h * 0.72, t.d, t.x, 0, t.z);
    box(t.w * 0.7, t.h * 0.28, t.d * 0.7, t.x, t.h * 0.72, t.z);
  } else if (t.kind === 2) {
    const s = new Shape();
    s.moveTo(-t.w / 2, 0);
    s.lineTo(t.w / 2, 0);
    s.lineTo(t.w / 2, t.h * 0.78);
    s.quadraticCurveTo(t.w / 2, t.h, -t.w / 2, t.h);
    s.lineTo(-t.w / 2, 0);
    profile(s, t.d);
  } else if (t.kind === 3) {
    box(t.w, t.h * 0.86, t.d, t.x, 0, t.z);
    box(t.w * 0.55, t.h * 0.06, t.d * 0.55, t.x, t.h * 0.86, t.z);
    box(2.2, t.h * 0.12, 2.2, t.x, t.h * 0.92, t.z);
  } else if (t.kind === 4) {
    const s = new Shape();
    const dir = seed % 2 ? 1 : -1;
    s.moveTo(-t.w / 2, 0);
    s.lineTo(t.w / 2, 0);
    s.lineTo(t.w / 2, t.h * (dir > 0 ? 1 : 0.84));
    s.lineTo(-t.w / 2, t.h * (dir > 0 ? 0.84 : 1));
    s.lineTo(-t.w / 2, 0);
    profile(s, t.d);
  } else {
    box(t.w, t.h, t.d, t.x, 0, t.z);
  }
  return parts;
}

function skyline(time: { value: number }, mirror: boolean, geo: BufferGeometry) {
  const mat = new ShaderMaterial({
    side: mirror ? BackSide : FrontSide,
    uniforms: { uTime: time, uHaze: { value: HAZE } },
    defines: mirror ? { MIRROR: 1 } : {},
    vertexShader: /* glsl */ `
      attribute vec4 aB;
      varying vec3 vP; varying vec3 vN; varying vec4 vB; varying float vDepth;
      void main() {
        vec3 p = position;
        #ifdef MIRROR
          p.y = -p.y;
        #endif
        vP = position; vN = normal; vB = aB;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uHaze;
      varying vec3 vP; varying vec3 vN; varying vec4 vB; varying float vDepth;
      ${NOISE}
      void main() {
        vec3 n = normalize(vN);
        float side = step(0.6, abs(n.x));
        float roof = step(0.5, n.y);
        float u = mix(vP.x, vP.z, side);
        float v = vP.y;
        #ifdef MIRROR
          u += sin(v * 0.11 + uTime * 1.1) * 4.0 + sin(v * 0.43 - uTime * 1.9) * 2.0 + sin(v * 1.7 + uTime * 3.0) * 1.0;
        #endif
        vec2 g = vec2(u / 4.4, v / 4.8);
        vec2 id = floor(g);
        vec2 f = fract(g);
        vec2 aa = min(fwidth(g) * 0.9, vec2(0.3));
        float win = smoothstep(0.22 - aa.x, 0.22 + aa.x, f.x) * smoothstep(0.78 + aa.x, 0.78 - aa.x, f.x)
                  * smoothstep(0.26 - aa.y, 0.26 + aa.y, f.y) * smoothstep(0.74 + aa.y, 0.74 - aa.y, f.y);
        float r = h21(id + vB.x * 17.0);
        float lit = step(1.0 - vB.y, r);
        // people switching lights on and off, slowly
        float tw = h21(id * 0.37 + floor(uTime * 0.09 + r * 9.0) + vB.x);
        lit *= step(0.07, tw);
        vec3 warm = vec3(1.0, 0.72, 0.42), cool = vec3(0.74, 0.85, 1.0);
        vec3 wc = mix(warm, cool, step(0.8, h21(id + 9.1)));
        float b = 0.22 + 0.55 * h21(id + 3.3);
        vec3 base = mix(vec3(0.030, 0.034, 0.058), vec3(0.018, 0.021, 0.04), side);
        vec3 col = base + wc * win * lit * b * (1.0 - roof) * 0.95;
        // lit crowns on some towers
        col += vec3(1.0, 0.84, 0.6) * vB.w * smoothstep(vB.z - 7.0, vB.z - 5.5, v) * step(v, vB.z - 2.5) * (1.0 - roof) * 0.75;
        // street glow at the foot
        col += vec3(0.17, 0.095, 0.05) * exp(-v * 0.045);
        col = mix(col, uHaze, smoothstep(1450.0, 2500.0, vDepth) * 0.72);
        #ifdef MIRROR
          float fade = exp(-v * 0.012);
          col = mix(uHaze * 0.5, col * 0.55 * (0.65 + 0.35 * sin(v * 0.9 + uTime * 2.3 + u * 0.03)), fade);
        #endif
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = mirror ? -5 : 0;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- lights

function lights(time: { value: number }, px: { value: number }, list: Tower[], mirror: boolean, shared?: BufferGeometry) {
  let geo = shared;
  if (!geo) {
    const r = rng(77);
    const pos: number[] = [], col: number[] = [], k: number[] = [];
    // the corniche: a line of sodium lamps
    for (let x = -2200; x < 2200; x += 10 + r() * 8) {
      pos.push(x, 3.5 + r() * 1.5, SHORE_Z - 6 - r() * 4);
      const white = r() < 0.18;
      col.push(...(white ? [0.85, 0.9, 1.0] : [1.0, 0.66, 0.3]));
      k.push(0, r() * 6.28, 2.6 + r() * 1.2);
    }
    // aviation lights on the tall towers
    for (const t of list)
      if (t.h > 72) {
        pos.push(t.x, t.h + 1.5, t.z);
        col.push(1.0, 0.18, 0.1);
        k.push(1, r() * 6.28, 3.4);
      }
    // two boats crossing slowly
    for (const [z, x0, dir] of [
      [-640, -300, 1],
      [-1050, 500, -1],
    ]) {
      for (const [dx, dy, c] of [
        [0, 2.5, [1, 0.95, 0.85]],
        [5, 1.2, [1, 0.3, 0.2]],
        [-5, 1.2, [0.35, 1, 0.5]],
      ] as [number, number, number[]][]) {
        pos.push(x0 + dx, dy, z);
        col.push(...c);
        k.push(2 + (dir > 0 ? 0 : 0.5), 0, 1.6);
      }
    }
    geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setAttribute("aC", new Float32BufferAttribute(col, 3));
    geo.setAttribute("aK", new Float32BufferAttribute(k, 3));
  }
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    defines: mirror ? { MIRROR: 1 } : {},
    uniforms: { uTime: time, uPx: px },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPx;
      attribute vec3 aC; attribute vec3 aK;
      varying vec3 vC;
      void main() {
        vec3 p = position;
        float a = 1.0;
        if (aK.x > 1.5) {
          // a boat: drift along x, wrap around
          float dir = aK.x > 2.25 ? -1.0 : 1.0;
          p.x = mod(p.x + dir * uTime * 4.0 + 1500.0, 3000.0) - 1500.0;
        } else if (aK.x > 0.5) {
          a = step(0.86, fract(uTime * 0.55 + aK.y)) * 1.6 + 0.08;
        } else {
          a = 0.86 + 0.14 * sin(uTime * 0.7 + aK.y * 5.0);
        }
        #ifdef MIRROR
          p.y = -p.y;
          p.x += sin(uTime * 1.3 + aK.y * 3.0) * 0.8;
          a *= 0.55;
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = aK.z * uPx / -mv.z;
        #ifdef MIRROR
          size *= 5.0;
        #endif
        gl_PointSize = clamp(size, 2.0, 80.0);
        vC = aC * a;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vC;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        #ifdef MIRROR
          c.x = c.x * 5.0 + sin(c.y * 9.0 + uTime * 3.0) * 1.2;
          c.y *= 1.05;
          float s = exp(-c.x * c.x * 1.5) * (1.0 - smoothstep(0.1, 1.0, abs(c.y))) * (0.6 + 0.4 * sin(c.y * 22.0 - uTime * 4.0));
          gl_FragColor = vec4(vC * s * 0.55, 1.0);
        #else
          float r2 = dot(c, c);
          float s = exp(-r2 * 9.0) * 1.4 + exp(-r2 * 2.5) * 0.25;
          gl_FragColor = vec4(vC * s, 1.0);
        #endif
      }`,
  });
  const pts = new Points(geo, mat);
  pts.renderOrder = mirror ? 1 : 5;
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------- water

function water(time: { value: number }) {
  const geo = new PlaneGeometry(9000, 3100, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -1500);
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: time, uHaze: { value: HAZE } },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uHaze;
      varying vec3 vP;
      ${NOISE}
      void main() {
        float z = -vP.z;
        if (z > ${(-SHORE_Z).toFixed(1)}) {
          // the promenade and the land behind it
          vec3 c = vec3(0.02, 0.02, 0.03) + vec3(0.13, 0.075, 0.035) * exp(-(z - ${(-SHORE_Z).toFixed(1)}) * 0.012);
          c = mix(c, uHaze, smoothstep(1600.0, 2800.0, z) * 0.6);
          gl_FragColor = vec4(c, 1.0);
          return;
        }
        float far = smoothstep(20.0, 1400.0, z);
        vec3 deep = vec3(0.004, 0.008, 0.02);
        vec3 col = mix(deep, vec3(0.03, 0.035, 0.06), far);
        // swell: long, slow, roughly horizontal bands that break the mirror into strips
        float band = sin(z * (0.32 - far * 0.2) + sin(vP.x * 0.012 + uTime * 0.25) * 2.0 - uTime * 0.9);
        float w = sin(vP.x * 0.05 + uTime * 0.5 + sin(vP.z * 0.07 + uTime * 0.35) * 2.4) * sin(vP.z * 0.21 - uTime * 0.8);
        col += vec3(0.05, 0.065, 0.1) * smoothstep(0.55, 1.0, w) * (1.0 - far) * 0.6;
        col += (h21(gl_FragCoord.xy + 3.0) - 0.5) / 255.0;
        float a = mix(0.55, 0.16, far) + band * 0.12 * (1.0 - far * 0.5);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- assembly

export function buildCity(): City {
  const uTime = { value: 0 }, uPx = { value: 800 };
  const list = towers();
  const parts: BufferGeometry[] = [];
  list.forEach((t, i) => {
    const r = rng(i * 31 + 7);
    const lit = 0.1 + r() * 0.24;
    const crown = t.h > 60 && r() < 0.35 ? 1 : 0;
    for (const g of towerGeometry(t, i)) {
      g.deleteAttribute("uv");
      const n = g.getAttribute("position").count;
      const b = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) b.set([i * 0.618 + 0.13, lit, t.h * (t.kind === 3 ? 0.86 : t.kind === 1 ? 1 : 1), crown], k * 4);
      g.setAttribute("aB", new BufferAttribute(b, 4));
      parts.push(g);
    }
  });
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  const lightsReal = lights(uTime, uPx, list, false);
  const lightsMirror = lights(uTime, uPx, list, true, lightsReal.geometry);
  return {
    objects: [sky(uTime), stars(uTime, uPx), skyline(uTime, true, geo), skyline(uTime, false, geo), lightsMirror, water(uTime), lightsReal],
    uniforms: { uTime, uPx },
  };
}
