import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C, clamp, col, FRAG_OUT, ground, Level, sstep } from "./kit";
import type { Frame, TagSpec } from "./kit";
import { ALT, APEX, O_SEA, SWARM_FROM_AD } from "./world";

/** the formation draws the brand mark: three dots joined by an open path */
function formation() {
  const h = 70 * Math.sin(Math.PI / 3);
  const A = new Vector3(APEX[0], APEX[1], 0);
  const BL = new Vector3(-35, A.y - h, 0), BR = new Vector3(35, A.y - h, 0);
  const slots: Vector3[] = [];
  const hot: number[] = [];
  // dense hex-packed dots at the three corners (apex first: drone 0 is the one we dive into)
  const cluster = (c: Vector3, isHot: number) => {
    const sp = 2.3;
    for (let q = -3; q <= 3; q++)
      for (let r = -3; r <= 3; r++) {
        const x = (q + r / 2) * sp, y = r * sp * 0.866;
        if (Math.hypot(x, y) > 5.2) continue;
        slots.push(new Vector3(c.x + x, c.y + y, 0));
        hot.push(isHot);
      }
  };
  cluster(A, 0);
  // keep the apex drone at index 0, dead centre
  const i0 = slots.findIndex((p) => p.distanceTo(A) < 0.01);
  [slots[0], slots[i0]] = [slots[i0], slots[0]];
  cluster(BL, 0);
  cluster(BR, 1);
  const line = (a: Vector3, b: Vector3) => {
    const L = a.distanceTo(b), n = Math.floor((L - 12) / 3);
    for (let i = 0; i <= n; i++) {
      slots.push(a.clone().lerp(b, (6 + (i * (L - 12)) / n) / L));
      hot.push(0);
    }
  };
  line(A, BL);
  line(BL, BR);
  return { slots, hot, A };
}

/** a small quadcopter in metres; origin = the flight controller's top face */
function droneGeometry() {
  const paper = new Color(C.paper), ink = new Color("#2a2824");
  const paint = (g: BufferGeometry, c: Color) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    g.setAttribute("color", new BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g;
  };
  const parts: BufferGeometry[] = [];
  for (const r of [Math.PI / 4, -Math.PI / 4]) parts.push(paint(new BoxGeometry(0.62, 0.03, 0.008).rotateZ(r).translate(0, 0, -0.019), ink));
  const dome = new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(0.085, 0.058, 0.045).translate(0, 0, -0.004);
  parts.push(paint(dome, paper));
  for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    parts.push(paint(new CylinderGeometry(0.022, 0.022, 0.03, 12).rotateX(Math.PI / 2).translate(x * 0.212, y * 0.212, -0.002), ink));
  return mergeGeometries(parts)!;
}

const WATER_FRAG = /* glsl */ `
uniform sampler2D uBay;
uniform vec2 uToAD; // metres from this level's origin to Abu Dhabi's
uniform float uTime, uOpacity;
uniform vec3 uWater, uDeep, uLight, uInk;
varying vec2 vP; // metres
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
// wavy, dashed, engraved swell lines with a wavelength of L metres
float swell(vec2 p, float L, float fpm, float seed) {
  float y = p.y / L + 0.16 * sin(p.x / L * 2.3 + uTime * 0.35 + seed) + 0.07 * sin(p.x / L * 5.1 - uTime * 0.5 + seed * 2.0);
  float row = floor(y);
  float lw = 0.75 * fpm / L; // ~1.5 px wide lines
  float line = 1.0 - smoothstep(lw, lw + fpm / L, abs(fract(y) - 0.5));
  float dx = fract(p.x / L * 0.55 + hash(row + seed) * 7.0 + uTime * 0.02);
  float dash = smoothstep(0.0, 0.06, dx) * (1.0 - smoothstep(0.4, 0.48, dx));
  return line * dash;
}
void main() {
  float fpm = max(length(fwidth(vP)), 1e-5); // metres per pixel
  vec2 bkm = (vP - uToAD) / 1000.0;
  float d = (texture2D(uBay, bkm / 80.0 + 0.5).r * 255.0 - 128.0) / 127.0 * 2.5; // km to the coast
  float sea = smoothstep(-fpm * 0.0006, fpm * 0.0006, d);
  // three octaves of swell; the finest fades out as it shrinks, the coarsest fades in,
  // so the water has the same texture at every zoom
  float l = log2(fpm * 26.0) / 2.0;
  float o = floor(l), f = fract(l);
  float L0 = pow(4.0, o);
  // each octave keeps its own seed, tied to its absolute size, so nothing pops as they hand over
  float w = swell(vP + L0 * 0.37, L0, fpm, mod(o, 7.0)) * (1.0 - f) * 0.7
          + swell(vP + L0 * 1.48, L0 * 4.0, fpm, mod(o + 1.0, 7.0))
          + swell(vP + L0 * 5.9, L0 * 16.0, fpm, mod(o + 2.0, 7.0)) * f;
  vec3 c = mix(uWater, uDeep, 0.35 + 0.35 * sin(vP.x * 0.0011 + vP.y * 0.0007));
  c = mix(c, uLight, clamp(w, 0.0, 1.0) * 0.42);
  // shallows: lighter near the shore
  c = mix(c, uLight, (1.0 - smoothstep(0.0, 0.35, d)) * 0.45);
  gl_FragColor = vec4(c, uOpacity * sea);
  ${FRAG_OUT}
}`;

