import "./styles.css";
import { H, ROOMS, W, WALL, buildMaze, idx, wallRuns } from "./maze/layout";
import type { Feed, HoverInfo, MazeApi, MotionState, PlanRow, View } from "./maze/world";
import type { IxAction, PddlView } from "./maze/tasks";
import type { PlanKind } from "./maze/modal";

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
const flyBtn = document.getElementById("fly-btn") as HTMLButtonElement;
const viewBtn2 = document.getElementById("view-btn") as HTMLButtonElement;
const sensorsBtn = document.getElementById("sensors-btn") as HTMLButtonElement;
const sensorsPanel = document.getElementById("sensors") as HTMLElement;
const pip = document.getElementById("pip") as HTMLElement;
const pipLabel = document.getElementById("pip-label")!;
const toast = document.getElementById("toast")!;
const dockMode = document.getElementById("dock-mode")!;
const planNote = document.getElementById("plan-note")!;
const planRows = Array.from(document.querySelectorAll<HTMLButtonElement>(".plan-row"));
const pref = document.getElementById("pref") as HTMLInputElement;

let api: MazeApi | null = null;
let booting = false;
let current = 0;
let goal = -1;
let robot = { x: 0, z: 0, h: 0, fly: false };
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
    closeCard();
    toggleSensors(false);
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
    const col = robot.fly ? "#e8850f" : "#e4572e";
    mmCtx.fillStyle = col;
    mmCtx.beginPath();
    mmCtx.arc(x, y, 0.95, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.strokeStyle = "#fffaf1";
    mmCtx.lineWidth = 0.35;
    mmCtx.stroke();
    mmCtx.beginPath();
    mmCtx.moveTo(x, y);
    mmCtx.lineTo(x + Math.cos(robot.h) * 1.6, y + Math.sin(robot.h) * 1.6);
    mmCtx.strokeStyle = col;
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
    closeCard();
    toggleSensors(false);
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
  if (e.code === "KeyF" && !e.repeat) {
    e.preventDefault();
    api?.fly();
    hideHint();
    return;
  }
  if (e.code === "KeyC" && !e.repeat) {
    e.preventDefault();
    setCost(!costOn);
    return;
  }
  if (e.code === "KeyV" && !e.repeat) {
    e.preventDefault();
    chooseView(VIEWS[(VIEWS.indexOf(viewNow) + 1) % VIEWS.length]);
    return;
  }
  if (e.code === "KeyL" && !e.repeat) {
    e.preventDefault();
    setSensor("lidar", !sensorsOn.lidar);
    return;
  }
  if (e.code === "KeyB" && !e.repeat) {
    e.preventDefault();
    setSensor("detect", !sensorsOn.detect);
    return;
  }
  if (e.code === "KeyZ" && !e.repeat) {
    e.preventDefault();
    setFeed(FEEDS[(FEEDS.indexOf(feedNow) + 1) % FEEDS.length]);
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

/* ------------------------------------------------------------------ M4: planner table, fly and costmap */

const KIND_LABEL: Record<PlanKind, string> = { hybrid: "Hybrid", roll: "Roll-only", fly: "Fly-only" };
let kind: PlanKind = "hybrid";
let costOn = true;

function setKind(k: PlanKind) {
  kind = k;
  planRows.forEach((r) => r.setAttribute("aria-checked", String(r.dataset.kind === k)));
  api?.setKind(k);
}
planRows.forEach((r) => r.addEventListener("click", () => setKind(r.dataset.kind as PlanKind)));
// arrow keys move between the radio rows, as a radio group should
planRows.forEach((r, i) =>
  r.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const n = planRows[(i + (e.key === "ArrowDown" ? 1 : planRows.length - 1)) % planRows.length];
    n.focus();
    setKind(n.dataset.kind as PlanKind);
  }),
);
pref.addEventListener("input", () => api?.setPref(Number(pref.value) / 100));

