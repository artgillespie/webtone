# WEBTONE//

A retrofuture browser groovebox inspired by the **Elektron Digitone II**: 16
tracks, 16 voices, four synth machines, parameter-lock sequencing, and send
effects. All of it runs in a single AudioWorklet with no dependencies and no
build step.

```sh
npm start        # → http://localhost:8080, click POWER
npm test
```

## Features

* **Machines**
  * **FM TONE**: 4 operators, 8 algorithms, X/Y mix, harmonics, feedback, and operator envelopes.
  * **FM DRUM**: swept FM body with a wavefolder, noise/metal generator, and transient layer.
  * **WAVETONE**: two band-limited wavetable oscillators with phase distortion, ring/sync/PM modes, and noise.
  * **SWARMER**: a main oscillator plus six animated detuned oscillators.
* **Per track**
  * Filter machines: multimode, 4-pole ladder, legacy LP/HP, comb±, and EQ, plus a base-width filter.
  * Filter and amp envelopes.
  * Bit reduction, SRR and overdrive, each routable pre or post filter.
  * 3 tempo-synced LFOs with 7 waves and 5 trig modes.
  * Arpeggiator, portamento and legato.
  * Voice count, from mono up to 8 voices.
* **Sequencer**
  * 128 steps, with per-track length and speed.
  * Parameter locks and trigless lock trigs.
  * Trig conditions: FILL, PRE, NEI, 1ST, % and A:B.
  * Micro timing, retrigs, 4-note chords, slides and swing.
  * Live and step recording.
  * 256 patterns with a kit per pattern, and song mode.
* **FX**: ping-pong tape delay, FDN reverb, chorus, a compressor with track sidechain, and master drive.
* **Two interchangeable UIs** (press `\` or pick one in settings):
  * **CLASSIC**: a hardware-faithful panel with display, encoders and trig keys.
  * **MAGI**: a direct-manipulation command center in the style of 90s anime computer screens. Every parameter is a draggable readout, and envelopes, filter, LFOs and FM algorithm are edited on the graphs themselves.
  * UIs are plugins over a headless core, see [src/uis/README.md](src/uis/README.md).
* **Mixer, sound library and projects**: a mixer, factory and user sound libraries, JSON project import/export, and offline WAV rendering.
* **Input**: computer keyboard, on-screen piano and Web MIDI input.
* **Low latency**
  * The sequencer runs on the audio thread, so timing is sample-accurate.
  * `latencyHint: 'interactive'`.
  * SharedArrayBuffer telemetry.
  * Output device selection via `setSinkId`.

For development and automation (agents welcome), see **[AGENTS.md](AGENTS.md)** and the generated
**[docs/REFERENCE.md](docs/REFERENCE.md)**.

## License

[MIT](LICENSE) © 2026 Art Gillespie. Not affiliated with Elektron; "Digitone" is a trademark of Elektron Music Machines.
