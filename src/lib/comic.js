// Comic-book words ("BANG!", "SNIKT!") that pop over the action.

import { ctx } from "../core/stage.js";
import { smoothstep } from "./math.js";

export const POP_S = 0.6;

export const comicPops = [];           // BANG! / SNIKT! words

// Comic-book sound effects: they pop in oversized, settle, then float away.
export function drawPops() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const p of comicPops) {
    const u = p.age / POP_S;
    const sc = u < 0.15 ? 0.4 + u / 0.15 * 0.9 : 1.3 - 0.3 * smoothstep(0.15, 0.4, u);
    ctx.globalAlpha = 1 - smoothstep(0.6, 1, u);
    ctx.setTransform(1, 0, 0, 1, p.x, p.y - u * p.size * 1.2);
    ctx.rotate(p.rot);
    ctx.scale(sc, sc);
    ctx.font = `900 ${Math.round(p.size)}px Impact, "Arial Black", system-ui, sans-serif`;
    ctx.lineWidth = p.size * 0.18;
    ctx.strokeStyle = "#7a0c0c";
    ctx.strokeText(p.word, 0, 0);
    ctx.fillStyle = "#ffd93b";
    ctx.fillText(p.word, 0, 0);
  }
  ctx.restore();
}
