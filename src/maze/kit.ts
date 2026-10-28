import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { H, type RoomDef, W } from "./layout";
import { SANS, SERIF, quad, spaced, spacedWidth } from "./paint";
import { clay, plain, tint } from "./gfx";
import type { Ctx, Det } from "./props";

/** Shared pieces for building rooms: positions, a primitive kit, glow, detections, floor paint. */

export const gx = (x: number) => x - W / 2;
export const gz = (z: number) => z - H / 2;
export const cellAt = (r: RoomDef, rx: number, ry: number): [number, number] => [gx(r.x + rx + 0.5), gz(r.y + ry + 0.5)];

/** collects tinted primitives and merges them into one mesh */
export class Kit {
  parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
    this.parts.push(tint(plain(g), color));
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color);
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 18, rot?: [number, number, number]) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rot) {
      g.rotateX(rot[0]);
      g.rotateY(rot[1]);
      g.rotateZ(rot[2]);
    }
    g.translate(x, y, z);
    return this.add(g, color);
  }
  mesh(opts: { emissive?: number } = {}) {
    const m = new THREE.Mesh(mergeGeometries(this.parts), clay({ vertexColors: true, emissive: opts.emissive }));
    return m;
  }
}

/** brighten an object's clay materials while it's pointed at */
export function glow(objs: THREE.Object3D[]) {
  const mats: { m: THREE.ShaderMaterial; base: number }[] = [];
  for (const o of objs)
    o.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && m.uniforms?.uEmissive && !mats.some((x) => x.m === m)) mats.push({ m, base: m.uniforms.uEmissive.value });
    });
  return (on: boolean) => {
    for (const { m, base } of mats) m.uniforms.uEmissive.value = on ? Math.min(1, base + 0.3) : base;
  };
}

export const detOf = (key: string, cls: string, label = cls): Det => ({ key, cls, label, box: new THREE.Box3() });
/** boxes of an instanced mesh's instances, from its geometry's bounds */
export function instanceBoxes(mesh: THREE.InstancedMesh, dets: Det[], grow = 0) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const m = new THREE.Matrix4();
  dets.forEach((d, i) => {
    mesh.getMatrixAt(i, m);
    d.box.copy(geo.boundingBox!).applyMatrix4(m).expandByScalar(grow);
  });
}

/** an invisible box that only the hover ray sees (the ray doesn't skip hidden meshes) */
export function hitBox(w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  m.visible = false;
  return m;
}


export const PX = 112; // atlas pixels per world unit

/** a small painted word on the floor */
export function paintWord(ctx: Ctx, text: string, color: string, x: number, z: number, px = 34, tracking = 5) {
  const c = ctx.atlas.ctx;
  c.font = `700 ${px}px ${SANS}`;
  const w = spacedWidth(c, text, tracking) + 12;
  const h = px * 1.3;
  ctx.atlas.queue(
    w,
    h,
    (k) => {
      k.font = `700 ${px}px ${SANS}`;
      k.fillStyle = color;
      k.textBaseline = "middle";
      spaced(k, text, 6, h / 2 + 1, tracking);
    },
    (uv) => ctx.decals.push(quad(x, 0.005, z, w / PX, h / PX, uv)),
  );
}

/** a big number with a caption, painted like a floor marking */
export function paintStat(ctx: Ctx, big: string, small: string, color: string, x: number, z: number) {
  const c = ctx.atlas.ctx;
  c.font = `italic 400 92px ${SERIF}`;
  const bw = c.measureText(big).width;
  c.font = `700 22px ${SANS}`;
  const sw = spacedWidth(c, small, 4);
  const w = Math.max(bw, sw) + 20;
  const h = 128;
  ctx.atlas.queue(
    w,
    h,
    (k) => {
      k.fillStyle = color;
      k.globalAlpha = 0.85;
      k.textAlign = "left";
      k.font = `italic 400 92px ${SERIF}`;
      k.fillText(big, (w - bw) / 2, 78);
      k.font = `700 22px ${SANS}`;
      spaced(k, small, (w - sw) / 2, 112, 4);
    },
    (uv) => ctx.decals.push(quad(x, 0.005, z, w / PX, h / PX, uv)),
  );
}

/** a screen on a board leaning on the north wall: draw on its canvas, then flush */
export function wallScreen(width: number, height: number, cw: number, ch: number, lean = 0.26) {
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const k = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const group = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), clay({ map: tex, emissive: 0.9 }));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, height + 0.14, 0.06), clay({ color: "#23272c" }));
  frame.position.z = -0.045;
  group.add(frame, face);
  return {
    group,
    face,
    k,
    cw,
    ch,
    /** stand it with its bottom edge at (x, y0, z), leaning back toward -z */
    stand(x: number, y0: number, z: number) {
      group.rotation.x = -lean;
      group.position.set(x, y0 + (height / 2) * Math.cos(lean), z - (height / 2) * Math.sin(lean));
    },
    flush() {
      tex.needsUpdate = true;
    },
  };
}
