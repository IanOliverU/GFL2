// Green Zone consistent views + perf probe (local review only).
// Same debugCamera framings for before/after comparison.
// Usage: node scripts/gz-views.mjs [--tag before|after]
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://127.0.0.1:5173";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const tagArg = process.argv.findIndex((a) => a === "--tag" || a.startsWith("--tag="));
const tag = tagArg < 0 ? "before"
  : process.argv[tagArg].includes("=") ? process.argv[tagArg].split("=")[1]
  : (process.argv[tagArg + 1] ?? "before");
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
const report = { tag, views: {}, perf: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watchPage(page);
  const extra = (process.env.NOSHADOW === "1" ? "&noshadow=1" : "") + (process.env.NOTONEMAP === "1" ? "&notonemap=1" : "");
  await page.goto(`${base}/?dev=1&nolock=1&renderer=webgl&autostart=1&char=tololo&god=1${extra}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#game-canvas").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__gflGame?.sim?.externalStatus === "pmx", null, { timeout: 120_000 });
  await page.waitForTimeout(4000); // let materials/shaders compile before measuring
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.__v3 = (x, y, z) => new g.sim.pos.constructor(x, y, z);
    g.sim.spawnT = 99999; // calm scene for composition views
  });
  async function shot(name, cam, target, settleMs = 600) {
    await page.evaluate(([c, t]) => {
      window.__gflGame.debugCamera = {
        pos: window.__gflGame.__v3(c[0], c[1], c[2]),
        target: window.__gflGame.__v3(t[0], t[1], t[2]),
      };
    }, [cam, target]);
    await page.waitForTimeout(settleMs);
    const file = `artifacts/gz-${tag}-${name}.png`;
    await page.screenshot({ path: path.resolve(file) });
    report.views[name] = file;
  }
  // Perf first (gameplay camera, courtyard center), idle then active walk.
  const perf = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__gflGame;
    g.debugCamera = null;
    g.sim.pos.set(0, 0, 6); g.sim.yaw = 0; g.sim.pitch = -0.12;
    g.sim.updateCamera(1, false);
    const out = { meshes: g.scene.meshes.length };
    setTimeout(() => {
      out.idleFps = Math.round(g.fps);
      g.input.keys.add("KeyW");
      setTimeout(() => {
        g.input.keys.delete("KeyW");
        out.walkFps = Math.round(g.fps);
        out.z = +g.sim.pos.z.toFixed(2);
        resolve(out);
      }, 3000);
    }, 3000);
  }));
  report.perf = perf;
  await shot("entrance", [4, 3.2, 18], [0, 1.5, -8]);
  await shot("center", [11, 4, 7], [-3, 1.2, -8]);
  await shot("walkway", [0, 9.6, -33], [0, 0, 10]);
  await shot("alley", [-19, 2.6, 20], [-32, 1.2, 20]);
  await shot("reverse", [0, 3, 26], [0, 2, -20]);
  // Tololo readability under the actual environment lighting.
  await page.evaluate(() => {
    const g = window.__gflGame;
    g.debugCamera = null;
    g.sim.pos.set(10, 0, 10); g.sim.yaw = 0; g.sim.pitch = -0.08;
    g.sim.updateCamera(1, false);
  });
  await shot("tololo", [11.6, 1.7, 10.2], [10, 1.45, 10.4]);
  if (errors.length) report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
