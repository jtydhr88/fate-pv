// Bars 22-24, the knock again (ff), on a concert grand's keyboard. The orchestra plays A-flat, A-flat,
// A-flat, F in five octaves at once: five keys slam on every note. Each A-flat is also a full-frame
// typographic slam (the pdoom hook's idiom); on the long F the camera is overhead the whole 88 keys,
// the five Fs held down and burning, labelled like specimens, while a red fermata settles over them.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { pitchName, type Note } from '../engine/score';
import { glyph } from '../engine/music';
import { ease, lerp, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void, glyphMesh, noteMaterial, sparks, seedOf } from './_kit';
import { Keyboard, keyX, KEYBOARD_W, KEY, roomEnv } from './_piano';

export default class Keys extends Scene {
  st = new Stage3D();
  bg = new Void();
  kb = new Keyboard();
  fx = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  text = new Layer2D();
  notes: Note[] = [];
  hits: number[] = [];
  tLong = 0; fermEnd = 0;
  fermata!: THREE.Mesh;
  longPitches: number[] = [];

  override async init() {
    const sc = this.ctx.score;
    this.notes = sc.notesIn(this.ctx.start, this.ctx.end);
    const m = sc.motifs.find((x) => x.t[0] >= this.ctx.start)!;
    this.hits = m.t.slice(0, 3);
    this.tLong = m.t[3];
    this.fermEnd = sc.fermatas.find((f) => f.t >= this.ctx.start)!.end;
    this.longPitches = [...new Set(this.notes.filter((n) => Math.abs(n.t - this.tLong) < 0.01).map((n) => n.p))].sort((a, b) => a - b);
    const S = this.st.scene;
    S.add(this.kb.group);
    S.environment = roomEnv(this.ctx.renderer);
    S.environmentIntensity = 0.35;
    this.st.key.position.set(-30, 80, 60);
    this.fermata = glyphMesh('fermataAbove', 0.5, noteMaterial(LIN.signal));
    this.fermata.scale.setScalar(10);
    this.fermata.rotation.x = -Math.PI / 2; // lying over the keys, readable from above
    S.add(this.fermata);
  }

  camera(t: number) {
    let eye: THREE.Vector3, at: THREE.Vector3, roll = 0, fov = 30;
    const hit = Math.max(...this.hits.map((h) => pulse(t, h, 0.08)));
    if (t < this.tLong - 0.01) {
      // keyboard level from the treble end, looking down the keys into the bass; thrown back on each hit
      const k = prog(t, this.ctx.start, this.tLong, ease.inOutQuad);
      eye = new THREE.Vector3(KEYBOARD_W + lerp(14, 8, k), lerp(5, 3.5, k) + hit * 0.8, lerp(14, 11, k) + hit * 2);
      at = new THREE.Vector3(KEYBOARD_W * 0.45, -1, -6);
      roll = lerp(-0.18, -0.1, k);
      fov = 32;
    } else {
      // overhead, the whole keyboard; turning slowly and settling in over the middle F
      const k = prog(t, this.tLong, this.fermEnd, ease.inOutCubic);
      const cx = lerp(KEYBOARD_W / 2, keyX(65), k);
      eye = new THREE.Vector3(cx, lerp(150, 70, k), lerp(38, 42, k));
      at = new THREE.Vector3(cx, 0, -6);
      roll = lerp(0.05, -0.08, k);
      fov = 34;
    }
    eye.x += noise1(t * 0.6, 3) * 0.3;
    this.st.look(eye, at, roll, fov);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    if (t >= this.fermEnd) { this.bg.render(renderer, out, t); this.text.clear(); comp.draw(renderer, this.text.upload(), out); return { grain: 0.06 }; }
    this.camera(t);
    const strike = this.kb.play(t, this.notes, { glow: 1.4, hold: 0.9 });
    const hit = Math.max(...this.hits.map((h) => pulse(t, h, 0.08)), pulse(t, this.tLong, 0.12));
    this.st.key.intensity = (t < this.tLong ? 1.4 : 0.7) + 1.5 * hit;
    this.st.rim.intensity = 4 + 14 * hit;
    // the fermata drops onto the keys over the middle F and burns
    this.fermata.visible = t >= this.tLong + 0.1;
    const fu = prog(t, this.tLong + 0.1, this.tLong + 0.6, ease.outExpo);
    this.fermata.position.set(keyX(65) - 12, lerp(60, 7, fu), -4);
    (this.fermata.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + 3 * pulse(t, this.tLong + 0.6, 0.3);
    this.bg.render(renderer, out, t, 0.2 * hit, 0);
    this.st.render(renderer, out);

    const X = this.fx; X.clear();
    // a light rail along the key fronts, pulsing out from the struck keys
    for (const h of [...this.hits, this.tLong]) {
      const age = t - h;
      if (age < 0 || age > 1.2) continue;
      for (const n of this.notes.filter((x) => Math.abs(x.t - h) < 0.005)) {
        const x0 = keyX(n.p), w = age * 160, g = 4 * Math.exp(-age * 4);
        X.seg(x0 - w, 0.15, 0.4, x0 + w, 0.15, 0.4, 0.12, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 1);
        sparks(X, t, h, x0, 0.5, 0.5, seedOf(h, n.p), { count: 40, speed: 22, life: 0.8, gravity: 40, width: 0.12, gain: 6 });
      }
    }
    X.render(renderer, out, this.st.cam);

    this.drawText(t);
    comp.draw(renderer, this.text.upload(), out);
    const sh = 18 * hit + 2 * strike;
    return {
      bloom: 0.95, bloomThreshold: 1.1, halation: 0.3, grain: 0.065, vignette: 0.5,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], zoom: 1 + 0.04 * hit, ca: 1.2 + 4 * hit,
    };
  }

