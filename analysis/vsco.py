"""The orchestra, sampled: render the edit's notes through the VS Chamber Orchestra Community Edition
(VSCO 2 CE, CC0 samples, SFZ mappings) with sfizz's offline renderer, instead of the GM SoundFont.

    uv run python build.py --vsco      # (build.py calls render_vsco)

Each part's notes are split by articulation (a long note on the sustain patch, a short one on the
staccato / spiccato patch) and, for the string and brass sections, by register (a part that runs below
the cello section's range drops to the basses, etc.). One MIDI file per (part, patch) goes through
sfizz_render; the stems are cached by content (analysis/.cache/vsco/<hash>.wav), so after an edit only the
stems whose notes changed are rendered again. Stems are panned, levelled per patch and summed; build.py
adds the hall and the master gain as before.

Setup: VSCO-2-CE (master: samples; branch SFZ: the .sfz files, copied next to the samples) and the
sfizz release (sfizz_render). Their paths: FATE_VSCO / FATE_SFIZZ in the environment or analysis/paths.local.json.
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

from paths import require

# the sample library and the renderer: FATE_VSCO / FATE_SFIZZ (environment or paths.local.json, see paths.py)
VSCO = require("FATE_VSCO", "VSCO 2 CE")
SFIZZ = require("FATE_SFIZZ", "sfizz_render")
CACHE = Path(__file__).resolve().parent / ".cache/vsco"

SHORT = 0.24  # seconds: shorter notes go to the staccato / spiccato patch
HEADROOM = 9.0  # dB: sfizz_render writes 16-bit, so patches play this much quieter and the mix makes it up

# instrument -> (sustain patch, short patch, level dB)
INSTR = {
    "violins": ("ViolinEnsSusVib", "ViolinEnsSpic", 0.0),
    "violas": ("ViolaEnsSusVib", "ViolaEnsSpic", 0.0),
    "cellos": ("CelloEnsSusVib", "CelloEnsSpic", 0.0),
    "basses": ("ContrabassSusVB", "ContrabassSpic", 1.0),
    "solo_violin": ("SViolinVib", "SViolinSpic", 1.0),
    "violins_pizz": ("ViolinEnsPizz", "ViolinEnsPizz", 2.0),
    "cellos_pizz": ("CelloEnsPizz", "CelloEnsPizz", 2.0),
    "basses_pizz": ("ContrabassPizz", "ContrabassPizz", 3.0),
    "flute": ("FluteSusVib", "FluteStac", -1.0),
    "oboe": ("OboeSusVib", "OboeStac", -1.0),
    "clarinet": ("ClarinetSus", "ClarinetStac", -1.0),
    "bassoon": ("BassoonSus", "BassoonStac", 0.0),
    "horn": ("FHornSus", "FHornStac", -1.0),
    "trumpet": ("TrumpetSus", "TrumpetStac", -2.0),
    "trombone": ("TromboneSus", "TromboneStac", -1.0),
    "tuba": ("TubaSus", "TubaStac", 0.0),
    "timpani": ("Timpani", "Timpani", 0.0),
    "organ": ("OrganLoud", "OrganLoud", -4.0),
    "organ_pedal": ("OrganLoudPedal", "OrganLoudPedal", -4.0),
}

# GM program (as the setlist uses them) -> instrument family name
BY_PROGRAM = {73: "flute", 68: "oboe", 71: "clarinet", 70: "bassoon", 60: "horn", 56: "trumpet", 57: "trombone",
              58: "tuba", 47: "timpani", 19: "organ", 45: "pizz", 48: "strings", 40: "strings", 41: "strings", 42: "strings"}

# orchestra seating (pan -1 left .. 1 right)
PAN = dict(vl1=-0.55, vl2=-0.3, solo=0.0, vl=-0.45, rh=-0.2, va=0.25, vc=0.45, lh=0.3, cb=0.6, fl=-0.15, ob=0.1,
           cl=-0.1, fg=0.15, cor=-0.35, cor1=-0.4, cor2=-0.3, tr=0.35, trb=0.5, timp=0.0, ped=0.0)


def sfz_range(name: str) -> tuple[int, int]:
    """Lowest and highest key a patch maps (over all its regions)."""
    txt = (VSCO / f"{name}.sfz").read_text(errors="ignore")
    keys = [int(x) for x in re.findall(r"(?:lokey|hikey|key)=(\d+)", txt)]
    return (min(keys), max(keys)) if keys else (0, 127)


_RANGES: dict[str, tuple[int, int]] = {}


def fits(inst: str, p: int) -> bool:
    sus = INSTR[inst][0]
    if sus not in _RANGES:
        _RANGES[sus] = sfz_range(sus)
    lo, hi = _RANGES[sus]
    return lo <= p <= hi


def instrument_for(part: dict, p: int) -> str:
    """The VSCO instrument that plays pitch p for this part (strings and pizzicato by register)."""
    fam = BY_PROGRAM.get(part["program"], "strings")
    pid = part["id"]
    if fam == "organ":
        return "organ_pedal" if pid == "ped" or p < 36 else "organ"
    if fam == "pizz":
        return "basses_pizz" if p < 36 else "cellos_pizz" if p < 55 else "violins_pizz"
    if fam == "strings":
        if pid == "solo":
            return "solo_violin"
        # the part's own section first, then the nearest section that reaches the note
        own = {"vl1": "violins", "vl2": "violins", "vl": "violins", "rh": "violins", "va": "violas",
               "vc": "cellos", "lh": "cellos", "cb": "basses"}.get(pid, "violins")
        order = {"violins": ["violins", "violas", "cellos", "basses"], "violas": ["violas", "violins", "cellos", "basses"],
                 "cellos": ["cellos", "basses", "violas", "violins"], "basses": ["basses", "cellos", "violas", "violins"]}[own]
        for inst in order:
            if fits(inst, p):
                return inst
        return own
    if fam == "trombone" and not fits("trombone", p):
        return "tuba"
    return fam


def octave_into(inst: str, p: int) -> int:
    """Move a pitch by octaves into the patch's range (a doubling part written beyond the instrument)."""
    sus = INSTR[inst][0]
    if sus not in _RANGES:
        _RANGES[sus] = sfz_range(sus)
    lo, hi = _RANGES[sus]
    while p < lo:
        p += 12
    while p > hi:
        p -= 12
    return p


