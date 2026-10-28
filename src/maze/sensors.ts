import * as THREE from "three";
import { H, type Maze, W } from "./layout";
import { WALL_H, solidAt } from "./floor";
import type { Det } from "./props";

/**
 * What M4 sees from its own camera: an object detector (boxes, labels, confidences and track
 * IDs, the way a YOLO-style pipeline reports them), the camera's field of view on the floor,
 * a HUD for the first-person view, and a depth image.
 *
 * Walls hide things: a detection needs a clear line of sight from the lens, so flying over the
 * walls shows you more of the maze than rolling between them.
 */

/** how far the camera detects anything, in cells */
export const RANGE = 9;

const CLASSES: Record<string, { color: string; base: number }> = {
  block: { color: "#e4572e", base: 0.96 },
  trolley: { color: "#2f8f5b", base: 0.97 },
  robot: { color: "#3a6bf0", base: 0.94 },
  drone: { color: "#e8850f", base: 0.9 },
  pendulum: { color: "#7d72c4", base: 0.89 },
  poster: { color: "#8a5a2b", base: 0.86 },
  monitor: { color: "#2b8a8a", base: 0.93 },
};

export interface Track {
  key: string;
  id: number;
  cls: string;
  label: string;
  conf: number;
  box: THREE.Box3;
  /** when the detector last reported it */
  seen: number;
}

/** a line of sight from a to b that no wall slab crosses below the line */
function lineClear(m: Maze, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const n = Math.ceil(Math.hypot(dx, dz) / 0.1);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const s = solidAt(m, a.x + dx * t + W / 2, a.z + dz * t + H / 2);
    // only walls block the view; props are low and the things on them are what we look for
    if (s >= WALL_H - 1e-3 && a.y + dy * t < s) return false;
  }
  return true;
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h % 1000) / 100;
};

export class Detector {
  tracks = new Map<string, Track>();
  private next = 1;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private c = new THREE.Vector3();
  private probe = new THREE.Vector3();
  /** detections run at 10 Hz, like a real pipeline; boxes follow their objects every frame */
  private at = -1;

  update(now: number, eye: THREE.PerspectiveCamera, dets: Det[], m: Maze, jitter: boolean) {
    for (const d of dets) this.tracks.get(d.key)?.box.copy(d.box);
    if (now - this.at < 0.1) return;
    this.at = now;
    this.pv.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const p = eye.position;
    for (const d of dets) {
      const c = d.box.getCenter(this.c);
      const dist = c.distanceTo(p);
      if (dist > RANGE || !this.frustum.intersectsBox(d.box)) continue;
      // three probes up the object: the more of it the lens sees, the surer the detector
      let vis = 0;
      for (const f of [0.5, 0.92, 0.12]) {
        this.probe.set(c.x, d.box.min.y + (d.box.max.y - d.box.min.y) * f, c.z);
        if (lineClear(m, p, this.probe)) vis++;
      }
      if (!vis) continue;
      const k = CLASSES[d.cls] ?? { base: 0.85 };
      let conf = k.base - 0.24 * (dist / RANGE) ** 2 - (3 - vis) * 0.09;
      if (jitter) conf += 0.014 * Math.sin(now * 5.3 + hash(d.key));
      if (conf < 0.5) continue;
      let t = this.tracks.get(d.key);
      if (!t || now - t.seen > 2) {
        // lost for long enough, it comes back as a new track
        t = { key: d.key, id: this.next++, cls: d.cls, label: d.label, conf, box: d.box.clone(), seen: now };
        this.tracks.set(d.key, t);
      }
      t.conf = conf;
      t.label = d.label;
      t.seen = now;
    }
    for (const [k, t] of this.tracks) if (now - t.seen > 2) this.tracks.delete(k);
  }

  /** what the detector reports right now */
  live(now: number) {
    const out: Track[] = [];
    for (const t of this.tracks.values()) if (now - t.seen < 0.25) out.push(t);
    return out;
  }

  clear() {
    this.tracks.clear();
  }
}

/** the camera's view on the floor: rays across its field of view, each stopped by the first wall */
export function viewFan(m: Maze, x: number, z: number, y: number, heading: number, hfov: number, n = 30) {
  const pts: [number, number][] = [[x, z]];
  for (let i = 0; i <= n; i++) {
    const a = heading - hfov / 2 + (hfov * i) / n;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let d = 0.1;
    for (; d < RANGE; d += 0.08) {
      const s = solidAt(m, x + ca * d + W / 2, z + sa * d + H / 2);
      if (s >= WALL_H - 1e-3 && y < s) break;
    }
    pts.push([x + ca * d, z + sa * d]);
  }
  return pts;
}

