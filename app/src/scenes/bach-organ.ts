// Bach, Toccata in D minor, BWV 565: bars 1-3 (Adagio: the mordent, the descent, the diminished chord
// built over the pedal D) and bars 8-12 (the cascade, the chord over the pedal, the D-minor tonic under
// its fermata). The organ as a machine room: the facade's pipes are racks (status LEDs, unit labels),
// each lights and breathes air from its mouth while its note sounds; the console's stops are half real,
// half hyperparameters; tracker rods fan up from the keys like cables; the reverb is drawn as rings at
// every rest (RT60). Above it all a rose window lights one group of panes per chord: the only
// multi-coloured moment of the film (saturated colour passes the grade). Ramp `stone` (timeline).
// Modelled parts in bach-models.ts (flue pipes with mouths and lips, carved shades, finials, mouldings,
// the music desk's page); dust turning in a sunbeam and in the window's coloured shafts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Note } from '../engine/score';
import { clamp, ease, hash, lerp, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void } from './_kit';
import { Keyboard, KEYBOARD_W, keyX } from './_piano';
import { styled } from '../engine/style';
import { flutePipe, shadeMesh, finial, moulding } from './bach-models';
import { LivePage } from './bach-page';
import { angel, crown, corbel, column, arch, chandelier, ashlarTexture, marbleTexture, decoratedSheen, lightPool, giltMat } from './bach-ornate';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const pname = (p: number) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
const col = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
const BONE = new THREE.Color().setRGB(...LIN.bone, THREE.LinearSRGBColorSpace);

const FLOOR = -60; // the nave floor
const WIN_Y = 110; // the rose window's centre (above the centre tower's crown and angels)
const LO = 36, HI = 84; // manual pipes C2..C6 (one rank on the facade)
const PEDAL = 26; // the pedal's D (16')
const MAN_Y = [-26, -31], MAN_Z = [7, 12], MAN_S = 0.4; // upper / lower manual: height, depth, scale
/** the music desk's page: centre, tilt (top leaning back), and where a camera at distance d looks from */
const PAGE_Y = -17.1, PAGE_Z = 5.2, PAGE_TILT = 0.22;
const onPage = (x: number, dy: number, d: number, dx = 0): Pick<Shot, 'eye' | 'at'> => ({
  eye: [x + dx, PAGE_Y + dy * Math.cos(PAGE_TILT) + Math.sin(PAGE_TILT) * d, PAGE_Z - dy * Math.sin(PAGE_TILT) + Math.cos(PAGE_TILT) * d],
  at: [x, PAGE_Y + dy * Math.cos(PAGE_TILT), PAGE_Z - dy * Math.sin(PAGE_TILT)],
});

interface Pipe { p: number; x: number; z: number; h: number; r: number; mat: THREE.MeshPhysicalMaterial; unit: number; dummy: boolean }
interface Shot { t: number; eye: [number, number, number]; at: [number, number, number]; fov: number; roll?: number; cut?: boolean }

/** Stained glass, lit: saturated and bright (it passes the grade's ramp). Linear RGB. */
const GLASS: [number, number, number][] = [
  [0.85, 0.04, 0.06], [0.06, 0.16, 0.95], [0.05, 0.62, 0.22], [0.95, 0.52, 0.03], [0.42, 0.07, 0.75], [0.08, 0.55, 0.95],
];

export default class BachOrgan extends Scene {
  st = new Stage3D();
  bg = new Void();
  fx = new LineBatch(40000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  rods = new LineBatch(4000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  /** the carved pipe shades: drawn after the outlines (their pierced boards would outline as rectangles) */
  shades = new THREE.Scene();
  shadeKey = new THREE.DirectionalLight(0xffffff, 1);
  text = new Layer2D();
  notes: Note[] = [];
  pipes: Pipe[] = [];
  byPitch = new Map<number, Pipe>();
  upper = new Keyboard();
  lower = new Keyboard();
  pedals: { p: number; pivot: THREE.Group }[] = [];
  shoe!: THREE.Mesh;
  panes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; rgb: [number, number, number]; on: number; ang: number; parent?: number }[] = [];
  centre!: THREE.MeshBasicMaterial;
  stops: { label: string; side: number; row: number; pull: number; knob: THREE.Group }[] = [];
  chords: number[] = [];
  rests: number[] = [];
  shots: Shot[] = [];
  tEnd = 0;
  /** gilt points that catch the light (twinkling glints), candle flames, the floor's light pools */
  glints: THREE.Vector3[] = [];
  flames: THREE.Vector3[] = [];
  candleLights: THREE.PointLight[] = [];
  mainPool!: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial };
  panePools: { mat: THREE.MeshBasicMaterial; i: number }[] = [];
  /** the music desk's page, playing the score */
  page!: LivePage;

