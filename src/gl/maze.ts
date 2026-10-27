import { BufferAttribute, BufferGeometry, CircleGeometry, DataTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, RGBAFormat, RingGeometry, ShaderMaterial } from "three";
import { C, col, FRAG_OUT, Level, sstep } from "./kit";
import type { Frame } from "./kit";
import { CELL_UM, maze, N, plan } from "./mazegen";
import type { MazeData } from "./mazegen";
import type { V3 } from "./world";
import { O_MAZE } from "./world";

/** the level's unit is 10 µm, so a cell is 0.6 units */
const CELL = CELL_UM / 10;
const HALF = (N * CELL) / 2;

const FRAG = /* glsl */ `
uniform sampler2D uWalls;
uniform vec3 uGround, uMetal1, uMetal2, uVia, uRow;
uniform float uOpacity;
varying vec2 vP; // level units (10 µm), centred
float wall(vec2 cell, int which) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x > ${N - 1}.5 || cell.y > ${N - 1}.5) return 1.0;
  vec4 t = texture2D(uWalls, (cell + 0.5) / ${N}.0);
  return which == 0 ? t.r : t.g;
}
void main() {
  vec2 q = vP / ${CELL.toFixed(2)} + ${N / 2}.0;
  vec2 cell = floor(q), f = fract(q);
  float fw = max(fwidth(q.x), 1e-5);
  float hw = 0.11; // half the metal width, in cells: it scales with the chip
  float E = wall(cell, 0), Nn = wall(cell, 1);
  float W = cell.x < 0.5 ? 1.0 : wall(cell - vec2(1.0, 0.0), 0);
  float S = cell.y < 0.5 ? 1.0 : wall(cell - vec2(0.0, 1.0), 1);
  // standard-cell rows in the background
  vec3 c = mix(uGround, uRow, step(0.5, fract(q.y * 0.5 + 0.25)) * 0.5);
  c = mix(c, uRow, (1.0 - smoothstep(0.0, fw * 1.5, abs(fract(q.x * 2.0) - 0.5) - 0.47)) * 0.25);
  // vertical walls on one metal layer, horizontal on the other
  float v = max(E * (1.0 - smoothstep(hw, hw + fw, 1.0 - f.x)), W * (1.0 - smoothstep(hw, hw + fw, f.x)));
  float h = max(Nn * (1.0 - smoothstep(hw, hw + fw, 1.0 - f.y)), S * (1.0 - smoothstep(hw, hw + fw, f.y)));
  c = mix(c, uMetal2, h);
  c = mix(c, uMetal1, v);
  // vias where the layers meet at a corner
  vec2 cf = min(f, 1.0 - f);
  float corner = (1.0 - smoothstep(hw * 0.75, hw * 0.75 + fw, max(cf.x, cf.y))) * step(0.5, v + h);
  c = mix(c, uVia, corner);
  // fade into the die's coarse drawing at the edge of the maze
  vec2 e = ${HALF.toFixed(2)} - abs(vP);
  float edge = smoothstep(0.0, ${(CELL * 3).toFixed(2)}, min(e.x, e.y));
  gl_FragColor = vec4(c, uOpacity * edge);
  ${FRAG_OUT}
}`;

/**
 * The bottom of the dive: the circuitry reads as a maze. Tap it and an A*
 * planner routes a little robot through it, from wherever it stands.
 */
export class Maze extends Level {
  private m: MazeData;
  private mat: ShaderMaterial;
  private path: Mesh<BufferGeometry, ShaderMaterial>;
  private bot: Mesh;
  private cells: number[] = [];
  private prog = 0;
  private speed = 30;
  private at = (N >> 1) * N + (N >> 1);
  private demoed = false;

