/**
 * The reel in 3D: one strip of film curling through space on a helix, with a
 * clip in each frame. The curve lives in the vertex shader, so moving the strip
 * is one uniform; nothing is rebuilt on the CPU. It renders only when something
 * changes: the offset, the size, or a new frame of the clip that's playing.
 * 9 draw calls, ~1.4k triangles.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from "three";

export interface Clip {
  key: string;
  ratio: number;
}
export interface StripApi {
  setOffset(o: number): void;
  setVisible(v: boolean): void;
  play(i: number | null): void;
  pick(clientX: number, clientY: number): number;
  framePx(): number;
  resize(): void;
  stats(): { calls: number; triangles: number; cpuMs: number; renders: number };
}

// the helix: radius, one frame per unit of arc, a slow rise and a twist
const R = 1.62;
const K = 1 / R;
const RISE = 0.11;
const ROLL = 0.16;
const HALF_W = 0.37; // strip half-width
const PIC_W = 0.45; // picture half-width (16:9)
const PIC_H = 0.253; // picture half-height
const FOV = 24;

const CURVE = /* glsl */ `
  const float R = ${R.toFixed(4)};
  const float K = ${K.toFixed(6)};
  const float RISE = ${RISE.toFixed(4)};
  const float ROLL = ${ROLL.toFixed(4)};
  vec3 curveP(float u) {
    float a = u * K;
    // level at the gate (u = 0), rising and falling away from it
    return vec3(R * sin(a), RISE * u * tanh(0.9 * abs(u)) + 0.05 * (1.0 - cos(u * 1.3)), R * (cos(a) - 1.0));
  }
`;

const VERT = /* glsl */ `
  uniform float uOffset;
  uniform float uIndex;
  uniform vec2 uHalf;
  uniform float uLift;
  attribute vec2 aSV;
  varying vec2 vUv;
  varying vec2 vSV;
  varying float vDepth;
  varying float vFacing;
  ${CURVE}
  void main() {
    float sl = aSV.x * uHalf.x;
    float u = sl + uIndex - uOffset;
    vec3 p = curveP(u);
    vec3 t = normalize(curveP(u + 0.01) - curveP(u - 0.01));
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 a = normalize(up - t * dot(up, t));
    vec3 b = cross(t, a);
    float r = ROLL * u;
    vec3 acr = a * cos(r) + b * sin(r);
    vec3 n = cross(t, acr);
    vec3 pos = p + acr * (aSV.y * uHalf.y) + n * uLift;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDepth = -mv.z;
    vFacing = abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz)));
    vUv = aSV * 0.5 + 0.5;
    vSV = vec2(sl + uIndex, aSV.y);
    gl_Position = projectionMatrix * mv;
  }
`;

