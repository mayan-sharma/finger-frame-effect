// Speech Bubbles — talk, and it comes out as a comic
//
// The browser's speech recognition turns what you say into text, live, and
// it fills a comic bubble beside your head with its tail on your mouth. A
// pause ends a bubble; the next words start a new one and the old ones float
// up and fade. Talk with your mouth wide open and the bubble is a shout:
// jagged and in capitals. With no recogniser or no microphone, moving your
// mouth still gets a bubble of animated dots.

import { canvas, clamp, clamp01, ctx, defineEffect, demoMode, flashStatus,
  gagClock, mouth, unit, urlParams } from "../api.js";

// Speech Bubbles: the browser's speech recognition (`?lang=hi-IN` etc. to
// pick a language). A bubble finished BUBBLE_HOLD_S ago floats off.
const BUBBLE_MAX = 3;
const BUBBLE_LINES = 4;
const BUBBLE_HOLD_S = 2.2;
const BUBBLE_SHOUT = 0.7;        // mouth.open (0..1 past the latch) that is yelling

const speech = { state: "off", rec: null, now: 0, ratios: [], demoKey: "" };
const bubbles = [];

function startSpeech() {
  if (demoMode || speech.state === "on") return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speech.state = "unsupported";
    flashStatus("This browser has no speech recognition — bubbles show • • • instead", 4000);
    return;
  }
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = urlParams.get("lang") || navigator.language || "en-US";
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript.trim();
      if (text) bubbleSay(text, e.results[i].isFinal);
    }
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      speech.state = "denied";
      flashStatus("Microphone blocked — bubbles show • • • instead", 4000);
    } else if (e.error === "network") {
      speech.state = "denied";
      flashStatus("Speech service unreachable — bubbles show • • • instead", 4000);
    }
  };
  // Chrome ends a session after a while of silence; keep it going for as
  // long as the effect is up.
  rec.onend = () => {
    if (speech.state === "on" && speech.rec === rec) {
      try { rec.start(); } catch (err) { speech.state = "off"; }
    }
  };
  speech.rec = rec;
  speech.state = "on";
  try { rec.start(); } catch (err) { speech.state = "off"; }
}

function stopSpeech() {
  const rec = speech.rec;
  speech.rec = null;
  if (speech.state === "on") speech.state = "off";
  if (rec) { try { rec.abort(); } catch (err) { /* already stopped */ } }
}

// New words for the current bubble, or the first words of a new one once
// the last was finished. `opts.shout` forces the shout style (demo).
function bubbleSay(text, isFinal, opts) {
  const now = speech.now;
  let b = bubbles[bubbles.length - 1];
  if (!b || b.final || b.dots) {
    if (b && b.dots) b.final = true;
    b = { text: "", final: false, dots: false, born: now, last: now, p: 0, shout: false,
          x: null, y: null, rx: 0, ry: 0, seed: Math.random() * 100 };
    bubbles.push(b);
    while (bubbles.length > BUBBLE_MAX) bubbles.shift();
  }
  b.text = text;
  b.last = now;
  if (isFinal) b.final = true;
  // A mouth wide open while the words come (well past talking) is shouting.
  if ((opts && opts.shout) || (!demoMode && mouth.seen && mouth.open > BUBBLE_SHOUT)) b.shout = true;
}

// Without a recogniser: a bubble of dots for as long as the mouth is moving.
// Talking shows up as the lip gap changing, not as it being open.
function trackTalking(now) {
  if (demoMode || speech.state === "on" || !mouth.seen) return;
  const h = speech.ratios;
  h.push({ t: now, r: mouth.ratio || 0 });
  while (h.length && now - h[0].t > 0.6) h.shift();
  let lo = Infinity, hi = -Infinity;
  for (const s of h) { lo = Math.min(lo, s.r); hi = Math.max(hi, s.r); }
  if (h.length > 4 && hi - lo > 0.08) {
    let b = bubbles[bubbles.length - 1];
    if (!b || !b.dots || b.final) {
      bubbleSay("", false);
      b = bubbles[bubbles.length - 1];
      b.dots = true;
      b.final = false;
    }
    b.last = now;
  }
}

