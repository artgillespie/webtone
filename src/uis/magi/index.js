// MAGI UI plugin — a direct-manipulation "command center" styled after 90s
// anime computer displays (black glass, NERV-orange wireframes, green data,
// red alerts, heavy Mincho title cards, hazard stripes, the MAGI tri-panel).
//
// No knobs and no pages: every parameter of the selected track is on screen
// as a draggable readout (Gauge), and the graphs themselves are the controls.
// Everything flows through host.actions / host.store like any other UI.

import { h, setText, setClass, dragNumber } from '../../app/ui/dom.js';
import { MACHINES, FILTER_MACHINES, COMMON_PAGES, CONDITIONS, RETRIG_RATES, LENGTHS, getDef, formatValue, noteName, pageParams, SPEEDS } from '../../core/params.js';
import { TEL } from '../../engine/engine.js';
import { playingPatternId } from '../../app/actions.js';
import { KEYLABEL } from '../../app/keys.js';
import { Gauge, soundBinding, customBinding, gaugeGrid } from './gauge.js';
import { EnvEditor, FilterEditor, LfoView, AlgoView, Scope } from './graphs.js';
import { Matrix } from './matrix.js';
import { Modals } from './modals.js';

const JP = {
  SYNTH: '音源', FILTER: 'フィルター', AMP: '増幅器', FX: '効果', MOD: '変調', TRIG: '発音', SEQ: '配列', SCOPE: '波形監視',
  STEP: 'ステップ', KEYS: '鍵盤', MAGI: 'MAGI',
};

export default {
  id: 'magi',
  name: 'MAGI',
  css: new URL('./magi.css', import.meta.url).href,
  mount(root, host) { Gauge.store = host.store; return new MagiView(root, host); },
};

/** Segmented selector. */
function seg(options, get, set, { labels, testid } = {}) {
  const btns = options.map((o, i) => h('button.ev-seg-b', { 'data-value': o, on: { click: () => set(o) } }, labels ? labels[i] : String(o)));
  const el = h('div.ev-seg', { 'data-testid': testid }, ...btns);
  return { el, update() { const v = get(); btns.forEach((b, i) => setClass(b, 'on', options[i] === v)); } };
}

function panel(code, title, jp, ...body) {
  return h('section.ev-panel', { 'data-panel': code },
    h('header.ev-ph', h('b', title), h('span.ev-jp', jp), h('i.ev-code', `PNL-${code}`)), ...body);
}

class MagiView {
  constructor(root, host) {
    this.root = root;
    this.host = host;
    this.gauges = [];      // deck gauges (rebuilt per track/machine)
    this.staticGauges = []; // header/seq gauges
    this.graphs = [];
    this.updaters = [];    // small update fns (segments etc.)
    this.deckKey = '';
    this.inspKey = '';
    this.build();
  }

