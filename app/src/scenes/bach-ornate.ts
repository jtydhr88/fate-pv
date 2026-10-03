// The Bach plate's splendour: gilt carving (rendered as warm ivory highlights inside the stone ramp: gold
// as a colour belongs to the finale), trumpet angels and a crown for the towers, scroll corbels, fluted
// columns with capitals, a round stone arch, ashlar and marble textures, brass chandeliers, decorated
// display pipes, soft radial pools of light. Everything stands on y = 0 unless said otherwise.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { styled } from '../engine/style';
import { mulberry32 } from '../engine/util';

const col = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

/** Gilding: a pale warm ivory, bright, low saturation (the grade maps it to the ramp's top, it doesn't stay gold). */
export const GILT = '#eadcbc';
export const giltMat = () => styled({ color: col(GILT), roughness: 0.25, metalness: 0.35, clearcoat: 0.6 });

function extrude(shape: THREE.Shape, depth: number, bevel = 0.25, seg = 12) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: seg });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** An angel with a long trumpet, about `size` tall, gilt: robe, torso, head, two wings, the trumpet raised to `dir` (+1 right / -1 left). */
export function angel(size: number, dir = 1, mat = giltMat()) {
  const k = size / 16;
  const g = new THREE.Group();
  // the robe: a flared skirt with folds (a scalloped hem), torso tapering up
  const robe = new THREE.Shape();
  robe.moveTo(-3.6 * k, 0);
  for (let i = 0; i <= 6; i++) { const x = -3.6 * k + i * 1.2 * k; robe.quadraticCurveTo(x + 0.6 * k, -0.7 * k, x + 1.2 * k, 0); }
  robe.bezierCurveTo(3.2 * k, 3 * k, 1.6 * k, 6 * k, 1.5 * k, 8.6 * k); // waist up the right side
  robe.bezierCurveTo(1.9 * k, 9.6 * k, 1.8 * k, 10.6 * k, 1.1 * k, 11.2 * k); // the chest
  robe.lineTo(-1.1 * k, 11.2 * k);
  robe.bezierCurveTo(-1.8 * k, 10.6 * k, -1.9 * k, 9.6 * k, -1.5 * k, 8.6 * k);
  robe.bezierCurveTo(-1.6 * k, 6 * k, -3.2 * k, 3 * k, -3.6 * k, 0);
  const body = new THREE.Mesh(extrude(robe, 2.6 * k, 0.5 * k), mat);
  g.add(body);
  // the folds: three raised ridges down the skirt
  for (const x of [-1.6, 0, 1.6]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * k, 0.4 * k, 7.5 * k, 8), mat);
    f.position.set(x * k * (x === 0 ? 1 : 0.95), 3.9 * k, 1.45 * k); f.rotation.z = -x * 0.09;
    g.add(f);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.25 * k, 18, 14), mat);
  head.position.set(0.2 * dir * k, 12.7 * k, 0.2 * k);
  g.add(head);
  // hair: a ring of curls
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + 0.9 * (i / 8));
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.42 * k, 8, 6), mat);
    c.position.set(head.position.x + Math.cos(a) * 1.15 * k, head.position.y + Math.sin(a) * 1.05 * k, 0.1 * k);
    g.add(c);
  }
  // the wings: scalloped feather fans swept back and up
  const wing = new THREE.Shape();
  wing.moveTo(0, 0);
  wing.bezierCurveTo(2 * k, 2 * k, 4 * k, 5 * k, 5.5 * k, 9 * k);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 1.25, a2 = ((i + 1) / 6) * 1.25;
    const r = 9.5 * k - i * 0.9 * k;
    wing.quadraticCurveTo(5.5 * k - Math.sin(a) * r * 0.3 + 1.2 * k, 9 * k - Math.sin(a + 0.1) * r * 0.75, 5.5 * k - Math.sin(a2) * r * 0.55, 9 * k - Math.sin(a2) * r * 0.8);
  }
  wing.lineTo(0, 0);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(extrude(wing, 0.5 * k, 0.15 * k), mat);
    w.scale.x = s;
    w.position.set(s * 0.6 * k, 9.4 * k, -1.4 * k);
    w.rotation.set(0.15, s * 0.5, s * -0.12);
    g.add(w);
  }
  // the arm raising the trumpet, and the trumpet: a long tapering tube and a flared bell
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * k, 0.42 * k, 4.2 * k, 8), mat);
  arm.position.set(dir * 1.9 * k, 11.2 * k, 1.2 * k); arm.rotation.z = -dir * 1.0;
  g.add(arm);
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    prof.push(new THREE.Vector2(0.22 * k + 2.0 * k * Math.pow(u, 9), u * 13 * k));
  }
  const trumpet = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), mat);
  trumpet.position.set(dir * 1.0 * k, 12.3 * k, 1.6 * k);
  trumpet.rotation.z = -dir * 1.05;
  g.add(trumpet);
  return g;
}

