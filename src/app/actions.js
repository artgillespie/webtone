// High-level user actions shared by the UI, keyboard shortcuts, MIDI and
// the agent API (window.dt). Keeps interaction logic out of view code.

import { TEL } from '../engine/engine.js';
import { pagesFor, getDef, PARAM_BY_ID, paramMachine } from '../core/params.js';
import { clone } from '../core/project.js';
import { toast } from './ui/dom.js';

export class Actions {
  constructor(store, audio) {
    this.store = store;
    this.audio = audio;
    this.clipboard = null;
    this.heldNotes = new Map(); // key -> {track, note}
  }

  get ui() { return this.store.ui; }

  safe(fn) {
    try { return fn(); } catch (e) { toast(e.message, true); console.error(e); return undefined; }
  }

  // ------------------------------------------------------------ transport
  togglePlay() { this.audio.playing ? this.stop() : this.play(); }
  play() { this.audio.play(); this.store.emit('transport', true); }
  stop() {
    this.audio.stop();
    this.store.emit('transport', false);
  }
  toggleRecord() { this.store.setUI({ recording: !this.ui.recording, recCursor: this.ui.stepPage * 16 }); }
  setFill(on) { this.audio.setFill(on); this.store.setUI({ fill: on }); }
  setSongMode(on) { this.audio.setSongMode(on); this.store.setUI({ songMode: on }); }

  // ------------------------------------------------------------ navigation
  selectTrack(t) {
    t = Math.max(0, Math.min(15, t));
    if (t === this.ui.track) return;
    this.ui.selected.clear();
    this.store.setUI({ track: t });
    const pages = pagesFor(this.store.sound.machine);
    if (!pages.includes(this.ui.page)) this.store.setUI({ page: 'SYN1' });
  }
  selectPage(p) {
    const pages = pagesFor(this.store.sound.machine);
    if (pages.includes(p)) this.store.setUI({ page: p });
  }
  cyclePage(prefix) {
    const pages = pagesFor(this.store.sound.machine).filter((p) => p.startsWith(prefix));
    const i = pages.indexOf(this.ui.page);
    this.selectPage(pages[(i + 1) % pages.length]);
  }
  setStepPage(i) {
    const pages = Math.ceil(this.store.trackLength() / 16);
    this.store.setUI({ stepPage: Math.max(0, Math.min(pages - 1, i)), followPage: false });
  }

  // ------------------------------------------------------------ steps
  stepClick(step, { shift = false, alt = false, meta = false } = {}) {
    const t = this.ui.track;
    const sel = this.ui.selected;
    if (shift || meta) {
      sel.has(step) ? sel.delete(step) : sel.add(step);
      this.store.setUI({ selected: sel });
      return;
    }
    if (alt) {
      // toggle a lock-only trig (trigless) or convert
      const cur = this.store.trackSeq().steps[step];
      if (cur && cur.type === 'lock') this.store.dispatch({ type: 'setTrig', track: t, step, trig: null });
      else this.store.dispatch({ type: 'setTrig', track: t, step, trig: { ...(cur || {}), type: 'lock' } });
      return;
    }
    if (sel.size) { sel.clear(); this.store.setUI({ selected: sel }); }
    this.store.dispatch({ type: 'toggleTrig', track: t, step });
  }
  selectOnly(step) { this.ui.selected.clear(); this.ui.selected.add(step); this.store.setUI({ selected: this.ui.selected }); }
  clearSelection() { this.ui.selected.clear(); this.store.setUI({ selected: this.ui.selected }); }

  clearSelectedSteps() {
    const t = this.ui.track;
    const steps = [...this.ui.selected];
    if (!steps.length) return;
    this.store.dispatch(steps.map((step) => ({ type: 'setTrig', track: t, step, trig: null })));
  }

  /** Copy selected steps, or the visible page when nothing is selected. */
  copySteps() {
    const seq = this.store.trackSeq();
    const steps = this.ui.selected.size ? [...this.ui.selected].sort((a, b) => a - b) : Array.from({ length: 16 }, (_, i) => this.ui.stepPage * 16 + i);
    const base = steps[0];
    this.clipboard = steps.map((s) => ({ offset: s - base, trig: seq.steps[s] ? clone(seq.steps[s]) : null }));
    toast(`Copied ${steps.length} step${steps.length > 1 ? 's' : ''}`);
  }
  pasteSteps() {
    if (!this.clipboard) return;
    const t = this.ui.track;
    const base = this.ui.selected.size ? Math.min(...this.ui.selected) : this.ui.stepPage * 16;
    const len = this.store.trackLength();
    const cmds = this.clipboard.filter((c) => base + c.offset < len).map((c) => ({ type: 'setTrig', track: t, step: base + c.offset, trig: c.trig }));
    this.safe(() => this.store.dispatch(cmds));
    toast('Pasted');
  }

