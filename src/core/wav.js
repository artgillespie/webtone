// WAV encoding + simple signal statistics. Pure; used by the browser
// (export) and Node tools/tests.

/** Encode stereo Float32 channels to a 16-bit PCM WAV (Uint8Array). */
export function encodeWav(L, R, sampleRate) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); o += 2;
    v.setInt16(o, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 2;
  }
  return new Uint8Array(buf);
}

/**
 * Basic stats for a render: peak, rms (dBFS), non-finite count, DC offset,
 * crude spectral centroid (zero-crossing based) and silent ratio.
 */
export function analyze(L, R = L, sampleRate = 48000) {
  let peak = 0, sum = 0, nonFinite = 0, dc = 0, zc = 0, silent = 0;
  const n = L.length;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nonFinite++; continue; }
    const m = (l + r) * 0.5;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
    sum += m * m;
    dc += m;
    if ((m >= 0) !== (prev >= 0)) zc++;
    if (a < 1e-4) silent++;
    prev = m;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return {
    seconds: n / sampleRate,
    peak: +peak.toFixed(4),
    peakDb: +db(peak).toFixed(1),
    rmsDb: +db(rms).toFixed(1),
    dcOffset: +(dc / Math.max(1, n)).toFixed(5),
    zeroCrossHz: Math.round((zc / 2) / (n / sampleRate)),
    silentRatio: +(silent / Math.max(1, n)).toFixed(3),
    nonFinite,
  };
}

/** RMS of a window (dBFS) — handy for onset/timing tests. */
export function windowRms(L, start, len) {
  let s = 0;
  const end = Math.min(L.length, start + len);
  for (let i = start; i < end; i++) s += L[i] * L[i];
  return Math.sqrt(s / Math.max(1, end - start));
}
