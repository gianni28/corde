// Corde — the tour: six venues, from a friend's garage to a stadium. Pure logic, no DOM.
// (of: how Spanish says "the encore of …"; short: the name on the in-game tag on a phone)
// Each difficulty has its own tour, built from the online library: songs sorted by how busy their chart is
// (notes per second on that difficulty) and spread over the venues, easiest first. Each venue plays a setlist of
// four songs; clear three and the crowd calls for an encore (the hardest song of the venue); clear the encore and
// the next venue opens. A song counts as cleared with any finished run (failing on the rock meter doesn't count),
// and its stars are your best on that difficulty, so quick play and the tour share progress.

export const VENUES = [
  { id: "garage", stage: "garage", name: "El garaje", of: "del garaje", blurb: "Donde empezó todo: tus amigos, un par de vecinos y el perro." },
  { id: "bar", stage: "bar", name: "Bar La Cueva", of: "del Bar La Cueva", blurb: "El primer toque pagado: humo, cerveza tibia y un público que no perdona." },
  { id: "university", stage: "university", name: "Festival universitario", short: "Fest. universitario", of: "del Festival universitario", blurb: "Una carpa llena de estudiantes que vinieron a saltar." },
  { id: "theater", stage: "theater", name: "El Gran Teatro", of: "del Gran Teatro", blurb: "Telón rojo, butacas llenas y un sonido impecable." },
  { id: "festival", stage: "festival", name: "Festival Noches de Rock", short: "Noches de Rock", of: "del Festival Noches de Rock", blurb: "Al aire libre, de noche, frente a miles de personas." },
  { id: "stadium", stage: "stadium", name: "El Estadio", of: "del estadio", in: "el estadio", blurb: "La última parada: cincuenta mil voces cantando contigo." },
];
export const SETLIST = 4;      // songs before the encore
export const TO_ENCORE = 3;    // cleared songs that make the crowd ask for one more
const PER_VENUE = SETLIST + 1; // setlist + encore
const AUTO = "Corde (automático)";
const KEY = "corde.tour.v1";

// How hard a song is on a difficulty, from the library row alone (no download): notes per second
const rating = (s, diff) => (s.diffs?.[diff]?.n || 0) / Math.max(30, (s.duration_ms || 180000) / 1000);
const playable = (s, diff) => (s.diffs?.[diff]?.n || 0) > 0;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } }
function store(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {} }

/**
 * The tour for one difficulty: { venues: [{ ...VENUE, songs: [5 library rows, the last one is the encore] }] }.
 * The setlists are saved the first time, so new uploads don't reshuffle a tour in progress; a song that left the
 * library is replaced by the unused song closest in difficulty, and setlists grow (before the encore) when the
 * library gets big enough for longer ones. Returns null when the library is too small.
 */
export function tourFor(diff, library) {
  const pool = library.filter((s) => playable(s, diff));
  // charted songs first; auto-generated ones only when there aren't enough
  const charted = pool.filter((s) => s.charter !== AUTO);
  const source = charted.length >= VENUES.length * 3 ? charted : pool;
  if (source.length < VENUES.length * 2) return null;
  const per = Math.min(PER_VENUE, Math.floor(source.length / VENUES.length));
  const byId = new Map(pool.map((s) => [s.id, s]));
  const sorted = [...source].sort((a, b) => rating(a, diff) - rating(b, diff) || a.id.localeCompare(b.id));

  const all = load();
  let saved = all[diff]?.venues;
  if (!Array.isArray(saved) || saved.length !== VENUES.length || saved.some((v) => !Array.isArray(v) || v.length < 2 || v.length > PER_VENUE)) saved = null;
  let ids;
  // where song si of venue vi would sit in the difficulty ranking
  const at = (vi, si, len) => Math.round(((vi * len + si) / Math.max(1, VENUES.length * len - 1)) * (sorted.length - 1));
  if (saved) {
    // keep the saved setlists even if the library grew or changed (a tour in progress is never reshuffled):
    // swap out songs that are gone, and when there's now room for longer setlists add songs before each encore
    const used = new Set(saved.flat().filter((id) => byId.has(id)));
    ids = saved.map((v, vi) => {
      const list = v.map((id, si) => {
        if (byId.has(id)) return id;
        const repl = nearestUnused(sorted, at(vi, si, v.length), used);
        used.add(repl.id);
        return repl.id;
      });
      while (list.length < per) {
        const add = nearestUnused(sorted, at(vi, list.length - 1, per), used);
        if (used.has(add.id)) break; // nothing left to add
        used.add(add.id);
        list.splice(list.length - 1, 0, add.id);
      }
      return list;
    });
  } else {
    // spread the whole difficulty range over the tour, then keep each venue's hardest song for the encore
    const used = new Set(), picks = [];
    const n = VENUES.length * per;
    for (let k = 0; k < n; k++) {
      const s = nearestUnused(sorted, Math.round((k / Math.max(1, n - 1)) * (sorted.length - 1)), used);
      used.add(s.id); picks.push(s);
    }
    ids = VENUES.map((_, vi) => spreadArtists(picks.slice(vi * per, vi * per + per).sort((a, b) => rating(a, diff) - rating(b, diff))).map((s) => s.id));
  }
  if (JSON.stringify(ids) !== JSON.stringify(all[diff]?.venues)) { all[diff] = { venues: ids }; store(all); }
  return { diff, venues: VENUES.map((v, vi) => ({ ...v, index: vi, songs: ids[vi].map((id) => byId.get(id)) })) };
}

