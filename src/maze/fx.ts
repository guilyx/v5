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

export class PathDots {
  mesh: THREE.InstancedMesh;
  private aS: THREE.InstancedBufferAttribute;
  uniforms = {
    uRobotS: { value: 0 },
    uReveal: { value: 0 },
    uColor: { value: new THREE.Color(PAL.search) },
    uFade: { value: 1 },
    uFogColor: LIGHT.uFogColor,
    uFogNear: LIGHT.uFogNear,
    uFogFar: LIGHT.uFogFar,
  };
  length = 0;
  private revealAt = 0;
  constructor(max = 700) {
    const geo = new THREE.CircleGeometry(0.06, 12);
    geo.rotateX(-Math.PI / 2);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute("aS", this.aS);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aS;
        uniform float uRobotS, uReveal;
        varying float vDepth;
        varying float vA;
        void main() {
          float k = clamp((uReveal - aS) / 0.6, 0.0, 1.0) * clamp((aS - uRobotS - 0.15) / 0.5, 0.0, 1.0);
          vA = k;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position * (0.35 + 0.65 * k), 1.0);
          vec4 mv = viewMatrix * wp;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_GLSL}
        uniform vec3 uColor;
        uniform float uFade;
        varying float vDepth;
        varying float vA;
        void main() {
          if (vA < 0.01) discard;
          gl_FragColor = vec4(fogged(uColor, vDepth), vA * uFade * 0.95);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  set(pts: [number, number][], now: number) {
    const m = new THREE.Matrix4();
    let n = 0;
    let s = 0;
    const gap = 0.26;
    let next = 0.35;
    for (let i = 1; i < pts.length && n < this.aS.count; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const L = Math.hypot(bx - ax, bz - az);
      while (next <= s + L && n < this.aS.count) {
        const t = (next - s) / L;
        m.makeTranslation(ax + (bx - ax) * t, 0.012, az + (bz - az) * t);
        this.mesh.setMatrixAt(n, m);
        this.aS.setX(n, next);
        n++;
        next += gap;
      }
      s += L;
    }
    this.length = s;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aS.needsUpdate = true;
    this.revealAt = now;
    this.uniforms.uRobotS.value = 0;
    this.uniforms.uFade.value = 1;
  }
  clear() {
    this.mesh.count = 0;
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
  update(now: number, dt: number, x: number, z: number, spin: number) {
    this.uniforms.uTime.value = now;
    if (spin <= 0.01) return;
    const from = this.angle;
    this.angle += spin * dt;
    const step = 0.05;
    let a = Math.ceil(from / step) * step;
    let wrote = false;
    for (; a < this.angle; a += step) {
      const hit = this.cast(x, z, a);
      if (!hit) continue;
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      this.pos.setXYZ(i, hit[0], 0.5, hit[1]);
      this.birth.setX(i, now);
      wrote = true;
    }
    if (wrote) {
      this.pos.needsUpdate = true;
      this.birth.needsUpdate = true;
    }
  }
  private cast(x: number, z: number, a: number): [number, number] | null {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const gx = x + W / 2;
    const gz = z + H / 2;
    for (let r = 0.25; r < 7.5; r += 0.035) {
      if (solidAt(this.maze, gx + dx * r, gz + dz * r) > 0.3) return [x + dx * r, z + dz * r];
    }
    return null;
  }
}
