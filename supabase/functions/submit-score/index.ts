// Corde — submit a score to the leaderboard.
// One entry per NAME (case-insensitive) on each song + difficulty + string count, keeping the best score,
// so the same person on another browser or phone joins their existing entry. Rejects impossible scores
// and answers with the best and position. player_key (hash of a secret kept in the browser) only lets a
// browser that changes its name move its entry. Only a browser linked to the name's account can send (accounts.sql).
// The string count is the one really played: a 5-string run of a difficulty whose chart never uses the
// 5th string is a 4-string run (same notes), so it goes to the 4-string board.
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

// Highest score the game could award for n notes (multiplier ramps ×1→×4 every 10 notes, and star power
// doubles it, so ×8 at most) plus sustain points if every second of the song were held at ×8.
function maxScore(n: number, seconds: number) {
  let notes = 0;
  for (let i = 0; i < n; i++) notes += 50 * 2 * Math.min(4, 1 + Math.floor(i / 10));
  return notes + 60 * 8 * seconds * 2 + 100;
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

  // the name has to be this browser's account (one name = one account); the account's spelling is the one shown
  const { data: owned, error: guardErr } = await db.rpc("account_guard", { p_name: name, p_secret: b.secret });
  if (guardErr || !owned) return json({ error: guardErr?.message || "Primero escribe tu nombre" }, 403);
  const accountName = owned as string;

  const key = await sha256(b.secret);
  const usesFifth = (song.diffs?.[b.diff]?.lanes ?? [4]).includes(4);
  const lanes = b.lanes === 5 && usesFifth ? 5 : 4;
  const stored = lanes === 4 && !usesFifth ? [4, 5] : [lanes]; // older rows of this board may say 5
  const board = { song_id: b.song_id, diff: b.diff };
  const find = async (col: string, val: string) => {
    const { data } = await db.from("scores").select("id, score").match(board).in("lanes", stored).eq(col, val)
      .order("score", { ascending: false }).limit(1);
    return data?.[0] || null;
  };
  // this name's entry (older data may hold several: take the best)...
  // ...or this browser's entry under a previous name, which then takes the new name
  const prev = (await find("name_key", accountName.trim().toLowerCase())) || (await find("player_key", key));
  const newRecord = !prev || score > prev.score;
  const row = {
    name: accountName, updated_at: new Date().toISOString(),
    ...(newRecord ? { score, acc: Number(b.acc) || 0, max_combo: Math.round(Number(b.max_combo) || 0), stars: Math.round(Number(b.stars) || 0) } : {}),
  };
  const { error } = prev
    ? await db.from("scores").update(row).eq("id", prev.id)
    : await db.from("scores").insert({ ...board, lanes, player_key: key, ...row });
  if (error) return json({ error: error.message }, 500);

  const best = newRecord ? score : prev!.score;
  const { count } = await db.from("board_song").select("name", { count: "exact", head: true }).match({ ...board, lanes }).gt("score", best);
  return json({ best, rank: (count || 0) + 1, newRecord, lanes });
});
