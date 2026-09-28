// Main panel views. Each mount* function builds DOM once and returns
// { update(kind), frame() }: update() runs after store changes, frame() runs
// every animation frame for telemetry (playheads, meters).

import { h, $, setText, setClass, setStyle, dragNumber, SVG, toast } from './dom.js';
import { Knob } from './knob.js';
import {
  pageParams, pagesFor, getDef, MACHINES, FILTER_LABELS, destinationsFor, formatValue, SPEEDS, LENGTHS, CONDITIONS,
  RETRIG_RATES, noteName, FILTER_MACHINES, PARAM_BY_ID,
} from '../../core/params.js';
import { parsePatternId, patternId } from '../../core/project.js';
import { TEL } from '../../engine/engine.js';

// ============================================================== header
export function mountHeader(app) {
  const { store, actions, audio } = app;
  const root = $('#header');
  const pat = h('div.lcd.wide', { title: 'Pattern (click: pattern browser)', 'data-testid': 'pattern-lcd', on: { click: () => app.overlays.open('patterns') } });
  const tempo = h('div.lcd', { title: 'Tempo (drag / wheel, shift = fine)', 'data-testid': 'tempo' });
  dragNumber(tempo, (d, fine) => actions.nudgeTempo(d * (fine ? 0.1 : 1)), 4);
  const btn = (label, title, on, extra = {}) => h('button.btn', { title, on: { click: on }, ...extra }, label);
  const rec = h('button.btn.rec', { title: 'Record (R)', html: SVG.rec, 'data-testid': 'rec', on: { click: () => actions.toggleRecord() } });
  const play = h('button.btn.play', { title: 'Play (Space)', html: SVG.play, 'data-testid': 'play', on: { click: () => actions.togglePlay() } });
  const stop = h('button.btn', { title: 'Stop (Space) — twice = panic', html: SVG.stop, 'data-testid': 'stop', on: { click: () => actions.stop() } });
  const fill = h('button.btn.small', { title: 'Fill (hold ` key or click to latch)', 'data-testid': 'fill', on: { click: () => actions.setFill(!store.ui.fill) } }, 'FILL');
  const song = h('button.btn.small.teal', { title: 'Song mode', 'data-testid': 'song-mode', on: { click: () => actions.setSongMode(!store.ui.songMode) } }, 'SONG');
  const undo = h('button.btn.icon', { title: 'Undo (⌘Z)', html: SVG.undo, on: { click: () => store.undo() } });
  const redo = h('button.btn.icon', { title: 'Redo (⇧⌘Z)', html: SVG.redo, on: { click: () => store.redo() } });
  undo.querySelector('svg').style.cssText = redo.querySelector('svg').style.cssText = 'width:16px;height:16px;fill:currentColor';
  const cpu = h('span'), vo = h('span'), bar = h('i');
  const menu = [
    ['PATTERNS', 'patterns'], ['SONG', 'song'], ['MIXER', 'mixer'], ['SOUNDS', 'sounds'], ['PROJECT', 'project'], ['?', 'help'],
  ].map(([l, k]) => btn(l, `${l.toLowerCase()} (${k === 'help' ? '?' : ''})`, () => app.overlays.open(k), { 'data-testid': 'menu-' + k }));

  root.append(
    h('div.stripes', h('i'), h('i'), h('i'), h('i'), h('i')),
    h('div.logo', 'DIGITONE', h('span.ii', 'II'), h('small', '//WEB')),
    h('div.hdr-group', pat, tempo),
    h('div.transport', rec, play, stop),
    h('div.hdr-group', fill, song),
    h('div.hdr-group', undo, redo),
    h('div.hdr-spacer'),
    h('div.hdr-group', ...menu),
    h('div.meters', h('div', cpu, ' · ', vo), h('div.bar', bar)),
  );

  return {
    update() {
      const cue = audio.playing && store.ui.playPattern && store.ui.playPattern !== store.project.current ? ` ▸${store.project.current}` : '';
      const pn = store.pattern.name ? ' ' + store.pattern.name : '';
      pat.innerHTML = `<small>PATTERN</small>${store.ui.playPattern && audio.playing ? store.ui.playPattern : store.project.current}${cue}<span style="font-size:11px;color:var(--amber-dim)">${pn}</span>`;
      tempo.innerHTML = `<small>BPM</small>${store.project.tempo.toFixed(1)}`;
      setClass(rec, 'on', store.ui.recording);
      setClass(fill, 'on', store.ui.fill);
      setClass(song, 'on', store.ui.songMode);
    },
    frame() {
      const t = audio.telemetry;
      setClass(play, 'on', t[TEL.PLAYING] > 0.5);
      setText(cpu, audio.ready ? `DSP ${(t[TEL.CPU] * 100).toFixed(0)}%` : 'AUDIO OFF');
      setText(vo, `${t[TEL.VOICES] | 0}/16 V`);
      setStyle(bar, 'width', Math.min(100, t[TEL.MASTER_PEAK] * 100).toFixed(1) + '%');
      const pid = playingPatternId(t);
      if (t[TEL.PLAYING] > 0.5 && pid !== store.ui.playPattern) { store.ui.playPattern = pid; this.update(); }
    },
  };
}

