import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(`${base}/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", null, { timeout: 60000 });
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });

  async function pursuit(name, kind, enemy, player, expectedY, timeout = 30) {
    const result = await page.evaluate(({ kind, enemy, player, expectedY, timeout }) => new Promise((resolve) => {
      const g = window.__gflGame;
      for (const old of [...g.sim.enemies]) g.sim.damageEnemy(old, 999999, { isProc: true });
      for (const orb of g.sim.orbs) { orb.active = false; orb.mesh.isVisible = false; }
      g.sim.build.queuedLevels = 0;
      g.ui.closeModal();
      g.state = "playing";
      g.sim.godmode = true;
      g.sim.spawnT = 99999;
      g.sim.pos.set(player[0], player[1], player[2]);
      g.sim.vel.set(0, 0, 0);
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      const V = g.sim.pos.constructor;
      let actor;
      if (kind === "boss") {
        g.sim.bossSpawned = false;
        g.sim.bossRef = null;
        g.sim.spawnBoss();
        actor = g.sim.bossRef;
        actor.pos.set(enemy[0], enemy[1], enemy[2]);
      } else {
        actor = g.sim.spawnEnemy(kind, new V(enemy[0], enemy[1], enemy[2]), false);
      }
      actor.hp = actor.maxHp = 1000000;
      const t0 = g.sim.runTime;
      const w0 = Date.now();
      let lastX = actor.pos.x;
      let lastZ = actor.pos.z;
      let rescues = 0;
      let enteredRoute = false;
      const interval = setInterval(() => {
        const jump = Math.hypot(actor.pos.x - lastX, actor.pos.z - lastZ);
        if (jump > 2.5) rescues++;
        lastX = actor.pos.x;
        lastZ = actor.pos.z;
        enteredRoute ||= actor.routeDir !== 0;
        const distance = Math.hypot(actor.pos.x - g.sim.pos.x, actor.pos.z - g.sim.pos.z);
        const elapsed = g.sim.runTime - t0;
        const reached = distance < (kind === "boss" ? 4 : 2.8) && Math.abs(actor.pos.y - expectedY) < 0.25;
        if (reached || elapsed >= timeout || Date.now() - w0 > 180000) {
          clearInterval(interval);
          resolve({ reached, enteredRoute, rescues, elapsed: +elapsed.toFixed(1), distance: +distance.toFixed(1),
            end: [+actor.pos.x.toFixed(1), +actor.pos.y.toFixed(2), +actor.pos.z.toFixed(1)] });
        }
      }, 40);
    }), { kind, enemy, player, expectedY, timeout });
    assert.equal(result.reached, true, `${name} did not reach the player: ${JSON.stringify(result)}`);
    assert.equal(result.enteredRoute, true, `${name} did not use a tram elevation link`);
    assert.equal(result.rescues, 0, `${name} used a rescue teleport: ${JSON.stringify(result)}`);
    return { name, ...result };
  }

  const checks = [];
  checks.push(await pursuit("chaser-A-up", "chaser", [5, 0, 50], [5, 1.45, 30], 1.45));
  checks.push(await pursuit("chaser-B-corridor-up", "chaser", [8, 0, 43.2], [8, 1.45, 28], 1.45));
  checks.push(await pursuit("chaser-B-east-up", "chaser", [14, 0, 48], [8, 1.45, 28], 1.45));
  checks.push(await pursuit("heavy-B-east-up", "heavy", [14, 0, 48], [8, 1.45, 28], 1.45));
  checks.push(await pursuit("boss-B-east-up", "boss", [24, 0, 58], [6.6, 1.45, 24], 1.45, 40));
  checks.push(await pursuit("chaser-B-down", "chaser", [8, 1.45, 24], [16, 0, 55], 0));
  checks.push(await pursuit("heavy-B-down", "heavy", [8, 1.45, 24], [16, 0, 55], 0));

  const sameFloorJump = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gflGame;
    for (const old of [...g.sim.enemies]) g.sim.damageEnemy(old, 999999, { isProc: true });
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    g.state = "playing";
    g.sim.spawnT = 99999;
    g.sim.pos.set(14, 1.2, 48);
    g.sim.vel.set(0, 0, 0);
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    const V = g.sim.pos.constructor;
    const actor = g.sim.spawnEnemy("chaser", new V(20, 0, 48), false);
    let routed = false;
    const t0 = g.sim.runTime;
    const interval = setInterval(() => {
      routed ||= actor.routeDir !== 0;
      if (g.sim.runTime - t0 >= 1.5) {
        clearInterval(interval);
        resolve({ routed, endY: +actor.pos.y.toFixed(2) });
      }
    }, 40);
  }));
  assert.equal(sameFloorJump.routed, false, `apron jump incorrectly selected a ramp: ${JSON.stringify(sameFloorJump)}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, checks, sameFloorJump, errors }, null, 2));
} finally {
  await browser.close();
}
