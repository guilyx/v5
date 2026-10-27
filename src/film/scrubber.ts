/** The bottom letterbox bar: a timeline of the film you can click, drag and play. */
import type { Film } from "./film";

export function mountScrubber(film: Film) {
  const track = document.getElementById("track")!;
  const tc = document.getElementById("tc")!;
  const name = document.getElementById("scene-name")!;
  const play = document.getElementById("play")!;

  const segs = film.scenes.map((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg" + (s.kind === "act" ? " is-act" : "");
    b.setAttribute("aria-label", `Go to ${s.label}`);
    b.title = s.label;
    const l = document.createElement("span");
    l.className = "seg-label";
    l.textContent = s.short;
    b.appendChild(l);
    // keyboard activation (pointer taps are handled by the track below)
    b.addEventListener("click", (e) => {
      if (e.detail === 0) film.jumpToScene(s.i);
    });
    track.appendChild(b);
    return b;
  });
  const fill = document.createElement("div");
  fill.className = "track-fill";
  const head = document.createElement("div");
  head.className = "playhead";
  track.append(fill, head);

  let width = track.clientWidth;
  const size = () => {
    segs.forEach((b, i) => (b.style.flex = `${film.scenes[i].dur} 1 0`));
    width = track.clientWidth;
  };
  film.onLayout.push(size);
  new ResizeObserver(() => {
    width = track.clientWidth;
    film.queue();
  }).observe(track);

  // drag the playhead, or tap a scene to cut to it
  let down = false;
  let moved = false;
  let sx = 0;
  const yAt = (x: number) => {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * film.total;
  };
  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    down = true;
    moved = false;
    sx = e.clientX;
    track.setPointerCapture(e.pointerId);
    film.pause();
    film.cancelJump();
  });
  track.addEventListener("pointermove", (e) => {
    if (!down) return;
    if (Math.abs(e.clientX - sx) > 4) moved = true;
    if (moved) film.jumpTo(yAt(e.clientX), false);
  });
  track.addEventListener("pointerup", (e) => {
    if (!down) return;
    down = false;
    if (!moved) film.jumpToScene(film.indexAt(yAt(e.clientX)));
  });
  track.addEventListener("pointercancel", () => (down = false));

  let lastTc = "";
  let lastP = "";
  film.onFrame.push(() => {
    const p = film.y / film.total;
    const ps = p.toFixed(4);
    if (ps !== lastP) {
      lastP = ps;
      fill.style.setProperty("--p", ps);
      head.style.setProperty("--x", `${(p * width).toFixed(1)}px`);
    }
    const t = film.timecode();
    if (t !== lastTc) tc.textContent = lastTc = t;
  });
  film.onScene.push((s, prev) => {
    if (prev) segs[prev.i].classList.remove("is-on");
    segs[s.i].classList.add("is-on");
    segs[s.i].setAttribute("aria-current", "step");
    if (prev) segs[prev.i].removeAttribute("aria-current");
    name.textContent = s.label;
  });

  play.addEventListener("click", () => film.toggle());
  film.onPlayState.push((on) => {
    play.setAttribute("aria-pressed", String(on));
    play.setAttribute("aria-label", on ? "Pause the film (Space)" : "Play the film (Space)");
  });
}
