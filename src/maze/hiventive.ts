import * as THREE from "three";
import { FLOOR, type RoomDef, idx } from "./layout";
import { SANS, quad, roundRect } from "./paint";
import { PAL, clay } from "./gfx";
import { Kit, cellAt, detOf, glow, gx, gz, hitBox, wallScreen } from "./kit";
import { type Bus, type CanBit, Station, type Weather } from "./stm32";
import type { Ctx, Det, Fx, Interactable } from "./props";

/**
 * 02 · Hiventive. The room is the chip: an STM32 package, gold pins round its walls, the die painted
 * on the floor. Copper runs from the die to what the firmware drives: a weather mast on SPI and GPIO,
 * a dashboard node on CAN, a terminal on the UART. A logic analyser on the north wall probes one bus
 * at a time and decodes it.
 */

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const BUS_COL: Record<Bus, string> = { spi: "#7fd1ff", uart: "#9be38a", can: "#ffb15c", gpio: "#e98aff" };
const NEXT_PROBE: Record<Bus, Bus> = { spi: "uart", uart: "can", can: "gpio", gpio: "spi" };
const NEXT_WEATHER: Record<Weather, [Weather, string]> = {
  mild: ["heat", "Make it a heatwave"],
  heat: ["storm", "Bring a storm"],
  storm: ["mild", "Calm it down"],
};
const hex = (v: number, n = 2) => v.toString(16).toUpperCase().padStart(n, "0");

