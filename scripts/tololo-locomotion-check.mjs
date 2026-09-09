// Velocity-driven Tololo locomotion verification and uncut review capture.
// Usage: node scripts/tololo-locomotion-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactDir = path.resolve("artifacts");
const videoDir = path.join(artifactDir, "tololo-video-temp");
await fs.mkdir(videoDir, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() !== "error") return;
  if (/WebGPU creation\/initialization|WebGPU is not supported/.test(message.text())) return;
  errors.push(`console: ${message.text()}`);
});

const report = {
  status: "ready for owner visual review",
  conditions: "headless Chrome 1280x720, forced WebGL2, SwiftShader",
  captures: [],
};

async function reset(pos = [4, 0, 12], yaw = 0) {
  await page.evaluate(({ pos, yaw }) => {
    const g = window.__gflGame;
    g.input.keys.clear();
    g.input.pressed.clear();
    g.input.mouseDown = false;
    g.input.rmbDown = false;
    g.sim.pos.set(pos[0], pos[1], pos[2]);
    g.sim.vel.set(0, 0, 0);
    g.sim.visualVel.set(0, 0, 0);
    g.sim.yaw = yaw;
    g.sim.pitch = -0.08;
    g.sim.dodgeT = 0;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    g.sim.updateCamera(1, false);
    const locomotion = g.sim.externalRoot?.metadata?.tololoRig?.locomotion;
    if (locomotion) {
      locomotion.phase = 0;
      locomotion.forward = 0;
      locomotion.right = 0;
      locomotion.weight = 0;
    }
  }, { pos, yaw });
  await page.waitForTimeout(250);
}

async function setCamera(pos, target) {
  await page.evaluate(({ pos, target }) => {
    const g = window.__gflGame;
    const V = g.sim.pos.constructor;
    g.debugCamera = { pos: new V(...pos), target: new V(...target) };
  }, { pos, target });
}

async function snapshot(label, file) {
  if (file) {
    await page.evaluate(() => {
      const g = window.__gflGame;
      const V = g.sim.pos.constructor;
      g.debugCamera = {
        pos: new V(g.sim.pos.x + 1.8, g.sim.pos.y + 1.7, g.sim.pos.z - 1.8),
        target: new V(g.sim.pos.x, g.sim.pos.y + 1.15, g.sim.pos.z),
      };
    });
    await page.waitForTimeout(80);
  }
  const state = await page.evaluate(() => {
    const g = window.__gflGame;
    const locomotion = g.sim.externalRoot?.metadata?.tololoRig?.locomotion;
    const hold = window.__tololoHold.measure();
    const muzzle = g.sim.muzzlePos();
    const holdMuzzle = hold?.muzzleWorld ?? null;
    return {
      pos: [g.sim.pos.x, g.sim.pos.y, g.sim.pos.z],
      velocity: [g.sim.visualVel.x, g.sim.visualVel.z],
      grounded: g.sim.grounded(),
      dodgeT: g.sim.dodgeT,
      aiming: g.sim.aiming,
      locomotion: locomotion ? { ...locomotion } : null,
      hold: hold ? {
        mainErr: hold.mainErr,
        supportErr: hold.supportErr,
        stockErr: hold.stockErr,
        barrelDeg: hold.barrelDeg,
        muzzleErr: Math.hypot(
          (holdMuzzle.x ?? holdMuzzle._x) - muzzle.x,
          (holdMuzzle.y ?? holdMuzzle._y) - muzzle.y,
          (holdMuzzle.z ?? holdMuzzle._z) - muzzle.z,
        ),
      } : null,
    };
  });
  if (file) {
    await page.screenshot({ path: path.join(artifactDir, file) });
    report.captures.push(file);
  }
  report[label] = state;
  if (state.hold) assert.ok(state.hold.muzzleErr < 1e-5, `${label}: live and synchronous muzzle poses diverged`);
  return state;
}

async function move(keys, ms, label, file) {
  const start = await page.evaluate((codes) => {
    const g = window.__gflGame;
    g.input.keys.clear();
    for (const code of codes) g.input.keys.add(code);
    return g.sim.runTime;
  }, keys);
  await page.waitForFunction(({ start, duration }) => window.__gflGame.sim.runTime >= start + duration,
    { start, duration: ms / 1000 }, { timeout: 30_000 });
  const state = await snapshot(label, file);
  await page.evaluate(() => window.__gflGame.input.keys.clear());
  return state;
}

