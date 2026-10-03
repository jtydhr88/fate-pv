// The Vivaldi plate's objects, modelled rather than suggested: a lattice weather mast with its cup
// anemometer and wind vane, a louvred Stevenson screen, a radar dome with its panel seams on a small
// station house, wheat (stalk, blade and an ear of paired grains with awns), a storm-cloud sky, and
// irregular hailstones. Plain geometry merged per object so the toon shading and the ink outlines read
// every part.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { styled } from '../engine/style';
import { mulberry32 } from '../engine/util';

const col = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

/** A thin cylinder from a to b (for struts, braces, rods). */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

export interface Station { group: THREE.Group; cups: THREE.Group; vane: THREE.Group; top: THREE.Vector3; glints: THREE.Object3D[]; brass: THREE.MeshPhysicalMaterial }

/**
 * The station, standing at (x, 0, z): a three-legged lattice mast (h tall) with a cup anemometer and a
 * wind vane on the top, a lightning rod; beside it a Stevenson screen on legs and the radar house.
 */
export function buildStation(x: number, z: number, h = 56): Station {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const steel = styled({ color: col('#a3a8ab'), roughness: 0.4 });
  const dark = styled({ color: col('#4c4f52'), roughness: 0.6 });
  const white = styled({ color: col('#eceae4'), roughness: 0.6 });
  // the instruments' brass, kept pale (the storm grade keeps warm-white highlights, no saturated gold)
  const brass = styled({ color: col('#d9ccad'), roughness: 0.25, emissive: new THREE.Color(1, 0.95, 0.85), emissiveIntensity: 0 });
  const glints: THREE.Object3D[] = [];
  // the lattice: three legs tapering to the top, zig-zag bracing between each pair, rings every bay
  const geos: THREE.BufferGeometry[] = [];
  const leg = (i: number, y: number) => {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6, r = 3.2 - 2.0 * (y / h);
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  };
  const bays = 14;
  for (let i = 0; i < 3; i++) {
    geos.push(strut(leg(i, 0), leg(i, h), 0.26));
    for (let k = 0; k < bays; k++) {
      const y0 = (k / bays) * h, y1 = ((k + 1) / bays) * h;
      geos.push(strut(leg(i, y0), leg((i + 1) % 3, y1), 0.1, 4));
      geos.push(strut(leg(i, y1), leg((i + 1) % 3, y1), 0.1, 4));
    }
  }
  const mast = new THREE.Mesh(mergeGeometries(geos), steel);
  // a platform near the top with a railing, and the cross-arm the instruments stand on
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.4, 16), dark);
  plat.position.y = h - 4;
  const rail = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 6, 24), steel);
  rail.rotation.x = Math.PI / 2; rail.position.y = h - 2.6;
  const armGeo = mergeGeometries([strut(new THREE.Vector3(-8, h, 0), new THREE.Vector3(8, h, 0), 0.22), strut(new THREE.Vector3(0, h - 2, 0), new THREE.Vector3(-8, h, 0), 0.12, 4), strut(new THREE.Vector3(0, h - 2, 0), new THREE.Vector3(8, h, 0), 0.12, 4)]);
  const arm = new THREE.Mesh(armGeo, steel);
  // the cup anemometer on the left end of the arm: a spindle, three arms, three hemispherical cups
  const cups = new THREE.Group();
  cups.position.set(-8, h + 2.6, 0);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.6, 8), dark);
  spindle.position.set(-8, h + 1.3, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 12), dark);
  cups.add(hub);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const rod = new THREE.Mesh(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2), 0.07, 5), steel);
    // the cup: an open hemisphere facing along the rotation
    const cg = new THREE.SphereGeometry(0.85, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    cg.rotateX(Math.PI / 2);
    const cup = new THREE.Mesh(cg, brass);
    (cup.material as THREE.Material).side = THREE.DoubleSide;
    cup.position.set(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2);
    cup.rotation.y = -a;
    cups.add(rod, cup);
    glints.push(cup);
  }
  // the wind vane on the right end: a pivot, an arrow with a split tail fin
  const vane = new THREE.Group();
  vane.position.set(8, h + 2.2, 0);
  const vaneStem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 8), dark);
  vaneStem.position.set(8, h + 1.1, 0);
  const shaft = new THREE.Mesh(strut(new THREE.Vector3(-3.6, 0, 0), new THREE.Vector3(3.2, 0, 0), 0.09, 5), dark);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 4), brass);
  glints.push(head);
  head.rotation.z = -Math.PI / 2; head.position.x = 3.6;
  const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-2.2, 1.3), new THREE.Vector2(-2.6, 1.3), new THREE.Vector2(-1.6, 0)]);
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false }), white);
  fin.position.set(-1.6, -0.2, -0.04);
  vane.add(shaft, head, fin);
  // the lightning rod on top of the mast
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 6, 6), steel);
  rod.position.y = h + 3;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), brass);
  ball.position.y = h + 0.6;
  glints.push(ball);
  group.add(ball, mast, plat, rail, arm, spindle, cups, vaneStem, vane, rod);

  // the Stevenson screen: a white louvred box on four legs, a double roof
  const screen = new THREE.Group();
  screen.position.set(-14, 0, 6);
  for (const [lx, lz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), white);
    l.position.set(lx!, 3, lz!); screen.add(l);
  }
  const louvres: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const y = 6.3 + k * 0.42;
    for (const s of [-1, 1]) {
      const front = new THREE.BoxGeometry(3.8, 0.34, 0.06); front.rotateX(s * 0.6); front.translate(0, y, s * 1.45); louvres.push(front);
      const side = new THREE.BoxGeometry(0.06, 0.34, 2.9); side.rotateZ(-s * 0.6); side.translate(s * 1.9, y, 0); louvres.push(side);
    }
  }
  screen.add(new THREE.Mesh(mergeGeometries(louvres), white));
  const floorS = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.2, 3.1), white); floorS.position.y = 6.1; screen.add(floorS);
  const roof1 = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.25, 3.8), white); roof1.position.y = 9.4; screen.add(roof1);
  const roof2 = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 3.4), white); roof2.position.y = 9.9; screen.add(roof2);
  group.add(screen);

  // the radar house: a low building with a door and a parapet, the dome on top with its panel seams
  const house = new THREE.Group();
  house.position.set(22, 0, -6);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 12), styled({ color: col('#8f928d'), roughness: 0.8 }));
  walls.position.y = 3.5;
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.4, 0.2), dark); door.position.set(-3, 2.2, 6.05);
  const win = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.2), dark); win.position.set(3.5, 4.4, 6.05);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(16.6, 0.8, 12.6), styled({ color: col('#6f726e'), roughness: 0.8 }));
  parapet.position.y = 7.4;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 1.4, 24), dark); plinth.position.y = 8.4;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6.6, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), styled({ color: col('#ffffff'), map: domeTexture(), roughness: 0.5 }));
  dome.position.y = 8.9;
  house.add(walls, door, win, parapet, plinth, dome);
  group.add(house);

  return { group, cups, vane, top: new THREE.Vector3(x, h + 6, z), glints, brass };
}

