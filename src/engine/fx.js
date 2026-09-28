// Send effects (chorus, delay, reverb), bus compressor and master stage.
// Each processes whole blocks. Parameters are read from a kit FX Float32Array
// indexed by FX_INDEX (see core/params.js FX_PARAMS).

import { FX_INDEX as F, valueToHz } from '../core/params.js';
import { softclip, lpCoef, TAU } from './dsp.js';

// ---------------------------------------------------------------------------
export class Chorus {
  constructor(sr) {
    this.sr = sr;
    this.size = 4096;
    this.buf = new Float32Array(this.size);
    this.w = 0; this.ph = 0; this.hp = 0;
  }
  process(inp, L, R, toDel, toRev, n, fx) {
    const sr = this.sr, buf = this.buf, mask = this.size - 1;
    const depth = (fx[F['cho.dep']] / 127) * 0.006 * sr;
    const base = 0.008 * sr;
    const rate = 0.05 + Math.pow(fx[F['cho.spd']] / 127, 2) * 6;
    const hpc = lpCoef(valueToHz(fx[F['cho.hpf']]), sr);
    const wid = fx[F['cho.wid']] / 127;
    const vol = (fx[F['cho.vol']] / 127) * 1.2;
    const sd = fx[F['cho.del']] / 127, sv = fx[F['cho.rev']] / 127;
    const inc = rate / sr;
    let w = this.w, ph = this.ph, hp = this.hp;
    for (let i = 0; i < n; i++) {
      hp += (inp[i] - hp) * hpc;
      buf[w & mask] = inp[i] - hp;
      const m1 = base + depth * (0.5 + 0.5 * Math.sin(ph * TAU));
      const m2 = base + depth * (0.5 + 0.5 * Math.sin((ph + 0.25) * TAU));
      const a = tap(buf, w - m1, mask), b = tap(buf, w - m2, mask);
      const mid = (a + b) * 0.5;
      const l = mid + (a - mid) * wid, r = mid + (b - mid) * wid;
      L[i] += l * vol; R[i] += r * vol;
      toDel[i] += mid * sd; toRev[i] += mid * sv;
      w++; ph += inc; if (ph >= 1) ph -= 1;
    }
    this.w = w & mask; this.ph = ph; this.hp = hp;
  }
}

function tap(buf, pos, mask) {
  const i = Math.floor(pos);
  const f = pos - i;
  const a = buf[i & mask];
  return a + (buf[(i + 1) & mask] - a) * f;
}

// ---------------------------------------------------------------------------
export class Delay {
  constructor(sr) {
    this.sr = sr;
    this.size = 1 << Math.ceil(Math.log2(sr * 4.5));
    this.bl = new Float32Array(this.size);
    this.br = new Float32Array(this.size);
    this.w = 0; this.time = -1;
    this.lpL = 0; this.lpR = 0; this.hpL = 0; this.hpR = 0;
  }
  process(inp, L, R, toRev, n, fx, stepSec) {
    const sr = this.sr, mask = this.size - 1, bl = this.bl, br = this.br;
    const target = Math.min(this.size - 4, (fx[F['del.time']] / 8) * stepSec * sr);
    if (this.time < 0) this.time = target;
    const fb = (fx[F['del.fb']] / 127) * 1.05;
    const pp = fx[F['del.pp']] >= 0.5;
    const wid = fx[F['del.wid']] / 127;
    const lpc = lpCoef(valueToHz(fx[F['del.lpf']]), sr);
    const hpc = lpCoef(valueToHz(fx[F['del.hpf']]), sr);
    const vol = fx[F['del.vol']] / 127;
    const sv = fx[F['del.rev']] / 127;
    let w = this.w, t = this.time, lpL = this.lpL, lpR = this.lpR, hpL = this.hpL, hpR = this.hpR;
    for (let i = 0; i < n; i++) {
      t += (target - t) * 0.0004; // tape-style glide on time changes
      const dl = tap(bl, w - t, mask), dr = tap(br, w - t, mask);
      // feedback filtering
      lpL += (dl - lpL) * lpc; lpR += (dr - lpR) * lpc;
      hpL += (lpL - hpL) * hpc; hpR += (lpR - hpR) * hpc;
      const fl = (lpL - hpL) * fb, fr = (lpR - hpR) * fb;
      const x = inp[i];
      if (pp) { bl[w & mask] = softclip(x + fr); br[w & mask] = softclip(fl); }
      else { bl[w & mask] = softclip(x + fl); br[w & mask] = softclip(x + fr); }
      const mid = (dl + dr) * 0.5;
      const l = mid + (dl - mid) * wid, r = mid + (dr - mid) * wid;
      L[i] += l * vol; R[i] += r * vol;
      toRev[i] += mid * sv;
      w++;
    }
    this.w = w & mask; this.time = t; this.lpL = lpL; this.lpR = lpR; this.hpL = hpL; this.hpR = hpR;
  }
}

