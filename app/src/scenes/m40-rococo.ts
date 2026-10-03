// The Mozart strings plate in full rococo splendour, still blue-and-white: a turned porcelain dish (flat
// well, cavetto, a reticulated rim of interlaced rings, a rolled edge) painted all over in cobalt (a garden
// pavilion in the centre, cartouches, flower sprays, garlands, a diaper band, a lappet border), relief
// porcelain roses and rocaille C-scrolls on it, a salon around it in soft focus (a damask cloth, mirror
// panels in scrolled frames, crystal chandeliers, painted vases), cobalt decoration painted on the
// instruments' tops, and glints: glaze highlights, prisms, candle flames, motes.
// Gold is the finale's: here "gilt" is only ever bright white glaze.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { styled } from '../engine/style';
import { hash, mulberry32 } from '../engine/util';
import { taperedTube, type Violin } from './m40-models';

const COB = '#1d3f8a', COB_D = '#0f2456', COB_L = 'rgba(29,63,138,';
const WHITE = '#f6f7f9';
const glaze = (hex = '#f4f6f8', map?: THREE.Texture) => styled({ color: new THREE.Color(hex), map, roughness: 0.15 });

// ------------------------------------------------------------------ painting toolkit (cobalt on glaze)
type G = CanvasRenderingContext2D;
type Rnd = () => number;

function wash(g: G, a: number) { g.fillStyle = `${COB_L}${a})`; }
function ink(g: G, w: number, a = 1) { g.strokeStyle = `${COB_L}${a})`; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; }

/** an almond leaf with a midrib, pointing along angle a */
function leaf(g: G, x: number, y: number, len: number, a: number, R: Rnd) {
  g.save(); g.translate(x, y); g.rotate(a);
  const w = len * (0.28 + 0.1 * R());
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -w, len, 0); g.quadraticCurveTo(len * 0.5, w, 0, 0);
  wash(g, 0.55 + 0.3 * R()); g.fill();
  ink(g, Math.max(1, len * 0.04), 0.95); g.stroke();
  g.beginPath(); g.moveTo(len * 0.08, 0); g.lineTo(len * 0.85, 0); ink(g, Math.max(1, len * 0.025), 0.9); g.stroke();
  g.restore();
}

/** a peony / rose head: rings of scalloped petals, washed darker to the centre */
function bloom(g: G, x: number, y: number, r: number, R: Rnd) {
  for (let ring = 0; ring < 4; ring++) {
    const rr = r * (1 - ring * 0.24), n = 7 + ((R() * 3) | 0), ph = R() * 6;
    g.beginPath();
    for (let i = 0; i <= n * 8; i++) {
      const a = (i / (n * 8)) * Math.PI * 2 + ph;
      const k = 0.8 + 0.2 * Math.abs(Math.sin((a - ph) * n / 2));
      const px = x + Math.cos(a) * rr * k, py = y + Math.sin(a) * rr * k;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    wash(g, 0.12 + ring * 0.16); g.fill();
    ink(g, Math.max(1, r * 0.05), 0.9); g.stroke();
  }
  g.fillStyle = COB_D;
  for (let i = 0; i < 7; i++) { const a = R() * 6.28, d = R() * r * 0.25; g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.06, 0, 7); g.fill(); }
}

/** a curling vine with leaves (a rococo scroll), from (x, y) heading a, turning by curl */
function vine(g: G, x: number, y: number, len: number, a: number, curl: number, R: Rnd) {
  const pts: [number, number][] = [];
  let px = x, py = y, ang = a;
  const n = 40;
  for (let i = 0; i <= n; i++) {
    pts.push([px, py]);
    const u = i / n;
    ang += curl * (0.02 + 0.12 * u * u);
    px += Math.cos(ang) * len / n; py += Math.sin(ang) * len / n;
  }
  g.beginPath(); pts.forEach(([a1, b1], i) => (i ? g.lineTo(a1, b1) : g.moveTo(a1, b1)));
  ink(g, Math.max(1.2, len * 0.025), 1); g.stroke();
  for (let i = 6; i < n; i += 6) {
    const [lx, ly] = pts[i]!, [nx, ny] = pts[i + 1]!;
    const t = Math.atan2(ny - ly, nx - lx);
    leaf(g, lx, ly, len * (0.16 + 0.06 * R()), t + (i % 12 ? 0.9 : -0.9), R);
  }
}

/** a spray: a bloom with buds and leaves on curving stems */
function spray(g: G, x: number, y: number, s: number, a: number, R: Rnd) {
  for (let k = 0; k < 3; k++) vine(g, x, y, s * (0.9 + 0.5 * R()), a + (k - 1) * 0.9, (R() - 0.5) * 2.2, R);
  bloom(g, x, y, s * 0.32, R);
  for (let k = 0; k < 3; k++) {
    const aa = a + (k - 1) * 1.1, d = s * (0.55 + 0.2 * R());
    bloom(g, x + Math.cos(aa) * d, y + Math.sin(aa) * d, s * 0.12, R);
  }
}

