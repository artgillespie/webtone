# AGENTS.md — working in WEBTONE//

A browser FM/wavetable groovebox modelled on the Elektron Digitone II. Plain ES
modules with **no build step and no runtime dependencies**. Node ≥ 20 is only
needed for tests and tools.

## Quick start

```sh
npm start            # http://localhost:8080 (COOP/COEP headers -> SharedArrayBuffer telemetry)
npm test             # node --test: reducer, sequencer timing, DSP fuzzing, determinism, docs freshness
npm run render -- --bars 4 --song --out out/demo.wav   # headless offline render + stats
node tools/tracks.mjs          # per-track level report (catch level/balance bugs without ears)
npm run bench                  # DSP realtime factor per machine
npm run describe               # regenerate docs/REFERENCE.md (params, pages, commands, presets)
```

In the browser console: `dt.help()`, `await dt.selftest()`.

## Architecture (one-way data flow)

```
            ┌──────────── src/core (pure: no DOM, no WebAudio) ────────────┐
            │ params.js   registry of every param (ids, ranges, pages, LFO) │
            │ project.js  data model, factories, validate/migrate           │
            │ commands.js applyCommand(project, cmd) — the ONLY mutation     │
            │ presets.js  factory sounds   demo.js demo project (via cmds)  │
            └───────────────────────────────────────────────────────────────┘
   UI (src/app)                                     Audio thread (src/engine)
   store.dispatch(cmd) ──applyCommand locally──►    worklet.js (thin wrapper)
          │                                          └ engine.js  Engine
          └── postMessage({kind:'cmd', cmd}) ──────►     applyCommand (same reducer)
                                                         sequencer (96 PPQN, sample-accurate)
   telemetry ◄── SharedArrayBuffer / postMessage ───     voices → FX → master
```

* **The reducer is shared.** Main thread and worklet each hold a copy of the
  project and apply the identical command stream, so they never drift. Never
  mutate `store.project` directly — always `store.dispatch`.
* **The engine is a plain object** (`new Engine({sampleRate, project, seed})`)
  with `dispatch`, `play/stop`, `liveNoteOn/Off`, `process(L, R, n)`. It runs
  unchanged in Node, which is how all DSP/sequencer tests work.
* **Deterministic.** Time only advances in `process()`, randomness comes from
  seeded `Rng`. Same project + seed + commands ⇒ bit-identical audio.
* Transport/performance messages (play, stop, fill, song mode, live notes) are
  *not* reducer commands; they're engine methods / worklet messages.

## File map

| path | what |
|---|---|
| `src/core/params.js` | Param registry, machines & page layouts, value mappings (`valueToHz`, `valueToTime`), JSON⇄numeric conversion |
| `src/core/commands.js` | Reducer + `COMMANDS` catalogue |
| `src/core/project.js` | Project/pattern/kit/trig model, `validateProject`, `migrateProject` |
| `src/engine/engine.js` | Sequencer, voice allocation, arpeggiator, LFOs, FX chain, telemetry (`TEL`) |
| `src/engine/voice.js` | Voice: machine → voice FX → filter → base-width → amp → pan/sends |
| `src/engine/machines/*.js` | `fmtone`, `fmdrum`, `wavetone`, `swarmer` |
| `src/engine/filters.js` | 6 filter machines (MULTI, LP4 ladder, LEGACY, COMB±, EQ) + base-width |
| `src/engine/fx.js` | Chorus, delay, FDN reverb, compressor (sidechain), master limiter |
| `src/engine/worklet.js` | AudioWorkletProcessor wrapper + message protocol |
| `src/app/store.js` | Main-thread state, undo/redo, autosave (localStorage) |
| `src/app/audio.js` | AudioContext, worklet node, telemetry, offline render |
| `src/app/actions.js` | User-level actions (lock-aware param edits, recording, copy/paste) |
| `src/app/api.js` | `window.dt` agent API |
| `src/app/ui/*` | Views: `panel.js` (header/tracks/encoders/sequencer/keyboard/inspector), `screen.js` (canvas display), `overlays.js`, `knob.js` |
| `tools/` | `serve`, `render`, `tracks`, `bench`, `describe` |
| `docs/REFERENCE.md` | Generated param/command reference (a test fails if stale) |

