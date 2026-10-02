// Corde auto-charter: listens to a song and writes a playable Corde chart (v1) for all four difficulties.
// Pure module (no DOM): feed it mono samples. Runs in the browser and in Node.
//
// Pipeline
//   1. STFT → spectral flux (onset strength), band energies, spectral centroid, chroma, RMS
//   2. Tempo from autocorrelation of the onset envelope, then dynamic-programming beat tracking (Ellis 2007)
//   3. Beat grid (beats, 8ths, 16ths), each slot scored by nearby onset strength vs. a local adaptive level
//   4. Per difficulty: greedy pick of the strongest slots up to a target note density, nested Easy ⊂ … ⊂ Expert
//   5. Lanes follow the melodic contour (centroid height + pitch-class changes); chords on big accents; sustains on held sounds
//   6. Sections where the energy of the song changes

const DIFFS = [
  { key: "easy", lanes: 3, nps: 1.45, gap: 0.36, levels: [0, 1], chord: 0, susBeats: 2 },
  { key: "medium", lanes: 4, nps: 2.0, gap: 0.2, levels: [0, 1], chord: 0.04, susBeats: 2 },
  { key: "hard", lanes: 5, nps: 2.8, gap: 0.14, levels: [0, 1, 2], chord: 0.08, susBeats: 2 },
  { key: "expert", lanes: 5, nps: 3.6, gap: 0.095, levels: [0, 1, 2], chord: 0.12, susBeats: 2 },
];

const r3 = (x) => Math.round(x * 1000) / 1000;

/* ---------------- FFT (in-place radix-2) ---------------- */
function makeFFT(n) {
  const rev = new Uint32Array(n), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return (re, im) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  };
}

/* ---------------- 1. features ---------------- */
function analyze(x, rate, onProgress) {
  const N = 1024, H = 256;
  const frames = Math.max(1, Math.floor((x.length - N) / H));
  const fft = makeFFT(N), win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const bins = N / 2, hz = rate / N;
  const flux = new Float32Array(frames), low = new Float32Array(frames), rms = new Float32Array(frames), cent = new Float32Array(frames);
  const chroma = new Float32Array(frames * 12);
  const binPc = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) { const f = k * hz; if (f >= 80 && f <= 2000) binPc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; }
  const lowMax = Math.round(200 / hz), centLo = Math.round(150 / hz), centHi = Math.round(5000 / hz);
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let t = 0; t < frames; t++) {
    const o = t * H;
    let e = 0;
    for (let i = 0; i < N; i++) { const s = x[o + i]; e += s * s; re[i] = s * win[i]; im[i] = 0; }
    rms[t] = Math.sqrt(e / N);
    fft(re, im);
    let fl = 0, lw = 0, cNum = 0, cDen = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const lm = Math.log1p(100 * m);
      cur[k] = lm;
      const d = lm - prev[k];
      if (d > 0) { fl += d; if (k <= lowMax) lw += d; }
      if (k >= centLo && k <= centHi) { cNum += m * Math.log2(k * hz); cDen += m; }
      if (binPc[k] >= 0) chroma[t * 12 + binPc[k]] += m;
    }
    flux[t] = fl; low[t] = lw; cent[t] = cDen > 1e-9 ? cNum / cDen : 0;
    const sw = prev; prev = cur; cur = sw;
    if (onProgress && t % 2000 === 0) onProgress(t / frames);
  }
  return { frames, fps: rate / H, flux, low, rms, cent, chroma };
}

function movingMean(a, w) {
  const out = new Float32Array(a.length); let s = 0;
  const half = w >> 1;
  for (let i = 0; i < Math.min(a.length, half); i++) s += a[i];
  for (let i = 0; i < a.length; i++) {
    const add = i + half, rem = i - half - 1;
    if (add < a.length) s += a[add];
    if (rem >= 0) s -= a[rem];
    const n = Math.min(a.length - 1, i + half) - Math.max(0, i - half) + 1;
    out[i] = s / n;
  }
  return out;
}

