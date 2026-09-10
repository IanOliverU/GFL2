# Tram Station — suitability evaluation (local review only)

Status: **district preview playable; source-only repository publication
approved 2026-09-10; asset redistribution suitability NOT accepted.** See §13
for the district-preview milestone built on this evaluation. The Green Zone
remains the default; the district is selected explicitly and never replaces it.

Review question: **Does this station fit Tololo and our combat, and is using the
whole asset or selected modules the better next step?**

The owner approved committing and pushing this source, documentation, and
review evidence. Do not deploy or redistribute the ignored source asset; it
remains excluded from production builds and requires a separate suitability
verdict plus visible CC-BY-4.0 attribution before shipping. No full-stage
replacement was made; the Green Zone remains the only shipped stage. Tololo
locomotion, rifle hold, firing origin, RMB camera, and Green Zone gameplay
behavior are untouched (locomotion stays ready-for-review, unaccepted).

## 1. Asset paths, sizes, belonging

All files were supplied locally under `assets/maps/tram/` (which is covered by
the existing `assets/` gitignore rule, so none of this can be committed):

| Path | Size | Role |
| --- | --- | --- |
| `assets/maps/tram/tram_station.glb` | 85,747,364 B (81.8 MB) | Review subject. Self-contained export under test. Original, untouched. |
| `assets/maps/tram/source/tram_station.7z` | 73,280,473 B (69.9 MB) | Source bundle (unpacked listing only, never extracted). |
| `assets/maps/tram/textures/` (40 PNGs) | 147.6 MB total | Converted texture set shipped next to the GLB. Originals, untouched. |

`tram_station.7z` contents (via archive listing, solid LZMA2, 411 MB
uncompressed, 38 files): `tram_station/sourse/tram_station.blend` (46 MB) +
`tram_station.blend1` backup (same bytes) + `tram_station/textures/` (original
TGA/JPG/HDR set, incl. `sky.hdr`, `*.tga` 16–111 MB each). The local
`textures/*.png` set matches these sources converted to PNG (plus PNG-only
`apps_lux.png`, `cherkasy_9_f_appartments.png`, tree PNGs). No `.blend` file
exists outside the 7z: **the BLEND and the GLB belong together as
export + source**, with `textures/` as their shared converted set.

There is NO license file, readme, or attribution text anywhere in
`assets/maps/tram/`.

## 2. Source, credits, license (recorded honestly)

GLB embedded metadata (`asset.extras`, read from the JSON chunk):

- title: `Tram station`
- author: `Randonavt (https://sketchfab.com/Randonavt)`
- license: `CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`
- source: `https://sketchfab.com/3d-models/tram-station-5079604f87084b2db1748193816942b9`
- generator: `Sketchfab-17.26.0`, glTF 2.0, no extensions used/required.

Unknowns (not assumed): the Sketchfab page itself was not fetched, so page-side
license changes, uploader identity beyond the embedded credit, and any
per-model restrictions are unverified. No download availability is treated as
redistribution permission: nothing here is committed, bundled, or published.
IF anything is ever integrated, CC-BY-4.0 requires visible credit to Randonavt
with a license link, and the combined local build still carries the Tololo PMX
non-redistribution restriction (`docs/tololo-art-slice.md`), so no public
release is possible on this branch regardless.

## 3. Blender availability

- `blender` is not installed and not on `PATH` (`where.exe blender` fails).
- No Blender MCP is exposed in this environment.
- The 7z was listed, never extracted; **the BLEND was therefore NOT inspected**
  (no modifier stack, collection, or original-scale verification).
- All audit numbers below come from the GLB JSON chunk plus in-engine
  measurement. The GLB is evaluated as-is.

## 4. GLB audit (unmodified file)

| Property | Value |
| --- | --- |
| Nodes / meshes / primitives | 1525 / 833 (834 after import incl. `__root__`) / 833 |
| Indexed triangles | 612,464 (`totalIndices` 1,837,392) |
| Materials | 54: 39 OPAQUE + 15 MASK (alpha cutout); **all 54 double-sided** |
| Embedded images/textures | 43 / 43, all `image/png`, ~43 MB total; 41× 1024², 1× 512×1024, 1× 512×256, 1× 256×256 |
| External resource refs | none (fully self-contained) |
| Cameras / lights / skins / animations | 0 / 0 / 0 / 0 (nothing to disable; the loader still diffs and disables generically) |
| Node naming | generic Blender export (`Cube.###_#` groups → `Object_#` meshes, `Object_0…` mesh names). **No semantic hierarchy**: doors/benches/platforms/railings are NOT separable objects. |
| Raw accessor bounds (local) | min (−674.9, −52.0, −855.7), max (747.9, 68.0, 855.7) — whole-district span incl. far background |
| World bounds after review offset | X −302.9…+364.8, Z ±417.4, Y 0…~66 (measured post-transform; the raw accessor span is pre-transform) |

Material/texture notes:

- MASK cutout materials (`windows.*`, `Material.04x/05x` family) drive fences,
  tree cards, and window strips. They render correctly under the game's
  daylight rig (see kiosk/track captures); alpha-test edges shimmer slightly
  under SwiftShader at grazing angles — real-GPU check outstanding.
- All-double-sided geometry roughly doubles fragment cost vs single-sided; a
  derived pass could disable backfaces on opaque architecture (not done — source
  untouched, runtime unmodified for the record captures).
- Texture color space: embedded PNGs are treated as sRGB color maps by the
  loader; kiosk signage, perron pavers, grass, and gravel all render with
  plausible albedo (Cyrillic kiosk print fully legible). No normal/roughness
  maps are embedded; sun response is diffuse-only, consistent with the game's
  StandardMaterial world.
- External `textures/` PNG dimensions (header-parsed, no new deps): nearly all
  1024²; building facades 2048² (`cherkasy/pivdennyy/slavutych/t_modular/
  t_monoentrance/supermarket`, ~4–5.5 MB each); `kt_serie*.png` and
  `interior*.png` are **6144²** (27–30 MB and 3–4.6 MB); tree cards
  494×505–2079×3249. The 6144² pair is the single largest transfer weight
  after geometry.

## 5. Preview route (dev-only, isolated)

New/changed code (all inert unless explicitly requested):