/** a rocaille cartouche: an asymmetric frame of C-scrolls and shell ribs round a reserved panel */
function cartouche(g: G, x: number, y: number, w: number, h: number, rot: number, R: Rnd, scene: (g: G) => void) {
  g.save(); g.translate(x, y); g.rotate(rot);
  // the panel (reserved white), its scene, then the frame over it
  g.beginPath(); g.ellipse(0, 0, w * 0.42, h * 0.4, 0, 0, Math.PI * 2); g.fillStyle = WHITE; g.fill();
  g.save(); g.clip(); scene(g); g.restore();
  ink(g, w * 0.025, 1); g.stroke();
  g.beginPath(); g.ellipse(0, 0, w * 0.46, h * 0.44, 0, 0, Math.PI * 2); ink(g, w * 0.012, 1); g.stroke();
  // C-scrolls round the frame
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2 * R();
    const cx = Math.cos(a) * w * 0.5, cy = Math.sin(a) * h * 0.48, rr = w * (0.06 + 0.04 * R());
    g.beginPath(); g.arc(cx, cy, rr, a + 0.4, a + 0.4 + Math.PI * 1.5); ink(g, w * 0.02, 1); g.stroke();
    g.beginPath(); g.arc(cx + Math.cos(a + 2) * rr * 0.6, cy + Math.sin(a + 2) * rr * 0.6, rr * 0.35, 0, 6.28); wash(g, 0.9); g.fill();
  }
  // a shell crest at the top: fanned ribs
  for (let i = -5; i <= 5; i++) {
    const a = -Math.PI / 2 + i * 0.13;
    g.beginPath(); g.moveTo(0, -h * 0.44); g.lineTo(Math.cos(a) * w * 0.22, -h * 0.44 + Math.sin(a) * h * 0.3); ink(g, w * 0.012, 0.95); g.stroke();
  }
  g.beginPath(); g.arc(0, -h * 0.44, w * 0.22, Math.PI * 1.05, Math.PI * 1.95); ink(g, w * 0.018, 1); g.stroke();
  // flower sprays tucked at two corners
  spray(g, -w * 0.48, h * 0.38, w * 0.22, 2.4, R);
  spray(g, w * 0.5, h * 0.3, w * 0.18, 0.6, R);
  g.restore();
}

/** a little landscape for a cartouche: a pavilion or a tree on an island, water lines */
function vignette(g: G, s: number, kind: number) {
  ink(g, s * 0.012, 1);
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-s * 0.35, s * (0.12 + i * 0.05)); g.lineTo(s * 0.35 - i * s * 0.05, s * (0.12 + i * 0.05)); g.stroke(); }
  if (kind % 2 === 0) {
    // a pavilion
    g.beginPath(); g.moveTo(-s * 0.14, s * 0.1); g.lineTo(-s * 0.14, -s * 0.04); g.lineTo(s * 0.14, -s * 0.04); g.lineTo(s * 0.14, s * 0.1); g.stroke();
    g.beginPath(); g.moveTo(-s * 0.2, -s * 0.04); g.quadraticCurveTo(0, -s * 0.24, s * 0.2, -s * 0.04); wash(g, 0.7); g.fill(); g.stroke();
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * s * 0.07, s * 0.1); g.lineTo(i * s * 0.07, -s * 0.03); g.stroke(); }
  } else {
    // a willow tree on an island
    g.beginPath(); g.moveTo(0, s * 0.1); g.lineTo(s * 0.02, -s * 0.15); g.stroke();
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.3; g.beginPath(); g.moveTo(s * 0.02, -s * 0.15); g.quadraticCurveTo(Math.cos(a) * s * 0.2, -s * 0.15 + Math.sin(a) * s * 0.1, Math.cos(a) * s * 0.22, s * 0.05); g.stroke(); }
    g.beginPath(); g.ellipse(0, s * 0.1, s * 0.22, s * 0.04, 0, 0, 7); wash(g, 0.5); g.fill();
  }
  // birds
  for (let i = 0; i < 3; i++) { const bx = -s * 0.25 + i * s * 0.1, by = -s * 0.22 + (i % 2) * s * 0.03; g.beginPath(); g.moveTo(bx - s * 0.02, by); g.quadraticCurveTo(bx, by - s * 0.02, bx + s * 0.02, by); g.stroke(); }
}

