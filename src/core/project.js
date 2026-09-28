// Project data model: factories, ids, validation, migration.
// Pure module (no DOM / WebAudio). See docs/PROJECT_FORMAT.md.
//
// project = {
//   format: 'digitone-web', version: 1, name, tempo,
//   current: 'A01',                 // pattern being edited (and played when stopped)
//   patterns: { A01: Pattern, ... } // sparse; missing ids are empty
//   song: { rows: [{ pattern: 'A01', repeats: 1 }] },
//   mutes: bool[16], solos: bool[16]
// }
// Pattern = { name, length, speed, swing, scaleMode: 'pattern'|'track', kit, tracks: TrackSeq[16] }
// Kit = { name, sounds: Sound[16], fx: { [fxParamId]: value } }
// Sound = { name, machine, params: { [paramId]: jsonValue } }
// TrackSeq = { len, speed, steps: { [stepIndex]: Trig } }
// Trig = { type: 'note'|'lock', locks?: {id: value}, cond?, micro?, retrig?, notes?, slide? }

import {
  NUM_TRACKS, MAX_STEPS, SOUND_PARAMS, FX_PARAMS, MACHINES, SPEEDS, LENGTHS, CONDITIONS, RETRIG_RATES,
  paramMachine, getDef, normalize,
} from './params.js';

export const FORMAT = 'digitone-web';
export const VERSION = 1;
export const BANKS = 'ABCDEFGHIJKLMNOP'.split('');

export function patternId(bank, index) {
  return BANKS[bank] + String(index + 1).padStart(2, '0');
}
export function parsePatternId(id) {
  const m = /^([A-P])(\d\d)$/.exec(id || '');
  if (!m) return null;
  const i = +m[2] - 1;
  if (i < 0 || i > 15) return null;
  return { bank: BANKS.indexOf(m[1]), index: i };
}
export function assertPatternId(id) {
  if (!parsePatternId(id)) throw new Error(`Invalid pattern id "${id}" (expected A01..P16)`);
  return id;
}

export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

/** Default params for a machine: all non-machine params + that machine's params. */
export function defaultParams(machine) {
  const out = {};
  for (const p of SOUND_PARAMS) {
    const m = paramMachine(p.id);
    if (m === null || m === machine) out[p.id] = p.def;
  }
  return out;
}

export function defaultSound(machine = 'fmtone', name = 'INIT') {
  if (!MACHINES[machine]) throw new Error(`Unknown machine "${machine}". Valid: ${Object.keys(MACHINES).join(', ')}`);
  const params = defaultParams(machine);
  if (machine === 'fmdrum') {
    params['trig.voic'] = 1;
    params['amp.mode'] = 'AHD';
    params['amp.hld'] = 100; // FM DRUM shapes itself with body/noise envelopes
    params['amp.dec'] = 60;
  }
  return { name, machine, params };
}

export function defaultFx() {
  return Object.fromEntries(FX_PARAMS.map((p) => [p.id, p.def]));
}

export const DEFAULT_TRACK_MACHINES = [
  'fmdrum', 'fmdrum', 'fmdrum', 'fmdrum',
  'fmtone', 'fmtone', 'fmtone', 'fmtone',
  'wavetone', 'wavetone', 'wavetone', 'wavetone',
  'swarmer', 'swarmer', 'swarmer', 'swarmer',
];

export function defaultKit() {
  return {
    name: 'INIT KIT',
    sounds: DEFAULT_TRACK_MACHINES.map((m) => defaultSound(m)),
    fx: defaultFx(),
  };
}

export function emptyTrackSeq() {
  return { len: 16, speed: '1X', steps: {} };
}

export function emptyPattern(kit = defaultKit()) {
  return {
    name: '',
    length: 16,
    speed: '1X',
    swing: 50,
    scaleMode: 'pattern',
    kit: clone(kit),
    tracks: Array.from({ length: NUM_TRACKS }, emptyTrackSeq),
  };
}

export function newProject(name = 'UNTITLED') {
  return {
    format: FORMAT,
    version: VERSION,
    name,
    tempo: 120,
    current: 'A01',
    patterns: { A01: emptyPattern() },
    song: { rows: [{ pattern: 'A01', repeats: 1 }] },
    mutes: Array(NUM_TRACKS).fill(false),
    solos: Array(NUM_TRACKS).fill(false),
  };
}

/** Get a pattern, creating it (as an empty copy of the current kit) if missing. */
export function ensurePattern(project, id) {
  assertPatternId(id);
  if (!project.patterns[id]) {
    const src = project.patterns[project.current];
    project.patterns[id] = emptyPattern(src ? src.kit : defaultKit());
  }
  return project.patterns[id];
}

// ---------------------------------------------------------------------------
// Validation (used on import, loadProject, and by tests). Returns a list of
// human readable problems; empty == valid. `repair` fixes what it can.

