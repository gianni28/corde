// Corde — the looks the shop sells (same ids as the shop and the server): necks drawn on a canvas, note gems,
// hit flames, strings and trims, star power and the crowd's lights. Plain data and 2D drawings; the renderer turns
// them into materials (renderer.js setSkin) and the HUD takes its lane and star colours from cssVars().

export const LANE_HEX = [0x1fd14a, 0xe8202c, 0xf5c518, 0x1f6fe0, 0xf57a12]; // green red yellow blue orange
export const SKIN_DEFAULTS = { neck: "palo-rosa", gems: "clasicas", flames: "fuego", strings: "acero", star: "azul", crowd: "encendedores", pet: "ninguna" };

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// The neck is a 512×1024 canvas stretched over the board: across its whole width (4.5 or 5.5 lanes) and 6 world units
// along it, then repeated. So anything near the top or bottom edge is drawn again one tile away (no seam), and a
// shape drawn this much taller than wide comes out round on the board.
const TALL = 1.8;
const wrap = (h, y, m, fn) => { fn(y); if (y < m) fn(y + h); if (y > h - m) fn(y - h); };

export function grime(g, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = rnd(4, 40);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(0,0,0,${a})`); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
// soft round blots of one colour (grime that wraps), r: [min, max] radius
function blots(g, w, h, n, rgb, [a0, a1], [r0, r1]) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, r = rnd(r0, r1), a = rnd(a0, a1);
    wrap(h, Math.random() * h, r * TALL, (y) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(1, `rgba(${rgb},0)`);
      g.save(); g.translate(x, y); g.scale(1, TALL); g.translate(-x, -y);
      g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
    });
  }
}
// long wavy grain lines along the neck; whole waves per tile, so they meet themselves across the seam
function grain(g, w, h, n, cols, [a0, a1], [l0, l1], amp = 5) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, ph = Math.random() * TAU, k = 1 + Math.floor(Math.random() * 3);
    g.strokeStyle = `rgba(${pick(cols)},${rnd(a0, a1)})`; g.lineWidth = rnd(l0, l1);
    g.beginPath();
    for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin((y / h) * TAU * k + ph) * amp, y);
    g.stroke();
  }
}
// the long sides fall off (worn wood, or the binding's shadow)
function sides(g, w, h, a = 0.65, rgb = "0,0,0", reach = 0.12) {
  const e = g.createLinearGradient(0, 0, w, 0);
  e.addColorStop(0, `rgba(${rgb},${a})`); e.addColorStop(reach, `rgba(${rgb},0)`); e.addColorStop(1 - reach, `rgba(${rgb},0)`); e.addColorStop(1, `rgba(${rgb},${a})`);
  g.fillStyle = e; g.fillRect(0, 0, w, h);
}
// the play area kept calm: darkens everything but the very edges (a = how dark across the lanes), so whatever is
// painted on the board stays under the notes instead of fighting them
function calm(g, w, h, a, edge = 0.03) {
  const e = g.createLinearGradient(0, 0, w, 0);
  e.addColorStop(0, "rgba(0,0,0,0)"); e.addColorStop(edge, "rgba(0,0,0,0)"); e.addColorStop(edge + 0.1, `rgba(0,0,0,${a})`);
  e.addColorStop(1 - edge - 0.1, `rgba(0,0,0,${a})`); e.addColorStop(1 - edge, "rgba(0,0,0,0)"); e.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = e; g.fillRect(0, 0, w, h);
}
// the usual position markers: one dot, then two (like frets 3 and 5)
const dots = (w, h, dot) => { dot(w / 2, h * 0.25); dot(w * 0.3, h * 0.75); dot(w * 0.7, h * 0.75); };
function pearlDot(g, x, y, r = 14, glow = 1) {
  const rg = g.createRadialGradient(x - 5, y - 5, 1, x, y, r + 6);
  rg.addColorStop(0, `rgba(255,250,240,${0.55 * glow})`); rg.addColorStop(0.5, `rgba(217,210,195,${0.4 * glow})`); rg.addColorStop(0.85, `rgba(157,151,140,${0.25 * glow})`); rg.addColorStop(1, "rgba(60,50,40,0)");
  g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
// cracks: random walks that fork, as lists of points (drawn later in layers: glow under, white core on top)
// bend: how much each step turns; seg: [min, max] step length
function cracks(w, h, n, len, fork, bend, [s0, s1]) {
  const out = [];
  const walk = (x, y, a, left) => {
    const pts = [[x, y]];
    while (left-- > 0) {
      a += rnd(-bend, bend); const s = rnd(s0, s1);
      x += Math.cos(a) * s; y += Math.sin(a) * s * TALL;
      pts.push([x, y]);
      if (Math.random() < fork && left > 2) walk(x, y, a + (Math.random() < 0.5 ? -1 : 1) * rnd(0.5, 1.1), Math.floor(left * rnd(0.3, 0.6)));
      if (x < -20 || x > w + 20) break;
    }
    out.push(pts);
  };
  for (let i = 0; i < n; i++) walk(Math.random() * w, Math.random() * h, rnd(0, TAU), len);
  return out;
}
// smooth value noise, 0..1, on a grid of nx × ny cells that wraps along the neck: f(u across 0..1, t along 0..1)
function valueNoise(nx, ny) {
  const v = Array.from({ length: (nx + 1) * ny }, Math.random);
  const at = (i, j) => v[(j % ny) * (nx + 1) + i];
  return (u, t) => {
    const x = u * nx, y = t * ny, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}
// fills the canvas from a per-pixel colour function, worked out at half size and scaled up (cheap on a phone)
function shade(g, w, h, fn) {
  const lw = w / 2, lh = h / 2, c = document.createElement("canvas"); c.width = lw; c.height = lh;
  const cg = c.getContext("2d"), img = cg.createImageData(lw, lh), d = img.data, rgb = [0, 0, 0];
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    fn(x / lw, y / lh, rgb, x, y);
    const k = (y * lw + x) * 4; d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = 255;
  }
  cg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(c, 0, 0, w, h);
}
function strokeAll(g, h, paths, style, lw) {
  g.strokeStyle = style; g.lineWidth = lw; g.lineJoin = g.lineCap = "round";
  for (const dy of [-h, 0, h]) for (const p of paths) { g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy))); g.stroke(); }
}

/* ================= necks ================= */
// today's rosewood (the default)
function rosewood(g, w, h) {
  g.fillStyle = "#2a1610"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * w, a = rnd(0.03, 0.12);
    g.strokeStyle = Math.random() < 0.55 ? `rgba(90,52,30,${a})` : `rgba(8,3,2,${a * 1.8})`;
    g.lineWidth = rnd(0.5, 3);
    g.beginPath(); g.moveTo(x, 0);
    const ph = Math.random() * 10;
    for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.006 + ph) * 5, y);
    g.stroke();
  }
  grime(g, w, h, 60, 0.18);
  // darker edges, like a worn neck
  sides(g, w, h);
  // mother-of-pearl dots
  dots(w, h, (x, y) => pearlDot(g, x, y));
}

// light maple, black dots
function maple(g, w, h) {
  g.fillStyle = "#c39358"; g.fillRect(0, 0, w, h);
  // broad streaks of lighter and darker wood, then the fine grain
  for (let i = 0; i < 16; i++) {
    const x = rnd(0, w), bw = rnd(16, 70), c = Math.random() < 0.5 ? "255,224,168" : "128,76,34";
    const gr = g.createLinearGradient(x - bw, 0, x + bw, 0);
    gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(0.5, `rgba(${c},${rnd(0.06, 0.18)})`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.fillRect(x - bw, 0, bw * 2, h);
  }
  grain(g, w, h, 300, ["150,92,44", "112,64,28", "255,236,196"], [0.05, 0.18], [0.5, 1.8], 3);
  blots(g, w, h, 26, "90,50,20", [0.05, 0.1], [8, 30]);
  sides(g, w, h, 0.55, "40,20,6", 0.1);
  dots(w, h, (x, y) => {
    const rg = g.createRadialGradient(x - 4, y - 4, 1, x, y, 15);
    rg.addColorStop(0, "#3a3430"); rg.addColorStop(0.35, "#0c0a09"); rg.addColorStop(0.9, "#050404"); rg.addColorStop(1, "rgba(5,4,4,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
  });
}

// ebony: near black, very fine grain, bright pearl dots
function ebony(g, w, h) {
  g.fillStyle = "#100c0a"; g.fillRect(0, 0, w, h);
  grain(g, w, h, 14, ["52,36,26"], [0.12, 0.25], [8, 26], 6); // faint brown streaks
  grain(g, w, h, 400, ["34,25,20", "0,0,0", "58,44,34"], [0.12, 0.4], [0.3, 1], 2);
  blots(g, w, h, 30, "0,0,0", [0.15, 0.3], [10, 40]);
  sides(g, w, h, 0.7);
  dots(w, h, (x, y) => {
    pearlDot(g, x, y, 14, 1.6);
    const rg = g.createRadialGradient(x, y, 4, x, y, 13); // a hint of colour in the shell
    rg.addColorStop(0, "rgba(180,220,255,0)"); rg.addColorStop(0.7, "rgba(190,170,255,.18)"); rg.addColorStop(1, "rgba(160,255,220,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill();
  });
}

// woodland camo, muted
function camo(g, w, h) {
  // woodland pattern: each colour is where its own noise field is high; olive under brown under green under black
  const layer = () => { const a = valueNoise(5, 12), b = valueNoise(13, 30); return (u, t) => a(u, t) * 0.72 + b(u, t) * 0.28; };
  const brown = layer(), green = layer(), black = layer(), tan = layer();
  const pal = [[70, 70, 44], [92, 84, 56], [76, 58, 38], [44, 54, 30], [20, 21, 16]];
  shade(g, w, h, (u, t, out) => {
    const c = black(u, t) > 0.64 ? 4 : green(u, t) > 0.57 ? 3 : brown(u, t) > 0.56 ? 2 : tan(u, t) > 0.6 ? 1 : 0;
    out[0] = pal[c][0]; out[1] = pal[c][1]; out[2] = pal[c][2];
  });
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "200,200,160"},${rnd(0.03, 0.08)})`; g.fillRect(rnd(0, w), rnd(0, h), 2, 2); } // cloth
  g.fillStyle = "rgba(10,12,6,.25)"; g.fillRect(0, 0, w, h);
  sides(g, w, h, 0.6);
}

