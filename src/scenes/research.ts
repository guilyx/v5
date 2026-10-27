import * as THREE from "three";
import { publications } from "../content";
import { blueprint, glow, ink, lineMat, rng } from "../core/util";
import { anchor, canvasTexture, placed, wrap } from "./kit";
import { key, type Scene, type SceneEnv } from "./types";

/**
 * 2020 — 2021, Centrale Nantes. Three of the four research threads, drawn:
 * multi-agent pathfinding (prioritized planning in space-time, solved live
 * on load), a cart-pole under ROS 2 with its jitter histogram, and the
 * papers themselves — click one to read it.
 */
export function createResearch(env: SceneEnv): Scene {
  const f = env.world.frame(0, 0.42);
  const group = placed(f);
  env.world.addMarker(f);
  const L = (html: string, x: number, y: number, z: number, cls = "", maxDist = 150) =>
    env.labels.add("research", anchor(group, x, y, z), html, { cls, maxDist });

  /* ---------------- MAPF ---------------- */
  const W = 14;
  const H = 10;
  const C = 2.8;
  const ox = -(W * C) / 2;
  const oz = -(H * C) / 2;
  const px = (i: number) => ox + C * (i + 0.5);
  const pz = (j: number) => oz + C * (j + 0.5);
  const r = rng(2021);
  const blocked = Array.from({ length: W }, () => Array(H).fill(false));
  for (let k = 0; k < 22; k++) blocked[1 + Math.floor(r() * (W - 2))][1 + Math.floor(r() * (H - 2))] = true;

  const grid: number[] = [];
  for (let i = 0; i <= W; i++) grid.push(ox + i * C, 0.06, oz, ox + i * C, 0.06, oz + H * C);
  for (let j = 0; j <= H; j++) grid.push(ox, 0.06, oz + j * C, ox + W * C, 0.06, oz + j * C);
  group.add(
    new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(grid, 3)), lineMat(ink.line)),
  );
  const obsGeo = new THREE.BoxGeometry(C * 0.86, 1.6, C * 0.86);
  for (let i = 0; i < W; i++)
    for (let j = 0; j < H; j++)
      if (blocked[i][j]) {
        const b = blueprint(obsGeo, { edge: ink.faint });
        b.position.set(px(i), 0.8, pz(j));
        group.add(b);
      }

  // prioritized planning: each agent runs A* in (cell, time), avoiding cells
  // and edge swaps already reserved by the agents before it
  type Cell = [number, number];
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && !blocked[i][j];
  const reserved = new Set<string>();
  const edges = new Set<string>();
  const T = 48;
  const plan = (s: Cell, g: Cell): Cell[] | null => {
    const h = (c: Cell) => Math.abs(c[0] - g[0]) + Math.abs(c[1] - g[1]);
    const open: { c: Cell; t: number; f: number; prev: number }[] = [{ c: s, t: 0, f: h(s), prev: -1 }];
    const all = [open[0]];
    const seen = new Set<string>();
    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift()!;
      const idx = all.indexOf(cur);
      if (cur.c[0] === g[0] && cur.c[1] === g[1]) {
        // stay at goal must also be safe for the rest of the horizon
        let ok = true;
        for (let t = cur.t; t < T; t++) if (reserved.has(`${g[0]},${g[1]},${t}`)) ok = false;
        if (ok) {
          const out: Cell[] = [];
          for (let n = cur; ; n = all[n.prev]) {
            out.unshift(n.c);
            if (n.prev < 0) break;
          }
          return out;
        }
      }
      if (cur.t >= T - 1) continue;
      for (const [di, dj] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n: Cell = [cur.c[0] + di, cur.c[1] + dj];
        const t = cur.t + 1;
        if (!free(n[0], n[1])) continue;
        const k = `${n[0]},${n[1]},${t}`;
        if (reserved.has(k) || seen.has(k)) continue;
        if (edges.has(`${n[0]},${n[1]}>${cur.c[0]},${cur.c[1]}@${t}`)) continue;
        seen.add(k);
        const node = { c: n, t, f: t + h(n), prev: idx };
        all.push(node);
        open.push(node);
      }
    }
    return null;
  };
  const agents: { path: Cell[] }[] = [];
  const pairs: [Cell, Cell][] = [
    [[0, 0], [13, 9]],
    [[13, 0], [0, 9]],
    [[0, 9], [12, 1]],
    [[13, 9], [1, 0]],
    [[6, 0], [7, 9]],
    [[7, 9], [6, 0]],
    [[0, 4], [13, 5]],
    [[13, 4], [0, 5]],
  ];
  for (const [s, g] of pairs) {
    if (!free(...s) || !free(...g)) continue;
    const p = plan(s, g);
    if (!p) continue;
    for (let t = 0; t < T; t++) {
      const c = p[Math.min(t, p.length - 1)];
      reserved.add(`${c[0]},${c[1]},${t}`);
      if (t > 0) {
        const pc = p[Math.min(t - 1, p.length - 1)];
        edges.add(`${pc[0]},${pc[1]}>${c[0]},${c[1]}@${t}`);
      }
    }
    agents.push({ path: p });
  }
  const span = Math.max(...agents.map((a) => a.path.length)) + 4;

  const agentGeo = new THREE.SphereGeometry(0.62, 20, 12);
  const agentMeshes = agents.map((a, i) => {
    const hl = i === 0;
    const m = new THREE.Mesh(agentGeo, new THREE.MeshBasicMaterial({ color: hl ? glow(ink.accent, 1.6) : ink.body }));
    group.add(m);
    const pts = a.path.map(([ci, cj]) => new THREE.Vector3(px(ci), 0.14, pz(cj)));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(hl ? ink.accent : ink.faint, hl ? 0.9 : 0.6)));
    const goal = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.95, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: hl ? ink.accent : ink.muted, transparent: true, opacity: 0.8 }),
    );
    const g = a.path[a.path.length - 1];
    goal.position.set(px(g[0]), 0.12, pz(g[1]));
    group.add(goal);
    return m;
  });
  L("multi-agent pathfinding", ox + 4, 0.4, oz - 2.6, "accent");
  L(`${agents.length} agents · space-time a* · 0 collisions`, 0, 0.4, oz + H * C + 2.6);
  L("apla-toolbox · pymapf", ox + W * C - 6, 0.4, oz - 2.6, "year");

  /* ---------------- cart-pole + jitter ---------------- */
  const PX = -38;
  const PZ = 8;
  const rail = blueprint(new THREE.BoxGeometry(22, 0.5, 0.8), { edge: ink.muted });
  rail.position.set(PX, 0.25, PZ);
  group.add(rail);
  const cart = blueprint(new THREE.BoxGeometry(3.2, 1.6, 2.2), { edge: ink.body });
  cart.position.set(PX, 1.3, PZ);
  group.add(cart);
  const pole = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 8).translate(0, 4.5, 0), new THREE.MeshBasicMaterial({ color: ink.heading }));
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 1.6) }));
  bob.position.y = 9;
  pole.add(stick, bob);
  pole.position.set(PX, 2.1, PZ);
  group.add(pole);

  const BINS = 26;
  const hist = new Float32Array(BINS);
  const bars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.62, 1, 0.62).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    BINS,
  );
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < BINS; i++) bars.setColorAt(i, i === 9 ? ink.accent : ink.muted);
  group.add(bars);
  const HX = PX - 9;
  const HZ = PZ - 9;
  L("cart-pole · ros 2 · xenomai", PX, 0.4, PZ + 3.4, "");
  L("jitter (μs)", HX + 8, 0.4, HZ + 2.2, "year");

  /* ---------------- the papers ---------------- */
  const papers: THREE.Mesh[] = [];
  publications.forEach((p, i) => {
    const tex = canvasTexture(620, 860, (g, w, h) => {
      g.fillStyle = "#1a1d26";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#3a3f52";
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = "#e8eaf0";
      g.font = '600 38px "Space Grotesk Variable", sans-serif';
      let y = wrap(g, p.title, 50, 110, w - 100, 46);
      g.font = '400 20px "JetBrains Mono", monospace';
      g.fillStyle = i === 0 ? "#8b95f0" : "#858b9c";
      g.fillText(p.venue.toLowerCase(), 50, y + 10);
      g.fillStyle = "#616779";
      g.fillText("e. lejeune et al.", 50, y + 40);
      y += 90;
      // the rest of the page as text lines, two columns
      g.fillStyle = "#2c3040";
      const rr = rng(i + 3);
      for (let col = 0; col < 2; col++)
        for (let yy = y; yy < h - 60; yy += 16) {
          if (rr() < 0.07) {
            yy += 10;
            continue;
          }
          const x0 = 50 + col * 270;
          g.fillRect(x0, yy, 240 * (0.6 + rr() * 0.4), 6);
        }
      if (i === 1) {
        g.strokeStyle = "#8b95f0";
        g.lineWidth = 3;
        g.beginPath();
        for (let x = 0; x < 240; x++) g.lineTo(320 + x, 640 - Math.exp(-((x - 100) ** 2) / 900) * 90);
        g.stroke();
      }
    });
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(6.2, 8.6),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    sheet.position.set(-12 + i * 8, 10 + (i === 1 ? 1.4 : 0), -24 - (i === 1 ? 2 : 0));
    sheet.rotation.set(-0.06, 0.18 - i * 0.18, 0);
    sheet.userData.base = sheet.position.y;
    sheet.userData.url = p.url;
    group.add(sheet);
    papers.push(sheet);
    env.labels.add("research", sheet, i === 0 ? "iros 2024 ↗" : "preprint 2021 ↗", {
      cls: i === 0 ? "accent" : "",
      offset: new THREE.Vector3(0, -5.2, 0),
      maxDist: 120,
    });
  });

  const jr = rng(99);
  const normal = () => {
    let s = 0;
    for (let k = 0; k < 6; k++) s += jr();
    return s / 6;
  };

  return {
    id: "research",
    group,
    stops: [
      {
        id: "research",
        vh: 170,
        keys: [key(-6, 46, 46, 9, 2, -4), key(-34, 22, 36, -16, 8, -8), key(-16, 16, 10, 0, 11, -24)],
      },
    ],
    clickables: papers.map((p) => ({ object: p, onClick: () => open(p.userData.url, "_blank", "noopener") })),
    update(ctx) {
      // agents step through their space-time plans on a loop
      const t = (ctx.time * 2.4) % span;
      agents.forEach((a, i) => {
        const k = Math.floor(t);
        const fr = t - k;
        const c0 = a.path[Math.min(k, a.path.length - 1)];
        const c1 = a.path[Math.min(k + 1, a.path.length - 1)];
        const e = fr * fr * (3 - 2 * fr);
        agentMeshes[i].position.set(px(c0[0]) + (px(c1[0]) - px(c0[0])) * e, 0.85, pz(c0[1]) + (pz(c1[1]) - pz(c0[1])) * e);
      });

      // a kick every few seconds; the controller catches it, with a little jitter on top
      const since = ctx.time % 4.2;
      const kick = (Math.floor(ctx.time / 4.2) % 2 ? 1 : -1) * 0.42;
      const theta = kick * Math.exp(-1.5 * since) * Math.sin(6 * since + 0.4) + (jr() - 0.5) * 0.012;
      pole.rotation.z = theta;
      const x = kick * 3.4 * Math.exp(-1.1 * since) * Math.sin(6 * since - 0.5);
      cart.position.x = PX + x;
      pole.position.x = PX + x;

      // jitter histogram fills with samples, then decays so it stays alive
      for (let s = 0; s < 4; s++) hist[Math.min(BINS - 1, Math.floor(normal() * BINS * 1.25 - 3) + 2)] += 1;
      let mx = 1;
      for (let i = 0; i < BINS; i++) {
        hist[i] *= 0.996;
        mx = Math.max(mx, hist[i]);
      }
      for (let i = 0; i < BINS; i++) {
        m4.makeScale(1, 0.05 + (hist[i] / mx) * 7, 1).setPosition(HX + i * 0.7, 0, HZ);
        bars.setMatrixAt(i, m4);
      }
      bars.instanceMatrix.needsUpdate = true;

      papers.forEach((p, i) => {
        p.position.y = p.userData.base + Math.sin(ctx.time * 0.9 + i) * 0.35;
      });
    },
  };
}
