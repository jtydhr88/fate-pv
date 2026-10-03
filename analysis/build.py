"""Build the timing data and the sketch audio from the setlist.

    uv run python build.py              # data/score.json, audio/fate.wav + .mp3, data/audio.json
    uv run python build.py --no-audio   # timing data only (keeps the existing audio)

Pipeline:
  1. score   — read each segment's MIDI, keep its bar range, apply the tempo map (fermatas, caesuras)
               and the dynamics, so every note gets an exact start/duration in seconds.
  2. audio   — synthesize the notes with a SoundFont (tinysoundfont) plus a synthetic hall reverb.
  3. analyze — envelopes of the rendered mix (rms / low / mid / high) and, from the score itself,
               per-family envelopes and onset lists (tutti hits, timpani, melody), in the format the
               renderer's AudioData reads (same layout as pdoom-video's data/audio.json).

Everything is derived from the score, so it is deterministic and exact: no beat tracking, no alignment.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path

import mido
import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

from paths import local_path
from setlist import DYN, SETLIST

ROOT = Path(__file__).resolve().parents[1]
SR = 44100
FPS = 100
# fixed master gain per sound source (not normalised to the film's peak: see finish_audio)
MASTER_GAIN = dict(gm=0.55, vsco=0.85)
# the GM SoundFont for the --gm sketch: FATE_SF2 (environment or paths.local.json, see paths.py)
SF2_CANDIDATES = [p for p in [local_path("FATE_SF2")] if p]


# --------------------------------------------------------------------------- 1. score
def read_midi_notes(path: Path, parts):
    """Notes per part as (q_start, q_dur, pitch) in quarter notes, transposition applied."""
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat
    out = {}
    for track_idx, pid, *_rest, transpose in parts:
        tick, on, notes = 0, {}, []
        for msg in mid.tracks[track_idx]:
            tick += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                on.setdefault(msg.note, []).append(tick)
            elif msg.type in ("note_off", "note_on") and on.get(msg.note):
                s = on[msg.note].pop(0)
                notes.append((s / tpb, (tick - s) / tpb, msg.note + transpose))
        out[pid] = sorted(notes)
    return out


def read_text_notes(module: str, parts):
    """Notes per part from a hand transcription (analysis/scores/<module>.py, see its docstring),
    as (q_start, q_dur, pitch) in quarters from the start of bar 1; transposition applied."""
    import importlib
    import re
    mod = importlib.import_module(f"scores.{module}")
    num, den = mod.METER
    bq = num * 4 / den
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

    def midi(tok: str) -> int:
        m = re.fullmatch(r"([A-G])(#|b|n)?(-?\d)", tok)
        if not m:
            raise ValueError(f"bad pitch {tok!r}")
        acc = {"#": 1, "b": -1}.get(m.group(2) or "", 0)
        return 12 * (int(m.group(3)) + 1) + names[m.group(1)] + acc

    def expand(bar: str) -> list[str]:
        while "*" in bar:
            bar = re.sub(r"\*(\d+)\(([^()]*)\)", lambda mm: " ".join([mm.group(2)] * int(mm.group(1))), bar)
        return bar.split()

    out = {}
    for _trk, pid, *_rest, transpose in parts:
        bars = mod.PARTS[pid]
        notes, tie = [], {}
        for bi, bar in enumerate(bars):
            q = bi * bq
            if bar.strip() == "R":
                continue
            for tok in expand(bar):
                pitch, dur = tok.rsplit("/", 1)
                tied = dur.endswith("~")
                dur = dur.rstrip("~")
                dot = dur.endswith(".")
                qd = 4 / int(dur.rstrip(".")) * (1.5 if dot else 1)
                if pitch != "r":
                    for p in pitch.split("+"):
                        key = midi(p)
                        if key in tie:  # continue a tied note
                            s0, d0 = tie.pop(key)
                            start, total = s0, d0 + qd
                        else:
                            start, total = q, qd
                        if tied:
                            tie[key] = (start, total)
                        else:
                            notes.append((start, total, key + transpose))
                q += qd
            if abs(q - (bi + 1) * bq) > 1e-6:
                raise ValueError(f"{module} {pid} bar {bi + 1}: {q - bi * bq} quarters, expected {bq}")
        out[pid] = sorted(notes)
    return out


def read_xml_notes(path: Path, parts, bars, bq: float):
    """Notes per part from a MusicXML file (one part per staff, numbered from 0 in `parts`' track
    column), for the measures bars[0]..bars[1], placed so that measure bars[0] starts at quarter
    (bars[0] - 1) * bq like the MIDI readers (the measures must share the segment's meter). Ties are
    merged; grace notes are dropped. The parse is slow, so the notes are cached (.cache/<name>.json)."""
    cache = ROOT / "analysis/.cache" / (path.stem + ".notes.json")
    if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
        allnotes = json.loads(cache.read_text())
    else:
        import music21 as m21
        sc = m21.converter.parse(path)
        allnotes = []  # [staff, measure, offset in measure, quarters, pitch]
        for si, part in enumerate(sc.parts):
            for meas in part.stripTies(matchByPitch=True).getElementsByClass("Measure"):
                for n in meas.recurse().notes:
                    if n.duration.isGrace or n.duration.quarterLength <= 0:
                        continue
                    off = float(n.getOffsetInHierarchy(meas))
                    for pch in n.pitches:
                        allnotes.append([si, meas.number, round(off, 5), round(float(n.duration.quarterLength), 5), pch.midi])
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(allnotes))
    b0, b1 = bars
    out = {}
    for staff, pid, *_rest, transpose in parts:
        out[pid] = sorted(((b0 - 1 + mn - b0) * bq + off, qd, p + transpose)
                          for s_, mn, off, qd, p in allnotes if s_ == staff and b0 <= mn <= b1)
    return out


class TempoMap:
    """Quarter (segment-local) -> seconds, bar by bar. Each bar is linear at its own tempo (a fixed
    tempo_half, steps from seg["tempo"], linear ramps from seg["accel"]); fermata bars are longer, and a
    caesura after a fermata inserts silence (the map jumps). seg["holds"] inserts time inside a bar, at a
    quarter position (a fermata on a note in mid-bar, a breath on a rest): a note sounding across the
    position gets longer, the notes after it move later. seg["last_bar_q"] cuts the last bar short."""

    def __init__(self, seg, t0: float):
        num, den = seg["meter"]
        self.bq = num * 4 / den  # quarters per bar
        b0, b1 = seg["bars"]
        self.b0 = b0
        self.bars = []  # (bar, q0, t_start, t_end)
        self.detail = []  # (quarter seconds, holds [(q in bar, extra)], fermata extra, bar length in quarters)
        t = t0
        for b in range(b0, b1 + 1):
            qlen = seg.get("last_bar_q", self.bq) if b == b1 else self.bq
            quarter = 60.0 / (self.tempo_half(seg, b) * 2)
            holds = sorted(seg.get("holds", {}).get(b, []))
            extra, gap = seg["fermatas"].get(b, (0.0, 0.0))
            dur = qlen * quarter + extra + sum(e for _, e in holds)
            self.bars.append((b, (b - 1) * self.bq, t, t + dur))
            self.detail.append((quarter, holds, extra, qlen))
            t += dur + gap
        self.end = t

    @staticmethod
    def tempo_half(seg, b: int) -> float:
        v = seg["tempo_half"]
        for bar, th in seg.get("tempo", []):
            if b >= bar:
                v = th
        for a, z, h0, h1 in seg.get("accel", []):
            if a <= b <= z:
                v = h0 + (h1 - h0) * (b - a) / max(1, z - a)
            elif b > z:
                v = h1
        return v

    def index_of(self, q: float):
        i = int(math.floor(q / self.bq + 1e-9)) - (self.b0 - 1)
        return max(0, min(len(self.bars) - 1, i))

    def bar_of(self, q: float):
        return self.bars[self.index_of(q)]

    def t(self, q: float, end=False) -> float:
        """Time of quarter q. With end=True a q exactly on a barline (or on a hold) belongs to what comes
        before it (a note ending on the barline after a fermata ends at the fermata's end, not after the caesura)."""
        i = self.index_of(q - 1e-6 if end else q)
        _, q0, ts, te = self.bars[i]
        quarter, holds, extra, qlen = self.detail[i]
        lq = q - q0
        base = (te - ts - sum(e for _, e in holds))  # the bar without its holds (fermata extra spread over it)
        x = ts + base * min(lq, qlen) / qlen
        for hq, e in holds:
            if hq < lq - 1e-9 or (not end and abs(hq - lq) <= 1e-9):
                x += e
        return x


def dynamics_fn(seg):
    steps = sorted(seg["dynamics"])
    cres = seg.get("crescendos", [])
    sfz = set(seg.get("sforzandi", []))

    def mark_at(x: float) -> float:
        v = DYN[steps[0][1]]
        for b, m in steps:
            if x >= b - 1e-9:
                v = DYN[m]
        return v

    def vel(bar: int, pos_q: float, bq: float) -> int:
        x = bar + pos_q / bq  # continuous bar position
        v = mark_at(x)
        for a, b, to in cres:
            if a <= x < b + 1:
                start = mark_at(a)
                v = start + (DYN[to] - start) * (x - a) / (b + 1 - a)
        if bar in sfz and pos_q < 1e-6:
            v += 18
        return int(max(1, min(127, round(v))))

    return vel


def find_motifs(notes, parts):
    """The fate motif: three equal short notes then a longer note on another pitch (da-da-da-DUM),
    per part, merged across parts that play it together."""
    hits = []
    by_part = {}
    for n in notes:
        by_part.setdefault(n["part"], []).append(n)
    for pi, ns in by_part.items():
        # one voice per part for the pattern: the top note of each onset
        tops = {}
        for n in ns:
            k = round(n["q"], 4)
            if k not in tops or n["p"] > tops[k]["p"]:
                tops[k] = n
        seq = [tops[k] for k in sorted(tops)]
        for i in range(len(seq) - 3):
            a, b, c, d = seq[i : i + 4]
            short = all(x["qd"] <= 0.5 + 1e-6 for x in (a, b, c))
            same = a["p"] == b["p"] == c["p"]
            contiguous = all(abs((y["q"] - x["q"]) - 0.5) < 1e-6 for x, y in ((a, b), (b, c), (c, d)))
            if short and same and contiguous and d["qd"] >= 1.0 - 1e-6 and d["p"] != c["p"]:
                hits.append((a["t"], pi, [a, b, c, d]))
    motifs = []
    for t, pi, ns in sorted(hits, key=lambda h: h[0]):
        if motifs and abs(motifs[-1]["t"][0] - t) < 0.02:
            m = motifs[-1]
            m["parts"].append(parts[pi][1])
            m["pitches"].append([n["p"] for n in ns])
            continue
        motifs.append(dict(t=[round(n["t"], 4) for n in ns], end=round(ns[3]["t"] + ns[3]["d"], 4),
                           bar=ns[0]["bar"], parts=[parts[pi][1]], pitches=[[n["p"] for n in ns]]))
    return motifs


def build_score():
    doc = dict(segments=[], parts=[], notes=[], bars=[], fermatas=[], sections=[], motifs=[])
    t0 = 0.0
    for seg in SETLIST:
        parts = seg["parts"]
        t0 += seg.get("gap_before", 0.0)
        tm = TempoMap(seg, t0)
        if "midi" in seg:
            midi = read_midi_notes(ROOT / seg["midi"], parts)
        elif "xml" in seg:
            midi = read_xml_notes(ROOT / seg["xml"], parts, seg["bars"], tm.bq)
        else:
            midi = read_text_notes(seg["text"], parts)
        vel = dynamics_fn(seg)
        b0, b1 = seg["bars"]
        q_lo, q_hi = (b0 - 1) * tm.bq, (b1 - 1) * tm.bq + seg.get("last_bar_q", tm.bq)
        part_base = len(doc["parts"])
        for i, (_trk, pid, name, family, program, _tr) in enumerate(parts):
            doc["parts"].append(dict(id=pid, name=name, family=family, program=program, segment=seg["id"]))
        seg_notes = []
        for i, (_trk, pid, *_r) in enumerate(parts):
            for q, qd, p in midi[pid]:
                if q < q_lo - 1e-9 or q >= q_hi - 1e-9:
                    continue
                qe = min(q + qd, q_hi)
                bar = int(math.floor(q / tm.bq + 1e-9)) + 1
                pos = q - (bar - 1) * tm.bq
                ts, te = tm.t(q), tm.t(qe, end=True)
                seg_notes.append(dict(t=round(ts, 4), d=round(te - ts, 4), p=p, v=vel(bar, pos, tm.bq),
                                      part=part_base + i, q=round(q - q_lo, 4), qd=round(qe - q, 4),
                                      bar=bar, pos=round(pos, 4)))
        seg_notes.sort(key=lambda n: (n["t"], n["part"], n["p"]))
        doc["notes"] += seg_notes
        for b, q0, ts, te in tm.bars:
            doc["bars"].append(dict(segment=seg["id"], n=b, t=round(ts, 4), end=round(te, 4)))
        for b, (extra, gap) in seg["fermatas"].items():
            _, _, ts, te = tm.bars[b - b0]
            doc["fermatas"].append(dict(segment=seg["id"], bar=b, t=round(ts, 4), end=round(te, 4), gap=gap))
        for name, a, b in seg["sections"]:
            doc["sections"].append(dict(segment=seg["id"], name=name, bars=[a, b],
                                        start=round(tm.bars[a - b0][2], 4), end=round(tm.bars[b - b0][3], 4)))
        if seg.get("motifs", True):
            doc["motifs"] += find_motifs(seg_notes, [(None, p["id"]) for p in doc["parts"]])
        seg_end = tm.end
        doc["segments"].append(dict(id=seg["id"], title=seg["title"], composer=seg["composer"], year=seg["year"],
                                    meter=list(seg["meter"]), tempo_half=seg["tempo_half"],
                                    start=round(t0, 4), end=round(seg_end, 4)))
        t0 = seg_end
    doc["duration"] = round(t0 + SETLIST[-1].get("tail", 2.0), 4)
    # beats: every quarter of every bar (2 per bar in 2/4); downbeats: bar starts
    beats, downbeats = [], []
    for b in doc["bars"]:
        downbeats.append(b["t"])
        seg = next(s for s in SETLIST if s["id"] == b["segment"])
        n = seg["meter"][0] * 4 // seg["meter"][1]
        for k in range(n):
            beats.append(round(b["t"] + (b["end"] - b["t"]) * k / n, 4))
    doc["beats"], doc["downbeats"] = beats, downbeats
    return doc


# --------------------------------------------------------------------------- 2. audio
def hall_ir(sr=SR, rt60=2.3, predelay=0.018, seed=7):
    """Synthetic concert-hall impulse response: decorrelated stereo noise with an exponential
    decay, darker as it decays (two lowpassed layers crossfaded), a short pre-delay."""
    rng = np.random.default_rng(seed)
    n = int(sr * rt60 * 1.2)
    tt = np.arange(n) / sr
    env = np.exp(-6.91 * tt / rt60)
    ir = np.zeros((n + int(predelay * sr), 2), np.float32)
    for ch in range(2):
        noise = rng.standard_normal(n)
        bright = sosfilt(butter(2, 7000, "low", fs=sr, output="sos"), noise)
        dark = sosfilt(butter(2, 1800, "low", fs=sr, output="sos"), noise)
        k = np.clip(tt / (rt60 * 0.5), 0, 1)
        ir[int(predelay * sr):, ch] = (bright * (1 - k) + dark * k) * env
    return ir / np.sqrt((ir**2).sum(axis=0, keepdims=True)) * 0.9


def render_audio(doc, out_wav: Path, engine: str = "vsco"):
    """The edit's audio: the dry orchestra (VSCO samples through sfizz, or the GM SoundFont), the hall, the
    master gain. Writes the wav and an mp3 for the preview player."""
    if engine == "vsco":
        from vsco import render_vsco
        dry = render_vsco(doc, SR)
        sf2 = Path("VSCO 2 CE")
    else:
        dry, sf2 = render_gm(doc)
    finish_audio(doc, dry, out_wav, sf2.name, MASTER_GAIN[engine])


def render_gm(doc):
    """The sketch orchestra: every part on a GM SoundFont program (tinysoundfont)."""
    import tinysoundfont

    sf2 = next((p for p in SF2_CANDIDATES if p.exists()), None)
    if sf2 is None:
        raise SystemExit("no SoundFont found: set FATE_SF2 (environment or analysis/paths.local.json)")
    synth = tinysoundfont.Synth(samplerate=SR, gain=-4)
    sfid = synth.sfload(str(sf2))
    # one MIDI channel per part, skipping 9 (GM drums); orchestra-ish panning
    pan = dict(fl=50, ob=60, cl=70, fg=74, cor=40, tr=88, timp=64, vl1=28, vl2=48, va=78, vc=94, cb=104)
    chans = {}
    for i, p in enumerate(doc["parts"]):
        ch = i if i < 9 else i + 1
        chans[i] = ch
        synth.program_select(ch, sfid, 0, p["program"])
        try:
            synth.control_change(ch, 10, pan.get(p["id"], 64))
            synth.control_change(ch, 7, 110)
        except Exception:
            pass
    events = []
    for n in doc["notes"]:
        events.append((n["t"], 1, chans[n["part"]], n["p"], n["v"]))
        events.append((n["t"] + max(0.03, n["d"] - 0.012), 0, chans[n["part"]], n["p"], 0))
    events.sort(key=lambda e: (e[0], e[1]))
    buf = bytearray()
    pos = 0
    for t, kind, ch, p, v in events:
        k = int(round(t * SR))
        if k > pos:
            buf += synth.generate(k - pos)
            pos = k
        if kind:
            synth.noteon(ch, p, v)
        else:
            synth.noteoff(ch, p)
    total = int(round(doc["duration"] * SR))
    if total > pos:
        buf += synth.generate(total - pos)
    return np.frombuffer(bytes(buf), dtype=np.float32).reshape(-1, 2).astype(np.float64), sf2


def finish_audio(doc, dry, out_wav: Path, source: str, gain: float):
    ir = hall_ir()
    # the reverb in fixed blocks from time 0 (overlap-add): every output sample depends only on the audio
    # before it, bit for bit, so adding music later in the film leaves the earlier audio (and its
    # analysis, and the rendered segments fingerprinted on it) exactly as it was
    wet = np.zeros_like(dry)
    B = 1 << 17
    for k in range(0, len(dry), B):
        blk = np.stack([fftconvolve(dry[k:k + B, c], ir[:, c]) for c in range(2)], axis=1)
        n = min(len(blk), len(dry) - k)
        wet[k:k + n] += blk[:n]
    mix = 0.78 * dry + 0.42 * wet
    # gentle fade over the tail so the file ends in silence
    tail = int(1.2 * SR)
    mix[-tail:] *= np.linspace(1, 0, tail)[:, None] ** 2
    # a fixed master gain (not normalised to the whole film's peak, for the same reason), and a soft limit
    # that only touches the rare peaks above -1 dBFS
    mix *= gain
    over = np.abs(mix) > 0.89
    mix[over] = np.sign(mix[over]) * (0.89 + 0.1 * np.tanh((np.abs(mix[over]) - 0.89) / 0.1))
    print(f"peak {np.abs(mix).max():.3f} after master gain {gain}")
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_wav, mix.astype(np.float32), SR, subtype="PCM_24")
    print(f"wrote {out_wav} ({len(mix) / SR:.2f} s, {source})")
    mp3 = out_wav.with_suffix(".mp3")
    if shutil.which("ffmpeg"):
        # 0 encoder delay matters: the renderer's time 0 must be the file's first sample
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out_wav), "-c:a", "libmp3lame", "-b:a", "256k",
                        "-write_xing", "1", str(mp3)], check=True)
        print(f"wrote {mp3}")


