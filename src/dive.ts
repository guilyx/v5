/**
 * Scroll is the zoom exponent. Each chapter (a .stop in the page) owns a stretch
 * of scroll in which its card stays docked; the exponent s eases toward the
 * chapter's power of ten there and moves on between chapters. After the last
 * one, a short stretch zooms all the way back out.
 */
export interface Stop {
  id: string;
  el: HTMLElement;
  card: HTMLElement | null;
  s: number;
  year: number;
  accent: string;
  level: string;
  title: string;
  /** scroll position where this chapter is centred */
  dock: number;
}

interface Knot {
  y: number;
  s: number;
  ease: "dive" | "hold" | "rewind";
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** mostly linear, slowing down near each chapter so the picture settles while you read */
const diveEase = (t: number) => t + (smooth(t) - t) * 0.72;
const rewindEase = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Dive {
  readonly stops: Stop[];
  private knots: Knot[] = [];
  private surface: HTMLElement;
  /** scroll position where the readable page fully covers the stage */
  surfaceTop = Infinity;

  constructor(root: HTMLElement) {
    this.stops = Array.from(root.querySelectorAll<HTMLElement>("article.stop")).map((el) => ({
      id: el.id,
      el,
      card: el.querySelector<HTMLElement>(".card"),
      s: Number(el.dataset.s),
      year: Number(el.dataset.year),
      accent: getComputedStyle(el).getPropertyValue("--accent").trim() || "#1c1b19",
      level: el.dataset.level ?? "",
      title: el.querySelector("h1, h2")?.textContent?.trim() ?? "",
      dock: 0,
    }));
    this.surface = document.querySelector<HTMLElement>(".surface")!;
  }

  measure(mobile: boolean, top: number) {
    const vh = innerHeight;
    const y0 = scrollY;
    const B = 10;
    for (const st of this.stops) {
      const r = st.el.getBoundingClientRect();
      const bt = r.top + y0, bb = r.bottom + y0;
      const ch = st.card?.offsetHeight ?? 0;
      if (st === this.stops[0]) {
        st.dock = 0;
        continue;
      }
      // the stretch of scroll during which the sticky card is docked
      const [a, b] = mobile ? [bt + ch + B - vh, bb + B - vh] : [bt - top, bb - ch - top];
      st.dock = (a + b) / 2;
    }
    const last = this.stops[this.stops.length - 1];
    const lr = last.el.getBoundingClientRect();
    const lastEnd = lr.bottom + y0 - (mobile ? vh - B : (last.card?.offsetHeight ?? 0) + top);
    this.surfaceTop = this.surface.getBoundingClientRect().top + y0;
    const rewindEnd = Math.max(lastEnd + 200, this.surfaceTop - vh * 0.42);
    this.knots = this.stops.map((st) => ({ y: st.dock, s: st.s, ease: "dive" as const }));
    this.knots.push({ y: Math.max(last.dock + 1, lastEnd), s: last.s, ease: "hold" });
    this.knots.push({ y: rewindEnd, s: this.stops[0].s, ease: "rewind" });
  }

  /** the zoom exponent at scroll position y */
  sAt(y: number): number {
    const k = this.knots;
    if (!k.length || y <= k[0].y) return k[0]?.s ?? 7;
    for (let j = 0; j < k.length - 1; j++) {
      const a = k[j], b = k[j + 1];
      if (y < b.y) {
        const t = (y - a.y) / (b.y - a.y);
        const e = b.ease === "rewind" ? rewindEase(t) : b.ease === "hold" ? 0 : diveEase(t);
        return a.s + (b.s - a.s) * e;
      }
    }
    return k[k.length - 1].s;
  }

  /** true once the zoom is heading back out */
  rewinding(y: number) {
    const k = this.knots;
    return k.length > 1 && y > k[k.length - 2].y;
  }

  /** the scroll position (on the way down) that shows exponent s */
  yAt(s: number): number {
    const st = this.stops;
    if (s >= st[0].s) return 0;
    const n = st.length;
    if (s <= st[n - 1].s) return st[n - 1].dock;
    let j = 0;
    while (j < n - 2 && s < st[j + 1].s) j++;
    let lo = st[j].dock, hi = st[j + 1].dock;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.sAt(mid) > s) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** the year a given exponent stands for: deeper is earlier */
  yearAt(s: number): number {
    const st = this.stops;
    if (s >= st[0].s) return st[0].year;
    for (let j = 0; j < st.length - 1; j++) {
      const a = st[j], b = st[j + 1];
      if (s >= b.s) return Math.round(a.year + ((b.year - a.year) * (a.s - s)) / (a.s - b.s));
    }
    return st[st.length - 1].year;
  }

  /** the chapter nearest to scroll position y */
  current(y: number): Stop {
    let best = this.stops[0], d = Infinity;
    for (const st of this.stops) {
      const e = Math.abs(st.dock - y);
      if (e < d) {
        d = e;
        best = st;
      }
    }
    return best;
  }
}
