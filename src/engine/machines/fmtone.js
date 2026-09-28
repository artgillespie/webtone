// FM TONE — 4 operators (C, A, B1, B2), 8 algorithms, X/Y carrier outputs.
//
// Operator levels: A LEV / B LEV scale both the modulation index of A/B ops
// and their level when tapped as a carrier. Each has its own envelope
// (delay, attack, decay to END level).
//
// Algorithms ("←" = is modulated by). X and Y are blended by MIX.
//   1: C←A          B1←B2        X=C  Y=B1      fb: A
//   2: C←A←B1←B2                 X=C  Y=A       fb: B2
//   3: C←A  C←B1←B2              X=C  Y=B1      fb: A
//   4: C←A  A←B1  A←B2           X=C  Y=A       fb: B1
//   5: C←B1 A←B1  B1←B2          X=C  Y=A       fb: B2
//   6: C←A←B1       B2           X=C  Y=B2      fb: B2
//   7: C←A          B1  B2       X=C  Y=B1+B2   fb: A
//   8: C  A         B1  B2       X=C+A Y=B1+B2  fb: B2

import { PARAM_INDEX as I, RATIOS } from '../../core/params.js';
import { sinc, mtof } from '../dsp.js';
import { OpEnv } from '../env.js';

export const ALGORITHMS = [
  { mods: [['C', 'A'], ['B1', 'B2']], X: ['C'], Y: ['B1'], fb: 'A' },
  { mods: [['C', 'A'], ['A', 'B1'], ['B1', 'B2']], X: ['C'], Y: ['A'], fb: 'B2' },
  { mods: [['C', 'A'], ['C', 'B1'], ['B1', 'B2']], X: ['C'], Y: ['B1'], fb: 'A' },
  { mods: [['C', 'A'], ['A', 'B1'], ['A', 'B2']], X: ['C'], Y: ['A'], fb: 'B1' },
  { mods: [['C', 'B1'], ['A', 'B1'], ['B1', 'B2']], X: ['C'], Y: ['A'], fb: 'B2' },
  { mods: [['C', 'A'], ['A', 'B1']], X: ['C'], Y: ['B2'], fb: 'B2' },
  { mods: [['C', 'A']], X: ['C'], Y: ['B1', 'B2'], fb: 'A' },
  { mods: [], X: ['C', 'A'], Y: ['B1', 'B2'], fb: 'B2' },
];

const ALGO = I['fmt.algo'], RATC = I['fmt.ratc'], RATA = I['fmt.rata'], RATB = I['fmt.ratb'], RATB2 = I['fmt.ratb2'];
const HARM = I['fmt.harm'], DTUN = I['fmt.dtun'], FDBK = I['fmt.fdbk'], MIX = I['fmt.mix'];
const AATK = I['fmt.aatk'], ADEC = I['fmt.adec'], AEND = I['fmt.aend'], ALEV = I['fmt.alev'];
const BATK = I['fmt.batk'], BDEC = I['fmt.bdec'], BEND = I['fmt.bend'], BLEV = I['fmt.blev'];
const AOFS = I['fmt.aofs'], BOFS = I['fmt.bofs'], ADLY = I['fmt.adly'], BDLY = I['fmt.bdly'];
const ARST = I['fmt.arst'], BRST = I['fmt.brst'], VMOD = I['fmt.vmod'];

const MAX_INDEX = 1.3; // cycles of phase deviation at full level