// dark rosewood with big mother-of-pearl blocks (a Les Paul Custom)
// Nácar: dark wood bound in mother-of-pearl along both edges, small pearl inlays. Everything bright runs along the neck,
// none of it across: wide light blocks rushing at you flicker as they pass, and that made people dizzy.
function pearlBlocks(g, w, h) {
  g.fillStyle = "#1f120c"; g.fillRect(0, 0, w, h);
  grain(g, w, h, 380, ["86,50,30", "8,3,2", "60,34,20"], [0.04, 0.16], [0.5, 2.6], 5);
  blots(g, w, h, 40, "0,0,0", [0.1, 0.2], [6, 34]);
  sides(g, w, h, 0.5, "0,0,0", 0.16);
  // the binding: a pearly strip on each side whose colours drift slowly along it (whole cycles: the texture repeats)
  const bw = w * 0.055;
  for (const x0 of [w * 0.035, w - w * 0.035 - bw]) {
    g.fillStyle = "#a8a296"; g.fillRect(x0, 0, bw, h);
    const cols = ["255,170,215", "130,255,215", "150,190,255", "255,230,160"];
    for (let y = 0; y < h; y += 4) {
      cols.forEach((c, k) => {
        const a = 0.22 * Math.max(0, Math.sin((y / h) * TAU * (2 + k) + k * 1.7 + x0));
        if (a > 0.01) { g.fillStyle = `rgba(${c},${a.toFixed(3)})`; g.fillRect(x0, y, bw, 4); }
      });
    }
    const sh = g.createLinearGradient(x0, 0, x0 + bw, 0);
    sh.addColorStop(0, "rgba(30,18,10,.55)"); sh.addColorStop(0.35, "rgba(255,255,255,.12)"); sh.addColorStop(0.65, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(30,18,10,.55)");
    g.fillStyle = sh; g.fillRect(x0, 0, bw, h);
    g.strokeStyle = "rgba(10,5,3,.85)"; g.lineWidth = 2; g.strokeRect(x0, -2, bw, h + 4);
  }
  // the position markers: small and soft, pearl with a hint of colour
  g.globalAlpha = 0.75; dots(w, h, (x, y) => pearlDot(g, x, y, 11, 0.8)); g.globalAlpha = 1;
}

// carbon fibre: 2×2 twill, a soft sheen down the middle
function carbon(g, w, h) {
  const cw = 16, ch = 32; // one tow crossing; about square on the board
  for (let r = 0; r < h / ch; r++) for (let c = 0; c < Math.ceil(w / cw); c++) {
    const x = c * cw, y = r * ch, up = (c + r) % 4 < 2;
    const gr = up ? g.createLinearGradient(x, 0, x + cw, 0) : g.createLinearGradient(0, y, 0, y + ch);
    gr.addColorStop(0, "#0b0c0d"); gr.addColorStop(0.45, up ? "#2e3236" : "#25282b"); gr.addColorStop(0.55, up ? "#2a2d31" : "#212427"); gr.addColorStop(1, "#0b0c0d");
    g.fillStyle = gr; g.fillRect(x, y, cw, ch);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x, y, cw, 1); g.fillRect(x, y, 1, ch); // the weave's gaps
  }
  const s = g.createLinearGradient(0, 0, w, 0);
  s.addColorStop(0, "rgba(255,255,255,0)"); s.addColorStop(0.38, "rgba(200,220,255,.07)"); s.addColorStop(0.5, "rgba(220,235,255,.11)"); s.addColorStop(0.62, "rgba(200,220,255,.07)"); s.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = s; g.fillRect(0, 0, w, h);
  sides(g, w, h, 0.6, "0,0,0", 0.08);
}

// Fear of the Dark (the Iron Maiden event): the cover's night: a dark blue wood under the full moon, twisted black
// branches reaching in from both sides like fingers, mist, and eyes glowing in the dark between the trees. The trees
// keep to the edges and only their twigs reach over the lanes; everything is drawn wrapped so the board tiles.
function fearDark(g, w, h) {
  const bg = g.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, "#1c2c60"); bg.addColorStop(0.5, "#0f1838"); bg.addColorStop(1, "#1a2a5c");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const wrap = (draw) => { for (const dy of [-h, 0, h]) { g.save(); g.translate(0, dy); draw(); g.restore(); } };
  // the full moon rising behind the right-hand trees (half of it past the edge, never over the lanes), and its cold halo
  wrap(() => {
    const mx = w - 14, my = h * 0.3, halo = g.createRadialGradient(mx, my, 20, mx, my, 200);
    halo.addColorStop(0, "rgba(170,195,255,.35)"); halo.addColorStop(1, "rgba(60,90,180,0)");
    g.fillStyle = halo; g.fillRect(mx - 220, my - 220, 440, 440);
    const moon = g.createRadialGradient(mx - 14, my - 14, 6, mx, my, 58);
    moon.addColorStop(0, "#f4f6f0"); moon.addColorStop(0.8, "#cfd6e2"); moon.addColorStop(1, "#9aa6c0");
    g.fillStyle = moon; g.beginPath(); g.arc(mx, my, 58, 0, TAU); g.fill();
    g.fillStyle = "rgba(120,130,160,.35)"; for (const [x, y, r] of [[-18, 10, 12], [14, -16, 8], [20, 18, 10]]) { g.beginPath(); g.arc(mx + x, my + y, r, 0, TAU); g.fill(); }
  });
  // mist drifting low between the trunks
  for (let i = 0; i < 26; i++) {
    const x = rnd(0, w), y = rnd(0, h), r = rnd(40, 120);
    wrap(() => { const m = g.createRadialGradient(x, y, 0, x, y, r); m.addColorStop(0, "rgba(110,140,210,.12)"); m.addColorStop(1, "rgba(110,140,210,0)"); g.fillStyle = m; g.fillRect(x - r, y - r, r * 2, r * 2); });
  }
  // the branches: crooked, forking, thinning to twigs; a moonlit edge under the black
  const limbs = [];
  const grow = (x, y, ang, len, wd, depth) => {
    const bend = rnd(-0.6, 0.6), x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * 0.4, cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * 0.4;
    limbs.push([x, y, cx, cy, x2, y2, wd]);
    if (depth > 0) for (let k = 0, n = depth > 2 ? 2 : 3; k < n; k++) grow(x2, y2, ang + rnd(-0.85, 0.85), len * rnd(0.6, 0.8), wd * 0.62, depth - 1);
  };
  for (let y = 60; y < h; y += 260) {
    grow(-6, y + rnd(-40, 40), rnd(-0.55, 0.55), rnd(95, 130), 18, 4);
    grow(w + 6, y + 130 + rnd(-40, 40), Math.PI + rnd(-0.55, 0.55), rnd(95, 130), 18, 4);
  }
  g.lineCap = "round";
  for (const [col, extra] of [["rgba(140,170,240,.5)", 3], ["#020308", 0]]) {
    g.strokeStyle = col;
    for (const [x, y, cx, cy, x2, y2, wd] of limbs) wrap(() => { g.lineWidth = wd + extra; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(cx, cy, x2, y2); g.stroke(); });
  }
  // the trunks along both edges
  for (const x of [0, w]) { const t = g.createLinearGradient(x, 0, x === 0 ? 40 : w - 40, 0); t.addColorStop(0, "#010205"); t.addColorStop(1, "rgba(1,2,5,0)"); g.fillStyle = t; g.fillRect(x === 0 ? 0 : w - 40, 0, 40, h); }
  // eyes in the dark: slanted yellow pairs with a glow, among the trees at the edges
  for (const [x, y] of [[0.12, 0.15], [0.9, 0.62], [0.17, 0.55], [0.86, 0.9], [0.1, 0.86]]) {
    const ex = w * x, ey = h * y;
    wrap(() => {
      const gl = g.createRadialGradient(ex, ey, 0, ex, ey, 34); gl.addColorStop(0, "rgba(255,210,60,.35)"); gl.addColorStop(1, "rgba(255,180,40,0)");
      g.fillStyle = gl; g.fillRect(ex - 34, ey - 34, 68, 68);
      g.fillStyle = "#ffe070";
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(ex + s * 11, ey, 7, 3, s * -0.35, 0, TAU); g.fill(); }
    });
  }
  calm(g, w, h, 0.2);
  sides(g, w, h, 0.6, "0,0,0", 0.05);
}

