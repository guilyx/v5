# elejeune.me — v5 · The Maze

A portfolio you solve.

![v5](public/og.jpg)

Erwin won both maze-solving competitions in Coimbra and wrote a survey of
multi-agent pathfinding, so his site is a maze. It is a tabletop toy: kraft
walls, a paper floor, and a small differential-drive robot with a spinning
LiDAR. Click anywhere and the robot plans a path with A* (the search washes
over the cells in blue), then drives there. Every room is a chapter of his
career, and walking into one opens its story.

## How you move through it

- **Click or tap the floor**: A* from the robot to that cell, the frontier
  drawn as it expands, the route as a dotted line, then a pure-pursuit drive.
- **Scroll** (or swipe up, or press Page Down): the next room, in order. One
  gesture is one room, and the robot starts moving on the first wheel tick.
  Scroll past the end of a story to keep going.
- **Solve**: an autopilot tour of every room, with a pause in each.
- **Arrow keys / WASD**: drive cell by cell.
- **Map**: click a room (or any corridor) to go there.
- **List view**: the whole site as a plain, readable document. Without WebGL
  this is what you get.
- Links like `/#room-coimbra` start the robot in that room.

## The rooms

| | Room | What's in it |
| -- | -- | -- |
| 00 | Entrance | His name painted on the floor, the brand mark, a charging dock |
| 01 | Nantes | A resistor, a capacitor and a breadboard |
| 02 | Hiventive | The room is the chip: graphite package, gold pins, an STM32 die with TIM, I2C, CAN, GPIO, USART |
| 03 | Coimbra | A small maze on a table that a small robot keeps solving, and two trophies: mapped, unmapped |
| 04 | Centrale Nantes | The two papers on easels, and an inverted pendulum balancing |
| 05 | Coalescent | Supermarket aisles and a trolley that gets a detection box when you walk in |
| 06 | TII | Six robots plan around you with prioritized space-time A* (a PyMAPF nod); −74% CPU and −52% bandwidth painted on the floor |
| 07 | Unchained Labs | An intent → agents → jobs graph with pulses running along it |
| 08 | SIRB.AI | A flock of drones; now and then one fails, drops, and recovers |
| 09 | Projects | The eight project clips on screens; the one you stand at plays |
| 10 | Off the clock | His photos, printed and scattered on the floor (click one) |
| 11 | Exit | A finish line, a mailbox, and how to reach him |

## How it's built

- **Page first.** `index.html` holds every word. The story panel, the list view
  and the no-WebGL fallback are the same HTML; CSS decides how it's laid out.
  The page's own JS is 7 KB gzipped and draws the minimap without three.js.
- **3D second.** three.js loads with a dynamic `import()` once the fonts are in.
- **The maze** (`src/maze/layout.ts`) is a seeded recursive backtracker over the
  corridor lattice, with rooms carved first, doors opened per side, and some
  dead ends braided into loops. Same seed, same maze, every visit.
- **Walls** are merged into straight runs: 163 boxes in one `InstancedMesh`.
  Soft clay edges and the dark foot of each wall come from the shader.
- **Light** is baked: ambient occlusion and the sun's shadow are computed once
  into a 228×172 texture. No shadow maps, no post-processing.
- **The search** is a float texture with one texel per cell holding the time
  A* closed it; the floor shader turns that into the fading wash. One upload
  per plan, nothing per frame.
- **Everything painted on the floor** (room names, the chip die, the
  breadboard, the stats) shares one canvas atlas and one draw call.
- **It sleeps.** After 16 s without input the robot dozes off, the LiDAR
  winds down and rendering stops. The tab being hidden also stops it.
- `prefers-reduced-motion`: the robot jumps to its goal, the camera cuts, and
  nothing animates on its own.

Run with `?perf` to see the per-frame cost.

## Structure

```
index.html              all the content (12 rooms)
src/main.ts             story panel, map, scroll/keys/swipe, list view, photo viewer, lazy-loads the world
src/styles.css          the design system: table, paper, kraft, one red, one blue
src/media.ts            the project clips and photos used by the 3D rooms
src/maze/layout.ts      the seeded grid and the rooms (no three.js)
src/maze/astar.ts       A*, line-of-sight smoothing, clearance checks
src/maze/drive.ts       differential-drive kinematics + pure pursuit
src/maze/mapf.ts        prioritized space-time A* for the swarm room
src/maze/world.ts       renderer, camera, input, tour, sleep
src/maze/floor.ts       floor shader, baked light, search texture
src/maze/walls.ts       the walls
src/maze/robot.ts       the robot
src/maze/fx.ts          dotted route, tyre tracks, LiDAR returns
src/maze/props.ts       the rooms' props and floor paint
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