  // ================================================================ layout
  build() {
    const { host } = this;
    const { store, actions, audio } = host;
    this.app = h('div.ev-app');
    this.header = this.buildHeader();
    this.matrix = new Matrix(host);
    this.scope = new Scope(host, 'scope');
    this.deck = h('div.ev-deck', { 'data-testid': 'deck' });
    this.lower = h('div.ev-lower', { 'data-testid': 'lower' });
    this.magi = this.buildMagi();

    // sequencer controls
    const pages = h('div.ev-pages');
    this.pageBtns = Array.from({ length: 8 }, (_, i) => {
      const b = h('button.ev-pg', { 'data-testid': `stepPage-${i + 1}`, on: { click: () => actions.setStepPage(i) } }, `P${i + 1}`);
      pages.append(b);
      return b;
    });
    const follow = h('button.ev-btn.sm', { on: { click: () => store.setUI({ followPage: !store.ui.followPage }) } }, 'FOLLOW');
    const pLen = new Gauge(customBinding({ id: 'pat.length', label: 'LEN', name: 'Pattern length', type: 'num', min: 1, max: 128, int: true, def: 16 },
      () => store.pattern.length, (v) => actions.safe(() => store.dispatch({ type: 'setPattern', patch: { length: v } }, { coalesce: 'plen' }))), { cls: '.mini' });
    const pSpd = new Gauge(customBinding({ id: 'pat.speed', label: 'SPD', name: 'Pattern speed', type: 'enum', options: SPEEDS, min: 0, max: SPEEDS.length - 1, def: '1X' },
      () => store.pattern.speed, (v) => store.dispatch({ type: 'setPattern', patch: { speed: v } }, { coalesce: 'pspd' })), { cls: '.mini' });
    const pSwg = new Gauge(customBinding({ id: 'pat.swing', label: 'SWING', name: 'Swing %', type: 'num', min: 50, max: 80, int: true, def: 50 },
      () => store.pattern.swing, (v) => store.dispatch({ type: 'setPattern', patch: { swing: v } }, { coalesce: 'swing' })), { cls: '.mini' });
    const scale = seg(['pattern', 'track'], () => store.pattern.scaleMode, (v) => store.dispatch({ type: 'setPattern', patch: { scaleMode: v } }), { labels: ['PTN', 'TRK'] });
    const tLen = new Gauge(customBinding({ id: 'trk.len', label: 'T.LEN', name: 'Track length (TRK scale)', type: 'num', min: 1, max: 128, int: true, def: 16 },
      () => store.trackSeq().len, (v) => store.dispatch({ type: 'setTrackSeq', track: store.ui.track, len: v }, { coalesce: 'tlen' })), { cls: '.mini' });
    const tSpd = new Gauge(customBinding({ id: 'trk.speed', label: 'T.SPD', name: 'Track speed (TRK scale)', type: 'enum', options: SPEEDS, min: 0, max: SPEEDS.length - 1, def: '1X' },
      () => store.trackSeq().speed, (v) => store.dispatch({ type: 'setTrackSeq', track: store.ui.track, speed: v }, { coalesce: 'tspd' })), { cls: '.mini' });
    this.staticGauges.push(pLen, pSpd, pSwg, tLen, tSpd);
    this.updaters.push(() => {
      scale.update();
      setClass(follow, 'on', store.ui.followPage);
      const nPages = Math.ceil(store.trackLength() / 16);
      this.pageBtns.forEach((b, i) => { setClass(b, 'on', i === store.ui.stepPage); b.disabled = i >= nPages; });
      tLen.el.style.opacity = tSpd.el.style.opacity = store.pattern.scaleMode === 'track' ? '' : '0.3';
    });
    const seqCtl = h('div.ev-seqctl', pages, follow, pLen.el, pSpd.el, pSwg.el, h('span.ev-lbl', 'SCALE'), scale.el, tLen.el, tSpd.el,
      h('button.ev-btn.sm', { title: 'Rotate selected track left', on: { click: () => store.dispatch({ type: 'shiftTrack', track: store.ui.track, amount: -1 }) } }, '◀'),
      h('button.ev-btn.sm', { title: 'Rotate selected track right', on: { click: () => store.dispatch({ type: 'shiftTrack', track: store.ui.track, amount: 1 }) } }, '▶'),
      h('button.ev-btn.sm.warn', { title: 'Clear selected track', on: { click: () => store.dispatch({ type: 'clearTrack', track: store.ui.track }) } }, 'CLR'));

    const left = h('div.ev-left',
      panel('01', 'SEQUENCER', JP.SEQ, seqCtl, this.matrix.el),
      h('div.ev-left-bottom',
        panel('02', 'SYNC GRAPH', JP.SCOPE, h('div.ev-scope-box', this.scope.el), this.syncRatio = h('div.ev-ratio')),
        this.magi.el));
    const right = h('div.ev-right', this.deck, panel('09', 'STEP / KEYS', JP.STEP, this.lower));
    this.modalRoot = h('div');
    this.app.append(h('div.ev-hazard'), this.header.el, h('div.ev-main', left, right), this.modalRoot);
    this.root.append(this.app);
    this.modals = new Modals(this.host, this.modalRoot);
    if (!audio.ready) this.root.append(this.buildBoot());
  }

