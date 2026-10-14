// Supabase: song library (Postgres + Storage) and multiplayer rooms (Realtime).
import { createClient } from "@supabase/supabase-js";

// The project URL and the public (anon) key are safe to ship in the browser; writes go through the admin-upload function.
const URL = import.meta.env.VITE_SUPABASE_URL || "https://chnghmzybfnaktqsaveo.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNobmdobXp5YmZuYWt0cXNhdmVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4ODExNjgsImV4cCI6MjEwNjQ1NzE2OH0.Q5r388ra-TBC5dZ4_tKBF8LZuqpx4P_eSsLJoT3wzIE";
export const BUCKET = "songs";
// The song files (audio, charts, covers) are served from Cloudflare R2: free downloads, 10 GB free.
const FILES_URL = import.meta.env.VITE_FILES_URL || "https://pub-daa029222392489f9b136b1d23fac19a.r2.dev";
// The game's downloads (chart + audio) go through a Cloudflare Worker that keeps a copy of each song version near
// the players; if it ever fails (or its free daily quota runs out) the same file comes from the bucket's own link.
const SONGS_URL = import.meta.env.VITE_SONGS_URL || "https://corde-files.a-gianni2003.workers.dev";

export const supabase = URL && KEY ? createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 20 } } }) : null;
export const online = !!supabase;

/* ---------------- library ---------------- */
export async function listSongs() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("songs").select("*").order("artist").order("name");
  if (error) throw new Error("No se pudo cargar la biblioteca: " + error.message);
  return data;
}

export function fileUrl(songId, file) {
  return `${FILES_URL}/${songId}/${file}`;
}

async function fetchBuf(url, onProgress, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`No se pudo descargar ${url.split("/").pop().split("?")[0]} (${res.status}).`);
  if (!onProgress || !res.body) return res.arrayBuffer();
  const total = +res.headers.get("content-length") || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// FNV-1a of the chart bytes: changes whenever a song is re-uploaded, so it versions the audio URLs too.
function hashBytes(buf) {
  const b = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/**
 * Downloads chart + stems of a library song.
 * The chart (small) is always fetched fresh, past browser and CDN caches; the stems are fetched with
 * ?v=<chart hash>, so they stay cached between plays but a re-upload can never pair a new chart with old audio
 * (or an old cached chart with a new offset).
 */
export async function downloadSong(song, onProgress) {
  const files = [{ name: "backing", file: song.backing_file || "backing.mp3", guitar: false }];
  if (song.has_guitar) files.push({ name: "guitar", file: song.guitar_file || "guitar.mp3", guitar: true });
  const prog = new Array(files.length).fill(0), tot = new Array(files.length).fill(1);
  const report = () => onProgress && onProgress(prog.reduce((a, b) => a + b, 0) / Math.max(1, tot.reduce((a, b) => a + b, 0)));
  // the Worker first, the bucket's link if that fails
  const get = async (file, query, onP, init) => {
    try { return await fetchBuf(`${SONGS_URL}/${song.id}/${file}?${query}`, onP, init); }
    catch (e) { console.warn("worker:", e.message); return fetchBuf(`${fileUrl(song.id, file)}?${query}`, onP, init); }
  };
  const chartBuf = await get("chart.json", `t=${Date.now()}`, null, { cache: "no-store" });
  const v = hashBytes(chartBuf);
  const chart = JSON.parse(new TextDecoder().decode(chartBuf));
  const stems = await Promise.all(files.map((f, i) => get(f.file, `v=${v}`, (g, t) => { prog[i] = g; tot[i] = t || g * 2; report(); })));
  return { chart, v, stems: stems.map((data, i) => ({ name: files[i].name, guitar: files[i].guitar, data })) };
}

/* ---------------- rooms ---------------- */
export function newRoomCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}

/**
 * Joins a room. Everyone in the channel shares presence {name, lanes, ready, joinedAt}.
 * The host (earliest joinedAt) picks the song and starts the round.
 */
