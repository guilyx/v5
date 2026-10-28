import * as THREE from "three";

export const SERIF = '"Instrument Serif", Georgia, serif';
export const SANS = '"Geist Variable", system-ui, sans-serif';

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A canvas atlas with a simple shelf packer. Everything painted on the floor lives in one texture. */
export class Atlas {
  canvas = document.createElement("canvas");
  ctx: CanvasRenderingContext2D;
  private cx = 0;
  private cy = 0;
  private row = 0;
  constructor(public size = 2048) {
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d")!;
  }
  alloc(w: number, h: number): Slot {
    w = Math.ceil(w) + 4;
    h = Math.ceil(h) + 4;
    if (this.cx + w > this.size) {
      this.cx = 0;
      this.cy += this.row;
      this.row = 0;
    }
    const s = { x: this.cx + 2, y: this.cy + 2, w: w - 4, h: h - 4 };
    this.cx += w;
    this.row = Math.max(this.row, h);
    return s;
  }
  private queued: { w: number; h: number; draw: (c: CanvasRenderingContext2D, s: Slot) => void; done: (uv: [number, number, number, number], s: Slot) => void }[] = [];
  /** queue a drawing; flush() packs the tallest first so little space is wasted */
  queue(w: number, h: number, draw: (c: CanvasRenderingContext2D, s: Slot) => void, done: (uv: [number, number, number, number], s: Slot) => void) {
    this.queued.push({ w, h, draw, done });
  }
  flush() {
    this.queued.sort((a, b) => b.h - a.h);
    for (const q of this.queued) {
      const s = this.alloc(q.w, q.h);
      this.ctx.save();
      this.ctx.translate(s.x, s.y);
      q.draw(this.ctx, s);
      this.ctx.restore();
      q.done(this.uv(s), s);
    }
    this.queued = [];
  }
  texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  /** uv rectangle [u0, v0, u1, v1] for a slot (texture is flipped: v grows upward) */
  uv(s: Slot): [number, number, number, number] {
    const S = this.size;
    return [s.x / S, 1 - (s.y + s.h) / S, (s.x + s.w) / S, 1 - s.y / S];
  }
}

/**
 * A flat quad lying on the floor (or standing up, with `tilt`), centred on (cx, cz).
 * Merged together, every decal of the toy is one draw call.
 */
export function quad(
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  uv: [number, number, number, number],
  rotY = 0,
  tilt = -Math.PI / 2,
) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) {
    a.setXY(i, a.getX(i) ? uv[2] : uv[0], a.getY(i) ? uv[3] : uv[1]);
  }
  g.rotateX(tilt);
  g.rotateY(rotY);
  g.translate(cx, cy, cz);
  return g;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, maxW: number) {
  ctx.font = font(px);
  let w = ctx.measureText(text).width;
  while (w > maxW && px > 8) {
    px -= 2;
    ctx.font = font(px);
    w = ctx.measureText(text).width;
  }
  return px;
}

/** Wrap text into lines that fit a width. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  // letter-spacing on canvas without relying on ctx.letterSpacing support
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  return cx - x - tracking;
}

export function spacedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
