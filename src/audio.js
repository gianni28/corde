// Audio engine: decodes stems, plays them in sync, mutes the guitar on misses.
let ctx = null;
let sfx = null; // separate context for menu/result sounds, so they still play while the song is paused

/* ---------- iPhone silent switch ----------
   Safari treats Web Audio as "ambient" sound, which the ring/silent switch mutes.
   1) iOS 17+: the Audio Session API lets the page declare itself as music playback.
   2) Older iOS: a looping silent <audio> element switches the page into playback mode too. */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let silentEl = null;
let held = false; // the song is paused: taps must not wake the audio back up (pause screen, settings…)
function silentWavUrl() {
  const rate = 8000, n = rate; // 1 s of silence, 8-bit mono
  const b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}
/** Call from a tap/keypress: makes sound play even with the iPhone on silent. */
export function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (isIOS && !navigator.audioSession) {
    if (!silentEl) {
      silentEl = document.createElement("audio");
      silentEl.src = silentWavUrl(); silentEl.loop = true; silentEl.setAttribute("playsinline", ""); silentEl.preload = "auto";
    }
    if (silentEl.paused) silentEl.play().catch(() => {});
  }
  if (ctx && ctx.state === "suspended" && !held) ctx.resume().catch(() => {});
  if (sfx && sfx.state === "suspended") sfx.resume().catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (!silentEl) return;
  if (document.hidden) silentEl.pause(); else if (ctx) silentEl.play().catch(() => {});
});

/** Context for menu/result sounds: never suspended by the pause, so it can play while the song waits. */
export function sfxCtx() {
  if (!sfx) {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    sfx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  }
  if (sfx.state === "suspended") sfx.resume().catch(() => {});
  return sfx;
}

export function audioCtx() {
  if (!ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  }
  return ctx;
}

/** stems: [{name, data:ArrayBuffer, guitar:bool}] → decoded */
export async function decodeStems(stems) {
  const c = audioCtx();
  return Promise.all(
    stems.map(async (s) => {
      try { return { name: s.name, guitar: s.guitar, buffer: await c.decodeAudioData(s.data) }; }
      catch { throw new Error(`Tu navegador no pudo leer el audio "${s.name}".`); }
    })
  );
}

