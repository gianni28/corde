// Corde — 3D stage + highway renderer (Three.js)
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export const LANE_HEX = [0x2ee65a, 0xff2e3c, 0xffd21f, 0x2a84ff, 0xff8a1a];
const HL = 24; // highway length (world units)
const LW = 1.0; // lane width
const MAX_GEMS = 260;

const isMobile = matchMedia("(pointer:coarse)").matches;

/* ---------- procedural textures ---------- */
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function fretboardTex() {
  return canvasTex(512, 1024, (g, w, h) => {
    // dark ebony neck with grain
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, "#120b0a"); grd.addColorStop(0.08, "#3a2519"); grd.addColorStop(0.5, "#4a3020");
    grd.addColorStop(0.92, "#3a2519"); grd.addColorStop(1, "#120b0a");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * w, a = Math.random() * 0.08 + 0.02;
      g.strokeStyle = Math.random() < 0.5 ? `rgba(70,45,30,${a})` : `rgba(0,0,0,${a * 1.6})`;
      g.lineWidth = Math.random() * 2 + 0.4;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.01 + i) * 4, y);
      g.stroke();
    }
    // pearl inlay dots (two per tile)
    [h * 0.25, h * 0.75].forEach((y, k) => {
      const r = 18;
      const rg = g.createRadialGradient(w / 2 - 4, y - 4, 2, w / 2, y, r);
      rg.addColorStop(0, "rgba(255,250,240,.55)"); rg.addColorStop(0.7, "rgba(200,190,210,.28)"); rg.addColorStop(1, "rgba(120,110,140,0)");
      g.fillStyle = rg;
      if (k === 1) { g.beginPath(); g.arc(w * 0.3, y, r, 0, 7); g.fill(); g.beginPath(); g.arc(w * 0.7, y, r, 0, 7); g.fill(); }
      else { g.beginPath(); g.arc(w / 2, y, r, 0, 7); g.fill(); }
    });
  }, true);
}

function softDotTex() {
  return canvasTex(64, 64, (g) => {
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.3, "rgba(255,255,255,.5)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  });
}

function flameTex() {
  return canvasTex(128, 256, (g) => {
    for (let i = 0; i < 3; i++) {
      const rg = g.createRadialGradient(64, 210, 4, 64, 160 - i * 20, 120 - i * 25);
      rg.addColorStop(0, "rgba(255,255,240,.95)"); rg.addColorStop(0.25, "rgba(255,220,120,.75)");
      rg.addColorStop(0.6, "rgba(255,110,30,.35)"); rg.addColorStop(1, "rgba(255,60,0,0)");
      g.fillStyle = rg;
      g.beginPath(); g.moveTo(64, 10 + i * 30);
      g.bezierCurveTo(118, 110, 116, 230, 64, 250); g.bezierCurveTo(12, 230, 10, 110, 64, 10 + i * 30); g.fill();
    }
  });
}

function grillTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#121014"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1e1b22";
    for (let y = 4; y < h; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < w; x += 8) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
    g.strokeStyle = "#3a3540"; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  });
}

/* ---------- shaders ---------- */
const smokeShader = {
  uniforms: { uTime: { value: 0 }, uHue: { value: new THREE.Color(0xff5a1a) }, uHue2: { value: new THREE.Color(0x5a2aff) }, uPulse: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    varying vec2 vUv; uniform float uTime; uniform vec3 uHue; uniform vec3 uHue2; uniform float uPulse;
    float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=.5; } return v; }
    void main(){
      vec2 p=vUv*vec2(6.,2.5);
      float s=fbm(p+vec2(uTime*.04, -uTime*.02)+fbm(p*1.3-uTime*.03));
      float glow=smoothstep(.95,.0,distance(vUv,vec2(.5,.35))*1.6);
      vec3 base=mix(vec3(.02,.012,.03), uHue2*.35, smoothstep(.05,.8,vUv.y));
      vec3 col=base + uHue*glow*(.35+.3*uPulse) + s*s*.45*mix(uHue,uHue2,vUv.x);
      col*=smoothstep(0.,.18,vUv.y)*(1.-.75*smoothstep(.55,1.,vUv.y));
      gl_FragColor=vec4(col,1.);
    }`,
};

const beamShader = {
  uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0.6 } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uIntensity;
    void main(){ float edge=pow(abs(dot(vN,vV)),1.6); float len=pow(vUv.y,1.4);
      gl_FragColor=vec4(uColor*uIntensity*edge*len*.55, 1.); }`,
};