/** A carved crown: a band with pearls, eight points with trefoils, arches closing to an orb and a cross. */
export function crown(size: number, mat = giltMat()) {
  const k = size / 10;
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(4.2 * k, 3.8 * k, 2 * k, 32, 1, true), mat);
  band.position.y = 1 * k; g.add(band);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.0 * k, 0.35 * k, 8, 40), mat);
  rim.rotation.x = Math.PI / 2; g.add(rim);
  const rim2 = rim.clone(); rim2.position.y = 2 * k; rim2.scale.setScalar(1.05); g.add(rim2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pt = new THREE.Mesh(new THREE.ConeGeometry(0.7 * k, 2.6 * k, 8), mat);
    pt.position.set(Math.cos(a) * 4.3 * k, 3.3 * k, Math.sin(a) * 4.3 * k); g.add(pt);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.5 * k, 10, 8), mat);
    pearl.position.set(Math.cos(a) * 4.3 * k, 4.8 * k, Math.sin(a) * 4.3 * k); g.add(pearl);
    // the arches: quarter tori rising to the top
    if (i % 2 === 0) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(4.2 * k, 0.32 * k, 6, 20, Math.PI / 2), mat);
      arch.rotation.y = -a; arch.position.y = 2 * k;
      arch.rotation.order = 'YXZ';
      g.add(arch);
    }
  }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1.1 * k, 16, 12), mat);
  orb.position.y = 7.0 * k; g.add(orb);
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.45 * k, 2.4 * k, 0.45 * k), mat); c1.position.y = 9 * k; g.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.5 * k, 0.45 * k, 0.45 * k), mat); c2.position.y = 9.3 * k; g.add(c2);
  return g;
}

/** A scroll corbel (an S-bracket under a cornice), `h` tall, its face at +z. */
export function corbel(h: number, mat = giltMat()) {
  const k = h / 10;
  const s = new THREE.Shape();
  s.moveTo(0, 10 * k); s.lineTo(4.5 * k, 10 * k);
  s.bezierCurveTo(4.8 * k, 7 * k, 1.5 * k, 6.5 * k, 1.8 * k, 3.4 * k);
  s.absarc(2.6 * k, 2.0 * k, 1.6 * k, Math.PI * 0.75, Math.PI * 2.2, false);
  s.bezierCurveTo(3.0 * k, 0.6 * k, 0.6 * k, 0, 0, 0.6 * k);
  s.lineTo(0, 10 * k);
  const m = new THREE.Mesh(extrude(s, 2.2 * k, 0.3 * k), mat);
  m.rotation.y = -Math.PI / 2; // the profile runs out toward +z
  const g = new THREE.Group(); g.add(m);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.9 * k, 10, 8), mat);
  leaf.scale.set(1, 1.8, 0.6); leaf.position.set(0, 6.8 * k, 2.4 * k); g.add(leaf);
  return g;
}

