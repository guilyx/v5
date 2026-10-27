import * as THREE from "three";
import { canvasTex, mat } from "../kit";
import type { Prop } from "../props";

export const PAL = {
  paper: 0xf7f1e6,
  paperShade: 0xe9dfcd,
  ink: 0x2a2119,
  gold: 0xd5a53e,
  brass: 0xc29a52,
  steel: 0xb8bbc0,
  alu: 0xcfd0d2,
  graphite: 0x2f3032,
  black: 0x1c1b1a,
  rubber: 0x262422,
  cream: 0xf1e8d8,
  terracotta: 0xb8643f,
  leaf: 0x5d8a46,
  vermilion: 0xb03b16,
  navy: 0x1f2b44,
};

export interface Build {
  scene: THREE.Scene;
  props: Prop[];
  small: boolean;
  /** loaded once: his photo, for the badge and the card */
  avatar: HTMLImageElement | null;
  /** objects that only exist for the look (no hover), still collected so they can be counted */
  deco: THREE.Object3D[];
}

/** A flat printed surface: a plane facing +y with a canvas texture. */
export function printed(
  w: number,
  d: number,
  px: number,
  draw: (ctx: CanvasRenderingContext2D, cw: number, ch: number) => void,
  o: { rough?: number; basic?: boolean } = {},
): THREE.Mesh {
  const cw = px;
  const ch = Math.round((px * d) / w);
  const tex = canvasTex(cw, ch, draw);
  const material = o.basic
    ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    : mat(0xffffff, { map: tex, rough: o.rough ?? 0.85 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), material);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** A label stuck on a vertical face (facing +z). */
export function sticker(w: number, h: number, px: number, draw: (ctx: CanvasRenderingContext2D, cw: number, ch: number) => void, rough = 0.6): THREE.Mesh {
  const ch = Math.round((px * h) / w);
  const tex = canvasTex(px, ch, draw);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(0xffffff, { map: tex, rough }));
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** the brand mark: three dots on a triangle, joined by an open path */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string, accent: string) {
  const p = (u: number, v: number) => [x + u * s, y + v * s] as const;
  const a = p(0.5, 0.18);
  const b = p(0.2, 0.72);
  const c = p(0.8, 0.72);
  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.05;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.lineTo(...c);
  ctx.stroke();
  for (const [pt, col] of [
    [a, ink],
    [b, ink],
    [c, accent],
  ] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(pt[0], pt[1], s * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
}
