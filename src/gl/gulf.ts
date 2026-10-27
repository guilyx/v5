import { Mesh, PlaneGeometry, ShaderMaterial } from "three";
import type { Texture } from "three";
import { C, col, FRAG_OUT, ground, Level, sstep } from "./kit";
import type { Frame, TagSpec } from "./kit";
import { O_AD } from "./world";

/**
 * The coast around Abu Dhabi as an old atlas would draw it: sand, sea, an ink
 * coastline and engraved water lines. Two signed-distance maps (1,280 km and
 * 80 km across) keep the coast smooth from 10^6.6 m all the way down to 10^3.
 */
const FRAG = /* glsl */ `
uniform sampler2D uGulf, uBay;
uniform vec3 uSea, uLand, uInk;
uniform float uOpacity;
varying vec2 vP; // km east / north of Abu Dhabi
void main() {
  vec2 uvG = vP / 1280.0 + 0.5;
  vec2 uvB = vP / 80.0 + 0.5;
  float dG = (texture2D(uGulf, uvG).r * 255.0 - 128.0) / 127.0 * 30.0;
  float dB = (texture2D(uBay, uvB).r * 255.0 - 128.0) / 127.0 * 2.5;
  float fp = max(length(fwidth(vP)), 1e-6); // km per pixel
  vec2 eb = min(uvB, 1.0 - uvB);
  // the bay map only knows the first 2.5 km off its coast: past that, trust the gulf map
  float wB = smoothstep(0.0, 0.08, min(eb.x, eb.y)) * (1.0 - smoothstep(0.5, 1.3, fp)) * (1.0 - smoothstep(1.7, 2.35, abs(dB)));
  float d = mix(dG, dB, wB);
  float range = mix(30.0, 2.5, wB);
  float land = smoothstep(fp * 0.6, -fp * 0.6, d);
  vec3 c = mix(uSea, uLand, land);
  // engraved water lines, ~9 px apart whatever the zoom, fading away from the coast
  float sp = fp * 9.0;
  float n = d / sp;
  float k = floor(n + 0.5);
  float wl = (1.0 - smoothstep(0.35, 0.95, abs(n - k) * 9.0)) * step(0.5, k) * step(k, 4.5) * step(d, range * 0.9);
  c = mix(c, uInk, wl * 0.24 * (1.0 - (k - 1.0) / 4.5));
  // one inland contour
  float il = (1.0 - smoothstep(0.35, 0.95, abs(d + sp * 1.2) / fp)) * step(-range * 0.9, d);
  c = mix(c, uInk, il * 0.12);
  c = mix(c, uInk, (1.0 - smoothstep(fp * 0.5, fp * 1.25, abs(d))) * 0.85);
  float edge = 1.0 - smoothstep(470.0, 630.0, length(vP));
  gl_FragColor = vec4(c, uOpacity * edge);
  ${FRAG_OUT}
}`;

export class Gulf extends Level {
  private mat: ShaderMaterial;
  constructor(gulf: Texture, bay: Texture) {
    super(5, O_AD, 2.8, 6.75);
    this.mat = new ShaderMaterial({
      uniforms: {
        uGulf: { value: gulf },
        uBay: { value: bay },
        uSea: { value: col(C.sea) },
        uLand: { value: col(C.land) },
        uInk: { value: col(C.ink) },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy * 100.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.group.add(ground(new Mesh(new PlaneGeometry(12.8, 12.8), this.mat), -9));
  }

  tags(): TagSpec[] {
    return [
      { at: [0, 0, 0], text: "Abu Dhabi", sLow: 4.55, sHigh: 5.85, cls: "r" },
      { at: [0.906, 0.83, 0], text: "Dubai", sLow: 4.75, sHigh: 6.3, cls: "r" },
    ];
  }

  update(fr: Frame) {
    this.mat.uniforms.uOpacity.value = sstep(6.7, 6.15, fr.s);
  }
}