export function joinRoom(code, me, h) {
  if (!supabase) throw new Error("El multijugador necesita Supabase configurado.");
  const id = me.id;
  const ch = supabase.channel(`corde:${code}`, { config: { presence: { key: id }, broadcast: { self: false, ack: false } } });
  let state = { ...me, ready: false, joinedAt: Date.now() };
  const peers = () => {
    const ps = ch.presenceState();
    return Object.entries(ps).map(([k, arr]) => ({ id: k, ...arr[arr.length - 1] })).sort((a, b) => a.joinedAt - b.joinedAt);
  };
  ch.on("presence", { event: "sync" }, () => h.onPeers(peers()));
  ["config", "start", "score", "final", "abort"].forEach((ev) => ch.on("broadcast", { event: ev }, ({ payload }) => h.onEvent(ev, payload)));
  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") { await ch.track(state); h.onStatus && h.onStatus("ok"); }
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") h.onStatus && h.onStatus("error");
  });
  return {
    code,
    peers,
    isHost: () => { const p = peers(); return p.length ? p[0].id === id : true; },
    update: (patch) => { state = { ...state, ...patch }; return ch.track(state); },
    send: (event, payload) => ch.send({ type: "broadcast", event, payload: { ...payload, from: id } }),
    leave: () => supabase.removeChannel(ch),
  };
}

/* ---------------- secret songs ---------------- */
// Songs the admin hid: the public library never includes them; the database hands them out only with the secret code.
const rpcError = (error) => { const e = new Error(error.message); e.wrongCode = error.code === "28000"; return e; };
/** The hidden songs (all columns, like listSongs). Throws an error with wrongCode = true when the code is wrong. */
export async function secretSongs(code) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("secret_songs", { p_code: code.trim() });
  if (error) throw rpcError(error);
  return data || [];
}
/** A hidden song's leaderboard (the public board views can't see hidden songs). Same rows as topScores. */
// Boards show everyone (up to this many rows, far more than ever play one song).
export const BOARD_MAX = 1000;
export async function secretBoard(code, songId, diff, lanes, limit = BOARD_MAX) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("secret_board", { p_code: code.trim(), p_song_id: songId, p_diff: diff, p_lanes: lanes, p_limit: limit });
  if (error) throw rpcError(error);
  return data || [];
}
/** One song by its exact id, hidden or not (a secret song picked in a multiplayer room). */
export async function songById(id) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("song_by_id", { p_id: id });
  if (error) throw new Error(error.message);
  return (data && data[0]) || null;
}