function bubbleFont(b, fs) {
  return b.shout
    ? `900 ${Math.round(fs * 1.12)}px "Bangers", Impact, "Arial Black", sans-serif`
    : `700 ${Math.round(fs)}px "Chalkboard SE", "Comic Sans MS", "Comic Neue", cursive`;
}

// Words into lines no wider than maxW, keeping only the last few lines of a
// long sentence (it is a bubble, not a transcript).
function wrapBubble(text, maxW) {
  const words = text.split(/\s+/).filter(Boolean), lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > BUBBLE_LINES) {
    const keep = lines.slice(-BUBBLE_LINES);
    keep[0] = "…" + keep[0];
    return keep;
  }
  return lines;
}

// One bubble: outlines first, then the fills over them, so the tail joins
// the body with no seam. `tail` is the point it aims at, or null.
function drawBubbleShape(b, cx, cy, rx, ry, tail, u) {
  const body = () => {
    ctx.beginPath();
    if (b.shout) {
      const n = 22;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const k = i % 2 ? 1 : 1.22 + 0.08 * Math.sin(b.seed + i * 2.7);
        ctx.lineTo(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
      }
      ctx.closePath();
    } else {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
  };
  const tailPath = () => {
    if (!tail) return false;
    const ang = Math.atan2(tail.y - cy, tail.x - cx);
    // The tail leaves the body's edge as a wedge and curves to a point.
    const spread = 0.28;
    const e = (a) => ({ x: cx + Math.cos(a) * rx * 0.9, y: cy + Math.sin(a) * ry * 0.9 });
    const p0 = e(ang - spread), p1 = e(ang + spread);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo((p0.x + tail.x) / 2 + (tail.y - cy) * 0.05, (p0.y + tail.y) / 2, tail.x, tail.y);
    ctx.quadraticCurveTo((p1.x + tail.x) / 2, (p1.y + tail.y) / 2, p1.x, p1.y);
    ctx.closePath();
    return true;
  };
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 4 * u;
  ctx.fillStyle = "#16161a";
  ctx.strokeStyle = "#16161a";
  ctx.lineWidth = 5 * u;
  body(); ctx.fill(); ctx.stroke();
  if (tailPath()) { ctx.fill(); ctx.stroke(); }
  ctx.shadowColor = "transparent";
  ctx.fillStyle = b.shout ? "#fff6c9" : "#ffffff";
  body(); ctx.fill();
  if (tailPath()) ctx.fill();
}

function renderBubbles(t) {
  gagClock(t);
  const now = speech.now = t / 1000;
  const W = canvas.width, H = canvas.height, u = unit();
  trackTalking(now);

  // Retire bubbles: finished ones linger, then float off.
  for (const b of bubbles) {
    const quiet = now - b.last;
    if (!b.final && quiet > (b.dots ? 1.0 : 2.5)) b.final = true;
    b.gone = b.final ? clamp01((quiet - BUBBLE_HOLD_S) / 0.6) : 0;
  }
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].gone >= 1) bubbles.splice(i, 1);

  // Anchor: beside your head, on whichever side has more room.
  const seen = mouth.seen;
  const mx = seen ? mouth.x : W / 2, my = seen ? mouth.y : H * 0.6, mw = seen ? mouth.w : H * 0.06;
  const side = mx < W / 2 ? 1 : -1;
  const fs = Math.max(16, H * 0.032);

  let stackY = null;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], newest = i === bubbles.length - 1;
    b.p += (1 - b.p) * 0.25;
    ctx.save();
    ctx.font = bubbleFont(b, fs);
    const text = b.dots ? "•  •  •".slice(0, 1 + 3 * (Math.floor(now * 3) % 3)) : (b.shout ? b.text.toUpperCase() + "!" : b.text);
    const lines = wrapBubble(text || "…", Math.min(W * 0.34, fs * 15));
    const lh = fs * (b.shout ? 1.12 : 1.22);
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
    const th = lines.length * lh;
    // The body eases to fit the words as they arrive.
    const trx = tw / 2 * 1.32 + fs * 0.9, try_ = th / 2 * 1.45 + fs * 0.75;
    b.rx = b.rx ? b.rx + (trx - b.rx) * 0.3 : trx;
    b.ry = b.ry ? b.ry + (try_ - b.ry) * 0.3 : try_;

    // Newest sits beside the head at about eye level, clear of the face (which
    // is roughly three mouth-widths across); older ones stack above it and
    // drift up as they go.
    let tx = mx + side * (mw * 2.2 + b.rx * 1.1), ty;
    if (newest) ty = my - mw * 1.7;
    else ty = stackY - b.ry * 1.15 - fs * 0.5 - b.gone * H * 0.08;
    tx = clamp(tx, b.rx * 1.25 + 8 * u, W - b.rx * 1.25 - 8 * u);
    ty = clamp(ty, b.ry * 1.3 + 8 * u, H - b.ry * 1.3 - 8 * u);
    b.x = b.x === null ? tx : b.x + (tx - b.x) * 0.2;
    b.y = b.y === null ? ty : b.y + (ty - b.y) * 0.2;
    stackY = b.y - b.ry * 1.15;

    // Pop in with a little overshoot; older bubbles shrink back a touch.
    const age = now - b.born, k = clamp01(age / 0.22);
    const pop = k < 1 ? 1 + 0.18 * Math.sin(k * Math.PI) - (1 - k) * 0.6 : 1;
    const sc = Math.max(0.05, pop * (newest ? 1 : 0.88) * (1 - 0.15 * b.gone));
    const jitter = b.shout && !b.final ? (Math.random() - 0.5) * 3 * u : 0;
    ctx.globalAlpha = 1 - b.gone;
    ctx.translate(b.x + jitter, b.y + jitter);
    ctx.scale(sc, sc);
    ctx.translate(-b.x, -b.y);
    const tail = newest && seen && !b.final
      ? { x: mx + side * mw * 0.55 + (b.x - mx) * 0.18, y: my - mw * 0.25 + (b.y - my) * 0.18 }
      : newest && seen ? { x: mx + side * mw * 0.7 + (b.x - mx) * 0.35, y: my + (b.y - my) * 0.35 } : null;
    drawBubbleShape(b, b.x, b.y, b.rx, b.ry, tail, u);
    ctx.fillStyle = b.shout ? "#b3121b" : "#16161a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, j) => ctx.fillText(l, b.x, b.y - th / 2 + lh * (j + 0.5)));
    ctx.restore();
  }
}

