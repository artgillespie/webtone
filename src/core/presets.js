// Factory sound presets. Each preset only lists params that differ from the
// machine defaults (see defaultSound in project.js). Add new presets by
// appending to PRESETS; `category` is used for browsing.

import { defaultSound } from './project.js';

const p = (name, machine, category, params) => ({ name, machine, category, params });

export const PRESETS = [
  // ---------------------------------------------------------------- FM DRUM
  p('KICK DEEP', 'fmdrum', 'kick', {
    'fmd.tune': 31, 'fmd.stim': 28, 'fmd.sdep': 62, 'fmd.bhld': 8, 'fmd.bdec': 50, 'fmd.blev': 120, 'fmd.phs': 18,
    'fmd.trns': 'CLIK', 'fmd.tlev': 40, 'amp.vol': 104, 'trig.vamp': 50,
  }),
  p('KICK 909', 'fmdrum', 'kick', {
    'fmd.tune': 34, 'fmd.stim': 33, 'fmd.sdep': 72, 'fmd.bdec': 42, 'fmd.fold': 12, 'fmd.blev': 118,
    'fmd.nlev': 22, 'fmd.ndec': 8, 'fmd.nbas': 92, 'fmd.trns': 'THUD', 'fmd.tlev': 35, 'amp.vol': 100,
  }),
  p('KICK DIST', 'fmdrum', 'kick', {
    'fmd.tune': 29, 'fmd.stim': 38, 'fmd.sdep': 80, 'fmd.bdec': 56, 'fmd.fold': 40, 'fmd.blev': 110, 'fx.od': 50,
    'fmd.trns': 'CLIK', 'fmd.tlev': 60, 'amp.vol': 88,
  }),
  p('SNARE FM', 'fmdrum', 'snare', {
    'fmd.tune': 54, 'fmd.stim': 20, 'fmd.sdep': 30, 'fmd.algo': 2, 'fmd.rat': 1.5, 'fmd.mod': 40, 'fmd.mdec': 20,
    'fmd.bdec': 30, 'fmd.blev': 85, 'fmd.nlev': 110, 'fmd.ndec': 38, 'fmd.nbas': 70, 'fmd.nwid': 60,
    'fmd.trns': 'SNAP', 'fmd.tlev': 55, 'amp.vol': 92,
  }),
  p('CLAPPY', 'fmdrum', 'snare', {
    'fmd.blev': 0, 'fmd.nlev': 127, 'fmd.nhld': 6, 'fmd.ndec': 42, 'fmd.nbas': 82, 'fmd.nwid': 28, 'fmd.ntyp': 'GRN',
    'fmd.nchr': 118, 'fmd.trns': 'NOIS', 'fmd.tlev': 70, 'fx.rev': 30, 'amp.vol': 96,
  }),
  p('CL HAT', 'fmdrum', 'hat', {
    'fmd.blev': 0, 'fmd.nlev': 120, 'fmd.ntyp': 'MTL', 'fmd.nchr': 92, 'fmd.nbas': 104, 'fmd.nwid': 30, 'fmd.ndec': 18,
    'fmd.trns': 'TICK', 'fmd.tlev': 25, 'amp.vol': 80, 'amp.pan': 8,
  }),
  p('OP HAT', 'fmdrum', 'hat', {
    'fmd.blev': 0, 'fmd.nlev': 118, 'fmd.ntyp': 'MTL', 'fmd.nchr': 92, 'fmd.nbas': 100, 'fmd.nwid': 34, 'fmd.nhld': 10,
    'fmd.ndec': 56, 'amp.vol': 76, 'amp.pan': -10,
  }),
  p('RIDE', 'fmdrum', 'hat', {
    'fmd.tune': 84, 'fmd.algo': 3, 'fmd.rat': 3.5, 'fmd.mod': 60, 'fmd.mdec': 60, 'fmd.bdec': 70, 'fmd.blev': 30, 'fmd.sdep': 0,
    'fmd.nlev': 90, 'fmd.ntyp': 'MTL', 'fmd.nchr': 70, 'fmd.nbas': 96, 'fmd.ndec': 82, 'amp.vol': 70,
  }),
  p('TOM LOW', 'fmdrum', 'tom', {
    'fmd.tune': 45, 'fmd.stim': 40, 'fmd.sdep': 26, 'fmd.bdec': 55, 'fmd.blev': 112, 'fmd.nlev': 18, 'fmd.ndec': 20, 'fmd.nbas': 60,
  }),
  p('RIM', 'fmdrum', 'perc', {
    'fmd.tune': 76, 'fmd.stim': 5, 'fmd.sdep': 10, 'fmd.bdec': 12, 'fmd.mod': 50, 'fmd.rat': 3.5, 'fmd.mdec': 10,
    'fmd.trns': 'CLIK', 'fmd.tlev': 70, 'fmd.nlev': 30, 'fmd.nbas': 90, 'fmd.ndec': 8, 'amp.vol': 84, 'amp.pan': 20,
  }),
  p('COWBELL', 'fmdrum', 'perc', {
    'fmd.tune': 73, 'fmd.algo': 3, 'fmd.rat': 1.5, 'fmd.mod': 90, 'fmd.mdec': 60, 'fmd.bdec': 40, 'fmd.fold': 30, 'fmd.sdep': 0, 'amp.vol': 78,
  }),
  p('ZAP', 'fmdrum', 'perc', {
    'fmd.tune': 60, 'fmd.stim': 20, 'fmd.sdep': 100, 'fmd.bdec': 30, 'fmd.trns': 'ZAP', 'fmd.tlev': 80, 'fx.del': 40,
  }),

  // ---------------------------------------------------------------- FM TONE
  p('E.PIANO', 'fmtone', 'keys', {
    'fmt.algo': 1, 'fmt.ratc': 1, 'fmt.rata': 14, 'fmt.alev': 34, 'fmt.adec': 32, 'fmt.ratb': 1, 'fmt.ratb2': 1,
    'fmt.blev': 46, 'fmt.bdec': 64, 'fmt.bend': 10, 'fmt.mix': -10, 'fmt.dtun': 6,
    'amp.dec': 82, 'amp.sus': 30, 'amp.rel': 50, 'trig.vamp': 100, 'fmt.vmod': 30, 'fx.cho': 50, 'fx.rev': 20,
  }),
  p('BELL', 'fmtone', 'keys', {
    'fmt.algo': 1, 'fmt.ratc': 1, 'fmt.rata': 3.5, 'fmt.alev': 70, 'fmt.adec': 72, 'fmt.aend': 10, 'fmt.ratb': 5, 'fmt.ratb2': 2,
    'fmt.blev': 40, 'fmt.mix': -30, 'amp.dec': 96, 'amp.sus': 0, 'amp.rel': 90, 'fx.rev': 55, 'fx.del': 30,
  }),
  p('FM BASS', 'fmtone', 'bass', {
    'fmt.algo': 2, 'fmt.ratc': 1, 'fmt.rata': 1, 'fmt.ratb': 2, 'fmt.alev': 64, 'fmt.adec': 34, 'fmt.aend': 22, 'fmt.blev': 26,
    'fmt.fdbk': 36, 'fmt.mix': -64, 'amp.dec': 50, 'amp.sus': 90, 'amp.rel': 18, 'flt.mach': 'LP4', 'flt.frq': 72,
    'flt.res': 30, 'flt.env': 26, 'flt.dec': 40, 'trig.voic': 1, 'trig.note': 36, 'amp.vol': 96,
  }),
  p('BRASS', 'fmtone', 'lead', {
    'fmt.algo': 1, 'fmt.ratc': 1, 'fmt.rata': 1, 'fmt.alev': 78, 'fmt.aatk': 38, 'fmt.adec': 70, 'fmt.aend': 60, 'fmt.fdbk': 30,
    'fmt.mix': -64, 'amp.atk': 22, 'amp.sus': 110, 'amp.rel': 40, 'flt.frq': 96, 'flt.env': 12, 'flt.atk': 30, 'flt.dec': 60,
  }),
  p('PLUCK', 'fmtone', 'keys', {
    'fmt.algo': 1, 'fmt.ratc': 1, 'fmt.rata': 2, 'fmt.alev': 88, 'fmt.adec': 26, 'fmt.ratb': 3, 'fmt.blev': 30, 'fmt.bdec': 20,
    'fmt.mix': -40, 'amp.dec': 46, 'amp.sus': 0, 'amp.rel': 36, 'fx.del': 35, 'fx.rev': 25,
  }),
  p('ORGAN FM', 'fmtone', 'keys', {
    'fmt.algo': 8, 'fmt.ratc': 1, 'fmt.rata': 2, 'fmt.ratb': 3, 'fmt.ratb2': 4, 'fmt.alev': 80, 'fmt.adec': 127, 'fmt.aend': 127,
    'fmt.blev': 64, 'fmt.bdec': 127, 'fmt.bend': 127, 'fmt.mix': 0, 'amp.sus': 127, 'amp.rel': 20, 'fx.cho': 60,
  }),
  p('GLASS PAD', 'fmtone', 'pad', {
    'fmt.algo': 3, 'fmt.ratc': 1, 'fmt.rata': 2, 'fmt.ratb': 4, 'fmt.ratb2': 1, 'fmt.alev': 30, 'fmt.aatk': 60, 'fmt.adec': 100,
    'fmt.aend': 80, 'fmt.blev': 22, 'fmt.dtun': 40, 'fmt.harm': 10, 'amp.atk': 64, 'amp.sus': 110, 'amp.rel': 92,
    'fx.cho': 70, 'fx.rev': 70, 'lfo1.dest': 'fmt.alev', 'lfo1.dep': 14, 'lfo1.spd': 12, 'lfo1.mul': 2,
  }),
  p('METAL LEAD', 'fmtone', 'lead', {
    'fmt.algo': 4, 'fmt.ratc': 1, 'fmt.rata': 3, 'fmt.ratb': 7, 'fmt.fdbk': 70, 'fmt.harm': 30, 'fmt.alev': 60, 'fmt.adec': 60,
    'fmt.aend': 40, 'fmt.blev': 40, 'trig.voic': 1, 'trig.port': 30, 'amp.sus': 100, 'fx.del': 40,
    'lfo1.dest': 'trig.ptch', 'lfo1.dep': 1.2, 'lfo1.spd': 48, 'lfo1.mul': 16, 'lfo1.wave': 'SIN',
  }),

  // --------------------------------------------------------------- WAVETONE
  p('SAW LEAD', 'wavetone', 'lead', {
    'wav.wav1': 64, 'wav.lev1': 100, 'wav.wav2': 64, 'wav.ofs2': 12, 'wav.lev2': 80, 'flt.frq': 80, 'flt.res': 40, 'flt.env': 30,
    'flt.dec': 50, 'trig.port': 20, 'trig.voic': 1, 'amp.sus': 100, 'fx.del': 30,
  }),
  p('VOX PAD', 'wavetone', 'pad', {
    'wav.tbl1': 'VOX', 'wav.tbl2': 'VOX', 'wav.wav1': 30, 'wav.wav2': 80, 'wav.ofs2': 9, 'wav.lev2': 70, 'wav.drft': 40,
    'amp.atk': 70, 'amp.sus': 110, 'amp.rel': 80, 'lfo1.dest': 'wav.wav1', 'lfo1.dep': 30, 'lfo1.spd': 10, 'lfo1.mul': 4,
    'fx.cho': 60, 'fx.rev': 60, 'amp.vol': 88,
  }),
  p('SYNC LEAD', 'wavetone', 'lead', {
    'wav.wav1': 64, 'wav.wav2': 64, 'wav.lev1': 60, 'wav.lev2': 110, 'wav.mode': 'SYNC', 'wav.mamt': 30, 'trig.voic': 1,
    'lfo1.dest': 'wav.mamt', 'lfo1.dep': 30, 'lfo1.mode': 'TRIG', 'lfo1.wave': 'EXP', 'lfo1.spd': 32, 'lfo1.mul': 8,
    'flt.frq': 100, 'amp.sus': 100,
  }),
  p('DIGI BASS', 'wavetone', 'bass', {
    'wav.tbl1': 'DIGI', 'wav.wav1': 40, 'wav.tun2': -12, 'wav.lev2': 90, 'flt.mach': 'LP4', 'flt.frq': 60, 'flt.res': 50,
    'flt.env': 40, 'flt.dec': 36, 'trig.voic': 1, 'trig.note': 36, 'amp.sus': 90,
  }),
  p('PWM STRINGS', 'wavetone', 'pad', {
    'wav.tbl1': 'PWM', 'wav.tbl2': 'PWM', 'wav.wav1': 40, 'wav.wav2': 60, 'wav.ofs2': 12, 'wav.lev2': 80,
    'lfo1.dest': 'wav.wav1', 'lfo1.dep': 24, 'lfo1.spd': 20, 'amp.atk': 50, 'amp.sus': 100, 'amp.rel': 70, 'fx.cho': 80,
    'flt.frq': 90,
  }),
  p('NOISE SWEEP', 'wavetone', 'fx', {
    'wav.lev1': 0, 'wav.nlev': 110, 'wav.ndec': 110, 'wav.nhld': 60, 'flt.frq': 60, 'flt.res': 90,
    'lfo1.dest': 'flt.frq', 'lfo1.dep': 40, 'lfo1.spd': 8, 'amp.atk': 60, 'amp.sus': 100, 'fx.rev': 70,
  }),
  p('ORGAN WT', 'wavetone', 'keys', { 'wav.tbl1': 'ORGN', 'wav.wav1': 60, 'wav.lev1': 110, 'amp.sus': 127, 'fx.cho': 50 }),

  // ---------------------------------------------------------------- SWARMER
  p('SUPERSAW', 'swarmer', 'pad', {
    'swm.dtun': 50, 'swm.mix': 20, 'swm.anim': 30, 'flt.frq': 100, 'amp.atk': 6, 'amp.sus': 100, 'amp.rel': 60,
    'fx.cho': 40, 'fx.rev': 40, 'amp.vol': 84,
  }),
  p('HOOVER', 'swarmer', 'lead', {
    'swm.mwav': 'SQR', 'swm.moct': -1, 'swm.dtun': 80, 'swm.mix': -10, 'trig.port': 50, 'trig.voic': 1,
    'flt.mach': 'LP4', 'flt.frq': 96, 'flt.res': 20, 'amp.sus': 110, 'fx.rev': 30,
  }),
  p('SWARM PAD', 'swarmer', 'pad', {
    'swm.swav': 'TRI', 'swm.mwav': 'TRI', 'swm.dtun': 30, 'swm.anim': 60, 'swm.arte': 30, 'swm.mix': 30,
    'amp.atk': 80, 'amp.sus': 110, 'amp.rel': 90, 'fx.rev': 80, 'fx.cho': 50, 'flt.frq': 84, 'amp.vol': 90,
  }),
  p('SUB BASS', 'swarmer', 'bass', {
    'swm.mwav': 'SIN', 'swm.mix': -64, 'swm.dtun': 4, 'trig.voic': 1, 'trig.note': 36, 'amp.sus': 110, 'amp.rel': 16, 'amp.vol': 104,
  }),
  p('DARK CHORD', 'swarmer', 'pad', {
    'swm.dtun': 36, 'swm.mix': 10, 'flt.mach': 'LP4', 'flt.frq': 58, 'flt.res': 26, 'flt.env': 22, 'flt.dec': 70,
    'amp.dec': 90, 'amp.sus': 40, 'amp.rel': 70, 'fx.del': 40, 'fx.rev': 50,
  }),
];

/** Full sound object for a preset name (throws if unknown). */
export function presetSound(name) {
  const pr = PRESETS.find((x) => x.name === name);
  if (!pr) throw new Error(`Unknown preset "${name}". Available: ${PRESETS.map((x) => x.name).join(', ')}`);
  const base = defaultSound(pr.machine, pr.name);
  return { name: pr.name, machine: pr.machine, params: { ...base.params, ...pr.params } };
}
