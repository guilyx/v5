import "./styles.css";
import { startBoard } from "./bt/board";

/**
 * The page works as plain HTML: the tree is a nested list, the blackboard a list of
 * numbers. The board (cards on a camera) starts right away and needs no WebGL;
 * three.js comes in afterwards, once the page is idle, to draw the board itself.
 */
const board = startBoard();

async function loadLayer() {
  if (!board) return;
  const canvas = document.querySelector<HTMLCanvasElement>("canvas.gl");
  if (!canvas) return;
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 900;
  let gl = false;
  try {
    gl = !!document.createElement("canvas").getContext("webgl2");
  } catch {
    gl = false;
  }
  if (gl) {
    const { createGL } = await import("./bt/gl");
    const layer = createGL(canvas, mobile);
    if (layer) return board.attach(layer);
  }
  const { createFlat } = await import("./bt/flat");
  const flat = createFlat(canvas, mobile);
  if (flat) board.attach(flat);
}

/** Photos open full size; arrow keys step through them. */
function wirePhotos() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".gallery a[data-caption]"));
  const viewer = document.querySelector<HTMLDialogElement>("dialog.viewer");
  if (!viewer) return;
  const media = viewer.querySelector(".viewer-media")!;
  const cap = viewer.querySelector(".viewer-cap")!;
  let current = -1;
  const show = (i: number) => {
    current = (i + links.length) % links.length;
    const a = links[current];
    media.innerHTML = "";
    const img = document.createElement("img");
    img.src = a.href;
    img.alt = a.querySelector("img")?.alt ?? "";
    media.append(img);
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
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer.addEventListener("close", () => {
    current = -1;
    media.querySelector("video")?.pause();
    media.innerHTML = "";
  });
  viewer.addEventListener("keydown", (e) => {
    if (current < 0) return;
    if (e.key === "ArrowRight") show(current + 1);
    if (e.key === "ArrowLeft") show(current - 1);
  });
}

/** The bar marks the section you're in. */
function wireNav() {
  const links = new Map(
    Array.from(document.querySelectorAll<HTMLAnchorElement>(".bar nav a")).map((a) => [a.hash.slice(1), a]),
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
const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
if (idle) idle(() => void loadLayer(), { timeout: 1200 });
else setTimeout(() => void loadLayer(), 200);
