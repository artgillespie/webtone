// Engine — the complete instrument as a pure JS object.
//
// Runs identically inside the AudioWorklet (src/engine/worklet.js) and in
// Node (tests, tools/render.mjs). No DOM, no WebAudio, no timers: time only
// advances when process() is called, so rendering is fully deterministic for
// a given project + seed + command sequence.
//
//   const e = new Engine({ sampleRate: 48000, project });
//   e.dispatch({ type: 'toggleTrig', track: 0, step: 0 });
//   e.play();
//   e.process(left, right, 128);
//
// Sequencer: a 96-PPQN pulse clock (24 pulses per 1/16 step at 1X). Pulses
// are processed at the start of each block for the block's time span; trigs
// become time-stamped events (with swing, micro timing, retrigs) in a sorted
// queue that is consumed sample-accurately while rendering.

import {
  NUM_TRACKS, NUM_VOICES, NUM_PARAMS, SOUND_PARAMS, FX_PARAMS, PARAM_INDEX as I, LENGTHS, SPEED_PULSES,
  RETRIG_RATES, LFO_MULTS, ARP_SPEEDS, toNum,
} from '../core/params.js';
import { applyCommand } from '../core/commands.js';
import { newProject, migrateProject, clone, parsePatternId } from '../core/project.js';
import { Rng } from './dsp.js';
import { Voice, CTRL } from './voice.js';
import { Lfo } from './lfo.js';
import { Chorus, Delay, Reverb, Compressor, masterStage } from './fx.js';
import { getTable } from './wavetables.js';
import { WAVETABLES } from '../core/params.js';

const NOTE = I['trig.note'], VEL = I['trig.vel'], LEN = I['trig.len'], PORT = I['trig.port'], LEG = I['trig.leg'], VOIC = I['trig.voic'];
const ARP_MODE = I['arp.mode'], ARP_SPD = I['arp.spd'], ARP_RNG = I['arp.rng'], ARP_NLEN = I['arp.nlen'];
const LFO_IDS = [1, 2, 3].map((n) => ['spd', 'mul', 'fade', 'dest', 'wave', 'sph', 'mode', 'dep'].map((k) => I[`lfo${n}.${k}`]));
const FX_SCS = FX_PARAMS.findIndex((p) => p.id === 'cmp.scs');
const PRANGE = new Float32Array(NUM_PARAMS);
SOUND_PARAMS.forEach((p, i) => { PRANGE[i] = p.type === 'num' ? p.max - p.min : 0; });

// Telemetry layout (Float32Array). Shared with the UI via SharedArrayBuffer when available.
export const TEL = {
  PLAYING: 0, PATTERN: 1, MASTER_STEP: 2, CPU: 3, VOICES: 4, PATTERN_LOOP: 5, FILL: 6, SONG_ROW: 7,
  TEMPO: 8, COMP_GR: 9, MASTER_PEAK: 10, SONG_MODE: 11, TIME: 12,
  STEP: 16, PEAK: 32, STEP_FRAC: 48, SIZE: 64,
};

const EV_NOTE = 1, EV_OFF = 2, EV_LOCK = 3, EV_ARP = 4;

