// Same-build baseline/locomotion performance comparison.
// Usage: node scripts/tololo-perf.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const sourceHash = createHash("sha256")
  .update(await fs.readFile("src/tololo-visual.ts"))
  .update(await fs.readFile("src/sim.ts"))
  .update(await fs.readFile("src/game.ts"))
  .digest("hex").slice(0, 12);
const errors = [];

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() !== "error") return;
  if (/WebGPU creation\/initialization|WebGPU is not supported/.test(message.text())) return;
  errors.push(`console: ${message.text()}`);
});

async function sample(label, enabled, moving, ms = 3000) {
  await page.evaluate(({ enabled, moving }) => {
    const g = window.__gflGame;
    window.__tololoHold.locomotionEnabled(enabled);
    g.sim.pos.set(4, 0, 12);
    g.sim.vel.set(0, 0, 0);
    g.sim.visualVel.set(0, 0, 0);
    g.sim.yaw = 0;
    g.input.keys.clear();
    g.sim.__perfMoving = moving;
    const locomotion = g.sim.externalRoot?.metadata?.tololoRig?.locomotion;
    if (locomotion) {
      locomotion.forward = 0;
      locomotion.right = 0;
      locomotion.weight = 0;
      locomotion.phase = 0;
    }
  }, { enabled, moving });
  await page.waitForTimeout(500);
  return page.evaluate(({ label, ms }) => new Promise((resolve) => {
    const game = window.__gflGame;
    const frameTimes = [];
    let last = performance.now();
    const started = last;
    const drawStart = game.engine._drawCalls?.current ?? null;
    let frames = 0;
    const tick = (now) => {
      if (frames > 0) frameTimes.push(now - last);
      frames++;
      last = now;
      if (now - started < ms) requestAnimationFrame(tick);
      else {
        frameTimes.sort((a, b) => a - b);
        const p95 = frameTimes[Math.min(frameTimes.length - 1, Math.floor(frameTimes.length * 0.95))] ?? 0;
        resolve({
          label,
          fps: frames * 1000 / (now - started),
          frameMsAvg: frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length),
          frameMsP95: p95,
          activeMeshes: game.scene.getActiveMeshes().length,
          activeIndices: game.scene.getActiveIndices(),
          totalMeshes: game.scene.meshes.length,
          drawCallsPerFrame: drawStart === null ? null
            : ((game.engine._drawCalls?.current ?? drawStart) - drawStart) / frames,
        });
      }
    };
    requestAnimationFrame(tick);
  }), { label, ms });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function summarize(samples) {
  return {
    fpsMedian: median(samples.map((sample) => sample.fps)),
    frameMsAvgMedian: median(samples.map((sample) => sample.frameMsAvg)),
    frameMsP95Median: median(samples.map((sample) => sample.frameMsP95)),
    activeMeshes: samples[0].activeMeshes,
    activeIndices: samples[0].activeIndices,
    totalMeshes: samples[0].totalMeshes,
    drawCallsPerFrame: samples[0].drawCallsPerFrame,
    samples,
  };
}

async function compare(moving) {
  const baseline = [];
  const locomotion = [];
  for (let round = 0; round < 4; round++) {
    const order = round % 2 === 0 ? [false, true] : [true, false];
    for (const enabled of order) {
      const result = await sample(`${moving ? "moving" : "idle"} ${enabled ? "locomotion" : "baseline"} r${round + 1}`,
        enabled, moving, 4000);
      (enabled ? locomotion : baseline).push(result);
    }
  }
  return { baseline: summarize(baseline), locomotion: summarize(locomotion) };
}

try {
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.godmode = true;
    g.sim.spawnT = 99999;
    g.sim.reverseForward = false;
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 99999, { isProc: true });
    for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    g.state = "playing";
    // Isolate presentation cost at one fixed camera/world pose. The normal
    // controller path is covered by the locomotion and browser smoke checks.
    g.sim.__perfMoving = false;
    g.sim.update = function(dt) {
      this.runTime += dt;
      this.visualVel.set(0, 0, this.__perfMoving ? -7.2 : 0);
    };
  });

  await sample("warmup", false, false, 2000);
  const idle = await compare(false);
  const moving = await compare(true);
  await page.evaluate(() => {
    window.__gflGame.input.keys.clear();
    window.__tololoHold.locomotionEnabled(true);
  });
  const result = {
    revision,
    sourceHash,
    conditions: "same build/page/model/pose; fixed camera; headless Chrome 1280x720; WebGL2 SwiftShader; alternating A/B order; median of four 4-second rAF samples",
    renderer: await page.evaluate(() => window.__gflGame.renderer),
    idle,
    moving,
    errors,
  };
  result.idle.frameTimeDelta = idle.locomotion.frameMsAvgMedian / idle.baseline.frameMsAvgMedian - 1;
  result.moving.frameTimeDelta = moving.locomotion.frameMsAvgMedian / moving.baseline.frameMsAvgMedian - 1;
  await fs.writeFile(path.resolve("artifacts/tololo-perf.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.ok(result.idle.frameTimeDelta < 0.1, `idle frame-time regression ${(result.idle.frameTimeDelta * 100).toFixed(1)}%`);
  assert.ok(result.moving.frameTimeDelta < 0.1, `moving frame-time regression ${(result.moving.frameTimeDelta * 100).toFixed(1)}%`);
  assert.equal(idle.baseline.activeMeshes, idle.locomotion.activeMeshes, "idle active mesh count changed");
  assert.equal(moving.baseline.activeMeshes, moving.locomotion.activeMeshes, "moving active mesh count changed");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
