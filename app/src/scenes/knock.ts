// "Thus Fate knocks at the door." Bars 1-5 (and, with params.n = 2, bars 22-24): the motif is engraved
// on a staff in the void, note by note, at the instant each note sounds. Every note drops onto the
// staff and the five lines ring like strings; the long note holds under its fermata while the lines
// hum, and the caesura after it is black.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { strokeText, drawStrokeText, type StrokeText } from '../engine/stroke';
import { ENGRAVE } from '../engine/music';
import { Score, staffStep, type Motif } from '../engine/score';
import { clamp, ease, keys, lerp, prog, pulse, smoothstep, noise1, mulberry32 } from '../engine/util';
import { Stage3D, Void, Note3D, glyphMesh, noteMaterial, drawStaff, sparks, seedOf, type Pluck } from './_kit';

const MID = staffStep(71); // B4, the treble staff's middle line
const yOf = (p: number) => (staffStep(p) - MID) / 2;
const FALL = 0.11; // seconds a note takes to drop onto the staff

interface Drop { obj: THREE.Object3D; x: number; y: number; t: number; mat: THREE.MeshStandardMaterial; big: boolean; end: number }

/** One statement of the motif laid out on the staff: r8 x x x | long (| long tied). */
interface Statement { m: Motif; x0: number; drops: Drop[]; beam: THREE.Mesh; beamFrom: number; stemXs: number[]; beamY: number; longX: number; longY: number; fermata: THREE.Mesh; tFerm: number; fermEnd: number; gapEnd: number; tie?: { mesh: THREE.Mesh; t: number } }

export default class Knock extends Scene {
  st = new Stage3D();
  bg = new Void();
  lines = new LineBatch(60000, { screen2D: false, worldWidth: true, blend: 'max', depthTest: true });
  fx = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  text = new Layer2D();
  statements: Statement[] = [];
  n = 1;
  plucks: Pluck[] = [];
  red = false;
  staffMat = new THREE.Matrix4();
  furniture: THREE.MeshStandardMaterial = noteMaterial();

  override async init() {
    const sc = this.ctx.score;
    this.n = this.ctx.params.n ?? 1;
    this.red = this.n === 2;
    // the motifs of this entry, as Violin I plays them (it carries the tune in every statement)
    // (motifsFrom: also lay out statements played before this entry, already engraved when it starts)
    const ms = sc.motifs.filter((m) => m.t[0] >= (this.ctx.params.motifsFrom ?? this.ctx.start) - 1e-3 && m.t[0] < this.ctx.end && m.parts.length >= 4);
    const vl = (m: Motif) => m.pitches[Math.max(0, m.parts.indexOf('vl1'))]!;

    // staff furniture: clef, key signature (three flats), time signature, at the left end
    const S = this.st.scene;
    const fm = this.furniture;
    const clef = glyphMesh('gClef', 0.35, fm); clef.position.set(0.6, -1, 0); S.add(clef);
    [[3.4, 0], [4.3, 1.5], [5.2, -0.5]].forEach(([x, y]) => { const f = glyphMesh('accidentalFlat', 0.3, fm); f.position.set(x!, y!, 0); S.add(f); });
    const t2 = glyphMesh('timeSig2', 0.35, fm); t2.position.set(6.5, 1, 0); S.add(t2);
    const t4 = glyphMesh('timeSig4', 0.35, fm); t4.position.set(6.5, -1, 0); S.add(t4);

    let x = 9;
    ms.forEach((m, si) => {
      const p = vl(m);
      const st = this.layoutStatement(m, p, x, si);
      this.statements.push(st);
      x = st.longX + (m.end - m.t[3] > 3 ? 9 : 6);
    });
    // the scene-wide plucks (sorted by time)
    for (const s of this.statements) for (const d of s.drops) this.plucks.push({ t: d.t, x: d.x, amp: d.big ? 0.55 : 0.28 });
    this.plucks.sort((a, b) => a.t - b.t);
  }

