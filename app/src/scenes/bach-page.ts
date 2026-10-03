// The music desk's page, live: the Toccata engraved from the score data (the bars being played, a grand
// staff per bar, two bars to a page), a playhead running along the line, each note lighting warm while it
// sounds (an emissive layer: the page's ink stays ink, the light blooms), and the leaf turning when the
// music moves past the page. Pages: bach-a bars 1-2 | 3, bach-b bars 8-9 | 10-11 | 12.
import * as THREE from 'three';
import type { Note } from '../engine/score';
import { drawGlyph } from '../engine/music';
import { F, font } from '../engine/type';
import { clamp, ease, prog } from '../engine/util';
import { styled } from '../engine/style';

const PW = 1024, PH = 720;
const SP = 11; // staff space, px
const X0 = 150, X1 = PW - 50; // the bar's note area
const SYS_Y = [205, 520]; // each system's treble middle line
const BASS_DY = 9 * SP; // bass middle line below the treble's
const PAGES: [string, number[]][] = [['bach-a', [1, 2]], ['bach-a', [3]], ['bach-b', [8, 9]], ['bach-b', [10, 11]], ['bach-b', [12]]];

/** D minor spelling: diatonic step from C4 = 0, and an accidental to draw (B-flat is in the key). */
function spell(p: number): [number, '' | 'sharp' | 'flat' | 'natural'] {
  const pc = ((p % 12) + 12) % 12, oct = Math.floor(p / 12) - 5;
  const T: [number, '' | 'sharp' | 'flat' | 'natural'][] = [[0, ''], [0, 'sharp'], [1, ''], [2, 'flat'], [2, ''], [3, ''], [3, 'sharp'], [4, ''], [4, 'sharp'], [5, ''], [6, ''], [6, 'natural']];
  const [s, a] = T[pc]!;
  return [oct * 7 + s, a];
}

export interface PageNote { n: Note; written: number; seg: string }

export class LivePage {
  ink = document.createElement('canvas');
  glow = document.createElement('canvas');
  turnInk = document.createElement('canvas');
  map: THREE.CanvasTexture; glowMap: THREE.CanvasTexture; turnMap: THREE.CanvasTexture;
  mat: THREE.MeshPhysicalMaterial; turnMat: THREE.MeshPhysicalMaterial;
  mesh: THREE.Mesh; leaf: THREE.Group; leafMesh: THREE.Mesh;
  group = new THREE.Group();
  /** page index -> its notes; page start times; the page shown at t */
  pages: { seg: string; bars: number[]; notes: PageNote[]; t0: number; t1: number }[] = [];
  lastKey = '';

