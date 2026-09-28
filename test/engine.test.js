import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { newProject } from '../src/core/project.js';
import { demoProject } from '../src/core/demo.js';
import { analyze, windowRms } from '../src/core/wav.js';
import { SOUND_PARAMS, MACHINES, paramMachine, toJson } from '../src/core/params.js';
import { Rng } from '../src/engine/dsp.js';

const SR = 48000;
const STEP = 6000; // samples per 1/16 at 120 BPM, 48k

function mk(cmds = [], opts = {}) {
  const e = new Engine({ sampleRate: SR, project: newProject(), prewarm: false, ...opts });
  for (const c of cmds) e.dispatch(c);
  e.logNotes = true;
  return e;
}
const ons = (e, track) => e.noteLog.filter((n) => n.kind === 'on' && (track === undefined || n.track === track));

test('trigs fire sample-accurately at 120 BPM', () => {
  const e = mk([0, 4, 8, 12].map((step) => ({ type: 'toggleTrig', track: 0, step })));
  e.play();
  e.renderSeconds(2.01);
  assert.deepEqual(ons(e, 0).map((n) => n.time), [0, 4, 8, 12, 16, 20, 24, 28].map((s) => s * STEP).concat([32 * STEP]).filter((t) => t < 2.01 * SR));
});

test('note length produces note-off at the right time', () => {
  const e = mk([{ type: 'setTrig', track: 5, step: 0, trig: { type: 'note', locks: { 'trig.len': 2 } } }]);
  e.play();
  e.renderSeconds(0.5);
  const off = e.noteLog.find((n) => n.kind === 'off' && n.track === 5);
  assert.equal(off.time, 2 * STEP);
});

test('swing delays odd steps; micro timing shifts (incl. negative)', () => {
  const e = mk([
    { type: 'setPattern', patch: { swing: 75 } },
    { type: 'toggleTrig', track: 0, step: 1 },
    { type: 'setTrig', track: 1, step: 4, trig: { type: 'note', micro: -12 } },
    { type: 'setTrig', track: 2, step: 2, trig: { type: 'note', micro: 6 } },
  ]);
  e.play();
  e.renderSeconds(0.9);
  assert.equal(ons(e, 0)[0].time, STEP + STEP / 2);
  assert.equal(ons(e, 1)[0].time, 4 * STEP - STEP / 2);
  assert.equal(ons(e, 2)[0].time, 2 * STEP + STEP / 4);
});

test('retrigs: 1/32 over one step = 2 hits', () => {
  const e = mk([{ type: 'setTrig', track: 0, step: 0, trig: { type: 'note', retrig: { rate: '1/32', len: 1, vel: 0 } } }]);
  e.play();
  e.renderSeconds(0.1);
  assert.deepEqual(ons(e, 0).map((n) => n.time), [0, STEP / 2]);
});

test('conditions: A:B, FILL/!FILL, PRE, 1ST', () => {
  const e = mk([
    { type: 'setTrig', track: 0, step: 0, trig: { type: 'note', cond: '1:2' } },
    { type: 'setTrig', track: 1, step: 0, trig: { type: 'note', cond: 'FILL' } },
    { type: 'setTrig', track: 2, step: 0, trig: { type: 'note', cond: '!FILL' } },
    { type: 'setTrig', track: 0, step: 1, trig: { type: 'note', cond: 'PRE' } },
    { type: 'setTrig', track: 3, step: 0, trig: { type: 'note', cond: '1ST' } },
  ]);
  e.play();
  e.renderSeconds(4 * 16 * STEP / SR);
  const loops = (t) => ons(e, t).map((n) => Math.floor(n.time / (16 * STEP)));
  assert.deepEqual(loops(0), [0, 0, 2, 2], '1:2 fires on loops 0 and 2, PRE follows it');
  assert.deepEqual(loops(1), []);
  assert.deepEqual(loops(2), [0, 1, 2, 3]);
  assert.deepEqual(loops(3), [0]);
  e.setFill(true);
  e.renderSeconds(16 * STEP / SR);
  assert.equal(loops(1).length, 1);
});

test('percentage conditions are deterministic for a seed', () => {
  const run = () => {
    const e = mk([{ type: 'setTrig', track: 0, step: 0, trig: { type: 'note', cond: '50%' } }, { type: 'setPattern', patch: { length: 1 } }], { seed: 7 });
    e.play(); e.renderSeconds(64 * STEP / SR);
    return ons(e, 0).map((n) => n.time);
  };
  const a = run();
  assert.deepEqual(a, run());
  assert.ok(a.length > 16 && a.length < 48, `~50% of 64, got ${a.length}`);
});

