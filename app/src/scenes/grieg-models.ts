// Models for the Grieg plate (grieg-mountain.ts): a riveted mine cart with flanged wheels and a caged
// lantern, server racks with drawn front panels, timber mine sets with hanging cage lamps, rails on
// sleepers, cable runs, and jagged rocks. Toon-shaded like every plate (styled()); all built once.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LIN } from '../engine/palette';
import { fbm2, mulberry32 } from '../engine/util';
import { styled } from '../engine/style';

const col = (hex: string) => new THREE.Color(hex);

/** A quad strip wall of a frustum tub: four sloped sides and a floor (double-sided). */
function tubShell(bw: number, bd: number, tw: number, td: number, h: number) {
  const b = [[-bw / 2, 0, -bd / 2], [bw / 2, 0, -bd / 2], [bw / 2, 0, bd / 2], [-bw / 2, 0, bd / 2]];
  const t = [[-tw / 2, h, -td / 2], [tw / 2, h, -td / 2], [tw / 2, h, td / 2], [-tw / 2, h, td / 2]];
  const p: number[] = [];
  const quad = (a: number[], b2: number[], c: number[], d: number[]) => p.push(...a, ...b2, ...c, ...a, ...c, ...d);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i]!, b[j]!, t[j]!, t[i]!); }
  quad(b[3]!, b[2]!, b[1]!, b[0]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** A bar from a to b (box of the given section), for straps, ribs, rods. */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number) {
  const g = new THREE.BoxGeometry(w, a.distanceTo(b), d);
  const m = new THREE.Matrix4();
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** A flanged wheel (axle along x): lathe profile with hub, web, tread and flange on the inner side. */
function wheelGeometry(r: number) {
  const pts = [[0.02, -0.34], [0.36, -0.34], [0.38, -0.18], [r * 0.82, -0.12], [r * 0.92, -0.26], [r, -0.26], [r, 0.18], [r * 1.18, 0.2], [r * 1.18, 0.3], [r * 0.9, 0.3], [r * 0.8, 0.12], [0.38, 0.16], [0.36, 0.34], [0.02, 0.34]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2);
  return g;
}

export type Cart = { group: THREE.Group; wheels: THREE.Object3D[]; lantern: THREE.Vector3; glass: THREE.MeshBasicMaterial };

/**
 * The mine cart, origin on the rail top at its centre, travelling along -z. A tub with flared sides,
 * strapped and riveted, a rolled rim, an ore load; under it two channel beams, axle boxes, four flanged
 * wheels on the outer rails (x = +-3.4), timber buffers and couplings; at the front a post with a caged
 * lantern. `wheels` turn about x.
 */
export function buildCart(): Cart {
  const G = new THREE.Group();
  const iron = styled({ color: col('#6a4a34') });
  const ironDark = styled({ color: col('#3a2a20') });
  const steel = styled({ color: col('#2a2624') });
  const wood = styled({ color: col('#7a5634') });
  const shellMat = styled({ color: col('#6a4a34') });
  shellMat.side = THREE.DoubleSide;
  const y0 = 2.3; // tub bottom
  const BW = 5.4, BD = 7.2, TW = 6.8, TD = 8.8, TH = 3.4;
  const shell = new THREE.Mesh(tubShell(BW, BD, TW, TD, TH), shellMat);
  shell.position.y = y0;
  G.add(shell);
  // the rolled rim: four tubes along the top edges
  const rim: THREE.BufferGeometry[] = [];
  const top = [[-TW / 2, -TD / 2], [TW / 2, -TD / 2], [TW / 2, TD / 2], [-TW / 2, TD / 2]];
  for (let i = 0; i < 4; i++) {
    const a = top[i]!, b = top[(i + 1) % 4]!;
    const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) + 0.3;
    const g = new THREE.CylinderGeometry(0.2, 0.2, len, 10);
    g.rotateZ(Math.PI / 2);
    g.rotateY(-Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!));
    g.translate((a[0]! + b[0]!) / 2, y0 + TH, (a[1]! + b[1]!) / 2);
    rim.push(g);
  }
  G.add(new THREE.Mesh(mergeGeometries(rim), ironDark));
  // straps down the sloped sides (three a long side, two a short side) and rivets along them and the rim
  const straps: THREE.BufferGeometry[] = [];
  const rivetPos: THREE.Vector3[] = [];
  const side = (bx: number, bz: number, tx: number, tz: number, nx: number, nz: number) => {
    const a = new THREE.Vector3(bx + nx * 0.06, y0 + 0.1, bz + nz * 0.06), b = new THREE.Vector3(tx + nx * 0.06, y0 + TH - 0.15, tz + nz * 0.06);
    straps.push(bar(a, b, 0.42, 0.12));
    for (let k = 0; k < 5; k++) rivetPos.push(a.clone().lerp(b, 0.1 + k * 0.2).add(new THREE.Vector3(nx * 0.08, 0, nz * 0.08)));
  };
  for (const s of [-1, 1]) {
    for (const f of [-0.33, 0, 0.33]) side(s * BW / 2, f * BD, s * TW / 2, f * TD, s, 0);
    for (const f of [-0.28, 0.28]) side(f * BW, s * BD / 2, f * TW, s * TD / 2, 0, s);
  }
  // a horizontal band round the middle of the tub
  for (const s of [-1, 1]) {
    const mx = (BW + TW) / 4, mz = (BD + TD) / 4, y = y0 + TH * 0.5;
    straps.push(bar(new THREE.Vector3(s * (mx + 0.05), y, -mz), new THREE.Vector3(s * (mx + 0.05), y, mz), 0.12, 0.3));
    straps.push(bar(new THREE.Vector3(-mx, y, s * (mz + 0.05)), new THREE.Vector3(mx, y, s * (mz + 0.05)), 0.3, 0.12));
  }
  G.add(new THREE.Mesh(mergeGeometries(straps), ironDark));
  for (let i = 0; i < 4; i++) {
    const a = top[i]!, b = top[(i + 1) % 4]!;
    for (let k = 1; k < 8; k++) {
      const u = k / 8;
      rivetPos.push(new THREE.Vector3(a[0]! + (b[0]! - a[0]!) * u, y0 + TH - 0.42, a[1]! + (b[1]! - a[1]!) * u).multiply(new THREE.Vector3(0.985, 1, 0.985)));
    }
  }
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), steel, rivetPos.length);
  const m = new THREE.Matrix4();
  rivetPos.forEach((p, i) => rivets.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  G.add(rivets);
  // the ore load heaped in the tub
  const R = mulberry32(41);
  const lump = jaggedRock(1, 7, 0.35);
  const ore = new THREE.InstancedMesh(lump, styled({ color: col('#2b2420') }), 46);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
  for (let i = 0; i < 46; i++) {
    const x = (R() - 0.5) * (TW - 1.4), z = (R() - 0.5) * (TD - 1.4);
    const heap = 1 - (x * x) / 14 - (z * z) / 22;
    const sc = 0.45 + 0.4 * R();
    m.compose(s.set(x, y0 + TH - 0.6 + Math.max(0, heap) * 1.1 + R() * 0.3, z), q.setFromEuler(e.set(R() * 6, R() * 6, R() * 6)), new THREE.Vector3(sc, sc * 0.8, sc));
    ore.setMatrixAt(i, m);
  }
  G.add(ore);
  // chassis: two channel beams, cross members, axle boxes, axles
  const ch: THREE.BufferGeometry[] = [];
  for (const sx of [-2.1, 2.1]) {
    const web = new THREE.BoxGeometry(0.2, 0.8, 8.6); web.translate(sx, 1.9, 0); ch.push(web);
    for (const fy of [1.55, 2.25]) { const fl = new THREE.BoxGeometry(0.7, 0.12, 8.6); fl.translate(sx + (sx < 0 ? 0.25 : -0.25), fy, 0); ch.push(fl); }
  }
  for (const z of [-3.4, 0, 3.4]) { const cm = new THREE.BoxGeometry(4.4, 0.35, 0.3); cm.translate(0, 2.1, z); ch.push(cm); }
  for (const z of [-2.6, 2.6]) for (const sx of [-2.75, 2.75]) {
    const box = new THREE.BoxGeometry(0.7, 0.9, 1.1); box.translate(sx, 1.65, z); ch.push(box);
    const cap = new THREE.CylinderGeometry(0.26, 0.26, 0.2, 10); cap.rotateZ(Math.PI / 2); cap.translate(sx + Math.sign(sx) * 0.45, 1.5, z); ch.push(cap);
  }
  G.add(new THREE.Mesh(mergeGeometries(ch), steel));
  // timber buffer beams and the coupling hooks
  const buf: THREE.BufferGeometry[] = [];
  for (const z of [-4.75, 4.75]) {
    const b = new THREE.BoxGeometry(6.0, 0.8, 0.7); b.translate(0, 2.05, z); buf.push(b);
  }
  G.add(new THREE.Mesh(mergeGeometries(buf), wood));
  const hooks: THREE.BufferGeometry[] = [];
  for (const z of [-5.25, 5.25]) {
    const ring = new THREE.TorusGeometry(0.34, 0.09, 6, 14); ring.rotateY(Math.PI / 2); ring.translate(0, 1.95, z + Math.sign(z) * 0.3); hooks.push(ring);
    const plate = new THREE.BoxGeometry(0.9, 0.9, 0.12); plate.translate(0, 2.05, z); hooks.push(plate);
  }
  G.add(new THREE.Mesh(mergeGeometries(hooks), steel));
  // wheels: flanged, on the outer rails; dark lightening holes on the web; axles between
  const wheels: THREE.Object3D[] = [];
  const wg = wheelGeometry(1.1);
  // six raised spokes on the outer face of the web, hub to rim
  const spokeG = new THREE.BoxGeometry(0.12, 0.62, 0.16);
  spokeG.translate(0, 0.66, 0);
  for (const z of [-2.6, 2.6]) {
    const axle = new THREE.Mesh((() => { const g = new THREE.CylinderGeometry(0.18, 0.18, 7.6, 10); g.rotateZ(Math.PI / 2); return g; })(), steel);
    axle.position.set(0, 1.1, z);
    G.add(axle);
    for (const sx of [-3.4, 3.4]) {
      const w = new THREE.Group();
      const wheel = new THREE.Mesh(wg, ironDark);
      // flange on the inner side (towards the cart's middle): the lathe puts it at -x
      wheel.scale.x = sx < 0 ? -1 : 1;
      w.add(wheel);
      for (let k = 0; k < 6; k++) {
        const sp = new THREE.Mesh(spokeG, steel);
        sp.position.x = Math.sign(sx) * 0.2;
        sp.rotation.x = (k / 6) * Math.PI * 2;
        w.add(sp);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 12), steel);
      hub.rotation.z = Math.PI / 2; hub.position.x = Math.sign(sx) * 0.22;
      w.add(hub);
      w.position.set(sx, 1.1, z);
      G.add(w);
      wheels.push(w);
    }
  }
  // the lantern: a post at the front, an arm, a hook; the cage: base, cap, bars, rings, a glowing glass
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.4, 0.28), steel);
  post.position.set(2.6, y0 + TH + 1.4, -4.55); G.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.18), steel);
  arm.position.set(2.0, y0 + TH + 3.0, -4.55); G.add(arm);
  const lan = new THREE.Group();
  lan.position.set(1.35, y0 + TH + 1.7, -4.55);
  const cage: THREE.BufferGeometry[] = [];
  { const b = new THREE.CylinderGeometry(0.62, 0.7, 0.22, 14); b.translate(0, -0.95, 0); cage.push(b); }
  { const c2 = new THREE.ConeGeometry(0.72, 0.55, 14); c2.translate(0, 0.98, 0); cage.push(c2); }
  { const r = new THREE.TorusGeometry(0.22, 0.05, 6, 12); r.translate(0, 1.4, 0); cage.push(r); }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    cage.push(bar(new THREE.Vector3(Math.cos(a) * 0.55, -0.9, Math.sin(a) * 0.55), new THREE.Vector3(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.55), 0.07, 0.07));
  }
  for (const y of [-0.35, 0.35]) { const r = new THREE.TorusGeometry(0.56, 0.04, 6, 18); r.rotateX(Math.PI / 2); r.translate(0, y, 0); cage.push(r); }
  lan.add(new THREE.Mesh(mergeGeometries(cage), steel));
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(LIN.ember[0] * 3, LIN.ember[1] * 3, LIN.ember[2] * 3) });
  lan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 14), glass));
  G.add(lan);
  return { group: G, wheels, lantern: lan.position.clone(), glass };
}

