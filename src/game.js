// Gameplay: timing, hits, sustains, scoring. No rendering or DOM here.
import { notesFor } from "./chart.js";

export const WINDOW = 0.1; // ±100 ms to hit a note
export const PERFECT = 0.045;

export class Game {
  // offsetMs: the player's latency compensation (learned/adjustable). songOffsetMs: how much later the song's audio
  // runs than its chart (MP3 encoder padding, song.ini "delay"); fixed per song.
  constructor({ chart, diff, lanes, player, offsetMs = 0, songOffsetMs = 0, look = 1.5, autoSync = true }) {
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
    this.notes = notesFor(chart, diff, lanes).map((n) => ({ ...n, state: 0, holding: false }));
    this.beats = chart.beats;
    this.sections = chart.sections;
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.hits = 0; this.perfects = 0; this.missed = 0;
    this.next = 0;
    this.pressed = new Array(lanes).fill(false);
    this.lastT = -99;
    const lastNote = this.notes.length ? this.notes[this.notes.length - 1] : { t: 0, dur: 0 };
    this.end = Math.max(player.duration, lastNote.t + lastNote.dur + 1);
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

  get multiplier() { return Math.min(4, 1 + Math.floor(this.combo / 10)); }
  get accuracy() { const judged = this.hits + this.missed; return judged ? this.hits / judged : 1; }

  time() { return this.player.time() + this.offset - this.songOffset; }

  start() {
    const first = this.notes.length ? this.notes[0].t : 0;
    this.player.start(3 + Math.max(0, this.look - first + 0.3));
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
      this.events.push({ type: "hit", lane, sustain: best.holding, err });
    } else if (t > -0.5 && t >= this.practiceUntil) {
      // Forgive double taps and presses that are just outside the window of a nearby note in this lane.
      const near = t - this.lastHit[lane] < 0.18 || this.notes.some((n, i) => i >= this.next - 4 && i < this.next + 24 && n.lane === lane && Math.abs(n.t - t) < 0.22);
      if (!near) { this.breakCombo(false); this.events.push({ type: "ghost", lane }); }
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
        this.events.push({ type: "miss", lane: n.lane });
      }
      if (n.holding) {
        if (t >= n.t + n.dur) n.holding = false;
        else if (this.pressed[n.lane]) { this.score += dt * 60 * this.multiplier; this.events.push({ type: "hold", lane: n.lane }); }
        else n.holding = false;
      }
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
    const total = this.notes.length || 1;
    const acc = this.hits / total;
    return {
      score: Math.round(this.score), hits: this.hits, total: this.notes.length, acc,
      maxCombo: this.maxCombo, perfects: this.perfects,
      stars: acc >= 0.98 ? 5 : acc >= 0.9 ? 4 : acc >= 0.75 ? 3 : acc >= 0.5 ? 2 : 1,
    };
  }
}
