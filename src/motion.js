// "Lift the phone like a guitar" to trigger star power: a quick tilt of 28°+ within a third of a second.
// iPhone asks for permission (only from a tap), so the tutorial asks before any song starts.

let listening = false, handler = null, hist = [], lastFire = 0;

export const motionAvailable = () => typeof window.DeviceOrientationEvent !== "undefined" && matchMedia("(pointer:coarse)").matches;
export const motionNeedsPermission = () => typeof window.DeviceOrientationEvent?.requestPermission === "function";

/** Must be called from a tap. Resolves true when the page may read the phone's tilt. */
export async function requestMotion() {
  if (!motionAvailable()) return false;
  if (!motionNeedsPermission()) return true;
  try { return (await window.DeviceOrientationEvent.requestPermission()) === "granted"; } catch { return false; }
}

function onOrientation(e) {
  if (e.beta == null) return;
  const now = performance.now();
  hist.push([now, e.beta, e.gamma || 0]);
  while (hist.length && now - hist[0][0] > 330) hist.shift();
  const [, b0, g0] = hist[0];
  const moved = Math.max(Math.abs(e.beta - b0), Math.abs((e.gamma || 0) - g0));
  if (moved >= 28 && now - lastFire > 1200) { lastFire = now; hist = []; handler && handler(); }
}

/** Calls fn on every lift. */
export function onLift(fn) {
  handler = fn;
  if (!listening && motionAvailable()) { window.addEventListener("deviceorientation", onOrientation); listening = true; }
}