export class Engine {
  constructor({ sampleRate = 48000, seed = 1, project = null, prewarm = true } = {}) {
    this.sr = sampleRate;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.project = project ? migrateProject(clone(project)) : newProject();
    this.voices = Array.from({ length: NUM_VOICES }, (_, i) => new Voice(sampleRate, i));
    this.trackP = Array.from({ length: NUM_TRACKS }, () => new Float32Array(NUM_PARAMS));
    this.trackM = Array.from({ length: NUM_TRACKS }, () => new Float32Array(NUM_PARAMS));
    this.trackMachine = Array(NUM_TRACKS).fill('fmtone');
    this.lfos = Array.from({ length: NUM_TRACKS }, (_, t) => [0, 1, 2].map((k) => new Lfo(seed * 31 + t * 3 + k + 1)));
    this.lfoDest = Array.from({ length: NUM_TRACKS }, () => new Int32Array([-1, -1, -1]));
    this.lfoLocks = Array(NUM_TRACKS).fill(null);
    this.fx = new Float32Array(FX_PARAMS.length);
    this.chorus = new Chorus(sampleRate);
    this.delay = new Delay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.comp = new Compressor(sampleRate);
    this._alloc(512);

    // transport / sequencer
    this.time = 0; // absolute sample clock
    this.playing = false;
    this.playId = this.project.current;
    this.ppos = 0;
    this.nextPulse = 0;
    this.patternLoop = 0;
    this.loops = new Int32Array(NUM_TRACKS);
    this.curStep = new Int32Array(NUM_TRACKS).fill(-1);
    this.stepStart = new Float64Array(NUM_TRACKS);
    this.stepLen = new Float64Array(NUM_TRACKS);
    this.lastCond = new Uint8Array(NUM_TRACKS);
    this.lastNote = new Float32Array(NUM_TRACKS).fill(60);
    this.fill = false;
    this.songMode = false;
    this.songRow = 0;
    this.songRepeat = 0;

    this.events = [];
    this.pool = [];
    this.noteCounter = 0;
    this.ageCounter = 0;
    this.liveNotes = new Map(); // "t:note" -> noteId
    this.arp = Array.from({ length: NUM_TRACKS }, () => ({ notes: [], idx: 0, running: false, order: 0, shuffle: [] }));

    this.telemetry = new Float32Array(TEL.SIZE);
    this.trackPeak = new Float32Array(NUM_TRACKS);
    this.outbox = [];
    this.logNotes = false;
    this.noteLog = [];

    if (prewarm) for (let i = 0; i < WAVETABLES.length; i++) getTable(i);
    this._loadAll();
  }

  // ------------------------------------------------------------------ state
  /** Apply a reducer command (same as the UI store). Returns the change descriptor. */
  dispatch(cmd) {
    const ch = applyCommand(this.project, cmd);
    const playPat = ch.pattern === this.playId;
    switch (ch.scope) {
      case 'param': if (playPat) this._loadParam(ch.track, ch.id); break;
      case 'sound': if (playPat) this._loadTrack(ch.track); break;
      case 'fx': if (playPat) this._loadFx(); break;
      case 'pattern': if (playPat) this._loadAll(); break;
      case 'current': if (!this.playing) { this.playId = this.project.current; this._loadAll(); } break;
      case 'all':
        if (!this.project.patterns[this.playId] || !this.playing) this.playId = this.project.current;
        this._loadAll();
        break;
    }
    return ch;
  }

  _pat() { return this.project.patterns[this.playId]; }

  _loadParam(t, id) {
    const def = SOUND_PARAMS[I[id]];
    const v = this._pat().kit.sounds[t].params[id];
    this.trackP[t][I[id]] = toNum(def, v === undefined ? def.def : v);
  }

  _loadTrack(t) {
    const s = this._pat().kit.sounds[t];
    const arr = this.trackP[t];
    for (let i = 0; i < NUM_PARAMS; i++) {
      const def = SOUND_PARAMS[i];
      const v = s.params[def.id];
      arr[i] = toNum(def, v === undefined ? def.def : v);
    }
    this.trackMachine[t] = s.machine;
  }

  _loadFx() {
    const fx = this._pat().kit.fx;
    for (let i = 0; i < FX_PARAMS.length; i++) {
      const def = FX_PARAMS[i];
      const v = fx[def.id];
      this.fx[i] = toNum(def, v === undefined ? def.def : v);
    }
  }

  _loadAll() {
    if (!this.project.patterns[this.playId]) this.playId = this.project.current;
    for (let t = 0; t < NUM_TRACKS; t++) this._loadTrack(t);
    this._loadFx();
  }

  // -------------------------------------------------------------- transport
  play() {
    if (this.playing) return;
    this.playing = true;
    if (this.songMode) {
      this.songRow = 0; this.songRepeat = 0;
      const rows = this.project.song.rows;
      if (rows.length && this.project.patterns[rows[0].pattern]) this.playId = rows[0].pattern;
    } else this.playId = this.project.current;
    this._loadAll();
    this.ppos = 0;
    this.nextPulse = this.time;
    this.patternLoop = 0;
    this.loops.fill(0);
    this.lastCond.fill(0);
    this.curStep.fill(-1);
    this.emit({ type: 'transport', playing: true, pattern: this.playId });
  }

  stop() {
    if (!this.playing) { this.panic(); return; } // second stop = hard kill
    this.playing = false;
    // drop pending sequencer events; release everything that is gated
    this.events.length = 0;
    for (const a of this.arp) { a.notes.length = 0; a.running = false; }
    for (const v of this.voices) if (v.active && !v.live) v.release();
    this.curStep.fill(-1);
    this.emit({ type: 'transport', playing: false, pattern: this.playId });
  }