/** The centre: a garden pavilion with a dome, columns and steps, trees, a fountain, clouds and birds. */
function centreScene(g: G, s: number, R: Rnd) {
  // ground and water
  g.beginPath(); g.ellipse(0, s * 0.42, s * 0.95, s * 0.28, 0, Math.PI, Math.PI * 2); wash(g, 0.18); g.fill();
  ink(g, s * 0.006, 1);
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(-s * 0.7 + i * 0.03 * s, s * (0.5 + i * 0.035)); g.lineTo(s * 0.7 - i * 0.05 * s, s * (0.5 + i * 0.035)); g.stroke(); }
  // the pavilion
  const px = 0, py = s * 0.18;
  wash(g, 0.25); g.fillRect(px - s * 0.28, py - s * 0.32, s * 0.56, s * 0.32);
  ink(g, s * 0.008, 1); g.strokeRect(px - s * 0.28, py - s * 0.32, s * 0.56, s * 0.32);
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(px + i * s * 0.08, py); g.lineTo(px + i * s * 0.08, py - s * 0.3); ink(g, s * 0.012, 1); g.stroke(); }
  g.beginPath(); g.moveTo(px - s * 0.34, py - s * 0.32); g.lineTo(px + s * 0.34, py - s * 0.32); g.lineTo(px + s * 0.3, py - s * 0.37); g.lineTo(px - s * 0.3, py - s * 0.37); g.closePath(); wash(g, 0.8); g.fill();
  g.beginPath(); g.arc(px, py - s * 0.37, s * 0.2, Math.PI, 0); wash(g, 0.55); g.fill(); ink(g, s * 0.01, 1); g.stroke();
  for (let i = 1; i < 6; i++) { const a = Math.PI + (i / 6) * Math.PI; g.beginPath(); g.moveTo(px + Math.cos(a) * s * 0.2, py - s * 0.37 + Math.sin(a) * s * 0.2); g.lineTo(px, py - s * 0.37); ink(g, s * 0.005, 0.9); g.stroke(); }
  g.beginPath(); g.moveTo(px, py - s * 0.57); g.lineTo(px, py - s * 0.66); ink(g, s * 0.01, 1); g.stroke();
  g.beginPath(); g.arc(px, py - s * 0.67, s * 0.015, 0, 7); g.fillStyle = COB_D; g.fill();
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(px - s * (0.32 + i * 0.03), py + i * s * 0.02); g.lineTo(px + s * (0.32 + i * 0.03), py + i * s * 0.02); ink(g, s * 0.006, 1); g.stroke(); }
  // trees either side: clouds of foliage dabs
  for (const side of [-1, 1]) {
    const tx = side * s * 0.62, ty = s * 0.15;
    g.beginPath(); g.moveTo(tx, ty + s * 0.2); g.lineTo(tx + side * s * 0.02, ty - s * 0.2); ink(g, s * 0.02, 1); g.stroke();
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, d = R() * s * 0.2;
      g.beginPath(); g.arc(tx + Math.cos(a) * d, ty - s * 0.28 + Math.sin(a) * d * 0.8, s * (0.03 + 0.03 * R()), 0, 7);
      wash(g, 0.25 + 0.5 * R()); g.fill(); ink(g, s * 0.004, 0.9); g.stroke();
    }
  }
  // a fountain in front
  g.beginPath(); g.ellipse(0, s * 0.36, s * 0.14, s * 0.035, 0, 0, 7); wash(g, 0.5); g.fill(); ink(g, s * 0.006, 1); g.stroke();
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(0, s * 0.33); g.quadraticCurveTo(i * s * 0.05, s * 0.18, i * s * 0.09, s * 0.34); ink(g, s * 0.004, 0.9); g.stroke(); }
  // clouds and birds
  for (let k = 0; k < 4; k++) {
    const cx = (R() - 0.5) * s * 1.2, cy = -s * (0.62 + 0.18 * R());
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(cx + i * s * 0.06, cy - (i % 2) * s * 0.02, s * 0.04, Math.PI, 0); ink(g, s * 0.006, 0.9); g.stroke(); }
  }
  for (let i = 0; i < 6; i++) { const bx = (R() - 0.5) * s, by = -s * (0.45 + 0.3 * R()); g.beginPath(); g.moveTo(bx - s * 0.025, by); g.quadraticCurveTo(bx, by - s * 0.025, bx + s * 0.025, by); ink(g, s * 0.006, 1); g.stroke(); }
}

/** The dish's painting (top view, 4096 px over [-160, 160] world units: 12.8 px a unit). */
export function dishTexture() {
  const N = 4096, K = N / 320;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  const R = mulberry32(1788);
  g.fillStyle = '#f5f7f9'; g.fillRect(0, 0, N, N);
  g.translate(N / 2, N / 2);
  const ring = (r: number, w: number) => { g.beginPath(); g.arc(0, 0, r * K, 0, Math.PI * 2); ink(g, w, 1); g.stroke(); };
  // the centre scene, inside a double ring with a pearl border
  centreScene(g, 52 * K, R);
  ring(56, 10); ring(58.5, 4);
  for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * 61 * K, Math.sin(a) * 61 * K, 0.7 * K, 0, 7); g.fillStyle = COB; g.fill(); }
  ring(63, 4);
  // the field: cartouches with vignettes alternating with flower sprays, garlands swagged between them
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * 82 * K, cy = Math.sin(a) * 82 * K;
    cartouche(g, cx, cy, 34 * K, 26 * K, a + Math.PI / 2, R, (gg) => vignette(gg, 26 * K, i));
    const b = a + Math.PI / 6;
    spray(g, Math.cos(b) * 84 * K, Math.sin(b) * 84 * K, 9 * K, b + Math.PI, R);
    // a garland: a swag of leaves and flowers hung between the cartouches
    const a0 = a + 0.28, a1 = a + Math.PI / 3 - 0.28;
    const P = (u: number) => { const aa = a0 + (a1 - a0) * u, rr = 70 * K - Math.sin(Math.PI * u) * 4 * K; return [Math.cos(aa) * rr, Math.sin(aa) * rr] as const; };
    for (let k = 0; k <= 16; k++) {
      const [x, y] = P(k / 16), [x2, y2] = P(Math.min(1, (k + 1) / 16));
      const tt = Math.atan2(y2 - y, x2 - x);
      leaf(g, x, y, 3.2 * K, tt + (k % 2 ? 0.7 : -0.7), R);
      if (k % 4 === 2) bloom(g, x, y, 1.6 * K, R);
    }
  }
  // a solid cobalt band with a reserved white wave-scroll running round it
  g.beginPath(); g.arc(0, 0, 104 * K, 0, Math.PI * 2); g.arc(0, 0, 99 * K, 0, Math.PI * 2, true); g.fillStyle = COB; g.fill();
  g.beginPath();
  for (let i = 0; i <= 720; i++) { const a = (i / 720) * Math.PI * 2, r = (101.5 + 1.6 * Math.sin(a * 48)) * K; i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  ink(g, 0.5 * K, 1); g.strokeStyle = WHITE; g.stroke();
  for (let i = 0; i < 48; i++) { const a = ((i + 0.25) / 48) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * 101.5 * K, Math.sin(a) * 101.5 * K, 0.9 * K, 0, 7); g.fillStyle = WHITE; g.fill(); }
  // the cavetto: a diaper of fish scales, then lappets hanging from the rim
  for (let rr = 106; rr < 118; rr += 2.6) {
    const n = Math.round((2 * Math.PI * rr) / 2.6);
    for (let i = 0; i < n; i++) {
      const a = ((i + (Math.round(rr) % 2) * 0.5) / n) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * rr * K, Math.sin(a) * rr * K, 1.3 * K, a + Math.PI * 0.15, a + Math.PI * 0.85 + Math.PI);
      ink(g, 0.18 * K, 0.85); g.stroke();
    }
  }
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.save(); g.rotate(a);
    g.beginPath(); g.moveTo(-3.4 * K, -130 * K); g.quadraticCurveTo(-3.6 * K, -121 * K, 0, -118.5 * K); g.quadraticCurveTo(3.6 * K, -121 * K, 3.4 * K, -130 * K); g.closePath();
    wash(g, 0.85); g.fill(); ink(g, 0.25 * K, 1); g.stroke();
    g.beginPath(); g.arc(0, -124 * K, 1.1 * K, 0, 7); g.fillStyle = WHITE; g.fill();
    g.restore();
  }
  ring(118.2, 0.4 * K); ring(130, 1.2 * K);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ------------------------------------------------------------------ the dish