export function playingPatternId(t) {
  const i = t[TEL.PATTERN] | 0;
  return patternId(Math.floor(i / 16), i % 16);
}

// ============================================================== tracks
export function mountTracks(app) {
  const { store, actions, audio } = app;
  const root = $('#tracks');
  const rows = [];
  for (let t = 0; t < 16; t++) {
    const num = h('div.num', String(t + 1).padStart(2, '0'));
    const nm = h('b'), mach = h('span');
    const cells = Array.from({ length: 16 }, () => h('i'));
    const mini = h('div.mini', { title: 'Click a cell to toggle a trig' }, ...cells);
    const vu = h('i');
    const m = h('button.ms.m', { title: 'Mute (M)', on: { click: (e) => { e.stopPropagation(); actions.toggleMute(t); } } }, 'M');
    const s = h('button.ms.s', { title: 'Solo', on: { click: (e) => { e.stopPropagation(); actions.toggleSolo(t); } } }, 'S');
    const row = h('div.trk', {
      'data-testid': `track-${t + 1}`, 'data-track': t, role: 'button', 'aria-label': `Track ${t + 1}`,
      on: { click: () => actions.selectTrack(t) },
    }, num, h('div.nm', nm, mach), mini, h('div.vu', vu), m, s);
    mini.addEventListener('click', (e) => {
      const i = cells.indexOf(e.target);
      if (i < 0) return;
      e.stopPropagation();
      actions.safe(() => store.dispatch({ type: 'toggleTrig', track: t, step: store.ui.stepPage * 16 + i }));
    });
    rows.push({ row, num, nm, mach, cells, vu, m, s, lastPeak: 0 });
    root.append(row);
  }
  root.append(h('div.tracks-foot',
    h('button.btn.small', { title: 'Rotate track left', on: { click: () => store.dispatch({ type: 'shiftTrack', track: store.ui.track, amount: -1 }) } }, '◀ SHIFT'),
    h('button.btn.small', { title: 'Rotate track right', on: { click: () => store.dispatch({ type: 'shiftTrack', track: store.ui.track, amount: 1 }) } }, 'SHIFT ▶'),
    h('button.btn.small', { title: 'Clear all trigs on this track', on: { click: () => store.dispatch({ type: 'clearTrack', track: store.ui.track }) } }, 'CLEAR TRK'),
  ));

  return {
    update() {
      const pat = store.pattern;
      const base = store.ui.stepPage * 16;
      rows.forEach((r, t) => {
        const snd = pat.kit.sounds[t];
        setText(r.nm, snd.name);
        setText(r.mach, MACHINES[snd.machine].short + ' · ' + (pat.tracks[t].steps && Object.keys(pat.tracks[t].steps).length) + ' TRG');
        setClass(r.row, 'sel', t === store.ui.track);
        setClass(r.row, 'muted', store.project.mutes[t]);
        setClass(r.m, 'on', store.project.mutes[t]);
        setClass(r.s, 'on', store.project.solos[t]);
        const len = store.trackLength(t);
        const steps = pat.tracks[t].steps;
        r.cells.forEach((c, i) => {
          const s = base + i;
          const trig = steps[s];
          c.className = trig ? (trig.type === 'note' ? 'n' : 'l') : '';
          if (s >= len) c.classList.add('x');
        });
      });
    },
    frame() {
      const tel = audio.telemetry;
      const playing = tel[TEL.PLAYING] > 0.5;
      const base = store.ui.stepPage * 16;
      rows.forEach((r, t) => {
        const pk = tel[TEL.PEAK + t];
        setStyle(r.vu, 'height', Math.min(100, Math.sqrt(pk) * 130).toFixed(0) + '%');
        setClass(r.num, 'hit', pk > r.lastPeak * 1.25 && pk > 0.02);
        r.lastPeak = pk;
        const st = playing ? tel[TEL.STEP + t] - base : -1;
        r.cells.forEach((c, i) => setClass(c, 'p', i === st));
      });
    },
  };
}