// ---------------------------------------------------------------------------
// 8-line feedback delay network with Hadamard mixing, input diffusion,
// per-line shelving damping and pre-delay.
const FDN_LENS = [1117, 1277, 1429, 1601, 1789, 1951, 2111, 2297];
const AP_LENS = [142, 107, 379, 277];

export class Reverb {
  constructor(sr) {
    this.sr = sr;
    const k = sr / 48000;
    this.lens = FDN_LENS.map((l) => Math.round(l * k * 1.6));
    this.lines = this.lens.map((l) => new Float32Array(l));
    this.idx = new Int32Array(8);
    this.damp = new Float64Array(8);
    this.gains = new Float64Array(8);
    this.aps = AP_LENS.map((l) => ({ buf: new Float32Array(Math.round(l * k)), i: 0 }));
    this.pre = new Float32Array(1 << Math.ceil(Math.log2(sr * 0.6)));
    this.pw = 0;
    this.v = new Float64Array(8);
    this.oL = 0; this.oR = 0; this.hL = 0; this.hR = 0;
    this.lastDec = -1;
    this.modPh = 0;
  }
  process(inp, L, R, n, fx) {
    const sr = this.sr;
    const dec = fx[F['rev.dec']];
    const rt = 0.25 * Math.pow(2, (dec / 127) * 6.5); // 0.25s .. ~23s
    if (dec !== this.lastDec) {
      this.lastDec = dec;
      for (let j = 0; j < 8; j++) this.gains[j] = Math.pow(10, (-3 * this.lens[j]) / (rt * sr));
    }
    const preN = Math.min(this.pre.length - 1, Math.round((fx[F['rev.pre']] / 127) * 0.5 * sr));
    const sc = lpCoef(valueToHz(fx[F['rev.sfrq']]), sr);
    const sg = fx[F['rev.sgn']] / 127;
    const lpc = lpCoef(valueToHz(fx[F['rev.lpf']]), sr);
    const hpc = lpCoef(valueToHz(fx[F['rev.hpf']]), sr);
    const vol = (fx[F['rev.vol']] / 127) * 0.9;
    const pre = this.pre, pmask = pre.length - 1;
    const lines = this.lines, lens = this.lens, idx = this.idx, damp = this.damp, gains = this.gains, v = this.v;
    const aps = this.aps;
    let pw = this.pw, oL = this.oL, oR = this.oR, hL = this.hL, hR = this.hR;
    for (let i = 0; i < n; i++) {
      pre[pw & pmask] = inp[i];
      let x = pre[(pw - preN) & pmask];
      pw++;
      // diffusion
      for (let a = 0; a < 4; a++) {
        const ap = aps[a];
        const d = ap.buf[ap.i];
        const y = -0.6 * x + d;
        ap.buf[ap.i] = x + 0.6 * y;
        ap.i = ap.i + 1 >= ap.buf.length ? 0 : ap.i + 1;
        x = y;
      }
      // read lines + damping (low shelf keeps lows, scales highs by sg)
      for (let j = 0; j < 8; j++) {
        const y = lines[j][idx[j]];
        damp[j] += (y - damp[j]) * sc;
        v[j] = (damp[j] + (y - damp[j]) * sg) * gains[j];
      }
      // Hadamard 8 (unnormalised butterflies, scale 1/sqrt(8))
      let a0 = v[0] + v[1], a1 = v[0] - v[1], a2 = v[2] + v[3], a3 = v[2] - v[3];
      let a4 = v[4] + v[5], a5 = v[4] - v[5], a6 = v[6] + v[7], a7 = v[6] - v[7];
      let b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3;
      let b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
      const s = 0.35355339;
      const m0 = (b0 + b4) * s, m1 = (b1 + b5) * s, m2 = (b2 + b6) * s, m3 = (b3 + b7) * s;
      const m4 = (b0 - b4) * s, m5 = (b1 - b5) * s, m6 = (b2 - b6) * s, m7 = (b3 - b7) * s;
      const outL = v[0] + v[2] + v[4] + v[6];
      const outR = v[1] + v[3] + v[5] + v[7];
      const xin = x * 0.5;
      lines[0][idx[0]] = m0 + xin; lines[1][idx[1]] = m1 - xin; lines[2][idx[2]] = m2 + xin; lines[3][idx[3]] = m3 - xin;
      lines[4][idx[4]] = m4 + xin; lines[5][idx[5]] = m5 - xin; lines[6][idx[6]] = m6 + xin; lines[7][idx[7]] = m7 - xin;
      for (let j = 0; j < 8; j++) { if (++idx[j] >= lens[j]) idx[j] = 0; }
      // output filtering
      oL += (outL - oL) * lpc; oR += (outR - oR) * lpc;
      hL += (oL - hL) * hpc; hR += (oR - hR) * hpc;
      L[i] += (oL - hL) * vol * 0.5; R[i] += (oR - hR) * vol * 0.5;
    }
    this.pw = pw & pmask; this.oL = oL; this.oR = oR; this.hL = hL; this.hR = hR;
  }
}

