// Tololo firing-origin investigation (local review only, unapproved).
// Isolates primary fire (fresh rank-1 build, enemies cleared, spawns held,
// no skills) and checks every shot: logged muzzle vs muzzlePos() vs Muzzle
// anchor world vs tracer start, across stationary/turn/move/aim/cover.
// Usage: node scripts/tololo-fire-check.mjs
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
const v3 = (o) => [o.x ?? o._x, o.y ?? o._y, o.z ?? o._z];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const browser = await chromium.launch({
  executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const report = { status: "ready for visual review (NOT firing verified)" };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(page);
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(1200);

  // Isolate: clear hostiles/projectiles, hold spawns, fresh rank-1 build.
  // Mass kills queue level-ups (which pause into a modal), so drain those and
  // force a clean playing state — harness-only surgery, game code untouched.
  await page.evaluate(() => {
    const g = window.__gflGame;
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 99999, { isProc: true });
    for (const s of g.sim.eshots) { s.active = false; s.mesh.isVisible = false; }
    g.sim.spawnT = 99999;
    g.sim.build.queuedLevels = 0;
    g.sim.build.xp = 0;
    g.ui.closeModal();
    g.state = "playing";
  });
  await page.waitForTimeout(400);

  async function shotState() {
    return page.evaluate(() => {
      const g = window.__gflGame;
      const s = g.sim;
      const log = s.shotLog[s.shotLog.length - 1] ?? null;
      const num = (o) => (o === null || o === undefined ? null : [o.x ?? o._x, o.y ?? o._y, o.z ?? o._z]);
      const mp = s.muzzlePos();
      const rig = s.externalRoot?.metadata?.tololoRig ?? null;
      return {
        shots: s.shotLog.length,
        step: s.stepCount, state: g.state,
        log: log ? {
          id: log.id, step: log.step, frameMs: Math.round(log.frameMs % 100000),
          muzzle: num(log.muzzle), aim: num(log.aim), dir: num(log.dir),
          tracers: log.tracers, tracerA: num(log.tracerA), tracerB: num(log.tracerB),
        } : null,
        muzzleNow: num(mp),
        holdMuzzle: window.__tololoHold.measure()?.muzzleWorld ?? null,
        fps: Math.round(g.fps),
      };
    });
  }
  function checkShotConsistency(tag, st) {
    assert.ok(st.log, `${tag}: no shot logged`);
    assert.ok(st.log.tracers >= 1, `${tag}: shot ${st.log.id} spawned no tracer`);
    const dSpawn = dist(st.log.tracerA, st.log.muzzle);
    assert.ok(dSpawn < 0.05, `${tag}: tracer start off spawn by ${dSpawn.toFixed(3)}`);
    const dLive = dist(st.muzzleNow, st.log.muzzle);
    report[tag] = { id: st.log.id, step: st.log.step, tracerStartVsSpawn: +dSpawn.toFixed(3), muzzleNowVsSpawn: +dLive.toFixed(3) };
    if (st.holdMuzzle) {
      const dHold = dist([st.holdMuzzle.x ?? st.holdMuzzle._x, st.holdMuzzle.y ?? st.holdMuzzle._y, st.holdMuzzle.z ?? st.holdMuzzle._z], st.log.muzzle);
      assert.ok(dHold < 0.08, `${tag}: Muzzle anchor off spawn by ${dHold.toFixed(3)}`);
      report[tag].anchorVsSpawn = +dHold.toFixed(3);
    }
  }
  // Orbs vacuumed while moving queue level-ups (modal pauses the sim), so
  // drain orbs/levels and force playing before every firing window.
  async function ensurePlaying() {
    await page.evaluate(() => {
      const g = window.__gflGame;
      for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
      g.sim.build.queuedLevels = 0;
      g.sim.build.xp = 0;
      g.ui.closeModal();
      if (g.state !== "playing") g.state = "playing";
    });
  }
  async function lastShotId() {
    return page.evaluate(() => {
      const log = window.__gflGame.sim.shotLog;
      return log.length ? log[log.length - 1].id : 0;
    });
  }
  // Detect new shots on a 5ms poll: the default rAF poll is slower than the
  // 0.07s tracer life, so slow detection freezes nothing and the firing
  // frame shows no beam.
  const fastPoll = { timeout: 12000, polling: 5 };
  async function singleShot() {
    await ensurePlaying();
    const before = await lastShotId();
    await page.evaluate(() => { window.__gflGame.input.mouseDown = true; });
    await page.waitForFunction((n) => {
      const log = window.__gflGame.sim.shotLog;
      return log.length && log[log.length - 1].id > n;
    }, before, fastPoll);
    await page.evaluate(() => {
      window.__gflGame.input.mouseDown = false;
      // Freeze live tracers so the firing frame can be captured deterministically
      // (natural life is 0.07s; beams are instant full-length spans, not travelers).
      for (const t of window.__gflGame.sim.tracers) if (t.active) t.life = 30;
    });
    await page.waitForTimeout(150);
    return shotState();
  }

  // 1. Stationary primary shot + firing frame.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.pos.set(10, 0, 10); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.updateCamera(1, false);
    g.__v3 = (x, y, z) => new g.sim.pos.constructor(x, y, z);
    g.debugCamera = { pos: g.__v3(11.8, 1.9, 8.2), target: g.__v3(10, 1.4, 10) };
  });
  await page.waitForTimeout(400);
  checkShotConsistency("stationary", await singleShot());
  await page.screenshot({ path: path.resolve("artifacts/tololo-fire-frame.png") });
  report["tololo-fire-frame.png"] = "artifacts/tololo-fire-frame.png";
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.resolve("artifacts/tololo-fire-plus1.png") });
  report["tololo-fire-plus1.png"] = "artifacts/tololo-fire-plus1.png";

  // 2. Turning while firing.
  await ensurePlaying();
  await page.evaluate(() => {
    const g = window.__gflGame;
    for (const t of g.sim.tracers) { t.active = false; t.mesh.isVisible = false; }
  });
  {
    const before = await lastShotId();
    await page.evaluate(() => { window.__gflGame.input.mouseDown = true; });
    for (let i = 1; i <= 5; i++) {
      await page.evaluate((y) => { window.__gflGame.sim.yaw = y; }, i * 0.1);
      await page.waitForTimeout(150);
    }
    await page.evaluate(() => { window.__gflGame.input.mouseDown = false; });
    const st = await shotState();
    const fired = (st.log ? st.log.id : before) - before;
    assert.ok(fired > 1, "turning burst fired no shots");
    const logs = await page.evaluate(() => window.__gflGame.sim.shotLog.slice(-4).map((l) => ({
      id: l.id,
      d: (() => {
        const a = [l.tracerA.x ?? l.tracerA._x, l.tracerA.y ?? l.tracerA._y, l.tracerA.z ?? l.tracerA._z];
        const m = [l.muzzle.x ?? l.muzzle._x, l.muzzle.y ?? l.muzzle._y, l.muzzle.z ?? l.muzzle._z];
        return Math.hypot(a[0] - m[0], a[1] - m[1], a[2] - m[2]);
      })(),
    })));
    for (const l of logs) assert.ok(l.d < 0.05, `turning shot ${l.id} tracer off spawn by ${l.d}`);
    report.turning = { shots: fired, perShotOk: true };
  }

  // 3. Moving while firing.
  {
    await ensurePlaying();
    await page.evaluate(() => {
      const g = window.__gflGame;
      g.sim.yaw = 0;
      g.input.keys.add("KeyW");
      g.input.mouseDown = true;
    });
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => {
      const g = window.__gflGame;
      g.input.keys.delete("KeyW");
      g.input.mouseDown = false;
      const l = g.sim.shotLog[g.sim.shotLog.length - 1];
      const a = [l.tracerA.x ?? l.tracerA._x, l.tracerA.y ?? l.tracerA._y, l.tracerA.z ?? l.tracerA._z];
      const m = [l.muzzle.x ?? l.muzzle._x, l.muzzle.y ?? l.muzzle._y, l.muzzle.z ?? l.muzzle._z];
      return { shots: g.sim.shotLog.length, z: +g.sim.pos.z.toFixed(2), d: Math.hypot(a[0] - m[0], a[1] - m[1], a[2] - m[2]) };
    });
    assert.ok(st.z < 10, "player did not move");
    assert.ok(st.d < 0.05, `moving shot tracer off spawn by ${st.d}`);
    report.moving = { movedToZ: st.z, tracerVsSpawn: +st.d.toFixed(3) };
  }

  // 4. Aim up / down single shots.
  for (const [name, pitch] of [["aimup", 0.45], ["aimdown", -0.5]]) {
    await ensurePlaying();
    await page.evaluate((p) => {
      const g = window.__gflGame;
      g.sim.pos.set(10, 0, 10); g.sim.yaw = 0; g.sim.pitch = p;
      g.sim.updateCamera(1, false);
      for (const t of g.sim.tracers) { t.active = false; t.mesh.isVisible = false; }
    }, pitch);
    await page.waitForTimeout(400);
    checkShotConsistency(name, await singleShot());
    if (name === "aimup") {
      await page.screenshot({ path: path.resolve("artifacts/tololo-fire-aimup.png") });
      report["tololo-fire-aimup.png"] = "artifacts/tololo-fire-aimup.png";
    }
  }
  await page.evaluate(() => { window.__gflGame.sim.pitch = -0.08; });

  // 5. Cover: solid wall segment bN-L (x -14..-2.5, z 23.5..24.5; x=0 is a
  // door gap, so a center shot passing through is CORRECT, not a bug).
  // Near (muzzle outside) the tracer must stop at the face; with the muzzle
  // pushed inside the volume the slab raycast returns 0, so no shot passes.
  await ensurePlaying();
  async function coverShot(z) {
    await ensurePlaying();
    const before = await lastShotId();
    await page.evaluate((zz) => {
      const g = window.__gflGame;
      for (const t of g.sim.tracers) { t.active = false; t.mesh.isVisible = false; }
      g.debugCamera = null;
      g.sim.pos.set(-8.25, 0, zz); g.sim.yaw = Math.PI; g.sim.pitch = 0;
      g.sim.updateCamera(1, false);
      g.input.mouseDown = true;
    }, z);
    await page.waitForFunction((n) => {
      const log = window.__gflGame.sim.shotLog;
      return log.length && log[log.length - 1].id > n;
    }, before, fastPoll);
    return page.evaluate(() => {
      const g = window.__gflGame;
      g.input.mouseDown = false;
      for (const t of g.sim.tracers) if (t.active) t.life = 30;
      const l = g.sim.shotLog[g.sim.shotLog.length - 1];
      const num = (o) => [o.x ?? o._x, o.y ?? o._y, o.z ?? o._z];
      const a = num(l.tracerA), b = num(l.tracerB);
      return {
        tracerLen: +Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]).toFixed(3),
        muzzleZ: +num(l.muzzle)[2].toFixed(2),
        kills: g.sim.kills,
      };
    });
  }
  const killsBefore = await page.evaluate(() => window.__gflGame.sim.kills);
  const coverNear = await coverShot(22.0);
  assert.ok(coverNear.tracerLen < 1.5, `near-wall shot flew ${coverNear.tracerLen}`);
  await page.screenshot({ path: path.resolve("artifacts/tololo-fire-cover.png") });
  report["tololo-fire-cover.png"] = "artifacts/tololo-fire-cover.png";
  const coverIn = await coverShot(22.8);
  assert.ok(coverIn.tracerLen < 0.5, `in-wall muzzle shot flew ${coverIn.tracerLen}`);
  const killsAfter = await page.evaluate(() => window.__gflGame.sim.kills);
  assert.equal(killsAfter, killsBefore, "cover shots damaged something through the wall");
  report.cover = { near: coverNear, inside: coverIn };

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
