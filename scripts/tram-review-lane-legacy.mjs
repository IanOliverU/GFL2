// SUPERSEDED by the §14 connected circuit (scripts/tram-circuit-check.mjs):
// this harness targets the retired flat dirt-apron lane (relay 12,52, low
// rails, bounds 60) and FAILS on the circuit world by design (north-fence
// expectation). Preserved for the §13 evaluation record; run the circuit
// check instead: GAME_URL=http://localhost:5173 node scripts/tram-circuit-check.mjs
// Tram-station suitability review (dev-only local evaluation, never shipped).
// Loads ?dev=1&scene=tram-review (isolated flat world + unmodified station GLB),
// verifies Tololo/gameplay reuse, captures the review stills + uncut walkthrough,
// measures load/perf, runs a bounded Chaser encounter, and compares against the
// Green Zone under equivalent conditions.
// Usage: GAME_URL=http://localhost:5173 node scripts/tram-review.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactDir = path.resolve("artifacts");
const videoDir = path.join(artifactDir, "tram-video-temp");
await fs.mkdir(videoDir, { recursive: true });

const errors = [];
// GPU_MODE=hardware uses the real GPU (D3D11 ANGLE); default "software" keeps
// the repeatable SwiftShader configuration for environment-independent runs.
const gpuMode = process.env.GPU_MODE ?? "software";
const launchArgs = gpuMode === "hardware"
  ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"]
  : ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: launchArgs,
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
  status: "tram review evidence (NOT suitability accepted)",
  conditions: `headless Chrome 1280x720, forced WebGL2, ${gpuMode === "hardware" ? "real GPU (D3D11 ANGLE)" : "SwiftShader"}`,
  gpuMode,
  launchUrl: "/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl",
  captures: [],
};

// Walk with KeyW for a fixed amount of SIMULATION time (frame-rate independent).
async function simWalk(pg, seconds) {
  const start = await pg.evaluate(() => {
    window.__gflGame.input.keys.add("KeyW");
    return window.__gflGame.sim.runTime;
  });
  await pg.waitForFunction(({ start, seconds }) => window.__gflGame.sim.runTime >= start + seconds,
    { start, seconds }, { timeout: 60_000 });
  await pg.evaluate(() => window.__gflGame.input.keys.clear());
}

async function shot(name, view) {
  if (view === "play") await page.evaluate(() => window.__tramReview.play());
  else await page.evaluate((v) => window.__tramReview.view(v), view);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(artifactDir, name) });
  report.captures.push(name);
}

async function sample(pg, label, ms = 3000) {
  return pg.evaluate(({ label, ms }) => new Promise((resolve) => {
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
          drawCallsPerFrame: drawStart === null ? null
            : ((game.engine._drawCalls?.current ?? drawStart) - drawStart) / frames,
        });
      }
    };
    requestAnimationFrame(tick);
  }), { label, ms });
}