/** The radome's skin: off-white panels in a staggered geodesic-ish pattern, ink seams. */
function domeTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e8e2'; g.fillRect(0, 0, 1024, 512);
  const R = mulberry32(61);
  g.strokeStyle = '#3c3e40'; g.lineWidth = 3;
  const rows = 7;
  for (let r = 0; r < rows; r++) {
    const y0 = (r / rows) * 512 * 0.56 * 1.78, y1 = ((r + 1) / rows) * 512 * 0.56 * 1.78;
    g.beginPath(); g.moveTo(0, y1); g.lineTo(1024, y1); g.stroke();
    const n = Math.max(5, Math.round(26 * Math.sin(((r + 0.5) / rows) * Math.PI * 0.56 + 0.15)));
    const off = (r % 2) * 0.5;
    for (let k = 0; k < n; k++) {
      const x = ((k + off) / n) * 1024;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (1024 / n) * 0.5, y1); g.stroke();
      g.beginPath(); g.moveTo(x + 1024 / n, y0); g.lineTo(x + (1024 / n) * 0.5, y1); g.stroke();
    }
    // a few panels a shade darker (weathering)
    for (let k = 0; k < 3; k++) { g.fillStyle = `rgba(0,0,0,${0.04 + 0.04 * R()})`; g.fillRect(R() * 1024, y0, 40 + R() * 40, y1 - y0); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Lathe a profile [(radius, y)] and drop its uvs (so the parts merge). */
function lathe(prof: [number, number][], seg: number) {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg).toNonIndexed();
  g.deleteAttribute('uv');
  return g;
}
function ellipsoid(r: number, sx: number, sy: number, sz: number, w = 6, h = 4) {
  const g = new THREE.SphereGeometry(r, w, h).toNonIndexed();
  g.deleteAttribute('uv');
  g.scale(sx, sy, sz);
  return g;
}
/** A fine bristle from the origin, `len` long, along +y. */
function bristle(len: number, r0: number) {
  const g = new THREE.CylinderGeometry(r0 * 0.3, r0, len, 3, 1, true).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, len / 2, 0);
  return g;
}

