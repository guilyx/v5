# elejeune.me — v5 · Flight Log

You fly. A small quadcopter takes off from Nantes and you pilot it through a chain
of floating islands, one per place in Erwin Lejeune's career: Nantes, Bordeaux,
Coimbra, Nantes again, Odense and Abu Dhabi. Each ring you pass logs a leg in a
pilot's logbook. At the TII ring six more drones join you in formation, and the
flight ends on the SIRB.AI pad, where the swarm parks on the apron.

![v5](public/og.jpg)

## How you fly

| Input | What it does |
| :---- | :----------- |
| Scroll / swipe up | Throttle along the route (backwards too) |
| Mouse position | Steer inside the corridor; let go and the autopilot brings you back to the dotted line |
| Drag sideways (touch) | Steer on a phone |
| Hold <kbd>Space</kbd> or the *Hold to fly* button | Cruise forward (<kbd>Shift</kbd>+<kbd>Space</kbd> flies back) |
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | Steer from the keyboard |
| Flight plan (top) | Jump to any leg |

Fly through a ring's centre and the logbook stamps it *Clean pass*; miss it and it
is still *Logged*. Nothing is gated: every word is readable whatever you do.

## The legs

| Waypoint | Island | Hint of the place | Log entry |
| :------- | :----- | :---------------- | :-------- |
| Take-off | Nantes | river city, slate roofs, a harbour crane | B.Sc. Electronics, 2014–2018 |
| 1 | Bordeaux | river crescent of stone facades, vineyard, a plaza with a microcontroller in it | Hiventive, 2018–2019 |
| 2 | Coimbra | hillside town with a tower, two hedge mazes with a robot and a flag each | Ingeniarius, 2019 |
| 3 | Nantes, again | the campus side: a 4×4 grid with three robots on it | Centrale Nantes, 2019–2021 |
| 4 | Odense | canals, coloured gabled houses, a supermarket with trolleys and a store robot | Coalescent, 2021–2022 |
| 5 | Abu Dhabi | dunes, the lagoon spilling into the sky; the swarm joins | TII, 2022–2024 |
| 6 | Abu Dhabi | the avenue between the towers, in formation | TII team lead, 2024–2026 |
| Landing | SIRB.AI | the pad, the hangar, six apron pads | Head of Robotics, 2026 |

The distances on the log cards ("822 km from Bordeaux") are great-circle distances
between the places' coordinates.

## How it's built

- **Page first.** `index.html` holds every word and link. Without JavaScript or
  WebGL 2 the flight is a plain, readable logbook list.
- **Two halves.** `src/journey.ts` (no three.js, ~5 KB gzip with the rest of the
  page script) turns scroll into route progress, runs the logbook card, the flight
  plan, throttle and steering input. `src/flight/` is loaded with a dynamic
  `import()` when the browser is idle and only draws.
- **One material, merged geometry.** Every island is a single flat-shaded,
  vertex-coloured mesh built procedurally at load (`islands.ts`): a polar-grid top,
  a stratified rock cone underneath, then houses, trees, mazes and towers merged in.
  No textures, no model files.
- **Flight feel.** Scroll sets a target along a Catmull-Rom route; the drone follows
  with a short critically damped spring (≈80 ms), so the wheel never feels delayed.
  Its attitude comes from its own acceleration (thrust = acceleration + gravity +
  drag), so it pitches when you throttle and banks into turns. Props spool up and
  down; above ~50 % rpm the blades become blur discs.
- **Camera.** Tight chase in transit; near each waypoint it eases into a fixed
  three-quarter view of the island (a diorama) while you read the log.
- **The swarm.** Six wingmen in one `InstancedMesh`, each on its own spring towards
  a slot in a V, so the formation stretches and catches up like a flock.
- **Sleeps.** On a pad it stops rendering. Hovering with no input it drops to
  30 fps. Off-screen or in a hidden tab it stops. Pixel ratio is capped (2 desktop,
  1.5 touch) and steps down if frames run long.

### Cost (measured in headless Chromium, SwiftShader, on a loaded 4-core VM)

| | |
| :-- | :-- |
| Main-thread JS per frame (simulation + render submission) | median 1.0 ms, p90 4.1 ms |
| Simulation alone | ≈ 0.35 ms |
| Draw calls | 14–22 |
| Triangles | 18k–49k |
| Initial JS / CSS (gzip) | ≈ 5 KB / 6 KB |
| three.js + scene chunk (gzip, lazy) | ≈ 152 KB |

Open the site with `?perf` for a live overlay.

## Structure

```
index.html              all the content
src/main.ts             boot, WebGL check, lazy-load, clips, photo viewer, nav state
src/journey.ts          scroll → progress, logbook, flight plan, throttle, steering
src/legs.ts             leg weights shared by the page and the scene
src/styles.css          the design system: sky, logbook paper, navy ink, one tangerine
src/flight/index.ts     renderer, simulation, cameras, rings, swarm, render-on-demand loop
src/flight/islands.ts   the five places, built procedurally
src/flight/route.ts     the route through the waypoints
src/flight/drone.ts     the quadcopter and the swarm drone
src/flight/sky.ts       sky dome, cloud sea, low-poly cumulus, waterfalls
src/flight/geo.ts       merged flat-shaded geometry builder
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
- **An island**: its builder in `src/flight/islands.ts`; the route points in
  `src/flight/route.ts`; the diorama camera for its waypoint in `DIO` in
  `src/flight/index.ts`.
- **Pacing**: `LEG_WEIGHTS` in `src/legs.ts` (screens of scroll per leg).

## Accessibility

- Reduced motion: no flying. Scrolling (or Space) moves leg to leg with a short
  cross-fade, and the scene renders only when the leg changes. Clips wait for you.
- The canvas is `aria-hidden`; the logbook entries stay in the accessibility tree,
  the active leg is announced politely, and tabbing into an entry flies there.
- Every text block sits on an opaque paper card; body text is 16–18px.

## Deploying

Static output: `npm run build` and serve `dist/`. On Vercel, import the repo; Vite is
detected with no configuration.