  panic() {
    this.events.length = 0;
    for (const a of this.arp) { a.notes.length = 0; a.running = false; }
    for (const v of this.voices) if (v.active) v.kill();
    this.liveNotes.clear();
  }

  setFill(on) { this.fill = !!on; }
  setSongMode(on) { this.songMode = !!on; this.songRow = 0; this.songRepeat = 0; }

  emit(ev) { if (this.outbox.length < 256) this.outbox.push(ev); }
  drainEvents() { const o = this.outbox; this.outbox = []; return o; }

  // ------------------------------------------------------------ live input
  liveNoteOn(track, note, vel = 100) {
    const P = this.trackP[track];
    this._triggerLfos(track, null);
    if (P[ARP_MODE] >= 1) { this._arpAdd(track, [note], vel, null, -1, this.time, true); return; }
    const key = track * 128 + note;
    const prev = this.liveNotes.get(key);
    if (prev !== undefined) this._releaseNote(prev);
    const id = this._startVoice(track, note, vel, null, false, true);
    this.liveNotes.set(key, id);
    this._log('on', this.time, track, note, vel);
  }

  liveNoteOff(track, note) {
    const P = this.trackP[track];
    if (P[ARP_MODE] >= 1) {
      const a = this.arp[track];
      a.notes = a.notes.filter((n) => !(n.live && n.note === note));
      return;
    }
    const key = track * 128 + note;
    const id = this.liveNotes.get(key);
    if (id !== undefined) { this._releaseNote(id); this.liveNotes.delete(key); this._log('off', this.time, track, note, 0); }
  }

  // ---------------------------------------------------------------- render
  _alloc(n) {
    this.cap = n;
    this.L = new Float32Array(n); this.R = new Float32Array(n);
    this.bDel = new Float32Array(n); this.bRev = new Float32Array(n); this.bCho = new Float32Array(n);
    this.bSc = new Float32Array(n);
    this.bus = { L: this.L, R: this.R, del: this.bDel, rev: this.bRev, cho: this.bCho, sc: this.bSc, scTrack: -1 };
  }

  pulseSamples() { return (this.sr * 60) / (this.project.tempo * 96); }

  /** Render n frames into outL/outR (Float32Arrays of length >= n). */
  process(outL, outR, n) {
    if (n > this.cap) this._alloc(n);
    const { L, R, bDel, bRev, bCho, bSc } = this;
    L.fill(0, 0, n); R.fill(0, 0, n); bDel.fill(0, 0, n); bRev.fill(0, 0, n); bCho.fill(0, 0, n); bSc.fill(0, 0, n);
    const scs = this.fx[FX_SCS] | 0;
    this.bus.scTrack = scs - 1;

    const t0 = this.time;
    if (this.playing) this._clock(t0 + n);
    const ev = this.events;
    let pos = 0;
    while (pos < n) {
      const now = t0 + pos;
      while (ev.length && ev[0].time <= now) this._fire(ev.shift());
      let seg = Math.min(CTRL, n - pos);
      if (ev.length) { const until = ev[0].time - now; if (until < seg) seg = until; }
      this._updateLfos(seg);
      for (let v = 0; v < NUM_VOICES; v++) {
        const voice = this.voices[v];
        if (voice.active) voice.render(this.trackP[voice.track], this.trackM[voice.track], seg, this.bus, pos);
      }
      pos += seg;
    }
    // send effects
    const stepSec = (60 / this.project.tempo) / 4;
    this.chorus.process(bCho, L, R, bDel, bRev, n, this.fx);
    this.delay.process(bDel, L, R, bRev, n, this.fx, stepSec);
    this.reverb.process(bRev, L, R, n, this.fx);
    this.comp.process(L, R, scs > 0 ? bSc : null, n, this.fx);
    const peak = masterStage(L, R, n, this.fx);
    outL.set(n === L.length ? L : L.subarray(0, n));
    outR.set(n === R.length ? R : R.subarray(0, n));
    this.time = t0 + n;
    this._telemetry(peak);
  }

