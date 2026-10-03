// Orchestral instruments the score can play, like the piano in _piano.ts: a violin/viola whose bow
// changes direction on every note and whose four strings ring by register, woodwinds whose keys close
// for the low notes, and a horn whose bell sends rings out on every attack. Units are centimetres; the
// instruments are stylised but proportioned (a violin body is 35.5 cm, a viola's ~41 cm).
import * as THREE from 'three';
import type { Note } from '../engine/score';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { styled } from '../engine/style';
import { clamp, ease, lerp, pulse } from '../engine/util';

const col = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
const glowMat = (hex: string) => styled({ color: col(hex), roughness: 0.4, clearcoat: 0.6, emissive: new THREE.Color().setRGB(...LIN.signal, THREE.LinearSRGBColorSpace), emissiveIntensity: 0 });

// ------------------------------------------------------------------ the violin family
/** Half outline of a violin body (x >= 0), from the bottom (y = 0) to the top (y = 1), in body widths. */
const OUTLINE: [number, number][] = [
  [0, 0], [0.32, 0.015], [0.5, 0.08], [0.58, 0.2], [0.55, 0.32], [0.45, 0.38], // lower bout
  [0.34, 0.44], [0.31, 0.5], [0.34, 0.56], // the C-bout (waist)
  [0.42, 0.6], [0.47, 0.7], [0.44, 0.83], [0.32, 0.94], [0.15, 0.995], [0, 1], // upper bout
];

function bodyShape(len: number) {
  const w = len * 0.58; // lower-bout width ~ 0.58 of the length
  const pts = new THREE.SplineCurve(OUTLINE.map(([x, y]) => new THREE.Vector2(x * w, y * len))).getPoints(60);
  const full = [...pts, ...pts.slice(1, -1).reverse().map((p) => new THREE.Vector2(-p.x, p.y))];
  const s = new THREE.Shape(full);
  // the f-holes: two slender S-shaped slots either side of the bridge
  for (const sx of [-1, 1]) {
    const h = new THREE.Path();
    const cx = sx * w * 0.19, y0 = len * 0.3, y1 = len * 0.56;
    const curve = new THREE.CubicBezierCurve(new THREE.Vector2(cx - sx * 1.2, y0), new THREE.Vector2(cx + sx * 2.2, y0 + 3), new THREE.Vector2(cx - sx * 2.2, y1 - 3), new THREE.Vector2(cx + sx * 1.2, y1));
    const left = curve.getPoints(16).map((p) => new THREE.Vector2(p.x - 0.28, p.y));
    const right = curve.getPoints(16).map((p) => new THREE.Vector2(p.x + 0.28, p.y)).reverse();
    h.setFromPoints([...left, ...right]);
    s.holes.push(h);
  }
  return s;
}

export interface StringBow { open: number[]; }

/**
 * A violin (scale 1) or viola (scale ~1.15): body in the xy plane (top facing +z, scroll towards +y),
 * strings drawn per frame, and a bow that changes direction on every note. `open` are the open
 * strings' MIDI pitches, lowest first.
 */
