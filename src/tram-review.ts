// Tram-station district preview (dev-only local evaluation, never shipped).
//
// Source asset (untouched, git-ignored assets/maps/tram/tram_station.glb):
// "Tram station" by Randonavt (https://sketchfab.com/Randonavt), licensed
// CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/), via
// https://sketchfab.com/3d-models/tram-station-5079604f87084b2db1748193816942b9
// (Sketchfab export, embedded metadata verified; page-side terms not fetched).
// Modifications here are runtime-only (root offset, review-world props,
// measurement helpers) — the GLB bytes are never altered, and nothing under
// this module may enter a commit, build, or publication without the owner's
// explicit suitability verdict plus visible CC-BY attribution.
//
// The GLB is served in `vite dev` only by middleware in vite.config.ts (no
// public/ copy, never imported, never bundled). Normal gameplay always builds
// the Green Zone; the district loads only when ?dev=1&scene=tram-review is
// explicitly requested, and the two environments are never loaded
// simultaneously (Game.init branches before buildWorld).
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { ISceneLoaderProgressEvent } from "@babylonjs/core/Loading/sceneLoader";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Light } from "@babylonjs/core/Lights/light";
import type { WorldRefs } from "./world";

/** Dev-server URL for the unmodified source GLB (dev middleware only). */
export const TRAM_REVIEW_URL = "/tram-review/tram_station.glb";
/** On-disk source (untouched reference for docs). */
export const TRAM_REVIEW_SOURCE_GLB = "assets/maps/tram/tram_station.glb";
/**
 * Uniform scale applied to the imported station root. 1 = unmodified GLB for
 * the first suitability pass. Any fitted value must be derived from several
 * architectural references (doors/benches/platforms/railings) and documented
 * in docs/tram-station-evaluation.md — never blind bbox fitting.
 */
export const TRAM_REVIEW_SCALE = 1;
/**
 * Review-only rigid offset applied to the station root (GLB untouched).
 * Measured by top-down ray probe (see docs/tram-station-evaluation.md): the
 * station's ground plane sits at local y≈1.8 across the whole south apron, so
 * the root is lowered by 1.8 to place dirt/plaza walking surfaces at
 * controller height (y=0). Platform tops stay elevated (correctly
 * inaccessible to the flat controller); the central roof moves 10.1→8.3.
 * Uncertainty ±0.1 (probe cells read 1.8–1.9 at the apron edges).
 */
export const TRAM_REVIEW_OFFSET = new Vector3(0, -1.8, 0);

/**
 * Connected playable station circuit (all measurements world-space, post
 * offset; mesh bounds verified in-engine, see checkpoint in
 * docs/tram-station-evaluation.md §14):
 * - East platform slab Object_319: x 3.4…9.8, z −39.3…39.3, top y=1.45.
 *   Playable south section z 18…39.3 under the blue canopy (roof ~5.9,
 *   4.45 m clearance over the deck — third-person camera clears it).
 * - South dirt apron: y=0, bounded x 0…26, z 42…64.
 * - Two step-ramps join the platform's south edge (z=39.3) to the apron
 *   fence line (z=42): ramp A x 4…6, ramp B x 7…9.
 * - Kiosk row (Object_1296/1298: x ~7…10.3, z 43.9…64, h 2.74) and the east
 *   kiosk (Object_342: x 20.1…23.9, z 40.8…47.4, h 3.65) are tight-collider
 *   cover; the west gap (x<7) is the kiosk passage.
 * - Relay ring moved to (16, 55) r5 so the torus clears all kiosk walls;
 *   caches sit on the kiosk passage, the platform deck, and the south verge.
 */
