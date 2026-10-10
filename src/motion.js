// Star power on the phone: lift it like a guitar, shake it or just move it a lot.
// The accelerometer (every phone has one) does the work:
//  - shake: a few strong jolts in a row (the pull beyond gravity alone), or one very hard one
//  - lift: the direction of gravity turns 30°+ within 0.4 s (works standing, sitting or lying down)
// Phones with a gyroscope also fire on a quick 35° turn, and the screen tilt is a last fallback.
// iPhone asks for permission (only from a tap) and forgets it when the page reloads; main.js asks again when a song
// is about to start, and only if the sensors aren't already reaching the page (see `flowing`).

const JOLT = 5.5, JOLT_HARD = 11, JOLTS = 3; // m/s² beyond gravity; jolts needed within JOLT_MS
const JOLT_MS = 300, TURN = 30, TURN_MS = 400, GYRO = 35, GYRO_MS = 350, COOLDOWN = 1200;

let listening = false, handler = null, watcher = null, granted = false, flowing = false, lastFire = 0, lastMotion = 0;
let grav = null, slow = null, gravHist = [], jolts = [], gyroHist = [], tiltHist = [];
/** Which sensors have sent data (shown by the test in Settings). */
export const seen = { accel: false, gyro: false, tilt: false };

export const motionAvailable = () => typeof window.DeviceMotionEvent !== "undefined" && matchMedia("(pointer:coarse)").matches;
export const motionNeedsPermission = () => typeof window.DeviceMotionEvent?.requestPermission === "function" || typeof window.DeviceOrientationEvent?.requestPermission === "function";
/** True when this page may read the movement right now (iPhone: granted since the last reload). */
export const motionReady = () => motionAvailable() && (granted || flowing || !motionNeedsPermission());
// The phone may already be sending its movement (the permission is still alive): then there's nothing to ask.
// A quiet listener notices the first reading and switches the real one on.
if (motionAvailable()) {
  const probe = (e) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    flowing = true;
    window.removeEventListener("devicemotion", probe);
    if (handler || watcher) listen();
  };
  window.addEventListener("devicemotion", probe, { passive: true });
}

/** Must be called from a tap. Resolves true when the page may read the phone's movement. */
export async function requestMotion() {
  if (!motionAvailable()) return false;
  if (!motionNeedsPermission() || flowing) { listen(); return true; }
  // both requests start inside the tap; iPhone shows one prompt for the two
  const asks = [];
  try { if (typeof window.DeviceMotionEvent?.requestPermission === "function") asks.push(window.DeviceMotionEvent.requestPermission()); } catch {}
  try { if (typeof window.DeviceOrientationEvent?.requestPermission === "function") asks.push(window.DeviceOrientationEvent.requestPermission()); } catch {}
  const res = await Promise.allSettled(asks);
  granted = res.some((r) => r.status === "fulfilled" && r.value === "granted");
  if (granted) listen();
  return granted;
}

function fire(now) {
  if (now - lastFire < COOLDOWN) return;
  lastFire = now; gravHist = []; jolts = []; gyroHist = []; tiltHist = [];
  watcher && watcher({ level: 1, fired: true });
  handler && handler();
}
const report = (level) => watcher && watcher({ level: Math.min(1, level), fired: false });

function onMotion(e) {
  const now = performance.now();
  const dt = Math.min(0.1, lastMotion ? (now - lastMotion) / 1000 : 0.016);
  lastMotion = now;
  let level = 0;
  const g = e.accelerationIncludingGravity;
  if (g && g.x != null) {
    seen.accel = true;
    const v = [g.x, g.y || 0, g.z || 0];
    // shake: how hard the phone is pulled beyond gravity alone, in any direction
    // (sideways shakes barely change the total, so it's measured against a slow estimate of gravity)
    slow = slow ? slow.map((x, i) => x + 0.08 * (v[i] - x)) : v;
    const jolt = Math.max(Math.abs(Math.hypot(...v) - 9.81), Math.hypot(v[0] - slow[0], v[1] - slow[1], v[2] - slow[2]));
    if (jolt >= JOLT) jolts.push(now);
    while (jolts.length && now - jolts[0] > JOLT_MS) jolts.shift();
    if (jolt >= JOLT_HARD || jolts.length >= JOLTS) return fire(now);
    level = Math.max(jolt / JOLT_HARD, jolts.length / JOLTS);
    // lift: smoothed gravity direction now vs. a moment ago
    grav = grav ? grav.map((x, i) => x + 0.3 * (v[i] - x)) : v;
    const n = Math.hypot(...grav) || 1, u = grav.map((x) => x / n);
    gravHist.push([now, u]);
    while (gravHist.length && now - gravHist[0][0] > TURN_MS) gravHist.shift();
    const u0 = gravHist[0][1];
    const ang = (Math.acos(Math.max(-1, Math.min(1, u0[0] * u[0] + u0[1] * u[1] + u0[2] * u[2]))) * 180) / Math.PI;
    if (ang >= TURN) return fire(now);
    level = Math.max(level, ang / TURN);
  }
  const r = e.rotationRate;
  if (r && (r.alpha != null || r.beta != null)) {
    seen.gyro = true;
    gyroHist.push([now, Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) * dt]); // degrees turned this sample
    while (gyroHist.length && now - gyroHist[0][0] > GYRO_MS) gyroHist.shift();
    let turned = 0; for (const [, d] of gyroHist) turned += d;
    if (turned >= GYRO) return fire(now);
    level = Math.max(level, turned / GYRO);
  }
  report(level);
}

function onOrientation(e) {
  if (e.beta == null) return;
  seen.tilt = true;
  if (seen.accel) return; // the accelerometer already covers this
  const now = performance.now();
  tiltHist.push([now, e.beta, e.gamma || 0]);
  while (tiltHist.length && now - tiltHist[0][0] > 330) tiltHist.shift();
  const [, b0, g0] = tiltHist[0];
  // beta jumps ±180 when the phone flips past vertical: that's noise, not a lift
  const db = Math.abs(e.beta - b0), dg = Math.abs((e.gamma || 0) - g0);
  const moved = Math.max(db > 180 ? 360 - db : db, dg > 90 ? 180 - dg : dg);
  if (moved >= 28) fire(now); else report(moved / 28);
}

function listen() {
  if (listening || !motionAvailable()) return;
  window.addEventListener("devicemotion", onMotion);
  if (typeof window.DeviceOrientationEvent !== "undefined") window.addEventListener("deviceorientation", onOrientation);
  listening = true;
}

/** Calls fn on every lift, shake or big move. */
export function onLift(fn) {
  handler = fn;
  if (motionReady()) listen();
}

/** For the test in Settings: fn({ level 0..1, fired }) on every reading. Returns a function that stops it. */
export function watchMotion(fn) {
  watcher = fn;
  if (motionReady()) listen();
  return () => { if (watcher === fn) watcher = null; };
}
