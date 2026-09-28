// SWARMER — main oscillator (+octave) and a swarm of up to 6 detuned,
// slowly animated oscillators (PolyBLEP anti-aliased), with noise FM.

import { PARAM_INDEX as I } from '../../core/params.js';
import { mtof, Rng, polyblep, sinc } from '../dsp.js';

const TUNE = I['swm.tune'], DTUN = I['swm.dtun'], MIX = I['swm.mix'], MWAV = I['swm.mwav'], SWAV = I['swm.swav'];
const MOCT = I['swm.moct'], ANIM = I['swm.anim'], NMOD = I['swm.nmod'], PW = I['swm.pw'], DENS = I['swm.dens'], ARTE = I['swm.arte'];

const SPREAD = [-1, 1, -0.55, 0.55, -0.2, 0.2]; // order = density fill order
const OCTS = [1, 0.5, 0.25];

// wave ids: main [SIN, TRI, SAW, SQR]; swarm [SAW, SQR, TRI, SIN]
function osc(kind, ph, dt, pw) {
  switch (kind) {
    case 0: return sinc(ph);
    case 1: return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
    case 2: return 2 * ph - 1 - polyblep(ph, dt);
    default: {
      let v = ph < pw ? 1 : -1;
      v += polyblep(ph, dt);
      let t2 = ph - pw; if (t2 < 0) t2 += 1;
      v -= polyblep(t2, dt);
      return v;
    }
  }
}
const SWARM_KIND = [2, 3, 1, 0];

export class Swarmer {
  constructor(sr, seed = 1) {
    this.sr = sr;
    this.rng = new Rng(seed * 15485863 + 3);
    this.pm = 0;
    this.ph = new Float64Array(6);
    this.anim = new Float64Array(6);
    this.animT = new Float64Array(6);
    for (let k = 0; k < 6; k++) { this.ph[k] = this.rng.next(); this.animT[k] = this.rng.bi(); }
    this.nz = 0;
    this.incs = new Float64Array(6);
  }
  noteOn() { /* free-running swarm: no phase reset (analog-like) */ }
  render(p, buf, n, note) {
    const sr = this.sr, rng = this.rng;
    const base = mtof(note + p[TUNE]);
    const mainInc = (base * OCTS[p[MOCT] | 0]) / sr;
    const mw = p[MWAV] | 0;
    const sk = SWARM_KIND[p[SWAV] | 0];
    const pw = 0.5 - (p[PW] - 64) / 140;
    const det = Math.pow(p[DTUN] / 127, 2) * 1.2; // semitones at spread 1
    const dens = Math.max(1, Math.min(6, Math.round(p[DENS])));
    const anim = (p[ANIM] / 127) * 0.35;
    const arte = 0.0002 + Math.pow(p[ARTE] / 127, 2) * 0.02;
    // animation: smoothed random targets per osc, updated at control rate
    for (let k = 0; k < dens; k++) {
      if (rng.next() < arte * n) this.animT[k] = rng.bi();
      this.anim[k] += (this.animT[k] - this.anim[k]) * Math.min(1, arte * n * 2);
    }
    const incs = this.incs;
    for (let k = 0; k < dens; k++) incs[k] = (base * Math.pow(2, (SPREAD[k] * det + this.anim[k] * anim) / 12)) / sr;
    const m = (p[MIX] + 64) / 127;
    const gMain = Math.cos(m * Math.PI * 0.5) * 0.9;
    const gSw = (Math.sin(m * Math.PI * 0.5) * 1.1) / Math.sqrt(dens);
    const nmod = Math.pow(p[NMOD] / 127, 2) * 0.08;
    let pm = this.pm, nz = this.nz;
    const ph = this.ph;
    for (let i = 0; i < n; i++) {
      let fm = 1;
      if (nmod > 0) { nz += (rng.bi() - nz) * 0.2; fm = 1 + nz * nmod * 4; }
      const mi = mainInc * fm;
      let s = osc(mw, pm, mi, pw) * gMain;
      pm += mi; if (pm >= 1) pm -= pm | 0;
      let sw = 0;
      for (let k = 0; k < dens; k++) {
        const inc = incs[k] * fm;
        sw += osc(sk, ph[k], inc, 0.5);
        let q = ph[k] + inc; if (q >= 1) q -= q | 0; ph[k] = q;
      }
      buf[i] = (s + sw * gSw) * 0.4;
    }
    this.pm = pm; this.nz = nz;
  }
}
