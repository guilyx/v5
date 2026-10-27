import * as THREE from "three";
import { builds, layers, type Layer } from "../content";
import { blueprint, ink, lineMat } from "../core/util";
import { anchor, placed } from "./kit";
import { key, type CamKey, type Scene, type SceneEnv, type StopDef } from "./types";

/**
 * Selected Builds. Every screen plays a real clip recorded from the project
 * running. Screens hang at the altitude the project runs at — in the field,
 * in the loop, on the metal — so the flight descends as it goes.
 * Clips load only when you get close, and only the one you're facing plays.
 */
const TIERS: { layer: Layer; y: number; side: 1 | -1; z0: number }[] = [
  { layer: "field", y: 34, side: 1, z0: 0 },
  { layer: "agent", y: 19, side: -1, z0: -70 },
  { layer: "machine", y: 6, side: 1, z0: -118 },
];
const SPACING = 24;
const SW = 15;

export function createBuilds(env: SceneEnv): Scene {
  const f = env.world.frame(1, 0.55);
  const group = placed(f);
  env.world.addMarker(f);
  const loader = new THREE.TextureLoader();

  const screens: {
    i: number;
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    video?: HTMLVideoElement;
    vtex?: THREE.VideoTexture;
    posterLoaded: boolean;
  }[] = [];
  const stops: StopDef[] = [];
  const order: number[] = [];

  TIERS.forEach((tier) => {
    const keys: CamKey[] = [];
    const members = builds.map((b, i) => ({ b, i })).filter(({ b }) => b.layer === tier.layer);
    members.forEach(({ b, i }, k) => {
      const z = tier.z0 - k * SPACING;
      const x = tier.side * 12;
      const h = SW / b.aspect;
      const holder = new THREE.Group();
      holder.position.set(x, tier.y, z);
      holder.rotation.y = -tier.side * 0.34;
      group.add(holder);

      const frame = blueprint(new THREE.BoxGeometry(SW + 0.8, h + 0.8, 0.4), { fill: ink.deep, edge: ink.muted });
      frame.position.z = -0.25;
      holder.add(frame);
      const mat = new THREE.MeshBasicMaterial({ color: ink.raised.clone() });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SW, h), mat);
      holder.add(mesh);
      // hung from the sky at its altitude: a cable up, a plumb line down
      holder.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -h / 2 - 0.4, -0.25), new THREE.Vector3(0, -tier.y, -0.25)]),
          lineMat(ink.line),
        ),
      );
      env.labels.add("builds", holder, `${b.title.toLowerCase()} <span style="color:var(--faint)">· ${layers[b.layer]} · ${tier.y} m</span>`, {
        offset: new THREE.Vector3(-SW / 2 + 2, h / 2 + 1.4, 0),
        maxDist: 90,
      });
      screens.push({ i, mesh, mat, posterLoaded: false });
      order.push(i);

      // the shot: square-on, the screen off to the side the panel isn't on
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), holder.rotation.y);
      const center = holder.position.clone();
      const pos = center.clone().addScaledVector(normal, 24).add(new THREE.Vector3(0, 1.2, 0));
      const look = center.clone().add(new THREE.Vector3(-tier.side * 4.5, 0, -2));
      keys.push(key(pos.x, pos.y, pos.z, look.x, look.y, look.z));
    });
    stops.push({ id: `builds-${tier.layer}`, vh: 60 + keys.length * 45, keys });
  });

  TIERS.forEach((t) =>
    env.labels.add("builds", anchor(group, -t.side * 4, t.y + 9, t.z0 + 10), `${layers[t.layer]} · ${t.y} m`, {
      cls: "tag",
      maxDist: 120,
    }),
  );

  const ensurePoster = (s: (typeof screens)[number]) => {
    if (s.posterLoaded) return;
    s.posterLoaded = true;
    loader.load(builds[s.i].poster, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      if (!s.vtex) {
        s.mat.map = tex;
        s.mat.color.setScalar(0.92);
        s.mat.needsUpdate = true;
      }
    });
  };
  const ensureVideo = (s: (typeof screens)[number]) => {
    if (s.video) return s.video;
    const v = document.createElement("video");
    v.src = builds[s.i].video;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    s.video = v;
    v.addEventListener("playing", () => {
      if (!s.vtex) {
        s.vtex = new THREE.VideoTexture(v);
        s.vtex.colorSpace = THREE.SRGBColorSpace;
      }
      s.mat.map = s.vtex;
      s.mat.color.setScalar(0.92);
      s.mat.needsUpdate = true;
    });
    return v;
  };

  let active = -1;
  const items = () => Array.from(document.querySelectorAll<HTMLElement>("[data-build]"));

  return {
    id: "builds",
    group,
    stops,
    clickables: screens.map((s) => ({ object: s.mesh, onClick: () => open(builds[s.i].external, "_blank", "noopener") })),
    update(ctx) {
      // posters come in as the scene approaches
      if (ctx.u > -0.6) screens.forEach(ensurePoster);
      const n = screens.length;
      const near = ctx.u > -0.05 && ctx.u < 1.02;
      const a = near ? Math.min(n - 1, Math.max(0, Math.floor(ctx.u * n + 0.35))) : -1;
      if (a !== active) {
        screens.forEach((s, k) => {
          if (k === a) ensureVideo(s).play().catch(() => {});
          else s.video?.pause();
        });
        const id = a >= 0 ? order[a] : -1;
        items().forEach((el) => el.classList.toggle("on", Number(el.dataset.build) === id));
        active = a;
      }
    },
  };
}
