import * as THREE from "three";
import { dotTexture, glow, halo, ink } from "./util";

/**
 * The route is the brand mark, scaled up until you can fly it: three
 * waypoints at the corners of a triangle, joined by an open path that enters
 * at the apex and stops at the third node. Every chapter sits on that path,
 * and the last shot pulls back far enough to read the whole thing as the logo.
 */
export const MARK_SCALE = 80;
const svg = (x: number, y: number) => new THREE.Vector3((x - 16) * MARK_SCALE, 0, (y - 15) * MARK_SCALE);

export const NODES = {
  apex: svg(16, 8.5),
  left: svg(8.5, 21),
  right: svg(23.5, 21),
};

const LEG1 = NODES.left.clone().sub(NODES.apex);
const LEG2 = NODES.right.clone().sub(NODES.left);
export const LEG1_LEN = LEG1.length();
export const LEG2_LEN = LEG2.length();
export const ROUTE_LEN = LEG1_LEN + LEG2_LEN;

const yawOf = (d: THREE.Vector3) => Math.atan2(-d.x, -d.z);

export interface Frame {
  origin: THREE.Vector3;
  yaw: number;
  /** Distance along the whole route, for the trail's "travelled" glow. */
  along: number;
}

const trailVert = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const trailFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uTravel;
  uniform float uLen;
  uniform float uReveal;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float d = vUv.x * uLen;
    float across = abs(vUv.y - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, across);
    float dash = step(0.55, fract(d * 0.08 - uTime * 0.6));
    float travelled = smoothstep(uTravel + 2.0, uTravel - 30.0, d);
    float a = 0.45 * core * mix(0.35 + 0.35 * dash, 1.0, travelled);
    a = mix(a, 0.45 * core, uReveal);
    vec3 col = uColor * mix(1.0, 1.6, travelled * (1.0 - uReveal));
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`;

const groundFrag = /* glsl */ `
  uniform vec3 uDot;
  uniform vec3 uLine;
  uniform float uFade;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float gridLine(vec2 p, float size, float width) {
    vec2 g = abs(fract(p / size - 0.5) - 0.5) * size;
    vec2 fw = fwidth(p);
    vec2 l = 1.0 - smoothstep(vec2(0.0), fw * width, g);
    return max(l.x, l.y);
  }
  void main() {
    vec2 p = vWorld.xz;
    vec2 cell = abs(fract(p / 6.0 - 0.5) - 0.5) * 6.0;
    float dotA = 1.0 - smoothstep(0.08, 0.16, length(cell));
    float major = gridLine(p, 60.0, 1.2);
    vec3 col = vec3(0.0);
    float a = dotA * 0.55 + major * 0.35;
    col = mix(uDot, uLine, major);
    gl_FragColor = vec4(col, a * uFade);
    #include <fog_fragment>
  }
