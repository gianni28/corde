// Gameplay: timing, hits, sustains, scoring. No rendering or DOM here.
import { notesFor, starPhrasesFor } from "./chart.js";

export const WINDOW = 0.1; // ±100 ms to hit a note
export const PERFECT = 0.045;
export const STAR_READY = 0.5; // star meter needed to activate (half)

export class Game {
  // offsetMs: the player's latency compensation (learned/adjustable). songOffsetMs: how much later the song's audio
  // runs than its chart (MP3 encoder padding, song.ini "delay"); fixed per song.
  // practice: {from, to} plays only that part (chart seconds). canFail: the rock meter can end the song.
  constructor({ chart, diff, lanes, player, offsetMs = 0, songOffsetMs = 0, look = 1.5, autoSync = true, practice = null, canFail = false }) {
    this.chart = chart;
    this.diff = diff;
    this.lanes = lanes;
    this.player = player;
    this.offset = offsetMs / 1000;
    this.songOffset = songOffsetMs / 1000;
    this.autoSync = autoSync;
    this.errs = []; // recent hit errors (s), used to learn the player's latency
    this.lastHit = new Array(5).fill(-9);
    this.look = look;
    // notes past the end of the audio can never be played (a broken chart): drop them
    const audioEnd = player.duration + this.offset - this.songOffset + 0.5;
    this.notes = notesFor(chart, diff, lanes).filter((n) => n.t <= audioEnd).map((n) => ({ ...n, state: 0, holding: false }));
    this.beats = chart.beats;
    this.sections = chart.sections || [];
    this.practice = practice;
    this.canFail = canFail && !practice;
    if (practice) for (const n of this.notes) if (n.t < practice.from - 0.01 || n.t > practice.to) { n.state = 3; n.hide = true; } // 3 = not part of this run

    // star power: phrases of notes; hitting every note of one fills a quarter of the meter
    this.phrases = starPhrasesFor(chart, diff).map(([a, b]) => ({ a, b, notes: [], hit: 0, lost: false, done: false }));
    for (const n of this.notes) {
      if (n.state === 3) continue;
      const k = this.phrases.findIndex((p) => n.t >= p.a && n.t <= p.b);
      if (k >= 0) { n.star = k; this.phrases[k].notes.push(n); }
    }
    this.phrases = this.phrases.filter((p) => p.notes.length);
    this.phrases.forEach((p, k) => p.notes.forEach((n) => (n.star = k)));
    this.starMeter = 0; this.starOn = false; this.starUses = 0;
    // a full meter lasts 32 beats (a half, 16), like the classics
    const bl = (chart.beats || []).slice(1, 200).map((b, i) => b[0] - chart.beats[i][0]).filter((x) => x > 0.15 && x < 1.5).sort((a, b) => a - b);
    this.starDrain = 1 / (32 * (bl[bl.length >> 1] || 0.5));

    // rock meter: up with hits, down with misses (0 = the crowd has had enough)
    this.rock = 0.6; this.failed = false;

    // hits per section, for the results
    this.secStats = this.sections.map(() => ({ total: 0, hit: 0 }));
    if (this.secStats.length) for (const n of this.notes) if (n.state !== 3) { n.sec = Math.max(0, this.section(n.t)); this.secStats[n.sec].total++; }
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.hits = 0; this.perfects = 0; this.missed = 0;
    this.next = 0;
    this.pressed = new Array(lanes).fill(false);
    this.lastT = -99;
    const lastNote = this.notes.length ? this.notes[this.notes.length - 1] : { t: 0, dur: 0 };
    // a chart can't outlast its song by much: end with the audio if the notes run past it
    this.end = Math.min(Math.max(player.duration, lastNote.t + lastNote.dur + 1), player.duration + 3);
    this.events = []; // {type:'hit'|'miss'|'ghost', lane, sustain, err}
    this.ended = false;
    this.countdownUntil = 0;        // show 3-2-1 until this song time (song start)
    this.practiceUntil = -Infinity; // stray presses before this time (lead-in after a pause) are ignored
    this.resumeAt = null;           // after a pause: notes come back at this song time
    // long stretches without notes (≥ 6 s), including a long intro
    this.gaps = [];
    let prevEnd = 0;
    for (const n of this.notes) {
      if (n.t - prevEnd >= 6) this.gaps.push([prevEnd, n.t]);
      prevEnd = Math.max(prevEnd, n.t + n.dur);
    }
  }

