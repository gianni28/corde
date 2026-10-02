// Corde sound effects, all synthesized (no samples): a distorted guitar made with Karplus–Strong plucks,
// and a crowd made of filtered noise (claps, roar, whistles) or detuned voices through "oo" formants (boos).
import { sfxCtx } from "./audio.js";

let out = null, drive = null;
function bus() {
  const c = sfxCtx();
  if (!out) {
    out = c.createGain(); out.gain.value = 0.55; out.connect(c.destination);
    // amp: waveshaper distortion → cabinet-ish filters
    const shaper = c.createWaveShaper(), k = 7, n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    shaper.curve = curve; shaper.oversample = "2x";
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3600; lp.Q.value = 0.8;
    const post = c.createGain(); post.gain.value = 0.32;
    drive = c.createGain(); drive.gain.value = 1;
    drive.connect(shaper).connect(hp).connect(lp).connect(post).connect(out);
  }
  return c;
}

// Karplus–Strong string: a burst of noise fed through a short averaging delay line
const plucks = new Map();
function pluckBuf(c, f, dur) {
  const key = `${Math.round(f * 10)}:${dur}`;
  if (plucks.has(key)) return plucks.get(key);
  const sr = c.sampleRate, len = Math.floor(sr * dur), N = Math.max(2, Math.round(sr / f));
  const buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
  let lp = 0; for (let i = 0; i < N; i++) { lp = 0.6 * lp + 0.4 * (Math.random() * 2 - 1); ring[i] = lp; } // slightly dark pick
  for (let i = 0, j = 0; i < len; i++) { const a = ring[j], b = ring[(j + 1) % N]; ring[j] = 0.5 * (a + b) * 0.9965; d[i] = a; j = (j + 1) % N; }
  plucks.set(key, buf);
  return buf;
}
function note(f, at, { dur = 1.2, gain = 0.6, dist = true } = {}) {
  const c = bus();
  const src = c.createBufferSource(); src.buffer = pluckBuf(c, f, dur);
  const g = c.createGain(); g.gain.setValueAtTime(gain, at); g.gain.setTargetAtTime(0, at + dur * 0.75, dur * 0.08);
  src.connect(g).connect(dist ? drive : out);
  src.start(at); src.stop(at + dur + 0.1);
}
function powerChord(root, at, opts = {}) {
  [1, 1.4983, 2].forEach((m, i) => note(root * m, at + i * 0.012, { dur: 2.2, gain: 0.5, ...opts }));
}

const E3 = 164.81, G3 = 196, A3 = 220, B3 = 246.94, D4 = 293.66, E4 = 329.63;

/** Menu tap: a short clean pick. */
export function click() { const c = bus(); note(E4 * 2, c.currentTime + 0.005, { dur: 0.16, gain: 0.34, dist: false }); }
/** Back: the same pick, lower. */
export function back() { const c = bus(); note(B3 * 2, c.currentTime + 0.005, { dur: 0.16, gain: 0.32, dist: false }); }

/** Song intro: one note per fret climbing up (call onStep(i) to light the fret), then a power chord. */
export function intro(lanes, onStep) {
  const c = bus(), t0 = c.currentTime + 0.05, step = 0.11;
  const scale = [E3, G3, A3, B3, D4];
  for (let i = 0; i < lanes; i++) {
    note(scale[i], t0 + i * step, { dur: 0.5, gain: 0.45 });
    setTimeout(() => onStep && onStep(i), (0.05 + i * step) * 1000);
  }
  powerChord(E3, t0 + lanes * step + 0.04, { gain: 0.42 });
}

