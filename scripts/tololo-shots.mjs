// Tololo art-slice verification (local review only, unapproved).
// Phase A: staged PMX hidden -> loader must fall back to the placeholder.
// Phase B: staged PMX present -> Tololo attaches; capture front/side/back/
// gameplay views; verify cover collision + camera containment.
// Usage: node scripts/tololo-shots.mjs
import assert from "node:assert/strict";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const staged = path.resolve(".local-assets/mmd/tololo/tololo.pmx");
const backup = `${staged}.bak`;

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

function hideStaged() {
  if (existsSync(staged)) renameSync(staged, backup);
}
function restoreStaged() {
  if (existsSync(backup)) renameSync(backup, staged);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

const report = { fallback: null, pmx: null };
try {
  // ---- Phase A: fallback with the staged file hidden ----
  hideStaged();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watchPage(page);
    await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(9000);
    const fb = await page.evaluate(() => ({
      state: window.__gflGame.state,
      external: window.__gflGame.sim.externalStatus,
      bodyVisible: window.__gflGame.sim.playerBody.isVisible,
      char: window.__gflGame.sim.build.charId,
    }));
    assert.equal(fb.state, "playing", "fallback run did not reach playing");
    assert.equal(fb.external, "placeholder", "loader should report placeholder when staged PMX is missing");
    assert.equal(fb.bodyVisible, true, "placeholder body must stay visible on fallback");
    await page.evaluate(() => {
      const g = window.__gflGame;
      g.debugCamera = null;
      g.sim.pos.set(0, 0, 8);
      g.sim.yaw = 0; g.sim.pitch = -0.1;
      g.sim.updateCamera(1, false);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.resolve("artifacts/tololo-fallback.png") });
    report.fallback = fb;
    await page.close();
  } finally {
    restoreStaged();
  }

  // ---- Phase B: PMX present ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(page);
  const t0 = Date.now();
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const g = window.__gflGame;
    const sim = g.sim;
    return {
      state: g.state,
      renderer: g.renderer,
      external: sim.externalStatus,
      bodyVisible: sim.playerBody.isVisible,
      headVisible: sim.playerHead.isVisible,
      mount: !!sim.weaponMount && sim.weaponMount.name,
      muzzle: !!sim.muzzleNode && sim.muzzleNode.name,
      meshes: g.scene.meshes.length,
      fps: Math.round(g.fps),
    };
  });
  assert.equal(info.state, "playing");
  assert.equal(info.external, "pmx", "Tololo PMX did not attach");
  assert.equal(info.bodyVisible, false, "placeholder body must hide under the PMX visual");
  assert.equal(info.mount, "WeaponMount");
  assert.equal(info.muzzle, "Muzzle");

  // Common framing spot: open yard south of the canopy, façade behind (+z).
  // Front camera stays clear of the canopy roof (z < 4.7) to avoid the
  // emissive strip dominating the top of the frame.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.godmode = true;
    g.sim.pos.set(10, 0, 10);
    g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.updateCamera(1, false);
  });
  // debugCamera needs real Vector3s; reuse the sim vector constructor:
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.__v3 = (x, y, z) => new g.sim.pos.constructor(x, y, z);
  });
  async function shot(name, cam, target) {
    await page.evaluate(([c, t]) => {
      window.__gflGame.debugCamera = {
        pos: window.__gflGame.__v3(c[0], c[1], c[2]),
        target: window.__gflGame.__v3(t[0], t[1], t[2]),
      };
    }, [cam, target]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.resolve(`artifacts/${name}`) });
  }
  await shot("tololo-front.png", [10, 1.5, 7.0], [10, 1.15, 10]);
  await shot("tololo-side.png", [13.2, 1.5, 10], [10, 1.15, 10]);
  await shot("tololo-back.png", [10, 1.8, 13.2], [10, 1.15, 10]);
  // Close-up for face/eyes/hair-transparency inspection (review evidence only).
  await shot("tololo-face.png", [10, 1.55, 8.3], [10, 1.38, 10]);

  // Normal gameplay camera: approach lane toward the relay + canopy + cover.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.debugCamera = null;
    g.sim.pos.set(4, 0, 12);
    g.sim.yaw = 0.38; g.sim.pitch = -0.12;
    g.sim.updateCamera(1, false);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.resolve("artifacts/tololo-gameplay.png") });

  // Cover collision: walk north into the x=5 barrier; must stop outside it.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.debugCamera = null;
    g.sim.pos.set(5, 0, 0.5);
    g.sim.yaw = 0;
    g.sim.updateCamera(1, false);
    g.input.keys.add("KeyW");
  });
  await page.waitForTimeout(1200);
  const collision = await page.evaluate(() => {
    const g = window.__gflGame;
    g.input.keys.delete("KeyW");
    const p = g.sim.pos;
    const c = g.camera.position;
    let camInside = false;
    for (const b of g.sim.world.colliders) {
      if (c.x > b.min.x && c.x < b.max.x && c.y > b.min.y && c.y < b.max.y && c.z > b.min.z && c.z < b.max.z) {
        camInside = true;
        break;
      }
    }
    return {
      x: +p.x.toFixed(2),
      z: +p.z.toFixed(2),
      insideBarrier: p.x > 3.9 && p.x < 6.1 && p.z > -2.4 && p.z < -1.6,
      camInside,
      fps: Math.round(g.fps),
      meshes: g.scene.meshes.length,
    };
  });
  assert.equal(collision.insideBarrier, false, `player entered the cover barrier: ${JSON.stringify(collision)}`);
  assert.ok(collision.z > -1.7, `player pushed through cover: ${JSON.stringify(collision)}`);
  assert.equal(collision.camInside, false, "gameplay camera ended inside a collider");

  report.pmx = { ...info, loadMsWall: loadMs, collision };
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  restoreStaged();
  await browser.close();
}
