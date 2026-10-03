// Corde — admin upload relay.
// The browser converts songs locally, then asks this function (with the admin code) for signed upload URLs
// and to save the catalog row. The service-role key never leaves Supabase.
// It also manages the secret songs: hiding/showing a song and changing the code that unlocks them.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// sha-256 of the admin code (the code itself is not stored here)
const CODE_HASH = "fba187d20f8355ecf4b72424ffbe2e2e805bb6ca47c89b245a9120a833e3d3b9";
const FILES = new Set(["chart.json", "backing.mp3", "guitar.mp3", "cover.jpg"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const validId = (id: unknown) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }
  if (typeof body.code !== "string" || (await sha256(body.code.trim())) !== CODE_HASH) return json({ error: "Código de administrador incorrecto" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (body.action === "check") return json({ ok: true });

  if (body.action === "sign") {
    if (!validId(body.id) || !Array.isArray(body.files)) return json({ error: "Datos inválidos" }, 400);
    const out = [];
    for (const name of body.files) {
      if (!FILES.has(name)) return json({ error: `Archivo no permitido: ${name}` }, 400);
      const path = `${body.id}/${name}`;
      const { data, error } = await admin.storage.from("songs").createSignedUploadUrl(path, { upsert: true });
      if (error) return json({ error: error.message }, 500);
      out.push({ name, path, token: data.token });
    }
    return json({ uploads: out });
  }

  if (body.action === "save") {
    const r = body.row || {};
    if (!validId(r.id) || typeof r.name !== "string" || typeof r.diffs !== "object") return json({ error: "Fila inválida" }, 400);
    const row: Record<string, unknown> = {
      id: r.id, name: String(r.name).slice(0, 200), artist: r.artist ? String(r.artist).slice(0, 200) : null,
      album: r.album ? String(r.album).slice(0, 200) : null, year: Number.isInteger(r.year) ? r.year : null,
      charter: r.charter ? String(r.charter).slice(0, 200) : null, genre: r.genre ? String(r.genre).slice(0, 100) : null,
      duration_ms: Number.isFinite(r.duration_ms) ? Math.round(r.duration_ms) : null, diffs: r.diffs,
      has_guitar: !!r.has_guitar, has_cover: !!r.has_cover, backing_file: "backing.mp3", guitar_file: r.has_guitar ? "guitar.mp3" : null,
      audio_offset_ms: Number.isFinite(r.audio_offset_ms) ? Math.max(-3000, Math.min(3000, Math.round(r.audio_offset_ms))) : 0,
    };
    // secret or not: only when the upload says so (a re-upload without it keeps what the song was)
    if (typeof r.hidden === "boolean") row.hidden = r.hidden;
    const { error } = await admin.from("songs").upsert(row);
    if (error) return json({ error: error.message }, 500);
    // a real chart replacing an automatic one: the old scores were made on other notes, so they go
    if (body.resetScores === true) {
      const { error: e2 } = await admin.from("scores").delete().eq("song_id", row.id);
      if (e2) return json({ error: e2.message }, 500);
    }
    return json({ ok: true });
  }

  // removes a song: its files and its row (its scores go with it, ON DELETE CASCADE)
  if (body.action === "delete") {
    if (!validId(body.id)) return json({ error: "Datos inválidos" }, 400);
    await admin.storage.from("songs").remove([...FILES].map((f) => `${body.id}/${f}`));
    const { error } = await admin.from("songs").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // the whole library, secret songs included (the public library can't see them)
  if (body.action === "list") {
    const { data, error } = await admin.from("songs").select("id, name, artist, charter, hidden").order("artist").order("name");
    if (error) return json({ error: error.message }, 500);
    return json({ songs: data });
  }

  // a song becomes secret, or comes back to the library
  if (body.action === "hide") {
    if (!validId(body.id) || typeof body.hidden !== "boolean") return json({ error: "Datos inválidos" }, 400);
    const { data, error } = await admin.from("songs").update({ hidden: body.hidden }).eq("id", body.id).select("id");
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: "Esa canción ya no existe" }, 404);
    return json({ ok: true });
  }

  // the code that unlocks the secret songs (stored as the sha-256 of its lowercased text, like the database checks it)
  if (body.action === "secret") {
    const secret = typeof body.secret === "string" ? body.secret.trim().toLowerCase() : "";
    if (secret.length < 3 || secret.length > 40) return json({ error: "El código secreto debe tener entre 3 y 40 caracteres" }, 400);
    const { error } = await admin.from("secret_config").upsert({ id: 1, code_hash: await sha256(secret), updated_at: new Date().toISOString() });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
});
