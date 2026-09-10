import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.GAME_URL ?? "http://localhost:5173";
const exe = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

try {
  await page.goto(`${base}/?dev=1&scene=tram-review&autostart=1&char=tololo&nolock=1&renderer=webgl`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__tramReview?.status()?.phase === "ready", null, { timeout: 240000 });

  const result = await page.evaluate(() => {
    const review = window.__tramReview;
    const rays = [];
    for (const x of [3.5, 5, 6.5, 8, 10]) {
      for (const z of [19, 25, 31, 38]) {
        for (const yaw of [-2.4, -0.8, 0.8]) {
          const pitch = -0.25 + ((x + z) % 5) * 0.1;
          rays.push({ x, y: 3.35, z, dx: Math.sin(yaw) * Math.cos(pitch), dy: Math.sin(pitch), dz: Math.cos(yaw) * Math.cos(pitch) });
        }
      }
    }

    let state = 0x6d2b79f5;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
    for (let i = 0; i < 2000; i++) {
      const yaw = random() * Math.PI * 2;
      const pitch = (random() - 0.5) * 1.2;
      rays.push({
        x: 3.05 + random() * 7.7,
        y: 2.96 + random() * 3.5,
        z: 17.55 + random() * 22.4,
        dx: Math.sin(yaw) * Math.cos(pitch),
        dy: Math.sin(pitch),
        dz: Math.cos(yaw) * Math.cos(pitch),
      });
    }

    let mismatches = 0;
    let maxError = 0;
    for (const ray of rays) {
      const args = [ray.x, ray.y, ray.z, ray.dx, ray.dy, ray.dz, 12];
      const fast = review.cameraDistance(...args);
      const reference = review.cameraDistanceReference(...args);
      const bothMiss = !Number.isFinite(fast) && !Number.isFinite(reference);
      const error = bothMiss ? 0 : Math.abs(fast - reference);
      if (!Number.isFinite(error) || error > 1e-4) mismatches++;
      if (Number.isFinite(error)) maxError = Math.max(maxError, error);
    }

    const sample = rays.slice(0, 500);
    const start = performance.now();
    for (const ray of sample) review.cameraDistance(ray.x, ray.y, ray.z, ray.dx, ray.dy, ray.dz, 12);
    const bvhMs = performance.now() - start;
    const referenceStart = performance.now();
    for (const ray of sample) review.cameraDistanceReference(ray.x, ray.y, ray.z, ray.dx, ray.dy, ray.dz, 12);
    const referenceMs = performance.now() - referenceStart;
    return { stats: review.stats(), scripted: 60, random: 2000, mismatches, maxError, bvhMs, referenceMs };
  });

  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.stats.cameraTriangles > 0 && result.stats.cameraBvhNodes > 0, "camera BVH was not built");
  assert.equal(result.mismatches, 0, `BVH mismatched Babylon reference; max error ${result.maxError}`);
  assert.ok(result.maxError <= 1e-4, `BVH error ${result.maxError} exceeds tolerance`);
  assert.deepEqual(errors, [], "browser errors occurred during BVH verification");
} finally {
  await browser.close();
}
