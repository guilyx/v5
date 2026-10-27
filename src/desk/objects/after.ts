import * as THREE from "three";
import { add, bake, canvasTex, cyl, FONT_SANS, FONT_SERIF, mat, paperFill, rbox, rng } from "../kit";
import { makeProp, type Prop } from "../props";
import { STATION_X } from "../world";
import { drawMark, printed, type Build } from "./common";

/* The end of the desk: the laptop that plays the side projects, the polaroids, the notebook,
   my card, a basketball and the lamp. */

export interface Project {
  key: string;
  title: string;
  text: string;
  links: { href: string; label: string }[];
  aspect: number;
}
export interface Photo {
  key: string;
  caption: string;
  full: string;
}

const ASPECT: Record<string, number> = { roue: 16 / 10, "clanker-labs": 1000 / 620 };

export function readProjects(): Project[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".project[data-key]")).map((el) => ({
    key: el.dataset.key!,
    title: el.querySelector("h3")!.childNodes[0].textContent!.trim(),
    text: el.querySelector("p")!.textContent!.trim(),
    links: Array.from(el.querySelectorAll<HTMLAnchorElement>(".links a")).map((a) => ({ href: a.href, label: a.textContent! })),
    aspect: ASPECT[el.dataset.key!] ?? 16 / 9,
  }));
}

export function readPhotos(): Photo[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(".polaroids a[data-photo]")).map((a) => ({
    key: a.dataset.photo!,
    caption: a.dataset.caption!,
    full: a.getAttribute("href")!,
  }));
}

export interface Laptop {
  prop: Prop;
  projects: Project[];
  index: number;
  show(i: number): void;
  /** play only while the laptop is in view (or held) */
  setActive(on: boolean): void;
  onChange: (i: number) => void;
}

const SCREEN_W = 4.2;
const SCREEN_H = 2.62;

