// Tram-station connected circuit check (dev-only local evaluation).
// Text-only assertions + saved captures (never reopened here): load, ground
// heights, ramp climbs, platform traverse, kiosk passage, relay/caches, fence
// containment (walk/jump/dodge/Phase Step), boss/relay/victory/restart/loop,
// perf samples, uncut walkthrough video.
// Usage: GAME_URL=http://localhost:5173 GPU_MODE=software node scripts/tram-circuit-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactDir = path.resolve("artifacts");
const videoDir = path.join(artifactDir, "tram-circuit-video-temp");
await fs.mkdir(videoDir, { recursive: true });

const errors = [];
const gpuMode = process.env.GPU_MODE ?? "software";
const launchArgs = gpuMode === "hardware"
  ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"]
  : ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ executablePath, headless: true, args: launchArgs });
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
  status: "tram connected circuit evidence (NOT suitability accepted)",
  conditions: `headless Chrome 1280x720, forced WebGL2, ${gpuMode === "hardware" ? "real GPU (D3D11 ANGLE)" : "SwiftShader"}`,
  gpuMode,
  launchUrl: "/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl",
  captures: [],
  checks: {},
};

async function simWalk(seconds) {
  const start = await page.evaluate(() => {
    window.__gflGame.input.keys.add("KeyW");
    return window.__gflGame.sim.runTime;
  });
  await page.waitForFunction(({ start, seconds }) => window.__gflGame.sim.runTime >= start + seconds,
    { start, seconds }, { timeout: 60_000 });
  await page.evaluate(() => window.__gflGame.input.keys.clear());
}

async function place(x, z, yaw) {
  await page.evaluate(({ x, z, yaw }) => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(x, g.sim.world.groundHeightAt(x, z), z);
    g.sim.vel.set(0, 0, 0);
    g.sim.yaw = yaw;
    g.sim.pitch = -0.08;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    g.sim.updateCamera(1, false);
  }, { x, z, yaw });
  await page.waitForTimeout(300);
}

