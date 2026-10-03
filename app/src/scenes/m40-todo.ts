// Placeholder for the Mozart plates still to come: the bar number on black.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';

export default class Todo extends Scene {
  text = new Layer2D();
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, score } = this.ctx;
    clearRT(renderer, out, [0.004, 0.004, 0.004]);
    const T = this.text; T.clear();
    const c = T.ctx;
    c.font = font(F.mono(400), 40); c.fillStyle = rgba('bone', 0.8); c.textAlign = 'center';
    c.fillText(`${this.ctx.id} · m. ${score.barAt(f.t)?.n}`, W / 2, H / 2);
    comp.draw(renderer, T.upload(), out);
  }
}
