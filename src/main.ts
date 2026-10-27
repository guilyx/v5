import "./styles.css";
import { H, ROOMS, W, WALL, buildMaze, idx, wallRuns } from "./maze/layout";
import type { MazeApi } from "./maze/world";

/*
 * The page works on its own: every word is in index.html. This file adds the maze on top:
 * the story panel, the map, the controls, and (lazily) the three.js world.
 */

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobileMq = matchMedia("(max-width: 860px)");
const perf = /[?&]perf\b/.test(location.search);
const maze = buildMaze();

const panel = document.getElementById("rooms") as HTMLElement;
const articles = Array.from(document.querySelectorAll<HTMLElement>(".room"));
const prevBtn = document.getElementById("prev") as HTMLButtonElement;
const nextBtn = document.getElementById("next") as HTMLButtonElement;
const count = document.getElementById("count")!;
const solveBtn = document.getElementById("solve") as HTMLButtonElement;
const viewBtn = document.getElementById("view-toggle") as HTMLButtonElement;
const mapBtn = document.getElementById("map-toggle") as HTMLButtonElement;
const grip = document.getElementById("sheet-grip") as HTMLButtonElement;
const stat = document.getElementById("stat")!;
const announce = document.getElementById("announce")!;
const hint = document.getElementById("hint")!;

let api: MazeApi | null = null;
let booting = false;
let current = 0;
let goal = -1;
let robot = { x: 0, z: 0, h: 0 };
const visited = new Set<number>([0]);
const isMaze = () => root.classList.contains("is-maze");

/* ------------------------------------------------------------------ the story panel */

function showRoom(i: number) {
  current = i;
  visited.add(i);
  articles.forEach((a, k) => a.classList.toggle("is-active", k === i));
  const r = ROOMS[i];
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i === ROOMS.length - 1;
  prevBtn.querySelector(".nav-name")!.textContent = i > 0 ? ROOMS[i - 1].short : "";
  nextBtn.querySelector(".nav-name")!.textContent = i < ROOMS.length - 1 ? ROOMS[i + 1].short : "";
  prevBtn.setAttribute("aria-label", i > 0 ? `Drive to ${ROOMS[i - 1].short}` : "No previous room");
  nextBtn.setAttribute("aria-label", i < ROOMS.length - 1 ? `Drive to ${ROOMS[i + 1].short}` : "No next room");
  count.textContent = i === 0 ? "Start" : `Room ${i} of ${ROOMS.length - 1}`;
  panel.scrollTop = 0;
  if (isMaze()) {
    announce.textContent = `Entered ${r.short}.`;
    setSheet(false);
  }
  drawMap();
}

prevBtn.addEventListener("click", () => go(current - 1));
nextBtn.addEventListener("click", () => go(current + 1));

function go(i: number) {
  i = Math.max(0, Math.min(ROOMS.length - 1, i));
  if (api) api.goRoom(i);
  else showRoom(i);
}

/* ------------------------------------------------------------------ mobile bottom sheet */

function setSheet(open: boolean) {
  if (!mobileMq.matches) return;
  root.classList.toggle("sheet-open", open);
  grip.setAttribute("aria-expanded", String(open));
  if (!open) panel.scrollTop = 0;
  // the 3D view keeps the robot centred in whatever is left above the sheet
  setTimeout(() => api?.layout(), 340);
}
grip.addEventListener("click", () => setSheet(!root.classList.contains("sheet-open")));
panel.addEventListener("click", (e) => {
  if (!mobileMq.matches || root.classList.contains("sheet-open")) return;
  if ((e.target as HTMLElement).closest("a, button")) return;
  setSheet(true);
});

/* ------------------------------------------------------------------ list view / maze view */

function setView(view: "maze" | "list") {
  root.classList.toggle("is-maze", view === "maze");
  root.classList.toggle("is-list", view === "list");
  labels();
  try {
    localStorage.setItem("maze-view", view);
  } catch {
    /* private mode */
  }
  if (view === "maze") {
    showRoom(current);
    if (!api) void boot();
    else {
      api.pause(false);
      api.layout();
    }
  } else {
    api?.pause(true);
    articles.forEach((a) => a.classList.remove("is-active"));
    root.classList.remove("sheet-open", "map-open");
    const target = articles[current];
    if (current > 0) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }
  wireListVideos(view === "list");
}
viewBtn.addEventListener("click", () => setView(isMaze() ? "list" : "maze"));
document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.action === "list") setView("list");
    if (b.dataset.action === "solve") api?.solve(true);
  }),
);
document.querySelector<HTMLAnchorElement>(".brand")!.addEventListener("click", (e) => {
  if (!isMaze()) return;
  e.preventDefault();
  go(0);
});

