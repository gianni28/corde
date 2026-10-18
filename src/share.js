// Result card for Instagram stories (1080×1920): song, score, stars and the game's link.
// Drawn on a canvas with the game's own fonts; shared with the phone's share sheet (Instagram, WhatsApp…)
// or downloaded where sharing files isn't possible (most computers).

const W = 1080, H = 1920;
const ROCK = '"New Rocker", Georgia, serif';
const DISPLAY = '"Oswald", "Arial Narrow", Impact, sans-serif';
const BODY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const STRINGS = ["#1fd14a", "#e8202c", "#f5c518", "#1f6fe0", "#f57a12"];
export const SHARE_URL = "cordegame.netlify.app";

function loadImg(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => res(null);
    // its own address: the library already shows this cover without CORS, and the browser would reuse that
    // copy, which a canvas is not allowed to read (the cover would silently be missing from the card)
    im.src = src + (src.includes("?") ? "&" : "?") + "card=1";
  });
}

// chrome lettering, like the logo and the score in the game
function chrome(ctx, y, size) {
  const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.1);
  g.addColorStop(0, "#ffffff"); g.addColorStop(0.36, "#e4e0da"); g.addColorStop(0.5, "#6e6964");
  g.addColorStop(0.6, "#f4f0ea"); g.addColorStop(1, "#a39d96");
  return g;
}

// shrinks the font until the text fits in maxW
function fit(ctx, text, font, size, maxW) {
  let s = size;
  do { ctx.font = font.replace("{s}", s); } while (ctx.measureText(text).width > maxW && (s -= 2) > 20);
  return s;
}

// the player's name as the shop styled it (same looks as the .nm-* classes on the boards), and their level
const NAME_COLORS = { dorado: "#f5c518", corona: "#f5c518", rosa: "#ff6fbf", cian: "#4fe3ff", verde: "#4cff7a", electrico: "#e9fbff", estrella: "#fff6d0" };
const NAME_GLOW = { dorado: "rgba(245,197,24,.6)", corona: "rgba(245,197,24,.6)", rosa: "rgba(255,79,168,.6)", cian: "rgba(63,220,255,.6)",
  verde: "rgba(60,255,120,.5)", electrico: "#3fa8ff", estrella: "rgba(255,190,60,.8)", plata: "rgba(200,220,240,.45)", festival: "rgba(255,79,216,.5)" };
