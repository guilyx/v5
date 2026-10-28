/**
 * The SIRB swarm's radio network, decentralised: a drone only hears the drones in radio range,
 * and jamming or a failure cuts links. From the links come the groups (connected components) and
 * the algebraic connectivity λ₂ (the second-smallest eigenvalue of the graph Laplacian: 0 when
 * the swarm has split, larger the better knit it is).
 *
 * What the drones do with it is the self-healing: a drone cut off from the main group flies back
 * toward the nearest drone it can still see in it, and when the radio range drops, the formation
 * tightens so that neighbours stay in reach.
 */

/** nominal and degraded radio range, in cells */
export const RANGE = 1.35;
export const SHORT = 0.85;

export class SwarmNet {
  readonly n: number;
  /** 0 once a drone has failed and fallen */
  alive: Uint8Array;
  /** a drone whose radio is out for a moment */
  radioDown: Uint8Array;
  /** connected component of each drone, and which one is the main group */
  comp: Int16Array;
  main = 0;
  groups = 1;
  /** cut off from the main group */
  lost: Uint8Array;
  links = 0;
  jammedLinks = 0;
  /** link endpoints and quality (1 near, 0 at the edge of range); jammed pairs have q < 0 */
  pairA: Int16Array;
  pairB: Int16Array;
  pairQ: Float32Array;
  pairs = 0;
  range = RANGE;
  target = RANGE;
  jam: { x: number; y: number; z: number; r: number; until: number } | null = null;
  lambda2 = 0;
  private lambdaAt = -1;
  private fiedler: Float64Array;
  private parent: Int16Array;
  private adj: number[][];

  constructor(n: number) {
    this.n = n;
    this.alive = new Uint8Array(n).fill(1);
    this.radioDown = new Uint8Array(n);
    this.comp = new Int16Array(n);
    this.lost = new Uint8Array(n);
    const max = (n * (n - 1)) / 2;
    this.pairA = new Int16Array(max);
    this.pairB = new Int16Array(max);
    this.pairQ = new Float32Array(max);
    this.fiedler = new Float64Array(n).map((_, i) => Math.sin(i * 1.7 + 0.3));
    this.parent = new Int16Array(n);
    this.adj = Array.from({ length: n }, () => []);
  }

  get count() {
    let c = 0;
    for (let i = 0; i < this.n; i++) c += this.alive[i];
    return c;
  }
  private up(i: number) {
    return this.alive[i] && !this.radioDown[i];
  }
  private find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]];
    return i;
  }

  /** how much the formation should shrink for the current range: 1 at full range */
  get spread() {
    return 0.6 + (0.4 * (this.range - SHORT)) / (RANGE - SHORT);
  }

  update(pos: Float32Array, now: number, dt: number) {
    this.range += (this.target - this.range) * Math.min(1, dt * 1.5);
    if (this.jam && now > this.jam.until) this.jam = null;
    const jam = this.jam;
    const inJam = (i: number) => !!jam && (pos[i * 3] - jam.x) ** 2 + (pos[i * 3 + 1] - jam.y) ** 2 + (pos[i * 3 + 2] - jam.z) ** 2 < jam.r * jam.r;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.adj[i].length = 0;
    }
    this.pairs = 0;
    this.links = 0;
    this.jammedLinks = 0;
    const r2 = this.range * this.range;
    for (let i = 0; i < n; i++) {
      if (!this.up(i)) continue;
      for (let j = i + 1; j < n; j++) {
        if (!this.up(j)) continue;
        const d2 = (pos[i * 3] - pos[j * 3]) ** 2 + (pos[i * 3 + 1] - pos[j * 3 + 1]) ** 2 + (pos[i * 3 + 2] - pos[j * 3 + 2]) ** 2;
        if (d2 > r2) continue;
        const k = this.pairs++;
        this.pairA[k] = i;
        this.pairB[k] = j;
        if (inJam(i) || inJam(j)) {
          this.pairQ[k] = -1;
          this.jammedLinks++;
          continue;
        }
        this.pairQ[k] = 1 - Math.sqrt(d2) / this.range;
        this.links++;
        this.adj[i].push(j);
        this.adj[j].push(i);
        const a = this.find(i);
        const b = this.find(j);
        if (a !== b) this.parent[a] = b;
      }
    }
    // groups, and the main one: the biggest
    const size = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      if (!this.up(i)) continue;
      const c = this.find(i);
      this.comp[i] = c;
      size.set(c, (size.get(c) ?? 0) + 1);
    }
    let best = -1;
    for (const [c, s] of size) if (best < 0 || s > (size.get(best) ?? 0)) best = c;
    this.main = best;
    this.groups = size.size;
    for (let i = 0; i < n; i++) this.lost[i] = this.up(i) && this.comp[i] !== best ? 1 : 0;
    if (now - this.lambdaAt > 0.25) {
      this.lambdaAt = now;
      this.lambda2 = this.groups > 1 ? 0 : this.connectivity();
    }
  }

  /** λ₂ by power iteration on cI − L, kept orthogonal to the all-ones vector */
  private connectivity() {
    const nodes: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.up(i)) nodes.push(i);
    if (nodes.length < 2) return 0;
    let maxDeg = 0;
    for (const i of nodes) maxDeg = Math.max(maxDeg, this.adj[i].length);
    const c = 2 * maxDeg + 1;
    const v = this.fiedler;
    const w = new Float64Array(this.n);
    const orth = (x: Float64Array) => {
      let m = 0;
      for (const i of nodes) m += x[i];
      m /= nodes.length;
      let norm = 0;
      for (const i of nodes) {
        x[i] -= m;
        norm += x[i] * x[i];
      }
      norm = Math.sqrt(norm) || 1;
      for (const i of nodes) x[i] /= norm;
    };
    orth(v);
    let mu = 0;
    for (let it = 0; it < 80; it++) {
      for (const i of nodes) {
        let lv = this.adj[i].length * v[i];
        for (const j of this.adj[i]) lv -= v[j];
        w[i] = c * v[i] - lv;
      }
      mu = 0;
      for (const i of nodes) mu += v[i] * w[i];
      for (const i of nodes) v[i] = w[i];
      orth(v);
    }
    return Math.max(0, c - mu);
  }

  /** the drone in the main group with the most links: losing it hurts the most */
  hub() {
    let best = -1;
    for (let i = 0; i < this.n; i++) if (this.up(i) && !this.lost[i] && (best < 0 || this.adj[i].length > this.adj[best].length)) best = i;
    return best;
  }
}
