// Admin uploader: turns Clone Hero song folders into Corde library entries, entirely in the browser.
// chart → chart.json, every non-guitar stem mixed → backing.mp3, guitar stem → guitar.mp3, album art → cover.jpg.
import { Mp3Encoder } from "@breezystack/lamejs";
import { midiToChart, chartTextToChart, parseIni, iniMeta, diffSummary } from "./chart.js";
import { autoChart } from "./autochart.js";

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
  out["chart.json"] = new Blob([JSON.stringify({ ...chart, rev: Date.now() })], { type: "application/json" }); // rev: every upload gets fresh file URLs

  const name = chart.meta.name || song.label;
  const artist = chart.meta.artist || "";
  const id = slug(`${artist}-${name}`) || slug(song.label);
  const row = {
    id, name, artist, album: chart.meta.album || null, year: chart.meta.year ? parseInt(chart.meta.year) || null : null,
    charter: stripTags(chart.meta.charter || "") || null, genre: ini.genre || null,
    duration_ms: +ini.song_length || Math.round(seconds * 1000), diffs: summary,
    has_guitar: hasGuitar, has_cover: !!out["cover.jpg"],
    // the MP3 encoder pads ~25 ms at the start; song.ini "delay" (ms, positive = notes later) shifts the chart
    audio_offset_ms: 25 + (Math.round(+ini.delay) || 0),
  };
  return { id, row, files: out };
}

/* ================= MP3 → auto-generated chart ================= */

const AUDIO_ONLY = /\.(mp3|m4a|ogg|opus|wav|flac)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const base = (n) => n.replace(/\.[^.]+$/, "").toLowerCase();

/** Each audio file is a song; an image with the same name becomes its cover. */
export function findMp3Songs(fileList) {
  const files = [...fileList];
  const images = files.filter((f) => IMAGE.test(f.name));
  return files.filter((f) => AUDIO_ONLY.test(f.name)).map((audio) => ({
    kind: "mp3", audio, label: audio.name.replace(/\.[^.]+$/, ""),
    image: images.find((im) => base(im.name) === base(audio.name)) || (images.length === 1 ? images[0] : null),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Minimal ID3v2 reader: title, artist, album, year and embedded cover. */
async function readId3(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
  const ver = head[3];
  const size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
  const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const out = {};
  const text = (bytes) => {
    const enc = bytes[0], body = bytes.subarray(1);
    const dec = enc === 1 || enc === 2 ? new TextDecoder(enc === 2 ? "utf-16be" : "utf-16") : new TextDecoder(enc === 3 ? "utf-8" : "latin1");
    return dec.decode(body).replace(/\u0000+$/g, "").replace(/\u0000/g, " ").trim();
  };
  let p = 0;
  while (p + 10 <= b.length && ver >= 3) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4
      ? ((b[p + 4] & 127) << 21) | ((b[p + 5] & 127) << 14) | ((b[p + 6] & 127) << 7) | (b[p + 7] & 127)
      : (b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7];
    const data = b.subarray(p + 10, p + 10 + len);
    if (id === "TIT2") out.title = text(data);
    else if (id === "TPE1") out.artist = text(data);
    else if (id === "TALB") out.album = text(data);
    else if (id === "TYER" || id === "TDRC") out.year = parseInt(text(data)) || undefined;
    else if (id === "APIC") {
      const enc = data[0];
      let q = 1; while (q < data.length && data[q] !== 0) q++;
      const mime = new TextDecoder("latin1").decode(data.subarray(1, q)) || "image/jpeg";
      q += 2; // terminator + picture type
      if (enc === 1 || enc === 2) { while (q + 1 < data.length && !(data[q] === 0 && data[q + 1] === 0)) q += 2; q += 2; }
      else { while (q < data.length && data[q] !== 0) q++; q += 1; }
      out.cover = new Blob([data.subarray(q)], { type: mime.includes("/") ? mime : "image/" + mime.toLowerCase() });
    }
    p += 10 + len;
  }
  return out;
}

export async function convertMp3Song(song, onStatus) {
  onStatus("Analizando ritmo", 0.03);
  const tags = await readId3(song.audio).catch(() => ({}));
  const m = song.label.match(/^(.+?)\s+-\s+(.+)$/);
  const name = stripTags(tags.title || (m ? m[2] : song.label));
  const artist = stripTags(tags.artist || (m ? m[1] : ""));

  // decode at 22.05 kHz for analysis
  const ctx = new OfflineAudioContext(1, 1, 22050);
  let buf;
  try { buf = await ctx.decodeAudioData(await song.audio.arrayBuffer()); }
  catch { throw new Error(`no se pudo leer el audio ${song.audio.name}`); }
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  await tick();
  const chart = autoChart(mono, 22050, { name, artist, album: tags.album, year: tags.year }, (stage, p) => onStatus(stage === "analyze" ? "Analizando ritmo" : "Generando notas", 0.05 + 0.5 * p));
  onStatus("Generando notas", 0.6);
  await tick();

  const out = {};
  if (/\.mp3$/i.test(song.audio.name)) out["backing.mp3"] = new Blob([song.audio], { type: "audio/mpeg" });
  else {
    const full = await decode(song.audio);
    const L = full.getChannelData(0), R = full.numberOfChannels > 1 ? full.getChannelData(1) : L;
    out["backing.mp3"] = await encodeMp3({ L, R }, (p) => onStatus("Convirtiendo a MP3", 0.6 + 0.25 * p));
  }
  const coverSrc = song.image || tags.cover;
  if (coverSrc) { try { out["cover.jpg"] = await makeCover(coverSrc); } catch {} }
  out["chart.json"] = new Blob([JSON.stringify({ ...chart, rev: Date.now() })], { type: "application/json" }); // rev: every upload gets fresh file URLs

  const id = slug(`${artist}-${name}`) || slug(song.label);
  const row = {
    id, name, artist, album: tags.album || null, year: tags.year || null, charter: "Corde (automático)", genre: null,
    duration_ms: Math.round((buf.length / 22050) * 1000), diffs: diffSummary(chart), has_guitar: false, has_cover: !!out["cover.jpg"],
    audio_offset_ms: /\.mp3$/i.test(song.audio.name) ? 0 : 25, // original MP3 is analysed and played as-is
  };
  return { id, row, files: out };
}
