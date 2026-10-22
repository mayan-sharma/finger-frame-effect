// Injected into the page before any of the app runs (see smoke.mjs): a
// seeded Math.random, a fake clock, and requestAnimationFrame / setTimeout
// driven by the test, so hundreds of frames run in moments and every run is
// the same. With ?live it also fakes the camera and the microphone.
(() => {
  let seed = 1234567;
  Math.random = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let NOW = 1000;
  const BASE = Date.UTC(2026, 9, 22, 12, 0, 0);
  performance.now = () => NOW;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(BASE + NOW); }
    static now() { return BASE + NOW; }
  }
  window.Date = FakeDate;
  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  const timers = [];
  let tid = 1;
  window.setTimeout = (fn, ms = 0) => { const id = tid++; timers.push({ id, at: NOW + ms, fn }); return id; };
  window.clearTimeout = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push(String(e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rej: " + String(e.reason && (e.reason.stack || e.reason))));
  window.__ready = () => queue.length > 0;
  window.__frame = 0;
  window.__step = (n) => {
    for (let i = 0; i < n; i++) {
      NOW += 1000 / 60;
      window.__frame++;
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      while (timers.length && timers[0].at <= NOW) { const t = timers.shift(); try { t.fn(); } catch (e) { window.__errors.push("timer: " + e.stack); } }
      const q = queue; queue = [];
      for (const cb of q) { try { cb(NOW); } catch (e) { window.__errors.push("tick: " + e.stack); } }
      if (window.__onFrame) window.__onFrame(window.__frame, NOW);
    }
  };
  window.__key = (key) => dispatchEvent(new KeyboardEvent("keydown", { key }));
  window.__shot = () => document.getElementById("stage").toDataURL("image/png");

  // Speech: scripted, no mic.
  class FakeSR {
    start() { FakeSR.inst = this; }
    abort() { if (FakeSR.inst === this) FakeSR.inst = null; }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  const lines = ["hello there", "this is a speech bubble test", "WOW", "finger frame effect is open source"];
  window.__speechTick = (frame) => {
    const r = FakeSR.inst;
    if (!r || !r.onresult || frame % 90 !== 45) return;
    const k = Math.floor(frame / 90);
    const text = lines[k % lines.length];
    const res = [{ 0: { transcript: text }, isFinal: k % 2 === 0, length: 1 }];
    r.onresult({ resultIndex: 0, results: res });
  };

  if (!location.search.includes("live")) return;
  // --- Fake camera --------------------------------------------------------
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  const camCanvas = document.createElement("canvas");
  camCanvas.width = 1280; camCanvas.height = 720;
  const cg = camCanvas.getContext("2d");
  window.__paintCam = (t) => {
    const g = cg.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, "#334"); g.addColorStop(1, "#a86");
    cg.fillStyle = g; cg.fillRect(0, 0, 1280, 720);
    cg.fillStyle = "#567";
    for (let i = 0; i < 8; i++) cg.fillRect(i * 160 + ((t / 40) % 160), 80 + (i % 3) * 30, 70, 260);
    cg.fillStyle = "#3a6ea5";
    cg.beginPath(); cg.ellipse(640, 720, 260, 300, 0, 0, Math.PI * 2); cg.fill();
    cg.fillStyle = "#d9a27e";
    cg.beginPath(); cg.ellipse(640, 300, 90, 115, 0, 0, Math.PI * 2); cg.fill();
    const hands = window.__lastHands || [];
    cg.fillStyle = "#e0b090";
    for (const h of hands) for (const p of h) { cg.beginPath(); cg.arc(p.x * 1280, p.y * 720, 9, 0, 7); cg.fill(); }
  };
  const realDraw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
    if (img && img.id === "cam") { window.__paintCam(NOW); img = camCanvas; }
    return realDraw.call(this, img, ...rest);
  };
  document.addEventListener("DOMContentLoaded", () => {
    const v = document.getElementById("cam");
    Object.defineProperty(v, "readyState", { get: () => 4 });
    Object.defineProperty(v, "currentTime", { get: () => window.__frame });
    Object.defineProperty(v, "videoWidth", { get: () => 1280 });
    Object.defineProperty(v, "videoHeight", { get: () => 720 });
    Object.defineProperty(v, "srcObject", { set: () => {}, get: () => null });
    v.play = async () => {};
  });
})();
