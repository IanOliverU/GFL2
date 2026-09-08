# Tololo — owner-accepted working gameplay baseline

Scale, hold, grounding, firing origin, RMB aim/zoom, movement, and camera
behavior are the accepted working baseline. Final art-direction acceptance is
still pending, and reload/walk/run/dodge animation polish remains deferred.

Review question: **Does Tololo belong in this environment, and should the rest of the game follow this visual direction?**
Visual acceptance is pending reviewer approval. Do not commit, push, or deploy any part of this slice.

## 1. Source information (preserved, never modified, never committed)

- Source tree (git-ignored): `assets/Character MMD/Tololo (Default)/`
- Model: `GirlsFrontline TololoDefault.pmx` (2,670,878 bytes, PMX 2.0, 30,905 vertices)
- Creators (from PMX header): Model created by Sunborn Network Technology; rigged and fixed by DesmondChan.
- Textures: `Textures/` (8 PNGs + `normalmap/` with 3 PNGs), `spa/` (13 toon/sphere helpers).

## 2. Permissions — UNRESOLVED, restrictive

PMX header text (verbatim):

> GirlsFrontline TololoDefault — 请勿二次配布 (no redistribution) —
> 请勿用于18禁作品，极端宗教宣传，血腥恐怖猎奇作品，人身攻击等
> (no adult / extreme-religious / gore-horror / personal-attack works) —
> 请勿用于商业用途 (no commercial use) —
> Model Created by Sunborn Network Technology, rigged and fixed by DesmondChan.

Consequences enforced by this workflow:

- Original PMX/textures stay under git-ignored `assets/` and are never committed.
- Staged runtime copies under `public/mmd/` are git-ignored local-only files.
- No derived GLB/VMD/output is committed until explicit approval.
- Current use is local prototype review only (non-commercial, non-redistributed).
- A clean-room or licensed replacement is still required before any release.

## 3. Texture inventory (measured, full resolution kept)

PMX-referenced (all present, verified by `scripts/stage-tololo.mjs`):

| File | Size | Referenced as |
| --- | --- | --- |
| `Textures/c_TololoSSR01_slg_body_d.png` | 2048×2048 | body diffuse |
| `Textures/c_tololossr01_slg_cloth1.png` | 2048×2048 | cloth diffuse 1 |
| `Textures/c_tololossr01_slg_cloth2.png` | 2048×2048 | cloth diffuse 2 |
| `Textures/c_Tololo_slg_face_d.png` | 1024×1024 | face |
| `Textures/c_Tololo_slg_eye_d.png` | 512×512 | eyes |
| `Textures/c_Tololo_slg_eyeblend_d.png` | 256×256 | eye blend |
| `Textures/c_Tololo_slg_hair_d.png` | 2048×2048 | hair (alpha) |
| `Textures/extra.png` | 2048×2048 | extra detail |
| `spa/hd.png` | 500×500 | sphere map |
| `spa/toon-1.bmp` | toon | toon shading |
| `spa/shinetest3.png` | 256×256 | specular helper |
| `spa/Socks.png` | 128×128 | sphere map |
| `spa/spa-1.bmp` | sphere | sphere map |

Not referenced by the PMX (kept in source, not staged separately):

- `Textures/normalmap/c_TololoSSR01_slg_body_n.png` (and cloth1/cloth2 `_n`) — no PMX material points at them; reserved for a future GLB/baked path.
- `spa/gold2.png`, `spa/Metal.png`, `spa/red.png`, `spa/Yellow.png`, `spa/T_Satin_J 1.png`, etc. — unused helpers.

Deliberately no blanket 512 px downscale: face (1024), eyes (512), and hair/body/cloth (2048) stay at authored resolution for this visual review. If load size becomes an issue, resize per-texture after inspection, never blindly.

## 4. Materials and weapon

PMX materials include BodySkin, Clothing (×several), Jacket, Skirt, Socks, Face, EyeWhite, Eyes, Eyes+, EyeShadow, Hair (×several), Emotion. **No weapon, gun, or rifle geometry exists in the PMX** (string scan for weapon/gun/rifle: absent).

- Material substitutions: none. Rendering uses babylon-mmd's MMD material pipeline (diffuse + toon + sphere), so authored shading is preserved.
- Weapon: a clearly identified placeholder rifle (`TOLOLO_PLACEHOLDER_RIFLE`) is attached to a named `WeaponMount` node with a `Muzzle` child node. Combat math is untouched — `Simulation.muzzlePos()` remains the authority; the `Muzzle` node is visual-only.

