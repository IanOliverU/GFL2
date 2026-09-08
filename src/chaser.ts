// Ordinary Chaser enemy: original articulated gas-mask trooper.
// Asset audit (2026-09-08): assets/GFL2 Varjagers holds ONLY six 250px PNG
// story references (Berserker boss + five Felagi variants) — no models,
// skeletons, clips, or textures, and no authorization to port anything from
// another project. Per the milestone, this is an ORIGINAL build (no cube,
// no undocumented download): olive fatigues, vest, gas mask with bright
// red visor lenses, helmet, gaiter — echoing the references, sharing no art.
// Blender MCP is unavailable in this environment, so joints are
// TransformNode hierarchies posed procedurally each tick (no root motion:
// all animation is in-place rotation, speed/reach stay authoritative).
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";

function cmat(scene: Scene, name: string, emissive: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White();
  m.emissiveColor = emissive;
  m.specularColor = new Color3(0.12, 0.12, 0.14);
  return m;
}

const PALETTE = {
  fatigue: new Color3(0.42, 0.42, 0.3),
  dark: new Color3(0.15, 0.14, 0.16),
  helmet: new Color3(0.35, 0.36, 0.25),
  lens: new Color3(1, 0.06, 0.04),
  gaiter: new Color3(0.45, 0.38, 0.5),
  vest: new Color3(0.3, 0.3, 0.33),
  gold: new Color3(0.85, 0.65, 0.25),
};

/** Joint tree of one Chaser instance (all TransformNodes under the root). */
export interface ChaserJoints {
  hips: TransformNode; torso: TransformNode; head: TransformNode;
  shoulderL: TransformNode; shoulderR: TransformNode;
  elbowL: TransformNode; elbowR: TransformNode;
  hipL: TransformNode; hipR: TransformNode;
  kneeL: TransformNode; kneeR: TransformNode;
  vestMesh: Mesh; lodMesh: Mesh;
}

/** Per-instance animation state (independent per enemy). */
export interface ChaserAnim {
  phase: number; speedSm: number;
  flinchT: number; strikeT: number;
  moveX: number; moveZ: number;
}

export function chaserNewAnim(): ChaserAnim {
  return { phase: 0, speedSm: 0, flinchT: 0, strikeT: 0, moveX: 0, moveZ: 0 };
}

type TrackedNode = TransformNode | Mesh;
type PartKind = "box" | "sph" | "cyl";
interface PartSpec {
  kind: PartKind; name: string; color: Color3;
  a: number; b: number; c: number;
  x: number; y: number; z: number; squashY?: number;
}

function tn(scene: Scene, created: TrackedNode[], name: string, parent: TransformNode | Mesh, x: number, y: number, z: number): TransformNode {
  const t = new TransformNode(name, scene);
  created.push(t);
  t.parent = parent;
  t.position.set(x, y, z);
  return t;
}

function part(scene: Scene, created: TrackedNode[], mat: StandardMaterial, spec: PartSpec): Mesh {
  let m: Mesh;
  if (spec.kind === "box") m = MeshBuilder.CreateBox(spec.name, { width: spec.a, height: spec.b, depth: spec.c }, scene);
  else if (spec.kind === "sph") m = MeshBuilder.CreateSphere(spec.name, { diameter: spec.a, segments: 2 }, scene);
  else m = MeshBuilder.CreateCylinder(spec.name, { height: spec.b, diameterTop: spec.a, diameterBottom: spec.c, tessellation: 8 }, scene);
  created.push(m);
  m.position.set(spec.x, spec.y, spec.z);
  if (spec.kind === "sph") m.scaling.y = spec.squashY ?? 1;
  m.material = mat;
  const colors: number[] = [];
  for (let i = 0; i < m.getTotalVertices(); i++) colors.push(spec.color.r, spec.color.g, spec.color.b, 1);
  m.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
  m.useVertexColors = true;
  m.isPickable = false;
  return m;
}