/** a C-scroll curve (rocaille), as points in the xz plane at height y */
function cScroll(cx: number, cz: number, size: number, rot: number, y: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    // a spiral end, a long arc, a spiral end turning the other way
    const a = -2.6 + u * 5.2, r = size * (0.55 + 0.45 * Math.cos(u * Math.PI * 2) * 0.4) * (1 - 0.35 * Math.abs(2 * u - 1) ** 3);
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.55;
    pts.push(new THREE.Vector3(cx + x * Math.cos(rot) - z * Math.sin(rot), y + 0.6 * Math.sin(Math.PI * u), cz + x * Math.sin(rot) + z * Math.cos(rot)));
  }
  return pts;
}

/** A porcelain rose with leaves: shells of petals cupped round a bud (one merged geometry, unit size). */
function roseGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const R = mulberry32(31);
  for (let ring = 0; ring < 4; ring++) {
    const n = 4 + ring, rr = 0.35 + ring * 0.22;
    for (let i = 0; i < n; i++) {
      const g = new THREE.SphereGeometry(0.5 + ring * 0.12, 10, 6, 0, Math.PI * 0.9, 0, Math.PI * 0.55);
      g.scale(1, 0.9, 0.55);
      g.rotateX(-0.25 - ring * 0.18);
      g.translate(0, 0.05 * (3 - ring), rr * 0.6);
      g.rotateY((i / n) * Math.PI * 2 + ring * 0.6 + R() * 0.3);
      parts.push(g.toNonIndexed());
    }
  }
  const bud = new THREE.SphereGeometry(0.3, 10, 8); bud.scale(1, 1.2, 1); bud.translate(0, 0.25, 0); parts.push(bud.toNonIndexed());
  for (let i = 0; i < 3; i++) {
    const l = new THREE.SphereGeometry(0.5, 10, 6); l.scale(1.6, 0.14, 0.6); l.translate(1.3, -0.15, 0); l.rotateY(i * 2.1 + 0.4);
    parts.push(l.toNonIndexed());
  }
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts)!;
}

export interface Dish { group: THREE.Group; glints: THREE.Vector3[] }

/** The dish: turned body (flat well to r 118, cavetto rising to r 131), the reticulated rim, rolled edge,
 *  relief rocaille scrolls and roses. The well's surface is y = 0 (the instruments lie on it). */
