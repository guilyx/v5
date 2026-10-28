/**
 * A fleet manager that speaks VDA 5050 (v2), the open interface between a master control and its
 * AGVs, and the AGVs on the other end of it. Plain TypeScript: no three.js, no MQTT broker, but the
 * messages are the standard's: orders made of nodes and edges, released in a base and held back in a
 * horizon; state reports with the last node, the driving flag, the load, battery, action states and
 * errors; instant actions to pause, resume or cancel.
 *
 * Traffic control is the master's job, and VDA 5050 gives it one lever: it only releases the nodes
 * a vehicle may drive to. Here it releases at most two nodes ahead, and never one another vehicle
 * stands on or holds. The roadmap is a one-way loop with dead-end spurs to the chargers, so holding
 * nodes is enough to keep the fleet from colliding or locking up.
 */

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  /** a station where a roll cage can stand */
  slot?: "dock" | "handoff";
  charger?: boolean;
  /** somewhere to wait off the loop */
  park?: boolean;
}

export interface OrderNode {
  nodeId: string;
  sequenceId: number;
  released: boolean;
  actions: { actionType: "pick" | "drop"; actionId: string; blockingType: "HARD" }[];
}

export type ActionStatus = "WAITING" | "RUNNING" | "FINISHED" | "FAILED";

export interface Cage {
  id: string;
  at: string | null;
  full: boolean;
  /** when its state flips by itself: a truck refills it at a dock, the store empties it at a hand-off */
  flipAt: number;
  claimed: boolean;
}

export interface Agv {
  serial: string;
  color: string;
  x: number;
  y: number;
  heading: number;
  lastNode: string;
  /** index in the order of the last node reached */
  reached: number;
  order: { orderId: string; orderUpdateId: number; nodes: OrderNode[]; kind: "transport" | "charge" | "drop" } | null;
  actionStates: Map<string, ActionStatus>;
  driving: boolean;
  paused: boolean;
  battery: number;
  charging: boolean;
  load: string | null;
  /** the lift deck, 0 down to 1 up */
  lift: number;
  /** the action being carried out at the current node */
  busy: { id: string; type: "pick" | "drop"; t: number } | null;
  /** what it's waiting for, for the screen */
  waiting: string;
  cancelAt: number;
  job: { cage: string; to: string } | null;
  /** a field violation: something in the protective field */
  blocked: boolean;
}

export interface Msg {
  id: number;
  t: number;
  topic: "order" | "state" | "instantActions" | "connection";
  serial: string;
  text: string;
}

const SPEED = 1.0; // cells per second
const TURN = 3.2; // rad per second
const ACT = 1.3; // seconds to lift or lower

export class Fleet {
  nodes = new Map<string, RoadNode>();
  /** directed edges */
  next = new Map<string, string[]>();
  agvs: Agv[] = [];
  cages: Cage[] = [];
  log: Msg[] = [];
  headerId = 0;
  orders = 0;
  actions = 0;
  delivered = 0;
  now = 0;
  /** something else to keep out of the way of, in roadmap coordinates (M4 over the fence) */
  intruder: { x: number; y: number } | null = null;