// ============================================================== encoders + pages
export function mountEncoders(app) {
  const { store, actions } = app;
  const root = $('#encoders');
  const encs = [];
  for (let i = 0; i < 8; i++) {
    const lbl = h('div.lbl');
    const val = h('div.val');
    const knob = new Knob({
      onInput: (v, def) => { actions.setParam(def.id, v); app.screen.touch(def.id); },
      onReset: (def) => { actions.resetParam(def.id); app.screen.touch(def.id); },
      onHover: (def, on) => { app.screen.hover = on && def ? def.id : null; },
    });
    knob.el.dataset.testid = `encoder-${'ABCDEFGH'[i]}`;
    const wrap = h('div.enc', lbl, knob.el, val);
    encs.push({ wrap, lbl, val, knob });
    root.append(wrap);
  }
  // page buttons
  const nav = $('#pages');
  const pageBtns = {};
  const groups = [['TRIG', 'SYN1', 'SYN2', 'SYN3'], ['FLTR1', 'FLTR2', 'AMP', 'FX'], ['LFO1', 'LFO2', 'LFO3', 'ARP']];
  groups.forEach((g, gi) => {
    if (gi) nav.append(h('div.sep'));
    for (const p of g) {
      const b = h('button.btn', { 'data-testid': 'page-' + p, title: `${p} page`, on: { click: () => actions.selectPage(p) } }, p, h('span.led'));
      pageBtns[p] = b;
      nav.append(b);
    }
  });
  const machSel = h('select.pick', { 'data-testid': 'machine-select', title: 'Synth machine', on: { change: (e) => actions.setMachine(e.target.value) } },
    ...Object.values(MACHINES).map((m) => h('option', { value: m.id }, m.name)));
  const fltSel = h('select.pick', { 'data-testid': 'filter-select', title: 'Filter machine', on: { change: (e) => actions.setParam('flt.mach', e.target.value) } },
    ...FILTER_MACHINES.map((f) => h('option', { value: f }, f)));
  nav.append(h('div.machine-pick', h('span.pick-label', 'MACHINE'), machSel, h('span.pick-label', 'FILTER'), fltSel));

  return {
    update() {
      const snd = store.sound;
      const pages = pagesFor(snd.machine);
      for (const [p, b] of Object.entries(pageBtns)) {
        setClass(b, 'on', store.ui.page === p);
        b.disabled = !pages.includes(p);
        b.style.opacity = pages.includes(p) ? '' : '0.3';
      }
      if (machSel.value !== snd.machine) machSel.value = snd.machine;
      if (fltSel.value !== snd.params['flt.mach']) fltSel.value = snd.params['flt.mach'];
      const ids = pageParams(store.ui.page, snd.machine) || [];
      encs.forEach((e, i) => {
        const id = ids[i];
        setClass(e.wrap, 'empty', !id);
        if (!id) { setText(e.lbl, ''); setText(e.val, ''); e.knob.bind(null); return; }
        let def = getDef(id);
        const { value, locked } = actions.displayValue(id);
        if (def.type === 'dest') {
          const opts = ['none', ...destinationsFor(snd.machine).map((p) => p.id)];
          def = { ...def, type: 'enum', options: opts, max: opts.length - 1 };
        }
        setText(e.lbl, (FILTER_LABELS[snd.params['flt.mach']] && FILTER_LABELS[snd.params['flt.mach']][id]) || def.label);
        const shown = def.id.endsWith('.dest') ? (value === 'none' ? '--' : PARAM_BY_ID[value].label) : formatValue(def, value);
        setText(e.val, shown);
        setClass(e.wrap, 'locked', locked);
        e.knob.bind(def, value ?? def.def, { locked });
      });
    },
  };
}

