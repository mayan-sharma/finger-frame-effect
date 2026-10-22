// Sound effects, synthesized with Web Audio: no files to download, and every
// one is a few oscillators and filtered noise. Two calls:
//
//   playSound(name, { volume, pitch, pan, delay, duration })   a one-shot
//   hum(name, level, pitch)   a held sound (a charge, a laser). Call it every
//                             frame with a 0..1 level; it fades out by itself
//                             once you stop calling.
//
// Browsers only start audio after a click or a key press, so the first
// gesture of either kind unlocks it; until then every call is silently
// dropped. `m` (or the speaker button) mutes, and that is remembered.
//
// Nothing here calls Math.random: effects share it, and the tests rely on its
// sequence being theirs alone.

import { canvas } from "../core/stage.js";

let ac = null;                   // the AudioContext, made on first use
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem("ffe-muted") === "1"; } catch { /* private mode */ }

// A private random sequence for pitch jitter and the noise buffer.
let seed = 0x9e3779b9;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function audio() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.7;
  // A gentle limiter, so a burst of shots stacks up without clipping.
  const limit = ac.createDynamicsCompressor();
  limit.threshold.value = -10;
  limit.ratio.value = 8;
  master.connect(limit).connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return ac;
}

// Any click or key press may start audio; the browser requires one.
for (const type of ["pointerdown", "keydown"]) {
  addEventListener(type, () => { const a = audio(); if (a && a.state !== "running") a.resume(); }, true);
}

const live = () => !muted && ac && ac.state === "running";

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("ffe-muted", m ? "1" : "0"); } catch { /* private mode */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ac.currentTime, 0.02);
}

// --- Building blocks ---------------------------------------------------------

// A gain envelope: up to `peak` in `a` seconds, then down over `d`.
function env(t0, peak, a, d) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  return g;
}

function noise(t0, dur) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(t0, rand() * 0.5);
  s.stop(t0 + dur + 0.05);
  return s;
}

function osc(type, t0, dur, f0, f1 = f0) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  return o;
}

function filter(type, f0, f1, t0, dur, q = 1) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  return f;
}

// --- The sounds --------------------------------------------------------------
// Each takes (out, t0, p, dur): an output node, a start time, a pitch factor
// (1 = as designed) and a length in seconds where that makes sense.

