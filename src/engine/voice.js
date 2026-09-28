// A synth voice: machine -> (pre FX) -> filter -> base-width -> (post FX)
// -> amp envelope -> pan -> dry bus + FX sends.
//
// Effective params each control tick:  eff[i] = clamp((locked ? lock[i] : track[i]) + mod[i])
// where `mod` are the track's LFO offsets. Locks come from the trig that
// started the voice (and trigless lock trigs while it sounds).

import { PARAM_INDEX as I, SOUND_PARAMS, NUM_PARAMS, valueToTime, valueToHz, valueToGain, toNum } from '../core/params.js';
import { clamp, softclip } from './dsp.js';
import { Env } from './env.js';
import { VoiceFilter } from './filters.js';
import { FmTone } from './machines/fmtone.js';
import { FmDrum } from './machines/fmdrum.js';
import { Wavetone } from './machines/wavetone.js';
import { Swarmer } from './machines/swarmer.js';

export const MACHINE_CLASSES = { fmtone: FmTone, fmdrum: FmDrum, wavetone: Wavetone, swarmer: Swarmer };

const PMIN = new Float32Array(NUM_PARAMS), PMAX = new Float32Array(NUM_PARAMS);
SOUND_PARAMS.forEach((p, i) => {
  PMIN[i] = p.type === 'dest' ? -1 : p.min;
  PMAX[i] = p.type === 'dest' ? 9999 : p.max;
});

const PORT = I['trig.port'], VAMP = I['trig.vamp'], VFLT = I['trig.vflt'], PTCH = I['trig.ptch'];
const F_ATK = I['flt.atk'], F_DEC = I['flt.dec'], F_SUS = I['flt.sus'], F_REL = I['flt.rel'];
const F_FRQ = I['flt.frq'], F_RES = I['flt.res'], F_TYP = I['flt.typ'], F_ENV = I['flt.env'];
const F_BASE = I['flt.base'], F_WDTH = I['flt.wdth'], F_EDLY = I['flt.edly'], F_KTRK = I['flt.ktrk'], F_RSET = I['flt.rset'], F_MACH = I['flt.mach'];
const A_ATK = I['amp.atk'], A_HLD = I['amp.hld'], A_DEC = I['amp.dec'], A_SUS = I['amp.sus'], A_REL = I['amp.rel'];
const A_MODE = I['amp.mode'], A_PAN = I['amp.pan'], A_VOL = I['amp.vol'];
const X_BR = I['fx.br'], X_SRR = I['fx.srr'], X_SRRT = I['fx.srrt'], X_OD = I['fx.od'], X_ODRT = I['fx.odrt'];
const X_DEL = I['fx.del'], X_REV = I['fx.rev'], X_CHO = I['fx.cho'];

export const CTRL = 32; // max samples per control tick
const VOICE_HEADROOM = 0.5; // -6dB per voice so 16 voices + FX fit under the master limiter

export class Voice {
  constructor(sr, id) {
    this.sr = sr;
    this.id = id;
    this.machines = {};
    this.mach = null;
    this.machineId = null;
    this.eff = new Float32Array(NUM_PARAMS);
    this.lockMask = new Uint8Array(NUM_PARAMS);
    this.lockVal = new Float32Array(NUM_PARAMS);
    this.lockCount = 0;
    this.amp = new Env(sr);
    this.fenv = new Env(sr);
    this.filter = new VoiceFilter(sr);
    this.buf = new Float32Array(CTRL);
    this.active = false;
    this.gate = false;
    this.track = -1;
    this.noteId = -1;
    this.live = false;
    this.note = 60; this.target = 60; this.vel = 100;
    this.age = 0;
    this.lastFe = 0;
    this.gL = 0; this.gR = 0;
    this.srrCount = 0; this.srrHeld = 0; this.srrCount2 = 0; this.srrHeld2 = 0;
    this.peak = 0;
  }

  machine(id) {
    let m = this.machines[id];
    if (!m) m = this.machines[id] = new MACHINE_CLASSES[id](this.sr, this.id + 1);
    return m;
  }

  /** Apply a trig's JSON locks ({paramId: value}); merge=false clears old locks first. */
  setLocks(locks, merge) {
    if (!merge && this.lockCount) { this.lockMask.fill(0); this.lockCount = 0; }
    if (!locks) return;
    for (const k in locks) {
      const idx = I[k];
      if (idx === undefined) continue;
      this.lockMask[idx] = 1;
      this.lockVal[idx] = toNum(SOUND_PARAMS[idx], locks[k]);
      this.lockCount++;
    }
  }

  computeEff(P, M) {
    const e = this.eff, mask = this.lockMask, lv = this.lockVal;
    if (this.lockCount) {
      for (let i = 0; i < NUM_PARAMS; i++) {
        const v = (mask[i] ? lv[i] : P[i]) + M[i];
        e[i] = v < PMIN[i] ? PMIN[i] : v > PMAX[i] ? PMAX[i] : v;
      }
    } else {
      for (let i = 0; i < NUM_PARAMS; i++) {
        const v = P[i] + M[i];
        e[i] = v < PMIN[i] ? PMIN[i] : v > PMAX[i] ? PMAX[i] : v;
      }
    }
    return e;
  }

