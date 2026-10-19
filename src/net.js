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
 * Joins a room. Everyone in the channel shares presence {name, lanes, ready, songId, joinedAt, config (the host's)}.
 * The host (earliest joinedAt) picks the song and starts the round.
 * The realtime server may close a channel on its own (too many messages at once, a blip in the connection) without the
 * page noticing: the others see you leave while you still see yourself. So the channel is watched and, if it closes,
 * opened again as the same player (same presence key, same state).
 */
export function joinRoom(code, me, h) {
  if (!supabase) throw new Error("El multijugador necesita Supabase configurado.");
  const id = me.id;
  let state = { ...me, ready: false, joinedAt: Date.now() };
  let ch = null, left = false, retry = null, everIn = false;
  // Someone who drops out of the room for a moment (their channel closing and opening again) stays in the list for a
  // while, marked away: nobody else becomes host and nothing resets meanwhile. Leaving for real says so (event "bye").
  const GRACE = 10000, seen = new Map(); // id → { p, gone }
  let graceT = null;
  const peers = () => {
    const now = Date.now(), cur = ch ? ch.presenceState() : {};
    for (const [k, arr] of Object.entries(cur)) seen.set(k, { p: { id: k, ...arr[arr.length - 1] }, gone: 0 });
    for (const [k, v] of seen) if (!cur[k]) { if (!v.gone) v.gone = now; if (now - v.gone > GRACE) seen.delete(k); }
    const out = [...seen.values()].map((v) => (v.gone ? { ...v.p, away: true } : v.p)).sort((a, b) => a.joinedAt - b.joinedAt);
    if (out.some((p) => p.away) && !graceT) graceT = setTimeout(() => { graceT = null; if (!left) h.onPeers(peers()); }, GRACE + 200);
    return out;
  };
  // Telling the room how we are: one update at a time, the latest state, a few in a row folded into one
  let tracking = null, again = false;
  const push = () => {
    if (tracking) { again = true; return tracking; }
    tracking = (async () => {
      do { again = false; await new Promise((r) => setTimeout(r, 150)); try { if (ch?.state === "joined") await ch.track(state); } catch {} } while (again);
      tracking = null;
    })();
    return tracking;
  };
  const open = () => {
    const mine = supabase.channel(`corde:${code}`, { config: { presence: { key: id }, broadcast: { self: false, ack: false } } });
    ch = mine;
    mine.on("presence", { event: "sync" }, () => { if (ch === mine) h.onPeers(peers()); });
    ["config", "start", "score", "final", "abort", "attack"].forEach((ev) => mine.on("broadcast", { event: ev }, ({ payload }) => { if (ch === mine) h.onEvent(ev, payload); }));
    mine.on("broadcast", { event: "bye" }, ({ payload }) => { if (ch === mine && payload?.from) { seen.delete(payload.from); h.onPeers(peers()); } });
    mine.subscribe(async (status) => {
      if (ch !== mine || left) return;
      if (status === "SUBSCRIBED") { everIn = true; await push(); h.onStatus && h.onStatus("ok"); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (!everIn) h.onStatus && h.onStatus("error");
        reopen();
      }
    });
  };
  // closed by the server: out with the dead channel (the client hands back the same one for the same name while it's
  // there), in with a new one
  const reopen = () => {
    if (left || retry) return;
    retry = setTimeout(async () => {
      const old = ch; ch = null;
      if (old) {
        try { await old.unsubscribe(2000); } catch {} // a dead channel doesn't answer: don't wait the usual 10 s
        try { old.teardown(); } catch {}
        try { if (supabase.realtime.getChannels().includes(old)) supabase.realtime._remove(old); } catch {}
      }
      retry = null;
      if (!left) open();
    }, 1500);
  };
  open();
  // every few seconds: the connection up, the channel joined, and us in it (else say we're here again); and every 30 s
  // anyway, since someone else's view of the room may have lost us without ours noticing
  let ticks = 0;
  const watch = setInterval(() => {
    try {
      ticks++;
      if (!supabase.realtime.isConnected()) supabase.realtime.connect();
      else if (ch && (ch.state === "closed" || ch.state === "errored")) reopen();
      else if (ch?.state === "joined" && (!ch.presenceState()[id] || ticks % 8 === 0)) push();
    } catch {}
  }, 4000);
  return {
    code,
    peers,
    isHost: () => { const p = peers(); return p.length ? p[0].id === id : true; },
    update: (patch) => {
      // nothing new: nothing to send (bursts of messages are what get a player thrown out of the room)
      if (Object.keys(patch).every((k) => JSON.stringify(state[k]) === JSON.stringify(patch[k]))) return tracking || Promise.resolve();
      state = { ...state, ...patch }; return push();
    },
    send: (event, payload) => (ch ? ch.send({ type: "broadcast", event, payload: { ...payload, from: id } }) : Promise.resolve()),
    leave: () => {
      left = true; clearInterval(watch); clearTimeout(retry); clearTimeout(graceT);
      const c = ch; ch = null;
      if (!c) return Promise.resolve();
      try { c.send({ type: "broadcast", event: "bye", payload: { from: id } }); } catch {}
      return new Promise((r) => setTimeout(r, 120)).then(() => supabase.removeChannel(c));
    },
  };
}

/**
 * The open rooms: one shared channel where each room's host tells how it's going (code and players for a public room;
 * for a private one, no code). Whoever only watches doesn't show up in it. onList gets every room on each change.
 * It has its own connection: nothing it sends can count against the room's (or close it).
 */
let dirClient = null;
export function roomDirectory(onList) {
  if (!supabase) return null;
  dirClient ||= createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "corde-salas" } });
  const ch = dirClient.channel("corde:salas", { config: { presence: { key: Math.random().toString(36).slice(2) } } });
  let mine = null, ok = false, sent = 0, later = null;
  const list = () => Object.values(ch.presenceState()).map((a) => a[a.length - 1]).filter((r) => r && r.at);
  const send = () => { later = null; sent = Date.now(); (mine ? ch.track(mine) : ch.untrack()).catch?.(() => {}); };
  ch.on("presence", { event: "sync" }, () => onList(list()));
  ch.subscribe((st) => { if (st === "SUBSCRIBED") { ok = true; if (mine) send(); } });
  return {
    /** This browser's room (null: none). At most one update every 3 s. */
    set(info) {
      mine = info; if (!ok) return;
      clearTimeout(later);
      const wait = sent + 3000 - Date.now();
      if (wait <= 0) send(); else later = setTimeout(send, wait);
    },
    close: () => { clearTimeout(later); return dirClient.removeChannel(ch); },
  };
}

