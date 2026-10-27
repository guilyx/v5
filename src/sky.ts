/**
 * Time of day along the journey. `c` is the chapter coordinate: 0 is the hero
 * (dawn, 2014), 1..9 are the chapters, 10 is the map at night. The page uses
 * this for the CSS sky even without WebGL; the city uses it for its lights.
 */

export type RGB = [number, number, number];

interface Key {
  top: string;
  bottom: string;
  sun: string;
  sunI: number;
  sky: string;
  ground: string;
  hemiI: number;
  night: number;
  water: string;
  /** sun azimuth (radians, around the table) and elevation */
  az: number;
  el: number;
  name: string;
}

const KEYS: Key[] = [
  { top: "#f4c3b4", bottom: "#fbe8d6", sun: "#ffc8a2", sunI: 2.1, sky: "#ffe6d6", ground: "#c7b3c4", hemiI: 1.35, night: 0, water: "#a2c6d9", az: -1.35, el: 0.3, name: "dawn" },
  { top: "#f2d4bf", bottom: "#f8eee2", sun: "#ffd9b6", sunI: 2.4, sky: "#fcece0", ground: "#c4c0cf", hemiI: 1.4, night: 0, water: "#a5cbdd", az: -1.05, el: 0.48, name: "early morning" },
  { top: "#cfe2ee", bottom: "#f7f1e6", sun: "#fff0da", sunI: 2.6, sky: "#f4f1ea", ground: "#bfc7c9", hemiI: 1.45, night: 0, water: "#a6d0e2", az: -0.75, el: 0.66, name: "morning" },
  { top: "#c4ddec", bottom: "#f5f2ea", sun: "#fff6e8", sunI: 2.7, sky: "#f3f3ee", ground: "#bcc8c4", hemiI: 1.45, night: 0, water: "#a4d0e4", az: -0.45, el: 0.82, name: "late morning" },
  { top: "#bfd9ea", bottom: "#f3f1ea", sun: "#fff8ee", sunI: 2.7, sky: "#f3f3ee", ground: "#bcc8c4", hemiI: 1.45, night: 0, water: "#a2cfe4", az: -0.05, el: 0.95, name: "midday" },
  { top: "#c9dce8", bottom: "#f5efe2", sun: "#ffefd8", sunI: 2.6, sky: "#f5f0e8", ground: "#c2c2c4", hemiI: 1.4, night: 0, water: "#a5ccdd", az: 0.4, el: 0.78, name: "afternoon" },
  { top: "#f0d6ad", bottom: "#f8ecd9", sun: "#ffd49a", sunI: 2.5, sky: "#fbe6c8", ground: "#c9b5b0", hemiI: 1.3, night: 0, water: "#a9c7d3", az: 0.85, el: 0.5, name: "golden hour" },
  { top: "#eeae9c", bottom: "#f7d7c4", sun: "#ffc4a2", sunI: 2.0, sky: "#f4d6cf", ground: "#b6a1b4", hemiI: 1.2, night: 0.15, water: "#a9b6dc", az: 1.15, el: 0.28, name: "sunset" },
  { top: "#9b8ec4", bottom: "#e8bfc0", sun: "#eaa3b2", sunI: 1.1, sky: "#c9b6da", ground: "#7f6f8f", hemiI: 1.05, night: 0.6, water: "#9192bb", az: 1.35, el: 0.14, name: "dusk" },
  { top: "#2b2f5e", bottom: "#5b4a78", sun: "#b4c3ff", sunI: 0.7, sky: "#7579b8", ground: "#3d3352", hemiI: 1.0, night: 1, water: "#8d8ab5", az: -0.55, el: 0.85, name: "night" },
  { top: "#252a57", bottom: "#4c3d6e", sun: "#b8c4ff", sunI: 0.65, sky: "#7074b2", ground: "#3a2f4e", hemiI: 0.95, night: 1, water: "#8986b2", az: -0.4, el: 0.9, name: "night" },
];

/** start year of each stop, for the dial */
const YEARS = [2014, 2014, 2018, 2019, 2019, 2021, 2022, 2024, 2024, 2026, 2026];
/** where each stop is, for the dial */
export const STOP_PLACES = [
  "Nantes",
  "Nantes",
  "Bordeaux",
  "Coimbra",
  "Nantes",
  "Odense",
  "Abu Dhabi",
  "Abu Dhabi",
  "Remote",
  "Abu Dhabi",
  "The whole map",
];
export const LAST_STOP = KEYS.length - 1;

const cache = new Map<string, RGB>();
function rgb(h: string): RGB {
  let v = cache.get(h);
  if (!v) {
    v = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
    cache.set(h, v);
  }
  return v;
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Look {
  top: RGB;
  bottom: RGB;
  sun: RGB;
  sunI: number;
  sky: RGB;
  ground: RGB;
  hemiI: number;
  night: number;
  water: RGB;
  az: number;
  el: number;
  name: string;
  year: number;
}

export function lookAt(c: number): Look {
  const x = Math.min(Math.max(c, 0), LAST_STOP);
  const i = Math.min(Math.floor(x), LAST_STOP - 1);
  const t = x - i;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  // smooth inside each segment so colours don't kink at the stops
  const s = t * t * (3 - 2 * t);
  return {
    top: mix(rgb(a.top), rgb(b.top), s),
    bottom: mix(rgb(a.bottom), rgb(b.bottom), s),
    sun: mix(rgb(a.sun), rgb(b.sun), s),
    sunI: lerp(a.sunI, b.sunI, s),
    sky: mix(rgb(a.sky), rgb(b.sky), s),
    ground: mix(rgb(a.ground), rgb(b.ground), s),
    hemiI: lerp(a.hemiI, b.hemiI, s),
    night: lerp(a.night, b.night, s),
    water: mix(rgb(a.water), rgb(b.water), s),
    az: lerp(a.az, b.az, s),
    el: lerp(a.el, b.el, s),
    name: t < 0.5 ? a.name : b.name,
    year: Math.round(lerp(YEARS[i], YEARS[i + 1], t)),
  };
}

export const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
