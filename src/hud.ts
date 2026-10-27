import type { Dive, Stop } from "./dive";

/** the ruler's range: a little beyond 10^7 m at the top and 10^-4 m at the bottom */
const TOP = 7.6, BOTTOM = -4.3;
const pct = (s: number) => ((TOP - s) / (TOP - BOTTOM)) * 100;
const sup = (n: number) => `10<sup>${n < 0 ? "−" + -n : n}</sup>`;

function lengthLabel(m: number) {
  if (m >= 1000) return `${(m / 1000).toLocaleString("en-US")} km`;
  if (m >= 1) return `${m} m`;
  if (m >= 0.01) return `${Math.round(m * 100)} cm`;
  if (m >= 0.001) return `${Math.round(m * 1000)} mm`;
  return `${Math.round(m * 1e6)} µm`;
}

/**
 * The instruments: a vertical logarithmic ruler (click a power or a chapter to
 * go there), a needle carrying the year, and a map-style scale bar.
 */
export class Hud {
  private needle: HTMLElement;
  private yr: HTMLElement;
  private dots: { st: Stop; el: HTMLButtonElement }[] = [];
  private bar: HTMLElement;
  private len: HTMLElement;
  private exp: HTMLElement;
  private lastYear = -1;
  private lastLen = "";
  private lastExp = "";
  private on: Stop | null = null;
  private nest: HTMLElement;
  private nestLabel: HTMLElement;
  private lastNext = NaN;

  constructor(
    private root: HTMLElement,
    private dive: Dive,
    private go: (y: number) => void,
  ) {
    const ruler = root.querySelector<HTMLElement>("#ruler")!;
    const track = document.createElement("li");
    track.className = "ruler-track";
    track.setAttribute("role", "presentation");
    // ticks: one per power, minor ones at 2..9
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "none");
    for (let d = Math.ceil(BOTTOM) - 1; d <= Math.floor(TOP); d++)
      for (let k = 1; k <= 9; k++) {
        const s = d + Math.log10(k);
        if (s < BOTTOM || s > TOP) continue;
        const l = document.createElementNS(ns, "line");
        const major = k === 1;
        l.setAttribute("x1", major ? "36%" : "42%");
        l.setAttribute("x2", "52%");
        l.setAttribute("y1", `${pct(s)}%`);
        l.setAttribute("y2", `${pct(s)}%`);
        l.setAttribute("stroke", "#1c1b19");
        l.setAttribute("stroke-width", major ? "1.6" : "1");
        l.setAttribute("stroke-opacity", major ? "1" : "0.45");
        svg.appendChild(l);
      }
    const spine = document.createElementNS(ns, "line");
    spine.setAttribute("x1", "52%");
    spine.setAttribute("x2", "52%");
    spine.setAttribute("y1", "0%");
    spine.setAttribute("y2", "100%");
    spine.setAttribute("stroke", "#1c1b19");
    spine.setAttribute("stroke-width", "1.2");
    svg.appendChild(spine);
    track.appendChild(svg);
    for (let d = 7; d >= -4; d--) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `dec${d % 2 ? " odd" : ""}`;
      b.style.top = `${pct(d)}%`;
      b.innerHTML = sup(d);
      b.setAttribute("aria-label", `Zoom to 10 to the ${d} metres`);
      b.addEventListener("click", () => this.go(this.dive.yAt(d)));
      track.appendChild(b);
    }
    for (const st of dive.stops) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stopdot";
      b.style.top = `${pct(st.s)}%`;
      b.style.setProperty("--c", st.accent);
      const label = `${st.year} · ${st.title}`;
      b.setAttribute("aria-label", `Go to ${label}`);
      const tip = document.createElement("span");
      tip.className = "tip";
      tip.textContent = label;
      b.appendChild(tip);
      b.addEventListener("click", () => this.go(st.dock));
      track.appendChild(b);
      this.dots.push({ st, el: b });
    }
    this.needle = document.createElement("div");
    this.needle.className = "needle";
    this.yr = document.createElement("span");
    this.yr.className = "yr";
    this.needle.appendChild(this.yr);
    track.appendChild(this.needle);
    ruler.appendChild(track);

    this.nest = root.querySelector<HTMLElement>("#nest")!;
    this.nestLabel = this.nest.querySelector("span")!;
    this.bar = root.querySelector<HTMLElement>(".scalebar .bar")!;
    this.len = root.querySelector<HTMLElement>(".sb-len")!;
    this.exp = root.querySelector<HTMLElement>(".sb-exp")!;
  }

  /** the next power of ten, drawn as corner marks around the zoom point; it grows to fill the frame */
  nested(s: number, fx: number, fy: number, ref: number) {
    // it appears a little before each power is reached, so it is showing at every chapter
    const next = Math.ceil(s - 0.35) - 1;
    const size = ref * Math.pow(10, next - s);
    const k = size / ref;
    let o = Math.min(1, Math.max(0, (k - 0.045) / 0.035)) * (1 - Math.min(1, Math.max(0, (k - 0.5) / 0.4)));
    if (s > 6.9 || next < -4) o = 0;
    o = Math.max(0, Math.round(o * 100) / 100);
    this.nest.style.opacity = String(o);
    if (o > 0) {
      this.nest.style.width = this.nest.style.height = `${size.toFixed(1)}px`;
      this.nest.style.transform = `translate(${(fx - size / 2).toFixed(1)}px, ${(fy - size / 2).toFixed(1)}px)`;
      if (next !== this.lastNext) {
        this.nestLabel.innerHTML = `${sup(next)}&thinsp;m`;
        this.lastNext = next;
      }
    }
  }

  update(s: number, y: number, ref: number, mobile: boolean) {
    const track = this.needle.parentElement!;
    const h = track.clientHeight;
    this.needle.style.transform = `translateY(${((pct(s) / 100) * h).toFixed(1)}px)`;
    const year = this.dive.yearAt(s);
    if (year !== this.lastYear) {
      this.yr.textContent = String(year);
      this.lastYear = year;
    }
    // the chapter you're in lights up, and lends the instruments its colour
    const cur = this.dive.rewinding(y) ? null : this.dive.current(y);
    if (cur !== this.on) {
      for (const d of this.dots) d.el.classList.toggle("on", d.st === cur);
      this.root.style.setProperty("--accent", cur ? cur.accent : "#1c1b19");
      this.on = cur;
    }
    // scale bar: the largest 1-2-5 length that fits
    const maxPx = mobile ? 72 : 130;
    const field = Math.pow(10, s); // metres across `ref` px
    const maxM = (field * maxPx) / ref;
    const p = Math.pow(10, Math.floor(Math.log10(maxM)));
    const nice = [5, 2, 1].map((k) => k * p).find((v) => v <= maxM) ?? p;
    const px = (nice / field) * ref;
    this.bar.style.width = `${px.toFixed(1)}px`;
    const label = lengthLabel(Number(nice.toPrecision(1)));
    if (label !== this.lastLen) {
      this.len.textContent = label;
      this.lastLen = label;
    }
    const e = s.toFixed(1).replace("-", "−");
    if (e !== this.lastExp) {
      this.exp.innerHTML = `10<sup>${e}</sup> m`;
      this.lastExp = e;
    }
  }
}
