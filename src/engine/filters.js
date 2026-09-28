// Voice filters: the six filter "machines" + the base-width filter.
// All process a mono buffer in place over [0, n). Cutoff is interpolated
// per-sample between control ticks to avoid zipper noise.

import { clamp, softclip } from './dsp.js';

const PI = Math.PI;

/** Topology-preserving-transform state variable filter (Simper). */
export class Svf {
  constructor() { this.ic1 = 0; this.ic2 = 0; }
  reset() { this.ic1 = this.ic2 = 0; }
}

/** g coefficient for cutoff hz. */
export const svfG = (hz, sr) => Math.tan((PI * clamp(hz, 10, sr * 0.47)) / sr);

export class VoiceFilter {
  constructor(sr) {
    this.sr = sr;
    this.a = new Svf(); // main
    this.b = new Svf(); // LP4 / aux
    this.hp = new Svf(); // base-width HP
    this.lp = new Svf(); // base-width LP
    this.l1 = 0; this.l2 = 0; this.l3 = 0; this.l4 = 0; // ladder
    this.comb = new Float32Array(4096);
    this.cw = 0; this.cz = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; // biquad
    this.prevG = -1;
  }
  reset() {
    this.a.reset(); this.b.reset(); this.hp.reset(); this.lp.reset();
    this.l1 = this.l2 = this.l3 = this.l4 = 0;
    this.comb.fill(0); this.cz = 0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.prevG = -1;
  }

  /**
   * @param buf  Float32Array mono audio, processed in place
   * @param n    samples
   * @param mach filter machine index (FILTER_MACHINES)
   * @param hz   cutoff at end of this block (start is remembered from last call)
   * @param res  0..127
   * @param typ  0..127 (meaning depends on machine)
   */
  process(buf, n, mach, hz, res, typ) {
    const sr = this.sr;
    const g1 = svfG(hz, sr);
    const g0 = this.prevG < 0 ? g1 : this.prevG;
    this.prevG = g1;
    const dg = (g1 - g0) / n;
    const r = res / 127;
    switch (mach) {
      case 0: { // MULTI: morph LP -> BP -> HP, 12dB
        const k = 2 - 1.98 * r;
        const t = typ / 127;
        const lpA = t < 0.5 ? 1 - t * 2 : 0;
        const bpA = t < 0.5 ? t * 2 : 2 - t * 2;
        const hpA = t < 0.5 ? 0 : t * 2 - 1;
        const s = this.a;
        let ic1 = s.ic1, ic2 = s.ic2, g = g0;
        for (let i = 0; i < n; i++) {
          g += dg;
          const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          const v0 = buf[i];
          const v3 = v0 - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          buf[i] = lpA * v2 + bpA * v1 * k * 1.2 + hpA * (v0 - k * v1 - v2);
        }
        s.ic1 = ic1; s.ic2 = ic2;
        break;
      }
      case 1: { // LP4: ZDF ladder, 24dB, TYPE = drive
        const k = 3.9 * r;
        const drive = 1 + (typ / 127) * 6;
        const comp = 1 + k * 0.45;
        let l1 = this.l1, l2 = this.l2, l3 = this.l3, l4 = this.l4, g = g0;
        for (let i = 0; i < n; i++) {
          g += dg;
          const G = g / (1 + g);
          const ig = 1 / (1 + g);
          const G2 = G * G, G3 = G2 * G, G4 = G3 * G;
          const sig = G3 * l1 * ig + G2 * l2 * ig + G * l3 * ig + l4 * ig;
          const x = buf[i] * drive * comp;
          const u = softclip((x - k * sig) / (1 + k * G4));
          let v = (u - l1) * G; const y1 = v + l1; l1 = y1 + v;
          v = (y1 - l2) * G; const y2 = v + l2; l2 = y2 + v;
          v = (y2 - l3) * G; const y3 = v + l3; l3 = y3 + v;
          v = (y3 - l4) * G; const y4 = v + l4; l4 = y4 + v;
          buf[i] = y4 / Math.sqrt(drive);
        }
        this.l1 = l1; this.l2 = l2; this.l3 = l3; this.l4 = l4;
        break;
      }
      case 2: { // LEGACY: resonant 2-pole LP (TYPE<64) or HP, gently driven
        const k = 2 - 1.99 * r;
        const hpMode = typ >= 64;
        const s = this.a;
        let ic1 = s.ic1, ic2 = s.ic2, g = g0;
        for (let i = 0; i < n; i++) {
          g += dg;
          const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          const v0 = softclip(buf[i] * 1.2);
          const v3 = v0 - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          buf[i] = hpMode ? v0 - k * v1 - v2 : v2;
        }
        s.ic1 = ic1; s.ic2 = ic2;
        break;
      }
      case 3: case 4: { // COMB- / COMB+: tuned feedback comb, TYPE = damping LPF
        const sign = mach === 3 ? -1 : 1;
        const fb = sign * Math.min(0.985, r * 1.02);
        const damp = 0.05 + (typ / 127) * 0.95; // lowpass coefficient in loop (1 = open)
        const line = this.comb, mask = 4095;
        let w = this.cw, z = this.cz;
        const hz0 = this._lastHz || hz;
        this._lastHz = hz;
        for (let i = 0; i < n; i++) {
          const f = hz0 + ((hz - hz0) * (i + 1)) / n;
          const d = clamp(sr / Math.max(f, 12), 2, 4090);
          let rp = w - d;
          const ri = Math.floor(rp);
          const fr = rp - ri;
          const a = line[ri & mask], b = line[(ri + 1) & mask];
          const out = a + (b - a) * fr;
          z += (out - z) * damp;
          const y = buf[i] + fb * z;
          line[w & mask] = softclip(y);
          w++;
          buf[i] = y * 0.5;
        }
        this.cw = w & mask; this.cz = z;
        break;
      }
      case 5: { // EQ: peaking bell, RESO = Q, TYPE = gain (64 = flat)
        const gainDb = ((typ - 64) / 64) * 18;
        const A = Math.pow(10, gainDb / 40);
        const w0 = (2 * PI * clamp(hz, 20, sr * 0.45)) / sr;
        const q = 0.3 + r * 8;
        const alpha = Math.sin(w0) / (2 * q);
        const cs = Math.cos(w0);
        const a0 = 1 + alpha / A;
        const b0 = (1 + alpha * A) / a0, b1 = (-2 * cs) / a0, b2 = (1 - alpha * A) / a0;
        const a1 = (-2 * cs) / a0, a2 = (1 - alpha / A) / a0;
        let x1 = this.x1, x2 = this.x2, y1 = this.y1, y2 = this.y2;
        for (let i = 0; i < n; i++) {
          const x = buf[i];
          const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          buf[i] = y;
        }
        this.x1 = x1; this.x2 = x2; this.y1 = y1 + 1e-18 - 1e-18; this.y2 = y2;
        break;
      }
    }
  }

