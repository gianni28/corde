// Corde — submit a score to the leaderboard.
// Keeps only each player's best per song + difficulty + string count, rejects impossible scores,
// and answers with the player's best and position. The player's key is a hash of a secret kept in their browser.
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

  const key = await sha256(b.secret);
  const board = { song_id: b.song_id, diff: b.diff, lanes: b.lanes };
  const { data: prev } = await db.from("scores").select("id, score").match({ ...board, player_key: key }).maybeSingle();
  const newRecord = !prev || score > prev.score;
  const row = {
    ...board, player_key: key, name, updated_at: new Date().toISOString(),
    ...(newRecord ? { score, acc: Number(b.acc) || 0, max_combo: Math.round(Number(b.max_combo) || 0), stars: Math.round(Number(b.stars) || 0) } : {}),
  };
  const { error } = prev
    ? await db.from("scores").update(row).eq("id", prev.id)
    : await db.from("scores").insert(row);
  if (error) return json({ error: error.message }, 500);

  const best = newRecord ? score : prev!.score;
  const { count } = await db.from("scores").select("id", { count: "exact", head: true }).match(board).gt("score", best);
  return json({ best, rank: (count || 0) + 1, newRecord });
});