  /** Place one statement (rest, three beamed eighths, barline, the long note(s), fermata). */
  layoutStatement(m: Motif, p: number[], x0: number, si: number): Statement {
    const sc = this.ctx.score, S = this.st.scene;
    const mat = (big: boolean) => {
      const mm = noteMaterial(this.red ? LIN.signal : LIN.bone);
      if (this.red) mm.roughness = 0.25;
      return big ? mm : mm;
    };
    const rest = glyphMesh('rest8th', 0.3, this.furniture); rest.position.set(x0, 0, 0); S.add(rest);
    const drops: Drop[] = [];
    const stemXs: number[] = [];
    for (let k = 0; k < 3; k++) {
      const mm = mat(false);
      const n = new Note3D('black', true, 0.55, mm);
      const x = x0 + 2.2 + k * 2.1, y = yOf(p[k]!);
      S.add(n.group);
      drops.push({ obj: n.group, x, y, t: m.t[k]!, mat: mm, big: false, end: m.t[k]! + 0.14 });
      stemXs.push(x + ENGRAVE.noteheadBlackW / 2 - ENGRAVE.stem * 0.8);
    }
    const beamY = yOf(p[0]!) + ENGRAVE.stemUpSE[1] + ENGRAVE.stemLength - 0.25;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1, ENGRAVE.beam, 0.4), mat(false));
    beam.position.y = beamY; S.add(beam);
    // barline after bar 1 of the statement
    const bl = (x: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(ENGRAVE.thinBarline * 1.4, 4, 0.2), this.furniture); b.position.set(x, 0, 0); S.add(b); };
    const xBar1 = x0 + 2.2 + 3 * 2.1 + 0.4;
    bl(xBar1);
    // the long note: one half note, or two tied half notes when it lasts two bars
    const longP = p[3]!, longY = yOf(longP);
    const bars = sc.bars.filter((b) => b.t >= m.t[3] - 1e-3 && b.t < m.end - 1e-3);
    const longX = xBar1 + 2.4;
    const mm = mat(true);
    const h1 = new Note3D('half', longY < 0, 0.6, mm);
    S.add(h1.group);
    drops.push({ obj: h1.group, x: longX, y: longY, t: m.t[3], mat: mm, big: true, end: m.end });
    let tie: Statement['tie'];
    let fx = longX;
    if (bars.length > 1) {
      const xBar2 = longX + 3.2;
      bl(xBar2);
      const x2 = xBar2 + 2.4;
      const mm2 = mat(true);
      const h2 = new Note3D('half', longY < 0, 0.6, mm2);
      S.add(h2.group);
      drops.push({ obj: h2.group, x: x2, y: longY, t: bars[1]!.t, mat: mm2, big: true, end: m.end });
      // the tie: a flat arc under the noteheads
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(longX + 0.5, longY - 0.6, 0), new THREE.Vector3((longX + x2) / 2, longY - 1.6, 0), new THREE.Vector3(x2 - 0.5, longY - 0.6, 0));
      const tm = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.09, 8, false), mat(false));
      S.add(tm);
      tie = { mesh: tm, t: bars[1]!.t };
      fx = x2;
    }
    bl(fx + 3.0);
    const ferm = sc.fermatas.find((f) => f.t >= m.t[3] - 1e-3 && f.t < m.end + 1e-3)!;
    const fermata = glyphMesh('fermataAbove', 0.35, mat(true));
    fermata.position.set(fx - 1.2, 3.2, 0);
    S.add(fermata);
    void si;
    return { m, x0, drops, beam, beamFrom: stemXs[0]!, stemXs, beamY, longX: fx, longY, fermata, tFerm: ferm.t, fermEnd: ferm.end, gapEnd: ferm.end + ferm.gap, tie };
  }

  /** The camera: one shot per statement, cut at the statement's first note. */
  camera(t: number) {
    const sts = this.statements;
    let i = 0;
    while (i + 1 < sts.length && t >= sts[i + 1]!.m.t[0] - 0.14) i++;
    const s = sts[i]!;
    const a = s.drops[0]!.x, z = s.longX;
    const t0 = s.m.t[0], tL = s.m.t[3], tE = s.fermEnd;
    const sh = (this.n === 2 ? 2 : 0) + i;
    let eye: THREE.Vector3, at: THREE.Vector3, roll = 0, fov = 30;
    if (sh === 0) {
      // low along the staff, then a slow push to the long note under its fermata
      const k = prog(t, tL, tE, ease.inOutCubic);
      const tr = prog(t, t0 - 0.15, tL, ease.outCubic);
      eye = new THREE.Vector3(lerp(a - 9, a - 4, tr), lerp(1.8, 2.6, tr), lerp(9.5, 8.5, tr)).lerp(new THREE.Vector3(z - 2.4, 0.9, 10.5), k);
      at = new THREE.Vector3(lerp(a + 3, z, tr), lerp(0.2, 0, tr), 0).lerp(new THREE.Vector3(z - 0.5, 1.5, 0), k);
      roll = lerp(-0.05, 0.05, k);
      fov = lerp(32, 30, k);
    } else if (sh === 1) {
      // from above and in front; under the long fermata the camera cranes up and away to show both statements
      const k = prog(t, tL + 0.4, tE, ease.inOutCubic);
      const first = sts[0]!.drops[0]!.x;
      eye = new THREE.Vector3(lerp(a + 4, (first + z) / 2 + 2, k), lerp(5.5, 16, k), lerp(11, 30, k));
      at = new THREE.Vector3(lerp(a + 5.5, (first + z) / 2 + 2, k), lerp(-0.4, -2.5, k), 0);
      roll = lerp(0.09, 0, k);
      fov = lerp(30, 34, k);
    } else {
      // the second knock: close, dutch, the camera thrown back on every hit
      const hit = Math.max(...s.drops.map((d) => pulse(t, d.t, 0.09)));
      const k = prog(t, tL, tE, ease.inOutQuad);
      eye = new THREE.Vector3(lerp(a - 2, z - 4.5, k), lerp(-1.5, 3.4, k) + hit * 0.25, lerp(7.2, 9.5, k) + hit * 0.8);
      at = new THREE.Vector3(lerp(a + 3.5, z - 0.5, k), lerp(0.4, 0.2, k), 0);
      roll = lerp(-0.16, -0.06, k);
      fov = lerp(30, 36, k);
    }
    // a little handheld breath
    eye.x += noise1(t * 0.7, 11) * 0.08; eye.y += noise1(t * 0.6, 12) * 0.06;
    this.st.look(eye, at, roll, fov);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    // where are we: during a caesura the frame is black
    for (const s of this.statements) if (t >= s.fermEnd && t < s.gapEnd) {
      this.bg.render(renderer, out, t, 0, 0);
      this.drawText(t); comp.draw(renderer, this.text.upload(), out);
      return { fade: 0, bloom: 0.6, grain: 0.06 };
    }
    this.camera(t);

    // notes: drop, land, settle, glow while sounding
    let hit = 0, held = 0, heldX = 0;
    for (const s of this.statements) {
      for (const d of s.drops) {
        const u = (t - (d.t - FALL)) / FALL;
        d.obj.visible = u >= 0;
        if (!d.obj.visible) continue;
        const age = t - d.t;
        let y = d.y, sx = 1, sy = 1;
        if (age < 0) y = d.y + 16 * Math.pow(1 - clamp(u), 2);
        else {
          const sq = Math.exp(-age * 18) * Math.cos(age * 55);
          sy = 1 - 0.22 * sq; sx = 1 + 0.16 * sq;
        }
        d.obj.position.set(d.x, y, 0);
        d.obj.scale.set(sx, sy, 1);
        const sounding = t >= d.t && t < d.end;
        d.mat.emissiveIntensity = 5 * pulse(t, d.t, 0.07) + (sounding ? (d.big ? 0.6 + 1.1 * f.a.rms : 0.4) : 0) + (this.red ? 0.35 : 0);
        hit = Math.max(hit, pulse(t, d.t, d.big ? 0.12 : 0.07) * (d.big ? 1 : 0.6));
        if (d.big && sounding) { held = Math.max(held, f.a.rms); heldX = d.x; }
      }
      // the beam grows from stem to stem as the eighths land
      const landed = s.stemXs.filter((_, k) => t >= s.drops[k]!.t).length;
      s.beam.visible = landed >= 1;
      if (landed >= 1) {
        const xr = landed === 1 ? s.stemXs[0]! + 0.9 : s.stemXs[landed - 1]!;
        const grow = landed >= 2 ? prog(t, s.drops[landed - 1]!.t, s.drops[landed - 1]!.t + 0.05, ease.outCubic) : 1;
        const x1 = landed >= 2 ? lerp(s.stemXs[landed - 2]!, xr, grow) : xr;
        const x0 = s.stemXs[0]! - ENGRAVE.stem * 0.8;
        s.beam.scale.x = Math.max(0.01, x1 - x0 + ENGRAVE.stem * 1.6);
        s.beam.position.x = (x0 + x1 + ENGRAVE.stem * 1.6) / 2;
        const lastDrop = s.drops[Math.max(0, landed - 1)]!;
        const by = t < lastDrop.t ? 0 : 0;
        s.beam.position.y = s.beamY + by;
      }
      // the fermata descends onto the long note and burns
      const fu = prog(t, s.tFerm + 0.05, s.tFerm + 0.55, ease.outExpo);
      s.fermata.visible = t >= s.tFerm + 0.05;
      s.fermata.position.y = lerp(9, 3.2, fu);
      (s.fermata.material as THREE.MeshStandardMaterial).emissiveIntensity = t < s.fermEnd ? 1.5 + 2.5 * pulse(t, s.tFerm + 0.55, 0.25) : 0;
      if (s.tie) s.tie.mesh.visible = t >= s.tie.t;
    }

    // lighting: the key light dims under the fermata, the rim light flares on hits
    this.st.key.intensity = 1.6 + 0.9 * hit;
    this.st.rim.intensity = 2 + 10 * hit;
    this.furniture.emissiveIntensity = 0.15 * hit;

    this.bg.render(renderer, out, t, 0.3 * hit + 0.8 * held, 0);
    this.st.render(renderer, out);

    // staff lines, ringing; sparks on impact
    const L = this.lines; L.clear();
    const xs = this.statements.flatMap((s) => s.drops.map((d) => d.x));
    const x1 = Math.max(...xs) + 220;
    const lineCol = this.red ? LIN.signal : LIN.bone;
    const lk = this.red ? 0.32 : 0.55;
    drawStaff(L, this.staffMat, t, -1.5, x1, this.plucks, { color: [lineCol[0] * lk, lineCol[1] * lk, lineCol[2] * lk], width: ENGRAVE.staffLine * 1.2, hum: 0.05 * held, humAt: heldX, seg: 400 });
    L.render(renderer, out, this.st.cam);
    const X = this.fx; X.clear();
    for (const s of this.statements) for (const [k, d] of s.drops.entries()) {
      sparks(X, t, d.t, d.x, d.y - 0.3, 0, seedOf(d.t, k), { count: d.big ? 160 : 55, speed: d.big ? 17 : 11, life: d.big ? 1.3 : 0.7, gain: this.red ? 9 : 6 });
    }
    X.render(renderer, out, this.st.cam);

    this.drawText(t);
    comp.draw(renderer, this.text.upload(), out);

    const sh = hit * (this.red ? 14 : 9);
    return {
      bloom: 0.9, bloomThreshold: 1.1, halation: 0.2, grain: 0.06, vignette: 0.45,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh],
      zoom: 1 + 0.025 * hit, ca: 1.2 + 3 * hit,
    };
  }

  syl: StrokeText[] = [];
  /** Screen position (logical px) of a point on the staff plane, and px per staff space there. */
  proj(x: number, y: number) {
    const cam = this.st.cam;
    const a = new THREE.Vector3(x, y, 0).project(cam), b = new THREE.Vector3(x, y + 1, 0).project(cam);
    return { x: (a.x * 0.5 + 0.5) * W, y: (0.5 - a.y * 0.5) * H, k: Math.abs((a.y - b.y) * 0.5 * H), ok: a.z < 1 };
  }

  /**
   * The 2D layer: a hand annotating the score as it is played. Each note gets its syllable written in
   * script as it sounds (da, da, da, DUM); once the long note lands a red pencil rings the three
   * eighths and arrows them into it, a bracket under the staff groups the motif, and a mono label
   * files it. Everything is drawn progressively (stroke length over time), wobbling like a hand.
   */
  annotate(t: number) {
    if (!this.syl.length) this.syl = ['da', 'da', 'da', 'DUM'].map((w) => strokeText(w, 'script', 100));
    const c = this.text.ctx;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    this.statements.forEach((s, si) => {
      if (t < s.m.t[0]) return;
      const R = mulberry32(31 + si);
      // syllables: written while each note sounds
      s.drops.slice(0, 4).forEach((d, k) => {
        const big = k === 3;
        const p = big ? this.proj(d.x - 0.4, s.longY - 3.1) : this.proj(d.x - 0.2, s.beamY + 1.3);
        if (!p.ok) return;
        const st = this.syl[k]!;
        const dur = big ? 0.4 : 0.12;
        const len = st.total * prog(t, d.t, d.t + dur, ease.outQuad);
        if (len <= 0) return;
        const size = p.k * (big ? 1.7 : 1.1);
        c.save();
        c.translate(p.x - (st.width * size) / 200, p.y);
        c.scale(size / 100, size / 100);
        c.strokeStyle = big ? rgba('signal', 1) : rgba('bone', 0.95);
        c.lineWidth = (big ? 5 : 3.5) * 100 / size;
        drawStrokeText(c, st, len);
        c.restore();
      });
      const t3 = s.m.t[3];
      // the red pencil: a loop around the three eighths, then an arrow into the long note
      const e0 = s.drops[0]!, e2 = s.drops[2]!;
      const cx = (e0.x + e2.x) / 2, cy = (e0.y + s.beamY) / 2;
      const ring = prog(t, t3 + 0.1, t3 + 0.55, ease.inOutCubic);
      if (ring > 0) {
        c.strokeStyle = rgba('signal', 0.95);
        c.lineWidth = 3;
        c.beginPath();
        const N = 90, turns = 1.12;
        const rx = (e2.x - e0.x) / 2 + 1.6, ry = (s.beamY - e0.y) / 2 + 1.4;
        for (let i = 0; i <= N * ring; i++) {
          const a = -2.2 + (i / N) * turns * Math.PI * 2;
          const wob = 1 + 0.06 * Math.sin(i * 0.31 + R() * 0.3) + 0.04 * (i / N);
          const q = this.proj(cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob);
          if (i === 0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y);
        }
        c.stroke();
      }
      const arrow = prog(t, t3 + 0.45, t3 + 0.75, ease.outCubic);
      if (arrow > 0) {
        const a = this.proj(e2.x + 2.2, cy + 0.8), b = this.proj(s.longX - 1.2, s.longY + 1.6);
        const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 60;
        const P = (u: number) => ({ x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y });
        c.strokeStyle = rgba('signal', 0.95); c.lineWidth = 3;
        c.beginPath();
        for (let i = 0; i <= 40 * arrow; i++) { const q = P(i / 40); if (i === 0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y); }
        c.stroke();
        if (arrow >= 1) {
          const q = P(1), q0 = P(0.94), ang = Math.atan2(q.y - q0.y, q.x - q0.x);
          c.beginPath();
          c.moveTo(q.x - 16 * Math.cos(ang - 0.45), q.y - 16 * Math.sin(ang - 0.45)); c.lineTo(q.x, q.y);
          c.lineTo(q.x - 16 * Math.cos(ang + 0.45), q.y - 16 * Math.sin(ang + 0.45));
          c.stroke();
        }
      }
      // the bracket under the staff and its label
      // (the second statement's caption is the title block, so it gets no bracket of its own)
      const br = prog(t, t3 + 0.6, t3 + 0.95, ease.outCubic);
      if (br > 0 && !(this.n === 1 && si === 1)) {
        const L = this.proj(e0.x - 0.8, -4.6), Rr = this.proj(s.longX + 0.9, -4.6);
        const xr = lerp(L.x, Rr.x, br), yr = lerp(L.y, Rr.y, br);
        c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 2;
        c.beginPath(); c.moveTo(L.x, L.y - 14); c.lineTo(L.x, L.y); c.lineTo(xr, yr); if (br >= 1) c.lineTo(Rr.x, Rr.y - 14); c.stroke();
        c.globalAlpha = prog(t, t3 + 0.85, t3 + 1.1);
        c.font = font(F.mono(500), 17); c.letterSpacing = '3px';
        c.fillStyle = rgba('bone', 0.95);
        const bars = si === 0 ? 'm. 1–2' : 'm. 3–5';
        c.fillText(`MOTIF · 3 + 1 · ${bars}`, L.x, L.y + 30);
        c.fillStyle = rgba('signal', 1);
        c.fillText(`♪ = ${(s.drops[1]!.t - s.drops[0]!.t).toFixed(3)} s`, L.x, L.y + 56);
        c.globalAlpha = 1;
      }
    });
    c.restore();
  }

  /** Words under the first statement's long fermata, and the footnote. */
  drawText(t: number) {
    const T = this.text; T.clear();
    this.annotate(t);
    if (this.n !== 1 || this.statements.length < 2) return;
    const s = this.statements[1]!;
    const a0 = s.m.t[3] + 0.5;
    const a = smoothstep(a0, a0 + 0.4, t) * (1 - smoothstep(s.gapEnd - 0.05, s.gapEnd, t));
    if (a <= 0) return;
    const c = T.ctx;
    c.save();
    c.globalAlpha = a;
    c.textBaseline = 'alphabetic';
    const line = 'So pocht das Schicksal an die Pforte.';
    const n = Math.floor(line.length * prog(t, a0, a0 + 1.1));
    c.letterSpacing = '6px';
    c.font = font(F.mono(500), 18);
    c.fillStyle = rgba('signal', prog(t, a0 + 0.1, a0 + 0.5));
    c.fillText('SYMPHONIE NR. 5 · C-MOLL · OP. 67 · 1808', 132, H - 250);
    c.letterSpacing = '0px';
    c.font = font(F.serif(400, true), 104);
    c.fillStyle = rgba('bone', 0.96);
    c.fillText(line.slice(0, n), 120, H - 130);
    c.font = font(F.mono(400), 19);
    c.fillStyle = rgba('ash', 0.9 * prog(t, a0 + 0.9, a0 + 1.4));
    c.fillText('“Thus Fate knocks at the door.” — Beethoven on the opening, as Anton Schindler told it (1840).', 132, H - 78);
    c.restore();
    void W;
  }
}