export class FmTone {
  constructor(sr) {
    this.sr = sr;
    this.pc = 0; this.pa = 0; this.pb1 = 0; this.pb2 = 0;
    this.fb1 = 0; this.fb2 = 0;
    this.envA = new OpEnv(sr); this.envB = new OpEnv(sr);
    this.lastA = 0; this.lastB = 0;
  }
  noteOn(p, vel, legato) {
    this.envA.set(p[AATK], p[ADEC], p[AEND], p[ADLY]);
    this.envB.set(p[BATK], p[BDEC], p[BEND], p[BDLY]);
    if (!legato) {
      this.envA.trigger(p[ARST] > 0.5);
      this.envB.trigger(p[BRST] > 0.5);
      this.pc = this.pa = this.pb1 = this.pb2 = 0;
      this.fb1 = this.fb2 = 0;
    }
    this.lastA = this.envA.level; this.lastB = this.envB.level;
  }
  render(p, buf, n, note, vel) {
    const sr = this.sr;
    const f = mtof(note);
    const dt = (p[DTUN] / 127) * 0.021;
    const incC = (f * RATIOS[p[RATC] | 0]) / sr;
    const incA = (f * Math.max(0.01, RATIOS[p[RATA] | 0] + (p[AOFS] / 64) * 0.5) * (1 + dt)) / sr;
    const incB1 = (f * Math.max(0.01, RATIOS[p[RATB] | 0] + (p[BOFS] / 64) * 0.5) * (1 - dt)) / sr;
    const incB2 = (f * Math.max(0.01, RATIOS[p[RATB2] | 0] + (p[BOFS] / 64) * 0.5) * (1 - dt * 0.5)) / sr;

    this.envA.set(p[AATK], p[ADEC], p[AEND], p[ADLY]);
    this.envB.set(p[BATK], p[BDEC], p[BEND], p[BDLY]);
    const eA0 = this.lastA, eA1 = this.envA.skip(n);
    const eB0 = this.lastB, eB1 = this.envB.skip(n);
    this.lastA = eA1; this.lastB = eB1;

    const vm = p[VMOD] / 64;
    const velK = Math.max(0, 1 + vm * ((vel / 127) * 2 - 1));
    const la = (p[ALEV] / 127) * velK, lb = (p[BLEV] / 127) * velK;
    let aN = eA0 * la, bN = eB0 * lb;
    const daN = (eA1 * la - aN) / n, dbN = (eB1 * lb - bN) / n;

    const fb = (p[FDBK] / 127) * 0.9;
    const h = p[HARM] / 64;
    const hC = h < 0 ? -h * 0.35 : 0, hM = h > 0 ? h * 0.35 : 0;
    const m = (p[MIX] + 64) / 127;
    const gx = 1 - m, gy = m;
    const algo = (p[ALGO] | 0);

    let pc = this.pc, pa = this.pa, pb1 = this.pb1, pb2 = this.pb2, fb1 = this.fb1, fb2 = this.fb2;
    for (let i = 0; i < n; i++) {
      aN += daN; bN += dbN;
      const ia = aN * MAX_INDEX, ib = bN * MAX_INDEX;
      const fbv = (fb1 + fb2) * 0.5 * fb;
      let c, a, b1, b2, x, y;
      switch (algo) {
        case 0:
          a = sinc(pa + fbv + hM * sinc(pa));
          c = sinc(pc + a * ia + hC * sinc(pc));
          b2 = sinc(pb2 + hM * sinc(pb2));
          b1 = sinc(pb1 + b2 * ib + hM * sinc(pb1));
          fb2 = fb1; fb1 = a;
          x = c; y = b1 * bN;
          break;
        case 1:
          b2 = sinc(pb2 + fbv + hM * sinc(pb2));
          b1 = sinc(pb1 + b2 * ib + hM * sinc(pb1));
          a = sinc(pa + b1 * ib + hM * sinc(pa));
          c = sinc(pc + a * ia + hC * sinc(pc));
          fb2 = fb1; fb1 = b2;
          x = c; y = a * aN;
          break;
        case 2:
          a = sinc(pa + fbv + hM * sinc(pa));
          b2 = sinc(pb2 + hM * sinc(pb2));
          b1 = sinc(pb1 + b2 * ib + hM * sinc(pb1));
          c = sinc(pc + a * ia + b1 * ib + hC * sinc(pc));
          fb2 = fb1; fb1 = a;
          x = c; y = b1 * bN;
          break;
        case 3:
          b1 = sinc(pb1 + fbv + hM * sinc(pb1));
          b2 = sinc(pb2 + hM * sinc(pb2));
          a = sinc(pa + (b1 + b2) * ib * 0.7 + hM * sinc(pa));
          c = sinc(pc + a * ia + hC * sinc(pc));
          fb2 = fb1; fb1 = b1;
          x = c; y = a * aN;
          break;
        case 4:
          b2 = sinc(pb2 + fbv + hM * sinc(pb2));
          b1 = sinc(pb1 + b2 * ib + hM * sinc(pb1));
          c = sinc(pc + b1 * ib + hC * sinc(pc));
          a = sinc(pa + b1 * ib + hM * sinc(pa));
          fb2 = fb1; fb1 = b2;
          x = c; y = a * aN;
          break;
        case 5:
          b1 = sinc(pb1 + hM * sinc(pb1));
          a = sinc(pa + b1 * ib + hM * sinc(pa));
          c = sinc(pc + a * ia + hC * sinc(pc));
          b2 = sinc(pb2 + fbv + hC * sinc(pb2));
          fb2 = fb1; fb1 = b2;
          x = c; y = b2 * bN;
          break;
        case 6:
          a = sinc(pa + fbv + hM * sinc(pa));
          c = sinc(pc + a * ia + hC * sinc(pc));
          b1 = sinc(pb1 + hC * sinc(pb1));
          b2 = sinc(pb2 + hC * sinc(pb2));
          fb2 = fb1; fb1 = a;
          x = c; y = (b1 + b2) * 0.5 * bN;
          break;
        default:
          c = sinc(pc + hC * sinc(pc));
          a = sinc(pa + hC * sinc(pa));
          b1 = sinc(pb1 + hC * sinc(pb1));
          b2 = sinc(pb2 + fbv + hC * sinc(pb2));
          fb2 = fb1; fb1 = b2;
          x = (c + a * aN) * 0.6; y = (b1 + b2) * 0.5 * bN;
          break;
      }
      buf[i] = (x * gx + y * gy) * 0.5;
      pc += incC; pa += incA; pb1 += incB1; pb2 += incB2;
      if (pc >= 1) pc -= pc | 0; if (pa >= 1) pa -= pa | 0; if (pb1 >= 1) pb1 -= pb1 | 0; if (pb2 >= 1) pb2 -= pb2 | 0;
    }
    this.pc = pc; this.pa = pa; this.pb1 = pb1; this.pb2 = pb2; this.fb1 = fb1; this.fb2 = fb2;
  }
}