## 5. Import workflow (repeatable, engine unchanged)

babylon-mmd 1.3.0 is already a dependency and its peer (`@babylonjs/core ^9.15.0`) is satisfied by the pinned 9.25.0 — no engine change. No existing babylon-mmd integration existed, so this slice introduces the smallest viable one:

1. `node scripts/stage-tololo.mjs` copies the source tree to `public/mmd/tololo/` (local-only, git-ignored), renames the PMX bytes to URL-safe `tololo.pmx`, and verifies all 13 referenced textures.
2. `src/assets.ts` loads the staged PMX at runtime with babylon-mmd (`LoadAssetContainerAsync`), fits scale from the measured bounding box, grounds the root at the simulation position, and parents it to the player's `playerMesh` node.
3. Failure (missing/staged-corrupt PMX) logs a warning and keeps the stylized placeholder — gameplay is never blocked.
4. No MMD animation/physics runtime is started in this slice (bind pose only); full animation production is explicitly out of scope.

### Why direct PMX instead of GLB export

Exporting PMX→GLB would require: baking toon/sphere shading into PBR (look change), converting the MMD bone system (Japanese-named bones, IK, append-transforms) into a GLB skin with baked constraints, resolving `spa/*.bmp` sphere maps into emissive/roughness channels, re-authoring hair alpha, and re-validating all morphs. That is lossy and one-way. Direct PMX loading keeps materials and rigging intact and is reversible, so it is the correct vehicle for a visual-direction review.

## 6. Green Zone courtyard test (references inspected)

Sources: `GreenZone-1920px-BG_Green_DisuseBuild_Day_01.png` (weathered concrete, pipes/electrical boxes, red barrel, yellow scaffold, harsh daylight), `GreenZone-1920px-BG_Green_City_Street_Day_01.png` (teal painted-metal walkway, wet reflective asphalt, warm signage accents), `GreenZone-1920px-BG_Green_Sewage_Day_01.png` (massive concrete waterworks, railings, moss, hazard striping).

The test dresses the existing stage in place (`src/courtyard.ts`, called from `buildWorld` — no map expansion, no topology change):

- One weathered-concrete façade treatment on the existing shortcut building (panels, pipes, electrical boxes, warm window strip).
- Teal painted-metal canopy echoing the City Street walkway.
- Asphalt dressing from spawn toward the relay.
- Two purposeful cover blocks with real colliders (spawn points re-validated).
- Directional daylight kept; warm accents are emissive-only (no extra dynamic lights).

## 7. Output paths (all local-only until approved)

- Staged model: `public/mmd/tololo/tololo.pmx` (byte-identical rename of the source PMX) + `Textures/`, `spa/` (git-ignored).
- Served at: `/mmd/tololo/tololo.pmx` (dev server only).
- Required views: `artifacts/tololo-front.png`, `artifacts/tololo-side.png`, `artifacts/tololo-back.png`, `artifacts/tololo-gameplay.png`.
- Inspection extras: `artifacts/tololo-face.png` (face/eyes/hair close-up), `artifacts/tololo-fallback.png` (placeholder fallback proof).
- Repeatable captures: `scripts/tololo-shots.mjs` (fallback + attach + 4 views + collision, asserts zero page/console errors).

## 8. Validation results (measured, headless Chrome, SwiftShader WebGL2, 1280×720)

- Unit: `npm test` 5 files / 20 tests pass. Typecheck `tsc --noEmit` clean. `npm run build` clean (babylon-mmd splits into lazy chunks: mmdModelLoader.pure ~46 KB, pmxLoader.pure ~12 KB — loaded only on Tololo runs).
- Browser: `npm run test:browser` passes — 6 kits, 18 skills, traversal/level-up/compare/pause/victory/loop/retry/title, 0 errors.
- Tololo: `scripts/tololo-shots.mjs` passes — fallback verified with staged file hidden (placeholder body visible, state playing); PMX attaches in 0.9–2.5 s wall (13.4 MB local); scene meshes 328 (334 with combat pools); idle fps 65–73, 24–31 while walking into cover with the director active.
- Orientation: front camera shows the face, rear camera shows hair/back — `TOLOLO_YAW_OFFSET = PI` corrects the bind pose to face the aim direction (verified, was backwards at 0).
- Grounding/scale: feet on the ground plane in all views; 1.9-unit fit reads naturally against crates, door gaps, and the relay ring.
- Collision: walking north into the new x=5 cover barrier stops at z=-1.05 (barrier face -1.6 + controller radius — never enters); gameplay camera never inside any collider.
- Materials: all 13 PMX-referenced textures request and return 200; meshes carry diffuse + toon + sphere maps. Face/eyes/brows/mouth, hair alpha layering, jacket/skirt/thigh-highs/boots all verified in `tololo-face.png`.
- Combat math untouched: `Simulation.muzzlePos()` remains the shot authority; `WeaponMount`/`Muzzle` are visual-only. Placeholder rifle parts are named `PLACEHOLDER_RIFLE_*`.

