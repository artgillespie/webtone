// MAGI modal windows: patterns, song, mixer (+FX), sounds, system (UI
// switcher, project files, render, audio, MIDI), help. Values inside are
// Gauges that update in place; windows re-render only on structural changes.

import { h, setStyle } from '../../app/ui/dom.js';
import { FX_PAGES, MACHINES } from '../../core/params.js';
import { BANKS, patternId, parsePatternId, newProject } from '../../core/project.js';
import { PRESETS, presetSound } from '../../core/presets.js';
import { demoProject } from '../../core/demo.js';
import { TEL } from '../../engine/engine.js';
import { Gauge, soundBinding, fxBinding } from './gauge.js';

const TITLES = {
  patterns: ['PATTERN SELECT', 'パターン選択'], song: ['SONG SEQUENCE', '楽曲構成'], mixer: ['MIXER / FX', '混合'],
  sounds: ['SOUND ARCHIVE', '音色'], system: ['SYSTEM', 'システム設定'], help: ['OPERATIONS MANUAL', '操作説明'],
};

export class Modals {
  constructor(host, root) {
    this.host = host;
    this.root = root;
    this.current = null;
    this.gauges = [];
    this.frameFn = null;
    this.bank = null;
  }

  open(name) {
    if (!this['b_' + name]) return false;
    this.close();
    const body = h('div.ev-modal-body');
    const [t, jp] = TITLES[name];
    const win = h('div.ev-window', { role: 'dialog', 'aria-label': name, 'data-testid': 'overlay-' + name },
      h('div.ev-hazard.thin'),
      h('header.ev-window-h', h('b', t), h('span.ev-jp', jp), h('button.ev-btn.sm', { 'data-testid': 'overlay-close', on: { click: () => this.close() } }, 'CLOSE ✕')),
      body);
    const ov = h('div.ev-overlay', { on: { pointerdown: (e) => { if (e.target === ov) this.close(); } } }, win);
    this.current = { name, ov, body };
    this.root.append(ov);
    this.render();
    return true;
  }

  close() {
    if (!this.current) return false;
    this.current.ov.remove();
    this.current = null; this.gauges = []; this.frameFn = null;
    return true;
  }

  render() {
    if (!this.current) return;
    this.gauges = []; this.frameFn = null;
    this.current.body.replaceChildren(...[].concat(this['b_' + this.current.name]()));
    for (const g of this.gauges) g.update();
  }

  update(kind, ch) {
    if (!this.current) return;
    const structural = kind === 'all' || (kind === 'project' && ch && ['all', 'current', 'song', 'mix', 'pattern', 'sound', 'meta'].includes(ch.scope))
      || (kind === 'ui' && ch && (ch.userSounds || ch.track !== undefined || ch.songMode !== undefined));
    if (structural && !document.querySelector('.ev-window .drag')) this.render();
    else for (const g of this.gauges) g.update();
  }

  frame() { if (this.frameFn) this.frameFn(); }

  g(binding, cls = '.mini') { const x = new Gauge(binding, { cls }); this.gauges.push(x); return x.el; }