  override async init() {
    const sc = this.ctx.score;
    this.notes = sc.notesIn(this.ctx.start - 0.01, this.ctx.end).filter((n) => sc.parts[n.part]!.segment.startsWith('bach'));
    const S = this.st.scene;
    this.st.key.position.set(-40, 120, 160);
    this.st.rim.color.setRGB(...LIN.bone, THREE.LinearSRGBColorSpace);
    this.st.rim.position.set(30, 60, -120);
    this.buildPipes(S);
    this.buildCase(S);
    this.buildConsole(S);
    this.buildWindow(S);

    // chords (3+ notes starting together) light the window; rests (nothing sounding for 0.5 s) ring
    const byT = new Map<number, number>();
    for (const n of this.notes) byT.set(+n.t.toFixed(2), (byT.get(+n.t.toFixed(2)) ?? 0) + 1);
    this.chords = [...byT].filter(([, c]) => c >= 3).map(([t]) => t).sort((a, b) => a - b);
    const ends = this.notes.map((n) => n.t + n.d).sort((a, b) => a - b);
    for (const e of ends) {
      const sounding = this.notes.some((n) => n.t < e - 1e-3 && n.t + n.d > e + 1e-3);
      const next = this.notes.find((n) => n.t >= e - 1e-3);
      if (!sounding && (!next || next.t - e > 0.5) && !this.rests.some((r) => Math.abs(r - e) < 0.3)) this.rests.push(e);
    }
    this.tEnd = Math.max(...ends);
    const b = (n: number, seg: string) => sc.bar(n, seg).t;
    const A = (n: number) => b(n, 'bach-a'), B = (n: number) => b(n, 'bach-b');
    const ped = this.notes.filter((n) => n.p === PEDAL).map((n) => n.t);
    this.shots = [
      // the whole organ front, in the dark: the first mordent lights its first pipes
      { t: this.ctx.start, eye: [0, 8, 268], at: [0, 32, 0], fov: 42 },
      { t: A(1) + 3.9, eye: [0, 4, 232], at: [0, 32, 0], fov: 42 },
      // the second mordent: closer, the pipes read as racks (LEDs, unit labels)
      { t: A(1) + 4.0, eye: [-118, 22, 92], at: [-62, 18, 0], fov: 34, roll: 0.03, cut: true },
      { t: A(2) - 0.05, eye: [-96, 20, 80], at: [-48, 18, 0], fov: 34, roll: 0.03 },
      // bar 2: the descent in the left hand, tracking in toward the bass at the centre
      // bar 2: the descent, read off the music desk (the page plays: the playhead, the notes lighting)
      { t: A(2), ...onPage(-1, 0.3, 27, -3), fov: 34, roll: 0.02, cut: true },
      { t: ped[0]! - 0.25, ...onPage(1.5, -2.2, 19, 1), fov: 34, roll: 0 },
      // the pedal D: a foot on the pedalboard, then up the 16-foot pipe
      { t: ped[0]! - 0.24, eye: [-6, -46, 46], at: [-25, -57, 16], fov: 32, cut: true },
      { t: ped[0]! + 0.55, eye: [-9, -47, 42], at: [-25, -57, 16], fov: 32 },
      { t: ped[0]! + 0.56, eye: [22, -56, 118], at: [0, 30, 0], fov: 46, roll: 0.03, cut: true },
      { t: this.chords[0]! - 0.02, eye: [16, -55, 104], at: [0, 32, 0], fov: 46, roll: 0.02 },
      // the diminished chord and its resolution: low in the nave, the window lights above
      { t: this.chords[0]!, eye: [-34, -46, 206], at: [0, 42, 0], fov: 46, roll: 0.02, cut: true },
      { t: this.rests[2] ?? A(3) + 4.5, eye: [-14, -40, 178], at: [0, 40, 0], fov: 46 },
      // the rest after it: the reverb rings out
      { t: (this.rests[2] ?? A(3) + 4.5) + 0.01, eye: [0, 0, 236], at: [0, 26, 0], fov: 42, cut: true },
      { t: B(8) - 0.02, eye: [0, -2, 226], at: [0, 32, 0], fov: 42 },
      // bars 8-9: the console, the hands' cascade, the stops pulled for the plenum
      { t: B(8), eye: [-44, -4, 66], at: [-2, -30, 6], fov: 38, roll: 0.02, cut: true },
      { t: B(9) - 0.02, eye: [-30, -8, 58], at: [0, -30, 6], fov: 38, roll: 0.02 },
      // the tracker rods: up from the keys into the case, like cables
      // bar 9: the cascade on the page, the camera drifting with the playhead
      { t: B(9), ...onPage(-4.5, -2.6, 15, -2), fov: 34, roll: -0.02, cut: true },
      { t: B(10) - 0.02, ...onPage(4.5, -2.6, 14, 2), fov: 34, roll: 0.01 },
      // the tracker rods: up from the keys into the case, like cables
      { t: B(10), eye: [-14, -6, 62], at: [-4, -19, 0], fov: 42, roll: 0.04, cut: true },
      { t: B(10) + 1.6, eye: [8, -8, 56], at: [2, -18, 0], fov: 42, roll: 0.02 },
      // bar 10: along the pipes, the light racing
      { t: B(10) + 1.61, eye: [-128, 16, 124], at: [-80, 22, 0], fov: 36, cut: true },
      { t: this.chords[2]! - 0.02, eye: [-60, 16, 118], at: [-16, 22, 0], fov: 36 },
      // the chord over the pedal: the window again
      { t: this.chords[2]!, eye: [0, -36, 196], at: [0, 46, 0], fov: 46, cut: true },
      { t: B(11) + 0.9, eye: [6, -32, 182], at: [0, 44, 0], fov: 46 },
      // the right hand's run down
      { t: B(11) + 0.91, eye: [104, 16, 96], at: [52, 20, 0], fov: 34, roll: -0.03, cut: true },
      { t: B(12) - 0.02, eye: [84, 14, 90], at: [40, 20, 0], fov: 34, roll: -0.03 },
      // the tonic under the fermata: everything, then down through the floor
      { t: B(12), eye: [0, -18, 238], at: [0, 30, 0], fov: 44, cut: true },
      { t: this.tEnd - 0.2, eye: [0, -26, 200], at: [0, 28, 0], fov: 44 },
      { t: this.ctx.end, eye: [0, -98, 168], at: [0, -120, 40], fov: 44 },
    ];
  }

  // ------------------------------------------------------------------ the facade: one rank, C/C# sides
  buildPipes(S: THREE.Scene) {
    const gilt = giltMat();
    const add = (p: number, x: number, h: number, z: number, dummy: boolean) => {
      const r = 0.55 + h * 0.042;
      // the tower's display pipes are embossed and have gilt lips
      const tower = Math.abs(x) <= 24;
      const { group, mat } = flutePipe(r, h, 7, dummy ? '#d6d1c7' : '#ffffff', tower ? decoratedSheen() : undefined, tower ? gilt : undefined);
      group.position.set(x, 0, z);
      S.add(group);
      const pipe: Pipe = { p, x, z, h, r, mat, unit: 0, dummy };
      this.pipes.push(pipe);
      if (!dummy) this.byPitch.set(p, pipe);
      return r;
    };
    // the pedal tower: the D in the middle, display pipes falling away either side and stepping back
    // round the tower's curve
    const hp = (p: number) => 62 * Math.pow(2, (PEDAL - p) / 24);
    add(PEDAL, 0, hp(PEDAL), 3, false);
    let xl = -3.4, xr = 3.4;
    for (let k = 1; k <= 3; k++) {
      const h = hp(PEDAL + k * 2) * 0.97;
      const r = 0.55 + h * 0.042;
      const z = 3 - k * k * 0.55;
      add(PEDAL + k * 2, xr + r + 0.4, h, z, true); xr += 2 * r + 0.8;
      add(PEDAL + k * 2 + 1, xl - r - 0.4, h, z, true); xl -= 2 * r + 0.8;
    }
    // the manual rank: C side to the left, C# side to the right, the bass nearest the tower
    const hm = (p: number) => 42 * Math.pow(2, (LO - p) / 24);
    xl -= 4; xr += 4;
    for (let p = LO; p <= HI; p++) {
      const h = hm(p), r = 0.55 + h * 0.042;
      if (p % 2 === 0) { add(p, xl - r, h, 0, false); xl -= 2 * r + 0.6; }
      else { add(p, xr + r, h, 0, false); xr += 2 * r + 0.6; }
    }
    this.pipes.forEach((p, i) => (p.unit = i + 1));
  }

