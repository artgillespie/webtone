// Command reducer — the ONLY way project state changes.
//
// applyCommand(project, cmd) mutates `project` in place and returns a change
// descriptor { scope, pattern?, track?, id? } that consumers use to
// invalidate caches (the engine) or re-render (the UI).
//
// The same reducer runs on the main thread (store) and inside the audio
// worklet (engine), which keeps both copies of the project in lock-step: the
// store applies a command locally and posts the identical command to the
// worklet. Commands must therefore be deterministic and JSON-serialisable.
//
// Every command accepts an optional `pattern` (id like "B03"); default is
// project.current. Invalid commands throw an Error with a helpful message.

import { NUM_TRACKS, MAX_STEPS, SPEEDS, LENGTHS, CONDITIONS, RETRIG_RATES, MACHINES, getDef, normalize, PARAM_BY_ID, FX_BY_ID, paramMachine } from './params.js';
import { clone, ensurePattern, assertPatternId, defaultSound, emptyPattern, migrateProject, validateSound, validateTrig, validateProject } from './project.js';

/** Machine-readable command catalogue (also rendered into docs). */
export const COMMANDS = {
  setParam: { args: '{track, id, value}', doc: 'Set a sound parameter on a track of the current pattern kit.' },
  setParams: { args: '{track, params: {id: value}}', doc: 'Set several sound parameters at once.' },
  setMachine: { args: '{track, machine}', doc: 'Change a track\'s synth machine (fmtone|fmdrum|wavetone|swarmer). Resets machine params.' },
  loadSound: { args: '{track, sound}', doc: 'Replace a track sound with {name, machine, params}. Missing params get defaults.' },
  renameSound: { args: '{track, name}', doc: 'Rename a track sound.' },
  setFx: { args: '{id, value}', doc: 'Set a kit FX param (del.*, rev.*, cho.*, cmp.*, mst.*).' },
  toggleTrig: { args: '{track, step}', doc: 'Toggle a note trig on/off.' },
  setTrig: { args: '{track, step, trig|null}', doc: 'Replace a step\'s trig (null clears). trig = {type:"note"|"lock", locks?, cond?, micro?, retrig?, notes?, slide?}' },
  updateTrig: { args: '{track, step, patch}', doc: 'Merge fields into a trig (creates a note trig if empty). A null field deletes it.' },
  setLock: { args: '{track, step, id, value|null}', doc: 'Parameter-lock a value on a step (creates a lock trig if empty). null removes the lock.' },
  clearTrack: { args: '{track}', doc: 'Remove all trigs from a track.' },
  shiftTrack: { args: '{track, amount}', doc: 'Rotate a track\'s trigs by amount steps (within its length).' },
  copyTrack: { args: '{track, toTrack, toPattern?}', doc: 'Copy a track\'s trigs (and sound) to another track/pattern.' },
  setTrackSeq: { args: '{track, len?, speed?}', doc: 'Per-track length (1..128) / speed (used when scaleMode = "track").' },
  setPattern: { args: '{patch: {name?, length?, speed?, swing?, scaleMode?}}', doc: 'Edit pattern settings.' },
  selectPattern: { args: '{id}', doc: 'Make a pattern current (creates it if empty). While playing it is cued for the next pattern boundary.' },
  copyPattern: { args: '{from, to}', doc: 'Copy a whole pattern (trigs + kit).' },
  clearPattern: { args: '{id}', doc: 'Reset a pattern to empty (keeps its kit).' },
  setTempo: { args: '{bpm}', doc: 'Project tempo 30..300.' },
  setMute: { args: '{track, muted}', doc: 'Mute/unmute a track (project-global).' },
  setSolo: { args: '{track, solo}', doc: 'Solo/unsolo a track.' },
  setSong: { args: '{rows: [{pattern, repeats}]}', doc: 'Set the song arrangement.' },
  setProjectName: { args: '{name}', doc: 'Rename the project.' },
  loadProject: { args: '{project}', doc: 'Replace the whole project (validated + migrated).' },
};

const fail = (msg) => { throw new Error(msg); };

function trackIdx(t) {
  if (!Number.isInteger(t) || t < 0 || t >= NUM_TRACKS) fail(`track must be an integer 0..${NUM_TRACKS - 1} (got ${JSON.stringify(t)})`);
  return t;
}
function stepIdx(s) {
  if (!Number.isInteger(s) || s < 0 || s >= MAX_STEPS) fail(`step must be an integer 0..${MAX_STEPS - 1} (got ${JSON.stringify(s)})`);
  return s;
}

