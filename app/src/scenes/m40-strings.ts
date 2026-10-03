// Mozart 40/I, bars 1-13: the strings, as blue-and-white porcelain. The violas start alone (the
// divided eighth-note accompaniment: the bow turns on every note), the violins enter with the sighing
// theme, the cellos and basses mark the bar. Four instruments lie on a glazed plate; the camera starts
// on the viola's bow, finds the first violin, then rises to see the plate whole (a painted porcelain
// scene), and the theme's sighs (each falling second) are signed in the glaze: Seufzer.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, HEX, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { strokeText, drawStrokeText, type StrokeText } from '../engine/stroke';
import type { Note } from '../engine/score';
import { ease, hash, lerp, noise1, prog, pulse, mulberry32 } from '../engine/util';
import { Stage3D, Void } from './_kit';
import { Violin } from './m40-models';
import { buildDish, buildSalon, drawGlints, drawPainting, instrumentPainting, type Salon } from './m40-rococo';
import { styled } from '../engine/style';

type Key = { t: number; eye: [number, number, number]; at: [number, number, number]; roll?: number; fov?: number };

export default class M40Strings extends Scene {
  st = new Stage3D();
  bg = new Void();
  fx = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  /** glints: glaze highlights, prisms, candle flames (additive) */
  gx = new LineBatch(12000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  dishGlints: THREE.Vector3[] = [];
  salon!: Salon;
  paint: Float32Array[] = [];
  text = new Layer2D();
  inst: { f: Violin; notes: Note[]; m: THREE.Matrix4; label: string }[] = [];
  keys: Key[] = [];
  vl1: Note[] = [];
  sighs: { a: Note; b: Note }[] = [];
  sw: StrokeText | null = null;
  tTitle = 0;
  /** downbeats of bars 1-14 (camera kicks, the light sweep) */
  downs: number[] = [];

  override async init() {
    const sc = this.ctx.score;
    const seg = 'm40';
    const notesOf = (id: string) => sc.notesIn(this.ctx.start - 0.1, this.ctx.end + 2).filter((n) => n.part === sc.partIndex(`${seg}:${id}`));
    // the salon round the table, softened by a pale fog (the dish is sharp, the room a soft glitter)
    this.salon = buildSalon();
    this.st.scene.add(this.salon.group);
    this.st.scene.fog = new THREE.Fog(new THREE.Color('#e3e9f1'), 340, 1300);
    // four instruments lying on the plate, scrolls towards the rim, fanned like a still life
    const lay = (f: Violin, x: number, z: number, rotY: number, lift = 0) => {
      f.group.rotation.set(-Math.PI / 2, 0, rotY);
      f.group.position.set(x, f.restHeight + lift, z);
      this.st.scene.add(f.group);
      f.group.updateMatrixWorld(true);
      return f.group.matrixWorld.clone();
    };
    const add = (id: string, label: string, open: number[], scale: number, x: number, z: number, rot: number, varnish: string) => {
      // bows shorter than life (Terry: the full-length bows read as too long lying on the dish); the cello's
      // endpin pushed in, as it would be with the instrument laid down
      const f = new Violin(open, scale, varnish, { bow: scale > 1.5 ? 33 * scale : 52 * scale, endpin: false });
      f.travelGain = 1.7; // full, quick strokes: the bowing has to read from across the room
      const m = lay(f, x, z, rot);
      this.inst.push({ f, notes: notesOf(id), m, label });
    };
    // varnish in neutral greys: the porcelain grade paints them (saturated colour would be kept as the signal)
    // white glaze (the instruments are porcelain too), painted in cobalt below
    add('va', 'VIOLA', [48, 55, 62, 69], 1.15, 18, 22, -0.35, '#dedbd5');
    add('vl1', 'VIOLINO I', [55, 62, 69, 76], 1.0, -26, 12, 0.42, '#e6e3de');
    add('vl2', 'VIOLINO II', [55, 62, 69, 76], 1.0, -6, -38, 0.08, '#e2dfd9');
    add('vc', 'VIOLONCELLO', [36, 43, 50, 57], 2.05, 52, -30, -0.9, '#d6d2cb');
    this.paint = this.inst.map((s, i) => instrumentPainting(s.f, s.m, 40 + i));
    // the dish, its relief kept clear of where the instruments lie
    const avoid: { x: number; z: number; r: number }[] = [];
    for (const s of this.inst) for (let y = 0; y <= s.f.nutY + 10 * s.f.s; y += 6 * s.f.s) {
      const p = new THREE.Vector3(0, y, 0).applyMatrix4(s.m);
      avoid.push({ x: p.x, z: p.z, r: s.f.wid * 0.62 });
    }
    const dish = buildDish(avoid);
    this.st.scene.add(dish.group);
    this.dishGlints = dish.glints;
    this.vl1 = this.inst[1]!.notes;
    // the sighs: a falling second in the first violins, two short notes slurred (Eb-D)
    for (let i = 1; i < this.vl1.length; i++) {
      const a = this.vl1[i - 1]!, b = this.vl1[i]!;
      if (a.qd <= 0.5 && b.qd <= 1 && a.p - b.p >= 1 && a.p - b.p <= 2 && Math.abs(b.t - a.t - a.d) < 0.02 && (a.pos % 1) > 0.4) this.sighs.push({ a, b });
    }
    this.sw = strokeText('Seufzer', 'script', 100);
    this.tTitle = this.ctx.start;
    for (let n = 1; n <= 14; n++) this.downs.push(sc.bar(n, seg).t);
    // the camera's keys, anchored to the music: viola alone, the violins' entry, the plate from above, the track
    const b = (n: number) => sc.bar(n, seg).t;
    const vla = this.inst[0]!, vln = this.inst[1]!, cel = this.inst[3]!;
    const P = (f: { f: Violin; m: THREE.Matrix4 }, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(f.m).toArray() as [number, number, number];
    void this.vl1;
    this.keys = [
      // establishing (bars 1-2): the glazed plate and its four instruments from above, drifting towards the
      // first violin as the theme begins
      { t: this.ctx.start, eye: [0, 118, 238], at: [0, 34, -60], roll: 0.03, fov: 44 },
      { t: b(3) - 0.05, eye: [-14, 112, 64], at: [-14, 4, 4], roll: -0.02, fov: 40 },
      // bars 3-4: the first violin, its bow on the sighs
      { t: b(3), eye: P(vln, -20, 20, 30), at: P(vln, 2, 30, 3), roll: -0.3, fov: 36 },
      { t: b(5) - 0.05, eye: P(vln, -10, 40, 40), at: P(vln, 0, 32, 2), roll: -0.15, fov: 38 },
      // bars 5-6: the plate, from above
      { t: b(5), eye: [10, 170, 34], at: [10, 0, -6], roll: 0.04, fov: 42 },
      { t: b(7) - 0.05, eye: [6, 150, 28], at: [8, 0, -4], roll: -0.04, fov: 42 },
      // bar 7: close-up, the first violin's bow hair on the string by the bridge
      { t: b(7), eye: P(vln, 24, 40, 20), at: P(vln, 0, 17, 3), roll: 0.45, fov: 32 },
      { t: b(8) - 0.05, eye: P(vln, 20, 36, 17), at: P(vln, 0, 18, 3), roll: 0.4, fov: 30 },
      // bar 8: the viola's bow working the eighths, from the other side
      { t: b(8), eye: P(vla, -26, 44, 22), at: P(vla, 0, 20, 3), roll: -0.4, fov: 32 },
      { t: b(9) - 0.05, eye: P(vla, -22, 40, 19), at: P(vla, 0, 21, 3), roll: -0.35, fov: 30 },
      // bar 9: the plate again
      { t: b(9), eye: [0, 140, 30], at: [6, 0, -4], roll: 0.05, fov: 42 },
      { t: b(10) - 0.05, eye: [4, 132, 26], at: [8, 0, -4], roll: -0.06, fov: 42 },
      // bars 10-11: the cello's long bows (the whole notes)
      { t: b(10), eye: P(cel, 38, 20, 50), at: P(cel, 0, 39, 15), roll: 0.25, fov: 34 },
      { t: b(12) - 0.05, eye: P(cel, 28, 16, 44), at: P(cel, 0, 37, 15), roll: 0.2, fov: 34 },
      // bar 12: close-up, the violin's f-hole and the strings shivering over it
      { t: b(12), eye: P(vln, -12, 9, 13), at: P(vln, -3.2, 15.5, 3.4), roll: -0.7, fov: 30 },
      { t: b(13) - 0.05, eye: P(vln, -9, 12, 12), at: P(vln, -2.4, 16.5, 4), roll: -0.6, fov: 30 },
      // bar 13: pull back over the plate
      { t: b(13), eye: [-20, 60, 50], at: [-10, 4, 4], roll: -0.1, fov: 38 },
      { t: this.ctx.end, eye: [-10, 120, 70], at: [6, 2, -10], roll: 0.08, fov: 40 },
    ];
  }

  /** Piecewise camera: eased between keys, hard cuts where two keys sit 0.05 s apart. */
  camera(t: number) {
    const k = this.keys;
    let i = 0;
    while (i + 1 < k.length && t >= k[i + 1]!.t) i++;
    const a = k[i]!, b = k[Math.min(i + 1, k.length - 1)]!;
    const u = b.t - a.t < 0.06 ? 0 : ease.inOutQuad(Math.min(1, (t - a.t) / Math.max(1e-3, b.t - a.t)));
    const L = (x: number[], y: number[]) => new THREE.Vector3(lerp(x[0]!, y[0]!, u), lerp(x[1]!, y[1]!, u), lerp(x[2]!, y[2]!, u));
    const eye = L(a.eye, b.eye), at = L(a.at, b.at);
    // momentum: every shot keeps turning slowly round its subject (alternate shots turn opposite ways),
    // a soft push-in on each downbeat and on each sigh, and a little float
    const lt = t - a.t, dir = i % 2 ? -1 : 1;
    const ang = dir * (0.055 * lt + 0.03 * Math.sin(lt * 0.9));
    const off = eye.clone().sub(at);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const kick = (t0: number, k: number) => prog(t, t0 - 0.05, t0 + 0.07, ease.outQuad) * Math.pow(0.5, Math.max(0, t - t0 - 0.07) / 0.3) * k;
    let push = 0;
    for (const d of this.downs) if (t > d - 0.1 && t < d + 2) push = Math.max(push, kick(d, 0.07));
    for (const s of this.sighs) if (t > s.a.t - 0.1 && t < s.a.t + 1.5) push = Math.max(push, kick(s.a.t, 0.045));
    off.multiplyScalar(1 - push - 0.035 * Math.min(1, lt / 2.5));
    eye.copy(at).add(off);
    eye.x += noise1(t * 0.5, 4) * 0.8; eye.y += noise1(t * 0.4, 5) * 0.6;
    const roll = lerp(a.roll ?? 0, b.roll ?? 0, u) + 0.012 * Math.sin(t * 0.7) + dir * 0.02 * push;
    this.st.look(eye, at, roll, lerp(a.fov ?? 36, b.fov ?? 36, u) * (1 - 0.4 * push));
    return push;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const push = this.camera(t);
    let hit = 0;
    const energies = this.inst.map((s) => {
      const e = s.f.play(t, s.notes);
      for (const n of s.notes) hit = Math.max(hit, pulse(t, n.t, 0.08) * n.v / 127);
      return e;
    });
    const bp = this.barPos(t);
    const la = -1.2 + 2.4 * ease.inOutQuad(bp.u);
    this.st.key.position.set(Math.cos(la) * 300, 260, Math.sin(la) * 300);
    this.st.key.intensity = 2.4 + 0.5 * Math.pow(0.5, bp.u * bp.len / 0.25);
    this.st.rim.intensity = 1.5 + 1.2 * hit;
    this.bg.render(renderer, out, t, 0, 0);
    this.st.render(renderer, out);
    const X = this.fx; X.clear();
    this.inst.forEach((s, i) => { s.f.drawStrings(X, s.m, t, energies[i]!); s.f.drawDust(X, s.m, t, s.notes); });
    this.paint.forEach((p) => drawPainting(X, p));
    this.motes(X, t);
    X.render(renderer, out, this.st.cam);
    const GX = this.gx; GX.clear();
    drawGlints(GX, t, this.dishGlints, this.salon, this.ctx.audio.env('rms', t), bp.u);
    this.sweep(GX, t, bp.u);
    GX.render(renderer, out, this.st.cam);
    this.drawText(t);
    comp.draw(renderer, this.text.upload(), out);
    // the handover from Beethoven: the paper grade still morphing into the glaze for the first moments
    // (a white page either way: the glaze ramp maps dark to white, the porcelain ramp maps the plate to white)
    const into = prog(t, this.ctx.start, this.ctx.start + 0.12);
    return {
      ramp: 'glaze', ramp2: 'porcelain', rampMix: into, grade: 1, gradeSteps: 4, hatch: 0.3,
      bloom: 0.75, bloomThreshold: 1.05, halation: 0, grain: 0.05, vignette: 0.25, ca: 1.0 + 0.6 * hit + 2 * push,
    };
  }

  /** Where t falls in its bar: 0..1 and the bar's length. */
  barPos(t: number) {
    const d = this.downs;
    let i = 0;
    while (i + 1 < d.length && t >= d[i + 1]!) i++;
    const len = (d[i + 1] ?? d[i]! + (d[i]! - (d[i - 1] ?? d[i]! - 1))) - d[i]!;
    return { u: Math.min(1, Math.max(0, (t - d[i]!) / len)), len };
  }

  /** A band of light sweeping across the glaze once a bar (additive streaks lying on the dish). */
  sweep(X: LineBatch, t: number, u: number) {
    const s = -190 + 380 * (0.5 - 0.5 * Math.cos(Math.PI * u)), a = Math.PI * 0.2;
    const dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx;
    const fade = Math.sin(Math.PI * u);
    for (let k = -3; k <= 3; k++) {
      const o = s + k * 2.2, al = fade * 0.07 * (1 - Math.abs(k) / 4);
      // along the band: from one side of the rim to the other, clipped to the dish (r < 154)
      const half = Math.sqrt(Math.max(0, 154 * 154 - o * o));
      if (half < 1) continue;
      const cx = nx * o, cz = nz * o;
      X.seg(cx - dx * half, 0.35, cz - dz * half, cx + dx * half, 0.35, cz + dz * half, 3.2, 0.9, 0.95, 1, al);
    }
    void t;
  }

  /** Porcelain dust: specks drifting in the light over the plate, stirred by the music. */
  motes(X: LineBatch, t: number) {
    const lv = this.ctx.audio.env('rms', t);
    for (let i = 0; i < 260; i++) {
      const r = 150 * Math.sqrt(hash(i, 1)), a = hash(i, 2) * Math.PI * 2;
      const period = 9 + 8 * hash(i, 3), ph = ((t + hash(i, 4) * period) % period) / period;
      // the dust turns round the dish with the phrase (faster as the music swells)
      const sw = a + t * (0.12 + 0.05 * hash(i, 7)) + 0.4 * lv * Math.sin(t * 0.8 + i);
      const x = Math.cos(sw) * r + 6 * Math.sin(t * 0.3 + i), z = Math.sin(sw) * r + 5 * Math.cos(t * 0.27 + i * 1.3);
      const y = 2 + ph * (40 + 30 * hash(i, 5));
      const al = Math.sin(Math.PI * ph) * (0.35 + 0.5 * lv);
      const w = 0.22 + 0.25 * hash(i, 6);
      X.seg(x, y, z, x + 0.15, y + 0.4 + 0.6 * lv, z, w, LIN.cobalt[0], LIN.cobalt[1], LIN.cobalt[2], al);
    }
  }

  drawText(t: number) {
    const T = this.text; T.clear();
    const c = T.ctx;
    // the title, typed in on the violas' first bar
    const a = prog(t, this.tTitle + 0.15, this.tTitle + 0.5) * (1 - prog(t, this.vl1[0]!.t + 1.2, this.vl1[0]!.t + 1.6));
    if (a > 0) {
      c.save(); c.globalAlpha = a;
      c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('signal', 1);
      c.fillText('W. A. MOZART · SINFONIE IN G-MOLL · KV 550 · 1788', 120, H - 210);
      c.letterSpacing = '0px';
      c.font = font(F.serif(400, true), 96); c.fillStyle = rgba('bone', 0.96);
      const s = 'Molto allegro.';
      c.fillText(s.slice(0, Math.floor(s.length * prog(t, this.tTitle + 0.2, this.tTitle + 0.9))), 110, H - 110);
      c.restore();
    }
    // the sighs: each falling second signed in script beside the bow, while it sounds
    if (!this.sw) return;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    const vln = this.inst[1]!;
    for (const s of this.sighs) {
      const age = t - s.a.t;
      if (age < 0 || age > 0.9) continue;
      const fade = 1 - prog(age, 0.6, 0.9);
      const p = new THREE.Vector3(-18, 8, 20).applyMatrix4(vln.m).project(this.st.cam);
      if (p.z > 1) continue;
      const x = (p.x * 0.5 + 0.5) * W + 40 * Math.sin(s.a.t * 3.1), y = (0.5 - p.y * 0.5) * H + 30 * Math.cos(s.a.t * 2.3);
      c.save(); c.globalAlpha = fade;
      c.translate(x, y); c.scale(0.7, 0.7);
      c.strokeStyle = rgba('signal', 1); c.lineWidth = 4 / 0.7;
      drawStrokeText(c, this.sw, this.sw.total * prog(age, 0, 0.3, ease.outQuad));
      c.restore();
    }
    c.restore();
    void LIN;
  }
}
