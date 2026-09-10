import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const tag = process.env.CAPTURE_TAG ?? "after";
const artifactDir = path.resolve("artifacts");
const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/WebGPU creation\/initialization|WebGPU is not supported/.test(message.text())) {
    errors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(`${base}/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120000 });
  await page.evaluate(() => {
    const g = window.__gflGame;
    window.__tramReview.play();
    g.sim.spawnT = 99999;
    for (const enemy of [...g.sim.enemies]) g.sim.damageEnemy(enemy, 999999, { isProc: true });
    for (const orb of g.sim.orbs) { orb.active = false; orb.mesh.isVisible = false; }
    g.sim.build.queuedLevels = 0;
    g.ui.closeModal();
    g.state = "playing";
  });

  async function capture(name, pose) {
    const state = await page.evaluate(({ name, pose }) => {
      const g = window.__gflGame;
      const spawn = g.sim.world.playerSpawn;
      const x = pose.spawn ? spawn.pos.x : pose.x;
      const z = pose.spawn ? spawn.pos.z : pose.z;
      const yaw = pose.spawn ? spawn.yaw + pose.yawOffset : pose.yaw;
      const y = g.sim.world.groundHeightAt(x, z);
      g.sim.pos.set(x, y, z);
      g.sim.vel.set(0, 0, 0);
      g.sim.yaw = yaw;
      g.sim.pitch = -0.08;
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      for (let i = 0; i < 120; i++) g.sim.updateCamera(0.016, false);
      const pivot = { x, y: y + 1.9, z };
      return { name, player: { x, y, z, yaw }, camera: {
        x: g.sim.camPos.x, y: g.sim.camPos.y, z: g.sim.camPos.z,
        distance: Math.hypot(g.sim.camPos.x - pivot.x, g.sim.camPos.y - pivot.y, g.sim.camPos.z - pivot.z),
      } };
    }, { name, pose });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifactDir, `tram-open-${tag}-${name}.png`) });
    return state;
  }

  const captures = [];
  captures.push(await capture("spawn", { spawn: true, yawOffset: 0 }));
  captures.push(await capture("reverse", { spawn: true, yawOffset: Math.PI }));
  captures.push(await capture("platform", { x: 8.1, z: 28, yaw: 0 }));
  console.log(JSON.stringify({ tag, captures, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
