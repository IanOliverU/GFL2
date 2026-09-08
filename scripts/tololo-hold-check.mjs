// Tololo static-hold verification (local review only, unapproved).
// Text assertions + local captures for MANUAL review (never attached).
// Checks: rest anatomy, IK reach, palm-contact errors, stock weld, muzzle
// override honesty at level/up/down aim, firing continuity, zero errors.
// Usage: node scripts/tololo-hold-check.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const errors = [];
function watchPage(target) {
  target.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  target.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/WebGPU creation\/initialization|WebGPU is not supported/.test(text)) return;
    errors.push(`console: ${text}`);
  });
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const report = { status: "ready for visual review (NOT hold verified)" };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(page);
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(1500);

  // 1. Rest anatomy: right-handed rig identities after transforms.
  const rest = await page.evaluate(() => {
    const r = window.__tololoHold.rest();
    const toPlayer = (m) => ({ x: -m.x * 0.1175, y: m.y * 0.1175, z: -m.z * 0.1175 });
    return {
      wristR: toPlayer(r.wristR), wristL: toPlayer(r.wristL),
      upperLenR: +r.upperLenR.toFixed(2), foreLenR: +r.foreLenR.toFixed(2),
      upperLenL: +r.upperLenL.toFixed(2), foreLenL: +r.foreLenL.toFixed(2),
    };
  });
  assert.ok(rest.upperLenR > 1 && rest.upperLenR < 12, `bad upper arm length: ${rest.upperLenR}`);
  assert.ok(rest.upperLenR > 0 && Math.abs(rest.upperLenR - rest.upperLenL) < 0.05, "arm lengths asymmetric");
  // Model 左 renders player-local -X (= world +X at yaw 0 = anatomical left
  // of a character facing world -Z). 右 mirrors. Handedness is anatomical,
  // NOT chosen for the (left-side) legacy shot line.
  assert.ok(rest.wristL.x < 0 && rest.wristR.x > 0, `handedness mirrored: ${JSON.stringify(rest)}`);
  report.rest = rest;

  // 2. Static hold errors at level aim.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.pos.set(10, 0, 10); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.updateCamera(1, false);
  });
  await page.waitForTimeout(500);
  const level = await page.evaluate(() => window.__tololoHold.measure());
  assert.ok(level, "no hold measurement");
  assert.equal(level.clampedR, false, "right arm over-reached");
  assert.equal(level.clampedL, false, "left arm over-reached");
  assert.ok(level.mainErr < 0.12, `right palm off MainGrip: ${level.mainErr}`);
  assert.ok(level.supportErr < 0.12, `left palm off SupportGrip: ${level.supportErr}`);
  assert.ok(level.stockErr < 0.12, `stock off pocket: ${level.stockErr}`);
  report.level = level;

  // 3. Aim sweep: up / down keep contacts, barrel tracks look.
  const sweep = {};
  for (const [name, pitch] of [["down", -0.5], ["up", 0.45]]) {
    await page.evaluate((p) => { window.__gflGame.sim.pitch = p; }, pitch);
    await page.waitForTimeout(500);
    sweep[name] = await page.evaluate(() => window.__tololoHold.measure());
    assert.ok(sweep[name].mainErr < 0.15, `${name}: contact broke (${sweep[name].mainErr})`);
    assert.ok(sweep[name].supportErr < 0.15, `${name}: support broke (${sweep[name].supportErr})`);
  }
  await page.evaluate(() => { window.__gflGame.sim.pitch = -0.08; });
  report.sweep = sweep;

  // 4. Muzzle override honest + firing continuity (damage path untouched).
  const fire = await page.evaluate(() => {
    const g = window.__gflGame;
    const before = g.sim.ammo;
    g.input.mouseDown = true;
    return new Promise((resolve) => setTimeout(() => {
      g.input.mouseDown = false;
      resolve({
        ammoBefore: before, ammoAfter: g.sim.ammo,
        overrideOn: !!g.sim.muzzleOverride,
        hold: window.__tololoHold.measure(),
      });
    }, 800));
  });
  assert.ok(fire.ammoAfter < fire.ammoBefore, "firing did not consume ammo");
  assert.equal(fire.overrideOn, true, "muzzle override not driving the shot origin");
  assert.ok(fire.hold.mainErr < 0.15, "contact broke while firing");
  report.fire = { ammoBefore: fire.ammoBefore, ammoAfter: fire.ammoAfter, hold: fire.hold };

  // 5. Captures for MANUAL review (paths only).
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.__v3 = (x, y, z) => new g.sim.pos.constructor(x, y, z);
    g.sim.pos.set(10, 0, 10); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.updateCamera(1, false);
  });
  async function shot(name, cam, target) {
    await page.evaluate(([c, t]) => {
      window.__gflGame.debugCamera = {
        pos: window.__gflGame.__v3(c[0], c[1], c[2]),
        target: window.__gflGame.__v3(t[0], t[1], t[2]),
      };
    }, [cam, target]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.resolve(`artifacts/${name}`) });
    report[name] = `artifacts/${name}`;
  }
  await shot("tololo-hold-front.png", [10, 1.5, 7.0], [10, 1.15, 10]);
  await shot("tololo-hold-side.png", [13.2, 1.5, 10], [10, 1.15, 10]);
  await shot("tololo-hold-overhead.png", [10, 9, 10], [10, 0.8, 10]);
  // Close-ups on the grip zone for contact judgment (manual review).
  await shot("tololo-hold-grip-side.png", [11.6, 1.7, 10.2], [10, 1.45, 10.4]);
  await shot("tololo-hold-grip-quarter.png", [11.3, 1.9, 8.9], [10, 1.4, 10.3]);
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.debugCamera = null;
    g.sim.pos.set(4, 0, 12); g.sim.yaw = 0.38; g.sim.pitch = -0.12;
    g.sim.updateCamera(1, false);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.resolve("artifacts/tololo-hold-gameplay.png") });
  report["tololo-hold-gameplay.png"] = "artifacts/tololo-hold-gameplay.png";
  await page.close();

  // 6. Marker views (separate run so review captures stay clean).
  const mark = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(mark);
  await mark.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1&mark=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await mark.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await mark.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await mark.waitForTimeout(1500);
  await mark.evaluate(() => {
    const g = window.__gflGame;
    g.__v3 = (x, y, z) => new g.sim.pos.constructor(x, y, z);
    g.sim.pos.set(10, 0, 10); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.updateCamera(1, false);
    g.debugCamera = { pos: g.__v3(10, 1.5, 7.0), target: g.__v3(10, 1.15, 10) };
  });
  await mark.waitForTimeout(500);
  await mark.screenshot({ path: path.resolve("artifacts/tololo-hold-markers.png") });
  report["tololo-hold-markers.png"] = "artifacts/tololo-hold-markers.png";
  await mark.evaluate(() => {
    const g = window.__gflGame;
    g.debugCamera = { pos: g.__v3(11.6, 1.7, 10.2), target: g.__v3(10, 1.45, 10.4) };
  });
  await mark.waitForTimeout(500);
  await mark.screenshot({ path: path.resolve("artifacts/tololo-hold-markers-grip.png") });
  report["tololo-hold-markers-grip.png"] = "artifacts/tololo-hold-markers-grip.png";
  await mark.close();

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
