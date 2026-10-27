import * as THREE from "three";
import { archive, openSource } from "../content";
import { dotTexture, glow, ink, lineMat, rng } from "../core/util";
import { anchor, placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * Open source, as a sky. Every entry in the archive is a star, placed by the
 * year it started; the three upstream projects are the bright ones, linked
 * back to `guilyx` at the centre. Click any star to go to it.
 */
export function createOpenSource(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0.71);
  const group = placed(f);
  env.world.addMarker(f);

  const C = new THREE.Vector3(16, 62, -42);
  const star = (color: THREE.Color, size: number, opacity = 1) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dotTexture(),
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    s.scale.setScalar(size);
    return s;
  };

  const me = star(glow(ink.accent, 2.2), 4.2);
  me.position.copy(C);
  group.add(me);
  env.labels.add("opensource", me, "guilyx", { offset: new THREE.Vector3(0, -3.4, 0), cls: "accent", maxDist: 200 });

  const clickables: { object: THREE.Object3D; onClick: () => void }[] = [];
  const twinkle: { s: THREE.Sprite; base: number; ph: number }[] = [];

  // upstream: the bright ones
  const upstreamPos = [new THREE.Vector3(-12, 84, -60), new THREE.Vector3(26, 90, -70), new THREE.Vector3(46, 70, -40)];
  openSource.upstream.forEach((u, i) => {
    const s = star(glow(ink.heading, 1.8), 3.6);
    s.position.copy(upstreamPos[i]);
    group.add(s);
    twinkle.push({ s, base: 3.6, ph: i });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([C, upstreamPos[i]]), lineMat(ink.accent, 0.45)));
    env.labels.add("opensource", s, `${u.name} <span style="color:var(--faint)">· merged prs ↗</span>`, {
      offset: new THREE.Vector3(0, 3.6, 0),
      maxDist: 200,
    });
    clickables.push({ object: s, onClick: () => open(u.url, "_blank", "noopener") });
  });

  // the archive, by year, on an arc around the centre
  const r = rng(2018);
  const byYear = new Map<number, THREE.Vector3[]>();
  const sorted = [...archive].sort((a, b) => a.year - b.year);
  sorted.forEach((a, k) => {
    const ang = -2.5 + (k / (sorted.length - 1)) * 3.9 + (r() - 0.5) * 0.06;
    const rad = 26 + (k % 3) * 8 + r() * 4;
    const p = new THREE.Vector3(C.x + Math.cos(ang) * rad, C.y + Math.sin(ang) * rad * 0.55 + (r() - 0.5) * 8, C.z - 6 + (r() - 0.5) * 18);
    const size = a.madeAt ? 1.7 : 1.4;
    const s = star(glow(a.madeAt ? ink.body : ink.heading, 1.3), size, 0.95);
    s.position.copy(p);
    group.add(s);
    twinkle.push({ s, base: size, ph: r() * 10 });
    env.labels.add("opensource", s, a.title.toLowerCase(), { offset: new THREE.Vector3(0, -1.5, 0), maxDist: 95, cls: "year" });
    clickables.push({ object: s, onClick: () => open(a.url, "_blank", "noopener") });
    if (!byYear.has(a.year)) byYear.set(a.year, []);
    byYear.get(a.year)!.push(p);
  });
  // constellations: each year's stars joined in order
  for (const [year, pts] of byYear) {
    if (pts.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(ink.faint, 0.6)));
    const mid = pts.reduce((a, b) => a.clone().add(b), new THREE.Vector3()).divideScalar(pts.length);
    const out = mid.clone().sub(C).setZ(0).normalize().multiplyScalar(9);
    env.labels.add("opensource", anchor(group, mid.x + out.x, mid.y + out.y, mid.z), String(year), { maxDist: 200, cls: "accent" });
  }

  // a faint background field so the constellation sits in a sky, not a void
  const BG = 500;
  const bg = new Float32Array(BG * 3);
  for (let i = 0; i < BG; i++) bg.set([C.x + (r() - 0.5) * 220, C.y + (r() - 0.3) * 90, C.z - 30 - r() * 80], i * 3);
  group.add(
    new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(bg, 3)),
      new THREE.PointsMaterial({ color: ink.muted, size: 0.5, map: dotTexture(), transparent: true, depthWrite: false }),
    ),
  );
  env.labels.add("opensource", anchor(group, C.x, C.y + 30, C.z - 20), `since ${openSource.since} · ${archive.length} entries`, {
    maxDist: 220,
    cls: "tag",
  });

  return {
    id: "opensource",
    group,
    stops: [
      {
        id: "open-source",
        vh: 170,
        keys: [key(-14, 24, 40, 6, 56, -30), key(-14, 44, 18, 8, 63, -46), key(-2, 52, 2, 14, 66, -56)],
      },
    ],
    clickables,
    update(ctx) {
      for (const t of twinkle) t.s.scale.setScalar(t.base * (1 + Math.sin(ctx.time * 2.2 + t.ph) * 0.12));
      me.material.rotation = ctx.time * 0.2;
    },
  };
}
