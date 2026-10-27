import type { Camera, Projected } from "./cam";
import type { EdgeData, FrameData, Layer } from "./layer";

/** No WebGL: the same edges and frames on a 2D canvas, without the robot or the pulses. */
export function createFlat(canvas: HTMLCanvasElement, mobile: boolean): Layer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let edges: EdgeData[] = [];
  let states: Float32Array = new Float32Array(0);
  let frames: FrameData[] = [];
  let W = 1;
  let H = 1;
  let dpr = 1;
  const p: Projected = { x: 0, y: 0, s: 1 };
  const COL = ["#c2cad6", "#d98a00", "#1f9d55"];

  const stroke = (c: Camera, e: EdgeData, upTo: number) => {
    const pts = e.pts;
    ctx.beginPath();
    for (let i = 0; i < pts.length / 2; i++) {
      if (e.cum[i] > upTo) {
        // stop exactly at the fill front
        const j = i - 1;
        const t = (upTo - e.cum[j]) / (e.cum[i] - e.cum[j] || 1);
        c.project(pts[j * 2] + (pts[i * 2] - pts[j * 2]) * t, pts[j * 2 + 1] + (pts[i * 2 + 1] - pts[j * 2 + 1]) * t, p);
        ctx.lineTo(p.x, p.y);
        break;
      }
      c.project(pts[i * 2], pts[i * 2 + 1], p);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  };

  return {
    kind: "flat",
    resize(w, h) {
      W = w;
      H = h;
      dpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    },
    setGraph(e) {
      edges = e;
    },
    setEdgeStates(s) {
      states = s;
    },
    setFrames(f) {
      frames = f;
    },
    render(c: Camera) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#f3f5f8";
      ctx.fillRect(0, 0, W, H);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const f of frames) {
        if (f.focus < 0.05) continue;
        const a = c.project(f.x0, f.y0, { x: 0, y: 0, s: 1 });
        const b = c.project(f.x1, f.y1, { x: 0, y: 0, s: 1 });
        ctx.strokeStyle = f.state === 2 ? "rgba(31,157,85,.35)" : "rgba(217,138,0,.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 24 * a.s);
        ctx.stroke();
      }
      edges.forEach((e, i) => {
        ctx.strokeStyle = COL[0];
        ctx.lineWidth = 1.6;
        stroke(c, e, Infinity);
        const fill = states[i * 4];
        if (fill > 0) {
          ctx.strokeStyle = COL[states[i * 4 + 1]] ?? COL[1];
          ctx.lineWidth = 2.6;
          stroke(c, e, fill);
        }
      });
      return { calls: 0, tris: 0 };
    },
    dispose() {},
  };
}