const SOUND_DEFS = {
  // A gunshot: a filtered crack over a low thump.
  bang(out, t, p) {
    noise(t, 0.3).connect(filter("lowpass", 6000 * p, 300, t, 0.25)).connect(env(t, 1, 0.002, 0.28)).connect(out);
    osc("sine", t, 0.2, 140 * p, 40).connect(env(t, 0.9, 0.003, 0.2)).connect(out);
  },
  // Brass on the floor.
  tink(out, t, p) {
    for (const f of [3100, 4650, 6900]) osc("sine", t, 0.3, f * p).connect(env(t, 0.12, 0.001, 0.25)).connect(out);
  },
  // Blades sliding out: a rising metallic scrape, then the ring.
  snikt(out, t, p) {
    noise(t, 0.15).connect(filter("bandpass", 1800 * p, 7000 * p, t, 0.12, 6)).connect(env(t, 0.8, 0.01, 0.12)).connect(out);
    for (const f of [2400, 3700]) osc("triangle", t + 0.1, 0.5, f * p).connect(env(t + 0.1, 0.15, 0.002, 0.45)).connect(out);
  },
  // Air torn by something fast. `duration` stretches it.
  whoosh(out, t, p, dur = 0.25) {
    noise(t, dur).connect(filter("bandpass", 600 * p, 3000 * p, t, dur, 1.5)).connect(env(t, 0.6, dur * 0.4, dur * 0.6)).connect(out);
  },
  slash(out, t, p) {
    noise(t, 0.16).connect(filter("highpass", 2500 * p, 6000 * p, t, 0.15)).connect(env(t, 0.7, 0.008, 0.14)).connect(out);
  },
  // A finger snap.
  snap(out, t, p) {
    noise(t, 0.05).connect(filter("bandpass", 2600 * p, 2600 * p, t, 0.04, 3)).connect(env(t, 1, 0.001, 0.05)).connect(out);
  },
  // Spidey's web: a quick falling zip.
  thwip(out, t, p) {
    osc("sawtooth", t, 0.14, 1800 * p, 220 * p).connect(filter("lowpass", 4000, 1200, t, 0.14)).connect(env(t, 0.3, 0.004, 0.13)).connect(out);
    noise(t, 0.1).connect(filter("highpass", 3000, 3000, t, 0.1)).connect(env(t, 0.25, 0.002, 0.08)).connect(out);
  },
  // Something huge going off. `duration` is the tail.
  boom(out, t, p, dur = 1.4) {
    osc("sine", t, dur, 70 * p, 28).connect(env(t, 1, 0.01, dur)).connect(out);
    noise(t, dur).connect(filter("lowpass", 900 * p, 80, t, dur)).connect(env(t, 0.9, 0.01, dur)).connect(out);
  },
  // A beam firing: a bright zap with a body.
  blast(out, t, p, dur = 1.2) {
    osc("sawtooth", t, dur, 420 * p, 90 * p).connect(filter("lowpass", 5000, 400, t, dur)).connect(env(t, 0.4, 0.02, dur)).connect(out);
    noise(t, dur).connect(filter("bandpass", 1500 * p, 300, t, dur, 0.8)).connect(env(t, 0.7, 0.02, dur)).connect(out);
  },
  // A camera shutter: two clicks and the film advancing.
  shutter(out, t, p) {
    for (const dt of [0, 0.07]) {
      noise(t + dt, 0.03).connect(filter("bandpass", 3500 * p, 3500 * p, t + dt, 0.03, 2)).connect(env(t + dt, 0.8, 0.001, 0.03)).connect(out);
    }
    noise(t + 0.12, 0.25).connect(filter("bandpass", 900 * p, 1400 * p, t + 0.12, 0.25, 4)).connect(env(t + 0.12, 0.15, 0.05, 0.2)).connect(out);
  },
  // A soft puff of smoke.
  poof(out, t, p) {
    noise(t, 0.35).connect(filter("lowpass", 1400 * p, 300, t, 0.3)).connect(env(t, 0.6, 0.02, 0.3)).connect(out);
  },
  // Rubber pulled tight: a rising wobble.
  stretch(out, t, p, dur = 0.3) {
    const o = osc("triangle", t, dur, 160 * p, 520 * p);
    const wob = osc("sine", t, dur, 22);
    const depth = ac.createGain();
    depth.gain.value = 40 * p;
    wob.connect(depth).connect(o.frequency);
    o.connect(env(t, 0.35, 0.02, dur)).connect(out);
  },
  // Rubber letting go: the cartoon boing.
  boing(out, t, p) {
    const o = osc("sine", t, 0.6, 260 * p, 180 * p);
    const wob = osc("sine", t, 0.6, 14);
    const depth = ac.createGain();
    depth.gain.setValueAtTime(90 * p, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.6);
    wob.connect(depth).connect(o.frequency);
    o.connect(env(t, 0.4, 0.005, 0.55)).connect(out);
  },
  // A fist landing.
  thud(out, t, p) {
    osc("sine", t, 0.25, 110 * p, 38).connect(env(t, 1, 0.002, 0.25)).connect(out);
    noise(t, 0.12).connect(filter("lowpass", 1200 * p, 200, t, 0.1)).connect(env(t, 0.7, 0.002, 0.1)).connect(out);
  },
  // Magic: a bell-like shimmer.
  shimmer(out, t, p, dur = 1.2) {
    [1, 1.5, 2.01, 2.98, 4.2].forEach((k, i) => {
      osc("sine", t + i * 0.03, dur, 520 * k * p).connect(env(t + i * 0.03, 0.12, 0.01, dur)).connect(out);
    });
  },
  // Electricity: crackling noise bursts.
  crackle(out, t, p, dur = 0.5) {
    for (let i = 0; i < 6; i++) {
      const s = t + rand() * dur;
      noise(s, 0.04).connect(filter("bandpass", 2500 * p * (0.6 + rand()), 3000, s, 0.04, 4)).connect(env(s, 0.5, 0.001, 0.04)).connect(out);
    }
  },
  // A lighter: the wheel, then the flame catching.
  flick(out, t, p) {
    noise(t, 0.04).connect(filter("bandpass", 4000 * p, 4000, t, 0.04, 2)).connect(env(t, 0.5, 0.001, 0.04)).connect(out);
    noise(t + 0.04, 0.3).connect(filter("lowpass", 700 * p, 400, t + 0.04, 0.3)).connect(env(t + 0.04, 0.3, 0.05, 0.25)).connect(out);
  },
  // Time running backwards: a reversed swell.
  rewind(out, t, p, dur = 0.8) {
    noise(t, dur).connect(filter("bandpass", 300 * p, 3000 * p, t, dur, 2)).connect(env(t, 0.5, dur * 0.9, 0.08)).connect(out);
  },
  // A UI blip.
  click(out, t, p) {
    osc("square", t, 0.03, 1800 * p).connect(env(t, 0.08, 0.001, 0.03)).connect(out);
  },
};

