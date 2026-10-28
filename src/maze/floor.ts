import * as THREE from "three";
import { BLOCK, H, type Maze, ROOMS, W, WALL, idx } from "./layout";
import { LIGHT, LIGHT_GLSL, PAL } from "./gfx";

export const WALL_T = 0.34;
export const WALL_H = 0.62;
export const FRAME_H = 0.86;
const SUB = 4; // bake resolution: 4 texels per cell

/** Is this point (grid coordinates) inside a wall's thin slab? */
export function solidAt(m: Maze, gx: number, gz: number) {
  const cx = Math.floor(gx);
  const cz = Math.floor(gz);
  if (cx < 0 || cz < 0 || cx >= W || cz >= H) return 0;
  const v = m.grid[idx(cx, cz)];
  if (v === BLOCK) {
    const ox = Math.abs(gx - cx - 0.5);
    const oz = Math.abs(gz - cz - 0.5);
    return ox < 0.42 && oz < 0.42 ? 0.5 : 0;
  }
  if (v !== WALL) return 0;
  const h = cx === 0 || cz === 0 || cx === W - 1 || cz === H - 1 ? FRAME_H : WALL_H;
  const ox = gx - cx - 0.5;
  const oz = gz - cz - 0.5;
  const t = WALL_T / 2;
  const wallAt = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && m.grid[idx(x, z)] === WALL;
  if (Math.abs(ox) < t && Math.abs(oz) < t) return h;
  if (Math.abs(oz) < t && wallAt(cx + (ox > 0 ? 1 : -1), cz)) return h;
  if (Math.abs(ox) < t && wallAt(cx, cz + (oz > 0 ? 1 : -1))) return h;
  return 0;
}

