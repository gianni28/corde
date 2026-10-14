// Corde — the guitar apart from the rest of the song, in the admin's browser before uploading.
// SCNet (starrytong/SCNet, MIT weights; 13 MB, downloaded once from Hugging Face, checked against its SHA-256 and kept
// in the browser's cache) splits a song into drums, bass, vocals and "other": in a rock song, "other" is the guitars
// (and keys). The rest is the song minus that, so guitar + rest is exactly the original: nothing changes while the
// player hits the notes, and a miss silences what the model heard as guitar.
// Only the admin page loads this module (and onnxruntime-web with it): players never download any of it.
import separate from "@audio/neural-separate";
import * as ort from "onnxruntime-web/wasm";

/**
 * L, R: the song at 44.1 kHz. onProgress(fraction). device: "wasm" | "webgpu" | undefined (SCNet's default: wasm).
 * Returns { guitar: { L, R }, rest: { L, R } }.
 */
export async function splitGuitar(L, R, onProgress = () => {}, device) {
  onProgress(0);
  // every core but one when the page may use threads (cross-origin isolated); otherwise onnxruntime runs on one
  if (self.crossOriginIsolated) ort.env.wasm.numThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  const opts = {
    sampleRate: 44100, model: "scnet", targets: ["other"],
    // each sample heard in two 11 s windows instead of four: half the time, the same guitar (measured: 3.17 vs 3.18 dB)
    step: 0.5,
    progress: (p) => { if (p && p.totalChunks) onProgress(p.chunk / p.totalChunks); },
  };
  if (device) opts.device = device;
  const { stems } = await separate([L, R], opts);
  const [gL, gR] = stems.other;
  const n = L.length, rL = new Float32Array(n), rR = new Float32Array(n);
  for (let i = 0; i < n; i++) { rL[i] = L[i] - (gL[i] || 0); rR[i] = R[i] - (gR[i] || 0); }
  onProgress(1);
  return { guitar: { L: gL.subarray(0, n), R: gR.subarray(0, n) }, rest: { L: rL, R: rR } };
}
