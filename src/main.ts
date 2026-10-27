import "./styles.css";

/** Off the clock: the strip is plain HTML; this adds the arrows and the full-size viewer. */
function wirePhotos() {
  const strip = document.querySelector<HTMLElement>(".strip")!;
  const links = Array.from(strip.querySelectorAll<HTMLAnchorElement>("a[data-caption]"));

  // the arrows step a frame at a time
  document.querySelectorAll<HTMLButtonElement>(".strip-nav button").forEach((b) =>
    b.addEventListener("click", () => {
      const fig = strip.querySelector("figure");
      const step = fig ? fig.getBoundingClientRect().width + 16 : 400;
      strip.scrollBy({ left: Number(b.dataset.dir) * step, behavior: "smooth" });
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

/** Clips play only while you can see them, and not at all if you've asked for less motion. */
function wireVideos() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const videos = document.querySelectorAll<HTMLVideoElement>(".card video");
  if (reduced) {
    videos.forEach((v) => {
      v.parentElement!.addEventListener("pointerenter", () => v.play().catch(() => {}));
      v.parentElement!.addEventListener("pointerleave", () => v.pause());
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
    { threshold: 0.6 },
  );
  videos.forEach((v) => io.observe(v));
}

/** The 3D is a layer on top of a page that already works; load it once the page is up. */
async function loadSwarm() {
  const canvas = document.getElementById("swarm") as HTMLCanvasElement;
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return;
  await Promise.all([
    document.fonts.load('700 100px "Geist Variable"'),
    document.fonts.load('italic 400 100px "Instrument Serif"'),
  ]).catch(() => {});
  const { startSwarm } = await import("./swarm");
  startSwarm(canvas);
}

/** The nav marks the section you're in. */
function wireNav() {
  const links = new Map(
    Array.from(document.querySelectorAll<HTMLAnchorElement>(".nav nav a")).map((a) => [a.hash.slice(1), a]),
  );
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

wirePhotos();
wireNav();
wireVideos();
const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb) => setTimeout(cb, 1));
idle(() => void loadSwarm());