/** Ambient occlusion and the sun's shadow, baked once into a small texture. Costs nothing per frame. */
function bake(m: Maze) {
  const SW = W * SUB;
  const SH = H * SUB;
  const hm = new Float32Array(SW * SH);
  for (let z = 0; z < SH; z++)
    for (let x = 0; x < SW; x++) hm[z * SW + x] = solidAt(m, (x + 0.5) / SUB, (z + 0.5) / SUB);

  // occlusion: how much solid stuff is nearby
  let occ = new Float32Array(SW * SH);
  for (let i = 0; i < hm.length; i++) occ[i] = hm[i] > 0 ? 1 : 0;
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let z = 0; z < SH; z++)
      for (let x = 0; x < SW; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= SW) continue;
          s += src[z * SW + xx];
          n++;
        }
        tmp[z * SW + x] = s / n;
      }
    for (let z = 0; z < SH; z++)
      for (let x = 0; x < SW; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const zz = z + k;
          if (zz < 0 || zz >= SH) continue;
          s += tmp[zz * SW + x];
          n++;
        }
        out[z * SW + x] = s / n;
      }
    return out;
  };
  occ = blur(blur(occ, 2), 2);

  // sun shadow: march from each texel toward the light through the height field
  const L = LIGHT.uLightDir.value;
  let sh = new Float32Array(SW * SH);
  for (let z = 0; z < SH; z++)
    for (let x = 0; x < SW; x++) {
      const px = (x + 0.5) / SUB;
      const pz = (z + 0.5) / SUB;
      let s = 0;
      for (let k = 1; k <= 10; k++) {
        const t = (k / 10) * (FRAME_H / L.y);
        const hy = t * L.y;
        const qx = px + t * L.x;
        const qz = pz + t * L.z;
        const hx = Math.floor(qx * SUB);
        const hz = Math.floor(qz * SUB);
        if (hx < 0 || hz < 0 || hx >= SW || hz >= SH) continue;
        if (hm[hz * SW + hx] > hy) {
          s = 1;
          break;
        }
      }
      sh[z * SW + x] = s;
    }
  sh = blur(sh, 1);

  const data = new Uint8Array(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) {
    data[i * 4] = Math.round(Math.min(1, occ[i]) * 255);
    data[i * 4 + 1] = Math.round(sh[i] * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, SW, SH, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const FLOOR_VS = /* glsl */ `
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FLOOR_FS = /* glsl */ `
${LIGHT_GLSL}
#define NROOMS ${ROOMS.length}
uniform vec2 uSize;
uniform sampler2D uBake;
uniform sampler2D uSearch;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uSearchCol;
uniform vec3 uSearchTile;
uniform vec3 uInk;
uniform vec4 uRoomRect[NROOMS];
uniform vec3 uRoomTint[NROOMS];
uniform vec3 uHover;
uniform vec4 uGoal;
varying vec3 vWorld;
varying float vDepth;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vWorld.xz;
  vec2 g = p + uSize * 0.5;
  vec3 base = uBase;
  for (int i = 0; i < NROOMS; i++) {
    vec4 r = uRoomRect[i];
    if (p.x > r.x && p.y > r.y && p.x < r.z && p.y < r.w) base = uRoomTint[i];
  }
  // paper grain, and a faint dot grid printed on the board like graph paper
  base *= 0.985 + 0.03 * hash(floor(p * 24.0));
  vec2 corner = abs(fract(g) - 0.5) - 0.5;
  float dotGrid = 1.0 - smoothstep(0.028, 0.045, length(corner));
  base = mix(base, uInk, dotGrid * 0.12);

  // the planner's search: each cell lights up when A* closes it, then fades
  ivec2 c = ivec2(floor(g));
  float t0 = texelFetch(uSearch, c, 0).r;
  float age = uTime - t0;
  float glow = age < 0.0 ? 0.0 : smoothstep(0.0, 0.06, age) * exp(-age * 0.85);
  vec2 f = fract(g) - 0.5;
  float tile = 1.0 - smoothstep(-0.02, 0.0, box(f, vec2(0.41), 0.12));
  float ring = 1.0 - smoothstep(0.0, 0.025, abs(box(f, vec2(0.41), 0.12)));
  base = mix(base, uSearchTile, glow * 0.85 * tile);
  base = mix(base, uSearchCol, min(1.0, glow * 1.1) * ring);

  // hover cursor and goal marker
  float hv = 1.0 - smoothstep(0.015, 0.04, abs(box(p - uHover.xy, vec2(0.4), 0.14)));
  base = mix(base, uInk, hv * uHover.z * 0.55);
  float gd = length(p - uGoal.xy);
  float pulse = fract(uTime * 0.9);
  float gr = (1.0 - smoothstep(0.02, 0.05, abs(gd - 0.32))) + (1.0 - smoothstep(0.015, 0.04, abs(gd - (0.2 + pulse * 0.5)))) * (1.0 - pulse);
  base = mix(base, uSearchCol, clamp(gr, 0.0, 1.0) * uGoal.z);

  vec2 b = texture2D(uBake, g / uSize).rg;
  float ao = 1.0 - b.r * 0.62;
  float sun = 1.0 - b.g * 0.9;
  vec3 col = shade(base, vec3(0.0, 1.0, 0.0), sun, ao);
  gl_FragColor = vec4(fogged(col, vDepth), 1.0);
  #include <colorspace_fragment>
}
`;

export interface Floor {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  /** light up the cells A* closed, in order, starting at time t */
  showSearch(expanded: number[], t: number, duration: number): void;
}

export function buildFloor(m: Maze): Floor {
  const search = new Float32Array(W * H).fill(-1e4);
  const searchTex = new THREE.DataTexture(search, W, H, THREE.RedFormat, THREE.FloatType);
  searchTex.magFilter = THREE.NearestFilter;
  searchTex.minFilter = THREE.NearestFilter;
  searchTex.needsUpdate = true;

  const rects = ROOMS.map(
    (r) => new THREE.Vector4(r.x - 0.5 - W / 2, r.y - 0.5 - H / 2, r.x + r.w + 0.5 - W / 2, r.y + r.h + 0.5 - H / 2),
  );
  const tints = ROOMS.map((r) => new THREE.Color(r.tint));
  const uniforms: Record<string, THREE.IUniform> = {
    ...LIGHT,
    uSize: { value: new THREE.Vector2(W, H) },
    uBake: { value: bake(m) },
    uSearch: { value: searchTex },
    uTime: { value: 0 },
    uBase: { value: new THREE.Color(PAL.board) },
    uSearchCol: { value: new THREE.Color(PAL.search) },
    uSearchTile: { value: new THREE.Color("#b3c8ff") },
    uInk: { value: new THREE.Color(PAL.ink) },
    uRoomRect: { value: rects },
    uRoomTint: { value: tints },
    uHover: { value: new THREE.Vector3(0, 0, 0) },
    uGoal: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS });
  const geo = new THREE.PlaneGeometry(W, H);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "floor";

  return {
    mesh,
    uniforms,
    showSearch(expanded, t, duration) {
      const n = expanded.length;
      const step = n > 1 ? duration / (n - 1) : 0;
      for (let i = 0; i < n; i++) search[expanded[i]] = t + i * step;
      searchTex.needsUpdate = true;
    },
  };
}
