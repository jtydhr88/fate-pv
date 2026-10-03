// The Mozart plates' instruments, modelled properly (the shared _instruments.ts ones are sketches):
// the violin family with an arched top and back, overhanging edges, purfling, f-holes, a tapered
// fingerboard, a pegbox with pegs, a volute scroll, a bridge with feet and cut-outs, a tailpiece with
// fine tuners, a chinrest or an endpin; a bow with a cambered stick, head, frog, eye and hair; reed and
// flute woodwinds built from joints with ferrules, tone holes, key cups on arms, rods on posts and rings;
// a natural horn with mouthpiece, leadpipe, a coil with ferrules and a bell with a rolled rim.
// Same playing interfaces as _instruments.ts (Fiddle / Woodwind / Horn), so the plates swap them in.
// No red anywhere on the instruments (Terry: a bowed string turning red means nothing): the porcelain
// glaze paints them, the sound is shown by the strings shivering, keys closing, rings and dust.
import * as THREE from 'three';
import type { Note } from '../engine/score';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { styled } from '../engine/style';
import { clamp, ease, hash, lerp, pulse } from '../engine/util';

const col = (hex: string) => new THREE.Color(hex);
const mat = (hex: string) => styled({ color: col(hex), roughness: 0.4 });
/** a material drawn on top of a coplanar-ish surface (purfling, f-holes, tone holes): pulled forward in depth */
function decal(hex: string) {
  const m = mat(hex);
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  return m;
}

/** A tube along points with a radius per point (parallel-transport frames, capped). */
export function taperedTube(pts: THREE.Vector3[], radii: (u: number) => number, segs = 120, radial = 14) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const fr = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, c = curve.getPointAt(u), N = fr.normals[i]!, B = fr.binormals[i]!, r = radii(u);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      pos.push(c.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), c.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), c.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
    }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < radial; k++) {
    const a = i * (radial + 1) + k, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // end caps
  for (const [i, flip] of [[0, true], [segs, false]] as const) {
    const c = curve.getPointAt(i / segs), base = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      if (flip) idx.push(base, a + 1, a); else idx.push(base, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, curve };
}

/** A ring (torus) around an axis direction at a point. */
function ringAt(p: THREE.Vector3, dir: THREE.Vector3, R: number, r: number, m: THREE.Material) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, 28), m);
  t.position.copy(p);
  t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  return t;
}

// ================================================================== the violin family
/** Half outline (x >= 0) in body widths (x) and lengths (y), y strictly increasing: corners and C-bouts. */
const OUTLINE: [number, number][] = [
  [0, 0], [0.3, 0.012], [0.47, 0.065], [0.565, 0.17], [0.56, 0.29], [0.51, 0.36], [0.475, 0.398], [0.4, 0.41],
  [0.335, 0.455], [0.312, 0.5], [0.322, 0.545], [0.37, 0.585], [0.445, 0.595], [0.46, 0.625], [0.475, 0.7],
  [0.45, 0.8], [0.36, 0.905], [0.2, 0.975], [0, 1],
];

/**
 * A violin (scale 1), viola (~1.15) or cello (~2: deeper ribs, an endpin, no chinrest). The body lies in the
 * xy plane (top facing +z, scroll towards +y); strings are drawn per frame; the bow pivots on its contact
 * point. Units: cm at scale 1. `open` are the open strings' MIDI pitches, lowest first.
 */
export class Violin {
  group = new THREE.Group();
  bow = new THREE.Group();
  bowBody = new THREE.Group();
  len: number; wid: number; s: number;
  bridgeY: number; nutY: number; fbEndY: number;
  zBridge: number; zNut: number; zTail: number; tailY: number;
  ribTop: number; plate: number; arch: number; backArch: number;
  bowLen: number;
  cello: boolean;
  endpin: boolean;
  /** scale on each stroke's travel along the bow (1: as before; >1 fuller, faster strokes) */
  travelGain = 1;
  /** the height of the back's lowest point below the body plane: lay the instrument this high */
  restHeight: number;
  private hwTab: Float32Array;
  /** last attack's contact point (local), for the rosin dust */
  contact = new THREE.Vector3();

  /** opts.bow: bow length (default 74, a real violin bow); opts.endpin false: the cello's endpin pushed in (lying down) */
  constructor(public open: number[], public scale = 1, varnish = '#c9c4bb', opts: { bow?: number; endpin?: boolean } = {}) {
    const s = scale;
    this.s = s;
    this.cello = s > 1.5;
    this.len = 35.5 * s;
    this.wid = 20.6 * s;
    this.ribTop = (this.cello ? 2.7 : 1.5) * s;
    this.plate = 0.35 * s;
    this.arch = (this.cello ? 1.9 : 1.55) * s;
    this.backArch = (this.cello ? 1.5 : 1.3) * s;
    this.restHeight = this.ribTop + this.plate + this.backArch + 0.05 * s;
    // half width by y (spline through the outline, tabulated)
    const spl = new THREE.SplineCurve(OUTLINE.map(([x, y]) => new THREE.Vector2(x, y)));
    const sp = spl.getPoints(800);
    this.hwTab = new Float32Array(401);
    for (let i = 0; i <= 400; i++) {
      const y = i / 400;
      let k = 0;
      while (k + 1 < sp.length && sp[k + 1]!.y < y) k++;
      const a = sp[k]!, b = sp[Math.min(k + 1, sp.length - 1)]!;
      const u = b.y - a.y > 1e-6 ? (y - a.y) / (b.y - a.y) : 0;
      this.hwTab[i] = Math.max(0, lerp(a.x, b.x, clamp(u)));
    }
    const L = this.len;
    this.bridgeY = L * 0.42;
    this.fbEndY = L - 14 * s;
    this.nutY = L + 13 * s;
    this.zBridge = this.topZ(0, this.bridgeY) + 3.3 * s;
    this.zNut = this.zBridge - 2.25 * s;
    this.tailY = L * 0.29;
    this.zTail = this.topZ(0, this.tailY) + 1.2 * s;
    this.bowLen = opts.bow ?? 74;
    this.endpin = opts.endpin ?? true;

    const body = mat(varnish), dark = mat('#2a2c30'), ink = decal('#16181c');
    const ebony = mat('#1c1d20'), maple = mat('#d8d2c6'), metal = mat('#e4e6ea');
    this.buildBody(body, ink);
    this.buildNeck(body, ebony, dark);
    this.buildFittings(ebony, maple, metal, dark);
    this.buildBow(dark, metal, maple);
    this.group.add(this.bow);
  }

