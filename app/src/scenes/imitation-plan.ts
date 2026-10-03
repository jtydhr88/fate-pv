// `imitation`, bars 6-12: the orchestra as a seating plan, and a next-note model learning the motif.
//  - The plan (left): the stage from above, drawn like an architect's plan: every desk a seat, each
//    section lighting as it plays. The conductor's baton is the attention: it swings to whichever
//    section has the motif, a dashed ray and a weight marking the head's focus.
//  - The model (right): a terminal that tokenizes each entry of the motif as it is played. Above every
//    new token, the distribution it was sampled from; the model grows surer with each entry (it is
//    learning the motif), and a loss curve in the header drops with every entry.
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { pitchName, type Score, type Motif } from '../engine/score';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse } from '../engine/util';

const CX = 760, CY = 930; // the podium
interface Section { id: string; label: string; a0: number; a1: number; rows: number[]; seats: number }
// angles in degrees from stage left (180) to stage right (0); rows are radii in px
const SECTIONS: Section[] = [
  { id: 'vl1', label: 'VIOLINI I', a0: 176, a1: 128, rows: [210, 280, 350], seats: 16 },
  { id: 'vl2', label: 'VIOLINI II', a0: 126, a1: 94, rows: [210, 280, 350], seats: 12 },
  { id: 'va', label: 'VIOLE', a0: 90, a1: 56, rows: [210, 280, 350], seats: 12 },
  { id: 'vc', label: 'VIOLONCELLI', a0: 52, a1: 8, rows: [210, 280], seats: 10 },
  { id: 'cb', label: 'BASSI', a0: 34, a1: 6, rows: [420, 480], seats: 8 },
  { id: 'fl', label: 'FL.', a0: 108, a1: 92, rows: [440], seats: 2 },
  { id: 'ob', label: 'OB.', a0: 88, a1: 72, rows: [440], seats: 2 },
  { id: 'cl', label: 'CL.', a0: 108, a1: 92, rows: [505], seats: 2 },
  { id: 'fg', label: 'FG.', a0: 88, a1: 72, rows: [505], seats: 2 },
  { id: 'cor', label: 'COR.', a0: 132, a1: 114, rows: [560], seats: 2 },
  { id: 'tr', label: 'TR.', a0: 66, a1: 50, rows: [570], seats: 2 },
  { id: 'timp', label: 'TIMP.', a0: 98, a1: 82, rows: [640], seats: 1 },
];
const pol = (deg: number, r: number) => ({ x: CX + Math.cos((deg * Math.PI) / 180) * r, y: CY - Math.sin((deg * Math.PI) / 180) * r });

interface Seat { x: number; y: number; sec: number }

export class Plan {
  seats: Seat[] = [];
  motifs: Motif[];
  partOf = new Map<string, number>();
  constructor(private score: Score, t0: number, t1: number) {
    this.motifs = score.motifs.filter((m) => m.t[0] >= t0 && m.t[0] < t1);
    SECTIONS.forEach((s, si) => {
      this.partOf.set(s.id, score.partIndex(s.id));
      const per = Math.ceil(s.seats / s.rows.length);
      let left = s.seats;
      s.rows.forEach((r) => {
        const n = Math.min(per, left); left -= n;
        for (let i = 0; i < n; i++) {
          const a = n === 1 ? (s.a0 + s.a1) / 2 : lerp(s.a0, s.a1, (i + 0.5) / n);
          const p = pol(a, r);
          this.seats.push({ x: p.x, y: p.y, sec: si });
        }
      });
    });
  }

  /** 0..1 activity of each section at t: loudness of its sounding notes plus a strike pulse. */
  activity(t: number) {
    const act = SECTIONS.map(() => 0);
    for (const n of this.score.sounding(t, 4)) {
      const si = SECTIONS.findIndex((s) => this.partOf.get(s.id) === n.part);
      // a held note only smoulders; the strike is what lights the section
      if (si >= 0) act[si] = Math.max(act[si]!, 0.12 + 1.1 * pulse(t, n.t, 0.12) * (0.5 + 0.5 * n.v / 127));
    }
    return act;
  }

  /** The section the attention is on (the latest motif entry), eased: [angle, radius, section index]. */
  focus(t: number): { a: number; r: number; si: number; w: number } {
    let cur = 0, prev = 0, tt = -1;
    for (const m of this.motifs) {
      if (m.t[0] - 0.1 > t) break;
      const si = SECTIONS.findIndex((s) => m.parts.includes(s.id));
      if (si < 0) continue;
      prev = cur; cur = si; tt = m.t[0] - 0.1;
    }
    const k = tt < 0 ? 1 : prog(t, tt, tt + 0.22, ease.outExpo);
    const ang = (s: Section) => (s.a0 + s.a1) / 2, rad = (s: Section) => s.rows[Math.floor(s.rows.length / 2)]!;
    return { a: lerp(ang(SECTIONS[prev]!), ang(SECTIONS[cur]!), k), r: lerp(rad(SECTIONS[prev]!), rad(SECTIONS[cur]!), k), si: cur, w: k };
  }