  buildHeader() {
    const { store, actions, audio } = this.host;
    const pat = h('div.ev-hb.click', { 'data-testid': 'pattern-lcd', title: 'Pattern select', on: { click: () => this.modals.open('patterns') } },
      h('label', 'パターン PATTERN'), this.patV = h('div.ev-big'), this.patN = h('small'));
    const tempo = h('div.ev-hb.drag', { 'data-testid': 'tempo', title: 'Tempo — drag / wheel (shift = fine)' }, h('label', 'テンポ TEMPO'), this.tempoV = h('div.ev-big'));
    dragNumber(tempo, (d, fine) => actions.nudgeTempo(d * (fine ? 0.1 : 1)), 4);
    const timer = h('div.ev-hb', h('label', '稼働時間 ACTIVE TIME'), this.timerV = h('div.ev-big.ev-timer', '00:00:00'));
    const b = (label, cls, testid, fn, title) => h('button.ev-btn' + cls, { 'data-testid': testid, title, on: { click: fn } }, label);
    this.playB = b('▶ PLAY', '.play', 'play', () => actions.togglePlay(), 'Play / stop (Space)');
    this.stopB = b('■ STOP', '', 'stop', () => actions.stop(), 'Stop (twice = panic)');
    this.recB = b('● REC', '.rec', 'rec', () => actions.toggleRecord(), 'Record (R)');
    this.fillB = b('FILL', '.sm', 'fill', () => actions.setFill(!store.ui.fill), 'Fill (hold `)');
    this.songB = b('SONG', '.sm', 'song-mode', () => actions.setSongMode(!store.ui.songMode), 'Song mode');
    const menu = [['PATTERNS', 'patterns'], ['SONG', 'song'], ['MIXER', 'mixer'], ['SOUNDS', 'sounds'], ['SYSTEM', 'system'], ['?', 'help']]
      .map(([l, k]) => b(l, '.sm.menu', 'menu-' + k, () => this.modals.open(k), l));
    this.recBanner = h('div.ev-alert', h('b', '録音中'), h('span', 'RECORDING'));
    const el = h('header.ev-header',
      h('div.ev-title', h('div.ev-logo', 'WEBTONE', h('span', '//')), h('div.ev-sub', '音響同期システム — SOUND SYNC SYSTEM')),
      pat, tempo, timer,
      h('div.ev-transport', this.stopB, this.playB, this.recB, this.fillB, this.songB),
      this.recBanner,
      h('div.ev-spacer'),
      h('div.ev-menu', b('↶', '.sm', 'undo', () => store.undo(), 'Undo'), b('↷', '.sm', 'redo', () => store.redo(), 'Redo'), ...menu));
    return {
      el,
      update: () => {
        const playing = audio.playing;
        const playId = playing && store.ui.playPattern ? store.ui.playPattern : store.project.current;
        setText(this.patV, playId + (playing && playId !== store.project.current ? ' ▸' + store.project.current : ''));
        setText(this.patN, store.pattern.name || '—');
        setText(this.tempoV, store.project.tempo.toFixed(1));
        setClass(this.recB, 'on', store.ui.recording);
        setClass(this.fillB, 'on', store.ui.fill);
        setClass(this.songB, 'on', store.ui.songMode);
        setClass(this.recBanner, 'on', store.ui.recording);
      },
    };
  }

  buildMagi() {
    const tile = (name, n) => {
      const st = h('div.ev-magi-st'), info = h('div.ev-magi-info');
      const el = h('div.ev-magi-tile', { 'data-testid': `magi-${name.toLowerCase()}` }, h('div.ev-magi-name', `${name}·${n}`), st, info);
      return { el, st, info };
    };
    const t = [tile('MELCHIOR', 1), tile('BALTHASAR', 2), tile('CASPER', 3)];
    const el = h('section.ev-magi', h('header.ev-ph', h('b', 'MAGI SYSTEM'), h('span.ev-jp', '審議中'), h('i.ev-code', 'PNL-03')),
      h('div.ev-magi-grid', ...t.map((x) => x.el)));
    return { el, tiles: t };
  }

