// Audio engine: decodes stems, plays them in sync, mutes the guitar on misses.
let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
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
  /** Song position as the player hears it (accounts for output latency). */
  time() {
    const c = audioCtx();
    if (this.paused) return this.lastHeard - this.startAt;
    let t;
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    if (t == null) t = c.currentTime - (c.outputLatency || c.baseLatency || 0);
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
  async pause() { this.paused = true; await audioCtx().suspend(); }
  async resume() { await audioCtx().resume(); this.paused = false; }
  stop() {
    this.sources.forEach((s) => { try { s.stop(); } catch {} });
    this.sources = [];
    try { this.master.disconnect(); } catch {}
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
