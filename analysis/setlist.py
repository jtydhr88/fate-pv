"""The edit, on the music side: which bars of which score, at what tempo, with what dynamics.

Each segment is a bar range of one public-domain score (a MIDI file in score/), played at a fixed
tempo with conductor's liberties written down explicitly (fermata holds, caesuras), so every note's
time in the final audio is computed, not detected. The renderer reads the result from data/score.json.

Bar numbers are the score's own (bar 1 = the first full bar; Beethoven 5/I opens with an eighth rest
inside bar 1, so bar 1 starts at quarter 0).
"""

# GM programs (0-based) used for the sketch render. The MuseScore_General ensemble patches read much
# better than the GM solo violin/cello; swap for a real orchestral library in the final mix.
P = dict(flute=73, oboe=68, clarinet=71, bassoon=70, horn=60, trumpet=56, trombone=57, tuba=58, timpani=47, strings=48,
         contrabass=48, pizz=45, organ=19)

BEETHOVEN5_PARTS = [
    # track index in the MIDI, id, display name, family, GM program, transposition (semitones, written -> sounding)
    (1, "fl", "Flauti", "woodwind", P["flute"], 0),
    (2, "ob", "Oboi", "woodwind", P["oboe"], 0),
    (3, "cl", "Clarinetti in B", "woodwind", P["clarinet"], 0),
    (4, "fg", "Fagotti", "woodwind", P["bassoon"], 0),
    (5, "cor", "Corni in Es", "brass", P["horn"], 0),
    (6, "tr", "Trombe in C", "brass", P["trumpet"], 0),
    (7, "timp", "Timpani in C–G", "percussion", P["timpani"], 0),
    (8, "vl1", "Violino I", "strings", P["strings"], 0),
    (9, "vl2", "Violino II", "strings", P["strings"], 0),
    (10, "va", "Viola", "strings", P["strings"], 0),
    (11, "vc", "Violoncello", "strings", P["strings"], 0),
    # LilyPond writes the bass part at written pitch: it sounds an octave lower
    (12, "cb", "Contrabasso", "strings", P["contrabass"], -12),
]

# MIDI velocities for the dynamic marks (the Mutopia MIDI has none: every note is 90)
DYN = dict(pp=36, p=52, mp=68, mf=82, f=100, ff=118)

MOZART40_PARTS = [
    (0, "fl", "Flauto", "woodwind", P["flute"], 0),
    (0, "ob", "Oboi", "woodwind", P["oboe"], 0),
    (0, "cl", "Clarinetti", "woodwind", P["clarinet"], 0),
    (0, "fg", "Fagotti", "woodwind", P["bassoon"], 0),
    (0, "cor1", "Corno I in B alto", "brass", P["horn"], 0),
    (0, "cor2", "Corno II in G", "brass", P["horn"], 0),
    (0, "vl1", "Violino I", "strings", P["strings"], 0),
    (0, "vl2", "Violino II", "strings", P["strings"], 0),
    (0, "va", "Viola", "strings", P["strings"], 0),
    (0, "vc", "Violoncello", "strings", P["strings"], 0),
    (0, "cb", "Basso", "strings", P["contrabass"], -12),
]