// dark wood with warm 70s stripes down both sides
function retro(g, w, h) {
  g.fillStyle = "#2a170e"; g.fillRect(0, 0, w, h);
  grain(g, w, h, 360, ["92,54,30", "10,4,2", "120,66,30"], [0.04, 0.14], [0.5, 2.4], 4);
  blots(g, w, h, 30, "0,0,0", [0.08, 0.16], [8, 36]);
  sides(g, w, h, 0.5, "0,0,0", 0.05);
  const bands = [["#e0a526", 16], ["#e8641c", 16], ["#9a4416", 16]]; // mustard, orange, brown (outside in)
  for (const dir of [1, -1]) {
    let x = 6;
    for (const [col, bw] of bands) {
      const x0 = dir > 0 ? x : w - x - bw;
      g.fillStyle = col; g.fillRect(x0, 0, bw, h);
      const sh = g.createLinearGradient(x0, 0, x0 + bw, 0); // a rounded, slightly faded paint stripe
      sh.addColorStop(0, "rgba(0,0,0,.35)"); sh.addColorStop(0.4, "rgba(255,240,200,.18)"); sh.addColorStop(1, "rgba(0,0,0,.35)");
      g.fillStyle = sh; g.fillRect(x0, 0, bw, h);
      x += bw + 4;
    }
  }
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(30,14,6,${rnd(0.05, 0.16)})`; g.fillRect(rnd(0, w), rnd(0, h), rnd(1, 3), rnd(1, 4)); } // worn paint
}

// deep blue ice with white frost cracks
function ice(g, w, h) {
  const b = g.createLinearGradient(0, 0, w, 0);
  b.addColorStop(0, "#061a33"); b.addColorStop(0.5, "#0f3a66"); b.addColorStop(1, "#061a33");
  g.fillStyle = b; g.fillRect(0, 0, w, h);
  blots(g, w, h, 40, "120,190,255", [0.05, 0.12], [20, 70]);
  blots(g, w, h, 24, "0,8,30", [0.15, 0.3], [20, 60]);
  // a few long straight fractures with short splinters, and frost blooming around them
  // (soft: bright white lines all over the board, rushing by, fought the notes)
  const cs = cracks(w, h, 6, 9, 0.3, 0.28, [22, 60]);
  strokeAll(g, h, cs, "rgba(150,215,255,.06)", 14);
  strokeAll(g, h, cs, "rgba(170,225,255,.1)", 5);
  strokeAll(g, h, cs, "rgba(215,242,255,.28)", 2);
  strokeAll(g, h, cs, "rgba(255,255,255,.45)", 0.8);
  calm(g, w, h, 0.25);
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(230,246,255,${rnd(0.03, 0.18)})`; const r = rnd(0.4, 1.4); g.fillRect(rnd(0, w), rnd(0, h), r, r * TALL); } // frost
  sides(g, w, h, 0.45, "210,236,255", 0.1); // frosted along the sides
}

