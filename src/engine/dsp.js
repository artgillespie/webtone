// Low-level DSP helpers. Pure, allocation-free in hot paths.

export const TAU = Math.PI * 2;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);

/** Deterministic xorshift32 RNG. next() in [0,1), bi() in [-1,1). */
export class Rng {
  constructor(seed = 0x9e3779b9) { this.s = (seed >>> 0) || 1; }
  u32() {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x;
  }
  next() { return this.u32() / 4294967296; }
  bi() { return this.u32() / 2147483648 - 1; }
}

// Sine table with linear interpolation. Phase in cycles.
const SIN_SIZE = 4096;
const SIN = new Float32Array(SIN_SIZE + 1);
for (let i = 0; i <= SIN_SIZE; i++) SIN[i] = Math.sin((i / SIN_SIZE) * TAU);

/** sin(2π·phase), phase any real number (cycles). */
export function sinc(phase) {
  let p = phase - Math.floor(phase);
  const f = p * SIN_SIZE;
  const i = f | 0;
  const fr = f - i;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * fr;
}

/** Cheap soft clipper ~tanh, exact 1 at |x|>=3. */
export function softclip(x) {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** PolyBLEP residual for naive saw/square anti-aliasing. t phase [0,1), dt = f/sr. */
export function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** One-pole coefficient for a time constant in seconds. */
export const onePoleCoef = (seconds, sr) => (seconds <= 0 ? 0 : Math.exp(-1 / (seconds * sr)));

/** Coefficient for a one-pole lowpass at cutoff hz (for y += (x - y) * c). */
export const lpCoef = (hz, sr) => 1 - Math.exp((-TAU * hz) / sr);
