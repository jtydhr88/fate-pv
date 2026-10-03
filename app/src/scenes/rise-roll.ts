// `rise`, bars 25-43: the player-piano roll. The orchestra's notes are perforations in a paper roll
// running towards an 88-key keyboard like a runway; each slot lights as it crosses the tracker bar and
// its key goes down at that instant. The roll carries what real rolls carried: a printed leader, and
// an expression line (the dynamics, drawn along the margin). A line-drawn metronome ticks every bar
// (M.M. half = 108, Beethoven's own mark); the sforzandi of bars 38-43 jolt the whole machine.
import * as THREE from 'three';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, HEX, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Note, Score } from '../engine/score';
import { clamp, ease, lerp, noise1, prog, pulse } from '../engine/util';
import { Stage3D, sparks, seedOf } from './_kit';
import { Keyboard, keyX, KEYBOARD_W, LOW, HIGH, roomEnv } from './_piano';
import { styled } from '../engine/style';
import { glyph } from '../engine/music';

const SPEED = 14; // cm of roll per second
const LEN = 700; // cm of roll laid out (the far end fades into the dark)
const TRACK_Z = -19; // the tracker bar, just behind the fallboard
const ROLL_Y = 8.5;
const TEX_W = 1024, TEX_H = 4096;

export class Roll {
  st = new Stage3D();
  kb = new Keyboard();
  canvas = document.createElement('canvas');
  tex: THREE.CanvasTexture;
  paper: THREE.Mesh;
  fx = new LineBatch(20000, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  overlay = new Layer2D();
  notes: Note[];

  constructor(private score: Score, renderer: THREE.WebGLRenderer, public t0: number, public t1: number, public sfz: number[]) {
    // the orchestra folded onto the 88 keys (the basses sound an octave down already)
    this.notes = score.notesIn(t0 - 0.01, t1 + 20).filter((n) => n.p >= LOW && n.p <= HIGH);
    this.canvas.width = TEX_W; this.canvas.height = TEX_H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const W0 = KEYBOARD_W + 8;
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(W0, LEN), styled({ color: new THREE.Color(0xffffff), map: this.tex, roughness: 0.8 }));
    this.paper.rotation.x = -Math.PI / 2;
    this.paper.position.set(KEYBOARD_W / 2, ROLL_Y, TRACK_Z - LEN / 2);
    const S = this.st.scene;
    S.add(this.kb.group, this.paper);
    // the tracker bar: brass, across the roll at the reading line
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W0 + 4, 1.2, 2.2), styled({ color: new THREE.Color().setStyle('#9c7a3c', THREE.SRGBColorSpace), roughness: 0.3, metalness: 0.8 }));
    bar.position.set(KEYBOARD_W / 2, ROLL_Y + 0.4, TRACK_Z + 1.2);
    S.add(bar);
    S.environment = roomEnv(renderer);
    S.environmentIntensity = 0.3;
    this.st.key.position.set(-20, 90, 70);
    // the roll fades into the dark (painted into the paper), so no silhouette line along its edges
    if (this.st.outline) this.st.outline.rimAlpha = 0;
  }

  /** Paint the roll as it is in view at t: slots for every note ahead of the tracker. */
  paint(t: number) {
    const c = this.canvas.getContext('2d')!;
    const sx = TEX_W / (KEYBOARD_W + 8), sy = TEX_H / LEN;
    c.fillStyle = '#E6DCC5'; c.fillRect(0, 0, TEX_W, TEX_H);
    // texture y = 0 is the far end; the tracker sits at the bottom edge
    const zOf = (tt: number) => TEX_H - (tt - t) * SPEED * sy;
    // paper fibre and the column guides of a real roll
    c.fillStyle = 'rgba(120,100,70,0.06)';
    for (let p = LOW; p <= HIGH; p++) c.fillRect((keyX(p) + 4) * sx - 0.5, 0, 1, TEX_H);
    // the leader: title block printed at the roll's start
    const yl = zOf(this.t0 - 0.6);
    if (yl > -200 && yl < TEX_H + 200) {
      c.fillStyle = '#2a2622';
      c.font = font(F.serif(600, true), 60);
      c.textAlign = 'center';
      c.fillText('Symphonie Nr. 5', TEX_W / 2, yl - 120);
      c.font = font(F.mono(500), 26);
      c.fillText('FATE ROLL No. 67 · FOR 88 NOTES · ALLEGRO CON BRIO', TEX_W / 2, yl - 70);
      c.fillRect(80, yl - 40, TEX_W - 160, 3);
    }
    // the expression line along the left margin: the dynamics as a pen line
    c.strokeStyle = HEX.signal; c.lineWidth = 3; c.beginPath();
    for (let y = 0; y <= TEX_H; y += 16) {
      const tt = t + (TEX_H - y) / sy / SPEED;
      const v = this.score.sounding(tt, 3).reduce((m, n) => Math.max(m, n.v), 0) / 127;
      const x = 18 + v * 46;
      if (y === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    // perforations
    for (const n of this.notes) {
      const y1 = zOf(n.t), y0 = zOf(n.t + n.d);
      if (y1 < -10 || y0 > TEX_H + 10) continue;
      const x = (keyX(n.p) + 4) * sx;
      const passed = n.t <= t;
      c.fillStyle = passed ? '#2b0f0a' : '#1b1814';
      c.fillRect(x - 5, Math.max(-10, y0), 10, Math.min(TEX_H + 10, y1) - Math.max(-10, y0));
    }
    // the far end of the roll falls into the dark
    const fade = c.createLinearGradient(0, TEX_H * 0.45, 0, TEX_H * 0.8);
    fade.addColorStop(0, 'rgba(8,8,10,1)'); fade.addColorStop(0.5, 'rgba(8,8,10,0.6)'); fade.addColorStop(1, 'rgba(8,8,10,0)');
    c.fillStyle = fade; c.fillRect(0, 0, TEX_W, TEX_H * 0.8);
    c.fillStyle = 'rgb(8,8,10)'; c.fillRect(0, 0, TEX_W, TEX_H * 0.45);
    this.tex.needsUpdate = true;
  }

  /** Render the roll plate into out; returns hit (for post). */
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, t: number, barPos: number, comp: { draw: (r: THREE.WebGLRenderer, tex: THREE.Texture, out: THREE.WebGLRenderTarget) => void }) {
    const sf = Math.max(0, ...this.sfz.map((s) => pulse(t, s, 0.15)));
    const k = prog(t, this.t0, this.t1, ease.inOutQuad);
    // the camera: behind the player's head, looking down the roll; rising and pulling back with the crescendo
    const eye = new THREE.Vector3(KEYBOARD_W * lerp(0.42, 0.55, k) + noise1(t * 0.4, 2) * 2, lerp(34, 60, k) + 6 * sf, lerp(46, 70, k) + 8 * sf);
    const at = new THREE.Vector3(KEYBOARD_W * lerp(0.48, 0.5, k), 4, lerp(-40, -60, k));
    this.st.look(eye, at, lerp(-0.04, 0.03, k) + 0.05 * sf * Math.sin(t * 40), lerp(46, 52, k));
    this.paint(t);
    const strike = this.kb.play(t, this.notes, { glow: 1.2, hold: 0.7 });
    this.st.key.intensity = 1.5 + 0.8 * strike * 0.1 + 1.5 * sf;
    clearDepthAndRender(renderer, out, this.st);
    // light through the holes at the tracker, and sparks on the sforzandi
    const X = this.fx; X.clear();
    for (const n of this.notes) {
      if (t < n.t || t > n.t + n.d) continue;
      const g = (1.5 + 4 * pulse(t, n.t, 0.08)) * (0.4 + n.v / 127);
      const x = keyX(n.p);
      X.seg(x, ROLL_Y + 0.15, TRACK_Z, x, ROLL_Y + 0.15, TRACK_Z - Math.min(6, n.d * SPEED), 0.9, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 1);
    }
    this.sfz.forEach((s, i) => sparks(X, t, s, KEYBOARD_W * (0.3 + 0.08 * i), ROLL_Y + 1, TRACK_Z + 1, seedOf(s, i), { count: 90, speed: 30, life: 1.0, width: 0.25, gain: 7 }));
    X.render(renderer, out, this.st.cam);
    this.drawOverlay(t, barPos, sf);
    comp.draw(renderer, this.overlay.upload(), out);
    return { sf, strike };
  }

  /** The metronome, line-drawn, top left: it ticks on every barline (one swing per bar). */
  drawOverlay(t: number, barPos: number, sf: number) {
    const L = this.overlay; L.clear();
    const c = L.ctx;
    const x = 150, y = 360, h = 230;
    c.save();
    c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 2.5; c.lineJoin = 'round';
    // the case: a truncated pyramid
    c.beginPath(); c.moveTo(x - 70, y); c.lineTo(x - 26, y - h); c.lineTo(x + 26, y - h); c.lineTo(x + 70, y); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(x - 80, y); c.lineTo(x + 80, y); c.stroke();
    // the scale
    c.lineWidth = 1;
    for (let i = 0; i < 14; i++) { const yy = y - 40 - i * 12; c.beginPath(); c.moveTo(x - 8, yy); c.lineTo(x + 8, yy); c.stroke(); }
    // the pendulum: extremes on the barlines, a sforzando kicks it
    const ph = barPos - Math.floor(barPos);
    const ang = (Math.floor(barPos) % 2 === 0 ? 1 : -1) * Math.cos(ph * Math.PI) * 0.42 * (1 + 0.35 * sf);
    const px = x, py = y - 30, len = h - 10;
    const tx = px + Math.sin(ang) * len, ty = py - Math.cos(ang) * len;
    c.strokeStyle = rgba('bone', 1); c.lineWidth = 3;
    c.beginPath(); c.moveTo(px, py); c.lineTo(tx, ty); c.stroke();
    // the weight
    const wx = px + Math.sin(ang) * len * 0.62, wy = py - Math.cos(ang) * len * 0.62;
    c.fillStyle = rgba('signal', 1);
    c.save(); c.translate(wx, wy); c.rotate(ang); c.fillRect(-14, -10, 28, 20); c.restore();
    // the tick: a flash at the extreme
    const tick = Math.exp(-ph * 14);
    if (tick > 0.05) { c.strokeStyle = rgba('signal', tick); c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, 12 + 30 * (1 - tick), 0, Math.PI * 2); c.stroke(); }
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.9);
    c.fillText('M.M.', x - 78, y + 34);
    c.font = font('Bravura', 30); c.fillText(glyph('metNoteHalfUp'), x - 10, y + 36);
    c.font = font(F.mono(500), 17); c.fillText('= 108', x + 14, y + 34);
    c.fillText('MÄLZEL · 1815', x - 78, y + 58);
    c.restore();
    void W; void H; void clamp;
  }
}

function clearDepthAndRender(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, st: Stage3D) {
  st.render(renderer, out);
}