// black basalt crust split by glowing lava (the glow is the texture itself: it lights the neck)
function lava(g, w, h) {
  // plates of crust (a Voronoi map, wrapping along the neck): the closer to a seam, the hotter; some seams run cooler
  const lw = w / 2, lh = h / 2, cell = 76, nx = Math.ceil(lw / cell), ny = Math.round(lh / cell), cy = lh / ny;
  const seeds = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) seeds.push([(i + rnd(0.1, 0.9)) * cell, (j + rnd(0.1, 0.9)) * cy, rnd(0.35, 1)]);
  shade(g, w, h, (u, t, out, x, y) => {
    const i0 = Math.floor(x / cell), j0 = Math.floor(y / cy);
    let f1 = 1e9, f2 = 1e9, s1 = null, s2 = null;
    for (let dj = -1; dj <= 1; dj++) {
      const j = j0 + dj, oy = j < 0 ? -lh : j >= ny ? lh : 0, row = ((j + ny) % ny) * nx;
      for (let di = -1; di <= 1; di++) {
        const i = i0 + di; if (i < 0 || i >= nx) continue;
        const s = seeds[row + i], dx = s[0] - x, dy = (s[1] + oy - y) * 0.75, dd = dx * dx + dy * dy;
        if (dd < f1) { f2 = f1; s2 = s1; f1 = dd; s1 = s; } else if (dd < f2) { f2 = dd; s2 = s; }
      }
    }
    const e = Math.sqrt(f2) - Math.sqrt(f1), hot = Math.min(s1[2], s2[2]); // distance to the seam, that seam's heat
    const heat = Math.exp(-e / (0.9 + 1.2 * hot)) * (0.45 + 0.55 * hot), warm = Math.exp(-e / 7) * hot;
    out[0] = Math.min(255, 14 + 225 * heat + 110 * warm); out[1] = Math.min(255, 9 + 175 * heat * heat + 16 * warm); out[2] = Math.min(255, 8 + 95 * heat * heat * heat);
  });
  // the crust: rough specks, darker hollows
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "70,60,56" : "0,0,0"},${rnd(0.1, 0.35)})`; g.fillRect(rnd(0, w), rnd(0, h), rnd(1, 3), rnd(1, 3)); }
  blots(g, w, h, 30, "0,0,0", [0.2, 0.4], [10, 40]);
  blots(g, w, h, 8, "255,80,10", [0.06, 0.12], [30, 70]); // heat under the crust
  calm(g, w, h, 0.3);
  sides(g, w, h, 0.7);
}

// black lacquer with hot-rod flames painted down both sides
function paintedFlames(g, w, h) {
  g.fillStyle = "#070707"; g.fillRect(0, 0, w, h);
  const gl = g.createLinearGradient(0, 0, w, 0); // the lacquer's shine
  gl.addColorStop(0.25, "rgba(255,255,255,0)"); gl.addColorStop(0.42, "rgba(255,255,255,.06)"); gl.addColorStop(0.5, "rgba(255,255,255,.02)"); gl.addColorStop(0.6, "rgba(255,255,255,0)");
  g.fillStyle = gl; g.fillRect(0, 0, w, h);
  // long tongues leave each side and sweep away from the player to a pointed tip, each one over the one ahead of it
  // (yellow where it starts, red at the tip, a blue pinstripe round it). The canvas is squashed 1.8× along the neck.
  const n = 4, step = h / n, licks = [];
  // they stay close to the edges (the outer notes run over them) and darken towards the lanes, so the notes keep their contrast
  for (let k = 0; k < n; k++) licks.push({ len: rnd(480, 640), dep: rnd(44, 62), wid: rnd(120, 170), off: rnd(-30, 30), hook: rnd(-10, 6) });
  const path = (yb, { len, dep, wid, hook }) => {
    const tip = yb - len;
    g.beginPath(); g.moveTo(-14, yb);
    // the inner edge bellies out, narrows, and flicks in at the tip; the outer edge comes back in an S
    g.bezierCurveTo(dep * 0.8, yb - len * 0.04, dep * 1.15, yb - len * 0.3, dep * 0.85, yb - len * 0.55);
    g.bezierCurveTo(dep * 0.6, yb - len * 0.75, dep * 0.55 + hook, yb - len * 0.9, dep * 0.75 + hook, tip);
    g.bezierCurveTo(dep * 0.3, yb - len * 0.88, dep * 0.15, yb - len * 0.7, dep * 0.3, yb - len * 0.5);
    g.bezierCurveTo(dep * 0.42, yb - len * 0.38, dep * 0.1, yb - wid, -14, yb - wid * 1.1);
    g.closePath();
  };
  for (const side of [0, 1]) {
    g.save(); if (side) { g.translate(w, 0); g.scale(-1, 1); }
    g.lineJoin = "round";
    for (let k = -3; k <= n + 1; k++) { // far ones first (the canvas's top is the far end), repeated past both ends
      const L = licks[((k % n) + n) % n], yb = k * step + L.off + (side ? step * 0.5 : 0);
      path(yb, L);
      g.strokeStyle = "rgba(0,0,0,.85)"; g.lineWidth = 7; g.stroke();
      g.strokeStyle = "rgba(60,184,255,.55)"; g.lineWidth = 2.5; g.stroke(); // the pinstripe (its inner half gets covered)
      const f = g.createLinearGradient(0, yb, L.dep * 0.6, yb - L.len);
      f.addColorStop(0, "#f0c040"); f.addColorStop(0.25, "#e88a1a"); f.addColorStop(0.55, "#c43a0e"); f.addColorStop(1, "#6a0806");
      g.fillStyle = f; g.fill();
    }
    g.restore();
  }
  calm(g, w, h, 0.55, 0.02);
  sides(g, w, h, 0.45, "0,0,0", 0.04);
}

// synthwave: very dark purple, a thin glowing cyan and pink grid
function neonGrid(g, w, h) {
  const b = g.createLinearGradient(0, 0, w, 0);
  b.addColorStop(0, "#07020f"); b.addColorStop(0.5, "#150530"); b.addColorStop(1, "#07020f");
  g.fillStyle = b; g.fillRect(0, 0, w, h);
  blots(g, w, h, 10, "120,30,200", [0.05, 0.1], [40, 90]);
  const line = (x0, y0, x1, y1, rgb) => {
    for (const [lw, a] of [[9, 0.07], [4, 0.16], [1.4, 0.85]]) { g.strokeStyle = `rgba(${rgb},${a})`; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  };
  const gy = h / 8; // across: every 0.75 units, so it never lines up with the beat bars for long
  g.globalAlpha = 0.4; for (let k = 0; k <= 8; k++) line(0, k * gy, w, k * gy, "255,50,210"); g.globalAlpha = 1; // dim: lines across rush at you
  for (let k = 1; k < 8; k++) line((k * w) / 8, 0, (k * w) / 8, h, "40,230,255");
  sides(g, w, h, 0.5, "0,0,0", 0.06);
}

// deep space: nebulae and stars
function galaxy(g, w, h) {
  g.fillStyle = "#04030c"; g.fillRect(0, 0, w, h);
  blots(g, w, h, 22, "110,40,220", [0.08, 0.16], [40, 130]);
  blots(g, w, h, 16, "40,80,235", [0.08, 0.15], [40, 110]);
  blots(g, w, h, 10, "210,40,170", [0.05, 0.1], [30, 90]);
  blots(g, w, h, 6, "40,190,210", [0.04, 0.08], [30, 80]);
  blots(g, w, h, 14, "0,0,0", [0.2, 0.4], [20, 60]); // dark dust lanes
  for (let i = 0; i < 900; i++) {
    const x = rnd(0, w), y = rnd(0, h), r = Math.random() < 0.9 ? rnd(0.4, 1.1) : rnd(1.2, 2);
    g.fillStyle = `rgba(${pick(["255,255,255", "200,220,255", "255,240,210"])},${rnd(0.3, 0.95)})`;
    g.beginPath(); g.ellipse(x, y, r, r * TALL, 0, 0, TAU); g.fill();
  }
  for (let i = 0; i < 14; i++) { // bright ones, with a glow and spikes
    const x = rnd(20, w - 20); wrap(h, rnd(0, h), 40, (y) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, 9);
      rg.addColorStop(0, "rgba(255,255,255,.9)"); rg.addColorStop(1, "rgba(160,190,255,0)");
      g.save(); g.translate(x, y); g.scale(1, TALL); g.translate(-x, -y); g.fillStyle = rg; g.fillRect(x - 9, y - 9, 18, 18); g.restore();
      g.strokeStyle = "rgba(220,235,255,.55)"; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x - 12, y); g.lineTo(x + 12, y); g.moveTo(x, y - 12 * TALL); g.lineTo(x, y + 12 * TALL); g.stroke();
    });
  }
  sides(g, w, h, 0.6, "0,0,0", 0.08);
}

// brushed gold, dark inlays (kept deep so the notes stand out on it)
function gold(g, w, h) {
  const b = g.createLinearGradient(0, 0, w, 0);
  b.addColorStop(0, "#6a4508"); b.addColorStop(0.2, "#b08020"); b.addColorStop(0.42, "#dcae44"); b.addColorStop(0.52, "#f0cc68"); b.addColorStop(0.62, "#d2a23a"); b.addColorStop(0.82, "#a07018"); b.addColorStop(1, "#6a4508");
  g.fillStyle = b; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) { // brushed along the neck
    g.strokeStyle = Math.random() < 0.5 ? `rgba(255,236,170,${rnd(0.03, 0.12)})` : `rgba(80,48,4,${rnd(0.03, 0.14)})`;
    g.lineWidth = rnd(0.5, 1.6); const x = rnd(0, w); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  blots(g, w, h, 20, "40,24,4", [0.06, 0.14], [20, 60]);
  dots(w, h, (x, y) => {
    g.fillStyle = "#e9cf7a"; g.beginPath(); g.ellipse(x, y, 16, 16, 0, 0, TAU); g.fill(); // a polished rim
    const rg = g.createRadialGradient(x - 4, y - 5, 1, x, y, 14);
    rg.addColorStop(0, "#4a3a2c"); rg.addColorStop(0.4, "#140e08"); rg.addColorStop(1, "#060403");
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, 13, 0, TAU); g.fill();
  });
  sides(g, w, h, 0.5, "30,18,2", 0.08);
}

// the legend's neck: black, gold filigree down both sides, crowns
function legend(g, w, h) {
  g.fillStyle = "#080605"; g.fillRect(0, 0, w, h);
  grain(g, w, h, 300, ["30,22,16", "0,0,0"], [0.1, 0.3], [0.4, 1.2], 2);
  sides(g, w, h, 0.7, "0,0,0", 0.08);
  const goldStroke = (lw) => {
    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = "#5a3a0c"; g.lineWidth = lw + 1.6; g.stroke();
    g.strokeStyle = "#d6a83c"; g.lineWidth = lw; g.stroke();
    g.strokeStyle = "rgba(255,240,180,.75)"; g.lineWidth = lw * 0.35; g.stroke();
  };
  // a vine with a curl at every crest (period 256: four per tile), mirrored on both sides
  const per = 256;
  for (const side of [0, 1]) {
    g.save(); if (side) { g.translate(w, 0); g.scale(-1, 1); }
    g.beginPath(); for (let y = -8; y <= h + 8; y += 4) g.lineTo(30 + Math.sin((y / per) * TAU) * 9, y); goldStroke(2.4);
    for (let k = -1; k <= h / per; k++) {
      for (const half of [0, 1]) {
        const y0 = k * per + per * (half ? 0.75 : 0.25), x0 = 30 + (half ? -9 : 9), dir = half ? 1 : -1;
        // a spiral leaving the vine, inwards then rolling up
        g.beginPath(); g.moveTo(x0, y0);
        const cx = x0 + 22, cy = y0 + dir * 26;
        for (let a = 0; a <= TAU * 1.35; a += 0.15) { const r = 20 * (1 - a / (TAU * 1.6)); g.lineTo(cx - Math.cos(a) * r, cy - dir * Math.sin(a) * r * 1.5); }
        goldStroke(1.8);
        g.beginPath(); g.ellipse(x0 + 4, y0 - dir * 26, 4, 11, dir * 0.4, 0, TAU); g.fillStyle = "#c99a32"; g.fill(); // a leaf
      }
    }
    g.restore();
  }
  const crown = (cx, cy, s) => {
    g.save(); g.translate(cx, cy); g.scale(s, s * TALL);
    g.beginPath();
    g.moveTo(-44, 22); g.lineTo(-44, 4); g.lineTo(-48, -16); g.lineTo(-33, -2); g.lineTo(-24, -22); g.lineTo(-12, -4); g.lineTo(0, -32); g.lineTo(12, -4); g.lineTo(24, -22); g.lineTo(33, -2); g.lineTo(48, -16); g.lineTo(44, 4); g.lineTo(44, 22); g.closePath();
    const f = g.createLinearGradient(0, -32, 0, 22);
    f.addColorStop(0, "#fff0b0"); f.addColorStop(0.45, "#d9a632"); f.addColorStop(1, "#7a4e0e");
    g.fillStyle = f; g.fill(); g.lineJoin = "round"; g.strokeStyle = "#3a2406"; g.lineWidth = 2.2; g.stroke();
    g.fillStyle = "#3a2406"; g.fillRect(-44, 4, 88, 2.4);
    for (const [x, y] of [[-48, -16], [-24, -22], [0, -32], [24, -22], [48, -16]]) { g.beginPath(); g.arc(x, y - 3, 4.2, 0, TAU); g.fillStyle = "#ffe9a0"; g.fill(); g.stroke(); }
    for (const [x, c, r] of [[-26, "#1f5fd8", 4], [0, "#d01a2a", 6], [26, "#1aa050", 4]]) { g.beginPath(); g.arc(x, 13, r, 0, TAU); g.fillStyle = c; g.fill(); g.lineWidth = 1.4; g.stroke(); }
    g.restore();
  };
  crown(w / 2, h * 0.27, 1.25);
  // a small diamond between the crowns (on the seam: drawn on both ends)
  wrap(h, h * 0.77, 0, (y) => {
    g.beginPath(); g.moveTo(w / 2, y - 22 * TALL); g.lineTo(w / 2 + 22, y); g.lineTo(w / 2, y + 22 * TALL); g.lineTo(w / 2 - 22, y); g.closePath();
    g.fillStyle = "#c99a32"; g.fill(); g.strokeStyle = "#3a2406"; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.moveTo(w / 2, y - 12 * TALL); g.lineTo(w / 2 + 12, y); g.lineTo(w / 2, y + 12 * TALL); g.lineTo(w / 2 - 12, y); g.closePath();
    g.fillStyle = "#120c06"; g.fill();
  });
}

/* --- the tour's prizes (tour.js TOUR_PRIZES) --- */
const rrect = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h)); // older Safari: square corners
// the garage tour: worn wood covered in band stickers
function stickers(g, w, h) {
  g.fillStyle = "#5a3820"; g.fillRect(0, 0, w, h);
  grain(g, w, h, 260, ["120,80,44", "40,22,10"], [0.06, 0.16], [0.5, 2.5], 4);
  grime(g, w, h, 50, 0.16);
  sides(g, w, h, 0.6);
  const cols = ["#ff4f6a", "#ffd23a", "#3fd06a", "#3fa8ff", "#b46bff", "#ff8a2a", "#f2f2f2"];
  const words = ["ROCK", "CORDE", "LIVE", "TOUR", "¡OTRA!", "BIS"];
  const star = (r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } g.closePath(); };
  const bolt = (r) => { g.beginPath(); g.moveTo(-r * 0.2, -r); g.lineTo(r * 0.5, -r); g.lineTo(r * 0.05, -r * 0.1); g.lineTo(r * 0.55, -r * 0.1); g.lineTo(-r * 0.35, r); g.lineTo(-r * 0.05, r * 0.05); g.lineTo(-r * 0.5, r * 0.05); g.closePath(); };
  const pickRect = (r) => { g.beginPath(); g.ellipse(0, 0, r, r * 0.62, 0, 0, TAU); };
  // a grid with jitter so they spread over the whole tile (and wrap across its ends)
  const rows = 7, colsN = 3;
  for (let ry = 0; ry < rows; ry++) for (let cx = 0; cx < colsN; cx++) {
    if (Math.random() < 0.6) continue; // sparse: they're under the notes
    const x = ((cx + 0.5) / colsN) * w + rnd(-40, 40), y0 = ((ry + 0.5) / rows) * h + rnd(-30, 30), rot = rnd(-0.5, 0.5);
    const kind = pick(["star", "bolt", "word", "dot", "pick", "word"]), c = pick(cols), r = rnd(17, 24);
    wrap(h, y0, r * TALL * 1.4, (y) => {
      g.save(); g.translate(x, y); g.scale(1, TALL); g.rotate(rot); g.globalAlpha = 0.42; // faded, so the notes stay on top
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 6; g.shadowOffsetY = 2;
      if (kind === "word") {
        const t = pick(words); g.font = `900 ${Math.round(r * 0.75)}px Impact, "Arial Black", sans-serif`;
        const tw = g.measureText(t).width + 18, th = r * 1.05;
        g.fillStyle = "#f6f1e6"; g.beginPath(); rrect(g, -tw / 2 - 4, -th / 2 - 4, tw + 8, th + 8, 8); g.fill();
        g.shadowBlur = 0; g.fillStyle = c === "#f2f2f2" ? "#1a1a1a" : c; g.beginPath(); rrect(g, -tw / 2, -th / 2, tw, th, 6); g.fill();
        g.fillStyle = c === "#ffd23a" || c === "#f2f2f2" ? "#1a1a1a" : "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, 0, 2);
      } else {
        const shape = kind === "star" ? star : kind === "bolt" ? bolt : kind === "pick" ? pickRect : (rr) => { g.beginPath(); g.arc(0, 0, rr * 0.8, 0, TAU); };
        g.lineJoin = "round"; g.fillStyle = "#f6f1e6"; shape(r + 6); g.fill(); g.shadowBlur = 0;
        g.fillStyle = c; shape(r); g.fill();
        if (kind === "dot") { g.fillStyle = "rgba(0,0,0,.75)"; g.beginPath(); g.arc(0, 0, r * 0.28, 0, TAU); g.fill(); }
      }
      g.restore();
    });
  }
  blots(g, w, h, 16, "0,0,0", [0.08, 0.18], [20, 60]); // worn over the stickers too
}

// the festivals tour: a black stage cut by laser beams in the haze
function lasers(g, w, h) {
  g.fillStyle = "#050308"; g.fillRect(0, 0, w, h);
  blots(g, w, h, 18, "60,20,90", [0.08, 0.16], [40, 110]); // haze
  blots(g, w, h, 10, "10,70,40", [0.06, 0.12], [40, 100]);
  const beam = (x0, y0, x1, y1, rgb) => {
    for (const [lw, a] of [[22, 0.05], [10, 0.12], [4, 0.35], [1.6, 0.95]]) { g.strokeStyle = `rgba(${rgb},${a})`; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  };
  // fans of beams from both sides; each one crosses the tile and comes back on the next (whole tile: no seam)
  g.globalAlpha = 0.55; // dimmer than a real laser: the notes go over it
  for (let k = 0; k < 2; k++) {
    const y = (k / 2) * h, rgb = k % 2 ? "255,40,200" : "60,255,90";
    for (let j = 0; j < 2; j++) {
      const dy = (j - 0.5) * 90;
      beam(0, y, w, y + h / 8 + dy, rgb); beam(0, y + h, w, y + h + h / 8 + dy, rgb); beam(0, y - h, w, y - h + h / 8 + dy, rgb);
      beam(w, y + h / 8, 0, y + h / 4 + dy, rgb === "60,255,90" ? "40,220,255" : "255,200,40");
      beam(w, y + h / 8 - h, 0, y + h / 4 - h + dy, rgb === "60,255,90" ? "40,220,255" : "255,200,40");
    }
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.05, 0.25)})`; g.fillRect(rnd(0, w), rnd(0, h), 1.5, 1.5); } // dust in the light
  sides(g, w, h, 0.7, "0,0,0", 0.1);
}

