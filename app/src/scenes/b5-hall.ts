// The finale's dress (b5-light.ts): what makes the grand an art-case instrument in a palace hall once the
// light turns gold. The turned gilt legs, the lyre and
// pedals; a polished marble floor with an inlaid rosette under the piano; a
// ring of columns with gilt capitals and a cornice, draped curtains between them, chandeliers; light beams
// from high windows (additive, drawn after the solid scene so the outline pass never sees them); and the
// ornate cartouche behind the engraved score. Units are centimetres, as in _piano.ts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { styled } from '../engine/style';
import { mulberry32 } from '../engine/util';

const lin = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
export const FLOOR_Y = -76;

/** Gilt: warm metal. */
export const gilt = () => styled({ color: lin('#c9a24e'), roughness: 0.28, metalness: 0.85, clearcoat: 0.4 });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Scrolls and leaves: a symmetric arabesque around (0, 0), radius r (for the floor and the cartouche). */
function arabesque(g: CanvasRenderingContext2D, r: number, n: number, lw: number) {
  g.lineWidth = lw; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    g.save(); g.rotate((i / n) * Math.PI * 2);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, -r * 0.18);
      g.bezierCurveTo(s * r * 0.35, -r * 0.3, s * r * 0.15, -r * 0.75, s * r * 0.05, -r * 0.62);
      g.bezierCurveTo(-s * r * 0.05, -r * 0.5, s * r * 0.2, -r * 0.45, s * r * 0.22, -r * 0.58);
      g.stroke();
      // a leaf at the tip
      g.beginPath(); g.ellipse(s * r * 0.1, -r * 0.82, r * 0.035, r * 0.1, s * 0.4, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  g.beginPath(); g.arc(0, 0, r * 0.14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.06, 0, Math.PI * 2); g.fill();
}

/** The floor: polished dark marble in large tiles, a gilt-inlaid rosette under the piano, a pool of light. */
function floorTexture() {
  return canvasTex(2048, 2048, (g) => {
    const R = mulberry32(77);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) % 2 ? '#1d1712' : '#2c241c';
      g.fillRect(i * 256, j * 256, 256, 256);
    }
    // marble veins
    g.strokeStyle = 'rgba(200,180,140,0.10)'; g.lineWidth = 2;
    for (let k = 0; k < 120; k++) {
      let x = R() * 2048, y = R() * 2048; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { x += (R() - 0.5) * 120; y += (R() - 0.3) * 90; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, 2048); g.stroke(); g.beginPath(); g.moveTo(0, i * 256); g.lineTo(2048, i * 256); g.stroke(); }
    // the polish: a soft pool of light under the piano
    const pool = g.createRadialGradient(1024, 1024, 0, 1024, 1024, 900);
    pool.addColorStop(0, 'rgba(255,225,160,0.35)'); pool.addColorStop(1, 'rgba(255,225,160,0)');
    g.fillStyle = pool; g.fillRect(0, 0, 2048, 2048);
    // the rosette
    g.save(); g.translate(1024, 1024);
    g.strokeStyle = '#c9a24e'; g.fillStyle = '#c9a24e';
    for (let i = 0; i < 32; i++) { g.save(); g.rotate((i / 32) * Math.PI * 2); g.beginPath(); g.moveTo(0, -480); g.lineTo(18, -620); g.lineTo(0, -730); g.lineTo(-18, -620); g.closePath(); g.fill(); g.restore(); }
    arabesque(g, 470, 12, 5);
    g.restore();
  });
}

/** The score's cartouche: parchment, a gilt double frame with corner scrolls, the title. */
export function cartoucheTexture(w: number, h: number, title: string) {
  const cw = 4096, ch = Math.round((4096 * h) / w);
  return canvasTex(cw, ch, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, ch);
    grd.addColorStop(0, '#3b2c18'); grd.addColorStop(0.5, '#4a3820'); grd.addColorStop(1, '#3b2c18');
    g.fillStyle = grd; g.fillRect(0, 0, cw, ch);
    g.strokeStyle = '#e0bd68'; g.fillStyle = '#e0bd68';
    const m = ch * 0.06;
    for (const [d, lw] of [[0, ch * 0.022], [ch * 0.05, ch * 0.007]] as const) { g.lineWidth = lw; g.strokeRect(m + d, m + d, cw - 2 * (m + d), ch - 2 * (m + d)); }
    // corner and edge scrolls
    const sc = ch * 0.18;
    for (const [x, y] of [[m, m], [cw - m, m], [m, ch - m], [cw - m, ch - m]]) { g.save(); g.translate(x!, y!); arabesque(g, sc, 4, ch * 0.006); g.restore(); }
    for (let x = cw * 0.12; x < cw * 0.95; x += cw * 0.16) { g.save(); g.translate(x, m); g.scale(1, 0.5); arabesque(g, sc * 0.7, 6, ch * 0.005); g.restore(); g.save(); g.translate(x, ch - m); g.scale(1, 0.5); arabesque(g, sc * 0.7, 6, ch * 0.005); g.restore(); }
    // the title, top left
    g.font = `italic ${Math.round(ch * 0.075)}px "CormorantItalic-600", serif`;
    g.textBaseline = 'middle';
    g.fillText(title, m + ch * 0.12, m + ch * 0.13);
  });
}