- `vite.config.ts` — `tramReviewDevPlugin`: serves
  `/tram-review/tram_station.glb` straight from `assets/` in `vite dev` only.
  `configureServer` never runs for `vite build`, and app code never imports
  the file, so no bundle or `dist/` output can contain it.
- `src/tram-review.ts` (new) — review world, GLB loader with progress,
  probe/trim measurement helpers, named views. Scale stays 1; one documented
  rigid root offset (§6).
- `src/game.ts` — branches to the review world **before** `buildWorld` when
  `?dev=1&scene=tram-review`; `enterTramReview()` (progress toasts + useful
  failure message, flat lane stays playable on failure); `exitTramReview()`
  disposes station + review props; `window.__tramReview` harness hooks.
- `src/main.ts` — autostart enters review mode when `scene=tram-review`.
- `.gitignore` — defensive `public/tram-review/` guard (no such copy exists).
- `scripts/tram-circuit-check.mjs` (`npm run test:tram-review` / `test:tram-circuit`) — full matrix harness.

Launch URL (dev server on 5173; this environment binds IPv6 localhost, so use
`localhost`, not `127.0.0.1`):

```text
http://localhost:5173/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl
```

- Normal play (any URL without `scene=tram-review`) builds the Green Zone
  exactly as before; the harness asserts Green Zone meshes are absent in review
  mode (`walkway`, `relayTower` lookup).
- Both environments are never loaded together (branch precedes `buildWorld`).
- Renderer, Tololo PMX attach, third-person/RMB camera, locomotion, firing
  origin, and Chaser spawns are reused untouched.
- Imported cameras/lights are disabled generically (this asset has none:
  `disabledCameras: 0, disabledLights: 0`).

## 6. Scale, footing, materials — decisions and verification

**Scale = 1 (unmodified), confirmed against four references** with Tololo
(2.35 units) in frame: standard-gauge track spacing vs her stance, ~1.1 m
platform edge height vs her height, canopy columns/benches/kiosk doors at human
size, and apartment/bridge masses consistent at district scale
(`artifacts/tram-scale-tololo.png`, `tram-third-person.png`). No rescaling was
applied and none is needed — the asset is authored in meters.

**Footing offset (review-only transform, GLB untouched):**
`TRAM_REVIEW_OFFSET = (0, −1.8, 0)`. A top-down ray probe grid
(`tramProbeGrid`, 5 m cells, x −60…60, z −20…80) showed the station's south
apron ground plane at local y≈1.8 uniformly (z 40…80 all read 1.8–1.9) and a
10.1 roof/bridge deck over the center (z −10…10). Without the offset Tololo
stood buried to the chest on the apron and under the bridge deck on the rails
(recorded in `tram-scout-*.png` placement series). After the offset, feet sit
on dirt/grass/pavement correctly (`tram-scale-tololo.png`). Uncertainty ±0.1
(apron edge cells read 1.9). Platform tops stay elevated and correctly
inaccessible to the flat controller; the roof moves to ~8.3 clearance.

**Materials/lighting:** zero runtime substitutions — first-comparison rule.
Kiosk print, perron pavers, canopy steel, gravel, and tree cards are
recognizable under the reused hemi+dir daylight rig; Tololo (dark outfit)
reads clearly against dirt/grass but softens against dark green hedges.
Limitation: the review world has no sky dome, so backgrounds are the engine
clear color (black). The Green Zone comparison therefore covers geometry cost,
not sky treatment.

## 7. Playable test route and navigation limits

Validated lane (all y=0, dirt apron south of the platforms, station offset
applied): spawn pad (15, 58) → proxy cover block (19, 50) → open pad, rails at
x=8/22 (z 44…56), end stop (15, 44). AABBs: cover 2.4×2.2×2.4, rails
0.6×1.0×12, stop 16×1.0×0.6. Dummy relay at (0,0,−100) keeps relay logic inert;
four spawn points ring the lane; `bounds: 60`.

Verified: lane walk with live gait (z 58→57.77 in the slow SwiftShader window,
speed 3.54, gait weight 0.67), RMB aim + firing (ammo 30→29, tracer from the
muzzle), 3-Chaser bounded fight staged and rendering, pause-safe, exit
disposes cleanly.

Hard limits (do NOT claim beyond these):

- Station geometry is **scenery-only**: zero per-mesh collision. Rails,
  platform walls, kiosks, hedges, and bridge pillars do not block; the lane
  props are the only colliders.
- Platform tops (~1.1 above lane), track beds, and the bridge deck are
  unreachable without step-up/climb logic (out of scope).
- Camera clearance outside the lane is unvalidated: canopy roofs (~4–5 m over
  platforms), the 8.3 m bridge deck, kiosk walls, and hedges will clip or block
  the third-person camera.
- Bottlenecks spotted but not walkable-tested: N–S rail corridor, under-bridge
  pinch, platform-edge lips (trip/poke-through risk), fenced verges.
- Enemy routing works only on the flat apron; platform/track height variation
  has no nav representation.
- Useful modules spotted (kiosk row, blue canopy runs, perron pavers, benches,
  streetlights, lattice fences) but the generic export hierarchy means they
  must be split in Blender before any reuse — impossible in this environment.

## 8. Performance (SwiftShader WebGL2, 1280×720, cold→warm noted)

Transfer/parse (85.7 MB GLB, localhost): **21.4 s cold / 9.7 s warm** to
scene-ready (`totalMs`; shader compile continues into the first seconds of
rendering). 82 scene textures after Tololo attach (43 embedded station + PMX).

Runtime medians, 3 s rAF samples, same build/harness:

| Scenario | FPS | Frame avg | Active meshes | Active indices | Draws/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tram idle (lane) | 1.1–1.4 | 770–945 ms | 326–333 | 529–570 k | ~320 |
| Tram traversal | 1.3 | 747 ms | 333 | 570 k | 323 |
| Tram 3-Chaser fight | 1.1 | ~1000 ms | 270 | 544 k | 264 |
| Green Zone idle spawn | 7.0 | 151 ms | 103 | 238 k | 111 |

The station costs **~5× frame time** vs the Green Zone: 612 k vs ~119 k
triangles, ~320 vs 111 draws, 834 meshes with zero instancing, all-double-sided
materials, and a 43 MB embedded texture payload behind a 10–21 s load.

