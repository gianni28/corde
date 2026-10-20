// Logros: medallas por cosas que pasan jugando. Se guardan en este navegador y viajan con la cuenta
// (account_sync los junta entre dispositivos), así que un logro ganado en el celular aparece en el PC.
// Cada uno se gana una vez; la fecha es la del primer dispositivo que lo ganó.

const KEY = "corde.achievements.v1";

// bananas for each of the Otaku event's gifts (in order: the Tití notes, Nero, the antimagic flames)
export const BANANA_GIFTS = [30, 60, 90];
export const BANANA_LOGROS = ["otaku-titi", "otaku-nero", "otaku-antimagia"];
/** The Otaku gifts these bananas reach. */
export const forBananas = (n) => BANANA_LOGROS.filter((_, i) => n >= BANANA_GIFTS[i]);
// the bands' events (their songs in a secret group, told apart by the artist): 4 stars or more on each of the band's
// songs, on Media or harder (the caller counts only those runs), once all of them are up. The gift: the band as pets
export const BAND_STARS = 4, BAND_DIFF = "medium";
export const BANDS = [
  { id: "one-direction", name: "One Direction", badge: "1D", artist: /one\s*direction/i, songs: 6 },
  { id: "bts", name: "BTS", badge: "BTS", artist: /\bbts\b|bangtan|방탄/i, songs: 6 },
];
export const forBand = (band, ids, stars) => (ids.length >= band.songs && ids.every((id) => stars(id) >= BAND_STARS) ? [band.id] : []);

export const ACHIEVEMENTS = [
  { id: "primer-acorde", name: "Primer acorde", desc: "Termina tu primera canción." },
  { id: "repertorio", name: "Repertorio", desc: "Termina 10 canciones distintas." },
  { id: "setlist", name: "Setlist de lujo", desc: "Termina 25 canciones distintas." },
  { id: "enciclopedia", name: "Enciclopedia del rock", desc: "Termina 50 canciones distintas." },
  { id: "cinco-estrellas", name: "Cinco estrellas", desc: "Saca 5 estrellas en una canción." },
  { id: "sin-fallar", name: "Sin fallar", desc: "Termina una canción sin fallar ni una nota." },
  { id: "racha-100", name: "Racha de 100", desc: "Encadena 100 notas sin fallar." },
  { id: "racha-500", name: "Racha de 500", desc: "Encadena 500 notas sin fallar." },
  { id: "dificil", name: "Subiendo el volumen", desc: "Termina una canción en Difícil." },
  { id: "experto", name: "Experto", desc: "Termina una canción en Experto." },
  { id: "virtuoso", name: "Virtuoso", desc: "Saca 5 estrellas en Experto." },
  { id: "estrella-rock", name: "Estrella de rock", desc: "Usa el poder estrella 3 veces en una misma canción." },
  { id: "dia-3", name: "Fiel al rock", desc: "Toca la canción del día 3 días seguidos." },
  { id: "dia-7", name: "Una semana de rock", desc: "Toca la canción del día 7 días seguidos." },
  { id: "dia-14", name: "Dos semanas de rock", desc: "Toca la canción del día 14 días seguidos." },
  { id: "dia-30", name: "Un mes de rock", desc: "Toca la canción del día 30 días seguidos." },
  { id: "de-gira", name: "De gira", desc: "Supera tu primer escenario de la gira." },
  { id: "leyenda", name: "Leyenda del rock", desc: "Termina la gira." },
  { id: "en-banda", name: "En banda", desc: "Juega una partida multijugador." },
  { id: "reto-aceptado", name: "Reto aceptado", desc: "Gánale a alguien en un reto." },
  { id: "al-escenario", name: "Al escenario", desc: "Comparte un resultado." },
  // the tour's prizes (tour.js TOUR_PRIZES): shown on the tour screen, not in this list
  ...[["easy", "Fácil"], ["medium", "Media"], ["hard", "Difícil"], ["expert", "Experto"]].flatMap(([d, dn]) =>
    [["bar", "Bar La Cueva"], ["theater", "El Gran Teatro"], ["stadium", "El Estadio"]].map(([v, vn]) =>
      ({ id: `gira-${d}-${v}`, name: `Gira ${dn}: ${vn}`, desc: `Supera ${vn} en la gira en ${dn}.`, tour: true }))),
  // secret: only listed for whoever has the songs it asks for (the miau songs, behind a code), or once won
  { id: "coro-gatitos", name: "Coro de gatitos", desc: "Saca 80% o más en 3 canciones miau (o en todas, si hay menos).", secret: true },
  // the Otaku event (its songs behind a code): golden bananas on some notes fill a bar with three surprise gifts.
  // surprise: not listed anywhere (nor their prizes in the shop) until won
  { id: "otaku-titi", name: "Bigotes del Emperador", desc: `Junta ${BANANA_GIFTS[0]} bananas doradas en la Expedición del Emperador.`, secret: true, surprise: true },
  { id: "otaku-nero", name: "El anti-pájaro", desc: `Junta ${BANANA_GIFTS[1]} bananas doradas en la Expedición del Emperador.`, secret: true, surprise: true },
  { id: "otaku-antimagia", name: "Antimagia", desc: `Junta ${BANANA_GIFTS[2]} bananas doradas en la Expedición del Emperador.`, secret: true, surprise: true },
  // the bands' events: a surprise gift (the band as pets) for 4 stars on each of its songs
  { id: "one-direction", name: "Directioner", desc: "Saca 4 estrellas o más en las 6 canciones de One Direction, en Media o más difícil.", secret: true, surprise: true },
  { id: "bts", name: "ARMY", desc: "Saca 4 estrellas o más en las 6 canciones de BTS, en Media o más difícil.", secret: true, surprise: true },
];
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