// the world tour: the night side of the Earth, city lights and the routes of the tour in gold
function worldTour(g, w, h) {
  const b = g.createLinearGradient(0, 0, w, 0);
  b.addColorStop(0, "#020611"); b.addColorStop(0.5, "#06122a"); b.addColorStop(1, "#020611");
  g.fillStyle = b; g.fillRect(0, 0, w, h);
  // lines of latitude and longitude
  g.strokeStyle = "rgba(90,140,220,.14)"; g.lineWidth = 1;
  for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(0, (k * h) / 8); g.lineTo(w, (k * h) / 8); g.stroke(); }
  for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo((k * w) / 6, 0); g.lineTo((k * w) / 6, h); g.stroke(); }
  // land: soft dark masses, lit by towns
  blots(g, w, h, 14, "30,46,70", [0.35, 0.55], [50, 110]);
  const cities = [];
  for (let i = 0; i < 9; i++) cities.push([rnd(60, w - 60), rnd(0, h)]);
  for (const [cx, cy] of cities) {
    for (let i = 0; i < 70; i++) { // a cluster of lights, brighter in the middle
      const r = Math.abs(rnd(-1, 1) * rnd(0, 1)) * 46, a = rnd(0, TAU);
      const x = cx + Math.cos(a) * r; wrap(h, cy + Math.sin(a) * r * TALL, 4, (y) => { g.fillStyle = `rgba(255,${Math.round(rnd(170, 225))},120,${rnd(0.35, 0.9)})`; g.fillRect(x, y, rnd(1, 2.4), rnd(1, 2.4)); });
    }
    wrap(h, cy, 30, (y) => { const rg = g.createRadialGradient(cx, y, 0, cx, y, 26); rg.addColorStop(0, "rgba(255,200,110,.35)"); rg.addColorStop(1, "rgba(255,200,110,0)"); g.fillStyle = rg; g.fillRect(cx - 26, y - 26, 52, 52); });
  }
  // the routes: golden arcs from city to city, a dashed trail and a little plane on each
  g.lineCap = "round";
  for (let i = 0; i < cities.length; i++) {
    const [x0, y0] = cities[i], [x1, y1raw] = cities[(i + 1) % cities.length];
    const y1 = Math.abs(y1raw - y0) > h / 2 ? y1raw + (y1raw < y0 ? h : -h) : y1raw;
    const mx = (x0 + x1) / 2 + (i % 2 ? 60 : -60), my = (y0 + y1) / 2;
    for (const off of [-h, 0, h]) {
      g.setLineDash([10, 9]); g.strokeStyle = "rgba(255,206,90,.75)"; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(x0, y0 + off); g.quadraticCurveTo(mx, my + off, x1, y1 + off); g.stroke(); g.setLineDash([]);
      const t = 0.55, px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, py = (1 - t) * (1 - t) * (y0 + off) + 2 * (1 - t) * t * (my + off) + t * t * (y1 + off);
      const ang = Math.atan2(2 * (1 - t) * (my - y0) + 2 * t * (y1 - my), 2 * (1 - t) * (mx - x0) + 2 * t * (x1 - mx));
      g.save(); g.translate(px, py); g.scale(1, TALL); g.rotate(ang); g.fillStyle = "#fff3c4";
      g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, -3); g.lineTo(-10, 0); g.lineTo(-8, 3); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(2, 0); g.lineTo(-4, -10); g.lineTo(-7, -10); g.lineTo(-3, 0); g.lineTo(-7, 10); g.lineTo(-4, 10); g.closePath(); g.fill();
      g.restore();
    }
  }
  sides(g, w, h, 0.6, "0,0,0", 0.08);
}

