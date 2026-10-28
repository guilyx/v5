import * as THREE from "three";
import { H, type Maze, W } from "./layout";
import { solidAt } from "./floor";
import { LIGHT, PAL } from "./gfx";

const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
vec3 fogged(vec3 c, float depth) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, depth)); }
`;

/* ------------------------------------------------------------------ planned path: a dotted line */

export interface PathPiece {
  /** 0 rolling, 1 flying */
  mode: number;
  pts: [number, number][];
  /** a flight leg climbs at its start unless the robot is already up */
  climb: boolean;
}

/**
 * The plan, drawn as dots: blue on the floor where it rolls, orange up in the air where it
 * flies (with faint shadows on the floor), and a ring where it morphs.
 */
export class PathDots {
  mesh: THREE.InstancedMesh;
  rings: THREE.InstancedMesh;
  private aS: THREE.InstancedBufferAttribute;
  private aMode: THREE.InstancedBufferAttribute;
  private rS: THREE.InstancedBufferAttribute;
  uniforms = {
    uRobotS: { value: 0 },
    uReveal: { value: 0 },
    uColor: { value: new THREE.Color(PAL.search) },
    uFly: { value: new THREE.Color(PAL.fly) },
    uFade: { value: 1 },
    uAlpha: { value: 0.95 },
    uFogColor: LIGHT.uFogColor,
    uFogNear: LIGHT.uFogNear,
    uFogFar: LIGHT.uFogFar,
  };
  length = 0;
  private revealAt = 0;
  constructor(max = 900, opts: { alpha?: number; size?: number } = {}) {
    const size = opts.size ?? 0.06;
    this.uniforms.uAlpha.value = opts.alpha ?? 0.95;
    const geo = new THREE.CircleGeometry(size, 12);
    geo.rotateX(-Math.PI / 2);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aMode = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute("aS", this.aS);
    geo.setAttribute("aMode", this.aMode);
    const vs = /* glsl */ `
      attribute float aS;
      attribute float aMode;
      uniform float uRobotS, uReveal;
      varying float vDepth;
      varying float vA;
      varying float vMode;
      void main() {
        float k = clamp((uReveal - aS) / 0.6, 0.0, 1.0) * clamp((aS - uRobotS - 0.15) / 0.5, 0.0, 1.0);
        vA = k * (aMode > 1.5 ? 0.32 : 1.0);
        vMode = min(aMode, 1.0);
        vec4 wp = modelMatrix * instanceMatrix * vec4(position * (0.35 + 0.65 * k) * (aMode > 1.5 ? 0.8 : 1.0), 1.0);
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`;
    const fs = /* glsl */ `
      ${FOG_GLSL}
      uniform vec3 uColor, uFly;
      uniform float uFade, uAlpha;
      varying float vDepth;
      varying float vA;
      varying float vMode;
      void main() {
        if (vA < 0.01) discard;
        gl_FragColor = vec4(fogged(mix(uColor, uFly, vMode), vDepth), vA * uFade * uAlpha);
        #include <colorspace_fragment>
      }`;
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, vertexShader: vs, fragmentShader: fs });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

    // morph rings: one where the robot takes off, one where it lands
    const rg = new THREE.RingGeometry(0.2, 0.27, 28);
    rg.rotateX(-Math.PI / 2);
    this.rS = new THREE.InstancedBufferAttribute(new Float32Array(16), 1);
    rg.setAttribute("aS", this.rS);
    rg.setAttribute("aMode", new THREE.InstancedBufferAttribute(new Float32Array(16).fill(1), 1));
    this.rings = new THREE.InstancedMesh(rg, mat, 16);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
  }
  set(pieces: PathPiece[], now: number, alt: number, from = 0) {
    const m = new THREE.Matrix4();
    let n = 0;
    let r = 0;
    let s = 0;
    const gap = 0.26;
    let next = 0.35;
    const max = this.aS.count;
    pieces.forEach((pc, k) => {
      let L = 0;
      for (let i = 1; i < pc.pts.length; i++) L += Math.hypot(pc.pts[i][0] - pc.pts[i - 1][0], pc.pts[i][1] - pc.pts[i - 1][1]);
      if (k > 0 && pieces[k - 1].mode !== pc.mode && r < 16 && pc.pts.length) {
        m.makeTranslation(pc.pts[0][0], 0.014, pc.pts[0][1]);
        this.rings.setMatrixAt(r, m);
        this.rS.setX(r, s + 0.01);
        r++;
      }
      let u = 0;
      for (let i = 1; i < pc.pts.length && n < max - 1; i++) {
        const [ax, az] = pc.pts[i - 1];
        const [bx, bz] = pc.pts[i];
        const seg = Math.hypot(bx - ax, bz - az);
        while (next <= s + seg && n < max - 1) {
          const t = (next - s) / seg;
          const x = ax + (bx - ax) * t;
          const z = az + (bz - az) * t;
          if (pc.mode === 1) {
            // up in the air, rising after take-off and sinking before landing
            const d = u + (next - s);
            const climb = pc.climb ? Math.min(1, d / 1.1) : 1;
            const sink = Math.min(1, (L - d) / 1.1);
            const y = 0.03 + alt * smoothstep(Math.min(climb, sink));
            m.makeTranslation(x, y, z);
            this.mesh.setMatrixAt(n, m);
            this.aS.setX(n, next);
            this.aMode.setX(n, 1);
            n++;
            m.makeTranslation(x, 0.012, z);
            this.mesh.setMatrixAt(n, m);
            this.aS.setX(n, next);
            this.aMode.setX(n, 2);
            n++;
          } else {
            m.makeTranslation(x, 0.012, z);
            this.mesh.setMatrixAt(n, m);
            this.aS.setX(n, next);
            this.aMode.setX(n, 0);
            n++;
          }
          next += gap;
        }
        s += seg;
        u += seg;
      }
    });
    this.length = s;
    this.mesh.count = n;
    this.rings.count = r;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.aS.needsUpdate = true;
    this.aMode.needsUpdate = true;
    this.rS.needsUpdate = true;
    this.revealAt = now;
    this.uniforms.uRobotS.value = from;
    this.uniforms.uFade.value = 1;
  }
  clear() {
    this.mesh.count = 0;
    this.rings.count = 0;
    this.length = 0;
  }
  /** returns true while the line is still drawing itself */
  update(now: number, robotS: number, instant: boolean) {
    const speed = 70; // units per second: the line draws in a blink
    this.uniforms.uReveal.value = instant ? 1e4 : (now - this.revealAt) * speed;
    this.uniforms.uRobotS.value = robotS;
    return this.uniforms.uReveal.value < this.length + 1;
  }
}

const smoothstep = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/* ------------------------------------------------------------------ tyre tracks that fade */

export class Tracks {
  mesh: THREE.InstancedMesh;
  private birth: THREE.InstancedBufferAttribute;
  private head = 0;
  private lastOdo = -1;
  uniforms = {
    uTime: { value: 0 },
    uLife: { value: 3.2 },
    uColor: { value: new THREE.Color("#6b4a2b") },
    uFogColor: LIGHT.uFogColor,
    uFogNear: LIGHT.uFogNear,
    uFogFar: LIGHT.uFogFar,
  };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  constructor(private max = 720) {
    const geo = new THREE.PlaneGeometry(0.09, 0.06);
    geo.rotateX(-Math.PI / 2);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(max).fill(-1e4), 1);
    geo.setAttribute("aBirth", this.birth);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aBirth;
        uniform float uTime, uLife;
        varying float vA;
        varying float vDepth;
        void main() {
          float age = (uTime - aBirth) / uLife;
          vA = clamp(1.0 - age, 0.0, 1.0);
          vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_GLSL}
        uniform vec3 uColor;
        varying float vA;
        varying float vDepth;
        void main() {
          if (vA <= 0.0) discard;
          gl_FragColor = vec4(fogged(uColor, vDepth), vA * vA * 0.26);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
  }
  /** drop a pair of marks under the wheels every few centimetres of travel */
  update(now: number, x: number, z: number, heading: number, odo: number) {
    this.uniforms.uTime.value = now;
    if (this.lastOdo < 0) this.lastOdo = odo;
    if (odo - this.lastOdo < 0.075) return;
    this.lastOdo = odo;
    this.q.setFromAxisAngle(this.up, -heading);
    const nx = -Math.sin(heading);
    const nz = Math.cos(heading);
    for (const side of [-1, 1]) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      this.m.compose(new THREE.Vector3(x + nx * side * 0.37, 0.006, z + nz * side * 0.37), this.q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, this.m);
      this.birth.setX(i, now);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.birth.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ LiDAR returns on the walls */

export class Lidar {
  points: THREE.Points;
  private pos: THREE.BufferAttribute;
  private birth: THREE.BufferAttribute;
  private head = 0;
  angle = 0;
  uniforms = {
    uTime: { value: 0 },
    uScale: { value: 300 },
    uColor: { value: new THREE.Color(PAL.accent) },
    uFogColor: LIGHT.uFogColor,
    uFogNear: LIGHT.uFogNear,
    uFogFar: LIGHT.uFogFar,
  };
  constructor(private maze: Maze, private max = 900) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.birth = new THREE.BufferAttribute(new Float32Array(max).fill(-1e4), 1);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("aBirth", this.birth);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aBirth;
        uniform float uTime, uScale;
        varying float vA;
        varying float vDepth;
        void main() {
          float age = uTime - aBirth;
          vA = clamp(1.0 - age / 1.1, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_PointSize = vA > 0.0 ? max(2.5, uScale * 0.09 / vDepth) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_GLSL}
        uniform vec3 uColor;
        varying float vA;
        varying float vDepth;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          if (vA <= 0.0 || dot(d, d) > 0.25) discard;
          gl_FragColor = vec4(fogged(uColor, vDepth), vA * 0.9);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }
  /** sweep the beam from the last angle to the new one, casting a ray every few degrees */
  update(now: number, dt: number, x: number, z: number, spin: number, above = 0.3, y = 0.5) {
    this.uniforms.uTime.value = now;
    if (spin <= 0.01) return;
    const from = this.angle;
    this.angle += spin * dt;
    const step = 0.05;
    let a = Math.ceil(from / step) * step;
    let wrote = false;
    for (; a < this.angle; a += step) {
      const hit = this.cast(x, z, a, above);
      if (!hit) continue;
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      this.pos.setXYZ(i, hit[0], y, hit[1]);
      this.birth.setX(i, now);
      wrote = true;
    }
    if (wrote) {
      this.pos.needsUpdate = true;
      this.birth.needsUpdate = true;
    }
  }
  private cast(x: number, z: number, a: number, above: number): [number, number] | null {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const gx = x + W / 2;
    const gz = z + H / 2;
    for (let r = 0.25; r < 9; r += 0.035) {
      if (solidAt(this.maze, gx + dx * r, gz + dz * r) > above) return [x + dx * r, z + dz * r];
    }
    return null;
  }
}
