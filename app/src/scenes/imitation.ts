// Bars 6-21: the motif is handed from voice to voice (Violin II, Viola, Violin I, again, then the
// basses). The string section is a five-staff system in space, engraved at time-proportional positions
// as it sounds; the camera's attention jumps to whichever voice has the motif, and an arc links each
// entry to the next like an attention head finding the pattern. Bars 19-21: the tutti chords and the
// first violins' high G held under a fermata; the caesura after it is black.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { ENGRAVE, type GlyphName } from '../engine/music';
import { staffStep, type Motif, type Note } from '../engine/score';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep } from '../engine/util';
import { Stage3D, Void, Note3D, glyphMesh, noteMaterial, drawStaff, sparks, seedOf, mixRGB, type Pluck } from './_kit';
import { Plan, Model } from './imitation-plan';

type Clef = 'treble' | 'alto' | 'bass';
const STAVES: { id: string; label: string; y: number; clef: Clef; written: number }[] = [
  { id: 'vl1', label: 'VL. I', y: 16, clef: 'treble', written: 0 },
  { id: 'vl2', label: 'VL. II', y: 8, clef: 'treble', written: 0 },
  { id: 'va', label: 'VA.', y: 0, clef: 'alto', written: 0 },
  { id: 'vc', label: 'VC.', y: -8, clef: 'bass', written: 0 },
  { id: 'cb', label: 'CB.', y: -16, clef: 'bass', written: 12 }, // the basses are written an octave up
];
/** Staff step of each clef's middle line (B4, C4, D3). */
const MID: Record<Clef, number> = { treble: staffStep(71), alto: staffStep(60), bass: staffStep(50) };
const KEYSIG: Record<Clef, number[]> = { treble: [0, 1.5, -0.5], alto: [-0.5, 1, -1], bass: [-1, 0.5, -1.5] };
const CLEF: Record<Clef, [GlyphName, number]> = { treble: ['gClef', -1], alto: ['cClef', 0], bass: ['fClef', 1] };
/** Accidental for a pitch class outside C minor (E, A, B naturals; F sharp; D flat). */
const ACC: Record<number, GlyphName> = { 4: 'accidentalNatural', 9: 'accidentalNatural', 11: 'accidentalNatural', 6: 'accidentalSharp', 1: 'accidentalFlat' };
const SPEED = 16; // staff spaces per second (an eighth at this tempo ≈ 2.2 spaces)

interface N3 { n: Note; obj: THREE.Object3D; mat: THREE.MeshStandardMaterial; x: number; y: number; staff: number; tail: number }

