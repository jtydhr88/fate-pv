// Beethoven 7/II, Allegretto: an engraving drawn in the air. The movement builds by adding voices to one
// ostinato (long, short-short, long, long); here every voice is a burin cutting its own line of light in
// space, an engraver's filigree: the burin bites on each note and lifts between them, so the rhythm is the
// cadence of the cut (dash, dot-dot, dash, dash), and each line winds round a common centre as an arabesque
// with its own number of lobes. Lines stay; voices that join add rings to the ornament.
//   bars 1-2   the winds' A-minor chord engraves the cartouche: four scalloped frames, scrolls at the corners
//   bars 3-10  three burins (violas, cellos, basses): the ostinato as three interlaced rosettes
//   bars 27-34 the second violins' theme as a wider rosette; the countermelody (violas) a beaded line
//              weaving through the ornament in a figure of eight
//   bars 75-82 ff, every voice at once: the ornament blooms into a dense guilloche filling the frame
// Behind it: an engraver's dark, a lamp, giant guilloche rosettes, dust in the beam, out-of-focus glints.
// Silver-grey with a warm (sepia) cast; no gold (the finale owns it).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Note } from '../engine/score';
import { clamp, ease, hash, lerp, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void } from './_kit';
import { styled } from '../engine/style';

type Key = { t: number; eye: [number, number, number]; at: [number, number, number]; roll?: number; fov?: number; follow?: string };
type Seg = { id: string; start: number; end: number };
type Style = 'rose' | 'counter';
type Params = { R: number; m: number; rx: number; ry: number; hz: number; ph: number };
type Win = { seg: string; t0: number; t1: number; tau0: number; style: Style };
/** One sample of a cut line: film time, position, radial normal (for the guilloche bands), cut depth 0..1. */
type Smp = { t: number; p: THREE.Vector3; n: THREE.Vector3; cut: number; th: number; note: number };
type Track = { id: string; label: string; par: Params; wins: Win[]; notes: Note[]; smp: Smp[]; warm: number };

const SPS = 40; // samples per second along a line
const SYM = 3; // the rose engine's symmetry: every cut is repeated round the centre
// only the principal voices cut (Terry: fewer, bolder lines, more air): per section, which voices hold a burin
const KEEP: Record<string, string[]> = { 'b7-a': ['va', 'cb'], 'b7-b': ['vl2', 'va'], 'b7-c': ['vl1', 'vl2', 'va', 'cb'] };
const OMEGA = (Math.PI * 2) / 14; // one turn of a rosette in 14 s of playing
const NAMES: Record<string, string> = {
  va: 'VIOLE', vc: 'VIOLONCELLI', cb: 'BASSI', vl2: 'VIOLINI II', vl1: 'VIOLINI I', fl: 'FLAUTI', ob: 'OBOI',
  cl: 'CLARINETTI', fg: 'FAGOTTI', cor: 'CORNI', tr: 'TROMBE', timp: 'TIMPANI',
};
const ORDER = ['cb', 'vc', 'va', 'vl2', 'vl1', 'fg', 'cor', 'cl', 'fl', 'ob', 'tr', 'timp'];
// each voice's rosette: radius, lobes, the tilt of its plane, how far it leaves the plane, phase
const PAR: Record<string, Params> = {
  cb: { R: 33, m: 3, rx: 0.25, ry: 0.0, hz: 6, ph: 0.3 },
  vc: { R: 45, m: 5, rx: -0.2, ry: 0.22, hz: 8, ph: 1.4 },
  va: { R: 57, m: 7, rx: 0.12, ry: -0.3, hz: 9, ph: 2.2 },
  vl2: { R: 75, m: 9, rx: -0.35, ry: 0.15, hz: 10, ph: 0.8 },
  vl1: { R: 90, m: 11, rx: 0.3, ry: 0.3, hz: 12, ph: 2.9 },
  fg: { R: 66, m: 6, rx: 0.55, ry: 0.25, hz: 8, ph: 4.1 },
  cor: { R: 84, m: 8, rx: -0.55, ry: -0.2, hz: 10, ph: 5.0 },
  cl: { R: 99, m: 10, rx: 0.0, ry: 0.5, hz: 14, ph: 3.3 },
  fl: { R: 108, m: 13, rx: 0.45, ry: -0.1, hz: 9, ph: 0.1 },
  ob: { R: 114, m: 12, rx: -0.4, ry: -0.35, hz: 9, ph: 1.1 },
  tr: { R: 123, m: 15, rx: 0.2, ry: -0.55, hz: 8, ph: 2.5 },
  timp: { R: 20, m: 12, rx: 0, ry: 0, hz: 3, ph: 0 },
};
const BURINS = 6; // modelled burins (the strings and the first wind); the rest cut with a point of light