  buildBoot() {
    const gate = h('div.ev-boot', { 'data-testid': 'boot' },
      h('div.ev-hazard'),
      h('div.ev-boot-card',
        h('div.ev-boot-jp', '起動待機中'),
        h('div.ev-boot-logo', 'WEBTONE', h('span', '//')),
        h('div.ev-boot-sub', 'SOUND SYNC SYSTEM — MAGI INTERFACE'),
        h('button.ev-boot-btn', { 'data-testid': 'power', on: { click: () => this.host.powerOn() } }, h('b', 'INITIATE'), h('span', '同期開始')),
        h('div.ev-boot-hint', 'CLICK OR PRESS SPACE TO START THE AUDIO ENGINE · \\ SWITCHES INTERFACE')),
      h('div.ev-hazard'));
    this.boot = gate;
    return gate;
  }

  // ================================================================ deck
  buildDeck() {
    const { host } = this;
    const { store, actions } = host;
    for (const g of this.graphs) g.destroy();
    this.gauges = []; this.graphs = []; this.deckUpdaters = [];
    const snd = store.sound;
    const t = store.ui.track;
    const grid = (ids, cls = '') => { const el = h('div.ev-grid' + cls); this.gauges.push(...gaugeGrid(host, ids, el)); return el; };
    const graph = (g) => { this.graphs.push(g); return g.el; };

    // title bar
    const name = h('input.ev-name', { value: snd.name, maxLength: 16, 'aria-label': 'Sound name', on: { change: (e) => store.dispatch({ type: 'renameSound', track: t, name: e.target.value.toUpperCase() }) } });
    const mach = seg(Object.keys(MACHINES), () => store.sound.machine, (m) => actions.setMachine(m), { labels: Object.values(MACHINES).map((m) => m.name), testid: 'machine-select' });
    this.deckUpdaters.push(mach.update);
    const title = h('div.ev-deck-title',
      h('div.ev-tnum', String(t + 1).padStart(2, '0')),
      h('div.ev-tmeta', h('label', `TRACK ${t + 1} // UNIT-${String(t + 1).padStart(2, '0')}`), name),
      mach.el,
      h('button.ev-btn.sm', { on: { click: () => this.modals.open('sounds') } }, 'PRESETS'));

    // synth panel
    const m = MACHINES[snd.machine];
    const synBody = h('div.ev-syn');
    if (snd.machine === 'fmtone') synBody.append(h('div.ev-algo-wrap', graph(new AlgoView(host, 'algo'))));
    const synGrids = h('div.ev-syn-grids');
    for (const [pg, ids] of Object.entries(m.pages)) synGrids.append(h('div.ev-sub-lbl', pg), grid(ids));
    synBody.append(synGrids);

    // filter panel
    const fmach = seg(FILTER_MACHINES, () => store.sound.params['flt.mach'], (v) => actions.setParam('flt.mach', v), { testid: 'filter-select' });
    this.deckUpdaters.push(fmach.update);
    const fltIds = [...COMMON_PAGES.FLTR1, ...COMMON_PAGES.FLTR2].filter((id) => id && id !== 'flt.mach');
    const filter = panel('04', 'FILTER', JP.FILTER, fmach.el,
      h('div.ev-graphs', graph(new FilterEditor(host, 'filter-graph')), graph(new EnvEditor(host, { atk: 'flt.atk', dec: 'flt.dec', sus: 'flt.sus', rel: 'flt.rel', depth: 'flt.env' }, 'filter-env'))),
      grid(fltIds));
    const amp = panel('05', 'AMP', JP.AMP,
      h('div.ev-graphs.one', graph(new EnvEditor(host, { atk: 'amp.atk', hld: 'amp.hld', dec: 'amp.dec', sus: 'amp.sus', rel: 'amp.rel', mode: 'amp.mode' }, 'amp-env'))),
      grid(COMMON_PAGES.AMP));
    const lfos = h('div.ev-lfos', ...[1, 2, 3].map((n) => h('div.ev-lfo-col', graph(new LfoView(host, n, `lfo${n}-graph`)), grid(COMMON_PAGES['LFO' + n], '.two'))));
    const mod = panel('06', 'MODULATION', JP.MOD, lfos);
    const fx = panel('07', 'FX', JP.FX, grid(COMMON_PAGES.FX, '.two'));
    const trig = panel('08', 'TRIG · ARP', JP.TRIG, grid(COMMON_PAGES.TRIG, '.two'), h('div.ev-sub-lbl', 'ARPEGGIATOR'), grid(COMMON_PAGES.ARP.filter(Boolean), '.two'));

    this.deck.replaceChildren(
      title,
      h('div.ev-deck-grid',
        panel('03', `SYNTH — ${m.name}`, JP.SYNTH, synBody),
        filter, amp, mod, h('div.ev-stack', fx, trig)));
  }

