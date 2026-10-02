// Menu music: a random library song plays behind the menus.
// Only a piece of each song (~80 s, from just before its chorus) is downloaded, with HTTP range requests on
// the MP3s, and decoded with Web Audio: a visit costs a couple of MB instead of whole songs, and the backing
// and guitar stems play sample-locked. When the MP3 has a constant bitrate (every song converted by the
// upload panel), the byte offset gives the exact time, so the highway behind the menus plays the song's real
// notes in sync with what you hear; otherwise it falls back to a beat grid found in the audio itself.
import { sfxCtx } from "./audio.js";
import { fileUrl } from "./net.js";
import { notesFor } from "./chart.js";
import { energyCurve, energyAt, beatGrid } from "./energy.js";

const SEG = 80;   // seconds of each song
const VOL = 0.4;  // under the menu sounds
const FADE_IN = 1.6, FADE_OUT = 2.2;

async function range(url, a, b) {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
  if (!r.ok) throw new Error("audio " + r.status);
  const total = +((r.headers.get("content-range") || "").split("/")[1]) || +r.headers.get("content-length") || 0;
  return { buf: await r.arrayBuffer(), total };
}

/* ---------- just enough MP3 to find frames ---------- */
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SRS = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function frameAt(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
  if (ver === 1 || layer !== 1) return null; // MPEG layer III only
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (bri === 0 || bri === 15 || sri === 3) return null;
  const br = (ver === 3 ? BR1 : BR2)[bri], sr = SRS[ver][sri], spf = ver === 3 ? 1152 : 576;
  return { ver, br, sr, spf, len: Math.floor(((spf / 8) * br * 1000) / sr) + pad, mono: b[i + 3] >> 6 === 3 };
}
function findFrame(b, from = 0) {
  for (let i = from; i < b.length - 4; i++) {
    const f = frameAt(b, i);
    if (!f) continue;
    const g = frameAt(b, i + f.len); // a real frame is followed by another one
    if (g && g.sr === f.sr && g.ver === f.ver) return { i, f };
  }
  return null;
}
// where the audio frames start, their format, and whether the bitrate is constant
async function probe(url) {
  let { buf, total } = await range(url, 0, 16383);
  let b = new Uint8Array(buf), base = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // ID3v2 tag (cover art can make it big)
    base = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) + (b[5] & 0x10 ? 10 : 0);
    if (base + 4096 > b.length) b = new Uint8Array((await range(url, base, base + 8191)).buf);
    else b = b.subarray(base);
  }
  const hit = findFrame(b);
  if (!hit) throw new Error("not an mp3");
  const { i, f } = hit;
  let start = base + i, vbr = false;
  const side = f.ver === 3 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17);
  const tag = String.fromCharCode(...b.subarray(i + 4 + side, i + 8 + side));
  if (tag === "Xing" || tag === "Info") { vbr = tag === "Xing"; start += f.len; } // LAME header frame (silent)
  else if (String.fromCharCode(...b.subarray(i + 36, i + 40)) === "VBRI") { vbr = true; start += f.len; }
  return { start, f, vbr, total };
}

