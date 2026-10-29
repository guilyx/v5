/**
 * A chronometer on an FPGA, the way the logic is built: a 50 MHz clock divided down to a 100 Hz
 * tick, cascaded BCD counters for hundredths, seconds and minutes, a small state machine for
 * start, stop, lap and reset, a debouncer on every push button, and six seven-segment digits.
 *
 * Plain TypeScript, no three.js: time comes in, signals come out, and the room draws them.
 */

export const CLK_HZ = 50_000_000;
export const TICK_HZ = 100;
export const DIVIDE = CLK_HZ / TICK_HZ;
/** the debouncer samples at 1 kHz and wants this many equal samples in a row */
export const STABLE = 10;

export type ChronoState = "IDLE" | "RUN" | "STOP" | "LAP";
export const KEYS = ["KEY0", "KEY1", "KEY2"] as const;
export type Key = 0 | 1 | 2;

/** segments gfedcba for 0-9; the board drives them active low */
export const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** a press, as the pin saw it and as the logic did */
export interface Press {
  key: Key;
  at: number;
  /** level changes of the raw pin, ms after the press, active low (0 = pressed) */
  raw: [number, 0 | 1][];
  /** edges the logic acted on, ms after the press */
  edges: number[];
  debounced: boolean;
}

export class Chrono {
  state: ChronoState = "IDLE";
  /** hundredths counted since reset */
  cs = 0;
  /** what the display holds while a lap is frozen on it */
  lap = 0;
  debounce = true;
  /** the prescaler's count, 0..DIVIDE-1 */
  prescale = 0;
  last: Press | null = null;
  /** a few words on what the last press did */
  note = "";
  /** which counters carried on the last tick, for the RTL view */
  carry = { s: -9, m: -9 };
  /** the scan: which digit the mux drives right now */
  scan = 0;
  private acc = 0;
  private now = 0;

  /** advance by dt seconds of wall time */
  update(now: number, dt: number) {
    this.now = now;
    this.scan = Math.floor(now * 1000) % 6;
    if (this.state !== "RUN" && this.state !== "LAP") return false;
    this.acc += dt * TICK_HZ;
    const ticks = Math.floor(this.acc);
    this.acc -= ticks;
    this.prescale = Math.floor(this.acc * DIVIDE);
    if (!ticks) return false;
    const before = this.cs;
    this.cs = (this.cs + ticks) % 360000;
    if (Math.floor(this.cs / 100) !== Math.floor(before / 100)) this.carry.s = now;
    if (Math.floor(this.cs / 6000) !== Math.floor(before / 6000)) this.carry.m = now;
    return true;
  }

  /** the value on the display */
  get shown() {
    return this.state === "LAP" ? this.lap : this.cs;
  }

  /** the six digits, minutes to hundredths */
  digits(v = this.shown) {
    const m = Math.floor(v / 6000) % 60;
    const s = Math.floor(v / 100) % 60;
    const c = v % 100;
    return [Math.floor(m / 10), m % 10, Math.floor(s / 10), s % 10, Math.floor(c / 10), c % 10];
  }

  /** what the logic does on one clean falling edge of a key */
  private act(key: Key) {
    const st = this.state;
    if (key === 0) this.state = st === "IDLE" || st === "STOP" ? "RUN" : "STOP";
    else if (key === 1) {
      if (st === "RUN") {
        this.lap = this.cs;
        this.state = "LAP";
      } else if (st === "LAP") this.state = "RUN";
    } else if (st === "STOP" || st === "IDLE") {
      this.cs = 0;
      this.lap = 0;
      this.acc = 0;
      this.state = "IDLE";
    }
  }

  /**
   * Press a key. A mechanical button bounces for a few milliseconds; with the debouncer, the logic
   * sees one edge once the pin has held still for 10 ms. Without it, every falling edge counts.
   */
  press(key: Key, rand: () => number = Math.random) {
    const raw: [number, 0 | 1][] = [[0, 0]];
    let t = 0;
    const bounces = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < bounces; i++) {
      t += 0.25 + rand() * 0.9;
      raw.push([t, 1]);
      t += 0.2 + rand() * 0.7;
      raw.push([t, 0]);
    }
    const settle = t;
    const before = this.state;
    let edges: number[];
    if (this.debounce) {
      edges = [Math.ceil(settle) + STABLE];
      this.act(key);
    } else {
      edges = raw.filter(([, v]) => v === 0).map(([ms]) => ms);
      for (let i = 0; i < edges.length; i++) this.act(key);
    }
    // the release, much later, bounces too but only falling edges count
    this.last = { key, at: this.now, raw, edges, debounced: this.debounce };
    const name = ["start/stop", "lap", "reset"][key];
    this.note =
      edges.length === 1
        ? `${KEYS[key]} (${name}): ${bounces} bounces, one clean edge → ${this.state}`
        : `${KEYS[key]} (${name}): ${edges.length} edges for one press, ${before} → ${this.state}${before === this.state && key !== 2 ? ", as if never pressed" : ""}`;
    return edges.length;
  }
}
