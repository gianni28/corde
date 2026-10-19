import "@fontsource/new-rocker/latin-400.css";
import "@fontsource/oswald/latin-500.css";
import "@fontsource/oswald/latin-600.css";
import "@fontsource/oswald/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import { createRenderer, LANE_HEX } from "./renderer.js";
import { DIFFS, midiToChart, chartTextToChart, parseIni, iniMeta, notesFor, sectionName } from "./chart.js";
import { decodeStems, Player, audioCtx, unlockAudio } from "./audio.js";
import { Game, STAR_READY } from "./game.js";
import { motionAvailable, motionNeedsPermission, motionReady, requestMotion, onLift, watchMotion, seen as motionSeen } from "./motion.js";
import { settings, save, resetKeys, deviceLanes, isTouchDevice, keyLabel } from "./settings.js";
import { accountMe, accountClaim, accountLink, accountSync, shopBuy, shopEquip, nameStyles, songRequest, myNotices, noticeSeen, noticeReply, myFulfilled, fulfilledSeen } from "./net.js";
import { shareCard, retoUrl, readReto } from "./share.js";
import { ACHIEVEMENTS, achievementsWon, unlock, mergeAchievements, forRun, forStreak, forMiau } from "./achievements.js";
import { online, listSongs, downloadSong, fileUrl, joinRoom, newRoomCode, adminCall, uploadSong, uploadStems, topScores, submitScore, generalBoard, dailyToday, dailyBoard, submitDaily, secretOpen, secretBoard, songById, fetchMiauProgress, roomDirectory } from "./net.js";
import { VENUES, TO_ENCORE, TOUR_PRIZES, TOUR_THEMES, prizesWon, savedTourDiffs, tourFor, progress as tourProgress, changes as tourChanges, nextSong as tourNextSong } from "./tour.js";
import { findSongs, convertSong, findMp3Songs, convertMp3Song, separateExisting } from "./admin.js";
import { fillDifficulties } from "./reduce.js";
import * as sfx from "./sfx.js";
import { energyCurve, energyAt } from "./energy.js";
import { createMenuMusic } from "./music.js";
import { SLOTS, STAGE_SLOTS, ITEMS, DEFAULTS as LOOK_DEFAULTS, itemOf, ownedKey, isDefault, resolveEquipped } from "./shop.js";
import { cssVars } from "./skins.js";

const $ = (id) => document.getElementById(id);
const LANE_CSS = ["--g", "--r", "--y", "--b", "--o"];
let touch = isTouchDevice();
document.documentElement.classList.toggle("touch", touch);
// iPhone scrolls the whole page to show a text field over the keyboard and leaves it there when the keyboard closes:
// every screen ends up shifted and taps land beside the buttons. The page never scrolls, so it goes back to the top.
document.addEventListener("focusout", (e) => {
  if (!e.target.matches?.("input, textarea")) return;
  setTimeout(() => { if (!document.activeElement?.matches?.("input, textarea")) window.scrollTo(0, 0); }, 60);
});
window.visualViewport?.addEventListener("resize", () => { if (!document.activeElement?.matches?.("input, textarea") && (window.scrollY || window.scrollX)) window.scrollTo(0, 0); });
// a PC with a touchscreen can look like a phone until the first key press: from then on it's a PC (keys, 5 lanes)
addEventListener("keydown", () => { if (touch && !isTouchDevice()) { touch = false; document.documentElement.classList.remove("touch"); } }, { capture: true, passive: true });

// iPhone: every tap/keypress re-asserts "music playback" so the silent switch doesn't mute the game.
// before the sound unlocks below: was the menu song already sounding (renderNowPlaying)?
let npArmed = false;
addEventListener("pointerdown", (e) => { const el = document.getElementById("nowPlaying"); npArmed = !!el?.contains(e.target) && !el.matches(".locked, .muted"); }, { capture: true, passive: true });
["pointerdown", "pointerup", "touchend", "keydown", "click"].forEach((t) => addEventListener(t, unlockAudio, { capture: true, passive: true }));

/* ================= renderer + attract mode ================= */
const canvas = $("stage");
// The stage can't be shown (no WebGL 2 here, a lost GPU, or every effect drew black): say why and what to do,
// instead of leaving a black stage behind the menus.
function gfxFail(why) {
  const fix = "Actualiza el navegador o, en Chrome, activa «Usar aceleración de gráficos cuando esté disponible» (Configuración → Sistema) y reinícialo.";
  $("gfxFailMsg").textContent = why === "lost" ? "Se perdió la conexión con la tarjeta de video. Recarga la página para volver a ver el escenario."
    : why === "no3d" ? `Este navegador no puede mostrar gráficos 3D, así que no se ve el escenario ni se puede tocar. ${fix}`
    : `Tu navegador no está mostrando los gráficos del juego. ${fix}`;
  $("gfxFail").hidden = false;
}
$("gfxFailClose").onclick = () => ($("gfxFail").hidden = true);
let R;
try { R = createRenderer(canvas); }
catch (e) {
  // no WebGL 2 (an old Mac, a blocked GPU, hardware acceleration off): the menus still work, and the player learns why
  console.error("Corde: no 3D:", e);
  R = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => 0) });
  gfxFail("no3d");
}
addEventListener("resize", () => R.resize());

const demo = (() => {
  const a = []; let t = 0;
  const pat = [0, 1, 2, 1, 0, 2, 3, 2, [0, 2], 1, 3, 4, [1, 3], 2, 0, 4];
  for (let i = 0; i < 2000; i++) {
    const p = pat[i % pat.length];
    (Array.isArray(p) ? p : [p]).forEach((l) => a.push({ t, lane: l, dur: i % 16 === 11 ? 0.6 : 0, state: 0, holding: false }));
    t += i % 8 === 7 ? 0.5 : 0.25;
  }
  const beats = []; for (let b = 0; b < t; b += 0.5) beats.push([b, Math.round(b * 2) % 8 === 0 ? 1 : 0]);
  return { notes: a, beats };
})();
let demoNext = 0;
const attract = { notes: null };

/* ================= app state ================= */
const app = {
  screen: "home", history: [], mode: "solo",
  songs: [], song: null, chart: null, decoded: null, diff: null,
  game: null, paused: false,
  room: null, me: null, peers: [], rivals: {}, finals: {}, roomConfig: null, loadedSongId: null,
  wallet: null, // the account's púas and looks: { picks, owned: Set of "slot:id", equipped: { slot: id } } (null: no account)
};

/* ================= your look (bought in the shop) ================= */
// What this player has on: the neck, the gems, the flames… kept in this browser too, so the stage looks right from
// the very first frame (offline, or before the account answers). The account's wallet replaces it when it arrives.
const EQUIP_KEY = "corde.equipped.v1";
let equipped = (() => { try { return resolveEquipped(JSON.parse(localStorage.getItem(EQUIP_KEY) || "null")); } catch { return resolveEquipped(null); } })();
const DEFAULT_STAR = "#3fbfff";
let starHex = DEFAULT_STAR; // star power's colour in the HUD (the multiplier's ring)
const stageLook = (eq) => Object.fromEntries(STAGE_SLOTS.map((s) => [s, eq[s]]));
const hexRgb = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [63, 191, 255]; };
// Puts a look on: the 3D stage, the lane and star colours of the HUD, and the streak pop-up's style.
function applyLook(eq = equipped) {
  R.setSkin?.(stageLook(eq));
  const root = document.documentElement.style, vars = cssVars(eq) || {};
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  starHex = /^#[0-9a-f]{6}$/i.test(vars["--star"] || "") ? vars["--star"] : DEFAULT_STAR;
  // the star meter's glows: see-through and light versions of that colour (unset = today's blue, exactly)
  if (starHex.toLowerCase() === DEFAULT_STAR) for (const k of ["--star-rgb", "--star-hi", "--star-fill"]) root.removeProperty(k);
  else {
    const [r, g, b] = hexRgb(starHex), hi = [r, g, b].map((c) => Math.round(c + (255 - c) * 0.55));
    root.setProperty("--star-rgb", `${r}, ${g}, ${b}`);
    root.setProperty("--star-hi", `rgb(${hi.join(", ")})`);
    root.setProperty("--star-fill", starHex);
  }
  const body = document.body.classList;
  for (const c of [...body]) if (c.startsWith("streak-")) body.remove(c);
  if (eq.streak !== LOOK_DEFAULTS.streak) body.add("streak-" + eq.streak);
}
applyLook(); // before the first frame and before any network

/* ---------- styled names on the boards ---------- */
// A name style bought in the shop is seen by everyone: every board, list and room shows that name with its class
// (nm-<style>). The names themselves are always plain text.
const nameStyle = new Map(); // name key → style
let nameStylesAt = 0;
// the server's key for a name: lowercase, no accents, single spaces
const nameKey = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
function styleOfKey(k) {
  if (app.wallet && k && k === nameKey(settings.name)) return equipped.name; // yours changes the moment you put it on
  const st = nameStyle.get(k);
  return st && itemOf("name", st) ? st : "normal";
}
function setNameClass(el, st) {
  for (const c of [...el.classList]) if (c.startsWith("nm-")) el.classList.remove(c);
  if (st && st !== "normal") el.classList.add("nm-" + st);
}
// and their level, a tag after the name (players with an account): "NV 7", slanted so it never reads as a position
const nameLevel = new Map(); // name key → level
function levelOfKey(k) {
  if (app.wallet && k && k === nameKey(settings.name)) return app.wallet.level;
  return nameLevel.get(k) || 0;
}
function setNameLevel(el, lv) {
  let b = el.querySelector(":scope > .lv");
  if (!(lv > 0)) { b?.remove(); return; }
  if (!b) { b = document.createElement("span"); el.append(b); }
  b.innerHTML = `<i>NV</i>${lv}`; b.title = `Nivel ${lv}`;
  b.className = `lv t${Math.min(3, Math.floor(lv / 10))}`; // bronze, silver, gold, purple
}
function styledName(el, name) { el.dataset.nk = nameKey(name); setNameClass(el, styleOfKey(el.dataset.nk)); setNameLevel(el, levelOfKey(el.dataset.nk)); }
const restyleNames = () => document.querySelectorAll("[data-nk]").forEach((el) => { setNameClass(el, styleOfKey(el.dataset.nk)); setNameLevel(el, levelOfKey(el.dataset.nk)); });
// refreshed with the home board, at most once a minute
async function loadNameStyles(force = false) {
  if (!online || (!force && Date.now() - nameStylesAt < 60000)) return;
  nameStylesAt = Date.now();
  let rows;
  try { rows = await nameStyles(); } catch (e) { console.warn("name styles:", e.message); nameStylesAt = 0; return; }
  nameStyle.clear(); nameLevel.clear();
  for (const r of rows) {
    if (r?.name_key && r.style) nameStyle.set(r.name_key, r.style);
    if (r?.name_key && r.level > 0) nameLevel.set(r.name_key, Math.floor(r.level));
  }
  restyleNames();
}
// the shop screen: the category open, the item picked (shown on the stage behind), a purchase waiting for "¿Seguro?"
const shop = { cat: "neck", sel: null, armed: null, armT: 0, streakT: 0, busy: false, preview: false, seq: 0 };

/* ================= menu music ================= */
// A random library song plays while the menus are up (title and artist top right on a wide screen, under the
// menu on a phone). It stops when a song starts and picks up again back in the menus.
const MENU_MUSIC = ["home", "library", "setup", "settings", "logros", "mp", "lobby", "admin", "tutorial", "duo", "daily", "tour", "tienda"];
const wideMQ = matchMedia("(min-width: 1000px)");
// admin uploads (declared up here: the menu music and the frame loop ask about them from the first moment)
const adm = { songs: [], busy: false, groups: [] };
const split = { on: false, stop: false, rows: [] }; // the library's songs whose guitar is being separated
const notices = { queue: [], current: null, asked: false }; // the admin's messages waiting for this player (see checkNotices)
let previewing = null, previewLoading = null; // the song list's ▶ (see previewSong): up here, the menu music asks from the start
const mp = { fx: { terremoto: 0, niebla: 0, apagon: 0, turbo: 0 }, on: "", lastPos: 0, posAt: 0, bannerT: 0 }; // multiplayer battle (see launchAttack)
const PUBLIC_MAX = 4, dir = { ch: null, list: [], last: "" }; // the open rooms (see syncDir): up here, show() keeps it in step
// while the admin uploads or separates songs, the stage and the menu music rest (they'd take the processor from it)
function adminWorking() { return adm.busy || split.on; }
function adminWorkChanged() { syncMenuMusic(); }
const music = createMenuMusic({ onChange: () => { renderNowPlaying(); if (typeof markPreview === "function") markPreview(); } });
// It starts as soon as the page opens: a random song is fetched right away and plays the moment the browser
// allows sound. Chrome allows it straight away on sites you use a lot and in the installed app; otherwise the first
// touch, click or key starts it (already loaded, so instantly), with a "touch to listen" hint until then.
function syncMenuMusic() {
  if (MENU_MUSIC.includes(app.screen) && !app.game && !document.hidden && !adminWorking()) music.play(); else music.pause();
  renderNowPlaying();
}
let npSong = null;
function renderNowPlaying() {
  const el = $("nowPlaying"), info = music.info(), wide = wideMQ.matches;
  // a wide screen has it fixed in the corner; a phone has it in the home menu, under the buttons
  if (wide && el.parentElement !== document.body) document.body.insertBefore(el, $("toast"));
  if (!wide && el.parentElement === document.body) document.querySelector("#s-home .menu").after(el);
  el.classList.toggle("fixed", wide);
  el.classList.toggle("muted", info.muted);
  // the browser hasn't allowed sound yet: the song is ready, one touch away
  const blocked = info.blocked && !info.muted;
  el.classList.toggle("locked", blocked);
  const roomy = app.screen === "home" || innerWidth >= 1400; // beside a centred panel only when it can't overlap it
  const onMenu = MENU_MUSIC.includes(app.screen) && !app.game && roomy;
  el.hidden = !online || !(info.muted || ((info.playing || blocked) && info.song)) || (wide && !onMenu);
  if (info.song && info.song !== npSong) {
    npSong = info.song;
    $("npTitle").textContent = info.song.name;
    const cov = coverOf(info.song);
    $("npCov").classList.toggle("nocov", !cov); $("npCover").hidden = !cov; if (cov) $("npCover").src = cov;
  }
  const sub = blocked ? (touch ? "Toca la pantalla para escucharla" : "Haz clic o presiona una tecla para escucharla") : info.song?.artist || "";
  if ($("npArtist").textContent !== sub) $("npArtist").textContent = sub;
  $("npMute").setAttribute("aria-pressed", String(info.muted));
}
$("npMute").onclick = () => { if (music.info().blocked) return; settings.menuMusic = music.muted; save(); music.setMuted(!music.muted); syncMenuMusic(); };
$("npSkip").onclick = () => { if (!music.info().blocked) music.skip(); };
// the song playing is one touch from playing it: the setup screen, as if picked in the library
// (the touch that lets the browser play sound only does that: it'd be a surprise to leave the menu with it. The sound
// starts with that touch, so whether it was already on is read as the finger goes down, before anything else: npArmed)
$("nowPlaying").addEventListener("click", (e) => {
  const info = music.info(), armed = npArmed;
  npArmed = false;
  if (e.target.closest(".np-btn") || !armed || !info.song || info.muted) return;
  const s = app.songs.find((x) => x.id === info.song.id) || info.song;
  app.mode = "solo"; try { sfx.click(); } catch {}
  pickLibrarySong(s);
});
wideMQ.addEventListener?.("change", renderNowPlaying);
addEventListener("resize", () => renderNowPlaying());
document.addEventListener("visibilitychange", () => syncMenuMusic());
music.setMuted(settings.menuMusic === false);

/* ================= navigation ================= */
const SCREENS = ["home", "library", "setup", "settings", "logros", "mp", "lobby", "pause", "results", "loading", "admin", "tutorial", "duo", "daily", "tour", "tienda"];
let motionTest = null; // the movement test in Settings, while it runs
function show(name, push = true) {
  const transient = ["pause", "loading", "play", "results"];
  if (push && !transient.includes(name)) {
    const from = transient.includes(app.screen) ? app.stable : app.screen;
    if (from && from !== name) app.history.push(from);
  }
  if (!transient.includes(name)) app.stable = name;
  app.screen = name;
  SCREENS.forEach((s) => ($("s-" + s).hidden = s !== name));
  $("hud").hidden = !(app.game && ["play", "pause", "settings"].includes(name));
  if (name === "play") $("hud").hidden = false;
  if (name === "home") { renderHomeBoard(); renderDailyCard(); if (online && !daily.day) loadDaily(); }
  if (name !== "settings") stopMotionTest();
  if (notices.queue.length && !notices.current) setTimeout(showNextNotice, 400);
  if (name !== "tienda") endShopPreview(); // leaving the shop any way at all puts back what you have on
  // the stage behind: the tour's venues in the tour and its songs, the usual bar everywhere else
  const look = name === "tour" ? tourLook
    : ["play", "pause", "results"].includes(name) || app.game ? (app.ctx?.kind === "tour" ? app.ctx.stage : "bar")
    : name === "loading" ? null : "bar";
  if (look) R.setStage?.(look);
  syncMenuMusic();
  syncDir();
}
function back() {
  if (app.screen === "settings" && app.settingsFromPause) { backToPause(); return; }
  const prev = app.history.pop() || "home";
  if (app.screen === "library" && app.mode === "pick") { app.mode = "mp"; show("lobby", false); return; }
  show(prev, false);
}
document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = back));
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
  if (b.dataset.mode) app.mode = b.dataset.mode;
  const to = b.dataset.go;
  if (to === "library") openLibrary();
  else if (to === "settings") { renderSettings(); show("settings"); }
  else if (to === "tour") openTour();
  else if (to === "logros") { renderLogros(); show("logros"); }
  else if (to === "tienda") openShop();
  else if (to === "mp") { $("mpName").value = settings.name || ""; $("mpErr").hidden = true; $("duoCard").hidden = $("duoOr").hidden = touch; show("mp"); }
}));

// every menu button gives a little pick sound (lower for "Volver"); nothing while playing
document.addEventListener("click", (e) => {
  if (app.screen === "play") return;
  const b = e.target.closest("#ui button, #ui label.btn");
  if (!b || b.disabled || b.classList.contains("np-btn")) return;
  try { b.matches("[data-back]") ? sfx.back() : sfx.click(); } catch {}
});

let toastT;
function toast(msg, ms = 3200) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
function loading(label, p) { $("loadLabel").textContent = label; $("loadBar").style.width = Math.round((p || 0) * 100) + "%"; }

// ?debug exposes the app to automated tests (never needed by players)
if (new URLSearchParams(location.search).has("debug")) window.__corde = { app, R, music };

/* ================= home ================= */
// Installing the game as an app: full screen, no browser bars, an icon on the home screen.
let installEvt = null;
const standalone = () => matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || navigator.standalone === true;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
addEventListener("appinstalled", () => { installEvt = null; $("installBtn").hidden = true; });
$("installBtn").onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch {}
  installEvt = null; $("installBtn").hidden = true;
};
// iPhone has no install button: a one-line how-to, only in Safari on a phone
// iPhone (and Android when Chrome doesn't offer its own install): "Descargar app" opens the steps to add it to the home screen
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent), isAndroid = /Android/i.test(navigator.userAgent);
$("installIos").hidden = !(touch && isIOS && !standalone());
$("iosSteps").hidden = !isIOS; $("androidSteps").hidden = isIOS;
// Android: Chrome's one-tap install shows up within a moment; if it doesn't, the guide does
if (touch && isAndroid && !standalone()) setTimeout(() => { if (!installEvt && !standalone()) $("installIos").hidden = false; }, 2500);
addEventListener("beforeinstallprompt", () => { if (isAndroid) $("installIos").hidden = true; });
$("installIos").onclick = () => { $("iosModal").hidden = false; $("iosDone").focus(); };
$("iosDone").onclick = () => { $("iosModal").hidden = true; };
$("iosModal").onclick = (e) => { if (e.target === e.currentTarget) $("iosModal").hidden = true; };
$("homeFoot").textContent = online ? "Biblioteca en línea" : "Modo local · conecta Supabase para la biblioteca y el multijugador";

// General board, every string count together: "total" = sum of each player's best per song,
// "best" = each player's best single run. Everyone, in a list that scrolls.
let homeTab = "total", homeReq = 0;
async function renderHomeBoard() {
  const el = $("homeBoard");
  if (!online) { el.hidden = true; return; }
  el.querySelectorAll("#homeTabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === homeTab)));
  const req = ++homeReq;
  let rows;
  try { rows = await generalBoard(homeTab, undefined, settings.boardPeriod); }
  catch (e) { console.warn("leaderboard:", e.message); return; }
  if (req !== homeReq) return;
  loadNameStyles();
  const me = (settings.name || "").trim().toLowerCase();
  const ol = el.querySelector(".board-list"); ol.innerHTML = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (me && r.name.trim().toLowerCase() === me) li.className = "me";
    li.innerHTML = `<span class="pos">${i + 1}</span><span class="n"><span class="nm"></span>${homeTab === "best" ? "<small></small>" : ""}</span><span class="s"></span>`;
    li.querySelector(".nm").textContent = r.name;
    styledName(li.querySelector(".nm"), r.name);
    if (homeTab === "best") li.querySelector("small").textContent = r.song;
    li.querySelector(".s").textContent = Number(homeTab === "total" ? r.total : r.score).toLocaleString("es-CO");
    ol.appendChild(li);
  });
  const empty = el.querySelector(".board-empty");
  empty.hidden = rows.length > 0;
  empty.textContent = settings.boardPeriod === "week" ? "Nadie ha jugado esta semana. ¡Sé el primero!" : "Todavía nadie ha jugado.";
  el.hidden = false;
  scrollToMe(ol);
}
$("homeTabs").onclick = (e) => { const b = e.target.closest("button"); if (!b || b.dataset.v === homeTab) return; homeTab = b.dataset.v; renderHomeBoard(); };
renderHomeBoard();
// the library list is needed for the menu music right away (it's small).
// It starts on the next microtask, once this whole file has run: loadLibrary() reads secretList() and other
// constants declared further down, and calling it right here threw silently (no songs, no menu music).
Promise.resolve().then(() => {
  if (!online) return;
  loadLibrary()
    .then((list) => { if (!app.songs.length) app.songs = list; music.setSongs(list.filter((s) => !s.secret)); syncMenuMusic(); backfillAchievements(); queueMiauIntro(); refreshMiau(); })
    .catch((e) => console.warn("library:", e.message))
    .finally(() => loadDaily());
});

/* ================= personal bests ================= */
// Your best run of each song and difficulty, kept in this browser: stars in the song list and on the difficulty
// buttons, and a "new personal best" on the results.
const BEST_KEY = "corde.best.v1";
let bests = {};
try { bests = JSON.parse(localStorage.getItem(BEST_KEY) || "{}") || {}; } catch {}
const bestOf = (songId, diff) => bests[songId]?.[diff] || null;
/** Saves the run if it beats the old best. Returns the old best (null if there was none) and whether this one beat it. */
function recordBest(songId, diff, sum) {
  if (!songId || songId === "local" || sum.failed || !(sum.score > 0)) return { old: bestOf(songId, diff), beat: false };
  const old = bestOf(songId, diff);
  const beat = !old || sum.score > old.score;
  if (beat) {
    (bests[songId] ||= {})[diff] = { score: sum.score, stars: sum.stars, acc: Math.round(sum.acc * 1000) / 1000, at: Date.now() };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch {}
  }
  return { old, beat };
}
// what the song list shows: your stars on the hardest difficulty you've played
// the miau songs' accuracies on the boards (any device): the kittens' challenge counts them with this browser's bests
const MIAU_BEST_KEY = "corde.miau.best.v1";
let miauBests = {};
try { miauBests = JSON.parse(localStorage.getItem(MIAU_BEST_KEY) || "{}") || {}; } catch {}
function recordMiauBest(songId, acc) {
  if (!(acc > (miauBests[songId] || 0))) return;
  miauBests[songId] = Math.round(acc * 1000) / 1000;
  try { localStorage.setItem(MIAU_BEST_KEY, JSON.stringify(miauBests)); } catch {}
}
// the best accuracy on a song, any difficulty (0: never finished)
const bestAcc = (songId) => Math.max(miauBests[songId] || 0, ...Object.values(bests[songId] || {}).map((x) => (x && x.score > 0 ? x.acc || 0 : 0)));
// the miau songs this browser has (they come with a secret code): the kittens' logro and prize are only for them
const miauIds = () => app.songs.filter((s) => s.miau).map((s) => s.id);
const knowsMiau = () => app.songs.some((s) => s.miau) || !!achievementsWon()["coro-gatitos"];
function songBest(songId) {
  const b = bests[songId]; if (!b) return null;
  let top = null;
  for (const d of DIFFS) if (b[d.key]) top = { ...b[d.key], diff: d };
  return top;
}
const starsHtml = (n) => "★".repeat(n) + `<span class="off">${"★".repeat(5 - n)}</span>`;

/* ================= library ================= */
const fmtLen = (ms) => { if (!ms) return ""; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const coverOf = (s) => (s.has_cover ? fileUrl(s.id, "cover.jpg") : "");

/* ---------------- secret songs ---------------- */
// Songs the admin hid, in groups: each secret code opens its own group, and only that one. Five taps on the little
// pick at the bottom of the song list ask for a code, and with it the database hands out that group's songs (it never
// sends them otherwise). Each group gets its own tab (named by the admin); the codes stay in this browser until
// "Esconder estas canciones". They never join the tour, the song of the day, the menu music or the home boards.
// A song's `secret` is its group's id (false for the library).
const SECRET_KEY = "corde.secret.v1"; // before the groups: one code
const SECRETS_KEY = "corde.secrets.v2"; // [{ code, id, name }] (id 0: a code from v1, its group not asked yet)
function secretList() {
  try {
    const v = JSON.parse(localStorage.getItem(SECRETS_KEY) || "null");
    if (Array.isArray(v)) return v.filter((x) => x && typeof x.code === "string" && x.code);
    const old = localStorage.getItem(SECRET_KEY);
    return old ? [{ code: old, id: 0, name: "Secretas" }] : [];
  } catch { return []; }
}
function saveSecrets(list) { try { localStorage.setItem(SECRETS_KEY, JSON.stringify(list)); localStorage.removeItem(SECRET_KEY); } catch {} }
const secretGroups = () => secretList().filter((x) => x.id > 0);
const codeOfGroup = (id) => secretList().find((x) => x.id === id)?.code || "";
const publicSongs = () => app.songs.filter((s) => !s.secret);
const inTab = (s, tab = app.libTab) => (tab === "all" ? !s.secret : s.secret === tab);
app.libTab = "all"; // "all" | a group's id
// The library: the public songs, plus each group this browser has the code of
async function loadLibrary() {
  const keys = secretList();
  const [pub, ...groups] = await Promise.all([
    listSongs(),
    ...keys.map((k) => secretOpen(k.code).catch((e) => (e.wrongCode ? { wrong: true } : null))),
  ]);
  const next = [], out = [...pub];
  keys.forEach((k, i) => {
    const g = groups[i];
    if (g?.wrong) return; // the admin changed that code: it's forgotten
    // the code is fine but its songs didn't come (connection): keep the ones we had
    if (!g) { next.push(k); out.push(...app.songs.filter((x) => x.secret && x.secret === k.id)); return; }
    if (next.some((x) => x.id === g.id)) return; // two codes of the same group (one was changed)
    next.push({ code: k.code, id: g.id, name: g.name });
    out.push(...g.songs.map((x) => ({ ...x, secret: g.id })));
  });
  let v1 = false; try { v1 = !!localStorage.getItem(SECRET_KEY); } catch {}
  if (v1 || JSON.stringify(next) !== JSON.stringify(keys)) saveSecrets(next);
  if (app.libTab !== "all" && !next.some((x) => x.id === app.libTab)) app.libTab = "all";
  return out;
}
// the player hid a group again
function lockSecret(id) {
  saveSecrets(secretList().filter((x) => x.id !== id));
  app.songs = app.songs.filter((x) => x.secret !== id);
  app.libTab = "all";
}
function openSecret() {
  $("secretInput").value = ""; $("secretMsg").textContent = "";
  $("secretModal").hidden = false;
  setTimeout(() => $("secretInput").focus(), 60);
}
const closeSecret = () => { $("secretModal").hidden = true; };
let pickTaps = 0, pickAt = 0;
$("secretPick").onclick = () => {
  const now = performance.now();
  pickTaps = now - pickAt < 1200 ? pickTaps + 1 : 1; pickAt = now;
  const el = $("secretPick");
  el.classList.remove("wiggle"); void el.offsetWidth;
  if (pickTaps >= 3 && pickTaps < 5) el.classList.add("wiggle"); // something's there…
  if (pickTaps >= 5) { pickTaps = 0; openSecret(); }
};
$("secretPick").addEventListener("animationend", (e) => e.currentTarget.classList.remove("wiggle")); // back to hiding
$("secretCancel").onclick = closeSecret;
$("secretModal").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSecret(); } });
$("secretModal").addEventListener("click", (e) => { if (e.target === $("secretModal")) closeSecret(); });
$("secretForm").onsubmit = async (e) => {
  e.preventDefault();
  const code = $("secretInput").value.trim();
  if (!code || !online) return;
  const go = $("secretGo"), form = $("secretForm");
  go.disabled = true; $("secretMsg").textContent = "Revisando…";
  try {
    const g = await secretOpen(code);
    const known = secretGroups().some((x) => x.id === g.id);
    saveSecrets([...secretList().filter((x) => x.id !== g.id && x.code.toLowerCase() !== code.toLowerCase()), { code, id: g.id, name: g.name }]);
    app.songs = [...app.songs.filter((x) => x.secret !== g.id), ...g.songs.map((x) => ({ ...x, secret: g.id }))];
    closeSecret();
    app.libTab = g.id; renderSongs(); $("songList").scrollTop = 0;
    if (known) return; // already open: just its tab
    sfx.unlock();
    const n = g.songs.length;
    if (g.songs.some((x) => x.miau)) { queueMiauIntro(3200); refreshMiau(); } // after the celebration
    celebrate({ kicker: "Código correcto", title: g.name, kind: "secret", ms: 2800,
      sub: n ? `${n} ${n === 1 ? "canción desbloqueada" : "canciones desbloqueadas"}. Las encuentras en «${g.name}».` : "Ya quedaron desbloqueadas, aunque todavía no hay ninguna." });
  } catch (err) {
    $("secretMsg").textContent = err.wrongCode ? "Ese no es. Intenta otra vez." : "No pude revisar el código. ¿Hay conexión?";
    form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
    $("secretInput").select();
  } finally { go.disabled = false; }
};
$("libTabs").onclick = (e) => {
  const b = e.target.closest("button[data-t]");
  if (!b) return;
  const t = b.dataset.t === "all" ? "all" : Number(b.dataset.t);
  if (t === app.libTab) return;
  app.libTab = t; renderSongs(); $("songList").scrollTop = 0;
};
$("secretLock").onclick = () => {
  const g = secretGroups().find((x) => x.id === app.libTab);
  if (!g || !confirm(`¿Esconder otra vez «${g.name}»? Para verlas de nuevo hay que escribir su código.`)) return;
  lockSecret(g.id); renderSongs();
};
// a song by id: the library, or (a secret song a friend picked in a room) straight from the database
app.extraSongs = [];
const knownSong = (id) => app.songs.find((x) => x.id === id) || app.extraSongs.find((x) => x.id === id) || null;
async function findSong(id) {
  if (knownSong(id)) return knownSong(id);
  try { app.songs = await loadLibrary(); } catch {}
  if (knownSong(id)) return knownSong(id);
  try { const r = await songById(id); if (r) app.extraSongs.push({ ...r, secret: r.hidden ? r.secret_group || -1 : false }); } catch {}
  return knownSong(id);
}