  /** half width of the body (to the rib) at y */
  hw(y: number) {
    const v = clamp(y / this.len) * 400, i = Math.floor(v), f = v - i;
    return lerp(this.hwTab[i]!, this.hwTab[Math.min(400, i + 1)]!, f) * this.wid;
  }
  /** the plate's edge: overhanging the rib */
  hwE(y: number) { const h = this.hw(y); return h > 0 ? h + 0.28 * this.s * Math.min(1, h / (1.5 * this.s)) : 0; }
  /** the top's height at (x, y): edge, a slight scoop inside it, then the arch */
  topZ(x: number, y: number) {
    const e = this.hwE(y), u = e > 1e-4 ? clamp(Math.abs(x) / e) : 1, yn = clamp(y / this.len);
    const A = Math.pow(1 - u * u, 1.35) - 0.05 * Math.exp(-Math.pow((1 - u) / 0.07, 2));
    const B = Math.pow(Math.max(0, Math.sin(Math.PI * yn)), 0.55);
    return this.ribTop + this.plate + this.arch * Math.max(0, A) * B;
  }
  backZ(x: number, y: number) {
    const e = this.hwE(y), u = e > 1e-4 ? clamp(Math.abs(x) / e) : 1, yn = clamp(y / this.len);
    const A = Math.pow(1 - u * u, 1.35);
    return -(this.ribTop + this.plate + this.backArch * A * Math.pow(Math.max(0, Math.sin(Math.PI * yn)), 0.55));
  }

