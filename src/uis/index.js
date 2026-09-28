// UI plugin registry. Each entry lazy-loads a plugin module (see README.md).
// Order = order in the UI switcher; `\` cycles through them.

export const UIS = [
  {
    id: 'classic',
    name: 'CLASSIC',
    description: 'Hardware-faithful panel: display, 8 encoders, trig keys.',
    load: () => import('./classic/index.js'),
  },
  {
    id: 'magi',
    name: 'MAGI',
    description: 'Direct-manipulation command center. Every parameter, graph and step is editable in place.',
    load: () => import('./magi/index.js'),
  },
];

export const DEFAULT_UI = 'magi';
