import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RoomDef } from "./layout";
import { SANS, roundRect } from "./paint";
import { blobTexture, clay } from "./gfx";
import { Kit, detOf, glow, gx, gz, hitBox, wallScreen } from "./kit";
import { type Agv, BACKROOM, Fleet } from "./vda5050";
import type { Ctx, Det, Interactable } from "./props";

/**
 * Coalescent's backroom: three under-ride AMRs move roll cages between the truck docks and the
 * shop floor, on orders from a VDA 5050 fleet manager whose screen hangs on the north wall. M4
 * can't go in (it's their floor), but it can watch, and step into a robot's protective field
 * at the fence.
 */

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CAGE = { l: 0.8, d: 0.6, base: 0.24, h: 1.05 };

export function backroom(ctx: Ctx, r: RoomDef, room: number) {
  const g = new THREE.Group();
  const X = (x: number) => gx(r.x + x);
  const Z = (y: number) => gz(r.y + y);
  const fleet = new Fleet(BACKROOM.nodes, BACKROOM.edges, BACKROOM.agvs, BACKROOM.cages);
  const nodes = fleet.nodes;

  /* ------------------------------------------------------------ the floor: concrete, the roadmap painted on it */
  const zx = 10;
  const zw = 5;
  const zy = 1;
  const zh = 10;
  const PXC = 96;
  const fc = document.createElement("canvas");
  fc.width = zw * PXC;
  fc.height = zh * PXC;
  const fk = fc.getContext("2d")!;
  fk.fillStyle = "#cdd2cc";
  fk.fillRect(0, 0, fc.width, fc.height);
  for (let i = 0; i < 900; i++) {
    fk.fillStyle = `rgba(60,70,60,${0.03 + Math.random() * 0.04})`;
    fk.fillRect(Math.random() * fc.width, Math.random() * fc.height, 2, 2);
  }
  // hatched border on the shop's side: robots only
  const hatch = (x: number, y: number, w: number, h: number) => {
    fk.save();
    fk.beginPath();
    fk.rect(x, y, w, h);
    fk.clip();
    fk.fillStyle = "#f1b33b";
    fk.fillRect(x, y, w, h);
    fk.fillStyle = "#2b2a31";
    for (let k = -h; k < w + h; k += 22) {
      fk.beginPath();
      fk.moveTo(x + k, y);
      fk.lineTo(x + k + 11, y);
      fk.lineTo(x + k + 11 - h, y + h);
      fk.lineTo(x + k - h, y + h);
      fk.fill();
    }
    fk.restore();
  };
  hatch(0, 0, 10, fc.height);
  const P = (x: number, y: number) => [(x - zx) * PXC, (y - zy) * PXC] as [number, number];
  fk.strokeStyle = "rgba(255,255,255,0.9)";
  fk.lineWidth = 5;
  fk.setLineDash([]);
  for (const [a, b] of BACKROOM.edges) {
    const A = nodes.get(a)!;
    const B = nodes.get(b)!;
    fk.beginPath();
    fk.moveTo(...P(A.x, A.y));
    fk.lineTo(...P(B.x, B.y));
    fk.stroke();
  }
  // one-way arrows on the loop
  fk.fillStyle = "rgba(255,255,255,0.95)";
  for (const [a, b] of BACKROOM.edges) {
    const A = nodes.get(a)!;
    const B = nodes.get(b)!;
    if (A.slot || A.charger || B.slot || B.charger) continue;
    const [x0, y0] = P(A.x, A.y);
    const [x1, y1] = P(B.x, B.y);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    fk.save();
    fk.translate((x0 + x1) / 2, (y0 + y1) / 2);
    fk.rotate(ang);
    fk.beginPath();
    fk.moveTo(12, 0);
    fk.lineTo(-8, -9);
    fk.lineTo(-8, 9);
    fk.fill();
    fk.restore();
  }
  fk.textAlign = "center";
  fk.textBaseline = "middle";
  for (const n of nodes.values()) {
    const [x, y] = P(n.x, n.y);
    if (n.slot) {
      fk.strokeStyle = n.slot === "dock" ? "#3a6bf0" : "#2f9b6b";
      fk.lineWidth = 4;
      fk.strokeRect(x - CAGE.d * PXC * 0.6, y - CAGE.l * PXC * 0.6, CAGE.d * PXC * 1.2, CAGE.l * PXC * 1.2);
    } else if (n.charger) {
      fk.fillStyle = "#2b2a31";
      fk.fillRect(x - 26, y - 34, 52, 68);
      fk.fillStyle = "#f1b33b";
      fk.font = `700 34px ${SANS}`;
      fk.fillText("⚡", x, y + 2);
    }
    fk.fillStyle = "#2b2a31";
    fk.beginPath();
    fk.arc(x, y, 9, 0, Math.PI * 2);
    fk.fill();
    fk.font = `700 17px ${SANS}`;
    fk.fillText(n.id, x, y + (n.slot || n.charger ? -46 : 22));
  }
  const ftex = new THREE.CanvasTexture(fc);
  ftex.colorSpace = THREE.SRGBColorSpace;
  ftex.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(zw, zh).rotateX(-Math.PI / 2), clay({ map: ftex }));
  floor.position.set(X(zx + zw / 2), 0.003, Z(zy + zh / 2));
  g.add(floor);
  // a low rail along the shop side, open at the two hand-offs
  const rail = new Kit();
  const railX = X(zx) + 0.04;
  const gaps = [3.5, 7.5];
  let y0 = zy;
  for (const gy of [...gaps, zy + zh + 0.5]) {
    const y1 = gy - 0.5;
    if (y1 > y0) {
      rail.box(0.05, 0.05, y1 - y0, railX, 0.42, (Z(y0) + Z(y1)) / 2, "#f1b33b");
      for (const yy of [y0, y1]) rail.box(0.06, 0.44, 0.06, railX, 0.22, Z(yy), "#2b2a31");
    }
    y0 = gy + 0.5;
  }
  g.add(rail.mesh());

  /* ------------------------------------------------------------ the AMRs */
  const amrGeo = (() => {
    const k = new Kit();
    k.box(0.62, 0.14, 0.44, 0, 0.09, 0, "#f4f4f0");
    k.box(0.6, 0.03, 0.42, 0, 0.02, 0, "#2b2a31");
    k.cyl(0.05, 0.05, 0.05, 0.27, 0.18, 0, "#2b2a31", 12);
    return mergeGeometries(k.parts);
  })();
  const amrs = BACKROOM.agvs.map((a) => {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(amrGeo, clay({ vertexColors: true }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.04, 0.45), clay({ color: a.color }));
    stripe.position.y = 0.1;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.32), clay({ color: "#5c616b" }));
    deck.position.y = 0.175;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), clay({ color: "#3cff7a", emissive: 1 }));
    light.position.set(-0.24, 0.18, 0);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.6 }));
    sh.position.y = 0.006;
    sh.renderOrder = 1;
    grp.add(body, stripe, deck, light, sh);
    g.add(grp);
    return { grp, deck, light: light.material as THREE.ShaderMaterial, body };
  });

  /* ------------------------------------------------------------ the roll cages */
  const cageGeo = (() => {
    const k = new Kit();
    const steel = "#9fb0bd";
    const { l, d, base, h } = CAGE;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        k.cyl(0.035, 0.035, 0.03, sx * (l / 2 - 0.06), 0.035, sz * (d / 2 - 0.05), "#2b2a31", 10, [Math.PI / 2, 0, 0]);
        k.box(0.03, base, 0.03, sx * (l / 2 - 0.06), base / 2 + 0.04, sz * (d / 2 - 0.05), steel);
        k.box(0.025, h - base, 0.025, (sx * l) / 2, base + (h - base) / 2, (sz * d) / 2, steel);
      }
    k.box(l, 0.03, d, 0, base, 0, "#7b8a96");
    for (const hh of [0.3, 0.55, 0.8]) {
      k.box(0.02, 0.02, d, -l / 2, base + hh, 0, steel);
      k.box(0.02, 0.02, d, l / 2, base + hh, 0, steel);
      k.box(l, 0.02, 0.02, 0, base + hh, -d / 2, steel);
    }
    k.box(l, 0.02, 0.02, 0, h, -d / 2, steel);
    k.box(l, 0.02, 0.02, 0, h, d / 2, steel);
    return mergeGeometries(k.parts);
  })();
  const goodsGeo = (() => {
    const k = new Kit();
    const cols = ["#e4572e", "#f1b33b", "#3a9d8f", "#2d4f8c", "#e98aa5", "#7cb35b"];
    for (let i = 0; i < 6; i++) k.box(0.33, 0.2 + (i % 3) * 0.05, 0.24, (i % 2 ? 0.18 : -0.18), CAGE.base + 0.13 + Math.floor(i / 2) * 0.24, 0.07 * ((i * 7) % 3 - 1), cols[i]);
    return mergeGeometries(k.parts);
  })();
  const cages = fleet.cages.map(() => {
    const grp = new THREE.Group();
    const frame = new THREE.Mesh(cageGeo, clay({ vertexColors: true }));
    const goods = new THREE.Mesh(goodsGeo, clay({ vertexColors: true }));
    grp.add(frame, goods);
    g.add(grp);
    return { grp, goods, frame };
  });

  /* ------------------------------------------------------------ base (solid) and horizon (dashed) on the floor */
  const SEG = 120;
  const segs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.01, 0.07), clay({ emissive: 0.6 }), SEG);
  segs.frustumCulled = false;
  g.add(segs);

  /* ------------------------------------------------------------ the fleet manager */
  const scr = wallScreen(4.7, 2.35, 1600, 800);
  scr.stand(X(12.5), 0.2, Z(0.85));
  g.add(scr.group);

  const stateOf = (a: Agv) =>
    a.paused ? "paused" : a.blocked ? "protective field" : a.busy ? (a.busy.type === "pick" ? "lifting" : "lowering") : a.driving ? "driving" : a.charging ? "charging" : a.waiting ? a.waiting : a.order ? "waiting for release" : "idle";
  const stateCol = (a: Agv) => (a.paused ? "#f1b33b" : a.blocked ? "#e4572e" : a.waiting ? "#7fd1ff" : a.charging ? "#9be38a" : "#fffaf1");

  function draw() {
    const k = scr.k;
    const W = scr.cw;
    const H = scr.ch;
    k.fillStyle = "#13171c";
    k.fillRect(0, 0, W, H);
    k.fillStyle = "#9be38a";
    k.font = `700 34px ${SANS}`;
    k.textBaseline = "middle";
    k.fillText("FLEET MANAGER", 32, 44);
    k.fillStyle = "#8e94a0";
    k.font = `500 22px ${SANS}`;
    k.fillText(`VDA 5050 v2 · MQTT uagv/v2/CMR/<serial>/… · ${fleet.delivered} cages moved`, 340, 46);
    // the map: the roadmap, base solid, horizon dashed
    const M = (x: number, y: number) => [110 + (x - 10.55) * 44, 130 + (y - 1.8) * 76] as [number, number];
    k.fillStyle = "#1b2027";
    roundRect(k, 24, 80, 360, 700, 16);
    k.fill();
    k.lineWidth = 3;
    k.strokeStyle = "#39414c";
    for (const [a, b] of BACKROOM.edges) {
      const A = nodes.get(a)!;
      const B = nodes.get(b)!;
      k.beginPath();
      k.moveTo(...M(A.x, A.y));
      k.lineTo(...M(B.x, B.y));
      k.stroke();
    }
    for (const n of nodes.values()) {
      const [x, y] = M(n.x, n.y);
      k.fillStyle = n.slot === "dock" ? "#3a6bf0" : n.slot ? "#2f9b6b" : n.charger ? "#f1b33b" : "#5c616b";
      k.beginPath();
      k.arc(x, y, n.slot || n.charger ? 9 : 5, 0, Math.PI * 2);
      k.fill();
      if (n.slot || n.charger || n.park) {
        k.fillStyle = "#8e94a0";
        k.font = `600 15px ${SANS}`;
        k.textAlign = n.park ? "center" : n.x < 12 ? "right" : "left";
        k.fillText(n.id, x + (n.park ? 0 : n.x < 12 ? -14 : 14), y + (n.park ? -18 : 0));
        k.textAlign = "left";
      }
    }
    for (const c of fleet.cages) {
      if (!c.at) continue;
      const n = nodes.get(c.at)!;
      const [x, y] = M(n.x, n.y);
      k.strokeStyle = c.full ? "#ffd58a" : "#8e94a0";
      k.lineWidth = 3;
      k.strokeRect(x - 13, y - 17, 26, 34);
    }
    fleet.agvs.forEach((a) => {
      const o = a.order;
      if (o) {
        k.strokeStyle = a.color;
        k.lineWidth = 6;
        for (let i = a.reached; i < o.nodes.length - 1; i++) {
          const A = nodes.get(o.nodes[i].nodeId)!;
          const B = nodes.get(o.nodes[i + 1].nodeId)!;
          k.setLineDash(o.nodes[i + 1].released ? [] : [8, 8]);
          k.globalAlpha = o.nodes[i + 1].released ? 1 : 0.6;
          k.beginPath();
          k.moveTo(...M(i === a.reached ? a.x : A.x, i === a.reached ? a.y : A.y));
          k.lineTo(...M(B.x, B.y));
          k.stroke();
        }
        k.setLineDash([]);
        k.globalAlpha = 1;
      }
      const [x, y] = M(a.x, a.y);
      k.fillStyle = a.color;
      k.beginPath();
      k.arc(x, y, 14, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = "#fff";
      k.font = `700 13px ${SANS}`;
      k.textAlign = "center";
      k.fillText(a.serial.slice(-1), x, y + 1);
      k.textAlign = "left";
    });
    k.fillStyle = "#8e94a0";
    k.font = `500 15px ${SANS}`;
    k.fillText("solid: base (released) · dashed: horizon", 40, 760);
    // the fleet
    const tx = 410;
    fleet.agvs.forEach((a, i) => {
      const y = 92 + i * 92;
      k.fillStyle = "#1b2027";
      roundRect(k, tx, y, W - tx - 24, 80, 14);
      k.fill();
      k.fillStyle = a.color;
      roundRect(k, tx, y, 10, 80, 5);
      k.fill();
      k.fillStyle = "#fffaf1";
      k.font = `700 26px ${SANS}`;
      k.fillText(a.serial, tx + 28, y + 26);
      k.fillStyle = stateCol(a);
      k.font = `600 22px ${SANS}`;
      k.fillText(stateOf(a), tx + 180, y + 26);
      k.fillStyle = "#8e94a0";
      k.font = `500 19px ${MONO}`;
      const o = a.order;
      k.fillText(`${o ? `${o.orderId} upd ${o.orderUpdateId}` : "no order"} · last node ${a.lastNode}${a.load ? ` · load ${a.load}` : ""}`, tx + 28, y + 58);
      // battery
      const bx = W - 220;
      k.strokeStyle = "#5c616b";
      k.lineWidth = 2;
      k.strokeRect(bx, y + 14, 150, 24);
      k.fillStyle = a.battery < 25 ? "#e4572e" : a.charging ? "#9be38a" : "#c9ccd2";
      k.fillRect(bx + 3, y + 17, (144 * a.battery) / 100, 18);
      k.fillStyle = "#c9ccd2";
      k.font = `600 18px ${SANS}`;
      k.fillText(`${a.battery.toFixed(0)}%`, bx + 160, y + 27);
    });
    // the wire
    const ly = 392;
    k.fillStyle = "#e9c97c";
    k.font = `700 22px ${SANS}`;
    k.fillText("MESSAGES", tx, ly);
    const TOPIC_COL = { order: "#7fd1ff", state: "#9be38a", instantActions: "#f1b33b", connection: "#c9ccd2" };
    fleet.log.slice(-10).forEach((m, i) => {
      const y = ly + 38 + i * 37;
      k.fillStyle = "#5c616b";
      k.font = `500 16px ${MONO}`;
      k.fillText(`#${m.id}`, tx, y);
      k.fillStyle = TOPIC_COL[m.topic];
      k.fillText(`${m.serial}/${m.topic}`, tx + 64, y);
      k.fillStyle = "#c9ccd2";
      let t = m.text;
      while (k.measureText(t).width > W - tx - 330 && t.length > 10) t = t.slice(0, -2);
      k.fillText(t === m.text ? t : `${t}…`, tx + 300, y);
    });
    scr.flush();
  }

  /* ------------------------------------------------------------ what you can do */
  const [a1, a2, a3] = fleet.agvs;
  const hit = hitBox(zw, 1.2, zh, X(zx + zw / 2), 0.6, Z(zy + zh / 2));
  g.add(hit);
  let dirty = true;
  const ix: Interactable = {
    id: "fleet",
    room,
    name: "AMR fleet · VDA 5050",
    kind: "active",
    blurb: "Three AMRs slide under roll cages and move them between the truck docks and the shop. The fleet manager sends VDA 5050 orders, releases nodes a few at a time so they never collide, and reads their state back.",
    targets: [floor, hit, ...amrs.map((a) => a.body), scr.face],
    anchor: () => new THREE.Vector3(X(12.5), 1.6, Z(5.5)),
    highlight: glow([floor, ...amrs.map((a) => a.body)]),
    actions: () => [
      { id: "pause", label: a2.paused ? "Resume AMR-02" : "Pause AMR-02", primary: true },
      { id: "cancel", label: "Cancel AMR-01's order" },
      { id: "battery", label: "Drain AMR-03's battery" },
    ],
    run: (a) => {
      if (a === "pause") fleet.pause(a2, !a2.paused);
      else if (a === "cancel") fleet.cancel(a1);
      else if (a === "battery") fleet.drain(a3);
      dirty = true;
      ctx.kick();
    },
  };

  /** the latest order, as the JSON on the wire */
  ix.live = () => {
    const a = [...fleet.agvs].sort((p, q) => (q.order ? 1 : 0) - (p.order ? 1 : 0))[0];
    const o = a.order;
    if (!o) return `// ${a.serial}: no order`;
    const nodes = o.nodes.slice(a.reached).map((n) => ({ nodeId: n.nodeId, sequenceId: n.sequenceId, released: n.released, actions: n.actions }));
    const edges = nodes.slice(1).map((n, i) => ({ edgeId: `${nodes[i].nodeId}-${n.nodeId}`, sequenceId: n.sequenceId - 1, startNodeId: nodes[i].nodeId, endNodeId: n.nodeId, released: n.released }));
    const head = { headerId: fleet.headerId, version: "2.0.0", manufacturer: "CMR", serialNumber: a.serial, orderId: o.orderId, orderUpdateId: o.orderUpdateId };
    const list = (xs: object[]) => xs.map((x) => `    ${JSON.stringify(x)}`).join(",\n");
    return `{\n  ${JSON.stringify(head).slice(1, -1).replace(/,"/g, ', "')},\n  "nodes": [\n${list(nodes)}\n  ],\n  "edges": [\n${list(edges)}\n  ]\n}`;
  };

  const dets: Det[] = [...fleet.agvs.map((a) => detOf(a.serial, "robot", a.serial)), ...fleet.cages.map((c) => detOf(c.id, "trolley", "roll cage"))];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const segCol = new THREE.Color();
  let lastLog = -1;
  let drawAt = 0;
  return {
    group: g,
    ix,
    detect(out: Det[]) {
      amrs.forEach((a, i) => dets[i].box.setFromObject(a.body));
      cages.forEach((c, i) => dets[amrs.length + i].box.setFromObject(c.frame));
      out.push(...dets);
    },
    hud() {
      const m = fleet.log[fleet.log.length - 1];
      return {
        at: new THREE.Vector3(X(12.5), 2.2, Z(6)),
        title: "FLEET · VDA 5050",
        lines: [...fleet.agvs.map((a) => `${a.serial} ${stateOf(a)} · ${a.battery.toFixed(0)}%`), m ? `${m.serial}/${m.topic}` : ""],
        color: "#2f6b3a",
      };
    },
    update(now: number, dt: number, near: boolean) {
      // M4, if it leans over the rail: in the roadmap's coordinates
      const rx = ctx.robot.x - gx(r.x);
      const ry = ctx.robot.z - gz(r.y);
      fleet.intruder = rx > 9 && rx < 15 && ry > 0 && ry < 11 ? { x: rx, y: ry } : null;
      fleet.update(now, dt);
      fleet.agvs.forEach((a, i) => {
        const v = amrs[i];
        v.grp.position.set(X(a.x), 0, Z(a.y));
        v.grp.rotation.y = -a.heading;
        v.deck.position.y = 0.175 + a.lift * 0.05;
        v.light.uniforms.uColor.value.set(stateCol(a) === "#fffaf1" ? "#3cff7a" : stateCol(a));
      });
      fleet.cages.forEach((c, i) => {
        const v = cages[i];
        v.goods.visible = c.full;
        if (c.at) {
          const n = nodes.get(c.at)!;
          v.grp.position.set(X(n.x), 0, Z(n.y));
          v.grp.rotation.y = -Math.PI / 2;
        } else {
          const a = fleet.agvs.find((x) => x.load === c.id);
          if (a) {
            v.grp.position.set(X(a.x), a.lift * 0.05, Z(a.y));
            v.grp.rotation.y = -a.heading;
          }
        }
      });
      // the AMR being loaded rises with its cage: the cage over it follows the deck
      for (const a of fleet.agvs) {
        if (!a.busy) continue;
        const c = fleet.cages.find((c) => c.at === a.lastNode);
        if (c) cages[fleet.cages.indexOf(c)].grp.position.y = a.lift * 0.05;
      }
      // what each vehicle has been given: base solid, horizon dashed
      let n = 0;
      for (const a of fleet.agvs) {
        const o = a.order;
        if (!o) continue;
        segCol.set(a.color);
        for (let i = a.reached; i < o.nodes.length - 1 && n < SEG; i++) {
          const A = i === a.reached ? { x: a.x, y: a.y } : nodes.get(o.nodes[i].nodeId)!;
          const B = nodes.get(o.nodes[i + 1].nodeId)!;
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          if (len < 0.01) continue;
          const ang = Math.atan2(B.y - A.y, B.x - A.x);
          q.setFromAxisAngle(up, -ang);
          const released = o.nodes[i + 1].released;
          const parts = released ? 1 : Math.max(1, Math.round(len / 0.25));
          for (let p = 0; p < parts && n < SEG; p++) {
            const u0 = p / parts;
            const u1 = released ? 1 : (p + 0.5) / parts;
            const ux = A.x + (B.x - A.x) * ((u0 + u1) / 2);
            const uy = A.y + (B.y - A.y) * ((u0 + u1) / 2);
            m4.compose(pos.set(X(ux), 0.012, Z(uy)), q, sc.set(len * (u1 - u0), 1, released ? 1 : 0.7));
            segs.setMatrixAt(n, m4);
            segs.setColorAt(n, segCol);
            n++;
          }
        }
      }
      segs.count = n;
      segs.instanceMatrix.needsUpdate = true;
      if (segs.instanceColor) segs.instanceColor.needsUpdate = true;
      if (fleet.log.length && fleet.log[fleet.log.length - 1].id !== lastLog) {
        lastLog = fleet.log[fleet.log.length - 1].id;
        dirty = true;
      }
      if (near && (dirty || now - drawAt > 0.25)) {
        drawAt = now;
        dirty = false;
        draw();
      }
      return true;
    },
  };
}