  // ================================================================ lower: inspector / keys
  buildLower() {
    const { store, actions } = this.host;
    this.lowerGauges = [];
    const sel = [...store.ui.selected].sort((a, b) => a - b);
    this.refreshLocks = null;
    if (!sel.length) { this.lower.replaceChildren(this.buildPiano()); return; }
    const t = store.ui.track;
    const steps = store.trackSeq().steps;
    const ref = steps[sel[0]] || null;
    const cur = () => store.trackSeq().steps[sel[0]] || {}; // always read fresh state
    const each = (fn) => actions.safe(() => store.dispatch(sel.map((step) => fn(step))));
    const patch = (p, coalesce) => actions.safe(() => store.dispatch(sel.map((step) => ({ type: 'updateTrig', track: t, step, patch: p })), coalesce ? { coalesce } : {}));
    const g = (b) => { const x = new Gauge(b, { cls: '.mini' }); this.lowerGauges.push(x); return x.el; };

    const type = h('div.ev-seg',
      h('button.ev-seg-b' + (ref && ref.type === 'note' ? '.on' : ''), { on: { click: () => each((s) => ({ type: 'setTrig', track: t, step: s, trig: { ...(steps[s] || {}), type: 'note' } })) } }, 'NOTE'),
      h('button.ev-seg-b' + (ref && ref.type === 'lock' ? '.on' : ''), { on: { click: () => each((s) => ({ type: 'setTrig', track: t, step: s, trig: { ...(steps[s] || {}), type: 'lock' } })) } }, 'LOCK'),
      h('button.ev-seg-b.warn', { on: { click: () => actions.clearSelectedSteps() } }, 'DELETE'));
    const chord = h('div.ev-chord');
    (ref && ref.notes || []).forEach((n, i) => {
      chord.append(g(customBinding({ id: 'chord' + i, label: `+NOTE ${i + 1}`, name: 'Chord note', type: 'num', min: 0, max: 127, int: true, fmt: 'note', def: 64 },
        () => (cur().notes || [])[i], (v) => { const ns = [...(cur().notes || [])]; ns[i] = v; patch({ notes: ns }, 'chord'); })));
      chord.append(h('button.ev-btn.sm', { on: { click: () => { const ns = (cur().notes || []).filter((_, j) => j !== i); patch({ notes: ns.length ? ns : null }); } } }, '×'));
    });
    if (!ref || !ref.notes || ref.notes.length < 3) chord.append(h('button.ev-btn.sm', { on: { click: () => {
      const ns = [...((ref && ref.notes) || [])];
      const root = +actions.displayValue('trig.note').value;
      ns.push(Math.min(127, (ns.length ? ns[ns.length - 1] : root) + (ns.length % 2 ? 3 : 4)));
      patch({ notes: ns });
    } } }, '+ CHORD NOTE'));
    const cond = h('select.ev-select', { 'data-testid': 'cond-select', on: { change: (e) => patch({ cond: e.target.value || null }) } },
      h('option', { value: '' }, 'ALWAYS'), ...CONDITIONS.map((c) => h('option', { value: c, selected: ref && ref.cond === c }, c)));
    const micro = g(customBinding({ id: 'micro', label: 'MICRO', name: 'Micro timing (1/24 step)', type: 'num', min: -23, max: 23, int: true, bipolar: true, def: 0 },
      () => cur().micro || 0, (v) => patch({ micro: v || null }, 'micro')));
    const rt = ref && ref.retrig;
    const rtOn = h('button.ev-btn.sm' + (rt ? '.on' : ''), { on: { click: () => patch({ retrig: rt ? null : { rate: '1/16', len: 1, vel: 0 } }) } }, 'RETRIG');
    const rtParts = rt ? [
      g(customBinding({ id: 'rt.rate', label: 'RATE', name: 'Retrig rate', type: 'enum', options: RETRIG_RATES, min: 0, max: RETRIG_RATES.length - 1, def: '1/16' }, () => cur().retrig.rate, (v) => patch({ retrig: { ...cur().retrig, rate: v } }, 'rt'))),
      g(customBinding({ id: 'rt.len', label: 'R.LEN', name: 'Retrig length', type: 'enum', options: LENGTHS, min: 0, max: LENGTHS.length - 1, def: 1 }, () => cur().retrig.len, (v) => patch({ retrig: { ...cur().retrig, len: v } }, 'rt'))),
      g(customBinding({ id: 'rt.vel', label: 'R.VEL', name: 'Retrig velocity curve', type: 'num', min: -128, max: 127, int: true, bipolar: true, def: 0 }, () => cur().retrig.vel, (v) => patch({ retrig: { ...cur().retrig, vel: v } }, 'rt'))),
    ] : [];
    const slide = h('button.ev-btn.sm' + (ref && ref.slide ? '.on' : ''), { on: { click: () => patch({ slide: !(ref && ref.slide) || null }) } }, 'SLIDE');
    const locks = h('div.ev-locks');
    this.refreshLocks = () => {
      const lk = cur().locks || {};
      const key = JSON.stringify(lk);
      if (key === locks._k) return;
      locks._k = key;
      locks.replaceChildren(...Object.entries(lk).map(([k, v]) => {
        const def = getDef(k);
        return h('span.ev-chip', `${def.label} ${def.type === 'dest' ? v : formatValue(def, v)}`,
          h('button', { title: 'Remove lock', on: { click: () => each((s) => ({ type: 'setLock', track: t, step: s, id: k, value: null })) } }, '×'));
      }));
      if (!Object.keys(lk).length) locks.append(h('span.ev-dim', 'NO P-LOCKS — DRAG ANY READOUT OR GRAPH ABOVE TO LOCK IT ON THESE STEPS'));
    };
    this.refreshLocks();
    this.lower.replaceChildren(
      h('div.ev-insp-head', h('b', `STEP ${sel.map((s) => s + 1).join(' · ')}`), h('span.ev-alert.on.small', h('b', 'P-LOCK'), h('span', 'ACTIVE')),
        h('button.ev-btn.sm', { style: { marginLeft: 'auto' }, on: { click: () => actions.clearSelection() } }, 'RELEASE [ESC]')),
      h('div.ev-insp',
        type,
        g(soundBinding(this.host, 'trig.note')), g(soundBinding(this.host, 'trig.vel')), g(soundBinding(this.host, 'trig.len')),
        h('div.ev-field', h('label', 'CONDITION'), cond),
        micro, rtOn, ...rtParts, slide),
      chord, locks);
  }