/**
 * Wheat, modelled.
 * - stem: unit height (scaled per frame by the spectrum), a slender culm tapering up, swollen at three
 *   nodes (the joints, with their leaf sheaths);
 * - leaf: a long blade (about 4 long) rising from its node, arching over and drooping, twisting as it
 *   goes (instanced separately, so it keeps its shape however tall the stem grows);
 * - ear: about 2.7 tall: a rachis carrying eleven spikelets in two rows (alternate sides), each spikelet
 *   three plump grains inside their glumes, every floret ending in a long fine awn;
 * - grain: one grain, for the ears shattering under the hail.
 */
export function wheatGeometries() {
  // the culm: radius tapering 0.09 -> 0.045, bulging at the nodes (fractions of the height)
  const prof: [number, number][] = [[0.0, 0], [0.09, 0]];
  const nodes = [0.24, 0.47, 0.7];
  for (let i = 1; i <= 40; i++) {
    const y = i / 40;
    let r = 0.09 - 0.045 * y;
    for (const n of nodes) r += 0.035 * Math.exp(-((y - n) * (y - n)) / 0.00018);
    prof.push([r, y]);
  }
  prof.push([0.0, 1]);
  const stem = lathe(prof, 6);

  // the leaf: a ribbon along an arching path, swelling from the sheath then tapering to a point, creased
  const leaf = new THREE.BufferGeometry();
  const P: number[] = [];
  const N = 18;
  const path = (u: number) => new THREE.Vector3(3.9 * u, 1.75 * u - 2.0 * u * u, 0.25 * Math.sin(u * 3));
  const width = (u: number) => 0.26 * Math.pow(1 - u, 0.8) * Math.min(1, 0.35 + u * 5);
  const side = (u: number) => {
    const d = path(Math.min(1, u + 0.01)).sub(path(Math.max(0, u - 0.01))).normalize();
    const n = new THREE.Vector3(0, 0, 1).cross(d).normalize().cross(d).normalize(); // across the blade
    return n.applyAxisAngle(d, 0.9 * u).multiplyScalar(width(u) / 2);
  };
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N;
    const a = path(u0), b = path(u1), sa = side(u0), sb = side(u1);
    const a0 = a.clone().sub(sa), a1 = a.clone().add(sa), b0 = b.clone().sub(sb), b1 = b.clone().add(sb);
    const am = a.clone().add(new THREE.Vector3(0, -0.02, 0)), bm = b.clone().add(new THREE.Vector3(0, -0.02, 0));
    for (const [p, q, r] of [[a0, b0, bm], [a0, bm, am], [am, bm, b1], [am, b1, a1]] as const) P.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  }
  leaf.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  leaf.computeVertexNormals();

  // the ear
  const ear: THREE.BufferGeometry[] = [];
  const n = 11;
  ear.push(lathe([[0, 0], [0.035, 0], [0.03, 2.35], [0, 2.4]], 4));
  for (let i = 0; i < n; i++) {
    const s = i % 2 ? 1 : -1;
    const y = 0.12 + i * 0.205;
    const k = 0.72 + 0.38 * Math.sin(Math.PI * (i + 0.6) / (n + 0.4)); // fullest a third of the way up
    const place = (g: THREE.BufferGeometry, rz: number, rx: number, x: number, yy: number, z: number) => {
      g.rotateX(rx); g.rotateZ(rz); g.translate(x, yy, z); ear.push(g);
    };
    // the glumes: two husks cupping the spikelet
    for (const dz of [-1, 1]) place(ellipsoid(0.13 * k, 0.45, 1.75, 0.8), -s * 0.42, dz * 0.18, s * 0.13 * k, y + 0.02, dz * 0.06 * k);
    // three florets: the middle one higher, the side ones fanned front and back
    const florets: [number, number, number][] = [[0, 0.09, 0], [-1, 0, -0.11], [1, 0, 0.11]];
    for (const [fz, fy, oz] of florets) {
      place(ellipsoid(0.12 * k, 0.8, 1.6, 0.72), -s * (0.36 + 0.08 * Math.abs(fz)), fz * 0.32, s * (0.15 + 0.03 * Math.abs(fz)) * k, y + fy * k, oz * k);
      // the awn: long, fine, lifting out and up, a little forward or back
      const aw = bristle(1.9 * k, 0.014);
      aw.rotateX(fz * 0.22 + 0.04 * ((i % 3) - 1));
      aw.rotateZ(-s * (0.2 + 0.018 * i));
      aw.translate(s * (0.2 + 0.03 * Math.abs(fz)) * k, y + (0.2 + fy) * k, oz * k * 1.2);
      ear.push(aw);
    }
  }
  // the top: a last small spikelet and its awns
  ear.push(ellipsoid(0.08, 0.7, 1.7, 0.7).translate(0, 2.42, 0));
  for (const d of [-1, 1]) { const a = bristle(1.4, 0.012); a.rotateZ(d * 0.08); a.translate(0, 2.5, 0); ear.push(a); }
  const grain = ellipsoid(0.12, 0.75, 1.55, 0.7, 7, 5);
  return { stem, leaf, ear: mergeGeometries(ear), grain };
}

