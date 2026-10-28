import * as THREE from "three";

/** The toy's palette. Warm paper, kraft clay, one red for the robot, blue for rolling plans, orange for flying. */
export const PAL = {
  table: "#e9e0d0",
  board: "#f8f3e9",
  clay: "#dcb08a",
  frame: "#b98a62",
  graphite: "#3c3e45",
  gold: "#d9b25f",
  ink: "#2b2118",
  robot: "#fffaf1",
  accent: "#e4572e",
  search: "#3a6bf0",
  fly: "#e8850f",
};

/** Lighting shared by every hand-written material: a sky/ground fill and one warm sun. */
export const LIGHT = {
  uLightDir: { value: new THREE.Vector3(-0.55, 1, 0.45).normalize() },
  uSky: { value: new THREE.Color("#fffaf2") },
  uGround: { value: new THREE.Color("#c4ad8d") },
  uSun: { value: new THREE.Color("#fff0da") },
  uFogColor: { value: new THREE.Color(PAL.table) },
  uFogNear: { value: 40 },
  uFogFar: { value: 80 },
};

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLightDir, uSky, uGround, uSun, uFogColor;
uniform float uFogNear, uFogFar;
vec3 shade(vec3 albedo, vec3 n, float sunVis, float ao) {
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(uGround, uSky, hemi) * 0.64 * ao;
  float d = max(dot(n, uLightDir), 0.0);
  return albedo * (amb + uSun * d * 0.5 * sunVis);
}
vec3 fogged(vec3 c, float depth) {
  return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, depth));
}
`;

const CLAY_VS = /* glsl */ `
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vCol;
varying float vDepth;
#ifdef USE_MAP
varying vec2 vUv;
#endif
#ifdef BEVEL
varying vec3 vLocal;
varying vec3 vScale;
#endif
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * normal);
  vCol = uColor;
  #ifdef USE_COLOR
  vCol *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
  #endif
  #ifdef USE_MAP
  vUv = uv;
  #endif
  #ifdef BEVEL
  vLocal = position;
  vScale = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));
  #endif
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const CLAY_FS = /* glsl */ `
${LIGHT_GLSL}
uniform float uOpacity;
uniform float uEmissive;
varying vec3 vN;
varying vec3 vCol;
varying float vDepth;
#ifdef USE_MAP
uniform sampler2D uMap;
varying vec2 vUv;
#endif
#ifdef BEVEL
varying vec3 vLocal;
varying vec3 vScale;
#endif
void main() {
  vec3 n = normalize(vN);
  vec3 albedo = vCol;
  float alpha = uOpacity;
  #ifdef USE_MAP
  vec4 tex = texture2D(uMap, vUv);
  albedo *= tex.rgb;
  alpha *= tex.a;
  if (alpha < 0.01) discard;
  #endif
  float ao = 1.0;
  #ifdef BEVEL
  // soft clay: a lit rim along the top edges, a darker foot where the wall meets the floor
  if (n.y > 0.5) {
    float e = min((0.5 - abs(vLocal.x)) * vScale.x, (0.5 - abs(vLocal.z)) * vScale.z);
    albedo *= 1.04 + 0.1 * (1.0 - smoothstep(0.0, 0.045, e));
  } else {
    float hgt = (vLocal.y + 0.5) * vScale.y;
    float top = (0.5 - vLocal.y) * vScale.y;
    ao = mix(0.62, 1.0, smoothstep(0.0, 0.3, hgt));
    albedo *= 1.0 + 0.07 * (1.0 - smoothstep(0.0, 0.03, top));
  }
  #endif
  vec3 c = shade(albedo, n, 1.0, ao);
  c = mix(c, albedo, uEmissive);
  gl_FragColor = vec4(fogged(c, vDepth), alpha);
  #include <colorspace_fragment>
}
`;

export interface ClayOpts {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  bevel?: boolean;
  map?: THREE.Texture;
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
  side?: THREE.Side;
}

/** One matte material for the whole toy, so every object agrees on the light. */
export function clay(o: ClayOpts = {}) {
  const defines: Record<string, string> = {};
  if (o.bevel) defines.BEVEL = "";
  if (o.map) defines.USE_MAP = "";
  return new THREE.ShaderMaterial({
    uniforms: {
      ...LIGHT,
      uColor: { value: new THREE.Color(o.color ?? "#ffffff") },
      uOpacity: { value: o.opacity ?? 1 },
      uEmissive: { value: o.emissive ?? 0 },
      uMap: { value: o.map ?? null },
    },
    defines,
    vertexShader: CLAY_VS,
    fragmentShader: CLAY_FS,
    vertexColors: !!o.vertexColors,
    transparent: !!o.transparent,
    depthWrite: !o.transparent,
    side: o.side ?? THREE.FrontSide,
  });
}

export { LIGHT_GLSL };

/** Paint a geometry one flat colour (as a vertex colour) so many parts can merge into one draw call. */
export function tint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Non-indexed copy without uvs, so differently-built geometries can be merged together. */
export function plain(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
  return g;
}

/** Soft round shadow texture for things that move (cheaper than a shadow map). */
let blobTex: THREE.Texture | null = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, "rgba(60,40,20,0.55)");
  g.addColorStop(0.55, "rgba(60,40,20,0.22)");
  g.addColorStop(1, "rgba(60,40,20,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}

export function blobMaterial(opacity = 1) {
  return new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    opacity,
    fog: false,
  });
}
