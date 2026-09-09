// @ts-nocheck
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// Tram-station suitability review (local evaluation only, never shipped).
// Serves the large source GLB straight from git-ignored assets/ during
// `vite dev` only. configureServer never runs for `vite build`, and the file
// is never imported by application code, so production bundles and dist/ can
// never package it. See docs/tram-station-evaluation.md.
const TRAM_REVIEW_FILE = path.resolve(process.cwd(), "assets/maps/tram/tram_station.glb");
// Local-only Tololo PMX staging (redistribution-restricted source, never
// shipped). Staged by scripts/stage-tololo.mjs into .local-assets/ — outside
// public/ so production builds cannot package it. Served here in `vite dev`
// only; production resolves /mmd/* to 404 and the game falls back to the
// stylized placeholder (verified by scripts/tololo-shots.mjs).
const LOCAL_ASSETS_DIR = path.resolve(process.cwd(), ".local-assets");
const LOCAL_ASSET_MIME = new Map([
  [".pmx", "application/octet-stream"],
  [".png", "image/png"],
  [".bmp", "image/bmp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".tga", "image/x-targa"],
]);
function tramReviewDevPlugin() {
  return {
    name: "tram-review-dev-only",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        if (req.url.startsWith("/tram-review/tram_station.glb")) {
          fs.stat(TRAM_REVIEW_FILE).then((st) => {
            res.setHeader("Content-Type", "model/gltf-binary");
            res.setHeader("Content-Length", String(st.size));
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Cache-Control", "no-store");
            createReadStream(TRAM_REVIEW_FILE).pipe(res);
          }).catch(() => {
            // Fall through to Vite's SPA fallback (200 index.html), exactly
            // like public/ serving did: the loader treats it as a silent
            // parse failure instead of a console 404.
            next();
          });
          return;
        }
        if (!req.url.startsWith("/mmd/")) return next();
        // Contain the request inside .local-assets (no traversal escapes).
        const rel = decodeURIComponent(req.url.split("?")[0].slice("/mmd/".length));
        const target = path.normalize(path.join(LOCAL_ASSETS_DIR, "mmd", rel));
        const root = path.join(LOCAL_ASSETS_DIR, "mmd") + path.sep;
        if (!target.startsWith(root)) {
          res.statusCode = 403;
          res.end("forbidden");
          return;
        }
        fs.stat(target).then((st) => {
          if (!st.isFile()) throw new Error("not a file");
          const ext = path.extname(target).toLowerCase();
          res.setHeader("Content-Type", LOCAL_ASSET_MIME.get(ext) ?? "application/octet-stream");
          res.setHeader("Content-Length", String(st.size));
          res.setHeader("Cache-Control", "no-store");
          createReadStream(target).pipe(res);
        }).catch(() => {
          // Fall through to Vite's SPA fallback (200 index.html), exactly
          // like public/ serving did: the PMX/texture loaders treat it as a
          // silent parse failure (placeholder fallback, error texture) with
          // no console 404. Run node scripts/stage-tololo.mjs to stage.
          next();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [tramReviewDevPlugin()],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
