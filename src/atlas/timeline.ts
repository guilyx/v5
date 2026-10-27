/**
 * Scroll position → where the camera is, which arcs are drawn and which pins are lit.
 *
 * Each chapter card is `position: sticky`. While a card is docked the camera holds on its
 * place; between two docked cards the camera flies and the arc for that leg draws. All of it
 * is a pure function of scrollY, so the globe answers the wheel straight away.
 */
import { CHAPTER_STOPS, FINALE_VIEW, HERO_PINS, HERO_VIEW, LEGS, type PlaceKey, type Stop } from "./places";
import { angle, clamp, lerp, slerp, smoother, type V3 } from "./geo";

const FINALE_PINS: PlaceKey[] = ["abudhabi"];

export type Drift = "hero" | "finale" | null;

interface Key {
  y: number;
  c: V3;
  d: number;
  drift: Drift;
  stop: Stop | null;
  chapter: number;
}

export interface Dock {
  id: string;
  a: number; // card docks
  b: number; // card leaves
}

export interface TimelineState {
  c: V3;
  d: number;
  drift: Drift;
  /** 0 → 1 per leg */
  legs: Float32Array;
  /** the leg most recently drawn (for its travelling dash), or -1 */
  activeLeg: number;
  chapter: number;
  pins: PlaceKey[];
  open: PlaceKey | null;
  /** 0 → 1: travel pins fade in once the travel chapter is near */
  travel: number;
  /** true while the camera sits still on a stop */
  dwelling: boolean;
  stopKey: string | null;
}

export class Timeline {
  keys: Key[] = [];
  docks: Dock[] = [];
  legRange: [number, number][] = LEGS.map(() => [Infinity, Infinity]);
  stopY = new Map<string, number>();
  travelRange: [number, number] = [Infinity, Infinity];
  /** document ranges where solid sheets hide the globe completely */
  covered: [number, number] = [Infinity, Infinity];
  reduced = false;
  private state: TimelineState = {
    c: HERO_VIEW.c,
    d: HERO_VIEW.d,
    drift: "hero",
    legs: new Float32Array(LEGS.length),
    activeLeg: -1,
    chapter: -1,
    pins: [],
    open: null,
    travel: 0,
    dwelling: true,
    stopKey: null,
  };

  measure() {
    const vh = window.innerHeight;
    const sy = window.scrollY;
    const keys: Key[] = [{ y: 0, c: HERO_VIEW.c, d: HERO_VIEW.d, drift: "hero", stop: null, chapter: -1 }];
    this.docks = [];
    this.legRange = LEGS.map(() => [Infinity, Infinity]);
    this.stopY.clear();

    const articles = Array.from(document.querySelectorAll<HTMLElement>(".chapter[data-chapter]"));
    articles.forEach((art, ci) => {
      const id = art.dataset.chapter!;
      const stops = CHAPTER_STOPS[id];
      const card = art.querySelector<HTMLElement>(".card");
      if (!stops || !card) return;
      const r = art.getBoundingClientRect();
      const top = r.top + sy;
      const bottom = r.bottom + sy;
      const cardH = card.offsetHeight;
      const cs = getComputedStyle(card);
      const D = cs.position === "sticky" && cs.top !== "auto" ? parseFloat(cs.top) : vh - (parseFloat(cs.bottom) || 0) - cardH;
      const a = Math.max(1, top - D);
      const b = Math.max(a + 1, bottom - D - cardH);
      this.docks.push({ id, a, b });
      const leave = Math.min(0.22 * vh, (b - a) * 0.3);
      const end = Math.max(a + 1, b - leave);
      if (id === "travels") this.travelRange = [a, b];

      const n = stops.length;
      const g = n > 1 ? (end - a) / (n - 1 + 0.6) : 0;
      stops.forEach((s, i) => {
        const arrive = n > 1 ? a + i * g : a;
        const depart = n > 1 ? (i === n - 1 ? end : arrive + 0.4 * g) : end;
        if (s.leg !== undefined) this.legRange[s.leg] = [keys[keys.length - 1].y, arrive];
        keys.push({ y: arrive, c: s.c, d: s.d, drift: null, stop: s, chapter: ci });
        keys.push({ y: depart, c: s.c, d: s.d, drift: null, stop: s, chapter: ci });
        if (s.key && !this.stopY.has(s.key)) this.stopY.set(s.key, arrive + Math.min(40, (depart - arrive) * 0.25));
      });
      if (!this.stopY.has(id)) this.stopY.set(id, a + Math.min(40, (end - a) * 0.1));
    });

    // the sheets after the journey hide the globe; fly to the finale view behind them
    const sheetTop = document.querySelector<HTMLElement>("#work");
    const finale = document.querySelector<HTMLElement>("#contact");
    if (sheetTop && finale) {
      const st = sheetTop.getBoundingClientRect().top + sy;
      const ft = finale.getBoundingClientRect().top + sy;
      this.covered = [st, ft - vh];
      const last = keys[keys.length - 1];
      keys.push({ ...last, y: Math.max(last.y + 1, st) });
      keys.push({ y: Math.max(st + 2, ft - vh), c: FINALE_VIEW.c, d: FINALE_VIEW.d, drift: "finale", stop: null, chapter: articles.length });
    }
    this.keys = keys;
  }

