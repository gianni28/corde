// Corde chart format (v1) + converters from Clone Hero files (notes.mid / notes.chart).
// Pure module: runs in the browser and in Node (upload script).
//
// Chart v1:
// { v:1, meta:{name,artist,album,year,charter}, sections:[[t,name]], beats:[[t,isBar]],
//   diffs:{ easy:{lanes:[..], notes:[[t,lane,dur],..]}, medium, hard, expert } }
// Times are seconds (3 decimals). dur 0 = normal note, >0 = sustain.

export const DIFFS = [
  { key: "easy", name: "Fácil", midi: 60, chart: "Easy" },
  { key: "medium", name: "Media", midi: 72, chart: "Medium" },
  { key: "hard", name: "Difícil", midi: 84, chart: "Hard" },
  { key: "expert", name: "Experto", midi: 96, chart: "Expert" },
];

const r3 = (x) => Math.round(x * 1000) / 1000;

/* ---------------- tempo map ---------------- */
function tempoMap(tempos, res) {
  // tempos: [{tick, uspb}] sorted
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, uspb: 500000 });
  const map = [];
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    if (i > 0) sec += ((tempos[i].tick - tempos[i - 1].tick) * tempos[i - 1].uspb) / 1e6 / res;
    map.push({ tick: tempos[i].tick, sec, uspb: tempos[i].uspb });
  }
  return (tick) => {
    let lo = 0, hi = map.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (map[m].tick <= tick) lo = m; else hi = m - 1; }
    const s = map[lo];
    return s.sec + ((tick - s.tick) * s.uspb) / 1e6 / res;
  };
}

function finish({ res, toSec, rawDiffs, sections, ts, lastTick, meta, offset = 0 }) {
  const sustainMin = res / 2;
  const diffs = {};
  for (const d of DIFFS) {
    const raw = rawDiffs[d.key] || [];
    const notes = raw
      .map((n) => {
        const t = toSec(n.tick) + offset;
        const dur = n.len > sustainMin ? toSec(n.tick + n.len) + offset - t : 0;
        return [r3(t), n.lane, r3(dur)];
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // dedupe identical (t,lane)
    const out = [];
    for (const n of notes) { const p = out[out.length - 1]; if (!p || p[0] !== n[0] || p[1] !== n[1]) out.push(n); }
    diffs[d.key] = { lanes: [...new Set(out.map((n) => n[1]))].sort((a, b) => a - b), notes: out };
  }
  const beats = [];
  const num = ts || 4;
  for (let tk = 0, i = 0; tk <= lastTick + res * 8; tk += res, i++) beats.push([r3(toSec(tk) + offset), i % num === 0 ? 1 : 0]);
  return { v: 1, meta, sections: sections.map(([tk, n]) => [r3(toSec(tk) + offset), n]), beats, diffs };
}

/* ---------------- MIDI ---------------- */
export function parseMidi(buf) {
  const d = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  let p = 0;
  const str = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 127); } while (b & 128); return v; };
  if (str(4) !== "MThd") throw new Error("notes.mid no es un MIDI válido.");
  const hl = u32(); u16(); const ntr = u16(); const div = u16(); p = 8 + hl;
  if (div & 0x8000) throw new Error("MIDI con tiempo SMPTE no soportado.");
  const tracks = [];
  for (let t = 0; t < ntr && p < d.byteLength; t++) {
    const id = str(4), len = u32(), end = p + len;
    if (id !== "MTrk") { p = end; continue; }
    const tr = { name: "", notes: [], tempos: [], texts: [], ts: null };
    let tick = 0, run = 0;
    const open = new Map();
    while (p < end) {
      tick += vlq();
      let st = d.getUint8(p);
      if (st & 0x80) { p++; if (st < 0xf0) run = st; } else st = run;
      if (st === 0xff) {
        const type = d.getUint8(p++), l = vlq(), s = p;
        if (type === 0x51) tr.tempos.push({ tick, uspb: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        else if (type === 0x03) tr.name = str(l).trim();
        else if (type === 0x01) tr.texts.push({ tick, text: str(l) });
        else if (type === 0x58 && tr.ts == null) tr.ts = d.getUint8(p);
        p = s + l;
      } else if (st === 0xf0 || st === 0xf7) {
        p += vlq();
      } else {
        const hi = st & 0xf0;
        if (hi === 0x90 || hi === 0x80) {
          const note = d.getUint8(p), vel = d.getUint8(p + 1); p += 2;
          if (hi === 0x90 && vel > 0) { if (!open.has(note)) open.set(note, []); open.get(note).push(tick); }
          else { const q = open.get(note); if (q && q.length) tr.notes.push({ tick: q.shift(), end: tick, note }); }
        } else if (hi === 0xc0 || hi === 0xd0) p += 1;
        else p += 2;
      }
    }
    p = end;
    tracks.push(tr);
  }
  return { res: div, tracks };
}

export function midiToChart(buf, meta = {}, offset = 0) {
  const midi = parseMidi(buf);
  const tempos = [];
  midi.tracks.forEach((t) => tempos.push(...t.tempos));
  tempos.sort((a, b) => a.tick - b.tick);
  const toSec = tempoMap(tempos, midi.res);
  const gtr = midi.tracks.find((t) => /^PART GUITAR$/i.test(t.name)) || midi.tracks.find((t) => /^T1 GEMS$/i.test(t.name)) || midi.tracks.find((t) => /GUITAR/i.test(t.name) && !/COOP|GHL|REAL/i.test(t.name));
  if (!gtr) throw new Error("No hay pista de guitarra (PART GUITAR).");
  const ev = midi.tracks.find((t) => t.name === "EVENTS");
  const sections = (ev ? ev.texts : [])
    .map((x) => { const m = x.text.match(/\[(?:section|prc)[ _](.+)\]/i); return m ? [x.tick, m[1].replace(/_/g, " ")] : null; })
    .filter(Boolean);
  const rawDiffs = {};
  for (const df of DIFFS)
    rawDiffs[df.key] = gtr.notes.filter((n) => n.note >= df.midi && n.note <= df.midi + 4).map((n) => ({ tick: n.tick, lane: n.note - df.midi, len: n.end - n.tick }));
  const ts = midi.tracks.find((t) => t.ts)?.ts;
  const lastTick = Math.max(0, ...gtr.notes.map((n) => n.end));
  return finish({ res: midi.res, toSec, rawDiffs, sections, ts, lastTick, meta, offset });
}

/* ---------------- .chart (Moonscraper / FeedBack) ---------------- */
export function chartTextToChart(text, meta = {}) {
  const sections = {};
  let cur = null;
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const l = line.trim();
    const h = l.match(/^\[(.+)\]$/);
    if (h) { cur = h[1]; sections[cur] = []; continue; }
    if (cur && l && l !== "{" && l !== "}") sections[cur].push(l);
  }
  const song = {};
  (sections.Song || []).forEach((l) => { const m = l.match(/^(\w+)\s*=\s*"?(.*?)"?$/); if (m) song[m[1].toLowerCase()] = m[2]; });
  const res = +song.resolution || 192;
  const offset = +song.offset || 0;
  const tempos = [];
  let ts = null;
  (sections.SyncTrack || []).forEach((l) => {
    const m = l.match(/^(\d+)\s*=\s*(B|TS)\s+(\d+)/);
    if (!m) return;
    if (m[2] === "B") tempos.push({ tick: +m[1], uspb: 60000000000 / +m[3] });
    else if (ts == null) ts = +m[3];
  });
  tempos.sort((a, b) => a.tick - b.tick);
  const toSec = tempoMap(tempos, res);
  const secs = (sections.Events || [])
    .map((l) => { const m = l.match(/^(\d+)\s*=\s*E\s+"?section\s+(.+?)"?$/i); return m ? [+m[1], m[2]] : null; })
    .filter(Boolean);
  const rawDiffs = {};
  let lastTick = 0;
  for (const df of DIFFS) {
    const lines = sections[df.chart + "Single"] || [];
    rawDiffs[df.key] = [];
    for (const l of lines) {
      const m = l.match(/^(\d+)\s*=\s*N\s+(\d+)\s+(\d+)/);
      if (!m) continue;
      const fret = +m[2];
      if (fret > 4) continue; // 5 force, 6 tap, 7 open → ignored for now
      rawDiffs[df.key].push({ tick: +m[1], lane: fret, len: +m[3] });
      lastTick = Math.max(lastTick, +m[1] + +m[3]);
    }
  }
  if (!DIFFS.some((d) => rawDiffs[d.key].length)) throw new Error("notes.chart no tiene pista de guitarra.");
  const m = { name: meta.name || song.name, artist: meta.artist || song.artist, album: meta.album || song.album, year: meta.year || song.year, charter: meta.charter || song.charter };
  return finish({ res, toSec, rawDiffs, sections: secs, ts, lastTick, meta: m, offset });
}

