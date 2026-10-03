// Mozart 40/I, bars 21-28: the theme comes back, and every bar is "sampled" with dice. A
// Musikalisches Würfelspiel (the dice game for composing minuets, published under Mozart's name in
// 1792) lies on the table: a grid of bar numbers, one row per dice sum (2-12), one column per bar.
// On each downbeat a pair of porcelain dice is thrown; their sum lights a cell, and that bar is
// engraved onto a staff strip along the bottom: always the bar Mozart wrote. Deadpan sampling
// annotations (temperature, seed, p). Bar 28, the B-flat arrival, ff: every pair slams down at once.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { HEX, LIN, rgba } from '../engine/palette';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { glyph } from '../engine/music';
import { staffStep, type Note } from '../engine/score';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void } from './_kit';
import { styled } from '../engine/style';

const COLS = 8; // bars 21..28
/** framing per bar (default 'mid': over the column being sampled) */
const SHOTS: Record<number, 'wide' | 'mid' | 'macro'> = { 21: 'wide', 24: 'macro', 27: 'wide', 28: 'wide' };
const ROWS = 11; // sums 2..12
const CELL_W = 22, CELL_H = 9; // cm on the table
const TABLE_W = CELL_W * COLS + 40, TABLE_H = CELL_H * ROWS + 34;

/** One face of a die: porcelain with cobalt pips that read as drilled (a darker rim, a lit lower lip), a
 *  faint cobalt rim round the face and a little wear at the edges. */