**One targeted derived-optimization pass** (measurement only, source
untouched): `tramTrimOutside` disables out-of-region station meshes to simulate
an extracted apron section (keep box x −15…40, z 30…80). Result over 4 s
samples: **20 kept / 814 disabled → 133 ms avg (6.4 FPS), 32 active meshes,
134 k indices, 33 draws** — Green Zone territory. Caveat: bbox-center trimming
also drops giant spanning meshes (e.g. the ground plane whose center lies
outside), so `artifacts/tram-trimmed-apron.png` shows mostly the lane props;
a production extraction would clip geometry properly instead. The experiment
still identifies the cost distribution: ~80% of triangles/draws live outside
any playable section (far apartments, roads, bridge, vegetation walls).

## 9. Captures (all under `artifacts/`, uncut video included)

- `tram-overview.png` — district overview (platforms, canopies, kiosks, bridge, apartments).
- `tram-scale-tololo.png` — Tololo full-body on the apron (scale/footing proof).
- `tram-third-person.png` — live walk toward kiosks/canopy with lane furniture.
- `tram-aim-fire.png` — RMB aim, muzzle-origin tracer, ammo consumed.
- `tram-passage.png` — kiosk close-up (texture legibility proof).
- `tram-combat.png` — 3-Chaser fight on the dirt apron.
- `tram-review-walkthrough.webm` (7 MB) — uncut load → walk → aim/fire → fight.
- `tram-review-report.json` — machine timings/stats/perf of the final run.
- `tram-trimmed-apron.png` — trim-experiment view (measurement context, §8).
- `tram-scout-*.png` — placement process (buried/hedge/bridge misplacements that
  motivated the probe grid and the −1.8 offset).

Captures were inspected in this session except the `.webm`, which was saved
locally and spot-checked via its source frames; full-motion smoothness review
remains with the owner.

## 10. Production-exclusion verification

- No `public/` copy of the station exists; the dev middleware is the only
  serving path and only runs under `vite dev`.
- `vite build` output (`dist/`, 29.7 MB) contains **zero** tram files and zero
  `.glb` files (searched `dist/` for `tram|tololo|mmd|*.glb|*.pmx` names).
- `assets/` (station source) is gitignored; `.gitignore` additionally guards
  `public/tram-review/` against future manual staging mistakes.
- Residual pre-existing finding (NOT introduced here): `dist/mmd/tololo/`
  (PMX + textures) IS packaged by the build because the earlier
  `stage-tololo.mjs` flow stages into `public/mmd/`. That predates this task
  and is left for the Tololo track; this evaluation adds no new packaging.

## 11. Recommendation: option 2 — selected modules, not the whole station

**Use selected modules and props in the existing Green Zone; do not integrate
the whole asset.**

- Fit: meter scale matches, kiosk/canopy/perron/bench/fence pieces suit the
  Green Zone's courtyard language, and a section performs at Green Zone cost
  (§8 trim: 133 ms vs 151 ms baseline).
- Cost of option 1 (whole station): Blender extraction (tool unavailable),
  per-mesh collision/nav authoring across three height levels, camera-clearance
  rework under canopies/bridge, 6144² texture diet, draw-call batching, sky
  integration, and CC-BY attribution plumbing — preparation far exceeding a
  second map's value to the current combat loop, which is tuned to a 132-unit
  arena, not a 700×800-unit district.
- Option 3 (reference only) is the fallback if extraction tooling never
  materializes, but it strands the compatible kiosk/canopy/perron pieces.
- Next step if approved: in Blender, split the kiosk row, one canopy run,
  perron paver set, benches, streetlights, and lattice fences into named
  modules; resize the two 6144² maps to 2048²; single-side opaque architecture;
  re-export each module < 5 MB with external textures; then dress them into
  the Green Zone through the existing `courtyard.ts` pattern with hand-
  authored AABBs. Keep everything else as reference.

## 12. Residual gaps (as of the first evaluation pass)

Real-GPU frame times (closed by §13 on RX 9070); MASK edge behavior at grazing
angles on hardware; exact platform-top heights for any future step-up design;
BLEND internals (collections, modifiers) unverified; `sky.hdr` mood look not
evaluated; webm smoothness acceptance by owner.

## 13. District-preview milestone: full tram district as primary preview

Direction change per owner: pause extracted-module integration into the Green
Zone; instead the **full district is the primary development preview** with a
bounded playable station area. The Green Zone is preserved untouched as the
selectable fallback (default URLs unchanged; all existing harnesses keep
passing). No extraction work existed beyond runtime measurement helpers, which
are retained. At this checkpoint no commit, push, deployment, or publication
had occurred; repository publication was approved after §16.

### 13.1 Local-only packaging fix (was §10 residual)

`dist/mmd/tololo/` in production builds is fixed by construction:

- `scripts/stage-tololo.mjs` now stages into `.local-assets/mmd/tololo/`
  (git-ignored, outside `public/`, so `vite build` cannot copy it).
- `vite.config.ts` middleware serves `/mmd/*` from `.local-assets/` in
  `vite dev` only; missing files fall through to Vite's SPA fallback exactly
  like `public/` serving did (silent placeholder fallback, no console 404s).
- `scripts/check-prod-assets.mjs` (wired into `npm run build`) fails on any
  `mmd/`, `tram-review/`, `tram_station`, `assets/maps/`, `*.glb`,
  `*.pmx|*.pmd|*.vmd|*.vpd|*.blend*|*.7z|*.hdr|*.tga` in `dist/`, or on real
  module imports of raw asset paths in `src/`. Negative-tested (planted PMX →
  FAIL). Clean build: 311 files, OK.
- Verified: `tololo-shots.mjs` passes (fallback with PMX hidden + PMX attach
  through the new middleware); `dist/` contains zero tram/GLB/PMX artifacts.
- `docs/tololo-art-slice.md` staging references updated to `.local-assets/`.

### 13.2 Bounded station combat area (all in `src/tram-review.ts`)

Dirt-apron area ≈ x 2…28, z 42…64, all y=0, entered at spawn (15, 58):

- Relay mast + visible ring (radius 5) at (12, 52): full activate → charge →
  boss-inbound loop verified (`tram-relay.png`, RELAY 2% HUD).
- Cache route (3 spots): kiosk end (6, 57), relay corner (21, 45.5), south
  verge (12, 62.5). Kiosk cache looted in-harness (F prompt + `taken[0]`).
