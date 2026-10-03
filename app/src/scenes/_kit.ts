// Shared scene parts: a lit three.js stage that renders into the scene's HDR target, engraved 3D
// noteheads (Bravura outlines, extruded), staff lines that ring like strings when a note lands, and
// impact sparks. Read-only for scene authors (ask the lead for changes), like pdoom's _motifs.ts.
import * as THREE from 'three';
import { FSPass, W, H, PW, PH, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { glyphGeometry, ENGRAVE, type GlyphName } from '../engine/music';
import { hash, mulberry32 } from '../engine/util';
import { styled, STYLE } from '../engine/style';

export type RGB = [number, number, number];
export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mixRGB = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// ------------------------------------------------------------------ the stage
/**
 * A three.js scene with a camera and the house lighting: a cool-white key from above-left, a fate-red
 * rim from behind, a dim fill. Units: 1 = one staff space.
 */
export class Stage3D {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(32, W / H, 0.5, 2000); // near 0.5 (not 0.1): 5x the depth precision far out (no z-fighting in wide shots)
  key = new THREE.DirectionalLight(0xffffff, 3.2);
  rim = new THREE.DirectionalLight(0xffffff, 0);
  fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0.25);
  constructor() {
    this.key.position.set(-6, 14, 9);
    this.rim.position.set(4, 3, -12);
    this.rim.color.setRGB(...LIN.cobalt, THREE.LinearSRGBColorSpace); // cool rim: the red is kept for the sounding note
    this.scene.add(this.key, this.rim, this.fill);
  }
  /** Look from `eye` at `at` with roll (radians) and vertical fov (degrees). */
  look(eye: THREE.Vector3Like, at: THREE.Vector3Like, roll = 0, fov = 32) {
    const c = this.cam;
    c.fov = fov;
    c.position.set(eye.x, eye.y, eye.z);
    c.up.set(Math.sin(roll), Math.cos(roll), 0);
    c.lookAt(at.x, at.y, at.z);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }
  /** Ink outlines over the objects (toon style draws them by default; see Outline). */
  outline: Outline | null = STYLE === 'toon' ? new Outline() : null;
  /** Render the scene over whatever is in `out` (clears depth only), then its outlines. */
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(out);
    renderer.clear(false, true, false);
    renderer.render(this.scene, this.cam);
    this.outline?.render(renderer, this.scene, this.cam, out);
  }
}

// ------------------------------------------------------------------ 3D rendered as 2D: outlines
/**
 * Line art from the geometry: the scene's view-space normals and depth are rendered once more, and a
 * cross-shaped edge filter draws (1) the silhouette, where an object meets the background, as a bone
 * hairline (line art on black, the pdoom look), and (2) creases and depth steps inside objects as ink
 * lines (the cel look). Widths are in logical px, so 4K keeps the 1080p line weight.
 */
export class Outline {
  rt = makeRT(W, H, { depthTexture: new THREE.DepthTexture(PW, PH), type: THREE.HalfFloatType });
  normalMat = new THREE.MeshNormalMaterial();
  rim: RGB = LIN.bone; rimAlpha = 0.85;
  ink: RGB = LIN.ink; inkAlpha = 0.9;
  width = 1.25;
  pass = new FSPass(/* glsl */ `
    uniform sampler2D nrm, dep; uniform float near, far, width, rimA, inkA; uniform vec3 rimC, inkC; uniform vec2 texel;
    float lz(float d) { return near * far / (far - d * (far - near)); }
    void main() {
      vec2 o = texel * width * PX_SCALE;
      float d0 = texture(dep, vUv).r;
      bool bg0 = d0 > 0.99999;
      vec3 n0 = texture(nrm, vUv).xyz * 2.0 - 1.0;
      float z0 = lz(d0);
      float sil = 0.0, crease = 0.0, step_ = 0.0;
      vec2 offs[8] = vec2[8](vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1), vec2(0.7, 0.7), vec2(-0.7, 0.7), vec2(0.7, -0.7), vec2(-0.7, -0.7));
      for (int i = 0; i < 8; i++) {
        vec2 uv = vUv + offs[i] * o;
        float d = texture(dep, uv).r;
        bool bg = d > 0.99999;
        if (bg0 != bg) { sil = 1.0; continue; }
        if (bg0) continue;
        vec3 n = texture(nrm, uv).xyz * 2.0 - 1.0;
        crease = max(crease, 1.0 - dot(n0, n));
        step_ = max(step_, abs(lz(d) - z0) / z0);
      }
      if (bg0) { fragColor = vec4(0.0); return; }
      float inner = max(smoothstep(0.18, 0.45, crease), smoothstep(0.015, 0.05, step_));
      vec4 c = vec4(inkC, inner * inkA);
      if (sil > 0.0) c = vec4(rimC, rimA);
      fragColor = c;
    }`, {
    nrm: { value: null }, dep: { value: null }, near: { value: 0.1 }, far: { value: 1000 }, width: { value: 1.25 },
    rimA: { value: 0.85 }, inkA: { value: 0.9 }, rimC: { value: new THREE.Vector3() }, inkC: { value: new THREE.Vector3() },
    texel: { value: new THREE.Vector2(1 / PW, 1 / PH) },
  }, { blending: THREE.NormalBlending, transparent: true });

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, out: THREE.WebGLRenderTarget) {
    const prevBg = scene.background;
    scene.overrideMaterial = this.normalMat;
    scene.background = null;
    renderer.setRenderTarget(this.rt);
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x8080ff, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setClearColor(cc, ca);
    scene.overrideMaterial = null;
    scene.background = prevBg;
    const u = this.pass.u;
    u.nrm!.value = this.rt.texture; u.dep!.value = this.rt.depthTexture;
    u.near!.value = cam.near; u.far!.value = cam.far; u.width!.value = this.width;
    u.rimA!.value = this.rimAlpha; u.inkA!.value = this.inkAlpha;
    (u.rimC!.value as THREE.Vector3).set(...this.rim); (u.inkC!.value as THREE.Vector3).set(...this.ink);
    this.pass.render(renderer, out);
  }
}

