# elejeune.me — v5

A career, drawn by a swarm of drones.

![v5](public/og.jpg)

About a thousand small quadcopters flock in the hero and scatter around your
cursor. Scroll, and they fly into a new formation for each chapter: the chip I
started on, the maze my robots solved, the shopping cart from the supermarket
robot, the bird behind the flocking paper, the CPU we gave back to the drones,
a graph of agents, and a sphere for SIRB.AI — *sirb* is Arabic for a swarm.

The words are plain HTML in their own column. The swarm never sits behind text.

## How it's built

- **Page first.** `index.html` holds every word and link; it reads fine with no
  JavaScript and no WebGL. The page's own script is under 2 KB.
- **3D second.** three.js loads lazily once the page is idle. One instanced
  mesh, no post-processing, no physics engine.
- **Formations are drawings.** Each chapter's shape is drawn on a small
  offscreen canvas (ink in black, the highlight in red) and sampled on a hex
  grid, so drones sit evenly like a real drone show. See `src/swarm/shapes.ts`.
- **Scroll drives it directly.** The scroll position picks the two formations
  to blend and how far along; nothing eases the scroll itself, so the swarm
  answers the wheel straight away. A stiff spring per drone just rounds off the
  motion.
- **It sleeps.** While you read the project grid the drones are parked above
  the page and the canvas stops rendering.
- **About 0.35 ms of CPU per frame** for the whole swarm, measured in dev.

## Structure

```
index.html            all the content
src/main.ts           photo viewer, clips that play in view, nav state, lazy-loads the swarm
src/styles.css        the design system: paper, ink, one orange
src/swarm/index.ts    renderer, drones, scroll → formation blend, cursor
src/swarm/shapes.ts   the formations
public/work/          project clips (960px, 30 s loops) and posters
public/photos/        twelve photos at 800 and 1600px
```

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

## Editing

- **Words, links, projects, photos** — `index.html`.
- **A new chapter** — add an `<article class="chapter stage" data-stage="name">`
  and a matching drawing in `buildFormations()` in `src/swarm/shapes.ts`.
- **Clips** — re-encode new ones the same way:
  `ffmpeg -i in.mp4 -t 30 -an -vf "scale='min(960,iw)':-2,fps=30" -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart out.mp4`

## Accessibility

- Reduced motion: the swarm only moves when you scroll — no flocking, no arcs; clips only play on hover.
- The canvas is `aria-hidden` and never takes pointer events.
- Photos open in a native `<dialog>`; arrow keys step through them.

## Deploying

Static output — `npm run build` and serve `dist/`. On Vercel, import the repo;
Vite is detected with no configuration.
