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
  /** Botched strum: detuned, palm-muted power chord through distortion (Guitar Hero style miss). */
  missSound() {
    const c = audioCtx();
    const bufs = missBuffers(c);
    const src = c.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = c.createGain(); g.gain.value = 0.55;
    src.connect(g).connect(this.master || c.destination);
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

/* ---------- miss sound synthesis (Karplus-Strong + overdrive) ---------- */
let _miss = null;
function missBuffers(c) {
  if (_miss && _miss.rate === c.sampleRate) return _miss.list;
  const rate = c.sampleRate, len = Math.floor(rate * 0.55);
  const list = [];
  const chords = [
    [82.4, 116.5, 174.6, 233.1],  // E2 A#2 F3 A#3 (tritone mess)
    [87.3, 123.5, 164.8, 246.9],  // F2 B2 E3 B3
    [77.8, 110.0, 155.6, 220.0],  // D#2 A2 D#3 A3
  ];
  for (const chord of chords) {
    const out = new Float32Array(len);
    chord.forEach((f, si) => {
      const freq = f * (1 + (Math.random() - 0.5) * 0.03);
      const N = Math.max(2, Math.round(rate / freq));
      const ring = new Float32Array(N);
      for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
      const start = Math.floor(si * rate * 0.014); // strum spread
      const damp = 0.982; // palm-muted: dies fast
      let idx = 0;
      for (let i = start; i < len; i++) {
        const nxt = (idx + 1) % N;
        const v = ring[idx];
        ring[idx] = damp * 0.5 * (ring[idx] + ring[nxt]);
        out[i] += v * 0.5;
        idx = nxt;
      }
    });
    // pick scrape at the attack
    for (let i = 0; i < rate * 0.04; i++) out[i] += (Math.random() * 2 - 1) * 0.35 * (1 - i / (rate * 0.04));
    // overdrive + envelope
    const drive = 6, norm = Math.tanh(drive);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (rate * 0.002)) * Math.exp(-i / (rate * 0.16));
      out[i] = (Math.tanh(out[i] * drive) / norm) * env;
      peak = Math.max(peak, Math.abs(out[i]));
    }
    for (let i = 0; i < len; i++) out[i] = (out[i] / (peak || 1)) * 0.8;
    const b = c.createBuffer(1, len, rate);
    b.copyToChannel(out, 0);
    list.push(b);
  }
  _miss = { rate, list };
  return list;
}