/* ---------- crowd ---------- */
let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return noiseBuf;
}
function panTo(c, node, x) { if (!c.createStereoPanner) return node; const p = c.createStereoPanner(); p.pan.value = x; node.connect(p); return p; }
function claps(c, t0, dur, rate, level) {
  let t = t0;
  while (t < t0 + dur) {
    const k = (t - t0) / dur, env = Math.min(1, k * 5) * (k > 0.6 ? (1 - k) / 0.4 : 1);
    t += -Math.log(1 - Math.random()) / (rate * Math.max(0.15, env));
    const src = c.createBufferSource(); src.buffer = noise(c);
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900 + Math.random() * 1600; bp.Q.value = 1.3;
    const g = c.createGain(), a = level * (0.4 + Math.random() * 0.6) * env;
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05 + Math.random() * 0.03);
    src.connect(bp).connect(g); panTo(c, g, Math.random() * 1.6 - 0.8).connect(out);
    src.start(t, Math.random() * 1.8, 0.1);
  }
}
function roar(c, t0, dur, level, vowel = [700, 1200]) {
  const src = c.createBufferSource(); src.buffer = noise(c); src.loop = true;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(level, t0 + 0.35); g.gain.setTargetAtTime(0, t0 + dur * 0.55, dur * 0.18);
  const mix = c.createGain(); mix.gain.value = 1;
  for (const f of vowel) { const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 0.9; src.connect(bp).connect(mix); }
  mix.connect(g).connect(out);
  src.start(t0); src.stop(t0 + dur + 1);
}
function whistle(c, t) {
  const o = c.createOscillator(), g = c.createGain(), f = 2300 + Math.random() * 700;
  o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.12); o.frequency.linearRampToValueAtTime(f * 1.05, t + 0.45);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.05); g.gain.linearRampToValueAtTime(0, t + 0.5);
  o.connect(g); panTo(c, g, Math.random() * 1.4 - 0.7).connect(out); o.start(t); o.stop(t + 0.55);
}
function boos(c, t0, dur, level) {
  for (let v = 0; v < 9; v++) {
    const o = c.createOscillator(); o.type = "sawtooth";
    const f = 105 + Math.random() * 70, st = t0 + Math.random() * 0.35;
    o.frequency.setValueAtTime(f * 1.06, st); o.frequency.linearRampToValueAtTime(f * 0.88, st + dur);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 4 + Math.random() * 2; vg.gain.value = f * 0.02; vib.connect(vg).connect(o.frequency);
    const f1 = c.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 330; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 820; f2.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(level, st + 0.25); g.gain.setTargetAtTime(0, st + dur * 0.7, dur * 0.12);
    const sum = c.createGain(); o.connect(f1).connect(sum); o.connect(f2).connect(sum);
    sum.connect(g); panTo(c, g, Math.random() * 1.4 - 0.7).connect(out);
    o.start(st); vib.start(st); o.stop(st + dur + 1); vib.stop(st + dur + 1);
  }
  roar(c, t0, dur, level * 0.25, [300, 800]); // breath of the crowd under the boos
}

/** End of the song: a big chord, then the crowd reacts to how it went (stars 1–5). */
export function finale(stars) {
  const c = bus(), t = c.currentTime + 0.05;
  powerChord(stars >= 3 ? E3 : 123.47, t, { gain: 0.45 }); // a happy E, or a flat B for a bad night
  const at = t + 0.35;
  if (stars >= 4) { roar(c, at, 3.6, 0.15); claps(c, at, 3.6, 55, 0.75); for (let i = 0; i < 3; i++) whistle(c, at + 0.3 + Math.random() * 2); }
  else if (stars === 3) { roar(c, at, 2.8, 0.07); claps(c, at, 2.8, 32, 0.6); }
  else if (stars === 2) { claps(c, at, 2.2, 9, 0.45); boos(c, at + 0.2, 2.0, 0.055); }
  else { boos(c, at, 2.6, 0.09); }
}

/** A star phrase completed: a bright little arpeggio. */
export function starChime() {
  const c = bus(), t = c.currentTime + 0.01;
  [E4 * 2, 987.77, E4 * 4].forEach((f, i) => note(f, t + i * 0.06, { dur: 0.5, gain: 0.16, dist: false }));
}
/** Star power on: a rising whoosh, a big chord and the crowd going up. */
export function starOn() {
  const c = bus(), t = c.currentTime + 0.01;
  const src = c.createBufferSource(); src.buffer = noise(c);
  const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4000, t + 0.5);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 0.6);
  src.connect(bp).connect(g).connect(out); src.start(t, 0, 0.7);
  powerChord(A3, t + 0.05, { gain: 0.3 });
  roar(c, t + 0.1, 2.2, 0.08); claps(c, t + 0.2, 1.8, 30, 0.45);
}
/** The song failed: the crowd boos (the music itself winds down in the player). */
export function failed() { const c = bus(); boos(c, c.currentTime + 0.4, 2.6, 0.09); }