  // ---------------------------------------------------------------- patterns
  b_patterns() {
    const { store, actions, audio } = this.host;
    const cur = parsePatternId(store.project.current);
    if (this.bank == null) this.bank = cur.bank;
    const banks = h('div.ev-banks', ...BANKS.map((b, i) => {
      const has = Object.keys(store.project.patterns).some((id) => id[0] === b);
      return h('button.ev-btn.sm' + (i === this.bank ? '.on' : '') + (has ? '.has' : ''), { on: { click: () => { this.bank = i; this.render(); } } }, b);
    }));
    const playing = audio.playing ? store.ui.playPattern : null;
    const grid = h('div.ev-patgrid', ...Array.from({ length: 16 }, (_, i) => {
      const id = patternId(this.bank, i);
      const p = store.project.patterns[id];
      const cls = [p ? 'has' : '', id === store.project.current ? 'on' : '', id === playing ? 'playing' : ''].filter(Boolean).map((c) => '.' + c).join('');
      return h('button.ev-pat' + cls, { 'data-testid': 'pat-' + id, on: { click: () => { actions.selectPattern(id); this.render(); } } }, h('b', id), h('small', (p && p.name) || (p ? '—' : 'EMPTY')));
    }));
    const target = h('input.ev-input', { placeholder: 'B01' });
    const name = h('input.ev-input', { value: store.pattern.name, maxLength: 16, on: { change: (e) => store.dispatch({ type: 'setPattern', patch: { name: e.target.value.toUpperCase() } }) } });
    return [
      h('p.ev-dim', 'WHILE PLAYING, THE NEW PATTERN IS CUED FOR THE NEXT BOUNDARY. EMPTY PATTERNS INHERIT THE CURRENT KIT.'),
      banks, grid,
      h('div.ev-sub-lbl', `PATTERN ${store.project.current}`),
      h('div.ev-row.wrap', h('span.ev-lbl', 'NAME'), name,
        h('span.ev-lbl', 'COPY TO'), target, h('button.ev-btn.sm', { on: { click: () => actions.safe(() => { store.dispatch({ type: 'copyPattern', from: store.project.current, to: target.value.trim().toUpperCase() }); this.host.toast('Copied'); this.render(); }) } }, 'COPY'),
        h('button.ev-btn.sm.warn', { on: { click: () => { store.dispatch({ type: 'clearPattern', id: store.project.current }); this.render(); } } }, 'CLEAR TRIGS')),
    ];
  }

  // ---------------------------------------------------------------- song
  b_song() {
    const { store, actions, audio } = this.host;
    const rows = store.project.song.rows;
    const set = (next) => actions.safe(() => { store.dispatch({ type: 'setSong', rows: next }); this.render(); });
    const list = h('div.ev-songrows', ...rows.map((r, i) => h('div.ev-songrow',
      h('b', String(i + 1).padStart(2, '0')),
      h('input.ev-input', { value: r.pattern, on: { change: (e) => set(rows.map((x, j) => (j === i ? { ...x, pattern: e.target.value.trim().toUpperCase() } : x))) } }),
      h('span.ev-lbl', '×'),
      h('input.ev-input.num', { type: 'number', min: 1, max: 64, value: r.repeats, on: { change: (e) => set(rows.map((x, j) => (j === i ? { ...x, repeats: +e.target.value } : x))) } }),
      h('button.ev-btn.sm', { on: { click: () => i > 0 && set(swap(rows, i, i - 1)) } }, '▲'),
      h('button.ev-btn.sm', { on: { click: () => i < rows.length - 1 && set(swap(rows, i, i + 1)) } }, '▼'),
      h('button.ev-btn.sm.warn', { on: { click: () => rows.length > 1 && set(rows.filter((_, j) => j !== i)) } }, 'DEL'))));
    this.frameFn = () => {
      const t = audio.telemetry;
      const on = t[TEL.SONG_MODE] > 0.5 && t[TEL.PLAYING] > 0.5;
      [...list.children].forEach((el, i) => el.classList.toggle('on', on && (t[TEL.SONG_ROW] | 0) === i));
    };
    return [
      h('div.ev-row',
        h('button.ev-btn' + (store.ui.songMode ? '.on' : ''), { on: { click: () => { actions.setSongMode(!store.ui.songMode); this.render(); } } }, store.ui.songMode ? 'SONG MODE: ENGAGED' : 'SONG MODE: OFF'),
        h('button.ev-btn', { on: { click: () => set([...rows, { pattern: store.project.current, repeats: 1 }]) } }, '+ ADD CURRENT PATTERN')),
      list,
    ];
  }