## The data model in one example

```js
dt.dispatch({ type: 'setTrig', track: 4, step: 2, trig: {
  type: 'note',                                  // or 'lock' (trigless p-lock)
  locks: { 'trig.note': 45, 'flt.frq': 90 },     // parameter locks (any lockable sound param)
  notes: [48, 52],                               // chord: up to 3 extra notes
  cond: '1:2',                                   // trig condition (see REFERENCE)
  micro: -6,                                     // micro timing in 1/24 step (-23..23)
  retrig: { rate: '1/32', len: 1, vel: -40 },    // ratchets
  slide: true,                                   // portamento into this note
}});
```

Tracks 0–15 (UI shows 1–16), steps 0–127. Enum params take their option value
(`'LP4'`, `1.5`, `'INF'`); LFO `*.dest` params take a param id string or `'none'`.
Sound params are per pattern (each pattern owns its kit, like the Digitone II);
mutes/solos/tempo/song are project-global.

## Verifying changes

1. `npm test` — must pass. Add tests next to what you change:
   * sequencer behaviour → `test/engine.test.js` (use `e.logNotes = true` and
     assert exact sample times in `e.noteLog`; 120 BPM @ 48 kHz = 6000 samples/step)
   * reducer/validation → `test/commands.test.js`
   * new params/pages → `test/params.test.js` checks integrity automatically
2. Audio sanity without ears: `node tools/render.mjs --json` and `node tools/tracks.mjs`
   (peak/RMS/zero-crossing "brightness", NaN count). The machine fuzz test renders
   random params for every machine and fails on NaN/silence/clipping.
3. In the browser: `await dt.selftest()` exercises DOM → store → engine wiring,
   `dt.telemetry()`, `await dt.captureNotes(2000)` (note log from the audio thread),
   `await dt.render({bars: 2})` (offline render with the real worklet).
   The UI keeps rendering in hidden tabs (timer fallback), so DOM state is inspectable.
   Stable selectors: `[data-testid=trig-1..16]`, `encoder-A..H`, `page-SYN1`, `track-1..16`,
   `menu-mixer`, `overlay-*`, `play`, `stop`, `rec`, `power`; knobs are ARIA sliders
   with `data-param` (arrow keys work).

## Recipes

**Add a sound parameter**: append a def in `params.js` (in the right group),
place it on a page (8 slots per page), read it in DSP via `PARAM_INDEX['id']`,
run `npm run describe`, add a test. Existing projects get the default through
`migrateProject`/`defaultParams` — never rename ids or reorder enum options.

**Add a machine**: add `MACHINES.<id>` with pages in `params.js` (param ids
prefixed, and map the prefix in `paramMachine`), implement a class with
`noteOn(p, vel, legato)`, `render(p, buf, n, note, vel)` and optional `silent()`
in `src/engine/machines/`, register it in `MACHINE_CLASSES` (`voice.js`), add
presets. The fuzz test automatically covers it.

**Add a command**: add a case to `applyCommand` and an entry to `COMMANDS`;
the engine picks it up through the change descriptor's `scope`
(`param|sound|fx|steps|pattern|current|all|…`). Update `Engine.dispatch` if a
new scope needs cache invalidation.

**Add an FX param**: append to `FX_PARAMS` (+ `FX_PAGES`), read with `FX_INDEX`.

## Invariants / gotchas

* `src/core` and `src/engine` must stay free of DOM/WebAudio APIs (they run in
  Node and in `AudioWorkletGlobalScope`). No allocation in per-sample loops.
* Engine hot paths use `Float32Array`s indexed by `PARAM_INDEX`; JSON values are
  converted with `toNum`/`toJson`.
* Voice output has −6 dB headroom and the master has a soft limiter above 0.8.
  Keep factory sounds roughly in −10…−16 dBFS peak per voice (`tools/tracks.mjs`).
* Negative micro timing is scheduled one step early; pattern changes happen at
  the master length boundary.
* The store autosaves to `localStorage['webtone:project']`; `dt.dispatch({type:'loadProject', project})`
  or PROJECT → DEMO resets.
