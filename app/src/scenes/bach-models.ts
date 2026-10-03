// The Bach plate's organ, modelled: flue pipes (a conical foot from the toe, the cylindrical body, the
// mouth with its raised shield-shaped upper lip, an open top), polished tin read through vertical sheen
// bands; carved pipe shades (pierced scrollwork) for the case; turned finials; a music desk with a page.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { styled } from '../engine/style';
import { mulberry32 } from '../engine/util';

const col = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

let SHEEN: THREE.Texture | null = null;
/** Polished tin: vertical bands of light and shade around the pipe (u = around the lathe). */
export function sheenTexture() {
  if (SHEEN) return SHEEN;
  const c = document.createElement('canvas'); c.width = 256; c.height = 4;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 256, 0);
  // u = 0 is at +x going round: the front (+z) is u = 0.25 for three's lathe; bright band left of front
  const stops: [number, string][] = [[0, '#8d877e'], [0.12, '#b9b3a8'], [0.2, '#f4efe4'], [0.24, '#cfc8bb'], [0.3, '#8a847a'], [0.38, '#bdb7ac'], [0.5, '#6d685f'], [0.75, '#57524b'], [0.9, '#7c766d'], [1, '#8d877e']];
  for (const [o, cc] of stops) grd.addColorStop(o, cc);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 4);
  SHEEN = new THREE.CanvasTexture(c); SHEEN.colorSpace = THREE.SRGBColorSpace;
  return SHEEN;
}

/**
 * One flue pipe, its mouth at y = 0 facing +z: the foot (cone from the toe at y = -foot up to radius r),
 * the body (r) up to y = h, open at the top. Returns the group and the material (emissive for the glow).
 */
export function flutePipe(r: number, h: number, foot: number, tint = '#ffffff', map: THREE.Texture = sheenTexture(), lipMat?: THREE.Material) {
  const mat = styled({ color: col(tint), map, roughness: 0.3, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  const prof: THREE.Vector2[] = [
    new THREE.Vector2(r * 0.12, -foot), new THREE.Vector2(r * 0.18, -foot + 0.4), // the toe
    new THREE.Vector2(r * 0.96, -0.25), new THREE.Vector2(r, 0), // the foot's cone up to the mouth
  ];
  // the body in 12 even steps (the texture's v runs per profile point: v = 3/17 at the mouth, (3 + k)/17 at k/12 of the body)
  for (let k = 1; k <= 12; k++) prof.push(new THREE.Vector2(r, k < 12 ? (h * k) / 12 : h - 0.15));
  prof.push(new THREE.Vector2(r * 1.04, h - 0.05), new THREE.Vector2(r * 0.92, h)); // a rolled rim
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), mat);
  const g = new THREE.Group();
  g.add(body);
  // the open top: a dark disc just inside the rim
  const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 24), styled({ color: col('#0b0a09') }));
  top.rotation.x = -Math.PI / 2; top.position.y = h - 0.12;
  g.add(top);
  // the mouth: a dark slot, the upper lip a raised shield above it, the lower lip a flattened band below
  const mw = r * 1.15, mh = r * 0.42;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(mw, mh, 0.12), styled({ color: col('#070606') }));
  slot.position.set(0, mh / 2, r * 0.97);
  const sh = new THREE.Shape();
  sh.moveTo(-mw / 2, 0); sh.lineTo(mw / 2, 0);
  sh.quadraticCurveTo(mw / 2, r * 0.9, 0, r * 1.55);
  sh.quadraticCurveTo(-mw / 2, r * 0.9, -mw / 2, 0);
  const lipGeo = new THREE.ExtrudeGeometry(sh, { depth: r * 0.08, bevelEnabled: true, bevelSize: r * 0.03, bevelThickness: r * 0.03, bevelSegments: 1, curveSegments: 10 });
  const lip = new THREE.Mesh(lipGeo, lipMat ?? mat);
  lip.position.set(0, mh, r * 0.93);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(mw, r * 0.22, r * 0.1), mat);
  lower.position.set(0, -r * 0.11, r * 0.98);
  g.add(slot, lip, lower);
  return { group: g, mat };
}