/** A fluted column: base mouldings, a shaft with flutes, a capital with volutes and leaves, an abacus. `h` tall. */
export function column(h: number, r: number, stone: THREE.Material, carve: THREE.Material) {
  const g = new THREE.Group();
  const base: THREE.Vector2[] = [[1.5, 0], [1.5, 0.05], [1.32, 0.05], [1.32, 0.1], [1.22, 0.12], [1.28, 0.16], [1.1, 0.2], [1.05, 0.24], [1, 0.26]]
    .map(([x, y]) => new THREE.Vector2(x! * r, y! * r * 4));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(base, 36), stone));
  // the shaft: 20 flutes (a scalloped section, swelling slightly: entasis)
  const shaftH = h - r * 3.4;
  const pts: THREE.Vector2[] = [];
  const N = 20 * 6;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const f = 1 - 0.06 * Math.pow(Math.abs(Math.sin((a * 20) / 2)), 0.6);
    pts.push(new THREE.Vector2(Math.cos(a) * r * f, Math.sin(a) * r * f));
  }
  const sh = new THREE.Shape(pts);
  const sg = new THREE.ExtrudeGeometry(sh, { depth: shaftH, bevelEnabled: false, steps: 1, curveSegments: 1 });
  sg.rotateX(-Math.PI / 2); sg.translate(0, r * 1.05, 0);
  g.add(new THREE.Mesh(sg, stone));
  // the capital: a bell of leaves, four corner volutes, the abacus
  const y0 = r * 1.05 + shaftH;
  const bell: THREE.Vector2[] = [[1.0, 0], [1.08, 0.1], [1.0, 0.18], [1.05, 0.5], [1.3, 1.0], [1.45, 1.25]].map(([x, y]) => new THREE.Vector2(x! * r, y0 + y! * r * 1.6));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(bell, 36), carve));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 10, 8), carve);
    leaf.scale.set(1, 2.2, 0.55);
    leaf.position.set(Math.cos(a) * r * 1.12, y0 + r * 0.75, Math.sin(a) * r * 1.12);
    leaf.lookAt(leaf.position.x * 3, leaf.position.y, leaf.position.z * 3);
    g.add(leaf);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const v = new THREE.Mesh(new THREE.TorusGeometry(r * 0.28, r * 0.09, 8, 18), carve);
    v.position.set(Math.cos(a) * r * 1.35, y0 + r * 1.75, Math.sin(a) * r * 1.35);
    v.lookAt(v.position.x * 2, v.position.y, v.position.z * 2);
    g.add(v);
  }
  const abacus = new THREE.Mesh(new THREE.BoxGeometry(r * 3.2, r * 0.35, r * 3.2), stone);
  abacus.position.y = y0 + r * 2.25; g.add(abacus);
  return g;
}

/** A round arch of voussoirs in the wall plane (z = 0 facing +z), radius `R` to the intrados, `w` deep in the ring. */
export function arch(R: number, w: number, depth: number, stone: THREE.Material, key: THREE.Material) {
  const g = new THREE.Group();
  const N = 23;
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI * (i / N) + 0.004, a1 = Math.PI * ((i + 1) / N) - 0.004;
    const s = new THREE.Shape();
    s.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
    s.lineTo(Math.cos(a0) * (R + w), Math.sin(a0) * (R + w));
    s.absarc(0, 0, R + w, a0, a1, false);
    s.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
    s.absarc(0, 0, R, a1, a0, true);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.5, bevelSegments: 1, curveSegments: 6 });
    if (i === (N - 1) / 2) { const m = new THREE.Mesh(geo, key); g.add(m); geo.translate(0, 0, 1.2); continue; }
    geos.push(geo);
  }
  g.add(new THREE.Mesh(mergeGeometries(geos), stone));
  // the archivolt: a moulded ring inside the voussoirs
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 1.2, 1.4, 8, 80, Math.PI), stone);
  ring.position.z = depth * 0.6; g.add(ring);
  return g;
}