/* ---------- renderer ---------- */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: "high-performance" });
  const DPR = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2);
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050308);
  scene.fog = new THREE.Fog(0x07040b, 14, 48);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

  // lights
  scene.add(new THREE.HemisphereLight(0x9a8cff, 0x1a0c05, 0.35));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.1); key.position.set(2, 8, 6); scene.add(key);
  const strikeLight = new THREE.PointLight(0xffb070, 2, 5, 1.8); strikeLight.position.set(0, 1.4, 0.6); scene.add(strikeLight);

  /* --- background stage --- */
  const smoke = new THREE.Mesh(new THREE.PlaneGeometry(220, 90), new THREE.ShaderMaterial({ ...smokeShader, fog: false, depthWrite: false }));
  smoke.position.set(0, 12, -70); scene.add(smoke);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 160), new THREE.MeshStandardMaterial({ color: 0x0c0a10, roughness: 0.35, metalness: 0.7 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.6, -40); scene.add(floor);

  const spots = [];
  const spotColors = [0xff6a1a, 0x6b3bff, 0xff2e7a];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.SpotLight(spotColors[i], 60, 60, 0.32, 0.6, 1.3);
    s.position.set((i - 1) * 14, 18, -30); s.target.position.set((i - 1) * 6, -0.6, -18);
    scene.add(s, s.target); spots.push(s);
  }

  // truss with lamps
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2730, metalness: 0.9, roughness: 0.35 });
  const truss = new THREE.Mesh(new THREE.BoxGeometry(70, 0.5, 0.5), trussMat); truss.position.set(0, 17, -44); scene.add(truss);
  const beams = [];
  const beamGeo = new THREE.ConeGeometry(3.2, 28, 40, 1, true); beamGeo.translate(0, -13, 0);
  for (let i = 0; i < 8; i++) {
    const x = -28 + i * 8;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1.5 }));
    lamp.position.set(x, 16.4, -44); scene.add(lamp);
    const mat = new THREE.ShaderMaterial({ ...beamShader, uniforms: THREE.UniformsUtils.clone(beamShader.uniforms), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(beamGeo, mat); beam.position.set(x, 16.2, -44); beam.renderOrder = 2;
    scene.add(beam); beams.push({ beam, lamp, phase: i * 0.9, x });
  }

  // amp stacks on both sides
  const grill = grillTex();
  const ampMat = new THREE.MeshStandardMaterial({ map: grill, roughness: 0.8, metalness: 0.2 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x151317, roughness: 0.5, metalness: 0.5 });
  for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
    const x = side * (11 + k * 5.4), z = -24 - k * 7;
    for (let j = 0; j < 2; j++) { const cab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 4.2, 2.6), ampMat); cab.position.set(x, 1.5 + j * 4.25, z); scene.add(cab); }
    const head = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.6, 2.4), headMat); head.position.set(x, 10.4, z); scene.add(head);
    const leds = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff6a1a, emissiveIntensity: 3 }));
    leds.position.set(x, 10.4, z + 1.23); scene.add(leds);
  }

  // dust particles
  const dustN = isMobile ? 260 : 600;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = (Math.random() - 0.5) * 60; dp[i * 3 + 1] = Math.random() * 20; dp[i * 3 + 2] = -Math.random() * 60 + 4; }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: softDotTex(), size: 0.22, transparent: true, opacity: 0.55, color: 0xffd9b0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(dust);

  /* --- highway --- */
  const hwy = new THREE.Group(); scene.add(hwy);
  let lanes = 5;
  const boardTex = fretboardTex();
  boardTex.repeat.set(1, (HL + 5) / 6);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1, HL + 5), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6, metalness: 0.1, emissiveMap: boardTex, emissive: 0xffffff, emissiveIntensity: 0.18 }));
  board.rotation.x = -Math.PI / 2; board.position.set(0, 0, -HL / 2 + 2.5); hwy.add(board);

  const railMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, emissive: 0xff6a1a, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.3 });
  const rails = [-1, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, HL + 5), railMat); m.position.set(0, 0.05, -HL / 2 + 2.5); hwy.add(m); return m; });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0x8a8590, metalness: 1, roughness: 0.25 });
  const sideTrim = [-1, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, HL + 5), chromeMat); m.position.set(0, 0.0, -HL / 2 + 2.5); hwy.add(m); return m; });

  // strings
  const strings = [];
  const strGeo = new THREE.CylinderGeometry(0.018, 0.018, HL + 1.5, 6); strGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a94a4, metalness: 1, roughness: 0.25, emissive: 0x000000, emissiveIntensity: 1.1 });
    const s = new THREE.Mesh(strGeo, mat); s.position.set(0, 0.06, -HL / 2 + 0.75); hwy.add(s);
    strings.push({ mesh: s, vib: 0, glow: 0 });
  }

  // fret bars (beat lines)
  const fretGeo = new THREE.BoxGeometry(1, 0.035, 0.07);
  const frets = new THREE.InstancedMesh(fretGeo, new THREE.MeshStandardMaterial({ color: 0xb8b2c0, metalness: 0.9, roughness: 0.3, emissive: 0x6a6070, emissiveIntensity: 0.6 }), 64);
  frets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); hwy.add(frets);

  // strike line glow
  const strike = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.08), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.2 }));
  strike.position.set(0, 0.03, 0); hwy.add(strike);

  // fret buttons (Guitar Hero style)
  const buttons = [];
  const housingGeo = new THREE.CylinderGeometry(0.47, 0.52, 0.16, 48);
  const rimGeo = new THREE.TorusGeometry(0.4, 0.055, 14, 48); rimGeo.rotateX(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.33, 0.36, 0.12, 48);
  const centerGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.125, 32);
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x18161b, metalness: 0.85, roughness: 0.3 });
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(housingGeo, housingMat); housing.position.y = 0.06;
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0xd8d4dc, metalness: 1, roughness: 0.2, emissive: LANE_HEX[i], emissiveIntensity: 0.25 })); rim.position.y = 0.15;
    const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: LANE_HEX[i], metalness: 0.2, roughness: 0.25, emissive: LANE_HEX[i], emissiveIntensity: 0.25 }));
    const center = new THREE.Mesh(centerGeo, new THREE.MeshStandardMaterial({ color: 0x0c0b0e, metalness: 0.6, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 }));
    cap.position.y = 0.2; center.position.y = 0.2;
    g.add(housing, rim, cap, center);
    g.scale.setScalar(0.92);
    hwy.add(g);
    buttons.push({ g, cap, center, rim, press: 0 });
  }

  // gems (instanced, GH style: black base, coloured dome, white band)
  const gemBaseGeo = new THREE.CylinderGeometry(0.39, 0.42, 0.08, 32);
  const gemBodyGeo = new THREE.CylinderGeometry(0.35, 0.38, 0.12, 32); gemBodyGeo.translate(0, 0.08, 0);
  const gemDomeGeo = new THREE.SphereGeometry(0.33, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2); gemDomeGeo.scale(1, 0.38, 1); gemDomeGeo.translate(0, 0.14, 0);
  const gemRingGeo = new THREE.TorusGeometry(0.365, 0.035, 10, 40); gemRingGeo.rotateX(Math.PI / 2); gemRingGeo.translate(0, 0.14, 0);
  const glowInstance = (mat, k) => {
    mat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor * ${k.toFixed(2)};\n#endif`);
    };
    return mat;
  };
  const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, MAX_GEMS); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; hwy.add(m); return m; };
  const gemBase = mk(gemBaseGeo, new THREE.MeshStandardMaterial({ color: 0x0b0a0d, metalness: 0.5, roughness: 0.4 }));
  const gemBody = mk(gemBodyGeo, glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.35 }), 0.12));
  const gemDome = mk(gemDomeGeo, glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.15 }), 0.22));
  const gemRing = mk(gemRingGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.25 }));
  const tails = mk(new THREE.BoxGeometry(1, 1, 1), glowInstance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), 0.45));
  [gemBody, gemDome, tails].forEach((m) => m.setColorAt(0, new THREE.Color()));

  // flames + sparks
  const fTex = flameTex();
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.center.set(0.5, 0.05); hwy.add(sp); flames.push({ sp, t: 9 });
  }
  const SPARKS = 220;
  const sparkGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(SPARKS * 3), spCol = new Float32Array(SPARKS * 3);
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(spCol, 3));
  const sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ map: softDotTex(), size: 0.12, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.frustumCulled = false; hwy.add(sparks);
  let sparkIdx = 0;
  function burst(x, color, n) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = sparkIdx++ % SPARKS;
      spPos[i * 3] = x + (Math.random() - 0.5) * 0.4; spPos[i * 3 + 1] = 0.25; spPos[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
      sparkVel[i * 3] = (Math.random() - 0.5) * 3; sparkVel[i * 3 + 1] = Math.random() * 4 + 1.5; sparkVel[i * 3 + 2] = (Math.random() - 0.3) * 2;
      sparkLife[i] = 0.45 + Math.random() * 0.3;
      const w = Math.random() < 0.5 ? 1 : 0;
      spCol[i * 3] = w || c.r; spCol[i * 3 + 1] = w ? 0.85 : c.g; spCol[i * 3 + 2] = w ? 0.5 : c.b;
    }
  }

  /* --- post --- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* --- layout --- */
  const laneX = (i) => (i - (lanes - 1) / 2) * LW;
  function layoutLanes(n) {
    lanes = n;
    const w = n * LW + 0.5;
    board.scale.x = w;
    rails[0].position.x = -w / 2; rails[1].position.x = w / 2;
    sideTrim[0].position.x = -w / 2 - 0.12; sideTrim[1].position.x = w / 2 + 0.12;
    strike.scale.x = w; frets.scale.set(1, 1, 1);
    for (let i = 0; i < 5; i++) {
      const on = i < n;
      strings[i].mesh.visible = on; buttons[i].g.visible = on;
      strings[i].mesh.position.x = laneX(i); buttons[i].g.position.set(laneX(i), 0, 0);
      flames[i].sp.position.set(laneX(i), 0.2, 0);
    }
    fitCamera();
  }

  let W = 1, H = 1;
  // Analytic camera fit: strike line sits at a fixed screen height and the highway fills a fixed share of the width.
  let pitch = 0.45;
  function fitCamera() {
    const aspect = W / H;
    const portrait = aspect < 0.9;
    camera.aspect = aspect;
    camera.fov = portrait ? 66 : 50;
    pitch = portrait ? 0.62 : 0.5;
    const tf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const wantY = portrait ? -0.6 : -0.7;
    const wantX = portrait ? 0.95 : Math.min(0.5, 1.0 / aspect);
    const half = (lanes * LW + 0.5) / 2 + 0.2;
    const alpha = Math.atan(-wantY * tf);
    const phi = pitch + alpha;
    const cs = half / (wantX * tf * aspect * Math.cos(alpha));
    camera.position.set(0, cs * Math.sin(phi), cs * Math.cos(phi) + 0.3);
    camera.rotation.set(-pitch, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    baseCam.copy(camera.position);
  }
  const baseCam = new THREE.Vector3();

  function resize() {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H);
    bloom.resolution.set(W * (isMobile ? 0.5 : 0.75), H * (isMobile ? 0.5 : 0.75));
    fitCamera();
  }

  const WHITE = new THREE.Color(1, 1, 1);
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const sectionHues = [[0xff5a1a, 0x5a2aff], [0xff2e7a, 0x1a6bff], [0xffb21a, 0xff2e3c], [0x2ee6c8, 0x7a2aff], [0xff6a1a, 0xff1a8a]];
  let hueTarget = 0;

  /* --- public api --- */
  const api = {
    _scene: scene, _beams: beams,
    setLanes: layoutLanes,
    setQualityLevel(q) {
      const high = q !== "low";
      bloom.enabled = high;
      renderer.setPixelRatio(high ? DPR : Math.min(DPR, 1));
      dust.visible = high;
      spots.forEach((s) => (s.visible = high));
      resize();
    },
    resize,
    setSection(i) { hueTarget = i % sectionHues.length; },
    hit(lane, sustain) {
      const f = flames[lane]; f.t = 0;
      f.sp.material.color.setHex(LANE_HEX[lane]).lerp(new THREE.Color(1, 1, 1), 0.45);
      strings[lane].vib = 1; strings[lane].glow = 1; buttons[lane].press = 1;
      burst(laneX(lane), LANE_HEX[lane], sustain ? 8 : 16);
    },
    holdSpark(lane) { if (Math.random() < 0.5) burst(laneX(lane), LANE_HEX[lane], 1); strings[lane].glow = Math.max(strings[lane].glow, 0.7); strings[lane].vib = Math.max(strings[lane].vib, 0.4); },
    miss() { /* reserved */ },
    laneFromClientX(x, rect) {
      let best = 0, bd = 1e9;
      for (let i = 0; i < lanes; i++) {
        tmpV.set(laneX(i), 0, 0).project(camera);
        const sx = rect.left + ((tmpV.x + 1) / 2) * rect.width;
        const d = Math.abs(sx - x); if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    strikeScreenY() { tmpV.set(0, 0, 0).project(camera); return ((1 - tmpV.y) / 2) * H; },
    laneScreenX(i) { tmpV.set(laneX(i), 0, 0).project(camera); return ((tmpV.x + 1) / 2) * W; },

    // state: { t, look, notes:[{t,lane,dur,state,holding}], from, pressed[], beats[[t,bar]], beatPulse, dt, combo }
    render(state) {
      const { t, look, notes, from = 0, pressed = [], beats = [], dt = 0.016 } = state;
      const speed = HL / look;
      const zOf = (time) => -(time - t) * speed;
      // background motion
      const now = performance.now() / 1000;
      smoke.material.uniforms.uTime.value = now;
      // beat pulse
      let pulse = 0;
      for (let i = 0; i < beats.length; i++) { const d = t - beats[i][0]; if (d >= 0 && d < 0.35) pulse = Math.max(pulse, (1 - d / 0.35) * (beats[i][1] ? 1 : 0.5)); }
      smoke.material.uniforms.uPulse.value = pulse;
      const [h1, h2] = sectionHues[hueTarget];
      smoke.material.uniforms.uHue.value.lerp(tmpC.setHex(h1), 0.02);
      smoke.material.uniforms.uHue2.value.lerp(tmpC.setHex(h2), 0.02);
      beams.forEach((b, i) => {
        b.beam.rotation.z = Math.sin(now * 0.5 + b.phase) * 0.45;
        b.beam.rotation.x = -0.15 + Math.sin(now * 0.37 + b.phase * 1.3) * 0.15;
        const c = i % 2 ? smoke.material.uniforms.uHue2.value : smoke.material.uniforms.uHue.value;
        b.beam.material.uniforms.uColor.value.copy(c);
        b.beam.material.uniforms.uIntensity.value = 0.16 + pulse * 0.24;
        b.lamp.material.emissive.copy(c); b.lamp.material.emissiveIntensity = 1.5 + pulse * 3;
      });
      spots.forEach((s, i) => { s.target.position.x = Math.sin(now * 0.4 + i * 2) * 12; s.intensity = 50 + pulse * 60; s.color.copy(i % 2 ? smoke.material.uniforms.uHue2.value : smoke.material.uniforms.uHue.value); });
      railMat.emissiveIntensity = 0.7 + pulse * 0.8;
      strikeLight.intensity = 1.8 + pulse * 1.2;
      const da = dust.geometry.attributes.position;
      for (let i = 0; i < dustN; i++) { da.array[i * 3 + 1] += dt * 0.25; da.array[i * 3] += Math.sin(now + i) * dt * 0.1; if (da.array[i * 3 + 1] > 20) da.array[i * 3 + 1] = 0; }
      da.needsUpdate = true;
      // subtle camera sway
      camera.position.set(baseCam.x + Math.sin(now * 0.3) * 0.06, baseCam.y + pulse * 0.03, baseCam.z);

      // board scroll
      boardTex.offset.y = (t * speed) / 6;

      // fret bars
      let fi = 0;
      const w = lanes * LW + 0.5;
      for (const [bt, bar] of beats) {
        const z = zOf(bt);
        if (z > 0.6 || z < -HL) continue;
        tmpS.set(w, bar ? 1.6 : 0.8, bar ? 1.4 : 0.8);
        tmpM.compose(tmpV.set(0, 0.025, z), tmpQ.identity(), tmpS);
        frets.setMatrixAt(fi++, tmpM);
        if (fi >= 64) break;
      }
      frets.count = fi; frets.instanceMatrix.needsUpdate = true;

      // gems + tails
      let gi = 0, ti = 0;
      for (let i = from; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - t > look * 1.02) break;
        const x = laneX(n.lane);
        // tail
        if (n.dur > 0 && n.t + n.dur > t && ti < MAX_GEMS) {
          const z0 = n.holding ? 0 : Math.min(0.4, zOf(n.t));
          const z1 = Math.max(-HL, zOf(n.t + n.dur));
          if (z0 > z1) {
            const len = z0 - z1;
            const dead = n.state === 2 || (n.state === 1 && !n.holding);
            const wob = n.holding ? Math.sin(now * 40 + i) * 0.03 : 0;
            tmpM.compose(tmpV.set(x + wob, 0.07, z1 + len / 2), tmpQ.identity(), tmpS.set(n.holding ? 0.2 : 0.15, 0.04, len));
            tails.setMatrixAt(ti, tmpM);
            tmpC.setHex(dead ? 0x3a3540 : LANE_HEX[n.lane]); if (n.holding) tmpC.multiplyScalar(1.8);
            tails.setColorAt(ti, tmpC); ti++;
          }
        }
        if (n.state === 1) continue;
        const z = zOf(n.t);
        if (z > 1.4 || gi >= MAX_GEMS) continue;
        const sc = 0.9;
        tmpM.compose(tmpV.set(x, 0.05, z), tmpQ.identity(), tmpS.set(sc, sc, sc));
        gemBase.setMatrixAt(gi, tmpM); gemBody.setMatrixAt(gi, tmpM); gemDome.setMatrixAt(gi, tmpM); gemRing.setMatrixAt(gi, tmpM);
        tmpC.setHex(n.state === 2 ? 0x2a2630 : LANE_HEX[n.lane]);
        gemBody.setColorAt(gi, tmpC); gemDome.setColorAt(gi, tmpC.lerp(WHITE, n.state === 2 ? 0 : 0.08));
        gi++;
      }
      for (const m of [gemBase, gemBody, gemDome, gemRing]) { m.count = gi; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      tails.count = ti; tails.instanceMatrix.needsUpdate = true; if (tails.instanceColor) tails.instanceColor.needsUpdate = true;

      // buttons, strings, flames
      for (let i = 0; i < lanes; i++) {
        const b = buttons[i], p = pressed[i] ? 1 : 0;
        b.press += (Math.max(p, b.press * 0.82) - b.press) * 0.5;
        b.cap.position.y = 0.2 - 0.07 * (p || b.press * 0.5);
        b.center.position.y = b.cap.position.y;
        b.cap.material.emissiveIntensity = 0.2 + (p ? 0.9 : 0) + b.press * 0.6;
        b.center.material.emissiveIntensity = p ? 1.2 : b.press;
        b.rim.material.emissiveIntensity = 0.25 + pulse * 0.4 + b.press;
        const s = strings[i];
        s.vib *= Math.pow(0.02, dt); s.glow *= Math.pow(0.05, dt);
        s.mesh.position.x = laneX(i) + Math.sin(now * 90 + i) * 0.035 * s.vib;
        s.mesh.material.emissive.setHex(LANE_HEX[i]).multiplyScalar(s.glow * 0.8);
        const f = flames[i]; f.t += dt;
        const k = f.t / 0.28;
        f.sp.material.opacity = k < 1 ? (1 - k) * 0.7 : 0;
        f.sp.scale.set(0.7 + k * 0.4, 1.0 + k * 1.1, 1);
      }
      // sparks
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) { spPos[i * 3 + 1] = -50; continue; }
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 9 * dt;
        spPos[i * 3] += sparkVel[i * 3] * dt; spPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;

      composer.render();
    },
  };
  layoutLanes(5);
  resize();
  return api;
}