function drawName(ctx, name, style, level, x, y, maxW) {
  const size = fit(ctx, name, `600 {s}px ${DISPLAY}`, style && style !== "normal" ? 46 : 42, maxW);
  const w = ctx.measureText(name).width, x0 = x - w / 2;
  ctx.save();
  if (style === "fuego" || style === "plata") {
    const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y);
    const stops = style === "fuego" ? ["#ffe066", "#ff8a1a", "#e8201a"] : ["#ffffff", "#c9d3dc", "#7d8a96"];
    stops.forEach((c, i) => g.addColorStop(i / 2, c));
    ctx.fillStyle = g;
  } else if (style === "festival") {
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    ["#ff4fd8", "#ffb020", "#3ff0ff"].forEach((c, i) => g.addColorStop(i / 2, c));
    ctx.fillStyle = g;
  } else if (style === "arcoiris") {
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    ["#ff4a4a", "#ffb020", "#ffe83a", "#4cff7a", "#3ac8ff", "#a45bff", "#ff4fa8"].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = g;
  } else ctx.fillStyle = NAME_COLORS[style] || "#a8998a";
  if (NAME_GLOW[style]) { ctx.shadowColor = NAME_GLOW[style]; ctx.shadowBlur = style === "electrico" ? 22 : 16; }
  ctx.fillText(name, x, y);
  ctx.shadowBlur = 0;
  if (style === "corona") { // the crown before the name
    const cw = size * 0.95, ch = cw * 0.75, cx = x0 - cw - size * 0.2, cy = y - size * 0.72;
    const g = ctx.createLinearGradient(0, cy, 0, cy + ch);
    g.addColorStop(0, "#fff1a0"); g.addColorStop(0.55, "#f5c518"); g.addColorStop(1, "#b8860b");
    ctx.fillStyle = g;
    const P = [[1.5, 17.5], [3.4, 4.8], [8.8, 10.2], [12, 1.5], [15.2, 10.2], [20.6, 4.8], [22.5, 17.5]];
    ctx.beginPath(); P.forEach(([a, b], i) => ctx[i ? "lineTo" : "moveTo"](cx + (a / 24) * cw, cy + (b / 19) * ch)); ctx.closePath(); ctx.fill();
  }
  if (style === "estrella") { ctx.fillStyle = "#ffd23a"; ctx.shadowColor = "#ffb020"; ctx.shadowBlur = 14; ctx.textAlign = "left"; ctx.fillText(" ★", x0 + w, y); }
  ctx.restore();
  if (level > 0) { // a small pill after the name
    ctx.save();
    ctx.font = `700 26px ${DISPLAY}`;
    const t = `NV ${level}`, tw = ctx.measureText(t).width + 22, px = x + w / 2 + (style === "estrella" ? size * 1.3 : size * 0.35);
    const tier = [["#e0a060", "205,127,50"], ["#e6ecf2", "200,212,224"], ["#f5c518", "245,197,24"], ["#e8c8ff", "170,90,255"]][Math.min(3, Math.floor(level / 10))];
    ctx.fillStyle = `rgba(${tier[1]},.18)`; ctx.strokeStyle = `rgba(${tier[1]},.75)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, y - 31, tw, 38, 19) : ctx.rect(px, y - 31, tw, 38); ctx.fill(); ctx.stroke();
    ctx.fillStyle = tier[0]; ctx.textAlign = "left"; ctx.fillText(t, px + 11, y - 3);
    ctx.restore();
  }
}

/**
 * r: { song, artist, diff, lanes, score, stars, acc, maxCombo, hits, total, player, record, cover, nameStyle, level }
 * Returns a PNG Blob.
 */
export async function drawCard(r) {
  await document.fonts?.ready;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // stage: dark, with fire coming up from the bottom and a red light from the top
  ctx.fillStyle = "#0a0605"; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, H + 120, 60, W / 2, H + 120, 1100);
  g.addColorStop(0, "rgba(255,122,26,.55)"); g.addColorStop(0.35, "rgba(196,22,28,.35)"); g.addColorStop(1, "rgba(10,6,5,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W / 2, -200, 40, W / 2, -200, 900);
  g.addColorStop(0, "rgba(196,22,28,.35)"); g.addColorStop(1, "rgba(10,6,5,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // the five strings, running into the distance from the bottom edge
  ctx.save();
  ctx.globalAlpha = 0.55; ctx.lineCap = "round";
  STRINGS.forEach((c, i) => {
    const xb = W / 2 + (i - 2) * 250, xt = W / 2 + (i - 2) * 60;
    ctx.strokeStyle = c; ctx.lineWidth = 7; ctx.shadowColor = c; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.moveTo(xb, H + 20); ctx.lineTo(xt, 1080); ctx.stroke();
  });
  ctx.restore();
  g = ctx.createLinearGradient(0, 1060, 0, 1560);
  g.addColorStop(0, "rgba(10,6,5,1)"); g.addColorStop(1, "rgba(10,6,5,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 1060, W, 500);

  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  // Instagram covers the top ~250 px and the bottom ~300 px of a story: everything that matters stays in between

  // logo
  ctx.save();
  ctx.font = `400 150px ${ROCK}`;
  ctx.shadowColor = "rgba(255,90,20,.7)"; ctx.shadowBlur = 40;
  ctx.fillStyle = "#4a0c07"; ctx.fillText("Corde", W / 2, 336);
  ctx.shadowBlur = 0; ctx.fillStyle = chrome(ctx, 330, 150); ctx.fillText("Corde", W / 2, 330);
  ctx.lineWidth = 2; ctx.strokeStyle = "#1b0c07"; ctx.strokeText("Corde", W / 2, 330);
  ctx.restore();

  // cover in a steel frame (or the five strings when the song has none)
  const cs = 400, cx = (W - cs) / 2, cy = 384;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#131010"; ctx.fillRect(cx - 12, cy - 12, cs + 24, cs + 24);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,230,200,.25)"; ctx.lineWidth = 2; ctx.strokeRect(cx - 11, cy - 11, cs + 22, cs + 22);
  const img = await loadImg(r.cover);
  if (img) ctx.drawImage(img, cx, cy, cs, cs);
  else {
    ctx.fillStyle = "#1a1210"; ctx.fillRect(cx, cy, cs, cs);
    STRINGS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(cx + 50, cy + 100 + i * 60, cs - 100, 9); });
  }

  // new record: a sticker on the corner of the cover
  if (r.record) {
    ctx.save();
    ctx.translate(cx + cs - 10, cy + 20); ctx.rotate(0.14);
    ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#f5c518"; ctx.fillRect(-150, -42, 300, 78);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#1b0c07"; ctx.font = `700 40px ${DISPLAY}`; ctx.fillText("¡NUEVO RÉCORD!", 0, 12);
    ctx.restore();
  }

  // song
  const song = (r.song || "").toUpperCase();
  fit(ctx, song, `700 {s}px ${DISPLAY}`, 80, W - 140);
  ctx.fillStyle = "#f2e8d8"; ctx.fillText(song, W / 2, 880);
  fit(ctx, r.artist || "", `500 {s}px ${BODY}`, 48, W - 160);
  ctx.fillStyle = "#a8998a"; ctx.fillText(r.artist || "", W / 2, 936);

  // difficulty banner
  const tag = `${(r.diff || "").toUpperCase()} · ${r.lanes} CUERDAS`;
  ctx.font = `600 36px ${DISPLAY}`;
  const tw = ctx.measureText(tag).width + 70;
  g = ctx.createLinearGradient(W / 2 - tw / 2, 0, W / 2 + tw / 2, 0);
  g.addColorStop(0, "#7a0606"); g.addColorStop(0.5, "#c4161c"); g.addColorStop(1, "#7a0606");
  ctx.fillStyle = g; ctx.fillRect(W / 2 - tw / 2, 968, tw, 60);
  ctx.fillStyle = "#f2e8d8"; ctx.fillText(tag, W / 2, 1011);

  // player + score
  if (r.player) drawName(ctx, r.player.toUpperCase(), r.nameStyle, r.level, W / 2, 1100, W - 260);
  const score = Math.round(r.score).toLocaleString("es-CO");
  const ss = fit(ctx, score, `700 {s}px ${DISPLAY}`, 170, W - 140);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowOffsetY = 8; ctx.shadowBlur = 0;
  ctx.fillStyle = chrome(ctx, 1252, ss); ctx.fillText(score, W / 2, 1252);
  ctx.restore();

  // stars
  ctx.font = `400 84px ${BODY}`;
  const stars = Math.max(0, Math.min(5, r.stars | 0));
  const sw = 96, sx = W / 2 - sw * 2;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.fillStyle = i < stars ? "#f5c518" : "rgba(245,197,24,.18)";
    if (i < stars) { ctx.shadowColor = "rgba(245,197,24,.6)"; ctx.shadowBlur = 24; }
    ctx.fillText("★", sx + i * sw, 1350);
    ctx.restore();
  }

  // stats, on a dark plate so the strings behind don't get in the way
  ctx.save();
  ctx.fillStyle = "rgba(10,6,5,.82)"; ctx.fillRect(110, 1386, W - 220, 130);
  ctx.strokeStyle = "rgba(255,230,200,.13)"; ctx.lineWidth = 2; ctx.strokeRect(110, 1386, W - 220, 130);
  ctx.restore();
  const stats = [["PRECISIÓN", Math.round((r.acc || 0) * 100) + "%"], ["MEJOR RACHA", String(r.maxCombo || 0)], ["NOTAS", `${r.hits || 0}/${r.total || 0}`]];
  stats.forEach(([label, val], i) => {
    const x = W / 2 + (i - 1) * 290;
    ctx.fillStyle = "#a8998a"; ctx.font = `600 28px ${BODY}`; ctx.fillText(label, x, 1430);
    ctx.fillStyle = "#f2e8d8"; ctx.font = `700 56px ${DISPLAY}`; ctx.fillText(val, x, 1494);
  });

  // where to play
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 20;
  ctx.fillStyle = "#f2e8d8"; ctx.font = `600 44px ${BODY}`; ctx.fillText(SHARE_URL, W / 2, 1620);
  ctx.restore();

  return new Promise((res) => cv.toBlob(res, "image/png"));
}

/** Opens the phone's share sheet with the card; on computers it downloads the image instead. */
// The challenge link: opens the game straight on this song and difficulty, with the score to beat.
export function retoUrl({ songId, diff, score, name }) {
  const q = new URLSearchParams({ reto: songId, dif: diff, pts: String(Math.round(score)), de: name || "" });
  return `${location.origin}/?${q}`;
}
/** Reads a challenge from the address (null when there is none or it looks wrong). */
export function readReto(search = location.search) {
  const q = new URLSearchParams(search);
  const songId = q.get("reto"), diff = q.get("dif"), score = Math.round(Number(q.get("pts")));
  if (!songId || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(songId) || !["easy", "medium", "hard", "expert"].includes(diff) || !(score > 0)) return null;
  return { songId, diff, score, name: (q.get("de") || "").trim().slice(0, 16) };
}

/** Opens the phone's share sheet with the card (and the challenge text, which WhatsApp keeps); on computers it downloads the image. */
export async function shareCard(r, text = "") {
  const blob = await drawCard(r);
  const file = new File([blob], `corde-${(r.song || "resultado").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share(text ? { files: [file], text } : { files: [file] }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}
