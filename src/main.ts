import "./styles.css";
import type { Bridge, Show } from "./show";

/**
 * The page works on its own: every word is HTML, and without WebGL the acts
 * simply stack over a painted night sky. With WebGL, the acts become a fixed
 * "programme" card, scroll becomes the show's timeline, and the sky loads
 * lazily (three.js is a separate chunk fetched after first paint).
 */

const root = document.documentElement;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element>(s: string) => Array.from(document.querySelectorAll<T>(s));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const acts = $$<HTMLElement>(".act");
const cards = acts.map((a) => a.querySelector<HTMLElement>(".card")!);
const after = $<HTMLElement>("#after");
const contact = $<HTMLElement>("#contact");
const stripAct = $<HTMLElement>(".strip-act");
const stripYear = $<HTMLElement>(".strip-year");
const track = $<HTMLElement>(".strip-track");
const fill = $<HTMLElement>(".strip-fill");
const ticks = $<HTMLElement>(".strip-ticks");
const directBar = $<HTMLElement>(".direct-bar");
const ink = $<HTMLCanvasElement>("canvas.ink");
const LAST = acts.length - 1;

const bridge: Bridge = { target: 0, awake: true, reduced: motion.matches };
let show: Show | null = null;
let live = root.classList.contains("live");

// ---------------------------------------------------------------- the painted sky (first paint, and the no-WebGL fallback)

function paintSkyline() {
  const svg = $<SVGSVGElement>("svg.skyline");
  svg.setAttribute("viewBox", "0 0 1000 100");
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let d = "M0 100";
  for (let x = 0; x < 1000; ) {
    const w = 6 + r() * 18;
    const bump = 1 + 1.3 * Math.exp(-(((x - 640) / 120) ** 2)) + 0.8 * Math.exp(-(((x - 300) / 110) ** 2));
    const h = Math.min(98, (12 + r() ** 1.5 * 34) * bump);
    d += ` L${x.toFixed(1)} ${(100 - h).toFixed(1)} L${(x + w).toFixed(1)} ${(100 - h).toFixed(1)}`;
    x += w + r() * 5;
  }
  d += " L1000 100 Z";
  svg.innerHTML = `<path d="${d}" fill="#0b0f1c"/>`;
}
paintSkyline();

// ---------------------------------------------------------------- scroll = the show's timeline

let actH = 1, afterTop = 0, contactTop = 0;
function measure() {
  actH = acts[0].offsetHeight || innerHeight;
  afterTop = after.offsetTop;
  contactTop = contact.offsetTop;
}

/** 0 = overture … 8 = act VIII, then 9 = "hello" as the contact section rises. */
function timeline(y: number) {
  const vh = innerHeight;
  if (y + vh > contactTop) return LAST + clamp((y + vh - contactTop) / vh, 0, 1);
  return Math.min(LAST, y / actH);
}

ticks.innerHTML = acts.map((_, i) => `<i style="left:${(i / LAST) * 100}%"></i>`).join("");
const tickEls = Array.from(ticks.children) as HTMLElement[];

let current = -1;
function setAct(i: number) {
  if (i === current) return;
  current = i;
  cards.forEach((c, k) => {
    const on = k === i;
    c.classList.toggle("is-on", on);
    c.toggleAttribute("inert", !on && live);
  });
  if (i < 0) return;
  const a = acts[i];
  stripAct.textContent = a.dataset.label!;
  stripYear.textContent = a.dataset.year!;
  track.setAttribute("aria-valuenow", String(i));
  track.setAttribute("aria-valuetext", `${a.dataset.label}, ${a.dataset.year}`);
  tickEls.forEach((t, k) => t.classList.toggle("on", k <= i));
}

let directing = false;
let directY = 0;
function onScroll() {
  const y = scrollY, vh = innerHeight;
  const s = timeline(y);
  bridge.target = s;
  bridge.awake = y < afterTop - 1 || y + vh > contactTop + 1;
  const inShow = afterTop - y > vh * 0.97;
  root.classList.toggle("dock-off", !inShow);
  if (live) setAct(inShow ? clamp(Math.round(s), 0, LAST) : -1);
  fill.style.transform = `scaleX(${clamp(s / LAST, 0, 1)})`;
  if (directing && (Math.abs(y - directY) > 80 || !inShow)) setDirect(false);
  show?.wake();
}