const STRIP_FRAG = /* glsl */ `
  uniform vec3 uBg;
  uniform vec2 uFog;
  uniform float uN;
  varying vec2 vSV;
  varying float vDepth;
  varying float vFacing;
  void main() {
    float s = vSV.x;
    float w = abs(vSV.y) * ${HALF_W.toFixed(3)};
    // perforations: four per frame
    float sx = (fract(s * 4.0) - 0.5) * 0.25;
    vec2 d = abs(vec2(sx, w - 0.312)) - vec2(0.04, 0.016);
    float hole = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.014;
    if (hole < 0.0) discard;
    float k = floor(s + 0.5);
    bool pic = w < ${PIC_H.toFixed(3)} && abs(s - k) < ${PIC_W.toFixed(3)};
    if (pic && k > -0.5 && k < uN - 0.5) discard; // the clip's own mesh draws here
    vec3 col = pic ? vec3(0.012, 0.008, 0.005) : vec3(0.026, 0.016, 0.009);
    // edge print: a gold tick at every frame line
    if (abs(fract(s) - 0.5) < 0.012 && w > 0.26 && w < 0.29) col = vec3(0.5, 0.3, 0.08);
    col += vec3(0.3, 0.2, 0.09) * smoothstep(0.35, 0.37, w) * 0.5;
    col += vec3(0.12, 0.08, 0.035) * pow(1.0 - vFacing, 3.0);
    col = mix(col, uBg, smoothstep(uFog.x, uFog.y, vDepth) * 0.9);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const FRAME_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec2 uUvScale;
  uniform float uDim;
  uniform float uHas;
  uniform vec3 uBg;
  uniform vec2 uFog;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vec2 uv = (vUv - 0.5) * uUvScale + 0.5;
    vec3 col = mix(vec3(0.03, 0.02, 0.013), texture2D(uTex, uv).rgb, uHas);
    vec2 e = abs(vUv - 0.5) * 2.0;
    col *= 1.0 - 0.28 * pow(max(e.x, e.y), 5.0);
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, l * vec3(1.05, 0.88, 0.7), uDim * 0.7) * (1.0 - uDim * 0.55);
    if (!gl_FrontFacing) col *= 0.4;
    col = mix(col, uBg, smoothstep(uFog.x, uFog.y, vDepth) * 0.9);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function grid(s0: number, s1: number, segS: number) {
  const n = (segS + 1) * 2;
  const sv = new Float32Array(n * 2);
  const idx: number[] = [];
  for (let i = 0; i <= segS; i++) {
    const s = s0 + ((s1 - s0) * i) / segS;
    sv.set([s, -1, s, 1], i * 4);
    if (i < segS) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aSV", new BufferAttribute(sv, 2));
  g.setIndex(idx);
  return g;
}

// the same curve, on the CPU, for picking
const tmpA = new Vector3();
const tmpB = new Vector3();
function curveP(u: number, out: Vector3) {
  const a = u * K;
  return out.set(R * Math.sin(a), RISE * u * Math.tanh(0.9 * Math.abs(u)) + 0.05 * (1 - Math.cos(u * 1.3)), R * (Math.cos(a) - 1));
}
function pointOn(u: number, v: number, out: Vector3) {
  const p = curveP(u, out);
  const t = curveP(u + 0.01, tmpA).sub(curveP(u - 0.01, tmpB)).normalize();
  const up = new Vector3(0, 1, 0);
  const a = up.clone().sub(t.clone().multiplyScalar(up.dot(t))).normalize();
  const b = new Vector3().crossVectors(t, a);
  const r = ROLL * u;
  const acr = a.multiplyScalar(Math.cos(r)).add(b.multiplyScalar(Math.sin(r)));
  return p.add(acr.multiplyScalar(v));
}

export async function createStrip(stage: HTMLElement, clips: Clip[], reduced: boolean): Promise<StripApi | null> {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  const mobile = matchMedia("(max-width: 760px)").matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  stage.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 30);
  const bg = new Color("#15100c");
  const uOffset = { value: 0 };
  const uFog = { value: new Vector2(2, 5) };
  const N = clips.length;

  const strip = new Mesh(
    grid(-4.5, N + 3.5, (N + 8) * 32),
    new ShaderMaterial({
      uniforms: { uOffset, uIndex: { value: 0 }, uHalf: { value: new Vector2(1, HALF_W) }, uLift: { value: 0 }, uBg: { value: bg }, uFog, uN: { value: N } },
      vertexShader: VERT,
      fragmentShader: STRIP_FRAG,
      side: DoubleSide,
    }),
  );
  strip.frustumCulled = false;
  scene.add(strip);

  const frameGeo = grid(-1, 1, 24);
  const loader = new TextureLoader();
  const FA = PIC_W / PIC_H;
  const cover = (r: number) => (r > FA ? new Vector2(FA / r, 1) : new Vector2(1, r / FA));
  let invalidate = () => {};
  const posters: Texture[] = [];
  const mats = clips.map((c, i) => {
    const m = new ShaderMaterial({
      uniforms: {
        uOffset,
        uIndex: { value: i },
        uHalf: { value: new Vector2(PIC_W, PIC_H) },
        uLift: { value: 0.0015 },
        uTex: { value: null as Texture | null },
        uUvScale: { value: cover(c.ratio) },
        uDim: { value: 1 },
        uHas: { value: 0 },
        uBg: { value: bg },
        uFog,
      },
      vertexShader: VERT,
      fragmentShader: FRAME_FRAG,
      side: DoubleSide,
    });
    posters[i] = loader.load(`/work/${c.key}.webp`, (t) => {
      t.colorSpace = SRGBColorSpace;
      if (m.uniforms.uTex.value === t) m.uniforms.uHas.value = 1;
      invalidate();
    });
    posters[i].colorSpace = SRGBColorSpace;
    m.uniforms.uTex.value = posters[i];
    const mesh = new Mesh(frameGeo, m);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return m;
  });

  // one <video> feeds whichever clip sits in the gate
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  const vtex = new VideoTexture(video);
  vtex.colorSpace = SRGBColorSpace;
  let playing = -1;
  type RVFC = { requestVideoFrameCallback?: (cb: () => void) => number };

  let visible = false;
  let raf = 0;
  let cpuSum = 0;
  let renders = 0;
  const render = () => {
    raf = 0;
    if (!visible) return;
    const t0 = performance.now();
    renderer.render(scene, camera);
    // the first few frames compile shaders and upload textures; time the steady state
    if (++renders > 5) cpuSum += performance.now() - t0;
  };
  invalidate = () => {
    if (visible && !raf) raf = requestAnimationFrame(render);
  };

  let D = 2;
  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    const ft = Math.tan(((FOV / 2) * Math.PI) / 180);
    const frac = aspect < 1.5 ? 0.64 : 0.36;
    const Dh = PIC_H / 0.5 / ft;
    const Dw = PIC_W / frac / (ft * aspect);
    D = Math.max(Dh, Dw);
    camera.position.set(0, 0.16 * D, D);
    camera.lookAt(0, 0.02, -0.25);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    uFog.value.set(D + 0.4, D + 3.4);
    invalidate();
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  // compile both programs now (we're in idle time), not on the first visible frame
  renderer.compile(scene, camera);

  const setPoster = (i: number) => {
    const m = mats[i];
    m.uniforms.uTex.value = posters[i];
    m.uniforms.uHas.value = posters[i].image ? 1 : 0;
    m.uniforms.uUvScale.value = cover(clips[i].ratio);
  };

  const api: StripApi = {
    setOffset(o) {
      if (uOffset.value === o) return;
      uOffset.value = o;
      mats.forEach((m, i) => (m.uniforms.uDim.value = Math.min(1, Math.abs(i - o) * 1.3)));
      invalidate();
    },
    setVisible(v) {
      visible = v;
      if (v) invalidate();
      else video.pause();
    },
    play(i) {
      if (reduced) i = null;
      if ((i ?? -1) === playing) {
        if (i !== null && video.paused && visible) void video.play().catch(() => {});
        return;
      }
      if (playing >= 0) setPoster(playing);
      playing = i ?? -1;
      if (i === null) {
        video.pause();
        invalidate();
        return;
      }
      const want = i;
      video.src = `/work/${clips[i].key}.mp4`;
      const onFrame = () => {
        if (playing !== want || video.paused) return;
        const m = mats[want];
        if (m.uniforms.uTex.value !== vtex) {
          m.uniforms.uTex.value = vtex;
          m.uniforms.uHas.value = 1;
          m.uniforms.uUvScale.value = cover(video.videoWidth / video.videoHeight || clips[want].ratio);
        }
        invalidate();
        const v = video as unknown as RVFC;
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
        else requestAnimationFrame(onFrame);
      };
      video
        .play()
        .then(() => {
          const v = video as unknown as RVFC;
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
          else requestAnimationFrame(onFrame);
        })
        .catch(() => {});
    },
    pick(cx, cy) {
      const rect = canvas.getBoundingClientRect();
      const x = ((cx - rect.left) / rect.width) * 2 - 1;
      const y = -(((cy - rect.top) / rect.height) * 2 - 1);
      let best = -1;
      let bestD = Infinity;
      const p = new Vector3();
      for (let i = 0; i < N; i++) {
        const u0 = i - uOffset.value;
        if (Math.abs(u0) > 4) continue;
        const poly: [number, number][] = [];
        const M = 6;
        for (let k = 0; k <= M; k++) {
          pointOn(u0 - PIC_W + (2 * PIC_W * k) / M, PIC_H, p).project(camera);
          poly.push([p.x, p.y]);
        }
        for (let k = M; k >= 0; k--) {
          pointOn(u0 - PIC_W + (2 * PIC_W * k) / M, -PIC_H, p).project(camera);
          poly.push([p.x, p.y]);
        }
        let inside = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const [xa, ya] = poly[a];
          const [xb, yb] = poly[b];
          if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
        }
        if (!inside) continue;
        const d = curveP(u0, p).distanceTo(camera.position);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    framePx() {
      const a = pointOn(-PIC_W, 0, new Vector3()).project(camera);
      const b = pointOn(PIC_W, 0, new Vector3()).project(camera);
      return (Math.abs(b.x - a.x) / 2) * stage.clientWidth;
    },
    resize,
    stats() {
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, cpuMs: renders > 5 ? +(cpuSum / (renders - 5)).toFixed(3) : 0, renders };
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
    else if (playing >= 0 && visible) void video.play().catch(() => {});
  });
  return api;
}
