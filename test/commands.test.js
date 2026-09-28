import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, COMMANDS } from '../src/core/commands.js';
import { newProject, validateProject, clone } from '../src/core/project.js';
import { demoProject } from '../src/core/demo.js';
import { presetSound, PRESETS } from '../src/core/presets.js';

const fresh = () => newProject();
const pat = (p) => p.patterns[p.current];

test('every documented command type is handled', () => {
  for (const type of Object.keys(COMMANDS)) {
    try { applyCommand(fresh(), { type }); } catch (e) { assert.doesNotMatch(e.message, /unknown command type/, type); }
  }
  assert.throws(() => applyCommand(fresh(), { type: 'bogus' }), /unknown command type/);
});

test('setParam validates track, id, machine and clamps value', () => {
  const p = fresh();
  applyCommand(p, { type: 'setParam', track: 4, id: 'flt.frq', value: 999 });
  assert.equal(pat(p).kit.sounds[4].params['flt.frq'], 127);
  assert.throws(() => applyCommand(p, { type: 'setParam', track: 16, id: 'flt.frq', value: 1 }), /track/);
  assert.throws(() => applyCommand(p, { type: 'setParam', track: 4, id: 'fmd.tune', value: 1 }), /belongs to machine fmdrum/);
  assert.throws(() => applyCommand(p, { type: 'setParam', track: 4, id: 'flt.freq', value: 1 }), /Did you mean/);
});

test('toggleTrig / setLock / clearing locks removes empty lock trigs', () => {
  const p = fresh();
  applyCommand(p, { type: 'toggleTrig', track: 0, step: 3 });
  assert.deepEqual(pat(p).tracks[0].steps[3], { type: 'note' });
  applyCommand(p, { type: 'toggleTrig', track: 0, step: 3 });
  assert.equal(pat(p).tracks[0].steps[3], undefined);
  applyCommand(p, { type: 'setLock', track: 0, step: 5, id: 'amp.vol', value: 50 });
  assert.deepEqual(pat(p).tracks[0].steps[5], { type: 'lock', locks: { 'amp.vol': 50 } });
  applyCommand(p, { type: 'setLock', track: 0, step: 5, id: 'amp.vol', value: null });
  assert.equal(pat(p).tracks[0].steps[5], undefined);
  assert.throws(() => applyCommand(p, { type: 'setLock', track: 0, step: 5, id: 'trig.voic', value: 2 }), /cannot be parameter-locked/);
});

test('updateTrig merges and validates', () => {
  const p = fresh();
  applyCommand(p, { type: 'updateTrig', track: 1, step: 0, patch: { cond: '1:2', micro: -5, locks: { 'trig.note': 64 } } });
  applyCommand(p, { type: 'updateTrig', track: 1, step: 0, patch: { retrig: { rate: '1/32', len: 1, vel: -40 }, micro: 0 } });
  assert.deepEqual(pat(p).tracks[1].steps[0], { type: 'note', cond: '1:2', locks: { 'trig.note': 64 }, retrig: { rate: '1/32', len: 1, vel: -40 } });
  assert.throws(() => applyCommand(p, { type: 'updateTrig', track: 1, step: 0, patch: { cond: 'SOMETIMES' } }), /cond invalid/);
  assert.throws(() => applyCommand(p, { type: 'updateTrig', track: 1, step: 0, patch: { micro: 40 } }), /micro/);
});

test('setMachine swaps params, keeps common ones, drops foreign locks and dests', () => {
  const p = fresh();
  applyCommand(p, { type: 'setParam', track: 5, id: 'flt.frq', value: 40 });
  applyCommand(p, { type: 'setParam', track: 5, id: 'lfo1.dest', value: 'fmt.alev' });
  applyCommand(p, { type: 'setLock', track: 5, step: 0, id: 'fmt.alev', value: 3 });
  applyCommand(p, { type: 'setMachine', track: 5, machine: 'swarmer' });
  const s = pat(p).kit.sounds[5];
  assert.equal(s.machine, 'swarmer');
  assert.equal(s.params['flt.frq'], 40);
  assert.equal(s.params['lfo1.dest'], 'none');
  assert.ok(!('fmt.alev' in s.params));
  assert.ok('swm.dtun' in s.params);
  assert.deepEqual(pat(p).tracks[5].steps[0].locks, {});
});

test('shiftTrack rotates within length', () => {
  const p = fresh();
  applyCommand(p, { type: 'toggleTrig', track: 0, step: 15 });
  applyCommand(p, { type: 'shiftTrack', track: 0, amount: 1 });
  assert.ok(pat(p).tracks[0].steps[0]);
  assert.equal(pat(p).tracks[0].steps[15], undefined);
});

test('pattern select creates from current kit; copy/clear', () => {
  const p = fresh();
  applyCommand(p, { type: 'setParam', track: 0, id: 'amp.vol', value: 33 });
  applyCommand(p, { type: 'toggleTrig', track: 0, step: 0 });
  applyCommand(p, { type: 'selectPattern', id: 'B05' });
  assert.equal(p.current, 'B05');
  assert.equal(pat(p).kit.sounds[0].params['amp.vol'], 33, 'kit inherited');
  assert.equal(Object.keys(pat(p).tracks[0].steps).length, 0, 'trigs not inherited');
  applyCommand(p, { type: 'copyPattern', from: 'A01', to: 'C01' });
  assert.ok(p.patterns.C01.tracks[0].steps[0]);
  applyCommand(p, { type: 'clearPattern', id: 'C01' });
  assert.equal(Object.keys(p.patterns.C01.tracks[0].steps).length, 0);
  assert.throws(() => applyCommand(p, { type: 'selectPattern', id: 'Q01' }), /Invalid pattern id/);
});

test('loadProject validates and replaces', () => {
  const p = fresh();
  const demo = demoProject();
  applyCommand(p, { type: 'loadProject', project: demo });
  assert.equal(p.name, demo.name);
  const bad = clone(demo); bad.patterns.A01.tracks[0].steps[0] = { type: 'weird' };
  assert.throws(() => applyCommand(p, { type: 'loadProject', project: bad }), /invalid project/);
});

test('demo project and all presets are valid', () => {
  assert.deepEqual(validateProject(demoProject()), []);
  const p = fresh();
  for (const pr of PRESETS) applyCommand(p, { type: 'loadSound', track: 0, sound: presetSound(pr.name) });
  assert.deepEqual(validateProject(p), []);
});

test('project survives JSON round-trip', () => {
  const d = demoProject();
  const back = JSON.parse(JSON.stringify(d));
  assert.deepEqual(back, d);
  assert.deepEqual(validateProject(back), []);
});
