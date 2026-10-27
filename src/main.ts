import "@fontsource-variable/geist/wght.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "./styles.css";
import { initJourney } from "./journey";

const html = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** three.js r186 needs WebGL 2. Probe once, then free the context. */
function hasWebGL2() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const gl = hasWebGL2();
html.classList.toggle("gl", gl);
const journey = initJourney({ gl, reduced });

if (gl) {
  // the page is readable now; the 3D scene loads when the browser is idle
  const load = () =>
    import("./flight/index")
      .then((m) => m.startFlight(document.getElementById("gl") as HTMLCanvasElement, journey))
      .catch((err) => {
        console.warn("Flight unavailable, showing the plain logbook.", err);
        journey.disable();
      });
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 900 });
  else setTimeout(load, 120);
}

/** Clips load and play only while you can see them; with reduced motion they wait for you. */
function wireClips() {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(".bay video"));
  const arm = (v: HTMLVideoElement) => {
    if (!v.src && v.dataset.src) v.src = v.dataset.src;
  };
  if (reduced) {
    videos.forEach((v) => {
      v.controls = true;
      v.preload = "none";
      v.addEventListener("play", () => arm(v), { once: true });
      v.parentElement!.addEventListener("click", () => {
        arm(v);
        v.play().catch(() => {});
      }, { once: true });
    });
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting) {
          arm(v);
          v.play().catch(() => {});
        } else if (!v.paused) v.pause();
      }
    },
    { threshold: 0.35 },
  );
  videos.forEach((v) => io.observe(v));
}

/** Postcards open in a native dialog; arrows step through them. */
function wirePhotos() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".pc a"));
  const viewer = document.querySelector<HTMLDialogElement>(".viewer")!;
  const img = viewer.querySelector("img")!;
  const cap = viewer.querySelector("figcaption")!;
  let cur = 0;
  const show = (i: number) => {
    cur = (i + links.length) % links.length;
    const a = links[cur];
    img.src = a.href;
    img.alt = a.querySelector("img")!.alt;
    cap.textContent = a.dataset.caption ?? "";
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
  viewer.querySelector(".viewer-prev")!.addEventListener("click", () => show(cur - 1));
  viewer.querySelector(".viewer-next")!.addEventListener("click", () => show(cur + 1));
  viewer.addEventListener("click", (e) => e.target === viewer && viewer.close());
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(cur + 1);
    if (e.key === "ArrowLeft") show(cur - 1);
  });
}

/** Mark the section you're reading in the top bar. */
function wireNav() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".nav a"));
  const map = new Map(links.map((a) => [a.getAttribute("href")!.slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const id = en.target.id === "top" ? "log" : en.target.id;
        links.forEach((a) => a.removeAttribute("aria-current"));
        map.get(id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  ["top", "hangar", "writing", "photos", "contact"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

wireClips();
wirePhotos();
wireNav();