/** A brass chandelier: a turned stem and ball, two tiers of S-arms with candles; returns the candle-flame positions (local). */
export function chandelier(size: number, mat = giltMat(), wax = styled({ color: col('#efe6d2'), roughness: 0.6 })) {
  const k = size / 20;
  const g = new THREE.Group();
  const flames: THREE.Vector3[] = [];
  const stem: THREE.Vector2[] = [[0.3, 20], [0.3, 15], [0.8, 14.4], [0.4, 13.6], [1.2, 12], [2.6, 9], [3.1, 7], [2.5, 5], [1.0, 4], [0.6, 2.5], [1.4, 1.5], [0.3, 0]]
    .map(([x, y]) => new THREE.Vector2(x! * k, y! * k));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(stem, 24), mat));
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * k, 0.12 * k, 40 * k, 6), mat);
  chain.position.y = 40 * k; g.add(chain);
  for (const [tier, n, rad, y] of [[0, 8, 9, 6.5], [1, 6, 6, 11.5]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + tier * 0.3;
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(Math.cos(a) * 2 * k, y * k, Math.sin(a) * 2 * k),
        new THREE.Vector3(Math.cos(a) * rad * 0.4 * k, (y - 3) * k, Math.sin(a) * rad * 0.4 * k),
        new THREE.Vector3(Math.cos(a) * rad * 1.05 * k, (y - 2.5) * k, Math.sin(a) * rad * 1.05 * k),
        new THREE.Vector3(Math.cos(a) * rad * k, (y + 1) * k, Math.sin(a) * rad * k),
      );
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.28 * k, 6, false), mat));
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * k, 0.5 * k, 0.4 * k, 12), mat);
      pan.position.set(Math.cos(a) * rad * k, (y + 1.1) * k, Math.sin(a) * rad * k); g.add(pan);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * k, 0.32 * k, 2.4 * k, 10), wax);
      candle.position.set(Math.cos(a) * rad * k, (y + 2.5) * k, Math.sin(a) * rad * k); g.add(candle);
      flames.push(new THREE.Vector3(Math.cos(a) * rad * k, (y + 4.1) * k, Math.sin(a) * rad * k));
    }
  }
  return { group: g, flames };
}

