// Parameter registry — the single source of truth for every sound and FX
// parameter in the system. UI pages, the engine's typed arrays, validation,
// LFO destinations, docs (tools/describe.mjs) are all derived from this file.
//
// Pure module: no DOM, no WebAudio. Safe to import from the AudioWorklet,
// the main thread and Node.
//
// JSON form vs numeric form
//   Projects store params as JSON values: numbers for 'num', booleans for
//   'bool', the option value (string or number) for 'enum', and a param id
//   string (or 'none') for 'dest'. The engine works on Float32Arrays where
//   enums/dests are indices. Use toNum()/toJson() to convert.
//
// Stability rule: option lists are append-only and ids are never renamed,
// otherwise saved projects break.

export const NUM_TRACKS = 16;
export const MAX_STEPS = 128;
export const NUM_VOICES = 16;
export const PULSES_PER_STEP = 24; // at 1X speed; 96 PPQN

export const LENGTHS = [0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 'INF'];
export const SPEEDS = ['1/8X', '1/4X', '1/2X', '3/4X', '1X', '3/2X', '2X'];
/** Sequencer pulses per step for each speed (24 pulses == one 1/16 at 1X). */
export const SPEED_PULSES = { '1/8X': 192, '1/4X': 96, '1/2X': 48, '3/4X': 32, '1X': 24, '3/2X': 16, '2X': 12 };
export const RATIOS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10, 11, 12, 13, 14, 15, 16];
export const LFO_WAVES = ['TRI', 'SIN', 'SQR', 'SAW', 'EXP', 'RMP', 'RND'];
export const LFO_MODES = ['FREE', 'TRIG', 'HOLD', 'ONE', 'HALF'];
export const LFO_MULTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
export const FILTER_MACHINES = ['MULTI', 'LP4', 'LEGACY', 'COMB-', 'COMB+', 'EQ'];
export const WAVETABLES = ['PRIM', 'HARM', 'SYNC', 'VOX', 'PWM', 'FOLD', 'DIGI', 'ORGN'];
export const ARP_MODES = ['OFF', 'TRUE', 'UP', 'DOWN', 'CYCL', 'SHUF', 'RND'];
export const ARP_SPEEDS = ['1/4', '1/3', '1/2', '2/3', '1', '3/2', '2', '3', '4']; // in steps
export const RETRIG_RATES = ['1/1', '1/2', '1/3', '1/4', '1/5', '1/6', '1/8', '1/10', '1/12', '1/16', '1/20', '1/24', '1/32', '1/40', '1/48', '1/64', '1/80'];
export const TRANSIENTS = ['OFF', 'CLIK', 'BLIP', 'NOIS', 'ZAP', 'THUD', 'SNAP', 'TICK'];

