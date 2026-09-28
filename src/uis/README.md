# UI plugins

A WEBTONE// UI is a swappable plugin on top of the headless host
(`src/app/host.js`). The host owns everything stateful: project/UI state,
undo, the audio engine, keyboard, MIDI, and the `window.dt` API. Switching UIs
therefore never touches the music.

Current plugins:

| id | name | idea |
|---|---|---|
| `classic` | CLASSIC | Hardware-faithful: display + 8 encoders + paged parameters + trig keys |
| `magi` | MAGI | Direct manipulation: every parameter, graph and step is editable in place |

Switch with the settings panel (CLASSIC: SETTINGS, MAGI: SYSTEM), the `\` key,
`?ui=<id>` in the URL, or `await dt.useUI('<id>')`. The choice persists in
`localStorage['webtone:ui']`.

## Contract

```js
// src/uis/<id>/index.js
export default {
  id: 'myui',
  name: 'MY UI',
  css: new URL('./myui.css', import.meta.url).href, // optional; loaded on mount, removed on unmount
  mount(root, host) {           // build DOM inside `root`
    return {
      update(kind, detail) {},  // batched once per frame after state changes
      frame() {},               // every frame: read host.audio.telemetry for playheads/meters
      onEvent(kind, detail) {}, // optional: immediate store events ('project'|'ui'|'note'|'transport')
      command(name, arg) {},    // optional: 'open' <panel> | 'close' | 'escape' | 'page' <PAGE>; return true if handled
      async selftest(t) {},     // optional: t = { check(name, fn), assert, settle, host } used by dt.selftest()
      unmount() {},             // remove listeners/observers; host clears `root`
    };
  },
};
```

Then register it in `src/uis/index.js`.

### What the host gives you

* `host.store`: `project`, `ui` (track, page, stepPage, selected Set, octave…),
  `dispatch(cmd | cmd[], {coalesce})`, `setUI(patch)`, `undo()/redo()`,
  `beginGesture()/endGesture()` (one undo step per drag), `trackLength()`, `sound`, `pattern`.
* `host.actions`: lock-aware `setParam(id, v, {track})`, `displayValue(id)` →
  `{value, locked}`, `setFx`, `stepClick`, `selectTrack`, `selectOnly`,
  `noteOn/Off` (with recording), `setMachine`, `loadSound`, `toggleMute/Solo`,
  `togglePlay`, `setFill`, `setSongMode`, `copySteps/pasteSteps`, …
* `host.audio`: `ready`, `telemetry` (Float32Array, layout `TEL` in
  `src/engine/engine.js`), `analyser` / `scope` / `spectrum` buffers, `latencyInfo()`.
* `host.files`: `exportProject()`, `importProject(file)`, `renderWav(opts)`.
* `host.powerOn()`, `host.enableMidi()`, `host.midiStatus`, `host.toast(msg, isErr)`,
  `host.uis`, `host.ui`, `host.useUI(id)`, `host.requestUpdate()`.

### Rules

* Never mutate `host.store.project` directly. Go through `dispatch` or `actions`
  so the audio worklet stays in sync.
* Put persistent UI preferences in `host.store.ui` if other UIs may care
  (selected track, octave…). Keep look-specific state inside the plugin.
* Scope global CSS to `body.ui-<id>`. The host sets that class, and your stylesheet
  is removed when another UI mounts.
* Show your own power gate when `!host.audio.ready` (any click calls `host.powerOn()`).
* Keep the DOM automation-friendly: `data-testid` on key controls,
  `role="slider"` + `data-param` on parameter controls, arrow-key support.
