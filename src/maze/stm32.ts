/**
 * A weather station on a simulated STM32, the kind of virtual prototype I built at Hiventive: the
 * peripherals are models, the sensors are models of their datasheets, and the firmware talks to them
 * the way it would to silicon.
 *
 * - SPI1 to a BME280: the driver writes ctrl_hum and ctrl_meas (forced mode), then burst-reads the
 *   eight data registers from 0xF7 and compensates them with the datasheet's formulas and the
 *   sensor's trimming parameters. The sensor model goes the other way: from the weather to raw ADC
 *   counts, by inverting those same formulas.
 * - GPIO: the anemometer's reed switch and the rain gauge's tipping bucket on EXTI lines, the user
 *   button B1, the LED LD2 as a heartbeat.
 * - USART2 at 115200 8N1: one line per sample to a terminal.
 * - bxCAN at 500 kbit/s: one standard frame per sample, CRC-15 and bit stuffing included, to a
 *   dashboard node that ACKs it. Unplug the node and the ACK slot stays recessive: every attempt
 *   is an ACK error, the transmit error counter climbs by 8, and at 128 the controller goes error
 *   passive and keeps retrying, as the CAN spec says it should.
 */

/* ============================================================== BME280 */

/** trimming parameters (the BMP280 datasheet's worked example, and a typical humidity set) */
const CAL = {
  T1: 27504, T2: 26435, T3: -1000,
  P1: 36477, P2: -10685, P3: 3024, P4: 2855, P5: 140, P6: -7, P7: 15500, P8: -14600, P9: 6000,
  H1: 75, H2: 362, H3: 0, H4: 313, H5: 50, H6: 30,
};

/** the datasheet's double-precision compensation: raw counts in, °C, Pa and %RH out */
export function compensate(adcT: number, adcP: number, adcH: number) {
  const c = CAL;
  let v1 = (adcT / 16384 - c.T1 / 1024) * c.T2;
  let v2 = (adcT / 131072 - c.T1 / 8192) ** 2 * c.T3;
  const tFine = v1 + v2;
  const t = tFine / 5120;

  v1 = tFine / 2 - 64000;
  v2 = (v1 * v1 * c.P6) / 32768;
  v2 = v2 + v1 * c.P5 * 2;
  v2 = v2 / 4 + c.P4 * 65536;
  v1 = ((c.P3 * v1 * v1) / 524288 + c.P2 * v1) / 524288;
  v1 = (1 + v1 / 32768) * c.P1;
  let p = 0;
  if (v1 !== 0) {
    p = 1048576 - adcP;
    p = ((p - v2 / 4096) * 6250) / v1;
    v1 = (c.P9 * p * p) / 2147483648;
    v2 = (p * c.P8) / 32768;
    p = p + (v1 + v2 + c.P7) / 16;
  }

  let h = tFine - 76800;
  h = (adcH - (c.H4 * 64 + (c.H5 / 16384) * h)) * ((c.H2 / 65536) * (1 + (c.H6 / 67108864) * h * (1 + (c.H3 / 67108864) * h)));
  h = h * (1 - (c.H1 * h) / 524288);
  h = Math.min(100, Math.max(0, h));
  return { t, p, h, tFine };
}

/** invert a monotonic function by bisection, to integer counts */
function invert(f: (x: number) => number, want: number, lo: number, hi: number) {
  const up = f(hi) > f(lo);
  for (let i = 0; i < 40 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) < want === up) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** the sensor: the weather, as the eight data registers 0xF7..0xFE would hold it */
function bmeRegisters(tempC: number, pressPa: number, rh: number) {
  const adcT = invert((x) => compensate(x, 0, 0).t, tempC, 0, 1 << 20);
  const adcP = invert((x) => compensate(adcT, x, 0).p, pressPa, 0, 1 << 20);
  const adcH = invert((x) => compensate(adcT, 0, x).h, rh, 0, 1 << 16);
  return {
    adcT,
    adcP,
    adcH,
    bytes: [adcP >> 12, (adcP >> 4) & 0xff, (adcP & 0xf) << 4, adcT >> 12, (adcT >> 4) & 0xff, (adcT & 0xf) << 4, adcH >> 8, adcH & 0xff],
  };
}

/* ============================================================== CAN */

/** one bit on the wire, and what it belongs to (stuff bits are marked as such) */
export interface CanBit {
  v: 0 | 1;
  field: "sof" | "id" | "rtr" | "ide" | "r0" | "dlc" | "data" | "crc" | "del" | "ack" | "eof" | "stuff";
}

/** CRC-15/CAN over the unstuffed bits from SOF to the end of the data: x¹⁵+x¹⁴+x¹⁰+x⁸+x⁷+x⁴+x³+1 */
export function crc15(bits: number[]) {
  let crc = 0;
  for (const b of bits) {
    const next = b ^ ((crc >> 14) & 1);
    crc = (crc << 1) & 0x7fff;
    if (next) crc ^= 0x4599;
  }
  return crc;
}

