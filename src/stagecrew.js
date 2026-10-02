// Corde — the people: a crowd in front of the stage and a band on it, both moving with the song.
// Everything is driven by the beat (phase, beat in the bar) and by the song's energy, so a quiet verse
// has a swaying crowd with lights up and a band that barely moves, and a loud chorus has everyone jumping.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const rnd = (a, b) => a + Math.random() * (b - a);
const frac = (x) => x - Math.floor(x);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
// on the beat: 1, then falling off over the beat
const kick = (ph) => Math.pow(1 - clamp01(ph), 2.2);
const DOWN = new THREE.Vector3(0, -1, 0);

/* ======================================================================
   CROWD — dark figures seen from behind, rim-lit by the stage. They live in a layer glued to the camera,
   placed in screen space beside the guitar neck (bottom corners on a wide screen, both sides of the neck on
   a phone held upright), so they always frame the highway and never cover it.
   ====================================================================== */
const CROWD_VS = `
varying vec3 vN; varying vec3 vP; varying float vB;
void main() {
  vec4 p = vec4(position, 1.0); vec3 n = normal;
  vB = 1.0;
  #ifdef USE_INSTANCING_COLOR
  vB = instanceColor.r;
  #endif
  #ifdef USE_INSTANCING
  p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n); vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const CROWD_FS = `
