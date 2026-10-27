# elejeune.me — v5 · Robot Arm Workshop

Eight years in robotics, one piece at a time.

![v5](public/og.jpg)

A clean photo studio with a six-axis robot arm on a pedestal, a conveyor on one
side and a display shelf on the other. Every chapter of the career is an object
on the conveyor. As you scroll, the arm picks it up, holds it out to you while
you read, and puts it on the shelf. By the end the shelf is full.

| # | Chapter | Object |
|---|---|---|
| 01 | Nantes Université, 2014–2018 | a book and a graduation cap |
| 02 | Hiventive, Bordeaux, 2018–2019 | a chip on its board |
| 03 | Ingeniarius, Coimbra, 2019 | a maze cube |
| 04 | Centrale Nantes, 2019–2021 | a stack of papers |
| 05 | Coalescent, Odense, 2021–2022 | a shopping trolley |
| 06 | TII, Abu Dhabi, 2022–2026 | a drone — the arm lets go and it flies to the shelf |
| 07 | Unchained Labs, 2024– | a microphone and its sound wave |
| 08 | SIRB.AI, 2026– | a swarm tray; the seven little drones lift off |

## How you move through it

- **Scroll** drives the pick-and-place cycle. It is a pure function of scroll
  position, so you can scrub it both ways.
- **Move the cursor** and the arm turns its gripper to follow you (in the hero
  and at the end). While it holds an object up, the object tilts toward you.
- **Drag** the stage to orbit a little; it springs back when you let go.
- **Click an object on the shelf** (or a button on the shelf rail) and it floats
  forward with its story. "Go to this chapter" scrolls to where the arm holds it.
- **The bench**: pick a project and the monitor next to the arm plays its real clip.
- The **joint readout** (q1…q6, in degrees) in the corner is the arm's real state.

## How it's built

- **Page first.** `index.html` holds every word and link; with no WebGL it
  becomes a plain, centred column. The page script is ~3.6 KB gzipped.
- **3D second.** three.js loads with a dynamic `import()` once the page is idle
  (one 151 KB gzipped chunk).
- **The arm is solved analytically.** Base yaw + a 2-link planar solve + wrist
  pitch (`solve`), and a variant where forearm roll and wrist pitch aim the tool
  at any point (`solveDir`) — that is how it stands in profile and still turns
  its head to you. No physics engine. See `src/workshop/arm.ts`.
- **Motion profiles.** Every pose of every cycle is solved once at start-up.
  Vertical approach/lift moves are Cartesian (IK each frame); transfers are
  minimum-jerk joint-space moves. Objects attach to the gripper with the exact
  relative transform measured at the grip, so nothing pops.
- **Everything is primitives.** Rounded boxes, cylinders, tori, merged per rigid
  part with baked vertex colours and one shared material. 28–42 draw calls per
  frame including the shadow pass, depending on what is in view. One
  shadow-casting light, no post-processing.
- **It sleeps.** The loop only runs while something moves (scroll smoothing,
  the arm's gaze, a drone in the air, a playing clip — which wakes it per video
  frame, not per display frame). Hovering drones land after 7 s without input.
  Hidden tab or a reading sheet over the stage → no rendering at all.
- **Adaptive resolution.** DPR is capped at 2 (1.5 on phones) and steps down if
  frames run slow while animating.
- **Text never sits on the arm's working area.** The camera's projection is
  offset (`setViewOffset`) so the cell is framed in the free part of the screen:
  right of the docked card on desktop, above it on phones.

## Structure

```
index.html               all the content, the icon sprite, dialogs
src/main.ts              page wiring: rail, story dialog, bench, photos, lazy-load
src/timeline.ts          scroll → story time (shared by page and 3D)
src/styles.css           studio palette: warm white, graphite, one signal yellow
src/workshop/index.ts    renderer, choreography, camera, input, render loop
src/workshop/arm.ts      the arm model + analytic IK
src/workshop/objects.ts  the eight chapter objects
src/workshop/studio.ts   cyclorama, conveyor, shelf, bench and monitor
src/workshop/kit.ts      geometry helpers and the palette
public/work/             project clips (960px loops) and posters
public/photos/           twelve photos at 800 and 1600px
```

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

Add `?stats` to the URL to expose `window.__ws` (CPU per frame, draw calls,
triangles, current pixel ratio).

## Accessibility

- Reduced motion: the cycle jumps between three still frames per chapter, no
  camera push-in, no cursor following, drones stay landed, clips play on click.
- The canvas is `aria-hidden`; the shelf is also a row of labelled buttons; the
  story is a native `<dialog>`.
- Body text is 16–17px on solid cards; the HUD has its own solid backing.
