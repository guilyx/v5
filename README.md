# elejeune.me — v5 · Night Drone Show

Abu Dhabi, night, by the water. 1,500 LED drones lift off a barge and perform
eight years in robotics as a drone show over the sea, and the visitor can take
the controls.

![v5](public/og.jpg)

*Sirb* (سرب) is Arabic for a swarm. Erwin is Head of Robotics at SIRB.AI, so the
site is his field, staged: a microcontroller, a solved maze, a balancing
inverted pendulum, a detected supermarket trolley, a real flock, "−74%", a voice
becoming a graph of agents and a queue of jobs, SIRB.AI with drones that fail
and recover, and a final "hello" when you reach the contact.

## How you move through it

- **Scroll is the show's timeline.** Each act holds, then the drones fly to the
  next one with its own choreography (take-off, sweeps, swirls, a burst). Scroll
  back and it plays backwards. The strip at the bottom is a scrubber: drag it,
  or focus it and use the arrow keys.
- **Direct the show.** Draw anything in the sky and let go: the drones fly your
  drawing, in the order you drew it. Strokes add up; presets (circle, star,
  heart, wave) work from the keyboard too. Scroll, or "Back to the show", and
  they return to the programme.
- **Click or tap the sky** for a ripple of light through the swarm.
- **Act V** is a live flock: move your cursor through it (or tap) and it
  scatters around you.
- The words sit in a frosted "show programme" card, docked bottom-left (a bottom
  sheet on phones), never over the drones. After the show, a calm page holds the
  project clips, writing, credits and photos; then the sky comes back for the
  encore.

## How it's built

- **Page first.** Every word is in `index.html`. The page script is ~9 KB.
  three.js and the show load lazily as a separate chunk after first paint.
  Without WebGL the acts stack as a readable page over a painted night sky.
- **Formations are drawings.** Each act is painted on a small offscreen canvas
  (paint colour = LED colour, alpha = density, a second "tag" canvas marks
  drones for motion) and sampled into exactly N points on a hex lattice.
  Consecutive acts are matched along a Hilbert curve so each drone keeps its
  place in the picture (`src/show/formations.ts`).
- **The GPU flies the drones.** One `Points` draw for the drones, one for their
  reflections. The CPU uploads two formations when the act changes; the vertex
  shader mixes them by a single uniform with a per-drone delay, plus the act's
  choreography and its life (pendulum, flowing signals, self-healing). A third
  buffer pair holds the visitor's drawing and blends over the timeline, so
  directing never fights the scroll (`src/show/drones.ts`).
- **The flock is real.** Acceleration-based boids, seven nearest neighbours
  each, on a uniform grid in typed arrays; it only runs while Act V is on
  screen, and hands each drone the nearest slot of the next act when it leaves
  (`src/show/flock.ts`).
- **The set.** Sky with a thin moon, extruded towers with procedural windows
  that switch on and off, a corniche of sodium lamps, two boats, aviation
  lights. Reflections are the same geometry drawn mirrored and rippled under a
  translucent sea. No textures, no render targets, no post-processing
  (`src/show/city.ts`).
- **Calm by default.** Short scroll smoothing only (70 ms), DPR capped at 2
  (1.5 on phones), rendering stops while the after-show page covers the sky or
  the tab is hidden, and drops to half rate when idle. With
  `prefers-reduced-motion`, there is no launch, acts cut instead of flying, and
  frames are drawn only when something changes.

## Performance

Add `?perf` to the URL for a live overlay. Measured in headless Chromium on a
heavily shared 4-core machine (load average ~28), so real numbers are lower:

- 9 draw calls, 11.7k triangles, 4.1k points per frame
- JS per frame (update + render submission): ~0.5–1 ms in formation acts,
  ~2 ms in the flock act (one flock step for 1,500 drones is ~0.4 ms)
- Startup: barge + overture built in ~50–65 ms; the other acts are built in
  idle time, one at a time
- Page JS ~9 KB (4 KB gzip); three.js + show chunk ~155 KB gzip, lazy

## Structure

```
index.html              all the content
src/main.ts             scroll → timeline, programme card, scrubber, directing, clips, photos
src/styles.css          night palette: warm LED white, amber, deep navy
src/show/index.ts       renderer, camera (lens-shifted horizon), timeline, directing, ripples
src/show/formations.ts  the acts, sampling, matching, the visitor's strokes
src/show/drones.ts      drone + reflection shaders, formation buffers
src/show/flock.ts       the boids
src/show/city.ts        sky, moon, stars, skyline, lights, water
public/work/            project clips (960px, ~30 s loops) and posters
public/photos/          photos, 800 and 1600 px WebP
```

## Develop

```
npm ci
npm run dev
npm run build   # tsc --noEmit + vite build
```
