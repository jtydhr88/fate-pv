// Grieg, In the Hall of the Mountain King (Peer Gynt). The same short phrase, bar after bar, louder,
// higher, faster, until it breaks: a loop. Inside the mountain is a server farm: racks down a tunnel,
// their LEDs lit by the notes; the rails a mine cart rides on are the five lines of a staff with the
// notes as sleepers (spaced by beats, so the cart speeds up with the music); the line-drawn metronome
// of the Beethoven plates comes back and swings faster until the pendulum flies off; deadpan
// readouts (iteration, clock, fan, temperature) climb; and on the cave wall, paper-cut trolls thrown
// by firelight stamp on the accents (a shadow-puppet theatre: the plate's 2D side). The cuts follow
// the tempo: a phrase per shot at first, a beat per shot at the end. The last chord: `SYSTEM OVERLOAD`, then
// dust settling in the dark.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { HEX, LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { glyph } from '../engine/music';
import type { Note } from '../engine/score';
import { clamp, ease, fbm2, hash, lerp, mulberry32, noise1, prog, pulse } from '../engine/util';
import { Stage3D, sparks, mixRGB, seedOf } from './_kit';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCart, cableGeometry, gravelTexture, jaggedRock, moltenTexture, rackFaceTexture, rackSideTexture, timberTexture, type Cart } from './grieg-models';
import { styled } from '../engine/style';
import { LANG } from './opening-text';

type Shot = { t: number; kind: 'shaft' | 'wide' | 'track' | 'pov' | 'rack' | 'meter' | 'puppet' | 'cart' | 'black'; s: number };

const K = 3.2; // world units of track per beat
const RACK_DZ = 14; // rack spacing along the tunnel
const TUNNEL_Y = 16, TUNNEL_R = 30;
const LED_ROWS = 14, LED_COLS = 3;

