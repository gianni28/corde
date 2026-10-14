// La tienda: lo que se compra con púas (las ganas terminando canciones). Los ids son el contrato entre el juego, el
// escenario 3D (skins.js) y el servidor (supabase/shop.sql, que tiene los precios de verdad): no se cambian.
// Cada parte tiene un "de siempre" gratis que se ve exactamente como el juego antes de la tienda.

export const SLOTS = [
  { id: "neck", name: "Mástiles" },
  { id: "gems", name: "Notas" },
  { id: "flames", name: "Llamas" },
  { id: "strings", name: "Cuerdas y bordes" },
  { id: "star", name: "Poder estrella" },
  { id: "name", name: "Tu nombre" },
  { id: "streak", name: "Rachas" },
  { id: "crowd", name: "Público" },
];
// the parts the 3D stage draws (the rest are page styles: the name on the boards, the streak pop-up)
export const STAGE_SLOTS = ["neck", "gems", "flames", "strings", "star", "crowd"];

export const DEFAULTS = { neck: "palo-rosa", gems: "clasicas", flames: "fuego", strings: "acero", star: "azul", name: "normal", streak: "clasica", crowd: "encendedores" };

/* ---------- what each card shows (a small picture made with CSS, so it works without 3D too) ---------- */
const LANES = ["#1fd14a", "#e8202c", "#f5c518", "#1f6fe0", "#f57a12"];
// wood: a base, its grain and the dot inlays
const wood = (a, b, c) => `repeating-linear-gradient(91deg, rgba(0,0,0,.2) 0 1px, transparent 1px 6px), linear-gradient(90deg, ${a}, ${b} 45%, ${c})`;
const dots = (c, r = 4) => `radial-gradient(circle at 30% 50%, ${c} 0 ${r}px, transparent ${r + 1}px), radial-gradient(circle at 70% 50%, ${c} 0 ${r}px, transparent ${r + 1}px)`;
// strings: the edges (rails) on both sides and five strings
const strings = (s, edge, base = "linear-gradient(90deg, #24120b, #3a1d10 50%, #24120b)") =>
  `linear-gradient(90deg, ${edge} 0 4%, transparent 4% 96%, ${edge} 96%), repeating-linear-gradient(90deg, transparent 0 9.2%, ${s} 9.2% 10.8%, transparent 10.8% 20%), ${base}`;
// the crowd: little lights over a dark room, heads in front
const crowd = (a, b = a) => `radial-gradient(ellipse 9% 30% at 8% 100%, #050303 70%, transparent 72%), radial-gradient(ellipse 9% 34% at 30% 100%, #050303 70%, transparent 72%), radial-gradient(ellipse 9% 30% at 52% 100%, #050303 70%, transparent 72%), radial-gradient(ellipse 9% 34% at 74% 100%, #050303 70%, transparent 72%), radial-gradient(ellipse 9% 30% at 95% 100%, #050303 70%, transparent 72%),`
  + ` radial-gradient(circle, ${a} 0 1.6px, transparent 2.6px) 3px 4px / 17px 13px, radial-gradient(circle, ${b} 0 1.4px, transparent 2.4px) 11px 9px / 23px 15px, linear-gradient(180deg, #120c14, #241418)`;
const glow = (c) => `radial-gradient(circle at 50% 50%, #fff 0 7%, ${c} 20%, transparent 58%), radial-gradient(circle at 50% 50%, ${c}55, transparent 75%), #06080d`;

/** Every item: { slot, id, name, price, req?, lvl? (a level's prize, claimed like a logro's), desc?, sw?, cols? } — req: the logro that gives it (it's claimed, not bought);
 *  sw: the card's CSS background; cols: the colours of the card's little gems / flames / name / streak. */
