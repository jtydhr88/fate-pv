"""Notehead finder for a cleanly engraved score page (a transcription aid, not an OMR system).

    uv run python omr_heads.py <page.pdf> <page-number> [--dpi 300] [--staves 11]

Renders the page, finds the staff lines (5 per staff), groups the staves into systems, finds the
barlines of each system, and lists the noteheads of every bar of every staff with their pitch (from
the clef and key signature given in CLEFS below). Durations are not read: the person transcribing reads
the rhythm from the page and the pitches from here, so wrong-line errors (the usual transcription
mistake) are measured away.
"""
from __future__ import annotations

import sys
import numpy as np
from scipy import ndimage as ndi

# clef of each staff in system order, and the reference: (staff step of the bottom line, as diatonic
# step from C4 = 0). Treble bottom line E4 = 2; alto F3 = -4; bass G2 = -10.
CLEFS = {"treble": 2, "alto": -4, "bass": -10}
NAMES = "CDEFGAB"


def step_name(step: int, keysig_flats: set[str]) -> str:
    octave = 4 + step // 7
    n = NAMES[step % 7]
    acc = "b" if n in keysig_flats else ""
    return f"{n}{acc}{octave}"


def render(pdf: str, page: int, dpi: int):
    import fitz
    d = fitz.open(pdf)
    pix = d[page - 1].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    return a < 140


def staff_lines(ink: np.ndarray):
    h, w = ink.shape
    rows = ink.sum(1)
    cand = [y for y in range(h) if rows[y] > w * 0.35]
    lines = []
    for y in cand:
        if lines and y - lines[-1][-1] <= 1:
            lines[-1].append(y)
        else:
            lines.append([y])
    ys = [float(np.mean(g)) for g in lines]
    # a staff is five lines at an even spacing; anything else (long beams, brackets) is skipped
    staves, i = [], 0
    while i + 4 < len(ys):
        g = ys[i:i + 5]
        d = np.diff(g)
        if d.max() - d.min() < max(2.0, 0.15 * d.mean()) and d.mean() > 6:
            staves.append(g); i += 5
        else:
            i += 1
    return [s for s in staves if len(s) == 5]


def heads(ink: np.ndarray, staff: list[float], x0: int, x1: int):
    sp = (staff[4] - staff[0]) / 4
    y0, y1 = int(staff[0] - sp * 4.5), int(staff[4] + sp * 4.5)
    if x1 - x0 < 4:
        return [], sp
    sub = ink[y0:y1, x0:x1].copy()
    # hollow heads (half, whole notes): fill only small enclosed holes, not the cells between beams and stems
    holes = ndi.binary_fill_holes(sub) & ~sub
    hl, hn = ndi.label(holes)
    if hn:
        sizes = ndi.sum(holes, hl, range(1, hn + 1))
        small = np.isin(hl, [i + 1 for i, z in enumerate(sizes) if z < sp * sp * 0.6])
        sub |= small
    # remove staff and ledger lines and stems: opening with a disk ~ 0.32 spaces
    r = max(2, int(sp * 0.32))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disk = (xx ** 2 + yy ** 2) <= r * r
    op = ndi.binary_opening(sub, structure=disk)
    lab, n = ndi.label(op)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        hgt, wid = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        area = (lab[sl] == i).sum()
        # a head is about one space tall and 1.2-1.5 spaces wide; chords stack heads vertically
        if wid < sp * 0.8 or wid > sp * 2.2 or hgt < sp * 0.6 or area < sp * sp * 0.5:
            continue
        # rests and beams are flat bars: a head is an oval whose height is close to one space per head
        if hgt < sp * 0.75 and wid > sp * 1.5:
            continue
        fill = area / (hgt * wid)
        if fill > 0.92:  # rectangles (whole/half rests, beam fragments)
            continue
        nheads = max(1, round(hgt / (sp * 1.0)))
        for k in range(nheads):
            cy = sl[0].start + hgt * (k + 0.5) / nheads + y0
            out.append(((sl[1].start + sl[1].stop) / 2 + x0, cy))
    return sorted(out), sp


def barlines(ink: np.ndarray, top: float, bottom: float):
    cols = ink[int(top):int(bottom) + 1, :].mean(0)
    xs = [x for x in range(ink.shape[1]) if cols[x] > 0.97]
    bars = []
    for x in xs:
        if bars and x - bars[-1][-1] <= 2:
            bars[-1].append(x)
        else:
            bars.append([x])
    xs = [float(np.mean(b)) for b in bars]
    merged = []
    for x in xs:
        if merged and x - merged[-1] < 20:
            merged[-1] = x
        else:
            merged.append(x)
    return merged


def main():
    pdf, page = sys.argv[1], int(sys.argv[2])
    dpi = int(sys.argv[sys.argv.index("--dpi") + 1]) if "--dpi" in sys.argv else 300
    nst = int(sys.argv[sys.argv.index("--staves") + 1]) if "--staves" in sys.argv else 11
    first_bar = int(sys.argv[sys.argv.index("--bar") + 1]) if "--bar" in sys.argv else 1
    clefs = ["treble"] * 4 + ["treble"] * 2 + ["treble", "treble", "alto", "bass", "bass"]
    names = ["fl", "ob", "cl", "fg", "cor1", "cor2", "vl1", "vl2", "va", "vc", "cb"]
    clefs[3] = "bass"
    flats = {"B", "E"}
    no_key = {"cor2"}  # the G horn staff carries no key signature
    ink = render(pdf, page, dpi)
    staves = staff_lines(ink)
    systems = [staves[i:i + nst] for i in range(0, len(staves), nst)]
    bar_no = first_bar
    for sys_i, st in enumerate(systems):
        if len(st) < nst:
            continue
        # barlines through the string staves (they are bracketed and joined)
        bls = barlines(ink, st[6][0], st[10][4])
        print(f"== system {sys_i + 1}: {len(bls) - 1} bars, barlines {[int(b) for b in bls]}")
        for bi in range(len(bls) - 1):
            print(f"-- bar {bar_no + bi}")
            for si, s in enumerate(st):
                hs, sp = heads(ink, s, int(bls[bi]) + 3, int(bls[bi + 1]) - 3)
                if not hs:
                    continue
                ref = CLEFS[clefs[si]]
                notes = []
                for x, y in hs:
                    step = ref + round((s[4] - y) / (sp / 2))
                    notes.append(f"{step_name(step, set() if names[si] in no_key else flats)}@{int(x - bls[bi])}")
                print(f"  {names[si]:5s} {' '.join(notes)}")
        bar_no += len(bls) - 1


if __name__ == "__main__":
    main()
