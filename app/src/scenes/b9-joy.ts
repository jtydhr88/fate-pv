// Beethoven 9/IV, the joy theme in the full orchestra (bars 164-171, cut to 180-187): the tune everyone
// knows, sung by everyone, on a map of the world. A night map, printed like an old atlas (engraved coasts,
// a faint graticule). The first voice is Vienna, where the symphony was first played (7 May 1824); every
// note of the tune lights more of the world's towns, outward from there, exponentially, a counter keeping
// the deadpan score (`voices`). The camera establishes the whole world, then follows the light: Europe,
// Asia, Africa; in the middle section the tune hops city to city across the oceans; on the syncopated
// return, "Alle Menschen werden Brüder", every light comes on in a wave: 8,000,000,000. In the last bars
// the night map turns into a coloured one, the only full-colour map of the film (the grade lets it go).
// Schiller's words line by line with the tune, with our own translation under them.
// Map data: Natural Earth (public domain), see b9-world.ts / analysis/b9_world.py.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Note } from '../engine/score';
import { clamp, ease, lerp, mulberry32, prog, pulse } from '../engine/util';
import { LANG } from './opening-text';
import { CITIES, COUNTRIES } from './b9-world';

const WORLD = 8_000_000_000;
const VIENNA: [number, number] = [16.37, 48.21];
const LON0 = 0; // central meridian (Greenwich: the data is already cut at the antimeridian, so no ring crosses the seam)

/** Schiller, An die Freude (1785/1803), the first stanza, two bars a line; our translations. */
const LINES: { de: string; zh: string; en: string }[] = [
  { de: 'Freude, schöner Götterfunken,', zh: '欢乐，美丽的神圣火花，', en: 'Joy, beautiful spark of the gods,' },
  { de: 'Tochter aus Elysium,', zh: '来自极乐之境的女儿，', en: 'daughter of Elysium,' },
  { de: 'wir betreten feuertrunken,', zh: '我们满怀火一般的热情，', en: 'drunk with fire we enter,' },
  { de: 'Himmlische, dein Heiligtum!', zh: '天国的女神，走进你的圣殿！', en: 'heavenly one, your sanctuary!' },
  { de: 'Deine Zauber binden wieder,', zh: '你的魔力重新连结', en: 'Your magic binds again' },
  { de: 'was die Mode streng geteilt;', zh: '被世俗无情分开的一切；', en: 'what custom sternly divided;' },
  { de: 'Alle Menschen werden Brüder,', zh: '所有人都将成为兄弟，', en: 'all people become brothers' },
  { de: 'wo dein sanfter Flügel weilt.', zh: '在你温柔的羽翼之下。', en: 'where your gentle wing abides.' },
];

/** where the tune is handed on in bars 180-183: across the Atlantic and round the world (lon, lat) */
const ROUTE: [number, number][] = [
  [16.4, 48.2], [-0.1, 51.5], [-74.0, 40.7], [-82.4, 23.1], [-99.1, 19.4], [-74.1, 4.7], [-77.0, -12.0], [-46.6, -23.5],
  [-58.4, -34.6], [3.4, 6.5], [36.8, -1.3], [31.2, 30.0], [51.4, 35.7], [72.9, 19.1], [116.4, 39.9], [139.7, 35.7], [151.2, -33.9],
];

/** 8000000000 -> "8,000,000,000" (no locale: the same on every machine) */
const commas = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Equal Earth projection (Šavrič, Patterson, Jenny 2018): degrees -> map units (x ±2.71, y ±1.32, north up) */
function project(lon: number, lat: number): [number, number] {
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  let l = lon - LON0;
  if (l > 180) l -= 360; else if (l < -180) l += 360; // (±180 itself stays on its own edge)
  const lam = (l * Math.PI) / 180, phi = (lat * Math.PI) / 180;
  const th = Math.asin(M * Math.sin(phi)), t2 = th * th, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lam * Math.cos(th)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = th * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1);
  return [x, y];
}

/** great-circle distance in radians */
function gc(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, p1 = a[1] * r, p2 = b[1] * r, dl = (b[0] - a[0]) * r;
  return Math.acos(clamp(Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl), -1, 1));
}

type View = { t: number; lon: number; lat: number; zoom: number };
type Light = { x: number; y: number; b: number; join: number; seed: number };