## 9. Material/lighting limitations

- babylon-mmd builds `StandardMaterial`-based MMD materials (toon + sphere), matching the world's existing StandardMaterial pipeline — no PBR mismatch, but look for toon banding under the strong dir+hemi rig on real GPUs (SwiftShader only so far).
- One stray `GET /mmd/tololo/Textures/` directory probe returns 200 HTML and is handled as an error texture (harmless, no console error). It comes from an empty texture reference in the PMX; silencing it needs a resolver tweak, deferred.
- Hair alpha is cutout-correct at review distance; strand-level sorting artifacts may appear at extreme close-ups (not tested).

## 10. Remaining issues (not blockers for visual review)

1. Bind-pose A-pose arms; no animation runtime yet (explicitly out of scope — next step).
2. Placeholder rifle floats at the hip (no hand IK/grip pose); slightly long in side profile. Clearly identified; replace with authored AK-Alfa later.
3. Death feedback on the PMX visual is a rigid tilt mirror only (no death pose/clip).
4. Spare-root parking keeps ≤3 hidden Tololo copies in rapid-restart churn (test harness only); steady gameplay holds exactly one. Never disposed mid-load by design (see below).
5. Loader lesson recorded: `babylon-mmd/esm/Loader/mmdModelLoader` MUST be imported for the default material builder (geometry imports material-less without it), and `registerDxBmpTextureLoader` is required for the `spa/*.bmp` toon/sphere maps.
6. Loader race recorded: disposing a root while its async PMX textures stream crashes in `mmdAsyncTextureLoader` (`errorTextureDatas` of undefined). Fixed via single-flight import + spare parking + reuse (`takeSpareTololo`/`parkTololoSpare`); rapid `startRun` churn in the smoke suite passes.
7. Baseline screenshots (`title`, `gameplay`, `victory`, `mobile-select`) were regenerated by the smoke suite and now show the courtyard dressing + rifle — expected consequence of this slice, flagged for review.
8. Real-GPU check (WebGPU preferred path, discrete-GPU fps) and pointer-lock play feel are still unverified beyond headless SwiftShader.

## 11. Scale / mount / camera correction (measured)

Actual cause of the reported undersize + floating rifle: the fit measured
`mesh.getBoundingInfo()`, which babylon-mmd pads by `boundingBoxMargin`
(default 10 PMX units per side). Measured live:

- Padded tallest mesh: y −10..27 (37 units) → scale 1.9/37 ≈ 0.0475.
- TRUE vertex-data bounds: ~20 raw units tall → true rendered height was
  **0.95 m with feet hovering +0.47 m**, and the chest-height rifle mount
  (y 1.35) floated above her head. This exactly reproduces the report
  (dwarfed by the 2.6 m heavy, rifle silhouetted against it).
- No double scaling exists: `playerMesh` scale is [1,1,1]; the single
  normalizing scale lives on the visual root.

Correction (no blind multipliers — every number below is measured):

- Fit now scans raw vertex positions × import-time world matrices (no
  margin): `src/tololo-visual.ts`. Sanity guard warns if raw height leaves
  the 10–30 unit band (this model ≈ 20).
- Target height **2.35**, anchored to the placeholder silhouette the world
  was tuned against (capsule top 1.85, head top ~2.375, camera pivot
  pos.y+1.9, doors 4.5, crates 2.0–2.8, enemies 1.3–4.4). Verified against
  the temporary rig (placeholder twin + 0.55 m tick pole + r=0.55 footprint
  disc + rooted heavy): `artifacts/scale-before-rig.png` →
  `artifacts/scale-after-rig.png` — head levels match the twin and the
  ~2.35 m pole mark; feet at 0.00 (raw PMX min.y ≈ 0, lift now 0.000).