export const SOUNDS = Object.keys(SOUND_DEFS);

export function playSound(name, { volume = 1, pitch = 1, pan = null, delay = 0, duration } = {}) {
  if (!live()) return;
  const def = SOUND_DEFS[name];
  if (!def) { console.warn(`playSound: no sound "${name}" (have: ${SOUNDS.join(", ")})`); return; }
  const t = ac.currentTime + delay;
  const out = ac.createGain();
  out.gain.value = volume;
  let tail = out;
  // `pan` is a canvas x: sounds sit where they happen.
  if (pan !== null && ac.createStereoPanner) {
    const sp = ac.createStereoPanner();
    sp.pan.value = Math.max(-1, Math.min(1, (pan / (canvas.width || 1)) * 2 - 1)) * 0.7;
    tail = out.connect(sp);
  }
  tail.connect(master);
  // A touch of pitch jitter, so the tenth gunshot isn't the first one again.
  def(out, t, pitch * (0.96 + rand() * 0.08), duration);
}

// --- Held sounds ------------------------------------------------------------

const HUM_DEFS = {
  // A building charge: detuned saws through a filter that opens with level.
  charge(h) {
    h.oscs = [osc("sawtooth", h.t, 1e4, 110), osc("sawtooth", h.t, 1e4, 110 * 1.007)];
    h.filter = filter("lowpass", 300, 300, h.t, 1, 3);
    for (const o of h.oscs) o.connect(h.filter);
    h.filter.connect(h.gain);
    h.set = (level, p) => {
      for (const [i, o] of h.oscs.entries()) o.frequency.setTargetAtTime((80 + 160 * level) * p * (i ? 1.007 : 1), ac.currentTime, 0.05);
      h.filter.frequency.setTargetAtTime(300 + 3500 * level, ac.currentTime, 0.05);
    };
  },
  // A laser: a buzzing square with a fast tremolo.
  laser(h) {
    const o = osc("square", h.t, 1e4, 180);
    const trem = osc("sine", h.t, 1e4, 31);
    const depth = ac.createGain();
    depth.gain.value = 0.3;
    const amp = ac.createGain();
    amp.gain.value = 0.7;
    trem.connect(depth).connect(amp.gain);
    o.connect(filter("bandpass", 1200, 1200, h.t, 1, 0.7)).connect(amp).connect(h.gain);
    h.oscs = [o, trem];
    h.set = (level, p) => o.frequency.setTargetAtTime(150 * p * (0.9 + 0.3 * level), ac.currentTime, 0.05);
  },
  // A low rumble: filtered noise.
  rumble(h) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(h.t);
    h.oscs = [s];
    h.filter = filter("lowpass", 200, 200, h.t, 1, 1);
    s.connect(h.filter).connect(h.gain);
    h.set = (level, p) => h.filter.frequency.setTargetAtTime((120 + 500 * level) * p, ac.currentTime, 0.08);
  },
};

const hums = new Map();

export function hum(name, level, pitch = 1) {
  if (!HUM_DEFS[name]) { console.warn(`hum: no sound "${name}" (have: ${Object.keys(HUM_DEFS).join(", ")})`); return; }
  if (!live()) return;
  let h = hums.get(name);
  if (!h && level <= 0.001) return;
  if (!h) {
    h = { t: ac.currentTime, gain: ac.createGain(), timer: 0 };
    h.gain.gain.value = 0;
    h.gain.connect(master);
    HUM_DEFS[name](h);
    hums.set(name, h);
  }
  h.set(Math.max(0, Math.min(1, level)), pitch);
  h.gain.gain.setTargetAtTime(0.25 * level, ac.currentTime, 0.06);
  // No call for a moment means the effect stopped (or was switched away).
  clearTimeout(h.timer);
  h.timer = setTimeout(() => stopHum(name), 200);
}

function stopHum(name) {
  const h = hums.get(name);
  if (!h) return;
  hums.delete(name);
  h.gain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
  for (const o of h.oscs) o.stop(ac.currentTime + 0.4);
}