uniform vec3 uRim; uniform vec3 uFill;
varying vec3 vN; varying vec3 vP; varying float vB;
void main() {
  vec3 n = normalize(vN), v = normalize(-vP);
  float fr = 1.0 - clamp(abs(dot(n, v)), 0.0, 1.0);
  float up = clamp(n.y, 0.0, 1.0);
  vec3 c = uFill + uRim * vB * (pow(fr, 3.2) * (0.2 + 1.0 * up) + pow(up, 4.0) * 0.16);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

function crowdGeometries() {
  // unit person: origin at the base of the neck, facing away from us (towards the stage, -z)
  const torso = new THREE.LatheGeometry([
    [0.001, -1.95], [0.47, -1.95], [0.5, -1.2], [0.6, -0.55], [0.66, -0.18], [0.61, 0.02], [0.43, 0.13], [0.2, 0.19], [0.001, 0.21],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 12);
  torso.scale(1, 1, 0.62);
  const head = new THREE.SphereGeometry(0.3, 12, 9); head.scale(1, 1.12, 1.05); head.translate(0, 0.55, 0);
  const hair = new THREE.CapsuleGeometry(0.31, 0.5, 3, 10); hair.translate(0, 0.38, 0.07);
  const upper = new THREE.CapsuleGeometry(0.15, 0.58, 3, 8); upper.translate(0, -0.3, 0);
  const fore = mergeGeometries([
    new THREE.CapsuleGeometry(0.13, 0.48, 3, 8).translate(0, -0.25, 0),
    new THREE.SphereGeometry(0.17, 8, 6).translate(0, -0.66, 0),
  ]);
  return { torso, head, hair, upper, fore };
}

export function createCrowd(bg, camera, { max = 80, dotTex }) {
  const uni = { uRim: { value: new THREE.Color(0xff9a50) }, uFill: { value: new THREE.Color(0x050302) } };
  const mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: CROWD_VS, fragmentShader: CROWD_FS, fog: false });
  const G = crowdGeometries();
  const layer = new THREE.Group(); layer.matrixAutoUpdate = false; bg.add(layer);
  const mk = (geo, order) => { const m = new THREE.InstancedMesh(geo, mat, max); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.renderOrder = order; layer.add(m); return m; };
  // the crowd stands in front of everything in the venue: the first part drawn clears the depth buffer
  const torso = mk(G.torso, 60);
  torso.onBeforeRender = (r) => r.clearDepth();
  const parts = { torso, head: mk(G.head, 61), hair: mk(G.hair, 61), upL: mk(G.upper, 61), foreL: mk(G.fore, 61), upR: mk(G.upper, 61), foreR: mk(G.fore, 61) };

  // phone lights / lighters held up in the quiet parts
  const lightPos = new Float32Array(max * 3), lightCol = new Float32Array(max * 3);
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute("position", new THREE.BufferAttribute(lightPos, 3));
  lgeo.setAttribute("color", new THREE.BufferAttribute(lightCol, 3));
  const lights = new THREE.Points(lgeo, new THREE.PointsMaterial({ map: dotTex, size: 0.9, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
  lights.frustumCulled = false; lights.renderOrder = 62; layer.add(lights);

  let people = [];
  const M = new THREE.Matrix4(), P = new THREE.Matrix4(), A = new THREE.Matrix4(), B = new THREE.Matrix4(), T = new THREE.Matrix4();
  const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();

  /** Places the crowd for the current screen. edgeX(ndcY) = the highway's left edge in NDC at that height (or null above it). */
  function layout(aspect, tf, edgeX) {
    const portrait = aspect < 0.9;
    const L = portrait ? { y0: -0.36, y1: 0.36, w0: 0.34, w1: 0.12 } : { y0: -1.02, y1: -0.22, w0: 0.22, w1: 0.085 };
    const cap = portrait ? Math.min(max, 46) : max;
    people = [];
    let y = L.y0, row = 0;
    while (y <= L.y1 && people.length < cap) {
      const k = (y - L.y0) / (L.y1 - L.y0);
      const w = L.w0 + (L.w1 - L.w0) * k;
      const ex = edgeX(y);
      const inner = ex == null ? -0.16 : Math.min(-0.05, ex + w * 0.45); // may stand half behind the neck
      for (const side of [-1, 1]) {
        let x = -1.08 + rnd(0, w * 0.6);
        while (x < inner && people.length < cap) {
          const d = 12 + k * 26 + rnd(-0.4, 0.4);                 // lower rows are closer to us
          const sc = (w * (0.86 + rnd(-0.06, 0.1))) * d * tf * aspect / 1.3; // shoulders ≈ w wide on screen
          const yy = y + rnd(-0.25, 0.25) * w * aspect;
          people.push({
            x: side * x * d * tf * aspect, y: yy * d * tf, z: -d, s: sc,
            th: rnd(0.12, 0.8), style: Math.floor(Math.random() * 4), lighter: Math.random() < 0.34, hair: Math.random() < 0.38,
            jumpy: Math.random() < 0.6, ph: rnd(-0.06, 0.08), sway: rnd(0, 6.28), lean: rnd(-0.06, 0.06), side,
            arms: { uL: 0.15, uR: 0.15, bL: 0.3, bR: 0.3, oL: 0.08, oR: 0.08 }, j: 0, depthK: k,
          });
          x += w * (0.62 + rnd(0, 0.32)) * (1 + row * 0.04);
        }
      }
      y += w * aspect * (portrait ? 0.62 : 0.5);
      row++;
    }
    // far rows first so near ones draw over them
    people.sort((a, b) => a.z - b.z);
    let hairN = 0;
    for (const p of people) if (p.hair) p.hairI = hairN++;
    for (const k in parts) parts[k].count = k === "hair" ? hairN : people.length;
    // the rows further back are darker (less stage light reaches them), and nobody is lit quite the same
    const c = new THREE.Color();
    people.forEach((p, i) => {
      const b = (0.38 + 0.62 * Math.pow(1 - (p.depthK || 0), 1.3)) * rnd(0.7, 1);
      c.setRGB(b, b, b);
      for (const k in parts) { if (k === "hair") { if (p.hair) parts.hair.setColorAt(p.hairI, c); } else parts[k].setColorAt(i, c); }
    });
    for (const k in parts) if (parts[k].instanceColor) parts[k].instanceColor.needsUpdate = true;
    const ss = people.map((p) => p.s).sort((a, b) => a - b);
    lights.material.size = (ss[ss.length >> 1] || 1) * 0.24;
  }

  function armMatrices(Pm, side, up, out, bend, upMesh, foreMesh, i) {
    // shoulder → upper arm (raise towards the stage, then out to the side) → forearm (elbow bend)
    A.makeTranslation(side * 0.58, -0.08, 0);
    // "out" always opens the arm away from the body, whether it hangs down or points up
    e.set(up, 0, side * out * (Math.cos(up) >= 0 ? 1 : -1), "ZYX"); T.makeRotationFromEuler(e);
    A.multiply(T); M.multiplyMatrices(Pm, A); upMesh.setMatrixAt(i, M);
    B.makeTranslation(0, -0.68, 0); T.makeRotationX(bend); B.multiply(T);
    A.multiply(B); M.multiplyMatrices(Pm, A); foreMesh.setMatrixAt(i, M);
    return A; // forearm frame (fist at 0,-0.66,0)
  }

  /** f: {bpos (beats, continuous), ph, E (song energy), hype, star, dt, now, rim (Color)} */
  function update(f, cam) {
    layer.matrix.copy(cam.matrixWorld); layer.matrixWorldNeedsUpdate = true;
    const { bpos, ph, E, hype, star, dt, now } = f;
    const lvl = clamp01(E * (0.62 + 0.38 * hype) + star * 0.25);  // how into it the crowd is
    const calm = 1 - smooth(0.22, 0.5, E);
    uni.uRim.value.copy(f.rim);
    const k = Math.min(1, dt * 8);
    let li = 0;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const into = smooth(p.th - 0.12, p.th + 0.12, lvl);        // 0 = just watching, 1 = going wild
      const lp = frac(ph + p.ph);
      const beat = kick(lp);
      const jumpT = p.jumpy ? into * smooth(0.55, 0.85, lvl) : 0;
      const j = jumpT * 0.42 * Math.sin(Math.PI * lp);
      p.j += (j - p.j) * Math.min(1, dt * 30);
      const roll = Math.sin((bpos / 4) * Math.PI * 2 + p.sway) * 0.07 * calm + p.lean;
      const bob = (0.04 + 0.08 * into) * beat;
      v.set(p.x, p.y + p.j * p.s - bob * p.s * 0.4, p.z);
      e.set(-0.05 * beat * into, 0, roll); q.setFromEuler(e); s.setScalar(p.s);
      P.compose(v, q, s);
      parts.torso.setMatrixAt(i, P);
      T.makeTranslation(0, -0.05 * beat * (0.3 + into), -0.06 * beat * into); M.multiplyMatrices(P, T);
      parts.head.setMatrixAt(i, M);
      if (p.hair) parts.hair.setMatrixAt(p.hairI, M);

      // arms: targets by style and energy, eased so poses blend instead of popping
      const a = p.arms;
      let uL = 0.12, uR = 0.12, bL = 0.35, bR = 0.35, oL = 0.1, oR = 0.1;
      const light = p.lighter && calm > 0.4;
      if (light) {
        uR = 2.55; bR = 0.25; oR = 0.12 + Math.sin(now * 0.9 + p.sway) * 0.28; // sways slowly over the head
      } else if (into > 0.05) {
        const pump = Math.sin(Math.PI * lp);                          // fist up on the beat
        if (p.style === 0) { uR = 1.9 + 0.6 * into + 0.25 * pump * into; bR = 1.05 - 0.9 * pump * into; oR = 0.12; }
        else if (p.style === 1) { uL = uR = 2.55 * into + 0.12; bL = bR = 0.18; oL = oR = 0.34 * into + 0.05 * pump; }      // both up (horns)
        else if (p.style === 2) { const alt = Math.floor(bpos) % 2 ? 1 : 0; uL = 1.6 + 0.8 * into * (alt ? pump : 0.4); uR = 1.6 + 0.8 * into * (alt ? 0.4 : pump); bL = 0.9 - 0.6 * into; bR = bL; oL = oR = 0.18; }
        else { uL = 2.6 * into + 0.12; bL = 0.22; oL = 0.25; uR = 0.2 + 0.5 * into; bR = 1.1 * into; }
        if (into < 1) { uL = 0.12 + (uL - 0.12) * into; uR = 0.12 + (uR - 0.12) * into; }
      }
      a.uL += (uL - a.uL) * k; a.uR += (uR - a.uR) * k; a.bL += (bL - a.bL) * k; a.bR += (bR - a.bR) * k; a.oL += (oL - a.oL) * k; a.oR += (oR - a.oR) * k;
      armMatrices(P, -1, a.uL, a.oL, a.bL, parts.upL, parts.foreL, i);
      const fr = armMatrices(P, 1, a.uR, a.oR, a.bR, parts.upR, parts.foreR, i);
      if (light) {
        v.set(0, -0.74, 0).applyMatrix4(M.multiplyMatrices(P, fr));
        lightPos[li * 3] = v.x; lightPos[li * 3 + 1] = v.y; lightPos[li * 3 + 2] = v.z;
        const fl = 0.75 + 0.25 * Math.sin(now * 13 + i * 3.1);
        lightCol[li * 3] = fl; lightCol[li * 3 + 1] = fl * 0.92; lightCol[li * 3 + 2] = fl * 0.78;
        li++;
      }
    }
    for (const kk in parts) { parts[kk].instanceMatrix.needsUpdate = true; }
    lgeo.setDrawRange(0, li);
    lgeo.attributes.position.needsUpdate = true; lgeo.attributes.color.needsUpdate = true;
    lights.material.opacity = smooth(0.4, 0.75, calm);
  }

  return { layout, update, setVisible(on) { layer.visible = on; }, get count() { return people.length; } };
}

/* ======================================================================
   BAND — low-poly 3D musicians (guitar, bass, singer, drums) with simple IK arms and legs, lit by the
   stage lights plus a rim light so they read against the dark amps.
   ====================================================================== */
function rimMaterial(params, rim) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = rim;
    sh.fragmentShader = "uniform vec3 uRim;\n" + sh.fragmentShader.replace("#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n{ float fr = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0); totalEmissiveRadiance += uRim * pow(fr, 3.4); }");
  };
  return m;
}
// a limb segment hanging from its joint (along -y), so it can be pointed at the next joint
function segGeo(len, r, rs = 8) { const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 0.6), 3, rs); g.translate(0, -len / 2, 0); return g; }

