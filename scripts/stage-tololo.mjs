// Repeatable local-only staging for the Tololo PMX art slice.
// Copies the untouched source tree into .local-assets/mmd/tololo, preserving
// the relative Textures/ + spa/ layout the PMX references with backslash paths.
// .local-assets/ is git-ignored AND outside public/, so `vite build` can never
// package it: dev serves it via the localAssetsDevPlugin middleware in
// vite.config.ts, while production falls back to placeholders (by design).
// Nothing here commits anything (see .gitignore).
// Usage: node scripts/stage-tololo.mjs [--check-only]
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(projectRoot, "assets", "Character MMD", "Tololo (Default)");
const PMX_NAME = "GirlsFrontline TololoDefault.pmx";
// Renamed on stage: identical bytes, URL-safe name. The PMX only references
// Textures\ and spa\ relatively, so renaming the file itself is safe.
const STAGED_PMX = "tololo.pmx";
const DEST = path.join(projectRoot, ".local-assets", "mmd", "tololo");

// Every texture path referenced by the PMX (forward-slash form). The staging
// check fails if any are missing so a bad copy can never silently ship.
const REQUIRED = [
  "Textures/c_TololoSSR01_slg_body_d.png",
  "Textures/c_tololossr01_slg_cloth1.png",
  "Textures/c_tololossr01_slg_cloth2.png",
  "Textures/c_Tololo_slg_face_d.png",
  "Textures/c_Tololo_slg_eye_d.png",
  "Textures/c_Tololo_slg_eyeblend_d.png",
  "Textures/c_Tololo_slg_hair_d.png",
  "Textures/extra.png",
  "spa/hd.png",
  "spa/toon-1.bmp",
  "spa/shinetest3.png",
  "spa/Socks.png",
  "spa/spa-1.bmp",
];

const checkOnly = process.argv.includes("--check-only");

function fail(msg) {
  console.error(`[stage-tololo] ERROR: ${msg}`);
  process.exit(1);
}

if (!existsSync(path.join(SRC, PMX_NAME))) fail(`source PMX missing: ${path.join(SRC, PMX_NAME)}`);
const missing = REQUIRED.filter((rel) => !existsSync(path.join(SRC, ...rel.split("/"))));
if (missing.length > 0) fail(`missing source textures:\n  ${missing.join("\n  ")}`);
console.log(`[stage-tololo] source OK: ${PMX_NAME} + ${REQUIRED.length} referenced textures`);

if (checkOnly) {
  if (existsSync(DEST)) {
    const stagedMissing = REQUIRED.filter((rel) => !existsSync(path.join(DEST, ...rel.split("/"))));
    if (!existsSync(path.join(DEST, STAGED_PMX)) || stagedMissing.length > 0) {
      fail(`staged copy incomplete (run without --check-only). missing: ${stagedMissing.join(", ")}`);
    }
  }
  console.log("[stage-tololo] check-only: source verified");
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
cpSync(path.join(DEST, PMX_NAME), path.join(DEST, STAGED_PMX));
rmSync(path.join(DEST, PMX_NAME));
console.log(`[stage-tololo] staged ${SRC} -> ${DEST} (PMX as ${STAGED_PMX})`);

// Verify the staged copy (names differ only by separator style).
const stagedMissing = REQUIRED.filter((rel) => !existsSync(path.join(DEST, ...rel.split("/"))));
if (!existsSync(path.join(DEST, STAGED_PMX)) || stagedMissing.length > 0) {
  fail(`staged copy incomplete. missing: ${stagedMissing.join(", ")}`);
}
let bytes = 0;
for (const rel of [...REQUIRED, STAGED_PMX]) {
  bytes += statSync(path.join(DEST, ...rel.split("/"))).size;
}
console.log(`[stage-tololo] verified: PMX + ${REQUIRED.length} textures (${(bytes / 1048576).toFixed(1)} MB), local-only under .local-assets/mmd/`);
