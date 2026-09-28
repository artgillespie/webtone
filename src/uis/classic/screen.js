// The display: an amber-phosphor canvas that shows the current page's 8
// parameters plus a page-specific visual (FM algorithm, envelope, filter
// response, LFO shape, or a live oscilloscope/spectrum).

import { pageParams, getDef, formatValue, valueHint, MACHINES, FILTER_LABELS, valueToHz, valueToTime, PARAM_BY_ID, LFO_WAVES, LFO_MULTS, noteName } from '../../core/params.js';
import { ALGORITHMS } from '../../engine/machines/fmtone.js';
import { TEL } from '../../engine/engine.js';

const C = {
  bg: '#0c0906',
  ph: '#ffb347',
  phDim: 'rgba(255,179,71,0.45)',
  phFaint: 'rgba(255,179,71,0.14)',
  hot: '#fff1d6',
  teal: '#3fe0c5',
  orange: '#ff6a1a',
};
const MONO = '"Share Tech Mono", "SF Mono", Menlo, monospace';
const WIDE = 'Michroma, "Chakra Petch", sans-serif';

export class Screen {
  constructor(canvas, app) {
    this.cv = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.focus = null; // { id, until }
    this.hover = null;
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(200, r.width); this.h = Math.max(150, r.height);
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    if (this.app.store) this.draw(); // resizing clears the canvas
  }

  destroy() { this.ro.disconnect(); }

  touch(id) { this.focus = { id, until: performance.now() + 1400 }; }

  draw() {
    const { ctx, w, h } = this;
    const { store, actions, audio } = this.app;
    const ui = store.ui;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    const snd = store.sound;
    const page = ui.page;
    const ids = pageParams(page, snd.machine) || [];
    const fltMach = snd.params['flt.mach'];

    // ---------------------------------------------------------------- header
    ctx.textBaseline = 'middle';
    ctx.font = `13px ${MONO}`;
    this.glow(6);
    ctx.fillStyle = C.ph;
    const tn = 'T' + String(ui.track + 1).padStart(2, '0');
    ctx.fillText(`${tn}  ${MACHINES[snd.machine].name}  ·  ${snd.name}`, 14, 16);
    ctx.textAlign = 'right';
    const tel = audio.telemetry;
    const playing = tel[TEL.PLAYING] > 0.5;
    ctx.fillText(`${store.project.current}  ${store.project.tempo.toFixed(1)} BPM`, w - 14, 16);
    ctx.textAlign = 'left';
    this.glow(0);
    // page label pill
    ctx.font = `10px ${WIDE}`;
    const pl = page;
    const pw = ctx.measureText(pl).width + 16;
    const px = w / 2 - pw / 2;
    ctx.fillStyle = C.ph;
    roundRect(ctx, px, 7, pw, 18, 4); ctx.fill();
    ctx.fillStyle = C.bg;
    ctx.textAlign = 'center';
    ctx.fillText(pl, w / 2, 16.5);
    ctx.textAlign = 'left';
    // lock banner
    if (ui.selected.size) {
      ctx.fillStyle = C.teal;
      ctx.font = `11px ${MONO}`;
      const steps = [...ui.selected].sort((a, b) => a - b).map((s) => s + 1);
      ctx.fillText(`◆ P-LOCK ${steps.length > 4 ? steps.length + ' STEPS' : 'STEP ' + steps.join(',')}`, 14, 36);
    } else if (ui.recording) {
      ctx.fillStyle = '#ff5a4e';
      ctx.font = `11px ${MONO}`;
      ctx.fillText(playing ? '● LIVE REC' : `● STEP REC @ ${ui.recCursor + 1}`, 14, 36);
    }
    ctx.strokeStyle = C.phFaint;
    ctx.beginPath(); ctx.moveTo(10, 29.5); ctx.lineTo(w - 10, 29.5); ctx.stroke();

    // --------------------------------------------------------------- visual
    const vis = { x: 14, y: 44, w: w - 28, h: Math.max(60, h * 0.5 - 50) };
    const now = performance.now();
    const focus = (this.hover && { id: this.hover }) || (this.focus && this.focus.until > now ? this.focus : null);
    if (focus && focus.id) this.drawFocus(vis, focus.id);
    else if (page === 'SYN1' && snd.machine === 'fmtone') this.drawAlgo(vis, snd);
    else if (page === 'AMP') this.drawEnv(vis, snd, 'amp');
    else if (page === 'FLTR1' || page === 'FLTR2') this.drawFilter(vis, snd);
    else if (page.startsWith('LFO')) this.drawLfo(vis, snd, page.slice(3));
    else this.drawScope(vis);

    // ---------------------------------------------------------------- params
    const gy = vis.y + vis.h + 10;
    const cellW = (w - 28) / 4, cellH = (h - gy - 8) / 2;
    ids.forEach((id, i) => {
      const x = 14 + (i % 4) * cellW, y = gy + Math.floor(i / 4) * cellH;
      this.drawCell(x, y, cellW - 8, cellH - 6, id, i, fltMach);
    });
  }