async function openLibrary() {
  $("libTitle").textContent = app.mode === "pick" ? "Elige la canción" : app.mode === "duo" ? "2 jugadores" : "Canciones";
  $("localFolderBtn").hidden = touch;
  $("randomBox").hidden = !online || app.mode === "pick";
  $("randomDiffs").hidden = true; $("randomBtn").setAttribute("aria-expanded", "false");
  show("library");
  renderSongs();
  if (!online) return;
  if (!app.songs.length) {
    $("songList").innerHTML = `<p class="empty">Cargando biblioteca…</p>`;
    try { app.songs = await loadLibrary(); renderSongs(); }
    catch (e) { $("songList").innerHTML = `<p class="empty">${e.message}</p>`; }
    return;
  }
  // refresh quietly so new songs and re-uploads (offsets, charts) show up without reloading the page
  try {
    const fresh = await loadLibrary();
    if (JSON.stringify(fresh) === JSON.stringify(app.songs)) return;
    const was = app.songs.find((x) => x.id === app.loadedSongId);
    const now = fresh.find((x) => x.id === app.loadedSongId);
    if (!now || JSON.stringify(was) !== JSON.stringify(now)) app.loadedSongId = null;
    app.songs = fresh;
    if (app.screen === "library") renderSongs();
  } catch {}
  refreshMiau();
}
function renderSongs() {
  const box = $("songList");
  if (!online) { box.innerHTML = `<p class="empty">La biblioteca en línea aparece cuando el juego está conectado a Supabase.<br>Mientras tanto puedes tocar canciones desde tu dispositivo.</p>`; return; }
  // each secret group gets its own tab once this browser knows its code
  const groups = secretGroups();
  if (!groups.some((x) => x.id === app.libTab)) app.libTab = "all";
  const secretTab = app.libTab !== "all";
  // the kittens' group (it has the miau songs): a cat face instead of the pick, and its own colour
  const catGroup = (id) => app.songs.some((s) => s.secret === id && s.miau);
  const tabs = $("libTabs");
  tabs.hidden = !groups.length;
  tabs.innerHTML = `<button data-t="all">Biblioteca</button>` + groups.map((g) => `<button data-t="${g.id}"${catGroup(g.id) ? ` class="cat"` : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${catGroup(g.id) ? "catface" : "pick"}"/></svg><span></span></button>`).join("");
  groups.forEach((g, i) => (tabs.querySelectorAll("span")[i].textContent = g.name));
  tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === String(app.libTab))));
  $("secretLock").hidden = !secretTab;
  $("s-library").classList.toggle("secret-tab", secretTab);
  $("s-library").classList.toggle("cat-tab", secretTab && catGroup(app.libTab));
  const q = $("libSearch").value.trim().toLowerCase();
  const tab = app.songs.filter((s) => inTab(s));
  const list = tab.filter((s) => !q || `${s.name} ${s.artist}`.toLowerCase().includes(q));
  if (!list.length) {
    box.innerHTML = `<p class="empty">${tab.length ? "Nada coincide con tu búsqueda." : secretTab ? "Todavía no hay canciones secretas." : "Todavía no hay canciones en la biblioteca."}</p>`;
    return;
  }
  box.innerHTML = "";
  // the kittens' challenge, on top of the tab that has the miau songs
  if (secretTab && tab.some((s) => s.miau)) {
    const p = miauProgress(), card = document.createElement("div");
    card.className = "reto-card";
    card.innerHTML = `<div class="reto-prog">${catsHtml(p)}</div><div><b>Reto · Coro de gatitos</b><small></small></div>${p.won ? `<button type="button">Tienda</button>` : ""}`;
    card.querySelector("small").textContent = p.won ? "¡Superado! Ponte las notas Gatitos en la Tienda." : `Saca 80% o más en ${p.need} ${p.need === 1 ? "canción miau" : "canciones miau"}. Llevas ${p.done}.`;
    const go = card.querySelector("button"); if (go) go.onclick = () => openShopAt("gems", "gatitos");
    box.appendChild(card);
  }
  for (const s of list) {
    const b = document.createElement("button");
    b.className = "song" + (s.secret ? " secret" : "") + (s.secret && catGroup(s.secret) ? " cat" : "");
    const cov = coverOf(s);
    const best = songBest(s.id);
    b.innerHTML = `<span class="cov">${cov ? `<img loading="lazy" alt="" src="${cov}">` : `<div class="ph"></div>`}<span class="song-play" role="button" tabindex="0" aria-label="Escuchar"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="pl" d="M8 5.5v13l11-6.5z"/><path class="st" d="M7 7h10v10H7z"/></svg></span></span><span><span class="t"></span><span class="a"></span></span>`
      + `<span class="len">${best ? `<span class="best" title="Tu mejor: ${best.diff.name}">${starsHtml(best.stars)}<small>${best.diff.name}</small></span>` : ""}${fmtLen(s.duration_ms)}</span>`;
    b.querySelector(".t").textContent = s.name;
    b.querySelector(".a").textContent = s.artist || "";
    b.onclick = () => pickLibrarySong(s);
    const pl = b.querySelector(".song-play");
    pl.dataset.id = s.id;
    pl.onclick = (e) => { e.stopPropagation(); previewSong(s); };
    pl.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); previewSong(s); } };
    box.appendChild(b);
  }
}
$("libSearch").oninput = renderSongs;
// ▶ on a cover: listen to the song's chorus before picking it (the menu music switches to it); ■ stops it
async function previewSong(s) {
  unlockAudio();
  if (previewing === s.id || previewLoading === s.id) { previewing = previewLoading = null; music.stopSong(); markPreview(); return; }
  previewLoading = s.id; markPreview();
  try { if (await music.playSong(s)) previewing = s.id; }
  catch (e) { toast("No se pudo cargar la canción para escucharla."); }
  if (previewLoading === s.id) previewLoading = null;
  markPreview();
}
function markPreview() {
  const now = music.info();
  if (previewing && !(now.song && now.song.id === previewing && now.playing)) previewing = null; // it ended or was replaced
  document.querySelectorAll(".song-play").forEach((el) => {
    el.classList.toggle("on", el.dataset.id === previewing);
    el.classList.toggle("loading", el.dataset.id === previewLoading);
    el.setAttribute("aria-label", el.dataset.id === previewing ? "Detener" : "Escuchar");
  });
}

