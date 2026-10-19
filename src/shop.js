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
  { id: "pet", name: "Mascotas" },
];
// the parts the 3D stage draws (the rest are page styles: the name on the boards, the streak pop-up)
export const STAGE_SLOTS = ["neck", "gems", "flames", "strings", "star", "crowd", "pet"];

export const DEFAULTS = { neck: "palo-rosa", gems: "clasicas", flames: "fuego", strings: "acero", star: "azul", name: "normal", streak: "clasica", crowd: "encendedores", pet: "ninguna" };

/* ---------- what each card shows (a small picture made with CSS, so it works without 3D too) ---------- */
const LANES = ["#1fd14a", "#e8202c", "#f5c518", "#1f6fe0", "#f57a12"];
// wood: a base, its grain and the dot inlays
const wood = (a, b, c) => `repeating-linear-gradient(91deg, rgba(0,0,0,.2) 0 1px, transparent 1px 6px), linear-gradient(90deg, ${a}, ${b} 45%, ${c})`;
const dots = (c, r = 4) => `radial-gradient(circle at 30% 50%, ${c} 0 ${r}px, transparent ${r + 1}px), radial-gradient(circle at 70% 50%, ${c} 0 ${r}px, transparent ${r + 1}px)`;
// strings: the edges (rails) on both sides and five strings
const strings = (s, edge, base = "linear-gradient(90deg, #24120b, #3a1d10 50%, #24120b)") =>
  `linear-gradient(90deg, ${edge} 0 4%, transparent 4% 96%, ${edge} 96%), repeating-linear-gradient(90deg, transparent 0 9.2%, ${s} 9.2% 10.8%, transparent 10.8% 20%), ${base}`;
const glow = (c) => `radial-gradient(circle at 50% 50%, #fff 0 7%, ${c} 20%, transparent 58%), radial-gradient(circle at 50% 50%, ${c}55, transparent 75%), #06080d`;

/** Every item: { slot, id, name, price, req?, lvl? (a level's prize, claimed like a logro's), tour? (a tour prize: its
 *  difficulty), secret? (only shown to
 *  who can win it: see main.js), desc?, sw?, cols? } — req: the logro that gives it (it's claimed, not bought);
 *  sw: the card's CSS background; cols: the colours of the card's little gems / flames / name / streak. */
