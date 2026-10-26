// Smoke test. Every effect in src/effects/index.js, plus the two templates,
// runs headless for a few hundred frames: once in ?demo, once on scripted
// hand and face tracking (fake-vision.js), each with its `f` trigger fired
// part way through. Any exception or console error fails the run.
//
//   npm test                    build, then everything
//   npm test -- portal snap     only these effect ids (or ?try= file names)
//   node test/smoke.mjs         skip the build (run `npm run build` first)
//
// It runs the production build with `catalyst serve`, on the port in
// config/config.json, so stop `npm start` first. Needs Google Chrome. Set
// CHROME_PATH if it is somewhere unusual.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const shim = await read("./shim.js");
const fakeVision = await read("./fake-vision.js");
const only = process.argv.slice(2);
const TEMPLATES = ["_template-frame", "_template-overlay"];

const config = JSON.parse(await read("../config/config.json"));
const base = `http://${config.NODE_SERVER_HOSTNAME}:${config.NODE_SERVER_PORT}/`;
const server = await startServer();
process.on("exit", () => stopServer(server));
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
  headless: true,
  protocolTimeout: 60000,        // a stalled page fails (and retries) in a minute
  // GitHub's Ubuntu runners have no usable Chrome sandbox.
  // Audio may start without a click, so the sound code runs too.
  args: ["--autoplay-policy=no-user-gesture-required", ...(process.env.CI ? ["--no-sandbox"] : [])],
});

// One page: load `query`, run `frames` frames with `f` pressed at frame 120,
// and collect every error. `expect` is the effect id that must be selected.
async function run(query, frames, expect) {
  const page = await browser.newPage();
  try {
    return await runOn(page, query, frames, expect);
  } finally {
    await page.close().catch(() => {});
  }
}

async function runOn(page, query, frames, expect) {
  await page.setViewport({ width: 960, height: 540 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().startsWith(base)) return req.continue();
    if (req.url().endsWith("/vision_bundle.mjs")) {
      return req.respond({ status: 200, contentType: "text/javascript",
                           headers: { "access-control-allow-origin": "*" },
                           body: req.method() === "HEAD" ? "" : fakeVision });
    }
    return req.abort();          // offline: nothing else leaves the machine
  });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(m.text());
  });
  await page.evaluateOnNewDocument(shim);
  await page.goto(base + query);
  await page.waitForFunction(() => window.__ready(), { polling: 50, timeout: 30000 });
  const step = (n) => page.evaluate((k) => {
    window.__onFrame = (f) => window.__speechTick(f);
    window.__step(k);
  }, n);
  await step(120);
  const selected = await page.evaluate(() => document.querySelector("#hint .fx.active")?.dataset.id);
  if (selected !== expect) problems.push(`expected "${expect}" to be selected, got "${selected}"`);
  await page.evaluate(() => window.__key("f"));
  await step(frames - 120);
  problems.push(...await page.evaluate(() => window.__errors));
  return [...new Set(problems)];
}

// `catalyst serve` in its own process group, so stopping it also stops the
// server process it spawns. Resolves once the page answers.
async function startServer() {
  // Otherwise the test could quietly run against whatever already answers.
  const busy = await fetch(base).then(() => true, () => false);
  if (busy) throw new Error(`${base} is already in use: stop \`npm start\` (or whatever runs there) first`);
  const child = spawn("npx", ["catalyst", "serve"], { detached: true, stdio: ["ignore", "ignore", "inherit"] });
  let exited = false;
  child.once("exit", () => { exited = true; });
  for (let i = 0; i < 300; i++) {
    if (exited) throw new Error("catalyst serve exited; see the message above");
    try {
      if ((await fetch(base)).ok) return child;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  stopServer(child);
  throw new Error(`catalyst serve did not answer on ${base} within 30 s`);
}

function stopServer(child) {
  try { process.kill(-child.pid); } catch { /* already gone */ }
}

const ids = await (async () => {
  const page = await browser.newPage();
  await page.goto(base + "?demo");
  const list = await page.$$eval("#hint .fx", (els) => els.map((el) => el.dataset.id));
  await page.close();
  return list;
})();

const jobs = [];
for (const id of ids) jobs.push({ id, query: `?demo&fx=${id}`, frames: 360, expect: id, mode: "demo" },
                                { id, query: `?live&fx=${id}`, frames: 1700, expect: id, mode: "live" });
for (const file of TEMPLATES) {
  const expect = file === "_template-frame" ? "night-vision" : "fireflies";
  jobs.push({ id: file, query: `?demo&try=${file}`, frames: 360, expect, mode: "demo" },
            { id: file, query: `?live&try=${file}`, frames: 1700, expect, mode: "live" });
}
const todo = jobs.filter((j) => !only.length || only.includes(j.id));
if (!todo.length) {
  console.error(`No effect matches ${only.join(" ")}. Ids: ${ids.join(" ")}`);
  process.exit(1);
}

// A run that throws (rather than reporting errors) means Chrome itself
// stalled, which a loaded CI machine does now and then: that gets one retry.
async function attempt(job, tries = 2) {
  try {
    return await run(job.query, job.frames, job.expect);
  } catch (err) {
    if (tries > 1) return attempt(job, tries - 1);
    return [`the browser failed: ${err && err.message || err}`];
  }
}

let failed = 0, next = 0;
await Promise.all(Array.from({ length: process.env.CI ? 2 : 4 }, async () => {
  while (next < todo.length) {
    const job = todo[next++];
    const problems = await attempt(job);
    if (problems.length) failed++;
    console.log(`${problems.length ? "✗" : "✓"} ${job.id.padEnd(18)} ${job.mode}`);
    for (const p of problems) console.log(`    ${p.split("\n").slice(0, 4).join("\n    ")}`);
  }
}));
await browser.close();
stopServer(server);
console.log(failed ? `\n${failed} of ${todo.length} runs failed` : `\nAll ${todo.length} runs passed`);
process.exit(failed ? 1 : 0);
