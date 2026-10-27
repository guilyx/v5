import { MeshDepthMaterial, MeshLambertMaterial, type WebGLProgramParametersWithUniforms } from "three";

/** Uniforms every toy material shares: how dark it is, and the clock. */
export const U = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

type Shader = WebGLProgramParametersWithUniforms;

/** Windows and lamps (glow = 1) light up as night falls; LEDs (glow = 2) are always on. */
function injectGlow(s: Shader) {
  s.uniforms.uNight = U.uNight;
  s.vertexShader = s.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
    .replace("#include <color_vertex>", "#include <color_vertex>\nvGlow = glow;");
  s.fragmentShader = s.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying float vGlow;")
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      // windows are glass by day and warm lamplight by night
      float gNight = step(0.5, vGlow) * step(vGlow, 1.5) * uNight;
      float gAlways = step(1.5, vGlow);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.72, 0.36), gNight * 0.85);
      totalEmissiveRadiance += vec3(1.0, 0.62, 0.26) * gNight * 0.9 + vColor.rgb * gAlways * (0.55 + 0.6 * uNight);`,
    );
}

/**
 * Toy-block assembly in the vertex shader: each block (aPivot, aDelay) drops in,
 * grows, lands with a squash and wobbles to rest. uBuild is seconds since the
 * building started; running it backwards takes the building apart.
 */
const BUILD_PARS = /* glsl */ `
attribute vec3 aPivot;
attribute float aDelay;
uniform float uBuild;
`;
const BUILD_MAIN = /* glsl */ `
#include <begin_vertex>
{
  float bt = (uBuild - aDelay) / 0.9;
  if (bt < 1.0) {
    vec3 sc = vec3(0.0);
    float lift = 0.0;
    if (bt > 0.0) {
      float p = clamp(bt / 0.36, 0.0, 1.0);
      float grow = 1.0 - (1.0 - p) * (1.0 - p) * (1.0 - p);
      lift = (1.0 - p) * (1.0 - p) * 1.3;
      float tau = max(bt - 0.36, 0.0) * 0.9;
      float w = exp(-8.0 * tau) * sin(22.0 * tau);
      sc = vec3(grow * (1.0 + 0.2 * w), grow * (1.0 - 0.34 * w), grow * (1.0 + 0.2 * w));
    }
    transformed = aPivot + (transformed - aPivot) * sc + vec3(0.0, lift, 0.0);
  }
}
`;
function injectBuild(s: Shader, uBuild: { value: number }) {
  s.uniforms.uBuild = uBuild;
  s.vertexShader = s.vertexShader
    .replace("#include <common>", "#include <common>\n" + BUILD_PARS)
    .replace("#include <begin_vertex>", BUILD_MAIN);
}

/** The plain toy material: flat-shaded Lambert with vertex colours and night glow. */
export function toyMaterial() {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (s) => injectGlow(s);
  m.customProgramCacheKey = () => "toy";
  return m;
}

/** Material + matching shadow-depth material for a building that assembles. */
export function buildMaterials(uBuild: { value: number }) {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (s) => {
    injectGlow(s);
    injectBuild(s, uBuild);
  };
  m.customProgramCacheKey = () => "toy-build";
  const d = new MeshDepthMaterial();
  d.onBeforeCompile = (s) => injectBuild(s, uBuild);
  d.customProgramCacheKey = () => "toy-build-depth";
  return { m, d };
}