export default class Imitation extends Scene {
  st = new Stage3D();
  bg = new Void();
  lines = new LineBatch(40000, { screen2D: false, worldWidth: true, blend: 'max', depthTest: true });
  fx = new LineBatch(30000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  text = new Layer2D();
  notes: N3[] = [];
  plucks: Pluck[][] = STAVES.map(() => []);
  motifs: Motif[] = [];
  furniture = noteMaterial();
  fermata!: THREE.Mesh;
  ferm!: { t: number; end: number; gap: number };
  tChords = 0;
  barX: { n: number; x: number }[] = [];
  beams: { mesh: THREE.Mesh; t: number }[] = [];
  x0 = 0;
  // bars 6-12: the seating plan and the next-note model (2D)
  plan!: Plan;
  model!: Model;
  tPlanEnd = 0;
  planLayer = new Layer2D();
  planGlow = new LineBatch(4000, { screen2D: true, blend: 'add' });

  X(t: number) { return (t - this.ctx.start) * SPEED + 12; }

  override async init() {
    const sc = this.ctx.score, S = this.st.scene;
    const { start, end } = this.ctx;
    this.motifs = sc.motifs.filter((m) => m.t[0] >= start && m.t[0] < end);
    this.ferm = sc.fermatas.find((f) => f.bar === 21)!;
    this.tChords = sc.bar(19).t;
    this.tPlanEnd = sc.bar(13).t;
    this.plan = new Plan(sc, start, this.tPlanEnd);
    this.model = new Model(this.plan);
    // system furniture at the left: clefs, key signatures, a bracket
    STAVES.forEach((s) => {
      const [g, gy] = CLEF[s.clef];
      const c = glyphMesh(g, 0.35, this.furniture); c.position.set(0.5, s.y + gy, 0); S.add(c);
      KEYSIG[s.clef].forEach((y, i) => { const f = glyphMesh('accidentalFlat', 0.3, this.furniture); f.position.set(3.6 + i * 0.9, s.y + y, 0); S.add(f); });
    });
    const br = new THREE.Mesh(new THREE.BoxGeometry(ENGRAVE.thickBarline, 36, 0.3), this.furniture); br.position.set(-0.6, 0, 0); S.add(br);
    // barlines through the whole system
    for (const b of sc.bars.filter((b) => b.t >= start - 1e-3 && b.t < end)) {
      const x = this.X(b.t) - 1.6;
      this.barX.push({ n: b.n, x });
      for (const s of STAVES) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(ENGRAVE.thinBarline * 1.3, 4, 0.16), this.furniture);
        m.position.set(x, s.y, 0); S.add(m);
      }
    }
    // the notes, string section only
    for (const n of sc.notesIn(start, end)) {
      const pid = sc.parts[n.part]!.id;
      const si = STAVES.findIndex((s) => s.id === pid);
      if (si < 0) continue;
      const s = STAVES[si]!;
      const y = s.y + (staffStep(n.p + s.written) - MID[s.clef]) / 2;
      const kind = n.qd >= 4 - 1e-6 ? 'whole' : n.qd >= 2 - 1e-6 ? 'half' : 'black';
      const mat = noteMaterial();
      const g = new Note3D(kind, y < s.y, 0.45, mat);
      const acc = ACC[((n.p % 12) + 12) % 12];
      if (acc) { const a = glyphMesh(acc, 0.25, mat); a.position.set(-1.9, 0, 0); g.group.add(a); }
      // ledger lines above/below the staff
      const off = y - s.y;
      for (let l = 3; l <= Math.abs(off) + 1e-6; l++) {
        const lg = new THREE.Mesh(new THREE.BoxGeometry(ENGRAVE.noteheadBlackW + 2 * ENGRAVE.legerExtension, ENGRAVE.legerLine * 1.4, 0.12), mat);
        lg.position.set(0, Math.sign(off) * l - off, 0); g.group.add(lg);
      }
      const x = this.X(n.t);
      S.add(g.group);
      this.notes.push({ n, obj: g.group, mat, x, y, staff: si, tail: n.d * SPEED });
      this.plucks[si]!.push({ t: n.t, x, amp: 0.05 + 0.25 * (n.v / 127) ** 2 });
    }
    // beams: consecutive eighths of a part within a bar, joined stem-end to stem-end
    const byPart = new Map<number, N3[]>();
    for (const k of this.notes) { const a = byPart.get(k.staff) ?? []; a.push(k); byPart.set(k.staff, a); }
    for (const list of byPart.values()) {
      const tops = new Map<string, N3>(); // one note per onset: the one furthest from the staff
      for (const k of list) { const key = k.n.q.toFixed(3); const o = tops.get(key); if (!o || Math.abs(k.y - STAVES[k.staff]!.y) > Math.abs(o.y - STAVES[o.staff]!.y)) tops.set(key, k); }
      const seq = [...tops.values()].sort((a, b) => a.n.q - b.n.q);
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1]!, b = seq[i]!;
        if (a.n.qd > 0.5 + 1e-6 || b.n.qd > 0.5 + 1e-6 || a.n.bar !== b.n.bar || Math.abs(b.n.q - a.n.q - 0.5) > 1e-6) continue;
        const sy = STAVES[a.staff]!.y, up = a.y < sy;
        const ex = (k: N3) => k.x + (up ? ENGRAVE.noteheadBlackW / 2 - 0.1 : -ENGRAVE.noteheadBlackW / 2 + 0.1);
        const ey = (k: N3) => k.y + (up ? ENGRAVE.stemLength + 0.1 : -ENGRAVE.stemLength - 0.1);
        const len = Math.hypot(ex(b) - ex(a), ey(b) - ey(a));
        const beam = new THREE.Mesh(new THREE.BoxGeometry(len + ENGRAVE.stem, ENGRAVE.beam, 0.3), a.mat);
        beam.position.set((ex(a) + ex(b)) / 2, (ey(a) + ey(b)) / 2 - (up ? ENGRAVE.beam / 2 : -ENGRAVE.beam / 2), 0);
        beam.rotation.z = Math.atan2(ey(b) - ey(a), ex(b) - ex(a));
        S.add(beam);
        this.beams.push({ mesh: beam, t: b.n.t });
      }
    }
    // the fermata over the first violins' G
    const g = this.notes.find((k) => k.n.bar === 21 && k.staff === 0 && k.n.qd >= 2)!;
    this.fermata = glyphMesh('fermataAbove', 0.35, noteMaterial(LIN.signal));
    this.fermata.position.set(g.x - 1.2, Math.max(g.y + 2, 16 + 3.2), 0);
    S.add(this.fermata);
  }

  /** Which staff has the motif's attention at t (the latest motif entry, else Violin I). */
  focus(t: number) {
    let y = 16, tt = this.ctx.start, from = 16;
    for (const m of this.motifs) {
      if (m.t[0] - 0.08 > t) break;
      const s = STAVES.find((s) => m.parts.includes(s.id));
      if (!s) continue;
      from = y; y = s.y; tt = m.t[0] - 0.08;
    }
    return lerp(from, y, prog(t, tt, tt + 0.32, ease.outExpo));
  }

  camera(t: number) {
    const P = this.X(t);
    const f = this.ferm;
    let eye: THREE.Vector3, at: THREE.Vector3, roll = 0, fov = 32;
    if (t < this.tChords) {
      const fy = this.focus(t);
      const k = prog(t, this.ctx.score.bar(13).t, this.tChords, ease.inOutQuad);
      const dist = lerp(30, 40, k);
      eye = new THREE.Vector3(P - lerp(9, 5, k), fy + lerp(3.5, 2, k), dist);
      at = new THREE.Vector3(P + 7, fy - 0.5, 0);
      roll = lerp(0.05, -0.04, k) + 0.01 * noise1(t * 0.4, 3);
    } else if (t < f.t) {
      // the chords: the whole system, square on, thrown back by each hit
      const hit = pulse(t, this.tChords, 0.15) + pulse(t, this.ctx.score.bar(20).t, 0.15);
      eye = new THREE.Vector3(P - 22, 0, 84 + 6 * hit);
      at = new THREE.Vector3(P - 18, 0, 0);
      fov = 34;
    } else {
      // the fermata: slow push to the held G, the rest of the orchestra falling away
      const k = prog(t, f.t, f.end, ease.inOutCubic);
      const gx = this.X(f.t);
      eye = new THREE.Vector3(lerp(gx - 3, gx - 1.5, k), lerp(4, 16.5, k), lerp(70, 16, k));
      at = new THREE.Vector3(gx, lerp(0, 17.5, k), 0);
      roll = lerp(0, 0.06, k);
      fov = lerp(34, 30, k);
    }
    eye.x += noise1(t * 0.7, 11) * 0.12; eye.y += noise1(t * 0.6, 12) * 0.1;
    this.st.look(eye, at, roll, fov);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, fe = this.ferm;
    if (t < this.tPlanEnd) return this.renderPlan(f, out);
    if (t >= fe.end) { // the caesura
      this.bg.render(renderer, out, t);
      this.text.clear(); comp.draw(renderer, this.text.upload(), out);
      return { grain: 0.06 };
    }
    this.camera(t);
    const inFerm = t >= fe.t;
    const fermK = prog(t, fe.t, fe.t + 0.6);
    let hit = 0;
    for (const k of this.notes) {
      const n = k.n, age = t - n.t;
      k.obj.visible = age >= -0.02;
      if (!k.obj.visible) continue;
      const pop = Math.exp(-Math.max(0, age) * 16);
      const s = 1 + 0.9 * pop;
      k.obj.scale.set(s, s, 1);
      k.obj.position.set(k.x, k.y, 1.2 * pop);
      const sounding = t < n.t + n.d;
      const isG = n.bar === 21 && k.staff === 0 && n.qd >= 2;
      k.mat.emissiveIntensity = 4 * pulse(t, n.t, 0.06) + (sounding ? 0.5 + 0.6 * (n.v / 127) : 0) + (isG && inFerm ? 1.2 + f.a.rms * 2 : 0);
      // under the fermata everything but the held G falls into the dark
      const dim = inFerm && !isG ? 1 - 0.85 * fermK : 1;
      k.mat.color.setRGB(LIN.bone[0] * dim, LIN.bone[1] * dim, LIN.bone[2] * dim, THREE.LinearSRGBColorSpace);
      hit = Math.max(hit, pulse(t, n.t, 0.08) * (n.v / 127) ** 2);
    }
    this.fermata.visible = inFerm;
    this.fermata.position.y = lerp(26, 19.6, prog(t, fe.t, fe.t + 0.5, ease.outExpo));
    (this.fermata.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + 2 * pulse(t, fe.t + 0.5, 0.3);
    this.furniture.color.setRGB(...(inFerm ? (LIN.bone.map((c) => c * (1 - 0.85 * fermK)) as [number, number, number]) : LIN.bone), THREE.LinearSRGBColorSpace);

    const chordHit = pulse(t, this.tChords, 0.12) + pulse(t, this.ctx.score.bar(20).t, 0.12) + pulse(t, fe.t, 0.12);
    this.st.key.intensity = 1.6 + 1.0 * hit;
    this.st.rim.intensity = 2 + 8 * hit;
    this.bg.render(renderer, out, t, 0.12 * f.a.strings + 0.22 * chordHit, 0);
    for (const b of this.beams) b.mesh.visible = t >= b.t - 0.02;
    this.st.render(renderer, out);

    // staves (ringing) and sounding-note trails
    const L = this.lines; L.clear();
    const P = this.X(t);
    const m = new THREE.Matrix4();
    STAVES.forEach((s, i) => {
      m.makeTranslation(0, s.y, 0);
      const dim = inFerm && i !== 0 ? 1 - 0.85 * fermK : 1;
      drawStaff(L, m, t, -1.5, P + 160, this.plucks[i]!, { color: [LIN.bone[0] * 0.5 * dim, LIN.bone[1] * 0.5 * dim, LIN.bone[2] * 0.5 * dim], width: ENGRAVE.staffLine * 1.4, seg: 500 });
    });
    L.render(renderer, out, this.st.cam);
    const X = this.fx; X.clear();
    for (const k of this.notes) {
      const n = k.n;
      if (t < n.t || t > n.t + n.d + 0.4) continue;
      const u = clamp((t - n.t) / n.d);
      const fade = 1 - smoothstep(n.t + n.d, n.t + n.d + 0.4, t);
      const c = mixRGB(LIN.ember, LIN.signal, u);
      const g = 2.2 * fade * (0.4 + (n.v / 127));
      X.seg(k.x + 0.8, k.y, 0.05, k.x + 0.8 + k.tail * u, k.y, 0.05, 0.16, c[0] * g, c[1] * g, c[2] * g, 1);
    }
    // the playhead: a hairline through the system where the music is now
    if (!inFerm) { const g = 0.5 + 1.5 * hit; X.seg(P, -18.5, 0.1, P, 18.5, 0.1, 0.05, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 0.8); }
    // the attention arcs: each motif entry reaches back to the one before it
    for (let i = 1; i < this.motifs.length; i++) {
      const a = this.motifs[i - 1]!, b = this.motifs[i]!;
      const sa = STAVES.find((s) => a.parts.includes(s.id)), sb = STAVES.find((s) => b.parts.includes(s.id));
      if (!sa || !sb) continue;
      const grow = prog(t, b.t[0] - 0.05, b.t[0] + 0.3, ease.outCubic);
      if (grow <= 0) continue;
      const life = inFerm ? 1 - fermK : 1;
      const ax = this.X(a.t[0]), bx = this.X(b.t[0]);
      const p0 = new THREE.Vector3(ax, sa.y + 2.6, 0), p2 = new THREE.Vector3(bx, sb.y + 2.6, 0);
      const p1 = new THREE.Vector3((ax + bx) / 2, Math.max(sa.y, sb.y) + 7 + Math.abs(sa.y - sb.y) * 0.3, 5);
      const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
      const N = 48, fresh = pulse(t, b.t[0] + 0.3, 0.5);
      for (let j = 0; j < N * grow; j++) {
        const q0 = curve.getPoint(j / N), q1 = curve.getPoint(Math.min(grow, (j + 1) / N));
        const g = (0.9 + 3 * fresh) * life;
        X.seg(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, 0.09, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 1);
      }
    }
    // chord hits throw sparks off the system
    for (const [i, tc] of [this.tChords, this.ctx.score.bar(20).t].entries()) {
      for (let s = 0; s < 5; s++) sparks(X, t, tc, this.X(tc), STAVES[s]!.y, 0, seedOf(tc, s), { count: 50, speed: 16, life: 0.9 });
      void i;
    }
    X.render(renderer, out, this.st.cam);

    this.drawText(t, inFerm ? 1 - fermK : 1);
    comp.draw(renderer, this.text.upload(), out);
    const sh = 10 * chordHit + 2 * hit;
    return {
      bloom: 0.9, bloomThreshold: 1.1, halation: 0.2, grain: 0.06, vignette: 0.45,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.03 * chordHit, ca: 1.2 + 3 * chordHit,
    };
  }

  /** Bars 6-12: the plan and the model, flat, with a slow push and a nudge on every entry. */
  renderPlan(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    this.bg.render(renderer, out, t, 0, 0.3);
    const L = this.planLayer; L.clear();
    const G = this.planGlow; G.clear();
    this.plan.draw(t, L, G, f.beatPhase);
    this.model.draw(t, L);
    comp.draw(renderer, L.upload(), out);
    G.render(renderer, out);
    const entry = Math.max(0, ...this.motifs.map((m) => pulse(t, m.t[0], 0.12)));
    const k = prog(t, this.ctx.start, this.tPlanEnd, ease.inOutQuad);
    return {
      gradeSteps: 0, hatch: 0, bloom: 0.8, bloomThreshold: 1.05, grain: 0.05, vignette: 0.4,
      zoom: 1 + 0.035 * k + 0.012 * entry, shake: [noise1(t * 30, 1) * 2 * entry, noise1(t * 30, 2) * 2 * entry],
    };
  }

  /** Part labels at the left edge, bar numbers over the system, and the attention weights. */
  drawText(t: number, a: number) {
    const T = this.text; T.clear();
    const c = T.ctx;
    const cam = this.st.cam;
    const proj = (x: number, y: number, z = 0) => { const v = new THREE.Vector3(x, y, z).project(cam); return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H, ok: v.z < 1 }; };
    c.save();
    c.globalAlpha = a;
    c.textBaseline = 'middle';
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    const P = this.X(t);
    for (const s of STAVES) {
      const p = proj(P - 8, s.y);
      if (p.ok && p.y > 40 && p.y < H - 40) { c.fillStyle = rgba('ash', 0.8); c.fillText(s.label, 72, p.y); }
    }
    c.font = font(F.mono(400), 14);
    c.letterSpacing = '1px';
    for (const b of this.barX) {
      const p = proj(b.x + 0.6, 19.5);
      if (!p.ok || p.x < 0 || p.x > W) continue;
      c.fillStyle = rgba('ash', 0.65);
      c.fillText(String(b.n), p.x, p.y);
    }
    // attention weights at the arcs' apex: deadpan, deterministic
    c.font = font(F.mono(500), 15);
    for (let i = 1; i < this.motifs.length; i++) {
      const A = this.motifs[i - 1]!, B = this.motifs[i]!;
      const sa = STAVES.find((s) => A.parts.includes(s.id)), sb = STAVES.find((s) => B.parts.includes(s.id));
      if (!sa || !sb || t < B.t[0] + 0.25) continue;
      const ax = this.X(A.t[0]), bx = this.X(B.t[0]);
      const p = proj((ax + bx) / 2, Math.max(sa.y, sb.y) + 7 + Math.abs(sa.y - sb.y) * 0.3 + 0.2, 5);
      if (!p.ok) continue;
      const w = 0.93 + 0.06 * hash(i, 7);
      c.fillStyle = rgba('signal', 0.9 * prog(t, B.t[0] + 0.25, B.t[0] + 0.45));
      c.textAlign = 'center';
      c.fillText(`attn ${w.toFixed(2)}`, p.x, p.y - 14);
    }
    c.restore();
  }
}
