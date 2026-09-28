# DEVLOG

Running log of development sessions on WEBTONE//.

---

## 2026-09-27 — Session 1: initial build

**What we built:** WEBTONE// is a zero-dependency browser groovebox modelled on the Elektron Digitone II.
- **Engine:** 16 tracks and 16 voices, with the FM TONE, FM DRUM, WAVETONE and SWARMER machines, plus filters, LFOs, arpeggiator and send FX. It runs in a single AudioWorklet with a sample-accurate sequencer.
- **Sequencer:** parameter locks, trig conditions, micro timing, retrigs, chords, song mode.
- **UI:** a retrofuture panel.
- **Agent tooling:** the `window.dt` API, a headless Node engine, tests, and render, bench and docs tools.

**Wall time:** about 1 h 21 min. That runs from when the project directory was created (15:41) to the final commit (17:02). This is inferred from timestamps, not tracked directly.

**Usage** (from `/usage`, Claude Max $200 plan):
- about 3% of the current session limit
- about 1% of the current weekly limit

**Token detail** (from the model's visible token budget counter): about **365k tokens** used during the session. The counter went from 15,000,000 to about 14,634,500 remaining. It covers context and output as the harness counts them. It is not a billing-exact figure, and cached versus uncached input isn't broken out.

**Output:**
- 2 commits (`b3012b9`, `86e5b50`)
- about 7.6k lines across 36 tracked files
- 40 Node tests, all passing
- `dt.selftest()` passing in Chrome

**Verification:**
- Chrome: engine boot, playback, p-locks through the UI, all overlays, offline WAV render and the self-test.
- Node: benchmarks show about 5–7% of one core at full 16-voice load.

**Known gaps / next ideas:**
- MIDI tracks and external audio input are not implemented.
- FM algorithms and parameter scaling are approximations of the hardware.
- Factory sounds were balanced by measurement only, not by ear.

---

## 2026-09-28 — Session 2: license, GitHub, swappable UIs + MAGI

**What we built:**
- **Housekeeping:** added the MIT license and published to https://github.com/artgillespie/webtone.
- **Decoupled UI:** split the app into a headless **host** (store, audio engine, actions, keys, MIDI, `dt` API, render loop) and swappable **UI plugins** (`src/uis/*`). You can switch at runtime with `\`, the settings panel, `?ui=`, or `dt.useUI()`.
- **Classic UI:** kept the original interface as the `classic` plugin.
- **New MAGI UI:** a direct-manipulation command center modelled on 90s anime computer displays.
  - All parameters of the selected track are visible at once as draggable readouts.
  - Editable graphs: envelopes, filter curve with a base-width band, LFO shapes and the FM algorithm.
  - A paintable 16×16 sequencer matrix.
  - MAGI status tiles, and windows for mixer, patterns, song, sounds and system.
- **Undo:** gesture-scoped undo (one drag = one undo step) in the store.

**Wall time:** about 35 min for the UI work (≈10:45 → 11:20), inferred from commit timestamps.

**Usage:** not yet recorded (add `/usage` figures here).
**Token detail** (from the model's visible token budget counter): about **146k tokens** for this request. It isn't billing-exact.

**Verification:**
- 44 Node tests, including new store undo/gesture tests.
- `dt.selftest()` passes under both UIs: core, engine and UI-specific checks.
- A real mouse drag on the MAGI filter graph changes FREQ/RESO and records a single undo step.
- UI switching fully swaps DOM, CSS and body class without touching project state.

**Known gaps / next ideas:**
- MAGI assumes a desktop-size viewport. Below 1280 px it stacks and scrolls.
- The classic knob drag still uses time-based undo coalescing instead of gestures.

### 2026-09-28 — Deployed

- **Live:** https://webtone.artgillespie.workers.dev
- **Hosting:** Cloudflare Workers static assets (`wrangler.jsonc`, `_headers`, `.assetsignore`), deployed with `npm run deploy`. Cloudflare's agent plugin (skills + MCP) is installed in Claude Code.
- **Verified live:**
  - COOP/COEP headers are served, and the page is `crossOriginIsolated`.
  - Dev files (`test/`, `tools/`, configs, `.git`) return 404.
  - `dt.selftest()` passes.
  - The offline render on the live origin matches the local render exactly (RMS −16.4 dB).
  - Realtime audio was not verified by automation, because a background tab gives no user gesture. Check it by hand.