  constructor(public w: number, public h: number, notes: PageNote[]) {
    for (const c of [this.ink, this.glow, this.turnInk]) { c.width = PW; c.height = PH; }
    const tex = (c: HTMLCanvasElement, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    this.map = tex(this.ink); this.glowMap = tex(this.glow); this.turnMap = tex(this.turnInk);
    this.mat = styled({ color: new THREE.Color(0xffffff), map: this.map, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.5 });
    (this.mat as unknown as THREE.MeshToonMaterial).emissiveMap = this.glowMap;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
    this.group.add(this.mesh);
    // the turning leaf: hinged at the page's left edge, printed on both sides
    this.turnMat = styled({ color: new THREE.Color(0xffffff), map: this.turnMap });
    this.turnMat.side = THREE.DoubleSide;
    this.leafMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 12, 1), this.turnMat);
    this.leafMesh.position.x = w / 2;
    this.leaf = new THREE.Group(); this.leaf.position.set(-w / 2, 0, 0.04); this.leaf.add(this.leafMesh);
    this.leaf.visible = false;
    this.group.add(this.leaf);
    for (const [seg, bars] of PAGES) {
      const ns = notes.filter((x) => x.seg === seg && bars.includes(x.n.bar));
      if (!ns.length) continue;
      this.pages.push({ seg, bars, notes: ns, t0: Math.min(...ns.map((x) => x.n.t)), t1: Math.max(...ns.map((x) => x.n.t + x.n.d)) });
    }
    // never upload a blank canvas: print the first page now
    this.draw(0, -1e9, this.ink, this.glow); this.draw(0, -1e9, this.turnInk, null);
  }

  pageAt(t: number) {
    let i = 0;
    for (let k = 0; k < this.pages.length; k++) if (t >= this.pages[k]!.t0 - 0.5) i = k;
    return i;
  }

  /** The playhead's x (canvas px) on a system at t: between the onsets around t, by time. */
  playX(pg: (typeof this.pages)[number], bar: number, t: number) {
    const ons = [...new Set(pg.notes.filter((x) => x.n.bar === bar).map((x) => `${x.n.t}|${x.n.pos}`))].map((s) => s.split('|').map(Number) as [number, number]).sort((a, b) => a[0] - b[0]);
    if (!ons.length || t < ons[0]![0]) return null;
    let i = 0;
    while (i + 1 < ons.length && t >= ons[i + 1]![0]) i++;
    const a = ons[i]!, b = ons[i + 1];
    const pos = b ? a[1] + (b[1] - a[1]) * clamp((t - a[0]) / Math.max(1e-3, b[0] - a[0])) : Math.min(4, a[1] + (t - a[0]) * 1.2);
    return X0 + (pos / 4) * (X1 - X0);
  }

  /** Engrave page i at time t into the ink and glow canvases. */
  draw(i: number, t: number, ink: HTMLCanvasElement, glow: HTMLCanvasElement | null) {
    const pg = this.pages[i]!;
    const c = ink.getContext('2d')!;
    c.fillStyle = '#ece4d0'; c.fillRect(0, 0, PW, PH);
    // paper: a faint vignette and a deckled border
    const v = c.createRadialGradient(PW / 2, PH / 2, PH * 0.3, PW / 2, PH / 2, PW * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(90,70,40,0.22)');
    c.fillStyle = v; c.fillRect(0, 0, PW, PH);
    c.strokeStyle = 'rgba(60,45,30,0.5)'; c.lineWidth = 2; c.strokeRect(28, 28, PW - 56, PH - 56);
    c.fillStyle = '#2a221a';
    c.font = font(F.serif(600, true), 34); c.textAlign = 'center';
    c.fillText(pg.seg === 'bach-a' && pg.bars[0] === 1 ? 'Toccata.  Adagio.' : pg.seg === 'bach-a' ? 'Toccata.' : 'Prestissimo.', PW / 2, 88);
    c.font = font(F.mono(400), 15); c.textAlign = 'right';
    c.fillText(`BWV 565 · ${i + 1}`, PW - 60, 88);
    const g = glow?.getContext('2d') ?? null;
    if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, PW, PH); }
    pg.bars.forEach((bar, si) => {
      const Y = SYS_Y[si]!, YB = Y + BASS_DY;
      c.strokeStyle = '#2a221a'; c.lineWidth = 1.3;
      for (const my of [Y, YB]) for (let l = -2; l <= 2; l++) { c.beginPath(); c.moveTo(60, my + l * SP); c.lineTo(X1 + 20, my + l * SP); c.stroke(); }
      c.lineWidth = 2;
      for (const x of [60, X1 + 20]) { c.beginPath(); c.moveTo(x, Y - 2 * SP); c.lineTo(x, YB + 2 * SP); c.stroke(); }
      c.fillStyle = '#2a221a';
      drawGlyph(c, 'gClef', 68, Y + SP, SP);
      drawGlyph(c, 'fClef', 68, YB - SP, SP);
      drawGlyph(c, 'accidentalFlat', 112, Y + 0 * SP - 0, SP); // B-flat, the middle line
      drawGlyph(c, 'accidentalFlat', 112, YB + SP, SP); // B-flat in the bass (second line up)
      c.font = font(F.mono(400), 13); c.textAlign = 'left'; c.fillText(String(bar), 62, Y - 2 * SP - 10);
      const px = this.playX(pg, bar, t);
      // the playhead: a pale ruled line, glowing
      if (px !== null && t < pg.t1 + 0.4 && this.pages[this.pageAt(t)] === pg) {
        const last = pg.notes.filter((x) => x.n.bar === bar);
        const done = t > Math.max(...last.map((x) => x.n.t + x.n.d)) + 0.25;
        if (!done && g) {
          const gr = g.createLinearGradient(px - 14, 0, px + 4, 0);
          gr.addColorStop(0, 'rgba(255,214,150,0)'); gr.addColorStop(1, 'rgba(255,214,150,0.4)');
          g.fillStyle = gr; g.fillRect(px - 14, Y - 3 * SP, 18, BASS_DY + 6 * SP);
        }
      }
      for (const x of pg.notes) {
        if (x.n.bar !== bar) continue;
        const [step, acc] = spell(x.written);
        const treble = x.written >= 60;
        const mid = treble ? Y : YB, midStep = treble ? 6 : -6;
        const ny = mid - ((step - midStep) * SP) / 2;
        const nx = X0 + (x.n.pos / 4) * (X1 - X0);
        // ledger lines
        c.strokeStyle = '#2a221a'; c.lineWidth = 1.3;
        for (let s = midStep + 6; s <= step; s += 2) { const ly = mid - ((s - midStep) * SP) / 2; c.beginPath(); c.moveTo(nx - 4, ly); c.lineTo(nx + 17, ly); c.stroke(); }
        for (let s = midStep - 6; s >= step; s -= 2) { const ly = mid - ((s - midStep) * SP) / 2; c.beginPath(); c.moveTo(nx - 4, ly); c.lineTo(nx + 17, ly); c.stroke(); }
        const head = x.n.qd >= 4 ? 'noteheadWhole' : x.n.qd >= 2 ? 'noteheadHalf' : 'noteheadBlack';
        const sounding = t >= x.n.t && t < x.n.t + x.n.d;
        const played = t >= x.n.t + x.n.d;
        c.fillStyle = played ? '#4a3c2c' : '#1c160f';
        drawGlyph(c, head, nx, ny, SP);
        if (acc) drawGlyph(c, acc === 'sharp' ? 'accidentalSharp' : acc === 'flat' ? 'accidentalFlat' : 'accidentalNatural', nx - 13, ny, SP);
        if (head !== 'noteheadWhole') {
          const up = step < midStep;
          c.strokeStyle = c.fillStyle; c.lineWidth = 1.6;
          c.beginPath();
          if (up) { c.moveTo(nx + 12.6, ny - 1); c.lineTo(nx + 12.6, ny - 3.4 * SP); } else { c.moveTo(nx + 0.6, ny + 1); c.lineTo(nx + 0.6, ny + 3.4 * SP); }
          c.stroke();
          if (x.n.qd < 1 && head === 'noteheadBlack') {
            // a short beam stub toward the next onset (flags would crowd the sextuplets)
            c.lineWidth = 4;
            const sx = up ? nx + 12.6 : nx + 0.6, sy = up ? ny - 3.4 * SP : ny + 3.4 * SP;
            c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + (X1 - X0) * (x.n.qd / 4) * 0.9, sy); c.stroke();
          }
        }
        // the light: while it sounds a warm halo and the head itself burning; after, an ember that fades
        if (g) {
          const k = sounding ? 1 - 0.5 * prog(t, x.n.t, x.n.t + Math.min(0.6, x.n.d), ease.outQuad) : played ? 0.35 * (1 - prog(t, x.n.t + x.n.d, x.n.t + x.n.d + 0.6)) : 0;
          if (k > 0.01) {
            const hit = 1 - prog(t, x.n.t, x.n.t + 0.12);
            const R = 14 + 12 * hit;
            const gr = g.createRadialGradient(nx + 6, ny - 1, 0, nx + 6, ny - 1, R);
            gr.addColorStop(0, `rgba(255,226,170,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,190,110,0)');
            g.fillStyle = gr; g.fillRect(nx + 6 - R, ny - 1 - R, 2 * R, 2 * R);
            g.fillStyle = `rgba(255,240,210,${k})`;
            drawGlyph(g, head, nx, ny, SP);
          }
        }
      }
    });
  }

  /** Per frame: the visible page (and the leaf turning over to it). Returns the sounding notes' page uv positions. */
  update(t: number, visible: boolean) {
    const i = this.pageAt(t);
    const pg = this.pages[i]!;
    const turnU = i > 0 ? prog(t, pg.t0 - 0.5, pg.t0 - 0.02, ease.inOutCubic) : 1;
    const key = `${i}|${visible ? Math.round(t * 60) : -1}|${turnU.toFixed(3)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!visible) {
      // off camera: draw the page once (its state at t) and leave it
      this.draw(i, t, this.ink, this.glow);
      this.map.needsUpdate = true; this.glowMap.needsUpdate = true;
      this.leaf.visible = false;
      return;
    }
    this.draw(i, t, this.ink, this.glow);
    this.map.needsUpdate = true; this.glowMap.needsUpdate = true;
    // the leaf: the previous page, turning over from right to left (it lifts and curls a little)
    if (turnU < 1) {
      this.draw(i - 1, t, this.turnInk, null);
      this.turnMap.needsUpdate = true;
      this.leaf.visible = true;
      this.leaf.rotation.y = -Math.PI * turnU;
      const pos = this.leafMesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k) + this.w / 2; // 0..w from the hinge
        pos.setZ(k, Math.sin(Math.PI * turnU) * 0.35 * this.w * Math.pow(x / this.w, 2) * 0.4);
      }
      pos.needsUpdate = true;
    } else this.leaf.visible = false;
  }

  /** Canvas px -> the page's local position (for particles off the sounding notes). */
  local(px: number, py: number) { return new THREE.Vector3((px / PW - 0.5) * this.w, (0.5 - py / PH) * this.h, 0.08); }

  /** The sounding notes' heads, in canvas px, with how freshly struck they are. */
  sounding(t: number) {
    const pg = this.pages[this.pageAt(t)]!;
    const out: { x: number; y: number; n: Note }[] = [];
    pg.bars.forEach((bar, si) => {
      const Y = SYS_Y[si]!, YB = Y + BASS_DY;
      for (const x of pg.notes) {
        if (x.n.bar !== bar || t < x.n.t || t > x.n.t + x.n.d + 0.3) continue;
        const [step] = spell(x.written);
        const treble = x.written >= 60, mid = treble ? Y : YB, midStep = treble ? 6 : -6;
        out.push({ x: X0 + (x.n.pos / 4) * (X1 - X0) + 6, y: mid - ((step - midStep) * SP) / 2, n: x.n });
      }
    });
    return out;
  }
}