// ---------------------------------------------------------------- the timeline strip: drag to scrub, arrows to step

let seeking = false;
function seek(e: PointerEvent) {
  const r = track.getBoundingClientRect();
  const f = clamp((e.clientX - r.left) / r.width, 0, 1);
  scrollTo({ top: f * LAST * actH, behavior: "instant" as ScrollBehavior });
}
track.addEventListener("pointerdown", (e) => {
  seeking = true;
  track.setPointerCapture(e.pointerId);
  seek(e);
});
track.addEventListener("pointermove", (e) => seeking && seek(e));
track.addEventListener("pointerup", () => (seeking = false));
track.addEventListener("pointercancel", () => (seeking = false));
const go = (i: number) => scrollTo({ top: clamp(i, 0, LAST) * actH, behavior: bridge.reduced ? "instant" as ScrollBehavior : "smooth" });
track.addEventListener("keydown", (e) => {
  const map: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
  if (e.key in map) go(Math.max(0, current) + map[e.key]);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(LAST);
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- direct the show

const directButtons = $$<HTMLButtonElement>("[data-direct]");
function setDirect(on: boolean) {
  if (on && !show) return;
  directing = on;
  directY = scrollY;
  root.classList.toggle("directing", on);
  directBar.hidden = !on;
  for (const b of directButtons) {
    b.setAttribute("aria-pressed", String(on));
    if (b.classList.contains("btn-direct")) b.textContent = on ? "Done" : "Direct";
  }
  if (on) {
    if (scrollY > afterTop - innerHeight) go(0);
    directBar.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  } else show?.clear();
}
for (const b of directButtons) b.addEventListener("click", () => setDirect(!directing));
directBar.querySelector("[data-done]")!.addEventListener("click", () => setDirect(false));
directBar.querySelector("[data-clear]")!.addEventListener("click", () => show?.clear());
for (const b of directBar.querySelectorAll<HTMLButtonElement>("[data-shape]")) b.addEventListener("click", () => show?.shape(b.dataset.shape!));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && directing) setDirect(false);
});

// the ink: what you draw glows for a moment, then the drones take it over
const pen = ink.getContext("2d")!;
let strokePts: number[] = [];
let drawing = false;
let inkFade = 0;
function sizeInk() {
  const d = Math.min(devicePixelRatio, 2);
  ink.width = innerWidth * d;
  ink.height = innerHeight * d;
  pen.setTransform(d, 0, 0, d, 0, 0);
}
ink.addEventListener("pointerdown", (e) => {
  if (!directing) return;
  drawing = true;
  ink.setPointerCapture(e.pointerId);
  cancelAnimationFrame(inkFade);
  ink.style.opacity = "1";
  pen.clearRect(0, 0, innerWidth, innerHeight);
  strokePts = [e.clientX, e.clientY];
});
ink.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const l = strokePts.length;
  const x = e.clientX, y = e.clientY;
  if (Math.hypot(x - strokePts[l - 2], y - strokePts[l - 1]) < 2) return;
  pen.strokeStyle = "rgba(255, 196, 110, 0.95)";
  pen.shadowColor = "rgba(255, 170, 60, 0.9)";
  pen.shadowBlur = 12;
  pen.lineWidth = 2.5;
  pen.lineCap = "round";
  pen.beginPath();
  pen.moveTo(strokePts[l - 2], strokePts[l - 1]);
  pen.lineTo(x, y);
  pen.stroke();
  strokePts.push(x, y);
});
const endStroke = () => {
  if (!drawing) return;
  drawing = false;
  show?.stroke(strokePts);
  const t0 = performance.now();
  const fade = () => {
    const k = (performance.now() - t0) / 900;
    ink.style.opacity = String(Math.max(0, 1 - k));
    if (k < 1) inkFade = requestAnimationFrame(fade);
    else pen.clearRect(0, 0, innerWidth, innerHeight);
  };
  inkFade = requestAnimationFrame(fade);
};
ink.addEventListener("pointerup", endStroke);
ink.addEventListener("pointercancel", endStroke);