/* ---------------- 2. tempo + beats ---------------- */
function onsetEnvelope(f) {
  const m = movingMean(f.flux, Math.round(f.fps * 0.4));
  const env = new Float32Array(f.frames);
  let sum = 0, sum2 = 0;
  for (let i = 0; i < f.frames; i++) { const v = Math.max(0, f.flux[i] - m[i]); env[i] = v; sum += v; sum2 += v * v; }
  const mean = sum / f.frames, sd = Math.sqrt(Math.max(1e-12, sum2 / f.frames - mean * mean));
  for (let i = 0; i < f.frames; i++) env[i] /= sd;
  return env;
}

function estimatePeriod(env, fps) {
  const minLag = Math.floor((60 / 200) * fps), maxLag = Math.ceil((60 / 60) * fps);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  let best = minLag, bestV = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); // favour ~120 BPM, gently
    // reward lags whose double also correlates (true beat vs. off-beat)
    const v = (ac[lag] + 0.5 * (ac[Math.min(maxLag + 1, lag * 2)] || 0)) * prior;
    if (v > bestV) { bestV = v; best = lag; }
  }
  const a = ac[best - 1] || 0, b = ac[best], c = ac[best + 1] || 0;
  const den = a - 2 * b + c;
  let lag = den < 0 ? best + (0.5 * (a - c)) / den : best;
  // octave correction: most songs sit between ~70 and ~165 BPM
  let bpm = (60 * fps) / lag;
  while (bpm > 165) { lag *= 2; bpm /= 2; }
  while (bpm < 70) { lag /= 2; bpm *= 2; }
  return lag;
}

function trackBeats(env, period) {
  const n = env.length, tight = 100;
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, arg = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const d = Math.log((t - tau) / period);
      const v = score[tau] - tight * d * d;
      if (v > best || arg < 0) { best = v; arg = tau; }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  let end = n - 1, bestEnd = -Infinity;
  for (let t = Math.max(0, n - Math.round(period * 2)); t < n; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t; }
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) { beats.push(t); if (back[t] < 0) break; }
  beats.reverse();
  // extend the grid backwards/forwards at the local period so intros/outros still have beats
  const fill = [];
  if (beats.length) {
    let p = beats[0] - period; while (p > 0) { fill.unshift(Math.round(p)); p -= period; }
  }
  return [...fill, ...beats];
}

/* ---------------- helpers ---------------- */
function peakNear(env, frame, r) {
  let m = 0; for (let i = Math.max(0, frame - r); i <= Math.min(env.length - 1, frame + r); i++) if (env[i] > m) m = env[i];
  return m;
}
function localMedian(values, times, i, span) {
  const arr = [];
  for (let j = i; j >= 0 && times[i] - times[j] <= span; j--) arr.push(values[j]);
  for (let j = i + 1; j < values.length && times[j] - times[i] <= span; j++) arr.push(values[j]);
  arr.sort((a, b) => a - b);
  return arr[arr.length >> 1] || 0;
}