function faceTexture(n: number) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, S, S);
  // the glaze is not flat: a soft sheen across, darker towards the rounded edges
  const sheen = g.createRadialGradient(S * 0.38, S * 0.32, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
  sheen.addColorStop(0, 'rgba(255,255,255,0.6)'); sheen.addColorStop(1, 'rgba(160,178,205,0.35)');
  g.fillStyle = sheen; g.fillRect(0, 0, S, S);
  const R = mulberry32(31 + n);
  // wear: chips of bare biscuit and grey flecks along the edges
  for (let i = 0; i < 90; i++) {
    const side = Math.floor(R() * 4), u = R() * S, d = Math.pow(R(), 2.5) * 22;
    const x = side === 0 ? u : side === 1 ? u : side === 2 ? d : S - d, y = side === 0 ? d : side === 1 ? S - d : u;
    g.fillStyle = `rgba(${120 + R() * 60},${130 + R() * 50},${150 + R() * 40},${0.12 + R() * 0.25})`;
    g.beginPath(); g.ellipse(x, y, 1 + R() * 4, 1 + R() * 2.5, R() * 3, 0, Math.PI * 2); g.fill();
  }
  // a painted cobalt double rule inset from the edge
  g.strokeStyle = 'rgba(46,93,166,0.55)'; g.lineWidth = 3; g.strokeRect(34, 34, S - 68, S - 68);
  g.lineWidth = 1.2; g.strokeRect(46, 46, S - 92, S - 92);
  const P: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.24], [0.73, 0.24], [0.27, 0.5], [0.73, 0.5], [0.27, 0.76], [0.73, 0.76]],
  };
  for (const [x, y] of P[n]!) {
    const r = (n === 1 ? 70 : 46) * (S / 512), cx = x * S, cy = y * S;
    // the drilled pip: the cobalt fill, darker towards the top (in shadow), a pale lip at the bottom
    const pg = g.createLinearGradient(cx, cy - r, cx, cy + r);
    pg.addColorStop(0, HEX.prussian); pg.addColorStop(1, '#2E5DA6');
    g.fillStyle = pg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = r * 0.12;
    g.beginPath(); g.arc(cx, cy, r * 0.94, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.strokeStyle = 'rgba(12,35,80,0.6)'; g.lineWidth = r * 0.1;
    g.beginPath(); g.arc(cx, cy, r * 1.04, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** The table: bar numbers in the grid, Cormorant figures, cobalt ink on the glaze. */
function tableTexture(values: number[][]) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 * TABLE_H / TABLE_W);
  const g = c.getContext('2d')!;
  const sx = c.width / TABLE_W, sy = c.height / TABLE_H;
  g.fillStyle = '#f2f4f6'; g.fillRect(0, 0, c.width, c.height);
  // laid paper: chain lines, fibres, a few foxing spots, a darker margin where it was handled
  const R = mulberry32(1792);
  g.strokeStyle = 'rgba(120,140,170,0.07)'; g.lineWidth = 2;
  for (let x = 0; x < c.width; x += 46) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  g.lineWidth = 0.6;
  for (let y = 0; y < c.height; y += 5) { g.globalAlpha = 0.25 + 0.2 * R(); g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  g.globalAlpha = 1;
  for (let i = 0; i < 2600; i++) {
    const x = R() * c.width, y = R() * c.height, l = 3 + R() * 14, a = R() * Math.PI;
    g.strokeStyle = `rgba(110,130,160,${0.05 + R() * 0.08})`; g.lineWidth = 0.6 + R();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = R() * c.width, y = R() * c.height, r = 3 + R() * 16;
    const fg = g.createRadialGradient(x, y, 0, x, y, r);
    fg.addColorStop(0, 'rgba(140,150,175,0.22)'); fg.addColorStop(1, 'rgba(140,150,175,0)');
    g.fillStyle = fg; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const edge = g.createLinearGradient(0, 0, 0, c.height);
  edge.addColorStop(0, 'rgba(120,140,170,0.16)'); edge.addColorStop(0.06, 'rgba(120,140,170,0)');
  edge.addColorStop(0.94, 'rgba(120,140,170,0)'); edge.addColorStop(1, 'rgba(120,140,170,0.18)');
  g.fillStyle = edge; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = HEX.prussian; g.fillStyle = HEX.prussian;
  g.lineWidth = 6; g.strokeRect(14 * sx, 10 * sy, (TABLE_W - 28) * sx, (TABLE_H - 20) * sy);
  g.lineWidth = 1.5; g.strokeRect(16.2 * sx, 12.2 * sy, (TABLE_W - 32.4) * sx, (TABLE_H - 24.4) * sy);
  g.font = `italic 600 ${Math.round(6 * sy)}px "CormorantItalic-600"`;
  g.textAlign = 'center';
  g.fillText('Zahlentafel', TABLE_W / 2 * sx, 8 * sy);
  g.font = `600 ${Math.round(5.2 * sy)}px "Cormorant-600"`;
  for (let r = 0; r < ROWS; r++) {
    g.fillText(String(r + 2), 26 * sx, (24 + r * CELL_H + 6) * sy);
    for (let k = 0; k < COLS; k++) {
      const x = (34 + k * CELL_W) * sx, y = (24 + r * CELL_H) * sy;
      g.lineWidth = 1.5; g.strokeRect(x, y, CELL_W * sx, CELL_H * sy);
      g.fillText(String(values[r]![k]!), x + CELL_W * sx / 2, y + CELL_H * sy * 0.72);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** Rotation that puts face value `v` on top (+y), with a yaw. Box faces: +x,-x,+y,-y,+z,-z = 1,6,2,5,3,4. */
function faceUp(v: number, yaw: number) {
  const e = new THREE.Euler();
  if (v === 1) e.set(0, 0, Math.PI / 2); // +x up
  if (v === 6) e.set(0, 0, -Math.PI / 2);
  if (v === 2) e.set(0, 0, 0);
  if (v === 5) e.set(Math.PI, 0, 0);
  if (v === 3) e.set(-Math.PI / 2, 0, 0); // +z up
  if (v === 4) e.set(Math.PI / 2, 0, 0);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromEuler(e));
}

interface Throw { t: number; col: number; a: number; b: number; dice: THREE.Mesh[]; land: [number, number][]; spin: THREE.Quaternion[]; yaw: number[]; notes: Note[]; bar: number }

export default class M40Dice extends Scene {
  st = new Stage3D();
  bg = new Void();
  fx = new LineBatch(12000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  text = new Layer2D();
  throws: Throw[] = [];
  values: number[][] = [];
  tableMat!: THREE.MeshPhysicalMaterial;
  t28 = 0;

  override async init() {
    const sc = this.ctx.score, seg = 'm40';
    const R = mulberry32(1788);
    // the grid of bar numbers (the real game's table is 176 bars; ours is the bars of the movement, shuffled)
    for (let r = 0; r < ROWS; r++) this.values.push(Array.from({ length: COLS }, (_, k) => 1 + Math.floor(R() * 176) + (k === 0 ? 0 : 0)));
    const vl1 = sc.notesIn(this.ctx.start - 1, this.ctx.end + 1).filter((n) => n.part === sc.partIndex(`${seg}:vl1`));
    const mats = [1, 6, 2, 5, 3, 4].map((n) => styled({ color: new THREE.Color(0xffffff), map: faceTexture(n), roughness: 0.25 }));
    const geo = new RoundedBoxGeometry(8, 8, 8, 4, 1.4);
    for (let k = 0; k < COLS; k++) {
      const bar = 21 + k;
      const bt = sc.bar(bar, seg).t;
      // the dice: two faces whose sum picks a row; the cell then gets this bar's number (the sample is always Mozart)
      const a = 1 + Math.floor(R() * 6), b = 1 + Math.floor(R() * 6);
      this.values[a + b - 2]![k] = bar;
      const dice = [0, 1].map(() => { const m = new THREE.Mesh(geo, mats); this.st.scene.add(m); return m; });
      const cx = 34 + k * CELL_W + CELL_W / 2 - TABLE_W / 2;
      const land: [number, number][] = [[cx - 6 + R() * 2, 74 + R() * 8], [cx + 5 + R() * 2, 80 + R() * 8]];
      const yaw = [R() * Math.PI, R() * Math.PI];
      const spin = [0, 1].map(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 9, R() * 9, R() * 9)));
      this.throws.push({ t: bt, col: k, a, b, dice, land, spin, yaw, notes: vl1.filter((n) => n.bar === bar), bar });
    }
    this.t28 = sc.bar(28, seg).t;
    this.tableMat = styled({ color: new THREE.Color(0xffffff), map: tableTexture(this.values), roughness: 0.3 });
    // the printed table on a board: a slab with the sheet on top (its edge reads as a stack of pages)
    const edgeMat = styled({ color: new THREE.Color(0xd9dee5), roughness: 0.6 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, 1.6, TABLE_H), [edgeMat, edgeMat, this.tableMat, edgeMat, edgeMat, edgeMat]);
    table.position.y = -0.8;
    this.st.scene.add(table);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), styled({ color: new THREE.Color(0xe8eaed), roughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.7;
    this.st.scene.add(floor);
  }

  /** Pose the dice of one throw at t: thrown in from the camera side 0.35 s before the downbeat, landing on it. */
  poseThrow(th: Throw, t: number) {
    const t0 = th.t - 0.32;
    const slam = this.t28 > 0 && th.bar !== 28 && t >= this.t28 ? Math.max(0, 1 - (t - this.t28) / 0.2) : 0;
    th.dice.forEach((d, i) => {
      const age = t - t0;
      if (age < 0) { d.visible = false; return; }
      d.visible = true;
      const [lx, lz] = th.land[i]!;
      const fly = clamp(age / 0.32);
      // a ballistic arc in from the front, two bounces, then still
      const x = lerp(lx + 30 * (i ? 1 : -1), lx, ease.outCubic(fly));
      const z = lerp(lz + 70, lz, ease.outQuad(fly)) - TABLE_H / 2;
      const after = Math.max(0, age - 0.32);
      const bounce = after > 0 ? Math.abs(Math.sin(after * 18)) * 5 * Math.exp(-after * 9) : 0;
      const y = fly < 1 ? 4 + 30 * Math.sin(Math.PI * fly) : 4 + bounce + slam * 6;
      d.position.set(x, y, z);
      const settle = clamp(after / 0.35);
      const final = faceUp(i ? th.b : th.a, th.yaw[i]!);
      const tumble = th.spin[i]!.clone().slerp(final, ease.outCubic(fly * 0.5 + settle * 0.5));
      d.quaternion.copy(settle >= 1 ? final : tumble);
    });
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    for (const th of this.throws) this.poseThrow(th, t);
    // the camera follows a shot list (the game has to be read before it can be cut up): bar 21 establishes the
    // whole table, the next bars follow the column being sampled, one close-up of the dice landing (bar 24),
    // bar 27 pulls back out, and the ff on 28 holds the whole table
    const i = this.throws.reduce((m, th, j) => (t >= th.t - 0.4 ? j : m), 0);
    const cur = this.throws[i]!, prev = this.throws[Math.max(0, i - 1)]!;
    const k28 = prog(t, this.t28, this.t28 + 0.6, ease.outExpo);
    const hit = Math.max(0, ...this.throws.map((th) => pulse(t, th.t, 0.1))) + 1.5 * pulse(t, this.t28, 0.15);
    const view = (th: Throw) => {
      const kind = SHOTS[th.bar] ?? 'mid';
      const cx = 34 + th.col * CELL_W + CELL_W / 2 - TABLE_W / 2;
      const v = kind === 'wide'
        ? { eye: new THREE.Vector3(0, 165, 112), at: new THREE.Vector3(0, 0, -6), fov: 44 }
        : { eye: new THREE.Vector3(cx * 0.9, 62, 78), at: new THREE.Vector3(cx, 0, 8), fov: 40 };
      if (kind === 'macro') {
        // close on where the first die lands, then pull back to the column to read the cell it lit
        const m = 1 - prog(t, th.t + 0.15, th.t + 0.6, ease.inOutCubic);
        const [lx, lz] = th.land[0]!, dz = lz - TABLE_H / 2;
        v.eye.lerp(new THREE.Vector3(lx + 14, 12, dz + 22), m);
        v.at.lerp(new THREE.Vector3(lx + 3, 3, dz), m);
      }
      return v;
    };
    const vc = view(cur), vp = view(prev);
    // glide from the previous framing into this one before the throw lands (a close-up cuts in instead)
    const u = SHOTS[cur.bar] === 'macro' || i === 0 ? 1 : prog(t, cur.t - 0.4, cur.t - 0.02, ease.inOutCubic);
    const wide = view({ ...cur, bar: 28 });
    const eye = vp.eye.clone().lerp(vc.eye, u).lerp(wide.eye, k28);
    const at = vp.at.clone().lerp(vc.at, u).lerp(wide.at, k28);
    const fov = lerp(lerp(vp.fov, vc.fov, u), wide.fov, k28);
    eye.y += 4 * hit; eye.z += 6 * hit;
    eye.x += noise1(t * 0.5, 3) * 1.5;
    this.st.look(eye, at, 0.02 * noise1(t, 9), fov);
    this.st.key.intensity = 2.4 + hit;
    this.bg.render(renderer, out, t, 0, 0);
    this.st.render(renderer, out);
    this.chips(t);
    this.fx.render(renderer, out, this.st.cam);
    this.drawOverlay(t);
    comp.draw(renderer, this.text.upload(), out);
    const sh = 8 * hit;
    return {
      ramp: 'porcelain', grade: 1, gradeSteps: 4, hatch: 0.25,
      bloom: 0.7, bloomThreshold: 1.15, halation: 0, grain: 0.05, vignette: 0.28,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.02 * hit, ca: 1 + 2 * hit,
      fade: prog(t, this.ctx.end - 0.5, this.ctx.end),
    };
  }

  /** Where each die lands: a puff of porcelain dust and a few chips kicked up and falling back, in cobalt. */
  chips(t: number) {
    const X = this.fx; X.clear();
    const C = LIN.cobalt;
    for (const th of this.throws) {
      const hits = [th.t, ...(this.t28 > 0 && th.bar !== 28 ? [this.t28] : [])];
      for (const t0 of hits) {
        const age = t - t0;
        if (age < 0 || age > 1.2) continue;
        th.land.forEach(([lx, lz], i) => {
          const z0 = lz - TABLE_H / 2;
          // the dust ring
          const r = 4 + 18 * ease.outCubic(Math.min(1, age / 0.9)), al = 0.5 * (1 - age / 1.2);
          for (let k = 0; k < 32; k++) {
            const a0 = (k / 32) * Math.PI * 2, a1 = ((k + 1) / 32) * Math.PI * 2;
            X.seg(lx + Math.cos(a0) * r, 0.25, z0 + Math.sin(a0) * r, lx + Math.cos(a1) * r, 0.25, z0 + Math.sin(a1) * r, 0.25, C[0], C[1], C[2], al);
          }
          // chips
          for (let k = 0; k < 14; k++) {
            const h1 = hash(t0, i, k, 1), h2 = hash(t0, i, k, 2), h3 = hash(t0, i, k, 3);
            const a = h1 * Math.PI * 2, v = 10 + 26 * h2, up = 14 + 20 * h3;
            const p = (q: number) => [lx + Math.cos(a) * v * q, Math.max(0.2, 1 + up * q - 60 * q * q), z0 + Math.sin(a) * v * q] as const;
            const [x0, y0, zz0] = p(age), [x1, y1, zz1] = p(age + 0.025);
            X.seg(x0, y0, zz0, x1, y1, zz1, 0.35 + 0.4 * h3, C[0], C[1], C[2], 0.8 * (1 - age / 1.2));
          }
        });
      }
    }
  }

  /** The 2D layer: the sampled cell's highlight (projected), the staff strip assembling bar by bar, the annotations. */
  drawOverlay(t: number) {
    const T = this.text; T.clear();
    const c = T.ctx;
    const cam = this.st.cam;
    const proj = (x: number, z: number) => { const v = new THREE.Vector3(x, 0.2, z).project(cam); return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H }; };
    // the lit cell of each landed throw
    for (const th of this.throws) {
      const a = prog(t, th.t + 0.05, th.t + 0.2);
      if (a <= 0) continue;
      const row = th.a + th.b - 2;
      const x0 = 34 + th.col * CELL_W - TABLE_W / 2, z0 = 24 + row * CELL_H - TABLE_H / 2;
      const p = [proj(x0, z0), proj(x0 + CELL_W, z0), proj(x0 + CELL_W, z0 + CELL_H), proj(x0, z0 + CELL_H)];
      c.save();
      c.globalAlpha = a * (0.55 + 0.45 * pulse(t, th.t + 0.05, 0.25));
      c.strokeStyle = rgba('signal', 1); c.lineWidth = 6; c.fillStyle = rgba('signal', 0.28);
      c.beginPath(); p.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
    // the staff strip: each sampled bar engraved as it is chosen (the first violins' line)
    const y0 = H - 140, sp = 15, x0 = 120, bw = (W - 240) / COLS;
    c.save();
    c.fillStyle = rgba('bone', 0.96); c.fillRect(x0 - 50, y0 - 95, W - 2 * x0 + 100, 190);
    c.strokeStyle = rgba('ink', 0.55); c.lineWidth = 1.2;
    for (let l = -2; l <= 2; l++) { c.beginPath(); c.moveTo(x0 - 20, y0 - l * sp); c.lineTo(W - x0 + 20, y0 - l * sp); c.stroke(); }
    c.fillStyle = rgba('ink', 0.9);
    c.font = font('Bravura', 4 * sp);
    c.fillText(glyph('gClef'), x0 - 18, y0 + sp);
    const mid = staffStep(71);
    for (const th of this.throws) {
      const a = prog(t, th.t, th.t + 0.12);
      if (a <= 0) continue;
      const bx = x0 + 40 + th.col * bw;
      c.globalAlpha = a;
      c.fillStyle = rgba('ink', 0.9);
      c.fillRect(bx + bw - 6, y0 - 2 * sp, 1.5, 4 * sp); // barline
      for (const n of th.notes) {
        const nx = bx + 8 + (n.pos / 4) * (bw - 20);
        const ny = y0 - ((staffStep(n.p) - mid) * sp) / 2;
        const sounding = t >= n.t && t < n.t + n.d;
        c.fillStyle = sounding ? rgba('signal', 1) : rgba('ink', 0.92);
        c.fillText(glyph(n.qd >= 4 ? 'noteheadWhole' : n.qd >= 2 ? 'noteheadHalf' : 'noteheadBlack'), nx, ny);
      }
      c.font = font(F.mono(500), 17); c.letterSpacing = '2px';
      c.fillStyle = rgba('signal', 1);
      c.fillText(`m.${th.bar} ← ${th.a}+${th.b}`, bx + 4, y0 - 3 * sp - 14);
      c.font = font('Bravura', 4 * sp); c.letterSpacing = '0px';
    }
    c.globalAlpha = 1;
    c.restore();
    // the deadpan header
    c.save();
    c.font = font(F.mono(500), 22); c.letterSpacing = '4px';
    c.fillStyle = rgba('ink', 0.85);
    c.fillText('MUSIKALISCHES WÜRFELSPIEL · SAMPLING K. 550 BAR BY BAR', 90, 86);
    const done = this.throws.filter((th) => t >= th.t).length;
    c.fillStyle = rgba('signal', 1);
    c.fillText(`temperature 1.0 · seed 1788 · ${done}/${COLS} sampled · p(Mozart) = ${(1).toFixed(2)}`, 90, 124);
    c.restore();
    void hash;
  }
}
