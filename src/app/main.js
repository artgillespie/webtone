// Boot: wire store <-> audio <-> views, start the render loop.

import { Store } from './store.js';
import { AudioBridge } from './audio.js';
import { Actions } from './actions.js';
import { Screen } from './ui/screen.js';
import { mountHeader, mountTracks, mountEncoders, mountSequencer, mountLower, playingPatternId } from './ui/panel.js';
import { Overlays } from './ui/overlays.js';
import { installKeys } from './keys.js';
import { installApi } from './api.js';
import { toast } from './ui/dom.js';

const store = new Store();
const audio = new AudioBridge(store);
const actions = new Actions(store, audio);
const app = { store, audio, actions };
app.overlays = new Overlays(app);
app.screen = new Screen(document.getElementById('screen'), app);

const views = [mountHeader(app), mountTracks(app), mountEncoders(app), mountSequencer(app), mountLower(app)];

let dirty = true, dirtyKind = 'all', dirtyCh = null;
app.requestUpdate = (kind = 'ui', ch = null) => {
  if (!(dirty && dirtyKind === 'project')) { dirtyKind = kind; dirtyCh = ch; }
  dirty = true;
};
store.subscribe((kind, detail) => {
  if (kind === 'error') { toast(detail.message, true); return; }
  if (kind === 'note') return;
  app.requestUpdate(kind, detail);
  app.overlays.update(kind, detail);
});

audio.onEvent = (ev) => {
  if (ev.type === 'pattern') {
    store.ui.playPattern = ev.id;
    // in song mode the edited pattern follows playback
    if (store.ui.songMode && store.project.current !== ev.id) store.dispatch({ type: 'selectPattern', id: ev.id }, { history: false });
    app.requestUpdate('ui');
  } else if (ev.type === 'transport') {
    store.ui.playPattern = ev.pattern;
    app.requestUpdate('ui');
  }
};

function loop() {
  if (dirty) {
    dirty = false;
    for (const v of views) v.update(dirtyKind, dirtyCh);
  }
  for (const v of views) v.frame && v.frame();
  app.overlays.frame();
  app.screen.draw();
  schedule();
}
// rAF doesn't fire in hidden/background tabs; fall back to a timer so the UI
// (and anything an agent inspects in the DOM) stays in sync.
function schedule() { document.hidden ? setTimeout(loop, 100) : requestAnimationFrame(loop); }
schedule();

// ------------------------------------------------------------------ power
const boot = document.getElementById('boot');
app.powerOn = async () => {
  try {
    await audio.start();
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 600);
    const lat = audio.latencyInfo();
    toast(`ENGINE ONLINE · ${lat.sampleRate} Hz · ${lat.baseLatencyMs} ms base latency${lat.sharedTelemetry ? ' · SAB' : ''}`);
  } catch (e) {
    console.error(e);
    toast('Audio failed to start: ' + e.message, true);
    throw e;
  }
};
document.getElementById('power').addEventListener('click', () => app.powerOn());
// Any first key press also powers on (a user gesture).
window.addEventListener('keydown', function first(e) {
  if (!audio.ready && boot.isConnected && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); app.powerOn(); }
  window.removeEventListener('keydown', first, true);
}, true);

// ------------------------------------------------------------------ MIDI
app.midiStatus = null;
app.enableMidi = async () => {
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
      app.midiStatus = n ? `MIDI: ${n} INPUT${n > 1 ? 'S' : ''}` : 'MIDI: NO INPUTS';
      toast(app.midiStatus);
    };
    midi.onstatechange = hook;
    hook();
  } catch (e) { toast('MIDI access denied: ' + e.message, true); }
};

installKeys(app);
installApi(app);
window.addEventListener('beforeunload', () => store.saveNow());
window.__app = app; // debugging handle (prefer window.dt)
void playingPatternId;