export class Sea extends Level {
  private water: Mesh<PlaneGeometry, ShaderMaterial>;
  private bodies: InstancedMesh<BufferGeometry, MeshLambertMaterial>;
  private rotors: InstancedMesh<BufferGeometry, ShaderMaterial>;
  private shadows: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  private leds: Points<BufferGeometry, ShaderMaterial>;
  private mark: Points<BufferGeometry, ShaderMaterial>;
  private slots: Vector3[];
  private ring: Vector3[];
  private p: Vector3[];
  private v: Vector3[];
  private yaw: Float32Array;
  private A: Vector3;
  private n: number;
  private time = 0;
  private settled = false;

  constructor(bay: Texture) {
    super(0, O_SEA, -1.35, 4.35);
    // the water
    this.water = new Mesh(
      new PlaneGeometry(14000, 14000),
      new ShaderMaterial({
        uniforms: {
          uBay: { value: bay },
          uToAD: { value: [-SWARM_FROM_AD[0], -SWARM_FROM_AD[1]] },
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uWater: { value: col(C.water) },
          uDeep: { value: col(C.waterDeep) },
          uLight: { value: col(C.waterLight) },
          uInk: { value: col(C.ink) },
        },
        vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: WATER_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.group.add(ground(this.water, -8));

    const { slots, hot, A } = formation();
    this.slots = slots;
    this.A = A;
    this.n = slots.length;
    // where each drone settles when the formation breaks into a flock (also the reduced-motion pose)
    this.ring = slots.map((_, i) => {
      if (i === 0) return A.clone();
      const r = 2.4 + (i % 7) * 1.25 + (i % 3) * 0.4, a = i * 2.39996;
      return new Vector3(A.x + Math.cos(a) * r, A.y + Math.sin(a) * r, 0);
    });
    this.p = slots.map((s) => s.clone());
    this.v = slots.map(() => new Vector3());
    this.yaw = new Float32Array(this.n);

    const n = this.n;
    this.bodies = new InstancedMesh(droneGeometry(), new MeshLambertMaterial({ vertexColors: true }), n);
    const rotorGeo = mergeGeometries(
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, y]) => new CircleGeometry(0.127, 20).translate(x * 0.212, y * 0.212, 0.022)),
    )!;
    this.rotors = new InstancedMesh(
      rotorGeo,
      new ShaderMaterial({
        uniforms: { uInk: { value: col(C.ink) } },
        vertexShader: /* glsl */ `varying vec2 vL; void main(){ vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `uniform vec3 uInk; varying vec2 vL;
          void main(){
            vec2 q = abs(vL) - 0.212;
            float r = length(q) / 0.127;
            float a = 0.08 + 0.22 * smoothstep(0.8, 0.95, r) * (1.0 - smoothstep(0.96, 1.0, r));
            gl_FragColor = vec4(uInk, a);
            ${FRAG_OUT}
          }`,
        transparent: true,
        depthWrite: false,
      }),
      n,
    );
    this.shadows = new InstancedMesh(
      new PlaneGeometry(0.75, 0.75),
      new ShaderMaterial({
        uniforms: { uInk: { value: col("#173c40") }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `varying vec2 vL; void main(){ vL = position.xy / 0.375; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `uniform vec3 uInk; uniform float uOpacity; varying vec2 vL;
          void main(){
            // a soft blob with the faint cross of the frame in it
            vec2 q = abs(vL);
            float arm = abs(q.x - q.y) / 1.414;
            float x = (1.0 - smoothstep(0.05, 0.2, arm)) * (1.0 - smoothstep(0.7, 0.95, max(q.x, q.y)));
            float blob = 1.0 - smoothstep(0.1, 0.95, length(vL));
            gl_FragColor = vec4(uInk, uOpacity * (0.2 * blob + 0.14 * x));
            ${FRAG_OUT}
          }`,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
      n,
    );
    ground(this.shadows, -7);
    for (const m of [this.bodies, this.rotors, this.shadows]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    // navigation lights: points of a fixed pixel size, so the swarm reads as a constellation from far away
    const lg = new BufferGeometry();
    const lp = new Float32Array(n * 3), lc = new Float32Array(n * 3);
    const white = new Color("#fbf7ee"), red = new Color(C.vermilion);
    for (let i = 0; i < n; i++) (hot[i] ? red : white).toArray(lc, i * 3);
    lg.setAttribute("position", new BufferAttribute(lp, 3).setUsage(DynamicDrawUsage));
    lg.setAttribute("color", new BufferAttribute(lc, 3));
    this.leds = new Points(
      lg,
      new ShaderMaterial({
        uniforms: { uSize: { value: 4 }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `uniform float uSize; attribute vec3 color; varying vec3 vC;
          void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = uSize; }`,
        fragmentShader: /* glsl */ `uniform float uOpacity; varying vec3 vC;
          void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
            gl_FragColor = vec4(mix(vC, vec3(0.11), smoothstep(0.72, 0.9, r)), uOpacity * (1.0 - smoothstep(0.9, 1.0, r)));
            ${FRAG_OUT} }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.leds.renderOrder = 4;
    this.leds.frustumCulled = false;
    this.group.add(this.leds);

    // from far away, a map-style ring marks where the swarm is
    const mg = new BufferGeometry();
    mg.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, ALT]), 3));
    this.mark = new Points(
      mg,
      new ShaderMaterial({
        uniforms: { uSize: { value: 40 }, uOpacity: { value: 0 }, uC: { value: col(C.vermilion) }, uPaper: { value: col(C.paper) } },
        vertexShader: /* glsl */ `uniform float uSize; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = uSize; }`,
        fragmentShader: /* glsl */ `uniform float uOpacity; uniform vec3 uC, uPaper;
          void main(){
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float ring = step(0.74, r) * step(r, 0.9);
            float halo = step(0.68, r) * step(r, 0.97);
            if (halo < 0.5) discard;
            gl_FragColor = vec4(mix(uPaper, uC, ring), uOpacity);
            ${FRAG_OUT}
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mark.renderOrder = 5;
    this.mark.frustumCulled = false;
    this.group.add(this.mark);
  }

  tags(): TagSpec[] {
    return [{ at: [0, 0, ALT], text: "The swarm", sLow: 3.35, sHigh: 4.55, cls: "rr" }];
  }

  private step(fr: Frame) {
    const n = this.n, P = this.p, V = this.v, A = this.A;
    const g = sstep(1.3, 1.85, fr.s); // 1: hold formation, 0: free flock
    if (fr.reduced) {
      for (let i = 1; i < n; i++) P[i].copy(this.ring[i]).lerp(this.slots[i], g);
      return;
    }
    const dt = Math.min(fr.dt, 1 / 30);
    // the pointer, in this level's metres (on the drones' plane)
    let px = 1e9, py = 1e9;
    if (fr.pointer) {
      px = fr.pointer[0] - this.origin[0];
      py = fr.pointer[1] - this.origin[1];
    }
    const acc = this.acc;
    for (let i = 1; i < n; i++) {
      const p = P[i], v = V[i];
      acc.set(0, 0, 0);
      if (g > 0.001) {
        const sl = this.slots[i];
        acc.x += g * (3.2 * (sl.x - p.x) - 3.4 * v.x);
        acc.y += g * (3.2 * (sl.y - p.y) - 3.4 * v.y);
      }
      if (g < 0.999) {
        const f = 1 - g;
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, cnt = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const q = P[j];
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 > 49) continue;
          if (d2 < 4.4) {
            const inv = 1 / Math.max(d2, 0.05);
            sx -= dx * inv;
            sy -= dy * inv;
          }
          ax += V[j].x;
          ay += V[j].y;
          cx += q.x;
          cy += q.y;
          cnt++;
        }
        let fx = sx * 2.6, fy = sy * 2.6;
        if (cnt) {
          fx += (ax / cnt - v.x) * 0.9 + (cx / cnt - p.x) * 0.25;
          fy += (ay / cnt - v.y) * 0.9 + (cy / cnt - p.y) * 0.25;
        }
        // wheel around the drone we're diving into, at each drone's own radius
        const rx = p.x - A.x, ry = p.y - A.y, r = Math.max(Math.hypot(rx, ry), 0.01);
        const R0 = this.ring[i].distanceTo(A);
        const spd = 2.1 + 0.12 * (i % 5);
        fx += (-ry / r * spd - v.x) * 0.7 + (rx / r) * (R0 - r) * 0.8;
        fy += (rx / r * spd - v.y) * 0.7 + (ry / r) * (R0 - r) * 0.8;
        if (r < 1.7) {
          fx += (rx / r) * (1.7 - r) * 14;
          fy += (ry / r) * (1.7 - r) * 14;
        }
        acc.x += f * fx;
        acc.y += f * fy;
      }
      // the pointer is a hawk: everyone gives it room
      const hx = p.x - px, hy = p.y - py, hd = Math.hypot(hx, hy);
      const hr = 3.4;
      if (hd < hr) {
        acc.x += (hx / Math.max(hd, 0.05)) * (hr - hd) * 16;
        acc.y += (hy / Math.max(hd, 0.05)) * (hr - hd) * 16;
      }
      v.addScaledVector(acc, dt);
      const sp = v.length(), vmax = 3 + 4 * (1 - g);
      if (sp > vmax) v.multiplyScalar(vmax / sp);
      p.addScaledVector(v, dt);
    }
  }

  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Vector3();
  private one = new Vector3(1, 1, 1);
  private zero = new Vector3(0, 0, 0);
  private ax = new Vector3();
  private up = new Vector3(0, 0, 1);
  private bank = new Quaternion();
  private acc = new Vector3();

  update(fr: Frame) {
    this.time += fr.reduced ? 0 : fr.dt;
    const wm = this.water.material.uniforms;
    wm.uTime.value = this.time;
    wm.uOpacity.value = sstep(3.95, 3.35, fr.s);
    this.water.visible = fr.s > -1.3;

    this.step(fr);
    const n = this.n;
    const hideFocal = fr.s < 2.3; // the detailed drone takes over
    // the sun is up and to the left: shadows fall down and to the right on the water
    const shx = 0.48 * ALT, shy = -0.65 * ALT;
    const lp = this.leds.geometry.attributes.position as BufferAttribute;
    for (let i = 0; i < n; i++) {
      const p = this.p[i], v = this.v[i];
      const sp = Math.hypot(v.x, v.y);
      const target = sp > 0.4 ? Math.atan2(v.y, v.x) : 0;
      let dy = target - this.yaw[i];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw[i] += dy * clamp(fr.dt * 3);
      // bank into the turn, a little
      const tilt = Math.min(0.25, sp * 0.05);
      this.ax.set(-Math.sin(this.yaw[i]), Math.cos(this.yaw[i]), 0);
      this.q.setFromAxisAngle(this.up, this.yaw[i]);
      if (tilt > 0.001) this.q.premultiply(this.bank.setFromAxisAngle(this.ax, tilt));
      const bob = fr.reduced ? 0 : Math.sin(this.time * 1.3 + i * 1.7) * 0.15;
      this.e.set(p.x, p.y, ALT + bob);
      this.m.compose(this.e, this.q, i === 0 && hideFocal ? this.zero : this.one);
      this.bodies.setMatrixAt(i, this.m);
      this.rotors.setMatrixAt(i, this.m);
      this.e.set(p.x + shx, p.y + shy, 0.05);
      this.m.compose(this.e, this.q, this.one);
      this.shadows.setMatrixAt(i, this.m);
      lp.setXYZ(i, p.x, p.y, ALT + bob + 0.06);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.rotors.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    lp.needsUpdate = true;
    // the lights matter while drones are a few pixels big; then the drones themselves take over
    const dronePx = (0.6 * fr.ref) / Math.pow(10, fr.s);
    this.leds.material.uniforms.uSize.value = 5 * fr.dpr;
    this.leds.material.uniforms.uOpacity.value = 1 - sstep(5, 12, dronePx);
    this.leds.visible = dronePx < 12;
    this.shadows.material.uniforms.uOpacity.value = sstep(3.3, 2.7, fr.s);
    const mo = sstep(3.25, 3.55, fr.s) * (1 - sstep(4.45, 4.75, fr.s));
    this.mark.material.uniforms.uOpacity.value = mo;
    this.mark.material.uniforms.uSize.value = 38 * fr.dpr;
    this.mark.visible = mo > 0.01;
    this.bodies.visible = this.rotors.visible = dronePx > 1.2;
    this.settled = fr.reduced || this.v.every((v) => v.lengthSq() < 1e-4);
  }

  animating(fr: Frame) {
    // the swarm hovers and flocks as long as it's on screen
    return !fr.reduced && fr.s < 3.6 && fr.s > -1.2 ? true : !this.settled;
  }
}
