// Green Zone courtyard slice: pure layout data + validation (no engine imports).
// All boxes are [cx, cy, cz, sx, sy, sz] world units. greenzone.ts turns them
// into meshes + AABB colliders; tests/greenzone.test.ts validates them here.
export type BoxTuple = [number, number, number, number, number, number];

export interface GzBox { name: string; box: BoxTuple; solid: boolean; }

/** New solid colliders introduced by the Green Zone slice. */
export const GZ_SOLIDS: GzBox[] = [
  // Service courtyard flanking buildings (faces at |x| = 15).
  { name: "gz-bldW", box: [-17, 4.5, 2, 4, 9, 36], solid: true },
  { name: "gz-bldE", box: [17, 5.5, 2, 4, 11, 36], solid: true },
  // Alley cache nook (west): annex block + two guide stubs (4-wide entry).
  { name: "gz-annex", box: [-34.5, 2.5, 20, 5, 5, 12], solid: true },
  { name: "gz-alleyN", box: [-24, 1, 15.5, 0.6, 2, 3], solid: true },
  { name: "gz-alleyS", box: [-24, 1, 24.5, 0.6, 2, 3], solid: true },
  // Relay installation: two equipment cabinets inside the ring edge.
  { name: "gz-cabW", box: [-6.5, 1, -8, 1.4, 2, 1], solid: true },
  { name: "gz-cabE", box: [6.5, 1, -8, 1.4, 2, 1], solid: true },
  // Walkway deck-edge railings (ramp mouths are at the x ends, unaffected).
  { name: "gz-railN", box: [0, 6.55, -39.7, 80, 1.1, 0.4], solid: true },
  { name: "gz-railS", box: [0, 6.55, -30.3, 80, 1.1, 0.4], solid: true },
  // South courtyard cover pair.
  { name: "gz-covW", box: [-8, 0.55, 16, 2.2, 1.1, 0.8], solid: true },
  { name: "gz-covE", box: [8, 0.55, 16, 2.2, 1.1, 0.8], solid: true },
  // Parked service vehicle (axis-aligned by design).
  { name: "gz-truck", box: [23, 1.1, 8, 2.2, 2.2, 5], solid: true },
  // Planter boxes along the facades (low cover).
  { name: "gz-planW1", box: [-13.5, 0.35, -6, 1.6, 0.7, 1.6], solid: true },
  { name: "gz-planW2", box: [-13.5, 0.35, 10, 1.6, 0.7, 1.6], solid: true },
  { name: "gz-planE1", box: [13.5, 0.35, -6, 1.6, 0.7, 1.6], solid: true },
  { name: "gz-planE2", box: [13.5, 0.35, 10, 1.6, 0.7, 1.6], solid: true },
  // Courtyard trees (trunk proxies).
  { name: "gz-treeW", box: [-11, 1, 22, 0.5, 2, 0.5], solid: true },
  { name: "gz-treeE", box: [11, 1, 22, 0.5, 2, 0.5], solid: true },
  // Transit-beam piers (north yard background structure).
  { name: "gz-pierW", box: [-40, 6.5, -52, 2, 13, 2], solid: true },
  { name: "gz-pierE", box: [40, 6.5, -52, 2, 13, 2], solid: true },
];

/** Points that must stay walkable (player spawn/caches/route), with clearance. */
export const GZ_KEEP_CLEAR: { name: string; x: number; z: number; r: number }[] = [
  { name: "spawn-default", x: 4, z: 12, r: 1.2 },
  { name: "relay-center", x: 0, z: -8, r: 2.5 },
  { name: "doorN", x: 0, z: 24, r: 2.5 },
  { name: "doorS", x: 0, z: 38, r: 2.5 },
  { name: "rampW-mouth", x: -45, z: -30, r: 3 },
  { name: "rampW-deck", x: -38, z: -35, r: 2 },
  { name: "rampE-mouth", x: 45, z: -30, r: 3 },
  { name: "rampE-deck", x: 38, z: -35, r: 2 },
  { name: "alley-entry", x: -24, z: 20, r: 2 },
  { name: "cache-alley", x: -30, z: 20, r: 1.5 },
  { name: "cache-deckW", x: -40, z: -34, r: 1.5 },
  { name: "cache-deckE", x: 40, z: -34, r: 1.5 },
  { name: "spawn-nw", x: -30, z: -10, r: 1.2 },
  { name: "spawn-ne", x: 30, z: -12, r: 1.2 },
  { name: "spawn-sw", x: -28, z: 22, r: 1.2 },
  { name: "spawn-se", x: 28, z: 24, r: 1.2 },
];

