# elejeune.me — v5 · The Film

Eight years in robotics, told as a short film you scroll through.

![v5](public/og.jpg)

The scroll is the playhead. The site opens on a cold open: Erwin's own photos
cut together as footage, with slow Ken Burns moves, inside a letterboxed frame.
A shutter closes on the title card, *Eight years in robotics.*, and eight acts
follow, one per city and year, from *I. Nantes, 2014* to *VIII. Abu Dhabi, 2026*.
Each act has a title card, two or three plain lines, and a storyboard plate that
draws itself as you scroll: an oscilloscope, a virtual STM32, the maze, three
pathfinding agents, a supermarket robot, a flock, a topographic flight plan, a
swarm that heals itself.

The three dots of his mark carry the story between acts. They leave the logo in
the top bar, form the mark above the title, then become the wave's crests, the
chip's pins, the maze robot, the three agents, the lead birds, the drones, and
come back together for *Fin.* Every act change is a match cut on those dots.

After the acts, the reel: eight project clips on a strip of film that curls
through space in 3D. Scroll advances it frame by frame, like a projector's
pull-down; drag it to scrub; click a frame to project it big. Then a contact
sheet of his stills ("behind the scenes"), end credits that roll with the
scroll (roles, teams, papers, upstream work, writing), and *Fin.* with contact.

## How you move through it

- **Scroll** plays and rewinds. Nothing eases the scroll; the frame you see is
  the frame you scrolled to.
- **The timeline** in the bottom bar shows every scene. Click one to cut to it,
  or drag along it to scrub.
- **Space** plays the film on its own and lingers where there's something to
  read. Any scroll, swipe or key takes control back.
- **← →** cut to the previous or next scene (on the reel: the next frame).
- **The strip**: drag or swipe it sideways; click a frame (or "Project the
  clip") to open it in the projector. Esc closes.
- **Stills**: click any frame on the contact sheet to project it; ← → inside.

## How it's built

- **Content first.** `index.html` holds every word and link. Without
  JavaScript the scenes read top to bottom as a normal page; with it, an inline
  class flips the page into film mode before first paint.
- **One fixed screen.** Every scene is a layer in a fixed "screen" between two
  letterbox bars. The scroll position picks the scene and how far into it you
  are; CSS custom properties (`--in`, `--out`, `--t`) drive the reveals, so a
  frame of playhead is about 0.25 ms of script.
- **Storyboard plates** are small procedural SVGs (`src/film/plates.ts`), drawn
  with `stroke-dashoffset`; each plate also reports where the three dots sit.
- **The strip** (`src/strip/`) is three.js, loaded with `import()` in idle
  time, never on the first screen. The helix lives in the vertex shader, so
  moving the strip is one uniform. It renders only when something changes (the
  offset, the size, or a new frame of the clip in the gate, via
  `requestVideoFrameCallback`). 9 draw calls, 1,408 triangles, one `<video>`.
  Without WebGL 2 an HTML strip of posters does the same job, and three.js is
  never downloaded.
- **Grain** is four small noise canvases drawn once and cycled by a CSS
  `steps()` animation; it holds still when nothing has moved for six seconds.
- **Scenes more than one cut away** wait off-screen, so they cost nothing to
  paint and their images load only when you're one scene away.
- Respects `prefers-reduced-motion`: no Ken Burns, no grain, plates shown drawn,
  dots cut instead of flying, clips don't autoplay.

## Structure

```
index.html             every scene: cold open, title, eight acts, reel, stills, credits, fin
src/main.ts            wiring: keys, focus, links, stills projector, idle grain
src/styles.css         the theatre: brown-black, cream, one gold; base page + film mode
src/film/film.ts       scroll → playhead, scene choreography, the three dots, autoplay
src/film/plates.ts     the eight storyboard plates
src/film/scrubber.ts   the timeline in the bottom bar
src/film/footage.ts    the cold open's photo footage
src/film/reel.ts       the reel: HTML strip, drag/click, lazy 3D
src/film/projector.ts  the dialog that projects a clip or a still
src/film/grain.ts      film grain
src/strip/index.ts     the 3D film strip (three.js, lazy chunk)
public/                photos, project clips and posters, og.jpg
```

## Run it

```
npm ci
npm run dev       # http://localhost:5173
npm run build     # tsc --noEmit && vite build
```

In dev, `window.__film` reports the CPU time of each playhead update and
`window.__strip.stats()` the strip's draw calls, triangles and render time.
