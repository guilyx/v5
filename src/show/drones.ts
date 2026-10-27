import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Points, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";
import { MOTION, type Formation } from "./formations";

/**
 * The fleet: one Points draw for the drones, one for their reflections.
 * The CPU only uploads two formations (A, B) when the act changes; the vertex
 * shader flies every drone between them from a single uniform `uT`, each with
 * its own departure delay, plus the act's choreography (arc, swirl, take-off)
 * and per-act life (a balancing pendulum, signals flowing, a drone that fails
 * and recovers). A third pair of buffers holds the visitor's drawing and is
 * blended over the timeline by `uC`, so directing never fights the scroll.
 */

const SHARED = /* glsl */ `
  uniform float uTime, uT, uC, uCmix, uScale, uPx, uSize;
  uniform vec4 uStyle;
  uniform vec2 uMot, uPivot;
  uniform vec3 uOrigin;
  uniform vec4 uRip[4];
  attribute vec3 aB, aC0, aC1, aColA, aColB, aColC0, aColC1;
  attribute vec4 aM;
  attribute float aPB;
  varying vec3 vCol;
  varying float vI;
  const float PI = 3.14159265;
  float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
  float hash(float n) { return fract(sin(n) * 43758.5453); }

  vec3 life(vec3 p, float mot, float prm, float seed, inout vec3 col, inout float glow) {
    if (mot > 0.5 && mot < 1.5) {
      // the inverted pendulum: the pole leans, the cart runs under it to catch it
      float th = 0.16 * sin(uTime * 1.2) + 0.05 * sin(uTime * 3.1 + 1.3) + 0.008 * sin(uTime * 23.0);
      float cart = -th * 36.0;
      if (prm > 0.75) {
        vec2 d = p.xy - uPivot;
        float c = cos(th), s = sin(th);
        p.xy = uPivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
        p.x += cart;
      } else if (prm > 0.25) {
        p.x += cart;
      }
    } else if (mot > 1.5 && mot < 2.5) {
      // signals running along a path
      if (prm >= 0.0) {
        float w = fract(prm * 1.6 - uTime * 0.28);
        glow += 1.5 * exp(-w * 9.0);
      }
    } else if (mot > 2.5) {
      // self-healing: now and then a drone fails, drops, is caught, and climbs back
      float k = uTime * 0.3 + seed * 23.0;
      float ph = fract(k);
      if (hash(floor(k) * 7.13 + seed * 91.7) > 0.982) {
        float f = sin(ph * PI);
        p.y -= f * f * 9.0;
        p.z += f * 4.0;
        col = mix(col, vec3(1.0, 0.2, 0.14), smoothstep(0.0, 0.12, ph) * smoothstep(0.78, 0.5, ph));
        glow += 0.5 * f;
      }
    }
    return p;
  }

  void fly(out vec3 world, out float size) {
    float seed = aM.z;
    float sp = uStyle.x;
    float raw = (uT - aM.x * sp) / max(1.0 - sp, 1e-3);
    float e = ease(raw);
    vec3 cA = aColA, cB = aColB;
    float gA = 0.0, gB = 0.0;
    vec3 pA = life(position, uMot.x, aM.w, seed, cA, gA);
    vec3 pB = life(aB, uMot.y, aPB, seed, cB, gB);
    vec3 p;
    if (uStyle.w > 0.5) {
      // take-off: climb first, then travel across
      float ey = ease(raw * 1.8);
      e = ease((raw - 0.32) / 0.68);
      p = vec3(mix(pA.x, pB.x, e), mix(pA.y, pB.y, ey), mix(pA.z, pB.z, e));
    } else {
      p = mix(pA, pB, e);
    }
    float fl = sin(PI * e);
    p.y += fl * uStyle.y * (0.35 + 0.65 * fract(seed * 3.17));
    p.z += fl * 26.0 * (fract(seed * 7.31) - 0.5);
    if (uStyle.z != 0.0) {
      float a = fl * uStyle.z * (0.7 + 0.6 * fract(seed * 5.3));
      float c = cos(a), s = sin(a);
      p.xy = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }
    vec3 col = mix(cA, cB, e);
    float glow = mix(gA, gB, e);
    float inten = 1.0 - 0.4 * fl;
    if (uC > 0.0) {
      float ec = ease((uCmix - aM.y * 0.5) / 0.5);
      vec3 pO = mix(aC0, aC1, ec);
      float fo = sin(PI * ec);
      pO.z += fo * 22.0 * (fract(seed * 2.71) - 0.5);
      pO.y += fo * 7.0 * fract(seed * 4.1);
      float w = ease((uC - aM.y * 0.45) / 0.55);
      float fw = sin(PI * w);
      vec3 mid = mix(p, pO, w);
      mid.z += fw * 30.0 * (fract(seed * 6.1) - 0.5);
      mid.y += fw * 10.0 * fract(seed * 1.9);
      p = mid;
      col = mix(col, mix(aColC0, aColC1, ec), w);
      inten *= 1.0 - 0.35 * fw - 0.3 * fo * w;
      glow *= 1.0 - w;
    }
    // hovering is never perfectly still
    p.y += sin(uTime * 0.9 + seed * 40.0) * 0.3;
    p.x += sin(uTime * 0.67 + seed * 23.0) * 0.2;
    float rip = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (age > 0.0 && age < 3.2) {
        float d = distance(p.xy, r.xy) - age * 85.0;
        rip += exp(-d * d / 150.0) * (1.0 - age / 3.2) * r.w;
      }
    }
    p.z += rip * 9.0;
    p.y += rip * 2.5;
    inten += rip * 3.2 + glow;
    vCol = mix(col, vec3(1.0, 0.8, 0.5), clamp(rip * 0.75 + glow * 0.2, 0.0, 0.85));
    vI = inten;
    world = uOrigin + p * uScale;
    size = uSize * uScale * (0.85 + 0.3 * fract(seed * 9.1)) * (1.0 + 0.45 * min(rip + glow, 2.0));
  }
`;

