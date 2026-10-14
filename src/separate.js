// Corde — the guitar apart from the rest of the song, in the admin's browser before uploading.
// SCNet (starrytong/SCNet, MIT weights; 13 MB, downloaded once from Hugging Face, checked against its SHA-256 and kept
// in the browser's cache) splits a song into drums, bass, vocals and "other": in a rock song, "other" is the guitars
// (and keys). The rest is the song minus that, so guitar + rest is exactly the original: nothing changes while the
// player hits the notes, and a miss silences what the model heard as guitar.
// Only the admin page loads this module (and onnxruntime-web with it): players never download any of it.
import separate, { models, REVISIONS } from "@audio/neural-separate";

// the file @audio/neural-separate reads in a browser, and the cache it looks in first (fetched here so the admin sees
// the download; separate() then finds it cached and checks its SHA-256 as always)
const MODEL_URL = `https://huggingface.co/${models.scnet.repo}/resolve/${REVISIONS.scnet}/${models.scnet.file}`;
const CACHE = "audio-neural";

/** How many threads onnxruntime gets on this page (1 unless the page is cross-origin isolated: /admin). */
export const separationThreads = () => (self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1)) : 1);

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
 * Returns { guitar: { L, R }, rest: { L, R } }.
 */
export async function splitGuitar(L, R, onProgress = () => {}, device) {
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
    // each sample heard in two 11 s windows instead of four: half the time, the same guitar (measured: 3.17 vs 3.18 dB)
    step: 0.5,
    progress: (p) => { if (p && p.totalChunks) onProgress((p.chunk - 1) / p.totalChunks, { stage: "part", chunk: p.chunk, totalChunks: p.totalChunks }); },
  };
  if (device) opts.device = device;
  const { stems } = await separate([L, R], opts);
  const [gL, gR] = stems.other;
  const n = L.length, rL = new Float32Array(n), rR = new Float32Array(n);
  for (let i = 0; i < n; i++) { rL[i] = L[i] - (gL[i] || 0); rR[i] = R[i] - (gR[i] || 0); }
  onProgress(1, { stage: "done" });
  return { guitar: { L: gL.subarray(0, n), R: gR.subarray(0, n) }, rest: { L: rL, R: rR } };
}
