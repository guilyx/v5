import "./styles.css";
import { createTimeline, measure, update } from "./timeline";

const tl = createTimeline();
const root = document.documentElement;
let ws: { wake(): void } | null = null;

const $ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll<T>(sel));

/* ── page state from scroll: nav, shelf rail, card fades ─────────────────── */
const navLinks = new Map($$<HTMLAnchorElement>(".nav nav a").map((a) => [a.hash.slice(1), a]));
const railButtons = $$<HTMLButtonElement>(".rail button");
railButtons.forEach((b) => (b.title = b.getAttribute("aria-label") ?? ""));
const cards = $$(".act .card");
let lastZone = "";
let lastNav = "";
let lastRail = "";

function syncPage() {
  if (tl.zone !== lastZone) {
    lastZone = tl.zone;
    document.body.dataset.zone = tl.zone;
  }
  let nav = tl.zone === "hero" ? "" : tl.zone === "sheet" ? "notes" : tl.zone;
  if (tl.zone === "sheet" && $("#photos").getBoundingClientRect().top < tl.vh * 0.5) nav = "photos";
  if (nav !== lastNav) {
    lastNav = nav;
    navLinks.forEach((a, id) => (id === nav ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
  }

  const cur = tl.s >= 0 && tl.s < 8 ? Math.floor(tl.s) : -1;
  const railKey = `${cur}:${Math.floor(tl.s - 0.8)}`;
  if (railKey !== lastRail) {
    lastRail = railKey;
    railButtons.forEach((b, k) => {
      b.classList.toggle("current", k === cur);
      b.classList.toggle("placed", k < tl.s - 0.8);
    });
  }

  // on phones the stage sits above the docked card: a card on its way out fades
  // instead of sliding across the arm
  if (tl.mobile && !root.classList.contains("no-gl")) {
    const rects = cards.map((c) => c.getBoundingClientRect());
    rects.forEach((r, k) => {
      if (r.bottom < 0 || r.top > tl.vh) return;
      const dock = tl.vh - 12 - r.height;
      const o = Math.max(0, Math.min(1, 1 - (dock - r.top) / (r.height * 0.45)));
      cards[k].style.opacity = o >= 0.999 ? "" : o.toFixed(3);
    });
  }
}

let ticking = false;
window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update(tl);
      syncPage();
      ws?.wake();
      // scrolling away puts the object back on the shelf
      if (story.open && Math.abs(window.scrollY - storyY) > 160) story.close();
    });
  },
  { passive: true },
);
let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    measure(tl);
    syncPage();
  });
});

/* ── the story card: open an object from the shelf ───────────────────────── */
const story = $<HTMLDialogElement>(".story");
let storyIdx = -1;
let storyY = 0;
let opener: HTMLElement | null = null;

function openStory(k: number) {
  const art = $(`.chapter[data-obj="${k}"]`);
  if (!art) return;
  storyIdx = k;
  opener = document.activeElement as HTMLElement | null;
  $(".story-num", story).textContent = $(".ch-num", art).textContent;
  $(".story-meta", story).innerHTML = $(".ch-meta", art).innerHTML;
  $(".story-icon", story).setAttribute("href", $(".ch-icon use", art).getAttribute("href") ?? "");
  $(".story-obj", story).textContent = ($(".obj", art).textContent ?? "").trim();
  $(".story-title", story).textContent = $("h2", art).textContent;
  const text = $(".story-text", story);
  text.replaceChildren(...$$(".card > p:not(.obj), .card > blockquote, .card > ul", art).map((n) => n.cloneNode(true)));
  storyY = window.scrollY;
  if (!story.open) story.showModal();
  window.dispatchEvent(new CustomEvent("ws:focus", { detail: k }));
}
story.addEventListener("close", () => {
  storyIdx = -1;
  window.dispatchEvent(new CustomEvent("ws:focus", { detail: -1 }));
  opener?.focus?.({ preventScroll: true });
});
story.addEventListener("click", (e) => {
  if (e.target === story) story.close();
});
$(".story-close", story).addEventListener("click", () => story.close());
$(".story-go", story).addEventListener("click", () => {
  const k = storyIdx;
  story.close();
  const art = $(`.chapter[data-obj="${k}"]`);
  if (!art) return;
  // land where the arm is holding that chapter's object up for you
  const top = art.getBoundingClientRect().top + window.scrollY;
  const y = root.classList.contains("no-gl") ? top - 80 : top - tl.vh * 0.6 + art.offsetHeight * 0.45;
  window.scrollTo({ top: y, behavior: tl.reduced ? "auto" : "smooth" });
});
railButtons.forEach((b) => b.addEventListener("click", () => openStory(Number(b.dataset.obj))));
window.addEventListener("ws:pick", (e) => openStory((e as CustomEvent<number>).detail));