- Kiosk-row fronts as real blocking cover: invisible AABB (x 3…8,
  z 47.5…58.5, h 3.2) on the visible walls — first-pass alignment, holds
  measured (walker stops at x=8.85 from the west).
- Low perimeter rails (0.9 m, dark steel): north z=42, south z=64, west x=2,
  east x=28. Blocks walking, preserves district views; jumpable (documented
  preview limitation, not a vault design).
- Six spawn points in-area; `bossGate` corrected to (24, 56) as data (boss
  spawn code still uses its hardcoded arena gate — the Warden arrives from the
  east in preview; documented, untouched per combat-preservation rule).
- One AABB set drives movement, enemy nav, camera collision, and shooting
  (all four read `world.colliders` — verified in `src/sim.ts`).
- Restart/loop safety: mesh count identical across restart (1087 == 1087),
  caches/relay reset, station never duplicated (`tram-review-report.json`).

### 13.3 Real-GPU baseline (AMD Radeon RX 9070, D3D11, driver 32.0.31041)

Headless Chrome 152 with `--use-angle=d3d11` (no SwiftShader):
`ANGLE (AMD, AMD Radeon RX 9070 … Direct3D11 …)` confirmed via
`WEBGL_debug_renderer_info`. Station transfer+parse: **1.2–1.3 s** (vs
3–21 s software across runs — localhost transfer is instant; the spread is
parse/shader warmup under machine load). Runtime at 1280×720 WebGL2, same
build/harness (software twin in `artifacts/tram-review-report-software.json`:
idle 3.3 FPS / 323 ms, traversal 3.2 / 315 ms, 8-fight 3.2 / 339 ms,
GZ 9.3 / 112 ms):

| Scenario | FPS | Frame avg | Active meshes | Indices | Draws |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tram idle (lane) | 165 | 6.06 ms | 310 | 620 k | 304 |
| Tram traversal | 165 | 6.07 ms | 295 | 563 k | 297 |
| Tram 8-enemy fight | 165 | 6.09 ms | 323 | 708 k | 313 |
| Green Zone idle | 165 | 6.09 ms | 103 | 238 k | 119 |

165 FPS is the rAF/vsync ceiling on this machine: **the full 612 k-triangle,
~300-draw district renders identically to the Green Zone on the target GPU —
no measurable difference, no destructive optimization warranted for preview.**
Composition retained in full. Software-only (SwiftShader) repeatability kept
as the default `GPU_MODE=software` harness path (~5× slower); set
`GPU_MODE=hardware` to reproduce the numbers above. Hardware suitability
beyond this RX 9070 is still pending (one machine, one driver).

### 13.4 Optimization verdict (honest)

Per-frame cost on real hardware needs no work. The remaining costs are
download (85.7 MB), parse (1.3 s GPU / 10–21 s CPU), and VRAM (~43 MB
textures) — none reducible by hiding meshes (stated explicitly in the task
and respected: the trim experiment stays a measurement, not a shipped
mechanism). Any future diet (6144² → 2048² maps, single-sided opaque
materials, far-district sectioning) requires the offline Blender path that
remains unavailable. No such pass is claimed here.

### 13.5 Review artifacts (this milestone)

- `artifacts/tram-review-walkthrough.webm` — uncut: load → lane walk →
  RMB aim/fire → relay activation → cache loot → boundary walk → 8-enemy
  fight → restart. (Video saved from the hardware run.)
- `artifacts/tram-overview.png` — district overview with lane furniture.
- `artifacts/tram-scale-tololo.png` — footing/scale proof on the apron.
- `artifacts/tram-third-person.png` — lane approach toward kiosks/canopy.
- `artifacts/tram-aim-fire.png` — RMB aim, muzzle tracer, ammo consumed.
- `artifacts/tram-passage.png` — kiosk close-up, signage legibility.
- `artifacts/tram-relay.png` — ring + mast + RELAY 2% + boss-inbound toast.
- `artifacts/tram-fight.png` — crowded fight (5 articulated chasers +
  3 runners, damage numbers, reload).
- `artifacts/tram-review-report.json` — machine timings/stats/perf/assertions.
- Preview URL: `http://localhost:5173/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`
  (dev server on 5173; this environment binds IPv6 localhost — use
  `localhost`, not `127.0.0.1`).

### 13.6 Known limitations (preview, not gameplay-ready district)

Platform tops/track beds/bridge deck unreachable; station meshes outside the
lane have no collision; 0.9 m rails are jumpable; Warden spawns east
outside the boundary and walks in; review world has no sky dome (black
background); MASK shimmer at grazing angles unverified on hardware beyond
this run; BLEND internals still uninspected (no Blender).

## 14. Connected playable station circuit (2026-09-09, implementation done, owner visual acceptance pending)

Direction: per milestone brief, the apron, kiosk passage, and one
platform/canopy section are now ONE bounded playable circuit. The full
district stays loaded and untouched (scenery outside the circuit); the Green
Zone remains the default selectable fallback (all GZ harnesses keep
passing). At this checkpoint no commit/push/deploy/publication had occurred.
Tololo scale, grounding, rifle
hold, firing origin, locomotion, RMB behavior, combat balance, and
progression are preserved (verified by re-running the GZ Tololo suites
unchanged — see §14.5).

### 14.1 Station measurements that sized the circuit (in-engine, world-space, post −1.8 offset)

- East platform slab `Object_319`: x 3.4…9.8, z −39.3…39.3, top **1.45**
  (bottom 0.55). West twin `Object_317` mirrored. Only these two slabs in
  the whole district top out at 0.5…2.0 with area > 8.
- Canopy volume `Object_356` over the east platform: y −0.01…5.94 → **4.45 m**
  clearance over the deck (third-person camera at ~2.3 above deck clears it).
- Bridge deck `Object_315`: top **8.28** over z −10.4…10.4 (kept outside the
  circuit; north platform fence at z=18 holds players 8 m clear).
- Kiosk row `Object_1296` (x 7.065…9.675, z 43.9…53.98, h 2.74),
  `Object_1298` (x 7.735…10.345, z 53.95…64.03, h 2.74), east kiosk
  `Object_342` (x 20.1…23.9, z 40.8…47.4, h 3.65). West gap (x<7) is the
  open kiosk passage.
