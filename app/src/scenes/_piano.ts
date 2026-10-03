// The piano, as an instrument the score can play: an 88-key keyboard whose keys go down exactly when
// their notes sound, and a grand-piano action (felt hammers, triple steel strings, dampers) for macro
// shots. Units are centimetres. Shared by the `hammer` and `keys` plates.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Note } from '../engine/score';
import { LIN, HEX } from '../engine/palette';
import { clamp, ease, mulberry32, pulse } from '../engine/util';
import { styled } from '../engine/style';

export const LOW = 21, HIGH = 108; // A0 .. C8
const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (p: number) => BLACK.has(((p % 12) + 12) % 12);
/** Where a black key sits between its white neighbours, in white-key widths (the real keyboard's offsets). */
const BLACK_OFF: Record<number, number> = { 1: -0.13, 3: 0.13, 6: -0.16, 8: 0, 10: 0.16 };

export const KEY = { whiteW: 2.35, whiteL: 15, whiteH: 2.2, blackW: 1.3, blackL: 9.5, blackH: 1.15, gap: 0.08, dip: 1.0 };

/** x (cm) of a key's centre: white keys tile from A0 at 0; black keys sit on the seam, nudged. */
export function keyX(p: number) {
  let whites = 0;
  for (let q = LOW; q < p; q++) if (!isBlack(q)) whites++;
  if (!isBlack(p)) return whites * KEY.whiteW + KEY.whiteW / 2;
  return whites * KEY.whiteW + BLACK_OFF[((p % 12) + 12) % 12]! * KEY.whiteW;
}
export const KEYBOARD_W = keyX(HIGH) + KEY.whiteW / 2;

/** Image-based reflections for lacquer and ivory: a neutral room, prefiltered once per renderer. */
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
export function roomEnv(renderer: THREE.WebGLRenderer) {
  let t = envCache.get(renderer);
  if (!t) {
    const pm = new THREE.PMREMGenerator(renderer);
    t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    envCache.set(renderer, t);
  }
  return t;
}

const lin = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

export function ivory() {
  return styled({
    color: lin('#E9E1CF'), roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: lin('#fff6e6'),
    emissive: new THREE.Color().setRGB(...LIN.signal, THREE.LinearSRGBColorSpace), emissiveIntensity: 0,
  });
}
export function ebony() {
  return styled({
    color: lin('#0b0b0d'), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06,
    emissive: new THREE.Color().setRGB(...LIN.signal, THREE.LinearSRGBColorSpace), emissiveIntensity: 0,
  });
}

// ------------------------------------------------------------------ the keyboard
export interface Key { p: number; black: boolean; pivot: THREE.Group; mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; x: number }

/**
 * 88 keys along +x (A0 at x≈0), the player's edge at z = 0, keys running back to -z, tops at y = 0
 * (black keys stand KEY.blackH above). Each key hangs from a pivot at its back end, so pressing it
 * dips the front edge by KEY.dip. Behind the keys: the fallboard; in front: the key slip.
 */