// ============================================================== sequencer (trig keys)
export function mountSequencer(app) {
  const { store, actions, audio } = app;
  const root = $('#sequencer');
  const mini = (label, title) => {
    const v = h('span');
    const el = h('div.minilcd', { title }, h('small', label), v);
    return { el, v };
  };
  const pLen = mini('LEN', 'Pattern length (drag)');
  const pSpd = mini('SPD', 'Pattern speed (drag)');
  const pSwg = mini('SWG', 'Swing 50-80% (drag)');
  const tLen = mini('T.LEN', 'Track length (track scale mode)');
  const tSpd = mini('T.SPD', 'Track speed (track scale mode)');
  const scale = h('button.btn.small', { title: 'Scale mode: pattern (all tracks share length) or per-track', on: { click: () => store.dispatch({ type: 'setPattern', patch: { scaleMode: store.pattern.scaleMode === 'track' ? 'pattern' : 'track' } }) } });
  const follow = h('button.btn.small', { title: 'Follow playhead page', on: { click: () => store.setUI({ followPage: !store.ui.followPage }) } }, 'FOLLOW');
  dragNumber(pLen.el, (d) => actions.safe(() => store.dispatch({ type: 'setPattern', patch: { length: clampI(store.pattern.length + d, 1, 128) } }, { coalesce: 'plen' })));
  dragNumber(pSpd.el, (d) => store.dispatch({ type: 'setPattern', patch: { speed: SPEEDS[clampI(SPEEDS.indexOf(store.pattern.speed) + d, 0, SPEEDS.length - 1)] } }, { coalesce: 'pspd' }), 14);
  dragNumber(pSwg.el, (d) => store.dispatch({ type: 'setPattern', patch: { swing: clampI(store.pattern.swing + d, 50, 80) } }, { coalesce: 'swing' }));
  dragNumber(tLen.el, (d) => store.dispatch({ type: 'setTrackSeq', track: store.ui.track, len: clampI(store.trackSeq().len + d, 1, 128) }, { coalesce: 'tlen' }));
  dragNumber(tSpd.el, (d) => store.dispatch({ type: 'setTrackSeq', track: store.ui.track, speed: SPEEDS[clampI(SPEEDS.indexOf(store.trackSeq().speed) + d, 0, SPEEDS.length - 1)] }, { coalesce: 'tspd' }), 14);
  const pagesEl = h('div.steppages', { title: 'Step pages (← →)' });
  const pageBtns = Array.from({ length: 8 }, (_, i) => h('button', { 'aria-label': `Step page ${i + 1}`, on: { click: () => actions.setStepPage(i) } }));
  pagesEl.append(...pageBtns);

  const ctl = h('div.seq-ctl',
    h('div.row', pLen.el, pSpd.el, pSwg.el, scale),
    h('div.row', tLen.el, tSpd.el, follow),
    h('div.row', pagesEl),
  );
  const trigsEl = h('div.trigs', { 'data-testid': 'trigs' });
  const keys = [];
  for (let i = 0; i < 16; i++) {
    const led = h('div.led');
    const no = h('div.no', String(i + 1));
    const badges = h('div.badges');
    const k = h('button.trig', { 'data-testid': `trig-${i + 1}`, 'aria-label': `Step ${i + 1}` }, led, badges, no);
    k.addEventListener('click', (e) => actions.stepClick(store.ui.stepPage * 16 + i, { shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey }));
    k.addEventListener('contextmenu', (e) => { e.preventDefault(); actions.stepClick(store.ui.stepPage * 16 + i, { shift: true }); });
    k.addEventListener('dblclick', (e) => { e.preventDefault(); actions.selectOnly(store.ui.stepPage * 16 + i); });
    keys.push({ k, no, badges });
    trigsEl.append(k);
  }
  root.append(ctl, trigsEl);

  let lastPlayPage = -1;
  return {
    update() {
      const pat = store.pattern;
      const trackMode = pat.scaleMode === 'track';
      setText(pLen.v, String(pat.length));
      setText(pSpd.v, pat.speed);
      setText(pSwg.v, pat.swing + '%');
      scale.textContent = trackMode ? 'SCALE: TRACK' : 'SCALE: PATTERN';
      setClass(scale, 'on', trackMode);
      tLen.el.style.opacity = tSpd.el.style.opacity = trackMode ? '' : '0.35';
      setText(tLen.v, String(store.trackSeq().len));
      setText(tSpd.v, store.trackSeq().speed);
      setClass(follow, 'on', store.ui.followPage);
      const len = store.trackLength();
      const nPages = Math.ceil(len / 16);
      pageBtns.forEach((b, i) => { setClass(b, 'avail', i < nPages); setClass(b, 'cur', i === store.ui.stepPage); b.disabled = i >= nPages; });
      const steps = store.trackSeq().steps;
      keys.forEach(({ k, no, badges }, i) => {
        const s = store.ui.stepPage * 16 + i;
        const trig = steps[s];
        setClass(k, 'note', trig && trig.type === 'note');
        setClass(k, 'lock', trig && trig.type === 'lock');
        setClass(k, 'off', s >= len);
        setClass(k, 'sel', store.ui.selected.has(s));
        setClass(k, 'cursor', store.ui.recording && !audio.playing && store.ui.recCursor === s);
        setText(no, String(s + 1));
        const b = [];
        if (trig) {
          if (trig.cond) b.push('c');
          if (trig.locks && Object.keys(trig.locks).some((x) => !x.startsWith('trig.note'))) b.push('');
          if (trig.retrig) b.push('r');
          if (trig.micro) b.push('m');
        }
        const key = b.join(',');
        if (badges._k !== key) { badges._k = key; badges.replaceChildren(...b.map((c) => h('i' + (c ? '.' + c : '')))); }
        k.title = trig ? describeTrig(trig) : `Step ${s + 1}: click = trig · shift/right-click = select for p-locks · alt = lock trig · dbl = inspect`;
      });
    },
    frame() {
      const tel = audio.telemetry;
      const playing = tel[TEL.PLAYING] > 0.5;
      const cur = playing ? tel[TEL.STEP + store.ui.track] : -1;
      const playPage = cur >= 0 ? Math.floor(cur / 16) : -1;
      if (playing && store.ui.followPage && playPage >= 0 && playPage !== store.ui.stepPage && playPage !== lastPlayPage) {
        store.ui.stepPage = playPage;
        app.requestUpdate();
      }
      lastPlayPage = playPage;
      pageBtns.forEach((b, i) => setClass(b, 'play', i === playPage));
      keys.forEach(({ k }, i) => setClass(k, 'play', store.ui.stepPage * 16 + i === cur));
    },
  };
}