export function buildDish(avoid: { x: number; z: number; r: number }[]): Dish {
  const group = new THREE.Group();
  const glints: THREE.Vector3[] = [];
  // the body: a lathe profile (r, y), with top-view UVs so the painting lies flat on it
  const prof = [[0, 0], [116, 0], [120, 0.25], [124, 0.9], [128, 1.9], [131, 2.6], [132, 2.2], [131.5, 0.6], [124, -0.6], [0, -0.6]]
    .map(([r, y]) => new THREE.Vector2(r!, y!));
  const lg = new THREE.LatheGeometry(prof, 192);
  const pos = lg.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 320 + 0.5; uv[i * 2 + 1] = 0.5 - pos.getZ(i) / 320; }
  lg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // LatheGeometry winds its faces outward for a profile drawn bottom-up; ours runs over the top first
  const body = new THREE.Mesh(lg, glaze('#ffffff', dishTexture()));
  (body.material as THREE.Material).side = THREE.DoubleSide;
  group.add(body);
  // the reticulated rim: two courses of interlaced flattened rings, beads where they cross, a rolled edge
  const ringGeo = new THREE.TorusGeometry(4.2, 0.75, 8, 28); ringGeo.rotateX(Math.PI / 2); ringGeo.scale(1.25, 1, 0.8);
  const n = 72;
  const rings = new THREE.InstancedMesh(ringGeo, glaze('#f2f4f7'), n * 2);
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1.05, 12, 8), glaze('#ffffff'), n * 2);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1);
  for (let course = 0; course < 2; course++) {
    const r = course ? 147.5 : 139;
    for (let i = 0; i < n; i++) {
      const a = ((i + course * 0.5) / n) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      M.compose(new THREE.Vector3(Math.cos(a) * r, 2.6 + course * 0.4, Math.sin(a) * r), q, S);
      rings.setMatrixAt(course * n + i, M);
      const b = a + Math.PI / n;
      M.compose(new THREE.Vector3(Math.cos(b) * (r + 0.2), 3.0 + course * 0.4, Math.sin(b) * (r + 0.2)), q, S);
      beads.setMatrixAt(course * n + i, M);
      if (i % 3 === 0) glints.push(new THREE.Vector3(Math.cos(b) * r, 4.1 + course * 0.4, Math.sin(b) * r));
    }
  }
  group.add(rings, beads);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(133.2, 1.5, 12, 192), glaze('#ffffff')); inner.rotation.x = Math.PI / 2; inner.position.y = 2.6;
  const outer = new THREE.Mesh(new THREE.TorusGeometry(154.5, 2.6, 14, 220), glaze('#f8f9fb')); outer.rotation.x = Math.PI / 2; outer.position.y = 3.0;
  // a cobalt line painted on the rolled edge: a thinner torus riding its crown
  const edgeLine = new THREE.Mesh(new THREE.TorusGeometry(154.5, 0.55, 8, 220), styled({ color: new THREE.Color(COB) }));
  edgeLine.rotation.x = Math.PI / 2; edgeLine.position.y = 5.35;
  group.add(inner, outer, edgeLine);
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; glints.push(new THREE.Vector3(Math.cos(a) * 154.5, 5.4, Math.sin(a) * 154.5)); }
  // relief rocaille: C-scrolls standing on the cavetto, twelve round, and smaller pairs flanking each
  const scrollGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const cx = Math.cos(a) * 124, cz = Math.sin(a) * 124;
    const tg = taperedTube(cScroll(cx, cz, 6.5, a + Math.PI / 2, 1.2), (u) => 0.55 + 0.45 * Math.sin(Math.PI * u), 80, 10).geo;
    scrollGeos.push(tg.toNonIndexed());
    for (const side of [-1, 1]) {
      const b = a + side * 0.12;
      const tg2 = taperedTube(cScroll(Math.cos(b) * 121, Math.sin(b) * 121, 3.2, b + Math.PI / 2 + side * 0.6, 0.8), (u) => 0.35 + 0.3 * Math.sin(Math.PI * u), 50, 8).geo;
      scrollGeos.push(tg2.toNonIndexed());
    }
    glints.push(new THREE.Vector3(cx, 2.4, cz));
  }
  for (const g of scrollGeos) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); }
  group.add(new THREE.Mesh(mergeGeometries(scrollGeos)!, glaze('#ffffff')));
  // relief roses: clusters on the cavetto between the scrolls and a few in the well's open spaces
  const rose = roseGeometry();
  const spots: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13 + Math.PI / 12;
    for (let k = 0; k < 3; k++) spots.push([Math.cos(a + (k - 1) * 0.045) * (119 - k * 1.5), Math.sin(a + (k - 1) * 0.045) * (119 - k * 1.5), 2.2 - k * 0.4]);
  }
  const R = mulberry32(17);
  for (let i = 0; i < 40; i++) {
    const a = R() * Math.PI * 2, r = 70 + 40 * R();
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (avoid.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) continue;
    spots.push([x, z, 1.4 + R()]);
  }
  const roses = new THREE.InstancedMesh(rose, glaze('#fbfcfd'), spots.length);
  spots.forEach(([x, z, s], i) => {
    const yy = x * x + z * z > 116 * 116 ? 0.9 : 0;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 9) * 6.28);
    M.compose(new THREE.Vector3(x, yy + 0.35 * s, z), q, new THREE.Vector3(s * 1.6, s * 1.6, s * 1.6));
    roses.setMatrixAt(i, M);
    glints.push(new THREE.Vector3(x, yy + 1.2 * s, z));
  });
  group.add(roses);
  return { group, glints };
}