export const ITEMS = [
  // mástiles (the neck the notes come down)
  { slot: "neck", id: "palo-rosa", name: "Palo de rosa", price: 0, sw: `${dots("#e9e1d0")}, ${wood("#26110a", "#47230f", "#2c140b")}` },
  { slot: "neck", id: "arce", name: "Arce", price: 150, sw: `${dots("#141010")}, ${wood("#caa067", "#ecca94", "#d1a46a")}` },
  { slot: "neck", id: "ebano", name: "Ébano", price: 150, sw: `${dots("#e6eef2")}, ${wood("#0b0a0a", "#1b1816", "#0e0c0c")}` },
  { slot: "neck", id: "camuflaje", name: "Camuflaje", price: 250, sw: "radial-gradient(ellipse 22% 34% at 18% 28%, #3b4524 66%, transparent 70%), radial-gradient(ellipse 20% 30% at 68% 62%, #2b2116 66%, transparent 70%), radial-gradient(ellipse 18% 26% at 42% 82%, #121510 66%, transparent 70%), radial-gradient(ellipse 22% 26% at 86% 18%, #4a3c24 66%, transparent 70%), radial-gradient(ellipse 16% 24% at 52% 30%, #161a12 66%, transparent 70%), #2d3321" },
  { slot: "neck", id: "nacar", name: "Nácar", price: 300, sw: `linear-gradient(135deg, #f6f2ff, #cfe2ef 35%, #f3d8ee 62%, #e3f2e6) 50% 50% / 36% 44% no-repeat, ${wood("#1a0d08", "#2e170c", "#1c0e08")}` },
  { slot: "neck", id: "carbono", name: "Fibra de carbono", price: 300, sw: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,.1) 45%, transparent 60%), conic-gradient(#2a2a2c 25%, #121213 0 50%, #2a2a2c 0 75%, #121213 0) 0 0 / 10px 10px" },
  { slot: "neck", id: "retro", name: "Retro 70", price: 350, sw: `linear-gradient(90deg, #f08a24 0 5%, #7a3a12 5% 9%, #e8b23a 9% 13%, transparent 13% 87%, #e8b23a 87% 91%, #7a3a12 91% 95%, #f08a24 95%), ${wood("#2a160c", "#3e2210", "#2a160c")}` },
  { slot: "neck", id: "hielo", name: "Hielo", price: 400, sw: "linear-gradient(118deg, transparent 44%, rgba(235,250,255,.85) 45%, transparent 46.5%), linear-gradient(62deg, transparent 63%, rgba(235,250,255,.65) 64%, transparent 65%), linear-gradient(160deg, transparent 22%, rgba(235,250,255,.5) 23%, transparent 24%), radial-gradient(ellipse at 30% 20%, rgba(200,240,255,.35), transparent 50%), linear-gradient(180deg, #0d4272, #08203d)" },
  { slot: "neck", id: "lava", name: "Lava", price: 500, sw: "linear-gradient(118deg, transparent 40%, #ff6a10 41%, #ffd23a 42%, #ff5a10 43%, transparent 44.5%), linear-gradient(32deg, transparent 62%, #ff5a10 63%, #ffb030 63.8%, transparent 65%), linear-gradient(170deg, transparent 20%, #ff4a10 21%, transparent 22.5%), radial-gradient(ellipse at 60% 40%, rgba(255,80,20,.3), transparent 60%), #151011" },
  { slot: "neck", id: "llamas", name: "Llamas pintadas", price: 700, sw: "radial-gradient(ellipse 16% 70% at 0% 100%, #ffe066 0 25%, #ff7a1a 45%, #c4161c 62%, transparent 66%), radial-gradient(ellipse 12% 50% at 10% 100%, #ffb020 0 30%, #e8401a 58%, transparent 63%), radial-gradient(ellipse 16% 70% at 100% 100%, #ffe066 0 25%, #ff7a1a 45%, #c4161c 62%, transparent 66%), radial-gradient(ellipse 12% 50% at 90% 100%, #ffb020 0 30%, #e8401a 58%, transparent 63%), linear-gradient(90deg, #08080a, #16161a 50%, #08080a)" },
  { slot: "neck", id: "neon", name: "Neón", price: 600, sw: "linear-gradient(rgba(60,240,255,.75) 1px, transparent 1px) 0 0 / 100% 13px, linear-gradient(90deg, rgba(255,70,200,.75) 1px, transparent 1px) 0 0 / 19px 100%, linear-gradient(180deg, #170a2a, #24093a)" },
  { slot: "neck", id: "galaxia", name: "Galaxia", price: 800, sw: "radial-gradient(circle, #fff 0 1px, transparent 1.5px) 0 0 / 23px 19px, radial-gradient(circle, #cfe0ff 0 .8px, transparent 1.4px) 9px 7px / 13px 17px, radial-gradient(ellipse at 28% 62%, rgba(170,60,255,.6), transparent 55%), radial-gradient(ellipse at 74% 32%, rgba(40,120,255,.55), transparent 52%), #07051a" },
  { slot: "neck", id: "oro", name: "Oro macizo", price: 2000, sw: `${dots("#3a2808")}, repeating-linear-gradient(90deg, rgba(255,255,255,.1) 0 1px, transparent 1px 3px), linear-gradient(90deg, #8a6514, #e8c25a 30%, #fff1b0 48%, #d4a838 66%, #7a5810)` },
  { slot: "neck", id: "leyenda", name: "Leyenda", price: 0, req: "leyenda", desc: "Negro con filigrana de oro. Solo para quien terminó la gira.",
    sw: "radial-gradient(circle at 50% 50%, #f5c518 0 3px, transparent 3.5px 8px, #c99a1a 8px 9.5px, transparent 10px), repeating-linear-gradient(45deg, rgba(245,197,24,.16) 0 1px, transparent 1px 9px), repeating-linear-gradient(-45deg, rgba(245,197,24,.16) 0 1px, transparent 1px 9px), #0b0906" },
  // notas (the gems)
  { slot: "gems", id: "clasicas", name: "Clásicas", price: 0, cols: LANES },
  { slot: "gems", id: "cromo", name: "Cromadas", price: 200, cols: LANES, ring: "#e8ecf0" },
  { slot: "gems", id: "pastel", name: "Pastel", price: 200, cols: ["#8fe8a8", "#f59aa0", "#f7e08a", "#8fb6f2", "#f8bb84"] },
  { slot: "gems", id: "caramelo", name: "Caramelo", price: 300, cols: ["#19ff5a", "#ff1f3d", "#ffd400", "#1a6bff", "#ff7a00"], ring: "#fff" },
  { slot: "gems", id: "cuadradas", name: "Cuadradas", price: 350, cols: LANES, shape: "square" },
  { slot: "gems", id: "neon", name: "Neón", price: 400, cols: ["#39ff6a", "#ff2d55", "#ffe600", "#2d8cff", "#ff8a00"], shape: "neon" },
  { slot: "gems", id: "pixel", name: "Píxel", price: 450, cols: ["#2fdc4f", "#f2333c", "#ffd23a", "#3a7bf0", "#ff8c1a"], shape: "pixel" },
  { slot: "gems", id: "cristal", name: "Cristal", price: 600, cols: LANES, shape: "crystal" },
  { slot: "gems", id: "oro", name: "Doradas", price: 1500, cols: LANES, ring: "#f5c518", shape: "gold" },
  { slot: "gems", id: "diamante", name: "Diamante", price: 0, req: "virtuoso", cols: LANES, shape: "diamond", desc: "Brillan como diamantes. Premio por sacar 5 estrellas en Experto." },
  // llamas (when a note is hit)
  { slot: "flames", id: "fuego", name: "Fuego", price: 0, cols: ["#ff8a1a", "#ffb020", "#ff5a10"] },
  { slot: "flames", id: "azul", name: "Fuego azul", price: 150, cols: ["#3fa0ff", "#8fd0ff", "#2a6bff"] },
  { slot: "flames", id: "verde", name: "Ácido", price: 200, cols: ["#7dff3a", "#c8ff5a", "#3adf2a"] },
  { slot: "flames", id: "rosa", name: "Rosa chicle", price: 200, cols: ["#ff5fb8", "#ff9ad4", "#ff3a9a"] },
  { slot: "flames", id: "morado", name: "Morado", price: 250, cols: ["#a45bff", "#c99aff", "#7a3aff"] },
  { slot: "flames", id: "dorado", name: "Dorado", price: 400, cols: ["#f5c518", "#ffe27a", "#e8a010"] },
  { slot: "flames", id: "plasma", name: "Plasma", price: 500, cols: ["#e8fbff", "#ffffff", "#bff4ff"], glow: "#3fe0ff" },
  { slot: "flames", id: "notas", name: "Del color de la nota", price: 600, cols: [LANES[0], LANES[2], LANES[3]] },
  { slot: "flames", id: "arcoiris", name: "Arcoíris", price: 1000, cols: ["#ff3a3a", "#3aff6a", "#3a8aff"], rainbow: true },
  { slot: "flames", id: "perfecto", name: "Perfeccionista", price: 0, req: "sin-fallar", cols: ["#fff6d8", "#ffffff", "#ffe08a"], glow: "#f5c518", desc: "Fuego blanco y dorado. Premio por terminar una canción sin fallar." },
  // cuerdas y bordes
  { slot: "strings", id: "acero", name: "Acero", price: 0, sw: strings("#cfd4da", "#8f969e") },
  { slot: "strings", id: "cobre", name: "Cobre", price: 150, sw: strings("#e09050", "#b5652a") },
  { slot: "strings", id: "negras", name: "Negro mate", price: 150, sw: strings("#050505", "#4a4a5e", "linear-gradient(90deg, #3a2014, #5a3220 50%, #3a2014)") },
  { slot: "strings", id: "oro", name: "Doradas", price: 200, sw: strings("#f5c518", "#ffcf5a") },
  { slot: "strings", id: "hielo", name: "Hielo", price: 300, sw: strings("#eef3f6", "#5fe8ff") },
  { slot: "strings", id: "neon", name: "Neón de colores", price: 500,
    sw: `linear-gradient(90deg, #ff4fa8 0 4%, transparent 4% 96%, #3fe8ff 96%), linear-gradient(90deg, transparent 9.2%, ${LANES[0]} 9.2% 10.8%, transparent 10.8% 29.2%, ${LANES[1]} 29.2% 30.8%, transparent 30.8% 49.2%, ${LANES[2]} 49.2% 50.8%, transparent 50.8% 69.2%, ${LANES[3]} 69.2% 70.8%, transparent 70.8% 89.2%, ${LANES[4]} 89.2% 90.8%, transparent 90.8%), linear-gradient(90deg, #1a0d14, #2a1420 50%, #1a0d14)` },
  // poder estrella
  { slot: "star", id: "azul", name: "Azul", price: 0, cols: ["#3fbfff"] },
  { slot: "star", id: "dorado", name: "Dorado", price: 300, cols: ["#f5c518"] },
  { slot: "star", id: "rosa", name: "Rosa", price: 300, cols: ["#ff5fb8"] },
  { slot: "star", id: "rojo", name: "Rojo", price: 300, cols: ["#ff3a30"] },
  { slot: "star", id: "verde", name: "Verde", price: 300, cols: ["#3aff7a"] },
  { slot: "star", id: "morado", name: "Morado", price: 300, cols: ["#b06bff"] },
  { slot: "star", id: "arcoiris", name: "Arcoíris", price: 1200, cols: ["#ff3a3a", "#ffd23a", "#3aff6a", "#3a8aff", "#c43aff"], rainbow: true },
  // tu nombre (everyone sees it on the boards)
  { slot: "name", id: "normal", name: "Normal", price: 0 },
  { slot: "name", id: "dorado", name: "Dorado", price: 300 },
  { slot: "name", id: "rosa", name: "Rosa", price: 300 },
  { slot: "name", id: "cian", name: "Cian", price: 300 },
  { slot: "name", id: "verde", name: "Verde", price: 300 },
  { slot: "name", id: "fuego", name: "Fuego", price: 800 },
  { slot: "name", id: "arcoiris", name: "Arcoíris", price: 1500 },
  { slot: "name", id: "corona", name: "Corona", price: 0, req: "leyenda", desc: "Tu nombre en oro y con corona en todas las clasificaciones. Para leyendas de la gira." },
  { slot: "name", id: "plata", name: "Plata", price: 0, lvl: 5, desc: "Tu nombre en plata brillante. Premio del nivel 5." },
  { slot: "name", id: "electrico", name: "Eléctrico", price: 0, lvl: 10, desc: "Tu nombre echando chispas. Premio del nivel 10." },
  { slot: "name", id: "estrella", name: "Estrella", price: 0, lvl: 20, desc: "Tu nombre con una estrella que brilla. Premio del nivel 20." },
  // rachas (the "¡Racha de 50!" pop-up)
  { slot: "streak", id: "clasica", name: "Clásica", price: 0 },
  { slot: "streak", id: "neon", name: "Neón", price: 250 },
  { slot: "streak", id: "fuego", name: "Fuego", price: 400 },
  { slot: "streak", id: "oro", name: "Oro", price: 600 },
  { slot: "streak", id: "arcoiris", name: "Arcoíris", price: 900 },
  // público (the lights in the crowd)
  { slot: "crowd", id: "encendedores", name: "Encendedores", price: 0, sw: crowd("#ffc060", "#ff9a30") },
  { slot: "crowd", id: "celulares", name: "Celulares", price: 150, sw: crowd("#e8f4ff", "#9fd0ff") },
  { slot: "crowd", id: "rojo", name: "Luces rojas", price: 200, sw: crowd("#ff3a2a", "#ff7a6a") },
  { slot: "crowd", id: "barras", name: "Barras de neón", price: 300, sw: crowd("#3aff7a", "#ff4fd8").replace("#120c14", "#0e0a1a") },
];
for (const it of ITEMS) if (it.slot === "star") it.sw = it.rainbow ? `radial-gradient(circle at 50% 50%, #fff 0 7%, transparent 40%), conic-gradient(from 0deg, ${it.cols.join(", ")}, ${it.cols[0]})` : glow(it.cols[0]);

const BY_KEY = Object.fromEntries(ITEMS.map((it) => [`${it.slot}:${it.id}`, it]));
/** The item, or null for an id this version doesn't know. */
export const itemOf = (slot, id) => BY_KEY[`${slot}:${id}`] || null;
/** How an item is written in the account's "owned" list. */
export const ownedKey = (slot, id) => `${slot}:${id}`;
export const isDefault = (it) => DEFAULTS[it.slot] === it.id;
/** A full set, slot by slot: what's equipped when it's an item this version knows, the default otherwise. */
export function resolveEquipped(eq) {
  const out = { ...DEFAULTS };
  if (eq && typeof eq === "object") for (const s of SLOTS) if (itemOf(s.id, eq[s.id])) out[s.id] = eq[s.id];
  return out;
}
