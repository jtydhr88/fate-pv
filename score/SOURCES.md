# Score sources

Every score the edit uses or may use, where it came from, its licence, and what it contains. The
compositions are all in the public domain; the licences below are those of the typeset/encoded files.

| folder | work | source | licence | contents |
|---|---|---|---|---|
| `beethoven5-1.mid`, `ly/` | Beethoven, Symphony No. 5, Op. 67 — I. Allegro con brio | [Mutopia #941](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=941) | Public domain | full orchestra, MIDI + LilyPond (no dynamics in the MIDI) |
| `mozart40/` | Mozart, Symphony No. 40, K. 550 — I. Molto allegro | [IMSLP #955212](https://imslp.org/wiki/Symphony_No.40_in_G_minor,_K.550_(Mozart,_Wolfgang_Amadeus)), typeset by Gaylon Babcock | CC BY 4.0 (the PDF) | our transcription of bars 1-28 is in `analysis/scores/mozart40_1.py` |
| `bach565/` | J. S. Bach, Toccata and Fugue in D minor, BWV 565 | [Mutopia #1780](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1780) | Public domain | organ (two manuals + pedal), MIDI at a flat 60 bpm, fermatas only in the LilyPond source |
| `vivaldi-summer/` | Vivaldi, The Four Seasons, Summer (Op. 8 No. 2, RV 315) | [Mutopia #336](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=336) | CC BY-SA 3.0 (credit Mutopia; derivatives share alike) | solo violin + strings; `summer-score-2.mid` is III. Presto (3/4) |
| `grieg-mountainking/` | Grieg, Peer Gynt, In the Hall of the Mountain King | [Mutopia #1888](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1888) | Public domain | piano solo; the accelerando goes into our tempo map |
| `beethoven7-2/` | Beethoven, Symphony No. 7, Op. 92 — II. Allegretto | [Mutopia #595](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=595) | Public domain | full orchestra, same 12-track layout as 5/I |
| `beethoven5-4/` | Beethoven, Symphony No. 5 — IV. Allegro (finale) | [IMSLP #1046120](https://imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van)), "超还原" piano arrangement by Muxi Xie | CC0 | MusicXML, the whole symphony on three piano staves (1616 bars): cut the finale out |
| `beethoven9/` | Beethoven, Symphony No. 9, Op. 125 — IV. (the joy theme, orchestral tutti) | [IMSLP #929853](https://imslp.org/wiki/Symphony_No.9,_Op.125_(Beethoven,_Ludwig_van)), typeset by OpenScore (ed. Hansen Wu, 2019) | CC0 (the PDF) | our transcription of bars 164-171 and 180-187 is in `analysis/scores/beethoven9_4.py`; pitches measured with `analysis/omr_b9.py` (`heads.txt`); the PDF itself is not in the repo (download it from IMSLP into `score/beethoven9/b9-openscore.pdf` to re-run the OMR) |
| `mozart-turca/` | Mozart, Piano Sonata K. 331 — III. Rondo alla turca (alternate) | [Mutopia #108](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108) | Public domain | piano |

Not found in a free machine-readable form: Rossini, William Tell overture (finale) — would need a
transcription like Mozart 40's.