  get baseMultiplier() { return Math.min(4, 1 + Math.floor(this.combo / 10)); }
  get multiplier() { return this.baseMultiplier * (this.starOn ? 2 : 1); } // star power doubles it (up to ×8)
  get accuracy() { const judged = this.hits + this.missed; return judged ? this.hits / judged : 1; }

  time() { return this.player.time() + this.offset - this.songOffset; }

  start() {
    if (this.practice) {
      // practice: start a few seconds before the part, with the countdown until its first note
      const from = Math.max(0, this.practice.from - 3);
      this.resumeAt = this.practice.from; this.resumeFromT = from; this.practiceUntil = this.practice.from - 0.2; this.lastT = from;
      this.player.start(0.4, from - this.offset + this.songOffset);
      return;
    }
    const first = this.notes.length ? this.notes[0].t : 0;
    this.player.start(3 + Math.max(0, this.look - first + 0.3));
  }

  /** Star power on, if the meter is at least half full. Returns true when it switched on. */
  activateStar() {
    if (this.starOn || this.starMeter < STAR_READY || this.ended || this.failed) return false;
    this.starOn = true; this.starUses++;
    this.events.push({ type: "starOn" });
    return true;
  }

  /** Practice: the part starts over (its notes come back) a few seconds before `from`. */
  restartPractice() {
    const p = this.practice;
    for (const n of this.notes) if (n.state !== 3) { n.state = 0; n.holding = false; n.hide = false; }
    for (const ph of this.phrases) { ph.hit = 0; ph.lost = false; ph.done = false; ph.notes.forEach((n) => (n.star = this.phrases.indexOf(ph))); }
    this.next = 0;
    this.combo = 0;
    this.resumeAt = p.from;
  }

  rockBy(v) {
    this.rock = Math.max(this.canFail ? 0 : 0.04, Math.min(1, this.rock + v));
    if (this.canFail && this.rock <= 0 && !this.failed) { this.failed = true; this.events.push({ type: "fail" }); }
  }

