/**
 * The WebGL globe: a cream ocean with its graticule and live night side, land as a halftone of
 * ink dots, and the routes as ribbons that draw themselves. Three draw calls, no post-processing.
 * Loaded lazily; the page and the flat plate work without it.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import { arcPoint, len, sub, type Cam, type V3 } from "./geo";
import type { LandDots } from "./land";
import { LEGS, at, legShape } from "./places";
import type { Frame } from "./plate";
import { INK } from "./palette";

const OCEAN_VS = /* glsl */ `
varying vec3 vN;
void main() {
  vN = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const OCEAN_FS = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uSun;
uniform vec3 uDay;
uniform vec3 uRim;
uniform vec3 uNight;
uniform vec3 uLine;
varying vec3 vN;

// an anti-aliased line every step degrees, about px pixels wide
float grid(float coord, float stepDeg, float px) {
  float x = coord / stepDeg;
  float fw = max(fwidth(x), 1e-5);
  float d = abs(fract(x - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, d);
}
float circle(float lat, float at, float px) {
  float fw = max(fwidth(lat), 1e-5);
  return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, abs(lat - at) / fw);
}

void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - n);
  float mu = clamp(dot(n, v), 0.0, 1.0);
  float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
  float lon = degrees(atan(n.x, n.z));

  // printed-globe shading: paper in the middle, a warmer tint towards the rim
  vec3 col = mix(uRim, uDay, smoothstep(0.0, 0.5, mu));
  // tonight's real night side, soft
  float night = 1.0 - smoothstep(-0.16, 0.12, dot(n, uSun));
  col = mix(col, col * uNight, night);

  // graticule: 15° always, 5° once there is room for it
  float polar = step(abs(lat), 80.0);
  float g15 = max(grid(lat, 15.0, 1.0), grid(lon, 15.0, 1.0) * polar);
  float room = smoothstep(18.0, 40.0, 1.0 / max(fwidth(lat / 5.0), 1e-5));
  float g5 = max(grid(lat, 5.0, 1.0), grid(lon, 5.0, 1.0) * step(abs(lat), 70.0)) * room;
  float eq = circle(lat, 0.0, 1.6);
  float dash = step(0.5, fract(lon / 3.0));
  float tropics = max(max(circle(lat, 23.44, 1.0), circle(lat, -23.44, 1.0)), max(circle(lat, 66.56, 1.0), circle(lat, -66.56, 1.0))) * dash;
  float a = max(max(g15 * 0.2, g5 * 0.09), max(eq * 0.34, tropics * 0.26));
  col = mix(col, uLine, a);
  gl_FragColor = vec4(col, 1.0);
}`;

const LAND_VS = /* glsl */ `
attribute float level;
uniform vec3 uCam;
uniform vec3 uSun;
uniform float uF;      // focal length, device px
uniform float uStep;   // fine lattice step, radians
uniform float uPitch;  // halftone pitch, device px
varying float vAlpha;
varying float vNight;
varying float vSize;
void main() {
  vec3 p = position * 1.0012;
  vec3 toCam = uCam - p;
  float dist = length(toCam);
  float mu = dot(position, toCam / dist);
  if (mu <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float fine = uStep * uF / dist;                   // device px between neighbouring fine dots
  float own = fine * exp2(2.0 - level);              // ... between dots of this level
  float show = level < 0.5 ? 1.0 : smoothstep(uPitch * 0.7, uPitch * 0.95, own);
  float pitch = clamp(uPitch, fine, fine * 4.0);      // the halftone screen stays the same on screen
  float day = smoothstep(-0.16, 0.14, dot(position, uSun));
  float size = pitch * mix(0.54, 0.68, day) * mix(0.55, 1.0, sqrt(mu)) * show;
  vSize = max(size, 1.4);
  vAlpha = show * clamp(size / 1.4, 0.0, 1.0);
  vNight = 1.0 - day;
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const LAND_FS = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uInkNight;
varying float vAlpha;
varying float vNight;
varying float vSize;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  float a = (1.0 - smoothstep(1.0 - 1.6 / vSize, 1.0, r)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uInk, uInkNight, vNight), a);
}`;