  // ---------------------------------------------------------------- mixer
  b_mixer() {
    const { store, actions, audio } = this.host;
    const meters = [];
    const strips = h('div.ev-mixer', ...Array.from({ length: 16 }, (_, t) => {
      const vu = h('i');
      meters.push(vu);
      const tf = () => t;
      return h('div.ev-strip' + (t === store.ui.track ? '.sel' : ''),
        h('div.ev-strip-h', h('b', String(t + 1).padStart(2, '0')), h('small', store.pattern.kit.sounds[t].name)),
        this.g(soundBinding(this.host, 'amp.vol', tf)), this.g(soundBinding(this.host, 'amp.pan', tf)),
        this.g(soundBinding(this.host, 'fx.del', tf)), this.g(soundBinding(this.host, 'fx.rev', tf)), this.g(soundBinding(this.host, 'fx.cho', tf)),
        h('div.ev-vu', vu),
        h('div.ev-row', h('button.ev-ms' + (store.project.mutes[t] ? '.on' : ''), { on: { click: () => { actions.toggleMute(t); this.render(); } } }, 'M'),
          h('button.ev-ms.s' + (store.project.solos[t] ? '.on' : ''), { on: { click: () => { actions.toggleSolo(t); this.render(); } } }, 'S')));
    }));
    const gr = h('span');
    const cards = Object.entries(FX_PAGES).map(([name, ids]) => h('div.ev-fxcard', h('div.ev-sub-lbl', name),
      h('div.ev-grid.two', ...ids.filter(Boolean).map((id) => this.g(fxBinding(this.host, id), '')))));
    this.frameFn = () => {
      const tel = audio.telemetry;
      meters.forEach((m, t) => setStyle(m, 'width', Math.min(100, Math.sqrt(tel[TEL.PEAK + t]) * 130).toFixed(0) + '%'));
      gr.textContent = `COMP GR ${tel[TEL.COMP_GR].toFixed(1)} dB`;
    };
    return [strips, h('div.ev-sub-lbl', 'SEND FX · COMPRESSOR · MASTER  ', gr), h('div.ev-fxgrid', ...cards)];
  }

  // ---------------------------------------------------------------- sounds
  b_sounds() {
    const { store, actions } = this.host;
    const snd = store.sound;
    const byMachine = {};
    for (const p of PRESETS) (byMachine[p.machine] ||= []).push(p);
    const user = store.userSounds();
    return [
      h('div.ev-sub-lbl', `TRACK ${store.ui.track + 1} — ${snd.name}`),
      h('div.ev-cards', ...Object.values(MACHINES).map((m) => h('button.ev-card' + (m.id === snd.machine ? '.on' : ''), { 'data-testid': 'machine-' + m.id, on: { click: () => { actions.setMachine(m.id); this.render(); } } },
        h('b', m.name), h('span', m.about)))),
      h('div.ev-row', h('button.ev-btn', { on: { click: () => { store.saveUserSound({ ...store.sound }); this.host.toast('Saved ' + store.sound.name); } } }, 'SAVE TO LIBRARY')),
      ...Object.entries(byMachine).flatMap(([m, list]) => [h('div.ev-sub-lbl', `FACTORY · ${MACHINES[m].name}`),
        h('div.ev-presets', ...list.map((p) => h('button.ev-btn.sm', { 'data-testid': 'preset-' + p.name, on: { click: () => { actions.loadSound(presetSound(p.name)); this.render(); } } }, p.name)))]),
      h('div.ev-sub-lbl', 'USER LIBRARY'),
      user.length ? h('div.ev-presets', ...user.map((s) => h('span.ev-row',
        h('button.ev-btn.sm', { on: { click: () => { actions.loadSound(s); this.render(); } } }, s.name),
        h('button.ev-btn.sm.warn', { on: { click: () => { store.deleteUserSound(s.name); this.render(); } } }, '×'))))
        : h('p.ev-dim', 'EMPTY — SAVE SOUNDS TO KEEP THEM ACROSS PROJECTS.'),
    ];
  }

