"""Notehead pitches for the Beethoven 9/IV tutti pages (OpenScore, CC0): omr_heads.py's finder with the
19-staff layout of that score (a transcription aid: rhythm is read from the page, pitches from here).

    uv run --with pymupdf python omr_b9.py <page> <first staff index of the system> <first bar>

Written pitch is printed (clarinets in A sound a minor third lower, horns in D a minor seventh lower,
trumpets in D a major second higher).
"""
from __future__ import annotations

import sys

import omr_heads as O

STAVES = [  # name, clef, key: 'sharps' (D major), 'flat' (F major, the A clarinets), 'none'
    ("fl1", "treble", "s"), ("fl2", "treble", "s"), ("ob1", "treble", "s"), ("ob2", "treble", "s"),
    ("cl1", "treble", "f"), ("cl2", "treble", "f"), ("fg1", "bass", "s"), ("fg2", "bass", "s"),
    ("cfg", "bass", "s"), ("cor1", "treble", "n"), ("cor2", "treble", "n"), ("tr1", "treble", "n"),
    ("tr2", "treble", "n"), ("timp", "bass", "s"), ("vl1", "treble", "s"), ("vl2", "treble", "s"),
    ("va", "alto", "s"), ("vc", "bass", "s"), ("cb", "bass", "s"),
]


def name(step: int, key: str) -> str:
    octave = 4 + step // 7
    n = O.NAMES[step % 7]
    acc = "#" if key == "s" and n in "FC" else "b" if key == "f" and n == "B" else ""
    return f"{n}{acc}{octave}"


def main():
    page, first, bar0 = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
    ink = O.render("../score/beethoven9/b9-openscore.pdf", page, 600)
    st = O.staff_lines(ink)[first:first + len(STAVES)]
    bls = O.barlines(ink, st[14][0], st[18][4])
    print(f"{len(bls) - 1} bars, barlines {[int(b) for b in bls]}")
    for bi in range(len(bls) - 1):
        w = bls[bi + 1] - bls[bi]
        print(f"-- bar {bar0 + bi}")
        for si, s in enumerate(st):
            hs, sp = O.heads(ink, s, int(bls[bi]) + 3, int(bls[bi + 1]) - 3)
            if not hs:
                continue
            nm, clef, key = STAVES[si]
            ref = O.CLEFS[clef]
            out = []
            for x, y in hs:
                step = ref + round((s[4] - y) / (sp / 2))
                out.append(f"{name(step, key)}@{(x - bls[bi]) / w:.2f}")
            print(f"  {nm:5s} {' '.join(out)}")


if __name__ == "__main__":
    main()
