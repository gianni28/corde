// Corde — submit a score to the leaderboard.
// One entry per NAME (case-insensitive) on each song + difficulty + string count, keeping the best score,
// so the same person on another browser or phone joins their existing entry. Rejects impossible scores
// and answers with the best and position. player_key (hash of a secret kept in the browser) only lets a
// browser that changes its name move its entry.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DIFFS = new Set(["easy", "medium", "hard", "expert"]);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Highest score the game could award for n notes (multiplier ramps ×1→×4 every 10 notes)
// plus sustain points if every second of the song were held at ×4.
function maxScore(n: number, seconds: number) {
  let notes = 0;
  for (let i = 0; i < n; i++) notes += 50 * Math.min(4, 1 + Math.floor(i / 10));
  return notes + 60 * 4 * seconds * 2 + 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }

  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ").slice(0, 16) : "";
  const score = Math.round(Number(b.score));
  if (typeof b.song_id !== "string" || !DIFFS.has(b.diff) || ![4, 5].includes(b.lanes) || !name ||
      typeof b.secret !== "string" || b.secret.length < 16 || !Number.isFinite(score) || score < 0) {
    return json({ error: "Datos inválidos" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: song } = await db.from("songs").select("id, diffs, duration_ms").eq("id", b.song_id).maybeSingle();
  if (!song) return json({ error: "Canción desconocida" }, 404);
  const n = song.diffs?.[b.diff]?.n ?? 0;
  if (!n || score > maxScore(n, (song.duration_ms || 600000) / 1000) || (Number(b.max_combo) || 0) > n) {
    return json({ error: "Puntaje no válido" }, 422);
  }

  if (score === 0) return json({ best: 0, rank: null, newRecord: false }); // empty runs stay off the board

  const key = await sha256(b.secret);
  const board = { song_id: b.song_id, diff: b.diff, lanes: b.lanes };
  // this name's entry (older data may hold several: take the best)...
  const { data: same } = await db.from("scores").select("id, score").match(board).eq("name_key", name.toLowerCase())
    .order("score", { ascending: false }).limit(1);
  let prev = same?.[0] || null;
  // ...or this browser's entry under a previous name, which then takes the new name
  if (!prev) {
    const { data: mine } = await db.from("scores").select("id, score").match({ ...board, player_key: key }).maybeSingle();
    prev = mine || null;
  }
  const newRecord = !prev || score > prev.score;
  const row = {
    name, updated_at: new Date().toISOString(),
    ...(newRecord ? { score, acc: Number(b.acc) || 0, max_combo: Math.round(Number(b.max_combo) || 0), stars: Math.round(Number(b.stars) || 0) } : {}),
  };
  const { error } = prev
    ? await db.from("scores").update(row).eq("id", prev.id)
    : await db.from("scores").insert({ ...board, player_key: key, ...row });
  if (error) return json({ error: error.message }, 500);

  const best = newRecord ? score : prev!.score;
  const { count } = await db.from("board_song").select("name", { count: "exact", head: true }).match(board).gt("score", best);
  return json({ best, rank: (count || 0) + 1, newRecord });
});
