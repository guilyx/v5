import * as THREE from "three";
import { blueprint, glow, ink, lineMat, rng, smoothstep } from "../core/util";
import { anchor, canvasTexture, Path, placed } from "./kit";
import { key, stopProgress, type Scene, type SceneEnv } from "./types";

/**
 * 2018 — 2019. A virtual STM32: a SystemC/TLM model of the chip with its
 * timers, I2C, CAN, GPIO and USART, running under QEMU. Bus transactions run
 * along the traces as light. Then Coimbra: a maze robot that floods the maze,
 * finds the shortest path, and drives it.
 */
export function createMetal(env: SceneEnv): Scene {
  const f = env.world.frame(0, 0.18);
  const group = placed(f);
  env.world.addMarker(f);
  const L = (html: string, x: number, y: number, z: number, cls = "") =>
    env.labels.add("metal", anchor(group, x, y, z), html, { cls, maxDist: 150 });

  /* ---------------- the chip ---------------- */
  const board = blueprint(new THREE.BoxGeometry(92, 0.8, 66), { fill: new THREE.Color("#14161e"), edge: ink.line });
  board.position.y = 0.4;
  group.add(board);

  const pkg = blueprint(new THREE.BoxGeometry(22, 1.8, 22), { fill: new THREE.Color("#1d2029"), edge: ink.muted });
  pkg.position.y = 1.7;
  group.add(pkg);

  const dieTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = "#15171e";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#3a3f52";
    g.lineWidth = 2;
    g.strokeRect(10, 10, w - 20, h - 20);
    const blocks: [string, number, number, number, number][] = [
      ["CORTEX-M4", 40, 40, 200, 170],
      ["FLASH", 260, 40, 210, 110],
      ["SRAM", 260, 165, 210, 60],
      ["NVIC", 40, 225, 95, 60],
      ["DMA", 145, 225, 95, 60],
      ["TIM", 40, 300, 100, 70],
      ["I2C", 150, 300, 90, 70],
      ["CAN", 250, 245, 105, 125],
      ["GPIO", 365, 245, 105, 125],
      ["USART", 40, 385, 200, 85],
      ["BUS MATRIX", 250, 385, 220, 85],
    ];
    g.font = '500 20px "JetBrains Mono", monospace';
    for (const [name, x, y, bw, bh] of blocks) {
      g.fillStyle = "#1c1f29";
      g.fillRect(x, y, bw, bh);
      g.strokeStyle = "#4a5068";
      g.strokeRect(x + 0.5, y + 0.5, bw, bh);
      // a hatch of "cells" inside
      g.strokeStyle = "#262a37";
      for (let yy = y + 12; yy < y + bh - 4; yy += 8) {
        g.beginPath();
        g.moveTo(x + 6, yy);
        g.lineTo(x + bw - 6, yy);
        g.stroke();
      }
      g.fillStyle = "#aeb3c2";
      g.fillText(name, x + 10, y + 28);
    }
    g.fillStyle = "#8b95f0";
    g.font = '500 18px "JetBrains Mono", monospace';
    g.fillText("stm32 · systemc/tlm · virtual", 40, 500);
  });
  const die = new THREE.Mesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: dieTex }));
  die.position.y = 2.62;
  group.add(die);

  // pins
  const pinGeo = new THREE.BoxGeometry(0.55, 0.35, 2.2);
  const pins = new THREE.InstancedMesh(pinGeo, new THREE.MeshStandardMaterial({ color: ink.muted, metalness: 0.6, roughness: 0.35 }), 48);
  const m4 = new THREE.Matrix4();
  const pinPos: { side: number; p: THREE.Vector3 }[] = [];
  let pi = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 12; i++) {
      const t = -8.8 + i * 1.6;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      if (side === 0) p.set(-12, 1.0, t); // left
      if (side === 1) p.set(12, 1.0, t); // right
      if (side === 2) p.set(t, 1.0, 12); // front (+z)
      if (side === 3) p.set(t, 1.0, -12); // back
      if (side < 2) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      m4.compose(p, q, new THREE.Vector3(1, 1, 1));
      pins.setMatrixAt(pi++, m4);
      pinPos.push({ side, p });
    }
  }
  group.add(pins);

  // peripherals and the traces that feed them
  const periph: { name: string; x: number; z: number; side: number }[] = [
    { name: "TIM", x: -36, z: -15, side: 0 },
    { name: "I2C", x: -36, z: 12, side: 0 },
    { name: "CAN", x: 36, z: -15, side: 1 },
    { name: "GPIO", x: 36, z: 12, side: 1 },
    { name: "USART", x: -12, z: 28, side: 2 },
    { name: "QEMU", x: 16, z: 28, side: 2 },
  ];
  const traces: Path[] = [];
  const y = 0.86;
  const r = rng(18);
  for (const pp of periph) {
    const box = blueprint(new THREE.BoxGeometry(pp.name === "QEMU" ? 13 : 9, 1.4, 6), {
      fill: new THREE.Color("#191c25"),
      edge: pp.name === "QEMU" ? ink.body : ink.muted,
    });
    box.position.set(pp.x, 1.5, pp.z);
    group.add(box);
    L(pp.name.toLowerCase(), pp.x, 4.2, pp.z, pp.name === "QEMU" ? "tag" : "");

    const mine = pinPos.filter((q) => q.side === pp.side);
    const lanes = pp.name === "QEMU" ? 4 : 3;
    for (let k = 0; k < lanes; k++) {
      let start: THREE.Vector3;
      if (pp.side < 2) {
        const pinIdx = pp.z < 0 ? 1 + k * 2 : 6 + k * 2;
        start = mine[Math.min(11, pinIdx)].p.clone().setY(y);
        const sx = Math.sign(pp.x);
        const out = start.clone().setX(start.x + sx * (1.4 + k * 0.4));
        const mx = start.x + sx * (6 + k * 1.6 + r() * 2);
        const tz = pp.z - 1.6 + k * 1.2;
        traces.push(
          new Path([start, out, new THREE.Vector3(mx, y, start.z), new THREE.Vector3(mx, y, tz), new THREE.Vector3(pp.x - sx * 4.5, y, tz)]),
        );
      } else {
        const pinIdx = pp.x < 0 ? 1 + k * 2 : 6 + k;
        start = mine[Math.min(11, pinIdx)].p.clone().setY(y);
        const mz = start.z + 4 + k * 1.4 + r() * 1.5;
        const tx = pp.x - 2 + k * 1.3;
        traces.push(
          new Path([start, new THREE.Vector3(start.x, y, mz), new THREE.Vector3(tx, y, mz), new THREE.Vector3(tx, y, pp.z - 3)]),
        );
      }
    }
  }
  // a few dead-end decoupling traces for texture
  for (let i = 0; i < 26; i++) {
    const side = Math.floor(r() * 4);
    const p = pinPos.filter((q) => q.side === side)[Math.floor(r() * 12)].p.clone().setY(y);
    const dir = side === 0 ? new THREE.Vector3(-1, 0, 0) : side === 1 ? new THREE.Vector3(1, 0, 0) : side === 2 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
    const a = p.clone().addScaledVector(dir, 2 + r() * 4);
    const turn = new THREE.Vector3(dir.z, 0, dir.x).multiplyScalar((r() - 0.5) * 8);
    const b = a.clone().add(turn);
    const c = b.clone().addScaledVector(dir, 2 + r() * 6);
    const geo = new THREE.BufferGeometry().setFromPoints([p, a, b, c]);
    group.add(new THREE.Line(geo, lineMat(ink.line)));
  }
  for (const t of traces) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(t.pts), lineMat(ink.muted, 0.85)));

  // bus transactions: light running along the traces
  const pulseCount = traces.length * 2;
  const pulses = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.7, 0.3, 0.7),
    new THREE.MeshBasicMaterial({ color: glow(ink.accent, 3) }),
    pulseCount,
  );
  const pulseMeta = Array.from({ length: pulseCount }, (_, i) => ({
    trace: traces[i % traces.length],
    off: r(),
    speed: 0.25 + r() * 0.3,
    inbound: r() > 0.5,
  }));
  group.add(pulses);

  L("stm32 · virtual prototype", 0, 5.5, 0, "accent");
  L("systemc / tlm", 0, 3.6, -9.5);
  L("hiventive · bordeaux · 2018", -30, 0.9, -30, "year");

  /* ---------------- the maze ---------------- */
  const MZ = -86;
  const n = 11;
  const cell = 3.4;
  const half = (n * cell) / 2;
  const cx = (i: number) => -half + cell * (i + 0.5);
  const cz = (j: number) => MZ - half + cell * (j + 0.5);
  // walls[i][j] = [north, east, south, west]
  const walls = Array.from({ length: n }, () => Array.from({ length: n }, () => [true, true, true, true]));
  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const mr = rng(2019);
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  const dirs: [number, number, number, number][] = [
    [0, -1, 0, 2],
    [1, 0, 1, 3],
    [0, 1, 2, 0],
    [-1, 0, 3, 1],
  ];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = dirs.filter(([di, dj]) => {
      const a = i + di;
      const b = j + dj;
      return a >= 0 && b >= 0 && a < n && b < n && !seen[a][b];
    });
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [di, dj, w, ow] = opts[Math.floor(mr() * opts.length)];
    walls[i][j][w] = false;
    walls[i + di][j + dj][ow] = false;
    seen[i + di][j + dj] = true;
    stack.push([i + di, j + dj]);
  }
  // knock out a few extra walls so there's more than one way through
  for (let k = 0; k < 9; k++) {
    const i = 1 + Math.floor(mr() * (n - 2));
    const j = 1 + Math.floor(mr() * (n - 2));
    walls[i][j][1] = false;
    walls[i + 1][j][3] = false;
  }

  const wallSegs: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x0 = -half + i * cell;
      const z0 = MZ - half + j * cell;
      if (walls[i][j][0]) wallSegs.push([x0, z0, x0 + cell, z0]);
      if (walls[i][j][3]) wallSegs.push([x0, z0, x0, z0 + cell]);
      if (j === n - 1 && walls[i][j][2]) wallSegs.push([x0, z0 + cell, x0 + cell, z0 + cell]);
      if (i === n - 1 && walls[i][j][1]) wallSegs.push([x0 + cell, z0, x0 + cell, z0 + cell]);
    }
  const wallMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1.6, 0.32),
    new THREE.MeshStandardMaterial({ color: ink.raised, roughness: 0.9 }),
    wallSegs.length,
  );
  const topPts: number[] = [];
  wallSegs.forEach(([x0, z0, x1, z1], k) => {
    const len = Math.hypot(x1 - x0, z1 - z0) + 0.32;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), x0 === x1 ? Math.PI / 2 : 0);
    m4.compose(new THREE.Vector3((x0 + x1) / 2, 0.8, (z0 + z1) / 2), q, new THREE.Vector3(len, 1, 1));
    wallMesh.setMatrixAt(k, m4);
    topPts.push(x0, 1.61, z0, x1, 1.61, z1);
  });
  group.add(wallMesh);
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(topPts, 3)),
      lineMat(ink.body, 0.9),
    ),
  );

  // flood fill from the start, remembering the order cells were reached
  const order: [number, number][] = [];
  const parent = new Map<number, number>();
  const id = (i: number, j: number) => i * n + j;
  const q: [number, number][] = [[0, 0]];
  const vis = new Set([0]);
  while (q.length) {
    const [i, j] = q.shift()!;
    order.push([i, j]);
    for (const [di, dj, w] of dirs) {
      if (walls[i][j][w]) continue;
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n || vis.has(id(a, b))) continue;
      vis.add(id(a, b));
      parent.set(id(a, b), id(i, j));
      q.push([a, b]);
    }
  }
  const pathCells: [number, number][] = [];
  for (let c: number | undefined = id(n - 1, n - 1); c !== undefined; c = parent.get(c)) {
    pathCells.unshift([Math.floor(c / n), c % n]);
    if (c === 0) break;
  }
  const orderIdx = new Map(order.map(([i, j], k) => [id(i, j), k]));
  const pathSet = new Set(pathCells.map(([i, j]) => id(i, j)));

  const tiles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(cell * 0.84, cell * 0.84).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    n * n,
  );
  const tileColor = new THREE.Color();
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      m4.makeTranslation(cx(i), 0.1, cz(j));
      tiles.setMatrixAt(id(i, j), m4);
      tiles.setColorAt(id(i, j), tileColor.set(0x000000));
    }
  group.add(tiles);

  const drive = new Path(pathCells.map(([i, j]) => new THREE.Vector3(cx(i), 0, cz(j))));
  const robot = new THREE.Group();
  const body = blueprint(new THREE.CylinderGeometry(1, 1.1, 0.8, 20), { fill: ink.raised, edge: ink.accent });
  body.position.y = 0.6;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: glow(ink.accent, 2) }));
  nose.position.set(0, 1.15, -0.6);
  robot.add(body, nose);
  group.add(robot);

  L("start", cx(0), 2.4, cz(0) - 2.4, "accent");
  L("goal", cx(n - 1), 2.4, cz(n - 1) + 2.6);
  const counter = L("", half + 6, 2, MZ, "");
  L("ingeniarius · coimbra · 2019", -half - 2, 0.6, MZ + half + 4, "year");

  const stops = [
    {
      id: "metal",
      vh: 150,
      keys: [key(0, 70, 62, 0, 0, 4), key(30, 24, 26, -2, 1, -2), key(6, 30, -34, 0, 0, MZ)],
    },
    { id: "metal-maze", vh: 120, keys: [key(-4, 48, MZ + 34, 0, 0, MZ + 2), key(-30, 28, MZ - 14, 2, 0, MZ)] },
  ];

  const dir = new THREE.Vector3();
  let lastShown = -1;

  return {
    id: "metal",
    group,
    stops,
    update(ctx) {
      // traffic
      for (let i = 0; i < pulseCount; i++) {
        const pm = pulseMeta[i];
        let t = (pm.off + ctx.time * pm.speed) % 1;
        if (pm.inbound) t = 1 - t;
        const p = pm.trace.at(t);
        m4.makeTranslation(p.x, p.y + 0.12, p.z);
        pulses.setMatrixAt(i, m4);
      }
      pulses.instanceMatrix.needsUpdate = true;

      // maze: explore, then the shortest path, then drive it
      const m = stopProgress(stops, ctx.u, 1);
      const explored = Math.floor(smoothstep(0.02, 0.42, m) * order.length);
      const pathOn = smoothstep(0.4, 0.58, m);
      const drv = smoothstep(0.58, 0.97, m);
      const shown = explored * 1000 + Math.floor(pathOn * 100);
      if (shown !== lastShown) {
        lastShown = shown;
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const k = orderIdx.get(id(i, j)) ?? 1e9;
            if (pathSet.has(id(i, j)) && pathOn > 0) {
              const pk = pathCells.findIndex(([a, b]) => a === i && b === j) / pathCells.length;
              tileColor.copy(pk <= pathOn ? ink.accent : ink.line).multiplyScalar(pk <= pathOn ? 0.9 : 1.3);
            } else if (k < explored) tileColor.copy(ink.line).multiplyScalar(1.3);
            else tileColor.set(0x000000);
            tiles.setColorAt(id(i, j), tileColor);
          }
        tiles.instanceColor!.needsUpdate = true;
        counter.el.innerHTML =
          pathOn < 0.99
            ? `flood fill<br>${explored}/${order.length} cells`
            : `shortest path<br>${pathCells.length} cells`;
      }
      drive.at(drv, robot.position);
      drive.dir(Math.min(0.999, Math.max(0.001, drv)), dir);
      robot.rotation.y = Math.atan2(-dir.x, -dir.z);
      robot.position.y = Math.abs(Math.sin(ctx.time * 9)) * 0.04;
    },
  };
}
