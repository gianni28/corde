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
  missSound() {
    const c = audioCtx();
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(120, c.currentTime); o.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.12);
    g.gain.setValueAtTime(0.07, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + 0.15);
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