  _telemetry(peak) {
    const T = this.telemetry;
    T[TEL.PLAYING] = this.playing ? 1 : 0;
    const pid = parsePatternId(this.playId);
    T[TEL.PATTERN] = pid ? pid.bank * 16 + pid.index : 0;
    T[TEL.PATTERN_LOOP] = this.patternLoop;
    T[TEL.FILL] = this.fill ? 1 : 0;
    T[TEL.SONG_ROW] = this.songRow;
    T[TEL.SONG_MODE] = this.songMode ? 1 : 0;
    T[TEL.TEMPO] = this.project.tempo;
    T[TEL.COMP_GR] = this.comp.gr;
    T[TEL.MASTER_PEAK] = Math.max(peak, T[TEL.MASTER_PEAK] * 0.93);
    T[TEL.TIME] = this.time / this.sr;
    const pat = this._pat();
    const mp = SPEED_PULSES[pat.speed];
    T[TEL.MASTER_STEP] = this.playing ? Math.max(0, Math.floor((this.ppos - 1) / mp)) : -1;
    let active = 0;
    this.trackPeak.fill(0);
    for (const v of this.voices) {
      if (!v.active) continue;
      active++;
      if (v.peak > this.trackPeak[v.track]) this.trackPeak[v.track] = v.peak;
      v.peak = 0;
    }
    T[TEL.VOICES] = active;
    for (let t = 0; t < NUM_TRACKS; t++) {
      T[TEL.STEP + t] = this.curStep[t];
      T[TEL.PEAK + t] = Math.max(this.trackPeak[t], T[TEL.PEAK + t] * 0.9);
      T[TEL.STEP_FRAC + t] = this.stepLen[t] > 0 ? Math.min(1, (this.time - this.stepStart[t]) / this.stepLen[t]) : 0;
    }
  }

  // ------------------------------------------------------------- LFOs
  _lfoParam(t, idx) {
    const lk = this.lfoLocks[t];
    const id = SOUND_PARAMS[idx].id;
    if (lk && id in lk) return toNum(SOUND_PARAMS[idx], lk[id]);
    return this.trackP[t][idx] + this.trackM[t][idx];
  }

  _updateLfos(n) {
    const seconds = n / this.sr;
    const stepsPerSec = (this.project.tempo / 60) * 4;
    for (let t = 0; t < NUM_TRACKS; t++) {
      const M = this.trackM[t];
      const dests = this.lfoDest[t];
      for (let k = 0; k < 3; k++) if (dests[k] >= 0) { M[dests[k]] = 0; dests[k] = -1; }
      for (let k = 0; k < 3; k++) {
        const ids = LFO_IDS[k];
        const dep = this._lfoParam(t, ids[7]);
        const dest = this.trackP[t][ids[3]] | 0;
        const lfo = this.lfos[t][k];
        const spd = this._lfoParam(t, ids[0]);
        const mul = LFO_MULTS[this.trackP[t][ids[1]] | 0];
        const hz = ((Math.abs(spd) * mul) / 2048) * stepsPerSec;
        const val = lfo.advance(seconds, hz, this.trackP[t][ids[4]] | 0, this.trackP[t][ids[6]] | 0, this._lfoParam(t, ids[2]), spd < 0 ? -1 : 1);
        if (dest < 0 || dep === 0 || PRANGE[dest] === 0) continue;
        M[dest] += val * (dep / 64) * PRANGE[dest];
        dests[k] = dest;
      }
    }
  }

  _triggerLfos(t, locks) {
    this.lfoLocks[t] = locks;
    for (let k = 0; k < 3; k++) {
      const ids = LFO_IDS[k];
      const mode = this.trackP[t][ids[6]] | 0;
      if (mode) this.lfos[t][k].trigger(mode, this._lfoParam(t, ids[5]), this._lfoParam(t, ids[2]));
    }
  }

  // ------------------------------------------------------------- sequencer
  _clock(t1) {
    let guard = 0;
    while (this.nextPulse < t1 && guard++ < 10000) {
      this._pulse(this.nextPulse);
      this.nextPulse += this.pulseSamples();
    }
  }

  _muted(t) {
    const solos = this.project.solos;
    for (let i = 0; i < NUM_TRACKS; i++) if (solos[i]) return !solos[t];
    return this.project.mutes[t];
  }

