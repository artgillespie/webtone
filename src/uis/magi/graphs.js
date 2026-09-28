// Direct-manipulation graphs for MAGI. Every graph is also a controller:
//   EnvEditor     drag ATK / HOLD / DEC+SUS / REL handles
//   FilterEditor  drag the cutoff/resonance node; drag the base-width band edges
//   LfoView       drag vertically = depth, horizontally = speed
//   AlgoView      click = next FM algorithm
//   Scope         live waveform + spectrum ("SYNC GRAPH")
// All edits go through host.actions (lock-aware), so graphs also p-lock.

import { valueToHz, LFO_WAVES, PARAM_BY_ID } from '../../core/params.js';
import { ALGORITHMS } from '../../engine/machines/fmtone.js';

export const COL = {
  bg: '#040404', grid: 'rgba(255,106,0,0.16)', grid2: 'rgba(255,106,0,0.07)',
  or: '#ff6a00', or2: '#ffa040', gr: '#46ff8f', rd: '#ff2a3d', pu: '#9b5cff', wh: '#f4f1ea',
};
const MONO = '"Share Tech Mono", ui-monospace, monospace';
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';

class CanvasView {
  constructor(host, cls, testid) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'ev-cv ' + cls;
    if (testid) this.cv.dataset.testid = testid;
    this.ctx = this.cv.getContext('2d');
    this.w = 10; this.h = 10; this.dirty = true;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.cv);
  }
  get el() { return this.cv; }
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
    this.draw();
  }
  destroy() { this.ro.disconnect(); }
  clear() {
    const { ctx, w, h } = this;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COL.grid2; ctx.lineWidth = 1;
    for (let x = 0.5; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0.5; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }
  glowLine(pts, color, width = 1.8, blur = 10) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }
  label(text, x, y, color = COL.or, size = 11, font = COND) {
    const ctx = this.ctx;
    ctx.fillStyle = color; ctx.font = `600 ${size}px ${font}`; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }
  handle(x, y, active, color = COL.gr) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = active ? 14 : 6;
    ctx.fillStyle = COL.bg; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); ctx.stroke();
    if (active) { ctx.fillStyle = color; ctx.fillRect(x - 2, y - 2, 4, 4); }
    ctx.restore();
  }
  /** Generic handle dragging: handles() -> [{x,y,onDrag(px,py,e)}] */
  wireHandles() {
    const cv = this.cv;
    cv.addEventListener('pointermove', (e) => {
      if (this.drag) return;
      const r = cv.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      if ((hit && hit.key) !== this.hover) { this.hover = hit && hit.key; this.dirty = true; }
      cv.style.cursor = hit ? 'grab' : 'crosshair';
    });
    cv.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.dirty = true; } });
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top) || (this.fallbackHit && this.fallbackHit(e.clientX - r.left, e.clientY - r.top));
      if (!hit) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      this.drag = hit.key; this.hover = hit.key; this.dirty = true;
      this.host.store.beginGesture();
      const move = (ev) => { hit.onDrag(ev.clientX - r.left, ev.clientY - r.top, ev); this.dirty = true; };
      const up = () => { this.host.store.endGesture(); this.drag = null; cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); this.dirty = true; };
      cv.addEventListener('pointermove', move);
      cv.addEventListener('pointerup', up);
      move(e);
    });
  }
  hit(x, y) {
    let best = null, bd = 12;
    for (const hd of this.handles()) {
      const d = Math.hypot(hd.x - x, hd.y - y);
      if (d < bd) { bd = d; best = hd; }
    }
    return best;
  }
  val(id) { return this.host.actions.displayValue(id).value; }
  set(id, v) { this.host.actions.setParam(id, Math.round(Math.max(0, Math.min(127, v)) * 10) / 10); }
}