def wrapper(patch: str) -> Path:
    """A copy of the patch next to the library's (so its sample paths resolve) that plays HEADROOM dB down:
    every volume opcode lowered, and a global one where the file sets none."""
    src = (VSCO / f"{patch}.sfz").read_text(errors="ignore")
    txt = re.sub(r"volume=(-?[\d.]+)", lambda m: f"volume={float(m.group(1)) - HEADROOM:g}", src)
    if re.search(r"<global>", txt):
        # the global header's own block: add the cut if it sets no volume before the next header
        i = txt.index("<global>") + len("<global>")
        nxt = re.search(r"<(group|region|master|control|curve|effect)>", txt[i:])
        block = txt[i: i + nxt.start()] if nxt else txt[i:]
        if "volume=" not in block:
            txt = txt[:i] + f"\nvolume=-{HEADROOM:g}\n" + txt[i:]
    else:
        first = re.search(r"<(group|region|master)>", txt)
        k = first.start() if first else len(txt)
        txt = txt[:k] + f"<global>\nvolume=-{HEADROOM:g}\n" + txt[k:]
    w = VSCO / f"_fate_{patch}.sfz"
    if not w.exists() or w.read_text() != txt:
        w.write_text(txt)
    return w


# expression (CC11: sfizz maps it to amplitude): patches that sustain get a curve; plucked, struck and the
# organ (no expression of its own) don't
NO_EXPRESSION = ("Pizz", "Spic", "Stac", "Timpani", "Organ")
CC_BASE = 100  # a held note starts here: room above it for a crescendo inside the note
CC_STEP = 0.02  # seconds between curve points


def expression(notes, level) -> list[tuple[float, int]]:
    """CC11 curve [(t, value)] for one stem's notes [(t, d, p, v)] (film time): within each note it follows the
    dynamic level relative to the level at the note's attack (a crescendo grows inside a held note, a
    diminuendo fades it), and a long note breathes: a slight swell to its middle, easing off at the end."""
    out, last = [], None
    ons = sorted(notes)
    j = 0
    if not ons:
        return out
    t, t_end = ons[0][0], max(a + d for a, d, *_ in ons)
    cur = None
    while t <= t_end + 1e-9:
        while j < len(ons) and ons[j][0] <= t + 1e-9:
            cur = ons[j]
            j += 1
        on, d = cur[0], cur[1]
        rel = level(t) / max(1.0, level(on))
        u = (t - on) / d if d > 0 else 1.0
        swell = 1.0
        if d >= 0.5 and u <= 1.0:
            swell = 0.94 + 0.1 * np.sin(np.pi * u) - 0.1 * np.clip((u - 0.8) / 0.2, 0, 1) ** 2
        v = int(round(np.clip(CC_BASE * rel * swell, 25, 127)))
        if v != last:
            out.append((round(t, 4), v))
            last = v
        t = round(t + CC_STEP, 6)
    return out


