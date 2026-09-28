// Host — the headless application runtime that every UI plugin plugs into.
//
//   store    project + UI state, undo/redo, persistence   (store.js)
//   audio    AudioContext + engine worklet + telemetry    (audio.js)
//   actions  user-level operations shared by all UIs      (actions.js)
//   files    export/import/render helpers
//   + computer keyboard, Web MIDI, window.dt API, render loop
//
// A UI plugin (see src/uis/README.md) is a module whose default export is
//   { id, name, description, css?: URL, mount(root, host) -> view }
// and view is
//   { update(kind, detail)   batched per animation frame after state changes
//     frame()                every frame (telemetry: playheads, meters)
//     onEvent?(kind, detail) immediately on each store event
//     command?(name, arg)    host->UI requests: 'open' <panel>, 'close',
//                            'escape', 'page' <PAGE>; return true if handled
//     selftest?(t)           UI-specific checks for dt.selftest()
//     unmount() }
// Views must only touch the project through host.store.dispatch / actions so
// that switching UIs never loses or forks state.

import { Store } from './store.js';
import { AudioBridge } from './audio.js';
import { Actions } from './actions.js';
import { installKeys } from './keys.js';
import { installApi } from './api.js';
import { toast } from './ui/dom.js';
import { UIS, DEFAULT_UI } from '../uis/index.js';
import { migrateProject, validateProject } from '../core/project.js';
import { TEL } from '../engine/engine.js';

const UI_KEY = 'webtone:ui';

