/**
 * The same globe, drawn flat with Canvas 2D. It paints the first frame before three.js has
 * loaded, and it is the whole map on devices without WebGL (redrawn when the view settles).
 */
import { arcPoint, facing, project, silhouette, ll, type Cam, type V3 } from "./geo";
import type { LandDots } from "./land";
import { LEGS, at, legShape } from "./places";
import { INK } from "./palette";

export interface Frame {
  sun: V3;
  legs: Float32Array;
  activeLeg: number;
  time: number;
  /** 0 → 1: the pencilled route revealing itself on arrival */
  ghost: number;
}

const STEP = (0.25 * Math.PI) / 180;

export class Plate {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private land: LandDots,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(W: number, H: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
  }

  render(cam: Cam, fr: Frame) {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cam.W, cam.H);
    const R = silhouette(cam);

    // ocean
    const g = ctx.createRadialGradient(cam.cx, cam.cy, 0, cam.cx, cam.cy, R);
    g.addColorStop(0, INK.oceanDay);
    g.addColorStop(0.86, INK.oceanDay);
    g.addColorStop(1, INK.oceanRim);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cam.cx, cam.cy, R, 0, Math.PI * 2);
    ctx.fill();

    // graticule
    ctx.strokeStyle = INK.ink;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const line = (pt: (t: number) => V3, n: number) => {
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const p = pt(i / n);
        const pr = facing(cam, p) > 0 ? project(cam, p) : null;
        if (!pr) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(pr.x, pr.y);
        else ctx.moveTo(pr.x, pr.y);
        pen = true;
      }
    };
    for (let lat = -75; lat <= 75; lat += 15) line((t) => ll(lat, -180 + 360 * t), 120);
    for (let lon = -180; lon < 180; lon += 15) line((t) => ll(-80 + 160 * t, lon), 60);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // land, as halftone dots
    const { positions, levels, counts } = this.land;
    const pitchT = 5.2;
    const fineNear = (STEP * cam.f) / Math.max(0.05, cam.d - 1);
    const total = fineNear * 2 < pitchT * 0.7 ? counts[0] : fineNear < pitchT * 0.7 ? counts[0] + counts[1] : counts[0] + counts[1] + counts[2];
    const [cxv, cyv, czv] = cam.c;
    const [sx, sy, sz] = fr.sun;
    const horizon = 1 / cam.d;
    ctx.fillStyle = INK.land;
    ctx.beginPath();
    for (let i = 0; i < total; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const mu0 = x * cxv + y * cyv + z * czv;
      if (mu0 <= horizon) continue;
      const pr = project(cam, [x, y, z]);
      if (!pr || pr.x < -8 || pr.y < -8 || pr.x > cam.W + 8 || pr.y > cam.H + 8) continue;
      const fine = (STEP * cam.f) / pr.z;
      const own = fine * 2 ** (2 - levels[i]);
      const show = levels[i] < 0.5 ? 1 : Math.min(1, Math.max(0, (own - pitchT * 0.7) / (pitchT * 0.25)));
      if (show <= 0) continue;
      const pitch = Math.min(Math.max(pitchT, fine), fine * 4);
      const sun = x * sx + y * sy + z * sz;
      const day = Math.min(1, Math.max(0, (sun + 0.16) / 0.3));
      const mu = Math.max(0, (mu0 - horizon) / (1 - horizon));
      const r = (pitch * (0.54 + 0.14 * day) * (0.55 + 0.45 * Math.sqrt(mu)) * show) / 2;
      if (r < 0.35) continue;
      ctx.moveTo(pr.x + r, pr.y);
      ctx.arc(pr.x, pr.y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // routes: pencilled where planned, inked where travelled
    ctx.lineCap = "round";
    LEGS.forEach((leg, li) => {
      const a = at(leg.from);
      const b = at(leg.to);
      const { lift, bow } = legShape(leg);
      const prog = fr.legs[li];
      const draw = (t0: number, t1: number) => {
        ctx.beginPath();
        line((t) => arcPoint(a, b, t0 + (t1 - t0) * t, lift, bow), 80);
        ctx.stroke();
      };
      if (prog < 1 && fr.ghost > 0 && leg.kind !== "collab") {
        ctx.strokeStyle = INK.pencil;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([1.5, 5.5]);
        draw(prog, Math.max(prog, fr.ghost));
      }
      if (prog > 0) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = leg.kind === "collab" ? INK.collab : INK.route;
        ctx.lineWidth = cam.W < 700 ? 2.6 : 3;
        ctx.setLineDash(leg.kind === "collab" ? [9, 6] : []);
        draw(0, prog);
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    });
  }
}