- Rifle now seats at the FK-measured **left** wrist
  (player-local (−0.70, 1.51, −0.06), mount (−0.70, 1.46, −0.16), inward
  cant +0.17): the `playerMesh.rotation.y = yaw + PI` flips local x, so
  player-local −x renders on world +x — the shot-line side. An earlier
  right-wrist attempt put the visual muzzle 0.91 from the shot origin;
  after mirroring, visual muzzle vs `Simulation.muzzlePos()` measures
  **0.23 units** (dx 0.20, dy 0.06, dz 0.10) — tracers visibly leave the gun
  tip (`artifacts/tololo-firing.png`, ammo 27/30). Combat math untouched.
- Static arm posing was attempted and is PROVEN blocked without the MMD
  animation runtime: bones carry quaternions, `rotation`/`rotate()` writes
  plus `skeleton.prepare()` produce no matrix or visual change (skin matrices
  are runtime-uploaded; bind pose renders from loader-initialized data).
  Consequence: low-carry at the hanging hand, no hand IK. A true two-hand
  hold pose needs the deferred animation step (`MmdRuntime` + physics
  decision) — recorded, not smuggled in.
- Camera: NO change. Dist 5.6 / pivot pos.y+1.9 / aim zoom were tuned for
  the 2.375 placeholder; with Tololo at 2.35 the framing is identical by
  construction (`artifacts/tololo-gameplay.png`), threats stay visible, and
  camera collision is re-verified (walk-into-cover stops at z=−1.05, camera
  never inside a collider). Zoom was not used to hide scale.
- State continuity: idle/move/aim/fire/dodge sequence keeps pos.y = 0,
  root scale constant 0.1175, state playing, ammo 30→27 — no scale or
  position jumps. (Dodge squash and run bob still animate the hidden
  placeholder body only — pre-existing slice limitation.)
- Genuine pre-existing quirks FLAGGED, not changed: (a) the shared hip
  mount sits gun-right while the shot line is shots-left (~0.75 apart) for
  all placeholder characters — gameplay-neutral, invisible in practice;
  (b) heavy/boss eye spheres sit inside body geometry (visible only at some
   angles); (c) controller collider spans pos.y+0.2..+1.6 while both visuals
   reach ~2.35 — a gameplay-tuned abstraction, unchanged per scope.

## 12. Procedural animation runtime (2026-09-08, unapproved)

Prior state (§11): static bone writes were ignored — nothing uploaded skin
matrices without an animation runtime. Resolved with a physics-disabled
`MmdModel` per loaded root (`src/tololo-visual.ts`): each frame the game
writes `linkedBone.rotationQuaternion` for the hold set, then
`model.beforePhysics(null)` + `model.afterPhysics()` recomputes
`worldTransformMatrices` (append-twist + IK solved there). No VMD/clips;
all motion is procedural. One shared `MmdRuntime` per scene (creation only);
parked spares keep their models, overflow destroys via
`destroyMmdModel` (textures settled by then).

- Rig: 409 bones, `buildPhysics: false`, all 4 IK solvers disabled for
  deterministic FK. Bone names are standard MMD Japanese
  (左腕/左ひじ/左手首, 右腕/右ひじ/右手首, 上半身/上半身2/首/頭, センター…).
- Proof (headless, text): resetting 左腕 to identity for one synchronous
  update moves the 左手首 skin matrix by 2.7–3.2 model units — posing is
  mechanically live. Game loop re-poses the next frame.
- Hold: absolute per-frame pose — arms forward/inward, elbows flexed,
  wrists level, slight torso lean; breathing sway, speed-blended arm swing,
  torso/head pitch tracking, recoil kick scaled by `Simulation.gunRecoil`,
  reload lean, dodge crouch. Legs: slight stance + soft knees (IK off);
  grounded stepping deferred until the hold direction is approved.
- Axis-sign correction: first guess swung arms backward (wrists measured at
  player-local z=−0.48). Model faces −Z at rest, so forward = +rotX; all
  pitch-plane signs flipped. Wrists now at z=+0.49, mount centered
  (0.01, 1.74, 0.49) between grips.
- Weapon: `alignRifleToHands` seats `WeaponMount` at the wrist midpoint
  (bias 0.5, `tololoPoseParams.mountBias`) with grip-line yaw + look pitch.
  Replaces the fixed left-wrist offset. Combat math untouched.
- Measured headless (SwiftShader, 1280×720): 328 scene meshes, ~35 fps with
  the pose tick, walk-into-cover still stops at z=−1.05, pos.y=0 steady,
  zero page/console errors. `npm test` 6 files / 25 tests pass (new
  `tests/tololo-pose.test.ts`), `tsc --noEmit` + `npm run build` clean.
