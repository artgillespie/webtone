// Band-limited wavetables for the WAVETONE machine.
//
// Each table has FRAMES single-cycle frames. Every frame is defined in the
// time domain (or as a harmonic spectrum), converted to a spectrum with an
// FFT, and stored as MIP levels, each with fewer harmonics, so any pitch
// can be played without aliasing. Built lazily per table on first use.

import { WAVETABLES } from '../core/params.js';
import { Rng } from './dsp.js';

export const TABLE_SIZE = 1024;
export const FRAMES = 16;
export const MIPS = 9; // level L keeps harmonics <= 512 >> L
const MASK = TABLE_SIZE - 1;

// --- radix-2 complex FFT (in place) ---------------------------------------
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// --- frame generators: (x in [0,1), f in [0,1]) -> sample ------------------
const TAU = Math.PI * 2;
const saw = (x) => 2 * x - 1;
const tri = (x) => (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4);
const sq = (x, w = 0.5) => (x < w ? 1 : -1);

function additive(x, amps) {
  let s = 0;
  for (let h = 0; h < amps.length; h++) if (amps[h]) s += amps[h] * Math.sin(TAU * (h + 1) * x);
  return s;
}

const vowels = [ // formant centre frequencies (relative to 100Hz fundamental, i.e. harmonic numbers)
  [7.3, 11], [5, 18], [2.7, 22], [5.7, 8.7], [3, 8.7],
];

const GEN = {
  PRIM(x, f) { // sine -> tri -> saw -> square -> narrow pulse
    const seg = f * 4, i = Math.min(3, Math.floor(seg)), t = seg - i;
    const shapes = [Math.sin(TAU * x), tri(x), saw((x + 0.5) % 1), sq(x), sq(x, 0.12)];
    return shapes[i] * (1 - t) + shapes[i + 1] * t;
  },
  HARM(x, f) {
    const n = 1 + Math.round(f * 40);
    const amps = [];
    for (let h = 1; h <= n; h++) amps.push((h === n ? 1 : 0.6) / Math.sqrt(h));
    return additive(x, amps);
  },
  SYNC(x, f) { const r = 1 + f * 7; return saw((x * r) % 1) * (1 - x * 0.3); },
  VOX(x, f) {
    const pos = f * (vowels.length - 1), i = Math.min(vowels.length - 2, Math.floor(pos)), t = pos - i;
    const f1 = vowels[i][0] * (1 - t) + vowels[i + 1][0] * t;
    const f2 = vowels[i][1] * (1 - t) + vowels[i + 1][1] * t;
    const amps = [];
    for (let h = 1; h <= 40; h++) amps.push(Math.exp(-((h - f1) ** 2) / 3) + 0.6 * Math.exp(-((h - f2) ** 2) / 6) + 0.25 / h);
    return additive(x, amps);
  },
  PWM(x, f) { return sq(x, 0.5 - f * 0.46); },
  FOLD(x, f) { return Math.sin(Math.sin(TAU * x) * (1 + f * 7) * Math.PI * 0.5); },
  DIGI(x, f, frame) {
    const levels = Math.max(2, Math.round(16 - f * 14));
    const rng = new Rng(1234 + frame * 77);
    const amps = Array.from({ length: 12 }, (_, h) => (rng.next() < 0.5 + f * 0.3 ? rng.next() / (h * 0.5 + 1) : 0));
    amps[0] = 1;
    const v = additive(x, amps) / 2;
    return Math.round(v * levels) / levels;
  },
  ORGN(x, f) {
    const bars = [
      [8, 8, 8, 0, 0, 0, 0, 0, 0], [8, 0, 8, 0, 6, 0, 0, 0, 0], [8, 6, 8, 4, 0, 3, 0, 0, 2],
      [6, 8, 8, 8, 6, 4, 2, 0, 0], [8, 8, 8, 8, 8, 8, 8, 8, 8],
    ];
    const harmonics = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
    const pos = f * (bars.length - 1), i = Math.min(bars.length - 2, Math.floor(pos)), t = pos - i;
    let s = 0;
    for (let b = 0; b < 9; b++) {
      const a = (bars[i][b] * (1 - t) + bars[i + 1][b] * t) / 8;
      // sub-harmonic drawbar (0.5) is folded to fundamental to stay single-cycle
      const h = Math.max(1, Math.round(harmonics[b] * 2) / 2);
      s += a * Math.sin(TAU * Math.round(h) * x);
    }
    return s;
  },
};

const cache = new Map();

/** Returns Float32Array[FRAMES][MIPS] of TABLE_SIZE+1 (guard sample) for table index. */
export function getTable(index) {
  if (cache.has(index)) return cache.get(index);
  const name = WAVETABLES[index] || 'PRIM';
  const gen = GEN[name];
  const frames = [];
  const re = new Float64Array(TABLE_SIZE), im = new Float64Array(TABLE_SIZE);
  const tr = new Float64Array(TABLE_SIZE), ti = new Float64Array(TABLE_SIZE);
  for (let fr = 0; fr < FRAMES; fr++) {
    const f = fr / (FRAMES - 1);
    for (let i = 0; i < TABLE_SIZE; i++) { re[i] = gen(i / TABLE_SIZE, f, fr); im[i] = 0; }
    fft(re, im, false);
    re[0] = im[0] = 0; // remove DC
    const mips = [];
    let norm = 0;
    for (let L = 0; L < MIPS; L++) {
      const maxH = (TABLE_SIZE / 2) >> L;
      tr.set(re); ti.set(im);
      for (let k = maxH; k <= TABLE_SIZE - maxH; k++) { tr[k] = 0; ti[k] = 0; }
      fft(tr, ti, true);
      const out = new Float32Array(TABLE_SIZE + 1);
      if (L === 0) { for (let i = 0; i < TABLE_SIZE; i++) norm = Math.max(norm, Math.abs(tr[i])); norm = norm || 1; }
      for (let i = 0; i < TABLE_SIZE; i++) out[i] = tr[i] / norm;
      out[TABLE_SIZE] = out[0];
      mips.push(out);
    }
    frames.push(mips);
  }
  cache.set(index, frames);
  return frames;
}

/** Choose MIP level for a phase increment (cycles/sample). */
export function mipFor(inc) {
  // harmonics allowed below Nyquist: 0.5 / inc
  const allowed = 0.5 / Math.max(inc, 1e-9);
  let L = 0;
  while (L < MIPS - 1 && ((TABLE_SIZE / 2) >> L) > allowed) L++;
  return L;
}

/** Linear-interpolated lookup of one mip table at phase [0,1). */
export function lookup(tab, phase) {
  const f = phase * TABLE_SIZE;
  const i = f | 0;
  const fr = f - i;
  const a = tab[i & MASK];
  return a + (tab[(i & MASK) + 1] - a) * fr;
}