function showRows(rows: Record<PlanKind, PlanRow | null>, chosen: PlanKind, preview: boolean) {
  planNote.textContent = preview ? "Preview" : `Driving: ${KIND_LABEL[chosen]}`;
  let best = Infinity;
  for (const r of Object.values(rows)) if (r) best = Math.min(best, r.time);
  for (const el of planRows) {
    const r = rows[el.dataset.kind as PlanKind];
    const f = (k: string) => el.querySelector<HTMLElement>(`[data-f="${k}"]`)!;
    el.classList.toggle("is-none", !r);
    el.classList.toggle("is-used", el.dataset.kind === chosen);
    f("time").textContent = r ? `${r.time.toFixed(1)} s` : "no path";
    f("energy").textContent = r ? String(Math.round(r.energy)) : "";
    f("morphs").textContent = r ? String(r.morphs) : "";
    f("time").classList.toggle("is-best", !!r && r.time === best);
  }
}

const MODE_LABEL: Record<MotionState, string> = { roll: "Rolling", fly: "Flying", takeoff: "Taking off", landing: "Landing" };
function showMode(m: MotionState) {
  dockMode.dataset.state = m;
  dockMode.querySelector(".dm-label")!.textContent = MODE_LABEL[m];
  const air = m === "fly";
  flyBtn.querySelector(".db-label")!.textContent = air || m === "takeoff" ? "Land" : "Fly";
  flyBtn.setAttribute("aria-pressed", String(air));
  flyBtn.disabled = m === "takeoff" || m === "landing";
  if (isMaze()) announce.textContent = `${MODE_LABEL[m]}.`;
}
flyBtn.addEventListener("click", () => {
  api?.fly();
  hideHint();
});
function setCost(on: boolean) {
  costOn = on;
  sensorSwitch("cost").setAttribute("aria-pressed", String(on));
  root.classList.toggle("costmap-on", on);
  api?.costmap(on);
}
root.classList.add("costmap-on");

/* ------------------------------------------------------------------ views and sensors */

const VIEWS: View[] = ["top", "chase", "fpv"];
const VIEW_LABEL: Record<View, string> = { top: "Top", chase: "Chase", fpv: "First person" };
const VIEW_HELP: Record<View, string> = {
  top: "Top view.",
  chase: "Chase view: W and S drive, A and D turn.",
  fpv: "First person: W and S drive, A and D turn. Click the floor to go there.",
};
const FEEDS: Feed[] = ["off", "rgb", "depth"];
let viewNow: View = "top";
let feedNow: Feed = "off";
const sensorsOn = { lidar: true, detect: false };
const sensorSwitch = (name: string) => sensorsPanel.querySelector<HTMLButtonElement>(`[data-sensor="${name}"]`)!;
let toastTimer = 0;

function showToast(text: string) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3800);
}
/** the world says which view it's in (it may have changed from a key) */
function viewChanged(v: View) {
  viewNow = v;
  root.dataset.view = v;
  viewBtn2.querySelector(".db-label")!.textContent = mobileMq.matches && v === "fpv" ? "FPV" : VIEW_LABEL[v];
  viewBtn2.setAttribute("aria-label", `View: ${VIEW_LABEL[v]}. Switch view`);
  sensorsPanel.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === v)));
  if (isMaze()) {
    announce.textContent = VIEW_HELP[v];
    if (v !== "top") showToast(mobileMq.matches || matchMedia("(hover: none)").matches ? "Tap the floor to drive · V or View to switch" : VIEW_HELP[v]);
    else toast.classList.remove("show");
  }
}
function chooseView(v: View) {
  api?.setView(v);
  hideHint();
}
function setSensor(name: "lidar" | "detect", on: boolean) {
  sensorsOn[name] = on;
  sensorSwitch(name).setAttribute("aria-pressed", String(on));
  api?.sensor(name, on);
  if (isMaze()) announce.textContent = `${name === "lidar" ? "LiDAR" : "Object detection"} ${on ? "on" : "off"}.`;
}
function setFeed(f: Feed) {
  feedNow = f;
  sensorsPanel.querySelectorAll<HTMLButtonElement>("[data-feed]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.feed === f)));
  pip.hidden = f === "off";
  pip.dataset.feed = f;
  pipLabel.textContent = f === "depth" ? "Depth · robot camera" : "Robot camera";
  api?.feed(f);
  if (isMaze()) announce.textContent = f === "off" ? "Robot camera window closed." : `Robot camera: ${f === "depth" ? "depth" : "colour"}.`;
}
function toggleSensors(open?: boolean) {
  const o = open ?? sensorsPanel.hidden;
  sensorsPanel.hidden = !o;
  sensorsBtn.setAttribute("aria-expanded", String(o));
}
viewBtn2.addEventListener("click", () => chooseView(VIEWS[(VIEWS.indexOf(viewNow) + 1) % VIEWS.length]));
sensorsBtn.addEventListener("click", () => toggleSensors());
sensorsPanel.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.addEventListener("click", () => chooseView(b.dataset.view as View)));
sensorsPanel.querySelectorAll<HTMLButtonElement>("[data-feed]").forEach((b) => b.addEventListener("click", () => setFeed(b.dataset.feed as Feed)));
sensorsPanel.querySelectorAll<HTMLButtonElement>("[data-sensor]").forEach((b) =>
  b.addEventListener("click", () => {
    const name = b.dataset.sensor!;
    if (name === "cost") setCost(!costOn);
    else setSensor(name as "lidar" | "detect", !sensorsOn[name as "lidar" | "detect"]);
  }),
);
// the panel closes when you click anywhere else
document.addEventListener("pointerdown", (e) => {
  if (sensorsPanel.hidden) return;
  const t = e.target as HTMLElement;
  if (!t.closest("#sensors, #sensors-btn")) toggleSensors(false);
});