export const TRAM_PLATFORM_TOP = 1.45;
export const TRAM_PLATFORM = { x0: 3.4, x1: 9.8, z0: 18, z1: 39.3 };
export const TRAM_RAMPS = [
  { x0: 4, x1: 6, z0: 39.3, z1: 42 },
  { x0: 7, x1: 9, z0: 39.3, z1: 42 },
];
export const TRAM_APRON = { x0: 0, x1: 26, z0: 42, z1: 64 };
export const TRAM_RELAY_POS = new Vector3(16, 0, 55);
export const TRAM_RELAY_RADIUS = 5;
/** Safe spawn: SW apron pad with a walk-up view of relay, kiosks, ramps. */
export const TRAM_SPAWN_POS = new Vector3(14, 0, 61);
export const TRAM_SPAWN_YAW = 0;
/** In-circuit boss arrival (east apron, clear of kiosks/ring/fences). */
export const TRAM_BOSS_SPAWN = new Vector3(24, 0, 58);

/** Stage ground height: platform deck, ramp lerps, else apron grade. */
export function tramGroundHeightAt(x: number, z: number): number {
  if (x >= TRAM_PLATFORM.x0 && x <= TRAM_PLATFORM.x1 && z >= TRAM_PLATFORM.z0 && z <= TRAM_PLATFORM.z1) {
    return TRAM_PLATFORM_TOP;
  }
  for (const r of TRAM_RAMPS) {
    if (x >= r.x0 && x <= r.x1 && z > r.z0 && z < r.z1) {
      return TRAM_PLATFORM_TOP * (r.z1 - z) / (r.z1 - r.z0);
    }
  }
  return 0;
}

/**
 * Controller selection: the 1.45 m platform face cannot be stepped up from
 * grade (ramps provide the gradual path); stepping/dropping OFF the deck is
 * always allowed (falls are safe, landing grade is in-circuit or fenced).
 */
export function tramControllerGroundHeightAt(x: number, z: number, currentY: number): number {
  const h = tramGroundHeightAt(x, z);
  if (h >= TRAM_PLATFORM_TOP - 0.01 && currentY < 0.75) return 0;
  return h;
}

export function isTramReviewRequested(search: URLSearchParams): boolean {
  return search.get("dev") === "1" && search.get("scene") === "tram-review";
}

export interface TramReviewTimings {
  startMs: number;
  firstProgressMs: number | null;
  doneMs: number;
  totalMs: number;
  loadedBytes: number;
  totalBytes: number | null;
}

export interface TramReviewStats {
  meshCount: number;
  materialCount: number;
  textureCount: number;
  totalIndices: number;
  approxTriangles: number;
  disabledCameras: number;
  disabledLights: number;
  boundsMin: Vector3;
  boundsMax: Vector3;
}

export interface TramReviewLoad {
  root: TransformNode;
  meshes: AbstractMesh[];
  materials: Material[];
  textures: BaseTexture[];
  aux: Mesh[];
  stats: TramReviewStats;
  timings: TramReviewTimings;
}

function reviewMat(scene: Scene, name: string, c: Color3, e?: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = c;
  if (e) m.emissiveColor = e;
  m.specularColor = new Color3(0.08, 0.08, 0.1);
  return m;
}

/**
 * Restrained daylight sky dome + horizon haze for the district preview.
 * Gradient + sun-glow GLSL approach adapted from "A Letter to Summer" by
 * Eren Ciracioglu (MIT, rev c3f762f) — same technique as src/greenzone.ts,
 * reimplemented for this review-only world. Keeps the full district
 * composition daylit instead of floating on the engine clear color.
 */