`;
const groundVert = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/** Drifting dust that wraps around the camera — the only thing that sells speed in empty air. */
const dustVert = /* glsl */ `
  uniform vec3 uCam;
  uniform float uBox;
  uniform float uSize;
  varying float vFade;
  void main() {
    vec3 p = mod(position - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    gl_PointSize = uSize * (60.0 / max(dist, 1.0));
    vFade = smoothstep(uBox * 0.5, uBox * 0.15, length(p - uCam));
  }
`;
const dustFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform sampler2D uMap;
  varying float vFade;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, t.a * vFade * 0.5);
  }
`;

/** A flat strip along a polyline, with uv.x = distance along the whole route. */
function ribbon(pts: THREE.Vector3[], width: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let run = 0;
  let vi = 0;
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    // extend each leg by half the width so the corner closes cleanly
    const ext = s === 0 ? 0 : width / 2;
    const steps = Math.ceil(len / 10);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = a.clone().lerp(b, t).addScaledVector(dir, i === 0 ? -ext : 0);
      const d = run + len * t;
      positions.push(p.x - side.x, y, p.z - side.z, p.x + side.x, y, p.z + side.z);
      uvs.push(d / ROUTE_LEN, 0, d / ROUTE_LEN, 1);
      if (i < steps) idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 2;
    }
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

export class World {
  readonly group = new THREE.Group();
  private trailMat: THREE.ShaderMaterial;
  private wideMat: THREE.MeshBasicMaterial;
  private wide: THREE.Mesh;
  private groundMat: THREE.ShaderMaterial;
  private nodes: THREE.Mesh[] = [];
  private dustMat: THREE.ShaderMaterial;
  private nodeGlows: THREE.Sprite[] = [];
  private beacons: THREE.Mesh[] = [];
  readonly markers = new THREE.Group();

  constructor(tier: "high" | "low") {
    // ground
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsLib.fog,
        uDot: { value: ink.faint.clone() },
        uLine: { value: ink.line.clone().multiplyScalar(1.4) },
        uFade: { value: 1 },
      },
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.groundMat);
    ground.renderOrder = -2;
    this.group.add(ground);

    // trail ribbon along the open path, and a wide twin that only shows from altitude
    const pts = [NODES.apex, NODES.left, NODES.right];
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsLib.fog,
        uColor: { value: ink.accent.clone() },
        uTime: { value: 0 },
        uTravel: { value: 0 },
        uLen: { value: ROUTE_LEN },
        uReveal: { value: 0 },
      },
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    const trail = new THREE.Mesh(ribbon(pts, 1.6, 0.06), this.trailMat);
    trail.renderOrder = -1;
    this.group.add(trail);
    this.wideMat = new THREE.MeshBasicMaterial({
      color: ink.accent,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.wide = new THREE.Mesh(ribbon(pts, 34, 0.1), this.wideMat);
    this.wide.renderOrder = -1;
    this.group.add(this.wide);

    // the three waypoints: solid accent nodes, a halo, and a beacon you can see from anywhere
    const nodeGeo = new THREE.SphereGeometry(3.2, 32, 16);
    const beaconGeo = new THREE.CylinderGeometry(0.25, 0.25, 900, 6, 1, true).translate(0, 450 + 48, 0);
    for (const p of pts) {
      const node = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.5) }));
      node.position.copy(p).setY(3.2);
      this.nodes.push(node);
      const h = halo(ink.accent, 22, 0.32);
      h.position.copy(node.position);
      this.nodeGlows.push(h);
      const beacon = new THREE.Mesh(
        beaconGeo,
        new THREE.MeshBasicMaterial({
          color: glow(ink.accent, 1.2),
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      beacon.position.copy(p);
      this.beacons.push(beacon);
      this.group.add(node, h, beacon);
    }

    // sky: faint stars outside the fog, so the final pull-back has a ceiling
    const starCount = tier === "high" ? 2400 : 1200;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 3200;
      const s = Math.sqrt(1 - u * u);
      starPos.set([Math.cos(th) * s * r, Math.abs(u) * r * 0.9 + 80, Math.sin(th) * s * r], i * 3);
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({
        color: ink.body,
        size: 2.2,
        sizeAttenuation: false,
        map: dotTexture(),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        fog: false,
      }),
    );
    this.group.add(stars);

    // dust
    const dustCount = tier === "high" ? 1400 : 600;
    const box = 160;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount * 3; i++) dustPos[i] = (Math.random() - 0.5) * box;
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uBox: { value: box },
        uSize: { value: 5 },
        uColor: { value: ink.body.clone() },
        uMap: { value: dotTexture() },
      },
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
    });
    const dust = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(dustPos, 3)),
      this.dustMat,
    );
    dust.frustumCulled = false;
    this.group.add(dust);

    this.group.add(this.markers);
  }

  /** Where a scene sits: `leg` 0 runs apex → left, 1 runs left → right; `f` is 0..1 along it. */
  frame(leg: 0 | 1, f: number): Frame {
    const a = leg === 0 ? NODES.apex : NODES.left;
    const d = leg === 0 ? LEG1 : LEG2;
    return {
      origin: a.clone().addScaledVector(d, f),
      yaw: yawOf(d),
      along: (leg === 0 ? 0 : LEG1_LEN) + (leg === 0 ? LEG1_LEN : LEG2_LEN) * f,
    };
  }

  /** A small waypoint on the trail for each chapter — only legible from the final altitude. */
  addMarker(f: Frame) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.2, 0),
      new THREE.MeshBasicMaterial({ color: glow(ink.heading, 1.1) }),
    );
    m.position.copy(f.origin).setY(1.5);
    this.markers.add(m);
  }

  update(time: number, camera: THREE.Camera, travel: number, reveal: number) {
    this.trailMat.uniforms.uTime.value = time;
    this.trailMat.uniforms.uTravel.value = travel;
    this.trailMat.uniforms.uReveal.value = reveal;
    this.dustMat.uniforms.uCam.value.copy(camera.position);
    const pulse = 1 + Math.sin(time * 1.6) * 0.08;
    // from the top the route has to read as the mark: fat path, big nodes
    this.wideMat.opacity = 0.45 * reveal;
    this.wide.visible = reveal > 0.01;
    this.groundMat.uniforms.uFade.value = 1 - reveal * 0.85;
    for (const n of this.nodes) {
      n.scale.setScalar(1 + reveal * 22);
      n.position.y = 3.2 * (1 + reveal * 22);
    }
    for (const h of this.nodeGlows) h.scale.setScalar(22 * pulse * (1 + reveal * 14));
    for (const b of this.beacons) (b.material as THREE.MeshBasicMaterial).opacity = 0.18 * (1 - reveal * 0.7);
    this.markers.visible = reveal > 0.05;
    for (const m of this.markers.children) {
      m.rotation.y = time * 0.8;
      m.scale.setScalar(1 + reveal * 5);
    }
  }
}
