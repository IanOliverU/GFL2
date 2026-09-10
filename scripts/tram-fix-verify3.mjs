import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
try {
  await page.goto(`${base}/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", null, { timeout: 60000 });
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__fix = {
      sweep() {
        const g = window.__gflGame;
        for (const e of [...g.sim.enemies]) g.sim.damageEnemy(e, 99999, { isProc: true });
        for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
        for (const k of Object.keys(g.sim.build.attachments)) g.sim.build.attachments[k] = null;
        g.sim.build.queuedLevels = 0;
        g.ui.closeModal();
        if (g.state !== "playing") g.state = "playing";
        g.sim.godmode = true;
        if (!g.sim.alive) { g.sim.alive = true; }
        g.sim.hp = g.sim.maxHp;
        g.sim.relayActive = false;
        g.sim.bossSpawned = false; g.sim.bossDead = false; g.sim.bossRef = null;
      },
    };
    window.__fix.sweep();
  });
  async function sweep() { await page.evaluate(() => window.__fix.sweep()); }

  // Shooting lanes with operator pitch computed onto the enemy chest.
  async function shootCase(name, px, pz, ex, ez) {
    await sweep();
    return page.evaluate(({ name, px, pz, ex, ez }) => new Promise((resolve) => {
      const g = window.__gflGame;
      window.__tramReview.play();
      const gy = g.sim.world.groundHeightAt(px, pz);
      g.sim.pos.set(px, gy, pz);
      g.sim.vel.set(0, 0, 0);
      const ey = g.sim.world.groundHeightAt(ex, ez) + 1.0;
      g.sim.yaw = Math.atan2(-(ex - px), -(ez - pz));
      g.sim.pitch = Math.atan2(ey - (gy + 1.9), Math.hypot(ex - px, ez - pz));
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      g.sim.updateCamera(1, false);
      const V = g.sim.pos.constructor;
      const e = g.sim.spawnEnemy("chaser", new V(ex, g.sim.world.groundHeightAt(ex, ez), ez), false);
      e.hp = e.maxHp = 100000;
      e.speed = 0; // hold still: isolate firing lane from chase behavior
      g.sim.ammo = g.sim.magSize(); g.sim.reloading = 0; g.sim.fireTimer = 0;
      g.input.mouseDown = true;
      const t0 = g.sim.runTime; const w0 = Date.now();
      const iv = setInterval(() => {
        if (g.sim.runTime - t0 >= 2 || Date.now() - w0 > 60000) {
          clearInterval(iv);
          g.input.mouseDown = false;
          const s = g.sim.shotLog[g.sim.shotLog.length - 1];
          const w = (v) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) });
          resolve({ name, dmg: 100000 - e.hp, rounds: g.sim.magSize() - g.sim.ammo,
            lastMuzzle: s ? w(s.muzzle) : null, lastAim: s ? w(s.aim) : null,
            lastTracerB: s && s.tracerB ? w(s.tracerB) : null,
            enemyAt: { x: +e.pos.x.toFixed(1), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(1) } });
        }
      }, 250);
    }), { name, px, pz, ex, ez });
  }
  const openA = await shootCase("ramp-A-axis", 5, 44.5, 5, 36);
  const overSkirt = await shootCase("over-skirt", 6.5, 44.5, 6.5, 36);
  const throughFence = await shootCase("north-fence-opening", 12, 46, 12, 38);
  const openB = await shootCase("ramp-B-axis", 8, 44.5, 8, 36);
  const kioskCover = await shootCase("kiosk-solid-cover", 11, 49, 5.5, 49);
  console.log("LANE-OPEN-A:" + JSON.stringify(openA));
  console.log("LANE-OPEN-OVER-SKIRT:" + JSON.stringify(overSkirt));
  console.log("LANE-OPEN-FENCE:" + JSON.stringify(throughFence));
  console.log("LANE-OPEN-MOUTH-B:" + JSON.stringify(openB));
  console.log("LANE-BLOCK-KIOSK:" + JSON.stringify(kioskCover));
  assert.ok(openA.dmg > 0 && openB.dmg > 0, "both ramp firing lanes must remain open");
  assert.ok(throughFence.dmg > 0, "shots must pass through visible station-fence openings");
  assert.equal(kioskCover.dmg, 0, "solid kiosk cover must block shots");

  // Pursuit up ramp B from a realistic east-lane start.
  await sweep();
  const legB = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.pos.set(8, 1.45, 28); g.sim.vel.set(0, 0, 0);
    g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.playerMesh.position.copyFrom(g.sim.pos);
    const V = g.sim.pos.constructor;
    const e = g.sim.spawnEnemy("chaser", new V(14, 0, 48), false);
    e.hp = e.maxHp = 100000;
    const t0 = g.sim.runTime; const w0 = Date.now();
    let teleports = 0; let lastKey = `${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}`;
    const iv = setInterval(() => {
      const d = Math.hypot(e.pos.x - g.sim.pos.x, e.pos.z - g.sim.pos.z);
      const key = `${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}`;
      if (Math.hypot(e.pos.x - parseFloat(lastKey.split(",")[0]), e.pos.z - parseFloat(lastKey.split(",")[1])) > 8) teleports++;
      lastKey = key;
      if (d < 2.5 || g.sim.runTime - t0 >= 40 || Date.now() - w0 > 180000) {
        clearInterval(iv);
        resolve({ minDist: null, endDist: +d.toFixed(1), endY: +e.pos.y.toFixed(2),
          endXZ: [+e.pos.x.toFixed(1), +e.pos.z.toFixed(1)], simUsed: +(g.sim.runTime - t0).toFixed(1),
          rescues: teleports });
      }
    }, 400);
  }));
  console.log("PURSUIT-B4:" + JSON.stringify(legB));
  assert.ok(legB.endDist < 2.5, `ramp-B pursuit stalled ${legB.endDist} m away`);
  assert.ok(Math.abs(legB.endY - 1.45) < 0.2, `pursuer ended off platform at y=${legB.endY}`);
  assert.equal(legB.rescues, 0, "ramp-B pursuit must not use rescue teleports");

  // Containment re-verify (1.7 m fences), live run.
  await sweep();
  const holds = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gflGame;
    const out = {};
    const cases = [
      ["jumpS", 14, 62.5, Math.PI, "jump", 1.2], ["dodgeS", 14, 62.5, Math.PI, "dodge", 1.2],
      ["phaseS", 14, 60, Math.PI, "phase", 1.2], ["walkN", 6.6, 20, 0, "walk", 1.5],
      ["walkW", 2, 53, Math.PI / 2, "walk", 1.5],
    ];
    let i = 0;
    function next() {
      if (i >= cases.length) { resolve(out); return; }
      const [name, x, z, yaw, action, simN] = cases[i];
      window.__tramReview.play();
      g.sim.pos.set(x, g.sim.world.groundHeightAt(x, z), z);
      g.sim.vel.set(0, 0, 0);
      g.sim.yaw = yaw; g.sim.pitch = -0.08;
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      if (action === "jump") { g.input.keys.add("KeyW"); g.input.pressed.add("Space"); }
      if (action === "dodge") g.input.pressed.add("ControlLeft");
      if (action === "phase") { g.sim.skillCD = [0, 0, 0]; g.sim.castSkill(1); }
      if (action === "walk") g.input.keys.add("KeyW");
      const t0 = g.sim.runTime; const w0 = Date.now();
      const iv = setInterval(() => {
        if (g.sim.runTime - t0 >= simN || Date.now() - w0 > 60000) {
          clearInterval(iv);
          g.input.keys.clear();
          out[name] = { x: +g.sim.pos.x.toFixed(2), y: +g.sim.pos.y.toFixed(2), z: +g.sim.pos.z.toFixed(2),
            simAdvanced: +(g.sim.runTime - t0).toFixed(2) };
          i++;
          setTimeout(next, 150);
        }
      }, 200);
    }
    next();
  }));
  console.log("HOLDS3:" + JSON.stringify(holds));
  assert.ok(holds.jumpS.z < 64 && holds.dodgeS.z < 64 && holds.phaseS.z < 64,
    "south boundary was breached");
  assert.ok(holds.walkN.z > 17 && holds.walkW.x > 0, "north or west boundary was breached");

  // Camera close-ups at fence-facing poses (live, converged).
  await sweep();
  const camClose = await page.evaluate(() => {
    const g = window.__gflGame;
    const out = [];
    const poses = [
      { x: 14, z: 62.5, yaw: Math.PI }, { x: 6.6, z: 19.5, yaw: 0 },
      { x: 5, z: 55, yaw: -Math.PI / 2 }, { x: 6.6, z: 30, yaw: 0 },
    ];
    window.__tramReview.play();
    for (const p of poses) {
      g.sim.pos.set(p.x, g.sim.world.groundHeightAt(p.x, p.z), p.z);
      g.sim.yaw = p.yaw; g.sim.pitch = -0.08;
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      for (let i = 0; i < 120; i++) g.sim.updateCamera(0.016, false);
      const d = g.sim.camPos.clone().subtract(new g.sim.pos.constructor(p.x, g.sim.pos.y + 1.9, p.z));
      out.push({ pose: p, camDist: +Math.hypot(d.x, d.z).toFixed(2), camY: +g.sim.camPos.y.toFixed(2) });
    }
    return out;
  });
  console.log("CAM-CLOSE3:" + JSON.stringify(camClose));
  console.log("ERRORS:" + JSON.stringify(errors));
  assert.ok(camClose.every(({ camDist }) => camDist >= 5), "camera collapsed at a boundary pose");
  assert.deepEqual(errors, [], "browser errors occurred during focused verification");
} finally { await browser.close(); }
