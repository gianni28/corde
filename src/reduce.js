// Builds easier difficulties out of a harder chart (many community charts only have Expert,
// and some copy Expert into every level). Pure module: chart v1 in, notes out.
//
// 1. group the notes into events (a chord is one event) and score each one by where it falls in the
//    bar (downbeats > beats > 8ths > 16ths), whether it's a chord, a long note or the start of a phrase
// 2. keep the best events up to the level's share, never closer together than the level allows
// 3. squeeze the frets into the level's lanes phrase by phrase, so the shape of each riff survives

const LEVELS = {
  hard: { lanes: 5, ratio: 0.78, gap: 0.12, maxNps: 3.6, chord: 2 },
  medium: { lanes: 4, ratio: 0.55, gap: 0.19, maxNps: 2.5, chord: 2 },
  easy: { lanes: 3, ratio: 0.38, gap: 0.33, maxNps: 1.7, chord: 1 },
};
const r3 = (x) => Math.round(x * 1000) / 1000;

function events(notes) {
  const map = new Map();
  for (const [t, lane, dur] of notes) {
    const k = Math.round(t * 1000);
    if (!map.has(k)) map.set(k, { t, lanes: [], dur: 0 });
    const e = map.get(k);
    if (!e.lanes.includes(lane)) e.lanes.push(lane);
    e.dur = Math.max(e.dur, dur || 0);
  }
  return [...map.values()].sort((a, b) => a.t - b.t).map((e) => ({ ...e, lanes: e.lanes.sort((a, b) => a - b) }));
}

function metricWeight(t, beats) {
  if (!beats || beats.length < 2) return 0.5;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m][0] <= t) lo = m; else hi = m - 1; }
  const a = beats[lo], b = beats[lo + 1] || [a[0] + (a[0] - (beats[lo - 1] || [a[0] - 0.5])[0]), 0];
  const len = Math.max(0.05, b[0] - a[0]), frac = (t - a[0]) / len;
  const near = (x) => Math.abs(frac - x) * len < 0.035;
  if (near(0)) return a[1] ? 1.3 : 1;
  if (near(1)) return b[1] ? 1.3 : 1;
  if (near(0.5)) return 0.6;
  if (near(0.25) || near(0.75)) return 0.3;
  return 0.2;
}

function pick(evs, beats, lv, seconds, share) {
  const scored = evs.map((e, i) => {
    const prevGap = i ? e.t - evs[i - 1].t : 9;
    return { e, i, s: metricWeight(e.t, beats) + (e.lanes.length > 1 ? 0.3 : 0) + (e.dur > 0.3 ? 0.4 : 0) + (prevGap >= 1 ? 0.5 : 0) };
  });
  const target = Math.min(Math.round(evs.length * share), Math.round(lv.maxNps * seconds));
  const order = [...scored].sort((a, b) => b.s - a.s || a.i - b.i);
  const taken = [], keep = new Set();
  for (const c of order) {
    if (keep.size >= target) break;
    const t = c.e.t;
    let lo = 0, hi = taken.length; while (lo < hi) { const m = (lo + hi) >> 1; if (taken[m] < t) lo = m + 1; else hi = m; }
    if ((lo < taken.length && taken[lo] - t < lv.gap) || (lo > 0 && t - taken[lo - 1] < lv.gap)) continue;
    taken.splice(lo, 0, t); keep.add(c.i);
  }
  return evs.filter((_, i) => keep.has(i));
}

// fit each phrase's frets into n lanes, keeping its ups and downs
function squeeze(evs, n) {
  if (n >= 5) return evs;
  const out = [];
  let start = 0;
  for (let i = 1; i <= evs.length; i++) {
    if (i < evs.length && evs[i].t - evs[i - 1].t < 0.8) continue;
    const ph = evs.slice(start, i);
    let mn = 9, mx = -1; for (const e of ph) for (const l of e.lanes) { if (l < mn) mn = l; if (l > mx) mx = l; }
    const span = mx - mn;
    const map = (l) => (span <= n - 1 ? l - mn + Math.max(0, Math.min(mn, n - 1 - span)) : Math.round(((l - mn) / span) * (n - 1)));
    for (const e of ph) out.push({ ...e, lanes: [...new Set(e.lanes.map(map))].sort((a, b) => a - b) });
    start = i;
  }
  return out;
}

function toNotes(evs, lv) {
  const notes = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i], next = evs[i + 1];
    let dur = e.dur;
    if (next) dur = Math.min(dur, next.t - e.t - 0.1);
    if (dur < 0.15) dur = 0;
    let lanes = e.lanes;
    if (lanes.length > lv.chord) lanes = lv.chord === 1 ? [lanes[0]] : [lanes[0], lanes[lanes.length - 1]];
    for (const l of lanes) notes.push([r3(e.t), l, r3(dur)]);
  }
  return notes;
}

const ORDER = ["easy", "medium", "hard", "expert"];
const sig = (n) => n.length + ":" + n.map((x) => x[0] + "/" + x[1]).join(",");

/**
 * Fills the difficulties a chart is missing (or that are just copies of a harder one) by reducing the
 * nearest harder level. Returns the list of levels it made; the chart is changed in place.
 */
export function fillDifficulties(chart) {
  const made = [];
  const notesOf = (d) => chart.diffs[d]?.notes || [];
  const seconds = (() => { let a = Infinity, b = 0; for (const d of ORDER) for (const x of notesOf(d)) { a = Math.min(a, x[0]); b = Math.max(b, x[0]); } return Math.max(1, b - a); })();
  for (let k = ORDER.length - 2; k >= 0; k--) {
    const d = ORDER[k];
    const src = ORDER.slice(k + 1).find((h) => notesOf(h).length);
    if (!src) continue;
    const own = notesOf(d);
    const copy = own.length && ORDER.slice(k + 1).some((h) => notesOf(h).length && sig(notesOf(h)) === sig(own));
    if (own.length && !copy) continue;
    const lv = LEVELS[d];
    const share = Math.min(1, lv.ratio / (LEVELS[src]?.ratio ?? 1)); // the ratios are shares of Expert
    const evs = squeeze(pick(events(notesOf(src)), chart.beats, lv, seconds, share), lv.lanes);
    const notes = toNotes(evs, lv).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    chart.diffs[d] = { lanes: [...new Set(notes.map((n) => n[1]))].sort((a, b) => a - b), notes };
    made.push(d);
  }
  return made;
}
