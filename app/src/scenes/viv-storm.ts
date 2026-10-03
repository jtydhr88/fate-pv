// Vivaldi, The Four Seasons, Summer, III. Presto (bars 1-20): the storm, read by a weather station.
// The porcelain plate the dice landed on cracks under the first tremolo and the grade turns to storm;
// the camera rises over a field of wheat whose stalks are a spectrum (one column per pitch band, lifted
// by the notes sounding in it), a station mast at the far end (anemometer, radar dome). Instruments in
// 2D: an oscilloscope trace of the tremolo, a barometer falling, a radar sweep, an ensemble forecast
// (32 sampled continuations of the solo line, the real one among them). Bar 5's silence is the
// barometer, full frame. From bar 10 the solo violin's scales come down as hail: every note a stone
// that lands where its pitch grows and cuts that column of wheat ("Tronca il capo alle spiche"), the
// sforzandi are lightning (the sonnet's line lit by it), and bar 20 strikes, then the dark.
// Modelled objects in viv-models.ts (the station, wheat, hail, the cloud sky); particles throughout:
// porcelain chips and the impact ring, rain, ice fragments and spray off every stone, chaff and seed.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Note } from '../engine/score';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void } from './_kit';
import { Fiddle } from './_instruments';
import { styled } from '../engine/style';
import { buildStation, wheatGeometries, hailGeometry, cloudTexture, glowTexture, type Station } from './viv-models';

type Key = { t: number; eye: [number, number, number]; at: [number, number, number]; roll?: number; fov?: number };

const COLS = 44; // spectrum columns of wheat
const ROWS = 34; // stalks per column, front to back
const P_LO = 43, P_HI = 93; // the pitch range the columns cover (cello G2 to the solo's A6)
const FIELD_W = 132, FIELD_Z0 = 30, FIELD_Z1 = -70;
const colOf = (p: number) => clamp(Math.floor(((p - P_LO) / (P_HI - P_LO)) * COLS), 0, COLS - 1);
const colX = (c: number) => -FIELD_W / 2 + (c + 0.5) * (FIELD_W / COLS);

interface Stone { n: Note; x: number; z: number; col: number }
interface Bolt { t: number; pts: [number, number, number][][]; big: boolean }
/** A crack in the glaze: a jagged polyline growing from t0 to t1, its width tapering from w. */
interface Crack { pts: [number, number][]; t0: number; t1: number; w: number }

const IMPACT: [number, number] = [0, 12]; // where the first hail of the storm strikes the plate
const SHARDS = 900; // ice / porcelain fragments in flight at once (instanced)
const GRAINS = 1800; // grains thrown out of the ears the hail breaks (instanced)
const N = COLS * ROWS;

