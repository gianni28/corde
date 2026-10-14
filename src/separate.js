// Corde — the guitar apart from the rest of the song, for the admin (the work itself: separate.worker.js).
// The model runs in a worker of its own, so the page stays responsive however long it takes; one worker for the whole
// session, so the model is set up once and the next songs start right away.

let worker = null, ready = null;
function start() {
  if (worker) return ready;
  worker = new Worker(new URL("./separate.worker.js", import.meta.url), { type: "module" });
  ready = new Promise((res, rej) => {
    worker.addEventListener("message", (e) => { if (e.data?.type === "ready") res(e.data.threads); }, { once: false });
    worker.addEventListener("error", (e) => rej(new Error(e.message || "no se pudo iniciar la separación")));
  });
  return ready;
}
function stop() { try { worker?.terminate(); } catch {} worker = null; ready = null; }

/** How many threads the separation uses (1 unless the page is cross-origin isolated: /admin). */
export async function separationThreads() { return start(); }

/**
 * L, R: the song at 44.1 kHz. onProgress(fraction, info): see separate.worker.js. Returns { guitar, rest }, each
 * { L, R }: guitar + rest is exactly the song.
 */
export async function splitGuitar(L, R, onProgress = () => {}, device) {
  await start();
  const w = worker;
  const g = await new Promise((res, rej) => {
    const onMsg = ({ data }) => {
      if (data.type === "progress") onProgress(data.p, data.info);
      else if (data.type === "done") { w.removeEventListener("message", onMsg); res(data); }
      else if (data.type === "error") { w.removeEventListener("message", onMsg); rej(new Error(data.message)); }
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", (e) => rej(new Error(e.message || "la separación se detuvo")), { once: true });
    const cL = L.slice(), cR = R.slice(); // copies cross over; the page keeps the song
    w.postMessage({ L: cL, R: cR, device }, [cL.buffer, cR.buffer]);
  }).catch((e) => { stop(); throw e; }); // a broken worker is replaced next time
  const n = L.length, rL = new Float32Array(n), rR = new Float32Array(n);
  for (let i = 0; i < n; i++) { rL[i] = L[i] - g.L[i]; rR[i] = R[i] - g.R[i]; }
  return { guitar: { L: g.L, R: g.R }, rest: { L: rL, R: rR } };
}
