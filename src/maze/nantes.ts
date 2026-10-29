import * as THREE from "three";
import type { RoomDef } from "./layout";
import { SANS, quad, roundRect } from "./paint";
import { clay } from "./gfx";
import { Kit, detOf, glow, gx, gz, hitBox, wallScreen } from "./kit";
import { CLK_HZ, Chrono, DIVIDE, KEYS, type Key, SEG, STABLE } from "./fpga";
import { C, FC, FREQS, R, WAVES, type Wave, fmtHz, harmonics, response, traces } from "./rc";
import type { Ctx, Det, Fx, Interactable } from "./props";

/**
 * 01 · Nantes, the bachelor's in electronics. An RC filter on a breadboard, a function generator
 * and a scope on the north wall, with the Bode plot and the Fourier series beside the traces; and
 * on the workbench, the project I liked most: a chronometer on an FPGA, with its logic on a screen.
 */

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const RED = "#ff3b2f";
const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");

/** a canvas on a plane, for a small display */
function canvasPlane(w: number, h: number, sw: number, sh: number, emissive = 0.9) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const k = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), clay({ map: tex, emissive }));
  return { mesh, k, w, h, flush: () => (tex.needsUpdate = true) };
}

/** one seven-segment digit, segments gfedcba, drawn in a w×h box */
function digit7(k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bits: number, on: string, off: string) {
  const t = w * 0.17;
  const hh = (h - 3 * t) / 2;
  const seg = (i: number, sx: number, sy: number, sw: number, sh: number) => {
    k.fillStyle = (bits >> i) & 1 ? on : off;
    roundRect(k, sx, sy, sw, sh, t / 2);
    k.fill();
  };
  seg(0, x + t, y, w - 2 * t, t); // a
  seg(1, x + w - t, y + t, t, hh); // b
  seg(2, x + w - t, y + 2 * t + hh, t, hh); // c
  seg(3, x + t, y + h - t, w - 2 * t, t); // d
  seg(4, x, y + 2 * t + hh, t, hh); // e
  seg(5, x, y + t, t, hh); // f
  seg(6, x + t, y + t + hh, w - 2 * t, t); // g
}