/** The plate the storm breaks: glazed white, a cobalt band and scallops round the rim (the Mozart plate). */
function plateTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(512, 512, 40, 512, 512, 512);
  grd.addColorStop(0, '#fbfcfd'); grd.addColorStop(0.75, '#eef1f4'); grd.addColorStop(1, '#e2e7ec');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 1024);
  g.translate(512, 512);
  g.strokeStyle = '#2b4f86'; g.fillStyle = '#2b4f86';
  for (const [r, w] of [[500, 7], [478, 2], [372, 2], [366, 1]] as const) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 40; i++) {
    g.save(); g.rotate((i / 40) * Math.PI * 2);
    g.lineWidth = 3; g.beginPath(); g.arc(0, -425, 36, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(-12, -458, 13, 0, Math.PI * 1.6); g.stroke();
    g.beginPath(); g.arc(12, -458, 13, Math.PI * 1.4, Math.PI * 3); g.stroke();
    g.beginPath(); g.ellipse(0, -392, 3, 7, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export default class VivStorm extends Scene {
  st = new Stage3D();
  bg = new Void();
  T = new Layer2D();
  fx = new LineBatch(40000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  ink = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  strings = new LineBatch(4000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  ground!: THREE.Mesh;
  groundMat!: THREE.MeshPhysicalMaterial;
  wheat!: THREE.InstancedMesh;
  heads!: THREE.InstancedMesh;
  hail!: THREE.InstancedMesh;
  shards!: THREE.InstancedMesh;
  cups!: THREE.Group;
  station!: Station;
  sky!: THREE.Mesh;
  skyMat!: THREE.MeshBasicMaterial;
  skyTex!: THREE.Texture;
  plate!: THREE.Mesh;
  plateMat!: THREE.MeshPhysicalMaterial;
  fog = new THREE.Fog(0x070909, 70, 340);
  leaves!: THREE.InstancedMesh;
  grains!: THREE.InstancedMesh;
  /** the uncut ear tops this frame (where the grains fly from when the hail breaks an ear) */
  earTop = new Float32Array(N * 3);
  /** the sky is its own scene, drawn before the stage (cloud layers and glows take no ink outlines) */
  skyScene = new THREE.Scene();
  layers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; tex: THREE.Texture; speed: number; base: number }[] = [];
  glows: THREE.Sprite[] = [];
  veils: { x: number; z: number; w: number }[] = [];
  sun!: THREE.Sprite;
  golden = new THREE.DirectionalLight(0xffe8c6, 0);
  sweep = new THREE.SpotLight(0xfff0d6, 0, 0, 0.17, 0.75, 0);
  sheets: { t: number; x: number; y: number; z: number; s: number }[] = [];
  crawls: { t: number; pts: [number, number, number][][] }[] = [];
  fiddle!: Fiddle;
  fiddleM = new THREE.Matrix4();
  all: Note[] = [];
  solo: Note[] = [];
  trem: number[] = []; // onsets of the repeated-note accompaniment (the oscilloscope's bursts)
  stones: Stone[] = [];
  cuts: { t: number; col: number }[] = [];
  cracks: Crack[] = [];
  bolts: Bolt[] = [];
  keys: Key[] = [];
  b: (n: number) => number = () => 0;
  tEnd = 0;
  stalkBase: number[] = [];

  override async init() {
    const sc = this.ctx.score, seg = 'viv';
    const ids = ['solo', 'vl1', 'vl2', 'va', 'vc'].map((p) => `${seg}:${p}`);
    this.all = sc.notesIn(this.ctx.start - 0.1, this.ctx.end, { parts: ids });
    this.solo = this.all.filter((n) => n.part === sc.partIndex(`${seg}:solo`));
    this.b = (n: number) => sc.bar(n, seg).t;
    const b = this.b;
    this.tEnd = sc.segments.find((s) => s.id === seg)!.end;
    this.trem = [...new Set(this.all.filter((n) => n.part === sc.partIndex(`${seg}:va`)).map((n) => +n.t.toFixed(3)))].sort((x, y) => x - y);
    const S = this.st.scene;
    const R = mulberry32(1725);

    // the ground: a pale plate at first (the porcelain it came from), the field's earth later
    this.groundMat = styled({ color: new THREE.Color(0xf2f2f2), roughness: 0.9 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    S.add(this.ground);
    S.fog = this.fog;

    // the plate the dice landed on, over the earth: glazed porcelain (it breaks, then fades into the field)
    this.plateMat = styled({ color: new THREE.Color(0xffffff), map: plateTexture(), roughness: 0.2 });
    this.plateMat.transparent = true;
    this.plate = new THREE.Mesh(new THREE.CircleGeometry(64, 96), this.plateMat);
    this.plate.rotation.x = -Math.PI / 2; this.plate.position.set(IMPACT[0], 0.04, IMPACT[1]);
    S.add(this.plate);
    // the storm sky: a dome of cloud, lit by the lightning (unshaded, outside the fog)
    this.skyTex = cloudTexture();
    this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(520, 64, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), this.skyMat);
    this.sky.position.set(0, -40, -60);
    const SK = this.skyScene;
    SK.add(this.sky);
    // two layers of billowing cloud in front of it, drifting at their own speeds (lit from within by the lightning)
    for (const [seed, r, speed, base] of [[31, 470, 0.010, 0.62], [77, 425, 0.019, 0.5]] as const) {
      const tex = cloudTexture(seed, true); tex.repeat.x = 2;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 24, 0, Math.PI * 2, 0, Math.PI * 0.52), mat);
      mesh.position.set(0, -40, -60);
      SK.add(mesh);
      this.layers.push({ mesh, mat, tex, speed, base });
    }
    // the light inside the clouds: soft additive glows, placed per frame at the bolts and the sheet lightning
    const gtex = glowTexture();
    for (let k = 0; k < 6; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.visible = false; SK.add(sp); this.glows.push(sp);
    }
    // the sun's last gap, low on the horizon behind the station, before the storm closes it
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.sun.position.set(-230, 18, -400); this.sun.scale.set(520, 230, 1);
    SK.add(this.sun);
    // rain curtains hanging from the cloud base far off (drawn as sheets of streaks, see render)
    for (let k = 0; k < 6; k++) this.veils.push({ x: -240 + k * 96 + 30 * R(), z: -200 - 70 * R(), w: 50 + 40 * R() });
    // the golden-hour light: low behind the field from the left (a rim on every stalk and ear), and a beam
    // through a gap in the cloud sweeping across the field; both drowned as the storm closes in
    this.golden.position.set(-220, 30, -260);
    S.add(this.golden);
    this.sweep.position.set(-140, 260, -240);
    S.add(this.sweep, this.sweep.target);
    // sheet lightning inside the clouds (no bolt), and its crawl across the sky, from bar 6
    const Rs = mulberry32(1726);
    for (const bar of [6, 7, 8, 9, 11, 13, 15, 17, 18, 19]) {
      const t0 = b(bar) + (b(bar + 1) - b(bar)) * (0.25 + 0.5 * Rs());
      this.sheets.push({ t: t0, x: -220 + 440 * Rs(), y: 150 + 70 * Rs(), z: -320 + 120 * Rs(), s: 0.5 + 0.5 * Rs() });
    }

    // the wheat: COLS x ROWS stalks (unit height, scaled per frame by the spectrum), and their ears
    const wg = wheatGeometries();
    const white = () => { const m = styled({ color: new THREE.Color(0xffffff), roughness: 0.75 }); m.side = THREE.DoubleSide; return m; };
    this.wheat = new THREE.InstancedMesh(wg.stem, white(), N);
    this.heads = new THREE.InstancedMesh(wg.ear, white(), N);
    this.leaves = new THREE.InstancedMesh(wg.leaf, white(), N * 2);
    this.grains = new THREE.InstancedMesh(wg.grain, styled({ color: new THREE.Color(0xe6dcb8), roughness: 0.6 }), GRAINS);
    for (const im of [this.wheat, this.heads, this.leaves, this.grains]) im.frustumCulled = false;
    S.add(this.wheat, this.heads, this.leaves, this.grains);
    // every plant a little different: height, and the colour (stems green-straw to straw, ears pale to ripe)
    const cS = new THREE.Color(), cA = new THREE.Color(0x9fa48a), cB = new THREE.Color(0xcfc29c), cE0 = new THREE.Color(0xd8cfaa), cE1 = new THREE.Color(0xf0e2b8);
    for (let i = 0; i < N; i++) {
      this.stalkBase.push(0.55 + 0.45 * R());
      const k = R();
      this.wheat.setColorAt(i, cS.copy(cA).lerp(cB, k));
      this.heads.setColorAt(i, cS.copy(cE0).lerp(cE1, R()).multiplyScalar(0.85 + 0.15 * k));
      this.leaves.setColorAt(i * 2, cS.copy(cA).lerp(cB, k * 0.6).multiplyScalar(0.9));
      this.leaves.setColorAt(i * 2 + 1, cS.copy(cA).lerp(cB, k * 0.8));
    }

    // the station at the far end of the field: the lattice mast with its anemometer and vane, the
    // Stevenson screen, the radar house
    this.station = buildStation(8, -86);
    this.cups = this.station.cups;
    S.add(this.station.group);
    // flying fragments: ice from the hailstones, porcelain from the plate (one pool)
    this.shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.28, 0), styled({ color: new THREE.Color(0xf2f5f6), roughness: 0.2, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.15 }), SHARDS);
    this.shards.frustumCulled = false;
    S.add(this.shards);

    // the hail: one stone per solo note from bar 10, landing on the note where its pitch grows
    const hg = hailGeometry(); hg.scale(1.1, 1.1, 1.1);
    this.hail = new THREE.InstancedMesh(hg, styled({ color: new THREE.Color(0xf4f7f8), roughness: 0.15, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.2 }), 260);
    this.hail.frustumCulled = false;
    S.add(this.hail);
    for (const n of this.solo) {
      if (n.t < b(10) - 0.01 || n.t >= b(20)) continue;
      const col = colOf(n.p);
      const z = lerp(FIELD_Z0 - 6, FIELD_Z1 + 20, hash(n.t, n.p, 3));
      this.stones.push({ n, x: colX(col) + (hash(n.t, 7) - 0.5) * 2, z, col });
      this.cuts.push({ t: n.t, col });
    }

    // the solo violin lies in the wheat in front (its close-ups); its bow takes the solo's notes
    this.fiddle = new Fiddle([55, 62, 69, 76], 1.0, '#c9c9c4');
    this.fiddle.group.rotation.set(-Math.PI / 2, 0, 0.55);
    this.fiddle.group.position.set(-26, 4.5, 40);
    S.add(this.fiddle.group);
    this.fiddle.group.updateMatrixWorld(true);
    this.fiddleM.copy(this.fiddle.group.matrixWorld);

    // the cracks in the glaze: radial rays from the impact, jagged (short steps, small turns), branching
    // thinner as they go; then the ring fractures between neighbouring rays (a spider's web), later
    const Rc = mulberry32(315);
    const c0 = this.ctx.start + 0.06;
    const ray = (x: number, z: number, a: number, len: number, w: number, t0: number, t1: number, depth: number) => {
      const pts: [number, number][] = [[x, z]];
      let cx = x, cz = z, ca = a, run = 0;
      while (run < len) {
        ca += (Rc() - 0.5) * 0.42;
        const l = 0.5 + Rc() * 0.9;
        cx += Math.cos(ca) * l; cz += Math.sin(ca) * l; run += l;
        pts.push([cx, cz]);
        if (depth > 0 && run > 4 && Rc() < 0.05) {
          const at = lerp(t0, t1, run / len);
          ray(cx, cz, ca + (Rc() < 0.5 ? 1 : -1) * (0.45 + Rc() * 0.6), len * (0.25 + Rc() * 0.3), w * 0.55, at, at + (t1 - t0) * 0.6, depth - 1);
        }
      }
      this.cracks.push({ pts, t0, t1, w });
      return pts;
    };
    const NR = 15;
    for (let k = 0; k < NR; k++) {
      const a = (k / NR) * Math.PI * 2 + (Rc() - 0.5) * 0.3;
      ray(IMPACT[0], IMPACT[1], a, 34 + Rc() * 30, 0.16, c0 + 0.02 * Rc(), c0 + 0.9 + Rc() * 0.7, 2);
    }
    // ring fractures at three radii, a jagged arc from each ray to the next
    for (const [rad, dt] of [[4.5, 0.35], [10, 0.7], [17, 1.05], [26, 1.4]] as const) {
      for (let k = 0; k < NR; k++) {
        if (Rc() < 0.2) continue;
        const a0 = (k / NR) * Math.PI * 2, a1 = ((k + 1) / NR) * Math.PI * 2;
        const pts: [number, number][] = [];
        const steps = 5 + Math.floor(rad / 3);
        for (let i = 0; i <= steps; i++) {
          const a = lerp(a0, a1, i / steps), r = rad * (1 + (Rc() - 0.5) * 0.12);
          pts.push([IMPACT[0] + Math.cos(a) * r, IMPACT[1] + Math.sin(a) * r]);
        }
        this.cracks.push({ pts, t0: c0 + dt + Rc() * 0.2, t1: c0 + dt + 0.35 + Rc() * 0.3, w: 0.07 });
      }
    }

    // lightning on the sforzandi (bars 10, 12, 14, 16) and the strike on 20
    const Rb = mulberry32(1676);
    const bolt = (t: number, x: number, z: number, big: boolean): Bolt => {
      const pts: [number, number, number][][] = [];
      const trunk: [number, number, number][] = [];
      let px = x + (Rb() - 0.5) * 30, py = 140, pz = z;
      trunk.push([px, py, pz]);
      while (py > 0) {
        py -= 6 + Rb() * 8; px += (Rb() - 0.5) * 10; pz += (Rb() - 0.5) * 4;
        trunk.push([px, Math.max(0, py), pz]);
        if (Rb() < 0.42 && py > 20) {
          // a branch, forking once more itself
          const br: [number, number, number][] = [[px, py, pz]];
          let bx = px, by = py, bz = pz;
          const dir = Rb() < 0.5 ? -1 : 1;
          for (let i = 0; i < 4 + Rb() * 6; i++) {
            by -= 3 + Rb() * 6; bx += dir * (2 + Rb() * 6); bz += (Rb() - 0.5) * 3; br.push([bx, by, bz]);
            if (Rb() < 0.25) {
              const tw: [number, number, number][] = [[bx, by, bz]];
              let tx = bx, ty = by, tz = bz;
              for (let j = 0; j < 3 + Rb() * 3; j++) { ty -= 2 + Rb() * 4; tx += -dir * (1 + Rb() * 4); tz += (Rb() - 0.5) * 2; tw.push([tx, ty, tz]); }
              pts.push(tw);
            }
          }
          pts.push(br);
        }
      }
      pts.unshift(trunk);
      return { t, pts, big };
    };
    for (const [bar, x] of [[10, -40], [12, 50], [14, -10], [16, 30]] as const) this.bolts.push(bolt(b(bar), x, -110, false));
    this.bolts.push(bolt(b(20), 4, -70, true));
    // with each bolt a crawler: lightning spreading sideways through the cloud base, forking as it goes
    for (const bo of this.bolts) {
      const pts: [number, number, number][][] = [];
      const [sx, sy, sz] = bo.pts[0]![0]!;
      for (const dir of [-1, 1]) {
        const path: [number, number, number][] = [[sx, sy, sz]];
        let x = sx, y = sy, z = sz;
        for (let i = 0; i < 14; i++) {
          x += dir * (6 + Rb() * 10); y += (Rb() - 0.5) * 7; z += (Rb() - 0.5) * 10; path.push([x, y, z]);
          if (Rb() < 0.35) {
            const f: [number, number, number][] = [[x, y, z]];
            let fx = x, fy = y, fz = z;
            for (let j = 0; j < 4; j++) { fx += dir * (3 + Rb() * 6); fy += (Rb() - 0.6) * 8; fz += (Rb() - 0.5) * 6; f.push([fx, fy, fz]); }
            pts.push(f);
          }
        }
        pts.push(path);
      }
      this.crawls.push({ t: bo.t, pts });
    }

    // the camera: establish (the plate, then the field and the station) before any close-up
    const fv = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(this.fiddleM).toArray() as [number, number, number];
    const s = this.ctx.start;
    this.keys = [
      // bars 1-2: straight down onto the plate as it cracks, rising and tilting up
      { t: s, eye: [0.5, 46, 13], at: [0, 0, 12], roll: 0.2, fov: 40 },
      { t: b(2), eye: [0, 40, 30], at: [0, 0, 4], roll: 0.1, fov: 42 },
      // bars 3-4: the field and the station, wide
      { t: b(3), eye: [0, 18, 74], at: [4, 10, -60], roll: 0, fov: 46 },
      { t: b(5) - 0.05, eye: [0, 15, 64], at: [4, 11, -60], roll: 0, fov: 45 },
      // bar 5 (silence): the barometer card over a held frame
      { t: b(5), eye: [0, 15, 63], at: [4, 11, -60], roll: 0, fov: 45 },
      { t: b(6) - 0.05, eye: [0, 15, 62], at: [4, 11, -60], roll: 0, fov: 45 },
      // bars 6-7: low across the field from the side, the forecast on the sky
      { t: b(6), eye: [-78, 7, 26], at: [10, 9, -40], roll: 0.03, fov: 42 },
      { t: b(8) - 0.05, eye: [-66, 8, 18], at: [14, 10, -44], roll: 0.03, fov: 42 },
      // bars 8-9: close-up, the solo violin's bow hacking the tremolo
      { t: b(8), eye: fv(18, 34, 26), at: fv(0, 20, 3), roll: 0.45, fov: 34 },
      { t: b(10) - 0.05, eye: fv(14, 30, 20), at: fv(0, 20, 3), roll: 0.4, fov: 32 },
      // bars 10-11: ff, the hail, wide and low
      { t: b(10), eye: [0, 9, 80], at: [0, 12, -50], roll: 0, fov: 50 },
      { t: b(12) - 0.05, eye: [0, 11, 70], at: [0, 12, -50], roll: 0, fov: 48 },
      // bars 12-13: down in the stalks as the stones cut them
      { t: b(12), eye: [-12, 3.5, 34], at: [6, 4, 0], roll: -0.06, fov: 40 },
      { t: b(14) - 0.05, eye: [-4, 3.5, 30], at: [10, 4, -4], roll: -0.04, fov: 40 },
      // bars 14-15: high over the field, rows going down
      { t: b(14), eye: [0, 52, 86], at: [0, 0, -18], roll: 0, fov: 46 },
      { t: b(16) - 0.05, eye: [6, 46, 80], at: [2, 0, -20], roll: 0.02, fov: 46 },
      // bars 16-17: down at the ears, the stones landing, the lightning behind the station
      { t: b(16), eye: [18, 2.6, 22], at: [6, 6, -40], roll: 0.05, fov: 44 },
      { t: b(18) - 0.05, eye: [10, 2.8, 16], at: [2, 7, -40], roll: 0.03, fov: 44 },
      // bars 18-20: pull back, the whole field cut down, the strike
      { t: b(18), eye: [0, 12, 72], at: [0, 12, -50], roll: 0, fov: 48 },
      { t: this.ctx.end, eye: [0, 20, 106], at: [0, 16, -60], roll: 0, fov: 50 },
    ];
  }

  camera(t: number, shake: number) {
    const k = this.keys;
    let i = 0;
    while (i + 1 < k.length && t >= k[i + 1]!.t) i++;
    const a = k[i]!, z = k[Math.min(i + 1, k.length - 1)]!;
    const u = z.t - a.t < 0.06 ? 0 : ease.inOutQuad(Math.min(1, (t - a.t) / Math.max(1e-3, z.t - a.t)));
    const L = (x: number[], y: number[]) => new THREE.Vector3(lerp(x[0]!, y[0]!, u), lerp(x[1]!, y[1]!, u), lerp(x[2]!, y[2]!, u));
    const eye = L(a.eye, z.eye), at = L(a.at, z.at);
    eye.x += noise1(t * 0.6, 4) * 0.5 + noise1(t * 30, 1) * shake;
    eye.y += noise1(t * 0.5, 5) * 0.3 + noise1(t * 30, 2) * shake;
    this.st.look(eye, at, lerp(a.roll ?? 0, z.roll ?? 0, u), lerp(a.fov ?? 40, z.fov ?? 40, u));
  }

  /** Lightning: 0..1 brightness at t (two quick flickers), and which bolt. */
  flash(t: number) {
    let f = 0, bolt: Bolt | null = null;
    for (const bo of this.bolts) {
      const a = t - bo.t;
      if (a < -0.01 || a > 0.6) continue;
      const v = a < 0 ? 0 : Math.max(pulse(t, bo.t, 0.05), 0.7 * pulse(t, bo.t + 0.09, 0.04)) * (bo.big ? 1 : 0.8);
      if (v > f) { f = v; bolt = bo; }
    }
    return { f, bolt };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, b = this.b;
    const hailOn = t >= b(10) - 0.5 && t < b(20) + 0.5;
    const { f: fl, bolt } = this.flash(t);
    const loud = Math.max(0, ...this.stones.map((s) => pulse(t, s.n.t, 0.06))) * (t < b(20) ? 1 : 0);
    this.camera(t, 0.5 * loud + 2.5 * fl);

    // the ground goes from the plate's white to the field's earth over the first bars
    const earth = prog(t, this.ctx.start + 0.4, b(3), ease.inOutCubic);
    this.groundMat.color.setRGB(lerp(0.88, 0.16, earth), lerp(0.88, 0.17, earth), lerp(0.88, 0.16, earth), THREE.SRGBColorSpace);
    // the wheat grows up out of the earth once the plate has broken (bars 2-3)
    const gw = prog(t, b(2) - 0.1, b(3) + 0.4, ease.outCubic);
    this.wheat.visible = this.heads.visible = gw > 0.001;

    // the spectrum: each column's energy from the notes sounding in its band
    const energy = new Float32Array(COLS);
    for (const n of this.all) {
      if (n.t > t || t > n.t + n.d + 0.35) continue;
      const k = t < n.t + n.d ? 1 : 1 - (t - n.t - n.d) / 0.35;
      const c = colOf(n.p);
      const v = (n.v / 127) * k * (0.6 + 0.4 * pulse(t, n.t, 0.08));
      for (let d = -3; d <= 3; d++) { const cc = c + d; if (cc >= 0 && cc < COLS) energy[cc] = Math.max(energy[cc]!, v * Math.exp(-d * d / 5)); }
    }
    // cut columns: once a hailstone lands in a column, the stalks there are snapped short
    const cut = new Float32Array(COLS);
    for (const c of this.cuts) if (t >= c.t) cut[c.col] = Math.min(1, cut[c.col]! + 0.34 * prog(t, c.t, c.t + 0.12));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const wind = 0.08 + 0.25 * prog(t, b(6), b(10)) + 0.15 * (hailOn ? 1 : 0);
    // gusts that follow the music: the level drives waves rolling across the field downwind (+x); each
    // lightning flash throws one more
    const gust = (0.04 + 0.32 * f.a.rms * prog(t, b(3), b(4))) * (1 - prog(t, b(20) + 0.2, this.tEnd)) + 0.25 * fl;
    const q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), e2 = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0);
    for (let c = 0; c < COLS; c++) {
      const x0 = colX(c);
      for (let r = 0; r < ROWS; r++) {
        const i = c * ROWS + r;
        const z = lerp(FIELD_Z0, FIELD_Z1, r / (ROWS - 1)) + (hash(i, 2) - 0.5) * 1.6;
        const x = x0 + (hash(i, 1) - 0.5) * 1.6;
        const tall = gw * (1.8 + 15 * energy[c]! ** 1.3) * this.stalkBase[i]!;
        const grow = tall * (1 - 0.72 * cut[c]!);
        const wave = 0.5 + 0.5 * Math.sin(x * 0.055 + z * 0.02 - t * 2.4 + hash(i, 9) * 0.6);
        const sway = wind * (noise1(t * 1.3 + x * 0.05 + z * 0.03, 11) + 0.6) + gust * wave * wave
          + energy[c]! * 0.05 * Math.sin(t * 9 + r) + 0.08 * (hash(i, 3) - 0.5);
        e.set(sway * 0.35 + 0.06 * (hash(i, 4) - 0.5), 0, -sway); q.setFromEuler(e);
        const yaw = hash(i, 6) * Math.PI * 2;
        pos.set(x, 0, z); scl.set(1, Math.max(0.01, grow), 1);
        this.wheat.setMatrixAt(i, m.compose(pos, q, scl));
        // the ear on top, nodding under its weight and the wind; a cut stalk loses it
        const lost = cut[c]! > 0.3 && hash(i, 5) < cut[c]! ? 0 : 1;
        const top = new THREE.Vector3(0, grow, 0).applyQuaternion(q).add(pos);
        const tip = new THREE.Vector3(0, tall, 0).applyQuaternion(q).add(pos);
        this.earTop[i * 3] = tip.x; this.earTop[i * 3 + 1] = tip.y; this.earTop[i * 3 + 2] = tip.z;
        e2.set(0, 0, -0.5 * sway - 0.12 - 0.1 * hash(i, 7)); q2.setFromEuler(e2);
        q3.setFromAxisAngle(up, yaw);
        const es = lost * gw * (0.85 + 0.3 * hash(i, 8));
        this.heads.setMatrixAt(i, m.compose(top, q.clone().multiply(q2).multiply(q3), scl.set(es, es, es)));
        // two leaves at the lower nodes, fluttering; they keep their size whatever the stem does
        const ls = gw * clamp(tall / 5, 0.35, 1.1);
        for (let l = 0; l < 2; l++) {
          const node = new THREE.Vector3(0, grow * (l ? 0.47 : 0.24), 0).applyQuaternion(q).add(pos);
          e2.set(0.35 * Math.sin(t * (5 + 3 * hash(i, l)) + i) * (wind + gust), yaw + l * (Math.PI + 0.6), 0, 'YXZ'); q2.setFromEuler(e2);
          this.leaves.setMatrixAt(i * 2 + l, m.compose(node, q.clone().multiply(q2), scl.set(ls, ls * (0.8 + 0.4 * hash(i, l + 3)), ls)));
        }
      }
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    this.wheat.instanceMatrix.needsUpdate = true; this.heads.instanceMatrix.needsUpdate = true;

    // hailstones in flight: dropped from the clouds, landing on their note
    let hi = 0;
    for (const s of this.stones) {
      const a = t - s.n.t;
      if (a < -0.45 || a > 0.25 || hi >= 260) continue;
      const y = a < 0 ? 70 * (-a / 0.45) ** 1.6 + 0.5 : 0.5 + 2.5 * Math.abs(Math.sin(a * 22)) * Math.exp(-a * 14);
      const sc = a > 0.15 ? 1 - (a - 0.15) / 0.1 : 1;
      e.set(t * 7 + s.n.p, t * 5, 0); q.setFromEuler(e);
      this.hail.setMatrixAt(hi++, m.compose(pos.set(s.x + (a < 0 ? -a * 8 : 0), y, s.z), q, scl.setScalar(Math.max(0.01, sc))));
    }
    for (let k = hi; k < 260; k++) this.hail.setMatrixAt(k, m.makeScale(0, 0, 0));
    this.hail.count = 260; this.hail.instanceMatrix.needsUpdate = true;

    // the anemometer: turning faster as the wind rises (its angle is the integral of a rising rate)
    const tt = t - this.ctx.start;
    this.cups.rotation.y = tt * 2 + tt * tt * 0.35;
    this.station.vane.rotation.y = 0.5 + 0.35 * noise1(tt * 0.7, 6) + 0.12 * Math.sin(tt * 5.3) * prog(t, b(6), b(10));

    // the plate fades into the field as the wheat comes up; the sky scrolls with the wind, lit by the lightning
    const plateA = 1 - prog(t, b(2) + 0.1, b(3) + 0.1, ease.inOutCubic);
    this.plate.visible = plateA > 0.002;
    this.plateMat.opacity = plateA;
    this.skyTex.offset.x = tt * 0.004 + tt * tt * 0.0004;
    const gloom = 0.75 - 0.3 * prog(t, b(3), b(10));
    this.skyMat.color.setScalar((0.9 * gloom + 3.2 * fl) * (1 - prog(t, b(20) + 0.3, this.tEnd)));
    // (the sheet lightning and the gold are added below, with the cloud layers)
    this.fog.color.setRGB(0.012 + 0.2 * fl, 0.016 + 0.22 * fl, 0.017 + 0.22 * fl);

    // fragments in flight: porcelain chips off the first impact, ice off every hailstone that lands
    let si = 0;
    const put = (x: number, y: number, z: number, rx: number, ry: number, sc: number) => {
      if (si >= SHARDS) return;
      e.set(rx, ry, rx * 0.7); q.setFromEuler(e);
      this.shards.setMatrixAt(si++, m.compose(pos.set(x, y, z), q, scl.setScalar(Math.max(0.001, sc))));
    };
    const chip0 = this.ctx.start + 0.06;
    if (t >= chip0 && t < chip0 + 1.4) {
      const a = t - chip0;
      for (let k = 0; k < 70; k++) {
        const h1 = hash(k, 11), h2 = hash(k, 12), h3 = hash(k, 13);
        const ang = h1 * Math.PI * 2, vh = 4 + 12 * h2, vy = 9 + 18 * h3;
        const y = Math.max(0.1, vy * a - 22 * a * a);
        put(IMPACT[0] + Math.cos(ang) * vh * a, y, IMPACT[1] + Math.sin(ang) * vh * a, t * (3 + 6 * h1), t * (2 + 5 * h2), (0.5 + 1.1 * h3) * (1 - prog(a, 0.9, 1.4)));
      }
    }
    for (const st of this.stones) {
      const a = t - st.n.t;
      if (a < 0 || a > 0.7) continue;
      for (let k = 0; k < 9; k++) {
        const h1 = hash(st.n.t, k, 1), h2 = hash(st.n.t, k, 2), h3 = hash(st.n.t, k, 3);
        const ang = h1 * Math.PI * 2, vh = 3 + 8 * h2, vy = 5 + 9 * h3;
        const y = Math.max(0.12, vy * a - 30 * a * a);
        put(st.x + Math.cos(ang) * vh * a, y, st.z + Math.sin(ang) * vh * a, t * 9 + k, t * 7, (0.4 + 0.7 * h2) * (1 - a / 0.7));
      }
    }
    for (let k = si; k < SHARDS; k++) this.shards.setMatrixAt(k, m.makeScale(0, 0, 0));
    this.shards.instanceMatrix.needsUpdate = true;

    // the ears the hail breaks shatter: their grains thrown out from the strike and downwind, tumbling,
    // bouncing once, lying in the earth
    let gi = 0;
    for (const st of this.stones) {
      const a = t - st.n.t;
      if (a < 0 || a > 1.6) continue;
      for (let r = 0; r < ROWS && gi < GRAINS; r++) {
        if (Math.abs(lerp(FIELD_Z0, FIELD_Z1, r / (ROWS - 1)) - st.z) > 5) continue;
        const i = st.col * ROWS + r;
        const x0 = this.earTop[i * 3]!, y0 = this.earTop[i * 3 + 1]! + 1.0, z0 = this.earTop[i * 3 + 2]!;
        for (let k = 0; k < 12 && gi < GRAINS; k++) {
          const h1 = hash(i, k, 71), h2 = hash(i, k, 72), h3 = hash(i, k, 73);
          const dx = x0 - st.x + (h1 - 0.5) * 3, dz = z0 - st.z + (h2 - 0.5) * 3, dl = Math.hypot(dx, dz) || 1;
          const v = 3 + 7 * h3, vx = (dx / dl) * v + 5, vz = (dz / dl) * v, vy = 2 + 8 * h1;
          const land = (vy + Math.sqrt(vy * vy + 44 * Math.max(0, y0 - 0.1))) / 22;
          const ta = Math.min(a, land);
          const y = a < land ? y0 + vy * a - 11 * a * a : 0.1 + Math.max(0, 0.6 * Math.sin((a - land) * 14) * Math.exp(-(a - land) * 9));
          e.set(ta * (9 + 9 * h1), ta * (7 + 5 * h2), 0); q.setFromEuler(e);
          const sc = 1.1 * (1 - prog(a, 1.25, 1.6));
          this.grains.setMatrixAt(gi++, m.compose(pos.set(x0 + vx * ta, y, z0 + vz * ta), q, scl.setScalar(Math.max(0.001, sc))));
        }
      }
    }
    for (let k = gi; k < GRAINS; k++) this.grains.setMatrixAt(k, m.makeScale(0, 0, 0));
    this.grains.instanceMatrix.needsUpdate = true;

    // the golden hour before the storm (bars 2-8), drowned by bar 10; its beam sweeping across the field
    const golden = prog(t, b(2), b(3) + 0.3) * (1 - prog(t, b(7), (b(9) + b(10)) / 2, ease.inOutCubic));
    this.golden.intensity = 3.2 * golden;
    const sw = prog(t, b(3), (b(9) + b(10)) / 2, ease.inOutQuad);
    const sweepAt = new THREE.Vector3(lerp(-80, 80, sw), 0, lerp(30, -50, sw) + 10 * Math.sin(sw * 5));
    this.sweep.target.position.copy(sweepAt); this.sweep.target.updateMatrixWorld();
    this.sweep.intensity = 6 * golden;
    (this.sun.material as THREE.SpriteMaterial).color.setScalar(0.75 * golden);
    this.sun.visible = golden > 0.004;
    // sheet lightning in the clouds: a flicker of two or three pulses
    let sheet = 0;
    const glowAt: [number, number, number, number, number][] = []; // x, y, z, size, intensity
    for (const sh of this.sheets) {
      const a = t - sh.t;
      if (a < 0 || a > 0.45) continue;
      const v = sh.s * Math.max(pulse(t, sh.t, 0.05), 0.7 * pulse(t, sh.t + 0.11, 0.05), 0.5 * pulse(t, sh.t + 0.24, 0.06));
      sheet = Math.max(sheet, v);
      glowAt.push([sh.x, sh.y, sh.z, 300, 2.2 * v]);
    }
    for (const bo of this.bolts) {
      const a = t - bo.t;
      if (a < -0.01 || a > 0.9) continue;
      const [sx, sy, sz] = bo.pts[0]![0]!;
      glowAt.push([sx, sy + 10, sz, bo.big ? 420 : 300, (a < 0.25 ? 3 * fl : 0) + 0.6 * Math.exp(-a * 4)]);
    }
    this.glows.forEach((g, k) => {
      const v = glowAt[k];
      g.visible = !!v && v[4] > 0.01;
      if (!v) return;
      g.position.set(v[0], v[1], v[2]); g.scale.set(v[3], v[3] * 0.6, 1);
      (g.material as THREE.SpriteMaterial).color.setRGB(0.9 * v[4], 0.95 * v[4], 1.0 * v[4]);
    });
    // the cloud layers drift, take the gold before the storm, flare with the lightning
    const lit = 2.6 * fl + 1.6 * sheet;
    const end = 1 - prog(t, b(20) + 0.3, this.tEnd);
    for (const L of this.layers) {
      L.tex.offset.x = tt * L.speed + tt * tt * L.speed * 0.08;
      const v = L.base * 0.85 * gloom;
      L.mat.color.setRGB((v + 0.22 * golden + lit) * end, (v + 0.2 * golden + lit) * end, (v + 0.17 * golden + lit * 1.05) * end);
      L.mat.opacity = 0.55 + 0.4 * prog(t, b(3), b(10));
    }
    // brass catching the light: the anemometer's cups as they turn, the vane, the finial
    this.station.brass.emissiveIntensity = 0.6 * fl + 0.25 * golden;

    // the solo violin's bow (the violin is only shown in its close-up: in the wide shots it would be a giant in the wheat)
    this.fiddle.group.visible = t >= b(8) - 0.02 && t < b(10);
    const en = this.fiddle.play(t, this.solo);

    this.st.key.intensity = 2.2 + 6 * fl;
    this.st.rim.intensity = 1.2 + 8 * fl;
    this.st.rim.color.setRGB(...LIN.bone, THREE.LinearSRGBColorSpace); // neutral: a cobalt rim against the warm light turned the awns pink
    this.bg.render(renderer, out, t, 0, 0.6 * fl);
    renderer.setRenderTarget(out);
    renderer.render(this.skyScene, this.st.cam);
    this.st.render(renderer, out);
    this.strings.clear();
    if (this.fiddle.group.visible) this.fiddle.drawStrings(this.strings, this.fiddleM, t, en);
    this.strings.render(renderer, out, this.st.cam);

    // the cracks in the glaze: a dark line, tapering, with a pale lip beside it (the broken glaze's edge)
    const I = this.ink; I.clear();
    const crackA = this.plate.visible ? plateA : 0;
    if (crackA > 0) {
      for (const cr of this.cracks) {
        const k = prog(t, cr.t0, cr.t1, ease.outCubic);
        if (k <= 0) continue;
        const n = cr.pts.length - 1, upto = k * n;
        for (let i = 0; i < n && i < upto; i++) {
          const [ax, az] = cr.pts[i]!, [bx0, bz0] = cr.pts[i + 1]!;
          const u = Math.min(1, upto - i);
          const ex = lerp(ax, bx0, u), ez = lerp(az, bz0, u);
          const w = cr.w * (1 - 0.7 * (i / (n + 1))) + 0.02;
          // the lip: offset across the crack
          const dx = ez - az, dz = -(ex - ax), dl = Math.hypot(dx, dz) || 1;
          const ox = (dx / dl) * w * 0.9, oz = (dz / dl) * w * 0.9;
          I.seg(ax + ox, 0.07, az + oz, ex + ox, 0.07, ez + oz, w * 0.6, LIN.bone[0] * 1.3, LIN.bone[1] * 1.3, LIN.bone[2] * 1.3, crackA * 0.8);
          I.seg(ax, 0.08, az, ex, 0.08, ez, w, LIN.ink[0], LIN.ink[1], LIN.ink[2], crackA);
        }
      }
    }
    I.render(renderer, out, this.st.cam);

    // light: splash rings where the stones land, the lightning bolts
    const X = this.fx; X.clear();
    for (const s of this.stones) {
      const a = t - s.n.t;
      if (a < 0 || a > 0.6) continue;
      const r = 1.2 + a * 14, g = 1.8 * (1 - a / 0.6);
      for (let k = 0; k < 20; k++) {
        const a0 = (k / 20) * Math.PI * 2, a1 = ((k + 1) / 20) * Math.PI * 2;
        X.seg(s.x + Math.cos(a0) * r, 0.1, s.z + Math.sin(a0) * r, s.x + Math.cos(a1) * r, 0.1, s.z + Math.sin(a1) * r, 0.25, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
      }
    }
    // spray off each landing stone: short bright streaks
    for (const st of this.stones) {
      const a = t - st.n.t;
      if (a < 0 || a > 0.35) continue;
      for (let k = 0; k < 10; k++) {
        const ang = hash(st.n.t, k, 21) * Math.PI * 2, v = 6 + 10 * hash(st.n.t, k, 22);
        const x = st.x + Math.cos(ang) * v * a, z = st.z + Math.sin(ang) * v * a, y = 0.3 + (8 * a - 30 * a * a) * (0.5 + hash(k, st.n.t));
        const g = 1.6 * (1 - a / 0.35);
        X.seg(x, Math.max(0.1, y), z, x - Math.cos(ang) * 0.6, Math.max(0.1, y - 0.2), z - Math.sin(ang) * 0.6, 0.07, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
      }
    }
    // the first impact on the plate: a flash ring
    {
      const a = t - (this.ctx.start + 0.06);
      if (a >= 0 && a < 0.5) {
        const r = 0.5 + a * 34, g = 3 * (1 - a / 0.5);
        for (let k = 0; k < 48; k++) {
          const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
          X.seg(IMPACT[0] + Math.cos(a0) * r, 0.2, IMPACT[1] + Math.sin(a0) * r, IMPACT[0] + Math.cos(a1) * r, 0.2, IMPACT[1] + Math.sin(a1) * r, 0.35, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
        }
      }
    }
    // rain: slanted streaks through the field, gathering from bar 6, a downpour with the hail
    const rain = prog(t, b(6), b(10)) * 0.6 + 0.4 * (hailOn ? 1 : 0) * (1 - prog(t, b(20), b(20) + 0.6));
    if (rain > 0.01) {
      const NRn = Math.round(1400 * rain);
      for (let i = 0; i < NRn; i++) {
        const h1 = hash(i, 31), h2 = hash(i, 32), h3 = hash(i, 33);
        const x = -110 + 220 * h1, z = -120 + 230 * h2;
        const y = 90 - ((h3 * 90 + t * 80) % 90);
        const g = 0.35 * (0.5 + h3);
        X.seg(x, y, z, x + 1.0, y + 3.2, z + 0.3, 0.05, LIN.ash[0] * g, LIN.ash[1] * g, LIN.ash[2] * g, 1);
      }
    }
    // chaff: torn ears and husks flying downwind from every column the hail cuts, and loose seed on the wind
    for (const c of this.cuts) {
      const a = t - c.t;
      if (a < 0 || a > 1.4) continue;
      for (let k = 0; k < 6; k++) {
        const h1 = hash(c.t, k, 41), h2 = hash(c.t, k, 42), h3 = hash(c.t, k, 43);
        const x0 = colX(c.col) + (h1 - 0.5) * 3, z0 = lerp(FIELD_Z0, FIELD_Z1, h2);
        const x = x0 + (8 + 10 * h3) * a, y = 6 + (5 * h1) * a - 6 * a * a + 3 * h3, z = z0 + 2 * Math.sin(a * 6 + k);
        const g = 0.9 * (1 - a / 1.4);
        X.seg(x, Math.max(0.2, y), z, x + 0.5, Math.max(0.2, y + 0.15), z, 0.09, LIN.bone[0] * g, LIN.bone[1] * g * 0.92, LIN.bone[2] * g * 0.75, 1);
      }
    }
    const seed = prog(t, b(3), b(6)) * (1 - prog(t, b(20), b(20) + 0.6));
    if (seed > 0.01) {
      for (let i = 0; i < 260; i++) {
        const h1 = hash(i, 51), h2 = hash(i, 52), h3 = hash(i, 53);
        const x = -100 + ((h1 * 200 + tt * (14 + 18 * h2)) % 200), z = -90 + 150 * h2, y = 2 + 18 * h3 + 2 * noise1(tt * 0.9 + i, 7);
        const g = 0.45 * seed;
        X.seg(x, y, z, x + 0.35, y + 0.05, z, 0.07, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
      }
    }
    // glints: a four-pointed star (and a faint long cross) where light catches ice or brass
    const star = (x: number, y: number, z: number, size: number, g: number) => {
      if (g < 0.02) return;
      const cam = this.st.cam;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      for (const [d, l, w, k] of [[right, size, size * 0.08, 1], [upv, size, size * 0.08, 1], [right, size * 2.6, size * 0.03, 0.35], [upv, size * 2.6, size * 0.03, 0.35]] as const) {
        X.seg(x - d.x * l, y - d.y * l, z - d.z * l, x + d.x * l, y + d.y * l, z + d.z * l, w, LIN.bone[0] * g * k, LIN.bone[1] * g * k, LIN.bone[2] * g * k * 1.05, 1);
      }
    };
    // the hailstones glitter as they tumble down
    this.stones.forEach((st, k) => {
      const a = t - st.n.t;
      if (a < -0.45 || a > 0.25) return;
      if (hash(k, Math.floor(t * 24)) < 0.55) return;
      const y = a < 0 ? 70 * (-a / 0.45) ** 1.6 + 0.5 : 0.5 + 2.5 * Math.abs(Math.sin(a * 22)) * Math.exp(-a * 14);
      star(st.x + (a < 0 ? -a * 8 : 0) + 0.4, y + 0.5, st.z + 0.6, 1.1, 2.6 * (0.6 + 0.4 * hash(k, 5)) + 3 * fl);
    });
    // brass on the station
    {
      const wp = new THREE.Vector3();
      this.station.glints.forEach((g, k) => {
        g.getWorldPosition(wp);
        const spin = Math.pow(0.5 + 0.5 * Math.sin(this.cups.rotation.y * 1.0 + k * 2.09), 30);
        const near = Math.exp(-((wp.x - sweepAt.x) ** 2 + (wp.z - sweepAt.z) ** 2) / 3000);
        star(wp.x, wp.y, wp.z + 1, 2.2, (0.4 + 2.8 * golden) * spin + 3 * near * golden + 2.5 * fl);
      });
    }
    // rain curtains: sheets of faint streaks hanging from the cloud base far off, thickening from bar 5,
    // a wall with the hail; lit by the flashes
    {
      const end = 1 - prog(t, b(20) + 0.3, this.tEnd);
      const curtain = (0.15 + 0.4 * prog(t, b(5), b(10)) + 0.35 * (hailOn ? 1 : 0)) * end;
      this.veils.forEach((v, k) => {
        const dens = curtain * (0.5 + 0.5 * Math.sin(tt * 0.35 + k * 1.7) ** 2);
        const nS = Math.round(160 * dens);
        for (let i = 0; i < nS; i++) {
          const h1 = hash(k, i, 91), h2 = hash(k, i, 92), h3 = hash(k, i, 93);
          const x = v.x + (h1 - 0.5) * v.w * (1 - 0.3 * h3) + tt * 3, z = v.z + (h2 - 0.5) * 30;
          const y0 = 150 - ((h3 * 150 + t * 70) % 150), len = 10 + 18 * h2;
          const fall = 1 - y0 / 160;
          const g = (0.05 + 0.5 * fl + 0.2 * sheet) * (0.4 + 0.6 * h3) * (0.4 + 0.6 * fall);
          X.seg(x, y0, z, x + 2, Math.max(0, y0 - len), z, 0.35, LIN.ash[0] * g, LIN.ash[1] * g, LIN.ash[2] * g, 1);
        }
      });
    }
    // the beam through the cloud gap: a faint warm-white shaft from the sky to where it falls
    if (golden > 0.01) {
      const P0 = this.sweep.position;
      for (let k = 0; k < 9; k++) {
        const o = (k - 4) * 2.4, g = 0.012 * golden * Math.exp(-((k - 4) ** 2) / 8);
        X.seg(P0.x + o, P0.y, P0.z, sweepAt.x + o * 3, 0, sweepAt.z, 6, LIN.bone[0] * g * 1.05, LIN.bone[1] * g, LIN.bone[2] * g * 0.85, 1);
      }
    }
    // after every bolt: its channel glowing on, fading (afterglow), and sparks thrown from where it struck
    for (const bo of this.bolts) {
      const a = t - bo.t;
      if (a < 0.08 || a > 1.1) continue;
      const g = (bo.big ? 1.6 : 1.1) * Math.exp(-(a - 0.08) * 3.2);
      const trunk = bo.pts[0]!;
      for (let i = 0; i + 1 < trunk.length; i++) {
        const [ax, ay, az] = trunk[i]!, [bx1, by1, bz1] = trunk[i + 1]!;
        X.seg(ax, ay, az, bx1, by1, bz1, 2.2, LIN.bone[0] * g * 0.12, LIN.bone[1] * g * 0.14, LIN.bone[2] * g * 0.18, 1);
        X.seg(ax, ay, az, bx1, by1, bz1, 0.5, LIN.bone[0] * g * 0.6, LIN.bone[1] * g * 0.65, LIN.bone[2] * g * 0.75, 1);
      }
      const [gx, gy, gz] = trunk[trunk.length - 1]!;
      for (let k = 0; k < (bo.big ? 90 : 50); k++) {
        const h1 = hash(bo.t, k, 81), h2 = hash(bo.t, k, 82), h3 = hash(bo.t, k, 83);
        const life = 0.4 + 0.6 * h3, sa = a - 0.02;
        if (sa < 0 || sa > life) continue;
        const ang = h1 * Math.PI * 2, v = 12 + 30 * h2, vy = 8 + 22 * h3;
        const px = gx + Math.cos(ang) * v * sa, pz = gz + Math.sin(ang) * v * sa, py = Math.max(0.2, gy + 0.5 + vy * sa - 18 * sa * sa);
        const k2 = 4 * (1 - sa / life);
        X.seg(px, py, pz, px - Math.cos(ang) * v * 0.025, py - (vy - 36 * sa) * 0.025, pz - Math.sin(ang) * v * 0.025, 0.14, LIN.bone[0] * k2, LIN.bone[1] * k2 * 0.95, LIN.bone[2] * k2 * 0.85, 1);
      }
    }
    // the crawl through the cloud base with each bolt
    for (const cr of this.crawls) {
      const a = t - cr.t;
      if (a < -0.02 || a > 0.5) continue;
      const g = 5 * Math.max(pulse(t, cr.t, 0.06), 0.6 * pulse(t, cr.t + 0.1, 0.05)) + 0.5 * Math.exp(-a * 6);
      for (const path of cr.pts) {
        const upto = Math.min(path.length - 1, Math.floor((a + 0.02) * 90));
        for (let i = 0; i < upto; i++) {
          const [ax, ay, az] = path[i]!, [bx1, by1, bz1] = path[i + 1]!;
          X.seg(ax, ay, az, bx1, by1, bz1, 2.5, LIN.bone[0] * g * 0.08, LIN.bone[1] * g * 0.09, LIN.bone[2] * g * 0.12, 1);
          X.seg(ax, ay, az, bx1, by1, bz1, 0.45, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
        }
      }
    }
    // the lightning: a wide faint halo, a glow, the white-hot core; the branches thinner
    if (bolt && fl > 0.05) {
      const g = (bolt.big ? 9 : 6) * fl;
      for (const path of bolt.pts) for (let i = 0; i + 1 < path.length; i++) {
        const [ax, ay, az] = path[i]!, [bx1, by1, bz1] = path[i + 1]!;
        const w = (path === bolt.pts[0] ? 0.6 : path.length < 6 ? 0.16 : 0.3) * (bolt.big ? 1.4 : 1);
        X.seg(ax, ay, az, bx1, by1, bz1, w * 7, LIN.bone[0] * g * 0.012, LIN.bone[1] * g * 0.013, LIN.bone[2] * g * 0.018, 1);
        X.seg(ax, ay, az, bx1, by1, bz1, w * 2.5, LIN.bone[0] * g * 0.08, LIN.bone[1] * g * 0.085, LIN.bone[2] * g * 0.1, 1);
        X.seg(ax, ay, az, bx1, by1, bz1, w, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
      }
      // where it strikes the ground: a burst
      const trunk = bolt.pts[0]!;
      const [gx, , gz] = trunk[trunk.length - 1]!;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, r = 4 + 6 * hash(k, bolt.t);
        X.seg(gx, 0.5, gz, gx + Math.cos(a) * r, 0.5 + 2 * hash(bolt.t, k), gz + Math.sin(a) * r, 0.3, LIN.bone[0] * g * 0.6, LIN.bone[1] * g * 0.6, LIN.bone[2] * g * 0.6, 1);
      }
    }
    X.render(renderer, out, this.st.cam);

    this.drawHud(t, fl);
    comp.draw(renderer, this.T.upload(), out);

    // the grade: porcelain into storm over the first bars; the lightning inverts it for a frame or two
    const into = prog(t, this.ctx.start + 0.2, b(3), ease.inOutCubic);
    const inv = fl > 0.55 ? 1 : 0;
    const darkEnd = prog(t, b(20) + 0.35, this.tEnd - 0.05, ease.inOutCubic);
    const sh = 5 * loud + 14 * fl;
    return into < 1
      ? { ramp: 'porcelain', ramp2: 'storm', rampMix: into, grade: 1, gradeSteps: 4, hatch: 0.4 * into, halation: 0, bloom: 0.5, bloomThreshold: 1.1, grain: 0.06, vignette: 0.35, ca: 0.5 }
      : {
        ramp: 'storm', ramp2: 'stormFlash', rampMix: inv, grade: 1, gradeSteps: 4, hatch: 0.45,
        bloom: 0.8 + fl, bloomThreshold: 1.05, halation: 0, grain: 0.07, vignette: 0.45,
        shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], ca: 0.6 * fl, zoom: 1 + 0.02 * fl, // no CA at rest: the dense awns fringe magenta toward the edges
        fade: t >= this.tEnd - 0.05 ? 1 : 0.92 * darkEnd,
      };
  }

  // ------------------------------------------------------------------ the instruments, in 2D
  drawHud(t: number, fl: number) {
    const T = this.T; T.clear();
    const c = T.ctx, b = this.b;
    const show = prog(t, b(2) + 0.3, b(3)) * (1 - prog(t, b(20) + 0.2, b(20) + 0.6));
    if (show > 0) {
      c.globalAlpha = show;
      this.readouts(c, t);
      this.scope(c, t, 80, H - 250, 560, 160);
      if (t >= b(14) && t < b(20)) this.radar(c, t, W - 330, 300, 190, prog(t, b(14), b(14) + 0.3) * (1 - prog(t, b(18) - 0.3, b(18))));
      if (t >= b(6) && t < b(8)) this.forecast(c, t, W - 720, 110, 620, 300, prog(t, b(6), b(6) + 0.3) * (1 - prog(t, b(8) - 0.25, b(8))));
      if (t >= b(17) && t < b(20)) this.forecast(c, t, W - 720, 110, 620, 300, prog(t, b(17), b(17) + 0.3) * (1 - prog(t, b(20) - 0.2, b(20))));
      c.globalAlpha = 1;
    }
    // bar 5: the silence is the barometer, full frame
    const baro = prog(t, b(5), b(5) + 0.12) * (1 - prog(t, b(6) - 0.12, b(6)));
    if (baro > 0) {
      c.globalAlpha = baro * 0.82; c.fillStyle = rgba('ink', 1); c.fillRect(0, 0, W, H);
      c.globalAlpha = baro; this.barometer(c, t, W / 2, H / 2 + 20, 330);
      c.globalAlpha = 1;
    }
    // the sonnet, lit by the lightning (and lingering faintly between strikes)
    if (t >= b(10) - 0.02 && t < b(17)) {
      const a = Math.min(1, 1.25 * fl) + 0.16 * prog(t, b(10), b(10) + 0.3) * (1 - prog(t, b(16) + 0.6, b(17)));
      if (a > 0.01) {
        c.globalAlpha = a;
        c.textAlign = 'center'; c.fillStyle = rgba('bone', 1);
        c.font = font(F.serif(400, true), 92);
        c.fillText('Tuona e fulmina il ciel e grandinoso', W / 2, H * 0.36);
        c.font = font(F.mono(400), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 1);
        c.fillText('A. VIVALDI · SONETTO DIMOSTRATIVO · L’ESTATE · III', W / 2, H * 0.36 + 56);
        c.letterSpacing = '0px'; c.globalAlpha = 1;
      }
    }
    // the plate's title while it cracks
    const ti = prog(t, this.ctx.start + 0.3, this.ctx.start + 0.8) * (1 - prog(t, b(3) - 0.2, b(3) + 0.2));
    if (ti > 0) {
      c.globalAlpha = ti; c.textAlign = 'left';
      c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 1);
      c.fillText('A. VIVALDI · LE QUATTRO STAGIONI · L’ESTATE · RV 315 · 1725', 120, H - 210);
      c.letterSpacing = '0px';
      c.font = font(F.serif(400, true), 96);
      const s = 'Presto.';
      c.fillText(s.slice(0, Math.ceil(s.length * prog(t, this.ctx.start + 0.4, this.ctx.start + 1.0))), 110, H - 110);
      c.globalAlpha = 1;
    }
  }

  /** Deadpan station readouts, top-left. */
  readouts(c: CanvasRenderingContext2D, t: number) {
    const b = this.b;
    const p = this.pressure(t);
    const windMs = 4 + 27 * prog(t, b(3), b(10)) + 6 * prog(t, b(10), b(20));
    const hailP = t < b(10) ? 0.08 + 0.8 * prog(t, b(6), b(10), ease.inCubic) : 0.97;
    const landed = this.stones.filter((s) => s.n.t <= t).length;
    c.textAlign = 'left'; c.font = font(F.mono(400), 17); c.letterSpacing = '1px';
    const lines = [
      `STAZIONE METEO  ·  VENEZIA  ·  1725`,
      `pressure   ${p.toFixed(1)} hPa  ${t > b(3) ? '↓' : '·'}`,
      `wind       ${windMs.toFixed(1)} m/s`,
      `p(hail)    ${hailP.toFixed(2)}`,
      `hail count ${String(landed).padStart(3, ' ')}   ears lost ${String(Math.round(landed * 4.6)).padStart(4, ' ')}`,
    ];
    lines.forEach((l, i) => { c.fillStyle = rgba(i === 0 ? 'bone' : 'ash', 1); c.fillText(l, 110, 110 + i * 26); });
    c.letterSpacing = '0px';
  }

  pressure(t: number) { return 1012 - 34 * prog(t, this.b(2), this.b(11), ease.inOutQuad); }

  /** The oscilloscope: the repeated notes as bursts, scrolling right to left over the last 0.9 s. */
  scope(c: CanvasRenderingContext2D, t: number, x: number, y: number, w: number, h: number) {
    c.strokeStyle = rgba('graphite', 1); c.lineWidth = 1;
    c.strokeRect(x, y, w, h);
    for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(x + (w * i) / 8, y); c.lineTo(x + (w * i) / 8, y + h); c.globalAlpha *= 0.4; c.stroke(); c.globalAlpha /= 0.4; }
    c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.stroke();
    const span = 0.9, N = 280;
    const near = this.all.filter((n) => n.t > t - span - 0.3 && n.t <= t);
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const tx = t - span + (span * i) / N;
      let a = 0, fq = 0;
      for (const n of near) {
        if (n.t > tx) continue;
        const k = Math.exp(-(tx - n.t) / 0.035) * (tx < n.t + n.d ? 1 : 0.3);
        if (k * n.v > a) { a = k * (n.v / 127); fq = n.p; }
      }
      const yy = y + h / 2 - Math.sin(tx * (60 + fq * 3) + i * 0.0) * a * (h * 0.44) * (0.7 + 0.3 * Math.sin(i * 0.9));
      if (i === 0) c.moveTo(x + (w * i) / N, yy); else c.lineTo(x + (w * i) / N, yy);
    }
    c.strokeStyle = rgba('bone', 1); c.lineWidth = 1.6; c.stroke();
    c.font = font(F.mono(400), 14); c.fillStyle = rgba('ash', 1); c.textAlign = 'left';
    c.fillText('CH1  strings · tremolo  ·  100 ms/div', x, y - 10);
  }

  /** The barometer: a dial, the needle falling with the pressure. */
  barometer(c: CanvasRenderingContext2D, t: number, cx: number, cy: number, r: number) {
    const lo = 950, hi = 1050;
    const ang = (v: number) => Math.PI * (0.75 + 1.5 * ((v - lo) / (hi - lo)));
    c.strokeStyle = rgba('bone', 1); c.fillStyle = rgba('bone', 1);
    // the brass case: a heavy bezel (two rings and a band of knurling between them), eight screws
    c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r + 34, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r + 40, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); c.lineTo(cx + Math.cos(a + 0.02) * (r + 30), cy + Math.sin(a + 0.02) * (r + 30));
      c.globalAlpha *= 0.35; c.stroke(); c.globalAlpha /= 0.35;
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8, sx = cx + Math.cos(a) * (r + 18), sy = cy + Math.sin(a) * (r + 18);
      c.beginPath(); c.arc(sx, sy, 6, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(sx - 4, sy); c.lineTo(sx + 4, sy); c.stroke();
    }
    c.font = font(F.mono(400), 13); c.textAlign = 'center';
    c.fillText('ANEROIDE  ·  STAZIONE METEO  ·  VENEZIA', cx, cy + r * 0.42);
    c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r - 14, ang(lo), ang(hi)); c.stroke();
    c.textAlign = 'center'; c.font = font(F.mono(400), 16);
    for (let v = lo; v <= hi; v += 5) {
      const a = ang(v), l = v % 25 === 0 ? 30 : 14;
      c.lineWidth = v % 25 === 0 ? 2.5 : 1;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); c.lineTo(cx + Math.cos(a) * (r - 14 - l), cy + Math.sin(a) * (r - 14 - l)); c.stroke();
      if (v % 25 === 0) c.fillText(String(v), cx + Math.cos(a) * (r - 70), cy + Math.sin(a) * (r - 70) + 6);
    }
    c.font = font(F.serif(400, true), 40);
    for (const [v, s] of [[965, 'Tempesta'], [990, 'Pioggia'], [1015, 'Variabile'], [1040, 'Bel tempo']] as const) {
      const a = ang(v);
      c.fillText(s, cx + Math.cos(a) * (r - 130), cy + Math.sin(a) * (r - 130) + 12);
    }
    // the set hand (left where the pressure stood before the storm), then the needle: falling, trembling
    {
      const a0 = ang(1012);
      c.save(); c.globalAlpha *= 0.55; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * (r - 30), cy + Math.sin(a0) * (r - 30)); c.stroke();
      c.beginPath(); c.arc(cx + Math.cos(a0) * (r - 52), cy + Math.sin(a0) * (r - 52), 7, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    const p = this.pressure(t) + 0.5 * noise1(t * 20, 3);
    const a = ang(p);
    c.lineWidth = 5; c.beginPath(); c.moveTo(cx - Math.cos(a) * 40, cy - Math.sin(a) * 40); c.lineTo(cx + Math.cos(a) * (r - 40), cy + Math.sin(a) * (r - 40)); c.stroke();
    c.beginPath(); c.arc(cx, cy, 12, 0, Math.PI * 2); c.fill();
    c.font = font(F.mono(500), 20); c.letterSpacing = '3px';
    c.fillText(`${p.toFixed(1)} hPa   ·   falling`, cx, cy + r + 56);
    c.letterSpacing = '0px';
  }

  /** The radar: a sweep, every landed stone a blip (field coordinates, top-down). */
  radar(c: CanvasRenderingContext2D, t: number, cx: number, cy: number, r: number, a: number) {
    if (a <= 0) return;
    const g = c.globalAlpha; c.globalAlpha = g * a;
    c.strokeStyle = rgba('graphite', 1); c.lineWidth = 1;
    for (const k of [1, 0.66, 0.33]) { c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
    const sw = t * 4.2;
    for (let k = 0; k < 24; k++) {
      c.globalAlpha = g * a * 0.35 * (1 - k / 24);
      c.strokeStyle = rgba('bone', 1); c.lineWidth = 3;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(sw - k * 0.03) * r, cy + Math.sin(sw - k * 0.03) * r); c.stroke();
    }
    c.fillStyle = rgba('bone', 1);
    for (const s of this.stones) {
      const age = t - s.n.t;
      if (age < 0 || age > 2.5) continue;
      const px = cx + (s.x / (FIELD_W * 0.6)) * r, py = cy + ((s.z + 20) / 70) * r;
      c.globalAlpha = g * a * (1 - age / 2.5);
      c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = g * a;
    c.font = font(F.mono(400), 14); c.textAlign = 'left'; c.fillStyle = rgba('ash', 1);
    c.fillText(`RADAR  ·  echoes ${this.stones.filter((s) => s.n.t <= t && s.n.t > t - 2.5).length}  ·  dBZ 61`, cx - r, cy + r + 30);
    c.globalAlpha = g;
  }

  /** The ensemble forecast: 32 continuations of the solo line sampled from "now", the true one bright. */
  forecast(c: CanvasRenderingContext2D, t: number, x: number, y: number, w: number, h: number, a: number) {
    if (a <= 0) return;
    const g = c.globalAlpha; c.globalAlpha = g * a;
    const horizon = 3.2;
    const future = this.solo.filter((n) => n.t >= t - 0.6 && n.t < t + horizon);
    const py = (p: number) => y + h - ((p - 48) / 46) * h;
    const px = (tt: number) => x + ((tt - (t - 0.6)) / (horizon + 0.6)) * w;
    c.strokeStyle = rgba('graphite', 1); c.lineWidth = 1; c.strokeRect(x, y, w, h);
    c.beginPath(); c.moveTo(px(t), y); c.lineTo(px(t), y + h); c.stroke();
    // the samples: the true line plus a random walk that widens with lead time (deterministic per sample)
    const truth = (tt: number) => { let p = future[0]?.p ?? 67; for (const n of future) if (n.t <= tt) p = n.p; return p; };
    for (let sIdx = 0; sIdx < 32; sIdx++) {
      c.beginPath();
      let off = 0;
      for (let i = 0; i <= 40; i++) {
        const tt = t + (horizon * i) / 40;
        off += (hash(sIdx, i, Math.floor(t * 2)) - 0.5) * 2.4 * (i / 40 + 0.15);
        const yy = py(truth(tt) + off);
        if (i === 0) c.moveTo(px(tt), yy); else c.lineTo(px(tt), yy);
      }
      c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1; c.stroke();
    }
    c.beginPath();
    future.forEach((n, i) => { const xx = px(n.t), yy = py(n.p); if (i === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy); });
    c.strokeStyle = rgba('bone', 1); c.lineWidth = 2.2; c.stroke();
    c.font = font(F.mono(400), 14); c.textAlign = 'left'; c.fillStyle = rgba('ash', 1);
    c.fillText(`ENSEMBLE FORECAST  ·  next 3.2 s  ·  n=32  T=0.9  ·  spread ${(1.2 + 3.1 * ((t * 0.37) % 1)).toFixed(1)} st`, x, y - 12);
    c.globalAlpha = g;
  }
}
