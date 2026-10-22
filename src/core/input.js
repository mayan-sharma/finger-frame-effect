// Keyboard and mouse. Effect keys come from the registry; `m` mutes; anything
// else is offered to the live effect first, and `f` falls through to its
// trigger.

import { currentEffect, currentIndex, cycleVariant, ensureModels, keyIndex, setEffect } from "./runtime.js";
import { canvas } from "./stage.js";
import { flashStatus } from "./ui.js";
import { isMuted, setMuted } from "../lib/sound.js";

const soundBtn = document.getElementById("sound");

function toggleMute() {
  setMuted(!isMuted());
  showMute();
  flashStatus(isMuted() ? "🔇 Sound off — m to turn it back on" : "🔊 Sound on");
}

function showMute() {
  soundBtn.textContent = isMuted() ? "🔇" : "🔊";
  soundBtn.setAttribute("aria-pressed", String(isMuted()));
}

export function bindInput() {
  showMute();
  soundBtn.addEventListener("click", toggleMute);

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const idx = keyIndex(key);
    const fx = currentEffect();
    if (idx >= 0) setEffect(idx);
    else if (key === "ArrowRight") setEffect(currentIndex() + 1);
    else if (key === "ArrowLeft") setEffect(currentIndex() - 1);
    else if (key === "ArrowUp" || key === "ArrowDown") cycleVariant(key === "ArrowUp" ? 1 : -1);
    else if (key === "m") toggleMute();
    else if (fx.onKey && fx.onKey(key)) ensureModels(fx);
    else if (key === "f" && fx.trigger) fx.trigger();
  });

  canvas.addEventListener("click", (e) => {
    const k = canvas.width / (canvas.clientWidth || 1);
    const fx = currentEffect();
    if (fx.onClick && fx.onClick(e.offsetX * k, e.offsetY * k)) return;
    setEffect(currentIndex() + 1);
  });
}