  // ------------------------------------------------------------------ the case, the nave
  buildCase(S: THREE.Scene) {
    const xs = this.pipes.map((p) => p.x);
    const half = Math.max(...xs.map(Math.abs)) + 6;
    // dark polished walnut for the case, every carving gilt (warm ivory highlights: see bach-ornate)
    const wood = styled({ color: col('#4a3424'), roughness: 0.45 });
    const dark = styled({ color: col('#24190f'), roughness: 0.6 });
    const gilt = giltMat();
    const GH = '#eadcbc';
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.6, w / 4, h / 4, d / 4)), m);
      b.position.set(x, y, z); S.add(b); return b;
    };
    const glint = (x: number, y: number, z: number, n = 1, spread = 2) => {
      for (let i = 0; i < n; i++) this.glints.push(new THREE.Vector3(x + (hash(x, y, i) - 0.5) * spread, y + (hash(y, i, z) - 0.5) * spread, z + 0.6));
    };
    // impost (the pipes stand on it) with a gilt bead; the base with open framing (the trackers show through)
    box(half * 2, 3, 12, 0, -8.5, 0, wood);
    { const m = moulding(half * 2 + 2, 2, GH); m.material = gilt; m.position.set(0, -7.4, 6); S.add(m); }
    box(half * 2, 3, 10, 0, -38, -1, wood);
    for (const x of [-half + 2, -36, 36, half - 2]) box(4, 50, 8, x, -35, 0, wood);
    box(half * 2 + 8, 2, 14, 0, FLOOR + 1, 0, dark);
    box(half * 2, 50, 2, 0, -34, -6, dark); // the case's back behind the open base (the wall shouldn't show through)
    // scroll corbels under the impost, along both flats
    for (let x = -half + 10; x <= half - 10; x += 17) {
      if (Math.abs(x) < 26) continue;
      const c = corbel(7, gilt); c.position.set(x, -17.2, 5.2); S.add(c);
      glint(x, -12, 7, 1, 1);
    }
    // the centre tower: cornice, a gilt moulding, a crown flanked by two trumpet angels
    box(46, 4, 14, 0, 66, 1, wood);
    const crownM = moulding(48, 4, GH); crownM.material = gilt; crownM.position.set(0, 68, -6); S.add(crownM);
    { const c = crown(11, gilt); c.position.set(0, 70, 2); S.add(c); glint(0, 77, 6, 6, 8); }
    for (const sx of [-1, 1]) {
      const a = angel(15, sx, gilt); a.position.set(sx * 17, 70, 2); a.rotation.y = -sx * 0.25; S.add(a);
      glint(sx * 17, 80, 4, 5, 8);
    }
    // the flats: a cornice and gilt moulding; under it a pierced gilt shade cut away over the pipe tops
    const tower = 24;
    for (const s of [-1, 1]) {
      const side = this.pipes.filter((p) => s * p.x > tower);
      const x0 = Math.min(...side.map((p) => s * p.x - p.r)), x1 = Math.max(...side.map((p) => s * p.x + p.r));
      const yTop = 48, yBot = Math.min(...side.map((p) => p.h)) - 1;
      const w = x1 - x0 + 2, hh = yTop - yBot;
      const cx = s * (x0 + x1) / 2;
      box(w + 4, 3, 13, cx, yTop + 1.5, 0, wood);
      const m = moulding(w + 6, 3, GH); m.material = gilt; m.position.set(cx, yTop + 3, -5.5); S.add(m);
      // urns along the flat's cornice
      for (let k = 0; k <= 3; k++) {
        const ff = finial(7, GH); ff.material = gilt; ff.position.set(cx - w / 2 + (k / 3) * w, yTop + 6, 0); S.add(ff);
        glint(ff.position.x, yTop + 11, 1.5, 2, 2);
      }
      const cut = (u: number) => {
        const x = cx - w / 2 + u * w;
        let top = 0;
        for (const p of side) if (Math.abs(x - p.x) < p.r + 0.35) top = Math.max(top, p.h);
        if (top === 0) { const near = side.reduce((a, p) => (Math.abs(p.x - x) < Math.abs(a.x - x) ? p : a)); top = near.h; }
        return Math.min(1, Math.max(0, (top + 0.6 - yBot) / hh));
      };
      const shade = shadeMesh(w, hh, cut, s > 0 ? 7 : 3, GH);
      shade.position.set(cx, yBot + hh / 2, 1.6);
      this.shades.add(shade);
      for (let k = 0; k < 14; k++) glint(cx - w / 2 + (k + 0.5) / 14 * w, yTop - 4, 2.2, 1, 3);
    }
    {
      const tw = 44, yTop = 64, yBot = 40;
      const tp = this.pipes.filter((p) => Math.abs(p.x) <= tower);
      const cut = (u: number) => {
        const x = -tw / 2 + u * tw;
        let top = 0;
        for (const p of tp) if (Math.abs(x - p.x) < p.r + 0.35) top = Math.max(top, p.h);
        return top ? Math.min(1, Math.max(0, (top + 0.6 - yBot) / (yTop - yBot))) : 0;
      };
      const shade = shadeMesh(tw, yTop - yBot, cut, 11, GH);
      shade.position.set(0, (yTop + yBot) / 2, 4.6);
      this.shades.add(shade);
    }
    // the side towers: round bays of display pipes, a cornice, a dome, an angel blowing a trumpet on top
    for (const s of [-1, 1]) {
      const cx = s * (half + 13);
      box(22, 96, 12, cx, 8, -4, wood); // the tower's back and sides
      box(26, 3, 16, cx, -8.5, 0, wood); // its impost
      // five display pipes on a convex arc
      for (let k = -2; k <= 2; k++) {
        const h = 44 - Math.abs(k) * 3, r = 0.55 + h * 0.042;
        const { group } = flutePipe(r, h, 7, '#d6d1c7', decoratedSheen(), gilt);
        group.position.set(cx + k * 3.7, 0, 4.5 - k * k * 0.6); S.add(group);
      }
      const shade = shadeMesh(22, 10, (u) => Math.min(1, Math.max(0, (44 - Math.abs((u - 0.5) * 5.4) * 3 + 0.6 - 46) / 10)), s > 0 ? 17 : 19, GH);
      shade.position.set(cx, 51, 6.5); this.shades.add(shade);
      box(26, 4, 17, cx, 58, 0, wood);
      const m = moulding(28, 3.4, GH); m.material = gilt; m.position.set(cx, 60, -8); S.add(m);
      // the dome: a gilt-ribbed cupola
      const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), wood);
      dome.position.set(cx, 63.4, 0); dome.scale.y = 0.8; S.add(dome);
      for (let k = 0; k < 8; k++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(10.05, 0.35, 6, 20, Math.PI / 2), gilt);
        rib.position.set(cx, 63.4, 0); rib.rotation.order = 'YXZ'; rib.rotation.y = (k / 8) * Math.PI * 2; rib.scale.y = 0.8; S.add(rib);
      }
      const a = angel(19, s, gilt); a.position.set(cx, 71.4, 1); a.rotation.y = -s * 0.35; S.add(a);
      glint(cx, 84, 3, 6, 10);
      // finials at the tower's corners
      for (const dx of [-12, 12]) { const ff = finial(8, GH); ff.material = gilt; ff.position.set(cx + dx, 60.5, 6); S.add(ff); glint(cx + dx, 67, 7, 1, 1); }
    }
    this.shadeKey.position.set(-40, 120, 160);
    this.shades.add(this.shadeKey, new THREE.HemisphereLight(0xffffff, 0x000000, 0.6));

    // the church: a polished marble floor (black and white diamonds), ashlar walls, a great arch round the
    // organ on its piers, fluted columns down the nave, brass chandeliers either side of the window
    const floorMat = styled({ color: new THREE.Color(0xffffff), map: marbleTexture(22), roughness: 0.15 });
    floorMat.side = THREE.DoubleSide;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR;
    S.add(floor);
    const under = new THREE.Mesh(new THREE.BoxGeometry(1200, 30, 1200), styled({ color: col('#0a0908') }));
    under.position.y = FLOOR - 15.2; S.add(under);
    const stone = styled({ color: new THREE.Color(0xffffff), map: ashlarTexture([14, 8]), roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(700, 400), stone);
    wall.position.set(0, 120, -42); S.add(wall);
    const plain = styled({ color: col('#8a8172'), roughness: 0.85 });
    const carve = styled({ color: col('#b8ae9c'), roughness: 0.7 });
    const R = half + 30;
    const ar = arch(R, 14, 7, plain, carve); ar.position.set(0, 62, -41.5); S.add(ar);
    for (const sx of [-1, 1]) {
      box(18, 62 - FLOOR + 1, 9, sx * (R + 7), (62 + FLOOR) / 2, -38, plain); // the arch's piers
      box(22, 3, 12, sx * (R + 7), 61, -37, carve); // their imposts
    }
    for (const sx of [-1, 1]) for (const z of [30, 150]) {
      const c = column(270, 9, plain, carve); c.position.set(sx * (half + 40), FLOOR, z); S.add(c);
      box(30, 6, 30, sx * (half + 40), FLOOR + 3, z, plain); // the plinth
    }
    for (const sx of [-1, 1]) {
      const { group, flames } = chandelier(26, gilt);
      group.position.set(sx * 96, 104, 46); S.add(group);
      group.updateMatrixWorld(true);
      for (const f of flames) {
        const w = f.clone().applyMatrix4(group.matrixWorld);
        this.flames.push(w);
        this.glints.push(w.clone().add(new THREE.Vector3(0, -3.5, 0.4)));
      }
      const L = new THREE.PointLight(0xffe2b8, 0, 150, 1.4);
      L.position.set(sx * 96, 108, 46); S.add(L); this.candleLights.push(L);
    }
    // light pools on the floor: the window's white one (the coloured ones are added with the panes)
    this.mainPool = lightPool(150, 230);
    this.mainPool.mesh.position.set(0, FLOOR + 0.05, 150); S.add(this.mainPool.mesh);
  }

  // ------------------------------------------------------------------ the console
  buildConsole(S: THREE.Scene) {
    const wood = styled({ color: col('#2c211a'), roughness: 0.5 });
    const g = (k: Keyboard, i: number) => {
      k.group.scale.setScalar(MAN_S);
      k.group.position.set(-KEYBOARD_W * MAN_S / 2, MAN_Y[i]!, MAN_Z[i]! + 15 * MAN_S);
      for (const key of k.keys) key.mat.emissive.copy(BONE); // organ keys glow pale, never red
      S.add(k.group);
    };
    g(this.upper, 0); g(this.lower, 1);
    const desk = new THREE.Mesh(new RoundedBoxGeometry(KEYBOARD_W * MAN_S + 26, 22, 12, 2, 0.6), wood);
    desk.position.set(0, -46, 8); S.add(desk);
    // the key cheeks either end of the manuals, the music desk with a page on it, the bench
    for (const sx of [-1, 1]) {
      const cheek = new THREE.Mesh(new RoundedBoxGeometry(2.4, 9, 12, 2, 0.4), giltMat());
      cheek.position.set(sx * (KEYBOARD_W * MAN_S / 2 + 1.4), -28.5, 9); S.add(cheek);
    }
    const rack = new THREE.Mesh(new RoundedBoxGeometry(26, 11, 1, 2, 0.3), giltMat());
    rack.position.set(0, PAGE_Y - 0.6, PAGE_Z - 0.75); rack.rotation.x = -PAGE_TILT; S.add(rack);
    const sc = this.ctx.score;
    this.page = new LivePage(19.5, 13.7, this.notes.map((n) => {
      const part = sc.parts[n.part]!;
      return { n, seg: part.segment, written: part.id === 'ped' ? n.p + 12 : n.p };
    }));
    this.page.group.position.set(0, PAGE_Y, PAGE_Z); this.page.group.rotation.x = -PAGE_TILT; S.add(this.page.group);
    this.page.group.updateMatrixWorld(true);
    const bench = new THREE.Mesh(new RoundedBoxGeometry(KEYBOARD_W * MAN_S + 6, 2.2, 10, 2, 0.5), wood);
    bench.position.set(0, -42, 34); S.add(bench);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(2, 17, 9, 2, 0.4), wood);
      leg.position.set(sx * (KEYBOARD_W * MAN_S / 2), -51.5, 34); S.add(leg);
    }
    // stop jambs: six knobs a side, each a turned shaft with a porcelain face
    const LABELS = [
      ["Principal 8'", "Octave 4'", 'Mixtur IV', "Trompette 8'", "Bourdon 16'", 'temperature 0.8'],
      ["Subbass 16'", "Posaune 16'", 'top_p 0.95', "Gedackt 8'", 'context 4096', 'seed 1704'],
    ];
    const shaftM = styled({ color: col('#20160f') });
    const faceM = styled({ color: col('#e4dccb') });
    for (const side of [0, 1]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(10, 20, 6, 2, 0.5), wood);
      const sx = (side ? 1 : -1) * (KEYBOARD_W * MAN_S / 2 + 8);
      jamb.position.set(sx, -27, 4); jamb.rotation.y = (side ? -1 : 1) * 0.5; S.add(jamb);
      LABELS[side]!.forEach((label, i) => {
        const knob = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3, 12), shaftM);
        shaft.rotation.x = Math.PI / 2; shaft.position.z = 1.5;
        const face = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.5, 18), faceM);
        face.rotation.x = Math.PI / 2; face.position.z = 3.1;
        knob.add(shaft, face);
        const row = i % 3, colm = Math.floor(i / 3);
        const holder = new THREE.Group();
        holder.position.copy(jamb.position); holder.rotation.copy(jamb.rotation);
        knob.position.set((colm - 0.5) * 4.2, 6 - row * 5.5, 2.5);
        holder.add(knob); S.add(holder);
        this.stops.push({ label, side, row: i, pull: 0, knob });
      });
    }
    // the pedalboard: long wooden keys under the bench, C1..F3
    const nat = styled({ color: col('#b9a37e') }), acc = styled({ color: col('#1b1512') });
    for (let p = 24; p <= 53; p++) {
      const black = [1, 3, 6, 8, 10].includes(p % 12);
      const pivot = new THREE.Group();
      pivot.position.set((p - 38.5) * 2.0, FLOOR + 2.4 + (black ? 1.2 : 0), -2);
      const key = new THREE.Mesh(new RoundedBoxGeometry(black ? 1.2 : 1.6, 1.2, black ? 12 : 26, 2, 0.3), black ? acc : nat);
      key.position.z = black ? 7 : 13;
      pivot.add(key); S.add(pivot);
      this.pedals.push({ p, pivot });
    }
    this.shoe = new THREE.Mesh(new RoundedBoxGeometry(4.2, 3, 11, 3, 1.2), styled({ color: col('#141110') }));
    S.add(this.shoe);
  }

  // ------------------------------------------------------------------ the rose window
  buildWindow(S: THREE.Scene) {
    const Y = WIN_Y, Z = -40.5, N = 12;
    const lead = styled({ color: col('#3d3830') });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(25, 1.6, 10, 72), lead);
    ring.position.set(0, Y, Z + 0.6); S.add(ring);
    for (let k = 0; k < N; k++) {
      const ang = (k / N) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const pane = new THREE.Mesh(new THREE.RingGeometry(9, 23.5, 10, 1, ang + 0.05, (Math.PI * 2) / N - 0.1), mat);
      pane.position.set(0, Y, Z); S.add(pane);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 16, 0.9), lead);
      bar.position.set(Math.cos(ang) * 16.2, Y + Math.sin(ang) * 16.2, Z + 0.5); bar.rotation.z = ang + Math.PI / 2; S.add(bar);
      this.panes.push({ mesh: pane, mat, rgb: GLASS[(k * 5) % GLASS.length]!, on: Infinity, ang });
    }
    this.centre = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const c = new THREE.Mesh(new THREE.CircleGeometry(8, 40), this.centre);
    c.position.set(0, Y, Z); S.add(c);
    const hub = new THREE.Mesh(new THREE.TorusGeometry(8.5, 1, 8, 48), lead);
    hub.position.set(0, Y, Z + 0.5); S.add(hub);
    // twenty-four roundels round the petals, in a wider stone ring; each lights with its petal
    for (let k = 0; k < 24; k++) {
      const ang = ((k + 0.5) / 24) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const r = new THREE.Mesh(new THREE.CircleGeometry(2.7, 20), mat);
      r.position.set(Math.cos(ang) * 29, Y + Math.sin(ang) * 29, Z); S.add(r);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.45, 6, 24), lead);
      rim.position.set(Math.cos(ang) * 29, Y + Math.sin(ang) * 29, Z + 0.4); S.add(rim);
      this.panes.push({ mesh: r, mat, rgb: GLASS[(k * 7 + 2) % GLASS.length]!, on: Infinity, ang, parent: Math.floor(k / 2) });
    }
    const outer = new THREE.Mesh(new THREE.TorusGeometry(33, 2.2, 10, 96), styled({ color: col('#5a5348') }));
    outer.position.set(0, Y, Z + 0.6); S.add(outer);
    // tracery: a cusped trefoil at the head of every petal, a thin ring between petals and roundels
    for (let k = 0; k < N; k++) {
      const ang = ((k + 0.5) / N) * Math.PI * 2;
      for (const d of [-1, 0, 1]) {
        const a2 = ang + d * 0.13, rr = d ? 19.5 : 21;
        const cusp = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.32, 6, 18), lead);
        cusp.position.set(Math.cos(a2) * rr, Y + Math.sin(a2) * rr, Z + 0.45); S.add(cusp);
      }
    }
    const mid = new THREE.Mesh(new THREE.TorusGeometry(24.6, 0.55, 6, 96), lead);
    mid.position.set(0, Y, Z + 0.5); S.add(mid);
    // the moulded stone surround: three rings stepping out, a ring of carved bosses
    const sur = styled({ color: col('#9a907f'), roughness: 0.8 });
    for (const [r, t] of [[36, 1.6], [39.2, 1.2], [42, 2.0]] as const) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 120), sur);
      m.position.set(0, Y, Z + 0.4); S.add(m);
    }
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), sur);
      b.position.set(Math.cos(a) * 37.6, Y + Math.sin(a) * 37.6, Z + 1.6); b.scale.z = 0.6; S.add(b);
    }
    // where each petal's coloured shaft lands on the floor: a soft pool
    this.panes.forEach((p, i) => {
      if (p.parent !== undefined) return;
      const x0 = Math.cos(p.ang + 0.26) * 16;
      const pool = lightPool(38, 64);
      pool.mesh.position.set(x0 * 2.2, FLOOR + 0.08 + i * 0.004, 160);
      S.add(pool.mesh);
      this.panePools.push({ mat: pool.mat, i });
    });
  }

  // ------------------------------------------------------------------ time
  camera(t: number) {
    const k = this.shots;
    let i = 0;
    while (i + 1 < k.length && t >= k[i + 1]!.t) i++;
    const a = k[i]!, b = k[Math.min(i + 1, k.length - 1)]!;
    const u = b.cut || b === a ? 0 : ease.inOutQuad(clamp((t - a.t) / Math.max(1e-3, b.t - a.t)));
    const L = (x: number[], y: number[]) => new THREE.Vector3(lerp(x[0]!, y[0]!, u), lerp(x[1]!, y[1]!, u), lerp(x[2]!, y[2]!, u));
    const eye = L(a.eye, b.eye), at = L(a.at, b.at);
    eye.x += noise1(t * 0.4, 3) * 0.8; eye.y += noise1(t * 0.35, 4) * 0.5;
    this.st.look(eye, at, lerp(a.roll ?? 0, b.roll ?? 0, u), lerp(a.fov, b.fov, u));
  }

  /** Per pitch: how much it sounds (0..1, with a short release) and its attack pulse. */
  state(t: number) {
    const s = new Map<number, { on: number; hit: number }>();
    for (const n of this.notes) {
      if (t < n.t || t > n.t + n.d + 0.4) continue;
      const on = t < n.t + n.d ? 1 : 1 - (t - n.t - n.d) / 0.4;
      const v = s.get(n.p) ?? { on: 0, hit: 0 };
      v.on = Math.max(v.on, on); v.hit = Math.max(v.hit, pulse(t, n.t, 0.1));
      s.set(n.p, v);
    }
    return s;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    this.camera(t);
    const st = this.state(t);
    // the page plays while the camera is near enough to read it (drawn before the scene renders)
    const camD = this.st.cam.position.distanceTo(this.page.group.position);
    this.page.update(t, camD < 110);
    const sc = this.ctx.score;
    // pipes glow while they sound
    for (const p of this.pipes) {
      const s = st.get(p.p);
      p.mat.emissiveIntensity = p.dummy ? 0 : s ? 0.55 * s.on + 1.6 * s.hit : 0;
    }
    // the manuals: right hand on the upper, left hand on the lower
    const part = (n: Note) => sc.parts[n.part]!.id;
    this.upper.play(t, this.notes.filter((n) => part(n) === 'rh'), { glow: 0.25, hold: 0.25 });
    this.lower.play(t, this.notes.filter((n) => part(n) === 'lh'), { glow: 0.25, hold: 0.25 });
    // the pedal and the foot on it
    const pedN = this.notes.filter((n) => part(n) === 'ped');
    let foot = 1;
    for (const pk of this.pedals) {
      let down = 0;
      for (const n of pedN) if (n.p === pk.p) down = Math.max(down, clamp((t - n.t + 0.06) / 0.06) * (t < n.t + n.d ? 1 : 1 - clamp((t - n.t - n.d) / 0.1)));
      pk.pivot.rotation.x = 0.06 * down;
      if (pk.p === PEDAL) foot = Math.min(foot, 1 - down);
    }
    const pd = this.pedals.find((x) => x.p === PEDAL)!;
    this.shoe.position.set(pd.pivot.position.x, FLOOR + 5.2 + 3.5 * foot, 18);
    this.shoe.rotation.x = -0.12;
    // the stops: registration for the Adagio, the plenum for the cascade, two more for the last chord
    const sB = sc.bar(8, 'bach-b').t;
    const pulls: Record<string, number> = {
      "Principal 8'": this.ctx.start - 1, "Subbass 16'": this.ctx.start - 1, "Octave 4'": this.ctx.start - 1, "Bourdon 16'": sc.bar(2, 'bach-a').t - 0.3,
      'Mixtur IV': sB - 0.2, "Trompette 8'": sB - 0.15, "Posaune 16'": sB - 0.1, 'temperature 0.8': sB + 0.4, 'top_p 0.95': sB + 0.9,
      "Gedackt 8'": this.chords[2]! - 0.3, 'context 4096': this.chords[2]! - 0.2, 'seed 1704': this.chords[3]! - 0.25,
    };
    for (const s of this.stops) { s.pull = prog(t, pulls[s.label]!, pulls[s.label]! + 0.25, ease.outBack); s.knob.position.z = 2.5 + 2.2 * s.pull; }
    // the window: each chord lights its group of panes
    const groups = [[0, 1, 2], [6, 7, 8], [3, 4, 5, 9, 10, 11], []];
    this.panes.forEach((p) => (p.on = Infinity));
    this.chords.forEach((c, i) => { const g = i < 3 ? groups[i]! : this.panes.map((_, j) => j); for (const j of g) this.panes[j]!.on = Math.min(this.panes[j]!.on, c); });
    for (const p of this.panes) if (p.parent !== undefined) p.on = Math.min(p.on, this.panes[p.parent]!.on + 0.08);
    const lit = (on: number) => (t < on ? 0 : 0.55 + 2.2 * pulse(t, on, 0.35));
    for (const p of this.panes) { const k = lit(p.on); p.mat.color.setRGB(p.rgb[0] * k + 0.012, p.rgb[1] * k + 0.011, p.rgb[2] * k + 0.01); }
    const ck = this.chords[3] !== undefined ? lit(this.chords[3]) : 0;
    this.centre.color.setRGB(0.012 + 1.6 * ck, 0.011 + 1.3 * ck, 0.01 + 0.7 * ck);

    // light: up from the dark at the start; the house a little brighter with the level
    const level = f.a.rms;
    const dawn = prog(t, this.ctx.start, this.ctx.start + 2.5, ease.outCubic);
    const fadeOut = 1 - prog(t, this.tEnd + 0.1, this.ctx.end - 0.1);
    const centreLit = this.chords[3] !== undefined && t >= this.chords[3] ? 1 : 0;
    const anyPane = this.panes.filter((p) => t >= p.on && p.parent === undefined).length / 12;
    const winA = (0.024 + 0.024 * anyPane + 0.05 * centreLit + 0.06 * Math.max(0, ...this.chords.map((c) => pulse(t, c, 1.0)))) * dawn * fadeOut;
    const anyHit = Math.max(0, ...[...st.values()].map((v) => v.hit));
    this.st.key.intensity = (0.35 + 1.5 * dawn) * (0.85 + 0.3 * level);
    this.st.rim.intensity = 1.2 + 1.5 * anyHit;
    this.st.fill.intensity = 0.25;
    this.bg.render(renderer, out, t, 0, 0);
    this.st.render(renderer, out);
    this.shadeKey.intensity = this.st.key.intensity * 0.9;
    renderer.setRenderTarget(out);
    renderer.render(this.shades, this.st.cam);

    // tracker rods: from each lower-manual key up to its pipe (a fan of cables)
    const R = this.rods; R.clear();
    for (let p = LO; p <= HI; p++) {
      const pipe = this.byPitch.get(p); if (!pipe) continue;
      const s = st.get(p);
      const pull = s ? s.on : 0;
      const kx = (keyX(p) - KEYBOARD_W / 2) * MAN_S;
      const y0 = MAN_Y[1]! - 2 + pull * 0.6, y1 = -22 + pull * 0.6;
      const c = s ? LIN.bone : LIN.ash, g = s ? 0.9 + 1.5 * s.hit : 0.3;
      R.seg(kx, y0, 1, kx, y1, 1, 0.22, c[0] * g, c[1] * g, c[2] * g, 1);
      R.seg(kx, y1, 1, pipe.x, -10, pipe.z, 0.22, c[0] * g, c[1] * g, c[2] * g, 1);
    }
    R.render(renderer, out, this.st.cam);

    const X = this.fx; X.clear();
    if (camD < 60) {
      // ink turned to light: motes lifting off the notes as they sound
      for (const q of this.page.sounding(t)) {
        const age = t - q.n.t;
        for (let i = 0; i < 6; i++) {
          const a = age - i * 0.03; if (a < 0 || a > 0.7) continue;
          const h1 = hash(q.n.t, q.n.p, i), h2 = hash(i, q.n.p, 4);
          const lp = this.page.local(q.x, q.y).add(new THREE.Vector3((h1 - 0.5) * 3 * a, (0.6 + h2) * 2.2 * a, 0.3 + 2.4 * a));
          const w = this.page.group.localToWorld(lp);
          const g = 1.6 * (1 - a / 0.7);
          X.seg(w.x, w.y, w.z, w.x + 0.03, w.y + 0.05, w.z, 0.06, 1.0 * g, 0.86 * g, 0.62 * g, 1);
        }
      }
    }
    for (const p of this.pipes) {
      // status LEDs on every pipe: idle blink, a level meter while it sounds
      const s = st.get(p.p);
      const nL = 6;
      for (let j = 0; j < nL; j++) {
        const y = p.h * 0.32 + j * Math.min(1.6, p.h * 0.05);
        let g = hash(p.unit, j, Math.floor(t * 3 + p.unit * 0.37)) > 0.72 ? 0.5 : 0.06;
        if (s && !p.dummy) g = j < Math.ceil(nL * (0.4 + 0.6 * s.on)) ? 1.6 + 2 * s.hit : 0.06;
        X.seg(p.x - 0.18, y, p.z + p.r + 0.05, p.x + 0.18, y, p.z + p.r + 0.05, 0.32, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
      }
    }
    // air from the mouths of the sounding pipes
    for (const n of this.notes) {
      const pipe = this.byPitch.get(n.p); if (!pipe) continue;
      if (t < n.t || t > n.t + n.d + 0.8) continue;
      const nP = Math.min(40, Math.ceil(n.d / 0.05));
      for (let i = 0; i < nP; i++) {
        const born = n.t + i * 0.05, age = t - born;
        if (age < 0 || age > 0.8) continue;
        const h1 = hash(n.t, n.p, i), h2 = hash(n.p, i, 7), h3 = hash(i, n.t, 3);
        const vx = (h1 - 0.5) * 6, vy = 5 + h2 * 9, vz = 3 + h3 * 5;
        const x = pipe.x + vx * age, y = pipe.r * 0.6 + vy * age, z = pipe.z + pipe.r + vz * age;
        const g = 0.9 * (1 - age / 0.8) * (0.4 + pipe.r * 0.25);
        X.seg(x, y, z, x + vx * 0.03, y + vy * 0.03, z + vz * 0.03, 0.12 + pipe.r * 0.04, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
      }
    }
    // the reverb: a ring per rest, expanding through the nave, -60 dB over 4.2 s
    for (const r of this.rests) {
      const age = t - r;
      if (age < 0 || age > 4.2) continue;
      for (let k = 0; k < 3; k++) {
        const a = age - k * 0.35; if (a < 0) continue;
        const rad = 14 + a * 70, g = 1.4 * Math.pow(10, -3 * a / 4.2) * (1 - k * 0.25);
        let px = 0, py = 0;
        for (let s = 0; s <= 96; s++) {
          const ang = (s / 96) * Math.PI * 2;
          const x = Math.cos(ang) * rad, y = 26 + Math.sin(ang) * rad * 0.8;
          if (s) X.seg(px, py, 30, x, y, 30, 0.25, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
          px = x; py = y;
        }
      }
    }
    // a sunbeam from a high window on the left, always: a faint wide shaft and the dust turning in it
    const SB0 = new THREE.Vector3(-260, 230, 40), SB1 = new THREE.Vector3(40, FLOOR, 90);
    const beam = 0.05 * prog(t, this.ctx.start, this.ctx.start + 3) * (1 - prog(t, this.tEnd + 0.1, this.ctx.end - 0.1));
    // the shaft itself: barely there, soft-edged (many faint strands, brightest at its axis)
    for (let k = 0; k < 13; k++) {
      const o = (k - 6) * 2.2, fall = Math.exp(-((k - 6) * (k - 6)) / 14);
      const g = beam * 0.09 * fall;
      X.seg(SB0.x + o, SB0.y, SB0.z, SB1.x + o, SB1.y, SB1.z, 2.6, LIN.bone[0] * g, LIN.bone[1] * g * 0.95, LIN.bone[2] * g * 0.85, 1);
    }
    const ax = new THREE.Vector3().subVectors(SB1, SB0), len = ax.length(); ax.normalize();
    const tt = t - this.ctx.start;
    for (let i = 0; i < 1100; i++) {
      const h1 = hash(i, 61), h2 = hash(i, 62), h3 = hash(i, 63);
      // somewhere along the shaft, drifting slowly (and a few hundred loose in the nave)
      const along = h1 * len, spread = 26;
      const base = new THREE.Vector3().copy(SB0).addScaledVector(ax, along);
      const x = base.x + (h2 - 0.5) * spread + 3 * noise1(tt * 0.15 + i, 1);
      const y = base.y + (h3 - 0.5) * spread + 3 * noise1(tt * 0.12 + i, 2) - tt * 0.6 * h2;
      const z = base.z + (hash(i, 64) - 0.5) * spread + 2 * noise1(tt * 0.1 + i, 3);
      let g = 22 * beam * (0.4 + 0.6 * hash(i, 65));
      // brighter where a lit window shaft crosses
      for (const p of this.panes) {
        if (p.parent !== undefined || t < p.on) continue;
        const sx = Math.cos(p.ang + 0.26) * 16, sy = WIN_Y + Math.sin(p.ang + 0.26) * 16;
        const ex = sx * 2.2, ey = FLOOR + 2, ez = 160;
        const vx = ex - sx, vy = ey - sy, vz = ez + 38;
        const u = clamp(((x - sx) * vx + (y - sy) * vy + (z + 38) * vz) / (vx * vx + vy * vy + vz * vz));
        const dx = x - (sx + vx * u), dy = y - (sy + vy * u), dz = z - (-38 + vz * u);
        if (dx * dx + dy * dy + dz * dz < 36) g += 1.2 * pulse(t, p.on, 1.2) + 0.35;
      }
      if (g < 0.02) continue;
      X.seg(x, y, z, x + 0.12, y + 0.05, z, 0.16, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g * 0.9, 1);
    }
    // motes turning in the window's cone, a few catching the light warmly
    for (let i = 0; i < 600; i++) {
      const u = hash(i, 81), phi = hash(i, 82) * Math.PI * 2, rr = Math.sqrt(hash(i, 83));
      const x = Math.cos(phi) * lerp(22, 60, u) * rr + 2 * noise1(tt * 0.13 + i, 5);
      const y = lerp(WIN_Y, FLOOR + 4, u) + 2 * noise1(tt * 0.11 + i, 6) - ((tt * 0.5 * hash(i, 84)) % 6);
      const z = lerp(-36, 150, u) + Math.sin(phi) * 50 * u * rr;
      const warm = hash(i, 85) > 0.9 ? 1 : 0;
      const g = winA * (14 + 30 * warm) * (0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(tt * 1.3 + i)), 4));
      if (g < 0.02) continue;
      X.seg(x, y, z, x + 0.1, y + 0.04, z, warm ? 0.22 : 0.14, LIN.bone[0] * g, LIN.bone[1] * g * (warm ? 0.9 : 1), LIN.bone[2] * g * (warm ? 0.7 : 0.9), 1);
    }
    // light from the window: soft coloured shafts falling into the nave (a flash on the chord, then they stay, faint)
    const paneK = (p: (typeof this.panes)[number]) => (t < p.on ? 0 : 0.028 + 0.17 * pulse(t, p.on, 0.9));
    for (const p of this.panes) {
      if (p.parent !== undefined) continue;
      const k = paneK(p) * fadeOut;
      if (k < 0.002) continue;
      const x0 = Math.cos(p.ang + 0.26) * 16, y0 = WIN_Y + Math.sin(p.ang + 0.26) * 16;
      for (let j = -3; j <= 3; j++) {
        const fall = Math.exp(-(j * j) / 4.5), wob = 1 + 0.25 * noise1(t * 0.7 + j, p.ang * 10);
        const g = k * fall * wob * 0.55;
        X.seg(x0 + j * 0.9, y0, -38, x0 * 2.2 + j * 3.2, FLOOR + 2, 160, 2.4 + 1.6 * fall, p.rgb[0] * g, p.rgb[1] * g, p.rgb[2] * g, 1);
      }
    }
    // the window's own light: a broad pale cone falling from the rose into the nave, there from the start
    for (let j = 0; j < 26; j++) {
      const phi = (j / 26) * Math.PI * 2, rr = 0.55 + 0.45 * hash(j, 71);
      const g = winA * (0.5 + 0.5 * noise1(t * 0.25 + j * 1.7, 9)) * (1.2 - rr * 0.6);
      X.seg(Math.cos(phi) * 24 * rr, WIN_Y + Math.sin(phi) * 22 * rr, -38, Math.cos(phi) * 62 * rr, FLOOR + 2, 150 + Math.sin(phi) * 70 * rr, 7, LIN.bone[0] * g, LIN.bone[1] * g * 0.97, LIN.bone[2] * g * 0.9, 1);
    }
    // the floor pools under the shafts
    this.mainPool.mat.color.setRGB(LIN.bone[0] * winA * 9, LIN.bone[1] * winA * 8.6, LIN.bone[2] * winA * 8);
    for (const pp of this.panePools) {
      const p = this.panes[pp.i]!, k = paneK(p) * fadeOut * 3.2;
      pp.mat.color.setRGB(p.rgb[0] * k, p.rgb[1] * k, p.rgb[2] * k);
    }
    // candles: flickering flames, a warm light from each chandelier
    const flick = (i: number) => 0.8 + 0.2 * noise1(t * 6 + i * 3.1, 13) + 0.1 * noise1(t * 17 + i, 14);
    this.candleLights.forEach((L, i) => (L.intensity = 2.2 * dawn * flick(i * 7) * fadeOut));
    this.flames.forEach((f, i) => {
      const g = 2.4 * flick(i) * dawn * fadeOut;
      X.seg(f.x, f.y - 0.5, f.z, f.x + 0.05 * noise1(t * 9 + i, 2), f.y + 0.9, f.z, 0.55, 1.0 * g, 0.62 * g, 0.28 * g, 1);
      X.seg(f.x, f.y - 0.2, f.z, f.x, f.y + 0.3, f.z, 1.5, 0.45 * g, 0.28 * g, 0.12 * g, 1);
    });
    // the polished floor: glows reflected (a mirrored source, seen where its ray meets the floor; streaked toward the eye)
    const eyeP = this.st.cam.position;
    const reflect = (x: number, y: number, z: number, r: number, gg: number, b: number, w: number) => {
      const my = 2 * FLOOR - y;
      const hit = (yy: number) => {
        const u = (FLOOR + 0.12 - eyeP.y) / (yy - eyeP.y);
        return u > 0 && u < 1 ? new THREE.Vector3(eyeP.x + (x - eyeP.x) * u, FLOOR + 0.12, eyeP.z + (z - eyeP.z) * u) : null;
      };
      const a = hit(my), c = hit(my - 6);
      if (!a || !c) return;
      X.seg(a.x, a.y, a.z, c.x, c.y, c.z, w, r, gg, b, 1);
    };
    this.flames.forEach((f, i) => { const g = 0.5 * flick(i) * dawn * fadeOut; reflect(f.x, f.y, f.z, g, g * 0.6, g * 0.27, 0.9); });
    for (const p of this.panes) {
      if (p.parent !== undefined || t < p.on) continue;
      const k = (0.18 + 0.6 * pulse(t, p.on, 0.6)) * fadeOut;
      const cx = Math.cos(p.ang + 0.26) * 16, cy = WIN_Y + Math.sin(p.ang + 0.26) * 16;
      reflect(cx, cy, -40, p.rgb[0] * k, p.rgb[1] * k, p.rgb[2] * k, 3.2);
    }
    // gilt glints: the carving catches the light, a few points at a time, more on the chords
    const lift = 0.35 + 0.65 * dawn + 0.8 * Math.max(0, ...this.chords.map((c) => pulse(t, c, 0.6)));
    this.glints.forEach((q, i) => {
      const ph = hash(i, 91) * 50, sp = 0.6 + hash(i, 92) * 1.4;
      const tw = Math.pow(Math.max(0, Math.sin(t * sp + ph)), 28);
      const g = tw * lift * 3.2 * fadeOut;
      if (g < 0.03) return;
      const L = 0.9 + 1.6 * tw;
      X.seg(q.x - L, q.y, q.z, q.x + L, q.y, q.z, 0.12, g, g * 0.95, g * 0.85, 1);
      X.seg(q.x, q.y - L, q.z, q.x, q.y + L, q.z, 0.12, g, g * 0.95, g * 0.85, 1);
      X.seg(q.x - 0.25, q.y, q.z, q.x + 0.25, q.y, q.z, 0.6, g * 0.6, g * 0.55, g * 0.45, 1);
    });
    X.render(renderer, out, this.st.cam);

    this.drawText(t, st, level);
    comp.draw(renderer, this.text.upload(), out);
    const sh = 2.5 * anyHit * (this.chords.some((c) => Math.abs(t - c) < 0.3) ? 1 : 0.2);
    return {
      bloom: 0.75, bloomThreshold: 1.0, halation: 0.15, grain: 0.06, vignette: 0.5,
      shake: [noise1(t * 30, 1) * sh, noise1(t * 30, 2) * sh], ca: 1.0 + 0.8 * anyHit,
      fade: Math.max(1 - prog(t, this.ctx.start, this.ctx.start + 0.5), prog(t, this.tEnd + 0.1, this.ctx.end - 0.1)),
    };
  }

  // ------------------------------------------------------------------ type
  proj(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.st.cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H, ok: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  /** Lens glare: soft anamorphic streaks and stars on the brightest sources (the lit rose, the candles). */
  drawGlare(c: CanvasRenderingContext2D, t: number) {
    const fadeOut = 1 - prog(t, this.tEnd + 0.1, this.ctx.end - 0.1);
    const dawn = prog(t, this.ctx.start, this.ctx.start + 2.5, ease.outCubic);
    c.save(); c.globalCompositeOperation = 'lighter';
    const star = (x: number, y: number, a: number, len: number, rgb: string) => {
      if (a < 0.01) return;
      const gr = c.createRadialGradient(x, y, 0, x, y, len * 0.18);
      gr.addColorStop(0, `rgba(${rgb},${0.55 * a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, len * 0.18, 0, Math.PI * 2); c.fill();
      for (const [dx, dy, l] of [[1, 0, 1], [0, 1, 0.35], [0.7, 0.7, 0.22], [0.7, -0.7, 0.22]] as const) {
        const g2 = c.createLinearGradient(x - dx * len * l, y - dy * len * l, x + dx * len * l, y + dy * len * l);
        g2.addColorStop(0, `rgba(${rgb},0)`); g2.addColorStop(0.5, `rgba(${rgb},${0.5 * a})`); g2.addColorStop(1, `rgba(${rgb},0)`);
        c.strokeStyle = g2; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(x - dx * len * l, y - dy * len * l); c.lineTo(x + dx * len * l, y + dy * len * l); c.stroke();
      }
    };
    const lit = this.panes.filter((p) => t >= p.on && p.parent === undefined).length;
    if (lit) {
      const q = this.proj(0, WIN_Y, -38);
      const boom = Math.max(0, ...this.chords.map((ch) => pulse(t, ch, 0.7)));
      if (q.ok) star(q.x, q.y, (0.12 + 0.05 * lit / 12 + 0.7 * boom) * fadeOut, 420 + 380 * boom, '255,246,226');
    }
    this.flames.forEach((f, i) => {
      if (i % 2) return;
      const q = this.proj(f.x, f.y, f.z);
      if (q.ok) star(q.x, q.y, 0.3 * dawn * fadeOut * (0.8 + 0.2 * noise1(t * 6 + i, 13)), 90, '255,214,160');
    });
    c.restore();
  }

  drawText(t: number, st: Map<number, { on: number; hit: number }>, level: number) {
    const T = this.text; T.clear();
    const c = T.ctx;
    this.drawGlare(c, t);
    const sc = this.ctx.score;
    const A1 = sc.bar(1, 'bach-a').t, B8 = sc.bar(8, 'bach-b').t, B9 = sc.bar(9, 'bach-b').t;
    c.textBaseline = 'alphabetic';
    // the title, under the first mordent
    {
      const a = prog(t, A1 + 0.3, A1 + 0.8) * (1 - prog(t, A1 + 3.4, A1 + 3.9));
      if (a > 0) {
        c.save(); c.globalAlpha = a;
        c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('ash', 1);
        c.fillText('J. S. BACH · TOCCATA AND FUGUE IN D MINOR · BWV 565 · c. 1704', 120, 130);
        c.letterSpacing = '0px';
        c.font = font(F.serif(400, true), 96); c.fillStyle = rgba('bone', 0.96);
        const s = 'Adagio.';
        c.fillText(s.slice(0, Math.floor(s.length * prog(t, A1 + 0.5, A1 + 1.1)) || 0), 110, 235);
        c.restore();
      }
    }
    // up close the pipes are racks: unit labels at their feet (in the medium shots)
    const shot = this.shots.reduce((m, s) => (t >= s.t ? s : m), this.shots[0]!);
    const medium = shot.fov <= 38 && shot.eye[1] > -20 && t < B8 || (t >= sc.bar(10, 'bach-b').t && shot.fov <= 38);
    if (medium) {
      c.font = font(F.mono(500), 13); c.letterSpacing = '1px'; c.textAlign = 'center';
      for (const p of this.pipes) {
        // a tag on the body just above the mouth: pitch and rack unit
        const q = this.proj(p.x, p.r * 0.6 + 2.4, p.z + p.r + 0.2);
        const q2 = this.proj(p.x + p.r, p.r * 0.6 + 2.4, p.z + p.r + 0.2);
        if (!q.ok || Math.abs(q2.x - q.x) < 9) continue;
        const s = st.get(p.p);
        c.fillStyle = s ? rgba('ink', 0.95) : rgba('ink2', 0.85);
        if (!p.dummy) c.fillText(pname(p.p), q.x, q.y - 8);
        c.fillText(`U${String(p.unit).padStart(2, '0')}`, q.x, q.y + 8);
      }
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
    // the pedal close-up
    const ped = this.notes.find((n) => n.p === PEDAL);
    if (ped && t >= ped.t - 0.25 && t < ped.t + 0.55) {
      c.font = font(F.mono(500), 20); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', prog(t, ped.t - 0.05, ped.t + 0.1));
      c.fillText('PEDAL · D1 · 16′ · PRINCIPALBASS', 120, H - 120);
      c.letterSpacing = '0px';
    }
    // the reverb readout while a ring is in the air
    for (const r of this.rests) {
      const age = t - r;
      if (age < 0 || age > 4.2) continue;
      const a = prog(age, 0, 0.25) * (1 - prog(age, 3.6, 4.2));
      c.save(); c.globalAlpha = a; c.textAlign = 'right';
      c.font = font(F.mono(500), 20); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.95);
      c.fillText('RT60 4.2 s', W - 110, H - 132);
      c.font = font(F.mono(400), 15); c.fillStyle = rgba('ash', 0.9);
      c.fillText(`tail  ${(-60 * Math.min(1, age / 4.2)).toFixed(1)} dB   t+${age.toFixed(2)} s`, W - 110, H - 104);
      c.restore();
    }
    // the console: stop labels beside their knobs, the wind, the training set
    if (t >= B8 && t < B9) {
      c.font = font(F.mono(500), 15); c.letterSpacing = '1px';
      for (const s of this.stops) {
        const p = new THREE.Vector3(0, 0, 3.4); s.knob.localToWorld(p);
        const q = this.proj(p.x, p.y, p.z);
        if (!q.ok) continue;
        c.textAlign = s.side ? 'left' : 'right';
        const hyper = /[a-z]_|temperature|context|seed/.test(s.label);
        c.fillStyle = s.pull > 0.5 ? rgba(hyper ? 'bone' : 'paper', 0.95) : rgba('graphite', 0.8);
        c.fillText(s.label, q.x + (s.side ? 22 : -22), q.y + 5);
      }
      c.textAlign = 'left'; c.letterSpacing = '0px';
      const a = prog(t, B8 + 0.6, B8 + 1.0);
      c.globalAlpha = a;
      c.font = font(F.mono(400), 20); c.fillStyle = rgba('bone', 0.92);
      const line = 'training set: J. S. Bach, 371 chorales';
      c.fillText(line.slice(0, Math.floor(line.length * prog(t, B8 + 0.6, B8 + 1.6))), 110, H - 100);
      c.textAlign = 'right'; c.fillStyle = rgba('ash', 0.9); c.font = font(F.mono(400), 16);
      c.fillText(`wind ${(72 + 14 * level).toFixed(1)} mmWS · plenum · Prestissimo`, W - 110, 120);
      c.textAlign = 'left'; c.globalAlpha = 1;
    }
  }
}