  /** Scroll position to land on to see a stop or chapter. */
  yFor(key: string): number | undefined {
    return this.stopY.get(key);
  }

  isCovered(y: number) {
    return y >= this.covered[0] && y <= this.covered[1];
  }

  at(y: number): TimelineState {
    const s = this.state;
    const keys = this.keys;
    if (!keys.length) return s;
    let k = 0;
    while (k < keys.length - 2 && y >= keys[k + 1].y) k++;
    const k0 = keys[k];
    const k1 = keys[Math.min(k + 1, keys.length - 1)];
    const span = k1.y - k0.y;
    let t = span > 0 ? clamp((y - k0.y) / span, 0, 1) : 1;
    if (y < k0.y) t = 0;
    const e = this.reduced ? (t < 0.5 ? 0 : 1) : smoother(t);

    const w = angle(k0.c, k1.c);
    s.c = w < 1e-5 ? k0.c : slerp(k0.c, k1.c, e);
    // long flights climb: the farther apart, the higher the middle of the flight
    const cruise = Math.min(4.4, 1.4 + 2.2 * w);
    const base = lerp(k0.d, k1.d, e);
    s.d = base + Math.max(0, cruise - lerp(k0.d, k1.d, 0.5)) * Math.sin(Math.PI * e);
    s.drift = e < 0.5 ? k0.drift : k1.drift;
    s.dwelling = w < 1e-5 && k0.d === k1.d;

    const near = e < 0.5 ? k0 : k1;
    s.chapter = near.chapter;
    s.pins = near.stop ? near.stop.pins : near.drift === "hero" ? HERO_PINS : near.drift === "finale" ? FINALE_PINS : [];
    s.open = s.dwelling && near.stop?.open ? near.stop.open : null;
    s.stopKey = near.stop?.key ?? null;

    s.activeLeg = -1;
    for (let i = 0; i < LEGS.length; i++) {
      const [ya, yb] = this.legRange[i];
      let p = yb > ya ? clamp((y - ya) / (yb - ya), 0, 1) : y >= yb ? 1 : 0;
      p = this.reduced ? (p < 0.5 ? 0 : 1) : smoother(p);
      s.legs[i] = p;
      if (p > 0 && y < yb + window.innerHeight * 1.2) s.activeLeg = i;
    }
    // photo pins belong to the travel chapter, and come back for the finale
    const vh = window.innerHeight;
    const [ta, tb] = this.travelRange;
    const into = clamp((y - (ta - 0.9 * vh)) / (0.5 * vh), 0, 1);
    const out = clamp((y - (tb + 0.1 * vh)) / (0.4 * vh), 0, 1);
    s.travel = s.drift === "finale" ? 1 : into * (1 - out);
    return s;
  }
}