// ------------------------------------------------------------------ envelope
export class EnvEditor extends CanvasView {
  /** spec: { atk, hld?, dec, sus, rel, mode?, depth? } param ids */
  constructor(host, spec, testid) {
    super(host, 'ev-env', testid);
    this.spec = spec;
    this.wireHandles();
  }
  geom() {
    const s = this.spec, v = (k) => (s[k] ? +this.val(s[k]) : 0);
    const ahd = s.mode && this.val(s.mode) === 'AHD';
    const pad = 10, top = 22, bot = this.h - 12;
    const seg = (this.w - pad * 2) / (s.hld ? 4.4 : 3.4);
    const xA = pad + (v('atk') / 127) * seg;
    const xH = xA + (s.hld ? (v('hld') / 127) * seg : 0);
    const xD = xH + (v('dec') / 127) * seg;
    const susN = ahd ? 0 : v('sus') / 127;
    const ySus = bot - susN * (bot - top);
    const xS = xD + seg * 0.4;
    const xR = xS + (ahd ? 0 : (v('rel') / 127) * seg);
    return { ahd, pad, top, bot, seg, xA, xH, xD, xS, xR, ySus, susN };
  }
  handles() {
    const g = this.geom(), s = this.spec;
    const out = [{ key: 'atk', x: g.xA, y: g.top, onDrag: (x) => this.set(s.atk, ((x - g.pad) / g.seg) * 127) }];
    if (s.hld) out.push({ key: 'hld', x: g.xH + 0.01, y: g.top + 1, onDrag: (x) => this.set(s.hld, ((x - this.geom().xA) / g.seg) * 127) });
    out.push({
      key: 'dec', x: g.xD, y: g.ySus,
      onDrag: (x, y) => {
        const gg = this.geom();
        this.set(s.dec, ((x - gg.xH) / g.seg) * 127);
        if (!gg.ahd) this.set(s.sus, ((g.bot - y) / (g.bot - g.top)) * 127);
      },
    });
    if (!g.ahd) out.push({ key: 'rel', x: g.xR, y: g.bot, onDrag: (x) => this.set(s.rel, ((x - this.geom().xS) / g.seg) * 127) });
    return out;
  }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    this.clear();
    const g = this.geom();
    const curve = (x0, y0, x1, y1, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
      const f = i / n;
      return [x0 + (x1 - x0) * f, y1 + (y0 - y1) * Math.exp(-4.2 * f) - (y0 - y1) * Math.exp(-4.2) * f];
    });
    const pts = [[g.pad, g.bot], [g.xA, g.top], [g.xH, g.top], ...curve(g.xH, g.top, g.xD, g.ySus)];
    if (!g.ahd) pts.push([g.xS, g.ySus], ...curve(g.xS, g.ySus, g.xR, g.bot));
    else pts.push([g.xD, g.bot]);
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, g.top, 0, g.bot);
    grad.addColorStop(0, 'rgba(255,106,0,0.35)'); grad.addColorStop(1, 'rgba(255,106,0,0.02)');
    ctx.fillStyle = grad;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.lineTo(pts[pts.length - 1][0], g.bot); ctx.closePath(); ctx.fill();
    this.glowLine(pts, COL.or, 2);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(70,255,143,0.35)';
    for (const x of [g.xA, g.xH, g.xD, g.xS]) { ctx.beginPath(); ctx.moveTo(x, g.top - 6); ctx.lineTo(x, g.bot); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const hd of this.handles()) this.handle(hd.x, hd.y, this.hover === hd.key || this.drag === hd.key);
    const s = this.spec;
    this.label(g.ahd ? 'A-H-D' : s.hld ? 'A-H-D-S-R' : 'A-D-S-R', 8, 14, COL.or, 11);
    if (s.depth) {
      const d = +this.val(s.depth);
      this.label(`DEPTH ${d > 0 ? '+' : ''}${Math.round(d)}`, this.w - 70, 14, d ? COL.gr : COL.or, 11);
    }
  }
}

