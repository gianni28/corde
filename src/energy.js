// How loud the song is over time, measured once from the decoded audio, so the stage can follow it:
// quiet verse → calm band and crowd, loud chorus → everyone jumping. Also a small beat finder for audio
// that comes without a chart (the menu music when its timing can't be matched to the chart).
const RATE = 20; // energy samples per second

/**
 * buffers: AudioBuffers (stems of one song, same timeline).
 * Returns { rate, slow, fast }: slow = section energy 0–1 (smoothed over ~1.5 s, so it moves a little ahead
 * of the music, like a band that knows the song), fast = punch 0–1 (hits above the recent level).
 */
export function energyCurve(buffers) {
  if (!buffers.length) return null;
  const sr = buffers[0].sampleRate;
  const dur = Math.max(...buffers.map((b) => b.duration));
  const n = Math.max(2, Math.ceil(dur * RATE));
  const sum = new Float64Array(n), cnt = new Uint32Array(n);
  const hop = sr / RATE, stride = 4;
  for (const b of buffers) {
    for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i += stride) { const k = (i / hop) | 0; const x = d[i]; sum[k] += x * x; cnt[k]++; }
    }
  }
  const db = new Float32Array(n);
  for (let k = 0; k < n; k++) db[k] = 10 * Math.log10(sum[k] / Math.max(1, cnt[k]) + 1e-10);
  // normalise to the song itself: its quiet parts → 0, its loudest parts → 1 (silence is left out)
  const loud = [...db].filter((x) => x > -62).sort((a, b) => a - b);
  const lo = loud.length ? loud[Math.floor(loud.length * 0.08)] : -60;
  const hi = loud.length ? loud[Math.floor(loud.length * 0.96)] : -10;
  const raw = new Float32Array(n);
  for (let k = 0; k < n; k++) raw[k] = Math.max(0, Math.min(1, (db[k] - lo) / Math.max(3, hi - lo)));
  const slow = movingAvg(raw, Math.round(RATE * 1.5));
  for (let k = 0; k < n; k++) slow[k] = Math.pow(slow[k], 1.15);
  const base = movingAvg(raw, Math.round(RATE * 0.5));
  const fast = new Float32Array(n);
  for (let k = 0; k < n; k++) fast[k] = Math.max(0, Math.min(1, (raw[k] - base[k]) * 4));
  return { rate: RATE, slow, fast };
}

function movingAvg(a, w) {
  const n = a.length, out = new Float32Array(n), h = Math.max(1, w >> 1);
  let s = 0, c = 0;
  for (let i = 0; i < Math.min(n, h); i++) { s += a[i]; c++; }
  for (let i = 0; i < n; i++) {
    if (i + h < n) { s += a[i + h]; c++; }
    if (i - h - 1 >= 0) { s -= a[i - h - 1]; c--; }
    out[i] = s / c;
  }
  return out;
}

/** Energy at time t (seconds on the curve's timeline): { e: slow, p: punch }. */
export function energyAt(curve, t, out = { e: 0.55, p: 0 }) {
  if (!curve) { out.e = 0.55; out.p = 0; return out; }
  const x = Math.max(0, t * curve.rate), i = Math.floor(x), f = x - i, n = curve.slow.length;
  const a = Math.min(n - 1, i), b = Math.min(n - 1, i + 1);
  out.e = curve.slow[a] + (curve.slow[b] - curve.slow[a]) * f;
  out.p = curve.fast[a] + (curve.fast[b] - curve.fast[a]) * f;
  return out;
}

/**
 * A beat grid for a piece of audio with no chart: onset strength at 100 fps → tempo by autocorrelation
 * (preferring 90–140 BPM) → the phase that lines up best. Returns [[t, isBarStart], …].
 */
export function beatGrid(buffer) {
  const sr = buffer.sampleRate, d = buffer.getChannelData(0), fps = 100, hop = Math.round(sr / fps);
  const n = Math.floor(d.length / hop);
  if (n < fps * 6) return [];
  const env = new Float32Array(n);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    let s = 0; for (let i = k * hop, e = i + hop; i < e; i += 2) s += d[i] * d[i];
    const l = Math.log10(s / (hop / 2) + 1e-9);
    env[k] = Math.max(0, l - prev); prev = l;
  }
  const m = movingAvg(env, fps);
  for (let k = 0; k < n; k++) env[k] = Math.max(0, env[k] - m[k]);
  let best = 50, bestS = -1;
  for (let lag = Math.round(fps * 0.33); lag <= Math.round(fps * 1.0); lag++) {
    let s = 0; for (let k = lag; k < n; k++) s += env[k] * env[k - lag];
    const bpm = 60 * fps / lag, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.5, 2));
    if (s * w > bestS) { bestS = s * w; best = lag; }
  }
  let ph = 0, phS = -1;
  for (let o = 0; o < best; o++) { let s = 0; for (let k = o; k < n; k += best) s += env[k]; if (s > phS) { phS = s; ph = o; } }
  // the bar starts on the strongest of the four beat positions
  const cls = [0, 0, 0, 0];
  for (let k = ph, i = 0; k < n; k += best, i++) cls[i % 4] += env[k] + (env[k - 1] || 0) + (env[k + 1] || 0);
  const bar = cls.indexOf(Math.max(...cls));
  const out = [];
  for (let k = ph, i = 0; k < n; k += best, i++) out.push([k / fps, i % 4 === bar ? 1 : 0]);
  return out;
}
