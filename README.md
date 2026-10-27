# elejeune.me — v5 · Globe Itinerary

An atlas of eight years in robotics. A printed-atlas globe flies you city to city while
the route inks itself in: Nantes → Bordeaux → Coimbra → Nantes → Odense → Abu Dhabi,
with a teal arc to Pasadena for the Caltech joint program, and my own photos pinned
where they were taken.

![v5](public/og.jpg)

## How you move through it

- **Scroll** is the journey. Each chapter card docks while the globe holds on its city;
  between two cards the camera flies the great circle and that leg of the route draws
  itself with a travelling dash. The camera is a pure function of the scroll position
  with 70 ms of smoothing, so it answers the wheel straight away.
- **Drag** turns the globe, with inertia. Scroll again (or press *Back to the route*) and
  it eases back onto the route.
- **Pinch**, or **Ctrl + scroll** on the globe, zooms. A plain wheel always stays the journey.
- **Pins**: a city pin opens its chapter; a round photo pin opens its photos. During the
  travel chapter the pin you're flying over opens into a postcard on its own.
- **Passport** (top right): stamps for every place and its years. Tap one to fly there.
- After the journey: the workshop (project clips), papers and notes, postcards, and a
  last look at the whole route for contact.

The night side of the globe is the real one, computed from the time you open the page.

## How it's built

- **Words first.** `index.html` holds every word and link. It reads fine with no
  JavaScript and no WebGL.
- **A flat plate, then the globe.** The first frame is drawn with Canvas 2D (same camera,
  same dots) so the title page is complete before three.js arrives. three.js is a lazy
  chunk; when it is ready the WebGL globe fades in over the plate. Without WebGL the plate
  stays and redraws when the view settles.
- **Three draw calls.** A sphere whose shader paints the paper ocean, graticule, tropics and
  night side; one `Points` cloud of land dots; one ribbon mesh for every arc. No
  post-processing.
- **Halftone land.** `src/atlas/land-data.ts` (17 KB) is a dot every 0.25° along rows of
  latitude, run-length encoded. Coarser 0.5° and 1° grids are subsets of it; the shader keeps
  the halftone screen at a constant ~5 px on screen and skips the fine grids entirely when
  zoomed out.
- **DOM for everything you read.** Pins, labels, postcards, the graduated ring and the live
  scale bar are HTML positioned from the same camera.
- **It sleeps.** Nothing is drawn while you read a docked card (once the dashes settle, a few
  seconds after you stop), while the paper sections cover the globe, or when the tab is
  hidden. The slow turn on the title page stops after 25 s without input.
- `?stats` in the URL exposes `window.__atlas.stats` (CPU per frame, draw calls).

## Structure

```
index.html                all the content
src/main.ts               photo viewer, passport, clips, nav; starts the atlas
src/styles.css            the atlas: paper, ink, route red, collaboration teal, travel ochre
src/atlas/atlas.ts        the loop: scroll, drag, zoom, idle; picks plate or globe
src/atlas/timeline.ts     scroll position → camera, arcs, lit pins
src/atlas/places.ts       places, legs, and how each chapter frames the globe
src/atlas/globe.ts        three.js globe (lazy)
src/atlas/plate.ts        Canvas 2D globe (first frame, and no-WebGL)
src/atlas/overlay.ts      pins, postcards, ring, scale bar
src/atlas/geo.ts          vector and camera math shared by all three
src/atlas/land.ts         decodes the land dots
src/atlas/land-data.ts    generated land mask (Natural Earth, public domain)
public/photos/thumb/      four 128 px pin thumbnails
```

## Regenerating the land mask

Done once, outside the project's dependencies: install `world-atlas@2` and
`topojson-client@3` in a scratch folder, rasterise `land-50m.json` onto rows of latitude
every 0.25° (even-odd scanlines, longitudes unwrapped across the antimeridian, Antarctica
closed through the pole), run-length encode each row as LEB128 varints and base64 the
result into `src/atlas/land-data.ts`.

## Commands

| Command           | Action                             |
| :---------------- | :--------------------------------- |
| `npm install`     | Install dependencies               |
| `npm run dev`     | Dev server at `localhost:5173`     |
| `npm run build`   | Typecheck, then build to `./dist/` |
| `npm run preview` | Preview the build                  |

## Editing

- **Words, links, projects, photos**: `index.html`.
- **A chapter**: add an `<article class="chapter" data-chapter="id">` with a `.card`, and its
  camera stops in `CHAPTER_STOPS` in `src/atlas/places.ts`.
- **A place or a photo pin**: `PLACES` in `src/atlas/places.ts`.

## Accessibility

- Reduced motion: no flights (the camera cuts between cities), no turning, no marching
  dashes, no pulses; clips play only on hover.
- The globe is `aria-hidden`; everything on it is also reachable as text (chapters, passport,
  postcards).
- Photos and the passport open in native `<dialog>`s; arrow keys step through photos.

## Deploying

Static output: `npm run build` and serve `dist/`. On Vercel, Vite is detected with no
configuration.