  _boundary() {
    let next = this.playId;
    if (this.songMode && this.project.song.rows.length) {
      const rows = this.project.song.rows;
      this.songRepeat++;
      const row = rows[this.songRow % rows.length];
      if (this.songRepeat >= row.repeats) {
        this.songRow = (this.songRow + 1) % rows.length;
        this.songRepeat = 0;
        next = rows[this.songRow].pattern;
      }
    } else if (this.project.current !== this.playId) next = this.project.current;
    if (next !== this.playId && this.project.patterns[next]) {
      this.playId = next;
      this._loadAll();
      this.patternLoop = 0;
      this.loops.fill(0);
      this.emit({ type: 'pattern', id: next, songRow: this.songRow });
    } else {
      this.patternLoop++;
      for (let t = 0; t < NUM_TRACKS; t++) this.loops[t]++;
    }
    this.ppos = 0;
  }

  _pulse(time) {
    let pat = this._pat();
    const master = pat.length * SPEED_PULSES[pat.speed];
    if (this.ppos >= master) { this._boundary(); pat = this._pat(); }
    const trackMode = pat.scaleMode === 'track';
    const ps = this.pulseSamples();
    for (let t = 0; t < NUM_TRACKS; t++) {
      const ts = pat.tracks[t];
      const tp = SPEED_PULSES[trackMode ? ts.speed : pat.speed];
      if (this.ppos % tp !== 0) continue;
      const len = trackMode ? ts.len : pat.length;
      const n = this.ppos / tp;
      const step = n % len;
      if (step === 0 && n > 0) this.loops[t]++;
      const stepDur = tp * ps;
      this.curStep[t] = step;
      this.stepStart[t] = time;
      this.stepLen[t] = stepDur;
      const steps = ts.steps;
      const trig = steps[step];
      if (trig && !(trig.micro < 0)) this._scheduleTrig(t, step, trig, time, stepDur, this.loops[t], pat);
      const ns = (step + 1) % len;
      const nt = steps[ns];
      if (nt && nt.micro < 0) this._scheduleTrig(t, ns, nt, time + stepDur, stepDur, ns === 0 ? this.loops[t] + 1 : this.loops[t], pat);
    }
    this.ppos++;
  }

  _evalCond(t, cond, loopN) {
    if (!cond) return true;
    let r;
    switch (cond) {
      case 'FILL': r = this.fill; break;
      case '!FILL': r = !this.fill; break;
      case 'PRE': return this.lastCond[t] === 1;
      case '!PRE': return this.lastCond[t] !== 1;
      case 'NEI': return t > 0 && this.lastCond[t - 1] === 1;
      case '!NEI': return !(t > 0 && this.lastCond[t - 1] === 1);
      case '1ST': r = this.patternLoop === 0; break;
      case '!1ST': r = this.patternLoop !== 0; break;
      default:
        if (cond.endsWith('%')) r = this.rng.next() * 100 < parseFloat(cond);
        else {
          const [a, b] = cond.split(':').map(Number);
          r = loopN % b === a - 1;
        }
    }
    this.lastCond[t] = r ? 1 : 0;
    return r;
  }

  _scheduleTrig(t, step, trig, gridTime, stepDur, loopN, pat) {
    let time = gridTime;
    if (step % 2 === 1 && pat.swing > 50) time += ((pat.swing - 50) / 50) * stepDur;
    if (trig.micro) time += (trig.micro / 24) * stepDur;
    if (!this._evalCond(t, trig.cond, loopN)) return;
    if (trig.type === 'lock') {
      this._push(EV_LOCK, time, t, 0, 0, -1, trig.locks, false, null);
      return;
    }
    if (this._muted(t)) return;
    const P = this.trackP[t];
    const lk = trig.locks;
    const note = lk && lk['trig.note'] !== undefined ? +lk['trig.note'] : P[NOTE];
    const vel = lk && lk['trig.vel'] !== undefined ? +lk['trig.vel'] : P[VEL];
    const lenV = lk && lk['trig.len'] !== undefined ? lk['trig.len'] : LENGTHS[P[LEN] | 0];
    const lenS = lenV === 'INF' ? -1 : lenV * stepDur;
    if (trig.retrig) {
      const r = trig.retrig;
      const denom = +r.rate.split('/')[1];
      const interval = (stepDur * 16) / denom;
      const total = r.len === 'INF' ? stepDur * 128 : r.len * stepDur;
      const count = Math.max(1, Math.floor(total / interval + 1e-6));
      for (let k = 0; k < count; k++) {
        const f = count > 1 ? k / (count - 1) : 0;
        const v = Math.max(1, Math.min(127, vel * (1 + (r.vel / 128) * (r.vel < 0 ? f : f - 1))));
        this._push(EV_NOTE, time + k * interval, t, note, v, Math.min(lenS < 0 ? interval : lenS, interval * 0.95), lk, trig.slide, trig.notes);
      }
      return;
    }
    this._push(EV_NOTE, time, t, note, vel, lenS, lk, trig.slide, trig.notes);
  }