// ------------------------------------------------------------------ filter
export class FilterEditor extends CanvasView {
  constructor(host, testid) {
    super(host, 'ev-flt', testid);
    this.wireHandles();
  }
  xOf(v) { return 8 + (v / 127) * (this.w - 16); }
  vOf(x) { return ((x - 8) / (this.w - 16)) * 127; }
  handles() {
    const top = 20, bot = this.h - 20;
    const frq = +this.val('flt.frq'), res = +this.val('flt.res');
    const base = +this.val('flt.base'), wdth = +this.val('flt.wdth');
    const yRes = bot - (res / 127) * (bot - top);
    return [
      { key: 'cut', x: this.xOf(frq), y: yRes, onDrag: (x, y) => { this.set('flt.frq', this.vOf(x)); this.set('flt.res', ((bot - y) / (bot - top)) * 127); } },
      { key: 'base', x: this.xOf(base), y: this.h - 8, onDrag: (x) => this.set('flt.base', this.vOf(x)) },
      { key: 'wdth', x: this.xOf(Math.min(127, base + wdth)), y: this.h - 8, onDrag: (x) => this.set('flt.wdth', this.vOf(x) - +this.val('flt.base')) },
    ];
  }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    this.clear();
    const ctx = this.ctx, w = this.w, h = this.h;
    const snd = this.host.store.sound;
    const mach = snd.params['flt.mach'];
    const fc = valueToHz(+this.val('flt.frq'));
    const r = +this.val('flt.res') / 127, typ = +this.val('flt.typ') / 127;
    const baseV = +this.val('flt.base'), lpV = Math.min(127, baseV + +this.val('flt.wdth'));
    // base-width band
    ctx.fillStyle = 'rgba(155,92,255,0.10)';
    ctx.fillRect(this.xOf(baseV), 0, this.xOf(lpV) - this.xOf(baseV), h);
    ctx.strokeStyle = 'rgba(155,92,255,0.6)';
    for (const v of [baseV, lpV]) { ctx.beginPath(); ctx.moveTo(this.xOf(v), 0); ctx.lineTo(this.xOf(v), h); ctx.stroke(); }
    // decade grid labels
    for (const f of [100, 1000, 10000]) {
      const x = 8 + (Math.log2(f / 20) / 10) * (w - 16);
      ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, h - 16); ctx.stroke();
      this.label(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, h - 18, 'rgba(255,106,0,0.6)', 10);
    }
    const dbMin = -30, dbMax = 18, top = 20, bot = h - 20;
    const pts = [];
    for (let i = 0; i <= 140; i++) {
      const v = (i / 140) * 127;
      const f = valueToHz(v);
      const mag = filterMag(mach, f / fc, r, typ, f, valueToHz(baseV), valueToHz(lpV));
      const db = Math.max(dbMin, Math.min(dbMax, 20 * Math.log10(Math.max(1e-6, mag))));
      pts.push([this.xOf(v), bot - ((db - dbMin) / (dbMax - dbMin)) * (bot - top)]);
    }
    const y0 = bot - ((0 - dbMin) / (dbMax - dbMin)) * (bot - top);
    ctx.strokeStyle = COL.grid; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke(); ctx.setLineDash([]);
    const grad = ctx.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, 'rgba(70,255,143,0.28)'); grad.addColorStop(1, 'rgba(70,255,143,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.lineTo(w - 8, bot); ctx.lineTo(8, bot); ctx.fill();
    this.glowLine(pts, COL.gr, 2);
    const hs = this.handles();
    // crosshair to the cutoff node
    ctx.strokeStyle = 'rgba(255,106,0,0.5)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(hs[0].x, 0); ctx.lineTo(hs[0].x, h); ctx.moveTo(0, hs[0].y); ctx.lineTo(w, hs[0].y); ctx.stroke(); ctx.setLineDash([]);
    hs.forEach((hd, i) => this.handle(hd.x, hd.y, this.hover === hd.key || this.drag === hd.key, i ? COL.pu : COL.or));
    this.label(`${mach}  ${fc < 1000 ? fc.toFixed(0) + ' Hz' : (fc / 1000).toFixed(2) + ' kHz'}  RES ${Math.round(r * 127)}`, 8, 14, COL.or, 11);
  }
}

