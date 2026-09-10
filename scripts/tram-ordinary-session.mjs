// Historical section 15 route; use tram-open-ordinary-traversal.mjs for the current spawn/layout.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifacts = path.resolve("artifacts");
const videoDir = path.join(artifacts, "tram-ordinary-video-temp");
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
  if (message.type() !== "error") return;
  if (/WebGPU creation\/initialization|WebGPU is not supported/.test(message.text())) return;
  errors.push(`console: ${message.text()}`);
});

const log = [];
const note = (label, value) => {
  const entry = { label, ...value };
  log.push(entry);
  console.log(`${label}:${JSON.stringify(value)}`);
};
const snapshot = () => page.evaluate(() => {
  const g = window.__gflGame;
  const boss = g.sim.bossRef;
  return {
    state: g.state,
    locked: g.input.locked,
    godmode: g.sim.godmode,
    t: +g.sim.runTime.toFixed(2),
    x: +g.sim.pos.x.toFixed(2), y: +g.sim.pos.y.toFixed(2), z: +g.sim.pos.z.toFixed(2),
    hp: +g.sim.hp.toFixed(1), ammo: g.sim.ammo, caches: g.sim.cachesOpened,
    relay: g.sim.relayActive, bossSpawned: g.sim.bossSpawned,
    bossHp: boss ? +boss.hp.toFixed(1) : null,
    bossDistance: boss ? +Math.hypot(boss.pos.x - g.sim.pos.x, boss.pos.z - g.sim.pos.z).toFixed(1) : null,
    enemies: g.sim.enemies.length,
  };
});

async function waitSim(seconds) {
  await page.evaluate((duration) => new Promise((resolve) => {
    const g = window.__gflGame;
    const start = g.sim.runTime;
    const wallStart = Date.now();
    const interval = setInterval(() => {
      if (g.sim.runTime - start >= duration || g.state !== "playing" || !g.sim.alive || Date.now() - wallStart > 30000) {
        clearInterval(interval);
        resolve(null);
      }
    }, 25);
  }), seconds);
}

let virtualCursor = null;
async function look(dx, dy) {
  const box = await page.locator("#game-canvas").boundingBox();
  if (!box) throw new Error("game canvas has no bounds");
  if (!virtualCursor) virtualCursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let remainingX = dx;
  let remainingY = dy;
  for (let i = 0; i < 8 && (Math.abs(remainingX) > 1 || Math.abs(remainingY) > 1); i++) {
    const stepX = Math.max(-500, Math.min(500, remainingX));
    const stepY = Math.max(-320, Math.min(320, remainingY));
    const nextX = Math.max(box.x + 4, Math.min(box.x + box.width - 4, virtualCursor.x + stepX));
    const nextY = Math.max(box.y + 4, Math.min(box.y + box.height - 4, virtualCursor.y + stepY));
    await page.mouse.move(nextX, nextY);
    remainingX -= nextX - virtualCursor.x;
    remainingY -= nextY - virtualCursor.y;
    virtualCursor = { x: nextX, y: nextY };
  }
}

async function face(yaw, pitch = null) {
  for (let i = 0; i < 3; i++) {
    const view = await page.evaluate(() => {
      const g = window.__gflGame;
      return { yaw: g.sim.yaw, pitch: g.sim.pitch, sensitivity: g.sim.sensitivity,
        invertX: g.sim.invertLookX, invertY: g.sim.invertLookY };
    });
    let deltaYaw = yaw - view.yaw;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    const deltaPitch = pitch === null ? 0 : pitch - view.pitch;
    if (Math.abs(deltaYaw) < 0.05 && (pitch === null || Math.abs(deltaPitch) < 0.04)) return;
    await look(
      -deltaYaw / (0.0024 * view.sensitivity * (view.invertX ? -1 : 1)),
      -deltaPitch / (0.0021 * view.sensitivity * (view.invertY ? -1 : 1)),
    );
    await page.waitForTimeout(35);
  }
}

async function sprintTo(label, targetX, targetZ, dodge = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await snapshot();
    assert.equal(before.state, "playing", `${label} interrupted before movement`);
    assert.equal(before.godmode, false, `${label} unexpectedly enabled godmode`);
    const dx = targetX - before.x;
    const dz = targetZ - before.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1.8) break;
    await face(Math.atan2(-dx, -dz));
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("KeyW");
    if (dodge) await page.keyboard.press("ControlLeft");
    await waitSim(Math.min(2.4, distance / 9.4 + 0.12));
    await page.keyboard.up("KeyW");
    await page.keyboard.up("ShiftLeft");
  }
  const after = await snapshot();
  note(label, after);
  return after;
}