- Apron/track/grass planes at y≈0 across the whole south area: the earlier
  "1.1 m platform" note (§6) does not apply here — the south apron and the
  platform feet share grade; only the two slabs are elevated.

### 14.2 Circuit definition (all in `src/tram-review.ts`)

- Apron rect x 0…26, z 42…64 (y=0): relay ring moved to **(16, 55) r5** so
  the torus clears every kiosk wall; mast at (16, 49.5) on the ring's north
  edge; two concrete cover blocks (22,52) and (5,60); caches at kiosk
  passage (5.5,57) and south verge (14,62.5).
- East platform south section x 3.4…9.8, z 18…39.3 (deck 1.45): deck cache
  at (5,30); two bench blocks (4.6,28) and (8,22) as deck cover (0.55 above
  deck, blocking move/camera/shots); invisible skirt AABBs (y 0…1.5) on all
  slab faces except the ramp mouths.
- Two step-ramps at the slab's south edge (z 39.3→42): ramp A x 4…6, ramp B
  x 7…9, sloped concrete slabs matching the ground lerp.
- Tight invisible AABBs on the three kiosk volumes (cover, camera + shot
  blockers); the old 5×11 m passage-blocking box is gone.
- 2.4 m station-fence perimeter (concrete base + dark steel): apron
  N (z=42, openings only at the ramp mouths) / S / W / E, platform
  W/E/N edges, plus corner closers. 1.3 m jump, dodge slides, and 8–12 m
  Phase Steps all resolve through sub-stepped `moveHorizontalSafe` +
  vertical-span `resolveCircle`, which a 2.4 m wall holds (text-verified).
- Restrained daylight sky dome + horizon haze (gradient/sun-glow technique
  shared with `src/greenzone.ts`, MIT-credited) and GZ-matching exp2 fog;
  the black-background limitation is closed.
- Spawn (14,61) facing the relay/ramps; 6 spawn points (4 apron + 2 deck,
  y from the stage function); in-circuit boss arrival (24,58).

### 14.3 Engine changes (Green Zone byte-identical when tram fns absent)

- `src/world.ts`: `WorldRefs` gains optional `groundHeightAt`,
  `controllerGroundHeightAt`, `bossSpawn`, `playerSpawn`.
- `src/sim.ts`: private `gh`/`cgh` helpers prefer the stage functions;
  all 17 height call sites (player, enemies, boss, skills, orbs, shots,
  telegraphs) route through them; `spawnBoss` uses `world.bossSpawn` with
  the legacy (46,0,2) fallback. Green Zone worlds set none of these, so
  their behavior is unchanged by construction (plus GZ suite re-runs).
- `src/game.ts`: `placeTramSpawn()` re-places inside the circuit after
  `restart()` and `continueLoop()` (both reset to the GZ pad otherwise);
  `enterTramReview` toast updated; `__tramReview` gains `groundAt` for
  text checks.
- `world.bounds` for the circuit is 66 (outer failsafe; the fence is the
  real boundary). Found by measurement: 60 clamps play to z≤59.45 and had
  silently amputated the old lane's own south cache.
- Scripts: `scripts/tram-circuit-check.mjs` is the circuit matrix
  (`npm run test:tram-review` / `test:tram-circuit`); the lane harness is
  preserved as `scripts/tram-review-lane-legacy.mjs` (superseded note, fails
  on the circuit by design at its north-fence expectation).

### 14.4 Verification (`scripts/tram-circuit-check.mjs`, same build/harness both modes)

| Check | Result (identical software + hardware) |
| --- | --- |
| Load (85.7 MB GLB) | 16.0 s SwiftShader / **1.8 s RX 9070** |
| Ground heights | deck 1.45, ramp-mid 0.725, apron 0 |
| Ramp A climb (5,43)→deck | y 1.45 at z≈29 (10 m past the ramp onto the deck) |
| Deck traverse under canopy | holds y 1.45 |
| Sheer face (grade pushing east at x=2) | held x=2.55 (no step-up without ramps) |
| Ramp B descent to apron | y 0 at z≈43.35 |
| Kiosk passage (5,57)→north 3 s | reaches z≈36.4 ON the deck (passage + ramp A in one walk) |
| Hold on deck | main/support ~0, stock 0, barrel 0.0° |
| Relay activate at (16,55) ring | active, boss arrives in-circuit (23.8,58 / 21.4,58) |
| Deck cache loot at deck height | taken[1], opened 1 |
| Jump / dodge / Phase Step at south fence | all held z=63.25 (fence inner face) |
| North platform fence | held z=18.75 |
| 8-enemy apron+deck fight | 8 staged (5 articulated) |
| Relay completion → victory | state victory, charge 1, bossDead |
| Loop continuation | loop 1, playing, spawn (14,61), relay reset |
| Restart | meshes 1121==1121, caches/relay reset, station ready, spawn (14,61) |
| Green Zone absent in review mode | true; scene 1121–1134 meshes |

Regression re-runs (unchanged suites, GZ world): `npm test` 8 files / 50
tests pass; `tsc --noEmit` clean; `npm run build` clean +
`check-prod-assets` OK (311 files, zero tram/GLB/PMX in `dist/`);
`tololo-shots` fallback+PMX attach, walk-into-cover still z=−1.05, camera
clean; `tololo-hold-check` contacts ~0/barrel 0°; `tololo-fire-check`
tracer==muzzle==spawn exact, cover 0.59/0 stops. Full `test:browser` smoke
was NOT re-run in this session (time); sim changes are fallback-identical
for GZ, covered by the suites above.

### 14.5 Performance (same build/harness, 1280×720 WebGL2)

Hardware (AMD Radeon RX 9070, D3D11, headless Chrome): circuit idle
**165.5 FPS / 6.06 ms**, traversal **165.1 / 6.07**, 8-fight **161.6 /
6.21** vs Green Zone idle **164.2 / 6.10** — all pinned at the machine's
~165 rAF/vsync ceiling, i.e. CAPPED measurements: the 612 k-triangle,
~340-draw circuit renders indistinguishably from the Green Zone on the
target GPU; treat deltas as noise, not rankings. One machine/one driver.
Software twin (`artifacts/tram-circuit-report-software.json`): circuit
idle 3.24 FPS / 335 ms, traversal 3.00 / 336, fight 2.63 / 416; GZ idle
8.72 / 115 — SwiftShader only, repeatability reference.