export class Keyboard {
  group = new THREE.Group();
  keys: Key[] = [];
  byPitch = new Map<number, Key>();
  constructor() {
    const wg = new RoundedBoxGeometry(KEY.whiteW - KEY.gap, KEY.whiteH, KEY.whiteL, 3, 0.18);
    const bg = new RoundedBoxGeometry(KEY.blackW, KEY.blackH + KEY.whiteH * 0.6, KEY.blackL, 3, 0.16);
    for (let p = LOW; p <= HIGH; p++) {
      const black = isBlack(p);
      const mat = black ? ebony() : ivory();
      const L = black ? KEY.blackL : KEY.whiteL;
      const mesh = new THREE.Mesh(black ? bg : wg, mat);
      const pivot = new THREE.Group();
      const x = keyX(p);
      pivot.position.set(x, 0, -KEY.whiteL);
      // the key body, from the pivot forwards
      // white keys run the full length; black keys start at the back and stop short of the front
      mesh.position.set(0, black ? KEY.blackH - (KEY.blackH + KEY.whiteH * 0.6) / 2 : -KEY.whiteH / 2, L / 2);
      pivot.add(mesh);
      this.group.add(pivot);
      const k = { p, black, pivot, mesh, mat, x };
      this.keys.push(k);
      this.byPitch.set(p, k);
    }
    // fallboard (behind) and key slip (in front), black lacquer
    const lac = ebony();
    const fall = new THREE.Mesh(new RoundedBoxGeometry(KEYBOARD_W + 6, 9, 3, 3, 0.4), lac);
    fall.position.set(KEYBOARD_W / 2, 3.2, -KEY.whiteL - 1.8);
    const slip = new THREE.Mesh(new RoundedBoxGeometry(KEYBOARD_W + 6, 3.2, 2.2, 3, 0.4), lac);
    slip.position.set(KEYBOARD_W / 2, -2.6, 1.4);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(KEYBOARD_W + 6, 1, KEY.whiteL + 4), lac);
    bed.position.set(KEYBOARD_W / 2, -KEY.whiteH - 0.8, -KEY.whiteL / 2);
    this.group.add(fall, slip, bed);
  }

  /**
   * Pose the keys for time t from the notes: a key is down while one of its notes sounds (fast
   * attack, a little overshoot, quick release), and burns red on the strike. Returns the summed
   * strike intensity (for camera shake).
   */
  play(t: number, notes: Note[], o: { glow?: number; hold?: number } = {}) {
    const state = new Map<number, { down: number; hit: number }>();
    for (const n of notes) {
      if (n.p < LOW || n.p > HIGH) continue;
      const rel = n.t + n.d;
      const a = clamp((t - (n.t - 0.025)) / 0.025);
      const r = 1 - clamp((t - rel) / 0.07);
      const down = Math.min(a, r) * (t < n.t - 0.025 ? 0 : 1);
      const hit = pulse(t, n.t, 0.09) * (n.v / 127);
      const s = state.get(n.p) ?? { down: 0, hit: 0 };
      s.down = Math.max(s.down, down * (0.75 + 0.25 * n.v / 127));
      s.hit = Math.max(s.hit, hit);
      state.set(n.p, s);
    }
    let total = 0;
    for (const k of this.keys) {
      const s = state.get(k.p);
      const down = s?.down ?? 0, hit = s?.hit ?? 0;
      k.pivot.rotation.x = (KEY.dip / KEY.whiteL) * (down + 0.15 * hit);
      k.mat.emissiveIntensity = (o.glow ?? 1) * (3.5 * hit + (o.hold ?? 0.35) * down);
      total += hit;
    }
    return total;
  }
}

// ------------------------------------------------------------------ the action (hammers, strings, dampers)
/** The hammer's cross-section (y up, z along the shank): a felt teardrop on a wooden molding. */
function hammerShape(scale = 1) {
  const s = new THREE.Shape();
  const r = 1.0 * scale;
  s.moveTo(-0.9 * scale, -1.6 * scale);
  s.bezierCurveTo(-1.4 * scale, -0.2 * scale, -r, 1.2 * scale, 0, 1.7 * scale);
  s.bezierCurveTo(r, 1.2 * scale, 1.4 * scale, -0.2 * scale, 0.9 * scale, -1.6 * scale);
  s.lineTo(-0.9 * scale, -1.6 * scale);
  return s;
}

/** Map a cap's UVs to its shape's bounding box (so a cross-section texture lands on the sides). */
function capUV(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!, pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  uv.needsUpdate = true;
}