async function drive(label, key, seconds, { sprint = true, dodge = false, skill = false } = {}) {
  const before = await snapshot();
  assert.equal(before.state, "playing", `${label} interrupted before movement`);
  assert.equal(before.godmode, false, `${label} unexpectedly enabled godmode`);
  if (sprint) await page.keyboard.down("ShiftLeft");
  await page.keyboard.down(key);
  if (skill) await page.keyboard.press("KeyE");
  if (dodge) await page.keyboard.press("ControlLeft");
  await waitSim(seconds);
  await page.keyboard.up(key);
  if (sprint) await page.keyboard.up("ShiftLeft");
  const after = await snapshot();
  note(label, after);
  return after;
}

async function settleOrdinaryModals(label) {
  for (let i = 0; i < 6; i++) {
    const state = (await snapshot()).state;
    if (state === "playing") break;
    if (state === "levelup") await page.locator(".up-card").first().click();
    else if (state === "compare") await page.locator("#c-no").click();
    else throw new Error(`${label} reached unsupported state ${state}`);
    await page.waitForTimeout(200);
  }
  let current = await snapshot();
  if (current.state === "playing" && !current.locked) {
    await page.locator("#game-canvas").click({ force: true });
    await page.waitForTimeout(250);
    current = await snapshot();
  }
  note(label, current);
  assert.equal(current.state, "playing", `${label} did not return to play`);
  assert.equal(current.locked, true, `${label} did not reacquire pointer lock`);
  return current;
}