/**
 * Pierced scrollwork for a pipe shade: C-scrolls, leaves and a border, carved in dark wood. The board is
 * w x h (world units); `cut(x)` gives, for x in 0..1 across, the height (0..1 from the bottom) under
 * which the board is cut away (it follows the tops of the pipes below it).
 */
export function shadeMesh(w: number, h: number, cut: (x: number) => number, seed = 1, wood = '#3a2a1e') {
  const PX = 1024, PY = Math.max(64, Math.round((PX * h) / w));
  const c = document.createElement('canvas'); c.width = PX; c.height = PY;
  const g = c.getContext('2d')!;
  const R = mulberry32(seed);
  g.clearRect(0, 0, PX, PY);
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff';
  g.lineCap = 'round';
  const s = PY / 6;
  // the scrolls: pairs of C-scrolls back to back along the board, a leaf between them
  for (let x = s * 0.6; x < PX; x += s * 1.6) {
    const y = PY * (0.35 + 0.3 * R());
    g.lineWidth = s * 0.16;
    for (const d of [-1, 1]) {
      g.beginPath(); g.arc(x + d * s * 0.32, y, s * 0.42, d < 0 ? 0.2 : Math.PI + 0.2, d < 0 ? Math.PI * 1.6 : Math.PI * 2.6); g.stroke();
      g.beginPath(); g.arc(x + d * s * 0.32, y - s * 0.18, s * 0.15, 0, Math.PI * 2); g.fill();
    }
    g.beginPath(); g.ellipse(x, y - s * 0.75, s * 0.12, s * 0.38, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x, y + s * 0.6, s * 0.1, s * 0.3, 0, 0, Math.PI * 2); g.fill();
    // acanthus: curled leaves sprouting along the scrolls' outer edges
    for (const d of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const a = (d < 0 ? Math.PI * 0.35 : Math.PI * 1.35) + d * k * 0.42;
        const lx = x + d * s * 0.32 + Math.cos(a) * s * 0.55, ly = y + Math.sin(a) * s * 0.55;
        g.save(); g.translate(lx, ly); g.rotate(a + d * 0.6);
        g.beginPath(); g.moveTo(0, 0);
        g.quadraticCurveTo(s * 0.18, -s * 0.12, s * 0.3, 0); g.quadraticCurveTo(s * 0.16, s * 0.1, 0, 0); g.fill();
        g.restore();
      }
    }
    // tendrils linking the repeats
    g.lineWidth = s * 0.07;
    g.beginPath(); g.moveTo(x + s * 0.75, y); g.bezierCurveTo(x + s * 0.95, y - s * 0.5, x + s * 1.15, y + s * 0.5, x + s * 1.6 - s * 0.75, y); g.stroke();
  }
  // a cartouche (an oval shield in a frame of scrolls) at the board's middle
  {
    const cx = PX / 2, cy = PY * 0.42, rx = s * 0.75, ry = s * 1.0;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.ellipse(cx, cy, rx * 1.25, ry * 1.2, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = s * 0.1; g.beginPath(); g.ellipse(cx, cy, rx * 1.18, ry * 1.13, 0, 0, Math.PI * 2); g.stroke();
    for (const d of [-1, 1]) { g.beginPath(); g.arc(cx + d * rx * 1.35, cy - ry * 0.6, s * 0.22, 0, Math.PI * 2); g.stroke(); }
  }
  // a border bead along the top
  g.fillRect(0, 0, PX, s * 0.35);
  for (let x = 0; x < PX; x += s * 0.5) { g.beginPath(); g.arc(x, s * 0.55, s * 0.12, 0, Math.PI * 2); g.fill(); }
  // cut away below the pipe tops, and keep a lip along the cut
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(0, PY);
  for (let i = 0; i <= 64; i++) { const u = i / 64; g.lineTo(u * PX, PY * (1 - cut(u)) + s * 0.25); }
  g.lineTo(PX, PY); g.closePath(); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = s * 0.18;
  g.beginPath();
  for (let i = 0; i <= 64; i++) { const u = i / 64; const yy = PY * (1 - cut(u)); if (i) g.lineTo(u * PX, yy); else g.moveTo(u * PX, yy); }
  g.stroke();
  // beads hanging along the cut, and small pendant drops
  for (let i = 0; i <= 96; i++) {
    const u = i / 96, yy = PY * (1 - cut(u));
    g.beginPath(); g.arc(u * PX, yy + s * 0.2, s * 0.08, 0, Math.PI * 2); g.fill();
    if (i % 6 === 3) { g.beginPath(); g.ellipse(u * PX, yy + s * 0.42, s * 0.06, s * 0.16, 0, 0, Math.PI * 2); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = styled({ color: col(wood), roughness: 0.7 });
  (m as unknown as THREE.MeshToonMaterial).alphaMap = tex;
  m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.transparent = false;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

/** A turned finial (urn and flame), `size` tall, standing on y = 0. */
export function finial(size: number, wood = '#3a2a1e') {
  const k = size / 10;
  const prof = [
    [0, 0], [1.6, 0], [1.6, 0.6], [1.1, 0.9], [1.0, 1.6], [1.9, 2.6], [2.0, 3.6], [1.4, 4.6], [0.7, 5.0], [0.9, 5.4],
    [0.5, 6.0], [0.9, 7.0], [0.6, 8.2], [0.25, 9.3], [0, 10],
  ].map(([x, y]) => new THREE.Vector2(x! * k, y! * k));
  return new THREE.Mesh(new THREE.LatheGeometry(prof, 20), styled({ color: col(wood), roughness: 0.6 }));
}

/** A crown moulding run (cyma profile extruded along x), `len` long, `size` high, at the origin facing +z. */
export function moulding(len: number, size: number, wood = '#3a2a1e') {
  const k = size;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(0.25 * k, 0); sh.lineTo(0.25 * k, 0.12 * k);
  sh.bezierCurveTo(0.55 * k, 0.15 * k, 0.45 * k, 0.7 * k, 0.8 * k, 0.78 * k);
  sh.lineTo(0.85 * k, 0.9 * k); sh.lineTo(0.95 * k, 0.9 * k); sh.lineTo(0.95 * k, k); sh.lineTo(0, k); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 8 });
  geo.rotateY(Math.PI / 2); geo.translate(-len / 2, 0, 0);
  return new THREE.Mesh(geo, styled({ color: col(wood), roughness: 0.6 }));
}

/** The music desk's page: a printed toccata (staves, beams, a fermata), on paper. */
export function pageTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e0cc'; g.fillRect(0, 0, 512, 360);
  g.strokeStyle = '#2a241d'; g.fillStyle = '#2a241d';
  const R = mulberry32(565);
  for (let sys = 0; sys < 4; sys++) {
    const y0 = 40 + sys * 80;
    for (const off of [0, 34]) {
      g.lineWidth = 1;
      for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(30, y0 + off + l * 5); g.lineTo(482, y0 + off + l * 5); g.stroke(); }
    }
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(30, y0); g.lineTo(30, y0 + 54); g.stroke();
    for (let x = 60; x < 470; x += 9) {
      const yy = y0 + 2 + Math.floor(R() * 8) * 2.5 + (R() < 0.4 ? 34 : 0);
      g.beginPath(); g.ellipse(x, yy, 3, 2.2, -0.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(x + 2.8, yy); g.lineTo(x + 2.8, yy - 14); g.stroke();
      if ((x / 9) % 4 === 0) { g.lineWidth = 3; g.beginPath(); g.moveTo(x + 2.8, yy - 14); g.lineTo(x + 30, yy - 14); g.stroke(); g.lineWidth = 1.5; }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { mergeGeometries };
