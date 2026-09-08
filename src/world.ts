// Handcrafted stage: lower yard, elevated walkway (2 ramps), interior shortcut,
// open boss arena, relay landmark, caches. Plus kinematic collision helpers.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { dressCourtyard } from "./courtyard";

export interface AABB { min: Vector3; max: Vector3; }

export interface CacheSpot { pos: Vector3; taken: boolean; mesh: Mesh; glow: Mesh | null; }
export interface WorldRefs {
  colliders: AABB[];
  caches: CacheSpot[];
  relayPos: Vector3;
  relayRadius: number;
  relayRing: Mesh;
  towerMeshes: Mesh[];
  spawnPoints: Vector3[];
  bossGate: Vector3;
  bounds: number;
  walkwayTop: number;
}

export function groundHeightAt(x: number, z: number): number {
  // Elevated walkway deck
  if (x >= -40 && x <= 40 && z >= -40 && z <= -30) return 6;
  // West ramp: x -50..-40, z -34..-26 rising 0->6 as x goes -50->-40
  if (x >= -50 && x <= -40 && z >= -36 && z <= -24) {
    const t = (x + 50) / 10;
    return 6 * t;
  }
  // East ramp: x 40..50 mirrored
  if (x >= 40 && x <= 50 && z >= -36 && z <= -24) {
    const t = (50 - x) / 10;
    return 6 * t;
  }
  return 0;
}

export function controllerGroundHeightAt(x: number, z: number, currentY: number): number {
  const height = groundHeightAt(x, z);
  // The walkway's underside is traversable. Only select its top surface after
  // the controller has climbed one of the ramps or jumped close to deck level.
  if (height === 6 && currentY < 4.7) return 0;
  return height;
}

export function moveHorizontalSafe(
  pos: Vector3,
  dx: number,
  dz: number,
  radius: number,
  colliders: AABB[],
  bounds: number,
): void {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.2, radius * 0.55)));
  for (let i = 0; i < steps; i++) {
    pos.x += dx / steps;
    pos.z += dz / steps;
    resolveCircle(pos, radius, colliders);
    pos.x = Math.max(-bounds + radius, Math.min(bounds - radius, pos.x));
    pos.z = Math.max(-bounds + radius, Math.min(bounds - radius, pos.z));
  }
}

export function isGroundSpawnValid(pos: Vector3, radius: number, colliders: AABB[]): boolean {
  for (const b of colliders) {
    if (pos.y + 1.8 < b.min.y || pos.y >= b.max.y - 0.05) continue;
    if (pos.x + radius > b.min.x && pos.x - radius < b.max.x && pos.z + radius > b.min.z && pos.z - radius < b.max.z) return false;
  }
  return true;
}

function addBox(colliders: AABB[], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): AABB {
  const b: AABB = {
    min: new Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    max: new Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  };
  colliders.push(b);
  return b;
}

export function resolveCircle(pos: Vector3, radius: number, colliders: AABB[]): void {
  // Push out horizontally from AABBs that overlap the vertical span of the body.
  for (const b of colliders) {
    if (pos.y + 1.6 < b.min.y || pos.y + 0.2 > b.max.y) continue;
    const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // center inside box: push along smallest penetration axis
        const pxMin = Math.abs(pos.x - b.min.x), pxMax = Math.abs(b.max.x - pos.x);
        const pzMin = Math.abs(pos.z - b.min.z), pzMax = Math.abs(b.max.z - pos.z);
        const m = Math.min(pxMin, pxMax, pzMin, pzMax);
        if (m === pxMin) pos.x = b.min.x - radius;
        else if (m === pxMax) pos.x = b.max.x + radius;
        else if (m === pzMin) pos.z = b.min.z - radius;
        else pos.z = b.max.z + radius;
      }
    }
  }
}

