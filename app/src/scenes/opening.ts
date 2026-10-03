// The opening, before the first bar (time -preroll .. 0), while the orchestra tunes: black, the title
// (the very line the knock stamps: "Opus 5.5, Beethoven, and Fate", same type, same place) fades up and away,
// a silence, then the knock stamps it again word by word (hammer.ts). The quote and the dedication are the
// epilogue's (epilogue.ts), after the music.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { HEX, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { ease, prog } from '../engine/util';
import { LANG, TEXT, TITLE } from './opening-text';

// cue times in seconds from the opening's start (3.5 s in all; the knock follows at its end)
const C = { in: 0.25, full: 1.3, out: 2.0, gone: 2.75 };

export default class Opening extends Scene {
  T = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const s = f.t - this.ctx.start; // local seconds
    const T = this.T; T.clear(HEX.ink);
    const c = T.ctx;
    const a = prog(s, C.in, C.full, ease.inOutCubic) * (1 - prog(s, C.out, C.gone, ease.inOutCubic));
    if (a > 0) {
      const words = TEXT[LANG].title, zh = LANG === 'zh';
      const fnt = (i: number) => TITLE.font(i, zh, font, F);
      const gap = TITLE.gap(zh);
      const widths = words.map((w, i) => { c.font = fnt(i); c.letterSpacing = TITLE.spacing(zh); return c.measureText(w).width; });
      let x = W / 2 - (widths.reduce((p, q) => p + q, 0) + gap * 3) / 2;
      const y = H / 2 + TITLE.dy;
      // a very slow settle (the line drifts the last few pixels into the place where the knock will stamp it)
      const k = 1.03 - 0.03 * prog(s, C.in, C.gone, ease.outCubic);
      c.save(); c.translate(W / 2, y); c.scale(k, k); c.translate(-W / 2, -y);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      words.forEach((w, i) => {
        c.font = fnt(i); c.letterSpacing = TITLE.spacing(zh);
        c.globalAlpha = a;
        c.fillStyle = i === 3 ? rgba('signal', 1) : rgba('bone', 1);
        c.fillText(w, x, y);
        x += widths[i]! + gap;
      });
      c.restore();
    }
    c.globalAlpha = 1; c.letterSpacing = '0px';
    this.ctx.comp.draw(this.ctx.renderer, T.upload(), out);
    return { grade: 0, hud: 0, bloom: 0.35, bloomThreshold: 0.85, halation: 0, ca: 0.6, grain: 0.06, vignette: 0.4 };
  }
}