  // ---------------------------------------------------------------- system
  b_system() {
    const host = this.host;
    const { store, audio } = host;
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, on: { change: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { const p = await host.files.importProject(f); host.toast('Loaded ' + p.name); this.render(); } catch (err) { host.toast('Import failed: ' + err.message, true); }
    } } });
    const bars = h('input.ev-input.num', { type: 'number', min: 1, max: 64, value: 4 });
    const song = h('input', { type: 'checkbox' });
    const status = h('span.ev-dim');
    const lat = audio.latencyInfo();
    return [
      h('div.ev-row.wrap', { 'data-testid': 'about' },
        h('span.ev-lbl', 'WEBTONE//'), h('span.ev-ver', host.about.label),
        h('a.ev-btn.sm', { href: host.about.repo, target: '_blank', rel: 'noopener' }, 'SOURCE // GITHUB ↗')),
      h('div.ev-sub-lbl', 'INTERFACE SELECT // 表示系統  (PRESS \\ TO CYCLE)'),
      h('div.ev-cards', { 'data-testid': 'ui-switcher' }, ...host.uis.map((u) => h('button.ev-card' + (host.ui && host.ui.id === u.id ? '.on' : ''), { 'data-testid': 'ui-' + u.id, on: { click: () => host.useUI(u.id) } },
        h('b', u.name), h('span', u.description)))),
      h('div.ev-sub-lbl', 'PROJECT'),
      h('div.ev-row.wrap',
        h('span.ev-lbl', 'NAME'), h('input.ev-input', { value: store.project.name, maxLength: 24, on: { change: (e) => store.dispatch({ type: 'setProjectName', name: e.target.value.toUpperCase() }) } }),
        h('button.ev-btn.sm', { 'data-testid': 'export-json', on: { click: () => host.files.exportProject() } }, 'EXPORT JSON'),
        h('button.ev-btn.sm', { on: { click: () => file.click() } }, 'IMPORT JSON'), file,
        h('button.ev-btn.sm.warn', { on: { click: () => { store.dispatch({ type: 'loadProject', project: newProject() }); this.render(); } } }, 'NEW EMPTY'),
        h('button.ev-btn.sm', { on: { click: () => { store.dispatch({ type: 'loadProject', project: demoProject() }); this.render(); } } }, 'LOAD DEMO')),
      h('div.ev-sub-lbl', 'OFFLINE RENDER // WAV'),
      h('div.ev-row.wrap', h('span.ev-lbl', 'BARS'), bars, h('label.ev-lbl', song, ' SONG'),
        h('button.ev-btn.sm', { 'data-testid': 'render-wav', on: { click: async () => {
          status.textContent = 'RENDERING…';
          try { const st = await host.files.renderWav({ bars: +bars.value, song: song.checked }); status.textContent = `COMPLETE · PEAK ${st.peakDb} dB · RMS ${st.rmsDb} dB · ${st.renderMs} ms`; }
          catch (e) { status.textContent = 'FAILURE: ' + e.message; }
        } } }, 'RENDER'), status),
      h('div.ev-sub-lbl', 'AUDIO / MIDI'),
      h('div.ev-row.wrap',
        h('button.ev-btn.sm', { on: { click: () => host.enableMidi().then(() => this.render()) } }, host.midiStatus || 'ENABLE WEB MIDI'),
        h('button.ev-btn.sm.warn', { on: { click: () => { audio.panic(); host.toast('ALL NOTES OFF'); } } }, 'PANIC')),
      h('pre.ev-pre', lat ? JSON.stringify(lat, null, 2) : 'AUDIO ENGINE OFFLINE'),
    ];
  }

  // ---------------------------------------------------------------- help
  b_help() {
    const rows = [
      ['Space', 'Play / stop'], ['R', 'Record'], ['A W S E D F T G Y H U J K O L P ;', 'Play notes'], ['Z / X · C / V', 'Octave · velocity'],
      ['` (hold)', 'Fill'], ['↑ ↓ / ← →', 'Track / step page'], ['1 … 0', 'Jump to panel'], ['Q', 'Mute track'],
      ['I / B / M / N', 'Patterns / song / mixer / sounds'], ['\\', 'Switch UI'], ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['⌘C / ⌘V', 'Copy / paste steps'],
      ['Esc · Del', 'Release selection / close · clear steps'],
      ['Readouts', 'Drag (shift = fine), click bar = absolute, wheel, arrows, dbl-click = default. Enums: click cycles.'],
      ['Graphs', 'Drag envelope & filter handles, drag LFO shapes (↕ depth ↔ speed), click the FM algorithm.'],
      ['Matrix', 'Click/drag paints, shift/right-click selects steps for p-locks, alt = lock trig, dbl = inspect.'],
    ];
    return [h('div.ev-help', ...rows.map(([k, d]) => h('div', h('kbd', k), h('span', d)))),
      h('p.ev-dim', 'AGENTS: window.dt — dt.help(), await dt.selftest(), dt.uis(), await dt.useUI(id). SEE AGENTS.md.')];
  }
}

function swap(a, i, j) { const b = a.slice(); [b[i], b[j]] = [b[j], b[i]]; return b; }
