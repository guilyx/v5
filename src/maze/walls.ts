import * as THREE from "three";
import { H, type Maze, ROOMS, W, WALL, facade, idx, outdoors, wallRuns } from "./layout";
import { FRAME_H, WALL_H, WALL_T } from "./floor";
import { PAL, clay } from "./gfx";

/** Every wall of the maze in one InstancedMesh: a few hundred boxes, one draw call. */
export function buildWalls(m: Maze) {
  const chip = ROOMS.findIndex((r) => r.id === "hiventive");
  const wall = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m.grid[idx(x, y)] === WALL;
  // inside: clay; the chip's package: graphite; the building's outer wall: plaster; outdoors: rammed earth
  const group = (x: number, y: number) =>
    x === 0 || y === 0 || x === W - 1 || y === H - 1
      ? outdoors(x, y) && !facade(x, y)
        ? 5
        : 1
      : m.ringOf[idx(x, y)] === chip
        ? 2
        : facade(x, y)
          ? 4
          : outdoors(x, y)
            ? 3
            : 0;
  const colors = [PAL.clay, PAL.frame, PAL.graphite, PAL.earth, PAL.plaster, PAL.earthFrame].map((c) => new THREE.Color(c));
  const heights = [WALL_H, FRAME_H, WALL_H + 0.04, WALL_H, FRAME_H, FRAME_H];
  const runs = wallRuns(W, H, wall, group, WALL_T);

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), clay({ bevel: true }), runs.length);
  const mtx = new THREE.Matrix4();
  runs.forEach((b, k) => {
    // vertical runs sit a hair lower so overlapping tops never flicker
    const hh = heights[b.g] - (b.v ? 0.002 : 0);
    mtx.makeScale(b.sx, hh, b.sz);
    mtx.setPosition(b.cx - W / 2, hh / 2, b.cz - H / 2);
    mesh.setMatrixAt(k, mtx);
    mesh.setColorAt(k, colors[b.g]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "walls";
  return mesh;
}