  glow(b) { this.ctx.shadowBlur = b; this.ctx.shadowColor = b ? 'rgba(255,170,60,0.75)' : 'transparent'; }

  drawCell(x, y, w, h, id, slot, fltMach) {
    const ctx = this.ctx;
    const { actions } = this.app;
    ctx.strokeStyle = C.phFaint;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w, h, 5); ctx.stroke();
    if (!id) {
      ctx.fillStyle = C.phFaint; ctx.font = `10px ${MONO}`;
      ctx.fillText('—', x + 10, y + h / 2);
      return;
    }
    const def = getDef(id);
    const { value, locked } = actions.displayValue(id);
    const label = (FILTER_LABELS[fltMach] && FILTER_LABELS[fltMach][id]) || def.label;
    const active = this.hover === id || (this.focus && this.focus.id === id && this.focus.until > performance.now());
    if (locked || active) {
      ctx.fillStyle = locked ? C.ph : 'rgba(255,179,71,0.12)';
      roundRect(ctx, x + 0.5, y + 0.5, w, h, 5); ctx.fill();
    }
    const fg = locked ? C.bg : C.ph;
    ctx.fillStyle = locked ? C.bg : C.phDim;
    ctx.font = `9px ${WIDE}`;
    ctx.fillText(`${'ABCDEFGH'[slot]} ${label}`, x + 8, y + 12);
    // value
    let text = def.type === 'dest' ? (value === 'none' ? '--' : (PARAM_BY_ID[value] ? PARAM_BY_ID[value].label : '--')) : formatValue(def, value);
    ctx.fillStyle = fg;
    this.glow(locked ? 0 : 7);
    ctx.font = `${Math.min(26, h * 0.42)}px ${MONO}`;
    ctx.fillText(text, x + 8, y + h * 0.58);
    this.glow(0);
    // bar
    if (def.type === 'num') {
      const n = (value - def.min) / (def.max - def.min || 1);
      const bw = w - 16, by = y + h - 8;
      ctx.fillStyle = locked ? 'rgba(12,9,6,0.3)' : C.phFaint;
      ctx.fillRect(x + 8, by, bw, 3);
      ctx.fillStyle = fg;
      if (def.bipolar) {
        const c = x + 8 + bw / 2;
        const e = x + 8 + n * bw;
        ctx.fillRect(Math.min(c, e), by, Math.abs(e - c), 3);
      } else ctx.fillRect(x + 8, by, n * bw, 3);
    }
  }

  drawFocus(v, id) {
    const ctx = this.ctx;
    const def = getDef(id);
    const { value, locked } = this.app.actions.displayValue(id);
    ctx.fillStyle = C.phDim;
    ctx.font = `11px ${WIDE}`;
    ctx.fillText(def.name.toUpperCase(), v.x, v.y + 14);
    this.glow(12);
    ctx.fillStyle = locked ? C.teal : C.ph;
    ctx.font = `${Math.min(64, v.h * 0.6)}px ${MONO}`;
    const txt = def.type === 'dest' ? (PARAM_BY_ID[value] ? PARAM_BY_ID[value].name : 'NONE') : formatValue(def, value);
    ctx.fillText(txt, v.x, v.y + v.h * 0.58);
    this.glow(0);
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = C.phDim;
    const hint = def.type === 'num' || def.type === 'enum' ? valueHint(def, value) : '';
    ctx.fillText(`${locked ? 'LOCKED · ' : ''}${hint}  [${def.id}]`, v.x, v.y + v.h - 6);
  }

  drawScope(v) {
    const { ctx } = this;
    const a = this.app.audio;
    // frame
    ctx.strokeStyle = C.phFaint;
    ctx.beginPath(); ctx.moveTo(v.x, v.y + v.h / 2); ctx.lineTo(v.x + v.w, v.y + v.h / 2); ctx.stroke();
    if (!a.analyser) {
      ctx.fillStyle = C.phDim; ctx.font = `12px ${MONO}`;
      ctx.fillText('AUDIO OFF — PRESS POWER', v.x + 4, v.y + v.h / 2 - 10);
      return;
    }
    // spectrum (faint bars)
    a.analyser.getByteFrequencyData(a.spectrum);
    const bins = 64;
    const bw = v.w / bins;
    ctx.fillStyle = 'rgba(255,179,71,0.12)';
    for (let i = 0; i < bins; i++) {
      const f0 = Math.floor(Math.pow(a.spectrum.length, i / bins));
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow(a.spectrum.length, (i + 1) / bins)));
      let m = 0;
      for (let k = f0; k < f1 && k < a.spectrum.length; k++) m = Math.max(m, a.spectrum[k]);
      const bh = (m / 255) * v.h;
      ctx.fillRect(v.x + i * bw + 1, v.y + v.h - bh, bw - 2, bh);
    }
    // scope
    a.analyser.getFloatTimeDomainData(a.scope);
    const d = a.scope;
    let start = 0;
    for (let i = 1; i < d.length / 2; i++) if (d[i - 1] < 0 && d[i] >= 0) { start = i; break; }
    const N = Math.min(d.length - start, 900);
    this.glow(8);
    ctx.strokeStyle = C.ph; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = v.x + (i / (N - 1)) * v.w;
      const y = v.y + v.h / 2 - Math.max(-1, Math.min(1, d[start + i] * 1.6)) * (v.h / 2 - 2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    this.glow(0);
    ctx.lineWidth = 1;
  }

  drawEnv(v, snd) {
    const p = (id) => snd.params[id];
    const ctx = this.ctx;
    const ahd = p('amp.mode') === 'AHD';
    const tt = (x) => Math.log10(1 + valueToTime(x) * 20);
    const segs = [tt(p('amp.atk')), tt(p('amp.hld')) * (p('amp.hld') > 0 ? 1 : 0), tt(p('amp.dec')), ahd ? 0 : 0.6, ahd ? 0 : tt(p('amp.rel'))];
    const total = segs.reduce((a, b) => a + b, 0) || 1;
    const sx = v.w / total;
    const sus = ahd ? 0 : p('amp.sus') / 127;
    const top = v.y + 6, bot = v.y + v.h - 4, H = bot - top;
    const pts = [[0, 0]];
    let x = 0;
    x += segs[0]; pts.push([x, 1]);
    x += segs[1]; pts.push([x, 1]);
    const decEnd = x + segs[2];
    for (let i = 1; i <= 20; i++) { const f = i / 20; pts.push([x + segs[2] * f, sus + (1 - sus) * Math.exp(-4.6 * f)]); }
    x = decEnd;
    if (!ahd) {
      x += segs[3]; pts.push([x, sus]);
      const rs = x;
      for (let i = 1; i <= 20; i++) { const f = i / 20; pts.push([rs + segs[4] * f, sus * Math.exp(-4.6 * f)]); }
    }
    this.polyline(pts.map(([px, py]) => [v.x + px * sx, bot - py * H]), bot);
    ctx.fillStyle = C.phDim; ctx.font = `10px ${MONO}`;
    ctx.fillText(ahd ? 'AHD' : 'ADSR', v.x + v.w - 40, v.y + 12);
  }

  drawFilter(v, snd) {
    const ctx = this.ctx;
    const p = (id) => snd.params[id];
    const mach = p('flt.mach');
    const fc = valueToHz(p('flt.frq'));
    const r = p('flt.res') / 127;
    const typ = p('flt.typ') / 127;
    const base = valueToHz(p('flt.base')), lpw = valueToHz(Math.min(127, p('flt.base') + p('flt.wdth')));
    const pts = [];
    const N = 160;
    const dbMin = -36, dbMax = 18;
    for (let i = 0; i <= N; i++) {
      const f = 20 * Math.pow(1024, i / N);
      const x = f / fc;
      let mag;
      if (mach === 'COMB-' || mach === 'COMB+') {
        const g = (mach === 'COMB-' ? -1 : 1) * Math.min(0.95, r);
        const ph = 2 * Math.PI * (f / fc);
        mag = 1 / Math.hypot(1 - g * Math.cos(ph), g * Math.sin(ph)) * 0.5;
      } else if (mach === 'EQ') {
        const gain = ((typ * 127 - 64) / 64) * 18;
        const bw = 0.3 + r * 8;
        mag = Math.pow(10, (gain * Math.exp(-Math.pow(Math.log2(x) * bw, 2))) / 20);
      } else {
        const q = 1 / (2 - 1.98 * r);
        const den = Math.hypot(1 - x * x, x / q);
        const lp = 1 / den, hp = (x * x) / den, bp = (x / q) / den;
        if (mach === 'LP4') mag = Math.pow(1 / Math.hypot(1 - x * x, x / Math.max(0.5, q * 0.8)), 2);
        else if (mach === 'LEGACY') mag = typ >= 0.5 ? hp : lp;
        else mag = typ < 0.5 ? lp * (1 - typ * 2) + bp * typ * 2 : bp * (2 - typ * 2) + hp * (typ * 2 - 1);
      }
      // base-width
      const xb = f / base, xl = f / lpw;
      if (base > 21) mag *= (xb * xb) / Math.hypot(1 - xb * xb, xb * 1.414);
      if (lpw < 19000) mag *= 1 / Math.hypot(1 - xl * xl, xl * 1.414);
      const db = 20 * Math.log10(Math.max(1e-6, mag));
      const y = v.y + v.h - ((Math.max(dbMin, Math.min(dbMax, db)) - dbMin) / (dbMax - dbMin)) * v.h;
      pts.push([v.x + (i / N) * v.w, y]);
    }
    // grid
    ctx.strokeStyle = C.phFaint;
    for (const f of [100, 1000, 10000]) {
      const gx = v.x + (Math.log(f / 20) / Math.log(1024)) * v.w;
      ctx.beginPath(); ctx.moveTo(gx, v.y); ctx.lineTo(gx, v.y + v.h); ctx.stroke();
    }
    const y0 = v.y + v.h - ((0 - dbMin) / (dbMax - dbMin)) * v.h;
    ctx.beginPath(); ctx.moveTo(v.x, y0); ctx.lineTo(v.x + v.w, y0); ctx.stroke();
    this.polyline(pts, v.y + v.h);
    ctx.fillStyle = C.phDim; ctx.font = `10px ${MONO}`;
    ctx.fillText(`${mach}  ${fc < 1000 ? fc.toFixed(0) + 'Hz' : (fc / 1000).toFixed(2) + 'kHz'}`, v.x + 4, v.y + 12);
  }

  drawLfo(v, snd, n) {
    const ctx = this.ctx;
    const p = (k) => snd.params[`lfo${n}.${k}`];
    const wave = LFO_WAVES.indexOf(p('wave'));
    const dep = p('dep') / 64;
    const cycles = 2;
    const pts = [];
    const mid = v.y + v.h / 2;
    let rnd = 0.3;
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * cycles + p('sph') / 128;
      const ph = t - Math.floor(t);
      if (i && ph < ((i - 1) / 200 * cycles + p('sph') / 128) % 1) rnd = Math.sin(i * 12.9898) * 0.9;
      let val;
      switch (wave) {
        case 0: val = ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4; break;
        case 1: val = Math.sin(ph * 2 * Math.PI); break;
        case 2: val = ph < 0.5 ? 1 : -1; break;
        case 3: val = 1 - ph * 2; break;
        case 4: val = Math.pow(1 - ph, 4); break;
        case 5: val = ph; break;
        default: val = rnd;
      }
      pts.push([v.x + (i / 200) * v.w, mid - val * dep * (v.h / 2 - 4)]);
    }
    ctx.strokeStyle = C.phFaint;
    ctx.beginPath(); ctx.moveTo(v.x, mid); ctx.lineTo(v.x + v.w, mid); ctx.stroke();
    this.polyline(pts, false);
    const dest = p('dest');
    const spd = p('spd'), mul = p('mul');
    const cps = (Math.abs(spd) * mul) / 2048;
    ctx.fillStyle = C.phDim; ctx.font = `10px ${MONO}`;
    ctx.fillText(`→ ${dest === 'none' ? 'NO DEST' : PARAM_BY_ID[dest].name.toUpperCase()}   ${cps > 0 ? (1 / cps).toFixed(cps > 1 ? 2 : 1) + ' steps/cycle' : 'stopped'}   ${p('mode')}`, v.x + 4, v.y + 12);
  }

  drawAlgo(v, snd) {
    const ctx = this.ctx;
    const algo = ALGORITHMS[(snd.params['fmt.algo'] || 1) - 1];
    const ops = ['C', 'A', 'B1', 'B2'];
    // layout: carriers bottom, modulators stacked above by depth
    const depth = { C: 0, A: 0, B1: 0, B2: 0 };
    for (let k = 0; k < 4; k++) for (const [dst, src] of algo.mods) depth[src] = Math.max(depth[src], depth[dst] + 1);
    const cols = {};
    const byDepth = {};
    for (const o of ops) (byDepth[depth[o]] ||= []).push(o);
    // horizontal layout: carriers (depth 0) on the left, modulators to the right
    const bw = 40, bh = 20, colW = 78;
    for (const [d, list] of Object.entries(byDepth)) {
      list.forEach((o, i) => { cols[o] = { x: v.x + 16 + d * colW, y: v.y + 30 + i * (bh + 14) }; });
    }
    ctx.strokeStyle = C.phDim; ctx.lineWidth = 1.4;
    for (const [dst, src] of algo.mods) {
      const a = cols[src], b = cols[dst];
      ctx.beginPath(); ctx.moveTo(a.x, a.y + bh / 2); ctx.lineTo(b.x + bw, b.y + bh / 2); ctx.stroke();
    }
    ctx.lineWidth = 1;
    // outputs: drop from each tapped op to the X / Y bus lines at the bottom
    const busY = { X: v.y + v.h - 22, Y: v.y + v.h - 8 };
    const busEnd = v.x + v.w - 30;
    for (const [bus, list] of [['X', algo.X], ['Y', algo.Y]]) {
      ctx.strokeStyle = bus === 'X' ? C.ph : C.teal;
      for (const o of list) {
        const a = cols[o];
        const xo = a.x + bw / 2 + (bus === 'X' ? -4 : 4);
        ctx.beginPath(); ctx.moveTo(xo, a.y + bh); ctx.lineTo(xo, busY[bus]); ctx.lineTo(busEnd, busY[bus]); ctx.stroke();
      }
      ctx.fillStyle = bus === 'X' ? C.ph : C.teal;
      ctx.font = `11px ${WIDE}`;
      ctx.fillText(bus, busEnd + 6, busY[bus] + 1);
    }
    for (const o of ops) {
      const a = cols[o];
      const isFb = algo.fb === o;
      ctx.fillStyle = C.bg;
      ctx.strokeStyle = C.ph;
      this.glow(6);
      roundRect(ctx, a.x, a.y, bw, bh, 4); ctx.fill(); ctx.stroke();
      this.glow(0);
      ctx.fillStyle = C.ph; ctx.font = `12px ${MONO}`; ctx.textAlign = 'center';
      ctx.fillText(o, a.x + bw / 2, a.y + bh / 2 + 1);
      ctx.textAlign = 'left';
      if (isFb) {
        ctx.strokeStyle = C.orange;
        ctx.beginPath(); ctx.arc(a.x + bw / 2, a.y - 3, 6, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke();
      }
    }
    ctx.fillStyle = C.phDim; ctx.font = `10px ${MONO}`;
    ctx.fillText(`ALGO ${snd.params['fmt.algo']}   C:${snd.params['fmt.ratc']} A:${snd.params['fmt.rata']} B1:${snd.params['fmt.ratb']} B2:${snd.params['fmt.ratb2']}`, v.x + 4, v.y + 12);
  }

  /** Glowing polyline; if `fillTo` (a y coordinate) is given, fill beneath it. */
  polyline(pts, fillTo) {
    const ctx = this.ctx;
    this.glow(9);
    ctx.strokeStyle = C.ph; ctx.lineWidth = 1.8;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    this.glow(0);
    ctx.lineWidth = 1;
    if (fillTo) {
      const last = pts[pts.length - 1], first = pts[0];
      const g = ctx.createLinearGradient(0, Math.min(...pts.map((p) => p[1])), 0, fillTo);
      g.addColorStop(0, 'rgba(255,179,71,0.22)'); g.addColorStop(1, 'rgba(255,179,71,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(last[0], fillTo); ctx.lineTo(first[0], fillTo);
      ctx.fill();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

void noteName; void LFO_MULTS;