/* ---------------- leaderboard ---------------- */
/** period "all" (every run ever) or "week" (Monday to Sunday, Colombia time; it starts empty every Monday). */
export async function topScores(songId, diff, lanes, limit = BOARD_MAX, period = "all") {
  if (!supabase) return [];
  const view = period === "week" ? "board_week_song" : "board_song";
  const { data, error } = await supabase.from(view).select("name, score, acc, max_combo").match({ song_id: songId, diff, lanes }).order("score", { ascending: false }).order("updated_at").limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

/** Home screen boards, all string counts together: kind "total" (sum of best scores) or "best" (each player's best run). */
export async function generalBoard(kind, limit = BOARD_MAX, period = "all") {
  if (!supabase) return [];
  const wk = period === "week";
  const q = kind === "total"
    ? supabase.from(wk ? "board_week_total" : "board_total_all").select("name, total, songs").order("total", { ascending: false })
    : supabase.from(wk ? "board_week_best" : "board_best_all").select("name, score, song, artist, diff").order("score", { ascending: false });
  const { data, error } = await q.limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

export async function submitScore(body) {
  const { data, error } = await supabase.functions.invoke("submit-score", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  // picks: what the run earned → { earned, balance, base, first, record, reason: "ok" | "cooldown" | "cap" } | null (no account)
  return data; // { best, rank, newRecord, lanes, picks }
}

/* ---------------- song of the day ---------------- */
/** Today's song for everyone (Colombia's calendar): { day: "2026-10-02", song_id }. Picks it if nobody has asked yet. */
export async function dailyToday() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("daily_today");
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The day's board for one song, difficulty and string count: everyone, how many played, and where `me`
 * (a lowercased name) stands → { rows, total, mine: { score, rank } | null }.
 */
export async function dailyBoard({ day, songId, diff, lanes, me }) {
  if (!supabase) return { rows: [], total: 0, mine: null };
  const board = { day, song_id: songId, diff, lanes };
  const t = () => supabase.from("daily_scores");
  const [top, count, mine] = await Promise.all([
    t().select("name, score, acc, stars").match(board).order("score", { ascending: false }).order("updated_at").limit(BOARD_MAX),
    t().select("id", { count: "exact", head: true }).match(board),
    me ? t().select("score").match(board).eq("name_key", me).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  for (const r of [top, count, mine]) if (r.error) throw new Error(r.error.message);
  let rank = null;
  if (mine.data) {
    const above = await t().select("id", { count: "exact", head: true }).match(board).gt("score", mine.data.score);
    if (above.error) throw new Error(above.error.message);
    rank = (above.count || 0) + 1;
  }
  return { rows: top.data, total: count.count || 0, mine: mine.data ? { score: mine.data.score, rank } : null };
}

/** A run of the day's song → { best, rank, players, newRecord, picks: { earned, balance } | null } (picks: the day's bonus, once a day). */
export async function submitDaily(r) {
  const { data, error } = await supabase.rpc("submit_daily", {
    p_day: r.day, p_song_id: r.song_id, p_diff: r.diff, p_lanes: r.lanes, p_name: r.name, p_secret: r.secret,
    p_score: r.score, p_acc: r.acc, p_max_combo: r.max_combo, p_stars: r.stars,
  });
  if (error) throw new Error(error.message);
  return data;
}

/* ---------------- admin uploads ---------------- */
export async function adminCall(body) {
  const { data, error } = await supabase.functions.invoke("admin-upload", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}

/** Uploads a converted song: signed URLs for each file, then the catalog row. */
export async function uploadSong(code, { id, row, files }, onProgress) {
  const names = Object.keys(files);
  const { uploads } = await adminCall({ code, action: "sign", id, files: names });
  let done = 0;
  for (const u of uploads) {
    const blob = files[u.name];
    // straight to R2 with the signed URL; the chart is always read fresh, the rest is cached for a year (versioned URLs)
    const res = await fetch(u.url, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream", "Cache-Control": u.name === "chart.json" ? "no-cache" : "public, max-age=31536000" } });
    if (!res.ok) throw new Error(`subiendo ${u.name}: ${res.status}`);
    onProgress && onProgress(++done / uploads.length);
  }
  await adminCall({ code, action: "save", row });
}

/* ---------------- accounts ---------------- */
// One name = one account (accounts.sql). The browser's secret ("corde.player") is its key to the account.
async function rpcJson(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
// Every account payload also brings its wallet (the shop): { picks, owned: ["slot:id", …], equipped: { slot: id } }.
/** This browser's account → { name, code, progress, wallet } | null */
export const accountMe = (secret) => rpcJson("account_me", { p_secret: secret });
/** Takes a name → { name, code, progress, wallet } | { error: "name_taken" } */
export const accountClaim = (name, secret) => rpcJson("account_claim", { p_name: name, p_secret: secret });
/** Joins the account with that name using its code → { name, code, progress, wallet } | { error: "bad_code" } */
export const accountLink = (name, code, secret) => rpcJson("account_link", { p_name: name, p_code: code, p_secret: secret });
/** Merges this browser's progress into the account → merged progress | null */
export const accountSync = (secret, progress) => rpcJson("account_sync", { p_secret: secret, p_progress: progress });

/* ---------------- shop ---------------- */
// Prices and what each account owns live on the server (shop.sql); the browser only asks.
/** Buys an item (or claims a logro's prize) and puts it on → wallet | { error: "no_account" | "unknown" | "owned" | "locked" | "not_enough" } */
export const shopBuy = (secret, slot, item) => rpcJson("shop_buy", { p_secret: secret, p_slot: slot, p_item: item });
/** Puts on an item you own (or a slot's default) → wallet | { error: "not_owned" | "no_account" } */
export const shopEquip = (secret, slot, item) => rpcJson("shop_equip", { p_secret: secret, p_slot: slot, p_item: item });
/** The players whose name has a style on the boards → [{ name_key, style }] (name_key: lowercase, no accents). */
export async function nameStyles() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("name_styles").select("name_key, style");
  if (error) throw new Error(error.message);
  return data || [];
}
