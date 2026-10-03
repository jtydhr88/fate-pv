// Music engraving with the SMuFL font Bravura: glyph code points, engraving defaults (in staff
// spaces), Canvas2D drawing and 3D outlines of glyphs for extruded noteheads, clefs and fermatas.
//
// SMuFL conventions: the em is 4 staff spaces (a font size of 4·space px draws glyphs for a staff
// whose lines are `space` px apart), the baseline is the glyph's reference line (noteheads are centred
// on it, the G clef's curl sits on the G line), and y grows upwards in staff spaces.
import * as THREE from 'three';
import { ot, font } from './type';

export const SMUFL = {
  gClef: 0xe050, fClef: 0xe062, cClef: 0xe05c,
  noteheadBlack: 0xe0a4, noteheadHalf: 0xe0a3, noteheadWhole: 0xe0a2,
  fermataAbove: 0xe4c0, fermataBelow: 0xe4c1,
  restWhole: 0xe4e3, restHalf: 0xe4e4, restQuarter: 0xe4e5, rest8th: 0xe4e6,
  flag8thUp: 0xe240, flag8thDown: 0xe241,
  accidentalFlat: 0xe260, accidentalNatural: 0xe261, accidentalSharp: 0xe262,
  timeSig2: 0xe082, timeSig4: 0xe084, timeSigCommon: 0xe08a,
  dynamicPiano: 0xe520, dynamicForte: 0xe522, dynamicFF: 0xe52f, dynamicFFF: 0xe530,
  dynamicSforzando1: 0xe536, dynamicSforzato: 0xe539,
  augmentationDot: 0xe1e7, brace: 0xe000, bracket: 0xe002,
  barlineSingle: 0xe030, barlineFinal: 0xe032,
  articStaccatoAbove: 0xe4a2, articAccentAbove: 0xe4a0,
  metNoteHalfUp: 0xeca3, metNoteQuarterUp: 0xeca5,
} as const;
export type GlyphName = keyof typeof SMUFL;

/** Bravura engraving defaults, in staff spaces. */
export const ENGRAVE = {
  staffLine: 0.13, stem: 0.12, legerLine: 0.16, legerExtension: 0.4, beam: 0.5, beamSpacing: 0.25,
  thinBarline: 0.16, thickBarline: 0.5, slurMid: 0.22, slurEnd: 0.1,
  /** Notehead widths and the stem anchors (from bravura_metadata.json). */
  noteheadBlackW: 1.18, noteheadHalfW: 1.18, stemUpSE: [1.18, 0.168], stemDownNW: [0, -0.168],
  /** Stem length: one octave (3.5 spaces). */
  stemLength: 3.5,
} as const;

export const glyph = (name: GlyphName) => String.fromCodePoint(SMUFL[name]);

/**
 * Draw a glyph with Canvas2D for a staff of line spacing `space` px. (x, y) is the glyph origin:
 * left edge on its reference line, in canvas px (y down).
 */
export function drawGlyph(c: CanvasRenderingContext2D, name: GlyphName, x: number, y: number, space: number) {
  c.save();
  c.font = font('Bravura', 4 * space);
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillText(glyph(name), x, y);
  c.restore();
}

/** y (canvas px, y down) of a staff step relative to the staff's middle line, for line spacing `space`. */
export const stepY = (midLineY: number, step: number, midStep: number, space: number) => midLineY - ((step - midStep) * space) / 2;

const shapeCache = new Map<GlyphName, THREE.Shape[]>();

/**
 * A glyph's outline as THREE shapes in staff spaces (origin on the reference line, y up), for
 * ShapeGeometry / ExtrudeGeometry. Cached per glyph.
 */
export function glyphShapes(name: GlyphName): THREE.Shape[] {
  let shapes = shapeCache.get(name);
  if (shapes) return shapes;
  const f = ot('Bravura');
  const g = f.charToGlyph(glyph(name));
  // font units -> staff spaces: the em (unitsPerEm) is 4 spaces; opentype's getPath flips y (y down)
  const path = g.getPath(0, 0, 4); // 4 "px" per em = 1 unit per staff space, y down
  const sp = new THREE.ShapePath();
  for (const cmd of path.commands) {
    if (cmd.type === 'M') sp.moveTo(cmd.x, -cmd.y);
    else if (cmd.type === 'L') sp.lineTo(cmd.x, -cmd.y);
    else if (cmd.type === 'Q') sp.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
    else if (cmd.type === 'C') sp.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
  }
  // outer contours and holes are told apart by winding (SMuFL fonts are consistent about it)
  shapes = sp.toShapes();
  shapeCache.set(name, shapes);
  return shapes;
}

/** Extruded glyph geometry (staff-space units, centred on the reference line), depth in staff spaces. */
export function glyphGeometry(name: GlyphName, depth = 0.4, bevel = 0.05, curveSegments = 10) {
  const geo = new THREE.ExtrudeGeometry(glyphShapes(name), {
    depth, curveSegments, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 3,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}
