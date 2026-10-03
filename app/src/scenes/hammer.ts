// Bars 1-2, inside the piano. "Thus Fate knocks": the first four notes are four strikes of felt
// hammers on steel strings, in macro. The orchestra plays the motif in octaves, so the G hammers of
// three octaves fly together. On the long E-flat the camera cuts down the length of the strings: they
// glow and ring into the dark while the dampers are up, under the fermata; the caesura is black.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse } from '../engine/util';
import { Stage3D, Void, sparks, seedOf, mixRGB } from './_kit';
import { Action, roomEnv } from './_piano';
import type { Note } from '../engine/score';
import { styled } from '../engine/style';
import { Layer2D, W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { LANG, TEXT, TITLE } from './opening-text';

/** Spruce: pale wood, fine straight grain (a little darker every few years), and a few ribs. */
function spruceTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#C9A46E'; g.fillRect(0, 0, 512, 1024);
  const R = mulberry32(5);
  for (let x = 0; x < 512; x += 2 + R() * 5) {
    g.fillStyle = `rgba(110,72,36,${0.08 + R() * 0.18})`;
    g.fillRect(x, 0, 1 + R() * 2, 1024);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}

const LO = 36, HI = 67; // up to G4: the hammer nearest the camera is the motif's top note
const STRING_LEN = 140; // cm of string drawn behind the strike point

export default class Hammer extends Scene {
  st = new Stage3D();
  bg = new Void();
  action = new Action(LO, HI);
  strings = new LineBatch(40000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  fx = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  notes: Note[] = [];
  tLong = 0; fermEnd = 0; gapEnd = 0;
  /** the title, one word per note of the knock */
  title = new Layer2D();
  knock: number[] = [];

  override async init() {
    const sc = this.ctx.score;
    this.notes = sc.notesIn(0, this.ctx.end).filter((n) => n.p >= LO && n.p <= HI);
    const m = sc.motifs[0]!;
    this.tLong = m.t[3];
    const f = sc.fermatas.find((x) => x.bar === 2)!;
    this.fermEnd = f.end; this.gapEnd = f.end + f.gap;
    this.st.scene.add(this.action.group);
    const wood = styled({ color: new THREE.Color().setStyle('#4a3020', THREE.SRGBColorSpace), roughness: 0.5, clearcoat: 0.5 });
    const W = (HI - LO + 2) * this.action.pitchW;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(W, 1.2, 1.6), wood);
    bridge.position.set(W / 2 - this.action.pitchW, -0.7, 3 - STRING_LEN);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W, 0.5, 0.7), styled({ color: new THREE.Color(0x1a1a1c), roughness: 0.35, metalness: 0.6 }));
    rail.position.set(W / 2 - this.action.pitchW, 0.45, 3.4);
    this.st.scene.add(bridge, rail);
    // the soundboard under the strings: pale spruce with its grain running along the strings
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(W + 30, STRING_LEN + 30), styled({ color: new THREE.Color(0xffffff), map: spruceTexture(), roughness: 0.6 }));
    sb.rotation.x = -Math.PI / 2;
    sb.position.set(W / 2 - this.action.pitchW, -7.5, 3 - STRING_LEN / 2 - 10);
    this.st.scene.add(sb);
    this.st.scene.environment = roomEnv(this.ctx.renderer);
    this.st.scene.environmentIntensity = 0.18;
    this.st.key.position.set(-10, 30, 18);
    this.st.cam.near = 0.2;
  }

  xOf(p: number) { return (p - LO) * this.action.pitchW; }

  camera(t: number) {
    const g4 = this.xOf(67), eb = this.xOf(63);
    let eye: THREE.Vector3, at: THREE.Vector3, roll = 0, fov = 34;
    if (t < this.tLong - 0.02) {
      // in profile from beyond the end of the row: the G4 hammer large in front, the row receding behind it
      const k = prog(t, 0, this.tLong, ease.inOutQuad);
      eye = new THREE.Vector3(g4 + lerp(9, 7.5, k), lerp(-1.6, -1.2, k), lerp(4.5, 3.5, k));
      at = new THREE.Vector3(g4 - 6, -1.6, -1.2);
      roll = -0.04;
      fov = 34;
    } else {
      // down the strings: low between the unisons, looking along them into the dark, drifting with the ring
      const k = prog(t, this.tLong, this.fermEnd, ease.inOutCubic);
      // above the strike point: hammers in front, the struck strings burning and shivering, dampers lifted behind
      eye = new THREE.Vector3(eb + lerp(7, 3.5, k), lerp(10, 5.5, k), lerp(13, 6.5, k));
      at = new THREE.Vector3(eb - lerp(1.5, 0.5, k), lerp(-1.2, -0.6, k), lerp(-12, -8, k));
      roll = lerp(0.1, -0.03, k);
      fov = lerp(40, 34, k);
    }
    const hit = Math.max(...this.notes.map((n) => pulse(t, n.t, 0.07)), 0);
    eye.y += hit * 0.18 * noise1(t * 60, 4);
    eye.x += noise1(t * 0.7, 11) * 0.05;
    this.st.look(eye, at, roll, fov);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    this.outRT = out;
    const t = f.t;
    if (t >= this.fermEnd) { this.bg.render(renderer, out, t); return { grain: 0.06 }; }
    this.camera(t);
    const energy = this.action.play(t, this.notes);
    let hit = 0;
    for (const v of energy.values()) hit = Math.max(hit, v.hit);
    this.st.key.intensity = 1.5 + 1.2 * hit;
    this.st.rim.intensity = 3 + 10 * hit;
    this.bg.render(renderer, out, t, 0.25 * hit, 0);
    this.st.render(renderer, out);

    // the strings: triple unisons, steel; a struck string glows and vibrates along its length
    const L = this.strings; L.clear();
    const steel = LIN.graphite; // dark steel over the pale soundboard
    for (const u of this.action.unisons) {
      const en = energy.get(u.p)!;
      const e = en.e;
      for (let s = 0; s < u.strings; s++) {
        const x = u.x + (s - (u.strings - 1) / 2) * 0.22;
        const N = e > 0.01 ? 60 : 1;
        let prev: [number, number, number] | null = null;
        for (let i = 0; i <= N; i++) {
          const z = 3 - (STRING_LEN * i) / N;
          const along = i / N;
          // the fundamental and a couple of partials; fast enough that the export's motion blur turns it into a soft envelope
          const y = e * 0.35 * Math.sin(Math.PI * along) * Math.sin(t * 95 + s) + e * 0.12 * Math.sin(2 * Math.PI * along) * Math.sin(t * 190 + 1.3 * s);
          const glow = e * (2.2 + 3 * en.hit) * (0.35 + 0.65 * Math.exp(-along * 2.5));
          const dx = e * 0.3 * Math.sin(Math.PI * along) * Math.sin(t * 83 + 2.1 * s);
          const c = mixRGB(steel, LIN.signal, clamp(e * 1.5));
          const k = 0.35 + glow;
          if (prev) L.seg(prev[0], prev[1], prev[2], x + dx, y, z, 0.07, c[0] * k, c[1] * k, c[2] * k, 1);
          prev = [x + dx, y, z];
        }
        if (N === 1) L.seg(x, 0, 3, x, 0, 3 - STRING_LEN, 0.07, steel[0] * 0.35, steel[1] * 0.35, steel[2] * 0.35, 1);
      }
    }
    L.render(renderer, out, this.st.cam);
    const X = this.fx; X.clear();
    for (const n of this.notes) {
      sparks(X, t, n.t, this.xOf(n.p), 0.1, 0, seedOf(n.t, n.p), { count: n.t >= this.tLong - 0.01 ? 70 : 28, speed: 7, life: 0.6, gravity: 30, width: 0.05, gain: 5 });
    }
    X.render(renderer, out, this.st.cam);
    this.drawTitle(t);
    const sh = 7 * hit;
    return {
      bloom: 0.9, bloomThreshold: 1.1, halation: 0.25, grain: 0.06, vignette: 0.55,
      shake: [noise1(t * 40, 1) * sh, noise1(t * 40, 2) * sh], ca: 1.2 + 2.5 * hit,
      fade: 1 - prog(t, 0, 0.12),
    };
  }

  /**
   * The title, stamped by the knock: three short words on the three Gs, the long one (fate, in the
   * motif's red) on the E-flat, held under the fermata and gone before the caesura.
   */
  drawTitle(t: number) {
    if (!this.knock.length) this.knock = [...new Set(this.notes.map((n) => +n.t.toFixed(3)))].sort((a, b) => a - b).slice(0, 4);
    const words = TEXT[LANG].title, zh = LANG === 'zh';
    const T = this.title; T.clear();
    const c = T.ctx;
    const out = 1 - prog(t, this.fermEnd - 0.45, this.fermEnd - 0.05);
    if (t < this.knock[0]! - 0.01 || out <= 0) return;
    const fnt = (i: number) => TITLE.font(i, zh, font, F);
    // lay the line out once: the words sit on one baseline, centred as a whole (the opening shows the same line)
    const gap = TITLE.gap(zh);
    const widths = words.map((w, i) => { c.font = fnt(i); c.letterSpacing = TITLE.spacing(zh); return c.measureText(w).width; });
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * 3) / 2;
    const y = H / 2 + TITLE.dy;
    // a band of shadow under the line: the soundboard is pale, the words have to stand off it
    const band = prog(t, this.knock[0]! - 0.01, this.knock[0]! + 0.08) * out;
    const g = c.createLinearGradient(0, y - 230, 0, y + 110);
    g.addColorStop(0, 'rgba(6,7,9,0)'); g.addColorStop(0.35, 'rgba(6,7,9,0.72)'); g.addColorStop(0.75, 'rgba(6,7,9,0.72)'); g.addColorStop(1, 'rgba(6,7,9,0)');
    c.globalAlpha = band; c.fillStyle = g; c.fillRect(0, y - 230, W, 340);
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 24;
    c.textAlign = 'left';
    words.forEach((w, i) => {
      const at = this.knock[i]!;
      const k = prog(t, at - 0.005, at + 0.07, ease.outCubic);
      if (k > 0) {
        c.save();
        c.font = fnt(i); c.letterSpacing = zh ? '6px' : '0px';
        const sc = 1 + 0.35 * (1 - k); // slammed down onto the line
        c.translate(x + widths[i]! / 2, y); c.scale(sc, sc); c.translate(-widths[i]! / 2, 0);
        c.globalAlpha = k * out;
        c.fillStyle = i === 3 ? rgba('signal', 1) : rgba('bone', 1);
        c.fillText(w, 0, 0);
        c.restore();
      }
      x += widths[i]! + gap;
    });
    c.shadowBlur = 0;
    this.ctx.comp.draw(this.ctx.renderer, T.upload(), this.outRT!);
  }
  outRT: THREE.WebGLRenderTarget | null = null;
}