try {
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.godmode = true;
    g.sim.spawnT = 99999;
    g.sim.reverseForward = false;
    g.sim.reverseStrafe = false;
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 99999, { isProc: true });
    for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    g.state = "playing";
  });
  await page.waitForTimeout(600);

  await reset();
  const idle = await snapshot("idle", "tololo-locomotion-idle.png");
  assert.ok(idle.locomotion && idle.locomotion.weight < 0.05, "idle gait did not settle");

  await reset();
  const forward = await move(["KeyW"], 550, "forward", "tololo-locomotion-forward.png");
  assert.ok(forward.locomotion.forward > 2 && Math.hypot(...forward.velocity) > 5, "forward gait did not engage");
  const phaseBeforePause = await page.evaluate(() => {
    const g = window.__gflGame;
    g.pause();
    return g.sim.externalRoot.metadata.tololoRig.locomotion.phase;
  });
  await page.waitForTimeout(300);
  const phasePaused = await page.evaluate(() => window.__gflGame.sim.externalRoot.metadata.tololoRig.locomotion.phase);
  assert.equal(phasePaused, phaseBeforePause, "locomotion phase advanced while paused");
  await page.evaluate(() => window.__gflGame.resume());

  await reset();
  const reverse = await move(["KeyS"], 550, "reverse", "tololo-locomotion-reverse.png");
  assert.ok(reverse.locomotion.forward < -2 && Math.hypot(...reverse.velocity) > 5, "reverse gait did not engage");

  await reset();
  const strafe = await move(["KeyD"], 550, "strafe", "tololo-locomotion-strafe.png");
  assert.ok(strafe.locomotion.right > 2 && Math.hypot(...strafe.velocity) > 5, "strafe gait did not engage");

  await reset();
  const diagonal = await move(["KeyW", "KeyD"], 550, "diagonal", "tololo-locomotion-diagonal.png");
  assert.ok(diagonal.locomotion.forward > 1.5 && diagonal.locomotion.right > 1.5, "diagonal blend did not engage both axes");

  await reset();
  const sprint = await move(["KeyW", "ShiftLeft"], 550, "sprint", "tololo-locomotion-sprint.png");
  assert.ok(Math.hypot(sprint.locomotion.forward, sprint.locomotion.right) > 5
    && Math.hypot(...sprint.velocity) > 8, `sprint gait did not reach run blend: ${JSON.stringify(sprint)}`);

  await reset();
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.keys.add("KeyW");
    g.input.rmbDown = true;
    g.input.mouseDown = true;
  });
  await page.waitForTimeout(650);
  const armed = await snapshot("aimFireMove", "tololo-locomotion-aim-fire.png");
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.keys.clear();
    g.input.rmbDown = false;
    g.input.mouseDown = false;
  });
  assert.equal(armed.aiming, true, "RMB aim did not remain active while moving");
  assert.ok(armed.hold.mainErr < 0.12 && armed.hold.supportErr < 0.12 && armed.hold.stockErr < 0.12,
    "rifle contacts broke during locomotion");
  assert.ok(armed.hold.barrelDeg < 0.1, "barrel diverged from look while moving");

  await reset();
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.keys.add("KeyW");
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.pressed.add("Space");
  });
  await page.waitForTimeout(180);
  const airborne = await snapshot("airborne", "tololo-locomotion-airborne.png");
  assert.ok(airborne.pos[1] > 0.2 && !airborne.grounded, "jump did not enter airborne state");
  assert.ok(airborne.locomotion.weight < 0.4, "grounded stride persisted in the air");

  await reset();
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.keys.add("KeyW");
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.pressed.add("ControlLeft");
  });
  await page.waitForTimeout(130);
  const dodge = await snapshot("dodge", "tololo-locomotion-dodge.png");
  assert.ok(dodge.dodgeT > 0, "dodge state did not start");
  assert.ok(dodge.locomotion.weight < 0.35, "normal stride persisted through dodge");

  await reset([5, 0, 1]);
  await setCamera([9, 2.2, 2], [5, 1.1, -1]);
  const wall = await move(["KeyW"], 1300, "wallStop", "tololo-locomotion-wall-stop.png");
  assert.ok(wall.pos[2] > -1.2, "controller crossed the cover wall");
  assert.ok(Math.hypot(...wall.velocity) < 0.2, "resolved visual velocity stayed high at the wall");
  assert.ok(wall.locomotion.weight < 0.2, "running-in-place gait persisted at the wall");

  await reset([0, 0, 65], Math.PI);
  const slide = await move(["KeyW", "KeyD"], 900, "wallSlide", "tololo-locomotion-wall-slide.png");
  assert.ok(Math.abs(slide.velocity[0]) > 1 && Math.abs(slide.velocity[0]) > Math.abs(slide.velocity[1]) * 3,
    `wall slide did not use collision-resolved direction: ${JSON.stringify(slide)}`);

  await reset();
  await page.evaluate(() => window.__gflGame.input.keys.add("KeyW"));
  await page.waitForTimeout(450);
  const phaseStep = await page.evaluate(() => {
    const g = window.__gflGame;
    const before = g.sim.pos.clone();
    g.sim.skillCD[1] = 0;
    g.sim.castSkill(1);
    return {
      distance: g.sim.pos.subtract(before).length(),
      visualSpeed: Math.hypot(g.sim.visualVel.x, g.sim.visualVel.z),
    };
  });
  assert.ok(phaseStep.distance > 5, "Phase Step did not move Tololo");
  assert.ok(phaseStep.visualSpeed < 12, "Phase Step teleport produced a locomotion-speed spike");
  report.phaseStep = phaseStep;

  await page.evaluate(() => {
    window.__gflGame.input.keys.clear();
    window.__gflGame.restart();
  });
  await page.waitForFunction(() => window.__gflGame.sim.externalStatus === "pmx", null, { timeout: 120_000 });
  const restarted = await snapshot("restart", "tololo-locomotion-restart.png");
  assert.ok(restarted.locomotion.weight < 0.05 && restarted.locomotion.forward === 0,
    "same-character restart retained locomotion state");

  await page.evaluate(() => {
    const g = window.__gflGame;
    g.startRun("qiongjiu");
    g.startRun("tololo");
  });
  await page.waitForFunction(() => window.__gflGame.sim.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(300);
  const reused = await snapshot("pooledReuse", null);
  assert.ok(reused.locomotion.weight < 0.05 && reused.locomotion.forward === 0,
    "pooled Tololo rig retained locomotion state");

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(path.join(artifactDir, "tololo-locomotion-review.webm"));
  await context.close();
  await browser.close();
  await fs.rm(videoDir, { recursive: true, force: true });
}
