// Which effect is live, and switching between them: the chips, the keys, and
// loading whatever models the selected effect needs.

import EFFECT_LIST from "../effects/index.js";
import { buildRegistry } from "./registry.js";
import { flashStatus, hintEl } from "./ui.js";
import { ensureFace, ensureSegmenter } from "./vision.js";
import { clearSparks, clearShake } from "../lib/fx.js";

export const registry = buildRegistry(EFFECT_LIST);
export const effects = registry.map((r) => r.fx);

// Appends an effect that is not in index.js (`?try=`). Call before the chips
// are built. Returns its index.
export function addEffect(fx) {
  const at = effects.indexOf(fx);
  if (at >= 0) return at;
  const entry = buildRegistry([...effects, fx]).pop();
  registry.push(entry);
  effects.push(entry.fx);
  return effects.length - 1;
}

let current = 0;
export const currentIndex = () => current;
export const currentEffect = () => effects[current];

export const keyIndex = (key) => registry.findIndex((r) => r.key === key);

// `?fx=` takes an id ("portal") or a 1-based position ("6").
export function findEffect(ref) {
  if (!ref) return -1;
  const byId = effects.findIndex((fx) => fx.id === ref);
  if (byId >= 0) return byId;
  const n = parseInt(ref, 10);
  return String(n) === ref && n >= 1 && n <= effects.length ? n - 1 : -1;
}

export const wantsMask = (fx) =>
  typeof fx.needs.mask === "function" ? !!fx.needs.mask() : !!fx.needs.mask;

// Starts loading the models an effect needs; a no-op once they are up.
export function ensureModels(fx) {
  if (wantsMask(fx)) ensureSegmenter();
  if (fx.needs.face) ensureFace();
}

export function buildChips() {
  hintEl.innerHTML = "";
  registry.forEach(({ fx, key }, i) => {
    const el = document.createElement("div");
    el.className = "fx" + (i === current ? " active" : "");
    el.innerHTML = (key ? `<span class="k">${key}</span>` : "") + `<span class="n"></span>`;
    el.querySelector(".n").textContent = fx.name;
    el.addEventListener("click", () => setEffect(i));
    hintEl.appendChild(el);
  });
  refreshChips();
}

// An effect with variants can show the live one on its chip, so the extra
// press or slide is discoverable rather than hidden.
export function refreshChips() {
  [...hintEl.children].forEach((el, j) => {
    el.classList.toggle("active", j === current);
    const label = el.querySelector(".n");
    if (label && effects[j].chipLabel) label.textContent = effects[j].chipLabel();
  });
}

// Steps the live effect's variant. Returns false when it has none.
export function cycleVariant(step) {
  const fx = effects[current];
  if (!fx.cycle) return false;
  const label = fx.cycle(step);
  refreshChips();
  if (label) flashStatus(label);
  ensureModels(fx);
  return true;
}

// Selects effect `i` (wrapping). Selecting the live one again steps its
// variant, so every variant is reachable from its one key.
export function setEffect(i, { repeatCycles = true } = {}) {
  const idx = (i + effects.length) % effects.length;
  const fx = effects[idx];
  if (repeatCycles && idx === current && fx.cycle) {
    const label = fx.cycle(1);
    if (label) flashStatus(label);
  }
  current = idx;
  refreshChips();
  ensureModels(fx);
  if (fx.enter) fx.enter();
  if (fx.hint) flashStatus(fx.hint, 3500);
  for (const other of effects) if (other !== fx && other.reset) other.reset();
  clearSparks();
  clearShake();
}