/* ---------------- main ---------------- */
export function autoChart(samples, rate, meta = {}, onProgress) {
  const f = analyze(samples, rate, (p) => onProgress && onProgress("analyze", p));
  const env = onsetEnvelope(f);
  const period = estimatePeriod(env, f.fps);
  const beatFrames = trackBeats(env, period);
  onProgress && onProgress("notes", 0);
  const toSec = (fr) => fr / f.fps + 512 / rate / 2; // frame centre
  const beats = beatFrames.map(toSec);
  const beatLen = period / f.fps;

  // silence mask: frames below a fraction of the typical loudness don't get notes
  const sortedRms = Float32Array.from(f.rms).sort();
  const rmsMed = sortedRms[sortedRms.length >> 1] || 1e-6;
  const loud = (fr) => f.rms[Math.max(0, Math.min(f.frames - 1, fr))] > rmsMed * 0.18;

  // downbeat phase: beat index (mod 4) with the most low-end attack
  const phaseScore = [0, 0, 0, 0];
  beatFrames.forEach((fr, i) => (phaseScore[i % 4] += peakNear(f.low, fr, 2)));
  const phase = phaseScore.indexOf(Math.max(...phaseScore));

  // 3. grid slots
  const slots = [];
  for (let i = 0; i < beatFrames.length; i++) {
    const a = beatFrames[i], b = i + 1 < beatFrames.length ? beatFrames[i + 1] : a + period;
    for (const [frac, level] of [[0, 0], [0.25, 2], [0.5, 1], [0.75, 2]]) {
      const fr = Math.round(a + (b - a) * frac);
      if (fr >= f.frames || !loud(fr)) continue;
      slots.push({ fr, t: toSec(fr), level, strength: peakNear(env, fr, 2), down: frac === 0 && (i - phase) % 4 === 0, beat: i });
    }
  }
  const times = slots.map((s) => s.t), strengths = slots.map((s) => s.strength);
  slots.forEach((s, i) => { s.z = s.strength - localMedian(strengths, times, i, 4); });
  const activeSeconds = Math.max(1, new Set(slots.map((s) => Math.floor(s.t))).size);

  // 4. selection per difficulty (nested)
  const chosen = {};
  let carry = new Set();
  for (const d of DIFFS) {
    const target = Math.round(d.nps * activeSeconds);
    const cand = slots
      .map((s, i) => ({ s, i, score: s.z + (s.level === 0 ? 0.7 : s.level === 1 ? 0.3 : 0) + (s.down ? 0.3 : 0) }))
      .filter((c) => d.levels.includes(c.s.level) && c.s.strength > 0.25)
      .sort((a, b) => b.score - a.score);
    const pick = new Set(carry);
    const taken = [...pick].map((i) => slots[i].t).sort((a, b) => a - b);
    const ok = (t) => {
      let lo = 0, hi = taken.length; while (lo < hi) { const m = (lo + hi) >> 1; if (taken[m] < t) lo = m + 1; else hi = m; }
      return (lo >= taken.length || taken[lo] - t >= d.gap) && (lo === 0 || t - taken[lo - 1] >= d.gap);
    };
    for (const c of cand) {
      if (pick.size >= target) break;
      if (pick.has(c.i) || !ok(c.s.t)) continue;
      pick.add(c.i);
      let lo = 0, hi = taken.length; while (lo < hi) { const m = (lo + hi) >> 1; if (taken[m] < c.s.t) lo = m + 1; else hi = m; }
      taken.splice(lo, 0, c.s.t);
    }
    chosen[d.key] = [...pick].sort((a, b) => a - b);
    carry = pick;
  }

  // 5. lanes, chords, sustains
  const pcAt = (fr) => {
    const c = new Float32Array(12);
    for (let k = fr; k < Math.min(f.frames, fr + 4); k++) for (let p = 0; p < 12; p++) c[p] += f.chroma[k * 12 + p];
    let best = 0; for (let p = 1; p < 12; p++) if (c[p] > c[best]) best = p;
    return best;
  };
  const heightAt = (fr) => { let s = 0, n = 0; for (let k = fr; k < Math.min(f.frames, fr + 4); k++) if (f.cent[k]) { s += f.cent[k]; n++; } return n ? s / n : 0; };
  const slotPc = slots.map((s) => pcAt(s.fr)), slotH = slots.map((s) => heightAt(s.fr));
  const zSorted = slots.map((s) => s.z).sort((a, b) => b - a);

  const diffs = {};
  for (const d of DIFFS) {
    const idx = chosen[d.key];
    const notes = [];
    const nl = d.lanes;
    const chordCut = d.chord ? zSorted[Math.floor(zSorted.length * d.chord)] ?? Infinity : Infinity;
    let prevLane = Math.floor(nl / 2), prevPc = -1, prevH = 0, prevT = -9;
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], s = slots[i];
      // local height range → base lane
      let lo = Infinity, hi = -Infinity;
      for (let k = Math.max(0, j - 12); k < Math.min(idx.length, j + 12); k++) { const h = slotH[idx[k]]; if (h < lo) lo = h; if (h > hi) hi = h; }
      const norm = hi > lo ? (slotH[i] - lo) / (hi - lo) : 0.5;
      let lane = Math.round(norm * (nl - 1));
      const pc = slotPc[i];
      if (prevPc >= 0) {
        const quick = s.t - prevT < 0.32;
        if (pc === prevPc && quick) lane = prevLane;               // same note repeated fast → same fret
        else if (lane === prevLane) lane = prevLane + (slotH[i] > prevH ? 1 : slotH[i] < prevH ? -1 : (j % 2 ? 1 : -1)); // otherwise move with the contour
        if (lane > nl - 1) lane = prevLane - 1;
        if (lane < 0) lane = prevLane + 1;
        const maxJump = nl === 3 ? 1 : 2;
        lane = Math.max(prevLane - maxJump, Math.min(prevLane + maxJump, lane));
      }
      lane = Math.max(0, Math.min(nl - 1, lane));
      const t = s.t;
      // sustain if the sound keeps ringing until the next note
      const nextT = j + 1 < idx.length ? slots[idx[j + 1]].t : t + beatLen * 4;
      const gap = nextT - t;
      let dur = 0;
      if (gap >= beatLen * d.susBeats) {
        const fr0 = s.fr, fr1 = Math.min(f.frames - 1, s.fr + Math.round((gap * f.fps) / 2));
        let held = 0, act = 0, cnt = 0;
        for (let k = fr0 + 3; k <= fr1; k++) { held += f.rms[k]; act += env[k]; cnt++; }
        // ringing (loudness holds) without new attacks in between → a held note
        if (cnt && held / cnt > f.rms[fr0] * 0.6 && act / cnt < 0.45) dur = Math.max(0, gap - Math.min(beatLen * 0.25, 0.18));
      }
      notes.push([r3(t), lane, r3(dur)]);
      if (s.z >= chordCut && s.level === 0 && nl >= 4) {
        const other = lane + 2 <= nl - 1 ? lane + 2 : lane - 2;
        if (other >= 0) notes.push([r3(t), other, r3(dur)]);
      }
      prevLane = lane; prevPc = pc; prevH = slotH[i]; prevT = s.t;
    }
    notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    diffs[d.key] = { lanes: [...new Set(notes.map((n) => n[1]))].sort((a, b) => a - b), notes };
  }

  // 6. sections where the bar energy changes noticeably
  const bars = [];
  for (let i = phase; i + 4 < beatFrames.length; i += 4) {
    let s = 0, n = 0; for (let k = beatFrames[i]; k < beatFrames[i + 4]; k++) { s += f.rms[k]; n++; }
    bars.push({ t: beats[i], e: n ? s / n : 0 });
  }
  const sections = [];
  let lastIdx = -99;
  for (let i = 4; i + 4 <= bars.length; i++) {
    const before = bars.slice(i - 4, i).reduce((a, b) => a + b.e, 0) / 4;
    const after = bars.slice(i, i + 4).reduce((a, b) => a + b.e, 0) / 4;
    if (i - lastIdx >= 8 && before > 0 && Math.abs(after - before) / before > 0.3) { sections.push([r3(bars[i].t), ""]); lastIdx = i; }
  }
  if (bars.length) sections.unshift([r3(bars[0].t), ""]);

  const lastNote = Math.max(0, ...Object.values(diffs).flatMap((d) => d.notes.map((n) => n[0] + n[2])));
  const beatList = beats.filter((t) => t <= lastNote + 8).map((t, i) => [r3(t), (i - phase) % 4 === 0 ? 1 : 0]);
  return {
    v: 1,
    meta: { ...meta, charter: "Corde (automático)" },
    sections,
    beats: beatList,
    diffs,
    auto: { bpm: Math.round((60 * f.fps) / period * 10) / 10 },
  };
}

