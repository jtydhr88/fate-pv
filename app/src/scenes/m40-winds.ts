// Mozart 40/I, bars 14-20: the winds come in. Bars 14-15: flute, clarinet and bassoon rise together
// in three octaves (the camera slides along their keys); bars 16-19: forte, the winds' chords and the
// horns on every half bar, while the strings hammer D (the bows hacking short strokes); bar 20: piano,
// the bassoon walks down into the theme's return. Porcelain like the strings: the same glaze, the
// same plate under everything.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Note } from '../engine/score';
import { ease, hash, lerp, noise1, prog, pulse } from '../engine/util';
import { LIN } from '../engine/palette';
import { buildDish, buildSalon, drawGlints, type Salon } from './m40-rococo';
import { Stage3D, Void } from './_kit';
import { Reed, NaturalHorn, Violin, type ReedKind } from './m40-models';
import { styled } from '../engine/style';

type Key = { t: number; eye: [number, number, number]; at: [number, number, number]; roll?: number; fov?: number };

export default class M40Winds extends Scene {
  st = new Stage3D();
  bg = new Void();
  fx = new LineBatch(30000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  strings = new LineBatch(10000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  text = new Layer2D();
  /** glints, prisms, flames, key clacks, the horns' light rings (additive) */
  gx = new LineBatch(16000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  dishGlints: THREE.Vector3[] = [];
  salon!: Salon;
  /** cobalt painted on the woodwinds' bodies: world segments [x0 y0 z0 x1 y1 z1 w] */
  paint: number[] = [];
  downs: number[] = [];
  winds: { w: Reed; notes: Note[]; label: string; x: number; m: THREE.Matrix4 }[] = [];
  horns: { h: NaturalHorn; notes: Note[]; m: THREE.Matrix4 }[] = [];
  fiddle!: { f: Violin; notes: Note[]; m: THREE.Matrix4 };
  keys: Key[] = [];
  tutti: number[] = [];

  override async init() {
    const sc = this.ctx.score, seg = 'm40';
    const notesOf = (id: string) => sc.notesIn(this.ctx.start - 2, this.ctx.end + 1).filter((n) => n.part === sc.partIndex(`${seg}:${id}`));
    const S = this.st.scene;
    // the rococo room of the strings plate: the salon, and the painted dish the winds stand on
    // (the room further off and hazed a mid blue, so the white-glazed instruments stand out against it)
    this.salon = buildSalon({ centre: false, scale: 1.6, vases: false });
    S.add(this.salon.group);
    S.fog = new THREE.Fog(new THREE.Color('#9fb3d1'), 260, 1500);
    const dish = buildDish([[-36, 0], [-12, 0], [16, 0], [48, 40], [-78, 0], [64, 0]].map(([x, z]) => ({ x: x!, z: z!, r: 18 })));
    S.add(dish.group);
    this.dishGlints = dish.glints;
    // the woodwinds stand in a row (neutral greys: the glaze paints them); the flute lies across above
    const add = (id: string, label: string, len: number, r: number, body: string, keyHex: string, range: [number, number], x: number, n: number, flare: number, kind: ReedKind) => {
      const w = new Reed(len, r, body, keyHex, range, n, flare, kind);
      w.group.position.set(x, 0, 0);
      S.add(w.group);
      w.group.updateMatrixWorld(true);
      this.winds.push({ w, notes: notesOf(id), label, x, m: w.group.matrixWorld.clone() });
    };
    // porcelain bodies (white glaze, the clarinet a cobalt-ground piece), keywork bright as glaze highlights
    add('ob', 'OBOE', 65, 1.0, '#e6e3de', '#ffffff', [58, 91], -36, 10, 2.2, 'oboe');
    add('cl', 'CLARINETTO', 66, 1.3, '#3d5a9a', '#ffffff', [50, 89], -12, 12, 2.6, 'clarinet');
    add('fg', 'FAGOTTO', 134, 2.0, '#dedad3', '#ffffff', [34, 72], 16, 14, 1.2, 'bassoon');
    const fl = new Reed(67, 0.95, '#ecebe8', '#ffffff', [60, 96], 12, 1.0, 'flute');
    fl.group.rotation.z = -Math.PI / 2;
    fl.group.position.set(-66, 96, 6); // lying across above the row, its head short of the bassoon
    S.add(fl.group);
    fl.group.updateMatrixWorld(true);
    this.winds.unshift({ w: fl, notes: notesOf('fl'), label: 'FLAUTO', x: -20, m: fl.group.matrixWorld.clone() });
    // the horns hang either side, bells to the camera
    for (const [id, x] of [['cor1', -78], ['cor2', 64]] as const) {
      const h = new NaturalHorn('#e9e7e3');
      h.group.position.set(x, 46, -6);
      h.group.rotation.set(0.25, Math.PI + (x < 0 ? 0.75 : -0.75), x < 0 ? 0.3 : -0.3); // three-quarter: the coil and the bell both read
      S.add(h.group);
      h.group.updateMatrixWorld(true);
      this.horns.push({ h, notes: notesOf(id), m: h.group.matrixWorld.clone() });
    }
    // a violin in front, its bow hacking the repeated Ds
    const f = new Violin([55, 62, 69, 76], 1.0, '#e6e3de', { bow: 52 });
    f.travelGain = 1.7;
    f.group.position.set(48, 4, 40);
    f.group.rotation.set(-1.15, 0, 0.5);
    S.add(f.group);
    f.group.updateMatrixWorld(true);
    this.fiddle = { f, notes: notesOf('vl1'), m: f.group.matrixWorld.clone() };
    // cobalt painted on the woodwinds: bands round the joints, and a vine winding up each body
    for (const w of this.winds) {
      const L = w.w.length, r = w.w.radius * 1.06;
      const P = (y: number, a: number, rr = r) => new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr).applyMatrix4(w.m);
      const ring = (y: number, wd: number) => {
        for (let k = 0; k < 24; k++) {
          const A = P(y, (k / 24) * Math.PI * 2), B = P(y, ((k + 1) / 24) * Math.PI * 2);
          this.paint.push(A.x, A.y, A.z, B.x, B.y, B.z, wd);
        }
      };
      for (const u of [0.08, 0.1, 0.3, 0.55, 0.78, 0.92]) ring(L * u, 0.4 * w.w.radius);
      // the vine: a slow helix with paired leaf strokes
      const steps = 120;
      for (let k = 0; k < steps; k++) {
        const u0 = 0.12 + 0.76 * (k / steps), u1 = 0.12 + 0.76 * ((k + 1) / steps);
        const a0 = u0 * 14 + Math.sin(u0 * 40) * 0.25, a1 = u1 * 14 + Math.sin(u1 * 40) * 0.25;
        const A = P(L * u0, a0), B = P(L * u1, a1);
        this.paint.push(A.x, A.y, A.z, B.x, B.y, B.z, 0.26 * w.w.radius);
        if (k % 6 === 3) for (const sd of [-1, 1]) {
          const C = P(L * u0 + sd * 0.9 * w.w.radius, a0 + sd * 0.35);
          this.paint.push(A.x, A.y, A.z, C.x, C.y, C.z, 0.32 * w.w.radius);
        }
      }
    }
    for (let n = 14; n <= 20; n++) this.downs.push(sc.bar(n, seg).t);
    this.downs.push(this.ctx.end);
    // the tutti hits: every wind/horn attack of bars 16-19
    const b = (n: number) => sc.bar(n, seg).t;
    this.tutti = [...new Set(this.horns.flatMap((h) => h.notes.map((n) => +n.t.toFixed(3))))].filter((x) => x >= b(16) && x < b(20)).sort((a, z) => a - z);
    const half = (sc.bar(15, seg).end - b(15)) / 2;
    this.keys = [
      // bar 14: establishing, the whole row of winds and the horns either side, the flute across the top
      { t: this.ctx.start, eye: [-8, 70, 175], at: [-8, 58, 0], roll: 0, fov: 46 },
      { t: b(15) - 0.05, eye: [-8, 72, 150], at: [-8, 60, 0], roll: 0, fov: 45 },
      // bar 15: along the keys, flute -> clarinet -> bassoon
      { t: b(15), eye: [-58, 108, 30], at: [-30, 96, 0], roll: -0.15, fov: 34 },
      { t: b(15) + half, eye: [-20, 102, 32], at: [-12, 96, 0], roll: -0.05, fov: 34 },
      { t: b(15) + half + 0.01, eye: [-30, 50, 48], at: [-12, 40, 0], roll: 0.1, fov: 36 },
      { t: b(16) - 0.05, eye: [40, 90, 60], at: [16, 90, 0], roll: 0.06, fov: 36 },
      // bars 16-19: the whole row, square on, thrown about by the tutti; a bell close-up on each half bar
      { t: b(16), eye: [-8, 64, 140], at: [-8, 58, 0], fov: 44 },
      { t: b(17), eye: [-8, 66, 125], at: [-8, 58, 0], fov: 44 },
      { t: b(17) + 0.01, eye: [-78, 46, 70], at: [-78, 46, 0], fov: 40 },
      { t: b(17) + half, eye: [-74, 48, 62], at: [-78, 46, 0], fov: 40 },
      { t: b(17) + half + 0.01, eye: [64, 46, 70], at: [64, 46, 0], fov: 40 },
      { t: b(18), eye: [60, 48, 62], at: [64, 46, 0], fov: 40 },
      // bar 18: close-up, the clarinet's keys closing on the chords
      { t: b(18) + 0.01, eye: [-4, 46, 14], at: [-12, 42, 1], roll: 0.5, fov: 30 },
      { t: b(18) + half, eye: [-6, 40, 12], at: [-12, 38, 1], roll: 0.45, fov: 30 },
      // into the second horn's bell
      { t: b(18) + half + 0.01, eye: [86, 50, 26], at: [70, 46, 0], roll: -0.2, fov: 36 },
      { t: b(19), eye: [80, 48, 20], at: [68, 46, 0], roll: -0.15, fov: 36 },
      // bar 19: the whole row once more
      { t: b(19) + 0.01, eye: [-8, 64, 150], at: [-8, 58, 0], fov: 46 },
      { t: b(20), eye: [-8, 62, 115], at: [-8, 58, 0], fov: 44 },
      // bar 20: piano, the bassoon walks down
      { t: b(20) + half, eye: [30, 60, 70], at: [14, 70, 0], roll: 0.08, fov: 38 },
      { t: this.ctx.end, eye: [24, 50, 50], at: [14, 40, 0], roll: 0.04, fov: 36 },
    ];
  }

  camera(t: number) {
    const k = this.keys;
    let i = 0;
    while (i + 1 < k.length && t >= k[i + 1]!.t) i++;
    const a = k[i]!, b = k[Math.min(i + 1, k.length - 1)]!;
    const u = b.t - a.t < 0.06 ? 0 : ease.inOutQuad(Math.min(1, (t - a.t) / Math.max(1e-3, b.t - a.t)));
    const L = (x: number[], y: number[]) => new THREE.Vector3(lerp(x[0]!, y[0]!, u), lerp(x[1]!, y[1]!, u), lerp(x[2]!, y[2]!, u));
    const eye = L(a.eye, b.eye), at = L(a.at, b.at);
    const hit = Math.max(0, ...this.tutti.map((x) => pulse(t, x, 0.1)));
    // momentum like the strings: each shot turns slowly round its subject (alternating), drifts in, and is
    // pushed in softly on each downbeat; the forte hits kick it back
    const lt = t - a.t, dir = i % 2 ? -1 : 1;
    const off = eye.clone().sub(at).applyAxisAngle(new THREE.Vector3(0, 1, 0), dir * (0.05 * lt + 0.025 * Math.sin(lt * 0.9)));
    const kick = (t0: number, k: number) => prog(t, t0 - 0.05, t0 + 0.07, ease.outQuad) * Math.pow(0.5, Math.max(0, t - t0 - 0.07) / 0.3) * k;
    let push = 0;
    for (const d of this.downs) if (t > d - 0.1 && t < d + 2) push = Math.max(push, kick(d, 0.06));
    off.multiplyScalar(1 - push - 0.03 * Math.min(1, lt / 2.5) + 0.06 * hit);
    eye.copy(at).add(off);
    eye.x += noise1(t * 0.5, 4) * 0.8; eye.y += noise1(t * 0.4, 5) * 0.6 + noise1(t * 30, 2) * hit * 1.5;
    const roll = lerp(a.roll ?? 0, b.roll ?? 0, u) + 0.012 * Math.sin(t * 0.7) + dir * 0.02 * push;
    this.st.look(eye, at, roll, lerp(a.fov ?? 36, b.fov ?? 36, u) * (1 - 0.4 * push));
    return hit;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const hit = this.camera(t);
    for (const w of this.winds) w.w.play(t, w.notes);
    for (const h of this.horns) h.h.play(t, h.notes);
    const e = this.fiddle.f.play(t, this.fiddle.notes);
    // the key light swings across each bar (the sheen slides over the glaze), flaring on the hits
    const bu = this.barU(t);
    const la = -1.2 + 2.4 * ease.inOutQuad(bu);
    this.st.key.position.set(Math.cos(la) * 300, 260, Math.sin(la) * 300);
    this.st.key.intensity = 2.4 + 1.2 * hit;
    this.st.rim.intensity = 1.5 + 4 * hit;
    this.bg.render(renderer, out, t, 0, 0);
    this.st.render(renderer, out);
    const Sg = this.strings; Sg.clear();
    this.fiddle.f.drawStrings(Sg, this.fiddle.m, t, e);
    Sg.render(renderer, out, this.st.cam);
    const X = this.fx; X.clear();
    for (const h of this.horns) h.h.drawRings(X, h.m, t, h.notes);
    for (const w of this.winds) w.w.drawBreath(X, w.m, t, w.notes);
    this.fiddle.f.drawDust(X, this.fiddle.m, t, this.fiddle.notes);
    const pc = LIN.prussian, q = this.paint;
    for (let k = 0; k < q.length; k += 7) X.seg(q[k]!, q[k + 1]!, q[k + 2]!, q[k + 3]!, q[k + 4]!, q[k + 5]!, q[k + 6]!, pc[0], pc[1], pc[2], 1);
    this.motes(X, t);
    X.render(renderer, out, this.st.cam);
    const GX = this.gx; GX.clear();
    drawGlints(GX, t, this.dishGlints, this.salon, this.ctx.audio.env('rms', t), bu);
    this.clacks(GX, t);
    // the horns' hits bloom as rings of light from the bells
    for (const h of this.horns) h.h.drawRings(GX, h.m, t, h.notes.filter((n) => t - n.t < 0.6), [0.55, 0.65, 0.9]);
    GX.render(renderer, out, this.st.cam);
    // labels on the instruments as they enter (bar 14) and the dynamic mark on the forte
    const T = this.text; T.clear();
    const c = T.ctx;
    c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.textAlign = 'center';
    for (const w of this.winds) {
      const first = w.notes.find((n) => n.t >= this.ctx.start - 0.01);
      if (!first) continue;
      const a = prog(t, first.t, first.t + 0.2) * (1 - prog(t, first.t + 2.2, first.t + 2.6));
      if (a <= 0) continue;
      const p = new THREE.Vector3().setFromMatrixPosition(w.w.group.matrixWorld).project(this.st.cam);
      if (p.z > 1) continue;
      c.globalAlpha = a; c.fillStyle = rgba('prussian', 1);
      c.fillText(w.label, (p.x * 0.5 + 0.5) * W, (0.5 - p.y * 0.5) * H + 40);
    }
    c.globalAlpha = 1;
    const sf = Math.max(0, ...this.tutti.map((x) => pulse(t, x, 0.18)));
    if (sf > 0.02) {
      // the forte mark in cobalt, haloed in white glaze
      c.font = font(F.serif(600, true), 260 + 40 * sf); c.textAlign = 'left';
      c.save();
      c.shadowColor = 'rgba(255,255,255,0.95)'; c.shadowBlur = 30 * sf;
      c.lineWidth = 10; c.strokeStyle = `rgba(255,255,255,${0.85 * sf})`; c.strokeText('f', 90, H - 120);
      c.fillStyle = rgba('prussian', 0.95 * sf); c.fillText('f', 90, H - 120);
      c.restore();
    }
    comp.draw(renderer, T.upload(), out);
    const sh = 12 * hit;
    return {
      ramp: 'porcelain', grade: 1, gradeSteps: 4, hatch: 0.3,
      bloom: 0.8, bloomThreshold: 1.05, halation: 0, grain: 0.05, vignette: 0.3,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.03 * hit, ca: 1 + 3 * hit,
    };
  }

  barU(t: number) {
    const d = this.downs;
    let i = 0;
    while (i + 2 < d.length && t >= d[i + 1]!) i++;
    return Math.min(1, Math.max(0, (t - d[i]!) / (d[i + 1]! - d[i]!)));
  }

  /** A key closing flashes: a glint on a key cup at each attack. */
  clacks(X: LineBatch, t: number) {
    const v = new THREE.Vector3();
    for (const w of this.winds) for (const n of w.notes) {
      const age = t - n.t;
      if (age < 0 || age > 0.25 || !w.w.keys.length) continue;
      const k = w.w.keys[Math.floor(hash(n.t * 31.7, 3) * w.w.keys.length)]!;
      k.getWorldPosition(v);
      const a = Math.pow(0.5, age / 0.06), s = (0.5 + 1.2 * a) * w.w.radius;
      X.seg(v.x - s, v.y, v.z + 0.6, v.x + s, v.y, v.z + 0.6, 0.12, 1, 1, 1, 0.8 * a);
      X.seg(v.x, v.y - s, v.z + 0.6, v.x, v.y + s, v.z + 0.6, 0.12, 1, 1, 1, 0.8 * a);
    }
  }

  /** Porcelain dust turning round the instruments, faster and denser as the music swells. */
  motes(X: LineBatch, t: number) {
    const lv = this.ctx.audio.env('rms', t);
    for (let i = 0; i < 320; i++) {
      const r = 20 + 130 * Math.sqrt(hash(i, 1)), a = hash(i, 2) * Math.PI * 2 + t * (0.15 + 0.25 * lv) * (0.7 + 0.6 * hash(i, 7));
      const period = 8 + 7 * hash(i, 3), ph = ((t + hash(i, 4) * period) % period) / period;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.6, y = 4 + ph * (110 + 40 * hash(i, 5));
      const al = Math.sin(Math.PI * ph) * (0.3 + 0.6 * lv);
      X.seg(x, y, z, x + 0.15, y + 0.5 + 0.8 * lv, z, 0.25 + 0.25 * hash(i, 6), LIN.cobalt[0], LIN.cobalt[1], LIN.cobalt[2], al);
    }
  }
}