function rigid(scene: Scene, created: TrackedNode[], parent: TransformNode | Mesh,
  mat: StandardMaterial, name: string, specs: PartSpec[]): Mesh {
  const pieces = specs.map((spec) => part(scene, created, mat, spec));
  const mesh = pieces.length === 1 ? pieces[0]! : Mesh.MergeMeshes(pieces, true, true, undefined, false, false);
  if (!mesh) throw new Error(`Could not merge ${name}`);
  if (!created.includes(mesh)) created.push(mesh);
  mesh.name = name;
  mesh.parent = parent;
  mesh.material = mat;
  mesh.useVertexColors = true;
  mesh.isPickable = false;
  return mesh;
}

const spec = (kind: PartKind, name: string, color: Color3,
  a: number, b: number, c: number, x: number, y: number, z: number, squashY?: number): PartSpec =>
  ({ kind, name, color, a, b, c, x, y, z, squashY });

/**
 * Build one Chaser visual as children of `root` (the enemy position/yaw
 * node owned by the sim). Returns joints + the per-instance body material
 * (hit-flash target). Visual height ~2.25 against the unchanged r=0.7
 * collider. Throws on failure — caller keeps the legacy box fallback.
 */
export function buildChaserVisual(scene: Scene, root: Mesh, elite: boolean): { joints: ChaserJoints; vestMat: StandardMaterial } {
  const created: TrackedNode[] = [];
  const vestMat = cmat(scene, `ch-body-${root.name}`,
    elite ? new Color3(0.12, 0.08, 0.02) : new Color3(0.025, 0.025, 0.02));
  const prefix = root.name;
  try {
    // One vertex-colored mesh per moving joint cuts an ordinary Chaser from
    // 27 draw calls to 11 without removing any articulation.
    const hips = tn(scene, created, `${prefix}-hips`, root, 0, 1.0, 0);
    rigid(scene, created, hips, vestMat, `${prefix}-pelvis`, [
      spec("box", `${prefix}-pelvis-src`, PALETTE.fatigue, 0.55, 0.3, 0.4, 0, 0, 0),
    ]);
    const torso = tn(scene, created, `${prefix}-torso`, hips, 0, 0.15, 0);
    const vestColor = elite ? PALETTE.gold : PALETTE.vest;
    const torsoSpecs = [
      spec("box", `${prefix}-vest-src`, vestColor, 0.7, 0.65, 0.5, 0, 0.35, 0),
      spec("box", `${prefix}-plate-src`, PALETTE.dark, 0.5, 0.4, 0.12, 0, 0.35, -0.3),
      spec("box", `${prefix}-pack-src`, PALETTE.fatigue, 0.45, 0.4, 0.2, 0, 0.4, 0.33),
      spec("box", `${prefix}-markL-src`, PALETTE.lens, 0.2, 0.1, 0.06, 0.42, 0.58, -0.1),
      spec("box", `${prefix}-markR-src`, PALETTE.lens, 0.2, 0.1, 0.06, -0.42, 0.58, -0.1),
      spec("sph", `${prefix}-padL-src`, PALETTE.fatigue, 0.24, 0, 0, 0.48, 0.62, 0, 0.8),
      spec("sph", `${prefix}-padR-src`, PALETTE.fatigue, 0.24, 0, 0, -0.48, 0.62, 0, 0.8),
    ];
    if (elite) {
      torsoSpecs.push(
        spec("box", `${prefix}-epaulL-src`, PALETTE.gold, 0.24, 0.12, 0.3, 0.48, 0.72, 0),
        spec("box", `${prefix}-epaulR-src`, PALETTE.gold, 0.24, 0.12, 0.3, -0.48, 0.72, 0),
      );
    }
    const vestMesh = rigid(scene, created, torso, vestMat, `${prefix}-body`, torsoSpecs);

    const head = tn(scene, created, `${prefix}-head`, torso, 0, 0.75, 0);
    rigid(scene, created, head, vestMat, `${prefix}-head-mesh`, [
      spec("sph", `${prefix}-helmet-src`, PALETTE.helmet, 0.56, 0, 0, 0, 0.12, 0, 0.85),
      spec("cyl", `${prefix}-brim-src`, PALETTE.helmet, 0.62, 0.07, 0.62, 0, 0.02, 0),
      spec("box", `${prefix}-mask-src`, PALETTE.dark, 0.3, 0.3, 0.25, 0, -0.05, -0.14),
      spec("sph", `${prefix}-lensL-src`, PALETTE.lens, 0.09, 0, 0, 0.1, 0, -0.26),
      spec("sph", `${prefix}-lensR-src`, PALETTE.lens, 0.09, 0, 0, -0.1, 0, -0.26),
      spec("cyl", `${prefix}-filter-src`, PALETTE.dark, 0.14, 0.18, 0.18, 0, -0.24, -0.16),
      spec("cyl", `${prefix}-gaiter-src`, PALETTE.gaiter, 0.3, 0.16, 0.16, 0, -0.28, 0.02),
    ]);

    const mkArm = (side: "L" | "R"): { shoulder: TransformNode; elbow: TransformNode } => {
      const sx = side === "L" ? 0.48 : -0.48;
      const shoulder = tn(scene, created, `${prefix}-sh${side}`, torso, sx, 0.55, 0);
      rigid(scene, created, shoulder, vestMat, `${prefix}-upper${side}`, [
        spec("box", `${prefix}-upper${side}-src`, PALETTE.fatigue, 0.18, 0.5, 0.2, 0, -0.28, 0),
      ]);
      const elbow = tn(scene, created, `${prefix}-el${side}`, shoulder, 0, -0.55, 0);
      rigid(scene, created, elbow, vestMat, `${prefix}-lower${side}`, [
        spec("box", `${prefix}-fore${side}-src`, PALETTE.fatigue, 0.16, 0.45, 0.18, 0, -0.25, 0),
        spec("sph", `${prefix}-fist${side}-src`, PALETTE.dark, 0.16, 0, 0, 0, -0.52, -0.02),
      ]);
      return { shoulder, elbow };
    };
    const armL = mkArm("L");
    const armR = mkArm("R");

    const mkLeg = (side: "L" | "R"): { hip: TransformNode; knee: TransformNode } => {
      const sx = side === "L" ? 0.22 : -0.22;
      const hip = tn(scene, created, `${prefix}-hip${side}`, hips, sx, -0.05, 0);
      rigid(scene, created, hip, vestMat, `${prefix}-thigh${side}`, [
        spec("box", `${prefix}-thigh${side}-src`, PALETTE.fatigue, 0.22, 0.42, 0.24, 0, -0.23, 0),
      ]);
      const knee = tn(scene, created, `${prefix}-knee${side}`, hip, 0, -0.47, 0);
      rigid(scene, created, knee, vestMat, `${prefix}-lower-leg${side}`, [
        spec("box", `${prefix}-shin${side}-src`, PALETTE.dark, 0.18, 0.34, 0.2, 0, -0.2, 0),
        spec("box", `${prefix}-boot${side}-src`, PALETTE.dark, 0.2, 0.15, 0.36, 0, -0.39, -0.06),
      ]);
      return { hip, knee };
    };
    const legL = mkLeg("L");
    const legR = mkLeg("R");

    if (elite) {
      const crown = MeshBuilder.CreateTorus(`${prefix}-crown`, { diameter: 0.7, thickness: 0.09, tessellation: 12 }, scene);
      created.push(crown);
      crown.parent = hips; // horizontal and independent of head scan/flinch
      crown.position.y = 1.43;
      crown.material = vestMat;
      const colors: number[] = [];
      for (let i = 0; i < crown.getTotalVertices(); i++) colors.push(PALETTE.gold.r, PALETTE.gold.g, PALETTE.gold.b, 1);
      crown.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
      crown.useVertexColors = true;
      crown.isPickable = false;
    }

    // Far crowds retain a distinct trooper silhouette at one draw call.
    const lodMesh = rigid(scene, created, root, vestMat, `${prefix}-lod`, [
      spec("box", `${prefix}-lod-legL`, PALETTE.dark, 0.2, 0.75, 0.22, 0.2, 0.42, 0),
      spec("box", `${prefix}-lod-legR`, PALETTE.dark, 0.2, 0.75, 0.22, -0.2, 0.42, 0),
      spec("box", `${prefix}-lod-torso`, vestColor, 0.72, 0.85, 0.48, 0, 1.3, 0),
      spec("box", `${prefix}-lod-armL`, PALETTE.fatigue, 0.18, 0.75, 0.2, 0.48, 1.25, 0),
      spec("box", `${prefix}-lod-armR`, PALETTE.fatigue, 0.18, 0.75, 0.2, -0.48, 1.25, 0),
      spec("sph", `${prefix}-lod-head`, PALETTE.helmet, 0.55, 0, 0, 0, 1.95, 0, 0.9),
      spec("box", `${prefix}-lod-mask`, PALETTE.dark, 0.3, 0.28, 0.22, 0, 1.88, -0.2),
      spec("box", `${prefix}-lod-visor`, PALETTE.lens, 0.26, 0.07, 0.04, 0, 1.96, -0.33),
    ]);
    lodMesh.setEnabled(false);
    return {
      joints: {
        hips, torso, head,
        shoulderL: armL.shoulder, shoulderR: armR.shoulder,
        elbowL: armL.elbow, elbowR: armR.elbow,
        hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee,
        vestMesh, lodMesh,
      },
      vestMat,
    };
  } catch (error) {
    for (let i = created.length - 1; i >= 0; i--) {
      const node = created[i]!;
      if (!node.isDisposed()) node.dispose(false);
    }
    vestMat.dispose();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Pose kernel. Conventions (model faces -Z, verified on Tololo): limb swing
// forward = +rotX, knee flexion (heel back) = -rotX. No root motion.
// ---------------------------------------------------------------------------

export interface ChaserPoseInput {
  speedFactor: number; // 0 idle .. ~1 full stride
  phase: number;
  time: number;
  windup: number; // 0..1 telegraph overlay
  strike: number; // 0..1 strike envelope overlay
  flinch: number; // 0..1 hit-reaction overlay (visual only)
  stunned: boolean;
}

export interface ChaserAngles {
  torsoX: number; torsoY: number; headX: number; headY: number;
  shLX: number; shRX: number; elLX: number; elRX: number;
  hipLX: number; hipRX: number; kneeLX: number; kneeRX: number;
  hipsDip: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Strike envelope length in seconds (visual only). */
export const CHASER_STRIKE_DUR = 0.32;

/**
 * Telegraph weight 0..1: ramps in as the chaser closes the last stretch
 * before reach while its cooldown runs down. Pure visual — the damage
 * condition is unchanged (the base system has no wind-up interval).
 */
export function chaserWindup(dist: number, attackRange: number, attackT: number): number {
  const d = clamp01(1 - (dist - attackRange) / 0.9);
  const t = clamp01(1 - attackT / 0.6);
  return Math.min(d, t);
}

/** Pure joint-angle solver (unit-testable, no scene). */
export function chaserPoseAngles(s: ChaserPoseInput): ChaserAngles {
  const sf = clamp01(s.speedFactor);
  const swing = Math.sin(s.phase);
  const swingOpp = Math.sin(s.phase + Math.PI);
  let a: ChaserAngles;
  if (s.stunned) {
    a = {
      torsoX: 0.3, torsoY: 0, headX: 0.3, headY: 0,
      shLX: 0.15, shRX: 0.15, elLX: -0.15, elRX: -0.15,
      hipLX: 0.05, hipRX: -0.05, kneeLX: -0.15, kneeRX: -0.15,
      hipsDip: 0.06,
    };
  } else {
    const breathe = Math.sin(s.time * 1.8) * 0.02;
    const scan = Math.sin(s.time * 0.5) * 0.2 * (1 - sf);
    a = {
      torsoX: breathe - 0.03 * sf,
      torsoY: 0.03 * swing * sf,
      headX: 0,
      headY: scan,
      shLX: 0.45 * swingOpp * sf - 0.06 + breathe,
      shRX: 0.45 * swing * sf - 0.06 - breathe,
      elLX: -0.35 - 0.15 * sf,
      elRX: -0.35 - 0.15 * sf,
      hipLX: 0.5 * swing * sf,
      hipRX: 0.5 * swingOpp * sf,
      kneeLX: -(0.12 + 0.55 * sf * (0.5 + 0.5 * swingOpp)),
      kneeRX: -(0.12 + 0.55 * sf * (0.5 + 0.5 * swing)),
      hipsDip: 0.035 * Math.abs(Math.cos(s.phase)) * sf,
    };
    // Attack anticipation: lean back and extend both arms toward the player.
    const w = clamp01(s.windup);
    a.torsoX += -0.18 * w;
    a.shLX += 0.9 * w;
    a.shRX += 0.9 * w;
    a.elLX += -0.2 * w;
    a.elRX += -0.2 * w;
    a.headX += -0.1 * w;
    // Damage occurs at strike phase zero. Start from the full anticipation
    // pose, push the right arm farther toward the player, then recover. This
    // keeps the event continuous without changing authoritative attack time.
    if (s.strike > 0) {
      const p = clamp01(s.strike);
      const recover = 1 - p;
      const followThrough = Math.sin(p * Math.PI);
      a.torsoX += -0.18 * recover + 0.16 * followThrough;
      a.torsoY += 0.08 * followThrough;
      a.shLX += 0.9 * recover + 0.15 * followThrough;
      a.shRX += 0.9 * recover + 0.35 * followThrough;
      a.elLX += -0.2 * recover;
      a.elRX += -0.2 * recover;
      a.headX += -0.1 * recover;
    }
  }
  // Hit reaction: brief torso/head rock. Never touches stun/attack timers.
  const f = clamp01(s.flinch);
  a.torsoX += -0.15 * f;
  a.headX += -0.2 * f;
  a.headY += 0.25 * f * Math.sin(s.time * 40);
  return a;
}

export function applyChaserAngles(j: ChaserJoints, a: ChaserAngles): void {
  j.torso.rotation.set(a.torsoX, a.torsoY, 0);
  j.head.rotation.set(a.headX, a.headY, 0);
  j.shoulderL.rotation.set(a.shLX, 0, -0.08);
  j.shoulderR.rotation.set(a.shRX, 0, 0.08);
  j.elbowL.rotation.set(a.elLX, 0, 0);
  j.elbowR.rotation.set(a.elRX, 0, 0);
  j.hipL.rotation.set(a.hipLX, 0, 0.03);
  j.hipR.rotation.set(a.hipRX, 0, -0.03);
  j.kneeL.rotation.set(a.kneeLX, 0, 0);
  j.kneeR.rotation.set(a.kneeRX, 0, 0);
  j.hips.position.y = 1.0 - a.hipsDip;
}

/** Advance per-instance timers from real elapsed time + measured speed. */
export function chaserStepAnim(a: ChaserAnim, dt: number, speed: number): void {
  a.speedSm += (Math.min(1.2, speed / 4) - a.speedSm) * Math.min(1, 8 * dt);
  a.phase += dt * (2.2 + 7.5 * a.speedSm);
  a.flinchT = Math.max(0, a.flinchT - dt);
  a.strikeT = Math.max(0, a.strikeT - dt);
}
