// The on-screen chrome outside the canvas: the status pill, the demo badge
// and the row of effect chips.

const statusEl = document.getElementById("status");
export const badgeEl = document.getElementById("badge");
export const hintEl = document.getElementById("hint");

export const FRAME_HINT = "Show both hands — thumb + index like a picture frame 🤳";

// Shows `text` in the status pill until replaced; null hides it.
export function setStatus(text) {
  if (text === null) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

// Shows `text` for `ms`, then hides the pill.
let flashTimer = 0;
export function flashStatus(text, ms = 1600) {
  setStatus(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => setStatus(null), ms);
}