def write_midi(notes, path: Path, duration: float, cc=()):
    """Notes [(t, d, p, v)] and CC11 points [(t, value)] at exact seconds: tempo 120, 960 ticks per quarter
    (1/1920 s per tick). A controller change sorts before a note-on on the same tick."""
    m = mido.MidiFile(ticks_per_beat=960)
    tr = mido.MidiTrack()
    m.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    ev = []
    for t, d, p, v in notes:
        ev.append((round(t * 1920), 2, p, v))
        ev.append((round((t + max(0.03, d - 0.012)) * 1920), 0, p, 0))
    for t, v in cc:
        ev.append((round(t * 1920), 1, 11, v))
    ev.sort(key=lambda e: (e[0], e[1]))
    now = 0
    for tick, kind, a, b in ev:
        if kind == 1:
            tr.append(mido.Message("control_change", control=a, value=b, time=tick - now))
        elif kind == 2:
            tr.append(mido.Message("note_on", note=a, velocity=max(1, min(127, b)), time=tick - now))
        else:
            tr.append(mido.Message("note_off", note=a, velocity=0, time=tick - now))
        now = tick
    tr.append(mido.MetaMessage("end_of_track", time=max(0, round(duration * 1920) - now)))
    m.save(path)


def stem(notes, patch: str, sr: int, cc=()) -> tuple[float, np.ndarray]:
    """Render (cached) one patch's notes. The stem starts 0.5 s before its first note and runs 4 s past its
    last (the release); notes are stored relative to that start, so the cache survives the piece moving
    in the film. Returns (start time in the film, stereo float array)."""
    t0 = max(0.0, min(t for t, *_ in notes) - 0.5)
    rel = [(round(t - t0, 4), d, p, v) for t, d, p, v in notes]
    rcc = [(round(t - t0, 4), v) for t, v in cc]
    length = max(t + d for t, d, *_ in rel) + 4.0
    key = hashlib.sha1(repr((patch, sr, HEADROOM, rel, rcc)).encode()).hexdigest()[:20]
    wav = CACHE / f"{patch}-{key}.wav"
    if not wav.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        mid = CACHE / f"{patch}-{key}.mid"
        write_midi(rel, mid, length, rcc)
        subprocess.run([str(SFIZZ), "--sfz", str(wrapper(patch)), "--midi", str(mid), "--wav", str(wav),
                        "-s", str(sr), "--use-eot"], check=True, capture_output=True)
        mid.unlink()
    x, _ = sf.read(wav, dtype="float64", always_2d=True)
    return t0, (x[:, :2] if x.shape[1] >= 2 else np.repeat(x, 2, axis=1))


def render_vsco(doc, sr: int) -> np.ndarray:
    """The dry orchestra (stereo, float64, the film's duration): one stem per (part, patch), panned and summed."""
    duration = doc["duration"]
    groups: dict[tuple[int, str], list] = {}
    for n in doc["notes"]:
        part = doc["parts"][n["part"]]
        inst = instrument_for(part, n["p"])
        sus, short, _db = INSTR[inst]
        patch = short if n["d"] < SHORT else sus
        groups.setdefault((n["part"], patch, inst), []).append((round(n["t"], 4), round(n["d"], 4), octave_into(inst, n["p"]), n["v"]))
    # the dynamic level of each segment over time: at every onset, the median velocity of the notes there
    # (accents stand out of the median), interpolated between onsets
    levels = {}
    for n in doc["notes"]:
        seg = doc["parts"][n["part"]].get("segment")
        levels.setdefault(seg, {}).setdefault(round(n["t"], 3), []).append(n["v"])
    curves = {}
    for seg, by_t in levels.items():
        ts = np.array(sorted(by_t))
        curves[seg] = (ts, np.array([float(np.median(by_t[t])) for t in ts]))
    mix = np.zeros((int(round(duration * sr)), 2))
    for (pi, patch, inst), notes in sorted(groups.items()):
        cc = []
        if not any(k in patch for k in NO_EXPRESSION):
            ts, vs = curves[doc["parts"][pi].get("segment")]
            cc = expression(sorted(notes), lambda t, ts=ts, vs=vs: float(np.interp(t, ts, vs)))
        t0, x = stem(sorted(notes), patch, sr, cc)
        k0 = int(round(t0 * sr))
        x = x[: max(0, len(mix) - k0)]
        pan = PAN.get(doc["parts"][pi]["id"], 0.0)
        # constant-power pan of a stereo stem: lean it, don't collapse it
        a = (pan + 1) * np.pi / 4
        g = 10 ** ((INSTR[inst][2] + HEADROOM) / 20)
        mix[k0:k0 + len(x), 0] += x[:, 0] * np.cos(a) * np.sqrt(2) * g
        mix[k0:k0 + len(x), 1] += x[:, 1] * np.sin(a) * np.sqrt(2) * g
    print(f"vsco: {len(groups)} stems")
    return mix
