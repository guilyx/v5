# elejeune.me — v5 · Behavior Tree

My career, as a behavior tree you can tick.

![v5](public/og.jpg)

I build robot autonomy, and BTView, an editor for behavior trees. So the site is
one: a light node canvas where each chapter of my life is a subtree. Scroll, and
the tick goes out from the root. Nodes go from **Idle** (dashed) to **Running**
(amber) to **Success** (green), the edges fill as the tick travels down them, and
a small rover drives along the edges to whatever node is being ticked. A
**Blackboard** panel fills with the values the nodes write (`team_size: 9`,
`onboard_cpu: −74%`, `papers: 3`…).

The semantics are real BehaviorTree.CPP semantics. The root is a `Parallel`
(learning and building robots overlapped for three years), chapters are
`Sequence`s, the research year is a `Parallel` of four projects plus a remote
job, and conditions are the things that held (`Mapped maze solved?`). Nothing
fails, because nothing did. Branches that are still going (SIRB.AI, Unchained
Labs, Off the clock) stay **Running**, and the ticks keep flowing down their edges.

## How you move through it

- **Scroll** advances the tick, one chapter per screen. The camera glides to the
  next subtree with a short pull-back, then holds while you read.
- **Drag** pans the board, **pinch** or **ctrl + scroll** zooms around the cursor.
  The camera goes back to following the tick at the next chapter, or on **Follow**.
- **Play** runs the whole tree by itself (about a minute). **← →** step.
  The timeline in the dock jumps to any chapter.
- **Click** a node with a `+ Paper` badge to open it; click a clip to see it large.

## How it's built

- **The markup is the tree.** `index.html` holds the whole BT as nested
  `<ol>`/`<li>`, one `<article class="node">` per node, like the XML. With no
  script it reads as an outline. Timing lives in `data-step` / `data-run` /
  `data-ok` attributes, and the blackboard is a `<dl>`.
- **Cards are DOM, the board is WebGL.** One camera (`src/bt/cam.ts`, pitch-only
  perspective) projects both, so card text stays crisp HTML while the dot grid,
  the edges, the chapter frames and the rover are three.js. Cards are anchored at
  their input port, so edges always meet their ports to the pixel.
- **Two layouts** (`src/bt/layout.ts`): left-to-right with ribbon-cable lanes on
  wide screens, an indented outline on phones.
- **three.js loads late.** The board (cards, camera, scroll, interaction) runs
  without it; `gl.ts` is a dynamic import once the page is idle. Without WebGL a
  2D canvas draws the same edges (`flat.ts`).
- **Cheap to draw.** 9 draw calls, ~3.3k triangles: one shader plane for the
  grid, one instanced mesh for all chapter frames, one ribbon mesh for every edge
  (fill and pulses are uniforms), and the rover. No post-processing.
  Pixel ratio capped at 2 (1.5 on touch). It stops rendering off-screen, in a
  hidden tab, and 20 s after the last input.
- **Measure it.** Open `/?perf` for a per-frame CPU readout; `window.__bt` has
  the same numbers.
- `prefers-reduced-motion`: no camera glides, no pulses, no autoplaying clips.

## Structure

```
index.html          the tree (content), blackboard, notes, photos, contact
src/main.ts         boots the board, lazy-loads the renderer, photo viewer, nav
src/styles.css      the look: cool canvas, white nodes, amber running, green success
src/bt/model.ts     reads the tree from the DOM, times every status change
src/bt/layout.ts    the two layouts, edge routing, the rover's routes
src/bt/cam.ts       the shared camera (projection, unprojection)
src/bt/board.ts     scroll → tick, camera shots, cards, blackboard, dock, input
src/bt/gl.ts        three.js: grid, frames, edges, rover
src/bt/flat.ts      2D-canvas fallback when there is no WebGL
public/work/        project clips (960px, 30 s loops) and posters
public/photos/      twelve photos at 800 and 1600px
```

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

## Editing

- **Words, links, projects** — the nodes in `index.html`.
- **A new chapter** — add an `<li>` with an `<article class="node node--chapter"
  data-type="sequence" data-step="N">` and its children; children are timed
  from their parent's type. Add a matching button to `.ticks` in the dock.
- **A blackboard value** — a `<div data-at="progress" data-key="…">` in `.bb-list`.
