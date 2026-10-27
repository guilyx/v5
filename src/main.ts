import "./styles.css";
import { Film } from "./film/film";
import { mountScrubber } from "./film/scrubber";
import { mountFootage } from "./film/footage";
import { mountGrain } from "./film/grain";
import { Projector, stillItem } from "./film/projector";
import { mountReel } from "./film/reel";

const film = new Film();
const projector = new Projector(film.reduced);
mountScrubber(film);
mountFootage(film);
const reel = mountReel(film, projector);

// behind the scenes: the contact sheet projects a still
const stills = Array.from(document.querySelectorAll<HTMLAnchorElement>("#sheet a"));
const stillItems = stills.map(stillItem);
stills.forEach((a, i) =>
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    projector.open(stillItems, i, a.getBoundingClientRect());
  }),
);

film.start();
mountGrain(film.reduced);

// when nothing has moved for a few seconds, the grain stops too (no compositor work at rest)
const root = document.documentElement;
let idleT = 0;
const wake = () => {
  root.classList.remove("idle");
  clearTimeout(idleT);
  idleT = window.setTimeout(() => {
    if (!film.playing) root.classList.add("idle");
    else wake();
  }, 6000);
};
for (const ev of ["scroll", "pointermove", "pointerdown", "keydown", "touchstart"]) addEventListener(ev, wake, { passive: true });
wake();

// Space plays the film; ← → cut between scenes (or frames, on the reel)
addEventListener("keydown", (e) => {
  if (projector.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement;
  const typing = t.closest("input, textarea, select, [contenteditable]");
  const pressable = t.closest("button, a, summary, video");
  if (e.key === " " && !typing && !pressable) {
    e.preventDefault();
    film.toggle();
    return;
  }
  if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !typing) {
    const dir = e.key === "ArrowRight" ? 1 : -1;
    film.pause();
    const s = film.scenes[film.cur];
    if (s.kind === "reel" && reel?.step(dir)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    film.step(dir);
  }
});

// tabbing into a scene that isn't on screen cuts to it
document.addEventListener("focusin", (e) => {
  const t = e.target as Element;
  if (t.closest("#clips")) return; // the reel brings its own clip to the gate
  const s = film.sceneOf(t);
  if (s && s.i !== film.cur) film.jumpTo(film.settle(s), false);
});

// in-page links cut to their scene
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a || a.classList.contains("skip")) return;
  const target = document.getElementById(a.hash.slice(1));
  const s = film.sceneOf(target);
  if (!s) return;
  e.preventDefault();
  film.pause();
  if (s.kind === "open") film.jumpTo(0);
  else film.jumpToScene(s.i);
  history.replaceState(null, "", a.hash === "#open" ? location.pathname : a.hash);
});
document.querySelector(".skip")?.addEventListener("click", (e) => {
  e.preventDefault();
  const s = film.scenes.find((x) => x.kind === "credits");
  if (s) film.jumpToScene(s.i, false);
  (document.getElementById("roll")?.querySelector("a") as HTMLElement | null)?.focus();
});

// arriving on a #hash
if (location.hash.length > 1) {
  const s = film.sceneOf(document.getElementById(location.hash.slice(1)));
  if (s) requestAnimationFrame(() => film.jumpToScene(s.i, false));
}

if (import.meta.env.DEV) (window as unknown as { __f: Film }).__f = film;