export default class B7Layers extends Scene {
  st = new Stage3D();
  bg = new Void();
  etch = new LineBatch(120000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  glow = new LineBatch(60000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  back = new Layer2D(); // the backdrop (drawn before the 3D)
  text = new Layer2D();
  rosette!: HTMLCanvasElement; // the giant guilloche, drawn once
  segs: Seg[] = [];
  tracks: Track[] = [];
  chord: Note[] = [];
  tChordEnd = 0;
  burins: THREE.Group[] = [];
  keys: Key[] = [];
  tutti: number[] = [];

  override async init() {
    const sc = this.ctx.score;
    this.segs = ['b7-a', 'b7-b', 'b7-c'].map((id) => { const s = sc.segments.find((x) => x.id === id)!; return { id, start: s.start, end: s.end }; });
    const notesOf = (seg: string, id: string) => sc.notesIn(this.ctx.start - 1, this.ctx.end + 1).filter((n) => n.part === sc.partIndex(`${seg}:${id}`));
    this.tChordEnd = sc.bar(3, 'b7-a').t;
    this.chord = ['ob', 'cl', 'fg', 'cor'].flatMap((id) => notesOf('b7-a', id)).filter((n) => n.t < this.tChordEnd);
    // the tracks: a voice joins with the first cut it plays in (the winds' chord in bars 1-2 is the cartouche, not a track)
    for (const id of ORDER) {
      const wins: Win[] = [], notes: Note[] = [];
      let tau = 0;
      for (const s of this.segs) {
        if (!KEEP[s.id]!.includes(id)) continue;
        const ns = notesOf(s.id, id).filter((n) => s.id !== 'b7-a' || n.t >= this.tChordEnd - 0.01);
        if (!ns.length) continue;
        const t0 = ns[0]!.t, t1 = Math.min(s.end, Math.max(...ns.map((n) => n.t + n.d)));
        wins.push({ seg: s.id, t0, t1, tau0: tau, style: s.id === 'b7-b' && id === 'va' ? 'counter' : 'rose' });
        tau += t1 - t0;
        notes.push(...ns);
      }
      if (!wins.length) continue;
      const warm = ['fl', 'ob', 'cl', 'fg', 'cor', 'tr', 'timp'].includes(id) ? 1 : 0;
      const tr: Track = { id, label: NAMES[id] ?? id.toUpperCase(), par: PAR[id]!, wins, notes, smp: [], warm };
      this.sample(tr);
      this.tracks.push(tr);
    }
    this.tutti = uniq(['vl1', 'vl2', 'va', 'cb', 'timp'].flatMap((id) => notesOf('b7-c', id)).map((n) => n.t));
    for (let i = 0; i < BURINS; i++) { const b = burinModel(); this.burins.push(b); this.st.scene.add(b); }
    this.st.key.intensity = 2.6;
    this.st.rim.intensity = 1.6;
    this.rosette = guilloche();
    this.buildKeys();
  }

  /** Where a rosette line is at playing time tau, with the pitch excursion dp (radial). */
  rose(par: Params, tau: number, dp: number, out: THREE.Vector3, nrm: THREE.Vector3) {
    const ph = par.ph + 0.15 * tau / 14; // a slow precession: the second turn interlaces with the first
    const th = ph + OMEGA * tau;
    const r = par.R * (1 + 0.26 * Math.sin(par.m * th)) + dp; // strong, smooth lobes: petals
    // nearly in the medallion's plane (so the rose engine's repeats make a true rosette), each voice on its
    // own depth layer: the depth comes from the stacking, not from tilting the rings into a nest
    const layer = 30 - 5.5 * ORDER.indexOf(this.trackId);
    out.set(r * Math.cos(th), r * Math.sin(th), layer + 0.35 * par.hz * Math.sin(2 * th + par.ph));
    nrm.set(Math.cos(th), Math.sin(th), 0);
    const e = new THREE.Euler(par.rx * 0.22, par.ry * 0.22, 0);
    out.applyEuler(e); nrm.applyEuler(e);
    return th;
  }
  /** The countermelody: a figure of eight weaving through the ornament in depth. */
  counter(tau: number, dp: number, out: THREE.Vector3, nrm: THREE.Vector3) {
    const th = (Math.PI * 2 / 12.6) * tau - Math.PI / 2;
    out.set(115 * Math.sin(th), 45 * Math.sin(2 * th) + dp * 1.2, 50 * Math.cos(th));
    nrm.set(0, 1, 0);
    return th;
  }

  /** Precompute a track's line: one sample every 1/SPS s of its windows. */
  trackId = '';
  sample(tr: Track) {
    this.trackId = tr.id;
    const ps = tr.notes.map((n) => n.p).sort((a, b) => a - b);
    const med = ps[ps.length >> 1] ?? 60;
    const ns = [...tr.notes].sort((a, b) => a.t - b.t);
    let j = 0, dp = 0;
    for (const w of tr.wins) {
      for (let ts = w.t0; ts <= w.t1 + 1e-6; ts += 1 / SPS) {
        while (j + 1 < ns.length && ns[j + 1]!.t <= ts + 1e-6) j++;
        const n = ns[j]!;
        const on = n.t <= ts + 1e-6 && ts < n.t + Math.max(0.05, n.d * 0.72); // the lift between notes shows the rhythm
        // the burin bites at the attack and eases off through the note
        const cut = on ? clamp(1 - 0.35 * (ts - n.t) / Math.max(0.05, n.d)) : 0;
        const target = (n.p - med) * (w.style === 'counter' ? 1.3 : 0.22);
        dp += (target - dp) * 0.35;
        const p = new THREE.Vector3(), nrm = new THREE.Vector3();
        const tau = w.tau0 + (ts - w.t0);
        const th = w.style === 'counter' ? this.counter(tau, dp, p, nrm) : this.rose(tr.par, tau, dp, p, nrm);
        tr.smp.push({ t: ts, p, n: nrm, cut, th, note: on ? j : -1 });
      }
    }
  }

  segAt(t: number) { let s = this.segs[0]!; for (const x of this.segs) if (t >= x.start) s = x; return s; }
  /** The head of a track's line at t (its last sample), or null before it starts / after it ends. */
  head(tr: Track, t: number) {
    const s = tr.smp;
    if (!s.length || t < s[0]!.t) return null;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid]!.t <= t) lo = mid; else hi = mid - 1; }
    const w = tr.wins.find((x) => t >= x.t0 - 0.01 && t <= x.t1 + 0.3);
    return { i: lo, smp: s[lo]!, live: !!w && t <= w.t1 + 0.05 };
  }

  buildKeys() {
    const [a, b, c] = this.segs as [Seg, Seg, Seg];
    const sc = this.ctx.score;
    const close = sc.bar(7, 'b7-a').t;
    const theme = sc.bar(31, 'b7-b').t;
    const reveal = c.start + 6.3;
    const hold = c.end - 2.3;
    this.keys = [
      // the cartouche engraves itself out of the dark: a slow push
      { t: a.start, eye: [0, 11, 462], at: [0, 0, 0], fov: 34 },
      { t: this.tChordEnd - 0.02, eye: [-34, 20, 353], at: [0, 0, 0], fov: 34 },
      // established: three-quarter, the three burins cutting round the centre
      { t: this.tChordEnd, eye: [-190, 92, 205], at: [0, -4, 0], fov: 36 },
      { t: close - 0.02, eye: [-150, 70, 232], at: [0, -4, 0], fov: 36 },
      // close: riding the violas' burin
      { t: close, eye: [0, 0, 0], at: [0, 0, 0], fov: 30, follow: 'va' },
      { t: b.start - 0.02, eye: [0, 0, 0], at: [0, 0, 0], fov: 28, follow: 'va' },
      // the second violins join: the other side, slowly round
      { t: b.start, eye: [215, 62, 210], at: [0, 0, -6], roll: 0.02, fov: 38 },
      { t: theme - 0.02, eye: [170, 40, 250], at: [0, 0, -6], roll: 0.02, fov: 38 },
      // close: the theme's burin
      { t: theme, eye: [0, 0, 0], at: [0, 0, 0], fov: 30, follow: 'vl2' },
      { t: c.start - 0.02, eye: [0, 0, 0], at: [0, 0, 0], fov: 28, follow: 'vl2' },
      // ff: pulled back and up, every voice at once
      { t: c.start, eye: [0, 150, 430], at: [0, 0, 0], fov: 42 },
      { t: reveal - 0.02, eye: [80, 70, 372], at: [0, 0, 0], fov: 42 },
      // round the ornament as it fills
      { t: reveal, eye: [175, 40, 300], at: [0, 0, 0], roll: -0.04, fov: 40 },
      { t: hold - 0.02, eye: [-80, -14, 270], at: [0, 0, 0], roll: 0.03, fov: 40 },
      // the whole engraving, head on, as it fades
      { t: hold, eye: [0, 0, 380], at: [0, 0, 0], fov: 40 },
      { t: this.ctx.end, eye: [0, 0, 345], at: [0, 0, 0], fov: 40 },
    ];
  }

  camera(t: number) {
    const k = this.keys;
    let i = 0;
    while (i + 1 < k.length && t >= k[i + 1]!.t) i++;
    const A = k[i]!, B = k[Math.min(i + 1, k.length - 1)]!;
    const u = B.t - A.t < 0.06 ? 0 : ease.inOutQuad(clamp((t - A.t) / Math.max(1e-3, B.t - A.t)));
    const L = (x: number[], y: number[]) => new THREE.Vector3(lerp(x[0]!, y[0]!, u), lerp(x[1]!, y[1]!, u), lerp(x[2]!, y[2]!, u));
    let eye = L(A.eye, B.eye), at = L(A.at, B.at);
    if (A.follow) {
      // ride along the line: just outside it, looking at the burin's tip, the cut trailing away behind
      const tr = this.tracks.find((x) => x.id === A.follow)!;
      const h = this.head(tr, t);
      if (h) {
        const P = h.smp.p, Nn = h.smp.n;
        const s2 = tr.smp[Math.max(0, h.i - 12)]!.p; // a little way back along the cut
        const back = P.clone().sub(s2).normalize();
        at = P.clone().addScaledVector(back, -3);
        eye = P.clone().addScaledVector(Nn, 26).addScaledVector(back, 24).add(new THREE.Vector3(0, 12 + 2 * Math.sin(t * 0.5), 34));
      }
    }
    eye.x += noise1(t * 0.3, 7) * 1.0; eye.y += noise1(t * 0.25, 8) * 0.7;
    this.st.look(eye, at, lerp(A.roll ?? 0, B.roll ?? 0, u), lerp(A.fov ?? 38, B.fov ?? 38, u));
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const s = this.segAt(t);
    this.camera(t);
    const tutti = s.id === 'b7-c' ? Math.max(0, ...this.tutti.map((o) => pulse(t, o, 0.12))) : 0;
    const E = this.etch, G = this.glow;
    E.clear(); G.clear();
    const bone = LIN.bone, ochre = LIN.ochre;
    const col = (warm: number, k: number): [number, number, number] => [
      (bone[0] + (ochre[0] - bone[0]) * 0.3 * warm) * k, (bone[1] + (ochre[1] - bone[1]) * 0.3 * warm) * k, (bone[2] + (ochre[2] - bone[2]) * 0.3 * warm) * k];

    // ---- the cartouche: the winds' chord engraves four scalloped frames, then scrolls at the corners
    {
      const frame = prog(t, this.ctx.start + 0.3, this.tChordEnd - 0.1, ease.inOutCubic);
      const keep = 0.55 + 0.45 * (1 - prog(t, this.tChordEnd, this.tChordEnd + 2));
      for (let i = 0; i < 4; i++) {
        const rx = 140 - 9 * i, ry = 92 - 6 * i, z = -3 * i;
        const fr = clamp(frame * 1.15 - i * 0.05);
        const N = 300, M = Math.floor(N * fr);
        let px = 0, py = 0;
        for (let k = 0; k <= M; k++) {
          const th = Math.PI / 2 + (k / N) * Math.PI * 2;
          const sc = 1 + 0.012 * Math.sin(30 * th + i);
          const x = rx * sc * Math.cos(th), y = ry * sc * Math.sin(th);
          if (k) {
            const c = col(0.6, (0.55 + 0.25 * (i === 0 ? 1 : 0)) * keep);
            E.seg(px, py, z, x, y, z, i === 0 ? 0.42 : 0.24, c[0], c[1], c[2], 1);
            if (k % 10 === 0 && i < 2) { const b = col(0.6, 0.7 * keep); E.seg(x - 0.5, y, z + 0.05, x + 0.5, y, z + 0.05, 0.5, b[0], b[1], b[2], 1); }
          }
          px = x; py = y;
        }
        // the engraving point on each frame while it is cut
        if (fr > 0 && fr < 1) {
          const th = Math.PI / 2 + fr * Math.PI * 2;
          const g = 1.4;
          spark(G, rx * Math.cos(th), ry * Math.sin(th), z, t, i, g);
        }
      }
      // corner scrolls: logarithmic curls at the four diagonals, drawn as the chord ends
      const sk = prog(t, this.tChordEnd - 0.6, this.tChordEnd + 0.9, ease.outCubic);
      if (sk > 0) {
        for (let q = 0; q < 4; q++) {
          const sx = q % 2 ? 1 : -1, sy = q < 2 ? 1 : -1;
          const cx = sx * 106, cy = sy * 70;
          let px = NaN, py = NaN;
          const N = Math.floor(70 * sk);
          for (let k = 1; k <= N; k++) {
            const a = k * 0.16, r = 21 * Math.exp(-a * 0.16);
            const x = cx + sx * r * Math.cos(a + (q * Math.PI) / 2), y = cy + sy * r * Math.sin(a + (q * Math.PI) / 2);
            const c = col(0.6, 0.6 * keep);
            if (k > 1) E.seg(px, py, -1, x, y, -1, 0.26, c[0], c[1], c[2], 1);
            px = x; py = y;
          }
        }
      }
    }

    // ---- the voices' lines: cut where a note sounds, a scribed hairline where the burin lifts
    const live: { tr: Track; P: THREE.Vector3; smp: Smp; cutting: boolean }[] = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    const cp = this.st.cam.position;
    for (const tr of this.tracks) {
      const h = this.head(tr, t);
      if (!h) continue;
      const sm = tr.smp;
      const ff = s.id === 'b7-c' ? 1 + 0.5 * tutti : 1;
      for (let i = 1; i <= h.i; i++) {
        const a = sm[i - 1]!, b = sm[i]!;
        // a window boundary (a cut in the music, or the violas changing from countermelody to rosette): no bridge
        if (b.t - a.t > 2 / SPS || a.p.distanceToSquared(b.p) > 36) continue;
        const age = t - b.t;
        const hot = b.note >= 0 && age < 0.25 ? 1 - age / 0.25 : 0;
        const w = tr.wins.find((x) => b.t >= x.t0 && b.t <= x.t1 + 1e-6);
        const counter = w?.style === 'counter';
        if (b.cut > 0) {
          const k = (0.62 + 0.3 * b.cut + 0.5 * hot) * ff;
          const c = col(tr.warm, k);
          E.seg(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z, counter ? 0.42 : 0.3 + 0.32 * b.cut, c[0], c[1], c[2], 1);
          if (!counter) {
            // the rose engine's repeats: the same cut turned round the centre (fainter, no bands)
            const r = col(tr.warm, 0.42 * k);
            for (let j = 1; j < SYM; j++) {
              const an = (j * Math.PI * 2) / SYM, ca = Math.cos(an), sa = Math.sin(an);
              // (not right in front of the lens: in the close-ups the repeats would only be clutter)
              const mx = (a.p.x + b.p.x) * 0.5, my = (a.p.y + b.p.y) * 0.5;
              const dx = mx * ca - my * sa - cp.x, dy = mx * sa + my * ca - cp.y, dz = (a.p.z + b.p.z) * 0.5 - cp.z;
              if (dx * dx + dy * dy + dz * dz < 55 * 55) continue;
              E.seg(a.p.x * ca - a.p.y * sa, a.p.x * sa + a.p.y * ca, a.p.z, b.p.x * ca - b.p.y * sa, b.p.x * sa + b.p.y * ca, b.p.z, 0.14 + 0.1 * b.cut, r[0], r[1], r[2], 1);
            }
          }
          if (counter && i % 5 === 0) {
            // the countermelody: beads strung on its line
            const g = col(0.2, 0.95 * k);
            E.seg(b.p.x - 0.25, b.p.y, b.p.z, b.p.x + 0.25, b.p.y, b.p.z, 0.5, g[0], g[1], g[2], 1);
          }
          if (hot > 0) {
            const g = col(tr.warm, 0.5 * hot);
            G.seg(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z, 0.75, g[0], g[1], g[2], 1);
          }
        }
      }
      if (h.live) live.push({ tr, P: h.smp.p, smp: h.smp, cutting: h.smp.cut > 0 });
    }

    // ---- the burins on the live lines (modelled ones on the first few, a point of light on the rest)
    const camPos = this.st.cam.position;
    live.forEach((l, i) => {
      const bu = this.burins[i];
      const lift = l.cutting ? 0 : 1.2;
      // the blade's axis: back from the tip, leaning out of the ornament and up towards the light
      const tan = l.tr.smp[Math.max(0, l.tr.smp.indexOf(l.smp) - 2)]!.p.clone().sub(l.P).normalize();
      const toCam = camPos.clone().sub(l.P).normalize();
      const axis = new THREE.Vector3().addScaledVector(l.smp.n, 0.45).addScaledVector(tan, 0.55).addScaledVector(toCam, 0.35).add(new THREE.Vector3(0, 0.6, 0)).normalize();
      if (bu) {
        bu.visible = true;
        bu.position.copy(l.P).addScaledVector(axis, lift);
        bu.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      }
      if (l.cutting) spark(G, l.P.x, l.P.y, l.P.z, t, i + 3, bu ? 1.2 : 2.0);
      else if (!bu) { const g = 0.6; G.seg(l.P.x - 0.4, l.P.y, l.P.z, l.P.x + 0.4, l.P.y, l.P.z, 0.9, g, g, g, 1); }
    });
    for (let i = live.length; i < this.burins.length; i++) this.burins[i]!.visible = false;
    // the chord's burin, on the outer frame
    if (t < this.tChordEnd + 0.2) {
      const bu = this.burins[0]!;
      const fr = clamp(prog(t, this.ctx.start + 0.3, this.tChordEnd - 0.1, ease.inOutCubic) * 1.15);
      const th = Math.PI / 2 + fr * Math.PI * 2;
      const P = new THREE.Vector3(140 * Math.cos(th), 92 * Math.sin(th), 0);
      const axis = new THREE.Vector3(Math.cos(th) * 0.5, Math.sin(th) * 0.5 + 0.5, 0.75).normalize();
      bu.visible = live.length === 0 || bu.visible;
      if (live.length === 0) { bu.position.copy(P); bu.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis); }
    }

    // ---- the bite: at every attack a layered burst at the burin's tip (core flash, sparks, silver curls,
    // slow glitter); the long notes of the rhythm (the accents) flare bigger, the tutti bigger still
    for (const tr of this.tracks) {
      const ns = tr.notes;
      const dMed = [...ns.map((n) => n.d)].sort((x, y) => x - y)[ns.length >> 1] ?? 0.2;
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i]!;
        const age = t - n.t;
        if (age < 0 || age > 2.6) continue;
        const sm = this.head(tr, n.t + 0.01);
        if (!sm) continue;
        const accent = n.d > dMed * 1.3 ? 1 : 0;
        const big = (1 + 0.8 * accent) * (s.id === 'b7-c' ? 1.5 : 1);
        const zoom = clamp(sm.smp.p.distanceTo(this.st.cam.position) / 90, 1, 3.2);
        bite(E, G, sm.smp.p, sm.smp.n, age, hash(i, tr.par.m * 7 + 1), big, col, zoom);
      }
    }

    // ---- dust drifting through the lamp's beam (brighter inside it)
    const beamO = new THREE.Vector3(-320, 290, -80), beamD = new THREE.Vector3(0.62, -0.72, 0.3).normalize();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < 520; i++) {
      const x = (hash(i, 1) - 0.5) * 480 + noise1(t * 0.05 + i, 3) * 6;
      const z = (hash(i, 3) - 0.6) * 420;
      const y = ((hash(i, 2) * 320 - (t - this.ctx.start) * (0.8 + 1.4 * hash(i, 4))) % 320 + 320) % 320 - 160;
      tmp.set(x, y, z).sub(beamO);
      const along = tmp.dot(beamD);
      const d2 = tmp.lengthSq() - along * along;
      const inBeam = Math.exp(-d2 / 5000);
      const g = (0.05 + 0.5 * inBeam) * (0.4 + 0.6 * hash(i, 5)) * (1 + 0.8 * tutti);
      G.seg(x, y, z, x + 0.06, y - 0.3, z, 0.22, g, g * 0.97, g * 0.9, 1);
    }

    // backdrop, then the lit burins, then the engraving
    this.bg.render(renderer, out, t, 0.12 * tutti, 0.15);
    this.drawBack(t, tutti);
    comp.draw(renderer, this.back.upload(), out);
    this.st.key.intensity = 2.6 + 1.2 * tutti;
    this.st.render(renderer, out);
    E.render(renderer, out, this.st.cam);
    G.render(renderer, out, this.st.cam);

    this.drawText(t, s, live);
    comp.draw(renderer, this.text.upload(), out);
    const sh = 2.5 * tutti;
    const fade = Math.max(1 - prog(t, this.ctx.start, this.ctx.start + 1.2), prog(t, this.segs[2]!.end - 0.1, this.ctx.end - 0.15, ease.inOutQuad));
    return {
      ramp: 'ash', ramp2: 'stone', rampMix: 0.45, grade: 1, gradeSteps: 5,
      bloom: 0.5, bloomThreshold: 1.0, halation: 0.12, grain: 0.06, vignette: 0.5, ca: 0.6 + 0.8 * tutti,
      shake: [noise1(t * 30, 1) * sh, noise1(t * 30, 2) * sh], fade,
    };
  }

  /** The engraver's dark behind the ornament: a lamp, its beam, giant guilloche rosettes, glints out of focus. */
  drawBack(t: number, tutti: number) {
    const T = this.back; T.clear();
    const c = T.ctx;
    const cam = this.st.cam.position;
    // the lamp, high left, warm
    const lg = c.createRadialGradient(W * 0.16, H * 0.06, 0, W * 0.16, H * 0.06, 1100);
    lg.addColorStop(0, 'rgba(236,224,200,0.09)'); lg.addColorStop(0.5, 'rgba(200,186,160,0.035)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = lg; c.fillRect(0, 0, W, H);
    // two giant guilloche rosettes, slowly turning, a little parallax with the camera
    const px = -cam.x * 0.35, py = cam.y * 0.25;
    for (const [sc, rot, a] of [[1.55, t * 0.012, 0.13], [2.4, -t * 0.007 + 0.4, 0.05]] as const) {
      c.save();
      c.globalAlpha = a * (1 + 0.6 * tutti);
      c.translate(W / 2 + px * (sc > 2 ? 0.5 : 1), H / 2 + py * (sc > 2 ? 0.5 : 1));
      c.rotate(rot);
      const s = (H * sc) / this.rosette.height;
      c.scale(s, s);
      c.drawImage(this.rosette, -this.rosette.width / 2, -this.rosette.height / 2);
      c.restore();
    }
    // glints out of focus: soft discs with a brighter rim
    for (let i = 0; i < 34; i++) {
      const x = ((hash(i, 11) * W * 1.2 + (t - this.ctx.start) * (6 + 10 * hash(i, 12)) - cam.x * 0.8 * hash(i, 13)) % (W * 1.2)) - W * 0.1;
      const y = hash(i, 14) * H + noise1(t * 0.1 + i, 15) * 20;
      const r = 8 + 34 * hash(i, 16);
      const a = (0.025 + 0.06 * hash(i, 17)) * (0.6 + 0.4 * Math.sin(t * 0.7 + i)) * (1 + tutti);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(235,228,214,${a * 0.6})`); g.addColorStop(0.82, `rgba(235,228,214,${a})`); g.addColorStop(1, 'rgba(235,228,214,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  }

  drawText(t: number, s: Seg, live: { tr: Track; P: THREE.Vector3 }[]) {
    const T = this.text; T.clear();
    const c = T.ctx;
    // the title under the chord, set whole (not typed)
    const a0 = prog(t, this.ctx.start + 0.8, this.ctx.start + 1.8) * (1 - prog(t, this.tChordEnd + 1.5, this.tChordEnd + 2.3));
    if (a0 > 0) {
      c.save(); c.globalAlpha = a0; c.textAlign = 'left';
      c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 0.9);
      c.fillText('L. VAN BEETHOVEN · SINFONIE NR. 7 · OP. 92 · 1813', 120, H - 210);
      c.letterSpacing = '0px';
      c.font = font(F.serif(400, true), 96); c.fillStyle = rgba('bone', 0.96);
      c.fillText('Allegretto.', 110, H - 110);
      c.restore();
    }
    // in the wide shots: the voice at each burin's tip
    const k = this.keys;
    let i = 0;
    while (i + 1 < k.length && t >= k[i + 1]!.t) i++;
    const wide = !k[i]!.follow && t >= this.tChordEnd && s.id !== 'b7-c';
    if (wide) {
      c.font = font(F.mono(500), 13); c.letterSpacing = '2px'; c.textAlign = 'left'; c.fillStyle = rgba('bone', 1);
      for (const l of live) {
        const v = l.P.clone().project(this.st.cam);
        if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
        c.globalAlpha = 0.75 * prog(t, s.start + 0.4, s.start + 1.0);
        c.fillText(l.tr.label, (v.x * 0.5 + 0.5) * W + 14, (0.5 - v.y * 0.5) * H - 10);
      }
      c.globalAlpha = 1;
    }
    // deadpan: the voices cutting, per cut
    const n = this.tracks.filter((tr) => tr.wins.some((w) => w.seg === s.id)).length;
    const cap = s.id === 'b7-a' ? (t < this.tChordEnd ? '' : `burins: ${n}   ·   pp`) : s.id === 'b7-b' ? `burins: ${n}   ·   + VIOLINI II   ·   p` : `burins: ${n}   ·   tutti   ·   ff`;
    if (cap && t < this.segs[2]!.end) {
      const a = prog(t, s.start + 0.4, s.start + 0.9) * (1 - prog(t, s.end - 0.5, s.end - 0.1));
      c.save(); c.globalAlpha = a * 0.85;
      c.font = font(F.mono(400), 17); c.letterSpacing = '2px'; c.textAlign = 'right'; c.fillStyle = rgba('bone', 1);
      c.fillText(cap, W - 110, 110);
      c.restore();
    }
  }
}

/**
 * One bite of the burin at P (normal nrm), `age` seconds ago: a core flash and a starburst (first 0.15 s),
 * sparks flung out on ballistic arcs (0.6 s), silver curls lifting and tumbling (1.4 s), and fine glitter
 * drifting down and twinkling (2.6 s). All from the seed: deterministic.
 */
function bite(E: LineBatch, G: LineBatch, P0: THREE.Vector3, nrm: THREE.Vector3, age: number, seed: number, big: number,
  col: (warm: number, k: number) => [number, number, number], zoom = 1) {
  // work in a local frame scaled by zoom (a burst seen from far is drawn bigger, so it still reads)
  const Z = zoom, P = new THREE.Vector3(0, 0, 0);
  const seg = (L: LineBatch, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, r: number, g: number, b: number) =>
    L.seg(P0.x + ax * Z, P0.y + ay * Z, P0.z + az * Z, P0.x + bx * Z, P0.y + by * Z, P0.z + bz * Z, w * Z, r, g, b, 1);
  const E2 = { seg: (...a: Parameters<typeof seg> extends [unknown, ...infer R] ? R : never) => seg(E, ...a) };
  const G2 = { seg: (...a: Parameters<typeof seg> extends [unknown, ...infer R] ? R : never) => seg(G, ...a) };
  // core flash + star
  if (age < 0.15) {
    const k = (1 - age / 0.15) ** 2 * big;
    const r = (1.6 + 1.4 * big) * (0.6 + 0.4 * (1 - age / 0.15)) / Math.sqrt(Z); // short rays: long thin ones read as stray lines
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 4 + seed * 3;
      const ax = Math.cos(a) * r * (q % 2 ? 0.45 : 1), ay = Math.sin(a) * r * (q % 2 ? 0.45 : 1);
      G2.seg(P.x - ax, P.y - ay, P.z, P.x + ax, P.y + ay, P.z, q % 2 ? 0.12 : 0.2, 2.2 * k, 2.1 * k, 1.9 * k);
    }
    G2.seg(P.x - 0.3, P.y, P.z, P.x + 0.3, P.y, P.z, 1.6 * Math.min(1.5, big), 1.6 * k, 1.55 * k, 1.4 * k);
  }
  // sparks: short streaks along their velocity, falling
  if (age < 0.6) {
    const N = Math.round(10 + 10 * big);
    for (let j = 0; j < N; j++) {
      const h1 = hash(j, seed * 97), h2 = hash(j, seed * 131), h3 = hash(j, seed * 173);
      const life = 0.25 + 0.35 * h3;
      if (age > life) continue;
      const a = h1 * Math.PI * 2, el = (h2 - 0.3) * 1.6;
      const sp = (14 + 26 * h3) * (0.8 + 0.3 * big);
      const vx = Math.cos(a) * Math.cos(el) * sp + nrm.x * 8, vy = Math.sin(el) * sp + 6, vz = Math.sin(a) * Math.cos(el) * sp + nrm.z * 8;
      const x = P.x + vx * age, y = P.y + vy * age - 30 * age * age, z = P.z + vz * age;
      const dt = 0.025;
      const k = (1 - age / life) * 1.8;
      G2.seg(x - vx * dt, y - (vy - 60 * age) * dt, z - vz * dt, x, y, z, 0.13, 2.0 * k, 1.85 * k, 1.5 * k);
    }
  }
  // silver curls: two or three helical shavings lifting off the cut, tumbling, catching the light
  if (age < 1.4) {
    const nc = 2 + Math.round(big);
    for (let cu = 0; cu < nc; cu++) {
      const R = hash(cu, seed * 211), dir = R > 0.5 ? 1 : -1;
      let px = 0, py = 0, pz = 0;
      const g0 = 1.0 * (1 - age / 1.4);
      const spin = age * (5 + 4 * R);
      for (let k = 1; k < 16; k++) {
        const a = k * 0.62 + R * 6 + spin, r = (0.35 + 0.12 * k) * (0.7 + 0.4 * big);
        const nx = P.x + Math.cos(a) * r + dir * age * (4 + 5 * R);
        const ny = P.y + Math.sin(a) * r * 0.6 + 0.8 + age * (6 + 3 * R) - age * age * 8;
        const nz = P.z + k * 0.08 + age * (2 + 3 * R) * dir;
        // the curl's faces catch the light as it turns: a moving glint along it
        const glint = Math.max(0, Math.cos(a * 2 - spin * 2)) ** 6;
        const c = col(0.35, g0 * (0.55 + 0.45 * Math.sin(a * 2)));
        if (k > 1) E2.seg(px, py, pz, nx, ny, nz, 0.12, c[0], c[1], c[2]);
        if (k > 1 && glint > 0.3) G2.seg(px, py, pz, nx, ny, nz, 0.22, 1.6 * glint * g0, 1.55 * glint * g0, 1.4 * glint * g0);
        px = nx; py = ny; pz = nz;
      }
    }
  }
  // glitter: fine metallic dust drifting down from the bite, twinkling
  const NG = Math.round(16 + 16 * big);
  for (let j = 0; j < NG; j++) {
    const h1 = hash(j, seed * 307), h2 = hash(j, seed * 401), h3 = hash(j, seed * 503);
    const life = 1.4 + 1.2 * h3;
    if (age > life) continue;
    const a = h1 * Math.PI * 2, r = (3 + 9 * h2) * Math.min(1, age * 3) * (0.8 + 0.3 * big);
    const x = P.x + Math.cos(a) * r + Math.sin(age * 2 + j) * 0.8;
    const y = P.y + 1.5 * h2 + 2.5 * age - 4.5 * age * age * (0.3 + 0.7 * h3) * 0.4;
    const z = P.z + Math.sin(a) * r;
    const tw = 0.4 + 0.6 * Math.max(0, Math.sin(age * (14 + 10 * h1) + j)) ** 3;
    const k = (1 - age / life) * tw * 1.3;
    G2.seg(x - 0.12, y, z, x + 0.12, y, z, 0.24, 1.7 * k, 1.65 * k, 1.5 * k);
  }
}

/** A glint where the point bites: a small four-ray star, flickering (deterministic in t). */
function spark(G: LineBatch, x: number, y: number, z: number, t: number, seed: number, k: number) {
  const fl = 0.6 + 0.4 * hash(Math.floor(t * 30), seed);
  const g = k * fl, r = 1.2 + 1.4 * fl;
  G.seg(x - r, y, z, x + r, y, z, 0.18, g, g, g * 0.95, 1);
  G.seg(x, y - r, z, x, y + r, z, 0.18, g, g, g * 0.95, 1);
  G.seg(x - r * 0.4, y - r * 0.4, z, x + r * 0.4, y + r * 0.4, z, 0.14, g * 0.6, g * 0.6, g * 0.55, 1);
  G.seg(x - r * 0.4, y + r * 0.4, z, x + r * 0.4, y - r * 0.4, z, 0.14, g * 0.6, g * 0.6, g * 0.55, 1);
}

/**
 * An engraver's burin, its point at the origin and its handle up +y: a mushroom handle in boxwood (turned,
 * flat on one side as burins are cut, so it lies low to the plate), a ferrule, a lozenge-section steel
 * shank and a faceted point.
 */
function burinModel() {
  const g = new THREE.Group();
  const wood = styled({ color: new THREE.Color(0x9a7a56), roughness: 0.55 });
  const brass = styled({ color: new THREE.Color(0xb8a27a), roughness: 0.3, metalness: 0.9 });
  const steel = styled({ color: new THREE.Color(0xc4c8ce), roughness: 0.22, metalness: 0.95 });
  // the handle: a turned mushroom (lathe profile), y 0..4.2 in its own frame
  const prof = [[0.0, 0.0], [1.5, 0.05], [2.15, 0.45], [2.4, 1.2], [2.3, 2.0], [1.9, 2.7], [1.25, 3.25], [0.78, 3.7], [0.66, 4.2]].map(([r, y]) => new THREE.Vector2(r!, y!));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), wood);
  handle.scale.set(1, 1, 0.78); // the flat side
  // a groove ring turned into it
  const groove = new THREE.Mesh(new THREE.TorusGeometry(2.33, 0.08, 6, 32), styled({ color: new THREE.Color(0x5e4a34), roughness: 0.7 }));
  groove.rotation.x = Math.PI / 2; groove.position.y = 1.4; groove.scale.set(1, 0.78, 1);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.66, 0.95, 20), brass);
  ferrule.position.y = 4.6;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 6, 20), brass);
  lip.rotation.x = Math.PI / 2; lip.position.y = 5.05;
  // the shank: square section turned 45 degrees (a lozenge), tapering, then the point's faces
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 9.5, 4, 1), steel);
  shank.rotation.y = Math.PI / 4; shank.position.y = 5.05 + 4.75;
  const point = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.3, 1.5, 4, 1), steel);
  point.rotation.y = Math.PI / 4; point.position.y = 5.05 + 9.5 + 0.75;
  const tool = new THREE.Group();
  tool.add(handle, groove, ferrule, lip, shank, point);
  // turn it so the point is at the origin, the handle up
  tool.rotation.z = Math.PI;
  tool.position.y = 5.05 + 9.5 + 1.5;
  g.add(tool);
  g.scale.setScalar(0.85);
  return g;
}

/** The giant guilloche drawn once: bands of waving hairlines round a centre (the engraved banknote rosette). */
function guilloche() {
  const S = 1600;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.strokeStyle = 'rgba(226,220,208,1)';
  g.lineWidth = 1.1;
  const bands: [number, number, number, number][] = [[150, 18, 9, 10], [260, 26, 13, 12], [380, 22, 17, 12], [500, 30, 21, 14], [640, 24, 27, 12], [740, 14, 36, 8]];
  for (const [R, A, k, copies] of bands) {
    for (let o = 0; o < copies; o++) {
      g.globalAlpha = 0.18 + 0.1 * (o % 2);
      g.beginPath();
      for (let i = 0; i <= 2400; i++) {
        const th = (i / 2400) * Math.PI * 2;
        const r = R + A * Math.sin(k * th + (o * Math.PI * 2) / copies) + 5 * Math.sin(3 * th + o);
        const x = r * Math.cos(th), y = r * Math.sin(th);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  }
  // fine radial rules between the bands
  g.globalAlpha = 0.1;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    g.beginPath(); g.moveTo(Math.cos(a) * 560, Math.sin(a) * 560); g.lineTo(Math.cos(a) * 610, Math.sin(a) * 610); g.stroke();
  }
  return cv;
}

function uniq(xs: number[]) { return [...new Set(xs.map((x) => +x.toFixed(3)))].sort((a, b) => a - b); }
