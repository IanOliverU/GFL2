// Tram-station district preview (dev-only local evaluation, never shipped).
//
// Source asset (untouched, git-ignored assets/maps/tram/tram_station.glb):
// "Tram station" by Randonavt (https://sketchfab.com/Randonavt), licensed
// CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/), via
// https://sketchfab.com/3d-models/tram-station-5079604f87084b2db1748193816942b9
// (Sketchfab export, embedded metadata verified; page-side terms not fetched).
// Modifications here are runtime-only (root offset, review-world props,
// measurement helpers). The owner approved this source-only review slice for
// repository publication on 2026-09-10; the GLB bytes remain local-only and
// still require a suitability verdict plus visible CC-BY attribution before
// any shipped redistribution.
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
/** Safe spawn: west apron approach, looking through the kiosk passage to ramp A. */
export const TRAM_SPAWN_POS = new Vector3(5, 0, 53.5);
export const TRAM_SPAWN_YAW = 0;
/** In-circuit boss arrival (east apron, clear of kiosks/ring/fences). */
export const TRAM_BOSS_SPAWN = new Vector3(24, 0, 58);
/** Ordered apron-to-deck links. B stages east of K1 before entering its slot. */
export const TRAM_RAMP_LANES = [
  { points: [{ x: 5, z: 43.4 }, { x: 5, z: 40 }, { x: 5, z: 36 }] },
  { points: [{ x: 13, z: 43.4 }, { x: 8, z: 43.4 }, { x: 8, z: 40 }, { x: 8, z: 36 }] },
];

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
  cameraTriangles: number;
  cameraBvhNodes: number;
  boundsMin: Vector3;
  boundsMax: Vector3;
}

interface TramCameraBvh {
  triangleCount: number;
  nodeCount: number;
  intersect(origin: Vector3, direction: Vector3, maxDist: number): number;
}

export interface TramReviewLoad {
  root: TransformNode;
  meshes: AbstractMesh[];
  cameras: Camera[];
  lights: Light[];
  cameraMesh: Mesh | null;
  cameraBvh: TramCameraBvh | null;
  materials: Material[];
  textures: BaseTexture[];
  aux: Mesh[];
  stats: TramReviewStats;
  timings: TramReviewTimings;
}

function tramRayBoxEntry(
  bounds: Float32Array, node: number,
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  nearest: number,
): number {
  const bi = node * 6;
  let near = 0;
  let far = nearest;
  if (Math.abs(dx) < 1e-12) {
    if (ox < bounds[bi]! || ox > bounds[bi + 3]!) return Infinity;
  } else {
    let a = (bounds[bi]! - ox) / dx;
    let b = (bounds[bi + 3]! - ox) / dx;
    if (a > b) { const swap = a; a = b; b = swap; }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < bounds[bi + 1]! || oy > bounds[bi + 4]!) return Infinity;
  } else {
    let a = (bounds[bi + 1]! - oy) / dy;
    let b = (bounds[bi + 4]! - oy) / dy;
    if (a > b) { const swap = a; a = b; b = swap; }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < bounds[bi + 2]! || oz > bounds[bi + 5]!) return Infinity;
  } else {
    let a = (bounds[bi + 2]! - oz) / dz;
    let b = (bounds[bi + 5]! - oz) / dz;
    if (a > b) { const swap = a; a = b; b = swap; }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  return near;
}