function describeTrig(t) {
  const parts = [t.type === 'note' ? 'NOTE TRIG' : 'LOCK TRIG'];
  if (t.locks) parts.push(Object.entries(t.locks).map(([k, v]) => `${k}=${v}`).join(' '));
  if (t.notes) parts.push('chord +' + t.notes.map(noteName).join(','));
  if (t.cond) parts.push('cond ' + t.cond);
  if (t.micro) parts.push('micro ' + t.micro);
  if (t.retrig) parts.push(`retrig ${t.retrig.rate}`);
  if (t.slide) parts.push('slide');
  return parts.join(' · ');
}

const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

// ============================================================== lower: keyboard / inspector
const KEYMAP = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
const KEYLABEL = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';'];
export { KEYMAP };

export function mountLower(app) {
  const { store, actions } = app;
  const root = $('#lower');
  const kb = buildKeyboard(app);
  const insp = h('div');
  root.append(kb.el, insp);
  let lastKey = '';
  return {
    update(kind) {
      const inspecting = store.ui.selected.size > 0;
      kb.el.style.display = inspecting ? 'none' : '';
      insp.style.display = inspecting ? '' : 'none';
      kb.update();
      if (inspecting) {
        const key = JSON.stringify([...store.ui.selected, store.ui.track, store.project.current]) + JSON.stringify(store.trackSeq().steps[[...store.ui.selected][0]] || null);
        if (key !== lastKey || kind === 'project') { lastKey = key; renderInspector(app, insp); }
      } else lastKey = '';
    },
  };
}

