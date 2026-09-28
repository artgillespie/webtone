// Knob: vertical-drag / wheel / keyboard encoder bound to a param definition.
// Accessible (role=slider, arrow keys, Home/End) — also makes it scriptable.
//
//   const k = new Knob({ small, onInput: (jsonValue, def) => ..., onReset: (def) => ... })
//   k.bind(def, jsonValue, { locked })

import { h } from './dom.js';
import { toNum, toJson, formatValue } from '../../core/params.js';

export class Knob {
  constructor({ small = false, onInput, onReset, onHover } = {}) {
    this.def = null;
    this.num = 0;
    this.onInput = onInput;
    this.onReset = onReset;
    this.el = h('div.knob' + (small ? '.sm' : ''), { tabindex: 0, role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': 127 });
    this._wire(onHover);
  }

  bind(def, value, { locked = false } = {}) {
    this.def = def;
    this.el.dataset.param = def ? def.id : '';
    if (!def) { this.el.style.setProperty('--v', 0); this.el.setAttribute('aria-label', 'empty'); return; }
    const n = def.type === 'dest' ? 0 : toNum(def, value);
    this.num = n;
    const span = def.type === 'dest' ? 1 : def.max - def.min || 1;
    const norm = def.type === 'dest' ? 0 : (n - def.min) / span;
    this.el.style.setProperty('--v', norm.toFixed(4));
    this.el.classList.toggle('bi', !!def.bipolar);
    this.el.classList.toggle('neg', !!def.bipolar && norm < 0.5);
    this.el.classList.toggle('locked', locked);
    this.el.setAttribute('aria-label', def.name);
    this.el.setAttribute('aria-valuemin', def.min);
    this.el.setAttribute('aria-valuemax', def.max);
    this.el.setAttribute('aria-valuenow', n);
    this.el.setAttribute('aria-valuetext', formatValue(def, value));
  }

  _emit(n) {
    const d = this.def;
    if (!d) return;
    n = Math.min(d.max, Math.max(d.min, n));
    if (d.type === 'enum' || d.type === 'bool' || d.int) n = Math.round(n);
    if (n === this.num) return;
    this.num = n;
    this.onInput && this.onInput(toJson(d, n), d);
  }

  _step(dir, fine) {
    const d = this.def;
    if (!d || d.type === 'dest') return;
    const discrete = d.type !== 'num' || d.int;
    const inc = discrete ? 1 : fine ? 0.1 : Math.max(1, (d.max - d.min) / 127);
    this._emit(this.num + dir * inc);
  }

  _wire(onHover) {
    const el = this.el;
    let startY = 0, startN = 0, acc = 0;
    el.addEventListener('pointerdown', (e) => {
      if (!this.def || e.button !== 0) return;
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      startY = e.clientY; startN = this.num; acc = 0;
      const d = this.def;
      const discrete = d.type !== 'num' || d.int;
      const move = (ev) => {
        const dy = startY - ev.clientY;
        if (discrete) {
          const px = d.type === 'num' ? 3 : 14;
          this._emit(startN + Math.trunc(dy / (ev.shiftKey ? px * 3 : px)));
        } else {
          const range = d.max - d.min;
          this._emit(startN + (dy / (ev.shiftKey ? 900 : 180)) * range);
        }
      };
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      void acc;
    });
    el.addEventListener('wheel', (e) => {
      if (!this.def) return;
      e.preventDefault();
      this._step(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    }, { passive: false });
    el.addEventListener('dblclick', () => { if (this.def && this.onReset) this.onReset(this.def); });
    el.addEventListener('keydown', (e) => {
      if (!this.def) return;
      const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (e.key in map) { e.preventDefault(); e.stopPropagation(); this._step(map[e.key], e.shiftKey); }
      else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); this._emit(this.def.min); }
      else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); this._emit(this.def.max); }
    });
    if (onHover) {
      el.addEventListener('pointerenter', () => onHover(this.def, true));
      el.addEventListener('pointerleave', () => onHover(this.def, false));
    }
  }
}