// ------------------------------------------------------------------ background
/**
 * The void: ink with a faint warm floor glow, a vignette and paper-fibre noise that drifts very
 * slowly. `glow` lifts a red haze from below (the motif's afterglow).
 */
export class Void {
  pass = new FSPass(/* glsl */ `
    uniform float t, glow, lift; uniform vec2 centre; uniform vec3 glowC;
    void main() {
      vec2 p = vUv - centre;
      p.x *= ${(W / H).toFixed(4)};
      float r = length(p);
      vec3 col = C_INK * (0.55 + 0.45 * smoothstep(1.2, 0.0, r)) + lift * C_INK2;
      float fib = fbm(vUv * vec2(6.0, 38.0) + vec2(t * 0.01, 0.0), 3);
      col += C_BONE * 0.0025 * fib;
      col += glowC * glow * 0.22 * exp(-r * r * 3.0) * smoothstep(-0.2, 0.6, 0.5 - vUv.y + 0.5);
      fragColor = vec4(col, 1.0);
    }`, { t: { value: 0 }, glow: { value: 0 }, lift: { value: 0 }, centre: { value: new THREE.Vector2(0.5, 0.45) }, glowC: { value: new THREE.Vector3(...LIN.cobalt) } });
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, t: number, glow = 0, lift = 0) {
    this.pass.u.t!.value = t;
    this.pass.u.glow!.value = glow;
    this.pass.u.lift!.value = lift;
    this.pass.render(renderer, out);
  }
}

// ------------------------------------------------------------------ engraved 3D notes
const geoCache = new Map<string, THREE.BufferGeometry>();
export function glyphGeo(name: GlyphName, depth = 0.5) {
  const k = `${name}:${depth}`;
  let g = geoCache.get(k);
  if (!g) { g = glyphGeometry(name, depth, 0.06); geoCache.set(k, g); }
  return g;
}

/** Material for engraved notes: bone lacquer, with an emissive channel for the sounding glow. */
export function noteMaterial(base: RGB = LIN.bone) {
  return styled({
    color: new THREE.Color().setRGB(base[0], base[1], base[2], THREE.LinearSRGBColorSpace),
    roughness: 0.32, metalness: 0.0,
    emissive: new THREE.Color().setRGB(...LIN.signal, THREE.LinearSRGBColorSpace), emissiveIntensity: 0,
  });
}

/**
 * A note as one object: extruded notehead + stem (a thin box) + optional flag/fermata, in staff
 * spaces with the notehead centred on the origin. `stemUp` puts the stem on the right going up.
 */
export class Note3D {
  group = new THREE.Group();
  head: THREE.Mesh;
  stem: THREE.Mesh | null = null;
  mat: THREE.MeshStandardMaterial;
  constructor(kind: 'black' | 'half' | 'whole' = 'black', stemUp = true, depth = 0.5, mat?: THREE.MeshStandardMaterial) {
    this.mat = mat ?? noteMaterial();
    const name: GlyphName = kind === 'black' ? 'noteheadBlack' : kind === 'half' ? 'noteheadHalf' : 'noteheadWhole';
    this.head = new THREE.Mesh(glyphGeo(name, depth), this.mat);
    const w = ENGRAVE.noteheadBlackW;
    this.head.position.x = -w / 2;
    this.group.add(this.head);
    if (kind !== 'whole') {
      const sw = ENGRAVE.stem * 1.6, len = ENGRAVE.stemLength;
      this.stem = new THREE.Mesh(new THREE.BoxGeometry(sw, len, depth * 0.6), this.mat);
      if (stemUp) this.stem.position.set(w / 2 - sw / 2, ENGRAVE.stemUpSE[1] + len / 2, 0);
      else this.stem.position.set(-w / 2 + sw / 2, ENGRAVE.stemDownNW[1] - len / 2, 0);
      this.group.add(this.stem);
    }
  }
}