VIVALDI_PARTS = [
    (1, "solo", "Violino principale", "strings", P["strings"], 0),
    (2, "vl1", "Violino I", "strings", P["strings"], 0),
    (3, "vl2", "Violino II", "strings", P["strings"], 0),
    (4, "va", "Viola", "strings", P["strings"], 0),
    (5, "vc", "Violoncello e Basso", "strings", P["strings"], 0),
]
# the organ: two manuals and the pedal (16': it sounds an octave below the written pitch)
BACH_PARTS = [
    (1, "rh", "Manual I", "woodwind", P["organ"], 0),
    (2, "lh", "Manual II", "woodwind", P["organ"], 0),
    (3, "ped", "Pedal", "woodwind", P["organ"], -12),
]
# Grieg's piano version, scored back for the orchestra by register: the pp theme in the low strings'
# pizzicato and the bassoons, the ff in strings and brass
GRIEG_PP_PARTS = [
    (1, "rh", "Fagotti", "woodwind", P["bassoon"], 0),
    (2, "lh", "Violoncelli e Bassi (pizz.)", "strings", P["pizz"], 0),
]
GRIEG_FF_PARTS = [
    (1, "rh", "Violini", "strings", P["strings"], 0),
    (1, "tr", "Trombe", "brass", P["trumpet"], -12),
    (2, "lh", "Violoncelli e Bassi", "strings", P["strings"], 0),
    (2, "trb", "Tromboni", "brass", P["trombone"], 12),
]
# the "super restore" piano reduction of Beethoven 5 (CC0), three staves (track column = staff index):
# scored back for the orchestra by staff; the trombones only from the finale on (they wait three movements)
# Beethoven 9/IV, the joy theme's tutti (our transcription, analysis/scores/beethoven9_4.py): the parts are
# written at sounding pitch except the contrabassoon and the basses (an octave lower)
B9_PARTS = [
    (0, "fl", "Flauto I", "woodwind", P["flute"], 0),
    (0, "fl2", "Flauto II", "woodwind", P["flute"], 0),
    (0, "ob", "Oboe I", "woodwind", P["oboe"], 0),
    (0, "ob2", "Oboe II", "woodwind", P["oboe"], 0),
    (0, "cl", "Clarinetto I in A", "woodwind", P["clarinet"], 0),
    (0, "cl2", "Clarinetto II in A", "woodwind", P["clarinet"], 0),
    (0, "fg", "Fagotto I", "woodwind", P["bassoon"], 0),
    (0, "fg2", "Fagotto II", "woodwind", P["bassoon"], 0),
    (0, "cfg", "Contrafagotto", "woodwind", P["bassoon"], -12),
    (0, "cor", "Corno I in D", "brass", P["horn"], 0),
    (0, "cor2", "Corno II in D", "brass", P["horn"], 0),
    (0, "tr", "Tromba I in D", "brass", P["trumpet"], 0),
    (0, "tr2", "Tromba II in D", "brass", P["trumpet"], 0),
    (0, "timp", "Timpani in D, A", "percussion", P["timpani"], 0),
    (0, "vl1", "Violini I", "strings", P["strings"], 0),
    (0, "vl2", "Violini II", "strings", P["strings"], 0),
    (0, "va", "Viole", "strings", P["strings"], 0),
    (0, "vc", "Violoncelli", "strings", P["strings"], 0),
    (0, "cb", "Contrabassi", "strings", P["contrabass"], -12),
]

B5R_BRIDGE_PARTS = [
    (0, "vl", "Violini", "strings", P["strings"], 0),
    (1, "vc", "Violoncelli e Bassi", "strings", P["strings"], 0),
    (2, "timp", "Timpani", "percussion", P["timpani"], 0),
]
B5R_FINALE_PARTS = [
    (0, "vl", "Violini", "strings", P["strings"], 0),
    (0, "tr", "Trombe", "brass", P["trumpet"], -12),
    (1, "vc", "Violoncelli e Bassi", "strings", P["strings"], 0),
    (1, "trb", "Tromboni", "brass", P["trombone"], 0),
    (1, "cor", "Corni", "brass", P["horn"], 12),
]

