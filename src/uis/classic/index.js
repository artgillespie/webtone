// CLASSIC UI plugin — the hardware-faithful panel (display + 8 encoders +
// trig keys). Mounts into the host root; all state flows through the host.

import { Screen } from './screen.js';
import { mountHeader, mountTracks, mountEncoders, mountSequencer, mountLower } from './panel.js';
import { Overlays } from './overlays.js';

const SKELETON = `
  <div id="app" class="chassis" data-testid="app">
    <header id="header" class="header"></header>
    <div class="body">
      <aside id="tracks" class="tracks" aria-label="Tracks" data-testid="tracks"></aside>
      <main class="center">
        <section class="display-row">
          <div class="screen-bezel">
            <canvas id="screen" class="screen" data-testid="screen" aria-label="Display"></canvas>
            <div class="screen-glass"></div>
          </div>
          <div id="encoders" class="encoders" data-testid="encoders" aria-label="Parameter encoders"></div>
        </section>
        <nav id="pages" class="pages" aria-label="Parameter pages" data-testid="pages"></nav>
        <section id="lower" class="lower"></section>
      </main>
    </div>
    <footer id="sequencer" class="sequencer" data-testid="sequencer"></footer>
  </div>
  <div id="overlay-root"></div>
  <div id="boot" class="boot" data-testid="boot">
    <div class="boot-card">
      <div class="boot-logo">WEBTONE<span class="ii">//</span></div>
      <div class="boot-sub">FM · WAVETABLE · SWARM — 16 TRACK GROOVEBOX</div>
      <button id="power" class="power" data-testid="power" aria-label="Power on audio">
        <span class="power-ring"></span><span class="power-label">POWER</span>
      </button>
      <div class="boot-hint">Click to start the audio engine. Press <kbd>?</kbd> for shortcuts · <kbd>\\</kbd> switches UI.</div>
    </div>
  </div>`;

export default {
  id: 'classic',
  name: 'CLASSIC',
  css: new URL('./classic.css', import.meta.url).href,

  mount(root, host) {
    root.innerHTML = SKELETON;
    // `app` = host + this UI's own pieces (reads fall through to the host).
    const app = Object.create(host);
    app.overlays = new Overlays(app);
    app.screen = new Screen(root.querySelector('#screen'), app);
    const views = [mountHeader(app), mountTracks(app), mountEncoders(app), mountSequencer(app), mountLower(app)];

    const boot = root.querySelector('#boot');
    if (host.audio.ready) boot.remove();
    root.querySelector('#power').addEventListener('click', () => host.powerOn());

    return {
      update(kind, detail) { for (const v of views) v.update(kind, detail); },
      onEvent(kind, detail) { if (kind !== 'note') app.overlays.update(kind, detail); },
      frame() {
        for (const v of views) v.frame && v.frame();
        app.overlays.frame();
        app.screen.draw();
        if (host.audio.ready && boot.isConnected && !boot.classList.contains('gone')) {
          boot.classList.add('gone');
          setTimeout(() => boot.remove(), 600);
        }
      },
      command(name, arg) {
        if (name === 'open') { app.overlays.open(arg); return true; }
        if (name === 'close' || name === 'escape') {
          if (!app.overlays.current) return false;
          app.overlays.close();
          return true;
        }
        return false; // 'page' falls back to store.ui.page (this UI's paging model)
      },
      async selftest({ check, assert, settle }) {
        const { store } = host;
        await check('trig key click toggles a trig', async () => {
          host.actions.selectTrack(15); host.actions.setStepPage(0); host.actions.clearSelection();
          await settle();
          const had = !!store.pattern.tracks[15].steps[0];
          root.querySelector('[data-testid=trig-1]').click();
          await settle();
          assert(!!store.pattern.tracks[15].steps[0] !== had, 'store not updated');
          assert(root.querySelector('[data-testid=trig-1]').classList.contains('note') !== had, 'DOM not updated');
        });
        await check('encoder keyboard input writes a p-lock on a selected step', async () => {
          host.actions.selectPage('AMP'); host.actions.selectOnly(0);
          await settle();
          root.querySelector('[data-testid=encoder-H]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
          await settle();
          const t = store.pattern.tracks[15].steps[0];
          assert(t && t.locks && 'amp.vol' in t.locks, 'no amp.vol lock');
          host.actions.clearSelection();
        });
        await check('page buttons switch pages', async () => {
          root.querySelector('[data-testid=page-FLTR1]').click();
          await settle();
          assert(store.ui.page === 'FLTR1', 'page is ' + store.ui.page);
          assert(root.querySelector('[data-testid=encoder-E]').dataset.param === 'flt.frq', 'encoder E not bound to flt.frq');
        });
      },
      unmount() {
        app.overlays.close();
        app.screen.destroy();
        root.replaceChildren();
      },
    };
  },
};