export class Fiddle {
  group = new THREE.Group();
  len: number;
  bridgeY: number; nutY: number; scrollY: number;
  body: THREE.MeshPhysicalMaterial;
  /** pivots at the contact point (on the string being played); `bowBody` slides along it */
  bow = new THREE.Group();
  bowBody = new THREE.Group();
  constructor(public open: number[], public scale = 1, varnish = '#7a3414') {
    const len = 35.5 * scale;
    this.len = len;
    this.body = glowMat(varnish);
    const geo = new THREE.ExtrudeGeometry(bodyShape(len), { depth: 3.4 * scale, bevelEnabled: true, bevelThickness: 0.9 * scale, bevelSize: 0.7 * scale, bevelSegments: 4, curveSegments: 40 });
    geo.translate(0, 0, -1.7 * scale);
    const body = new THREE.Mesh(geo, this.body);
    this.group.add(body);
    const ebony = styled({ color: col('#121214'), roughness: 0.3, clearcoat: 0.8 });
    // fingerboard over the upper body and up the neck
    this.bridgeY = len * 0.42;
    this.nutY = len + 13 * scale;
    this.scrollY = this.nutY + 9 * scale;
    const fb = new THREE.Mesh(new THREE.BoxGeometry(4.2 * scale, 27 * scale, 0.7 * scale), ebony);
    fb.position.set(0, len + 13 * scale - 13.5 * scale, 3.1 * scale);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(3 * scale, 13 * scale, 2.2 * scale), this.body);
    neck.position.set(0, len + 6.5 * scale, 1.2 * scale);
    const pegbox = new THREE.Mesh(new THREE.BoxGeometry(2.6 * scale, 7 * scale, 2.8 * scale), this.body);
    pegbox.position.set(0, this.nutY + 3.5 * scale, 1.4 * scale);
    // the scroll: a tightening spiral of tube
    const spiral = new THREE.CurvePath<THREE.Vector3>();
    const sp: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 3.2, r = 2.1 * scale * (1 - i / 52); sp.push(new THREE.Vector3(0, this.scrollY + Math.sin(a) * r, 1.4 * scale + Math.cos(a) * r)); }
    spiral.add(new THREE.CatmullRomCurve3(sp));
    const scroll = new THREE.Mesh(new THREE.TubeGeometry(spiral.curves[0] as THREE.Curve<THREE.Vector3>, 60, 0.75 * scale, 10, false), this.body);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.4 * scale, 0.35 * scale, 3 * scale), styled({ color: col('#dcd8d0'), roughness: 0.6 }));
    bridge.position.set(0, this.bridgeY, 3.2 * scale);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.6 * scale, 11 * scale, 0.7 * scale), ebony);
    tail.position.set(0, len * 0.16, 2.8 * scale);
    this.group.add(fb, neck, pegbox, scroll, bridge, tail);
    // the bow: stick, hair, frog; its local x runs along the bow (frog at x = 0)
    const L = 74 * scale;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * scale, 0.32 * scale, L, 8), styled({ color: col('#4a4642'), roughness: 0.4 }));
    // the stick rides above the hair (away from the instrument); the hair is a flat ribbon on the strings
    stick.rotation.z = Math.PI / 2; stick.position.set(L / 2, 0, 1.6 * scale);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(L, 1.0 * scale, 0.12 * scale), styled({ color: col('#efe8d8'), roughness: 0.9 }));
    hair.position.set(L / 2, 0, 0);
    const frog = new THREE.Mesh(new THREE.BoxGeometry(4.5 * scale, 2.4 * scale, 1.6 * scale), ebony);
    frog.position.set(1.5 * scale, 0, 1.0 * scale);
    this.bowBody.add(stick, hair, frog);
    this.bow.add(this.bowBody);
    this.group.add(this.bow);
  }

  /** Which string a pitch is played on: the highest open string at or below it. */
  stringOf(p: number) {
    let s = 0;
    this.open.forEach((o, i) => { if (p >= o) s = i; });
    return s;
  }
  /** x of string i at the bridge (strings fan 1.1 cm apart there, 0.55 at the nut). */
  stringX(i: number, atNut = false) { return (i - (this.open.length - 1) / 2) * (atNut ? 0.55 : 1.1) * this.scale; }
  /** Height of the strings at y: on top of the bridge (4.7), sloping down to just over the fingerboard at the nut. */
  stringZ(y: number) { return lerp(4.7, 3.6, clamp((y - this.bridgeY) / (this.nutY - this.bridgeY))) * this.scale; }

  /**
   * Pose for time t from this instrument's notes: the bow moves along its length, down-bow and up-bow
   * alternating per note (travel proportional to the note's length), tilted to the string being played;
   * returns each string's energy for drawing.
   */
  play(t: number, notes: Note[]) {
    const L = 74 * this.scale;
    let pos = 0.5, dirSign = 1, cur: Note | null = null, idx = 0;
    // bow position: integrate stroke by stroke (deterministic: a pure function of the note list and t)
    for (const n of notes) {
      if (n.t > t) break;
      const travel = clamp(n.d * 1.4, 0.12, 0.85) * (n.v / 127 + 0.4);
      const u = clamp((t - n.t) / Math.max(0.05, n.d));
      const start = pos;
      const end = clamp(start + dirSign * travel, 0.05, 0.95);
      if (t < n.t + n.d) { pos = start + (end - start) * ease.outQuad(u); cur = n; }
      else pos = end;
      dirSign = -dirSign; idx++;
    }
    const playing = cur && t < cur.t + cur.d ? cur : null;
    const si = playing ? this.stringOf(playing.p) : 1.5;
    // the bow crosses the strings a hand-width above the bridge (over the waist, the narrowest part of the
    // body), perpendicular to them, resting on the string being played and tilted about that contact point
    // (tilting about the frog would sink the far end of the bow into the body)
    const contactY = this.bridgeY + 4.5 * this.scale;
    const tilt = (si - (this.open.length - 1) / 2) * 0.13;
    this.bow.position.set(lerp(this.stringX(0), this.stringX(this.open.length - 1), si / (this.open.length - 1)), contactY, this.stringZ(contactY) + 0.1 * this.scale);
    this.bow.rotation.set(0, tilt, 0);
    this.bowBody.position.x = -pos * L;
    // no red on the bowed strings: the ringing is shown by the strings' motion alone
    this.body.emissiveIntensity = 0;
    const energy = this.open.map(() => 0);
    for (const n of notes) {
      if (n.t > t || t > n.t + n.d + 0.25) continue;
      const s = this.stringOf(n.p);
      const k = t < n.t + n.d ? 0.5 + 0.5 * n.v / 127 : 1 - (t - n.t - n.d) / 0.25;
      energy[s] = Math.max(energy[s]!, k);
    }
    void idx;
    return energy;
  }

  /** The four strings, from the tailpiece over the bridge to the nut; ringing strings shiver and burn. */
  drawStrings(lb: LineBatch, m: THREE.Matrix4, t: number, energy: number[]) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    energy.forEach((e, i) => {
      const N = 24;
      for (let k = 0; k < N; k++) {
        const u0 = k / N, u1 = (k + 1) / N;
        const y0 = this.bridgeY + (this.nutY - this.bridgeY) * u0, y1 = this.bridgeY + (this.nutY - this.bridgeY) * u1;
        const x0 = this.stringX(i) + (this.stringX(i, true) - this.stringX(i)) * u0, x1 = this.stringX(i) + (this.stringX(i, true) - this.stringX(i)) * u1;
        const amp = e * 0.18 * this.scale;
        const d0 = amp * Math.sin(Math.PI * u0) * Math.sin(t * 160 + i), d1 = amp * Math.sin(Math.PI * u1) * Math.sin(t * 160 + i);
        a.set(x0 + d0, y0, this.stringZ(y0)).applyMatrix4(m);
        b.set(x1 + d1, y1, this.stringZ(y1)).applyMatrix4(m);
        const c = LIN.steel, g = 0.7 + 0.8 * e;
        lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.07 * this.scale, c[0] * g, c[1] * g, c[2] * g, 1);
      }
      // below the bridge to the tailpiece
      a.set(this.stringX(i) * 0.8, this.len * 0.2, 3.2 * this.scale).applyMatrix4(m);
      b.set(this.stringX(i), this.bridgeY, this.stringZ(this.bridgeY)).applyMatrix4(m);
      lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.07 * this.scale, LIN.steel[0] * 0.7, LIN.steel[1] * 0.7, LIN.steel[2] * 0.7, 1);
    });
  }
}