export default class B9Joy extends Scene {
  T = new Layer2D();
  mel: Note[] = []; // the tune's onsets (first oboe), both cuts
  tSync = 0; // the syncopated return: everyone
  nPre = 0;
  lights: Light[] = []; // in the order they join
  land: { path: Path2D; hue: number; c: number }[] = [];
  frame!: Path2D; // the map's outline (meridians ±180)
  grat!: Path2D;
  glow!: HTMLCanvasElement;
  hops: { t: number; a: [number, number]; b: [number, number] }[] = [];
  lines: { t0: number; t1: number; ons: number[] }[] = [];
  views: View[] = [];
  tColour = 0;
  big: [number, number][] = []; // the biggest cities (map units), for the streams and the fireworks
  finals: number[] = []; // the closing chords' onsets (any part), for the fireworks
  bA = (n: number) => this.ctx.score.bar(n, 'b9-a').t;
  bB = (n: number) => this.ctx.score.bar(n, 'b9-b').t;

  override async init() {
    const sc = this.ctx.score;
    const ob = (seg: string) => sc.notesIn(this.ctx.start - 1, this.ctx.end + 1).filter((n) => n.part === sc.partIndex(`${seg}:ob`));
    this.mel = [...ob('b9-a'), ...ob('b9-b')].sort((a, b) => a.t - b.t);
    const sync = this.mel.find((n) => n.bar === 183 && n.t >= this.bB(183) + 0.7 * (this.bB(184) - this.bB(183)))!;
    this.tSync = sync.t;
    this.nPre = this.mel.indexOf(sync);
    this.tColour = this.bB(186);

    // the map: countries as paths in map units (drawn through the view transform)
    const R = mulberry32(1824);
    COUNTRIES.forEach((cn, i) => {
      const p = new Path2D();
      for (const ring of cn.r) {
        let px0 = 0;
        for (let k = 0; k < ring.length; k += 2) {
          const [x, y] = project(ring[k]! / 10, ring[k + 1]! / 10);
          // (a ring touching the seam: never draw a stroke across the whole map)
          if (k === 0 || Math.abs(x - px0) > 2) p.moveTo(x, -y); else p.lineTo(x, -y);
          px0 = x;
        }
        p.closePath();
      }
      // soft distinct colours for the coloured map: hue by continent, spread within it
      // an atlas's pastels: Africa sand, Asia terracotta, Europe yellow, the Americas greens, Oceania sea-green
      const base = [36, 14, 52, 135, 92, 172][cn.c] ?? 40;
      this.land.push({ path: p, hue: (base + ((i * 37) % 36) - 18 + 360) % 360, c: cn.c });
    });
    this.frame = new Path2D();
    for (let k = 0; k <= 180; k++) { const [x, y] = project(LON0 + 180 - 1e-6, 90 - k); if (k === 0) this.frame.moveTo(x, -y); else this.frame.lineTo(x, -y); }
    for (let k = 0; k <= 180; k++) { const [x, y] = project(LON0 - 180 + 1e-6, -90 + k); this.frame.lineTo(x, -y); }
    this.frame.closePath();
    this.grat = new Path2D();
    for (let lon = -180; lon <= 180; lon += 30) for (let k = 0; k <= 36; k++) { const [x, y] = project(LON0 + lon, -90 + k * 5); if (k === 0) this.grat.moveTo(x, -y); else this.grat.lineTo(x, -y); }
    for (let lat = -60; lat <= 60; lat += 30) for (let k = 0; k <= 72; k++) { const [x, y] = project(LON0 - 180 + k * 5 + 1e-6, lat); if (k === 0) this.grat.moveTo(x, -y); else this.grat.lineTo(x, -y); }

    // the lights: every town, and a scatter round the big ones; they join outward from Vienna (ragged)
    const pts: { ll: [number, number]; b: number; k: number }[] = [];
    for (const [lon, lat, pop] of CITIES) {
      const ll: [number, number] = [lon! / 10, lat! / 10];
      pts.push({ ll, b: clamp(0.35 + Math.sqrt(pop!) / 60, 0.35, 1.6), k: gc(VIENNA, ll) });
      const n = Math.min(10, Math.round(Math.sqrt(pop!) / 7));
      for (let s = 0; s < n; s++) {
        const a = R() * Math.PI * 2, r = (0.4 + R() * 1.8) * (0.6 + Math.sqrt(pop!) / 120);
        const q: [number, number] = [ll[0] + (Math.cos(a) * r) / Math.max(0.3, Math.cos((ll[1] * Math.PI) / 180)), ll[1] + Math.sin(a) * r * 0.8];
        pts.push({ ll: q, b: 0.25 + 0.3 * R(), k: gc(VIENNA, q) });
      }
    }
    pts.push({ ll: VIENNA, b: 2.2, k: -1 }); // the first voice
    for (const p of pts) p.k = p.k * (1 + 0.35 * (R() - 0.5));
    pts.sort((a, b) => a.k - b.k);
    // how many are lit after each onset: 1, then exponentially (log of the counter), all at the return
    const n = pts.length;
    const litAfter = this.mel.map((_, i) => (i < this.nPre ? Math.max(1, Math.round(n * Math.pow(this.voicesAt(i) > 1 ? Math.log(this.voicesAt(i)) / Math.log(WORLD) : 0, 2.2))) : n));
    let j = 0;
    const join = new Array<number>(n).fill(1e9);
    this.mel.forEach((m, i) => { const j0 = j; for (; j < litAfter[i]! && j < n; j++) join[j] = m.t + (i === this.nPre ? 1.1 * (j - j0) / Math.max(1, n - j0) : 0.12 * (j - j0) / Math.max(1, litAfter[i]! - j0)); });
    this.lights = pts.map((p, i) => { const [x, y] = project(p.ll[0], p.ll[1]); return { x, y: -y, b: p.b, join: join[i]!, seed: R() }; });

    this.big = CITIES.slice(0, 48).map(([lon, lat]) => { const [x, y] = project(lon! / 10, lat! / 10); return [x, -y] as [number, number]; });
    const allOn = [...new Set(sc.notesIn(this.bB(185), this.ctx.end).filter((n) => n.v >= 100).map((n) => +n.t.toFixed(3)))].sort((a, b) => a - b);
    this.finals = allOn.filter((x, i) => i === 0 || x - allOn[i - 1]! > 0.2);

    // glow sprite: a warm core and a soft halo
    const g = document.createElement('canvas'); g.width = g.height = 64;
    const gc2 = g.getContext('2d')!;
    const grd = gc2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,250,240,1)'); grd.addColorStop(0.12, 'rgba(255,226,170,0.9)');
    grd.addColorStop(0.4, 'rgba(255,170,90,0.22)'); grd.addColorStop(1, 'rgba(255,140,60,0)');
    gc2.fillStyle = grd; gc2.fillRect(0, 0, 64, 64);
    this.glow = g;

