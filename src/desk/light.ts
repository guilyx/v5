import * as THREE from "three";
import { DESK, WALL_Z } from "./world";

/* One sun through the window (the only shadow-casting light), a warm sky fill and a soft
   bounce from the room. The sun's angle and colour follow the time of day. */

export type LightMode = "morning" | "midday" | "golden" | "evening";
export const LIGHT_MODES: LightMode[] = ["morning", "midday", "golden", "evening"];

interface Preset {
  az: number; // azimuth of the light's travel, 0 = straight from the window toward you
  el: number; // elevation
  sun: number;
  sunI: number;
  sky: number;
  ground: number;
  hemiI: number;
  fillI: number;
  bg: number;
  exposure: number;
  lamp: number;
  skyTint: number;
  /** the warm pool of the desk lamp (evening only) */
  spotI: number;
  env: number;
  label: string;
}

const PRESETS: Record<LightMode, Preset> = {
  morning: { az: -0.5, el: 0.62, sun: 0xffe2bd, sunI: 3.6, sky: 0xfdf3e6, ground: 0x8c6c4e, hemiI: 1.05, fillI: 0.45, bg: 0x6f5642, exposure: 1.0, lamp: 0, skyTint: 0xfff4e6, spotI: 0, env: 0.42, label: "Morning light" },
  midday: { az: -0.1, el: 0.86, sun: 0xfff5e8, sunI: 3.6, sky: 0xfbf6ee, ground: 0x8f7052, hemiI: 1.1, fillI: 0.45, bg: 0x735a45, exposure: 1.0, lamp: 0, skyTint: 0xffffff, spotI: 0, env: 0.42, label: "Midday light" },
  golden: { az: 0.46, el: 0.52, sun: 0xffcf9a, sunI: 3.6, sky: 0xffe8d2, ground: 0x7d5234, hemiI: 0.95, fillI: 0.4, bg: 0x6a4c36, exposure: 1.0, lamp: 0, skyTint: 0xffd6a6, spotI: 0, env: 0.4, label: "Golden hour" },
  evening: { az: Math.PI + 0.6, el: 1.0, sun: 0xffc690, sunI: 1.1, sky: 0x6f7396, ground: 0x2a1c14, hemiI: 0.5, fillI: 0.12, bg: 0x241b16, exposure: 1.0, lamp: 1, skyTint: 0x34405f, spotI: 1, env: 0.14, label: "Evening, lamp on" },
};

export function modeForHour(h: number): LightMode {
  if (h >= 6 && h < 10.5) return "morning";
  if (h >= 10.5 && h < 15.5) return "midday";
  if (h >= 15.5 && h < 19.5) return "golden";
  return "evening";
}

const lerpAngle = (a: number, b: number, t: number) => a + (b - a) * t;

