import * as THREE from "three";
import { H, MAIN_DOOR, OUTDOOR, W, outdoors, worldToCell } from "./layout";
import { FRAME_H, WALL_T } from "./floor";
import { LIGHT, LIGHT_GLSL, PAL, clay } from "./gfx";
import { SANS, spaced, spacedWidth } from "./paint";

/**
 * Inside and outside, for the views from the robot. Seen from above, the maze is a toy on a table;
 * ride along, and the first rooms are under a ceiling, inside a building with a glass front, while
 * from TII on you're out under the Abu Dhabi sky. Only the ride-along views show any of this.
 */

export const CEIL = 2.9;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always at the back
}
`;
const SKY_FS = /* glsl */ `
uniform vec3 uZenith, uHorizon, uSand, uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // a pale, hazy horizon under a deep sky, and the desert going on below it
  vec3 c = up > 0.0 ? mix(uHorizon, uZenith, pow(up, 0.55)) : mix(uHorizon, uSand, smoothstep(0.0, 0.12, -up));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 1.2 + pow(s, 12.0) * 0.18);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** a ceiling of acoustic tiles with a light panel every few tiles */
function ceilingTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const k = c.getContext("2d")!;
  k.fillStyle = "#f4efe6";
  k.fillRect(0, 0, 256, 256);
  k.strokeStyle = "#d8cfc0";
  k.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    k.beginPath();
    k.moveTo(i * 64, 0);
    k.lineTo(i * 64, 256);
    k.moveTo(0, i * 64);
    k.lineTo(256, i * 64);
    k.stroke();
  }
  k.fillStyle = "#fffdf6";
  k.fillRect(70, 70, 116, 52);
  k.strokeStyle = "#e6dccb";
  k.strokeRect(70, 70, 116, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** glazing: mullions and transoms over a faint tint */
function glassTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const k = c.getContext("2d")!;
  k.fillStyle = "rgba(170,205,220,0.16)";
  k.fillRect(0, 0, 256, 128);
  k.fillStyle = "rgba(60,64,70,0.95)";
  k.fillRect(0, 0, 256, 6);
  k.fillRect(0, 122, 256, 6);
  k.fillRect(0, 60, 256, 4);
  k.fillRect(0, 0, 5, 128);
  k.fillRect(126, 0, 5, 128);
  k.fillRect(251, 0, 5, 128);
  // a highlight across each pane
  k.fillStyle = "rgba(255,255,255,0.18)";
  k.beginPath();
  k.moveTo(20, 120);
  k.lineTo(60, 8);
  k.lineTo(76, 8);
  k.lineTo(36, 120);
  k.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Sky {
  /** the sky around the camera */
  dome: THREE.Mesh;
  /** the ceiling, the building's upper walls and its glass front */
  shell = new THREE.Group();
  private zenith = new THREE.Color("#4f8fd6");
  readonly hazeColor = new THREE.Color("#e9dcc4");
  readonly insideColor = new THREE.Color(PAL.table);
  private bg = new THREE.Color();
  /** 0 inside, 1 out, eased */
  out = 0;

  constructor() {
    const L = LIGHT.uLightDir.value;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: this.zenith },
          uHorizon: { value: this.hazeColor },
          uSand: { value: new THREE.Color("#dcc095") },
          uSunDir: { value: L.clone() },
        },
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.dome.visible = false;

    const gx = (x: number) => x - W / 2;
    const gz = (z: number) => z - H / 2;
    // the building: everything north of the outdoor line, and east of the TII wing
    const wx = OUTDOOR.west.x + 0.5;
    const sy = OUTDOOR.south + 0.5;
    const wy = OUTDOOR.west.y + 0.5;
    const tex = ceilingTexture();
    const ceilMat = clay({ map: tex, emissive: 0.35 });
    const rects: [number, number, number, number][] = [
      [0.5, 0.5, wx, wy],
      [wx, 0.5, W - 0.5, sy],
    ];
    for (const [x0, z0, x1, z1] of rects) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      // facing down: from above it's culled, so it never hides the board
      g.rotateX(Math.PI / 2);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / 4, (uv.getY(i) * (z1 - z0)) / 4);
      const m = new THREE.Mesh(g, ceilMat);
      m.position.set(gx((x0 + x1) / 2), CEIL, gz((z0 + z1) / 2));
      this.shell.add(m);
    }
    // the outer walls, from the frame's top to the ceiling: plaster
    const wallMat = clay({ color: PAL.plaster, side: THREE.DoubleSide });
    const upper = (ax: number, az: number, bx: number, bz: number, mat: THREE.Material, glass = false) => {
      const len = Math.hypot(bx - ax, bz - az);
      const h = CEIL - FRAME_H;
      const g = new THREE.PlaneGeometry(len, h);
      if (glass) {
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * len) / 2.4);
      }
      const m = new THREE.Mesh(g, mat);
      m.position.set(gx((ax + bx) / 2), FRAME_H + h / 2, gz((az + bz) / 2));
      m.rotation.y = -Math.atan2(bz - az, bx - ax);
      this.shell.add(m);
    };
    upper(0.5, 0.5, W - 0.5, 0.5, wallMat);
    upper(0.5, 0.5, 0.5, wy, wallMat);
    upper(W - 0.5, 0.5, W - 0.5, sy, wallMat);
    // the front: glass, so you see the desert from inside and the building from out
    const gt = glassTexture();
    const glass = new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    upper(0.5, wy, wx, wy, glass, true);
    upper(wx, wy, wx, sy, glass, true);
    upper(wx, sy, W - 0.5, sy, glass, true);
    this.shell.visible = false;
  }

  /** is a world position outdoors? */
  static outside(x: number, z: number) {
    const [cx, cy] = worldToCell(x, z);
    return outdoors(cx, cy);
  }

  /**
   * Before a render: show the sky and the building's shell (ride-along views only), centred on the
   * camera, and blend the fog and background between the building and the outdoors.
   */
  prepare(scene: THREE.Scene, at: THREE.Vector3, show: boolean, dt: number, reduced: boolean) {
    const target = show && Sky.outside(at.x, at.z) ? 1 : 0;
    const k = reduced || !dt ? 1 : 1 - Math.exp(-dt / 0.35);
    this.out += (target - this.out) * k;
    if (Math.abs(this.out - target) < 0.002) this.out = target;
    this.dome.visible = this.shell.visible = show;
    this.dome.position.copy(at);
    this.bg.copy(this.insideColor).lerp(this.hazeColor, this.out);
    (scene.background as THREE.Color).copy(this.bg);
    (scene.fog as THREE.Fog).color.copy(this.bg);
    LIGHT.uFogColor.value.copy(this.bg);
    return this.out !== target;
  }
}

