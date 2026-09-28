#!/usr/bin/env node
// Offline render: project JSON (or the built-in demo) -> WAV + stats JSON.
//
//   node tools/render.mjs [--project file.json|demo|empty] [--seconds 8] [--bars N]
//                         [--pattern A01] [--song] [--out out.wav] [--sr 48000]
//                         [--cmds cmds.json] [--seed 1] [--json]
//
// --cmds applies an array of reducer commands before rendering (same format
// as window.dt.dispatch in the browser), making it easy for agents to test a
// change end-to-end without a browser.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Engine } from '../src/engine/engine.js';
import { encodeWav, analyze } from '../src/core/wav.js';
import { demoProject } from '../src/core/demo.js';
import { newProject } from '../src/core/project.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const src = opt('project', 'demo');
const project = src === 'demo' ? demoProject() : src === 'empty' ? newProject() : JSON.parse(readFileSync(src, 'utf8'));
const sr = +opt('sr', 48000);
const engine = new Engine({ sampleRate: sr, project, seed: +opt('seed', 1) });
const cmdsFile = opt('cmds', null);
if (cmdsFile) for (const c of JSON.parse(readFileSync(cmdsFile, 'utf8'))) engine.dispatch(c);
const pat = opt('pattern', null);
if (pat) engine.dispatch({ type: 'selectPattern', id: pat });
if (opt('song', false)) engine.setSongMode(true);
let seconds = +opt('seconds', 0);
const bars = +opt('bars', 0);
if (!seconds) seconds = bars ? (bars * 16 * 15) / engine.project.tempo : 8;

engine.logNotes = true;
engine.play();
const t0 = performance.now();
const { L, R } = engine.renderSeconds(seconds);
const ms = performance.now() - t0;
const stats = { ...analyze(L, R, sr), renderMs: Math.round(ms), realtimeFactor: +((seconds * 1000) / ms).toFixed(1), notes: engine.noteLog.filter((n) => n.kind === 'on').length };

const out = opt('out', 'out/render.wav');
if (out !== 'none') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodeWav(L, R, sr));
  stats.file = out;
}
console.log(opt('json', false) ? JSON.stringify(stats) : stats);