export function hiventive(ctx: Ctx, r: RoomDef): Fx {
  const m = ctx.maze;
  const g = new THREE.Group();
  const P = (rx: number, ry: number) => cellAt(r, rx - 0.5, ry - 0.5);
  const kit = new Kit();

  // gold pins on the outside of the package, wherever the wall is closed
  const pinAt = (x: number, y: number, ox: number, oz: number) => {
    if (m.grid[idx(x, y)] === FLOOR) return;
    const cx = gx(x + 0.5) + ox * 0.31;
    const cz = gz(y + 0.5) + oz * 0.31;
    kit.box(ox ? 0.26 : 0.13, 0.08, ox ? 0.13 : 0.26, cx, 0.04, cz, PAL.gold);
  };
  for (let x = r.x; x < r.x + r.w; x++) {
    pinAt(x, r.y - 1, 0, -1);
    pinAt(x, r.y + r.h, 0, 1);
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    pinAt(r.x - 1, y, -1, 0);
    pinAt(r.x + r.w, y, 1, 0);
  }

  /* ------------------------------------------------------------ the die, painted on the floor */
  const DIE = { x: 5.5, y: 4.9, s: 4.4 };
  const S = 640;
  ctx.atlas.queue(
    S,
    S,
    (k) => {
      const gold = "#e9c97c";
      k.fillStyle = "#43464e";
      roundRect(k, 0, 0, S, S, 26);
      k.fill();
      k.strokeStyle = gold;
      k.globalAlpha = 0.5;
      k.lineWidth = 3;
      const inner = 120;
      for (let i = 0; i < 10; i++) {
        const t = inner + ((S - 2 * inner) * (i + 0.5)) / 10;
        const o = (i + 0.5) * (S / 10);
        k.beginPath();
        k.moveTo(t, inner);
        k.lineTo(o, 6);
        k.moveTo(t, S - inner);
        k.lineTo(o, S - 6);
        k.moveTo(inner, t);
        k.lineTo(6, o);
        k.moveTo(S - inner, t);
        k.lineTo(S - 6, o);
        k.stroke();
      }
      k.globalAlpha = 1;
      k.fillStyle = "#5c616b";
      roundRect(k, inner, inner, S - 2 * inner, S - 2 * inner, 10);
      k.fill();
      // the peripherals, as blocks on the die
      const blocks: [string, number, number, number, number, string][] = [
        ["GPIO", 140, 140, 120, 74, BUS_COL.gpio],
        ["bxCAN", 380, 140, 120, 74, BUS_COL.can],
        ["SPI1", 140, 426, 120, 74, BUS_COL.spi],
        ["USART2", 380, 426, 120, 74, BUS_COL.uart],
        ["EXTI", 140, 236, 70, 168, "#b89ad1"],
        ["TIM2", 430, 236, 70, 168, "#9aa0ab"],
        ["CORTEX-M4", 236, 236, 168, 84, "#8a909c"],
      ];
      for (const [name, x, y, w, h, c] of blocks) {
        k.fillStyle = "#4b4f58";
        roundRect(k, x, y, w, h, 8);
        k.fill();
        k.strokeStyle = c;
        k.lineWidth = 3;
        k.stroke();
        k.fillStyle = c;
        k.font = `700 ${name.length > 6 ? 21 : 26}px ${SANS}`;
        k.textAlign = "center";
        k.textBaseline = "middle";
        if (h > w) {
          k.save();
          k.translate(x + w / 2, y + h / 2);
          k.rotate(-Math.PI / 2);
          k.fillText(name, 0, 0);
          k.restore();
        } else k.fillText(name, x + w / 2, y + h / 2);
      }
      k.fillStyle = gold;
      k.font = `700 38px ${SANS}`;
      k.fillText("STM32F4", S / 2, 356);
      k.font = `600 17px ${SANS}`;
      k.fillText("SystemC / TLM · QEMU", S / 2, 390);
      k.beginPath();
      k.arc(40, 40, 13, 0, Math.PI * 2);
      k.fill();
    },
    (uv) => {
      const [x, z] = P(DIE.x, DIE.y);
      ctx.decals.push(quad(x, 0.004, z, DIE.s, DIE.s, uv));
    },
  );

  /* ------------------------------------------------------------ copper, one material per bus, so each lights up */
  const traceMat: Record<Bus, THREE.ShaderMaterial> = {} as Record<Bus, THREE.ShaderMaterial>;
  const paths: Record<Bus, THREE.Vector3[]> = {} as Record<Bus, THREE.Vector3[]>;
  const route = (bus: Bus, pts: [number, number][], y = 0.012) => {
    const tk = new Kit();
    const v = pts.map(([x, z]) => {
      const [wx, wz] = P(x, z);
      return new THREE.Vector3(wx, y, wz);
    });
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1];
      const b = v[i];
      const len = a.distanceTo(b);
      const geo = new THREE.BoxGeometry(len + 0.07, 0.012, 0.07);
      geo.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
      geo.translate((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      tk.add(geo, "#ffffff");
    }
    const mesh = tk.mesh({ emissive: 0.4 });
    traceMat[bus] = mesh.material as THREE.ShaderMaterial;
    traceMat[bus].uniforms.uColor.value.set("#c9a45a");
    g.add(mesh);
    paths[bus] = v;
  };
  const dieW = DIE.x - DIE.s / 2;
  const dieE = DIE.x + DIE.s / 2;
  route("spi", [[dieW + 0.6, 5.7], [1.62, 5.7], [1.62, 3.95]]);
  route("gpio", [[dieW + 0.6, 3.6], [1.9, 3.6], [1.9, 3.5]]);
  route("can", [[dieE - 0.6, 3.4], [9.5, 3.4], [9.5, 3.95]]);
  route("uart", [[dieE - 0.6, 5.7], [9.5, 5.7], [9.5, 7.05]]);

  /* ------------------------------------------------------------ the weather mast, on SPI and GPIO */
  const [mx, mz] = P(1.5, 3.5);
  kit.cyl(0.05, 0.06, 2.05, mx, 1.02, mz, "#cfd3d8", 10);
  kit.box(0.5, 0.06, 0.5, mx, 0.03, mz, "#5c616b");
  // the radiation shield, white louvres round the BME280
  for (let i = 0; i < 6; i++) kit.cyl(0.2 - i * 0.008, 0.22 - i * 0.008, 0.045, mx + 0.27, 1.0 + i * 0.06, mz, "#f4f2ec", 16);
  kit.box(0.3, 0.03, 0.04, mx + 0.12, 1.15, mz, "#cfd3d8");
  // the rain gauge, a funnel on an arm
  kit.box(0.34, 0.03, 0.04, mx - 0.17, 1.45, mz, "#cfd3d8");
  kit.cyl(0.11, 0.07, 0.2, mx - 0.34, 1.52, mz, "#e9edf0", 16);
  kit.cyl(0.07, 0.07, 0.1, mx - 0.34, 1.37, mz, "#9aa0ab", 12);
  const mast = kit.mesh();
  g.add(mast);
  // the anemometer's cups, and the vane
  const cups = new THREE.Group();
  const ck = new Kit();
  ck.cyl(0.03, 0.03, 0.08, 0, 0, 0, "#cfd3d8", 8);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const arm = new THREE.BoxGeometry(0.28, 0.018, 0.018);
    arm.translate(0.14, 0, 0);
    arm.rotateY(a);
    ck.add(arm, "#cfd3d8");
    const cup = new THREE.SphereGeometry(0.055, 10, 8, 0, Math.PI);
    cup.rotateY(Math.PI / 2);
    cup.translate(0.28, 0, 0);
    cup.rotateY(a);
    ck.add(cup, "#e4572e");
  }
  cups.add(ck.mesh());
  cups.position.set(mx, 2.12, mz);
  g.add(cups);
  const vane = new THREE.Group();
  const vk = new Kit();
  vk.box(0.42, 0.02, 0.02, 0, 0, 0, "#3c3e45");
  vk.box(0.02, 0.12, 0.14, -0.2, 0.02, 0, "#3c3e45");
  vk.cyl(0.0, 0.035, 0.08, 0.22, 0, 0, "#3c3e45", 8, [0, 0, -Math.PI / 2]);
  vane.add(vk.mesh());
  vane.position.set(mx, 1.88, mz);
  g.add(vane);

  // the simulated weather over it: a cloud that rains in a storm, a sun in a heatwave
  const cloud = new THREE.Group();
  const cloudK = new Kit();
  for (const [x, y, z, s] of [
    [0, 0, 0, 0.32],
    [0.3, -0.04, 0.05, 0.26],
    [-0.3, -0.05, -0.02, 0.24],
    [0.1, 0.12, -0.08, 0.24],
  ]) {
    const sp = new THREE.SphereGeometry(s, 14, 10);
    sp.translate(x, y, z);
    cloudK.add(sp, "#e8ecf2");
  }
  const cloudMesh = cloudK.mesh();
  const cloudMat = cloudMesh.material as THREE.ShaderMaterial;
  cloudMat.transparent = true;
  cloudMat.depthWrite = false;
  cloud.add(cloudMesh);
  cloud.position.set(mx + 0.2, 2.62, mz + 0.1);
  g.add(cloud);
  const RAIN = 60;
  const rainPos = new Float32Array(RAIN * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: "#9fc3ff", transparent: true, opacity: 0 });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  g.add(rain);
  const rainSeed = Array.from({ length: RAIN }, () => [Math.random() - 0.5, Math.random(), Math.random() - 0.5]);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), clay({ color: "#ffc94a", emissive: 1, transparent: true, opacity: 0 }));
  sun.position.set(mx + 0.35, 2.55, mz);
  g.add(sun);

  /* ------------------------------------------------------------ the dashboard node, on CAN */
  const [nx, nz] = P(9.5, 3.5);
  const nk = new Kit();
  nk.box(0.7, 0.5, 0.5, nx, 0.25, nz, "#3c3e45");
  nk.box(0.06, 0.62, 0.06, nx, 0.8, nz - 0.1, "#3c3e45");
  // CAN_H and CAN_L, twisted, and the 120 Ω terminators at both ends
  nk.box(0.16, 0.08, 0.08, nx + 0.45, 0.04, nz + 0.12, "#d9b25f");
  const [tx0, tz0] = P(dieE - 0.45, 3.4);
  nk.box(0.16, 0.08, 0.08, tx0, 0.04, tz0 - 0.2, "#d9b25f");
  g.add(nk.mesh());
  const nodeScreen = makeScreen(512, 300, 1.05, 0.62);
  nodeScreen.mesh.position.set(nx, 1.35, nz);
  nodeScreen.mesh.rotation.x = -0.5;
  g.add(nodeScreen.mesh);
  const plug = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.18), clay({ color: "#2f8f5b", emissive: 0.4 }));
  plug.position.set(nx - 0.36, 0.22, nz + 0.12);
  g.add(plug);

  /* ------------------------------------------------------------ the terminal, on the UART */
  const [ux, uz] = P(9.5, 7.5);
  const uk = new Kit();
  uk.box(0.9, 0.62, 0.62, ux, 0.31, uz, "#d8d2c4");
  uk.box(0.95, 0.06, 0.45, ux, 0.04, uz + 0.5, "#cfc8b8");
  g.add(uk.mesh());
  const term = makeScreen(512, 384, 0.92, 0.69);
  term.mesh.position.set(ux, 0.98, uz + 0.04);
  term.mesh.rotation.x = -0.42;
  g.add(term.mesh);

  /* ------------------------------------------------------------ LD2 and B1, on the die */
  const [lx, lz] = P(3.95, 7.0);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), clay({ color: "#3cff7a", emissive: 1 }));
  led.position.set(lx, 0.01, lz);
  g.add(led);
  const ledMat = led.material as THREE.ShaderMaterial;
  const [bx, bz] = P(4.5, 7.0);
  const bk = new Kit();
  bk.box(0.26, 0.05, 0.26, bx, 0.025, bz, "#2b2d33");
  g.add(bk.mesh());
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), clay({ color: "#3a6bf0" }));
  button.position.set(bx, 0.08, bz);
  g.add(button);

  /* ------------------------------------------------------------ the logic analyser */
  const an = wallScreen(6.6, 2.05, 2048, 636);
  an.stand(gx(r.x + 5.5), 0.2, gz(r.y + 0.85));
  g.add(an.group);
  // its probe leads, down to the die
  const leads = new Kit();
  (["spi", "uart", "can", "gpio"] as Bus[]).forEach((b, i) => {
    const [ax, az] = P(4.6 + i * 0.6, 1.0);
    const dz = P(0, DIE.y - DIE.s / 2 + 0.25)[1];
    leads.box(0.04, 0.02, dz - az, ax, 0.012, (az + dz) / 2, BUS_COL[b]);
  });
  g.add(leads.mesh({ emissive: 0.5 }));

  /* ------------------------------------------------------------ packets on the wires */
  const PK = 24;
  const pk = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), clay({ emissive: 1 }), PK);
  pk.count = 0;
  pk.frustumCulled = false;
  g.add(pk);
  const packets: { bus: Bus; t0: number; dur: number; back: boolean; col: THREE.Color }[] = [];
  const send = (bus: Bus, t0: number, back = false, col = BUS_COL[bus], dur = 0.7) => {
    if (packets.length >= PK) packets.shift();
    packets.push({ bus, t0, dur, back, col: new THREE.Color(col) });
  };
  const along = (pts: THREE.Vector3[], u: number, out: THREE.Vector3) => {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
    let d = u * total;
    for (let i = 1; i < pts.length; i++) {
      const seg = pts[i - 1].distanceTo(pts[i]);
      if (d <= seg) return out.lerpVectors(pts[i - 1], pts[i], d / seg);
      d -= seg;
    }
    return out.copy(pts[pts.length - 1]);
  };

  /* ------------------------------------------------------------ the simulation */
  const st = new Station();
  let lastSpi = -9;
  let lastCan = -9;
  let lastGpio = -9;
  let dirty = true;
  let gpioDrawAt = 0;
  let pressAt = -9;
  let simNow = 0;

  function drawNode() {
    const k = nodeScreen.k;
    const { w, h } = nodeScreen;
    k.fillStyle = "#101418";
    k.fillRect(0, 0, w, h);
    k.fillStyle = "#ffb15c";
    k.font = `700 22px ${SANS}`;
    k.textBaseline = "top";
    k.fillText("DASHBOARD · CAN ID 0x120", 22, 16);
    const s = st.shown;
    if (!st.nodeOnline) {
      k.fillStyle = "#e4572e";
      k.font = `700 44px ${SANS}`;
      k.fillText("UNPLUGGED", 22, 110);
      k.font = `500 20px ${SANS}`;
      k.fillStyle = "#c9ccd2";
      k.fillText("no node to ACK the frames", 24, 170);
    } else if (s) {
      const d = s.can.data;
      // decode the frame, as the node's firmware would
      const t = (((d[0] << 8) | d[1]) << 16 >> 16) / 100;
      const rh = ((d[2] << 8) | d[3]) / 100;
      const p = ((d[4] << 8) | d[5]) / 10;
      const wind = d[6] / 10;
      k.fillStyle = "#fffaf1";
      k.font = `600 78px ${SANS}`;
      k.fillText(`${t.toFixed(1)}°`, 22, 54);
      k.font = `600 30px ${SANS}`;
      k.fillStyle = "#9fd4ff";
      k.fillText(`${rh.toFixed(0)}% RH`, 290, 62);
      k.fillStyle = "#c9ccd2";
      k.fillText(`${p.toFixed(0)} hPa`, 290, 104);
      k.fillStyle = "#9be38a";
      k.fillText(`${wind.toFixed(1)} m/s wind`, 24, 160);
      k.fillStyle = "#c9ccd2";
      k.fillText(`${d[7]} rain tips`, 290, 160);
    }
    k.fillStyle = "#5c616b";
    k.font = `500 18px ${MONO}`;
    k.fillText(`frames ${st.framesSent} · ${st.nodeOnline ? "ACK ✓" : "no ACK"}`, 22, h - 36);
    nodeScreen.flush();
  }

  function drawTerm() {
    const k = term.k;
    const { w, h } = term;
    k.fillStyle = "#0d140e";
    k.fillRect(0, 0, w, h);
    k.fillStyle = "#3d6b40";
    k.fillRect(0, 0, w, 34);
    k.fillStyle = "#0d140e";
    k.font = `700 18px ${MONO}`;
    k.textBaseline = "middle";
    k.fillText("COM3 · 115200 8N1", 14, 18);
    k.fillStyle = "#9be38a";
    k.font = `500 15px ${MONO}`;
    const lines = st.uartLog.slice(-11);
    lines.forEach((l, i) => {
      const parts = l.split(" ");
      k.fillText(parts.slice(0, 3).join(" "), 12, 56 + i * 29);
      k.globalAlpha = 0.7;
      k.fillText(parts.slice(3).join(" "), 30, 56 + i * 29 + 13);
      k.globalAlpha = 1;
    });
    if (Math.floor(simNow * 2) % 2) k.fillRect(12, h - 20, 10, 14);
    term.flush();
  }

  /** draw a digital line: levels per bit, from x0, w px per bit */
  function line(k: CanvasRenderingContext2D, bits: number[], x0: number, y: number, w: number, hgt: number, col: string) {
    k.strokeStyle = col;
    k.lineWidth = 2.5;
    k.beginPath();
    bits.forEach((b, i) => {
      const yy = y + (b ? 0 : hgt);
      if (i === 0) k.moveTo(x0, yy);
      else k.lineTo(x0 + i * w, yy);
      k.lineTo(x0 + (i + 1) * w, yy);
    });
    k.stroke();
  }
  function bubble(k: CanvasRenderingContext2D, x: number, y: number, w: number, text: string, col: string) {
    k.fillStyle = col;
    k.globalAlpha = 0.22;
    roundRect(k, x + 1, y, Math.max(4, w - 2), 26, 7);
    k.fill();
    k.globalAlpha = 1;
    k.fillStyle = col;
    k.font = `600 16px ${MONO}`;
    k.textAlign = "center";
    k.textBaseline = "middle";
    if (k.measureText(text).width < w - 4) k.fillText(text, x + w / 2, y + 13);
    k.textAlign = "left";
  }

  function drawAnalyser() {
    const k = an.k;
    const W = an.cw;
    const H = an.ch;
    k.fillStyle = "#14171c";
    k.fillRect(0, 0, W, H);
    // the header and the tabs
    k.fillStyle = "#e9c97c";
    k.font = `700 26px ${SANS}`;
    k.textBaseline = "middle";
    k.fillText("LOGIC ANALYSER", 28, 34);
    (["spi", "uart", "can", "gpio"] as Bus[]).forEach((b, i) => {
      const x = 300 + i * 130;
      const on = st.probe === b;
      k.fillStyle = on ? BUS_COL[b] : "#2a2f37";
      roundRect(k, x, 16, 116, 36, 9);
      k.fill();
      k.fillStyle = on ? "#14171c" : "#8e94a0";
      k.font = `700 20px ${SANS}`;
      k.textAlign = "center";
      k.fillText(b === "spi" ? "SPI1" : b === "uart" ? "USART2" : b === "can" ? "bxCAN" : "GPIO", x + 58, 35);
      k.textAlign = "left";
    });
    k.fillStyle = "#6f7682";
    k.font = `500 18px ${SANS}`;
    k.fillText(`sim t = ${simNow.toFixed(2)} s · one sample every ${Station.PERIOD} s`, 860, 35);
    const s = st.last;
    const x0 = 150;
    const wavesW = 1320;
    const lab = (t: string, y: number, col: string) => {
      k.fillStyle = col;
      k.font = `700 19px ${MONO}`;
      k.textBaseline = "middle";
      k.fillText(t, 24, y);
    };
    // the panel on the right
    const px = 1510;
    k.fillStyle = "#1b1f26";
    roundRect(k, px, 74, W - px - 20, H - 92, 14);
    k.fill();
    const info: [string, string?][] = [];
    if (!s) {
      lab("waiting for the first sample…", 120, "#8e94a0");
    } else if (st.probe === "spi") {
      // CS, SCK, MOSI, MISO across the three transactions
      const bytes = s.spi.flatMap((t, ti) => t.mosi.map((v, i) => ({ v, miso: t.miso[i], ti, first: i === 0 })));
      const gap = 1.2;
      const nbits = bytes.length * 8 + (s.spi.length - 1) * gap * 8;
      const w = wavesW / nbits;
      const rows = { cs: 110, sck: 190, mosi: 290, miso: 420 };
      lab("CS", rows.cs + 14, "#c9ccd2");
      lab("SCK", rows.sck + 14, "#c9ccd2");
      lab("MOSI", rows.mosi + 14, BUS_COL.spi);
      lab("MISO", rows.miso + 14, "#ffd58a");
      let x = x0;
      s.spi.forEach((t, ti) => {
        const nb = t.mosi.length * 8;
        // CS low for the whole transaction
        line(k, [1, ...new Array(nb).fill(0), 1], x - w, rows.cs, w, 28, "#c9ccd2");
        // mode 0: data changes on the falling edge, sampled on the rising one, MSB first
        const bitsOf = (arr: number[]) => arr.flatMap((v) => [7, 6, 5, 4, 3, 2, 1, 0].map((b) => (v >> b) & 1));
        line(k, new Array(nb * 2).fill(0).map((_, i) => i % 2), x, rows.sck, w / 2, 28, "#c9ccd2");
        line(k, bitsOf(t.mosi), x, rows.mosi, w, 28, BUS_COL.spi);
        line(k, bitsOf(t.miso), x, rows.miso, w, 28, "#ffd58a");
        t.mosi.forEach((v, i) => {
          const xx = x + i * 8 * w;
          bubble(k, xx, rows.mosi + 40, 8 * w, `${hex(v)}`, BUS_COL.spi);
          bubble(k, xx, rows.miso + 40, 8 * w, i === 0 && ti === 2 ? "—" : `${hex(t.miso[i])}`, "#ffd58a");
        });
        k.fillStyle = "#8e94a0";
        k.font = `500 16px ${SANS}`;
        k.fillText(t.label, x, rows.cs - 14);
        x += nb * w + gap * 8 * w;
      });
      info.push(
        ["BME280 · SPI1 · mode 0 · 1 MHz"],
        ["bit 7 of the address: 1 = read, 0 = write", "#8e94a0"],
        [`adc_P = ${s.raw.adcP}`],
        [`adc_T = ${s.raw.adcT}`],
        [`adc_H = ${s.raw.adcH}`],
        ["var1 = (adc_T/16384 − T1/1024)·T2", "#8e94a0"],
        [`t_fine = ${s.tFine.toFixed(0)}`, "#8e94a0"],
        [`T = ${s.t.toFixed(2)} °C`, "#fffaf1"],
        [`P = ${(s.p / 100).toFixed(2)} hPa`, "#fffaf1"],
        [`RH = ${s.h.toFixed(1)} %`, "#fffaf1"],
      );
    } else if (st.probe === "uart") {
      // the first characters of the line, 8N1: start, eight bits LSB first, stop
      const text = `${s.uart}\r\n`;
      const n = 11;
      const chars = text.slice(0, n).split("");
      const w = wavesW / (n * 10 + 2);
      const y = 210;
      lab("TX", y + 20, BUS_COL.uart);
      const bits: number[] = [1];
      chars.forEach((c) => {
        const v = c.charCodeAt(0);
        bits.push(0);
        for (let i = 0; i < 8; i++) bits.push((v >> i) & 1);
        bits.push(1);
      });
      bits.push(1);
      line(k, bits, x0, y, w, 40, BUS_COL.uart);
      chars.forEach((c, i) => {
        const xx = x0 + w * (1 + i * 10);
        k.fillStyle = "#e4572e";
        k.globalAlpha = 0.35;
        k.fillRect(xx, y - 6, w, 52);
        k.globalAlpha = 1;
        bubble(k, xx, y + 66, w * 10, `'${c === "\r" ? "\\r" : c === "\n" ? "\\n" : c}' ${hex(c.charCodeAt(0))}`, BUS_COL.uart);
      });
      k.fillStyle = "#8e94a0";
      k.font = `500 17px ${SANS}`;
      k.fillText("start bit (red), 8 data bits LSB first, stop bit", x0, y - 32);
      k.fillStyle = BUS_COL.uart;
      k.font = `500 22px ${MONO}`;
      st.uartLog.slice(-4).forEach((l, i) => k.fillText(l, x0, 380 + i * 40));
      info.push(
        ["USART2 · 115200 8N1"],
        ["APB1 = 42 MHz, oversampling 16", "#8e94a0"],
        ["USARTDIV = 42e6 / (16 · 115200)", "#8e94a0"],
        ["        = 22.79 → BRR = 0x16D", "#fffaf1"],
        ["error: 0.08 %", "#8e94a0"],
        [`${s.uart.length + 2} bytes · ${(((s.uart.length + 2) * 10) / 115.2).toFixed(1)} ms on the wire`],
        [st.fahrenheit ? "units: °F (B1 pressed)" : "units: °C · press B1 for °F", "#e98aff"],
      );
    } else if (st.probe === "can") {
      const bits = s.can.bits;
      const w = wavesW / bits.length;
      const yH = 130;
      const yL = 220;
      lab("CAN_H", yH + 18, BUS_COL.can);
      lab("CAN_L", yL + 18, "#c98a4a");
      // dominant (0): CAN_H up to 3.5 V and CAN_L down to 1.5 V; recessive: both at 2.5 V
      line(k, bits.map((b) => 1 - b.v), x0, yH, w, 36, BUS_COL.can);
      line(k, bits.map((b) => b.v), x0, yL, w, 36, "#c98a4a");
      const FIELD_COL: Record<CanBit["field"], string> = {
        sof: "#fffaf1", id: "#7fd1ff", rtr: "#c9ccd2", ide: "#c9ccd2", r0: "#c9ccd2", dlc: "#e98aff",
        data: "#9be38a", crc: "#ffd58a", del: "#5c616b", ack: s.can.acked ? "#9be38a" : "#e4572e", eof: "#5c616b", stuff: "#e4572e",
      };
      // field bands, and the stuff bits
      let i = 0;
      while (i < bits.length) {
        const f = bits[i].field === "stuff" ? (bits[i - 1]?.field ?? "sof") : bits[i].field;
        let j = i;
        while (j + 1 < bits.length && (bits[j + 1].field === f || bits[j + 1].field === "stuff")) j++;
        const label = f === "id" ? `ID ${hex(s.can.id, 3)}` : f === "dlc" ? "DLC 8" : f === "data" ? "DATA" : f === "crc" ? `CRC ${hex(s.can.crc, 4)}` : f === "ack" ? (s.can.acked ? "ACK" : "NO ACK") : f.toUpperCase();
        if (f !== "del") bubble(k, x0 + i * w, 290, (j - i + 1) * w, label, FIELD_COL[f]);
        i = j + 1;
      }
      bits.forEach((b, bi) => {
        if (b.field !== "stuff") return;
        k.fillStyle = "#e4572e";
        k.globalAlpha = 0.5;
        k.fillRect(x0 + bi * w, yH - 8, w, 132);
        k.globalAlpha = 1;
      });
      k.fillStyle = "#9be38a";
      k.font = `500 20px ${MONO}`;
      k.fillText(`data ${s.can.data.map((d) => hex(d)).join(" ")}`, x0, 360);
      k.fillStyle = "#8e94a0";
      k.font = `500 17px ${SANS}`;
      k.fillText(`red: ${s.can.stuffed} stuff bits, a complement after five equal bits · ${bits.length} bits on the wire`, x0, 400);
      k.fillText("bytes 0-1 temperature ×100 · 2-3 RH ×100 · 4-5 hPa ×10 · 6 wind ×10 · 7 rain tips", x0, 432);
      const tec = Math.min(255, st.tec);
      k.fillStyle = "#2a2f37";
      roundRect(k, x0, 470, 900, 30, 8);
      k.fill();
      k.fillStyle = st.canState === "error passive" ? "#e4572e" : "#9be38a";
      roundRect(k, x0, 470, (900 * tec) / 256, 30, 8);
      k.fill();
      k.strokeStyle = "#ffd58a";
      k.beginPath();
      k.moveTo(x0 + 450, 462);
      k.lineTo(x0 + 450, 508);
      k.stroke();
      k.fillStyle = "#c9ccd2";
      k.fillText(`TEC ${st.tec} · ${st.canState}${st.canState === "error passive" ? " (≥ 128), retrying" : ""}`, x0, 540);
      info.push(
        ["bxCAN · 500 kbit/s"],
        ["APB1 42 MHz · BRP 6 → tq = 143 ns", "#8e94a0"],
        ["1 + TS1 11 + TS2 2 = 14 tq = 2 µs", "#8e94a0"],
        ["sample point 85.7 %", "#8e94a0"],
        ["CRC-15: x¹⁵+x¹⁴+x¹⁰+x⁸+x⁷+x⁴+x³+1", "#8e94a0"],
        [`attempts this frame: ${st.attempts}`],
        [s.can.acked ? "ACK slot dominant: received" : "ACK slot recessive: ACK error, TEC +8", s.can.acked ? "#9be38a" : "#e4572e"],
      );
    } else {
      // GPIO: the last 2.4 s of edges, per line
      const lines: [string, string, string][] = [
        ["PA0", "anemometer", "#e98aff"],
        ["PA1", "rain gauge", "#7fd1ff"],
        ["PC13", "B1", "#ffd58a"],
        ["PA5", "LD2", "#3cff7a"],
      ];
      const span = 2.4;
      lines.forEach(([name, what, col], li) => {
        const y = 100 + li * 116;
        lab(name, y + 18, col);
        k.fillStyle = "#6f7682";
        k.font = `500 15px ${SANS}`;
        k.fillText(what, 24, y + 46);
        const es = st.edges.filter((e) => e.line === name).sort((a, b) => a.t - b.t);
        // level before the window: the opposite of the first edge, or idle
        let lvl = name === "PA5" ? 1 - st.led : es.length ? 1 - es[0].v : 1;
        k.strokeStyle = col;
        k.lineWidth = 2.5;
        k.beginPath();
        const X = (t: number) => x0 + ((t - (simNow - span)) / span) * wavesW;
        k.moveTo(x0, y + (lvl ? 0 : 36));
        for (const e of es) {
          if (e.t > simNow) break;
          const xx = Math.max(x0, X(e.t));
          k.lineTo(xx, y + (lvl ? 0 : 36));
          lvl = e.v;
          k.lineTo(xx, y + (lvl ? 0 : 36));
        }
        k.lineTo(x0 + wavesW, y + (lvl ? 0 : 36));
        k.stroke();
      });
      info.push(
        ["EXTI0 · PA0 · falling edge"],
        [`${s.pulses} pulses in 2 s → ${s.wind.toFixed(2)} m/s`, "#fffaf1"],
        ["1 Hz = 2.4 km/h", "#8e94a0"],
        ["EXTI1 · PA1 · rain gauge"],
        [`${s.tips} tips → ${s.rainMm.toFixed(2)} mm`, "#fffaf1"],
        ["EXTI15_10 · PC13 · B1"],
        ["PA5 · LD2 toggles each sample", "#8e94a0"],
      );
    }
    k.textBaseline = "middle";
    info.forEach(([t, col], i) => {
      k.fillStyle = col ?? "#e9c97c";
      k.font = `${col ? 500 : 700} ${col ? 19 : 21}px ${col ? MONO : SANS}`;
      k.fillText(t, px + 22, 112 + i * 46);
    });
    an.flush();
  }

  /* ------------------------------------------------------------ what you can do */
  const targets = [mast, cups, nodeScreen.mesh, term.mesh, an.face];
  const hit = hitBox(1.2, 2.6, 1.2, mx, 1.3, mz);
  g.add(hit);
  const ix: Interactable[] = [
    {
      id: "station",
      room: 2,
      name: "Weather station on a virtual STM32",
      kind: "active",
      blurb: "A modelled MCU runs the firmware: SPI to a BME280, GPIO interrupts from the anemometer and rain gauge, a UART log, CAN frames to a dashboard. Change the weather, press B1, probe a bus, or unplug the CAN node.",
      targets: [...targets, hit],
      anchor: () => new THREE.Vector3(mx, 2.3, mz),
      highlight: glow([mast, cups]),
      actions: () => [
        { id: "weather", label: NEXT_WEATHER[st.weather][1], primary: true },
        { id: "button", label: "Press B1" },
        { id: "probe", label: `Probe ${NEXT_PROBE[st.probe] === "spi" ? "SPI" : NEXT_PROBE[st.probe] === "uart" ? "the UART" : NEXT_PROBE[st.probe] === "can" ? "CAN" : "GPIO"}` },
        { id: "node", label: st.nodeOnline ? "Unplug the CAN node" : "Plug it back in" },
      ],
      live: () => {
        const s = st.last;
        if (!s) return "waiting for the first sample…";
        const tail = st.uartLog.slice(-3).join("\n");
        return `$ candump can0\n  can0  120   [8]  ${s.can.data.map((d) => hex(d)).join(" ")}${s.can.acked ? "" : "   (no ACK)"}\n  TEC ${st.tec} · ${st.canState}\n\n$ screen /dev/ttyACM0 115200\n${tail}`;
      },
      run: (a) => {
        if (a === "weather") st.setWeather(NEXT_WEATHER[st.weather][0]);
        else if (a === "button") {
          st.pressButton(simNow);
          pressAt = simNow;
        } else if (a === "probe") st.probe = NEXT_PROBE[st.probe];
        else if (a === "node") {
          st.setNode(!st.nodeOnline, simNow);
          plug.visible = st.nodeOnline;
        }
        dirty = true;
        ctx.kick();
      },
    },
  ];
  const dets: Det[] = [detOf("station", "weather station"), detOf("node", "display", "CAN node"), detOf("term", "terminal"), detOf("analyser", "screen", "logic analyser")];

  const mtx = new THREE.Matrix4();
  const v = new THREE.Vector3();
  return {
    room: 2,
    group: g,
    ix,
    detect(out) {
      dets[0].box.setFromObject(mast);
      dets[1].box.setFromObject(nodeScreen.mesh);
      dets[2].box.setFromObject(term.mesh);
      dets[3].box.setFromObject(an.face);
      out.push(...dets);
    },
    update(now, dt, _inside, near) {
      simNow = now;
      if (st.update(now, dt)) dirty = true;
      // bus traffic: packets on the copper, and each bus lights up while it moves data
      if (st.activity.spi !== lastSpi) {
        lastSpi = st.activity.spi;
        send("spi", now, false, BUS_COL.spi, 0.5);
        send("spi", now + 0.25, false, BUS_COL.spi, 0.5);
        send("spi", now + 0.5, true, "#ffd58a", 0.6);
        send("uart", now + 0.6, false, BUS_COL.uart, 0.9);
      }
      if (st.activity.can !== lastCan) {
        lastCan = st.activity.can;
        send("can", now, false, st.nodeOnline ? BUS_COL.can : "#e4572e", 0.55);
        dirty = true;
      }
      if (st.activity.gpio !== lastGpio && now - lastGpio > 0.25) {
        lastGpio = st.activity.gpio;
        send("gpio", now, true, BUS_COL.gpio, 0.45);
      }
      for (const b of Object.keys(traceMat) as Bus[]) {
        const a = Math.max(0, 1 - (now - st.activity[b]) / 0.8);
        traceMat[b].uniforms.uEmissive.value = 0.35 + 0.6 * a;
        traceMat[b].uniforms.uColor.value.set("#c9a45a").lerp(new THREE.Color(BUS_COL[b]), a);
      }
      let n = 0;
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        const u = (now - p.t0) / p.dur;
        if (u > 1) {
          packets.splice(i, 1);
          continue;
        }
        if (u < 0) continue;
        along(paths[p.bus], p.back ? 1 - u : u, v);
        mtx.makeTranslation(v.x, v.y + 0.06, v.z);
        pk.setMatrixAt(n, mtx);
        pk.setColorAt(n, p.col);
        n++;
      }
      pk.count = n;
      pk.instanceMatrix.needsUpdate = true;
      if (pk.instanceColor) pk.instanceColor.needsUpdate = true;
      // the mast: cups spin with the wind, the vane swings, the weather over it
      cups.rotation.y = -st.cups;
      vane.rotation.y = 0.6 + 0.4 * Math.sin(now * 0.3) * Math.min(1, st.env.wind / 6) + (st.weather === "storm" ? 0.25 * Math.sin(now * 2.1) : 0);
      const storm = Math.min(1, st.env.rain / 1.2);
      const heat = Math.max(0, Math.min(1, (st.env.t - 28) / 12));
      cloudMat.uniforms.uOpacity.value = 0.15 + 0.8 * storm;
      cloudMat.uniforms.uColor.value.set("#e8ecf2").lerp(new THREE.Color("#8a93a3"), storm);
      cloud.visible = storm > 0.02 || heat < 0.5;
      (sun.material as THREE.ShaderMaterial).uniforms.uOpacity.value = heat;
      sun.visible = heat > 0.02;
      rainMat.opacity = storm * 0.8;
      rain.visible = storm > 0.02;
      if (rain.visible) {
        rainSeed.forEach((s, i) => {
          const y = 2.5 - ((s[1] + now * 1.8) % 1) * 2.3;
          const x = cloud.position.x + s[0] * 0.8;
          const z = cloud.position.z + s[2] * 0.6;
          rainPos.set([x, y, z, x - 0.02, y - 0.16, z], i * 6);
        });
        rainGeo.attributes.position.needsUpdate = true;
      }
      ledMat.uniforms.uColor.value.set(st.led ? "#3cff7a" : "#1d3524");
      button.position.y = now - pressAt < 0.2 ? 0.05 : 0.08;
      if (near) {
        if (dirty || now - gpioDrawAt > (st.probe === "gpio" ? 0.12 : 0.5)) {
          gpioDrawAt = now;
          drawAnalyser();
          drawTerm();
          drawNode();
          dirty = false;
        }
      }
      return true;
    },
  };
}

/** a small screen: a canvas on a plane */
function makeScreen(w: number, h: number, sw: number, sh: number) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const k = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), clay({ map: tex, emissive: 0.9 }));
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.08, sh + 0.08, 0.05), clay({ color: "#23272c" }));
  bezel.position.z = -0.03;
  mesh.add(bezel);
  return { mesh, k, w, h, flush: () => (tex.needsUpdate = true) };
}