/** A turned leg (lathe profile), gilt: a ball foot, a fluted vase, rings, a square-ish capital. Height h, from y = 0 down. */
function turnedLeg(h: number) {
  const P: [number, number][] = [[0, 0], [5.5, 0], [6, -2], [4.2, -4], [5.2, -6], [3.4, -9], [3.0, -h * 0.35], [4.2, -h * 0.45], [2.6, -h * 0.5], [3.4, -h * 0.62], [2.4, -h * 0.82], [3.2, -h * 0.88], [4.6, -h * 0.94], [3.0, -h], [0, -h]];
  return new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 24);
}

/** A column: plinth, base mouldings, a slightly tapered shaft, a capital (gilt), height h. */
function column(h: number, shaftMat: THREE.Material, giltMat: THREE.Material) {
  const g = new THREE.Group();
  const shaft = new THREE.LatheGeometry([[0, 0], [24, 0], [24, 8], [21, 10], [22, 13], [18, 16], [17, h * 0.9], [15.5, h * 0.92], [0, h * 0.92]].map(([r, y]) => new THREE.Vector2(r!, y!)), 28);
  g.add(new THREE.Mesh(shaft, shaftMat));
  const cap = new THREE.LatheGeometry([[0, h * 0.92], [16, h * 0.92], [18, h * 0.94], [24, h * 0.97], [27, h], [0, h]].map(([r, y]) => new THREE.Vector2(r!, y!)), 28);
  g.add(new THREE.Mesh(cap, giltMat));
  return g;
}

/** A draped curtain panel between two columns: vertical folds, gathered towards the top. */
function curtain(w: number, h: number, mat: THREE.Material) {
  const geo = new THREE.PlaneGeometry(w, h, 48, 12);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const v = (y + h / 2) / h; // 0 bottom .. 1 top
    p.setZ(i, Math.sin((x / w) * Math.PI * 9) * (6 + 6 * (1 - v)) + Math.cos((x / w) * Math.PI * 3) * 3);
    p.setX(i, x * (0.75 + 0.25 * (1 - v)) + Math.sign(x) * 0);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** A chandelier: a gilt stem and bowl, two tiers of curved arms with candle cups. Returns it and the candle
 *  positions (local), for the glow drawn per frame. */
function chandelier(mat: THREE.Material) {
  const g = new THREE.Group();
  const body = new THREE.LatheGeometry([[0, 120], [3, 120], [3, 40], [8, 34], [5, 28], [14, 18], [20, 6], [12, -4], [4, -12], [6, -20], [0, -26]].map(([r, y]) => new THREE.Vector2(r!, y!)), 20);
  g.add(new THREE.Mesh(body, mat));
  const candles: THREE.Vector3[] = [];
  for (const [n, r, y, rise] of [[10, 46, 6, 14], [6, 28, 30, 10]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (r < 40 ? 0.3 : 0);
      const pts = [new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * r * 0.5, y - 8, Math.sin(a) * r * 0.5), new THREE.Vector3(Math.cos(a) * r, y + rise * 0.3, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * r, y + rise, Math.sin(a) * r)];
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 1.2, 6), mat));
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(3, 1.6, 3, 10), mat);
      cup.position.set(Math.cos(a) * r, y + rise + 1.5, Math.sin(a) * r);
      g.add(cup);
      candles.push(new THREE.Vector3(Math.cos(a) * r, y + rise + 6, Math.sin(a) * r));
    }
  }
  return { g, candles };
}

export interface Dress {
  /** the hall: shown only in the gold */
  hall: THREE.Group;
  /** candle flames (world positions), for the glow */
  candles: THREE.Vector3[];
  centre: THREE.Vector3;
  /** materials to dim in the dark bridge (floor, gilt) */
  dimmable: THREE.MeshStandardMaterial[];
}

/**
 * Build the piano's dress and the hall around it. `outlineAt(o)` is the case outline offset by o (cm), as
 * [x, z] points; `kb` is where the keyboard sits (its front-centre x and z).
 */