let got = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(got)); } catch {} };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }); // YYYY-MM-DD

/** { id: "YYYY-MM-DD" } of everything won so far (for the account). */
export const achievementsWon = () => ({ ...got });
export const hasAchievement = (id) => !!got[id];

/** Wins these (if new) and returns the ones that are new, in list order. */
export function unlock(ids) {
  const fresh = [];
  for (const id of ids) if (BY_ID[id] && !got[id]) { got[id] = today(); fresh.push(BY_ID[id]); }
  if (fresh.length) persist();
  return fresh;
}

/** The account's copy (other devices) joined with this one: each kept with its earliest date. */
export function mergeAchievements(remote) {
  if (!remote || typeof remote !== "object") return;
  let changed = false;
  for (const [id, d] of Object.entries(remote)) {
    if (!BY_ID[id] || typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!got[id] || d < got[id]) { got[id] = d; changed = true; }
  }
  if (changed) persist();
}

/**
 * What a finished (not practice) solo run earns.
 * run: { sum, diff, songsDone } — songsDone = distinct songs with a finished run, this one included.
 */
export function forRun({ sum, diff, songsDone }) {
  const ids = [];
  if (sum.maxCombo >= 100) ids.push("racha-100");
  if (sum.maxCombo >= 500) ids.push("racha-500");
  if (sum.starUses >= 3) ids.push("estrella-rock");
  if (sum.failed || !(sum.score > 0)) return ids;
  ids.push("primer-acorde");
  if (songsDone >= 10) ids.push("repertorio");
  if (songsDone >= 25) ids.push("setlist");
  if (songsDone >= 50) ids.push("enciclopedia");
  if (sum.stars >= 5) ids.push("cinco-estrellas");
  if (sum.total > 0 && sum.hits >= sum.total && sum.maxCombo >= sum.total) ids.push("sin-fallar");
  if (diff === "hard" || diff === "expert") ids.push("dificil");
  if (diff === "expert") ids.push("experto");
  if (diff === "expert" && sum.stars >= 5) ids.push("virtuoso");
  return ids;
}

/** The kittens: 80% or more on 3 of the miau songs this player has (all of them when there are fewer). */
export function forMiau(miauIds, bestAcc) {
  const need = Math.min(3, miauIds.length);
  return need && miauIds.filter((id) => bestAcc(id) >= 0.8).length >= need ? ["coro-gatitos"] : [];
}

/** Days in a row of the song of the day. */
export function forStreak(days) {
  const ids = [];
  if (days >= 3) ids.push("dia-3");
  if (days >= 7) ids.push("dia-7");
  if (days >= 14) ids.push("dia-14");
  if (days >= 30) ids.push("dia-30");
  return ids;
}
