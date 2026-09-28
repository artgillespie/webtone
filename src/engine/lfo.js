// Track LFO. Tempo-synced: cycles per step = |SPD| * MULT / 2048
// (SPD 16 × MULT 8 = one cycle per bar). Negative SPD runs backwards.
// Output: bipolar waves in -1..1, EXP/RMP unipolar 0..1.

import { Rng } from './dsp.js';

const TRI = 0, SIN = 1, SQR = 2, SAW = 3, EXP = 4, RMP = 5, RND = 6;
const FREE = 0, TRIG = 1, HOLD = 2, ONE = 3, HALF = 4;

export class Lfo {
  constructor(seed) {
    this.phase = 0;
    this.run = 0; // accumulated cycles since trig (for ONE/HALF)
    this.value = 0;
    this.held = 0;
    this.fade = 1;
    this.rnd = 0;
    this.rng = new Rng(seed);
    this.stopped = false;
    this.lastCycle = 0;
  }
  static waveAt(wave, ph, rnd) {
    switch (wave) {
      case TRI: return ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4;
      case SIN: return Math.sin(ph * Math.PI * 2);
      case SQR: return ph < 0.5 ? 1 : -1;
      case SAW: return 1 - ph * 2;
      case EXP: return Math.pow(1 - ph, 4);
      case RMP: return ph;
      case RND: return rnd;
    }
    return 0;
  }
  trigger(mode, sph, fadeParam) {
    if (mode === FREE) return;
    if (mode === HOLD) { this.held = this.value; return; }
    this.phase = sph / 128;
    this.run = 0;
    this.stopped = false;
    this.fade = fadeParam < 0 ? 0 : 1;
    this.rnd = this.rng.bi();
  }
  /** Advance by `seconds`; returns current output (with fade applied). */
  advance(seconds, hz, wave, mode, fadeParam, dirSign) {
    if (!this.stopped) {
      const d = hz * seconds;
      this.phase += d * dirSign;
      this.run += d;
      const cyc = Math.floor(this.phase);
      if (cyc !== 0) {
        this.phase -= cyc;
        this.rnd = this.rng.bi();
      }
      if ((mode === ONE && this.run >= 1) || (mode === HALF && this.run >= 0.5)) {
        this.stopped = true;
        this.phase = mode === ONE ? 0.9999 : ((this.phase + 1) % 1);
      }
    }
    if (fadeParam !== 0) {
      const rate = (Math.abs(fadeParam) / 64) * 4 * seconds; // full fade in ~1/4..∞ s
      this.fade = fadeParam < 0 ? Math.min(1, this.fade + rate) : Math.max(0, this.fade - rate);
    } else this.fade = 1;
    const v = mode === HOLD ? this.held : Lfo.waveAt(wave, this.phase, this.rnd);
    this.value = mode === HOLD ? Lfo.waveAt(wave, this.phase, this.rnd) : v;
    return v * this.fade;
  }
}
