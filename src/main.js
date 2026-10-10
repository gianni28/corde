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
import { accountMe, accountClaim, accountLink, accountSync } from "./net.js";
import { online, listSongs, downloadSong, fileUrl, joinRoom, newRoomCode, adminCall, uploadSong, topScores, submitScore, generalBoard, dailyToday, dailyBoard, submitDaily, secretSongs, secretBoard, songById } from "./net.js";
import { VENUES, TO_ENCORE, tourFor, progress as tourProgress, changes as tourChanges, nextSong as tourNextSong } from "./tour.js";
import { findSongs, convertSong, findMp3Songs, convertMp3Song } from "./admin.js";
import { fillDifficulties } from "./reduce.js";
import * as sfx from "./sfx.js";
import { energyCurve, energyAt } from "./energy.js";
import { createMenuMusic } from "./music.js";

const $ = (id) => document.getElementById(id);
const LANE_CSS = ["--g", "--r", "--y", "--b", "--o"];
let touch = isTouchDevice();
// a PC with a touchscreen can look like a phone until the first key press: from then on it's a PC (keys, 5 lanes)
addEventListener("keydown", () => { if (touch && !isTouchDevice()) touch = false; }, { capture: true, passive: true });

// iPhone: every tap/keypress re-asserts "music playback" so the silent switch doesn't mute the game.
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
};

/* ================= menu music ================= */
// A random library song plays while the menus are up (title and artist top right on a wide screen, under the
// menu on a phone). It stops when a song starts and picks up again back in the menus.
const MENU_MUSIC = ["home", "library", "setup", "settings", "mp", "lobby", "admin", "tutorial", "duo", "daily", "tour"];
const wideMQ = matchMedia("(min-width: 1000px)");
const music = createMenuMusic({ onChange: () => renderNowPlaying() });
// It starts as soon as the page opens: a random song is fetched right away and plays the moment the browser
// allows sound. Chrome allows it straight away on sites you use a lot and in the installed app; otherwise the first
// touch, click or key starts it (already loaded, so instantly), with a "touch to listen" hint until then.
function syncMenuMusic() {
  if (MENU_MUSIC.includes(app.screen) && !app.game && !document.hidden) music.play(); else music.pause();
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
    $("npCover").hidden = !cov; if (cov) $("npCover").src = cov;
  }
  const sub = blocked ? (touch ? "Toca la pantalla para escucharla" : "Haz clic o presiona una tecla para escucharla") : info.song?.artist || "";
  if ($("npArtist").textContent !== sub) $("npArtist").textContent = sub;
  $("npMute").setAttribute("aria-pressed", String(info.muted));
}
$("npMute").onclick = () => { if (music.info().blocked) return; settings.menuMusic = music.muted; save(); music.setMuted(!music.muted); syncMenuMusic(); };
$("npSkip").onclick = () => { if (!music.info().blocked) music.skip(); };
wideMQ.addEventListener?.("change", renderNowPlaying);
addEventListener("resize", () => renderNowPlaying());
document.addEventListener("visibilitychange", () => syncMenuMusic());
music.setMuted(settings.menuMusic === false);

