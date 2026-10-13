// Corde — one-time move of the song files from Supabase Storage to Cloudflare R2 (free downloads, 10 GB free).
// Called from the database (pg_net) with a token kept in r2_config, a few files per call; every copy is checked
// (same size in R2) and written to r2_migration, so the move can be watched and resumed, and nothing is deleted here.
//   { token, action: "check" }            → which R2 settings exist (never their values)
//   { token, action: "cors" }             → lets browsers read the bucket (and the admin panel upload to it)
//   { token, action: "copy", paths: [] }  → copies those files (songs/<id>/<file>)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import { createHash } from "node:crypto";

const env = (k: string) => Deno.env.get(k) || "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TYPES: Record<string, string> = { mp3: "audio/mpeg", json: "application/json", jpg: "image/jpeg" };
// audio and covers never change under the same name+version; the chart is always fetched fresh
const cacheFor = (p: string) => (p.endsWith(".json") ? "no-cache" : "public, max-age=31536000");

Deno.serve(async (req) => {
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "body" }, 400); }
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: cfg } = await db.from("r2_config").select("value").eq("key", "migrate_token").maybeSingle();
  if (!cfg?.value || b.token !== cfg.value) return json({ error: "token" }, 401);

  if (b.action === "check") {
    return json({ R2_ACCOUNT_ID: !!env("R2_ACCOUNT_ID"), R2_ACCESS_KEY_ID: !!env("R2_ACCESS_KEY_ID"), R2_SECRET_ACCESS_KEY: !!env("R2_SECRET_ACCESS_KEY"), R2_BUCKET: env("R2_BUCKET") || null });
  }
  const r2 = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
  const base = `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}`;

  if (b.action === "cors") {
    const xml = `<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
    const md5 = createHash("md5").update(xml).digest("base64");
    const r = await r2.fetch(`${base}?cors`, { method: "PUT", body: xml, headers: { "Content-Type": "application/xml", "Content-MD5": md5 } });
    const t = await r.text();
    await db.from("r2_migration").upsert({ path: "_cors", ok: r.ok, size: null, err: r.ok ? null : `${r.status} ${t.slice(0, 300)}`, at: new Date().toISOString() });
    return json({ ok: r.ok, status: r.status, body: t.slice(0, 500) });
  }

  if (b.action === "copy" && Array.isArray(b.paths)) {
    const out = [];
    for (const p of b.paths.slice(0, 10)) {
      if (typeof p !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9.]+$/.test(p)) { out.push({ p, ok: false, err: "path" }); continue; }
      let row: Record<string, unknown> = { path: p, ok: false, size: null, err: null, at: new Date().toISOString() };
      try {
        const src = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/public/songs/${p}`);
        if (!src.ok) throw new Error(`origen ${src.status}`);
        const buf = new Uint8Array(await src.arrayBuffer());
        const ext = p.split(".").pop()!;
        const put = await r2.fetch(`${base}/${p}`, { method: "PUT", body: buf, headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cacheFor(p) } });
        if (!put.ok) throw new Error(`R2 ${put.status} ${(await put.text()).slice(0, 200)}`);
        const head = await r2.fetch(`${base}/${p}`, { method: "HEAD" });
        const size = Number(head.headers.get("content-length"));
        if (!head.ok || size !== buf.length) throw new Error(`verificación: ${head.status} ${size} != ${buf.length}`);
        row = { ...row, ok: true, size };
      } catch (e) { row.err = String((e as Error).message || e).slice(0, 300); }
      await db.from("r2_migration").upsert(row);
      out.push(row);
    }
    return json({ results: out });
  }
  return json({ error: "action" }, 400);
});
