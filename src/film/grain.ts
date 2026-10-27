/**
 * Film grain: four small noise frames, drawn once, scaled up by the compositor
 * and cycled by a CSS steps() animation. No per-frame JavaScript, no shader pass.
 */
export function mountGrain(reduced: boolean) {
  const host = document.querySelector<HTMLElement>(".grain");
  if (!host) return;
  const draw = () => {
    host.replaceChildren();
    const w = Math.min(720, Math.ceil(innerWidth / 2));
    const h = Math.ceil((w * innerHeight) / innerWidth);
    const frames = reduced ? 1 : 4;
    for (let f = 0; f < frames; f++) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random();
        const a = Math.abs(v - 0.5) * 2;
        const lum = v > 0.5 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = lum;
        d[i + 3] = a * a * a * 15;
      }
      ctx.putImageData(img, 0, 0);
      host.appendChild(c);
    }
  };
  draw();
  let w = innerWidth;
  let t = 0;
  addEventListener("resize", () => {
    if (Math.abs(innerWidth - w) < 80) return;
    w = innerWidth;
    clearTimeout(t);
    t = window.setTimeout(draw, 400);
  });
}
