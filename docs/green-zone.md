# Green Zone — finished playable courtyard environment (milestone)

Status: implemented, validated headless, **visual acceptance pending owner review**.
Tololo's scale, hold, bullet origin, and movement are accepted as the working
baseline (unchanged by this slice). Animation polish explicitly deferred.

Review question: **Does this feel like a coherent Green Zone location we
want to expand into a full stage?**

## 1. Baseline (before changes)

- Workspace `C:\Users\MY PC\Desktop\GFL2 Game`, remote
  `https://github.com/IanOliverU/GFL2.git`, HEAD `9a5b2ca` plus the
  uncommitted firing-origin work (§14: sim shot log, synchronous muzzle,
  `tololo-fire-check.mjs`) — all preserved, nothing reset. The sibling
  GFL-RogueLite project was not touched.
- Before: `npm test` 31 passed, `tsc --noEmit` clean, `vite build` clean.
- Before captures + perf: `scripts/gz-views.mjs --tag before`
  (334 meshes, idle 22 fps, walk 21 fps, SwiftShader 1280×720).

## 2. References studied

- Local story artwork (language only, never textures):
  `GreenZone-…-DisuseBuild_Day_01` (weathered concrete yard, tank, pipes,
  elec boxes, red barrel, yellow scaffold, stadium-dome + cranes skyline),
  `…-City_Street_Day_01` (elevated transit deck on teal piers, wet asphalt,
  warm storefront, billboards, cable-stayed bridge + pyramids),
  `…-Sewage_Day_01` (concrete waterworks, outfalls, hazard striping,
  railings, moss, hazy ruined towers).
- `erenciracioglu-dotcom/a-letter-to-summer-game`, rev `c3f762f`
  (2026-09-08), MIT license. Adapted, reimplemented for Babylon.js:
  material-batched static geometry, seeded dressing RNG, procedural canvas
  textures, gradient sky dome + sun glow shader, canvas signage, player-
  following shadow frustum, ACES tone mapping. No code copied; no textures
  taken (all canvas art here is original).

## 3. Tools report (honest)

- Blender MCP: unavailable (no MCP tools in this environment; no Blender
  binary installed). All geometry is procedural Babylon.js — no authored
  GLB, no Blender viewport renders used or claimed.
- Playwright MCP: unavailable (same reason). Equivalent used throughout:
  `playwright-core` + system Chrome via repo node scripts (all captures,
  traversal, perf, video). Nothing claimed beyond what ran.
