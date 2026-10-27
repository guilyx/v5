import { P } from "./palette";

/** heights in the diorama */
export const WATER_Y = 0.12;
export const BEACH_Y = 0.32;
export const TOP_Y = 0.44;
export const PLATEAU_Y = 0.98;
export const DISC_R = 11;

export type TreeKind = "round" | "pine" | "palm" | "olive" | "blossom";

export interface District {
  id: string;
  name: string;
  country: string;
  x: number;
  z: number;
  r: number;
  seed: number;
  grass: string;
  edge: string;
  trees: TreeKind[];
  treeCount: number;
  /** a raised plateau in the middle (Coimbra's hill) */
  plateau?: number;
}

export const DISTRICTS: District[] = [
  { id: "nantes", name: "Nantes", country: "France", x: -6.1, z: -1.2, r: 2.9, seed: 1, grass: P.grass, edge: P.grassDark, trees: ["round", "round", "blossom"], treeCount: 24 },
  { id: "bordeaux", name: "Bordeaux", country: "France", x: -3.3, z: 4.9, r: 2.5, seed: 2, grass: "#c3d7a0", edge: "#a2bb85", trees: ["round", "olive"], treeCount: 12 },
  { id: "coimbra", name: "Coimbra", country: "Portugal", x: 2.4, z: 7.0, r: 2.65, seed: 3, grass: "#c8d69f", edge: "#aab984", trees: ["olive", "round"], treeCount: 16, plateau: 1.62 },
  { id: "odense", name: "Odense", country: "Denmark", x: -1.6, z: -6.3, r: 2.6, seed: 4, grass: "#b0d2b0", edge: "#8fb795", trees: ["pine", "pine", "round"], treeCount: 22 },
  { id: "abudhabi", name: "Abu Dhabi", country: "UAE", x: 5.6, z: 0.2, r: 3.7, seed: 5, grass: "#efdcb6", edge: P.sandDark, trees: ["palm"], treeCount: 18 },
  { id: "remote", name: "Remote", country: "work & home", x: 4.1, z: -6.5, r: 2.35, seed: 6, grass: "#c9dcb4", edge: "#a8c193", trees: ["blossom", "round"], treeCount: 8 },
];

export const districtById = new Map(DISTRICTS.map((d) => [d.id, d]));

/** a soft, irregular island outline, CCW seen from above */
export function outline(d: District, scale = 1, n = 30): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.035 * Math.sin(3 * a + d.seed * 1.7) + 0.025 * Math.sin(5 * a + d.seed * 2.9);
    const r = d.r * scale * k;
    pts.push([d.x + Math.cos(a) * r, d.z + Math.sin(a) * r]);
  }
  return pts;
}

/** bridges join the districts in a ring around the lagoon */
export const BRIDGES: [string, string][] = [
  ["nantes", "bordeaux"],
  ["bordeaux", "coimbra"],
  ["coimbra", "abudhabi"],
  ["abudhabi", "remote"],
  ["remote", "odense"],
  ["odense", "nantes"],
];