// the song of the day's 30-day prize: black leather, barbed wire down both sides, a skull
function skullNeck(g, w, h) {
  g.fillStyle = "#0c0a0a"; g.fillRect(0, 0, w, h);
  grain(g, w, h, 220, ["40,34,32", "0,0,0"], [0.1, 0.3], [0.5, 2], 3); // the leather's grain
  blots(g, w, h, 30, "60,50,48", [0.05, 0.12], [10, 40]);
  sides(g, w, h, 0.7, "0,0,0", 0.08);
  // barbed wire: two twisted strands and a barb every so often
  for (const x0 of [26, w - 26]) {
    for (const ph of [0, Math.PI]) {
      g.strokeStyle = "#5a5a62"; g.lineWidth = 3.2; g.beginPath();
      for (let y = 0; y <= h; y += 4) g.lineTo(x0 + Math.sin((y / h) * TAU * 16 + ph) * 5, y);
      g.stroke();
      g.strokeStyle = "rgba(220,220,230,.55)"; g.lineWidth = 1; g.stroke();
    }
    for (let y = 16; y < h; y += 64) {
      g.strokeStyle = "#7a7a84"; g.lineWidth = 2.4; g.beginPath();
      g.moveTo(x0 - 11, y - 9); g.lineTo(x0 + 11, y + 9); g.moveTo(x0 + 11, y - 9); g.lineTo(x0 - 11, y + 9); g.stroke();
    }
  }
  // the skull (crossed bones behind it), bone white and worn
  const skull = (cx, cy, s) => {
    g.save(); g.translate(cx, cy); g.scale(s, s * TALL);
    g.lineCap = "round";
    for (const d of [-1, 1]) { // the bones
      g.strokeStyle = "#cfc8b8"; g.lineWidth = 12; g.beginPath(); g.moveTo(-58 * d, -44); g.lineTo(58 * d, 50); g.stroke();
      g.fillStyle = "#cfc8b8"; for (const [x, y] of [[-58 * d, -44], [58 * d, 50]]) { g.beginPath(); g.arc(x - 6, y, 9, 0, TAU); g.arc(x + 6, y, 9, 0, TAU); g.fill(); }
    }
    const bone = g.createRadialGradient(-12, -20, 6, 0, -6, 60); bone.addColorStop(0, "#f4efe2"); bone.addColorStop(1, "#b8b09c");
    g.fillStyle = bone;
    g.beginPath(); g.arc(0, -12, 40, Math.PI * 0.92, Math.PI * 0.08); g.lineTo(26, 22); g.lineTo(22, 38); g.lineTo(-22, 38); g.lineTo(-26, 22); g.closePath(); g.fill();
    g.fillStyle = "#0c0a0a";
    for (const d of [-1, 1]) { g.beginPath(); g.ellipse(16 * d, -10, 12, 14, d * 0.25, 0, TAU); g.fill(); } // the eyes
    g.beginPath(); g.moveTo(0, 6); g.lineTo(-6, 18); g.lineTo(6, 18); g.closePath(); g.fill();                 // the nose
    g.strokeStyle = "#0c0a0a"; g.lineWidth = 2.4; for (let x = -15; x <= 15; x += 7.5) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x, 38); g.stroke(); } // the teeth
    g.restore();
  };
  g.globalAlpha = 0.42; skull(w / 2, h * 0.3, 1.05); skull(w / 2, h * 0.8, 0.7); g.globalAlpha = 1; // faint: right under the yellow notes
}

// draw: the canvas; emissive: how much the neck lights itself (light woods less, so the notes keep their contrast);
// tint: colour of that self-light; rough/metal: the board's finish; light: the strike light (warm by default)
export const NECKS = {
  "palo-rosa": { draw: rosewood, emissive: 0.35 },
  arce: { draw: maple, emissive: 0.17, rough: 0.42 },
  ebano: { draw: ebony, emissive: 0.4, rough: 0.4 },
  camuflaje: { draw: camo, emissive: 0.3, rough: 0.8 },
  nacar: { draw: pearlBlocks, emissive: 0.27 },
  carbono: { draw: carbon, emissive: 0.32, rough: 0.3, metal: 0.3 },
  retro: { draw: retro, emissive: 0.32 },
  hielo: { draw: ice, emissive: 0.38, tint: 0xd8ecff, rough: 0.25, light: 0xc8e4ff },
  lava: { draw: lava, emissive: 0.75, rough: 0.75 },
  llamas: { draw: paintedFlames, emissive: 0.3, rough: 0.25 },
  neon: { draw: neonGrid, emissive: 0.6, rough: 0.35 },
  galaxia: { draw: galaxy, emissive: 0.5 },
  "fear-of-the-dark": { draw: fearDark, emissive: 0.5, rough: 0.6 },
  oro: { draw: gold, emissive: 0.15, rough: 0.32, metal: 0.45 },
  leyenda: { draw: legend, emissive: 0.4, rough: 0.3 },
  calcomanias: { draw: stickers, emissive: 0.3, rough: 0.6 },
  laser: { draw: lasers, emissive: 0.6, rough: 0.4 },
  mundial: { draw: worldTour, emissive: 0.55, rough: 0.35 },
  calavera: { draw: skullNeck, emissive: 0.35, rough: 0.7 },
};