/* ------------------------------------------------------------------ things to do with objects */

const ixCard = document.getElementById("ixcard") as HTMLElement;
const ixName = document.getElementById("ix-name")!;
const ixChip = document.getElementById("ix-chip")!;
const ixBlurb = document.getElementById("ix-blurb")!;
const ixActions = document.getElementById("ix-actions")!;
const tryBoxes = Array.from(document.querySelectorAll<HTMLElement>(".try[data-ix]"));
let card: HoverInfo | null = null;
let cardOver = false;
let hideTimer = 0;
let cardRaf = 0;

/** the buttons for what you can do with an object; rebuilt only when the choices change */
function actionButtons(holder: HTMLElement, id: string, acts: IxAction[], inCard: boolean) {
  const sig = acts.map((a) => `${a.id}:${a.label}`).join(",");
  if (holder.dataset.sig === sig) return;
  holder.dataset.sig = sig;
  const hadFocus = holder.contains(document.activeElement);
  holder.replaceChildren(
    ...acts.map((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn btn-sm ${a.primary ? "btn-solve-inline" : "btn-quiet"}`;
      b.textContent = a.label;
      b.addEventListener("click", () => {
        api?.run(id, a.id);
        hideHint();
        // from the story sheet on a phone: get out of the way so you can watch
        if (!inCard) setSheet(false);
      });
      return b;
    }),
  );
  if (hadFocus) (holder.firstElementChild as HTMLElement | null)?.focus();
}

function refreshActions() {
  if (!api) return;
  for (const box of tryBoxes) {
    const id = box.dataset.ix!;
    actionButtons(box.querySelector<HTMLElement>(".try-actions")!, id, api.actions(id), false);
  }
  if (card) actionButtons(ixActions, card.id, api.actions(card.id), true);
}

function showCard(info: HoverInfo | null) {
  clearTimeout(hideTimer);
  if (!info) {
    // a moment's grace, so the pointer can travel from the object onto the card
    hideTimer = window.setTimeout(() => {
      if (!cardOver) closeCard();
    }, 260);
    return;
  }
  card = info;
  ixName.textContent = info.name;
  ixChip.textContent = info.kind === "active" ? "Active" : "Passive";
  ixChip.className = `chip chip-${info.kind}`;
  ixBlurb.textContent = info.blurb;
  actionButtons(ixActions, info.id, info.actions, true);
  ixCard.hidden = false;
  placeCard();
}
function closeCard() {
  card = null;
  cardOver = false;
  ixCard.hidden = true;
  cancelAnimationFrame(cardRaf);
  cardRaf = 0;
}
/** the card rides above its object as the camera moves */
function placeCard() {
  cancelAnimationFrame(cardRaf);
  cardRaf = 0;
  if (!card || !api) return;
  const p = api.anchor(card.id);
  ixCard.style.visibility = p ? "" : "hidden";
  if (p) {
    const w = ixCard.offsetWidth;
    const h = ixCard.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, p.x - w / 2));
    const y = Math.max(70, Math.min(innerHeight - h - 8, p.y - h - 16));
    ixCard.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  cardRaf = requestAnimationFrame(placeCard);
}
ixCard.addEventListener("pointerenter", () => {
  cardOver = true;
  clearTimeout(hideTimer);
});
ixCard.addEventListener("pointerleave", (e) => {
  cardOver = false;
  if (e.pointerType === "mouse") showCard(null);
});

/* the blocks world's planner, live: state, goal, plan, and the PDDL it read */
const pddlInit = document.getElementById("pddl-init")!;
const pddlGoal = document.getElementById("pddl-goal")!;
const pddlPlan = document.getElementById("pddl-plan")!;
const pddlStats = document.getElementById("pddl-stats")!;
const pddlDomain = document.getElementById("pddl-domain")!;
const pddlProblem = document.getElementById("pddl-problem")!;
let pddlNote = "";

function drawStacks(el: HTMLElement, st: string[][]) {
  el.replaceChildren(
    ...st.map((s) => {
      const col = document.createElement("span");
      col.className = "stack";
      for (const b of s) {
        const k = document.createElement("b");
        k.className = `blk blk-${b}`;
        k.textContent = b.toUpperCase();
        col.appendChild(k);
      }
      return col;
    }),
  );
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", st.map((s) => s.slice().reverse().map((b) => b.toUpperCase()).join(" on ")).join("; ") + "; on the table");
}

function showPddl(v: PddlView) {
  drawStacks(pddlInit, v.init);
  drawStacks(pddlGoal, v.goal);
  pddlPlan.replaceChildren(
    ...v.plan.map((p) => {
      const li = document.createElement("li");
      li.textContent = p.text;
      li.className = `is-${p.state}`;
      if (p.state === "now") li.setAttribute("aria-current", "step");
      return li;
    }),
  );
  pddlPlan.hidden = !v.plan.length;
  const parts: string[] = [];
  if (v.plan.length) parts.push(`${v.plan.length} actions, optimal`);
  if (v.expanded) parts.push(`A* with h_max: ${v.expanded} states expanded, ${v.grounded} ground actions, ${v.facts} facts`);
  pddlStats.textContent = [v.note, parts.join(" · ")].filter(Boolean).join(" ");
  pddlDomain.textContent = v.domain;
  pddlProblem.textContent = v.problem;
  if (v.note && v.note !== pddlNote && isMaze()) announce.textContent = v.note;
  pddlNote = v.note;
}

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
      {
        reduced,
        insets,
        startRoom,
        mobile: mobileMq.matches || matchMedia("(pointer: coarse)").matches,
        overlay: document.getElementById("overlay") as HTMLCanvasElement,
        pip,
      },
      {
        room: (i) => showRoom(i),
        pose: (x, z, h, fly) => {
          robot = { x, z, h, fly };
          drawMap();
        },
        plans: ({ rows, chosen, preview }) => showRows(rows, chosen, preview),
        mode: (m) => showMode(m),
        plan: ({ expanded, room, preview, kind: k }) => {
          stat.textContent = `${KIND_LABEL[k]} A* · ${expanded} states`;
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
        hover: (info) => showCard(info),
        tasks: () => refreshActions(),
        pddl: (v) => showPddl(v),
        view: (v) => viewChanged(v),
      },
    );
  } catch (err) {
    console.warn("The maze could not start, showing the list instead.", err);
    root.classList.add("no-webgl");
    setView("list");
    return;
  }
  root.classList.add("maze-ready");
  refreshActions();
  api.setPref(Number(pref.value) / 100);
  if (kind !== "hybrid") api.setKind(kind);
  if (!costOn) api.costmap(false);
  if (!sensorsOn.lidar) api.sensor("lidar", false);
  if (sensorsOn.detect) api.sensor("detect", true);
  if (feedNow !== "off") api.feed(feedNow);
  if (viewNow !== "top") api.setView(viewNow);
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
