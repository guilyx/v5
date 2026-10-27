import { CanvasTexture, Color, CustomBlending, DataTexture, Group, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RedFormat, SRGBColorSpace, Texture, TextureLoader } from "three";
import type { Material, Mesh, PerspectiveCamera } from "three";
import type { V3 } from "./world";

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** smoothstep that also works with e0 > e1 (a falling edge) */
export const sstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** The palette: printed plates, warm paper, ink, one accent per level. */
export const C = {
  paper: "#f5f0e6",
  paper2: "#e9e1d1",
  ink: "#1c1b19",
  sea: "#a8c3c2",
  land: "#e3d1a8",
  water: "#5f9698",
  waterDeep: "#4e8588",
  waterLight: "#9cc6c0",
  vermilion: "#d2491f",
  pcb: "#2d5a48",
  trace: "#3d785d",
  gold: "#d4ae62",
  silver: "#bdbab2",
  die: "#4d4664",
  copper: "#cf9862",
};
export const col = (hex: string) => new Color(hex);

/** A DOM label pinned to a point of a level (local units), shown for sLow <= s <= sHigh. */
export interface TagSpec {
  at: V3;
  text: string;
  sLow: number;
  sHigh: number;
  cls: string;
  test?: () => boolean;
}

/** Everything a level needs to know about the current frame. */
export interface Frame {
  s: number;
  /** focus, metres */
  F: V3;
  dt: number;
  t: number;
  reduced: boolean;
  /** CSS px per view unit (10^s metres) */
  ref: number;
  dpr: number;
  /** pointer in metres on the focal plane, or null */
  pointer: V3 | null;
  camera: PerspectiveCamera;
}

export abstract class Level {
  readonly group = new Group();
  /** k: the level's unit is 10^k metres; visible while sLow <= s <= sHigh */
  constructor(
    readonly k: number,
    readonly origin: V3,
    readonly sLow: number,
    readonly sHigh: number,
  ) {
    this.group.matrixAutoUpdate = true;
  }
  visibleAt(s: number) {
    return s >= this.sLow && s <= this.sHigh;
  }
  /** scale-relative placement: (origin - F) * 10^-s, scaled by 10^(k-s) */
  place(fr: Frame) {
    const u = Math.pow(10, -fr.s);
    this.group.position.set((this.origin[0] - fr.F[0]) * u, (this.origin[1] - fr.F[1]) * u, (this.origin[2] - fr.F[2]) * u);
    this.group.scale.setScalar(Math.pow(10, this.k - fr.s));
  }
  abstract update(fr: Frame): void;
  tags(): TagSpec[] {
    return [];
  }
  /** true while this level has motion of its own (keeps the loop running) */
  animating(_fr: Frame): boolean {
    return false;
  }
  /** a click on the canvas (metres on the focal plane); return true if used */
  click(_p: V3, _fr: Frame): boolean {
    return false;
  }
}

/** A 3-tone ramp for MeshToonMaterial: the clean, banded shading of a printed illustration. */
let toonRamp: DataTexture | null = null;
export function ramp() {
  if (toonRamp) return toonRamp;
  toonRamp = new DataTexture(new Uint8Array([120, 190, 255]), 3, 1, RedFormat);
  toonRamp.minFilter = toonRamp.magFilter = NearestFilter;
  toonRamp.generateMipmaps = false;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

export function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, px: number) => void, mips = true): Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  draw(g, size);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (!mips) {
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
  } else tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

export function loadTexture(url: string, mips = true): Promise<Texture> {
  return new Promise((res, rej) =>
    new TextureLoader().load(
      url,
      (t) => {
        t.generateMipmaps = mips;
        t.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
        t.magFilter = LinearFilter;
        res(t);
      },
      undefined,
      rej,
    ),
  );
}

/** seeded PRNG so the boards, dies and mazes are the same on every visit */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared GLSL: colour output with the renderer's colour space. */
export const FRAG_OUT = /* glsl */ `#include <colorspace_fragment>`;

/**
 * Flat "ground" layers (globe-to-water maps, shadows on the water) are painted
 * first, in order, without depth: they blend like transparent layers but sit
 * in the opaque pass, so every 3D object is drawn on top of them.
 */
export function ground<T extends Mesh>(mesh: T, order: number): T {
  const m = mesh.material as Material;
  m.transparent = false;
  m.blending = CustomBlending;
  m.blendSrc = SrcAlphaFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.depthTest = false;
  m.depthWrite = false;
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return mesh;
}
