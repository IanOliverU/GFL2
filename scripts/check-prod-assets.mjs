// Production packaging guard: fails the build if prohibited local-only
// assets were packaged into dist/. Local review assets (redistribution-
// restricted Tololo PMX/textures, the full tram district GLB, source archives,
// unused texture directories) must reach the browser exclusively through
// `vite dev` middleware from git-ignored locations — never through public/
// (which Vite copies verbatim into dist/) and never via bundled imports.
// Usage: node scripts/check-prod-assets.mjs (wired into `npm run build`).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(path.relative(dist, full).replace(/\\/g, "/"));
  }
  return out;
}

const violations = [];
let files = [];
try {
  files = walk(dist);
} catch {
  console.error("[check-prod-assets] ERROR: dist/ missing — run `vite build` first.");
  process.exit(1);
}

// 1. Prohibited path segments / extensions anywhere in dist/.
const bannedPath = /(^|\/)mmd(\/|$)|(^|\/)tram-review(\/|$)|(^|\/)tram_station|(^|\/)assets\/maps\//;
const bannedExt = /\.(pmx|pmd|vmd|vpd|blend|blend1|7z|hdr|tga)$/i;
for (const f of files) {
  if (bannedPath.test(f)) violations.push(`banned path packaged: ${f}`);
  else if (bannedExt.test(f)) violations.push(`banned extension packaged: ${f}`);
  else if (f.endsWith(".glb")) violations.push(`staged GLB packaged: ${f}`);
}

// 2. No source imports of the raw asset locations (would bundle them).
// Plain string constants (doc references, dev-middleware URLs) are fine;
// only module import/export statements can pull bytes into the bundle.
const srcHits = [];
const importRe = /\bfrom\s*["'][^"']*(assets\/maps\/tram|assets\/Character MMD|\.local-assets\/)|import\s*\(\s*["'][^"']*(assets\/maps\/tram|assets\/Character MMD|\.local-assets\/)/;
for (const entry of readdirSync(path.join(root, "src"))) {
  if (!entry.endsWith(".ts")) continue;
  const text = readFileSync(path.join(root, "src", entry), "utf8");
  if (importRe.test(text)) srcHits.push(entry);
}
for (const hit of srcHits) violations.push(`source references local-only path: ${hit}`);

if (violations.length > 0) {
  console.error(`[check-prod-assets] FAIL: ${violations.length} prohibited asset(s) in dist/ or src/:\n  ${violations.join("\n  ")}`);
  process.exit(1);
}
console.log(`[check-prod-assets] OK: ${files.length} dist files, no local-only assets packaged.`);
assert.ok(files.length > 0, "dist/ is empty");