export default class GriegMountain extends Scene {
  st = new Stage3D();
  rails = new LineBatch(4000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  hud = new Layer2D();
  puppet = new Layer2D();
  dust = new LineBatch(3000, { blend: 'add' });
  notes: Note[] = [];
  heads!: THREE.InstancedMesh;
  headZ: number[] = [];
  leds!: THREE.InstancedMesh;
  racks: { x: number; z: number }[] = [];
  rocks!: THREE.InstancedMesh;
  cart = new THREE.Group();
  cartModel!: Cart;
  bulbs!: THREE.InstancedMesh;
  lampZ: number[] = [];
  lampLights: THREE.PointLight[] = [];
  rackMesh!: THREE.InstancedMesh;
  rackBase: THREE.Matrix4[] = [];
  ledBase: THREE.Vector3[] = [];
  racksMoved = false;
  crystals!: THREE.InstancedMesh;
  crystalBand: number[] = [];
  cableMats: THREE.MeshPhysicalMaterial[] = [];
  molten: THREE.CanvasTexture[] = [];
  zCav0 = 0;
  glow: CanvasGradient | null = null;
  L = 0;
  fx = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  fire = new THREE.PointLight(0xffffff, 0, 90, 1.6);
  wallFire = new THREE.PointLight(0xffffff, 0, 160, 1.4);
  shots: Shot[] = [];
  beat0 = 0;
  tB = 0; // grieg-b start (the cut)
  tFly = 0; // the pendulum flies off
  tFinal = 0; // the last chord
  tEndMusic = 0;
  accents: number[] = []; // troll stamps
  sfz: number[] = []; // the blows (the sforzando chords)
  bars: { n: number; t: number; end: number; seg: string }[] = [];

  override async init() {
    const sc = this.ctx.score;
    const ids = ['grieg-a:rh', 'grieg-a:lh', 'grieg-b:rh', 'grieg-b:lh'].map((p) => sc.partIndex(p));
    this.notes = sc.notesIn(this.ctx.start - 0.5, this.ctx.end + 1).filter((n) => ids.includes(n.part));
    this.bars = sc.bars.filter((b) => b.segment === 'grieg-a' || b.segment === 'grieg-b').map((b) => ({ n: b.n, t: b.t, end: b.end, seg: b.segment }));
    const bar = (n: number, seg = 'grieg-b') => sc.bar(n, seg);
    this.tB = bar(66).t;
    this.tFly = bar(85).t;
    this.tEndMusic = sc.segments.find((s) => s.id === 'grieg-b')!.end;
    // onsets: chord sizes (the blows are the big chords), accents on the downbeats and the phrase's 5th eighth
    const on = new Map<number, Note[]>();
    for (const n of this.notes) { const k = Math.round(n.t * 1000); (on.get(k) ?? on.set(k, []).get(k)!).push(n); }
    for (const [k, ns] of [...on.entries()].sort((a, b) => a[0] - b[0])) {
      const t = k / 1000;
      if (ns.length >= 5) this.sfz.push(t);
      if (ns.some((n) => n.pos < 1e-3 || Math.abs(n.pos - 2) < 1e-3) || ns.length >= 5) this.accents.push(t);
    }
    this.tFinal = this.sfz.filter((t) => t >= bar(88).t - 0.2).at(0) ?? bar(88).t;
    this.beat0 = this.ctx.audio.beatAt(this.ctx.start);
    this.build();
    this.buildShots();
  }

  /** z of the track at time t (the cart's position): beats travelled since the plate began. */
  zAt(t: number) { return -K * (this.ctx.audio.beatAt(Math.min(t, this.tEndMusic)) - this.beat0); }
  /** quarter-note tempo at t (bpm) */
  tempo(t: number) {
    const b = this.bars.find((x) => t >= x.t && t < x.end) ?? (t < this.bars[0]!.t ? this.bars[0]! : this.bars.at(-1)!);
    const len = b.n === 88 ? this.bars.at(-2)!.end - this.bars.at(-2)!.t : b.end - b.t;
    return 240 / len;
  }

  build() {
    const S = this.st.scene;
    const L = -this.zAt(this.ctx.end) + 80;
    this.L = L;
    this.zCav0 = this.zAt(this.tB) - 4;
    // the tunnel: a rock tube seen from inside; broad, smooth undulation (fine noise only drew outline
    // creases all over it), coloured in strata by vertex
    const tg = new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, L + 120, 64, 110, true);
    tg.rotateX(Math.PI / 2);
    tg.translate(0, TUNNEL_Y, -L / 2 + 20);
    const pos = tg.getAttribute('position') as THREE.BufferAttribute;
    const cols: number[] = [];
    const cA = new THREE.Color('#7a6150'), cB = new THREE.Color('#4e3c30'), cC = new THREE.Color('#8e7560'), cc = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i) - TUNNEL_Y, z = pos.getZ(i);
      const a = Math.atan2(y, x);
      const w = this.wallAt(a, z);
      pos.setXYZ(i, w.x, w.y, z);
      const yy = w.y - TUNNEL_Y;
      // strata: bands by height, broken by noise
      const band = Math.sin((TUNNEL_Y + yy) * 0.45 + 3 * fbm2(a * 2, z * 0.03, 2, 5)) * 0.5 + 0.5;
      cc.copy(cA).lerp(band > 0.6 ? cC : cB, Math.abs(band - 0.5) * 1.6);
      cols.push(cc.r, cc.g, cc.b);
    }
    tg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    // faces turned inward by winding, not by a BackSide material: the outline pass renders with a
    // front-side override, and a back-side tunnel would be missing there (every object in it would
    // then stand against "nothing" and get a silhouette line)
    const idx = tg.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); }
    tg.computeVertexNormals();
    const rock = styled({ color: new THREE.Color('#ffffff') });
    rock.vertexColors = true;
    S.add(new THREE.Mesh(tg, rock));
    // the far end of the tunnel: rock, not an open hole
    const endCap = new THREE.Mesh(new THREE.CircleGeometry(TUNNEL_R * 2.6, 40), styled({ color: new THREE.Color('#3a2c22') }));
    endCap.position.set(0, this.cavY(-L - 39), -L - 39);
    S.add(endCap);
    const startCap = endCap.clone();
    startCap.position.set(0, TUNNEL_Y, 79);
    startCap.rotation.y = Math.PI;
    S.add(startCap);
    S.fog = new THREE.Fog(new THREE.Color('#120a06'), 80, 340);
    // the floor: gravel ballast
    const gravel = gravelTexture();
    gravel.repeat.set(9.6, (L + 120) / 10);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(96, L + 120), styled({ color: new THREE.Color('#ffffff'), map: gravel }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -L / 2 + 20);
    S.add(floor);
    const m = new THREE.Matrix4();
    // sleepers under the track (two a beat), timber
    const sleeperMat = styled({ color: new THREE.Color('#ffffff'), map: timberTexture() });
    const nSl = Math.ceil((L + 60) / (K / 2));
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(17.5, 0.36, 0.95), sleeperMat, nSl);
    for (let i = 0; i < nSl; i++) sleepers.setMatrixAt(i, m.makeTranslation((hash(i, 3) - 0.5) * 0.4, 0.2, 30 - i * (K / 2)));
    S.add(sleepers);
    // the five rails of the staff: steel, with a head and a foot (the glowing line rides the head)
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0); shape.lineTo(0.32, 0); shape.lineTo(0.32, 0.08); shape.lineTo(0.07, 0.14); shape.lineTo(0.07, 0.36);
    shape.lineTo(0.18, 0.4); shape.lineTo(0.18, 0.56); shape.lineTo(-0.18, 0.56); shape.lineTo(-0.18, 0.4); shape.lineTo(-0.07, 0.36);
    shape.lineTo(-0.07, 0.14); shape.lineTo(-0.32, 0.08); shape.closePath();
    const railG = new THREE.ExtrudeGeometry(shape, { depth: L + 60, bevelEnabled: false, steps: 1 });
    railG.translate(0, 0.38, -(L + 60) + 30);
    const steel = styled({ color: new THREE.Color('#5a5650') });
    for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(railG, steel); r.position.x = (i - 2) * 3.4; S.add(r); }
    // the racks, both sides: drawn front panels (facing the track), perforated sides; LEDs in their sockets
    // (in the hall every other inner rack is left out: the outer rows and the vault show between them)
    for (let z = -6, n = 0; z > -L; z -= RACK_DZ, n++) if (this.cavK(z) < 0.75 || n % 2 === 0) for (const x of [-13, 13]) this.racks.push({ x, z });
    // in the hall: a second row each side, set back (the rows of the cathedral of machines)
    for (let z = -6; z > -L; z -= RACK_DZ) if (this.cavK(z) > 0.75) for (const x of [-29, 29]) this.racks.push({ x, z });
    const front = styled({ color: new THREE.Color('#ffffff'), map: rackFaceTexture() });
    const sideM = styled({ color: new THREE.Color('#ffffff'), map: rackSideTexture() });
    const dark = styled({ color: new THREE.Color('#1c1c20') });
    // box faces: +x (the front, turned to the track per instance), -x, +y, -y, +z, -z
    const rackMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 22, 9), [front, dark, sideM, dark, sideM, sideM], this.racks.length);
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    this.racks.forEach((r, i) => {
      q.setFromAxisAngle(up, r.x < 0 ? 0 : Math.PI);
      rackMesh.setMatrixAt(i, m.compose(new THREE.Vector3(r.x, 11.5, r.z), q, one));
      this.rackBase.push(m.clone());
    });
    S.add(rackMesh);
    this.rackMesh = rackMesh;
    // plinths under the racks (a dark kick plate, off the floor plane)
    const plinth = new THREE.InstancedMesh(new THREE.BoxGeometry(6.4, 0.5, 9.4), dark, this.racks.length);
    this.racks.forEach((r, i) => plinth.setMatrixAt(i, m.makeTranslation(r.x, 0.26, r.z)));
    S.add(plinth);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.24, 0.46), ledMat, this.racks.length * LED_ROWS * LED_COLS);
    let k = 0;
    for (const r of this.racks) for (let row = 0; row < LED_ROWS; row++) for (let col = 0; col < LED_COLS; col++) {
      // the face is at |x| = 10; the LED stands 0.08 proud of it (never coplanar with it)
      const x = r.x + (r.x < 0 ? 3.04 : -3.04), y = 3.0 + row * 1.35, z = r.z + (col - 1) * 2.4;
      this.leds.setMatrixAt(k, m.makeTranslation(x, y, z));
      this.ledBase.push(new THREE.Vector3(x, y, z));
      this.leds.setColorAt(k++, new THREE.Color(0, 0, 0));
    }
    S.add(this.leds);
    // cable trays along both walls above the racks, and cables slung from every rack
    for (const sx of [-1, 1]) {
      // (only in the tunnel: the hall stays open to its vault)
      const tz1 = this.zCav0 - 6, tlen = 30 - tz1;
      const tray = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, tlen), dark);
      tray.position.set(sx * 15.5, 26.2, 30 - tlen / 2);
      S.add(tray);
      const cm = styled({ color: new THREE.Color(sx < 0 ? '#2a3a44' : '#3a2a2a'), emissive: new THREE.Color().setRGB(...LIN.ember), emissiveIntensity: 0 });
      this.cableMats.push(cm);
      S.add(new THREE.Mesh(cableGeometry(this.racks.filter((r) => Math.abs(r.x) < 20 && r.z > this.zCav0), sx * 15.5, 26.2), cm));
    }
    // timber mine sets every two racks: posts, a cap, braces; a cage lamp hangs from each cap
    const sets: THREE.BufferGeometry[] = [];
    const lampZ: number[] = [];
    const hallLamps: number[] = [];
    for (let z = -13; z > -L - 20; z -= RACK_DZ * 2) {
      if (this.cavK(z) > 0.15) { lampZ.push(z); hallLamps.push(z); continue; } // the hall: lamps on long chains from the vault
      for (const sx of [-1, 1]) {
        const p = new THREE.BoxGeometry(1.2, 28, 1.2); p.translate(sx * 18.4, 14, z); sets.push(p);
        const br = new THREE.BoxGeometry(0.7, 6, 0.7); br.rotateZ(sx * 0.75); br.translate(sx * 16.2, 26, z); sets.push(br);
      }
      const cap = new THREE.BoxGeometry(39, 1.3, 1.4); cap.translate(0, 28.6, z); sets.push(cap);
      lampZ.push(z);
    }
    S.add(new THREE.Mesh(mergeGeometries(sets), sleeperMat));
    // the hanging lamps: a wire, a cone shade, a glowing bulb
    const lampParts: THREE.BufferGeometry[] = [];
    for (const z of lampZ) {
      const topY = hallLamps.includes(z) ? this.wallAt(Math.PI / 2, z, 1).y : 28;
      const wire = new THREE.CylinderGeometry(0.06, 0.06, topY - 25.4, 4); wire.translate(0, (topY + 25.4) / 2, z); lampParts.push(wire);
      const shade = new THREE.ConeGeometry(1.3, 1.0, 14, 1, true); shade.translate(0, 25.0, z); lampParts.push(shade);
    }
    const shadeMat = styled({ color: new THREE.Color('#2a2622') });
    shadeMat.side = THREE.DoubleSide;
    S.add(new THREE.Mesh(mergeGeometries(lampParts), shadeMat));
    this.lampZ = lampZ;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), lampZ.length);
    lampZ.forEach((z, i) => { this.bulbs.setMatrixAt(i, m.makeTranslation(0, 24.45, z)); this.bulbs.setColorAt(i, new THREE.Color(0, 0, 0)); });
    S.add(this.bulbs);
    // crystal veins in the rock: clusters of glowing prisms pointing out of the wall (many more in the hall)
    {
      const cg = new THREE.OctahedronGeometry(1, 0); cg.scale(0.45, 1.6, 0.45); cg.translate(0, 1.2, 0);
      const R = mulberry32(303);
      const mats: THREE.Matrix4[] = [];
      const qq = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < 1400 && mats.length < 650; i++) {
        const z = 30 - R() * (L + 40);
        const cav = this.cavK(z);
        if (R() > 0.35 + 0.65 * cav) continue;
        const a = R() < 0.75 ? Math.PI * (0.12 + 0.76 * R()) : (R() < 0.5 ? -0.25 : Math.PI + 0.25) + (R() - 0.5) * 0.3;
        const w = this.wallAt(a, z, 0.4);
        const inward = new THREE.Vector3(-w.x, this.cavY(z) - w.y, 0).normalize();
        const n = 2 + Math.floor(R() * 4);
        const band = Math.floor(R() * 4);
        for (let c = 0; c < n; c++) {
          const dir = inward.clone().add(new THREE.Vector3((R() - 0.5) * 1.1, (R() - 0.5) * 1.1, (R() - 0.5) * 1.1)).normalize();
          const sc = (0.45 + R() * 0.9) * (1 + 0.45 * cav);
          qq.setFromUnitVectors(yAxis, dir);
          mats.push(new THREE.Matrix4().compose(w.clone().add(new THREE.Vector3((R() - 0.5) * 1.5, (R() - 0.5) * 1.5, (R() - 0.5) * 1.5)), qq, new THREE.Vector3(sc, sc * (0.8 + R() * 0.8), sc)));
          this.crystalBand.push(band);
        }
      }
      this.crystals = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ color: 0xffffff }), mats.length);
      mats.forEach((mm, i) => { this.crystals.setMatrixAt(i, mm); this.crystals.setColorAt(i, new THREE.Color(0, 0, 0)); });
      S.add(this.crystals);
    }
    // stalactites from the roof: jagged rock cones, giants in the hall
    {
      const sg = new THREE.ConeGeometry(1, 1, 7, 5);
      const sp = sg.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i++) {
        const x = sp.getX(i), y = sp.getY(i), zz = sp.getZ(i);
        const k = 1 + 0.35 * (fbm2(x * 2 + y * 3, zz * 2 + y, 2, 7) - 0.5);
        sp.setXYZ(i, x * k, y, zz * k);
      }
      sg.rotateX(Math.PI); sg.translate(0, -0.5, 0); // apex down, base at y = 0
      const flat = sg.toNonIndexed(); flat.computeVertexNormals();
      const R = mulberry32(404);
      const list: THREE.Matrix4[] = [];
      for (let i = 0; i < 900 && list.length < 220; i++) {
        const z = 30 - R() * (L + 40);
        const cav = this.cavK(z);
        if (R() > 0.4 + 0.6 * cav) continue;
        const a = Math.PI / 2 + (R() - 0.5) * (1.4 + 0.6 * cav);
        const w = this.wallAt(a, z, 0.6);
        const len = (3 + R() * R() * 10) * (1 + 1.8 * cav), rad = len * (0.12 + R() * 0.08);
        // keep clear of the cart's path and the mine sets
        if (w.y - len < 31 + 22 * cav) continue;
        list.push(new THREE.Matrix4().compose(w, new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.15, R() * 6, (R() - 0.5) * 0.15)), new THREE.Vector3(rad, len, rad)));
      }
      const st = new THREE.InstancedMesh(flat, styled({ color: new THREE.Color('#8a705c') }), list.length);
      list.forEach((mm, i) => st.setMatrixAt(i, mm));
      S.add(st);
    }
    // molten channels at the racks' feet, either side of the track: flowing light
    for (const sx of [-1, 1]) {
      const tex = moltenTexture();
      tex.repeat.set(1, (L + 60) / 12);
      this.molten.push(tex);
      const mm = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color().setRGB(LIN.ochre[0] * 2.6, LIN.ochre[1] * 2.3, LIN.ochre[2] * 1.8) });
      const ch = new THREE.Mesh(new THREE.PlaneGeometry(1.25, L + 60), mm);
      ch.rotation.x = -Math.PI / 2; ch.position.set(sx * 9.45, 0.16, -(L + 60) / 2 + 30);
      S.add(ch);
      // its stone lips
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, L + 60), styled({ color: new THREE.Color('#2c221b') }));
      lip.position.set(sx * 8.65, 0.22, -(L + 60) / 2 + 30);
      S.add(lip);
    }
    // the notes as heads lying on the sleepers between the rails, spaced by beats
    const hg = new THREE.SphereGeometry(1, 16, 10); hg.scale(0.62, 0.2, 0.42);
    this.heads = new THREE.InstancedMesh(hg, styled({ color: new THREE.Color(0xffffff) }), this.notes.length);
    this.notes.forEach((n, i) => {
      const z = this.zAt(n.t), x = this.pitchX(n.p);
      this.headZ.push(z);
      this.heads.setMatrixAt(i, m.makeTranslation(x, 0.56, z)); // on the sleepers, under the wheels' flanges
      this.heads.setColorAt(i, new THREE.Color(...LIN.bone));
    });
    S.add(this.heads);
    // the cart (grieg-models.ts): its wheels ride the rails' heads (y = 0.94)
    this.cartModel = buildCart();
    this.cartModel.group.position.y = 0.94 - 0.0;
    this.cart.add(this.cartModel.group);
    S.add(this.cart);
    // falling rocks for the collapse: jagged
    this.rocks = new THREE.InstancedMesh(jaggedRock(1.6, 5, 0.32), styled({ color: new THREE.Color('#6e5848') }), 60);
    this.rocks.count = 0;
    S.add(this.rocks);
    // firelight: the lantern on the cart, a fire far down the tunnel
    this.fire.color.setRGB(...LIN.ember); this.wallFire.color.setRGB(...LIN.ember);
    S.add(this.fire, this.wallFire);
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 70, 1.5); l.color.setRGB(...LIN.ember); this.lampLights.push(l); S.add(l); }
    this.st.key.intensity = 0.6;
    this.st.fill.intensity = 0.15;
  }

  /** 0..1: how far the tunnel has opened into the King's hall at z (it opens just after the cut) */
  cavK(z: number) { return clamp((this.zCav0 - z) / 46); }
  cavS(z: number) { const k = this.cavK(z); return 1 + 0.85 * k * k * (3 - 2 * k); }
  /** centre height of the vault at z (the hall's roof rises) */
  cavY(z: number) { return TUNNEL_Y + 16 * (this.cavS(z) - 1); }
  /** noise of the rock wall (radius factor) */
  wallK(a: number, z: number) { return 1 + 0.2 * (fbm2(a * 1.6, z * 0.022, 3, 3) - 0.5) + 0.05 * (fbm2(a * 4, z * 0.06, 2, 9) - 0.5); }
  /** a point on the rock wall at angle a (0 = +x, pi/2 = the roof) and z, pulled in by `inset` */
  wallAt(a: number, z: number, inset = 0) {
    const r = TUNNEL_R * this.cavS(z) * this.wallK(a, z) - inset, cy = this.cavY(z);
    return new THREE.Vector3(Math.cos(a) * r, cy + Math.max(Math.sin(a) * r, -cy - 1), z);
  }

  pitchX(p: number) { return clamp((p - 62) / 34, -1, 1) * 7.5; }

  buildShots() {
    const sc = this.ctx.score;
    const S: Shot[] = [];
    const add = (t: number, kind: Shot['kind']) => S.push({ t, kind, s: S.length });
    const ba = (n: number) => sc.bar(n, 'grieg-a').t, bb = (n: number) => sc.bar(n, 'grieg-b');
    // the creep: one bar a shot, establishing first
    add(this.ctx.start, 'shaft'); add(ba(3), 'wide'); add(ba(4), 'track'); add(ba(5), 'puppet');
    // the stretto: one shot a bar
    const stretto: Shot['kind'][] = ['pov', 'wide', 'puppet', 'track', 'meter', 'cart', 'rack', 'puppet'];
    for (let n = 66; n <= 73; n++) add(bb(n).t, stretto[n - 66]!);
    // the blows: a chord bar opens on the cart and cuts to the trolls on the blow; the runs between, half bars
    for (let n = 74; n <= 83; n++) {
      const b = bb(n), half = (b.end - b.t) / 2;
      if ([74, 75, 78, 79, 82, 83].includes(n)) {
        // the first blow of each pair cuts to the trolls; the second to the racks flaring
        add(b.t, n % 2 ? 'track' : 'pov');
        const blow = this.sfz.find((x) => x > b.t + 0.05 && x < b.end) ?? b.t + half / 2;
        add(blow - 0.02, n % 2 ? 'wide' : 'puppet');
      } else {
        add(b.t, n % 2 ? 'rack' : 'wide');
        add(b.t + half, n % 2 ? 'pov' : 'track');
      }
    }
    // the collapse: one shot a beat
    const beats: Shot['kind'][][] = [['puppet', 'rack', 'cart', 'track'], ['meter', 'pov', 'rack', 'meter'], ['wide', 'track', 'cart', 'pov'], ['wide', 'puppet', 'track', 'wide']];
    for (let n = 84; n <= 87; n++) {
      const b = bb(n), q = (b.end - b.t) / 4;
      for (let i = 0; i < 4; i++) add(b.t + i * q, beats[n - 84]![i]!);
    }
    add(this.tFinal - 0.02, 'wide');
    add(this.tFinal + 0.5, 'black');
    this.shots = S;
  }

  shotAt(t: number) {
    let i = 0;
    while (i + 1 < this.shots.length && t >= this.shots[i + 1]!.t) i++;
    const s = this.shots[i]!, next = this.shots[i + 1];
    return { shot: s, u: t - s.t, len: (next?.t ?? this.ctx.end) - s.t };
  }

  /** heat 0..1: how hard the machine is running (the tempo, then the collapse) */
  heat(t: number) {
    const q = this.tempo(t);
    const h = t < this.tB ? 0 : clamp((q - 150) / 62);
    return clamp(h + 0.25 * prog(t, this.tFly - 1, this.tFinal) + Math.max(0, ...this.sfz.map((x) => pulse(t, x, 0.12))) * 0.25);
  }

  camera(t: number, kind: Shot['kind'], u: number, len: number, seed: number) {
    const cz = this.zAt(t);
    const R = mulberry32(seed * 7919 + 13);
    const side = R() < 0.5 ? -1 : 1;
    const q = clamp(u / Math.max(0.2, len));
    const sh = (t > this.tB ? 0.15 + 0.6 * this.heat(t) : 0.05) + (t > this.tFly ? 1.2 : 0);
    const jx = noise1(t * 23, 1) * sh, jy = noise1(t * 23, 2) * sh;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    switch (kind) {
      case 'shaft': {
        // coming down from the roof of the hall (out of the dark above), tilting up from the cart to the tunnel
        const y = lerp(43, 17, ease.inOutCubic(q));
        return { eye: V(2, y, cz + 22 - 8 * q), at: V(0, lerp(-6, 6, ease.inOutCubic(q)), cz - lerp(4, 70, ease.inOutCubic(q))), fov: 56, roll: 0.12 * (1 - q) };
      }
      case 'wide': {
        // the hall: the tunnel of racks receding, the cart on the staff
        const back = 34 + 6 * R();
        if (this.cavK(cz) > 0.5) {
          // in the King's hall: up high, the vault, its stalactites and crystal veins over the rows of machines
          const hall = clamp((this.cavK(cz) - 0.5) * 2);
          return { eye: V(side * (5 + 6 * R()) + jx, lerp(25, 40 + 6 * R(), hall) + jy, cz + back + 10 - 8 * q), at: V(0, lerp(5, 24, hall), cz - 90), fov: lerp(52, 64, hall), roll: side * 0.05 };
        }
        return { eye: V(side * (3 + 4 * R()) + jx, 21 + 4 * R() + jy, cz + back - 6 * q), at: V(0, 5, cz - 60), fov: 52, roll: side * 0.04 };
      }
      case 'track':
        // low beside the track ahead of the cart: it comes at the camera over the notes
        return { eye: V(side * 8 + jx, 3.6 + jy, cz - 24 + 4 * q), at: V(side * 0.5, 3, cz + 2), fov: 44, roll: -side * 0.06 };
      case 'cart':
        // low beside the front wheel, looking back along the cart: the wheels, the rails, the sparks
        return { eye: V(side * 7.5 + jx * 0.5, 1.6 + jy * 0.5, cz - 9 + 2 * q), at: V(side * 2.2, 2.6, cz + 1.5), fov: 46, roll: -side * 0.05 };
      case 'pov':
        return { eye: V(jx * 0.6, 6.4 + jy * 0.6, cz - 6.5), at: V(0, 2.5, cz - 46), fov: 64, roll: 0.05 * noise1(t * 2, 5) };
      case 'rack': {
        // in close on the LEDs of a rack a little ahead of the cart
        const rz = Math.floor((cz - 18) / RACK_DZ) * RACK_DZ - 6;
        const x = side * 13 - side * 3.05;
        return { eye: V(x - side * 10 + jx * 0.3, 11.5 + jy * 0.3, rz + 7 - 3 * q), at: V(x, 11, rz - 2), fov: 50, roll: side * 0.06 };
      }
      default: // meter: the pov, dimmed under the big metronome
        return { eye: V(jx, 6.4 + jy, cz - 6.5), at: V(0, 3, cz - 46), fov: 64, roll: 0 };
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const { shot, u, len } = this.shotAt(t);
    const heat = this.heat(t);
    const hitAny = Math.max(0, ...this.accents.map((x) => pulse(t, x, 0.08)));
    const blow = Math.max(0, ...this.sfz.map((x) => pulse(t, x, 0.1)));
    const flash = pulse(t, this.tFinal, 0.12);

    // the world
    const cz = this.zAt(t);
    this.cart.position.set(0, 0.12 * Math.abs(noise1(t * 30, 4)) * (0.2 + heat), cz);
    this.cart.rotation.z = 0.02 * noise1(t * 9, 6) * (0.3 + heat);
    for (const w of this.cartModel.wheels) w.rotation.x = cz / 1.1;
    const flick = 0.75 + 0.25 * noise1(t * 9, 1) + 0.1 * noise1(t * 31, 2);
    const lan = this.cartModel.lantern.clone().add(this.cartModel.group.position).add(this.cart.position);
    this.fire.position.copy(lan);
    const gk = 2.2 + 1.6 * flick + 2 * heat;
    this.cartModel.glass.color.setRGB(LIN.ember[0] * gk, LIN.ember[1] * gk, LIN.ember[2] * gk);
    this.paintBulbs(t, heat);
    this.fire.intensity = (60 + 140 * heat) * flick * (1 + 2 * hitAny) + 9000 * flash;
    this.wallFire.position.set(0, 10, cz - 80);
    this.wallFire.intensity = (90 + 200 * heat) * flick;
    this.st.rim.intensity = 0.4 + 3 * blow;
    this.paintLeds(t, cz, heat);
    this.paintHeads(t, cz);
    this.paintRocks(t, cz);
    this.paintCrystals(t, heat, flash);
    this.moveRacks(t, cz);
    const beat = this.ctx.audio.beatAt(t), bp = Math.exp(-(beat - Math.floor(beat)) * 5);
    for (const cm of this.cableMats) cm.emissiveIntensity = t > this.tFinal + 0.1 ? 0 : (0.12 + 1.6 * bp) * (0.35 + heat);
    this.molten.forEach((tx, i) => { tx.offset.y = t * (0.35 + 0.5 * heat) * (i ? 1 : 1.07); });

    const C = this.camera(t, shot.kind, u, len, shot.s);
    this.st.look(C.eye, C.at, C.roll, C.fov);

    renderer.setRenderTarget(out);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    if (shot.kind === 'puppet') {
      this.drawPuppets(t, heat);
      comp.draw(renderer, this.puppet.upload(), out);
    } else if (shot.kind !== 'black') {
      this.st.render(renderer, out);
      this.drawRails(t, cz);
      this.rails.render(renderer, out, this.st.cam);
      this.drawFx(t, cz, heat, lan);
      this.fx.render(renderer, out, this.st.cam);
    }
    this.drawHud(t, shot.kind, heat);
    comp.draw(renderer, this.hud.upload(), out);
    if (t > this.tFinal) {
      this.drawDust(t);
      this.dust.render(renderer, out);
    }

    const fadeIn = prog(t, this.ctx.start, this.ctx.start + 0.5);
    const sh = (shot.kind === 'puppet' ? 10 : 6) * (hitAny * (0.3 + heat) + blow) + (t > this.tFly && t < this.tFinal ? 5 : 0);
    return {
      ramp: 'cave', ramp2: 'caveHot', rampMix: clamp(heat * 0.9 + flash), grade: 1, gradeSteps: 4, hatch: 0.5,
      bloom: 0.75, bloomThreshold: 1.05, halation: 0.2, grain: 0.07, vignette: 0.55,
      fade: 1 - fadeIn, flash: 0.95 * flash,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.025 * blow, ca: 1 + 2 * blow + 1.5 * heat,
    };
  }

  /** LED rows lit by the notes (pitch picks the row, the note picks the rack), all red-hot at the end. */
  paintLeds(t: number, cz: number, heat: number) {
    const recent = this.notes.filter((n) => n.t <= t && t - n.t < 0.5);
    const col = new THREE.Color();
    let k = 0;
    const crit = prog(t, this.tFly, this.tFinal);
    const dead = t > this.tFinal + 0.12;
    this.racks.forEach((r, ri) => {
      const near = Math.abs(r.z - cz) < 140;
      for (let row = 0; row < LED_ROWS; row++) for (let c = 0; c < LED_COLS; c++) {
        let e = 0;
        if (near && !dead) {
          for (const n of recent) {
            const nr = Math.floor(clamp((n.p - 23) / 75) * LED_ROWS * 0.999);
            if (nr !== row) continue;
            if (hash(ri, Math.round(n.t * 100), c) > 0.35 + 0.3 * (1 - heat)) continue;
            e = Math.max(e, Math.exp(-(t - n.t) * 9));
          }
          // idle blink, faster with the heat
          e = Math.max(e, 0.12 * (hash(ri, row, c, Math.floor(t * (2 + 10 * heat))) > 0.7 ? 1 : 0));
          e = Math.max(e, crit * (hash(ri, row, c, Math.floor(t * 20)) > 0.4 ? 1 : 0));
        }
        // green at rest, amber with the heat, red-white when it fails
        const g: [number, number, number] = heat < 0.5 ? [0.35, 1.0, 0.45] : heat < 0.85 ? [1.0, 0.55, 0.1] : [1.0, 0.18, 0.08];
        col.setRGB(g[0] * e * 3, g[1] * e * 3, g[2] * e * 3);
        this.leds.setColorAt(k++, col);
      }
    });
    this.leds.instanceColor!.needsUpdate = true;
  }

  /** The sounding notes on the track burn (firelight ember); the rest are bone. */
  paintHeads(t: number, cz: number) {
    const col = new THREE.Color();
    this.notes.forEach((n, i) => {
      if (Math.abs(this.headZ[i]! - cz) > 160) return;
      const on = t >= n.t && t < n.t + n.d + 0.15 ? 1 - prog(t, n.t + n.d, n.t + n.d + 0.15) : 0;
      const past = t > n.t ? 0.55 : 1;
      col.setRGB(lerp(LIN.bone[0] * past, LIN.ember[0] * 4, on), lerp(LIN.bone[1] * past, LIN.ember[1] * 4, on), lerp(LIN.bone[2] * past, LIN.ember[2] * 4, on));
      this.heads.setColorAt(i, col);
    });
    this.heads.instanceColor!.needsUpdate = true;
  }

  /** The collapse: rocks fall from the roof around the cart from the pendulum's flight on. */
  paintRocks(t: number, cz: number) {
    if (t < this.tFly) { this.rocks.count = 0; return; }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    let k = 0;
    const R = mulberry32(88);
    for (let i = 0; i < 60; i++) {
      const t0 = this.tFly + R() * (this.tFinal - this.tFly + 0.6), x = (R() - 0.5) * 34, dz = -R() * 70 + 10, sc = 0.6 + R() * 1.8;
      const age = t - t0;
      if (age < 0) continue;
      const y = Math.max(sc, TUNNEL_Y + TUNNEL_R - 4 - 0.5 * 90 * age * age);
      e.set(age * 3 + i, age * 2, i);
      m.compose(s.set(x, y, this.zAt(t0) + dz), q.setFromEuler(e), new THREE.Vector3(sc, sc, sc));
      this.rocks.setMatrixAt(k++, m);
    }
    this.rocks.count = k;
    this.rocks.instanceMatrix.needsUpdate = true;
    void cz;
  }

  /** Crystals: a warm glow breathing slowly; one band in four flares on each beat; all flare on the last chord. */
  paintCrystals(t: number, heat: number, flash: number) {
    const beat = this.ctx.audio.beatAt(Math.min(t, this.tFinal)), ph = beat - Math.floor(beat), b4 = Math.floor(beat) % 4;
    const dead = t > this.tFinal + 0.15 ? Math.exp(-(t - this.tFinal - 0.15) * 3) : 1;
    const c = new THREE.Color();
    const base = [LIN.ochre[0] * 0.55 + LIN.bone[0] * 0.45, LIN.ochre[1] * 0.55 + LIN.bone[1] * 0.45, LIN.ochre[2] * 0.55 + LIN.bone[2] * 0.45];
    for (let i = 0; i < this.crystalBand.length; i++) {
      let g = 0.75 + 0.25 * Math.sin(t * 1.3 + i * 0.7);
      if (this.crystalBand[i] === b4) g += 2.4 * Math.exp(-ph * 4) * (0.5 + heat);
      g = 1.35 * g * (1 + 0.6 * heat) * dead + 6 * flash;
      c.setRGB(base[0]! * g, base[1]! * g, base[2]! * g);
      this.crystals.setColorAt(i, c);
    }
    this.crystals.instanceColor!.needsUpdate = true;
  }

  /** The collapse: the racks near the cart judder and lean in over the track, LEDs and all. */
  moveRacks(t: number, cz: number) {
    const on = t > this.tFly;
    if (!on && !this.racksMoved) return;
    const m = new THREE.Matrix4(), piv = new THREE.Matrix4(), rot = new THREE.Matrix4(), back = new THREE.Matrix4(), v = new THREE.Vector3();
    this.racks.forEach((r, i) => {
      let ang = 0;
      if (on && Math.abs(r.x) < 20 && r.z < cz + 30 && r.z > cz - 110) {
        const t0 = this.tFly + 0.15 + hash(i, 41) * (this.tFinal - this.tFly);
        const age = t - t0;
        if (age > 0) {
          const target = 0.12 + 0.3 * hash(i, 42);
          ang = target * (1 - Math.exp(-age * 6)) + 0.04 * Math.exp(-age * 3) * Math.sin(age * 40);
        }
      }
      const sgn = r.x < 0 ? -1 : 1;
      // pivot on the rack's inner bottom edge; top swings toward the track
      const px = r.x - sgn * 3;
      piv.makeTranslation(px, 0.5, r.z); rot.makeRotationZ(sgn * ang); back.makeTranslation(-px, -0.5, -r.z);
      const T = piv.clone().multiply(rot).multiply(back);
      this.rackMesh.setMatrixAt(i, m.copy(T).multiply(this.rackBase[i]!));
      for (let k = 0; k < LED_ROWS * LED_COLS; k++) {
        const j = i * LED_ROWS * LED_COLS + k;
        v.copy(this.ledBase[j]!).applyMatrix4(T);
        this.leds.setMatrixAt(j, m.makeTranslation(v.x, v.y, v.z).multiply(new THREE.Matrix4().makeRotationZ(sgn * ang)));
      }
    });
    this.rackMesh.instanceMatrix.needsUpdate = true;
    this.leds.instanceMatrix.needsUpdate = true;
    this.racksMoved = on;
  }

  /** The hanging lamps: a flicker each, brighter with the heat; in the collapse they stutter and die. */
  paintBulbs(t: number, heat: number) {
    const c = new THREE.Color();
    const crit = prog(t, this.tFly, this.tFinal);
    this.lampZ.forEach((z, i) => {
      let k = (1.4 + 1.2 * heat) * (0.8 + 0.2 * noise1(t * 7 + i * 3.1, 2));
      if (crit > 0 && hash(i, Math.floor(t * 14)) < crit * 0.7) k *= 0.08;
      if (t > this.tFinal + 0.1) k = 0;
      c.setRGB(LIN.ember[0] * k * 1.3, LIN.ember[1] * k * 1.25, LIN.ember[2] * k);
      this.bulbs.setColorAt(i, c);
    });
    this.bulbs.instanceColor!.needsUpdate = true;
    // the three lamps nearest the cart (ahead of it, mostly) light the rock and the racks
    const cz = this.zAt(t);
    const near = this.lampZ.map((z, i) => ({ z, i })).sort((a, b) => Math.abs(a.z - (cz - 20)) - Math.abs(b.z - (cz - 20))).slice(0, 3);
    near.forEach(({ z, i }, j) => {
      const l = this.lampLights[j]!;
      l.position.set(0, 23.5, z);
      const k = (this.bulbs.instanceColor!.getX(i) / (LIN.ember[0] * 1.3 + 1e-6));
      l.intensity = 90 * k;
    });
  }

  /**
   * Particles over the cel-shaded world: sparks thrown from the wheels on the notes (more, and brighter,
   * with the heat; a fan of them on the blows), embers rising from the lantern, dust motes lit by it,
   * and in the collapse: dust pouring from the roof and grit bursting where the rocks land.
   */
  drawFx(t: number, cz: number, heat: number, lan: THREE.Vector3) {
    const X = this.fx; X.clear();
    if (t > this.tFinal + 0.75) return;
    // wheel sparks: each onset strikes from one wheel (two on the blows), where the wheel was then
    const wheelsAt = [[-3.4, -2.6], [3.4, -2.6], [-3.4, 2.6], [3.4, 2.6]];
    for (const n of this.notes) {
      if (n.t > t || t - n.t > 0.8 || n.p > 60) continue; // the bass notes drive the wheels
      const blow = this.sfz.some((x) => Math.abs(x - n.t) < 0.02);
      const odds = 0.15 + 0.85 * heat + (blow ? 1 : 0);
      if (hash(Math.round(n.t * 1000), 7) > odds) continue;
      const nz = this.zAt(n.t);
      for (let w = 0; w < (blow ? 4 : 1); w++) {
        const [wx, wz] = wheelsAt[(Math.floor(hash(Math.round(n.t * 1000), 11) * 4) + w) % 4]!;
        sparks(X, t, n.t, wx!, 0.95, nz + wz!, seedOf(n.t, w), { count: blow ? 60 : Math.round(10 + 30 * heat), speed: 8 + 8 * heat, life: 0.55, gravity: 26, width: 0.05, gain: 4 + 4 * heat });
      }
    }
    // embers from the lantern, drifting up and back
    const R = mulberry32(77);
    for (let i = 0; i < 60; i++) {
      const per = 1.2 + R(), off = R(), dx = (R() - 0.5) * 0.8, dz = (R() - 0.5) * 0.8, sw = R() * 6;
      const ph = (t / per + off) % 1;
      const life = 1 - ph;
      const x = lan.x + dx + 0.6 * Math.sin(t * 2 + sw) * ph, y = lan.y + 0.6 + ph * 5, z = lan.z + dz + ph * (3 + 6 * heat);
      const g = 3 * life * life * (0.6 + heat);
      X.seg(x, y, z, x - 0.05, y - 0.18, z - 0.25, 0.05, LIN.ember[0] * g, LIN.ember[1] * g, LIN.ember[2] * g, 1);
    }
    // overheating racks: when it runs hot, the racks near the cart spit sparks from their tops on the accents
    if (heat > 0.3) {
      for (const a of this.accents) {
        if (a > t || t - a > 0.9) continue;
        for (let k = 0; k < 3; k++) {
          const ri = Math.floor(hash(Math.round(a * 1000), k, 5) * this.racks.length);
          const r = this.racks[ri]!;
          if (Math.abs(r.z - cz) > 70 || Math.abs(r.x) > 20) continue;
          const sx = r.x < 0 ? -1 : 1;
          sparks(X, t, a, r.x - sx * 3, 22.6, r.z + (hash(ri, a) - 0.5) * 6, seedOf(a, ri), { count: Math.round(25 + 50 * heat), speed: 9, life: 0.9, gravity: 30, width: 0.06, gain: 5 });
        }
      }
    }
    // heat shimmer: embers swirling round the cart in a slow vortex, thicker with the heat
    {
      const E = mulberry32(55);
      const n = Math.round(80 + 340 * heat);
      for (let i = 0; i < n; i++) {
        const r0 = 3 + E() * 16, a0 = E() * Math.PI * 2, h0 = E() * 26, per = 3 + E() * 4, z0 = (E() - 0.5) * 70, w0 = 0.3 + E() * 0.6;
        const ph = (t / per + E()) % 1;
        const a = a0 + t * w0 * (1 + heat);
        const x = Math.cos(a) * r0, y = (h0 + ph * 14) % 28 + 1, z = cz - 10 + z0 + Math.sin(a) * r0 * 0.4;
        const g = 1.8 * Math.sin(Math.PI * ph) * (0.3 + heat);
        X.seg(x, y, z, x - Math.sin(a) * 0.25, y - 0.12, z + Math.cos(a) * 0.1, 0.05, LIN.ember[0] * g, LIN.ember[1] * g, LIN.ember[2] * g, 1);
      }
    }
    // the lamps' light through the haze: faint cones (brighter as the dust rises in the collapse)
    {
      const crit = t > this.tFly ? prog(t, this.tFly, this.tFly + 0.8) : 0;
      const dz = this.lampZ.filter((z) => z < cz + 25 && z > cz - 90);
      for (const z of dz) {
        const L0 = mulberry32(Math.round(-z));
        const g = (0.022 + 0.06 * crit) * (t > this.tFinal + 0.1 ? 0 : 1);
        for (let k = 0; k < 22; k++) {
          const a = (k / 22) * Math.PI * 2 + L0() * 0.2, rr = 4 + L0() * 5;
          X.seg(0, 24.3, z, Math.cos(a) * rr, 0.3, z + Math.sin(a) * rr, 1.1 + L0() * 0.8, LIN.ochre[0] * g, LIN.ochre[1] * g, LIN.ochre[2] * g, 1);
        }
      }
    }
    // the last chord: a burst of light from the lantern, streaks and a shower of sparks
    if (t >= this.tFinal && t < this.tFinal + 0.7) {
      const age = t - this.tFinal;
      const B = mulberry32(999);
      const k = Math.exp(-age * 6);
      for (let i = 0; i < 160; i++) {
        const th = B() * Math.PI * 2, el = (B() - 0.3) * 1.4, len = (20 + B() * 60) * (0.3 + age * 3);
        const d = new THREE.Vector3(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el));
        const g = 7 * k * (0.4 + B());
        X.seg(lan.x, lan.y, lan.z, lan.x + d.x * len, lan.y + d.y * len, lan.z + d.z * len, 0.08 + 0.2 * B(), LIN.bone[0] * g, LIN.bone[1] * g * 0.9, LIN.bone[2] * g * 0.7, 1);
      }
      sparks(X, t, this.tFinal, lan.x, lan.y, lan.z, 4242, { count: 400, speed: 26, life: 0.7, gravity: 20, width: 0.07, gain: 9 });
    }
    // dust motes in the lantern's light
    const D = mulberry32(91);
    for (let i = 0; i < 160; i++) {
      const x0 = (D() - 0.5) * 22, y0 = 1 + D() * 14, z0 = (D() - 0.5) * 30, sp = D() * 6;
      const x = x0 + 0.8 * Math.sin(t * 0.3 + sp), y = y0 + 0.6 * Math.sin(t * 0.21 + sp * 2), z = cz + z0 + 0.8 * Math.cos(t * 0.27 + sp);
      const d2 = (x - lan.x) ** 2 + (y - lan.y) ** 2 + (z - lan.z) ** 2;
      const g = 0.9 * Math.exp(-d2 / 60);
      if (g < 0.03) continue;
      X.seg(x, y, z, x + 0.02, y + 0.06, z, 0.05, LIN.bone[0] * g, LIN.bone[1] * g, LIN.bone[2] * g, 1);
    }
    if (t < this.tFly) return;
    // the collapse: dust pouring from the roof in sheets ahead of the cart
    const crit = prog(t, this.tFly, this.tFly + 0.6);
    const P = mulberry32(13);
    for (let i = 0; i < 420; i++) {
      const x = (P() - 0.5) * 30, z = cz - 4 - P() * 60, per = 0.5 + P() * 0.6, off = P();
      const ph = (t / per + off) % 1;
      const y = TUNNEL_Y + TUNNEL_R - 4 - ph * (TUNNEL_Y + TUNNEL_R - 4);
      const g = 0.35 * crit * (1 - ph) * (0.4 + P());
      X.seg(x, y, z, x, y + 1.6, z, 0.06, LIN.ochre[0] * g, LIN.ochre[1] * g, LIN.ochre[2] * g, 1);
    }
    // grit where the rocks land (the same rocks as paintRocks)
    const Q = mulberry32(88);
    for (let i = 0; i < 60; i++) {
      const t0 = this.tFly + Q() * (this.tFinal - this.tFly + 0.6), x = (Q() - 0.5) * 34, dz = -Q() * 70 + 10, sc = 0.6 + Q() * 1.8;
      const drop = TUNNEL_Y + TUNNEL_R - 4 - sc;
      const tHit = t0 + Math.sqrt((2 * drop) / 90);
      if (t < tHit || t - tHit > 0.9) continue;
      this.grit(X, t - tHit, x, sc * 0.3, this.zAt(t0) + dz, seedOf(i, 5), sc);
    }
    // and the plumes they raise, rolling up and out for a second and a half
    const Q2 = mulberry32(88);
    for (let i = 0; i < 60; i++) {
      const t0 = this.tFly + Q2() * (this.tFinal - this.tFly + 0.6), x = (Q2() - 0.5) * 34, dz = -Q2() * 70 + 10, sc = 0.6 + Q2() * 1.8;
      const drop = TUNNEL_Y + TUNNEL_R - 4 - sc;
      const tHit = t0 + Math.sqrt((2 * drop) / 90);
      const age = t - tHit;
      if (age < 0 || age > 1.6) continue;
      const P2 = mulberry32(seedOf(i, 9));
      const zz = this.zAt(t0) + dz;
      for (let k = 0; k < 26; k++) {
        const th = P2() * Math.PI * 2, sp = 3 + P2() * 5, rise = 2 + P2() * 5;
        const e = 1 - Math.exp(-age * 2.2);
        const px = x + Math.cos(th) * sp * e * sc, pz = zz + Math.sin(th) * sp * e * sc, py = 0.5 + rise * e * sc;
        const g = 0.16 * (1 - age / 1.6) * (0.5 + P2());
        const wdt = (0.8 + 1.5 * e) * sc;
        X.seg(px, py, pz, px + 0.3, py + 0.4, pz, wdt, LIN.ochre[0] * g, LIN.ochre[1] * g, LIN.ochre[2] * g, 1);
      }
    }
  }

  /** A burst of grit and dust at a rock's landing (grey-ochre, heavy, short). */
  grit(X: LineBatch, age: number, x: number, y: number, z: number, seed: number, size: number) {
    const R = mulberry32(seed);
    const n = Math.round(14 + 14 * size);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, el = 0.2 + R() * 1.1, sp = (5 + R() * 9) * (0.6 + size * 0.3);
      const vx = Math.cos(th) * Math.cos(el) * sp, vz = Math.sin(th) * Math.cos(el) * sp, vy = Math.sin(el) * sp;
      const px = x + vx * age, pz = z + vz * age, py = Math.max(0.1, y + vy * age - 0.5 * 40 * age * age);
      const k = 1 - age / 0.9;
      const c = mixRGB(LIN.ash, LIN.ochre, R());
      const g = 0.9 * k * k;
      X.seg(px, py, pz, px - vx * 0.03, py - (vy - 40 * age) * 0.03, pz - vz * 0.03, 0.09, c[0] * g, c[1] * g, c[2] * g, 1);
    }
  }

  /** The staff the cart rides on: five lines along the floor, humming with the bass. */
  drawRails(t: number, cz: number) {
    const L = this.rails; L.clear();
    const hum = Math.max(0, ...this.notes.filter((n) => n.p < 48 && n.t <= t && t - n.t < 0.4).map((n) => Math.exp(-(t - n.t) * 10)));
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 3.4;
      for (let z = cz + 40; z > cz - 200; z -= 4) {
        const a = Math.sin(z * 0.8 + t * 60 + i) * 0.08 * hum;
        L.seg(x + a, 0.96, z, x - a, 0.96, z - 4, 0.12, LIN.ochre[0] * 1.1, LIN.ochre[1] * 1.1, LIN.ochre[2] * 1.1, 1);
      }
    }
  }

  /** Readouts (top right), the metronome (top left), the iteration counter; NaN at the end. */
  drawHud(t: number, kind: Shot['kind'], heat: number) {
    const T = this.hud; T.clear();
    const c = T.ctx;
    const q = this.tempo(t);
    const cur = this.bars.find((b) => t >= b.t && t < b.end) ?? (t < this.bars[0]!.t ? this.bars[0]! : this.bars.at(-1)!);
    // iterations: one per bar; the cut skips sixty of them (the counter rolls through)
    const roll = prog(t, this.tB, this.tB + 0.35, ease.outCubic);
    const iter = t < this.tB ? cur.n - 1 : Math.round(lerp(4, cur.n - 1, roll));
    const fail = t > this.tFinal + 0.08;
    if (kind === 'black' || fail) {
      const a = prog(t, this.tFinal + 0.5, this.tFinal + 0.8) * (1 - prog(t, this.tEndMusic + 0.4, this.tEndMusic + 1.1));
      if (a > 0) {
        c.globalAlpha = a; c.textAlign = 'center';
        // (it was `loss: NaN`, the training-diverged in-joke: too inside for an audience)
        const zh = LANG === 'zh';
        c.font = font(F.mono(500), 64); c.fillStyle = rgba('signal', 1); c.letterSpacing = '6px';
        c.fillText('SYSTEM OVERLOAD', W / 2, H / 2 - (zh ? 24 : 0));
        if (zh) { c.font = font(F.zh(900), 44); c.letterSpacing = '14px'; c.fillText('系统过载', W / 2, H / 2 + 40); }
        c.font = font(F.mono(400), 20); c.fillStyle = rgba('ash', 1); c.letterSpacing = '3px';
        c.fillText(`iter ${String(iter).padStart(4, '0')}  ·  process terminated`, W / 2, H / 2 + (zh ? 100 : 56));
        c.letterSpacing = '0px'; c.globalAlpha = 1;
      }
      return;
    }
    if (kind === 'puppet') { this.drawMetronome(c, t, 150, 330, 0.75, 0.75); return; }
    const big = kind === 'meter';
    if (big) {
      c.fillStyle = 'rgba(4,3,2,0.72)'; c.fillRect(0, 0, W, H);
      this.drawMetronome(c, t, W / 2, H / 2 + 300, 2.3, 1);
    } else this.drawMetronome(c, t, 150, 390, 1, 0.95);
    // the readout block
    const fan = Math.round((1400 + (q - 138) * 85 + heat * 900) / 10) * 10;
    const temp = 41 + (q - 138) * 0.55 + heat * 14 + (t > this.tFly ? prog(t, this.tFly, this.tFinal) * 28 : 0);
    const status = t > this.tFly ? 'CRITICAL' : q > 185 ? 'THROTTLING' : t > this.tB ? 'OVERCLOCK' : 'IDLE';
    const lines: [string, string, boolean][] = [
      ['ITER', String(iter).padStart(4, '0'), false],
      ['TEMPO', `${Math.round(q)} bpm`, false],
      ['CLOCK', `${(q * 0.02).toFixed(2)} GHz`, false],
      ['FAN', `${fan.toLocaleString('en-US')} rpm`, false],
      ['TEMP', `${temp.toFixed(1)} °C`, temp > 90],
      ['STATUS', status, t > this.tFly],
    ];
    const x0 = W - 470, y0 = 120;
    c.textAlign = 'left'; c.font = font(F.mono(500), 19); c.letterSpacing = '2px';
    lines.forEach(([k, v, warn], i) => {
      c.fillStyle = rgba('ash', 0.9); c.fillText(k, x0, y0 + i * 32);
      c.fillStyle = warn && Math.floor(t * 6) % 2 === 0 ? rgba('signal', 1) : rgba('bone', 1);
      c.fillText(v, x0 + 150, y0 + i * 32);
    });
    // the loop itself, typed small under the readout
    c.font = font(F.mono(400), 15); c.fillStyle = rgba('graphite', 1);
    c.fillText('while True:  play(phrase, louder=True, faster=True)', x0, y0 + lines.length * 32 + 18);
    // the iteration count, big, bottom left, ticking over on every bar
    const tick = pulse(t, cur.t, 0.08);
    c.font = font(F.archivo(75, 900), 150 + 14 * tick); c.letterSpacing = '0px';
    c.fillStyle = rgba('bone', 0.9);
    c.fillText(`iter ${String(iter).padStart(2, '0')}`, 110, H - 110);
    c.letterSpacing = '0px';
    void HEX;
  }

  /**
   * The metronome from the Beethoven plates (rise-roll.ts), line-drawn: one swing per beat, so it races
   * with the stretto; at the collapse the pendulum tears off and flies.
   */
  drawMetronome(c: CanvasRenderingContext2D, t: number, x: number, y: number, s: number, a: number) {
    const h = 230;
    c.save(); c.translate(x, y); c.scale(s, s); c.globalAlpha = a;
    c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 2.5; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-70, 0); c.lineTo(-26, -h); c.lineTo(26, -h); c.lineTo(70, 0); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(-80, 0); c.lineTo(80, 0); c.stroke();
    c.lineWidth = 1;
    for (let i = 0; i < 14; i++) { const yy = -40 - i * 12; c.beginPath(); c.moveTo(-8, yy); c.lineTo(8, yy); c.stroke(); }
    const beat = this.ctx.audio.beatAt(Math.min(t, this.tFly));
    const ph = beat - Math.floor(beat);
    const amp = 0.42 + 0.1 * this.heat(t);
    let ang = (Math.floor(beat) % 2 === 0 ? 1 : -1) * Math.cos(ph * Math.PI) * amp;
    const px = 0, py = -30, len = h - 10;
    let ox = 0, oy = 0, spin = 0;
    if (t > this.tFly) {
      // torn off: thrown up and out, spinning
      const age = t - this.tFly;
      ox = 900 * age; oy = -700 * age + 0.5 * 2600 * age * age; spin = age * 14;
    }
    ang += spin;
    c.save(); c.translate(ox, oy);
    const tx = px + Math.sin(ang) * len, ty = py - Math.cos(ang) * len;
    c.strokeStyle = rgba('bone', 1); c.lineWidth = 3;
    c.beginPath(); c.moveTo(px, py); c.lineTo(tx, ty); c.stroke();
    const wx = px + Math.sin(ang) * len * 0.62, wy = py - Math.cos(ang) * len * 0.62;
    c.fillStyle = rgba('ember', 1);
    c.save(); c.translate(wx, wy); c.rotate(ang); c.fillRect(-14, -10, 28, 20); c.restore();
    if (t < this.tFly) {
      const tick = Math.exp(-ph * 14);
      if (tick > 0.05) { c.strokeStyle = rgba('ember', tick); c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, 12 + 30 * (1 - tick), 0, Math.PI * 2); c.stroke(); }
    }
    c.restore();
    // the marking: M.M. quarter = the tempo now
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.95);
    c.fillText('M.M.', -78, 34);
    c.font = font('Bravura', 30); c.fillText(glyph('metNoteQuarterUp'), -10, 36);
    c.font = font(F.mono(500), 17);
    c.fillText(t > this.tFly ? '= ???' : `= ${Math.round(this.tempo(t))}`, 14, 34);
    c.fillText('GRIEG · 1875', -78, 58);
    c.restore();
  }

  /**
   * The shadow-puppet theatre: a paper screen lit from behind by fire; layered cut-paper scenery (far
   * peaks, a hall of stalactite pillars, fainter as they recede), a rank of small trolls far back, the
   * King on an ornate throne, the front rank stamping on the accents, cut-paper flames along the stage
   * edge, embers rising, and an ornate proscenium in front of it all (scalloped arch, filigree, drapes,
   * a tasselled valance). Lines "boil" at 12 drawings a second.
   */
  drawPuppets(t: number, heat: number) {
    const P = this.puppet; P.clear();
    const c = P.ctx;
    const tb = Math.floor(t * 12) / 12; // drawn on twelves
    const flick = 0.8 + 0.2 * noise1(t * 7, 3) + 0.08 * noise1(t * 23, 4);
    const blowAll = Math.max(0, ...this.sfz.map((x) => pulse(t, x, 0.12)));
    // the screen: fire glowing through paper, two flames' worth of light swaying
    const fx0 = W / 2 + 120 * noise1(t * 0.9, 8);
    const g = c.createRadialGradient(fx0, H * 0.98, 40, W / 2, H * 0.68, W * 0.78);
    g.addColorStop(0, `rgba(255,${Math.round(225 + 25 * heat)},${Math.round(150 + 40 * blowAll)},1)`);
    g.addColorStop(0.3, `rgba(255,${Math.round(160 + 50 * flick)},70,1)`);
    g.addColorStop(0.62, `rgba(${Math.round(190 + 40 * flick)},${Math.round(80 + 30 * flick)},30,1)`);
    g.addColorStop(1, 'rgba(36,12,5,1)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    this.glow = g;
    // paper fibres
    c.globalAlpha = 0.07; c.strokeStyle = '#000';
    const R0 = mulberry32(7);
    for (let i = 0; i < 90; i++) { const y = R0() * H; c.lineWidth = 0.5 + R0(); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y + (R0() - 0.5) * 40); c.stroke(); }
    c.globalAlpha = 1;
    // far scenery: peaks, then a colonnade of stalactite pillars (cut paper held further from the screen: softer, paler)
    const layer = (alpha: number, blur: number, draw: () => void) => { c.save(); c.globalAlpha = alpha; c.filter = blur > 0 ? `blur(${blur}px)` : 'none'; c.fillStyle = '#1a0a04'; draw(); c.restore(); };
    layer(0.28, 6, () => {
      c.beginPath(); c.moveTo(0, H * 0.75);
      const R = mulberry32(12);
      for (let x = 0; x <= W + 60; x += 60) c.lineTo(x, H * (0.4 + 0.22 * R()) + 40 * Math.sin(x * 0.004));
      c.lineTo(W, H); c.lineTo(0, H); c.fill();
    });
    layer(0.45, 2.5, () => {
      const R = mulberry32(13);
      for (let i = 0; i < 9; i++) {
        const x = (i + 0.5) / 9 * W + (R() - 0.5) * 60, w = 40 + R() * 40, hh = H * (0.25 + 0.2 * R());
        // a stalactite from the top and a stalagmite from below meeting as a pillar
        c.beginPath(); c.moveTo(x - w, 0); c.lineTo(x + w, 0); c.lineTo(x + w * 0.15, hh); c.lineTo(x - w * 0.1, hh + 30); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(x - w * 1.2, H); c.lineTo(x + w * 1.1, H); c.lineTo(x + w * 0.1, H * 0.62 + R() * 60); c.closePath(); c.fill();
      }
    });
    // who stamps: the last accent, the blows lift the king
    const beat = this.ctx.audio.beatAt(t);
    const stampOf = (i: number) => Math.max(0, ...this.accents.filter((x) => x <= t && t - x < 0.4 && hash(Math.round(x * 100), i) > 0.35).map((x) => pulse(t, x, 0.07)));
    // the far rank: small, paler, marching the other way
    c.save(); c.globalAlpha = 0.6; c.fillStyle = '#20100a';
    const nb = t < this.tB ? 5 : 10;
    for (let i = 0; i < nb; i++) {
      const R = mulberry32(300 + i);
      const march = 1.05 - ((beat * 0.05 * (1 + heat) + i / nb + R() * 0.08) % 1.1);
      const hop = Math.abs(Math.sin(beat * Math.PI + i)) * 8 * (0.5 + heat);
      this.troll(c, march * W, H * 0.74 - hop + 10 * stampOf(i + 20), 210 * (0.8 + 0.3 * R()), 20 + i, tb, stampOf(i + 20), beat);
    }
    c.restore();
    // the King, on his throne at the back
    c.fillStyle = '#0c0805';
    if (t >= this.tB - 0.01) this.king(c, W * 0.5, H * 0.6, 1 + 0.06 * blowAll, tb, blowAll);
    // the front rank
    const n = t < this.tB ? 3 : 7;
    c.fillStyle = '#0c0805';
    for (let i = 0; i < n; i++) {
      const R = mulberry32(100 + i);
      const sc = 0.55 + 0.35 * R();
      const march = ((beat * 0.06 * (1 + heat) + i / n + R() * 0.1) % 1.1) - 0.05;
      const st = stampOf(i);
      const hop = Math.abs(Math.sin(beat * Math.PI)) * 18 * (0.5 + heat);
      this.troll(c, march * W, H * 0.86 - hop + 22 * st, 430 * sc, i, tb, st, beat);
    }
    // footlights: cut-paper flames along the stage edge, licking up on the beat
    c.fillStyle = '#0c0805';
    c.fillRect(0, H * 0.88, W, H * 0.12);
    for (let i = 0; i < 26; i++) {
      const x = (i + 0.5) / 26 * W, hgt = 26 + 30 * (0.5 + 0.5 * Math.sin(t * 9 + i * 2.1)) * (0.6 + heat) + 30 * blowAll;
      c.fillStyle = `rgba(255,${Math.round(200 + 40 * flick)},120,${0.85})`;
      c.beginPath(); c.moveTo(x - 16, H * 0.885);
      c.quadraticCurveTo(x - 14 + 6 * noise1(tb * 5, i), H * 0.885 - hgt * 0.6, x + 4 * noise1(tb * 7, i + 9), H * 0.885 - hgt);
      c.quadraticCurveTo(x + 14, H * 0.885 - hgt * 0.5, x + 16, H * 0.885); c.fill();
    }
    // embers rising from the footlights
    const RE = mulberry32(17);
    for (let i = 0; i < 90; i++) {
      const x0 = RE() * W, per = 1.5 + RE() * 2, ph = (t / per + RE()) % 1;
      const x = x0 + 40 * Math.sin(t * 1.5 + i), y = H * 0.88 - ph * H * 0.7;
      c.fillStyle = `rgba(255,${Math.round(190 + 60 * RE())},120,${(1 - ph) * 0.9})`;
      c.beginPath(); c.arc(x, y, 1.5 + 2.5 * (1 - ph), 0, Math.PI * 2); c.fill();
    }
    this.proscenium(c, tb);
  }

  /** The ornate cut-paper frame: a scalloped pointed arch with pierced filigree, side drapes, a valance with tassels. */
  proscenium(c: CanvasRenderingContext2D, tb: number) {
    c.save();
    c.fillStyle = '#080503';
    const R2 = mulberry32(31 + Math.floor(tb * 12) % 3);
    // the frame: everything outside a scalloped arch
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(W, 0); c.lineTo(W, H); c.lineTo(W * 0.93, H);
    const cx = W / 2, top = H * 0.1, base = H * 0.95, hw = W * 0.43;
    const N = 18;
    for (let k = 0; k <= N; k++) {
      // a pointed (ogee-ish) arch: right side up to the apex, scallops along it
      const u = k / N;
      const ang = (u * Math.PI) / 2;
      const x = cx + hw * Math.cos(ang) * (1 - 0.12 * u * u);
      const y = base - (base - top) * Math.sin(ang) - 30 * u * u * u;
      const nx = cx + hw * Math.cos(ang + Math.PI / 2 / N) * (1 - 0.12 * (u + 1 / N) ** 2);
      const ny = base - (base - top) * Math.sin(ang + Math.PI / 2 / N);
      c.lineTo(x, y);
      if (k < N) c.quadraticCurveTo((x + nx) / 2 + 14 * Math.sin(ang), (y + ny) / 2 + 14 * Math.cos(ang) + (R2() - 0.5) * 2, nx, ny);
    }
    for (let k = N; k >= 0; k--) {
      const u = k / N;
      const ang = (u * Math.PI) / 2;
      const x = cx - hw * Math.cos(ang) * (1 - 0.12 * u * u);
      const y = base - (base - top) * Math.sin(ang) - 30 * u * u * u;
      const px = cx - hw * Math.cos(ang - Math.PI / 2 / N) * (1 - 0.12 * Math.max(0, u - 1 / N) ** 2);
      const py = base - (base - top) * Math.sin(Math.max(0, ang - Math.PI / 2 / N));
      c.lineTo(x, y);
      if (k > 0) c.quadraticCurveTo((x + px) / 2 - 14 * Math.sin(ang), (y + py) / 2 + 14 * Math.cos(ang), px, py);
    }
    c.lineTo(W * 0.07, H); c.lineTo(0, H); c.closePath();
    c.fill();
    // pierced filigree in the frame: rows of quatrefoils and circles (cut out: the fire shows through)
    c.fillStyle = this.glow ?? '#c8642a';
    const hole = (x: number, y: number, r: number) => {
      for (let q = 0; q < 4; q++) { const a = (q / 4) * Math.PI * 2 + Math.PI / 4; c.beginPath(); c.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2); c.fill(); }
    };
    for (let i = 0; i < 9; i++) {
      const y = H * 0.18 + i * H * 0.085;
      hole(W * 0.035, y, 18); hole(W * 0.965, y, 18);
      c.beginPath(); c.arc(W * 0.035, y + H * 0.042, 5, 0, Math.PI * 2); c.arc(W * 0.965, y + H * 0.042, 5, 0, Math.PI * 2); c.fill();
    }
    for (let i = 0; i < 13; i++) { const x = W * (0.2 + i * 0.05); hole(x, H * 0.045, 15); }
    c.fillStyle = '#080503';
    // the drapes: gathered folds hanging inside the arch's sides, tied back
    for (const sd of [-1, 1]) {
      c.beginPath();
      const x0 = sd < 0 ? W * 0.07 : W * 0.93;
      c.moveTo(x0, H * 0.08);
      for (let k = 0; k <= 10; k++) { const y = H * 0.08 + k * H * 0.08; const bulge = (k < 6 ? k / 6 : 1 - (k - 6) / 8) * 110; c.lineTo(x0 - sd * (bulge + 12 * Math.sin(k * 1.9)), y); }
      c.lineTo(x0, H * 0.95); c.closePath(); c.fill();
      // tie-back
      c.beginPath(); c.ellipse(x0 - sd * 70, H * 0.56, 22, 12, 0, 0, Math.PI * 2); c.fill();
    }
    // the valance: a scalloped band with tassels
    c.beginPath(); c.moveTo(W * 0.07, 0); c.lineTo(W * 0.93, 0); c.lineTo(W * 0.93, H * 0.07);
    for (let k = 0; k <= 16; k++) { const x = W * (0.93 - k * 0.86 / 16); c.quadraticCurveTo(x + W * 0.027, H * 0.115, x, H * 0.07); }
    c.lineTo(W * 0.07, 0); c.fill();
    for (let k = 0; k <= 16; k++) {
      const x = W * (0.93 - k * 0.86 / 16), sw = 4 * Math.sin(tb * 3 + k);
      c.fillRect(x - 1.5, H * 0.07, 3, 26);
      c.beginPath(); c.moveTo(x - 8 + sw, H * 0.07 + 46); c.lineTo(x + 8 + sw, H * 0.07 + 46); c.lineTo(x + 3, H * 0.07 + 24); c.lineTo(x - 3, H * 0.07 + 24); c.fill();
    }
    c.restore();
  }

  /** A paper-cut troll: lumpy body, long nose, horns, a club; legs that stamp. Lines boil per drawing. */
  troll(c: CanvasRenderingContext2D, x: number, y: number, h: number, seed: number, tb: number, stamp: number, beat: number) {
    const R = mulberry32(seed * 977 + 3);
    const j = (k: number) => (hash(seed, k, Math.round(tb * 12)) - 0.5) * h * 0.012; // boil
    const bw = h * (0.32 + 0.12 * R()), bh = h * (0.42 + 0.1 * R());
    c.save(); c.translate(x, y);
    const legPh = Math.sin(beat * Math.PI) * (0.3 + stamp * 0.4);
    // legs
    c.beginPath();
    c.moveTo(-bw * 0.3 + j(1), 0); c.lineTo(-bw * 0.35 + legPh * 30, -h * 0.32); c.lineTo(-bw * 0.05, -h * 0.32); c.lineTo(-bw * 0.1 + j(2), 0); c.closePath();
    c.moveTo(bw * 0.1 + j(3), 0); c.lineTo(bw * 0.05 - legPh * 30, -h * 0.32); c.lineTo(bw * 0.35, -h * 0.32); c.lineTo(bw * 0.32 + j(4), 0); c.closePath();
    c.fill();
    // body: a lumpy ellipse
    c.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.06 * Math.sin(a * 7 + seed * 2);
      c.lineTo(Math.cos(a) * bw * 0.5 * r + j(10 + k), -h * 0.32 - bh * 0.5 + Math.sin(a) * bh * 0.5 * r);
    }
    c.fill();
    // head with a long nose and horns
    const hx = bw * 0.1, hy = -h * 0.32 - bh - h * 0.06, hr = h * 0.09;
    c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI * 2); c.fill();
    const dir = seed % 2 ? 1 : -1;
    c.beginPath(); c.moveTo(hx + dir * hr * 0.6, hy - hr * 0.2); c.quadraticCurveTo(hx + dir * hr * 2.6, hy + hr * 0.1 + j(20), hx + dir * hr * 2.3, hy + hr * 0.9); c.lineTo(hx + dir * hr * 0.6, hy + hr * 0.5); c.fill();
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(hx + s * hr * 0.5, hy - hr * 0.7); c.quadraticCurveTo(hx + s * hr * 1.6, hy - hr * 1.6, hx + s * hr * 1.2 + j(30 + s), hy - hr * 2.4); c.lineTo(hx + s * hr * 0.9, hy - hr * 0.6); c.fill(); }
    // an arm with a club, swung down on the stamp
    const arm = -0.9 + stamp * 1.6 + 0.2 * Math.sin(beat * Math.PI * 0.5 + seed);
    c.save(); c.translate(-dir * bw * 0.4, -h * 0.32 - bh * 0.75); c.rotate(-dir * arm);
    c.fillRect(-h * 0.02, -h * 0.3, h * 0.04, h * 0.3);
    c.beginPath(); c.ellipse(0, -h * 0.34, h * 0.05, h * 0.09, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    c.restore();
  }

  /** The Mountain King: big, crowned, on an ornate rock throne; the club comes up with each blow. */
  king(c: CanvasRenderingContext2D, x: number, y: number, s: number, tb: number, blow: number) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = '#0c0805';
    // the throne (cut from thinner paper, further from the screen: paler than the King): a tall back with
    // three pointed spires and finials, armrests with scrolls, a stepped dais
    c.fillStyle = 'rgb(70,30,12)';
    c.beginPath(); c.moveTo(-330, 300); c.lineTo(-300, 250); c.lineTo(300, 250); c.lineTo(330, 300); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-270, 250); c.lineTo(-250, 200); c.lineTo(250, 200); c.lineTo(270, 250); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(-230, 200); c.lineTo(-230, -260); c.lineTo(-200, -330); c.lineTo(-170, -260);
    c.lineTo(-90, -360); c.lineTo(0, -560); c.lineTo(90, -360);
    c.lineTo(170, -260); c.lineTo(200, -330); c.lineTo(230, -260); c.lineTo(230, 200); c.closePath(); c.fill();
    for (const fx of [-200, 0, 200]) { const fy = fx === 0 ? -560 : -330; c.beginPath(); c.arc(fx, fy - 14, 13, 0, Math.PI * 2); c.fill(); }
    // armrests with scrolls
    for (const sd of [-1, 1]) {
      c.beginPath(); c.moveTo(sd * 230, 60); c.lineTo(sd * 300, 40); c.lineTo(sd * 300, 200); c.lineTo(sd * 230, 200); c.fill();
      c.beginPath(); c.arc(sd * 300, 30, 26, 0, Math.PI * 2); c.fill();
    }
    // pierced ornament in the throne's back (the fire shows through): a rose and pointed windows
    c.save(); c.fillStyle = 'rgb(236,150,62)';
    c.beginPath(); c.arc(0, -455, 30, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.beginPath(); c.arc(Math.cos(a) * 46, -455 + Math.sin(a) * 46, 9, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgb(236,150,62)';
    for (const wx of [-170, 170]) { c.beginPath(); c.moveTo(wx - 20, -100); c.lineTo(wx - 20, -190); c.lineTo(wx, -225); c.lineTo(wx + 20, -190); c.lineTo(wx + 20, -100); c.fill(); }
    c.restore();
    c.fillStyle = '#0c0805';
    // body in a cloak
    c.beginPath(); c.moveTo(-170, 210); c.quadraticCurveTo(-190, -80, -60, -170); c.lineTo(60, -170); c.quadraticCurveTo(190, -80, 170, 210); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(0, -60, 150, 170, 0, 0, Math.PI * 2); c.fill();
    // head, nose, ears
    c.beginPath(); c.arc(10, -270, 70, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(60, -280); c.quadraticCurveTo(170, -250, 150, -190); c.lineTo(60, -230); c.fill();
    c.beginPath(); c.moveTo(-58, -290); c.lineTo(-110, -330); c.lineTo(-62, -260); c.fill();
    // the crown: a band with points, each tipped with a ball; gems pierced through the band
    c.beginPath(); c.moveTo(-72, -315); c.lineTo(80, -315); c.lineTo(80, -345); c.lineTo(-72, -345); c.fill();
    for (let k = 0; k < 7; k++) {
      const x0 = -72 + k * (152 / 6);
      const tip = -420 - (k % 2) * 26 - (hash(k, Math.round(tb * 12)) - 0.5) * 6;
      c.beginPath(); c.moveTo(x0 - 11, -343); c.lineTo(x0, tip); c.lineTo(x0 + 11, -343); c.fill();
      c.beginPath(); c.arc(x0, tip - 8, 8, 0, Math.PI * 2); c.fill();
    }
    c.save(); c.fillStyle = 'rgb(255,190,90)';
    for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(-50 + k * 26, -330, 6, 8, 0, 0, Math.PI * 2); c.fill(); }
    c.restore();
    c.fillStyle = '#0c0805';
    // the club arm
    c.save(); c.translate(-130, -150); c.rotate(-0.4 - 1.5 * blow);
    c.fillRect(-12, -200, 24, 200); c.beginPath(); c.ellipse(0, -230, 34, 60, 0, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 5; k++) { c.beginPath(); c.moveTo(-30, -200 - k * 14); c.lineTo(-52, -206 - k * 14); c.lineTo(-30, -214 - k * 14); c.fill(); }
    c.restore();
    c.restore();
  }

  /** After the last chord: dust drifting down through a last shaft of light, then nothing. */
  drawDust(t: number) {
    const D = this.dust; D.clear();
    const age = t - this.tFinal;
    const a = prog(age, 0.3, 1.0) * (1 - prog(t, this.tEndMusic + 0.6, this.ctx.end - 0.1));
    if (a <= 0) return;
    const R = mulberry32(5);
    for (let i = 0; i < 700; i++) {
      const x0 = W * (0.3 + 0.4 * R()), y0 = R() * H, sp = 20 + 60 * R(), sz = 1 + 2.5 * R();
      const y = (y0 + age * sp) % H, x = x0 + 30 * Math.sin(age * 0.7 + i);
      const lit = Math.exp(-((x - W / 2) ** 2) / (2 * 260 ** 2));
      const g = 0.5 * a * lit * (0.5 + R());
      D.seg2(x, y, x + 0.5, y + sz, sz, [LIN.ochre[0] * g, LIN.ochre[1] * g, LIN.ochre[2] * g], 1);
    }
  }
}
