// Bars 25-58: the rise, the storm, the rest, the chord. The whole orchestra becomes a city of light:
// every note a bar in space (time runs along x, pitch is height, each instrument has its lane), built
// as it sounds; the camera flies through it, rising with the crescendo, banking on each sforzando
// (bars 38-43), thrown about by the tutti (bars 52-56). Bar 57 is a general pause: black. Bar 58, the
// full orchestra's B-flat chord, is engraved huge on a grand staff and left to cool.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { ENGRAVE } from '../engine/music';
import { staffStep, type Motif, type Note } from '../engine/score';
import { clamp, ease, lerp, noise1, prog, pulse, smoothstep } from '../engine/util';
import { Stage3D, Void, Note3D, glyphMesh, noteMaterial, drawStaff, sparks, seedOf, mixRGB } from './_kit';
import { Roll } from './rise-roll';

const LANES = ['vl1', 'vl2', 'va', 'vc', 'cb', 'fl', 'ob', 'cl', 'fg', 'cor', 'tr', 'timp'];
const LANE_Z = 1.7;
const SPEED = 9; // units per second along x
const PITCH_Y = (p: number) => (p - 30) * 0.32;

interface Bar3 { n: Note; i: number; x: number; y: number; z: number; len: number; lane: number; motif: boolean }