// ---------------------------------------------------------------- the sky answers: click = a ripple, cursor = a hawk for the flock

const UI = "a, button, input, .card, .strip, .nav, .direct-bar, dialog, .after, .footer";
addEventListener("click", (e) => {
  if (!show || directing || !bridge.awake) return;
  if ((e.target as Element).closest(UI)) return;
  show.ripple(e.clientX, e.clientY);
});
addEventListener(
  "pointermove",
  (e) => {
    if (!show || e.pointerType !== "mouse") return;
    show.pointer(e.clientX, e.clientY, !(e.target as Element).closest?.(UI));
  },
  { passive: true },
);
document.addEventListener("pointerleave", () => show?.pointer(0, 0, false));

// ---------------------------------------------------------------- after the show: clips, photos, nav

function wireVideos() {
  const videos = $$<HTMLVideoElement>(".work video");
  if (bridge.reduced) {
    videos.forEach((v) => (v.controls = true));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting) v.play().catch(() => {});
        else v.pause();
      }
    },
    { threshold: 0.55 },
  );
  videos.forEach((v) => io.observe(v));
}

function wirePhotos() {
  const links = $$<HTMLAnchorElement>(".gallery a[data-caption]");
  const viewer = $<HTMLDialogElement>(".viewer");
  const img = viewer.querySelector("img")!;
  const cap = viewer.querySelector(".viewer-cap")!;
  let at = 0;
  const open = (i: number) => {
    at = (i + links.length) % links.length;
    const a = links[at];
    img.src = a.href;
    img.alt = a.querySelector("img")!.alt;
    cap.textContent = a.dataset.caption!;
  };
  links.forEach((a, i) =>
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      open(i);
      viewer.showModal();
    }),
  );
  viewer.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) => b.addEventListener("click", () => open(at + Number(b.dataset.step))));
  viewer.querySelector(".viewer-close")!.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => e.target === viewer && viewer.close());
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") open(at + 1);
    if (e.key === "ArrowLeft") open(at - 1);
  });
}

function wireNav() {
  const links = new Map($$<HTMLAnchorElement>(".nav nav a").map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries)
        if (en.isIntersecting)
          links.forEach((a, id) => (id === en.target.id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  links.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

// ---------------------------------------------------------------- boot

function fallBack() {
  live = false;
  show = null;
  root.classList.remove("live", "sky-on");
  cards.forEach((c) => c.removeAttribute("inert"));
  measure();
  onScroll();
}

async function startSky() {
  const canvas = $<HTMLCanvasElement>("#sky");
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return fallBack();
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  await Promise.all([
    document.fonts.load('italic 400 100px "Instrument Serif"'),
    document.fonts.load('700 100px "Geist Variable"'),
    document.fonts.load('600 100px "Geist Variable"'),
  ]).catch(() => {});
  try {
    const { startShow } = await import("./show");
    show = startShow(canvas, bridge, () => root.classList.add("sky-on"));
    $$<HTMLElement>("[data-drones]").forEach((el) => (el.textContent = show!.drones.toLocaleString("en-US")));
    if (new URLSearchParams(location.search).has("perf")) perfOverlay();
    onScroll();
  } catch (err) {
    console.warn("The show could not start; showing the programme instead.", err);
    fallBack();
  }
}

function perfOverlay() {
  const el = document.createElement("pre");
  el.className = "perf";
  document.body.append(el);
  setInterval(() => {
    if (!show) return;
    const s = show.stats();
    el.textContent = `cpu ${s.cpu.toFixed(2)} ms (sim ${s.update.toFixed(2)}) · ${s.calls} draws · ${s.fps.toFixed(0)} fps`;
    (window as unknown as { __show: unknown }).__show = s;
  }, 500);
}

measure();
sizeInk();
onScroll();
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", () => {
  measure();
  sizeInk();
  onScroll();
});
motion.addEventListener("change", () => (bridge.reduced = motion.matches));
wireVideos();
wirePhotos();
wireNav();
if (live) requestAnimationFrame(() => setTimeout(startSky, 0));
else fallBack();
