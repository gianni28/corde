// STUB for the shop UI branch: the real skins.js (the renderer's looks for every item) replaces this file.
// Only cssVars is used by the menus: the CSS colours of the lanes and of star power that match the 3D look.
const BASE = { "--g": "#1fd14a", "--r": "#e8202c", "--y": "#f5c518", "--b": "#1f6fe0", "--o": "#f57a12", "--star": "#3fbfff" };
/** CSS colours for the HUD and the key caps that match the equipped set (today's colours for now). */
export function cssVars(equipped) { return { ...BASE }; }
