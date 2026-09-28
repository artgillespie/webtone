import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/app/store.js';

// The store is UI-agnostic; it runs in Node (localStorage absent -> demo project).
const vol = (s) => s.project.patterns[s.project.current].kit.sounds[0].params['amp.vol'];

test('each plain dispatch is one undo step; undo/redo round-trips', () => {
  const s = new Store();
  const v0 = vol(s);
  s.dispatch({ type: 'setParam', track: 0, id: 'amp.vol', value: 10 });
  s.dispatch({ type: 'setParam', track: 0, id: 'amp.vol', value: 20 });
  assert.equal(s.past.length, 2);
  s.undo(); assert.equal(vol(s), 10);
  s.undo(); assert.equal(vol(s), v0);
  s.redo(); s.redo(); assert.equal(vol(s), 20);
});

test('a gesture groups any number of edits into one undo step', () => {
  const s = new Store();
  const v0 = vol(s);
  s.beginGesture();
  for (let v = 0; v < 50; v++) s.dispatch({ type: 'setParam', track: 0, id: 'amp.vol', value: v });
  s.dispatch({ type: 'setParam', track: 0, id: 'amp.pan', value: 10 });
  s.endGesture();
  assert.equal(s.past.length, 1);
  s.undo();
  assert.equal(vol(s), v0);
});

test('batches are one undo step and reach the engine sink in order', () => {
  const s = new Store();
  const seen = [];
  s.engineSink = (c) => seen.push(c.type);
  s.dispatch([{ type: 'toggleTrig', track: 9, step: 0 }, { type: 'toggleTrig', track: 9, step: 1 }]);
  assert.equal(s.past.length, 1);
  assert.deepEqual(seen, ['toggleTrig', 'toggleTrig']);
  s.undo();
  assert.equal(seen.at(-1), 'loadProject', 'undo resyncs the engine with the full project');
});