try {
  const t0 = Date.now();
  await page.goto(`${base}${report.launchUrl}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", null, { timeout: 60_000 });
  // Station transfer + parse of the 85MB unmodified GLB; generous headless budget.
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240_000 });
  report.loadWaitMs = Date.now() - t0;
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(800);

  const setup = await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.godmode = true;
    g.sim.spawnT = 99999;
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 99999, { isProc: true });
    for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    g.state = "playing";
    const st = window.__tramReview.status();
    const glc = document.createElement("canvas").getContext("webgl2");
    const dbg = glc.getExtension("WEBGL_debug_renderer_info");
    return {
      webglRenderer: dbg ? glc.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
      tramPhase: st.phase,
      tramError: st.error,
      stats: window.__tramReview.stats(),
      timings: window.__tramReview.timings(),
      renderer: g.renderer,
      sceneMeshes: g.scene.meshes.length,
      greenZoneAbsent: !g.scene.getMeshByName("walkway") && !g.scene.getMeshByName("relayTower"),
    };
  });
  Object.assign(report, setup);
  assert.equal(setup.tramPhase, "ready", `station failed to load: ${setup.tramError}`);
  assert.ok(setup.greenZoneAbsent, "Green Zone meshes present in review mode (environments must not mix)");
  // Let setup damage numbers fade so the overview records the station, not harness spam.
  await page.waitForTimeout(2500);

  await shot("tram-overview.png", "overview");
  await shot("tram-scale-tololo.png", "scale");

  // Playable third-person: walk the lane with live Tololo locomotion.
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(15, 0, 58); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    g.sim.updateCamera(1, false);
    g.input.keys.add("KeyW");
  });
  await page.waitForTimeout(1500);
  const walk = await page.evaluate(() => ({
    z: +window.__gflGame.sim.pos.z.toFixed(2),
    speed: +Math.hypot(window.__gflGame.sim.visualVel.x, window.__gflGame.sim.visualVel.z).toFixed(2),
    gait: window.__gflGame.sim.externalRoot?.metadata?.tololoRig?.locomotion?.weight ?? null,
  }));
  report.walk = walk;
  assert.ok(walk.z < 58, "Tololo did not walk the review lane");
  await page.screenshot({ path: path.join(artifactDir, "tram-third-person.png") });
  report.captures.push("tram-third-person.png");

  // RMB aim + firing while stationed in the lane.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.keys.clear();
    g.input.rmbDown = true;
    g.input.mouseDown = true;
  });
  await page.waitForTimeout(900);
  const aimFire = await page.evaluate(() => ({
    aiming: window.__gflGame.sim.aiming,
    ammo: window.__gflGame.sim.ammo,
    hold: window.__tololoHold.measure(),
  }));
  await page.screenshot({ path: path.join(artifactDir, "tram-aim-fire.png") });
  report.captures.push("tram-aim-fire.png");
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.rmbDown = false;
    g.input.mouseDown = false;
  });
  report.aimFire = { aiming: aimFire.aiming, ammo: aimFire.ammo };
  assert.equal(aimFire.aiming, true, "RMB aim did not engage in review mode");

  await shot("tram-passage.png", "passage");

  // Relay location: step into the ring, press F, charge must start.
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(12, 0, 54); g.sim.yaw = Math.PI; g.sim.pitch = -0.08;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    g.sim.updateCamera(1, false);
    g.input.pressed.add("KeyF");
  });
  await page.waitForTimeout(800);
  const relay = await page.evaluate(() => ({
    active: window.__gflGame.sim.relayActive,
    dist: +Math.hypot(window.__gflGame.sim.pos.x - 12, window.__gflGame.sim.pos.z - 52).toFixed(2),
  }));
  report.relay = relay;
  assert.equal(relay.active, true, "relay did not activate in the station area");
  await shot("tram-relay.png", "relay");

  // Cache route: F at the kiosk cache must loot it.
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(6, 0, 55.5); g.sim.yaw = Math.PI / 2;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    g.sim.updateCamera(1, false);
    g.input.pressed.add("KeyF");
  });
  await page.waitForTimeout(800);
  const cache = await page.evaluate(() => ({
    taken: window.__gflGame.sim.world.caches.map((c) => c.taken),
    caches: window.__gflGame.sim.world.caches.length,
  }));
  report.cache = cache;
  assert.equal(cache.caches, 3, "station area must expose 3 caches");
  assert.equal(cache.taken[0], true, "kiosk cache could not be reached/looted");

  // Boundary: north lane stop must hold; kiosk fronts must hold.
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(15, 0, 50); g.sim.yaw = 0;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
  });
  await simWalk(page, 1.2);
  const boundN = await page.evaluate(() => +window.__gflGame.sim.pos.z.toFixed(2));
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.pos.set(12, 0, 53); g.sim.yaw = Math.PI / 2;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
  });
  await simWalk(page, 1.2);
  const boundW = await page.evaluate(() => +window.__gflGame.sim.pos.x.toFixed(2));
  report.boundary = { northZ: boundN, kioskX: boundW };
  assert.ok(boundN > 43.5, `north lane stop did not hold: z=${boundN}`);
  assert.ok(boundW > 8.0, `kiosk fronts did not hold: x=${boundW}`);

  // Crowded fight: 8 animated enemies across the in-area spawn points.
  // (The relay test above legitimately triggered defense waves, so clear to a
  // deterministic slate first and park the relay; activation is already proven.)
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.relayActive = false;
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 99999, { isProc: true });
    for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(15, 0, 58); g.sim.yaw = 0;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    const V = g.sim.pos.constructor;
    const spots = [[11, 54], [19, 54], [15, 48], [8, 48], [22, 60], [11, 52], [19, 52], [15, 50]];
    const kinds = ["chaser", "chaser", "runner", "chaser", "runner", "chaser", "chaser", "runner"];
    spots.forEach(([x, z], i) => {
      const e = g.sim.spawnEnemy(kinds[i], new V(x, 0, z), false);
      if (e) { e.hp = e.maxHp = 100000; }
    });
    g.input.mouseDown = true;
  });
  await page.waitForTimeout(2500);
  const combat = await page.evaluate(() => ({
    enemies: window.__gflGame.sim.enemies.length,
    articulated: window.__gflGame.sim.enemies.filter((e) => !!e.ch).length,
  }));
  report.combat = combat;
  assert.equal(combat.enemies, 8, "crowded fight did not stage 8 enemies");
  await page.evaluate(() => window.__tramReview.view("combat"));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(artifactDir, "tram-fight.png") });
  report.captures.push("tram-fight.png");
  const combatSample = await sample(page, "tram 8-enemy fight");
  await page.evaluate(() => { window.__gflGame.input.mouseDown = false; });

  // Restart must not duplicate the station or leak scene resources.
  // settle(): clear hostiles, then wait until the scene mesh count is stable
  // (death cleanup disposes on a 0.75 s sim-time fuse).
  // settle(): clear hostiles, then wait 3 s of SIMULATION time so the 0.75 s
  // death-cleanup fuse drains at any frame rate (wall-clock waits are
  // meaningless on SwiftShader's capped catch-up steps).
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.mouseDown = false;
    // 1e9: fight enemies carry inflated HP pools and must actually die.
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 1e9, { isProc: true });
    for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.sim.build.xp = 0;
    g.ui.closeModal();
    if (g.state !== "playing") g.state = "playing";
  });
  const simT0 = await page.evaluate(() => window.__gflGame.sim.runTime);
  await page.waitForFunction((t0) => window.__gflGame.sim.runTime >= t0 + 3, simT0, { timeout: 180_000 });
  const settledMeshes = await page.evaluate(() => window.__gflGame.scene.meshes.length);
  assert.ok(settledMeshes > 0, "scene mesh count unreadable after settle");
  const restart = await page.evaluate(() => ({ meshesBefore: window.__gflGame.scene.meshes.length }));
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.restart();
    g.sim.godmode = true;
    g.sim.spawnT = 99999;
  });
  await page.waitForTimeout(1500);
  Object.assign(restart, await page.evaluate(() => ({
    meshesAfter: window.__gflGame.scene.meshes.length,
    cachesReset: window.__gflGame.sim.world.caches.every((c) => !c.taken),
    relayReset: !window.__gflGame.sim.relayActive,
    tramStillLoaded: window.__tramReview.status().phase,
  })));
  report.restart = restart;
  assert.equal(restart.meshesAfter, restart.meshesBefore, "restart duplicated or leaked station resources");
  assert.equal(restart.tramStillLoaded, "ready", "station did not survive restart");

  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(15, 0, 58); g.sim.yaw = 0;
  });
  const idleSample = await sample(page, "tram idle lane");
  await page.evaluate(() => window.__gflGame.input.keys.add("KeyW"));
  const traversalSample = await sample(page, "tram traversal");
  await page.evaluate(() => window.__gflGame.input.keys.clear());
  report.perf = { idle: idleSample, traversal: traversalSample, combat: combatSample };

  // Close the review page (and finalize its video) BEFORE the Green Zone
  // baseline so the two heavy scenes never render concurrently.
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(path.join(artifactDir, "tram-review-walkthrough.webm"));
  report.captures.push("tram-review-walkthrough.webm");

  // Equivalent Green Zone baseline (same build, same renderer, same harness).
  const gz = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  gz.on("pageerror", (e) => errors.push(`gz pageerror: ${e.message}`));
  try {
    await gz.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await gz.waitForFunction(() => window.__gflGame?.state === "playing", null, { timeout: 60_000 });
    await gz.waitForTimeout(1000);
    report.gzBaseline = await sample(gz, "green zone idle spawn");
  } finally {
    await gz.close();
  }

  assert.deepEqual(errors, [], errors.join("\n"));
  await fs.writeFile(path.join(artifactDir, "tram-review-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
  await fs.rm(videoDir, { recursive: true, force: true });
}