  /** Base-width filter: 12dB HP at baseHz, 12dB LP at lpHz. */
  baseWidth(buf, n, baseHz, lpHz) {
    const sr = this.sr;
    const k = 1.414;
    if (baseHz > 21) {
      const g = svfG(baseHz, sr);
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      let { ic1, ic2 } = this.hp;
      for (let i = 0; i < n; i++) {
        const v0 = buf[i];
        const v3 = v0 - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
        buf[i] = v0 - k * v1 - v2;
      }
      this.hp.ic1 = ic1; this.hp.ic2 = ic2;
    }
    if (lpHz < 19000) {
      const g = svfG(lpHz, sr);
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      let { ic1, ic2 } = this.lp;
      for (let i = 0; i < n; i++) {
        const v0 = buf[i];
        const v3 = v0 - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
        buf[i] = v2;
      }
      this.lp.ic1 = ic1; this.lp.ic2 = ic2;
    }
  }
}

/** Simple SVF used by machines for noise shaping (bandpass-ish HP/LP pair). */
export class NoiseShaper {
  constructor(sr) { this.sr = sr; this.h1 = 0; this.h2 = 0; this.l1 = 0; this.l2 = 0; }
  reset() { this.h1 = this.h2 = this.l1 = this.l2 = 0; }
  /** Process one sample with precomputed coefficients from coefs(). */
  coefs(hpHz, lpHz, out) {
    const k = 1.2;
    const gh = svfG(hpHz, this.sr), gl = svfG(lpHz, this.sr);
    out[0] = 1 / (1 + gh * (gh + k)); out[1] = gh * out[0]; out[2] = gh * out[1];
    out[3] = 1 / (1 + gl * (gl + k)); out[4] = gl * out[3]; out[5] = gl * out[4];
    out[6] = k;
  }
  tick(x, c) {
    const k = c[6];
    let v3 = x - this.h2;
    let v1 = c[0] * this.h1 + c[1] * v3;
    let v2 = this.h2 + c[1] * this.h1 + c[2] * v3;
    this.h1 = 2 * v1 - this.h1; this.h2 = 2 * v2 - this.h2;
    const hp = x - k * v1 - v2;
    v3 = hp - this.l2;
    v1 = c[3] * this.l1 + c[4] * v3;
    v2 = this.l2 + c[4] * this.l1 + c[5] * v3;
    this.l1 = 2 * v1 - this.l1; this.l2 = 2 * v2 - this.l2;
    return v2;
  }
}
