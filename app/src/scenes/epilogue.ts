// The epilogue, after the music (time duration .. duration + postroll), in silence: the quote
// (Hippocrates: life is short, art is long) over its Greek original, then the dedication. Text only, slow,
// centred. (It was the opening's; the opening keeps only the title.)
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { HEX, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { ease, prog } from '../engine/util';
import { GREEK, LANG, TEXT } from './opening-text';

/** the dedication, one line per language, and the project's repository under it */
const DEDICATION = { zh: '致敬人类最伟大的艺术。', en: 'A tribute to the greatest art of humankind.' } as const;
const REPO = 'github.com/jtydhr88/fate-pv';

// cue times in seconds from the epilogue's start
const C = { quote: 0.7, greek: 1.9, source: 2.3, quoteOut: 4.3, ded1: 4.9, dedOut: 7.9 };

export default class Epilogue extends Scene {
  T = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const s = f.t - this.ctx.start; // local seconds
    const tx = TEXT[LANG];
    const zh = LANG === 'zh';
    const T = this.T; T.clear(HEX.ink);
    const c = T.ctx;
    c.textBaseline = 'alphabetic';
    const push = 1 + 0.025 * prog(s, C.quote, C.dedOut + 0.6); // a slow push-in on the cards
    c.save(); c.translate(W / 2, H / 2); c.scale(push, push); c.translate(-W / 2, -H / 2);
    c.textAlign = 'center';
    // the quote, character by character, over its Greek original and the source
    {
      const out = 1 - prog(s, C.quoteOut, C.quoteOut + 0.45);
      if (out > 0 && s > C.quote) {
        c.font = zh ? font(F.zh(500), 82) : font(F.serif(400, true), 100);
        c.letterSpacing = zh ? '10px' : '0px';
        this.reveal(c, tx.quote, W / 2, H / 2 + 10, s - C.quote, zh ? 0.11 : 0.035, out, 'bone');
        c.letterSpacing = '2px';
        c.font = font(F.greek(), 38); c.fillStyle = rgba('ash', 1);
        c.globalAlpha = prog(s, C.greek, C.greek + 0.6) * out;
        c.fillText(GREEK, W / 2, H / 2 + 100);
        c.globalAlpha = prog(s, C.source, C.source + 0.6) * out;
        c.font = zh ? font(F.zh(500), 26) : font(F.serif(400, true), 32); c.fillStyle = rgba('graphite', 1);
        c.letterSpacing = zh ? '4px' : '1px';
        c.fillText(tx.source, W / 2, H / 2 + 160);
      }
    }
    // the dedication (one line) and, under it, the repository
    {
      const out = 1 - prog(s, C.dedOut, C.dedOut + 0.6);
      if (out > 0 && s > C.ded1) {
        c.font = zh ? font(F.zh(500), 64) : font(F.serif(600), 70);
        c.letterSpacing = zh ? '10px' : '1px';
        this.reveal(c, DEDICATION[LANG], W / 2, H / 2 + 20, s - C.ded1, zh ? 0.09 : 0.022, out, 'bone');
      }
      const r = prog(s, C.ded1 + 1.4, C.ded1 + 2.0, ease.outCubic) * out;
      if (r > 0) {
        c.globalAlpha = r; c.textAlign = 'center';
        c.font = font(F.mono(400), 22); c.letterSpacing = '3px'; c.fillStyle = rgba('graphite', 1);
        c.fillText(REPO, W / 2, H / 2 + 110);
        c.letterSpacing = '0px'; c.globalAlpha = 1;
      }
    }
    c.restore();
    c.globalAlpha = 1; c.letterSpacing = '0px';
    this.ctx.comp.draw(this.ctx.renderer, T.upload(), out);
    return { grade: 0, hud: 0, bloom: 0.25, bloomThreshold: 0.9, halation: 0, ca: 0.6, grain: 0.06, vignette: 0.4 };
  }

  /** Centred text, each character fading up from a slight drop, `per` seconds apart. */
  reveal(c: CanvasRenderingContext2D, str: string, x: number, y: number, lt: number, per: number, alpha: number, col: string) {
    const chars = [...str];
    const total = c.measureText(str).width;
    let px = x - total / 2;
    c.textAlign = 'left'; c.fillStyle = rgba(col, 1);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const w = c.measureText(ch).width;
      const k = prog(lt, i * per, i * per + 0.5, ease.outCubic);
      if (k > 0) { c.globalAlpha = k * alpha; c.fillText(ch, px, y + 10 * (1 - k)); }
      px += w;
    }
    c.textAlign = 'center';
  }
}
