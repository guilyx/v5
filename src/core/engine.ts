import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { ink, isCoarse } from "./util";

/** Vignette + film grain, applied after tone mapping. Keeps the dark ground from banding. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d) * uVignette);
      c.rgb *= mix(0.72, 1.0, v);
      float n = hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
      c.rgb += n * 0.028;
      gl_FragColor = c;
    }
  `,
};

export type Tier = "high" | "low";

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fog: THREE.FogExp2;
  readonly tier: Tier;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private dpr: number;
  private maxDpr: number;
  private slowFrames = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    const lowEnd =
      isCoarse() || (navigator.hardwareConcurrency ?? 8) <= 4 || Math.min(innerWidth, innerHeight) < 600;
    this.tier = lowEnd ? "low" : "high";
    this.maxDpr = Math.min(devicePixelRatio || 1, lowEnd ? 1.5 : 1.75);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // no tone curve: the brand colours are exact, and only what's pushed past 1.0 blooms
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene.background = ink.deep.clone();
    this.fog = new THREE.FogExp2(ink.deep.getHex(), 0.0065);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 6000);
    this.camera.position.set(0, 20, 60);

    const hemi = new THREE.HemisphereLight(0xc8cce0, 0x0b0c11, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(0.4, 1, 0.3);
    const rim = new THREE.DirectionalLight(ink.accent.getHex(), 0.6);
    rim.position.set(-0.6, 0.3, -1);
    this.scene.add(hemi, key, rim);

    this.setupComposer();
    addEventListener("resize", () => this.resize());
  }

  private setupComposer() {
    const size = new THREE.Vector2(innerWidth, innerHeight);
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.tier === "high") {
      this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.75, 0.5, 0.78);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    this.composer = composer;
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(innerWidth, innerHeight);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  /**
   * Drops the pixel ratio a notch when frames run long for a while, so a
   * weaker GPU gets a softer image instead of a stutter.
   */
  adapt(dt: number) {
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.dpr > 0.75) {
      this.dpr = Math.max(0.75, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.composer?.setPixelRatio(this.dpr);
      this.resize();
      this.slowFrames = 0;
    }
  }

  setBloom(strength: number) {
    if (this.bloom) this.bloom.strength = strength;
  }

  render(time: number) {
    if (this.grade) this.grade.uniforms.uTime.value = time;
    this.composer!.render();
  }
}
