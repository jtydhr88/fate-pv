"""Beethoven, Symphony No. 9 in D minor, Op. 125 — IV. Presto / Allegro assai: the orchestra's tutti ff
statement of the joy theme, bars 164-171 and 180-187, transcribed for this project.

Source: the full score typeset by OpenScore (ed. Hansen Wu, 2019; IMSLP #929853, CC0), read from the page
with the notehead positions measured by analysis/omr_b9.py. The composition is in the public domain;
this transcription is ours. Bars 172-179 are not transcribed (the film cuts from 171 to 180).

Notation as in mozart40_1.py: one string per bar, `PITCH/DUR` tokens, sounding pitch (the A clarinets,
the D horns and the D trumpets are written here as they sound), `+` for chords, `r` rests, `~` ties.
The contrabassoon and the basses are written at their written pitch (they sound an octave lower: the
setlist's parts transpose them). Bar 187 ends on the D-major chord held (the score's last-beat A,
the upbeat into the next variation, is left out: the excerpt stops on the cadence).
"""

METER = (2, 2)  # Allegro assai, alla breve: a bar is 4 quarters

R = "R"
FIRST, LAST = 164, 187


def octave(bar: str, n: int) -> str:
    """The same bar n octaves up (or down): every pitch's octave digit moved."""
    import re
    if bar == R:
        return bar
    return re.sub(r"([A-G][#b]?)(-?\d)", lambda m: f"{m.group(1)}{int(m.group(2)) + n}", bar)


def bars(d: dict[int, str]) -> list[str]:
    """A part as the list read_text_notes expects (index 0 = bar 1): untranscribed bars are rests."""
    return [d.get(b, R) for b in range(1, LAST + 1)]


