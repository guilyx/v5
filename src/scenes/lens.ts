import * as THREE from "three";
import { photoTrips, type Photo } from "../content";
import { ink, lineMat, rng } from "../core/util";
import type { Lightbox } from "../ui/lightbox";
import { anchor, placed } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * Through the Lens. Every photo from the trips in between, hung in the air
 * along the route, one trip after another. Textures load as you approach;
 * click a frame for the full-size print.
 */
export function createLens(env: SceneEnv, lightbox: Lightbox): Scene {
  const f = env.world.frame(1, 0.8);
  const group = placed(f);
  env.world.addMarker(f);
  const loader = new THREE.TextureLoader();
  const r = rng(2023);

  const all: Photo[] = photoTrips.flatMap((t) => t.photos);
  const frames: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; photo: Photo; idx: number; loaded: boolean; holder: THREE.Group; ph: number }[] = [];
  const tripStart: number[] = [];
  const STEP = 2.4;
  const GAP = 9;
  let z = 0;
  let idx = 0;

  photoTrips.forEach((trip, ti) => {
    tripStart.push(z);
    env.labels.add("lens", anchor(group, -9, 13, z - 2), `<b>${String(ti + 1).padStart(2, "0")}</b> ${trip.name.toLowerCase()}`, {
      cls: "tag",
      maxDist: 90,
    });
    env.labels.add("lens", anchor(group, -9, 11.2, z - 2), trip.when, { cls: "year", maxDist: 70 });
    trip.photos.forEach((p, k) => {
      // two loose ranks on the right, varied height and depth
      const rank = k % 2;
      const x = 5 + rank * 7 + (r() - 0.5) * 3;
      const y = 3.5 + r() * 11;
      const pz = z - k * STEP - (r() - 0.5) * 1.2;
      const holder = new THREE.Group();
      holder.position.set(x, y, pz);
      holder.rotation.y = -0.5 - rank * 0.15 + (r() - 0.5) * 0.2;
      holder.rotation.z = (r() - 0.5) * 0.05;
      const mat = new THREE.MeshBasicMaterial({ color: ink.raised.clone() });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      // landscape by default; corrected to the real aspect once the texture lands
      mesh.scale.set(5.4, 3.6, 1);
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.06, 1.08)),
        lineMat(ink.faint),
      );
      mesh.add(border);
      holder.add(mesh);
      group.add(holder);
      frames.push({ mesh, mat, photo: p, idx, loaded: false, holder, ph: r() * 10 });
      idx++;
    });
    z -= trip.photos.length * STEP + GAP;
  });
  const END = z;

  const load = (fr: (typeof frames)[number]) => {
    if (fr.loaded) return;
    fr.loaded = true;
    loader.load(`/photos/sm/${fr.photo.file}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image as HTMLImageElement;
      const aspect = img.width / img.height;
      const long = 5.6;
      fr.mesh.scale.set(aspect >= 1 ? long : long * aspect, aspect >= 1 ? long / aspect : long, 1);
      fr.mat.map = tex;
      fr.mat.color.setScalar(0.94);
      fr.mat.needsUpdate = true;
    });
  };

  const items = () => Array.from(document.querySelectorAll<HTMLElement>("[data-trip]"));
  let activeTrip = -2;
  const camLocal = new THREE.Vector3();

  return {
    id: "lens",
    group,
    stops: [
      {
        id: "lens",
        vh: 320,
        keys: [
          key(-8, 9, 20, 4, 8, -14),
          key(-7, 9, -24, 5, 8, -58),
          key(-7, 9, -68, 5, 8, -102),
          key(-7, 9, -112, 5, 8, -146),
          key(-6, 10, END + 6, 4, 8, END - 30),
        ],
      },
    ],
    clickables: frames.map((fr) => ({ object: fr.mesh, onClick: () => lightbox.open(all, fr.idx) })),
    update(ctx) {
      camLocal.copy(ctx.camera.position);
      group.worldToLocal(camLocal);
      for (const fr of frames) {
        if (!fr.loaded && fr.holder.position.z > camLocal.z - 70 && ctx.u > -0.5) load(fr);
        fr.holder.position.y += Math.sin(ctx.time * 0.7 + fr.ph) * 0.004;
      }
      let t = -1;
      tripStart.forEach((s, i) => {
        if (camLocal.z < s + 14) t = i;
      });
      if (ctx.u < -0.05 || ctx.u > 1.05) t = -1;
      if (t !== activeTrip) {
        activeTrip = t;
        items().forEach((el) => el.classList.toggle("on", Number(el.dataset.trip) === t));
      }
    },
  };
}
