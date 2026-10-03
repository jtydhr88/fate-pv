// The finale: Beethoven 5, from the dark bridge of III into the C major of IV, and the chords that will
// not stop. The film closes its circle where it began, INSIDE THE PIANO of the opening plate: the same felt
// hammers, steel strings and spruce soundboard, now the whole grand (88 hammers, the cast-iron frame, the
// case). The bridge is dark: one hammer repeats the timpani's note pianissimo, its strings glowing red;
// the violins' climb brings more hammers in; through the crescendo the dampers lift one by one, bass to
// treble, and the light rises. On the C-major downbeat the camera rises out of the piano and everything
// turns GOLD (the first gold of the film): the iron frame, the soundboard, the strings; the score of the
// finale's theme is engraved note by note, red turning to gold. The end chords: a strike, a key slam, the
// score, the whole instrument, cutting on each chord; the last held, then black: `converged.`
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, FSPass, W as SW, H as SH } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { ENGRAVE } from '../engine/music';
import { staffStep, type Note } from '../engine/score';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void, Note3D, glyphMesh, noteMaterial, drawStaff, mixRGB, seedOf, type Pluck, type RGB } from './_kit';
import { Action, Keyboard, keyX, KEYBOARD_W, roomEnv } from './_piano';
import { styled } from '../engine/style';
import { buildDress, Beams, cartoucheTexture, FLOOR_Y, type Dress } from './b5-hall';

const LO = 21, HI = 108; // all 88
const PW = 1.35; // cm between unisons in the action
const WID = (HI - LO) * PW; // the action's width (bass at x = 0, treble at x = WID)
const xOf = (p: number) => (p - LO) * PW;
/** speaking length of a pitch's strings (cm, from the strike point back to the bridge): long bass, short treble */
const lenOf = (p: number) => lerp(168, 46, Math.pow(clamp((p - LO) / (HI - LO)), 0.85));
const lenAtX = (x: number) => lenOf(LO + x / PW);
const AGRAFFE = 7; // cm in front of the strike point, where the speaking length starts
const SOUNDBOARD_Y = -7.5;
const KB = { x: -keyX(LO) + 0.0, y: -9, z: 44 }; // the keyboard, in front of the action (player side)
const SCORE = new THREE.Vector3(-1400, 260, 0); // the engraved score's set, far off to the side

const FOG = new THREE.Fog(new THREE.Color().setRGB(0.05, 0.035, 0.015, THREE.LinearSRGBColorSpace), 420, 1500);
const GILT_COL = new THREE.Color().setStyle('#c9a24e', THREE.SRGBColorSpace);
const lin = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
const GOLD = LIN.gold;
const WHITE_GOLD: RGB = [1.0, 0.86, 0.55];

/** Spruce: pale wood, fine straight grain (a little darker every few years). As in the opening plate. */
function spruceTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#C9A46E'; g.fillRect(0, 0, 512, 1024);
  const R = mulberry32(5);
  for (let x = 0; x < 512; x += 2 + R() * 5) {
    g.fillStyle = `rgba(110,72,36,${0.08 + R() * 0.18})`;
    g.fillRect(x, 0, 1 + R() * 2, 1024);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3);
  return t;
}

/** The grand's outline in plan (x across, z back from the front), offset outwards by `o` cm: a straight bass
 *  side, the tail, and the curved bentside following the string ends. Returns [x, z] points, counter-clockwise. */
function outline(o: number): [number, number][] {
  const pts: [number, number][] = [];
  const front = 20 + o;
  pts.push([-10 - o, front]);
  pts.push([WID + 12 + o, front]);
  // the bentside: along the treble string ends to the tail
  for (let i = 0; i <= 24; i++) {
    const x = WID + 12 - (i / 24) * (WID + 4);
    const z = -lenAtX(clamp(x - 8, 0, WID)) - 22;
    const bulge = Math.sin((i / 24) * Math.PI) * 10;
    pts.push([x + o + bulge * 0.3, z - o - bulge]);
  }
  // the tail round to the bass side
  const zt = -lenAtX(0) - 22;
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 0.5;
    pts.push([-10 - o + 12 - 12 * Math.sin(a), zt - o + 0 * a]);
  }
  pts.push([-10 - o, zt - o + 6]);
  return pts;
}

/** A shape in the (x, -z) plane, to be extruded upwards (see horiz()). */
function shapeOf(pts: [number, number][]) {
  return new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
}
/** Lay an extruded (x, -z) shape flat: extrusion along +y, starting at y0. */
function horiz(geo: THREE.BufferGeometry, y0: number) {
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  return geo;
}

/** Gold sparks: the opening plate's ember sparks, re-coloured (white-hot to gold). */
function goldSparks(lb: LineBatch, t: number, t0: number, x: number, y: number, z: number, seed: number, o: { count?: number; speed?: number; life?: number; gravity?: number; width?: number; gain?: number; col?: RGB; hot?: RGB } = {}) {
  const age = t - t0;
  const life = o.life ?? 0.9;
  if (age < 0 || age > life * 1.6) return;
  const R = mulberry32(seed);
  const n = o.count ?? 60, sp = o.speed ?? 14, g = o.gravity ?? 22;
  for (let i = 0; i < n; i++) {
    const th = R() * Math.PI * 2, el = 0.15 + R() * 1.1, s = sp * (0.35 + R() * R() * 1.3), l = life * (0.4 + R() * 0.8);
    if (age > l) { R(); continue; }
    const vx = Math.cos(th) * Math.cos(el) * s, vz = Math.sin(th) * Math.cos(el) * s, vy = Math.sin(el) * s;
    const drag = Math.exp(-age * 2.5);
    const px = x + (vx * (1 - drag)) / 2.5, pz = z + (vz * (1 - drag)) / 2.5;
    const py = y + (vy * (1 - drag)) / 2.5 - 0.5 * g * age * age;
    const k = age / l, heat = (1 - k) * (1 - k);
    const c = mixRGB(o.col ?? GOLD, o.hot ?? WHITE_GOLD, heat);
    const gain = (o.gain ?? 6) * heat * (0.5 + R());
    const tail = 0.02 + 0.03 * drag;
    lb.seg(px, py, pz, px - vx * drag * tail, py - (vy * drag - g * age) * tail, pz - vz * drag * tail, (o.width ?? 0.07) * (1 - k * 0.6), c[0] * gain, c[1] * gain, c[2] * gain, 1);
  }
}

