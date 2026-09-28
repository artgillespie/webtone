#!/usr/bin/env node
// Per-track level report: renders each track soloed (dry, FX returns included)
// and prints peak/RMS so level/balance problems are visible without ears.
//   node tools/tracks.mjs [--project file.json|demo] [--bars 2] [--pattern A01]
import { readFileSync } from 'node:fs';
import { Engine } from '../src/engine/engine.js';
import { analyze } from '../src/core/wav.js';
import { demoProject } from '../src/core/demo.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const src = opt('project', 'demo');
const project = src === 'demo' ? demoProject() : JSON.parse(readFileSync(src, 'utf8'));
const bars = +opt('bars', 2);
const rows = [];
for (let t = 0; t < 16; t++) {
  const e = new Engine({ sampleRate: 48000, project });
  if (opt('pattern')) e.dispatch({ type: 'selectPattern', id: opt('pattern') });
  const pat = e.project.patterns[e.project.current];
  if (!Object.keys(pat.tracks[t].steps).length) continue;
  e.dispatch({ type: 'setSolo', track: t, solo: true });
  e.play();
  const { L, R } = e.renderSeconds((bars * 16 * 15) / e.project.tempo);
  const s = analyze(L, R);
  rows.push({ track: t + 1, sound: pat.kit.sounds[t].name, machine: pat.kit.sounds[t].machine, peakDb: s.peakDb, rmsDb: s.rmsDb, zcHz: s.zeroCrossHz, nonFinite: s.nonFinite });
}
console.table(rows);
