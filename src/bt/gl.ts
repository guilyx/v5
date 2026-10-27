import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Camera } from "./cam";
import type { Layer, EdgeData, FrameData, RobotPose } from "./layer";

const MAX_EDGES = 120;
const MAX_FRAMES = 24;

/** hex → vec3 in display space (the shaders below write display values directly) */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export const COLORS = {
  bg: "#f3f5f8",
  dot: "#c3cbd6",
  idle: "#c2cad6",
  run: "#f59e0b",
  ok: "#1f9d55",
  head: "#e2560b",
  halo: "#fcd34d",
};

export function createGL(canvas: HTMLCanvasElement, mobile: boolean): Layer | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setClearColor(COLORS.bg, 1);
  const scene = new Scene();
  const cam = new PerspectiveCamera();
  cam.matrixAutoUpdate = false;
  cam.matrixWorldAutoUpdate = false;

  // ── the board: a dot grid that thins out as you zoom out, fading with distance ──
  const boardMat = new ShaderMaterial({
    uniforms: {
      uBg: { value: rgb(COLORS.bg) },
      uDot: { value: rgb(COLORS.dot) },
      uFocal: { value: 1000 },
      uDist: { value: 1000 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vB;
      varying float vDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vB = vec2(wp.x, -wp.y);
        vec4 vp = viewMatrix * wp;
        vDepth = -vp.z;
        gl_Position = projectionMatrix * vp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBg;
      uniform vec3 uDot;
      uniform float uFocal;
      uniform float uDist;
      varying vec2 vB;
      varying float vDepth;
      float dots(vec2 b, float cell, float r, float s) {
        vec2 f = fract(b / cell) - 0.5;
        float d = length(f) * cell * s;
        return 1.0 - smoothstep(r - 0.7, r + 0.7, d);
      }
      void main() {
        float s = uFocal / max(vDepth, 1.0);
        float fine = dots(vB, 24.0, 1.25, s) * smoothstep(0.16, 0.34, s);
        float coarse = dots(vB, 120.0, 1.35, s) * (1.0 - smoothstep(0.34, 0.6, s));
        float a = max(fine, coarse);
        a *= 1.0 - smoothstep(uDist * 1.35, uDist * 3.2, vDepth);
        gl_FragColor = vec4(mix(uBg, uDot, a), 1.0);
      }`,
  });
  const board = new Mesh(new PlaneGeometry(1, 1), boardMat);
  board.frustumCulled = false;
  scene.add(board);

  // ── chapter frames: soft rounded panels behind each chapter, tinted by status ──
  const frameGeo = new InstancedBufferGeometry();
  frameGeo.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  frameGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const fRect = new InstancedBufferAttribute(new Float32Array(MAX_FRAMES * 4), 4);
  const fState = new InstancedBufferAttribute(new Float32Array(MAX_FRAMES * 2), 2);
  frameGeo.setAttribute("aRect", fRect);
  frameGeo.setAttribute("aState", fState);
  frameGeo.instanceCount = 0;
  const frameMat = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uFocal: { value: 1000 },
      uIdle: { value: rgb("#94a3b8") },
      uRun: { value: rgb(COLORS.run) },
      uOk: { value: rgb(COLORS.ok) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aRect;
      attribute vec2 aState;
      varying vec2 vP;
      varying vec2 vSize;
      varying vec2 vS;
      varying float vDepth;
      void main() {
        vec2 size = aRect.zw - aRect.xy;
        vec2 b = aRect.xy + position.xy * size;
        vP = b - aRect.xy - size * 0.5;
        vSize = size;
        vS = aState;
        vec4 vp = viewMatrix * vec4(b.x, -b.y, 0.2, 1.0);
        vDepth = -vp.z;
        gl_Position = projectionMatrix * vp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFocal;
      uniform vec3 uIdle;
      uniform vec3 uRun;
      uniform vec3 uOk;
      varying vec2 vP;
      varying vec2 vSize;
      varying vec2 vS;
      varying float vDepth;
      void main() {
        float r = 28.0;
        vec2 q = abs(vP) - vSize * 0.5 + r;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        float px = max(vDepth, 1.0) / uFocal;         // board units per pixel
        float fill = 1.0 - smoothstep(-px, px, d);
        float line = 1.0 - smoothstep(0.6 * px, 1.6 * px, abs(d));
        vec3 c = vS.x > 1.5 ? uOk : vS.x > 0.5 ? uRun : uIdle;
        float on = vS.y;                                // 0..1 focus
        float a = fill * mix(0.018, 0.05, on) + line * mix(0.10, 0.42, on);
        if (vS.x < 0.5) a = fill * 0.012 + line * 0.12;
        gl_FragColor = vec4(c, a);
      }`,
  });
  const frames = new Mesh(frameGeo, frameMat);
  frames.frustumCulled = false;
  frames.renderOrder = 1;
  scene.add(frames);

  // ── edges: one ribbon mesh, constant width on screen, filled and pulsed in the shader ──
  const edgeMat = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uEdge: { value: new Float32Array(MAX_EDGES * 4) },
      uTime: { value: 0 },
      uFocal: { value: 1000 },
      uHalf: { value: 7 },
      uAmbient: { value: 1 },
      uIdle: { value: rgb(COLORS.idle) },
      uRun: { value: rgb(COLORS.run) },
      uOk: { value: rgb(COLORS.ok) },
      uHead: { value: rgb(COLORS.head) },
      uGlow: { value: rgb(COLORS.halo) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aNrm;
      attribute float aSide;
      attribute float aS;
      attribute float aEdge;
      uniform vec4 uEdge[${MAX_EDGES}];
      uniform float uFocal;
      uniform float uHalf;
      varying float vSide;
      varying float vS;
      varying vec4 vE;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float depth = max(1.0, -(viewMatrix * wp).z);
        float hw = uHalf * depth / uFocal;
        wp.xy += aNrm * aSide * hw;
        vSide = aSide;
        vS = aS;
        vE = uEdge[int(aEdge + 0.5)];
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uHalf;
      uniform float uAmbient;
      uniform vec3 uIdle;
      uniform vec3 uRun;
      uniform vec3 uOk;
      uniform vec3 uHead;
      uniform vec3 uGlow;
      varying float vSide;
      varying float vS;
      varying vec4 vE;
      void main() {
        float fill = vE.x;
        float state = vE.y;
        float len = vE.z;
        float d = abs(vSide) * uHalf;
        float filled = step(vS, fill);
        float core = mix(0.85, 1.35, filled);
        vec3 base = mix(uIdle, state > 1.5 ? uOk : uRun, filled);

        // the tick's leading edge while an edge fills
        float glow = 0.0;
        if (fill > 0.5 && fill < len - 0.5) {
          float h = fill - vS;
          glow = h >= 0.0 ? exp(-h / 26.0) : exp(-h * h / 30.0);
        }
        // a RUNNING child keeps receiving ticks: pulses keep flowing down its edge
        if (uAmbient > 0.5 && state > 0.5 && state < 1.5 && fill >= len - 0.5) {
          float k = mod(vS - uTime * 190.0 - vE.w, 420.0) - 210.0;
          glow = max(glow, exp(-k * k / 260.0));
        }
        // a tick is a bead on the wire: a thicker, deeper run of line in a soft halo
        glow = clamp(glow, 0.0, 1.0);
        float cw = core + 1.5 * glow;
        float lineA = 1.0 - smoothstep(cw - 0.6, cw + 0.7, d);
        float haloA = (1.0 - smoothstep(cw, uHalf, d)) * glow * 0.5;
        vec3 col = mix(uGlow, mix(base, uHead, glow), lineA);
        float a = max(lineA, haloA);
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
  let edgeMesh: Mesh | null = null;
  let edgeCount = 0;

  // ── the robot: a small differential-drive rover, one merged mesh plus wheels and eyes ──
  const robot = buildRobot();
  scene.add(robot.root);
  scene.add(new HemisphereLight("#ffffff", "#aab6c6", 2.1));
  const sun = new DirectionalLight("#ffffff", 2.0);
  sun.position.set(-0.45, 0.7, 1);
  scene.add(sun);

  let wheelAngle = 0;

  const api: Layer = {
    kind: "gl",
    resize(w, h) {
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
      renderer.setSize(w, h, false);
    },
    setGraph(edges: EdgeData[], bounds) {
      // board quad covers the tree with a wide margin
      const m = 6000;
      board.scale.set(bounds.x1 - bounds.x0 + m * 2, bounds.y1 - bounds.y0 + m * 2, 1);
      board.position.set((bounds.x0 + bounds.x1) / 2, -(bounds.y0 + bounds.y1) / 2, 0);

      let nPts = 0;
      for (const e of edges) nPts += e.pts.length / 2;
      const pos = new Float32Array(nPts * 2 * 3);
      const nrm = new Float32Array(nPts * 2 * 2);
      const side = new Float32Array(nPts * 2);
      const sArr = new Float32Array(nPts * 2);
      const eArr = new Float32Array(nPts * 2);
      const idx: number[] = [];
      let v = 0;
      edges.forEach((e, ei) => {
        const p = e.pts;
        const n = p.length / 2;
        for (let i = 0; i < n; i++) {
          const x = p[i * 2];
          const y = p[i * 2 + 1];
          // averaged normal in board space, flipped into world (y up)
          const i0 = Math.max(0, i - 1);
          const i1 = Math.min(n - 1, i + 1);
          let tx = p[i1 * 2] - p[i0 * 2];
          let ty = p[i1 * 2 + 1] - p[i0 * 2 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const nx = -ty;
          const ny = tx;
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            pos[v * 3] = x;
            pos[v * 3 + 1] = -y;
            pos[v * 3 + 2] = 0.5;
            nrm[v * 2] = nx;
            nrm[v * 2 + 1] = -ny;
            side[v] = sgn;
            sArr[v] = e.cum[i];
            eArr[v] = ei;
            v++;
          }
          if (i < n - 1) {
            const a = v - 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      });
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("aNrm", new BufferAttribute(nrm, 2));
      g.setAttribute("aSide", new BufferAttribute(side, 1));
      g.setAttribute("aS", new BufferAttribute(sArr, 1));
      g.setAttribute("aEdge", new BufferAttribute(eArr, 1));
      g.setIndex(idx);
      if (edgeMesh) {
        edgeMesh.geometry.dispose();
        edgeMesh.geometry = g;
      } else {
        edgeMesh = new Mesh(g, edgeMat);
        edgeMesh.frustumCulled = false;
        edgeMesh.renderOrder = 2;
        scene.add(edgeMesh);
      }
      edgeCount = Math.min(edges.length, MAX_EDGES);
    },
    setEdgeStates(states: Float32Array) {
      const u = edgeMat.uniforms.uEdge.value as Float32Array;
      u.set(states.subarray(0, edgeCount * 4));
    },
    setFrames(list: FrameData[]) {
      const n = Math.min(list.length, MAX_FRAMES);
      for (let i = 0; i < n; i++) {
        const f = list[i];
        fRect.setXYZW(i, f.x0, f.y0, f.x1, f.y1);
        fState.setXY(i, f.state, f.focus);
      }
      fRect.needsUpdate = true;
      fState.needsUpdate = true;
      frameGeo.instanceCount = n;
    },
    render(c: Camera, pose: RobotPose, time: number, ambient: boolean, dt: number) {
      cam.matrixWorldInverse.fromArray(c.view);
      cam.matrixWorld.copy(cam.matrixWorldInverse).invert();
      cam.projectionMatrix.fromArray(c.proj);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      const focal = c.focal;
      boardMat.uniforms.uFocal.value = focal;
      boardMat.uniforms.uDist.value = c.dist;
      frameMat.uniforms.uFocal.value = focal;
      edgeMat.uniforms.uFocal.value = focal;
      edgeMat.uniforms.uTime.value = time;
      edgeMat.uniforms.uAmbient.value = ambient ? 1 : 0;

      // robot
      robot.root.visible = pose.visible;
      robot.root.position.set(pose.x, -pose.y, 0);
      robot.root.rotation.z = -pose.a;
      robot.root.scale.setScalar(pose.scale);
      wheelAngle += (pose.speed * dt) / 6.5;
      robot.wheelL.rotation.y = wheelAngle;
      robot.wheelR.rotation.y = wheelAngle;
      robot.body.position.z = pose.speed > 1 ? Math.sin(time * 26) * 0.35 : 0;
      if (ambient) robot.lidar.rotation.z = time * 4.2;
      robot.eyes.color.set(pose.led);
      renderer.render(scene, cam);
      return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    },
    dispose() {
      renderer.dispose();
    },
  };
  return api;
}

/** a little rover: white shell, dark sensor bar, a lidar puck, two wheels, eyes that show the tick */
function buildRobot() {
  const parts: BufferGeometry[] = [];
  const add = (src: BufferGeometry, hex: string, x: number, y: number, z: number, rx = 0) => {
    const g = src.index ? src.toNonIndexed() : src;
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    const c = rgbLinear(hex);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute("color", new BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    parts.push(g);
  };
  // shell
  add(new RoundedBoxGeometry(38, 28, 13, 3, 4.5), "#fbfcfe", 0, 0, 11);
  // deck and a stripe in the "sequence" blue
  add(new RoundedBoxGeometry(28, 22, 3, 2, 1.2), "#e3e8ef", -2, 0, 18.2);
  add(new BoxGeometry(38.4, 28.4, 1.6), "#3552e0", 0, 0, 8.6);
  // sensor bar
  add(new RoundedBoxGeometry(3, 21, 7.5, 2, 1.2), "#0f172a", 18.6, 0, 12.5);
  // lidar mast
  add(new CylinderGeometry(3, 3, 6, 14), "#334155", -4, 0, 22, Math.PI / 2);
  // caster
  add(new SphereGeometry(2.6, 10, 8), "#334155", 13, 0, 2.6);
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 });
  const body = new Mesh(mergeGeometries(parts)!, mat);

  // the lidar puck spins while the tree runs
  parts.length = 0;
  add(new CylinderGeometry(7.2, 7.2, 5, 24), "#111827", 0, 0, 27, Math.PI / 2);
  add(new CylinderGeometry(7.5, 7.5, 1.2, 24), "#3552e0", 0, 0, 25.1, Math.PI / 2);
  add(new BoxGeometry(2.4, 6, 2.2), "#7dd3fc", 6.6, 0, 27.2);
  const lidar = new Mesh(mergeGeometries(parts)!, mat);
  lidar.position.set(-4, 0, 0);
  body.add(lidar);

  const wheelGeo = new CylinderGeometry(6.6, 6.6, 4.4, 20);
  const wheelMat = new MeshStandardMaterial({ color: "#1e293b", roughness: 0.8 });
  const wheelL = new Mesh(wheelGeo, wheelMat);
  const wheelR = new Mesh(wheelGeo, wheelMat);
  wheelL.position.set(-5, 16.4, 6.6);
  wheelR.position.set(-5, -16.4, 6.6);

  const eyeGeo = mergeGeometries([
    new BoxGeometry(1.2, 4.2, 2.6).translate(20.3, 4.6, 13.2),
    new BoxGeometry(1.2, 4.2, 2.6).translate(20.3, -4.6, 13.2),
  ])!;
  const eyesMat = new MeshBasicMaterial({ color: "#f59e0b" });
  const eyes = new Mesh(eyeGeo, eyesMat);

  // soft contact shadow
  const shadow = new Mesh(
    new PlaneGeometry(64, 52),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; void main(){ vec2 p = (vUv - 0.5) * 2.0; float d = dot(p,p); gl_FragColor = vec4(0.06,0.09,0.16, 0.26 * (1.0 - smoothstep(0.15, 1.0, d))); }`,
    }) as Material,
  );
  shadow.position.set(-1, 0, 0.3);
  shadow.renderOrder = 3;

  body.add(eyes);
  const root = new Group();
  root.add(shadow, body, wheelL, wheelR);
  body.renderOrder = 4;
  return { root, body, wheelL, wheelR, lidar, eyes: eyesMat };
}

function rgbLinear(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