  constructor(private reduced: boolean) {
    super(-5, O_MAZE, -4.6, -2.75);
    this.m = maze();
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = this.m.east[i] ? 255 : 0;
      data[i * 4 + 1] = this.m.north[i] ? 255 : 0;
      data[i * 4 + 3] = 255;
    }
    const walls = new DataTexture(data, N, N, RGBAFormat);
    walls.minFilter = walls.magFilter = NearestFilter;
    walls.needsUpdate = true;
    this.mat = new ShaderMaterial({
      uniforms: {
        uWalls: { value: walls },
        uGround: { value: col("#463f5c") },
        uRow: { value: col("#51496a") },
        uMetal1: { value: col(C.copper) },
        uMetal2: { value: col("#e2c08a") },
        uVia: { value: col("#f4e3bd") },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    const plane = new Mesh(new PlaneGeometry(2 * HALF, 2 * HALF), this.mat);
    plane.position.z = 0.002;
    this.group.add(plane);

    this.path = new Mesh(
      new BufferGeometry(),
      new ShaderMaterial({
        uniforms: { uProg: { value: 0 }, uPaper: { value: col(C.paper) }, uHot: { value: col(C.vermilion) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `attribute float along; varying float vA; void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `uniform float uProg, uOpacity; uniform vec3 uPaper, uHot; varying float vA;
          void main(){
            if (vA > uProg) discard;
            float trail = smoothstep(uProg - 6.0, uProg, vA);
            gl_FragColor = vec4(mix(uPaper, uHot, trail * 0.85), uOpacity * (0.75 + 0.25 * trail));
            ${FRAG_OUT}
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.path.position.z = 0.004;
    this.path.renderOrder = 1;
    this.path.frustumCulled = false;
    this.bot = new Mesh(new CircleGeometry(CELL * 0.3, 32), new MeshBasicMaterial({ color: col(C.vermilion), transparent: true }));
    const ring = new Mesh(new RingGeometry(CELL * 0.3, CELL * 0.4, 32), new MeshBasicMaterial({ color: col(C.paper), transparent: true }));
    this.bot.add(ring);
    this.bot.renderOrder = ring.renderOrder = 2;
    this.bot.position.set(...this.centre(this.at), 0.006);
    this.group.add(this.path, this.bot);
  }

  private centre(c: number): [number, number] {
    return [((c % N) + 0.5) * CELL - HALF, (((c / N) | 0) + 0.5) * CELL - HALF];
  }

  /** route the robot to cell `goal` from where it is now */
  private go(goal: number) {
    const from = this.cells.length ? this.cells[Math.min(this.cells.length - 1, Math.floor(this.prog))] : this.at;
    const cells = plan(this.m, from, goal);
    if (cells.length < 2) return;
    this.cells = cells;
    this.prog = this.reduced ? cells.length - 1 : 0;
    this.speed = Math.max(24, cells.length / 2.6);
    // a ribbon through the cell centres, with the distance along it per vertex
    const w = CELL * 0.11;
    const pos: number[] = [], along: number[] = [], idx: number[] = [];
    for (let i = 0; i < cells.length - 1; i++) {
      const [ax, ay] = this.centre(cells[i]), [bx, by] = this.centre(cells[i + 1]);
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
      const nx = (-dy / l) * w, ny = (dx / l) * w, ex = (dx / l) * w, ey = (dy / l) * w;
      const b = pos.length / 3;
      pos.push(ax - nx - ex, ay - ny - ey, 0, ax + nx - ex, ay + ny - ey, 0, bx + nx + ex, by + ny + ey, 0, bx - nx + ex, by - ny + ey, 0);
      along.push(i, i, i + 1, i + 1);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("along", new BufferAttribute(new Float32Array(along), 1));
    g.setIndex(idx);
    this.path.geometry.dispose();
    this.path.geometry = g;
  }

  click(p: V3, fr: Frame) {
    if (fr.s > -3.3) return false;
    const x = Math.floor(((p[0] - this.origin[0]) * 1e5 + HALF) / CELL);
    const y = Math.floor(((p[1] - this.origin[1]) * 1e5 + HALF) / CELL);
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    this.go(y * N + x);
    return true;
  }

  update(fr: Frame) {
    this.mat.uniforms.uOpacity.value = sstep(-2.8, -3.25, fr.s);
    const show = sstep(-3.25, -3.55, fr.s);
    // the first time we reach the bottom, the robot shows what it does
    if (!this.demoed && fr.s < -3.7) {
      this.demoed = true;
      this.go(((N >> 1) + 6) * N + (N >> 1) + 9);
    }
    if (this.cells.length) {
      this.prog = Math.min(this.cells.length - 1, this.prog + fr.dt * this.speed);
      this.path.material.uniforms.uProg.value = this.prog;
      const i = Math.floor(this.prog), t = this.prog - i;
      const a = this.centre(this.cells[i]), b = this.centre(this.cells[Math.min(i + 1, this.cells.length - 1)]);
      this.bot.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.006);
    }
    this.path.material.uniforms.uOpacity.value = show;
    (this.bot.material as MeshBasicMaterial).opacity = show;
    ((this.bot.children[0] as Mesh).material as MeshBasicMaterial).opacity = show;
    this.bot.visible = this.path.visible = show > 0.01;
  }

  animating() {
    return this.cells.length > 0 && this.prog < this.cells.length - 1;
  }
}
