# FATE — treatment & style bible

## The idea

A classical mix (Beethoven 5 → Mozart 40 → Vivaldi "Summer" → Bach Toccata → Grieg "Hall of the
Mountain King" → Beethoven 7/II → Beethoven 5 finale; 4–5 minutes, minor keys all the way to the
C major of the finale) rendered as **a machine reading the score**. Every note is engraved the instant it
sounds; the staff rings like strings; the motif is tracked across the orchestra the way an attention head
finds a pattern. The through-line is **the fate motif** (da-da-da-DUM): it knocks at the start, it is
passed between voices, it turns up disguised in every later piece, and in the finale it resolves into
light (C minor → C major, red → gold).

Milestone 1 is Beethoven 5/I, bars 1–58.

## Tone

- Impact on the music, not on a grid: every hit is a real note of the score (the knock, the sforzandi,
  the tutti), every silence is a real rest (fermatas' caesuras and the general pause in bar 57 are black).
- Engraving is the hero: Bravura glyphs, real clefs, key signatures, beams, ties, fermatas, extruded
  into 3D and lit. No fake "music notes" clip-art.
- Deadpan machine annotations in mono (bar numbers, `attn 0.97`, `m. 57 — TACET — 0.56 s`), one line of
  prophetic serif where it earns it ("So pocht das Schicksal an die Pforte.").
- Not slop: no purple/cyan neon, no glowing brains, no particle nebulae, no stock "AI" imagery.

## Palette (`app/src/engine/palette.ts`)

ink `#0A0A0B`, ink2, graphite, ash, bone `#EEE9DF` (engraved notes, paper), **signal `#E8361F` fate red**
(the sounding note, the motif), ember (hot cores, glows only), blood (deep red shadows), **gold `#D9A441`
owned by the finale** (C major) and nowhere else. Only signal/ember exceed the bloom threshold.

## Type

Archivo (big numerals: bar counter), IBM Plex Mono (the machine's voice: labels, annotations),
Cormorant Garamond italic (the prophetic register, rare), Bravura (the music).

## Visual vocabulary (borrowed from pdoom-video's method)

Every plate gets its **own idiom** and a **concrete object** (never a literal illustration), sharing only
palette, type and grain. The library for this video, classical × machine:

- **The piano**: an 88-key concert keyboard (ebony and ivory, keys go down exactly when their notes
  sound); the action in macro (felt hammers with red underfelt, triple steel strings, dampers).
- **Machine music, the AI's ancestors**: the player-piano roll (punched paper read by a tracker bar), the
  music-box cylinder and comb, punched cards (Jacquard → Babbage → Lovelace).
- **AI metaphors**: next-note prediction typed as tokens with joke distributions (pdoom's prompt plate),
  Mozart's dice game as sampling, attention arcs/matrices, a tree of continuations (pdoom's loom).
- **The orchestra and sound as physics**: a top-down seating chart lighting by section, Chladni figures,
  oscilloscope/spectrum, strings' standing waves, organ pipes as racks.
- **Beethoven's own objects**: the metronome (he was the first major composer to publish metronome
  marks), the ear trumpet (the general pause), the scratched-out autograph manuscript (a bone-paper plate).
- **Type as image**: musical terms and pitch names slammed full frame (Archivo 900; flats and sharps from
  Bravura), deadpan mono annotations.
- Cuts on the beat inside plates; plates hand over by matching their last and first frames.

## Plates (milestone 1)

| id | bars | what happens |
|---|---|---|
| `hammer` | 1–2 | Inside a grand: the four notes are four felt hammers striking (the G hammers of three octaves fly together); on the E♭ the camera rises over the string bed, the struck strings burning and shivering with the dampers lifted, under the fermata. Caesura black. |
| `knock1` | 3–5 | The motif engraved on a 3D staff, both statements; the lines ring; the fermata burns; "So pocht das Schicksal an die Pforte." |
| `imitation` | 6–21 | Five string staves in space; the camera's attention follows the motif from voice to voice, arcs link the entries; the tutti chords; the violins' high G under its fermata. *(next: seating chart + next-note token stream)* |
| `keys` | 22–24 | The knock on a concert grand's keyboard: A♭ in five octaves slams three times, each a full-frame typographic A♭; on the long F, overhead of all 88 keys, the five Fs held and labelled, a red fermata settling over them. |
| `rise` | 25–58 | The orchestra as a city of light (time × pitch × instrument), the score ahead dimly visible; sforzandi bank the camera; ff tutti; bar 57 black ("TACET"); bar 58's B♭ chord engraved huge, cooling. *(next: player-piano roll for 25–43, the city standing on a keyboard, the ear trumpet, the metronome)* |