- ffmpeg for the tour video came from `npx playwright install ffmpeg`
  (Playwright's own binary, local cache only).

## 4. Bounded layout (all inside the existing arena)

A. Service courtyard (combat center): paver court x −15..15, z −14..20
with trim, lane dashes, sidewalks + curbs, drains, manholes. Framed by two
complementary facades — west: weathered concrete family (pilasters, elec
cabinets with pilot lamps, conduits, maintenance doors, window bands with
two warm-lit cells, parapet, water tank, AC, antenna mast); east: teal
painted-metal frame (band courses, fins, glass strips, storefront with lit
interior + FIELD SERVICE sign, rooftop billboard GREEN ZONE, both faces
dressed). Purposeful edge cover: existing crates/barriers plus a new
south barrier pair and four planter boxes.
B. Raised service walkway: kept deck/ramps/pillars; dressed with teal pier
cladding + hazard bases, cross-bracing, under-deck utility pipe + lamp
discs, posted double railings, hazard deck fascia, corner bollards. Both
ramp connections unchanged and traversed live (see §7).
C. Alley cache nook (west, around existing cache-4): maintenance annex
(door, high windows, wall lamp, roof vent), entry guide stubs with hazard
caps (4-wide entry), canopy with light bar, STORAGE 03 sign, asphalt lane
+ drain. Entrance invites from the courtyard; cache interaction verified
live (F press takes the cache).
D. Background: north/east/west/south hazy tower rows (flat mats + fog),
stadium-dome landmark NW (drum + squashed dome), overhead transit beam on
two collider piers with teal tails, tower-crane silhouette NE, gradient
sky dome + sun glow, pale horizon haze. The dark void is gone. The four
crossed-plane clouds were disabled in the Chaser milestone after a later
capture exposed dark X-shaped silhouettes on some renderers.

## 5. Asset kit (`src/greenzone.ts` + `src/gz-layout.ts`)

- Ground: pavers, asphalt, sidewalks, curbs, drains, manholes, markings.
- Facades: two families with corners, doors, windows, rooflines, shutters
  (teal fins as sun-shading), parapet, tank.
- Walkway: deck dress, posts/rails, bollards, fascia, under-deck utilities.
- Canopy, pipes/conduits, elec cabinets, 3 canvas signs + billboard,
  2 streetlights (visual only).
- Barriers, 3 bins (visual only), 1 parked service truck (solid, cover).
- Planters + shrubs, 2 reusable trees (trunk proxy + blob canopy), moss.
- Simplified distant towers, dome, transit beam, crane.
- All new solids (20) live in `GZ_SOLIDS` with unit-validated clearances and
  grade-route connectivity; visuals match collider boxes 1:1.

## 6. Materials / lighting / atmosphere

- Procedural canvas textures (original): concrete + streaks, dark concrete,
  asphalt speckle, paver joints, brushed teal, two glass grids (dense 22%
  lit for bands, sparse 8% for punched windows), hazard chevrons, signage,
  billboard art. The cloud-puff texture code is retained but not instantiated.
- Daylight rig (`src/game.ts`): hemi sky-blue/warm-ground 1.15, warm sun
  2.2 + ACES filmic, pale fog 0.0032, horizon clear color. One 1024px
  shadow map, fixed courtyard frustum, bias tuned against acne
  (0.003/0.10). Merged statics cast; ground/plaza/deck receive.
- Warm accents only at entrances/machinery (lamps, interiors, status
  strips, canopy bar); enemies (red/yellow spheres), loot (teal/white),
  relay (orange ring/beacon) stay distinct from decor.
- Tololo readability verified in `gz-after-tololo.png`: skin, hair, eyes,
  clothing all clean under the new sun; her materials untouched.

## 7. Collision / traversal / performance

- Decorative vs collision split: thin/small dressing is visual-only;
  every blocking mass has a registered AABB used consistently by movement,
  enemies, camera, and shots. New cover shot-tested conceptually via the
  existing muzzle-inside-solid → zero-length-tracer rule (§14).
- Traversal (`scripts/gz-traverse.mjs`, all passing): west ramp climb,
  full deck crossing at height, east ramp descent, alley lane to cache +
  F-take, relay ring entry, camera never inside any collider, all 10
  spawns (1 pre-existing bE-wall tight spawn documented) + 6 caches clear.
  Enemy ramp routing uses the unchanged groundHeight/RampZ path; both
  ramp mouths + deck ends validated clear in `gz-layout`.
- Restart safety: `buildWorld` runs once per init; no per-frame allocation
  in the slice; no new lights per prop.
- Perf (same SwiftShader/720p conditions): before 334 meshes, idle 22,
  walk 21. After: 364–369 meshes (enemy-count variance; slice geometry
  merged into ~15 draw calls), idle 12–23 across runs, walk 10–13. A/B:
  shadows off and tone mapping off each measured equal-or-worse, so
  neither is an isolated cause; the combined daylight pipeline (shadow
  pass + filmic + brighter fill) plus SwiftShader variance explains the
  band. No runaway, zero errors across all harnesses. Real-GPU
  measurement still required for conclusive numbers (expected: trivially
  fast; ~15 draw calls for the slice).

## 8. Verification + review package

- `npm test` 34 passed (new `tests/greenzone.test.ts`: clearances,
  routes, validator liveness, solid budget), `tsc` clean, `vite build`
  clean, `tololo-shots.mjs` still green (fallback/attach/cover/camera).
- Before/after views (`scripts/gz-views.mjs`): entrance, center, walkway,
  alley, reverse + Tololo lighting check — `artifacts/gz-before-*.png`,
  `artifacts/gz-after-*.png`.
- Uncut tour: `artifacts/gz-tour.webm` (45s, 720p, scripted courtyard
  cross + firing, both ramps + deck, alley cache take, relay combat,
  architecture orbit; state playing, 0 errors). Frame spot-checks
  confirm the beats; full watch-through is the owner's.
- Fixed during inspection (all re-verified): merge double-transform
  (vertices landed at 2× — removed pre-bake), planter grounding, cloud
  sprites rendering black (now alpha planes), glass-grid over-density,
  single-sided billboard, alley camera framing, shadow acne bias.

## 9. Limitations / deferred

- Animation polish (reload/walk/run/dodge) still deferred per baseline.
- Rear gameplay framing partly occludes the rifle behind Tololo's hair
  (observation from §13, unchanged).
- Drainage route: not present in this stage; nothing built for it.
- Crowded-fight footage: tour segment had firing but 0 kills; a dense
  combat capture awaits live play or a staged encounter harness.
- Real-GPU fps + pointer-lock feel unverified beyond SwiftShader.
- No combat-balance, progression, relay-rule, or character changes.
- No commit/push/deploy (per instructions); local-only PMX safeguards kept.
