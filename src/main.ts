import "@fontsource-variable/geist";
import "@fontsource-variable/fraunces/soft.css";
import "./styles.css";
import { LAST_STOP, STOP_PLACES, css, lookAt } from "./sky";
import { placeById } from "./content";
import type { City } from "./city";

const root = document.documentElement;
root.classList.add("js");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(location.search);
let city: City | null = null;

/* ------------------------------------------------ scroll → time of day --- */

const stops = Array.from(document.querySelectorAll<HTMLElement>("[data-stop]")).sort((a, b) => Number(a.dataset.stop) - Number(b.dataset.stop));
let anchors: number[] = [];
const paper = document.querySelector<HTMLElement>(".paper")!;

function measure() {
  const vh = innerHeight;
  anchors = stops.map((el, i) => {
    const top = el.getBoundingClientRect().top + scrollY;
    return i === 0 ? 0 : top + (el.offsetHeight - vh) / 2;
  });
}

function progressAt(y: number) {
  if (y <= anchors[0]) return 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (y < anchors[i + 1]) return i + (y - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i]);
  }
  return LAST_STOP;
}

const dialYear = document.querySelector<HTMLElement>(".dial-year")!;
const dialWhere = document.querySelector<HTMLElement>(".dial-where")!;
const dialSun = document.querySelector<SVGCircleElement>(".dial-sun")!;
let lastYear = "";
let lastWhere = "";

function paint() {
  ticking = false;
  const c = progressAt(scrollY);
  const L = lookAt(c);
  root.style.setProperty("--sky-top", css(L.top));
  root.style.setProperty("--sky-bot", css(L.bottom));
  root.style.setProperty("--night", L.night.toFixed(3));
  root.classList.toggle("is-night", L.night > 0.55);
  const year = String(L.year);
  const where = `${STOP_PLACES[Math.round(c)]} · ${L.name}`;
  if (year !== lastYear) dialYear.textContent = lastYear = year;
  if (where !== lastWhere) dialWhere.textContent = lastWhere = where;
  // the sun crosses the little arc during the day; the moon sits at the top at night
  const dayT = Math.min(1, c / 8.6);
  const a = L.night > 0.55 ? Math.PI / 2 : Math.PI * dayT;
  dialSun.setAttribute("cx", (32 - 28 * Math.cos(a)).toFixed(2));
  dialSun.setAttribute("cy", (30 - 28 * Math.sin(a)).toFixed(2));
  city?.setProgress(c);
  // the paper sections slide over the city; once they cover it, the city sleeps
  const paperTop = paper.getBoundingClientRect().top;
  city?.setVisible(paperTop > 0);
  root.classList.toggle("past-city", paperTop < innerHeight * 0.5);
  if (sheetOpenAt !== null && Math.abs(scrollY - sheetOpenAt) > 160) closeSheet();
}
let ticking = false;
function onScroll() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(paint);
  }
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", () => {
  measure();
  onScroll();
});

/* ------------------------------------------------------ the place sheet --- */

const CLIPS: Record<string, string[]> = {
  centrale: ["pymapf", "jupyddl"],
  unchained: ["kymatics"],
  clanker: ["clanker-labs"],
};
const sheet = document.getElementById("sheet")!;
const sheetBody = sheet.querySelector<HTMLElement>(".sheet-body")!;
let sheetOpenAt: number | null = null;
let opener: HTMLElement | null = null;

function openSheet(id: string, from?: HTMLElement | null) {
  const place = placeById.get(id);
  if (!place) return;
  const src = document.getElementById(place.source);
  if (!src) return;
  sheetBody.replaceChildren();
  const content = src instanceof HTMLTemplateElement ? src.content.cloneNode(true) : src.querySelector(".card")!.cloneNode(true);
  const frag = document.createElement("div");
  frag.className = "sheet-content";
  frag.append(...Array.from((content as Element | DocumentFragment).childNodes));
  frag.querySelectorAll(".open").forEach((b) => b.remove());
  const h = frag.querySelector("h2");
  if (h) {
    h.id = "sheet-title";
    h.tabIndex = -1;
  }
  sheetBody.append(frag);
  const tone = src.closest<HTMLElement>("[data-tone]")?.dataset.tone;
  sheet.dataset.tone = tone ?? "sage";

  const clips = CLIPS[id];
  if (clips) {
    const box = document.createElement("div");
    box.className = "sheet-clips";
    const title = document.createElement("h3");
    title.textContent = id === "centrale" ? "Related, on my own time" : "The clip";
    box.append(title);
    for (const key of clips) {
      const card = document.querySelector<HTMLElement>(`.work-card[data-key="${key}"]`);
      if (!card) continue;
      const c = card.cloneNode(true) as HTMLElement;
      const v = c.querySelector("video")!;
      v.preload = "metadata";
      if (!reduced) v.autoplay = true;
      else v.controls = true;
      box.append(c);
    }
    sheetBody.append(box);
  }

  sheetBody.querySelectorAll<HTMLAnchorElement>("a[data-close]").forEach((a) => a.addEventListener("click", () => closeSheet()));
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add("on"));
  root.classList.add("sheet-open");
  sheetOpenAt = scrollY;
  opener = from ?? (document.activeElement as HTMLElement | null);
  (h ?? sheet).focus({ preventScroll: true });
  sheet.scrollTop = 0;
  city?.focus(id);
}

