"""The opening: the orchestra tuning under the title cards, before the first bar of the music.

    uv run python opening.py     # audio/opening.wav + .mp3 (exactly PREROLL seconds), data/opening.json

The opening sits before time 0 of the edit (the renderer's time runs from -PREROLL), so its length can
change without moving a single note of the music (and without invalidating the rendered segments).
The concert ritual: the oboe gives the A, the strings take it up (each a few cents off, then settling),
the low strings and the winds join with their open fifths, then everyone stops; a silence; the knock.
"""
from __future__ import annotations

import json

import numpy as np
import soundfile as sf

from build import ROOT, SF2_CANDIDATES, SR, hall_ir
from scipy.signal import fftconvolve

PREROLL = 3.5  # seconds before the first bar (a whole number of frames at 60 fps)
POSTROLL = 9.0  # seconds after the music: the epilogue (the quote and the dedication), in silence
FADE = (1.9, 2.6)  # everybody stops
PEAK = 0.33  # well under the music (which peaks at -1 dBFS): this is the room before the concert

# channel: (GM program, cents off)
CH = {0: (68, +2), 1: (40, -6), 2: (40, +7), 3: (41, -4), 4: (42, +3), 5: (43, 0), 6: (60, -9), 7: (73, +4), 8: (71, -3), 10: (48, 0)}
# (time, channel, pitch, velocity, duration)
NOTES = [
    (0.13, 0, 69, 72, 1.6),  # oboe: the A
    (0.39, 1, 69, 56, 1.1), (0.48, 2, 69, 50, 0.9), (0.58, 3, 57, 52, 1.0), (0.65, 4, 45, 58, 1.1),
    (0.77, 5, 33, 60, 1.2), (0.85, 10, 57, 36, 1.5), (0.85, 10, 69, 34, 1.5), (0.89, 6, 57, 44, 0.8),
    (1.00, 7, 81, 40, 0.5), (1.12, 8, 69, 40, 0.6),
    # the open strings, fifth by fifth
    (0.73, 1, 76, 48, 0.8), (1.27, 2, 62, 46, 0.6), (1.27, 2, 69, 44, 0.6), (1.39, 3, 55, 46, 0.6),
    (1.46, 4, 38, 52, 0.8), (1.52, 1, 76, 44, 0.5), (1.69, 7, 81, 36, 0.3), (1.58, 8, 62, 36, 0.4),
]


# the channels as orchestra parts, for the sampled orchestra (vsco.py): (part id, GM program)
CH_PART = {0: ("ob", 68), 1: ("vl1", 40), 2: ("vl2", 40), 3: ("va", 41), 4: ("vc", 42), 5: ("cb", 43), 6: ("cor", 60),
           7: ("fl", 73), 8: ("cl", 71), 10: ("vl2", 48)}


def render_vsco_dry() -> np.ndarray:
    """The tuning on the VSCO samples (like the music): the stop is an envelope on the dry mix."""
    from vsco import render_vsco
    chans = sorted(CH)
    doc = dict(duration=PREROLL, parts=[dict(id=CH_PART[c][0], program=CH_PART[c][1]) for c in chans],
               notes=[dict(t=t, d=d, p=p, v=v, part=chans.index(ch)) for t, ch, p, v, d in NOTES])
    dry = render_vsco(doc, SR)
    tt = np.arange(len(dry)) / SR
    env = (1 - np.clip((tt - FADE[0]) / (FADE[1] - FADE[0]), 0, 1)) ** 1.5
    return dry * env[:, None]


def render(engine: str = "vsco") -> np.ndarray:
    total = int(round(PREROLL * SR))
    if engine == "vsco":
        dry = render_vsco_dry()[:total]
    else:
        dry = render_gm_dry()
    ir = hall_ir()
    wet = np.stack([fftconvolve(dry[:, c], ir[:, c])[:total] for c in range(2)], axis=1)
    mix = 0.7 * dry + 0.5 * wet
    mix *= PEAK / (np.abs(mix).max() + 1e-9)
    # the last stretch is silence (the conductor's raised baton): fade the reverb out before it
    s0, s1 = int((PREROLL - 0.9) * SR), int((PREROLL - 0.55) * SR)
    mix[s0:s1] *= np.linspace(1, 0, s1 - s0)[:, None] ** 2
    mix[s1:] = 0
    return mix


def render_gm_dry() -> np.ndarray:
    import tinysoundfont

    sf2 = next(p for p in SF2_CANDIDATES if p.exists())
    synth = tinysoundfont.Synth(samplerate=SR, gain=-4)
    sfid = synth.sfload(str(sf2))
    for ch, (prog, cents) in CH.items():
        synth.program_select(ch, sfid, 0, prog)
        synth.control_change(ch, 10, 30 + (ch * 23) % 70)
        synth.control_change(ch, 7, 110)
        synth.pitchbend(ch, 8192 + round(cents / 200 * 8192))  # default bend range +-2 semitones
    ev = []
    for t, ch, p, v, d in NOTES:
        ev += [(t, 1, ch, p, v), (t + d, 0, ch, p, 0)]
    # the stop: expression down on every channel, in 20 ms steps
    for k in range(int((FADE[1] - FADE[0]) / 0.02) + 1):
        t = FADE[0] + k * 0.02
        e = round(127 * (1 - min(1, (t - FADE[0]) / (FADE[1] - FADE[0]))) ** 1.5)
        ev += [(t, 2, ch, 11, e) for ch in CH]
    ev.sort(key=lambda e: (e[0], e[1]))
    buf, pos = bytearray(), 0
    for t, kind, ch, a, b in ev:
        k = int(round(t * SR))
        if k > pos:
            buf += synth.generate(k - pos)
            pos = k
        if kind == 1:
            synth.noteon(ch, a, b)
        elif kind == 0:
            synth.noteoff(ch, a)
        else:
            synth.control_change(ch, a, b)
    total = int(round(PREROLL * SR))
    buf += synth.generate(total - pos)
    return np.frombuffer(bytes(buf), dtype=np.float32).reshape(-1, 2).astype(np.float64)[:total]


def main():
    mix = render()
    wav = ROOT / "audio/opening.wav"
    sf.write(wav, mix.astype(np.float32), SR, subtype="PCM_24")
    print(f"wrote {wav} ({len(mix) / SR:.3f} s)")
    import subprocess
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "256k",
                    "-write_xing", "1", str(wav.with_suffix(".mp3"))], check=True)
    # the epilogue's track: silence (the hall after the last chord)
    sf.write(ROOT / "audio/epilogue.wav", np.zeros((int(round(POSTROLL * SR)), 2), np.float32), SR, subtype="PCM_24")
    (ROOT / "data/opening.json").write_text(json.dumps(dict(preroll=PREROLL, postroll=POSTROLL, sr=SR), indent=1) + "\n", encoding="utf-8")
    print("wrote data/opening.json")


if __name__ == "__main__":
    main()