// ---------------------------------------------------------------------------
const RATIO_VALUES = [2, 4, 8, 20];

export class Compressor {
  constructor(sr) { this.sr = sr; this.env = 0; this.gr = 0; }
  /** In-place on L/R. `side` is an optional mono sidechain buffer. */
  process(L, R, side, n, fx) {
    const sr = this.sr;
    const thrDb = -48 + (fx[F['cmp.thr']] / 127) * 48;
    const ratio = RATIO_VALUES[fx[F['cmp.rat']] | 0];
    const atk = Math.exp(-1 / ((0.0001 + Math.pow(fx[F['cmp.atk']] / 127, 2) * 0.1) * sr));
    const rel = Math.exp(-1 / ((0.01 + Math.pow(fx[F['cmp.rel']] / 127, 2) * 2) * sr));
    const makeup = Math.pow(10, ((fx[F['cmp.mup']] / 127) * 24) / 20);
    const mix = fx[F['cmp.mix']] / 127;
    const slope = 1 - 1 / ratio;
    let env = this.env, grMax = 0;
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i];
      const det = side ? Math.abs(side[i]) : Math.max(Math.abs(l), Math.abs(r));
      env = det > env ? det + (env - det) * atk : det + (env - det) * rel;
      const db = 20 * Math.log10(env + 1e-9);
      const over = db - thrDb;
      const grDb = over > 0 ? over * slope : 0;
      if (grDb > grMax) grMax = grDb;
      const g = Math.pow(10, -grDb / 20) * makeup;
      const w = mix * g + (1 - mix);
      L[i] = l * w; R[i] = r * w;
    }
    this.env = env;
    this.gr = grMax;
  }
}

/** Master: volume, optional overdrive, then a transparent-below-0.8 soft limiter. */
export function masterStage(L, R, n, fx) {
  const vol = Math.pow(fx[F['mst.vol']] / 100, 2);
  const od = fx[F['mst.od']] / 127;
  const drive = 1 + od * od * 12;
  const comp = 1 / (1 + od * 0.8);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let l = L[i] * vol, r = R[i] * vol;
    if (od > 0) { l = softclip(l * drive) * comp; r = softclip(r * drive) * comp; }
    l = limit(l); r = limit(r);
    L[i] = l; R[i] = r;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
  }
  return peak;
}

function limit(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.8) return x;
  const y = 0.8 + 0.2 * softclip((a - 0.8) / 0.2);
  return x < 0 ? -y : y;
}
