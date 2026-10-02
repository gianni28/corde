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
import { motionAvailable, motionNeedsPermission, requestMotion, onLift } from "./motion.js";
import { settings, save, resetKeys, deviceLanes, isTouchDevice, keyLabel } from "./settings.js";
import { online, listSongs, downloadSong, fileUrl, joinRoom, newRoomCode, adminCall, uploadSong, topScores, submitScore, generalBoard } from "./net.js";
import { findSongs, convertSong, findMp3Songs, convertMp3Song } from "./admin.js";
import { fillDifficulties } from "./reduce.js";
import * as sfx from "./sfx.js";
import { energyCurve, energyAt } from "./energy.js";
import { createMenuMusic } from "./music.js";

const $ = (id) => document.getElementById(id);
// New texts waiting for Gianni's OK: the tutorial's motion-permission alert and the "star power ready" reminder.
const NEW_TEXTS = false;
const LANE_CSS = ["--g", "--r", "--y", "--b", "--o"];
const touch = isTouchDevice();

// iPhone: every tap/keypress re-asserts "music playback" so the silent switch doesn't mute the game.
["pointerdown", "touchend", "keydown"].forEach((t) => addEventListener(t, unlockAudio, { capture: true, passive: true }));

/* ================= renderer + attract mode ================= */
const canvas = $("stage");
const R = createRenderer(canvas);
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
const MENU_MUSIC = ["home", "library", "setup", "settings", "mp", "lobby", "admin", "tutorial"];
const wideMQ = matchMedia("(min-width: 1000px)");
const music = createMenuMusic({ onChange: () => renderNowPlaying() });
// Nothing is downloaded until the player first touches the page (browsers wouldn't play it before that anyway,
// and visitors who leave right away cost no bandwidth).
let musicArmed = false;
function armMusic() {
  if (musicArmed) return;
  musicArmed = true;
  ["pointerdown", "keydown"].forEach((t) => removeEventListener(t, armMusic, true));
  syncMenuMusic();
}
["pointerdown", "keydown"].forEach((t) => addEventListener(t, armMusic, { capture: true, passive: true }));
function syncMenuMusic() {
  if (!musicArmed) return renderNowPlaying();
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
  const roomy = app.screen === "home" || innerWidth >= 1400; // beside a centred panel only when it can't overlap it
  const onMenu = MENU_MUSIC.includes(app.screen) && !app.game && roomy;
  el.hidden = !online || !(info.muted || (info.playing && info.song)) || (wide && !onMenu);
  if (info.song && info.song !== npSong) {
    npSong = info.song;
    $("npTitle").textContent = info.song.name;
    $("npArtist").textContent = info.song.artist || "";
    const cov = coverOf(info.song);
    $("npCover").hidden = !cov; if (cov) $("npCover").src = cov;
  }
  $("npMute").setAttribute("aria-pressed", String(info.muted));
}
$("npMute").onclick = () => { settings.menuMusic = music.muted; save(); music.setMuted(!music.muted); syncMenuMusic(); };
$("npSkip").onclick = () => music.skip();
wideMQ.addEventListener?.("change", renderNowPlaying);
addEventListener("resize", () => renderNowPlaying());
document.addEventListener("visibilitychange", () => syncMenuMusic());
music.setMuted(settings.menuMusic === false);

/* ================= navigation ================= */
const SCREENS = ["home", "library", "setup", "settings", "mp", "lobby", "pause", "results", "loading", "admin", "tutorial"];
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
  if (name === "home") renderHomeBoard();
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
  else if (to === "mp") { $("mpName").value = settings.name || ""; $("mpErr").hidden = true; show("mp"); }
}));

// every menu button gives a little pick sound (lower for "Volver"); nothing while playing
document.addEventListener("click", (e) => {
  if (app.screen === "play") return;
  const b = e.target.closest("#ui button, #ui label.btn");
  if (!b || b.disabled || b.classList.contains("np-btn")) return;
  try { b.matches("[data-back]") ? sfx.back() : sfx.click(); } catch {}
});

let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
function loading(label, p) { $("loadLabel").textContent = label; $("loadBar").style.width = Math.round((p || 0) * 100) + "%"; }

// ?debug exposes the app to automated tests (never needed by players)
if (new URLSearchParams(location.search).has("debug")) window.__corde = { app, R, music };