/** a standard data frame as it goes on the bus: stuffed after five equal bits, up to the CRC */
export function canFrame(id: number, data: number[], acked: boolean) {
  const raw: CanBit[] = [{ v: 0, field: "sof" }];
  const push = (value: number, n: number, field: CanBit["field"]) => {
    for (let i = n - 1; i >= 0; i--) raw.push({ v: ((value >> i) & 1) as 0 | 1, field });
  };
  push(id, 11, "id");
  push(0, 1, "rtr");
  push(0, 1, "ide");
  push(0, 1, "r0");
  push(data.length, 4, "dlc");
  for (const d of data) push(d, 8, "data");
  const crc = crc15(raw.map((b) => b.v));
  push(crc, 15, "crc");
  const bits: CanBit[] = [];
  let run = 0;
  let last = -1;
  for (const b of raw) {
    bits.push(b);
    run = b.v === last ? run + 1 : 1;
    last = b.v;
    if (run === 5) {
      const s = (1 - b.v) as 0 | 1;
      bits.push({ v: s, field: "stuff" });
      last = s;
      run = 1;
    }
  }
  bits.push({ v: 1, field: "del" }, { v: acked ? 0 : 1, field: "ack" }, { v: 1, field: "del" });
  for (let i = 0; i < 7; i++) bits.push({ v: 1, field: "eof" });
  return { bits, crc, stuffed: bits.filter((b) => b.field === "stuff").length };
}

/* ============================================================== the station */

export type Weather = "mild" | "heat" | "storm";
export type Bus = "spi" | "uart" | "can" | "gpio";

const WEATHER: Record<Weather, { t: number; h: number; p: number; wind: number; rain: number }> = {
  mild: { t: 21.5, h: 52, p: 101600, wind: 3.2, rain: 0 },
  heat: { t: 41.5, h: 18, p: 100900, wind: 1.4, rain: 0 },
  storm: { t: 14, h: 93, p: 98600, wind: 13.5, rain: 1.6 },
};

/** an edge on a GPIO line, for the analyser */
export interface Edge {
  t: number;
  line: "PA0" | "PA1" | "PC13" | "PA5";
  v: 0 | 1;
}

export interface Sample {
  at: number;
  /** SPI1 transactions: what went out on MOSI and what came back on MISO */
  spi: { label: string; mosi: number[]; miso: number[] }[];
  raw: { adcT: number; adcP: number; adcH: number };
  t: number;
  p: number;
  h: number;
  tFine: number;
  wind: number;
  rainMm: number;
  pulses: number;
  tips: number;
  uart: string;
  can: { id: number; data: number[]; bits: CanBit[]; crc: number; stuffed: number; acked: boolean };
}

export class Station {
  weather: Weather = "mild";
  /** the environment, easing toward the weather */
  env = { ...WEATHER.mild };
  fahrenheit = false;
  nodeOnline = true;
  /** bxCAN's transmit error counter and state */
  tec = 0;
  canState: "error active" | "error passive" = "error active";
  attempts = 0;
  framesSent = 0;
  /** what the analyser shows */
  probe: Bus = "spi";
  last: Sample | null = null;
  /** the dashboard node's last good frame */
  shown: Sample | null = null;
  edges: Edge[] = [];
  /** console lines, newest last */
  uartLog: string[] = [];
  /** bus activity for the traces: when each bus last moved data */
  activity: Record<Bus, number> = { spi: -9, uart: -9, can: -9, gpio: -9 };
  led = 0;
  private nextSample = 0.6;
  private nextPulse = 0;
  private nextTip = 0;
  private pulses = 0;
  private tips = 0;
  private totalTips = 0;
  private retryAt = -1;
  /** the cups' angle, for the 3D anemometer */
  cups = 0;
  static readonly PERIOD = 2;

  setWeather(w: Weather) {
    this.weather = w;
  }

  pressButton(now: number) {
    // B1 on PC13: falling edge, EXTI15_10, the firmware swaps units
    this.edge(now, "PC13", 0);
    this.edge(now + 0.18, "PC13", 1);
    this.fahrenheit = !this.fahrenheit;
    this.activity.gpio = now;
    this.nextSample = Math.min(this.nextSample, now + 0.25);
  }

  setNode(online: boolean, now: number) {
    this.nodeOnline = online;
    if (online && this.retryAt >= 0) this.retryAt = now + 0.05;
  }

  private edge(t: number, line: Edge["line"], v: 0 | 1) {
    this.edges.push({ t, line, v });
  }