// ------------------------------------------------------------------ woodwinds
/**
 * A woodwind as a straight bore with tone holes and key cups along it (a flute lies along +x, a
 * clarinet/oboe/bassoon stands along +y): the lower the note, the more keys close from the top.
 * `range` is [lowest, highest] MIDI pitch.
 */
export class Woodwind {
  group = new THREE.Group();
  keys: THREE.Mesh[] = [];
  mat: THREE.MeshPhysicalMaterial;
  constructor(public length: number, public radius: number, bodyHex: string, keyHex: string, public range: [number, number], nkeys = 9, flare = 1.6) {
    this.mat = glowMat(bodyHex);
    const prof: THREE.Vector2[] = [];
    // the bell at the bottom (y = 0): the instruments stand on it
    for (let i = 0; i <= 30; i++) { const y = (i / 30) * length; const r = radius * (1 + (flare - 1) * Math.pow(1 - i / 30, 6)); prof.push(new THREE.Vector2(r, y)); }
    const bore = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), this.mat);
    this.group.add(bore);
    const km = styled({ color: col(keyHex), roughness: 0.25, metalness: 0.9, emissive: new THREE.Color().setRGB(...LIN.signal, THREE.LinearSRGBColorSpace), emissiveIntensity: 0 });
    for (let i = 0; i < nkeys; i++) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.35, 16), km.clone());
      k.rotation.x = Math.PI / 2;
      k.position.set(0, length * (0.22 + 0.6 * (i / Math.max(1, nkeys - 1))), radius * 1.05);
      this.group.add(k);
      this.keys.push(k);
    }
  }
  /** Close keys for the sounding note (from the top down), glow on the attack. Returns the attack pulse. */
  play(t: number, notes: Note[]) {
    let cur: Note | null = null, hit = 0;
    for (const n of notes) { if (n.t <= t && t < n.t + n.d) cur = n; hit = Math.max(hit, pulse(t, n.t, 0.1) * n.v / 127); }
    const closed = cur ? Math.round((1 - clamp((cur.p - this.range[0]) / (this.range[1] - this.range[0]))) * this.keys.length) : 0;
    this.keys.forEach((k, i) => {
      const down = i >= this.keys.length - closed ? 1 : 0;
      k.position.z = this.radius * (1.05 - 0.25 * down);
      (k.material as THREE.MeshPhysicalMaterial).emissiveIntensity = down * (0.4 + 2.5 * hit);
    });
    this.mat.emissiveIntensity = 0.9 * hit; // the attack only: a steady glow would tint the glaze
    return hit;
  }
}