/* ------------------------------------------------------------------ drawing, on a 2D canvas over the 3D one */

const v = new THREE.Vector3();
const corners = Array.from({ length: 8 }, () => new THREE.Vector3());

/** screen rectangle of a box seen by a camera, or null when any of it is behind the lens */
function screenRect(b: THREE.Box3, cam: THREE.Camera, w: number, h: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = corners[i].set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
    v.copy(c).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.05) return null;
    c.project(cam);
    const sx = ((c.x + 1) / 2) * w;
    const sy = ((1 - c.y) / 2) * h;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
  }
  if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) return null;
  return { x0, y0, x1, y1 };
}

export function drawDetections(k: CanvasRenderingContext2D, tracks: Track[], cam: THREE.Camera, w: number, h: number, font: string) {
  k.lineJoin = "round";
  k.font = `650 12px ${font}`;
  k.textBaseline = "middle";
  // nearest (largest) first: the first ten get a tag, the next six only a box, the rest wait their turn
  const rects = tracks
    .map((t) => ({ t, r: screenRect(t.box, cam, w, h) }))
    .filter((x): x is { t: Track; r: NonNullable<ReturnType<typeof screenRect>> } => !!x.r)
    .sort((a, b) => (b.r.x1 - b.r.x0) * (b.r.y1 - b.r.y0) - (a.r.x1 - a.r.x0) * (a.r.y1 - a.r.y0));
  let tags = 0;
  for (const { t, r } of rects.slice(0, 16)) {
    const pad = 3;
    // clip to the screen: an object bigger than the view keeps only the corners you can see
    const x0 = Math.max(1, r.x0 - pad);
    const y0 = Math.max(1, r.y0 - pad);
    const x1 = Math.min(w - 1, r.x1 + pad);
    const y1 = Math.min(h - 1, r.y1 + pad);
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw < 4 || bh < 4) continue;
    const col = CLASSES[t.cls]?.color ?? "#2b2118";
    // a thin box, with heavier corners
    k.strokeStyle = col;
    k.globalAlpha = 0.55;
    k.lineWidth = 1.25;
    k.strokeRect(x0, y0, bw, bh);
    k.globalAlpha = 1;
    k.lineWidth = 2.5;
    const c = Math.min(12, bw / 3, bh / 3);
    k.beginPath();
    for (const [cx, cy, sx, sy, on] of [
      [x0, y0, 1, 1, r.x0 - pad >= 1 && r.y0 - pad >= 1],
      [x1, y0, -1, 1, r.x1 + pad <= w - 1 && r.y0 - pad >= 1],
      [x0, y1, 1, -1, r.x0 - pad >= 1 && r.y1 + pad <= h - 1],
      [x1, y1, -1, -1, r.x1 + pad <= w - 1 && r.y1 + pad <= h - 1],
    ] as [number, number, number, number, boolean][]) {
      if (!on) continue;
      k.moveTo(cx + sx * c, cy);
      k.lineTo(cx, cy);
      k.lineTo(cx, cy + sy * c);
    }
    k.stroke();
    // the tag: class, confidence, track id
    if (++tags > 10) continue;
    const text = `${t.label} ${t.conf.toFixed(2)}`;
    const id = `#${t.id}`;
    const tw = k.measureText(text).width;
    const iw = k.measureText(id).width;
    const lw = tw + iw + 20;
    // above the box, or just inside its top when there's no room above
    const ly = y0 - 20 >= 0 ? y0 - 20 : y0 + 3;
    const lx = Math.max(2, Math.min(w - lw - 2, x0 - 1));
    k.fillStyle = col;
    k.beginPath();
    k.roundRect(lx, ly, lw, 18, 5);
    k.fill();
    k.fillStyle = "#fffaf1";
    k.fillText(text, lx + 7, ly + 9.5);
    k.globalAlpha = 0.7;
    k.fillText(id, lx + tw + 15, ly + 9.5);
    k.globalAlpha = 1;
  }
}

/** the camera's field of view, drawn on the floor as seen from the main camera */
export function drawFan(k: CanvasRenderingContext2D, pts: [number, number][], cam: THREE.Camera, w: number, h: number) {
  if (pts.length < 3) return;
  k.beginPath();
  for (let i = 0; i < pts.length; i++) {
    v.set(pts[i][0], 0.02, pts[i][1]).project(cam);
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    if (i) k.lineTo(x, y);
    else k.moveTo(x, y);
  }
  k.closePath();
  k.fillStyle = "rgba(58,107,240,0.12)";
  k.fill();
  k.strokeStyle = "rgba(58,107,240,0.55)";
  k.lineWidth = 1.5;
  k.setLineDash([5, 4]);
  k.stroke();
  k.setLineDash([]);
}

