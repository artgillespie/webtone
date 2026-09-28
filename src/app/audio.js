// Audio bridge: AudioContext + the single AudioWorkletNode that hosts the
// entire engine (synthesis, sequencer, FX). Low-latency choices:
//   * latencyHint 'interactive' and one worklet node (no graph overhead)
//   * sequencer runs on the audio thread -> sample-accurate timing, no
//     main-thread jitter, no lookahead scheduling
//   * telemetry (playheads, meters, CPU) via SharedArrayBuffer when the page
//     is cross-origin isolated (tools/serve.mjs sets COOP/COEP), otherwise
//     via throttled postMessage
//   * output device selection via AudioContext.setSinkId when supported

import { TEL } from '../engine/engine.js';
import { analyze, encodeWav } from '../core/wav.js';
import { clone } from '../core/project.js';

const WORKLET_URL = new URL('../engine/worklet.js', import.meta.url);

export class AudioBridge {
  constructor(store) {
    this.store = store;
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.telemetry = new Float32Array(TEL.SIZE);
    this.shared = false;
    this.queries = new Map();
    this.qid = 0;
    this.errors = [];
    this.onEvent = null;
    this.ready = false;
  }

  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(WORKLET_URL);
    let sab = null;
    if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
      sab = new SharedArrayBuffer(TEL.SIZE * 4);
      this.telemetry = new Float32Array(sab);
      this.shared = true;
    }
    const node = new AudioWorkletNode(ctx, 'digitone-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { project: clone(this.store.project), telemetry: sab, seed: (Math.random() * 1e9) | 0 },
    });
    this.node = node;
    const readyP = new Promise((res) => { this._ready = res; });
    node.port.onmessage = (e) => this._onMessage(e.data);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    node.connect(ctx.destination);
    node.connect(analyser);
    this.analyser = analyser;
    this.scope = new Float32Array(analyser.fftSize);
    this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    this.store.engineSink = (cmd) => this.send({ kind: 'cmd', cmd });
    await ctx.resume();
    await readyP;
    this.ready = true;
  }

  _onMessage(m) {
    switch (m.kind) {
      case 'ready': this._ready && this._ready(); break;
      case 'telemetry': this.telemetry.set(m.data); break;
      case 'reply': { const r = this.queries.get(m.id); if (r) { this.queries.delete(m.id); r(m.data); } break; }
      case 'event': if (this.onEvent) this.onEvent(m.event); break;
      case 'error':
        this.errors.push({ at: Date.now(), message: m.message, cmd: m.cmd });
        if (this.errors.length > 50) this.errors.shift();
        console.error('[engine]', m.message, m.cmd);
        break;
    }
  }

  send(msg) { if (this.node) this.node.port.postMessage(msg); }

  query(what) {
    if (!this.node) return Promise.resolve(null);
    const id = ++this.qid;
    return new Promise((res) => { this.queries.set(id, res); this.send({ kind: 'query', id, what }); });
  }

  play() { this.send({ kind: 'transport', action: 'play' }); }
  stop() { this.send({ kind: 'transport', action: 'stop' }); }
  panic() { this.send({ kind: 'transport', action: 'panic' }); }
  noteOn(track, note, vel = 100) { this.send({ kind: 'note', on: true, track, note, vel }); }
  noteOff(track, note) { this.send({ kind: 'note', on: false, track, note }); }
  setFill(on) { this.send({ kind: 'fill', on }); }
  setSongMode(on) { this.send({ kind: 'songMode', on }); }
  setLog(on) { this.send({ kind: 'log', on }); }

  get playing() { return this.telemetry[TEL.PLAYING] > 0.5; }

  latencyInfo() {
    const c = this.ctx;
    if (!c) return null;
    return {
      sampleRate: c.sampleRate,
      baseLatencyMs: +(c.baseLatency * 1000).toFixed(2),
      outputLatencyMs: c.outputLatency ? +(c.outputLatency * 1000).toFixed(2) : null,
      renderQuantum: 128,
      sharedTelemetry: this.shared,
      cpu: +(this.telemetry[TEL.CPU] * 100).toFixed(1),
      playbackStats: c.playbackStats ? { ...c.playbackStats } : undefined,
    };
  }

  async setSink(deviceId) {
    if (!this.ctx || !this.ctx.setSinkId) throw new Error('setSinkId not supported in this browser');
    await this.ctx.setSinkId(deviceId);
  }

  /**
   * Render offline with the same worklet (bit-identical engine) and return
   * { stats, wav: Blob, url }. opts: { seconds, bars, pattern, song, project }
   */
  async renderOffline(opts = {}) {
    const project = clone(opts.project || this.store.project);
    if (opts.pattern) project.current = opts.pattern;
    const sr = opts.sampleRate || 48000;
    const seconds = opts.seconds || ((opts.bars || 4) * 16 * 15) / project.tempo;
    const frames = Math.ceil(seconds * sr);
    const off = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: sr });
    await off.audioWorklet.addModule(WORKLET_URL);
    const node = new AudioWorkletNode(off, 'digitone-engine', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { project, seed: opts.seed || 1, autoplay: true, songMode: !!opts.song },
    });
    node.connect(off.destination);
    const t0 = performance.now();
    const buf = await off.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const stats = { ...analyze(L, R, sr), renderMs: Math.round(performance.now() - t0) };
    const wav = new Blob([encodeWav(L, R, sr)], { type: 'audio/wav' });
    return { stats, wav, url: URL.createObjectURL(wav) };
  }
}
