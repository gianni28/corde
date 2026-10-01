// Gameplay: timing, hits, sustains, scoring. No rendering or DOM here.
import { notesFor } from "./chart.js";

export const WINDOW = 0.1; // ±100 ms to hit a note
export const PERFECT = 0.045;

export class Game {
  constructor({ chart, diff, lanes, player, offsetMs = 0, look = 1.5 }) {
    this.chart = chart;
    this.diff = diff;
    this.lanes = lanes;
    this.player = player;
    this.offset = offsetMs / 1000;
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
  }

  get multiplier() { return Math.min(4, 1 + Math.floor(this.combo / 10)); }
  get accuracy() { const judged = this.hits + this.missed; return judged ? this.hits / judged : 1; }

  time() { return this.player.time() + this.offset; }

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
      this.combo++; this.hits++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (Math.abs(err) <= PERFECT) this.perfects++;
      this.score += 50 * this.multiplier;
      this.player.guitar(true);
      this.events.push({ type: "hit", lane, sustain: best.holding, err });
    } else if (t > -0.5) {
      this.breakCombo(true);
      this.events.push({ type: "ghost", lane });
    }
  }

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