  _push(type, time, track, note, vel, len, locks, slide, notes, id = -1) {
    const e = this.pool.pop() || {};
    e.type = type; e.time = Math.max(this.time, Math.round(time)); e.track = track; e.note = note; e.vel = vel;
    e.len = len; e.locks = locks || null; e.slide = !!slide; e.notes = notes || null; e.id = id;
    const ev = this.events;
    let i = ev.length;
    while (i > 0 && ev[i - 1].time > e.time) i--;
    ev.splice(i, 0, e);
  }

  _fire(e) {
    const t = e.track;
    switch (e.type) {
      case EV_NOTE: {
        this._triggerLfos(t, e.locks);
        const P = this.trackP[t];
        if (P[ARP_MODE] >= 1) {
          const notes = [e.note]; if (e.notes) notes.push(...e.notes);
          this._arpAdd(t, notes, e.vel, e.locks, e.len, e.time, false);
          break;
        }
        this._playNote(t, e.note, e.vel, e.locks, e.slide, e.len, e.time);
        if (e.notes) for (const n of e.notes) this._playNote(t, n, e.vel, e.locks, false, e.len, e.time);
        break;
      }
      case EV_OFF:
        this._releaseNote(e.id);
        this._log('off', e.time, t, e.note, 0);
        break;
      case EV_LOCK:
        for (const v of this.voices) if (v.active && v.track === t) v.setLocks(e.locks, true);
        break;
      case EV_ARP:
        this._arpTick(t, e.time);
        break;
    }
    this.pool.push(e);
  }

  _playNote(t, note, vel, locks, slide, lenS, time) {
    const id = this._startVoice(t, note, vel, locks, slide, false);
    this._log('on', time, t, note, vel);
    if (lenS >= 0) this._push(EV_OFF, time + Math.max(1, lenS), t, note, 0, 0, null, false, null, id);
  }

  _log(kind, time, track, note, vel) {
    if (!this.logNotes) return;
    this.noteLog.push({ kind, time, track, note, vel });
    if (this.noteLog.length > 4096) this.noteLog.shift();
  }

  _releaseNote(id) {
    for (const v of this.voices) if (v.noteId === id && v.active) v.release();
  }

  _startVoice(t, note, vel, locks, slide, live) {
    const P = this.trackP[t], M = this.trackM[t];
    const maxV = Math.max(1, P[VOIC] | 0);
    const legato = P[LEG] >= 0.5 || slide;
    const glide = P[PORT] > 0.5 || slide;
    const from = glide ? this.lastNote[t] : null;
    const machine = this.trackMachine[t];
    const voices = this.voices;
    let v = null;
    let count = 0, oldest = null, oldestRel = null;
    for (const x of voices) {
      if (!x.active || x.track !== t) continue;
      count++;
      if (!oldest || x.age < oldest.age) oldest = x;
      if (!x.gate && (!oldestRel || x.age < oldestRel.age)) oldestRel = x;
    }
    let legatoStart = false;
    if (maxV === 1 && count > 0) {
      // mono: reuse the newest voice of this track
      let newest = null;
      for (const x of voices) if (x.active && x.track === t && (!newest || x.age > newest.age)) newest = x;
      v = newest;
      legatoStart = legato && v.gate && v.machineId === machine;
    } else if (count >= maxV) v = oldestRel || oldest;
    if (!v) {
      for (const x of voices) if (!x.active) { v = x; break; }
    }
    if (!v) {
      let best = null;
      for (const x of voices) {
        const score = (x.gate ? 1e9 : 0) + x.age; // prefer released, then oldest
        if (!best || score < best.score) best = { x, score };
      }
      v = best.x;
    }
    v.setLocks(locks, false);
    if (slide && P[PORT] < 1) { v.lockMask[PORT] = 1; v.lockVal[PORT] = 40; v.lockCount++; }
    v.start(t, machine, note, vel, legatoStart || glide ? from : null, P, M, legatoStart);
    v.age = ++this.ageCounter;
    v.noteId = ++this.noteCounter;
    v.live = live;
    this.lastNote[t] = note;
    return v.noteId;
  }