/** A jagged rock: a subdivided icosahedron pushed in and out by noise (shared by the instances). */
export function jaggedRock(r: number, seed: number, amt = 0.3) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + amt * (fbm2(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3, 3, seed) - 0.5) * 2;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  g.deleteAttribute('normal');
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/**
 * The front panel of a rack (u: along the rack's depth, v: up): a black frame, rows of servers with
 * vents, drive bays, pull handles and label strips, a patch panel at the top, blanking plates; sockets
 * where the LEDs sit (three columns at u = 0.233, 0.5, 0.767 of the face, rows from y = 2.5 every 1.35).
 */
export function rackFaceTexture() {
  const Wc = 256, Hc = 640; // 9 x 22 world units
  const c = document.createElement('canvas'); c.width = Wc; c.height = Hc;
  const g = c.getContext('2d')!;
  const sx = Wc / 9, sy = Hc / 22;
  const Y = (y: number) => Hc - y * sy; // world y -> canvas y
  g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, Wc, Hc);
  g.fillStyle = '#2e2e35'; g.fillRect(6, 6, Wc - 12, Hc - 12);
  const R = mulberry32(9);
  // servers: 1.35-unit rows (one LED row each), from y = 1.8
  for (let row = 0; row < 14; row++) {
    const y = 1.85 + row * 1.35, h = 1.2;
    const kind = R();
    g.fillStyle = kind < 0.12 ? '#26262c' : '#4a4a54';
    g.fillRect(14, Y(y + h), Wc - 28, h * sy - 2);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(14, Y(y + h), Wc - 28, 2); // bevel light
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(14, Y(y) - 3, Wc - 28, 3); // bevel shadow
    if (kind < 0.12) continue; // a blanking plate
    // vents: short dark slots across the middle
    g.fillStyle = '#18181c';
    for (let k = 0; k < 18; k++) g.fillRect(40 + k * 6, Y(y + h * 0.78), 3, h * sy * 0.56);
    // drive bays on the right
    for (let k = 0; k < 4; k++) { g.fillStyle = '#5c5c68'; g.fillRect(156 + k * 18, Y(y + h * 0.85), 15, h * sy * 0.7); g.fillStyle = '#202024'; g.fillRect(158 + k * 18, Y(y + h * 0.5), 11, 2); }
    // pull handles at both ends
    g.fillStyle = '#8a8a96'; g.fillRect(18, Y(y + h * 0.85), 6, h * sy * 0.7); g.fillRect(Wc - 24, Y(y + h * 0.85), 6, h * sy * 0.7);
    // a label strip
    g.fillStyle = '#c8c4b8'; g.fillRect(28, Y(y + h * 0.3), 22, 5);
  }
  // patch panel at the top: a row of ports
  g.fillStyle = '#3a3a42'; g.fillRect(14, Y(21.4), Wc - 28, 0.9 * sy);
  g.fillStyle = '#111114';
  for (let k = 0; k < 24; k++) g.fillRect(22 + k * 9.4, Y(21.1), 6, 6);
  // LED sockets (darker recesses the instanced LEDs sit in)
  g.fillStyle = '#0c0c0e';
  for (let row = 0; row < 14; row++) for (const u of [0.233, 0.5, 0.767]) g.fillRect(u * Wc - 10, Y(2.5 + row * 1.35) - 6, 20, 12);
  // corner screws
  g.fillStyle = '#77777f';
  for (const [x, y] of [[10, 10], [Wc - 10, 10], [10, Hc - 10], [Wc - 10, Hc - 10]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  void sx;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Side / top panels of a rack: perforated steel. */
export function rackSideTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3a42'; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#26262c';
  for (let y = 10; y < 246; y += 8) for (let x = 10 + ((y / 8) % 2) * 4; x < 118; x += 8) g.fillRect(x, y, 3, 3);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, 0, 128, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Gravel ballast for the floor (tiled). */
export function gravelTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a3d32'; g.fillRect(0, 0, 256, 256);
  const R = mulberry32(17);
  for (let i = 0; i < 1400; i++) {
    const x = R() * 256, y = R() * 256, r = 1 + R() * 3.5, l = 50 + R() * 60;
    g.fillStyle = `rgb(${l + 20},${l + 8},${l})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.6 + R() * 0.4), R() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Sawn timber with grain (for sleepers and mine sets). */
export function timberTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a5634'; g.fillRect(0, 0, 64, 256);
  const R = mulberry32(23);
  for (let i = 0; i < 40; i++) {
    const x = R() * 64, w = 0.6 + R() * 1.6;
    g.strokeStyle = `rgba(40,24,12,${0.25 + R() * 0.35})`; g.lineWidth = w;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 16) g.lineTo(x + Math.sin(y * 0.03 + i) * 2, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cables slung from each rack's top to a tray along the wall (one merged geometry per side). */
export function cableGeometry(racks: { x: number; z: number }[], trayX: number, trayY: number) {
  const gs: THREE.BufferGeometry[] = [];
  const R = mulberry32(61);
  for (const r of racks) {
    if (Math.sign(r.x) !== Math.sign(trayX)) continue;
    for (let k = 0; k < 3; k++) {
      const z = r.z + (k - 1) * 2.2 + (R() - 0.5);
      const a = new THREE.Vector3(r.x + (R() - 0.5) * 2, 22, z);
      const b = new THREE.Vector3(trayX + (R() - 0.5) * 1.2, trayY + 0.2, z - 3 - R() * 4);
      const mid = a.clone().lerp(b, 0.5); mid.y -= 1.5 + R() * 1.2;
      const curve = new THREE.CatmullRomCurve3([a, a.clone().add(new THREE.Vector3(0, 0.8, 0)), mid, b]);
      gs.push(new THREE.TubeGeometry(curve, 16, 0.12 + R() * 0.06, 5, false));
    }
  }
  return mergeGeometries(gs);
}

/** Molten metal in a channel: bright veins of flow on a darker crust (tiled along the channel, scrolled). */
export function moltenTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a2a10'; g.fillRect(0, 0, 64, 256);
  const R = mulberry32(71);
  for (let i = 0; i < 26; i++) {
    const x = 6 + R() * 52, w = 3 + R() * 9, y0 = R() * 256, len = 40 + R() * 120;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, 'rgba(255,220,150,0)'); gr.addColorStop(0.5, `rgba(255,${200 + Math.round(R() * 55)},${120 + Math.round(R() * 80)},0.9)`); gr.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = gr;
    for (const dy of [0, -256, 256]) { g.beginPath(); g.ellipse(x, y0 + len / 2 + dy, w / 2, len / 2, 0, 0, Math.PI * 2); g.fill(); }
  }
  // crust plates floating on it
  for (let i = 0; i < 18; i++) {
    const x = R() * 64, y = R() * 256;
    g.fillStyle = 'rgba(40,16,6,0.65)';
    g.beginPath(); g.ellipse(x, y, 4 + R() * 8, 3 + R() * 6, R() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
