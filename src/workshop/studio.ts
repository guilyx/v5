import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { PAL, at, box, cyl, merge, paint } from "./kit";

/** Where things are in the cell. The arm stands at the origin. */
export const CELL = {
  belt: { y: 0.5, z: 0.8, x0: 0.8, x1: 6.6, width: 0.48, pickX: 1.13, gap: 0.68 },
  shelf: { x: -0.8, z: -0.66, yaw: 0.46, front: 0.4, back: 0.74, depth: 0.44, pitch: 0.45, width: 1.92 },
  bench: { x: 2.05, z: -1.2, yaw: 0.1, top: 0.74 },
  screen: { w: 0.88, h: 0.53 },
};

/** The four-by-two display shelf: back row holds chapters 1–4, front row 5–8. */
export function slot(i: number): { pos: Vector3; yaw: number } {
  const s = CELL.shelf;
  const row = i < 4 ? 0 : 1;
  const col = i % 4;
  const lx = (col - 1.5) * s.pitch;
  const lz = row === 0 ? -s.depth / 2 : s.depth / 2;
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  return {
    pos: new Vector3(s.x + lx * c + lz * n, row === 0 ? s.back : s.front, s.z - lx * n + lz * c),
    yaw: s.yaw,
  };
}

function cyclorama(): BufferGeometry {
  // a floor that curves up into a wall: no horizon line, like a photo studio
  const R = 2.6;
  const zc = -3.2;
  const prof: [number, number, number, number][] = []; // z, y, nz, ny
  prof.push([14, 0, 0, 1], [zc, 0, 0, 1]);
  const N = 14;
  for (let i = 1; i <= N; i++) {
    const t = (i / N) * (Math.PI / 2);
    prof.push([zc - R * Math.sin(t), R - R * Math.cos(t), Math.sin(t), Math.cos(t)]);
  }
  prof.push([zc - R, 14, 1, 0]);
  const X = 20;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  prof.forEach(([z, y, nz, ny], i) => {
    pos.push(-X, y, z, X, y, z);
    nor.push(0, ny, nz, 0, ny, nz);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

function blobTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(40,32,20,0.55)");
  grd.addColorStop(0.45, "rgba(40,32,20,0.22)");
  grd.addColorStop(1, "rgba(40,32,20,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function beltTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a393e";
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#2c2b30";
  g.fillRect(0, 0, 18, 64);
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.fillRect(18, 0, 3, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export interface Studio {
  group: Group;
  belt: Mesh;
  beltTex: CanvasTexture;
  screen: Mesh;
  screenMat: MeshBasicMaterial;
  screenCenter: Vector3;
  screenNormal: Vector3;
  cyc: Mesh;
}

export function buildStudio(mat: Material): Studio {
  const group = new Group();

  const cycMat = new MeshStandardMaterial({ color: PAL.cyc, roughness: 1, metalness: 0 });
  const cyc = new Mesh(cyclorama(), cycMat);
  cyc.receiveShadow = true;
  group.add(cyc);

  // work envelope marked on the floor, like a real robot cell
  const env = new Mesh(paint(new RingGeometry(1.86, 1.885, 96, 1), PAL.joint), mat);
  env.rotation.x = -Math.PI / 2;
  env.position.y = 0.002;
  env.receiveShadow = true;
  group.add(env);

  // soft contact shadows under the heavy things
  // (all in one mesh: one texture, one draw call)
  const blobMat = new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false });
  const blobs: BufferGeometry[] = [];
  const blob = (x: number, z: number, sx: number, sz: number, ry = 0) => {
    const g = new PlaneGeometry(1, 1);
    g.scale(sx, sz, 1);
    g.rotateZ(ry);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.004, z);
    blobs.push(g);
  };
  blob(0, 0, 1.6, 1.6);

  // ── conveyor ──
  const B = CELL.belt;
  const len = B.x1 - B.x0;
  const mid = (B.x0 + B.x1) / 2;
  const parts: BufferGeometry[] = [
    at(box(len, 0.07, B.width - 0.01, PAL.bone, 0.01), mid, B.y - 0.04, B.z),
    at(box(len, 0.09, 0.035, PAL.graphite, 0.008), mid, B.y - 0.01, B.z + B.width / 2 + 0.02),
    at(box(len, 0.09, 0.035, PAL.graphite, 0.008), mid, B.y - 0.01, B.z - B.width / 2 - 0.02),
    at(box(len, 0.012, 0.012, PAL.joint), mid, B.y + 0.04, B.z + B.width / 2 + 0.032),
    at(cyl(0.05, 0.05, B.width + 0.06, PAL.graphite, 24), B.x0, B.y - 0.035, B.z, Math.PI / 2),
    at(cyl(0.052, 0.052, 0.02, PAL.joint, 24), B.x0, B.y - 0.035, B.z + B.width / 2 + 0.045, Math.PI / 2),
  ];
  for (let x = B.x0 + 0.25; x < B.x1; x += 1.1) {
    for (const dz of [-1, 1]) parts.push(at(box(0.05, B.y - 0.06, 0.05, PAL.graphite, 0.01), x, (B.y - 0.06) / 2, B.z + dz * (B.width / 2 - 0.02)));
    parts.push(at(box(0.04, 0.04, B.width - 0.04, PAL.graphite), x, 0.12, B.z));
    blob(x, B.z, 0.7, 0.9);
  }
  // a little sensor gate the objects roll under before the pick
  const gx = B.pickX + 0.42;
  const gh = 0.42;
  for (const dz of [-1, 1]) parts.push(at(box(0.04, gh, 0.04, PAL.graphite, 0.008), gx, B.y + gh / 2 - 0.03, B.z + dz * (B.width / 2 + 0.05)));
  parts.push(at(box(0.06, 0.05, B.width + 0.16, PAL.joint, 0.012), gx, B.y + gh - 0.02, B.z));
  parts.push(at(box(0.03, 0.012, 0.06, "#7fd3a2", 0.004), gx + 0.02, B.y + gh + 0.01, B.z));

  // ── display shelf: two birch steps facing the camera ──
  const S = CELL.shelf;
  const shelf: BufferGeometry[] = [
    at(box(S.width, S.front, S.depth, PAL.birch, 0.02), 0, S.front / 2, S.depth / 2),
    at(box(S.width, S.back, S.depth, PAL.birch, 0.02), 0, S.back / 2, -S.depth / 2),
    at(box(S.width + 0.01, 0.03, S.depth + 0.01, PAL.birchEdge, 0.01), 0, S.front - 0.015, S.depth / 2),
    at(box(S.width + 0.01, 0.03, S.depth + 0.01, PAL.birchEdge, 0.01), 0, S.back - 0.015, -S.depth / 2),
    at(box(S.width - 0.04, 0.05, 0.02, PAL.graphite), 0, 0.025, S.depth + 0.0),
  ];
  // slot pads: a thin graphite square with a yellow corner mark
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1;
    const lx = ((i % 4) - 1.5) * S.pitch;
    const lz = row === 0 ? -S.depth / 2 : S.depth / 2;
    const y = row === 0 ? S.back : S.front;
    shelf.push(at(box(0.38, 0.006, 0.34, "#cdb995", 0.003), lx, y + 0.003, lz));
    shelf.push(at(box(0.06, 0.007, 0.014, PAL.joint), lx - 0.16, y + 0.0035, lz + 0.163));
    shelf.push(at(box(0.014, 0.007, 0.06, PAL.joint), lx - 0.183, y + 0.0035, lz + 0.14));
  }
  const shelfGeo = merge(shelf);
  shelfGeo.rotateY(S.yaw);
  shelfGeo.translate(S.x, 0, S.z);
  parts.push(shelfGeo);
  blob(S.x, S.z, 2.3, 1.3, S.yaw);

  // ── bench with a monitor (the clips play here) ──
  const Bn = CELL.bench;
  const sw = CELL.screen.w;
  const sh = CELL.screen.h;
  const sy = Bn.top + 0.33 + sh / 2;
  const bench: BufferGeometry[] = [
    at(box(1.25, 0.05, 0.62, PAL.birch, 0.015), 0, Bn.top - 0.025, 0),
    at(box(0.06, 0.03, 0.6, PAL.birchEdge, 0.01), 0, Bn.top - 0.05, 0),
    at(box(0.26, 0.016, 0.18, PAL.graphite, 0.006), 0, Bn.top + 0.008, -0.08),
    at(box(0.05, 0.36, 0.035, PAL.graphite, 0.01), 0, Bn.top + 0.18, -0.11),
    at(box(sw + 0.05, sh + 0.05, 0.04, PAL.graphite, 0.016), 0, sy, -0.085),
    at(box(0.06, 0.012, 0.012, PAL.joint), 0, sy - sh / 2 - 0.014, -0.064),
    // keyboard + a mug
    at(box(0.42, 0.018, 0.14, PAL.arm, 0.008), -0.05, Bn.top + 0.009, 0.16),
    at(box(0.38, 0.006, 0.1, PAL.armShade, 0.003), -0.05, Bn.top + 0.02, 0.16),
    at(cyl(0.045, 0.04, 0.1, PAL.arm, 20), 0.46, Bn.top + 0.05, 0.12),
    at(cyl(0.046, 0.046, 0.02, PAL.joint, 20), 0.46, Bn.top + 0.07, 0.12),
  ];
  for (const [x, z] of [[-0.56, -0.25], [0.56, -0.25], [-0.56, 0.25], [0.56, 0.25]]) bench.push(at(box(0.045, Bn.top - 0.05, 0.045, PAL.graphite, 0.01), x, (Bn.top - 0.05) / 2, z));
  const benchGeo = merge(bench);
  benchGeo.rotateY(Bn.yaw);
  benchGeo.translate(Bn.x, 0, Bn.z);
  parts.push(benchGeo);
  blob(Bn.x, Bn.z, 1.8, 1.1, Bn.yaw);

  const blobMesh = new Mesh(merge(blobs), blobMat);
  blobMesh.renderOrder = 1;
  group.add(blobMesh);

  const statics = new Mesh(merge(parts), mat);
  statics.castShadow = true;
  statics.receiveShadow = true;
  group.add(statics);

  // belt surface: a striped texture that slides with the objects
  const beltTex = beltTexture();
  beltTex.repeat.set(len / 0.2, 1);
  const belt = new Mesh(new PlaneGeometry(len, B.width - 0.02), new MeshStandardMaterial({ map: beltTex, roughness: 0.9 }));
  belt.rotation.x = -Math.PI / 2;
  belt.position.set(mid, B.y - 0.004, B.z);
  belt.receiveShadow = true;
  group.add(belt);

  // chapter numbers along the shelf steps, so the shelf reads like the page
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 1024;
  labelCanvas.height = 128;
  const labelTex = new CanvasTexture(labelCanvas);
  labelTex.colorSpace = SRGBColorSpace;
  labelTex.anisotropy = 4;
  const drawLabels = () => {
    const g = labelCanvas.getContext("2d")!;
    g.clearRect(0, 0, 1024, 128);
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 512 + (((col - 1.5) * S.pitch) / S.width) * 1024;
        const y = 32 + row * 64;
        g.fillStyle = "rgba(43,42,46,0.85)";
        g.font = '600 34px "Geist Variable", system-ui, sans-serif';
        g.fillText(String(row * 4 + col + 1).padStart(2, "0"), x, y + 1);
      }
    }
    labelTex.needsUpdate = true;
  };
  drawLabels();
  document.fonts?.load('600 34px "Geist Variable"').then(drawLabels).catch(() => {});
  const labelMat = new MeshStandardMaterial({ map: labelTex, transparent: true, roughness: 0.9, depthWrite: false });
  const shelfLabels = new Group();
  for (let row = 0; row < 2; row++) {
    const geo = new PlaneGeometry(S.width, 0.09);
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? 1 - row * 0.5 : 0.5 - row * 0.5);
    const m = new Mesh(geo, labelMat);
    // back step (01–04) shows its face above the front step; front step (05–08) faces you
    m.position.set(0, row === 0 ? S.front + (S.back - S.front) * 0.5 : S.front * 0.55, row === 0 ? 0.002 : S.depth + 0.002);
    shelfLabels.add(m);
  }
  shelfLabels.rotation.y = S.yaw;
  shelfLabels.position.set(S.x, 0, S.z);
  group.add(shelfLabels);

  // the screen
  const screenMat = new MeshBasicMaterial({ color: PAL.screen, toneMapped: false });
  const screen = new Mesh(new PlaneGeometry(sw, sh), screenMat);
  const sc = new Vector3(0, sy, -0.063);
  screen.position.copy(sc);
  const holder = new Group();
  holder.position.set(Bn.x, 0, Bn.z);
  holder.rotation.y = Bn.yaw;
  holder.add(screen);
  group.add(holder);
  holder.updateMatrixWorld(true);
  const screenCenter = screen.getWorldPosition(new Vector3());
  const screenNormal = new Vector3(Math.sin(Bn.yaw), 0, Math.cos(Bn.yaw));

  return { group, belt, beltTex, screen, screenMat, screenCenter, screenNormal, cyc };
}
