// Admin uploader: turns Clone Hero song folders into Corde library entries, entirely in the browser.
// chart → chart.json, every non-guitar stem mixed → backing.mp3, guitar stem → guitar.mp3, album art → cover.jpg.
import { Mp3Encoder } from "@breezystack/lamejs";
import { midiToChart, chartTextToChart, parseIni, iniMeta, diffSummary } from "./chart.js";

const RATE = 44100;
const AUDIO = /\.(opus|ogg|mp3|wav|m4a|flac)$/i;
const SKIP_AUDIO = /^(preview|crowd)\./i;

export const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const stripTags = (s = "") => String(s).replace(/<[^>]+>/g, "").trim();
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Groups the picked files by folder and keeps folders that look like Clone Hero songs. */
export function findSongs(fileList) {
  const dirs = new Map();
  for (const f of fileList) {
    const rel = f.webkitRelativePath || f.name;
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "(archivos sueltos)";
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(f);
  }
  const songs = [];
  for (const [dir, files] of dirs) {
    const has = (re) => files.some((f) => re.test(f.name));
    if (has(/^song\.ini$/i) && (has(/^notes\.mid$/i) || has(/^notes\.chart$/i)) && files.some((f) => AUDIO.test(f.name))) {
      songs.push({ dir, label: dir.split("/").pop(), files });
    }
  }
  return songs.sort((a, b) => a.label.localeCompare(b.label));
}

async function decode(file) {
  const ctx = new OfflineAudioContext(2, RATE, RATE);
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error(`no se pudo leer el audio ${file.name}`); }
}

/** Decodes stems one at a time and sums them, so memory stays at ~2 buffers no matter how many stems. */
async function mixStems(files, onStep) {
  let L = null, R = null, len = 0;
  for (let i = 0; i < files.length; i++) {
    onStep(i, files.length);
    const buf = await decode(files[i]);
    if (buf.length > len) {
      const nL = new Float32Array(buf.length), nR = new Float32Array(buf.length);
      if (L) { nL.set(L); nR.set(R); }
      L = nL; R = nR; len = buf.length;
    }
    const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
    for (let k = 0; k < buf.length; k++) { L[k] += a[k]; R[k] += b[k]; }
    await tick();
  }
  let peak = 0;
  for (let k = 0; k < len; k++) { const p = Math.max(Math.abs(L[k]), Math.abs(R[k])); if (p > peak) peak = p; }
  if (peak > 0.98) { const g = 0.98 / peak; for (let k = 0; k < len; k++) { L[k] *= g; R[k] *= g; } }
  return { L, R, seconds: len / RATE };
}

async function encodeMp3({ L, R }, onProgress) {
  const enc = new Mp3Encoder(2, RATE, 128);
  const block = 1152 * 32;
  const li = new Int16Array(block), ri = new Int16Array(block);
  const out = [];
  for (let i = 0, n = 0; i < L.length; i += block, n++) {
    const m = Math.min(block, L.length - i);
    for (let k = 0; k < m; k++) {
      let a = L[i + k], b = R[i + k];
      a = a < -1 ? -1 : a > 1 ? 1 : a; b = b < -1 ? -1 : b > 1 ? 1 : b;
      li[k] = a < 0 ? a * 0x8000 : a * 0x7fff; ri[k] = b < 0 ? b * 0x8000 : b * 0x7fff;
    }
    const chunk = enc.encodeBuffer(li.subarray(0, m), ri.subarray(0, m));
    if (chunk.length) out.push(new Uint8Array(chunk));
    if (n % 6 === 0) { onProgress(i / L.length); await tick(); }
  }
  const end = enc.flush();
  if (end.length) out.push(new Uint8Array(end));
  return new Blob(out, { type: "audio/mpeg" });
}

async function makeCover(file) {
  const img = await createImageBitmap(file);
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const s = Math.max(512 / img.width, 512 / img.height);
  c.getContext("2d").drawImage(img, (512 - img.width * s) / 2, (512 - img.height * s) / 2, img.width * s, img.height * s);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
}

/** Converts one song folder. onStatus(text, fraction) reports progress. */
export async function convertSong(song, onStatus) {
  const { files } = song;
  const find = (re) => files.find((f) => re.test(f.name));
  onStatus("Leyendo chart", 0.02);
  const ini = parseIni(await find(/^song\.ini$/i).text());
  const meta = iniMeta(ini);
  meta.name = stripTags(meta.name); meta.artist = stripTags(meta.artist); meta.album = stripTags(meta.album);
  const mid = find(/^notes\.mid$/i), cht = find(/^notes\.chart$/i);
  const chart = mid ? midiToChart(await mid.arrayBuffer(), meta) : chartTextToChart(await cht.text(), meta);
  const summary = diffSummary(chart);
  if (!Object.values(summary).some((d) => d.n > 0)) throw new Error("no tiene notas de guitarra");

  const audio = files.filter((f) => AUDIO.test(f.name) && !SKIP_AUDIO.test(f.name));
  const guitar = audio.filter((f) => /^guitar\./i.test(f.name));
  const others = audio.filter((f) => !/^guitar\./i.test(f.name));
  const backingStems = others.length ? others : guitar;
  const hasGuitar = others.length > 0 && guitar.length > 0;

  const out = {};
  const mixB = await mixStems(backingStems, (i, n) => onStatus(`Mezclando pistas ${i + 1}/${n}`, 0.05 + 0.15 * (i / n)));
  out["backing.mp3"] = await encodeMp3(mixB, (p) => onStatus("Convirtiendo a MP3", 0.2 + 0.35 * p));
  const seconds = mixB.seconds;
  if (hasGuitar) {
    const mixG = await mixStems(guitar, () => onStatus("Preparando guitarra", 0.56));
    out["guitar.mp3"] = await encodeMp3(mixG, (p) => onStatus("Convirtiendo guitarra", 0.58 + 0.3 * p));
  }
  const art = find(/^album\.(jpe?g|png)$/i);
  if (art) { try { out["cover.jpg"] = await makeCover(art); } catch {} }
  out["chart.json"] = new Blob([JSON.stringify(chart)], { type: "application/json" });

  const name = chart.meta.name || song.label;
  const artist = chart.meta.artist || "";
  const id = slug(`${artist}-${name}`) || slug(song.label);
  const row = {
    id, name, artist, album: chart.meta.album || null, year: chart.meta.year ? parseInt(chart.meta.year) || null : null,
    charter: stripTags(chart.meta.charter || "") || null, genre: ini.genre || null,
    duration_ms: +ini.song_length || Math.round(seconds * 1000), diffs: summary,
    has_guitar: hasGuitar, has_cover: !!out["cover.jpg"],
  };
  return { id, row, files: out };
}