/* ---------- one song's piece ---------- */
async function loadPiece(song, ctx) {
  const off = (song.audio_offset_ms || 0) / 1000;
  const chartRes = await fetch(fileUrl(song.id, "chart.json"), { cache: "no-cache" });
  const chart = chartRes.ok ? await chartRes.json() : { sections: [], beats: [], diffs: {} };
  const dur = (song.duration_ms || 200000) / 1000;
  // from a few seconds before the first chorus (or a third into the song)
  let t0 = null;
  for (const [t, n] of chart.sections || []) if (/chorus|coro|estribillo/i.test(n || "")) { t0 = t; break; }
  if (t0 == null || t0 > dur - 30) t0 = dur * 0.3;
  t0 = Math.max(0, Math.min(t0 - 6, dur - SEG - 2));
  const urls = [fileUrl(song.id, song.backing_file || "backing.mp3")];
  if (song.has_guitar) urls.push(fileUrl(song.id, song.guitar_file || "guitar.mp3"));
  const probes = await Promise.all(urls.map(probe));
  const synced = !probes.some((p) => p.vbr);
  const fdur = probes[0].f.spf / probes[0].f.sr;
  const k0 = Math.floor((t0 + off) / fdur);
  const stems = await Promise.all(probes.map(async (p, n) => {
    // bytes per frame: exact for a constant bitrate, the file's average otherwise
    const bpf = synced ? ((p.f.spf / 8) * p.f.br * 1000) / p.f.sr : (p.total - p.start) / (dur / fdur);
    const a = Math.max(p.start, Math.round(p.start + k0 * bpf) - 8);
    const want = Math.ceil((SEG / fdur) * bpf) + 4096;
    const { buf } = await range(urls[n], a, a + want);
    const hit = findFrame(new Uint8Array(buf));
    if (!hit) throw new Error("no frames");
    const k = Math.round((a + hit.i - p.start) / bpf);
    return { k, buffer: await ctx.decodeAudioData(buf.slice(hit.i)) };
  }));
  const kMin = Math.min(...stems.map((s) => s.k));
  const start = kMin * fdur; // audio time of the piece's first sample
  const len = Math.min(SEG, ...stems.map((s) => s.buffer.duration + (s.k - kMin) * fdur));
  // what the highway plays behind the menus: the real chart, or a beat grid found in the audio
  let beats, notes, base;
  if (synced && chart.beats?.length) {
    base = start - off; // chart time of the piece's start
    beats = chart.beats.filter((b) => b[0] >= base - 2 && b[0] <= base + len + 2);
    const diff = ["expert", "hard", "medium", "easy"].find((d) => chart.diffs?.[d]?.notes?.length);
    notes = diff ? notesFor(chart, diff, 5).filter((n) => n.t >= base - 1 && n.t <= base + len).map((n) => ({ ...n, state: 0, holding: false })) : [];
  } else {
    base = 0;
    beats = beatGrid(stems[0].buffer);
    const pat = [0, 1, 2, 1, 0, 2, 3, 2, 1, 3, 4, 3, 2, 0, 1, 2];
    notes = [];
    beats.forEach(([t], i) => { const nb = beats[i + 1]; const half = nb ? (nb[0] - t) / 2 : 0.25; notes.push({ t, lane: pat[(i * 2) % 16], dur: 0, state: 0, holding: false }, { t: t + half, lane: pat[(i * 2 + 1) % 16], dur: 0, state: 0, holding: false }); });
  }
  return { song, stems, kMin, fdur, len, base, beats, notes, energy: energyCurve(stems.map((s) => s.buffer)) };
}

/**
 * onChange(info): info = { song, playing, muted } whenever what's playing changes (for the "now playing" UI).
 */