  // ------------------------------------------------------------ params
  /** Set a param on the current track; lock-aware when steps are selected. */
  setParam(id, value, { track = this.ui.track } = {}) {
    const sel = this.ui.selected;
    const def = getDef(id);
    if (sel.size && track === this.ui.track && def.lock && PARAM_BY_ID[id]) {
      this.safe(() => this.store.dispatch([...sel].map((step) => ({ type: 'setLock', track, step, id, value })), { coalesce: `l:${track}:${id}:${[...sel].join(',')}` }));
      return;
    }
    this.safe(() => this.store.dispatch({ type: 'setParam', track, id, value }, { coalesce: `p:${track}:${id}` }));
  }
  resetParam(id) {
    const def = getDef(id);
    const sel = this.ui.selected;
    if (sel.size && def.lock) {
      this.store.dispatch([...sel].map((step) => ({ type: 'setLock', track: this.ui.track, step, id, value: null })));
    } else this.setParam(id, def.def);
  }
  setFx(id, value) { this.safe(() => this.store.dispatch({ type: 'setFx', id, value }, { coalesce: `fx:${id}` })); }

  /** Value to display for a param (lock of first selected step wins). */
  displayValue(id, track = this.ui.track) {
    const seq = this.store.pattern.tracks[track];
    for (const s of this.ui.selected) {
      const trig = seq.steps[s];
      if (trig && trig.locks && id in trig.locks) return { value: trig.locks[id], locked: true };
    }
    const snd = this.store.pattern.kit.sounds[track];
    const m = paramMachine(id);
    if (m && m !== snd.machine) return { value: undefined, locked: false };
    return { value: snd.params[id] ?? getDef(id).def, locked: false };
  }

  // ------------------------------------------------------------ notes
  noteOn(note, vel = this.ui.velocity, track = this.ui.track) {
    note = Math.max(0, Math.min(127, note));
    this.audio.noteOn(track, note, vel);
    this.heldNotes.set(track * 128 + note, { track, note });
    this.store.emit('note', { track, note, on: true });
    if (this.ui.recording) this._record(track, note, vel);
  }
  noteOff(note, track = this.ui.track) {
    this.audio.noteOff(track, note);
    this.heldNotes.delete(track * 128 + note);
    this.store.emit('note', { track, note, on: false });
  }

  _record(track, note, vel) {
    const tel = this.audio.telemetry;
    const len = this.store.trackLength(track);
    const chord = [...this.heldNotes.values()].filter((n) => n.track === track).length > 1;
    const write = (step) => {
      const existing = this.store.trackSeq(track).steps[step];
      if (chord && existing && existing.type === 'note') {
        // additional held key -> add to the trig's chord (max 4 notes)
        const root = existing.locks && existing.locks['trig.note'];
        const notes = [...(existing.notes || []), note].filter((n) => n !== root).slice(0, 3);
        this.safe(() => this.store.dispatch({ type: 'updateTrig', track, step, patch: { notes } }));
      } else {
        this.safe(() => this.store.dispatch({ type: 'setTrig', track, step, trig: { type: 'note', locks: { 'trig.note': note, 'trig.vel': vel } } }));
      }
    };
    if (this.audio.playing) {
      // live record, quantised to the nearest step
      const cur = tel[TEL.STEP + track];
      const frac = tel[TEL.STEP_FRAC + track];
      write(((frac > 0.5 ? cur + 1 : cur) + len) % len);
    } else if (this.ui.selected.size) {
      this.safe(() => this.store.dispatch([...this.ui.selected].map((step) => ({ type: 'updateTrig', track, step, patch: { locks: { 'trig.note': note } } }))));
    } else {
      // step record: write at the cursor and advance (chords stay on the same step)
      const step = chord ? (this.ui.recCursor - 1 + len) % len : this.ui.recCursor % len;
      write(step);
      if (!chord) {
        const next = (step + 1) % len;
        this.store.setUI({ recCursor: next, stepPage: Math.floor(next / 16) });
      }
    }
  }

  // ------------------------------------------------------------ machines & sounds
  setMachine(machine) {
    this.safe(() => this.store.dispatch({ type: 'setMachine', track: this.ui.track, machine }));
    if (!pagesFor(machine).includes(this.ui.page)) this.store.setUI({ page: 'SYN1' });
  }
  loadSound(sound, track = this.ui.track) {
    this.safe(() => this.store.dispatch({ type: 'loadSound', track, sound }));
    if (!pagesFor(sound.machine).includes(this.ui.page)) this.store.setUI({ page: 'SYN1' });
  }

  toggleMute(t = this.ui.track) { this.store.dispatch({ type: 'setMute', track: t, muted: !this.store.project.mutes[t] }, { history: false }); }
  toggleSolo(t = this.ui.track) { this.store.dispatch({ type: 'setSolo', track: t, solo: !this.store.project.solos[t] }, { history: false }); }

  selectPattern(id) {
    this.safe(() => this.store.dispatch({ type: 'selectPattern', id }, { history: false }));
    this.clearSelection();
  }

  nudgeTempo(delta) {
    const bpm = Math.max(30, Math.min(300, Math.round((this.store.project.tempo + delta) * 10) / 10));
    this.store.dispatch({ type: 'setTempo', bpm }, { coalesce: 'tempo' });
  }
}