/* ---------------- secret songs ---------------- */
// Songs the admin hid: the public library never includes them; the database hands them out only with the secret code.
const rpcError = (error) => { const e = new Error(error.message); e.wrongCode = error.code === "28000"; return e; };
/** A secret code's group: { id, name, songs } (songs: all columns, like listSongs). Throws an error with
 *  wrongCode = true when the code is wrong. */
export async function secretOpen(code) {
  if (!supabase) return { id: 0, name: "", songs: [] };
  const { data, error } = await supabase.rpc("secret_open", { p_code: code.trim() });
  if (error) throw rpcError(error);
  return { id: data.id, name: data.name, songs: data.songs || [] };
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
/** The kittens' challenge from the boards: { songId: best accuracy } of this name on the miau songs. */
export async function fetchMiauProgress(name) {
  if (!supabase || !name) return {};
  const { data, error } = await supabase.rpc("miau_progress", { p_name: name });
  if (error) throw new Error(error.message);
  return data || {};
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
  await putFiles(code, id, files, onProgress);
  await adminCall({ code, action: "save", row });
}
/** A library song's guitar, separated (admin.js separateExisting): its new files, then only what changed in its row. */
export async function uploadStems(code, id, { files, patch }, onProgress) {
  await putFiles(code, id, files, onProgress);
  await adminCall({ code, action: "stems", id, ...patch });
}
async function putFiles(code, id, files, onProgress) {
  // the chart last: its new hash is what sends players to the new audio (downloadSong), so it never points at files not there yet
  const names = Object.keys(files).sort((a, b) => (a === "chart.json") - (b === "chart.json"));
  const { uploads } = await adminCall({ code, action: "sign", id, files: names });
  let done = 0;
  for (const u of uploads) {
    const blob = files[u.name];
    // straight to R2 with the signed URL; the chart is always read fresh, the rest is cached for a year (versioned URLs)
    const res = await fetch(u.url, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream", "Cache-Control": u.name === "chart.json" ? "no-cache" : "public, max-age=31536000" } });
    if (!res.ok) throw new Error(`subiendo ${u.name}: ${res.status}`);
    onProgress && onProgress(++done / uploads.length);
  }
}

/* ---------------- song requests and notices (inbox.sql) ---------------- */
/** A song request from this browser's account → { ok } | { error: "no_account" | "empty" | "limit" } */
export const songRequest = (secret, body) => rpcJson("song_request", { p_secret: secret, p_body: body });
/** The notices this account hasn't seen → [{ id, body, at }] */
export const myNotices = (secret) => rpcJson("my_notices", { p_secret: secret });
export const noticeSeen = (secret, id) => rpcJson("notice_seen_by", { p_secret: secret, p_id: id });
/** An answer to a notice → { ok } | { error } */
export const noticeReply = (secret, id, body) => rpcJson("notice_reply", { p_secret: secret, p_id: id, p_body: body });
/** This account's requests that now have their song → [{ id, body, song: { id, name, artist, has_cover } }] */
export const myFulfilled = (secret) => rpcJson("my_fulfilled", { p_secret: secret });
export const fulfilledSeen = (secret, id) => rpcJson("fulfilled_seen", { p_secret: secret, p_id: id });

/* ---------------- comments to the admin, private (comments.sql, comments_private.sql) ---------------- */
/** A comment from this browser's account → { ok } | { error: "no_account" | "empty" | "limit" } */
export const commentPost = (secret, body) => rpcJson("comment_post", { p_secret: secret, p_body: body });
/** This account's own comments and the admin's answers, newest first → [{ id, body, at, reply, replied_at }] */
export const myComments = (secret) => rpcJson("my_comments", { p_secret: secret });
/** This account's comments answered by the admin, not shown yet → [{ id, body, reply }] */
export const myCommentReplies = (secret) => rpcJson("my_comment_replies", { p_secret: secret });
export const commentReplySeen = (secret, id) => rpcJson("comment_reply_seen", { p_secret: secret, p_id: id });

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
/** The players with an account: their name's style and level on the boards → [{ name_key, style, level }] (name_key: lowercase, no accents). */
export async function nameStyles() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("name_styles").select("name_key, style, level");
  if (error) throw new Error(error.message);
  return data || [];
}