test('track scale mode: per-track length and speed', () => {
  const e = mk([
    { type: 'setPattern', patch: { scaleMode: 'track', length: 16 } },
    { type: 'setTrackSeq', track: 0, len: 3 },
    { type: 'toggleTrig', track: 0, step: 0 },
    { type: 'setTrackSeq', track: 1, speed: '2X', len: 16 },
    { type: 'toggleTrig', track: 1, step: 8 },
  ]);
  e.play();
  e.renderSeconds(16 * STEP / SR);
  assert.deepEqual(ons(e, 0).map((n) => n.time / STEP), [0, 3, 6, 9, 12, 15]);
  assert.deepEqual(ons(e, 1).map((n) => n.time / STEP), [4, 12]);
});

test('pattern change is cued to the pattern boundary', () => {
  const e = mk([{ type: 'toggleTrig', track: 0, step: 0 }, { type: 'selectPattern', id: 'A02' }, { type: 'toggleTrig', track: 1, step: 0 }, { type: 'selectPattern', id: 'A01' }]);
  e.play();
  e.renderSeconds(4 * STEP / SR);
  e.dispatch({ type: 'selectPattern', id: 'A02' });
  assert.equal(e.playId, 'A01');
  e.renderSeconds(14 * STEP / SR);
  assert.equal(e.playId, 'A02');
  assert.deepEqual(ons(e).map((n) => [n.track, n.time / STEP]), [[0, 0], [1, 16]]);
  assert.ok(e.drainEvents().some((ev) => ev.type === 'pattern' && ev.id === 'A02'));
});

test('song mode follows rows and repeats', () => {
  const e = mk([
    { type: 'setPattern', patch: { length: 4 } }, { type: 'toggleTrig', track: 0, step: 0 },
    { type: 'selectPattern', id: 'B01' }, { type: 'setPattern', patch: { length: 4 } }, { type: 'toggleTrig', track: 1, step: 0 },
    { type: 'setSong', rows: [{ pattern: 'A01', repeats: 2 }, { pattern: 'B01', repeats: 1 }] },
  ]);
  e.setSongMode(true);
  e.play();
  e.renderSeconds(16 * STEP / SR);
  assert.deepEqual(ons(e).map((n) => n.track), [0, 0, 1, 0]);
});

test('mutes and solos silence trigs', () => {
  const e = mk([{ type: 'toggleTrig', track: 0, step: 0 }, { type: 'toggleTrig', track: 1, step: 0 }, { type: 'setMute', track: 0, muted: true }]);
  e.play(); e.renderSeconds(0.05);
  assert.deepEqual(ons(e).map((n) => n.track), [1]);
  e.dispatch({ type: 'setSolo', track: 0, solo: true });
  e.dispatch({ type: 'setMute', track: 0, muted: false });
  e.renderSeconds(16 * STEP / SR);
  assert.deepEqual(ons(e).map((n) => n.track), [1, 0]);
});

test('mono tracks use one voice; poly tracks respect VOIC', () => {
  const e = mk([
    { type: 'setParam', track: 4, id: 'trig.voic', value: 1 },
    { type: 'setTrig', track: 4, step: 0, trig: { type: 'note', notes: [64, 67] } },
    { type: 'setParam', track: 5, id: 'trig.voic', value: 2 },
    { type: 'setTrig', track: 5, step: 0, trig: { type: 'note', notes: [64, 67, 71] } },
  ]);
  e.play(); e.renderSeconds(0.01);
  const count = (t) => e.voices.filter((v) => v.active && v.track === t).length;
  assert.equal(count(4), 1);
  assert.equal(count(5), 2);
});