/** a sign plate: one line of spaced capitals */
function signTexture(text: string, bg: string, fg: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const k = c.getContext("2d")!;
  k.fillStyle = bg;
  k.fillRect(0, 0, 512, 96);
  k.font = `700 40px ${SANS}`;
  k.fillStyle = fg;
  k.textBaseline = "middle";
  spaced(k, text, (512 - spacedWidth(k, text, 6)) / 2, 50, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The way out of the building: sliding glass doors in the facade, under a lintel with a sign on each
 * face. They open as the robot comes near.
 */
export class Door {
  group = new THREE.Group();
  private panels: THREE.Mesh[] = [];
  private x: number;
  private z: number;
  private open = 0;
  private half: number;

  constructor() {
    const [cx, cy] = MAIN_DOOR;
    this.x = cx + 0.5 - W / 2;
    this.z = cy + 0.5 - H / 2;
    // the opening between the two wall slabs, along z
    const span = 1 + WALL_T;
    this.half = span / 2;
    // low enough that the chase camera sees over the lintel
    const hgt = 1.02;
    const frame = clay({ color: PAL.plaster, bevel: true });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.08, hgt, 0.14), frame);
      post.position.set(this.x, hgt / 2, this.z + s * (this.half + 0.04));
      this.group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.1, 0.16, span + 0.36), frame);
    lintel.position.set(this.x, hgt + 0.08, this.z);
    this.group.add(lintel);
    // signs: facing in (east) and out (west)
    const faces: [string, number][] = [
      ["OUT · ABU DHABI", 1],
      ["IN · EUROPE 2014–22", -1],
    ];
    for (const [text, s] of faces) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(span + 0.3, 0.13), clay({ map: signTexture(text, "#2b2f35", "#ffd9a8"), emissive: 0.6 }));
      sign.position.set(this.x + s * (WALL_T / 2 + 0.056), hgt + 0.08, this.z);
      sign.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(sign);
    }
    // the two glass leaves
    const glass = new THREE.MeshBasicMaterial({ color: "#bfe0ea", transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    const edge = clay({ color: "#3c4046" });
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, hgt - 0.04, this.half), glass);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.05, hgt - 0.04, 0.03), edge);
      rim.position.z = -s * (this.half / 2 - 0.015);
      leaf.add(rim);
      leaf.position.set(this.x, (hgt - 0.04) / 2, this.z + (s * this.half) / 2);
      leaf.userData.side = s;
      this.panels.push(leaf);
      this.group.add(leaf);
    }
  }

  /** open while the robot is near; true while still moving */
  update(rx: number, rz: number, dt: number, reduced: boolean) {
    const near = (rx - this.x) ** 2 + (rz - this.z) ** 2 < 2.2 * 2.2 ? 1 : 0;
    const prev = this.open;
    this.open = reduced ? near : this.open + Math.sign(near - this.open) * Math.min(Math.abs(near - this.open), dt / 0.5);
    const e = this.open * this.open * (3 - 2 * this.open);
    for (const p of this.panels) {
      const s = p.userData.side as number;
      p.position.z = this.z + s * (this.half / 2 + e * this.half * 0.92);
    }
    return this.open !== prev;
  }
}

