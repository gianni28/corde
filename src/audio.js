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
    this.missSfx = true;
  }
  start(delay) {
    const c = audioCtx();
    c.resume();
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    this.guitarGain = c.createGain(); this.guitarGain.connect(this.master);
    this.startAt = c.currentTime + delay;
    for (const s of this.stems) {
      const src = c.createBufferSource(); src.buffer = s.buffer;
      src.connect(s.guitar ? this.guitarGain : this.master); src.start(this.startAt);
      this.sources.push(src);
    }
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
  /** Miss: a short, quiet muted-string "chk" (well under the song), rate-limited. */
  missSound() {
    if (!this.missSfx) return;
    const c = audioCtx();
    if (c.currentTime - (this._lastMiss || 0) < 0.12) return;
    this._lastMiss = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = missBuffer(c);
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
    const g = c.createGain(); g.gain.value = 0.12;
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

/* ---------- miss sound: muted string scrape + soft body thump ---------- */
let _miss = null;
function missBuffer(c) {
  if (_miss && _miss.sampleRate === c.sampleRate) return _miss;
  const rate = c.sampleRate, len = Math.floor(rate * 0.12);
  const out = new Float32Array(len);
  let lp = 0, peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    lp += (Math.random() * 2 - 1 - lp) * 0.35; // softened noise
    const scrape = lp * Math.exp(-t / 0.016);
    const f = 70 + 50 * Math.exp(-t / 0.02);
    const thump = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.03) * 0.8;
    out[i] = (scrape + thump) * Math.min(1, i / (rate * 0.0015));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < len; i++) out[i] /= peak || 1;
  _miss = c.createBuffer(1, len, rate);
  _miss.copyToChannel(out, 0);
  return _miss;
}
