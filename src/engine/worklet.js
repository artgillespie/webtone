// AudioWorkletProcessor wrapper around Engine. Thin by design: all logic
// lives in engine.js so it can be tested in Node.
//
// Messages in (port.postMessage from src/app/audio.js):
//   { kind: 'cmd', cmd }                       reducer command (see core/commands.js)
//   { kind: 'transport', action: 'play'|'stop'|'panic' }
//   { kind: 'note', on, track, note, vel }     live note
//   { kind: 'fill', on } | { kind: 'songMode', on } | { kind: 'log', on }
//   { kind: 'query', id, what: 'status'|'noteLog'|'project' }
// processorOptions: { project, seed, telemetry?: SharedArrayBuffer, autoplay?, songMode? }
// Messages out:
//   { kind: 'ready' } | { kind: 'event', event } | { kind: 'reply', id, data }
//   { kind: 'telemetry', data }  (only when no SharedArrayBuffer was supplied)
//   { kind: 'error', message, cmd }

import { Engine, TEL } from './engine.js';

class WebtoneProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.engine = new Engine({ sampleRate, project: o.project, seed: o.seed || 1 });
    this.shared = o.telemetry ? new Float32Array(o.telemetry) : null;
    // Offline renders start immediately (port messages could arrive too late).
    if (o.songMode) this.engine.setSongMode(true);
    if (o.autoplay) this.engine.play();
    this.blocks = 0;
    this.busy = 0;
    this.clock = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();
    this.port.onmessage = (e) => this.onMessage(e.data);
    this.port.postMessage({ kind: 'ready', sampleRate, shared: !!this.shared });
  }

  onMessage(m) {
    const e = this.engine;
    try {
      switch (m.kind) {
        case 'cmd': e.dispatch(m.cmd); break;
        case 'transport':
          if (m.action === 'play') e.play();
          else if (m.action === 'stop') e.stop();
          else if (m.action === 'panic') e.panic();
          break;
        case 'note': m.on ? e.liveNoteOn(m.track, m.note, m.vel ?? 100) : e.liveNoteOff(m.track, m.note); break;
        case 'fill': e.setFill(m.on); break;
        case 'songMode': e.setSongMode(m.on); break;
        case 'log': e.logNotes = !!m.on; if (!m.on) e.noteLog = []; break;
        case 'query': {
          let data = null;
          if (m.what === 'status') data = e.status();
          else if (m.what === 'noteLog') { data = e.noteLog.map((n) => ({ ...n, time: n.time / sampleRate })); e.noteLog = []; }
          else if (m.what === 'project') data = e.project;
          this.port.postMessage({ kind: 'reply', id: m.id, data });
          break;
        }
      }
    } catch (err) {
      this.port.postMessage({ kind: 'error', message: String(err && err.message || err), cmd: m.cmd });
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const t0 = this.clock();
    this.engine.process(L, R, L.length);
    const dt = this.clock() - t0;
    // CPU load estimate: smoothed ratio of processing time to block duration
    const budget = (L.length / sampleRate) * 1000;
    this.busy = this.busy * 0.97 + (dt / budget) * 0.03;
    const tel = this.engine.telemetry;
    tel[TEL.CPU] = this.busy;
    if (this.shared) this.shared.set(tel);
    else if ((this.blocks & 7) === 0) this.port.postMessage({ kind: 'telemetry', data: tel.slice() });
    const evs = this.engine.outbox;
    if (evs.length) for (const ev of this.engine.drainEvents()) this.port.postMessage({ kind: 'event', event: ev });
    this.blocks++;
    return true;
  }
}

registerProcessor('webtone-engine', WebtoneProcessor);
