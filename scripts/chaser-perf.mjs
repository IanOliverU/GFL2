import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const tag = process.env.PERF_TAG ?? "after";
const articulated = tag !== "before";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const sourceHash = createHash("sha256")
  .update(await fs.readFile("src/chaser.ts"))
  .update(await fs.readFile("src/sim.ts"))
  .digest("hex").slice(0, 12);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/WebGPU|fatal error occurred/i.test(m.text())) errors.push(`console: ${m.text()}`);
});

async function sample(label, ms = 3000) {
  return page.evaluate(({ label, ms }) => new Promise((resolve) => {
    const game = window.__gflGame;
    const times = [];
    let last = performance.now();
    const start = last;
    const drawStart = game.engine._drawCalls?.current ?? null;
    let frames = 0;
    const tick = (now) => {
      if (frames > 0) times.push(now - last);
      frames++;
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else {
        times.sort((a, b) => a - b);
        const pick = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0;
        resolve({
          label,
          fps: frames * 1000 / (now - start),
          frameMsAvg: times.reduce((a, b) => a + b, 0) / Math.max(1, times.length),
          frameMsP95: pick(0.95),
          activeMeshes: game.scene.getActiveMeshes().length,
          activeIndices: game.scene.getActiveIndices(),
          totalMeshes: game.scene.meshes.length,
          drawCallsPerFrame: drawStart === null ? null : ((game.engine._drawCalls?.current ?? drawStart) - drawStart) / frames,
        });
      }
    };
    requestAnimationFrame(tick);
  }), { label, ms });
}

try {
  await page.goto(`${base}/?dev=1&autostart=1&char=qiongjiu&god=1&nolock=1&renderer=webgl`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", undefined, { timeout: 120_000 });
  const setup = await page.evaluate((articulated) => {
    const game = window.__gflGame;
    game.startRun("qiongjiu");
    game.sim.debugChaserVisuals = articulated;
    game.sim.setGameplaySeed(0x2468ace0);
    game.sim.godmode = true;
    game.sim.spawnT = 100000;
    game.sim.pos.set(0, 0, 12);
    game.sim.yaw = 0;
    const positions = [
      [-8, -10], [-4, -10], [0, -10], [4, -10], [8, -10],
      [-6, -6], [-2, -6], [2, -6], [6, -6],
      [-4, -2], [0, -2], [4, -2],
    ];
    const enemies = positions.map(([x, z]) => {
      const p = game.sim.pos.clone();
      p.set(x, 0, z);
      return game.sim.spawnEnemy("chaser", p, false);
    });
    for (const enemy of enemies) if (enemy) { enemy.speed = 0; enemy.hp = enemy.maxHp = 100000; }
    return {
      enemyCount: game.sim.enemies.length,
      articulatedCount: game.sim.enemies.filter((enemy) => !!enemy.ch).length,
      renderer: game.renderer,
    };
  }, articulated);
  assert.equal(setup.enemyCount, 12);
  assert.equal(setup.articulatedCount, articulated ? 12 : 0, "performance scenario visual mode is wrong");
  await page.waitForTimeout(1000);
  const idle = await sample("12 stationary Chasers");
  await page.evaluate(() => {
    const game = window.__gflGame;
    for (const enemy of game.sim.enemies) enemy.speed = 4;
  });
  const moving = await sample("12 moving Chasers");
  const result = {
    tag,
    revision,
    sourceHash,
    articulated,
    conditions: "headless Chrome 1280x720, forced WebGL2, SwiftShader, same build/environment",
    ...setup,
    idle,
    moving,
    errors,
  };
  const output = path.resolve(`artifacts/chaser-perf-${tag}.json`);
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
