// Corde auto-charter: listens to a song and writes a playable Corde chart (v1) for all four difficulties.
// Pure module (no DOM): feed it mono samples. Runs in the browser and in Node.
//
// Pipeline (v2, tuned against the hand-made Clone Hero charts in the library)
//   1. STFT → spectral flux (onset strength), band energies, chroma, RMS
//   2. Tempo from autocorrelation of the onset envelope, then dynamic-programming beat tracking (Ellis 2007)
//   3. Attacks actually heard (peaks of the onset envelope), snapped to the 16th-note grid when close;
//      attacks where the pitch content changes (a new chord/note, not just a drum hit) weigh more
//   4. Expert = the clear attacks, so the density follows the song; easier levels keep the strongest,
//      most on-beat notes of the level above (Easy ⊂ Medium ⊂ Hard ⊂ Expert)
//   5. Lanes follow the bass line: same note → same fret, up/down with the interval; chords on big accents;
//      sustains on held sounds
//   6. Sections where the energy of the song changes

// ratio: share of the expert notes kept; min/max: notes per second of music; gap: shortest distance between notes
const DIFFS = [
  { key: "easy", lanes: 3, ratio: 0.4, min: 0.7, max: 1.7, gap: 0.33, chord: 0, meter: 1.2 },
  { key: "medium", lanes: 4, ratio: 0.58, min: 1.0, max: 2.5, gap: 0.19, chord: 0.1, meter: 0.8 },
  { key: "hard", lanes: 5, ratio: 0.8, min: 1.3, max: 3.5, gap: 0.13, chord: 0.16, meter: 0.5 },
  { key: "expert", lanes: 5, ratio: 1, min: 1.6, max: 5.5, gap: 0.09, chord: 0.22, meter: 0.3 },
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

/* ---------------- pitch at a moment (for lanes) ---------------- */
// Bass pitch class just after an attack, from a long FFT (fine enough to tell low notes apart).
function makeBassPc(x, rate) {
  const NF = 4096, fft = makeFFT(NF), win = new Float32Array(NF);
  for (let i = 0; i < NF; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NF);
  const hz = rate / NF, lo = Math.ceil(50 / hz), hi = Math.floor(300 / hz);
  const pcBin = new Int8Array(hi + 1);
  for (let k = lo; k <= hi; k++) pcBin[k] = ((Math.round(12 * Math.log2((k * hz) / 440)) % 12) + 12 + 9) % 12;
  const re = new Float32Array(NF), im = new Float32Array(NF), c = new Float64Array(12);
  return (t) => {
    const o = Math.round((t + 0.015) * rate);
    for (let i = 0; i < NF; i++) { re[i] = (x[o + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    c.fill(0);
    for (let k = lo; k <= hi; k++) c[pcBin[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    let best = 0; for (let p = 1; p < 12; p++) if (c[p] > c[best]) best = p;
    return best;
  };
}

/* ---------------- main ---------------- */
export function autoChart(samples, rate, meta = {}, onProgress) {
  const f = analyze(samples, rate, (p) => onProgress && onProgress("analyze", p));
  const env = onsetEnvelope(f);
  const period = estimatePeriod(env, f.fps);
  const beatFrames = trackBeats(env, period);
  onProgress && onProgress("notes", 0);
  // frame → seconds; the flux peaks ~15 ms before the attack is heard, measured against hand-made charts
  const toSec = (fr) => fr / f.fps + 512 / rate / 2 + 0.015;
  const beats = beatFrames.map(toSec);
  const beatLen = period / f.fps;

  // silence mask: frames below a fraction of the typical loudness don't get notes
  const sortedRms = Float32Array.from(f.rms).sort();
  const rmsMed = sortedRms[sortedRms.length >> 1] || 1e-6;
  const loud = (fr) => f.rms[Math.max(0, Math.min(f.frames - 1, fr))] > rmsMed * 0.18;
  let loudFrames = 0; for (let i = 0; i < f.frames; i++) if (f.rms[i] > rmsMed * 0.18) loudFrames++;
  const activeSeconds = Math.max(1, loudFrames / f.fps);

  // downbeat phase: beat index (mod 4) with the most low-end attack
  const phaseScore = [0, 0, 0, 0];
  beatFrames.forEach((fr, i) => (phaseScore[i % 4] += peakNear(f.low, fr, 2)));
  const phase = phaseScore.indexOf(Math.max(...phaseScore));

  // 3. 16th-note grid
  const grid = [];
  for (let i = 0; i < beatFrames.length; i++) {
    const a = beatFrames[i], b = i + 1 < beatFrames.length ? beatFrames[i + 1] : a + period;
    for (const [frac, level] of [[0, 0], [0.25, 2], [0.5, 1], [0.75, 2]]) grid.push({ fr: a + (b - a) * frac, level, down: frac === 0 && (((i - phase) % 4) + 4) % 4 === 0 });
  }
  const gridT = grid.map((g) => toSec(g.fr));

  // 4. attacks actually heard: peaks of the onset envelope, snapped to the grid when close
  const half = Math.round(f.fps * 0.2), snap = 0.035;
  const bySlot = new Map();
  for (let t = 3; t < f.frames - 3; t++) {
    const v = env[t];
    if (v <= 0.3 || !loud(t)) continue;
    let isMax = true; for (let u = t - 3; u <= t + 3; u++) if (env[u] > v) { isMax = false; break; }
    if (!isMax) continue;
    let m = 0, c = 0; for (let u = Math.max(0, t - half); u <= Math.min(f.frames - 1, t + half); u++) { m += env[u]; c++; }
    const strength = v - m / c;
    if (strength <= 0) continue;
    const sec = toSec(t);
    let lo = 0, hi = gridT.length; while (lo < hi) { const md = (lo + hi) >> 1; if (gridT[md] < sec) lo = md + 1; else hi = md; }
    let gi = lo; if (gi > 0 && (gi >= gridT.length || sec - gridT[gi - 1] < gridT[gi] - sec)) gi--;
    const onGrid = gi >= 0 && gi < gridT.length && Math.abs(gridT[gi] - sec) <= snap;
    const key = onGrid ? gi : -t - 1;
    const cand = { t: onGrid ? gridT[gi] : sec, fr: t, strength, level: onGrid ? grid[gi].level : 3, down: onGrid && grid[gi].down };
    const prev = bySlot.get(key);
    if (!prev || prev.strength < strength) bySlot.set(key, cand);
  }
  const cands = [...bySlot.values()].sort((a, b) => a.t - b.t);
  // harmonic novelty: does the pitch content change at this attack? (a new chord/note vs. a drum hit)
  const chromaAvg = (a, b) => { const c = new Float64Array(12); for (let k = Math.max(0, a); k < Math.min(f.frames, b); k++) for (let p = 0; p < 12; p++) c[p] += f.chroma[k * 12 + p]; return c; };
  for (const c of cands) {
    const x = chromaAvg(c.fr - 10, c.fr - 1), y = chromaAvg(c.fr + 1, c.fr + 10);
    let xy = 0, xx = 0, yy = 0; for (let p = 0; p < 12; p++) { xy += x[p] * y[p]; xx += x[p] * x[p]; yy += y[p] * y[p]; }
    const nov = 1 - xy / (Math.sqrt(xx * yy) || 1);
    c.strength *= 1 + 1.5 * Math.min(1, nov * 4);
  }
  // relative strength: compared with the attacks around it (a quiet verse still gets its own notes)
  const strs = cands.map((c) => c.strength), ctimes = cands.map((c) => c.t);
  cands.forEach((c, i) => { c.z = c.strength / (localMedian(strs, ctimes, i, 4) || 1); });
  const metric = (c) => (c.level === 0 ? 1 : c.level === 1 ? 0.55 : c.level === 2 ? 0.1 : -0.6) + (c.down ? 0.5 : 0);

  // 5. difficulties, nested: each one keeps the best notes of the one above
  const chosen = {};
  let pool = cands.map((_, i) => i);
  for (const d of [...DIFFS].reverse()) {
    // expert: every clear attack (z ≥ 0.95); the others: a share of expert — always within the level's density range
    const want = d.key === "expert" ? pool.filter((i) => cands[i].z >= 0.95).length : chosen.expert.length * d.ratio;
    const target = Math.round(Math.min(pool.length, Math.max(d.min * activeSeconds, Math.min(d.max * activeSeconds, want))));
    const order = [...pool].sort((a, b) => (cands[b].z + d.meter * metric(cands[b])) - (cands[a].z + d.meter * metric(cands[a])));
    const taken = [];
    const free = (t) => {
      let lo = 0, hi = taken.length; while (lo < hi) { const m = (lo + hi) >> 1; if (taken[m] < t) lo = m + 1; else hi = m; }
      return { ok: (lo >= taken.length || taken[lo] - t >= d.gap) && (lo === 0 || t - taken[lo - 1] >= d.gap), at: lo };
    };
    const pick = [];
    for (const i of order) {
      if (pick.length >= target) break;
      const { ok, at } = free(cands[i].t);
      if (!ok) continue;
      pick.push(i); taken.splice(at, 0, cands[i].t);
    }
    chosen[d.key] = pick.sort((a, b) => a - b);
    pool = chosen[d.key];
  }

  // 6. lanes follow the bass line: same note → same fret, up/down with the interval; phrases restart near the middle
  const bassPc = makeBassPc(samples, rate);
  const pcs = new Map();
  for (const i of chosen.expert) pcs.set(i, bassPc(cands[i].t));
  for (const d of DIFFS) for (const i of chosen[d.key]) if (!pcs.has(i)) pcs.set(i, bassPc(cands[i].t));
  const zAll = (key) => chosen[key].map((i) => cands[i].z).sort((a, b) => b - a);

  const diffs = {};
  for (const d of DIFFS) {
    const idx = chosen[d.key], nl = d.lanes, notes = [];
    const zs = zAll(d.key);
    const chordCut = d.chord ? zs[Math.floor(zs.length * d.chord)] ?? Infinity : Infinity;
    let lane = Math.floor(nl / 2), prevPc = -1, prevT = -9, dir = 1;
    for (let j = 0; j < idx.length; j++) {
      const c = cands[idx[j]], pc = pcs.get(idx[j]);
      if (prevPc < 0 || c.t - prevT > 1.0) {
        lane = Math.min(nl - 1, Math.max(0, Math.round(((pc % 12) / 11) * (nl - 1) * 0.6 + (nl - 1) * 0.2)));
      } else {
        const iv = ((pc - prevPc + 18) % 12) - 6;
        if (iv !== 0) {
          const step = nl === 3 || Math.abs(iv) <= 2 ? 1 : 2;
          dir = Math.sign(iv);
          let nxt = lane + dir * step;
          if (nxt > nl - 1 || nxt < 0) nxt = lane - dir * step; // no room: bounce back
          lane = Math.max(0, Math.min(nl - 1, nxt));
        }
      }
      // sustain if the sound keeps ringing until the next note
      const nextT = j + 1 < idx.length ? cands[idx[j + 1]].t : c.t + beatLen * 4;
      const gap = nextT - c.t;
      let dur = 0;
      if (gap >= beatLen * 2) {
        const fr0 = c.fr, fr1 = Math.min(f.frames - 1, c.fr + Math.round((gap * f.fps) / 2));
        let held = 0, act = 0, cnt = 0;
        for (let k = fr0 + 3; k <= fr1; k++) { held += f.rms[k]; act += env[k]; cnt++; }
        if (cnt && held / cnt > f.rms[fr0] * 0.6 && act / cnt < 0.45) dur = Math.max(0, gap - Math.min(beatLen * 0.25, 0.18));
      }
      notes.push([r3(c.t), lane, r3(dur)]);
      if (c.z >= chordCut && c.level <= 1 && nl >= 4) {
        const w = nl >= 5 ? 2 : 1;
        const other = lane + w <= nl - 1 ? lane + w : lane - w;
        if (other >= 0) notes.push([r3(c.t), other, r3(dur)]);
      }
      prevPc = pc; prevT = c.t;
    }
    notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    diffs[d.key] = { lanes: [...new Set(notes.map((n) => n[1]))].sort((a, b) => a - b), notes };
  }

  // 7. sections where the bar energy changes noticeably
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
  const beatList = beats.filter((t) => t <= lastNote + 8).map((t, i) => [r3(t), (((i - phase) % 4) + 4) % 4 === 0 ? 1 : 0]);
  return {
    v: 1,
    meta: { ...meta, charter: "Corde (automático)" },
    sections,
    beats: beatList,
    diffs,
    auto: { v: 2, bpm: Math.round((60 * f.fps) / period * 10) / 10 },
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

/**
 * Upload check for a hand-made chart. noteTimes are where the notes should sound in `samples` (seconds).
 * Measures how far they sit from the attacks over the whole song and over each half (halves that disagree
 * mean the chart drifts). Returns the worst believable error in seconds, or 0 when it looks fine or the
 * audio is too ambiguous to tell — a false alarm is worse than a missed one here.
 */
export function syncError(samples, rate, noteTimes) {
  const BIAS = 0.018; // this onset detector reads attacks ~18 ms early
  const f = analyze(samples, rate);
  const env = onsetEnvelope(f);
  const centre = 512 / rate / 2;
  const at = (sec) => { const x = (sec - centre) * f.fps; const i = Math.floor(x); if (i < 0 || i + 1 >= env.length) return 0; const w = x - i; return env[i] * (1 - w) + env[i + 1] * w; };
  const times = [...new Set(noteTimes.map((t) => Math.round(t * 1000)))].sort((a, b) => a - b).map((t) => t / 1000);
  const fit = (ts) => {
    if (ts.length < 40) return null;
    const scores = [];
    let best = 0, bestS = -Infinity;
    for (let ms = -250; ms <= 250; ms += 2) {
      const d = ms / 1000; let s = 0;
      for (const t of ts) s += Math.max(at(t + d - 0.012), at(t + d), at(t + d + 0.012));
      scores.push(s);
      if (s > bestS) { bestS = s; best = d; }
    }
    const sorted = [...scores].sort((a, b) => a - b);
    return { err: best + BIAS, conf: bestS / (sorted[sorted.length >> 1] || 1) };
  };
  const sure = (r) => r && r.conf >= 4;
  const all = fit(times);
  const mid = times[times.length >> 1];
  const a = fit(times.filter((t) => t < mid)), b = fit(times.filter((t) => t >= mid));
  let worst = 0;
  if (sure(all) && Math.abs(all.err) >= 0.06) worst = all.err;
  if (sure(a) && sure(b) && Math.abs(a.err - b.err) >= 0.06) worst = Math.abs(a.err) > Math.abs(b.err) ? a.err : b.err;
  return { worst, all, a, b }; // worst: seconds, 0 = fine
}