// items shown in the shop as one card that opens to its members (a band: pick your favourite); main.js renderShop
export const GROUPS = { "one-direction": { name: "One Direction" } };
export const ITEMS = [
  // mástiles (the neck the notes come down)
  { slot: "neck", id: "palo-rosa", name: "Palo de rosa", price: 0, sw: `${dots("#e9e1d0")}, ${wood("#26110a", "#47230f", "#2c140b")}` },
  { slot: "neck", id: "arce", name: "Arce", price: 150, sw: `${dots("#141010")}, ${wood("#caa067", "#ecca94", "#d1a46a")}` },
  { slot: "neck", id: "ebano", name: "Ébano", price: 150, sw: `${dots("#e6eef2")}, ${wood("#0b0a0a", "#1b1816", "#0e0c0c")}` },
  { slot: "neck", id: "camuflaje", name: "Camuflaje", price: 250, sw: "radial-gradient(ellipse 22% 34% at 18% 28%, #3b4524 66%, transparent 70%), radial-gradient(ellipse 20% 30% at 68% 62%, #2b2116 66%, transparent 70%), radial-gradient(ellipse 18% 26% at 42% 82%, #121510 66%, transparent 70%), radial-gradient(ellipse 22% 26% at 86% 18%, #4a3c24 66%, transparent 70%), radial-gradient(ellipse 16% 24% at 52% 30%, #161a12 66%, transparent 70%), #2d3321" },
  { slot: "neck", id: "nacar", name: "Nácar", price: 300, sw: `linear-gradient(180deg, #f6f2ff, #cfe2ef 35%, #f3d8ee 62%, #e3f2e6) 6% 0 / 7% 100% no-repeat, linear-gradient(180deg, #e3f2e6, #f3d8ee 40%, #cfe2ef 70%, #f6f2ff) 94% 0 / 7% 100% no-repeat, radial-gradient(circle, #e8e2d6 0 3px, transparent 4px) 50% 50% / 100% 100% no-repeat, ${wood("#1a0d08", "#2e170c", "#1c0e08")}`, desc: "Madera oscura con filetes de nácar a lo largo de los bordes, que cambian de color suavemente." },
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
  // the song of the day's streak prizes (main.js STREAK_PRIZES)
  { slot: "neck", id: "calavera", name: "Calavera", price: 0, req: "dia-30", streak: 30, desc: "Cuero negro, alambre de púas y una calavera. Premio por tocar la canción del día 30 días seguidos.",
    sw: "radial-gradient(ellipse 15% 22% at 50% 42%, #e8e2d4 60%, transparent 63%), radial-gradient(ellipse 9% 9% at 50% 66%, #e8e2d4 60%, transparent 64%), radial-gradient(circle at 44% 42%, #000 0 3px, transparent 4px), radial-gradient(circle at 56% 42%, #000 0 3px, transparent 4px), repeating-linear-gradient(90deg, #8a8a90 0 2px, transparent 2px 9px) 0 0 / 100% 3px no-repeat, repeating-linear-gradient(90deg, #8a8a90 0 2px, transparent 2px 9px) 0 100% / 100% 3px no-repeat, linear-gradient(90deg, #0a0909, #1c1a1a 50%, #0a0909)" },
  // the tour's prizes (tour.js TOUR_PRIZES): one style per difficulty
  { slot: "neck", id: "calcomanias", name: "Calcomanías", price: 0, req: "gira-easy-stadium", tour: "easy", desc: "Madera gastada llena de calcomanías de bandas. Premio de la gira en Fácil: supera El Estadio.",
    sw: "radial-gradient(circle at 22% 30%, #ff4f6a 0 9px, transparent 10px), radial-gradient(circle at 70% 24%, #ffd23a 0 8px, transparent 9px), radial-gradient(circle at 48% 70%, #3fa8ff 0 9px, transparent 10px), radial-gradient(circle at 84% 72%, #3fd06a 0 7px, transparent 8px), radial-gradient(circle at 14% 78%, #b46bff 0 7px, transparent 8px), linear-gradient(90deg, #3a2412, #6a4424 50%, #3a2412)" },
  { slot: "neck", id: "laser", name: "Láser", price: 0, req: "gira-hard-stadium", tour: "hard", desc: "Un escenario oscuro cortado por rayos láser. Premio de la gira en Difícil: supera El Estadio.",
    sw: "linear-gradient(115deg, transparent 30%, rgba(60,255,90,.9) 31%, transparent 32.5%), linear-gradient(65deg, transparent 55%, rgba(255,40,200,.9) 56%, transparent 57.5%), linear-gradient(140deg, transparent 62%, rgba(40,220,255,.85) 63%, transparent 64.5%), linear-gradient(35deg, transparent 20%, rgba(255,200,40,.8) 21%, transparent 22.5%), radial-gradient(ellipse at 50% 50%, #2a0e3a, #050308 75%)" },
  { slot: "neck", id: "mundial", name: "Gira mundial", price: 0, req: "gira-expert-stadium", tour: "expert", desc: "La Tierra de noche, ciudades encendidas y las rutas de tu gira en oro. Premio de la gira en Experto: supera El Estadio.",
    sw: "radial-gradient(circle at 20% 35%, #ffd27a 0 2px, transparent 3px), radial-gradient(circle at 75% 25%, #ffd27a 0 2px, transparent 3px), radial-gradient(circle at 55% 75%, #ffd27a 0 2px, transparent 3px), radial-gradient(ellipse 70% 40% at 47% 50%, transparent 58%, rgba(255,206,90,.85) 60%, transparent 63%), repeating-linear-gradient(90deg, rgba(90,140,220,.15) 0 1px, transparent 1px 18px), linear-gradient(90deg, #020611, #08183a 50%, #020611)" },
  // notas (the gems)
  { slot: "gems", id: "clasicas", name: "Clásicas", price: 0, cols: LANES },
  { slot: "gems", id: "cromo", name: "Cromadas", price: 200, cols: LANES, shape: "chrome", desc: "Notas de cromo que reflejan como espejo, con un lente de color en el centro." },
  { slot: "gems", id: "pastel", name: "Macarons", price: 200, cols: ["#8fe8a8", "#f59aa0", "#f7e08a", "#8fb6f2", "#f8bb84"], shape: "macaron", desc: "Las notas son macarons de colores pastel, con su relleno de crema." },
  { slot: "gems", id: "caramelo", name: "Caramelos", price: 300, cols: ["#19ff5a", "#ff1f3d", "#ffd400", "#1a6bff", "#ff7a00"], shape: "candy", desc: "Caramelos envueltos en celofán, con espiral blanca." },
  { slot: "gems", id: "cuadradas", name: "Cuadradas", price: 350, cols: LANES, shape: "square" },
  { slot: "gems", id: "neon", name: "Neón", price: 400, cols: ["#39ff6a", "#ff2d55", "#ffe600", "#2d8cff", "#ff8a00"], shape: "neon" },
  { slot: "gems", id: "pixel", name: "Píxel", price: 450, cols: ["#2fdc4f", "#f2333c", "#ffd23a", "#3a7bf0", "#ff8c1a"], shape: "pixel" },
  { slot: "gems", id: "cristal", name: "Cristal", price: 600, cols: LANES, shape: "crystal" },
  { slot: "gems", id: "oro", name: "Doradas", price: 1500, cols: LANES, ring: "#f5c518", shape: "gold" },
  // the Otaku event's surprise gifts (surprise: nowhere in the shop until won; src/achievements.js BANANA_GIFTS)
  { slot: "gems", id: "titi", name: "Tití emperador", price: 0, req: "otaku-titi", secret: true, surprise: true, cols: LANES, shape: "titi", desc: "Caritas de tití emperador con sus bigotes blancos, que se mueven con la música. Regalo de la expedición Otaku." },
  { slot: "flames", id: "antimagia", name: "Antimagia", price: 0, req: "otaku-antimagia", secret: true, surprise: true, art: "antimagic", cols: ["#16080a", "#ff2a3a", "#2a0a10"], glow: "#ff2a3a", desc: "Llamas negras de antimagia con grietas rojas, como la espada de Asta. Regalo de la expedición Otaku." },
  { slot: "pet", id: "ninguna", name: "Sin mascota", price: 0, desc: "Nadie te acompaña en el mástil." },
  { slot: "pet", id: "nero", name: "Nero", price: 0, req: "otaku-nero", secret: true, surprise: true, desc: "El anti-pájaro: se sienta junto al mástil con cara de aburrido, se duerme si fallas, aletea con tus rachas y vuela con el poder estrella. Regalo de la expedición Otaku." },
  // One Direction: the event's gift, all five (whoever wins picks their favourite)
  { slot: "pet", id: "harry", name: "Harry", price: 0, req: "one-direction", group: "one-direction", secret: true, surprise: true, desc: "Harry, con sus rizos, el blazer rosado y el polo rojo. Se aburre, se duerme si fallas, celebra tus rachas y salta con el poder estrella. Regalo del evento One Direction." },
  { slot: "pet", id: "liam", name: "Liam", price: 0, req: "one-direction", group: "one-direction", secret: true, surprise: true, desc: "Liam, con su flequillo ondulado y la camisa a cuadros. Se aburre, se duerme si fallas, celebra tus rachas y salta con el poder estrella. Regalo del evento One Direction." },
  { slot: "pet", id: "louis", name: "Louis", price: 0, req: "one-direction", group: "one-direction", secret: true, surprise: true, desc: "Louis, con el flequillo de lado y su camiseta blanca. Se aburre, se duerme si fallas, celebra tus rachas y salta con el poder estrella. Regalo del evento One Direction." },
  { slot: "pet", id: "niall", name: "Niall", price: 0, req: "one-direction", group: "one-direction", secret: true, surprise: true, desc: "Niall, con su copete rubio y el suéter celeste. Se aburre, se duerme si fallas, celebra tus rachas y salta con el poder estrella. Regalo del evento One Direction." },
  { slot: "pet", id: "zayn", name: "Zayn", price: 0, req: "one-direction", group: "one-direction", secret: true, surprise: true, desc: "Zayn, con su tupé negro y el suéter rojo. Se aburre, se duerme si fallas, celebra tus rachas y salta con el poder estrella. Regalo del evento One Direction." },
  { slot: "gems", id: "gatitos", name: "Gatitos", price: 0, req: "coro-gatitos", secret: true, cols: LANES, shape: "cat", desc: "Las notas se vuelven caritas de gato. Premio del logro «Coro de gatitos»." },
  { slot: "gems", id: "diamante", name: "Diamante", price: 0, req: "virtuoso", cols: LANES, shape: "diamond", desc: "Brillan como diamantes. Premio por sacar 5 estrellas en Experto." },
  { slot: "gems", id: "vinilo", name: "Vinilos", price: 0, req: "gira-medium-stadium", tour: "medium", cols: LANES, shape: "vinyl", desc: "Las notas son discos de vinilo con la etiqueta de su color. Premio de la gira en Media: supera El Estadio." },
  // llamas (when a note is hit)
  { slot: "flames", id: "fuego", name: "Fuego", price: 0, cols: ["#ff8a1a", "#ffb020", "#ff5a10"] },
  { slot: "flames", id: "azul", name: "Fuego azul", price: 150, cols: ["#3fa0ff", "#8fd0ff", "#2a6bff"] },
  { slot: "flames", id: "verde", art: "bubbles", name: "Ácido", price: 200, cols: ["#7dff3a", "#c8ff5a", "#3adf2a"], desc: "Burbujas verdes que hierven desde el botón, como ácido." },
  { slot: "flames", id: "rosa", name: "Rosa chicle", price: 200, cols: ["#ff5fb8", "#ff9ad4", "#ff3a9a"] },
  { slot: "flames", id: "morado", name: "Morado", price: 250, cols: ["#a45bff", "#c99aff", "#7a3aff"] },
  { slot: "flames", id: "dorado", name: "Dorado", price: 400, cols: ["#f5c518", "#ffe27a", "#e8a010"] },
  { slot: "flames", id: "plasma", art: "bolt", name: "Plasma", price: 500, cols: ["#e8fbff", "#ffffff", "#bff4ff"], glow: "#3fe0ff", desc: "Rayos eléctricos que saltan del botón." },
  { slot: "flames", id: "notas", name: "Del color de la nota", price: 600, cols: [LANES[0], LANES[2], LANES[3]] },
  { slot: "flames", id: "arcoiris", name: "Arcoíris", price: 1000, cols: ["#ff3a3a", "#3aff6a", "#3a8aff"], rainbow: true },
  { slot: "flames", id: "aurora", art: "curtain", name: "Aurora", price: 0, lvl: 15, cols: ["#3dffc8", "#b0fff0", "#2ad0ff"], glow: "#3dffc8", desc: "Cortinas de luz verde agua que ondulan como una aurora boreal. Premio del nivel 15." },
  { slot: "flames", id: "perfecto", art: "stars", name: "Perfeccionista", price: 0, req: "sin-fallar", cols: ["#fff6d8", "#ffffff", "#ffe08a"], glow: "#f5c518", desc: "Una lluvia de estrellas doradas en cada nota. Premio por terminar una canción sin fallar." },
  { slot: "flames", id: "brasas", art: "embers", name: "Brasas", price: 0, req: "dia-3", streak: 3, cols: ["#c4161c", "#ff4a1a", "#6a0808"], desc: "Un lecho de carbones al rojo vivo que escupe brasas. Premio por tocar la canción del día 3 días seguidos." },
  { slot: "flames", id: "fogata", art: "campfire", name: "Fogata", price: 0, req: "gira-easy-bar", tour: "easy", cols: ["#ff8a1a", "#ffd04a", "#ff5a10"], desc: "Una fogata de verdad: llamas anchas y chispas que suben al aire. Premio de la gira en Fácil: supera el Bar La Cueva." },
  { slot: "flames", id: "supernova", art: "nova", name: "Supernova", price: 0, req: "gira-expert-bar", tour: "expert", cols: ["#e2c2ff", "#ffffff", "#a45bff"], glow: "#c77dff", desc: "Cada nota estalla en rayos y anillos violeta, como una estrella que explota. Premio de la gira en Experto: supera el Bar La Cueva." },
  // cuerdas y bordes
  { slot: "strings", id: "acero", name: "Acero", price: 0, sw: strings("#cfd4da", "#8f969e") },
  { slot: "strings", id: "cobre", name: "Cobre", price: 150, sw: strings("#e09050", "#b5652a") },
  { slot: "strings", id: "negras", name: "Negro mate", price: 150, sw: strings("#050505", "#4a4a5e", "linear-gradient(90deg, #3a2014, #5a3220 50%, #3a2014)") },
  { slot: "strings", id: "oro", name: "Doradas", price: 200, sw: strings("#f5c518", "#ffcf5a") },
  { slot: "strings", id: "hielo", name: "Hielo", price: 300, sw: strings("#eef3f6", "#5fe8ff") },
  { slot: "strings", id: "bronce", name: "Bronce", price: 0, lvl: 3, sw: strings("#d08a48", "#a8682e"), desc: "Cuerdas y bordes de bronce. Premio del nivel 3." },
  { slot: "strings", id: "cables", name: "Cables de colores", price: 0, req: "gira-medium-bar", tour: "medium", desc: "Cuerdas negras y bordes de cable rojo, azul y amarillo. Premio de la gira en Media: supera el Bar La Cueva.",
    sw: `linear-gradient(90deg, #ff3a3a 0 3%, #3a8aff 3% 5%, transparent 5% 95%, #ffd23a 95% 97%, #ff3a3a 97%), repeating-linear-gradient(90deg, transparent 0 9.2%, #3a3a40 9.2% 10.8%, transparent 10.8% 20%), linear-gradient(90deg, #24120b, #3a1d10 50%, #24120b)` },
  { slot: "strings", id: "neon", name: "Neón de colores", price: 500,
    sw: `linear-gradient(90deg, #ff4fa8 0 4%, transparent 4% 96%, #3fe8ff 96%), linear-gradient(90deg, transparent 9.2%, ${LANES[0]} 9.2% 10.8%, transparent 10.8% 29.2%, ${LANES[1]} 29.2% 30.8%, transparent 30.8% 49.2%, ${LANES[2]} 49.2% 50.8%, transparent 50.8% 69.2%, ${LANES[3]} 69.2% 70.8%, transparent 70.8% 89.2%, ${LANES[4]} 89.2% 90.8%, transparent 90.8%), linear-gradient(90deg, #1a0d14, #2a1420 50%, #1a0d14)` },
  // poder estrella
  { slot: "star", id: "azul", name: "Azul", price: 0, cols: ["#3fbfff"] },
  { slot: "star", id: "dorado", name: "Dorado", price: 300, cols: ["#f5c518"] },
  { slot: "star", id: "rosa", name: "Rosa", price: 300, cols: ["#ff5fb8"] },
  { slot: "star", id: "rojo", name: "Rojo", price: 300, cols: ["#ff3a30"] },
  { slot: "star", id: "verde", name: "Verde", price: 300, cols: ["#3aff7a"] },
  { slot: "star", id: "morado", name: "Morado", price: 300, cols: ["#b06bff"] },
  { slot: "star", id: "atardecer", name: "Atardecer", price: 0, lvl: 30, cols: ["#ff9a3a"], desc: "El poder estrella se vuelve naranja atardecer. Premio del nivel 30." },
  { slot: "star", id: "cian", name: "Neón cian", price: 0, req: "gira-medium-theater", tour: "medium", cols: ["#3dffe0"], desc: "El poder estrella en cian, como un letrero de neón. Premio de la gira en Media: supera El Gran Teatro." },
  { slot: "star", id: "blanca", name: "Estrella blanca", price: 0, req: "gira-expert-theater", tour: "expert", cols: ["#fff4e8"], desc: "El poder estrella al rojo blanco. Premio de la gira en Experto: supera El Gran Teatro." },
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
  { slot: "name", id: "heavy", name: "Heavy Metal", price: 0, req: "dia-14", streak: 14, desc: "Tu nombre en metal cromado con los cuernos arriba, en todas las clasificaciones. Premio por tocar la canción del día 14 días seguidos." },
  { slot: "name", id: "festival", name: "Festival", price: 0, req: "gira-hard-bar", tour: "hard", desc: "Tu nombre en los colores de un festival, con su pulsera. Premio de la gira en Difícil: supera el Bar La Cueva." },
  // rachas (the "¡Racha de 50!" pop-up)
  { slot: "streak", id: "clasica", name: "Clásica", price: 0 },
  { slot: "streak", id: "neon", name: "Neón", price: 250 },
  { slot: "streak", id: "fuego", name: "Fuego", price: 400 },
  { slot: "streak", id: "oro", name: "Oro", price: 600 },
  { slot: "streak", id: "arcoiris", name: "Arcoíris", price: 900 },
  { slot: "streak", id: "platino", name: "Platino", price: 0, lvl: 50, desc: "Rachas de platino con brillo morado. Premio del nivel 50." },
  { slot: "streak", id: "pirotecnia", name: "Pirotecnia", price: 0, req: "gira-hard-theater", tour: "hard", desc: "Las rachas estallan como fuegos artificiales. Premio de la gira en Difícil: supera El Gran Teatro." },
  // público (the lights in the crowd)
  { slot: "crowd", id: "encendedores", name: "Encendedores", price: 0, desc: "La llamita de un encendedor en alto en las partes tranquilas." },
  { slot: "crowd", id: "celulares", name: "Celulares", price: 150, desc: "Celulares de verdad en alto, grabando el concierto: en la pantalla se ve la tarima." },
  { slot: "crowd", id: "rojo", name: "Láseres", price: 200, desc: "Punteros láser rojos que barren el aire al ritmo de la canción." },
  { slot: "crowd", id: "barras", name: "Barras de neón", price: 300, desc: "Barras de luz de colores que el público agita en cada golpe." },
  { slot: "crowd", id: "luciernagas", name: "Luciérnagas", price: 350, desc: "Luciérnagas que vuelan sobre el público y se prenden al ritmo, en ola." },
  { slot: "crowd", id: "gatos", name: "Público de gatos", price: 500, desc: "Todo el público con orejas y cola de gato, que mueven al ritmo." },
  { slot: "crowd", id: "estrobos", name: "Estroboscopios", price: 0, req: "dia-7", streak: 7, desc: "Destellos blancos que encienden a todo el público en cada golpe, como en un concierto de verdad. Premio por tocar la canción del día 7 días seguidos." },
  { slot: "crowd", id: "bengalas", name: "Bengalas", price: 0, req: "gira-easy-theater", tour: "easy", desc: "El público prende bengalas que escupen chispas de verdad. Premio de la gira en Fácil: supera El Gran Teatro." },
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
