// Envelopes.
//
// Env   — ADSR/AHD with hold & delay; linear attack, exponential decay/release.
//         Retriggering restarts from the current level (click-free).
// OpEnv — FM operator envelope: delay -> attack -> decay to END level, holds END.

import { valueToTime } from '../core/params.js';

const IDLE = 0, DELAY = 1, ATTACK = 2, HOLD = 3, DECAY = 4, SUSTAIN = 5, RELEASE = 6;
const EXP_K = 4.6; // exp(-4.6) ~= 1% -> "time" = time to reach within 1% of target

export class Env {
  constructor(sr) {
    this.sr = sr;
    this.stage = IDLE;
    this.level = 0;
    this.counter = 0;
    this.atkInc = 1; this.holdN = 0; this.decCoef = 0; this.relCoef = 0; this.sus = 1; this.delayN = 0;
    this.ahd = false;
  }
  /** Set timing from 0..127 param values. Cheap enough to call per control tick. */
  set(atk, hold, dec, sus, rel, ahd = false, delay = 0) {
    const sr = this.sr;
    this.atkInc = 1 / Math.max(1, valueToTime(atk) * sr);
    this.holdN = hold <= 0 ? 0 : valueToTime(hold) * sr;
    this.decCoef = Math.exp(-EXP_K / (valueToTime(dec) * sr));
    this.relCoef = Math.exp(-EXP_K / (valueToTime(rel) * sr));
    this.sus = ahd ? 0 : sus / 127;
    this.ahd = ahd;
    this.delayN = delay <= 0 ? 0 : valueToTime(delay) * sr;
  }
  trigger(reset = true) {
    if (reset) this.level = 0;
    if (this.delayN > 0) { this.stage = DELAY; this.counter = this.delayN; }
    else this.stage = ATTACK;
  }
  release() {
    if (this.ahd) return; // AHD ignores gate
    if (this.stage !== IDLE) this.stage = RELEASE;
  }
  /** Force a fast release (used for voice stealing / stop). */
  kill(sr = this.sr) { this.stage = RELEASE; this.relCoef = Math.exp(-EXP_K / (0.004 * sr)); }
  get active() { return this.stage !== IDLE; }
  tick() {
    switch (this.stage) {
      case IDLE: return 0;
      case DELAY:
        if (--this.counter <= 0) this.stage = ATTACK;
        return this.level;
      case ATTACK:
        this.level += this.atkInc;
        if (this.level >= 1) {
          this.level = 1;
          if (this.holdN > 0) { this.stage = HOLD; this.counter = this.holdN; } else this.stage = DECAY;
        }
        return this.level;
      case HOLD:
        if (--this.counter <= 0) this.stage = DECAY;
        return this.level;
      case DECAY:
        this.level = this.sus + (this.level - this.sus) * this.decCoef;
        if (this.level - this.sus < 1e-4) {
          this.level = this.sus;
          if (this.sus <= 0) { this.stage = IDLE; this.level = 0; } else this.stage = SUSTAIN;
        }
        return this.level;
      case SUSTAIN:
        this.level = this.sus;
        return this.level;
      case RELEASE:
        this.level *= this.relCoef;
        if (this.level < 1e-4) { this.level = 0; this.stage = IDLE; }
        return this.level;
    }
    return 0;
  }
  /** Advance n samples, return final level. */
  skip(n) {
    let v = this.level;
    for (let i = 0; i < n; i++) v = this.tick();
    return v;
  }
}

/** FM operator envelope; value in 0..1. Evaluated at control rate + interpolated. */
export class OpEnv {
  constructor(sr) {
    this.sr = sr;
    this.level = 0; this.stage = 0; this.counter = 0;
    this.atkInc = 1; this.decCoef = 0; this.end = 0; this.delayN = 0;
  }
  set(atk, dec, end, delay) {
    const sr = this.sr;
    this.atkInc = atk <= 0 ? 1 : 1 / (valueToTime(atk) * sr);
    this.decCoef = dec >= 127 ? 1 : Math.exp(-EXP_K / (valueToTime(dec) * sr));
    this.end = end / 127;
    this.delayN = delay <= 0 ? 0 : valueToTime(delay) * sr;
  }
  trigger(reset) {
    if (reset) this.level = 0;
    if (this.delayN > 0) { this.stage = 1; this.counter = this.delayN; } else this.stage = 2;
  }
  /** Advance n samples (closed form per stage). */
  skip(n) {
    while (n > 0) {
      switch (this.stage) {
        case 0: return this.level;
        case 1: {
          const k = Math.min(n, this.counter);
          this.counter -= k; n -= k;
          if (this.counter <= 0) this.stage = 2;
          break;
        }
        case 2: {
          const need = Math.ceil((1 - this.level) / this.atkInc);
          const k = Math.min(n, Math.max(need, 0));
          this.level = Math.min(1, this.level + this.atkInc * k);
          n -= k;
          if (this.level >= 1 || need <= 0) { this.level = 1; this.stage = 3; }
          break;
        }
        case 3:
          this.level = this.end + (this.level - this.end) * Math.pow(this.decCoef, n);
          n = 0;
          break;
      }
    }
    return this.level;
  }
}