/** Build an exact, allocation-free query accelerator for the perforated canopy. */
function buildTramCameraBvh(mesh: Mesh): TramCameraBvh {
  mesh.computeWorldMatrix(true);
  const sourcePositions = mesh.getVerticesData("position");
  const sourceIndices = mesh.getIndices();
  if (!sourcePositions || !sourceIndices || sourceIndices.length < 3) {
    throw new Error("tram canopy has no indexed position geometry");
  }
  const positions = Float32Array.from(sourcePositions);
  const indices = Uint32Array.from(sourceIndices);
  const triangleCount = Math.floor(indices.length / 3);
  const triangleBounds = new Float32Array(triangleCount * 6);
  const triangleCentres = new Float32Array(triangleCount * 3);
  const order = Array.from({ length: triangleCount }, (_, i) => i);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const ti = triangle * 3;
    const a = indices[ti]! * 3;
    const b = indices[ti + 1]! * 3;
    const c = indices[ti + 2]! * 3;
    const minX = Math.min(positions[a]!, positions[b]!, positions[c]!);
    const minY = Math.min(positions[a + 1]!, positions[b + 1]!, positions[c + 1]!);
    const minZ = Math.min(positions[a + 2]!, positions[b + 2]!, positions[c + 2]!);
    const maxX = Math.max(positions[a]!, positions[b]!, positions[c]!);
    const maxY = Math.max(positions[a + 1]!, positions[b + 1]!, positions[c + 1]!);
    const maxZ = Math.max(positions[a + 2]!, positions[b + 2]!, positions[c + 2]!);
    const bi = triangle * 6;
    // Babylon accepts barycentric coordinates 0.001 beyond triangle edges.
    // Inflate leaf bounds enough that broadphase cannot reject such an edge hit.
    triangleBounds[bi] = minX - (maxX - minX) * 0.002 - 1e-6;
    triangleBounds[bi + 1] = minY - (maxY - minY) * 0.002 - 1e-6;
    triangleBounds[bi + 2] = minZ - (maxZ - minZ) * 0.002 - 1e-6;
    triangleBounds[bi + 3] = maxX + (maxX - minX) * 0.002 + 1e-6;
    triangleBounds[bi + 4] = maxY + (maxY - minY) * 0.002 + 1e-6;
    triangleBounds[bi + 5] = maxZ + (maxZ - minZ) * 0.002 + 1e-6;
    const ci = triangle * 3;
    triangleCentres[ci] = (minX + maxX) * 0.5;
    triangleCentres[ci + 1] = (minY + maxY) * 0.5;
    triangleCentres[ci + 2] = (minZ + maxZ) * 0.5;
  }

  const nodeBounds: number[] = [];
  const nodeMeta: number[] = [];
  const buildNode = (start: number, end: number): number => {
    const node = nodeMeta.length / 4;
    nodeMeta.push(-1, -1, start, end - start);
    const boundsAt = nodeBounds.length;
    nodeBounds.push(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    let centreMinX = Infinity;
    let centreMinY = Infinity;
    let centreMinZ = Infinity;
    let centreMaxX = -Infinity;
    let centreMaxY = -Infinity;
    let centreMaxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const triangle = order[i]!;
      const bi = triangle * 6;
      nodeBounds[boundsAt] = Math.min(nodeBounds[boundsAt]!, triangleBounds[bi]!);
      nodeBounds[boundsAt + 1] = Math.min(nodeBounds[boundsAt + 1]!, triangleBounds[bi + 1]!);
      nodeBounds[boundsAt + 2] = Math.min(nodeBounds[boundsAt + 2]!, triangleBounds[bi + 2]!);
      nodeBounds[boundsAt + 3] = Math.max(nodeBounds[boundsAt + 3]!, triangleBounds[bi + 3]!);
      nodeBounds[boundsAt + 4] = Math.max(nodeBounds[boundsAt + 4]!, triangleBounds[bi + 4]!);
      nodeBounds[boundsAt + 5] = Math.max(nodeBounds[boundsAt + 5]!, triangleBounds[bi + 5]!);
      const ci = triangle * 3;
      centreMinX = Math.min(centreMinX, triangleCentres[ci]!);
      centreMinY = Math.min(centreMinY, triangleCentres[ci + 1]!);
      centreMinZ = Math.min(centreMinZ, triangleCentres[ci + 2]!);
      centreMaxX = Math.max(centreMaxX, triangleCentres[ci]!);
      centreMaxY = Math.max(centreMaxY, triangleCentres[ci + 1]!);
      centreMaxZ = Math.max(centreMaxZ, triangleCentres[ci + 2]!);
    }
    if (end - start <= 8) return node;
    const spans = [centreMaxX - centreMinX, centreMaxY - centreMinY, centreMaxZ - centreMinZ];
    const axis = spans[1]! > spans[0]! ? (spans[2]! > spans[1]! ? 2 : 1) : (spans[2]! > spans[0]! ? 2 : 0);
    const sorted = order.slice(start, end).sort((a, b) => triangleCentres[a * 3 + axis]! - triangleCentres[b * 3 + axis]!);
    for (let i = 0; i < sorted.length; i++) order[start + i] = sorted[i]!;
    const middle = start + Math.floor((end - start) / 2);
    const left = buildNode(start, middle);
    const right = buildNode(middle, end);
    const mi = node * 4;
    nodeMeta[mi] = left;
    nodeMeta[mi + 1] = right;
    nodeMeta[mi + 2] = 0;
    nodeMeta[mi + 3] = 0;
    return node;
  };
  buildNode(0, triangleCount);

  const packedOrder = Uint16Array.from(order);
  const packedBounds = Float32Array.from(nodeBounds);
  const packedMeta = Int32Array.from(nodeMeta);
  const inverseWorld = Float32Array.from(mesh.getWorldMatrix().clone().invert().m);
  const stack = new Int32Array(64);

  const intersect = (origin: Vector3, direction: Vector3, maxDist: number): number => {
    const m = inverseWorld;
    const rw = origin.x * m[3]! + origin.y * m[7]! + origin.z * m[11]! + m[15]!;
    const ox = (origin.x * m[0]! + origin.y * m[4]! + origin.z * m[8]! + m[12]!) / rw;
    const oy = (origin.x * m[1]! + origin.y * m[5]! + origin.z * m[9]! + m[13]!) / rw;
    const oz = (origin.x * m[2]! + origin.y * m[6]! + origin.z * m[10]! + m[14]!) / rw;
    const rawDx = direction.x * m[0]! + direction.y * m[4]! + direction.z * m[8]!;
    const rawDy = direction.x * m[1]! + direction.y * m[5]! + direction.z * m[9]!;
    const rawDz = direction.x * m[2]! + direction.y * m[6]! + direction.z * m[10]!;
    const localScale = Math.hypot(rawDx, rawDy, rawDz);
    if (localScale < 1e-12 || maxDist <= 0) return Infinity;
    const dx = rawDx / localScale;
    const dy = rawDy / localScale;
    const dz = rawDz / localScale;
    let nearest = maxDist * localScale;

    let stackSize = 0;
    stack[stackSize++] = 0;
    while (stackSize > 0) {
      const node = stack[--stackSize]!;
      if (tramRayBoxEntry(packedBounds, node, ox, oy, oz, dx, dy, dz, nearest) === Infinity) continue;
      const mi = node * 4;
      const left = packedMeta[mi]!;
      if (left >= 0) {
        const right = packedMeta[mi + 1]!;
        const leftEntry = tramRayBoxEntry(packedBounds, left, ox, oy, oz, dx, dy, dz, nearest);
        const rightEntry = tramRayBoxEntry(packedBounds, right, ox, oy, oz, dx, dy, dz, nearest);
        if (leftEntry === Infinity && rightEntry === Infinity) continue;
        if (leftEntry <= rightEntry) {
          if (rightEntry !== Infinity) stack[stackSize++] = right;
          if (leftEntry !== Infinity) stack[stackSize++] = left;
        } else {
          if (leftEntry !== Infinity) stack[stackSize++] = left;
          if (rightEntry !== Infinity) stack[stackSize++] = right;
        }
        continue;
      }
      const start = packedMeta[mi + 2]!;
      const end = start + packedMeta[mi + 3]!;
      for (let i = start; i < end; i++) {
        const triangle = packedOrder[i]!;
        const ti = triangle * 3;
        const ai = indices[ti]! * 3;
        const bi = indices[ti + 1]! * 3;
        const ci = indices[ti + 2]! * 3;
        const ax = positions[ai]!;
        const ay = positions[ai + 1]!;
        const az = positions[ai + 2]!;
        const e1x = positions[bi]! - ax;
        const e1y = positions[bi + 1]! - ay;
        const e1z = positions[bi + 2]! - az;
        const e2x = positions[ci]! - ax;
        const e2y = positions[ci + 1]! - ay;
        const e2z = positions[ci + 2]! - az;
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const determinant = e1x * px + e1y * py + e1z * pz;
        if (determinant === 0) continue;
        const inverseDeterminant = 1 / determinant;
        const tx = ox - ax;
        const ty = oy - ay;
        const tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inverseDeterminant;
        if (u < -0.001 || u > 1.001) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inverseDeterminant;
        if (v < -0.001 || u + v > 1.001) continue;
        const distance = (e2x * qx + e2y * qy + e2z * qz) * inverseDeterminant;
        if (distance >= 0 && distance <= nearest) nearest = distance;
      }
    }
    return nearest < maxDist * localScale ? nearest / localScale : Infinity;
  };

  return { triangleCount, nodeCount: packedMeta.length / 4, intersect };
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
 * - Open station railings close every unsupported edge: 1.7 m above grade and
 *   1.65 m above the platform deck. Low curbs, two horizontal bars, and posts
 *   each have matching collision, so views/shots pass through visible gaps
 *   while jump, dodge, and Phase Step body spans remain contained.
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
  // Daylight readability: every solid carries a small emissive floor so shaded
  // faces render as material color, never pure black (footage showed the dark
  // steel fence photographing as black voids in close-up).
  const concreteMat = reviewMat(scene, "tramReviewConcreteM", new Color3(0.60, 0.62, 0.65), new Color3(0.07, 0.07, 0.08));
  const curbMat = reviewMat(scene, "tramReviewCurbM", new Color3(0.38, 0.40, 0.40), new Color3(0.035, 0.035, 0.035));
  const steelMat = reviewMat(scene, "tramReviewSteelM", new Color3(0.16, 0.28, 0.37), new Color3(0.025, 0.04, 0.055));
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
  bench("tram-review-bench-0", 5.8, 28);
  bench("tram-review-bench-1", 7.0, 23);

  // Kiosk walls as tight invisible cover (ray-measured solid faces, §14/§15):
  // K1 Object_1296 (x 7.06…9.67 envelope over 7.28…9.45 of pilasters/bays,
  // NORTH wall ~44.6–45.7, not the 43.9 mesh-bounds skirt), K2 Object_1298
  // (x 7.73…10.35 over 7.97…10.12, south face flush with the fence line at
  // 63.8), K3 east Object_342 (bounds). The west gap (x<7) stays the kiosk
  // passage; the deeper slot (z 42…44.6) feeds ramp B's mouth.
  addBox(8.37, 1.37, 49.25, 2.61, 2.74, 9.3); // K1 (z 44.6…53.9)
  addBox(9.04, 1.37, 58.875, 2.61, 2.74, 9.85); // K2 (z 53.9…63.8)
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
  coverBlock("tram-review-cover-1", 19, 61);

  // Open station railing: a low curb, two narrow horizontal bars, and posts.
  // Each visible member gets the same AABB used by movement, camera, and shot
  // queries, so the openings really are open while the continuous rails still
  // catch jump, dodge, and Phase Step body spans. Platform rails start on the
  // deck and rise just above the deck-jump body span; they do not form walls.
  const fence = (
    name: string, cx: number, cz: number, sx: number, sz: number,
    h = 1.7, baseY = 0,
  ): void => {
    const horizontal = sx >= sz;
    const curbH = 0.22;
    const base = MeshBuilder.CreateBox(`${name}-base`, { width: sx, height: curbH, depth: sz }, scene);
    base.position = new Vector3(cx, baseY + curbH / 2, cz);
    base.material = curbMat;
    addBox(cx, baseY + curbH / 2, cz, sx, curbH, sz);

    const steelParts: Mesh[] = [];
    const railThickness = 0.12;
    for (const [i, y] of [baseY + 0.82, baseY + h - 0.08].entries()) {
      const rail = MeshBuilder.CreateBox(`${name}-rail-${i}`, {
        width: horizontal ? sx : 0.14,
        height: railThickness,
        depth: horizontal ? 0.14 : sz,
      }, scene);
      rail.position = new Vector3(cx, y, cz);
      rail.material = steelMat;
      steelParts.push(rail);
      addBox(cx, y, cz, horizontal ? sx : 0.14, railThickness, horizontal ? 0.14 : sz);
    }

    const length = horizontal ? sx : sz;
    const postCount = Math.max(2, Math.ceil(length / 2.6) + 1);
    const postH = h - curbH;
    for (let i = 0; i < postCount; i++) {
      const along = -length / 2 + length * i / (postCount - 1);
      const px = horizontal ? cx + along : cx;
      const pz = horizontal ? cz : cz + along;
      const post = MeshBuilder.CreateBox(`${name}-post-${i}`, { width: 0.14, height: postH, depth: 0.14 }, scene);
      post.position = new Vector3(px, baseY + curbH + postH / 2, pz);
      post.material = steelMat;
      steelParts.push(post);
      addBox(px, baseY + curbH + postH / 2, pz, 0.14, postH, 0.14);
    }
    const steel = Mesh.MergeMeshes(steelParts, true, true, undefined, false, true);
    if (steel) {
      steel.name = name;
      steel.material = steelMat;
    }
  };
  // Apron north fence (z=42) with ramp-mouth openings at x 4…6 and 7…10.
  // Mouth B runs 1 m wider than its ramp slab so eastern approaches can round
  // the fence jamb without oscillating against the corner (the shoulder is
  // flat grade leading into the same slot).
  fence("tram-review-fence-n0", 2, 42, 4, 0.4);
  fence("tram-review-fence-n1", 6.5, 42, 1, 0.4);
  fence("tram-review-fence-n2", 18, 42, 16, 0.4);
  fence("tram-review-fence-s", 13, 64, 26, 0.4); // south
  fence("tram-review-fence-w", 0, 53, 0.4, 22); // west
  fence("tram-review-fence-e", 26, 53, 0.4, 22); // east
  // Platform railings sit on the deck and reach world y=3.1, enough to catch
  // a jumping body while leaving sightlines through and over the bars.
  fence("tram-review-fence-pw", 3.4, 30, 0.4, 24, 1.65, TRAM_PLATFORM_TOP);
  fence("tram-review-fence-pe", 9.8, 30, 0.4, 24, 1.65, TRAM_PLATFORM_TOP);
  fence("tram-review-fence-pn", 6.6, 18, 6.8, 0.4, 1.65, TRAM_PLATFORM_TOP);
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
  const cacheSpots = [new Vector3(12, 0, 48.5), new Vector3(4.4, 0, 20.5), new Vector3(14, 0, 62.5)];
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
    TRAM_SPAWN_POS.clone(), new Vector3(5, 0, 50), new Vector3(20, 0, 60),
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
    // Outer failsafe only (the open railing is the real boundary): 66
    // matches the Green Zone so the south verge (z=64 fence) is reachable —
    // bounds clamps to ±(bounds − radius), and 60 would amputate z>59.45.
    bounds: 66,
    walkwayTop: TRAM_PLATFORM_TOP,
    groundHeightAt: tramGroundHeightAt,
    controllerGroundHeightAt: tramControllerGroundHeightAt,
    bossSpawn: TRAM_BOSS_SPAWN.clone(),
    playerSpawn: { pos: TRAM_SPAWN_POS.clone(), yaw: TRAM_SPAWN_YAW },
    rampLanes: TRAM_RAMP_LANES.map((lane) => ({ points: lane.points.map((p) => ({ ...p })) })),
    // The visible boss is wider than the preserved 2 m station ramps. Cap only
    // environment collision while navigating; combat and separation keep its
    // authored radius, attack range, damage, and presentation.
    enemyNavRadiusCap: 0.7,
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

  const cameras = scene.cameras.filter((cam) => !camerasBefore.has(cam));
  for (const cam of cameras) cam.setEnabled(false);
  const lights = scene.lights.filter((light) => !lightsBefore.has(light));
  for (const light of lights) light.setEnabled(false);
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
  // The imported platform canopy is one dense, perforated submesh. Build once
  // after its final parent transform so camera queries never scan scene meshes.
  const cameraMesh = (result.meshes.find((m) => m.name === "Object_356") as Mesh | undefined) ?? null;
  let cameraBvh: TramCameraBvh | null;
  try {
    cameraBvh = cameraMesh ? buildTramCameraBvh(cameraMesh) : null;
  } catch (error) {
    try { root.dispose(true, false); } catch { /* best effort */ }
    for (const mesh of result.meshes) {
      try { (mesh as Mesh).dispose(true, false); } catch { /* best effort */ }
    }
    for (const camera of cameras) {
      try { camera.dispose(); } catch { /* best effort */ }
    }
    for (const light of lights) {
      try { light.dispose(); } catch { /* best effort */ }
    }
    for (const texture of textures) {
      try { texture.dispose(); } catch { /* best effort */ }
    }
    for (const material of materials) {
      try { material.dispose(); } catch { /* best effort */ }
    }
    throw error;
  }
  return {
    root,
    meshes: result.meshes as AbstractMesh[],
    cameras,
    lights,
    cameraMesh,
    cameraBvh,
    materials,
    textures,
    aux: [],
    stats: {
      meshCount: result.meshes.length,
      materialCount: materials.length,
      textureCount: textures.length,
      totalIndices,
      approxTriangles: Math.round(totalIndices / 3),
      disabledCameras: cameras.length,
      disabledLights: lights.length,
      cameraTriangles: cameraBvh?.triangleCount ?? 0,
      cameraBvhNodes: cameraBvh?.nodeCount ?? 0,
      boundsMin,
      boundsMax,
    },
    timings,
  };
}