- Open item: visual muzzle vs authoritative `muzzlePos()` gap is 0.63
  (was 0.23 with the wrist workaround) — the shoulder-height hold sits
  ~0.3 above the chest-height shot line with barrel overshoot. Expected
  next tuning after capture review (lower `shoulderFwd`, deepen elbow bend).
- Captures for manual review (NOT visually verified by the agent):
  `artifacts/tololo-hold-front.png`, `artifacts/tololo-hold-side.png`,
  `artifacts/tololo-hold-gameplay.png`. Repeatable:
  `node scripts/tololo-anim-check.mjs` (text assertions only).

## 13. Static rifle-hold correction (2026-09-08, status: READY FOR REVIEW)

Visual review FAILED the §12 hold (open palms, floating weapon). Recording:
animation-runtime proof COMPLETE; two-handed hold INCOMPLETE, corrected
below, all dynamics OFF pending hold approval. The mesh remains the labeled
`PLACEHOLDER_RIFLE_*` stand-in — no authentic weapon model is claimed.

- Dynamics disabled: `tololoHoldMode.static = true` gates breathing, arm
  swing, recoil, reload lean, and dodge offsets. The legacy layered pose
  (`poseTololo`/`alignRifleToHands`) is dormant but intact for later
  individual restoration.
- Anchors (`src/sim.ts`, mount-local): MainGrip (0,−0.14,0.35, mag grip),
  SupportGrip (0,0.02,0.42, receiver over the mag — the barrel mid-point is
  beyond her reach, placeholder limitation), StockContact (0,0.06,−0.58,
  stock rear face), Muzzle (0,0.08,1.45, barrel tip, pre-existing).
- Anatomy (measured, not assumed): bind wrists at player-local x −0.70
  (左) / +0.70 (右); −X renders world +X at yaw 0 = anatomical left of a
  character facing world −Z. So 右手首 drives MainGrip, 左手首 the fore-end,
  stock at the anatomical right shoulder. Handedness was NOT chosen for the
  legacy (left-side) shot line — that quirk is bypassed by the muzzle
  override below, with tracers still spawning at the real tip.
- Authority (no circularity): weapon pose ← right-shoulder pocket + aim
  pitch; both arms ← weapon anchors via analytic two-bone IK
  (`tololoSolveTwoBoneIk`, unit-tested); fingers are static curls
  (finger segment rotZ + thumb set, signs provisional). Reach found the
  support 0.90 ahead of the shoulder vs 0.67 arm reach — fixed by the
  receiver support anchor + tucked pocket, with margin kept for upward aim.
- Palm-aware contacts: contact = wrist + H·palmLocal (palmLocal = 45% of
  wrist→middle-tip at bind, rotated by the chosen hand orientation), so
  wrist origins are never mistaken for grip points. Debug markers
  (`?mark=1`): green/blue/orange/red anchor spheres, yellow/white contact
  spheres.
- Measured headless: contacts exact (~0) at level/down/up aim, no IK
  clamping anywhere, stock weld exact, barrel-vs-look angle 0.0° at all
  three pitches, firing consumes ammo with contacts held, zero
  page/console errors. `tololo-shots.mjs` still passes (fallback,
  attach, cover stop z=−1.05, camera clean). `npm test` 31/31, `tsc` +
  `build` clean.
- Muzzle discrepancy resolved HONESTLY: `Simulation.muzzlePos()` returns
  the per-frame barrel-tip world position (`muzzleOverride`, cleared on
  run end/visual detach) when the hold drives it, else the legacy
  formula. Only the ray START moved (legacy sat 0.63–1.12 from the tip,
  worst aiming up); direction is still recomputed muzzle→camera-aim-point
  at every call site, so damage, cadence, spread, range, and wall/enemy
  tests are unchanged. No tracer-only masking: tracers originate at the
  same corrected point the damage rays do.
- Agent's own capture inspection: right glove wraps the mag grip, left
  palm sits under the receiver at the support anchor, stock enters the
  shoulder, head clears the receiver in front/side/quarter views; rear
  gameplay view is largely occluded by her hair (observation, not a hold
  defect); a bright yellow box in close-ups is a distant enemy weak
  point, confirmed absent within 2 units of the gun line. Finger-level
  wrap is below capture resolution and the sleeve cuff flares at the
  right wrist (bind cloth) — for the reviewer to judge.