function resetBubbles() {
  stopSpeech();
  bubbles.length = 0;
  speech.ratios.length = 0;
}

// `f`: says something, to check it works without talking.
function triggerBubbles() {
  const lines = ["Is this thing on?", "I'm in a comic now!", "Testing, one, two, three."];
  bubbleSay(lines[(Math.random() * lines.length) | 0], true);
}

// The stand-in face "says" three lines in turn, word by word as live
// recognition would deliver them; the last one is shouted.
const DEMO_SAYINGS = [["Wait, is this thing on?", false], ["Hey! I'm in a comic now", false],
                      ["This is amazing", true]];
function demoBubbles(t) {
  const c = t % 15000, i = Math.floor(c / 5000), k = c % 5000;
  const [line, shout] = DEMO_SAYINGS[i], words = line.split(" ");
  let key = null, text = null, fin = false;
  if (k > 300 && k < 2300) {
    const n = Math.max(1, Math.ceil((k - 300) / 2000 * words.length));
    key = `${Math.floor(t / 15000)}-${i}-${n}`;
    text = words.slice(0, n).join(" ");
  } else if (k >= 2300) {
    key = `${Math.floor(t / 15000)}-${i}-final`;
    text = line;
    fin = true;
  }
  if (key && key !== speech.demoKey) {
    speech.demoKey = key;
    speech.now = t / 1000;
    bubbleSay(text, fin, { shout });
  }
}

export default defineEffect({
  id: "speech-bubbles",
  name: "Speech Bubbles",
  kind: "overlay",
  hint: "🗨️ Just talk — allow the mic and your words appear in a comic bubble",
  needs: { face: true },
  enter: startSpeech,
  demo: demoBubbles,
  render: renderBubbles,
  reset: resetBubbles,
  trigger: triggerBubbles,
});