export function nantes(ctx: Ctx, r: RoomDef): Fx {
  const g = new THREE.Group();
  const P = (x: number, y: number): [number, number] => [gx(r.x + x), gz(r.y + y)];

  /* ============================================================ the bench: generator → RC → scope */
  const kit = new Kit();
  // the resistor lying on the breadboard, with its bands (brown, blue, red: 1.6 kΩ), and its leads
  const [rx, rz] = P(2.5, 2.5);
  const y = 0.3;
  kit.cyl(0.2, 0.2, 1.3, rx, y, rz, "#ead7ae", 24, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.24, 20, 12);
    cap.scale(0.55, 1, 1);
    cap.translate(rx + s * 0.62, y, rz);
    kit.add(cap, "#ead7ae");
    kit.cyl(0.028, 0.028, 0.5, rx + s * 0.95, y, rz, "#9aa0a6", 8, [0, 0, Math.PI / 2]);
    kit.cyl(0.028, 0.028, y, rx + s * 1.2, y / 2, rz, "#9aa0a6", 8);
  }
  ["#7a4a2a", "#3567a8", "#c8352b", "#c9a23c"].forEach((col, i) => {
    kit.cyl(0.212, 0.212, 0.1, rx - 0.42 + i * 0.24 + (i === 3 ? 0.12 : 0), y, rz, col, 24, [0, 0, Math.PI / 2]);
  });
  // the capacitor standing up (100 nF), its leads to the output node and the ground rail
  const [cx, cz] = P(5.5, 2.5);
  kit.cyl(0.3, 0.3, 0.78, cx, 0.5, cz, "#3567a8", 28);
  kit.cyl(0.29, 0.3, 0.03, cx, 0.9, cz, "#c9ccd2", 28);
  kit.box(0.08, 0.7, 0.04, cx - 0.12, 0.5, cz + 0.28, "#d5e3f4");
  kit.cyl(0.025, 0.025, 0.12, cx - 0.1, 0.06, cz, "#9aa0a6", 8);
  kit.cyl(0.025, 0.025, 0.12, cx + 0.1, 0.06, cz, "#9aa0a6", 8);
  // the function generator in the corner, the scope's body under its screen
  const [fx, fz] = P(0.55, 0.55);
  kit.box(0.82, 0.5, 0.56, fx, 0.25, fz, "#d8d2c4");
  kit.box(0.84, 0.06, 0.58, fx, 0.53, fz, "#bdb6a6");
  kit.cyl(0.06, 0.06, 0.05, fx + 0.22, 0.32, fz + 0.29, "#2b2a31", 12, [Math.PI / 2, 0, 0]);
  kit.cyl(0.035, 0.035, 0.05, fx - 0.25, 0.18, fz + 0.29, "#c9a23c", 10, [Math.PI / 2, 0, 0]);
  // wires on the floor: signal, the output node, and the two probes up to the scope
  const wire = (pts: [number, number][], col: string, w = 0.05) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = P(...pts[i - 1]);
      const [bx, bz] = P(...pts[i]);
      const len = Math.hypot(bx - ax, bz - az);
      const geo = new THREE.BoxGeometry(len + w, 0.02, w);
      geo.rotateY(-Math.atan2(bz - az, bx - ax));
      geo.translate((ax + bx) / 2, 0.012, (az + bz) / 2);
      kit.add(geo, col);
    }
  };
  wire([[0.3, 0.85], [0.3, 2.5], [1.3, 2.5]], "#c8352b");
  wire([[3.7, 2.5], [5.1, 2.5]], "#2b2a31");
  wire([[5.9, 2.5], [6.3, 2.5], [6.3, 3.2]], "#2b2a31");
  wire([[1.3, 2.62], [1.6, 2.62], [1.6, 1.1], [2.2, 1.1], [2.2, 0.9]], "#f1c40f", 0.06);
  wire([[4.4, 2.62], [4.4, 1.2], [6.6, 1.2], [6.6, 0.9]], "#2ec4d6", 0.06);
  g.add(kit.mesh());
  const genScreen = canvasPlane(256, 96, 0.6, 0.22);
  genScreen.mesh.position.set(fx - 0.04, 0.33, fz + 0.285);
  g.add(genScreen.mesh);
  const scope = wallScreen(6.1, 2.05, 2048, 688);
  scope.stand(gx(r.x + 4.85), 0.24, gz(r.y + 0.85));
  g.add(scope.group);

  // the breadboard, painted under the circuit
  const bw = 700;
  const bh = 190;
  ctx.atlas.queue(
    bw,
    bh,
    (k) => {
      k.fillStyle = "#fbfaf5";
      k.globalAlpha = 0.9;
      roundRect(k, 0, 0, bw, bh, 18);
      k.fill();
      k.globalAlpha = 1;
      k.fillStyle = "#c8352b";
      k.fillRect(24, 16, bw - 48, 4);
      k.fillStyle = "#3567a8";
      k.fillRect(24, bh - 20, bw - 48, 4);
      k.fillStyle = "#6f7a80";
      for (let row = 0; row < 5; row++) for (let col = 0; col < 29; col++) k.fillRect(30 + col * 22.7, 34 + row * 25, 9, 9);
      k.fillStyle = "#b9c4c8";
      k.fillRect(24, bh / 2 + 22, bw - 48, 3);
    },
    (uv) => {
      const [x, z] = P(3.6, 2.6);
      ctx.decals.push(quad(x, 0.004, z, 6.0, (6.0 * bh) / bw, uv));
    },
  );

  /* ============================================================ the workbench and the FPGA board */
  const desk = new Kit();
  const [dx, dz] = P(4.5, 7.0);
  desk.box(4.7, 0.06, 3.7, dx, 0.3, dz, "#c9a36a");
  for (const sx of [-2.25, 2.25]) for (const sz of [-1.75, 1.75]) desk.box(0.08, 0.3, 0.08, dx + sx, 0.15, dz + sz, "#8a6646");
  // the board: a blue PCB on standoffs
  const [bx, bz] = P(4.5, 7.75);
  for (const sx of [-1.6, 1.6]) for (const sz of [-0.95, 0.95]) desk.cyl(0.04, 0.04, 0.05, bx + sx, 0.355, bz + sz, "#c9ccd2", 8);
  desk.box(3.4, 0.04, 2.1, bx, 0.4, bz, "#1d3f6e");
  g.add(desk.mesh());
  const pcb = canvasPlane(1024, 632, 3.36, 2.07, 0.35);
  pcb.mesh.rotation.x = -Math.PI / 2;
  pcb.mesh.position.set(bx, 0.423, bz);
  g.add(pcb.mesh);
  // the three push buttons and the switch, real so they move
  const keyAt = (i: number): [number, number] => [bx + 1.32 - i * 0.36, bz + 0.72];
  const keys = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 16), clay({ color: "#2b2a31" }));
    const [kx, kz] = keyAt(i);
    m.position.set(kx, 0.46, kz);
    g.add(m);
    return m;
  });
  const sw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.12), clay({ color: "#f4f2ec" }));
  g.add(sw);
  // the RTL view, on a monitor at the back of the bench
  const rtl = wallScreen(4.3, 2.25, 1500, 785, 0.22);
  rtl.stand(dx, 0.33, gz(r.y + 5.55));
  g.add(rtl.group);

  /* ============================================================ the simulations */
  const chrono = new Chrono();
  let wave: Wave = "sine";
  let fi = 2;
  let freq = FREQS[fi];
  let sweep = false;
  let sweepT = 0;
  let simNow = 0;

  function drawGen() {
    const k = genScreen.k;
    k.fillStyle = "#0e1a12";
    k.fillRect(0, 0, 256, 96);
    k.fillStyle = "#9be38a";
    k.font = `700 34px ${MONO}`;
    k.textBaseline = "middle";
    k.fillText(fmtHz(freq), 14, 34);
    k.font = `600 22px ${MONO}`;
    k.fillText(`${wave.toUpperCase()} 2 Vpp`, 14, 72);
    genScreen.flush();
  }

  function drawScope() {
    const k = scope.k;
    const W = scope.cw;
    const H = scope.ch;
    k.fillStyle = "#0d1114";
    k.fillRect(0, 0, W, H);
    // the screen: ten by eight divisions
    const sx = 30;
    const sy = 40;
    const sw2 = 1180;
    const sh = 544;
    k.strokeStyle = "#24303a";
    k.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      k.beginPath();
      k.moveTo(sx + (i * sw2) / 10, sy);
      k.lineTo(sx + (i * sw2) / 10, sy + sh);
      k.stroke();
    }
    for (let j = 0; j <= 8; j++) {
      k.beginPath();
      k.moveTo(sx, sy + (j * sh) / 8);
      k.lineTo(sx + sw2, sy + (j * sh) / 8);
      k.stroke();
    }
    k.strokeStyle = "#3a4a58";
    k.beginPath();
    k.moveTo(sx, sy + sh / 2);
    k.lineTo(sx + sw2, sy + sh / 2);
    k.stroke();
    const { xin, yout } = traces(wave, freq, 600);
    const vdiv = 0.5;
    const trace = (a: Float32Array, col: string) => {
      k.strokeStyle = col;
      k.lineWidth = 4;
      k.beginPath();
      a.forEach((v, i) => {
        const x = sx + (i / (a.length - 1)) * sw2;
        const yy = sy + sh / 2 - (v / vdiv) * (sh / 8);
        if (i) k.lineTo(x, yy);
        else k.moveTo(x, yy);
      });
      k.stroke();
    };
    trace(xin, "#f1c40f");
    trace(yout, "#2ec4d6");
    const { mag, phase } = response(freq);
    k.font = `600 24px ${MONO}`;
    k.textBaseline = "middle";
    k.fillStyle = "#f1c40f";
    k.fillText(`CH1 in  ${vdiv} V/div`, sx, sy + sh + 40);
    k.fillStyle = "#2ec4d6";
    k.fillText(`CH2 out ${vdiv} V/div`, sx + 330, sy + sh + 40);
    k.fillStyle = "#c9ccd2";
    const tdiv = (2 / freq / 10) * 1000;
    k.fillText(`${tdiv >= 1 ? tdiv.toFixed(1) : tdiv.toFixed(2)} ms/div · ${fmtHz(freq)} ${wave}`, sx + 660, sy + sh + 40);
    k.fillStyle = "#8e94a0";
    k.font = `700 22px ${SANS}`;
    k.fillText("SCOPE", sx, 20);

    // the Bode plot: gain in dB and phase against log frequency
    const bx0 = 1260;
    const bw2 = 760;
    const lx = (f: number) => bx0 + ((Math.log10(f) - 1) / 4) * bw2; // 10 Hz .. 100 kHz
    const plot = (top: number, hgt: number, label: string, val: (f: number) => number, lo: number, hi: number, ticks: number[]) => {
      k.fillStyle = "#151b21";
      k.fillRect(bx0, top, bw2, hgt);
      k.strokeStyle = "#24303a";
      k.lineWidth = 1.5;
      for (let d = 1; d <= 5; d++) {
        k.beginPath();
        k.moveTo(lx(10 ** d), top);
        k.lineTo(lx(10 ** d), top + hgt);
        k.stroke();
      }
      const yv = (v: number) => top + ((hi - v) / (hi - lo)) * hgt;
      k.fillStyle = "#6f7682";
      k.font = `500 16px ${MONO}`;
      for (const t of ticks) {
        k.beginPath();
        k.moveTo(bx0, yv(t));
        k.lineTo(bx0 + bw2, yv(t));
        k.stroke();
        k.fillText(String(t), bx0 + 6, yv(t) + (t === hi ? 14 : -12));
      }
      k.strokeStyle = "#9be38a";
      k.lineWidth = 3.5;
      k.beginPath();
      for (let i = 0; i <= 200; i++) {
        const f = 10 ** (1 + (4 * i) / 200);
        const p = [lx(f), yv(val(f))] as const;
        if (i) k.lineTo(...p);
        else k.moveTo(...p);
      }
      k.stroke();
      // the cut-off, and where the generator is now
      k.setLineDash([8, 8]);
      k.strokeStyle = "#e9c97c";
      k.beginPath();
      k.moveTo(lx(FC), top);
      k.lineTo(lx(FC), top + hgt);
      k.stroke();
      k.setLineDash([]);
      k.fillStyle = "#ff8a65";
      k.beginPath();
      k.arc(lx(freq), yv(val(freq)), 11, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = "#c9ccd2";
      k.font = `700 19px ${SANS}`;
      k.fillText(label, bx0 + bw2 - 10 - k.measureText(label).width, top + 18);
    };
    plot(40, 200, "gain, dB", (f) => 20 * Math.log10(response(f).mag), -40, 0, [0, -20, -40]);
    plot(258, 150, "phase, °", (f) => (response(f).phase * 180) / Math.PI, -90, 0, [0, -45, -90]);
    k.fillStyle = "#e9c97c";
    k.font = `600 18px ${MONO}`;
    k.fillText(`fc = 1/(2πRC) = ${FC.toFixed(0)} Hz`, bx0, 432);
    // the Fourier series, in and out
    const hs = harmonics(wave, 9);
    const top = 460;
    const hg = 150;
    k.fillStyle = "#151b21";
    k.fillRect(bx0, top, bw2, hg + 40);
    hs.forEach((a, i) => {
      const n = i + 1;
      const out = a * response(n * freq).mag;
      const x = bx0 + 30 + i * 80;
      k.fillStyle = "#f1c40f";
      k.fillRect(x, top + hg + 10 - a * hg * 0.75, 26, a * hg * 0.75);
      k.fillStyle = "#2ec4d6";
      k.fillRect(x + 30, top + hg + 10 - out * hg * 0.75, 26, out * hg * 0.75);
      k.fillStyle = "#6f7682";
      k.font = `500 15px ${MONO}`;
      k.fillText(`${n}f`, x + 12, top + hg + 28);
    });
    k.fillStyle = "#c9ccd2";
    k.font = `700 19px ${SANS}`;
    k.fillText("harmonics: in, out", bx0 + bw2 - 190, top + 18);
    k.fillStyle = "#fffaf1";
    k.font = `600 22px ${MONO}`;
    k.fillText(`|H| = ${mag.toFixed(3)} (${(20 * Math.log10(mag)).toFixed(1)} dB)  φ = ${((phase * 180) / Math.PI).toFixed(1)}°`, sx, sy + sh + 78);
    scope.flush();
  }

  function drawBoard() {
    const k = pcb.k;
    const W = pcb.w;
    const H = pcb.h;
    k.fillStyle = "#1d3f6e";
    k.fillRect(0, 0, W, H);
    k.strokeStyle = "rgba(201,214,232,0.35)";
    k.lineWidth = 3;
    k.strokeRect(14, 14, W - 28, H - 28);
    // traces, for the look
    k.strokeStyle = "rgba(120,170,220,0.25)";
    k.lineWidth = 4;
    for (let i = 0; i < 9; i++) {
      k.beginPath();
      k.moveTo(470 + i * 12, 300);
      k.lineTo(470 + i * 12, 250);
      k.lineTo(120 + i * 85, 210);
      k.stroke();
    }
    // the FPGA itself
    k.fillStyle = "#2b2a31";
    roundRect(k, 410, 300, 200, 200, 10);
    k.fill();
    k.fillStyle = "#c9ccd2";
    k.font = `700 34px ${SANS}`;
    k.textAlign = "center";
    k.textBaseline = "middle";
    k.fillText("FPGA", 510, 390);
    k.font = `500 18px ${SANS}`;
    k.fillText("50 MHz", 510, 430);
    // six digits: MM SS cc, and the dots between
    const d = chrono.digits();
    const dw = 112;
    const dh = 170;
    const gap = 24;
    let x = 60;
    k.fillStyle = "#14161a";
    roundRect(k, 40, 34, W - 80, dh + 40, 14);
    k.fill();
    d.forEach((v, i) => {
      digit7(k, x, 54, dw, dh, SEG[v], RED, "#3a1714");
      x += dw + gap;
      if (i === 1 || i === 3) {
        k.fillStyle = RED;
        k.beginPath();
        k.arc(x + 6, 54 + dh - 14, 11, 0, Math.PI * 2);
        if (i === 1) k.arc(x + 6, 54 + dh / 3, 11, 0, Math.PI * 2);
        k.fill();
        x += 34;
      }
    });
    k.fillStyle = "#c9d6e8";
    k.font = `600 18px ${SANS}`;
    k.fillText("HEX5", 116, 262);
    k.fillText("HEX0", W - 116, 262);
    // LEDR: the seconds in binary; LEDG: the state
    const secs = Math.floor(chrono.shown / 100) % 60;
    for (let i = 0; i < 8; i++) {
      const on = (secs >> (7 - i)) & 1;
      k.fillStyle = on ? RED : "#4a2320";
      k.beginPath();
      k.arc(90 + i * 40, 560, 13, 0, Math.PI * 2);
      k.fill();
    }
    k.fillStyle = "#c9d6e8";
    k.fillText("LEDR: seconds, binary", 230, 598);
    (["RUN", "LAP", "STOP"] as const).forEach((s, i) => {
      const on = chrono.state === s;
      k.fillStyle = on ? "#3cff7a" : "#1d3a24";
      k.beginPath();
      k.arc(90 + i * 40, 470, 13, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = "#c9d6e8";
      k.font = `600 14px ${SANS}`;
      k.fillText(s, 90 + i * 40, 445);
    });
    k.font = `600 18px ${SANS}`;
    KEYS.forEach((name, i) => k.fillText(name, W / 2 + 420 - i * 108, H - 30));
    k.fillText(chrono.debounce ? "SW0 debounce: ON" : "SW0 debounce: OFF", W / 2 + 60, H - 30);
    k.textAlign = "left";
    pcb.flush();
  }

  function drawRtl() {
    const k = rtl.k;
    const W = rtl.cw;
    const H = rtl.ch;
    k.fillStyle = "#14171c";
    k.fillRect(0, 0, W, H);
    k.fillStyle = "#e9c97c";
    k.font = `700 30px ${SANS}`;
    k.textBaseline = "middle";
    k.fillText("RTL · the chronometer, as the FPGA runs it", 28, 34);
    const running = chrono.state === "RUN" || chrono.state === "LAP";
    const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], on: boolean, col = "#7fd1ff") => {
      k.fillStyle = on ? "#1f2a36" : "#1a1e24";
      roundRect(k, x, y, w, h, 12);
      k.fill();
      k.strokeStyle = on ? col : "#39414c";
      k.lineWidth = on ? 4 : 2;
      k.stroke();
      k.fillStyle = on ? col : "#8e94a0";
      k.font = `700 22px ${SANS}`;
      k.fillText(title, x + 14, y + 24);
      k.fillStyle = "#c9ccd2";
      k.font = `500 19px ${MONO}`;
      lines.forEach((l, i) => k.fillText(l, x + 14, y + 56 + i * 26));
    };
    const arrow = (x0: number, y0: number, x1: number, y1: number, on: boolean, label = "") => {
      k.strokeStyle = on ? "#9be38a" : "#39414c";
      k.lineWidth = 3;
      k.beginPath();
      k.moveTo(x0, y0);
      k.lineTo(x1, y1);
      k.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0);
      k.fillStyle = k.strokeStyle;
      k.beginPath();
      k.moveTo(x1, y1);
      k.lineTo(x1 - 14 * Math.cos(a - 0.4), y1 - 14 * Math.sin(a - 0.4));
      k.lineTo(x1 - 14 * Math.cos(a + 0.4), y1 - 14 * Math.sin(a + 0.4));
      k.fill();
      if (label) {
        k.fillStyle = on ? "#9be38a" : "#6f7682";
        k.font = `600 16px ${SANS}`;
        k.fillText(label, (x0 + x1) / 2 - 24, (y0 + y1) / 2 - 14);
      }
    };
    const v = chrono.cs;
    const flash = (t: number) => simNow - t < 0.25;
    // the time path
    box(24, 70, 190, 110, "CLK", [`${CLK_HZ / 1e6} MHz`], true, "#c9ccd2");
    box(270, 70, 260, 110, "÷ 500 000", [`count ${String(chrono.prescale).padStart(6, " ")}`, `of ${DIVIDE.toLocaleString("en")}`], running);
    box(590, 70, 230, 110, "BCD 0–99", [`hundredths ${String(v % 100).padStart(2, "0")}`], running);
    box(880, 70, 250, 110, "BCD 0–59", [`seconds ${String(Math.floor(v / 100) % 60).padStart(2, "0")}`], running && flash(chrono.carry.s), "#ffd58a");
    box(1190, 70, 280, 110, "BCD 0–59", [`minutes ${String(Math.floor(v / 6000) % 60).padStart(2, "0")}`], running && flash(chrono.carry.m), "#ffd58a");
    arrow(214, 125, 270, 125, true);
    arrow(530, 125, 590, 125, running, "100 Hz");
    arrow(820, 125, 880, 125, flash(chrono.carry.s), "carry");
    arrow(1130, 125, 1190, 125, flash(chrono.carry.m), "carry");
    // the keys, the debouncers, the state machine
    box(24, 230, 190, 150, "KEY0–2", ["start/stop", "lap", "reset"], !!chrono.last && simNow - chrono.last.at < 0.6, "#ffd58a");
    box(270, 230, 260, 150, chrono.debounce ? "DEBOUNCE ×3" : "DEBOUNCE: OFF", chrono.debounce ? ["1 kHz sampling,", `${STABLE} equal in a row`] : ["every bounce", "is an edge"], chrono.debounce, chrono.debounce ? "#9be38a" : "#e4572e");
    arrow(214, 305, 270, 305, true);
    arrow(530, 305, 590, 305, true);
    // the FSM
    k.fillStyle = "#1a1e24";
    roundRect(k, 590, 230, 540, 150, 12);
    k.fill();
    k.fillStyle = "#8e94a0";
    k.font = `700 22px ${SANS}`;
    k.fillText("FSM", 604, 254);
    (["IDLE", "RUN", "STOP", "LAP"] as const).forEach((s, i) => {
      const x = 660 + i * 125;
      const on = chrono.state === s;
      k.fillStyle = on ? "#9be38a" : "#262c34";
      k.beginPath();
      k.arc(x, 318, 42, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = on ? "#14171c" : "#8e94a0";
      k.font = `700 20px ${SANS}`;
      k.textAlign = "center";
      k.fillText(s, x, 319);
      k.textAlign = "left";
    });
    arrow(1130, 305, 1190, 305, chrono.state === "LAP", "lap");
    box(1190, 230, 280, 150, "LAP REGISTER", [chrono.state === "LAP" ? "frozen on the display" : "follows the count"], chrono.state === "LAP", "#ffd58a");
    // the display path
    const d = chrono.digits();
    box(24, 430, 500, 120, "7-SEGMENT DECODE", [`${d.join(" ")}`, `HEX: ${d.map((x) => hex2(~SEG[x] & 0x7f)).join(" ")} (active low)`], true, "#ff8a65");
    box(590, 430, 540, 120, "SCAN 1 kHz", [`driving digit ${5 - chrono.scan}: segments ${(~SEG[d[chrono.scan]] & 0x7f).toString(2).padStart(7, "0")}`, "persistence of vision does the rest"], true, "#ff8a65");
    arrow(524, 490, 590, 490, true);
    arrow(1130, 490, 1190, 490, true);
    box(1190, 430, 280, 120, "HEX5…HEX0", [`${String(d[0])}${d[1]}:${d[2]}${d[3]}.${d[4]}${d[5]}`], true, RED);
    // the last press, as the pin saw it
    const pr = chrono.last;
    k.fillStyle = "#8e94a0";
    k.font = `700 20px ${SANS}`;
    k.fillText("LAST PRESS: the pin, and what the logic counted", 28, 590);
    if (pr) {
      const x0 = 28;
      const wpx = 1100;
      const span = 26; // ms
      const X = (ms: number) => x0 + (ms / span) * wpx;
      k.strokeStyle = "#ffd58a";
      k.lineWidth = 3;
      k.beginPath();
      let lv = 1;
      k.moveTo(x0 - 10, 640);
      k.lineTo(X(0), 640);
      for (const [ms, lvl] of pr.raw) {
        k.lineTo(X(ms), lv ? 640 : 690);
        lv = lvl;
        k.lineTo(X(ms), lv ? 640 : 690);
      }
      k.lineTo(x0 + wpx, lv ? 640 : 690);
      k.stroke();
      for (const e of pr.edges) {
        k.fillStyle = pr.debounced ? "#9be38a" : "#e4572e";
        k.beginPath();
        k.moveTo(X(e), 712);
        k.lineTo(X(e) - 10, 732);
        k.lineTo(X(e) + 10, 732);
        k.fill();
      }
      k.fillStyle = "#c9ccd2";
      k.font = `500 19px ${MONO}`;
      k.fillText(chrono.note, x0, 760);
      k.fillStyle = "#6f7682";
      k.fillText(`${span} ms`, x0 + wpx + 14, 665);
    } else {
      k.fillStyle = "#6f7682";
      k.font = `500 19px ${MONO}`;
      k.fillText("press a key", 28, 640);
    }
    rtl.flush();
  }

  /* ============================================================ what you can do */
  const boardHit = hitBox(3.6, 0.8, 2.4, bx, 0.6, bz);
  const [hx, hz] = P(3.6, 2.5);
  const benchHit = hitBox(6.4, 1.2, 2.0, hx, 0.5, hz);
  g.add(boardHit, benchHit);
  const pressAt = [-9, -9, -9];
  let dirtyBoard = true;
  let dirtyScope = true;
  const ix: Interactable[] = [
    {
      id: "chrono",
      room: 1,
      name: "FPGA chronometer",
      kind: "active",
      blurb: "A 50 MHz clock divided down to hundredths, BCD counters, a state machine and a debouncer per button. The monitor shows the logic as it runs.",
      targets: [pcb.mesh, boardHit, rtl.face, ...keys],
      anchor: () => new THREE.Vector3(bx, 1.0, bz),
      highlight: glow([pcb.mesh]),
      actions: () => {
        const st = chrono.state;
        const out: { id: string; label: string; primary?: boolean }[] = [{ id: "key0", label: st === "IDLE" || st === "STOP" ? "Start" : "Stop", primary: true }];
        if (st === "RUN" || st === "LAP") out.push({ id: "key1", label: st === "RUN" ? "Lap" : "Back to the clock" });
        if (st === "STOP") out.push({ id: "key2", label: "Reset" });
        out.push({ id: "sw0", label: chrono.debounce ? "Switch the debouncer off" : "Debouncer back on" });
        return out;
      },
      run: (a) => {
        if (a === "sw0") chrono.debounce = !chrono.debounce;
        else {
          const key = +a.slice(3) as Key;
          chrono.press(key);
          pressAt[key] = simNow;
        }
        dirtyBoard = true;
        ctx.kick();
      },
      live: () => {
        const d = chrono.digits();
        const v = chrono.cs;
        return [
          `state ${chrono.state} · debouncer ${chrono.debounce ? "on" : "off"}`,
          `prescaler ${chrono.prescale.toLocaleString("en")} / ${DIVIDE.toLocaleString("en")} → tick at 100 Hz`,
          `BCD  min ${String(Math.floor(v / 6000) % 60).padStart(2, "0")}  s ${String(Math.floor(v / 100) % 60).padStart(2, "0")}  cs ${String(v % 100).padStart(2, "0")}`,
          `HEX5..0 = ${d.map((x) => hex2(~SEG[x] & 0x7f)).join(" ")} (active low)`,
          chrono.note ? `last press: ${chrono.note}` : "press a key",
        ].join("\n");
      },
    },
    {
      id: "bench",
      room: 1,
      name: "RC filter on the scope",
      kind: "active",
      blurb: "A function generator into a 1.6 kΩ resistor and a 100 nF capacitor: a low-pass filter with its cut-off at 995 Hz. The scope shows both ends, the Bode plot and the harmonics.",
      targets: [scope.face, benchHit],
      anchor: () => new THREE.Vector3(hx, 1.3, hz),
      highlight: glow([scope.face]),
      actions: () => [
        { id: "freq", label: `Frequency → ${fmtHz(FREQS[(fi + 1) % FREQS.length])}`, primary: true },
        { id: "wave", label: `${WAVES[(WAVES.indexOf(wave) + 1) % WAVES.length].replace(/^./, (c) => c.toUpperCase())} wave` },
        { id: "sweep", label: sweep ? "Stop the sweep" : "Sweep 100 Hz → 10 kHz" },
      ],
      run: (a) => {
        if (a === "freq") {
          sweep = false;
          fi = (fi + 1) % FREQS.length;
          freq = FREQS[fi];
        } else if (a === "wave") wave = WAVES[(WAVES.indexOf(wave) + 1) % WAVES.length];
        else if (a === "sweep") {
          sweep = !sweep;
          sweepT = 0;
        }
        dirtyScope = true;
        ctx.kick();
      },
      live: () => {
        const { mag, phase } = response(freq);
        const hs = harmonics(wave, 9)
          .map((a, i) => [i + 1, a, a * response((i + 1) * freq).mag] as const)
          .filter(([, a]) => a > 0);
        return [
          `RC low-pass · R ${R / 1000} kΩ · C ${C * 1e9} nF · fc = 1/(2πRC) = ${FC.toFixed(0)} Hz`,
          `${wave} at ${fmtHz(freq)} · |H| = ${mag.toFixed(3)} (${(20 * Math.log10(mag)).toFixed(1)} dB) · φ = ${((phase * 180) / Math.PI).toFixed(1)}°`,
          "",
          "harmonic   in      out",
          ...hs.map(([n, a, o]) => `${String(n).padStart(4)}f   ${a.toFixed(3)}   ${o.toFixed(3)}`),
        ].join("\n");
      },
    },
  ];
  const dets: Det[] = [detOf("fpga", "board", "FPGA board"), detOf("scope", "screen", "oscilloscope"), detOf("rtl", "screen", "RTL monitor")];

  let boardAt = 0;
  let lastShown = -1;
  let scanAt = 0;
  return {
    room: 1,
    group: g,
    ix,
    detect(out) {
      dets[0].box.setFromObject(pcb.mesh).expandByScalar(0.05);
      dets[1].box.setFromObject(scope.face);
      dets[2].box.setFromObject(rtl.face);
      out.push(...dets);
    },
    update(now, dt, _inside, near) {
      simNow = now;
      const ticked = chrono.update(now, dt);
      // the keys go down while pressed; the switch flips with the debouncer
      keys.forEach((m, i) => (m.position.y = now - pressAt[i] < 0.18 ? 0.43 : 0.46));
      const [sx, sz] = [bx - 0.7, bz + 0.72];
      sw.position.set(sx, 0.45, sz + (chrono.debounce ? -0.04 : 0.04));
      if (sweep) {
        sweepT += dt;
        // a log sweep up and back, eight seconds each way
        const u = (sweepT / 8) % 2;
        freq = Math.round(10 ** (2 + 2 * (u < 1 ? u : 2 - u)));
        dirtyScope = true;
      }
      if (!near) return true;
      if (ticked && chrono.shown !== lastShown && now - boardAt > 0.04) dirtyBoard = true;
      if (dirtyBoard || now - scanAt > 0.25) {
        lastShown = chrono.shown;
        boardAt = now;
        scanAt = now;
        drawBoard();
        drawRtl();
        dirtyBoard = false;
      }
      if (dirtyScope) {
        dirtyScope = false;
        drawScope();
        drawGen();
      }
      return true;
    },
  };
}
