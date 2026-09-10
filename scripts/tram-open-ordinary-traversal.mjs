import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifacts = path.resolve("artifacts");
const videoDir = path.join(artifacts, "tram-open-video-temp");
await fs.rm(videoDir, { recursive: true, force: true });
await fs.mkdir(videoDir, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/WebGPU creation\/initialization|WebGPU is not supported/.test(message.text())) {
    errors.push(`console: ${message.text()}`);
  }
});

const log = [];
const snapshot = () => page.evaluate(() => {
  const g = window.__gflGame;
  const pivotY = g.sim.pos.y + 1.9;
  return {
    state: g.state, locked: g.input.locked, godmode: g.sim.godmode,
    t: +g.sim.runTime.toFixed(2), x: +g.sim.pos.x.toFixed(2),
    y: +g.sim.pos.y.toFixed(2), z: +g.sim.pos.z.toFixed(2),
    yaw: +g.sim.yaw.toFixed(2), aiming: g.sim.aiming,
    cameraDistance: +Math.hypot(g.sim.camPos.x - g.sim.pos.x,
      g.sim.camPos.y - pivotY, g.sim.camPos.z - g.sim.pos.z).toFixed(2),
    cameraShoulder: g.sim.cameraShoulder,
  };
});
async function note(label) {
  const value = await snapshot();
  log.push({ label, ...value });
  console.log(`${label}:${JSON.stringify(value)}`);
  return value;
}
async function waitSim(seconds) {
  await page.evaluate((duration) => new Promise((resolve) => {
    const g = window.__gflGame;
    const start = g.sim.runTime;
    const wallStart = Date.now();
    const id = setInterval(() => {
      if (g.sim.runTime >= start + duration || g.state !== "playing" || !g.sim.alive || Date.now() - wallStart > 30000) {
        clearInterval(id);
        resolve(null);
      }
    }, 20);
  }), seconds);
}
async function drive(label, key, seconds, sprint = true) {
  if (sprint) await page.keyboard.down("ShiftLeft");
  await page.keyboard.down(key);
  await waitSim(seconds);
  await page.keyboard.up(key);
  if (sprint) await page.keyboard.up("ShiftLeft");
  const state = await note(label);
  assert.equal(state.state, "playing", `${label} interrupted`);
  return state;
}