/* ------------------------------------------------------------------ Solve */

/** button words: short on a phone, full on a desktop */
function labels() {
  const small = mobileMq.matches;
  const on = solveBtn.getAttribute("aria-pressed") === "true";
  solveBtn.querySelector(".solve-label")!.textContent = on ? (small ? "Pause" : "Pause the tour") : small ? "Solve" : "Solve the maze";
  viewBtn.textContent = isMaze() ? (small ? "List" : "List view") : small ? "Maze" : "Maze view";
  viewBtn.setAttribute("aria-label", isMaze() ? "Switch to the list view" : "Switch to the maze view");
}
mobileMq.addEventListener("change", labels);

solveBtn.addEventListener("click", () => api?.solve(solveBtn.getAttribute("aria-pressed") !== "true"));

/* ------------------------------------------------------------------ the map */

const mm = document.getElementById("minimap")!;
const mmCanvas = mm.querySelector("canvas")!;
const mmCtx = mmCanvas.getContext("2d")!;
const mmBase = document.createElement("canvas");
let mmScale = 5;

function paintMapBase() {
  const cssW = mm.clientWidth || 285;
  mmScale = cssW / W;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [mmCanvas, mmBase]) {
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(((cssW * H) / W) * dpr);
  }
  const k = mmBase.getContext("2d")!;
  k.setTransform(dpr * mmScale, 0, 0, dpr * mmScale, 0, 0);
  k.fillStyle = "#f8f3e9";
  k.fillRect(0, 0, W, H);
  ROOMS.forEach((r) => {
    k.fillStyle = r.id === "hiventive" ? "#4a4c53" : r.tint;
    k.fillRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
  });
  const runs = wallRuns(W, H, (x, y) => x >= 0 && y >= 0 && x < W && y < H && maze.grid[idx(x, y)] === WALL, () => 0, 0.5);
  k.fillStyle = "#c79466";
  for (const b of runs) k.fillRect(b.cx - b.sx / 2, b.cz - b.sz / 2, b.sx, b.sz);
  k.textAlign = "center";
  k.textBaseline = "middle";
  ROOMS.forEach((r, i) => {
    if (!i) return;
    k.font = `700 ${11 / mmScale}px "Geist Variable", system-ui, sans-serif`;
    k.fillStyle = r.id === "hiventive" ? "#f0d28c" : r.ink;
    k.fillText(String(i).padStart(2, "0"), r.x + r.w / 2, r.y + r.h / 2);
  });
  // room buttons over the map, for keyboard and screen readers too
  const holder = document.getElementById("mm-rooms")!;
  holder.innerHTML = "";
  ROOMS.forEach((r, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.name = r.short;
    b.setAttribute("aria-label", `Drive to ${r.short}`);
    Object.assign(b.style, {
      left: `${((r.x - 0.5) / W) * 100}%`,
      top: `${((r.y - 0.5) / H) * 100}%`,
      width: `${((r.w + 1) / W) * 100}%`,
      height: `${((r.h + 1) / H) * 100}%`,
    });
    b.addEventListener("click", () => {
      go(i);
      if (mobileMq.matches) toggleMap(false);
    });
    holder.appendChild(b);
  });
}

let mapQueued = false;
function drawMap() {
  if (mapQueued) return;
  mapQueued = true;
  requestAnimationFrame(() => {
    mapQueued = false;
    const dpr = mmCanvas.width / (mm.clientWidth || 285);
    mmCtx.setTransform(1, 0, 0, 1, 0, 0);
    mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
    mmCtx.drawImage(mmBase, 0, 0);
    mmCtx.setTransform(dpr * mmScale, 0, 0, dpr * mmScale, 0, 0);
    const r = ROOMS[current];
    mmCtx.strokeStyle = "#2b2118";
    mmCtx.lineWidth = 0.45;
    mmCtx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
    if (goal >= 0 && goal !== current) {
      const g = ROOMS[goal];
      mmCtx.strokeStyle = "#3a6bf0";
      mmCtx.setLineDash([1, 0.8]);
      mmCtx.strokeRect(g.x - 0.5, g.y - 0.5, g.w + 1, g.h + 1);
      mmCtx.setLineDash([]);
    }
    const x = robot.x + W / 2;
    const y = robot.z + H / 2;
    mmCtx.fillStyle = "#e4572e";
    mmCtx.beginPath();
    mmCtx.arc(x, y, 0.95, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.strokeStyle = "#fffaf1";
    mmCtx.lineWidth = 0.35;
    mmCtx.stroke();
    mmCtx.beginPath();
    mmCtx.moveTo(x, y);
    mmCtx.lineTo(x + Math.cos(robot.h) * 1.6, y + Math.sin(robot.h) * 1.6);
    mmCtx.strokeStyle = "#e4572e";
    mmCtx.lineWidth = 0.4;
    mmCtx.stroke();
  });
}
mmCanvas.addEventListener("click", (e) => {
  if (!api) return;
  const rect = mmCanvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * W);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * H);
  api.goCell(x, y);
  if (mobileMq.matches) toggleMap(false);
});