export function buildDress(S: THREE.Scene, outlineAt: (o: number) => [number, number][], wid: number, kbCentreX: number, kbFrontZ: number): Dress {
  const G = gilt();
  const lac = styled({ color: lin('#0d0c0c'), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08 });
  // ---- legs (gilt, turned) under the front corners and the tail; the lyre and pedals
  const legH = -14 - FLOOR_Y;
  const pts = outlineAt(0);
  const zTail = Math.min(...pts.map(([, z]) => z));
  for (const [x, z] of [[-4, 12], [wid + 6, 12], [18, zTail + 22]] as const) {
    const leg = new THREE.Mesh(turnedLeg(legH), G);
    leg.position.set(x, -14, z);
    const block = new THREE.Mesh(new RoundedBoxGeometry(14, 6, 14, 2, 1), lac);
    block.position.set(x, -17, z);
    S.add(leg, block);
  }
  const lyre = new THREE.Group();
  for (const s of [-1, 1]) {
    const arm = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 4, -15, 0), new THREE.Vector3(s * 12, -26, 0), new THREE.Vector3(s * 5, -46, 0), new THREE.Vector3(s * 10, -62, 0), new THREE.Vector3(s * 6, -68, 0)]);
    lyre.add(new THREE.Mesh(new THREE.TubeGeometry(arm, 40, 1.3, 8), G));
  }
  for (let k = -3; k <= 3; k++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 6), G); r.position.set(k * 1.4, -46, 0); lyre.add(r); }
  const box = new THREE.Mesh(new RoundedBoxGeometry(26, 5, 10, 2, 1.2), lac);
  box.position.set(0, -70, 2); lyre.add(box);
  for (const k of [-1, 0, 1]) { const p = new THREE.Mesh(new RoundedBoxGeometry(3, 1.2, 12, 2, 0.5), G); p.position.set(k * 7, -71, 9); lyre.add(p); }
  lyre.position.set(kbCentreX, 0, kbFrontZ - 22);
  S.add(lyre);
  // ---- the floor: a marble disc, the rosette under the piano
  const xs = pts.map(([x]) => x), zs = pts.map(([, z]) => z);
  const centre = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, FLOOR_Y, (Math.min(...zs) + Math.max(...zs)) / 2 + 30);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(620, 96), styled({ color: new THREE.Color(0xffffff), map: floorTexture(), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(centre);
  const ft = (floor.material as THREE.MeshStandardMaterial).map!;
  ft.center.set(0.5, 0.5);
  S.add(floor);
  // ---- the hall (gold only): a ring of columns with gilt capitals, a cornice, curtains, chandeliers
  const hall = new THREE.Group();
  const marble = styled({ color: lin('#5a4a38'), roughness: 0.25, clearcoat: 0.8 });
  const velvet = styled({ color: lin('#3a2a1c'), roughness: 0.9, sheen: 1, sheenColor: lin('#a07840') });
  const N = 14, R0 = 470, HH = 820;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = column(HH, marble, G);
    c.position.set(centre.x + Math.cos(a) * R0, FLOOR_Y, centre.z + Math.sin(a) * R0);
    hall.add(c);
    // a curtain between this column and the next, drawn back
    const a2 = a + Math.PI / N;
    const cu = curtain(2 * R0 * Math.sin(Math.PI / N) - 50, HH * 0.86, velvet);
    cu.position.set(centre.x + Math.cos(a2) * (R0 + 30), FLOOR_Y + HH * 0.43, centre.z + Math.sin(a2) * (R0 + 30));
    cu.lookAt(centre.x, FLOOR_Y + HH * 0.43, centre.z);
    hall.add(cu);
  }
  const cornice = new THREE.LatheGeometry([[R0 - 34, 0], [R0 + 40, 0], [R0 + 46, 10], [R0 + 40, 18], [R0 + 52, 30], [R0 - 28, 30], [R0 - 34, 0]].map(([r, y]) => new THREE.Vector2(r!, y!)), 96);
  const cm = new THREE.Mesh(cornice, G);
  cm.position.set(centre.x, FLOOR_Y + HH, centre.z);
  hall.add(cm);
  const candles: THREE.Vector3[] = [];
  for (const [dx, dz, y] of [[-240, -120, 420], [240, -120, 420], [0, 160, 470], [0, -330, 470]] as const) {
    const { g, candles: cs } = chandelier(G);
    g.scale.setScalar(1.6);
    g.position.set(centre.x + dx, FLOOR_Y + y, centre.z + dz);
    hall.add(g);
    for (const c of cs) candles.push(c.clone().multiplyScalar(1.6).add(g.position));
  }
  S.add(hall);
  return { hall, candles, centre, dimmable: [floor.material as THREE.MeshStandardMaterial, G as THREE.MeshStandardMaterial] };
}

/** Light shafts from high windows: open cones, additive, brighter near the window and soft at the edges
 *  (by the angle to the view). Their own scene, rendered after the solid one with its depth. */
export class Beams {
  scene = new THREE.Scene();
  mats: THREE.ShaderMaterial[] = [];
  add(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, color: [number, number, number]) {
    const len = from.distanceTo(to);
    const geo = new THREE.CylinderGeometry(r0, r1, len, 40, 1, true);
    geo.translate(0, -len / 2, 0); // the top at the origin
    const mat = new THREE.ShaderMaterial({
      uniforms: { col: { value: new THREE.Vector3(...color) }, k: { value: 0 }, len: { value: len } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = -position.y; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 col; uniform float k, len; varying vec3 vN; varying vec3 vV; varying float vY;
        void main() { float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float along = vY / len;
          float a = k * edge * (0.25 + 0.75 * (1.0 - along)) * smoothstep(1.0, 0.85, along);
          gl_FragColor = vec4(col * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
    this.scene.add(m);
    this.mats.push(mat);
    return this.mats.length - 1;
  }
  set(i: number, k: number) { this.mats[i]!.uniforms.k!.value = k; }
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, cam: THREE.Camera) {
    renderer.setRenderTarget(out);
    renderer.render(this.scene, cam);
  }
}