  drawText(t: number) {
    const T = this.text; T.clear();
    const c = T.ctx;
    // the slams: one full-frame A♭ per note, each set differently, gone by the next
    this.hits.forEach((h, i) => {
      const age = t - h;
      const next = this.hits[i + 1] ?? this.tLong;
      if (age < 0 || t >= next) return;
      const k = Math.exp(-age * 9);
      c.save();
      c.textBaseline = 'alphabetic';
      c.textAlign = 'center';
      const size = [620, 760, 900][i]!;
      // the letter in Archivo, the flat from the music font (Archivo has no ♭)
      const sz = size * (1 + 0.08 * k);
      c.font = font(F.archivo([62, 100, 125][i]!, 900), sz);
      const wA = c.measureText('A').width;
      const x0 = W * [0.3, 0.5, 0.66][i]! - (wA + sz * 0.32) / 2, base = H * 0.5 + size * 0.36;
      c.textAlign = 'left';
      c.fillStyle = i === 2 ? rgba('signal', 0.95) : rgba('bone', 0.92);
      c.fillText('A', x0, base);
      c.font = font('Bravura', sz * 0.62);
      c.fillText(glyph('accidentalFlat'), x0 + wA + sz * 0.03, base - sz * 0.42);
      c.restore();
    });
    if (t < this.tLong) return;
    // the held Fs, labelled like specimens: leader lines from the keys to mono tags
    const cam = this.st.cam;
    const a = prog(t, this.tLong + 0.35, this.tLong + 0.7);
    c.save();
    c.globalAlpha = a;
    c.font = font(F.mono(500), 24);
    c.letterSpacing = '2px';
    c.textAlign = 'center';
    this.longPitches.forEach((p, i) => {
      const v = new THREE.Vector3(keyX(p), 0.5, 0.5).project(cam);
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H;
      const ty = y + 110 + (i % 2) * 40;
      c.strokeStyle = rgba('signal', 0.8); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x, y + 8); c.lineTo(x, ty - 22); c.stroke();
      c.fillStyle = rgba('bone', 0.9);
      c.fillText(pitchName(p), x, ty);
    });
    c.textAlign = 'left';
    c.font = font(F.mono(400), 19);
    c.fillStyle = rgba('ash', 0.85);
    c.fillText(`F × ${this.longPitches.length} OCTAVES · ff · HELD ${(this.fermEnd - this.tLong).toFixed(2)} s UNDER THE FERMATA · m. 23–24`, 72, H - 72);
    c.restore();
    void KEY;
  }
}
