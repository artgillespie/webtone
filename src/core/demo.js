// Demo project, built entirely through the public command API — so it also
// serves as a worked example of how to program the instrument from code.

import { newProject } from './project.js';
import { applyCommand } from './commands.js';
import { presetSound } from './presets.js';

export function demoProject() {
  const p = newProject('NIGHT DRIVE');
  const run = (cmd) => applyCommand(p, cmd);
  const trig = (track, step, extra = {}) => run({ type: 'setTrig', track, step, trig: { type: 'note', ...extra } });

  run({ type: 'setTempo', bpm: 122 });
  const kit = ['KICK DEEP', 'CLAPPY', 'CL HAT', 'OP HAT', 'FM BASS', 'E.PIANO', 'PLUCK', 'RIM', 'SWARM PAD', 'SNARE FM', 'VOX PAD', 'SAW LEAD', 'SUPERSAW', 'BELL', 'TOM LOW', 'COWBELL'];
  kit.forEach((name, track) => run({ type: 'loadSound', track, sound: presetSound(name) }));
  run({ type: 'setPattern', patch: { name: 'GROOVE', swing: 56 } });

  // kick: four on the floor, extra on fill
  for (const s of [0, 4, 8, 12]) trig(0, s);
  trig(0, 14, { cond: 'FILL' });
  // clap on 2 & 4, ghost roll on fill
  trig(1, 4); trig(1, 12);
  trig(1, 15, { cond: 'FILL', retrig: { rate: '1/32', len: 1, vel: -60 } });
  // closed hats with accent locks and a little randomness
  for (let s = 0; s < 16; s++) {
    if (s % 4 === 2) continue;
    const accent = s % 2 === 0;
    trig(2, s, { locks: { 'trig.vel': accent ? 104 : 64 }, ...(s % 4 === 3 ? { cond: '75%' } : {}), ...(s === 15 ? { micro: 6 } : {}) });
  }
  // open hats on the off-beats
  for (const s of [2, 6, 10, 14]) trig(3, s);
  // bass: A minor, slides and locks
  const bass = [[2, 45], [3, 45], [6, 45], [7, 48, { slide: true }], [10, 45], [11, 43], [14, 45], [15, 52, { cond: '1:2' }]];
  for (const [s, n, x = {}] of bass) trig(4, s, { locks: { 'trig.note': n, 'trig.len': 0.75, ...(s === 3 ? { 'flt.frq': 90 } : {}) }, ...x });
  // chords (up to 4 notes per trig)
  trig(5, 0, { locks: { 'trig.note': 57, 'trig.len': 6 }, notes: [60, 64, 67] });
  trig(5, 8, { locks: { 'trig.note': 53, 'trig.len': 6 }, notes: [57, 60, 64] });
  trig(5, 6, { type: 'lock', locks: { 'amp.vol': 56 } });
  run({ type: 'setParam', track: 5, id: 'amp.vol', value: 72 });
  // pluck arpeggio from a held chord
  run({ type: 'setParams', track: 6, params: { 'arp.mode': 'UP', 'arp.spd': '1', 'arp.rng': 2, 'arp.nlen': 0.5, 'amp.vol': 70, 'fx.del': 50 } });
  trig(6, 0, { locks: { 'trig.note': 69, 'trig.len': 16 }, notes: [72, 76] });
  // rim
  trig(7, 3); trig(7, 11, { cond: '1:2' }); trig(7, 13, { cond: '50%', locks: { 'fmd.tune': 81 } });
  // pad drone
  trig(8, 0, { locks: { 'trig.note': 45, 'trig.len': 16 }, notes: [52, 57] });
  run({ type: 'setParam', track: 8, id: 'amp.vol', value: 66 });

  // FX: dotted-eighth delay, longer reverb, gentle kick-keyed pump
  run({ type: 'setFx', id: 'del.time', value: 24 });
  run({ type: 'setFx', id: 'del.fb', value: 58 });
  run({ type: 'setFx', id: 'rev.dec', value: 84 });
  run({ type: 'setFx', id: 'cmp.scs', value: 'T1' });
  run({ type: 'setFx', id: 'cmp.thr', value: 96 });
  run({ type: 'setFx', id: 'cmp.rat', value: '2:1' });
  run({ type: 'setFx', id: 'cmp.rel', value: 40 });

  // A02: variation — busier hats and a different chord movement
  run({ type: 'copyPattern', from: 'A01', to: 'A02' });
  run({ type: 'selectPattern', id: 'A02' });
  run({ type: 'setPattern', patch: { name: 'LIFT' } });
  for (const s of [2, 6, 10, 14]) trig(2, s, { locks: { 'trig.vel': 50 }, retrig: s === 14 ? { rate: '1/32', len: 0.5, vel: 0 } : undefined });
  trig(5, 0, { locks: { 'trig.note': 55, 'trig.len': 6 }, notes: [59, 62, 65] });
  trig(5, 8, { locks: { 'trig.note': 52, 'trig.len': 6 }, notes: [55, 59, 64] });
  trig(9, 12, { cond: '1:2' });
  trig(12, 0, { locks: { 'trig.note': 69, 'trig.len': 3 } });
  trig(12, 3, { locks: { 'trig.note': 72, 'trig.len': 3 } });
  trig(12, 6, { locks: { 'trig.note': 76, 'trig.len': 4 } });
  run({ type: 'setParam', track: 12, id: 'amp.vol', value: 60 });
  run({ type: 'setParam', track: 12, id: 'fx.del', value: 60 });

  run({ type: 'selectPattern', id: 'A01' });
  run({ type: 'setSong', rows: [{ pattern: 'A01', repeats: 2 }, { pattern: 'A02', repeats: 2 }] });
  return p;
}