/** Exact BVH-accelerated camera distance against the imported canopy. */
export function tramCameraObstruction(
  load: TramReviewLoad, origin: Vector3, dir: Vector3, maxDist: number,
): number {
  if (origin.y < TRAM_PLATFORM_TOP + 1.5 || origin.x < 3 || origin.x > 10.8 || origin.z < 17.5 || origin.z > 40) {
    return Infinity;
  }
  return load.cameraBvh?.intersect(origin, dir, maxDist) ?? Infinity;
}

/** Slow dev reference used to verify the BVH against Babylon's exact picker. */
export function tramCameraObstructionReference(
  load: TramReviewLoad, origin: Vector3, dir: Vector3, maxDist: number,
): number {
  if (!load.cameraMesh) return Infinity;
  const ray = new Ray(origin.clone(), dir.clone(), maxDist);
  const scene = load.root.getScene();
  const pick = scene.pickWithRay(ray, (mesh) => mesh === load.cameraMesh, false);
  return pick?.hit ? pick.distance : Infinity;
}

/** Dev-only station raycast (world-space segment vs station meshes only). */
export function tramRaycastStation(
  scene: Scene, origin: Vector3, dir: Vector3, maxDist: number,
): { dist: number; mesh: string | null; point: Vector3 | null } {
  const root = scene.getTransformNodeByName("tram-review-root");
  if (!root) return { dist: Infinity, mesh: null, point: null };
  const ray = new Ray(origin.clone(), dir.clone(), maxDist);
  const pick = scene.pickWithRay(ray, (m: AbstractMesh) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let p: any = m;
    while (p) {
      if (p === root) return m.isEnabled() && m.isVisible;
      p = p.parent;
    }
    return false;
  }, false);
  if (pick?.hit && pick.pickedPoint && pick.distance < maxDist) {
    return { dist: pick.distance, mesh: pick.pickedMesh?.name ?? "?", point: pick.pickedPoint.clone() };
  }
  return { dist: Infinity, mesh: null, point: null };
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
  for (const camera of load.cameras) {
    try { camera.dispose(); } catch { /* best effort */ }
  }
  for (const light of load.lights) {
    try { light.dispose(); } catch { /* best effort */ }
  }
  for (const name of ["tram-review-ground", "tram-review-sky",
    "tram-review-ramp-0", "tram-review-ramp-1", "tram-review-ramp-nose-0", "tram-review-ramp-nose-1",
    "tram-review-guard-w", "tram-review-guard-w-post-21", "tram-review-guard-w-post-28", "tram-review-guard-w-post-36",
    "tram-review-guard-e", "tram-review-guard-e-post-21", "tram-review-guard-e-post-28", "tram-review-guard-e-post-36",
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
      return { pos: new Vector3(8.5, 1.7, 59), target: new Vector3(5, 1.15, 53.5) };
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
