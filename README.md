# elejeune.me — v5

The fifth iteration of my portfolio, and the first one you fly.

The route is the [guilyx mark](https://github.com/guilyx/branding/blob/master/brand/logo.md)
scaled up until a camera fits on it: three waypoints at the corners of a
triangle, joined by an open path that enters at the apex and stops at the third
node. Scrolling flies that path. Every chapter of the career sits on it as a
3D scene, and the last shot climbs high enough to read the whole route as what
it always was — the mark.

![v5](public/og.jpg)

## The flight

| Stop | What you see |
| :--- | :--- |
| launch | The apex waypoint, and the mark at monument scale, turning only in 120° steps |
| metal · 2018 | A virtual STM32 with bus traffic on its traces, then a maze robot that floods, solves and drives |
| research · 2020 | Multi-agent pathfinding (prioritized space-time A*, solved on load), a cart-pole with its jitter histogram, the papers — click to read |
| field · 2021 | A supermarket: costmap, global plan, a lidar that raycasts the shelving, a tracked trolley, and a chase camera on the robot |
| swarm · 2022 | The left waypoint. The companion flock does the job: murmuration, wedge formation behind a virtual leader, Voronoi coverage sweep, triangulation |
| team · 2024 | −74% CPU and −52% bandwidth as bars that shrink, the team of nine, and Caltech's M4 folding its wheels into rotors |
| company · 2024 | Unchained Labs: a spoken intent through the Kymatics agent graph into a queue of build jobs, all inside the client's box |
| now · 2026 | SIRB.AI: a self-healing ring, a 16-node behavior tree densified into its six actions, faults on one timeline |
| agentic era | Six gates you fly through — draft, AI review, checks, quiz, human review, ship |
| builds | The real promo clips on screens hung at the altitude each project runs at |
| open source | The archive as a constellation, placed by year, upstream projects as the bright stars |
| lens | Every photo from v4, by trip — click for the full print |
| open channel | The right waypoint, then the pull-back that reveals the route as the mark |

The flock that follows you is a real boids simulation — separation,
alignment, cohesion, and a goal force each scene sets. It's drawn in the
brand's `agent` grey: texture, not decoration. Your pointer is a hawk.

## Stack

- **[three.js](https://threejs.org)** — no framework on top; every scene is a function returning a group, its camera keys and an `update`
- **TypeScript + [Vite](https://vite.dev)**
- **No animation library.** Scroll maps to a position along two centripetal Catmull-Rom splines (camera and look target), and the camera chases it with exponential damping

## Structure

```
src/
├── content.ts            ← ALL the words and numbers (ported from v4's site.ts and the résumé)
├── main.ts               ← boot, loader, frame loop, clicks
├── core/
│   ├── world.ts          ← the route (the mark), ground, waypoints, dust, stars
│   ├── journey.ts        ← scroll → key index → camera
│   ├── flock.ts          ← the companion boids
│   ├── labels.ts         ← HTML labels pinned to points in 3D
│   ├── engine.ts         ← renderer, bloom, grade, adaptive pixel ratio
│   └── util.ts           ← Ink & Iris palette, shared materials
├── scenes/               ← one file per chapter
└── ui/
    ├── sections.ts       ← the readable panels, one per stop, in document order
    ├── hud.ts            ← waypoint rail, telemetry, panel crossfades
    └── lightbox.ts
public/
├── media/                ← promo clips + posters (from v4)
└── photos/               ← full-size prints, and sm/ for textures
```

## Commands

| Command             | Action                               |
| :------------------ | :----------------------------------- |
| `npm install`       | Install dependencies                 |
| `npm run dev`       | Dev server at `localhost:5173`       |
| `npm run build`     | Typecheck, then build to `./dist/`   |
| `npm run preview`   | Preview the build                    |

## Editing

**Words** live in `src/content.ts`. Scenes read their numbers from there too
(the rework percentages, the archive, the photo list), so changing a fact
changes the drawing.

**A new chapter** is a file in `src/scenes/` that returns a `Scene`: a group
placed on the route with `env.world.frame(leg, f)`, one or more stops (each a
DOM id, a scroll length in `vh`, and camera keys in the scene's local frame,
where −Z is the direction of travel), and an `update`. Add a panel for each
stop in `src/ui/sections.ts` and the factory to the list in `src/main.ts`.

**Photos**: drop the full-size image in `public/photos/`, a ~640px copy in
`public/photos/sm/`, and add it to a trip in `content.ts`.

## Accessibility and fallbacks

- Every panel is real HTML in reading order; the canvas is `aria-hidden`.
- `prefers-reduced-motion` drops the camera inertia and slows everything that moves on its own.
- No WebGL: the page becomes a plain, readable document.
- The pixel ratio steps down if frames run long, so a weaker GPU gets a softer image instead of a stutter.

## Deploying

Static output — `npm run build`, serve `dist/`. On Vercel it's zero-config.
Update the domain in `index.html` (`og:url`, `og:image`) and `src/content.ts`
if it changes.

## Credits

Colour, mark and voice: [guilyx/branding](https://github.com/guilyx/branding).
Content, clips and photos: [guilyx/v4](https://github.com/guilyx/v4). The
layout lineage of v4 owes a debt to [Brittany Chiang's v4](https://v4.brittanychiang.com/);
the panels here inherit some of that restraint.
