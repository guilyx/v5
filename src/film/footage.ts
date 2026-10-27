/**
 * The cold open: his photos, cut together as footage with slow Ken Burns moves.
 * One pass through the shots, then it rests on the first; it only runs while
 * the cold open is on screen, and not at all if you've asked for less motion.
 */
import type { Film } from "./film";

export function mountFootage(film: Film) {
  const shots = Array.from(document.querySelectorAll<HTMLElement>("#footage .shot"));
  const place = document.getElementById("shot-place")!;
  if (shots.length < 2) return;
  let cur = 0;
  let cuts = 0;
  let timer = 0;
  let live = true;

  const load = (fig: HTMLElement) =>
    new Promise<void>((res) => {
      const img = fig.querySelector("img")!;
      if (img.dataset.src) {
        img.addEventListener("load", () => res(), { once: true });
        img.addEventListener("error", () => res(), { once: true });
        img.srcset = img.dataset.srcset ?? "";
        img.src = img.dataset.src;
        delete img.dataset.src;
      } else if (img.complete) res();
      else img.addEventListener("load", () => res(), { once: true });
    });

  const cut = async (n: number) => {
    await load(shots[n]);
    if (!live) return;
    const out = shots[cur];
    out.classList.remove("is-on");
    out.classList.add("was-on");
    window.setTimeout(() => out.classList.remove("was-on"), 1800);
    shots[n].classList.add("is-on");
    cur = n;
    place.textContent = shots[n].dataset.place ?? "";
    cuts++;
    void load(shots[(n + 1) % shots.length]);
  };

  const schedule = () => {
    clearTimeout(timer);
    if (!live || document.hidden || film.reduced) return;
    if (cuts >= shots.length) return; // one pass, then rest on the first shot
    timer = window.setTimeout(() => void cut((cur + 1) % shots.length).then(schedule), 6200);
  };

  film.onScene.push((s) => {
    const was = live;
    live = s.kind === "open";
    if (live && !was) schedule();
    if (!live) clearTimeout(timer);
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? clearTimeout(timer) : schedule()));
  // fetch the second shot once the page has settled
  window.setTimeout(() => void load(shots[1]), 1500);
  schedule();
}