  private buildBody(body: THREE.Material, ink: THREE.Material) {
    const L = this.len, NR = 110, NC = 30;
    const ys = Array.from({ length: NR + 1 }, (_, j) => L * (0.5 - 0.5 * Math.cos((Math.PI * j) / NR)));
    const us = Array.from({ length: NC + 1 }, (_, i) => Math.sin((Math.PI / 2) * ((2 * i) / NC - 1)));
    // the top and the back: grids over (u across the width, y along), displaced by the arch
    for (const top of [true, false]) {
      const pos: number[] = [], idx: number[] = [];
      for (const y of ys) for (const u of us) {
        const x = u * this.hwE(y);
        pos.push(x, y, top ? this.topZ(x, y) : this.backZ(x, y));
      }
      for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
        const a = j * (NC + 1) + i, b = a + NC + 1;
        if (top) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, body));
    }
    // the edge all round: the top's lip, its overhang, the rib, the back's overhang and lip (a crisp profile)
    const prof = (y: number): [number, number][] => {
      const h = this.hw(y), e = this.hwE(y), rt = this.ribTop, p = this.plate;
      return [[e, rt + p], [e, rt], [h, rt], [h, -rt], [e, -rt], [e, -rt - p]];
    };
    const loop: { y: number; side: number }[] = [...ys.map((y) => ({ y, side: 1 })), ...ys.slice().reverse().map((y) => ({ y, side: -1 }))];
    const ep: number[] = [];
    for (let k = 0; k + 1 < loop.length; k++) {
      const A = loop[k]!, B = loop[k + 1]!, pa = prof(A.y), pb = prof(B.y);
      for (let q = 0; q + 1 < pa.length; q++) {
        const a0 = [A.side * pa[q]![0], A.y, pa[q]![1]], a1 = [A.side * pa[q + 1]![0], A.y, pa[q + 1]![1]];
        const b0 = [B.side * pb[q]![0], B.y, pb[q]![1]], b1 = [B.side * pb[q + 1]![0], B.y, pb[q + 1]![1]];
        // outward winding on the right side, mirrored on the left (the loop runs back down)
        ep.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      }
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    eg.computeVertexNormals();
    const em = (body as THREE.MeshPhysicalMaterial).clone(); em.side = THREE.DoubleSide;
    this.group.add(new THREE.Mesh(eg, em));
    // purfling: a dark double line inset from the edge on the top
    const inset = 0.42 * this.s, pw = 0.11 * this.s;
    for (const side of [1, -1]) {
      const pp: number[] = [], pi: number[] = [];
      const yy = ys.filter((y) => this.hwE(y) > inset + 0.3 * this.s);
      yy.forEach((y) => {
        const e = this.hwE(y);
        for (const d of [inset, inset + pw]) { const x = side * (e - d); pp.push(x, y, this.topZ(x, y) + 0.02 * this.s); }
      });
      for (let k = 0; k + 1 < yy.length; k++) { const a = k * 2; pi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      g.setIndex(pi); g.computeVertexNormals();
      const m = new THREE.Mesh(g, ink); m.material.side = THREE.DoubleSide;
      this.group.add(m);
    }
    // the f-holes: a stem tapering to its ends, an eye at each end, notches at the waist
    for (const sx of [-1, 1]) {
      const cx = sx * this.wid * 0.17, y0 = L * 0.33, y1 = L * 0.53;
      const c = new THREE.CubicBezierCurve(new THREE.Vector2(cx - sx * 1.1 * this.s, y0), new THREE.Vector2(cx + sx * 2.4 * this.s, y0 + 2.6 * this.s),
        new THREE.Vector2(cx - sx * 2.4 * this.s, y1 - 2.6 * this.s), new THREE.Vector2(cx + sx * 1.1 * this.s, y1));
      const pts = c.getPoints(40), pp: number[] = [], pi: number[] = [];
      pts.forEach((p, k) => {
        const u = k / 40, w = (0.05 + 0.12 * Math.sin(Math.PI * u)) * this.s;
        const q = pts[Math.min(40, k + 1)]!, o = pts[Math.max(0, k - 1)]!;
        const tx = q.x - o.x, ty = q.y - o.y, n = Math.hypot(tx, ty) || 1, nx = -ty / n, ny = tx / n;
        for (const sgn of [1, -1]) { const x = p.x + nx * w * sgn, y = p.y + ny * w * sgn; pp.push(x, y, this.topZ(x, y) + 0.03 * this.s); }
      });
      for (let k = 0; k < 40; k++) { const a = k * 2; pi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      // eyes
      for (const [p, r] of [[pts[0]!, 0.36], [pts[40]!, 0.29]] as const) {
        const base = pp.length / 3;
        pp.push(p.x, p.y, this.topZ(p.x, p.y) + 0.03 * this.s);
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI * 2, x = p.x + Math.cos(a) * r * this.s, y = p.y + Math.sin(a) * r * this.s;
          pp.push(x, y, this.topZ(x, y) + 0.03 * this.s);
          if (k > 0) pi.push(base, base + k, base + k + 1);
        }
      }
      // the notches either side of the waist
      const mid = pts[20]!;
      for (const sgn of [1, -1]) {
        const base = pp.length / 3, x0 = mid.x, y0n = mid.y, dx = sgn * 0.38 * this.s;
        const tri = [[x0, y0n + 0.07 * this.s], [x0 + dx, y0n], [x0, y0n - 0.07 * this.s]];
        tri.forEach(([x, y]) => pp.push(x!, y!, this.topZ(x!, y!) + 0.03 * this.s));
        pi.push(base, base + 1, base + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      g.setIndex(pi); g.computeVertexNormals();
      const m = new THREE.Mesh(g, ink.clone()); (m.material as THREE.Material).side = THREE.DoubleSide;
      this.group.add(m);
    }
  }

  /** neck, fingerboard, pegbox with pegs, the scroll */
  private buildNeck(body: THREE.Material, ebony: THREE.Material, dark: THREE.Material) {
    const s = this.s, L = this.len;
    // the fingerboard: tapered, its top cambered, following the strings' line 0.5 cm under them
    {
      const NY = 24, NX = 8, pos: number[] = [], idx: number[] = [];
      const y0 = this.fbEndY, y1 = this.nutY;
      const zTopAt = (y: number) => this.stringZ(y) - (0.12 + 0.45 * clamp((this.nutY - y) / (this.nutY - this.fbEndY))) * s;
      const wAt = (y: number) => lerp(4.3, 2.4, (y - y0) / (y1 - y0)) * s;
      const th = 0.75 * s;
      // top surface + two sides + bottom + the end face, as one strip set
      for (let j = 0; j <= NY; j++) {
        const y = lerp(y0, y1, j / NY), w = wAt(y), zt = zTopAt(y);
        for (let i = 0; i <= NX; i++) {
          const u = i / NX * 2 - 1;
          pos.push(u * w / 2, y, zt - 0.18 * s * u * u);
        }
        pos.push(w / 2, y, zt - 0.18 * s - th, -w / 2, y, zt - 0.18 * s - th);
      }
      const row = NX + 3;
      for (let j = 0; j < NY; j++) {
        const a = j * row, b = a + row;
        for (let i = 0; i < NX; i++) idx.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i);
        // sides
        idx.push(a + NX, a + NX + 1, b + NX, a + NX + 1, b + NX + 1, b + NX);
        idx.push(a, b, a + NX + 2, a + NX + 2, b, b + NX + 2);
        // bottom
        idx.push(a + NX + 1, a + NX + 2, b + NX + 1, a + NX + 2, b + NX + 2, b + NX + 1);
      }
      // end face (over the body)
      for (let i = 0; i < NX; i++) idx.push(i, i + 1, NX + 1);
      idx.push(0, NX + 1, NX + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const fb = new THREE.Mesh(g.toNonIndexed(), ebony);
      fb.geometry.computeVertexNormals();
      (fb.material as THREE.Material).side = THREE.DoubleSide;
      this.group.add(fb);
      // the nut
      const nut = new THREE.Mesh(new THREE.BoxGeometry(2.5 * s, 0.5 * s, 0.6 * s), mat('#e9e4d8'));
      nut.position.set(0, this.nutY + 0.2 * s, this.zNut - 0.25 * s);
      this.group.add(nut);
    }
    // the neck: a rounded U under the fingerboard, from the heel at the body to the pegbox
    {
      const pts: THREE.Vector3[] = [];
      const yA = L - 0.3 * s, yB = this.nutY + 0.4 * s;
      const NY = 16, NA = 12, pos: number[] = [], idx: number[] = [];
      for (let j = 0; j <= NY; j++) {
        const u = j / NY, y = lerp(yA, yB, u);
        const top = this.stringZ(y) - (0.12 + 0.45 * clamp((this.nutY - y) / (this.nutY - this.fbEndY))) * s - 0.18 * s - 0.75 * s;
        const w = lerp(2.9, 2.2, u) * s, d = lerp(3.6, 2.1, Math.min(1, u * 3)) * s;
        for (let k = 0; k <= NA; k++) {
          const a = (k / NA) * Math.PI;
          pos.push(Math.cos(a) * w / 2, y, top - Math.sin(a) * d);
        }
        pts.push(new THREE.Vector3(0, y, top));
      }
      for (let j = 0; j < NY; j++) for (let k = 0; k < NA; k++) {
        const a = j * (NA + 1) + k, b = a + NA + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, body); (m.material as THREE.Material).side = THREE.DoubleSide;
      this.group.add(m);
    }
    // the pegbox: two cheeks and a back, open on top; four pegs through the cheeks
    const pbY0 = this.nutY + 0.3 * s, pbY1 = pbY0 + 7.2 * s;
    const pbTop = this.zNut - 0.4 * s, pbDepth = 2.6 * s, pbW = 2.4 * s;
    for (const sx of [1, -1]) {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.35 * s, pbY1 - pbY0, pbDepth), body);
      cheek.position.set(sx * (pbW / 2 - 0.17 * s), (pbY0 + pbY1) / 2, pbTop - pbDepth / 2);
      this.group.add(cheek);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(pbW, pbY1 - pbY0, 0.4 * s), body);
    back.position.set(0, (pbY0 + pbY1) / 2, pbTop - pbDepth + 0.2 * s);
    this.group.add(back);
    const hole = new THREE.Mesh(new THREE.BoxGeometry(pbW - 0.7 * s, pbY1 - pbY0 - 0.6 * s, 0.1 * s), dark);
    hole.position.set(0, (pbY0 + pbY1) / 2, pbTop - pbDepth + 0.45 * s);
    this.group.add(hole);
    for (let k = 0; k < 4; k++) {
      const sx = k % 2 === 0 ? 1 : -1, y = pbY0 + (1.3 + k * 1.5) * s;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.36 * s, 4.6 * s, 10), ebony);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.set(sx * 1.4 * s, y, pbTop - 1.2 * s);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.0 * s, 14, 10), ebony);
      head.scale.set(0.45, 1.25, 1.0);
      head.position.set(sx * 3.9 * s, y, pbTop - 1.2 * s);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.42 * s, 0.12 * s, 6, 16), ebony);
      collar.rotation.y = Math.PI / 2;
      collar.position.set(sx * 3.2 * s, y, pbTop - 1.2 * s);
      this.group.add(shaft, head, collar);
    }
    // the scroll: a volute that tightens to an eye, cut as a tapered tube winding in the yz plane
    {
      const cy = pbY1 + 1.9 * s, cz = pbTop - 1.4 * s;
      const pts: THREE.Vector3[] = [];
      const turns = 2.35;
      for (let i = 0; i <= 60; i++) {
        const u = i / 60, a = -Math.PI / 2 + u * turns * Math.PI * 2, r = (2.05 - 1.55 * u) * s;
        pts.push(new THREE.Vector3(0, cy + Math.sin(a) * r, cz - Math.cos(a) * r));
      }
      const width = (u: number) => (1.05 - 0.55 * u) * s;
      // the volute is wide (side to side): squash a round tube by scaling x
      const { geo } = taperedTube(pts, (u) => width(u) * 0.62, 160, 14);
      const vol = new THREE.Mesh(geo, body);
      vol.scale.set(1.75, 1, 1);
      this.group.add(vol);
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 2.3 * s, 14), body);
      eye.rotation.z = Math.PI / 2;
      eye.position.copy(pts[60]!);
      this.group.add(eye);
      // the throat joining the pegbox to the volute
      const throat = new THREE.Mesh(new THREE.BoxGeometry(2.2 * s, 2.2 * s, 1.0 * s), body);
      throat.position.set(0, pbY1 + 0.3 * s, pbTop - pbDepth + 0.6 * s);
      this.group.add(throat);
    }
  }

  /** bridge, tailpiece with fine tuners and its gut, saddle, end button; a chinrest or an endpin */
  private buildFittings(ebony: THREE.Material, maple: THREE.Material, metal: THREE.Material, dark: THREE.Material) {
    const s = this.s;
    // the bridge: feet, legs, the heart and the kidneys cut out, an arched top
    {
      const w = 4.2 * s, h = this.zBridge - this.topZ(1.5 * s, this.bridgeY);
      const sh = new THREE.Shape();
      const P = (x: number, y: number) => [x * w / 2, y * h] as const;
      const outline: (readonly [number, number])[] = [
        P(-1.0, 0), P(-0.55, 0), P(-0.5, 0.06), P(-0.3, 0.1), P(0.3, 0.1), P(0.5, 0.06), P(0.55, 0), P(1.0, 0),
        P(0.97, 0.07), P(0.62, 0.16), P(0.6, 0.3), P(0.75, 0.5), P(0.86, 0.86), P(0.6, 0.96), P(0.2, 1.0),
        P(-0.2, 1.0), P(-0.6, 0.96), P(-0.86, 0.86), P(-0.75, 0.5), P(-0.6, 0.3), P(-0.62, 0.16), P(-0.97, 0.07),
      ];
      sh.moveTo(outline[0]![0], outline[0]![1]);
      for (const p of outline.slice(1)) sh.lineTo(p[0], p[1]);
      sh.closePath();
      // the heart, and the two kidneys
      const heart = new THREE.Path();
      heart.absellipse(0, 0.6 * h, 0.17 * w / 2, 0.11 * h, 0, Math.PI * 2, false, 0);
      sh.holes.push(heart);
      for (const sx of [-1, 1]) {
        const k = new THREE.Path();
        k.absellipse(sx * 0.42 * w / 2, 0.38 * h, 0.08 * w / 2, 0.1 * h, 0, Math.PI * 2, false, 0);
        sh.holes.push(k);
      }
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.38 * s, bevelEnabled: false, curveSegments: 12 });
      g.rotateX(Math.PI / 2);
      const br = new THREE.Mesh(g, maple);
      br.position.set(0, this.bridgeY + 0.19 * s, this.topZ(1.5 * s, this.bridgeY) - 0.05 * s);
      this.group.add(br);
    }
    // the tailpiece: a tapering ebony blade, raised at the bridge end, four fine tuners (violin and viola)
    {
      const sh = new THREE.Shape();
      const len = 11 * s, wt = 3.8 * s, wb = 1.5 * s;
      sh.moveTo(-wb / 2, 0); sh.lineTo(wb / 2, 0);
      sh.bezierCurveTo(wt / 2, len * 0.55, wt / 2 + 0.2 * s, len * 0.92, wt / 2 - 0.4 * s, len);
      sh.quadraticCurveTo(0, len + 0.45 * s, -wt / 2 + 0.4 * s, len);
      sh.bezierCurveTo(-wt / 2 - 0.2 * s, len * 0.92, -wt / 2, len * 0.55, -wb / 2, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.45 * s, bevelEnabled: true, bevelThickness: 0.14 * s, bevelSize: 0.14 * s, bevelSegments: 2, curveSegments: 16 });
      const tp = new THREE.Mesh(g, ebony);
      const y0 = 1.1 * s, z0 = this.topZ(0, y0) + 0.25 * s, z1 = this.zTail - 0.2 * s;
      tp.position.set(0, y0, z0);
      tp.rotation.x = Math.atan2(z1 - z0, len);
      this.group.add(tp);
      if (!this.cello) {
        for (let i = 0; i < 4; i++) {
          const x = this.stringX(i, 'tail'), y = y0 + len * 0.86, z = z0 + (z1 - z0) * 0.86 + 0.6 * s;
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.2 * s, 0.7 * s, 8), metal);
          barrel.rotation.x = Math.PI / 2; barrel.position.set(x, y, z);
          const lever = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 1.6 * s, 0.18 * s), metal);
          lever.position.set(x, y - 0.8 * s, z - 0.2 * s);
          this.group.add(barrel, lever);
        }
      }
      // the tail gut over the saddle to the end button
      const gut = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 1.4 * s, 6), dark);
      gut.position.set(0, 0.4 * s, this.ribTop + this.plate + 0.1 * s);
      this.group.add(gut);
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(2.4 * s, 0.5 * s, 0.4 * s), ebony);
      saddle.position.set(0, 0.2 * s, this.ribTop + this.plate + 0.05 * s);
      this.group.add(saddle);
    }
    if (this.cello) {
      // the endpin: collar, then the rod
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * s, 0.7 * s, 1.0 * s, 16), ebony);
      collar.position.set(0, -0.4 * s, 0);
      this.group.add(collar);
      if (this.endpin) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 14 * s, 8), metal);
        rod.position.set(0, -7.5 * s, 0);
        this.group.add(rod);
      }
    } else {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * s, 0.4 * s, 0.6 * s, 12), ebony);
      button.position.set(0, -0.25 * s, 0);
      this.group.add(button);
      // the chinrest: a shallow cup on the lower bout, left of the tailpiece, on two brackets
      const prof: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) { const u = i / 12; prof.push(new THREE.Vector2(u * 2.6 * s, 0.5 * s * u * u + (u > 0.85 ? (u - 0.85) * 3.0 * s : 0))); }
      const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), mat('#6a6c72'));
      (cup.material as THREE.Material).side = THREE.DoubleSide;
      cup.rotation.x = Math.PI / 2;
      cup.scale.set(1.25, 1, 0.85);
      const cx = -5.2 * s, cy = 4.4 * s;
      cup.position.set(cx, cy, this.topZ(cx, cy) + 0.9 * s);
      this.group.add(cup);
      for (const dx of [-1, 1]) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 1.0 * s, 6), metal);
        br.rotation.x = Math.PI / 2; br.position.set(cx + dx * 1.6 * s, cy - 1.8 * s, this.topZ(cx, cy) + 0.3 * s);
        this.group.add(br);
      }
    }
  }

  /** the bow: cambered stick, head with its ivory plate, frog with eye and ferrule, button, grip; the hair */
  private buildBow(dark: THREE.Material, metal: THREE.Material, maple: THREE.Material) {
    const Lb = this.bowLen, bs = this.cello ? 1.25 : 1;
    const stickPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, x = lerp(-1.2, Lb, u);
      // camber: the stick bends towards the hair in the middle, rises to the head
      const z = (1.65 - 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.05)) + 0.9 * Math.pow(u, 6)) * bs;
      stickPts.push(new THREE.Vector3(x, 0, z));
    }
    const { geo } = taperedTube(stickPts, (u) => lerp(0.46, 0.27, u) * bs, 90, 8);
    const stick = new THREE.Mesh(geo, dark);
    // the grip: a winding over the stick above the frog
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.56 * bs, 0.56 * bs, 9, 10), mat('#8d8a84'));
    grip.rotation.z = Math.PI / 2; grip.position.set(9.5, 0, 1.38 * bs);
    // the head: a hatchet-shaped block at the tip, its face ivory
    const hs = new THREE.Shape();
    hs.moveTo(0, 0); hs.lineTo(-1.6, 0); hs.quadraticCurveTo(-1.8, 1.6, -0.6, 2.5); hs.lineTo(0.15, 2.3); hs.lineTo(0.2, 0.3); hs.lineTo(0, 0);
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.8, bevelEnabled: false });
    hg.translate(0, 0, -0.4); hg.rotateX(Math.PI / 2); hg.scale(bs, bs, bs);
    const head = new THREE.Mesh(hg, dark);
    head.position.set(Lb, 0, 0);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.82 * bs, 1.9 * bs), mat('#efe8d8'));
    face.position.set(Lb - 1.65 * bs, 0, 1.0 * bs);
    // the frog: a block with a rounded heel, mother-of-pearl eye, metal ferrule where the hair spreads out
    const fs = new THREE.Shape();
    fs.moveTo(0, 0); fs.lineTo(4.6, 0); fs.lineTo(4.6, 0.4); fs.quadraticCurveTo(4.2, 2.3, 2.0, 2.4); fs.lineTo(0.2, 1.6); fs.quadraticCurveTo(-0.2, 0.8, 0, 0);
    const fg = new THREE.ExtrudeGeometry(fs, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
    fg.translate(0, 0, -0.75); fg.rotateX(Math.PI / 2); fg.scale(bs, bs, bs);
    const frog = new THREE.Mesh(fg, dark);
    frog.position.set(0.2, 0, -0.1 * bs);
    const eyeM = mat('#e8ecef');
    for (const sy of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.36 * bs, 16), eyeM);
      eye.position.set(2.6 * bs, sy * 0.88 * bs, 1.1 * bs);
      eye.rotation.x = sy * -Math.PI / 2;
      this.bowBody.add(eye);
    }
    const ferrule = new THREE.Mesh(new THREE.BoxGeometry(0.5 * bs, 1.6 * bs, 0.5 * bs), metal);
    ferrule.position.set(4.7 * bs, 0, 0.15 * bs);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * bs, 0.42 * bs, 2.0, 12), metal);
    button.rotation.z = Math.PI / 2; button.position.set(-2.2, 0, 1.65 * bs);
    // the hair: a flat ribbon from the ferrule to the head
    const hair = new THREE.Mesh(new THREE.BoxGeometry(Lb - 6.2 * bs, 1.05 * bs, 0.1), mat('#f3efe6'));
    hair.position.set((4.9 * bs + Lb - 1.4 * bs) / 2, 0, 0);
    this.bowBody.add(stick, grip, head, face, frog, ferrule, button, hair);
    this.bow.add(this.bowBody);
    void maple;
  }

  /** Which string a pitch is played on: the highest open string at or below it. */
  stringOf(p: number) { let k = 0; this.open.forEach((o, i) => { if (p >= o) k = i; }); return k; }
  /** x of string i at the bridge, the nut or the tailpiece */
  stringX(i: number, at: 'bridge' | 'nut' | 'tail' = 'bridge') {
    const sp = at === 'bridge' ? 1.12 : at === 'nut' ? 0.56 : 0.85;
    return (i - (this.open.length - 1) / 2) * sp * this.s;
  }
  /** the strings' height along y (bridge to nut); the outer strings sit a little lower on the bridge's arch */
  stringZ(y: number, i = 1.5) {
    const k = clamp((y - this.bridgeY) / (this.nutY - this.bridgeY));
    const arch = 0.22 * this.s * Math.pow((i - 1.5) / 1.5, 2) * (1 - k);
    return lerp(this.zBridge, this.zNut, k) - arch;
  }

  /**
   * Pose for time t: the bow travels down-bow and up-bow alternately per note, tilted to the string being
   * played about its contact point; returns each string's energy for drawing.
   */
  play(t: number, notes: Note[]) {
    const Lb = this.bowLen;
    let pos = 0.5, dirSign = 1, cur: Note | null = null;
    for (const n of notes) {
      if (n.t > t) break;
      const travel = clamp(clamp(n.d * 1.4, 0.12, 0.85) * (n.v / 127 + 0.4) * this.travelGain, 0, 0.88);
      const u = clamp((t - n.t) / Math.max(0.05, n.d));
      const start = pos, end = clamp(start + dirSign * travel, 0.06, 0.94);
      if (t < n.t + n.d) { pos = start + (end - start) * ease.outQuad(u); cur = n; } else pos = end;
      dirSign = -dirSign;
    }
    const playing = cur && t < cur.t + cur.d ? cur : null;
    const si = playing ? this.stringOf(playing.p) : 1.5;
    const contactY = this.bridgeY + 4.6 * this.s;
    const tilt = (si - (this.open.length - 1) / 2) * 0.13;
    const cx = lerp(this.stringX(0), this.stringX(this.open.length - 1), si / (this.open.length - 1));
    this.bow.position.set(cx, contactY, this.stringZ(contactY, si) + 0.08 * this.s);
    this.bow.rotation.set(0, tilt, 0);
    this.bowBody.position.x = -pos * Lb;
    this.contact.copy(this.bow.position);
    const energy = this.open.map(() => 0);
    for (const n of notes) {
      if (n.t > t || t > n.t + n.d + 0.25) continue;
      const k = this.stringOf(n.p);
      const e = t < n.t + n.d ? 0.5 + 0.5 * n.v / 127 : 1 - (t - n.t - n.d) / 0.25;
      energy[k] = Math.max(energy[k]!, e);
    }
    return energy;
  }

  /** The strings from the tailpiece over the bridge to the nut; a ringing string shivers and brightens. */
  drawStrings(lb: LineBatch, m: THREE.Matrix4, t: number, energy: number[]) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const tailY = 1.1 * this.s + 11 * this.s * 0.86, tailZ = this.zTail + 0.25 * this.s;
    energy.forEach((e, i) => {
      const N = 28;
      for (let k = 0; k < N; k++) {
        const u0 = k / N, u1 = (k + 1) / N;
        const y0 = lerp(this.bridgeY, this.nutY, u0), y1 = lerp(this.bridgeY, this.nutY, u1);
        const x0 = lerp(this.stringX(i), this.stringX(i, 'nut'), u0), x1 = lerp(this.stringX(i), this.stringX(i, 'nut'), u1);
        const amp = e * 0.16 * this.s;
        const d0 = amp * Math.sin(Math.PI * u0) * Math.sin(t * 160 + i), d1 = amp * Math.sin(Math.PI * u1) * Math.sin(t * 160 + i);
        a.set(x0 + d0, y0, this.stringZ(y0, i)).applyMatrix4(m);
        b.set(x1 + d1, y1, this.stringZ(y1, i)).applyMatrix4(m);
        const g = 0.55 + 0.5 * e;
        lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, (0.05 + 0.012 * (3 - i)) * this.s, LIN.steel[0] * g, LIN.steel[1] * g, LIN.steel[2] * g, 1);
      }
      a.set(this.stringX(i, 'tail'), tailY, tailZ).applyMatrix4(m);
      b.set(this.stringX(i), this.bridgeY, this.stringZ(this.bridgeY, i)).applyMatrix4(m);
      lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.06 * this.s, LIN.steel[0] * 0.5, LIN.steel[1] * 0.5, LIN.steel[2] * 0.5, 1);
    });
  }

  /** Rosin dust: a few specks thrown off the contact point on each attack, drifting up and falling away. */
  drawDust(lb: LineBatch, m: THREE.Matrix4, t: number, notes: Note[], color: [number, number, number] = LIN.cobalt) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const contactY = this.bridgeY + 4.6 * this.s;
    for (const n of notes) {
      const age = t - n.t;
      if (age < 0 || age > 1.1) continue;
      const si = this.stringOf(n.p);
      const cx = this.stringX(si), cz = this.stringZ(contactY, si);
      const count = 5 + Math.round(4 * n.v / 127);
      for (let k = 0; k < count; k++) {
        const h1 = hash(n.t * 97.1 + k * 13.7), h2 = hash(n.t * 31.3 + k * 7.1), h3 = hash(n.t * 11.9 + k * 3.3);
        const vx = (h1 - 0.5) * 5 * this.s, vy = (h2 - 0.5) * 3 * this.s, vz = (2.5 + 4 * h3) * this.s;
        const p = (q: number) => [cx + vx * q, contactY + vy * q, cz + vz * q - 4.5 * this.s * q * q] as const;
        const [x0, y0, z0] = p(age), [x1, y1, z1] = p(age + 0.03);
        a.set(x0, y0, z0).applyMatrix4(m); b.set(x1, y1, z1).applyMatrix4(m);
        const al = (1 - age / 1.1) * 0.85;
        lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.09 * this.s, color[0], color[1], color[2], al);
      }
    }
  }
}