function closeSheet() {
  if (sheet.hidden) return;
  sheetOpenAt = null;
  sheet.classList.remove("on");
  root.classList.remove("sheet-open");
  sheetBody.querySelectorAll("video").forEach((v) => v.pause());
  setTimeout(() => {
    if (!sheet.classList.contains("on")) {
      sheet.hidden = true;
      sheetBody.replaceChildren();
    }
  }, reduced ? 0 : 260);
  city?.focus(null);
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null;
}

sheet.querySelector(".sheet-close")!.addEventListener("click", closeSheet);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sheet.hidden) closeSheet();
});
document.querySelectorAll<HTMLButtonElement>("button[data-place]").forEach((b) => {
  b.addEventListener("click", () => openSheet(b.dataset.place!, b));
  b.addEventListener("pointerenter", () => city?.highlight(b.dataset.place!));
  b.addEventListener("pointerleave", () => city?.highlight(null));
  b.addEventListener("focus", () => city?.highlight(b.dataset.place!));
  b.addEventListener("blur", () => city?.highlight(null));
});
document.querySelectorAll<HTMLButtonElement>(".turn").forEach((b) => b.addEventListener("click", () => city?.turn(Number(b.dataset.dir))));

/* ------------------------------------------------------------- the nav --- */

function wireNav() {
  const links = new Map(Array.from(document.querySelectorAll<HTMLAnchorElement>(".top nav a")).map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((a, id) => (id === en.target.id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  links.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

/** A chapter's card fades up when its stretch of scroll reaches the middle of the screen. */
function wireCards() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) en.target.classList.toggle("in", en.isIntersecting);
    },
    { rootMargin: "-38% 0px -38% 0px" },
  );
  document.querySelectorAll(".chapter, .finale").forEach((el) => io.observe(el));
}

/* ---------------------------------------------------------- the clips --- */

function wireVideos() {
  const videos = document.querySelectorAll<HTMLVideoElement>(".cards video");
  if (reduced) {
    videos.forEach((v) => {
      v.controls = true;
    });
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

/* --------------------------------------------------------- the photos --- */

function wirePhotos() {
  const strip = document.querySelector<HTMLElement>(".strip")!;
  const links = Array.from(strip.querySelectorAll<HTMLAnchorElement>("a[data-caption]"));
  document.querySelectorAll<HTMLButtonElement>(".strip-nav button").forEach((b) =>
    b.addEventListener("click", () => {
      const fig = strip.querySelector("figure");
      const step = fig ? fig.getBoundingClientRect().width + 20 : 400;
      strip.scrollBy({ left: Number(b.dataset.dir) * step, behavior: reduced ? "auto" : "smooth" });
    }),
  );
  const viewer = document.querySelector<HTMLDialogElement>(".viewer")!;
  const img = viewer.querySelector("img")!;
  const cap = viewer.querySelector(".viewer-cap")!;
  let current = 0;
  const show = (i: number) => {
    current = (i + links.length) % links.length;
    const a = links[current];
    img.src = a.href;
    img.alt = a.querySelector("img")!.alt;
    cap.textContent = a.dataset.caption!;
  };
  links.forEach((a, i) =>
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      show(i);
      viewer.showModal();
    }),
  );
  viewer.querySelector(".viewer-close")!.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(current + 1);
    if (e.key === "ArrowLeft") show(current - 1);
  });
}

/* ----------------------------------------------------------- the city --- */

function hasWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

async function loadCity() {
  if (!hasWebGL2()) {
    root.classList.add("no-webgl");
    return;
  }
  const { startCity } = await import("./city");
  city = startCity({
    canvas: document.getElementById("city") as HTMLCanvasElement,
    labels: document.querySelector<HTMLElement>(".labels")!,
    reduced,
    onPick: (id) => openSheet(id, null),
  });
  root.classList.add("has-city");
  paint();
  if (params.has("perf")) {
    const hud = document.createElement("pre");
    hud.className = "perf";
    document.body.append(hud);
    (window as unknown as { __city: City }).__city = city;
    setInterval(() => {
      const s = city!.stats();
      hud.textContent = `fps ${s.fps}  frame cpu ${s.cpuMs} ms (update ${s.stepMs})\ncalls ${s.calls}  tris ${s.triangles}\ndpr ${s.dpr}  frames ${s.frames}  shadow passes ${s.shadowRenders}`;
    }, 500);
  }
}

measure();
paint();
wireNav();
wireCards();
wireVideos();
wirePhotos();
document.fonts?.ready.then(() => {
  measure();
  onScroll();
});
const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
if (document.readyState === "complete") idle(() => void loadCity(), { timeout: 1200 });
else addEventListener("load", () => idle(() => void loadCity(), { timeout: 1200 }), { once: true });
