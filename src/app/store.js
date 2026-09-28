// Main-thread store: owns the project (via the shared reducer), UI state,
// undo/redo history and persistence. Every project mutation goes through
// store.dispatch(cmd), which applies it locally AND forwards the identical
// command to the audio engine, keeping both in sync.

import { applyCommand } from '../core/commands.js';
import { clone, migrateProject, validateProject } from '../core/project.js';
import { demoProject } from '../core/demo.js';

const SAVE_KEY = 'digitone-web:project';
const USER_SOUNDS_KEY = 'digitone-web:sounds';
const HISTORY_MAX = 120;

export class Store {
  constructor() {
    this.project = this._loadSaved() || demoProject();
    this.ui = {
      track: 0,
      page: 'SYN1',
      stepPage: 0,
      followPage: true,
      selected: new Set(), // selected step indices (absolute) for p-locks / inspector
      octave: 4,
      velocity: 100,
      recording: false,
      recCursor: 0,
      overlay: null,
      fxPage: 'DELAY',
      lastError: null,
    };
    this.listeners = new Set();
    this.past = [];
    this.future = [];
    this._coalesceKey = null;
    this._coalesceAt = 0;
    this._saveTimer = 0;
    this.engineSink = null; // set by audio: (cmd) => void
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, detail) { for (const fn of this.listeners) fn(kind, detail); }

  get pattern() { return this.project.patterns[this.project.current]; }
  get sound() { return this.pattern.kit.sounds[this.ui.track]; }
  trackSeq(t = this.ui.track) { return this.pattern.tracks[t]; }
  trackLength(t = this.ui.track) {
    const p = this.pattern;
    return p.scaleMode === 'track' ? p.tracks[t].len : p.length;
  }

  /**
   * Apply a reducer command. Options:
   *   coalesce: string key — consecutive commands with the same key within
   *             800ms share one undo step (knob drags).
   *   history:  false to skip undo recording.
   */
  dispatch(cmd, { coalesce = null, history = true } = {}) {
    const now = performance.now();
    if (Array.isArray(cmd)) { // one undo step for the whole batch
      if (history && !(coalesce && coalesce === this._coalesceKey && now - this._coalesceAt < 800)) this._pushPast(clone(this.project));
      const out = cmd.map((c) => this.dispatch(c, { history: false }));
      this._coalesceKey = coalesce;
      this._coalesceAt = now;
      return out;
    }
    const snapshot = history && !(coalesce && coalesce === this._coalesceKey && now - this._coalesceAt < 800);
    const before = snapshot ? clone(this.project) : null;
    let ch;
    try {
      ch = applyCommand(this.project, cmd);
    } catch (e) {
      this.ui.lastError = e.message;
      this.emit('error', e);
      throw e;
    }
    if (before) this._pushPast(before);
    this._coalesceKey = coalesce;
    this._coalesceAt = now;
    if (this.engineSink) this.engineSink(cmd);
    if (ch.scope === 'current' || ch.scope === 'all') this._clampUi();
    this.emit('project', ch);
    this._scheduleSave();
    return ch;
  }

  _pushPast(p) {
    this.past.push(p);
    if (this.past.length > HISTORY_MAX) this.past.shift();
    this.future.length = 0;
  }

  setUI(patch) {
    Object.assign(this.ui, patch);
    if ('track' in patch || 'page' in patch) this._clampUi();
    this.emit('ui', patch);
  }

  _clampUi() {
    const len = this.trackLength();
    const pages = Math.ceil(len / 16);
    if (this.ui.stepPage >= pages) this.ui.stepPage = pages - 1;
    for (const s of [...this.ui.selected]) if (s >= len) this.ui.selected.delete(s);
  }

  _restore(p) {
    const cur = clone(this.project);
    applyCommand(this.project, { type: 'loadProject', project: p });
    if (this.engineSink) this.engineSink({ type: 'loadProject', project: p });
    this._clampUi();
    this.emit('project', { scope: 'all' });
    this._scheduleSave();
    return cur;
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(this._restore(this.past.pop()));
    this._coalesceKey = null;
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(this._restore(this.future.pop()));
    this._coalesceKey = null;
    return true;
  }

  // ------------------------------------------------------------ persistence
  _loadSaved() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const p = migrateProject(JSON.parse(raw));
      const errs = validateProject(p);
      if (errs.length) { console.warn('[store] saved project invalid, using demo', errs); return null; }
      return p;
    } catch (e) { console.warn('[store] could not load saved project', e); return null; }
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 600);
  }

  saveNow() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.project)); } catch (e) { console.warn('[store] save failed', e); }
  }

  userSounds() {
    try { return JSON.parse(localStorage.getItem(USER_SOUNDS_KEY) || '[]'); } catch { return []; }
  }
  saveUserSound(sound) {
    const list = this.userSounds().filter((s) => s.name !== sound.name);
    list.push(clone(sound));
    try { localStorage.setItem(USER_SOUNDS_KEY, JSON.stringify(list)); } catch {}
    this.emit('ui', { userSounds: true });
  }
  deleteUserSound(name) {
    try { localStorage.setItem(USER_SOUNDS_KEY, JSON.stringify(this.userSounds().filter((s) => s.name !== name))); } catch {}
    this.emit('ui', { userSounds: true });
  }
}