function soundParam(sound, id, value) {
  const def = PARAM_BY_ID[id];
  if (!def) getDef(id); // throws with suggestions
  if (!def) fail(`"${id}" is not a sound param`);
  const m = paramMachine(id);
  if (m && m !== sound.machine) fail(`${id} belongs to machine ${m}, but this track is ${sound.machine}`);
  return normalize(def, value);
}

/** Normalise a trig object (drop defaults / empties, canonicalise lock values). */
export function normalizeTrig(trig) {
  const errs = validateTrig(trig);
  if (errs.length) fail(errs.join('; '));
  const out = { type: trig.type };
  if (trig.locks && Object.keys(trig.locks).length) {
    out.locks = {};
    for (const [k, v] of Object.entries(trig.locks)) out.locks[k] = normalize(getDef(k), v);
  }
  if (trig.cond) out.cond = trig.cond;
  if (trig.micro) out.micro = Math.round(trig.micro);
  if (trig.retrig) out.retrig = { rate: trig.retrig.rate, len: trig.retrig.len, vel: Math.round(trig.retrig.vel) };
  if (trig.notes && trig.notes.length) out.notes = [...trig.notes];
  if (trig.slide) out.slide = true;
  return out;
}

export function applyCommand(project, cmd) {
  if (!cmd || typeof cmd.type !== 'string') fail('command must be an object with a string "type"');
  const pid = cmd.pattern ? assertPatternId(cmd.pattern) : project.current;
  const pat = () => ensurePattern(project, pid);

  switch (cmd.type) {
    case 'setParam': {
      const t = trackIdx(cmd.track);
      const s = pat().kit.sounds[t];
      s.params[cmd.id] = soundParam(s, cmd.id, cmd.value);
      return { scope: 'param', pattern: pid, track: t, id: cmd.id };
    }
    case 'setParams': {
      const t = trackIdx(cmd.track);
      const s = pat().kit.sounds[t];
      const next = {};
      for (const [k, v] of Object.entries(cmd.params || {})) next[k] = soundParam(s, k, v);
      Object.assign(s.params, next);
      return { scope: 'sound', pattern: pid, track: t };
    }
    case 'setMachine': {
      const t = trackIdx(cmd.track);
      if (!MACHINES[cmd.machine]) fail(`unknown machine "${cmd.machine}"; valid: ${Object.keys(MACHINES).join(', ')}`);
      const s = pat().kit.sounds[t];
      if (s.machine === cmd.machine) return { scope: 'none' };
      const fresh = defaultSound(cmd.machine);
      const kept = {};
      for (const [k, v] of Object.entries(s.params)) if (!paramMachine(k)) kept[k] = v;
      // keep common params (filter/amp/fx/lfo/trig) except machine-specific defaults
      s.machine = cmd.machine;
      s.params = { ...fresh.params, ...kept };
      for (const k of Object.keys(s.params)) if (paramMachine(k) && paramMachine(k) !== cmd.machine) delete s.params[k];
      for (const lfo of ['lfo1.dest', 'lfo2.dest', 'lfo3.dest']) {
        const d = s.params[lfo];
        if (d && d !== 'none' && paramMachine(d) && paramMachine(d) !== cmd.machine) s.params[lfo] = 'none';
      }
      // drop step locks that no longer apply
      for (const tr of [pat().tracks[t]]) for (const trig of Object.values(tr.steps)) {
        if (!trig.locks) continue;
        for (const k of Object.keys(trig.locks)) if (paramMachine(k) && paramMachine(k) !== cmd.machine) delete trig.locks[k];
      }
      return { scope: 'sound', pattern: pid, track: t };
    }
    case 'loadSound': {
      const t = trackIdx(cmd.track);
      const snd = cmd.sound;
      const errs = validateSound(snd);
      if (errs.length) fail(errs.join('; '));
      const base = defaultSound(snd.machine);
      const params = { ...base.params };
      for (const [k, v] of Object.entries(snd.params || {})) params[k] = normalize(getDef(k), v);
      pat().kit.sounds[t] = { name: String(snd.name || 'SOUND').slice(0, 16), machine: snd.machine, params };
      return { scope: 'sound', pattern: pid, track: t };
    }
    case 'renameSound': {
      const t = trackIdx(cmd.track);
      pat().kit.sounds[t].name = String(cmd.name).slice(0, 16);
      return { scope: 'meta', pattern: pid, track: t };
    }
    case 'setFx': {
      const def = FX_BY_ID[cmd.id];
      if (!def) getDef(cmd.id), fail(`"${cmd.id}" is not an FX param`);
      pat().kit.fx[cmd.id] = normalize(def, cmd.value);
      return { scope: 'fx', pattern: pid, id: cmd.id };
    }
    case 'toggleTrig': {
      const t = trackIdx(cmd.track), s = stepIdx(cmd.step);
      const steps = pat().tracks[t].steps;
      if (steps[s]) delete steps[s];
      else steps[s] = { type: 'note' };
      return { scope: 'steps', pattern: pid, track: t };
    }
    case 'setTrig': {
      const t = trackIdx(cmd.track), s = stepIdx(cmd.step);
      const steps = pat().tracks[t].steps;
      if (cmd.trig == null) delete steps[s];
      else steps[s] = normalizeTrig(cmd.trig);
      return { scope: 'steps', pattern: pid, track: t };
    }
    case 'updateTrig': {
      const t = trackIdx(cmd.track), s = stepIdx(cmd.step);
      const steps = pat().tracks[t].steps;
      const cur = steps[s] ? clone(steps[s]) : { type: 'note' };
      for (const [k, v] of Object.entries(cmd.patch || {})) {
        if (v === null || v === undefined || v === false || v === 0 && k === 'micro') delete cur[k];
        else if (k === 'locks') cur.locks = { ...(cur.locks || {}), ...v };
        else cur[k] = v;
      }
      steps[s] = normalizeTrig(cur);
      return { scope: 'steps', pattern: pid, track: t };
    }
    case 'setLock': {
      const t = trackIdx(cmd.track), s = stepIdx(cmd.step);
      const p = pat();
      const steps = p.tracks[t].steps;
      const def = getDef(cmd.id);
      if (!PARAM_BY_ID[cmd.id]) fail(`${cmd.id} is not a sound param (only sound params can be locked)`);
      if (!def.lock) fail(`${cmd.id} cannot be parameter-locked`);
      if (cmd.value === null || cmd.value === undefined) {
        const trig = steps[s];
        if (trig && trig.locks) {
          delete trig.locks[cmd.id];
          if (!Object.keys(trig.locks).length) {
            delete trig.locks;
            if (trig.type === 'lock') delete steps[s];
          }
        }
      } else {
        const v = soundParam(p.kit.sounds[t], cmd.id, cmd.value);
        const trig = steps[s] || (steps[s] = { type: 'lock' });
        (trig.locks ||= {})[cmd.id] = v;
      }
      return { scope: 'steps', pattern: pid, track: t };
    }
    case 'clearTrack': {
      const t = trackIdx(cmd.track);
      pat().tracks[t].steps = {};
      return { scope: 'steps', pattern: pid, track: t };
    }
    case 'shiftTrack': {
      const t = trackIdx(cmd.track);
      const p = pat();
      const tr = p.tracks[t];
      const len = p.scaleMode === 'track' ? tr.len : p.length;
      const amt = Math.round(cmd.amount || 0);
      const next = {};
      for (const [k, v] of Object.entries(tr.steps)) {
        const s = +k;
        if (s >= len) { next[s] = v; continue; }
        next[(((s + amt) % len) + len) % len] = v;
      }
      tr.steps = next;
      return { scope: 'steps', pattern: pid, track: t };
    }
    case 'copyTrack': {
      const t = trackIdx(cmd.track), to = trackIdx(cmd.toTrack);
      const src = pat();
      const dstId = cmd.toPattern ? assertPatternId(cmd.toPattern) : pid;
      const dst = ensurePattern(project, dstId);
      dst.tracks[to] = clone(src.tracks[t]);
      dst.kit.sounds[to] = clone(src.kit.sounds[t]);
      return { scope: 'pattern', pattern: dstId };
    }
    case 'setTrackSeq': {
      const t = trackIdx(cmd.track);
      const tr = pat().tracks[t];
      if (cmd.len != null) {
        if (!(Number.isInteger(cmd.len) && cmd.len >= 1 && cmd.len <= MAX_STEPS)) fail('len must be an integer 1..128');
        tr.len = cmd.len;
      }
      if (cmd.speed != null) {
        if (!SPEEDS.includes(cmd.speed)) fail(`speed must be one of ${SPEEDS.join(', ')}`);
        tr.speed = cmd.speed;
      }
      return { scope: 'pattern', pattern: pid };
    }
    case 'setPattern': {
      const p = pat();
      const patch = cmd.patch || {};
      if (patch.name != null) p.name = String(patch.name).slice(0, 16);
      if (patch.length != null) {
        if (!(Number.isInteger(patch.length) && patch.length >= 1 && patch.length <= MAX_STEPS)) fail('length must be an integer 1..128');
        p.length = patch.length;
      }
      if (patch.speed != null) {
        if (!SPEEDS.includes(patch.speed)) fail(`speed must be one of ${SPEEDS.join(', ')}`);
        p.speed = patch.speed;
      }
      if (patch.swing != null) {
        if (!(patch.swing >= 50 && patch.swing <= 80)) fail('swing must be 50..80');
        p.swing = +patch.swing;
      }
      if (patch.scaleMode != null) {
        if (!['pattern', 'track'].includes(patch.scaleMode)) fail('scaleMode must be "pattern" or "track"');
        p.scaleMode = patch.scaleMode;
      }
      return { scope: 'pattern', pattern: pid };
    }
    case 'selectPattern': {
      const id = assertPatternId(cmd.id);
      ensurePattern(project, id);
      project.current = id;
      return { scope: 'current', pattern: id };
    }
    case 'copyPattern': {
      const from = assertPatternId(cmd.from), to = assertPatternId(cmd.to);
      if (!project.patterns[from]) fail(`pattern ${from} is empty`);
      project.patterns[to] = clone(project.patterns[from]);
      return { scope: 'pattern', pattern: to };
    }
    case 'clearPattern': {
      const id = assertPatternId(cmd.id);
      const old = project.patterns[id];
      project.patterns[id] = emptyPattern(old ? old.kit : undefined);
      return { scope: 'pattern', pattern: id };
    }
    case 'setTempo': {
      const b = +cmd.bpm;
      if (!(b >= 30 && b <= 300)) fail('bpm must be 30..300');
      project.tempo = Math.round(b * 10) / 10;
      return { scope: 'tempo' };
    }
    case 'setMute': {
      const t = trackIdx(cmd.track);
      project.mutes[t] = !!cmd.muted;
      return { scope: 'mix', track: t };
    }
    case 'setSolo': {
      const t = trackIdx(cmd.track);
      project.solos[t] = !!cmd.solo;
      return { scope: 'mix', track: t };
    }
    case 'setSong': {
      if (!Array.isArray(cmd.rows) || !cmd.rows.length) fail('rows must be a non-empty array');
      const rows = cmd.rows.map((r) => {
        assertPatternId(r.pattern);
        const rep = Math.round(r.repeats ?? 1);
        if (!(rep >= 1 && rep <= 64)) fail('repeats must be 1..64');
        return { pattern: r.pattern, repeats: rep };
      });
      for (const r of rows) ensurePattern(project, r.pattern);
      project.song = { rows };
      return { scope: 'song' };
    }
    case 'setProjectName': {
      project.name = String(cmd.name || 'UNTITLED').slice(0, 24);
      return { scope: 'meta' };
    }
    case 'loadProject': {
      const next = migrateProject(clone(cmd.project));
      const errs = validateProject(next);
      if (errs.length) fail('invalid project: ' + errs.slice(0, 8).join('; ') + (errs.length > 8 ? ` (+${errs.length - 8} more)` : ''));
      for (const k of Object.keys(project)) delete project[k];
      Object.assign(project, next);
      return { scope: 'all' };
    }
  }
  fail(`unknown command type "${cmd.type}". Valid: ${Object.keys(COMMANDS).join(', ')}`);
}

/** Resolve the effective (possibly locked) JSON value of a param on a step. */
export function effectiveParam(project, track, step, id, patternIdArg) {
  const p = project.patterns[patternIdArg || project.current];
  const trig = p.tracks[track].steps[step];
  if (trig && trig.locks && id in trig.locks) return trig.locks[id];
  return p.kit.sounds[track].params[id];
}

export { LENGTHS, CONDITIONS, RETRIG_RATES };