let cursor;
async function look(dx, dy) {
  const box = await page.locator("#game-canvas").boundingBox();
  assert.ok(box, "game canvas has no bounds");
  cursor ??= { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const next = { x: Math.max(box.x + 4, Math.min(box.x + box.width - 4, cursor.x + dx)),
    y: Math.max(box.y + 4, Math.min(box.y + box.height - 4, cursor.y + dy)) };
  await page.mouse.move(next.x, next.y);
  cursor = next;
  await page.waitForTimeout(50);
}
async function face(yaw, pitch = -0.08) {
  for (let i = 0; i < 5; i++) {
    const view = await page.evaluate(() => ({ yaw: window.__gflGame.sim.yaw, pitch: window.__gflGame.sim.pitch,
      sensitivity: window.__gflGame.sim.sensitivity, invertX: window.__gflGame.sim.invertLookX,
      invertY: window.__gflGame.sim.invertLookY }));
    let dyaw = yaw - view.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = pitch - view.pitch;
    if (Math.abs(dyaw) < 0.035 && Math.abs(dpitch) < 0.025) return;
    await look(-dyaw / (0.0024 * view.sensitivity * (view.invertX ? -1 : 1)),
      -dpitch / (0.0021 * view.sensitivity * (view.invertY ? -1 : 1)));
  }
}

let result;
let video;
try {
  await page.goto(`${base}/?dev=1&scene=tram-review&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!window.__gflGame, null, { timeout: 60000 });
  await page.evaluate(() => window.__gflGame.enterTramReview());
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });
  await page.locator("#b-play").click();
  await page.locator('.char-card[data-id="tololo"]').click();
  await page.locator("#b-go").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__gflGame.state === "paused", null, { timeout: 10000 });
  await page.waitForFunction(() => window.__gflGame.sim.externalStatus === "pmx", null, { timeout: 120000 });
  await page.evaluate(() => window.__gflGame.dev.set("nolock", "0"));
  await page.locator("#p-res").click();
  await page.waitForTimeout(700);
  const start = await note("SPAWN");
  assert.equal(start.locked, true, "ordinary run did not acquire pointer lock");
  assert.equal(start.godmode, false, "ordinary run enabled godmode");
  assert.ok(Math.abs(start.x - 5) < 0.1 && Math.abs(start.z - 53.5) < 0.1, `wrong spawn: ${JSON.stringify(start)}`);
  assert.ok(start.cameraDistance > 5.5, `spawn camera squeezed: ${JSON.stringify(start)}`);
  await page.screenshot({ path: path.join(artifacts, "tram-open-traversal-spawn.png") });

  const passage = await drive("KIOSK-PASSAGE", "KeyW", 1.02);
  assert.ok(passage.z < 45, `did not reach kiosk passage: ${JSON.stringify(passage)}`);
  const deck = await drive("PLATFORM-ENTRY", "KeyW", 0.82);
  assert.ok(deck.y > 1.2, `did not climb ramp A: ${JSON.stringify(deck)}`);
  const platform = await drive("PLATFORM", "KeyW", 0.7, false);
  assert.ok(platform.z < 32, `platform route too short: ${JSON.stringify(platform)}`);
  await page.screenshot({ path: path.join(artifacts, "tram-open-traversal-platform-normal.png") });

  // Ordinary pointer-lock rotation and RMB movement across a canopy rib.
  await face(-0.32);
  await page.mouse.down({ button: "right" });
  await waitSim(0.25);
  await face(0.32, -0.04);
  await page.keyboard.down("KeyW");
  await waitSim(0.38);
  await page.keyboard.up("KeyW");
  await face(0, -0.08);
  await waitSim(0.25);
  const aimed = await note("PLATFORM-RMB");
  assert.equal(aimed.aiming, true, "RMB aiming did not engage");
  assert.ok(aimed.cameraDistance > 2.2, `RMB camera squeezed abruptly: ${JSON.stringify(aimed)}`);
  await page.screenshot({ path: path.join(artifacts, "tram-open-traversal-platform-rmb.png") });
  await page.mouse.up({ button: "right" });
  await face(0);

  const deckReturn = await drive("PLATFORM-RETURN", "KeyS", 1.05);
  assert.ok(deckReturn.z > 36, `did not return to ramp: ${JSON.stringify(deckReturn)}`);
  const apron = await drive("APRON", "KeyS", 0.78);
  assert.ok(apron.y < 0.25 && apron.z > 42, `did not descend to apron: ${JSON.stringify(apron)}`);
  await page.screenshot({ path: path.join(artifacts, "tram-open-traversal-apron.png") });
  assert.deepEqual(errors, []);
  result = { pass: true, mode: "ordinary pointer-lock movement and rotation; no godmode or gameplay overrides",
    renderer: "WebGL2 via --use-angle=d3d11", log, errors,
    captures: ["tram-open-traversal-spawn.png", "tram-open-traversal-platform-normal.png",
      "tram-open-traversal-platform-rmb.png", "tram-open-traversal-apron.png",
      "tram-open-ordinary-traversal.webm"] };
} catch (error) {
  for (const key of ["KeyW", "KeyS", "ShiftLeft"]) await page.keyboard.up(key).catch(() => {});
  await page.mouse.up({ button: "right" }).catch(() => {});
  result = { pass: false, mode: "ordinary pointer-lock movement and rotation; no godmode or gameplay overrides",
    error: error instanceof Error ? error.message : String(error), log, errors };
} finally {
  video = page.video();
  await page.close().catch(() => {});
  if (video) await video.saveAs(path.join(artifacts, "tram-open-ordinary-traversal.webm")).catch(() => {});
  await context.close();
  await browser.close();
  await fs.rm(videoDir, { recursive: true, force: true });
}
await fs.writeFile(path.join(artifacts, "tram-open-ordinary-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