export class Player {
  constructor(decoded) {
    this.stems = decoded;
    this.duration = Math.max(0, ...decoded.map((s) => s.buffer.duration));
    this.sources = [];
    this.startAt = 0;
    this.lastHeard = 0;
    this.paused = false;
  }
  /** Start after `delay` seconds, from song second `from` (practice starts in the middle of the song). */
  start(delay, from = 0) {
    const c = audioCtx();
    c.resume();
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    this.guitarGain = c.createGain(); this.guitarGain.connect(this.master);
    const when = c.currentTime + delay;
    this.startAt = when - from;
    for (const s of this.stems) {
      const src = c.createBufferSource(); src.buffer = s.buffer;
      src.connect(s.guitar ? this.guitarGain : this.master);
      if (from >= 0) src.start(when, from); else src.start(when - from);
      this.sources.push(src);
    }
  }
  /** Song failed: the band "runs out of power" — pitch and volume fall away over `sec` seconds. */
  windDown(sec = 1.4) {
    const c = audioCtx(), now = c.currentTime;
    for (const s of this.sources) { try { s.playbackRate.cancelScheduledValues(now); s.playbackRate.setValueAtTime(1, now); s.playbackRate.exponentialRampToValueAtTime(0.25, now + sec); } catch {} }
    if (this.master) { this.master.gain.cancelScheduledValues(now); this.master.gain.setValueAtTime(this.master.gain.value, now); this.master.gain.linearRampToValueAtTime(0, now + sec); }
  }
  /** Restart playback from songTime (seconds) after `delay` seconds. Negative songTime = play later. */
  seek(songTime, delay) {
    const c = audioCtx();
    this.sources.forEach((s) => { try { s.stop(); } catch {} });
    this.sources = [];
    const when = c.currentTime + delay;
    this.startAt = when - songTime;
    for (const s of this.stems) {
      const src = c.createBufferSource(); src.buffer = s.buffer;
      src.connect(s.guitar ? this.guitarGain : this.master);
      if (songTime >= 0) src.start(when, songTime); else src.start(when - songTime);
      this.sources.push(src);
    }
    this.guitar(true);
  }
  /** Song position as the player hears it (accounts for output latency). */
  time() {
    const c = audioCtx();
    if (this.paused) return this.lastHeard - this.startAt;
    // Two clocks: the precise output timestamp, and currentTime minus the reported latency.
    // Right after a suspend/resume the output timestamp can be stale (seconds off), so it is only trusted when the two agree.
    const fallback = c.currentTime - (c.outputLatency || c.baseLatency || 0);
    let t = fallback;
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) {
        const precise = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (Math.abs(precise - fallback) < 0.15) t = precise;
      }
    }
    if (t < this.lastHeard && this.lastHeard - t < 0.05) t = this.lastHeard; // never step backwards by jitter
    this.lastHeard = t;
    return t - this.startAt;
  }
  guitar(on) {
    if (!this.guitarGain) return;
    const c = audioCtx();
    this.guitarGain.gain.setTargetAtTime(on ? 1 : 0, c.currentTime, on ? 0.01 : 0.03);
  }
  /** Passed note: a short, quiet muted-string "chk" (well under the song), rate-limited. */
  missSound() { this._sfx(missBuffer, 4200, 0.38, "_lastMiss"); }
  /** Wrong press: a soft out-of-tune twang, so it doesn't sound like a passed note. */
  wrongSound() { this._sfx(wrongBuffer, 3600, 0.3, "_lastWrong"); }
  _sfx(make, cutoff, gain, key) {
    const c = audioCtx();
    if (c.currentTime - (this[key] || 0) < 0.12) return;
    this[key] = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = make(c);
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cutoff;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(lp).connect(g).connect(this.master || c.destination);
    src.start();
  }
  async pause() { this.paused = true; held = true; await audioCtx().suspend(); }
  async resume() { held = false; await audioCtx().resume(); this.paused = false; }
  stop() {
    this.sources.forEach((s) => { try { s.stop(); } catch {} });
    this.sources = [];
    try { this.master.disconnect(); } catch {}
    held = false;
    if (audioCtx().state === "suspended") audioCtx().resume();
    this.paused = false;
  }
}

/* ---------- miss sound: a muted string "chk" (mid-range, so phone speakers play it too) ---------- */
let _miss = null;
function missBuffer(c) {
  if (_miss && _miss.sampleRate === c.sampleRate) return _miss;
  const rate = c.sampleRate, len = Math.floor(rate * 0.11);
  const out = new Float32Array(len);
  let lp = 0, lp2 = 0, peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate, n = Math.random() * 2 - 1;
    lp += (n - lp) * 0.5; lp2 += (lp - lp2) * 0.08; // a band of noise around 1-2 kHz: the scrape
    const scrape = (lp - lp2) * Math.exp(-t / 0.018) * 1.6;
    const body = (Math.sin(2 * Math.PI * 196 * t) + 0.6 * Math.sin(2 * Math.PI * 392 * t) + 0.35 * Math.sin(2 * Math.PI * 588 * t)) * Math.exp(-t / 0.028) * 0.55;
    out[i] = (scrape + body) * Math.min(1, i / (rate * 0.001));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < len; i++) out[i] /= peak || 1;
  _miss = c.createBuffer(1, len, rate);
  _miss.copyToChannel(out, 0);
  return _miss;
}

/* ---------- wrong-press sound: two detuned plucked strings (a sour little twang) ---------- */
let _wrong = null;
function wrongBuffer(c) {
  if (_wrong && _wrong.sampleRate === c.sampleRate) return _wrong;
  const rate = c.sampleRate, len = Math.floor(rate * 0.16);
  const out = new Float32Array(len);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let v = 0;
    for (const f of [233, 247]) for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; // a semitone apart: sour
    out[i] = v * Math.exp(-t / 0.05) * Math.min(1, i / (rate * 0.002));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < len; i++) out[i] /= peak || 1;
  _wrong = c.createBuffer(1, len, rate);
  _wrong.copyToChannel(out, 0);
  return _wrong;
}
