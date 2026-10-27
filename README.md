# elejeune.me — v5 · Tiny City

Eight years of robotics as a miniature city on a turntable.

![v5](public/og.jpg)

Five little islands sit in a lagoon on a clay turntable: Nantes, Bordeaux,
Coimbra, Odense and Abu Dhabi, plus a small "remote work & home" islet, joined
by arched bridges. Scroll, and the table turns to each place in order while a
building springs up out of toy blocks, and the light moves from a dawn in 2014
to tonight. At the end the whole city is lit up and you can turn it and open
any building.

| Stop | Place | What lands on the table |
| :--- | :--- | :--- |
| 01 | Nantes · 2014–2018 | Nantes Université, with columns and a flag |
| 02 | Bordeaux · 2018–2019 | Hiventive's office with a giant STM32-style chip on the roof; Ynov with a little plane |
| 03 | Coimbra · 2019 | A hedge maze on the hill, a robot that keeps solving it, two trophies |
| 04 | Nantes · 2019–2021 | Centrale Nantes: three agents sharing a rooftop grid, an inverted pendulum out front |
| 05 | Odense · 2021–2022 | A cut-away supermarket; the robot's light changes as it passes the trolley |
| 06 | Abu Dhabi · 2022–2024 | TII's twisting tower with a flock of drones circling it |
| 07 | Abu Dhabi · 2024–2026 | The team building: nine people on the plaza, M4 rolling and flying on the roof |
| 08 | Remote · 2024–now | Unchained Labs' workshop, a graph of agents on the roof, jobs leaving on a conveyor |
| 09 | Abu Dhabi · 2026–now | SIRB.AI's launch pad; at night the swarm lifts off and flies together |
| Map | Tonight | Everything lit; Clanker Labs' house and a basketball court appear |

Every word is HTML in a frosted card docked to the left (bottom on phones);
the city is framed to the right of it, so text never sits on the busy part.

## How it's built

- **Page first.** `index.html` holds every word and link and reads fine with no
  WebGL (the sky still changes with the time of day). Page JS is about 5 KB gzipped.
- **City second.** three.js is a dynamic `import()` after `load` and idle
  (≈150 KB gzipped), so the first screen paints without it.
- **Toy blocks in the vertex shader.** Each building is one merged,
  vertex-coloured mesh. Every part carries a block pivot and a start delay, and
  the vertex shader drops, grows, squashes and wobbles each block into place
  (`src/city/materials.ts`). Running the clock backwards takes it apart again.
  A matching depth material keeps the shadows in step.
- **One light that crosses the day.** A hemisphere light and one sun with a
  single shadow map (2048, 1024 on phones). The shadow map only re-renders
  when the sun moves, a building assembles or a building lifts on hover.
- **Windows are glass by day and lamps by night** through one `glow` vertex
  attribute, so night costs no extra lights. Warm pools of light on the ground
  are one instanced, additive quad.
- **Scroll drives it directly.** Scroll position → a chapter coordinate →
  camera shot, time of day and which buildings exist. The camera only has
  ~90 ms of smoothing.
- **It sleeps.** No rendering while the tab is hidden or once the paper
  sections cover the city; after 8 s without input the ambient life runs at
  half rate. With `prefers-reduced-motion` nothing moves on its own and frames
  render only when you scroll or interact.
- **Adaptive resolution.** Pixel ratio is capped at 2 (1.5 on phones) and
  steps down if frames run slow.

Cost, measured with `?perf` (shows a small overlay): about 30–47 draw calls and
45–57k triangles for the full night city, and ≈0.1–0.7 ms of JS per frame for
the update (camera, buildings, robots, drones, birds).

## Structure

```
index.html              every word: hero, nine chapters, the map, work, writing, photos, contact
src/main.ts             scroll → time of day, the place sheet, clips, photos, lazy-loads the city
src/sky.ts              time-of-day keyframes shared by the CSS sky and the 3D lights
src/content.ts          the list of places the city and the sheet share
src/styles.css          the design system
src/city/index.ts       renderer, camera rig, picking, labels, render loop
src/city/landmarks.ts   the buildings and the little life inside them
src/city/world.ts       turntable, lagoon, islands, bridges, trees, boat, birds, clouds
src/city/kit.ts         the toy-block geometry builder
src/city/materials.ts   flat toy shading, night glow, block assembly shader
public/work/            project clips (960px, 30 s loops) and posters
public/photos/          twelve photos at 800 and 1600px
```

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

## Editing

- **Words, links, projects, photos**: `index.html`.
- **A new place**: add a chapter `<article>` in `index.html`, an entry in
  `src/content.ts`, and a `Spec` in `src/city/landmarks.ts` (position, plot,
  camera framing and a `build(kit)` that stacks blocks).
- **Colours of the day**: the keyframes in `src/sky.ts`.

## Accessibility

- Body text is 16–17px, on frosted cards with dark ink (AA contrast or better).
- The canvas is decorative (`aria-hidden`); every building has a matching
  button in the map's legend and an "Open this place" button on its chapter.
- The place sheet is keyboard reachable, closes with Escape and returns focus.
- Reduced motion: no swoops, springs or ambient motion; clips get controls.