let video;
let result;
try {
  // Load the dev-only station while the game is still at the title screen, so
  // none of the import time consumes ordinary run time.
  await page.goto(`${base}/?dev=1&scene=tram-review&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!window.__gflGame, null, { timeout: 60000 });
  await page.evaluate(() => window.__gflGame.enterTramReview());
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });

  // Ordinary title, character-select, and deploy flow.
  await page.locator("#b-play").click();
  await page.locator('.char-card[data-id="tololo"]').click();
  await page.locator("#b-go").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__gflGame.state === "paused", null, { timeout: 10000 });
  await page.waitForFunction(() => window.__gflGame.sim.externalStatus === "pmx", null, { timeout: 120000 });

  // Remove only the boot-time lock bypass, then resume through the visible UI.
  await page.evaluate(() => window.__gflGame.dev.set("nolock", "0"));
  await page.locator("#p-res").click();
  await page.waitForTimeout(700);
  const start = await snapshot();
  note("START", start);
  assert.equal(start.locked, true, "ordinary session did not acquire pointer lock");
  assert.equal(start.godmode, false, "ordinary session started with godmode");

  // The spawn cache is already in ordinary F range. Nearest-wins must loot it
  // rather than activating the overlapping relay prompt.
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(250);
  const cache = await snapshot();
  note("CACHE", cache);
  assert.equal(cache.caches, 1, "spawn cache was not opened");
  assert.equal(cache.relay, false, "spawn cache interaction activated the relay");

  // With the view facing north, ordinary W/S follows the ramp and the active
  // reverse-strafe setting maps D/A to west/east. Fixed key beats avoid idle
  // time and synthetic mouse correction while the director remains live.
  await drive("B-STAGE-NORTH", "KeyW", 0.95, { skill: true });
  await drive("B-MOUTH-WEST", "KeyD", 0.75, { sprint: false });
  await drive("B-DECK", "KeyW", 0.82);
  const platform = await drive("PLATFORM", "KeyW", 1.0, { dodge: true });
  assert.ok(platform.y > 1.2, `platform traversal did not reach deck height: ${JSON.stringify(platform)}`);
  await page.screenshot({ path: path.join(artifacts, "tram-ordinary-platform.png") });

  // Return down the same valid link, exit east of K1, and approach the relay.
  await drive("B-MOUTH-DOWN", "KeyS", 1.45, { dodge: true });
  const apron = await drive("B-APRON", "KeyS", 0.62);
  assert.ok(apron.y < 0.25, `ramp descent did not return to apron: ${JSON.stringify(apron)}`);
  // Cross east while still in the clear slot between the north fence and K1;
  // farther south the two kiosk walls intentionally form continuous cover.
  await drive("B-EXIT-EAST", "KeyA", 0.85);
  // Pursuers are now north of the player. Fire backward while retreating into
  // relay range instead of arriving with the full pack untouched.
  await page.keyboard.press("KeyR");
  await page.keyboard.press("KeyQ");
  await page.mouse.down({ button: "right" });
  await page.mouse.down({ button: "left" });
  await drive("RELAY-APPROACH", "KeyS", 1.65, { dodge: true });
  await page.mouse.up({ button: "left" });
  await page.mouse.up({ button: "right" });
  await settleOrdinaryModals("APPROACH-MODALS");
  // Sidestep just enough that the mast is not directly behind the camera while
  // remaining inside the ordinary relay interaction radius.
  await drive("RELAY-SIDESTEP", "KeyA", 0.2);
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(250);
  const relay = await snapshot();
  note("RELAY", relay);
  assert.equal(relay.relay, true, "ordinary F did not activate relay");
  assert.equal(relay.bossSpawned, true, "relay activation did not spawn boss");
  assert.equal(relay.godmode, false, "godmode changed before boss encounter");
  await page.screenshot({ path: path.join(artifacts, "tram-ordinary-relay.png") });

  // Representative ordinary boss exchange: overdrive, focus burst, aimed
  // fire, strafe, and dodge. No state, damage, position, or health overrides.
  const bossHpBefore = relay.bossHp;
  await drive("BOSS-CLEAR-MAST", "KeyA", 0.3);
  // Phase Step south creates ordinary space and restores its empowered mag.
  await page.keyboard.down("KeyS");
  await waitSim(0.12);
  await page.keyboard.press("KeyE");
  await waitSim(0.08);
  await page.keyboard.up("KeyS");
  note("BOSS-SPACING", await snapshot());
  const aim = await page.evaluate(() => {
    const g = window.__gflGame;
    const boss = g.sim.bossRef;
    if (!boss) return null;
    const dx = boss.pos.x - g.sim.pos.x;
    const dz = boss.pos.z - g.sim.pos.z;
    const horizontal = Math.hypot(dx, dz);
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2((boss.pos.y + 1.8) - (g.sim.pos.y + 1.9), horizontal) };
  });
  assert.ok(aim, "boss disappeared before the ordinary exchange");
  await face(aim.yaw, aim.pitch);
  await page.mouse.down({ button: "right" });
  await page.mouse.down({ button: "left" });
  await page.keyboard.down("KeyS");
  await page.keyboard.press("ControlLeft");
  await waitSim(0.25);
  await page.screenshot({ path: path.join(artifacts, "tram-ordinary-boss.png") });
  await waitSim(0.65);
  await page.keyboard.up("KeyS");
  await page.mouse.up({ button: "left" });
  await page.mouse.up({ button: "right" });
  const boss = await snapshot();
  note("BOSS", boss);
  assert.equal(boss.godmode, false, "boss exchange enabled godmode");
  assert.ok(bossHpBefore !== null && boss.bossHp !== null && boss.bossHp < bossHpBefore,
    `ordinary shots did not damage the boss: ${JSON.stringify({ bossHpBefore, boss })}`);

  assert.deepEqual(errors, []);
  result = {
    pass: true,
    mode: "ordinary pointer-lock input; no godmode or gameplay overrides",
    log,
    errors,
    captures: ["tram-ordinary-platform.png", "tram-ordinary-relay.png", "tram-ordinary-boss.png", "tram-ordinary-session.webm"],
  };
} catch (error) {
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  await page.keyboard.up("KeyA").catch(() => {});
  await page.keyboard.up("KeyD").catch(() => {});
  await page.mouse.up({ button: "left" }).catch(() => {});
  await page.mouse.up({ button: "right" }).catch(() => {});
  await page.screenshot({ path: path.join(artifacts, "tram-ordinary-failure.png") }).catch(() => {});
  result = { pass: false, mode: "ordinary pointer-lock input; no godmode or gameplay overrides",
    error: error instanceof Error ? error.message : String(error), log, errors };
} finally {
  video = page.video();
  await page.close().catch(() => {});
  if (video) await video.saveAs(path.join(artifacts, "tram-ordinary-session.webm")).catch(() => {});
  await context.close();
  await browser.close();
  await fs.rm(videoDir, { recursive: true, force: true });
}

await fs.writeFile(path.join(artifacts, "tram-ordinary-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