/** A single glyph as a mesh (clef, fermata, rest …), origin on its reference line. */
export function glyphMesh(name: GlyphName, depth = 0.4, mat?: THREE.Material) {
  return new THREE.Mesh(glyphGeo(name, depth), mat ?? noteMaterial());
}

// ------------------------------------------------------------------ staff lines that ring
export interface Pluck { t: number; x: number; amp: number }

/**
 * Five staff lines along +x in the plane z = 0 of a frame (origin = left end of the middle line),
 * drawn into a 3D LineBatch. Each pluck sends a damped transverse wave out from x along every line:
 * the staff rings like five strings when a note lands on it.
 */
export function drawStaff(lb: LineBatch, m: THREE.Matrix4, t: number, x0: number, x1: number, plucks: Pluck[], o: { width?: number; color?: RGB; alpha?: number; seg?: number; lines?: number; hum?: number; humAt?: number } = {}) {
  const n = o.seg ?? 220, lines = o.lines ?? 5;
  const col = o.color ?? LIN.bone, wd = o.width ?? ENGRAVE.staffLine * 1.4;
  const v = new THREE.Vector3(), prev = new THREE.Vector3();
  for (let l = 0; l < lines; l++) {
    const y = (l - (lines - 1) / 2);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      let dy = 0;
      for (const p of plucks) {
        const age = t - p.t;
        if (age < 0 || age > 4) continue;
        const d = Math.abs(x - p.x);
        const front = age * 38; // wave speed (spaces/s)
        if (d > front) continue;
        const env = Math.exp(-age * 2.2) * Math.exp(-d * 0.035);
        dy += p.amp * env * Math.sin(d * 0.9 - age * 48 + l * 0.7) * Math.min(1, (front - d) / 3);
      }
      // a held note keeps the lines humming: a standing wave centred on humAt
      if (o.hum) dy += o.hum * Math.sin((x - (o.humAt ?? 0)) * 0.5 + l * 1.3) * Math.sin(t * 71 + l * 2.1) * Math.exp(-Math.abs(x - (o.humAt ?? 0)) * 0.04);
      v.set(x, y + dy, 0).applyMatrix4(m);
      if (i > 0) lb.seg(prev.x, prev.y, prev.z, v.x, v.y, v.z, wd, col[0], col[1], col[2], o.alpha ?? 1);
      prev.copy(v);
    }
  }
}

// ------------------------------------------------------------------ impact sparks
/**
 * A burst of sparks from (x, y, z) at time t0: ballistic, cooling from ember to signal to nothing,
 * drawn as short streaks along their velocity. Pure function of t (deterministic per seed).
 */
export function sparks(lb: LineBatch, t: number, t0: number, x: number, y: number, z: number, seed: number, o: { count?: number; speed?: number; life?: number; gravity?: number; up?: THREE.Vector3; width?: number; gain?: number } = {}) {
  const age = t - t0;
  const life = o.life ?? 0.9;
  if (age < 0 || age > life * 1.6) return;
  const R = mulberry32(seed);
  const n = o.count ?? 60, sp = o.speed ?? 14, g = o.gravity ?? 22;
  const up = o.up ?? new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const th = R() * Math.PI * 2, el = 0.15 + R() * 1.1, s = sp * (0.35 + R() * R() * 1.3), l = life * (0.4 + R() * 0.8);
    if (age > l) { R(); continue; }
    const vx = Math.cos(th) * Math.cos(el) * s, vz = Math.sin(th) * Math.cos(el) * s, vy = Math.sin(el) * s;
    const drag = Math.exp(-age * 2.5);
    const px = x + (vx * (1 - drag)) / 2.5, pz = z + (vz * (1 - drag)) / 2.5;
    const py = y + (vy * (1 - drag)) / 2.5 - 0.5 * g * age * age * up.y;
    const k = age / l;
    const heat = (1 - k) * (1 - k);
    const c = mixRGB(LIN.signal, LIN.ember, heat);
    const gain = (o.gain ?? 6) * heat * (0.5 + R());
    const tail = 0.02 + 0.03 * drag;
    lb.seg(px, py, pz, px - vx * drag * tail, py - (vy * drag - g * age) * tail, pz - vz * drag * tail, (o.width ?? 0.07) * (1 - k * 0.6), c[0] * gain, c[1] * gain, c[2] * gain, 1);
  }
}

/** Deterministic per-note seed. */
export const seedOf = (...xs: number[]) => Math.floor(hash(...xs) * 2 ** 31);