// two-bone IK: elbow position for shoulder S, target T, bone lengths a, b, elbow pointing towards pole
const _u = new THREE.Vector3(), _w = new THREE.Vector3();
function solve2(S, T, a, b, pole, outE, outT) {
  _u.subVectors(T, S); let d = _u.length();
  const dd = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, d));
  _u.divideScalar(d || 1);
  outT.copy(S).addScaledVector(_u, Math.min(d, dd));
  const cos = (a * a + dd * dd - b * b) / (2 * a * dd), sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u)).normalize();
  outE.copy(S).addScaledVector(_u, a * cos).addScaledVector(_w, a * sin);
}
function point(mesh, from, to) {
  mesh.position.copy(from);
  _u.subVectors(to, from).normalize();
  mesh.quaternion.setFromUnitVectors(DOWN, _u);
}

function guitarShape() {
  const s = new THREE.Shape();
  // double-cut solid body, neck end at +x
  s.moveTo(-1.25, 0); s.bezierCurveTo(-1.3, 0.75, -0.75, 1.0, -0.3, 0.8); s.bezierCurveTo(0.1, 0.62, 0.35, 0.7, 0.6, 0.85);
  s.bezierCurveTo(0.95, 1.0, 1.05, 0.6, 0.78, 0.3); s.lineTo(0.95, 0.12); s.lineTo(0.95, -0.12); s.lineTo(0.78, -0.3);
  s.bezierCurveTo(1.0, -0.62, 0.95, -0.95, 0.6, -0.85); s.bezierCurveTo(0.35, -0.75, 0.1, -0.68, -0.3, -0.82);
  s.bezierCurveTo(-0.75, -1.0, -1.3, -0.75, -1.25, 0);
  return s;
}