function buildTramSky(scene: Scene): void {
  const sunDir = new Vector3(-0.5, 0.62, 0.35);
  const skyMat = new ShaderMaterial("tram-review-sky", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
    fragmentSource: `precision highp float;
      varying vec3 vDir;
      uniform vec3 sunDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 top = vec3(0.19, 0.47, 0.75);
        vec3 horizon = vec3(0.83, 0.90, 0.91);
        vec3 c = mix(horizon, top, smoothstep(0.0, 0.6, d.y));
        c = mix(vec3(0.55, 0.60, 0.62), c, smoothstep(-0.15, 0.02, d.y));
        float glow = pow(max(0.0, dot(d, normalize(sunDir))), 24.0);
        c += vec3(1.0, 0.85, 0.6) * glow * 0.55;
        float haze = 1.0 - smoothstep(0.0, 0.28, abs(d.y - 0.03));
        c = mix(c, horizon, haze * 0.45);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }, { attributes: ["position"], uniforms: ["worldViewProjection", "sunDir"], needAlphaBlending: false });
  skyMat.setVector3("sunDir", sunDir);
  skyMat.backFaceCulling = false;
  const dome = MeshBuilder.CreateSphere("tram-review-sky", { diameter: 760, segments: 4 }, scene);
  dome.material = skyMat;
  dome.isPickable = false;
  dome.infiniteDistance = true;
}

/**
 * Connected playable station circuit (review-only world on the south apron +
 * the east platform's south section under its canopy). One AABB set serves
 * player movement, enemy navigation, camera collision, and shooting alike
 * (all read `world.colliders`):
 * - apron rect (x 0…26, z 42…64, y=0) with the relay ring, mast, 2 concrete
 *   cover blocks, and caches on the kiosk passage + south verge;
 * - east platform south section (x 3.4…9.8, z 18…39.3, deck y=1.45) with one
 *   deck cache and two bench blocks, skirted so the 1.45 m face blocks
 *   walking/shots except at the ramps;
 * - two step-ramps (x 4…6 and 7…9, z 39.3…42) as the only deck connections;
 * - tight invisible AABBs on the visible kiosk walls (cover that preserves
 *   the west kiosk passage);
 * - 2.4 m station-fence perimeter (concrete base + dark steel) closing every
 *   other side so jump (1.3 m), dodge slides, and 8–12 m Phase Steps cannot
 *   leave for unsupported scenery (all three move via sub-stepped
 *   moveHorizontalSafe + vertical-span resolveCircle, which a 2.4 m wall
 *   holds against).
 * The full district composition stays loaded and untouched (scenery-only
 * outside the circuit); the Green Zone fallback is a separate branch.
 */
export function buildTramReviewWorld(scene: Scene): WorldRefs {
  const colliders: WorldRefs["colliders"] = [];
  const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void => {
    colliders.push({
      min: new Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      max: new Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    });
  };
  // Restrained daylight atmosphere (same values as the Green Zone rig so the
  // district reads as one city, not a night diorama; review world had black).
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0032;
  scene.fogColor = new Color3(0.78, 0.86, 0.89);
  scene.clearColor.set(0.78, 0.86, 0.89, 1);
  buildTramSky(scene);
  const ground = MeshBuilder.CreateGround("tram-review-ground", { width: 240, height: 240 }, scene);
  ground.position.y = -0.02;
  ground.material = reviewMat(scene, "tramReviewGroundM", new Color3(0.42, 0.41, 0.38));
  ground.receiveShadows = true;

  // Station-coherent materials (concrete, dark steel, platform paver red,
  // bench timber). No teal/orange proxy emissives remain.
  const concreteMat = reviewMat(scene, "tramReviewConcreteM", new Color3(0.52, 0.53, 0.55));
  const steelMat = reviewMat(scene, "tramReviewSteelM", new Color3(0.16, 0.18, 0.22));
  const paverMat = reviewMat(scene, "tramReviewPaverM", new Color3(0.55, 0.32, 0.28));
  const timberMat = reviewMat(scene, "tramReviewTimberM", new Color3(0.45, 0.33, 0.2));

  // Step-ramps: sloped concrete slabs matching the ground-height lerp, with
  // paver nosing. Visual only for physics (heights come from
  // tramGroundHeightAt); side cheeks are visual, falling off mid-ramp lands
  // safely on grade inside the fence line.
  for (let i = 0; i < TRAM_RAMPS.length; i++) {
    const r = TRAM_RAMPS[i]!;
    const cx = (r.x0 + r.x1) / 2;
    const len = r.z1 - r.z0;
    const slab = MeshBuilder.CreateBox(`tram-review-ramp-${i}`, {
      width: r.x1 - r.x0, height: 0.3, depth: Math.hypot(len, TRAM_PLATFORM_TOP) + 0.4,
    }, scene);
    slab.position = new Vector3(cx, TRAM_PLATFORM_TOP / 2 - 0.1, (r.z0 + r.z1) / 2);
    slab.rotation.x = Math.atan2(TRAM_PLATFORM_TOP, len);
    slab.material = concreteMat;
    slab.receiveShadows = true;
    const nose = MeshBuilder.CreateBox(`tram-review-ramp-nose-${i}`, {
      width: r.x1 - r.x0, height: 0.12, depth: 0.35,
    }, scene);
    nose.position = new Vector3(cx, TRAM_PLATFORM_TOP - 0.02, r.z0 + 0.1);
    nose.material = paverMat;
  }

  // Platform skirt faces (invisible AABBs on the visible slab sides, y 0…1.5):
  // block step-up walking and horizontal shots through the deck except at
  // the ramp mouths. Above-deck actors skip them by vertical span.
  addBox(3.3, 0.75, 28.65, 0.4, 1.5, 21.3); // west face x=3.4
  addBox(9.9, 0.75, 28.65, 0.4, 1.5, 21.3); // east face x=9.8
  addBox(6.6, 0.75, 18, 6.8, 1.5, 0.4); // north face z=18
  addBox(3.7, 0.75, 39.3, 0.6, 1.5, 0.4); // south face, west of ramp A
  addBox(6.5, 0.75, 39.3, 1.0, 1.5, 0.4); // south face, between ramps
  addBox(9.4, 0.75, 39.3, 0.8, 1.5, 0.4); // south face, east of ramp B

  // Platform benches (concrete feet + timber seat, 0.55 above deck): cover
  // that blocks movement/shots on the deck, clear of the ramp lanes.
  const bench = (name: string, cx: number, cz: number): void => {
    const gy = TRAM_PLATFORM_TOP;
    const seat = MeshBuilder.CreateBox(name, { width: 1.8, height: 0.12, depth: 0.6 }, scene);
    seat.position = new Vector3(cx, gy + 0.5, cz);
    seat.material = timberMat;
    for (const dx of [-0.7, 0.7]) {
      const foot = MeshBuilder.CreateBox(`${name}-foot-${dx}`, { width: 0.18, height: 0.45, depth: 0.55 }, scene);
      foot.position = new Vector3(cx + dx, gy + 0.22, cz);
      foot.material = concreteMat;
    }
    addBox(cx, gy + 0.27, cz, 1.8, 0.55, 0.6);
  };
  bench("tram-review-bench-0", 4.6, 28);
  bench("tram-review-bench-1", 8.2, 23);

  // Kiosk walls as tight invisible cover (measured mesh bounds, §14):
  // K1 south (Object_1296) + K2 mid (Object_1298) + K3 east (Object_342).
  // The west gap (x<7) stays the open kiosk passage to ramp A.
  addBox(8.37, 1.37, 48.94, 2.61, 2.74, 10.08); // K1
  addBox(9.04, 1.37, 58.99, 2.61, 2.74, 10.08); // K2
  addBox(22.0, 1.82, 44.1, 3.8, 3.65, 6.6); // K3 east

  // Apron cover: two concrete blocks flanking the relay approaches.
  const coverBlock = (name: string, cx: number, cz: number): void => {
    const m = MeshBuilder.CreateBox(name, { width: 2.2, height: 2.0, depth: 2.2 }, scene);
    m.position = new Vector3(cx, 1.0, cz);
    m.material = concreteMat;
    m.receiveShadows = true;
    const cap = MeshBuilder.CreateBox(`${name}-cap`, { width: 2.3, height: 0.18, depth: 2.3 }, scene);
    cap.position = new Vector3(cx, 2.05, cz);
    cap.material = steelMat;
    addBox(cx, 1.0, cz, 2.2, 2.0, 2.2);
  };
  coverBlock("tram-review-cover-0", 22, 52);
  coverBlock("tram-review-cover-1", 5, 60);

  // 2.4 m station-fence perimeter (concrete base + dark steel above): every
  // circuit side is closed except the two ramp mouths. Tall enough that the
  // 1.3 m jump, dodge slides, and sub-stepped Phase Steps cannot strand
  // players in the unvalidated district beyond.
  const fence = (name: string, cx: number, cz: number, sx: number, sz: number): void => {
    const base = MeshBuilder.CreateBox(`${name}-base`, { width: sx, height: 0.5, depth: sz }, scene);
    base.position = new Vector3(cx, 0.25, cz);
    base.material = concreteMat;
    const topH = 1.9;
    const top = MeshBuilder.CreateBox(name, { width: Math.max(0.25, sx - 0.1), height: topH, depth: Math.max(0.25, sz - 0.1) }, scene);
    top.position = new Vector3(cx, 0.5 + topH / 2, cz);
    top.material = steelMat;
    addBox(cx, 1.2, cz, sx, 2.4, sz);
  };
  // Apron north fence (z=42) with ramp-mouth openings at x 4…6 and 7…9.
  fence("tram-review-fence-n0", 2, 42, 4, 0.4);
  fence("tram-review-fence-n1", 6.5, 42, 1, 0.4);
  fence("tram-review-fence-n2", 17.5, 42, 17, 0.4);
  fence("tram-review-fence-s", 13, 64, 26, 0.4); // south
  fence("tram-review-fence-w", 0, 53, 0.4, 22); // west
  fence("tram-review-fence-e", 26, 53, 0.4, 22); // east
  // Platform west/east/north fences ride the slab edges (base y0, top 2.4).
  fence("tram-review-fence-pw", 3.4, 30, 0.4, 24);
  fence("tram-review-fence-pe", 9.8, 30, 0.4, 24);
  fence("tram-review-fence-pn", 6.6, 18, 6.8, 0.4);
  // Corner closers: west strip x0…3.4 and east pocket x9.8…26 at z≈40.6.
  fence("tram-review-fence-cw", 0, 40.65, 0.4, 2.7);
  fence("tram-review-fence-cw2", 1.7, 40.65, 3.4, 0.4);
  fence("tram-review-fence-ce", 26, 40.65, 0.4, 2.7);
  fence("tram-review-fence-ce2", 17.9, 39.3, 16.2, 0.4);

  // Relay mast + visible ring at the architecture-integrated position.
  const relayPos = TRAM_RELAY_POS.clone();
  const relayRadius = TRAM_RELAY_RADIUS;
  const mastBase = MeshBuilder.CreateBox("tram-review-relay-base", { width: 1.6, height: 0.6, depth: 1.6 }, scene);
  mastBase.position = new Vector3(16, 0.3, 49.5);
  mastBase.material = concreteMat;
  addBox(16, 0.3, 49.5, 1.6, 0.6, 1.6);
  const mast = MeshBuilder.CreateCylinder("tram-review-relay-mast", { height: 6, diameter: 0.8 }, scene);
  mast.position = new Vector3(16, 3.6, 49.5);
  mast.material = reviewMat(scene, "tramReviewMastM", new Color3(0.25, 0.3, 0.4), new Color3(0.1, 0.14, 0.2));
  addBox(16, 3.6, 49.5, 0.8, 6, 0.8);
  const tip = MeshBuilder.CreateSphere("tram-review-relay-tip", { diameter: 0.9 }, scene);
  tip.position = new Vector3(16, 7.0, 49.5);
  tip.material = reviewMat(scene, "tramReviewTipM", new Color3(1, 0.7, 0.3), new Color3(1, 0.55, 0.15));
  const ring = MeshBuilder.CreateTorus("relayRing", { diameter: relayRadius * 2, thickness: 0.35, tessellation: 64 }, scene);
  ring.position = new Vector3(relayPos.x, 0.25, relayPos.z);
  ring.material = reviewMat(scene, "tramReviewRingM", new Color3(1, 0.7, 0.3), new Color3(0.9, 0.5, 0.12));

  // Cache route woven into the architecture: kiosk-passage cache, platform
  // deck cache (rewards the climb), south-verge cache.
  const cacheMat = reviewMat(scene, "tramReviewCacheM", new Color3(0.32, 0.35, 0.38));
  const glowMat = reviewMat(scene, "tramReviewCacheGlowM", new Color3(0.4, 1, 1), new Color3(0.3, 0.9, 1));
  const cacheSpots = [new Vector3(5.5, 0, 57), new Vector3(5, 0, 30), new Vector3(14, 0, 62.5)];
  const caches: WorldRefs["caches"] = cacheSpots.map((p, i) => {
    const gy = tramGroundHeightAt(p.x, p.z);
    const m = MeshBuilder.CreateBox(`tram-cache-${i}`, { width: 1.6, height: 1.2, depth: 1.6 }, scene);
    m.position = new Vector3(p.x, gy + 0.6, p.z);
    m.material = cacheMat;
    const glow = MeshBuilder.CreateSphere(`tram-cacheGlow-${i}`, { diameter: 0.7 }, scene);
    glow.position = new Vector3(p.x, gy + 1.8, p.z);
    glow.material = glowMat;
    return { pos: new Vector3(p.x, gy, p.z), taken: false, mesh: m, glow };
  });

  const spawnPoints = [
    new Vector3(14, 0, 61), new Vector3(5, 0, 50), new Vector3(20, 0, 60),
    new Vector3(5, 0, 30), new Vector3(8, 0, 24), new Vector3(18, 0, 48),
  ].map((p) => new Vector3(p.x, tramGroundHeightAt(p.x, p.z), p.z));
  return {
    colliders,
    caches,
    relayPos,
    relayRadius,
    relayRing: ring,
    towerMeshes: [],
    spawnPoints,
    bossGate: TRAM_BOSS_SPAWN.clone(),
    // Outer failsafe only (the 2.4 m fence line is the real boundary): 66
    // matches the Green Zone so the south verge (z=64 fence) is reachable —
    // bounds clamps to ±(bounds − radius), and 60 would amputate z>59.45.
    bounds: 66,
    walkwayTop: TRAM_PLATFORM_TOP,
    groundHeightAt: tramGroundHeightAt,
    controllerGroundHeightAt: tramControllerGroundHeightAt,
    bossSpawn: TRAM_BOSS_SPAWN.clone(),
    playerSpawn: { pos: TRAM_SPAWN_POS.clone(), yaw: TRAM_SPAWN_YAW },
  };
}

/** Load the unmodified station GLB with progress; imported cameras/lights stay disabled. */
export async function loadTramReviewStation(
  scene: Scene,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<TramReviewLoad> {
  await import("@babylonjs/loaders/glTF");
  const { SceneLoader } = await import("@babylonjs/core/Loading/sceneLoader");
  const timings: TramReviewTimings = {
    startMs: performance.now(), firstProgressMs: null,
    doneMs: 0, totalMs: 0, loadedBytes: 0, totalBytes: null,
  };
  const camerasBefore = new Set<Camera>(scene.cameras);
  const lightsBefore = new Set<Light>(scene.lights);
  const materialsBefore = new Set<Material>(scene.materials);
  const texturesBefore = new Set<BaseTexture>(scene.textures);
  const progress = (ev: ISceneLoaderProgressEvent): void => {
    if (timings.firstProgressMs === null) timings.firstProgressMs = performance.now();
    timings.loadedBytes = ev.loaded ?? timings.loadedBytes;
    timings.totalBytes = ev.total ?? null;
    onProgress?.(timings.loadedBytes, timings.totalBytes);
  };
  const result = await SceneLoader.ImportMeshAsync("", "/tram-review/", "tram_station.glb", scene, progress);
  timings.doneMs = performance.now();
  timings.totalMs = timings.doneMs - timings.startMs;

  const root = new TransformNode("tram-review-root", scene);
  for (const m of result.meshes) {
    if (!m.parent) m.parent = root;
  }
  root.scaling.setAll(TRAM_REVIEW_SCALE);
  root.position.copyFrom(TRAM_REVIEW_OFFSET);

  let disabledCameras = 0;
  for (const cam of scene.cameras) {
    if (!camerasBefore.has(cam)) { cam.setEnabled(false); disabledCameras++; }
  }
  let disabledLights = 0;
  for (const light of scene.lights) {
    if (!lightsBefore.has(light)) { (light as Light).setEnabled(false); disabledLights++; }
  }
  const materials = scene.materials.filter((m) => !materialsBefore.has(m));
  const textures = scene.textures.filter((t) => !texturesBefore.has(t));
  let totalIndices = 0;
  const boundsMin = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const boundsMax = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const m of result.meshes) {
    const mesh = m as Mesh;
    try { mesh.computeWorldMatrix(true); } catch { /* best effort */ }
    if (typeof mesh.getTotalIndices === "function") totalIndices += mesh.getTotalIndices();
    try {
      const bb = mesh.getBoundingInfo?.()?.boundingBox;
      if (bb) {
        boundsMin.minimizeInPlace(bb.minimumWorld);
        boundsMax.maximizeInPlace(bb.maximumWorld);
      }
    } catch { /* best effort */ }
  }
  return {
    root,
    meshes: result.meshes as AbstractMesh[],
    materials,
    textures,
    aux: [],
    stats: {
      meshCount: result.meshes.length,
      materialCount: materials.length,
      textureCount: textures.length,
      totalIndices,
      approxTriangles: Math.round(totalIndices / 3),
      disabledCameras,
      disabledLights,
      boundsMin,
      boundsMax,
    },
    timings,
  };
}

/** Dispose the review station and review-only world props (Green Zone untouched — it was never built). */
export function disposeTramReview(scene: Scene, load: TramReviewLoad | null): void {
  if (!load) return;
  try { load.root.dispose(false, true); } catch { /* best effort */ }
  for (const m of load.meshes) {
    try { (m as Mesh).dispose(true, false); } catch { /* best effort */ }
  }
  for (const t of load.textures) {
    try { t.dispose(); } catch { /* best effort */ }
  }
  for (const m of load.materials) {
    try { m.dispose(); } catch { /* best effort */ }
  }
  for (const name of ["tram-review-ground", "tram-review-sky",
    "tram-review-ramp-0", "tram-review-ramp-1", "tram-review-ramp-nose-0", "tram-review-ramp-nose-1",
    "tram-review-bench-0", "tram-review-bench-0-foot--0.7", "tram-review-bench-0-foot-0.7",
    "tram-review-bench-1", "tram-review-bench-1-foot--0.7", "tram-review-bench-1-foot-0.7",
    "tram-review-cover-0", "tram-review-cover-0-cap", "tram-review-cover-1", "tram-review-cover-1-cap",
    "tram-review-fence-n0", "tram-review-fence-n0-base", "tram-review-fence-n1", "tram-review-fence-n1-base",
    "tram-review-fence-n2", "tram-review-fence-n2-base", "tram-review-fence-s", "tram-review-fence-s-base",
    "tram-review-fence-w", "tram-review-fence-w-base", "tram-review-fence-e", "tram-review-fence-e-base",
    "tram-review-fence-pw", "tram-review-fence-pw-base", "tram-review-fence-pe", "tram-review-fence-pe-base",
    "tram-review-fence-pn", "tram-review-fence-pn-base",
    "tram-review-fence-cw", "tram-review-fence-cw-base", "tram-review-fence-cw2", "tram-review-fence-cw2-base",
    "tram-review-fence-ce", "tram-review-fence-ce-base", "tram-review-fence-ce2", "tram-review-fence-ce2-base",
    "tram-review-relay-base", "tram-review-relay-mast", "tram-review-relay-tip", "relayRing",
    "tram-cache-0", "tram-cache-1", "tram-cache-2", "tram-cacheGlow-0", "tram-cacheGlow-1", "tram-cacheGlow-2"]) {
    try { scene.getMeshByName(name)?.dispose(false, true); } catch { /* best effort */ }
  }
}

/**
 * Derived optimization experiment (measurement only, source GLB untouched):
 * disable station meshes whose world-bbox center falls outside the keep box,
 * simulating an extracted apron section. Returns kept/disabled counts.
 */
export function tramTrimOutside(
  load: TramReviewLoad, x0: number, x1: number, z0: number, z1: number,
): { kept: number; disabled: number } {
  let kept = 0;
  let disabled = 0;
  for (const m of load.meshes) {
    const mesh = m as Mesh;
    try {
      mesh.computeWorldMatrix(true);
      const bb = mesh.getBoundingInfo?.()?.boundingBox;
      if (!bb) { kept++; continue; }
      const cx = (bb.minimumWorld.x + bb.maximumWorld.x) / 2;
      const cz = (bb.minimumWorld.z + bb.maximumWorld.z) / 2;
      if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) kept++;
      else {
        mesh.setEnabled(false);
        disabled++;
      }
    } catch {
      kept++;
    }
  }
  return { kept, disabled };
}

export interface TramProbeHit { x: number; z: number; y: number | null; mesh: string | null; }

/**
 * Vertical probe of the unmodified station: top-down ray per grid cell,
 * station meshes only (review ground and Tololo excluded). Used once to pick
 * a test lane whose walking surfaces sit at controller height (y≈0).
 */
export function tramProbeGrid(
  scene: Scene, x0: number, x1: number, xStep: number, z0: number, z1: number, zStep: number,
  originY = 120,
): TramProbeHit[] {
  const root = scene.getTransformNodeByName("tram-review-root");
  const out: TramProbeHit[] = [];
  if (!root) return out;
  const dir = new Vector3(0, -1, 0);
  for (let x = x0; x <= x1 + 1e-6; x += xStep) {
    for (let z = z0; z <= z1 + 1e-6; z += zStep) {
      const ray = new Ray(new Vector3(x, originY, z), dir, originY + 280);
      const pick = scene.pickWithRay(ray, (m: AbstractMesh) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let p: any = m;
        while (p) {
          if (p === root) return m.isEnabled() && m.isVisible;
          p = p.parent;
        }
        return false;
      }, false);
      out.push({
        x: +x.toFixed(1), z: +z.toFixed(1),
        y: pick?.hit && pick.pickedPoint ? +pick.pickedPoint.y.toFixed(2) : null,
        mesh: pick?.hit ? (pick.pickedMesh?.name ?? "?").slice(0, 32) : null,
      });
    }
  }
  return out;
}

/** Named inspection views (world-space circuit framing). */
export function tramReviewView(name: string): { pos: Vector3; target: Vector3 } {
  switch (name) {
    case "overview":
      return { pos: new Vector3(43, 22, 86), target: new Vector3(5, 2, 20) };
    case "scale":
      return { pos: new Vector3(16.2, 1.7, 57.6), target: new Vector3(14, 1.15, 61) };
    case "passage":
      return { pos: new Vector3(11, 2.2, 56), target: new Vector3(17, 1.0, 46) };
    case "combat":
      return { pos: new Vector3(24, 3.2, 62), target: new Vector3(15, 1.0, 54) };
    case "relay":
      return { pos: new Vector3(22.5, 2.6, 61.5), target: new Vector3(16, 1.6, 53) };
    case "platform":
      return { pos: new Vector3(6.6, 3.4, 44), target: new Vector3(6.6, 1.6, 28) };
    case "ramp":
      return { pos: new Vector3(12, 2.4, 47), target: new Vector3(5, 0.8, 40) };
    case "circuit":
      return { pos: new Vector3(30, 14, 72), target: new Vector3(8, 0.5, 40) };
    default:
      return { pos: new Vector3(43, 22, 86), target: new Vector3(5, 2, 20) };
  }
}