test('arpeggiator plays held chord notes at the arp rate', () => {
  const e = mk([
    { type: 'setParams', track: 5, params: { 'arp.mode': 'UP', 'arp.spd': '1', 'arp.rng': 1 } },
    { type: 'setTrig', track: 5, step: 0, trig: { type: 'note', locks: { 'trig.note': 60, 'trig.len': 8 }, notes: [64, 67] } },
  ]);
  e.play(); e.renderSeconds(8 * STEP / SR);
  const n = ons(e, 5);
  assert.deepEqual(n.map((x) => x.note), [60, 64, 67, 60, 64, 67, 60, 64]);
  assert.deepEqual(n.map((x) => x.time / STEP), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('live notes start and release voices', () => {
  const e = mk();
  e.liveNoteOn(5, 60, 100);
  const a = analyze(e.renderSeconds(0.2).L);
  assert.ok(a.peak > 0.01);
  e.liveNoteOff(5, 60);
  e.renderSeconds(3);
  assert.equal(e.voices.filter((v) => v.active).length, 0);
});

test('parameter locks change the sound of a single step', () => {
  const e = mk([
    { type: 'setParam', track: 5, id: 'amp.mode', value: 'AHD' },
    { type: 'setParam', track: 5, id: 'amp.dec', value: 30 },
    { type: 'toggleTrig', track: 5, step: 0 },
    { type: 'setTrig', track: 5, step: 4, trig: { type: 'note', locks: { 'amp.vol': 20 } } },
  ]);
  e.play();
  const { L } = e.renderSeconds(8 * STEP / SR);
  const a = windowRms(L, 0, 2000), b = windowRms(L, 4 * STEP, 2000);
  assert.ok(b < a * 0.2, `locked step should be much quieter (${a} vs ${b})`);
});

test('every machine renders finite, bounded, non-silent audio under random params', () => {
  const rng = new Rng(42);
  for (const machine of Object.keys(MACHINES)) {
    for (let iter = 0; iter < 6; iter++) {
      const e = mk([{ type: 'setMachine', track: 0, machine }]);
      const params = {};
      for (const p of SOUND_PARAMS) {
        const pm = paramMachine(p.id);
        if (p.type === 'dest' || (pm && pm !== machine) || p.id.startsWith('lfo') || p.id.startsWith('arp')) continue;
        if (iter === 0) continue; // defaults first
        params[p.id] = toJson(p, p.min + rng.next() * (p.max - p.min));
      }
      Object.assign(params, { 'amp.vol': 100, 'amp.atk': 0, 'amp.mode': 'ADSR', 'amp.sus': 127, 'trig.voic': 4, 'trig.vel': 110, 'flt.frq': 127, 'flt.mach': 'MULTI', 'flt.typ': 0, 'flt.base': 0, 'flt.wdth': 127 });
      if (machine === 'fmdrum') Object.assign(params, { 'fmd.blev': 127, 'fmd.bdec': 80 });
      if (machine === 'wavetone') Object.assign(params, { 'wav.lev1': 110 });
      e.dispatch({ type: 'setParams', track: 0, params });
      e.dispatch({ type: 'setTrig', track: 0, step: 0, trig: { type: 'note', notes: [67] } });
      e.play();
      const { L, R } = e.renderSeconds(0.3);
      const s = analyze(L, R);
      assert.equal(s.nonFinite, 0, `${machine} #${iter} produced NaN/Inf`);
      assert.ok(s.peak <= 1, `${machine} #${iter} peak ${s.peak}`);
      assert.ok(s.peak > 0.001, `${machine} #${iter} is silent (${JSON.stringify(params)})`);
    }
  }
});

test('all filter machines stay stable at max resonance', () => {
  for (const mach of ['MULTI', 'LP4', 'LEGACY', 'COMB-', 'COMB+', 'EQ']) {
    const e = mk([
      { type: 'setParams', track: 5, params: { 'flt.mach': mach, 'flt.res': 127, 'flt.frq': 60, 'flt.env': 63, 'flt.typ': 127 } },
      { type: 'setTrig', track: 5, step: 0, trig: { type: 'note', locks: { 'trig.len': 'INF' } } },
    ]);
    e.play();
    const s = analyze(e.renderSeconds(1).L);
    assert.equal(s.nonFinite, 0, mach);
    assert.ok(s.peak <= 1, mach);
  }
});

test('rendering is deterministic', () => {
  const r = () => {
    const e = new Engine({ sampleRate: SR, project: demoProject(), seed: 3 });
    e.play();
    return e.renderSeconds(2).L;
  };
  const a = r(), b = r();
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`sample ${i} differs`);
});

test('demo renders clean and faster than realtime', () => {
  const e = new Engine({ sampleRate: SR, project: demoProject() });
  e.play();
  const t0 = performance.now();
  const { L, R } = e.renderSeconds(4);
  const ms = performance.now() - t0;
  const s = analyze(L, R);
  assert.equal(s.nonFinite, 0);
  assert.ok(s.rmsDb > -30 && s.peak <= 1, JSON.stringify(s));
  assert.ok(Math.abs(s.dcOffset) < 0.01);
  assert.ok(ms < 4000 / 3, `render too slow: ${ms}ms for 4s`);
});

test('engine stays in sync with reducer state', () => {
  const e = mk();
  e.dispatch({ type: 'setParam', track: 3, id: 'amp.vol', value: 12 });
  assert.equal(e.trackP[3][SOUND_PARAMS.findIndex((p) => p.id === 'amp.vol')], 12);
  e.dispatch({ type: 'setFx', id: 'del.fb', value: 99 });
  assert.equal(e.project.patterns.A01.kit.fx['del.fb'], 99);
});