// Random song: pick the difficulty, then a random song that has it starts right away (never the same one twice in a row).
// The same box is in the library and on the results screen.
function randomBox(btn, diffs, fromResults) {
  $(btn).onclick = () => {
    if (app.mode === "duo" || (fromResults && app.duo)) return randomDuoSong(); // two players: their difficulties are on their screen
    const open = $(diffs).hidden;
    $(diffs).hidden = !open; $(btn).setAttribute("aria-expanded", String(open));
    if (open && fromResults) $(diffs).scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  $(diffs).onclick = async (e) => {
    const b = e.target.closest("button[data-d]");
    if (!b || app.loadingRandom) return;
    const diff = b.dataset.d;
    if (!app.songs.length) { try { app.songs = await loadLibrary(); } catch {} }
    // from the tab you're in: a group's secret songs only from its own tab
    const has = app.songs.filter((s) => (s.diffs?.[diff]?.n || 0) > 0 && inTab(s));
    const pool = has.length > 1 ? has.filter((s) => s.id !== app.lastRandomId && s.id !== app.song?.id) : has;
    if (!pool.length) return;
    const s = pool[Math.floor(Math.random() * pool.length)];
    app.lastRandomId = s.id; app.loadingRandom = true;
    $(diffs).hidden = true; $(btn).setAttribute("aria-expanded", "false");
    if (fromResults) { app.mode = "solo"; app.history = ["home", "library"]; }
    try {
      await loadLibrarySong(s);
      settings.lastDiff = diff; save();
      openSetup(); // so "Salir" from the pause lands on this song's screen
      withTutorial(() => startGame({ lanes: deviceLanes(), diff: app.diff, ctx: dailyCtxFor(app.song, "setup") }));
    } catch (err) { toast(err.message); show("library", false); }
    finally { app.loadingRandom = false; }
  };
}
randomBox("randomBtn", "randomDiffs", false);
randomBox("resRandomBtn", "resRandomDiffs", true);

async function pickLibrarySong(s) {
  if (app.mode === "pick") { // host choosing for the room: the song, or one song of the cup's setlist
    const cfg = app.roomConfig || {}, plan = cfg.plan, slot = app.pickSlot;
    app.pickSlot = null;
    if (plan && slot != null) {
      const songs = [...plan.songs]; songs[slot] = s.id;
      setRoomConfig({ plan: { ...plan, songs }, ...(slot === plan.idx ? { songId: s.id, at: Date.now() } : {}) });
    } else setRoomConfig({ songId: s.id, diff: cfg.diff || "medium", at: Date.now() });
    app.mode = "mp"; show("lobby", false);
    return;
  }
  try {
    await loadLibrarySong(s);
    openSongScreen();
  } catch (e) { toast(e.message); show("library", false); }
}

async function loadLibrarySong(s) {
  if (app.loadedSongId === s.id && app.decoded) { app.song = s; return; }
  show("loading");
  loading(`Descargando ${s.name}`, 0);
  const { chart, stems } = await downloadSong(s, (p) => loading(`Descargando ${s.name}`, p * 0.85));
  loading("Preparando audio", 0.9);
  audioCtx();
  app.decoded = null; app.loadedSongId = null; // a phone can't hold two decoded songs at once: the old one goes first
  app.decoded = await decodeStems(stems);
  app.chart = chart; app.song = s; app.loadedSongId = s.id;
  app.songOffsetMs = s.audio_offset_ms || 0;
  loading("Listo", 1);
}

/* local files */
async function loadLocal(fileList) {
  const files = [...fileList];
  const mid = files.find((f) => /\.midi?$/i.test(f.name));
  const cht = files.find((f) => /\.chart$/i.test(f.name));
  const ini = files.find((f) => /\.ini$/i.test(f.name));
  const img = files.find((f) => /^album\.(jpe?g|png)$/i.test(f.name)) || files.find((f) => /\.(jpe?g|png)$/i.test(f.name));
  const auds = files.filter((f) => /\.(opus|ogg|mp3|wav|m4a)$/i.test(f.name) && !/preview|crowd/i.test(f.name));
  if (!mid && !cht) return toast("Falta notes.mid o notes.chart.");
  if (!auds.length) return toast("Falta el audio (song.opus, guitar.opus…).");
  try {
    show("loading"); loading("Leyendo canción", 0.1);
    const iniData = ini ? parseIni(await ini.text()) : {};
    const meta = iniMeta(iniData);
    app.songOffsetMs = +iniData.delay || 0; // song.ini "delay": positive = notes later
    const chart = mid ? midiToChart(await mid.arrayBuffer(), meta) : chartTextToChart(await cht.text(), meta);
    fillDifficulties(chart);
    loading("Preparando audio", 0.4);
    audioCtx();
    const stems = await Promise.all(auds.map(async (f) => ({ name: f.name, guitar: /guitar/i.test(f.name), data: await f.arrayBuffer() })));
    app.decoded = await decodeStems(stems);
    app.chart = chart;
    app.song = { id: "local", name: chart.meta.name || (mid || cht).name, artist: chart.meta.artist || "", album: chart.meta.album, coverUrl: img ? URL.createObjectURL(img) : "" };
    app.loadedSongId = "local";
    openSongScreen();
  } catch (e) { toast(e.message); show("library", false); }
}
$("localFiles").onchange = (e) => loadLocal(e.target.files);

// Hidden feature for people who know Clone Hero: drop a song folder (or its files) onto the song list.
async function filesFromDrop(dt) {
  const entries = [...dt.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = (entry) => new Promise((res) => {
    if (entry.isFile) entry.file((f) => { out.push(f); res(); }, () => res());
    else if (entry.isDirectory) {
      const reader = entry.createReader(), all = [];
      const next = () => reader.readEntries(async (batch) => {
        if (!batch.length) { for (const e of all) await walk(e); res(); }
        else { all.push(...batch); next(); }
      }, () => res());
      next();
    } else res();
  });
  for (const e of entries) await walk(e);
  return out;
}
addEventListener("dragover", (e) => { if (app.screen === "library" && app.mode !== "pick") e.preventDefault(); });
addEventListener("drop", async (e) => {
  if (app.screen !== "library" || app.mode === "pick") return;
  e.preventDefault();
  const files = await filesFromDrop(e.dataTransfer);
  if (files.length) loadLocal(files);
});
$("localFolder").onchange = (e) => loadLocal(e.target.files);

/* ================= difficulty chips ================= */
function renderDiffChips(box, chart, lanes, current, onPick, disabled = false) {
  box.innerHTML = "";
  for (const d of DIFFS) {
    const ns = notesFor(chart, d.key, lanes);
    const used = [...new Set(ns.map((n) => n.lane))].sort();
    const b = document.createElement("button");
    b.className = "diff"; b.type = "button";
    b.disabled = disabled || !ns.length;
    b.setAttribute("aria-pressed", d.key === current);
    const best = app.song && bestOf(app.song.id, d.key);
    b.innerHTML = `${d.name}<span class="dots">${used.map((l) => `<i style="background:var(${LANE_CSS[l]})"></i>`).join("")}</span><small>${ns.length} notas</small>`
      + (best ? `<span class="best" title="Tu mejor: ${best.score.toLocaleString("es-CO")}">${starsHtml(best.stars)}</span>` : "");
    b.onclick = () => onPick(d.key);
    box.appendChild(b);
  }
}
function defaultDiff(chart, lanes) {
  const pref = settings.lastDiff || (lanes === 4 ? "medium" : "hard");
  return notesFor(chart, pref, lanes).length ? pref : DIFFS.map((d) => d.key).find((k) => notesFor(chart, k, lanes).length);
}

/* ================= setup (solo) ================= */
// after picking a song: its screen for one player, or the one for two players on this PC
function openSongScreen() { app.mode === "duo" ? openDuoSetup() : openSetup(); }
function openSetup() {
  const s = app.song, lanes = deviceLanes();
  $("setupName").textContent = s.name;
  $("setupArtist").textContent = [s.artist, s.album].filter(Boolean).join(" · ");
  const cov = s.coverUrl || coverOf(s);
  $("setupCover").hidden = !cov; if (cov) $("setupCover").src = cov;
  app.diff = defaultDiff(app.chart, lanes);
  // opened from a challenge link: its difficulty, and the score to beat on top
  if (app.reto && app.reto.songId !== s.id) app.reto = null;
  const reto = app.reto;
  if (reto && notesFor(app.chart, reto.diff, lanes).length) app.diff = reto.diff;
  $("retoBox").hidden = !reto;
  if (reto) $("retoMsg").textContent = `${reto.name || "Alguien"} sacó ${reto.score.toLocaleString("es-CO")} en ${DIFFS.find((d) => d.key === reto.diff).name}. ¿Le ganas?`;
  app.boardLanes = lanes;
  const draw = () => { renderDiffChips($("setupDiffs"), app.chart, lanes, app.diff, (k) => { app.diff = k; settings.lastDiff = k; save(); draw(); }); showBoard($("setupBoard")); };
  draw();
  const keys = settings.keys.slice(0, lanes).map(keyLabel).join(" ");
  const starHow = touch ? (liftOn() ? "Poder estrella: actívalo levantando o sacudiendo el celular, como una guitarra." : "Toca el multiplicador para activar el poder estrella.") : `${keyLabel(settings.starKey)} activa el poder estrella.`;
  $("setupHint").textContent = touch
    ? `Juegas con ${lanes} cuerdas. Toca la columna de cada color cuando la nota llegue a los botones y mantén el dedo en las notas largas. ${starHow}`
    : `Juegas con ${lanes} cuerdas: ${keys}. Presiona cuando la nota llegue a los botones y mantén en las largas. ${keyLabel(settings.pauseKey)} o Esc para pausar. ${starHow}`;
  $("practiceBox").hidden = true; $("practiceBtn").setAttribute("aria-expanded", "false");
  show("setup");
}
$("playBtn").onclick = () => withTutorial(() => startGame({ lanes: deviceLanes(), diff: app.diff, ctx: dailyCtxFor(app.song, "setup") }));

/* ---------- practice one part ---------- */
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
// The parts of a song for the chosen difficulty: its sections (or ~25 s chunks when the chart has none).
function practiceParts() {
  const notes = notesFor(app.chart, app.diff, deviceLanes());
  if (!notes.length) return [];
  const last = notes[notes.length - 1].t + notes[notes.length - 1].dur;
  let starts = (app.chart.sections || []).map(([t, n], i) => ({ t, name: sectionName(n, i), i }));
  if (starts.length < 2) {
    starts = [];
    for (let t = notes[0].t, i = 0; t < last; t += 25, i++) starts.push({ t: i ? t : 0, name: sectionName("", i) });
  }
  const parts = [];
  starts.forEach((s, i) => {
    const to = i + 1 < starts.length ? starts[i + 1].t - 0.05 : last + 0.5;
    const n = notes.filter((x) => x.t >= s.t - 0.01 && x.t <= to).length;
    if (n >= 4) parts.push({ from: s.t, to, name: s.name, i: s.i });
  });
  return parts;
}
$("practiceBtn").onclick = () => {
  const box = $("practiceBox"), open = box.hidden;
  if (open) {
    const ol = $("practiceParts"); ol.innerHTML = "";
    for (const p of practiceParts()) {
      const li = document.createElement("li"), b = document.createElement("button");
      b.innerHTML = `<span class="n"></span><span class="tm">${mmss(p.from)}</span>`;
      b.querySelector(".n").textContent = p.name;
      b.onclick = () => withTutorial(() => startGame({ lanes: deviceLanes(), diff: app.diff, practice: p }));
      li.appendChild(b); ol.appendChild(li);
    }
  }
  box.hidden = !open; $("practiceBtn").setAttribute("aria-expanded", String(open));
  if (open) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

/* ================= two players on one PC ================= */
// Each guitar's keys are kept by their place on the keyboard (e.code): the key right of L is Ñ on a Spanish
// keyboard and ; on an English one, and the game shows whichever is printed on this one.
let layoutMap = null;
try { navigator.keyboard?.getLayoutMap?.().then((m) => { layoutMap = m; if (app.screen === "duo") renderDuo(); }).catch(() => {}); } catch {}
const CODE_NAMES = { Space: "Espacio", Enter: "Enter", ShiftLeft: "Shift izq.", ShiftRight: "Shift der.", ControlLeft: "Ctrl izq.", ControlRight: "Ctrl der.",
  AltLeft: "Alt", AltRight: "Alt Gr", Tab: "Tab", CapsLock: "Mayús", Backspace: "Borrar", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Semicolon: "Ñ" };
function codeLabel(code) {
  if (CODE_NAMES[code] && !/^Semicolon$/.test(code)) return CODE_NAMES[code];
  const ch = layoutMap?.get(code) || settings.keyNames?.[code];
  if (ch && ch.trim()) return ch.toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return "Num " + code.slice(6);
  return CODE_NAMES[code] || code;
}
const STAR_SLOT = 5; // each player's keys: 5 frets, then star power
function duoKey(code) {
  for (let p = 0; p < 2; p++) { const i = settings.duoKeys[p].indexOf(code); if (i >= 0) return { p, i }; }
  return null;
}
let duoRebind = null; // { p, i } while waiting for a key
function finishDuoRebind(e) {
  const { p, i } = duoRebind; duoRebind = null;
  const code = e.code;
  if (code && e.key !== "Escape") {
    // a key already in use swaps places with the old one, so two buttons never share a key
    const was = duoKey(code), old = settings.duoKeys[p][i];
    if (was) settings.duoKeys[was.p][was.i] = old;
    settings.duoKeys[p][i] = code;
    if (e.key && e.key.length === 1 && e.key.trim()) (settings.keyNames ||= {})[code] = e.key.toUpperCase();
    save();
  }
  renderDuo();
}
const duoNames = () => settings.duoNames.map((n, k) => (n || "").trim() || `Jugador ${k + 1}`);
function openDuoSetup() {
  const s = app.song;
  $("duoSong").textContent = s.name;
  $("duoArtist").textContent = [s.artist, s.album].filter(Boolean).join(" · ");
  const cov = s.coverUrl || coverOf(s);
  $("duoCover").hidden = !cov; if (cov) $("duoCover").src = cov;
  // each player keeps the difficulty they chose last time, when this song has it
  app.duoDiffs = settings.duoDiffs.map((d) => (notesFor(app.chart, d, 5).length ? d : defaultDiff(app.chart, 5)));
  duoRebind = null;
  renderDuo();
  show("duo");
}
function renderDuo() {
  document.querySelectorAll("#s-duo .duo-col").forEach((col) => {
    const p = +col.dataset.p;
    const name = col.querySelector(".duo-name");
    if (document.activeElement !== name) name.value = duoNames()[p];
    name.oninput = () => { settings.duoNames[p] = name.value.slice(0, 16); save(); };
    name.onfocus = () => name.select();
    name.onkeydown = (e) => { if (e.key === "Enter") name.blur(); };
    name.onblur = () => { name.value = duoNames()[p]; };
    renderDiffChips(col.querySelector(".duo-diffs"), app.chart, 5, app.duoDiffs[p], (k) => { app.duoDiffs[p] = k; settings.duoDiffs[p] = k; save(); renderDuo(); });
    const box = col.querySelector(".duo-keys"); box.innerHTML = "";
    const caps = document.createElement("div"); caps.className = "keycaps";
    settings.duoKeys[p].slice(0, 5).forEach((code, i) => {
      const b = document.createElement("button");
      const wait = duoRebind && duoRebind.p === p && duoRebind.i === i;
      b.className = "keycap" + (wait ? " listening" : "");
      b.style.setProperty("--c", `var(${LANE_CSS[i]})`);
      b.textContent = wait ? "…" : codeLabel(code);
      b.setAttribute("aria-label", `Jugador ${p + 1}, cuerda ${i + 1}: ${codeLabel(code)}`);
      b.onclick = () => { duoRebind = { p, i }; renderDuo(); };
      caps.appendChild(b);
    });
    const waitStar = duoRebind && duoRebind.p === p && duoRebind.i === STAR_SLOT;
    const star = document.createElement("button");
    star.className = "duo-star" + (waitStar ? " listening" : "");
    star.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg><span>Poder estrella</span><b></b>`;
    star.querySelector("b").textContent = waitStar ? "…" : codeLabel(settings.duoKeys[p][STAR_SLOT]);
    star.onclick = () => { duoRebind = { p, i: STAR_SLOT }; renderDuo(); };
    box.append(caps, star);
  });
  $("duoHint").textContent = duoRebind
    ? "Presiona la tecla nueva (Esc para cancelar). Si ya la usa otro botón, se intercambian."
    : "Toca un botón para cambiar su tecla. Esc pausa. Algunos teclados no registran muchas teclas apretadas a la vez: si a alguien se le pierden notas en acordes, prueben teclas más separadas.";
}
$("duoBtn").onclick = () => { app.mode = "duo"; openLibrary(); };
$("duoPlay").onclick = () => {
  duoRebind = null;
  startGame({ lanes: 5, diff: app.duoDiffs[0], duo: { diffs: [...app.duoDiffs], names: duoNames() } });
};

function finishDuo() {
  const gs = games(), duo = app.duo;
  const sums = gs.map((g) => g.summary());
  app.game.player.stop();
  keepLearnedSync(syncTeacher());
  app.game = null; app.duoGames = null;
  R.setPlayers(1); R.setLanes(5); R.setHype(0.5);
  try { app.wake?.release(); } catch {}
  const best = Math.max(...sums.map((x) => x.score));
  const winners = sums.map((x, k) => (x.score === best ? k : -1)).filter((k) => k >= 0);
  $("duoWinner").textContent = winners.length > 1 ? "¡Empate!" : `¡Gana ${duo.names[winners[0]]}!`;
  $("duoResSong").textContent = [app.song.name, app.song.artist].filter(Boolean).join(" · ");
  const cols = $("duoResCols"); cols.innerHTML = "";
  sums.forEach((x, k) => {
    const c = document.createElement("div");
    c.className = `duo-res-col p${k + 1}` + (winners.length === 1 && winners[0] === k ? " win" : "");
    c.innerHTML = `<div class="nm"></div><span class="label">${DIFFS.find((d) => d.key === duo.diffs[k]).name}</span>
      <div class="sc">${x.score.toLocaleString("es-CO")}</div>
      <div class="stars">${"★".repeat(x.stars)}<span class="off">${"★".repeat(5 - x.stars)}</span></div>
      <dl><dt>Notas</dt><dd>${x.hits}/${x.total}</dd><dt>Precisión</dt><dd>${Math.round(x.acc * 100)}%</dd><dt>Mejor racha</dt><dd>${x.maxCombo}</dd><dt>Poder estrella</dt><dd>${x.starUses}</dd></dl>`;
    c.querySelector(".nm").textContent = duo.names[k];
    cols.appendChild(c);
  });
  sfx.finale(Math.max(...sums.map((x) => x.stars)));
  $("resFail").hidden = true; $("soloRes").hidden = true; $("duoRes").hidden = false;
  $("shareBtn").hidden = true;
  $("retoLine").hidden = true; $("picksRes").hidden = true; picksRun++;
  $("againBtn").hidden = false; $("againBtn").classList.add("primary"); $("otherSongBtn").hidden = false; $("menuBtn").textContent = "Menú";
  $("resRandomBox").hidden = !online;
  show("results");
}
// a random song for two players: from the tab you're in, straight to the two-player screen (each keeps their difficulty)
async function randomDuoSong() {
  if (app.loadingRandom) return;
  if (!app.songs.length) { try { app.songs = await loadLibrary(); } catch {} }
  const has = app.songs.filter((s) => inTab(s) && Object.values(s.diffs || {}).some((d) => d?.n > 0));
  const pool = has.length > 1 ? has.filter((s) => s.id !== app.lastRandomId && s.id !== app.song?.id) : has;
  if (!pool.length) return;
  const s = pool[Math.floor(Math.random() * pool.length)];
  app.lastRandomId = s.id; app.loadingRandom = true;
  app.mode = "duo";
  if (app.screen === "results") { app.duo = null; app.history = ["home", "mp"]; }
  try { await loadLibrarySong(s); openDuoSetup(); }
  catch (err) { toast(err.message); show("library", false); }
  finally { app.loadingRandom = false; }
}
$("duoRandom").onclick = randomDuoSong;
$("otherSongBtn").onclick = () => { app.mode = "duo"; openLibrary(); app.history = ["home", "mp"]; };

/* ================= song of the day ================= */
// The same song for everyone each day (Colombia's calendar; the server picks it), with a board of the day per
// difficulty and strings. Your streak of days in a row is kept in this browser (and shared with its other tabs).
const DAILY_KEY = "corde.daily.v1";
const readDailyLog = () => { try { const d = JSON.parse(localStorage.getItem(DAILY_KEY) || "{}"); return Array.isArray(d?.days) ? d.days : []; } catch { return []; } };
let dailyLog = { days: readDailyLog() };
// boards: "diff:lanes" → { rows, total, mine } | "error" (missing while loading)
const daily = { day: null, songId: null, diff: null, boards: {}, loading: null, offset: 0, retryAt: 0 };
// the server's clock: a phone with its clock off still counts down to the real midnight
const serverNow = () => Date.now() + daily.offset;
const dayShift = (day, k) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
// a new song at midnight in Colombia (UTC−5 all year)
const dailyEnds = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d + 1, 5); };
const hms = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((x) => String(x).padStart(2, "0")).join(":"); };
const dailySong = () => (daily.songId && app.songs.find((s) => s.id === daily.songId)) || null;
function dailyStreak(today = daily.day) {
  if (!today) return 0;
  const set = new Set(dailyLog.days);
  let d = set.has(today) ? today : dayShift(today, -1), n = 0;
  while (set.has(d)) { n++; d = dayShift(d, -1); }
  return n;
}
// today's song played from the song list also counts for the day (via: where to go back to afterwards)
function dailyCtxFor(song, via = null) {
  return daily.day && song?.id === daily.songId && serverNow() < dailyEnds(daily.day) ? { kind: "daily", day: daily.day, songId: song.id, via } : null;
}
// another tab (or the installed app) may have added days since this page loaded: merge, never overwrite
function markDailyPlayed(day) {
  const days = new Set([...readDailyLog(), ...dailyLog.days]);
  const fresh = !days.has(day);
  days.add(day);
  dailyLog.days = [...days].sort().slice(-400);
  try { localStorage.setItem(DAILY_KEY, JSON.stringify({ days: dailyLog.days })); } catch {}
  return fresh;
}
addEventListener("storage", (e) => {
  if (e.key !== DAILY_KEY) return;
  dailyLog.days = [...new Set([...readDailyLog(), ...dailyLog.days])].sort();
  renderDailyCard();
  if (app.screen === "daily") renderDaily();
});
function loadDaily(force = false) {
  if (!online) return Promise.resolve(null);
  if (!force && daily.day && serverNow() < dailyEnds(daily.day)) return Promise.resolve(daily);
  if (daily.loading) return daily.loading;
  daily.loading = (async () => {
    try {
      const t0 = Date.now();
      const r = await dailyToday();
      if (!r?.song_id) return null;
      if (Number.isFinite(r.now)) daily.offset = r.now - (t0 + Date.now()) / 2;
      if (r.day !== daily.day || r.song_id !== daily.songId) daily.boards = {};
      daily.day = r.day; daily.songId = r.song_id;
      // a song uploaded today may not be in the list we have yet
      if (!app.songs.some((s) => s.id === r.song_id)) { try { app.songs = await loadLibrary(); } catch {} }
      renderDailyCard();
      return daily;
    } catch (e) { console.warn("daily:", e.message); return null; }
    finally { daily.loading = null; }
  })();
  return daily.loading;
}
// a network blip at launch must not hide the song of the day for the whole session
addEventListener("online", () => loadDaily(true));
function renderDailyCard() {
  const s = dailySong(), el = $("dailyCard");
  el.hidden = !s;
  if (!s) return;
  const cov = coverOf(s);
  $("dcCover").hidden = !cov; if (cov) $("dcCover").src = cov;
  $("dcName").textContent = s.name; $("dcArtist").textContent = s.artist || "";
  const st = dailyStreak(), played = dailyLog.days.includes(daily.day);
  $("dcStreak").hidden = !st; $("dcStreak").querySelector("b").textContent = st;
  $("dcStreak").title = `${st} ${st === 1 ? "día seguido" : "días seguidos"}`;
  el.classList.toggle("played", played);
  $("dcState").textContent = played ? "Ya la tocaste hoy · ¿mejoras tu puesto?" : st ? "¡Tócala hoy para no perder tu racha!" : "Una canción nueva cada día";
  tickDaily();
}
// the countdowns (home card and daily screen); at midnight the new song comes in by itself
function tickDaily() {
  const now = serverNow();
  if (!daily.day) { // not loaded yet (or the first try failed): keep trying now and then
    if (online && now >= daily.retryAt && !daily.loading) { daily.retryAt = now + 30000; loadDaily(); }
    return;
  }
  const left = dailyEnds(daily.day) - now;
  const txt = hms(left);
  if ($("dcTime").textContent !== txt) $("dcTime").textContent = txt;
  if (app.screen === "daily" && $("dailyTime").textContent !== txt) $("dailyTime").textContent = txt;
  if (left <= 0 && !daily.loading && now >= daily.retryAt) {
    const was = daily.day;
    loadDaily(true).then(() => {
      if (daily.day === was) daily.retryAt = serverNow() + 15000; // the server isn't there yet: don't ask every second
      if (app.screen === "daily") { renderDaily(); refreshDailyBoard(); }
    });
  }
}
setInterval(tickDaily, 1000);
$("dailyCard").onclick = () => openDaily();

async function openDaily(push = true) {
  $("dailyErr").hidden = true;
  show("daily", push);
  // always ask: the day may have changed, or today's pick may have been replaced
  const d = await loadDaily(true);
  if (app.screen !== "daily") return;
  if (!d || !dailySong()) {
    $("dailyErr").textContent = online ? "No se pudo cargar la canción del día. Revisa tu conexión." : "La canción del día necesita la biblioteca en línea.";
    $("dailyErr").hidden = false;
    return;
  }
  renderDaily();
  refreshDailyBoard();
}
const fmtDay = (day) => new Date(day + "T12:00:00Z").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
// the board a run goes to: the strings really used (a 5-string run of a chart without the 5th string is a 4-string run)
const boardLanes = (s, diff, lanes = deviceLanes()) => (lanes === 5 && (s?.diffs?.[diff]?.lanes || [4]).includes(4) ? 5 : 4);
const usesFifth = (s, diff) => (s?.diffs?.[diff]?.lanes || []).includes(4);
function renderDaily() {
  const s = dailySong(); if (!s) return;
  const lanes = deviceLanes();
  $("dailySong").textContent = s.name;
  $("dailyArtist").textContent = [s.artist, s.album].filter(Boolean).join(" · ");
  $("dailyDate").textContent = fmtDay(daily.day);
  const cov = coverOf(s);
  $("dailyCover").hidden = !cov; if (cov) $("dailyCover").src = cov;
  // streak: the number and the last seven days
  const st = dailyStreak(), played = dailyLog.days.includes(daily.day);
  $("dailyStreak").textContent = st;
  $("dailyStreakLabel").textContent = st === 1 ? "día seguido" : "días seguidos";
  $("dailyStreakBox").classList.toggle("hot", st > 0);
  const week = $("dailyWeek"); week.innerHTML = "";
  for (let k = 6; k >= 0; k--) {
    const d = dayShift(daily.day, -k), li = document.createElement("li");
    li.className = (dailyLog.days.includes(d) ? "on" : "") + (k === 0 ? " today" : "");
    li.textContent = "DLMXJVS"[new Date(d + "T12:00:00Z").getUTCDay()]; // X for miércoles, as in Spanish calendars
    li.title = fmtDay(d);
    week.appendChild(li);
  }
  renderStreakPrizes(st);
  // difficulty: from the library row (nothing is downloaded until you play)
  const has = (k) => (s.diffs?.[k]?.n || 0) > 0;
  const pref = settings.lastDiff || (lanes === 4 ? "medium" : "hard");
  if (!daily.diff || !has(daily.diff)) daily.diff = has(pref) ? pref : DIFFS.map((d) => d.key).find(has);
  const box = $("dailyDiffs"); box.innerHTML = "";
  for (const d of DIFFS) {
    const n = s.diffs?.[d.key]?.n || 0;
    const used = (s.diffs?.[d.key]?.lanes || []).filter((l) => l < lanes);
    const b = document.createElement("button");
    b.className = "diff"; b.type = "button"; b.disabled = !n;
    b.setAttribute("aria-pressed", d.key === daily.diff);
    b.innerHTML = `${d.name}<span class="dots">${used.map((l) => `<i style="background:var(${LANE_CSS[l]})"></i>`).join("")}</span><small>${n} notas</small>`;
    b.onclick = () => { daily.diff = d.key; renderDaily(); refreshDailyBoard(); };
    box.appendChild(b);
  }
  $("dailyPlay").textContent = played ? "Tocar otra vez" : "Tocar";
  tickDaily();
}
const boardKey = () => `${daily.diff}:${boardLanes(dailySong(), daily.diff)}`;
// the board of the chosen difficulty: everyone, how many played, and your place
async function refreshDailyBoard() {
  const s = dailySong(); if (!s || !daily.diff) return;
  const key = boardKey(), day = daily.day, [diff, lanes] = [daily.diff, boardLanes(s, daily.diff)];
  delete daily.boards[key];
  if (app.screen === "daily") renderDailyBoard();
  try {
    const b = await dailyBoard({ day, songId: s.id, diff, lanes, me: (settings.name || "").trim().toLowerCase() });
    if (day === daily.day) daily.boards[key] = b;
  } catch (e) { console.warn("daily board:", e.message); if (day === daily.day) daily.boards[key] = "error"; }
  if (app.screen === "daily" && key === boardKey()) renderDailyBoard();
}
function renderDailyBoard() {
  const b = daily.boards[boardKey()], s = dailySong();
  const ol = $("dailyBoard").querySelector(".board-list"); ol.innerHTML = "";
  const empty = $("dailyBoard").querySelector(".board-empty");
  const me = (settings.name || "").trim().toLowerCase();
  const name = DIFFS.find((d) => d.key === daily.diff)?.name || "";
  const strings = usesFifth(s, daily.diff) ? ` · ${boardLanes(s, daily.diff)} cuerdas` : "";
  $("dailyMe").hidden = true;
  if (!b || b === "error") {
    $("dailyCount").textContent = b ? "" : "Cargando…";
    empty.hidden = b !== "error";
    empty.innerHTML = b === "error" ? `No se pudo cargar la clasificación. <button class="link" type="button">Reintentar</button>` : "";
    if (b === "error") empty.querySelector("button").onclick = refreshDailyBoard;
    return;
  }
  b.rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (me && r.name.trim().toLowerCase() === me) li.className = "me";
    const acc = Math.round(Math.min(1, Math.max(0, +r.acc || 0)) * 100);
    li.innerHTML = `<span class="pos">${i + 1}</span><span class="n"></span><span class="a">${acc}%</span><span class="s">${r.score.toLocaleString("es-CO")}</span>`;
    li.querySelector(".n").textContent = r.name;
    styledName(li.querySelector(".n"), r.name);
    ol.appendChild(li);
  });
  empty.hidden = b.rows.length > 0;
  empty.textContent = "Nadie ha tocado esta dificultad hoy. ¡Sé el primero!";
  $("dailyCount").textContent = `${b.total} ${b.total === 1 ? "jugador" : "jugadores"} hoy en ${name}${strings}`;
  scrollToMe(ol);
  if (b.mine && b.mine.rank > b.rows.length) { $("dailyMe").textContent = `Tu puesto: #${b.mine.rank} con ${b.mine.score.toLocaleString("es-CO")}`; $("dailyMe").hidden = false; }
}
$("dailyPlay").onclick = async () => {
  const s = dailySong(); if (!s || !daily.day) return;
  const ctx = { kind: "daily", day: daily.day, songId: s.id };
  try { await loadLibrarySong(s); } catch (e) { toast(e.message); show("daily", false); return; }
  const lanes = deviceLanes();
  const diff = notesFor(app.chart, daily.diff, lanes).length ? daily.diff : defaultDiff(app.chart, lanes);
  settings.lastDiff = diff; save();
  withTutorial(() => startGame({ lanes, diff, ctx }));
};
async function sendDaily(sum, ctx, diff, lanes) {
  const el = $("dailyRank"), run = picksRun;
  el.textContent = "Guardando en la clasificación del día…";
  try {
    const r = await submitDaily({ day: ctx.day, song_id: ctx.songId, diff, lanes, name: settings.name, secret: playerSecret(),
      score: sum.score, acc: sum.acc, max_combo: sum.maxCombo, stars: sum.stars });
    // the day's bonus (once a day): next to the place on the day's board
    if (r.picks) gotPicks(r.picks, run, false);
    if (run !== picksRun) return;
    const bonus = +r.picks?.earned || 0;
    $("dailyPicks").hidden = !(bonus > 0);
    if (bonus > 0) $("dailyPicks").querySelector("span").textContent = `+${fmtPicks(bonus)} púas por tocar la canción del día`;
    const s = app.songs.find((x) => x.id === ctx.songId);
    const dn = DIFFS.find((d) => d.key === diff).name + (usesFifth(s, diff) ? ` (${r.lanes} cuerdas)` : "");
    el.textContent = `Puesto #${r.rank} de ${r.players} hoy en ${dn}` + (r.newRecord ? "" : ` · tu mejor de hoy: ${r.best.toLocaleString("es-CO")}`);
    daily.boards = {};
  } catch (e) { el.textContent = /Espera/.test(e.message) ? e.message : "No se pudo guardar en la clasificación del día."; console.warn("daily:", e.message); }
}

// the song of the day's streak prizes: what each one is, how many days it takes, how close you are
const STREAK_PRIZES = ITEMS.filter((it) => it.streak).sort((a, b) => a.streak - b.streak);
function renderStreakPrizes(st) {
  const box = $("streakPrizes"); box.innerHTML = "";
  const won = achievementsWon();
  for (const it of STREAK_PRIZES) {
    const got = !!won[it.req], b = document.createElement("button");
    b.type = "button"; b.className = "tour-prize streak-card" + (got ? " won" : "");
    b.innerHTML = `<span class="sc-days"><b>${it.streak}</b>días</span><span class="sw"></span><span class="tp-text"><b></b><small></small></span><span class="sc-bar"><i style="width:${Math.min(100, (st / it.streak) * 100)}%"></i></span>`;
    fillSwatch(b.querySelector(".sw"), it);
    b.querySelector(".tp-text b").textContent = it.name;
    const left = it.streak - st;
    b.querySelector("small").textContent = got ? "¡Ganado! Tócalo para ponértelo" : left === 1 ? "¡Te falta 1 día!" : `Te faltan ${left} días`;
    b.onclick = () => openShopAt(it.slot, it.id);
    box.appendChild(b);
  }
}

/* ================= tour ================= */
let tourDiff = settings.tourDiff || "medium";
let tourOpen = null;   // the venue unfolded in the list
let tourLook = "bar";  // the stage shown behind the tour screen: the venue you're looking at
const tourNow = () => { const t = tourFor(tourDiff, publicSongs()); return t && { tour: t, prog: tourProgress(t, bestOf) }; };
async function openTour(push = true) {
  tourOpen = null; tourLook = "bar"; // renderTour picks the venue as soon as the list is there
  show("tour", push);
  if (online && !app.songs.length) {
    $("tourList").innerHTML = `<p class="empty">Cargando la biblioteca…</p>`;
    try { app.songs = await loadLibrary(); } catch (e) { $("tourList").innerHTML = `<p class="empty">${e.message}</p>`; return; }
  }
  if (app.screen === "tour") renderTour();
}
document.querySelectorAll("#tourDiffs button").forEach((b) => (b.onclick = () => {
  tourDiff = b.dataset.d; settings.tourDiff = tourDiff; save(); tourOpen = null; renderTour();
}));
function renderTour() {
  document.querySelectorAll("#tourDiffs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.d === tourDiff)));
  const list = $("tourList"), tp = tourNow();
  if (!tp) {
    list.innerHTML = `<p class="empty">${online ? "La gira necesita al menos 12 canciones con esta dificultad en la biblioteca." : "La gira usa la biblioteca en línea: conecta el juego a Supabase."}</p>`;
    $("tourStars").innerHTML = ""; $("tourRoad").innerHTML = ""; $("tourDone").hidden = true;
    tourLook = "bar"; if (app.screen === "tour") R.setStage?.("bar");
    return;
  }
  const { prog } = tp;
  if (tourOpen == null || (tourOpen >= 0 && !prog.venues[tourOpen]?.open)) tourOpen = prog.current;
  $("tourStars").innerHTML = `<span class="ts-star">★</span>${prog.stars}<small>/${prog.maxStars}</small>`;
  // the road: one stop per venue
  $("tourRoad").innerHTML = prog.venues.map((v, i) => `<i class="${v.complete ? "done" : v.open ? "open" : ""}${i === prog.current && !prog.done ? " here" : ""}${TOUR_PRIZES[tourDiff].some((p) => p.venue === i) ? " prize" : ""}"></i>`).join("");
  renderTourPrizes(prog);
  list.innerHTML = "";
  prog.venues.forEach((v, vi) => {
    const card = document.createElement("article");
    const expanded = vi === tourOpen && v.open;
    card.className = `venue v-${v.venue.id}` + (v.open ? " open" : " locked") + (v.complete ? " complete" : "") + (expanded ? " expanded" : "");
    const prize = TOUR_PRIZES[tourDiff].find((p) => p.venue === vi), prizeIt = prize && itemOf(prize.slot, prize.id);
    const status = (prizeIt ? `<span class="venue-prize${v.complete ? " won" : ""}">Premio: ${prizeIt.name}</span>` : "")
      + (v.complete ? `<span class="venue-done">Superado</span>` : v.open ? "" : `<svg class="venue-lock" aria-hidden="true"><use href="#lock"/></svg>`);
    card.innerHTML = `<button class="venue-head" ${v.open ? "" : "disabled"} aria-expanded="${expanded}">
        <span class="venue-num">${vi + 1}</span>
        <span class="venue-text"><b></b><small></small></span>
        <span class="venue-side">${status}<span class="venue-stars">★ ${v.stars}<small>/${v.maxStars}</small></span></span>
      </button>`;
    card.querySelector(".venue-text b").textContent = v.venue.name;
    card.querySelector(".venue-text small").textContent = v.open ? v.venue.blurb
      : vi > 0 ? `Supera el bis ${prog.venues[vi - 1].venue.of} para tocar aquí.` : "";
    card.querySelector(".venue-head").onclick = () => { if (!v.open) return; tourOpen = tourOpen === vi ? -1 : vi; renderTour(); };
    if (expanded) {
      const ol = document.createElement("ol"); ol.className = "setlist";
      v.songs.forEach((x, si) => {
        const encore = si === v.songs.length - 1, locked = encore && !v.encoreOpen;
        const li = document.createElement("li");
        li.className = (encore ? "encore" : "") + (locked ? " locked" : "") + (x.cleared ? " cleared" : "");
        const cov = x.song && coverOf(x.song);
        li.innerHTML = `<button ${locked ? "disabled" : ""}>
          <span class="sl-num">${encore ? "Bis" : si + 1}</span>
          ${locked ? `<span class="ph locked-ph"><svg aria-hidden="true"><use href="#lock"/></svg></span>` : cov ? `<img loading="lazy" alt="" src="${cov}">` : `<span class="ph"></span>`}
          <span class="sl-text"><b></b><small></small></span>
          <span class="sl-stars">${x.cleared ? starsHtml(x.stars) : locked ? "" : `<span class="sl-new">Tocar</span>`}</span>
        </button>`;
        li.querySelector(".sl-text b").textContent = locked ? "???" : x.song.name;
        const need = Math.min(TO_ENCORE, v.set.length) - v.clearedSet;
        li.querySelector(".sl-text small").textContent = locked
          ? `Supera ${need} ${need === 1 ? "canción" : "canciones"}${v.clearedSet ? " más" : ""} y el público pedirá otra`
          : x.song.artist || "";
        if (!locked) li.querySelector("button").onclick = () => playTourSong(vi, si);
        ol.appendChild(li);
      });
      card.appendChild(ol);
    }
    list.appendChild(card);
  });
  // the stage behind the list is the venue you're looking at
  tourLook = VENUES[tourOpen >= 0 ? tourOpen : prog.current].stage;
  if (app.screen === "tour") R.setStage?.(tourLook);
  $("tourRoad").classList.toggle("done", prog.done);
  $("tourDone").hidden = !prog.done;
  document.querySelector(".tour-rules").hidden = prog.done;
  if (prog.done) {
    const next = DIFFS[DIFFS.findIndex((d) => d.key === tourDiff) + 1];
    $("tourDoneSub").textContent = prog.stars < prog.maxStars
      ? `★ ${prog.stars} de ${prog.maxStars}: vuelve a tocar para llevar cada canción a 5 estrellas${next ? `, o prueba la gira en ${next.name}` : ""}.`
      : `¡Las ${prog.maxStars} estrellas!${next ? ` ¿Te le mides a la gira en ${next.name}?` : " No queda nada más grande que esto."}`;
  }
}
// this difficulty's three prizes: what they are, where they're won, and "Ponérmelo" once they're yours
function renderTourPrizes(prog) {
  const box = $("tourPrizes"); box.innerHTML = "";
  $("tourTheme").textContent = `Premios · ${TOUR_THEMES[tourDiff]}`;
  for (const p of TOUR_PRIZES[tourDiff]) {
    const it = itemOf(p.slot, p.id); if (!it) continue;
    const won = !!achievementsWon()[`gira-${tourDiff}-${VENUES[p.venue].id}`];
    const b = document.createElement("button");
    b.type = "button"; b.className = "tour-prize" + (won ? " won" : "");
    b.innerHTML = `<span class="sw"></span><span class="tp-text"><b></b><small></small></span>`;
    fillSwatch(b.querySelector(".sw"), it);
    b.querySelector("b").textContent = it.name;
    b.querySelector("small").textContent = won ? "¡Ganado! Tócalo para ponértelo" : p.venue === VENUES.length - 1 ? "Al terminar la gira" : `Al superar ${VENUES[p.venue].name}`;
    b.onclick = () => openShopAt(p.slot, p.id);
    box.appendChild(b);
  }
}
async function playTourSong(vi, si, diff = tourDiff) {
  clearTimeout(app.celTimer);
  if (diff !== tourDiff) { tourDiff = diff; settings.tourDiff = diff; save(); }
  const tp = tourNow(); if (!tp) return;
  const v = tp.tour.venues[vi], s = v.songs[si], encore = si === v.songs.length - 1;
  const pv = tp.prog.venues[vi];
  if (!pv.open || (encore && !pv.encoreOpen)) return;
  const ctx = { kind: "tour", diff: tourDiff, venue: vi, song: si, encore, stage: v.stage, songId: s.id, before: tp.prog };
  R.setStage?.(v.stage);
  try { await loadLibrarySong(s); } catch (e) { toast(e.message); openTour(false); return; }
  const lanes = deviceLanes();
  if (!notesFor(app.chart, tourDiff, lanes).length) { toast("Esta canción no tiene notas en esta dificultad."); openTour(false); return; }
  const go = () => withTutorial(() => startGame({ lanes, diff: tourDiff, ctx }));
  if (encore) { sfx.encore(); celebrate({ kicker: v.name, title: "¡Otra! ¡Otra!", sub: `El público pide el bis: ${s.name}`, ms: 2600, kind: "encore", then: go }); }
  else go();
}
// "Otra vez" from the results: the same song, with the tour as it is now
function againCtx() {
  const c = app.ctx;
  if (c?.kind !== "tour") return c;
  const tp = tourFor(c.diff, publicSongs());
  return tp ? { ...c, before: tourProgress(tp, bestOf) } : c;
}
// What a finished run means for the song of the day and the tour; returns a celebration to show after the results.
function finishCtx(sum) {
  const ctx = app.ctx;
  $("againBtn").classList.add("primary");
  $("dailyRes").hidden = ctx?.kind !== "daily";
  $("tourRes").hidden = ctx?.kind !== "tour";
  $("dailyPicks").hidden = true;
  if (ctx?.kind === "daily") {
    // only a finished run counts for the streak (getting booed off doesn't)
    const counts = !sum.failed && sum.score > 0;
    const fresh = counts && markDailyPlayed(ctx.day), st = dailyStreak(ctx.day);
    $("dailyResStreak").textContent = !counts ? "No cuenta para tu racha: termina la canción."
      : st === 1 ? "Racha: 1 día · vuelve mañana para seguirla" : `Racha: ${st} días seguidos${fresh ? " · ¡sigue así!" : ""}`;
    if (sum.failed || !(sum.score > 0)) $("dailyRank").textContent = "Las canciones fallidas no entran a la clasificación del día.";
    else if (settings.name) sendDaily(sum, ctx, app.diff, app.lanes);
    else { $("dailyRank").textContent = "Escribe tu nombre para entrar a la clasificación del día."; app.pendingDaily = [sum, ctx, app.diff, app.lanes]; }
    renderDailyCard();
    return fresh && st > 1 ? () => { sfx.unlock(); celebrate({ kicker: "Canción del día", title: `¡${st} días seguidos!`, sub: "Vuelve mañana por una canción nueva.", ms: 2600, kind: "streak" }); } : null;
  }
  if (ctx?.kind !== "tour") return null;
  const t = tourFor(ctx.diff, publicSongs());
  const after = t && tourProgress(t, bestOf);
  if (!after) return null;
  const v = after.venues[ctx.venue];
  $("tourResVenue").textContent = `${v.venue.name} · ${ctx.encore ? "Bis" : `Canción ${ctx.song + 1} de ${v.set.length}`}`;
  const ch = tourChanges(ctx.before, after);
  const legend = ch.find((c) => c.kind === "legend"), venue = ch.find((c) => c.kind === "venue"), encore = ch.find((c) => c.kind === "encore");
  const counted = !sum.failed && sum.score > 0;
  $("tourResMsg").textContent = sum.failed ? "No cuenta: el público te sacó del escenario. ¡Inténtalo otra vez!"
    : !counted ? "No cuenta: toca al menos una nota. ¡Inténtalo otra vez!"
    : legend ? "¡Terminaste la gira! Eres leyenda del rock."
    : venue ? `¡Escenario superado! Siguiente parada: ${venue.next.name}`
    : encore ? "¡El público pide otra! Se abrió el bis."
    : `${after.stars} de ${after.maxStars} estrellas en la gira (${DIFFS.find((d) => d.key === ctx.diff).name})`;
  const nx = tourNextSong(after);
  const next = nx && nx.song.id !== ctx.songId ? nx : null; // after a failed run "Otra vez" is the way
  const btn = $("tourNextBtn");
  btn.hidden = !next;
  if (next) {
    btn.textContent = next.encore ? "Tocar el bis" : `Siguiente: ${next.song.name}`;
    btn.onclick = () => { const vi = after.venues.findIndex((x) => x.venue.id === next.venue.id), si = next.venue.songs.indexOf(next.song); playTourSong(vi, si, ctx.diff); };
  }
  // "Otra vez" stops being the main button when the tour has somewhere to go
  $("againBtn").classList.toggle("primary", !next);
  app.tourEvent = counted ? (legend ? "legend" : venue ? "venue" : null) : null;
  // the tour's prizes this run earned (each difficulty has its own: the bar, the theater, the whole tour)
  const prizes = counted ? unlock(prizesWon(after)).map((id) => ITEMS.find((it) => it.req === id)).filter(Boolean) : [];
  if (prizes.length) syncSoon();
  const pb = $("tourPrizeBtn"); pb.hidden = !prizes.length;
  if (prizes.length) { const it = prizes[prizes.length - 1]; pb.textContent = `Ponerme «${it.name}»`; pb.onclick = () => openShopAt(it.slot, it.id); }
  const prizeCel = (k = 0) => {
    const it = prizes[k]; if (!it) return;
    sfx.unlock();
    celebrate({ kicker: `Premio · ${TOUR_THEMES[ctx.diff]}`, title: it.name, sub: `${SLOT_ONE[it.slot]} nuevo. Póntelo en la Tienda.`, ms: 3400, kind: "prize", then: () => prizeCel(k + 1) });
  };
  let main = null;
  if (legend) main = (then) => { sfx.unlock(); R.pyro(); celebrate({ kicker: "Gira terminada", title: "¡Leyenda del rock!", sub: `Llenaste ${legend.venue.in || legend.venue.name}. ¿Te le mides a la gira en otra dificultad?`, ms: 4200, kind: "legend", then }); };
  else if (venue) main = (then) => { sfx.unlock(); R.pyro(); celebrate({ kicker: "Nuevo escenario", title: venue.next.name, sub: venue.next.blurb, ms: 3600, kind: "venue", then }); };
  else if (encore) main = (then) => { sfx.encore(); celebrate({ kicker: v.venue.name, title: "¡Otra! ¡Otra!", sub: "El público pide el bis.", ms: 2600, kind: "encore", then }); };
  if (!main && !prizes.length) return null;
  return () => (main ? main(prizes.length ? () => prizeCel() : null) : prizeCel());
}
const SLOT_ONE = { neck: "Mástil", gems: "Notas", flames: "Llamas", strings: "Cuerdas y bordes", star: "Poder estrella", name: "Estilo de nombre", streak: "Estilo de rachas", crowd: "Público" };
// Full-screen moment: a new venue, an encore, a streak. Tap to skip.
let celT = 0, celThen = null;
function celebrate({ kicker = "", title, sub = "", ms = 3000, kind = "", then = null }) {
  const el = $("celebrate");
  $("celKicker").textContent = kicker; $("celTitle").textContent = title; $("celSub").textContent = sub;
  el.className = "celebrate" + (kind ? " cel-" + kind : ""); el.hidden = false; // cel-: never a HUD class (.streak)
  void el.offsetWidth; el.classList.add("show");
  clearTimeout(celT);
  // a celebration shown on top of another one never swallows what was waiting to happen after it
  const prev = celThen;
  celThen = prev && then ? () => { prev(); then(); } : then || prev;
  celT = setTimeout(endCelebrate, ms);
}
function endCelebrate() {
  clearTimeout(celT);
  const el = $("celebrate"); el.classList.remove("show"); el.hidden = true;
  const f = celThen; celThen = null; f && f();
}
// a song is starting: whatever was on screen goes away (without running what it was waiting for)
function dropCelebration() {
  clearTimeout(app.celTimer); clearTimeout(celT); celThen = null;
  const el = $("celebrate"); el.classList.remove("show"); el.hidden = true;
}
$("celebrate").onclick = endCelebrate;

/* ---------- logros ---------- */
// distinct songs with a finished run (the personal bests only keep finished runs)
const songsDone = () => Object.values(bests).filter((b) => b && Object.values(b).some((x) => x && x.score > 0)).length;
// one after another, each a short gold card
function celebrateAchievements(list) {
  if (!list.length) return;
  const [a, ...rest] = list;
  sfx.unlock();
  celebrate({ kicker: "Logro desbloqueado", title: a.name, sub: a.desc, ms: 2600, kind: "ach", then: rest.length ? () => celebrateAchievements(rest) : null });
}
// what your saved bests already prove (players from before the logros existed get theirs without replaying), silently
function backfillAchievements() {
  const ids = [...forMiau(miauIds(), bestAcc)], n = songsDone();
  // the tour's prizes for venues already cleared (before there were prizes, or on another device)
  if (publicSongs().length) for (const d of savedTourDiffs()) { const t = tourFor(d, publicSongs()); if (t) ids.push(...prizesWon(tourProgress(t, bestOf))); }
  if (n >= 1) ids.push("primer-acorde");
  if (n >= 10) ids.push("repertorio");
  if (n >= 25) ids.push("setlist");
  if (n >= 50) ids.push("enciclopedia");
  for (const b of Object.values(bests)) for (const [d, x] of Object.entries(b || {})) {
    if (!x || !(x.score > 0)) continue;
    if (x.stars >= 5) ids.push("cinco-estrellas");
    if (x.acc >= 1) ids.push("sin-fallar");
    if (d === "hard" || d === "expert") ids.push("dificil");
    if (d === "expert") ids.push("experto");
    if (d === "expert" && x.stars >= 5) ids.push("virtuoso");
  }
  if (unlock(ids).length) syncSoon();
}
setTimeout(backfillAchievements, 0);
function renderLogros() {
  const ul = $("logrosList"); ul.innerHTML = "";
  const won = achievementsWon();
  const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
  // the ones you have first, in list order; then the rest
  const all = ACHIEVEMENTS.filter((a) => !a.tour && (!a.secret || won[a.id] || (a.id === "coro-gatitos" && knowsMiau()))); // the tour's are on its screen
  const list = [...all.filter((a) => won[a.id]), ...all.filter((a) => !won[a.id])];
  for (const a of list) {
    const li = document.createElement("li");
    if (won[a.id]) li.className = "on";
    li.innerHTML = `<svg aria-hidden="true"><use href="#trophy"/></svg><div><b></b><small></small></div>`;
    li.querySelector("b").textContent = a.name;
    li.querySelector("small").textContent = a.desc;
    if (won[a.id]) { const i = document.createElement("i"); i.textContent = fmt(won[a.id]); li.querySelector("small").appendChild(i); }
    ul.appendChild(li);
  }
  $("logrosCount").textContent = `${Object.keys(won).filter((id) => all.some((a) => a.id === id)).length} de ${all.length}`;
}

/* ---------- tutorial (first song) + lifting the phone ---------- */
const liftOn = () => touch && motionAvailable() && settings.starMode !== "tap" && (!motionNeedsPermission() || settings.motion === "granted");
function activateStar(g = app.game) {
  if (!g || app.paused || app.rewinding || app.failing) return;
  const was = g.starOn;
  g.activateStar(); // the frame loop reacts to the "starOn" event
  if (!was && g.starOn) { settings.starActs = (settings.starActs || 0) + 1; save(); } // the "how" reminder stops after a few
}
// lifting/shaking the phone: only when the player chose that way in Ajustes
const liftStar = () => { if (settings.starMode !== "tap") activateStar(); };
/* ---------- star power feedback ---------- */
// a white-blue spark flies from the frets into the meter, which flashes when it lands
function starComet(g, lane) {
  const m = g.ui.hud.mult.getBoundingClientRect(), p = g.ui.p;
  const x0 = R.laneScreenX(Math.min(lane ?? 2, (app.lanes || 5) - 1), p), y0 = R.strikeScreenY(p) - 20;
  const x1 = m.left + m.width / 2, y1 = m.top + m.height / 2;
  const xm = (x0 + x1) / 2 + (x1 < x0 ? -40 : 40), ym = Math.min(y0, y1) + (y0 - y1) * 0.25 - 60;
  const dur = 620;
  const fly = (cls, delay, scale) => {
    const el = document.createElement("div"); el.className = "star-comet" + cls;
    document.body.appendChild(el);
    const a = el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(${1.5 * scale})`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 30}px) scale(${1.4 * scale})`, opacity: 1, offset: 0.12 },
      { transform: `translate(${xm}px, ${ym}px) scale(${1.05 * scale})`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x1}px, ${y1}px) scale(${0.55 * scale})`, opacity: 0.9 },
    ], { duration: dur, delay, easing: "cubic-bezier(.45,0,.7,.55)", fill: "both" });
    a.onfinish = () => el.remove();
    return a;
  };
  const gain = () => starGain(g);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { gain(); return; }
  setTimeout(() => { if (!g.ui.starShown) gain(); }, dur + 300); // in case the animation never finishes
  fly("", 0, 1).finished.then(gain).catch(() => {});
  fly(" tail", 45, 0.8); fly(" tail", 90, 0.6);
}
function starGain(g) {
  const h = g.ui.hud, el = h.mult;
  el.classList.remove("gain"); void el.offsetWidth; el.classList.add("gain");
  clearTimeout(h.gainT); h.gainT = setTimeout(() => el.classList.remove("gain"), 800);
  for (const k of ["star", "mult"]) delete h.cache[k]; // the meter catches up now, with the flash
  g.ui.starShown = true;
}
// "star power ready" reminder (top left) if the player doesn't use it within a couple of seconds; shown only once per device
const tip = { at: 0, hideAt: 0 };
function starTipHow() {
  return touch ? (liftOn() ? "Levanta el celular o toca el círculo de arriba" : "Toca el círculo de arriba a la izquierda") : `Pulsa ${keyLabel(settings.starKey)}`;
}
function hideStarTip() { tip.at = 0; tip.hideAt = 0; $("spTip").hidden = true; }
if (liftOn()) onLift(liftStar);
// iPhone asks for the motion permission (only from a tap) and forgets it every time the page opens. So before the
// first song of each visit the player is asked (or, if they allowed it before, it's asked again right in the tap that
// starts the song); "Usar el dedo" goes on with the multiplier, and "Siempre con el dedo" stops asking.
let motionAsked = false; // this visit
const motionNeeded = () => touch && motionAvailable() && motionNeedsPermission() && settings.starMode !== "tap" && !motionReady() && !motionAsked;
let motionThen = null;
function withMotion(fn) {
  if (!motionNeeded()) return fn();
  if (settings.motion === "granted") { motionAsked = true; requestMotion().then((ok) => ok && onLift(liftStar)); return fn(); }
  motionThen = fn;
  $("motionModal").hidden = false;
}
function motionGo() { $("motionModal").hidden = true; const f = motionThen; motionThen = null; if (app.screen === "lobby") renderLobby(); f && f(); }
$("motionAllow").onclick = async () => {
  motionAsked = true;
  const asking = requestMotion(); // in this tap: iPhone shows its prompt now
  const ok = await asking;
  settings.motion = ok ? "granted" : "denied"; save();
  if (ok) onLift(liftStar); else toast("Sin permiso de movimiento: toca el círculo de arriba a la izquierda cuando brille.", 4200);
  motionGo();
};
$("motionTap").onclick = () => { motionAsked = true; motionGo(); };
$("motionNever").onclick = () => { motionAsked = true; settings.starMode = "tap"; save(); motionGo(); };
let tut = { i: 0, done: null, fromSettings: false };
function withTutorial(fn) {
  if (settings.tutorialDone) return withMotion(fn);
  openTutorial({ done: () => withMotion(fn) });
}
function openTutorial({ done = null, fromSettings = false } = {}) {
  tut = { i: 0, done, fromSettings };
  $("tutNotes").textContent = touch
    ? "Toca la columna de cada color cuando la nota llegue a los botones. Mantén el dedo en las notas largas."
    : "Presiona la tecla de cada color cuando la nota llegue a los botones. Mantén en las notas largas.";
  $("tutStarHow").textContent = touch && motionAvailable() && settings.starMode !== "tap" ? "Actívalo levantando o sacudiendo el celular, como una guitarra, o tocando el círculo de arriba a la izquierda cuando brille." : touch ? "Actívalo tocando el círculo de arriba a la izquierda cuando brille." : `Actívalo con ${keyLabel(settings.starKey)}.`;
  $("motionBtn").hidden = !(touch && motionNeedsPermission() && settings.motion !== "granted");
  $("motionNote").hidden = !(touch && settings.motion === "denied");
  $("tutAlert").hidden = true;
  showTutCard();
  show("tutorial", !fromSettings);
}
function showTutCard() {
  document.querySelectorAll("#s-tutorial .tut-card").forEach((c, k) => (c.hidden = k !== tut.i));
  document.querySelectorAll("#s-tutorial .tut-dots i").forEach((d, k) => d.classList.toggle("on", k === tut.i));
  const last = tut.i === 2;
  $("tutNext").textContent = last ? (tut.fromSettings ? "Volver" : "¡A tocar!") : "Siguiente";
  $("tutSkip").hidden = last;
}
function finishTutorial() {
  settings.tutorialDone = true; save();
  if (tut.fromSettings) { renderSettings(); show("settings", false); return; }
  const fn = tut.done; tut.done = null;
  if (fn) fn();
}
// iPhone: going on without ever answering the motion permission gets a short explanation first
let tutPending = null;
const motionUnasked = () => touch && motionNeedsPermission() && settings.starMode !== "tap" && !settings.motion;
function tutGuard(next) {
  if (!motionUnasked()) return next();
  tutPending = next;
  $("tutAlert").hidden = false;
  $("tutAlertYes").focus();
}
$("tutNext").onclick = () => {
  if (tut.i === 1) return tutGuard(() => { tut.i++; showTutCard(); });
  if (tut.i < 2) { tut.i++; showTutCard(); } else finishTutorial();
};
$("tutSkip").onclick = () => tutGuard(finishTutorial);
async function askMotion() {
  motionAsked = true;
  const ok = await requestMotion();
  settings.motion = ok ? "granted" : "denied"; save();
  $("motionBtn").hidden = true; // asked once: iPhone won't show the prompt again anyway
  $("motionNote").hidden = ok;
  if (ok) onLift(liftStar);
  return ok;
}
$("motionBtn").onclick = askMotion;
$("tutAlertYes").onclick = async () => { $("tutAlert").hidden = true; await askMotion(); const n = tutPending; tutPending = null; n && n(); };
$("tutAlertNo").onclick = () => { motionAsked = true; $("tutAlert").hidden = true; const n = tutPending; tutPending = null; n && n(); };
$("openTutorial").onclick = () => openTutorial({ fromSettings: true });
$("mult").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); activateStar(); });

/* ================= gameplay ================= */
const energyCache = new WeakMap(); // decoded song → its energy curve (worked out once per song)
// Everything being played right now: one game, or two when two people share the PC (app.game is always the first).
const games = () => (app.game ? app.duoGames || [app.game] : []);
// Two players share one song: each gets a "seat" on the same audio player.
// The guitar track keeps sounding while either of them is playing it.
function seatOn(player, flags, k) {
  return new Proxy(player, {
    get(target, prop) {
      if (prop === "guitar") return (on) => { flags[k] = on; target.guitar(flags.some(Boolean)); };
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
    set(target, prop, v) { target[prop] = v; return true; },
  });
}
// duo: { diffs: [d1, d2], names: [n1, n2] } for two players on one PC
// ctx: what the run is part of — { kind: "daily", day, songId } or { kind: "tour", diff, venue, song, encore, stage, before }
function startGame({ lanes, diff, practice = null, duo = null, ctx = null }) {
  dropCelebration();
  stopGame();
  picksRun++; // a late answer about the last run no longer touches the results
  const player = new Player(app.decoded);
  const common = { chart: app.chart, lanes, offsetMs: settings.offsetMs, songOffsetMs: app.songOffsetMs || 0, look: +settings.speed, autoSync: settings.autoSync,
    window: touch ? 0.13 : 0.1 }; // a finger on glass is less exact than a key: ±130 ms on a touch screen
  if (duo) {
    // same song, each with their own difficulty; nobody gets booed off the stage
    const flags = [true, true];
    app.duoGames = duo.diffs.map((d, k) => new Game({ ...common, diff: d, player: seatOn(player, flags, k) }));
    app.game = app.duoGames[0];
    diff = duo.diffs[0];
  } else {
    // the rock meter can end the song only on Difícil/Experto, and never in practice or multiplayer
    const canFail = !practice && app.mode !== "mp" && (diff === "hard" || diff === "expert");
    app.duoGames = null;
    app.game = new Game({ ...common, diff, player, practice, canFail });
  }
  app.duo = duo;
  app.ctx = ctx;
  games().forEach((g, k) => {
    g.ui = { p: k, hud: k ? duoHud() : huds[0], starShown: true, starWasReady: false };
    for (const key in g.ui.hud.cache) delete g.ui.hud.cache[key];
  });
  setDuoHud(duo);
  R.setPlayers(duo ? 2 : 1);
  app.practice = practice ? { ...practice, loopAt: Math.min(practice.to + 1.2, player.duration - (app.songOffsetMs || 0) / 1000 - 0.2) } : null;
  app.failing = false;
  // the chart's busiest difficulty tells the crowd where the song gets intense
  if (!energyCache.has(app.decoded)) {
    const dk = ["expert", "hard", "medium", "easy"].find((d) => app.chart?.diffs?.[d]?.notes?.length);
    const times = dk ? notesFor(app.chart, dk, 5).map((x) => x.t + (app.songOffsetMs || 0) / 1000) : null;
    energyCache.set(app.decoded, energyCurve(app.decoded.map((s) => s.buffer), times));
  }
  app.energy = energyCache.get(app.decoded);
  hideStarTip();
  $("practiceTag").hidden = !practice;
  // where this song is being played: the tour venue (and the encore) or the song of the day
  $("ctxTag").hidden = !ctx || !!practice;
  if (ctx) $("ctxTag").textContent = ctx.kind === "daily" ? "Canción del día" : `${(touch && VENUES[ctx.venue].short) || VENUES[ctx.venue].name}${ctx.encore ? " · Bis" : ""}`;
  $("ctxTag").className = "practice-tag ctx-tag " + (ctx?.kind || "");
  $("hud").classList.toggle("mp", app.mode === "mp");
  $("failFx").classList.remove("on");
  app.lanes = lanes;
  app.diff = diff;
  R.setLanes(lanes);
  app.paused = false;
  app.finals = {}; app.rivals = {};
  lastSection = -2;
  for (const k in sharedCache) delete sharedCache[k];
  $("rivals").hidden = app.mode !== "mp";
  show("play");
  unlockAudio();
  // the music starts with enough lead-in for whichever player has the earliest note
  const first = (g) => (g.notes.length ? g.notes[0].t : 1e9);
  games().reduce((a, b) => (first(b) < first(a) ? b : a)).start();
  // the frets light up one by one with a little riff, like the classics
  if (!practice) sfx.intro(lanes, (i) => games().forEach((g, k) => R.hit(i, false, k)));
  try { navigator.wakeLock?.request("screen").then((l) => (app.wake = l)).catch(() => {}); } catch {}
  checkSoundAwake();
}
// A song started without a tap (a multiplayer round, started by the host) on a phone whose sound is still asleep
// (it went to the background, or never had a tap): the song can't run until there's one, so ask for it.
function checkSoundAwake() {
  clearTimeout(app.soundT);
  app.soundT = setTimeout(() => {
    if (!app.game || app.paused || audioCtx().state === "running") { $("tapStart").hidden = true; return; }
    $("tapStart").hidden = false;
  }, 500);
}
$("tapStart").addEventListener("pointerdown", () => {
  unlockAudio(); audioCtx().resume().catch(() => {});
  $("tapStart").hidden = true;
});
// Keep what auto-sync learned only after a solid run, and move at most 30 ms per song so one bad game can't wreck the next.
function keepLearnedSync(g) {
  if (!g || !settings.autoSync || g.hits < 40 || g.accuracy < 0.6) return;
  const target = Math.max(settings.offsetMs - 30, Math.min(settings.offsetMs + 30, g.offsetMs));
  if (target !== settings.offsetMs) { settings.offsetMs = target; save(); }
}
// with two players, the one who played the most notes teaches the sync
const syncTeacher = () => games().reduce((a, b) => (b.hits > a.hits ? b : a), app.game);
function stopGame() {
  app.practice = null; app.failing = false; R.setHype(0.5); hideStarTip(); clearFx(); $("mpPos").hidden = true;
  if (!app.game) return;
  keepLearnedSync(syncTeacher());
  app.game.player.stop();
  app.game = null; app.duoGames = null;
  R.setPlayers(1);
  try { app.wake?.release(); } catch {}
}
function pauseGame() {
  if (!app.game || app.paused || app.game.ended || app.failing) return;
  if (app.mode === "mp") return toast("En multijugador no se puede pausar.");
  app.paused = true; app.game.player.pause(); hideStarTip(); show("pause");
}
function resumeGame() {
  if (!app.game || !app.paused) return;
  for (const g of games()) { g.pressed.fill(false); g.look = +settings.speed; g.offset = settings.offsetMs / 1000; }
  const g = app.game, pausedAt = g.lastT;
  if (pausedAt <= 0) { g.player.resume().then(() => { app.paused = false; }); show("play", false); return; }
  // rewind animation: the highway runs backwards ~10 s, then the music restarts there
  games().forEach((x) => x.hidePlayed());
  app.rewinding = { from: pausedAt, to: Math.max(0, g.resumeAt - 10), start: performance.now(), dur: 1100 };
  show("play", false);
}
$("pauseBtn").onclick = pauseGame;
$("pauseSettingsBtn").onclick = () => { app.settingsFromPause = true; renderSettings(); show("settings", false); };
function backToPause() { app.settingsFromPause = false; show("pause", false); }
$("resumeBtn").onclick = resumeGame;
$("restartBtn").onclick = () => startGame({ lanes: app.lanes, diff: app.diff, practice: app.practice, duo: app.duo, ctx: app.ctx });
// "Salir" goes back to where the song was picked
$("quitBtn").onclick = () => {
  const duo = app.duo, ctx = app.ctx; stopGame(); R.setLanes(5);
  if (ctx?.kind === "tour") { app.history = ["home"]; openTour(false); }
  else if (ctx?.kind === "daily" && !ctx.via) { app.history = ["home"]; openDaily(false); }
  else show(duo ? "duo" : "setup", false);
};
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

function finishGame() {
  if (app.duo) return finishDuo();
  const g = app.game; if (!g) return;
  clearFx(); $("mpPos").hidden = true;
  const sum = g.summary();
  g.player.stop();
  keepLearnedSync(g);
  app.lastSummary = sum;
  app.failing = false; app.practice = null; R.setHype(0.5);
  $("resFail").hidden = !sum.failed;
  $("soloRes").hidden = false; $("duoRes").hidden = true; $("otherSongBtn").hidden = true;
  renderSections(sum);
  $("resSong").textContent = `${app.song.name} · ${DIFFS.find((d) => d.key === app.diff).name}`;
  $("resScore").textContent = sum.score.toLocaleString("es-CO");
  $("resStars").innerHTML = "★".repeat(sum.stars) + `<span class="off">${"★".repeat(5 - sum.stars)}</span>`;
  if (sum.failed) sfx.failed(); else sfx.finale(sum.stars); // a chord, then the crowd cheers or boos
  $("resHit").textContent = `${sum.hits}/${sum.total}`;
  $("resAcc").textContent = Math.round(sum.acc * 100) + "%";
  $("resCombo").textContent = sum.maxCombo;
  // personal best, kept in this browser (practice never gets here: it loops until you quit)
  const pb = app.song ? recordBest(app.song.id, app.diff, sum) : { old: null, beat: false };
  $("pbLine").hidden = !app.song || app.song.id === "local" || sum.failed;
  $("pbLine").classList.toggle("new", pb.beat && !!pb.old);
  $("pbLine").textContent = pb.beat && pb.old ? `¡Nuevo récord personal! Antes: ${pb.old.score.toLocaleString("es-CO")}`
    : pb.old && !pb.beat ? `Tu mejor: ${pb.old.score.toLocaleString("es-CO")}` : "";
  if (!$("pbLine").textContent) $("pbLine").hidden = true;
  // the result as a story image: only for songs that were finished
  app.shareRecord = !!(pb.beat && pb.old);
  app.retoWon = false;
  const reto = app.reto && app.song && app.reto.songId === app.song.id && app.reto.diff === app.diff ? app.reto : null;
  const who = reto?.name || "tu retador";
  $("retoLine").hidden = !reto;
  if (reto) {
    const gap = Math.abs(sum.score - reto.score).toLocaleString("es-CO");
    const won = !sum.failed && sum.score > reto.score;
    app.retoWon = won;
    $("retoLine").classList.toggle("win", won);
    $("retoLine").textContent = won ? `¡Le ganaste a ${who} por ${gap}!` : `Te faltaron ${gap} para ganarle a ${who}.`;
  }
  $("shareBtn").hidden = sum.failed;
  $("againBtn").hidden = app.mode === "mp";
  $("resRandomBox").hidden = app.mode === "mp" || !online || (!!app.ctx && !app.ctx.via);
  $("resRandomDiffs").hidden = true; $("resRandomBtn").setAttribute("aria-expanded", "false");
  $("menuBtn").textContent = app.mode === "mp" ? "Volver a la sala" : app.ctx?.kind === "tour" ? "Gira" : app.ctx?.kind === "daily" && !app.ctx.via ? "Canción del día" : "Menú";
  $("homeBtn").hidden = app.mode === "mp" || $("menuBtn").textContent === "Menú"; // the tour / the song of the day: the menu is one tap away too
  if (app.mode === "mp") { app.room.send("final", { name: app.me.name, round: app.roundId, ...sum }); app.finals[app.me.id] = { name: app.me.name, round: app.roundId, ...sum }; }
  renderRanking();
  app.game = null;
  R.setLanes(5);
  $("newRecord").hidden = true; $("boardMe").hidden = true; $("nameAsk").hidden = true; $("resultsBoard").hidden = true;
  $("picksRes").hidden = true; picksRun++; // filled when the server says what the run earned
  app.boardLanes = app.lanes;
  // multiplayer runs count too (the boards and the púas), quietly: the room's ranking is the results there
  if (app.mode === "mp" && hasBoard() && settings.name && !sum.failed) sendScore(sum, true);
  if (app.mode !== "mp" && hasBoard()) {
    if (sum.failed) showBoard($("resultsBoard")); // a failed song doesn't go on the board
    else if (settings.name || !(sum.score > 0)) sendScore(sum); else { $("nameAsk").hidden = false; $("boardName").value = ""; app.pendingScore = sum; }
  }
  app.tourEvent = null;
  const ctxCel = finishCtx(sum);
  // logros: lo que esta canción ganó (la práctica nunca llega aquí)
  const ids = app.song?.id === "local" ? [] : forRun({ sum, diff: app.diff, songsDone: songsDone() });
  if (app.ctx?.kind === "daily" && !sum.failed && sum.score > 0) ids.push(...forStreak(dailyStreak(app.ctx.day)));
  if (app.tourEvent) ids.push("de-gira");
  if (app.tourEvent === "legend") ids.push("leyenda");
  if (app.mode === "mp") ids.push("en-banda");
  if (app.retoWon) ids.push("reto-aceptado");
  if (app.song?.miau && !sum.failed) ids.push(...forMiau(miauIds(), (id) => Math.max(bestAcc(id), id === app.song.id ? sum.acc : 0)));
  const fresh = unlock(ids);
  const celebration = !fresh.length ? ctxCel
    : !ctxCel ? () => celebrateAchievements(fresh)
    : () => { ctxCel(); const prev = celThen; celThen = () => { prev && prev(); celebrateAchievements(fresh); }; };
  syncSoon(); // bests, the day's streak and the tour, to the other devices
  show("results");
  // after the final chord and the crowd, and only if the player is still looking at the results
  clearTimeout(app.celTimer);
  if (celebration) app.celTimer = setTimeout(() => { if (app.screen === "results" && !celThen) celebration(); }, 1500);
}

// Rock meter at the bottom on Difícil/Experto: the band runs out of power, then the results say so
function failSong() {
  const g = app.game;
  if (!g || app.failing) return;
  app.failing = true;
  g.player.windDown(1.5);
  $("failFx").classList.add("on");
  setTimeout(() => { if (app.game === g) finishGame(); }, 1700);
}

// Results per section: how much of each part you hit (the weakest ones stand out)
function renderSections(sum) {
  const box = $("resSections"), ol = box.querySelector("ol");
  ol.innerHTML = "";
  const secs = sum.sections || [];
  box.hidden = secs.length < 2;
  // tap a section to practice it (solo only): the weak ones are right there after the song
  const parts = app.mode === "mp" ? [] : practiceParts();
  $("resSectionsHint").hidden = !parts.length;
  for (const s of secs) {
    const pct = Math.round((s.hit / s.total) * 100);
    const li = document.createElement("li");
    li.className = pct >= 90 ? "great" : pct < 60 ? "weak" : "";
    li.innerHTML = `<span class="n"></span><span class="b"><i style="width:${pct}%"></i></span><span class="p">${pct}%</span>`;
    li.querySelector(".n").textContent = sectionName(s.name, s.i);
    const part = parts.find((p) => p.i === s.i);
    if (part) {
      li.classList.add("go"); li.tabIndex = 0; li.setAttribute("role", "button");
      li.setAttribute("aria-label", `Practicar ${sectionName(s.name, s.i)}`);
      const go = () => startGame({ lanes: deviceLanes(), diff: app.diff, practice: part, ctx: app.ctx });
      li.onclick = go;
      li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    }
    ol.appendChild(li);
  }
}

/* ================= leaderboard ================= */
const hasBoard = () => online && app.song && app.song.id && app.song.id !== "local";
function playerSecret() {
  try {
    let s = localStorage.getItem("corde.player");
    if (!s) { s = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + "-" + Date.now().toString(36); localStorage.setItem("corde.player", s); }
    return s;
  } catch { return "anon-" + Math.random().toString(36).slice(2) + Date.now(); }
}
/* ================= account ================= */
// One name = one account (supabase/accounts.sql). The name is asked the first time the game opens, before anything
// else; a browser that already had a name claims it on its own (nothing to type). Another device joins the same
// account with the 4-letter code shown in Ajustes. The streak, the personal bests and the tour setlists live in the
// account too, so every linked device shows the same progress.
const TOUR_KEY = "corde.tour.v1";
let account = null; // { name, code, progress }
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const localProgress = () => ({ days: [...new Set([...readDailyLog(), ...dailyLog.days])].sort(), bests, tour: readJson(TOUR_KEY, {}), ach: achievementsWon() });
function applyProgress(p) {
  if (!p || typeof p !== "object") return;
  if (p.bests && typeof p.bests === "object") { bests = p.bests; try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch {} }
  if (Array.isArray(p.days)) { dailyLog.days = [...new Set([...p.days, ...dailyLog.days])].sort().slice(-400); try { localStorage.setItem(DAILY_KEY, JSON.stringify({ days: dailyLog.days })); } catch {} }
  if (p.tour && typeof p.tour === "object") { try { localStorage.setItem(TOUR_KEY, JSON.stringify(p.tour)); } catch {} }
  if (p.ach && typeof p.ach === "object") mergeAchievements(p.ach);
  try { backfillAchievements(); } catch {}
  try { renderDailyCard(); } catch {}
  if (app.screen === "library") try { renderSongs(); } catch {}
}
let syncT = 0, syncing = null;
async function syncNow() {
  if (!online || !account) return;
  clearTimeout(syncT);
  try { syncing = accountSync(playerSecret(), localProgress()); applyProgress(await syncing); }
  catch (e) { console.warn("account sync:", e.message); }
  syncing = null;
}
const syncSoon = () => { if (!account) return; clearTimeout(syncT); syncT = setTimeout(syncNow, 1500); };
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && syncT) syncNow(); });
function adoptAccount(acc) {
  account = acc;
  if (settings.name !== acc.name) { settings.name = acc.name; save(); }
  closeWelcome();
  renderAccountField();
  setWallet(acc.wallet); // its púas and its look (another device may have changed it)
  if (app.screen === "tienda") renderShop();
  syncNow(); // uploads what this browser had and brings what the other devices have
  checkNotices();
}
function renderAccountField() {
  const f = $("accountField"); if (!f) return;
  f.hidden = !account;
  if (account) $("accountCode").textContent = account.code;
  $("mpName").readOnly = !!account;
}
// the welcome card: blocks the game until there's a name
const welcome = { open: false, taken: false };
function openWelcome(name = "", taken = false) {
  welcome.open = true;
  $("welcomeName").value = name;
  setWelcomeTaken(taken);
  $("welcomeModal").hidden = false;
  setTimeout(() => (taken ? $("welcomeCode") : $("welcomeName")).focus(), 60);
}
function setWelcomeTaken(taken, msg) {
  welcome.taken = taken;
  $("welcomeMsg").textContent = msg || (taken ? "Ese nombre ya tiene dueño. Si es tuyo, escribe el código que aparece en Ajustes de tu otro dispositivo." : "");
  $("welcomeCode").hidden = $("welcomeLink").hidden = !taken;
  $("welcomeLink").classList.toggle("primary", taken); $("welcomeGo").classList.toggle("primary", !taken); // the code is the next step
  if (taken) $("welcomeCode").value = "";
}
function closeWelcome() { welcome.open = false; $("welcomeModal").hidden = true; }
const cleanName = (v) => v.trim().replace(/\s+/g, " ").slice(0, 16);
$("welcomeForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = cleanName($("welcomeName").value);
  if (!name) { $("welcomeName").focus(); return; }
  const go = $("welcomeGo"); go.disabled = true;
  try {
    const r = await accountClaim(name, playerSecret());
    if (r?.error === "name_taken") { setWelcomeTaken(true); $("welcomeCode").focus(); }
    else if (r) adoptAccount(r);
  } catch (err) {
    // no connection: keep the name here, it's claimed the next time the game opens online
    console.warn("account:", err.message);
    settings.name = name; save(); closeWelcome();
  }
  go.disabled = false;
};
$("welcomeLink").onclick = async () => {
  const name = cleanName($("welcomeName").value), code = $("welcomeCode").value.trim();
  if (!name) { $("welcomeName").focus(); return; }
  if (!code) { $("welcomeCode").focus(); return; }
  const b = $("welcomeLink"); b.disabled = true;
  try {
    const r = await accountLink(name, code, playerSecret());
    if (r?.error) { setWelcomeTaken(true, "Ese código no es. Revísalo en tu otro dispositivo o elige otro nombre."); $("welcomeCode").focus(); }
    else adoptAccount(r);
  } catch (err) { console.warn("account:", err.message); }
  b.disabled = false;
};
// a new name typed after "taken": back to plain Empezar
$("welcomeName").addEventListener("input", () => { if (welcome.taken) setWelcomeTaken(false); });
// nothing behind the card reacts to the keyboard while it's open
addEventListener("keydown", (e) => { if (welcome.open && !e.target.closest?.("#welcomeModal")) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
/* ---------------- song requests ---------------- */
$("openRequest").onclick = () => {
  $("requestMsg").textContent = ""; $("requestModal").hidden = false;
  setTimeout(() => $("requestText").focus(), 60);
};
const closeRequest = () => { $("requestModal").hidden = true; };
$("requestClose").onclick = closeRequest;
$("requestModal").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeRequest(); } });
$("requestForm").onsubmit = async (e) => {
  e.preventDefault();
  const body = $("requestText").value.trim(), msg = $("requestMsg");
  if (!body) { $("requestText").focus(); return; }
  if (!account || !online) { msg.textContent = "Necesitas conexión y tu nombre en el juego para enviarlo."; return; }
  $("requestSend").disabled = true;
  try {
    const r = await songRequest(playerSecret(), body);
    if (r?.ok) { msg.textContent = "¡Listo! Tu pedido llegó."; $("requestText").value = ""; }
    else msg.textContent = r?.error === "limit" ? "Ya enviaste muchos pedidos hoy. Mañana puedes enviar más." : "No se pudo enviar. Intenta otra vez.";
  } catch { msg.textContent = "No se pudo enviar. Revisa tu conexión."; }
  $("requestSend").disabled = false;
};

/* ---------------- notices from the admin ---------------- */
// Each one shows once, in the menus (never mid-song, never over the welcome card that asks for the name),
// with a quiet box to answer if the player wants to.
async function checkNotices() {
  if (!account || !online || notices.asked) return;
  notices.asked = true;
  try {
    // the songs they asked for that are in now go first, then the admin's messages
    const [songs, list] = await Promise.all([myFulfilled(playerSecret()).catch(() => []), myNotices(playerSecret())]);
    if (Array.isArray(songs)) notices.queue.push(...songs.filter((r) => r && r.id && r.song?.id).map((r) => ({ ...r, kind: "song" })));
    if (Array.isArray(list)) notices.queue.push(...list.filter((n) => n && n.id && n.body));
  } catch (e) { console.warn("notices:", e.message); notices.asked = false; return; }
  showNextNotice();
}
const NOTICE_SCREENS = new Set(["home", "library", "setup", "logros", "tienda", "tour", "daily", "mp", "settings"]);
function showNextNotice() {
  if (notices.current || !notices.queue.length) return;
  if (welcome.open || app.game || !NOTICE_SCREENS.has(app.screen)) return; // later, back in the menus
  const n = notices.current = notices.queue.shift();
  if (n.kind === "song") return showSongReady(n);
  if (n.kind === "reto") return showReto();
  $("noticeBody").textContent = n.body;
  $("noticeReply").value = ""; $("noticeSend").hidden = true; $("noticeMsg").textContent = "";
  $("noticeModal").hidden = false;
  noticeSeen(playerSecret(), n.id).catch(() => {}); // shown: it won't come again
}
/* the kittens' challenge (coro-gatitos): told once, when the miau songs first show up (they come with a code) */
// what this player already did on any device (the boards keep each name's runs): it counts here too
async function refreshMiau() {
  const name = account?.name || settings.name;
  if (!online || !name || !miauIds().length) return;
  let got = {};
  try { got = await fetchMiauProgress(name); } catch { return; }
  for (const [id, acc] of Object.entries(got)) recordMiauBest(id, +acc || 0);
  const fresh = unlock(forMiau(miauIds(), bestAcc));
  if (fresh.length) { syncSoon(); celebrateAchievements(fresh); }
  if (app.screen === "library") renderSongs();
}
const MIAU_KEY = "corde.miau.intro.v1";
function miauProgress() {
  const ids = miauIds(), need = Math.min(3, ids.length);
  return { need, done: Math.min(need, ids.filter((id) => bestAcc(id) >= 0.8).length), won: !!achievementsWon()["coro-gatitos"] };
}
const catsHtml = (p) => Array.from({ length: p.need }, (_, i) => `<i class="${i < p.done || p.won ? "on" : ""}"></i>`).join("");
function queueMiauIntro(delay = 0) {
  const p = miauProgress();
  let seen = false; try { seen = !!localStorage.getItem(MIAU_KEY); } catch {}
  if (!p.need || p.won || seen || notices.queue.some((x) => x.kind === "reto") || notices.current?.kind === "reto") return;
  notices.queue.unshift({ kind: "reto" });
  setTimeout(showNextNotice, delay);
}
function showReto() {
  const p = miauProgress();
  $("retoDesc").textContent = `Saca 80% o más en ${p.need === 1 ? "la canción miau" : `${p.need === 3 ? "las 3" : `las ${p.need}`} canciones miau`} y tus notas se vuelven gatitos.`;
  $("retoProg").innerHTML = catsHtml(p) + `<span>${p.done} de ${p.need}</span>`;
  $("retoModal").hidden = false;
  try { localStorage.setItem(MIAU_KEY, "1"); } catch {}
  try { sfx.unlock(); } catch {}
}
function closeReto() { $("retoModal").hidden = true; notices.current = null; setTimeout(showNextNotice, 300); }
$("retoLater").onclick = closeReto;
$("retoModal").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeReto(); } });
$("retoGo").onclick = () => {
  closeReto();
  const g = app.songs.find((s) => s.miau)?.secret;
  if (g) app.libTab = g;
  app.mode = "solo";
  if (app.screen !== "library") openLibrary(); else { renderSongs(); $("songList").scrollTop = 0; }
};
// "¡Ya está la canción que pediste!": its cover, its name, and a button straight to it
function showSongReady(r) {
  const s = r.song, cov = coverOf(s);
  $("srTitle").textContent = s.name; $("srArtist").textContent = s.artist || "";
  const img = $("srCover"); img.hidden = !cov; img.src = cov || "";
  $("songReadyModal").hidden = false;
  fulfilledSeen(playerSecret(), r.id).catch(() => {}); // shown: it won't come again
  try { sfx.unlock(); } catch {}
}
function closeSongReady() { $("songReadyModal").hidden = true; notices.current = null; setTimeout(showNextNotice, 300); }
$("srLater").onclick = closeSongReady;
$("songReadyModal").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSongReady(); } });
$("srPlay").onclick = async () => {
  const r = notices.current;
  $("songReadyModal").hidden = true; notices.current = null; notices.queue = notices.queue.filter((x) => x.kind !== "song" || x.id !== r?.id);
  const s = r && (await findSong(r.song.id));
  if (!s) return toast("No se pudo abrir la canción. Búscala en Jugar.");
  app.mode = "solo";
  try { await loadLibrarySong(s); openSetup(); } catch (e) { toast(e.message); show("home", false); }
};
function closeNotice() {
  $("noticeModal").hidden = true; notices.current = null;
  setTimeout(showNextNotice, 300);
}
$("noticeClose").onclick = closeNotice;
$("noticeModal").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeNotice(); } });
$("noticeReply").addEventListener("input", () => { $("noticeSend").hidden = !$("noticeReply").value.trim(); });
$("noticeForm").onsubmit = async (e) => {
  e.preventDefault();
  const n = notices.current, body = $("noticeReply").value.trim();
  if (!n || !body) return;
  $("noticeSend").disabled = true;
  try {
    const r = await noticeReply(playerSecret(), n.id, body);
    if (r?.ok) { $("noticeMsg").textContent = "Enviado. ¡Gracias!"; $("noticeReply").value = ""; $("noticeSend").hidden = true; }
    else $("noticeMsg").textContent = r?.error === "limit" ? "Ya respondiste varias veces a este mensaje." : "No se pudo enviar.";
  } catch { $("noticeMsg").textContent = "No se pudo enviar. Revisa tu conexión."; }
  $("noticeSend").disabled = false;
};

async function ensureAccount() {
  if (!settings.name) openWelcome(); // right away: no waiting for the network to ask the name
  if (!online) return;
  const secret = playerSecret();
  try {
    const me = await accountMe(secret);
    if (me) return adoptAccount(me);
    if (!settings.name) return;
    const r = await accountClaim(settings.name, secret); // a browser that already played: its name, silently
    if (r?.error === "name_taken") openWelcome(settings.name, true);
    else if (r) adoptAccount(r);
  } catch (e) { console.warn("account:", e.message); }
}

/* ================= shop ================= */
// Púas are earned by finishing songs (the server pays them, see sendScore) and spent here on looks. Picking an item
// shows it on the stage behind the panel right away; leaving the shop, any way at all, puts back what you have on.
// Prices and what you own live on the server: this only shows them and asks.
const fmtPicks = (n) => Math.max(0, Math.floor(+n || 0)).toLocaleString("es-CO");
const owns = (it) => isDefault(it) || !!app.wallet?.owned.has(ownedKey(it.slot, it.id));
// prizes: a logro's (req) or a level's (lvl), claimed for free once earned
const isPrize = (it) => !!(it.req || it.lvl);
const prizeWon = (it) => it.req ? !!achievementsWon()[it.req] : it.lvl ? (app.wallet?.level || 1) >= it.lvl : false;
const prizeLock = (it) => it.streak ? `Racha de ${it.streak} días` : it.tour ? achName(it.req) : it.req ? `Logro: ${achName(it.req)}` : `Nivel ${it.lvl}`;
const prizeOf = (it) => it.streak ? `Premio por ${it.streak} días seguidos de canción del día` : it.tour ? `Premio de la ${achName(it.req).replace(/^Gira /, "gira en ").replace(":", ",")}` : it.req ? `Premio del logro «${achName(it.req)}»` : `Premio del nivel ${it.lvl}`;
const achName = (id) => ACHIEVEMENTS.find((a) => a.id === id)?.name || id;
const shopOffline = () => !online || navigator.onLine === false;
const SHOP_ERRORS = {
  not_enough: "Te faltan púas para eso.", locked: "Todavía no tienes ese logro.", owned: "Eso ya es tuyo.",
  unknown: "Eso ya no está en la tienda.", no_account: "Necesitas tu cuenta para comprar.", not_owned: "Primero tienes que comprarlo.",
};
// the account's wallet → app.wallet, and its look goes on (and is remembered in this browser)
function setWallet(w) {
  if (!w || typeof w !== "object") { app.wallet = null; renderPicks(); renderRetos(); return; }
  setEquipped(w.equipped);
  app.wallet = { picks: Math.max(0, Math.floor(+w.picks || 0)), owned: new Set(Array.isArray(w.owned) ? w.owned : []), equipped,
    xp: Math.max(0, Math.floor(+w.xp || 0)), level: Math.max(1, Math.floor(+w.level || 1)), ch: Array.isArray(w.ch) ? w.ch : [] };
  renderRetos();
  renderPicks();
  restyleNames();
}
function setEquipped(eq) {
  equipped = resolveEquipped(eq);
  try { localStorage.setItem(EQUIP_KEY, JSON.stringify(equipped)); } catch {}
  if (shop.preview) previewShop(); else applyLook();
}
// the balance: on the home menu's Tienda, in the shop's header and on the results
function renderPicks() {
  for (const id of ["homePicks", "shopPicks"]) {
    const el = $(id); el.hidden = !app.wallet;
    if (app.wallet) el.querySelector("b").textContent = fmtPicks(app.wallet.picks);
  }
  $("picksBal").textContent = app.wallet ? ` · tienes ${fmtPicks(app.wallet.picks)}` : "";
}
// levels: level L starts at 25(L-1)² + 75(L-1) xp (the server's level_of); every púa earned playing is xp
const levelStart = (L) => 25 * (L - 1) ** 2 + 75 * (L - 1);
const CH_TEXT = {
  runs: (n) => `Termina ${n} canciones`, stars: (n) => `Saca ${n} estrellas en una canción`,
  acc: (n) => `Termina una canción con ${n}% de precisión`, combo: (n) => `Haz un combo de ${n} notas`,
  hard: () => "Termina una canción en Difícil o Experto", expert: () => "Termina una canción en Experto",
};
const chText = (c) => (CH_TEXT[c.k] || (() => "Reto"))(c.n);
// the home menu's card: the level, its bar, and the day's three challenges
function renderRetos() {
  const w = app.wallet, card = $("retosCard");
  card.hidden = !w || !w.ch.length;
  if (card.hidden) return;
  const L = w.level, a = levelStart(L), b = levelStart(L + 1);
  $("rcLvl").textContent = L;
  $("rcBar").style.width = `${Math.max(0, Math.min(100, ((w.xp - a) / (b - a)) * 100))}%`;
  $("rcXp").textContent = `${Math.max(0, w.xp - a)}/${b - a} XP`;
  const list = $("rcList"); list.textContent = "";
  let done = 0;
  for (const c of w.ch) {
    const p = Math.min(+c.p || 0, c.n), ok = p >= c.n; done += ok;
    const li = document.createElement("li"); li.className = ok ? "done" : "";
    const t = document.createElement("span"); t.textContent = chText(c);
    li.append(t);
    if (!ok && (c.k === "runs" || c.k === "combo" || c.k === "acc" || c.k === "stars") && p > 0) {
      const em = document.createElement("em"); em.textContent = c.k === "runs" ? `${p}/${c.n}` : c.k === "acc" ? `${p}%` : `${p}`; li.append(em);
    }
    const r = document.createElement("b"); r.innerHTML = ok ? "✓" : `<svg aria-hidden="true"><use href="#pick"/></svg>`;
    if (!ok) r.append(`${c.r}`);
    li.append(r); list.append(li);
  }
  $("rcCount").textContent = `${done}/${w.ch.length}`;
  $("rcFoot").textContent = done >= w.ch.length ? "¡Retos de hoy completos! Mañana hay nuevos."
    : `Los tres: +30 púas extra · Nivel ${L + 1}: +${25 * (L + 1)} púas`;
}
$("rcToggle").onclick = () => { const c = $("retosCard"); c.classList.toggle("open"); $("rcToggle").setAttribute("aria-expanded", String(c.classList.contains("open"))); };
// the balance may have changed on another device: ask again quietly when the shop opens
async function refreshWallet() {
  if (!account || shopOffline()) return;
  const seq = ++shop.seq; // a purchase answered meanwhile is newer than this
  try {
    const me = await accountMe(playerSecret());
    if (me?.wallet && seq === shop.seq) { setWallet(me.wallet); if (app.screen === "tienda") renderShop(); }
  } catch (e) { console.warn("wallet:", e.message); }
}

function openShop() {
  if (app.game) return; // never mid-song
  shop.armed = null; shop.sel = equipped[shop.cat];
  show("tienda");
  shop.preview = true;
  renderShop();
  previewShop();
  refreshWallet();
}
// straight to one item (the kittens' card in the library)
function openShopAt(cat, id) {
  shop.cat = cat; openShop();
  if ($("shopGrid").querySelector(`[data-id="${id}"]`)) selectShopItem(id);
}
// the stage behind the panel shows the picked item with everything else you have on
function previewShop() {
  if (app.screen !== "tienda") return;
  const look = { ...equipped, [shop.cat]: shop.sel || equipped[shop.cat] };
  applyLook(look);
  R.previewStar?.(shop.cat === "star");
  R.previewCrowd?.(shop.cat === "crowd"); // the crowd only lights up in quiet parts: hold the lights up while you look
  if (shop.cat === "streak") streakSample(look.streak);
  else $("shopStreak").classList.remove("show");
}
function endShopPreview() {
  if (!shop.preview) return;
  shop.preview = false; shop.armed = null; clearTimeout(shop.armT); clearTimeout(shop.streakT);
  R.previewStar?.(false); R.previewCrowd?.(false);
  $("shopStreak").classList.remove("show");
  applyLook();
}
// the streak pop-up as it would come out in a song, again and again while you look at the streaks
function streakSample(id) {
  const el = $("shopStreak");
  el.className = `streak shop-streak st-${id}`;
  el.textContent = "¡Racha de 50!";
  void el.offsetWidth; el.classList.add("show");
}
$("shopStreak").addEventListener("animationend", (e) => {
  if (e.animationName !== "streak") return;
  clearTimeout(shop.streakT);
  shop.streakT = setTimeout(() => { if (app.screen === "tienda" && shop.cat === "streak") streakSample(shop.sel || equipped.streak); }, 600);
});

function renderShop() {
  const w = app.wallet;
  renderPicks();
  const cats = $("shopCats");
  if (!cats.children.length) for (const s of SLOTS) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.c = s.id; b.setAttribute("role", "tab"); b.textContent = s.name;
    cats.appendChild(b);
  }
  cats.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.c === shop.cat)));
  // without a connection or an account you can look at everything, but not buy
  const off = shopOffline(), noAcc = !off && !account;
  $("shopNote").hidden = !(off || noAcc || !w);
  $("shopNoteMsg").textContent = off ? "Sin conexión: puedes mirar, pero para comprar y ganar púas necesitas internet."
    : noAcc ? "Puedes mirar todo. Para ganar púas y comprar necesitas tu cuenta (tu nombre en las clasificaciones)."
    : "No pude cargar tus púas. Revisa tu conexión y vuelve a entrar.";
  $("shopAccount").hidden = !noAcc;
  const grid = $("shopGrid"); grid.innerHTML = "";
  // a secret prize only for whoever can win it (the kittens: the miau songs' players), or has it
  for (const it of ITEMS) if (it.slot === shop.cat && (!it.secret || owns(it) || knowsMiau())) grid.appendChild(shopCard(it));
  renderShopDetail();
  revealShopSel();
}
// the picked card in view (the list scrolls down on a PC, sideways on a phone)
function revealShopSel() {
  const grid = $("shopGrid"), el = grid.querySelector('.shop-item[aria-selected="true"]');
  if (!el) return;
  const g = grid.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.right > g.right) grid.scrollLeft += r.right - g.right + 12; else if (r.left < g.left) grid.scrollLeft -= g.left - r.left + 12;
  if (r.bottom > g.bottom) grid.scrollTop += r.bottom - g.bottom + 4; else if (r.top < g.top) grid.scrollTop -= g.top - r.top + 4;
}
function shopCard(it) {
  const b = document.createElement("button");
  const on = equipped[it.slot] === it.id, mine = owns(it), won = prizeWon(it);
  b.type = "button"; b.dataset.id = it.id;
  b.className = "shop-item" + (on ? " on" : "") + (isPrize(it) ? " excl" : "") + (it.tour ? " tour-prize" : "") + (it.streak ? " streak-prize" : "") + (!mine && isPrize(it) && !won ? " locked" : "");
  b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(shop.sel === it.id));
  b.innerHTML = `<span class="sw"></span><span class="si-name"></span><span class="si-state"></span>`;
  fillSwatch(b.querySelector(".sw"), it);
  b.querySelector(".si-name").textContent = it.name;
  const st = b.querySelector(".si-state");
  if (on) { st.textContent = "Equipado"; st.className += " is-on"; }
  else if (mine) st.textContent = "Usar";
  else if (isPrize(it)) {
    st.innerHTML = won ? "" : `<svg aria-hidden="true"><use href="#lock"/></svg>`;
    st.append(won ? "¡Reclámalo!" : prizeLock(it));
    st.className += won ? " is-claim" : " is-lock";
  } else {
    st.innerHTML = `<svg aria-hidden="true"><use href="#pick"/></svg>`;
    st.append(fmtPicks(it.price));
    st.className += " is-price" + (app.wallet && app.wallet.picks < it.price ? " short" : "");
  }
  b.onclick = () => selectShopItem(it.id);
  return b;
}
// the card's little picture: the catalog's CSS, plus gems, flames, a name or a streak drawn with elements
function fillSwatch(el, it) {
  el.className = `sw sw-${it.slot}`;
  if (it.sw) el.style.background = it.sw;
  if (it.slot === "gems") {
    el.classList.add("g-" + (it.shape || "round"));
    if (it.ring) el.style.setProperty("--ring", it.ring);
    el.innerHTML = it.cols.map((c) => `<i style="--c:${c}"></i>`).join("");
  } else if (it.slot === "flames") {
    el.classList.toggle("rainbow", !!it.rainbow);
    if (it.glow) el.style.setProperty("--glow", it.glow);
    el.style.setProperty("--c", it.cols[0]); el.style.setProperty("--c2", it.cols[1]);
    // flames that aren't a fire: their own little picture (style.css .fa-*)
    const art = { bubbles: "<i></i>".repeat(7), embers: "<i></i>".repeat(8), nova: "<i></i>", stars: "<i></i>".repeat(5), curtain: "<i></i>".repeat(4),
      bolt: `<svg viewBox="0 0 40 60" aria-hidden="true"><path d="M24 2 9 33h11l-6 25 19-34H21z"/></svg>` }[it.art];
    if (art) { el.classList.add("fa-" + it.art); el.innerHTML = art; }
    else el.innerHTML = it.cols.map((c) => `<svg aria-hidden="true" style="--c:${c}"><use href="#flame"/></svg>`).join("") + (it.art === "campfire" ? "<em></em>".repeat(6) : "");
  } else if (it.slot === "crowd") {
    // five people from behind, holding up what this crowd holds up (style.css .cw-*)
    el.classList.add("cw-" + it.id);
    el.innerHTML = "<b><i></i></b>".repeat(5) + (it.id === "luciernagas" ? "<em></em>".repeat(7) : "");
  } else if (it.slot === "star") {
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`;
  } else if (it.slot === "name") {
    const n = document.createElement("span");
    n.className = it.id === "normal" ? "sw-nm" : `sw-nm nm-${it.id}`;
    n.textContent = settings.name || "Tu nombre";
    el.appendChild(n);
  } else if (it.slot === "streak") {
    const s = document.createElement("span");
    s.className = `st-${it.id}`; s.textContent = "¡Racha!";
    el.appendChild(s);
  }
}
function selectShopItem(id) {
  if (shop.sel === id) return;
  shop.sel = id;
  if (shop.armed && shop.armed !== ownedKey(shop.cat, id)) shop.armed = null;
  $("shopGrid").querySelectorAll(".shop-item").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
  renderShopDetail();
  revealShopSel();
  previewShop();
}
// the picked item: its name, where it stands, and the button (Comprar → ¿Seguro?, Usar, Reclamar, Equipado)
function renderShopDetail() {
  const it = itemOf(shop.cat, shop.sel) || itemOf(shop.cat, equipped[shop.cat]);
  const w = app.wallet, can = !!w && !!account && !shopOffline();
  const on = equipped[it.slot] === it.id, mine = owns(it), won = prizeWon(it);
  const key = ownedKey(it.slot, it.id), btn = $("shopAct"), info = $("sdInfo");
  $("sdName").textContent = it.name;
  info.textContent = on ? "Lo tienes puesto." : mine ? (isDefault(it) ? "El de siempre." : "Es tuyo.")
    : it.lvl ? (won ? `${prizeOf(it)}: es tuyo gratis.` : `${it.desc || prizeOf(it)} Vas en el nivel ${w?.level || 1}.`)
    : it.tour ? (won ? `Lo ganaste en la gira: es tuyo gratis.` : it.desc)
    : it.streak ? (won ? `Lo ganaste con tu racha de la canción del día: es tuyo gratis.` : it.desc)
    : it.req ? (won ? `Ganaste el logro «${achName(it.req)}»: es tuyo gratis.` : it.desc || `Se gana con el logro «${achName(it.req)}».`)
    : w && w.picks < it.price ? `Te faltan ${fmtPicks(it.price - w.picks)} púas. Las ganas terminando canciones.`
    : it.desc || "";
  // your name, as everyone will see it on the boards
  if (it.slot === "name") {
    const n = document.createElement("span");
    n.className = it.id === "normal" ? "sd-me" : `sd-me nm-${it.id}`;
    n.textContent = settings.name || "Tu nombre";
    info.textContent = (isPrize(it) && !mine ? (won ? "Es tuyo gratis. " : `Se gana con: ${prizeLock(it)}. `) : "") + "Así te verán todos: "; info.appendChild(n);
  }
  const armed = shop.armed === key;
  btn.classList.toggle("armed", armed);
  btn.classList.toggle("primary", !on);
  btn.classList.toggle("is-on", on);
  btn.textContent = on ? "Equipado" : mine ? "Usar" : isPrize(it) ? (won ? "Reclamar" : "Bloqueado")
    : armed ? `¿Seguro? ${fmtPicks(it.price)} púas` : `Comprar · ${fmtPicks(it.price)}`;
  btn.disabled = on || shop.busy || !can || (!mine && (isPrize(it) ? !won : w.picks < it.price));
}
$("shopCats").onclick = (e) => {
  const b = e.target.closest("button[data-c]");
  if (!b || b.dataset.c === shop.cat) return;
  shop.cat = b.dataset.c; shop.sel = equipped[shop.cat]; shop.armed = null;
  $("shopGrid").scrollTop = 0; $("shopGrid").scrollLeft = 0;
  renderShop();
  // the chip in view too (on a phone the categories scroll sideways)
  const cats = $("shopCats"), cr = cats.getBoundingClientRect(), br = b.getBoundingClientRect();
  if (br.right > cr.right) cats.scrollLeft += br.right - cr.right + 12; else if (br.left < cr.left) cats.scrollLeft -= cr.left - br.left + 12;
  previewShop();
};
$("shopAct").onclick = () => {
  const it = itemOf(shop.cat, shop.sel);
  if (!it || shop.busy || equipped[it.slot] === it.id) return;
  if (owns(it)) return shopDo("equip", it);
  if (isPrize(it)) return shopDo("buy", it); // a logro's or a level's prize: claimed, nothing to confirm
  // buying asks twice: "Comprar · 300" → "¿Seguro? 300 púas"
  const key = ownedKey(it.slot, it.id);
  if (shop.armed !== key) {
    shop.armed = key; renderShopDetail();
    clearTimeout(shop.armT);
    shop.armT = setTimeout(() => { if (shop.armed === key) { shop.armed = null; if (app.screen === "tienda") renderShopDetail(); } }, 5000);
    return;
  }
  shop.armed = null;
  shopDo("buy", it);
};
$("shopAccount").onclick = () => openWelcome(settings.name || "");
async function shopDo(kind, it) {
  if (!account || shopOffline()) return;
  shop.busy = true; shop.seq++; renderShopDetail();
  let r = null;
  try {
    r = await (kind === "buy" ? shopBuy : shopEquip)(playerSecret(), it.slot, it.id);
    // a logro won on this device that the account hasn't heard of yet: send it, then ask again
    if (r?.error === "locked" && it.req && achievementsWon()[it.req]) { await syncNow(); r = await shopBuy(playerSecret(), it.slot, it.id); }
  } catch (e) { console.warn("shop:", e.message); toast("No se pudo conectar con la tienda. Revisa tu conexión."); }
  shop.busy = false;
  if (r && !r.error) {
    setWallet(r);
    if (kind === "buy") {
      sfx.unlock();
      const slot = SLOTS.find((s) => s.id === it.slot).name;
      celebrate({ kicker: isPrize(it) ? "Premio reclamado" : "¡Es tuyo!", title: it.name, kind: "shop", ms: 2600,
        sub: isPrize(it) ? `${slot}: ya lo tienes puesto. ${prizeOf(it)}.` : `${slot}: ya lo tienes puesto. Te quedan ${fmtPicks(app.wallet.picks)} púas.` });
    }
  } else if (r?.error) {
    toast(SHOP_ERRORS[r.error] || "No se pudo.");
    refreshWallet(); // whatever happened, show what the server has
  }
  if (app.screen === "tienda") renderShop();
}
addEventListener("online", () => { if (app.screen === "tienda") renderShop(); });
addEventListener("offline", () => { if (app.screen === "tienda") renderShop(); });

/* ---------- what a run earned (results) ---------- */
let picksRun = 0; // the run the "+N púas" row is about: a late answer about an older one only updates the balance
let picksTop = { run: -1, v: 0 };
function gotPicks(p, run, row = true) {
  if (!p || typeof p !== "object") return;
  let bal = Math.floor(+p.balance);
  if (app.wallet && Number.isFinite(bal) && bal >= 0) {
    // a song of the day sends two answers (the run and the day's bonus) that can arrive in either order: the bigger is the newer
    if (picksTop.run === run) bal = Math.max(bal, picksTop.v);
    picksTop = { run, v: bal };
    app.wallet.picks = bal; renderPicks();
  }
  if (!row || run !== picksRun) return;
  const earned = Math.max(0, Math.floor(+p.earned || 0));
  const parts = [];
  if (+p.base > 0) parts.push(`${fmtPicks(p.base)} por la canción`);
  if (p.first) parts.push(`primera vez +${typeof p.first === "number" ? p.first : 15}`);
  if (p.record) parts.push(`récord +${typeof p.record === "number" ? p.record : 10}`);
  // the day's challenges done with this run, and a new level (progress.sql)
  const chs = Array.isArray(p.challenges) ? p.challenges : [], lv = p.level && typeof p.level === "object" ? p.level : null;
  const extra = chs.reduce((s, c) => s + (+c.r || 0), 0) + (+p.all || 0) + (lv ? +lv.reward || 0 : 0);
  const won = chs.map((c) => `reto «${chText(c)}» +${c.r}`);
  if (+p.all > 0) won.push(`los tres retos +${p.all}`);
  if (lv) won.push(`nivel ${lv.to} +${lv.reward}`);
  if (p.reason !== "cooldown") refreshWallet(); // the challenges' progress on the home menu's card
  if (lv) {
    const prize = ITEMS.find((it) => it.lvl && it.lvl > lv.from && it.lvl <= lv.to);
    celebrate({ kicker: "¡Subiste de nivel!", title: `Nivel ${lv.to}`, kind: "shop", ms: 3200,
      sub: `+${fmtPicks(lv.reward)} púas` + (prize ? ` · Ya puedes reclamar «${prize.name}» en la Tienda` : "") });
  } else if (chs.length) {
    celebrate({ kicker: +p.all > 0 ? "¡Retos de hoy completos!" : "¡Reto cumplido!", title: chText(chs[0]), kind: "shop", ms: 2800,
      sub: `+${fmtPicks(extra)} púas` });
  }
  const total = earned + extra;
  $("picksMsg").textContent = total > 0 ? `+${fmtPicks(total)} púas` : "Sin púas esta vez";
  $("picksSub").textContent = p.reason === "cooldown" ? "Terminaste canciones muy seguidas: la próxima sí cuenta."
    : p.reason === "cap" ? [earned > 0 ? "Llegaste al máximo de púas de hoy. Mañana ganas más." : "Ya ganaste el máximo de púas de hoy. Mañana ganas más.", ...won].join(" · ")
    : [...parts, ...won].join(" · ");
  $("picksRes").classList.toggle("none", !(total > 0));
  $("picksRes").hidden = false;
}

async function sendScore(sum, quiet = false) {
  if (!(sum.score > 0)) { if (!quiet) showBoard($("resultsBoard")); return; } // empty runs stay off the board
  const run = picksRun;
  try {
    const r = await submitScore({ song_id: app.song.id, diff: app.diff, lanes: app.lanes, secret: playerSecret(), name: settings.name,
      score: sum.score, acc: sum.acc, max_combo: sum.maxCombo, stars: sum.stars });
    if (r.picks) gotPicks(r.picks, run);
    if (run !== picksRun || quiet) return; // the player already started another song (or the room shows its own)
    $("newRecord").hidden = !r.newRecord;
    showBoard($("resultsBoard"));
  } catch (e) { console.warn("leaderboard:", e.message); if (!quiet) showBoard($("resultsBoard")); }
}
$("nameAsk").onsubmit = (e) => {
  e.preventDefault();
  const name = $("boardName").value.trim().replace(/\s+/g, " ").slice(0, 16);
  if (!name) { $("boardName").focus(); return; }
  settings.name = name; save();
  $("nameAsk").hidden = true;
  if (app.pendingScore) { sendScore(app.pendingScore); app.pendingScore = null; }
  if (app.pendingDaily) { sendDaily(...app.pendingDaily); app.pendingDaily = null; }
};
let boardReq = 0;
// The game picks the board by itself, never shown to the player: the strings really used.
// A difficulty whose chart never touches the 5th string is the same on 4 or 5, so it counts for 4
// (same rule as the server); difficulty/expert played with 5 strings count for 5.
async function showBoard(el) {
  if (!hasBoard()) { el.hidden = true; return; }
  el.hidden = false;
  // a secret song has no weekly board
  const per = el.querySelector(".period"); if (per) per.hidden = !!app.song.secret;
  const period = app.song.secret ? "all" : settings.boardPeriod;
  const fifth = (app.song.diffs?.[app.diff]?.lanes || [4]).includes(4);
  const lanes = (app.boardLanes || deviceLanes()) === 5 && fifth ? 5 : 4;
  const req = ++boardReq;
  let rows = [];
  try {
    // a secret song's board needs the code (a friend who joined a room without it sees none)
    if (app.song.secret) { const c = codeOfGroup(app.song.secret); rows = c ? await secretBoard(c, app.song.id, app.diff, lanes) : []; }
    else rows = await topScores(app.song.id, app.diff, lanes, undefined, period);
  } catch (e) { console.warn("leaderboard:", e.message); }
  if (req !== boardReq) return;
  const ol = el.querySelector(".board-list"); ol.innerHTML = "";
  const me = (settings.name || "").trim().toLowerCase();
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (me && r.name.trim().toLowerCase() === me) li.className = "me";
    li.innerHTML = `<span class="pos">${i + 1}</span><span class="n"></span><span class="a">${Math.round((r.acc || 0) * 100)}%</span><span class="s">${r.score.toLocaleString("es-CO")}</span>`;
    li.querySelector(".n").textContent = r.name;
    styledName(li.querySelector(".n"), r.name);
    ol.appendChild(li);
  });
  const empty = el.querySelector(".board-empty");
  empty.hidden = rows.length > 0;
  empty.textContent = period === "week" ? "Nadie ha tocado esta dificultad esta semana." : "Nadie ha tocado esta dificultad todavía.";
  scrollToMe(ol);
  // after a run: your place on the board you're looking at
  if (el.id === "resultsBoard") {
    const pos = me ? rows.findIndex((r) => r.name.trim().toLowerCase() === me) + 1 : 0;
    $("boardMe").hidden = !pos;
    if (pos) $("boardMe").textContent = period === "week" ? `Tu puesto esta semana: #${pos}` : `Tu mejor puesto: #${pos}`;
  }
}
// your own row in view (a long board scrolls inside itself)
function scrollToMe(ol) {
  const mine = ol.querySelector("li.me");
  ol.scrollTop = mine ? Math.max(0, mine.offsetTop - ol.offsetTop - ol.clientHeight / 2 + mine.offsetHeight / 2) : 0;
}
// "Semana" / "Siempre" on every board: one choice for all of them, remembered
function paintPeriods() { document.querySelectorAll(".seg.period button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === settings.boardPeriod))); }
document.querySelectorAll(".seg.period").forEach((seg) => seg.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.dataset.p === settings.boardPeriod) return;
  settings.boardPeriod = b.dataset.p; save(); paintPeriods();
  const board = seg.closest(".board");
  if (board.id === "homeBoard") renderHomeBoard(); else showBoard(board);
}));
paintPeriods();
$("shareBtn").onclick = async () => {
  const sum = app.lastSummary, s = app.song;
  if (!sum || !s) return;
  const b = $("shareBtn"); b.disabled = true;
  const diffName = DIFFS.find((d) => d.key === app.diff)?.name || "";
  const link = s.id && s.id !== "local" ? retoUrl({ songId: s.id, diff: app.diff, score: sum.score, name: settings.name }) : "";
  // copied right away, while the tap still counts: Instagram doesn't take the link, it goes in the link sticker
  let copied = null;
  if (link) copied = navigator.clipboard?.writeText(link).then(() => true, () => false);
  const text = link ? `Saqué ${sum.score.toLocaleString("es-CO")} en ${s.name} (${diffName}) 🎸 ${link}` : "";
  try {
    const how = await shareCard({
      song: s.name, artist: s.artist, diff: DIFFS.find((d) => d.key === app.diff)?.name || "", lanes: app.lanes,
      score: sum.score, stars: sum.stars, acc: sum.acc, maxCombo: sum.maxCombo, hits: sum.hits, total: sum.total,
      player: settings.name || "", nameStyle: app.wallet ? equipped.name : "normal", level: app.wallet?.level || 0, record: app.shareRecord, cover: s.id && s.id !== "local" ? coverOf(s) : "",
    }, text);
    if (how !== "cancelled" && copied && (await copied)) toast("Link del reto copiado: pégalo en el sticker de link de tu historia.", 4500);
    if (how !== "cancelled") { const f = unlock(["al-escenario"]); if (f.length) { celebrateAchievements(f); syncSoon(); } }
  } catch (e) { toast("No se pudo crear la imagen."); }
  b.disabled = false;
};
$("againBtn").onclick = () => startGame({ lanes: app.lanes, diff: app.diff, duo: app.duo, ctx: againCtx() });
$("homeBtn").onclick = () => { clearTimeout(app.celTimer); app.duo = null; app.mode = "solo"; app.history = []; show("home", false); };
$("menuBtn").onclick = () => {
  if (app.mode === "mp") { tallyCup(true); renderLobby(); show("lobby", false); }
  else if (app.ctx?.kind === "tour") { clearTimeout(app.celTimer); app.history = ["home"]; openTour(false); }
  else if (app.ctx?.kind === "daily" && !app.ctx.via) { clearTimeout(app.celTimer); app.history = ["home"]; openDaily(false); }
  else if (app.duo) { app.duo = null; app.mode = "solo"; app.history = []; show("home", false); }
  else { app.history = ["home"]; show("library", false); }
};

/* ================= input ================= */
function laneForKey(k) {
  if (!app.game) return -1;
  const i = settings.keys.slice(0, app.lanes).indexOf(k);
  if (i >= 0) return i;
  const n = "12345".indexOf(k); // the number keys play too, unless star power or pause took one of them
  return n >= 0 && n < app.lanes && k !== settings.starKey && k !== settings.pauseKey ? n : -1;
}
const evTime = (e, g = app.game) => g.time() - Math.max(0, (performance.now() - e.timeStamp) / 1000);
// the key being changed in Settings: a string's index (0-4), "star" or "pause"; null when none
let rebinding = null;
const bindKey = (b) => (b === "star" ? settings.starKey : b === "pause" ? settings.pauseKey : settings.keys[b]);
function setBindKey(b, k) { if (b === "star") settings.starKey = k; else if (b === "pause") settings.pauseKey = k; else settings.keys[b] = k; }
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (calib.on) { e.preventDefault(); if (!e.repeat) calibTap(); return; }
  if (rebinding !== null) { e.preventDefault(); finishRebind(k === "escape" ? null : k); return; }
  if (duoRebind && app.screen === "duo") { e.preventDefault(); finishDuoRebind(e); return; }
  if (!app.game) return;
  // Esc always pauses; the pause key too (two players: Space, unless one of them plays with it)
  const pauseKey = k === "escape" || (app.duo ? k === " " && !duoKey("Space") : k === settings.pauseKey);
  if (pauseKey) {
    e.preventDefault();
    if (app.screen === "settings" && app.settingsFromPause) { backToPause(); return; }
    app.paused ? resumeGame() : pauseGame(); return;
  }
  if (e.repeat || app.paused || app.failing) return;
  if (app.duo) {
    const hit = duoKey(e.code), g = hit && app.duoGames?.[hit.p];
    if (!g) return;
    e.preventDefault();
    if (hit.i === STAR_SLOT) activateStar(g); else g.press(hit.i, evTime(e, g));
    return;
  }
  const lane = laneForKey(k);
  if (lane >= 0) { e.preventDefault(); app.game.press(lane, evTime(e)); }
  else if (k === settings.starKey) { e.preventDefault(); activateStar(); }
});
addEventListener("keyup", (e) => {
  if (app.duo) { const hit = duoKey(e.code), g = hit && app.duoGames?.[hit.p]; if (g && hit.i < STAR_SLOT) g.release(hit.i); return; }
  const lane = laneForKey(e.key.toLowerCase()); if (lane >= 0 && app.game) app.game.release(lane);
});

