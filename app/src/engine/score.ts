// The score (data/score.json, built by analysis/build.py): every note of the edit with its exact
// time in the rendered audio, plus bars, fermatas, named sections and the detected fate motifs.
// This is what lyrics.ts was in pdoom-video: scenes look things up here, never hard-code times.

export type Family = 'strings' | 'woodwind' | 'brass' | 'percussion';

export interface Part { id: string; name: string; family: Family; program: number; segment: string }

export interface Note {
  /** Start and duration (s). */
  t: number; d: number;
  /** MIDI pitch, velocity 1..127. */
  p: number; v: number;
  /** Index into Score.parts. */
  part: number;
  /** Segment-local quarter position and length in quarters; bar number and quarter offset in the bar. */
  q: number; qd: number; bar: number; pos: number;
}

export interface Bar { segment: string; n: number; t: number; end: number }
export interface Fermata { segment: string; bar: number; t: number; end: number; gap: number }
export interface Section { segment: string; name: string; bars: [number, number]; start: number; end: number }
export interface Motif {
  /** Onsets of the four notes (da-da-da-DUM) and the end of the long note. */
  t: [number, number, number, number]; end: number;
  bar: number; parts: string[]; pitches: number[][];
}
export interface Segment { id: string; title: string; composer: string; year: number; meter: [number, number]; tempo_half: number; start: number; end: number }

interface ScoreJSON {
  segments: Segment[]; parts: Part[]; notes: Note[]; bars: Bar[]; fermatas: Fermata[];
  sections: Section[]; motifs: Motif[]; duration: number; beats: number[]; downbeats: number[];
}

export class Score {
  segments: Segment[];
  parts: Part[];
  notes: Note[];
  bars: Bar[];
  fermatas: Fermata[];
  sections: Section[];
  motifs: Motif[];
  duration: number;
  private partIdx = new Map<string, number>();

  constructor(j: ScoreJSON) {
    this.segments = j.segments;
    this.parts = j.parts;
    this.notes = j.notes.slice().sort((a, b) => a.t - b.t || a.part - b.part || a.p - b.p);
    this.bars = j.bars;
    this.fermatas = j.fermatas;
    this.sections = j.sections;
    this.motifs = j.motifs;
    this.duration = j.duration;
    // ids repeat across segments (every symphony has a 'vl1'): plain ids resolve to their first use,
    // `segment:id` to the part of that segment
    j.parts.forEach((p, i) => { if (!this.partIdx.has(p.id)) this.partIdx.set(p.id, i); this.partIdx.set(`${p.segment}:${p.id}`, i); });
  }

  static async load(): Promise<Score> {
    const r = await fetch('data/score.json');
    if (!r.ok) throw new Error('data/score.json missing: run `uv run python build.py` in analysis/');
    return new Score(await r.json());
  }

  /** Index of a part by id ('vl1', 'timp' …, the first segment's) or by 'segment:id' ('m40:va'), or -1. */
  partIndex(id: string) { return this.partIdx.get(id) ?? -1; }
  family(n: Note): Family { return this.parts[n.part]!.family; }

  /** First note index with t >= x (binary search). */
  private lower(x: number) {
    let lo = 0, hi = this.notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.notes[m]!.t < x) lo = m + 1; else hi = m; }
    return lo;
  }

  /** Notes starting in [t0, t1), optionally filtered by part ids or families. */
  notesIn(t0: number, t1: number, filter?: { parts?: string[]; family?: Family | Family[] }): Note[] {
    const out: Note[] = [];
    const parts = filter?.parts ? new Set(filter.parts.map((p) => this.partIndex(p))) : null;
    const fams = filter?.family ? new Set(Array.isArray(filter.family) ? filter.family : [filter.family]) : null;
    for (let i = this.lower(t0); i < this.notes.length && this.notes[i]!.t < t1; i++) {
      const n = this.notes[i]!;
      if (parts && !parts.has(n.part)) continue;
      if (fams && !fams.has(this.family(n))) continue;
      out.push(n);
    }
    return out;
  }

  /** Notes sounding at t (started at or before t, not yet ended). Notes are at most a few bars long. */
  sounding(t: number, maxLen = 12): Note[] {
    return this.notesIn(t - maxLen, t + 1e-6).filter((n) => n.t + n.d > t);
  }

  /** 0..1 how far a note has sounded at t (0 before it starts, 1 once it ended). */
  static progress(n: Note, t: number) { return Math.max(0, Math.min(1, (t - n.t) / Math.max(1e-3, n.d))); }

  /** Seconds since the note started (negative before). */
  static age(n: Note, t: number) { return t - n.t; }

  /** The bar containing t (during a caesura: the bar before it), or undefined before/after the music. */
  barAt(t: number): Bar | undefined {
    let lo = 0, hi = this.bars.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.bars[m]!.t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans < 0 ? undefined : this.bars[ans];
  }

  /** Continuous bar position (bar number + fraction through it; holds at 1 through a caesura). */
  barPos(t: number): number {
    const b = this.barAt(t);
    if (!b) return 0;
    return b.n + Math.min(1, (t - b.t) / (b.end - b.t));
  }

  bar(n: number, segment?: string): Bar {
    const b = this.bars.find((x) => x.n === n && (!segment || x.segment === segment));
    if (!b) throw new Error(`no bar ${n}${segment ? ` in ${segment}` : ''}`);
    return b;
  }

  section(name: string, segment?: string): Section {
    const s = this.sections.find((x) => x.name === name && (!segment || x.segment === segment));
    if (!s) throw new Error(`no section '${name}'`);
    return s;
  }

  sectionAt(t: number): Section | undefined { return this.sections.find((s) => t >= s.start && t < s.end); }

  fermataAt(t: number): Fermata | undefined { return this.fermatas.find((f) => t >= f.t && t < f.end + f.gap); }

  /** Motifs whose first note is in [t0, t1). */
  motifsIn(t0: number, t1: number) { return this.motifs.filter((m) => m.t[0] >= t0 && m.t[0] < t1); }

  /** The motif in progress at t (from its first note to the end of its long note). */
  motifAt(t: number) {
    let best: Motif | undefined;
    for (const m of this.motifs) if (t >= m.t[0] - 1e-6 && t < m.end) best = m;
    return best;
  }
}

/** MIDI pitch -> name ('C4' = 60), with flats as the key of C minor spells them. */
export function pitchName(p: number) {
  const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  return `${names[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
}

/**
 * Diatonic staff step of a pitch, for placing noteheads on a staff: 0 = middle C (C4), +1 per
 * line/space. Accidentals follow C minor (E♭, A♭, B♭ sit on E, A, B), sharps on the note below.
 */
export function staffStep(p: number) {
  const pc = ((p % 12) + 12) % 12, oct = Math.floor(p / 12) - 5;
  //               C  D♭ D  E♭ E  F  F♯ G  A♭ A  B♭ B
  const STEP = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  return oct * 7 + STEP[pc]!;
}