function buildKeyboard(app) {
  const { store, actions } = app;
  const octLcd = h('div.lcd'), velLcd = h('div.lcd');
  dragNumber(velLcd, (d) => store.setUI({ velocity: clampI(store.ui.velocity + d, 1, 127) }));
  const piano = h('div.piano', { 'data-testid': 'piano' });
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const keyEls = [];
  const octaves = 2;
  const nWhite = octaves * 7 + 1;
  let wi = 0;
  for (let o = 0; o <= octaves; o++) {
    for (let s = 0; s < 12; s++) {
      if (o === octaves && s > 0) break;
      const off = o * 12 + s;
      const isW = whites.includes(s);
      const label = KEYLABEL[off];
      const el = h(isW ? 'div.w' : 'div.b', { 'data-offset': off },
        isW ? h('span', '') : null, label ? h('kbd', label) : null);
      if (!isW) el.style.left = `calc(${(wi / nWhite) * 100}% - 1.8%)`;
      else wi++;
      const down = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el._note = store.ui.octave * 12 + off; actions.noteOn(el._note); el.classList.add('down'); };
      const up = () => { if (el._note != null) { actions.noteOff(el._note); el._note = null; el.classList.remove('down'); } };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      keyEls.push({ el, off, isW });
      piano.append(el);
    }
  }
  const el = h('div',
    h('h3', 'KEYBOARD', h('span.hint', 'play the selected track · A–; keys · Z/X octave · C/V velocity · R record · shift-click steps to p-lock')),
    h('div.kbd-bar',
      h('span.pick-label', 'OCT'),
      h('button.btn.small', { on: { click: () => store.setUI({ octave: Math.max(0, store.ui.octave - 1) }) } }, '−'), octLcd,
      h('button.btn.small', { on: { click: () => store.setUI({ octave: Math.min(9, store.ui.octave + 1) }) } }, '+'),
      h('span.pick-label', 'VEL'), velLcd),
    piano);
  return {
    el,
    update() {
      setText(octLcd, 'C' + (store.ui.octave - 1));
      setText(velLcd, String(store.ui.velocity));
      for (const k of keyEls) if (k.isW) { const sp = k.el.querySelector('span'); setText(sp, (k.off % 12 === 0) ? noteName(store.ui.octave * 12 + k.off) : ''); }
    },
    keyEls,
  };
}