export default class Rise extends Scene {
  st = new Stage3D();
  bg = new Void();
  fx = new LineBatch(60000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  floor = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'max', depthTest: true });
  text = new Layer2D();
  bars: Bar3[] = [];
  mesh!: THREE.InstancedMesh;
  motifs: Motif[] = [];
  tStorm = 0; tFF = 0; tGP = 0; tChord = 0; sfz: number[] = [];
  chord = new THREE.Group();
  chordStage = new Stage3D();
  chordMats: THREE.MeshStandardMaterial[] = [];
  tmp = new THREE.Object3D();
  roll!: Roll;
  col = new THREE.Color();

  X(t: number) { return (t - this.ctx.start) * SPEED; }

  override async init() {
    const sc = this.ctx.score;
    const { start, end } = this.ctx;
    this.tStorm = sc.bar(44).t; this.tFF = sc.bar(52).t; this.tGP = sc.bar(57).t; this.tChord = sc.bar(58).t;
    this.sfz = [38, 39, 40, 41, 42, 43].map((b) => sc.bar(b).t);
    this.motifs = sc.motifs.filter((m) => m.t[0] >= start && m.t[0] < end);
    const motifNotes = new Set<string>();
    for (const m of this.motifs) for (const tt of m.t) for (const pid of m.parts) motifNotes.add(`${pid}@${tt.toFixed(3)}`);
    for (const n of sc.notesIn(start, this.tGP)) {
      const pid = sc.parts[n.part]!.id;
      const lane = LANES.indexOf(pid);
      if (lane < 0) continue;
      const written = pid === 'cb' ? 12 : 0; // the basses read an octave up: keep them out of the floor
      this.bars.push({ n, i: this.bars.length, x: this.X(n.t), y: PITCH_Y(n.p + written), z: (lane - (LANES.length - 1) / 2) * LANE_Z, len: Math.max(0.35, n.d * SPEED - 0.12), lane, motif: motifNotes.has(`${pid}@${n.t.toFixed(3)}`) });
    }
    const geo = new THREE.BoxGeometry(1, 0.28, 0.95);
    geo.translate(0.5, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.bars.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    this.st.scene.add(this.mesh);
    this.st.cam.far = 4000;
    this.buildChord();
    this.roll = new Roll(sc, this.ctx.renderer, start, this.tStorm, this.sfz);
  }

  /** Bar 58's chord, engraved on a grand staff (treble above, bass below), whole notes. */
  buildChord() {
    const sc = this.ctx.score, S = this.chordStage.scene;
    const pitches = [...new Set(sc.notesIn(this.tChord - 0.01, this.tChord + 0.05).map((n) => n.p + (sc.parts[n.part]!.id === 'cb' ? 12 : 0)))].sort((a, b) => a - b);
    const fm = noteMaterial();
    this.chordMats.push(fm);
    const TRE = 6, BAS = -6; // staff centres (y)
    const tg = glyphMesh('gClef', 0.4, fm); tg.position.set(-9, TRE - 1, 0); S.add(tg);
    const bg = glyphMesh('fClef', 0.4, fm); bg.position.set(-9, BAS + 1, 0); S.add(bg);
    const brace = glyphMesh('brace', 0.4, fm); brace.scale.set(1, 4, 1); brace.position.set(-11, BAS - 2, 0); S.add(brace);
    for (const p of pitches) {
      const treble = p >= 60;
      const y = treble ? TRE + (staffStep(p) - staffStep(71)) / 2 : BAS + (staffStep(p) - staffStep(50)) / 2;
      const m = noteMaterial();
      this.chordMats.push(m);
      const nn = new Note3D('whole', true, 0.8, m);
      // ledger lines for notes above/below their staff
      const c = treble ? TRE : BAS, off = y - c;
      for (let l = 3; l <= Math.abs(off) + 1e-6; l++) {
        const lg = new THREE.Mesh(new THREE.BoxGeometry(2.6, ENGRAVE.legerLine * 1.5, 0.2), m);
        lg.position.set(0, Math.sign(off) * l - off, 0); nn.group.add(lg);
      }
      nn.group.position.set(0, y, 0);
      S.add(nn.group);
    }
    this.chord = new THREE.Group();
    this.chordStage.key.position.set(-4, 10, 14);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    if (t >= this.tGP && t < this.tChord) return this.renderRest(t, out);
    if (t >= this.tChord) return this.renderChord(f, out);
    if (t < this.tStorm) return this.renderRoll(f, out);
    return this.renderCity(f, out);
  }

  // ---------------------------------------------------------------- bars 25-43: the roll
  renderRoll(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    this.bg.render(renderer, out, t, 0, 0);
    const { sf } = this.roll.render(renderer, out, t, this.ctx.score.barPos(t), comp);
    // the bar counter, as in the city
    const T = this.text; T.clear();
    const c = T.ctx;
    const bar = this.ctx.score.barAt(t)?.n ?? 25;
    c.font = font(F.archivo(62, 900), 120);
    c.fillStyle = rgba('bone', 0.9);
    c.textAlign = 'right';
    c.fillText(String(bar).padStart(2, '0'), W - 72, 160);
    c.font = font(F.serif(600, true), 54);
    c.fillStyle = rgba(bar >= 34 ? 'signal' : 'ash', 0.95);
    c.fillText(bar >= 38 ? 'sf' : bar >= 34 ? 'cresc.' : 'p', W - 76, 226);
    comp.draw(renderer, T.upload(), out);
    const sh = 10 * sf;
    return {
      ramp: 'wood', gradeSteps: 0, hatch: 0, bloom: 0.9, bloomThreshold: 1.1, grain: 0.06, vignette: 0.45,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.03 * sf, ca: 1.2 + 3 * sf,
    };
  }

  // ---------------------------------------------------------------- bars 44-56
  renderCity(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, P = this.X(t);
    const storm = prog(t, this.tStorm - 0.6, this.tStorm + 0.4, ease.inOutCubic);
    const ff = t >= this.tFF ? 1 : 0;
    const cres = prog(t, this.ctx.score.bar(34).t, this.tStorm, ease.inQuad);
    // sforzando banks and tutti hits
    let bank = 0, sf = 0;
    this.sfz.forEach((ts, i) => { const k = pulse(t, ts, 0.18); sf = Math.max(sf, k); bank += (i % 2 ? 1 : -1) * 0.16 * (t >= ts ? Math.exp(-(t - ts) * 3) * Math.cos((t - ts) * 9) : 0); });
    const tutti = f.a.tutti;

    // camera: alongside and above the city, climbing with the crescendo, pulling up for the storm
    const eye = new THREE.Vector3(P - lerp(15, 12, storm), lerp(9 + 6 * cres, 26, storm), lerp(19, 30, storm));
    const at = new THREE.Vector3(P + lerp(5, 8, storm), lerp(8 + 1 * cres, 7, storm), lerp(0, -1, storm));
    const sway = ff * 0.6 * noise1(t * 1.3, 5);
    eye.x += noise1(t * 0.5, 1) * 0.3; eye.y += noise1(t * 0.45, 2) * 0.3 + sway;
    this.st.look(eye, at, bank + lerp(-0.05, 0.08, storm) + 0.04 * ff * noise1(t * 2, 9), lerp(36, 46, storm) + 4 * tutti * ff);

    // the bars: built at their onset (they shoot out of the playhead), lit while sounding
    const m = this.mesh;
    let hit = 0;
    for (const b of this.bars) {
      const n = b.n, age = t - n.t;
      const tmp = this.tmp;
      if (age < 0) {
        // the score ahead of the playhead: dim, full length, waiting
        const near = smoothstep(80, 10, b.x - P);
        tmp.position.set(b.x, b.y, b.z); tmp.scale.set(b.len, 0.6, 0.6); tmp.updateMatrix(); m.setMatrixAt(b.i, tmp.matrix);
        const g = 0.05 + 0.12 * near;
        this.col.setRGB(LIN.ash[0] * g, LIN.ash[1] * g, LIN.ash[2] * g, THREE.LinearSRGBColorSpace);
        m.setColorAt(b.i, this.col);
        continue;
      }
      const grow = 1;
      const jump = ff * pulse(t, n.t, 0.1) * 1.4;
      tmp.position.set(b.x, b.y + jump, b.z);
      tmp.scale.set(Math.max(0.05, b.len * (0.15 + 0.85 * ease.outCubic(Math.min(1, grow * 1.6)))), 1 + 2.5 * pulse(t, n.t, 0.08), 1);
      tmp.updateMatrix();
      m.setMatrixAt(b.i, tmp.matrix);
      const sounding = t < n.t + n.d;
      const heat = sounding ? 0.55 + 0.45 * (n.v / 127) : 0;
      const k = 0.18 + 0.6 * Math.exp(-Math.max(0, age - n.d) * 0.6);
      const c = sounding ? mixRGB(LIN.bone, LIN.signal, 0.75) : mixRGB(LIN.graphite, LIN.bone, k * 0.6);
      const g = sounding ? 1 + 3 * pulse(t, n.t, 0.06) * heat : 1;
      this.col.setRGB(c[0] * g, c[1] * g, c[2] * g, THREE.LinearSRGBColorSpace);
      m.setColorAt(b.i, this.col);
      hit = Math.max(hit, pulse(t, n.t, 0.08) * (n.v / 127) ** 2);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.st.key.intensity = 1.8 + 1.5 * hit;
    this.st.rim.intensity = 3 + 12 * (sf + tutti * ff);

    this.bg.render(this.ctx.renderer, out, t, 0.04 + 0.08 * cres + 0.2 * ff * tutti, 0);
    this.st.render(renderer, out);

    // the floor: one line per lane, and the playhead
    const L = this.floor; L.clear();
    for (let i = 0; i < LANES.length; i++) {
      const z = (i - (LANES.length - 1) / 2) * LANE_Z;
      const g = 0.16 + 0.1 * cres;
      L.seg(P - 80, -1, z, P + 160, -1, z, 0.05, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
    }
    L.render(renderer, out, this.st.cam);
    const X = this.fx; X.clear();
    const zl = (LANES.length - 1) / 2 * LANE_Z + 1;
    const ph = 1 + 2 * hit;
    X.seg(P, -1, -zl, P, -1, zl, 0.08, LIN.signal[0] * ph, LIN.signal[1] * ph, LIN.signal[2] * ph, 1);
    // filaments on the sounding notes (the bloom comes from these), brighter on the motif
    for (const b of this.bars) {
      const n = b.n;
      if (t < n.t || t > n.t + n.d) continue;
      const u = clamp((t - n.t) / n.d);
      const g = (b.motif ? 7 : 3.2) * (0.4 + (n.v / 127)) * (1 - 0.5 * u);
      const c = mixRGB(LIN.ember, LIN.signal, u);
      X.seg(b.x, b.y + 0.17, b.z, b.x + b.len * u, b.y + 0.17, b.z, 0.07, c[0] * g, c[1] * g, c[2] * g, 1);
      // a vertical "stem" of light from the floor on onset
      const s = pulse(t, n.t, 0.1);
      if (s > 0.05) X.seg(b.x, -1, b.z, b.x, b.y, b.z, 0.05, LIN.signal[0] * 3 * s, LIN.signal[1] * 3 * s, LIN.signal[2] * 3 * s, 1);
    }
    // motif arcs: each entry reaches back to the previous one (as in the imitation plate)
    for (let i = 1; i < this.motifs.length; i++) {
      const a = this.motifs[i - 1]!, bm = this.motifs[i]!;
      const la = LANES.indexOf(a.parts[0]!), lb = LANES.indexOf(bm.parts[0]!);
      if (la < 0 || lb < 0) continue;
      const grow = prog(t, bm.t[0] - 0.05, bm.t[0] + 0.3, ease.outCubic);
      if (grow <= 0) continue;
      const fade = 1 - prog(t, bm.t[0] + 1.5, bm.t[0] + 3.5);
      if (fade <= 0) continue;
      const pa = new THREE.Vector3(this.X(a.t[0]), PITCH_Y(a.pitches[0]![0]!) + 0.4, (la - (LANES.length - 1) / 2) * LANE_Z);
      const pb = new THREE.Vector3(this.X(bm.t[0]), PITCH_Y(bm.pitches[0]![0]!) + 0.4, (lb - (LANES.length - 1) / 2) * LANE_Z);
      const pm = pa.clone().add(pb).multiplyScalar(0.5).add(new THREE.Vector3(0, 5, 0));
      const curve = new THREE.QuadraticBezierCurve3(pa, pm, pb);
      const N = 40, g = (1 + 3 * pulse(t, bm.t[0] + 0.3, 0.4)) * fade;
      for (let j = 0; j < N * grow; j++) {
        const q0 = curve.getPoint(j / N), q1 = curve.getPoint(Math.min(grow, (j + 1) / N));
        X.seg(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, 0.08, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 1);
      }
    }
    // sparks off the sforzandi and the tutti strikes
    this.sfz.forEach((ts, i) => sparks(X, t, ts, this.X(ts), 12, 0, seedOf(ts, i), { count: 90, speed: 20, life: 1.0 }));
    if (ff) for (const [ts, s] of this.ctx.audio.events('tutti', this.tFF - 0.01, t + 0.01)) sparks(X, t, ts, this.X(ts), 8, 0, seedOf(ts, 99), { count: Math.round(60 + 80 * s), speed: 24, life: 1.1, gain: 8 });
    X.render(renderer, out, this.st.cam);

    // the bar number, big and deadpan, top left
    const T = this.text; T.clear();
    const c = T.ctx;
    const bar = this.ctx.score.barAt(t)?.n ?? 25;
    c.font = font(F.mono(400), 15); c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.75);
    c.fillText('ALLEGRO CON BRIO · ♩ = 216', 72, 92);
    c.font = font(F.archivo(62, 900), 120); c.letterSpacing = '0px';
    c.fillStyle = rgba('bone', 0.9);
    c.fillText(String(bar).padStart(2, '0'), 66, 214);
    const dyn = bar >= 52 ? 'ff' : bar >= 44 ? 'f' : bar >= 34 ? 'cresc.' : 'p';
    c.font = font(F.serif(600, true), 54);
    c.fillStyle = rgba(bar >= 44 ? 'signal' : 'ash', 0.95);
    c.fillText(dyn, 72, 280);
    comp.draw(renderer, T.upload(), out);

    const sh = 6 * sf + 16 * tutti * ff + 2 * hit;
    return {
      bloom: 0.95, bloomThreshold: 1.1, halation: 0.25, grain: 0.065, vignette: 0.5,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.02 * sf + 0.04 * tutti * ff,
      ca: 1.2 + 2 * sf + 4 * tutti * ff, flash: 0.035 * tutti * ff,
    };
  }

  // ---------------------------------------------------------------- bar 57: the general pause
  renderRest(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    this.bg.render(renderer, out, t, 0, 0);
    const T = this.text; T.clear();
    const c = T.ctx;
    c.textAlign = 'center';
    c.font = font(F.mono(400), 24); c.letterSpacing = '6px';
    c.fillStyle = rgba('ash', 0.85 * prog(t, this.tGP + 0.08, this.tGP + 0.2));
    c.fillText(`m. 57 — TACET — ${(this.tChord - this.tGP).toFixed(2)} s`, W / 2, H / 2 + 6);
    comp.draw(renderer, T.upload(), out);
    return { grain: 0.07, bloom: 0.4, vignette: 0.6 };
  }

  // ---------------------------------------------------------------- bar 58: the chord
  renderChord(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, age = t - this.tChord;
    const st = this.chordStage;
    // slam in, then a slow drift back while it cools
    const k = prog(age, 0, 3, ease.outCubic);
    st.look(new THREE.Vector3(lerp(-1, 2, k), lerp(-1, 1, k), lerp(22, 34, k)), new THREE.Vector3(-1.5, 0, 0), lerp(0.04, 0, k), 40);
    const heat = Math.exp(-age * 1.1);
    for (const m of this.chordMats) {
      m.emissiveIntensity = 0.2 + 2.2 * heat;
      m.color.setRGB(...mixRGB(LIN.bone, LIN.blood, 1 - heat), THREE.LinearSRGBColorSpace);
    }
    st.key.intensity = 2 * (0.3 + 0.7 * heat);
    st.rim.intensity = 10 * heat;
    this.bg.render(renderer, out, t, 0.8 * heat, 0);
    st.render(renderer, out);
    const L = this.floor; L.clear();
    const m4 = new THREE.Matrix4();
    for (const y of [6, -6]) {
      m4.makeTranslation(0, y, 0);
      drawStaff(L, m4, t, -12, 12, [{ t: this.tChord, x: 0, amp: 0.8 }], { color: [LIN.bone[0] * 0.5, LIN.bone[1] * 0.5, LIN.bone[2] * 0.5], width: ENGRAVE.staffLine * 1.6, seg: 200 });
    }
    L.render(renderer, out, st.cam);
    const X = this.fx; X.clear();
    // (no sparks here: on the paper grade their halo turns into a grey smudge)
    X.render(renderer, out, st.cam);
    const T = this.text; T.clear();
    const c = T.ctx;
    const a = prog(age, 0.6, 1.0) * (1 - prog(t, this.ctx.end - 0.5, this.ctx.end - 0.1));
    c.globalAlpha = a;
    c.font = font(F.mono(400), 16); c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.9);
    c.textAlign = 'center';
    c.fillText('B♭ MAJOR · FIRST INVERSION · ff · m. 58', W / 2, H - 120);
    comp.draw(renderer, T.upload(), out);
    const sh = 22 * pulse(t, this.tChord, 0.08);
    return {
      bloom: 0.9, bloomThreshold: 1.1, halation: 0.3, grain: 0.065, vignette: 0.5, ramp: 'paper', gradeSteps: 3,
      flash: 0.35 * pulse(t, this.tChord, 0.035), shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh],
      // the handover to Mozart: the printed page turns to glaze (ink to cobalt, the ground stays white)
      ramp2: 'glaze', rampMix: prog(t, this.ctx.end - 1.0, this.ctx.end, ease.inOutQuad),
      zoom: 1 + 0.05 * pulse(t, this.tChord, 0.1) + 0.06 * prog(t, this.ctx.end - 1.0, this.ctx.end, ease.inQuad), ca: 1.2 + 6 * pulse(t, this.tChord, 0.1),
    };
  }
}
