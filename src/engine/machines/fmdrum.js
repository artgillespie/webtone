// FM DRUM — percussion voice.
//   Body: sine carrier with exponential pitch sweep, FM modulator (ratio,
//         depth, own decay), feedback and a wavefolder. Hold/decay envelope.
//   Noise: white / metallic (6 inharmonic squares) / grain, shaped by a
//          HP(base)+LP(base+width) filter, hold/decay envelope.
//   Transient: 7 synthetic attack layers (click, blip, noise, zap, ...).

import { PARAM_INDEX as I, RATIOS, valueToTime, valueToHz } from '../../core/params.js';
import { sinc, mtof, Rng, softclip } from '../dsp.js';
import { NoiseShaper } from '../filters.js';

const TUNE = I['fmd.tune'], STIM = I['fmd.stim'], SDEP = I['fmd.sdep'], ALGO = I['fmd.algo'], RAT = I['fmd.rat'];
const MOD = I['fmd.mod'], FDBK = I['fmd.fdbk'], FOLD = I['fmd.fold'];
const BHLD = I['fmd.bhld'], BDEC = I['fmd.bdec'], BLEV = I['fmd.blev'], PHS = I['fmd.phs'], MDEC = I['fmd.mdec'];
const NHLD = I['fmd.nhld'], NDEC = I['fmd.ndec'], NLEV = I['fmd.nlev'], NBAS = I['fmd.nbas'], NWID = I['fmd.nwid'];
const NTYP = I['fmd.ntyp'], NCHR = I['fmd.nchr'], TRNS = I['fmd.trns'], TLEV = I['fmd.tlev'], VSW = I['fmd.vsw'];

const METAL = [2, 3, 4.16, 5.43, 6.79, 8.21];

