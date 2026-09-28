// Modal sheets: patterns, song, mixer (+ send FX / compressor / master),
// sounds (machines + presets), project (files, export, audio, MIDI), help.

import { h, setText, setStyle, toast, dragNumber } from '../../app/ui/dom.js';
import { Knob } from '../../app/ui/knob.js';
import { FX_PAGES, getDef, formatValue, MACHINES, SPEEDS, noteName } from '../../core/params.js';
import { BANKS, patternId, parsePatternId, newProject, clone, migrateProject, validateProject } from '../../core/project.js';
import { PRESETS, presetSound } from '../../core/presets.js';
import { demoProject } from '../../core/demo.js';
import { TEL } from '../../engine/engine.js';

export class Overlays {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('overlay-root');
    this.current = null;
    this.frameFn = null;
    this.bank = 0;
  }

  open(name) {
    this.close();
    const build = this['build_' + name];
    if (!build) return;
    const sheet = h('div.sheet', { role: 'dialog', 'aria-label': name, 'data-testid': 'overlay-' + name });
    const ov = h('div.overlay', { on: { pointerdown: (e) => { if (e.target === ov) this.close(); } } }, sheet);
    this.current = { name, ov, sheet };
    this.root.append(ov);
    this.render();
    this.app.store.setUI({ overlay: name });
  }

  render() {
    if (!this.current) return;
    const { name, sheet } = this.current;
    this.frameFn = null;
    const title = { patterns: 'PATTERNS', song: 'SONG MODE', mixer: 'MIXER & FX', sounds: 'SOUNDS', project: 'SETTINGS & PROJECT', help: 'HELP' }[name];
    sheet.replaceChildren(
      h('h2', title, h('button.btn.small.close', { 'data-testid': 'overlay-close', on: { click: () => this.close() } }, 'CLOSE ✕')),
      ...[].concat(this['build_' + name]()),
    );
  }

  close() {
    if (!this.current) return;
    this.current.ov.remove();
    this.current = null;
    this.frameFn = null;
    this.app.store.setUI({ overlay: null });
  }

  /** Re-render only for structural changes; value edits update in place. */
  update(kind, ch) {
    if (!this.current || this._dragging) return;
    if (kind === 'project' && ch && !['all', 'current', 'song', 'mix', 'pattern'].includes(ch.scope)) return;
    if (kind === 'ui' && !(ch && (ch.userSounds || ch.track !== undefined || ch.songMode !== undefined))) return;
    this.render();
  }
  frame() { if (this.frameFn) this.frameFn(); }

  // ------------------------------------------------------------ patterns
  build_patterns() {
    const { store, actions, audio } = this.app;
    const cur = parsePatternId(store.project.current);
    if (this._bankInit !== true) { this.bank = cur.bank; this._bankInit = true; }
    const banks = h('div.banks', ...BANKS.map((b, i) => {
      const has = Object.keys(store.project.patterns).some((id) => id[0] === b);
      return h('button.btn' + (i === this.bank ? '.on' : ''), { style: has ? { color: i === this.bank ? '' : 'var(--amber)' } : {}, on: { click: () => { this.bank = i; this.render(); } } }, b);
    }));
    const playing = audio.playing ? store.ui.playPattern : null;
    const grid = h('div.patgrid', ...Array.from({ length: 16 }, (_, i) => {
      const id = patternId(this.bank, i);
      const p = store.project.patterns[id];
      const cls = ['btn', p ? 'has' : '', id === store.project.current ? 'on' : '', id === playing ? 'playing' : ''].filter(Boolean).join('.');
      return h('button.' + cls, { 'data-testid': 'pat-' + id, title: p && p.name ? p.name : id, on: { click: () => { actions.selectPattern(id); this.render(); } } }, id);
    }));
    const pat = store.pattern;
    const name = h('input.txt', { value: pat.name, placeholder: 'name', maxLength: 16, on: { change: (e) => store.dispatch({ type: 'setPattern', patch: { name: e.target.value } }) } });
    const len = h('input.num', { type: 'number', min: 1, max: 128, value: pat.length, on: { change: (e) => actions.safe(() => store.dispatch({ type: 'setPattern', patch: { length: +e.target.value } })) } });
    const spd = h('select.pick', { on: { change: (e) => store.dispatch({ type: 'setPattern', patch: { speed: e.target.value } }) } }, ...SPEEDS.map((s) => h('option', { value: s, selected: s === pat.speed }, s)));
    const swing = h('input.num', { type: 'number', min: 50, max: 80, value: pat.swing, on: { change: (e) => actions.safe(() => store.dispatch({ type: 'setPattern', patch: { swing: +e.target.value } })) } });
    const target = h('input.txt', { placeholder: 'e.g. B01', style: { width: '90px' } });
    return [
      h('p', 'Select a pattern. While playing, the new pattern is cued and starts at the end of the current one. Empty patterns inherit the current kit.'),
      banks, grid,
      h('h4', `PATTERN ${store.project.current} SETTINGS`),
      h('div.formrow',
        h('div.field', h('label', 'NAME'), name),
        h('div.field', h('label', 'LENGTH'), len),
        h('div.field', h('label', 'SPEED'), spd),
        h('div.field', h('label', 'SWING %'), swing),
        h('div.field', h('label', 'COPY TO'), h('div.row', target, h('button.btn.small', { on: { click: () => actions.safe(() => { store.dispatch({ type: 'copyPattern', from: store.project.current, to: target.value.trim().toUpperCase() }); toast('Copied to ' + target.value.toUpperCase()); this.render(); }) } }, 'COPY'))),
        h('div.field', h('label', 'CLEAR'), h('button.btn.small', { on: { click: () => { store.dispatch({ type: 'clearPattern', id: store.project.current }); this.render(); } } }, 'CLEAR TRIGS')),
      ),
    ];
  }

  // ------------------------------------------------------------ song
  build_song() {
    const { store, actions, audio } = this.app;
    const rows = store.project.song.rows;
    const set = (next) => actions.safe(() => { store.dispatch({ type: 'setSong', rows: next }); this.render(); });
    const list = h('div.songrows');
    rows.forEach((r, i) => {
      const pat = h('input.txt', { value: r.pattern, style: { width: '80px' }, on: { change: (e) => set(rows.map((x, j) => (j === i ? { ...x, pattern: e.target.value.trim().toUpperCase() } : x))) } });
      const rep = h('input.num', { type: 'number', min: 1, max: 64, value: r.repeats, on: { change: (e) => set(rows.map((x, j) => (j === i ? { ...x, repeats: +e.target.value } : x))) } });
      const el = h('div.songrow', { 'data-row': i },
        h('span.idx', String(i + 1).padStart(2, '0')), h('span.pick-label', 'PATTERN'), pat, h('span.pick-label', '×'), rep,
        h('button.btn.small', { on: { click: () => i > 0 && set(swap(rows, i, i - 1)) } }, '▲'),
        h('button.btn.small', { on: { click: () => i < rows.length - 1 && set(swap(rows, i, i + 1)) } }, '▼'),
        h('button.btn.small', { on: { click: () => rows.length > 1 && set(rows.filter((_, j) => j !== i)) } }, 'REMOVE'));
      list.append(el);
    });
    this.frameFn = () => {
      const t = audio.telemetry;
      const on = t[TEL.SONG_MODE] > 0.5 && t[TEL.PLAYING] > 0.5;
      [...list.children].forEach((el, i) => el.classList.toggle('cur', on && (t[TEL.SONG_ROW] | 0) === i));
    };
    return [
      h('p', 'Arrange patterns into a song. Enable SONG in the header (or below) and press play to perform the arrangement from the top.'),
      h('div.formrow',
        h('button.btn' + (store.ui.songMode ? '.on' : ''), { on: { click: () => { actions.setSongMode(!store.ui.songMode); this.render(); } } }, store.ui.songMode ? 'SONG MODE ON' : 'SONG MODE OFF'),
        h('button.btn', { on: { click: () => set([...rows, { pattern: store.project.current, repeats: 1 }]) } }, '+ ADD CURRENT PATTERN')),
      h('h4', 'ROWS'), list,
    ];
  }

  // ------------------------------------------------------------ mixer
  build_mixer() {
    const { store, actions, audio } = this.app;
    const pat = store.pattern;
    const strips = h('div.mixer');
    const meters = [];
    for (let t = 0; t < 16; t++) {
      const snd = pat.kit.sounds[t];
      const vol = h('input', { type: 'range', min: 0, max: 127, value: snd.params['amp.vol'], 'aria-label': `Track ${t + 1} volume`,
        on: { input: (e) => actions.setParam('amp.vol', +e.target.value, { track: t }), pointerdown: () => { this._dragging = true; }, pointerup: () => { this._dragging = false; } } });
      const vu = h('i');
      meters.push(vu);
      const mk = (id, label) => {
        const k = new Knob({ small: true, onInput: (v) => { this._dragging = true; actions.setParam(id, v, { track: t }); k.bind(getDef(id), v); this._dragging = false; } });
        k.bind(getDef(id), snd.params[id]);
        return [k.el, h('span.kl', label)];
      };
      strips.append(h('div.strip',
        h('span.t', String(t + 1)), h('span.n', snd.name),
        ...mk('amp.pan', 'PAN'), ...mk('fx.del', 'DEL'), ...mk('fx.rev', 'REV'), ...mk('fx.cho', 'CHO'),
        h('div.fader', vol, h('div.vu', vu)),
        h('div.row', { style: { display: 'flex', gap: '3px' } },
          h('button.ms.m' + (store.project.mutes[t] ? '.on' : ''), { on: { click: () => { actions.toggleMute(t); this.render(); } } }, 'M'),
          h('button.ms.s' + (store.project.solos[t] ? '.on' : ''), { on: { click: () => { actions.toggleSolo(t); this.render(); } } }, 'S'))));
    }
    const fx = pat.kit.fx;
    const cards = Object.entries(FX_PAGES).map(([name, ids]) => h('div.fxcard', h('h5', name),
      h('div.ks', ...ids.filter(Boolean).map((id) => {
        const def = getDef(id);
        const v = h('span.v', formatValue(def, fx[id]));
        const k = new Knob({ small: true, onInput: (val) => { actions.setFx(id, val); v.textContent = formatValue(def, val); k.bind(def, val); }, onReset: () => { actions.setFx(id, def.def); k.bind(def, def.def); v.textContent = formatValue(def, def.def); } });
        k.el.dataset.testid = 'fx-' + id;
        k.bind(def, fx[id]);
        return h('div.kcell', { title: def.name }, h('span.l', def.label), k.el, v);
      }))));
    const gr = h('span');
    this.frameFn = () => {
      const tel = audio.telemetry;
      meters.forEach((m, t) => setStyle(m, 'height', Math.min(100, Math.sqrt(tel[TEL.PEAK + t]) * 130).toFixed(0) + '%'));
      setText(gr, `COMP GR ${tel[TEL.COMP_GR].toFixed(1)} dB`);
    };
    return [strips, h('h4', 'SEND FX · COMPRESSOR · MASTER  ', gr), h('div.fxgrid', ...cards)];
  }

  // ------------------------------------------------------------ sounds
  build_sounds() {
    const { store, actions } = this.app;
    const snd = store.sound;
    const machines = h('div.machines', ...Object.values(MACHINES).map((m) =>
      h('button.btn' + (m.id === snd.machine ? '.on' : ''), { 'data-testid': 'machine-' + m.id, on: { click: () => { actions.setMachine(m.id); this.render(); } } }, h('b', m.name), h('span', m.about))));
    const name = h('input.txt', { value: snd.name, maxLength: 16, style: { width: '180px' }, on: { change: (e) => store.dispatch({ type: 'renameSound', track: store.ui.track, name: e.target.value.toUpperCase() }) } });
    const cats = {};
    for (const p of PRESETS) (cats[p.machine] ||= []).push(p);
    const presetBtns = (list, onClick, extra) => h('div.presets', ...list.map((p) => h('button.btn', { 'data-testid': 'preset-' + p.name, title: 'Load onto track ' + (store.ui.track + 1), on: { click: () => { onClick(p); this.render(); } } }, p.name, h('small', `${MACHINES[p.machine].short} · ${p.category || 'user'}`), extra ? extra(p) : null)));
    const user = store.userSounds();
    return [
      h('h4', `TRACK ${store.ui.track + 1} MACHINE`), machines,
      h('h4', 'SOUND'),
      h('div.formrow', h('div.field', h('label', 'NAME'), name),
        h('button.btn', { on: { click: () => { store.saveUserSound({ ...store.sound, name: store.sound.name }); toast('Saved ' + store.sound.name); this.render(); } } }, 'SAVE TO LIBRARY'),
        h('button.btn', { on: { click: () => { navigator.clipboard?.writeText(JSON.stringify(store.sound, null, 2)); toast('Sound JSON copied'); } } }, 'COPY JSON')),
      ...Object.entries(cats).map(([m, list]) => [h('h4', `FACTORY · ${MACHINES[m].name}`), presetBtns(list, (p) => actions.loadSound(presetSound(p.name)))]).flat(),
      h('h4', 'USER LIBRARY'),
      user.length ? h('div.presets', ...user.map((s) => h('div', { style: { display: 'flex', gap: '4px' } },
        h('button.btn', { style: { flex: 1, textAlign: 'left' }, on: { click: () => { actions.loadSound(s); this.render(); } } }, s.name, h('small', MACHINES[s.machine].short)),
        h('button.btn.small', { title: 'Delete', on: { click: () => { store.deleteUserSound(s.name); this.render(); } } }, '✕'))))
        : h('p', 'Empty. Use SAVE TO LIBRARY to keep sounds across projects.'),
    ];
  }

  // ------------------------------------------------------------ project
  build_project() {
    const { store, actions, audio } = this.app;
    const name = h('input.txt', { value: store.project.name, maxLength: 24, style: { width: '240px' }, on: { change: (e) => store.dispatch({ type: 'setProjectName', name: e.target.value.toUpperCase() }) } });
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, on: { change: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const p = await this.app.files.importProject(f);
        toast('Loaded ' + p.name);
        this.render();
      } catch (err) { toast('Import failed: ' + err.message, true); }
    } } });
    const bars = h('input.num', { type: 'number', min: 1, max: 64, value: 4 });
    const songChk = h('input', { type: 'checkbox' });
    const renderStatus = h('span.pick-label');
    const lat = audio.latencyInfo();
    const devSel = h('select.pick', { on: { change: async (e) => { try { await audio.setSink(e.target.value); toast('Output changed'); } catch (err) { toast(err.message, true); } } } }, h('option', { value: '' }, 'Default output'));
    if (navigator.mediaDevices?.enumerateDevices) navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default').forEach((d) => devSel.append(h('option', { value: d.deviceId }, d.label || 'Output ' + d.deviceId.slice(0, 6))))).catch(() => {});
    const uis = h('div.machines', { 'data-testid': 'ui-switcher' }, ...this.app.uis.map((u) =>
      h('button.btn' + (this.app.ui && u.id === this.app.ui.id ? '.on' : ''), { 'data-testid': 'ui-' + u.id, on: { click: () => this.app.useUI(u.id) } }, h('b', u.name), h('span', u.description))));
    return [
      h('h4', 'INTERFACE  ·  press \\ to cycle'), uis,
      h('h4', 'PROJECT'),
      h('div.formrow',
        h('div.field', h('label', 'PROJECT NAME'), name),
        h('div.field', h('label', 'FILES'), h('div.row',
          h('button.btn', { 'data-testid': 'export-json', on: { click: () => this.app.files.exportProject() } }, 'EXPORT JSON'),
          h('button.btn', { on: { click: () => file.click() } }, 'IMPORT JSON'), file)),
        h('div.field', h('label', 'NEW'), h('div.row',
          h('button.btn', { on: { click: () => { store.dispatch({ type: 'loadProject', project: newProject() }); toast('New project'); this.render(); } } }, 'EMPTY'),
          h('button.btn', { on: { click: () => { store.dispatch({ type: 'loadProject', project: demoProject() }); toast('Demo loaded'); this.render(); } } }, 'DEMO'))),
      ),
      h('h4', 'RENDER TO WAV (OFFLINE, SAME ENGINE)'),
      h('div.formrow',
        h('div.field', h('label', 'BARS'), bars),
        h('label.pick-label', songChk, ' SONG MODE'),
        h('button.btn', { 'data-testid': 'render-wav', on: { click: async () => {
          renderStatus.textContent = 'RENDERING…';
          try {
            const st = await this.app.files.renderWav({ bars: +bars.value, song: songChk.checked });
            renderStatus.textContent = `DONE · peak ${st.peakDb} dB · rms ${st.rmsDb} dB · ${st.renderMs} ms`;
          } catch (e) { renderStatus.textContent = 'FAILED: ' + e.message; }
        } } }, 'RENDER WAV'), renderStatus),
      h('h4', 'AUDIO'),
      h('div.formrow',
        h('div.field', h('label', 'OUTPUT DEVICE'), devSel),
        h('div.field', h('label', 'MIDI INPUT'), h('button.btn', { on: { click: () => this.app.enableMidi() } }, this.app.midiStatus || 'ENABLE WEB MIDI')),
        h('button.btn', { on: { click: () => { audio.panic(); toast('All notes off'); } } }, 'PANIC')),
      h('pre.code', lat ? JSON.stringify(lat, null, 2) : 'Audio not started.'),
    ];
  }

  // ------------------------------------------------------------ help
  build_help() {
    const rows = [
      ['Space', 'Play / stop (stop twice = panic)'], ['R', 'Record (live when playing, step when stopped)'],
      ['A W S E D F T G Y H U J K O L P ;', 'Play notes on the selected track'], ['Z / X', 'Octave down / up'], ['C / V', 'Velocity down / up'],
      ['` (hold)', 'Fill mode'], ['↑ / ↓', 'Previous / next track'], ['← / →', 'Step page'],
      ['1 … 0', 'Pages: TRIG SYN1 SYN2 SYN3 FLTR1 FLTR2 AMP FX LFO ARP'], ['Q', 'Toggle mute on the selected track'],
      ['Click step', 'Toggle note trig'], ['Shift-click / right-click step', 'Select step(s) for parameter locks'],
      ['Alt-click step', 'Toggle lock (trigless) trig'], ['Double-click step', 'Inspect step (conditions, retrig, chord…)'],
      ['Esc', 'Deselect steps / close sheet'], ['Delete / Backspace', 'Clear selected steps'],
      ['⌘/Ctrl C / V', 'Copy / paste steps (selection or page)'], ['⌘/Ctrl Z / ⇧⌘Z', 'Undo / redo'],
      ['Knob: drag / wheel / arrows', 'Change value (Shift = fine); double-click = reset'], ['Tempo / LEN / SPD boxes', 'Drag vertically or scroll'],
      ['I / M / N / B', 'Patterns (I) / Mixer / souNds / song (B)'], ['\\', 'Switch UI (classic / MAGI …)'], ['?', 'This help'],
    ];
    return [
      h('div.help-grid', ...rows.map(([k, d]) => h('div', h('kbd', k), h('span', d)))),
      h('h4', 'FOR AGENTS & SCRIPTS'),
      h('p', 'Everything is scriptable from the console via window.dt — try dt.help(). The engine is deterministic and also runs headless in Node (npm test, node tools/render.mjs). See AGENTS.md.'),
      h('pre.code', `dt.dispatch({ type: 'toggleTrig', track: 0, step: 4 })\ndt.dispatch({ type: 'setParam', track: 4, id: 'flt.frq', value: 64 })\ndt.play(); await dt.wait(2000); dt.stop()\nawait dt.render({ bars: 2 })  // offline stats + WAV url`),
    ];
  }
}

function swap(arr, i, j) { const a = arr.slice(); [a[i], a[j]] = [a[j], a[i]]; return a; }


void dragNumber; void noteName; void clone;