# ------------------------------------------------------------------ the tune and its second voice
MEL = {
    164: "F#5/2 G5/4 A5/4", 165: "A5/4 G5/4 F#5/4 E5/4", 166: "D5/4 D5/4 E5/4 F#5/4", 167: "F#5/4. E5/8 E5/2",
    168: "F#5/2 G5/4 A5/4", 169: "A5/4 G5/4 F#5/4 E5/4", 170: "D5/4 D5/4 E5/4 F#5/4", 171: "E5/4. D5/8 D5/2",
    180: "E5/2 F#5/4 D5/4", 181: "E5/4 F#5/8 G5/8 F#5/4 D5/4", 182: "E5/4 F#5/8 G5/8 F#5/4 E5/4",
    183: "D5/4 E5/4 A4/4 F#5/4~",  # the famous syncopation: the tune comes back a beat early
    184: "F#5/4 F#5/4 G5/4 A5/4", 185: "A5/4 G5/4 F#5/4 E5/4", 186: "D5/4 D5/4 E5/4 F#5/4", 187: "E5/4. D5/8 D5/2",
}
SEC = {  # oboe 2, clarinet 2, flute 2 (8va), trumpet 2 (mostly)
    164: "D5/2 E5/4 F#5/4", 165: "F#5/4 E5/4 D5/4 A4/4", 166: "F#4/4 F#4/4 A4/4 D5/4", 167: "D5/4. C#5/8 C#5/2",
    168: "D5/2 E5/4 F#5/4", 169: "F#5/4 E5/4 D5/4 A4/4", 170: "F#4/4 F#4/4 A4/4 D5/4", 171: "A4/4. F#4/8 F#4/2",
    180: "C#5/2 D5/4 F#4/4", 181: "C#5/4 D5/8 E5/8 D5/4 D5/4", 182: "C#5/4 D5/8 E5/8 C#5/4 C#5/4",
    183: "B4/4 G#4/4 A4/4 D5/4~",
    184: "D5/4 D5/4 E5/4 F#5/4", 185: "F#5/4 E5/4 D5/4 A4/4", 186: "F#4/4 F#4/4 A4/4 D5/4", 187: "A4/4. F#4/8 F#4/2",
}
FG1 = {
    164: "F#3/2 G3/4 A3/4", 165: "A3/4 G3/4 F#3/4 E3/4", 166: "F#3/4 F#3/4 E3/4 F#3/4", 167: "F#3/4. E3/8 E3/2",
    168: "F#3/2 G3/4 A3/4", 169: "A3/4 G3/4 F#3/4 E3/4", 170: "F#3/4 F#3/4 E3/4 F#3/4", 171: "E3/4. F#3/8 F#3/2",
    180: "E3/2 F#3/4 F#3/4", 181: "E3/4 F#3/8 G3/8 F#3/4 F#3/4", 182: "E3/4 F#3/8 G3/8 F#4/4 E4/4",
    183: "D4/4 E4/4 A3/4 F#4/4~",
    184: "F#4/4 F#3/4 G3/4 A3/4", 185: "A3/4 G3/4 F#3/4 E3/4", 186: "F#3/4 F#3/4 E3/4 F#3/4", 187: "E3/4. F#3/8 F#3/2",
}
FG2 = {
    164: "D3/2 E3/4 F#3/4", 165: "F#3/4 E3/4 D3/4 A2/4", 166: "D3/4 D3/4 C#3/4 D3/4", 167: "D3/4. A2/8 A2/2",
    168: "D3/2 E3/4 F#3/4", 169: "F#3/4 E3/4 D3/4 A2/4", 170: "D3/4 D3/4 C#3/4 D3/4", 171: "C#3/4. D3/8 D3/2",
    180: "C#3/2 D3/4 D3/4", 181: "C#3/4 D3/8 E3/8 D3/4 D3/4", 182: "C#3/4 D3/8 E3/8 C#4/4 C#4/4",
    183: "B3/4 G#3/4 A3/4 D4/4~",
    184: "D4/4 D3/4 E3/4 F#3/4", 185: "F#3/4 E3/4 D3/4 C#3/4", 186: "D3/4 D3/4 C#3/4 D3/4", 187: "C#3/4. D3/8 D3/2",
}
# horns in D (sounding): the tune an octave down, the second horn below (natural horns: no C#, no G#)
COR1 = {
    164: "F#4/2 G4/4 A4/4", 165: "A4/4 G4/4 F#4/4 E4/4", 166: "D4/4 D4/4 E4/4 F#4/4", 167: "F#4/4. E4/8 E4/2",
    168: "F#4/2 G4/4 A4/4", 169: "A4/4 G4/4 F#4/4 E4/4", 170: "D4/4 D4/4 E4/4 F#4/4", 171: "E4/4. D4/8 D4/2",
    180: "E4/2 F#4/4 D4/4", 181: "E4/4 F#4/8 G4/8 F#4/4 D4/4", 182: "E4/4 F#4/8 G4/8 F#4/4 F#4/4",
    183: "F#4/4 E4/4 A3/4 F#4/4~",
    184: "F#4/4 F#4/4 G4/4 A4/4", 185: "A4/4 G4/4 F#4/4 E4/4", 186: "D4/4 D4/4 E4/4 F#4/4", 187: "E4/4. D4/8 D4/2",
}
COR2 = {
    164: "D4/2 E4/4 F#4/4", 165: "F#4/4 E4/4 D4/4 A3/4", 166: "F#3/4 F#3/4 A3/4 D4/4", 167: "D4/4. A3/8 A3/2",
    168: "D4/2 E4/4 F#4/4", 169: "F#4/4 E4/4 D4/4 A3/4", 170: "F#3/4 F#3/4 A3/4 D4/4", 171: "A3/4. F#3/8 F#3/2",
    180: "C#4/2 D4/4 F#3/4", 181: "C#4/4 D4/8 E4/8 D4/4 F#3/4", 182: "A3/4 D4/8 E4/8 F#3/4 F#3/4",
    183: "F#3/4 E4/4 A3/4 D4/4~",
    184: "D4/4 D4/4 E4/4 F#4/4", 185: "F#4/4 E4/4 D4/4 A3/4", 186: "F#3/4 F#3/4 A3/4 D4/4", 187: "A3/4. F#3/8 F#3/2",
}
TR1 = dict(MEL)
TR1.update({182: "E5/4 F#5/8 G5/8 F#5/4 F#4/4", 183: "D5/4 E5/4 A4/4 F#5/4~"})
TR2 = {
    164: "D5/2 E5/4 F#5/4", 165: "F#5/4 E5/4 D5/4 A4/4", 166: "F#4/4 F#4/4 A4/4 D5/4", 167: "D5/4. A4/8 A4/2",
    168: "D5/2 E5/4 F#5/4", 169: "F#5/4 E5/4 D5/4 A4/4", 170: "F#4/4 F#4/4 A4/4 D5/4", 171: "A4/4. F#4/8 F#4/2",
    180: "C#5/2 D5/4 F#4/4", 181: "C#5/4 D5/8 E5/8 D5/4 F#4/4", 182: "A4/4 D5/8 E5/8 F#4/4 F#4/4",
    183: "D4/4 E5/4 A4/4 D5/4~",
    184: "D5/4 D5/4 E5/4 F#5/4", 185: "F#5/4 E5/4 D5/4 A4/4", 186: "F#4/4 F#4/4 A4/4 D5/4", 187: "A4/4. F#4/8 F#4/2",
}

