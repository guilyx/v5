import * as THREE from "three";
import type { Frame } from "../core/world";

/** A scene's root group, placed on the route and turned to face along it. */
export function placed(f: Frame): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(f.origin);
  g.rotation.y = f.yaw;
  return g;
}

/** An empty point in a scene for labels to hang from. */
export function anchor(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/**
 * Text drawn on a canvas, for things that are surfaces in the world rather
 * than labels over it (a paper's title page, a die marking).
 */
export function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Word-wrap for canvas text. Returns the y after the last line. */
export function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): number {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}

/** Points along a polyline by arc length, 0..1. */
export class Path {
  private lens: number[] = [0];
  readonly total: number;
  constructor(readonly pts: THREE.Vector3[]) {
    let t = 0;
    for (let i = 1; i < pts.length; i++) {
      t += pts[i].distanceTo(pts[i - 1]);
      this.lens.push(t);
    }
    this.total = t;
  }
  at(f: number, out = new THREE.Vector3()): THREE.Vector3 {
    const d = Math.min(1, Math.max(0, f)) * this.total;
    let i = 1;
    while (i < this.lens.length - 1 && this.lens[i] < d) i++;
    const a = this.lens[i - 1];
    const b = this.lens[i];
    return out.copy(this.pts[i - 1]).lerp(this.pts[i], b > a ? (d - a) / (b - a) : 0);
  }
  /** Heading (unit vector) at f. */
  dir(f: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.5 / Math.max(1, this.total);
    return out.copy(this.at(f + e)).sub(this.at(f - e)).normalize();
  }
}

/** A line whose visible length is drawn on with setDrawRange — for plans that "draw themselves". */
export function drawableLine(pts: THREE.Vector3[], mat: THREE.Material): { line: THREE.Line; set: (f: number) => void } {
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, mat);
  return {
    line,
    set: (f) => geo.setDrawRange(0, Math.max(0, Math.round(f * pts.length))),
  };
}
