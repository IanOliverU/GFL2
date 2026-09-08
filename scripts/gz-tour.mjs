// Green Zone uncut gameplay tour (local review only). Records one continuous
// webm: courtyard crossing, firing, both walkway ramps + deck, alley cache
// interaction, relay combat, camera rotation near architecture.
// Usage: node scripts/gz-tour.mjs
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const errors = [];
const browser = await chromium.launch({
  executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: path.resolve("artifacts"), size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/WebGPU creation\/initialization|WebGPU is not supported/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  const run = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => page.waitForTimeout(ms);
  const keys = async (add, ms) => {
    await page.evaluate((ks) => ks.forEach((k) => window.__gflGame.input.keys.add(k)), add);
    await sleep(ms);
    await page.evaluate((ks) => ks.forEach((k) => window.__gflGame.input.keys.delete(k)), add);
  };
  // 1. Cross the courtyard toward the relay + fire a burst.
  await run(() => {
    const g = window.__gflGame;
    g.sim.pos.set(4, 0, 12); g.sim.yaw = 0; g.sim.pitch = -0.1;
    g.sim.updateCamera(1, false);
  });
  await keys(["KeyW"], 3500);
  await run(() => { window.__gflGame.input.mouseDown = true; });
  await sleep(1200);
  await run(() => { window.__gflGame.input.mouseDown = false; });
  // 2. West ramp up.
  await run(() => {
    const g = window.__gflGame;
    g.sim.pos.set(-48, 0, -30); g.sim.yaw = -Math.PI / 2;
    g.sim.updateCamera(1, false);
  });
  await keys(["KeyW"], 5000);
  // 3. Deck crossing (both connections used: in west, out east).
  await keys(["KeyW"], 9000);
  await sleep(500);
  await keys(["KeyW"], 6000);
  // 4. Alley cache: walk the lane, interact.
  await run(() => {
    const g = window.__gflGame;
    g.sim.pos.set(-19, 0, 20); g.sim.yaw = Math.PI / 2;
    g.sim.updateCamera(1, false);
  });
  await keys(["KeyW"], 3000);
  await run(() => window.__gflGame.sim.tryInteract());
  await sleep(1200);
  await run(() => { window.__gflGame.ui.closeModal(); if (window.__gflGame.state !== "playing") window.__gflGame.state = "playing"; });
  // 5. Relay combat: spawns on, fight inside the ring.
  await run(() => {
    const g = window.__gflGame;
    g.sim.pos.set(0, 0, 2); g.sim.yaw = 0; g.sim.pitch = -0.1;
    g.sim.updateCamera(1, false);
    g.sim.spawnT = 0.5;
  });
  await run(() => { window.__gflGame.input.mouseDown = true; });
  await sleep(6000);
  await run(() => { window.__gflGame.input.mouseDown = false; });
  // 6. Camera rotation near architecture (gameplay camera orbits with yaw).
  for (let i = 1; i <= 6; i++) {
    await run((y) => { window.__gflGame.sim.yaw = y; }, -0.5 + i * 0.35);
    await sleep(500);
  }
  const state = await run(() => ({
    state: window.__gflGame.state,
    kills: window.__gflGame.sim.kills,
    ammo: window.__gflGame.sim.ammo,
    pos: [window.__gflGame.sim.pos.x, window.__gflGame.sim.pos.y, window.__gflGame.sim.pos.z].map((v) => +v.toFixed(1)),
  }));
  state.errors = errors;
  console.log(JSON.stringify(state, null, 2));
  if (errors.length) process.exitCode = 1;
  await ctx.close();
  // Normalize the recording name for review.
  const { readdirSync, renameSync, rmSync, statSync } = await import("node:fs");
  const vids = readdirSync(path.resolve("artifacts")).filter((f) => f.endsWith(".webm"));
  if (vids.length) {
    vids.sort((a, b) => statSync(path.resolve("artifacts", b)).mtimeMs - statSync(path.resolve("artifacts", a)).mtimeMs);
    const dest = path.resolve("artifacts", "gz-tour.webm");
    try { rmSync(dest); } catch { /* first recording */ }
    renameSync(path.resolve("artifacts", vids[0]), dest);
    console.log("video saved: artifacts/gz-tour.webm");
  }
} finally {
  await browser.close();
}
