/** Every place on the map, the routes between them, and how each chapter frames the globe. */

import { arcShape, ll, norm, add, type V3 } from "./geo";

export type PlaceKey =
  | "nantes"
  | "bordeaux"
  | "coimbra"
  | "odense"
  | "abudhabi"
  | "pasadena"
  | "paris"
  | "lome"
  | "tokyo"
  | "male"
  | "dubai"
  | "yosemite";

export type PlaceKind = "home" | "collab" | "travel";

export interface Photo {
  file: string;
  caption: string;
  w: number;
  h: number;
}

export interface Place {
  key: PlaceKey;
  name: string;
  region: string;
  lat: number;
  lon: number;
  kind: PlaceKind;
  /** which side the label sits on, so close neighbours don't collide */
  side: "l" | "r" | "t" | "b";
  /** the chapter a click on the pin opens */
  chapter?: string;
  photos?: Photo[];
}

const photo = (file: string, caption: string, w = 1600, h = 1069): Photo => ({ file, caption, w, h });

export const PLACES: Place[] = [
  { key: "nantes", name: "Nantes", region: "France", lat: 47.218, lon: -1.554, kind: "home", side: "l", chapter: "nantes" },
  { key: "bordeaux", name: "Bordeaux", region: "France", lat: 44.838, lon: -0.579, kind: "home", side: "r", chapter: "bordeaux" },
  { key: "coimbra", name: "Coimbra", region: "Portugal", lat: 40.203, lon: -8.41, kind: "home", side: "l", chapter: "coimbra" },
  { key: "odense", name: "Odense", region: "Denmark", lat: 55.403, lon: 10.402, kind: "home", side: "r", chapter: "odense" },
  { key: "abudhabi", name: "Abu Dhabi", region: "UAE", lat: 24.454, lon: 54.377, kind: "home", side: "b", chapter: "tii" },
  { key: "pasadena", name: "Pasadena", region: "Caltech", lat: 34.138, lon: -118.125, kind: "collab", side: "r", chapter: "lead" },
  {
    key: "paris",
    name: "Paris",
    region: "France",
    lat: 48.857,
    lon: 2.352,
    kind: "travel",
    side: "r",
    photos: [photo("paris-monument", "Monument · Paris"), photo("parisbaguette", "Paris Baguette · Paris", 1069, 1600)],
  },
  {
    key: "lome",
    name: "Lomé",
    region: "Togo",
    lat: 6.131,
    lon: 1.223,
    kind: "travel",
    side: "r",
    photos: [photo("togo-cooking-girls-clors", "Cooking, in colour · Togo", 1238, 827)],
  },
  { key: "tokyo", name: "Tokyo", region: "Japan", lat: 35.676, lon: 139.65, kind: "travel", side: "r" },
  {
    key: "male",
    name: "Malé",
    region: "Maldives",
    lat: 4.175,
    lon: 73.509,
    kind: "travel",
    side: "r",
    photos: [photo("maldives-hanging-shel", "Hanging shells · Maldives")],
  },
  { key: "dubai", name: "Dubai", region: "UAE", lat: 25.205, lon: 55.271, kind: "travel", side: "t" },
  {
    key: "yosemite",
    name: "California",
    region: "& the US West",
    lat: 37.865,
    lon: -119.538,
    kind: "travel",
    side: "l",
    photos: [
      photo("yosemite-landscape", "Yosemite · California"),
      photo("cathedral-lakes", "Cathedral Lakes · USA"),
      photo("zion-trail", "Zion trail · Zion"),
      photo("pavel-zion-happy", "Pavel, happy · Zion"),
      photo("grand-canyon", "Grand Canyon · USA", 1069, 1600),
      photo("santabarabarapier", "The pier · Santa Barbara"),
      photo("skating-santa-monica", "Skating · Santa Monica", 1069, 1600),
      photo("clinton-ball", "Clinton ball · USA"),
    ],
  },
];

export const PLACE = Object.fromEntries(PLACES.map((p) => [p.key, p])) as Record<PlaceKey, Place>;
export const at = (k: PlaceKey): V3 => ll(PLACE[k].lat, PLACE[k].lon);

/** The arcs. Index = leg number used by the shader and by chapter stops. */
export interface Leg {
  from: PlaceKey;
  to: PlaceKey;
  kind: "route" | "collab";
}
export const LEGS: Leg[] = [
  { from: "nantes", to: "bordeaux", kind: "route" },
  { from: "bordeaux", to: "coimbra", kind: "route" },
  { from: "coimbra", to: "nantes", kind: "route" },
  { from: "nantes", to: "odense", kind: "route" },
  { from: "odense", to: "abudhabi", kind: "route" },
  { from: "abudhabi", to: "pasadena", kind: "collab" },
];
export const legShape = (l: Leg) => arcShape(at(l.from), at(l.to));

/** One camera stop inside a chapter. */
export interface Stop {
  c: V3;
  d: number;
  /** the leg that draws while flying into this stop */
  leg?: number;
  /** pins highlighted (label + ring) while here */
  pins: PlaceKey[];
  /** the photo pin opened into a postcard while here */
  open?: PlaceKey;
  /** a stop key you can scroll to (passport stamps, tour chips) */
  key?: string;
}

const stop = (k: PlaceKey, d: number, extra: Partial<Stop> = {}): Stop => ({ c: at(k), d, pins: [k], key: k, ...extra });

/** Above the Arctic, where both ends of the Abu Dhabi → Pasadena arc are in view. */
const POLAR = norm(add(at("abudhabi"), at("pasadena")));

export const HERO_VIEW = { c: ll(26, 14), d: 4.7 };
/** labelled on the title page: where the route starts and where it is now */
export const HERO_PINS: PlaceKey[] = ["nantes", "abudhabi"];
export const FINALE_VIEW = { c: ll(30, 22), d: 4.6 };

/** Chapter id (the article's data-chapter) → its stops, in scroll order. */
export const CHAPTER_STOPS: Record<string, Stop[]> = {
  nantes: [stop("nantes", 1.95, { pins: ["nantes"] })],
  bordeaux: [stop("bordeaux", 1.95, { leg: 0, pins: ["bordeaux", "nantes"] })],
  coimbra: [stop("coimbra", 2.05, { leg: 1, pins: ["coimbra"] })],
  centrale: [stop("nantes", 2.05, { leg: 2, pins: ["nantes"], key: "nantes-2" })],
  odense: [stop("odense", 2.15, { leg: 3, pins: ["odense"] })],
  tii: [stop("abudhabi", 2.1, { leg: 4, pins: ["abudhabi"] })],
  travels: [
    stop("dubai", 1.9, { pins: ["dubai", "abudhabi"] }),
    stop("male", 2.3, { open: "male" }),
    stop("tokyo", 2.3),
    stop("yosemite", 2.2, { open: "yosemite" }),
    stop("lome", 2.3, { open: "lome" }),
    stop("paris", 2.1, { open: "paris" }),
  ],
  lead: [
    stop("abudhabi", 2.1, { pins: ["abudhabi"], key: "abudhabi-2" }),
    { c: POLAR, d: 4.3, leg: 5, pins: ["abudhabi", "pasadena"], key: "pasadena" },
  ],
  unchained: [{ c: ll(34, 16), d: 4.4, pins: [], key: "remote" }],
  sirb: [stop("abudhabi", 1.85, { pins: ["abudhabi"], key: "abudhabi-3" })],
};
