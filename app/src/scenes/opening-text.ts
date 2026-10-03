// The opening's words, per language (?lang=zh | en). The Chinese faces are subsets: after editing any
// Chinese text here (or anywhere under src/), run `uv run python fonts.py` in analysis/.
export type Lang = 'zh' | 'en';
export const LANG: Lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';

export const TEXT = {
  zh: {
    quote: '人生短暂，艺术长存。',
    source: '—— 希波克拉底《箴言》',
    dedication: ['一个人工智能，', '献给人类最伟大的艺术。'],
    /** the title, one word per note of the knock (three short, one long) */
    title: ['Opus 5.5，', '贝多芬，', '和', '命运'],
  },
  en: {
    quote: 'Life is short, art is long.',
    source: '— Hippocrates, Aphorisms',
    dedication: ['From an artificial intelligence,', 'to the greatest art of humankind.'],
    title: ['Opus 5.5,', 'Beethoven,', 'and', 'Fate'],
  },
} as const;

/** The original (Hippocrates, Aphorisms I.1): shown small under the quote in both versions. */
export const GREEK = 'Ὁ βίος βραχύς, ἡ δὲ τέχνη μακρή.';
/** The machine's first line, in both versions. */
export const READOUT = 'opus-5.5  ›  reading score  ›  L. van Beethoven, Symphony No. 5 in C minor, Op. 67';

/** The title line's layout (shared by the opening and the knock that stamps it, so the two match exactly):
 *  the font of word i, the gap between words, the baseline. */
export const TITLE = {
  font: (i: number, zh: boolean, font: (family: string, px: number) => string, F: { zh(w: number): string; serif(w: number, italic?: boolean): string }) =>
    i === 3 ? (zh ? font(F.zh(900), 190) : font(F.serif(600, true), 210)) : (zh ? font(F.zh(900), 96) : font(F.serif(600), 104)),
  gap: (zh: boolean) => (zh ? 34 : 30),
  spacing: (zh: boolean) => (zh ? '6px' : '0px'),
  /** baseline offset below the frame's centre */
  dy: 60,
};