export function raycastSolid(origin: Vector3, dir: Vector3, maxDist: number, colliders: AABB[]): number {
  // Returns distance to nearest solid hit, or Infinity.
  let best = Infinity;
  for (const b of colliders) {
    let tmin = 0, tmax = maxDist;
    let ok = true;
    const axes: (keyof Vector3)[] = ["x", "y", "z"];
    for (const a of axes) {
      const o = (origin as unknown as Record<string, number>)[a] as number;
      const d = (dir as unknown as Record<string, number>)[a] as number;
      const mn = (b.min as unknown as Record<string, number>)[a] as number;
      const mx = (b.max as unknown as Record<string, number>)[a] as number;
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin >= 0 && tmin < best) best = tmin;
  }
  // ground plane y=0 (only when ray points downward and origin above)
  if (dir.y < -1e-6 && origin.y > 0) {
    const t = origin.y / -dir.y;
    if (t >= 0 && t <= maxDist) {
      const hx = origin.x + dir.x * t, hz = origin.z + dir.z * t;
      if (Math.abs(hx) < 70 && Math.abs(hz) < 70 && t < best) best = t;
    }
  }
  // Heightfield sample covers visible ramps and the sides/top of the walkway.
  // A small step is sufficient for combat ranges while remaining inexpensive.
  for (let t = 0.2; t <= Math.min(best, maxDist); t += 0.25) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    if (Math.abs(x) > 70 || Math.abs(z) > 70) continue;
    const floor = groundHeightAt(x, z);
    // The elevated deck is a thin platform, not a solid six-metre volume.
    if (floor === 6 && y < 5.35) continue;
    if (y <= floor + 0.04) {
      best = t;
      break;
    }
  }
  return best;
}

function mat(scene: Scene, name: string, color: Color3, emissive?: Color3, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  if (emissive) m.emissiveColor = emissive;
  m.alpha = alpha;
  m.specularColor = new Color3(0.08, 0.08, 0.1);
  return m;
}