/* ── the bench: pick a project, the monitor plays its clip ───────────────── */
const video = $<HTMLVideoElement>(".clip");
const projects = new Map($$("div[data-key]", $<HTMLTemplateElement>("#projects-data").content).map((d) => [d.dataset.key!, d]));
let benchVisible = false;

function playClip() {
  if (tl.reduced || !benchVisible) return;
  video.play().catch(() => {});
}
function selectProject(key: string) {
  const d = projects.get(key);
  if (!d) return;
  $$<HTMLButtonElement>(".proj").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
  $(".now-title").textContent = d.dataset.title!;
  $(".now-line").textContent = d.dataset.line!;
  $(".now-links").replaceChildren(
    ...d.dataset.links!.split(";").map((pair) => {
      const [label, href] = pair.split("|");
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      return a;
    }),
  );
  video.poster = `/work/${key}.webp`;
  video.src = `/work/${key}.mp4`;
  video.setAttribute("aria-label", `Clip of ${d.dataset.title} running`);
  window.dispatchEvent(new CustomEvent("ws:clip", { detail: { poster: video.poster, ratio: Number(d.dataset.ratio) } }));
  playClip();
}
$$<HTMLButtonElement>(".proj").forEach((b) => b.addEventListener("click", () => selectProject(b.dataset.key!)));
new IntersectionObserver(
  ([en]) => {
    benchVisible = en.isIntersecting;
    if (benchVisible) playClip();
    else video.pause();
  },
  { threshold: 0.15 },
).observe($("#bench"));
video.addEventListener("click", () => (video.paused ? video.play().catch(() => {}) : video.pause()));

/* ── photos: a native dialog, arrow keys to step ─────────────────────────── */
function wirePhotos() {
  const links = $$<HTMLAnchorElement>(".gallery a[data-caption]");
  const viewer = $<HTMLDialogElement>(".viewer");
  const img = $<HTMLImageElement>("img", viewer);
  const cap = $(".viewer-cap", viewer);
  let current = 0;
  const show = (i: number) => {
    current = (i + links.length) % links.length;
    const a = links[current];
    img.src = a.href;
    img.alt = $<HTMLImageElement>("img", a).alt;
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
  $(".viewer-close", viewer).addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(current + 1);
    if (e.key === "ArrowLeft") show(current - 1);
  });
}
wirePhotos();

/* ── say hello: the arm waves back ───────────────────────────────────────── */
const email = $("#email");
for (const ev of ["pointerenter", "focus"]) email.addEventListener(ev, () => window.dispatchEvent(new CustomEvent("ws:wave")));

/* ── the workshop is a layer on a page that already works ────────────────── */
async function loadWorkshop() {
  let gl = false;
  try {
    gl = !!document.createElement("canvas").getContext("webgl2");
  } catch {
    gl = false;
  }
  if (!gl) {
    root.classList.add("no-gl");
    measure(tl);
    syncPage();
    return;
  }
  root.classList.add("gl");
  try {
    const { startWorkshop } = await import("./workshop");
    ws = startWorkshop($<HTMLCanvasElement>("#studio"), tl, video);
  } catch (err) {
    console.error(err);
    root.classList.replace("gl", "no-gl");
    measure(tl);
    syncPage();
  }
}

measure(tl);
syncPage();
document.fonts?.ready.then(() => {
  measure(tl);
  syncPage();
  ws?.wake();
});
const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((cb) => setTimeout(cb, 1));
idle(() => void loadWorkshop(), { timeout: 600 });
