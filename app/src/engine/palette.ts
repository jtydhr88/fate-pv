import { hexToLinear } from './util';

// The whole video lives in a restrained palette: ink, bone (score paper), and one signal colour —
// fate red, the colour of the motif. Gold is owned by the finale (C major, the light), see docs/TREATMENT.md.
export const HEX = {
  ink: '#0A0A0B', // background black (slightly warm)
  ink2: '#151517', // raised black (panels, paper-in-the-dark)
  graphite: '#5E5B57', // dim lines, secondary text
  ash: '#9C978F', // mid grey
  bone: '#EEE9DF', // paper white, primary type, engraved notes
  signal: '#E8361F', // fate red: the motif, the sounding note
  ember: '#FF9A4A', // hot core of the signal (only in glows)
  blood: '#7E0E0A', // deep shadow of the signal
  gold: '#D9A441', // the finale's light (C major) — nowhere else
  // the cool side (shadows, metal, night) and the warm mid-tones (wood, felt, old paper)
  prussian: '#16304C', // deep blue: shadow bands, night plates
  cobalt: '#3A6A9C', // mid blue: rim light, secondary lines
  steel: '#8FA3B8', // cool grey-blue: metal, strings
  ochre: '#B98A50', // warm mid: wood, felt, aged paper
  paper: '#E9E2D2', // printed-score paper (light plates)
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Grade ramps for the post's luminance mapping (PostParams.ramp): four stops from black to white.
 * Saturated colour (the sounding red, sparks) is left alone, so each plate can recolour its whole world
 * while the signal stays the signal. `paper` maps dark to paper and light to ink: a printed page.
 */
export const RAMPS = {
  /** inside the piano: blue shadows, warm wood and felt */
  wood: ['#07090D', '#16263A', '#9A7350', '#F1E7D3'],
  /** night: ink, prussian, cobalt, bone */
  night: ['#06080C', '#13263D', '#4E77A3', '#EEE9DF'],
  /** steel: cool greys for the keyboard and metal */
  steel: ['#07080A', '#1B2230', '#7D8A9C', '#F2EEE6'],
  /** violet dusk for the city */
  dusk: ['#07060B', '#1D1832', '#4E5F8F', '#EDE6DA'],
  /** blue-and-white porcelain (Mozart): cobalt in the shadows, white glaze in the light */
  porcelain: ['#0C2350', '#2E5DA6', '#B9CBE4', '#F4F6F8'],
  /** the same glaze inverted (dark maps to white): a printed page turning into porcelain keeps its ground */
  glaze: ['#F4F6F8', '#B9CBE4', '#2E5DA6', '#0C2350'],
  /** a printed score: paper ground, ink lines */
  paper: ['#E9E2D2', '#B9AE98', '#3B3833', '#0E0D0C'],
  /** Vivaldi's storm: slate, a green-grey, sage, a grey-white sky (lightning: the same ramp inverted) */
  storm: ['#05070A', '#1E2B2E', '#6F8A86', '#E6EBE6'],
  stormFlash: ['#E6EBE6', '#6F8A86', '#1E2B2E', '#05070A'],
  /** Bach's church: dark umber stone, limestone, ivory (the organ's pewter reads as the light greys) */
  stone: ['#080706', '#2A2420', '#8C7B68', '#EDE4D4'],
  /** inside the mountain: soot, burnt brown, firelight ochre, white heat */
  cave: ['#060403', '#2B160D', '#9A5A2C', '#F3D9B0'],
  /** the mountain overheating (Grieg's stretto): the same, pushed to red and white */
  caveHot: ['#0A0302', '#4A120A', '#D0582A', '#FFF1D8'],
  /** Beethoven 7/II: neutral silver-gelatin greys, an etching */
  ash: ['#0B0B0B', '#3A3A3A', '#9A9A9A', '#ECECEC'],
  /** Beethoven 9/IV, the joy theme: dawn, a deep blue night going to a pale sky and warm white (not gold) */
  dawn: ['#0B1530', '#3C5F94', '#A9C6E0', '#FFF8EC'],
  /** the finale's light (C major): the only warm-bright plate; gold is owned by it */
  gold: ['#0A0703', '#5A3A10', '#D9A441', '#FFF6E0'],
} as const satisfies Record<string, readonly [string, string, string, string]>;
export type RampName = keyof typeof RAMPS;
export const rampLin = (n: RampName) => RAMPS[n].map((h) => hexToLinear(h)) as [number, number, number][];