// ------------------------------------------------------------------ the salon
function damaskTexture() {
  const N = 1024;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef1f5'; g.fillRect(0, 0, N, N);
  const R = mulberry32(5);
  // a repeat of mirrored flower sprays in a faint wash (damask: pattern in the weave, not printed)
  for (let k = 0; k < 4; k++) {
    const x = (k % 2) * N / 2 + N / 4, y = Math.floor(k / 2) * N / 2 + N / 4;
    g.save(); g.globalAlpha = 0.35; spray(g, x, y, N * 0.12, -Math.PI / 2, R); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.anisotropy = 8;
  return t;
}

function vaseTexture(seed: number) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f7f9'; g.fillRect(0, 0, 1024, 512);
  const R = mulberry32(seed);
  g.fillStyle = COB; g.fillRect(0, 20, 1024, 26); g.fillRect(0, 466, 1024, 26);
  for (let i = 0; i < 4; i++) spray(g, 128 + i * 256, 260, 120, -Math.PI / 2 + (i % 2 ? 0.4 : -0.4), R);
  for (let i = 0; i < 32; i++) { g.beginPath(); g.arc(16 + i * 32, 80, 10, 0, Math.PI); ink(g, 4, 1); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** a scrolled frame: a rounded rectangle tube with a curling crest on top, in the xy plane */
function frameGeometry(w: number, h: number, r: number) {
  const pts: THREE.Vector3[] = [];
  const rr = Math.min(w, h) * 0.12;
  const corners: [number, number, number][] = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI], [w / 2 - rr, -h / 2 + rr, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 8; i++) { const a = a0 + (i / 8) * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const parts = [new THREE.TubeGeometry(curve, 160, r, 8, true).toNonIndexed()];
  for (const side of [-1, 1]) {
    const crest: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30, a = u * Math.PI * 1.6; crest.push(new THREE.Vector3(side * (w * 0.08 + Math.cos(a) * w * 0.1 * (1 - u * 0.6)), h / 2 + w * 0.02 + Math.sin(a) * w * 0.1 * (1 - u * 0.6), 0)); }
    parts.push(taperedTube(crest, (u) => r * (1.4 - u), 40, 8).geo.toNonIndexed());
  }
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return mergeGeometries(parts)!;
}

export interface Salon { group: THREE.Group; flames: THREE.Vector3[]; prisms: THREE.Vector3[] }

/** A chandelier: a turned stem, two tiers of S-arms with candle cups and candles, festoons of crystal drops. */
function chandelier(at: THREE.Vector3, size: number, out: Salon) {
  const g = new THREE.Group();
  g.position.copy(at);
  const crystal = glaze('#ffffff');
  const stemPts = [0, -0.2, -0.45, -0.7, -1.0].map((y) => new THREE.Vector3(0, y * size, 0));
  g.add(new THREE.Mesh(taperedTube(stemPts, (u) => size * (0.03 + 0.05 * Math.sin(Math.PI * u * 3) ** 2), 60, 12).geo, crystal));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12, 20, 14), crystal); ball.position.y = -0.85 * size; g.add(ball);
  const drop = new THREE.OctahedronGeometry(size * 0.035, 0); drop.scale(0.7, 1.6, 0.7);
  const drops: THREE.Vector3[] = [];
  for (const [tierY, armR, nArms] of [[-0.75, 0.55, 8], [-0.45, 0.38, 6]] as const) {
    for (let i = 0; i < nArms; i++) {
      const a = (i / nArms) * Math.PI * 2 + tierY;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const arm: THREE.Vector3[] = [];
      for (let k = 0; k <= 12; k++) { const u = k / 12; arm.push(dir.clone().multiplyScalar(u * armR * size).add(new THREE.Vector3(0, (tierY + 0.12 * Math.sin(u * Math.PI * 1.5) - 0.05 * u) * size, 0))); }
      g.add(new THREE.Mesh(taperedTube(arm, (u) => size * (0.018 + 0.01 * (1 - u)), 40, 8).geo, crystal));
      const tip = arm[arm.length - 1]!;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.05, size * 0.025, size * 0.04, 16), crystal); cup.position.copy(tip).add(new THREE.Vector3(0, size * 0.02, 0)); g.add(cup);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.016, size * 0.016, size * 0.14, 12), glaze('#fbfbfb')); candle.position.copy(tip).add(new THREE.Vector3(0, size * 0.11, 0)); g.add(candle);
      out.flames.push(tip.clone().add(new THREE.Vector3(0, size * 0.2, 0)).add(at));
      // a festoon of drops to the next arm
      const b = ((i + 1) / nArms) * Math.PI * 2 + tierY;
      const tip2 = new THREE.Vector3(Math.cos(b) * armR * size, (tierY - 0.05) * size, Math.sin(b) * armR * size);
      for (let k = 1; k < 9; k++) { const u = k / 9; const p = tip.clone().lerp(tip2, u); p.y -= Math.sin(Math.PI * u) * size * 0.12; drops.push(p); }
      for (let k = 1; k <= 3; k++) drops.push(tip.clone().add(new THREE.Vector3(0, -k * size * 0.07, 0)));
    }
  }
  const im = new THREE.InstancedMesh(drop, crystal, drops.length);
  const M = new THREE.Matrix4();
  drops.forEach((p, i) => { M.makeRotationY(i * 0.7); M.setPosition(p); im.setMatrixAt(i, M); out.prisms.push(p.clone().add(at)); });
  g.add(im);
  return g;
}

/** The salon round the table: a damask cloth, painted vases, a wall of mirror panels in scrolled frames
 *  between pilasters, and crystal chandeliers: seen past the dish in the low shots, softened by fog. */