### 14.6 Review artifacts (saved, NOT visually inspected in-session — owner review pending)

Image-budget rule applied: the harness saved stills + uncut video and this
session asserted text only. Do not treat the table above as visual
approval.

- `artifacts/tram-circuit-overview.png`, `-scale.png`, `-platform.png`,
  `-ramp.png`, `-relay.png`, `-fight.png`, `-victory.png`,
  `-circuit.png` (before: `tram-overview.png`, `tram-third-person.png`,
  `tram-aim-fire.png`, `tram-relay.png`, `tram-fight.png` from §13).
- `artifacts/tram-circuit-walkthrough.webm` — uncut hardware-run circuit
  tour (load → climb → deck → descend → passage → relay → fight →
  victory → loop → restart).
- `artifacts/tram-circuit-report.json` (hardware run),
  `artifacts/tram-circuit-report-software.json` (software twin).
- Preview URL: `http://localhost:5173/?dev=1&scene=tram-review&autostart=1&char=tololo&god=1&nolock=1&renderer=webgl`
  (dev server on 5173; binds IPv6 localhost — use `localhost`, and
  `GAME_URL=http://localhost:5173` for scripts whose default is 127.0.0.1).

### 14.7 Residual gaps (circuit, not blockers for review)

Real-GPU evidence is one RX 9070 + SwiftShader repeatability; MASK
cutout shimmer at grazing angles still unverified on hardware; benches
inside the canopy volume have no per-bench visual alignment proof (blocks
are review-only furniture, positions text-verified); enemies cross the
ramps but sustained deck↔apron kiting (5+ min) was not soak-tested;
`test:browser` full smoke not re-run (§14.4); BLEND internals still
uninspected (no Blender); captured stills/video await owner eyes.

### 14.8 Resume checkpoint (exact state for the next session)

- Historical checkpoint: branch `main`, remote
  `https://github.com/IanOliverU/GFL2.git`; all circuit work was uncommitted at
  that time. Repository publication was approved after §16; deployment and
  asset redistribution remain unapproved.
- Modified: `src/world.ts` (WorldRefs optionals), `src/sim.ts` (gh/cgh +
  bossSpawn), `src/tram-review.ts` (circuit world + sky + ground fns),
  `src/game.ts` (placeTramSpawn + groundAt hook), `package.json`
  (tram scripts → circuit check), plus the pre-existing uncommitted
  Tololo-locomotion slice (untouched by this task).
- New: `src/tram-review.ts` members, `scripts/tram-circuit-check.mjs`,
  `scripts/tram-review-lane-legacy.mjs` (renamed + noted),
  `artifacts/tram-circuit-*`, `docs` §14 (this section).
- Scratch from this session still present: `scripts/tram-circuit-probe*.mjs`,
  `scripts/tram-debug-*.mjs` (safe to delete after reading §14.1).
- Re-verify after any touch: `npm test`, `npx tsc --noEmit`,
  `npm run build`, `node scripts/tram-circuit-check.mjs` (default software;
  `GPU_MODE=hardware` for the capped-GPU twin).
- Visual acceptance (gait, hold close-ups, circuit stills/video) remains
  with the owner; Tololo PMX + tram GLB stay git-ignored, dev-served only.

## 15. Tram-circuit correction pass (2026-09-09, implementation done, owner suitability/visual acceptance pending)

Bounded pass only: efficient canopy camera clearance, ordered ramp routing,
shooting regression, comparable performance evidence. At this checkpoint no
commit/push/deploy had occurred; repository publication was approved after §16.
Green Zone, Tololo, gameplay balance, and all uncommitted work preserved.
Tram/PMX assets remain git-ignored, dev-served only, excluded from production
(`npm run build` + `check-prod-assets` OK). Shipping requires an explicit
owner suitability verdict plus visible CC-BY attribution to Randonavt.

### 15.1 Canopy camera: exact build-once BVH (replaces per-frame scene picking)

`Object_356` is one dense perforated canopy/arch submesh (10,028 triangles,
single submesh). The old `tramCameraObstruction()` ran Babylon
`scene.pickWithRay` every render frame (1–2 queries with the opposite-shoulder
fallback), scanning scene meshes plus the full 10,028-triangle submesh.
Coarse proxies were measured and rejected: one tight AABB per disconnected
component (20 boxes) falsely blocked 49/60 scripted shoulder rays and 60.7%
of a dense platform matrix — perforated arches cannot be boxed.

Replacement (`src/tram-review.ts`, dev-only review path): median-split BVH
built once after the station root transform (leaf ≤ 8; 4,095 nodes, 2,048
leaves, ~4.9 tris/leaf; local-space geometry + frozen inverse world matrix;
two-sided Möller–Trumbore with Babylon's 0.001 barycentric edge tolerance;
allocation-free query with a reusable stack). It preserves the existing
platform-origin gate, nearest-hit distance semantics, authored
`world.colliders`, and the opposite-shoulder fallback in `src/sim.ts`
unchanged. `TramReviewStats` gains `cameraTriangles` / `cameraBvhNodes`;
dev-only `__tramReview` gains `cameraDistance` / `cameraDistanceReference`.

Exactness (`scripts/tram-bvh-check.mjs`, headless WebGL2, `cameraDistance` vs
Babylon reference): 60 scripted platform rays plus 2,000 deterministic
pseudo-random camera-domain rays — 0 mismatches, max error 5.83e-7 m
(threshold 1e-4 m). Query cost for the same 500-ray sample: 1.3 ms BVH vs
99.3 ms reference — ~76× faster per query; per-frame camera cost (three
centre/width queries, up to six during a shoulder fallback) is now negligible.

`src/sim.ts` near-wall fix (same pass): the old fixed 0.6 m camera minimum
pushed the camera/crosshair through the K1 face when hugging it (collision
distance < 0.6 m). The clamp now squeezes to the player side
(`hit − 0.05`, min 0.05) instead of crossing the surface; normal 3–6 m
camera distances unchanged.

### 15.2 Routing, shooting, camera probes (automated, text-only)