export function createMenuMusic({ onChange }) {
  let songs = [], cur = null, next = null, loadingNext = null;
  let muted = false, want = false; // want = the menus are showing
  let srcs = [], gain = null, startAt = 0, seek = 0, playing = false, stopT = null, lastId = null;
  const ctx = () => sfxCtx();
  const emit = () => onChange && onChange({ song: cur?.song || null, playing: playing && audible(), muted });
  const audible = () => { try { return ctx().state === "running"; } catch { return false; } };
  try { ctx().addEventListener("statechange", () => emit()); } catch {}

  function pick() {
    const pool = songs.filter((s) => s.id !== lastId && s.id !== cur?.song?.id);
    const list = pool.length ? pool : songs;
    return list[Math.floor(Math.random() * list.length)];
  }
  async function prepare() {
    if (loadingNext) return loadingNext;
    loadingNext = (async () => {
      for (let tries = 0; tries < 3 && songs.length; tries++) {
        const s = pick(); lastId = s.id;
        try { next = await loadPiece(s, ctx()); return next; } catch (e) { console.warn("menu music:", s.name, e.message); }
      }
      return null;
    })().finally(() => { loadingNext = null; });
    return loadingNext;
  }
  function stopSources(fade = 0.35) {
    const c = ctx(), now = c.currentTime;
    if (gain) { gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + fade); }
    const old = srcs; srcs = [];
    old.forEach((s) => { try { s.stop(now + fade + 0.05); } catch {} });
    playing = false;
    clearTimeout(stopT);
  }
  function startSources(from) {
    const c = ctx();
    gain = c.createGain(); gain.connect(c.destination);
    const t = c.currentTime + 0.06;
    startAt = t - from; seek = from;
    const left = cur.len - from;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(VOL, t + Math.min(FADE_IN, left / 3));
    gain.gain.setValueAtTime(VOL, t + Math.max(0.1, left - FADE_OUT));
    gain.gain.linearRampToValueAtTime(0, t + left);
    for (const s of cur.stems) {
      const src = c.createBufferSource(); src.buffer = s.buffer; src.connect(gain);
      const lead = (s.k - cur.kMin) * cur.fdur; // a stem whose piece starts a frame later
      const off = Math.max(0, from - lead);
      src.start(t + Math.max(0, lead - from), off, Math.max(0.05, cur.len - from - Math.max(0, lead - from)));
      srcs.push(src);
    }
    playing = true;
    // next song: start loading it ~15 s before the end, switch when this one has faded out
    clearTimeout(stopT);
    const tick = () => {
      if (!playing) return;
      const pos = time();
      if (pos > cur.len - 15 && !next && !loadingNext) prepare();
      if (pos >= cur.len - 0.05) { advance(); return; }
      stopT = setTimeout(tick, 500);
    };
    stopT = setTimeout(tick, 500);
    emit();
  }
  // switch to the next song (the current one keeps playing until the next is ready)
  async function advance(fade = 0.05) {
    const n = next || (await prepare());
    next = null;
    stopSources(fade);
    if (!n) return;
    cur = n; seek = 0;
    if (want && !muted) startSources(0); else emit();
  }
  /** Seconds into the current piece, as heard. */
  function time() {
    const c = ctx();
    return Math.max(0, c.currentTime - (c.outputLatency || c.baseLatency || 0) - startAt);
  }
  const ev = { e: 0.55, p: 0 };

  return {
    setSongs(list) { songs = list || []; },
    get muted() { return muted; },
    /** The menus are on screen: play (or resume) unless muted. */
    async play() {
      want = true;
      if (muted || !songs.length) return emit();
      if (playing) return;
      if (!cur) { const n = next || (await prepare()); next = null; if (!n || playing) return; cur = n; }
      if (!want || muted || playing) return;
      const from = seek < cur.len - 4 ? seek : null;
      if (from == null) { await advance(); return; }
      startSources(from);
    },
    /** Leaving the menus (a song is about to start): fade out and remember where we were. */
    pause() {
      want = false;
      if (!playing) return;
      seek = Math.min(cur.len, time());
      stopSources(0.5);
      emit();
    },
    setMuted(m) {
      muted = m;
      if (m) { if (playing) { seek = Math.min(cur.len, time()); stopSources(0.4); } emit(); }
      else if (want) this.play();
    },
    skip() { if (muted || !songs.length || loadingNext) return; advance(0.6); },
    /** For the menu highway and stage: time base, notes, beats and energy of what's playing (null when silent). */
    show() {
      if (!playing || !cur || !audible()) return null;
      const tau = time();
      energyAt(cur.energy, tau, ev);
      return { key: cur, t: cur.base + tau, notes: cur.notes, beats: cur.beats, energy: ev.e, punch: ev.p };
    },
    info() { return { song: cur?.song || null, playing: playing && audible(), muted }; },
  };
}
