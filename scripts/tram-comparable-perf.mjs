import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const gpuMode = process.env.GPU_MODE ?? "software";
const sampleMs = Number(process.env.SAMPLE_MS ?? 5000);
const order = (process.env.ORDER ?? "tram,gz,gz,tram").split(",");
const args = gpuMode === "hardware"
  ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"]
  : ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ executablePath: exe, headless: true, args });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const errors = [];

async function hashFile(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex").slice(0, 16);
}

async function sample(page, label) {
  return page.evaluate(({ label, sampleMs }) => new Promise((resolve) => {
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
      if (now - start < sampleMs) requestAnimationFrame(tick);
      else {
        times.sort((a, b) => a - b);
        const percentile = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0;
        resolve({
          label,
          frames,
          fps: frames * 1000 / (now - start),
          frameMsAvg: times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length),
          frameMsP95: percentile(0.95),
          activeMeshes: game.scene.getActiveMeshes().length,
          activeIndices: game.scene.getActiveIndices(),
          totalMeshes: game.scene.meshes.length,
          drawCallsPerFrame: drawStart === null ? null
            : ((game.engine._drawCalls?.current ?? drawStart) - drawStart) / frames,
        });
      }
    };
    requestAnimationFrame(tick);
  }), { label, sampleMs });
}

async function runScene(scene, run) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${scene}-${run} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/WebGPU creation\/initialization|WebGPU is not supported/.test(message.text())) return;
    errors.push(`${scene}-${run} console: ${message.text()}`);
  });
  const sceneQuery = scene === "tram" ? "&scene=tram-review" : "";
  await page.goto(`${base}/?dev=1&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl${sceneQuery}`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", null, { timeout: 60000 });
  if (scene === "tram") {
    await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });
  }
  await page.waitForFunction(() => window.__gflGame.sim.externalStatus === "pmx", null, { timeout: 120000 });
  const setup = await page.evaluate((scene) => {
    const g = window.__gflGame;
    if (scene === "tram") window.__tramReview.play();
    g.sim.godmode = true;
    g.sim.spawnT = 99999;
    for (const enemy of [...g.sim.enemies]) g.sim.damageEnemy(enemy, 999999, { isProc: true });
    for (const orb of g.sim.orbs) { orb.active = false; orb.mesh.isVisible = false; }
    for (const cache of g.sim.world.caches) {
      cache.mesh.isVisible = false;
      if (cache.glow) cache.glow.isVisible = false;
    }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    g.state = "playing";
    const relay = g.sim.world.relayPos;
    const x = relay.x;
    const z = relay.z + 3;
    const y = g.sim.world.groundHeightAt ? g.sim.world.groundHeightAt(x, z) : 0;
    g.sim.pos.set(x, y, z);
    g.sim.vel.set(0, 0, 0);
    g.sim.yaw = 0;
    g.sim.pitch = -0.08;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    g.sim.updateCamera(1, false);
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return { player: { x, y, z, yaw: 0 }, relay: { x: relay.x, y: relay.y, z: relay.z },
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unavailable" };
  }, scene);
  // Identical warm-up after both PMX and environment readiness; dead meshes and
  // one-shot effects from cleanup have time to retire before measurement.
  await page.waitForTimeout(4000);
  const measurement = await sample(page, `${scene} relay-relative idle run ${run}`);
  await page.close();
  return { scene, run, setup, measurement };
}

const runs = [];
try {
  const counts = { tram: 0, gz: 0 };
  for (const scene of order) {
    if (scene !== "tram" && scene !== "gz") throw new Error(`unknown scene in ORDER: ${scene}`);
    runs.push(await runScene(scene, ++counts[scene]));
  }
} finally {
  await context.close();
  await browser.close();
}

function aggregate(scene) {
  const values = runs.filter((run) => run.scene === scene).map((run) => run.measurement);
  const mean = (key) => values.reduce((sum, value) => sum + value[key], 0) / Math.max(1, values.length);
  return { samples: values.length, fps: mean("fps"), frameMsAvg: mean("frameMsAvg"),
    frameMsP95: mean("frameMsP95"), activeMeshes: mean("activeMeshes"),
    activeIndices: mean("activeIndices"), totalMeshes: mean("totalMeshes"),
    drawCallsPerFrame: mean("drawCallsPerFrame") };
}

const tram = aggregate("tram");
const greenZone = aggregate("gz");
const report = {
  status: "comparable measurement, not an asset suitability verdict",
  conditions: `headless Chrome 1280x720, forced WebGL2, ${gpuMode}, zero enemies/caches, Tololo PMX, relay+3m gameplay camera, 4s equal warm-up`,
  gpuMode,
  sampleMs,
  order,
  baseRevision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  sourceHashes: {
    tramReview: await hashFile("src/tram-review.ts"),
    greenZone: await hashFile("src/greenzone.ts"),
    game: await hashFile("src/game.ts"),
    sim: await hashFile("src/sim.ts"),
  },
  aggregate: { tram, greenZone, ratios: {
    drawCalls: tram.drawCallsPerFrame / greenZone.drawCallsPerFrame,
    activeMeshes: tram.activeMeshes / greenZone.activeMeshes,
    activeIndices: tram.activeIndices / greenZone.activeIndices,
    frameMs: tram.frameMsAvg / greenZone.frameMsAvg,
  } },
  runs,
  errors,
};
await fs.writeFile(path.join("artifacts", `tram-comparable-perf-${gpuMode}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