/* ================= home ================= */
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
// the library list is needed for the menu music right away (it's small)
if (online) listSongs().then((list) => { if (!app.songs.length) app.songs = list; music.setSongs(list); syncMenuMusic(); }).catch(() => {});

/* ================= library ================= */
const fmtLen = (ms) => { if (!ms) return ""; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const coverOf = (s) => (s.has_cover ? fileUrl(s.id, "cover.jpg") : "");

async function openLibrary() {
  $("libTitle").textContent = app.mode === "pick" ? "Elige la canción" : "Canciones";
  $("localFolderBtn").hidden = touch;
  $("randomBox").hidden = !online || app.mode === "pick";
  $("randomDiffs").hidden = true; $("randomBtn").setAttribute("aria-expanded", "false");
  show("library");
  renderSongs();
  if (!online) return;
  if (!app.songs.length) {
    $("songList").innerHTML = `<p class="empty">Cargando biblioteca…</p>`;
    try { app.songs = await listSongs(); renderSongs(); }
    catch (e) { $("songList").innerHTML = `<p class="empty">${e.message}</p>`; }
    return;
  }
  // refresh quietly so new songs and re-uploads (offsets, charts) show up without reloading the page
  try {
    const fresh = await listSongs();
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
  const q = $("libSearch").value.trim().toLowerCase();
  const list = app.songs.filter((s) => !q || `${s.name} ${s.artist}`.toLowerCase().includes(q));
  if (!list.length) { box.innerHTML = `<p class="empty">${app.songs.length ? "Nada coincide con tu búsqueda." : "Todavía no hay canciones en la biblioteca."}</p>`; return; }
  box.innerHTML = "";
  for (const s of list) {
    const b = document.createElement("button");
    b.className = "song";
    const cov = coverOf(s);
    b.innerHTML = `${cov ? `<img loading="lazy" alt="" src="${cov}">` : `<div class="ph"></div>`}<span><span class="t"></span><span class="a"></span></span><span class="len">${fmtLen(s.duration_ms)}</span>`;
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
    if (!app.songs.length) { try { app.songs = await listSongs(); } catch {} }
    const has = app.songs.filter((s) => (s.diffs?.[diff]?.n || 0) > 0);
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
      withTutorial(() => startGame({ lanes: deviceLanes(), diff: app.diff }));
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
    openSetup();
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
    openSetup();
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
    b.innerHTML = `${d.name}<span class="dots">${used.map((l) => `<i style="background:var(${LANE_CSS[l]})"></i>`).join("")}</span><small>${ns.length} notas</small>`;
    b.onclick = () => onPick(d.key);
    box.appendChild(b);
  }
}
function defaultDiff(chart, lanes) {
  const pref = settings.lastDiff || (lanes === 4 ? "medium" : "hard");
  return notesFor(chart, pref, lanes).length ? pref : DIFFS.map((d) => d.key).find((k) => notesFor(chart, k, lanes).length);
}

/* ================= setup (solo) ================= */
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
  const starHow = touch ? (liftOn() ? "Poder estrella: actívalo levantando el celular, como una guitarra." : "Toca el multiplicador para activar el poder estrella.") : "Enter activa el poder estrella.";
  $("setupHint").textContent = touch
    ? `Juegas con ${lanes} cuerdas. Toca la columna de cada color cuando la nota llegue a los botones y mantén el dedo en las notas largas. ${starHow}`
    : `Juegas con ${lanes} cuerdas: ${keys}. Presiona cuando la nota llegue a los botones y mantén en las largas. Espacio o Esc para pausar. ${starHow}`;
  $("practiceBox").hidden = true; $("practiceBtn").setAttribute("aria-expanded", "false");
  show("setup");
}
$("playBtn").onclick = () => withTutorial(() => startGame({ lanes: deviceLanes(), diff: app.diff }));

/* ---------- practice one part ---------- */
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
// The parts of a song for the chosen difficulty: its sections (or ~25 s chunks when the chart has none).
function practiceParts() {
  const notes = notesFor(app.chart, app.diff, deviceLanes());
  if (!notes.length) return [];
  const last = notes[notes.length - 1].t + notes[notes.length - 1].dur;
  let starts = (app.chart.sections || []).map(([t, n], i) => ({ t, name: sectionName(n, i) }));
  if (starts.length < 2) {
    starts = [];
    for (let t = notes[0].t, i = 0; t < last; t += 25, i++) starts.push({ t: i ? t : 0, name: sectionName("", i) });
  }
  const parts = [];
  starts.forEach((s, i) => {
    const to = i + 1 < starts.length ? starts[i + 1].t - 0.05 : last + 0.5;
    const n = notes.filter((x) => x.t >= s.t - 0.01 && x.t <= to).length;
    if (n >= 4) parts.push({ from: s.t, to, name: s.name });
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

/* ---------- tutorial (first song) + lifting the phone ---------- */
const liftOn = () => touch && motionAvailable() && (!motionNeedsPermission() || settings.motion === "granted");
function activateStar() {
  const g = app.game;
  if (!g || app.paused || app.rewinding || app.failing) return;
  g.activateStar(); // the frame loop reacts to the "starOn" event
}
/* ---------- star power feedback ---------- */
// a white-blue spark flies from the frets into the meter, which flashes when it lands
function starComet(lane) {
  const m = $("mult").getBoundingClientRect();
  const x0 = R.laneScreenX(Math.min(lane ?? 2, (app.lanes || 5) - 1)), y0 = R.strikeScreenY() - 20;
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
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { starGain(); return; }
  setTimeout(() => { if (!app.starShown) starGain(); }, dur + 300); // in case the animation never finishes
  fly("", 0, 1).finished.then(starGain).catch(() => {});
  fly(" tail", 45, 0.8); fly(" tail", 90, 0.6);
}
let gainT = 0;
function starGain() {
  const el = $("mult");
  el.classList.remove("gain"); void el.offsetWidth; el.classList.add("gain");
  clearTimeout(gainT); gainT = setTimeout(() => el.classList.remove("gain"), 800);
  for (const k of ["star", "mult"]) delete hudCache[k]; // the meter catches up now, with the flash
  app.starShown = true;
}
// "star power ready" reminder (top left) if the player doesn't use it within a couple of seconds
const tip = { at: 0, hideAt: 0 };
function starTipHow() {
  return touch ? (liftOn() ? "Levanta el celular" : "Toca el multiplicador") : "Pulsa Enter";
}
function hideStarTip() { tip.at = 0; tip.hideAt = 0; $("spTip").hidden = true; }
if (liftOn()) onLift(activateStar);
let tut = { i: 0, done: null, fromSettings: false };
function withTutorial(fn) {
  // iPhone: a permission given earlier may need confirming again; ask now, from this tap, never during a song
  if (touch && motionNeedsPermission() && settings.motion === "granted") requestMotion().then((ok) => { if (ok) onLift(activateStar); });
  if (settings.tutorialDone) return fn();
  openTutorial({ done: fn });
}
function openTutorial({ done = null, fromSettings = false } = {}) {
  tut = { i: 0, done, fromSettings };
  $("tutNotes").textContent = touch
    ? "Toca la columna de cada color cuando la nota llegue a los botones. Mantén el dedo en las notas largas."
    : "Presiona la tecla de cada color cuando la nota llegue a los botones. Mantén en las notas largas.";
  $("tutStarHow").textContent = touch && motionAvailable() ? "Actívalo levantando el celular, como una guitarra." : "Actívalo con Enter.";
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
const motionUnasked = () => NEW_TEXTS && touch && motionNeedsPermission() && !settings.motion;
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
  if (ok) onLift(activateStar);
  return ok;
}
$("motionBtn").onclick = askMotion;
$("tutAlertYes").onclick = async () => { $("tutAlert").hidden = true; await askMotion(); const n = tutPending; tutPending = null; n && n(); };
$("tutAlertNo").onclick = () => { $("tutAlert").hidden = true; const n = tutPending; tutPending = null; n && n(); };
$("openTutorial").onclick = () => openTutorial({ fromSettings: true });
$("mult").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); activateStar(); });

/* ================= gameplay ================= */
const energyCache = new WeakMap(); // decoded song → its energy curve (worked out once per song)
function startGame({ lanes, diff, practice = null }) {
  stopGame();
  const player = new Player(app.decoded);
  player.missSfx = settings.missSfx;
  // the rock meter can end the song only on Difícil/Experto, and never in practice or multiplayer
  const canFail = !practice && app.mode !== "mp" && (diff === "hard" || diff === "expert");
  app.game = new Game({ chart: app.chart, diff, lanes, player, offsetMs: settings.offsetMs, songOffsetMs: app.songOffsetMs || 0, look: +settings.speed, autoSync: settings.autoSync, practice, canFail });
  app.practice = practice ? { ...practice, loopAt: Math.min(practice.to + 1.2, player.duration - (app.songOffsetMs || 0) / 1000 - 0.2) } : null;
  app.failing = false;
  if (!energyCache.has(app.decoded)) energyCache.set(app.decoded, energyCurve(app.decoded.map((s) => s.buffer)));
  app.energy = energyCache.get(app.decoded);
  app.starWasReady = false; app.starShown = true; hideStarTip();
  $("practiceTag").hidden = !practice;
  $("hud").classList.toggle("mp", app.mode === "mp");
  $("failFx").classList.remove("on");
  app.lanes = lanes;
  app.diff = diff;
  R.setLanes(lanes);
  app.paused = false;
  app.finals = {}; app.rivals = {};
  lastSection = -2;
  for (const k in hudCache) delete hudCache[k];
  $("rivals").hidden = app.mode !== "mp";
  show("play");
  unlockAudio();
  app.game.start();
  if (!practice) sfx.intro(lanes, (i) => R.hit(i)); // the frets light up one by one with a little riff, like the classics
  try { navigator.wakeLock?.request("screen").then((l) => (app.wake = l)).catch(() => {}); } catch {}
}
// Keep what auto-sync learned only after a solid run, and move at most 30 ms per song so one bad game can't wreck the next.
function keepLearnedSync(g) {
  if (!g || !settings.autoSync || g.hits < 40 || g.accuracy < 0.6) return;
  const target = Math.max(settings.offsetMs - 30, Math.min(settings.offsetMs + 30, g.offsetMs));
  if (target !== settings.offsetMs) { settings.offsetMs = target; save(); }
}
function stopGame() {
  app.practice = null; app.failing = false; R.setHype(0.5); hideStarTip();
  if (!app.game) return;
  keepLearnedSync(app.game);
  app.game.player.stop();
  app.game = null;
  try { app.wake?.release(); } catch {}
}
function pauseGame() {
  if (!app.game || app.paused || app.game.ended || app.failing) return;
  if (app.mode === "mp") return toast("En multijugador no se puede pausar.");
  app.paused = true; app.game.player.pause(); hideStarTip(); show("pause");
}
function resumeGame() {
  if (!app.game || !app.paused) return;
  app.game.pressed.fill(false);
  app.game.look = +settings.speed;
  app.game.offset = settings.offsetMs / 1000;
  app.game.player.missSfx = settings.missSfx;
  const g = app.game, pausedAt = g.lastT;
  if (pausedAt <= 0) { g.player.resume().then(() => { app.paused = false; }); show("play", false); return; }
  // rewind animation: the highway runs backwards ~10 s, then the music restarts there
  g.hidePlayed();
  app.rewinding = { from: pausedAt, to: Math.max(0, g.resumeAt - 10), start: performance.now(), dur: 1100 };
  show("play", false);
}
$("pauseBtn").onclick = pauseGame;
$("pauseSettingsBtn").onclick = () => { app.settingsFromPause = true; renderSettings(); show("settings", false); };
function backToPause() { app.settingsFromPause = false; show("pause", false); }
$("resumeBtn").onclick = resumeGame;
$("restartBtn").onclick = () => startGame({ lanes: app.lanes, diff: app.diff, practice: app.practice });
$("quitBtn").onclick = () => { stopGame(); R.setLanes(5); show("setup", false); };
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

function finishGame() {
  const g = app.game; if (!g) return;
  const sum = g.summary();
  g.player.stop();
  keepLearnedSync(g);
  app.lastSummary = sum;
  app.failing = false; app.practice = null; R.setHype(0.5);
  $("resFail").hidden = !sum.failed;
  renderSections(sum);
  $("resSong").textContent = `${app.song.name} · ${DIFFS.find((d) => d.key === app.diff).name}`;
  $("resScore").textContent = sum.score.toLocaleString("es-CO");
  $("resStars").innerHTML = "★".repeat(sum.stars) + `<span class="off">${"★".repeat(5 - sum.stars)}</span>`;
  if (sum.failed) sfx.failed(); else sfx.finale(sum.stars); // a chord, then the crowd cheers or boos
  $("resHit").textContent = `${sum.hits}/${sum.total}`;
  $("resAcc").textContent = Math.round(sum.acc * 100) + "%";
  $("resCombo").textContent = sum.maxCombo;
  $("againBtn").hidden = app.mode === "mp";
  $("resRandomBox").hidden = app.mode === "mp" || !online;
  $("resRandomDiffs").hidden = true; $("resRandomBtn").setAttribute("aria-expanded", "false");
  $("menuBtn").textContent = app.mode === "mp" ? "Volver a la sala" : "Menú";
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
  show("results");
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
  for (const s of secs) {
    const pct = Math.round((s.hit / s.total) * 100);
    const li = document.createElement("li");
    li.className = pct >= 90 ? "great" : pct < 60 ? "weak" : "";
    li.innerHTML = `<span class="n"></span><span class="b"><i style="width:${pct}%"></i></span><span class="p">${pct}%</span>`;
    li.querySelector(".n").textContent = sectionName(s.name, s.i);
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
  try { rows = await topScores(app.song.id, app.diff, lanes, limit); } catch (e) { console.warn("leaderboard:", e.message); }
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
$("againBtn").onclick = () => startGame({ lanes: app.lanes, diff: app.diff });
$("menuBtn").onclick = () => { if (app.mode === "mp") { renderLobby(); show("lobby", false); } else { app.history = ["home"]; show("library", false); } };

/* ================= input ================= */
function laneForKey(k) {
  if (!app.game) return -1;
  const i = settings.keys.slice(0, app.lanes).indexOf(k);
  if (i >= 0) return i;
  const n = "12345".indexOf(k);
  return n >= 0 && n < app.lanes ? n : -1;
}
const evTime = (e) => app.game.time() - Math.max(0, (performance.now() - e.timeStamp) / 1000);
let rebinding = -1;
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (rebinding >= 0) { e.preventDefault(); finishRebind(k === "escape" ? null : k); return; }
  if (!app.game) return;
  const pauseKey = k === "escape" || (k === " " && !settings.keys.slice(0, app.lanes).includes(" "));
  if (pauseKey) {
    e.preventDefault();
    if (app.screen === "settings" && app.settingsFromPause) { backToPause(); return; }
    app.paused ? resumeGame() : pauseGame(); return;
  }
  if (e.repeat || app.paused || app.failing) return;
  const lane = laneForKey(k);
  if (lane >= 0) { e.preventDefault(); app.game.press(lane, evTime(e)); }
  else if (k === "enter") { e.preventDefault(); activateStar(); }
});
addEventListener("keyup", (e) => { const lane = laneForKey(e.key.toLowerCase()); if (lane >= 0 && app.game) app.game.release(lane); });

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
const ring = $("multRing");
ring.innerHTML = Array.from({ length: 10 }, (_, i) => {
  const a0 = (i / 10) * Math.PI * 2 + 0.09, a1 = ((i + 1) / 10) * Math.PI * 2 - 0.09, r = 26;
  const p = (a) => `${32 + r * Math.cos(a)} ${32 + r * Math.sin(a)}`;
  return `<path d="M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}" stroke-width="6" fill="none" stroke-linecap="butt"/>`;
}).join("");
const ringSegs = [...ring.children];
let lastSection = -2, judgeT = 0;
let streakT = 0;
function streak(text) {
  const el = $("streak"); el.textContent = text;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(streakT); streakT = setTimeout(() => el.classList.remove("show"), 1700);
}
function judge(text, color) {
  const j = $("judge"); j.textContent = text; j.style.color = color;
  j.style.top = Math.max(80, R.strikeScreenY() - 130) + "px";
  j.classList.add("show"); clearTimeout(judgeT); judgeT = setTimeout(() => j.classList.remove("show"), 60);
}
// Only touch the DOM when a value actually changed (keeps layout/paint out of most frames).
const hudCache = {};
const setHud = (k, v, fn) => { if (hudCache[k] !== v) { hudCache[k] = v; fn(v); } };
function updateHUD(g, t) {
  setHud("score", Math.round(g.score), (v) => ($("score").textContent = v.toLocaleString("es-CO")));
  setHud("combo", g.combo, (v) => ($("combo").textContent = v));
  const m = g.baseMultiplier, shown = g.multiplier;
  const starState = g.starOn ? " star-on" : g.starMeter >= STAR_READY && app.starShown ? " star-ready" : "";
  setHud("mult", shown + starState, () => { $("multText").textContent = "×" + shown; const gain = $("mult").classList.contains("gain"); $("mult").className = "mult x" + m + starState + (gain ? " gain" : ""); });
  const fill = m >= 4 ? 10 : g.combo % 10;
  setHud("ring", m * 100 + fill + (g.starOn ? 1000 : 0), () => {
    const col = g.starOn ? "#3fbfff" : ["#f2e8d8", "#f5c518", "#1fd14a", "#ff7a1a"][m - 1];
    ringSegs.forEach((s, i) => s.setAttribute("stroke", i < fill ? col : "rgba(255,255,255,.1)"));
  });
  if (app.starShown) setHud("star", Math.round(g.starMeter * 100), (v) => $("starFill").setAttribute("stroke-dasharray", `${v} 100`));
  // rock meter needle: -60° (red, about to fail) … +60° (green)
  setHud("rock", Math.round(g.rock * 60), (v) => ($("rockNeedle").style.transform = `rotate(${(v / 60) * 120 - 60}deg)`));
  setHud("danger", g.canFail && g.rock < 0.25, (v) => $("rock").classList.toggle("danger", v));
  setHud("prog", Math.round(Math.max(0, Math.min(1, t / g.end)) * 400), (v) => ($("progress").style.transform = `scaleX(${v / 400})`));
  const si = g.section(t);
  if (si !== lastSection) { lastSection = si; $("section").textContent = si >= 0 ? sectionName(g.sections[si][1], si) : ""; R.setSection(Math.max(0, si)); }
  const left = (g.countdownUntil || 0) - t;
  setHud("cd", left > 0 && left <= 3.2 ? Math.ceil(left) : "", (v) => ($("countdown").textContent = v));
  // timers: after a pause (until the notes come back) and in long stretches without notes.
  // Both disappear before the next notes reach the top of the highway so they never cover them.
  let until = null, from = 0, label = false;
  if (g.resumeAt != null && t < g.resumeAt) { until = g.resumeAt; from = g.resumeFromT; }
  else { const gap = g.gapAt(t); if (gap && t >= gap[0] + 1) { until = gap[1]; from = gap[0]; label = true; } }
  const showT = until != null && until - t > g.look + 0.4 && left <= 0;
  setHud("gap", showT ? Math.ceil(until - t) + (label ? "g" : "r") : "", (v) => {
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
let prev = performance.now(), lastNet = 0;
const en = { e: 0.55, p: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  const g = app.game;
  if (g && app.rewinding) {
    const rw = app.rewinding, k = Math.min(1, (now - rw.start) / rw.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
    const t = rw.from + (rw.to - rw.from) * e;
    energyAt(app.energy, t - g.offset + g.songOffset, en);
    R.render({ t, look: g.look, notes: g.notes, from: 0, pressed: g.pressed, beats: visibleBeats(g.beats, t, g.look), dt, star: g.starOn, energy: en.e, punch: en.p });
    if (k >= 1 && !rw.done) {
      rw.done = true;
      g.player.resume().then(() => { g.resumeFrom(rw.to); app.rewinding = null; app.paused = false; });
    }
    return;
  }
  if (g) {
    const t = g.time();
    if (!app.paused && !app.failing) g.update(t);
    for (const ev of g.events) {
      if (ev.type === "hit") {
        R.hit(ev.lane, ev.sustain);
        if (Math.abs(ev.err) <= 0.045) judge("Perfecto", "#f5c518");
        if (g.combo > 0 && g.combo % 50 === 0) { streak(`¡Racha de ${g.combo}!`); if (g.combo % 100 === 0) R.pyro(); }
      }
      else if (ev.type === "hold") R.holdSpark(ev.lane);
      else if (ev.type === "miss" || ev.type === "ghost") judge("Fallo", "#ff2a22");
      else if (ev.type === "starPhrase") {
        R.starPhrase(); sfx.starChime();
        app.starShown = false; starComet(ev.lane);
        if (ev.ready && !app.starWasReady) { app.starWasReady = true; setTimeout(() => app.game === g && !g.starOn && sfx.starReady(), 640); tip.at = now + 2600; }
        else if (ev.ready && !g.starOn && $("spTip").hidden) tip.at = now + 1400;
      }
      else if (ev.type === "starOn") { const el = $("starPop"); el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); sfx.starOn(); hideStarTip(); app.starWasReady = false; }
      else if (ev.type === "fail") failSong();
    }
    g.events.length = 0;
    // practice: when the part is over, rewind to its start and play it again
    if (app.practice && !app.paused && !app.rewinding && t > app.practice.loopAt) {
      app.paused = true; g.player.pause(); g.restartPractice();
      app.rewinding = { from: t, to: Math.max(0, app.practice.from - 3), start: now, dur: 1100 };
    }
    if (NEW_TEXTS) {
      if (tip.at && now >= tip.at && !g.starOn && g.starMeter >= STAR_READY && !app.paused) { tip.at = 0; tip.hideAt = now + 5500; $("spTipHow").textContent = starTipHow(); $("spTip").hidden = false; }
      if (tip.hideAt && (now >= tip.hideAt || g.starOn || app.paused)) { tip.hideAt = 0; $("spTip").hidden = true; }
    }
    R.setHype(Math.min(1, 0.15 + g.rock * 0.65 + Math.min(0.2, g.combo / 250)));
    energyAt(app.energy, t - g.offset + g.songOffset, en);
    R.render({ t, look: g.look, notes: g.notes, from: g.next, pressed: g.pressed, beats: visibleBeats(g.beats, t, g.look), dt, star: g.starOn,
      starReady: g.starMeter >= STAR_READY && !g.starOn && app.starShown, energy: en.e, punch: en.p });
    updateHUD(g, t);
    if (app.mode === "mp" && app.room && now - lastNet > 300) {
      lastNet = now;
      app.room.send("score", { name: app.me.name, score: Math.round(g.score), combo: g.combo, acc: g.accuracy, hits: g.hits });
      app.rivals[app.me.id] = { name: app.me.name, score: Math.round(g.score), combo: g.combo, acc: g.accuracy, me: true };
      renderRivals();
    }
    if (g.ended) finishGame();
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
document.querySelectorAll("#qualitySeg button").forEach((b) => (b.onclick = () => { settings.gfx = b.dataset.v; save(); R.setQualityLevel(settings.gfx); renderSettings(); }));
document.querySelectorAll("#missSeg button").forEach((b) => (b.onclick = () => { settings.missSfx = b.dataset.v === "on"; save(); renderSettings(); }));
document.querySelectorAll("#syncSeg button").forEach((b) => (b.onclick = () => { settings.autoSync = b.dataset.v === "on"; save(); if (app.game) app.game.autoSync = settings.autoSync; renderSettings(); }));
$("speed").oninput = (e) => { settings.speed = +e.target.value; save(); renderSettings(); };
$("offset").oninput = (e) => { settings.offsetMs = +e.target.value; save(); renderSettings(); };
R.setQualityLevel(settings.gfx);

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
  if (!app.songs.length) listSongs().then((s) => { app.songs = s; renderLobby(); }).catch(() => {});
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
  const song = app.songs.find((s) => s.id === cfg.songId) || (await listSongs().then((s) => (app.songs = s)).then((s) => s.find((x) => x.id === cfg.songId)));
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
  const song = cfg && app.songs.find((s) => s.id === cfg.songId);
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
$("openAdmin").onclick = () => { if (app.game) return; show("admin"); };
if (location.hash === "#admin") setTimeout(() => show("admin"), 0);

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
  let ok = 0, bad = 0;
  for (const s of adm.songs) {
    if (!s.on || s.cls === "ok" || s.cls === "warn") continue;
    const set = (status, p, cls) => { s.status = status; s.p = p; if (cls) s.cls = cls; renderAdmin(); };
    try {
      const conv = await (s.kind === "mp3" ? convertMp3Song : convertSong)(s, (txt, p) => set(txt, p * 0.85));
      await uploadSong(code, conv, (p) => set("Subiendo", 0.85 + p * 0.15));
      if (conv.warnMs) set(`Subida, pero revisa: las notas podrían ir desfasadas (unos ${conv.warnMs} ms)`, 1, "warn");
      else set("Lista", 1, "ok");
      ok++;
    } catch (e) { set(e.message || "Error", 0, "bad"); bad++; }
  }
  adm.busy = false; renderAdmin();
  app.songs = []; app.loadedSongId = null; // reload the library (and any re-uploaded song) next time
  $("adminStatus").textContent = `Listo: ${ok} subida${ok === 1 ? "" : "s"}${bad ? `, ${bad} con error` : ""}. Ya aparecen en Jugar.`;
};