// Fingers go through touch events, whose touchstart can be cancelled: on an iPhone that stops the long-press and
// double-tap gestures (the magnifier) from taking over the screen, and with them the next taps of a fast run.
// The mouse and pens stay on pointer events.
const pointerLane = new Map(), touchLane = new Map();
canvas.addEventListener("touchstart", (e) => {
  if (!app.game) return;
  e.preventDefault();
  if (app.paused || app.failing) return;
  const rect = canvas.getBoundingClientRect(), t0 = evTime(e);
  for (const t of e.changedTouches) {
    const lane = R.laneFromClientX(t.clientX, rect);
    touchLane.set(t.identifier, lane);
    app.game.press(lane, t0);
  }
}, { passive: false });
const touchUp = (e) => {
  for (const t of e.changedTouches) {
    if (!touchLane.has(t.identifier)) continue;
    const lane = touchLane.get(t.identifier); touchLane.delete(t.identifier);
    if (app.game && ![...touchLane.values()].includes(lane)) app.game.release(lane);
  }
};
["touchend", "touchcancel"].forEach((t) => canvas.addEventListener(t, touchUp));
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" || !app.game || app.paused || app.failing) return;
  e.preventDefault();
  const lane = R.laneFromClientX(e.clientX, canvas.getBoundingClientRect());
  pointerLane.set(e.pointerId, lane);
  app.game.press(lane, evTime(e));
});
const pointerUp = (e) => {
  if (!pointerLane.has(e.pointerId)) return;
  const lane = pointerLane.get(e.pointerId); pointerLane.delete(e.pointerId);
  if (app.game && ![...pointerLane.values()].includes(lane)) app.game.release(lane);
};
["pointerup", "pointercancel", "pointerleave"].forEach((t) => canvas.addEventListener(t, pointerUp));

