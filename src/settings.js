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
};

export const isTouchDevice = () => matchMedia("(pointer:coarse)").matches && !matchMedia("(any-pointer:fine)").matches;

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}

export const settings = load();

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
