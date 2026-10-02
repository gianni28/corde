// Corde — 3D renderer. Look: mid-2000s rock club stage (brick wall, amp walls, drum riser,
// tungsten PAR cans, haze, pyro) behind a Guitar-Hero-style rosewood highway.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createCrowd, createBand } from "./stagecrew.js";

export const LANE_HEX = [0x1fd14a, 0xe8202c, 0xf5c518, 0x1f6fe0, 0xf57a12];
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
function grime(g, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = rnd(4, 40);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(0,0,0,${a})`); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function rosewoodTex() {
  return canvasTex(512, 1024, (g, w, h) => {
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
    const e = g.createLinearGradient(0, 0, w, 0);
    e.addColorStop(0, "rgba(0,0,0,.65)"); e.addColorStop(0.12, "rgba(0,0,0,0)"); e.addColorStop(0.88, "rgba(0,0,0,0)"); e.addColorStop(1, "rgba(0,0,0,.65)");
    g.fillStyle = e; g.fillRect(0, 0, w, h);
    // mother-of-pearl dots
    const dot = (x, y) => {
      const rg = g.createRadialGradient(x - 5, y - 5, 1, x, y, 20);
      rg.addColorStop(0, "rgba(255,250,240,.55)"); rg.addColorStop(0.5, "rgba(217,210,195,.4)"); rg.addColorStop(0.85, "rgba(157,151,140,.25)"); rg.addColorStop(1, "rgba(60,50,40,0)");
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
    };
    dot(w / 2, h * 0.25); dot(w * 0.3, h * 0.75); dot(w * 0.7, h * 0.75);
  }, { repeat: true });
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

function planksTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const pw = 64;
    for (let x = 0; x < w; x += pw) {
      g.fillStyle = `hsl(25, 30%, ${rnd(8, 13)}%)`; g.fillRect(x, 0, pw, h);
      for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(0,0,0,${rnd(0.05, 0.2)})`; g.lineWidth = rnd(0.5, 2); const xx = x + rnd(2, pw - 2); g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx + rnd(-3, 3), h); g.stroke(); }
      g.fillStyle = "#050302"; g.fillRect(x, 0, 2, h);
    }
    grime(g, w, h, 50, 0.3);
    g.fillStyle = "rgba(200,200,190,.12)"; g.fillRect(rnd(0, w - 120), rnd(0, h), 120, 14); // gaffer tape
  }, { repeat: true });
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

