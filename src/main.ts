import "./styles.css";
import { Atlas } from "./atlas/atlas";
import type { Place } from "./atlas/places";
import type { TimelineState } from "./atlas/timeline";

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(s));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- photo viewer: one native <dialog>, fed by the postcards grid and the photo pins ---------- */
interface Shot {
  src: string;
  caption: string;
  alt: string;
}
const viewer = $<HTMLDialogElement>(".viewer")!;
const vImg = $<HTMLImageElement>("img", viewer)!;
const vCap = $(".viewer-cap", viewer)!;
const vCount = $(".viewer-count", viewer)!;
let shots: Shot[] = [];
let shot = 0;
function show(i: number) {
  shot = (i + shots.length) % shots.length;
  const s = shots[shot];
  vImg.src = s.src;
  vImg.alt = s.alt;
  vCap.textContent = s.caption;
  vCount.textContent = shots.length > 1 ? `${shot + 1} / ${shots.length}` : "";
  viewer.classList.toggle("is-single", shots.length < 2);
}
function openPhotos(list: Shot[], i = 0) {
  shots = list;
  show(i);
  if (!viewer.open) viewer.showModal();
}
$(".viewer-prev", viewer)!.addEventListener("click", () => show(shot - 1));
$(".viewer-next", viewer)!.addEventListener("click", () => show(shot + 1));
$(".viewer-close", viewer)!.addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (e) => {
  if (e.target === viewer) viewer.close();
});
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") show(shot + 1);
  if (e.key === "ArrowLeft") show(shot - 1);
});

const gridLinks = $$<HTMLAnchorElement>(".cards-grid a[data-photo]");
const gridShots: Shot[] = gridLinks.map((a) => ({ src: a.href, caption: a.dataset.caption!, alt: $<HTMLImageElement>("img", a)!.alt }));
gridLinks.forEach((a, i) =>
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    openPhotos(gridShots, i);
  }),
);
const placeShots = (p: Place): Shot[] =>
  (p.photos ?? []).map((ph) => ({ src: `/photos/${ph.file}-1600.webp`, caption: ph.caption, alt: ph.caption.replace(" · ", ", ") }));

/* ---------- the passport ---------- */
const passport = $<HTMLDialogElement>(".passport")!;
$$("[data-open-passport]").forEach((b) => b.addEventListener("click", () => passport.showModal()));
$(".pp-close", passport)!.addEventListener("click", () => passport.close());
passport.addEventListener("click", (e) => {
  if (e.target === passport) passport.close();
});
$$<HTMLAnchorElement>(".pp-nav a", passport).forEach((a) => a.addEventListener("click", () => passport.close()));

/* ---------- clips play only while you can see them (on hover only, with reduced motion) ---------- */
function wireVideos() {
  const videos = $$<HTMLVideoElement>(".plate video");
  if (reduced) {
    videos.forEach((v) => {
      const host = v.closest(".plate")!;
      host.addEventListener("pointerenter", () => v.play().catch(() => {}));
      host.addEventListener("pointerleave", () => v.pause());
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

/* ---------- the masthead marks where you are ---------- */
function wireNav() {
  const links = new Map($$<HTMLAnchorElement>(".nav a").map((a) => [a.hash.slice(1), a]));
  const sections: [string, string][] = [
    ["journey", "nantes"],
    ["work", "work"],
    ["writing", "writing"],
    ["postcards", "postcards"],
    ["contact", "contact"],
  ];
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const key = sections.find(([id]) => id === en.target.id)?.[1];
        links.forEach((a, id) => (id === key ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach(([id]) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
  const mast = $(".masthead")!;
  const onScroll = () => mast.classList.toggle("is-scrolled", window.scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ---------- the atlas ---------- */
const stamps = $$<HTMLButtonElement>(".stamp");
const tourButtons = $$<HTMLButtonElement>(".tour button");
const chapterIds = $$<HTMLElement>(".chapter[data-chapter]").map((a) => a.dataset.chapter!);

function onState(_i: number, st: TimelineState) {
  const chapter = chapterIds[st.chapter] ?? "";
  stamps.forEach((s) => {
    const k = s.dataset.goto;
    const here =
      k === chapter ||
      (chapter === "travels" && k === st.stopKey) ||
      (chapter === "lead" && (st.stopKey === "pasadena" ? k === "pasadena" : k === "tii"));
    s.toggleAttribute("aria-current", here);
  });
  tourButtons.forEach((b) => b.toggleAttribute("aria-current", chapter === "travels" && b.dataset.goto === st.stopKey));
}

const stage = $(".stage")!;
const atlas = new Atlas(stage, {
  openPhotos: (p) => openPhotos(placeShots(p)),
  onChapter: onState,
});

$$<HTMLElement>("[data-goto]").forEach((el) =>
  el.addEventListener("click", (e) => {
    const key = el.dataset.goto!;
    if (atlas.timeline.yFor(key) === undefined) return;
    e.preventDefault();
    if (passport.open) passport.close();
    atlas.goTo(key);
  }),
);

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

if (hasWebGL()) {
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const go = () => void atlas.upgrade();
  if (idle) idle(go, { timeout: 900 });
  else setTimeout(go, 60);
} else {
  atlas.setFlat();
  document.documentElement.classList.add("no-gl");
}

if (import.meta.env.DEV || location.search.includes("stats")) {
  (window as unknown as { __atlas: Atlas }).__atlas = atlas;
}

wireNav();
wireVideos();