/** Trig conditions. null/undefined == always. */
export const CONDITIONS = (() => {
  const c = ['FILL', '!FILL', 'PRE', '!PRE', 'NEI', '!NEI', '1ST', '!1ST'];
  for (const p of [1, 2, 4, 6, 9, 13, 19, 25, 33, 41, 50, 59, 67, 75, 81, 87, 91, 94, 96, 98, 99]) c.push(p + '%');
  for (let b = 2; b <= 8; b++) for (let a = 1; a <= b; a++) c.push(`${a}:${b}`);
  return c;
})();

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(n) {
  n = Math.round(n);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

// ---------------------------------------------------------------------------
// Value mappings shared by UI (display hints) and engine (DSP).

/** 0..127 -> Hz, 20Hz..20.48kHz exponential. */
export const valueToHz = (v) => 20 * Math.pow(2, (v / 127) * 10);
/** 0..127 -> seconds, cubic curve 0.5ms..~12s. */
export const valueToTime = (v) => 0.0005 + Math.pow(Math.max(0, v) / 127, 3) * 12;
/** VOL 0..127 -> linear gain (100 == unity). */
export const valueToGain = (v) => { const x = Math.max(0, v) / 100; return x * x; };

function fmtTime(s) { return s < 1 ? (s * 1000).toFixed(s < 0.01 ? 1 : 0) + 'ms' : s.toFixed(2) + 's'; }
function fmtHz(h) { return h < 1000 ? h.toFixed(0) + 'Hz' : (h / 1000).toFixed(2) + 'k'; }

// ---------------------------------------------------------------------------
// Definition helpers

function num(id, label, name, min, max, def, extra = {}) {
  return { id, label, name, type: 'num', min, max, def, mod: true, lock: true, ...extra };
}
function int(id, label, name, min, max, def, extra = {}) {
  return num(id, label, name, min, max, def, { int: true, ...extra });
}
function en(id, label, name, options, def, extra = {}) {
  return { id, label, name, type: 'enum', options, min: 0, max: options.length - 1, def, mod: false, lock: true, ...extra };
}
function bool(id, label, name, def, extra = {}) {
  return { id, label, name, type: 'bool', min: 0, max: 1, def, mod: false, lock: true, ...extra };
}
function dest(id, label, name) {
  return { id, label, name, type: 'dest', min: 0, max: 0, def: 'none', mod: false, lock: false };
}
const bi = { bipolar: true };

// ---------------------------------------------------------------------------
// Sound (per-track) parameters

const TRIG = [
  int('trig.note', 'NOTE', 'Note', 0, 127, 60, { fmt: 'note', mod: false }),
  int('trig.vel', 'VEL', 'Velocity', 1, 127, 100, { mod: false }),
  en('trig.len', 'LEN', 'Note length (steps)', LENGTHS, 1),
  num('trig.port', 'PORT', 'Portamento time', 0, 127, 0, { hint: 'time' }),
  bool('trig.leg', 'LEG', 'Legato', false),
  int('trig.voic', 'VOIC', 'Max voices for this track', 1, 8, 4, { mod: false, lock: false }),
  num('trig.vamp', 'VAMP', 'Velocity > amp sensitivity', 0, 127, 80),
  num('trig.vflt', 'VFLT', 'Velocity > filter env depth', -64, 63, 0, bi),
  // Not on a page: pitch offset, mainly an LFO destination (vibrato) and lockable.
  num('trig.ptch', 'PTCH', 'Pitch offset (semitones)', -24, 24, 0, bi),
];

const ARP = [
  en('arp.mode', 'MODE', 'Arpeggiator mode', ARP_MODES, 'OFF', { lock: false }),
  en('arp.spd', 'SPD', 'Arp rate (steps)', ARP_SPEEDS, '1', { lock: false }),
  int('arp.rng', 'RNGE', 'Arp octave range', 1, 4, 1, { mod: false, lock: false }),
  en('arp.nlen', 'NLEN', 'Arp note length (steps)', LENGTHS, 0.5, { lock: false }),
];

const FMT = [
  en('fmt.algo', 'ALGO', 'FM algorithm', [1, 2, 3, 4, 5, 6, 7, 8], 1),
  en('fmt.ratc', 'C', 'Operator C ratio', RATIOS, 1),
  en('fmt.rata', 'A', 'Operator A ratio', RATIOS, 2),
  en('fmt.ratb', 'B', 'Operator B1 ratio', RATIOS, 3),
  num('fmt.harm', 'HARM', 'Harmonics (neg: carriers, pos: modulators)', -64, 63, 0, bi),
  num('fmt.dtun', 'DTUN', 'Operator detune', 0, 127, 0),
  num('fmt.fdbk', 'FDBK', 'Operator feedback', 0, 127, 0),
  num('fmt.mix', 'MIX', 'X/Y carrier mix', -64, 63, 0, bi),
  num('fmt.aatk', 'AATK', 'A envelope attack', 0, 127, 0, { hint: 'time' }),
  num('fmt.adec', 'ADEC', 'A envelope decay', 0, 127, 48, { hint: 'time' }),
  num('fmt.aend', 'AEND', 'A envelope end level', 0, 127, 0),
  num('fmt.alev', 'ALEV', 'A modulation level', 0, 127, 50),
  num('fmt.batk', 'BATK', 'B envelope attack', 0, 127, 0, { hint: 'time' }),
  num('fmt.bdec', 'BDEC', 'B envelope decay', 0, 127, 48, { hint: 'time' }),
  num('fmt.bend', 'BEND', 'B envelope end level', 0, 127, 0),
  num('fmt.blev', 'BLEV', 'B modulation level', 0, 127, 30),
  en('fmt.ratb2', 'B2', 'Operator B2 ratio', RATIOS, 1),
  num('fmt.aofs', 'AOFS', 'A ratio fine offset', -64, 63, 0, bi),
  num('fmt.bofs', 'BOFS', 'B ratio fine offset', -64, 63, 0, bi),
  num('fmt.adly', 'ADLY', 'A envelope delay', 0, 127, 0, { hint: 'time' }),
  num('fmt.bdly', 'BDLY', 'B envelope delay', 0, 127, 0, { hint: 'time' }),
  bool('fmt.arst', 'ARST', 'A envelope reset on trig', true),
  bool('fmt.brst', 'BRST', 'B envelope reset on trig', true),
  num('fmt.vmod', 'VMOD', 'Velocity > modulation level', -64, 63, 0, bi),
];

const FMD = [
  int('fmd.tune', 'TUNE', 'Body pitch (note at C4 trig)', 0, 127, 36, { fmt: 'note', int: false }),
  num('fmd.stim', 'STIM', 'Pitch sweep time', 0, 127, 30),
  num('fmd.sdep', 'SDEP', 'Pitch sweep depth', 0, 127, 50),
  en('fmd.algo', 'ALGO', 'Body algorithm', [1, 2, 3], 1),
  en('fmd.rat', 'RAT', 'Modulator ratio', RATIOS, 1.5),
  num('fmd.mod', 'MOD', 'Modulation depth', 0, 127, 0),
  num('fmd.fdbk', 'FDBK', 'Feedback', 0, 127, 0),
  num('fmd.fold', 'FOLD', 'Wavefolder', 0, 127, 0),
  num('fmd.bhld', 'BHLD', 'Body hold', 0, 127, 0, { hint: 'time' }),
  num('fmd.bdec', 'BDEC', 'Body decay', 0, 127, 50, { hint: 'time' }),
  num('fmd.blev', 'BLEV', 'Body level', 0, 127, 110),
  num('fmd.phs', 'PHS', 'Start phase (click)', 0, 127, 0),
  num('fmd.mdec', 'MDEC', 'Modulation decay', 0, 127, 40, { hint: 'time' }),
  num('fmd.nhld', 'NHLD', 'Noise hold', 0, 127, 0, { hint: 'time' }),
  num('fmd.ndec', 'NDEC', 'Noise decay', 0, 127, 30, { hint: 'time' }),
  num('fmd.nlev', 'NLEV', 'Noise level', 0, 127, 0),
  num('fmd.nbas', 'NBAS', 'Noise filter base', 0, 127, 64, { hint: 'hz' }),
  num('fmd.nwid', 'NWID', 'Noise filter width', 0, 127, 127),
  en('fmd.ntyp', 'NTYP', 'Noise type', ['WHT', 'MTL', 'GRN'], 'WHT'),
  num('fmd.nchr', 'NCHR', 'Noise character', 0, 127, 64),
  en('fmd.trns', 'TRAN', 'Transient type', TRANSIENTS, 'OFF'),
  num('fmd.tlev', 'TLEV', 'Transient level', 0, 127, 64),
  num('fmd.vsw', 'VSWP', 'Velocity > sweep depth', -64, 63, 0, bi),
];

const WAV = [
  num('wav.tun1', 'TUN1', 'Osc 1 tune (semitones)', -24, 24, 0, { ...bi, int: true, step: 1 }),
  num('wav.wav1', 'WAV1', 'Osc 1 wavetable position', 0, 127, 0),
  num('wav.pd1', 'PD1', 'Osc 1 phase distortion', 0, 127, 0),
  num('wav.lev1', 'LEV1', 'Osc 1 level', 0, 127, 100),
  num('wav.tun2', 'TUN2', 'Osc 2 tune (semitones)', -24, 24, 0, { ...bi, int: true, step: 1 }),
  num('wav.wav2', 'WAV2', 'Osc 2 wavetable position', 0, 127, 0),
  num('wav.pd2', 'PD2', 'Osc 2 phase distortion', 0, 127, 0),
  num('wav.lev2', 'LEV2', 'Osc 2 level', 0, 127, 0),
  en('wav.tbl1', 'TBL1', 'Osc 1 wavetable', WAVETABLES, 'PRIM'),
  en('wav.tbl2', 'TBL2', 'Osc 2 wavetable', WAVETABLES, 'PRIM'),
  num('wav.ofs1', 'OFS1', 'Osc 1 fine (cents)', -64, 63, 0, bi),
  num('wav.ofs2', 'OFS2', 'Osc 2 fine (cents)', -64, 63, 0, bi),
  en('wav.mode', 'MODE', 'Osc interaction mode', ['MIX', 'RING', 'SYNC', 'PM'], 'MIX'),
  num('wav.mamt', 'MAMT', 'Interaction amount', 0, 127, 64),
  num('wav.drft', 'DRFT', 'Analog drift', 0, 127, 0),
  bool('wav.rset', 'RSET', 'Phase reset on trig', true),
  num('wav.natk', 'NATK', 'Noise attack', 0, 127, 0, { hint: 'time' }),
  num('wav.nhld', 'NHLD', 'Noise hold', 0, 127, 0, { hint: 'time' }),
  num('wav.ndec', 'NDEC', 'Noise decay', 0, 127, 40, { hint: 'time' }),
  num('wav.nlev', 'NLEV', 'Noise level', 0, 127, 0),
  num('wav.nbas', 'NBAS', 'Noise filter base', 0, 127, 40, { hint: 'hz' }),
  num('wav.nwid', 'NWID', 'Noise filter width', 0, 127, 127),
  en('wav.ntyp', 'NTYP', 'Noise type', ['WHT', 'GRN', 'TUNE', 'S&H'], 'WHT'),
  num('wav.nchr', 'NCHR', 'Noise character', 0, 127, 64),
];

const SWM = [
  num('swm.tune', 'TUNE', 'Tune (semitones)', -24, 24, 0, { ...bi, int: true, step: 1 }),
  num('swm.dtun', 'DTUN', 'Swarm detune', 0, 127, 40),
  num('swm.mix', 'MIX', 'Main / swarm mix', -64, 63, 0, bi),
  en('swm.mwav', 'MWAV', 'Main oscillator wave', ['SIN', 'TRI', 'SAW', 'SQR'], 'SAW'),
  en('swm.swav', 'SWAV', 'Swarm oscillator wave', ['SAW', 'SQR', 'TRI', 'SIN'], 'SAW'),
  en('swm.moct', 'MOCT', 'Main octave', [0, -1, -2], 0),
  num('swm.anim', 'ANIM', 'Swarm animation depth', 0, 127, 20),
  num('swm.nmod', 'NMOD', 'Noise modulation', 0, 127, 0),
  num('swm.pw', 'PW', 'Main pulse width', 0, 127, 64),
  int('swm.dens', 'DENS', 'Swarm density (oscillators)', 1, 6, 6, { mod: false }),
  num('swm.arte', 'ARTE', 'Animation rate', 0, 127, 40),
];

const FLT = [
  num('flt.atk', 'ATK', 'Filter env attack', 0, 127, 0, { hint: 'time' }),
  num('flt.dec', 'DEC', 'Filter env decay', 0, 127, 64, { hint: 'time' }),
  num('flt.sus', 'SUS', 'Filter env sustain', 0, 127, 0),
  num('flt.rel', 'REL', 'Filter env release', 0, 127, 40, { hint: 'time' }),
  num('flt.frq', 'FREQ', 'Filter frequency', 0, 127, 127, { hint: 'hz' }),
  num('flt.res', 'RESO', 'Filter resonance', 0, 127, 0),
  num('flt.typ', 'TYPE', 'Filter type / morph', 0, 127, 0),
  num('flt.env', 'ENV', 'Filter env depth', -64, 63, 0, bi),
  num('flt.base', 'BASE', 'Base-width: highpass base', 0, 127, 0, { hint: 'hz' }),
  num('flt.wdth', 'WDTH', 'Base-width: width', 0, 127, 127),
  num('flt.edly', 'EDLY', 'Filter env delay', 0, 127, 0, { hint: 'time' }),
  num('flt.ktrk', 'KTRK', 'Filter key tracking', 0, 127, 0),
  bool('flt.rset', 'RSET', 'Filter env reset on legato', true),
  en('flt.mach', 'MACH', 'Filter machine', FILTER_MACHINES, 'MULTI', { lock: false }),
];

const AMP = [
  num('amp.atk', 'ATK', 'Amp attack', 0, 127, 0, { hint: 'time' }),
  num('amp.hld', 'HOLD', 'Amp hold', 0, 127, 0, { hint: 'time' }),
  num('amp.dec', 'DEC', 'Amp decay', 0, 127, 64, { hint: 'time' }),
  num('amp.sus', 'SUS', 'Amp sustain', 0, 127, 100),
  num('amp.rel', 'REL', 'Amp release', 0, 127, 30, { hint: 'time' }),
  en('amp.mode', 'MODE', 'Envelope mode', ['ADSR', 'AHD'], 'ADSR'),
  num('amp.pan', 'PAN', 'Pan', -64, 63, 0, { ...bi, fmt: 'pan' }),
  num('amp.vol', 'VOL', 'Volume', 0, 127, 100),
];

const FX = [
  num('fx.br', 'BR', 'Bit reduction', 0, 127, 0),
  num('fx.srr', 'SRR', 'Sample rate reduction', 0, 127, 0),
  en('fx.srrt', 'SR.RT', 'SRR routing', ['PRE', 'POST'], 'PRE'),
  num('fx.od', 'OD', 'Overdrive', 0, 127, 0),
  en('fx.odrt', 'OD.RT', 'Overdrive routing', ['PRE', 'POST'], 'PRE'),
  num('fx.del', 'DEL', 'Delay send', 0, 127, 0),
  num('fx.rev', 'REV', 'Reverb send', 0, 127, 0),
  num('fx.cho', 'CHO', 'Chorus send', 0, 127, 0),
];

function lfo(n) {
  const p = `lfo${n}.`;
  return [
    num(p + 'spd', 'SPD', `LFO ${n} speed`, -64, 63, 32, bi),
    en(p + 'mul', 'MULT', `LFO ${n} speed multiplier`, LFO_MULTS, 4),
    num(p + 'fade', 'FADE', `LFO ${n} fade in/out`, -64, 63, 0, bi),
    dest(p + 'dest', 'DEST', `LFO ${n} destination`),
    en(p + 'wave', 'WAVE', `LFO ${n} waveform`, LFO_WAVES, 'TRI'),
    num(p + 'sph', 'SPH', `LFO ${n} start phase`, 0, 127, 0),
    en(p + 'mode', 'MODE', `LFO ${n} trig mode`, LFO_MODES, 'FREE'),
    num(p + 'dep', 'DEP', `LFO ${n} depth`, -64, 63, 0, bi),
  ];
}

export const SOUND_PARAMS = [...TRIG, ...ARP, ...FMT, ...FMD, ...WAV, ...SWM, ...FLT, ...AMP, ...FX, ...lfo(1), ...lfo(2), ...lfo(3)];
export const NUM_PARAMS = SOUND_PARAMS.length;
export const PARAM_INDEX = Object.freeze(Object.fromEntries(SOUND_PARAMS.map((p, i) => [p.id, i])));
export const PARAM_BY_ID = Object.freeze(Object.fromEntries(SOUND_PARAMS.map((p) => [p.id, p])));
SOUND_PARAMS.forEach((p, i) => { p.index = i; });

// ---------------------------------------------------------------------------
// Kit-level FX parameters (delay / reverb / chorus / compressor / master)

export const FX_PARAMS = [
  num('del.time', 'TIME', 'Delay time (1/128 bar; 8 = one step)', 1, 128, 24, { int: true, fmt: 'deltime' }),
  bool('del.pp', 'PING', 'Ping-pong', true),
  num('del.wid', 'WID', 'Stereo width', 0, 127, 100),
  num('del.fb', 'FDBK', 'Feedback', 0, 127, 50),
  num('del.hpf', 'HPF', 'Highpass', 0, 127, 20, { hint: 'hz' }),
  num('del.lpf', 'LPF', 'Lowpass', 0, 127, 100, { hint: 'hz' }),
  num('del.rev', 'REV', 'Delay > reverb send', 0, 127, 0),
  num('del.vol', 'VOL', 'Delay return level', 0, 127, 100),
  num('rev.pre', 'PRE', 'Pre-delay', 0, 127, 8),
  num('rev.dec', 'DEC', 'Decay time', 0, 127, 64),
  num('rev.sfrq', 'SFRQ', 'Shelf frequency', 0, 127, 80, { hint: 'hz' }),
  num('rev.sgn', 'SGN', 'Shelf gain (damping)', 0, 127, 90),
  num('rev.hpf', 'HPF', 'Highpass', 0, 127, 16, { hint: 'hz' }),
  num('rev.lpf', 'LPF', 'Lowpass', 0, 127, 110, { hint: 'hz' }),
  num('rev.vol', 'VOL', 'Reverb return level', 0, 127, 100),
  num('cho.dep', 'DEP', 'Chorus depth', 0, 127, 50),
  num('cho.spd', 'SPD', 'Chorus speed', 0, 127, 30),
  num('cho.hpf', 'HPF', 'Highpass', 0, 127, 20, { hint: 'hz' }),
  num('cho.wid', 'WID', 'Stereo width', 0, 127, 100),
  num('cho.del', 'DEL', 'Chorus > delay send', 0, 127, 0),
  num('cho.rev', 'REV', 'Chorus > reverb send', 0, 127, 0),
  num('cho.vol', 'VOL', 'Chorus return level', 0, 127, 100),
  num('cmp.thr', 'THR', 'Compressor threshold', 0, 127, 110),
  num('cmp.atk', 'ATK', 'Compressor attack', 0, 127, 20),
  num('cmp.rel', 'REL', 'Compressor release', 0, 127, 60),
  num('cmp.mup', 'MUP', 'Makeup gain', 0, 127, 0),
  en('cmp.rat', 'RAT', 'Ratio', ['2:1', '4:1', '8:1', '20:1'], '4:1'),
  en('cmp.scs', 'SCS', 'Sidechain source', ['MAIN', ...Array.from({ length: NUM_TRACKS }, (_, i) => 'T' + (i + 1))], 'MAIN'),
  num('cmp.mix', 'MIX', 'Compressor dry/wet', 0, 127, 127),
  num('mst.vol', 'MVOL', 'Master volume', 0, 127, 100),
  num('mst.od', 'MOD', 'Master overdrive', 0, 127, 0),
];
export const FX_INDEX = Object.freeze(Object.fromEntries(FX_PARAMS.map((p, i) => [p.id, i])));
export const FX_BY_ID = Object.freeze(Object.fromEntries(FX_PARAMS.map((p) => [p.id, p])));
FX_PARAMS.forEach((p, i) => { p.index = i; });

export const FX_PAGES = {
  DELAY: ['del.time', 'del.pp', 'del.wid', 'del.fb', 'del.hpf', 'del.lpf', 'del.rev', 'del.vol'],
  REVERB: ['rev.pre', 'rev.dec', 'rev.sfrq', 'rev.sgn', 'rev.hpf', 'rev.lpf', null, 'rev.vol'],
  CHORUS: ['cho.dep', 'cho.spd', 'cho.hpf', 'cho.wid', 'cho.del', 'cho.rev', null, 'cho.vol'],
  COMP: ['cmp.thr', 'cmp.atk', 'cmp.rel', 'cmp.mup', 'cmp.rat', 'cmp.scs', 'cmp.mix', null],
  MASTER: ['mst.vol', 'mst.od', null, null, null, null, null, null],
};

// ---------------------------------------------------------------------------
// Machines & pages

export const MACHINES = {
  fmtone: {
    id: 'fmtone', name: 'FM TONE', short: 'FMT',
    about: '4-operator FM (C, A, B1, B2) with 8 algorithms and two modulator envelopes.',
    pages: {
      SYN1: ['fmt.algo', 'fmt.ratc', 'fmt.rata', 'fmt.ratb', 'fmt.harm', 'fmt.dtun', 'fmt.fdbk', 'fmt.mix'],
      SYN2: ['fmt.aatk', 'fmt.adec', 'fmt.aend', 'fmt.alev', 'fmt.batk', 'fmt.bdec', 'fmt.bend', 'fmt.blev'],
      SYN3: ['fmt.ratb2', 'fmt.aofs', 'fmt.bofs', 'fmt.adly', 'fmt.bdly', 'fmt.arst', 'fmt.brst', 'fmt.vmod'],
    },
  },
  fmdrum: {
    id: 'fmdrum', name: 'FM DRUM', short: 'FMD',
    about: 'Percussion: FM body with pitch sweep & folder, filtered noise/metal generator, transient layer.',
    pages: {
      SYN1: ['fmd.tune', 'fmd.stim', 'fmd.sdep', 'fmd.algo', 'fmd.rat', 'fmd.mod', 'fmd.fdbk', 'fmd.fold'],
      SYN2: ['fmd.bhld', 'fmd.bdec', 'fmd.blev', 'fmd.phs', 'fmd.mdec', 'fmd.nhld', 'fmd.ndec', 'fmd.nlev'],
      SYN3: ['fmd.nbas', 'fmd.nwid', 'fmd.ntyp', 'fmd.nchr', 'fmd.trns', 'fmd.tlev', 'fmd.vsw', null],
    },
  },
  wavetone: {
    id: 'wavetone', name: 'WAVETONE', short: 'WAV',
    about: 'Two band-limited wavetable oscillators with phase distortion, ring/sync/PM modes and a noise generator.',
    pages: {
      SYN1: ['wav.tun1', 'wav.wav1', 'wav.pd1', 'wav.lev1', 'wav.tun2', 'wav.wav2', 'wav.pd2', 'wav.lev2'],
      SYN2: ['wav.tbl1', 'wav.tbl2', 'wav.ofs1', 'wav.ofs2', 'wav.mode', 'wav.mamt', 'wav.drft', 'wav.rset'],
      SYN3: ['wav.natk', 'wav.nhld', 'wav.ndec', 'wav.nlev', 'wav.nbas', 'wav.nwid', 'wav.ntyp', 'wav.nchr'],
    },
  },
  swarmer: {
    id: 'swarmer', name: 'SWARMER', short: 'SWM',
    about: 'A main oscillator plus a swarm of up to six animated, detuned oscillators.',
    pages: {
      SYN1: ['swm.tune', 'swm.dtun', 'swm.mix', 'swm.mwav', 'swm.swav', 'swm.moct', 'swm.anim', 'swm.nmod'],
      SYN2: ['swm.pw', 'swm.dens', 'swm.arte', null, null, null, null, null],
    },
  },
};
export const MACHINE_IDS = Object.keys(MACHINES);

export const COMMON_PAGES = {
  TRIG: ['trig.note', 'trig.vel', 'trig.len', 'trig.port', 'trig.leg', 'trig.voic', 'trig.vamp', 'trig.vflt'],
  FLTR1: ['flt.atk', 'flt.dec', 'flt.sus', 'flt.rel', 'flt.frq', 'flt.res', 'flt.typ', 'flt.env'],
  FLTR2: ['flt.base', 'flt.wdth', 'flt.edly', 'flt.ktrk', 'flt.rset', null, null, 'flt.mach'],
  AMP: ['amp.atk', 'amp.hld', 'amp.dec', 'amp.sus', 'amp.rel', 'amp.mode', 'amp.pan', 'amp.vol'],
  FX: ['fx.br', 'fx.srr', 'fx.srrt', 'fx.od', 'fx.odrt', 'fx.del', 'fx.rev', 'fx.cho'],
  LFO1: lfo(1).map((p) => p.id),
  LFO2: lfo(2).map((p) => p.id),
  LFO3: lfo(3).map((p) => p.id),
  ARP: ['arp.mode', 'arp.spd', 'arp.rng', 'arp.nlen', null, null, null, null],
};

export const PAGE_ORDER = ['TRIG', 'SYN1', 'SYN2', 'SYN3', 'FLTR1', 'FLTR2', 'AMP', 'FX', 'LFO1', 'LFO2', 'LFO3', 'ARP'];

/** Per-filter-machine relabelling of FLTR1 slots FREQ / RESO / TYPE. */
export const FILTER_LABELS = {
  MULTI: { 'flt.res': 'RESO', 'flt.typ': 'LP>HP' },
  LP4: { 'flt.res': 'RESO', 'flt.typ': 'DRIV' },
  LEGACY: { 'flt.res': 'RESO', 'flt.typ': 'LP|HP' },
  'COMB-': { 'flt.res': 'FDBK', 'flt.typ': 'LPF' },
  'COMB+': { 'flt.res': 'FDBK', 'flt.typ': 'LPF' },
  EQ: { 'flt.res': 'Q', 'flt.typ': 'GAIN' },
};

/** Returns the 8 param ids (or null) for a page, given a sound's machine. */
export function pageParams(page, machine) {
  if (COMMON_PAGES[page]) return COMMON_PAGES[page];
  const m = MACHINES[machine];
  return (m && m.pages[page]) || null;
}

/** Pages available for a machine (SYN3 only if the machine has one). */
export function pagesFor(machine) {
  return PAGE_ORDER.filter((p) => pageParams(p, machine));
}

/** Which machine (if any) a sound param belongs to. */
export function paramMachine(id) {
  const prefix = id.split('.')[0];
  return { fmt: 'fmtone', fmd: 'fmdrum', wav: 'wavetone', swm: 'swarmer' }[prefix] || null;
}

/** Params that make sense as an LFO destination for a given machine. */
export function destinationsFor(machine) {
  return SOUND_PARAMS.filter((p) => p.mod && (paramMachine(p.id) === null || paramMachine(p.id) === machine));
}

// ---------------------------------------------------------------------------
// Conversion & validation

function optIndex(def, v) {
  const o = def.options;
  let i = o.indexOf(v);
  if (i < 0 && typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) i = o.indexOf(+v);
  if (i < 0 && typeof v === 'number') i = o.findIndex((x) => typeof x === 'number' && Math.abs(x - v) < 1e-6);
  if (i < 0 && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < o.length && typeof o[0] !== 'number') i = v;
  return i;
}

/** Convert a JSON param value to its numeric engine value. Throws on invalid. */
export function toNum(def, v) {
  switch (def.type) {
    case 'num': {
      const n = +v;
      if (!Number.isFinite(n)) throw new Error(`${def.id}: expected number, got ${JSON.stringify(v)}`);
      return Math.min(def.max, Math.max(def.min, n));
    }
    case 'bool': return v === true || v === 1 || v === 'ON' || v === 'true' ? 1 : 0;
    case 'enum': {
      const i = optIndex(def, v);
      if (i < 0) throw new Error(`${def.id}: invalid option ${JSON.stringify(v)}; valid: ${def.options.join(', ')}`);
      return i;
    }
    case 'dest': {
      if (v === 'none' || v == null || v === -1) return -1;
      const i = typeof v === 'number' ? v : PARAM_INDEX[v];
      if (i == null || !SOUND_PARAMS[i] || !SOUND_PARAMS[i].mod) throw new Error(`${def.id}: invalid destination ${JSON.stringify(v)}`);
      return i;
    }
  }
  throw new Error('unknown param type ' + def.type);
}

/** Convert a numeric engine value back to the canonical JSON value. */
export function toJson(def, n) {
  switch (def.type) {
    case 'num': {
      const c = Math.min(def.max, Math.max(def.min, n));
      return def.int ? Math.round(c) : Math.round(c * 100) / 100;
    }
    case 'bool': return n >= 0.5;
    case 'enum': return def.options[Math.max(0, Math.min(def.options.length - 1, Math.round(n)))];
    case 'dest': return n < 0 ? 'none' : SOUND_PARAMS[Math.round(n)].id;
  }
}

/** Normalise any accepted JSON-ish input to the canonical JSON value. */
export function normalize(def, v) { return toJson(def, toNum(def, v)); }

export function getDef(id) {
  const d = PARAM_BY_ID[id] || FX_BY_ID[id];
  if (!d) {
    const all = [...SOUND_PARAMS, ...FX_PARAMS].map((p) => p.id);
    const near = all.filter((x) => x.split('.')[0] === id.split('.')[0] || x.includes(id.split('.').pop())).slice(0, 12);
    throw new Error(`Unknown param "${id}".${near.length ? ' Did you mean: ' + near.join(', ') : ''}`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Display

export function formatValue(def, v) {
  if (v === undefined || v === null) return '--';
  switch (def.type) {
    case 'bool': return v ? 'ON' : 'OFF';
    case 'enum': {
      const o = typeof v === 'number' && typeof def.options[0] !== 'number' ? def.options[v] : v;
      if (def.id.endsWith('.len') || def.id === 'arp.nlen') return o === 'INF' ? '∞' : String(o);
      if (def.id.endsWith('.mul')) return '×' + o;
      return String(o);
    }
    case 'dest': {
      if (v === 'none' || v === -1) return '--';
      const d = typeof v === 'number' ? SOUND_PARAMS[v] : PARAM_BY_ID[v];
      return d ? d.label : '??';
    }
  }
  if (def.fmt === 'note') return noteName(v);
  if (def.fmt === 'pan') return Math.abs(v) < 0.5 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v));
  if (def.fmt === 'deltime') return String(Math.round(v));
  const r = Math.round(v * 10) / 10;
  const s = def.int || Number.isInteger(r) ? String(Math.round(v)) : r.toFixed(1);
  return def.bipolar && v > 0.05 ? '+' + s : s;
}

/** Secondary human-readable hint, e.g. "1.2kHz" or "350ms". */
export function valueHint(def, v) {
  if (def.hint === 'hz') return fmtHz(valueToHz(v));
  if (def.hint === 'time') return fmtTime(valueToTime(v));
  if (def.fmt === 'deltime') {
    const steps = v / 8;
    return steps === Math.floor(steps) ? steps + (steps === 1 ? ' step' : ' steps') : steps.toFixed(2) + ' st';
  }
  if (def.id === 'trig.len') return v === 'INF' ? 'infinite' : v + (v === 1 ? ' step' : ' steps');
  return def.name;
}