/** The side of a hammer: cream top felt, a red underfelt band, the wooden molding with its pin. */
function hammerSideTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  const path = (k: number, dy: number) => {
    g.beginPath();
    const X = (x: number) => 128 + x * 52 * k, Y = (y: number) => 256 - (y + 1.6) * 75 + dy;
    g.moveTo(X(-0.9), Y(-1.6));
    g.bezierCurveTo(X(-1.4), Y(-0.2), X(-1), Y(1.2), X(0), Y(1.7));
    g.bezierCurveTo(X(1), Y(1.2), X(1.4), Y(-0.2), X(0.9), Y(-1.6));
    g.closePath();
  };
  g.fillStyle = '#ece4d2'; g.fillRect(0, 0, 256, 256);
  path(0.86, 14); g.fillStyle = HEX.blood; g.fill();
  path(0.78, 26); g.fillStyle = '#d9cfba'; g.fill();
  path(0.62, 52); g.fillStyle = '#5a3b22'; g.fill();
  g.fillStyle = '#c9b48a'; g.beginPath(); g.arc(128, 214, 6, 0, Math.PI * 2); g.fill();
  // felt fibres
  const R = mulberry32(7);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.05})`; g.fillRect(R() * 256, R() * 256, 1, 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Unison { p: number; x: number; hammer: THREE.Group; damper: THREE.Group; strings: number }

/**
 * A stretch of a grand's action seen from inside the case: for each pitch in [lo, hi] a hammer on its
 * shank below triple strings (running along -z from the strike point at z = 0), and a damper resting
 * on the strings behind. The strings themselves are drawn per frame (they vibrate): see stringLines.
 */
export class Action {
  group = new THREE.Group();
  unisons: Unison[] = [];
  felt: THREE.MeshPhysicalMaterial;
  constructor(public lo: number, public hi: number, public pitchW = 1.35) {
    const shape = hammerShape();
    const head = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3, curveSegments: 18 });
    head.translate(0, 0, -0.4);
    capUV(head);
    head.rotateY(Math.PI / 2); // extrusion runs across the keyboard (x)
    const side = hammerSideTexture();
    this.felt = styled({ color: lin('#d8d2c4'), map: side, roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: lin('#fff3dc'),
      emissive: new THREE.Color().setRGB(...LIN.signal, THREE.LinearSRGBColorSpace), emissiveIntensity: 0 });
    const wood = styled({ color: lin('#6b4a2c'), roughness: 0.55, clearcoat: 0.4 });
    const shank = new THREE.CylinderGeometry(0.16, 0.18, 13, 10); shank.rotateX(Math.PI / 2); shank.translate(0, -1.9, 6.5);
    // a damper: a pale maple block (the head) on a strip of black felt that rests on the strings
    const damperGeo = new RoundedBoxGeometry(1.1, 1.3, 2.6, 2, 0.2);
    const damperMat = styled({ color: lin('#D8BC8C'), roughness: 0.5, clearcoat: 0.3 });
    const damperFelt = new RoundedBoxGeometry(1.1, 0.45, 2.4, 2, 0.12);
    const damperFeltMat = styled({ color: lin('#1a1a1c'), roughness: 0.95 });
    for (let p = lo; p <= hi; p++) {
      const x = (p - lo) * pitchW;
      const hammer = new THREE.Group();
      const m = this.felt.clone();
      const h = new THREE.Mesh(head, m);
      hammer.add(h, new THREE.Mesh(shank, wood));
      // the shank pivots 13 cm towards the player (+z); at rest the crown sits 2.6 cm under the strings
      hammer.position.set(x, -2.6 - 1.7, 0);
      this.group.add(hammer);
      const damper = new THREE.Group();
      const dHead = new THREE.Mesh(damperGeo, damperMat); dHead.position.y = 0.2 + 0.65;
      const dFelt = new THREE.Mesh(damperFelt, damperFeltMat);
      damper.add(dHead, dFelt);
      damper.position.set(x, 0.3, -6);
      this.group.add(damper);
      this.unisons.push({ p, x, hammer, damper, strings: p < 40 ? 2 : 3 });
    }
  }

  /**
   * Pose for time t. The hammer flies up to the string on the note's onset (contact exactly at n.t),
   * rebounds and is caught; the damper lifts while the note sounds. Returns per-pitch string energy.
   */
  play(t: number, notes: Note[]) {
    const energy = new Map<number, { e: number; hit: number; damped: boolean }>();
    for (const u of this.unisons) {
      let lift = 0, flight = 0, hit = 0, e = 0;
      for (const n of notes) {
        if (n.p !== u.p) continue;
        const dt = t - n.t;
        // flight: 40 ms up (accelerating), contact, 120 ms rebound with a little bounce
        if (dt >= -0.04 && dt < 0) flight = Math.max(flight, ease.inQuad(1 + dt / 0.04));
        else if (dt >= 0 && dt < 0.2) flight = Math.max(flight, Math.exp(-dt * 26) * (1 + 0.15 * Math.sin(dt * 60)));
        if (t >= n.t - 0.04 && t < n.t + n.d + 0.05) lift = Math.max(lift, clamp((t - n.t + 0.04) / 0.03) * (1 - clamp((t - n.t - n.d) / 0.05)));
        hit = Math.max(hit, pulse(t, n.t, 0.06) * (n.v / 127));
        if (dt >= 0) e = Math.max(e, (n.v / 127) * Math.exp(-dt * (t < n.t + n.d ? 0.5 : 9)));
      }
      // the shank swings about its far end: the crown rises 2.6 cm to the string
      u.hammer.position.y = -2.6 - 1.7 + 2.6 * flight;
      u.hammer.rotation.x = -0.06 * flight;
      (u.hammer.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>).material.emissiveIntensity = 2.5 * hit;
      u.damper.position.y = 0.3 + 1.2 * lift;
      energy.set(u.p, { e, hit, damped: lift < 0.5 });
    }
    return energy;
  }
}