/* ================= renderer ================= */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070403);
  scene.fog = new THREE.Fog(0x0d0705, 22, 75);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220);
  // The venue lives in its own scene, rendered into a low-res target and shown as the highway's background.
  const bg = new THREE.Scene();
  bg.background = new THREE.Color(0x070403);
  bg.fog = scene.fog;
  const bgRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  scene.background = bgRT.texture;
  bg.add(new THREE.HemisphereLight(0xffd9b0, 0x120604, 0.35));
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

  const planks = planksTex(); planks.repeat.set(16, 14);
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
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uI;
      void main(){ float e=pow(abs(dot(vN,vV)),2.); float l=pow(vUv.y,2.2); gl_FragColor=vec4(uColor*uI*e*l,1.); }`,
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
    haze.push({ s, v: rnd(-0.4, 0.4) });
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
  let pyroT = 9;

  // crowd in front of the stage + the band on it (see stagecrew.js); both follow the beat and the song's energy
  const crowd = createCrowd(bg, camera, { max: isMobile ? 56 : 96, dotTex: softDotTex() });
  const band = createBand(bg, { kitPos: kit.position, cymbals: cymList });
  let hype = 0.5, hypeS = 0.5;
  const rimCol = new THREE.Color();

  bg.add(bake(stage));

  /* --- highways: one per player (two side by side when two people share a PC) --- */
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const WHITE = new THREE.Color(1, 1, 1);
  // star power on: HDR colours so the notes glow (instance colours also feed the emissive term)
  const STAR_ON_BODY = new THREE.Color(0.1, 1.15, 2.6), STAR_ON_DOME = new THREE.Color(0.75, 1.9, 2.8), STAR_ON_GEM = new THREE.Color(0.55, 1.5, 2.6);
  const STAR_ON_HALO = new THREE.Color(0.15, 0.7, 1.25), STAR_HALO = new THREE.Color(0.7, 0.85, 1.1), STAR_WHITE = new THREE.Color(1.5, 1.6, 1.75), STAR_TAIL = new THREE.Color(0.15, 1.1, 2.4);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const BOARD_WARM = new THREE.Color(0xffffff), BOARD_STAR = new THREE.Color(0x7cc6ff), EDGE_WARM = new THREE.Color(0xfff2e0), EDGE_STAR = new THREE.Color(0x6fd8ff);
  const LIGHT_WARM = new THREE.Color(0xffa860), LIGHT_STAR = new THREE.Color(0x5ab8ff);

  // made once, shared by every neck
  const dotTex = softDotTex();
  const blueFire = fireFrames(6, BLUE_FIRE);
  const boardBase = rosewoodTex(); boardBase.repeat.set(1, (HL + 5) / 6);
  const fadeAlpha = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#fff"); gr.addColorStop(0.35, "#000"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { srgb: false });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 1, roughness: 0.18 });
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
  const glowInstance = (mat, k) => {
    mat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor * ${k.toFixed(2)};\n#endif`);
    };
    return mat;
  };
  const gemBaseMat = new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.3, roughness: 0.35 });
  const gemBodyMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.05, roughness: 0.3 }), 0.1);
  const gemDomeMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.05, roughness: 0.1 }), 0.16);
  const gemRingMat = new THREE.MeshStandardMaterial({ color: 0xf2eee6, metalness: 0.1, roughness: 0.25, emissive: 0xffffff, emissiveIntensity: 0.12 });
  const tailMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }), 0.35);
  // star-phrase notes are white stars (like the classics), with a glow under them that doesn't need bloom (phones)
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.2 : 0.47; i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2 });
  starGeo.rotateX(-Math.PI / 2); starGeo.translate(0, 0.07, 0);
  const starMat = glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.2, emissive: 0xe4f4ff, emissiveIntensity: 0.95 }), 0.45);
  const haloGeo = new THREE.PlaneGeometry(1, 1); haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const SPARKS = 240;

  function createHighway() {
    const hwy = new THREE.Group(); scene.add(hwy);
    const h = { group: hwy, lanes: 5, starGlow: 0, readyGlow: 0, phraseT: 9, sparkBlue: false };
    const laneX = (i) => (i - (h.lanes - 1) / 2) * LW;
    h.laneX = laneX;
    h.width = () => h.lanes * LW + 0.5;

    // the light over the strike line (warm; blue with star power)
    const strikeLight = new THREE.PointLight(0xffa860, 1.6, 5, 1.8); strikeLight.position.set(0, 1.3, 0.8); hwy.add(strikeLight);

    const boardTex = boardBase.clone(); boardTex.needsUpdate = true;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1, HL + 5), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.5, metalness: 0.05, emissiveMap: boardTex, emissive: 0xffffff, emissiveIntensity: 0.35 }));
    board.rotation.x = -Math.PI / 2; board.position.set(0, 0, -HL / 2 + 2.5); hwy.add(board);
    // fade the far end of the neck into darkness
    const fade = new THREE.Mesh(new THREE.PlaneGeometry(1, 8), new THREE.MeshBasicMaterial({ color: 0x070403, transparent: true, depthWrite: false, alphaMap: fadeAlpha }));
    fade.rotation.x = -Math.PI / 2; fade.position.set(0, 0.2, -HL + 3.6); hwy.add(fade);

    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff2e0, emissiveIntensity: 0.55 });
    const rails = [-1, 1].map(() => { const m = new THREE.Mesh(railGeo, chromeMat); m.position.set(0, 0.04, -HL / 2 + 2.5); hwy.add(m); return m; });
    const edges = [-1, 1].map(() => { const m = new THREE.Mesh(edgeGeo, edgeMat); m.position.set(0, 0.1, -HL / 2 + 2.5); hwy.add(m); return m; });

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
    const strikeEdge = new THREE.Mesh(strikeEdgeGeo, edgeMat); strikeEdge.position.set(0, 0.07, -0.12); hwy.add(strikeEdge);

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
    const tails = mk(tailGeo, tailMat), starGem = mk(starGeo, starMat), halos = mk(haloGeo, haloMat);
    halos.renderOrder = 2;
    [gemBody, gemDome, tails, starGem, halos].forEach((m) => m.setColorAt(0, new THREE.Color()));

    // hit fire + sparks
    const flames = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fire[0], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.center.set(0.5, 0.04); hwy.add(sp); flames.push({ sp, t: 9, f: 0 });
    }
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
    const sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.1, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; hwy.add(sparks);
    let sparkIdx = 0;
    function burst(x, n, white = false, blue = false, power = 1) {
      for (let k = 0; k < n; k++) {
        const i = sparkIdx++ % SPARKS;
        spPos[i * 3] = x + rnd(-0.25, 0.25); spPos[i * 3 + 1] = 0.25; spPos[i * 3 + 2] = rnd(-0.1, 0.1);
        sparkVel[i * 3] = rnd(-1.8, 1.8) * power; sparkVel[i * 3 + 1] = rnd(2, 5.5) * power; sparkVel[i * 3 + 2] = rnd(-0.6, 1.2);
        sparkLife[i] = rnd(0.35, 0.7) * Math.sqrt(power);
        const hot = Math.random();
        if (white) { spCol[i * 3] = 0.85 + hot * 0.15; spCol[i * 3 + 1] = 0.92 + hot * 0.08; spCol[i * 3 + 2] = 1; }
        else if (h.sparkBlue || blue) { spCol[i * 3] = 0.35 + hot * 0.3; spCol[i * 3 + 1] = 0.75 + hot * 0.2; spCol[i * 3 + 2] = 1; }
        else { spCol[i * 3] = 1; spCol[i * 3 + 1] = 0.45 + hot * 0.5; spCol[i * 3 + 2] = hot * 0.35; }
      }
    }

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
      readyFire.forEach((sp, k) => sp.position.set((k % 2 ? 1 : -1) * (w / 2 + 0.2 + (k > 1 ? 0.12 : 0)), 0.08, 0.05 + (k > 1 ? -0.15 : 0)));
    };
    h.hit = (lane, sustain) => {
      if (lane >= h.lanes) return;
      flames[lane].t = 0;
      strings[lane].vib = 1; strings[lane].glow = 1; buttons[lane].press = 1;
      burst(laneX(lane), sustain ? 6 : 14);
    };
    h.holdSpark = (lane) => {
      if (lane >= h.lanes) return;
      if (Math.random() < 0.45) burst(laneX(lane), 1);
      const f = flames[lane]; if (f.t > 0.12) f.t = 0.12;
      strings[lane].glow = Math.max(strings[lane].glow, 0.7); strings[lane].vib = Math.max(strings[lane].vib, 0.4);
    };
    // a star phrase was completed: a white flash and a fountain of white sparks over every fret
    h.starPhrase = () => { h.phraseT = 0; for (let i = 0; i < h.lanes; i++) burst(laneX(i), 16, true, false, 1.35); };

    // s: { t, look, notes:[{t,lane,dur,state,holding}], from, pressed[], beats[[t,bar]], star, starReady }
    h.update = (s, { now, dt, pulse }) => {
      const { t, look, notes, from = 0, pressed = [], beats = [], star = false, starReady = false } = s;
      const lanes = h.lanes;
      const speed = HL / look;
      const zOf = (time) => -(time - t) * speed;
      strikeLight.intensity = 1.4 + pulse * 0.8;
      edgeMat.emissiveIntensity = 0.5 + pulse * 0.35;
      // star power: the neck, its edges and the strike light turn blue
      h.starGlow += ((star ? 1 : 0) - h.starGlow) * Math.min(1, dt * 6);
      h.readyGlow += ((starReady && !star ? 1 : 0) - h.readyGlow) * Math.min(1, dt * 5);
      h.phraseT += dt;
      const starGlow = h.starGlow, readyGlow = h.readyGlow;
      const flash = h.phraseT < 0.5 ? Math.pow(1 - h.phraseT / 0.5, 2) : 0;
      h.sparkBlue = star;
      board.material.emissive.copy(BOARD_WARM).lerp(BOARD_STAR, starGlow);
      board.material.emissiveIntensity = 0.35 + starGlow * 0.3 + flash * 0.9;
      edgeMat.emissive.copy(EDGE_WARM).lerp(EDGE_STAR, Math.max(starGlow, readyGlow * (0.55 + 0.45 * Math.sin(now * 9))));
      edgeMat.emissiveIntensity += starGlow * 0.5 + readyGlow * 0.6 + flash * 2;
      strikeLight.color.copy(LIGHT_WARM).lerp(LIGHT_STAR, Math.max(starGlow, readyGlow * 0.7));
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
        sp.material.map = blueFire[(Math.floor(now * 20) + k * 2) % blueFire.length];
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
      let gi = 0, ti = 0, si = 0, hi = 0;
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
            if (dead) tmpC.setHex(0x2e2a28); else if (star) tmpC.copy(STAR_TAIL); else if (isStar) tmpC.copy(STAR_WHITE); else tmpC.setHex(LANE_HEX[n.lane]);
            if (n.holding) tmpC.multiplyScalar(1.6);
            tails.setColorAt(ti, tmpC);
            tails.setMatrixAt(ti, tmpM); ti++;
          }
        }
        if (n.state === 1) continue;
        const z = zOf(n.t);
        if (z > 1.4 || gi >= MAX_GEMS) continue;
        if (isStar) {
          // a white star (blue while star power is on), with a soft glow under it
          tmpQ.setFromAxisAngle(Y_AXIS, Math.sin(now * 2.2 + i) * 0.35);
          tmpM.compose(tmpV.set(x, 0.05, z), tmpQ, tmpS.setScalar(0.95 * (0.96 + 0.06 * starPulse)));
          starGem.setMatrixAt(si, tmpM); starGem.setColorAt(si, star ? STAR_ON_GEM : WHITE); si++;
          tmpM.compose(tmpV.set(x, 0.03, z), tmpQ.identity(), tmpS.set(1.9 * starPulse, 1, 1.9 * starPulse));
          halos.setMatrixAt(hi, tmpM); halos.setColorAt(hi, star ? STAR_ON_HALO : STAR_HALO); hi++;
          continue;
        }
        tmpM.compose(tmpV.set(x, 0.05, z), tmpQ.identity(), tmpS.set(0.9, 0.9, 0.9));
        gemBase.setMatrixAt(gi, tmpM); gemBody.setMatrixAt(gi, tmpM); gemDome.setMatrixAt(gi, tmpM); gemRing.setMatrixAt(gi, tmpM);
        if (n.state === 2) { tmpC.setHex(0x24201e); gemBody.setColorAt(gi, tmpC); gemDome.setColorAt(gi, tmpC); }
        else if (star) {
          // star power on: every note turns electric blue and glows
          gemBody.setColorAt(gi, STAR_ON_BODY); gemDome.setColorAt(gi, STAR_ON_DOME);
          tmpM.compose(tmpV.set(x, 0.03, z), tmpQ.identity(), tmpS.set(1.45, 1, 1.45));
          halos.setMatrixAt(hi, tmpM); halos.setColorAt(hi, STAR_ON_HALO); hi++;
        }
        else { tmpC.setHex(LANE_HEX[n.lane]); gemBody.setColorAt(gi, tmpC); gemDome.setColorAt(gi, tmpC.lerp(WHITE, 0.1)); }
        gi++;
      }
      for (const m of [gemBase, gemBody, gemDome, gemRing]) { m.count = gi; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      for (const [m, c] of [[starGem, si], [halos, hi], [tails, ti]]) { m.count = c; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

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
        st.mesh.material.emissive.setHex(LANE_HEX[i]).multiplyScalar(st.glow * 0.4);
        const f = flames[i]; f.t += dt;
        const k = f.t / 0.32;
        f.sp.material.map = fire[(Math.floor(now * 22) + i) % fire.length];
        f.sp.material.opacity = k < 1 ? (1 - k) : 0;
        f.sp.visible = k < 1;
        f.sp.scale.set(0.95 + k * 0.25, 1.5 + k * 0.9, 1);
      }
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) { spPos[i * 3 + 1] = -50; continue; }
        sparkLife[i] -= dt; sparkVel[i * 3 + 1] -= 9.5 * dt;
        spPos[i * 3] += sparkVel[i * 3] * dt; spPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;
    };
    h.layout(5);
    return h;
  }
  const hws = [createHighway()];
  // with two players each neck has its own camera and its own half of the screen; the venue camera stays centred
  const hwCams = [new THREE.PerspectiveCamera(55, 1, 0.1, 220), new THREE.PerspectiveCamera(55, 1, 0.1, 220)];
  let players = 1;
  const camOf = (p) => (players > 1 ? hwCams[p] : camera);
  const SPLIT_X = 80; // the second neck sits this far to the side, out of the first camera's view

  /* --- post --- */
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: isMobile ? 0 : 4 }));
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
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
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

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
    crowd.layout(aspect, Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), edgeX);
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
    const samples = !isMobile && level <= 1 ? 4 : 0;
    for (const rt of [composer.renderTarget1, composer.renderTarget2, bgRT]) if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    renderer.setPixelRatio(L.dpr);
    bloom.enabled = L.bloom > 0;
    dust.visible = L.fx >= 1;
    haze.forEach((h, i) => (h.s.visible = L.fx >= 2 || i % 2 === 0));
    coneMats.forEach((m) => (m.visible = L.fx >= 1));
    resize();
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
    bloom.resolution.set(Math.max(64, W * L.bloom), Math.max(64, H * L.bloom));
    bgRT.setSize(Math.max(64, Math.round(W * L.dpr * L.bg)), Math.max(64, Math.round(H * L.dpr * L.bg)));
    fitCamera();
  }
  let frameNo = 0;

  let peopleDt = 0;
  const beatTrack = { count: 0, bar: 0, lastT: -1e9, prevT: -1e9, len: 0.5 };
  // warm club palettes per song section: [front PARs, back PARs]
  const palettes = [[0xffb060, 0xff3a1a], [0xff2a14, 0xffc070], [0xfff0d0, 0xff6a10], [0xffc040, 0xd01010], [0xff7a20, 0xfff2e0]];
  let pal = 0;
  const colA = new THREE.Color(palettes[0][0]), colB = new THREE.Color(palettes[0][1]);

  function firePyro() { pyroT = 0; pyro.forEach((p) => (p.t = 0)); }
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
    _internals: { camera, baseCam, bg },
    setLanes: layoutLanes,
    /** 1 player (one neck in the middle) or 2 (two necks, split screen). */
    setPlayers(n) {
      n = n > 1 ? 2 : 1;
      if (n === players) return;
      players = n;
      while (hws.length < n) { const h = createHighway(); h.group.position.x = SPLIT_X * hws.length; h.layout(hws[0].lanes); hws.push(h); }
      hws.forEach((h, k) => (h.group.visible = k < n));
      renderPass.enabled = n === 1; splitPass.enabled = n > 1;
      fitCamera();
    },
    get players() { return players; },
    // "auto" | "high" | "low"
    setQualityLevel(q) {
      mode = q === "high" || q === "low" ? q : "auto";
      level = mode === "high" ? 0 : mode === "low" ? 2 : isMobile ? 2 : 1;
      perf.ema = 16.7; perf.slowFor = perf.fastFor = 0;
      applyLevel();
    },
    qualityInfo() { return { mode, level, ema: +perf.ema.toFixed(1), bg: [bgRT.width, bgRT.height], px: renderer.getPixelRatio() }; },
    resize,
    setSection(i) { pal = ((i % palettes.length) + palettes.length) % palettes.length; if (i > 0) firePyro(); },
    pyro: firePyro,
    hit(lane, sustain, p = 0) { hws[p]?.hit(lane, sustain); },
    holdSpark(lane, p = 0) { hws[p]?.holdSpark(lane); },
    miss() {},
    /** How excited the crowd is, 0–1 (follows the rock meter and star power). */
    setHype(v) { hype = Math.max(0, Math.min(1, v)); },
    /** A star phrase was completed: a white flash and a fountain of white sparks over every fret. */
    starPhrase(p = 0) { hws[p]?.starPhrase(); },
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
      const { dt = 0.016, energy = 0.55, punch = 0 } = state;
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

      // the necks (each player's notes, buttons, fire and star power)
      for (let k = 0; k < players; k++) hws[k].update(P[k] || P[0], { now, dt, pulse });
      let starGlow = 0; for (let k = 0; k < players; k++) starGlow = Math.max(starGlow, hws[k].starGlow);

      // lights: brighter, punchier and changing colour faster when the song is loud; dim and warm when it's calm
      const lerpK = 0.015 + 0.03 * E;
      colA.lerp(tmpC.setHex(palettes[pal][0]), lerpK); colB.lerp(tmpC.setHex(palettes[pal][1]), lerpK);
      const pk = pulse * (0.35 + 0.9 * E) + punch * 0.35 * E;
      [colA, colB].forEach((col, row) => {
        glows[row].material.color.copy(col).multiplyScalar(0.45 + 0.45 * E + pk * 0.6);
        coneMats[row].uniforms.uColor.value.copy(col);
        coneMats[row].uniforms.uI.value = (0.05 + 0.08 * E + pk * 0.14) * (0.88 + 0.12 * Math.sin(now * (3 + 6 * E) + row));
      });
      wallSpots.forEach((s, i) => { s.color.copy(i === 1 ? colB : colA); s.intensity = 110 + 160 * E + pk * 150; });
      stageWash.color.copy(colA); stageWash.intensity = 85 + 60 * E + pk * 70;
      bandKey.intensity = 260 + 160 * E + pk * 120;

      const sway = (cam, base) => cam.position.set(base.x + Math.sin(now * 0.3) * 0.05, base.y + pulse * 0.025 * (0.4 + E), base.z);
      sway(camera, baseCam);
      if (players > 1) for (let k = 0; k < players; k++) sway(hwCams[k], hwCams[k].userData.base);

      // the people: crowd and band (only worked out on frames where the venue is redrawn)
      hypeS += (Math.max(hype, starGlow * 0.95) - hypeS) * Math.min(1, dt * 1.5);
      peopleDt += dt;
      if (frameNo % LEVELS[level].bgEvery === 0) {
        rimCol.copy(colA).lerp(colB, 0.35).multiplyScalar(0.55 + 0.5 * E + pk * 0.5);
        if (starGlow > 0.01) rimCol.lerp(tmpC.setHex(0x3fb4ff).multiplyScalar(1.1), starGlow * 0.75);
        const fdt = Math.min(0.1, peopleDt); peopleDt = 0;
        camera.updateMatrixWorld();
        const f = { bpos, ph: phase, bar: beatTrack.bar, E: Math.min(1, E + starGlow * 0.12), P: punch, hype: hypeS, star: starGlow, dt: fdt, now, rim: rimCol };
        crowd.update(f, camera);
        band.update(f);
      }

      haze.forEach((h) => { h.s.position.x += h.v * dt; if (h.s.position.x > 34) h.s.position.x = -34; if (h.s.position.x < -34) h.s.position.x = 34; });
      const da = dust.geometry.attributes.position;
      for (let i = 0; i < dustN; i++) { da.array[i * 3 + 1] += dt * 0.35; da.array[i * 3] += Math.sin(now * 0.7 + i) * dt * 0.15; if (da.array[i * 3 + 1] > 20) da.array[i * 3 + 1] = 0; }
      da.needsUpdate = true;

      // pyro
      pyroT += dt;
      pyro.forEach((p) => {
        p.t += dt;
        const k = p.t / 1.1;
        p.col.forEach((sp, j) => {
          sp.material.map = fire[(Math.floor(now * 18) + j * 2) % fire.length];
          sp.material.opacity = k < 1 ? Math.min(1, (1 - k) * 2.2) * 0.95 : 0;
          sp.visible = k < 1;
          sp.scale.set(2.6 + j * 0.4, (k < 0.25 ? k / 0.25 : 1) * (9 + j * 2), 1);
        });
      });
      pyroLight.intensity = pyroT < 1.1 ? (1 - pyroT / 1.1) * 900 : 0;

      autoTune(performance.now());
      if (frameNo++ % LEVELS[level].bgEvery === 0) {
        renderer.setRenderTarget(bgRT);
        renderer.render(bg, camera);
        renderer.setRenderTarget(null);
      }
      composer.render();
    },
  };
  resize();
  return api;
}
