#!/usr/bin/env node
// DSP benchmark: realtime factor per machine at full polyphony, plus the demo.
// Realtime factor = seconds of audio rendered per second of CPU. The browser
// budget is 1.0 on one core (the audio thread); aim to stay well above ~5.
//   node tools/bench.mjs [--seconds 5]

import { Engine } from '../src/engine/engine.js';
import { newProject } from '../src/core/project.js';
import { demoProject } from '../src/core/demo.js';
import { MACHINES } from '../src/core/params.js';

const i = process.argv.indexOf('--seconds');
const seconds = i > 0 ? +process.argv[i + 1] : 5;
const rows = [];

function run(label, engine) {
  engine.play();
  engine.renderSeconds(0.2); // warm-up / JIT
  const t0 = performance.now();
  engine.renderSeconds(seconds);
  const ms = performance.now() - t0;
  rows.push({ case: label, realtimeX: +((seconds * 1000) / ms).toFixed(1), audioThreadLoad: +((ms / (seconds * 1000)) * 100).toFixed(1) + '%' });
}

for (const m of Object.keys(MACHINES)) {
  const e = new Engine({ sampleRate: 48000, project: newProject() });
  for (let t = 0; t < 16; t++) {
    e.dispatch({ type: 'setMachine', track: t, machine: m });
    e.dispatch({ type: 'setParams', track: t, params: { 'amp.sus': 127, 'trig.voic': 1, 'flt.frq': 90, 'flt.res': 40 } });
    e.dispatch({ type: 'setTrig', track: t, step: 0, trig: { type: 'note', locks: { 'trig.len': 'INF', 'trig.note': 48 + t } } });
  }
  run(`16 voices ${MACHINES[m].name}`, e);
}
run('demo project', new Engine({ sampleRate: 48000, project: demoProject() }));
console.table(rows);
