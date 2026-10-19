// How loud the song is over time, measured once from the decoded audio, so the stage can follow it:
// quiet verse → calm band and crowd, loud chorus → everyone jumping. Also a small beat finder for audio
// that comes without a chart (the menu music when its timing can't be matched to the chart).
const RATE = 20; // energy samples per second

/**
 * buffers: AudioBuffers (stems of one song, same timeline); noteTimes: the chart's note times on that timeline (optional).
 * Returns { rate, slow, fast, calm }:
 *  - slow = how intense the song is, 0–1, smoothed over ~1.5 s (so it moves a little ahead of the music, like a band
 *    that knows the song). Three things go into it: how loud this part is compared to the rest of the song, how loud it
 *    really is (a metal song's "quiet" verse is still loud), and how busy the chart is (a chorus full of notes is intense).
 *  - fast = punch 0–1 (hits above the recent level).
 *  - calm = 0–1, a part that is really calm: clearly quieter than the song's loud parts, not loud for real, not too busy.
 *    Only then do the lighters come out (a metal song's verses stay loud for real, so they don't; a ballad's verses do).
 */
export function energyCurve(buffers, noteTimes = null) {
  if (!buffers.length) return null;
  const sr = buffers[0].sampleRate;
  const dur = Math.max(...buffers.map((b) => b.duration));
  const n = Math.max(2, Math.ceil(dur * RATE));
  const hop = sr / RATE, stride = 4;
  // power of the mix: each stem's mean power added up (stems play together)
  const mix = new Float64Array(n);
  for (const b of buffers) {
    const sum = new Float64Array(n), cnt = new Uint32Array(n);
    for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i += stride) { const k = (i / hop) | 0; const x = d[i]; sum[k] += x * x; cnt[k]++; }
    }
    for (let k = 0; k < n; k++) if (cnt[k]) mix[k] += sum[k] / cnt[k];
  }
  const db = new Float32Array(n);
  for (let k = 0; k < n; k++) db[k] = 10 * Math.log10(mix[k] + 1e-10);
  // against the song itself: its quiet parts → 0, its loudest parts → 1 (silence is left out)
  const loud = [...db].filter((x) => x > -62).sort((a, b) => a - b);
  const lo = loud.length ? loud[Math.floor(loud.length * 0.08)] : -60;
  const hi = loud.length ? loud[Math.floor(loud.length * 0.96)] : -10;
  const raw = new Float32Array(n), abs = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    raw[k] = clamp01((db[k] - lo) / Math.max(3, hi - lo));
    abs[k] = clamp01((db[k] + 34) / 20); // for real: about -34 dBFS (a soft intro) → 0, -14 dBFS (a loud mastered chorus) → 1
  }
  // how busy the chart is: notes per second over ~3 s, 1 or less → 0, 7 or more → 1
  let dens = null;
  if (noteTimes?.length) {
    const per = new Float32Array(n);
    for (const t of noteTimes) { const k = Math.floor(t * RATE); if (k >= 0 && k < n) per[k]++; }
    dens = movingAvg(per, RATE * 3);
    for (let k = 0; k < n; k++) dens[k] = clamp01((dens[k] * RATE - 1) / 6);
  }
  const mood = new Float32Array(n);
  for (let k = 0; k < n; k++) mood[k] = dens ? 0.4 * raw[k] + 0.25 * abs[k] + 0.35 * dens[k] : 0.62 * raw[k] + 0.38 * abs[k];
  const slow = movingAvg(mood, Math.round(RATE * 1.5));
  for (let k = 0; k < n; k++) slow[k] = Math.pow(slow[k], 1.1);
  const rawS = movingAvg(raw, RATE * 2), absS = movingAvg(abs, RATE * 2);
  const calmRaw = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    // gentle songs are mastered loud too (a soft verse of a ballad sits near a metal verse in level), so "soft for real"
    // only rules out the really loud, and a busy chart (an arpeggio) only weighs a little: what counts most is being
    // clearly quieter than the song's own loud parts
    const soft = 1 - smooth(0.78, 0.97, absS[k]), sparse = dens ? 1 - 0.4 * smooth(0.55, 1, dens[k]) : 1, quieter = 1 - smooth(0.32, 0.6, rawS[k]);
    calmRaw[k] = soft * sparse * quieter;
  }
  const calm = movingAvg(calmRaw, RATE * 3); // no flicker: a calm part has to last
  const base = movingAvg(raw, Math.round(RATE * 0.5));
  const fast = new Float32Array(n);
  for (let k = 0; k < n; k++) fast[k] = clamp01((raw[k] - base[k]) * 4);
  return { rate: RATE, slow, fast, calm };
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

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

/** Energy at time t (seconds on the curve's timeline): { e: slow, p: punch, c: calm }. */
export function energyAt(curve, t, out = { e: 0.55, p: 0, c: 0 }) {
  if (!curve) { out.e = 0.55; out.p = 0; out.c = 0; return out; }
  const x = Math.max(0, t * curve.rate), i = Math.floor(x), f = x - i, n = curve.slow.length;
  const a = Math.min(n - 1, i), b = Math.min(n - 1, i + 1);
  out.e = curve.slow[a] + (curve.slow[b] - curve.slow[a]) * f;
  out.p = curve.fast[a] + (curve.fast[b] - curve.fast[a]) * f;
  out.c = curve.calm ? curve.calm[a] + (curve.calm[b] - curve.calm[a]) * f : 0;
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