/** An irregular hailstone: a subdivided icosahedron, every vertex pushed in or out (deterministic). */
export function hailGeometry(seed = 7) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const R = mulberry32(seed);
  // jitter by unique position so shared vertices of the non-indexed faces move together
  const off = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!off.has(k)) off.set(k, 0.78 + 0.4 * R());
    const s = off.get(k)!;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.9, pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A sky of storm cloud on a dome (fbm value noise, streaked by the wind), dark grey on near-black. With
 * `alpha`, a layer of separate billows instead: white, its coverage in the alpha (for the layers in front).
 */
export function cloudTexture(seed = 1725, alpha = false) {
  const Wd = 1024, Hd = 384;
  const c = document.createElement('canvas'); c.width = Wd; c.height = Hd;
  const g = c.getContext('2d')!;
  const img = g.createImageData(Wd, Hd);
  const R = mulberry32(seed);
  // value-noise lattices per octave (wrapping horizontally)
  const oct = [8, 16, 32, 64, 128].map((n) => ({ n, v: Array.from({ length: n * (Math.ceil(n * Hd / Wd) + 2) }, () => R()) }));
  const val = (o: { n: number; v: number[] }, x: number, y: number) => {
    const n = o.n, m = Math.ceil(n * Hd / Wd) + 2;
    const fx = (x / Wd) * n, fy = (y / Wd) * n;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => o.v[((j % m) * n) + (((i % n) + n) % n)]!;
    const a = at(ix, iy), b = at(ix + 1, iy), cc = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
  };
  for (let y = 0; y < Hd; y++) {
    for (let x = 0; x < Wd; x++) {
      const fbm = (yy: number) => {
        let v = 0, amp = 0.5, norm = 0;
        for (const o of alpha ? oct.slice(0, 3) : oct) { v += amp * val(o, x, yy * (alpha ? 1.5 : 2.2)); norm += amp; amp *= 0.55; }
        return v / norm;
      };
      const v = fbm(y);
      // billows: contrast, darker toward the horizon band (y high = low in the sky)
      const h = y / Hd;
      const k = (y * Wd + x) * 4;
      if (alpha) {
        // billows: dense cores, soft ragged edges; lit from above (brighter where denser, toward the top)
        const cov = Math.min(1, Math.max(0, (v - 0.5) / 0.1));
        // lit from above: where the cloud above this point is thinner, the billow's top catches the light
        const above = fbm(y - 10);
        const lit = 0.3 + 0.7 * Math.min(1, Math.max(0, (v - above) * 14 + 0.15)) * (0.6 + 0.4 * (1 - h));
        img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * lit);
        img.data[k + 3] = Math.round(255 * cov * (1 - Math.pow(h, 6)));
        continue;
      }
      let l = Math.pow(Math.max(0, (v - 0.32) / 0.68), 1.6);
      l = 0.05 + 0.5 * l * (0.55 + 0.45 * (1 - h));
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * l);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A soft round glow (for the light inside the clouds, the sun's last gap). */
export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.45)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A rain curtain: fine slanted streaks, dense at the top (the cloud base), thinning to the ground. */
export function rainTexture(seed = 9) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d')!;
  const R = mulberry32(seed);
  for (let i = 0; i < 700; i++) {
    const x = R() * 256, y = R() * 512, l = 30 + R() * 90;
    g.strokeStyle = `rgba(255,255,255,${0.08 + 0.2 * R()})`; g.lineWidth = 0.6 + R();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + l); g.stroke();
  }
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 512);
  v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.7, 'rgba(0,0,0,0.6)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = v; g.fillRect(0, 0, 256, 512);
  const h = g.createLinearGradient(0, 0, 256, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.25, 'rgba(0,0,0,1)'); h.addColorStop(0.75, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h; g.fillRect(0, 0, 256, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
