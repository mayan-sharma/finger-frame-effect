// Portal — another world replaces the frame, and you stay real in front of
// it (the person mask). Slide up/down or press its key again for the next
// world; ?scene=N (0-based) starts on one. Knob: size is how fast that world
// runs, from nearly frozen to fast-forward.

import { ctx, defineEffect, drawPersonOver, knobs, makeScratch,
  PORTAL_SCENE_FNS, PORTAL_SCENES, sizeScratch, urlParams } from "../api.js";

const startScene = parseInt(urlParams.get("scene"), 10);
let portalScene = startScene >= 0 && startScene < PORTAL_SCENES.length ? startScene : 0;

const sWorld = makeScratch(false);

// The scenes animate off absolute time, so the size knob cannot just scale it
// — that would jump the stars around. It runs a clock of its own instead.
let portalClock = 0;
let portalLastT = 0;

function drawPortal({ x: bx, y: by, w: bw, h: bh }, t) {
  // Knob: size is how fast the other world runs, from nearly frozen to a
  // world in fast-forward.
  const step = Math.min(64, Math.max(0, t - portalLastT));
  portalLastT = t;
  portalClock += step * (0.25 + 2.0 * knobs.size);

  // Another world replaces the box…
  const g = sizeScratch(sWorld, bw, bh);
  g.save();
  PORTAL_SCENE_FNS[portalScene](g, bw, bh, portalClock);
  g.restore();
  ctx.drawImage(sWorld.c, bx, by);
  // …except you, who stay real in front of it.
  drawPersonOver(bx, by, bw, bh);
}

export default defineEffect({
  id: "portal",
  name: "Portal",
  kind: "frame",
  needs: { mask: true },
  draw: drawPortal,
  cycle(step) {
    portalScene = (portalScene + step + PORTAL_SCENES.length) % PORTAL_SCENES.length;
    return `Portal → ${PORTAL_SCENES[portalScene]}`;
  },
  chipLabel: () => `Portal · ${PORTAL_SCENES[portalScene]}`,
});