  /**
   * Start (or retrigger) the voice.
   * @param legato  keep envelopes running and glide (mono legato / slide)
   */
  start(track, machineId, note, vel, fromNote, P, M, legato) {
    const reuse = this.active && this.track === track && this.machineId === machineId;
    if (!reuse) this.filter.reset();
    this.track = track;
    this.machineId = machineId;
    this.mach = this.machine(machineId);
    this.target = note;
    this.note = fromNote != null ? fromNote : note;
    this.vel = vel;
    this.gate = true;
    const e = this.computeEff(P, M);
    this.mach.noteOn(e, vel, legato && reuse);
    this.amp.set(e[A_ATK], e[A_HLD], e[A_DEC], e[A_SUS], e[A_REL], e[A_MODE] >= 0.5);
    this.fenv.set(e[F_ATK], 0, e[F_DEC], e[F_SUS], e[F_REL], false, e[F_EDLY]);
    if (!(legato && reuse)) {
      this.amp.trigger(!reuse);
      this.fenv.trigger(!reuse || e[F_RSET] >= 0.5);
      if (!reuse) { this.lastFe = 0; this.gL = this.gR = 0; this.filter.prevG = -1; }
    }
    this.active = true;
  }

  release() {
    this.gate = false;
    this.amp.release();
    this.fenv.release();
  }

  kill() { this.gate = false; this.amp.kill(); this.fenv.release(); }

  /**
   * Render n (<= CTRL) samples, mixing into the output buses at offset `off`.
   * out = { L, R, del, rev, cho, sc, scTrack }
   */
  render(P, M, n, out, off) {
    const sr = this.sr;
    const e = this.computeEff(P, M);
    // glide
    if (e[PORT] > 0.5 && this.note !== this.target) {
      const tc = valueToTime(e[PORT]) * 0.4;
      const c = Math.exp(-n / (tc * sr));
      this.note = this.target + (this.note - this.target) * c;
      if (Math.abs(this.note - this.target) < 0.001) this.note = this.target;
    } else this.note = this.target;
    const note = this.note + e[PTCH];
    const buf = this.buf;
    this.mach.render(e, buf, n, note, this.vel);

    // --- voice FX (pre)
    const br = e[X_BR], srr = e[X_SRR], od = e[X_OD];
    if (br > 0.5) {
      const steps = Math.pow(2, 15 - (br / 127) * 13.5);
      for (let i = 0; i < n; i++) buf[i] = Math.round(buf[i] * steps) / steps;
    }
    const srrPre = e[X_SRRT] < 0.5, odPre = e[X_ODRT] < 0.5;
    if (srr > 0.5 && srrPre) this.srrProc(buf, n, srr);
    if (od > 0.5 && odPre) this.odProc(buf, n, od);

    // --- filter
    this.fenv.set(e[F_ATK], 0, e[F_DEC], e[F_SUS], e[F_REL], false, e[F_EDLY]);
    const fe = this.fenv.skip(n);
    const depth = e[F_ENV] + e[VFLT] * (this.vel / 127);
    const cut = e[F_FRQ] + fe * depth * 2 + (e[F_KTRK] / 127) * (note - 60) * 1.058;
    const hz = valueToHz(clamp(cut, 0, 132));
    const mach = e[F_MACH] | 0;
    const skipMain = mach === 0 && cut >= 126.5 && e[F_TYP] < 0.5 && e[F_RES] < 0.5;
    if (!skipMain) this.filter.process(buf, n, mach, hz, e[F_RES], e[F_TYP]);
    else this.filter.prevG = -1;
    const base = e[F_BASE];
    this.filter.baseWidth(buf, n, valueToHz(base), valueToHz(Math.min(127, base + e[F_WDTH])));

    if (srr > 0.5 && !srrPre) this.srrProc(buf, n, srr);
    if (od > 0.5 && !odPre) this.odProc(buf, n, od);

    // --- amp
    this.amp.set(e[A_ATK], e[A_HLD], e[A_DEC], e[A_SUS], e[A_REL], e[A_MODE] >= 0.5);
    const vamp = e[VAMP] / 127;
    const g = VOICE_HEADROOM * valueToGain(e[A_VOL]) * ((1 - vamp) + vamp * (this.vel / 127));
    const pan = (e[A_PAN] + 64) / 128;
    const tL = Math.cos(pan * Math.PI * 0.5) * g * 1.4142, tR = Math.sin(pan * Math.PI * 0.5) * g * 1.4142;
    let gL = this.gL, gR = this.gR;
    const dL = (tL - gL) / n, dR = (tR - gR) / n;
    const sDel = e[X_DEL] / 127, sRev = e[X_REV] / 127, sCho = e[X_CHO] / 127;
    const L = out.L, R = out.R, D = out.del, V = out.rev, C = out.cho;
    const sc = out.scTrack === this.track ? out.sc : null;
    const amp = this.amp;
    let peak = this.peak;
    for (let i = 0; i < n; i++) {
      gL += dL; gR += dR;
      const s = buf[i] * amp.tick();
      const j = off + i;
      const l = s * gL, r = s * gR;
      L[j] += l; R[j] += r;
      const m = (l + r) * 0.5;
      if (sDel) D[j] += m * sDel;
      if (sRev) V[j] += m * sRev;
      if (sCho) C[j] += m * sCho;
      if (sc) sc[j] += m;
      const a = l > 0 ? l : -l;
      if (a > peak) peak = a;
    }
    this.peak = peak;
    this.gL = gL; this.gR = gR;
    if (this.mach.silent && this.mach.silent()) amp.stage = 0;
    if (!amp.active) { this.active = false; this.noteId = -1; this.live = false; }
  }

  srrProc(buf, n, srr) {
    const hold = 1 + Math.pow(srr / 127, 2) * 48;
    let c = this.srrCount, h = this.srrHeld;
    for (let i = 0; i < n; i++) {
      c += 1;
      if (c >= hold) { c -= hold; h = buf[i]; }
      buf[i] = h;
    }
    this.srrCount = c; this.srrHeld = h;
  }

  odProc(buf, n, od) {
    const x = od / 127;
    const drive = 1 + x * x * 30;
    const comp = 1 / (1 + x * 1.2);
    for (let i = 0; i < n; i++) buf[i] = softclip(buf[i] * drive) * comp;
  }
}