- Ordered tram links (`src/tram-review.ts`): ramp A
  (5,43.4)→(5,40)→(5,36); ramp B (13,43.4)→(8,43.4)→(8,40)→(8,36).
  Stage-only `enemyNavRadiusCap: 0.7`; combat ranges, separation, speed,
  damage, and Green Zone behavior keep authored values. `Enemy` route state
  + controller-support-height routing in `src/sim.ts`; same-floor jumps no
  longer falsely trigger ramp routing.
- `scripts/tram-routing-check.mjs`: 7/7 pass, zero rescue teleports
  (chaser A-up, chaser B corridor/east-up, heavy B-up, boss B-east-up,
  chaser/heavy B-down); same-floor jump `routed: false`.
- Historical §15 closed-panel build, `scripts/tram-fix-verify3.mjs`
  (`ERRORS: []`): ramp-A axis
  open (234 dmg), ramp-B mouth open (221), north fence blocked (0),
  pursuit-B deck arrival with 0 rescues, deck/apron holds containment
  (jump/dodge/Phase Step south, deck north walk, west walk), camera full
  5.65 m on all close poses.
- Station probe (30 poses, both raw shoulders): 11 genuine obstruction rays
  (arch faces at z≈27.27/27.40/36.38–36.51, longitudinal roof side), 5
  primary-triggered shoulder swaps, all 30 finally selected segments clear
  at ~5.72 m. `scripts/tram-fix-camprobe.mjs`: deck S–N / N–S-aim traverses
  clean (no solid entries, full min distances); apron E–W shows only
  expected kiosk-K2 collider cover (4 samples, zero close-camera samples).
- Normal tram deployment: `Game.startRun()` calls `placeTramSpawn()`
  (duplicate removed from `restart()`).

### 15.3 Comparable performance (identical conditions, NOT a suitability verdict)

New `scripts/tram-comparable-perf.mjs`: same browser/GPU mode, viewport
1280×720, Tololo PMX, zero enemies/caches, relay+3 m gameplay camera, 4 s
equal warm-up, alternating order tram,gz,gz,tram, per-run source hashes.
Software result (`artifacts/tram-comparable-perf-software.json`):
tram 306.8 ms avg / 341 draws / 344 active meshes / 612,690 indices vs
Green Zone 103.1 ms / 91 / 75 / 195,552 — ratios 2.98× frame, 3.75× draws,
4.59× meshes, 3.13× indices. Draw structure is unchanged by the BVH; the
BVH removed the camera-picking CPU overhead while the remaining gap is the
imported station's draw weight (834 meshes, 76 materials, 82 textures,
~612 k triangles; no duplicate import or per-frame mesh creation found).
The circuit harness's internal GZ baseline is a different view and is not
the comparable sample — use the file above.

### 15.4 Ordinary play + circuit re-run (BVH build)

- `scripts/tram-ordinary-session.mjs` (ordinary pointer-lock input, no
  godmode/overrides): ramp B up and down, spawn-cache loot, relay
  activation, boss spawn + damage (2645 → 2411), alive at end. Inspected
  this session: `artifacts/tram-ordinary-platform.png`,
  `tram-ordinary-relay.png`, `tram-ordinary-boss.png`,
  `tram-ordinary-session.webm`.
- `scripts/tram-circuit-check.mjs` (software, this session): all text
  checks pass (ground 1.45/0.725/0, ramp-A climb, deck traverse, sheer
  face hold, ramp-B descent, kiosk passage to deck, deck hold ~0, relay →
  boss in-circuit, deck-cache loot, jump/dodge/Phase holds, north hold,
  8-enemy fight, victory, loop, restart meshes 1129==1129). Perf snapshot:
  idle 374 ms / 349 draws, traversal 392 / 346, 8-fight 412 / 408;
  internal GZ spawn baseline 126 / 112 (different view — see §15.3).
  Captures saved (`tram-circuit-*.png`, `tram-circuit-walkthrough.webm`,
  `tram-circuit-report.json`); full-motion smoothness acceptance remains
  with the owner.
- Full suite (this session): `npm test` 8 files / 50 pass;
  `npx tsc --noEmit` clean; `npm run build` clean + `check-prod-assets`
  OK; `npm run test:browser` isolated pass (pointer lock, 6 kits,
  4 screenshots, 0 errors — the earlier concurrent-run WebSocket 400 was
  a parallel-harness collision, resolved by rerunning alone);
  `git diff --check` clean (LF/CRLF warnings only).

### 15.5 Diagnostic inventory (retain, do not lose work)

Canonical: `scripts/tram-routing-check.mjs` (routing),
`scripts/tram-fix-verify3.mjs` (shooting/containment/camera),
`scripts/tram-bvh-check.mjs` (exact BVH/reference comparison),
`scripts/tram-comparable-perf.mjs` +
`artifacts/tram-comparable-perf-software.json` (comparable perf),
`scripts/tram-circuit-check.mjs` + `artifacts/tram-circuit-report.json`
(circuit). Historical §15 ordinary evidence, superseded by §16's corrected
spawn/layout: `scripts/tram-ordinary-session.mjs` +
`artifacts/tram-ordinary-*`. One-off `tram-camera-station-probe.mjs` and
`tram-fix-*` elevation diagnostics remain local and are not canonical checks.
Failed/retry-heavy — do NOT present as final:
`artifacts/tram-play-*`, `tram-play-out.txt`,
`scripts/tram-fix-playsession.mjs`. Scratch: `scripts/tram-scout.tmp.mjs`.
`§14.8`'s `tram-circuit-probe*` / `tram-debug-*` names do not exist;
the actual scratch set is the `tram-fix-*` list above.

## 16. Open station layout and spawn-camera correction (2026-09-10, owner visual acceptance pending)

Owner feedback on the §15 ordinary recording was confirmed: opaque perimeter
panels boxed the apron, 3 m platform panels read as corridor walls, the spawn
looked back through a cache/relay composition, and frames around 7.5–8.5 s
showed a canopy rib filling the camera despite an exact collision-clear ray.
This correction stays inside the existing x 0…26 / z 18…64 circuit. No map
expansion, characters, animation, balance, progression, aiming controls,
asset bytes, packaging, or deployment changes were made.

### 16.1 Boundary presentation and collision

