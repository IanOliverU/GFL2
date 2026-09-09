import { chromium } from "playwright-core";
const base = "http://localhost:5173";
const exe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  await page.goto(`${base}/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__gflGame?.state === "playing", null, { timeout: 60000 });
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });
  await page.waitForTimeout(1000);
  async function placeShot(name, px, pz, yaw, camOff) {
    await page.evaluate(({ px, pz, yaw, camOff }) => {
      const g = window.__gflGame; const C = g.sim.pos.constructor;
      g.debugCamera = null;
      g.sim.pos.set(px, 0, pz); g.sim.yaw = yaw; g.sim.pitch = -0.08;
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      g.sim.updateCamera(1, false);
      if (camOff) {
        const c = g.camera.position;
        g.debugCamera = { pos: new C(c.x + camOff[0], c.y + camOff[1], c.z + camOff[2]), target: new C(px, 1.0, pz) };
      }
    }, { px, pz, yaw, camOff });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `artifacts/${name}` });
    console.log("saved", name);
  }
  // Absolute low side profiles: feet vs platform pavers / track ballast.
  async function absShot(name, px, pz, cx, cy, cz) {
    await page.evaluate(({ px, pz, cx, cy, cz }) => {
      const g = window.__gflGame; const C = g.sim.pos.constructor;
      g.sim.pos.set(px, 0, pz); g.sim.yaw = -Math.PI / 2;
      g.sim.playerMesh.position.copyFrom(g.sim.pos);
      g.debugCamera = { pos: new C(cx, cy, cz), target: new C(px, 1.0, pz) };
    }, { px, pz, cx, cy, cz });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `artifacts/${name}` });
    console.log("saved", name);
  }
  async function nadir(name, cx, cz, size) {
    await page.evaluate(({ cx, cz }) => {
      const g = window.__gflGame; const C = g.sim.pos.constructor;
      g.debugCamera = { pos: new C(cx, 70, cz + 0.01), target: new C(cx, 0, cz) };
    }, { cx, cz });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `artifacts/${name}` });
    console.log("saved", name);
  }
  await nadir("tram-scout-nadir-circuit.png", 15, 45, 0);
} finally { await browser.close(); }
