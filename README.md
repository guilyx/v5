# elejeune.me — v5 · Powers of Ten

One unbroken zoom, after Charles and Ray Eames' *Powers of Ten* (1977). Scroll is
the zoom exponent, and scale maps to time: the deeper you go, the further back
in the career you are.

![v5](public/og.jpg)

| power | what you see | chapter |
| :-- | :-- | :-- |
| 10⁷ m | the Earth, his places, the route between them | today |
| 10⁵ m | the coast at Abu Dhabi | SIRB.AI, 2026 – now |
| 10⁴ m | offshore, the swarm is a speck | Unchained Labs, 2024 – now |
| 10² m | a swarm drawing the brand mark | TII, team lead, 2024 – 2026 |
| 10¹ m | inside the flock | TII, flocking paper, 2022 – 2024 |
| 10⁰ m | one drone | Coalescent, Odense, 2021 – 2022 |
| 10⁻¹ m | its flight controller | Centrale Nantes, 2020 – 2021 |
| 10⁻² m | the microcontroller | Ingeniarius, Coimbra, 2019 |
| 10⁻³ m | the die: TIM, I2C, CAN, GPIO, USART | Hiventive, Bordeaux, 2018 – 2019 |
| 10⁻⁴ m | the circuitry, a maze | Nantes Université, 2014 – 2018 |

Then the page zooms back out, eleven powers of ten in one breath, and becomes a
plain, readable page: projects with their clips, papers and notes, photos, contact.
The hardware on the way down is an illustration, not his.

## How you move through it

- **Scroll** drives the exponent directly (a 70 ms smoothing only rounds off wheel steps).
  Each chapter's card docks on the left (at the bottom on phones) while the zoom
  settles, and never covers the zoom point.
- **The ruler** on the right is logarithmic, 10⁷ m to 10⁻⁴ m. Click a power or a
  chapter dot to fly there. Its needle carries the year.
- **The corner marks** around the centre are the film's nested square: the frame the
  next power of ten will fill. A map-style **scale bar** gives the field in km, m, mm, µm.
- **Drag the globe** at the top to turn it (Pasadena is round the back).
- **Move the pointer through the flock** at 10¹ m; the drones give it room.
- **Tap the circuitry** at 10⁻⁴ m: an A* planner routes a little robot through the maze.

## How it's built

- **Content first.** Every word is in `index.html` and reads fine with no JavaScript
  and no WebGL (the cards fall back to a single column). The first paint needs
  ~6 KB of JS and ~5 KB of CSS (gzip).
- **Scale-relative rendering.** There is no camera flight. The camera is fixed;
  each level keeps its geometry in its own unit (10ᵏ m) and is drawn scaled by
  10^(k − s) around the focus point, so float32 never sees huge or tiny numbers.
  Only the 2–3 levels near the current exponent are visible. The focus point
  slides between chapters so the next subject's on-screen offset only shrinks.
  See `src/gl/world.ts`.
- **Seven levels**, each a small module in `src/gl/`: a shaded globe (`earth.ts`),
  an atlas-style coast (`gulf.ts`), the water and an instanced swarm with a boids
  flock (`sea.ts`), a toon-shaded drone (`drone.ts`), a flight-controller board
  drawn on a canvas plus instanced parts (`board.ts`), a decapping chip with bond
  wires and a die floorplan (`chip.ts`), and a resolution-independent maze shader
  (`maze.ts`, `mazegen.ts`).
- **Coastlines** are Natural Earth (public domain) baked into three small
  signed-distance PNGs (`public/geo/`, 342 KB, loaded lazily) by
  `scripts/coast-sdf.mjs`. Signed distances stay smooth when magnified and give
  the engraved water lines for free.
- **Lazy and lean.** three.js and the scenes are one lazy chunk (~162 KB gzip),
  loaded when the page is idle. No post-processing. Pixel ratio capped at 2
  (1.5 on phones). Rendering stops when nothing moves, when the tab is hidden,
  and once the readable page covers the stage. `?perf` shows the per-frame cost.

## Structure

```
index.html              all the content
src/main.ts             scroll → exponent loop, card docking, free-area framing, lazy-loads the zoom
src/dive.ts             the scroll ↔ exponent mapping and its inverse
src/hud.ts              the ruler, the needle, the nested frame, the scale bar
src/page.ts             photo viewer, clips that play in view, nav state
src/gl/engine.ts        renderer, off-axis camera, levels, DOM labels, pointer
src/gl/world.ts         the physical nesting (metres) and the focus path
src/gl/*.ts             the seven levels
scripts/coast-sdf.mjs   bakes the coastline distance maps
public/work/            project clips (960px, 30 s loops) and posters
public/photos/          twelve photos at 800 and 1600px
public/geo/             coastline distance maps
```

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

## Accessibility

- Body text is 16–17px, ink on warm paper; every label over the picture sits on a solid paper tag.
- Reduced motion: no smoothing, no flocking, no fling; the zoom only moves when you scroll, and clips play on hover or focus.
- The canvas is `aria-hidden`; the ruler is a list of buttons; photos open in a native `<dialog>` with arrow keys.

## Deploying

Static output: `npm run build` and serve `dist/`. On Vercel, import the repo;
Vite is detected with no configuration.
