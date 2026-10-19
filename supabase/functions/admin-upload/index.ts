// Corde — admin upload relay.
// The browser converts songs locally, then asks this function (with the admin code) for signed upload URLs (Cloudflare R2)
// and to save the catalog row. The service-role key never leaves Supabase.
// It also manages the secret songs: the codes (each opens its own group) and which group each song is in.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

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
// The song files live in Cloudflare R2 (free downloads): uploads get a signed PUT URL for the bucket.
const env = (k: string) => Deno.env.get(k) || "";
const r2 = () => new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
const r2Url = (path: string) => `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}/${path}`;
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
      const signed = await r2().sign(`${r2Url(path)}?X-Amz-Expires=3600`, { method: "PUT", aws: { signQuery: true } });
      out.push({ name, path, url: signed.url });
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
    // secret or not: only when the upload says so (a re-upload without it keeps what the song was).
    // secret_group: the code whose songs it joins (a hidden song without one shows up for nobody)
    if (Number.isInteger(r.secret_group)) { row.hidden = true; row.secret_group = r.secret_group; }
    else if (typeof r.hidden === "boolean") { row.hidden = r.hidden; row.secret_group = r.hidden ? 1 : null; } // panels from before the groups
    const { error } = await admin.from("songs").upsert(row);
    if (error) return json({ error: error.message }, 500);
    // a real chart replacing an automatic one: the old scores were made on other notes, so they go
    if (body.resetScores === true) {
      const { error: e2 } = await admin.from("scores").delete().eq("song_id", row.id);
      if (e2) return json({ error: e2.message }, 500);
    }
    return json({ ok: true });
  }

  // a song that was one audio now has its guitar apart (separated in the admin's browser): only what that changes.
  // diffs come too when the notes were made again from the guitar (an automatic chart); then its old scores go.
  if (body.action === "stems") {
    if (!validId(body.id) || !Number.isFinite(body.audio_offset_ms)) return json({ error: "Datos inválidos" }, 400);
    const patch: Record<string, unknown> = {
      has_guitar: true, guitar_file: "guitar.mp3", backing_file: "backing.mp3",
      audio_offset_ms: Math.max(-3000, Math.min(3000, Math.round(body.audio_offset_ms))),
    };
    if (body.diffs && typeof body.diffs === "object") patch.diffs = body.diffs;
    const { data, error } = await admin.from("songs").update(patch).eq("id", body.id).select("id");
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: "Esa canción ya no existe" }, 404);
    if (body.resetScores === true) {
      const { error: e2 } = await admin.from("scores").delete().eq("song_id", body.id);
      if (e2) return json({ error: e2.message }, 500);
    }
    return json({ ok: true });
  }

  // removes a song: its files and its row (its scores go with it, ON DELETE CASCADE)
  if (body.action === "delete") {
    if (!validId(body.id)) return json({ error: "Datos inválidos" }, 400);
    const client = r2();
    await Promise.all([...FILES].map((f) => client.fetch(r2Url(`${body.id}/${f}`), { method: "DELETE" }).catch(() => null)));
    await admin.storage.from("songs").remove([...FILES].map((f) => `${body.id}/${f}`)); // leftovers from before R2
    const { error } = await admin.from("songs").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // the whole library, secret songs included (the public library can't see them)
  if (body.action === "list") {
    const { data, error } = await admin.from("songs").select("id, name, artist, charter, hidden, secret_group, miau, has_guitar, audio_offset_ms").order("artist").order("name");
    if (error) return json({ error: error.message }, 500);
    return json({ songs: data });
  }

  // a song goes to a code's group (group: its id), or comes back to the library (group: null)
  if (body.action === "hide") {
    if (!validId(body.id)) return json({ error: "Datos inválidos" }, 400);
    // browsers from before the groups send hidden: true / false (the first code's group)
    const group = Number.isInteger(body.group) ? body.group : body.group === null ? null : body.hidden === true ? 1 : body.hidden === false ? null : undefined;
    if (group === undefined) return json({ error: "Datos inválidos" }, 400);
    const { data, error } = await admin.from("songs").update({ hidden: group !== null, secret_group: group }).eq("id", body.id).select("id");
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: "Esa canción ya no existe" }, 404);
    return json({ ok: true });
  }

  // the players' song requests and the notices with their answers (inbox.sql)
  if (body.action === "inbox") {
    const { data, error } = await admin.rpc("admin_inbox");
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }
  // the players' names, to pick who gets a notice
  if (body.action === "players") {
    const { data, error } = await admin.from("accounts").select("name").order("created_at", { ascending: false }).limit(2000);
    if (error) return json({ error: error.message }, 500);
    return json({ names: (data || []).map((a: { name: string }) => a.name) });
  }
  // a notice for everyone, or for the players named → { id, missing: [names nobody has] }
  if (body.action === "notice") {
    const text = typeof body.body === "string" ? body.body.trim() : "";
    const names = Array.isArray(body.names) ? body.names.filter((n: unknown) => typeof n === "string" && n.trim()).map((n: string) => n.trim().slice(0, 16)).slice(0, 500) : [];
    if (!text || text.length > 1000) return json({ error: "Escribe el aviso (máximo 1000 letras)" }, 400);
    if (!body.all && !names.length) return json({ error: "Elige a quién le llega" }, 400);
    const { data, error } = await admin.rpc("notice_create", { p_body: text, p_all: !!body.all, p_names: names });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }
  // a notice stops showing (the ones who saw it, saw it)
  if (body.action === "notice_off") {
    if (!Number.isInteger(body.id)) return json({ error: "Datos inválidos" }, 400);
    const { error } = await admin.from("notices").update({ active: false }).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  // a request marked as done (or not), or gone. Done with a song of the library (song_id): its player gets
  // "¡Ya está tu canción!" the next time they open the game (inbox.sql my_fulfilled)
  if (body.action === "request_done") {
    if (!Number.isInteger(body.id) || typeof body.done !== "boolean") return json({ error: "Datos inválidos" }, 400);
    if (body.song_id != null && !validId(body.song_id)) return json({ error: "Datos inválidos" }, 400);
    const patch = { done: body.done, song_id: body.done && body.song_id ? body.song_id : null, announced: false };
    const { error } = await admin.from("song_requests").update(patch).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  if (body.action === "request_delete") {
    if (!Number.isInteger(body.id)) return json({ error: "Datos inválidos" }, 400);
    const { error } = await admin.from("song_requests").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // the comments wall (comments.sql): all of them, an answer (or none: null), hidden or shown, gone
  if (body.action === "comments") {
    const { data, error } = await admin.rpc("admin_comments");
    if (error) return json({ error: error.message }, 500);
    return json({ comments: data || [] });
  }
  if (body.action === "comment_reply") {
    const text = typeof body.reply === "string" ? body.reply.trim() : "";
    if (!Number.isInteger(body.id) || text.length > 1000) return json({ error: "Datos inválidos" }, 400);
    const patch = text ? { reply: text, replied_at: new Date().toISOString(), reply_seen: false } : { reply: null, replied_at: null, reply_seen: false };
    const { error } = await admin.from("comments").update(patch).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  if (body.action === "comment_hide") {
    if (!Number.isInteger(body.id) || typeof body.hidden !== "boolean") return json({ error: "Datos inválidos" }, 400);
    const { error } = await admin.from("comments").update({ hidden: body.hidden }).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  if (body.action === "comment_delete") {
    if (!Number.isInteger(body.id)) return json({ error: "Datos inválidos" }, 400);
    const { error } = await admin.from("comments").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // the song files that were in Supabase Storage before R2: each one deleted only once R2 answers that it has it.
  // A call works for at most ~100 s (the function's limit is 150); the panel calls again while it deletes something.
  if (body.action === "storage_cleanup") {
    const bucket = admin.storage.from("songs"), client = r2(), started = Date.now();
    const { data: dirs, error } = await bucket.list("", { limit: 1000 });
    if (error) return json({ error: error.message }, 500);
    const folders = (dirs || []).filter((d) => !d.id).map((d) => d.name);
    let deleted = 0, done = true;
    const kept: string[] = [];
    for (const f of folders) {
      if (Date.now() - started > 100000) { done = false; break; }
      const { data: files } = await bucket.list(f, { limit: 100 });
      const ok: string[] = [];
      for (const x of (files || []).filter((x) => x.id)) {
        const p = `${f}/${x.name}`;
        const r = await client.fetch(r2Url(p), { method: "HEAD" }).catch(() => null);
        if (r?.ok) ok.push(p); else kept.push(p);
      }
      if (ok.length) { const { error: e } = await bucket.remove(ok); if (!e) deleted += ok.length; }
    }
    return json({ deleted, kept, done, folders: folders.length });
  }

  // the secret codes (secret_groups.sql): each one opens its own songs. A code is stored as the sha-256 of its
  // lowercased text, like the database checks it, so the panel never sees the codes again (only their names)
  if (body.action === "groups") {
    const { data, error } = await admin.from("secret_groups").select("id, name").order("id");
    if (error) return json({ error: error.message }, 500);
    return json({ groups: data });
  }
  // a new code (no id: name and secret), or a code renamed and/or changed (id, and name and/or secret)
  if (body.action === "group_save" || body.action === "secret") {
    const id = body.action === "secret" ? 1 : body.id; // "secret": the first code, as panels from before the groups change it
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const secret = typeof body.secret === "string" ? body.secret.trim().toLowerCase() : "";
    if (name && name.length > 30) return json({ error: "El nombre puede tener hasta 30 letras" }, 400);
    if (secret && (secret.length < 3 || secret.length > 40)) return json({ error: "El código secreto debe tener entre 3 y 40 caracteres" }, 400);
    const patch: Record<string, unknown> = {};
    if (name) patch.name = name;
    if (secret) patch.code_hash = await sha256(secret);
    if (id == null) {
      if (!name || !secret) return json({ error: "Escribe el nombre y el código" }, 400);
    } else if (!Number.isInteger(id) || !Object.keys(patch).length) return json({ error: "Datos inválidos" }, 400);
    const q = id == null ? admin.from("secret_groups").insert(patch) : admin.from("secret_groups").update(patch).eq("id", id);
    const { data, error } = await q.select("id, name");
    if (error) return json({ error: error.code === "23505" ? "Ese código ya lo usa otro grupo" : error.message }, error.code === "23505" ? 409 : 500);
    if (!data?.length) return json({ error: "Ese código ya no existe" }, 404);
    if (id === 1 && secret) await admin.from("secret_config").upsert({ id: 1, code_hash: patch.code_hash, updated_at: new Date().toISOString() });
    return json({ group: data[0] });
  }
  // a code goes away: only an empty one (its songs first go elsewhere)
  if (body.action === "group_delete") {
    if (!Number.isInteger(body.id)) return json({ error: "Datos inválidos" }, 400);
    const { count } = await admin.from("songs").select("id", { count: "exact", head: true }).eq("secret_group", body.id);
    if (count) return json({ error: "Ese código todavía tiene canciones: pásalas a otro o a la biblioteca primero" }, 409);
    const { error } = await admin.from("secret_groups").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
});
