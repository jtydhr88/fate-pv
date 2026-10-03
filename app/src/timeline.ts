// The edit: which scene plays when. Boundaries come from the score's named sections and bars
// (data/score.json), so they follow the tempo map: change a fermata in analysis/setlist.py and
// every cut moves with it.
import type { Opening, TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Score } from './engine/score';
import type { AudioData } from './engine/audio';

// Scene modules are discovered lazily so a missing/broken scene never breaks the build.
const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

export function makeTimeline(score: Score, audio: AudioData, opening: Opening): TimelineEntry[] {
  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry =>
    ({ id, file, load: scene(file), start, end, ...extra });

  const bar = (n: number) => score.bar(n, 'b5-open').t;
  const mb = (n: number) => score.bar(n, 'm40').t;
  /** a segment's start in the edit (score.segments: one per setlist entry, analysis/setlist.py) */
  const seg = (id: string) => score.segments.find((s) => s.id === id)!.start;
  return [
    // the opening: the title (the line the knock stamps) while the orchestra tunes (before time 0; per language)
    ...(opening.preroll > 0 ? [E('opening', 'opening', -opening.preroll, 0, { localized: true })] : []),
    // Beethoven 5/I, bars 1-58
    // each plate's world is recoloured through its own grade ramp (palette.ts RAMPS); the red stays the sounding note
    E('hammer', 'hammer', 0, bar(3), { localized: true, post: { grade: 1, ramp: 'wood', gradeSteps: 4, hatch: 0.6 } }), // bars 1-2: four hammer strikes inside a piano
    E('knock1', 'knock', bar(3), bar(6), { params: { n: 1, motifsFrom: 0 }, post: { grade: 1, ramp: 'paper', gradeSteps: 3, hatch: 0.5 } }), // bars 3-5: the knock engraved on a printed page
    E('imitation', 'imitation', bar(6), bar(22), { post: { grade: 1, ramp: 'night', gradeSteps: 4, hatch: 0.5 } }), // bars 6-21: the motif passed between the strings
    E('keys', 'keys', bar(22), bar(25), { post: { grade: 1, ramp: 'steel', gradeSteps: 4, hatch: 0.6 } }), // bars 22-24: the knock again, ff, on the keys of a grand
    E('rise', 'rise', bar(25), score.segments[1]?.start ?? audio.duration, { post: { grade: 1, ramp: 'dusk', gradeSteps: 4, hatch: 0.4 } }), // bars 25-58: the rise, the storm, the rest, the chord
    // Mozart 40/I, bars 1-28 (blue-and-white porcelain)
    E('m40-strings', 'm40-strings', score.segments[1]!.start, mb(14), { post: { grade: 1, ramp: 'porcelain', gradeSteps: 4, hatch: 0.3 } }),
    E('m40-winds', 'm40-winds', mb(14), mb(21), { post: { grade: 1, ramp: 'porcelain', gradeSteps: 4, hatch: 0.3 } }),
    E('m40-dice', 'm40-dice', mb(21), seg('viv'), { post: { grade: 1, ramp: 'porcelain', gradeSteps: 4, hatch: 0.25 } }),
    // Vivaldi, Summer III: the storm (a weather station; the porcelain plate cracks under the first hail)
    E('viv-storm', 'viv-storm', seg('viv'), seg('bach-a'), { post: { grade: 1, ramp: 'storm', gradeSteps: 4, hatch: 0.4 } }),
    // Bach, the Toccata: the organ as a machine room, the stops as hyperparameters, one rose window
    E('bach-organ', 'bach-organ', seg('bach-a'), seg('grieg-a'), { post: { grade: 1, ramp: 'stone', gradeSteps: 4, hatch: 0.5 } }),
    // Grieg, the Mountain King: a server farm inside the mountain, the loop running faster until it fails
    E('grieg-mountain', 'grieg-mountain', seg('grieg-a'), seg('b7-a'), { localized: true, post: { grade: 1, ramp: 'cave', gradeSteps: 4, hatch: 0.5 } }),
    // Beethoven 7/II: each voice that joins is one more layer, an etching in greys
    E('b7-layers', 'b7-layers', seg('b7-a'), seg('b9-a'), { post: { grade: 1, ramp: 'ash', gradeSteps: 5, hatch: 0.6 } }),
    // Beethoven 9/IV, the joy theme in the full orchestra: a world of lights, one voice joining after another
    E('b9-joy', 'b9-joy', seg('b9-a'), seg('b5-bridge'), { post: { grade: 1, ramp: 'dawn', gradeSteps: 5, hatch: 0.25 } }),
    // Beethoven 5, III into IV and the end: a timpani in the dark, then gold, everything comes back
    E('b5-light', 'b5-light', seg('b5-bridge'), audio.duration, { post: { grade: 1, ramp: 'gold', gradeSteps: 4, hatch: 0.3 } }),
    // the epilogue, after the music: the quote and the dedication, in silence (one clip per language)
    ...((opening.postroll ?? 0) > 0 ? [E('epilogue', 'epilogue', audio.duration, audio.duration + opening.postroll!, { localized: true })] : []),
  ];
}
