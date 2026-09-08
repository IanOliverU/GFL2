import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

const errors = [];
const KNOWN_NOISE = [
  /A fatal error occurred during WebGPU creation\/initialization/,
  /WebGPU is not supported/,
];
function isNoise(text) {
  return KNOWN_NOISE.some((re) => re.test(text));
}
function watchPage(target) {
  target.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  target.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isNoise(text)) return;
    errors.push(`console: ${text}`);
  });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
watchPage(page);

try {
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#b-play").waitFor({ state: "visible", timeout: 120_000 });
  assert.equal(await page.locator("#boot-error").isVisible(), false, "boot error is visible");
  assert.equal(await page.evaluate(() => window.__gflGame.renderer), "WebGL2", "forced fallback did not initialize WebGL2");
  await page.screenshot({ path: path.resolve("artifacts/title.png") });

  await page.locator("#b-controls").click();
  assert.ok(await page.locator(".controls-table tr").count() >= 10, "controls screen is incomplete");
  await page.locator("#b-back").click();
  await page.locator("#b-settings").click();
  await page.locator("#s-master").fill("0.55");
  assert.equal(await page.evaluate(() => window.__gflGame.settings.master), 0.55, "settings did not apply");
  assert.equal(await page.locator("#s-reverse-forward").isChecked(), false, "W/S polarity is not corrected by default");
  assert.equal(await page.locator("#s-reverse-strafe").isChecked(), true, "A/D polarity changed from the working mapping");
  assert.equal(await page.locator("#s-invert-x").isChecked(), true, "horizontal look changed from the working mapping");
  assert.equal(await page.locator("#s-invert-y").isChecked(), false, "vertical look is still inverted by default");
  await page.locator("#b-back").click();

  await page.locator("#b-play").click();
  assert.equal(await page.locator(".char-card").count(), 6, "character select must contain six characters");
  await page.locator('.char-card[data-id="tololo"]').click();
  await page.locator("#b-go").click();
  assert.equal(await page.evaluate(() => window.__gflGame.state), "playing", "selection Deploy did not start a run");

  const characters = ["tololo", "qiongjiu", "mosin", "sabrina", "peritya", "vepley"];
  const kitResults = [];
  for (const id of characters) {
    const result = await page.evaluate((charId) => {
      const game = window.__gflGame;
      game.startRun(charId);
      game.sim.godmode = true;
      game.sim.pos.x = 4;
      game.sim.pos.z = 12;
      game.sim.yaw = Math.PI;
      game.sim.pitch = 0;
      game.sim.updateCamera(1, false);
      for (let i = 0; i < 8; i++) {
        const enemy = game.sim.spawnEnemy("heavy");
        if (enemy) {
          enemy.pos.set(4 + (i % 3) * 0.7, 0, 20 + Math.floor(i / 3) * 1.2);
          enemy.hp = enemy.maxHp = 100000;
        }
      }
      const ammoBefore = game.sim.ammo;
      game.sim.firePrimary();
      const ammoSpent = ammoBefore - game.sim.ammo;
      const skillReady = [];
      for (let index = 0; index < 3; index++) {
        game.sim.skillCD[index] = 0;
        game.sim.castSkill(index);
        skillReady.push(game.sim.skillCD[index] > 0);
      }
      return {
        id: charId,
        state: game.state,
        slots: Object.keys(game.sim.build.attachments),
        ammoSpent,
        skillReady,
      };
    }, id);
    assert.equal(result.state, "playing", `${id} did not remain playable`);
    assert.equal(result.slots.length, 4, `${id} does not have four attachment slots`);
    assert.deepEqual(result.skillReady, [true, true, true], `${id} has a skill that failed to cast`);
    assert.equal(result.ammoSpent, id === "qiongjiu" ? 3 : 1, `${id} magazine semantics are wrong`);
    kitResults.push(result);
  }

  // Exercise fixed-step movement, camera look, jumping, dodge and boundaries.
  const movementStart = await page.evaluate(() => {
    const game = window.__gflGame;
    game.startRun("tololo");
    game.sim.godmode = true;
    game.sim.pos.set(-20, 0, 0);
    game.sim.yaw = 0;
    game.sim.pitch = 0;
    // Exercise the real document listeners while avoiding a headless pointer-lock
    // dependency. This catches duplicate Babylon FreeCamera input registration.
    game.input.locked = true;
    const move = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperties(move, {
      movementX: { value: 80 },
      movementY: { value: 40 },
    });
    document.dispatchEvent(move);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    return { x: game.sim.pos.x, z: game.sim.pos.z, yaw: game.sim.yaw, pitch: game.sim.pitch };
  });
  await page.waitForFunction((start) => {
    const p = window.__gflGame.sim.pos;
    return Math.hypot(p.x - start.x, p.z - start.z) > 0.55;
  }, movementStart, { timeout: 5000 });
  const movementEnd = await page.evaluate(() => {
    const game = window.__gflGame;
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }));
    game.input.locked = false;
    game.input.pressed.add("Space");
    game.input.pressed.add("ControlLeft");
    const forward = {
      x: -Math.sin(game.sim.yaw) * Math.cos(game.sim.pitch),
      y: Math.sin(game.sim.pitch),
      z: -Math.cos(game.sim.yaw) * Math.cos(game.sim.pitch),
    };
    const cameraForward = game.camera.getTarget().subtract(game.camera.position).normalize();
    return {
      x: game.sim.pos.x,
      z: game.sim.pos.z,
      yaw: game.sim.yaw,
      pitch: game.sim.pitch,
      reverseForward: game.sim.reverseForward,
      invertLookX: game.sim.invertLookX,
      invertLookY: game.sim.invertLookY,
      alignment: cameraForward.x * forward.x + cameraForward.y * forward.y + cameraForward.z * forward.z,
    };
  });
  const movedX = movementEnd.x - movementStart.x;
  const movedZ = movementEnd.z - movementStart.z;
  const movementSign = movementEnd.reverseForward ? -1 : 1;
  const expectedMoveX = -Math.sin(movementEnd.yaw) * movementSign;
  const expectedMoveZ = -Math.cos(movementEnd.yaw) * movementSign;
  assert.ok(movedX * expectedMoveX + movedZ * expectedMoveZ > 0.4, "W movement did not follow the configured direction");
  assert.ok(movementEnd.invertLookX ? movementEnd.yaw > movementStart.yaw : movementEnd.yaw < movementStart.yaw, "horizontal mouse polarity was not applied");
  assert.ok(movementEnd.invertLookY ? movementEnd.pitch > movementStart.pitch : movementEnd.pitch < movementStart.pitch, "vertical mouse polarity was not applied");
  assert.ok(movementEnd.alignment > 0.99, "render camera diverged from simulation look direction");
  await page.waitForTimeout(50);
  const traversal = await page.evaluate(() => ({ y: window.__gflGame.sim.pos.y, dodge: window.__gflGame.sim.dodgeCD }));
  assert.ok(traversal.y > 0, "jump did not leave the ground");
  assert.ok(traversal.dodge > 0, "dodge cooldown did not start");

  // A level pauses simulation, applies one offered choice, and resumes.
  const heldRmbTransition = await page.evaluate(() => {
    const game = window.__gflGame;
    game.startRun("tololo");
    game.sim.godmode = true;
    game.input.locked = true;
    document.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    const heldBefore = game.input.rmbDown;
    game.sim.update(1 / 60);
    const simHeldBefore = game.sim.aiming;
    game.sim.addXp(game.sim.build.xpNext);
    const popupMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    game.ui.els["modal-slot"].dispatchEvent(popupMenu);
    const canvasMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    game.canvas.dispatchEvent(canvasMenu);
    return {
      heldBefore,
      simHeldBefore,
      releasedForPopup: !game.input.rmbDown,
      simReleasedForPopup: !game.sim.aiming,
      inputDisabled: !game.input.enabled,
      popupMenuPrevented: popupMenu.defaultPrevented,
      canvasMenuPrevented: canvasMenu.defaultPrevented,
    };
  });
  assert.deepEqual(heldRmbTransition, {
    heldBefore: true,
    simHeldBefore: true,
    releasedForPopup: true,
    simReleasedForPopup: true,
    inputDisabled: true,
    popupMenuPrevented: true,
    canvasMenuPrevented: true,
  }, "held RMB leaked through the level-up transition");
  await page.locator(".up-card").first().waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => window.__gflGame.state), "levelup");
  await page.locator(".up-card").first().click();
  assert.equal(await page.evaluate(() => window.__gflGame.state), "playing");
  const rmbAfterPopup = await page.evaluate(() => {
    const game = window.__gflGame;
    game.input.locked = true;
    document.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    game.sim.update(1 / 60);
    const aiming = game.sim.aiming;
    document.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true }));
    game.sim.update(1 / 60);
    return { aiming, released: !game.input.rmbDown && !game.sim.aiming };
  });
  assert.deepEqual(rmbAfterPopup, { aiming: true, released: true }, "RMB aiming did not resume cleanly after the popup");

  // Empty attachment slots equip directly; occupied slots pause for comparison.
  await page.evaluate(() => {
    const game = window.__gflGame;
    game.onAttachmentFound({ id: "smoke-old", slot: "Muzzle", rarity: "Common", name: "Smoke Old", flatAtk: 1, atkPct: 0, critRate: 0, critDmg: 0 });
    game.onAttachmentFound({ id: "smoke-new", slot: "Muzzle", rarity: "Legendary", name: "Smoke New", flatAtk: 5, atkPct: 0.1, critRate: 0.05, critDmg: 0.2 });
  });
  await page.locator("#c-yes").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => window.__gflGame.state), "compare");
  await page.locator("#c-yes").click();
  assert.equal(await page.evaluate(() => window.__gflGame.sim.build.attachments.Muzzle.id), "smoke-new");

  // Pausing freezes active run time and all simulation timers.
  const pausedAt = await page.evaluate(() => {
    const game = window.__gflGame;
    game.pause();
    return game.sim.runTime;
  });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__gflGame.sim.runTime), pausedAt, "run timer advanced while paused");
  await page.locator("#p-res").click();

  // Development shortcut for a deterministic end-to-end objective resolution.
  await page.evaluate(() => {
    const game = window.__gflGame;
    game.sim.relayActive = true;
    game.sim.relayCharge = 1;
    game.sim.spawnBoss();
    game.sim.damageEnemy(game.sim.bossRef, 1e9, { direct: true });
  });
  await page.locator("#v-loop").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => window.__gflGame.state), "victory", "boss + relay did not produce victory");
  await page.screenshot({ path: path.resolve("artifacts/victory.png") });
  await page.locator("#v-loop").click();

  // Drain queued boss XP level-ups and a possible occupied-slot loop reward comparison.
  for (let i = 0; i < 12; i++) {
    const state = await page.evaluate(() => window.__gflGame.state);
    if (state === "levelup") await page.locator(".up-card").first().click();
    else if (state === "compare") await page.locator("#c-yes").click();
    else break;
  }
  const loopState = await page.evaluate(() => {
    const game = window.__gflGame;
    return {
      state: game.state,
      loop: game.sim.loop,
      cachesFresh: game.world.caches.every((cache) => !cache.taken),
      highReward: Object.values(game.sim.build.attachments).some((item) => item && (item.rarity === "Epic" || item.rarity === "Legendary")),
    };
  });
  assert.deepEqual(loopState, { state: "playing", loop: 1, cachesFresh: true, highReward: true }, "continue-loop transition was incomplete");

  // Death, retry, and title return must not duplicate or retain encounter state.
  await page.evaluate(() => {
    const game = window.__gflGame;
    game.sim.godmode = false;
    game.sim.damagePlayer(1e9);
  });
  await page.locator("#d-re").waitFor({ state: "visible" });
  await page.locator("#d-re").click();
  const retry = await page.evaluate(() => ({ state: window.__gflGame.state, loop: window.__gflGame.sim.loop, hp: window.__gflGame.sim.hp, maxHp: window.__gflGame.sim.maxHp }));
  assert.equal(retry.state, "playing");
  assert.equal(retry.loop, 0);
  assert.equal(retry.hp, retry.maxHp);
  await page.evaluate(() => window.__gflGame.toTitle());
  await page.locator("#b-play").waitFor({ state: "visible" });

  // Capture a representative in-engine frame after the state tests.
  await page.evaluate(() => {
    const game = window.__gflGame;
    game.startRun("vepley");
    game.sim.godmode = true;
    game.sim.relayActive = true;
    game.sim.pos.set(30, 0, 12);
    game.sim.yaw = -1.012;
    game.sim.pitch = -0.08;
    game.sim.updateCamera(1, false);
    game.sim.spawnBoss();
    game.sim.castSkill(2);
  });
  await page.waitForTimeout(1000);
  const fpsSample = await page.evaluate(() => Math.round(window.__gflGame.fps));
  await page.screenshot({ path: path.resolve("artifacts/gameplay.png") });

  // Attempt the preferred renderer separately; this environment may still fall back.
  const preferred = await browser.newPage({ viewport: { width: 800, height: 450 } });
  watchPage(preferred);
  await preferred.goto(`${base}/?dev=1&nolock=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await preferred.locator("#b-play").waitFor({ state: "visible", timeout: 120_000 });
  const preferredRenderer = await preferred.evaluate(() => window.__gflGame.renderer);
  await preferred.close();

  // Verify the real browser pointer-lock path (not the nolock automation mode).
  const locked = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(locked);
  await locked.goto(`${base}/?dev=1&renderer=webgl`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await locked.locator("#b-play").waitFor({ state: "visible", timeout: 120_000 });
  await locked.locator("#b-play").click();
  await locked.locator('.char-card[data-id="tololo"]').click();
  await locked.locator("#b-go").click();
  await locked.waitForFunction(() => document.pointerLockElement === document.querySelector("#game-canvas"), undefined, { timeout: 5000 });
  const lockedStart = await locked.evaluate(() => {
    const game = window.__gflGame;
    game.sim.godmode = true;
    game.sim.pos.set(-20, 0, 0);
    game.sim.yaw = 0;
    game.sim.pitch = 0;
    return {
      x: game.sim.pos.x,
      z: game.sim.pos.z,
      yaw: game.sim.yaw,
      reverseForward: game.sim.reverseForward,
      invertLookX: game.sim.invertLookX,
    };
  });
  await locked.mouse.move(720, 410);
  await locked.keyboard.down("w");
  await locked.waitForFunction((start) => {
    const p = window.__gflGame.sim.pos;
    return Math.hypot(p.x - start.x, p.z - start.z) > 0.55;
  }, lockedStart, { timeout: 5000 });
  await locked.keyboard.up("w");
  const lockedEnd = await locked.evaluate(() => ({
    x: window.__gflGame.sim.pos.x,
    z: window.__gflGame.sim.pos.z,
    yaw: window.__gflGame.sim.yaw,
    locked: document.pointerLockElement === document.querySelector("#game-canvas"),
  }));
  const lockedMoveSign = lockedStart.reverseForward ? -1 : 1;
  const lockedForwardX = -Math.sin(lockedEnd.yaw) * lockedMoveSign;
  const lockedForwardZ = -Math.cos(lockedEnd.yaw) * lockedMoveSign;
  assert.equal(lockedEnd.locked, true, "pointer lock was lost during real control input");
  assert.notEqual(lockedEnd.yaw, lockedStart.yaw, "real pointer-lock mouse input did not rotate the camera");
  assert.ok((lockedEnd.x - lockedStart.x) * lockedForwardX + (lockedEnd.z - lockedStart.z) * lockedForwardZ > 0.35, "real W input did not follow the configured polarity");
  // Exercise the combined real-pointer-lock + held-ADS + level-up path.
  await locked.mouse.down({ button: "right" });
  await locked.waitForFunction(() => window.__gflGame.sim.aiming, undefined, { timeout: 5000 });
  await locked.evaluate(() => window.__gflGame.sim.addXp(window.__gflGame.sim.build.xpNext));
  await locked.mouse.up({ button: "right" });
  await locked.locator(".up-card").first().waitFor({ state: "visible", timeout: 5000 });
  await locked.waitForFunction(() => document.pointerLockElement === null && window.__gflGame.camera.fov > 0.9, undefined, { timeout: 5000 });
  const lockedPopup = await locked.evaluate(() => ({
    state: window.__gflGame.state,
    rmbDown: window.__gflGame.input.rmbDown,
    aiming: window.__gflGame.sim.aiming,
    inputEnabled: window.__gflGame.input.enabled,
    pointerLock: document.pointerLockElement !== null,
  }));
  assert.deepEqual(lockedPopup, { state: "levelup", rmbDown: false, aiming: false, inputEnabled: false, pointerLock: false }, "real pointer-lock ADS leaked through level-up");
  await locked.locator(".up-card").first().click();
  await locked.waitForFunction(() => document.pointerLockElement === document.querySelector("#game-canvas"), undefined, { timeout: 5000 });
  await locked.keyboard.press("Escape");
  await locked.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watchPage(mobile);
  await mobile.goto(`${base}/?dev=1&nolock=1&renderer=webgl`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await mobile.locator("#b-play").waitFor({ state: "visible", timeout: 120_000 });
  await mobile.locator("#b-play").click();
  assert.equal(await mobile.locator(".char-card").count(), 6, "mobile character select did not load");
  await mobile.screenshot({ path: path.resolve("artifacts/mobile-select.png"), fullPage: true });
  await mobile.close();

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify({ rendererFallback: "WebGL2", preferredRenderer, pointerLockVerified: true, kits: kitResults.length, fpsSample, fpsConditions: "headless Chrome 1280x720, SwiftShader WebGL2", screenshots: 4, errors: errors.length }, null, 2));
} finally {
  await browser.close();
}