export function buildSalon(opts: { centre?: boolean; scale?: number; vases?: boolean } = {}): Salon {
  const out: Salon = { group: new THREE.Group(), flames: [], prisms: [] };
  const G = out.group;
  const cloth = new THREE.Mesh(new THREE.CircleGeometry(520, 96), glaze('#ffffff', damaskTexture()));
  cloth.rotation.x = -Math.PI / 2; cloth.position.y = -1.2; G.add(cloth);
  // the cloth's hem: a cobalt band and a scalloped lace edge
  const hem = new THREE.Mesh(new THREE.RingGeometry(500, 510, 160), styled({ color: new THREE.Color(COB) }));
  hem.rotation.x = -Math.PI / 2; hem.position.y = -1.1; G.add(hem);
  // vases on the cloth
  const vaseProf = [[0, 0], [9, 0], [10, 1], [8, 3], [12, 12], [16, 26], [15, 36], [10, 44], [7, 47], [8, 50], [8.5, 52], [0, 52]].map(([r, y]) => new THREE.Vector2(r!, y!));
  const R = mulberry32(99);
  for (let i = 0; i < (opts.vases ?? true ? 7 : 0); i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3, r = 235 + 40 * R(), s = 1.1 + 0.8 * R();
    const vg = new THREE.LatheGeometry(vaseProf, 48);
    const v = new THREE.Mesh(vg, glaze('#ffffff', vaseTexture(i + 3)));
    v.scale.setScalar(s); v.position.set(Math.cos(a) * r, -1.2, Math.sin(a) * r); v.rotation.y = R() * 6;
    G.add(v);
  }
  // the wall: mirror panels between fluted pilasters, each in a scrolled frame; facing in (front side)
  const mirrorTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 256, 512); gr.addColorStop(0, '#c9d2de'); gr.addColorStop(0.45, '#eef2f7'); gr.addColorStop(0.55, '#b7c2d1'); gr.addColorStop(1, '#d9e0e9');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(40 + k * 60, 0); g.lineTo(-60 + k * 60, 512); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const NP = 18, WR = 620, PW = 150, PH = 300;
  const frameGeo = frameGeometry(PW, PH, 3.5);
  for (let i = 0; i < NP; i++) {
    const a = (i / NP) * Math.PI * 2;
    const panel = new THREE.Group();
    panel.position.set(Math.cos(a) * WR, 150, Math.sin(a) * WR);
    panel.lookAt(0, 150, 0);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), glaze('#ffffff', mirrorTex));
    panel.add(mirror);
    const frame = new THREE.Mesh(frameGeo, glaze('#ffffff')); frame.position.z = 2; panel.add(frame);
    // the pilaster between this panel and the next: a fluted column
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 360, 20), glaze('#eef1f5'));
    pil.position.set(PW / 2 + 22, 0, 0); panel.add(pil);
    G.add(panel);
    // the wall behind, a little further out (no gaps at the panel edges)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(2 * Math.PI * (WR + 8) / NP + 2, 420), glaze('#dfe5ee'));
    wall.position.set(Math.cos(a + Math.PI / NP) * (WR + 8), 150, Math.sin(a + Math.PI / NP) * (WR + 8));
    wall.lookAt(0, 150, 0);
    G.add(wall);
  }
  // chandeliers hung round the room (whichever way a low shot looks, one glitters behind the dish)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    G.add(chandelier(new THREE.Vector3(Math.cos(a) * 380, 240, Math.sin(a) * 380), 120, out));
  }
  // and one in full view beyond the dish from the strings' opening shot
  if (opts.centre ?? true) G.add(chandelier(new THREE.Vector3(0, 205, -430), 130, out));
  // the room scaled about the table's centre (glints with it)
  const k = opts.scale ?? 1;
  if (k !== 1) { G.scale.setScalar(k); for (const v of [...out.flames, ...out.prisms]) v.multiplyScalar(k); }
  return out;
}

// ------------------------------------------------------------------ cobalt painted on the instruments
/** Static world-space segments: a cobalt border inside the purfling, a flower spray on the lower bout, a
 *  scroll cartouche on the upper bout, painted on the arched top (lifted off it a hair). */
export function instrumentPainting(v: Violin, m: THREE.Matrix4, seed: number): Float32Array {
  const segs: number[] = [];
  const s = v.s, L = v.len, lift = 0.07 * s;
  const P = (x: number, y: number) => new THREE.Vector3(x, y, v.topZ(x, y) + lift).applyMatrix4(m);
  const poly = (pts: [number, number][], w: number, a = 1) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = P(pts[i]![0], pts[i]![1]), B = P(pts[i + 1]![0], pts[i + 1]![1]);
      segs.push(A.x, A.y, A.z, B.x, B.y, B.z, w, a);
    }
  };
  // a border line following the outline, inset
  for (const side of [1, -1]) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 120; i++) { const y = L * (0.03 + 0.94 * i / 120); pts.push([side * Math.max(0, v.hw(y) - 1.0 * s), y]); }
    poly(pts, 0.16 * s);
  }
  const R = mulberry32(seed);
  // a flower spray between the lower end and the bridge (clear of the f-holes and the tailpiece)
  const flower = (cx: number, cy: number, r: number) => {
    for (let ring = 0; ring < 3; ring++) {
      const rr = r * (1 - ring * 0.3), n = 7;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 56; i++) { const a = (i / 56) * Math.PI * 2; const k = 0.78 + 0.22 * Math.abs(Math.sin(a * n / 2)); pts.push([cx + Math.cos(a) * rr * k, cy + Math.sin(a) * rr * k]); }
      poly(pts, 0.11 * s);
    }
  };
  const stem = (x0: number, y0: number, len: number, a0: number, curl: number) => {
    const pts: [number, number][] = [];
    let x = x0, y = y0, a = a0;
    for (let i = 0; i <= 24; i++) { pts.push([x, y]); a += curl * 0.06; x += Math.cos(a) * len / 24; y += Math.sin(a) * len / 24; }
    poly(pts, 0.1 * s);
    for (let i = 6; i < 24; i += 6) {
      const [lx, ly] = pts[i]!, t = a0 + curl * 0.06 * i + (i % 12 ? 1 : -1);
      const lp: [number, number][] = [];
      for (let k = 0; k <= 10; k++) { const u = k / 10; lp.push([lx + Math.cos(t) * u * 2.4 * s + Math.cos(t + 1.57) * Math.sin(Math.PI * u) * 0.6 * s, ly + Math.sin(t) * u * 2.4 * s + Math.sin(t + 1.57) * Math.sin(Math.PI * u) * 0.6 * s]); }
      for (let k = 10; k >= 0; k--) { const u = k / 10; lp.push([lx + Math.cos(t) * u * 2.4 * s - Math.cos(t + 1.57) * Math.sin(Math.PI * u) * 0.6 * s, ly + Math.sin(t) * u * 2.4 * s - Math.sin(t + 1.57) * Math.sin(Math.PI * u) * 0.6 * s]); }
      poly(lp, 0.08 * s);
    }
  };
  const fy = L * 0.16;
  flower(-3.2 * s, fy, 1.7 * s); flower(3.4 * s, fy + 1.2 * s, 1.3 * s);
  stem(-3.2 * s, fy, 6 * s, Math.PI * (0.9 + 0.1 * R()), -1.2); stem(3.4 * s, fy + 1.2 * s, 5 * s, 0.1, 1.4);
  stem(0, fy - 1 * s, 4 * s, -Math.PI / 2, 0.8);
  // a cartouche of C-scrolls on the upper bout, under the fingerboard's end
  const cy = L * 0.83;
  for (const side of [1, -1]) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) { const a = -2.4 + (i / 40) * 4.8; const r = 2.2 * s * (1 - 0.3 * Math.abs(i / 20 - 1)); pts.push([side * (4.2 * s + Math.cos(a) * r), cy + Math.sin(a) * r * 0.8]); }
    poly(pts, 0.12 * s);
  }
  return new Float32Array(segs);
}