  buildPiano() {
    const { store, actions } = this.host;
    const keys = h('div.ev-piano', { 'data-testid': 'piano' });
    const whites = [0, 2, 4, 5, 7, 9, 11];
    for (let off = 0; off < 25; off++) {
      const isW = whites.includes(off % 12);
      const k = h('div.ev-key' + (isW ? '' : '.blk'), { 'data-offset': off }, h('span', off % 12 === 0 ? noteName(store.ui.octave * 12 + off) : KEYLABEL[off] || ''));
      const down = (e) => { e.preventDefault(); k.setPointerCapture?.(e.pointerId); k._n = store.ui.octave * 12 + off; actions.noteOn(k._n); k.classList.add('down'); };
      const up = () => { if (k._n != null) { actions.noteOff(k._n); k._n = null; k.classList.remove('down'); } };
      k.addEventListener('pointerdown', down); k.addEventListener('pointerup', up); k.addEventListener('pointerleave', up);
      keys.append(k);
    }
    const oct = h('div.ev-big.small', 'C' + (store.ui.octave - 1));
    const vel = h('div.ev-big.small', String(store.ui.velocity));
    dragNumber(vel, (d) => store.setUI({ velocity: Math.max(1, Math.min(127, store.ui.velocity + d)) }));
    return h('div.ev-keys-wrap',
      h('div.ev-keys-ctl',
        h('label', `${JP.KEYS} KEYS · TRACK ${store.ui.track + 1}`),
        h('div.ev-row', h('button.ev-btn.sm', { on: { click: () => store.setUI({ octave: Math.max(0, store.ui.octave - 1) }) } }, 'OCT −'), oct,
          h('button.ev-btn.sm', { on: { click: () => store.setUI({ octave: Math.min(9, store.ui.octave + 1) }) } }, 'OCT +')),
        h('div.ev-row', h('span.ev-lbl', 'VEL'), vel),
        h('div.ev-dim', 'A–; KEYS PLAY · Z/X OCT · R REC · MIDI IN')),
      keys);
  }

