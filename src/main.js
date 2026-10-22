// Finger Frame Effect — entry point.
//
// Hold both hands up in an open "L" (thumb + index spread): the four
// fingertips make a frame, and the selected effect renders inside it. The
// "overlay" effects need no frame; each is a pose or a face, plus a trigger.
//
// Every effect is a module in src/effects/, listed in src/effects/index.js;
// docs/EFFECTS.md explains how to write one.
//
// URL options: ?demo (no camera), ?fx=<id or number> (start on an effect),
// ?try=<file> (load src/effects/<file>.js, unlisted), plus per-effect ones
// such as Portal's ?scene=1 and Speech Bubbles' ?lang=hi-IN.

import { demoMode, enterDemoMode, urlParams } from "./core/env.js";
import { bindInput } from "./core/input.js";
import { tick } from "./core/loop.js";
import { addEffect, buildChips, currentEffect, findEffect, registry, setEffect } from "./core/runtime.js";
import { resize } from "./core/stage.js";
import { badgeEl, FRAME_HINT, setStatus } from "./core/ui.js";
import { initCamera, initTracker } from "./core/vision.js";

// ?try=<name> runs src/effects/<name>.js without listing it in index.js, and
// starts on it: the quickest way to work on a new effect.
async function tryEffect(name) {
  if (!/^[\w-]+$/.test(name)) throw new Error("expected a file name like my-effect");
  const mod = await import(`./effects/${name}.js`);
  return addEffect(mod.default);
}

addEventListener("resize", resize);
resize();

let start = findEffect(urlParams.get("fx"));
let tryError = null;
if (urlParams.has("fx") && start < 0) console.warn(`?fx=${urlParams.get("fx")}: no such effect`);
if (urlParams.has("try")) {
  try {
    start = await tryEffect(urlParams.get("try"));
  } catch (err) {
    console.error(err);
    tryError = `?try=${urlParams.get("try")} failed: ${err.message} (details in the console)`;
  }
}

buildChips();
bindInput();
if (start >= 0) setEffect(start, { repeatCycles: false });

async function boot() {
  if (!demoMode) {
    try {
      setStatus("Loading hand tracker…");
      await initTracker();
      setStatus("Starting camera…");
      await initCamera();
      const fx = currentEffect();
      setStatus(fx.kind === "overlay" ? fx.hint : FRAME_HINT);
    } catch (err) {
      console.warn("Falling back to demo mode:", err);
      enterDemoMode();
    }
  }
  if (demoMode) {
    badgeEl.classList.add("show");
    const keys = registry.map((r) => r.key).filter(Boolean);
    setStatus(`Demo mode — synthetic frame, keys ${describeKeys(keys)} switch effects`);
  }
  if (tryError) setStatus(tryError);
  requestAnimationFrame(tick);
}

// "1-0 / q-p / a d" for the default keys: runs of one keyboard row joined.
function describeKeys(keys) {
  const rows = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const groups = [];
  for (const row of rows) {
    const inRow = keys.filter((k) => row.includes(k));
    if (!inRow.length) continue;
    const contiguous = inRow.every((k, i) => !i || row.indexOf(k) === row.indexOf(inRow[i - 1]) + 1);
    groups.push(contiguous && inRow.length > 2 ? `${inRow[0]}-${inRow[inRow.length - 1]}` : inRow.join(" "));
  }
  return groups.join(" / ");
}

boot();
