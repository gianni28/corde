// Per-player settings, saved in this browser.
const KEY = "corde.settings.v1";

export const DEFAULTS = {
  keys: ["d", "f", "j", "k", "l"], // green, red, yellow, blue, orange
  laneMode: "auto", // "auto" | "5" | "4"
  speed: 1.5, // seconds of highway visible
  offsetMs: 0, // + = notes later
  gfx: "auto", // "auto" | "high" | "low"
  missSfx: true,
  autoSync: true,
  name: "",
  starMode: "motion", // phone: star power by "motion" (lift/shake) or "tap" (the multiplier) — tap never asks for permission
  // two players on one PC: each guitar's keys by physical position (KeyboardEvent.code), star power last
  duoKeys: [["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "Space"], ["KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Enter"]],
  duoNames: ["Jugador 1", "Jugador 2"],
  duoDiffs: ["medium", "medium"],
};

// Touch-only device = phone or tablet (4 lanes). Some Windows PCs with a touchscreen report a coarse pointer and no
// fine one (the Claude app's browser pane does too), so the moment a real keyboard is used this browser counts as a
// PC for good: whoever plays with keys gets the 5 lanes.
const KBD_KEY = "corde.keyboard";
let keyboardSeen = (() => { try { return localStorage.getItem(KBD_KEY) === "1"; } catch { return false; } })();
addEventListener("keydown", (e) => {
  if (keyboardSeen || e.isComposing || !e.code || /^(Shift|Control|Alt|Meta|Unidentified)/.test(e.code)) return;
  keyboardSeen = true;
  try { localStorage.setItem(KBD_KEY, "1"); } catch {}
}, { capture: true, passive: true });
export const isTouchDevice = () => !keyboardSeen && matchMedia("(pointer:coarse)").matches && !matchMedia("(any-pointer:fine)").matches;

function load() {
  const fresh = () => JSON.parse(JSON.stringify(DEFAULTS)); // its own copy of the default lists
  try { return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return fresh(); }
}

export const settings = load();
// v2: the first auto-sync could drift after a sloppy game; start everyone's latency from zero once.
if ((settings.syncV || 1) < 2) { settings.offsetMs = 0; settings.syncV = 2; try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
}

export function resetKeys() { settings.keys = [...DEFAULTS.keys]; save(); }

/** Lane count this device plays with: 5 on PC, 4 on touch screens (unless overridden). */
export function deviceLanes() {
  if (settings.laneMode === "5") return 5;
  if (settings.laneMode === "4") return 4;
  return isTouchDevice() ? 4 : 5;
}

export function keyLabel(k) {
  const map = { " ": "Espacio", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", enter: "Enter", shift: "Shift", control: "Ctrl", alt: "Alt", tab: "Tab", backspace: "⌫" };
  return map[k] || (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
}