  // ================================================================ plugin interface
  update(kind, detail) {
    const { store } = this.host;
    const key = `${store.ui.track}|${store.sound.machine}|${store.project.current}`;
    if (key !== this.deckKey || (detail && detail.scope === 'all')) { this.deckKey = key; this.buildDeck(); }
    const sel = store.ui.selected;
    const ref = sel.size ? store.trackSeq().steps[[...sel].sort((a, b) => a - b)[0]] : null;
    // Rebuild only on structural changes so a gauge is never destroyed mid-drag.
    const struct = ref ? [ref.type, !!ref.retrig, (ref.notes || []).length, ref.cond || '', !!ref.slide].join('/') : 'empty';
    const ikey = `${[...sel].join(',')}|${store.ui.track}|${store.project.current}|${sel.size ? struct : store.ui.octave + ':' + store.ui.velocity}`;
    if (ikey !== this.inspKey) { this.inspKey = ikey; this.buildLower(); }
    for (const g of this.gauges) g.update();
    for (const g of this.staticGauges) g.update();
    for (const g of this.lowerGauges || []) g.update();
    if (this.refreshLocks) this.refreshLocks();
    for (const u of this.updaters) u();
    for (const u of this.deckUpdaters || []) u();
    for (const g of this.graphs) g.dirty = true;
    this.matrix.update();
    this.header.update();
    this.modals.update(kind, detail);
  }