export function buildAfter(b: Build, requestRender: () => void, reduced: boolean) {
  const X = STATION_X.after;

  /* ---------------- laptop ---------------- */
  const projects = readProjects();
  const lap = new THREE.Group();
  const alu = mat(0xc6c7ca, { metal: 0.55, rough: 0.36 });
  add(lap, rbox(4.7, 0.2, 3.25, 0.1), alu, 0, 0.1, 0);
  const deck = printed(4.36, 1.72, 1024, (ctx, w, h) => {
    ctx.fillStyle = "#b9babd";
    ctx.fillRect(0, 0, w, h);
    const rows = [14, 14, 13, 12, 9];
    rows.forEach((n, r) => {
      const kh = h / 5.4;
      const y = r * (h / 5) + 6;
      const kw = (w - 20) / 14.4;
      let x = 10 + (14 - n) * kw * 0.5;
      for (let i = 0; i < n; i++) {
        const wide = r === 4 && i === 4 ? kw * 5 : kw;
        ctx.fillStyle = "#2b2c2f";
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, wide - 6, kh - 6, 6);
        ctx.fill();
        x += wide;
      }
    });
  }, { rough: 0.5 });
  deck.position.set(0, 0.202, -0.55);
  deck.userData.noBake = true;
  lap.add(deck);
  add(lap, rbox(1.6, 0.01, 1.0, 0.004), mat(0xb4b5b8, { metal: 0.4, rough: 0.3 }), 0, 0.2, 0.95);
  const lid = new THREE.Group();
  lid.position.set(0, 0.2, -1.6);
  lid.rotation.x = -THREE.MathUtils.degToRad(108);
  add(lid, rbox(4.7, 0.12, 3.15, 0.1), alu, 0, 0.06, 1.575);
  const bezel = add(lid, new THREE.PlaneGeometry(4.55, 3.0).rotateX(Math.PI / 2), mat(0x141416, { rough: 0.25 }), 0, -0.004, 1.575);
  bezel.castShadow = false;
  const posterLoader = new THREE.TextureLoader();
  const posters = new Map<string, THREE.Texture>();
  const fit = (t: THREE.Texture, aspect: number) => {
    const screen = SCREEN_W / SCREEN_H;
    if (aspect > screen) {
      t.repeat.set(screen / aspect, 1);
      t.offset.set((1 - screen / aspect) / 2, 0);
    } else {
      t.repeat.set(1, aspect / screen);
      t.offset.set(0, (1 - aspect / screen) / 2);
    }
  };
  const screenMat = new THREE.MeshBasicMaterial({ color: 0xe6e6e6, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H).rotateX(Math.PI / 2), screenMat);
  screen.position.set(0, -0.008, 1.62);
  screen.userData.noBake = true;
  lid.add(screen);
  lap.add(lid);
  bake(lid, [screen]);
  bake(lap, [deck, lid]);
  lap.position.set(X - 2.2, 0, -1.3);
  lap.rotation.y = 0.06;

  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  const vtex = new THREE.VideoTexture(video);
  vtex.colorSpace = THREE.SRGBColorSpace;
  let active = false;
  let showingVideo = false;
  const poster = (key: string, aspect: number) => {
    let t = posters.get(key);
    if (!t) {
      t = posterLoader.load(`/work/${key}.webp`, () => requestRender());
      t.colorSpace = THREE.SRGBColorSpace;
      fit(t, aspect);
      posters.set(key, t);
    }
    return t;
  };
  const frameLoop = () => {
    if (!active || video.paused) return;
    requestRender();
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frameLoop);
    else requestAnimationFrame(frameLoop);
  };
  video.addEventListener("playing", () => {
    const p = projects[laptop.index];
    fit(vtex, p.aspect);
    screenMat.map = vtex;
    screenMat.needsUpdate = true;
    showingVideo = true;
    frameLoop();
  });
  const load = () => {
    const p = projects[laptop.index];
    screenMat.map = poster(p.key, p.aspect);
    screenMat.needsUpdate = true;
    showingVideo = false;
    requestRender();
    if (active && !reduced) {
      video.src = `/work/${p.key}.mp4`;
      video.play().catch(() => {});
    } else {
      video.removeAttribute("src");
      video.load();
    }
  };

  const laptop: Laptop = {
    prop: null as unknown as Prop,
    projects,
    index: 0,
    show(i) {
      this.index = (i + projects.length) % projects.length;
      load();
      this.onChange(this.index);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) load();
      else {
        video.pause();
        if (showingVideo) {
          // keep the last frame up as the poster would look
          const p = projects[laptop.index];
          screenMat.map = poster(p.key, p.aspect);
          screenMat.needsUpdate = true;
          showingVideo = false;
          requestRender();
        }
      }
    },
    onChange: () => {},
  };
  screenMat.map = poster(projects[0].key, projects[0].aspect);

  laptop.prop = makeProp(b.scene, {
    id: "laptop",
    name: "Laptop",
    meta: "Plays what I build on my own time · click for the next one",
    panel: "laptop",
    station: "after",
    group: lap,
    hand: { tilt: 0.42, yaw: 0, fill: 0.95 },
    liftHeight: 0.3,
    onHandClick: () => laptop.show(laptop.index + 1),
  });
  b.props.push(laptop.prop);

  /* ---------------- polaroids ---------------- */
  const photos = readPhotos();
  const cols = 4;
  const cw = 512;
  const chh = 640;
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = 2048;
  atlasCanvas.height = 2048;
  const actx = atlasCanvas.getContext("2d")!;
  actx.fillStyle = "#fbf9f4";
  actx.fillRect(0, 0, 2048, 2048);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  const drawCell = (i: number, img: HTMLImageElement | null) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = c * cw;
    const y = r * chh;
    const m = 30;
    const ph = cw - m * 2;
    actx.fillStyle = "#fbf9f4";
    actx.fillRect(x, y, cw, chh);
    if (img) {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      actx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x + m, y + m, ph, ph);
    } else {
      actx.fillStyle = "#ddd6c8";
      actx.fillRect(x + m, y + m, ph, ph);
    }
    actx.fillStyle = "rgba(0,0,0,0.06)";
    actx.fillRect(x + m, y + m + ph - 2, ph, 2);
    actx.fillStyle = "#2a2622";
    actx.textAlign = "center";
    actx.font = `italic 44px ${FONT_SERIF}`;
    const cap = photos[i].caption.split(" — ")[0].split(",")[0];
    actx.fillText(cap, x + cw / 2, y + m + ph + 76);
  };
  photos.forEach((_, i) => drawCell(i, null));
  let atlasLoading = false;
  const loadAtlas = () => {
    if (atlasLoading) return;
    atlasLoading = true;
    photos.forEach((p, i) => {
      const img = new Image();
      img.decoding = "async";
      img.src = `/photos/${p.key}-800.webp`;
      img
        .decode()
        .then(() => {
          drawCell(i, img);
          atlas.needsUpdate = true;
          requestRender();
        })
        .catch(() => {});
    });
  };

  const frameMat = mat(0xfbfaf6, { rough: 0.55 });
  const faceMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.42, metalness: 0 });
  const PW = 1.62;
  const PH = (PW * chh) / cw;
  const r = rng(23);
  const photoProps: Prop[] = [];
  photos.forEach((p, i) => {
    const g = new THREE.Group();
    add(g, rbox(PW, 0.03, PH, 0.02), frameMat, 0, 0.015, 0);
    const geo = new THREE.PlaneGeometry(PW - 0.01, PH - 0.01).rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    const c = i % cols;
    const row = Math.floor(i / cols);
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, ((c + uv.getX(k)) * cw) / 2048, 1 - ((row + 1) * chh) / 2048 + (uv.getY(k) * chh) / 2048);
    }
    const face = new THREE.Mesh(geo, faceMat);
    face.position.y = 0.031;
    face.receiveShadow = true;
    g.add(face);
    // a loose fan of photos
    const a = -0.9 + (i / (photos.length - 1)) * 1.8;
    const ring = i < 6 ? 2.0 : 3.6;
    const px = X + 4.3 + Math.sin(a * 1.4) * ring * 0.9 + (r() - 0.5) * 0.5;
    const pz = 0.6 - Math.cos(a) * ring * 0.55 + (i < 6 ? -0.4 : 1.0) + (r() - 0.5) * 0.4;
    g.position.set(px, i * 0.034, pz);
    g.rotation.y = (r() - 0.5) * 0.9;
    const pr = makeProp(b.scene, {
      id: `photo-${i}`,
      name: p.caption,
      meta: "A photo I took · click to look closer",
      panel: `photo:${i}`,
      station: "after",
      group: g,
      hand: { tilt: 1.28, yaw: 0, fill: 0.92 },
      liftHeight: 0.35,
      blob: { opacity: 0.3, scale: 1.05 },
    });
    b.props.push(pr);
    photoProps.push(pr);
  });

  /* ---------------- notebook (writing) ---------------- */
  const nb = new THREE.Group();
  add(nb, rbox(2.75, 0.07, 3.75, 0.08), mat(0x2f4a3b, { rough: 0.55 }), 0, 0.035, 0);
  add(nb, rbox(2.62, 0.26, 3.62, 0.03), mat(0xf1e9d8, { rough: 0.95 }), -0.04, 0.17, 0);
  add(nb, rbox(2.75, 0.07, 3.75, 0.08), mat(0x2f4a3b, { rough: 0.55 }), 0, 0.335, 0);
  add(nb, rbox(0.13, 0.4, 3.78, 0.03), mat(0x1c1c1c, { rough: 0.7 }), 0.95, 0.2, 0);
  add(nb, rbox(0.24, 0.012, 0.9, 0.004), mat(0xb03b16, { rough: 0.6 }), -0.6, 0.006, 2.1);
  const label = printed(1.5, 0.62, 384, (ctx, w, h) => {
    ctx.fillStyle = "#2f4a3b";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#d9c38a";
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = "#e8d39a";
    ctx.textAlign = "center";
    ctx.font = `italic ${Math.round(h * 0.55)}px ${FONT_SERIF}`;
    ctx.fillText("Notes", w / 2, h * 0.68);
  }, { rough: 0.5 });
  label.position.set(-0.2, 0.372, -0.6);
  label.userData.noBake = true;
  nb.add(label);
  bake(nb, [label]);
  nb.position.set(X - 7.1, 0, 1.4);
  nb.rotation.y = 0.18;
  b.props.push(
    makeProp(b.scene, { id: "notebook", name: "Notebook", meta: "My notes, papers and upstream code", panel: "writing", station: "after", group: nb, hand: { tilt: 1.1, yaw: 0, fill: 0.85 } }),
  );

  /* ---------------- envelope and card (contact) ---------------- */
  const env = new THREE.Group();
  add(env, rbox(3.5, 0.05, 2.3, 0.03), mat(0xd8bd92, { rough: 0.85 }), 0, 0.025, 0);
  const envTop = printed(3.46, 2.26, 768, (ctx, w, h) => {
    paperFill(ctx, w, h, "#dcc29a", 31);
    ctx.strokeStyle = "rgba(110,72,30,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w / 2, h * 0.58);
    ctx.lineTo(w, 0);
    ctx.stroke();
    ctx.fillStyle = "#3a2a1c";
    ctx.font = `italic ${Math.round(h * 0.1)}px ${FONT_SERIF}`;
    ctx.textAlign = "left";
    ctx.fillText("Write to me", w * 0.08, h * 0.86);
  }, { rough: 0.85 });
  envTop.position.y = 0.052;
  envTop.userData.noBake = true;
  env.add(envTop);
  // a wax seal with the mark
  const seal = printed(0.62, 0.62, 256, (ctx, w, h) => {
    ctx.fillStyle = "#9c2a12";
    ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const rr = w * (0.46 + (i % 2) * 0.03);
      ctx.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr);
    }
    ctx.fill();
    ctx.fillStyle = "#b8391a";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
    ctx.fill();
    drawMark(ctx, w * 0.25, h * 0.24, w * 0.5, "#6e1c0a", "#e2a084");
  }, { rough: 0.35 });
  seal.position.set(0, 0.062, -0.0);
  seal.userData.noBake = true;
  env.add(seal);
  bake(env, [envTop, seal]);
  env.position.set(X + 0.2, 0, 3.4);
  env.rotation.y = -0.1;
  b.props.push(makeProp(b.scene, { id: "envelope", name: "An envelope", meta: "How to reach me", panel: "contact", station: "after", group: env, hand: { tilt: 1.2, yaw: 0, fill: 0.85 }, liftHeight: 0.3 }));

  const card = new THREE.Group();
  add(card, rbox(2.1, 0.03, 1.2, 0.03), mat(0xfbfaf6, { rough: 0.6 }), 0, 0.015, 0);
  const cardFace = printed(2.08, 1.18, 768, (ctx, w, h) => {
    paperFill(ctx, w, h, "#fbfaf6", 41);
    drawMark(ctx, w * 0.8, h * 0.1, h * 0.26, "#2a2119", "#b03b16");
    ctx.fillStyle = "#1f1914";
    ctx.textAlign = "left";
    ctx.font = `${Math.round(h * 0.17)}px ${FONT_SERIF}`;
    ctx.fillText("Erwin Lejeune", w * 0.08, h * 0.32);
    ctx.fillStyle = "#5a4a3c";
    ctx.font = `500 ${Math.round(h * 0.068)}px ${FONT_SANS}`;
    ctx.fillText("Head of Robotics · SIRB.AI · Abu Dhabi", w * 0.08, h * 0.45);
    ctx.fillStyle = "#233f7a";
    ctx.font = `500 ${Math.round(h * 0.075)}px ${FONT_SANS}`;
    ctx.fillText("erwin.lejeune15@gmail.com", w * 0.08, h * 0.7);
    ctx.fillStyle = "#5a4a3c";
    ctx.fillText("github.com/guilyx", w * 0.08, h * 0.83);
    ctx.fillStyle = "#b03b16";
    ctx.fillRect(w * 0.08, h * 0.52, w * 0.12, 3);
  }, { rough: 0.6 });
  cardFace.position.y = 0.031;
  cardFace.userData.noBake = true;
  card.add(cardFace);
  bake(card, [cardFace]);
  card.position.set(X + 0.6, 0.06, 3.0);
  card.rotation.y = 0.16;
  b.props.push(makeProp(b.scene, { id: "card", name: "My card", meta: "Email, GitHub, LinkedIn", panel: "contact", station: "after", group: card, hand: { tilt: 1.25, yaw: 0, fill: 0.8 }, liftHeight: 0.3, blob: { opacity: 0.25 } }));

  /* ---------------- basketball (off the clock) ---------------- */
  const ballTex = canvasTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = "#c9622a";
    ctx.fillRect(0, 0, w, h);
    const rr = rng(33);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = rr() > 0.5 ? "rgba(90,30,8,0.18)" : "rgba(255,190,140,0.12)";
      ctx.fillRect(rr() * w, rr() * h, 2, 2);
    }
    ctx.strokeStyle = "#2a1408";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    for (const x of [0.25, 0.75]) {
      ctx.moveTo(w * x, 0);
      ctx.lineTo(w * x, h);
    }
    ctx.stroke();
    for (const x0 of [0, 0.5]) {
      ctx.beginPath();
      for (let y = 0; y <= h; y += 8) {
        const t = y / h;
        ctx.lineTo(w * (x0 + 0.25) + Math.sin(t * Math.PI) * w * 0.17 * (x0 ? -1 : 1), y);
      }
      ctx.stroke();
    }
  });
  const ball = new THREE.Group();
  add(ball, new THREE.SphereGeometry(0.95, 40, 24), mat(0xffffff, { map: ballTex, rough: 0.75 }), 0, 0.95, 0, 0.3, 0.5, 0.2);
  ball.position.set(X + 8.2, 0, -3.9);
  b.props.push(makeProp(b.scene, { id: "ball", name: "Basketball", meta: "Off the clock", panel: "offclock", station: "after", group: ball, hand: { tilt: 0.3, yaw: 0.5, fill: 0.6 }, blob: { round: true, scale: 1.0, opacity: 0.5 }, liftHeight: 0.6 }));

  /* ---------------- the lamp ---------------- */
  const lamp = new THREE.Group();
  const ink = mat(0x24282b, { rough: 0.35, metal: 0.3 });
  add(lamp, cyl(0.75, 0.85, 0.2, 40), ink, 0, 0.1, 0);
  const elbow = new THREE.Vector3(0.6, 3.4, 0.9);
  const headP = new THREE.Vector3(2.4, 3.6, 3.0);
  const arm = (a: THREE.Vector3, bq: THREE.Vector3) => {
    const dir = bq.clone().sub(a);
    const m = add(lamp, cyl(0.07, 0.07, dir.length(), 10), ink);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  };
  arm(new THREE.Vector3(0, 0.2, 0), elbow);
  arm(elbow, headP);
  add(lamp, new THREE.SphereGeometry(0.16, 12, 8), ink, elbow.x, elbow.y, elbow.z);
  const shade = new THREE.Group();
  shade.position.copy(headP);
  shade.lookAt(headP.clone().add(new THREE.Vector3(0.5, -1.6, 0.5)));
  add(shade, new THREE.LatheGeometry([new THREE.Vector2(0.18, -0.2), new THREE.Vector2(0.3, 0.1), new THREE.Vector2(0.75, 0.75), new THREE.Vector2(0.78, 0.78)], 32), mat(0x2f4a3b, { rough: 0.4, side: THREE.DoubleSide }), 0, 0, 0, Math.PI / 2, 0, 0);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffc77a, emissiveIntensity: 0, roughness: 0.3 });
  const bulb = add(shade, new THREE.SphereGeometry(0.24, 16, 12), bulbMat, 0, 0, 0.45);
  bulb.castShadow = false;
  bulb.userData.noBake = true;
  lamp.add(shade);
  bake(shade, [bulb]);
  bake(lamp, [shade]);
  lamp.position.set(X - 7.6, 0, -4.6);
  lamp.rotation.y = 0.2;
  makeProp(b.scene, { id: "", name: "", meta: "", panel: "", station: "", group: lamp, blob: { round: true, scale: 1, opacity: 0.4 } });
  b.deco.push(lamp);

  return {
    laptop,
    photos,
    photoProps,
    loadAtlas,
    lamp(v: number) {
      bulbMat.emissiveIntensity = v * 5;
    },
  };
}
