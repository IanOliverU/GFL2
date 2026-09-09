# GFL2 Roguelite: Outpost Relay

A complete single-player browser action-roguelite prototype built with strict TypeScript, Vite, and Babylon.js. Pick one of six data-driven characters, explore the outpost, collect XP and attachments, activate the relay, defeat the Outpost Warden, and either finish the run or continue into a harder loop.

The character kits are original real-time prototype adaptations. No official Girls' Frontline 2 character models or audio are bundled; the current build uses distinct stylized placeholder bodies and weapon silhouettes.

## Run locally

Requirements: Node.js 20+ and a recent desktop Chrome or Edge browser.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Click **Play**, choose a character, click **Deploy**, and click the canvas if the browser asks you to reacquire pointer lock.

Production verification and preview:

```bash
npm test
npm run build
npm run preview
```

The automated browser smoke test expects Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` and a running dev server. Override either location when needed with `CHROME_PATH` or `GAME_URL`.

```bash
npm run test:browser
```

## Controls

| Input | Action |
| --- | --- |
| WASD | Camera-relative movement |
| Mouse | Look and aim |
| Left mouse | Primary fire; hold for weapon cadence |
| Right mouse | Aim/zoom; scope with Mosin-Nagant |
| Space | Jump |
| Shift | Sprint |
| Ctrl | Dodge with brief invulnerability |
| Q / E / R | Skill 1 / Skill 2 / ultimate |
| F | Activate relay or open a nearby cache |
| Tab | Equipment and calculated stats |
| Escape or P | Pause |

Movement and pointer-lock look are owned by the fixed-step simulation. Babylon's built-in `FreeCamera` input controller is deliberately left detached so it cannot double-apply input. Forward, strafe, horizontal-look, and vertical-look polarity can each be changed independently under **Settings**.

## Game loop

- Six selectable characters: Tololo, Qiongjiu, Mosin-Nagant, Sabrina, Peritya, and Vepley.
- One firearm and three distinct active abilities per character, with centralized balance data in `src/config.ts`.
- Four enemy archetypes, elite variants, a budget-based director, and a three-attack boss.
- XP pickups and queued three-choice level-ups. Weapons rank to 8; skills rank to 5/5/3, with behavior milestones.
- Exactly four weapon-compatible attachment slots. Empty slots auto-equip; occupied slots open a paused before/after comparison.
- A handcrafted yard, two elevated-walkway routes, an interior shortcut, exploration caches, relay landmark, and boss arena.
- Victory requires both full relay charge and boss defeat. Continue Loop retains the build, raises pressure, resets the encounter, and restocks caches.
- Local settings and best-run records, synthesized audio, pause/focus-loss safety, WebGPU preference, and automatic WebGL2 fallback.

## Architecture

- `src/game.ts` — renderer setup, game states, fixed-step orchestration, modal queues, restart/loop transitions.
- `src/sim.ts` — player, combat, abilities, enemies, director, pickups, relay, and pooled effects.
- `src/chaser.ts` — original articulated ordinary-Chaser visual and pure procedural pose kernel.
- `src/tololo-visual.ts` — local-only PMX fit, rifle hold/IK, synchronous weapon pose, and velocity-driven procedural locomotion.
- `src/config.ts` — characters, weapons, skills, progression tuning, attachments, enemies, and boss data.
- `src/controls.ts` / `src/input.ts` — camera-relative control math and pointer-lock input lifecycle.
- `src/world.ts` — deliberate stage construction, ground routing, collision, and ray queries.
- `src/ui.ts` / `src/style.css` — title, selection, HUD, equipment, level-up, comparison, pause, and end screens.
- `src/audio.ts` — persisted settings and failure-tolerant synthesized sound effects.
- `src/assets.ts` — centralized GLB registry and placeholder fallback.
- `src/rules.ts` / `src/progression.ts` — pure, unit-tested combat and progression rules.

The simulation runs at 60 Hz with bounded catch-up. Bullets use hitscan/spatial queries rather than per-shot rigid bodies; enemy projectiles, tracers, pickups, and damage text are pooled or capped. Enemy decisions are staggered, population is capped, and proc depth is bounded.

## Replacing placeholder characters

1. Put a character GLB under `public/assets/glb/`.
2. Update its path, clip names, offsets, and `placeholderOnly` flag in `src/assets.ts`.
3. In the loader integration, parent the imported model to the simulation's player root, then verify scale, forward axis, grounding, weapon placement, and every available animation clip.
4. Keep the placeholder fallback: a missing or malformed GLB must log a useful warning without blocking the game.

## Development shortcuts

Shortcuts are enabled only with `?dev=1`: `K` kills active enemies, `L` grants XP, `B` spawns the boss, and `C` advances the relay encounter. `?dev=1&autostart=1&char=mosin&god=1` starts a deterministic test run. Add `&renderer=webgl` to force the fallback or `&nolock=1` for automation.

## Current limitations

- Placeholder character geometry has no authored animation clips. The local-only Tololo PMX review slice has procedural armed locomotion, and the ordinary Chaser has procedural idle, locomotion, attack, hit, and death; other characters and enemies retain their milestone placeholders.
- Sound is synthesized in Web Audio rather than sourced from authored audio files.
- Collision and navigation use a lightweight controller, AABBs, ground-height routing, and obstacle steering instead of Havok/navmesh. This keeps the build dependency-light and deterministic for the handcrafted map.
- The target 12–15 minute first run is a balance goal. Actual duration varies with accuracy, exploration, and time spent inside the relay ring.
- WebGPU is attempted when the browser exposes it; environments without a working adapter fall back to WebGL2.

## Verification

`npm test` covers progression, attachment math and compatibility, shotgun damage splitting, bounded proc chains, objective gating, run transitions, stuck-input cleanup, and directional control math. `npm run test:browser` starts every character, casts all 18 abilities, fires every weapon, exercises traversal, level-up/equipment/pause flows, resolves victory and loop continuation, tests death/retry/title return, checks WebGL2 fallback, and captures screenshots under `artifacts/`.

The ordinary-Chaser provenance, animation/feedback integration, performance
comparison, review artifacts, and remaining acceptance gate are recorded in
`docs/chaser-milestone.md`. With the dev server running, use
`npm run test:chaser-review`; for the same-build A/B in PowerShell, set
`$env:PERF_TAG="before"` or `"after"` before `npm run perf:chaser`.

Tololo's local-only locomotion architecture, verification matrix, same-build
performance comparison, review artifacts, licensing constraints, and remaining
owner acceptance gate are recorded in `docs/tololo-locomotion-milestone.md`.
With the staged PMX and dev server running, use
`npm run test:tololo-locomotion` and `npm run perf:tololo`.