const VERT = /* glsl */ `
  ${SHARED}
  void main() {
    vec3 world; float size;
    fly(world, size);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uPx / -mv.z, 1.5, 96.0);
  }
`;

const VERT_MIRROR = /* glsl */ `
  ${SHARED}
  void main() {
    vec3 world; float size;
    fly(world, size);
    world.y = -world.y;
    world.x += sin(world.y * 0.13 + uTime * 1.7 + world.z * 0.05) * 1.3;
    vI *= 0.42 * exp(world.y * 0.004);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * 2.4 * uPx / -mv.z, 2.0, 120.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vI;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    #ifdef MIRROR
      c.x *= 3.4; c.y *= 0.7;
    #endif
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 26.0);
    float halo = exp(-r2 * 5.0) * 0.3;
    vec3 col = mix(vCol, vec3(1.0), core * 0.45) * (core * 1.7 + halo) * vI;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export class Drones {
  readonly geo = new BufferGeometry();
  readonly points: Points;
  readonly mirror: Points;
  readonly u = {
    uTime: { value: 0 },
    uT: { value: 0 },
    uC: { value: 0 },
    uCmix: { value: 1 },
    uScale: { value: 1 },
    uPx: { value: 800 },
    uSize: { value: 4.4 },
    uStyle: { value: new Vector4() },
    uMot: { value: new Vector2() },
    uPivot: { value: new Vector2() },
    uOrigin: { value: new Vector3() },
    uRip: { value: [0, 1, 2, 3].map(() => new Vector4(0, 0, -99, 0)) },
  };
  private readonly at: Record<string, BufferAttribute> = {};

  constructor(readonly n: number) {
    const add = (name: string, size: number) => {
      const a = new BufferAttribute(new Float32Array(n * size), size);
      a.setUsage(DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      this.at[name] = a;
    };
    for (const name of ["position", "aB", "aC0", "aC1", "aColA", "aColB", "aColC0", "aColC1"]) add(name, 3);
    add("aM", 4);
    add("aPB", 1);
    const m = this.at.aM.array as Float32Array;
    for (let i = 0; i < n; i++) m[i * 4 + 2] = Math.random();
    const mat = (mirror: boolean) =>
      new ShaderMaterial({
        uniforms: this.u,
        vertexShader: mirror ? VERT_MIRROR : VERT,
        fragmentShader: FRAG,
        defines: mirror ? { MIRROR: 1 } : {},
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
    this.points = new Points(this.geo, mat(false));
    this.mirror = new Points(this.geo, mat(true));
    this.points.frustumCulled = this.mirror.frustumCulled = false;
    this.points.renderOrder = 6;
    this.mirror.renderOrder = 2;
  }

  private arr(name: string) {
    return this.at[name].array as Float32Array;
  }

  private touch(...names: string[]) {
    for (const n of names) this.at[n].needsUpdate = true;
  }

  /** Load the two formations the timeline is flying between. */
  setPair(a: Formation, b: Formation) {
    this.arr("position").set(a.pos);
    this.arr("aColA").set(a.col);
    this.arr("aB").set(b.pos);
    this.arr("aColB").set(b.col);
    this.arr("aPB").set(b.prm);
    const m = this.arr("aM");
    for (let i = 0; i < this.n; i++) {
      m[i * 4] = b.delay[i];
      m[i * 4 + 3] = a.prm[i];
    }
    this.touch("position", "aColA", "aB", "aColB", "aPB", "aM");
    const s = b.style;
    this.u.uStyle.value.set(s.spread, s.arc, s.spin, s.launch);
    this.u.uMot.value.set(a.motion, b.motion);
    const p = a.motion === MOTION.pendulum ? a.pivot : b.pivot;
    this.u.uPivot.value.set(p[0], p[1]);
  }

  /** Stream live positions (the flock) into one side of the pair. */
  setLive(side: "a" | "b", pos: Float32Array) {
    const name = side === "a" ? "position" : "aB";
    this.arr(name).set(pos);
    this.touch(name);
  }

  setOverride(from: Float32Array, fromCol: Float32Array, to: Float32Array, toCol: Float32Array, order: Float32Array) {
    this.arr("aC0").set(from);
    this.arr("aColC0").set(fromCol);
    this.arr("aC1").set(to);
    this.arr("aColC1").set(toCol);
    const m = this.arr("aM");
    for (let i = 0; i < this.n; i++) m[i * 4 + 1] = order[i];
    this.touch("aC0", "aColC0", "aC1", "aColC1", "aM");
  }

  /** Where the drone override currently puts each drone (exact: no flourishes at rest). */
  overrideNow(pos: Float32Array, col: Float32Array) {
    const C0 = this.arr("aC0"), C1 = this.arr("aC1"), K0 = this.arr("aColC0"), K1 = this.arr("aColC1"), m = this.arr("aM");
    const mix = this.u.uCmix.value;
    for (let i = 0; i < this.n; i++) {
      const e = ease((mix - m[i * 4 + 1] * 0.5) / 0.5);
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        pos[j] = C0[j] + (C1[j] - C0[j]) * e;
        col[j] = K0[j] + (K1[j] - K0[j]) * e;
      }
    }
  }

  /** Approximate current position of every drone, for matching a new drawing. */
  snapshot(out: Float32Array) {
    const A = this.arr("position"), B = this.arr("aB"), C0 = this.arr("aC0"), C1 = this.arr("aC1"), m = this.arr("aM");
    const sp = this.u.uStyle.value.x, t = this.u.uT.value, c = this.u.uC.value, mix = this.u.uCmix.value;
    for (let i = 0; i < this.n; i++) {
      const e = ease((t - m[i * 4] * sp) / Math.max(1e-3, 1 - sp));
      const w = c > 0 ? ease((c - m[i * 4 + 1] * 0.45) / 0.55) : 0;
      const ec = ease((mix - m[i * 4 + 1] * 0.5) / 0.5);
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        const p = A[j] + (B[j] - A[j]) * e;
        const o = C0[j] + (C1[j] - C0[j]) * ec;
        out[j] = p + (o - p) * w;
      }
    }
  }
}
