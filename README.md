# elejeune.me — v5 · The Desk

Eight years in robotics, laid out on a desk.

![v5](public/og.jpg)

A long oak desk under tall windows. Scrolling slides along it from left to right,
2014 to now, and every chapter of the career is an object on it: the textbooks,
an STM32-style dev board, a maze with its little robot and two trophies, the two
preprints and a fountain pen, a toy trolley next to an in-store robot, a
quadcopter beside the IROS 2024 paper, three sticky notes (−74% CPU, −52%
bandwidth, team of 9), a microphone and a notepad for Kymatics, and the UMEX 2026
badge with a paper flock (*sirb*, Arabic for a flock). At the end of the desk: a
laptop that plays the side projects, his polaroids, a notebook, his card.

Hover an object and it lifts with its label. Click it and it comes up to you,
turning gently in your hand, with its story on a sheet of paper beside it. Escape
puts it back. Drag the desk to slide along it. The window light follows your
local time of day (the sun button changes it).

## How it's built

- **Page first.** `index.html` holds every word and link and reads fine with no
  JavaScript or no WebGL (the cards simply stack). The 3D never invents text: the
  paper you read while holding something is cloned from the page's own HTML.
- **3D second.** three.js is imported lazily after the first paint. Before it
  arrives the page already shows the cards on a plain oak background.
- **One soft sun.** A single shadow-casting directional light shines through a
  real window wall, so its glazing bars draw soft lines across the desk. The
  shadow map is not redrawn every frame: only when something moves (a lifted
  object, a change of light, or the camera travelling far enough along the desk).
- **Render on demand.** No frame is drawn unless something changed: scroll, the
  pointer, a spring, a video frame (via `requestVideoFrameCallback`). Idle, the
  page costs nothing.
- **Baked objects.** Every object is built from rounded boxes and lathes, then
  merged by material, so a station costs 25–45 draw calls.
- **Scroll is direct.** Scroll position maps straight to a place on the desk; a
  ~80 ms smoothing rounds the motion off. No scroll hijacking.

## Structure

```
index.html                 all the content
src/main.ts                fonts, page wiring, lazy-loads the desk
src/styles.css             paper, oak, ink: the whole design system
src/ui/                    photo viewer, clips that play in view, nav state
src/desk/index.ts          renderer, the frame loop, hover / pick up / drag
src/desk/rig.ts            the camera dolly: scroll → place on the desk
src/desk/light.ts          sun, sky and room light for each time of day
src/desk/world.ts          the desk, the window wall, the sky
src/desk/props.ts          what makes an object pickable
src/desk/hand.ts           the paper you read while holding something
src/desk/objects/*.ts      every object on the desk, chapter by chapter
public/work/               project clips (960px, 30 s loops) and posters
public/photos/             twelve photos at 800 and 1600px
```

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

Add `?perf` to the URL to expose `window.__desk.stats` (CPU time per frame, draw
calls, triangles). `?light=morning|midday|golden|evening` pins the light.

## Accessibility

- Every object can be picked up from its card with the keyboard ("Pick up …"
  buttons); focus moves to the story and comes back on Escape.
- Reduced motion: no smoothing, no swaying, no spinning props, clips only play
  when you open the laptop.
- The canvas is `aria-hidden`; all text is real HTML on solid paper.