// ------------------------------------------------------------------ the natural horn
/** A natural horn: a coiled tube (three turns) ending in a flared bell facing -z. */
export class Horn {
  group = new THREE.Group();
  mat: THREE.MeshPhysicalMaterial;
  bellR = 15;
  constructor(hex = '#b8892f') {
    this.mat = glowMat(hex);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2 * 3, r = 17 + 1.2 * Math.sin(a * 0.5);
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (i / 160) * 6 - 3));
    }
    const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.75, 10, false), this.mat);
    // the bell: a flare from the end of the coil
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30; prof.push(new THREE.Vector2(0.8 + this.bellR * Math.pow(u, 3.2), u * 22)); }
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), this.mat);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(17, 0, 3);
    this.group.add(coil, bell);
  }
  play(t: number, notes: Note[]) {
    let hit = 0, on = false;
    for (const n of notes) { if (n.t <= t && t < n.t + n.d) on = true; hit = Math.max(hit, pulse(t, n.t, 0.12) * n.v / 127); }
    this.mat.emissiveIntensity = 2.2 * hit;
    void on;
    return hit;
  }
  /** Sound rings out of the bell after each attack (in the horn's frame, matrix m). */
  drawRings(lb: LineBatch, m: THREE.Matrix4, t: number, notes: Note[]) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const n of notes) {
      const age = t - n.t;
      if (age < 0 || age > 1.2) continue;
      const r = this.bellR * (1 + age * 4), z = 25 + age * 60, g = 3 * (1 - age / 1.2) * (n.v / 127);
      for (let k = 0; k < 48; k++) {
        const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
        a.set(17 + Math.cos(a0) * r, Math.sin(a0) * r, 3 + z).applyMatrix4(m);
        b.set(17 + Math.cos(a1) * r, Math.sin(a1) * r, 3 + z).applyMatrix4(m);
        lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.35, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 1);
      }
    }
  }
}
