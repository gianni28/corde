// Corde — 3D renderer. Look: mid-2000s rock club stage (brick wall, amp walls, drum riser,
// tungsten PAR cans, haze, pyro) behind a Guitar-Hero-style rosewood highway. setStage() re-tints the same
// rig for the tour venues, from a friend's garage to a stadium (see STAGES); setSkin() puts on the looks the
// player bought in the shop (necks, notes, flames, strings, star power, crowd: see skins.js).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createCrowd, createBand } from "./stagecrew.js";
import { LANE_HEX, NECKS, GEMS, FLAMES, STRINGS, STARS, CROWDS, PETS, MEMBERS, resolveSkin, grime } from "./skins.js";

export { LANE_HEX };
const HL = 24; // highway length (world units)
const LW = 1.0; // lane width
const MAX_GEMS = 260;
const isMobile = matchMedia("(pointer:coarse)").matches;
const rnd = (a, b) => a + Math.random() * (b - a);

/* ================= procedural textures ================= */
function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function brickTex() {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = "#1a0f0b"; g.fillRect(0, 0, w, h);
    const bw = 64, bh = 26;
    for (let r = 0; r * bh < h; r++) for (let c = -1; c * bw < w; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
      const l = rnd(14, 30);
      g.fillStyle = `hsl(${rnd(8, 18)}, ${rnd(35, 55)}%, ${l}%)`;
      g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      g.fillStyle = `rgba(0,0,0,${rnd(0, 0.35)})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      g.fillStyle = "rgba(255,200,160,.05)"; g.fillRect(x + 2, y + 2, bw - 4, 3);
    }
    grime(g, w, h, 160, 0.35);
    // old posters (blank, torn paper — no text)
    for (let i = 0; i < 5; i++) {
      const x = rnd(40, w - 160), y = rnd(40, h - 200), pw = rnd(90, 130), ph = pw * 1.4;
      g.save(); g.translate(x, y); g.rotate(rnd(-0.08, 0.08));
      g.fillStyle = `hsl(${[0, 30, 45, 0, 20][i]}, ${rnd(20, 60)}%, ${rnd(18, 32)}%)`; g.fillRect(0, 0, pw, ph);
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(pw * 0.12, ph * 0.1, pw * 0.76, ph * 0.5);
      g.fillStyle = "rgba(240,220,190,.18)"; g.fillRect(pw * 0.12, ph * 0.66, pw * 0.76, 8); g.fillRect(pw * 0.12, ph * 0.74, pw * 0.5, 6);
      g.restore();
    }
    grime(g, w, h, 80, 0.45);
  }, { repeat: true });
}

// [boards, slabs]: slabs is the same canvas before the tape goes on, for floors that stretch it (no extra random draws)
function planksTex() {
  let slabs;
  const boards = canvasTex(512, 512, (g, w, h) => {
    const pw = 64;
    for (let x = 0; x < w; x += pw) {
      g.fillStyle = `hsl(25, 30%, ${rnd(8, 13)}%)`; g.fillRect(x, 0, pw, h);
      for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(0,0,0,${rnd(0.05, 0.2)})`; g.lineWidth = rnd(0.5, 2); const xx = x + rnd(2, pw - 2); g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx + rnd(-3, 3), h); g.stroke(); }
      g.fillStyle = "#050302"; g.fillRect(x, 0, 2, h);
    }
    grime(g, w, h, 50, 0.3);
    slabs = canvasTex(w, h, (s) => s.drawImage(g.canvas, 0, 0), { repeat: true });
    g.fillStyle = "rgba(200,200,190,.12)"; g.fillRect(rnd(0, w - 120), rnd(0, h), 120, 14); // gaffer tape
  }, { repeat: true });
  return [boards, slabs];
}

function grilleTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#0d0c0c"; g.fillRect(0, 0, w, h);
    // basket-weave grille cloth
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      g.fillStyle = (x + y) % 8 === 0 ? "#2a2722" : "#1a1815"; g.fillRect(x, y, 3, 3);
    }
    g.fillStyle = "rgba(220,200,150,.06)"; for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1);
    // silver piping + tolex frame
    g.strokeStyle = "#0a0a0a"; g.lineWidth = 22; g.strokeRect(0, 0, w, h);
    g.strokeStyle = "#8f8a80"; g.lineWidth = 3; g.strokeRect(12, 12, w - 24, h - 24);
    grime(g, w, h, 20, 0.25);
  });
}
function tolexTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "#0e0d0d"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0, 0.04)})`; g.fillRect(rnd(0, w), rnd(0, h), 1, 1); }
  }, { repeat: true });
}

function softDotTex() {
  return canvasTex(64, 64, (g) => {
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.25, "rgba(255,255,255,.55)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  });
}

function smokeTex() {
  return canvasTex(256, 256, (g) => {
    for (let i = 0; i < 40; i++) {
      const x = 128 + rnd(-60, 60), y = 128 + rnd(-40, 40), r = rnd(30, 80);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(255,255,255,.10)"); rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    }
  });
}

// Fire flipbook: a few frames of licking flames, drawn as stacked additive blobs.
const FIRE = [[255, 250, 220], [255, 190, 60], [255, 110, 20], [200, 40, 10]];
const BLUE_FIRE = [[240, 252, 255], [150, 225, 255], [50, 150, 255], [20, 60, 210]];
function fireFrames(n = 6, pal = FIRE) {
  const frames = [];
  for (let f = 0; f < n; f++) {
    frames.push(canvasTex(128, 256, (g, w, h) => {
      g.globalCompositeOperation = "lighter";
      const tongues = 7;
      for (let k = 0; k < tongues; k++) {
        const bx = w / 2 + rnd(-22, 22), top = rnd(20, 110) + (k === 0 ? -10 : 0);
        for (let s = 0; s < 22; s++) {
          const p = s / 21; // 0 bottom → 1 tip
          const y = h - 16 - p * (h - 16 - top);
          const x = bx + Math.sin(p * 5 + f * 1.3 + k) * 10 * p;
          const r = (1 - p) * 30 + 6;
          const heat = 1 - p;
          const col = heat > 0.75 ? pal[0] : heat > 0.45 ? pal[1] : heat > 0.2 ? pal[2] : pal[3];
          const rg = g.createRadialGradient(x, y, 0, x, y, r);
          rg.addColorStop(0, `rgba(${col},${0.22 + heat * 0.2})`); rg.addColorStop(1, `rgba(${col},0)`);
          g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    }));
  }
  return frames;
}

// The notes shaped like something (tamarins, kittens, scarabs, watches) lean toward the player by SIT, raised so their
// lower edge stays on the neck (SIT_LIFT: against the 0.95 they were first built at): flat they'd be seen edge-on, upright
// they stood tall and hid the notes behind them and looked hit-ready too early; halfway, they read and stay low.
const SIT = 0.5, SIT_LIFT = Math.sin(SIT) / Math.sin(0.95);

// Hit flames that aren't a fire of another colour: each its own picture (flipbook frames) and its own sparks.
// campfire/embers are drawn in their colours; the rest are white, tinted per skin (FLAMES' tint).
// look: sprite size [w, h], growth over its life [gx, gy], life (s), anchor (sprite center y);
// spark: sideways speed, upward speed range, gravity (below 0: they float up), life range, how many (× today's), star-shaped.
const FLAME_FORMS = {
  fire: { look: [0.95, 1.5, 0.25, 0.9, 0.32, 0.04], spark: { vx: 1.8, vy: [2, 5.5], g: 9.5, life: [0.35, 0.7], n: 1 } },
  campfire: { look: [1.35, 1.95, 0.2, 0.7, 0.42, 0.04], spark: { vx: 0.8, vy: [1.4, 3.4], g: -1.4, life: [0.9, 1.6], n: 1.4 } },
  embers: { look: [1.3, 0.75, 0.12, 0.18, 0.62, 0.1], spark: { vx: 1.3, vy: [2.6, 4.6], g: 12, life: [0.7, 1.1], n: 0.75 } },
  nova: { look: [0.6, 0.6, 2.4, 2.4, 0.32, 0.5], spark: { radial: 5.5, g: 0, life: [0.22, 0.4], n: 1.6 } },
  bolt: { look: [0.85, 2.2, 0.1, 0.25, 0.22, 0.03], spark: { vx: 4.5, vy: [0.4, 4], g: 0, life: [0.07, 0.17], n: 1.2 } },
  curtain: { look: [1.1, 2.0, 0.2, 0.5, 0.55, 0.03], spark: { vx: 0.5, vy: [0.6, 1.5], g: -0.6, life: [0.9, 1.5], n: 0.8 } },
  stars: { look: [1.15, 1.6, 0.5, 0.8, 0.45, 0.06], spark: { vx: 1.5, vy: [2.6, 5], g: 5, life: [0.6, 1], n: 0.9, star: true } },
  bubbles: { look: [1.0, 1.7, 0.15, 0.6, 0.5, 0.04], spark: { vx: 0.6, vy: [1, 2.2], g: -0.4, life: [0.6, 1.1], n: 0.7 } },
  // antimagic: black flames (blend: drawn over, not added as light: black adds nothing) with red cracks
  antimagic: { look: [1.15, 1.9, 0.2, 0.7, 0.4, 0.04], blend: "normal", spark: { vx: 2.2, vy: [1.2, 4], g: 3, life: [0.25, 0.5], n: 1.2 } },
  // pyramid (the Iron Maiden event, Powerslave): a stepped pyramid of golden fire, glyphs burning on its face
  pyramid: { look: [1.25, 1.6, 0.2, 0.55, 0.42, 0.04], spark: { vx: 1.2, vy: [2.2, 4.6], g: 4, life: [0.5, 0.9], n: 1 } },
  // frost (the Iron Maiden event, Seventh Son): shards of ice bursting up round a burning heart; ice dust falling
  frost: { look: [1.3, 1.7, 0.15, 0.45, 0.42, 0.04], spark: { vx: 2.2, vy: [1.5, 4.2], g: 7, life: [0.4, 0.8], n: 1.1, star: true } },
};
function flameFrames(form, n = 6) {
  const out = [];
  const glowDot = (g, x, y, r, col, a) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(${col},${a})`); rg.addColorStop(1, `rgba(${col},0)`); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); };
  for (let f = 0; f < n; f++) {
    if (form === "campfire") {
      // a campfire: many wide tongues, embers flying out of it
      out.push(canvasTex(192, 256, (g, w, h) => {
        g.globalCompositeOperation = "lighter";
        for (let k = 0; k < 12; k++) {
          const bx = w / 2 + rnd(-48, 48), top = rnd(8, 120) + Math.abs(bx - w / 2) * 0.8;
          for (let s = 0; s < 22; s++) {
            const p = s / 21, y = h - 14 - p * (h - 14 - top), x = bx + Math.sin(p * 6 + f * 1.4 + k) * 13 * p - (bx - w / 2) * p * 0.45;
            const heat = 1 - p, col = heat > 0.8 ? FIRE[0] : heat > 0.5 ? FIRE[1] : heat > 0.22 ? FIRE[2] : FIRE[3];
            glowDot(g, x, y, (1 - p) * 26 + 5, col, 0.18 + heat * 0.18);
          }
        }
        for (let k = 0; k < 14; k++) glowDot(g, w / 2 + rnd(-60, 60), rnd(10, h * 0.6), rnd(2, 4), "255,200,90", 1);
      }));
    } else if (form === "embers") {
      // a bed of embers: glowing coals breathing, little flames licking over them
      out.push(canvasTex(192, 128, (g, w, h) => {
        g.globalCompositeOperation = "lighter";
        for (let k = 0; k < 26; k++) {
          const x = w / 2 + rnd(-70, 70) * (0.6 + 0.4 * Math.random()), y = h - rnd(8, 34), r = rnd(8, 18);
          const hot = 0.5 + 0.5 * Math.sin(f * 1.7 + k * 2.3);
          glowDot(g, x, y, r * 1.8, "200,30,5", 0.35);
          glowDot(g, x, y, r, hot > 0.6 ? "255,190,70" : "255,90,20", 0.5 + hot * 0.4);
        }
        for (let k = 0; k < 5; k++) {
          const bx = w / 2 + rnd(-50, 50), top = rnd(40, 80);
          for (let s = 0; s < 12; s++) { const p = s / 11, y = h - 26 - p * (h - 26 - top); glowDot(g, bx + Math.sin(p * 5 + f) * 6 * p, y, (1 - p) * 12 + 3, p < 0.4 ? "255,150,40" : "220,40,10", 0.25); }
        }
      }));
    } else if (form === "nova") {
      // a star blowing up: a white core, rays all around, a shock ring
      out.push(canvasTex(256, 256, (g, w, h) => {
        g.globalCompositeOperation = "lighter";
        const cx = w / 2, cy = h / 2;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + rnd(-0.12, 0.12) + f * 0.05, len = rnd(60, 122) * (k % 2 ? 0.65 : 1);
          const lg = g.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
          lg.addColorStop(0, "rgba(255,255,255,.9)"); lg.addColorStop(1, "rgba(255,255,255,0)");
          g.strokeStyle = lg; g.lineWidth = k % 2 ? 3 : 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
        }
        g.filter = "blur(4px)"; g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 9; g.beginPath(); g.arc(cx, cy, 88 + f * 4, 0, Math.PI * 2); g.stroke(); g.filter = "none";
        glowDot(g, cx, cy, 60, "255,255,255", 0.9); glowDot(g, cx, cy, 22, "255,255,255", 1);
      }));
    } else if (form === "bolt") {
      // electricity: jagged bolts jumping up from the button, branching
      out.push(canvasTex(128, 256, (g, w, h) => {
        g.globalCompositeOperation = "lighter"; g.lineJoin = "round";
        const bolt = (x, y, len, ang, width, depth) => {
          const pts = [[x, y]];
          for (let i = 0; i < 9; i++) { ang += rnd(-0.6, 0.6); x += Math.sin(ang) * len / 9; y -= Math.cos(ang) * len / 9; x = Math.max(6, Math.min(w - 6, x)); pts.push([x, y]); }
          for (const [lw, a] of [[width * 4, 0.18], [width * 2, 0.35], [width, 1]]) {
            g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = lw; g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
          }
          if (depth < 2) for (let b = 0; b < 2; b++) { const [bx, by] = pts[3 + Math.floor(Math.random() * 5)]; bolt(bx, by, len * 0.45, ang + rnd(-1, 1), width * 0.6, depth + 1); }
        };
        for (let k = 0; k < 2; k++) bolt(w / 2 + rnd(-8, 8), h - 8, rnd(170, 230), rnd(-0.3, 0.3), 3, 0);
        glowDot(g, w / 2, h - 10, 34, "255,255,255", 0.8);
      }));
    } else if (form === "curtain") {
      // an aurora: soft curtains of light waving up from the button, brightest at their lower edge
      out.push(canvasTex(192, 256, (g, w, h) => {
        g.globalCompositeOperation = "lighter";
        for (let k = 0; k < 6; k++) {
          const x0 = w / 2 + (k - 2.5) * 18, ph = f * 0.9 + k * 1.7;
          for (let y = h - 8; y > 10; y -= 3) {
            const p = (h - y) / h, x = x0 + Math.sin(p * 7 + ph) * 16 * (0.4 + p), a = (1 - p) * (1 - p) * (0.08 + 0.05 * Math.sin(p * 20 + ph));
            g.fillStyle = `rgba(255,255,255,${Math.max(0, a)})`; g.fillRect(x - 7, y, 14, 3);
          }
          glowDot(g, x0, h - 14, 22, "255,255,255", 0.35);
        }
      }));
    } else if (form === "stars") {
      // perfect: a burst of four-point stars twinkling
      out.push(canvasTex(128, 256, (g, w, h) => {
        g.globalCompositeOperation = "lighter";
        const star = (x, y, r) => {
          glowDot(g, x, y, r * 1.2, "255,255,255", 0.45);
          g.fillStyle = "rgba(255,255,255,.95)"; g.beginPath();
          g.moveTo(x, y - r); g.lineTo(x + r * 0.16, y - r * 0.16); g.lineTo(x + r, y); g.lineTo(x + r * 0.16, y + r * 0.16); g.lineTo(x, y + r); g.lineTo(x - r * 0.16, y + r * 0.16); g.lineTo(x - r, y); g.lineTo(x - r * 0.16, y - r * 0.16); g.fill();
        };
        for (let k = 0; k < 9; k++) { const p = rnd(0, 1); star(w / 2 + rnd(-40, 40) * (1 - p * 0.5), h - 16 - p * (h - 40), rnd(7, 20) * (1 - p * 0.45) * (0.7 + 0.3 * Math.sin(f * 2 + k))); }
        glowDot(g, w / 2, h - 14, 34, "255,255,255", 0.7);
      }));
    } else if (form === "antimagic") {
      // Asta's antimagic: black tongues licking up, a crimson rim, red cracks of light through them
      out.push(canvasTex(128, 256, (g, w, h) => {
        // a red glow behind, so the black reads on any neck
        const tongues = Array.from({ length: 7 }, () => [w / 2 + rnd(-24, 24), rnd(18, 100)]);
        for (const [bx, top] of tongues) for (let s = 0; s < 14; s++) {
          const p = s / 13, y = h - 14 - p * (h - 14 - top), r = (1 - p) * 38 + 10;
          const rg = g.createRadialGradient(bx, y, 0, bx, y, r);
          rg.addColorStop(0, `rgba(230,20,40,${0.2 * (1 - p)})`); rg.addColorStop(1, "rgba(230,20,40,0)");
          g.fillStyle = rg; g.fillRect(bx - r, y - r, r * 2, r * 2);
        }
        // each tongue twice: a crimson rim, then the black inside it
        for (const rim of [true, false]) for (let k = 0; k < 7; k++) {
          const [bx, top] = tongues[k];
          for (let s = 0; s < 40; s++) {
            const p = s / 39, y = h - 14 - p * (h - 14 - top), x = bx + Math.sin(p * 6 + f * 1.4 + k) * 11 * p, r = (1 - p) * 22 + 4 + (rim ? 4 : 0);
            g.fillStyle = rim ? `rgba(210,16,36,${0.3 * (1 - p * 0.6)})` : `rgba(6,2,4,${0.55 - p * 0.2})`;
            g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          }
        }
        g.globalCompositeOperation = "source-atop"; // the cracks only over the flames
        g.lineJoin = "round";
        for (let k = 0; k < 3; k++) {
          let x = w / 2 + rnd(-20, 20), y = h - 16;
          g.beginPath(); g.moveTo(x, y);
          for (let i = 0; i < 7; i++) { x += rnd(-12, 12); y -= rnd(12, 30); g.lineTo(x, y); }
          for (const [lw, c] of [[4, "rgba(255,40,50,.3)"], [1.5, "rgba(255,80,80,.9)"]]) { g.strokeStyle = c; g.lineWidth = lw; g.stroke(); }
        }
      }));
    } else if (form === "pyramid") {
      // a stepped pyramid of fire, white-gold at the foot, burning up to its point; on its face, glyphs of light (an eye,
      // an ankh, a scarab's sun) that flicker frame to frame
      out.push(canvasTex(128, 256, (g, w, h) => {
        const base = h - 14, top = 70 + rnd(-6, 6), half = 54;
        const glow = g.createRadialGradient(w / 2, base - 40, 0, w / 2, base - 40, 90);
        glow.addColorStop(0, "rgba(255,170,40,.45)"); glow.addColorStop(1, "rgba(255,120,20,0)");
        g.fillStyle = glow; g.fillRect(0, 0, w, h);
        // the steps: five courses, each a little narrower, licked by flame at their edges
        const steps = 5;
        for (let k = 0; k < steps; k++) {
          const y0 = base - (k / steps) * (base - top), y1 = base - ((k + 1) / steps) * (base - top);
          const hw0 = half * (1 - k / steps), hw1 = half * (1 - (k + 1) / steps);
          const lg = g.createLinearGradient(0, y0, 0, y1);
          lg.addColorStop(0, `rgba(255,${235 - k * 18},${150 - k * 25},${0.95 - k * 0.08})`); lg.addColorStop(1, `rgba(255,${150 - k * 15},30,${0.75 - k * 0.1})`);
          g.fillStyle = lg;
          g.beginPath(); g.moveTo(w / 2 - hw0, y0); g.lineTo(w / 2 - hw0 + rnd(0, 3), y1); g.lineTo(w / 2 + hw0 - rnd(0, 3), y1); g.lineTo(w / 2 + hw0, y0); g.closePath(); g.fill();
          g.fillStyle = `rgba(255,${200 - k * 20},80,.5)`; // a flame tongue off each step's corners
          for (const sx of [-1, 1]) { const x = w / 2 + sx * hw1; g.beginPath(); g.moveTo(x - 5, y1); g.quadraticCurveTo(x + sx * rnd(2, 8), y1 - rnd(10, 22), x + 5, y1); g.fill(); }
        }
        // the point: a flame going up out of it
        for (let k = 0; k < 18; k++) { const p = k / 17, y = top - p * 50, r = (1 - p) * 10 + 2; g.fillStyle = `rgba(255,${220 - p * 120},${120 - p * 100},${0.5 * (1 - p)})`; g.beginPath(); g.arc(w / 2 + Math.sin(p * 5 + f) * 4 * p, y, r, 0, 6.3); g.fill(); }
        // the glyphs, dark lines with a hot core, some lit some not this frame
        g.lineCap = "round"; g.lineJoin = "round";
        const glyph = (draw) => { for (const [lw, c] of [[5, "rgba(120,30,0,.55)"], [2, rnd(0, 1) < 0.75 ? "rgba(255,255,220,.95)" : "rgba(255,200,120,.4)"]]) { g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); draw(); g.stroke(); } };
        const cy = base - 46;
        glyph(() => { g.ellipse(w / 2, cy, 13, 7, 0, 0, 6.3); g.moveTo(w / 2 + 3, cy); g.arc(w / 2, cy, 3, 0, 6.3); g.moveTo(w / 2 - 6, cy + 7); g.lineTo(w / 2 - 10, cy + 16); }); // the eye
        glyph(() => { g.moveTo(w / 2 - 26, base - 10); g.lineTo(w / 2 - 26, base - 26); g.moveTo(w / 2 - 33, base - 22); g.lineTo(w / 2 - 19, base - 22); g.moveTo(w / 2 - 26, base - 26); g.arc(w / 2 - 26, base - 31, 5, Math.PI / 2, Math.PI * 2.5); }); // ankh
        glyph(() => { g.arc(w / 2 + 26, base - 22, 6, 0, 6.3); g.moveTo(w / 2 + 16, base - 12); g.lineTo(w / 2 + 36, base - 12); }); // the sun
      }));

    } else if (form === "frost") {
      // Seventh Son of a Seventh Son: a crown of ice shards bursting up and out, white at their edges and blue in their
      // depths, and in their midst the burning heart Eddie holds up on the cover, its fire licking up between them
      out.push(canvasTex(160, 256, (g, w, h) => {
        const base = h - 12, cx = w / 2;
        const glow = g.createRadialGradient(cx, base - 30, 0, cx, base - 30, 70);
        glow.addColorStop(0, "rgba(255,90,30,.55)"); glow.addColorStop(1, "rgba(255,40,10,0)");
        g.fillStyle = glow; g.fillRect(0, 0, w, h);
        // the shards: long thin blades, the middle ones tallest, fanning out
        const shards = [[-0.62, 0.5], [-0.38, 0.72], [-0.16, 0.95], [0.05, 1], [0.24, 0.85], [0.45, 0.66], [0.66, 0.46]];
        for (const [a0, len0] of shards) {
          const a = a0 + rnd(-0.05, 0.05), len = (h - 40) * len0 * rnd(0.9, 1.05), bw = rnd(9, 14);
          const tx = cx + Math.sin(a) * len, ty = base - Math.cos(a) * len, px = Math.cos(a) * bw, py = Math.sin(a) * bw;
          const lg = g.createLinearGradient(cx, base, tx, ty);
          lg.addColorStop(0, "rgba(60,130,255,.85)"); lg.addColorStop(0.6, "rgba(150,210,255,.75)"); lg.addColorStop(1, "rgba(240,250,255,.95)");
          g.fillStyle = lg;
          g.beginPath(); g.moveTo(cx - px, base + py * 0.3); g.lineTo(tx, ty); g.lineTo(cx + px, base - py * 0.3); g.closePath(); g.fill();
          g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx - px * 0.2, base); g.lineTo(tx, ty); g.stroke(); // the bright edge
        }
        // the heart's fire, up between the shards
        for (let k = 0; k < 16; k++) { const p = k / 15, y = base - 18 - p * 70, r = (1 - p) * 16 + 3; g.fillStyle = `rgba(255,${200 - p * 150},${80 - p * 70},${0.55 * (1 - p)})`; g.beginPath(); g.arc(cx + Math.sin(p * 6 + f * 1.3) * 7 * p, y, r, 0, 6.3); g.fill(); }
        // the heart: dark red, glowing at its core
        const hy = base - 22, hr = 13;
        g.fillStyle = "rgba(170,10,10,.95)";
        g.beginPath(); g.moveTo(cx, hy + hr); g.bezierCurveTo(cx - hr * 1.5, hy, cx - hr * 0.9, hy - hr * 1.1, cx, hy - hr * 0.4); g.bezierCurveTo(cx + hr * 0.9, hy - hr * 1.1, cx + hr * 1.5, hy, cx, hy + hr); g.fill();
        const core = g.createRadialGradient(cx, hy - 2, 0, cx, hy - 2, hr);
        core.addColorStop(0, `rgba(255,${210 + rnd(0, 40)},120,.95)`); core.addColorStop(1, "rgba(255,60,20,0)");
        g.fillStyle = core; g.fillRect(cx - hr, hy - hr * 1.2, hr * 2, hr * 2.2);
        for (let k = 0; k < 14; k++) glowDot(g, cx + rnd(-60, 60), rnd(20, base - 20), rnd(1.5, 3), "220,240,255", 0.9); // frost glittering
      }));
    } else {
      // bubbles: rings with a shine, boiling up
      out.push(canvasTex(128, 256, (g, w, h) => {
        for (let k = 0; k < 14; k++) {
          const p = rnd(0, 1), r = rnd(6, 17) * (1 - p * 0.4), x = w / 2 + rnd(-38, 38) * (0.5 + p * 0.5), y = h - 14 - p * (h - 40) - f * 6;
          g.strokeStyle = `rgba(255,255,255,${0.9 - p * 0.5})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
          g.fillStyle = `rgba(255,255,255,${0.18 - p * 0.1})`; g.fill();
          g.fillStyle = "rgba(255,255,255,.95)"; g.beginPath(); g.arc(x - r * 0.4, y - r * 0.4, r * 0.22, 0, Math.PI * 2); g.fill();
        }
        g.globalCompositeOperation = "lighter"; glowDot(g, w / 2, h - 14, 36, "255,255,255", 0.6);
      }));
    }
  }
  return out;
}
// what chrome reflects: an equirectangular studio, soft boxes and stage lights above, the warm stage below
function studioTex() {
  const t = canvasTex(512, 256, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#2a2c34"); bg.addColorStop(0.45, "#0c0d12"); bg.addColorStop(0.55, "#3a1c0c"); bg.addColorStop(1, "#140804");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff"; for (let k = 0; k < 4; k++) g.fillRect(k * 128 + 20, 30, 70, 26); // soft boxes
    g.fillStyle = "rgba(255,230,200,.85)"; g.fillRect(0, 100, w, 6); // a bright horizon
    for (let k = 0; k < 8; k++) { const rg = g.createRadialGradient(k * 64 + 32, 78, 0, k * 64 + 32, 78, 16); rg.addColorStop(0, "#fff6e0"); rg.addColorStop(1, "rgba(255,180,90,0)"); g.fillStyle = rg; g.fillRect(k * 64, 60, 64, 40); }
  });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
// Nero, the anti-bird (the Otaku event's pet), in 3D: a round navy bird with a white feathered chest, a maroon mask
// over heavy-lidded eyes, a small black beak, one curl of a feather on top, a forked tail and wings that flap. Built
// facing +z with its feet at 0, about 1 tall. pose(): lids 0 open … 1 shut, wings 0 folded … 1 up, feet, sleep (z's).
function makeNero() {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  const mat = (color, roughness, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...o });
  const NAVY = mat(0x26306a, 0.5, { emissive: 0x0a0e26 }), WING = mat(0x34408a, 0.55, { emissive: 0x0a0e26 }), MASK = mat(0x8a2a3a, 0.4);
  const DARK = mat(0x0e0c10, 0.25), EYE = mat(0xfffbe8, 0.2), FEET = mat(0xc9a46a, 0.6);
  const CHEST = mat(0xffffff, 0.7, { map: canvasTex(128, 128, (c) => {
    c.fillStyle = "#f1eee6"; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = "rgba(120,110,100,.5)"; c.lineWidth = 3;
    for (let r = 0; r < 5; r++) for (let k = -1; k < 8; k++) { c.beginPath(); c.arc(k * 18 + (r % 2) * 9, 30 + r * 20, 10, 0.2, Math.PI - 0.2); c.stroke(); }
  }) });
  const add = (geo, m, parent = b) => { const o = new THREE.Mesh(geo, m); parent.add(o); return o; };
  const R = 0.4, CY = 0.44, Z = new THREE.Vector3(0, 0, 1);
  // a point on the head, theta down from the top, phi round from the front (+z), and its outward normal
  const on = (theta, phi, r = R) => new THREE.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)).multiplyScalar(r);
  b.position.y = CY;
  add(new THREE.SphereGeometry(R, 32, 24), NAVY);
  // the chest and the mask: bands of a slightly bigger sphere (SphereGeometry's front, +z, is phi = pi/2)
  const band = (r, phiLen, t0, t1) => new THREE.SphereGeometry(r, 32, 12, Math.PI / 2 - phiLen / 2, phiLen, t0, t1 - t0);
  add(band(R * 1.01, 2.0, Math.PI * 0.5, Math.PI * 0.93), CHEST);
  add(band(R * 1.02, 2.9, Math.PI * 0.28, Math.PI * 0.43), MASK);
  // eyes: a white ball, a pupil, a lid in the mask's colour that turns down over it
  const lids = [];
  for (const side of [-1, 1]) {
    const e = new THREE.Group(), n = on(Math.PI * 0.355, side * 0.4).normalize();
    e.position.copy(n).multiplyScalar(R * 1.0); e.quaternion.setFromUnitVectors(Z, n); b.add(e);
    add(new THREE.SphereGeometry(0.075, 18, 12), EYE, e);
    add(new THREE.SphereGeometry(0.036, 12, 8), DARK, e).position.set(-side * 0.008, -0.012, 0.042);
    const lid = new THREE.Group(); e.add(lid); lids.push(lid);
    add(new THREE.SphereGeometry(0.083, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), MASK, lid);
  }
  // the beak, pointing out and a little down
  const beak = add(new THREE.ConeGeometry(0.055, 0.13, 12), DARK);
  beak.geometry.rotateX(Math.PI / 2 + 0.35); beak.position.copy(on(Math.PI * 0.5, 0, R * 1.04));
  // the curl on top
  const curl = new THREE.CatmullRomCurve3([[0, R * 0.96, 0.03], [0.01, R + 0.12, 0.0], [0.08, R + 0.21, -0.03], [0.15, R + 0.15, -0.04], [0.11, R + 0.09, -0.04]].map((p) => new THREE.Vector3(...p)));
  add(new THREE.TubeGeometry(curl, 24, 0.022, 8), NAVY);
  // the forked tail, behind
  for (const side of [-1, 1]) {
    const t = add(new THREE.ConeGeometry(0.06, 0.3, 4), NAVY);
    t.scale.set(1, 1, 0.35); t.rotation.set(-1.9, 0, side * 0.35); t.position.set(side * 0.05, -0.27, -0.36);
  }
  // wings: hung from the shoulders, swung out and up by pose()
  const wings = [-1, 1].map((side) => {
    const p = new THREE.Group(); p.position.set(side * R * 0.9, 0.04, -0.02); b.add(p);
    const w = add(new THREE.SphereGeometry(1, 16, 12), WING, p); w.scale.set(0.07, 0.24, 0.2); w.position.set(side * 0.02, -0.18, 0);
    return p;
  });
  const feet = [-1, 1].map((side) => { const f = add(new THREE.SphereGeometry(1, 12, 8), FEET, g); f.scale.set(0.07, 0.03, 0.08); f.position.set(side * 0.13, 0.03, 0.12); return f; });
  const zz = napZ(); g.add(zz);
  g.pose = ({ lid, wing, feet: down, sleep, now }) => {
    lids.forEach((l) => (l.rotation.x = -1.45 + lid * 3.0));
    wings.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * (0.08 + wing * 2.1)));
    feet.forEach((f) => (f.visible = down));
    zz.visible = sleep; zz.position.set(0.42, 0.95 + ((now * 0.4) % 1) * 0.2, 0); zz.material.opacity = 1 - ((now * 0.4) % 1);
  };
  g.body = b;
  return g;
}
// the z's of a nap, over a pet's head
function napZ() {
  const zz = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, map: canvasTex(64, 64, (c) => {
    c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.lineWidth = 4; c.font = "bold 34px sans-serif"; c.strokeText("z", 6, 52); c.fillText("z", 6, 52);
    c.font = "bold 24px sans-serif"; c.strokeText("z", 36, 26); c.fillText("z", 36, 26);
  }) }));
  zz.scale.set(0.34, 0.34, 1);
  return zz;
}
// The bands as little figures (the events' gifts; skins.js MEMBERS): a big head, each one known by his hair and his
// clothes (One Direction: Harry's curls, Liam's wavy mop, Louis's fringe swept aside, Niall's blond swoop, Zayn's tall
// black quiff; BTS: RM's glasses, Jin's pink suit, Suga's mint hair, J-Hope's bucket hat, Jimin's pink hair, V's waves
// and beret, Jungkook's long black hair, earrings and inked arm). Built facing +z with the feet at 0, about 1.1 tall; pose() as Nero's: lids, arms up (wing), the z's.
// They don't fly: with star power they jump and wave both arms over their heads (lift: how high the renderer raises them).
function makeMember(m) {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b); g.lift = 0.3;
  const mat = (color, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const SKIN = mat(m.skin, 0.55), HAIR = mat(m.hairC, 0.5), PANTS = mat(m.pants, 0.75), SHOE = mat(0x1a1a1e, 0.4);
  const TOP = mat(m.pattern === "plaid" ? 0xffffff : m.top, 0.7);
  if (m.pattern === "plaid") TOP.map = canvasTex(64, 64, (c) => {
    c.fillStyle = "#" + m.top.toString(16).padStart(6, "0"); c.fillRect(0, 0, 64, 64);
    c.fillStyle = "rgba(10,30,50,.45)"; for (let i = 0; i < 64; i += 16) { c.fillRect(i, 0, 6, 64); c.fillRect(0, i, 64, 6); }
    c.fillStyle = "rgba(230,240,240,.35)"; for (let i = 8; i < 64; i += 16) { c.fillRect(i, 0, 2, 64); c.fillRect(0, i, 64, 2); }
  }, { repeat: true });
  const add = (geo, mt, parent = b) => { const o = new THREE.Mesh(geo, mt); parent.add(o); return o; };
  const sph = (r, ws = 18, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
  // legs and shoes
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.055, 0.06, 0.24, 12), PANTS).position.set(side * 0.07, 0.17, 0);
    const sh = add(sph(1), SHOE); sh.scale.set(0.065, 0.04, 0.095); sh.position.set(side * 0.07, 0.04, 0.025);
  }
  // the body: the shirt or the jacket, and what shows at the front when it's open
  add(new THREE.CylinderGeometry(0.13, 0.16, 0.3, 18), TOP).position.y = 0.43;
  if (m.under != null) {
    const f = add(new THREE.BoxGeometry(0.1, 0.27, 0.02), mat(m.under, 0.7)); f.position.set(0, 0.43, 0.137); f.rotation.x = -0.1;
  }
  if (m.pocket != null) { const q = add(new THREE.BoxGeometry(0.045, 0.03, 0.01), mat(m.pocket, 0.6)); q.position.set(0.085, 0.5, 0.125); q.rotation.set(-0.1, 0.5, 0); }
  if (m.stripe != null) { const r = add(new THREE.CylinderGeometry(0.141, 0.144, 0.022, 18, 1, true), mat(m.stripe, 0.6)); r.position.y = 0.5; }
  if (m.neck != null) { const r = add(new THREE.TorusGeometry(0.075, 0.022, 8, 18), mat(m.neck, 0.6)); r.position.set(0, 0.56, 0.01); r.rotation.x = Math.PI / 2 - 0.25; }
  if (m.collar != null) for (const side of [-1, 1]) {
    const c = add(new THREE.ConeGeometry(0.04, 0.07, 3), mat(m.collar, 0.6)); c.position.set(side * 0.04, 0.565, 0.1); c.rotation.set(0.5, 0, side * 2.6);
  }
  if (m.buttons != null) for (let i = 0; i < 3; i++) add(sph(0.011, 8, 6), mat(m.buttons, 0.4)).position.set(0, 0.54 - i * 0.045, 0.134 + i * 0.004);
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 12), SKIN).position.y = 0.6;
  // arms, hung from the shoulders (pose() raises them)
  const INK = m.tattoo ? mat(0xffffff, 0.55) : null;
  if (INK) INK.map = canvasTex(64, 64, (c) => {
    c.fillStyle = "#" + m.skin.toString(16).padStart(6, "0"); c.fillRect(0, 0, 64, 64);
    c.strokeStyle = "rgba(20,20,30,.85)"; c.lineWidth = 4;
    for (let i = 0; i < 7; i++) { c.beginPath(); c.arc((i * 23) % 64, 8 + i * 8, 7 + (i % 3) * 3, 0, Math.PI * 1.4); c.stroke(); }
  });
  const arms = [-1, 1].map((side) => {
    const p = new THREE.Group(); p.position.set(side * 0.155, 0.55, 0); b.add(p);
    add(new THREE.CylinderGeometry(0.045, 0.042, 0.24, 10), INK && side < 0 ? INK : TOP, p).position.y = -0.12; // his right arm, inked
    add(sph(0.048), SKIN, p).position.y = -0.26;
    return p;
  });
  // the head, a big one
  const head = new THREE.Group(); head.position.y = 0.81; b.add(head);
  add(sph(0.25, 28, 20), SKIN, head).scale.set(1, 0.96, 0.95);
  for (const side of [-1, 1]) add(sph(0.05), SKIN, head).position.set(side * 0.243, -0.01, -0.01);
  const lids = [];
  for (const side of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(side * 0.088, -0.005, 0.218); head.add(e);
    const eye = add(sph(0.036), mat(0x101012, 0.2), e); eye.scale.set(1, 1.2, 0.6);
    const iris = add(sph(0.022), mat(m.eyes, 0.25), e); iris.position.set(0, -0.006, 0.014); iris.scale.set(1, 1.2, 0.5);
    add(sph(0.011, 8, 6), mat(0xffffff, 0.2), e).position.set(side * -0.01, 0.014, 0.024);
    const lid = new THREE.Group(); e.add(lid); lids.push(lid);
    add(new THREE.SphereGeometry(0.046, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), SKIN, lid).scale.set(1, 1.15, 0.75);
    const brow = add(new THREE.BoxGeometry(0.07, 0.014, 0.02), HAIR, head); brow.position.set(side * 0.088, 0.065, 0.225); brow.rotation.z = side * -0.12;
  }
  const mouth = add(new THREE.TorusGeometry(0.04, 0.009, 6, 14, Math.PI), mat(0x8a3a34, 0.5), head);
  mouth.position.set(0, -0.085, 0.226); mouth.rotation.z = Math.PI;
  // the hair: a cap tilted back so its edge runs above the brows (never down by the eyes), then each one's cut
  const cap = (r, tilt) => { const c = add(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), HAIR, head); c.rotation.x = tilt; c.scale.set(1, 1, 0.97); return c; };
  if (m.hair === "buzz") {
    cap(0.256, -0.5);
  } else if (m.hair === "quiff") {
    cap(0.262, -0.5);
    // high at the front, swept up and back (short at the sides)
    const q = add(sph(1, 20, 14), HAIR, head); q.scale.set(0.16, 0.07, 0.2); q.position.set(0, 0.2, 0.1); q.rotation.x = -0.15;
    const q2 = add(sph(1, 16, 12), HAIR, head); q2.scale.set(0.13, 0.065, 0.1); q2.position.set(0, 0.235, 0.2); q2.rotation.x = 0.8;
  } else if (m.hair === "short") {
    cap(0.262, -0.5);
    if (m.hat == null) { const top = add(sph(1, 18, 12), HAIR, head); top.scale.set(0.21, 0.08, 0.2); top.position.set(0, 0.2, 0.04); top.rotation.x = -0.2; }
  } else if (m.hair === "neat") {
    // short, combed to one side from a parting
    cap(0.262, -0.5);
    const a = add(sph(1, 18, 12), HAIR, head); a.scale.set(0.2, 0.075, 0.19); a.position.set(0.04, 0.2, 0.06); a.rotation.set(-0.25, 0, -0.25);
    const p = add(new THREE.BoxGeometry(0.012, 0.02, 0.14), mat(m.skin, 0.6), head); p.position.set(-0.08, 0.235, 0.1); p.rotation.x = -0.6;
  } else if (m.hair === "part") {
    // parted in the middle, a curtain falling to each side of the forehead (above the brows)
    cap(0.264, -0.5);
    for (const side of [-1, 1]) {
      const c = add(sph(1, 16, 12), HAIR, head); c.scale.set(0.12, 0.07, 0.08); c.position.set(side * 0.1, 0.15, 0.18); c.rotation.set(0.5, 0, side * -0.5);
    }
    const top = add(sph(1, 18, 12), HAIR, head); top.scale.set(0.22, 0.08, 0.21); top.position.set(0, 0.2, 0.02);
  } else if (m.hair === "waves") {
    cap(0.27, -0.45);
    for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3; add(sph(0.075, 12, 10), HAIR, head).position.set(Math.sin(a) * 0.2, 0.15 + Math.cos(a) * 0.05, Math.cos(a) * 0.12); }
  } else if (m.hair === "mullet") {
    // longer: down the back to the neck and over the ears
    cap(0.268, -0.45);
    const back = add(sph(1, 18, 12), HAIR, head); back.scale.set(0.22, 0.2, 0.12); back.position.set(0, -0.07, -0.16);
    for (const side of [-1, 1]) { const s2 = add(sph(1, 14, 10), HAIR, head); s2.scale.set(0.06, 0.12, 0.12); s2.position.set(side * 0.22, 0.03, -0.04); }
    const f = add(sph(1, 16, 12), HAIR, head); f.scale.set(0.2, 0.06, 0.08); f.position.set(0, 0.17, 0.17); f.rotation.x = 0.4;
  } else if (m.hair === "swoop") {
    // swept up and over at the front, soft and rounded (not Zayn's tall one)
    cap(0.264, -0.5);
    const w = add(sph(1, 20, 14), HAIR, head); w.scale.set(0.19, 0.09, 0.17); w.position.set(0.02, 0.23, 0.1); w.rotation.set(-0.35, 0, -0.15);
    const t = add(sph(1, 16, 12), HAIR, head); t.scale.set(0.1, 0.07, 0.1); t.position.set(-0.1, 0.2, 0.15); t.rotation.set(-0.2, 0, 0.4);
  } else if (m.hair === "mop") {
    // a full wavy mop, its fringe falling over the forehead
    cap(0.272, -0.47);
    const top = add(sph(1, 20, 14), HAIR, head); top.scale.set(0.25, 0.12, 0.23); top.position.set(0, 0.17, 0.0);
    [[-0.1, 0.18, 0.18, 0.4], [0.0, 0.17, 0.2, 0.1], [0.1, 0.18, 0.18, -0.3], [-0.19, 0.12, 0.13, 0.8]].forEach(([x, y, z, rz]) => {
      const f = add(sph(1, 14, 10), HAIR, head); f.scale.set(0.07, 0.085, 0.05); f.position.set(x, y, z); f.rotation.set(0.5, 0, rz);
    });
    for (const side of [-1, 1]) add(sph(0.075, 12, 10), HAIR, head).position.set(side * 0.21, 0.07, -0.03);
  } else if (m.hair === "fringe") {
    cap(0.264, -0.47);
    const f = add(sph(1, 20, 12), HAIR, head); f.scale.set(0.2, 0.06, 0.09); f.position.set(0.03, 0.17, 0.17); f.rotation.set(0.3, 0, -0.32);
    const f2 = add(sph(1, 16, 10), HAIR, head); f2.scale.set(0.1, 0.045, 0.07); f2.position.set(0.17, 0.12, 0.15); f2.rotation.set(0.2, 0.4, -0.7);
    const top = add(sph(1, 18, 12), HAIR, head); top.scale.set(0.2, 0.09, 0.2); top.position.set(0, 0.2, 0.03);
  } else {
    // curls: a mop of little balls over the top, the sides and down the back to the neck
    cap(0.27, -0.45);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 * 3.3, t = i / 33, th = 0.25 + t * 1.45, r = 0.27;
      const x = Math.sin(th) * Math.sin(a) * r, y = Math.cos(th) * r, z = Math.sin(th) * Math.cos(a) * r;
      if (z > 0.1 && y < 0.15) continue; // the face stays clear
      add(sph(0.06 + (i % 3) * 0.008, 10, 8), HAIR, head).position.set(x * 1.02, y + 0.02, z * 1.02 - 0.01);
    }
    for (const [x, y] of [[-0.12, 0.17], [0.1, 0.19], [-0.02, 0.21]]) add(sph(0.065, 10, 8), HAIR, head).position.set(x, y, 0.15);
  }
  if (m.earrings != null) for (const side of [-1, 1]) add(sph(0.018, 8, 6), mat(m.earrings, 0.2), head).position.set(side * 0.25, -0.05, 0.01);
  if (m.glasses != null) {
    const G = mat(m.glasses, 0.3);
    for (const side of [-1, 1]) { const r = add(new THREE.TorusGeometry(0.05, 0.008, 6, 20), G, head); r.position.set(side * 0.088, 0, 0.24); }
    add(new THREE.BoxGeometry(0.06, 0.008, 0.008), G, head).position.set(0, 0.01, 0.245);
  }
  if (m.hat != null) {
    // a bucket hat: its crown, and the brim all round (above the brows)
    const H = mat(m.hat, 0.7);
    add(new THREE.CylinderGeometry(0.2, 0.25, 0.14, 24), H, head).position.set(0, 0.22, 0);
    const brim = add(new THREE.CylinderGeometry(0.25, 0.34, 0.06, 28, 1, true), H, head); brim.position.set(0, 0.13, 0.01); brim.material.side = THREE.DoubleSide;
  }
  if (m.beret != null) { const be = add(sph(1, 20, 12), mat(m.beret, 0.75), head); be.scale.set(0.24, 0.07, 0.23); be.position.set(-0.03, 0.25, -0.02); be.rotation.z = 0.25; }
  const zz = napZ(); g.add(zz);
  g.pose = ({ lid, wing, sleep, now }) => {
    lids.forEach((l) => (l.rotation.x = -1.45 + lid * 3.0));
    arms.forEach((a, i) => (a.rotation.z = (i ? 1 : -1) * (0.12 + wing * 2.5 + (wing > 0.4 ? Math.sin(now * 14 + i * 2) * 0.25 : 0))));
    mouth.scale.set(1 + wing * 0.4, 1 + wing * 0.8, 1); mouth.visible = !sleep;
    head.rotation.z = sleep ? 0.2 : Math.sin(now * 2.1) * 0.05;
    zz.visible = sleep; zz.position.set(0.4, 1.15 + ((now * 0.4) % 1) * 0.2, 0); zz.material.opacity = 1 - ((now * 0.4) % 1);
  };
  return g;
}
// Eddie, Iron Maiden's (the Iron Maiden event's secret gift), as on the Killers cover, made like the bands' figures
// (makeMember: a big head, the same body, the same moves) with his own face: a skull with the skin drawn over it,
// glowing yellow eyes deep in their sockets under a scowl, a hole for a nose and a wide grin of teeth; a dark grey
// T-shirt streaked yellow by the cover's light, its short sleeves and hem torn, grey jeans and boots, bony arms, clawed
// hands and the bloody hatchet. His hair is the cover's own wild mane, taken from a model made from the cover
// (public/models/eddie-hair.glb, loaded the first time he's worn). He headbangs on every beat (harder in the loud
// parts, on a long streak and with star power), the mane swinging after his head on a spring.
let eddieHair = null;
function makeEddie() {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b); g.lift = 0.3;
  const mat = (color, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const SKIN = mat(0x7d6a52, 0.65), SHADE = mat(0x4a3c2c, 0.85), DARK = new THREE.MeshBasicMaterial({ color: 0x0c0806 });
  const JEANS = mat(0x45464c, 0.85), BOOT = mat(0x16120f, 0.4), TOOTH = mat(0xe4dcbc, 0.4);
  const SHIRT = mat(0xffffff, 0.6); SHIRT.map = canvasTex(64, 64, (c) => { // dark grey, streaked yellow by the cover's light
    c.fillStyle = "#3a3a40"; c.fillRect(0, 0, 64, 64);
    c.strokeStyle = "#e0a820"; c.lineCap = "round";
    for (const [x, w, k] of [[6, 5, 0.3], [20, 3, -0.2], [31, 6, 0.15], [45, 3, 0.35], [55, 5, -0.1]]) { c.lineWidth = w; c.beginPath(); c.moveTo(x, -4); c.quadraticCurveTo(x + k * 30, 32, x - k * 10, 68); c.stroke(); }
  }, { repeat: true });
  const add = (geo, mt, parent = b) => { const o = new THREE.Mesh(geo, mt); parent.add(o); return o; };
  const sph = (r, ws = 18, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
  // legs and boots
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.055, 0.06, 0.24, 12), JEANS).position.set(side * 0.07, 0.17, 0);
    const sh = add(sph(1), BOOT); sh.scale.set(0.065, 0.045, 0.1); sh.position.set(side * 0.07, 0.04, 0.025);
  }
  add(new THREE.CylinderGeometry(0.155, 0.155, 0.03, 18), mat(0x1c140e, 0.35, 0.3)).position.y = 0.29; // the belt
  // the shirt, torn at the hem; through a rip at the front, his ribs
  const shirt = add(new THREE.CylinderGeometry(0.13, 0.16, 0.28, 18), SHIRT); shirt.position.y = 0.44;
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, rag = add(new THREE.ConeGeometry(0.025, 0.05 + (i % 3) * 0.02, 4), SHIRT); rag.position.set(Math.sin(a) * 0.158, 0.3 - (i % 3) * 0.008, Math.cos(a) * 0.158); rag.rotation.set(Math.PI, a, 0); rag.scale.z = 0.4; }
  const rip = add(new THREE.CircleGeometry(0.06, 5), SKIN); rip.position.set(0.02, 0.47, 0.147); rip.rotation.x = -0.1; rip.scale.set(0.8, 1.4, 1);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.06, 0.007, 0.004), SHADE).position.set(0.02, 0.53 - i * 0.03, 0.15 - i * 0.002);
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 12), SKIN).position.y = 0.6;
  // arms, hung from the shoulders (pose() raises them): short torn sleeves, bony arms, claws
  const arms = [-1, 1].map((side) => {
    const p = new THREE.Group(); p.position.set(side * 0.155, 0.55, 0); b.add(p);
    add(new THREE.CylinderGeometry(0.052, 0.048, 0.1, 10), SHIRT, p).position.y = -0.04;
    for (let i = 0; i < 4; i++) { const a = i * 1.6, r = add(new THREE.ConeGeometry(0.014, 0.035, 4), SHIRT, p); r.position.set(Math.sin(a) * 0.046, -0.1, Math.cos(a) * 0.046); r.rotation.x = Math.PI; }
    add(new THREE.CylinderGeometry(0.034, 0.03, 0.24, 8), SKIN, p).position.y = -0.14;
    const hand = new THREE.Group(); hand.position.y = -0.27; p.add(hand);
    add(sph(0.04), SKIN, hand).scale.set(0.9, 1, 0.75);
    for (let f = 0; f < 4; f++) { const k = add(new THREE.ConeGeometry(0.008, 0.06, 5), SHADE, hand); k.position.set(-0.021 + f * 0.014, -0.045, 0.012); k.rotation.set(Math.PI - 0.5, 0, (f - 1.5) * 0.15); }
    return { p, hand };
  });
  // the hatchet in his right hand: a wooden handle, a broad blade, blood on its edge
  const axe = new THREE.Group(); axe.position.set(0, -0.02, 0.03); axe.rotation.set(1.2, 0, 0); arms[0].hand.add(axe);
  add(new THREE.CylinderGeometry(0.013, 0.016, 0.26, 8), mat(0x5a3c22, 0.7), axe).position.y = 0.05;
  const STEEL = mat(0xb8bcc2, 0.3, 0.6), BLOOD = mat(0x8a0a0a, 0.3);
  add(new THREE.BoxGeometry(0.02, 0.07, 0.08), STEEL, axe).position.set(0, 0.16, 0.045);
  add(new THREE.BoxGeometry(0.018, 0.1, 0.02), STEEL, axe).position.set(0, 0.16, 0.085);
  add(new THREE.BoxGeometry(0.02, 0.1, 0.01), BLOOD, axe).position.set(0, 0.16, 0.097);
  // the head: a big one, as the others', on a neck that can bang
  const neck = new THREE.Group(); neck.position.y = 0.6; b.add(neck);
  const head = new THREE.Group(); head.position.y = 0.21; neck.add(head);
  add(sph(0.25, 28, 20), SKIN, head).scale.set(0.95, 1.02, 0.95);
  const lids = [], lights = [];
  for (const side of [-1, 1]) {
    const cheek = add(sph(0.06, 14, 10), SKIN, head); cheek.scale.set(1, 0.6, 0.7); cheek.position.set(side * 0.12, -0.04, 0.18); // big cheekbones
    const hollow = add(sph(0.05, 12, 10), SHADE, head); hollow.scale.set(0.6, 1, 0.4); hollow.position.set(side * 0.135, -0.11, 0.16);
    const e = new THREE.Group(); e.position.set(side * 0.085, 0.02, 0.2); head.add(e);
    add(sph(0.052, 16, 12), DARK, e).scale.set(1, 0.8, 0.5); // the socket
    const eye = add(sph(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd040 }), e); eye.position.z = 0.016; lights.push(eye);
    const lid = new THREE.Group(); e.add(lid); lids.push(lid);
    add(new THREE.SphereGeometry(0.056, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), SKIN, lid).scale.set(1, 0.85, 0.55);
    const brow = add(sph(1, 14, 8), SHADE, head); brow.scale.set(0.075, 0.022, 0.04); brow.position.set(side * 0.085, 0.085, 0.215); brow.rotation.z = side * 0.42; // a scowl
  }
  const nose = add(new THREE.ConeGeometry(0.03, 0.055, 3), DARK, head); nose.position.set(0, -0.045, 0.235); nose.rotation.set(-0.35, 0, Math.PI); nose.scale.z = 0.4;
  // the grin: wide, the corners up into the cheeks; upper teeth in the skull, the lower ones on the jaw
  const row = (parent, y0, z0, h, n, w) => { for (let t = 0; t < n; t++) { const x = -w / 2 + (t + 0.5) * (w / n), c = x * x * 4; const tt = add(new THREE.BoxGeometry((w / n) * 0.85, h, 0.014), TOOTH, parent); tt.position.set(x, y0 + c * 0.7, z0 - c * 1.1); tt.rotation.y = -x * 3; } };
  add(new THREE.BoxGeometry(0.2, 0.07, 0.04), DARK, head).position.set(0, -0.125, 0.19);
  add(new THREE.BoxGeometry(0.21, 0.012, 0.03), mat(0x4a1210, 0.7), head).position.set(0, -0.095, 0.205);
  row(head, -0.112, 0.222, 0.04, 12, 0.21);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.12, 0.02); head.add(jaw);
  const chin = add(sph(1, 14, 10), SKIN, jaw); chin.scale.set(0.11, 0.055, 0.12); chin.position.set(0, -0.06, 0.1);
  row(jaw, -0.032, 0.197, 0.034, 12, 0.2);
  // the mane, from the model: it hangs from a pivot at the crown so it can swing after the head
  const mane = new THREE.Group(); mane.position.set(0, 0.24, -0.02); head.add(mane);
  eddieHair ??= import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => new GLTFLoader().loadAsync("/models/eddie-hair.glb"));
  eddieHair.then((gltf) => {
    const h = gltf.scene.clone(true);
    h.scale.setScalar(2.0); h.position.set(0.012, 0.12, -0.03); h.rotation.y = -0.9; // sized to the head, turned so the face shows (in the painting he looks to his left)
    mane.add(h);
  }).catch(() => { eddieHair = null; }); // offline: bald this time, another try next time he's worn
  const zz = napZ(); g.add(zz);
  let last = null, bang = 0, drive = 0, lag = 0, lagV = 0;
  g.pose = ({ lid, wing, sleep, now, pulse = 0, star = false, happy = false, energy = 0.55 }) => {
    const dt = last == null ? 1 / 60 : Math.min(0.05, Math.max(0, now - last)); last = now;
    lids.forEach((l) => (l.rotation.x = -1.45 + lid * 3.0));
    lights.forEach((l) => l.material.color.setRGB(sleep ? 0.2 : 1, sleep ? 0.15 : 0.82, sleep ? 0.05 : 0.25));
    arms.forEach((a, i) => (a.p.rotation.z = (i ? 1 : -1) * (0.12 + wing * 2.5 + (wing > 0.4 ? Math.sin(now * 14 + i * 2) * 0.25 : 0))));
    jaw.rotation.x = sleep ? 0.1 : wing * 0.35;
    // headbanging: a nod in the quiet parts, more as the song gets loud, all out on a streak or with star power
    const want = sleep ? 0 : star ? 1 : happy ? 0.75 : 0.2 + 0.45 * Math.min(1, Math.max(0, (energy - 0.45) / 0.4));
    drive += (want - drive) * Math.min(1, dt * 3);
    bang += ((sleep ? 0.3 : pulse * (0.1 + drive * 0.45)) - bang) * Math.min(1, dt * (sleep ? 2 : 22));
    lagV += ((-bang * 0.8 - lag) * 70 - lagV * 6) * dt; lag += lagV * dt; // the mane hangs back as the head drops, then swings past
    neck.rotation.set(bang, 0, sleep ? 0.2 : Math.sin(now * 2.1) * 0.05 * (1 - drive));
    mane.rotation.x = lag;
    zz.visible = sleep; zz.position.set(0.4, 1.2 + ((now * 0.4) % 1) * 0.2, 0); zz.material.opacity = 1 - ((now * 0.4) % 1);
  };
  return g;
}
const petModels = { nero: makeNero, ...Object.fromEntries(Object.entries(MEMBERS).map(([id, m]) => [id, () => makeMember(m)])), eddie: makeEddie };
const starDotTex = () => canvasTex(64, 64, (g) => {
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 14); rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#fff"; g.beginPath(); g.moveTo(32, 2); g.lineTo(36, 28); g.lineTo(62, 32); g.lineTo(36, 36); g.lineTo(32, 62); g.lineTo(28, 36); g.lineTo(2, 32); g.lineTo(28, 28); g.fill();
});

// Merge every static mesh in a group into one mesh per material (hundreds of draw calls -> a handful).
function bake(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map(), keep = [];
  group.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) { if (o !== group && (o.isMesh || o.isSprite || o.isPoints) && o.parent === group) keep.push(o); return; }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) out.add(new THREE.Mesh(mergeGeometries(geos), mat));
  for (const o of keep) { o.updateMatrixWorld(true); o.matrix.copy(o.matrixWorld); o.matrix.decompose(o.position, o.quaternion, o.scale); out.add(o); }
  return out;
}

/* ================= tour venues ================= */
// One rig, re-tinted per venue: only colours, intensities and counts change, so a switch costs nothing.
// pal: light colours per song section [front PARs, back PARs]; wall/floor: colour multipliers (linear, may go above 1);
// gloss: floor [roughness, metalness]; boards: plank texture repeat (slabs: no tape, it stretches into a band);
// fog: [colour, near, far]; amb/key: venue fill lights; spot: band key light [colour, strength];
// light/beat/rim: rig brightness, how hard it hits the beat, rim light on the people;
// glow/cone/back: PAR lens size, beam strength, back truss on; haze: [colour, opacity]; dust: [colour, opacity];
// crowd: density; pyro: [opacity, size, light] (null: none); wide: two more columns; fire: [flame tint, light colour, cryo jets].
const NO_PYRO = [0, 1, 0]; // garage: shared so render() doesn't allocate each frame
const BAR_PAL = [[0xffb060, 0xff3a1a], [0xff2a14, 0xffc070], [0xfff0d0, 0xff6a10], [0xffc040, 0xd01010], [0xff7a20, 0xfff2e0]];
const STAGES = {
  // a friend's garage: bare warm bulbs under a buzzing fluorescent tube, concrete, a handful of friends
  garage: {
    pal: [[0xffa04a, 0xc8ffe0], [0xffb466, 0xb0f5d4], [0xff9238, 0xd8ffea], [0xffbf7a, 0xa8f0cc]],
    wall: [0.62, 0.78, 0.72], floor: [2.3, 3.2, 3.6], gloss: [0.9, 0], boards: [1.4, 3], slabs: true,
    fog: [0x0a0e0c, 26, 95], amb: [0xcdeedd, 0x0b100d, 0.75], key: [0xdcfff0, 0.95], spot: [0xffd8a8, 0.8],
    light: 0.55, beat: 0.4, rim: 0.75, glow: 0.7, cone: 0.45, back: 0, haze: [0x4c5c52, 0.35], dust: [0xe0f0e8, 0.35],
    crowd: 0.22, pyro: null, wide: false, fire: [0xffffff, 0xff7a20, false],
  },
  // the club: today's look (every value here matches how the venue is built)
  bar: {
    pal: BAR_PAL,
    wall: [1, 1, 1], floor: [1, 1, 1], gloss: [0.55, 0.15], boards: [16, 14],
    fog: [0x0d0705, 22, 75], amb: [0xffd9b0, 0x120604, 0.35], key: [0xffe2c4, 0.7], spot: [0xffe2c0, 1],
    light: 1, beat: 1, rim: 1, glow: 1, cone: 1, back: 1, haze: [0x6a4028, 1], dust: [0xffb070, 0.6],
    crowd: 1, pyro: [1, 1, 1], wide: false, fire: [0xffffff, 0xff7a20, false],
  },
  // college festival under a tent at night: violet, blue and magenta, thick haze, cryo jets instead of fire
  university: {
    pal: [[0x9a40ff, 0xff2ad0], [0x3a6bff, 0xc040ff], [0xff40c8, 0x5a50ff], [0x7a3cff, 0x30c0ff], [0xe040ff, 0x4060ff]],
    wall: [0.55, 0.45, 1.1], floor: [1.0, 1.25, 3.0], gloss: [0.42, 0.25], boards: [10, 10],
    fog: [0x0e0820, 22, 76], amb: [0xa890ff, 0x0c0618, 0.45], key: [0xd0c0ff, 0.6], spot: [0xf0e0ff, 1],
    light: 1.05, beat: 1.1, rim: 1.05, glow: 1.1, cone: 1.5, back: 1, haze: [0x5a30a0, 1.8], dust: [0xd8a0ff, 0.6],
    crowd: 0.6, pyro: [0.85, 0.9, 0.7], wide: false, fire: [0xf0d8ff, 0xa080ff, true],
  },
  // old theatre: burgundy curtains, dark red air, polished boards, warm golden follow spots on the band
  theater: {
    pal: [[0xffc860, 0xff9a30], [0xffd890, 0xe0402a], [0xffb040, 0xffe0a0], [0xffcf70, 0xd02838]],
    wall: [1.8, 0.3, 0.36], floor: [1.4, 0.6, 0.55], gloss: [0.3, 0.3], boards: [22, 14],
    fog: [0x2a0814, 18, 66], amb: [0xffb080, 0x220610, 0.32], key: [0xffd8a0, 0.7], spot: [0xffd890, 1.25],
    light: 1, beat: 0.8, rim: 1, glow: 1.15, cone: 1.1, back: 1, haze: [0xa01a2a, 1.4], dust: [0xffd080, 0.7],
    crowd: 0.75, pyro: [0.6, 0.72, 0.5], wide: false, fire: [0xffe0b0, 0xff8a30, false],
  },
  // open air at night: navy sky, cyan, magenta and green beams over a full field
  festival: {
    pal: [[0x20e0ff, 0xff30c0], [0x40ff80, 0x2080ff], [0xff40d0, 0x30ffe0], [0xa0ff30, 0xff3070], [0x30a0ff, 0x60ff60]],
    wall: [0.12, 0.2, 0.42], floor: [1.2, 2.0, 4.2], gloss: [0.38, 0.3], boards: [8, 8],
    fog: [0x0c1e56, 16, 70], amb: [0x6080ff, 0x050a20, 0.55], key: [0xc8d8ff, 0.6], spot: [0xe6f0ff, 1],
    light: 1.25, beat: 1.15, rim: 1.1, glow: 1.3, cone: 1.8, back: 1, haze: [0x1a4090, 1.5], dust: [0xa0e0ff, 0.75],
    crowd: 1, pyro: [1, 1.1, 1.1], wide: false, fire: [0xffffff, 0xff7a20, false],
  },
  // the biggest show: a packed arena, white and gold walls of light, huge fire
  stadium: {
    pal: [[0xffe0a0, 0xffb830], [0xffc850, 0xfff4e0], [0xfff4e0, 0xffa820], [0xffd070, 0xffffff], [0xffb840, 0xffeccc]],
    wall: [0.5, 0.52, 0.6], floor: [1.2, 1.2, 1.4], gloss: [0.22, 0.5], boards: [6, 6],
    fog: [0x1c1814, 22, 80], amb: [0xfff0dc, 0x0c0a0c, 0.42], key: [0xfff4e4, 0.85], spot: [0xfff0dc, 0.6], // x light 1.6 ~ the club; any hotter clips the kick head white
    light: 1.6, beat: 1.2, rim: 1, glow: 1.6, cone: 1.8, back: 1, haze: [0x9a8870, 1.8], dust: [0xfff0c8, 0.8],
    crowd: 1.4, pyro: [1, 1.35, 1.7], wide: true, fire: [0xffffff, 0xff8a30, false],
  },
};
export const STAGE_NAMES = Object.keys(STAGES);

/* ================= renderer ================= */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Safe modes for GPUs that draw some effect pitch black (an Apple M2 MacBook Air did, in Safari and Chrome alike, until
  // "Rápidos"), tried in order, losing as little as possible: found by the black-frame probe below and remembered per
  // browser (bump the key when the pipeline changes, so every machine gets tested again).
  const SAFE = [
    { msaa: true, bloom: true, post: true, name: "everything" },
    { msaa: false, bloom: true, post: true, name: "no MSAA" },
    { msaa: true, bloom: false, post: true, name: "no bloom" },
    { msaa: false, bloom: false, post: true, name: "no MSAA, no bloom" },
    { msaa: false, bloom: false, post: false, name: "no post-processing" },
  ];
  const SAFE_KEY = "corde.gfxsafe.v1";
  let safe = 0;
  try { safe = Math.min(SAFE.length - 1, Math.max(0, parseInt(localStorage.getItem(SAFE_KEY), 10) || 0)); } catch {}
  // every buffer between the scene and the screen is half-float: a GPU that can't draw into those gets the plainest mode
  const floatOK = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  if (!floatOK) safe = SAFE.length - 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070403);
  scene.fog = new THREE.Fog(0x0d0705, 22, 75);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220);
  // The venue lives in its own scene, rendered into a low-res target and shown as the highway's background.
  const bg = new THREE.Scene();
  bg.background = new THREE.Color(0x070403);
  // its own fog (same as the neck's at the club) so a venue can tint it without touching the highway
  const bgFog = new THREE.Fog(0x0d0705, 22, 75); bg.fog = bgFog;
  const bgRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  scene.background = bgRT.texture;
  const bgHemi = new THREE.HemisphereLight(0xffd9b0, 0x120604, 0.35); bg.add(bgHemi);
  const bgKey = new THREE.DirectionalLight(0xffe2c4, 0.7); bgKey.position.set(2, 9, 7); bg.add(bgKey);

  /* --- lights: warm tungsten club rig --- */
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x120604, 0.28); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0dd, 1.0); key.position.set(2, 9, 7); scene.add(key);
  const wallSpots = [];
  [[-16, 0xffa040], [0, 0xff3b1a], [16, 0xffc070]].forEach(([x, c]) => {
    const s = new THREE.SpotLight(c, 260, 80, 0.42, 0.7, 1.4);
    s.position.set(x, 22, -30); s.target.position.set(x * 0.8, 6, -58);
    bg.add(s, s.target); wallSpots.push(s);
  });
  const stageWash = new THREE.SpotLight(0xffb070, 140, 60, 0.6, 0.8, 1.5);
  stageWash.position.set(0, 20, -20); stageWash.target.position.set(0, 0, -40); bg.add(stageWash, stageWash.target);
  const pyroLight = new THREE.PointLight(0xff7a20, 0, 40, 1.5); pyroLight.position.set(0, 4, -22); bg.add(pyroLight);
  // front light on the band so they read as people, not just outlines
  const bandKey = new THREE.SpotLight(0xffe2c0, 380, 90, 0.42, 0.7, 1.2);
  bandKey.position.set(0, 17, -6); bandKey.target.position.set(0, 4, -38); bg.add(bandKey, bandKey.target);

  /* --- venue --- */
  const stage = new THREE.Group();
  const brick = brickTex(); brick.repeat.set(4, 2);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(140, 60), new THREE.MeshStandardMaterial({ map: brick, roughness: 0.95, metalness: 0 }));
  wall.position.set(0, 24, -60); stage.add(wall);

  const [planks, slabs] = planksTex(); planks.repeat.set(16, 14);
  renderer.initTexture(slabs); // upload now so the first garage doesn't hitch
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 120), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.55, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.9, -20); stage.add(floor);

  // amp walls
  const grille = grilleTex(), tolex = tolexTex();
  const tolexMat = new THREE.MeshStandardMaterial({ map: tolex, roughness: 0.7, metalness: 0.1 });
  const grilleMat = new THREE.MeshStandardMaterial({ map: grille, roughness: 0.9 });
  const cabMats = [tolexMat, tolexMat, tolexMat, tolexMat, grilleMat, tolexMat];
  const headFace = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = "#121111"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#b8a77a"; g.fillRect(10, 18, w - 20, 28); // gold control panel
    for (let i = 0; i < 10; i++) { g.fillStyle = "#111"; g.beginPath(); g.arc(30 + i * 21, 32, 7, 0, 7); g.fill(); }
    g.fillStyle = "#ff3020"; g.beginPath(); g.arc(w - 22, 32, 4, 0, 7); g.fill();
  });
  const headMats = [tolexMat, tolexMat, tolexMat, tolexMat, new THREE.MeshStandardMaterial({ map: headFace, roughness: 0.6, emissive: 0x301008, emissiveIntensity: 0.4 }), tolexMat];
  const cabGeo = new THREE.BoxGeometry(4.2, 4.2, 2.4), headGeo = new THREE.BoxGeometry(4.2, 1.5, 2.2);
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
    const x = side * (9.5 + (k % 2) * 4.4), z = -26 - Math.floor(k / 2) * 9 - (k % 2) * 2;
    for (let j = 0; j < 2; j++) { const cab = new THREE.Mesh(cabGeo, cabMats); cab.position.set(x, 1.2 + j * 4.2, z); cab.rotation.y = -side * 0.12; stage.add(cab); }
    const head = new THREE.Mesh(headGeo, headMats); head.position.set(x, 9.85, z); head.rotation.y = -side * 0.12; stage.add(head);
  }

  // drum riser + kit (silhouette-level detail)
  const kit = new THREE.Group(); kit.position.set(0, 0, -44); stage.add(kit);
  const carpet = new THREE.MeshStandardMaterial({ color: 0x1a0b08, roughness: 1 });
  const riser = new THREE.Mesh(new THREE.BoxGeometry(12, 2.2, 7), carpet); riser.position.y = 0.2; kit.add(riser);
  const shell = new THREE.MeshStandardMaterial({ color: 0x5a0d0d, metalness: 0.6, roughness: 0.3 });
  const head = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8c4bc, metalness: 1, roughness: 0.2 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 1, roughness: 0.28, emissive: 0x3a2000, emissiveIntensity: 0.3 });
  const drum = (r, d, x, y, z, rx = 0) => {
    const gg = new THREE.Group();
    const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d, 32, 1, true), shell);
    const h1 = new THREE.Mesh(new THREE.CircleGeometry(r, 32), head); h1.rotation.x = -Math.PI / 2; h1.position.y = d / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 32), chrome); rim.rotation.x = Math.PI / 2; rim.position.y = d / 2;
    gg.add(s, h1, rim); gg.position.set(x, y, z); gg.rotation.x = rx; kit.add(gg); return gg;
  };
  drum(1.6, 1.6, 0, 2.9, 1.4, Math.PI / 2); // kick, facing the crowd
  drum(0.75, 0.6, -1.0, 4.7, 0.6, 0.5); drum(0.85, 0.7, 1.0, 4.7, 0.6, 0.5); // rack toms
  drum(1.0, 1.0, 2.6, 2.6, 0.6, 0.15); drum(0.75, 0.35, -2.4, 3.1, 0.9, 0.3); // floor tom, snare
  // cymbals stay out of the baked mesh: the drummer hits them (they wobble and flash)
  const cymGroup = new THREE.Group(); cymGroup.position.copy(kit.position); bg.add(cymGroup);
  const cymList = [];
  const cymbal = (r, x, y, z, rz) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.98, 0.04, 40), brass.clone()); c.position.set(x, y, z); c.rotation.set(0.5, 0, rz); cymGroup.add(c); cymList.push(c);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, y - 1.3, 6), chrome); st.position.set(x, (y + 1.3) / 2, z - 0.3); kit.add(st); };
  cymbal(1.2, -3.4, 6.2, 0.4, 0.3); cymbal(1.35, 3.6, 6.5, 0.2, -0.3); cymbal(0.7, -4.2, 4.2, 1.2, 0.1); cymbal(1.0, 0.2, 7.0, -0.8, 0);

  // lighting truss + PAR cans with haze cones
  const truss = new THREE.Group(); stage.add(truss);
  const tube = new THREE.MeshStandardMaterial({ color: 0x9a968e, metalness: 1, roughness: 0.35 });
  const mkTruss = (z, y) => {
    for (const [dy, dz] of [[0, 0], [0.8, 0], [0, 0.8], [0.8, 0.8]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 80, 6), tube); t.rotation.z = Math.PI / 2; t.position.set(0, y + dy, z + dz); truss.add(t);
    }
    for (let x = -40; x < 40; x += 1.6) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.13, 4), tube); d.position.set(x + 0.4, y + 0.4, z); d.rotation.z = Math.PI / 4; truss.add(d);
      const d2 = d.clone(); d2.position.z = z + 0.8; truss.add(d2);
    }
  };
  mkTruss(-28, 15); mkTruss(-48, 19);
  const coneGeo = new THREE.ConeGeometry(2.6, 24, 24, 1, true); coneGeo.translate(0, -12, 0);
  const coneMat = () => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uI: { value: 0.12 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    // centroid + clamps: with MSAA the edges used to extrapolate vUv.y below 0, and pow() of a negative number is NaN
    // on a Mac (Metal fast math); the bloom then smeared it over the whole screen in black
    vertexShader: `centroid varying vec2 vUv; centroid varying vec3 vN; centroid varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `centroid varying vec2 vUv; centroid varying vec3 vN; centroid varying vec3 vV; uniform vec3 uColor; uniform float uI;
      void main(){ float d=clamp(abs(dot(vN,vV)),0.,1.); float l=pow(max(clamp(vUv.y,0.,1.),1e-4),2.2); gl_FragColor=vec4(min(uColor*uI*d*d*l,vec3(8.)),1.); }`,
  });
  const coneMats = [coneMat(), coneMat()];
  const canBody = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.4 });
  const canGeo = new THREE.CylinderGeometry(0.42, 0.5, 1.1, 12);
  const glowPts = [[], []];
  const coneGroup = new THREE.Group();
  [[-28, 14.3, 9], [-48, 18.3, 11]].forEach(([z, y, n], row) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (row === 0 ? 4.4 : 4.8);
      const g = new THREE.Group(); g.position.set(x, y, z + 0.4); g.rotation.set(0.28, 0, rnd(-0.35, 0.35));
      g.add(new THREE.Mesh(canGeo, canBody));
      const cone = new THREE.Mesh(coneGeo, coneMats[row]); cone.position.y = -0.5; g.add(cone);
      truss.add(g);
      g.updateMatrixWorld(true);
      const lens = new THREE.Vector3(0, -0.6, 0).applyMatrix4(g.matrixWorld);
      glowPts[row].push(lens.x, lens.y, lens.z);
    }
  });
  const lensTex = softDotTex();
  const glows = glowPts.map((arr) => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: lensTex, size: 2.4, color: 0xffc080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    bg.add(pts); return pts;
  });

  // haze
  const sTex = smokeTex();
  const haze = [];
  for (let i = 0; i < (isMobile ? 6 : 10); i++) {
    const m = new THREE.SpriteMaterial({ map: sTex, color: 0x6a4028, transparent: true, opacity: rnd(0.1, 0.22), depthWrite: false, fog: true });
    const s = new THREE.Sprite(m); const sc = rnd(16, 30); s.scale.set(sc * 1.6, sc, 1);
    s.position.set(rnd(-30, 30), rnd(2, 16), rnd(-55, -22)); bg.add(s);
    haze.push({ s, v: rnd(-0.4, 0.4), o: m.opacity });
  }

  // embers floating in the light
  const dustN = isMobile ? 90 : 220;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = rnd(-30, 30); dp[i * 3 + 1] = rnd(0, 20); dp[i * 3 + 2] = rnd(-55, 2); }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: softDotTex(), size: 0.18, transparent: true, opacity: 0.6, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false }));
  bg.add(dust);

  // pyro columns (fire on section changes / big streaks)
  const fire = fireFrames(6);
  const pyro = [];
  for (const x of [-7.2, 7.2, -12, 12]) {
    const col = [];
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fire[0], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.center.set(0.5, 0); sp.position.set(x + rnd(-0.3, 0.3), -0.8, -22 - Math.abs(x) * 0.3); sp.scale.set(3, 8, 1);
      sp.visible = false; bg.add(sp); col.push(sp);
    }
    pyro.push({ col, t: 9, x });
  }
  // the stadium's extra pair, further out (never lit anywhere else)
  for (const x of [-16.5, 16.5]) {
    const col = [];
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fire[0], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.center.set(0.5, 0); sp.position.set(x + (k - 1) * 0.25, -0.8, -22 - Math.abs(x) * 0.3); sp.scale.set(3, 8, 1);
      sp.visible = false; bg.add(sp); col.push(sp);
    }
    pyro.push({ col, t: 9, x, wide: true });
  }
  let pyroT = 9;

  // crowd in front of the stage + the band on it (see stagecrew.js); both follow the beat and the song's energy
  const crowd = createCrowd(bg, camera, { max: isMobile ? 56 : 96, room: STAGES.stadium.crowd, dotTex: softDotTex() });
  const band = createBand(bg, { kitPos: kit.position, cymbals: cymList });
  let hype = 0.5, hypeS = 0.5;
  const rimCol = new THREE.Color();

  bg.add(bake(stage));

  /* --- highways: one per player (two side by side when two people share a PC) --- */
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const WHITE = new THREE.Color(1, 1, 1);
  // star-phrase notes stay white and dead notes grey whatever the skin: they tell the player something
  const STAR_HALO = new THREE.Color(0.7, 0.85, 1.1), STAR_WHITE = new THREE.Color(1.5, 1.6, 1.75);
  const DEAD_GEM = new THREE.Color(0x24201e), DEAD_TAIL = new THREE.Color(0x2e2a28);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const cols = (n) => Array.from({ length: n }, () => new THREE.Color());

  // The skin (the looks bought in the shop, see skins.js and setSkin below), worked out into what the frame loop reads:
  // every neck wears the same one. Colours are linear; above 1 they glow (and feed the bloom).
  const sk = {
    ids: resolveSkin(),
    // neck: its self-light (colour, strength) and the strike light, warm and with star power
    board: new THREE.Color(), boardStar: new THREE.Color(), boardEmissive: 0.35, light: new THREE.Color(), lightStar: new THREE.Color(),
    // edges [left, right, strike line], their brightness; strings always lit in their lane colour (0: only when hit)
    edge: cols(3), edgeStar: new THREE.Color(), edgeK: 1, laneGlow: 0,
    // per lane: the colour (caps, string flashes), each gem part, the tails, a glow under the notes (haloSize 0: none)
    lane: cols(5), body: cols(5), dome: cols(5), ring: cols(5), ringLane: false, tail: cols(5), halo: cols(5), haloSize: 0, twinkle: false,
    // hit flames: flipbook, colour per lane, hue going round (0: no); sparks per lane [r,g,b cool, r,g,b hot]
    fire: null, flame: cols(5), flameRainbow: 0, flameK: 1, spark: new Float32Array(30), form: FLAME_FORMS.fire,
    // star power: notes, tails, glows, sparks, the venue's rim light, the ready fire (flipbook + colour); hue going round
    starBody: new THREE.Color(), starDome: new THREE.Color(), starGem: new THREE.Color(), starHalo: new THREE.Color(), starTail: new THREE.Color(),
    starSpark: new Float32Array(6), starRim: new THREE.Color(), ready: null, readyCol: new THREE.Color(), starRainbow: false,
  };
  let previewStar = false; // the shop shows star power on the menus' neck: since when (s), or false
  const DEMO_STAR = { star: true, ready: false }, DEMO_READY = { star: false, ready: true };

  // made once, shared by every neck
  const dotTex = softDotTex();
  const blueFire = fireFrames(6, BLUE_FIRE);
  let paleFire = null; // white fire, tinted per skin through the sprite's colour (made the first time a skin needs it)
  const formFrames = {}; // the other flames' flipbooks (made the first time they're worn)
  let studioEnv = null;
  // neck canvases by id: the one on the necks and the one before it (the shop flips between two); older ones go
  const neckCache = new Map();
  function neckTex(id) {
    let t = neckCache.get(id);
    if (!t) { t = canvasTex(512, 1024, NECKS[id].draw, { repeat: true }); t.repeat.set(1, (HL + 5) / 6); renderer.initTexture(t); }
    neckCache.delete(id); neckCache.set(id, t);
    for (const [k, old] of neckCache) if (neckCache.size > 2 && k !== id) { neckCache.delete(k); old.dispose(); }
    return t;
  }
  const fadeAlpha = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#fff"); gr.addColorStop(0.35, "#000"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { srgb: false });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 1, roughness: 0.18 });
  const railMat = chromeMat.clone(); // the rails take the strings' metal; the button bezels stay chrome
  const railGeo = new THREE.BoxGeometry(0.12, 0.09, HL + 5), edgeGeo = new THREE.BoxGeometry(0.035, 0.02, HL + 5);
  const strGeo = new THREE.CylinderGeometry(0.016, 0.016, HL + 3, 6); strGeo.rotateX(Math.PI / 2);
  const fretGeo = new THREE.BoxGeometry(1, 0.04, 0.08);
  const fretMat = new THREE.MeshStandardMaterial({ color: 0xcfcac0, metalness: 1, roughness: 0.25, emissive: 0x4a4038, emissiveIntensity: 0.5 });
  const strikeGeo = new THREE.BoxGeometry(1, 0.05, 0.22), strikeEdgeGeo = new THREE.BoxGeometry(1, 0.02, 0.03);
  const strikeMat = new THREE.MeshStandardMaterial({ color: 0x0c0b0b, metalness: 0.8, roughness: 0.35 });
  // fret buttons: black housing, chrome bezel, coloured cap, chrome centre stud
  const housingGeo = new THREE.CylinderGeometry(0.47, 0.52, 0.18, 48);
  const bezelGeo = new THREE.TorusGeometry(0.41, 0.06, 16, 48); bezelGeo.rotateX(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.34, 0.36, 0.12, 48);
  const studGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.13, 24);
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.4, roughness: 0.25 });
  // gems: glossy plastic, black base, white band
  const gemBaseGeo = new THREE.CylinderGeometry(0.4, 0.42, 0.09, 32);
  const gemBodyGeo = new THREE.CylinderGeometry(0.35, 0.38, 0.12, 32); gemBodyGeo.translate(0, 0.08, 0);
  const gemDomeGeo = new THREE.SphereGeometry(0.33, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2); gemDomeGeo.scale(1, 0.4, 1); gemDomeGeo.translate(0, 0.14, 0);
  const gemRingGeo = new THREE.TorusGeometry(0.365, 0.04, 10, 40); gemRingGeo.rotateX(Math.PI / 2); gemRingGeo.translate(0, 0.14, 0);
  const tailGeo = new THREE.BoxGeometry(1, 1, 1);
  // the instance colour also lights the part, k times (a uniform: every glowing part shares one shader; the skins set
  // it). Before the shop this waited for USE_INSTANCING_COLOR, which only the vertex shader gets, so nothing ever
  // glowed this way: 0 is today's look.
  const glowInstance = (mat, k) => {
    const u = (mat.userData.glow = { value: k });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uGlow = u;
      s.fragmentShader = "uniform float uGlow;\n" + s.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor * uGlow;\n#endif");
    };
    mat.customProgramCacheKey = () => "glow";
    return mat;
  };
  const gemBaseMat = new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.3, roughness: 0.35 });
  const gemBodyMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.05, roughness: 0.3 }), 0);
  const gemDomeMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.05, roughness: 0.1 }), 0);
  // the white band (lane-coloured and glowing in some skins: white instance colours and no glow by default)
  const gemRingMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xf2eee6, metalness: 0.1, roughness: 0.25, emissive: 0xffffff, emissiveIntensity: 0.12 }), 0);
  // the tamarins' moustaches sway out on the beat (uWig: 0 for every other skin): the lower down the face a hair
  // reaches, the more it flares out to its side and lifts (the gem leans SIT toward the player: "up" the face)
  {
    const wig = (gemRingMat.userData.wig = { value: 0 }), tick = (gemRingMat.userData.tick = { value: 0 }), base = gemRingMat.onBeforeCompile;
    gemRingMat.onBeforeCompile = (s) => {
      base(s);
      s.uniforms.uWig = wig; s.uniforms.uTick = tick;
      s.vertexShader = "uniform float uWig, uTick;\n" + s.vertexShader.replace("#include <begin_vertex>",
        `#include <begin_vertex>\n vec3 up = vec3(0.0, ${Math.sin(SIT).toFixed(4)}, ${(-Math.cos(SIT)).toFixed(4)}), sc = vec3(0.0, ${(0.29 * SIT_LIFT).toFixed(4)}, 0.04);\n`
        + " float droop = 1.0 - smoothstep(-0.5, -0.08, dot(position - sc, up));\n"
        + " transformed += (vec3(sign(position.x) * 0.07, 0.0, 0.0) + up * 0.035) * uWig * droop;\n"
        // the pocket watches' hands turn about the dial's centre (uTick: the minute hand's angle; the hour hand, lower
        // on the dial, a twelfth of it); 0 for every other skin
        + ` vec3 nrm = vec3(0.0, ${Math.cos(SIT).toFixed(4)}, ${Math.sin(SIT).toFixed(4)}); float hgt = dot(position - sc, nrm);\n`
        + " float ta = uTick * (hgt < 0.072 ? 1.0 / 12.0 : 1.0); vec3 tc = sc + nrm * hgt, tv = transformed - tc;\n"
        + " transformed = tc + tv * cos(ta) + cross(nrm, tv) * sin(ta) + nrm * dot(nrm, tv) * (1.0 - cos(ta));");
    };
    gemRingMat.customProgramCacheKey = () => "glow-wig";
  }
  const tailMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }), 0);
  // star-phrase notes are white stars (like the classics), with a glow under them that doesn't need bloom (phones)
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.2 : 0.47; i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2 });
  starGeo.rotateX(-Math.PI / 2); starGeo.translate(0, 0.07, 0);
  const starMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.2, emissive: 0xe4f4ff, emissiveIntensity: 0.95 }), 0);
  const haloGeo = new THREE.PlaneGeometry(1, 1); haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const SPARKS = 240;
  // the Otaku event's golden bananas, floating over some notes (main.js marks them: note.banana)
  const bananaGeo = (() => {
    const parts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, a = -1.05 + u * 2.1, r = 0.05 + 0.055 * Math.sin(Math.PI * (0.08 + 0.84 * u));
      parts.push(new THREE.SphereGeometry(r, 10, 7).translate(Math.sin(a) * 0.3, -Math.cos(a) * 0.3 + 0.3, 0));
    }
    const stem = new THREE.CylinderGeometry(0.018, 0.026, 0.07, 6); stem.rotateZ(-1.2); stem.translate(-Math.sin(1.05) * 0.3 - 0.04, -Math.cos(1.05) * 0.3 + 0.32, 0);
    const g = mergeGeometries([...parts.map((p) => p.toNonIndexed()), stem.toNonIndexed()]);
    g.computeVertexNormals(); return g;
  })();
  const BANANA_GLOW = new THREE.Color(1.1, 0.8, 0.15);
  const bananaMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, metalness: 0.35, roughness: 0.28, emissive: 0xffa010, emissiveIntensity: 0.55 });

  // Gem shapes for the skins (parts: base, body, dome, ring; no ring: hidden). Same footprint (radius about .42) and
  // height (top about .27) as the round ones, so the timing reads the same; made the first time they're worn.
  const gemShapes = { round: { base: gemBaseGeo, body: gemBodyGeo, dome: gemDomeGeo, ring: gemRingGeo } };
  const flat = (g) => { const n = g.toNonIndexed(); n.computeVertexNormals(); g.dispose(); return n; }; // facets
  const at = (g, y, ry = 0) => { if (ry) g.rotateY(ry); g.translate(0, y, 0); return g; };
  function gemShape(key) {
    if (gemShapes[key]) return gemShapes[key];
    let G;
    if (key === "square") {
      // rounded squares: a flat slab, a pillow on top, a frame for the band
      const rsq = (r, c, hole) => {
        const s = new THREE.Shape();
        s.moveTo(-r + c, -r); s.lineTo(r - c, -r); s.absarc(r - c, -r + c, c, -Math.PI / 2, 0); s.lineTo(r, r - c); s.absarc(r - c, r - c, c, 0, Math.PI / 2);
        s.lineTo(-r + c, r); s.absarc(-r + c, r - c, c, Math.PI / 2, Math.PI); s.lineTo(-r, -r + c); s.absarc(-r + c, -r + c, c, Math.PI, Math.PI * 1.5);
        if (hole) s.holes.push(rsq(...hole));
        return s;
      };
      const slab = (shape, depth, y, bevel = 0) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 4, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3 });
        g.rotateX(-Math.PI / 2); return at(g, y);
      };
      G = { base: slab(rsq(0.39, 0.12), 0.09, -0.045), body: slab(rsq(0.34, 0.1), 0.12, 0.02), dome: slab(rsq(0.28, 0.08), 0.02, 0.16, 0.06), ring: slab(rsq(0.37, 0.11, [0.315, 0.08]), 0.05, 0.115) };
    } else if (key === "pixel") {
      // 8-bit: stepped "circles" of blocks, a white pixel of shine
      const disc = (r, h, y) => mergeGeometries([[2, 1.15], [1.6, 1.6], [1.15, 2]].map(([a, b]) => new THREE.BoxGeometry(r * a, h, r * b).translate(0, y, 0)));
      G = { base: disc(0.42, 0.09, 0), body: disc(0.37, 0.12, 0.08), dome: disc(0.27, 0.08, 0.17), ring: new THREE.BoxGeometry(0.12, 0.03, 0.12).translate(-0.13, 0.215, -0.13) };
    } else if (key === "crystal") {
      // a cut stone: octagonal, faceted, a table on top
      G = {
        base: flat(at(new THREE.CylinderGeometry(0.4, 0.42, 0.09, 8), 0)), body: flat(at(new THREE.CylinderGeometry(0.36, 0.39, 0.12, 8), 0.08)),
        dome: flat(at(new THREE.CylinderGeometry(0.17, 0.36, 0.13, 8), 0.205, Math.PI / 8)), ring: null,
      };
    } else if (key === "vinyl") {
      // a record: a wide black disc with grooves (the band's part), the label in the lane colour in the middle
      const cyl = (r, h, y) => at(new THREE.CylinderGeometry(r, r, h, 40), y);
      const grooves = [0.29, 0.335, 0.38].map((r) => { const t = new THREE.TorusGeometry(r, 0.008, 4, 48); t.rotateX(Math.PI / 2); return at(t, 0.1); });
      G = { base: cyl(0.43, 0.05, 0), body: cyl(0.42, 0.07, 0.06), dome: cyl(0.25, 0.035, 0.11), ring: mergeGeometries(grooves) };
    } else if (key === "chrome") {
      // a chrome hubcap: a domed mirror rim, a stepped bezel, a coloured lens in the middle
      const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
      G = {
        base: lathe([[0.001, -0.05], [0.42, -0.05], [0.43, 0.0], [0.41, 0.04], [0.001, 0.04]]),
        body: lathe([[0.001, 0.03], [0.41, 0.03], [0.4, 0.09], [0.35, 0.15], [0.27, 0.18], [0.001, 0.18]]),
        ring: lathe([[0.2, 0.17], [0.27, 0.175], [0.27, 0.205], [0.2, 0.215]]),
        dome: lathe([[0.001, 0.17], [0.2, 0.17], [0.19, 0.22], [0.12, 0.255], [0.001, 0.265]]),
      };
    } else if (key === "macaron") {
      // a macaron: a bottom shell with its rough "foot", the cream, a domed top shell
      const lathe = (pts, seg = 36) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
      G = {
        base: lathe([[0.001, -0.03], [0.36, -0.03], [0.37, 0.0], [0.001, 0.0]]),
        body: lathe([[0.001, 0.0], [0.33, 0.0], [0.38, 0.02], [0.39, 0.05], [0.4, 0.07], [0.37, 0.095], [0.001, 0.095]]),
        ring: lathe([[0.001, 0.085], [0.36, 0.085], [0.385, 0.115], [0.36, 0.15], [0.001, 0.15]]),
        dome: lathe([[0.001, 0.145], [0.37, 0.145], [0.4, 0.162], [0.395, 0.19], [0.35, 0.23], [0.22, 0.262], [0.001, 0.272]]),
      };
    } else if (key === "candy") {
      // a wrapped candy: a glossy oval, a white swirl on it (the dome's part), the twisted wrapper at both ends (the base)
      const rx = 0.27, ry = 0.13, rz = 0.22, cy = 0.13;
      const body = new THREE.SphereGeometry(1, 28, 18); body.scale(rx, ry, rz); body.translate(0, cy, 0);
      const swirl = [];
      for (let j = 0; j < 5; j++) {
        const pts = [];
        for (let k = 0; k <= 24; k++) {
          const t = k / 24, th = 0.08 + t * 1.45, ph = (j / 5) * Math.PI * 2 + t * 2.4;
          pts.push(new THREE.Vector3(rx * Math.sin(th) * Math.cos(ph) * 1.02, cy + ry * Math.cos(th) * 1.04, rz * Math.sin(th) * Math.sin(ph) * 1.02));
        }
        swirl.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.028, 5));
      }
      const wrap = [-1, 1].flatMap((k) => {
        const pinch = new THREE.CylinderGeometry(0.035, 0.05, 0.06, 10); pinch.rotateZ(Math.PI / 2); pinch.translate(k * 0.28, cy, 0);
        // the frilly fan of cellophane: a flattened cone, opening out, with pleats
        const fan = new THREE.ConeGeometry(0.17, 0.17, 12, 1, true); fan.rotateZ(k * Math.PI / 2); fan.scale(1, 0.75, 1); fan.translate(k * 0.36, cy, 0);
        const pos = fan.attributes.position;
        for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getY(i) - cy); const r = 1 + 0.18 * Math.sin(a * 6); pos.setY(i, cy + (pos.getY(i) - cy) * r); pos.setZ(i, pos.getZ(i) * r); }
        fan.computeVertexNormals();
        return [pinch, fan];
      });
      G = { base: mergeGeometries(wrap.map((g) => g.index ? g.toNonIndexed() : g)), body, dome: mergeGeometries(swirl), ring: null };
    } else if (key === "titi") {
      // an emperor tamarin, as in the photos: a round furry head in the lane colour with two small ears, the black face
      // (in the base's piece, with the eyes and the nostrils), the pink muzzle (the dome) and the long white moustache
      // falling from it down past the chin on both sides, a wisp of beard (the band's part: it sways with the music,
      // renderer uWig). It sits up like the kittens, toward the player.
      const slab = (shape, depth, y, bevel = 0) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 14, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3 });
        g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
        g.rotateX(SIT); g.translate(0, 0.29 * SIT_LIFT, 0.04); return g;
      };
      const ellipse = (x, y, rx, ry) => { const s = new THREE.Shape(); s.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, 0); return s; };
      const poly = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };
      // the head's outline: round, ragged with tufts of fur
      const furry = (r) => poly(Array.from({ length: 44 }, (_, i) => {
        const a = (i / 44) * Math.PI * 2, k = r * (i % 2 ? 1.07 : 1) * (1 + 0.05 * Math.sin(a * 3 + 1));
        return [Math.cos(a) * k, 0.1 + Math.sin(a) * k * 0.94];
      }));
      // a stroke of a curve as a filled shape, thick at its root, thin at its tip
      const strand = (pts, w0, w1) => {
        const L = [], R = [];
        pts.forEach(([x, y], i) => {
          const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
          const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
          L.push([x - (dy / l) * w, y + (dx / l) * w]); R.push([x + (dy / l) * w, y - (dx / l) * w]);
        });
        return poly([...L, ...R.reverse()]);
      };
      const curve = (k, pts) => new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(k * x, y, 0))).getPoints(20).map((v) => [v.x, v.y]);
      const hairs = [-1, 1].flatMap((k) => [
        strand(curve(k, [[0.03, -0.06], [0.15, -0.08], [0.26, -0.13], [0.32, -0.25], [0.33, -0.39], [0.36, -0.5]]), 0.08, 0.014),
        strand(curve(k, [[0.04, -0.08], [0.14, -0.11], [0.22, -0.19], [0.25, -0.32], [0.28, -0.43]]), 0.05, 0.012),
        strand(curve(k, [[0.04, -0.1], [0.11, -0.15], [0.16, -0.24], [0.18, -0.34]]), 0.035, 0.01),
      ]);
      const shine = [-1, 1].map((k) => ellipse(k * 0.085 + 0.013, 0.088, 0.017, 0.017));
      // the black face: brow to chin, wider at the cheeks
      const face = poly(curve(1, [[0, 0.22], [0.15, 0.2], [0.23, 0.08], [0.21, -0.07], [0.13, -0.16], [0, -0.19], [-0.13, -0.16], [-0.21, -0.07], [-0.23, 0.08], [-0.15, 0.2], [0, 0.22]]));
      G = {
        base: mergeGeometries([slab(furry(0.335), 0.09, -0.045), ...[-1, 1].map((k) => slab(ellipse(k * 0.3, 0.24, 0.085, 0.095), 0.09, -0.045)),
          slab(face, 0.02, 0.16, 0.012), ...[-1, 1].map((k) => slab(ellipse(k * 0.085, 0.075, 0.042, 0.04), 0.02, 0.18, 0.012)),
          ...[-1, 1].map((k) => slab(ellipse(k * 0.022, -0.035, 0.012, 0.009), 0.015, 0.225)), slab(ellipse(0, -0.085, 0.04, 0.008), 0.015, 0.225)]),
        body: mergeGeometries([slab(furry(0.3), 0.12, 0.02, 0.02), ...[-1, 1].map((k) => slab(ellipse(k * 0.3, 0.24, 0.055, 0.065), 0.12, 0.02, 0.015))]),
        dome: slab(ellipse(0, -0.055, 0.075, 0.06), 0.03, 0.18, 0.015),
        ring: mergeGeometries([...hairs.map((h) => slab(h, 0.02, 0.2)), ...shine.map((s) => slab(s, 0.02, 0.21))]),
      };
    } else if (key === "scarab") {
      // Powerslave's sacred scarab: the lane-coloured wing cases (the band's part: they open out on the beat, renderer
      // uWig), a golden head and thorax, the sun disk held up above it (the dome, glowing), six bronze legs (the base).
      // It sits up like the tamarins, toward the player.
      const slab = (shape, depth, y, bevel = 0) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 14, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3 });
        g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
        g.rotateX(SIT); g.translate(0, 0.29 * SIT_LIFT, 0.04); return g;
      };
      const ellipse = (x, y, rx, ry, rot = 0) => { const s = new THREE.Shape(); s.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, rot); return s; };
      const poly = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };
      const leg = (pts, w) => {
        const L = [], R = [];
        pts.forEach(([x, y], i) => {
          const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
          const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
          L.push([x - (dy / l) * w / 2, y + (dx / l) * w / 2]); R.push([x + (dy / l) * w / 2, y - (dx / l) * w / 2]);
        });
        return poly([...L, ...R.reverse()]);
      };
      const legs = [-1, 1].flatMap((k) => [
        leg([[k * 0.1, 0.06], [k * 0.24, 0.14], [k * 0.3, 0.26]], 0.035),
        leg([[k * 0.14, -0.06], [k * 0.3, -0.05], [k * 0.38, -0.14]], 0.035),
        leg([[k * 0.13, -0.2], [k * 0.27, -0.3], [k * 0.3, -0.42]], 0.035),
      ]);
      G = {
        base: mergeGeometries([slab(ellipse(0, -0.12, 0.25, 0.3), 0.08, -0.04), ...legs.map((l) => slab(l, 0.06, -0.02))]),
        body: mergeGeometries([slab(ellipse(0, 0.07, 0.16, 0.1), 0.12, 0.02, 0.02), slab(ellipse(0, 0.2, 0.09, 0.06), 0.1, 0.02, 0.02),
          ...[-1, 1].map((k) => slab(poly([[k * 0.04, 0.24], [k * 0.13, 0.31], [k * 0.07, 0.22]]), 0.06, 0.04))]),
        dome: slab(ellipse(0, 0.36, 0.085, 0.085), 0.05, 0.06, 0.02),
        ring: mergeGeometries([-1, 1].map((k) => slab(ellipse(k * 0.085, -0.18, 0.105, 0.23, k * 0.08), 0.06, 0.06, 0.025))),
      };
    } else if (key === "watch") {
      // Somewhere in Time's pocket watch: the brass case back, its crown and bow on top and the hour marks (the base),
      // the bezel in the lane colour (the body), the cream dial (the dome) and the hands (the ring: they tick on with
      // the beat, renderer uTick). It sits up like the scarabs, toward the player.
      const slab = (shape, depth, y, bevel = 0) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 24, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3 });
        g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
        g.rotateX(SIT); g.translate(0, 0.29 * SIT_LIFT, 0.04); return g;
      };
      const disc = (r, hole = 0) => { const sh = new THREE.Shape(); sh.absarc(0, 0, r, 0, Math.PI * 2, false); if (hole) { const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); sh.holes.push(h); } return sh; };
      const ringAt = (x, y, r, hole) => { const sh = new THREE.Shape(); sh.absarc(x, y, r, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(x, y, hole, 0, Math.PI * 2, true); sh.holes.push(h); return sh; };
      const rect = (cx, cy, w, h, rot = 0) => { const sh = new THREE.Shape(), c = Math.cos(rot), sn = Math.sin(rot); [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].forEach(([x, y], i) => { const px = cx + x * c - y * sn, py = cy + x * sn + y * c; i ? sh.lineTo(px, py) : sh.moveTo(px, py); }); return sh; };
      const hand = (len, w, rot) => { const sh = new THREE.Shape(), c = Math.cos(rot), sn = Math.sin(rot); [[0, -0.04], [w, 0], [0, len], [-w, 0]].forEach(([x, y], i) => { const px = x * c - y * sn, py = x * sn + y * c; i ? sh.lineTo(px, py) : sh.moveTo(px, py); }); return sh; };
      const marks = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, big = i % 3 === 0, r = big ? 0.195 : 0.205; return rect(Math.sin(a) * r, Math.cos(a) * r, big ? 0.03 : 0.016, big ? 0.06 : 0.035, -a); });
      G = {
        base: mergeGeometries([slab(disc(0.3), 0.06, -0.03), slab(rect(0, 0.325, 0.07, 0.07), 0.05, -0.02), slab(ringAt(0, 0.4, 0.075, 0.045), 0.035, -0.01, 0.01),
          ...marks.map((m) => slab(m, 0.012, 0.045))]),
        body: slab(disc(0.31, 0.245), 0.06, 0.0, 0.015),
        dome: slab(disc(0.25), 0.02, 0.02),
        ring: mergeGeometries([slab(hand(0.13, 0.028, 2.1), 0.012, 0.06), slab(hand(0.2, 0.02, -0.5), 0.012, 0.075), slab(disc(0.025), 0.02, 0.06)]),
      };
    } else if (key === "cat") {
      // a kitten's head: round, two ears, a pale muzzle (dome) and the face (the band's part, dark: eyes, nose and
      // whiskers). Flat it would be seen almost edge-on, so it sits up (SIT), tilted toward the player, its chin on the neck.
      const rad = (d) => (d * Math.PI) / 180;
      const head = (r) => {
        const s = new THREE.Shape(), p = (d, k = 1) => [Math.cos(rad(d)) * r * k, Math.sin(rad(d)) * r * k * 0.9];
        const pts = [];
        for (let d = 0; d < 360; d += 6) {
          if ((d > 36 && d < 72) || (d > 108 && d < 144)) continue;
          pts.push(p(d));
          if (d === 36) pts.push(p(58, 1.42));
          if (d === 108) pts.push(p(122, 1.42));
        }
        pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
        return s;
      };
      const ellipse = (x, y, rx, ry) => { const s = new THREE.Shape(); s.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, 0); return s; };
      const poly = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };
      const slab = (shape, depth, y, bevel = 0) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 10, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3 });
        g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
        g.rotateX(SIT); g.translate(0, 0.25 * SIT_LIFT, 0.04); return g;
      };
      const whisker = (x0, y0, x1, y1) => {
        const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = (-dy / l) * 0.009, ny = (dx / l) * 0.009;
        return poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
      };
      const face = [
        slab(ellipse(-0.13, 0.04, 0.062, 0.078), 0.03, 0.15), slab(ellipse(0.13, 0.04, 0.062, 0.078), 0.03, 0.15),
        slab(poly([[-0.05, -0.055], [0.05, -0.055], [0, -0.11]]), 0.025, 0.2),
        ...[-1, 1].flatMap((k) => [whisker(k * 0.15, -0.1, k * 0.42, -0.05), whisker(k * 0.15, -0.12, k * 0.43, -0.13), whisker(k * 0.15, -0.14, k * 0.4, -0.21)].map((w) => slab(w, 0.02, 0.135))),
      ];
      G = { base: slab(head(0.37), 0.09, -0.045), body: slab(head(0.33), 0.12, 0.02, 0.02), dome: slab(ellipse(0, -0.11, 0.16, 0.09), 0.02, 0.14, 0.03), ring: mergeGeometries(face) };
    } else {
      // diamond: a white girdle and crown, the lane colour in the table and through it
      G = {
        base: flat(at(new THREE.CylinderGeometry(0.4, 0.42, 0.06, 16), -0.01)), body: flat(at(new THREE.CylinderGeometry(0.39, 0.4, 0.07, 16), 0.055)),
        ring: flat(at(new THREE.CylinderGeometry(0.21, 0.39, 0.12, 16, 1, true), 0.15, Math.PI / 16)), dome: flat(at(new THREE.CylinderGeometry(0.21, 0.27, 0.09, 8), 0.2)),
      };
    }
    return (gemShapes[key] = G);
  }

  /** Works the skin's ids out into `sk` and the shared materials (uniforms only: nothing recompiles). */
  function buildSkin(ids) {
    const N = NECKS[ids.neck], Gm = GEMS[ids.gems], F = FLAMES[ids.flames], St = STRINGS[ids.strings], Sp = STARS[ids.star];
    sk.ids = ids;
    // neck
    sk.board.setHex(N.tint ?? 0xffffff); sk.boardEmissive = N.emissive; sk.light.setHex(N.light ?? 0xffa860);
    // strings, rails, beat bars, edges
    railMat.color.setHex(St.rail[0]); railMat.metalness = St.rail[1]; railMat.roughness = St.rail[2];
    fretMat.color.setHex(St.fret[0]); fretMat.metalness = St.fret[1]; fretMat.roughness = St.fret[2]; fretMat.emissive.setHex(St.fretGlow);
    St.edges.forEach((c, j) => sk.edge[j].setHex(c));
    sk.edgeK = St.k; sk.laneGlow = St.laneGlow || 0;
    // gems: each part's colour per lane, worked out once (the frame loop only copies)
    const mix = (out, i, p, def = 0) => out.setHex(Gm.lanes[i]).lerp(tmpC.setHex(p.to ?? 0xffffff), p.mix ?? def).multiplyScalar(p.mul ?? 1);
    for (let i = 0; i < 5; i++) {
      sk.lane[i].setHex(Gm.lanes[i]);
      mix(sk.body[i], i, Gm.body); mix(sk.dome[i], i, Gm.dome, 0.1);
      if (Gm.ring.lane != null) mix(sk.ring[i], i, { mix: Gm.ring.lane, mul: Gm.ring.mul }); else sk.ring[i].copy(WHITE);
      sk.tail[i].copy(sk.lane[i]).multiplyScalar(Gm.tail ?? 1);
      if (Gm.halo) mix(sk.halo[i], i, Gm.halo);
    }
    sk.ringLane = Gm.ring.lane != null; sk.haloSize = Gm.halo ? Gm.halo.size : 0; sk.twinkle = !!Gm.halo?.twinkle;
    sk.wig = Gm.shape === "titi" || Gm.shape === "scarab"; // their bands move on the beat (moustaches, wing cases)
    sk.tick = Gm.shape === "watch"; // the watches' hands tick on with the beat
    sk.pet = PETS[ids.pet] || null;
    const fin = (m, p, glow) => {
      m.metalness = p.metal; m.roughness = p.rough;
      if (p.color != null) m.color.setHex(p.color);
      if (m.emissive) { m.emissive.setHex(p.emissive ?? 0); m.emissiveIntensity = p.ei ?? 0; }
      if (m.userData.glow) m.userData.glow.value = glow;
    };
    fin(gemBodyMat, Gm.body, Gm.body.glow ?? 0); fin(gemDomeMat, Gm.dome, Gm.dome.glow ?? 0); tailMat.userData.glow.value = Gm.tailGlow ?? 0;
    // mirror skins reflect a little studio (lights above, the warm stage below); the others nothing (as ever)
    const env = Gm.mirror ? studioEnv || (studioEnv = studioTex()) : null;
    for (const m of [gemBodyMat, gemRingMat, gemBaseMat]) if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; }
    fin(gemRingMat, Gm.ring, Gm.ring.glow ?? 0); fin(gemBaseMat, Gm.base, 0);
    // hit flames: today's fire, or white fire in a colour (per lane, or going round the colour wheel)
    const form = F.form || "fire";
    sk.form = FLAME_FORMS[form];
    const own = form === "campfire" || form === "embers" || form === "antimagic" || form === "pyramid" || form === "frost"; // drawn in their own colours
    if (own) { sk.fire = formFrames[form] || (formFrames[form] = flameFrames(form)); sk.flame.forEach((c) => c.copy(WHITE)); }
    else if (F.tint == null && !F.lane && !F.rainbow) { sk.fire = fire; sk.flame.forEach((c) => c.copy(WHITE)); }
    else {
      sk.fire = form === "fire" ? paleFire || (paleFire = fireFrames(6, PALE_FIRE)) : formFrames[form] || (formFrames[form] = flameFrames(form));
      for (let i = 0; i < 5; i++) flameColor(i, F.lane ? tmpC.setHex(Gm.lanes[i]) : tmpC.setHex(F.tint ?? 0xffffff), F.k);
    }
    sk.flameRainbow = F.rainbow ? 1 : 0; sk.flameK = F.k ?? 1;
    if (own || (F.tint == null && !F.lane && !F.rainbow)) for (let i = 0; i < 5; i++) sk.spark.set(form === "embers" ? [1, 0.12, 0.02, 1, 0.6, 0.15] : form === "antimagic" ? [0.9, 0.02, 0.06, 1, 0.35, 0.3] : [1, 0.45, 0, 1, 0.95, 0.35], i * 6); // warm sparks
    // star power
    sk.starRainbow = !!Sp.rainbow;
    if (Sp.hue == null) {
      // today's electric blue, exactly
      sk.starBody.setRGB(0.1, 1.15, 2.6); sk.starDome.setRGB(0.75, 1.9, 2.8); sk.starGem.setRGB(0.55, 1.5, 2.6); sk.starHalo.setRGB(0.15, 0.7, 1.25); sk.starTail.setRGB(0.15, 1.1, 2.4);
      sk.boardStar.setHex(0x7cc6ff); sk.edgeStar.setHex(0x6fd8ff); sk.lightStar.setHex(0x5ab8ff); sk.starRim.setHex(0x3fb4ff).multiplyScalar(1.1);
      sk.starSpark.set([0.35, 0.75, 1, 0.65, 0.95, 1]); sk.ready = blueFire; sk.readyCol.copy(WHITE);
    } else starColors(tmpC.setHex(Sp.hue));
  }
  const PALE_FIRE = [[255, 255, 255], [236, 236, 236], [196, 196, 196], [140, 140, 140]];
  const hue = new THREE.Color();
  // a flame's colour from a hue: k above 1 burns hotter (the white core shows); its sparks go from that colour to white
  function flameColor(i, c, k = 1) {
    const m = Math.max(c.r, c.g, c.b, 1e-4);
    hue.setRGB(c.r / m, c.g / m, c.b / m);
    sk.flame[i].copy(hue).lerp(WHITE, 0.12).multiplyScalar(k);
    sparkRange(sk.spark, i * 6, 0, 0.6);
  }
  // sparks from the hue: [cool r,g,b, hot r,g,b] at o, mixed towards white by a and b (no allocation: runs per frame)
  function sparkRange(out, o, a, b) {
    out[o] = hue.r + (1 - hue.r) * a; out[o + 1] = hue.g + (1 - hue.g) * a; out[o + 2] = hue.b + (1 - hue.b) * a;
    out[o + 3] = hue.r + (1 - hue.r) * b; out[o + 4] = hue.g + (1 - hue.g) * b; out[o + 5] = hue.b + (1 - hue.b) * b;
  }
  // every star power colour from one hue (the shades today's blue has, a little less white so warm hues stay saturated)
  function starColors(c) {
    const m = Math.max(c.r, c.g, c.b, 1e-4);
    hue.setRGB(c.r / m, c.g / m, c.b / m);
    sk.starBody.copy(hue).multiplyScalar(1.9); sk.starDome.copy(hue).lerp(WHITE, 0.1).multiplyScalar(2.1); sk.starGem.copy(hue).lerp(WHITE, 0.15).multiplyScalar(2.2);
    sk.starHalo.copy(hue).multiplyScalar(1.25); sk.starTail.copy(hue).multiplyScalar(2);
    sk.boardStar.copy(hue).lerp(WHITE, 0.18); sk.edgeStar.copy(hue).lerp(WHITE, 0.25); sk.lightStar.copy(hue).lerp(WHITE, 0.05); sk.starRim.copy(hue).multiplyScalar(1.1);
    sparkRange(sk.starSpark, 0, 0.4, 0.75);
    sk.ready = paleFire || (paleFire = fireFrames(6, PALE_FIRE)); sk.readyCol.copy(hue).lerp(WHITE, 0.15).multiplyScalar(1.5);
  }

  function createHighway() {
    const hwy = new THREE.Group(); scene.add(hwy);
    const h = { group: hwy, lanes: 5, starGlow: 0, readyGlow: 0, phraseT: 9, sparkStar: false };
    const laneX = (i) => (i - (h.lanes - 1) / 2) * LW;
    h.laneX = laneX;
    h.width = () => h.lanes * LW + 0.5;

    // the light over the strike line (warm; blue with star power)
    const strikeLight = new THREE.PointLight(0xffa860, 1.6, 5, 1.8); strikeLight.position.set(0, 1.3, 0.8); hwy.add(strikeLight);

    // the neck's own copy of the skin's canvas (each neck scrolls it at its own speed)
    let boardTex = null;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1, HL + 5), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.35 }));
    board.rotation.x = -Math.PI / 2; board.position.set(0, 0, -HL / 2 + 2.5); hwy.add(board);
    // fade the far end of the neck into darkness
    const fade = new THREE.Mesh(new THREE.PlaneGeometry(1, 8), new THREE.MeshBasicMaterial({ color: 0x070403, transparent: true, depthWrite: false, alphaMap: fadeAlpha }));
    fade.rotation.x = -Math.PI / 2; fade.position.set(0, 0.2, -HL + 3.6); hwy.add(fade);

    // glowing edges: left, right and along the strike line (one colour each, so a skin can make them two-tone)
    const edgeMats = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff2e0, emissiveIntensity: 0.55 }));
    const rails = [-1, 1].map(() => { const m = new THREE.Mesh(railGeo, railMat); m.position.set(0, 0.04, -HL / 2 + 2.5); hwy.add(m); return m; });
    const edges = [0, 1].map((j) => { const m = new THREE.Mesh(edgeGeo, edgeMats[j]); m.position.set(0, 0.1, -HL / 2 + 2.5); hwy.add(m); return m; });

    // strings (silver; flash the lane colour when hit)
    const strings = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xbdb8b0, metalness: 1, roughness: 0.22, emissive: 0x000000, emissiveIntensity: 1 });
      const s = new THREE.Mesh(strGeo, mat); s.position.set(0, 0.07, -HL / 2 + 1.5); hwy.add(s);
      strings.push({ mesh: s, vib: 0, glow: 0 });
    }

    // metal fret bars on the beat
    const frets = new THREE.InstancedMesh(fretGeo, fretMat, 64);
    frets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); hwy.add(frets);

    // strikeline bar
    const strikeBar = new THREE.Mesh(strikeGeo, strikeMat); strikeBar.position.set(0, 0.03, 0); hwy.add(strikeBar);
    const strikeEdge = new THREE.Mesh(strikeEdgeGeo, edgeMats[2]); strikeEdge.position.set(0, 0.07, -0.12); hwy.add(strikeEdge);

    const buttons = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const housing = new THREE.Mesh(housingGeo, housingMat); housing.position.y = 0.07;
      const bezel = new THREE.Mesh(bezelGeo, chromeMat); bezel.position.y = 0.16;
      const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: LANE_HEX[i], metalness: 0.1, roughness: 0.2, emissive: LANE_HEX[i], emissiveIntensity: 0.12 }));
      const stud = new THREE.Mesh(studGeo, new THREE.MeshStandardMaterial({ color: 0xdedad2, metalness: 1, roughness: 0.15, emissive: 0xffffff, emissiveIntensity: 0 }));
      cap.position.y = 0.2; stud.position.y = 0.21;
      g.add(housing, bezel, cap, stud); g.scale.setScalar(0.92);
      hwy.add(g);
      buttons.push({ g, cap, stud, press: 0 });
    }

    const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, MAX_GEMS); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; hwy.add(m); return m; };
    const gemBase = mk(gemBaseGeo, gemBaseMat), gemBody = mk(gemBodyGeo, gemBodyMat), gemDome = mk(gemDomeGeo, gemDomeMat), gemRing = mk(gemRingGeo, gemRingMat);
    const tails = mk(tailGeo, tailMat), starGem = mk(starGeo, starMat), halos = mk(haloGeo, haloMat), bananas = mk(bananaGeo, bananaMat);
    halos.renderOrder = 2;
    [gemBody, gemDome, gemRing, tails, starGem, halos].forEach((m) => m.setColorAt(0, new THREE.Color()));

    // hit fire + sparks
    const flames = [];
    let starTex = null;
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fire[0], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.center.set(0.5, 0.04); hwy.add(sp); flames.push({ sp, t: 9, f: 0 });
    }
    // the pet (shop: Mascotas) sits by the neck, at the strike line on the right, where no note ever passes
    const pet = { g: null, id: null, x: 0, flap: 0, sleepy: 0 };
    // star power ready: blue fire burning at both ends of the strike line
    const readyFire = [];
    for (let k = 0; k < 4; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: blueFire[k % 6], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.center.set(0.5, 0.04); sp.visible = false; hwy.add(sp); readyFire.push(sp);
    }
    // star phrase completed: a white flash over every fret
    const flares = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xeaf6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.visible = false; hwy.add(sp); flares.push(sp);
    }
    const sparkGeo = new THREE.BufferGeometry();
    const spPos = new Float32Array(SPARKS * 3), spCol = new Float32Array(SPARKS * 3);
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    sparkGeo.setAttribute("color", new THREE.BufferAttribute(spCol, 3));
    const sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS), sparkG = new Float32Array(SPARKS);
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.1, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; hwy.add(sparks);
    let sparkIdx = 0;
    // star: sparks in the star power colour (default: the lane's flame colour, from cool to hot)
    function burst(x, n, white = false, star = false, power = 1, lane = 0) {
      const c = h.sparkStar || star ? sk.starSpark : sk.spark, o = h.sparkStar || star ? 0 : lane * 6;
      // a hit's sparks fly the way its flame's do (fogata: up into the air, brasas: falling coals...); the white ones as ever
      const S = white || star ? FLAME_FORMS.fire.spark : sk.form.spark;
      if (!white && !star) n = Math.round(n * S.n);
      for (let k = 0; k < n; k++) {
        const i = sparkIdx++ % SPARKS;
        spPos[i * 3] = x + rnd(-0.25, 0.25); spPos[i * 3 + 1] = 0.25; spPos[i * 3 + 2] = rnd(-0.1, 0.1);
        if (S.radial) { const a = rnd(0, Math.PI * 2), v = rnd(0.6, 1) * S.radial; sparkVel[i * 3] = Math.cos(a) * v; sparkVel[i * 3 + 1] = Math.sin(a) * v * 0.8 + 1; }
        else { sparkVel[i * 3] = rnd(-S.vx, S.vx) * power; sparkVel[i * 3 + 1] = rnd(S.vy[0], S.vy[1]) * power; }
        sparkVel[i * 3 + 2] = rnd(-0.6, 1.2);
        sparkLife[i] = rnd(S.life[0], S.life[1]) * Math.sqrt(power); sparkG[i] = S.g;
        const hot = Math.random();
        if (white) { spCol[i * 3] = 0.85 + hot * 0.15; spCol[i * 3 + 1] = 0.92 + hot * 0.08; spCol[i * 3 + 2] = 1; }
        else for (let j = 0; j < 3; j++) spCol[i * 3 + j] = c[o + j] + hot * (c[o + 3 + j] - c[o + j]);
      }
    }

    /** Puts on the skin in `sk` (buildSkin): the neck's canvas, gem shapes, colours that are set once. */
    h.applySkin = () => {
      const N = NECKS[sk.ids.neck], base = neckTex(sk.ids.neck);
      if (!boardTex || boardTex.source !== base.source) {
        // a copy shares the uploaded canvas; cloning marks it changed, which would upload it all over again
        const v = base.source.version, t = base.clone(); t.source.version = v;
        board.material.map = board.material.emissiveMap = t;
        boardTex?.dispose(); boardTex = t;
      }
      board.material.roughness = N.rough ?? 0.5; board.material.metalness = N.metal ?? 0.05;
      const G = gemShape(GEMS[sk.ids.gems].shape);
      gemBase.geometry = G.base; gemBody.geometry = G.body; gemDome.geometry = G.dome;
      gemRing.visible = !!G.ring; if (G.ring) gemRing.geometry = G.ring;
      const S = STRINGS[sk.ids.strings];
      for (let i = 0; i < 5; i++) {
        const m = strings[i].mesh.material; m.color.setHex(S.string[0]); m.metalness = S.string[1]; m.roughness = S.string[2];
        const cap = buttons[i].cap.material; cap.color.copy(sk.lane[i]); cap.emissive.copy(sk.lane[i]);
        flames[i].sp.material.color.copy(sk.flame[i]);
        flames[i].sp.center.set(0.5, sk.form.look[5]);
        const blend = sk.form.blend === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (flames[i].sp.material.blending !== blend) { flames[i].sp.material.blending = blend; flames[i].sp.material.needsUpdate = true; }
      }
      sparks.material.map = sk.form.spark.star ? starTex || (starTex = starDotTex()) : dotTex;
      sparks.material.size = sk.form.spark.star ? 0.2 : 0.1;
    };

    h.layout = (n) => {
      h.lanes = n;
      const w = h.width();
      board.scale.x = w; fade.scale.x = w + 0.6;
      rails[0].position.x = -w / 2 - 0.04; rails[1].position.x = w / 2 + 0.04;
      edges[0].position.x = -w / 2 + 0.06; edges[1].position.x = w / 2 - 0.06;
      strikeBar.scale.x = w; strikeEdge.scale.x = w;
      for (let i = 0; i < 5; i++) {
        const on = i < n;
        strings[i].mesh.visible = on; buttons[i].g.visible = on;
        strings[i].mesh.position.x = laneX(i); buttons[i].g.position.set(laneX(i), 0, 0);
        flames[i].sp.position.set(laneX(i), 0.15, 0.05);
        // a lane that goes away must not leave its fire behind (the frame loop only animates the active lanes)
        if (!on) { flames[i].t = 9; flames[i].sp.visible = false; flames[i].sp.material.opacity = 0; }
        flares[i].position.set(laneX(i), 0.3, 0.05); if (!on) flares[i].visible = false;
      }
      pet.x = w / 2 + 0.5; // right of the neck: the shop and the menus cover its left
      readyFire.forEach((sp, k) => sp.position.set((k % 2 ? 1 : -1) * (w / 2 + 0.2 + (k > 1 ? 0.12 : 0)), 0.08, 0.05 + (k > 1 ? -0.15 : 0)));
    };
    h.hit = (lane, sustain) => {
      if (lane >= h.lanes) return;
      flames[lane].t = 0;
      strings[lane].vib = 1; strings[lane].glow = 1; buttons[lane].press = 1;
      burst(laneX(lane), sustain ? 6 : 14, false, false, 1, lane);
    };
    // a golden banana picked up: a shower of gold over that fret
    h.banana = (lane) => {
      if (lane >= h.lanes) return;
      const was = h.sparkStar; h.sparkStar = false;
      const keep = sk.spark.slice(lane * 6, lane * 6 + 6);
      sk.spark.set([1, 0.75, 0.1, 1, 0.97, 0.6], lane * 6); burst(laneX(lane), 22, false, false, 1.3, lane); sk.spark.set(keep, lane * 6);
      h.sparkStar = was;
    };
    h.holdSpark = (lane) => {
      if (lane >= h.lanes) return;
      if (Math.random() < 0.45) burst(laneX(lane), 1, false, false, 1, lane);
      const f = flames[lane]; if (f.t > 0.12) f.t = 0.12;
      strings[lane].glow = Math.max(strings[lane].glow, 0.7); strings[lane].vib = Math.max(strings[lane].vib, 0.4);
    };
    // a star phrase was completed: a white flash and a fountain of white sparks over every fret
    h.starPhrase = () => { h.phraseT = 0; for (let i = 0; i < h.lanes; i++) burst(laneX(i), 16, true, false, 1.35); };

    // s: { t, look, notes:[{t,lane,dur,state,holding}], from, pressed[], beats[[t,bar]], star, starReady }
    // demo: the menus' neck with star power on (the shop's preview), unless the caller says otherwise
    h.update = (s, { now, dt, pulse, demo = null }) => {
      const { t, look, notes, from = 0, pressed = [], beats = [] } = s;
      const star = s.star ?? demo?.star ?? false, starReady = s.starReady ?? demo?.ready ?? false;
      const lanes = h.lanes;
      const speed = HL / look;
      const zOf = (time) => -(time - t) * speed;
      strikeLight.intensity = 1.4 + pulse * 0.8;
      gemRingMat.userData.wig.value = sk.wig ? pulse * 1.1 + Math.sin(now * 3) * 0.15 : 0; // the tamarins' moustaches, on the beat
      // the watches' minute hands: a twelfth of the dial on every beat, snapping on like a clock's (clockwise to us)
      if (sk.tick) {
        if (pulse > 0.75 && !h.tickArmed) { h.ticks = (h.ticks || 0) + 1; h.tickArmed = true; } else if (pulse < 0.35) h.tickArmed = false;
        h.tickA = (h.tickA || 0) + (-(h.ticks || 0) * (Math.PI / 6) - (h.tickA || 0)) * Math.min(1, dt * 20);
        gemRingMat.userData.tick.value = h.tickA;
      } else gemRingMat.userData.tick.value = 0;
      // the pet: bobs on the beat, bored; asleep after a few misses in a row; flapping happy on a long streak; flying
      // above the neck with star power
      if (pet.id !== sk.pet) {
        // made the first time it's worn (and only then: most never wear one)
        if (pet.g) { hwy.remove(pet.g); pet.g = null; }
        pet.id = sk.pet;
        if (sk.pet) { pet.g = petModels[sk.pet](); hwy.add(pet.g); }
      }
      if (pet.g) {
        const combo = s.combo || 0, misses = s.missRun || 0;
        pet.sleepy = misses >= 3 ? 1 : combo > 0 ? 0 : pet.sleepy;
        const happy = !star && !pet.sleepy && combo >= 30;
        pet.flap += ((star ? 1 : 0) - pet.flap) * Math.min(1, dt * 4);
        pet.g.pose({
          lid: pet.sleepy || (!star && now % 4.2 < 0.13) ? 1 : happy || star ? 0 : 0.5,
          wing: star ? 0.55 + Math.sin(now * 18) * 0.45 : happy ? 0.25 + Math.abs(Math.sin(now * 7)) * 0.35 : pulse * 0.06,
          feet: pet.flap < 0.5, sleep: !!pet.sleepy && !star, now, pulse, star: !!star, happy, energy: s.energy ?? 0.55, // the beat (Eddie headbangs)
        });
        const hop = happy ? Math.abs(Math.sin(now * 7)) * 0.08 : 0;
        // a wide screen: beside the neck, by the orange button; a phone held upright (the neck fills its width): sitting
        // in the corner under the buttons, where the notes are already gone
        const tall = h.aspect < 0.9, px = tall ? h.width() / 2 - 0.55 : pet.x, pz = tall ? 1.3 : 0.15, k = tall ? 0.85 : 1.05;
        // (a bird flies up over the neck; a person only jumps: lift)
        const lift = pet.g.lift ?? 1, jump = lift < 1 ? Math.abs(Math.sin(now * 8)) * 0.25 * pet.flap : 0;
        pet.g.position.set(px - pet.flap * 0.35 * lift + Math.sin(now * 2.2) * 0.2 * pet.flap * lift, 0.02 + pulse * 0.05 + hop + jump + pet.flap * lift * (0.9 + Math.sin(now * 3) * 0.1), pz);
        // turned a little toward the neck and the player (a phone looks down on it more: leaned back); bored, it looks about; asleep, its head nods
        pet.g.rotation.set((tall ? -0.45 : 0.15) + (pet.sleepy && !star ? 0.25 + Math.sin(now * 1.5) * 0.05 : 0), -0.35 + (happy || star || pet.sleepy ? 0 : Math.sin(now * 0.6) * 0.3), pulse * 0.04 * Math.sin(now * 4));
        const sq = 1 + pulse * 0.06, br = pet.sleepy ? 1 + Math.sin(now * 2) * 0.02 : 1;
        pet.g.scale.set(k * br / sq, k * sq * br, k * br / sq);
      }
      // star power: the neck, its edges and the strike light turn blue (or the skin's colour)
      h.starGlow += ((star ? 1 : 0) - h.starGlow) * Math.min(1, dt * 6);
      h.readyGlow += ((starReady && !star ? 1 : 0) - h.readyGlow) * Math.min(1, dt * 5);
      h.phraseT += dt;
      const starGlow = h.starGlow, readyGlow = h.readyGlow;
      if (sk.starRainbow && (starGlow > 0.005 || readyGlow > 0.005)) starColors(hue.setHSL((now * 0.15) % 1, 1, 0.5));
      const flash = h.phraseT < 0.5 ? Math.pow(1 - h.phraseT / 0.5, 2) : 0;
      h.sparkStar = star;
      board.material.emissive.copy(sk.board).lerp(sk.boardStar, starGlow);
      board.material.emissiveIntensity = sk.boardEmissive + starGlow * 0.3 + flash * 0.9;
      const edgeK = Math.max(starGlow, readyGlow * (0.55 + 0.45 * Math.sin(now * 9)));
      for (let j = 0; j < 3; j++) {
        edgeMats[j].emissive.copy(sk.edge[j]).lerp(sk.edgeStar, edgeK);
        edgeMats[j].emissiveIntensity = (0.5 + pulse * 0.35 + starGlow * 0.5 + readyGlow * 0.6 + flash * 2) * sk.edgeK;
      }
      strikeLight.color.copy(sk.light).lerp(sk.lightStar, Math.max(starGlow, readyGlow * 0.7));
      strikeLight.intensity += flash * 3 + readyGlow * 0.6;
      // phrase completed: white flares on every fret
      for (let i = 0; i < lanes; i++) {
        const fl = flares[i];
        fl.visible = flash > 0.01;
        if (fl.visible) { fl.material.opacity = flash; const sc = 1.2 + (1 - flash) * 2.2; fl.scale.set(sc, sc, 1); }
      }
      // ready: blue fire at both ends of the strike line, and blue sparks rising from it
      readyFire.forEach((sp, k) => {
        sp.visible = readyGlow > 0.02;
        if (!sp.visible) return;
        sp.material.map = sk.ready[(Math.floor(now * 20) + k * 2) % sk.ready.length]; sp.material.color.copy(sk.readyCol);
        sp.material.opacity = readyGlow * (k > 1 ? 0.6 : 0.95);
        const fl = 1 + 0.12 * Math.sin(now * 23 + k * 2);
        sp.scale.set((k > 1 ? 0.7 : 0.95) * fl, (k > 1 ? 1.35 : 2.0) * fl * (0.7 + 0.3 * readyGlow), 1);
      });
      if (readyGlow > 0.5 && Math.random() < dt * 22) { const side = Math.random() < 0.5 ? -1 : 1; burst(side * (h.width() / 2 + 0.2), 1, false, true, 0.8); }

      boardTex.offset.y = (t * speed) / 6;

      // fret bars
      let fi = 0;
      const w = h.width();
      for (const [bt, bar] of beats) {
        const z = zOf(bt);
        if (z > 0.6 || z < -HL) continue;
        tmpM.compose(tmpV.set(0, 0.025, z), tmpQ.identity(), tmpS.set(w, bar ? 1.8 : 0.9, bar ? 1.5 : 0.8));
        frets.setMatrixAt(fi++, tmpM);
        if (fi >= 64) break;
      }
      frets.count = fi; frets.instanceMatrix.needsUpdate = true;

      // gems + tails
      let gi = 0, ti = 0, si = 0, hi = 0, bi = 0;
      const starPulse = 0.85 + 0.15 * Math.sin(now * 9);
      for (let i = from; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - t > look * 1.02) break;
        if (n.hide) continue;
        const x = laneX(n.lane);
        const isStar = n.star >= 0 && n.state !== 2;
        if (n.dur > 0 && n.t + n.dur > t && ti < MAX_GEMS) {
          const z0 = n.holding ? 0 : Math.min(0.4, zOf(n.t));
          const z1 = Math.max(-HL, zOf(n.t + n.dur));
          if (z0 > z1) {
            const len = z0 - z1;
            const dead = n.state === 2 || (n.state === 1 && !n.holding);
            const wob = n.holding ? Math.sin(now * 45 + i) * 0.035 : 0;
            tmpM.compose(tmpV.set(x + wob, 0.075, z1 + len / 2), tmpQ.identity(), tmpS.set(n.holding ? 0.2 : 0.16, 0.045, len));
            tmpC.copy(dead ? DEAD_TAIL : star ? sk.starTail : isStar ? STAR_WHITE : sk.tail[n.lane]);
            if (n.holding) tmpC.multiplyScalar(1.6);
            tails.setColorAt(ti, tmpC);
            tails.setMatrixAt(ti, tmpM); ti++;
          }
        }
        if (n.state === 1) continue;
        const z = zOf(n.t);
        if (z > 1.4 || gi >= MAX_GEMS) continue;
        if (n.banana && n.state === 0 && bi < MAX_GEMS) {
          // a golden banana turning over the note
          tmpQ.setFromAxisAngle(Y_AXIS, now * 2.4 + i);
          tmpM.compose(tmpV.set(x - 0.05, 0.55 + Math.sin(now * 5 + i) * 0.05, z), tmpQ, tmpS.setScalar(1.75));
          bananas.setMatrixAt(bi++, tmpM);
          // and a gold glow under that note, so it reads from far up the neck
          const gl = 1.6 + 0.25 * Math.sin(now * 6 + i);
          tmpM.compose(tmpV.set(x, 0.03, z), tmpQ.identity(), tmpS.set(gl, 1, gl));
          halos.setMatrixAt(hi, tmpM); halos.setColorAt(hi, BANANA_GLOW); hi++;
        }
        if (isStar) {
          // a white star (blue while star power is on), with a soft glow under it
          tmpQ.setFromAxisAngle(Y_AXIS, Math.sin(now * 2.2 + i) * 0.35);
          tmpM.compose(tmpV.set(x, 0.05, z), tmpQ, tmpS.setScalar(0.95 * (0.96 + 0.06 * starPulse)));
          starGem.setMatrixAt(si, tmpM); starGem.setColorAt(si, star ? sk.starGem : WHITE); si++;
          tmpM.compose(tmpV.set(x, 0.03, z), tmpQ.identity(), tmpS.set(1.9 * starPulse, 1, 1.9 * starPulse));
          halos.setMatrixAt(hi, tmpM); halos.setColorAt(hi, star ? sk.starHalo : STAR_HALO); hi++;
          continue;
        }
        tmpM.compose(tmpV.set(x, 0.05, z), tmpQ.identity(), tmpS.set(0.9, 0.9, 0.9));
        gemBase.setMatrixAt(gi, tmpM); gemBody.setMatrixAt(gi, tmpM); gemDome.setMatrixAt(gi, tmpM); gemRing.setMatrixAt(gi, tmpM);
        if (n.state === 2) { gemBody.setColorAt(gi, DEAD_GEM); gemDome.setColorAt(gi, DEAD_GEM); gemRing.setColorAt(gi, sk.ringLane ? DEAD_GEM : WHITE); }
        else if (star) {
          // star power on: every note turns electric blue (or the skin's colour) and glows
          gemBody.setColorAt(gi, sk.starBody); gemDome.setColorAt(gi, sk.starDome); gemRing.setColorAt(gi, sk.ringLane ? sk.starGem : WHITE);
          tmpM.compose(tmpV.set(x, 0.03, z), tmpQ.identity(), tmpS.set(1.45, 1, 1.45));
          halos.setMatrixAt(hi, tmpM); halos.setColorAt(hi, sk.starHalo); hi++;
        }
        else {
          gemBody.setColorAt(gi, sk.body[n.lane]); gemDome.setColorAt(gi, sk.dome[n.lane]); gemRing.setColorAt(gi, sk.ring[n.lane]);
          if (sk.haloSize) {
            // a glow under the note in its own colour (neon: reads without bloom; diamonds: a twinkle)
            const tw = sk.twinkle ? 0.55 + 0.45 * Math.pow(Math.max(0, Math.sin(now * 5 + i * 2.4)), 3) : 1, sz = sk.haloSize * (sk.twinkle ? 0.8 + 0.3 * tw : 1);
            tmpM.compose(tmpV.set(x, 0.03, z), tmpQ.identity(), tmpS.set(sz, 1, sz));
            halos.setMatrixAt(hi, tmpM); halos.setColorAt(hi, tmpC.copy(sk.halo[n.lane]).multiplyScalar(tw)); hi++;
          }
        }
        gi++;
      }
      for (const m of [gemBase, gemBody, gemDome, gemRing]) { m.count = gi; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      for (const [m, c] of [[starGem, si], [halos, hi], [tails, ti], [bananas, bi]]) { m.count = c; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

      // buttons, strings, hit fire
      for (let i = 0; i < lanes; i++) {
        const b = buttons[i], p = pressed[i] ? 1 : 0;
        b.press += (Math.max(p, b.press * 0.8) - b.press) * 0.5;
        b.cap.position.y = 0.2 - 0.07 * (p || b.press * 0.5);
        b.stud.position.y = b.cap.position.y + 0.01;
        b.cap.material.emissiveIntensity = 0.12 + (p ? 0.75 : 0) + b.press * 0.5;
        b.stud.material.emissiveIntensity = b.press * 0.6;
        const st = strings[i];
        st.vib *= Math.pow(0.02, dt); st.glow *= Math.pow(0.002, dt);
        st.mesh.position.x = laneX(i) + Math.sin(now * 95 + i) * 0.035 * st.vib;
        st.mesh.material.emissive.copy(sk.lane[i]).multiplyScalar(sk.laneGlow + st.glow * 0.4);
        const f = flames[i]; f.t += dt;
        const L = sk.form.look, k = f.t / L[4];
        if (sk.flameRainbow) { flameColor(i, hue.setHSL((now * 0.25 + i / 5) % 1, 1, 0.5), sk.flameK); f.sp.material.color.copy(sk.flame[i]); }
        f.sp.material.map = sk.fire[(Math.floor(now * 22) + i) % sk.fire.length];
        f.sp.material.opacity = k < 1 ? (1 - k) : 0;
        f.sp.visible = k < 1;
        f.sp.scale.set(L[0] + k * L[2], L[1] + k * L[3], 1);
      }
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) { spPos[i * 3 + 1] = -50; continue; }
        sparkLife[i] -= dt; sparkVel[i * 3 + 1] -= sparkG[i] * dt;
        if (sparkG[i] < 0) sparkVel[i * 3] += Math.sin(now * 3 + i) * dt * 1.5; // floating up: they drift
        spPos[i * 3] += sparkVel[i * 3] * dt; spPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;
    };
    h.applySkin();
    h.layout(5);
    return h;
  }
  buildSkin(sk.ids);
  const hws = [createHighway()];
  // with two players each neck has its own camera and its own half of the screen; the venue camera stays centred
  const hwCams = [new THREE.PerspectiveCamera(55, 1, 0.1, 220), new THREE.PerspectiveCamera(55, 1, 0.1, 220)];
  let players = 1;
  const camOf = (p) => (players > 1 ? hwCams[p] : camera);
  const SPLIT_X = 80; // the second neck sits this far to the side, out of the first camera's view

  /* --- post --- */
  // The composer's buffers are single-sample. MSAA gets its own target, drawn once and resolved once per frame, then
  // copied in: drawing again into a multisampled target after resolving it (the bloom does that to the composer's
  // buffer) is a path ANGLE's Metal backend, behind every Mac browser, has broken before.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  const msRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const copyQuad = new FullScreenQuad(new THREE.ShaderMaterial({ ...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), blending: THREE.NoBlending, depthTest: false, depthWrite: false }));
  let msaa = false; // applyLevel decides
  class ScenePass extends Pass {
    constructor() { super(); this.needsSwap = false; }
    render(r, writeBuffer, readBuffer) {
      const auto = r.autoClear; r.autoClear = false;
      r.setRenderTarget(msaa ? msRT : readBuffer); r.clear();
      r.render(scene, camera);
      if (msaa) { copyQuad.material.uniforms.tDiffuse.value = msRT.texture; r.setRenderTarget(readBuffer); copyQuad.render(r); }
      r.autoClear = auto;
    }
  }
  const scenePass = new ScenePass();
  composer.addPass(scenePass);
  // two players: the venue across the whole frame, then each neck in its half (one frame, one bloom pass)
  const bgOnly = new THREE.Scene(); bgOnly.background = bgRT.texture;
  class SplitPass extends Pass {
    constructor() { super(); this.needsSwap = false; }
    render(r, writeBuffer, readBuffer) {
      const rt = readBuffer, w = rt.width, ht = rt.height;
      const auto = r.autoClear; r.autoClear = false;
      rt.viewport.set(0, 0, w, ht); rt.scissor.set(0, 0, w, ht); rt.scissorTest = false;
      r.setRenderTarget(rt); r.clear();
      r.render(bgOnly, camera);
      scene.background = null;
      for (let k = 0; k < players; k++) {
        hws.forEach((o, j) => (o.group.visible = j === k));
        const x0 = Math.round((w * k) / players), x1 = Math.round((w * (k + 1)) / players);
        rt.viewport.set(x0, 0, x1 - x0, ht); rt.scissor.set(x0, 0, x1 - x0, ht); rt.scissorTest = true;
        r.setRenderTarget(rt); r.clearDepth();
        r.render(scene, hwCams[k]);
      }
      hws.forEach((o, j) => (o.group.visible = j < players));
      rt.viewport.set(0, 0, w, ht); rt.scissor.set(0, 0, w, ht); rt.scissorTest = false;
      r.setRenderTarget(rt);
      scene.background = bgRT.texture;
      r.autoClear = auto;
    }
  }
  const splitPass = new SplitPass(); splitPass.enabled = false;
  composer.addPass(splitPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(128, 128), 0.5, 0.4, 0.86);
  // A Mac's GPU (Metal) compiles shaders with fast math and stores overflowing half floats as infinity, so one bad
  // pixel could reach the bloom, be smeared over the whole screen and come out black. Scrub NaN/Inf where the bloom
  // reads the scene (isnan also makes ANGLE compile this shader exactly); a stray one left in the frame is one dark
  // pixel. (Not in OutputPass: it's a GLSL 1 raw shader, without isnan.)
  const HIGH_PASS_READ = "vec4 texel = texture2D( tDiffuse, vUv );";
  if (bloom.materialHighPassFilter.fragmentShader.includes(HIGH_PASS_READ)) {
    bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(HIGH_PASS_READ, `${HIGH_PASS_READ}\ntexel = clamp(mix(texel, vec4(0.0), isnan(texel)), 0.0, 64.0);`);
  } else console.warn("Corde: the bloom's shader changed, NaN scrub not applied");
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // nothing ever reads its depth: resolving only the colour is less work (one blit less per frame on Metal)
  msRT.resolveDepthBuffer = false;

  let stageName = "bar", S = STAGES.bar; // current venue look (setStage below)

  /* --- layout --- */
  // The crowd is laid out in screen space beside the neck: find where the neck's edge is on screen, row by row.
  function layoutCrowd(aspect) {
    // two players: the necks cover most of the screen, so the crowd fills the whole width behind them
    const hw = players > 1 ? 0.3 : hws[0].width() / 2 + 0.16, pts = [];
    for (let z = 3; z >= -HL + 3; z -= 0.5) { tmpV.set(-hw, 0.05, z).project(camera); pts.push([tmpV.y, tmpV.x]); }
    const top = pts[pts.length - 1][0];
    const edgeX = (y) => {
      if (y > top + 0.02) return null; // above the far end of the neck
      if (y <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (pts[i][0] >= y) { const [y0, x0] = pts[i - 1], [y1, x1] = pts[i]; return x0 + ((x1 - x0) * (y - y0)) / Math.max(1e-6, y1 - y0); }
      return pts[pts.length - 1][1];
    };
    crowd.layout(aspect, Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), edgeX, S.crowd);
  }

  let W = 1, H = 1;
  const baseCam = new THREE.Vector3();
  // Analytic camera fit: strike line at a fixed screen height, highway filling a fixed share of the width.
  // split: one of two necks side by side, in a half-width view
  function fitCam(cam, aspect, width, x0, split) {
    const portrait = aspect < 0.9 && !split;
    cam.aspect = aspect;
    cam.fov = portrait ? 66 : split ? 58 : 52;
    const pitch = portrait ? 0.6 : split ? 0.5 : 0.42;
    const tf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const wantY = portrait ? -0.6 : split ? -0.66 : -0.7;
    const wantX = portrait ? 0.95 : split ? Math.min(0.74, 0.62 / aspect) : Math.min(0.48, 0.95 / aspect);
    const half = width / 2 + 0.2;
    const alpha = Math.atan(-wantY * tf);
    const phi = pitch + alpha;
    const cs = half / (wantX * tf * aspect * Math.cos(alpha));
    cam.position.set(x0, cs * Math.sin(phi), cs * Math.cos(phi) + 0.3);
    cam.rotation.set(-pitch, 0, 0);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    cam.userData.base = cam.position.clone();
  }
  function fitCamera() {
    const aspect = W / H;
    fitCam(camera, aspect, hws[0].width(), 0, false);
    baseCam.copy(camera.position);
    hws.forEach((h) => (h.aspect = players > 1 ? W / players / H : aspect)); // (the pet sits elsewhere on a tall screen)
    if (players > 1) hws.forEach((h, k) => k < players && fitCam(hwCams[k], W / players / H, h.width(), h.group.position.x, true));
    layoutCrowd(aspect);
    band.layout(aspect < 0.9);
  }
  function layoutLanes(n) { hws.forEach((h) => h.layout(n)); fitCamera(); }

  /* --- quality levels (auto mode steps down the moment frames get slow) --- */
  const DEV_DPR = devicePixelRatio || 1;
  const LEVELS = [
    { dpr: Math.min(DEV_DPR, 2), bloom: 0.5, bg: 0.75, bgEvery: 1, fx: 2 },
    { dpr: Math.min(DEV_DPR, 1.5), bloom: 0.35, bg: 0.7, bgEvery: 1, fx: 2 },
    { dpr: 1, bloom: 0, bg: 0.5, bgEvery: 2, fx: 1 },
    { dpr: 0.75, bloom: 0, bg: 0.33, bgEvery: 3, fx: 0 },
  ];
  let mode = "auto", level = isMobile ? 2 : 1;
  const perf = { ema: 16.7, last: 0, slowFor: 0, fastFor: 0, lastDrop: -1e9 };
  function applyLevel() {
    const L = LEVELS[level];
    // MSAA for one neck only, in msRT. The venue behind (bgRT) is never multisampled: it's small and blurred anyway,
    // and MSAA plus the crowd's depth clear in the middle of that pass left corrupt samples.
    const was = msaa;
    msaa = !isMobile && level <= 1 && SAFE[safe].msaa && players === 1;
    if (was && !msaa) msRT.dispose();
    renderer.setPixelRatio(L.dpr);
    bloom.enabled = L.bloom > 0 && SAFE[safe].bloom;
    dust.visible = L.fx >= 1;
    haze.forEach((h, i) => (h.s.visible = L.fx >= 2 || i % 2 === 0));
    coneMats.forEach((m) => (m.visible = L.fx >= 1));
    resize();
    armProbe(); // a different pipeline: look at the screen again
  }
  function autoTune(now) {
    if (mode !== "auto") return;
    if (!perf.last) { perf.last = now; return; }
    const ft = now - perf.last; perf.last = now;
    if (ft > 250) return; // tab switch or a one-off hitch: ignore
    perf.ema += (Math.min(ft, 60) - perf.ema) * 0.08;
    if (perf.ema > 19.5) { perf.slowFor += ft; perf.fastFor = 0; } else if (perf.ema < 12.5) { perf.fastFor += ft; perf.slowFor = 0; } else { perf.slowFor = 0; perf.fastFor = 0; }
    if (perf.slowFor > 700 && level < LEVELS.length - 1) { level++; perf.slowFor = 0; perf.lastDrop = now; perf.ema = 16.7; applyLevel(); }
    else if (perf.fastFor > 8000 && level > (isMobile ? 1 : 0) && now - perf.lastDrop > 30000) { level--; perf.fastFor = 0; perf.ema = 16.7; applyLevel(); }
  }

  function resize() {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    const L = LEVELS[level];
    renderer.setSize(W, H, false); composer.setSize(W, H);
    msRT.setSize(composer.renderTarget1.width, composer.renderTarget1.height);
    bloom.resolution.set(Math.max(64, W * L.bloom), Math.max(64, H * L.bloom));
    bgRT.setSize(Math.max(64, Math.round(W * L.dpr * L.bg)), Math.max(64, Math.round(H * L.dpr * L.bg)));
    fitCamera();
  }
  let frameNo = 0;

  /* --- black-frame probe (see safe above) ---
     "Auto" quality only watches speed, and a GPU that draws black is fast, so the first seconds of the page (and after any
     change of quality, venue or players) the fret buttons on screen are read back. They're lit in every healthy frame
     (any venue, any quality) and pure black when an effect broke the picture: then switch effects off one at a time
     until they come back, and remember what worked. */
  const probe = { next: 30, ok: 0, bad: 0, left: 40, buf: null, stepped: false };
  let onTrouble = null;
  const gpu = (() => { try { const g = renderer.getContext(), x = g.getExtension("WEBGL_debug_renderer_info"); return String(g.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : g.RENDERER)); } catch { return "?"; } })();
  // A lost GPU context (a MacBook switching graphics cards, a GPU reset) draws nothing: that's not a broken effect.
  // three.js restores it; look at the screen again then. Still lost after a few seconds: tell the player.
  let lostT = 0;
  canvas.addEventListener("webglcontextlost", () => {
    probe.next = Infinity;
    clearTimeout(lostT); lostT = setTimeout(() => onTrouble?.("lost"), 4000);
  });
  canvas.addEventListener("webglcontextrestored", () => { clearTimeout(lostT); armProbe(30); });
  function armProbe(inFrames = 20) { probe.next = frameNo + inFrames; probe.ok = probe.bad = 0; probe.left = 40; }
  function probeFrame() {
    const gl = renderer.getContext();
    if (gl.isContextLost()) { probe.next = Infinity; return; }
    const sx = gl.drawingBufferWidth / W, sy = gl.drawingBufferHeight / H;
    const px = probe.buf || (probe.buf = new Uint8Array(4 * 9));
    let caps = 0, dark = 0, lit = 0, max = 0;
    try {
      // the frame that was just drawn is still in the drawing buffer until this task ends
      const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      for (let p = 0; p < players; p++) {
        for (let i = 0; i < hws[p].lanes; i++) {
          toScreen(p, hws[p].laneX(i), scr); // the middle of the fret button (a hair below the strike line)
          const x = Math.min(gl.drawingBufferWidth - 3, Math.max(0, Math.round(scr.x * sx) - 1));
          const y = Math.min(gl.drawingBufferHeight - 3, Math.max(0, Math.round((H - scr.y - 2) * sy) - 1));
          gl.readPixels(x, y, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let m = 0;
          for (let k = 0; k < 36; k += 4) m = Math.max(m, px[k], px[k + 1], px[k + 2]);
          caps++; if (m < 10) dark++; else if (m > 60) lit++;
          if (m > max) max = m;
        }
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
    } catch { probe.next = Infinity; return; }
    probe.last = max;
    probe.next = frameNo + 12;
    if (--probe.left <= 0) probe.next = Infinity; // never conclusive: stop looking
    if (lit >= Math.ceil(caps * 0.6)) {
      probe.bad = 0;
      if (++probe.ok >= 3) {
        probe.next = Infinity;
        if (probe.stepped) { probe.stepped = false; try { localStorage.setItem(SAFE_KEY, String(safe)); } catch {} }
      }
    } else if (dark === caps) {
      probe.ok = 0;
      if (++probe.bad < 2) return;
      if (safe < SAFE.length - 1) {
        safe++; probe.stepped = true;
        console.warn(`Corde: the screen came out black, graphics safe mode ${safe} (${SAFE[safe].name}) on ${gpu}`);
        applyLevel(); // re-arms the probe
      } else {
        probe.next = Infinity;
        onTrouble?.("black");
      }
    }
  }
  // The last safe mode: no intermediate buffer at all. The venue goes straight to the screen, then each neck on top
  // (two players: each in its half).
  function drawDirect() {
    renderer.setRenderTarget(null);
    const auto = renderer.autoClear; renderer.autoClear = false;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.clear();
    renderer.render(bg, camera);
    scene.background = null;
    for (let k = 0; k < players; k++) {
      if (players > 1) {
        hws.forEach((o, j) => (o.group.visible = j === k));
        const x0 = Math.round((W * k) / players), x1 = Math.round((W * (k + 1)) / players);
        renderer.setViewport(x0, 0, x1 - x0, H); renderer.setScissor(x0, 0, x1 - x0, H); renderer.setScissorTest(true);
      }
      renderer.clearDepth();
      renderer.render(scene, camOf(k));
    }
    hws.forEach((o, j) => (o.group.visible = j < players));
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
    scene.background = bgRT.texture;
    renderer.autoClear = auto;
  }

  let peopleDt = 0;
  const beatTrack = { count: 0, bar: 0, lastT: -1e9, prevT: -1e9, len: 0.5 };
  // light colours per song section: [front PARs, back PARs] (the venue picks the list; the club's are warm)
  let palettes = BAR_PAL, pal = 0, section = 0;
  const colA = new THREE.Color(palettes[0][0]), colB = new THREE.Color(palettes[0][1]);

  function firePyro() { if (!S.pyro) return; pyroT = 0; pyro.forEach((p) => (p.t = p.wide && !S.wide ? 9 : 0)); }

  // the venue look (see STAGES); the club is what the scene is built as, so "bar" changes nothing
  function setStage(name) {
    if (!STAGES[name]) name = "bar";
    if (name === stageName) return;
    stageName = name; S = STAGES[name];
    palettes = S.pal; pal = ((section % palettes.length) + palettes.length) % palettes.length;
    colA.setHex(palettes[pal][0]); colB.setHex(palettes[pal][1]); // no slow fade from the last venue's colours
    wall.material.color.setRGB(...S.wall); floor.material.color.setRGB(...S.floor);
    floor.material.roughness = S.gloss[0]; floor.material.metalness = S.gloss[1];
    floor.material.map = S.slabs ? slabs : planks; floor.material.map.repeat.set(...S.boards); // same shader either way
    bgFog.color.setHex(S.fog[0]); bgFog.near = S.fog[1]; bgFog.far = S.fog[2];
    bgHemi.color.setHex(S.amb[0]); bgHemi.groundColor.setHex(S.amb[1]); bgHemi.intensity = S.amb[2];
    bgKey.color.setHex(S.key[0]); bgKey.intensity = S.key[1]; bandKey.color.setHex(S.spot[0]);
    glows.forEach((g, row) => { g.material.size = 2.4 * S.glow; g.visible = row === 0 || S.back > 0; });
    haze.forEach((h) => { h.s.material.color.setHex(S.haze[0]); h.s.material.opacity = h.o * S.haze[1]; });
    dust.material.color.setHex(S.dust[0]); dust.material.opacity = S.dust[1];
    pyro.forEach((p) => p.col.forEach((sp) => sp.material.color.setHex(S.fire[0]))); pyroLight.color.setHex(S.fire[1]);
    // put out any fire this venue doesn't have (all of it in a garage, the outer pair anywhere but the stadium)
    pyro.forEach((p) => { if (!S.pyro || (p.wide && !S.wide)) p.t = 9; });
    if (!S.pyro) pyroT = 9;
    layoutCrowd(W / H);
    armProbe();
  }
  // screen position (CSS px) of a point on player p's neck
  function toScreen(p, x, out) {
    const h = hws[p] || hws[0];
    tmpV.set(h.group.position.x + x, 0, 0).project(camOf(p));
    const vw = W / players, x0 = players > 1 ? vw * p : 0;
    out.x = x0 + ((tmpV.x + 1) / 2) * vw; out.y = ((1 - tmpV.y) / 2) * H;
    return out;
  }
  const scr = { x: 0, y: 0 };

  const api = {
    _internals: { camera, baseCam, bg, crowd, renderer, scene },
    setLanes: layoutLanes,
    /** 1 player (one neck in the middle) or 2 (two necks, split screen). */
    setPlayers(n) {
      n = n > 1 ? 2 : 1;
      if (n === players) return;
      players = n;
      while (hws.length < n) { const h = createHighway(); h.group.position.x = SPLIT_X * hws.length; h.layout(hws[0].lanes); hws.push(h); } // wears the skin already
      hws.forEach((h, k) => (h.group.visible = k < n));
      scenePass.enabled = n === 1; splitPass.enabled = n > 1;
      applyLevel(); // MSAA is for one player only; fits the cameras and looks at the screen again
    },
    get players() { return players; },
    // "auto" | "high" | "low"
    setQualityLevel(q) {
      mode = q === "high" || q === "low" ? q : "auto";
      level = mode === "high" ? 0 : mode === "low" ? 2 : isMobile ? 2 : 1;
      perf.ema = 16.7; perf.slowFor = perf.fastFor = 0;
      applyLevel();
    },
    qualityInfo() { return { mode, level, safe, msaa, floatOK, gpu, probe: { last: probe.last, left: probe.left, next: probe.next, frame: frameNo }, ema: +perf.ema.toFixed(1), bg: [bgRT.width, bgRT.height], px: renderer.getPixelRatio() }; },
    /** The player picked a quality by hand: forget the safe mode found before and test this machine again. */
    retestGraphics() {
      if (!safe) return;
      safe = 0; probe.stepped = false;
      try { localStorage.removeItem(SAFE_KEY); } catch {}
      applyLevel();
    },
    /** fn(why) when the stage can't be shown: "black" (even the plainest drawing comes out black) or "lost" (GPU context gone). */
    set onGraphicsTrouble(fn) { onTrouble = fn; },
    resize,
    setSection(i) { section = i; pal = ((i % palettes.length) + palettes.length) % palettes.length; if (i > 0) firePyro(); },
    /** Tour venue look: "garage" | "bar" (the club, default) | "university" | "theater" | "festival" | "stadium". */
    setStage,
    get stage() { return stageName; },
    pyro: firePyro,
    hit(lane, sustain, p = 0) { hws[p]?.hit(lane, sustain); },
    /** A golden banana picked up (the Otaku event). */
    banana(lane, p = 0) { hws[p]?.banana(lane); },
    holdSpark(lane, p = 0) { hws[p]?.holdSpark(lane); },
    miss() {},
    /** How excited the crowd is, 0–1 (follows the rock meter and star power). */
    setHype(v) { hype = Math.max(0, Math.min(1, v)); },
    /** A star phrase was completed: a white flash and a fountain of white sparks over every fret. */
    starPhrase(p = 0) { hws[p]?.starPhrase(); },
    /** The looks from the shop, { neck, gems, flames, strings, star, crowd } of ids (skins.js; missing or unknown: the
     *  default), on every neck. Menus only: a new neck draws its canvas (tens of ms on a phone), the rest is cheap. */
    setSkin(equipped) {
      const ids = resolveSkin(equipped);
      if (Object.keys(ids).every((k) => ids[k] === sk.ids[k])) return;
      const crowdWas = sk.ids.crowd;
      buildSkin(ids);
      hws.forEach((h) => h.applySkin());
      crowd.setLights(CROWDS[ids.crowd]);
      if (ids.crowd !== crowdWas) crowd.showLights(4); // a new crowd look: they hold up their lights for a moment
    },
    /** The ids being shown (after defaults). */
    skinInfo() { return { ...sk.ids }; },
    /** The shop's preview: while on, the menus' neck shows star power (and the ready fire), not during a song. */
    previewStar(on) { previewStar = on ? previewStar || performance.now() / 1000 : false; },
    /** The shop's preview: while on, the crowd holds up its lights. */
    previewCrowd(on) { crowd.showLights(on ? Infinity : 0); },
    laneFromClientX(x, rect) {
      const h = hws[0];
      let best = 0, bd = 1e9;
      for (let i = 0; i < h.lanes; i++) {
        tmpV.set(h.laneX(i), 0, 0).project(camera);
        const sx = rect.left + ((tmpV.x + 1) / 2) * rect.width;
        const d = Math.abs(sx - x); if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    strikeScreenY(p = 0) { return toScreen(p, 0, scr).y; },
    laneScreenX(i, p = 0) { const h = hws[p] || hws[0]; return toScreen(p, h.laneX(i), scr).x; },

    // state: { t, look, notes, from, pressed[], beats[[t,bar]], dt, star, starReady, energy, punch }
    // two players: { dt, energy, punch, players: [{ t, look, notes, from, pressed, beats, star, starReady }, …] }
    render(state) {
      const P = state.players || [state];
      const { dt = 0.016, energy = 0.55, punch = 0, calm = null } = state;
      const { t, beats = [] } = P[0];
      const now = performance.now() / 1000;
      const E = energy;

      let pulse = 0;
      for (let i = 0; i < beats.length; i++) { const d = t - beats[i][0]; if (d >= 0 && d < 0.3) pulse = Math.max(pulse, (1 - d / 0.3) * (beats[i][1] ? 1 : 0.55)); }

      // where we are in the beat and in the bar (counted as beats go by; reset when time jumps back)
      let li = -1;
      for (let i = 0; i < beats.length; i++) { if (beats[i][0] <= t) li = i; else break; }
      if (t < beatTrack.prevT - 0.05) { beatTrack.lastT = -1e9; }
      beatTrack.prevT = t;
      let phase = 0;
      if (li >= 0) {
        const b0 = beats[li][0];
        if (b0 > beatTrack.lastT + 1e-4) { beatTrack.count++; beatTrack.bar = beats[li][1] ? 0 : (beatTrack.bar + 1) % 4; beatTrack.lastT = b0; }
        const nb = beats[li + 1];
        if (nb) beatTrack.len = Math.max(0.15, nb[0] - b0);
        phase = Math.min(1, (t - b0) / beatTrack.len);
      }
      const bpos = beatTrack.count + phase;

      // the necks (each player's notes, buttons, fire and star power); the shop's star preview: on for 5 s, ready for 2
      const demo = previewStar && !state.players ? (now - previewStar) % 7 < 5 ? DEMO_STAR : DEMO_READY : null;
      for (let k = 0; k < players; k++) hws[k].update(P[k] || P[0], { now, dt, pulse, demo });
      let starGlow = 0; for (let k = 0; k < players; k++) starGlow = Math.max(starGlow, hws[k].starGlow);

      // lights: brighter, punchier and changing colour faster when the song is loud; dim and warm when it's calm
      const lerpK = 0.015 + 0.03 * E;
      colA.lerp(tmpC.setHex(palettes[pal][0]), lerpK); colB.lerp(tmpC.setHex(palettes[pal][1]), lerpK);
      const pk = (pulse * (0.35 + 0.9 * E) + punch * 0.35 * E) * S.beat;
      [colA, colB].forEach((col, row) => {
        glows[row].material.color.copy(col).multiplyScalar(0.45 + 0.45 * E + pk * 0.6);
        coneMats[row].uniforms.uColor.value.copy(col);
        coneMats[row].uniforms.uI.value = (0.05 + 0.08 * E + pk * 0.14) * (0.88 + 0.12 * Math.sin(now * (3 + 6 * E) + row)) * S.cone * (row ? S.back : 1);
      });
      wallSpots.forEach((s, i) => { s.color.copy(i === 1 ? colB : colA); s.intensity = (110 + 160 * E + pk * 150) * S.light; });
      stageWash.color.copy(colA); stageWash.intensity = (85 + 60 * E + pk * 70) * S.light;
      bandKey.intensity = (260 + 160 * E + pk * 120) * S.light * S.spot[1];

      const sway = (cam, base) => cam.position.set(base.x + Math.sin(now * 0.3) * 0.05, base.y + pulse * 0.025 * (0.4 + E), base.z);
      sway(camera, baseCam);
      if (players > 1) for (let k = 0; k < players; k++) sway(hwCams[k], hwCams[k].userData.base);

      // the people: crowd and band (only worked out on frames where the venue is redrawn)
      hypeS += (Math.max(hype, starGlow * 0.95) - hypeS) * Math.min(1, dt * 1.5);
      peopleDt += dt;
      if (frameNo % LEVELS[level].bgEvery === 0) {
        rimCol.copy(colA).lerp(colB, 0.35).multiplyScalar((0.55 + 0.5 * E + pk * 0.5) * S.rim);
        if (starGlow > 0.01) rimCol.lerp(sk.starRim, starGlow * 0.75);
        const fdt = Math.min(0.1, peopleDt); peopleDt = 0;
        camera.updateMatrixWorld();
        const f = { bpos, ph: phase, bar: beatTrack.bar, E: Math.min(1, E + starGlow * 0.12), P: punch, C: calm, hype: hypeS, star: starGlow, dt: fdt, now, rim: rimCol };
        crowd.update(f, camera);
        band.update(f);
      }

      haze.forEach((h) => { h.s.position.x += h.v * dt; if (h.s.position.x > 34) h.s.position.x = -34; if (h.s.position.x < -34) h.s.position.x = 34; });
      const da = dust.geometry.attributes.position;
      for (let i = 0; i < dustN; i++) { da.array[i * 3 + 1] += dt * 0.35; da.array[i * 3] += Math.sin(now * 0.7 + i) * dt * 0.15; if (da.array[i * 3 + 1] > 20) da.array[i * 3 + 1] = 0; }
      da.needsUpdate = true;

      // pyro
      pyroT += dt;
      const [pyO, pyS, pyL] = S.pyro || NO_PYRO, flames = S.fire[2] ? blueFire : fire;
      pyro.forEach((p) => {
        p.t += dt;
        const k = p.t / 1.1;
        p.col.forEach((sp, j) => {
          sp.material.map = flames[(Math.floor(now * 18) + j * 2) % flames.length];
          sp.material.opacity = (k < 1 ? Math.min(1, (1 - k) * 2.2) * 0.95 : 0) * pyO;
          sp.visible = k < 1;
          sp.scale.set((2.6 + j * 0.4) * pyS, (k < 0.25 ? k / 0.25 : 1) * (9 + j * 2) * pyS, 1);
        });
      });
      pyroLight.intensity = (pyroT < 1.1 ? (1 - pyroT / 1.1) * 900 : 0) * pyL;

      autoTune(performance.now());
      if (frameNo++ % LEVELS[level].bgEvery === 0 && SAFE[safe].post) {
        renderer.setRenderTarget(bgRT);
        renderer.render(bg, camera);
        renderer.setRenderTarget(null);
      }
      if (SAFE[safe].post) composer.render(); else drawDirect();
      if (frameNo >= probe.next) probeFrame();
    },
  };
  resize();
  return api;
}
