// Corde — entrega los archivos de las canciones directo desde el bucket R2 (más estable que el link r2.dev).
// Se pega en un Worker de Cloudflare con un enlace (binding) al bucket llamado BUCKET → corde-songs.
// Solo lectura: GET y HEAD de <id-de-canción>/<archivo>. Nada más.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Método no permitido", { status: 405, headers: CORS });

    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!/^[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9.]+$/.test(key)) return new Response("No encontrado", { status: 404, headers: CORS });

    const obj = request.method === "HEAD"
      ? await env.BUCKET.head(key)
      : await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
    if (!obj) return new Response("No encontrado", { status: 404, headers: CORS });

    const headers = new Headers(CORS);
    obj.writeHttpMetadata(headers); // Content-Type y Cache-Control guardados con cada archivo
    headers.set("ETag", obj.httpEtag);
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=31536000");

    if (request.method === "HEAD") { headers.set("Content-Length", String(obj.size)); return new Response(null, { headers }); }
    if (!("body" in obj)) return new Response(null, { status: 304, headers }); // el navegador ya lo tiene
    if (obj.range && request.headers.has("Range")) {
      const off = obj.range.offset ?? 0, len = obj.range.length ?? obj.size - off;
      headers.set("Content-Range", `bytes ${off}-${off + len - 1}/${obj.size}`);
      return new Response(obj.body, { status: 206, headers });
    }
    return new Response(obj.body, { headers });
  },
};
