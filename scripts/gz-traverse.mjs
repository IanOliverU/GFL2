// Green Zone traversal + reachability (local review only).
// Walks both walkway ramps, crosses the deck, enters the alley cache nook,
// interacts, enters the relay ring; asserts camera never inside colliders and
// spawns/caches clear of solids.
// Usage: node scripts/gz-traverse.mjs
import assert from "node:assert/strict";
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
const browser = await chromium.launch({
  executablePath, headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(page);
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.sim.spawnT = 99999;
    g.sim.build.queuedLevels = 0; g.sim.build.xp = 0;
    g.ui.closeModal(); if (g.state !== "playing") g.state = "playing";
  });
  const camHits = [];
  async function walkTo(px, pz, yaw, ms, label, py = 0) {
    const r = await page.evaluate(([x, z, y, t, yy]) => new Promise((resolve) => {
      const g = window.__gflGame;
      g.debugCamera = null;
      g.sim.pos.set(x, yy, z); g.sim.vel.set(0, 0, 0); g.sim.yaw = y;
      g.sim.updateCamera(1, false);
      for (const o of g.sim.orbs) { o.active = false; o.mesh.isVisible = false; }
      g.input.keys.add("KeyW");
      const bad = [];
      const iv = setInterval(() => {
        const c = g.camera.position;
        for (const b of g.sim.world.colliders) {
          if (c.x > b.min.x && c.x < b.max.x && c.y > b.min.y && c.y < b.max.y && c.z > b.min.z && c.z < b.max.z) {
            bad.push([+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)]);
            break;
          }
        }
      }, 400);
      setTimeout(() => {
        g.input.keys.delete("KeyW");
        clearInterval(iv);
        resolve({ x: +g.sim.pos.x.toFixed(2), y: +g.sim.pos.y.toFixed(2), z: +g.sim.pos.z.toFixed(2), camHits: bad });
      }, t);
    }), [px, pz, yaw, ms, py]);
    report[label] = r;
    camHits.push(...r.camHits.map((c) => `${label}:${c}`));
    return r;
  }
  // West ramp up (face +X), cross deck, east ramp down.
  let r = await walkTo(-48, -30, -Math.PI / 2, 5000, "rampW");
  assert.ok(r.y > 4.5 && r.x > -42 && r.x < -30, `west ramp failed: ${JSON.stringify(r)}`);
  // Adaptive crossing: SwiftShader fps varies run to run; walk in bursts.
  r = await walkTo(-36, -35, -Math.PI / 2, 6000, "deck", 6);
  for (let i = 0; i < 5 && !(r.x > 28 && r.y > 5); i++) {
    r = await walkTo(r.x, r.z, -Math.PI / 2, 6000, "deck", 6);
  }
  assert.ok(r.x > 28 && r.y > 5, `deck cross failed: ${JSON.stringify(r)}`);
  r = await walkTo(38, -35, -Math.PI / 2, 5000, "rampE", 6);
  assert.ok(r.y < 1 && r.x > 42, `east ramp failed: ${JSON.stringify(r)}`);
  // Alley lane to the cache + interact.
  r = await walkTo(-19, 20, Math.PI / 2, 4000, "alley");
  assert.ok(r.x < -25, `alley entry failed: ${JSON.stringify(r)}`);
  const inter = await page.evaluate(() => {
    const g = window.__gflGame;
    const near = g.sim.nearestInteractable();
    if (near) g.sim.tryInteract();
    return new Promise((resolve) => setTimeout(() => resolve({
      near: near ? String(near.kind ?? near) : null,
      state: g.state,
      cacheTaken: g.sim.world.caches.some((c) => Math.hypot(c.pos.x - g.sim.pos.x, c.pos.z - g.sim.pos.z) < 4 && c.taken),
    }), 600));
  });
  report.interact = inter;
  assert.ok(inter.near, "no interactable near the alley cache");
  // Relay ring entry from the south.
  r = await walkTo(0, 6, 0, 3000, "relay");
  const ringDist = Math.hypot(r.x - 0, r.z + 8);
  assert.ok(ringDist < 9, `relay ring not reached: ${JSON.stringify(r)}`);
  assert.deepEqual(camHits, [], `camera inside colliders: ${camHits.join("; ")}`);
  // Spawns + caches clear of NEW solids (mirrors src/gz-layout.ts GZ_SOLIDS;
  // blockage by original geometry is pre-existing and reported, not failed).
  const GZ = [
    [-17, 4.5, 2, 4, 9, 36], [17, 5.5, 2, 4, 11, 36], [-34.5, 2.5, 20, 5, 5, 12],
    [-24, 1, 15.5, 0.6, 2, 3], [-24, 1, 24.5, 0.6, 2, 3], [-6.5, 1, -8, 1.4, 2, 1],
    [6.5, 1, -8, 1.4, 2, 1], [0, 6.55, -39.7, 80, 1.1, 0.4], [0, 6.55, -30.3, 80, 1.1, 0.4],
    [-8, 0.55, 16, 2.2, 1.1, 0.8], [8, 0.55, 16, 2.2, 1.1, 0.8], [23, 1.1, 8, 2.2, 2.2, 5],
    [-13.5, 0.35, -6, 1.6, 0.7, 1.6], [-13.5, 0.35, 10, 1.6, 0.7, 1.6],
    [13.5, 0.35, -6, 1.6, 0.7, 1.6], [13.5, 0.35, 10, 1.6, 0.7, 1.6],
    [-11, 1, 22, 0.5, 2, 0.5], [11, 1, 22, 0.5, 2, 0.5],
    [-40, 6.5, -52, 2, 13, 2], [40, 6.5, -52, 2, 13, 2],
  ];
  const reach = await page.evaluate((gz) => {
    const w = window.__gflGame.sim.world;
    const blockedBy = (x, y, z, rad) => w.colliders.filter((b) =>
      y + 0.2 < b.max.y && y + 1.6 > b.min.y &&
      x + rad > b.min.x && x - rad < b.max.x && z + rad > b.min.z && z - rad < b.max.z);
    const isGz = (b) => gz.some((g) =>
      Math.abs((b.min.x + b.max.x) / 2 - g[0]) < 0.01 && Math.abs((b.min.y + b.max.y) / 2 - g[1]) < 0.01 &&
      Math.abs((b.min.z + b.max.z) / 2 - g[2]) < 0.01);
    return {
      spawns: w.spawnPoints.map((p) => {
        const hit = blockedBy(p.x, p.y, p.z, 0.6);
        return { ok: hit.length === 0, gz: hit.some(isGz) };
      }),
      caches: w.caches.map((c) => blockedBy(c.pos.x, c.pos.y + 0.6, c.pos.z, 1.0).length === 0),
    };
  }, GZ);
  const gzBlocked = reach.spawns.filter((s) => !s.ok && s.gz);
  assert.deepEqual(gzBlocked, [], `new geometry blocks spawns: ${JSON.stringify(reach.spawns)}`);
  assert.ok(reach.caches.every(Boolean), `cache blocked: ${JSON.stringify(reach.caches)}`);
  report.reach = {
    spawns: reach.spawns.length,
    preExistingBlocked: reach.spawns.map((s, i) => (!s.ok && !s.gz ? i : -1)).filter((i) => i >= 0),
    caches: reach.caches.length,
  };
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