export function createBand(bg, { kitPos, cymbals }) {
  const rim = { value: new THREE.Color(0xff9a50) };
  const M = {
    jacket: rimMaterial({ color: 0x2b2522, roughness: 0.6, metalness: 0.2 }, rim),
    shirt: rimMaterial({ color: 0x4a1f1c, roughness: 0.85 }, rim),
    jeans: rimMaterial({ color: 0x1f2738, roughness: 0.85 }, rim),
    skin: rimMaterial({ color: 0xc08a68, roughness: 0.55 }, rim),
    hair: rimMaterial({ color: 0x0a0706, roughness: 0.55, metalness: 0.2 }, rim),
    boot: rimMaterial({ color: 0x080606, roughness: 0.35, metalness: 0.3 }, rim),
    gtrRed: rimMaterial({ color: 0x8c0f12, roughness: 0.28, metalness: 0.35 }, rim),
    gtrBlack: rimMaterial({ color: 0x0c0b0b, roughness: 0.25, metalness: 0.45 }, rim),
    guard: rimMaterial({ color: 0xd8d0c0, roughness: 0.4 }, rim),
    wood: rimMaterial({ color: 0x3a2214, roughness: 0.6 }, rim),
    chrome: rimMaterial({ color: 0xc8c4bc, roughness: 0.2, metalness: 1 }, rim),
    stick: rimMaterial({ color: 0xd8c098, roughness: 0.6 }, rim),
  };
  const G = {
    thigh: segGeo(2.3, 0.44), shin: segGeo(2.25, 0.36), upper: segGeo(1.6, 0.32), fore: segGeo(1.5, 0.27),
    hand: new THREE.SphereGeometry(0.28, 8, 6), boot: new THREE.BoxGeometry(0.5, 0.36, 0.95).translate(0, 0.08, 0.2),
    pelvis: new THREE.CapsuleGeometry(0.42, 0.62, 3, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.75),
    torso: new THREE.LatheGeometry([[0.001, -0.1], [0.62, -0.1], [0.66, 0.5], [0.8, 1.6], [0.9, 2.35], [0.82, 2.65], [0.5, 2.85], [0.22, 2.95], [0.001, 2.98]].map(([x, y]) => new THREE.Vector2(x, y)), 14).scale(1.12, 1, 0.66),
    head: new THREE.SphereGeometry(0.6, 14, 10).scale(0.95, 1.1, 1).translate(0, 0.75, 0.04),
    hair: new THREE.CapsuleGeometry(0.6, 1.25, 3, 10).scale(1.06, 1, 0.75).translate(0, -0.55, -0.12),
    neckSeg: new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8).translate(0, 0.15, 0),
  };
  const body = new THREE.ExtrudeGeometry(guitarShape(), { depth: 0.26, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 10 });
  body.translate(0, 0, -0.13);

  function makeGuitar(bodyMat, scale = 1) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(body, bodyMat));
    const guard = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), M.guard); guard.position.set(0.15, -0.3, 0.16); guard.scale.set(1.3, 0.8, 1); g.add(guard);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.26, 0.14), M.wood); neck.position.set(2.55, 0, 0.08); g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.1), bodyMat); head.position.set(4.5, 0.06, 0.08); head.rotation.z = 0.12; g.add(head);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.06), M.chrome); bridge.position.set(-0.45, 0, 0.18); g.add(bridge);
    g.scale.setScalar(scale);
    return g;
  }

  function makeHuman({ hairLen = 1, shirt = M.jacket, seated = false } = {}) {
    const root = new THREE.Group();
    const pelvis = new THREE.Group(); root.add(pelvis);
    pelvis.add(new THREE.Mesh(G.pelvis, M.jeans));
    const spine = new THREE.Group(); spine.position.y = 0.1; pelvis.add(spine);
    spine.add(new THREE.Mesh(G.torso, shirt));
    const neck = new THREE.Group(); neck.position.y = 2.82; spine.add(neck);
    neck.add(new THREE.Mesh(G.neckSeg, M.skin));
    neck.add(new THREE.Mesh(G.head, M.skin));
    const hairPivot = new THREE.Group(); hairPivot.position.set(0, 1.25, -0.12); neck.add(hairPivot);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.66, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.9, 1.04).translate(0, -0.42, 0.12), M.hair);
    neck.add(cap); cap.position.set(0, 1.25, -0.12); // short hair on top of the head
    if (hairLen >= 0.5) { const h = new THREE.Mesh(G.hair, M.hair); h.scale.y = hairLen; hairPivot.add(h); } // long hair swings
    const arm = () => ({ up: new THREE.Mesh(G.upper, shirt), fore: new THREE.Mesh(G.fore, shirt), hand: new THREE.Mesh(G.hand, M.skin) });
    const armL = arm(), armR = arm();
    [armL, armR].forEach((a) => spine.add(a.up, a.fore, a.hand));
    const leg = () => ({ th: new THREE.Mesh(G.thigh, M.jeans), sh: new THREE.Mesh(G.shin, M.jeans), boot: new THREE.Mesh(G.boot, M.boot) });
    const legL = leg(), legR = leg();
    if (!seated) [legL, legR].forEach((l) => root.add(l.th, l.sh, l.boot));
    bg.add(root);
    return { root, pelvis, spine, neck, hairPivot, armL, armR, legL, legR, hairA: 0, hairV: 0 };
  }

  const tmpS = new THREE.Vector3(), tmpE = new THREE.Vector3(), tmpT = new THREE.Vector3(), tmpH = new THREE.Vector3();
  const SH_L = new THREE.Vector3(1.02, 2.5, 0), SH_R = new THREE.Vector3(-1.02, 2.5, 0);
  // arm in spine space: shoulder → target, elbow towards pole
  function setArm(a, S, target, pole, la = 1.6, lb = 1.5) {
    solve2(S, target, la, lb, pole, tmpE, tmpT);
    point(a.up, S, tmpE); point(a.fore, tmpE, tmpT);
    a.hand.position.copy(tmpT);
    return tmpT;
  }
  const HIP_L = new THREE.Vector3(), HIP_R = new THREE.Vector3(), KNEE_POLE = new THREE.Vector3(0, 0, 1);
  function setLegs(h, footL, footR) {
    h.pelvis.updateMatrix();
    HIP_L.set(0.48, -0.1, 0).applyMatrix4(h.pelvis.matrix); HIP_R.set(-0.48, -0.1, 0).applyMatrix4(h.pelvis.matrix);
    for (const [l, hip, foot, sx] of [[h.legL, HIP_L, footL, 1], [h.legR, HIP_R, footR, -1]]) {
      KNEE_POLE.set(sx * 0.25, 0, 1);
      solve2(hip, foot, 2.3, 2.25, KNEE_POLE, tmpE, tmpT);
      point(l.th, hip, tmpE); point(l.sh, tmpE, tmpT);
      l.boot.position.set(tmpT.x, 0, tmpT.z); l.boot.rotation.y = sx * 0.2;
    }
  }
  // long hair: a damped spring that lags behind the head (small steps keep it stable on slow frames)
  function hairSpring(h, target, dt) {
    const w = 15, z = 0.35, n = Math.min(12, Math.ceil(dt / 0.008)), st = dt / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      h.hairV += (w * w * (target - h.hairA) - 2 * z * w * h.hairV) * st;
      h.hairA = Math.max(-1.1, Math.min(0.9, h.hairA + h.hairV * st));
    }
    h.hairPivot.rotation.x = h.hairA;
  }

  // --- the band ---
  const gtr = makeHuman({ hairLen: 1.1 });
  gtr.root.position.set(-8.6, -0.9, -38); gtr.root.rotation.y = 0.32;
  gtr.guitar = makeGuitar(M.gtrRed); gtr.spine.add(gtr.guitar);
  const bass = makeHuman({ hairLen: 0.8, shirt: M.shirt });
  bass.root.position.set(8.8, -0.9, -39); bass.root.rotation.y = -0.34;
  bass.guitar = makeGuitar(M.gtrBlack, 1.08); bass.spine.add(bass.guitar);
  const voc = makeHuman({ hairLen: 0.3 });
  voc.root.position.set(3.0, -0.9, -34.5); voc.root.rotation.y = -0.12;
  const stand = new THREE.Group(); voc.root.add(stand); stand.position.set(-0.35, 0, 1.5);
  stand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7.5, 6).translate(0, 3.75, 0), M.chrome));
  stand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 12), M.boot));
  const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 3, 8), M.boot); mic.position.set(0, 7.65, -0.2); mic.rotation.x = -1.1; stand.add(mic);
  const drm = makeHuman({ hairLen: 0.7, shirt: M.shirt, seated: true });
  drm.root.position.set(kitPos.x, kitPos.y + 1.3, kitPos.z - 1.5);
  const sticks = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.7, 5).translate(0, -0.85, 0), M.stick); drm.spine.add(m); return m; });
  const members = [gtr, bass, voc, drm];

  // drum targets in the kit's own coordinates → drummer root space
  const kitL = (x, y, z) => new THREE.Vector3(x - (drm.root.position.x - kitPos.x), y - 1.3, z + 1.5);
  const DR = { hat: kitL(-3.9, 4.35, 1.1), crash: kitL(-3.2, 6.15, 0.45), snare: kitL(-1.9, 3.35, 0.8), ride: kitL(3.3, 6.35, 0.3), tomL: kitL(-0.9, 5.0, 0.7), tomR: kitL(0.95, 5.0, 0.7), floor: kitL(2.5, 3.2, 0.7) };
  const cym = { hat: cymbals[2], crash: cymbals[0], ride: cymbals[1], crash2: cymbals[3] };
  for (const c of cymbals) { c.userData.rx = c.rotation.x; c.userData.rz = c.rotation.z; c.userData.w = 0; c.userData.f = 0; }
  const hitCym = (c, k = 1) => { if (!c) return; c.userData.w = Math.max(c.userData.w, 0.16 * k); c.userData.f = Math.max(c.userData.f, k); };

  const inv = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
  // root-space point → spine space (the spine moves with the pelvis)
  function rootToSpine(h, p, out) {
    h.pelvis.updateMatrix(); h.spine.updateMatrix();
    tmpM.multiplyMatrices(h.pelvis.matrix, h.spine.matrix);
    inv.copy(tmpM).invert();
    return out.copy(p).applyMatrix4(inv);
  }
  const gtrPoint = (g, x, y, z, out) => { g.guitar.updateMatrix(); return out.set(x, y, z).applyMatrix4(g.guitar.matrix); };

  let lastBeat = -1;
  const POLE_STRUM = new THREE.Vector3(-0.9, -0.6, -0.5), POLE_FRET = new THREE.Vector3(0.5, -1, -0.3);
  const POLE_UP = new THREE.Vector3(0.7, -0.4, -0.6), POLE_MIC = new THREE.Vector3(-0.8, -0.8, -0.2);
  const FOOT = (x, z) => new THREE.Vector3(x, 0.25, z);
  const feetG = [FOOT(1.0, 0.25), FOOT(-1.05, -0.15)], feetB = [FOOT(0.95, -0.1), FOOT(-1.0, 0.3)], feetV = [FOOT(0.75, 0.1), FOOT(-0.8, -0.05)];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

  function guitarist(h, f, { half = false, feet, fretBase = 2.2 }) {
    const { bpos, E, dt } = f;
    const bang = smooth(0.5, 0.82, E), bounce = 0.2 + 0.8 * smooth(0.25, 0.75, E), calm = 1 - smooth(0.2, 0.55, E);
    const bp = half ? bpos / 2 : bpos, lp = frac(bp), beat = kick(lp);
    const lpb = frac(bpos);
    h.pelvis.position.y = 4.35 - 0.34 * bounce * kick(lpb);
    h.pelvis.rotation.z = calm * 0.07 * Math.sin((bpos / 2) * Math.PI);
    h.spine.rotation.x = 0.1 + bang * 0.2 * beat;
    h.spine.rotation.y = calm * 0.12 * Math.sin((bpos / 4) * Math.PI * 2 + 1);
    const nod = 0.06 + bang * 0.72 * beat + (1 - bang) * 0.13 * kick(lpb);
    h.neck.rotation.x = nod;
    hairSpring(h, -nod * 0.75, dt);
    // rock pose: neck of the guitar up on the first beat of the bar when it's loud
    const pose = smooth(0.8, 0.95, E) * (f.bar === 0 ? kick(lpb) : 0);
    h.guitar.position.set(-0.3, 0.3, 0.8);
    h.guitar.rotation.set(-0.12, 0.08, 0.5 + pose * 0.35 + bang * 0.05 * beat);
    // strum: once a beat when calm, 8ths in the middle, 16ths when it's loud
    const sub = E < 0.35 ? 1 : E < 0.72 ? 2 : 4;
    const st = Math.cos(frac(bpos * sub) * Math.PI * 2);
    gtrPoint(h, -0.2, st * (0.28 + 0.2 * (1 - E)), 0.38, v1);
    setArm(h.armR, SH_R, v1, POLE_STRUM);
    // fretting hand: changes position with the chords (every bar)
    const bar = Math.floor(bpos / 4);
    h.fx = h.fx == null ? fretBase : h.fx + ((fretBase + hash(bar + (half ? 9 : 0)) * 1.4) - h.fx) * Math.min(1, dt * 10);
    gtrPoint(h, h.fx, -0.05, -0.12, v2);
    setArm(h.armL, SH_L, v2, POLE_FRET);
    setLegs(h, feet[0], feet[1]);
  }

  function singer(h, f) {
    const { bpos, E, dt } = f;
    const lpb = frac(bpos), beat = kick(lpb);
    const bounce = 0.15 + 0.85 * smooth(0.3, 0.8, E), wild = smooth(0.62, 0.9, E), calm = 1 - smooth(0.2, 0.55, E);
    h.pelvis.position.y = 4.35 - 0.3 * bounce * beat;
    h.pelvis.rotation.z = calm * 0.08 * Math.sin((bpos / 2) * Math.PI);
    h.spine.rotation.x = 0.14 + 0.1 * wild * beat;
    h.spine.rotation.y = 0.1 * Math.sin((bpos / 8) * Math.PI * 2);
    const nod = 0.05 + (0.12 + wild * 0.35) * kick(frac(bpos / 2));
    h.neck.rotation.x = nod;
    hairSpring(h, -nod * 0.75, dt);
    // right hand on the mic
    stand.updateMatrix(); mic.updateMatrix();
    v1.set(0, 0.05, 0.3).applyMatrix4(mic.matrix).applyMatrix4(stand.matrix);
    rootToSpine(h, v1, v2);
    setArm(h.armR, SH_R, v2, POLE_MIC);
    // left hand: rests near the body when it's quiet, fist in the air on the beat when it's loud
    const pump = Math.sin(Math.PI * lpb);
    v1.set(1.25 + 0.15 * Math.sin(bpos * 0.8), 0.9 + 0.3 * calm * Math.sin(bpos * Math.PI * 0.5), 0.75);
    v2.set(1.25, 4.6 + 0.55 * pump, 0.55);
    v1.lerp(v2, wild);
    setArm(h.armL, SH_L, v1, POLE_UP);
    setLegs(h, feetV[0], feetV[1]);
  }

  function drummer(h, f) {
    const { bpos, E, dt, bar } = f;
    const lpb = frac(bpos), beat = kick(lpb);
    h.pelvis.position.y = 2.2;
    h.spine.rotation.x = 0.18 + 0.08 * beat * (0.3 + E);
    const nod = 0.08 + (0.1 + 0.4 * smooth(0.5, 0.85, E)) * beat;
    h.neck.rotation.x = nod;
    hairSpring(h, -nod * 0.75, dt);
    // right hand: hi-hat (8ths, quarters when calm), crash on the bar's first beat when it's loud
    const sub = E < 0.3 ? 1 : 2;
    const cell = Math.floor(bpos * sub), u = frac(bpos * sub);
    const crashing = E > 0.6 && bar === 0 && cell % (sub * 4) < sub;
    const fill = E > 0.55 && Math.floor(bpos / 4) % 4 === 3 && bar === 3; // a tom fill closing every 4 bars
    let rT = crashing ? DR.crash : DR.hat, lT = DR.snare;
    let ul = frac((bpos - 1) / 2); // left hand: snare on 2 and 4
    if (fill) { const k = Math.floor(bpos * 4) % 4; rT = [DR.tomL, DR.tomR, DR.floor, DR.floor][k]; lT = [DR.tomL, DR.tomL, DR.tomR, DR.floor][k]; ul = frac(bpos * 4 + 0.5); }
    const ur = fill ? frac(bpos * 4) : u;
    const lift = (x) => 0.9 * Math.pow(Math.sin(Math.PI * x), 0.6);
    for (const [arm, S, drum, uu, pole, si] of [[h.armR, SH_R, rT, ur, POLE_STRUM, 0], [h.armL, SH_L, lT, ul, POLE_FRET, 1]]) {
      rootToSpine(h, drum, v1);
      v2.copy(S).lerp(v1, 0.6); v2.y += lift(uu) * 1.1; v2.z += 0.25;
      const hand = setArm(arm, S, v2, pole, 1.75, 1.6);
      point(sticks[si], hand, v1);
    }
    // cymbal hits when a stroke lands
    const strokeId = fill ? -1 : cell;
    if (strokeId !== h.lastStroke) { h.lastStroke = strokeId; if (strokeId >= 0) hitCym(crashing ? cym.crash : cym.hat, crashing ? 1 : 0.35 + 0.4 * E); }
  }

  function update(f) {
    rim.value.copy(f.rim).multiplyScalar(0.22);
    if (Math.floor(f.bpos) !== lastBeat) { lastBeat = Math.floor(f.bpos); if (f.E > 0.75 && f.bar === 0) hitCym(cym.crash2, 0.6); }
    guitarist(gtr, f, { feet: feetG });
    guitarist(bass, f, { half: true, feet: feetB, fretBase: 1.8 });
    singer(voc, f);
    drummer(drm, f);
    for (const c of cymbals) {
      const u = c.userData; u.w *= Math.pow(0.04, f.dt); u.f *= Math.pow(0.02, f.dt);
      c.rotation.x = u.rx + Math.sin(f.now * 21) * u.w; c.rotation.z = u.rz + Math.cos(f.now * 17) * u.w * 0.6;
      c.material.emissiveIntensity = 0.3 + u.f * 2.2;
    }
  }
  // on a phone held upright the stage is narrow on screen: the band stands closer together
  function layout(portrait) {
    gtr.root.position.x = portrait ? -5.4 : -8.6; bass.root.position.x = portrait ? 5.6 : 8.8; voc.root.position.x = portrait ? 2.2 : 3.0;
    gtr.root.rotation.y = portrait ? 0.22 : 0.32; bass.root.rotation.y = portrait ? -0.24 : -0.34;
  }
  return { update, layout, members };
}