  constructor(nodes: RoadNode[], edges: [string, string][], agvs: { serial: string; color: string; at: string }[], cages: { id: string; at: string; full: boolean }[]) {
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      this.next.set(n.id, []);
    }
    for (const [a, b] of edges) this.next.get(a)!.push(b);
    for (const a of agvs) {
      const n = this.nodes.get(a.at)!;
      this.agvs.push({
        serial: a.serial, color: a.color, x: n.x, y: n.y, heading: -Math.PI / 2, lastNode: a.at, reached: 0, order: null,
        actionStates: new Map(), driving: false, paused: false, battery: 70 + Math.random() * 25, charging: false, load: null,
        lift: 0, busy: null, waiting: "", cancelAt: -1, job: null, blocked: false,
      });
      this.msg("connection", a.serial, `{"connectionState": "ONLINE"}`);
    }
    for (const c of cages) this.cages.push({ ...c, flipAt: 6 + Math.random() * 4, claimed: false });
  }

  private msg(topic: Msg["topic"], serial: string, text: string) {
    this.log.push({ id: ++this.headerId, t: this.now, topic, serial, text });
    if (this.log.length > 60) this.log.shift();
  }

  isSpur(id: string) {
    const n = this.nodes.get(id);
    return !!n && (!!n.slot || !!n.charger || !!n.park);
  }

  /** shortest route over the directed roadmap */
  route(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const prev = new Map<string, string>([[from, ""]]);
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      for (const n of this.next.get(q[i]) ?? []) {
        if (prev.has(n)) continue;
        prev.set(n, q[i]);
        if (n === to) {
          const out = [to];
          for (let c = q[i]; c; c = prev.get(c)!) out.unshift(c);
          return out;
        }
        q.push(n);
      }
    }
    return null;
  }

  /** the nodes each other vehicle stands on or holds released */
  private held(except: Agv) {
    const s = new Set<string>();
    for (const a of this.agvs) {
      if (a === except) continue;
      s.add(a.lastNode);
      if (a.order) for (let i = a.reached + 1; i < a.order.nodes.length; i++) if (a.order.nodes[i].released) s.add(a.order.nodes[i].nodeId);
    }
    return s;
  }

  private sendOrder(a: Agv, path: string[], acts: Map<string, "pick" | "drop">, kind: "transport" | "charge" | "drop") {
    const orderId = `o-${String(++this.orders).padStart(4, "0")}`;
    const nodes: OrderNode[] = path.map((id, i) => ({
      nodeId: id,
      sequenceId: i * 2,
      released: i === 0,
      actions: acts.has(id) && i > 0 ? [{ actionType: acts.get(id)!, actionId: `a-${++this.actions}`, blockingType: "HARD" as const }] : [],
    }));
    // a pick or drop where it already stands
    if (acts.has(path[0])) nodes[0].actions = [{ actionType: acts.get(path[0])!, actionId: `a-${++this.actions}`, blockingType: "HARD" }];
    a.order = { orderId, orderUpdateId: 0, nodes, kind };
    a.reached = 0;
    a.actionStates.clear();
    for (const n of nodes) for (const ac of n.actions) a.actionStates.set(ac.actionId, "WAITING");
    this.release(a, true);
  }

  /** release what's free ahead, up to two nodes past the vehicle; log the order or its update */
  private release(a: Agv, fresh = false) {
    const o = a.order;
    if (!o) return;
    const held = this.held(a);
    let changed = false;
    for (let i = a.reached + 1; i < o.nodes.length && i <= a.reached + 2; i++) {
      const n = o.nodes[i];
      if (n.released) continue;
      // a station is a dead end: don't let a vehicle up to its mouth while another is inside,
      // or each would wait for the other
      const after = o.nodes[i + 1];
      const spur = after && this.isSpur(after.nodeId) && held.has(after.nodeId);
      if (held.has(n.nodeId) || spur) {
        a.waiting = `waiting for ${spur ? after.nodeId : n.nodeId}`;
        break;
      }
      n.released = true;
      changed = true;
      a.waiting = "";
    }
    if (fresh || changed) {
      if (!fresh) o.orderUpdateId++;
      // an update stitches on at the last base node the vehicle knows: show from where it stands
      const base = o.nodes.slice(a.reached).filter((n) => n.released).map((n) => n.nodeId + (n.actions.length ? `(${n.actions[0].actionType})` : ""));
      const horizon = o.nodes.filter((n) => !n.released).map((n) => n.nodeId);
      this.msg("order", a.serial, `${o.orderId} #${o.orderUpdateId} base [${base.join(" ")}]${horizon.length ? ` horizon [${horizon.join(" ")}]` : ""}`);
    }
  }

  /** the master: hand out work to vehicles without an order */
  private dispatch() {
    const free = (slot: string) => !this.cages.some((c) => c.at === slot) && !this.agvs.some((a) => a.job?.to === slot || a.lastNode === slot);
    for (const a of this.agvs) {
      if (a.order || a.paused || a.busy) continue;
      // loaded with nowhere to go (a cancelled order): drop it at the nearest free station
      if (a.load) {
        const spots = [...this.nodes.values()].filter((n) => n.slot && free(n.id));
        const best = spots.map((n) => ({ n, r: this.route(a.lastNode, n.id) })).filter((x) => x.r).sort((p, q) => p.r!.length - q.r!.length)[0];
        if (best) {
          a.job = { cage: a.load, to: best.n.id };
          this.sendOrder(a, best.r!, new Map([[best.n.id, "drop"]]), "drop");
        }
        continue;
      }
      // low battery: to a charger
      if (a.battery < 25 && !this.nodes.get(a.lastNode)?.charger) {
        const ch = [...this.nodes.values()].find((n) => n.charger && !this.agvs.some((b) => b !== a && (b.lastNode === n.id || b.order?.nodes.at(-1)?.nodeId === n.id)));
        const r = ch && this.route(a.lastNode, ch.id);
        if (r) this.sendOrder(a, r, new Map(), "charge");
        continue;
      }
      if (a.charging && a.battery < 60) continue;
      // a cage to move: full ones from a dock to the store, empty ones back to a dock
      let job: { cage: Cage; to: RoadNode; path: string[] } | null = null;
      for (const c of this.cages) {
        if (c.claimed || !c.at) continue;
        const from = this.nodes.get(c.at)!;
        const want = from.slot === "dock" && c.full ? "handoff" : from.slot === "handoff" && !c.full ? "dock" : null;
        if (!want) continue;
        const to = [...this.nodes.values()].find((n) => n.slot === want && free(n.id));
        if (!to) continue;
        const r1 = this.route(a.lastNode, c.at);
        const r2 = this.route(c.at, to.id);
        if (!r1 || !r2) continue;
        const path = [...r1, ...r2.slice(1)];
        if (!job || path.length < job.path.length) job = { cage: c, to, path };
      }
      if (job) {
        job.cage.claimed = true;
        a.job = { cage: job.cage.id, to: job.to.id };
        a.charging = false;
        this.sendOrder(a, job.path, new Map([[job.cage.at!, "pick"], [job.to.id, "drop"]]), "transport");
        continue;
      }
      // nothing to do: off the loop, onto a charger or the parking spot
      const here = this.nodes.get(a.lastNode)!;
      if (!here.charger && !here.park) {
        const spot = [...this.nodes.values()]
          .filter((n) => (n.charger || n.park) && !this.agvs.some((b) => b !== a && (b.lastNode === n.id || b.order?.nodes.at(-1)?.nodeId === n.id)))
          .sort((p, q) => (q.charger ? 1 : 0) - (p.charger ? 1 : 0))[0];
        const r = spot && this.route(a.lastNode, spot.id);
        if (r) this.sendOrder(a, r, new Map(), "charge");
      }
    }
  }

  /* ---------------------------------------------------------------- instant actions */

  pause(a: Agv, on: boolean) {
    a.paused = on;
    this.msg("instantActions", a.serial, `{"actionType": "${on ? "startPause" : "stopPause"}", "blockingType": "HARD"}`);
    this.state(a, on ? "paused" : "resumed");
  }

  cancel(a: Agv) {
    this.msg("instantActions", a.serial, `{"actionType": "cancelOrder", "blockingType": "HARD"}`);
    if (!a.order) return;
    // stop at the node it's heading for; what's left of the order is dropped, its actions fail
    const o = a.order;
    const target = o.nodes[a.reached + 1]?.released ? a.reached + 1 : a.reached;
    for (let i = target + 1; i < o.nodes.length; i++) for (const ac of o.nodes[i].actions) a.actionStates.set(ac.actionId, "FAILED");
    o.nodes = o.nodes.slice(0, target + 1);
    if (a.job && !a.load) {
      const c = this.cages.find((c) => c.id === a.job!.cage);
      if (c) c.claimed = false;
      a.job = null;
    } else if (a.job) a.job = null;
    a.cancelAt = this.now;
  }

  drain(a: Agv) {
    a.battery = 18;
    this.state(a, "battery low");
  }

  /** the vehicle's report: compact, the fields a fleet manager reads */
  private state(a: Agv, why: string) {
    const acts = [...a.actionStates.entries()].slice(-2).map(([id, s]) => `${id}:${s}`).join(" ");
    this.msg(
      "state",
      a.serial,
      `${why} · last ${a.lastNode}${a.order ? ` · ${a.order.orderId}` : ""} · driving ${a.driving} · paused ${a.paused} · battery ${a.battery.toFixed(0)}%${a.load ? ` · load ${a.load}` : ""}${acts ? ` · ${acts}` : ""}${a.blocked ? " · error: fieldViolation" : ""}`,
    );
  }

  /* ---------------------------------------------------------------- the simulation */

  update(now: number, dt: number) {
    this.now = now;
    // cages change by themselves: trucks fill them at the docks, the store empties them
    for (const c of this.cages) {
      if (c.claimed || !c.at || now < c.flipAt) continue;
      const slot = this.nodes.get(c.at)!.slot;
      if ((slot === "dock" && !c.full) || (slot === "handoff" && c.full)) {
        c.full = !c.full;
        c.flipAt = now + 6 + Math.random() * 4;
      }
    }
    this.dispatch();
    for (const a of this.agvs) {
      this.release(a);
      this.drive(a, dt);
    }
  }

  private drive(a: Agv, dt: number) {
    a.battery = Math.max(0, a.battery - dt * (a.driving ? 0.5 : 0.08));
    const atCharger = this.nodes.get(a.lastNode)?.charger && !a.driving;
    a.charging = !!atCharger && !a.order;
    if (a.charging) a.battery = Math.min(100, a.battery + dt * 4);
    // the lift follows the load
    const liftTo = a.busy ? (a.busy.type === "pick" ? 1 : 0) : a.load ? 1 : 0;
    a.lift += Math.sign(liftTo - a.lift) * Math.min(Math.abs(liftTo - a.lift), dt / ACT);
    const o = a.order;
    if (!o) {
      a.driving = false;
      return;
    }
    if (a.paused) {
      if (a.driving) {
        a.driving = false;
        this.state(a, "paused");
      }
      return;
    }
    // actions at the node it stands on, one after the other
    if (a.busy) {
      a.busy.t += dt;
      if (a.busy.t >= ACT) {
        const node = o.nodes[a.reached];
        const c = this.cages.find((c) => c.id === (a.busy!.type === "pick" ? this.cages.find((k) => k.at === node.nodeId)?.id : a.load));
        if (a.busy.type === "pick" && c) {
          a.load = c.id;
          c.at = null;
        } else if (a.busy.type === "drop" && c) {
          c.at = node.nodeId;
          c.claimed = false;
          c.flipAt = this.now + 5 + Math.random() * 4;
          a.load = null;
          a.job = null;
          this.delivered++;
        }
        a.actionStates.set(a.busy.id, "FINISHED");
        this.state(a, `${a.busy.type} finished`);
        a.busy = null;
      }
      return;
    }
    const here = o.nodes[a.reached];
    const pending = here.actions.find((ac) => a.actionStates.get(ac.actionId) === "WAITING");
    if (pending) {
      a.busy = { id: pending.actionId, type: pending.actionType, t: 0 };
      a.actionStates.set(pending.actionId, "RUNNING");
      a.driving = false;
      this.state(a, `${pending.actionType} running`);
      return;
    }
    const nx = o.nodes[a.reached + 1];
    if (!nx) {
      // order done
      if (a.driving || a.order) this.state(a, "order finished");
      a.driving = false;
      a.order = null;
      return;
    }
    if (!nx.released) {
      if (a.driving) this.state(a, a.waiting || "waiting for release");
      a.driving = false;
      return;
    }
    const n = this.nodes.get(nx.nodeId)!;
    // the protective field: something right ahead, stop
    a.blocked = !!this.intruder && Math.hypot(this.intruder.x - a.x, this.intruder.y - a.y) < 1.1 && Math.cos(Math.atan2(this.intruder.y - a.y, this.intruder.x - a.x) - a.heading) > 0.3;
    if (a.blocked) {
      if (a.driving) this.state(a, "protective field");
      a.driving = false;
      return;
    }
    const want = Math.atan2(n.y - a.y, n.x - a.x);
    let d = want - a.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const dist = Math.hypot(n.x - a.x, n.y - a.y);
    if (!a.driving) this.state(a, "driving");
    a.driving = true;
    if (Math.abs(d) > 0.05 && dist > 0.02) {
      a.heading += Math.sign(d) * Math.min(Math.abs(d), TURN * dt);
      if (Math.abs(d) > 0.5) return;
    }
    const step = SPEED * dt * (a.load ? 0.8 : 1);
    if (dist <= step) {
      a.x = n.x;
      a.y = n.y;
      a.lastNode = n.id;
      a.reached++;
      if (a.reached >= o.nodes.length - 1 && !o.nodes[a.reached].actions.length) {
        this.state(a, `reached ${n.id}`);
      }
    } else {
      a.x += ((n.x - a.x) / dist) * step;
      a.y += ((n.y - a.y) / dist) * step;
    }
  }
}