- Views (local only, verdict reserved for the reviewer):
  `artifacts/tololo-hold-front.png`, `-side.png`, `-overhead.png`,
  `-grip-side.png`, `-grip-quarter.png`, `-gameplay.png`,
  `-markers.png`, `-markers-grip.png`. Harness:
  `node scripts/tololo-hold-check.mjs`. Status: READY FOR VISUAL REVIEW.

## 14. Firing-origin investigation (2026-09-08, status: READY FOR REVIEW)

Gameplay captures showed tracers disconnected from the barrel (long vertical
beams ground→target). Static hold (§13) preserved as baseline; dynamics stay
OFF. No commit/push/deploy per instructions.

- Identified cause (code, not guessed): `tickTololoStaticHold` kept the
  mount position in shared scratch `_e`, which `solveHoldArm` reuses
  internally — the muzzle computation then read a clobbered unit direction
  instead of the mount position, sending `muzzleOverride` to near ground
  level. Every shot spawned at the ground while the visible barrel stayed
  at the shoulder: exactly the reported picture.
- Fix: dedicated `_mountPos` scratch plus `tololoWeaponPose` as the single
  source of truth for the held weapon transform, shared by the visual tick
  AND a synchronous fire-time computation. `Simulation.muzzlePos()` now
  recomputes the barrel tip from the CURRENT (pos/yaw/pitch) each call, so
  shots can never observe a previous frame's pose; the per-frame override
  remains as fallback (rest unmeasured, transitions), then the legacy
  formula. Initialization/detach paths fall back identically (override
  cleared on run end and visual detach).
- One-snapshot audit: `firePrimary` snapshots one `muzzle` Vector3 per shot
  shared by hit detection and tracers; pooled tracer meshes receive COPIES
  (`mid`/`len`), never live references. Babylon `add`/`subtract` return new
  vectors (only `InPlace`/`ToRef` mutate), so multi-pellet loops cannot
  corrupt the snapshot. Enemy shots are independent pooled objects.
  Per-shot debug ring (`sim.shotLog`, id/step/frameMs/muzzle/aim/dir/
  tracer endpoints) backs the harness; `sim.stepCount` correlates ticks.
- Parallax note: barrel-parallel-to-look is not the aim — shots use
  muzzle→camera-aim-point, already correct by construction for near and far
  targets; the fix only moved the honest start point. Measured barrel-vs-
  look angle 0.0° at level/up/down (shared pitch source by design).
- Measured (`scripts/tololo-fire-check.mjs`, isolated rank-1 primary fire,
  hostiles cleared, spawns held): stationary tracer-start==spawn==muzzle==
  anchor (0.000); turning (6 shots) and moving bursts per-shot exact; aim
  up/down exact (one 0.056 read-vs-log jitter, under the 0.08 gate);
  firing consumes ammo normally. Matched firing-frame evidence:
  `artifacts/tololo-fire-frame.png` shows the frozen beam leaving the
  barrel tip (log: tracerA==muzzle to 0.000, endpoints at the struck
  crate). Tracers are instant full-length beams (0.07s life), not
  traveling projectiles — the harness freezes them (fast 5ms shot
  detection) purely for capture determinism.
- Cover (`bN-L` solid segment; x=0 is a door gap, verified in world.ts):
  nose-to-wall tracer stops AT the face (0.59–0.61 long), muzzle-inside-
  volume yields a zero-length tracer (slab raycast returns 0 from inside),
  kills unchanged — no through-wall fire. Damage, rate, spread, range
  rules untouched (only the ray start moved, to the visible tip).
- Forensics side-note: the bright yellow box on the receiver in close-ups
  is the placeholder STOCK's orange accent material under the strong
  rig, confirmed by body-hidden/weapon-hidden isolation captures — not a
  marker, tracer, or defect. Markers verified hidden in clean runs.
- Hands (§13 req 7): unchanged by this fix — firing moves neither pose
  nor contacts (dynamics off; hold-check contact errors still ~0 while
  firing). Right glove on the mag grip, left palm under the receiver,
  stock seated, head clear, per the §13 views plus the new firing frame.
  Finer finger/sleeve work awaits the review verdict, not more blind
  tuning.
- Views: `artifacts/tololo-fire-frame.png` (beam on barrel tip),
  `-plus1.png`, `-aimup.png`, `-cover.png` (wall-stop). Status: READY FOR
  VISUAL REVIEW — statics alone were never claimed as firing proof.