export function validateTrig(trig, where = 'trig') {
  const errs = [];
  if (!trig || typeof trig !== 'object') return [`${where}: not an object`];
  if (trig.type !== 'note' && trig.type !== 'lock') errs.push(`${where}.type must be "note" or "lock"`);
  if (trig.locks) {
    for (const [k, v] of Object.entries(trig.locks)) {
      try {
        const d = getDef(k);
        if (!d.lock) errs.push(`${where}.locks: ${k} is not lockable`);
        normalize(d, v);
      } catch (e) { errs.push(`${where}.locks: ${e.message}`); }
    }
  }
  if (trig.cond != null && !CONDITIONS.includes(trig.cond)) errs.push(`${where}.cond invalid: ${trig.cond}`);
  if (trig.micro != null && !(Number.isFinite(trig.micro) && trig.micro >= -23 && trig.micro <= 23)) errs.push(`${where}.micro must be -23..23`);
  if (trig.retrig != null) {
    const r = trig.retrig;
    if (!RETRIG_RATES.includes(r.rate)) errs.push(`${where}.retrig.rate invalid: ${r.rate}`);
    if (!LENGTHS.includes(r.len)) errs.push(`${where}.retrig.len invalid: ${r.len}`);
    if (!(Number.isFinite(r.vel) && r.vel >= -128 && r.vel <= 127)) errs.push(`${where}.retrig.vel must be -128..127`);
  }
  if (trig.notes != null && !(Array.isArray(trig.notes) && trig.notes.length <= 3 && trig.notes.every((n) => Number.isInteger(n) && n >= 0 && n <= 127))) {
    errs.push(`${where}.notes must be up to 3 extra MIDI notes (0..127)`);
  }
  return errs;
}

export function validateSound(s, where = 'sound') {
  const errs = [];
  if (!s || !MACHINES[s.machine]) return [`${where}.machine invalid: ${s && s.machine}`];
  for (const [k, v] of Object.entries(s.params || {})) {
    try {
      const d = getDef(k);
      const m = paramMachine(k);
      if (m && m !== s.machine) errs.push(`${where}.params.${k} belongs to ${m}, not ${s.machine}`);
      normalize(d, v);
    } catch (e) { errs.push(`${where}.params: ${e.message}`); }
  }
  return errs;
}

export function validateProject(p) {
  const errs = [];
  if (!p || p.format !== FORMAT) errs.push(`format must be "${FORMAT}"`);
  if (!(p.tempo >= 30 && p.tempo <= 300)) errs.push('tempo must be 30..300');
  if (!p.patterns || typeof p.patterns !== 'object') return [...errs, 'patterns missing'];
  if (!p.patterns[p.current]) errs.push(`current pattern ${p.current} does not exist`);
  for (const [id, pat] of Object.entries(p.patterns)) {
    if (!parsePatternId(id)) { errs.push(`bad pattern id ${id}`); continue; }
    const w = `patterns.${id}`;
    if (!(pat.length >= 1 && pat.length <= MAX_STEPS)) errs.push(`${w}.length must be 1..128`);
    if (!SPEEDS.includes(pat.speed)) errs.push(`${w}.speed invalid`);
    if (!(pat.swing >= 50 && pat.swing <= 80)) errs.push(`${w}.swing must be 50..80`);
    if (!pat.kit || !Array.isArray(pat.kit.sounds) || pat.kit.sounds.length !== NUM_TRACKS) { errs.push(`${w}.kit.sounds must have 16 sounds`); continue; }
    pat.kit.sounds.forEach((s, t) => errs.push(...validateSound(s, `${w}.kit.sounds[${t}]`)));
    if (!Array.isArray(pat.tracks) || pat.tracks.length !== NUM_TRACKS) { errs.push(`${w}.tracks must have 16 entries`); continue; }
    pat.tracks.forEach((tr, t) => {
      if (!(tr.len >= 1 && tr.len <= MAX_STEPS)) errs.push(`${w}.tracks[${t}].len must be 1..128`);
      if (!SPEEDS.includes(tr.speed)) errs.push(`${w}.tracks[${t}].speed invalid`);
      for (const [s, trig] of Object.entries(tr.steps || {})) {
        if (!(+s >= 0 && +s < MAX_STEPS)) errs.push(`${w}.tracks[${t}].steps key ${s} out of range`);
        errs.push(...validateTrig(trig, `${w}.tracks[${t}].steps[${s}]`));
      }
    });
  }
  return errs;
}

/** Fill in any missing fields (forward-compat for older saves). Mutates & returns. */
export function migrateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('Project must be an object');
  p.format ??= FORMAT;
  p.version ??= VERSION;
  p.name ??= 'UNTITLED';
  p.tempo ??= 120;
  p.patterns ??= {};
  p.current ??= Object.keys(p.patterns)[0] || 'A01';
  if (!p.patterns[p.current]) p.patterns[p.current] = emptyPattern();
  p.song ??= { rows: [{ pattern: p.current, repeats: 1 }] };
  p.mutes ??= Array(NUM_TRACKS).fill(false);
  p.solos ??= Array(NUM_TRACKS).fill(false);
  for (const pat of Object.values(p.patterns)) {
    pat.name ??= '';
    pat.length ??= 16;
    pat.speed ??= '1X';
    pat.swing ??= 50;
    pat.scaleMode ??= 'pattern';
    pat.kit ??= defaultKit();
    pat.kit.fx = { ...defaultFx(), ...(pat.kit.fx || {}) };
    pat.kit.sounds = pat.kit.sounds.map((s) => ({ name: s.name || 'INIT', machine: s.machine, params: { ...defaultSound(s.machine).params, ...s.params } }));
    pat.tracks ??= [];
    for (let t = 0; t < NUM_TRACKS; t++) pat.tracks[t] = { ...emptyTrackSeq(), ...(pat.tracks[t] || {}) };
  }
  return p;
}