/* ================= HUD ================= */
// One HUD block per player: score, multiplier with the star meter, rock meter and their pop-ups.
// The second block (two players on one PC) is a copy of the first one.
function makeHud(root) {
  const q = (sel) => root.querySelector(sel);
  const ring = q(".mult-ring");
  ring.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const a0 = (i / 10) * Math.PI * 2 + 0.09, a1 = ((i + 1) / 10) * Math.PI * 2 - 0.09, r = 26;
    const pt = (a) => `${32 + r * Math.cos(a)} ${32 + r * Math.sin(a)}`;
    return `<path d="M${pt(a0)} A${r} ${r} 0 0 1 ${pt(a1)}" stroke-width="6" fill="none" stroke-linecap="butt"/>`;
  }).join("");
  return {
    root, mult: q(".mult"), multText: q(".mult b"), ringSegs: [...ring.children], starFill: q(".star-ring .fill"),
    score: q(".score"), combo: q(".combo span"), name: q(".p-name"), rock: q(".rock"), needle: q(".rk-needle-g"),
    starPop: q(".star-pop"), judge: q(".judge"), streak: q(".streak"), cache: {}, judgeT: 0, streakT: 0, gainT: 0,
  };
}
const huds = [makeHud($("hudP1"))];
function duoHud() {
  if (!huds[1]) {
    const el = $("hudP1").cloneNode(true);
    el.id = "hudP2"; el.classList.replace("p1", "p2");
    el.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    el.querySelector(".mult").removeAttribute("role");
    $("hudP1").after(el);
    huds.push(makeHud(el));
  }
  return huds[1];
}
// two players: their names over the scores, and the screen split down the middle
function setDuoHud(duo) {
  $("hud").classList.toggle("duo", !!duo);
  huds.forEach((h, k) => {
    h.name.hidden = !duo;
    if (duo) h.name.textContent = duo.names[k];
    h.root.hidden = !duo && k > 0;
  });
}
let lastSection = -2;
function streak(text, h = huds[0]) {
  const el = h.streak; el.textContent = text;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(h.streakT); h.streakT = setTimeout(() => el.classList.remove("show"), 1700);
}
function judge(text, color, g = app.game) {
  const h = g.ui.hud, j = h.judge;
  j.textContent = text; j.style.color = color;
  j.style.top = Math.max(80, R.strikeScreenY(g.ui.p) - 130) + "px";
  j.classList.add("show"); clearTimeout(h.judgeT); h.judgeT = setTimeout(() => j.classList.remove("show"), 60);
}
// Only touch the DOM when a value actually changed (keeps layout/paint out of most frames).
const setIn = (cache, k, v, fn) => { if (cache[k] !== v) { cache[k] = v; fn(v); } };
const sharedCache = {};
function updatePlayerHud(g) {
  const h = g.ui.hud, set = (k, v, fn) => setIn(h.cache, k, v, fn);
  set("score", Math.round(g.score), (v) => (h.score.textContent = v.toLocaleString("es-CO")));
  set("combo", g.combo, (v) => (h.combo.textContent = v));
  const m = g.baseMultiplier, shown = g.multiplier;
  const starState = g.starOn ? " star-on" : g.starMeter >= STAR_READY && g.ui.starShown ? " star-ready" : "";
  set("mult", shown + starState, () => { h.multText.textContent = "×" + shown; const gain = h.mult.classList.contains("gain"); h.mult.className = "mult x" + m + starState + (gain ? " gain" : ""); });
  const fill = g.levelFill;
  set("ring", m * 100 + fill + (g.starOn ? 1000 : 0), () => {
    const col = g.starOn ? starHex : ["#f2e8d8", "#f5c518", "#1fd14a", "#ff7a1a"][m - 1];
    h.ringSegs.forEach((sg, i) => sg.setAttribute("stroke", i < fill ? col : "rgba(255,255,255,.1)"));
  });
  if (g.ui.starShown) set("star", Math.round(g.starMeter * 100), (v) => h.starFill.setAttribute("stroke-dasharray", `${v} 100`));
  // rock meter needle: -60° (red, about to fail) … +60° (green)
  set("rock", Math.round(g.rock * 60), (v) => (h.needle.style.transform = `rotate(${(v / 60) * 120 - 60}deg)`));
  set("danger", g.canFail && g.rock < 0.25, (v) => h.rock.classList.toggle("danger", v));
}
function updateHUD(g, t) {
  const set = (k, v, fn) => setIn(sharedCache, k, v, fn);
  for (const x of games()) updatePlayerHud(x);
  set("prog", Math.round(Math.max(0, Math.min(1, t / g.end)) * 400), (v) => ($("progress").style.transform = `scaleX(${v / 400})`));
  const si = g.section(t);
  if (si !== lastSection) { lastSection = si; $("section").textContent = si >= 0 ? sectionName(g.sections[si][1], si) : ""; R.setSection(Math.max(0, si)); }
  const left = (g.countdownUntil || 0) - t;
  set("cd", left > 0 && left <= 3.2 ? Math.ceil(left) : "", (v) => ($("countdown").textContent = v));
  // timers: after a pause (until the notes come back) and in long stretches without notes.
  // Both disappear before the next notes reach the top of the highway so they never cover them.
  // (Two players have different notes, so the "no notes" timer is only for one.)
  let until = null, from = 0, label = false;
  if (g.resumeAt != null && t < g.resumeAt) { until = g.resumeAt; from = g.resumeFromT; }
  else if (!app.duo) { const gap = g.gapAt(t); if (gap && t >= gap[0] + 1) { until = gap[1]; from = gap[0]; label = true; } }
  const showT = until != null && until - t > g.look + 0.4 && left <= 0;
  set("gap", showT ? Math.ceil(until - t) + (label ? "g" : "r") : "", (v) => {
    $("gap").hidden = !v;
    if (v) { $("gapSecs").textContent = parseInt(v); $("gapLabel").hidden = !v.endsWith("g"); }
  });
  if (showT) $("gapBar").style.transform = `scaleX(${Math.max(0, (until - t) / Math.max(1, until - from))})`;
}

