import "./styles.css";
import { Dive } from "./dive";
import { Hud } from "./hud";
import { wireNav, wirePhotos, wireVideos } from "./page";
import type { Engine, View } from "./gl/engine";

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mqMobile = matchMedia("(max-width: 820px)");

wirePhotos();
wireNav();
wireVideos(reduced);

/** The zoom is a layer on a page that already reads fine; it only starts if WebGL 2 really works. */
function context(canvas: HTMLCanvasElement, antialias: boolean): WebGL2RenderingContext | null {
  try {
    return canvas.getContext("webgl2", { antialias, alpha: false, stencil: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
}

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const dprFor = () => Math.min(devicePixelRatio || 1, mqMobile.matches ? 1.5 : 2);
const gl = root.classList.contains("gl") ? context(canvas, dprFor() < 1.5) : null;
if (!gl) root.classList.remove("gl");
else start(gl);

function start(glc: WebGL2RenderingContext) {
  const dive = new Dive(document.getElementById("dive")!);
  const hud = new Hud(document.querySelector<HTMLElement>(".hud")!, dive, go);
  let engine: Engine | null = null;
  let mobileCardH = 0;
  let view: View = computeView();
  let sCur = NaN;
  let raf = 0;
  let lastT = 0;
  let lastY = -1;
  let covered = false;

  function go(y: number) {
    scrollTo({ top: y, behavior: reduced ? "instant" : "smooth" });
  }

  /** the free area (right of the cards, left of the ruler; on phones, above the card) */
  function computeView(): View {
    const w = innerWidth, h = innerHeight, mobile = mqMobile.matches, dpr = dprFor();
    if (!mobile) {
      const cardW = parseFloat(getComputedStyle(root).getPropertyValue("--card-w")) || 420;
      const left = 32 + cardW + 24, right = w - 124, top = 70, bottom = h - 74;
      return { w, h, fx: (left + right) / 2, fy: (top + bottom) / 2, ref: Math.max(180, Math.min(right - left, bottom - top)), dpr, mobile };
    }
    const top = 104, bottom = Math.max(top + 160, h - (mobileCardH || h * 0.45) - 24), left = 10, right = w - 62;
    return { w, h, fx: (left + right) / 2, fy: (top + bottom) / 2, ref: Math.max(150, Math.min(right - left, bottom - top)), dpr, mobile };
  }

  function publishView() {
    root.style.setProperty("--fx", `${view.fx}px`);
    root.style.setProperty("--fy", `${view.fy}px`);
    root.style.setProperty("--fref", `${view.ref}px`);
    // on phones the ruler stops where the docked card begins
    if (view.mobile) root.style.setProperty("--ruler-h", `${Math.max(160, 2 * view.fy - 104 - 72)}px`);
    engine?.setView(view);
  }

  function measure() {
    const top = parseFloat(getComputedStyle(root).getPropertyValue("--top")) || 84;
    dive.measure(mqMobile.matches, top);
    view = computeView();
    publishView();
    kick();
  }

  /** cards leaving their dock fade out, so a moving card never sits on the picture */
  const shown = new Map<HTMLElement, number>();
  function fadeCards() {
    const mobile = mqMobile.matches, vh = innerHeight;
    const T = parseFloat(getComputedStyle(root).getPropertyValue("--top")) || 84;
    for (const st of dive.stops) {
      const c = st.card;
      if (!c) continue;
      const r = c.getBoundingClientRect();
      let o = 1;
      if (r.bottom < -10 || r.top > vh + 10) o = 0;
      else if (!mobile) {
        const dock = st === dive.stops[0] ? Math.max(T, vh * 0.5 - 290) : T;
        if (r.top < dock - 1) o = Math.max(0, 1 - (dock - r.top) / 120);
        // the next card fades in late on its way up, so it doesn't loiter at the bottom
        else if (r.top > dock + 1) o = Math.max(0, 1 - (r.top - dock) / (vh * 0.32));
      } else {
        const dock = vh - 10 - r.height;
        if (r.top < dock - 1) o = Math.max(0, 1 - (dock - r.top) / 130);
      }
      o = Math.round(o * 100) / 100;
      if (shown.get(c) !== o) {
        c.style.setProperty("--o", String(o));
        c.style.visibility = o < 0.01 ? "hidden" : "";
        shown.set(c, o);
      }
    }
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now: number) {
    raf = 0;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    const y = scrollY;
    const sT = dive.sAt(y);
    // scroll drives the zoom directly; a 70 ms smoothing only rounds off wheel steps
    if (Number.isNaN(sCur) || reduced) sCur = sT;
    else {
      sCur += (sT - sCur) * (1 - Math.exp(-dt / 0.07));
      if (Math.abs(sT - sCur) < 2e-4) sCur = sT;
    }
    let busy = sCur !== sT;
    if (view.mobile) {
      // frame the picture above whichever card is docked
      const ch = dive.current(y).card?.offsetHeight ?? 0;
      const k = reduced ? 1 : 1 - Math.exp(-dt / 0.12);
      const next = Math.abs(ch - mobileCardH) < 0.5 ? ch : mobileCardH + (ch - mobileCardH) * k;
      if (next !== mobileCardH) {
        mobileCardH = next;
        view = computeView();
        publishView();
        busy = true;
      }
    }
    if (y !== lastY) {
      fadeCards();
      lastY = y;
    }
    hud.update(sCur, y, view.ref, view.mobile);
    hud.nested(sCur, view.fx, view.fy, view.ref);
    // once the readable page covers the stage, the stage stops drawing
    const nowCovered = y >= dive.surfaceTop - 2;
    if (nowCovered !== covered) {
      covered = nowCovered;
      canvas.style.visibility = covered ? "hidden" : "";
      document.querySelector(".hud")!.classList.toggle("away", covered);
      document.getElementById("tags")!.style.visibility = covered ? "hidden" : "";
    }
    if (engine && !covered && !document.hidden) busy = engine.frame(sCur, dt, now / 1000) || busy;
    if (busy) kick();
    else lastT = 0;
  }

  // links into the dive land where a chapter is centred, not where its block starts
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest?.("a[href^='#']") as HTMLAnchorElement | null;
    if (!a) return;
    const st = dive.stops.find((x) => `#${x.id}` === a.hash);
    if (!st) return;
    e.preventDefault();
    go(st.dock);
  });

  addEventListener("scroll", kick, { passive: true });
  let rz = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(measure);
  });
  document.addEventListener("visibilitychange", () => {
    lastT = 0;
    kick();
  });
  new ResizeObserver(() => measure()).observe(document.getElementById("dive")!);
  document.fonts?.ready.then(measure);
  measure();

  // three.js and the scenes load once the page itself is up
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
  idle(
    async () => {
      await Promise.all([
        document.fonts.load('600 20px "Geist Variable"'),
        document.fonts.load('400 20px "Instrument Serif"'),
      ]).catch(() => {});
      const { Engine } = await import("./gl/engine");
      const stops = dive.stops.map((s) => ({ id: s.id, s: s.s }));
      const e = new Engine(canvas, glc, stops, document.getElementById("tags")!, reduced, kick, view.dpr);
      e.setView(view);
      try {
        await e.init();
      } catch (err) {
        console.warn("The zoom could not start; the page works without it.", err);
        root.classList.remove("gl");
        return;
      }
      engine = e;
      lastT = 0;
      engine.frame(Number.isNaN(sCur) ? dive.sAt(scrollY) : sCur, 1 / 60, performance.now() / 1000);
      requestAnimationFrame(() => root.classList.add("gl-ready"));
      kick();
      if (new URLSearchParams(location.search).has("perf")) perfMeter(e);
    },
    { timeout: 1200 },
  );

  (window as unknown as { __zoom: unknown }).__zoom = { dive, get s() { return sCur; }, get engine() { return engine; } };
}

/** ?perf: CPU time per drawn frame, draw calls, triangles */
function perfMeter(e: Engine) {
  const el = document.createElement("div");
  el.className = "perf";
  document.body.appendChild(el);
  let f0 = e.stats.frames, t0 = performance.now();
  setInterval(() => {
    const t = performance.now(), fps = ((e.stats.frames - f0) * 1000) / (t - t0);
    f0 = e.stats.frames;
    t0 = t;
    el.textContent = `update ${e.stats.update.toFixed(2)} ms · submit ${e.stats.submit.toFixed(2)} ms · ${e.stats.calls} calls · ${e.stats.tris.toLocaleString()} tris · ${fps.toFixed(0)} drawn fps`;
  }, 500);
}