# ------------------------------------------------------------------ the strings' off-beat chords, the bass
# the patterns: on the tonic/dominant bars a crotchet, a quaver rest and a quaver on each half bar
D_BAR = "D4/4 r/8 D3/8 D4/4 r/8 D3/8"
A_BAR = "A3/4 r/8 A2/8 A3/4 r/8 A2/8"
BASS = {  # cellos (and, written, basses and contrabassoon)
    164: D_BAR, 165: A_BAR, 166: "D3/4 r/4 r/4 D3/4", 167: "A3/4 r/4 A2/4 r/4",
    168: D_BAR, 169: A_BAR, 170: "D3/4 r/4 r/4 D3/4", 171: "A2/4 r/4 D3/4 r/4",
    180: "A2/4 r/8 A2/8 A3/4 D3/4", 181: "A2/4 r/8 A2/8 A3/4 D3/4",
    182: "A2/4 r/8 A3/8 A#3/8 r/8 F#3/8 r/8", 183: "B3/8 r/8 E3/8 r/8 G3/8 r/8 A2/8 r/8",
    184: D_BAR, 185: A_BAR, 186: "D3/4 r/4 r/4 D3/4", 187: "A2/4 r/4 D3/2",
}
TIMP = {  # D and A
    164: "D3/4 r/8 D3/8 D3/4 r/8 D3/8", 165: "A2/4 r/8 A2/8 A2/4 r/8 A2/8", 166: "D3/4 r/4 r/4 D3/4", 167: "A2/4 r/4 A2/4 r/4",
    168: "D3/4 r/8 D3/8 D3/4 r/8 D3/8", 169: "A2/4 r/8 A2/8 A2/4 r/8 A2/8", 170: "D3/4 r/4 r/4 D3/4", 171: "A2/4 r/4 D3/4 r/4",
    180: "A2/4 r/8 A2/8 A2/4 D3/4", 181: "A2/4 r/8 A2/8 A2/4 D3/4", 182: "A2/4 r/4 r/2", 183: "D3/8 r/8 D3/8 r/8 A2/8 r/8 A2/8 r/8",
    184: "D3/4 r/8 D3/8 D3/4 r/8 D3/8", 185: "A2/4 r/8 A2/8 A2/4 r/8 A2/8", 186: "D3/4 r/4 r/4 D3/4", 187: "A2/4 r/4 D3/2",
}
DT, AT = "D4+A4+F#5", "A4+C#5+E5"
VL = {  # first and second violins (the same chords here)
    164: f"{DT}/4 r/8 D4/8 D5/4 r/8 D4/8", 165: "A4+A5/4 r/8 A3/8 A4/4 r/8 A3/8",
    166: f"{DT}/4 r/4 r/4 {DT}/4", 167: f"{DT}/4 r/4 {AT}/4 r/4",
    168: "D4+D5+D6/4 r/8 D4/8 D5/4 r/8 D4/8", 169: "A4+A5/4 r/8 A3/8 A4/4 r/8 A3/8",
    170: f"{DT}/4 r/4 r/4 {DT}/4", 171: f"{AT}/4 r/4 A3+F#4+D5/4 r/4",
    180: "A3+E4+A4+E5/4 r/8 A3/8 A4/4 A3+F#4+D5/4", 181: "A3+E4+A4+E5/4 r/8 A3/8 A4/4 A3+F#4+D5/4",
    182: "C#5+E5/4 r/8 A3/8 C#5+F#5/8 r/8 C#5+E5/8 r/8", 183: "D4+D5/8 r/8 E4+E5/8 r/8 A4/8 r/8 D4+A4+F#5/8 r/8",
    184: f"{DT}/4 r/8 D4/8 D5/4 r/8 D4/8", 185: "A4+A5/4 r/8 A3/8 A4/4 r/8 A3/8",
    186: f"A3+F#4+D5/4 r/4 r/4 {DT}/4", 187: "A3+E4+A4+E5/4 r/4 A3+F#4+D5/2",
}
VL2 = dict(VL)
VL2[183] = "D4+D5/8 r/8 G#4+E5/8 r/8 C#4+A4/8 r/8 D4+A4+F#5/8 r/8"
VA = {
    164: "F#3+D4/4 r/8 D3/8 D4/4 r/8 D3/8", 165: "A4/4 r/8 A3/8 A4/4 r/8 A3/8",
    166: "A3+F#4+D5/4 r/4 r/4 A3+F#4+D5/4", 167: "A3+F#4+D5/4 r/4 A3+E4+C#5/4 r/4",
    168: "D4+D5/4 r/8 D3/8 D4/4 r/8 D3/8", 169: "A4/4 r/8 A3/8 A4/4 r/8 A3/8",
    170: "D4/4 r/4 r/4 A3+F#4+D5/4", 171: "A3+E4+C#5/4 r/4 A3+F#4+D5/4 r/4",
    180: "A3+E4+C#5/4 r/8 A3/8 A4/4 A3+F#4+D5/4", 181: "A3+E4+C#5/4 r/8 A3/8 A4/4 A3+F#4+D5/4",
    182: "A3+E4+C#5/4 r/8 A3/8 C#4+F#4/8 r/8 C#4+E4/8 r/8", 183: "B3+D4/8 r/8 B3+E4/8 r/8 A3+C#4/8 r/8 A3+D4+F#4/8 r/8",
    184: "D3+A3+F#4/4 r/8 D3/8 D4/4 r/8 D3/8", 185: "A3+A4/4 r/8 A3/8 A4/4 r/8 A3/8",
    186: "D3+D4/4 r/4 r/4 A3+F#4+D5/4", 187: "A3+E4+C#5/4 r/4 A3+D4+F#4/2",
}

PARTS: dict[str, list[str]] = {
    "fl": bars({b: octave(s, 1) for b, s in MEL.items()}),
    "fl2": bars({b: octave(s, 1) for b, s in SEC.items()}),
    "ob": bars(MEL), "ob2": bars(SEC),
    "cl": bars(MEL), "cl2": bars(SEC),
    "fg": bars(FG1), "fg2": bars(FG2),
    "cfg": bars(BASS),  # written: sounds an octave lower
    "cor": bars(COR1), "cor2": bars(COR2),
    "tr": bars(TR1), "tr2": bars(TR2),
    "timp": bars(TIMP),
    "vl1": bars(VL), "vl2": bars(VL2), "va": bars(VA),
    "vc": bars(BASS), "cb": bars(BASS),  # basses written: they sound an octave lower
}

DYNAMICS = [(164, "ff")]
