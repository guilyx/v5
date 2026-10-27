import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { oakTexture } from "./textures";

/** Where each chapter sits along the desk. Left = 2014, right = now. */
export const STATION_X: Record<string, number> = {
  hero: 0,
  school: 11,
  hiventive: 22,
  coimbra: 33,
  centrale: 44,
  coalescent: 55,
  tii: 66,
  lead: 77,
  unchained: 88,
  sirb: 99,
  after: 112,
};
export const STATION_ORDER = Object.keys(STATION_X);

export const DESK = { x0: -18, x1: 132, z0: -8.5, z1: 6.5, thick: 0.9 };
export const WALL_Z = -9.1;
export const WINDOW_SPACING = 11;

export function buildDesk(scene: THREE.Scene, small: boolean) {
  const len = DESK.x1 - DESK.x0;
  const depth = DESK.z1 - DESK.z0;
  const oak = oakTexture(small ? 1024 : 2048, small ? 512 : 1024);
  oak.wrapS = THREE.RepeatWrapping;
  oak.wrapT = THREE.ClampToEdgeWrapping;
  const tile = 26; // one texture repeat every 2.6 m of desk
  const top = oak.clone();
  top.repeat.set(len / tile, 1);
  const edge = oak.clone();
  edge.repeat.set(len / tile, 0.08);
  edge.offset.set(0, 0.4);
  const side = oak.clone();
  side.repeat.set(depth / tile, 0.08);

  const oakTop = new THREE.MeshStandardMaterial({ map: top, roughness: 0.62, metalness: 0, envMapIntensity: 0.7, color: 0xffffff });
  const oakEdge = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.55, color: 0xe8d6c2, envMapIntensity: 0.7 });
  const oakSide = new THREE.MeshStandardMaterial({ map: side, roughness: 0.55, color: 0xd9c4ad, envMapIntensity: 0.7 });

  const geo = new RoundedBoxGeometry(len, DESK.thick, depth, 4, 0.22);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const desk = new THREE.Mesh(geo, [oakSide, oakSide, oakTop, oakEdge, oakEdge, oakEdge]);
  desk.position.set((DESK.x0 + DESK.x1) / 2, -DESK.thick / 2, (DESK.z0 + DESK.z1) / 2);
  desk.receiveShadow = true;
  desk.castShadow = false;
  scene.add(desk);

  // the floor far below, only seen past the desk's front edge
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6a5242, roughness: 1 }),
  );
  floor.position.set(60, -14, 80);
  floor.receiveShadow = false;
  scene.add(floor);

  return { desk, oak };
}

/** The wall behind the desk: tall windows with thin glazing bars, a glowing sky beyond.
    The sun comes through them, so the bars draw soft lines of shadow across the oak. */
export function buildRoom(scene: THREE.Scene) {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z = WALL_Z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  const y0 = 2.4; // sill, above the desk top
  const y1 = 21; // head of the window
  const opening = WINDOW_SPACING - 2.2;
  const pier = WINDOW_SPACING - opening;
  const xs = DESK.x0 - 40;
  const xe = DESK.x1 + 40;
  const t = 0.5;
  box(xe - xs, y0 + 16, t, (xs + xe) / 2, y0 - (y0 + 16) / 2);
  box(xe - xs, 12, t, (xs + xe) / 2, y1 + 6);
  box(xe - xs, 0.22, 1.0, (xs + xe) / 2, y0 + 0.11, WALL_Z + 0.35); // the sill ledge
  for (let cx = -WINDOW_SPACING * 5; cx < xe; cx += WINDOW_SPACING) {
    box(pier, y1 - y0, t, cx + WINDOW_SPACING / 2, (y0 + y1) / 2);
    for (const f of [-1 / 6, 1 / 6]) box(0.16, y1 - y0, 0.2, cx + f * opening, (y0 + y1) / 2); // glazing bars
    for (const f of [1 / 3, 2 / 3]) box(opening, 0.16, 0.2, cx, y0 + (y1 - y0) * f);
  }
  const wall = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ color: 0xe9dcc8, roughness: 0.95 }));
  wall.castShadow = true;
  wall.receiveShadow = false;
  scene.add(wall);

  // the sky through the windows: a soft vertical gradient, tinted by the time of day
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(xe - xs + 200, 80),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false,
      toneMapped: false,
      map: canvasGradient(),
    }),
  );
  sky.position.set((xs + xe) / 2, 20, WALL_Z - 6);
  scene.add(sky);
  return { wall, sky: sky.material as THREE.MeshBasicMaterial };
}

function canvasGradient() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#c9d6e2");
  g.addColorStop(0.55, "#f3efe6");
  g.addColorStop(1, "#fff7ea");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