export function buildWorld(scene: Scene): WorldRefs {
  const colliders: AABB[] = [];
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0045;

  // --- ground ---
  const ground = MeshBuilder.CreateGround("ground", { width: 150, height: 150 }, scene);
  ground.material = mat(scene, "gnd", new Color3(0.13, 0.15, 0.19));
  ground.receiveShadows = false;
  ground.checkCollisions = false;

  // yard painted plaza
  const plaza = MeshBuilder.CreateDisc("plaza", { radius: 16, tessellation: 48 }, scene);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position = new Vector3(0, 0.02, 2);
  plaza.material = mat(scene, "plaza", new Color3(0.16, 0.19, 0.24), new Color3(0.02, 0.03, 0.05));

  const accentMat = mat(scene, "accent", new Color3(0.9, 0.6, 0.2), new Color3(0.35, 0.2, 0.05));

  // --- boundary walls (visible + solid) ---
  const wallMat = mat(scene, "wall", new Color3(0.2, 0.24, 0.3));
  const B = 68;
  const mkWall = (name: string, cx: number, cz: number, sx: number, sz: number): void => {
    const m = MeshBuilder.CreateBox(name, { width: sx, height: 6, depth: sz }, scene);
    m.position = new Vector3(cx, 3, cz);
    m.material = wallMat;
    addBox(colliders, cx, 3, cz, sx, 6, sz);
  };
  mkWall("wallN", 0, -B, 140, 2);
  mkWall("wallS", 0, B, 140, 2);
  mkWall("wallW", -B, 0, 2, 140);
  mkWall("wallE", B, 0, 2, 140);

  // --- elevated walkway deck (north) + rails + pillars ---
  const deckMat = mat(scene, "deck", new Color3(0.23, 0.27, 0.34));
  const deck = MeshBuilder.CreateBox("walkway", { width: 80, height: 0.6, depth: 10 }, scene);
  deck.position = new Vector3(0, 5.7, -35);
  deck.material = deckMat;
  addBox(colliders, 0, 5.7, -35, 80, 0.6, 10); // thin solid: blocks camera rays, stands on
  // support pillars (solid)
  for (const px of [-36, -18, 0, 18, 36]) {
    const p = MeshBuilder.CreateBox(`pillar-${px}`, { width: 1.6, height: 5.7, depth: 1.6 }, scene);
    p.position = new Vector3(px, 2.85, -35);
    p.material = wallMat;
    addBox(colliders, px, 2.85, -35, 1.6, 5.7, 1.6);
  }
  // railings (visual only)
  const railMat = mat(scene, "rail", new Color3(0.35, 0.5, 0.65), new Color3(0.05, 0.1, 0.14));
  for (const rz of [-39.6, -30.4]) {
    const r = MeshBuilder.CreateBox(`rail-${rz}`, { width: 80, height: 0.9, depth: 0.25 }, scene);
    r.position = new Vector3(0, 6.9, rz);
    r.material = railMat;
  }
  // ramps (visual)
  const rampMat = mat(scene, "ramp", new Color3(0.25, 0.29, 0.36));
  const mkRamp = (name: string, x0: number, x1: number): void => {
    const len = Math.abs(x1 - x0);
    const r = MeshBuilder.CreateBox(name, { width: len + 2, height: 0.5, depth: 10 }, scene);
    const cx = (x0 + x1) / 2;
    r.position = new Vector3(cx, 3.0, -30);
    r.rotation.z = x0 < x1 ? Math.atan2(6, len) : -Math.atan2(6, len);
    r.material = rampMat;
  };
  mkRamp("rampW", -50, -40);
  mkRamp("rampE", 50, 40);
  // glowing deck edge
  const edge = MeshBuilder.CreateBox("deckEdge", { width: 80, height: 0.18, depth: 0.3 }, scene);
  edge.position = new Vector3(0, 6.05, -30.2);
  edge.material = accentMat;

  // --- interior shortcut building (south) with 2 door gaps ---
  const bMat = mat(scene, "bld", new Color3(0.19, 0.22, 0.28));
  const mkBldWall = (name: string, cx: number, cz: number, sx: number, sz: number): void => {
    const m = MeshBuilder.CreateBox(name, { width: sx, height: 4.5, depth: sz }, scene);
    m.position = new Vector3(cx, 2.25, cz);
    m.material = bMat;
    addBox(colliders, cx, 2.25, cz, sx, 4.5, sz);
  };
  // north wall with center door gap (gap x -2.5..2.5)
  mkBldWall("bN-L", -8.25, 24, 11.5, 1);
  mkBldWall("bN-R", 8.25, 24, 11.5, 1);
  // south wall with wide door gap (gap x -3..3)
  mkBldWall("bS-L", -8.5, 38, 11, 1);
  mkBldWall("bS-R", 8.5, 38, 11, 1);
  mkBldWall("bW", -14, 31, 1, 15);
  mkBldWall("bE", 14, 31, 1, 15);
  // interior crates
  const crateMat = mat(scene, "crate", new Color3(0.3, 0.32, 0.38));
  const mkCrate = (name: string, x: number, z: number, s: number, yBase = 0): Mesh => {
    const m = MeshBuilder.CreateBox(name, { width: s, height: s, depth: s }, scene);
    const gy = groundHeightAt(x, z);
    m.position = new Vector3(x, gy + yBase + s / 2, z);
    m.material = crateMat;
    m.rotation.y = (x * 13.7 + z * 7.3) % 0.6;
    addBox(colliders, x, gy + yBase + s / 2, z, s, s, s);
    return m;
  };
  // purposeful cover in yard
  mkCrate("c1", -10, 4, 2.4); mkCrate("c2", 10, 6, 2.4); mkCrate("c3", -6, -14, 2.0);
  mkCrate("c4", 8, -14, 2.0); mkCrate("c5", -18, -6, 2.8); mkCrate("c6", 18, -4, 2.8);
  mkCrate("c7", -24, 12, 2.2); mkCrate("c8", 24, 14, 2.2); mkCrate("c9", 0, 14, 2.0);
  mkCrate("c10", 34, 4, 2.6); mkCrate("c11", -34, -20, 2.6);
  mkCrate("ci1", -9, 31, 2.0); mkCrate("ci2", 9, 31, 2.0);

  // --- boss arena (east): circular pad + gate pillars ---
  const arena = MeshBuilder.CreateDisc("arena", { radius: 15, tessellation: 48 }, scene);
  arena.rotation.x = -Math.PI / 2;
  arena.position = new Vector3(46, 0.03, 2);
  arena.material = mat(scene, "arenaM", new Color3(0.2, 0.16, 0.18), new Color3(0.08, 0.03, 0.03));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = 46 + Math.cos(a) * 14, pz = 2 + Math.sin(a) * 14;
    const pil = MeshBuilder.CreateCylinder(`arenaP-${i}`, { height: 7, diameter: 1.4 }, scene);
    pil.position = new Vector3(px, 3.5, pz);
    pil.material = i % 2 ? accentMat : wallMat;
    addBox(colliders, px, 3.5, pz, 1.4, 7, 1.4);
  }

  // --- relay tower landmark (center-north of yard) ---
  const relayPos = new Vector3(0, 0, -8);
  const towerMat = mat(scene, "tower", new Color3(0.25, 0.3, 0.4), new Color3(0.1, 0.14, 0.2));
  const tower = MeshBuilder.CreateCylinder("relayTower", { height: 16, diameterTop: 2.2, diameterBottom: 3.4 }, scene);
  tower.position = new Vector3(relayPos.x, 8, relayPos.z);
  tower.material = towerMat;
  addBox(colliders, relayPos.x, 2, relayPos.z, 3.2, 4, 3.2);
  const beaconMat = mat(scene, "beacon", new Color3(1, 0.7, 0.3), new Color3(1, 0.55, 0.15));
  const beacon = MeshBuilder.CreateSphere("relayBeacon", { diameter: 2.2 }, scene);
  beacon.position = new Vector3(relayPos.x, 16.6, relayPos.z);
  beacon.material = beaconMat;
  const relayRadius = 9;
  const ring = MeshBuilder.CreateTorus("relayRing", { diameter: relayRadius * 2, thickness: 0.35, tessellation: 64 }, scene);
  ring.position = new Vector3(relayPos.x, 0.25, relayPos.z);
  ring.material = mat(scene, "ringM", new Color3(1, 0.7, 0.3), new Color3(0.9, 0.5, 0.12));

  // --- exploration caches (6) ---
  const cacheSpots: Vector3[] = [
    new Vector3(-40, 0, -34), // on walkway west
    new Vector3(40, 0, -34),  // on walkway east
    new Vector3(0, 0, 31),    // inside shortcut
    new Vector3(46, 0, 2),    // boss arena center edge
    new Vector3(-30, 0, 20),
    new Vector3(28, 0, -18),
  ];
  const cacheMat = mat(scene, "cache", new Color3(0.2, 0.5, 0.6), new Color3(0.1, 0.4, 0.5));
  const caches: CacheSpot[] = cacheSpots.map((p, i) => {
    const gy = groundHeightAt(p.x, p.z);
    const m = MeshBuilder.CreateBox(`cache-${i}`, { width: 1.6, height: 1.2, depth: 1.6 }, scene);
    m.position = new Vector3(p.x, gy + 0.6, p.z);
    m.material = cacheMat;
    const glow = MeshBuilder.CreateSphere(`cacheGlow-${i}`, { diameter: 0.7 }, scene);
    glow.position = new Vector3(p.x, gy + 1.8, p.z);
    glow.material = mat(scene, `cacheGlowM-${i}`, new Color3(0.4, 1, 1), new Color3(0.3, 0.9, 1));
    return { pos: new Vector3(p.x, gy, p.z), taken: false, mesh: m, glow };
  });

  // scattered small props (visual only, no collision)
  const propMat = mat(scene, "prop", new Color3(0.16, 0.18, 0.22));
  for (let i = 0; i < 26; i++) {
    const px = -55 + ((i * 37.7) % 110);
    const pz = -20 + ((i * 53.3) % 80);
    if (Math.abs(px) < 6 && Math.abs(pz + 8) < 12) continue;
    const s = MeshBuilder.CreateBox(`prop-${i}`, { width: 0.8, height: 0.4 + (i % 3) * 0.4, depth: 0.8 }, scene);
    s.position = new Vector3(px, groundHeightAt(px, pz) + 0.3, pz);
    s.material = propMat;
  }

  const spawnPoints: Vector3[] = [
    new Vector3(-30, 0, -10), new Vector3(30, 0, -12), new Vector3(-28, 0, 22),
    new Vector3(28, 0, 24), new Vector3(0, 0, -24), new Vector3(-52, 0, 10),
    new Vector3(60, 0, -14), new Vector3(46, 0, 18), new Vector3(-12, 0, -34),
    new Vector3(14, 0, 34),
  ].map((p) => new Vector3(p.x, groundHeightAt(p.x, p.z), p.z));

  // Green Zone courtyard art test: in-place dressing, no topology change.
  dressCourtyard(scene, colliders);

  return {
    colliders, caches, relayPos, relayRadius, relayRing: ring,
    towerMeshes: [tower, beacon], spawnPoints,
    bossGate: new Vector3(32, 0, 2), bounds: 66, walkwayTop: 6,
  };
}