/** draw precomputed painting segments [x0 y0 z0 x1 y1 z1 w a] in cobalt */
export function drawPainting(lb: LineBatch, segs: Float32Array) {
  const c = LIN.prussian;
  for (let i = 0; i < segs.length; i += 8) lb.seg(segs[i]!, segs[i + 1]!, segs[i + 2]!, segs[i + 3]!, segs[i + 4]!, segs[i + 5]!, segs[i + 6]!, c[0], c[1], c[2], segs[i + 7]!);
}

// ------------------------------------------------------------------ glints
/** Twinkling star glints (additive): glaze highlights on the dish, prisms, candle flames, rising motes. */
export function drawGlints(X: LineBatch, t: number, dish: THREE.Vector3[], salon: Salon, level: number, barU = 0) {
  // the bar's light sweep (see M40Strings.sweep) passing a glint flares it: the scrollwork shimmers in its wake
  const sw = -190 + 380 * (0.5 - 0.5 * Math.cos(Math.PI * barU)); // = M40Strings.sweep's position (inOutSine)
  const nx = -Math.sin(Math.PI * 0.2), nz = Math.cos(Math.PI * 0.2);
  const star = (p: THREE.Vector3, size: number, a: number, w: number) => {
    if (a < 0.01) return;
    const k = 0.95;
    X.seg(p.x - size, p.y, p.z, p.x + size, p.y, p.z, w, k, k, 1, a);
    X.seg(p.x, p.y - size, p.z, p.x, p.y + size, p.z, w, k, k, 1, a);
    X.seg(p.x, p.y, p.z - size, p.x, p.y, p.z + size, w, k, k, 1, a * 0.6);
  };
  dish.forEach((p, i) => {
    const tw = Math.pow(Math.max(0, Math.sin(t * (1.3 + hash(i, 1) * 2.2) + hash(i, 2) * 40)), 14);
    const lit = Math.exp(-Math.pow((p.x * nx + p.z * nz - sw) / 12, 2)) * Math.sin(Math.PI * barU);
    const k = Math.max(tw, lit);
    star(p, 1.4 + 2.4 * k, (0.15 + 0.85 * k) * (0.6 + 0.4 * level), 0.22);
  });
  salon.prisms.forEach((p, i) => {
    if (i % 2) return;
    const tw = Math.pow(Math.max(0, Math.sin(t * (2 + hash(i, 3) * 3) + hash(i, 4) * 40)), 10);
    star(p, 3 + 5 * tw, 0.25 + 0.75 * tw, 0.6);
  });
  salon.flames.forEach((p, i) => {
    const fl = 0.85 + 0.15 * Math.sin(t * 13 + i * 2.1) * Math.sin(t * 7.3 + i);
    X.seg(p.x, p.y - 2, p.z, p.x, p.y + 6 * fl, p.z, 4.5, 1, 1, 0.95, 0.9);
    X.seg(p.x, p.y - 4, p.z, p.x, p.y + 10 * fl, p.z, 12, 0.7, 0.8, 1, 0.18);
    // candle motes drifting up from each flame
    for (let k = 0; k < 3; k++) {
      const period = 3 + hash(i, k + 10) * 2, ph = ((t + hash(i, k + 20) * period) % period) / period;
      const q = p.clone().add(new THREE.Vector3(Math.sin(ph * 6 + k) * 6, 8 + ph * 60, Math.cos(ph * 5 + k) * 6));
      star(q, 1.2, Math.sin(Math.PI * ph) * 0.5, 0.5);
    }
  });
}
