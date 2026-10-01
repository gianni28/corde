import "@fontsource/new-rocker/latin-400.css";
import "@fontsource/oswald/latin-500.css";
import "@fontsource/oswald/latin-600.css";
import "@fontsource/oswald/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import { createRenderer, LANE_HEX } from "./renderer.js";
import { DIFFS, midiToChart, chartTextToChart, parseIni, iniMeta, notesFor } from "./chart.js";
import { decodeStems, Player, audioCtx } from "./audio.js";
import { Game } from "./game.js";
import { settings, save, resetKeys, deviceLanes, isTouchDevice, keyLabel } from "./settings.js";
import { online, listSongs, downloadSong, fileUrl, joinRoom, newRoomCode } from "./net.js";

const $ = (id) => document.getElementById(id);
const LANE_CSS = ["--g", "--r", "--y", "--b", "--o"];
const touch = isTouchDevice();

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

/* ================= app state ================= */
const app = {
  screen: "home", history: [], mode: "solo",
  songs: [], song: null, chart: null, decoded: null, diff: null,
  game: null, paused: false,
  room: null, me: null, peers: [], rivals: {}, finals: {}, roomConfig: null, loadedSongId: null,
};

/* ================= navigation ================= */
const SCREENS = ["home", "library", "setup", "settings", "mp", "lobby", "pause", "results", "loading"];
function show(name, push = true) {
  const transient = ["pause", "loading", "play", "results"];
  if (push && !transient.includes(name)) {
    const from = transient.includes(app.screen) ? app.stable : app.screen;
    if (from && from !== name) app.history.push(from);
  }
  if (!transient.includes(name)) app.stable = name;
  app.screen = name;
  SCREENS.forEach((s) => ($("s-" + s).hidden = s !== name));
  $("hud").hidden = !(name === "pause" || (app.game && name === "play"));
  if (name === "play") $("hud").hidden = false;
}
function back() {
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

let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
function loading(label, p) { $("loadLabel").textContent = label; $("loadBar").style.width = Math.round((p || 0) * 100) + "%"; }

/* ================= home ================= */
$("homeFoot").textContent = online ? "Biblioteca en línea" : "Modo local · conecta Supabase para la biblioteca y el multijugador";

/* ================= library ================= */
const fmtLen = (ms) => { if (!ms) return ""; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const coverOf = (s) => (s.has_cover ? fileUrl(s.id, "cover.jpg") : "");

async function openLibrary() {
  $("libTitle").textContent = app.mode === "pick" ? "Elige la canción" : "Canciones";
  $("localBox").hidden = app.mode === "pick";
  $("localFolderBtn").hidden = touch;
  show("library");
  renderSongs();
  if (online && !app.songs.length) {
    $("songList").innerHTML = `<p class="empty">Cargando biblioteca…</p>`;
    try { app.songs = await listSongs(); renderSongs(); }
    catch (e) { $("songList").innerHTML = `<p class="empty">${e.message}</p>`; }
  }
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
    const meta = ini ? iniMeta(parseIni(await ini.text())) : {};
    const chart = mid ? midiToChart(await mid.arrayBuffer(), meta) : chartTextToChart(await cht.text(), meta);
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
  const draw = () => renderDiffChips($("setupDiffs"), app.chart, lanes, app.diff, (k) => { app.diff = k; settings.lastDiff = k; save(); draw(); });
  draw();
  const keys = settings.keys.slice(0, lanes).map(keyLabel).join(" ");
  $("setupHint").textContent = touch
    ? `Juegas con ${lanes} cuerdas. Toca la columna de cada color cuando la nota llegue a los botones y mantén el dedo en las notas largas.`
    : `Juegas con ${lanes} cuerdas: ${keys}. Presiona cuando la nota llegue a los botones y mantén en las largas. Esc para pausar.`;
  show("setup");
}
$("playBtn").onclick = () => startGame({ lanes: deviceLanes(), diff: app.diff });

/* ================= gameplay ================= */
function startGame({ lanes, diff }) {
  stopGame();
  const player = new Player(app.decoded);
  app.game = new Game({ chart: app.chart, diff, lanes, player, offsetMs: settings.offsetMs, look: +settings.speed });
  app.lanes = lanes;
  app.diff = diff;
  R.setLanes(lanes);
  app.paused = false;
  app.finals = {}; app.rivals = {};
  lastSection = -2;
  $("rivals").hidden = app.mode !== "mp";
  show("play");
  app.game.start();
  try { navigator.wakeLock?.request("screen").then((l) => (app.wake = l)).catch(() => {}); } catch {}
}
function stopGame() {
  if (!app.game) return;
  app.game.player.stop();
  app.game = null;
  try { app.wake?.release(); } catch {}
}
function pauseGame() {
  if (!app.game || app.paused || app.game.ended) return;
  if (app.mode === "mp") return toast("En multijugador no se puede pausar.");
  app.paused = true; app.game.player.pause(); show("pause");
}
function resumeGame() {
  if (!app.game || !app.paused) return;
  app.game.pressed.fill(false);
  app.game.player.resume().then(() => { app.paused = false; });
  show("play", false);
}
$("pauseBtn").onclick = pauseGame;
$("resumeBtn").onclick = resumeGame;
$("restartBtn").onclick = () => startGame({ lanes: app.lanes, diff: app.diff });
$("quitBtn").onclick = () => { stopGame(); R.setLanes(5); show("setup", false); };
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

function finishGame() {
  const g = app.game; if (!g) return;
  const sum = g.summary();
  g.player.stop();
  app.lastSummary = sum;
  $("resSong").textContent = `${app.song.name} · ${DIFFS.find((d) => d.key === app.diff).name} · ${app.lanes} cuerdas`;
  $("resScore").textContent = sum.score.toLocaleString("es-CO");
  $("resStars").innerHTML = "★".repeat(sum.stars) + `<span class="off">${"★".repeat(5 - sum.stars)}</span>`;
  $("resHit").textContent = `${sum.hits}/${sum.total}`;
  $("resAcc").textContent = Math.round(sum.acc * 100) + "%";
  $("resCombo").textContent = sum.maxCombo;
  $("againBtn").hidden = app.mode === "mp";
  $("menuBtn").textContent = app.mode === "mp" ? "Volver a la sala" : "Menú";
  if (app.mode === "mp") { app.room.send("final", { name: app.me.name, ...sum }); app.finals[app.me.id] = { name: app.me.name, ...sum }; }
  renderRanking();
  app.game = null;
  R.setLanes(5);
  show("results");
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
  if (k === "escape") { e.preventDefault(); app.paused ? resumeGame() : pauseGame(); return; }
  if (e.repeat || app.paused) return;
  const lane = laneForKey(k);
  if (lane >= 0) { e.preventDefault(); app.game.press(lane, evTime(e)); }
});
addEventListener("keyup", (e) => { const lane = laneForKey(e.key.toLowerCase()); if (lane >= 0 && app.game) app.game.release(lane); });

const pointerLane = new Map();
canvas.addEventListener("pointerdown", (e) => {
  if (!app.game || app.paused) return;
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
function updateHUD(g, t) {
  $("score").textContent = Math.round(g.score).toLocaleString("es-CO");
  $("combo").textContent = g.combo;
  const m = g.multiplier;
  $("multText").textContent = "×" + m;
  $("mult").className = "mult x" + m;
  const fill = m >= 4 ? 10 : g.combo % 10;
  const col = ["#f2e8d8", "#f5c518", "#1fd14a", "#ff7a1a"][m - 1];
  ringSegs.forEach((s, i) => s.setAttribute("stroke", i < fill ? col : "rgba(255,255,255,.1)"));
  $("progress").style.width = Math.max(0, Math.min(100, (t / g.end) * 100)) + "%";
  const si = g.section(t);
  if (si !== lastSection) { lastSection = si; $("section").textContent = si >= 0 ? g.sections[si][1] : ""; R.setSection(Math.max(0, si)); }
  const cd = $("countdown");
  cd.textContent = t < 0 && t > -3.2 ? Math.ceil(-t) : "";
}

/* ================= main loop ================= */
let prev = performance.now(), lastNet = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  const g = app.game;
  if (g) {
    const t = g.time();
    if (!app.paused) g.update(t);
    for (const ev of g.events) {
      if (ev.type === "hit") {
        R.hit(ev.lane, ev.sustain);
        judge(Math.abs(ev.err) <= 0.045 ? "Perfecto" : ev.err < 0 ? "Temprano" : "Tarde", Math.abs(ev.err) <= 0.045 ? "#f5c518" : "#f2e8d8");
        if (g.combo > 0 && g.combo % 50 === 0) { streak(`¡Racha de ${g.combo}!`); if (g.combo % 100 === 0) R.pyro(); }
      }
      else if (ev.type === "hold") R.holdSpark(ev.lane);
      else if (ev.type === "miss" || ev.type === "ghost") judge("Fallo", "#ff2a22");
    }
    g.events.length = 0;
    R.render({ t, look: g.look, notes: g.notes, from: g.next, pressed: g.pressed, beats: g.beats.filter((b) => b[0] > t - 0.5 && b[0] < t + g.look), dt });
    updateHUD(g, t);
    if (app.mode === "mp" && app.room && now - lastNet > 300) {
      lastNet = now;
      app.room.send("score", { name: app.me.name, score: Math.round(g.score), combo: g.combo, acc: g.accuracy, hits: g.hits });
      app.rivals[app.me.id] = { name: app.me.name, score: Math.round(g.score), combo: g.combo, acc: g.accuracy, me: true };
      renderRivals();
    }
    if (g.ended) finishGame();
  } else {
    // attract mode behind the menus
    const t = now / 1000 % (demo.notes[demo.notes.length - 1].t - 2);
    if (demoNext > 0 && demo.notes[demoNext - 1].t > t) { demoNext = 0; demo.notes.forEach((n) => (n.state = 0)); }
    const pressed = [false, false, false, false, false];
    while (demoNext < demo.notes.length && demo.notes[demoNext].t <= t) {
      const n = demo.notes[demoNext++]; n.state = 1; R.hit(n.lane, false);
    }
    demo.notes.forEach((n, i) => { if (i < demoNext && n.dur && t < n.t + n.dur) { n.holding = true; pressed[n.lane] = true; } else n.holding = false; });
    const from = Math.max(0, demoNext - 8);
    R.render({ t, look: 1.6, notes: demo.notes, from, pressed, beats: demo.beats.filter((b) => b[0] > t - 0.5 && b[0] < t + 1.6), dt });
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
  document.querySelectorAll("#laneSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === settings.laneMode));
  document.querySelectorAll("#qualitySeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === settings.quality));
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
document.querySelectorAll("#qualitySeg button").forEach((b) => (b.onclick = () => { settings.quality = b.dataset.v; save(); R.setQualityLevel(settings.quality); renderSettings(); }));
$("speed").oninput = (e) => { settings.speed = +e.target.value; save(); renderSettings(); };
$("offset").oninput = (e) => { settings.offsetMs = +e.target.value; save(); renderSettings(); };
R.setQualityLevel(settings.quality);

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
window.__corde = { app, R };
