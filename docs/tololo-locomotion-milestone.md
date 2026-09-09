# Tololo locomotion milestone

Status: **ready for owner visual review; not visually accepted**.

Review question: **Does Tololo now move naturally enough while holding, aiming,
and firing her rifle to serve as the animation foundation for the game?**

Do not commit, push, deploy, publish, or redistribute this local review slice.
The PMX permissions and replacement requirement in `docs/tololo-art-slice.md`
remain unchanged.

## Scope delivered

- Armed idle with restrained lower-body weight sway.
- Forward walk with a continuous distance-driven stride.
- Speed-blended run/sprint with longer steps and deeper swing-leg knee flexion.
- Shorter, restrained backward steps.
- Left/right strafe and diagonal blends from facing-relative resolved motion.
- Smooth acceleration, stopping, and direction reversal without phase resets.
- Normal gait suppression while airborne or dodging.
- Grounded controller alignment on the yard, ramps, and walkway without root motion.
- Wall-stop and wall-slide behavior driven by post-collision displacement.

Reload, jump, dodge, hit, and death animation production remains deferred. The
current milestone only provides safe transitions out of normal grounded gait.

## Asset and tool audit

- No authored Tololo VMD or compatible locomotion clip is present.
- The staged PMX contains the standard MMD lower-body bones used here, but all
  imported IK solvers remain disabled; dormant MMD IK was not blindly enabled.
- Blender was not installed or available on `PATH` (`BLENDER_NOT_FOUND`).
- Blender MCP and Playwright MCP were not exposed in this environment.
- Browser review uses the repository's `playwright-core` dependency and local
  Chrome instead.
- No restricted source PMX, texture, staged runtime copy, or derived animation
  asset was modified or added to source control.

## Runtime design

`Simulation.visualVel` is presentation-only. Each fixed step derives it from
the player's actual horizontal position delta after `moveHorizontalSafe`, so a
blocked input resolves to zero and a collision slide resolves to its tangent.
It does not feed gameplay movement, collision, dodge distance, or combat.

`stepTololoLocomotion` projects that velocity onto Tololo's facing-relative
forward/right axes, smooths starts/stops/direction changes, and advances one
continuous stride phase from resolved speed. Long render deltas are capped at
50 ms for pose stability. Airborne and dodge states target zero gait weight.

Bone ownership is deliberately narrow:

| Owner | Bones/state |
| --- | --- |
| Controller | Player root position/yaw, collision, grounding, jump, dodge |
| Locomotion | `下半身`, thighs, knees, ankles, toes |
| Accepted hold | Torso, head, shoulders, arms, wrists, fingers |
| Weapon authority | `tololoWeaponPose`, `Simulation.muzzlePos()`, muzzle-to-aim direction |

`センター` remains identity and locomotion never translates the visual or
gameplay root. The accepted shoulder-pocket weapon transform and analytic
two-arm hold are unchanged. This keeps the rifle stable rather than introducing
unrepresented torso/weapon bob.

## Verification

Run with a Vite server on port 5173:

```bash
npm test
npx tsc --noEmit
npm run build
npm run test:tololo-locomotion
npm run perf:tololo
node scripts/tololo-hold-check.mjs
node scripts/tololo-fire-check.mjs
npm run test:browser
node scripts/gz-traverse.mjs
```

The locomotion browser matrix checks idle, forward, reverse, strafe, diagonal,
sprint, moving RMB aim/fire, airborne, dodge, frontal wall-stop, boundary-wall
slide, Phase Step, pause, restart, and pooled-rig reuse. Representative resolved
results from the final run:

| State | Result |
| --- | --- |
| Forward | local forward `7.01` |
| Reverse | local forward `-6.94` |
| Strafe | local right `7.01` |
| Diagonal | forward/right `4.96 / 4.96` |
| Sprint | local forward `9.42` |
| RMB aim-walk | local forward `3.81` |
| Airborne | gait weight faded to `0.20` |
| Dodge | gait weight faded to `0.22` |
| Wall stop | resolved velocity `0`, gait weight approximately `0` |
| Wall slide | resolved local forward `0.001`, right `5.07` |
| Phase Step | `8.0` units moved, no locomotion spike (`6.77` current speed) |

Across every matrix snapshot, right/left hand and stock contact errors remained
effectively zero, barrel-to-look error remained approximately `0°`, and the
live visible muzzle matched synchronous `Simulation.muzzlePos()` to the check's
numeric precision.

## Performance

`npm run perf:tololo` uses the same loaded model, fixed world/camera pose, and
identical visible geometry. It alternates baseline and locomotion order and
reports medians from four 4-second samples under headless Chrome, forced WebGL2,
and SwiftShader at 1280x720.

| Scenario | Static baseline | Locomotion | Frame-time delta |
| --- | ---: | ---: | ---: |
| Idle median | 115.45 ms | 111.28 ms | -3.6% |
| Moving median | 114.80 ms | 112.62 ms | -1.9% |

Both modes rendered 103 active meshes, 238,146 active indices, 380 total meshes,
and 119 draw calls per frame. The negative deltas are measurement noise, not an
expected speedup; the result establishes no measurable regression in this
software-rendered environment. Real-GPU profiling remains a residual gap.

Detailed samples are in `artifacts/tololo-perf.json`.

## Review artifacts

- Uncut matrix video: `artifacts/tololo-locomotion-review.webm`
- Still sequence: `artifacts/tololo-locomotion-idle.png` through
  `artifacts/tololo-locomotion-restart.png`
- Existing grip and firing evidence remains under `artifacts/tololo-hold-*.png`
  and `artifacts/tololo-fire-*.png`.

Automated checks establish state correctness, continuity, collision response,
weapon contact, muzzle authority, and performance. They cannot decide whether
the gait has the desired authored character quality. That acceptance remains
with the owner after reviewing the uncut clip at normal playback speed.