async function state() {
  return page.evaluate(() => ({
    x: +window.__gflGame.sim.pos.x.toFixed(2),
    y: +window.__gflGame.sim.pos.y.toFixed(2),
    z: +window.__gflGame.sim.pos.z.toFixed(2),
    yaw: +window.__gflGame.sim.yaw.toFixed(2),
  }));
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
      relayPos: g.sim.world.relayPos,
      relayRadius: g.sim.world.relayRadius,
      caches: g.sim.world.caches.map((c) => c.pos),
      spawnPoints: g.sim.world.spawnPoints,
      bossSpawn: g.sim.world.bossSpawn,
      groundAt: {
        platform: window.__tramReview.groundAt(6.6, 30),
        rampMid: window.__tramReview.groundAt(5, 40.65),
        apron: window.__tramReview.groundAt(14, 55),
      },
      renderer: g.renderer,
      sceneMeshes: g.scene.meshes.length,
      greenZoneAbsent: !g.scene.getMeshByName("walkway") && !g.scene.getMeshByName("relayTower"),
    };
  });
  Object.assign(report, setup);
  assert.equal(setup.tramPhase, "ready", `station failed to load: ${setup.tramError}`);
  assert.ok(setup.greenZoneAbsent, "Green Zone meshes present in review mode");
  assert.equal(setup.groundAt.platform, 1.45, "platform deck height must be 1.45");
  assert.ok(setup.groundAt.rampMid > 0.4 && setup.groundAt.rampMid < 1.1, `ramp mid height off: ${setup.groundAt.rampMid}`);
  assert.equal(setup.groundAt.apron, 0, "apron must be grade 0");
  report.checks.groundHeights = setup.groundAt;
  await page.waitForTimeout(2500);

  await shot("tram-circuit-overview.png", "overview");
  await shot("tram-circuit-scale.png", "scale");

  // Climb ramp A: base (5,43) facing north -> deck y=1.45.
  await place(5, 43, 0);
  await simWalk(2.0);
  const climbA = await state();
  report.checks.climbRampA = climbA;
  assert.ok(climbA.y > 1.2, `ramp A climb failed (y=${climbA.y}, z=${climbA.z})`);
  assert.ok(climbA.z < 39.5, `ramp A did not reach deck (z=${climbA.z})`);

  // Traverse deck south->north under canopy.
  await place(6.6, 36, 0);
  await simWalk(1.5);
  const deckWalk = await state();
  report.checks.deckTraverse = deckWalk;
  assert.ok(Math.abs(deckWalk.y - 1.45) < 0.15, `deck walk left the deck (y=${deckWalk.y})`);

  // Sheer face cannot be stepped up: west of platform at grade pushing east.
  await place(2, 30, -Math.PI / 2);
  await simWalk(1.5);
  const sheer = await state();
  report.checks.sheerFace = sheer;
  assert.ok(sheer.x < 3.0, `sheer platform face was stepped up (x=${sheer.x}, y=${sheer.y})`);

  // Descend ramp B: deck (8,37) facing south -> apron y=0.
  await place(8, 37, Math.PI);
  await simWalk(2.0);
  const descendB = await state();
  report.checks.descendRampB = descendB;
  assert.ok(descendB.y < 0.3, `ramp B descent failed (y=${descendB.y}, z=${descendB.z})`);
  assert.ok(descendB.z > 42, `ramp B did not reach apron (z=${descendB.z})`);

  // Kiosk passage: (5,57) north through west gap to ramp mouth.
  await place(5, 57, 0);
  await simWalk(3.0);
  const passage = await state();
  report.checks.kioskPassage = passage;
  assert.ok(passage.z < 50, `kiosk passage blocked (z=${passage.z})`);
  assert.ok(passage.x < 7, `kiosk passage drifted into kiosk (x=${passage.x})`);

  // Hold integrity on the deck (synchronous weapon pose + muzzle authority).
  const hold = await page.evaluate(() => {
    window.__tramReview.play();
    const g = window.__gflGame;
    g.sim.pos.set(6.6, 1.45, 30); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    return window.__tololoHold.measure();
  });
  report.checks.holdOnDeck = hold
    ? { mainErr: hold.mainErr, supportErr: hold.supportErr, stockErr: hold.stockErr, barrelDeg: hold.barrelDeg }
    : null;
  assert.ok(hold, "hold measurement unavailable on deck");
  assert.ok(hold.mainErr < 0.05 && hold.supportErr < 0.05, `deck hold contacts off: main=${hold.mainErr} support=${hold.supportErr}`);

  await shot("tram-circuit-platform.png", "platform");
  await shot("tram-circuit-ramp.png", "ramp");

  // Relay activation at the new ring.
  await place(16, 58.5, Math.PI);
  await page.evaluate(() => window.__gflGame.input.pressed.add("KeyF"));
  await page.waitForTimeout(800);
  const relay = await page.evaluate(() => ({
    active: window.__gflGame.sim.relayActive,
    boss: window.__gflGame.sim.bossSpawned,
    bossPos: window.__gflGame.sim.bossRef
      ? { x: +window.__gflGame.sim.bossRef.pos.x.toFixed(1), z: +window.__gflGame.sim.bossRef.pos.z.toFixed(1) }
      : null,
  }));
  report.checks.relay = relay;
  assert.equal(relay.active, true, "relay did not activate at (16,55) ring");
  assert.equal(relay.boss, true, "boss did not spawn on relay activation");
  assert.ok(relay.bossPos && relay.bossPos.x > 10 && relay.bossPos.x < 26, `boss arrived outside circuit: ${JSON.stringify(relay.bossPos)}`);
  await shot("tram-circuit-relay.png", "relay");

  // Deck cache loot (F at (5,30)): proves interact works at deck height.
  await place(5, 31.5, 0);
  await page.evaluate(() => window.__gflGame.input.pressed.add("KeyF"));
  await page.waitForTimeout(800);
  const cache = await page.evaluate(() => ({
    taken: window.__gflGame.sim.world.caches.map((c) => c.taken),
    opened: window.__gflGame.sim.cachesOpened,
  }));
  // Cache F may open the attachment modal; close it for subsequent checks.
  await page.evaluate(() => window.__gflGame.ui.closeModal());
  report.checks.cache = cache;
  assert.equal(cache.taken[1], true, "platform deck cache could not be looted");

  // Fence containment: jump + dodge + Phase Step at the south fence.
  await place(14, 62.5, Math.PI);
  await page.evaluate(() => window.__gflGame.input.pressed.add("Space"));
  await simWalk(1.0);
  const jumpHold = await state();
  report.checks.jumpHold = jumpHold;
  assert.ok(jumpHold.z < 63.6, `jump cleared the south fence (z=${jumpHold.z})`);
  await place(14, 62.5, Math.PI);
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.pressed.add("ControlLeft");
  });
  await page.waitForTimeout(1200);
  const dodgeHold = await state();
  report.checks.dodgeHold = dodgeHold;
  assert.ok(dodgeHold.z < 63.6, `dodge cleared the south fence (z=${dodgeHold.z})`);
  await place(14, 60, Math.PI);
  const phaseBefore = await page.evaluate(() => window.__gflGame.sim.skillCD[1]);
  await page.evaluate(() => window.__gflGame.sim.castSkill(1));
  await page.waitForTimeout(1200);
  const phaseHold = await state();
  report.checks.phaseHold = { ...phaseHold, cdWas: phaseBefore };
  assert.ok(phaseHold.z < 63.6 && phaseHold.z > 40 && phaseHold.x > 0 && phaseHold.x < 26,
    `Phase Step stranded outside circuit: ${JSON.stringify(phaseHold)}`);
  // North platform fence holds.
  await place(6.6, 20, 0);
  await simWalk(1.5);
  const northHold = await state();
  report.checks.northHold = northHold;
  assert.ok(northHold.z > 17.3, `north platform fence did not hold (z=${northHold.z})`);

  // Crowded circuit fight: 8 enemies across apron + deck spawn points.
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
    g.sim.pos.set(14, 0, 58); g.sim.yaw = 0;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    const V = g.sim.pos.constructor;
    const spots = [[11, 54], [19, 54], [6, 50], [6, 30], [22, 60], [8, 24], [18, 48], [14, 61]];
    const kinds = ["chaser", "chaser", "runner", "chaser", "runner", "chaser", "chaser", "runner"];
    spots.forEach(([x, z], i) => {
      const e = g.sim.spawnEnemy(kinds[i], new V(x, g.sim.world.groundHeightAt(x, z), z), false);
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
  assert.equal(combat.enemies, 8, "circuit fight did not stage 8 enemies");
  await page.evaluate(() => window.__tramReview.view("combat"));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(artifactDir, "tram-circuit-fight.png") });
  report.captures.push("tram-circuit-fight.png");
  const combatSample = await sample(page, "tram circuit 8-enemy fight");
  await page.evaluate(() => { window.__gflGame.input.mouseDown = false; });

  // Relay completion -> victory -> loop continuation (dev charge shortcut).
  await page.evaluate(() => {
    const g = window.__gflGame;
    for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 1e9, { isProc: true });
    for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    if (g.state !== "playing") g.state = "playing";
  });
  const simT0 = await page.evaluate(() => window.__gflGame.sim.runTime);
  await page.waitForFunction((t0) => window.__gflGame.sim.runTime >= t0 + 3, simT0, { timeout: 180_000 });
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(16, 0, 55); g.sim.yaw = 0;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    if (!g.sim.relayActive) g.sim.activateRelay();
    for (const e of [...g.sim.enemies]) { if (e.kind !== "boss") g.sim.damageEnemy(e, 1e9, { isProc: true }); }
    // Finish any boss (the relay-test boss may already be dead from the
    // fight setup); then park charge just below full INSIDE the ring so the
    // normal relay tick crosses the threshold and fires victory honestly.
    if (g.sim.bossRef) g.sim.damageEnemy(g.sim.bossRef, 1e9, { isProc: true });
    g.sim.relayActive = true;
    g.sim.relayCharge = 0.999;
  });
  await page.waitForFunction(() => window.__gflGame.state === "victory", null, { timeout: 180_000 });
  const victory = await page.evaluate(() => ({
    state: window.__gflGame.state,
    charge: window.__gflGame.sim.relayCharge,
    bossDead: window.__gflGame.sim.bossDead,
  }));
  report.checks.victory = victory;
  assert.equal(victory.state, "victory", `relay completion did not reach victory: ${JSON.stringify(victory)}`);
  await page.screenshot({ path: path.join(artifactDir, "tram-circuit-victory.png") });
  report.captures.push("tram-circuit-victory.png");

  // Loop continuation keeps the circuit placed and reset. Drain pending
  // reward modals first (boss XP levels + loop attachment) so the resume
  // state is asserted honestly without modal interference.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.build.queuedLevels = 0;
    for (const k of Object.keys(g.sim.build.attachments)) g.sim.build.attachments[k] = null;
    g.ui.closeModal();
    window.__gflGame.continueLoop();
  });
  await page.waitForTimeout(1500);
  const loop = await page.evaluate(() => ({
    state: window.__gflGame.state,
    loop: window.__gflGame.sim.loop,
    x: +window.__gflGame.sim.pos.x.toFixed(1),
    z: +window.__gflGame.sim.pos.z.toFixed(1),
    relayReset: !window.__gflGame.sim.relayActive,
  }));
  report.checks.loop = loop;
  assert.equal(loop.state, "playing", "loop continuation did not resume playing");
  assert.equal(loop.loop, 1, "loop counter did not advance");
  assert.ok(loop.x > 0 && loop.x < 26 && loop.z > 42 && loop.z < 64, `loop spawn outside circuit: ${loop.x},${loop.z}`);

  // Restart keeps the station loaded exactly once and resets encounter state.
  const meshesBefore = await page.evaluate(() => window.__gflGame.scene.meshes.length);
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.restart();
    g.sim.godmode = true;
    g.sim.spawnT = 99999;
  });
  await page.waitForTimeout(1500);
  const restart = await page.evaluate(() => ({
    meshesAfter: window.__gflGame.scene.meshes.length,
    cachesReset: window.__gflGame.sim.world.caches.every((c) => !c.taken),
    relayReset: !window.__gflGame.sim.relayActive,
    tramStillLoaded: window.__tramReview.status().phase,
    x: +window.__gflGame.sim.pos.x.toFixed(1),
    z: +window.__gflGame.sim.pos.z.toFixed(1),
  }));
  report.restart = { meshesBefore, ...restart };
  assert.equal(restart.meshesAfter, meshesBefore, "restart duplicated or leaked station resources");
  assert.equal(restart.tramStillLoaded, "ready", "station did not survive restart");
  assert.ok(restart.x > 0 && restart.x < 26 && restart.z > 42 && restart.z < 64, `restart spawn outside circuit: ${restart.x},${restart.z}`);

  await shot("tram-circuit-circuit.png", "circuit");
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(14, 0, 58); g.sim.yaw = 0;
  });
  const idleSample = await sample(page, "tram circuit idle apron");
  await page.evaluate(() => window.__gflGame.input.keys.add("KeyW"));
  const traversalSample = await sample(page, "tram circuit traversal");
  await page.evaluate(() => window.__gflGame.input.keys.clear());
  report.perf = { idle: idleSample, traversal: traversalSample, combat: combatSample };

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(path.join(artifactDir, "tram-circuit-walkthrough.webm"));
  report.captures.push("tram-circuit-walkthrough.webm");

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
  await fs.writeFile(path.join(artifactDir, "tram-circuit-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
  await fs.rm(videoDir, { recursive: true, force: true });
}