  frame() {
    const { store, audio } = this.host;
    const tel = audio.telemetry;
    const playing = tel[TEL.PLAYING] > 0.5;
    this.matrix.frame();
    for (const g of this.graphs) g.draw();
    this.scope.draw();
    this.modals.frame();
    setClass(this.playB, 'on', playing);
    setText(this.syncRatio, `SYNC RATIO ${(Math.min(1, tel[TEL.MASTER_PEAK]) * 100).toFixed(1)}%`);
    // active time since play (engine clock)
    if (playing && store.ui.playStartedAt != null) {
      const s = Math.max(0, tel[TEL.TIME] - store.ui.playStartedAt);
      setText(this.timerV, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}:${String(Math.floor((s * 100) % 100)).padStart(2, '0')}`);
    }
    setClass(this.timerV, 'live', playing);
    // follow playhead page
    const cur = playing ? tel[TEL.STEP + store.ui.track] : -1;
    if (playing && store.ui.followPage && cur >= 0 && Math.floor(cur / 16) !== store.ui.stepPage) { store.ui.stepPage = Math.floor(cur / 16); this.host.requestUpdate('ui'); }
    this.pageBtns.forEach((b, i) => setClass(b, 'play', playing && Math.floor(cur / 16) === i));
    // MAGI tiles
    const [mel, bal, cas] = this.magi.tiles;
    const verdict = (tile, ok, stText, info, cls) => {
      setText(tile.st, stText); setText(tile.info, info);
      setClass(tile.el, 'ok', ok === true); setClass(tile.el, 'bad', ok === false); setClass(tile.el, 'wait', ok === null); void cls;
    };
    const lat = audio.ready ? audio.ctx : null;
    verdict(mel, audio.ready, audio.ready ? '承認' : '拒絶', audio.ready ? `AUDIO ${(lat.sampleRate / 1000).toFixed(1)}k · ${(lat.baseLatency * 1000).toFixed(1)}ms` : 'AUDIO OFFLINE');
    verdict(bal, playing ? true : null, playing ? '承認' : '待機', playing ? `RUN ${playingPatternId(tel)} · STEP ${(tel[TEL.MASTER_STEP] | 0) + 1}` : 'SEQUENCER STANDBY');
    const cpu = tel[TEL.CPU];
    verdict(cas, audio.ready ? cpu < 0.7 : null, !audio.ready ? '待機' : cpu < 0.7 ? '承認' : '拒絶', `DSP ${(cpu * 100).toFixed(0)}% · ${tel[TEL.VOICES] | 0}/16 V`);
    if (this.boot && audio.ready) { this.boot.classList.add('gone'); const b = this.boot; this.boot = null; setTimeout(() => b.remove(), 700); }
  }

  command(name, arg) {
    if (name === 'open') { this.modals.open(arg === 'project' ? 'system' : arg); return true; }
    if (name === 'close' || name === 'escape') return this.modals.close();
    if (name === 'page') {
      const code = { TRIG: '08', ARP: '08', SYN1: '03', SYN2: '03', SYN3: '03', FLTR1: '04', FLTR2: '04', AMP: '05', FX: '07', LFO: '06' }[arg];
      const el = code && this.deck.querySelector(`[data-panel="${code}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); el.classList.remove('ping'); void el.offsetWidth; el.classList.add('ping'); }
      return true;
    }
    return false;
  }

  async selftest({ check, assert, settle }) {
    const { store, actions } = this.host;
    const root = this.root;
    await check('matrix cell click toggles a trig', async () => {
      actions.selectTrack(15); actions.setStepPage(0); actions.clearSelection();
      await settle();
      const had = !!store.pattern.tracks[15].steps[0];
      const cell = root.querySelector('[data-testid="cell-16-1"]');
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointerup'));
      await settle();
      assert(!!store.pattern.tracks[15].steps[0] !== had, 'store not updated');
      assert(cell.classList.contains('n') !== had, 'cell class not updated');
    });
    await check('every page param has a live gauge in the deck', async () => {
      await settle();
      const ids = ['TRIG', 'SYN1', 'SYN2', 'SYN3', 'FLTR1', 'FLTR2', 'AMP', 'FX', 'LFO1', 'LFO2', 'LFO3', 'ARP']
        .flatMap((p) => pageParams(p, store.sound.machine) || []).filter((id) => id && id !== 'flt.mach');
      const missing = ids.filter((id) => !root.querySelector(`.ev-deck [data-param="${id}"]`));
      assert(!missing.length, 'missing gauges: ' + missing.join(', '));
      return { gauges: ids.length };
    });
    await check('gauge keyboard input on a selected step writes a p-lock', async () => {
      actions.selectOnly(0);
      await settle();
      root.querySelector('.ev-deck [data-param="amp.vol"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await settle();
      const t = store.pattern.tracks[15].steps[0];
      assert(t && t.locks && 'amp.vol' in t.locks, 'no amp.vol lock');
      assert(root.querySelector('.ev-deck [data-param="amp.vol"]').classList.contains('locked'), 'gauge not shown as locked');
      actions.clearSelection();
    });
    await check('graphs are drawn with nonzero size', async () => {
      await settle();
      for (const id of ['filter-graph', 'amp-env', 'filter-env', 'lfo1-graph', 'scope']) {
        const c = root.querySelector(`[data-testid="${id}"]`);
        assert(c && c.width > 20 && c.height > 20, `${id} missing or zero-size`);
      }
    });
  }

  unmount() {
    this.modals.close();
    for (const g of this.graphs) g.destroy();
    this.scope.destroy();
    this.matrix.destroy();
    this.root.replaceChildren();
  }
}
