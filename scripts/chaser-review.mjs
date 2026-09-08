import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const sourceHash = createHash("sha256")
  .update(await fs.readFile("src/chaser.ts"))
  .update(await fs.readFile("src/sim.ts"))
  .digest("hex").slice(0, 12);
const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), "gfl2-chaser-"));
let browser;
let context;
let video;

try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  video = page.video();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/WebGPU|fatal error occurred/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  const nextRenderedFrame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  await page.goto(`${base}/?dev=1&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", undefined, { timeout: 120_000 });
  await page.waitForFunction(() => window.__gflGame.sim.externalStatus === "pmx", undefined, { timeout: 120_000 });

  const rngIsolation = await page.evaluate(() => {
    const game = window.__gflGame;
    const sample = (articulated) => {
      game.startRun("tololo");
      game.sim.spawnT = 100000;
      game.sim.debugChaserVisuals = articulated;
      game.sim.setGameplaySeed(0x13579bdf);
      const rows = [[-2, -4], [2, -5], [0, -7]].map(([x, z]) => {
        const p = game.sim.pos.clone();
        p.set(x, 0, z);
        const enemy = game.sim.spawnEnemy("chaser", p, false);
        return enemy && { speed: enemy.speed, attackT: enemy.attackT, decideT: enemy.decideT };
      });
      return { rows, next: game.sim.gameplayRandom() };
    };
    const legacy = sample(false);
    const animated = sample(true);
    return { legacy, animated };
  });
  assert.deepEqual(rngIsolation.animated, rngIsolation.legacy, "visual construction changed gameplay RNG outcomes");

  const coverNavigation = await page.evaluate(() => {
    const game = window.__gflGame;
    game.startRun("tololo");
    game.sim.godmode = true;
    game.sim.spawnT = 100000;
    game.sim.pos.set(-8, 0, 20);
    const p = game.sim.pos.clone();
    p.set(-8, 0, 13.5);
    const enemy = game.sim.spawnEnemy("chaser", p, false);
    enemy.hp = enemy.maxHp = 100000;
    const startDistance = Math.hypot(enemy.pos.x - game.sim.pos.x, enemy.pos.z - game.sim.pos.z);
    let maxLateral = 0;
    for (let i = 0; i < 240; i++) {
      game.sim.update(1 / 60);
      maxLateral = Math.max(maxLateral, Math.abs(enemy.pos.x + 8));
    }
    return {
      articulated: !!enemy.ch,
      startDistance,
      endDistance: Math.hypot(enemy.pos.x - game.sim.pos.x, enemy.pos.z - game.sim.pos.z),
      maxLateral,
      rootError: enemy.mesh.position.subtract(enemy.pos).length(),
    };
  });
  assert.equal(coverNavigation.articulated, true);
  assert.ok(coverNavigation.maxLateral > 1, "Chaser did not steer around courtyard cover");
  assert.ok(coverNavigation.endDistance < coverNavigation.startDistance, "Chaser did not close distance around cover");
  assert.ok(coverNavigation.rootError < 1e-6, "Chaser visual root diverged from authoritative position");

  const one = await page.evaluate(() => {
    const game = window.__gflGame;
    game.startRun("tololo");
    game.sim.godmode = true;
    game.sim.spawnT = 100000;
    game.sim.pos.set(0, 0, 7);
    game.sim.yaw = 0;
    game.sim.pitch = 0;
    game.sim.updateCamera(1, false);
    const p = game.sim.pos.clone();
    p.set(0, 0, -5);
    const enemy = game.sim.spawnEnemy("chaser", p, false);
    if (!enemy) return null;
    enemy.hp = enemy.maxHp = 1000;
    return { id: enemy.id, articulated: !!enemy.ch, childMeshes: enemy.mesh.getChildMeshes().length };
  });
  assert.ok(one?.articulated, "ordinary Chaser did not receive the articulated visual");
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.resolve("artifacts/chaser-approach.png") });

  const anticipation = await page.evaluate(() => {
    const game = window.__gflGame;
    const enemy = game.sim.enemies.find((e) => e.kind === "chaser");
    enemy.pos.set(0, 0, 4.9);
    enemy.attackT = 0.34;
    enemy.speed = 0;
    const cameraPos = game.sim.pos.clone();
    cameraPos.set(5, 2.5, 6);
    const cameraTarget = game.sim.pos.clone();
    cameraTarget.set(0, 1.1, 6);
    game.debugCamera = { pos: cameraPos, target: cameraTarget };
    return { hp: game.sim.hp, attackT: enemy.attackT };
  });
  await page.waitForTimeout(170);
  await page.screenshot({ path: path.resolve("artifacts/chaser-anticipation.png") });
  await page.waitForFunction(() => {
    const enemy = window.__gflGame.sim.enemies.find((e) => e.kind === "chaser");
    return enemy?.attackT > 1 && enemy?.ch.anim.strikeT > 0.1 && enemy?.ch.anim.strikeT < 0.24;
  }, undefined, { timeout: 3000 });
  const strike = await page.evaluate(() => {
    const game = window.__gflGame;
    const enemy = game.sim.enemies.find((e) => e.kind === "chaser");
    return { attackReset: enemy.attackT > 1, strikeActive: enemy.ch.anim.strikeT > 0, strikeT: enemy.ch.anim.strikeT };
  });
  assert.equal(strike.attackReset, true, "authoritative melee event did not occur");
  assert.equal(strike.strikeActive, true, "attack motion was not triggered by the damage event");
  await page.screenshot({ path: path.resolve("artifacts/chaser-strike.png") });

  const shotSetup = await page.evaluate(() => {
    const game = window.__gflGame;
    const enemy = game.sim.enemies.find((e) => e.kind === "chaser");
    game.sim.pos.set(-8, 0, 7);
    game.debugCamera = null;
    game.sim.yaw = 0;
    game.sim.pitch = 0;
    game.sim.updateCamera(1, false);
    game.syncCamera(1);
    game.scene.render();
    enemy.pos.set(-8, 0, -2);
    enemy.speed = 0;
    enemy.attackT = 100;
    enemy.hp = enemy.maxHp = 1000;
    game.sim.build.attachments.Muzzle = { id: "review-normal", slot: "Muzzle", rarity: "Common", name: "Review", flatAtk: 0, atkPct: 0, critRate: -10, critDmg: 0 };
    game.sim.firePrimary();
    const muzzle = game.sim.shotLog.at(-1).muzzle;
    return {
      hp: enemy.hp,
      muzzle: { x: muzzle.x, y: muzzle.y, z: muzzle.z },
      flash: game.sim.flashes.some((f) => f.active),
      impact: game.sim.sparks.some((s) => s.active),
    };
  });
  assert.ok(shotSetup.hp < 1000, "rifle shot missed the staged Chaser");
  assert.equal(shotSetup.flash, true, "rifle shot did not emit a muzzle flash");
  assert.equal(shotSetup.impact, true, "rifle hit did not emit impact chips");
  await nextRenderedFrame();
  await page.screenshot({ path: path.resolve("artifacts/chaser-rifle-hit.png") });

  const critShot = await page.evaluate(() => {
    const game = window.__gflGame;
    const enemy = game.sim.enemies.find((e) => e.kind === "chaser");
    const before = enemy.hp;
    game.sim.build.attachments.Muzzle.critRate = 10;
    game.sim.firePrimary();
    return {
      before,
      after: enemy.hp,
      whiteCore: game.sim.flashes.some((f) => f.active && f.mesh.name.startsWith("flashW")),
    };
  });
  assert.ok(critShot.after < critShot.before, "forced-critical rifle shot missed the staged Chaser");
  assert.equal(critShot.whiteCore, true, "critical hit did not emit its white impact core");
  await nextRenderedFrame();
  await page.screenshot({ path: path.resolve("artifacts/chaser-critical-hit.png") });

  const death = await page.evaluate(() => {
    const game = window.__gflGame;
    const enemy = game.sim.enemies.find((e) => e.kind === "chaser");
    enemy.hp = 1;
    game.sim.firePrimary();
    const cameraPos = game.sim.pos.clone();
    cameraPos.set(-4, 2.3, -0.5);
    const cameraTarget = game.sim.pos.clone();
    cameraTarget.set(-8, 1, -2);
    game.debugCamera = { pos: cameraPos, target: cameraTarget };
    return { active: game.sim.enemies.length, dying: game.sim.dying.length };
  });
  assert.deepEqual(death, { active: 0, dying: 1 }, "death did not enter the cleanup lifecycle");
  await page.waitForFunction(() => window.__gflGame.sim.dying[0]?.t < 0.32, undefined, { timeout: 5000 });
  await page.screenshot({ path: path.resolve("artifacts/chaser-death.png") });
  await page.waitForFunction(() => window.__gflGame.sim.dying.length === 0, undefined, { timeout: 5000 });

  const crowd = await page.evaluate(() => {
    const game = window.__gflGame;
    game.startRun("tololo");
    game.debugCamera = null;
    game.sim.godmode = true;
    game.sim.spawnT = 100000;
    game.sim.pos.set(0, 0, 10);
    game.sim.yaw = 0;
    game.sim.pitch = 0;
    game.sim.updateCamera(1, false);
    const positions = [[-6,-7],[-3,-8],[0,-9],[3,-8],[6,-7],[-4,-4],[-1.5,-5],[1.5,-5],[4,-4],[-2,-1],[2,-1]];
    for (const [index, [x,z]] of positions.entries()) {
      const p = game.sim.pos.clone();
      p.set(x, 0, z);
      const e = game.sim.spawnEnemy("chaser", p, index === 0);
      if (e) e.hp = e.maxHp = 55;
    }
    const elite = game.sim.enemies.find((e) => e.elite);
    return {
      count: game.sim.enemies.length,
      eliteCount: game.sim.enemies.filter((e) => e.elite).length,
      eliteCrown: !!elite?.mesh.getChildMeshes().find((m) => m.name.endsWith("-crown")),
    };
  });
  assert.deepEqual(crowd, { count: 11, eliteCount: 1, eliteCrown: true });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.resolve("artifacts/chaser-crowd.png") });
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const game = window.__gflGame;
      const target = game.sim.enemies.find((e) => e.kind === "chaser");
      if (!target) return;
      const dx = target.pos.x - game.sim.pos.x;
      const dz = target.pos.z - game.sim.pos.z;
      game.sim.yaw = Math.atan2(-dx, -dz);
      game.sim.updateCamera(1, false);
      target.hp = Math.min(target.hp, 12);
      game.sim.ammo = Math.max(game.sim.ammo, 2);
      game.sim.firePrimary();
    });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: path.resolve("artifacts/chaser-crowd-fight.png") });

  const popup = await page.evaluate(() => {
    const game = window.__gflGame;
    game.input.locked = true;
    document.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    const wasHeld = game.input.rmbDown;
    game.sim.update(1 / 60);
    const simWasAiming = game.sim.aiming;
    game.sim.addXp(game.sim.build.xpNext);
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    game.ui.els["modal-slot"].dispatchEvent(menu);
    return {
      wasHeld,
      simWasAiming,
      released: !game.input.rmbDown,
      simReleased: !game.sim.aiming,
      inputDisabled: !game.input.enabled,
      menuPrevented: menu.defaultPrevented,
      state: game.state,
    };
  });
  assert.deepEqual(popup, { wasHeld: true, simWasAiming: true, released: true, simReleased: true, inputDisabled: true, menuPrevented: true, state: "levelup" });
  await page.screenshot({ path: path.resolve("artifacts/chaser-upgrade-rmb.png") });
  await page.locator(".up-card").first().click();
  const resumed = await page.evaluate(() => {
    const game = window.__gflGame;
    game.input.locked = true;
    document.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    game.sim.update(1 / 60);
    const aiming = game.sim.aiming;
    document.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true }));
    game.sim.update(1 / 60);
    return { state: game.state, aiming, cleanRelease: !game.input.rmbDown && !game.sim.aiming };
  });
  assert.deepEqual(resumed, { state: "playing", aiming: true, cleanRelease: true });

  const cleanup = await page.evaluate(() => {
    const game = window.__gflGame;
    for (const e of game.sim.enemies) e.hp = 1;
    for (const e of [...game.sim.enemies]) game.sim.damageEnemy(e, 1000, { isProc: true });
    const beforeRestart = game.sim.dying.length;
    game.restart();
    return {
      beforeRestart,
      activeAfter: game.sim.enemies.length,
      dyingAfter: game.sim.dying.length,
      enemyMeshesAfter: game.scene.meshes.filter((m) => m.name.startsWith("enemy-")).length,
      enemyJointsAfter: game.scene.transformNodes.filter((n) => n.name.startsWith("enemy-")).length,
      chaserMaterialsAfter: game.scene.materials.filter((m) => m.name.startsWith("ch-body-enemy-")).length,
    };
  });
  assert.ok(cleanup.beforeRestart > 0);
  assert.deepEqual(cleanup, {
    beforeRestart: cleanup.beforeRestart,
    activeAfter: 0,
    dyingAfter: 0,
    enemyMeshesAfter: 0,
    enemyJointsAfter: 0,
    chaserMaterialsAfter: 0,
  });
  assert.deepEqual(errors, [], errors.join("\n"));

  const record = {
    conditions: "headless Chrome 1280x720, forced WebGL2, SwiftShader",
    revision,
    sourceHash,
    rngIsolation,
    coverNavigation,
    one,
    anticipation,
    strike,
    rifleSnapshot: { muzzle: shotSetup.muzzle, normalHit: shotSetup.hp < 1000, critShot },
    death,
    crowd,
    popup,
    resumed,
    cleanup,
    errors,
  };
  await fs.writeFile(path.resolve("artifacts/chaser-verification.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(record, null, 2));
} finally {
  try {
    if (context) await context.close();
    if (video) await video.saveAs(path.resolve("artifacts/chaser-review.webm"));
  } finally {
    if (browser) await browser.close();
    await fs.rm(videoDir, { recursive: true, force: true });
  }
}