function toggleMap(open?: boolean) {
  const o = open ?? !root.classList.contains("map-open");
  root.classList.toggle("map-open", o);
  mapBtn.setAttribute("aria-expanded", String(o));
  if (o) {
    paintMapBase();
    drawMap();
  }
}
mapBtn.addEventListener("click", () => toggleMap());

/* ------------------------------------------------------------------ scroll, swipe and keys drive the tour */

let acc = 0;
let lockUntil = 0;
let lastWheel = 0;
let panelScrolledAt = 0;
window.addEventListener(
  "wheel",
  (e) => {
    if (!isMaze() || !api || e.ctrlKey) return;
    const now = performance.now();
    const inPanel = (e.target as HTMLElement).closest?.("#rooms");
    if (inPanel && !mobileMq.matches) {
      const atTop = panel.scrollTop <= 0;
      const atEnd = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;
      if ((e.deltaY > 0 && !atEnd) || (e.deltaY < 0 && !atTop)) {
        panelScrolledAt = now;
        acc = 0;
        return;
      }
      // reached the end of the story: the rest of this gesture is spent, the next one moves on
      if (now - panelScrolledAt < 380) {
        panelScrolledAt = now;
        e.preventDefault();
        return;
      }
    }
    e.preventDefault();
    if (now - lastWheel > 220) acc = 0;
    lastWheel = now;
    if (now < lockUntil) {
      lockUntil = Math.max(lockUntil, now + 160);
      return;
    }
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    acc += dy;
    if (Math.abs(acc) > 36) {
      api.step(acc > 0 ? 1 : -1);
      acc = 0;
      lockUntil = now + 520;
      hideHint();
    }
  },
  { passive: false },
);

const held = new Set<string>();
const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};
function pushKeys() {
  let x = 0;
  let y = 0;
  held.forEach((k) => {
    x += KEYS[k][0];
    y += KEYS[k][1];
  });
  api?.keys(Math.sign(x), Math.sign(y));
}
window.addEventListener("keydown", (e) => {
  if (!isMaze() || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select, dialog")) return;
  const inPanel = !!t.closest("#rooms");
  if (e.code === "Escape") {
    toggleMap(false);
    setSheet(false);
    return;
  }
  if (KEYS[e.code]) {
    // up/down inside the story panel scroll it, as you'd expect
    if (inPanel && (e.code === "ArrowUp" || e.code === "ArrowDown")) return;
    e.preventDefault();
    if (!held.has(e.code)) {
      held.add(e.code);
      pushKeys();
      hideHint();
    }
    return;
  }
  const onControl = !!t.closest("a, button");
  if (e.code === "PageDown" || (e.code === "Space" && !onControl && !inPanel) || e.code === "KeyN") {
    e.preventDefault();
    api?.step(1);
  } else if (e.code === "PageUp" || e.code === "KeyP") {
    e.preventDefault();
    api?.step(-1);
  }
});
window.addEventListener("keyup", (e) => {
  if (held.delete(e.code)) pushKeys();
});
window.addEventListener("blur", () => {
  held.clear();
  pushKeys();
});

/* ------------------------------------------------------------------ hint */

let hintTimer = 0;
function hideHint() {
  hint.classList.remove("show");
  clearTimeout(hintTimer);
}

/* ------------------------------------------------------------------ photos: a simple viewer */

const viewer = document.querySelector<HTMLDialogElement>(".viewer")!;
const vImg = viewer.querySelector("img")!;
const vCap = viewer.querySelector(".viewer-cap")!;
const photoLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("#photo-grid a"));
let photoAt = 0;
function showPhoto(i: number) {
  photoAt = (i + photoLinks.length) % photoLinks.length;
  const a = photoLinks[photoAt];
  vImg.src = a.href;
  vImg.alt = a.querySelector("img")!.alt;
  vCap.textContent = a.dataset.caption ?? "";
  if (!viewer.open) viewer.showModal();
}
photoLinks.forEach((a, i) =>
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    showPhoto(i);
  }),
);
viewer.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((b) => b.addEventListener("click", () => showPhoto(photoAt + Number(b.dataset.dir))));
viewer.querySelector(".viewer-close")!.addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (e) => {
  if (e.target === viewer) viewer.close();
});
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") showPhoto(photoAt + 1);
  if (e.key === "ArrowLeft") showPhoto(photoAt - 1);
});