function nearestUnused(sorted, at, used) {
  for (let d = 0; d < sorted.length; d++) {
    for (const i of [at + d, at - d]) if (i >= 0 && i < sorted.length && !used.has(sorted[i].id)) return sorted[i];
  }
  return sorted[at];
}
// the same band twice in a row in one setlist is dull: move the second one later when possible (the encore stays last)
function spreadArtists(songs) {
  const out = [...songs];
  for (let i = 1; i < out.length - 1; i++) {
    if ((out[i].artist || "") !== (out[i - 1].artist || "")) continue;
    const j = out.findIndex((s, k) => k > i && k < out.length - 1 && (s.artist || "") !== (out[i - 1].artist || ""));
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Where the player is: for each venue, which songs are cleared, the stars, whether the encore is open and
 * whether the venue is open/complete. best(songId, diff) → { stars } | null (the personal bests).
 */
export function progress(tour, best) {
  let open = true, stars = 0, maxStars = 0, current = 0;
  const venues = tour.venues.map((v, vi) => {
    const songs = v.songs.map((s) => { const b = s && best(s.id, tour.diff); return { song: s, cleared: !!b, stars: b ? b.stars : 0 }; });
    const set = songs.slice(0, -1), encore = songs[songs.length - 1];
    const clearedSet = set.filter((x) => x.cleared).length;
    const encoreOpen = open && clearedSet >= Math.min(TO_ENCORE, set.length);
    const complete = open && encore.cleared && encoreOpen;
    const vs = songs.reduce((a, x) => a + x.stars, 0);
    stars += vs; maxStars += songs.length * 5;
    const r = { venue: v, open, songs, set, encore, clearedSet, encoreOpen, complete, stars: vs, maxStars: songs.length * 5 };
    if (open) current = vi;
    open = complete;
    return r;
  });
  const done = venues.every((v) => v.complete);
  return { venues, stars, maxStars, current, done };
}

/** What changed between two progress snapshots (for the celebration after a song). */
export function changes(before, after) {
  const out = [];
  after.venues.forEach((v, i) => {
    const b = before.venues[i];
    if (v.encoreOpen && !b.encoreOpen && !v.encore.cleared) out.push({ kind: "encore", venue: v.venue });
    if (v.complete && !b.complete) out.push({ kind: i === after.venues.length - 1 ? "legend" : "venue", venue: v.venue, next: after.venues[i + 1]?.venue });
  });
  return out;
}

/** The next song to play in the tour: the encore as soon as the crowd asks for it, else the first uncleared song. */
export function nextSong(prog) {
  const v = prog.venues[prog.current];
  if (!v) return null;
  const pick = (v.encoreOpen && !v.encore.cleared ? v.encore : null) || v.set.find((x) => !x.cleared);
  if (pick) return { venue: v.venue, song: pick.song, encore: pick === v.encore };
  return null;
}
