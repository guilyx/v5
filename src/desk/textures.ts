import * as THREE from "three";
import { canvasTex, paperFill, rng } from "./kit";

/** Oiled oak, grain running along the desk (x). Tiles horizontally. */
export function oakTexture(w: number, h: number): THREE.CanvasTexture {
  return canvasTex(w, h, (ctx) => {
    const r = rng(1914);
    // base: warm honey oak with broad, soft colour bands
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#c39a72");
    g.addColorStop(0.5, "#c8a078");
    g.addColorStop(1, "#bd946b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const wave = (y0: number, a1: number, k1: number, p1: number, a2: number, k2: number, p2: number) => (x: number) =>
      y0 + a1 * Math.sin((Math.PI * 2 * k1 * x) / w + p1) + a2 * Math.sin((Math.PI * 2 * k2 * x) / w + p2);

    // broad bands (heartwood/sapwood variation)
    for (let i = 0; i < 46; i++) {
      const f = wave(r() * h, 4 + r() * 18, 1 + Math.floor(r() * 2), r() * 6, 2 + r() * 6, 2 + Math.floor(r() * 3), r() * 6);
      const th = 8 + r() * 46;
      const dark = r() < 0.6;
      ctx.fillStyle = dark ? `rgba(110,64,28,${0.03 + r() * 0.06})` : `rgba(240,200,150,${0.04 + r() * 0.07})`;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, f(x));
      for (let x = w; x >= 0; x -= 16) ctx.lineTo(x, f(x) + th);
      ctx.closePath();
      ctx.fill();
    }

    // fine grain lines
    for (let i = 0; i < 900; i++) {
      const f = wave(r() * h, 1 + r() * 8, 1 + Math.floor(r() * 3), r() * 6, r() * 3, 3 + Math.floor(r() * 4), r() * 6);
      ctx.strokeStyle = `rgba(96,56,24,${0.04 + r() * 0.16})`;
      ctx.lineWidth = 0.5 + r() * 1.6;
      const x0 = r() * w;
      const len = w * (0.2 + r() * 0.9);
      // the part past the right edge is drawn again shifted left by one tile, so the texture
      // wraps without a seam (a canvas path is fixed when built, so it is rebuilt with the offset)
      for (const shift of x0 + len > w ? [0, -w] : [0]) {
        ctx.beginPath();
        for (let x = x0; x <= x0 + len; x += 14) ctx.lineTo(x + shift, f(x));
        ctx.stroke();
      }
    }

    // pores and a whisper of sheen: short dashes along the grain, wrapped at the seam
    const dash = (n: number, rgb: string, a0: number, a1: number, l0: number, l1: number) => {
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(${rgb},${a0 + r() * a1})`;
        const x = r() * w;
        const y = r() * h;
        const l = l0 + r() * l1;
        ctx.fillRect(x, y, l, 1);
        if (x + l > w) ctx.fillRect(x - w, y, l, 1);
      }
    };
    dash(7000, "70,40,15", 0.1, 0.2, 2, 9);
    dash(2600, "255,230,190", 0.05, 0.08, 3, 14);
  });
}

/** A soft blurred shape used as a contact shadow under every object. White = shadow (used as alpha). */
export function blobTexture(round: boolean): THREE.CanvasTexture {
  // drawn white-on-black: alphaMap reads the colour channels, not the canvas alpha
  return canvasTex(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      if (round) {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, "#fff");
        g.addColorStop(0.35, "#bbb");
        g.addColorStop(0.7, "#333");
        g.addColorStop(1, "#000");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      } else {
        // a rounded rect drawn off-canvas, keeping only its blurred shadow
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 30;
        ctx.shadowOffsetX = 1000;
        ctx.fillStyle = "#fff";
        const m = 52;
        ctx.beginPath();
        ctx.roundRect(m - 1000, m, w - m * 2, h - m * 2, 26);
        ctx.fill();
      }
    },
    false,
  );
}

export function paperTexture(): THREE.CanvasTexture {
  const t = canvasTex(512, 512, (ctx, w, h) => paperFill(ctx, w, h, "#ffffff", 3));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