/** Pre-existing solids inside the courtyard region (for route checks). */
export const GZ_EXISTING: BoxTuple[] = [
  [-10, 1.2, 4, 2.4, 2.4, 2.4], // c1
  [10, 1.2, 6, 2.4, 2.4, 2.4], // c2
  [0, 1, 14, 2, 2, 2], // c9
  [-5, 0.55, -2, 2.2, 1.1, 0.8], // cy-coverW
  [5, 0.55, -2, 2.2, 1.1, 0.8], // cy-coverE
  [-3, 1.6, 4, 0.35, 3.2, 0.35], [3, 1.6, 4, 0.35, 3.2, 0.35], // canopy
  [-3, 1.6, -1, 0.35, 3.2, 0.35], [3, 1.6, -1, 0.35, 3.2, 0.35],
  [0, 2, -8, 3.2, 4, 3.2], // relay tower
  [-8.25, 2.25, 24, 11.5, 4.5, 1], [8.25, 2.25, 24, 11.5, 4.5, 1], // bN walls
  [-24, 1.1, 12, 2.2, 2.2, 2.2], // c7
  [-11, 0.55, 22.2, 0.9, 1.1, 0.9], // cy-barrel
];

function overlapsPlayerHeight(box: BoxTuple): boolean {
  const [, cy, , , sy] = box;
  // Player body spans roughly y 0.2..1.6 at grade (deck boxes handled same way).
  return cy - sy / 2 < 1.6 && cy + sy / 2 > 0.2;
}

function dist2d(ax: number, az: number, box: BoxTuple): number {
  const [cx, , cz, sx, , sz] = box;
  const dx = Math.max(Math.abs(ax - cx) - sx / 2, 0);
  const dz = Math.max(Math.abs(az - cz) - sz / 2, 0);
  return Math.hypot(dx, dz);
}

/** Returns human-readable violations (empty = layout valid). */
export function validateGreenZone(solids: GzBox[] = GZ_SOLIDS): string[] {
  const problems: string[] = [];
  for (const p of GZ_KEEP_CLEAR) {
    for (const s of solids) {
      if (!s.solid || !overlapsPlayerHeight(s.box)) continue;
      if (dist2d(p.x, p.z, s.box) < p.r) {
        problems.push(`${s.name} blocks ${p.name}`);
      }
    }
  }
  // Courtyard lane must stay connected: probe a walkable grid for routes
  // between spawn, the relay ring edge, and the alley (1-unit cells,
  // existing + new solids).
  const blocked = (x: number, z: number): boolean => {
    if (x < -34 || x > 34 || z < -26 || z > 28) return true;
    for (const s of solids) {
      if (!s.solid || !overlapsPlayerHeight(s.box)) continue;
      if (dist2d(x, z, s.box) < 0.7) return true;
    }
    for (const b of GZ_EXISTING) {
      if (!overlapsPlayerHeight(b)) continue;
      if (dist2d(x, z, b) < 0.7) return true;
    }
    return false;
  };
  const route = (ax: number, az: number, bx: number, bz: number): boolean => {
    const key = (x: number, z: number): string => `${x},${z}`;
    const seen = new Set<string>([key(ax, az)]);
    const queue: [number, number][] = [[ax, az]];
    while (queue.length) {
      const [x, z] = queue.pop()!;
      if (Math.hypot(x - bx, z - bz) < 1.5) return true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx!, nz = z + dz!;
        if (seen.has(key(nx, nz)) || blocked(nx, nz)) continue;
        seen.add(key(nx, nz));
        queue.push([nx, nz]);
      }
    }
    return false;
  };
  if (!route(4, 12, 0, 1)) problems.push("no walkable route spawn -> relay ring");
  if (!route(0, 1, -24, 20)) problems.push("no walkable route relay -> alley");
  if (!route(4, 12, -30, 20)) problems.push("no walkable route spawn -> alley cache");
  return problems;
}
