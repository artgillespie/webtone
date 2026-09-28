// Sequencer matrix: all 16 tracks × one 16-step page, painted directly.
//   click / drag          paint trigs on or off (drag continues the first action)
//   shift/right-click     select steps for parameter locks (selects the track)
//   alt-click             toggle a trigless lock trig
//   double-click          select just that step
//   click a track name    select the track

import { h, setClass } from '../../app/ui/dom.js';
import { MACHINES } from '../../core/params.js';
import { TEL } from '../../engine/engine.js';

export class Matrix {
  constructor(host) {
    this.host = host;
    this.rows = [];
    this.el = h('div.ev-matrix', { 'data-testid': 'matrix', title: 'Click/drag = paint · shift/right-click = select steps for p-locks · alt = lock trig · double-click = inspect' });
    this.paint = null; // { on: bool, track }
    const stepHead = h('div.ev-mx-head', h('span.ev-mx-corner', 'TRK'), ...Array.from({ length: 16 }, (_, i) => h('span', { class: i % 4 === 0 ? 'q' : '' }, String(i + 1))), h('span'), h('span'));
    this.headCells = [...stepHead.children].slice(1, 17);
    this.el.append(stepHead);
    for (let t = 0; t < 16; t++) this._row(t);
    window.addEventListener('pointerup', this._up = () => { if (this.paint) host.store.endGesture(); this.paint = null; });
  }

  destroy() { window.removeEventListener('pointerup', this._up); }

  _row(t) {
    const { store, actions } = this.host;
    const num = h('span.ev-mx-num', String(t + 1).padStart(2, '0'));
    const name = h('span.ev-mx-name');
    const mach = h('span.ev-mx-mach');
    const label = h('div.ev-mx-label', { 'data-testid': `mx-track-${t + 1}`, on: { click: () => actions.selectTrack(t) } }, num, h('span.ev-mx-nm', name, mach));
    const cells = [];
    for (let i = 0; i < 16; i++) {
      const c = h('div.ev-cell', { 'data-testid': `cell-${t + 1}-${i + 1}`, class: 'ev-cell' + (i % 4 === 0 ? ' q' : '') });
      const step = () => store.ui.stepPage * 16 + i;
      c.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;
        e.preventDefault();
        if (e.shiftKey || e.metaKey || e.ctrlKey) { this._select(t, step(), true); return; }
        if (e.altKey) { if (t !== store.ui.track) actions.selectTrack(t); actions.stepClick(step(), { alt: true }); return; }
        const has = !!store.pattern.tracks[t].steps[step()];
        this.paint = { on: !has, track: t };
        store.beginGesture();
        this._paintCell(t, step());
      });
      c.addEventListener('pointerenter', () => { if (this.paint && this.paint.track === t) this._paintCell(t, step()); });
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); this._select(t, step(), true); });
      c.addEventListener('dblclick', () => { if (t !== store.ui.track) actions.selectTrack(t); actions.selectOnly(step()); });
      cells.push(c);
    }
    const m = h('button.ev-ms', { title: 'Mute', on: { click: () => actions.toggleMute(t) } }, 'M');
    const s = h('button.ev-ms.s', { title: 'Solo', on: { click: () => actions.toggleSolo(t) } }, 'S');
    const row = h('div.ev-mx-row', { 'data-track': t }, label, ...cells, m, s);
    this.el.append(row);
    this.rows.push({ row, num, name, mach, cells, m, s, lastPeak: 0 });
  }

  _select(t, step, toggle) {
    const { store, actions } = this.host;
    if (t !== store.ui.track) actions.selectTrack(t);
    const sel = store.ui.selected;
    if (toggle && sel.has(step)) sel.delete(step); else sel.add(step);
    store.setUI({ selected: sel });
  }

  _paintCell(t, step) {
    const { store, actions } = this.host;
    if (step >= store.trackLength(t)) return;
    const has = !!store.pattern.tracks[t].steps[step];
    if (has === this.paint.on) return;
    if (store.ui.selected.size) actions.clearSelection();
    actions.safe(() => store.dispatch({ type: 'setTrig', track: t, step, trig: this.paint.on ? { type: 'note' } : null }, { coalesce: 'paint' }));
  }

  update() {
    const { store } = this.host;
    const pat = store.pattern;
    const base = store.ui.stepPage * 16;
    this.headCells.forEach((c, i) => { c.textContent = String(base + i + 1); });
    this.rows.forEach((r, t) => {
      const snd = pat.kit.sounds[t];
      r.name.textContent = snd.name;
      r.mach.textContent = MACHINES[snd.machine].short;
      setClass(r.row, 'sel', t === store.ui.track);
      setClass(r.row, 'muted', store.project.mutes[t]);
      setClass(r.m, 'on', store.project.mutes[t]);
      setClass(r.s, 'on', store.project.solos[t]);
      const len = store.trackLength(t);
      const steps = pat.tracks[t].steps;
      r.cells.forEach((c, i) => {
        const s = base + i;
        const trig = steps[s];
        setClass(c, 'n', trig && trig.type === 'note');
        setClass(c, 'l', trig && trig.type === 'lock');
        setClass(c, 'cond', !!(trig && trig.cond));
        setClass(c, 'plk', !!(trig && trig.locks && Object.keys(trig.locks).some((k) => k !== 'trig.note')));
        setClass(c, 'rtg', !!(trig && trig.retrig));
        setClass(c, 'off', s >= len);
        setClass(c, 'sel', t === store.ui.track && store.ui.selected.has(s));
      });
    });
  }

  frame() {
    const { store, audio } = this.host;
    const tel = audio.telemetry;
    const playing = tel[TEL.PLAYING] > 0.5;
    const base = store.ui.stepPage * 16;
    this.rows.forEach((r, t) => {
      const cur = playing ? tel[TEL.STEP + t] - base : -99;
      const pk = tel[TEL.PEAK + t];
      const hit = pk > r.lastPeak * 1.25 && pk > 0.02;
      r.lastPeak = pk;
      setClass(r.num, 'hit', hit);
      for (let i = 0; i < 16; i++) {
        const c = r.cells[i];
        setClass(c, 'ph', i === cur);
        if (hit && i === cur) { c.classList.remove('fire'); void c.offsetWidth; c.classList.add('fire'); }
      }
    });
  }
}
