/**
 * The places on the table. Words for each place live in index.html (the chapter
 * card it points to); this is only the index the city and the place sheet share.
 */
export interface Place {
  id: string;
  name: string;
  where: string;
  when: string;
  /** chapter number it is built in (1..9), or 10 for the map at the end */
  chapter: number;
  /** element whose content the place sheet shows */
  source: string;
}

export const PLACES: Place[] = [
  { id: "nantes-uni", name: "Nantes Université", where: "Nantes", when: "2014–2018", chapter: 1, source: "ch-1" },
  { id: "hiventive", name: "Hiventive", where: "Bordeaux", when: "2018–2019", chapter: 2, source: "ch-2" },
  { id: "ynov", name: "Ynov Bordeaux", where: "Bordeaux", when: "2018–2019", chapter: 2, source: "ch-2" },
  { id: "maze", name: "Ingeniarius", where: "Coimbra", when: "2019", chapter: 3, source: "ch-3" },
  { id: "centrale", name: "Centrale Nantes", where: "Nantes", when: "2019–2021", chapter: 4, source: "ch-4" },
  { id: "coalescent", name: "Coalescent", where: "Odense", when: "2021–2022", chapter: 5, source: "ch-5" },
  { id: "tii", name: "TII", where: "Abu Dhabi", when: "2022–2024", chapter: 6, source: "ch-6" },
  { id: "tii-team", name: "TII, team lead", where: "Abu Dhabi", when: "2024–2026", chapter: 7, source: "ch-7" },
  { id: "unchained", name: "Unchained Labs", where: "Remote", when: "2024–now", chapter: 8, source: "ch-8" },
  { id: "sirb", name: "SIRB.AI", where: "Abu Dhabi", when: "2026–now", chapter: 9, source: "ch-9" },
  { id: "clanker", name: "Clanker Labs", where: "Home", when: "Off the clock", chapter: 10, source: "place-clanker" },
  { id: "court", name: "The court", where: "Home", when: "Off the clock", chapter: 10, source: "place-court" },
];

export const placeById = new Map(PLACES.map((p) => [p.id, p]));

/** which place the camera visits at each stop (0 = hero, 10 = the map) */
export const STOP_PLACE: (string | null)[] = [
  null,
  "nantes-uni",
  "hiventive",
  "maze",
  "centrale",
  "coalescent",
  "tii",
  "tii-team",
  "unchained",
  "sirb",
  null,
];
