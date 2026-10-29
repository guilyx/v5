/**
 * The bench in Nantes: a function generator into an RC low-pass filter, both ends on a scope.
 * The maths of a first year in electronics: the transfer function H(jω) = 1 / (1 + jωRC), its Bode
 * plot, and the Fourier series that says what a square or a triangle wave is made of, and so what
 * the filter does to it.
 */

export const R = 1600; // ohms
export const C = 100e-9; // farads
export const FC = 1 / (2 * Math.PI * R * C);

export type Wave = "sine" | "square" | "triangle";
export const WAVES: Wave[] = ["sine", "square", "triangle"];
/** a decade in four steps either side of the cut-off */
export const FREQS = [100, 316, 1000, 3160, 10000];

/** the filter's gain and phase at f */
export function response(f: number) {
  const x = f / FC;
  return { mag: 1 / Math.sqrt(1 + x * x), phase: -Math.atan(x) };
}

/** the input, one unit of amplitude, at phase p in [0, 1) of its period */
export function input(w: Wave, p: number) {
  const q = p - Math.floor(p);
  if (w === "sine") return Math.sin(2 * Math.PI * q);
  if (w === "square") return q < 0.5 ? 1 : -1;
  return q < 0.25 ? 4 * q : q < 0.75 ? 2 - 4 * q : 4 * q - 4;
}

/** Fourier series amplitudes, harmonics 1..n (sine terms; the even ones are zero for these waves) */
export function harmonics(w: Wave, n = 9) {
  const out: number[] = [];
  for (let k = 1; k <= n; k++) {
    if (w === "sine") out.push(k === 1 ? 1 : 0);
    else if (k % 2 === 0) out.push(0);
    else if (w === "square") out.push(4 / (Math.PI * k));
    else out.push(8 / (Math.PI * Math.PI * k * k));
  }
  return out;
}

/**
 * Two periods of input and output in steady state, by integrating RC dy/dt = x - y exactly over
 * small steps (the input held over each one), after enough periods for the start to have died out.
 */
export function traces(w: Wave, f: number, samples = 400) {
  const T = 1 / f;
  const tau = R * C;
  const per = samples / 2;
  const dt = T / per;
  const a = Math.exp(-dt / tau);
  let y = 0;
  const settle = Math.max(4, Math.ceil((6 * tau) / T));
  for (let i = 0; i < settle * per; i++) y = input(w, i / per) + (y - input(w, i / per)) * a;
  const xin = new Float32Array(samples);
  const yout = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = input(w, i / per);
    xin[i] = x;
    y = x + (y - x) * a;
    yout[i] = y;
  }
  return { xin, yout };
}

export const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 ? 2 : 0)} kHz` : `${f.toFixed(0)} Hz`);
