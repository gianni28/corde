// Corde — the guitar apart from the rest of the song, in the admin's browser before uploading.
// SCNet (starrytong/SCNet, MIT weights; 13 MB, downloaded once from Hugging Face, checked against its SHA-256 and kept
// in the browser's cache) splits a song into drums, bass, vocals and "other": in a rock song, "other" is the guitars
// (and keys). The rest is the song minus that, so guitar + rest is exactly the original: nothing changes while the
// player hits the notes, and a miss silences what the model heard as guitar.
// It runs in its own worker (separate.js starts it): setting the model up and running it keep a thread busy for long
// stretches, which on the page itself froze it ("La página no responde"). Only the admin page ever starts it.
import separate, { models, REVISIONS } from "@audio/neural-separate";

// the file @audio/neural-separate reads in a browser, and the cache it looks in first (fetched here so the admin sees
// the download; separate() then finds it cached and checks its SHA-256 as always)
const MODEL_URL = `https://huggingface.co/${models.scnet.repo}/resolve/${REVISIONS.scnet}/${models.scnet.file}`;
const CACHE = "audio-neural";

/** How many threads onnxruntime gets here (1 unless the page is cross-origin isolated: /admin). */
const separationThreads = () => (self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1)) : 1);

async function ensureModel(onStage) {
  const store = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  if (store && (await store.match(MODEL_URL).catch(() => null))) return;
  onStage({ stage: "download", loaded: 0, total: 0 });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`no se pudo descargar el modelo (${res.status})`);
  const total = +res.headers.get("content-length") || 0, reader = res.body.getReader(), parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.length;
    onStage({ stage: "download", loaded, total });
  }
  const bytes = new Uint8Array(loaded); let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  await store?.put(MODEL_URL, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
}

/**
 * L, R: the song at 44.1 kHz. onProgress(fraction of the separation, info): info.stage is "download" ({ loaded, total },
 * the first time only), "prepare" (the model being set up) or "part" ({ chunk, totalChunks }: chunk is the part
 * starting now). device: "wasm" | "webgpu" | undefined (SCNet's default: wasm).
 * Returns the guitar: { L, R }.
 */
async function splitGuitar(L, R, onProgress = () => {}, device) {
  await ensureModel((info) => onProgress(0, info));
  onProgress(0, { stage: "prepare" });
  // every core but one when the page may use threads (cross-origin isolated); otherwise onnxruntime runs on one.
  // Imported here, not at the top: onnxruntime must stay a chunk of its own, because its threads start by loading
  // that same file as their script (bundled into this one, they'd load this module and never answer). It's the same
  // module @audio/neural-runtime loads (vite.config.js), so the setting reaches it.
  if (self.crossOriginIsolated) {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = separationThreads();
  }
  const opts = {
    sampleRate: 44100, model: "scnet", targets: ["other"],
    // each 11 s window heard once (the package's default hears every sample in four): a quarter of the time for the
    // same guitar (measured on a minute of Dio: 4.59 dB against 4.62 with two windows, 0.39 s per second of music
    // against 0.86), and no seams: at the joins neither the loudness dips nor the signal jumps more than anywhere else
    step: 1,
    progress: (p) => { if (p && p.totalChunks) onProgress((p.chunk - 1) / p.totalChunks, { stage: "part", chunk: p.chunk, totalChunks: p.totalChunks }); },
  };
  if (device) opts.device = device;
  const { stems } = await separate([L, R], opts);
  const n = L.length, [gL, gR] = stems.other;
  onProgress(1, { stage: "done" });
  // the guitar only, exactly as long as the song (the page has the song and works out the rest)
  return { L: gL.length === n ? gL : gL.slice(0, n), R: gR.length === n ? gR : gR.slice(0, n) };
}

// { L, R } in → { type: "progress", p, info } … then { type: "done", L, R } or { type: "error", message }
self.onmessage = async ({ data }) => {
  try {
    const g = await splitGuitar(data.L, data.R, (p, info) => self.postMessage({ type: "progress", p, info }), data.device);
    self.postMessage({ type: "done", L: g.L, R: g.R }, [g.L.buffer, g.R.buffer]);
  } catch (e) {
    self.postMessage({ type: "error", message: e?.message || String(e) });
  }
};
self.postMessage({ type: "ready", threads: separationThreads() });