const DUST_VS = /* glsl */ `
uniform float uScale;
attribute float aSize;
varying float vOut;
${LIGHT_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vOut = outdoorAt(wp.xyz);
  vec4 mv = viewMatrix * wp;
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const DUST_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vOut;
void main() {
  if (vOut < 0.5) discard;
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c)) * uAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/**
 * The shamal: sand blown low over the ground, outdoors only. A few hundred specks in a box that
 * follows the view; they drift with the wind and wrap round.
 */
export class Dust {
  points: THREE.Points;
  private pos: Float32Array;
  private n: number;
  private box = { x: 9, z: 7, y: 1.1 };
  uniforms = { uScale: { value: 300 }, uColor: { value: new THREE.Color("#e2bf86") }, uAlpha: { value: 0.55 } };

  constructor(n = 420) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos.set([(Math.random() - 0.5) * 2 * this.box.x, Math.random() ** 2 * this.box.y, (Math.random() - 0.5) * 2 * this.box.z], i * 3);
      size[i] = 0.02 + Math.random() * 0.028;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: { ...LIGHT, ...this.uniforms }, vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** follow the view's centre; drift; scale the specks to the screen */
  update(cx: number, cz: number, now: number, dt: number, pxScale: number) {
    this.uniforms.uScale.value = pxScale;
    const p = this.pos;
    const { x: bx, z: bz, y: by } = this.box;
    const gust = 0.8 + 0.5 * Math.sin(now * 0.6) + 0.25 * Math.sin(now * 2.3);
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      p[k] += (1.6 * gust + Math.sin(i * 1.7 + now * 1.3) * 0.2) * dt;
      p[k + 2] += (0.35 + Math.cos(i * 0.9 + now) * 0.25) * dt;
      p[k + 1] += Math.sin(i * 2.3 + now * 3) * 0.15 * dt;
      // wrap round the box, which is centred on the view
      const rx = p[k] - cx;
      const rz = p[k + 2] - cz;
      if (rx > bx) p[k] -= 2 * bx;
      else if (rx < -bx) p[k] += 2 * bx;
      if (rz > bz) p[k + 2] -= 2 * bz;
      else if (rz < -bz) p[k + 2] += 2 * bz;
      if (p[k + 1] < 0.02 || p[k + 1] > by) p[k + 1] = 0.05 + Math.random() * 0.4;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