- Replaced every dominant opaque perimeter/platform panel with an open station
  railing: 0.22 m concrete curb, two 0.12 m horizontal steel bars, and steel
  posts spaced no farther than ~2.6 m. Grade railings rise 1.7 m; platform
  railings start at deck y=1.45 and rise 1.65 m (world top ~3.10).
- Removed the redundant knee-high platform guard that occupied the same edge.
  Rail steel is now muted canopy blue and curbs use darker concrete, avoiding
  the temporary pale-panel appearance. Each segment's steel pieces are merged
  visually after construction; final base scene count is 1121 (previous
  correction build 1129).
- Every visible curb, bar, and post has its own matching AABB. Movement,
  camera, and hitscan queries therefore agree with the presentation: open
  spaces are actually open, while visible bars/posts block at their physical
  height. Continuous bars still overlap the controller body during jump,
  dodge, and Phase Step, including the deck-jump apex. No unexplained full
  invisible boundary remains.
- Solid cover remains only at measured kiosk volumes, relay mast/base, benches,
  and two deliberate apron blocks. The west block moved from (5,60) to
  (19,61), clearing the initial route without adding props.

### 16.2 Spawn composition

- `TRAM_SPAWN_POS = (5,0,53.5)`, yaw 0: Tololo now faces straight north through
  the west kiosk passage and ramp A toward the canopy/platform. Tracks, kiosks,
  both platforms, bridge, and district are visible immediately through the
  railings. Relay mast and south cache are off-axis.
- The initial normal camera converges to (5.90,2.75,59.08), full 5.72 m from
  the pivot and still inside the south boundary. The old spawn at (14,0,61)
  placed the desired camera beyond z=66 and centered the relay/cache cluster.
- Cache 0 moved to (12,0,48.5) and deck cache to (4.4,1.45,20.5), keeping
  objective rewards out of the spawn/platform foreground. No reward count or
  behavior changed.
- `Game.startRun()`, `restart()`, and `continueLoop()` all use the same world
  `playerSpawn`. The circuit check now asserts exact X/Z/yaw, not merely that
  the result is inside the broad circuit.

### 16.3 Canopy framing (existing BVH retained)

The exact §15 canopy BVH and its collision result are unchanged. Camera
selection now samples two additional BVH rays parallel to the center ray at
±0.45 m lateral offset. This approximates lens width, preventing a perforated
arch edge from skimming the lens when the center ray happens to pass through a
hole. The current shoulder is persistent, resets on `startRun`, and switches
only when obstructed and the opposite side gains more than 0.65 m clearance;
this removes per-rib left/right flicker. Distance, pitch/yaw input, normal/RMB
distances, crosshair targeting, and aim controls are otherwise unchanged.

The new ordinary recording makes one stable shoulder change entering the
platform. Six sampled consecutive motion frames keep the nearest rib at the
edge instead of across the target. Normal view retains the route/opposite
platform; RMB records 3.40 m actual smoothed distance (3.2 m authored target,
with movement interpolation), without abrupt near-pivot squeeze.

### 16.4 Focused verification

- `scripts/tram-open-ordinary-traversal.mjs`: PASS. Ordinary title/select/
  deploy, real pointer lock, no godmode or gameplay/position overrides after
  start; spawn → kiosk passage → ramp A/platform → ordinary mouse rotation +
  RMB movement under canopy → ramp A/apron. Simulation 7.27 s; continuous WebM
  10.60 s including UI/load transitions; no browser errors.
- `scripts/tram-routing-check.mjs`: PASS 7/7. Chaser ramp A up; chaser B
  corridor/east up; heavy and boss B up; chaser/heavy B down; zero rescue
  teleports; same-floor jump `routed:false`.
- `scripts/tram-fix-verify3.mjs`: both ramp firing lanes deal damage; visible
  north-railing openings pass shots (with intervening rounds correctly
  striking bars); solid K1 kiosk cover
  blocks completely (0 damage); ramp-B pursuit reaches deck with zero rescues;
  south jump/dodge/Phase Step, north deck, and west boundary hold; all camera
  close poses retain ~5.65 m horizontal distance; `ERRORS:[]`.
- `scripts/tram-circuit-check.mjs` SwiftShader: PASS after making the moved
  deck-cache check data-driven. Ramp A climb, ramp B descent, kiosk passage,
  relay/boss, caches, containment, victory, loop, and restart pass. Loop and
  restart both restore exactly (5,53.5,yaw 0); scene meshes 1121==1121.
- Final suite: `npm test` 8 files / 50 tests pass; `npx tsc --noEmit` clean;
  `npm run build` clean and `check-prod-assets` OK (311 files, no local-only
  assets packaged); Green Zone `npm run test:browser` passes with
  `GAME_URL=http://localhost:5173` (WebGL2, pointer lock, 6 kits, 4 captures,
  0 errors). The first smoke invocation used its default `127.0.0.1` against
  a localhost-only server and failed before app load; the documented URL
  override resolved it without a code change.

### 16.5 Local review evidence

Directly inspected in-session (contact sheets used to limit image-provider
attachments):

- Before: `artifacts/tram-open-before-spawn.png`,
  `tram-open-before-reverse.png`, `tram-open-before-platform.png`.
- After: `artifacts/tram-open-after-spawn.png`,
  `tram-open-after-reverse.png`, `tram-open-after-platform.png`.
- Side-by-side inspection: `artifacts/tram-open-before-after-contact.png`.
- Ordinary traversal endpoints: `tram-open-traversal-spawn.png`,
  `tram-open-traversal-platform-normal.png`,
  `tram-open-traversal-platform-rmb.png`,
  `tram-open-traversal-apron.png`; combined as
  `tram-open-traversal-contact.png`.
- Continuous ordinary recording/report:
  `artifacts/tram-open-ordinary-traversal.webm`,
  `artifacts/tram-open-ordinary-report.json`. The canopy motion interval was
  sampled at 2 FPS in `tram-open-canopy-motion-contact.png` and inspected.

The latest regenerated `tram-circuit-*.png` and diagnostic
`tram-circuit-walkthrough.webm` were not reopened during this pass; their
automated assertions passed, but they are not visual evidence for the owner
feedback. Full real-time smoothness and final visual suitability of the new
ordinary WebM remain owner decisions. Tram/PMX remain local-only and
git-ignored; any shipping still requires the explicit suitability verdict and
visible Randonavt CC-BY-4.0 attribution recorded in §2.