  /** advance the world and the firmware; true when a new sample went out */
  update(now: number, dt: number) {
    const w = WEATHER[this.weather];
    const k = Math.min(1, dt * 0.6);
    for (const key of Object.keys(w) as (keyof typeof w)[]) this.env[key] += (w[key] - this.env[key]) * k;
    // the anemometer: one reed closure per turn, 2.4 km/h per hertz
    const hz = this.env.wind / (2.4 / 3.6);
    this.cups += hz * Math.PI * 2 * dt;
    // edges at the times they happen, however long the frame was
    if (hz > 0.05) {
      if (this.nextPulse < now - 1) this.nextPulse = now;
      for (let i = 0; i < 64 && this.nextPulse <= now; i++) {
        const t = this.nextPulse;
        this.edge(t, "PA0", 0);
        this.edge(t + Math.min(0.02, 0.4 / hz), "PA0", 1);
        this.pulses++;
        this.nextPulse = t + 1 / hz;
        this.activity.gpio = now;
      }
    } else this.nextPulse = now;
    // the rain gauge: one tip per 0.2794 mm
    const tipsPerS = this.env.rain;
    if (tipsPerS > 0.05) {
      if (this.nextTip < now - 1) this.nextTip = now + 1 / tipsPerS;
      for (let i = 0; i < 16 && this.nextTip <= now; i++) {
        const t = this.nextTip;
        this.edge(t, "PA1", 0);
        this.edge(t + 0.03, "PA1", 1);
        this.tips++;
        this.totalTips++;
        this.activity.gpio = now;
        this.nextTip = t + 1 / tipsPerS;
      }
    } else this.nextTip = now;
    this.edges = this.edges.filter((e) => e.t > now - 2.4);
    let sent = false;
    if (now >= this.nextSample) {
      this.sample(now);
      this.nextSample = now + Station.PERIOD;
      sent = true;
    }
    // bxCAN retransmits on its own after an error
    if (this.retryAt >= 0 && now >= this.retryAt && this.last) {
      this.transmit(now, this.last);
      sent = true;
    }
    return sent;
  }

  private sample(now: number) {
    const e = this.env;
    // the heartbeat
    this.led = 1 - this.led;
    this.edge(now, "PA5", this.led as 0 | 1);
    // SPI1: forced mode, then a burst read from 0xF7 (bit 7 set: read; cleared: write)
    const regs = bmeRegisters(e.t + (Math.random() - 0.5) * 0.04, e.p + (Math.random() - 0.5) * 6, e.h + (Math.random() - 0.5) * 0.3);
    const spi = [
      { label: "write ctrl_hum ← 0x01", mosi: [0xf2 & 0x7f, 0x01], miso: [0xff, 0xff] },
      { label: "write ctrl_meas ← 0x25", mosi: [0xf4 & 0x7f, 0x25], miso: [0xff, 0xff] },
      { label: "read 0xF7..0xFE", mosi: [0xf7, 0, 0, 0, 0, 0, 0, 0, 0], miso: [0xff, ...regs.bytes] },
    ];
    const b = regs.bytes;
    const adcP = (b[0] << 12) | (b[1] << 4) | (b[2] >> 4);
    const adcT = (b[3] << 12) | (b[4] << 4) | (b[5] >> 4);
    const adcH = (b[6] << 8) | b[7];
    const c = compensate(adcT, adcP, adcH);
    const wind = (this.pulses / Station.PERIOD) * (2.4 / 3.6);
    const rainMm = this.tips * 0.2794;
    const temp = this.fahrenheit ? `${(c.t * 1.8 + 32).toFixed(2)}F` : `${c.t.toFixed(2)}C`;
    const uart = `T=${temp} RH=${c.h.toFixed(1)}% P=${(c.p / 100).toFixed(1)}hPa W=${wind.toFixed(1)}m/s R=${rainMm.toFixed(2)}mm`;
    // the frame: big-endian signals, as a DBC file would describe them
    const t100 = Math.round(c.t * 100) & 0xffff;
    const h100 = Math.round(c.h * 100);
    const p10 = Math.round(c.p / 10);
    const data = [t100 >> 8, t100 & 0xff, h100 >> 8, h100 & 0xff, p10 >> 8, p10 & 0xff, Math.min(255, Math.round(wind * 10)), this.totalTips & 0xff];
    const s: Sample = {
      at: now,
      spi,
      raw: { adcT, adcP, adcH },
      t: c.t,
      p: c.p,
      h: c.h,
      tFine: c.tFine,
      wind,
      rainMm,
      pulses: this.pulses,
      tips: this.tips,
      uart,
      can: { id: 0x120, data, bits: [], crc: 0, stuffed: 0, acked: false },
    };
    this.pulses = 0;
    this.tips = 0;
    this.activity.spi = now;
    this.activity.uart = now + 0.05;
    this.uartLog.push(uart);
    if (this.uartLog.length > 40) this.uartLog.shift();
    this.last = s;
    this.attempts = 0;
    this.transmit(now + 0.1, s);
  }

  /** one attempt to send the frame */
  private transmit(now: number, s: Sample) {
    const acked = this.nodeOnline;
    const f = canFrame(s.can.id, s.can.data, acked);
    s.can.bits = f.bits;
    s.can.crc = f.crc;
    s.can.stuffed = f.stuffed;
    s.can.acked = acked;
    this.attempts++;
    this.activity.can = now;
    if (acked) {
      this.framesSent++;
      this.tec = Math.max(0, this.tec - 1);
      this.retryAt = -1;
      this.shown = s;
    } else {
      // an ACK error: +8, except that an error-passive transmitter stops counting them
      if (this.canState === "error active") this.tec += 8;
      this.retryAt = now + 0.35;
    }
    this.canState = this.tec >= 128 ? "error passive" : "error active";
  }
}