/**
 * How far the chart is from the audio: finds the shift (seconds, within ±maxShift) that best lines the chart's
 * notes up with the attacks heard in the audio. Positive = the audio runs later than the chart.
 * Returns { offset, confidence } where confidence compares the best peak with the typical score.
 */
export function estimateOffset(samples, rate, noteTimes, maxShift = 0.6) {
  const f = analyze(samples, rate);
  const env = onsetEnvelope(f);
  const centre = 512 / rate / 2;
  const at = (sec) => { const x = (sec - centre) * f.fps; const i = Math.floor(x); if (i < 0 || i + 1 >= env.length) return 0; const w = x - i; return env[i] * (1 - w) + env[i + 1] * w; };
  const times = [...new Set(noteTimes.map((t) => Math.round(t * 1000)))].map((t) => t / 1000);
  const scores = [];
  let best = 0, bestS = -Infinity;
  for (let ms = -maxShift * 1000; ms <= maxShift * 1000; ms += 2) {
    const d = ms / 1000; let s = 0;
    for (const t of times) s += Math.max(at(t + d - 0.012), at(t + d), at(t + d + 0.012));
    scores.push(s);
    if (s > bestS) { bestS = s; best = d; }
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] || 1;
  return { offset: Math.round(best * 1000) / 1000, confidence: bestS / median };
}