/* ================= navigation ================= */
const SCREENS = ["home", "library", "setup", "settings", "mp", "lobby", "pause", "results", "loading", "admin", "tutorial", "duo", "daily", "tour"];
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
  // the stage behind: the tour's venues in the tour and its songs, the usual bar everywhere else
  const look = name === "tour" ? tourLook
    : ["play", "pause", "results"].includes(name) || app.game ? (app.ctx?.kind === "tour" ? app.ctx.stage : "bar")
    : name === "loading" ? null : "bar";
  if (look) R.setStage?.(look);
  syncMenuMusic();
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
// "best" = each player's best single run. Top 10 beside the menu, top 5 under it.
let homeTab = "total", homeReq = 0;
async function renderHomeBoard() {
  const el = $("homeBoard");
  if (!online) { el.hidden = true; return; }
  el.querySelectorAll("#homeTabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === homeTab)));
  const req = ++homeReq;
  let rows;
  try { rows = await generalBoard(homeTab, innerWidth >= 1000 ? 10 : 5); }
  catch (e) { console.warn("leaderboard:", e.message); return; }
  if (req !== homeReq) return;
  const me = (settings.name || "").trim().toLowerCase();
  const ol = el.querySelector(".board-list"); ol.innerHTML = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (me && r.name.trim().toLowerCase() === me) li.className = "me";
    li.innerHTML = `<span class="pos">${i + 1}</span><span class="n"><span class="nm"></span>${homeTab === "best" ? "<small></small>" : ""}</span><span class="s"></span>`;
    li.querySelector(".nm").textContent = r.name;
    if (homeTab === "best") li.querySelector("small").textContent = r.song;
    li.querySelector(".s").textContent = Number(homeTab === "total" ? r.total : r.score).toLocaleString("es-CO");
    ol.appendChild(li);
  });
  el.querySelector(".board-empty").hidden = rows.length > 0;
  el.hidden = false;
}
$("homeTabs").onclick = (e) => { const b = e.target.closest("button"); if (!b || b.dataset.v === homeTab) return; homeTab = b.dataset.v; renderHomeBoard(); };
renderHomeBoard();
// the library list is needed for the menu music right away (it's small).
// It starts on the next microtask, once this whole file has run: loadLibrary() reads secretCode() and other
// constants declared further down, and calling it right here threw silently (no songs, no menu music).
Promise.resolve().then(() => {
  if (!online) return;
  loadLibrary()
    .then((list) => { if (!app.songs.length) app.songs = list; music.setSongs(list.filter((s) => !s.secret)); syncMenuMusic(); })
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
// Songs the admin hid: five taps on the little pick at the bottom of the song list ask for the code, and with it the
// database hands them out (it never sends them otherwise). The code stays in this browser until "Esconderlas".
// They live in their own tab and never join the tour, the song of the day, the menu music or the home boards.
const SECRET_KEY = "corde.secret.v1";
const secretCode = () => { try { return localStorage.getItem(SECRET_KEY) || ""; } catch { return ""; } };
const publicSongs = () => app.songs.filter((s) => !s.secret);
app.libTab = "all"; // "all" | "secret"
// The library: the public songs, plus the secret ones (marked secret: true) when this browser knows the code
async function loadLibrary() {
  const code = secretCode();
  const [pub, sec] = await Promise.all([
    listSongs(),
    code ? secretSongs(code).catch((e) => { if (e.wrongCode) lockSecret(); return null; }) : [],
  ]);
  // the code is fine but the secret songs didn't come (connection): keep the ones we had
  const secret = sec ? sec.map((x) => ({ ...x, secret: true })) : app.songs.filter((x) => x.secret);
  return [...pub, ...secret];
}
// the admin changed the code, or the player hid them again
function lockSecret() {
  try { localStorage.removeItem(SECRET_KEY); } catch {}
  app.songs = app.songs.filter((x) => !x.secret);
  app.libTab = "all";
}
function openSecret() {
  if (secretCode()) { app.libTab = "secret"; renderSongs(); $("songList").scrollTop = 0; return; }
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
    const list = await secretSongs(code);
    try { localStorage.setItem(SECRET_KEY, code); } catch {}
    app.songs = [...publicSongs(), ...list.map((x) => ({ ...x, secret: true }))];
    closeSecret();
    app.libTab = "secret"; renderSongs(); $("songList").scrollTop = 0;
    sfx.unlock();
    const n = list.length;
    celebrate({ kicker: "Código correcto", title: "Canciones secretas", kind: "secret", ms: 2800,
      sub: n ? `${n} ${n === 1 ? "canción desbloqueada" : "canciones desbloqueadas"}. Las encuentras en «Secretas».` : "Ya quedaron desbloqueadas, aunque todavía no hay ninguna." });
  } catch (err) {
    $("secretMsg").textContent = err.wrongCode ? "Ese no es. Intenta otra vez." : "No pude revisar el código. ¿Hay conexión?";
    form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
    $("secretInput").select();
  } finally { go.disabled = false; }
};
$("libTabs").onclick = (e) => {
  const b = e.target.closest("button[data-t]");
  if (!b || b.dataset.t === app.libTab) return;
  app.libTab = b.dataset.t; renderSongs(); $("songList").scrollTop = 0;
};
$("secretLock").onclick = () => {
  if (!confirm("¿Esconder otra vez las canciones secretas? Para verlas de nuevo hay que escribir el código.")) return;
  lockSecret(); renderSongs();
};
// a song by id: the library, or (a secret song a friend picked in a room) straight from the database
app.extraSongs = [];
const knownSong = (id) => app.songs.find((x) => x.id === id) || app.extraSongs.find((x) => x.id === id) || null;
async function findSong(id) {
  if (knownSong(id)) return knownSong(id);
  try { app.songs = await loadLibrary(); } catch {}
  if (knownSong(id)) return knownSong(id);
  try { const r = await songById(id); if (r) app.extraSongs.push({ ...r, secret: !!r.hidden }); } catch {}
  return knownSong(id);
}

async function openLibrary() {
  $("libTitle").textContent = app.mode === "pick" ? "Elige la canción" : app.mode === "duo" ? "2 jugadores" : "Canciones";
  $("localFolderBtn").hidden = touch;
  $("randomBox").hidden = !online || app.mode === "pick" || app.mode === "duo";
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
}
function renderSongs() {
  const box = $("songList");
  if (!online) { box.innerHTML = `<p class="empty">La biblioteca en línea aparece cuando el juego está conectado a Supabase.<br>Mientras tanto puedes tocar canciones desde tu dispositivo.</p>`; return; }
  // the secret songs get their own tab once this browser knows the code
  const unlocked = !!secretCode();
  if (!unlocked) app.libTab = "all";
  const secretTab = app.libTab === "secret";
  $("libTabs").hidden = !unlocked;
  $("libTabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === app.libTab)));
  $("secretLock").hidden = !secretTab;
  $("s-library").classList.toggle("secret-tab", secretTab);
  const q = $("libSearch").value.trim().toLowerCase();
  const tab = app.songs.filter((s) => !!s.secret === secretTab);
  const list = tab.filter((s) => !q || `${s.name} ${s.artist}`.toLowerCase().includes(q));
  if (!list.length) {
    box.innerHTML = `<p class="empty">${tab.length ? "Nada coincide con tu búsqueda." : secretTab ? "Todavía no hay canciones secretas." : "Todavía no hay canciones en la biblioteca."}</p>`;
    return;
  }
  box.innerHTML = "";
  for (const s of list) {
    const b = document.createElement("button");
    b.className = "song" + (s.secret ? " secret" : "");
    const cov = coverOf(s);
    const best = songBest(s.id);
    b.innerHTML = `${cov ? `<img loading="lazy" alt="" src="${cov}">` : `<div class="ph"></div>`}<span><span class="t"></span><span class="a"></span></span>`
      + `<span class="len">${best ? `<span class="best" title="Tu mejor: ${best.diff.name}">${starsHtml(best.stars)}<small>${best.diff.name}</small></span>` : ""}${fmtLen(s.duration_ms)}</span>`;
    b.querySelector(".t").textContent = s.name;
    b.querySelector(".a").textContent = s.artist || "";
    b.onclick = () => pickLibrarySong(s);
    box.appendChild(b);
  }
}
$("libSearch").oninput = renderSongs;

// Random song: pick the difficulty, then a random song that has it starts right away (never the same one twice in a row).
// The same box is in the library and on the results screen.
function randomBox(btn, diffs, fromResults) {
  $(btn).onclick = () => {
    const open = $(diffs).hidden;
    $(diffs).hidden = !open; $(btn).setAttribute("aria-expanded", String(open));
    if (open && fromResults) $(diffs).scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  $(diffs).onclick = async (e) => {
    const b = e.target.closest("button[data-d]");
    if (!b || app.loadingRandom) return;
    const diff = b.dataset.d;
    if (!app.songs.length) { try { app.songs = await loadLibrary(); } catch {} }
    // from the tab you're in: the secret songs only from «Secretas»
    const has = app.songs.filter((s) => (s.diffs?.[diff]?.n || 0) > 0 && !!s.secret === (app.libTab === "secret"));
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
  if (app.mode === "pick") { // host choosing for the room
    const diff = app.roomConfig?.diff || "medium";
    app.room.update({ config: { songId: s.id, diff, at: Date.now() } });
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
  app.boardLanes = lanes;
  const draw = () => { renderDiffChips($("setupDiffs"), app.chart, lanes, app.diff, (k) => { app.diff = k; settings.lastDiff = k; save(); draw(); }); showBoard($("setupBoard"), 5); };
  draw();
  const keys = settings.keys.slice(0, lanes).map(keyLabel).join(" ");
  const starHow = touch ? (liftOn() ? "Poder estrella: actívalo levantando o sacudiendo el celular, como una guitarra." : "Toca el multiplicador para activar el poder estrella.") : "Enter activa el poder estrella.";
  $("setupHint").textContent = touch
    ? `Juegas con ${lanes} cuerdas. Toca la columna de cada color cuando la nota llegue a los botones y mantén el dedo en las notas largas. ${starHow}`
    : `Juegas con ${lanes} cuerdas: ${keys}. Presiona cuando la nota llegue a los botones y mantén en las largas. Espacio o Esc para pausar. ${starHow}`;
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
  $("againBtn").hidden = false; $("againBtn").classList.add("primary"); $("otherSongBtn").hidden = false; $("menuBtn").textContent = "Menú";
  $("resRandomBox").hidden = true;
  show("results");
}
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
// the board of the chosen difficulty: top 10, how many played, and your place even if you're not in the top 10
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
    ol.appendChild(li);
  });
  empty.hidden = b.rows.length > 0;
  empty.textContent = "Nadie ha tocado esta dificultad hoy. ¡Sé el primero!";
  $("dailyCount").textContent = `${b.total} ${b.total === 1 ? "jugador" : "jugadores"} hoy en ${name}${strings}`;
  if (b.mine && b.mine.rank > 10) { $("dailyMe").textContent = `Tu puesto: #${b.mine.rank} con ${b.mine.score.toLocaleString("es-CO")}`; $("dailyMe").hidden = false; }
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
  const el = $("dailyRank");
  el.textContent = "Guardando en la clasificación del día…";
  try {
    const r = await submitDaily({ day: ctx.day, song_id: ctx.songId, diff, lanes, name: settings.name, secret: playerSecret(),
      score: sum.score, acc: sum.acc, max_combo: sum.maxCombo, stars: sum.stars });
    const s = app.songs.find((x) => x.id === ctx.songId);
    const dn = DIFFS.find((d) => d.key === diff).name + (usesFifth(s, diff) ? ` (${r.lanes} cuerdas)` : "");
    el.textContent = `Puesto #${r.rank} de ${r.players} hoy en ${dn}` + (r.newRecord ? "" : ` · tu mejor de hoy: ${r.best.toLocaleString("es-CO")}`);
    daily.boards = {};
  } catch (e) { el.textContent = /Espera/.test(e.message) ? e.message : "No se pudo guardar en la clasificación del día."; console.warn("daily:", e.message); }
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
  $("tourRoad").innerHTML = prog.venues.map((v, i) => `<i class="${v.complete ? "done" : v.open ? "open" : ""}${i === prog.current && !prog.done ? " here" : ""}"></i>`).join("");
  list.innerHTML = "";
  prog.venues.forEach((v, vi) => {
    const card = document.createElement("article");
    const expanded = vi === tourOpen && v.open;
    card.className = `venue v-${v.venue.id}` + (v.open ? " open" : " locked") + (v.complete ? " complete" : "") + (expanded ? " expanded" : "");
    const status = v.complete ? `<span class="venue-done">Superado</span>` : v.open ? "" : `<svg class="venue-lock" aria-hidden="true"><use href="#lock"/></svg>`;
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
  if (legend) return () => { sfx.unlock(); R.pyro(); celebrate({ kicker: "Gira terminada", title: "¡Leyenda del rock!", sub: `Llenaste ${legend.venue.in || legend.venue.name}. ¿Te le mides a la gira en otra dificultad?`, ms: 4200, kind: "legend" }); };
  if (venue) return () => { sfx.unlock(); R.pyro(); celebrate({ kicker: "Nuevo escenario", title: venue.next.name, sub: venue.next.blurb, ms: 3600, kind: "venue" }); };
  if (encore) return () => { sfx.encore(); celebrate({ kicker: v.venue.name, title: "¡Otra! ¡Otra!", sub: "El público pide el bis.", ms: 2600, kind: "encore" }); };
  return null;
}
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

/* ---------- tutorial (first song) + lifting the phone ---------- */
const liftOn = () => touch && motionAvailable() && settings.starMode !== "tap" && (!motionNeedsPermission() || settings.motion === "granted");
function activateStar(g = app.game) {
  if (!g || app.paused || app.rewinding || app.failing) return;
  g.activateStar(); // the frame loop reacts to the "starOn" event
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
  return touch ? (liftOn() ? "Levanta o sacude el celular" : "Toca el multiplicador") : "Pulsa Enter";
}
function hideStarTip() { tip.at = 0; tip.hideAt = 0; $("spTip").hidden = true; }
if (liftOn()) onLift(liftStar);
// iPhone forgets the motion permission every time the page opens. It's asked again only on a button tap in the
// screens a song starts from (not while just looking around), and not at all when the sensors already reach the page
// or the player chose to activate star power by tapping the multiplier.
const SONG_SCREENS = new Set(["setup", "daily", "tour", "results", "duo", "lobby"]);
if (touch && motionNeedsPermission()) {
  const rearm = (e) => {
    if (settings.starMode === "tap" || settings.motion !== "granted" || motionReady()) return;
    if (!SONG_SCREENS.has(app.screen) || !e.target.closest?.("button, [role=button], li")) return;
    requestMotion().then((ok) => ok && onLift(liftStar));
  };
  for (const ev of ["touchend", "click"]) document.addEventListener(ev, rearm, { capture: true, passive: true });
}
let tut = { i: 0, done: null, fromSettings: false };
function withTutorial(fn) {
  if (settings.tutorialDone) return fn();
  openTutorial({ done: fn });
}
function openTutorial({ done = null, fromSettings = false } = {}) {
  tut = { i: 0, done, fromSettings };
  $("tutNotes").textContent = touch
    ? "Toca la columna de cada color cuando la nota llegue a los botones. Mantén el dedo en las notas largas."
    : "Presiona la tecla de cada color cuando la nota llegue a los botones. Mantén en las notas largas.";
  $("tutStarHow").textContent = touch && motionAvailable() && settings.starMode !== "tap" ? "Actívalo levantando o sacudiendo el celular, como una guitarra." : touch ? "Toca el multiplicador." : "Actívalo con Enter.";
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
  const ok = await requestMotion();
  settings.motion = ok ? "granted" : "denied"; save();
  $("motionBtn").hidden = true; // asked once: iPhone won't show the prompt again anyway
  $("motionNote").hidden = ok;
  if (ok) onLift(liftStar);
  return ok;
}
$("motionBtn").onclick = askMotion;
$("tutAlertYes").onclick = async () => { $("tutAlert").hidden = true; await askMotion(); const n = tutPending; tutPending = null; n && n(); };
$("tutAlertNo").onclick = () => { $("tutAlert").hidden = true; const n = tutPending; tutPending = null; n && n(); };
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
  const player = new Player(app.decoded);
  player.missSfx = settings.missSfx;
  const common = { chart: app.chart, lanes, offsetMs: settings.offsetMs, songOffsetMs: app.songOffsetMs || 0, look: +settings.speed, autoSync: settings.autoSync };
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
  if (!energyCache.has(app.decoded)) energyCache.set(app.decoded, energyCurve(app.decoded.map((s) => s.buffer)));
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
}
// Keep what auto-sync learned only after a solid run, and move at most 30 ms per song so one bad game can't wreck the next.
function keepLearnedSync(g) {
  if (!g || !settings.autoSync || g.hits < 40 || g.accuracy < 0.6) return;
  const target = Math.max(settings.offsetMs - 30, Math.min(settings.offsetMs + 30, g.offsetMs));
  if (target !== settings.offsetMs) { settings.offsetMs = target; save(); }
}
// with two players, the one who played the most notes teaches the sync
const syncTeacher = () => games().reduce((a, b) => (b.hits > a.hits ? b : a), app.game);
function stopGame() {
  app.practice = null; app.failing = false; R.setHype(0.5); hideStarTip();
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
  app.game.player.missSfx = settings.missSfx;
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
  $("againBtn").hidden = app.mode === "mp";
  $("resRandomBox").hidden = app.mode === "mp" || !online || (!!app.ctx && !app.ctx.via);
  $("resRandomDiffs").hidden = true; $("resRandomBtn").setAttribute("aria-expanded", "false");
  $("menuBtn").textContent = app.mode === "mp" ? "Volver a la sala" : app.ctx?.kind === "tour" ? "Gira" : app.ctx?.kind === "daily" && !app.ctx.via ? "Canción del día" : "Menú";
  if (app.mode === "mp") { app.room.send("final", { name: app.me.name, ...sum }); app.finals[app.me.id] = { name: app.me.name, ...sum }; }
  renderRanking();
  app.game = null;
  R.setLanes(5);
  $("newRecord").hidden = true; $("boardMe").hidden = true; $("nameAsk").hidden = true; $("resultsBoard").hidden = true;
  app.boardLanes = app.lanes;
  if (app.mode !== "mp" && hasBoard()) {
    if (sum.failed) showBoard($("resultsBoard"), 10); // a failed song doesn't go on the board
    else if (settings.name || !(sum.score > 0)) sendScore(sum); else { $("nameAsk").hidden = false; $("boardName").value = ""; app.pendingScore = sum; }
  }
  const celebration = finishCtx(sum);
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
const localProgress = () => ({ days: [...new Set([...readDailyLog(), ...dailyLog.days])].sort(), bests, tour: readJson(TOUR_KEY, {}) });
function applyProgress(p) {
  if (!p || typeof p !== "object") return;
  if (p.bests && typeof p.bests === "object") { bests = p.bests; try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch {} }
  if (Array.isArray(p.days)) { dailyLog.days = [...new Set([...p.days, ...dailyLog.days])].sort().slice(-400); try { localStorage.setItem(DAILY_KEY, JSON.stringify({ days: dailyLog.days })); } catch {} }
  if (p.tour && typeof p.tour === "object") { try { localStorage.setItem(TOUR_KEY, JSON.stringify(p.tour)); } catch {} }
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
  syncNow(); // uploads what this browser had and brings what the other devices have
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

async function sendScore(sum) {
  if (!(sum.score > 0)) { showBoard($("resultsBoard"), 10); return; } // empty runs stay off the board
  try {
    const r = await submitScore({ song_id: app.song.id, diff: app.diff, lanes: app.lanes, secret: playerSecret(), name: settings.name,
      score: sum.score, acc: sum.acc, max_combo: sum.maxCombo, stars: sum.stars });
    $("newRecord").hidden = !r.newRecord;
    if (r.rank) { $("boardMe").textContent = `Tu mejor puesto: #${r.rank}`; $("boardMe").hidden = false; }
    showBoard($("resultsBoard"), 10, r.rank);
  } catch (e) { console.warn("leaderboard:", e.message); showBoard($("resultsBoard"), 10); }
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
async function showBoard(el, limit, myRank) {
  if (!hasBoard()) { el.hidden = true; return; }
  el.hidden = false;
  const fifth = (app.song.diffs?.[app.diff]?.lanes || [4]).includes(4);
  const lanes = (app.boardLanes || deviceLanes()) === 5 && fifth ? 5 : 4;
  const req = ++boardReq;
  let rows = [];
  try {
    // a secret song's board needs the code (a friend who joined a room without it sees none)
    if (app.song.secret) rows = secretCode() ? await secretBoard(secretCode(), app.song.id, app.diff, lanes, limit) : [];
    else rows = await topScores(app.song.id, app.diff, lanes, limit);
  } catch (e) { console.warn("leaderboard:", e.message); }
  if (req !== boardReq) return;
  const ol = el.querySelector(".board-list"); ol.innerHTML = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (myRank && i + 1 === myRank) li.className = "me";
    li.innerHTML = `<span class="pos">${i + 1}</span><span class="n"></span><span class="a">${Math.round((r.acc || 0) * 100)}%</span><span class="s">${r.score.toLocaleString("es-CO")}</span>`;
    li.querySelector(".n").textContent = r.name;
    ol.appendChild(li);
  });
  el.querySelector(".board-empty").hidden = rows.length > 0;
}
$("againBtn").onclick = () => startGame({ lanes: app.lanes, diff: app.diff, duo: app.duo, ctx: againCtx() });
$("menuBtn").onclick = () => {
  if (app.mode === "mp") { renderLobby(); show("lobby", false); }
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
  const n = "12345".indexOf(k);
  return n >= 0 && n < app.lanes ? n : -1;
}
const evTime = (e, g = app.game) => g.time() - Math.max(0, (performance.now() - e.timeStamp) / 1000);
let rebinding = -1;
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (calib.on) { e.preventDefault(); if (!e.repeat) calibTap(); return; }
  if (rebinding >= 0) { e.preventDefault(); finishRebind(k === "escape" ? null : k); return; }
  if (duoRebind && app.screen === "duo") { e.preventDefault(); finishDuoRebind(e); return; }
  if (!app.game) return;
  const spaceUsed = app.duo ? !!duoKey("Space") : settings.keys.slice(0, app.lanes).includes(" ");
  const pauseKey = k === "escape" || (k === " " && !spaceUsed);
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
  else if (k === "enter") { e.preventDefault(); activateStar(); }
});
addEventListener("keyup", (e) => {
  if (app.duo) { const hit = duoKey(e.code), g = hit && app.duoGames?.[hit.p]; if (g && hit.i < STAR_SLOT) g.release(hit.i); return; }
  const lane = laneForKey(e.key.toLowerCase()); if (lane >= 0 && app.game) app.game.release(lane);
});

const pointerLane = new Map();
canvas.addEventListener("pointerdown", (e) => {
  if (!app.game || app.paused || app.failing) return;
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
    const col = g.starOn ? "#3fbfff" : ["#f2e8d8", "#f5c518", "#1fd14a", "#ff7a1a"][m - 1];
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
  if (gs.length === 1) R.render({ ...necks[0], dt, energy: en.e, punch: en.p });
  else R.render({ players: necks, dt, energy: en.e, punch: en.p });
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
  else if (ev.type === "starOn") { const el = h.starPop; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); sfx.starOn(); hideStarTip(); g.ui.starWasReady = false; }
  else if (ev.type === "fail") failSong();
}
let prev = performance.now(), lastNet = 0;
const en = { e: 0.55, p: 0 };
function frame(now) {
  requestAnimationFrame(frame);
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
      if (!settings.starTipSeen) { // once is enough: after that the chime and the glowing meter say it
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
    if (gs.every((x) => x.ended)) finishGame();
  } else {
    // attract mode behind the menus: the menu song's own notes, in time with it (or a demo pattern when it's silent)
    const m = music.show();
    let t, notes, beats, energy = 0.55, punch = 0;
    if (m) { t = m.t; notes = m.notes; beats = m.beats; energy = m.energy; punch = m.punch; }
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
    R.render({ t, look: 1.6, notes, from, pressed, beats: visibleBeats(beats, t, 1.6), dt, energy, punch });
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
  $("keysField").hidden = touch;
  $("motionField").hidden = !(touch && motionAvailable());
  document.querySelectorAll("#starSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === settings.starMode)));
  $("motionTestBox").hidden = settings.starMode === "tap";
  $("starHint").hidden = !motionNeedsPermission();
  renderAccountField();
  $("openAdmin").hidden = !isAdminBrowser() || !online || touch || !!app.game;
  document.querySelectorAll("#laneSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === settings.laneMode));
  document.querySelectorAll("#qualitySeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === settings.gfx));
  document.querySelectorAll("#missSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === "on") === String(settings.missSfx)));
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
  const i = rebinding; rebinding = -1;
  if (k && !["escape"].includes(k)) {
    const j = settings.keys.indexOf(k);
    if (j >= 0 && j !== i) settings.keys[j] = settings.keys[i]; // swap if already used
    settings.keys[i] = k; save();
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
document.querySelectorAll("#missSeg button").forEach((b) => (b.onclick = () => { settings.missSfx = b.dataset.v === "on"; save(); renderSettings(); }));
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
function enterRoom(code) {
  const name = $("mpName").value.trim().slice(0, 16);
  if (!name) { $("mpErr").textContent = "Escribe tu nombre."; $("mpErr").hidden = false; return; }
  if (!online) { $("mpErr").textContent = "El multijugador necesita que el juego esté conectado a Supabase."; $("mpErr").hidden = false; return; }
  settings.name = name; save();
  app.me = { id: uid(), name, lanes: deviceLanes(), device: touch ? "cel" : "pc" };
  app.mode = "mp";
  app.roomConfig = null; app.loadedRoomSong = null;
  app.room = joinRoom(code, app.me, {
    onPeers: (ps) => { app.peers = ps; syncConfig(); renderLobby(); },
    onEvent: onRoomEvent,
    onStatus: (s) => { if (s === "error") toast("No se pudo conectar a la sala."); },
  });
  $("roomCode").textContent = code;
  renderInvite();
  if (!app.songs.length) loadLibrary().then((s) => { app.songs = s; renderLobby(); }).catch(() => {});
  renderLobby();
  show("lobby");
}
$("createRoom").onclick = () => enterRoom(newRoomCode());
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
function joinFromLink() {
  const m = location.hash.match(/^#sala-([a-z]{4})$/i);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  const code = m[1].toUpperCase();
  $("mpName").value = settings.name || ""; $("mpErr").hidden = true; $("joinCode").value = code;
  $("duoCard").hidden = $("duoOr").hidden = touch;
  show("mp");
  if (settings.name) enterRoom(code);
  else { $("mpErr").textContent = `Escribe tu nombre y toca Unirme para entrar a la sala ${code}.`; $("mpErr").hidden = false; $("mpName").focus(); }
}
setTimeout(joinFromLink, 0);
addEventListener("hashchange", joinFromLink);
$("leaveRoom").onclick = () => { app.room?.leave(); app.room = null; app.mode = "solo"; app.history = []; show("home", false); };

const roomLanes = () => Math.min(5, ...app.peers.map((p) => p.lanes || 5));
const host = () => app.peers[0];
const amHost = () => app.room && app.room.isHost();

async function syncConfig() {
  const h = host();
  const cfg = h?.config || null;
  app.roomConfig = cfg;
  if (!cfg) return;
  if (app.loadedRoomSong === cfg.songId || app.loadingRoomSong === cfg.songId) return;
  const song = await findSong(cfg.songId);
  if (!song) return;
  app.loadingRoomSong = cfg.songId;
  app.room.update({ ready: false, songId: null });
  try {
    if (app.loadedSongId !== song.id) {
      const { chart, stems } = await downloadSong(song, (p) => { $("lobbyStatus").textContent = `Descargando canción… ${Math.round(p * 100)}%`; });
      audioCtx();
      app.decoded = await decodeStems(stems);
      app.chart = chart; app.loadedSongId = song.id;
      app.songOffsetMs = song.audio_offset_ms || 0;
    }
    app.song = song; app.loadedRoomSong = song.id;
    app.room.update({ ready: true, songId: song.id });
  } catch (e) { toast(e.message); }
  app.loadingRoomSong = null;
  renderLobby();
}

function renderLobby() {
  if (!app.room) return;
  const ul = $("players"); ul.innerHTML = "";
  const cfg = app.roomConfig;
  app.peers.forEach((p, i) => {
    const li = document.createElement("li");
    const ready = cfg && p.ready && p.songId === cfg.songId;
    li.innerHTML = `<span class="n"></span>${i === 0 ? `<span class="tag host">Anfitrión</span>` : ""}<span class="tag">${p.device === "cel" ? "Celular" : "PC"}</span><span class="${ready ? "ok" : "wait"}">${cfg ? (ready ? "listo" : "cargando") : ""}</span>`;
    li.querySelector(".n").textContent = p.name + (p.id === app.me.id ? " (tú)" : "");
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
    renderDiffChips($("lobbyDiffs"), app.chart, lanes, cfg.diff, (k) => app.room.update({ config: { ...cfg, diff: k } }), !isHost);
  }
  const allReady = cfg && app.peers.length > 0 && app.peers.every((p) => p.ready && p.songId === cfg.songId);
  $("startRound").hidden = !isHost;
  $("startRound").disabled = !allReady || !notesFor(app.chart || { diffs: {} }, cfg?.diff, lanes).length;
  $("lobbyStatus").textContent = !cfg ? (isHost ? "Elige una canción para empezar." : "")
    : !allReady ? "Esperando a que todos descarguen la canción…"
    : `Todos listos. Se toca con ${lanes} cuerdas${lanes === 4 && app.peers.some((p) => p.lanes === 5) ? " porque alguien juega desde el celular" : ""}.`;
}
$("startRound").onclick = () => {
  const cfg = app.roomConfig; if (!cfg) return;
  const payload = { songId: cfg.songId, diff: cfg.diff, lanes: roomLanes() };
  app.room.send("start", payload);
  onRoomEvent("start", payload);
};

function onRoomEvent(ev, p) {
  if (ev === "start") {
    if (app.loadedRoomSong !== p.songId) { toast("Tu canción no terminó de cargar."); return; }
    app.diff = p.diff;
    startGame({ lanes: p.lanes, diff: p.diff });
  } else if (ev === "score") {
    app.rivals[p.from] = { name: p.name, score: p.score, combo: p.combo, acc: p.acc };
    renderRivals();
  } else if (ev === "final") {
    app.finals[p.from] = p;
    renderRanking();
  }
}
function renderRivals() {
  const ol = $("rivals");
  const list = Object.entries(app.rivals).sort((a, b) => b[1].score - a[1].score);
  ol.innerHTML = "";
  for (const [id, r] of list) {
    const li = document.createElement("li");
    if (id === app.me?.id) li.className = "me";
    li.innerHTML = `<span class="n"></span><span class="s">${r.score.toLocaleString("es-CO")}</span><span class="m">${Math.round((r.acc || 0) * 100)}% · racha ${r.combo}</span>`;
    li.querySelector(".n").textContent = r.name;
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
    ol.appendChild(li);
  }
  const waiting = app.peers.length - list.length;
  if (waiting > 0) { const li = document.createElement("li"); li.innerHTML = `<span class="n" style="color:var(--muted)">Esperando a ${waiting} jugador${waiting > 1 ? "es" : ""}…</span>`; ol.appendChild(li); }
}

// expose for debugging / tests
window.__corde = { app, R, music };

/* ================= admin uploads ================= */
const adm = { songs: [], busy: false };
const ADMIN_KEY = "corde.adminCode";
// The upload screen is hidden for everyone; the admin opens it once with /#admin and it stays visible in that browser.
function isAdminBrowser() { try { return !!localStorage.getItem(ADMIN_KEY); } catch { return false; } }
try { $("adminCode").value = localStorage.getItem(ADMIN_KEY) || ""; } catch {}
$("openAdmin").onclick = () => { if (app.game) return; show("admin"); loadAutoList(); };
if (location.hash === "#admin") setTimeout(() => { show("admin"); loadAutoList(); }, 0);

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
  if (code) { try { adm.lib = (await adminCall({ code, action: "list" })).songs || []; return adm.lib; } catch {} }
  adm.lib = null; // without the code only the public library: not enough to manage the secret songs
  return listSongs();
}
async function loadAutoList() {
  if (!online) return;
  let lib = [];
  try { lib = await adminLibrary(); } catch { return; }
  renderSecretAdmin();
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
  adm.busy = true; renderAdmin();
  let lib = [];
  try { lib = await adminLibrary(); } catch {}
  const secret = $("adminSecret").checked;
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
      // secret only when asked: a re-upload without the box keeps whatever the song was
      if (secret) conv.row.hidden = true;
      await uploadSong(code, conv, (p) => set("Subiendo", 0.85 + p * 0.15));
      for (const x of autos) if (x.id !== conv.id) await adminCall({ code, action: "delete", id: x.id });
      const replaced = autos.length ? " · reemplazó la del MP3" : "";
      if (conv.warnMs) set(`Subida${replaced}, pero revisa: las notas podrían ir desfasadas (unos ${conv.warnMs} ms)`, 1, "warn");
      else set("Lista" + replaced, 1, "ok");
      ok++;
    } catch (e) { set(e.message || "Error", 0, "bad"); bad++; }
  }
  adm.busy = false; renderAdmin();
  app.songs = []; app.loadedSongId = null; // reload the library (and any re-uploaded song) next time
  loadAutoList();
  $("adminStatus").textContent = `Listo: ${ok} subida${ok === 1 ? "" : "s"}${bad ? `, ${bad} con error` : ""}. ${secret ? "Ya aparecen en «Secretas» (con el código)." : "Ya aparecen en Jugar."}`;
};

/* --- secret songs, from the admin's side: hide/show songs and change the code --- */
function renderSecretAdmin() {
  const ul = $("secretList"); ul.innerHTML = "";
  const lib = adm.lib || [];
  const q = $("secretFind").value.trim().toLowerCase();
  // the secret ones; searching finds any song, to hide it or bring it back
  const list = q ? lib.filter((x) => `${x.name} ${x.artist || ""}`.toLowerCase().includes(q)).slice(0, 60) : lib.filter((x) => x.hidden);
  $("secretEmpty").textContent = !adm.lib ? "Escribe el código de administrador para ver la biblioteca." : list.length ? "" : q ? "Ninguna canción coincide." : "Todavía no hay canciones secretas. Búscalas aquí para esconderlas, o súbelas marcando «Subirlas como secretas».";
  for (const x of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n"><span class="t"></span> <span class="a"></span></span><button type="button" aria-pressed="${!!x.hidden}"></button>`;
    li.querySelector(".t").textContent = x.name; li.querySelector(".a").textContent = x.artist ? `· ${x.artist}` : "";
    const b = li.querySelector("button");
    b.textContent = x.hidden ? "Secreta" : "Pública";
    b.title = x.hidden ? "Tócala para que vuelva a la biblioteca" : "Tócala para esconderla";
    b.onclick = async () => {
      const code = $("adminCode").value.trim();
      if (!code) { $("secretStatus").textContent = "Escribe el código de administrador."; return; }
      b.disabled = true;
      try {
        await adminCall({ code, action: "hide", id: x.id, hidden: !x.hidden });
        x.hidden = !x.hidden;
        $("secretStatus").textContent = x.hidden ? `«${x.name}» ahora es secreta.` : `«${x.name}» volvió a la biblioteca.`;
        app.songs = []; // the library reloads with it in its new place
      } catch (e) { $("secretStatus").textContent = e.message; }
      renderSecretAdmin(); loadAutoList();
    };
    ul.appendChild(li);
  }
}
$("secretFind").oninput = renderSecretAdmin;
$("adminCode").addEventListener("change", () => loadAutoList());
$("secretSave").onclick = async () => {
  const code = $("adminCode").value.trim(), next = $("secretNew").value.trim();
  if (!code) { $("secretStatus").textContent = "Escribe el código de administrador."; return; }
  if (next.length < 3) { $("secretStatus").textContent = "El código secreto necesita al menos 3 letras."; return; }
  $("secretSave").disabled = true;
  try {
    await adminCall({ code, action: "secret", secret: next });
    // this browser keeps its secret songs with the new code (everyone else has to type it)
    if (secretCode()) { try { localStorage.setItem(SECRET_KEY, next); } catch {} }
    $("secretNew").value = "";
    $("secretStatus").textContent = `Listo: el código secreto ahora es «${next.toLowerCase()}». Quien tenía el anterior tendrá que escribir este.`;
  } catch (e) { $("secretStatus").textContent = e.message; }
  $("secretSave").disabled = false;
};

ensureAccount();
// everything above ran: the boot watchdog in index.html can stand down
window.__cordeBooted = true;
