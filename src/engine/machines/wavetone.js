// WAVETONE — two band-limited wavetable oscillators + noise generator.
//   Per osc: tune, table, position (morphs 16 frames), phase distortion, level.
//   Modes: MIX, RING (osc2 ring-modulated by osc1), SYNC (osc2 hard-synced to
//   osc1; MAMT sweeps slave ratio), PM (osc1 phase-modulates osc2).
//   Noise: WHT, GRN (dust), TUNE (noise ring-modded at the note pitch), S&H;
//   AHD envelope; base/width filter.

import { PARAM_INDEX as I, valueToTime, valueToHz } from '../../core/params.js';
import { mtof, Rng, sinc } from '../dsp.js';
import { getTable, mipFor, lookup, FRAMES } from '../wavetables.js';
import { NoiseShaper } from '../filters.js';

const TUN1 = I['wav.tun1'], WAV1 = I['wav.wav1'], PD1 = I['wav.pd1'], LEV1 = I['wav.lev1'];
const TUN2 = I['wav.tun2'], WAV2 = I['wav.wav2'], PD2 = I['wav.pd2'], LEV2 = I['wav.lev2'];
const TBL1 = I['wav.tbl1'], TBL2 = I['wav.tbl2'], OFS1 = I['wav.ofs1'], OFS2 = I['wav.ofs2'];
const MODE = I['wav.mode'], MAMT = I['wav.mamt'], DRFT = I['wav.drft'], RSET = I['wav.rset'];
const NATK = I['wav.natk'], NHLD = I['wav.nhld'], NDEC = I['wav.ndec'], NLEV = I['wav.nlev'];
const NBAS = I['wav.nbas'], NWID = I['wav.nwid'], NTYP = I['wav.ntyp'], NCHR = I['wav.nchr'];

function pdWarp(ph, d) {
  return ph < d ? (ph * 0.5) / d : 0.5 + ((ph - d) * 0.5) / (1 - d);
}

export class Wavetone {
  constructor(sr, seed = 1) {
    this.sr = sr;
    this.rng = new Rng(seed * 104729 + 7);
    this.p1 = 0; this.p2 = 0;
    this.drift1 = 0; this.drift2 = 0;
    this.nStage = 0; this.nLev = 0; this.nCount = 0;
    this.sh = 0; this.shPhase = 0;
    this.shaper = new NoiseShaper(sr);
    this.coefs = new Float64Array(7);
  }
  noteOn(p, vel, legato) {
    if (!legato && p[RSET] > 0.5) { this.p1 = 0; this.p2 = 0; }
    if (!legato) { this.nStage = 1; this.nLev = 0; this.nCount = 0; }
  }
  render(p, buf, n, note) {
    const sr = this.sr, rng = this.rng;
    // drift: slow random walk per osc
    const dr = p[DRFT] / 127;
    if (dr > 0) {
      this.drift1 += (rng.bi() * 0.02 - this.drift1 * 0.002) * n / 32;
      this.drift2 += (rng.bi() * 0.02 - this.drift2 * 0.002) * n / 32;
    }
    const d1 = this.drift1 * dr * 0.3, d2 = this.drift2 * dr * 0.3;
    const mode = p[MODE] | 0;
    const mamt = p[MAMT] / 127;
    const inc1 = mtof(note + p[TUN1] + p[OFS1] / 64 + d1) / sr;
    let inc2 = mtof(note + p[TUN2] + p[OFS2] / 64 + d2) / sr;
    if (mode === 2) inc2 *= 1 + mamt * 4;
    const t1 = getTable(p[TBL1] | 0), t2 = getTable(p[TBL2] | 0);
    const m1 = mipFor(inc1 * (1 + p[PD1] / 64)), m2 = mipFor(inc2 * (1 + p[PD2] / 64));
    const pos1 = (p[WAV1] / 127) * (FRAMES - 1), pos2 = (p[WAV2] / 127) * (FRAMES - 1);
    const f1 = Math.min(FRAMES - 2, pos1 | 0), f2 = Math.min(FRAMES - 2, pos2 | 0);
    const x1 = pos1 - f1, x2 = pos2 - f2;
    const a1 = t1[f1][m1], b1 = t1[f1 + 1][m1], a2 = t2[f2][m2], b2 = t2[f2 + 1][m2];
    const pd1 = 0.5 - (p[PD1] / 127) * 0.47, pd2 = 0.5 - (p[PD2] / 127) * 0.47;
    const usePd1 = p[PD1] > 0.5, usePd2 = p[PD2] > 0.5;
    const l1 = p[LEV1] / 127, l2 = p[LEV2] / 127;

    // noise env (AHD) coefficients
    const nlev = p[NLEV] / 127;
    const atkInc = 1 / Math.max(1, valueToTime(p[NATK]) * sr);
    const holdN = p[NHLD] > 0 ? valueToTime(p[NHLD]) * sr : 0;
    const decC = Math.exp(-4.6 / (valueToTime(p[NDEC]) * sr));
    const ntyp = p[NTYP] | 0, nchr = p[NCHR] / 127;
    if (nlev > 0) {
      const nb = p[NBAS];
      this.shaper.coefs(valueToHz(nb), valueToHz(Math.min(127, nb + p[NWID])), this.coefs);
    }
    const shInc = (20 + nchr * nchr * 8000) / sr;
    const grainP = 0.0005 + nchr * nchr * 0.25;
    const noteInc = mtof(note) / sr;

    let ph1 = this.p1, ph2 = this.p2;
    for (let i = 0; i < n; i++) {
      const w1 = usePd1 ? pdWarp(ph1, pd1) : ph1;
      const o1 = lookup(a1, w1) * (1 - x1) + lookup(b1, w1) * x1;
      let q2 = ph2;
      if (mode === 3) { q2 += o1 * mamt * 0.8; q2 -= Math.floor(q2); }
      const w2 = usePd2 ? pdWarp(q2, pd2) : q2;
      let o2 = lookup(a2, w2) * (1 - x2) + lookup(b2, w2) * x2;
      if (mode === 1) o2 = o2 * (1 - mamt) + o1 * o2 * mamt * 1.4;
      let s = o1 * l1 + o2 * l2;

      if (nlev > 0 && this.nStage) {
        // envelope
        if (this.nStage === 1) { this.nLev += atkInc; if (this.nLev >= 1) { this.nLev = 1; this.nStage = 2; this.nCount = holdN; } }
        else if (this.nStage === 2) { if (--this.nCount <= 0) this.nStage = 3; }
        else { this.nLev *= decC; if (this.nLev < 1e-4) { this.nLev = 0; this.nStage = 0; } }
        let src;
        if (ntyp === 0) src = rng.bi();
        else if (ntyp === 1) src = rng.next() < grainP ? rng.bi() * 3 : 0;
        else if (ntyp === 2) { this.shPhase += noteInc; src = rng.bi() * (1 - nchr) + rng.bi() * sinc(this.shPhase) * nchr * 2; }
        else { this.shPhase += shInc; if (this.shPhase >= 1) { this.shPhase -= 1; this.sh = rng.bi(); } src = this.sh; }
        s += this.shaper.tick(src, this.coefs) * this.nLev * nlev;
      }
      buf[i] = s * 0.45;

      ph1 += inc1;
      if (ph1 >= 1) { ph1 -= ph1 | 0; if (mode === 2) ph2 = ph1 * (inc2 / inc1); }
      ph2 += inc2;
      if (ph2 >= 1) ph2 -= ph2 | 0;
    }
    if (this.shPhase > 1e6) this.shPhase -= Math.floor(this.shPhase);
    this.p1 = ph1; this.p2 = ph2;
  }
}