export function createHost(root) {
  const store = new Store();
  const audio = new AudioBridge(store);
  const actions = new Actions(store, audio);
  const host = {
    store, audio, actions, root,
    uis: UIS,
    ui: null,        // active plugin descriptor
    view: null,      // active view instance
    midiStatus: null,
    toast,
  };

  // ---------------------------------------------------------------- render loop
  let dirty = true, dirtyKind = 'all', dirtyDetail = null;
  host.requestUpdate = (kind = 'ui', detail = null) => {
    if (!(dirty && dirtyKind === 'project')) { dirtyKind = kind; dirtyDetail = detail; }
    dirty = true;
  };
  store.subscribe((kind, detail) => {
    if (kind === 'error') { toast(detail.message, true); return; }
    if (host.view && host.view.onEvent) host.view.onEvent(kind, detail);
    if (kind === 'note') return;
    host.requestUpdate(kind, detail);
  });
  const loop = () => {
    const v = host.view;
    if (v) {
      try {
        if (dirty) { dirty = false; v.update(dirtyKind, dirtyDetail); }
        v.frame && v.frame();
      } catch (e) { console.error('[ui]', e); }
    }
    // rAF doesn't fire in hidden/background tabs; fall back to a timer so the
    // UI (and anything an agent inspects in the DOM) stays in sync.
    document.hidden ? setTimeout(loop, 100) : requestAnimationFrame(loop);
  };

  audio.onEvent = (ev) => {
    if (ev.type === 'pattern') {
      store.ui.playPattern = ev.id;
      // in song mode the edited pattern follows playback
      if (store.ui.songMode && store.project.current !== ev.id) store.dispatch({ type: 'selectPattern', id: ev.id }, { history: false });
    } else if (ev.type === 'transport') {
      store.ui.playPattern = ev.pattern;
      store.ui.playStartedAt = ev.playing ? audio.telemetry[TEL.TIME] : null; // engine seconds
    }
    host.requestUpdate('ui');
  };

  // ---------------------------------------------------------------- UI plugins
  let cssLink = null;
  let switching = Promise.resolve();
  // Serialized: overlapping switches (e.g. key repeat on `\`) run one at a time.
  host.useUI = (id) => (switching = switching.catch(() => {}).then(() => mountUI(id)));
  const mountUI = async (id) => {
    const desc = UIS.find((u) => u.id === id);
    if (!desc) throw new Error(`Unknown UI "${id}". Available: ${UIS.map((u) => u.id).join(', ')}`);
    const mod = (await desc.load()).default;
    if (host.view) { try { host.view.unmount(); } catch (e) { console.error(e); } }
    host.view = null;
    root.replaceChildren();
    if (cssLink) cssLink.remove();
    cssLink = null;
    if (mod.css) {
      cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = mod.css;
      const loaded = new Promise((r) => { cssLink.onload = cssLink.onerror = r; });
      document.head.append(cssLink);
      await loaded;
    }
    document.body.className = 'ui-' + id;
    store.ui.selected.clear();
    host.ui = desc;
    host.view = mod.mount(root, host);
    try { localStorage.setItem(UI_KEY, id); } catch {}
    host.requestUpdate('all');
    return id;
  };
  host.cycleUI = () => {
    const i = UIS.findIndex((u) => u.id === (host.ui && host.ui.id));
    return host.useUI(UIS[(i + 1) % UIS.length].id);
  };
  /** Ask the active UI to do something (open a panel, handle Escape...). */
  host.command = (name, arg) => !!(host.view && host.view.command && host.view.command(name, arg));

  // ---------------------------------------------------------------- power
  host.powerOn = async () => {
    try {
      await audio.start();
      const lat = audio.latencyInfo();
      toast(`ENGINE ONLINE · ${lat.sampleRate} Hz · ${lat.baseLatencyMs} ms base latency${lat.sharedTelemetry ? ' · SAB' : ''}`);
      host.requestUpdate('ui');
    } catch (e) {
      console.error(e);
      toast('Audio failed to start: ' + e.message, true);
      throw e;
    }
  };
  // Space / Enter as the very first key press counts as the power gesture.
  window.addEventListener('keydown', function first(e) {
    window.removeEventListener('keydown', first, true);
    if (!audio.ready && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); host.powerOn(); }
  }, true);

  // ---------------------------------------------------------------- MIDI
  host.enableMidi = async () => {
    if (!navigator.requestMIDIAccess) { toast('Web MIDI not supported in this browser', true); return; }
    try {
      const midi = await navigator.requestMIDIAccess();
      const hook = () => {
        let n = 0;
        for (const input of midi.inputs.values()) {
          n++;
          input.onmidimessage = (m) => {
            const [st, d1, d2] = m.data;
            const cmd = st & 0xf0;
            if (cmd === 0x90 && d2 > 0) actions.noteOn(d1, d2);
            else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) actions.noteOff(d1);
            else if (st === 0xfa) actions.play();
            else if (st === 0xfc) actions.stop();
          };
        }
        host.midiStatus = n ? `MIDI: ${n} INPUT${n > 1 ? 'S' : ''}` : 'MIDI: NO INPUTS';
        toast(host.midiStatus);
        host.requestUpdate('ui');
      };
      midi.onstatechange = hook;
      hook();
    } catch (e) { toast('MIDI access denied: ' + e.message, true); }
  };

  // ---------------------------------------------------------------- files
  host.files = {
    download(name, blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name.replace(/[^\w.-]+/g, '_');
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    exportProject() {
      host.files.download(`${store.project.name || 'project'}.webtone.json`, new Blob([JSON.stringify(store.project, null, 1)], { type: 'application/json' }));
    },
    /** Import a File/Blob containing project JSON. Throws with a readable message. */
    async importProject(file) {
      const p = migrateProject(JSON.parse(await file.text()));
      const errs = validateProject(p);
      if (errs.length) throw new Error(errs.slice(0, 3).join('; '));
      store.dispatch({ type: 'loadProject', project: p });
      return p;
    },
    /** Offline render with the real worklet, downloads a WAV, returns stats. */
    async renderWav(opts = {}) {
      const r = await audio.renderOffline(opts);
      host.files.download(`${store.project.name || 'render'}.wav`, r.wav);
      return r.stats;
    },
  };

  installKeys(host);
  installApi(host);
  window.addEventListener('beforeunload', () => store.saveNow());

  host.start = async () => {
    const q = new URLSearchParams(location.search).get('ui');
    let id = q || DEFAULT_UI;
    try { if (!q) id = localStorage.getItem(UI_KEY) || DEFAULT_UI; } catch {}
    if (!UIS.some((u) => u.id === id)) id = DEFAULT_UI;
    await host.useUI(id);
    loop();
  };
  return host;
}