// ================================================================== woodwinds
export type ReedKind = 'flute' | 'oboe' | 'clarinet' | 'bassoon';

/**
 * A woodwind standing on its bell (y = 0) along +y (the flute: its foot at y = 0, its head up; the plate
 * lays it across): joints with metal ferrules, tone holes, key cups on arms off long rods held by posts,
 * rings round the open holes, a proper bell and mouthpiece / reed / head joint. The lower the note, the
 * more keys close from the top. `range` is [lowest, highest] MIDI pitch.
 */
export class Reed {
  group = new THREE.Group();
  keys: THREE.Object3D[] = [];
  keyRest: number[] = [];
  holeZ: number[] = [];
  constructor(public length: number, public radius: number, bodyHex: string, keyHex: string, public range: [number, number],
    nkeys = 9, public flare = 1.6, public kind: ReedKind = 'clarinet') {
    const body = mat(bodyHex), metal = mat(keyHex), dark = decal('#16181c');
    const r = radius, L = length;
    if (kind === 'bassoon') { this.buildBassoon(body, metal, dark, nkeys); return; }
    // the bore's outside profile, bottom (bell) to top
    const prof: THREE.Vector2[] = [];
    const N = 80;
    for (let i = 0; i <= N; i++) {
      const u = i / N, y = u * L;
      let rr = r;
      if (kind === 'oboe') rr = r * lerp(1.12, 0.62, u) * (u < 0.12 ? 1 + 0.45 * Math.sin((Math.PI * u) / 0.12) * 0.5 : 1); // conical, a tulip bell
      if (kind === 'clarinet') rr = r * (1 + (flare - 1) * Math.pow(Math.max(0, 1 - u / 0.16), 2.2)) * (u > 0.8 && u < 0.88 ? 1.18 : 1); // the bell, the barrel
      if (kind === 'flute') rr = r * (u > 0.72 ? 0.93 : 1);
      prof.push(new THREE.Vector2(rr, y));
    }
    prof.push(new THREE.Vector2(0.01, L));
    prof.unshift(new THREE.Vector2(prof[0]!.x * 0.85, 0));
    const bore = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), body);
    this.group.add(bore);
    // the bell's rim and the joints' ferrules
    const rimAt = (y: number, rr: number, th = 0.12) => { const m = new THREE.Mesh(new THREE.TorusGeometry(rr, th * r * 1.4, 8, 32), metal); m.rotation.x = Math.PI / 2; m.position.y = y; this.group.add(m); };
    const rAt = (y: number) => prof[Math.round(clamp(y / L) * N) + 1]!.x;
    if (kind !== 'flute') rimAt(0.15, rAt(0.15), 0.16);
    for (const f of kind === 'flute' ? [0.28, 0.72] : kind === 'oboe' ? [0.14, 0.45, 0.78] : [0.17, 0.5, 0.8, 0.88]) rimAt(f * L, rAt(f * L) * 1.02, 0.1);
    // the top: reed, mouthpiece or the flute's crown and lip plate
    if (kind === 'oboe') {
      const staple = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * r, 0.32 * r, 2.2 * r, 10), mat('#c8b48c'));
      staple.position.y = L + 1.1 * r;
      const reed = new THREE.Mesh(new THREE.BoxGeometry(0.75 * r, 2.4 * r, 0.12 * r), mat('#d9c9a0'));
      reed.position.y = L + 3.0 * r;
      this.group.add(staple, reed);
    }
    if (kind === 'clarinet') {
      const mp = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * r, 0.82 * r, 3.0 * r, 16), mat('#2a2c30'));
      mp.position.y = L + 1.5 * r;
      mp.scale.set(1, 1, 0.75);
      const lig = new THREE.Mesh(new THREE.TorusGeometry(0.8 * r, 0.1 * r, 6, 20), metal);
      lig.rotation.x = Math.PI / 2; lig.position.y = L + 1.0 * r;
      this.group.add(mp, lig);
    }
    if (kind === 'flute') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.85 * r, 0.95 * r, 1.4 * r, 16), metal);
      crown.position.y = L + 0.5 * r;
      const lip = new THREE.Mesh(new THREE.BoxGeometry(1.4 * r, 2.4 * r, 0.25 * r), metal);
      lip.position.set(0, L * 0.9, r * 0.98);
      const emb = new THREE.Mesh(new THREE.CircleGeometry(0.42 * r, 14), dark);
      emb.scale.set(1, 1.35, 1); emb.position.set(0, L * 0.9, r * 1.12);
      this.group.add(crown, lip, emb);
    }
    // tone holes, key cups on arms from a rod on posts (the rod runs along the +x side)
    const y0 = L * (kind === 'flute' ? 0.12 : 0.22), y1 = L * (kind === 'flute' ? 0.66 : 0.78);
    const rodX = r * 0.72, rodZ = r * 0.78;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * r, 0.07 * r, y1 - y0 + 2 * r, 6), metal);
    rod.position.set(rodX, (y0 + y1) / 2, rodZ);
    this.group.add(rod);
    for (let k = 0; k <= 3; k++) {
      const y = lerp(y0 - r * 0.6, y1 + r * 0.6, k / 3);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * r, 0.12 * r, 0.5 * r, 6), metal);
      post.rotation.x = Math.PI / 2; post.position.set(rodX, y, rodZ - 0.3 * r);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14 * r, 8, 6), metal);
      ball.position.set(rodX, y, rodZ);
      this.group.add(post, ball);
    }
    for (let i = 0; i < nkeys; i++) {
      const y = lerp(y0, y1, i / Math.max(1, nkeys - 1));
      const rr = rAt(y);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.34 * r, 16), dark);
      hole.position.set(0, y, rr + 0.01 * r);
      this.group.add(hole);
      const key = new THREE.Group();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * r, 0.5 * r, 0.22 * r, 18), metal);
      cup.rotation.x = Math.PI / 2;
      // open-hole keys (flute) and rings (oboe, clarinet) on alternate holes
      if (kind === 'flute' || i % 3 === 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45 * r, 0.07 * r, 6, 20), metal);
        key.add(ring);
        if (kind === 'flute') key.add(cup);
      } else key.add(cup);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(rodX * 1.0, 0.16 * r, 0.1 * r), metal);
      arm.position.set(rodX / 2, 0, 0.0);
      key.add(arm);
      const rest = rr + 0.32 * r;
      key.position.set(0, y, rest);
      this.group.add(key);
      this.keys.push(key);
      this.keyRest.push(rest);
      this.holeZ.push(rr);
    }
  }

  /** The bassoon: a boot at the bottom, the long joint with the bell up one side, the wing joint up the other, the bocal. */
  private buildBassoon(body: THREE.Material, metal: THREE.Material, dark: THREE.Material, nkeys: number) {
    const r = this.radius, L = this.length;
    const tube = (x: number, y0: number, y1: number, r0: number, r1: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 24), body);
      m.position.set(x, (y0 + y1) / 2, 0);
      this.group.add(m);
    };
    const dx = r * 1.15;
    // the boot (a rounded block joining both bores), its metal cap at the bottom
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.25, L * 0.24, 28), body);
    boot.scale.set(1.9, 1, 1.15); boot.position.set(0, L * 0.12, 0);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.28, r * 1.28, r * 0.5, 28), metal);
    cap.scale.set(1.9, 1, 1.15); cap.position.set(0, r * 0.25, 0);
    this.group.add(boot, cap);
    tube(dx, L * 0.24, L * 0.98, r * 1.0, r * 1.08); // the long joint, up to the bell
    tube(-dx, L * 0.24, L * 0.62, r * 0.9, r * 0.78); // the wing joint
    // the bell: a slight flare with a rim
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.08, r * 2.0, 24), body);
    bell.position.set(dx, L * 0.98 + r, 0);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.25, r * 0.14, 8, 28), metal);
    brim.rotation.x = Math.PI / 2; brim.position.set(dx, L * 0.98 + 2 * r, 0);
    this.group.add(bell, brim);
    for (const y of [0.24, 0.62]) for (const x of [dx, -dx]) {
      const fr = new THREE.Mesh(new THREE.TorusGeometry(r * (x > 0 ? 1.03 : 0.93), r * 0.1, 6, 24), metal);
      fr.rotation.x = Math.PI / 2; fr.position.set(x, L * y, 0);
      this.group.add(fr);
    }
    // the bocal: a thin metal S from the wing joint's top
    const top = new THREE.Vector3(-dx, L * 0.62, 0);
    const pts = [top, top.clone().add(new THREE.Vector3(-0.2 * r, 3 * r, 0)), top.clone().add(new THREE.Vector3(-2.6 * r, 6.5 * r, 1.0 * r)), top.clone().add(new THREE.Vector3(-6.5 * r, 7.6 * r, 2.4 * r))];
    const { geo } = taperedTube(pts, (u) => lerp(0.32, 0.14, u) * r, 40, 8);
    this.group.add(new THREE.Mesh(geo, metal));
    // keys along the long joint's front; the fingers' holes on the wing joint
    for (let i = 0; i < nkeys; i++) {
      const onWing = i % 3 === 0;
      const x = onWing ? -dx : dx, y = lerp(L * 0.28, onWing ? L * 0.58 : L * 0.9, i / Math.max(1, nkeys - 1));
      const rr = onWing ? r * 0.85 : r * 1.03;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.3 * r, 14), dark);
      hole.position.set(x, y, rr + 0.01 * r);
      const key = new THREE.Group();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * r, 0.42 * r, 0.2 * r, 16), metal);
      cup.rotation.x = Math.PI / 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14 * r, 1.2 * r, 0.1 * r), metal);
      arm.position.set(0, -0.6 * r, -0.05 * r);
      key.add(cup, arm);
      key.position.set(x, y, rr + 0.3 * r);
      this.group.add(hole, key);
      this.keys.push(key); this.keyRest.push(rr + 0.3 * r); this.holeZ.push(rr);
    }
  }

  /** Close keys for the sounding note (from the top down). Returns the attack pulse (no glow: nothing lights). */
  play(t: number, notes: Note[]) {
    let cur: Note | null = null, hit = 0;
    for (const n of notes) { if (n.t <= t && t < n.t + n.d) cur = n; hit = Math.max(hit, pulse(t, n.t, 0.1) * n.v / 127); }
    const closed = cur ? Math.round((1 - clamp((cur.p - this.range[0]) / (this.range[1] - this.range[0]))) * this.keys.length) : 0;
    this.keys.forEach((k, i) => {
      const down = i >= this.keys.length - closed ? 1 : 0;
      k.position.z = lerp(this.keyRest[i]!, this.holeZ[i]! + 0.12 * this.radius, down);
    });
    return hit;
  }

  /** Breath: wisps leaving the bell (and the open top) on each attack, rising and spreading. */
  drawBreath(lb: LineBatch, m: THREE.Matrix4, t: number, notes: Note[], color: [number, number, number] = LIN.cobalt) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const n of notes) {
      const age = t - n.t;
      if (age < 0 || age > 1.4) continue;
      for (let k = 0; k < 7; k++) {
        const h1 = hash(n.t * 53.1 + k * 9.7), h2 = hash(n.t * 17.3 + k * 4.1), h3 = hash(n.t * 7.7 + k * 2.9);
        const ang = h1 * Math.PI * 2, rr = this.radius * (1.2 + 3.5 * age * (0.6 + h2));
        const y = -0.4 * this.radius + age * (2 + 3 * h3) * this.radius;
        const x0 = Math.cos(ang) * rr, z0 = Math.sin(ang) * rr;
        a.set(x0, y, z0).applyMatrix4(m);
        b.set(Math.cos(ang + 0.25) * rr, y + 0.2 * this.radius, Math.sin(ang + 0.25) * rr).applyMatrix4(m);
        lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.09 * this.radius, color[0], color[1], color[2], (1 - age / 1.4) * 0.6);
      }
    }
  }
}