/**
 * CMR's backroom, in the room's cells: a one-way loop (north along the west lane, south along the
 * east one), docks for the trucks on the east wall, hand-offs to the shop floor on the west, and
 * two chargers, each at the end of a short spur.
 */
export const BACKROOM = {
  nodes: [
    { id: "N1", x: 11.6, y: 1.8 },
    { id: "N2", x: 13.6, y: 1.8 },
    { id: "E1", x: 13.6, y: 3.5 },
    { id: "E2", x: 13.6, y: 5.5 },
    { id: "E3", x: 13.6, y: 7.5 },
    { id: "S2", x: 13.6, y: 9.6 },
    { id: "S1", x: 11.6, y: 9.6 },
    { id: "W3", x: 11.6, y: 7.5 },
    { id: "W2", x: 11.6, y: 5.5 },
    { id: "W1", x: 11.6, y: 3.5 },
    { id: "DOCK1", x: 14.55, y: 3.5, slot: "dock" },
    { id: "DOCK2", x: 14.55, y: 7.5, slot: "dock" },
    { id: "SHOP1", x: 10.55, y: 3.5, slot: "handoff" },
    { id: "SHOP2", x: 10.55, y: 7.5, slot: "handoff" },
    { id: "CHG1", x: 10.55, y: 5.5, charger: true },
    { id: "CHG2", x: 14.55, y: 5.5, charger: true },
    { id: "PARK", x: 12.6, y: 5.5, park: true },
  ] as RoadNode[],
  edges: [
    ["N1", "N2"], ["N2", "E1"], ["E1", "E2"], ["E2", "E3"], ["E3", "S2"], ["S2", "S1"], ["S1", "W3"], ["W3", "W2"], ["W2", "W1"], ["W1", "N1"],
    ["E1", "DOCK1"], ["DOCK1", "E1"], ["E3", "DOCK2"], ["DOCK2", "E3"], ["W1", "SHOP1"], ["SHOP1", "W1"], ["W3", "SHOP2"], ["SHOP2", "W3"],
    ["W2", "CHG1"], ["CHG1", "W2"], ["E2", "CHG2"], ["CHG2", "E2"], ["W2", "PARK"], ["PARK", "W2"],
  ] as [string, string][],
  agvs: [
    { serial: "AMR-01", color: "#2f9b6b", at: "CHG1" },
    { serial: "AMR-02", color: "#3a6bf0", at: "CHG2" },
    { serial: "AMR-03", color: "#e4572e", at: "S1" },
  ],
  cages: [
    { id: "cage-A", at: "DOCK1", full: true },
    { id: "cage-B", at: "DOCK2", full: true },
    { id: "cage-C", at: "SHOP2", full: false },
  ],
};
