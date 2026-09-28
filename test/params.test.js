import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOUND_PARAMS, FX_PARAMS, PARAM_INDEX, MACHINES, COMMON_PAGES, FX_PAGES, pagesFor, pageParams, toNum, toJson, normalize,
  getDef, formatValue, destinationsFor, paramMachine,
} from '../src/core/params.js';

test('param ids are unique across sound + fx registries', () => {
  const ids = [...SOUND_PARAMS, ...FX_PARAMS].map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every default normalizes to itself', () => {
  for (const p of [...SOUND_PARAMS, ...FX_PARAMS]) {
    assert.deepEqual(normalize(p, p.def), p.def, p.id);
  }
});

test('every page slot references a real param', () => {
  const check = (ids, where) => {
    assert.equal(ids.length, 8, `${where} must have 8 slots`);
    for (const id of ids) if (id) assert.ok(getDef(id), `${where}: ${id}`);
  };
  for (const [name, ids] of Object.entries(COMMON_PAGES)) check(ids, name);
  for (const [name, ids] of Object.entries(FX_PAGES)) check(ids, name);
  for (const m of Object.values(MACHINES)) for (const [name, ids] of Object.entries(m.pages)) {
    check(ids, `${m.id}.${name}`);
    for (const id of ids) if (id) assert.equal(paramMachine(id), m.id, `${id} on ${m.id} page`);
  }
});

test('pagesFor gives SYN3 only to machines that have one', () => {
  assert.ok(pagesFor('fmtone').includes('SYN3'));
  assert.ok(!pagesFor('swarmer').includes('SYN3'));
  assert.equal(pageParams('SYN1', 'nope'), null);
});

test('toNum/toJson round-trip for every param at min, max and default', () => {
  for (const p of SOUND_PARAMS) {
    if (p.type === 'dest') continue;
    for (const n of [p.min, p.max, toNum(p, p.def)]) {
      assert.equal(toNum(p, toJson(p, n)), n, `${p.id} @ ${n}`);
    }
  }
});

test('enum accepts option values, numeric strings and rejects junk', () => {
  const d = getDef('flt.mach');
  assert.equal(toNum(d, 'LP4'), 1);
  assert.throws(() => toNum(d, 'NOPE'), /valid/);
  const r = getDef('fmt.ratc');
  assert.equal(toJson(r, toNum(r, '0.5')), 0.5);
});

test('dest params only accept modulatable params', () => {
  const d = getDef('lfo1.dest');
  assert.equal(toNum(d, 'none'), -1);
  assert.equal(toNum(d, 'flt.frq'), PARAM_INDEX['flt.frq']);
  assert.throws(() => toNum(d, 'flt.mach'));
});

test('destinationsFor excludes other machines params', () => {
  const ids = destinationsFor('fmtone').map((p) => p.id);
  assert.ok(ids.includes('fmt.alev'));
  assert.ok(ids.includes('flt.frq'));
  assert.ok(!ids.includes('wav.wav1'));
});

test('unknown params give suggestions', () => {
  assert.throws(() => getDef('flt.freq'), /Did you mean: .*flt\.frq/);
});

test('formatValue produces strings for all defaults', () => {
  for (const p of [...SOUND_PARAMS, ...FX_PARAMS]) assert.equal(typeof formatValue(p, p.def), 'string', p.id);
  assert.equal(formatValue(getDef('trig.note'), 60), 'C4');
  assert.equal(formatValue(getDef('amp.pan'), -20), 'L20');
});