export function filterMag(mach, x, r, typ, f, base, lpw) {
  let mag;
  if (mach === 'COMB-' || mach === 'COMB+') {
    const g = (mach === 'COMB-' ? -1 : 1) * Math.min(0.95, r);
    const ph = 2 * Math.PI * x;
    mag = (1 / Math.hypot(1 - g * Math.cos(ph), g * Math.sin(ph))) * 0.5;
  } else if (mach === 'EQ') {
    const gain = ((typ * 127 - 64) / 64) * 18;
    mag = Math.pow(10, (gain * Math.exp(-Math.pow(Math.log2(x) * (0.3 + r * 8), 2))) / 20);
  } else {
    const q = 1 / (2 - 1.98 * r);
    const den = Math.hypot(1 - x * x, x / q);
    const lp = 1 / den, hp = (x * x) / den, bp = x / q / den;
    if (mach === 'LP4') mag = Math.pow(1 / Math.hypot(1 - x * x, x / Math.max(0.5, q * 0.8)), 2);
    else if (mach === 'LEGACY') mag = typ >= 0.5 ? hp : lp;
    else mag = typ < 0.5 ? lp * (1 - typ * 2) + bp * typ * 2 : bp * (2 - typ * 2) + hp * (typ * 2 - 1);
  }
  const xb = f / base, xl = f / lpw;
  if (base > 21) mag *= (xb * xb) / Math.hypot(1 - xb * xb, xb * 1.414);
  if (lpw < 19000) mag *= 1 / Math.hypot(1 - xl * xl, xl * 1.414);
  return mag;
}

// ------------------------------------------------------------------ LFO
export class LfoView extends CanvasView {
  constructor(host, n, testid) {
    super(host, 'ev-lfo', testid);
    this.n = n;
    this.fallbackHit = () => ({
      key: 'shape',
      onDrag: (x, y, e) => {
        if (!this._start) this._start = { x, y, dep: +this.val(`lfo${n}.dep`), spd: +this.val(`lfo${n}.spd`) };
        const s = this._start;
        this.host.actions.setParam(`lfo${n}.dep`, Math.round(Math.max(-64, Math.min(63, s.dep + ((s.y - y) / this.h) * 128))));
        this.host.actions.setParam(`lfo${n}.spd`, Math.round(Math.max(-64, Math.min(63, s.spd + ((x - s.x) / this.w) * 64))));
        void e;
      },
    });
    this.cv.addEventListener('pointerup', () => { this._start = null; });
    this.wireHandles();
  }
  handles() { return []; }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    this.clear();
    const p = (k) => this.val(`lfo${this.n}.${k}`);
    const wave = LFO_WAVES.indexOf(p('wave'));
    const dep = +p('dep') / 64, mid = this.h / 2 + 6;
    const cycles = 2, pts = [];
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * cycles + +p('sph') / 128;
      const ph = t - Math.floor(t);
      let v;
      switch (wave) {
        case 0: v = ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4; break;
        case 1: v = Math.sin(ph * 2 * Math.PI); break;
        case 2: v = ph < 0.5 ? 1 : -1; break;
        case 3: v = 1 - ph * 2; break;
        case 4: v = Math.pow(1 - ph, 4); break;
        case 5: v = ph; break;
        default: v = Math.sin(Math.floor(t * 4) * 12.9898) % 1;
      }
      pts.push([(i / 160) * this.w, mid - v * dep * (this.h / 2 - 16)]);
    }
    this.ctx.strokeStyle = COL.grid; this.ctx.beginPath(); this.ctx.moveTo(0, mid); this.ctx.lineTo(this.w, mid); this.ctx.stroke();
    this.glowLine(pts, dep ? COL.gr : 'rgba(70,255,143,0.35)', 1.8);
    const dest = p('dest');
    this.label(`LFO${this.n} → ${dest === 'none' ? '———' : PARAM_BY_ID[dest].label}`, 6, 13, dest === 'none' ? 'rgba(255,106,0,0.55)' : COL.or, 11);
  }
}