/** The background: a smooth radial light (no noise: once posterized, noise in a gradient becomes a ragged
 *  saw-tooth edge). `c0` outside, `c1` at the centre, `k` how much of it. */
class Halo {
  pass = new FSPass(/* glsl */ `
    uniform vec3 c0, c1; uniform float k;
    void main() {
      vec2 p = vUv - vec2(0.5, 0.52);
      p.x *= ${(16 / 9).toFixed(4)};
      float r = length(p);
      fragColor = vec4(mix(c0, c1, k * exp(-r * r * 2.2)), 1.0);
    }`, { c0: { value: new THREE.Vector3() }, c1: { value: new THREE.Vector3() }, k: { value: 0 } });
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, c0: RGB, c1: RGB, k: number) {
    this.pass.u.c0!.value.set(...c0); this.pass.u.c1!.value.set(...c1); this.pass.u.k!.value = k;
    this.pass.render(renderer, out);
  }
}

interface ScoreNote { t: number; obj: THREE.Object3D; mat: THREE.MeshStandardMaterial; x: number; y: number; ledgers: number[] }
type Shot = { t0: number; t1: number; cam: (t: number, u: number) => { eye: THREE.Vector3; at: THREE.Vector3; roll?: number; fov?: number } };

export default class B5Light extends Scene {
  st = new Stage3D();
  bg = new Void();
  halo = new Halo();
  action = new Action(LO, HI, PW);
  kb = new Keyboard();
  strings = new LineBatch(60000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  fx = new LineBatch(40000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  staffLines = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  text = new Layer2D();
  notes: Note[] = []; // what the piano plays: every string part of the three segments
  kbNotes: Note[] = [];
  timp: Note[] = [];
  tDown = 0; // the C-major downbeat
  tCresc = 0; // the crescendo
  tEnd = 0; // b5-end
  chords: number[] = [];
  tLast = 0; tStop = 0;
  scoreNotes: ScoreNote[] = [];
  plucks: Pluck[] = [];
  scoreEnd = 0;
  staffM = new THREE.Matrix4();
  plateMat!: THREE.MeshPhysicalMaterial;
  shots: Shot[] = [];
  dress!: Dress;
  beams = new Beams();
  bridgeBeam = 0;
  goldBeams: number[] = [];

  override async init() {
    const sc = this.ctx.score;
    const seg = (id: string) => sc.segments.find((s) => s.id === id)!;
    this.tDown = seg('b5-finale').start;
    this.tEnd = seg('b5-end').start;
    this.tCresc = sc.sections.find((s) => s.segment === 'b5-bridge' && s.name === 'crescendo')!.start;
    const parts = (segId: string, ids: string[]) => ids.map((id) => `${segId}:${id}`);
    const pick = (segId: string, ids: string[]) => sc.notesIn(seg(segId).start - 0.5, seg(segId).end + 0.5, { parts: parts(segId, ids) });
    this.timp = pick('b5-bridge', ['timp']);
    const all = [...this.timp, ...pick('b5-bridge', ['vl', 'vc']), ...pick('b5-finale', ['vl', 'vc']), ...pick('b5-end', ['vl', 'vc'])];
    this.notes = all.filter((n) => n.p >= LO && n.p <= HI).sort((a, b) => a.t - b.t);
    this.kbNotes = this.notes.filter((n) => n.t >= this.tDown - 0.05);
    const endOn = [...new Set(pick('b5-end', ['vl']).map((n) => +n.t.toFixed(4)))].sort((a, b) => a - b);
    this.chords = endOn;
    this.tLast = endOn[endOn.length - 1]!;
    this.tStop = seg('b5-end').end;

    const S = this.st.scene;
    S.add(this.action.group);
    S.environment = roomEnv(this.ctx.renderer);
    S.environmentIntensity = 0.16;
    this.buildPiano(S);
    this.kb.group.position.set(KB.x, KB.y, KB.z);
    S.add(this.kb.group);
    this.buildScore(S, sc);
    this.dress = buildDress(S, outline, WID, KB.x + KEYBOARD_W / 2, KB.z);
    // light: one narrow beam over the timpani's hammer in the dark; in the gold, shafts from high windows
    const g2 = xOf(43);
    this.bridgeBeam = this.beams.add(new THREE.Vector3(g2 - 30, 220, -60), new THREE.Vector3(g2, -6, -8), 2, 16, [0.9, 0.55, 0.35]);
    const c = this.dress.centre;
    for (const [dx, dz, r] of [[-520, -420, 70], [-380, -520, 55], [420, -480, 60], [560, -300, 50], [-560, -160, 45]] as const)
      this.goldBeams.push(this.beams.add(new THREE.Vector3(c.x + dx, FLOOR_Y + 760, c.z + dz), new THREE.Vector3(c.x + dx * 0.08, FLOOR_Y + 40, c.z + dz * 0.1), 18, r, [1.0, 0.78, 0.42]));
    this.buildShots();
  }

  /** The instrument around the action: soundboard, cast-iron frame (gold paint, as real grands have), bridge,
   *  hitch and tuning pins, the pin block, the lacquered case. */
  buildPiano(S: THREE.Scene) {
    // soundboard: spruce, inside the case
    const inner = outline(-1);
    const sbGeo = horiz(new THREE.ShapeGeometry(shapeOf(inner)), SOUNDBOARD_Y);
    const uv = sbGeo.getAttribute('uv'), pos = sbGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 60, pos.getZ(i) / 90);
    const sb = new THREE.Mesh(sbGeo, styled({ color: new THREE.Color(0xffffff), map: spruceTexture(), roughness: 0.6 }));
    S.add(sb);
    // the frame: a cast-iron plate over the soundboard, painted gold-bronze, with openings where the strings
    // cross the soundboard and a long slot along the strike line for the hammers
    const plateShape = shapeOf(outline(-3));
    const hole = (x0: number, x1: number, zNear: number, farPad: number) => {
      const pts: [number, number][] = [];
      const n = 8;
      pts.push([x0, zNear], [x1, zNear]);
      for (let i = 0; i <= n; i++) { const x = x1 - ((x1 - x0) * i) / n; pts.push([x, -lenAtX(clamp(x, 0, WID)) + farPad]); }
      return new THREE.Path(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    };
    plateShape.holes.push(new THREE.Path([[-5, AGRAFFE - 1.5], [WID + 6, AGRAFFE - 1.5], [WID + 6, -10], [-5, -10]].map(([x, z]) => new THREE.Vector2(x!, -z!))));
    for (const [x0, x1] of [[-3, 24], [30, 56], [62, 88], [94, WID + 4]] as const) plateShape.holes.push(hole(x0, x1, -15, 14));
    this.plateMat = styled({ color: lin('#8c6a34'), roughness: 0.42, metalness: 0.55, clearcoat: 0.3 });
    const plate = new THREE.Mesh(horiz(new THREE.ExtrudeGeometry(plateShape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 2, curveSegments: 6 }), -2.7), this.plateMat);
    S.add(plate);
    // the bridge: a curved maple rail on the soundboard under the far ends of the strings
    const bridgePts: THREE.Vector3[] = [];
    for (let p = LO; p <= HI; p += 3) bridgePts.push(new THREE.Vector3(xOf(p), -0.9, -lenOf(p)));
    const bridge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bridgePts), 120, 0.75, 8), styled({ color: lin('#7a5532'), roughness: 0.5, clearcoat: 0.4 }));
    bridge.scale.set(1, 1, 1);
    S.add(bridge);
    // hitch pins (far end) and tuning pins (front, in the pin block), as instances
    const pinGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.4, 8);
    const steel = styled({ color: lin('#b7b2a8'), roughness: 0.3, metalness: 0.9 });
    const n = (HI - LO + 1) * 3;
    const hitch = new THREE.InstancedMesh(pinGeo, steel, n), tune = new THREE.InstancedMesh(pinGeo, steel, n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let p = LO; p <= HI; p++) {
      for (let s = 0; s < 3; s++) {
        const x = xOf(p) + (s - 1) * 0.22;
        m.makeTranslation(x, -0.9, -lenOf(p) - 5 - s * 0.6); hitch.setMatrixAt(k, m);
        m.makeTranslation(x + (s - 1) * 0.15, 0.2, AGRAFFE + 3 + (s % 2) * 1.6); tune.setMatrixAt(k, m);
        k++;
      }
    }
    S.add(hitch, tune);
    // pin block flange (dark) and the case: black lacquer walls on the outline
    const lac = styled({ color: lin('#0d0c0c'), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08 });
    const block = new THREE.Mesh(new RoundedBoxGeometry(WID + 14, 1.6, 8, 2, 0.3), styled({ color: lin('#3b2618'), roughness: 0.6 }));
    block.position.set(WID / 2, -1.6, AGRAFFE + 4);
    S.add(block);
    const ring = shapeOf(outline(4));
    ring.holes.push(new THREE.Path(outline(0).map(([x, z]) => new THREE.Vector2(x, -z))));
    const caseMesh = new THREE.Mesh(horiz(new THREE.ExtrudeGeometry(ring, { depth: 18, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2, curveSegments: 6 }), -14), lac);
    S.add(caseMesh);
    const bottom = new THREE.Mesh(horiz(new THREE.ShapeGeometry(shapeOf(outline(4))), -14.2), lac);
    S.add(bottom);
  }

  /** The finale's theme (the violins' top line, from the C-major downbeat) and the end chords, engraved on a
   *  staff in its own set; each note drops onto the staff when it sounds, red, and turns gold. */
  buildScore(S: THREE.Scene, sc: typeof this.ctx.score) {
    this.staffM.makeTranslation(SCORE.x, SCORE.y, SCORE.z);
    const furn = noteMaterial(LIN.bone);
    const clef = glyphMesh('gClef', 0.35, furn); clef.position.set(SCORE.x + 0.6, SCORE.y - 1, SCORE.z); S.add(clef);
    const t4a = glyphMesh('timeSig4', 0.35, furn); t4a.position.set(SCORE.x + 4.2, SCORE.y + 1, SCORE.z); S.add(t4a);
    const t4b = glyphMesh('timeSig4', 0.35, furn); t4b.position.set(SCORE.x + 4.2, SCORE.y - 1, SCORE.z); S.add(t4b);
    const vl = sc.notesIn(this.tDown - 0.01, this.tEnd - 0.01, { parts: ['b5-finale:vl'] });
    const tops = new Map<number, Note>();
    for (const n of vl) { const k = +n.t.toFixed(4); const o = tops.get(k); if (!o || n.p > o.p) tops.set(k, n); }
    const theme = [...tops.values()].sort((a, b) => a.t - b.t).filter((n) => n.t < this.tDown + 8.6);
    const MID = staffStep(71);
    const place = (p: number) => { let q = p; while (q > 86) q -= 12; return (staffStep(q) - MID) / 2; };
    let x = 7.5;
    let lastT = -1;
    for (const n of theme) {
      x += lastT < 0 ? 0 : clamp((n.t - lastT) * 5.2, 1.6, 6);
      lastT = n.t;
      this.addScoreNote(S, n.t, x, place(n.p), n.d > 0.6 ? 'half' : 'black');
    }
    // the end chords as whole-note stacks after a double bar
    x += 6;
    this.scoreEnd = x;
    const endVl = sc.notesIn(this.tEnd - 0.01, this.tStop + 0.01, { parts: ['b5-end:vl'] });
    for (const t of this.chords) {
      const ps = [...new Set(endVl.filter((n) => Math.abs(n.t - t) < 0.01).map((n) => n.p))];
      x += 4.2;
      for (const p of ps) this.addScoreNote(S, t, x, place(p), 'whole');
    }
    this.scoreEnd = x + 4;
    const cw = this.scoreEnd + 14, ch = 17;
    const cart = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), styled({ color: new THREE.Color(0xffffff), map: cartoucheTexture(cw, ch, 'Sinfonie Nr. 5 · Finale. Allegro'), roughness: 0.5 }));
    cart.position.set(SCORE.x + cw / 2 - 6, SCORE.y + 1.6, SCORE.z - 2.5);
    S.add(cart);
  }

  addScoreNote(S: THREE.Scene, t: number, x: number, y: number, kind: 'black' | 'half' | 'whole') {
    const mat = noteMaterial(LIN.bone);
    const n = new Note3D(kind, y < 0, 0.55, mat);
    n.group.position.set(SCORE.x + x, SCORE.y + y, SCORE.z);
    n.group.visible = false;
    S.add(n.group);
    const ledgers: number[] = [];
    for (let l = 3; l <= y + 1e-6; l++) ledgers.push(l);
    for (let l = -3; l >= y - 1e-6; l--) ledgers.push(l);
    this.scoreNotes.push({ t, obj: n.group, mat, x, y, ledgers });
    this.plucks.push({ t, x, amp: 0.18 });
  }

  /** The camera, shot by shot (film seconds). */
  buildShots() {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const s0 = this.ctx.start, cr = this.tCresc, dn = this.tDown, ed = this.tEnd;
    const g2 = xOf(43), c4 = xOf(60);
    const mid = WID / 2;
    const shots: Shot[] = [
      // 1. establishing: the dark grand from above its treble corner; one hammer at work far down the row
      { t0: s0, t1: s0 + 4.6, cam: (_t, u) => ({ eye: V(WID + lerp(58, 46, u), lerp(96, 84, u), lerp(70, 58, u)), at: V(mid - 6, -4, -62), roll: -0.05, fov: 40 }) },
      // 2. the opening plate's macro: the timpani's hammer large in front, the row receding into the treble
      { t0: s0 + 4.6, t1: cr, cam: (_t, u) => ({ eye: V(g2 - lerp(13, 10, u), lerp(4.5, 3.2, u), lerp(11, 8.5, u)), at: V(g2 + 9, -2.2, -4), roll: 0.06, fov: 36 }) },
      // 3. the crescendo: rising along the strike line as the dampers lift, bass to treble
      { t0: cr, t1: dn, cam: (_t, u) => { const k = ease.inOutCubic(u); return { eye: V(lerp(g2 - 6, mid + 10, k), lerp(9, 70, k * k), lerp(15, 62, k)), at: V(lerp(g2 + 10, mid, k), lerp(-1.5, -6, k), lerp(-14, -58, k)), roll: lerp(0.08, -0.02, k), fov: lerp(38, 44, k) }; } },
      // 4. C major: out of the piano, high above it, rising; the whole instrument in gold
      { t0: dn, t1: dn + 4.3, cam: (_t, u) => ({ eye: V(mid + lerp(6, -4, u), lerp(150, 200, ease.outCubic(u)), lerp(70, 92, u)), at: V(mid, -6, -62), roll: lerp(0.04, -0.03, u), fov: 44 }) },
      // 5. the score of the theme, engraved as it sounds: tracking along the staff
      { t0: dn + 4.3, t1: dn + 8.6, cam: (t) => { const sx = this.scoreX(t); return { eye: V(SCORE.x + sx - 8, SCORE.y + 3.5, SCORE.z + 34), at: V(SCORE.x + sx - 2, SCORE.y + 2.2, SCORE.z), roll: -0.04, fov: 34 }; } },
      // 6. the keys, level from the treble end, slamming with the chords
      { t0: dn + 8.6, t1: dn + 14.3, cam: (_t, u) => ({ eye: V(KB.x + KEYBOARD_W + lerp(16, 10, u), KB.y + lerp(6, 4, u), KB.z + lerp(15, 11, u)), at: V(KB.x + KEYBOARD_W * 0.42, KB.y - 1, KB.z - 6), roll: -0.16, fov: 32 }) },
      // 7. wide, orbiting on the treble side: the open grand in the hall, the light shafts
      { t0: dn + 14.3, t1: ed, cam: (_t, u) => { const a = lerp(0.25, 1.05, ease.inOutQuad(u)); return { eye: V(mid + Math.sin(a) * 235, lerp(70, 95, u), -70 + Math.cos(a) * 235), at: V(mid - 15, -22, -78), roll: -0.02, fov: 40 }; } },
    ];
    // 8. the end chords: each chord cuts to the next view (a strike, the keys, the score, the whole piano)
    const views: Shot['cam'][] = [
      (_t, u) => ({ eye: V(c4 - lerp(13, 11, u), lerp(4.8, 3.8, u), lerp(11, 9.5, u)), at: V(c4 + 9, -2.2, -4), roll: 0.05, fov: 36 }),
      (_t, u) => ({ eye: V(KB.x + keyX(60), KB.y + lerp(78, 66, u), KB.z + 36), at: V(KB.x + keyX(60), KB.y, KB.z - 6), roll: lerp(0.06, 0.02, u), fov: 36 }),
      (t) => { const sx = this.scoreX(t); return { eye: V(SCORE.x + sx - 6, SCORE.y + 3, SCORE.z + 34), at: V(SCORE.x + sx - 3, SCORE.y + 2.5, SCORE.z), roll: 0.03, fov: 34 }; },
      (_t, u) => ({ eye: V(mid + lerp(190, 165, u), lerp(85, 100, u), lerp(130, 150, u)), at: V(mid - 10, -22, -78), roll: -0.02, fov: 40 }),
    ];
    this.chords.forEach((c, i) => {
      const next = i + 1 < this.chords.length ? this.chords[i + 1]! : this.tStop;
      if (i === this.chords.length - 1) {
        // the last chord, held: the glorious wide, the whole hall, rising and pulling back into the light
        shots.push({ t0: c - 0.02, t1: this.tStop + 3.5, cam: (_t, u) => { const k = ease.outCubic(u); return { eye: V(mid + lerp(200, 240, k), lerp(60, 230, k), lerp(200, 290, k)), at: V(mid - 10, lerp(0, -30, k), -80), roll: lerp(-0.03, 0, k), fov: lerp(40, 48, k) }; } });
      } else shots.push({ t0: c - 0.02, t1: next - 0.02, cam: views[i % views.length]! });
    });
    this.shots = shots;
  }

  /** Where along the staff the score shot looks at time t: following the latest engraved note. */
  scoreX(t: number) {
    let x = 7.5;
    for (const n of this.scoreNotes) if (n.t <= t + 0.25) x = n.x;
    return x;
  }

  camera(t: number) {
    const sh = this.shots.find((s) => t >= s.t0 && t < s.t1) ?? (t < this.shots[0]!.t0 ? this.shots[0]! : this.shots[this.shots.length - 1]!);
    const u = clamp((t - sh.t0) / Math.max(1e-3, sh.t1 - sh.t0));
    const v = sh.cam(t, u);
    v.eye.x += noise1(t * 0.5, 3) * 0.25; v.eye.y += noise1(t * 0.4, 7) * 0.2;
    this.st.look(v.eye, v.at, v.roll ?? 0, v.fov ?? 36);
    return sh;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const gold = t >= this.tDown - 0.01 ? 1 : 0; // the flip
    const flash = pulse(t, this.tDown, 0.35);
    const chordHit = Math.max(0, ...this.chords.map((c) => pulse(t, c, 0.12)));
    if (t >= this.tStop + 0.05) return this.endCard(t, out);
    this.camera(t);

    // ---- the action
    const energy = this.action.play(t, this.notes);
    let hit = 0;
    for (const v of energy.values()) hit = Math.max(hit, v.hit);
    // through the crescendo the dampers lift one by one, bass to treble (the sustain pedal, in slow motion);
    // from C major on they stay up, and the free strings ring in sympathy
    const lift = new Map<number, number>();
    for (const u of this.action.unisons) {
      const at = this.tCresc + 0.2 + ((u.p - LO) / (HI - LO)) * (this.tDown - this.tCresc - 0.8);
      const l = t >= this.tStop - 0.3 ? 1 - prog(t, this.tStop - 0.3, this.tStop + 0.6) : prog(t, at, at + 0.25, ease.outCubic);
      lift.set(u.p, l);
      u.damper.position.y = Math.max(u.damper.position.y, 0.3 + 1.2 * l);
      const m = (u.hammer.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>).material;
      m.emissive.setRGB(...(gold ? GOLD : LIN.signal), THREE.LinearSRGBColorSpace);
    }
    // the keys burn gold, not red, after the flip
    for (const k of this.kb.keys) k.mat.emissive.setRGB(...(gold ? GOLD : LIN.signal), THREE.LinearSRGBColorSpace);
    const strike = this.kb.play(t, this.kbNotes, { glow: 1.2, hold: 0.5 });

    // ---- light: dark and warm-red in the bridge, rising with the crescendo, gold and bright from the downbeat
    const rise = prog(t, this.tCresc, this.tDown, ease.inCubic);
    const fadeIn = prog(t, this.ctx.start, this.ctx.start + 1.4);
    this.st.key.intensity = gold ? 2.6 + 1.2 * chordHit : (0.6 + 1.5 * rise) * fadeIn;
    this.st.key.color.setRGB(...(gold ? [1.0, 0.9, 0.7] as RGB : [1, 1, 1] as RGB), THREE.LinearSRGBColorSpace);
    this.st.key.position.set(-20, 60, 40);
    this.st.rim.intensity = gold ? 3 + 6 * chordHit : 2 + 8 * hit + 3 * rise;
    this.st.rim.color.setRGB(...(gold ? GOLD : LIN.cobalt), THREE.LinearSRGBColorSpace);
    this.st.fill.intensity = gold ? 0.6 : 0.12 + 0.3 * rise;
    this.plateMat.emissive.setRGB(...GOLD, THREE.LinearSRGBColorSpace);
    this.plateMat.emissiveIntensity = gold ? 0.18 + 0.5 * chordHit + 0.6 * flash : 0;
    if (gold) this.halo.render(renderer, out, [0.012, 0.008, 0.003], mixRGB(GOLD, WHITE_GOLD, flash).map((v) => v * 0.55) as RGB, 0.55 + 0.45 * flash);
    else {
      this.bg.pass.u.glowC!.value.set(...LIN.signal);
      this.bg.render(renderer, out, t, 0.15 * hit + 0.35 * rise, 0);
    }

    // score notes: visible from their time, red on the drop, gold a moment later
    for (const n of this.scoreNotes) {
      const age = t - n.t;
      n.obj.visible = age >= -0.08;
      if (!n.obj.visible) continue;
      const drop = 1 - ease.outCubic(clamp((age + 0.08) / 0.12));
      n.obj.position.y = SCORE.y + n.y + drop * 3;
      const toGold = prog(age, 0.15, 0.6);
      const c = mixRGB(LIN.signal, GOLD, gold ? Math.max(toGold, 0) : 0);
      n.mat.emissive.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
      n.mat.emissiveIntensity = 2.0 * pulse(t, n.t, 0.25) + 0.25;
    }
    this.dress.hall.visible = gold > 0;
    // the room is there in the dark too, but barely: floor and gilt come up with the light
    const dim = gold ? 1 : 0.12 + 0.25 * rise;
    const [floorM, giltM] = this.dress.dimmable;
    floorM!.color.setScalar(dim); giltM!.color.copy(GILT_COL).multiplyScalar(dim);
    this.st.scene.fog = gold ? FOG : null;
    this.st.render(renderer, out);
    // the light shafts (additive, over the solid scene, depth-tested against it)
    this.beams.set(this.bridgeBeam, gold ? 0 : 0.10 * fadeIn * (1 + 1.5 * rise));
    this.goldBeams.forEach((b, i) => this.beams.set(b, gold ? (0.13 + 0.05 * Math.sin(t * 0.7 + i)) * (1 + 1.5 * flash + 0.8 * chordHit) : 0));
    this.beams.render(renderer, out, this.st.cam);

    // ---- the strings: steel, glowing red when struck in the dark, gold in the light
    const L = this.strings; L.clear();
    const steel = LIN.graphite;
    const hot = gold ? GOLD : LIN.signal;
    for (const u of this.action.unisons) {
      const en = energy.get(u.p)!;
      const e = Math.max(en.e * (gold ? 1 : 1.8), 0.05 * (lift.get(u.p) ?? 0) * (gold ? 1 + 0.6 * chordHit : 0.6));
      const len = lenOf(u.p);
      for (let s = 0; s < u.strings; s++) {
        const x = u.x + (s - (u.strings - 1) / 2) * 0.22;
        const N = e > 0.02 ? 40 : 1;
        let prev: [number, number, number] | null = null;
        for (let i = 0; i <= N; i++) {
          const along = i / N;
          const z = AGRAFFE - (len + AGRAFFE) * along;
          const y = e * 0.35 * Math.sin(Math.PI * along) * Math.sin(t * 95 + s + u.p) + e * 0.12 * Math.sin(2 * Math.PI * along) * Math.sin(t * 190 + 1.3 * s);
          const glow = e * (2.0 + 3 * en.hit) * (0.35 + 0.65 * Math.exp(-along * 2.5));
          const dx = e * 0.3 * Math.sin(Math.PI * along) * Math.sin(t * 83 + 2.1 * s);
          const c = mixRGB(steel, hot, clamp(e * 1.6));
          const k = 0.4 + glow;
          if (prev) L.seg(prev[0], prev[1], prev[2], x + dx, y, z, 0.07, c[0] * k, c[1] * k, c[2] * k, 1);
          prev = [x + dx, y, z];
        }
        if (N === 1) L.seg(x, 0, AGRAFFE, x, 0, -len, 0.07, steel[0] * 0.45, steel[1] * 0.45, steel[2] * 0.45, 1);
      }
    }
    L.render(renderer, out, this.st.cam);

    // ---- the score's staff (rings when a note lands)
    const SL = this.staffLines; SL.clear();
    const lc: RGB = gold ? [1.1, 0.85, 0.42] : [0.4, 0.38, 0.36];
    drawStaff(SL, this.staffM, t, -1.5, this.scoreEnd, this.plucks.filter((p) => p.t <= t), { color: lc, width: ENGRAVE.staffLine * 1.3, seg: 500 });
    for (const n of this.scoreNotes) {
      if (t < n.t) continue;
      for (const l of n.ledgers) SL.seg(SCORE.x + n.x - 1.0, SCORE.y + l, SCORE.z, SCORE.x + n.x + 1.0, SCORE.y + l, SCORE.z, ENGRAVE.staffLine * 1.3, lc[0], lc[1], lc[2], 1);
    }
    // the double bar before the end chords
    const db = this.scoreNotes.find((n) => n.t >= this.tEnd - 0.01);
    if (db && t >= this.tEnd - 0.01) for (const dx of [-3.4, -3.0]) SL.seg(SCORE.x + db.x + dx, SCORE.y - 2, SCORE.z, SCORE.x + db.x + dx, SCORE.y + 2, SCORE.z, dx < -3.2 ? 0.12 : 0.3, lc[0], lc[1], lc[2], 1);
    SL.render(renderer, out, this.st.cam);

    // ---- particles: sparks off the struck strings, dust in the dark, gold motes in the light
    const X = this.fx; X.clear();
    for (const n of this.notes) {
      if (Math.abs(t - n.t) > 1.5) continue;
      if (!gold && n.v < 60 && hash(n.t, n.p) > 0.35) continue; // pianissimo: a few embers only
      const big = n.v > 100;
      if (gold) goldSparks(X, t, n.t, xOf(n.p), 0.1, 0, seedOf(n.t, n.p), { count: big ? 22 : 8, speed: 9, life: 0.7, gravity: 26, width: 0.06, gain: 4 });
      else sparksRed(X, t, n.t, xOf(n.p), 0.1, 0, seedOf(n.t, n.p), n.v);
    }
    for (const c of [...this.chords, this.tDown]) {
      if (t < c || t - c > 2.2) continue;
      for (let j = 0; j < 9; j++) goldSparks(X, t, c, xOf(30 + j * 7), 0.3, -2 - j * 3, seedOf(c, j), { count: 60, speed: 34, life: 1.3, gravity: 30, width: 0.11, gain: 7 });
    }
    if (gold) this.streaks(X, t);
    this.motes(X, t, gold, rise, flash);
    if (gold) { this.glitter(X, t, flash, chordHit); this.candleGlow(X, t); }
    X.render(renderer, out, this.st.cam);

    this.drawText(t, gold);
    comp.draw(renderer, this.text.upload(), out);

    const sh = 5 * hit * (gold ? 0.5 : 1) + 9 * chordHit + 6 * flash;
    const fadeOut = prog(t, this.tStop - 0.7, this.tStop);
    return {
      ramp: 'wood', ramp2: 'gold', rampMix: gold, grade: 1, gradeSteps: 4, hatch: 0,
      bloom: gold ? 0.75 : 0.9, bloomThreshold: gold ? 1.15 : 1.05, halation: gold ? 0.15 : 0.25, grain: 0.06, vignette: gold ? 0.35 : 0.6,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], ca: 1.0 + 2 * hit + 3 * chordHit,
      flash: 0.55 * flash + 0.12 * chordHit,
      fade: Math.max(1 - fadeIn, fadeOut),
    };
  }

  /** A struck string carries a bead of light from the hammer down its length to the bridge. */
  streaks(X: LineBatch, t: number) {
    for (const n of this.notes) {
      const age = t - n.t;
      if (age < 0 || age > 0.45) continue;
      const len = lenOf(n.p), u = age / 0.45;
      const z = AGRAFFE - (len + AGRAFFE) * ease.outCubic(u), x = xOf(n.p);
      const k = (1 - u) * 6 * (n.v / 127);
      X.seg(x, 0.2, z + 6, x, 0.2, z, 0.18, WHITE_GOLD[0] * k, WHITE_GOLD[1] * k, WHITE_GOLD[2] * k, 1);
    }
  }

  /** Glitter falling through the hall's light: flakes that twinkle as they turn. */
  glitter(X: LineBatch, t: number, flash: number, hit: number) {
    const ctr = this.dress.centre;
    for (let i = 0; i < 900; i++) {
      const R = mulberry32(i * 104729 + 7);
      const x = ctr.x + (R() - 0.5) * 700, z = ctr.z + (R() - 0.5) * 700;
      const fall = 18 + R() * 30, H = 600, ph = R() * H;
      const y = FLOOR_Y + H - ((t * fall + ph) % H);
      const tw = Math.pow(Math.abs(Math.sin(t * (3 + R() * 6) + R() * 9)), 8);
      const k = tw * (1.2 + 3 * flash + 2 * hit) * (0.4 + R());
      if (k < 0.05) continue;
      const sx = Math.sin(t + i) * 1.2;
      X.seg(x - sx, y, z, x + sx, y - 1.2, z, 0.9, WHITE_GOLD[0] * k, WHITE_GOLD[1] * k, WHITE_GOLD[2] * k, 1);
    }
  }

  /** The chandeliers' candles. */
  candleGlow(X: LineBatch, t: number) {
    this.dress.candles.forEach((c, i) => {
      const k = 2.5 + 0.6 * Math.sin(t * 9 + i * 1.7);
      X.seg(c.x, c.y - 2, c.z, c.x, c.y + 4, c.z, 4.5, WHITE_GOLD[0] * k, WHITE_GOLD[1] * k, WHITE_GOLD[2] * k, 1);
    });
  }

  /** Floating particles: dust drifting through the dark over the strings (lit by their glow), and in the
   *  light, gold motes rising from the soundboard. Deterministic: each mote's path is a function of t. */
  motes(X: LineBatch, t: number, gold: number, rise: number, flash: number) {
    // in the dark, a cloud of dust caught in the single beam over the timpani's hammer
    if (!gold) {
      const g2 = xOf(43);
      for (let i = 0; i < 260; i++) {
        const R = mulberry32(i * 31337 + 5);
        const v = R(), y = -6 + v * 120, x = g2 - 30 * v + (R() - 0.5) * (4 + 14 * (1 - v)) + Math.sin(t * 0.4 + i) * 1.5;
        const z = -8 - 52 * v + (R() - 0.5) * (4 + 14 * (1 - v)) + Math.cos(t * 0.3 + i) * 1.5;
        const yy = y + ((t * (0.5 + R())) % 6) - 3;
        const k = (0.25 + 0.5 * rise) * Math.abs(Math.sin(t * (1 + R() * 2) + i)) * (0.5 + R());
        X.seg(x, yy, z, x + 0.06, yy + 0.08, z, 0.12, LIN.bone[0] * k, LIN.bone[1] * k * 0.85, LIN.bone[2] * k * 0.7, 1);
      }
    }
    const N = 420;
    for (let i = 0; i < N; i++) {
      const R = mulberry32(i * 7919 + 13);
      const x0 = -10 + R() * (WID + 20), z0 = -lenAtX(clamp(R() * WID, 0, WID)) * R() + 4, y0 = SOUNDBOARD_Y + R() * 30;
      const sp = 0.6 + R() * 1.6, ph = R() * 100;
      const life = 7 + R() * 6;
      const age = ((t + ph) % life) / life;
      const y = y0 + (gold ? sp * 5 : sp * 0.8) * age * life * 0.4;
      const x = x0 + Math.sin(t * 0.3 + ph) * 2, z = z0 + Math.cos(t * 0.25 + ph) * 2;
      const a = Math.sin(Math.PI * age);
      const c = gold ? mixRGB(GOLD, WHITE_GOLD, R()) : mixRGB(LIN.ember, LIN.bone, R());
      const k = a * (gold ? 1.4 + 2 * flash : 0.15 + 0.6 * rise) * (0.4 + R());
      if (k < 0.02) continue;
      X.seg(x, y, z, x + 0.05, y + (gold ? 0.6 : 0.15), z, gold ? 0.14 : 0.1, c[0] * k, c[1] * k, c[2] * k, 1);
    }
  }

  drawText(t: number, gold: number) {
    const T = this.text; T.clear();
    const c = T.ctx;
    c.textAlign = 'left';
    const mono = (s: string, x: number, y: number, a: number, col: string, size = 17) => {
      if (a <= 0) return;
      c.globalAlpha = a; c.font = font(F.mono(500), size); c.letterSpacing = '3px'; c.fillStyle = rgba(col, 1);
      c.fillText(s, x, y);
    };
    const bar = this.ctx.score.barAt(t);
    if (!gold) {
      const a = prog(t, this.ctx.start + 0.8, this.ctx.start + 1.6);
      mono('III. ALLEGRO  →  IV.  ATTACCA', 96, SH - 132, a * 0.7, 'ash');
      const timpHit = this.timp.some((n) => t >= n.t);
      mono(`TIMPANI · C · pp · m. ${bar?.n ?? ''}`, 96, SH - 100, a * (timpHit ? 1 : 0.5), 'bone');
      // cresc., growing
      const k = prog(t, this.tCresc, this.tDown);
      if (k > 0) {
        c.globalAlpha = 0.35 + 0.65 * k; c.letterSpacing = '0px';
        c.font = font(F.serif(400, true), 60 + 120 * k); c.fillStyle = rgba('bone', 1);
        c.fillText('cresc.', 96, 150 + 60 * k);
      }
    } else {
      const a = prog(t, this.tDown + 0.3, this.tDown + 0.8) * (1 - prog(t, this.tDown + 8, this.tDown + 8.6));
      mono('IV. ALLEGRO · C MAJOR · ff', 96, SH - 132, a * 0.75, 'bone');
      const s = 'trombones: tacet 3 movements → ff';
      const n = Math.floor(clamp((t - (this.tDown + 0.9)) * 26, 0, s.length));
      mono(s.slice(0, n), 96, SH - 100, a, 'bone');
      if (t >= this.tEnd - 0.01) {
        const k = this.chords.filter((x) => t >= x - 0.01).length;
        const a2 = prog(t, this.tEnd, this.tEnd + 0.3) * (1 - prog(t, this.tStop - 0.6, this.tStop));
        mono(`C · ${'|'.repeat(k)}`, 96, SH - 100, a2, 'bone', 20);
      }
    }
    c.globalAlpha = 1; c.letterSpacing = '0px';
  }

  /** After the last chord: black, and the machine's last word. */
  endCard(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const T = this.text; T.clear('#000000');
    const c = T.ctx;
    const s = 'converged.';
    const t0 = this.tStop + 0.5;
    const n = Math.floor(clamp((t - t0) * 9, 0, s.length));
    const a = 1 - prog(t, this.tStop + 2.6, this.tStop + 3.0);
    c.globalAlpha = a; c.font = font(F.mono(500), 30); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 1); c.textAlign = 'left';
    const w = c.measureText(s).width;
    const x0 = SW / 2 - w / 2;
    c.fillText(s.slice(0, n), x0, SH / 2 + 10);
    if (Math.floor(t * 2.2) % 2 === 0) c.fillRect(x0 + c.measureText(s.slice(0, n)).width + 6, SH / 2 - 14, 14, 26);
    c.globalAlpha = 1; c.letterSpacing = '0px';
    renderer.setRenderTarget(out);
    comp.draw(renderer, T.upload(), out);
    return { grade: 0, hud: 0, bloom: 0.2, halation: 0, grain: 0.05, vignette: 0.3, flash: 0, fade: 0 };
  }
}

/** The bridge's few embers off a struck string (the opening plate's sparks, smaller). */
function sparksRed(lb: LineBatch, t: number, t0: number, x: number, y: number, z: number, seed: number, v: number) {
  goldSparks(lb, t, t0, x, y, z, seed, { count: v > 80 ? 18 : 6, speed: 6, life: 0.55, gravity: 30, width: 0.05, gain: 3.5, col: LIN.signal, hot: LIN.ember });
}