  draw(t: number, L: Layer2D, glow: LineBatch, beatPhase: number) {
    const c = L.ctx;
    const act = this.activity(t);
    c.save();
    // the stage: concentric guide arcs and radial rules, like a drafting plan
    c.strokeStyle = rgba('steel', 0.22); c.lineWidth = 1;
    for (const r of [180, 245, 315, 385, 455, 525, 600, 680]) { c.beginPath(); c.arc(CX, CY, r, Math.PI, 2 * Math.PI); c.stroke(); }
    for (let a = 0; a <= 180; a += 15) { const p = pol(a, 170), q = pol(a, 700); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke(); }
    c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(60, CY + 40); c.lineTo(CX + 440, CY + 40); c.stroke(); // stage lip
    // seats
    for (const s of this.seats) {
      const a = act[s.sec]!;
      c.beginPath(); c.arc(s.x, s.y, 11, 0, Math.PI * 2);
      c.fillStyle = a > 0.2 ? rgba('signal', Math.min(1, 0.2 + 0.8 * a)) : rgba('ink2', 1);
      c.fill();
      c.strokeStyle = a > 0.2 ? rgba('ember', 0.9) : a > 0 ? rgba('signal', 0.8) : rgba('bone', 0.55); c.lineWidth = a > 0 ? 2.5 : 1.5; c.stroke();
      // the desk: a short tick towards the podium
      const dx = CX - s.x, dy = CY - s.y, d = Math.hypot(dx, dy);
      c.beginPath(); c.moveTo(s.x + (dx / d) * 14, s.y + (dy / d) * 14); c.lineTo(s.x + (dx / d) * 22, s.y + (dy / d) * 22);
      c.strokeStyle = rgba('bone', 0.4); c.stroke();
      if (a > 0.2) {
        const g = 2.5 * a;
        glow.seg2(s.x - 4, s.y, s.x + 4, s.y, 9, [LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g]);
      }
    }
    // section labels
    c.font = font(F.mono(500), 18); c.letterSpacing = '2px'; c.textAlign = 'center';
    SECTIONS.forEach((s, si) => {
      const p = pol((s.a0 + s.a1) / 2, s.rows[s.rows.length - 1]! + (s.rows.length > 1 ? 44 : 34));
      c.fillStyle = act[si]! > 0.2 ? rgba('signal', 1) : rgba('ash', 0.85);
      c.fillText(s.label, p.x, p.y);
    });
    // the podium and the baton: the attention, pointed at the motif
    const f = this.focus(t);
    c.fillStyle = rgba('bone', 0.9); c.fillRect(CX - 18, CY - 18, 36, 36);
    const bob = Math.sin(beatPhase * Math.PI * 2) * 4 * (1 - beatPhase);
    const tip = pol(f.a + bob * 0.4, 120);
    c.strokeStyle = rgba('bone', 1); c.lineWidth = 4;
    c.beginPath(); c.moveTo(CX, CY); c.lineTo(tip.x, tip.y); c.stroke();
    // the attention ray: dashed, from the tip to the section, with its weight
    const tgt = pol(f.a, f.r);
    c.setLineDash([10, 8]); c.lineDashOffset = -t * 60;
    c.strokeStyle = rgba('signal', 0.95); c.lineWidth = 2;
    c.beginPath(); c.moveTo(tip.x, tip.y); c.lineTo(lerp(tip.x, tgt.x, f.w), lerp(tip.y, tgt.y, f.w)); c.stroke();
    c.setLineDash([]);
    if (f.w > 0.9) {
      c.beginPath(); c.arc(tgt.x, tgt.y, 70, 0, Math.PI * 2); c.stroke();
      c.font = font(F.mono(500), 22); c.textAlign = 'left'; c.fillStyle = rgba('signal', 1);
      c.fillText(`attn → ${SECTIONS[f.si]!.label} ${(0.9 + 0.09 * hash(f.si, 3)).toFixed(2)}`, tgt.x + 78, tgt.y - 6);
    }
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.textAlign = 'left';
    c.fillStyle = rgba('ash', 0.85);
    c.fillText('FIG. 2 — SEATING PLAN, SEEN FROM THE FLIES · 1808', 72, CY + 80);
    c.restore();
  }
}

// ------------------------------------------------------------------ the next-note model
const JOKES = ['silence', 'applause', 'a cough', 'C major', 'Mozart', 'tuning A', 'the encore'];

export class Model {
  constructor(private plan: Plan) {}