const ARC_VS = /* glsl */ `
attribute vec3 next;
attribute float side;
attribute float u;
attribute float leg;
attribute float dist;
uniform vec2 uRes;
uniform float uWidth;
uniform float uProg[${LEGS.length}];
varying float vU;
varying float vSide;
varying float vProg;
varying float vDist;
varying float vLeg;
void main() {
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(next, 1.0);
  vec2 s0 = c0.xy / c0.w * uRes;
  vec2 s1 = c1.xy / c1.w * uRes;
  vec2 dir = s1 - s0;
  dir = length(dir) < 1e-4 ? vec2(1.0, 0.0) : normalize(dir);
  vec2 nrm = vec2(-dir.y, dir.x);
  c0.xy += nrm * side * uWidth / uRes * c0.w;
  vU = u;
  vSide = side;
  vProg = uProg[int(leg + 0.5)];
  vDist = dist;
  vLeg = leg;
  gl_Position = c0;
}`;

const ARC_FS = /* glsl */ `
uniform float uTime;
uniform float uActive;
uniform float uGhost;
uniform float uPxUnit;  // device px per world unit at the globe's surface
uniform float uWidth;
uniform float uDpr;
uniform vec3 uRoute;
uniform vec3 uCollab;
uniform vec3 uPencil;
uniform float uCollabLeg;
varying float vU;
varying float vSide;
varying float vProg;
varying float vDist;
varying float vLeg;
void main() {
  float px = vDist * uPxUnit;
  float s = abs(vSide) * uWidth;  // device px from the centre line
  bool collab = abs(vLeg - uCollabLeg) < 0.5;
  if (vU > vProg) {
    // the planned route: a pencilled dotted line (the collaboration only appears when drawn)
    if (vU > uGhost || collab) discard;
    float m = abs(fract(px / (7.0 * uDpr)) - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.35, 0.6, m)) * (1.0 - smoothstep(uWidth * 0.32, uWidth * 0.32 + 1.0, s)) * 0.55;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uPencil, a);
    return;
  }
  float edge = 1.0 - smoothstep(uWidth - 1.2, uWidth, s);
  float dash = 1.0;
  float period = 15.0 * uDpr;
  if (collab) dash = step(fract(px / period - uTime * 0.35), 0.58);
  else if (abs(vLeg - uActive) < 0.5) dash = step(fract(px / period - uTime * 0.6), 0.68);
  float a = edge * dash;
  if (a < 0.01) discard;
  gl_FragColor = vec4(collab ? uCollab : uRoute, a);
}`;

