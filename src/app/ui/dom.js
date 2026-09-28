// Tiny DOM helpers (no framework).

/** h('div.cls#id', {attrs, on: {click}}, ...children) */
export function h(sel, props = {}, ...kids) {
  if (typeof props !== 'object' || props === null || Array.isArray(props) || props instanceof Node) { kids.unshift(props); props = {}; }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export const $ = (s, root = document) => root.querySelector(s);

/** Set only if changed (avoids layout thrash in rAF loops). */
export function setText(el, t) { if (el._t !== t) { el._t = t; el.textContent = t; } }
export function setClass(el, cls, on) { if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }
export function setStyle(el, prop, v) { if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v); }

let toastTimer = 0;
export function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 4000 : 1800);
}

/** Vertical drag helper for number displays. onDelta(stepsDelta, fine) */
export function dragNumber(el, onDelta, pxPerStep = 6) {
  let startY = 0, acc = 0;
  el.addEventListener('pointerdown', (e) => {
    startY = e.clientY; acc = 0;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const d = (startY - ev.clientY) / (ev.shiftKey ? pxPerStep * 4 : pxPerStep);
      const whole = Math.trunc(d - acc);
      if (whole) { acc += whole; onDelta(whole, ev.shiftKey); }
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); onDelta(e.deltaY < 0 ? 1 : -1, e.shiftKey); }, { passive: false });
}

export const SVG = {
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>',
  rec: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>',
  undo: '<svg viewBox="0 0 16 16"><path d="M6 3L2 7l4 4V8.5c3 0 5 .8 6.5 3.5-.4-3.6-2.6-6-6.5-6.5z"/></svg>',
  redo: '<svg viewBox="0 0 16 16"><path d="M10 3l4 4-4 4V8.5c-3 0-5 .8-6.5 3.5.4-3.6 2.6-6 6.5-6.5z"/></svg>',
};