// ================================================================== the natural horn
/**
 * A natural horn: mouthpiece and leadpipe, three turns of tube widening as they go (ferrules on the
 * joints), a crook out of the coil into a flared bell with a rolled rim and a garland. The coil lies in the
 * xy plane; the bell faces +z from `bellPos` along `bellDir`.
 */
export class NaturalHorn {
  group = new THREE.Group();
  bellR = 15;
  bellPos = new THREE.Vector3();
  bellDir = new THREE.Vector3(0, 0, 1);
  constructor(hex = '#b8892f') {
    const brass = mat(hex), dark = mat('#2a2c30');
    // the coil: starts at the mouthpiece outside the circle, three turns, then out of the plane into the bell
    const pts: THREE.Vector3[] = [new THREE.Vector3(26, -6, -4), new THREE.Vector3(21, -3, -3.6)];
    for (let i = 0; i <= 150; i++) {
      const a = (i / 150) * Math.PI * 2 * 2.85 - 0.25, r = 17 + 1.0 * Math.sin(a * 0.5) - 1.2 * (i / 150);
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (i / 150) * 6 - 3));
    }
    const last = pts[pts.length - 1]!;
    pts.push(last.clone().add(new THREE.Vector3(1.2, 2.2, 2.2)), last.clone().add(new THREE.Vector3(1.4, 3.2, 5.6)));
    const { geo, curve } = taperedTube(pts, (u) => lerp(0.36, 0.95, Math.pow(u, 1.4)), 600, 12);
    this.group.add(new THREE.Mesh(geo, brass));
    // ferrules along the tube
    for (const u of [0.05, 0.22, 0.5, 0.78, 0.97]) {
      const p = curve.getPointAt(u), tn = curve.getTangentAt(u);
      this.group.add(ringAt(p, tn, lerp(0.36, 0.95, Math.pow(u, 1.4)) + 0.12, 0.12, brass));
    }
    // the mouthpiece: a cup and its shank, at the start
    const p0 = curve.getPointAt(0), t0 = curve.getTangentAt(0).negate();
    const mp: THREE.Vector2[] = [new THREE.Vector2(0.3, 0), new THREE.Vector2(0.45, 1.6), new THREE.Vector2(0.7, 2.6), new THREE.Vector2(1.1, 3.2), new THREE.Vector2(1.2, 3.5), new THREE.Vector2(0.6, 3.4)];
    const mpm = new THREE.Mesh(new THREE.LatheGeometry(mp, 18), brass);
    (mpm.material as THREE.Material).side = THREE.DoubleSide;
    mpm.position.copy(p0);
    mpm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t0);
    this.group.add(mpm);
    // the bell
    const end = curve.getPointAt(1), dir = curve.getTangentAt(1);
    this.bellPos.copy(end); this.bellDir.copy(dir);
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) { const u = i / 40; prof.push(new THREE.Vector2(0.95 + this.bellR * Math.pow(u, 3.4), u * 24)); }
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), brass);
    (bell.material as THREE.Material).side = THREE.DoubleSide;
    bell.position.copy(end);
    bell.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.group.add(bell);
    const rimP = end.clone().addScaledVector(dir, 24);
    this.group.add(ringAt(rimP, dir, this.bellR + 0.95, 0.42, brass));
    const garP = end.clone().addScaledVector(dir, 17.5);
    this.group.add(ringAt(garP, dir, 0.95 + this.bellR * Math.pow(17.5 / 24, 3.4) + 0.15, 0.22, brass));
    // the inside of the bell reads dark
    const throat = new THREE.Mesh(new THREE.CircleGeometry(this.bellR * 0.25, 24), dark);
    throat.position.copy(end.clone().addScaledVector(dir, 12));
    throat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().negate());
    this.group.add(throat);
  }
  play(t: number, notes: Note[]) {
    let hit = 0;
    for (const n of notes) hit = Math.max(hit, pulse(t, n.t, 0.12) * n.v / 127);
    return hit;
  }
  /** Sound rings out of the bell after each attack (in the horn's frame, matrix m), in the glaze's cobalt. */
  drawRings(lb: LineBatch, m: THREE.Matrix4, t: number, notes: Note[], color: [number, number, number] = LIN.cobalt) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const d = this.bellDir, up = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(d, up).normalize(), e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
    for (const n of notes) {
      const age = t - n.t;
      if (age < 0 || age > 1.2) continue;
      const r = this.bellR * (1 + age * 3.5), z = 24 + age * 55, g = 2.2 * (1 - age / 1.2) * (n.v / 127);
      const c = this.bellPos.clone().addScaledVector(d, z);
      for (let k = 0; k < 48; k++) {
        const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
        a.copy(c).addScaledVector(e1, Math.cos(a0) * r).addScaledVector(e2, Math.sin(a0) * r).applyMatrix4(m);
        b.copy(c).addScaledVector(e1, Math.cos(a1) * r).addScaledVector(e2, Math.sin(a1) * r).applyMatrix4(m);
        lb.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.18, color[0] * g, color[1] * g, color[2] * g, Math.min(1, g));
      }
    }
  }
}
