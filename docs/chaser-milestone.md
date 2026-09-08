# Ordinary Chaser animation and combat-feedback milestone

Status: implemented and mechanically verified; visual acceptance remains with
the owner.

Review question: **Does fighting this animated enemy make the existing combat
feel convincing enough to use this approach for the rest of the roster?**

## Baseline and scope

- Workspace and remote matched the requested project. HEAD was `e7fd85c`.
- A clean HEAD archive passed 34 tests and the production build before this
  slice. Recovery found an interrupted local edit in `src/sim.ts` plus the new
  `src/chaser.ts`; both were preserved and completed.
- Tololo's accepted scale, hold, grounding, synchronous firing origin, RMB
  aim/zoom, controls, damage, cadence, progression, and Green Zone relay rules
  are unchanged. Other enemies and the Berserker boss retain their old visuals.
- No commit, push, deployment, publication, balance change, or hitscan change.

## Local asset audit and provenance

`assets/GFL2 Varjagers/` contains six 250×250 transparent PNG references:

| Reference | File type / size | Runtime use |
| --- | --- | --- |
| Felagi Hagle I | PNG, 250×250 | visual reference only |
| Felagi Kaste | PNG, 250×250 | visual reference only |
| Felagi Lade I | PNG, 250×250 | visual reference only |
| Felagi Medisin I | PNG, 250×250 | visual reference only |
| Felagi Snikskytter I | PNG, 250×250 | visual reference only |
| Berserker | PNG, 250×250 | boss reference only; out of scope |

There are no enemy models, skeletons, animation clips, separate textures,
scale metadata, source files, author statements, or usage/license documents in
that folder. The PNGs therefore were not copied into runtime output, traced as
textures, or treated as authorization to port an outside model.

The runtime Chaser is original Babylon.js geometry in `src/chaser.ts`: an olive
gas-mask trooper with helmet, lenses, gaiter, vest, plate, pack, articulated
arms and legs, boots, and faction-red shoulder marks. It uses no downloaded
asset and no external texture. Vertex-colored rigid pieces are merged per
moving joint; each enemy has its own transform-joint tree, body flash material,
animation state, and a one-mesh distance LOD.
Blender MCP and Playwright MCP were not exposed in this environment. The
project's existing `playwright-core` Chrome harness was used instead.

## Integration and presentation

- The simulation root remains authoritative for position, speed, collision,
  reach, damage, and timing. Joint animation is in-place and has no root motion.
- Boot soles are normalized to local ground zero; the authoritative root uses
  the existing ramp/walkway ground-height controller with no legacy root bob.
- Facing and gait follow voluntary controller movement, not knockback, pulls,
  separation, or stuck recovery; strikes, flinches, and stuns face the player.
- Independent procedural states provide idle breathing/head scan, locomotion
  from measured speed, attack anticipation, damage-event strike, 0.18-second
  non-cancelling hit reaction (including while stunned), stun pose, and a
  0.75-second fall/sink death.
- Strike contact continues from full anticipation at the unchanged damage
  event, extends toward the player, and recovers without a pose snap.
- Elite Chasers retain gold vest/epaulettes, established 1.22 visual scale, and
  one horizontal crown independent of head scan/flinch.
- Restart/loop cleanup disposes per-instance materials and active/death roots.
  Construction is transactional, and a warned legacy-box fallback remains if
  procedural construction fails.
- Near detail is 11 merged articulated meshes (12 for an elite crown), down
  from the initial 27-piece implementation. Beyond 28 units it switches to a
  one-draw-call original trooper silhouette while combat remains authoritative.

The existing melee system has no separate pre-damage wind-up state. To preserve
balance, anticipation visualizes the final approach and the last 0.6 seconds of
the existing cooldown; the strike begins on the unchanged damage event. A
fresh, already-ready enemy that begins inside reach can therefore still have a
very short anticipation. Adding a guaranteed combat wind-up would be a future
balance change, not part of this slice.

Rifle presentation now adds a pooled, short muzzle flash at the authoritative
firing snapshot, pooled impact chips at the hit-volume entry surface, a white
impact core plus larger yellow damage number for critical hits, the existing
hit marker, and the fall/sink death. Saturated spark pools recycle the oldest
chip while the bounded flash pool restarts a matching slot.
Combat, director, progression, and loot use a dedicated simulation PRNG;
effects use a separate cosmetic stream, so Babylon geometry/audio allocation
cannot change gameplay outcomes. Pools are bounded and reset on restart/loop.
No extra screen shake was added.