  /** The distribution token k of entry e was sampled from: the right note, near misses, one joke. */
  dist(e: number, k: number, p: number): [string, number][] {
    const R = mulberry32(100 + e * 7 + k);
    // the model learns: the first token of the first entry is a guess, the repeats are near certain
    const top = k === 0 ? 0.28 + 0.12 * e : k < 3 ? 0.78 + 0.035 * e : 0.42 + 0.09 * e;
    const pTop = clamp(top, 0, 0.98);
    const others = [pitchName(p + (k === 3 ? -1 : 1)), pitchName(p + (k === 3 ? 2 : -2)), JOKES[Math.floor(R() * JOKES.length)]!];
    let rest = 1 - pTop;
    const out: [string, number][] = [[pitchName(p), pTop]];
    others.forEach((o, i) => { const q = i === 2 ? Math.min(rest, 0.01 + 0.03 * R()) : rest * (0.55 + 0.2 * R()); out.push([o, q]); rest -= q; });
    return out;
  }

  draw(t: number, L: Layer2D) {
    const c = L.ctx;
    const X0 = 1250, Y0 = 170, LH = 128;
    const ms = this.plan.motifs.filter((m) => m.parts.length === 1);
    c.save();
    // the panel
    c.fillStyle = rgba('ink2', 0.92); c.fillRect(X0 - 36, Y0 - 110, 660, 880);
    c.strokeStyle = rgba('steel', 0.5); c.lineWidth = 1; c.strokeRect(X0 - 36, Y0 - 110, 660, 880);
    c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.9);
    c.fillText('NEXT-NOTE MODEL · ctx 2/4 · c minor', X0, Y0 - 56);
    // loss over the entries so far
    const seen = ms.filter((m) => t >= m.t[3]).length;
    c.strokeStyle = rgba('steel', 0.6); c.beginPath(); c.moveTo(X0, Y0 - 20); c.lineTo(X0 + 520, Y0 - 20); c.stroke();
    c.strokeStyle = rgba('signal', 1); c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= Math.max(0, seen); i++) {
      const loss = 2.4 * Math.exp(-i * 0.55) + 0.12;
      const x = X0 + (i / ms.length) * 360, y = Y0 - 22 - loss * 12;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.font = font(F.mono(400), 17); c.letterSpacing = '1px'; c.fillStyle = rgba('signal', 1);
    c.fillText(`loss ${(2.4 * Math.exp(-seen * 0.55) + 0.12).toFixed(2)} nats`, X0 + 380, Y0 - 30);
    // one line per entry: the section, then its four tokens typed as they sound
    ms.forEach((m, e) => {
      if (t < m.t[0] - 0.05) return;
      const y = Y0 + 50 + e * LH;
      const part = SECTIONS.find((s) => m.parts.includes(s.id))!;
      c.font = font(F.mono(500), 17); c.letterSpacing = '1px'; c.fillStyle = rgba('ash', 0.9);
      c.fillText(`${part.label}`, X0, y);
      const p = m.pitches[0]!;
      for (let k = 0; k < 4; k++) {
        if (t < m.t[k]!) break;
        const x = X0 + 150 + k * 112;
        const fresh = pulse(t, m.t[k]!, 0.12);
        // the token box
        c.fillStyle = k === 3 ? rgba('signal', 0.9 + 0.1 * fresh) : rgba('bone', 0.1 + 0.25 * fresh);
        c.fillRect(x - 8, y - 30, 100, 42);
        c.fillStyle = k === 3 ? rgba('ink', 1) : rgba('bone', 0.95);
        c.font = font(F.mono(600), 27); c.letterSpacing = '0px';
        c.fillText(pitchName(p[k]!), x, y);
        // its distribution, shown while it is the newest token
        const next = k < 3 ? m.t[k + 1]! : m.t[3] + 0.45;
        if (t < next) {
          const d = this.dist(e, k, p[k]!);
          c.font = font(F.mono(400), 15);
          d.forEach(([lab, q], i) => {
            const yy = y + 34 + i * 18; // under the token: the next line is not typed yet
            c.fillStyle = i === 0 ? rgba('signal', 1) : rgba('ash', 0.85);
            c.fillRect(x - 8, yy - 10, 80 * q, 8);
            c.fillText(`${lab} ${q.toFixed(2)}`, x + 80 * Math.max(q, 0.02) + 2, yy);
          });
        }
      }
      // after the long note: the model's guess for the next entry, blinking
      if (t >= m.t[3] + 0.2 && e === ms.findLastIndex((mm) => t >= mm.t[0] - 0.05)) {
        const blink = Math.floor(t * 4) % 2 === 0;
        c.fillStyle = rgba('ash', blink ? 0.8 : 0.3);
        c.font = font(F.mono(400), 18);
        const nxt = ms[e + 1];
        c.fillText(nxt ? `▸ next entry: ${SECTIONS.find((s) => nxt.parts.includes(s.id))!.label}?` : '▸ …', X0 + 150, y + 46);
      }
    });
    c.restore();
    void W; void H; void lerp;
  }
}
