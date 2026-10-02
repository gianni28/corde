// Star power on the phone: lift it like a guitar, shake it or just move it a lot. Three detectors, any one fires:
//  - turn: the gyroscope adds up 35°+ of rotation within a third of a second (works lying down or at any angle)
//  - shake: a sharp jolt (linear acceleration over ~13 m/s²)
//  - tilt: the old one, the screen's tilt (beta/gamma) changes 28°+ quickly, for phones without a gyroscope
// iPhone asks for permission (only from a tap), so the tutorial asks before any song starts.

let listening = false, handler = null, lastFire = 0;
let tiltHist = [], turnHist = [], lastMotion = 0;

export const motionAvailable = () => typeof window.DeviceOrientationEvent !== "undefined" && matchMedia("(pointer:coarse)").matches;
export const motionNeedsPermission = () => typeof window.DeviceOrientationEvent?.requestPermission === "function";

/** Must be called from a tap. Resolves true when the page may read the phone's movement. */
export async function requestMotion() {
  if (!motionAvailable()) return false;
  if (!motionNeedsPermission()) return true;
  // both requests start inside the tap; iPhone shows a single prompt for the two
  const asks = [window.DeviceOrientationEvent.requestPermission()];
  if (typeof window.DeviceMotionEvent?.requestPermission === "function") asks.push(window.DeviceMotionEvent.requestPermission());
  try { return (await Promise.all(asks)).some((r) => r === "granted"); } catch { return false; }
}

function fire(now) {
  if (now - lastFire < 1200) return;
  lastFire = now; tiltHist = []; turnHist = [];
  handler && handler();
}

function onOrientation(e) {
  if (e.beta == null) return;
  const now = performance.now();
  tiltHist.push([now, e.beta, e.gamma || 0]);
  while (tiltHist.length && now - tiltHist[0][0] > 330) tiltHist.shift();
  const [, b0, g0] = tiltHist[0];
  // beta jumps ±180 when the phone flips past vertical: that's noise, not a lift
  const db = Math.abs(e.beta - b0), dg = Math.abs((e.gamma || 0) - g0);
  const moved = Math.max(db > 180 ? 360 - db : db, dg > 90 ? 180 - dg : dg);
  if (moved >= 28) fire(now);
}

function onMotion(e) {
  const now = performance.now();
  const dt = Math.min(0.1, lastMotion ? (now - lastMotion) / 1000 : 0.016);
  lastMotion = now;
  const r = e.rotationRate;
  if (r && (r.alpha != null || r.beta != null)) {
    const speed = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0); // °/s around any axis
    turnHist.push([now, speed * dt]);
    while (turnHist.length && now - turnHist[0][0] > 350) turnHist.shift();
    let turned = 0; for (const [, d] of turnHist) turned += d;
    if (turned >= 35) return fire(now);
  }
  const a = e.acceleration;
  if (a && a.x != null && Math.hypot(a.x, a.y || 0, a.z || 0) >= 13) fire(now);
}

/** Calls fn on every lift, shake or big move. */
export function onLift(fn) {
  handler = fn;
  if (!listening && motionAvailable()) {
    window.addEventListener("deviceorientation", onOrientation);
    if (typeof window.DeviceMotionEvent !== "undefined") window.addEventListener("devicemotion", onMotion);
    listening = true;
  }
}
