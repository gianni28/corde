#!/usr/bin/env node
// Uploads Clone Hero song folders to the Corde library (Supabase).
//
//   npm run upload-songs -- "C:\Users\Gianni\Documents\Clone Hero\Songs"
//   npm run upload-songs -- "<carpeta>" --dry      (solo convierte, no sube; deja todo en ./out)
//   npm run upload-songs -- "<carpeta>" --force    (vuelve a subir canciones que ya estaban)
//
// For every folder with song.ini + notes.mid/notes.chart it:
//   1. converts the chart to Corde's chart.json (guitar only)
//   2. mixes every audio stem except guitar into backing.mp3, and guitar into guitar.mp3
//   3. resizes album art to cover.jpg
//   4. uploads to the "songs" bucket and upserts a row in the "songs" table
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";
import { midiToChart, chartTextToChart, parseIni, iniMeta, diffSummary } from "../src/chart.js";

const run = promisify(execFile);
const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry");
const FORCE = args.includes("--force");
const OUT = path.resolve("out");
const AUDIO = /\.(opus|ogg|mp3|wav|m4a|flac)$/i;
const SKIP_AUDIO = /^(preview|crowd)\./i;

if (!root || !fs.existsSync(root)) {
  console.error('Uso: npm run upload-songs -- "<carpeta de canciones de Clone Hero>" [--dry] [--force]');
  process.exit(1);
}

let supabase = null;
if (!DRY) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el archivo .env (mira .env.example).");
    process.exit(1);
  }
  supabase = createClient(url, key, { auth: { persistSession: false } });
}

const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const stripTags = (s = "") => s.replace(/<[^>]+>/g, "").trim();

function findSongDirs(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase());
  if (names.includes("song.ini") && (names.includes("notes.mid") || names.includes("notes.chart"))) out.push(dir);
  for (const e of entries) if (e.isDirectory()) findSongDirs(path.join(dir, e.name), out);
  return out;
}

async function ffmpeg(argv) {
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...argv], { maxBuffer: 1 << 26 });
}

async function mix(inputs, outFile) {
  const a = inputs.flatMap((f) => ["-i", f]);
  const filter = inputs.length > 1 ? ["-filter_complex", `amix=inputs=${inputs.length}:normalize=0:duration=longest,alimiter=limit=0.95`] : [];
  await ffmpeg([...a, ...filter, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", outFile]);
}

async function processSong(dir) {
  const files = fs.readdirSync(dir);
  const find = (re) => files.find((f) => re.test(f));
  const ini = parseIni(fs.readFileSync(path.join(dir, find(/^song\.ini$/i)), "utf8"));
  const meta = iniMeta(ini);
  meta.name = stripTags(meta.name); meta.artist = stripTags(meta.artist); meta.album = stripTags(meta.album);
  const midFile = find(/^notes\.mid$/i), chartFile = find(/^notes\.chart$/i);
  const chart = midFile ? midiToChart(fs.readFileSync(path.join(dir, midFile)), meta) : chartTextToChart(fs.readFileSync(path.join(dir, chartFile), "utf8"), meta);
  const summary = diffSummary(chart);
  if (!Object.values(summary).some((d) => d.n > 0)) throw new Error("sin notas de guitarra");

  const audio = files.filter((f) => AUDIO.test(f) && !SKIP_AUDIO.test(f));
  const guitar = audio.filter((f) => /^guitar\./i.test(f));
  const backing = audio.filter((f) => !/^guitar\./i.test(f));
  if (!backing.length && !guitar.length) throw new Error("sin audio");

  const name = chart.meta.name || path.basename(dir);
  const artist = chart.meta.artist || "";
  const id = slug(`${artist}-${name}`) || slug(path.basename(dir));

  if (supabase && !FORCE) {
    const { data } = await supabase.from("songs").select("id").eq("id", id).maybeSingle();
    if (data) return { id, name, skipped: true };
  }

  const out = path.join(OUT, id);
  fs.mkdirSync(out, { recursive: true });
  // if there is only a guitar stem, it becomes the backing track
  const backingInputs = (backing.length ? backing : guitar).map((f) => path.join(dir, f));
  await mix(backingInputs, path.join(out, "backing.mp3"));
  const hasGuitar = backing.length > 0 && guitar.length > 0;
  if (hasGuitar) await mix(guitar.map((f) => path.join(dir, f)), path.join(out, "guitar.mp3"));

  const art = find(/^album\.(jpe?g|png)$/i);
  if (art) await ffmpeg(["-i", path.join(dir, art), "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512", "-q:v", "4", path.join(out, "cover.jpg")]);
  fs.writeFileSync(path.join(out, "chart.json"), JSON.stringify(chart));

  const durationMs = +ini.song_length || Math.round((chart.beats.at(-1)?.[0] || 0) * 1000);
  const row = {
    id, name, artist, album: chart.meta.album || null, year: chart.meta.year ? parseInt(chart.meta.year) || null : null,
    charter: stripTags(chart.meta.charter || "") || null, genre: ini.genre || null, duration_ms: durationMs,
    diffs: summary, has_guitar: hasGuitar, has_cover: !!art, backing_file: "backing.mp3", guitar_file: hasGuitar ? "guitar.mp3" : null,
  };
  fs.writeFileSync(path.join(out, "row.json"), JSON.stringify(row, null, 2));

  if (supabase) {
    const types = { "chart.json": "application/json", "backing.mp3": "audio/mpeg", "guitar.mp3": "audio/mpeg", "cover.jpg": "image/jpeg" };
    for (const f of fs.readdirSync(out)) {
      if (!types[f]) continue;
      const { error } = await supabase.storage.from("songs").upload(`${id}/${f}`, fs.readFileSync(path.join(out, f)), { contentType: types[f], upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`subiendo ${f}: ${error.message}`);
    }
    const { error } = await supabase.from("songs").upsert(row);
    if (error) throw new Error(`guardando en la tabla: ${error.message}`);
  }
  const mb = fs.readdirSync(out).reduce((a, f) => a + fs.statSync(path.join(out, f)).size, 0) / 1048576;
  return { id, name, mb };
}

const dirs = findSongDirs(path.resolve(root));
console.log(`Encontré ${dirs.length} canción(es) en ${root}${DRY ? " (modo prueba, no se sube nada)" : ""}\n`);
let ok = 0, skipped = 0, failed = 0, totalMb = 0;
for (const dir of dirs) {
  const label = path.basename(dir);
  try {
    const r = await processSong(dir);
    if (r.skipped) { skipped++; console.log(`  · ${label} — ya estaba (usa --force para reemplazarla)`); }
    else { ok++; totalMb += r.mb; console.log(`  ✓ ${label} → ${r.id} (${r.mb.toFixed(1)} MB)`); }
  } catch (e) {
    failed++; console.log(`  ✗ ${label} — ${e.message}`);
  }
}
console.log(`\nListo: ${ok} subida(s), ${skipped} omitida(s), ${failed} con error. Total ${totalMb.toFixed(1)} MB.`);