The browser context menu is suppressed on both the game canvas and game-owned
UI root. Opening an upgrade while RMB is held immediately disables input,
clears both held RMB and simulation ADS, then releases pointer lock. Camera
distance and FOV use the same simulation state. After selection, pointer lock
is reacquired and RMB aim can be pressed and released without sticking. Normal
page surfaces outside those two game roots are not intercepted.

The crossed alpha-plane clouds were disabled after reproducing their dark
silhouettes. The existing gradient sky is the temporary bounded fallback.

## Verification

- Final unit suite: 42 tests in 8 files. New tests cover independent animation
  state, measured-speed settling, anticipation bounds, forward strike/flinch
  layering, damage-event pose continuity, stun/flinch composition, timer
  expiry, and scoped context-menu suppression.
- TypeScript `--noEmit`: clean. Production Vite build: clean.
- Browser smoke: six kits, level-up/attachment/pause/victory/loop/death flows,
  WebGL2 fallback, and the combined real-pointer-lock + held-ADS + level-up +
  release + reacquire path; zero errors.
- Chaser harness: one approach, anticipation, damage-event strike, asserted
  normal hit/flash/impact, asserted critical damage/white core, death cleanup,
  11-enemy crowd, one marked elite, popup RMB cleanup/resume, and restart with
  zero active/death roots, child meshes, joints, or Chaser materials.
- A fixed-seed legacy-versus-articulated construction check produced identical
  speed, attack timer, decision timer, and next-roll values for three enemies.
- A Chaser staged behind the west courtyard barrier steered 1.8 units laterally
  around cover, closed from 6.5 units to melee range, and kept zero visual-root
  error.
- Green Zone traversal: west ramp up, full deck, east ramp down, alley/cache,
  relay, 10 spawn points and six caches; no camera-collider hits. The one
  pre-existing tight spawn remains documented.
- Tololo snapshot/cover harness passed its fallback, PMX attach, cover, and
  camera checks. The older strict `tololo-fire-check` live-anchor comparison
  remains timing-sensitive under SwiftShader (0.091–0.131 unit live-pose drift
  after the shot); this slice's firing record and tracer still use the same
  synchronous snapshot, and the Chaser record captured muzzle
  `(-8.070, 1.935, 5.825)`.

### Comparable performance

Same build and source hash, machine, Chromium build, gradient-sky environment,
1280×720, forced WebGL2 + SwiftShader, Qiongjiu placeholder, fixed positions,
12 ordinary Chasers, and 3-second samples. The harness explicitly switches
only the Chaser visual between legacy and articulated modes:

| Scenario | Legacy boxes | Animated Chasers |
| --- | ---: | ---: |
| stationary FPS / avg ms / p95 ms | 9.51 / 106.28 / 115.10 | 10.20 / 98.18 / 103.00 |
| moving FPS / avg ms / p95 ms | 9.56 / 104.98 / 109.20 | 10.29 / 97.37 / 103.00 |
| active meshes / total meshes | 119 / 394 | 227 / 514 |
| active indices | 300,354 | 160,386 |
| measured draw calls per frame | 124 | 232 |

These software-renderer samples show no measured frame-time regression in this
run, but variance is high. The animated case still adds 108 active meshes and
draw calls for 12 near-detail Chasers. The far LOD bounds distant-crowd cost,
but these counts do not prove real-GPU performance; a real-GPU measurement is
still required before converting the rest of the roster.

## Review artifacts

- Uncut scripted capture: `artifacts/chaser-review.webm`
- Mechanical record: `artifacts/chaser-verification.json`
- Popup RMB capture: `artifacts/chaser-upgrade-rmb.png`
- Key stills: `artifacts/chaser-approach.png`,
  `artifacts/chaser-anticipation.png`, `artifacts/chaser-strike.png`,
  `artifacts/chaser-rifle-hit.png`, `artifacts/chaser-critical-hit.png`,
  `artifacts/chaser-death.png`, `artifacts/chaser-crowd.png`, and
  `artifacts/chaser-crowd-fight.png`
- Perf records: `artifacts/chaser-perf-before.json` and
  `artifacts/chaser-perf-after.json`

This keeps the Green Zone classified as an initial environment pass with final
art acceptance pending. Tololo remains the owner-accepted working gameplay
baseline, with reload/walk/run/dodge animation polish deferred.
