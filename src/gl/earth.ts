import {
  BufferAttribute,
  BufferGeometry,
  Curve,
  Matrix4,
  Mesh,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C, col, FRAG_OUT, Level, sstep } from "./kit";
import type { Frame, TagSpec } from "./kit";
import { AD, O_EARTH } from "./world";

/** the level's unit is 10^6 m, so the Earth's radius is 6.371 */
const R = 6.371;
const RAD = Math.PI / 180;

/** unit vector for a latitude/longitude, matching SphereGeometry's uv layout */
function dir(lat: number, lon: number) {
  const a = lat * RAD, b = lon * RAD;
  return new Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
}
/** the rotation that brings (lat, lon) to face the camera, north up */
function facing(lat: number, lon: number) {
  const b = lon * RAD, a = lat * RAD;
  const f = dir(lat, lon);
  const e = new Vector3(-Math.sin(b), 0, -Math.cos(b));
  const n = new Vector3(-Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b));
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(e, n, f).transpose());
}

/** his places, and the order he lived in them */
const PLACES = [
  { id: "nantes", name: "Nantes", lat: 47.218, lon: -1.554, side: "u" },
  { id: "bordeaux", name: "Bordeaux", lat: 44.838, lon: -0.579, side: "l" },
  { id: "coimbra", name: "Coimbra", lat: 40.203, lon: -8.41, side: "d" },
  { id: "odense", name: "Odense", lat: 55.403, lon: 10.402, side: "r" },
  { id: "abudhabi", name: "Abu Dhabi", lat: AD.lat, lon: AD.lon, side: "r" },
  { id: "pasadena", name: "Pasadena", lat: 34.138, lon: -118.125, side: "r" },
] as const;
const ROUTE: [string, string, number][] = [
  ["nantes", "bordeaux", 0],
  ["bordeaux", "coimbra", 0],
  ["coimbra", "nantes", 0],
  ["nantes", "odense", 0],
  ["odense", "abudhabi", 0],
  ["abudhabi", "pasadena", 1], // the joint program with Caltech: dashed
];