/** Ashlar: courses of dressed stone blocks with tooled faces (a tiling texture). */
export function ashlarTexture(repeat: [number, number]) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const R = mulberry32(565);
  g.fillStyle = '#3e3933'; g.fillRect(0, 0, 512, 512);
  const rowH = 64;
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * 64;
    for (let x = -128 + off; x < 512; x += 128) {
      const v = 0.93 + R() * 0.1;
      g.fillStyle = `rgb(${74 * v | 0},${68 * v | 0},${60 * v | 0})`;
      g.fillRect(x + 2, r * rowH + 2, 124, rowH - 4);
      // tooling: fine diagonal strokes
      g.strokeStyle = 'rgba(40,36,30,0.12)'; g.lineWidth = 1;
      for (let s = 0; s < 30; s++) { const sx = x + R() * 124, sy = r * rowH + R() * 60; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 6, sy + 3); g.stroke(); }
    }
  }
  g.strokeStyle = '#2e2a25'; g.lineWidth = 2;
  for (let r = 0; r <= 8; r++) { g.beginPath(); g.moveTo(0, r * rowH); g.lineTo(512, r * rowH); g.stroke(); }
  for (let r = 0; r < 8; r++) { const off = (r % 2) * 64; for (let x = off; x <= 512; x += 128) { g.beginPath(); g.moveTo(x, r * rowH); g.lineTo(x, r * rowH + rowH); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8;
  return t;
}

/** A polished marble floor: black and white diamonds with grey veining. */
export function marbleTexture(repeat: number) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  const R = mulberry32(1704);
  g.fillStyle = '#d9d2c2'; g.fillRect(0, 0, 1024, 1024);
  // the diamonds: a square grid rotated 45 degrees, alternating (2 x 2 per tile)
  g.save(); g.translate(512, 512); g.rotate(Math.PI / 4);
  const s = 1024 / Math.SQRT2 / 2;
  for (let i = -4; i < 4; i++) for (let j = -4; j < 4; j++) {
    if ((i + j) & 1) { g.fillStyle = '#26221d'; g.fillRect(i * s, j * s, s, s); }
  }
  g.restore();
  // veins
  for (let v = 0; v < 40; v++) {
    let x = R() * 1024, y = R() * 1024;
    g.strokeStyle = `rgba(${R() < 0.5 ? '120,112,100' : '250,246,236'},${0.12 + R() * 0.12})`; g.lineWidth = 0.8 + R() * 1.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 14; k++) { x += (R() - 0.3) * 50; y += (R() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  // joints
  g.strokeStyle = 'rgba(20,18,15,0.6)'; g.lineWidth = 2;
  g.save(); g.translate(512, 512); g.rotate(Math.PI / 4);
  for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(i * s, -4 * s); g.lineTo(i * s, 4 * s); g.stroke(); g.beginPath(); g.moveTo(-4 * s, i * s); g.lineTo(4 * s, i * s); g.stroke(); }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  return t;
}

let DECO: THREE.Texture | null = null;
/** A display pipe's decoration: the polished-tin sheen with an embossed band above the mouth (diamonds,
 *  a guilloche twist and beads), as on the towers of north-German baroque cases. u = around, v = up the pipe. */
export function decoratedSheen() {
  if (DECO) return DECO;
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 256, 0);
  const stops: [number, string][] = [[0, '#8d877e'], [0.12, '#b9b3a8'], [0.2, '#f4efe4'], [0.24, '#cfc8bb'], [0.3, '#8a847a'], [0.38, '#bdb7ac'], [0.5, '#6d685f'], [0.75, '#57524b'], [0.9, '#7c766d'], [1, '#8d877e']];
  for (const [o, cc] of stops) grd.addColorStop(o, cc);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
  // the band (v from the bottom of the texture: canvas y is flipped by three, so draw near the bottom)
  // (flutePipe's body: v = 3/17 at the mouth, 4/17 a twelfth of the way up) -> canvas y = 512 * (1 - v)
  const y0 = 512 * (1 - 0.245), y1 = 512 * (1 - 0.19);
  g.fillStyle = 'rgba(30,26,22,0.35)'; g.fillRect(0, y0 - 6, 256, 3); g.fillRect(0, y1 + 3, 256, 3);
  g.strokeStyle = 'rgba(255,250,236,0.85)'; g.lineWidth = 2.2;
  for (let x = 0; x < 256; x += 32) {
    g.beginPath(); g.moveTo(x, (y0 + y1) / 2); g.lineTo(x + 16, y0 + 2); g.lineTo(x + 32, (y0 + y1) / 2); g.lineTo(x + 16, y1 - 2); g.closePath(); g.stroke();
    g.beginPath(); g.arc(x + 16, (y0 + y1) / 2, 4, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = 'rgba(255,250,236,0.8)';
  for (let x = 4; x < 256; x += 8) { g.beginPath(); g.arc(x, y0 - 2, 1.6, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x, y1 + 1, 1.6, 0, Math.PI * 2); g.fill(); }
  // a twisted rope band higher up
  const y2 = 512 * (1 - 0.34);
  g.lineWidth = 2;
  for (let x = -16; x < 256; x += 10) { g.beginPath(); g.moveTo(x, y2 + 8); g.lineTo(x + 12, y2 - 8); g.stroke(); }
  DECO = new THREE.CanvasTexture(c); DECO.colorSpace = THREE.SRGBColorSpace;
  return DECO;
}

let POOL: THREE.Texture | null = null;
/** A soft radial pool (white centre fading to nothing), for light on the floor. */
export function poolTexture() {
  if (POOL) return POOL;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  POOL = new THREE.CanvasTexture(c);
  return POOL;
}

/** An additive light pool on the floor (y = 0 plane, facing up), `w` x `d`; set its colour per frame. */
export function lightPool(w: number, d: number) {
  const mat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  return { mesh: m, mat };
}
