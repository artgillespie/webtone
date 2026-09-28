// window.dt — the agent/automation API. Everything the UI can do is
// reachable here, with JSON in / JSON out and descriptive errors.
// Run `dt.help()` in the console for a tour.

import { COMMANDS } from '../core/commands.js';
import { SOUND_PARAMS, FX_PARAMS, MACHINES, COMMON_PAGES, FX_PAGES, PAGE_ORDER, pagesFor, pageParams, getDef, formatValue, CONDITIONS, noteName } from '../core/params.js';
import { PRESETS, presetSound } from '../core/presets.js';
import { clone, validateProject } from '../core/project.js';
import { TEL } from '../engine/engine.js';
import { playingPatternId } from './actions.js';

export function installApi(host) {
  const { store, actions, audio } = host;
  const needAudio = () => { if (!audio.ready) throw new Error('Audio engine not started — call await dt.power() (needs a user gesture in some browsers) or click POWER.'); };

  const dt = {
    version: 1,
    help() {
      const txt = `WEBTONE// agent API (window.dt)
  State
    dt.state()                      -> deep copy of the project JSON
    dt.ui()                         -> UI state {track, page, stepPage, selected[], ...}
    dt.pattern(id?)                 -> pattern JSON (current by default)
    dt.params(track?)               -> [{id,label,page,value,display,locked}] for a track sound
    dt.validate()                   -> [] or list of problems
  Change (all go through the reducer; see dt.describe().commands)
    dt.dispatch(cmd | cmd[])        -> change descriptor(s); throws on invalid input
    dt.undo(), dt.redo()
    dt.loadPreset(track, name)      -> load a factory sound (dt.presets() lists them)
  Transport / performance (needs audio)
    await dt.power()                -> start audio (if allowed)
    dt.play(), dt.stop(), dt.fill(on), dt.song(on)
    await dt.note(track, note, vel=100, ms=300)
    await dt.wait(ms)
    dt.telemetry()                  -> {playing, pattern, steps[], peaks[], cpu, voices, ...}
    await dt.status()               -> engine status (voices, events, ...)
    await dt.captureNotes(ms)       -> note on/off log from the audio thread for ms
  Render
    await dt.render({bars|seconds, pattern?, song?}) -> {stats, url} (offline, same engine)
  Verify
    await dt.selftest()             -> end-to-end UI/store/engine check (restores state)
  UI
    dt.uis(), await dt.useUI('magi')  -> list / switch UI plugins (also ?ui=<id>, the \\ key, settings)
    dt.select({track?, page?, stepPage?, steps?})  dt.open('mixer'|'patterns'|...)  dt.close()
  Introspection
    dt.describe()                   -> commands, machines, pages, params, conditions
`;
      console.log(txt);
      return txt;
    },
    describe() {
      return {
        commands: COMMANDS,
        machines: Object.fromEntries(Object.values(MACHINES).map((m) => [m.id, { name: m.name, about: m.about, pages: m.pages }])),
        commonPages: COMMON_PAGES,
        pageOrder: PAGE_ORDER,
        fxPages: FX_PAGES,
        soundParams: SOUND_PARAMS.map(pick),
        fxParams: FX_PARAMS.map(pick),
        conditions: CONDITIONS,
      };
    },
    state: () => clone(store.project),
    ui: () => ({ ...store.ui, selected: [...store.ui.selected] }),
    pattern: (id) => clone(store.project.patterns[id || store.project.current] || null),
    validate: () => validateProject(store.project),
    params(track = store.ui.track) {
      const snd = store.pattern.kit.sounds[track];
      const out = [];
      for (const page of pagesFor(snd.machine)) {
        for (const id of pageParams(page, snd.machine)) {
          if (!id) continue;
          const def = getDef(id);
          const { value, locked } = actions.displayValue(id, track);
          out.push({ id, label: def.label, name: def.name, page, value, display: def.type === 'dest' ? value : formatValue(def, value), locked, min: def.min, max: def.max, type: def.type, options: def.options });
        }
      }
      return out;
    },
    dispatch(cmd) { return store.dispatch(cmd); },
    undo: () => store.undo(),
    redo: () => store.redo(),
    presets: () => PRESETS.map((p) => ({ name: p.name, machine: p.machine, category: p.category })),
    loadPreset(track, name) { return store.dispatch({ type: 'loadSound', track, sound: presetSound(name) }); },
    async power() { await host.powerOn(); return audio.latencyInfo(); },
    play() { needAudio(); actions.play(); },
    stop() { needAudio(); actions.stop(); },
    fill(on = true) { actions.setFill(on); },
    song(on = true) { actions.setSongMode(on); },
    async note(track, note, vel = 100, ms = 300) {
      needAudio();
      audio.noteOn(track, note, vel);
      await dt.wait(ms);
      audio.noteOff(track, note);
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    telemetry() {
      const t = audio.telemetry;
      return {
        audio: audio.ready,
        playing: t[TEL.PLAYING] > 0.5,
        pattern: playingPatternId(t),
        masterStep: t[TEL.MASTER_STEP],
        patternLoop: t[TEL.PATTERN_LOOP],
        fill: t[TEL.FILL] > 0.5,
        songMode: t[TEL.SONG_MODE] > 0.5,
        songRow: t[TEL.SONG_ROW],
        steps: Array.from(t.subarray(TEL.STEP, TEL.STEP + 16)),
        peaks: Array.from(t.subarray(TEL.PEAK, TEL.PEAK + 16)).map((x) => +x.toFixed(4)),
        masterPeak: +t[TEL.MASTER_PEAK].toFixed(4),
        voices: t[TEL.VOICES],
        cpu: +t[TEL.CPU].toFixed(3),
        engineTime: +t[TEL.TIME].toFixed(3),
        compGainReductionDb: +t[TEL.COMP_GR].toFixed(2),
      };
    },
    async status() { needAudio(); return audio.query('status'); },
    async engineProject() { needAudio(); return audio.query('project'); },
    async captureNotes(ms = 2000) {
      needAudio();
      audio.setLog(true);
      await dt.wait(ms);
      const log = await audio.query('noteLog');
      audio.setLog(false);
      return log.map((n) => ({ ...n, name: noteName(n.note) }));
    },
    async render(opts = {}) {
      const r = await audio.renderOffline(opts);
      return { stats: r.stats, url: r.url };
    },
    select({ track, page, stepPage, steps } = {}) {
      if (track !== undefined) actions.selectTrack(track);
      if (page !== undefined) actions.selectPage(page);
      if (stepPage !== undefined) actions.setStepPage(stepPage);
      if (steps !== undefined) { store.ui.selected = new Set(steps); store.setUI({ selected: store.ui.selected }); }
      return dt.ui();
    },
    open: (name) => host.command('open', name),
    close: () => host.command('close'),
    uis: () => host.uis.map((u) => ({ id: u.id, name: u.name, description: u.description, active: !!host.ui && host.ui.id === u.id })),
    async useUI(id) { await host.useUI(id); return dt.uis(); },
    errors: () => [...audio.errors],
    about: () => ({ ...host.about }),
    /**
     * In-page end-to-end check of UI <-> store <-> engine wiring. Leaves the
     * project unchanged (uses undo). Returns { ok, results: [{name, ok, detail}] }.
     */
    async selftest() {
      const results = [];
      const check = async (name, fn) => {
        try { const detail = await fn(); results.push({ name, ok: true, detail }); }
        catch (e) { results.push({ name, ok: false, detail: e.message }); }
      };
      const assert = (c, msg) => { if (!c) throw new Error(msg); };
      const settle = () => dt.wait(150);
      const undoTo = store.past.length;
      const prevUi = { track: store.ui.track, page: store.ui.page, stepPage: store.ui.stepPage };
      await check('reducer: project valid', () => { const e = validateProject(store.project); assert(!e.length, e.join('; ')); });
      if (host.view && host.view.selftest) {
        await host.view.selftest({ check: (name, fn) => check(`ui[${host.ui.id}]: ${name}`, fn), assert, settle, host });
      } else results.push({ name: `ui[${host.ui && host.ui.id}]: no UI-specific selftest`, ok: true });
      if (audio.ready) {
        await check('engine: mirror matches store after edits', async () => {
          const ep = await audio.query('project');
          assert(JSON.stringify(ep.patterns[store.project.current]) === JSON.stringify(store.pattern), 'engine project differs from store');
        });
        await check('engine: plays and advances steps', async () => {
          const was = audio.playing;
          if (!was) actions.play();
          await dt.wait(600);
          const t = dt.telemetry();
          if (!was) actions.stop();
          assert(t.playing && t.steps[0] >= 0, 'not playing');
          return { step: t.steps[0], cpu: t.cpu };
        });
        await check('engine: live note produces audio', async () => {
          audio.noteOn(4, 48, 110);
          await dt.wait(250);
          const pk = dt.telemetry().peaks[4];
          audio.noteOff(4, 48);
          assert(pk > 0.001, 'peak ' + pk);
          return { peak: pk };
        });
      }
      while (store.past.length > undoTo) store.undo();
      dt.select({ ...prevUi, steps: [] });
      const ok = results.every((r) => r.ok);
      console[ok ? 'log' : 'error']('[selftest]', ok ? 'PASS' : 'FAIL', results);
      return { ok, results };
    },
    get store() { return store; },
    get audio() { return audio; },
  };
  window.dt = dt;
  return dt;
}

function pick(p) {
  const o = { id: p.id, label: p.label, name: p.name, type: p.type, min: p.min, max: p.max, default: p.def, lockable: p.lock, modulatable: p.mod };
  if (p.options) o.options = p.options;
  if (p.bipolar) o.bipolar = true;
  return o;
}