function renderInspector(app, root) {
  const { store, actions } = app;
  const t = store.ui.track;
  const sel = [...store.ui.selected].sort((a, b) => a - b);
  const steps = store.trackSeq().steps;
  const ref = steps[sel[0]] || null;
  const snd = store.sound;
  const each = (fn) => actions.safe(() => store.dispatch(sel.map((step) => fn(step))));
  const patch = (p) => each((step) => ({ type: 'updateTrig', track: t, step, patch: p }));
  const lockv = (id) => (ref && ref.locks && id in ref.locks ? ref.locks[id] : snd.params[id]);

  const typeBtns = h('div.row',
    h('button.btn.small' + (ref && ref.type === 'note' ? '.on' : ''), { on: { click: () => each((step) => ({ type: 'setTrig', track: t, step, trig: { ...(steps[step] || {}), type: 'note' } })) } }, 'NOTE'),
    h('button.btn.small' + (ref && ref.type === 'lock' ? '.on' : ''), { on: { click: () => each((step) => ({ type: 'setTrig', track: t, step, trig: { ...(steps[step] || {}), type: 'lock' } })) } }, 'LOCK'),
    h('button.btn.small', { title: 'Delete trig(s)', on: { click: () => actions.clearSelectedSteps() } }, 'DEL'));

  const noteLcd = h('div.lcd', noteName(lockv('trig.note')));
  dragNumber(noteLcd, (d) => each((step) => ({ type: 'setLock', track: t, step, id: 'trig.note', value: clampI(+(((steps[step] || {}).locks || {})['trig.note'] ?? snd.params['trig.note']) + d, 0, 127) })), 8);

  const chord = h('div.row');
  (ref && ref.notes || []).forEach((n, i) => {
    const c = h('div.lcd', { style: { fontSize: '13px', padding: '3px 7px' } }, noteName(n));
    dragNumber(c, (d) => { const ns = [...ref.notes]; ns[i] = clampI(ns[i] + d, 0, 127); patch({ notes: ns }); }, 8);
    chord.append(c, h('button.btn.small', { title: 'Remove chord note', on: { click: () => { const ns = ref.notes.filter((_, j) => j !== i); patch({ notes: ns.length ? ns : null }); } } }, '×'));
  });
  if (!ref || !ref.notes || ref.notes.length < 3) {
    chord.append(h('button.btn.small', { title: 'Add chord note (+4 semitones)', on: { click: () => { const ns = [...((ref && ref.notes) || [])]; const root = +lockv('trig.note'); ns.push(clampI((ns.length ? ns[ns.length - 1] : root) + (ns.length % 2 ? 3 : 4), 0, 127)); patch({ notes: ns }); } } }, '+ NOTE'));
  }

  const velIn = h('input', { type: 'range', min: 1, max: 127, value: lockv('trig.vel'), on: { change: (e) => each((step) => ({ type: 'setLock', track: t, step, id: 'trig.vel', value: +e.target.value })) } });
  const lenSel = h('select.pick', { on: { change: (e) => each((step) => ({ type: 'setLock', track: t, step, id: 'trig.len', value: e.target.value === 'INF' ? 'INF' : +e.target.value })) } },
    ...LENGTHS.map((l) => h('option', { value: l, selected: String(lockv('trig.len')) === String(l) }, l === 'INF' ? '∞' : String(l))));
  const condSel = h('select.pick', { 'data-testid': 'cond-select', on: { change: (e) => patch({ cond: e.target.value || null }) } },
    h('option', { value: '' }, 'ALWAYS'), ...CONDITIONS.map((c) => h('option', { value: c, selected: ref && ref.cond === c }, c)));
  const micro = h('input', { type: 'range', min: -23, max: 23, value: (ref && ref.micro) || 0, on: { change: (e) => patch({ micro: +e.target.value || null }) } });
  const microV = h('span.pick-label', `${(ref && ref.micro) || 0}/24`);
  micro.addEventListener('input', () => { microV.textContent = `${micro.value}/24`; });
  const rt = ref && ref.retrig;
  const rtOn = h('button.btn.small' + (rt ? '.on' : ''), { on: { click: () => patch({ retrig: rt ? null : { rate: '1/16', len: 1, vel: 0 } }) } }, 'RETRIG');
  const rtRate = h('select.pick', { disabled: !rt, on: { change: (e) => patch({ retrig: { ...rt, rate: e.target.value } }) } }, ...RETRIG_RATES.map((r) => h('option', { value: r, selected: rt && rt.rate === r }, r)));
  const rtLen = h('select.pick', { disabled: !rt, on: { change: (e) => patch({ retrig: { ...rt, len: e.target.value === 'INF' ? 'INF' : +e.target.value } }) } }, ...LENGTHS.map((l) => h('option', { value: l, selected: rt && String(rt.len) === String(l) }, l === 'INF' ? '∞' : String(l))));
  const rtVel = h('input', { type: 'range', min: -128, max: 127, value: rt ? rt.vel : 0, disabled: !rt, on: { change: (e) => patch({ retrig: { ...rt, vel: +e.target.value } }) } });
  const slide = h('button.btn.small' + (ref && ref.slide ? '.on' : ''), { on: { click: () => patch({ slide: !(ref && ref.slide) || null }) } }, 'SLIDE');

  const locks = h('div.locks');
  const lk = (ref && ref.locks) || {};
  for (const [k, v] of Object.entries(lk)) {
    const def = getDef(k);
    locks.append(h('span.chip', `${def.label} ${def.type === 'dest' ? v : formatValue(def, v)}`, h('button', { title: `Remove lock ${k}`, on: { click: () => each((step) => ({ type: 'setLock', track: t, step, id: k, value: null })) } }, '×')));
  }
  if (!Object.keys(lk).length) locks.append(h('span.pick-label', 'NO LOCKS — turn any encoder to lock its value on the selected steps'));

  root.replaceChildren(
    h('h3', `STEP ${sel.map((s) => s + 1).join(', ')}`, h('span.hint', 'encoders now write parameter locks · Esc to deselect · Del to clear'),
      h('button.btn.small', { style: { marginLeft: 'auto' }, on: { click: () => actions.clearSelection() } }, 'DONE')),
    h('div.inspector',
      h('div.field', h('label', 'TRIG'), typeBtns),
      h('div.field', h('label', 'NOTE'), h('div.row', noteLcd, h('span.pick-label', 'drag'))),
      h('div.field', h('label', 'CHORD'), chord),
      h('div.field', h('label', 'VELOCITY'), velIn),
      h('div.field', h('label', 'LENGTH'), lenSel),
      h('div.field', h('label', 'CONDITION'), condSel),
      h('div.field', h('label', 'MICRO TIMING'), h('div.row', micro, microV)),
      h('div.field', h('label', 'RETRIG'), h('div.row', rtOn, rtRate)),
      h('div.field', h('label', 'RETRIG LEN / VEL'), h('div.row', rtLen, rtVel)),
      h('div.field', h('label', 'PORTAMENTO'), slide),
      locks,
    ));
  void toast;
}