export function parseIni(text) {
  const o = {};
  text.split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([^=\[;#]+?)\s*=\s*(.*?)\s*$/); if (m) o[m[1].toLowerCase()] = m[2]; });
  return o;
}

export function iniMeta(ini) {
  return { name: ini.name, artist: ini.artist, album: ini.album, year: ini.year ? +ini.year || ini.year : undefined, charter: ini.charter || ini.frets };
}

/* ---------------- lane folding (5 → 4 for touch screens) ---------------- */
// Returns [{t, lane, dur}] using lanes 0..laneCount-1.
export function notesFor(chart, diffKey, laneCount) {
  const src = chart.diffs[diffKey]?.notes || [];
  if (laneCount >= 5) return src.map(([t, lane, dur]) => ({ t, lane, dur }));
  const out = [];
  let i = 0;
  while (i < src.length) {
    let j = i;
    while (j < src.length && src[j][0] === src[i][0]) j++;
    const chord = src.slice(i, j);
    const lanes = chord.map((n) => n[1]);
    const needsFold = lanes.some((l) => l >= laneCount);
    const shift = needsFold && Math.min(...lanes) > 0 ? 1 : 0;
    const seen = new Set();
    for (const [t, lane, dur] of chord) {
      const l = Math.min(laneCount - 1, lane - shift);
      if (seen.has(l)) continue;
      seen.add(l);
      out.push({ t, lane: l, dur });
    }
    i = j;
  }
  return out;
}

export function diffSummary(chart) {
  const o = {};
  for (const d of DIFFS) { const x = chart.diffs[d.key]; o[d.key] = { n: x.notes.length, lanes: x.lanes }; }
  return o;
}