function buildArcs(): BufferGeometry {
  const N = 120;
  const pos: number[] = [];
  const nxt: number[] = [];
  const side: number[] = [];
  const us: number[] = [];
  const legs: number[] = [];
  const dists: number[] = [];
  const index: number[] = [];
  LEGS.forEach((leg, li) => {
    const a = at(leg.from);
    const b = at(leg.to);
    const { lift, bow } = legShape(leg);
    const pts: V3[] = [];
    for (let i = 0; i <= N; i++) {
      const p = arcPoint(a, b, i / N, lift, bow);
      const r = len(p);
      pts.push([(p[0] / r) * (r + 0.003), (p[1] / r) * (r + 0.003), (p[2] / r) * (r + 0.003)]);
    }
    let acc = 0;
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      if (i > 0) acc += len(sub(pts[i], pts[i - 1]));
      const p = pts[i];
      const q = i < N ? pts[i + 1] : ([2 * p[0] - pts[i - 1][0], 2 * p[1] - pts[i - 1][1], 2 * p[2] - pts[i - 1][2]] as V3);
      for (const sd of [-1, 1]) {
        pos.push(...p);
        nxt.push(...q);
        side.push(sd);
        us.push(i / N);
        legs.push(li);
        dists.push(acc);
      }
      if (i < N) {
        const v = base + i * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("next", new BufferAttribute(new Float32Array(nxt), 3));
  g.setAttribute("side", new BufferAttribute(new Float32Array(side), 1));
  g.setAttribute("u", new BufferAttribute(new Float32Array(us), 1));
  g.setAttribute("leg", new BufferAttribute(new Float32Array(legs), 1));
  g.setAttribute("dist", new BufferAttribute(new Float32Array(dists), 1));
  g.setIndex(index);
  return g;
}

/** sRGB straight through: these shaders write display colours, like the CSS does */
const col = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
/** the halftone screen, in css px between dots, once zoomed out far enough */
export const PITCH = 5.2;

export class Globe {
  renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(28, 1, 0.05, 20);
  private ocean: ShaderMaterial;
  private landMat: ShaderMaterial;
  private arcMat: ShaderMaterial;
  private landGeo: BufferGeometry;
  private counts: [number, number, number];
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, land: LandDots) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.info.autoReset = true;

    this.ocean = new ShaderMaterial({
      vertexShader: OCEAN_VS,
      fragmentShader: OCEAN_FS,
      uniforms: {
        uCam: { value: [0, 0, 5] },
        uSun: { value: [1, 0, 0] },
        uDay: { value: col(INK.oceanDay) },
        uRim: { value: col(INK.oceanRim) },
        uNight: { value: col(INK.nightTint) },
        uLine: { value: col(INK.ink) },
      },
    });
    this.scene.add(new Mesh(new SphereGeometry(1, 96, 64), this.ocean));

    this.landGeo = new BufferGeometry();
    this.landGeo.setAttribute("position", new BufferAttribute(land.positions, 3));
    this.landGeo.setAttribute("level", new BufferAttribute(land.levels, 1));
    this.counts = land.counts;
    this.landMat = new ShaderMaterial({
      vertexShader: LAND_VS,
      fragmentShader: LAND_FS,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCam: { value: [0, 0, 5] },
        uSun: { value: [1, 0, 0] },
        uF: { value: 1000 },
        uStep: { value: (0.25 * Math.PI) / 180 },
        uPitch: { value: 4.6 },
        uInk: { value: col(INK.land) },
        uInkNight: { value: col(INK.landNight) },
      },
    });
    const points = new Points(this.landGeo, this.landMat);
    points.frustumCulled = false;
    points.renderOrder = 1;
    this.scene.add(points);

    this.arcMat = new ShaderMaterial({
      vertexShader: ARC_VS,
      fragmentShader: ARC_FS,
      transparent: true,
      depthWrite: false,
      side: DoubleSide, // the ribbon's winding flips with the direction of travel
      uniforms: {
        uRes: { value: [1, 1] },
        uWidth: { value: 3 },
        uDpr: { value: 1 },
        uProg: { value: new Float32Array(LEGS.length) },
        uTime: { value: 0 },
        uActive: { value: -1 },
        uGhost: { value: 1 },
        uPxUnit: { value: 100 },
        uRoute: { value: col(INK.route) },
        uCollab: { value: col(INK.collab) },
        uPencil: { value: col(INK.pencil) },
        uCollabLeg: { value: LEGS.findIndex((l) => l.kind === "collab") },
      },
    });
    const arcs = new Mesh(buildArcs(), this.arcMat);
    arcs.frustumCulled = false;
    arcs.renderOrder = 2;
    this.scene.add(arcs);
  }

  resize(W: number, H: number, dpr: number) {
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.arcMat.uniforms.uRes.value = [(W * dpr) / 2, (H * dpr) / 2];
  }

  render(cam: Cam, fr: Frame) {
    const c = this.camera;
    c.fov = (cam.fov * 180) / Math.PI;
    c.aspect = cam.W / cam.H;
    // put the globe's centre where the layout wants it (right of the card, or above it on phones)
    c.setViewOffset(cam.W, cam.H, cam.W / 2 - cam.cx, cam.H / 2 - cam.cy, cam.W, cam.H);
    c.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    c.up.set(cam.up[0], cam.up[1], cam.up[2]);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();

    const dpr = this.dpr;
    const fDev = cam.f * dpr;
    this.ocean.uniforms.uCam.value = cam.pos;
    this.ocean.uniforms.uSun.value = fr.sun;
    const lu = this.landMat.uniforms;
    lu.uCam.value = cam.pos;
    lu.uSun.value = fr.sun;
    lu.uF.value = fDev;
    lu.uPitch.value = PITCH * dpr;
    // skip the finer lattices entirely when even the nearest dots couldn't show them
    const fineNear = ((0.25 * Math.PI) / 180) * (fDev / Math.max(0.05, cam.d - 1));
    const n = this.counts;
    const range = fineNear * 2 < lu.uPitch.value * 0.7 ? n[0] : fineNear < lu.uPitch.value * 0.7 ? n[0] + n[1] : n[0] + n[1] + n[2];
    this.landGeo.setDrawRange(0, range);

    const au = this.arcMat.uniforms;
    (au.uProg.value as Float32Array).set(fr.legs);
    au.uActive.value = fr.activeLeg;
    au.uTime.value = fr.time;
    au.uGhost.value = fr.ghost;
    au.uWidth.value = (cam.W < 700 ? 2.6 : 3) * dpr * 0.5;
    au.uDpr.value = dpr;
    au.uPxUnit.value = fDev / Math.max(0.05, cam.d - 1);

    this.renderer.render(this.scene, c);
  }

  stats() {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, points: r.points };
  }
}