/* ================= note gems ================= */
// lanes: the five colours (sRGB, lane order green red yellow blue orange; also the fret buttons, tails, string flashes
// and the HUD). shape: "round" (today's), "square", "pixel", "crystal", "diamond", "cat", "vinyl", "chrome", "macaron", "candy".
// mirror: the metal reflects a studio (an environment map), so chrome looks like chrome.
// body/dome: finish of the coloured parts; each part's colour is the lane colour mixed towards `to` by `mix`, times `mul`;
// glow: how much that colour lights the part itself (today's notes: none). ring: the band around the top (color: its
// own colour, or the lane colour mixed like above when `lane` is set; glow as above); base: the bottom disc.
// halo: a soft glow under each note in its lane colour (reads without bloom); tail: brightness of the sustain trails.
const RING = { color: 0xf2eee6, metal: 0.1, rough: 0.25, emissive: 0xffffff, ei: 0.12 };
const BASE = { color: 0x080808, metal: 0.3, rough: 0.35 };
export const GEMS = {
  clasicas: { lanes: LANE_HEX, body: { metal: 0.05, rough: 0.3 }, dome: { metal: 0.05, rough: 0.1, mix: 0.1 } },
  // chrome: mirror-polished (they reflect a studio: renderer.js mirror), a coloured lens in the middle
  cromo: {
    lanes: LANE_HEX, shape: "chrome", mirror: true, body: { metal: 1, rough: 0.07, mix: 0.92, to: 0xe6ebf2 }, dome: { metal: 0.3, rough: 0.05, mix: 0.05, mul: 1.1, glow: 0.55 },
    ring: { color: 0xf4f6fa, metal: 1, rough: 0.05, emissive: 0x000000, ei: 0 }, base: { color: 0xc8ced8, metal: 1, rough: 0.12 },
  },
  // macarons: two pastel shells and the cream between them
  pastel: {
    lanes: [0x86e8a4, 0xff8f9c, 0xffe28a, 0x8fb6ff, 0xffbc86], shape: "macaron", body: { metal: 0, rough: 0.75 }, dome: { metal: 0, rough: 0.6, mix: 0.06 },
    ring: { color: 0xfff3dc, metal: 0, rough: 0.85, emissive: 0xfff3dc, ei: 0.08 }, base: { color: 0x2a2226, metal: 0, rough: 0.8 },
  },
  // wrapped hard candies: glossy, a white swirl, twisted cellophane at both ends
  caramelo: {
    lanes: [0x10f060, 0xff1744, 0xffd500, 0x1f7aff, 0xff7000], shape: "candy", body: { metal: 0.1, rough: 0.05, mul: 1.1, glow: 0.1 }, dome: { metal: 0, rough: 0.2, mix: 0.88, glow: 0.05 },
    base: { color: 0xe8eef6, metal: 0.6, rough: 0.12, emissive: 0x404650, ei: 0.6 },
  },
  cuadradas: { lanes: LANE_HEX, shape: "square", body: { metal: 0.05, rough: 0.3 }, dome: { metal: 0.05, rough: 0.1, mix: 0.12 } },
  neon: {
    lanes: [0x3dff2a, 0xff1f5a, 0xfff01f, 0x1fb2ff, 0xff8a1a], body: { metal: 0.2, rough: 0.2, mix: 0.85, to: 0x000000 }, dome: { metal: 0.3, rough: 0.05, mix: 0.55, to: 0x000000, glow: 0.6 },
    ring: { color: 0x202020, metal: 0, rough: 0.4, emissive: 0x000000, ei: 0, lane: 0, mul: 1.4, glow: 1.4 }, base: { color: 0x050505, metal: 0.4, rough: 0.2 },
    halo: { size: 1.45, mul: 0.7 }, tail: 1.3, tailGlow: 0.5,
  },
  pixel: {
    lanes: [0x38e038, 0xf83838, 0xf8d838, 0x3878f8, 0xf89838], shape: "pixel", body: { metal: 0, rough: 1, glow: 0.2 }, dome: { metal: 0, rough: 1, mix: 0.3, glow: 0.3 },
    ring: { color: 0xffffff, metal: 0, rough: 1, emissive: 0xffffff, ei: 0.8 }, base: { color: 0x101010, metal: 0, rough: 1 },
  },
  cristal: {
    lanes: LANE_HEX, shape: "crystal", body: { metal: 0.35, rough: 0.03, mix: 0, glow: 0.1 }, dome: { metal: 0.35, rough: 0, mix: 0.06, mul: 1.05, glow: 0.22 },
    base: { color: 0x1a1d22, metal: 0.6, rough: 0.1 },
  },
  oro: {
    lanes: LANE_HEX, body: { metal: 0.3, rough: 0.2 }, dome: { metal: 0.1, rough: 0.08, mix: 0.08 },
    ring: { color: 0xffcf4a, metal: 1, rough: 0.2, emissive: 0xffa416, ei: 0.4 }, base: { color: 0xd9a426, metal: 1, rough: 0.28, emissive: 0x6a4304, ei: 1 },
  },
  diamante: {
    lanes: LANE_HEX, shape: "diamond", body: { metal: 0.1, rough: 0.02, mix: 0.9, mul: 1.15, glow: 0.1 }, dome: { metal: 0.05, rough: 0.05, mix: 0.05, mul: 1.2, glow: 0.35 },
    ring: { color: 0xffffff, metal: 0.3, rough: 0.05, emissive: 0xdfeaff, ei: 0.3 }, base: { color: 0xe4ecf6, metal: 0.4, rough: 0.05, emissive: 0xbfd8ff, ei: 0.35 },
    halo: { size: 1.2, mul: 0.4, mix: 0.75, twinkle: true },
  },
  // vinyl records: black and glossy, the label in the lane colour
  vinilo: {
    lanes: LANE_HEX, shape: "vinyl", body: { metal: 0.55, rough: 0.08, mix: 0.9, to: 0x16161a }, dome: { metal: 0.05, rough: 0.35, mix: 0.05, glow: 0.45 },
    ring: { color: 0x9a9aa8, metal: 0.7, rough: 0.12, emissive: 0x30303a, ei: 0.6 }, base: { color: 0x050506, metal: 0.4, rough: 0.15 },
    halo: { size: 1.1, mul: 0.5 },
  },
  // emperor tamarins: a furry head in the lane colour (grizzled), the black face with its eyes and nostrils (the base's
  // piece), a pink muzzle, the long white moustache hanging down (the "ring", it sways with the music: renderer.js uWig)
  titi: {
    lanes: LANE_HEX, shape: "titi", body: { metal: 0, rough: 0.85, mix: 0.3, to: 0x5a4a3c }, dome: { metal: 0, rough: 0.45, mix: 0.92, to: 0xe3a29c },
    ring: { color: 0xffffff, metal: 0, rough: 0.5, emissive: 0xffffff, ei: 0.4 }, base: { color: 0x0a0809, metal: 0, rough: 0.55 },
  },
  // Powerslave's scarabs (the Iron Maiden event): wing cases in the lane colour, polished, a golden head and thorax, the
  // sun disk glowing in the lane colour above, bronze legs
  powerslave: {
    lanes: LANE_HEX, shape: "scarab", body: { metal: 0.85, rough: 0.22, mix: 0.88, to: 0xd8a83a }, dome: { metal: 0.2, rough: 0.3, mix: 0.25, glow: 0.7 },
    ring: { lane: 0.08, metal: 0.55, rough: 0.18, emissive: 0x000000, ei: 0, glow: 0.2 }, base: { color: 0x4a3212, metal: 0.75, rough: 0.35 },
  },
  // kittens: matte fur in the lane colour, a pale muzzle, a dark face (the "ring")
  gatitos: {
    lanes: LANE_HEX, shape: "cat", body: { metal: 0, rough: 0.6 }, dome: { metal: 0, rough: 0.55, mix: 0.82 },
    ring: { color: 0x150f10, metal: 0, rough: 0.35, emissive: 0x000000, ei: 0 }, base: { color: 0x0c0909, metal: 0.05, rough: 0.6 },
  },
};
for (const s of Object.values(GEMS)) { s.ring = s.ring || RING; s.base = s.base || BASE; s.shape = s.shape || "round"; }

/* ================= hit flames ================= */
// tint: a colour for a white flipbook (null: today's fire); k: how hot (above 1 the core burns white).
// lane: each lane burns in its note colour; rainbow: the colour goes round, a different hue on every lane.
// form: not a fire at all, its own picture and sparks (renderer.js FLAME_FORMS): campfire, embers, nova, bolt, curtain, stars, bubbles.
export const FLAMES = {
  fuego: { tint: null },
  azul: { tint: 0x3d86ff, k: 1.9 },
  verde: { tint: 0x86ff26, k: 1.5, form: "bubbles" },
  rosa: { tint: 0xff48b4, k: 1.7 },
  morado: { tint: 0x9a48ff, k: 2 },
  dorado: { tint: 0xffc23c, k: 1.6 },
  plasma: { tint: 0x8ef2ff, k: 2.4, form: "bolt" },
  notas: { lane: true, k: 1.8 },
  arcoiris: { rainbow: true, k: 1.8 },
  perfecto: { tint: 0xffd76a, k: 2, form: "stars" },
  aurora: { tint: 0x3dffc8, k: 2.1, form: "curtain" },
  fogata: { form: "campfire" },
  brasas: { form: "embers" },
  supernova: { tint: 0xc77dff, k: 2.2, form: "nova" },
  antimagia: { form: "antimagic" }, 
  piramide: { form: "pyramid" }, // Powerslave's burning pyramid with its glyphs (the Iron Maiden event), in its own colours // black flames with red cracks: drawn in their own colours, not added up as light
};

