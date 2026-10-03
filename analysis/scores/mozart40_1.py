"""Mozart, Symphony No. 40 in G minor, K. 550 — I. Molto allegro, bars 1-28, transcribed for this project.

Source: the concert-pitch full score typeset by Gaylon Babcock (IMSLP #955212, CC BY 4.0), checked
against the notehead positions measured from the page (analysis/omr_heads.py). The composition is in the
public domain; this transcription is ours.

Notation, one string per bar: tokens separated by spaces, each `PITCH/DUR`:
  PITCH  = C4, Eb5, F#3 (sounding pitch, accidentals always written out — no key signature applied),
           a chord `G3+Bb3`, or `r` for a rest
  DUR    = 1 2 4 8 16 (whole … sixteenth), `.` for dotted; a trailing `~` ties into the next token
`R` alone is a whole-bar rest. `*N(...)`: the bracketed tokens repeated N times.
"""

METER = (2, 2)  # alla breve: a bar is 4 quarters

R = "R"


def rep(n: int, s: str) -> str:
    return " ".join([s] * n)


# viola (divisi) eighth-note pairs, two of each
def va(*pairs: str) -> str:
    return " ".join(f"{p}/8 {p}/8" for p in pairs)


BARS = 28

PARTS: dict[str, list[str]] = {
    "fl": [R] * 13 + [
        "r/4 F#5/4 G5/4 A5/4",  # 14
        "Bb5/4 C6/8 Bb5/8 A5/4 G5/4",  # 15
        "F#5/4 r/4 C#6/2",  # 16 f
        "D6/4 r/4 C#6/2",
        "D6/4 r/4 C#6/2",
        "D6/4 C#6/4 D6/4 C#6/4",
        "D6/2 r/2",  # 20
    ] + [R] * 7 + ["Bb5/1"],  # 28 f
    "ob": [R] * 15 + [
        "r/2 G5+Bb5/2",  # 16 f
        "F#5+A5/4 r/4 G5+Bb5/2",
        "F#5+A5/4 r/4 G5+Bb5/2",
        "F#5+A5/4 G5+Bb5/4 F#5+A5/4 G5+Bb5/4",
        "F#5+A5/2 r/2",  # 20
        R,  # 21
        "D5+Bb5/1~", "D5+Bb5/1~", "D5+Bb5/1",  # 22-24 p
        "C5+Bb5/1",  # 25
        "C5+A5/1~", "C5+A5/1",  # 26-27
        "D5+Bb5/1",  # 28 f
    ],
    "cl": [R] * 13 + [
        "r/4 F#4/4 G4/4 A4/4",
        "Bb4/4 C5/8 Bb4/8 A4/4 G4/4",
        "F#4/4 r/4 C#5+E5/2",
        "D5+F#5/4 r/4 C#5+E5/2",
        "D5+F#5/4 r/4 C#5+E5/2",
        "D5+F#5/4 C#5+E5/4 D5+F#5/4 C#5+E5/4",
        "D5+F#5/2 r/2",
    ] + [R] * 7 + ["Bb4/1"],
    "fg": [R] * 13 + [
        "r/4 F#3/4 G3/4 A3/4",
        "Bb3/4 C4/8 Bb3/8 A3/4 G3/4",
        "F#3/4 r/4 Bb3+E4/2",
        "A3+F#4/4 r/4 Bb3+E4/2",
        "A3+F#4/4 r/4 Bb3+E4/2",
        "A3+F#4/4 Bb3+E4/4 A3+F#4/4 Bb3+E4/4",
        "A3+F#4/2 C4/2",  # 20: then p, descending into the theme
        "G3+Bb3/2 F#3+A3/2",
        "G3+Bb3/4 r/4 r/2",
        R,
        "C4+Eb4/1~", "C4+Eb4/1",  # 24-25
        "A3+C4/1~", "A3+C4/1",  # 26-27
        "D4+F4/4 Bb3/8 D4/8 Bb3/4 D4/4",  # 28 f
    ],
    "cor1": [R] * 15 + [
        "r/2 Bb4/2",
        "D5/4 r/4 Bb4/2",
        "D5/4 r/4 Bb4/2",
        "D5/4 Bb4/4 D5/4 Bb4/4",
        "D5/2 r/2",
    ] + [R] * 7 + ["Bb4/1"],
    "cor2": [R] * 15 + [
        "r/2 G4/2",
        "A4/4 r/4 G4/2",
        "A4/4 r/4 G4/2",
        "A4/4 G4/4 A4/4 G4/4",
        "A4/2 r/2",
    ] + [R] * 8,
    "vl1": [
        "r/2 r/4 Eb5/8 D5/8",  # 1 p
        "D5/4 Eb5/8 D5/8 D5/4 Eb5/8 D5/8",
        "D5/4 Bb5/4 r/4 Bb5/8 A5/8",
        "G5/4 G5/8 F5/8 Eb5/4 Eb5/8 D5/8",
        "C5/4 C5/4 r/4 D5/8 C5/8",  # 5
        "C5/4 D5/8 C5/8 C5/4 D5/8 C5/8",
        "C5/4 A5/4 r/4 A5/8 G5/8",
        "F#5/4 F#5/8 Eb5/8 D5/4 D5/8 C5/8",
        "Bb4/4 Bb4/4 r/4 Bb5/8 A5/8",
        "A5/4 C6/4 F#5/4 A5/4",  # 10
        "G5/4 D5/4 r/4 Bb5/8 A5/8",
        "A5/4 C6/4 F#5/4 A5/4",
        "G5/4 Bb5/4 A5/8 G5/8 F5/8 Eb5/8",
        "D5/1",
        "C#5/1",  # 15
        "D5/2 r/4 D4/8 D4/8",  # 16 f
        "D4/2 r/4 D4/8 D4/8",
        "D4/2 r/4 D4/8 D4/8",
        "D4/4 D4/8 D4/8 D4/4 D4/8 D4/8",
        "D4/2 r/4 Eb5/8 D5/8",  # 20, p pickup
        "D5/4 Eb5/8 D5/8 D5/4 Eb5/8 D5/8",
        "D5/4 Bb5/4 r/4 Bb5/8 A5/8",
        "G5/4 G5/8 F5/8 Eb5/4 Eb5/8 D5/8",
        "C5/4 C5/4 r/4 F5/8 Eb5/8",
        "Eb5/4 F5/8 Eb5/8 Eb5/4 F5/8 Eb5/8",  # 25
        "Eb5/4 C6/4 r/4 C6/8 Bb5/8",
        "A5/4 A5/8 G5/8 F5/4 F5/8 Eb5/8",
        "D5+Bb5/1",  # 28 f
    ],
    "vl2": [
        "r/2 r/4 Eb4/8 D4/8",
        "D4/4 Eb4/8 D4/8 D4/4 Eb4/8 D4/8",
        "D4/4 Bb4/4 r/4 Bb4/8 A4/8",
        "G4/4 G4/8 F4/8 Eb4/4 Eb4/8 D4/8",
        "C4/4 C4/4 r/4 D4/8 C4/8",
        "C4/4 D4/8 C4/8 C4/4 D4/8 C4/8",
        "C4/4 A4/4 r/4 A4/8 G4/8",
        "F#4/4 F#4/8 Eb4/8 D4/4 D4/8 C4/8",
        "Bb3/4 Bb3/4 r/4 Bb4/8 A4/8",
        "A4/4 C5/4 F#4/4 A4/4",
        "G4/4 D4/4 r/4 Bb4/8 A4/8",
        "A4/4 C5/4 F#4/4 A4/4",
        "G4/4 Bb4/4 A4/8 G4/8 F4/8 Eb4/8",
        "D4/1",
        "C#4/1",
        "D4/2 r/4 D4/8 D4/8",
        "D4/2 r/4 D4/8 D4/8",
        "D4/2 r/4 D4/8 D4/8",
        "D4/4 D4/8 D4/8 D4/4 D4/8 D4/8",
        "D4/2 r/4 Eb4/8 D4/8",
        "D4/4 Eb4/8 D4/8 D4/4 Eb4/8 D4/8",
        "D4/4 Bb4/4 r/4 Bb4/8 A4/8",
        "G4/4 G4/8 F4/8 Eb4/4 Eb4/8 D4/8",
        "C4/4 C4/4 r/4 F4/8 Eb4/8",
        "Eb4/4 F4/8 Eb4/8 Eb4/4 F4/8 Eb4/8",
        "Eb4/4 C5/4 r/4 C5/8 Bb4/8",
        "A4/4 A4/8 G4/8 F4/4 F4/8 Eb4/8",
        "D4+Bb4/1",
    ],
    "va": [
        va("G3+Bb3", "Bb3+G4", "G3+Bb3", "Bb3+G4"),  # 1 (div.) p
        va("G3+Bb3", "Bb3+G4", "G3+Bb3", "Bb3+G4"),
        va("G3+Bb3", "D4+G4", "G3+Bb3", "D4+G4"),
        va("G3+Bb3", "Bb3+D4", "G3+Bb3", "Bb3+G4"),
        va("A3+Eb4", "Eb4+A4", "A3+Eb4", "Eb4+A4"),  # 5
        va("A3+Eb4", "Eb4+A4", "A3+Eb4", "Eb4+A4"),
        va("A3+D4", "D4+C5", "A3+D4", "D4+C5"),
        va("A3+C4", "C4+C5", "A3+F#4", "F#4+A4"),
        va("G3+D4", "D4+G4", "G3+D4", "D4+G4"),
        va("A3+Eb4", "Eb4+F#4", "A3+Eb4", "Eb4+F#4"),  # 10
        va("G3+D4", "D4+G4", "G3+D4", "D4+G4"),
        va("A3+Eb4", "Eb4+F#4", "A3+Eb4", "Eb4+F#4"),
        "G3+D4/1",
        "Bb3/2. A3/4",
        "G3/2 F#3/4 G3/4",  # 15
        "A3/2 r/4 D4/8 D4/8",  # 16 f
        "D4/2 r/4 D4/8 D4/8",
        "D4/2 r/4 D4/8 D4/8",
        "D4/4 D4/8 D4/8 D4/4 D4/8 D4/8",
        "D4/2 r/2",  # 20
        R,
        va("G3+Bb3", "D4+G4", "G3+Bb3", "D4+G4"),  # 22 p
        va("G3+Bb3", "Bb3+D4", "G3+Bb3", "Bb3+G4"),
        va("G3+Bb3", "Bb3+G4", "G3+Bb3", "Bb3+G4"),
        va("G3+Bb3", "Bb3+G4", "G3+Bb3", "Bb3+G4"),  # 25
        va("A3+C4", "Eb4+A4", "A3+C4", "Eb4+A4"),
        va("C4+Eb4", "Eb4+C5", "A3+C4", "C4+A4"),
        "D4+Bb4/8 D5/8 Bb4/8 D5/8 Bb4/4 D5/4",  # 28 f
    ],
    "vc": [
        "G2/4 r/4 r/2", "G3/4 r/4 r/2", "G2/4 r/4 r/2", "G3/4 r/4 r/2",
        "G2/4 r/4 r/2", "G3/4 r/4 r/2", "F#2/4 r/4 r/2", "D3/4 r/4 r/2",  # 1-8
        "G2/4 r/4 r/2",  # 9
        "C3/1", "Bb2/1", "C3/1", "Bb2/1",  # 10-13
        "E3/1", "Eb3/1",  # 14-15
        "D3/2 r/4 D3/8 D3/8",  # 16 f
        "D3/2 r/4 D3/8 D3/8",
        "D3/2 r/4 D3/8 D3/8",
        "D3/4 D3/8 D3/8 D3/4 D3/8 D3/8",
        "D3/2 r/2",
        R,
        "G2/4 r/4 r/2", "G3/4 r/4 r/2", "Eb2/4 r/4 r/2",  # 22-24 p
        "C3/4 r/4 r/2", "F2/4 r/4 r/2", "F3/4 r/4 r/2",  # 25-27
        "Bb3/8 D4/8 Bb3/8 D4/8 Bb3/4 D4/4",  # 28 f
    ],
}
# the basses double the cellos (written here at the cellos' pitch: build.py drops them an octave)
PARTS["cb"] = list(PARTS["vc"])

# dynamics (bar, mark) and the edit's fermata on the last bar (the excerpt ends on the B-flat arrival)
DYNAMICS = [(1, "p"), (16, "f"), (20.5, "p"), (28, "f")]
