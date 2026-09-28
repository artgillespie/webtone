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