class Arc extends Curve<Vector3> {
  readonly angle: number;
  constructor(private a: Vector3, private b: Vector3) {
    super();
    this.angle = a.angleTo(b);
  }
  getPoint(t: number, out = new Vector3()) {
    const s = Math.sin(this.angle);
    const p = this.a.clone().multiplyScalar(Math.sin((1 - t) * this.angle) / s).add(this.b.clone().multiplyScalar(Math.sin(t * this.angle) / s));
    const lift = 1.004 + 0.11 * this.angle * Math.sin(Math.PI * t);
    return out.copy(p.normalize().multiplyScalar(R * lift));
  }
}

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uSdf;
uniform vec3 uSea, uLand, uInk;
uniform vec3 uL;
uniform float uOpacity, uDpr;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  // signed distance to the coast in texels: + sea, - land
  float d = (texture2D(uSdf, vUv).r * 255.0 - 128.0) / 127.0 * 12.0;
  float fw = max(fwidth(d), 1e-4);
  float land = smoothstep(fw * 0.6, -fw * 0.6, d);
  vec3 c = mix(uSea, uLand, land);
  // two engraved water lines hugging the coast, a constant few pixels apart
  for (int i = 1; i <= 2; i++) {
    float o = float(i) * fw * 5.0;
    float w = 1.0 - smoothstep(fw * 0.35, fw * 0.95, abs(d - o));
    c = mix(c, uInk, w * (0.2 - 0.07 * float(i)) * step(o, 10.5));
  }
  c = mix(c, uInk, (1.0 - smoothstep(fw * 0.45, fw * 1.15, abs(d))) * 0.8);
  // graticule, every 15 degrees
  vec2 ll = vec2(vUv.x * 24.0, vUv.y * 12.0);
  vec2 g = abs(fract(ll - 0.5) - 0.5) / max(fwidth(ll), vec2(1e-5));
  c = mix(c, uInk, (1.0 - smoothstep(0.35, 1.1, min(g.x, g.y))) * 0.12);
  // soft terminator, then a halftone screen on the night side
  float ndl = dot(N, uL);
  c *= mix(0.82, 1.0, smoothstep(-0.3, 0.5, ndl));
  vec2 hp = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / (4.0 * uDpr);
  float dark = 1.0 - smoothstep(-0.45, 0.2, ndl);
  float dotr = length(fract(hp) - 0.5);
  c = mix(c, uInk, (1.0 - smoothstep(dark * 0.45 - 0.06, dark * 0.45 + 0.06, dotr)) * 0.3 * step(0.02, dark));
  // an ink rim at the limb
  float ndv = dot(N, V);
  float rw = max(fwidth(ndv), 1e-4);
  c = mix(c, uInk, 1.0 - smoothstep(rw * 0.8, rw * 2.4, ndv));
  gl_FragColor = vec4(c, uOpacity);
  ${FRAG_OUT}
}`;

export class Earth extends Level {
  private lat0 = 40;
  private lon0 = 20;
  private vlat = 0;
  private vlon = 0;
  private qAD = facing(AD.lat, AD.lon);
  private qHero = new Quaternion();
  private heroAt = [NaN, NaN];
  private dirs = PLACES.map((p) => dir(p.lat, p.lon));
  private tmp = new Vector3();
  private dragging = false;
  private sphere: Mesh<SphereGeometry, ShaderMaterial>;
  private arcs: Mesh<BufferGeometry, ShaderMaterial>;
  private pins: Points<BufferGeometry, ShaderMaterial>;
  private facingCam = PLACES.map(() => true);

  constructor(sdf: Texture) {
    super(6, O_EARTH, 5.5, 99);
    const mat = new ShaderMaterial({
      uniforms: {
        uSdf: { value: sdf },
        uSea: { value: col(C.sea) },
        uLand: { value: col(C.land) },
        uInk: { value: col(C.ink) },
        uL: { value: new Vector3(-0.55, 0.75, 1.15).normalize() },
        uOpacity: { value: 1 },
        uDpr: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.sphere = new Mesh(new SphereGeometry(R, 160, 112), mat);
    this.sphere.renderOrder = -10;
    this.group.add(this.sphere);

    // his route, as great-circle arcs lifted off the surface
    const byId = Object.fromEntries(PLACES.map((p) => [p.id, dir(p.lat, p.lon)]));
    const parts = ROUTE.map(([a, b, dashed]) => {
      const arc = new Arc(byId[a], byId[b]);
      const g = new TubeGeometry(arc, Math.max(16, Math.round(arc.angle * 90)), 0.022, 5, false);
      const n = g.attributes.position.count;
      const dash = new Float32Array(n).fill(dashed);
      const along = new Float32Array(n);
      const uv = g.attributes.uv;
      for (let i = 0; i < n; i++) along[i] = uv.getX(i) * arc.angle * R;
      g.setAttribute("dash", new BufferAttribute(dash, 1));
      g.setAttribute("along", new BufferAttribute(along, 1));
      return g;
    });
    this.arcs = new Mesh(
      mergeGeometries(parts)!,
      new ShaderMaterial({
        uniforms: { uInk: { value: col(C.ink) }, uAccent: { value: col(C.vermilion) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `attribute float dash; attribute float along; varying float vDash; varying float vAlong;
          void main(){ vDash = dash; vAlong = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `uniform vec3 uInk, uAccent; uniform float uOpacity; varying float vDash; varying float vAlong;
          void main(){
            if (vDash > 0.5 && fract(vAlong * 1.6) > 0.55) discard;
            gl_FragColor = vec4(mix(uInk, uAccent, vDash), uOpacity);
            ${FRAG_OUT}
          }`,
        transparent: true,
      }),
    );
    this.group.add(this.arcs);

    // pins: a paper dot in an ink ring; Abu Dhabi in vermilion
    const pos = new Float32Array(PLACES.length * 3);
    const hot = new Float32Array(PLACES.length);
    PLACES.forEach((p, i) => {
      dir(p.lat, p.lon).multiplyScalar(R * 1.006).toArray(pos, i * 3);
      hot[i] = p.id === "abudhabi" ? 1 : 0;
    });
    const pg = new BufferGeometry();
    pg.setAttribute("position", new BufferAttribute(pos, 3));
    pg.setAttribute("hot", new BufferAttribute(hot, 1));
    this.pins = new Points(
      pg,
      new ShaderMaterial({
        uniforms: { uSize: { value: 12 }, uInk: { value: col(C.ink) }, uPaper: { value: col(C.paper) }, uHot: { value: col(C.vermilion) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `uniform float uSize; attribute float hot; varying float vHot;
          void main(){ vHot = hot; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = uSize * (1.0 + 0.25 * hot); }`,
        fragmentShader: /* glsl */ `uniform vec3 uInk, uPaper, uHot; uniform float uOpacity; varying float vHot;
          void main(){
            float r = length(gl_PointCoord - 0.5) * 2.0;
            if (r > 1.0) discard;
            vec3 c = r > 0.62 ? uInk : mix(uPaper, uHot, vHot);
            gl_FragColor = vec4(c, uOpacity * (1.0 - smoothstep(0.88, 1.0, r)));
            ${FRAG_OUT}
          }`,
        transparent: true,
      }),
    );
    this.group.add(this.pins);
  }

  tags(): TagSpec[] {
    return PLACES.map((p, i) => ({
      at: dir(p.lat, p.lon).multiplyScalar(R * 1.006).toArray() as [number, number, number],
      text: p.name,
      sLow: p.id === "abudhabi" ? 5.85 : 6.45,
      sHigh: 99,
      cls: p.side,
      test: () => this.facingCam[i],
    }));
  }

  drag(dx: number, dy: number, ref: number) {
    // the surface follows the pointer: radians per pixel ~ 1 / globe radius in px
    const k = 1 / (ref * 0.35) / RAD;
    this.vlon = -dx * k;
    this.vlat = dy * k;
    this.lon0 += this.vlon;
    this.lat0 = Math.max(-60, Math.min(70, this.lat0 + this.vlat));
    this.dragging = true;
  }
  release() {
    this.dragging = false;
  }

  update(fr: Frame) {
    // drift after a fling, gently
    if (!this.dragging && (Math.abs(this.vlon) > 0.01 || Math.abs(this.vlat) > 0.01)) {
      const k = fr.reduced ? 0 : Math.exp(-fr.dt * 3.5);
      this.vlon *= k;
      this.vlat *= k;
      this.lon0 += this.vlon * (fr.dt * 60);
      this.lat0 = Math.max(-60, Math.min(70, this.lat0 + this.vlat * (fr.dt * 60)));
    }
    if (this.lat0 !== this.heroAt[0] || this.lon0 !== this.heroAt[1]) {
      this.qHero.copy(facing(this.lat0, this.lon0));
      this.heroAt = [this.lat0, this.lon0];
    }
    // as the dive starts, Abu Dhabi turns to face us
    const k = sstep(7.12, 6.65, fr.s);
    this.group.quaternion.slerpQuaternions(this.qHero, this.qAD, k);
    const m = this.sphere.material;
    m.uniforms.uDpr.value = fr.dpr;
    m.uniforms.uOpacity.value = 1;
    this.arcs.material.uniforms.uOpacity.value = sstep(6.55, 6.95, fr.s);
    this.arcs.visible = fr.s > 6.55;
    this.pins.material.uniforms.uSize.value = 12 * fr.dpr;
    this.pins.visible = fr.s > 5.85;
    // which pins face us
    const q = this.group.quaternion;
    this.dirs.forEach((d, i) => {
      this.facingCam[i] = this.tmp.copy(d).applyQuaternion(q).z > 0.15;
    });
  }

  animating(fr: Frame) {
    return !fr.reduced && (Math.abs(this.vlon) > 0.01 || Math.abs(this.vlat) > 0.01) && fr.s > 6.6;
  }
}
