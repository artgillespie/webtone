// Gauge — MAGI's direct-manipulation parameter readout (replaces knobs).
//
//   ┌ FREQ ────────── 1.02k ┐
//   │ 72                     │   drag anywhere (vertical/horizontal, relative),
//   │ ▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯   │   click/drag on the bar = absolute, wheel,
//   └────────────────────────┘   arrows, dbl-click = default. Enums: click cycles.
//
// A gauge is bound to a "binding": { def, get() -> {value, locked}, set(v), reset() }.
// soundBinding/fxBinding build the common ones on top of host.actions, so
// parameter locks (selected steps) work automatically.

import { h } from '../../app/ui/dom.js';
import { getDef, formatValue, valueHint, toNum, toJson, destinationsFor, PARAM_BY_ID, FILTER_LABELS } from '../../core/params.js';

export function soundBinding(host, id, trackFn = () => host.store.ui.track) {
  const base = getDef(id);
  return {
    id,
    get def() {
      if (base.type !== 'dest') return base;
      const snd = host.store.pattern.kit.sounds[trackFn()];
      const opts = ['none', ...destinationsFor(snd.machine).map((p) => p.id)];
      return { ...base, type: 'enum', options: opts, max: opts.length - 1, dest: true };
    },
    label() {
      const mach = host.store.pattern.kit.sounds[trackFn()].params['flt.mach'];
      return (FILTER_LABELS[mach] && FILTER_LABELS[mach][id]) || base.label;
    },
    get: () => host.actions.displayValue(id, trackFn()),
    set: (v) => host.actions.setParam(id, v, { track: trackFn() }),
    reset: () => (trackFn() === host.store.ui.track ? host.actions.resetParam(id) : host.actions.setParam(id, base.def, { track: trackFn() })),
  };
}

export function fxBinding(host, id) {
  const def = getDef(id);
  return {
    id, def, label: () => def.label,
    get: () => ({ value: host.store.pattern.kit.fx[id], locked: false }),
    set: (v) => host.actions.setFx(id, v),
    reset: () => host.actions.setFx(id, def.def),
  };
}

/** Binding for an arbitrary value (pattern length, micro timing, ...). */
export function customBinding(def, get, set) {
  return { id: def.id, def, label: () => def.label, get: () => ({ value: get(), locked: false }), set, reset: () => set(def.def) };
}

/** Set by the plugin on mount so gauges can group drags into one undo step. */
export class Gauge {
  static store = null;
  constructor(binding, { cls = '', title, store } = {}) {
    this.store = store || Gauge.store;
    this.b = binding;
    this.lbl = h('span.ev-g-lbl');
    this.hint = h('span.ev-g-hint');
    this.val = h('div.ev-g-val');
    this.fill = h('i');
    this.bar = h('div.ev-g-bar', this.fill);
    this.el = h('div.ev-g' + cls, { tabindex: 0, role: 'slider', 'data-param': binding.id, title: title || binding.def.name },
      h('div.ev-g-top', this.lbl, this.hint), this.val, this.bar);
    this.num = 0;
    this._last = '';
    this._wire();
  }

  update() {
    const def = this.b.def;
    const { value, locked } = this.b.get();
    if (value === undefined) { this.el.style.visibility = 'hidden'; return; }
    this.el.style.visibility = '';
    this.num = toNum(def, value);
    const key = `${value}|${locked}|${def.options ? def.options.length : ''}`;
    if (key === this._last) return;
    this._last = key;
    this.lbl.textContent = this.b.label ? this.b.label() : def.label;
    let text = def.dest ? (value === 'none' ? '———' : (PARAM_BY_ID[value] ? PARAM_BY_ID[value].label : value)) : formatValue(def, value);
    this.val.textContent = text;
    this.hint.textContent = locked ? 'LOCK' : def.type === 'num' && def.hint ? valueHint(def, value) : '';
    const span = def.max - def.min || 1;
    const norm = (this.num - def.min) / span;
    if (def.bipolar) {
      const c = 0.5, e = norm;
      this.fill.style.left = (Math.min(c, e) * 100).toFixed(2) + '%';
      this.fill.style.width = (Math.abs(e - c) * 100).toFixed(2) + '%';
    } else {
      this.fill.style.left = '0';
      this.fill.style.width = (norm * 100).toFixed(2) + '%';
    }
    this.el.classList.toggle('locked', !!locked);
    this.el.classList.toggle('enum', def.type !== 'num');
    this.el.setAttribute('aria-valuemin', def.min);
    this.el.setAttribute('aria-valuemax', def.max);
    this.el.setAttribute('aria-valuenow', this.num);
    this.el.setAttribute('aria-valuetext', text);
    this.el.setAttribute('aria-label', def.name);
  }

  _emit(n) {
    const def = this.b.def;
    n = Math.min(def.max, Math.max(def.min, n));
    if (def.type !== 'num' || def.int) n = Math.round(n);
    if (Math.abs(n - this.num) < 1e-6) return;
    this.num = n;
    this.b.set(toJson(def, n));
    this.el.classList.add('flash');
    clearTimeout(this._ft);
    this._ft = setTimeout(() => this.el.classList.remove('flash'), 160);
  }

  _step(dir, fine) {
    const def = this.b.def;
    const discrete = def.type !== 'num' || def.int;
    this._emit(this.num + dir * (discrete ? 1 : fine ? 0.1 : Math.max(1, (def.max - def.min) / 127)));
  }

  _wire() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      const def = this.b.def;
      const discrete = def.type !== 'num';
      const onBar = !discrete && (e.target === this.bar || e.target === this.fill);
      const x0 = e.clientX, y0 = e.clientY, n0 = this.num;
      let moved = false;
      el.classList.add('drag');
      this.store && this.store.beginGesture();
      const abs = (ev) => {
        const r = this.bar.getBoundingClientRect();
        const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
        this._emit(def.min + t * (def.max - def.min));
      };
      if (onBar) abs(e);
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = y0 - ev.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        if (onBar) return abs(ev);
        const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (discrete) this._emit(n0 + Math.trunc(d / (ev.shiftKey ? 40 : 16)));
        else this._emit(n0 + (d / (ev.shiftKey ? 900 : 200)) * (def.max - def.min));
      };
      const up = (ev) => {
        el.classList.remove('drag');
        this.store && this.store.endGesture();
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (!moved && discrete) {
          // click cycles enums / toggles bools
          const n = def.max - def.min + 1;
          this._emit(((this.num - def.min + (ev.shiftKey ? -1 : 1) + n) % n) + def.min);
        }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this._step(e.deltaY < 0 ? 1 : -1, e.shiftKey); }, { passive: false });
    el.addEventListener('dblclick', () => this.b.reset());
    el.addEventListener('keydown', (e) => {
      const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (e.key in map) { e.preventDefault(); e.stopPropagation(); this._step(map[e.key], e.shiftKey); }
      else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); this._emit(this.b.def.min); }
      else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); this._emit(this.b.def.max); }
    });
  }
}

/** Build gauges for a list of ids into a container; returns the Gauge list. */
export function gaugeGrid(host, ids, container, opts = {}) {
  const out = [];
  for (const id of ids) {
    if (!id) continue;
    const g = new Gauge(soundBinding(host, id, opts.trackFn), opts);
    out.push(g);
    container.append(g.el);
  }
  return out;
}