/* ------------------------------------------------------------------ project clips in the page */

const cardVideos = Array.from(document.querySelectorAll<HTMLVideoElement>(".card video"));
const load = (v: HTMLVideoElement) => {
  if (!v.src && v.dataset.src) v.src = v.dataset.src;
};
let io: IntersectionObserver | null = null;
function wireListVideos(on: boolean) {
  io?.disconnect();
  io = null;
  cardVideos.forEach((v) => v.pause());
  if (!on || reduced) return;
  io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting) {
          load(v);
          v.play().catch(() => {});
        } else v.pause();
      }
    },
    { threshold: 0.6 },
  );
  cardVideos.forEach((v) => io!.observe(v));
}
// in the panel, a clip plays while you point at it
cardVideos.forEach((v) => {
  const card = v.closest(".card")!;
  card.addEventListener("pointerenter", () => {
    if (isMaze() && !reduced) {
      load(v);
      v.play().catch(() => {});
    }
  });
  card.addEventListener("pointerleave", () => isMaze() && v.pause());
});

/* ------------------------------------------------------------------ the maze */

function insets() {
  if (!isMaze()) return { right: 0, bottom: 0, top: 0 };
  if (mobileMq.matches) {
    // keep the robot in whatever strip of maze is left above the sheet
    return { right: 0, bottom: panel.offsetHeight + 8, top: 60 };
  }
  return { right: panel.offsetWidth + 18, bottom: 0, top: 40 };
}

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

async function boot() {
  if (booting) return;
  booting = true;
  if (!webglOk()) {
    root.classList.add("no-webgl");
    setView("list");
    return;
  }
  await Promise.all([
    document.fonts.load('italic 400 100px "Instrument Serif"'),
    document.fonts.load('600 100px "Geist Variable"'),
  ]).catch(() => {});
  const { startMaze } = await import("./maze/world");
  const linked = /^#room-(\w+)/.exec(location.hash);
  const startRoom = Math.max(0, linked ? ROOMS.findIndex((r) => r.id === linked[1]) : 0);
  const canvas = document.getElementById("maze") as HTMLCanvasElement;
  try {
    api = startMaze(
      canvas,
      maze,
      { reduced, insets, startRoom, mobile: mobileMq.matches || matchMedia("(pointer: coarse)").matches },
      {
        room: (i) => showRoom(i),
        pose: (x, z, h) => {
          robot = { x, z, h };
          drawMap();
        },
        plan: ({ expanded, steps, room, preview }) => {
          stat.textContent = `A* · ${expanded} cells searched · ${steps} steps`;
          if (preview) return;
          goal = room;
          if (room >= 0) announce.textContent = `Driving to ${ROOMS[room].short}.`;
          hideHint();
          drawMap();
        },
        arrive: () => {
          goal = -1;
          drawMap();
        },
        autopilot: (on, p) => {
          solveBtn.setAttribute("aria-pressed", String(on));
          labels();
          solveBtn.style.setProperty("--p", String(on ? p : 0));
        },
        photo: (i) => showPhoto(i),
        project: (key) => {
          document.querySelectorAll(".card").forEach((c) => c.classList.toggle("is-playing", (c as HTMLElement).dataset.key === key));
        },
      },
    );
  } catch (err) {
    console.warn("The maze could not start, showing the list instead.", err);
    root.classList.add("no-webgl");
    setView("list");
    return;
  }
  root.classList.add("maze-ready");
  if (!isMaze()) api.pause(true);
  hint.classList.add("show");
  hintTimer = window.setTimeout(hideHint, 9000);
  if (perf) startPerf();
}

function startPerf() {
  const box = document.createElement("pre");
  Object.assign(box.style, {
    position: "fixed",
    left: "10px",
    top: "70px",
    zIndex: "40",
    margin: "0",
    padding: "8px 10px",
    background: "rgba(43,33,24,.85)",
    color: "#fffaf1",
    font: "13px/1.4 ui-monospace, monospace",
    borderRadius: "8px",
  });
  document.body.appendChild(box);
  (window as unknown as { __maze: MazeApi | null }).__maze = api;
  setInterval(() => {
    if (!api) return;
    const s = api.stats();
    box.textContent = `update ${s.upd.toFixed(2)} ms · frame ${s.cpu.toFixed(1)} ms\ncalls ${s.calls}  tris ${s.tris}\ndpr ${s.dpr}  frames ${s.frames}`;
  }, 500);
}

/* ------------------------------------------------------------------ start */

paintMapBase();
showRoom(0);
window.addEventListener("resize", () => {
  paintMapBase();
  drawMap();
});
labels();
if (isMaze()) {
  void boot();
} else {
  wireListVideos(true);
  if (!webglOk()) root.classList.add("no-webgl");
}
