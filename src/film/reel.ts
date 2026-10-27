/**
 * The reel: eight project clips on a strip of film. Scroll moves the strip
 * (it's the playhead), dragging it scrubs the page, and a click projects a frame.
 * A plain HTML strip runs first and stays as the fallback; the 3D strip loads
 * lazily and takes over when it's ready.
 */
import type { Film, Scene } from "./film";
import { clipItem, type Projector } from "./projector";
import type { StripApi } from "../strip";

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeIOInv = (y: number) => (y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2);
/** how much of each frame's stretch of scroll the strip holds still: an intermittent pull-down, like a projector */
const HOLD = 0.19;

export function mountReel(film: Film, projector: Projector) {
  const sc = film.scenes.find((s) => s.kind === "reel");
  if (!sc) return;
  const stage = document.getElementById("reel-stage")!;
  const htmlStrip = document.getElementById("strip-html")!;
  const list = document.getElementById("clips")!;
  const clips = Array.from(list.querySelectorAll<HTMLLIElement>(".clip"));
  const N = clips.length;
  const items = clips.map((li) => clipItem(li, film.reduced));

  // the HTML strip
  const rail = document.createElement("div");
  rail.className = "strip-rail";
  const cells = clips.map((li) => {
    const c = document.createElement("div");
    c.className = "strip-cell";
    const img = new Image();
    img.src = `/work/${li.dataset.key}.webp`;
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    c.appendChild(img);
    rail.appendChild(c);
    return c;
  });
  htmlStrip.appendChild(rail);
  let cellW = 1;

  let gl: StripApi | null = null;
  let offset = 0;
  let active = -1;
  let playT = 0;

  // captions take the height of the tallest one, so nothing jumps
  film.beforeLayout.push(() => {
    list.style.removeProperty("--cap-h");
    const h = Math.max(...clips.map((li) => li.offsetHeight));
    list.style.setProperty("--cap-h", `${h + 8}px`);
  });
  film.onLayout.push(() => {
    cellW = cells[0].offsetWidth || 1;
    gl?.resize();
    place();
  });

  const span = () => {
    const a = sc.inPx * 0.7;
    return [a, sc.dur - a - sc.outPx * 0.7] as const;
  };
  const pull = (x: number) => {
    const k = Math.floor(x);
    if (k >= N - 1) return N - 1;
    return k + easeIO(clamp((x - k - HOLD) / (1 - 2 * HOLD), 0, 1));
  };
  const unpull = (o: number) => {
    const k = Math.floor(o);
    const f = o - k;
    return f < 1e-4 ? k : k + HOLD + easeIOInv(f) * (1 - 2 * HOLD);
  };
  const offsetAt = (local: number) => {
    const [a, b] = span();
    return pull(clamp((local - a) / b, 0, 1) * (N - 1));
  };
  const yFor = (o: number) => {
    const [a, b] = span();
    return sc.start + a + (unpull(clamp(o, 0, N - 1)) / (N - 1)) * b;
  };

  const place = () => {
    rail.style.transform = `translate3d(${(-(offset + 0.5) * cellW).toFixed(1)}px,0,0)`;
    gl?.setOffset(offset);
  };

  const setActive = (i: number) => {
    if (active >= 0) {
      clips[active].classList.remove("is-active");
      cells[active].classList.remove("is-active");
    }
    active = i;
    clips[i].classList.add("is-active");
    cells[i].classList.add("is-active");
  };

  const schedulePlay = () => {
    clearTimeout(playT);
    if (!gl) return;
    const settled = Math.abs(offset - Math.round(offset)) < 0.18;
    if (!settled || film.scenes[film.cur] !== sc || projector.isOpen) return gl.play(null);
    playT = window.setTimeout(() => gl?.play(Math.round(offset)), 160);
  };

  film.onFrame.push((s: Scene, local: number) => {
    if (s !== sc) return;
    const o = offsetAt(local);
    if (o === offset && active >= 0) return;
    offset = o;
    const i = Math.round(o);
    if (i !== active) setActive(i);
    place();
    schedulePlay();
  });

  // lazy 3D
  let loading = false;
  const hasGL = () => {
    // probe once, and let the probe go, so a browser without WebGL 2 never downloads three.js
    try {
      const ctx = document.createElement("canvas").getContext("webgl2");
      ctx?.getExtension("WEBGL_lose_context")?.loseContext();
      return !!ctx;
    } catch {
      return false;
    }
  };
  const ensureGL = () => {
    if (loading) return;
    loading = true;
    if (!hasGL()) return;
    import("../strip")
      .then((m) => m.createStrip(stage, clips.map((li) => ({ key: li.dataset.key!, ratio: Number(li.dataset.ratio) || 16 / 9 })), film.reduced))
      .then((api) => {
        if (!api) return;
        gl = api;
        stage.classList.add("gl");
        gl.setOffset(offset);
        gl.setVisible(film.scenes[film.cur] === sc);
        schedulePlay();
        if (import.meta.env.DEV) (window as unknown as { __strip: StripApi }).__strip = api;
      })
      .catch(() => {});
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const soon = (fn: () => void, timeout: number) => (idle ? idle(fn, { timeout }) : window.setTimeout(fn, 1));
  film.onScene.push((s) => {
    // never on the scroll path: the probe and the import wait for an idle moment
    if (s.i >= sc.i - 3) soon(ensureGL, 400);
    gl?.setVisible(s === sc);
    if (s !== sc) gl?.play(null);
    if (s === sc && active < 0) setActive(0);
  });
  window.setTimeout(() => soon(ensureGL, 3000), 2500);

  projector.onOpen.push(() => schedulePlay());

  // ── drag the strip; click a frame to project it ──
  const framePx = () => (gl ? gl.framePx() : cellW) || 300;
  let down: { x: number; y: number; o: number; t: number; id: number } | null = null;
  let vel = 0;
  let lastX = 0;
  let lastT = 0;
  let dragging = false;

  const hit = (x: number, y: number) => {
    if (gl) return gl.pick(x, y);
    const el = document.elementFromPoint(x, y)?.closest(".strip-cell");
    return el ? cells.indexOf(el as HTMLDivElement) : -1;
  };
  const project = (i: number) => {
    const from = gl ? stage.getBoundingClientRect() : cells[i].getBoundingClientRect();
    const r = gl ? new DOMRect(from.left + from.width * 0.3, from.top + from.height * 0.2, from.width * 0.4, from.height * 0.6) : from;
    if (Math.round(offset) !== i) film.jumpTo(yFor(i), false);
    projector.open(items, i, r);
  };

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, o: offset, t: performance.now(), id: e.pointerId };
    vel = 0;
    lastX = e.clientX;
    lastT = down.t;
    dragging = false;
    film.pause();
    film.cancelJump();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!down) {
      if (e.pointerType === "mouse") stage.classList.toggle("over-frame", hit(e.clientX, e.clientY) >= 0);
      return;
    }
    const dx = e.clientX - down.x;
    if (!dragging && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - down.y)) {
      dragging = true;
      stage.setPointerCapture(down.id);
      stage.classList.add("dragging");
    }
    if (!dragging) return;
    const now = performance.now();
    const o = clamp(down.o - dx / framePx(), 0, N - 1);
    const dt = Math.max(1, now - lastT);
    vel = 0.8 * vel + 0.2 * ((-(e.clientX - lastX) / framePx()) / dt);
    lastX = e.clientX;
    lastT = now;
    film.jumpTo(yFor(o), false);
  });
  const end = (e: PointerEvent) => {
    if (!down) return;
    const wasDrag = dragging;
    const quick = performance.now() - down.t < 450;
    down = null;
    dragging = false;
    stage.classList.remove("dragging");
    if (wasDrag) {
      // a flick carries on a little, then lands on a frame
      const target = Math.round(clamp(offset + vel * 220, 0, N - 1));
      film.jumpTo(yFor(target));
    } else if (quick && e.type === "pointerup") {
      const i = hit(e.clientX, e.clientY);
      if (i >= 0) project(i);
    }
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  clips.forEach((li, i) => {
    li.querySelector(".project-btn")?.addEventListener("click", (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      projector.open(items, i, r);
    });
    // keyboard users land on a clip's links: bring that clip to the gate
    li.addEventListener("focusin", () => {
      if (film.scenes[film.cur] !== sc || Math.round(offset) !== i) film.jumpTo(yFor(i), false);
    });
  });

  return {
    /** ← / → inside the reel move a frame at a time */
    step(dir: 1 | -1) {
      const t = clamp(Math.round(offset) + dir, 0, N - 1);
      if (t === Math.round(offset)) return false;
      film.jumpTo(yFor(t));
      return true;
    },
  };
}