/* ================= strings, rails, edges ================= */
// string/rail/fret: [colour, metalness, roughness]; fretGlow: the beat bars' self-light; edges: the glowing lines along
// both sides and the strike line [left, right, strike] (k: brightness); laneGlow: strings always lit in their lane colour.
export const STRINGS = {
  acero: { string: [0xbdb8b0, 1, 0.22], rail: [0xd8d4cc, 1, 0.18], fret: [0xcfcac0, 1, 0.25], fretGlow: 0x4a4038, edges: [0xfff2e0, 0xfff2e0, 0xfff2e0], k: 1 },
  cobre: { string: [0xd9895a, 1, 0.26], rail: [0xc77a4c, 1, 0.22], fret: [0xd49468, 1, 0.28], fretGlow: 0x4a2414, edges: [0xffa268, 0xffa268, 0xffb88a], k: 1 },
  negras: { string: [0x1a1a1c, 0.2, 0.75], rail: [0x18181a, 0.35, 0.6], fret: [0x3a3a3e, 0.6, 0.5], fretGlow: 0x121214, edges: [0xc8d4ff, 0xc8d4ff, 0xc8d4ff], k: 0.55 },
  oro: { string: [0xffcc55, 1, 0.2], rail: [0xe8b54a, 1, 0.18], fret: [0xe2b452, 1, 0.24], fretGlow: 0x4a3008, edges: [0xffc64a, 0xffc64a, 0xffd780], k: 1.05 },
  hielo: { string: [0xe6eef6, 1, 0.12], rail: [0xe4ecf4, 1, 0.12], fret: [0xd8e6f0, 1, 0.18], fretGlow: 0x1c3a4c, edges: [0x5ff0ff, 0x5ff0ff, 0xa0f8ff], k: 1.15 },
  bronce: { string: [0xc98a4a, 1, 0.3], rail: [0xa8682e, 1, 0.26], fret: [0xb87a40, 1, 0.3], fretGlow: 0x3a2008, edges: [0xe0a060, 0xe0a060, 0xf0c080], k: 1 },
  neon: { string: [0x2a2a30, 0.6, 0.4], rail: [0x2a2240, 0.8, 0.3], fret: [0x9a86c0, 0.8, 0.3], fretGlow: 0x3a1460, edges: [0xff3fc8, 0x3ff0ff, 0xd070ff], k: 1.25, laneGlow: 0.32 },
  cables: { string: [0x2c2c30, 0.5, 0.5], rail: [0x18181c, 0.4, 0.5], fret: [0x8a8a90, 0.9, 0.3], fretGlow: 0x202024, edges: [0xff3a3a, 0x3a8aff, 0xffd23a], k: 1.15 },
};

/* ================= star power ================= */
// hue: the colour everything turns (the renderer works out the glowing shades from it); null: today's blue.
// rainbow: goes round the colour wheel while it's on. css: the HUD's star colour.
export const STARS = {
  azul: { hue: null, css: "#3fbfff" },
  dorado: { hue: 0xffb21c, css: "#ffc23a" },
  rosa: { hue: 0xff3aa8, css: "#ff5cc0" },
  rojo: { hue: 0xff2418, css: "#ff4a3a" },
  verde: { hue: 0x26ff8c, css: "#3dffa0" },
  morado: { hue: 0x9446ff, css: "#b072ff" },
  arcoiris: { hue: 0xff40c0, rainbow: true, css: "#ff5cd6" },
  atardecer: { hue: 0xff7a12, css: "#ff9a3a" },
  cian: { hue: 0x00ffd5, css: "#3dffe0" },
  blanca: { hue: 0xfff4e8, css: "#fff4e8" },
};

/* ================= the crowd's lights ================= */
// what the crowd does: each its own thing (stagecrew.js createCrowd); "rojo" was red lights, now red laser pointers
export const CROWDS = {
  encendedores: "lighters", celulares: "phones", rojo: "lasers", barras: "sticks", bengalas: "sparklers", estrobos: "strobe", luciernagas: "fireflies", gatos: "cats", banderas: "flags",
};

/* ================= pets: who keeps you company on the neck (renderer.js drawPet) ================= */
export const PETS = { ninguna: null, nero: "nero", harry: "harry", liam: "liam", louis: "louis", niall: "niall", zayn: "zayn",
  rm: "rm", jin: "jin", suga: "suga", jhope: "jhope", jimin: "jimin", v: "v", jungkook: "jungkook", eddie: "eddie" };
// the bands as little figures (the bands' events' gifts; renderer.js makeMember, main.js memberSvg): each one known by
// his hair and his clothes. hair: the cut; top: shirt, sweater or blazer; under: what shows at the front (null:
// closed); neck: a collar ring; pattern/stripe/pocket/earrings/glasses/hat/beret/tattoo: the details.
// One Direction as in the "Up All Night" photos; BTS each by his best-known trait
export const MEMBERS = {
  harry: { hair: "curls", hairC: 0x3e2618, skin: 0xf2c6a4, eyes: 0x3d7a4c, top: 0xd9998c, under: 0xc8202a, pocket: 0x1b2a55, pants: 0xe6dcc6 },
  liam: { hair: "mop", hairC: 0x8a5a33, skin: 0xedc19e, eyes: 0x5a3a22, top: 0x2f6878, pattern: "plaid", under: null, collar: 0x2f6878, pants: 0xe6dcc6 },
  louis: { hair: "fringe", hairC: 0x5a3820, skin: 0xf0c4a1, eyes: 0x4a7cab, top: 0xf2f2ee, under: null, stripe: 0x2a3c6a, pants: 0x2c3550 },
  niall: { hair: "swoop", hairC: 0xe6c983, skin: 0xf7d2b6, eyes: 0x3f74b0, top: 0xb5d1ea, under: null, neck: 0xb5d1ea, pants: 0xe6dcc6 },
  zayn: { hair: "quiff", hairC: 0x141012, skin: 0xd9a37e, eyes: 0x3a2416, top: 0xd02a2a, under: null, neck: 0x18a2b8, earrings: 0x111111, pants: 0xe6dcc6 },
  rm: { hair: "short", hairC: 0x2a2226, skin: 0xe9c29e, eyes: 0x2a1a12, top: 0x2f4a3a, under: 0xf2f2ee, glasses: 0x1a1a1e, pants: 0x2a2a30 },
  jin: { hair: "neat", hairC: 0x3a2a22, skin: 0xf1cfb2, eyes: 0x2a1a12, top: 0xeaa2b6, under: 0xffffff, pants: 0xeaa2b6 },
  suga: { hair: "part", hairC: 0x9fe0c8, skin: 0xf6dcc8, eyes: 0x2a1a12, top: 0x1c1c22, under: 0xf2f2ee, pants: 0x1c1c22 },
  jhope: { hair: "short", hairC: 0x3a2a22, skin: 0xe6bc96, eyes: 0x2a1a12, top: 0xf26b2a, under: null, neck: 0xf26b2a, hat: 0xf2c230, pants: 0xe6dcc6 },
  jimin: { hair: "part", hairC: 0xf2a0b8, skin: 0xf3d2b8, eyes: 0x2a1a12, top: 0xf4f4f0, under: null, collar: 0xf4f4f0, pants: 0x1c1c22 },
  v: { hair: "waves", hairC: 0x2a1c18, skin: 0xe8bf98, eyes: 0x2a1a12, top: 0x2b5d8a, under: 0x1c1c22, beret: 0x8a1c2a, pants: 0x2b5d8a },
  jungkook: { hair: "mullet", hairC: 0x111115, skin: 0xedc6a2, eyes: 0x2a1a12, top: 0x15151a, under: null, neck: 0x15151a, earrings: 0xd8d8e0, tattoo: true, pants: 0x15151a },
};

const SLOTS = { neck: NECKS, gems: GEMS, flames: FLAMES, strings: STRINGS, star: STARS, crowd: CROWDS, pet: PETS };
/** The ids to show for an equipped set: anything missing or unknown is that slot's default. */
export function resolveSkin(eq = {}) {
  const out = {};
  for (const k in SLOTS) out[k] = eq && Object.hasOwn(SLOTS[k], eq[k]) ? eq[k] : SKIN_DEFAULTS[k];
  return out;
}
const css = (hex) => "#" + hex.toString(16).padStart(6, "0");
/** CSS colours that match the 3D look: the lane colours (keycaps, song dots) and the star power colour (HUD). */
export function cssVars(eq) {
  const s = resolveSkin(eq), lanes = GEMS[s.gems].lanes;
  return { "--g": css(lanes[0]), "--r": css(lanes[1]), "--y": css(lanes[2]), "--b": css(lanes[3]), "--o": css(lanes[4]), "--star": STARS[s.star].css };
}
