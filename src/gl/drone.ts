import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  ShaderMaterial,
  Shape,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C, canvasTexture, col, FRAG_OUT, Level, ramp, sstep } from "./kit";
import type { Frame } from "./kit";
import { O_DRONE } from "./world";

function roundRect(w: number, h: number, r: number) {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

const toon = (hex: string, extra: Partial<ConstructorParameters<typeof MeshToonMaterial>[0]> = {}) =>
  new MeshToonMaterial({ color: col(hex), gradientMap: ramp(), ...extra });

/**
 * The drone we dive into, in metres, drawn like a technical illustration:
 * carbon X frame, a paper-white canopy with a vermilion stripe, prop discs.
 * Its origin is the top face of the flight controller inside it.
 */
export class Drone extends Level {
  private canopy: Mesh<BufferGeometry, MeshToonMaterial>;
  private props: Mesh<BufferGeometry, ShaderMaterial>;
  private blades: Mesh<BufferGeometry, MeshBasicMaterial>;

  constructor() {
    super(0, O_DRONE, -1.95, 2.35);
    const carbon = toon("#2b2a27");
    const plate = toon("#3b3934");
    const metal = toon("#8d8a82");
    const motorInk = toon("#22211e");

    // frame: two arms in an X, a bottom plate, motor mounts
    const frame: BufferGeometry[] = [];
    for (const r of [Math.PI / 4, -Math.PI / 4]) frame.push(new BoxGeometry(0.6, 0.032, 0.006).rotateZ(r).translate(0, 0, -0.019));
    for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) frame.push(new CylinderGeometry(0.03, 0.03, 0.006, 24).rotateX(Math.PI / 2).translate(x * 0.212, y * 0.212, -0.019));
    this.group.add(new Mesh(mergeGeometries(frame.map(stripUv))!, carbon));
    this.group.add(new Mesh(new ExtrudeGeometry(roundRect(0.17, 0.11, 0.025), { depth: 0.004, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.026), plate));

    // motors: a dark stator can, a lighter bell, a hub
    const cans: BufferGeometry[] = [], bells: BufferGeometry[] = [];
    for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      cans.push(new CylinderGeometry(0.022, 0.022, 0.024, 24).rotateX(Math.PI / 2).translate(x * 0.212, y * 0.212, -0.004));
      bells.push(new CylinderGeometry(0.0205, 0.022, 0.006, 24).rotateX(Math.PI / 2).translate(x * 0.212, y * 0.212, 0.011));
      bells.push(new CylinderGeometry(0.006, 0.006, 0.012, 12).rotateX(Math.PI / 2).translate(x * 0.212, y * 0.212, 0.017));
    }
    this.group.add(new Mesh(mergeGeometries(cans)!, motorInk), new Mesh(mergeGeometries(bells)!, metal));

    // stack under the canopy: an ESC board, brass standoffs, one cable per arm
    const esc = new Mesh(new BoxGeometry(0.036, 0.036, 0.0016), toon("#24323a"));
    esc.position.set(0, 0, -0.011);
    const posts: BufferGeometry[] = [];
    for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) posts.push(new CylinderGeometry(0.0016, 0.0016, 0.03, 10).rotateX(Math.PI / 2).translate(x * 0.01525, y * 0.01525, -0.008));
    const cables: BufferGeometry[] = [];
    for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const len = 0.19, a = Math.atan2(y, x);
      cables.push(new CylinderGeometry(0.0022, 0.0022, len, 8).rotateZ(Math.PI / 2).rotateZ(a).translate(Math.cos(a) * (0.02 + len / 2), Math.sin(a) * (0.02 + len / 2), -0.014));
    }
    this.group.add(esc, new Mesh(mergeGeometries(posts)!, toon("#b8964f")), new Mesh(mergeGeometries(cables)!, toon("#3a3833")));

    // navigation lights: vermilion at the front (+x), paper at the back
    const front: BufferGeometry[] = [], back: BufferGeometry[] = [];
    for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) (x > 0 ? front : back).push(new BoxGeometry(0.012, 0.008, 0.005).translate(x * 0.245, y * 0.245, -0.014));
    this.group.add(new Mesh(mergeGeometries(front)!, new MeshBasicMaterial({ color: col("#e85a2c") })), new Mesh(mergeGeometries(back)!, new MeshBasicMaterial({ color: col("#fffaf0") })));

    // antennas, splayed out behind
    const ant: BufferGeometry[] = [];
    for (const side of [1, -1]) ant.push(new CylinderGeometry(0.0012, 0.0012, 0.07, 6).rotateZ(Math.PI / 2 + side * 0.5).translate(-0.105, side * 0.035, -0.012));
    this.group.add(new Mesh(mergeGeometries(ant)!, toon("#2b2a27")));

    // the canopy: a dome, with a stripe nose to tail
    const stripe = canvasTexture(256, (g, n) => {
      g.fillStyle = C.paper;
      g.fillRect(0, 0, n, n);
      g.fillStyle = C.vermilion;
      g.fillRect(0, n * 0.44, n, n * 0.12);
    });
    const dome = new SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    // stripe along the longitudinal axis: map u around the dome, v from the top
    const uv = dome.attributes.uv, pos = dome.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5 + Math.atan2(pos.getZ(i), pos.getY(i)) / Math.PI);
    dome.rotateX(Math.PI / 2).scale(0.085, 0.058, 0.045).translate(0, 0, -0.004);
    this.canopy = new Mesh(dome, toon("#ffffff", { map: stripe, transparent: true }));
    this.group.add(this.canopy);

    // props: a translucent blur disc and the ghost of two blades, per motor
    const discs: BufferGeometry[] = [], bl: BufferGeometry[] = [];
    [[1, 1, 0.3], [1, -1, 1.4], [-1, 1, 2.2], [-1, -1, 0.9]].forEach(([x, y, a]) => {
      discs.push(new CircleGeometry(0.127, 48).translate(x * 0.212, y * 0.212, 0.024));
      const blade = new Shape();
      blade.moveTo(0, -0.009);
      blade.quadraticCurveTo(0.07, -0.016, 0.125, -0.004);
      blade.quadraticCurveTo(0.128, 0.004, 0.12, 0.006);
      blade.quadraticCurveTo(0.06, 0.012, 0, 0.009);
      for (const k of [0, Math.PI]) bl.push(new ExtrudeGeometry(blade, { depth: 0.0015, bevelEnabled: false, curveSegments: 8 }).rotateZ(a + k).translate(x * 0.212, y * 0.212, 0.022));
    });
    this.props = new Mesh(
      mergeGeometries(discs)!,
      new ShaderMaterial({
        uniforms: { uInk: { value: col(C.ink) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `varying vec2 vL; void main(){ vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `uniform vec3 uInk; uniform float uOpacity; varying vec2 vL;
          void main(){
            vec2 q = abs(vL) - 0.212;
            float r = length(q) / 0.127;
            float fw = fwidth(r);
            float rim = (1.0 - smoothstep(0.0, fw * 1.5, abs(r - 0.985)));
            float a = 0.07 + 0.16 * smoothstep(0.7, 0.97, r) + rim * 0.35;
            gl_FragColor = vec4(uInk, a * uOpacity);
            ${FRAG_OUT}
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.blades = new Mesh(mergeGeometries(bl)!, new MeshBasicMaterial({ color: col(C.ink), transparent: true, opacity: 0.22, depthWrite: false }));
    this.group.add(this.blades, this.props);
  }

  update(fr: Frame) {
    // lift the canopy away to show what's inside
    const o = sstep(-1.0, -0.55, fr.s);
    const m = this.canopy.material;
    m.opacity = o;
    m.depthWrite = o > 0.99;
    this.canopy.visible = o > 0.01;
    const po = sstep(-1.3, -0.8, fr.s);
    this.props.material.uniforms.uOpacity.value = po;
    this.blades.material.opacity = 0.22 * po;
    this.props.visible = this.blades.visible = po > 0.01;
  }
}

function stripUv(g: BufferGeometry) {
  g.deleteAttribute("uv");
  return g;
}
