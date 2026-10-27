/**
 * One camera, shared by the DOM cards and the WebGL board, so a card's port and the
 * edge drawn into it always land on the same pixel.
 *
 * Board space is the layout's space: x right, y down, in CSS px at zoom 1.
 * World space (three.js) is the same plane at z = 0, with y flipped.
 * The camera only ever pitches (no yaw, no roll): horizontal board lines stay
 * horizontal on screen, so screen-aligned cards match the board they sit on.
 */

export interface Shot {
  /** board point the camera looks at */
  x: number;
  y: number;
  /** CSS px per board px at the target */
  zoom: number;
  /** radians; 0 = straight down */
  pitch: number;
}

export interface Projected {
  x: number;
  y: number;
  /** CSS px per board px at this point */
  s: number;
}

const FOV = (30 * Math.PI) / 180;
const TAN = Math.tan(FOV / 2);

export class Camera {
  readonly fov = FOV;
  W = 1;
  H = 1;
  /** CSS px per world unit at view depth 1 */
  focal = 1;
  /** distance from the camera to its target */
  dist = 1;
  /** where on screen the target sits (CSS px) */
  cx = 0;
  cy = 0;
  /** column-major, like three.js */
  readonly view = new Float32Array(16);
  readonly proj = new Float32Array(16);
  readonly pos = new Float32Array(3);
  private ax = new Float32Array(3);
  private ay = new Float32Array(3);
  private az = new Float32Array(3);
  private sx = 0;
  private sy = 0;
  near = 1;
  far = 1e5;

  set(shot: Shot, W: number, H: number, cx: number, cy: number) {
    this.W = W;
    this.H = H;
    this.cx = cx;
    this.cy = cy;
    this.focal = H / 2 / TAN;
    const D = this.focal / shot.zoom;
    this.dist = D;
    const sp = Math.sin(shot.pitch);
    const cp = Math.cos(shot.pitch);
    // target in world space
    const tx = shot.x;
    const ty = -shot.y;
    // camera sits "below" the target (towards later content) and up in z
    const px = tx;
    const py = ty - D * sp;
    const pz = D * cp;
    this.pos[0] = px;
    this.pos[1] = py;
    this.pos[2] = pz;
    // look-at basis (up = +y world), pitch only
    const az = this.az;
    az[0] = 0;
    az[1] = -sp;
    az[2] = cp;
    const ax = this.ax;
    ax[0] = 1;
    ax[1] = 0;
    ax[2] = 0;
    const ay = this.ay;
    ay[0] = 0;
    ay[1] = cp;
    ay[2] = sp;
    const v = this.view;
    v[0] = ax[0];
    v[4] = ax[1];
    v[8] = ax[2];
    v[1] = ay[0];
    v[5] = ay[1];
    v[9] = ay[2];
    v[2] = az[0];
    v[6] = az[1];
    v[10] = az[2];
    v[3] = 0;
    v[7] = 0;
    v[11] = 0;
    v[12] = -(ax[0] * px + ax[1] * py + ax[2] * pz);
    v[13] = -(ay[0] * px + ay[1] * py + ay[2] * pz);
    v[14] = -(az[0] * px + az[1] * py + az[2] * pz);
    v[15] = 1;

    this.near = Math.max(1, D * 0.02);
    this.far = D * 60 + 2e4;
    const f = 1 / TAN;
    const aspect = W / H;
    const n = this.near;
    const fa = this.far;
    this.sx = (cx / W) * 2 - 1;
    this.sy = 1 - (cy / H) * 2;
    const p = this.proj;
    p.fill(0);
    p[0] = f / aspect;
    p[5] = f;
    p[8] = -this.sx;
    p[9] = -this.sy;
    p[10] = (fa + n) / (n - fa);
    p[11] = -1;
    p[14] = (2 * fa * n) / (n - fa);
  }

  /** board → screen (CSS px), with the local scale */
  project(bx: number, by: number, out: Projected): Projected {
    const v = this.view;
    const wx = bx;
    const wy = -by;
    const vx = v[0] * wx + v[4] * wy + v[12];
    const vy = v[1] * wx + v[5] * wy + v[13];
    const vz = v[2] * wx + v[6] * wy + v[14];
    const w = Math.max(1e-3, -vz);
    const f = 1 / TAN;
    const nx = ((f * this.H) / this.W) * (vx / w) + this.sx;
    const ny = f * (vy / w) + this.sy;
    out.x = ((nx + 1) / 2) * this.W;
    out.y = ((1 - ny) / 2) * this.H;
    out.s = this.focal / w;
    return out;
  }

  /** screen (CSS px) → board point on the plane, or null above the horizon */
  unproject(x: number, y: number): { x: number; y: number } | null {
    const nx = (x / this.W) * 2 - 1 - this.sx;
    const ny = 1 - (y / this.H) * 2 - this.sy;
    const dvx = nx * TAN * (this.W / this.H);
    const dvy = ny * TAN;
    const dvz = -1;
    const ax = this.ax;
    const ay = this.ay;
    const az = this.az;
    const dx = ax[0] * dvx + ay[0] * dvy + az[0] * dvz;
    const dy = ax[1] * dvx + ay[1] * dvy + az[1] * dvz;
    const dz = ax[2] * dvx + ay[2] * dvy + az[2] * dvz;
    if (dz > -1e-4) return null;
    const t = -this.pos[2] / dz;
    return { x: this.pos[0] + t * dx, y: -(this.pos[1] + t * dy) };
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const ease = (t: number) => {
  // ease-in-out cubic: a calm start and a soft landing
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export function mixShot(a: Shot, b: Shot, t: number, out: Shot): Shot {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.zoom = Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), t));
  out.pitch = lerp(a.pitch, b.pitch, t);
  return out;
}