# --------------------------------------------------------------------------- 3. analyze
def frame_rms(x, fps=FPS, win=2048):
    hop = SR / fps
    n = int(math.ceil(len(x) / SR * fps))
    pad = np.pad(x, (win // 2, win // 2 + int(hop) + 2))
    idx = (np.arange(n) * hop).astype(int)
    c = np.concatenate([[0.0], np.cumsum(pad.astype(np.float64) ** 2)])
    return np.sqrt(np.maximum((c[idx + win] - c[idx]) / win, 0))


def smooth_env(x, attack=0.010, release=0.090):
    aa, ar = math.exp(-1 / (attack * FPS)), math.exp(-1 / (release * FPS))
    y, s = np.empty_like(x), 0.0
    for i, v in enumerate(x):
        a = aa if v > s else ar
        s = a * s + (1 - a) * v
        y[i] = s
    return y


def norm01(x, pct=99.0):
    return np.clip(x / (np.percentile(x, pct) + 1e-12), 0, 1)


def piece_ranges(doc, n_frames):
    """Frame ranges of the pieces (segments sharing a title are one piece: the cuts of one movement).
    Each piece runs from its first segment's start to the next piece's start (the first from 0, the last
    to the end). Envelopes and onset strengths are normalised per piece, so adding or changing one piece
    leaves the numbers of every other piece exactly as they were (and their rendered segments valid)."""
    starts, last = [], None
    for sg in doc["segments"]:
        if sg["title"] != last:
            starts.append(sg["start"])
            last = sg["title"]
    edges = [0] + [int(round(s * FPS)) for s in starts[1:]] + [n_frames]
    return list(zip(edges[:-1], edges[1:]))


def norm_pieces(x, ranges, pct=99.0):
    y = np.zeros_like(x)
    for a, b in ranges:
        if b > a:
            y[a:b] = norm01(x[a:b], pct)
    return y


def analyze(doc, wav: Path):
    x, sr = sf.read(wav)
    assert sr == SR
    mono = x.mean(axis=1)
    feats = {"rms": mono}
    for name, (lo, hi) in dict(low=(None, 200), mid=(200, 2000), high=(4000, None)).items():
        if lo is None:
            sos = butter(4, hi, "low", fs=SR, output="sos")
        elif hi is None:
            sos = butter(4, lo, "high", fs=SR, output="sos")
        else:
            sos = butter(4, [lo, hi], "band", fs=SR, output="sos")
        feats[name] = sosfilt(sos, mono)
    n_frames = int(math.ceil(doc["duration"] * FPS))
    ranges = piece_ranges(doc, n_frames)
    out = {k: [round(float(v), 4) for v in norm_pieces(smooth_env(frame_rms(s))[:n_frames], ranges)] for k, s in feats.items()}

    # score-side envelopes: summed loudness of the notes sounding, per family (100 fps)
    fam_of = [p["family"] for p in doc["parts"]]
    grid = {f: np.zeros(n_frames) for f in ("strings", "woodwind", "brass", "percussion")}
    for nt in doc["notes"]:
        a, b = int(nt["t"] * FPS), int((nt["t"] + nt["d"]) * FPS) + 1
        grid[fam_of[nt["part"]]][a:b] += (nt["v"] / 127.0) ** 2
    for f, g in grid.items():
        out[f] = [round(float(v), 4) for v in norm_pieces(smooth_env(g, 0.005, 0.12), ranges, 99.5)]
    # the renderer's AudioSample has vocal/drums/bass/other slots: map them to the orchestra
    out["vocal"], out["drums"], out["bass"], out["other"] = out["strings"], out["percussion"], out["low"], out["woodwind"]

    # onsets [time, strength]
    by_t = {}
    for nt in doc["notes"]:
        by_t.setdefault(round(nt["t"], 3), []).append(nt)
    tutti, anyon = [], []
    for t, ns in sorted(by_t.items()):
        w = sum((n["v"] / 127.0) ** 2 for n in ns)
        anyon.append([t, w])
    # strengths relative to the loudest onset cluster of the same piece
    piece_of = lambda t: next((i for i, (a, b) in enumerate(ranges) if a <= t * FPS < b), len(ranges) - 1)
    mx = {}
    for t, w in anyon:
        mx[piece_of(t)] = max(mx.get(piece_of(t), 0), w)
    anyon = [[t, round(min(1, w / (mx[piece_of(t)] or 1)), 4)] for t, w in anyon]
    tutti = [[t, s] for t, s in anyon if s >= 0.35]
    pid = {p["id"]: i for i, p in enumerate(doc["parts"])}
    # every segment's timpani, and its melody (first violins, the solo violin, the organ's right hand)
    timp_parts = {i for i, p in enumerate(doc["parts"]) if p["id"] == "timp"}
    mel_parts = {i for i, p in enumerate(doc["parts"]) if p["id"] in ("vl1", "solo", "rh", "vl")}
    timp = sorted({(round(n["t"], 3), round(n["v"] / 127, 3)) for n in doc["notes"] if n["part"] in timp_parts})
    mel = sorted({(round(n["t"], 3), round(n["v"] / 127, 3)) for n in doc["notes"] if n["part"] in mel_parts})
    onsets = dict(kick=tutti, snare=[list(x) for x in timp], hat=anyon, vocal=[list(x) for x in mel],
                  tutti=tutti, timp=[list(x) for x in timp], any=anyon, melody=[list(x) for x in mel])

    seg0 = doc["segments"][0]
    audio = dict(
        duration=doc["duration"], bpm=seg0["tempo_half"] * 2, fps=FPS,
        beats=doc["beats"], downbeats=doc["downbeats"],
        sections=[dict(name=s["name"], start=s["start"], end=s["end"]) for s in doc["sections"]],
        onsets=onsets, **out,
        notes=("Rendered from the score (analysis/build.py): beats are quarters of the tempo map, downbeats bar "
               "starts (fermata bars are longer, caesuras add silence). rms/low/mid/high: envelopes of the rendered "
               "mix, 100 fps, 10 ms attack / 90 ms release, /99th percentile. strings/woodwind/brass/percussion: "
               "summed (velocity/127)^2 of the sounding notes per family, smoothed. vocal=strings, drums=percussion, "
               "bass=low, other=woodwind (the renderer's legacy slots). onsets: tutti = note-onset clusters with at "
               "least 35% of the loudest cluster's weight (also in 'kick'), timp (also 'snare'), any (also 'hat'), "
               "melody = Violino I (also 'vocal')."),
    )
    return audio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--gm", action="store_true", help="the GM SoundFont sketch instead of the VSCO samples")
    a = ap.parse_args()
    doc = build_score()
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/score.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"score: {len(doc['notes'])} notes, {len(doc['bars'])} bars, {len(doc['motifs'])} fate motifs, "
          f"{doc['duration']:.2f} s")
    for m in doc["motifs"]:
        print(f"  motif bar {m['bar']:>3} t={m['t'][0]:7.3f}  {','.join(m['parts'])}")
    wav = ROOT / "audio/fate.wav"
    if not a.no_audio:
        render_audio(doc, wav, "gm" if a.gm else "vsco")
    audio = analyze(doc, wav)
    (ROOT / "data/audio.json").write_text(json.dumps(audio, separators=(",", ":")), encoding="utf-8")
    print("wrote data/score.json, data/audio.json")


if __name__ == "__main__":
    main()