  press(lane, t) {
    if (lane < 0 || lane >= this.lanes || this.ended) return;
    this.pressed[lane] = true;
    let best = null;
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > t + WINDOW) break;
      if (n.state === 0 && n.lane === lane && Math.abs(n.t - t) <= WINDOW) { best = n; break; }
    }
    if (best) {
      best.state = 1;
      best.holding = best.dur > 0;
      const err = t - best.t;
      this.lastHit[lane] = t;
      this.learn(err);
      this.combo++; this.hits++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (Math.abs(err) <= PERFECT) this.perfects++;
      this.score += 50 * this.multiplier;
      this.player.guitar(true);
      this.rockBy(this.starOn ? 0.03 : 0.02);
      if (best.sec != null) this.secStats[best.sec].hit++;
      if (best.star != null && best.star >= 0) {
        const ph = this.phrases[best.star];
        if (!ph.lost && ++ph.hit === ph.notes.length && !ph.done) {
          ph.done = true;
          this.starMeter = Math.min(1, this.starMeter + 0.25);
          this.events.push({ type: "starPhrase", ready: this.starMeter >= STAR_READY });
        }
      }
      this.events.push({ type: "hit", lane, sustain: best.holding, err, star: best.star != null && best.star >= 0 });
    } else if (t > -0.5 && t >= this.practiceUntil) {
      // Forgive double taps and presses that are just outside the window of a nearby note in this lane.
      const near = t - this.lastHit[lane] < 0.18 || this.notes.some((n, i) => i >= this.next - 4 && i < this.next + 24 && n.lane === lane && Math.abs(n.t - t) < 0.22);
      if (!near) { this.breakCombo(false); this.rockBy(-0.015); this.events.push({ type: "ghost", lane }); }
    }
  }

  /** Auto-sync: nudge the clock toward the player's median timing so audio/display latency stops costing notes. */
  learn(err) {
    this.errs.push(err);
    if (this.errs.length > 32) this.errs.shift();
    if (!this.autoSync || this.errs.length < 16) return;
    const sorted = [...this.errs].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    if (Math.abs(med) < 0.008) return;
    // only learn from consistent timing (a player tapping randomly has a wide spread and teaches nothing)
    const mad = [...sorted.map((e) => Math.abs(e - med))].sort((a, b) => a - b)[sorted.length >> 1];
    if (mad > 0.04) return;
    const step = Math.max(-0.004, Math.min(0.004, med * 0.2));
    this.offset = Math.max(-0.2, Math.min(0.2, this.offset - step));
    for (let i = 0; i < this.errs.length; i++) this.errs[i] -= step; // past errors as if measured with the new offset
  }

  get offsetMs() { return Math.round(this.offset * 1000); }

  release(lane) {
    if (lane < 0 || lane >= this.lanes) return;
    this.pressed[lane] = false;
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > this.lastT + 0.2) break;
      if (n.holding && n.lane === lane) n.holding = false;
    }
  }

  breakCombo(sound) {
    this.combo = 0;
    this.player.guitar(false);
    if (sound) this.player.missSound();
  }

  update(t) {
    const dt = Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const N = this.notes;
    while (this.next < N.length && N[this.next].state !== 0 && !N[this.next].holding && N[this.next].t + N[this.next].dur < t - 0.05) this.next++;
    for (let i = this.next; i < N.length; i++) {
      const n = N[i];
      if (n.t > t) break;
      if (n.state === 0 && t - n.t > WINDOW) {
        n.state = 2; this.missed++; this.breakCombo(this.combo > 0);
        this.rockBy(-0.03);
        // a missed note breaks its star phrase: the rest of the phrase turns into normal notes
        if (n.star != null && n.star >= 0) { const ph = this.phrases[n.star]; if (!ph.lost) { ph.lost = true; ph.notes.forEach((m) => (m.star = -1)); } }
        this.events.push({ type: "miss", lane: n.lane });
      }
      if (n.holding) {
        if (t >= n.t + n.dur) n.holding = false;
        else if (this.pressed[n.lane]) { this.score += dt * 60 * this.multiplier; this.events.push({ type: "hold", lane: n.lane }); }
        else n.holding = false;
      }
    }
    if (this.starOn) {
      this.starMeter -= dt * this.starDrain;
      if (this.starMeter <= 0) { this.starMeter = 0; this.starOn = false; this.events.push({ type: "starOff" }); }
    }
    if (t > this.end + 0.5) this.ended = true;
  }

  /** After a pause: the music restarts at `toT` (a few seconds before the pause) so the player can find the beat.
      Notes already played stay hidden; the notes come back at the moment the game was paused. */
  hidePlayed() {
    const pausedAt = this.lastT;
    for (const n of this.notes) { n.holding = false; if (n.t < pausedAt && n.state !== 0) n.hide = true; }
    // pausing again during a lead-in keeps the original comeback point
    this.resumeAt = Math.max(this.resumeAt ?? -Infinity, pausedAt);
  }
  resumeFrom(toT) {
    this.pressed.fill(false);
    this.practiceUntil = this.resumeAt;
    this.resumeFromT = toT;
    this.lastT = toT;
    this.player.seek(toT - this.offset + this.songOffset, 0.05);
  }

  /** The no-notes stretch the song is in right now, if any: [start, end]. */
  gapAt(t) {
    for (const g of this.gaps) if (t >= g[0] && t < g[1]) return g;
    return null;
  }

  section(t) {
    let idx = -1;
    for (let i = 0; i < this.sections.length; i++) if (this.sections[i][0] <= t) idx = i; else break;
    return idx;
  }

  summary() {
    const total = this.notes.filter((n) => n.state !== 3).length || 1;
    const acc = this.hits / total;
    return {
      score: Math.round(this.score), hits: this.hits, total, acc,
      maxCombo: this.maxCombo, perfects: this.perfects, failed: this.failed, starUses: this.starUses,
      stars: this.failed ? 1 : acc >= 0.98 ? 5 : acc >= 0.9 ? 4 : acc >= 0.75 ? 3 : acc >= 0.5 ? 2 : 1,
      sections: this.secStats.map((s, i) => ({ name: this.sections[i][1], i, ...s })).filter((s) => s.total > 0),
    };
  }
}