// ------------------------------------------------------------------ FM algorithm
export class AlgoView extends CanvasView {
  constructor(host, testid) {
    super(host, 'ev-algo', testid);
    this.cv.title = 'Click: next algorithm · Shift-click: previous';
    this.cv.addEventListener('click', (e) => {
      const cur = +this.val('fmt.algo');
      this.host.actions.setParam('fmt.algo', ((cur - 1 + (e.shiftKey ? 7 : 1)) % 8) + 1);
    });
  }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    this.clear();
    const ctx = this.ctx;
    const n = +this.val('fmt.algo') || 1;
    const algo = ALGORITHMS[n - 1];
    const ops = ['C', 'A', 'B1', 'B2'];
    const depth = { C: 0, A: 0, B1: 0, B2: 0 };
    for (let k = 0; k < 4; k++) for (const [dst, src] of algo.mods) depth[src] = Math.max(depth[src], depth[dst] + 1);
    const byDepth = {};
    for (const o of ops) (byDepth[depth[o]] ||= []).push(o);
    const bw = 34, bh = 20, colW = Math.min(64, (this.w - 50) / 4);
    const pos = {};
    for (const [d, list] of Object.entries(byDepth)) list.forEach((o, i) => { pos[o] = { x: 12 + d * colW, y: 30 + i * (bh + 12) }; });
    ctx.lineWidth = 1.5;
    for (const [dst, src] of algo.mods) {
      const a = pos[src], b = pos[dst];
      ctx.strokeStyle = COL.or; ctx.beginPath(); ctx.moveTo(a.x, a.y + bh / 2); ctx.lineTo(b.x + bw, b.y + bh / 2); ctx.stroke();
    }
    const busY = { X: this.h - 22, Y: this.h - 9 };
    for (const [bus, list] of [['X', algo.X], ['Y', algo.Y]]) {
      const c = bus === 'X' ? COL.or2 : COL.gr;
      for (const o of list) {
        const a = pos[o];
        const xo = a.x + bw / 2 + (bus === 'X' ? -4 : 4);
        this.glowLine([[xo, a.y + bh], [xo, busY[bus]], [this.w - 22, busY[bus]]], c, 1.4, 6);
      }
      this.label(bus, this.w - 16, busY[bus] + 4, c, 12);
    }
    for (const o of ops) {
      const a = pos[o];
      ctx.save();
      ctx.shadowColor = COL.or; ctx.shadowBlur = 8;
      ctx.fillStyle = algo.X.includes(o) || algo.Y.includes(o) ? 'rgba(255,106,0,0.9)' : COL.bg;
      ctx.strokeStyle = COL.or; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(a.x, a.y, bw, bh); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = algo.X.includes(o) || algo.Y.includes(o) ? '#000' : COL.or;
      ctx.font = `700 13px ${COND}`; ctx.textAlign = 'center';
      ctx.fillText(o, a.x + bw / 2, a.y + 15); ctx.textAlign = 'left';
      if (algo.fb === o) { ctx.strokeStyle = COL.rd; ctx.beginPath(); ctx.arc(a.x + bw / 2, a.y - 3, 6, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke(); }
    }
    ctx.font = `800 26px "Shippori Mincho B1", serif`;
    ctx.fillStyle = COL.wh;
    ctx.fillText(String(n), this.w - 30, 26);
    this.label('ALGORITHM', 8, 14, COL.or, 11);
  }
}

// ------------------------------------------------------------------ scope
export class Scope extends CanvasView {
  constructor(host, testid) { super(host, 'ev-scope', testid); }
  draw() {
    this.clear();
    const { ctx, w, h } = this;
    const a = this.host.audio;
    if (!a.analyser) { this.label('SIGNAL LOST — ENGINE OFFLINE', 10, h / 2, COL.rd, 16); return; }
    a.analyser.getByteFrequencyData(a.spectrum);
    const bins = 48, bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const f0 = Math.floor(Math.pow(a.spectrum.length, i / bins));
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow(a.spectrum.length, (i + 1) / bins)));
      let m = 0;
      for (let k = f0; k < f1 && k < a.spectrum.length; k++) m = Math.max(m, a.spectrum[k]);
      const bh = (m / 255) * (h - 20);
      ctx.fillStyle = m > 200 ? 'rgba(255,42,61,0.55)' : 'rgba(255,106,0,0.35)';
      ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    }
    a.analyser.getFloatTimeDomainData(a.scope);
    const d = a.scope;
    let start = 0;
    for (let i = 1; i < d.length / 2; i++) if (d[i - 1] < 0 && d[i] >= 0) { start = i; break; }
    const N = Math.min(d.length - start, 700), pts = [];
    for (let i = 0; i < N; i++) pts.push([(i / (N - 1)) * w, h / 2 - Math.max(-1, Math.min(1, d[start + i] * 1.8)) * (h / 2 - 6)]);
    this.glowLine(pts, COL.gr, 1.6, 12);
  }
}