export interface Telemetry {
  heading: number;
  speed: number;
  alt: number;
  mode: string;
  count: number;
  detect: boolean;
}

/** first-person HUD: a heading tape and a line of telemetry, in the open part of the screen */
export function drawHud(k: CanvasRenderingContext2D, t: Telemetry, cx: number, top: number, bottom: number, font: string) {
  // heading on the board: 0° is "up" on the map (north), clockwise
  const deg = (((t.heading * 180) / Math.PI + 90) % 360 + 360) % 360;
  const tapeW = 300;
  const y = top + 18;
  k.save();
  k.font = `650 12px ${font}`;
  k.textAlign = "center";
  k.textBaseline = "middle";
  k.fillStyle = "rgba(43,33,24,0.55)";
  k.beginPath();
  k.roundRect(cx - tapeW / 2, y - 14, tapeW, 28, 14);
  k.fill();
  k.save();
  k.beginPath();
  k.rect(cx - tapeW / 2 + 10, y - 14, tapeW - 20, 28);
  k.clip();
  const pxPerDeg = 3;
  for (let d = Math.floor((deg - 60) / 15) * 15; d <= deg + 60; d += 15) {
    const x = cx + (d - deg) * pxPerDeg;
    const dd = ((d % 360) + 360) % 360;
    const name = dd === 0 ? "N" : dd === 90 ? "E" : dd === 180 ? "S" : dd === 270 ? "W" : "";
    k.fillStyle = name ? "#fffaf1" : "rgba(255,250,241,0.6)";
    if (name) k.fillText(name, x, y);
    else if (dd % 45 === 0) k.fillText(String(dd), x, y);
    else k.fillRect(x - 0.5, y - 4, 1, 8);
  }
  k.restore();
  k.fillStyle = "#e4572e";
  k.beginPath();
  k.moveTo(cx - 6, y - 20);
  k.lineTo(cx + 6, y - 20);
  k.lineTo(cx, y - 13);
  k.fill();
  k.fillStyle = "#fffaf1";
  k.font = `700 13px ${font}`;
  k.fillText(`${String(Math.round(deg) % 360).padStart(3, "0")}°`, cx, y + 26);

  // a small reticle in the middle of the view
  const my = (top + bottom) / 2;
  k.strokeStyle = "rgba(255,250,241,0.7)";
  k.lineWidth = 1.5;
  k.beginPath();
  k.moveTo(cx - 14, my);
  k.lineTo(cx - 5, my);
  k.moveTo(cx + 5, my);
  k.lineTo(cx + 14, my);
  k.moveTo(cx, my - 14);
  k.lineTo(cx, my - 5);
  k.moveTo(cx, my + 5);
  k.lineTo(cx, my + 14);
  k.stroke();

  // telemetry along the bottom
  const parts = [t.mode.toUpperCase(), `${t.speed.toFixed(1)} m/s`, `ALT ${t.alt.toFixed(2)} m`];
  if (t.detect) parts.push(`${t.count} OBJ`);
  const line = parts.join("   ·   ");
  k.font = `650 12.5px ${font}`;
  const lw = k.measureText(line).width + 36;
  k.fillStyle = "rgba(43,33,24,0.55)";
  k.beginPath();
  k.roundRect(cx - lw / 2, bottom - 40, lw, 26, 13);
  k.fill();
  k.fillStyle = "#fffaf1";
  k.fillText(line, cx, bottom - 27);
  k.restore();
}

/* ------------------------------------------------------------------ depth camera */

/** linear depth from the lens, as a turbo colour map: near is warm, far is cold */
export function depthMaterial(near: number, far: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: near }, uFar: { value: far } },
    vertexShader: /* glsl */ `
      varying float vD;
      #include <common>
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        vD = -mvPosition.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNear, uFar;
      varying float vD;
      // Google's polynomial fit of the Turbo colour map
      vec3 turbo(float x) {
        const vec4 kr4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
        const vec4 kg4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
        const vec4 kb4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
        const vec2 kr2 = vec2(-152.94239396, 59.28637943);
        const vec2 kg2 = vec2(4.27729857, 2.82956604);
        const vec2 kb2 = vec2(-89.90310912, 27.34824973);
        x = clamp(x, 0.0, 1.0);
        vec4 v4 = vec4(1.0, x, x * x, x * x * x);
        vec2 v2 = v4.zw * v4.z;
        return vec3(dot(v4, kr4) + dot(v2, kr2), dot(v4, kg4) + dot(v2, kg2), dot(v4, kb4) + dot(v2, kb2));
      }
      void main() {
        float t = clamp((vD - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(turbo(1.0 - sqrt(t)), 1.0);
      }`,
  });
}