/* ================= main loop ================= */
// Beats on screen, found by moving a cursor instead of filtering the whole list every frame.
let beatCursor = { arr: null, i: 0 };
function visibleBeats(beats, t, look) {
  if (beatCursor.arr !== beats) beatCursor = { arr: beats, i: 0 };
  let i = beatCursor.i;
  while (i > 0 && beats[i - 1][0] > t - 2) i--;
  while (i < beats.length && beats[i][0] <= t - 2) i++;
  beatCursor.i = i;
  let j = i; while (j < beats.length && beats[j][0] < t + look) j++;
  return beats.slice(i, j);
}
// what each neck shows; one player passes it straight, two pass { players: [...] }
function neckState(g, t, beats, from = g.next) {
  return { t, look: g.look, notes: g.notes, from, pressed: g.pressed, beats, star: g.starOn, starReady: g.starMeter >= STAR_READY && !g.starOn && g.ui.starShown };
}
function renderGames(gs, t, dt, from) {
  const beats = visibleBeats(gs[0].beats, t, gs[0].look);
  const necks = gs.map((g) => neckState(g, t, beats, from ?? g.next));
  if (gs.length === 1) R.render({ ...necks[0], dt, energy: en.e, punch: en.p, calm: en.c });
  else R.render({ players: necks, dt, energy: en.e, punch: en.p, calm: en.c });
}
function onGameEvent(g, ev, now) {
  const p = g.ui.p, h = g.ui.hud;
  if (ev.type === "hit") {
    R.hit(ev.lane, ev.sustain, p);
    if (Math.abs(ev.err) <= 0.045) judge("Perfecto", "#f5c518", g);
    if (g.combo > 0 && g.combo % 50 === 0) { streak(`¡Racha de ${g.combo}!`, h); if (g.combo % 100 === 0) R.pyro(); }
  }
  else if (ev.type === "hold") R.holdSpark(ev.lane, p);
  else if (ev.type === "miss" || ev.type === "ghost") judge("Fallo", "#ff2a22", g);
  else if (ev.type === "starPhrase") {
    R.starPhrase(p); sfx.starChime();
    g.ui.starShown = false; starComet(g, ev.lane);
    if (ev.ready && !g.ui.starWasReady) {
      g.ui.starWasReady = true;
      setTimeout(() => app.game && games().includes(g) && !g.starOn && sfx.starReady(), 640);
      if (!app.duo) tip.at = now + 2600;
    }
    else if (ev.ready && !g.starOn && $("spTip").hidden && !app.duo) tip.at = now + 1400;
  }
  else if (ev.type === "starOn") {
    const el = h.starPop; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); sfx.starOn(); hideStarTip(); g.ui.starWasReady = false;
    if (battleOn() && g === app.game) launchAttack();
  }
  else if (ev.type === "fail") failSong();
}
let prev = performance.now(), lastNet = 0;
const en = { e: 0.55, p: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  // the admin converting or separating songs: the stage stands still, every core goes to that work
  if (adminWorking()) { prev = now; return; }
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  const g = app.game, gs = games();
  if (g && app.rewinding) {
    const rw = app.rewinding, k = Math.min(1, (now - rw.start) / rw.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
    const t = rw.from + (rw.to - rw.from) * e;
    energyAt(app.energy, t - g.offset + g.songOffset, en);
    renderGames(gs, t, dt, 0);
    if (k >= 1 && !rw.done) {
      rw.done = true;
      g.player.resume().then(() => { gs.forEach((x, i) => x.resumeFrom(rw.to, i === 0)); app.rewinding = null; app.paused = false; });
    }
    return;
  }
  if (g) {
    const t = g.time();
    if (!app.paused && !app.failing) for (const x of gs) x.update(x === g ? t : x.time());
    for (const x of gs) { for (const ev of x.events) onGameEvent(x, ev, now); x.events.length = 0; }
    // practice: when the part is over, rewind to its start and play it again
    if (app.practice && !app.paused && !app.rewinding && t > app.practice.loopAt) {
      app.paused = true; g.player.pause(); g.restartPractice();
      app.rewinding = { from: t, to: Math.max(0, app.practice.from - 3), start: now, dur: 1100 };
    }
    if (tip.at && now >= tip.at && !g.starOn && g.starMeter >= STAR_READY && !app.paused) {
      tip.at = 0;
      // on a phone: until it's been used a few times; with a keyboard once is enough (the chime and the glowing meter say it)
      if (touch ? (settings.starActs || 0) < 3 : !settings.starTipSeen) {
        settings.starTipSeen = true; save();
        tip.hideAt = now + 5500; $("spTipHow").textContent = starTipHow(); $("spTip").hidden = false;
      }
    }
    if (tip.hideAt && (now >= tip.hideAt || g.starOn || app.paused)) { tip.hideAt = 0; $("spTip").hidden = true; }
    const rock = gs.reduce((a, x) => a + x.rock, 0) / gs.length, combo = Math.max(...gs.map((x) => x.combo));
    R.setHype(Math.min(1, 0.15 + rock * 0.65 + Math.min(0.2, combo / 250)));
    energyAt(app.energy, t - g.offset + g.songOffset, en);
    renderGames(gs, t, dt);
    updateHUD(g, t);
    if (app.mode === "mp" && app.room && now - lastNet > 300) {
      lastNet = now;
      app.room.send("score", { name: app.me.name, score: Math.round(g.score), combo: g.combo, acc: g.accuracy, hits: g.hits });
      app.rivals[app.me.id] = { name: app.me.name, score: Math.round(g.score), combo: g.combo, acc: g.accuracy, me: true };
      renderRivals();
    }
    if (app.mode === "mp") updateFx(now);
    if (gs.every((x) => x.ended)) finishGame();
  } else {
    // attract mode behind the menus: the menu song's own notes, in time with it (or a demo pattern when it's silent)
    const m = music.show();
    let t, notes, beats, energy = 0.55, punch = 0, calm = 0;
    if (m) { t = m.t; notes = m.notes; beats = m.beats; energy = m.energy; punch = m.punch; calm = m.calm; }
    else { t = now / 1000 % (demo.notes[demo.notes.length - 1].t - 2); notes = demo.notes; beats = demo.beats; }
    if (attract.notes !== notes) { attract.notes = notes; demoNext = 0; notes.forEach((n) => (n.state = 0)); while (demoNext < notes.length && notes[demoNext].t < t - 0.05) notes[demoNext++].state = 1; }
    if (demoNext > 0 && notes[demoNext - 1].t > t + 0.05) { demoNext = 0; notes.forEach((n) => (n.state = 0)); while (demoNext < notes.length && notes[demoNext].t < t - 0.05) notes[demoNext++].state = 1; }
    const pressed = [false, false, false, false, false];
    while (demoNext < notes.length && notes[demoNext].t <= t) {
      const n = notes[demoNext++]; n.state = 1; R.hit(n.lane, !!n.dur);
    }
    const from = Math.max(0, demoNext - 12);
    for (let i = from; i < demoNext; i++) { const n = notes[i]; n.holding = !!(n.dur && t < n.t + n.dur); if (n.holding) { pressed[n.lane] = true; R.holdSpark(n.lane); } }
    R.setHype(0.6);
    R.render({ t, look: 1.6, notes, from, pressed, beats: visibleBeats(beats, t, 1.6), dt, energy, punch, calm });
  }
}
requestAnimationFrame(frame);

/* ================= settings screen ================= */
function renderSettings() {
  const box = $("keycaps"); box.innerHTML = "";
  settings.keys.forEach((k, i) => {
    const b = document.createElement("button");
    b.className = "keycap" + (rebinding === i ? " listening" : "");
    b.style.setProperty("--c", `var(${LANE_CSS[i]})`);
    b.textContent = rebinding === i ? "…" : keyLabel(k);
    b.setAttribute("aria-label", `Tecla para la cuerda ${i + 1}: ${keyLabel(k)}`);
    b.onclick = () => { rebinding = i; renderSettings(); $("keysHint").textContent = "Presiona una tecla (Esc para cancelar)."; };
    box.appendChild(b);
  });
  for (const [id, b, what] of [["keyStar", "star", "activar el poder estrella"], ["keyPause", "pause", "pausar"]]) {
    const el = $(id), k = bindKey(b);
    el.className = "keychip" + (rebinding === b ? " listening" : "");
    el.textContent = rebinding === b ? "…" : keyLabel(k);
    el.setAttribute("aria-label", `Tecla para ${what}: ${keyLabel(k)}`);
    el.onclick = () => { rebinding = b; renderSettings(); $("keysHint").textContent = "Presiona una tecla (Esc para cancelar)."; };
  }
  $("keysField").hidden = touch;
  $("motionField").hidden = !(touch && motionAvailable());
  document.querySelectorAll("#starSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === settings.starMode)));
  $("motionTestBox").hidden = settings.starMode === "tap";
  $("starHint").hidden = !motionNeedsPermission();
  renderAccountField();
  $("openAdmin").hidden = !isAdminBrowser() || !online || touch || !!app.game;
  document.querySelectorAll("#laneSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === settings.laneMode));
  document.querySelectorAll("#qualitySeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === settings.gfx));
  document.querySelectorAll("#syncSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === "on") === String(settings.autoSync)));
  const n = deviceLanes();
  $("laneHint").textContent = settings.laneMode === "auto"
    ? `En este dispositivo juegas con ${n} cuerdas. Automático usa 5 en PC y 4 en celular.`
    : settings.laneMode === "4" ? "Siempre 4 cuerdas: las notas naranjas se pasan a las cuerdas de al lado." : "Siempre 5 cuerdas, como Guitar Hero.";
  $("speed").value = settings.speed; $("offset").value = settings.offsetMs;
  $("speedOut").textContent = (+settings.speed).toFixed(1) + " s de vista";
  $("offsetOut").textContent = (settings.offsetMs > 0 ? "+" : "") + settings.offsetMs + " ms";
}
/* ---------- testing the phone's movement (star power) ---------- */
function stopMotionTest() {
  if (!motionTest) return;
  motionTest.stop(); clearTimeout(motionTest.timer); clearTimeout(motionTest.hitT); motionTest = null;
  $("motionLevel").style.transform = "scaleX(0)"; $("motionLevel").parentElement.classList.remove("hit");
  $("motionTest").textContent = "Probar";
}
function sensorList() {
  const s = [motionSeen.accel && "acelerómetro", motionSeen.gyro && "giroscopio", motionSeen.tilt && "inclinación"].filter(Boolean);
  return s.length ? `Sensores que funcionan: ${s.join(", ")}.` : "";
}
$("motionTest").onclick = async () => {
  if (motionTest) { stopMotionTest(); $("motionTestMsg").textContent = "Toca Probar y levanta o sacude el celular."; return; }
  const msg = $("motionTestMsg"), bar = $("motionLevel");
  const ok = await requestMotion(); // from this tap: on iPhone this is where the permission is asked
  if (motionNeedsPermission()) { settings.motion = ok ? "granted" : "denied"; save(); }
  if (!ok) {
    msg.textContent = "El celular no dio permiso de movimiento. En iPhone: Ajustes › Safari › Movimiento y orientación, y vuelve a tocar Probar. Mientras tanto, toca el multiplicador para activar el poder estrella.";
    return;
  }
  onLift(liftStar);
  let got = 0, hits = 0;
  msg.textContent = "Levanta o sacude el celular…";
  $("motionTest").textContent = "Parar";
  const test = (motionTest = { stop: () => {}, timer: 0, hitT: 0 });
  test.stop = watchMotion(({ level, fired }) => {
    got++;
    bar.style.transform = `scaleX(${level.toFixed(3)})`;
    if (!fired) return;
    hits++; sfx.starOn();
    bar.parentElement.classList.add("hit");
    clearTimeout(test.hitT); test.hitT = setTimeout(() => bar.parentElement.classList.remove("hit"), 900);
    msg.textContent = `¡Detectado${hits > 1 ? ` ×${hits}` : ""}! Así se activa el poder estrella. ${sensorList()}`;
  });
  // no readings at all after a moment: the browser isn't passing the sensors to the page
  test.timer = setTimeout(() => {
    if (motionTest !== test || got) return;
    msg.textContent = motionNeedsPermission()
      ? "El celular no está enviando el movimiento. En iPhone: Ajustes › Safari › Movimiento y orientación. Mientras tanto, toca el multiplicador para activar el poder estrella."
      : "El navegador no está enviando el movimiento. En Chrome: toca el candado junto a la dirección › Configuración del sitio › Sensores de movimiento › Permitir. Mientras tanto, toca el multiplicador para activar el poder estrella.";
  }, 2500);
};

function finishRebind(k) {
  const i = rebinding; rebinding = null;
  if (k && k !== "escape") {
    // a key already in use (a string, star power or pause) swaps with this one
    const other = [0, 1, 2, 3, 4, "star", "pause"].find((b) => b !== i && bindKey(b) === k);
    if (other !== undefined) setBindKey(other, bindKey(i));
    setBindKey(i, k); save();
  }
  $("keysHint").textContent = "Haz clic en un botón y presiona la tecla que quieras.";
  renderSettings();
}
$("resetKeys").onclick = () => { resetKeys(); renderSettings(); };
document.querySelectorAll("#laneSeg button").forEach((b) => (b.onclick = () => { settings.laneMode = b.dataset.v; save(); renderSettings(); }));
// picking a quality by hand also tests this machine again (in case a safe mode was found before)
document.querySelectorAll("#qualitySeg button").forEach((b) => (b.onclick = () => { settings.gfx = b.dataset.v; save(); R.retestGraphics(); R.setQualityLevel(settings.gfx); renderSettings(); }));
document.querySelectorAll("#starSeg button").forEach((b) => (b.onclick = () => {
  settings.starMode = b.dataset.v; save();
  if (settings.starMode === "tap") stopMotionTest(); else if (liftOn()) onLift(liftStar);
  renderSettings();
}));
document.querySelectorAll("#syncSeg button").forEach((b) => (b.onclick = () => { settings.autoSync = b.dataset.v === "on"; save(); if (app.game) app.game.autoSync = settings.autoSync; renderSettings(); }));
$("speed").oninput = (e) => { settings.speed = +e.target.value; save(); renderSettings(); };
$("offset").oninput = (e) => { settings.offsetMs = +e.target.value; save(); renderSettings(); };

/* ---------- sync calibration: one bar to catch the beat, then tap along while it keeps sounding ---------- */
const CAL_BEAT = 0.6, CAL_LISTEN = 4, CAL_TAPS = 8; // 100 bpm: one bar only to listen, then two bars to tap on
const calib = { on: false, clicks: [], taps: [], tapFrom: 0, raf: 0, timer: 0 };
const calibIntro = "Primero suena un compás para que agarres el pulso. Después sigue sonando: pulsa cualquier tecla (o toca la pantalla) con cada golpe.";
const heardNow = (c) => c.currentTime - (c.outputLatency || c.baseLatency || 0);
$("calibBtn").onclick = () => {
  music.pause();
  $("calibText").textContent = calibIntro;
  $("calibDots").innerHTML = "";
  $("calibStart").textContent = "Empezar";
  $("calib").hidden = false;
  $("calibStart").focus();
};
$("calibStart").onclick = () => {
  const c = sfx.calibCtx();
  const t0 = c.currentTime + 0.8;
  const all = Array.from({ length: CAL_LISTEN + CAL_TAPS }, (_, i) => t0 + i * CAL_BEAT);
  all.forEach((t, i) => sfx.metronome(t, i % 4 === 0));
  calib.clicks = all.slice(CAL_LISTEN); // only the beats after the first bar count
  calib.tapFrom = calib.clicks[0] - CAL_BEAT / 2;
  calib.taps = [];
  calib.on = true;
  $("calibStart").hidden = true;
  $("calibText").textContent = "Escucha el compás…";
  const dots = $("calibDots");
  dots.classList.remove("go");
  dots.innerHTML = `<div class="row listen">${"<i></i>".repeat(CAL_LISTEN)}</div><div class="row taps">${"<i></i>".repeat(CAL_TAPS)}</div>`;
  const listen = dots.querySelectorAll(".listen i");
  const tick = () => {
    if (!calib.on) return;
    const now = heardNow(c);
    all.slice(0, CAL_LISTEN).forEach((t, i) => listen[i].classList.toggle("on", now >= t));
    if (now >= calib.tapFrom && !dots.classList.contains("go")) { dots.classList.add("go"); $("calibText").textContent = "¡Ahora! Toca con cada golpe."; }
    calib.raf = requestAnimationFrame(tick);
  };
  tick();
  clearTimeout(calib.timer);
  calib.timer = setTimeout(endCalib, (all[all.length - 1] - c.currentTime + 0.6) * 1000);
};
function calibTap() {
  const t = heardNow(sfx.calibCtx());
  if (t < calib.tapFrom) return; // the first bar is only for listening
  calib.taps.push(t);
  const d = $("calibDots").querySelectorAll(".taps i")[calib.taps.length - 1];
  if (d) d.classList.add("on");
}
$("calib").addEventListener("pointerdown", (e) => { if (calib.on && e.target.tagName !== "BUTTON") calibTap(); });
function endCalib() {
  calib.on = false;
  cancelAnimationFrame(calib.raf);
  const errs = calib.taps
    .map((t) => t - calib.clicks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)))
    .filter((d) => Math.abs(d) < 0.25)
    .sort((a, b) => a - b);
  $("calibStart").textContent = "Otra vez";
  $("calibStart").hidden = false;
  if (errs.length < 5) { $("calibText").textContent = "No alcancé a medir bien. Intenta otra vez: escucha el compás y después toca con cada golpe."; return; }
  const late = Math.round((errs[errs.length >> 1] * 1000) / 5) * 5; // + = the player taps after the beat
  // same direction the automatic sync uses: tapping late pulls the clock back
  settings.offsetMs = Math.max(-250, Math.min(250, -late));
  save();
  renderSettings();
  $("calibText").textContent = late === 0 ? "Vas perfectamente a tiempo: no hace falta corregir nada." : `Listo: corregí ${Math.abs(late)} ms (tocabas ${late > 0 ? "un poco tarde" : "un poco antes"}).`;
}
$("calibClose").onclick = () => {
  calib.on = false;
  cancelAnimationFrame(calib.raf);
  clearTimeout(calib.timer);
  $("calib").hidden = true;
  syncMenuMusic();
  $("calibBtn").focus();
};
R.setQualityLevel(settings.gfx);
// even the plainest drawing comes out black: say so instead of leaving a black stage
R.onGraphicsTrouble = gfxFail;

/* ================= multiplayer ================= */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
// who you are in a room: the same in this tab however often you come in (reconnecting, the page coming back from
// sleep), so the room and its cup never see you as somebody new
function mpId() {
  try { let s = sessionStorage.getItem("corde.mp.id"); if (!s) { s = uid(); sessionStorage.setItem("corde.mp.id", s); } return s; }
  catch { return (app.mpId ||= uid()); }
}
function enterRoom(code, pub = null) {
  const name = $("mpName").value.trim().slice(0, 16);
  if (!name) { $("mpErr").textContent = "Escribe tu nombre."; $("mpErr").hidden = false; return; }
  if (!online) { $("mpErr").textContent = "El multijugador necesita que el juego esté conectado a Supabase."; $("mpErr").hidden = false; return; }
  settings.name = name; save();
  if (app.room) { try { app.room.leave(); } catch {} app.room = null; } // never in two rooms (or twice in one) at once
  try { sessionStorage.setItem("corde.mp.room", JSON.stringify({ code, at: Date.now() })); } catch {} // back in it after a reload
  if (history.state?.corde !== "sala") history.pushState({ corde: "sala" }, ""); // the back gesture stays in the game (see popstate)
  app.me = { id: mpId(), name, lanes: deviceLanes(), device: touch ? "cel" : "pc" };
  app.mode = "mp";
  app.roomConfig = null; app.loadedRoomSong = null;
  app.room = joinRoom(code, app.me, {
    onPeers: (ps) => {
      app.peers = ps; syncConfig(); renderLobby(); if (app.screen === "results") renderCup($("cupRes"), app.roomConfig);
      // a public room holds PUBLIC_MAX: whoever came in past that (two at once) goes back out
      const i = ps.findIndex((p) => p.id === app.me?.id);
      if (ps[0]?.config?.pub && i >= PUBLIC_MAX) { leaveRoom("mp"); toast("Esa sala ya se llenó."); return; }
      announceRoom();
    },
    onEvent: onRoomEvent,
    onStatus: (s) => { if (s === "error") toast("No se pudo conectar a la sala."); },
  });
  $("roomCode").textContent = code;
  if (pub != null) setRoomConfig({ pub }); // a new room: public or private, as picked
  try { navigator.wakeLock?.request("screen").then((l) => (app.lobbyWake = l)).catch(() => {}); } catch {} // a sleeping phone drops out of the room
  renderInvite();
  if (!app.songs.length) loadLibrary().then((s) => { app.songs = s; renderLobby(); }).catch(() => {});
  renderLobby();
  show("lobby");
}
$("createRoom").onclick = () => enterRoom(newRoomCode(), newRoomPub);
// a new room is private unless the player picks public (then it shows in everyone's list)
let newRoomPub = false;
function renderNewRoomVis() { $("newRoomVis").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "pub") === newRoomPub))); }
$("newRoomVis").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; newRoomPub = b.dataset.v === "pub"; renderNewRoomVis(); };
renderNewRoomVis();
// the host turns the room public or private any time
$("roomVis").onclick = (e) => {
  const b = e.target.closest("button"); if (!b || !amHost()) return;
  setRoomConfig({ pub: b.dataset.v === "pub" }); announceRoom();
};
$("joinRoom").onclick = () => {
  const c = $("joinCode").value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) { $("mpErr").textContent = "El código tiene 4 letras."; $("mpErr").hidden = false; return; }
  enterRoom(c);
};
$("roomCode").onclick = () => { navigator.clipboard?.writeText(app.room.code).then(() => toast("Código copiado"), () => {}); };
// Invite: a link that opens the game straight into this room (#sala-ABCD)
const roomLink = (code) => `${location.origin}${location.pathname}#sala-${code}`;
const inviteText = (code) => `¡Ven a tocar conmigo en Corde! Sala ${code}`;
$("inviteBtn").onclick = async () => {
  const code = app.room?.code; if (!code) return;
  const url = roomLink(code);
  if (navigator.share) { try { await navigator.share({ title: "Corde", text: inviteText(code), url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  navigator.clipboard?.writeText(url).then(() => toast("Enlace copiado: pégalo donde quieras"), () => toast(url));
};
function renderInvite() {
  const code = app.room?.code; if (!code) return;
  $("inviteWa").href = `https://wa.me/?text=${encodeURIComponent(`${inviteText(code)}: ${roomLink(code)}`)}`;
}
// opened from an invite: straight into the room (asks for a name first if this browser has none)
// any link (a room, a challenge) waits until this browser has its account: the welcome card asks for the name first
async function waitForName() {
  while (welcome.open || !settings.name) await new Promise((res) => setTimeout(res, 300));
}
async function joinFromLink() {
  const m = location.hash.match(/^#sala-([a-z]{4})$/i);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  const code = m[1].toUpperCase();
  await waitForName();
  $("mpName").value = settings.name; $("mpErr").hidden = true; $("joinCode").value = code;
  $("duoCard").hidden = $("duoOr").hidden = touch;
  show("mp");
  enterRoom(code);
}
setTimeout(joinFromLink, 0);
// The page reloaded while in a room (a phone short of memory, the back gesture and forward again): straight back into
// it, as the same player, if it was a little while ago
async function backToRoom() {
  let r = null; try { r = JSON.parse(sessionStorage.getItem("corde.mp.room") || "null"); } catch {}
  if (!r?.code || Date.now() - r.at > 20 * 60e3 || /^#sala-/i.test(location.hash)) return;
  await waitForName();
  if (app.room) return;
  $("mpName").value = settings.name; $("mpErr").hidden = true; $("joinCode").value = r.code;
  $("duoCard").hidden = $("duoOr").hidden = touch;
  show("mp");
  enterRoom(r.code);
  toast(`Volviste a la sala ${r.code}`);
}
setTimeout(backToRoom, 0);
// In a room, the browser's back (an iPhone's swipe from the edge, easy to do while playing) would leave the page and
// drop you from the room: it stays here instead (from choosing a song it goes back to the room)
addEventListener("popstate", () => {
  if (!app.room) return;
  history.pushState({ corde: "sala" }, "");
  if (app.screen === "library" && app.mode === "pick") { app.mode = "mp"; show("lobby", false); }
  else if (!app.game && app.screen !== "lobby") { renderLobby(); show("lobby", false); }
});
// opened from a challenge link: once there's a name, straight to that song with the score to beat
async function openFromReto() {
  const r = readReto();
  if (!r) return;
  history.replaceState(null, "", location.pathname + location.hash);
  await waitForName();
  app.reto = r;
  const s = await findSong(r.songId);
  if (!s) { app.reto = null; return toast("Esa canción ya no está en Corde."); }
  app.mode = "solo";
  try { await loadLibrarySong(s); openSetup(); }
  catch (e) { toast(e.message); show("home", false); }
}
setTimeout(openFromReto, 0);
addEventListener("hashchange", joinFromLink);
function leaveRoom(to = "home") { try { sessionStorage.removeItem("corde.mp.room"); } catch {} app.room?.leave(); app.room = null; app.mode = "solo"; app.history = []; try { app.lobbyWake?.release(); } catch {} announceRoom(); show(to, false); }
$("leaveRoom").onclick = () => leaveRoom();

/* the open rooms: every room's host tells a shared channel how it's going (net.js roomDirectory); the multiplayer
   screen lists the public ones to join, the admin panel shows all of them live. Only open while one of those is on. */
function syncDir() {
  const need = online && (app.screen === "mp" || !!app.room || (app.screen === "admin" && adminOk));
  if (need && !dir.ch) dir.ch = roomDirectory((l) => { dir.list = l; renderOpenRooms(); renderLiveRooms(); });
  else if (!need && dir.ch) { dir.ch.close(); dir.ch = null; dir.list = []; dir.last = ""; }
  announceRoom();
  renderOpenRooms(); renderLiveRooms(); // the screen that just opened shows what's already known
}
function announceRoom() {
  if (!dir.ch) return;
  let info = null;
  if (app.room && amHost() && app.peers.length) {
    const cfg = app.roomConfig || {}, pub = !!cfg.pub, song = cfg.songId ? app.songs.find((s) => s.id === cfg.songId) : null;
    info = {
      pub, n: app.peers.length, playing: !!app.game, names: app.peers.map((p) => p.name),
      song: song ? (song.secret ? "Canción secreta" : song.name) : "", cup: cfg.plan ? [Math.min(cfg.plan.idx + 1, cfg.plan.songs.length), cfg.plan.songs.length] : null,
      ...(pub ? { code: app.room.code } : {}), // a private room's code never leaves the room
    };
  }
  const k = JSON.stringify(info);
  if (k === dir.last) return;
  dir.last = k;
  dir.ch.set(info && { ...info, at: Date.now() });
}
setInterval(announceRoom, 3000); // a round starting or ending, the song changing
const roomWhat = (r) => (r.playing ? "Tocando" : "Esperando") + (r.song ? ` · ${r.song}` : "") + (r.cup ? ` · copa ${r.cup[0]}/${r.cup[1]}` : "");
function renderOpenRooms() {
  if (app.screen !== "mp") return;
  const rooms = dir.list.filter((r) => r.pub && r.code).sort((a, b) => (a.playing - b.playing) || (a.n - b.n));
  const ul = $("openRooms"); ul.innerHTML = "";
  $("openEmpty").hidden = rooms.length > 0;
  rooms.forEach((r) => {
    const li = document.createElement("li"), full = r.n >= PUBLIC_MAX;
    li.innerHTML = `<div class="or-text"><b></b><small></small></div><span class="or-n"></span><button class="btn"></button>`;
    li.querySelector("b").textContent = `Sala de ${r.names?.[0] || "alguien"}`;
    li.querySelector("small").textContent = roomWhat(r);
    li.querySelector(".or-n").textContent = `${r.n}/${PUBLIC_MAX}`;
    const b = li.querySelector("button");
    b.textContent = full ? "Llena" : r.playing ? "Jugando" : "Entrar";
    b.disabled = full || r.playing; // in the middle of a song: wait for the round to end
    b.onclick = () => { $("joinCode").value = r.code; $("mpErr").hidden = true; enterRoom(r.code); };
    ul.appendChild(li);
  });
}
function renderLiveRooms() {
  if (app.screen !== "admin" || !adminOk) return;
  const rooms = [...dir.list].sort((a, b) => b.n - a.n), people = rooms.reduce((t, r) => t + (r.n || 0), 0);
  $("liveCount").textContent = rooms.length ? `${people} ${people === 1 ? "persona" : "personas"} en ${rooms.length} ${rooms.length === 1 ? "sala" : "salas"} ahora mismo.` : "Nadie está en multijugador ahora mismo.";
  const ul = $("liveRooms"); ul.innerHTML = "";
  rooms.forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="lr-tag"></span><div class="or-text"><b></b><small></small></div>`;
    li.querySelector(".lr-tag").textContent = r.pub ? `Pública · ${r.code}` : "Privada";
    li.querySelector(".lr-tag").classList.toggle("pub", !!r.pub);
    li.querySelector("b").textContent = (r.names || []).join(", ");
    li.querySelector("small").textContent = roomWhat(r);
    ul.appendChild(li);
  });
}
// back from another app (sharing the code, a message): the sound and the room may have gone to sleep
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !app.room) return;
  try { app.room.update({}); } catch {} // tell the room we're still here
  if (app.screen === "lobby") try { navigator.wakeLock?.request("screen").then((l) => (app.lobbyWake = l)).catch(() => {}); } catch {}
});

const roomLanes = () => Math.min(5, ...app.peers.map((p) => p.lanes || 5));
const host = () => app.peers[0];
const amHost = () => app.room && app.room.isHost();

async function syncConfig() {
  const h = host();
  const cfg = h?.config || null;
  app.roomConfig = cfg;
  if (!cfg?.songId) return; // no song yet (maybe only the mode)
  if (app.loadedRoomSong === cfg.songId || app.loadingRoomSong === cfg.songId) return;
  // a download that failed is tried again after a while, not on every change in the room (each try tells the room)
  if (app.failedRoomSong?.id === cfg.songId && Date.now() - app.failedRoomSong.at < 8000) return;
  const song = await findSong(cfg.songId);
  if (!song) return;
  app.loadingRoomSong = cfg.songId;
  app.room.update({ ready: false, songId: null });
  try {
    if (app.loadedSongId !== song.id) {
      const { chart, stems } = await downloadSong(song, (p) => { $("lobbyStatus").textContent = `Descargando canción… ${Math.round(p * 100)}%`; });
      app.decoded = null; app.loadedSongId = null; // a phone can't hold two decoded songs at once: the old one goes first
      app.decoded = await decodeStems(stems);
      app.chart = chart; app.loadedSongId = song.id;
      app.songOffsetMs = song.audio_offset_ms || 0;
    }
    app.song = song; app.loadedRoomSong = song.id;
    app.room.update({ ready: true, songId: song.id });
  } catch (e) { toast(e.message); app.failedRoomSong = { id: song.id, at: Date.now() }; setTimeout(syncConfig, 8500); }
  app.loadingRoomSong = null;
  renderLobby();
}

function renderLobby() {
  if (!app.room) return;
  const ul = $("players"); ul.innerHTML = "";
  const roomCfg = app.roomConfig || {}, cfg = roomCfg.songId ? roomCfg : null;
  renderLobbyMode(roomCfg); renderCup($("cupLobby"), roomCfg); renderRoomSongs(amHost(), roomCfg);
  $("roomVis").querySelectorAll("button").forEach((b) => { b.setAttribute("aria-pressed", String((b.dataset.v === "pub") === !!roomCfg.pub)); b.disabled = !amHost(); });
  $("roomVisHint").textContent = roomCfg.pub ? `Aparece en la lista de salas abiertas (máximo ${PUBLIC_MAX}).` : "Solo entra quien tenga el código o el enlace.";
  app.peers.forEach((p, i) => {
    const li = document.createElement("li");
    const ready = cfg && p.ready && p.songId === cfg.songId;
    li.innerHTML = `<span class="n"></span>${i === 0 ? `<span class="tag host">Anfitrión</span>` : ""}<span class="tag">${p.device === "cel" ? "Celular" : "PC"}</span><span class="${ready ? "ok" : "wait"}">${cfg ? (ready ? "listo" : "cargando") : ""}</span>`;
    li.querySelector(".n").textContent = p.name + (p.id === app.me.id ? " (tú)" : "");
    styledName(li.querySelector(".n"), p.name);
    ul.appendChild(li);
  });
  const isHost = amHost();
  const song = cfg && knownSong(cfg.songId);
  const pick = $("lobbySong");
  if (song) {
    const cov = coverOf(song);
    pick.innerHTML = `${cov ? `<img alt="" src="${cov}">` : ""}<div><div class="t"></div><div class="a"></div></div>${isHost ? `<button class="link" id="changeSong">Cambiar</button>` : ""}`;
    pick.querySelector(".t").textContent = song.name; pick.querySelector(".a").textContent = song.artist || "";
  } else {
    pick.innerHTML = isHost ? `<div><div class="a">Ninguna canción elegida</div></div><button class="link" id="changeSong">Elegir</button>` : `<div><div class="a">Esperando a que el anfitrión elija…</div></div>`;
  }
  const cs = $("changeSong"); if (cs) cs.onclick = () => { app.mode = "pick"; openLibrary(); };
  const lanes = roomLanes();
  $("lobbyDiffField").hidden = !cfg || app.loadedRoomSong !== cfg.songId;
  if (cfg && app.chart && app.loadedRoomSong === cfg.songId) {
    renderDiffChips($("lobbyDiffs"), app.chart, lanes, cfg.diff, (k) => setRoomConfig({ diff: k }), !isHost);
  }
  const allReady = cfg && app.peers.length > 0 && app.peers.every((p) => p.ready && p.songId === cfg.songId);
  $("startRound").hidden = !isHost;
  $("lobbyMotion").hidden = isHost || !motionNeeded();
  $("startRound").disabled = !allReady || !notesFor(app.chart || { diffs: {} }, cfg?.diff, lanes).length;
  if (roomCfg.plan?.done) { // a finished cup: the next one (or free play) first
    $("startRound").disabled = true;
    $("lobbyStatus").textContent = isHost ? "¡Copa terminada! Elige otra copa o Libre para seguir." : "¡Copa terminada! El anfitrión elige qué sigue.";
    return;
  }
  $("lobbyStatus").textContent = !cfg ? (isHost ? "Elige una canción para empezar." : "")
    : !allReady ? "Esperando a que todos descarguen la canción…"
    : `Todos listos. Se toca con ${lanes} cuerdas${lanes === 4 && app.peers.some((p) => p.lanes === 5) ? " porque alguien juega desde el celular" : ""}.`;
}
$("startRound").onclick = () => withMotion(() => {
  const cfg = app.roomConfig; if (!cfg?.songId) return;
  tallyCup(true); // a round whose results didn't all arrive still counts with what came
  const payload = { songId: cfg.songId, diff: cfg.diff, lanes: roomLanes(), round: Date.now() };
  app.room.send("start", payload);
  onRoomEvent("start", payload);
});
// a guest starts when the host does (no tap of theirs): the permission is asked here, from a tap in the room
$("lobbyMotion").onclick = () => withMotion(() => {});

function onRoomEvent(ev, p) {
  if (ev === "start") {
    if (app.loadedRoomSong !== p.songId) { toast("Tu canción no terminó de cargar."); return; }
    app.diff = p.diff; app.roundId = p.round || Date.now(); mp.lastPos = 0; mp.posAt = 0;
    startGame({ lanes: p.lanes, diff: p.diff });
  } else if (ev === "attack") {
    if (!app.game || app.mode !== "mp") return;
    if (p.to === app.me.id) takeAttack(p.kind, p.name);
    else if (ATTACKS[p.kind]) mpBanner(`${p.name} ⚔ ${p.toName}: ${ATTACKS[p.kind].name}`, "feed");
  } else if (ev === "score") {
    app.rivals[p.from] = { name: p.name, score: p.score, combo: p.combo, acc: p.acc };
    renderRivals();
  } else if (ev === "final") {
    if (p.round && app.roundId && p.round !== app.roundId) return; // a late one from the round before
    app.finals[p.from] = p;
    renderRanking();
  }
}

/* ---------- multiplayer fun: battle mode, overtakes and the room's cup ---------- */
// Battle mode (the host picks it in the room, on by default): turning on star power (which still doubles your
// points) launches an attack at whoever leads (or, when that's you, at the one right behind) for a few seconds.
// Every attack hurts the same with a finger or a keyboard: the neck shakes (Terremoto), fog hides where the notes
// come from (Niebla), the stretch just before the buttons goes dark (Apagón) or the notes come twice as fast (Turbo). Overtakes are called out as they happen. Each round gives 3/2/1 points to the podium, and the
// host keeps the room's cup (in its presence, so everyone sees the same table).
const ATTACKS = { terremoto: { name: "Terremoto", ms: 5000 }, niebla: { name: "Niebla", ms: 6000 }, apagon: { name: "Apagón", ms: 6000 }, turbo: { name: "Turbo", ms: 6000 } };
const battleOn = () => app.mode === "mp" && app.roomConfig?.battle !== false;
function launchAttack() {
  const others = Object.entries(app.rivals).filter(([id]) => id !== app.me?.id).sort((a, b) => b[1].score - a[1].score);
  if (!others.length) return;
  const [to, r] = others[0];
  const kinds = Object.keys(ATTACKS), kind = kinds[Math.floor(Math.random() * kinds.length)];
  app.room.send("attack", { to, kind, name: app.me.name, toName: r.name });
  sfx.launch();
  mpBanner(`⚔ ¡Le lanzaste ${ATTACKS[kind].name.toUpperCase()} a ${r.name}!`, "out");
}
function takeAttack(kind, from) {
  const a = ATTACKS[kind]; if (!a) return;
  mp.fx[kind] = performance.now() + a.ms;
  sfx.zap();
  try { navigator.vibrate?.([80, 40, 120]); } catch {}
  mpBanner(`¡${from} te lanzó ${a.name.toUpperCase()}!`, "in");
  updateFx(performance.now());
}
function updateFx(now) {
  const on = !app.game ? "" : Object.keys(mp.fx).filter((k) => mp.fx[k] > now).join(" ");
  if (on === mp.on) return;
  mp.on = on;
  document.body.classList.toggle("fx-quake", on.includes("terremoto"));
  $("fogFx").classList.toggle("on", on.includes("niebla"));
  // Apagón: the stretch of the neck right before the buttons goes dark (you see the note coming, then guess)
  const dark = $("blackoutFx");
  if (on.includes("apagon") && app.game) {
    const y = R.strikeScreenY(0), H = innerHeight;
    dark.style.top = `${Math.max(0, y - H * 0.34)}px`; dark.style.height = `${H * 0.29}px`;
  }
  dark.classList.toggle("on", on.includes("apagon"));
  // Turbo: the notes come almost twice as fast
  if (app.game) app.game.look = on.includes("turbo") ? +settings.speed * 0.55 : +settings.speed;
}
function clearFx() { for (const k in mp.fx) mp.fx[k] = 0; updateFx(0); }
function mpBanner(text, kind) {
  const el = $("mpBanner");
  el.textContent = text; el.className = "mp-banner " + kind; el.hidden = false;
  void el.offsetWidth; el.classList.add("show");
  clearTimeout(mp.bannerT); mp.bannerT = setTimeout(() => { el.classList.remove("show"); }, kind === "feed" ? 1800 : 2600);
}
// your place among the players, and who you just passed (or who passed you)
function trackPosition(list) {
  const pos = list.findIndex(([id]) => id === app.me?.id) + 1;
  if (!pos || list.length < 2) return;
  $("mpPos").hidden = false; $("mpPos").textContent = `${pos}.º`; $("mpPos").className = "mp-pos p" + Math.min(pos, 4);
  const now = performance.now();
  if (mp.lastPos && pos !== mp.lastPos && now - mp.posAt > 2500 && app.game && app.game.time() > 4) {
    if (pos < mp.lastPos) mpBanner(`¡Pasaste a ${list[pos][1].name}! Vas ${pos}.º`, "up");
    else mpBanner(`${list[pos - 2][1].name} te pasó. Vas ${pos}.º`, "down");
    mp.posAt = now;
  }
  mp.lastPos = pos;
}
// the host adds the round to the cup when every result is in (or, forced, when the next round starts)
function tallyCup(force = false) {
  if (!amHost() || !app.roundId) return;
  const cfg = app.roomConfig || {};
  if (cfg.counted === app.roundId) return;
  // one result per player, by name: someone whose page reloaded comes back with a new connection, but is the same player
  const best = {};
  for (const r of Object.values(app.finals)) { const k = nameKey(r.name); if (!best[k] || r.score > best[k].score) best[k] = r; }
  const fin = Object.values(best);
  if (!fin.length || (!force && fin.length < new Set(app.peers.map((p) => nameKey(p.name))).size)) return;
  const cup = cupByName(cfg.cup);
  fin.sort((a, b) => b.score - a.score).forEach((r, i) => {
    const k = nameKey(r.name), c = cup[k] || { name: r.name, pts: 0, wins: 0 };
    cup[k] = { name: r.name, pts: c.pts + ([3, 2, 1][i] || 0), wins: c.wins + (i === 0 ? 1 : 0) };
  });
  const patch = { cup, counted: app.roundId };
  // a cup moves on to its next song (everyone starts downloading it), or ends
  const plan = cfg.plan;
  if (plan && !plan.done) {
    if (plan.idx < plan.songs.length - 1) { patch.plan = { ...plan, idx: plan.idx + 1 }; patch.songId = plan.songs[plan.idx + 1]; patch.at = Date.now(); }
    else patch.plan = { ...plan, done: true };
  }
  setRoomConfig(patch);
}
// the cup's table is by player name (a player whose page reloaded is still that player): rows from before that were by
// connection, a player twice, are added up into one
function cupByName(cup = {}) {
  const out = {};
  for (const r of Object.values(cup || {})) {
    const k = nameKey(r.name), c = out[k];
    out[k] = c ? { name: c.name, pts: c.pts + r.pts, wins: c.wins + r.wins } : { ...r };
  }
  return out;
}
// the host changes the room's setup: right away here, and for everyone through its presence
function setRoomConfig(patch) {
  const cfg = { ...(app.roomConfig || {}), ...patch };
  app.roomConfig = cfg;
  app.room.update({ config: cfg });
  if (app.screen === "lobby") renderLobby();
  if (app.screen === "results") renderCup($("cupRes"), cfg);
  return cfg;
}

/* ---------- cups, like Mario Kart: a run of songs, picked at random and changed one by one ---------- */
const CUPS = { telonero: { name: "Copa Telonero", n: 3 }, gira: { name: "Copa Gira", n: 5 }, leyenda: { name: "Copa Leyenda", n: 10 } };
// songs to pick from: the library's songs that have the room's difficulty (any song when that's too few)
function roomPool(exclude = []) {
  const diff = app.roomConfig?.diff || "medium";
  const all = publicSongs().filter((s) => Object.values(s.diffs || {}).some((d) => d?.n > 0));
  const withDiff = all.filter((s) => (s.diffs?.[diff]?.n || 0) > 0);
  const pool = (withDiff.length >= 3 ? withDiff : all).filter((s) => !exclude.includes(s.id));
  return pool.length ? pool : all;
}
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];
function randomSongs(n) {
  const out = [];
  for (let i = 0; i < n; i++) { const s = randomOf(roomPool(out)); if (!s) break; out.push(s.id); }
  return out;
}
async function ensureSongs() { if (!app.songs.length) { try { app.songs = await loadLibrary(); } catch {} } }
async function startCup(key) {
  await ensureSongs();
  if (key === "libre") { setRoomConfig({ plan: null }); return; }
  const c = CUPS[key], songs = randomSongs(c.n);
  if (!songs.length) { toast("No hay canciones en la biblioteca."); return; }
  // a new cup: its own table
  setRoomConfig({ plan: { key, name: c.name, songs, idx: 0, done: false }, songId: songs[0], at: Date.now(), cup: {}, counted: null });
}
async function rerollSlot(i) {
  await ensureSongs();
  const plan = app.roomConfig?.plan; if (!plan) return;
  const s = randomOf(roomPool(plan.songs)); if (!s) return;
  const songs = [...plan.songs]; songs[i] = s.id;
  setRoomConfig({ plan: { ...plan, songs }, ...(i === plan.idx ? { songId: s.id, at: Date.now() } : {}) });
}
function rerollRest() {
  const plan = app.roomConfig?.plan; if (!plan) return;
  const keep = plan.songs.slice(0, plan.idx);
  const songs = [...keep];
  for (let i = plan.idx; i < plan.songs.length; i++) { const s = randomOf(roomPool(songs)); songs.push(s ? s.id : plan.songs[i]); }
  setRoomConfig({ plan: { ...plan, songs }, songId: songs[plan.idx], at: Date.now() });
}
async function randomRoomSong() {
  await ensureSongs();
  const s = randomOf(roomPool([app.roomConfig?.songId].filter(Boolean)));
  if (s) setRoomConfig({ songId: s.id, at: Date.now() });
}
// the lobby's song part: free play (one song, picked or random) or a cup's setlist
function renderRoomSongs(isHost, cfg) {
  const plan = cfg?.plan;
  document.querySelectorAll("#cupPick button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.c === (plan ? plan.key : "libre"))); b.disabled = !isHost; });
  $("lobbySong").hidden = !!plan;
  $("lobbyRandom").hidden = !isHost || !!plan;
  const box = $("cupSetlist");
  box.hidden = !plan;
  if (!plan) return;
  box.innerHTML = `<div class="cs-head"><b></b><span></span></div><ol></ol>${isHost && !plan.done ? `<button class="link" id="cupReroll">🎲 Cambiar todas las que faltan</button>` : ""}`;
  box.querySelector("b").textContent = plan.name;
  box.querySelector(".cs-head span").textContent = plan.done ? "¡Terminada!" : `Canción ${plan.idx + 1} de ${plan.songs.length}`;
  const ol = box.querySelector("ol");
  plan.songs.forEach((id, i) => {
    const s = knownSong(id), li = document.createElement("li");
    const played = i < plan.idx || plan.done, now = i === plan.idx && !plan.done;
    li.className = played ? "played" : now ? "now" : "";
    li.innerHTML = `<span class="cs-n">${played ? "✓" : i + 1}</span><span class="cs-t"><b></b><small></small></span>`
      + (isHost && !played ? `<button class="cs-btn" data-a="dice" aria-label="Otra al azar">🎲</button><button class="cs-btn" data-a="pick">Elegir</button>` : "");
    li.querySelector("b").textContent = s ? s.name : "…";
    li.querySelector("small").textContent = s ? s.artist || "" : "";
    li.onclick = (e) => {
      const a = e.target.closest("button")?.dataset.a; if (!a) return;
      if (a === "dice") rerollSlot(i);
      else { app.pickSlot = i; app.mode = "pick"; openLibrary(); }
    };
    ol.appendChild(li);
  });
  const rr = $("cupReroll"); if (rr) rr.onclick = rerollRest;
}
$("cupPick").onclick = (e) => {
  const b = e.target.closest("button[data-c]"); if (!b || !amHost()) return;
  const cur = app.roomConfig?.plan;
  if (b.dataset.c === (cur ? cur.key : "libre") && !(cur && cur.done)) return;
  if (cur && !cur.done && !confirm("¿Empezar otra copa? Se pierde la tabla de esta.")) return;
  startCup(b.dataset.c);
};
$("lobbyRandom").onclick = () => { if (amHost()) randomRoomSong(); };
function renderCup(el, cfg) {
  const rows = Object.values(cupByName(cfg?.cup)).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  el.hidden = !rows.length;
  if (!rows.length) return;
  const plan = cfg?.plan;
  el.innerHTML = `<span class="label"></span>${plan?.done ? `<div class="cup-champ"></div>` : ""}<ol></ol>`;
  if (plan?.done) el.querySelector(".cup-champ").textContent = `🏆 ¡${rows[0].name} gana la ${plan.name}!`;
  el.querySelector(".label").textContent = plan ? `${plan.name}${plan.done ? "" : ` · canción ${Math.min(plan.idx + 1, plan.songs.length)} de ${plan.songs.length}`}` : "Copa de la sala";
  const ol = el.querySelector("ol");
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="medal">${["🥇", "🥈", "🥉"][i] || i + 1}</span><span class="n"></span><span class="w">${r.wins ? `${r.wins} ${r.wins === 1 ? "victoria" : "victorias"}` : ""}</span><span class="s">${r.pts} ${r.pts === 1 ? "punto" : "pts"}</span>`;
    li.querySelector(".n").textContent = r.name;
    styledName(li.querySelector(".n"), r.name);
    ol.appendChild(li);
  });
}
function renderLobbyMode(cfg) {
  const host = amHost(), battle = cfg?.battle !== false;
  document.querySelectorAll("#lobbyMode button").forEach((b) => { b.setAttribute("aria-pressed", String((b.dataset.m === "battle") === battle)); b.disabled = !host; });
  $("lobbyModeHint").textContent = battle
    ? "Tu poder estrella sigue duplicando tus puntos y además le lanza un ataque al que va ganando: Terremoto, Niebla, Apagón o Turbo."
    : "Sin ataques: gana el que más puntos haga.";
}
$("lobbyMode").onclick = (e) => {
  const b = e.target.closest("button[data-m]"); if (!b || !amHost()) return;
  setRoomConfig({ battle: b.dataset.m === "battle" });
};
function renderRivals() {
  const ol = $("rivals");
  const list = Object.entries(app.rivals).sort((a, b) => b[1].score - a[1].score);
  trackPosition(list);
  ol.innerHTML = "";
  for (const [id, r] of list) {
    const li = document.createElement("li");
    if (id === app.me?.id) li.className = "me";
    li.innerHTML = `<span class="n"></span><span class="s">${r.score.toLocaleString("es-CO")}</span><span class="m">${Math.round((r.acc || 0) * 100)}% · racha ${r.combo}</span>`;
    li.querySelector(".n").textContent = r.name;
    styledName(li.querySelector(".n"), r.name);
    ol.appendChild(li);
  }
}
function renderRanking() {
  const ol = $("ranking");
  ol.hidden = app.mode !== "mp";
  if (app.mode !== "mp") return;
  const list = Object.entries(app.finals).sort((a, b) => b[1].score - a[1].score);
  ol.innerHTML = "";
  for (const [id, r] of list) {
    const li = document.createElement("li");
    if (id === app.me?.id) li.className = "me";
    li.innerHTML = `<span class="n"></span><span class="a">${Math.round(r.acc * 100)}%</span><span class="s">${r.score.toLocaleString("es-CO")}</span>`;
    li.querySelector(".n").textContent = r.name;
    styledName(li.querySelector(".n"), r.name);
    ol.appendChild(li);
  }
  const waiting = app.peers.length - list.length;
  if (waiting > 0) { const li = document.createElement("li"); li.innerHTML = `<span class="n" style="color:var(--muted)">Esperando a ${waiting} jugador${waiting > 1 ? "es" : ""}…</span>`; ol.appendChild(li); }
  tallyCup();
  renderCup($("cupRes"), app.roomConfig);
}

// expose for debugging / tests
window.__corde = { app, R, music };

/* ================= admin uploads ================= */
const ADMIN_KEY = "corde.adminCode";
// The upload screen is hidden for everyone; the admin opens it once with /#admin and it stays visible in that browser.
function isAdminBrowser() { try { return !!localStorage.getItem(ADMIN_KEY); } catch { return false; } }
try { $("adminCode").value = localStorage.getItem(ADMIN_KEY) || ""; } catch {}
$("openAdmin").onclick = () => { if (app.game) return; openAdminScreen(); };
// /admin is the same page served cross-origin isolated (netlify.toml): there the guitar separation uses every core
const adminPath = location.pathname.replace(/\/+$/, "") === "/admin";
if (location.hash === "#admin" || adminPath) setTimeout(openAdminScreen, 0);

// The panel shows nothing but the code field until the server says the code is right (anyone can open /admin)
let adminOk = false;
function openAdminScreen() {
  show("admin");
  if (adminOk) { loadAutoList(); loadInbox(); }
  else if ($("adminCode").value.trim()) adminEnter(true); // this browser's saved code: straight in if it still works
}
async function adminEnter(quiet = false) {
  const code = $("adminCode").value.trim(), msg = $("adminGateMsg");
  if (!code) { msg.textContent = "Escribe el código."; return; }
  $("adminEnter").disabled = true; msg.textContent = quiet ? "" : "Revisando…";
  try {
    await adminCall({ code, action: "check" });
    adminOk = true; syncDir();
    try { localStorage.setItem(ADMIN_KEY, code); } catch {}
    msg.textContent = ""; $("adminGate").hidden = true; $("adminBody").hidden = false;
    loadAutoList(); loadInbox();
  } catch (e) {
    adminOk = false; $("adminBody").hidden = true;
    msg.textContent = /incorrecto/i.test(e.message) ? "Ese código no es." : "No se pudo revisar el código. Revisa tu conexión.";
    if (/incorrecto/i.test(e.message)) { try { localStorage.removeItem(ADMIN_KEY); } catch {} $("adminCode").value = ""; }
  }
  $("adminEnter").disabled = false;
}
$("adminGate").onsubmit = (e) => { e.preventDefault(); adminEnter(); };

/* --- what the players asked for and what the admin tells them (inbox.sql) --- */
const inbox = { who: "all", names: [], players: null };
const shortDate = (iso) => { try { return new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
async function loadInbox() {
  const code = $("adminCode").value.trim();
  if (!adminOk || !code) return;
  let r;
  try { r = await adminCall({ code, action: "inbox" }); } catch (e) { $("reqEmpty").textContent = e.message; return; }
  renderRequests(r.requests || []); renderNotices(r.notices || []);
  if (!inbox.players) {
    try {
      inbox.players = (await adminCall({ code, action: "players" })).names || [];
      const dl = $("ntPlayers"); dl.innerHTML = "";
      for (const n of inbox.players) { const o = document.createElement("option"); o.value = n; dl.appendChild(o); }
    } catch {}
  }
}
// everything the players wrote goes in as text, never as HTML
function renderRequests(list) {
  const ul = $("reqList"); ul.innerHTML = "";
  $("reqEmpty").textContent = list.length ? `${list.filter((x) => !x.done).length} sin atender de ${list.length}.` : "Todavía nadie ha pedido canciones.";
  const code = () => $("adminCode").value.trim();
  const markDone = async (x, songId, btn) => {
    if (btn) btn.disabled = true;
    try { await adminCall({ code: code(), action: "request_done", id: x.id, done: true, song_id: songId || null }); } catch (e) { toast(e.message); }
    loadInbox();
  };
  for (const x of list) {
    const li = document.createElement("li"); li.className = x.done ? "done" : "";
    li.innerHTML = `<span class="n"><b></b><small></small><span class="req-body"></span><small class="req-song"></small><span class="req-pick" hidden></span></span><span class="req-act"><button type="button"></button><button type="button">Borrar</button></span>`;
    li.querySelector("b").textContent = x.name; li.querySelector("small").textContent = ` · ${shortDate(x.at)}`;
    li.querySelector(".req-body").textContent = x.body;
    if (x.done && x.song) li.querySelector(".req-song").textContent = `→ ${x.song.name}${x.song.artist ? ` · ${x.song.artist}` : ""} · ${x.announced ? "ya le salió el anuncio" : "le saldrá el anuncio al entrar"}`;
    const [bDone, bDel] = li.querySelectorAll(".req-act button");
    bDone.textContent = x.done ? "Pendiente" : "Hecho";
    // done: which song of the library answers it (its player gets "¡Ya está tu canción!"), or none
    const pick = li.querySelector(".req-pick");
    bDone.onclick = async () => {
      if (x.done) {
        bDone.disabled = true;
        try { await adminCall({ code: code(), action: "request_done", id: x.id, done: false }); } catch {}
        return loadInbox();
      }
      if (!pick.hidden) { pick.hidden = true; return; }
      pick.hidden = false;
      pick.innerHTML = `<input type="search" placeholder="Busca la canción que subiste" aria-label="Busca la canción"><span class="req-hits"></span><button type="button" class="req-none">Hecho sin elegir canción</button>`;
      const q = pick.querySelector("input"), hits = pick.querySelector(".req-hits");
      const find = () => {
        const t = songKey(q.value); hits.innerHTML = "";
        if (!t) return;
        for (const song of (adm.lib || []).filter((y) => songKey(`${y.name} ${y.artist || ""}`).includes(t)).slice(0, 8)) {
          const b = document.createElement("button"); b.type = "button";
          b.textContent = `${song.name}${song.artist ? ` · ${song.artist}` : ""}`;
          b.onclick = () => markDone(x, song.id, b);
          hits.appendChild(b);
        }
        if (!hits.children.length) hits.textContent = "Ninguna canción coincide.";
      };
      q.oninput = find; q.focus();
      pick.querySelector(".req-none").onclick = (e) => markDone(x, null, e.target);
    };
    bDel.onclick = async () => { if (!confirm("¿Borrar este pedido?")) return; bDel.disabled = true; try { await adminCall({ code: code(), action: "request_delete", id: x.id }); } catch {} loadInbox(); };
    ul.appendChild(li);
  }
}
function renderNotices(list) {
  const ul = $("ntList"); ul.innerHTML = "";
  $("ntEmpty").textContent = list.length ? "" : "Todavía no has enviado avisos.";
  for (const x of list) {
    const li = document.createElement("li"); li.className = x.active ? "" : "done";
    li.innerHTML = `<span class="n"><small class="nt-meta"></small><span class="req-body"></span><span class="nt-replies"></span></span><span class="req-act"><button type="button"></button></span>`;
    const to = x.all ? "A todos" : `A ${x.to.join(", ") || "nadie"}`;
    li.querySelector(".nt-meta").textContent = `${shortDate(x.at)} · ${to} · lo ${x.seen === 1 ? "vio 1 persona" : `vieron ${x.seen} personas`}`;
    li.querySelector(".req-body").textContent = x.body;
    const rep = li.querySelector(".nt-replies");
    for (const r of x.replies || []) {
      const d = document.createElement("span"); d.className = "nt-reply";
      const b = document.createElement("b"); b.textContent = `${r.name}: `;
      d.append(b, document.createTextNode(r.body)); rep.appendChild(d);
    }
    const bOff = li.querySelector("button");
    bOff.textContent = x.active ? "Quitar" : "Quitado"; bOff.disabled = !x.active;
    bOff.title = "Deja de salirle a quien todavía no lo ha visto";
    bOff.onclick = async () => { bOff.disabled = true; try { await adminCall({ code: $("adminCode").value.trim(), action: "notice_off", id: x.id }); } catch {} loadInbox(); };
    ul.appendChild(li);
  }
}
function renderWho() {
  document.querySelectorAll("#ntWho button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === inbox.who)));
  $("ntSome").hidden = inbox.who !== "some";
  const box = $("ntChips"); box.innerHTML = "";
  for (const n of inbox.names) {
    const c = document.createElement("button"); c.type = "button"; c.className = "nt-chip"; c.textContent = `${n} ×`;
    c.title = "Quitar"; c.onclick = () => { inbox.names = inbox.names.filter((x) => x !== n); renderWho(); };
    box.appendChild(c);
  }
}
document.querySelectorAll("#ntWho button").forEach((b) => (b.onclick = () => { inbox.who = b.dataset.v; renderWho(); }));
function addTarget() {
  const n = $("ntName").value.trim().slice(0, 16);
  if (n && !inbox.names.some((x) => x.toLowerCase() === n.toLowerCase())) inbox.names.push(n);
  $("ntName").value = ""; renderWho(); $("ntName").focus();
}
$("ntAdd").onclick = addTarget;
$("ntName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTarget(); } });
$("ntSend").onclick = async () => {
  const body = $("ntText").value.trim(), st = $("ntStatus");
  if (!body) { st.textContent = "Escribe el aviso."; return; }
  if (inbox.who === "some" && !inbox.names.length) { st.textContent = "Agrega al menos un nombre."; return; }
  $("ntSend").disabled = true;
  try {
    const r = await adminCall({ code: $("adminCode").value.trim(), action: "notice", body, all: inbox.who === "all", names: inbox.names });
    const missing = r.missing || [];
    st.textContent = missing.length ? `Enviado, pero no encontré a: ${missing.join(", ")}.` : "Enviado. Les sale la próxima vez que entren.";
    $("ntText").value = ""; inbox.names = []; renderWho();
    loadInbox();
  } catch (e) { st.textContent = e.message; }
  $("ntSend").disabled = false;
};
renderWho();

// the old copies in Supabase Storage (from before R2): the function deletes each file once R2 has it
$("storageGo").onclick = async () => {
  if (!confirm("¿Borrar las copias viejas de Supabase? Solo se borra lo que ya está en Cloudflare.")) return;
  const st = $("storageStatus"), b = $("storageGo"); b.disabled = true;
  let total = 0, kept = [];
  try {
    for (let round = 0; round < 40; round++) {
      st.textContent = `Borrando… ${total} archivos hasta ahora.`;
      const r = await adminCall({ code: $("adminCode").value.trim(), action: "storage_cleanup" });
      total += r.deleted || 0; kept = r.kept || [];
      if (r.done || !r.deleted) break;
    }
    st.textContent = `Listo: ${total} archivos borrados de Supabase.` + (kept.length ? ` Quedaron ${kept.length} que no están en Cloudflare (no los toqué).` : "");
  } catch (e) { st.textContent = `${total} borrados; luego falló: ${e.message}`; }
  b.disabled = false;
};

// Songs made from a bare MP3. Uploading the same song as a Clone Hero folder replaces them (even with only
// Expert: the easier levels are built from it), and they can be deleted from here.
const AUTO_CHARTER = "Corde (automático)";
const songKey = (x) => (x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, "").replace(/\b(\d{4} )?remaster(ed)?\b|\bofficial (audio|video)\b/g, "").replace(/[^a-z0-9]+/g, "");
function sameSong(a, b) {
  const n = songKey(a.name);
  if (!n || n !== songKey(b.name)) return false;
  const x = songKey(a.artist), y = songKey(b.artist);
  return !x || !y || x.includes(y) || y.includes(x);
}
// the admin sees the whole library, secret songs included (the public list can't see them)
async function adminLibrary() {
  const code = $("adminCode").value.trim();
  if (code) {
    try {
      const [l, g] = await Promise.all([adminCall({ code, action: "list" }), adminCall({ code, action: "groups" })]);
      adm.lib = l.songs || []; adm.groups = g.groups || [];
      return adm.lib;
    } catch {}
  }
  adm.lib = null; // without the code only the public library: not enough to manage the secret songs
  return listSongs();
}
async function loadAutoList() {
  if (!online) return;
  let lib = [];
  try { lib = await adminLibrary(); } catch { return; }
  renderSecretAdmin();
  renderSplit();
  const auto = lib.filter((x) => x.charter === AUTO_CHARTER);
  const ul = $("autoList"); ul.innerHTML = "";
  $("autoBox").hidden = !auto.length;
  for (const x of auto) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n"></span><button type="button">Borrar</button>`;
    li.querySelector(".n").innerHTML = `<span class="t"></span> <span class="a"></span>`;
    li.querySelector(".t").textContent = x.name; li.querySelector(".a").textContent = (x.artist ? `· ${x.artist}` : "") + (x.hidden ? " · secreta" : "");
    li.querySelector("button").onclick = async (e) => {
      const code = $("adminCode").value.trim();
      if (!code) { $("adminStatus").textContent = "Escribe el código de administrador."; return; }
      if (!confirm(`¿Borrar «${x.name}»? También se borran sus puntajes.`)) return;
      e.target.disabled = true;
      try {
        await adminCall({ code, action: "delete", id: x.id });
        $("adminStatus").textContent = `Borrada: ${x.name}.`;
        app.songs = []; if (app.loadedSongId === x.id) app.loadedSongId = null;
      } catch (err) { $("adminStatus").textContent = err.message; }
      loadAutoList();
    };
    ul.appendChild(li);
  }
}

function renderAdmin() {
  const ul = $("adminList"); ul.innerHTML = "";
  adm.songs.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<input type="checkbox" ${s.on ? "checked" : ""} ${adm.busy ? "disabled" : ""} aria-label="Incluir"><span class="n"></span><span class="st ${s.cls || ""}"></span><span class="bar2"><i style="transform:scaleX(${s.p || 0})"></i></span>`;
    li.querySelector(".n").textContent = s.label;
    li.querySelector(".st").textContent = s.status || "";
    li.querySelector("input").onchange = (e) => { s.on = e.target.checked; renderAdmin(); };
    ul.appendChild(li);
  });
  const n = adm.songs.filter((s) => s.on && s.cls !== "ok" && s.cls !== "warn").length;
  $("adminUpload").textContent = adm.busy ? "Subiendo…" : n ? `Subir ${n} ${n > 1 ? "canciones" : "canción"}` : "Subir";
  $("adminUpload").disabled = adm.busy || !n;
}
$("adminFolder").onchange = (e) => {
  adm.songs = findSongs(e.target.files).map((s, i) => ({ ...s, on: true }));
  $("adminStatus").textContent = adm.songs.length
    ? `Encontré ${adm.songs.length} ${adm.songs.length > 1 ? "canciones" : "canción"}. Desmarca las que no quieras subir.`
    : "No encontré canciones en esa carpeta. Cada canción necesita song.ini, notes.mid o notes.chart, y sus audios.";
  renderAdmin();
};
$("adminMp3").onchange = (e) => {
  const found = findMp3Songs(e.target.files).map((s) => ({ ...s, on: true }));
  adm.songs = [...adm.songs.filter((s) => s.cls !== "ok" && s.cls !== "warn"), ...found];
  $("adminStatus").textContent = "";
  renderAdmin();
};
$("adminUpload").onclick = async () => {
  const code = $("adminCode").value.trim();
  if (!code) { $("adminStatus").textContent = "Escribe el código de administrador."; return; }
  try { await adminCall({ code, action: "check" }); } catch (e) { $("adminStatus").textContent = e.message; return; }
  try { localStorage.setItem(ADMIN_KEY, code); } catch {}
  adm.busy = true; renderAdmin(); adminWorkChanged();
  let lib = [];
  try { lib = await adminLibrary(); } catch {}
  const group = Number($("adminGroup").value) || 0, groupName = adm.groups.find((g) => g.id === group)?.name;
  let ok = 0, bad = 0;
  for (const s of adm.songs) {
    if (!s.on || s.cls === "ok" || s.cls === "warn") continue;
    const set = (status, p, cls) => { s.status = status; s.p = p; if (cls) s.cls = cls; renderAdmin(); };
    try {
      const conv = await (s.kind === "mp3" ? convertMp3Song : convertSong)(s, (txt, p) => set(txt, p * 0.85));
      // an MP3 never replaces a song that already has a real chart
      const charted = lib.find((x) => x.charter !== AUTO_CHARTER && (x.id === conv.id || sameSong(x, conv.row)));
      if (s.kind === "mp3" && charted) { set("Ya está con chart: no la subí", 0, "warn"); continue; }
      // a chart replaces the version made from the MP3
      const autos = s.kind === "mp3" ? [] : lib.filter((x) => x.charter === AUTO_CHARTER && (x.id === conv.id || sameSong(x, conv.row)));
      // to a secret code only when asked: a re-upload to the library keeps whatever the song was
      if (group) conv.row.secret_group = group;
      await uploadSong(code, conv, (p) => set("Subiendo", 0.85 + p * 0.15));
      for (const x of autos) if (x.id !== conv.id) await adminCall({ code, action: "delete", id: x.id });
      const replaced = autos.length ? " · reemplazó la del MP3" : "";
      const noSplit = conv.split === "no" ? " · no se pudo separar la guitarra en este navegador" : "";
      if (conv.warnMs) set(`Subida${replaced}${noSplit}, pero revisa: las notas podrían ir desfasadas (unos ${conv.warnMs} ms)`, 1, "warn");
      else if (noSplit) set(`Subida${replaced}${noSplit}`, 1, "warn");
      else set("Lista" + replaced + (conv.split === "ok" ? " · guitarra separada" : ""), 1, "ok");
      ok++;
    } catch (e) { set(e.message || "Error", 0, "bad"); bad++; }
  }
  adm.busy = false; renderAdmin(); adminWorkChanged();
  app.songs = []; app.loadedSongId = null; // reload the library (and any re-uploaded song) next time
  loadAutoList();
  $("adminStatus").textContent = `Listo: ${ok} subida${ok === 1 ? "" : "s"}${bad ? `, ${bad} con error` : ""}. ${groupName ? `Ya aparecen en «${groupName}» (con su código).` : "Ya aparecen en Jugar."}`;
};

/* --- songs already uploaded as one audio: their guitar apart, one after another, in this browser --- */
function renderSplit() {
  const need = (adm.lib || []).filter((x) => !x.has_guitar);
  $("splitBox").hidden = !adm.lib || (!need.length && !split.rows.length);
  $("splitHint").textContent = need.length
    ? `${need.length} ${need.length > 1 ? "canciones son" : "canción es"} un solo audio: al fallar no se calla la guitarra. Tu navegador puede separarla, unos minutos por canción; deja esta pestaña abierta mientras tanto (puedes detenerlo cuando quieras y seguir otro día). Las notas hechas a mano se quedan igual; las automáticas se rehacen desde la guitarra y sus puntajes se reinician.`
    : "Todas las canciones tienen su guitarra aparte.";
  // not isolated: one core only, about three times slower
  if (need.length && !self.crossOriginIsolated) $("splitHint").textContent += ` Para que vaya unas 3 veces más rápido, abre ${location.origin}/admin (usa todos los núcleos de tu computador).`;
  $("splitGo").textContent = split.on ? (split.stop ? "Deteniendo…" : "Detener") : need.length ? `Separar ${need.length} ${need.length > 1 ? "canciones" : "canción"}` : "Separar";
  $("splitGo").disabled = (!split.on && !need.length) || split.stop;
  const ul = $("splitList"); ul.innerHTML = "";
  for (const r of split.rows.slice(-8)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n"></span><span class="st ${r.cls || ""}"></span><span class="bar2"><i style="transform:scaleX(${r.p || 0})"></i></span>`;
    li.querySelector(".n").textContent = r.label; li.querySelector(".st").textContent = r.status || "";
    ul.appendChild(li);
  }
}
$("splitGo").onclick = async () => {
  if (split.on) { split.stop = true; renderSplit(); return; }
  const code = $("adminCode").value.trim();
  if (!code) { $("splitStatus").textContent = "Escribe el código de administrador."; return; }
  const queue = (adm.lib || []).filter((x) => !x.has_guitar);
  split.on = true; split.stop = false; split.rows = []; adminWorkChanged();
  let ok = 0, bad = 0;
  const t0 = Date.now();
  for (const x of queue) {
    if (split.stop) break;
    const r = { label: `${x.name}${x.artist ? ` · ${x.artist}` : ""}`, p: 0 };
    split.rows.push(r);
    const set = (status, p, cls) => { r.status = status; r.p = p; if (cls) r.cls = cls; renderSplit(); };
    try {
      const res = await separateExisting(x, downloadSong, (txt, p) => set(txt, p * 0.9));
      await uploadStems(code, x.id, res, (p) => set("Subiendo", 0.9 + p * 0.1));
      x.has_guitar = true;
      set(res.patch.resetScores ? "Lista · notas rehechas desde la guitarra" : "Lista", 1, "ok");
      ok++;
      if (app.loadedSongId === x.id) app.loadedSongId = null;
    } catch (e) { set(e.message || "Error", 0, "bad"); bad++; }
    const left = (adm.lib || []).filter((y) => !y.has_guitar).length, per = (Date.now() - t0) / (ok + bad) / 60000;
    $("splitStatus").textContent = `${ok} lista${ok === 1 ? "" : "s"}${bad ? `, ${bad} con error` : ""}. Faltan ${left}${left && !split.stop ? ` (unos ${Math.round(per * left)} min)` : ""}.`;
  }
  split.on = false; split.stop = false; adminWorkChanged();
  app.songs = []; // the library reloads with the new files
  renderSplit();
};

/* --- secret songs, from the admin's side: the codes (groups) and where each song is --- */
// the database reads a curly apostrophe (a phone's) as a straight one: the codes are saved straight
const plainCode = (c) => c.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
const groupLabel = (x) => (!x.hidden ? "Biblioteca" : adm.groups.find((g) => g.id === x.secret_group)?.name || "Escondida");
function adminCodeOr(el) {
  const code = $("adminCode").value.trim();
  if (!code) $(el).textContent = "Escribe el código de administrador.";
  return code;
}
function renderSecretAdmin() {
  // the codes: name, how many songs, rename / change the code / delete (only when empty)
  const gl = $("groupList"); gl.innerHTML = "";
  for (const g of adm.groups) {
    const n = (adm.lib || []).filter((x) => x.hidden && x.secret_group === g.id).length;
    const li = document.createElement("li");
    li.innerHTML = `<span class="n"><span class="t"></span><small></small></span><button type="button" data-a="name">Renombrar</button><button type="button" data-a="code">Cambiar código</button>${n ? "" : `<button type="button" data-a="del">Borrar</button>`}`;
    li.querySelector(".t").textContent = g.name; li.querySelector("small").textContent = `${n} ${n === 1 ? "canción" : "canciones"}`;
    li.onclick = async (e) => {
      const a = e.target.closest("button")?.dataset.a; if (!a) return;
      const code = adminCodeOr("secretStatus"); if (!code) return;
      try {
        if (a === "del") {
          if (!confirm(`¿Borrar el código «${g.name}»? Quien lo tenía ya no verá esa pestaña.`)) return;
          await adminCall({ code, action: "group_delete", id: g.id });
          $("secretStatus").textContent = `Borrado: «${g.name}».`;
        } else if (a === "name") {
          const name = prompt("Nombre (es la pestaña que ven los jugadores):", g.name)?.trim();
          if (!name || name === g.name) return;
          await adminCall({ code, action: "group_save", id: g.id, name });
          $("secretStatus").textContent = `Listo: ahora se llama «${name}».`;
        } else {
          const next = plainCode(prompt(`Nuevo código para «${g.name}» (quien tenía el anterior tendrá que escribir este):`)?.trim() || "");
          if (!next) return;
          if (next.length < 3) { $("secretStatus").textContent = "El código necesita al menos 3 letras."; return; }
          await adminCall({ code, action: "group_save", id: g.id, secret: next });
          // this browser keeps the group with the new code
          const mine = secretList();
          if (mine.some((x) => x.id === g.id)) saveSecrets(mine.map((x) => (x.id === g.id ? { ...x, code: next } : x)));
          $("secretStatus").textContent = `Listo: el código de «${g.name}» ahora es «${next.toLowerCase()}».`;
        }
        app.songs = [];
      } catch (err) { $("secretStatus").textContent = err.message; }
      loadAutoList();
    };
    gl.appendChild(li);
  }
  // where uploads go
  const sel = $("adminGroup"), was = sel.value;
  sel.innerHTML = `<option value="">la biblioteca</option>` + adm.groups.map((g) => `<option value="${g.id}"></option>`).join("");
  adm.groups.forEach((g, i) => (sel.options[i + 1].textContent = `«${g.name}» (secretas)`));
  sel.value = adm.groups.some((g) => String(g.id) === was) ? was : "";
  // the songs: the secret ones; searching finds any song, to move it
  const ul = $("secretList"); ul.innerHTML = "";
  const lib = adm.lib || [];
  const q = $("secretFind").value.trim().toLowerCase();
  const list = q ? lib.filter((x) => `${x.name} ${x.artist || ""}`.toLowerCase().includes(q)).slice(0, 60) : lib.filter((x) => x.hidden);
  $("secretEmpty").textContent = !adm.lib ? "Escribe el código de administrador para ver la biblioteca." : list.length ? "" : q ? "Ninguna canción coincide." : "Todavía no hay canciones secretas. Búscalas aquí para moverlas a un código, o súbelas eligiendo el código.";
  for (const x of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n"><span class="t"></span> <span class="a"></span></span><select class="adm-select" aria-label="Dónde está"></select>`;
    li.querySelector(".t").textContent = x.name; li.querySelector(".a").textContent = x.artist ? `· ${x.artist}` : "";
    const s = li.querySelector("select");
    const opts = [["", "Biblioteca"], ...adm.groups.map((g) => [String(g.id), g.name])];
    if (x.hidden && !adm.groups.some((g) => g.id === x.secret_group)) opts.push(["none", "Escondida (sin código)"]);
    for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); }
    s.value = !x.hidden ? "" : adm.groups.some((g) => g.id === x.secret_group) ? String(x.secret_group) : "none";
    s.classList.toggle("on", !!x.hidden);
    s.onchange = async () => {
      if (s.value === "none") return;
      const code = adminCodeOr("secretStatus"); if (!code) { renderSecretAdmin(); return; }
      const group = s.value ? Number(s.value) : null;
      s.disabled = true;
      try {
        await adminCall({ code, action: "hide", id: x.id, group });
        x.hidden = group !== null; x.secret_group = group;
        $("secretStatus").textContent = `«${x.name}» ahora está en ${group ? `«${groupLabel(x)}»` : "la biblioteca"}.`;
        app.songs = []; // the library reloads with it in its new place
      } catch (e) { $("secretStatus").textContent = e.message; }
      renderSecretAdmin(); loadAutoList();
    };
    ul.appendChild(li);
  }
}
$("secretFind").oninput = renderSecretAdmin;
$("groupAdd").onclick = async () => {
  const code = adminCodeOr("secretStatus"); if (!code) return;
  const name = $("groupName").value.trim(), next = plainCode($("groupCode").value.trim());
  if (!name || next.length < 3) { $("secretStatus").textContent = "Escribe el nombre y un código de al menos 3 letras."; return; }
  $("groupAdd").disabled = true;
  try {
    await adminCall({ code, action: "group_save", name, secret: next });
    $("groupName").value = $("groupCode").value = "";
    $("secretStatus").textContent = `Listo: el código «${next.toLowerCase()}» abre «${name}». Ahora mueve canciones ahí o súbelas eligiéndolo.`;
  } catch (e) { $("secretStatus").textContent = e.message; }
  $("groupAdd").disabled = false;
  loadAutoList();
};

ensureAccount();
// everything above ran: the boot watchdog in index.html can stand down
window.__cordeBooted = true;