export class FmDrum {
  constructor(sr, seed = 1) {
    this.sr = sr;
    this.rng = new Rng(seed * 7919 + 13);
    this.pc = 0; this.pm = 0; this.fbPrev = 0;
    this.sweep = 0; this.body = 0; this.bodyHold = 0; this.modEnv = 0;
    this.noise = 0; this.noiseHold = 0;
    this.t = 0; // samples since trig (transient)
    this.metal = new Float64Array(6);
    this.shaper = new NoiseShaper(sr);
    this.coefs = new Float64Array(7);
    this.velSweep = 1;
    this.grainHold = 0;
  }
  noteOn(p, vel) {
    const sr = this.sr;
    this.pc = (p[PHS] / 127) * 0.5;
    this.pm = 0; this.fbPrev = 0;
    this.sweep = 1; this.modEnv = 1;
    this.body = 1; this.bodyHold = p[BHLD] > 0 ? valueToTime(p[BHLD]) * sr : 0;
    this.noise = 1; this.noiseHold = p[NHLD] > 0 ? valueToTime(p[NHLD]) * sr : 0;
    this.t = 0;
    this.velSweep = Math.max(0, 1 + (p[VSW] / 64) * ((vel / 127) * 2 - 1));
  }
  /** True once every layer has decayed — lets the voice free itself early. */
  silent() {
    return this.t > this.sr * 0.06 && this.bodyHold <= 0 && this.noiseHold <= 0 && this.body < 1e-4 && this.noise < 1e-4;
  }
  render(p, buf, n, note) {
    const sr = this.sr;
    const f0 = mtof(p[TUNE] + (note - 60));
    const sweepCoef = Math.exp(-4.6 / (Math.max(0.001, valueToTime(p[STIM]) * 0.35) * sr));
    const sweepSemis = (p[SDEP] / 127) * 60 * this.velSweep;
    const bodyCoef = Math.exp(-4.6 / (valueToTime(p[BDEC]) * sr));
    const modCoef = Math.exp(-4.6 / (valueToTime(p[MDEC]) * sr));
    const noiseCoef = Math.exp(-4.6 / (valueToTime(p[NDEC]) * sr));
    const ratio = RATIOS[p[RAT] | 0];
    const modDepth = (p[MOD] / 127) * 1.5;
    const fb = (p[FDBK] / 127) * 0.8;
    const fold = p[FOLD] / 127;
    const foldG = 1 + fold * 5;
    const blev = p[BLEV] / 127, nlev = p[NLEV] / 127, tlev = p[TLEV] / 127;
    const algo = p[ALGO] | 0;
    const ntyp = p[NTYP] | 0;
    const nchr = p[NCHR] / 127;
    const trns = p[TRNS] | 0;
    const nb = p[NBAS];
    this.shaper.coefs(valueToHz(nb), valueToHz(Math.min(127, nb + p[NWID])), this.coefs);
    const coefs = this.coefs;
    const metalBase = 60 + nchr * nchr * 900;
    const grainP = 0.0005 + nchr * nchr * 0.2;

    let pc = this.pc, pm = this.pm, fbPrev = this.fbPrev, sweep = this.sweep, body = this.body, modEnv = this.modEnv;
    let noiseEnv = this.noise;
    if (!(p[NLEV] > 0)) noiseEnv = 0;
    const rng = this.rng, metal = this.metal;
    for (let i = 0; i < n; i++) {
      const freq = f0 * Math.pow(2, (sweep * sweepSemis) / 12);
      const inc = freq / sr;
      // --- body
      let y;
      if (algo === 0) {
        const m = sinc(pm) * modDepth * modEnv;
        y = sinc(pc + m + fbPrev * fb);
        fbPrev = y;
      } else if (algo === 1) {
        const m = sinc(pm + fbPrev * fb);
        fbPrev = m;
        y = sinc(pc + m * modDepth * modEnv);
      } else {
        const m = sinc(pm + fbPrev * fb);
        fbPrev = m;
        y = sinc(pc) * 0.75 + m * modDepth * modEnv * 0.5;
      }
      if (fold > 0) y = sinc(y * foldG * 0.25);
      pc += inc; pm += inc * ratio;
      if (pc >= 1) pc -= pc | 0;
      if (pm >= 1) pm -= pm | 0;
      sweep *= sweepCoef;
      modEnv *= modCoef;
      if (this.bodyHold > 0) this.bodyHold--; else body *= bodyCoef;

      // --- noise
      let nz = 0;
      if (nlev > 0 && noiseEnv > 1e-4) {
        let src;
        if (ntyp === 0) src = rng.bi();
        else if (ntyp === 1) {
          src = 0;
          for (let k = 0; k < 6; k++) {
            metal[k] += (metalBase * METAL[k]) / sr;
            if (metal[k] >= 1) metal[k] -= 1;
            src += metal[k] < 0.5 ? 1 : -1;
          }
          src *= 0.25;
        } else {
          src = rng.next() < grainP ? rng.bi() * 1.5 : 0;
        }
        nz = this.shaper.tick(src, coefs) * noiseEnv;
        if (this.noiseHold > 0) this.noiseHold--; else noiseEnv *= noiseCoef;
      }

      // --- transient
      let tr = 0;
      const t = this.t;
      if (trns > 0 && t < sr * 0.05) {
        const ts = t / sr;
        switch (trns) {
          case 1: tr = (t === 0 ? 1 : 0) + sinc(ts * 3000) * Math.exp(-ts * 1500); break; // CLIK
          case 2: tr = sinc(ts * 1500) * Math.exp(-ts * 350); break; // BLIP
          case 3: tr = rng.bi() * Math.exp(-ts * 300); break; // NOIS
          case 4: tr = sinc(4000 * ts - 60000 * ts * ts) * Math.exp(-ts * 150); break; // ZAP
          case 5: tr = sinc(120 * ts - 700 * ts * ts) * Math.exp(-ts * 90) * 1.3; break; // THUD
          case 6: tr = rng.bi() * sinc(ts * 2200) * Math.exp(-ts * 220) * 1.5; break; // SNAP
          case 7: tr = sinc(ts * 8000) * Math.exp(-ts * 1200); break; // TICK
        }
      }
      this.t = t + 1;

      buf[i] = softclip((y * body * blev + nz * nlev * 1.5 + tr * tlev) * 0.8);
    }
    this.pc = pc; this.pm = pm; this.fbPrev = fbPrev; this.sweep = sweep; this.body = body; this.modEnv = modEnv; this.noise = noiseEnv;
  }
}