  // ------------------------------------------------------------- arpeggiator
  _arpStepSamples(t) {
    const pat = this._pat();
    const sp = pat.scaleMode === 'track' ? pat.tracks[t].speed : pat.speed;
    return SPEED_PULSES[sp] * this.pulseSamples();
  }

  _arpAdd(t, notes, vel, locks, lenS, time, live) {
    const a = this.arp[t];
    const until = live || lenS < 0 ? Infinity : time + lenS;
    for (const n of notes) a.notes.push({ note: n, vel, locks, until, live, order: a.order++ });
    if (!a.running) {
      a.running = true;
      a.idx = 0;
      this._push(EV_ARP, time, t, 0, 0, 0, null, false, null);
    }
  }

  _arpTick(t, time) {
    const a = this.arp[t];
    a.notes = a.notes.filter((n) => n.until > time);
    const P = this.trackP[t];
    if (!a.notes.length || P[ARP_MODE] < 1) { a.running = false; return; }
    const mode = P[ARP_MODE] | 0;
    const rng = Math.max(1, P[ARP_RNG] | 0);
    let base = a.notes.slice();
    if (mode === 1) base.sort((x, y) => x.order - y.order);
    else base.sort((x, y) => x.note - y.note);
    let seq = [];
    for (let o = 0; o < rng; o++) for (const n of base) seq.push({ ...n, note: n.note + 12 * o });
    if (mode === 3) seq.reverse();
    if (mode === 4 && seq.length > 2) seq = seq.concat(seq.slice(1, -1).reverse());
    let pick;
    if (mode === 6) pick = seq[Math.floor(this.rng.next() * seq.length)];
    else if (mode === 5) {
      if (a.idx % seq.length === 0 || a.shuffle.length !== seq.length) {
        a.shuffle = seq.map((_, i) => i);
        for (let i = a.shuffle.length - 1; i > 0; i--) { const j = Math.floor(this.rng.next() * (i + 1)); [a.shuffle[i], a.shuffle[j]] = [a.shuffle[j], a.shuffle[i]]; }
      }
      pick = seq[a.shuffle[a.idx % seq.length]];
    } else pick = seq[a.idx % seq.length];
    a.idx++;
    const stepS = this._arpStepSamples(t);
    const nlen = LENGTHS[P[ARP_NLEN] | 0];
    const lenS = nlen === 'INF' ? stepS * 0.9 : nlen * stepS;
    this._playNote(t, pick.note, pick.vel, pick.locks, false, lenS, time);
    const spd = +eval_frac(ARP_SPEEDS[P[ARP_SPD] | 0]);
    this._push(EV_ARP, time + spd * stepS, t, 0, 0, 0, null, false, null);
  }

  // -------------------------------------------------------------- helpers
  /** Render `seconds` of audio; returns { L, R } Float32Arrays. For tests/tools. */
  renderSeconds(seconds, block = 128) {
    const total = Math.round(seconds * this.sr);
    const L = new Float32Array(total), R = new Float32Array(total);
    const bl = new Float32Array(block), br = new Float32Array(block);
    for (let pos = 0; pos < total; pos += block) {
      const n = Math.min(block, total - pos);
      this.process(bl, br, n);
      L.set(bl.subarray(0, n), pos); R.set(br.subarray(0, n), pos);
    }
    return { L, R };
  }

  /** Snapshot of runtime status (for APIs / debugging). */
  status() {
    return {
      playing: this.playing, playPattern: this.playId, current: this.project.current,
      tempo: this.project.tempo, time: this.time / this.sr, fill: this.fill, songMode: this.songMode,
      songRow: this.songRow, patternLoop: this.patternLoop,
      steps: Array.from(this.curStep), activeVoices: this.voices.filter((v) => v.active).length,
      voices: this.voices.filter((v) => v.active).map((v) => ({ id: v.id, track: v.track, note: +v.note.toFixed(2), gate: v.gate, machine: v.machineId })),
      events: this.events.length,
    };
  }
}

function eval_frac(s) {
  const [a, b] = String(s).split('/');
  return b ? +a / +b : +a;
}

export { RETRIG_RATES };