export class LightRig {
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1.3);
  fill = new THREE.DirectionalLight(0xffffff, 0.5);
  /** a desk lamp's warm pool that travels with you in the evening; it casts no shadow, so moving it is free */
  spot = new THREE.SpotLight(0xffcf98, 0, 0, 0.52, 1, 1.4);
  mode: LightMode;
  private cur: Preset;
  private from: Preset;
  private to: Preset;
  private t = 1;
  /** the sun aims at the middle of the desk and never moves with the camera, so shadow texels stay put */
  private center = new THREE.Vector3((DESK.x0 + DESK.x1) / 2, 0, (DESK.z0 + DESK.z1) / 2);
  private span = 44;
  private shadowCx = Number.NaN;
  private mapW: number;
  private mapH: number;
  /** set when the shadow map must be redrawn */
  dirty = true;
  /** listeners for the lamp glow etc. */
  onLamp: (v: number) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    mode: LightMode,
    small: boolean,
  ) {
    this.mode = mode;
    this.cur = { ...PRESETS[mode] };
    this.from = { ...this.cur };
    this.to = { ...this.cur };
    this.mapW = small ? 1024 : 2048;
    this.mapH = this.mapW / 2;

    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(this.mapW, this.mapH);
    s.shadow.radius = small ? 3 : 4.5;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.025;
    s.shadow.intensity = 1;
    scene.add(s, s.target, this.hemi, this.fill, this.fill.target, this.spot, this.spot.target);
    this.spot.castShadow = false;
    this.fill.position.set(-6, 14, 18);
    this.fill.castShadow = false;
    this.apply();
  }

  label() {
    return PRESETS[this.mode].label;
  }

  setMode(mode: LightMode, instant: boolean) {
    this.mode = mode;
    this.from = { ...this.cur };
    this.to = { ...PRESETS[mode] };
    this.t = instant ? 1 : 0;
    if (instant) this.cur = { ...this.to };
    this.apply();
  }

  /** follow the camera along the desk; the shadow map covers a window around it */
  follow(x: number, overview: boolean) {
    this.spot.position.set(x - 2.5, 15, 4.5);
    this.spot.target.position.set(x + 0.5, 0, -1);
    const span = overview ? DESK.x1 - DESK.x0 + 10 : 46;
    const cx = overview ? (DESK.x0 + DESK.x1) / 2 : x;
    if (span !== this.span || Number.isNaN(this.shadowCx) || Math.abs(cx - this.shadowCx) > (overview ? 1e9 : 9)) {
      this.span = span;
      this.shadowCx = cx;
      this.fitShadow();
      this.dirty = true;
    }
  }

  /** returns true while a light change is still animating */
  update(dt: number): boolean {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / 1.3);
    const e = this.t * this.t * (3 - 2 * this.t);
    const a = this.from;
    const b = this.to;
    const c = this.cur;
    c.az = lerpAngle(a.az, b.az, e);
    c.el = a.el + (b.el - a.el) * e;
    c.sunI = a.sunI + (b.sunI - a.sunI) * e;
    c.hemiI = a.hemiI + (b.hemiI - a.hemiI) * e;
    c.fillI = a.fillI + (b.fillI - a.fillI) * e;
    c.exposure = a.exposure + (b.exposure - a.exposure) * e;
    c.lamp = a.lamp + (b.lamp - a.lamp) * e;
    c.spotI = a.spotI + (b.spotI - a.spotI) * e;
    c.env = a.env + (b.env - a.env) * e;
    this.mix(a, b, e);
    if (this.t >= 1) this.cur = { ...b };
    this.apply();
    return this.t < 1;
  }

  private colA = new THREE.Color();
  private colB = new THREE.Color();
  private mixed: Record<"sun" | "sky" | "ground" | "bg" | "skyTint", THREE.Color> = {
    sun: new THREE.Color(),
    sky: new THREE.Color(),
    ground: new THREE.Color(),
    bg: new THREE.Color(),
    skyTint: new THREE.Color(),
  };
  /** the colour of the sky seen through the windows */
  skyTint = this.mixed.skyTint;
  private mix(a: Preset, b: Preset, e: number) {
    for (const k of ["sun", "sky", "ground", "bg", "skyTint"] as const) {
      this.mixed[k].copy(this.colA.setHex(a[k])).lerp(this.colB.setHex(b[k]), e);
    }
  }

  background = new THREE.Color();

  private apply() {
    const c = this.cur;
    if (this.t >= 1) this.mix(c, c, 0);
    const d = new THREE.Vector3(Math.sin(c.az) * Math.cos(c.el), -Math.sin(c.el), Math.cos(c.az) * Math.cos(c.el));
    this.sun.position.copy(this.center).addScaledVector(d, -90);
    this.sun.target.position.copy(this.center);
    this.sun.color.copy(this.mixed.sun);
    this.sun.intensity = c.sunI;
    this.hemi.color.copy(this.mixed.sky);
    this.hemi.groundColor.copy(this.mixed.ground);
    this.hemi.intensity = c.hemiI;
    this.fill.intensity = c.fillI;
    this.fill.color.copy(this.mixed.sky);
    this.background.copy(this.mixed.bg);
    this.renderer.toneMappingExposure = c.exposure;
    this.spot.intensity = c.spotI * 125;
    this.scene.environmentIntensity = c.env;
    this.onLamp(c.lamp);
    this.fitShadow();
    this.dirty = true;
  }

  /** fit the sun's orthographic shadow camera to a window of the desk, snapped to whole texels */
  private fitShadow() {
    const cx = Number.isNaN(this.shadowCx) ? 0 : this.shadowCx;
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();

    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;

    const half = this.span / 2;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [cx - half, cx + half])
      for (const y of [-0.2, 5])
        for (const z of [DESK.z0, DESK.z1]) {
          p.set(x, y, z).applyMatrix4(inv);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
    // the wall that shapes the light must sit inside the depth range
    for (const x of [cx - half, cx + half])
      for (const y of [-4, 27]) {
        p.set(x, y, WALL_Z).applyMatrix4(inv);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
    // square texels: width sets the texel size, height is allocated generously
    const ts = (maxX - minX + 2) / this.mapW;
    const w = ts * this.mapW;
    const h = ts * this.mapH;
    const midX = Math.round((minX + maxX) / 2 / ts) * ts;
    const midY = Math.round((minY + maxY) / 2 / ts) * ts;
    cam.left = midX - w / 2;
    cam.right = midX + w / 2;
    cam.bottom = midY - h / 2;
    cam.top = midY + h / 2;
    cam.near = Math.max(0.1, -maxZ - 2);
    cam.far = -minZ + 2;
    cam.updateProjectionMatrix();
  }
}