SETLIST = [
    dict(
        id="b5-open",
        title="Symphony No. 5 in C minor, Op. 67 — I. Allegro con brio",
        composer="Ludwig van Beethoven",
        year=1808,
        midi="score/beethoven5-1.mid",
        parts=BEETHOVEN5_PARTS,
        meter=(2, 4),
        bars=(1, 58),  # through the tutti B-flat chord before the horn call
        tempo_half=108,  # Beethoven's own metronome mark (half = 108)
        # bar -> extra seconds the bar is held (the fermata), and the silence after it
        fermatas={2: (1.25, 0.18), 5: (1.7, 0.30), 21: (1.1, 0.20), 24: (1.7, 0.35)},
        # dynamics by bar: (from_bar, mark) steps; ('cresc', a, b, to) ramps over bars a..b
        dynamics=[(1, "ff"), (6, "p"), (19, "f"), (22, "ff"), (25, "p"), (44, "f"), (52, "ff")],
        crescendos=[(18, 18, "f"), (34, 43, "f")],
        # sforzando on the downbeat of these bars (bars 38-43: the rising sf sequence)
        sforzandi=list(range(38, 44)),
        # named sections for the visuals (bar ranges, inclusive)
        sections=[
            ("knock", 1, 5),
            ("imitation", 6, 18),
            ("halt", 19, 21),
            ("knock2", 22, 24),
            ("rise", 25, 43),
            ("storm", 44, 56),
            ("void", 57, 57),
            ("chord", 58, 58),
        ],
    ),
    dict(
        id="m40",
        title="Symphony No. 40 in G minor, K. 550 — I. Molto allegro",
        composer="Wolfgang Amadeus Mozart",
        year=1788,
        text="mozart40_1",  # analysis/scores/mozart40_1.py (our transcription)
        parts=MOZART40_PARTS,
        meter=(2, 2),
        bars=(1, 28),
        tempo_half=112,
        gap_before=1.1,  # B-flat major rings out, then G minor (its relative minor) begins
        fermatas={28: (1.4, 0.0)},  # the excerpt ends on the B-flat arrival: held
        dynamics=[(1, "p"), (14, "p"), (16, "f"), (20.5, "p"), (28, "ff")],
        crescendos=[],
        sforzandi=[],
        sections=[
            ("theme", 1, 9),
            ("sequence", 10, 15),
            ("halfcadence", 16, 20),
            ("theme2", 21, 27),
            ("arrival", 28, 28),
        ],
        motifs=False,
    ),
    # ---------------------------------------------------------------- Vivaldi, Summer III (G minor, like K. 550)
    dict(
        id="viv",
        title="The Four Seasons, Summer, RV 315 — III. Presto",
        composer="Antonio Vivaldi",
        year=1725,
        midi="score/vivaldi-summer/summer-score-2.mid",
        parts=VIVALDI_PARTS,
        meter=(3, 4),
        bars=(1, 20),  # the storm gathering (1-9, with a bar of silence), the hail of scales (10-19), G
        tempo_half=84,  # Presto, quarter = 168
        gap_before=0.8,
        fermatas={20: (0.9, 0.0)},
        dynamics=[(1, "p"), (10, "ff"), (20, "f")],
        crescendos=[],
        sforzandi=[10, 12, 14, 16],
        sections=[("gathering", 1, 9), ("hail", 10, 19), ("strike", 20, 20)],
        motifs=False,
    ),
    # ---------------------------------------------------------------- Bach, Toccata in D minor (two cuts)
    dict(
        id="bach-a",
        title="Toccata and Fugue in D minor, BWV 565 — Toccata",
        composer="Johann Sebastian Bach",
        year=1704,
        midi="score/bach565/bwv565.mid",
        parts=BACH_PARTS,
        meter=(4, 4),
        bars=(1, 3),
        last_bar_q=3.75,  # without the pickup into the Prestissimo (we cut to bar 8)
        tempo_half=25,  # Adagio, quarter = 50
        gap_before=1.0,
        # the fermatas sit inside the bars: on the mordents' A and the rests after them, on the resolution
        holds={1: [(0.25, 0.9), (1.75, 0.8), (2.25, 0.8), (3.75, 1.0)], 3: [(0.5, 0.9), (1.5, 1.3)]},
        fermatas={},
        dynamics=[(1, "ff")],
        sections=[("mordent", 1, 1), ("descent", 2, 2), ("chord", 3, 3)],
        motifs=False,
    ),
    dict(
        id="bach-b",
        title="Toccata and Fugue in D minor, BWV 565 — Toccata",
        composer="Johann Sebastian Bach",
        year=1704,
        midi="score/bach565/bwv565.mid",
        parts=BACH_PARTS,
        meter=(4, 4),
        bars=(8, 12),
        last_bar_q=1.0,  # to the D minor chord under its fermata
        tempo_half=36,  # quarter = 72
        fermatas={12: (1.6, 0.0)},
        holds={11: [(3.9, 0.3)]},
        dynamics=[(8, "ff")],
        sections=[("cascade", 8, 10), ("pedal", 11, 11), ("tonic", 12, 12)],
        motifs=False,
    ),
    # ---------------------------------------------------------------- Grieg, In the Hall of the Mountain King
    dict(
        id="grieg-a",
        title="Peer Gynt, Op. 23 — In the Hall of the Mountain King",
        composer="Edvard Grieg",
        year=1875,
        midi="score/grieg-mountainking/mountainking.mid",
        parts=GRIEG_PP_PARTS,
        meter=(4, 4),
        bars=(2, 5),
        tempo_half=69,  # Alla marcia molto marcato, quarter = 138
        gap_before=0.7,
        fermatas={},
        dynamics=[(2, "pp")],
        sections=[("creep", 2, 5)],
        motifs=False,
    ),
    dict(
        id="grieg-b",
        title="Peer Gynt, Op. 23 — In the Hall of the Mountain King",
        composer="Edvard Grieg",
        year=1875,
        midi="score/grieg-mountainking/mountainking.mid",
        parts=GRIEG_FF_PARTS,
        meter=(4, 4),
        bars=(66, 88),
        tempo_half=80,
        accel=[(66, 84, 80, 106)],  # sempre stretto sin al fine: quarter 160 -> 212
        fermatas={88: (0.8, 0.0)},
        dynamics=[(66, "f"), (74, "ff")],
        crescendos=[(66, 73, "ff")],
        sforzandi=[74, 75, 78, 79, 82, 83],
        sections=[("stretto", 66, 73), ("blows", 74, 83), ("collapse", 84, 88)],
        motifs=False,
    ),
    # ---------------------------------------------------------------- Beethoven 7/II: layer on layer
    dict(
        id="b7-a",
        title="Symphony No. 7 in A major, Op. 92 — II. Allegretto",
        composer="Ludwig van Beethoven",
        year=1813,
        midi="score/beethoven7-2/Symphony7_2.mid",
        parts=BEETHOVEN5_PARTS,
        meter=(2, 4),
        bars=(1, 10),  # the winds' chord, then the low strings alone
        tempo_half=38,  # Beethoven's mark, quarter = 76
        gap_before=1.4,  # the mountain has fallen: silence
        fermatas={2: (0.6, 0.0)},
        dynamics=[(1, "f"), (2, "p"), (3, "pp")],
        sections=[("chord", 1, 2), ("layer1", 3, 10)],
        motifs=False,
    ),
    dict(
        id="b7-b",
        title="Symphony No. 7 in A major, Op. 92 — II. Allegretto",
        composer="Ludwig van Beethoven",
        year=1813,
        midi="score/beethoven7-2/Symphony7_2.mid",
        parts=BEETHOVEN5_PARTS,
        meter=(2, 4),
        bars=(27, 34),  # second layer: the second violins take the theme, the countermelody below
        tempo_half=38,
        fermatas={},
        dynamics=[(27, "p")],
        crescendos=[(31, 34, "mf")],
        sections=[("layer2", 27, 34)],
        motifs=False,
    ),
    dict(
        id="b7-c",
        title="Symphony No. 7 in A major, Op. 92 — II. Allegretto",
        composer="Ludwig van Beethoven",
        year=1813,
        midi="score/beethoven7-2/Symphony7_2.mid",
        parts=BEETHOVEN5_PARTS,
        meter=(2, 4),
        bars=(75, 82),  # every layer: the whole orchestra, ff
        tempo_half=38,
        fermatas={82: (0.5, 0.0)},
        dynamics=[(75, "ff")],
        sections=[("tutti", 75, 82)],
        motifs=False,
    ),
    # ---------------------------------------------------------------- Beethoven 9/IV: the joy theme, everyone
    dict(
        id="b9-a",
        title="Symphony No. 9 in D minor, Op. 125 — IV. (Ode to Joy)",
        composer="Ludwig van Beethoven",
        year=1824,
        text="beethoven9_4",  # analysis/scores/beethoven9_4.py (our transcription, OpenScore CC0)
        parts=B9_PARTS,
        meter=(2, 2),
        bars=(164, 171),  # the orchestra's tutti statement, first eight bars (a, a')
        tempo_half=80,  # Allegro assai, Beethoven's mark half = 80
        gap_before=1.0,
        fermatas={},
        dynamics=[(164, "ff")],
        sections=[("tune", 164, 167), ("tune2", 168, 171)],
        motifs=False,
    ),
    dict(
        id="b9-b",
        title="Symphony No. 9 in D minor, Op. 125 — IV. (Ode to Joy)",
        composer="Ludwig van Beethoven",
        year=1824,
        text="beethoven9_4",
        parts=B9_PARTS,
        meter=(2, 2),
        bars=(180, 187),  # the last eight (b with the syncopated return, a'), to the D-major cadence
        tempo_half=80,
        fermatas={187: (1.2, 0.0)},
        dynamics=[(180, "ff")],
        sections=[("bridge", 180, 183), ("return", 184, 187)],
        motifs=False,
    ),
    # ---------------------------------------------------------------- Beethoven 5: III -> IV, and the end
    dict(
        id="b5-bridge",
        title="Symphony No. 5 in C minor, Op. 67 — III. into IV.",
        composer="Ludwig van Beethoven",
        year=1808,
        xml="score/beethoven5-4/b5-superrestore.mxl",
        parts=B5R_BRIDGE_PARTS,
        meter=(3, 4),
        bars=(1146, 1171),  # the timpani's C in the dark, the violins climbing, the crescendo on G
        tempo_half=144,  # Allegro, dotted half = 96
        gap_before=0.9,
        fermatas={},
        dynamics=[(1146, "pp")],
        crescendos=[(1156, 1171, "ff")],
        sections=[("dark", 1146, 1163), ("crescendo", 1164, 1171)],
        motifs=False,
    ),
    dict(
        id="b5-finale",
        title="Symphony No. 5 in C minor, Op. 67 — IV. Allegro",
        composer="Ludwig van Beethoven",
        year=1808,
        xml="score/beethoven5-4/b5-superrestore.mxl",
        parts=B5R_FINALE_PARTS,
        meter=(4, 4),
        bars=(1172, 1185),  # C major: the trombones' first notes in the symphony
        tempo_half=84,  # Allegro, half = 84
        fermatas={},
        dynamics=[(1172, "ff")],
        sections=[("light", 1172, 1177), ("march", 1178, 1185)],
        motifs=False,
    ),
    dict(
        id="b5-end",
        title="Symphony No. 5 in C minor, Op. 67 — IV. Presto (the end)",
        composer="Ludwig van Beethoven",
        year=1808,
        xml="score/beethoven5-4/b5-superrestore.mxl",
        parts=B5R_FINALE_PARTS,
        meter=(4, 4),
        bars=(1604, 1616),  # the chords that will not stop: C, C, C ... C
        tempo_half=112,  # Presto (alla breve): half = 112
        fermatas={1616: (1.4, 0.0)},
        dynamics=[(1604, "ff")],
        sections=[("chords", 1604, 1616)],
        motifs=False,
        tail=3.0,
    ),
]