    // bars 180-183: the tune handed on, one city per note
    const hopNotes = this.mel.filter((m) => m.t >= this.bB(180) - 0.01 && m.t < this.tSync - 0.01);
    hopNotes.forEach((m, k) => { this.hops.push({ t: m.t, a: ROUTE[k % ROUTE.length]!, b: ROUTE[(k + 1) % ROUTE.length]! }); });

    // the words: a line per two bars, revealed with the tune's notes
    const starts = [this.bA(164), this.bA(166), this.bA(168), this.bA(170), this.bB(180), this.bB(182), this.tSync, this.bB(186)];
    const ends = [...starts.slice(1), this.bB(187) + 2.6];
    ends[3] = this.bA(171) + 1.6; // the cut: the first half's last line holds over its cadence
    this.lines = starts.map((t0, i) => ({ t0, t1: ends[i]!, ons: this.mel.filter((m) => m.t >= t0 - 0.01 && m.t < ends[i]! - 0.01).map((m) => m.t) }));

    // the views: the whole world first, then following the light; the return pulls back to the world
    const a = this.bA, b = this.bB, s0 = this.ctx.start;
    this.views = [
      { t: s0, lon: 5, lat: 12, zoom: 1.0 },
      { t: a(166) - 0.9, lon: 12, lat: 20, zoom: 1.12 },
      { t: a(166), lon: 14, lat: 49, zoom: 3.4 }, // Europe, where it was first sung
      { t: a(168) - 0.9, lon: 18, lat: 48, zoom: 3.7 },
      { t: a(168), lon: 22, lat: 38, zoom: 2.1 }, // out over the Mediterranean, North Africa, the Near East
      { t: a(170) - 0.9, lon: 28, lat: 34, zoom: 2.0 },
      { t: a(170), lon: 50, lat: 18, zoom: 1.55 }, // Africa to India
      { t: a(171) + 1.0, lon: 52, lat: 16, zoom: 1.6 },
      { t: b(180), lon: -40, lat: 18, zoom: 1.5 }, // across the Atlantic with the tune
      { t: b(182) - 0.4, lon: -20, lat: 8, zoom: 1.45 },
      { t: this.tSync - 0.05, lon: 5, lat: 10, zoom: 1.0 }, // everyone
      { t: this.ctx.end, lon: 5, lat: 8, zoom: 1.07 },
    ];
  }

  /** the counter after melody onset i (exponential to 2e9 before the return, everyone at it) */
  voicesAt(i: number) {
    if (i < 0) return 0;
    if (i >= this.nPre) return WORLD;
    return Math.exp((Math.log(2e9) * i) / Math.max(1, this.nPre - 1));
  }

  /** the view at t: eased moves between the keys (each move takes the 0.9 s before its key) */
  view(t: number) {
    const v = this.views;
    let i = 0;
    while (i + 1 < v.length && t >= v[i + 1]!.t) i++;
    const A = v[i]!, B = v[Math.min(i + 1, v.length - 1)]!;
    const u = B.t > A.t ? ease.inOutCubic(clamp((t - A.t) / (B.t - A.t))) : 0;
    const [ax, ay] = project(A.lon, A.lat), [bx, by] = project(B.lon, B.lat);
    // zoom moves in log space, the centre follows the zoom so the move reads as one gesture
    const z = Math.exp(lerp(Math.log(A.zoom), Math.log(B.zoom), u));
    return { x: lerp(ax, bx, u), y: -lerp(ay, by, u), zoom: z };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    const T = this.T; T.clear();
    const c = T.ctx;
    const v = this.view(t);
    const scale = v.zoom * (W * 0.86) / 5.43;
    const ox = W / 2, oy = H / 2 - 50;
    const toS = (x: number, y: number): [number, number] => [ox + (x - v.x) * scale, oy + (y - v.y) * scale];
    // how far into the night the world is: the ocean warms a little as the voices spread; colour at the end
    const nLit = this.mel.reduce((m, x, k) => (t >= x.t ? k : m), -1);
    const dawn = nLit < 0 ? 0 : nLit >= this.nPre ? 1 : Math.log(Math.max(1, this.voicesAt(nLit))) / Math.log(WORLD);
    const col = 0; // (no colour map: the ending stays in the night map's palette, lit; see drawGlory)
    const glory = prog(t, this.tSync, this.tSync + 1.6, ease.outCubic);

    // the page around the map: deep night; the map's own ocean inside its outline
    c.fillStyle = `rgb(${lerp(5, 18, col)},${lerp(7, 22, col)},${lerp(12, 34, col)})`;
    c.fillRect(0, 0, W, H);
    c.save();
    c.setTransform(T.canvas.width / W * scale, 0, 0, T.canvas.height / H * scale, T.canvas.width / W * (ox - v.x * scale), T.canvas.height / H * (oy - v.y * scale));
    const px = 1 / scale; // one screen px in map units
    const oc = [lerp(6, 10, dawn * 0.6), lerp(9, 16, dawn * 0.6), lerp(18, 30, dawn * 0.6)];
    const ocC = [lerp(oc[0]!, 70, col), lerp(oc[1]!, 128, col), lerp(oc[2]!, 186, col)];
    c.fillStyle = `rgb(${ocC[0]},${ocC[1]},${ocC[2]})`;
    c.fill(this.frame);
    // the graticule, faint, like an old printed map
    c.lineWidth = 0.8 * px; c.strokeStyle = `rgba(150,170,205,${0.13 + 0.05 * col})`;
    c.stroke(this.grat);
    // land: night ink, engraved coasts; the coloured map arrives country by country (west to east)
    for (const L of this.land) {
      const night = `rgb(${lerp(34, 44, dawn)},${lerp(44, 56, dawn)},${lerp(64, 76, dawn)})`;
      c.fillStyle = night;
      c.fill(L.path);
      if (col > 0) {
        c.globalAlpha = col;
        c.fillStyle = `hsl(${L.hue}, ${38 + ((L.hue * 3) % 8)}%, ${60 + ((L.hue * 7) % 8)}%)`;
        c.fill(L.path);
        c.globalAlpha = 1;
      }
      c.lineWidth = 0.9 * px;
      c.strokeStyle = col > 0.5 ? `rgba(30,36,48,${0.5 * col})` : `rgba(130,150,190,${0.35 + 0.2 * dawn})`;
      c.stroke(L.path);
    }
    c.lineWidth = 1.6 * px; c.strokeStyle = `rgba(180,195,225,${0.45 - 0.2 * col})`;
    c.stroke(this.frame);
    // a luminous shimmer sweeping west to east across the continents, twice, once everyone sings
    if (glory > 0) {
      c.globalCompositeOperation = 'lighter';
      for (const [t0, dur] of [[this.tSync + 0.2, 2.6], [this.tColour - 0.3, 3.2]] as const) {
        const u = (t - t0) / dur;
        if (u <= 0 || u >= 1) continue;
        const bx = lerp(-3.4, 3.4, ease.inOutQuad(u));
        const gr = c.createLinearGradient(bx - 0.9, -0.4, bx + 0.9, 0.4);
        const a = 0.22 * Math.sin(Math.PI * u);
        gr.addColorStop(0, 'rgba(255,200,130,0)'); gr.addColorStop(0.5, `rgba(255,214,150,${a})`); gr.addColorStop(1, 'rgba(255,200,130,0)');
        c.fillStyle = gr;
        for (const L of this.land) c.fill(L.path);
      }
      // the land itself warms a little under all those lights
      c.fillStyle = `rgba(255,170,90,${0.05 * glory})`;
      for (const L of this.land) c.fill(L.path);
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();

    // the lights (screen space, additive)
    c.globalCompositeOperation = 'lighter';
    const beat = Math.max(0, ...this.mel.map((m) => pulse(t, m.t, 0.12)));
    const fadeL = 1 - 0.55 * col; // in daylight colour the lights quieten
    const zs = Math.sqrt(v.zoom);
    for (const L of this.lights) {
      if (t < L.join) continue;
      const age = t - L.join;
      const [sx, sy] = toS(L.x, L.y);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
      const flare = Math.exp(-age * 4);
      const tw = 0.85 + 0.15 * Math.sin(t * (2 + L.seed * 3) + L.seed * 40);
      const a = clamp((0.45 + 0.4 * flare + 0.12 * beat) * tw * fadeL, 0, 1);
      const s = (7 + 10 * L.b + 26 * flare * L.b) * zs;
      c.globalAlpha = a;
      c.drawImage(this.glow, sx - s / 2, sy - s / 2, s, s);
    }
    // motes rising from the lit towns (every 9th)
    for (let i = 0; i < this.lights.length; i += 9) {
      const L = this.lights[i]!;
      if (t < L.join) continue;
      const [sx, sy] = toS(L.x, L.y);
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      for (let k = 0; k < 2; k++) {
        const ph = (t - L.join) * (0.35 + 0.3 * L.seed) + k * 0.5 + L.seed;
        const u = ph % 1;
        const a = Math.sin(Math.PI * u) * 0.5 * fadeL;
        c.globalAlpha = a;
        c.fillStyle = '#ffe2b0';
        c.fillRect(sx + Math.sin(ph * 6 + L.seed * 20) * 6, sy - u * 46 * zs, 2, 2);
      }
    }
    // bars 180-183: the tune handed from city to city, an arc bowed over the map with a bright head
    if (t >= this.bB(180) - 0.05 && t < this.tSync + 1.2) {
      const fadeAll = 1 - prog(t, this.tSync, this.tSync + 1.2);
      c.lineCap = 'round';
      for (let k = 0; k < this.hops.length; k++) {
        const h = this.hops[k]!, next = this.hops[k + 1];
        if (t < h.t) break;
        const dur = Math.max(0.12, (next ? next.t : this.tSync) - h.t);
        const grow = ease.outCubic(clamp((t - h.t) / dur));
        const age = Math.max(0, t - h.t - dur);
        const [ax, ay] = project(h.a[0], h.a[1]), [bx, by] = project(h.b[0], h.b[1]);
        const [sa, sb] = [toS(ax, -ay), toS(bx, -by)];
        const mx = (sa[0] + sb[0]) / 2, my = (sa[1] + sb[1]) / 2 - Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) * 0.28;
        const g = (0.9 * Math.exp(-age * 1.1) + 0.18) * fadeAll;
        c.globalAlpha = g; c.strokeStyle = '#ffd9a0'; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(sa[0], sa[1]);
        const N = 28;
        let hx = sa[0], hy = sa[1];
        for (let s = 1; s <= N * grow; s++) {
          const u = s / N;
          hx = (1 - u) * (1 - u) * sa[0] + 2 * (1 - u) * u * mx + u * u * sb[0];
          hy = (1 - u) * (1 - u) * sa[1] + 2 * (1 - u) * u * my + u * u * sb[1];
          c.lineTo(hx, hy);
        }
        c.stroke();
        if (grow < 1 && t < this.tSync) { c.globalAlpha = 1 * fadeAll; c.drawImage(this.glow, hx - 22, hy - 22, 44, 44); }
      }
    }
    // the return: a ring of light running out from Vienna
    const sw = prog(t, this.tSync, this.tSync + 1.4);
    if (sw > 0 && sw < 1) {
      const [vx, vy] = project(VIENNA[0], VIENNA[1]);
      const [sx, sy] = toS(vx, -vy);
      c.globalAlpha = 0.5 * (1 - sw); c.strokeStyle = '#ffe6c0'; c.lineWidth = 6;
      c.beginPath(); c.arc(sx, sy, sw * W * 0.9, 0, Math.PI * 2); c.stroke();
    }
    if (glory > 0) this.drawGlory(t, toS, glory);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    this.drawText(t, toS);
    this.ctx.comp.draw(this.ctx.renderer, T.upload(), out);

    const sync = pulse(t, this.tSync, 0.35);
    const fade = Math.max(1 - prog(t, this.ctx.start, this.ctx.start + 0.7), prog(t, this.bB(187) + 1.6, this.ctx.end - 0.15, ease.inOutQuad));
    return {
      // the night map through the dawn ramp; the coloured map passes the grade untouched
      gradeSteps: 0,
      bloom: 0.7 + 0.5 * sync + 0.35 * glory, bloomThreshold: 0.85, halation: 0, grain: 0.045, vignette: 0.32,
      ca: 0.6 + 1.0 * sync, flash: 0.22 * sync, fade, hud: 0,
    };
  }

  drawText(t: number, toS: (x: number, y: number) => [number, number]) {
    const c = this.T.ctx;
    const s0 = this.ctx.start;
    // the plate's title
    const ta = prog(t, s0 + 0.3, s0 + 0.8) * (1 - prog(t, this.bA(166) - 0.9, this.bA(166) - 0.4));
    if (ta > 0) {
      c.globalAlpha = ta; c.textAlign = 'left';
      c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 0.85);
      c.fillText('L. VAN BEETHOVEN · SINFONIE NR. 9 · OP. 125 · 1824', 120, 130);
      c.letterSpacing = '0px';
      c.font = font(F.serif(400, true), 64); c.fillStyle = rgba('bone', 0.96);
      c.fillText('An die Freude.', 112, 200);
    }
    // the first voice: Vienna, the first performance
    const wa = prog(t, s0 + 0.5, s0 + 1.0) * (1 - prog(t, this.bA(168) - 0.6, this.bA(168) - 0.1));
    if (wa > 0) {
      const [vx, vy] = project(VIENNA[0], VIENNA[1]);
      const [sx, sy] = toS(vx, -vy);
      c.globalAlpha = wa; c.strokeStyle = rgba('bone', 0.6); c.lineWidth = 1;
      c.beginPath(); c.moveTo(sx + 6, sy - 6); c.lineTo(sx + 40, sy - 40); c.lineTo(sx + 52, sy - 40); c.stroke();
      c.textAlign = 'left'; c.font = font(F.mono(500), 15); c.letterSpacing = '2px'; c.fillStyle = rgba('bone', 0.9);
      c.fillText('WIEN · 7 V 1824 · first performance', sx + 58, sy - 35);
    }
    // the count of voices
    const i = this.mel.reduce((m, x, k) => (t >= x.t ? k : m), -1);
    let v = 0;
    if (i >= 0) {
      const k = ease.outCubic(clamp((t - this.mel[i]!.t) / 0.25));
      v = i >= this.nPre ? WORLD : Math.max(1, i === 0 ? 1 : lerp(this.voicesAt(i - 1), this.voicesAt(i), k));
    }
    const va = prog(t, s0 + 0.2, s0 + 0.6) * (1 - prog(t, this.ctx.end - 1.2, this.ctx.end - 0.4));
    if (va > 0) {
      c.globalAlpha = va * 0.62; c.fillStyle = 'rgb(5,8,16)';
      c.beginPath(); c.roundRect(W - 120 - 560, 82, 584, 98, 8); c.fill();
      c.globalAlpha = va * 0.5; c.strokeStyle = 'rgba(180,195,225,0.5)'; c.lineWidth = 1; c.stroke();
      c.globalAlpha = va; c.textAlign = 'right';
      c.font = font(F.mono(400), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('bone', 0.7);
      c.fillText('ODE · F. SCHILLER 1785 · D MAJOR · ff', W - 120, 112);
      c.font = font(F.mono(500), 34); c.letterSpacing = '1px';
      c.fillStyle = rgba('bone', t >= this.tSync ? 1 : 0.92);
      c.fillText(`voices: ${commas(v)}`, W - 120, 160);
    }
    // the words, on a soft dark band so they read over the lights and the coloured map
    for (let li = 0; li < this.lines.length; li++) {
      const L = this.lines[li]!, ln = LINES[li]!;
      const a = prog(t, L.t0 - 0.05, L.t0 + 0.12) * (1 - prog(t, L.t1 - 0.25, L.t1));
      if (a <= 0) continue;
      const key = li === 6; // Alle Menschen werden Brüder
      const g = c.createLinearGradient(0, H - 300, 0, H);
      g.addColorStop(0, 'rgba(4,6,12,0)'); g.addColorStop(0.45, 'rgba(4,6,12,0.55)'); g.addColorStop(1, 'rgba(4,6,12,0.7)');
      c.globalAlpha = a; c.fillStyle = g; c.fillRect(0, H - 300, W, 300);
      const shown = L.ons.filter((x) => t >= x).length / Math.max(1, L.ons.length);
      const chars = [...ln.de];
      const n = Math.max(1, Math.ceil(chars.length * Math.min(1, shown + 0.08)));
      c.letterSpacing = '0px';
      c.font = font(F.serif(key ? 600 : 400, !key), key ? 92 : 68);
      c.fillStyle = rgba('bone', 1);
      // centre the whole line, reveal it from the left
      const full = c.measureText(ln.de).width;
      c.textAlign = 'left';
      c.fillText(chars.slice(0, n).join(''), W / 2 - full / 2, H - (key ? 190 : 170));
      const tr = LANG === 'zh' ? ln.zh : ln.en;
      c.font = LANG === 'zh' ? font(F.zh(500), key ? 34 : 28) : font(F.serif(400, true), key ? 36 : 30);
      c.letterSpacing = LANG === 'zh' ? '4px' : '0px';
      c.fillStyle = rgba('bone', 0.78);
      c.globalAlpha = a * prog(t, L.t0 + 0.3, L.t0 + 0.8);
      c.textAlign = 'center';
      c.fillText(tr, W / 2, H - (key ? 120 : 112));
    }
    c.globalAlpha = 1; c.letterSpacing = '0px';
  }

  /** The world lit: streams of light between cities, spark bursts on the tune, glitter rising from every
   *  lit region, fireworks over the big cities on the closing chords, glitter falling in the held chord. */
  drawGlory(t: number, toS: (x: number, y: number) => [number, number], glory: number) {
    const c = this.T.ctx;
    const G = this.glow;
    const out = 1 - prog(t, this.bB(187) + 1.4, this.ctx.end - 0.2);
    if (out <= 0) return;
    c.globalCompositeOperation = 'lighter';
    const B = this.big.map(([x, y]) => toS(x, y));
    // streams: comets along bowed arcs between big cities, launched in a stagger, each repeating
    for (let k = 0; k < 64; k++) {
      const R = mulberry32(900 + k);
      const a = B[Math.floor(R() * B.length)]!, b = B[Math.floor(R() * B.length)]!;
      if (a === b) continue;
      const period = 1.6 + R() * 1.4, t0 = this.tSync + R() * 1.2;
      if (t < t0) continue;
      const u = ((t - t0) / period) % 1;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * (0.18 + 0.15 * R());
      const at = (v: number): [number, number] => [(1 - v) * (1 - v) * a[0] + 2 * (1 - v) * v * mx + v * v * b[0], (1 - v) * (1 - v) * a[1] + 2 * (1 - v) * v * my + v * v * b[1]];
      // the whole arc, faint
      c.globalAlpha = 0.22 * glory * out; c.strokeStyle = '#ffcf8e'; c.lineWidth = 1.8;
      c.beginPath();
      for (let s = 0; s <= 24; s++) { const [x, y] = at(s / 24); if (s) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
      // the comet and its tail
      for (let s = 0; s < 10; s++) {
        const v = u - s * 0.018;
        if (v < 0) break;
        const [x, y] = at(v);
        const sz = 34 - s * 2.8;
        c.globalAlpha = (1 - s / 10) * glory * out;
        c.drawImage(G, x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    // a warm halo breathing over the big cities
    B.forEach(([x, y], k) => {
      const sz = (120 + 60 * Math.sin(t * 1.7 + k)) * (k < 12 ? 1.4 : 1);
      c.globalAlpha = 0.28 * glory * out;
      c.drawImage(G, x - sz / 2, y - sz / 2, sz, sz);
    });
    // spark bursts on every note of the tune after the return, over a few big cities each
    for (const m of this.mel) {
      const age = t - m.t;
      if (m.t < this.tSync - 0.01 || age < 0 || age > 1.1) continue;
      const R = mulberry32(Math.round(m.t * 1000));
      for (let k = 0; k < 7; k++) {
        const [cx, cy] = B[Math.floor(R() * B.length)]!;
        c.globalAlpha = Math.max(0, 1 - age / 0.4) * 0.8 * out;
        c.drawImage(G, cx - 50, cy - 50, 100, 100);
        for (let s = 0; s < 30; s++) {
          const ang = R() * Math.PI * 2, sp = 60 + R() * 130;
          const x = cx + Math.cos(ang) * sp * age, y = cy + Math.sin(ang) * sp * age + 60 * age * age;
          c.globalAlpha = (1 - age / 1.1) * out;
          c.drawImage(G, x - 5, y - 5, 10, 10);
          c.fillStyle = s % 3 ? '#ffd79a' : '#fff6e6';
          c.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
    }
    // glitter rising from the lit regions
    for (let k = 0; k < 1600; k++) {
      const L = this.lights[(k * 7919) % this.lights.length]!;
      if (t < L.join) continue;
      const [sx, sy] = toS(L.x, L.y);
      const ph = (t * (0.25 + 0.3 * L.seed) + L.seed * 3 + k * 0.013) % 1;
      const tw = 0.5 + 0.5 * Math.sin(t * 9 + k);
      c.globalAlpha = Math.sin(Math.PI * ph) * tw * 0.75 * glory * out;
      c.fillStyle = k % 4 ? '#ffe2b4' : '#ffffff';
      const sz = 1.6 + 2.2 * L.seed;
      const gx = sx + Math.sin(ph * 5 + k) * 14, gy = sy - ph * 150;
      c.fillRect(gx, gy, sz, sz);
      if (k % 5 === 0) c.drawImage(G, gx - 7, gy - 7, 14, 14);
    }
    // fireworks over the big cities on the closing chords
    this.finals.forEach((ft, fi) => {
      const age = t - ft;
      if (age < 0 || age > 2.2) return;
      const R = mulberry32(5000 + fi);
      for (let k = 0; k < 5; k++) {
        const [cx, cy0] = B[Math.floor(R() * Math.min(30, B.length))]!;
        const cy = cy0 - 90 - R() * 90;
        const hue = R();
        // the shell rising, then the bloom
        if (age < 0.2) { c.globalAlpha = out; c.drawImage(G, cx - 8, cy0 - ((cy0 - cy) * age) / 0.2 - 8, 16, 16); continue; }
        const a2 = age - 0.2;
        c.globalAlpha = Math.max(0, 1 - a2 / 0.6) * out;
        c.drawImage(G, cx - 130, cy - 130, 260, 260);
        for (let s = 0; s < 72; s++) {
          const ang = (s / 72) * Math.PI * 2 + R() * 0.08, sp = 150 + R() * 110;
          const f = Math.max(0, 1 - a2 / 2.0);
          // the star and a short trail behind it
          for (let tr = 0; tr < 4; tr++) {
            const aa = Math.max(0, a2 - tr * 0.04);
            const d = ((sp * (1 - Math.exp(-aa * 2.6))) / 2.6) * 2;
            const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d + 34 * aa * aa;
            c.globalAlpha = f * f * out * (1 - tr / 4) * (0.75 + 0.25 * Math.sin(a2 * 30 + s));
            if (tr === 0) c.drawImage(G, x - 9, y - 9, 18, 18);
            c.fillStyle = hue < 0.5 ? (s % 2 ? '#ffd28a' : '#fff1d6') : (s % 2 ? '#ffe9c4' : '#ffb870');
            c.fillRect(x - 1.8, y - 1.8, 3.6, 3.6);
          }
        }
      }
    });
    // glitter falling slowly through the held last chord
    const last = this.finals[this.finals.length - 1] ?? this.bB(187);
    const fall = prog(t, last, last + 0.8);
    if (fall > 0) {
      for (let k = 0; k < 900; k++) {
        const R = mulberry32(7000 + k);
        const x = R() * W, y0 = -40 + R() * H * 0.6, sp = 18 + R() * 30;
        const y = y0 + (t - last) * sp;
        if (y > H) continue;
        c.globalAlpha = fall * out * (0.4 + 0.6 * Math.abs(Math.sin(t * 4 + k))) * 0.8;
        c.fillStyle = k % 3 ? '#ffe1ae' : '#fffaf0';
        const fx = x + Math.sin(t * 1.3 + k) * 8;
        c.fillRect(fx, y, 2.4, 2.4);
        if (k % 6 === 0) c.drawImage(G, fx - 6, y - 6, 12, 12);
      }
    }
  }
}
