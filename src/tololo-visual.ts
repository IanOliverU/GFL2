// Tololo PMX art-slice loading (local review only, unapproved).
// Loads the staged PMX (see scripts/stage-tololo.mjs + docs/tololo-art-slice.md)
// through babylon-mmd, then fits it to gameplay scale with feet on the ground.
// Any failure resolves to "placeholder" so the game is never blocked.
//
// Animation: the loader alone imports bind-pose geometry — direct bone writes
// are ignored because nothing uploads skin matrices (see docs/tololo-art-slice
// §11). Posing therefore goes through a babylon-mmd MmdModel with physics
// disabled: set linkedBone.rotationQuaternion, then model.beforePhysics(null)
// + model.afterPhysics() each frame to recompute worldTransformMatrices
// (append-twist + IK solved there). No VMD/clips; all poses are procedural.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { IMmdRuntimeBone } from "babylon-mmd/esm/Runtime/IMmdRuntimeBone";
import type { MmdModel } from "babylon-mmd/esm/Runtime/mmdModel";
import type { MmdRuntime } from "babylon-mmd/esm/Runtime/mmdRuntime";

export const TOLOLO_PMX_URL = "mmd/tololo/tololo.pmx";
// Gameplay visual height in world units, anchored to the placeholder the
// world was tuned against: capsule top 1.85 + head top ~2.375, camera pivot at
// pos.y+1.9, door height 4.5, crates 2.0-2.8, enemies 1.3-4.4. Parity keeps
// cover readability and the tuned third-person framing exact.
export const TOLOLO_TARGET_HEIGHT = 2.35;
// Screenshot review (front camera showed hair/back, rear camera showed the
// face): the PMX bind pose faces local -Z, opposite the player root's local
// +Z forward. Correct with a half-turn so the face follows the aim direction.
export const TOLOLO_YAW_OFFSET = Math.PI;

export type TololoVisual =
  | { status: "pmx"; root: TransformNode; approxHeight: number; loadMs: number; rig: TololoRig }
  | { status: "placeholder"; reason: string };

/** Procedural animation rig for one loaded Tololo root (physics disabled). */
export interface TololoRig {
  runtime: MmdRuntime;
  model: MmdModel;
  bones: Map<string, IMmdRuntimeBone>;
  /** Normalizing scale on the visual root (playerMesh stays at 1). */
  scale: number;
  /** Root lift placing PMX feet on the player-root ground plane. */
  lift: number;
  rawHeight: number;
  /** Bind-pose rest data for an attached root (anatomy checks). */
  rest: TololoRestPose | null;
  /** IK reach flags from the last static tick (measurement only). */
  lastIkR: boolean;
  lastIkL: boolean;
  locomotion: TololoLocomotionState;
}

/** Per-frame gameplay state driving the procedural pose. All fields unitless/SI as noted. */
export interface TololoPoseState {
  /** Horizontal speed (units/s) for locomotion blending. */
  speed: number;
  /** Collision-resolved horizontal velocity in world space. */
  velocityX: number;
  velocityZ: number;
  yaw: number;
  grounded: boolean;
  aiming: boolean;
  /** Look pitch in radians (positive up). */
  pitch: number;
  /** Firing recoil 0..1 (Simulation.gunRecoil). */
  recoil: number;
  reloading: boolean;
  dodgeT: number;
  alive: boolean;
  /** Run clock in seconds for idle breathing / walk phase. */
  time: number;
}

/**
 * Tunable hold-pose constants (radians unless noted). Bone-local axes align
 * with model axes at rest, and the bind pose faces model -Z (corrected to
 * player +Z by TOLOLO_YAW_OFFSET) — so forward swings/leans are POSITIVE
 * rotX, knee flexion is NEGATIVE rotX. Corrected 2026-09-08 after headless
 * measurement showed the first guess swinging the arms backward (wrists at
 * player-local z=-0.48). Still console-tunable in dev; confirm by capture.
 */
export const tololoPoseParams = {
  shoulderFwd: 0.95,
  shoulderOut: 0.28,
  elbowBend: 1.05,
  wristPitch: 0.15,
  torsoLean: -0.1,
  aimLeanGain: 0.25,
  headGain: 0.5,
  breatheAmp: 0.03,
  walkSwing: 0.18,
  recoilKick: 0.22,
  /** Rear-grip bias between right (0) and left (1) wrist for the mount. */
  mountBias: 0.5,
};

// LEFT-wrist carry mount, measured by forward kinematics over the rest-pose
// bone chain (model space -> playerMesh space with the fit scale). Values are
// constants because the bind pose never changes; re-measure if the model does.
//   left wrist player-local: (-0.70, 1.51, -0.06).
// Side note (verified numerically): playerMesh.rotation.y = yaw + PI flips
// local x, so player-local -x renders on world +x — the SAME side as the
// authoritative shot origin (world side +0.35, height +1.45, forward 0.8 at
// yaw 0). The pre-existing shared hip mount sits on the opposite side from
// the shot line for every placeholder character (gun-right vs shots-left,
// ~0.75 units apart); that is left untouched as a flagged pre-existing quirk.
// Mount sits a touch low/forward of the palm so the receiver overlaps the hand
// while the muzzle tip lands near the shot origin; slight inward cant halves
// the remaining lateral gap. Combat math is untouched.
export const TOLOLO_HAND_MOUNT_POS = new Vector3(-0.7, 1.46, -0.16);
export const TOLOLO_HAND_MOUNT_ROTY = 0.17;
// Original hip mount (shared by every other character — restore verbatim).
export const HIP_MOUNT_POS = new Vector3(0.4, 1.35, 0.1);

export interface RifleMount {
  weaponMount: TransformNode;
  muzzleNode: TransformNode;
}

/**
 * Simulation surface needed by the static hold: explicit weapon anchors,
 * contact markers, the honest muzzle sink, and the player root.
 * (Structural typing — Simulation satisfies this without importing it.)
 */
export interface TololoHoldSim extends RifleMount {
  mainGripNode: TransformNode;
  supportGripNode: TransformNode;
  stockNode: TransformNode;
  markerContactR: Mesh;
  markerContactL: Mesh;
  muzzleOverride: Vector3 | null;
  playerMesh: TransformNode;
  pos: Vector3;
  yaw: number;
}

/** Static-hold gate. True = one stationary hold, all dynamic offsets off. */
export const tololoHoldMode: { static: boolean } = { static: true };
/** Same-build verification switch; production keeps lower-body locomotion on. */
export const tololoLocomotionMode: { enabled: boolean } = { enabled: true };

/**
 * Static hold tuning (player units / radians unless noted). All provisional
 * pending capture review; console-tunable in dev via this import.
 */
export const tololoHoldParams = {
  /** Shoulder-pocket offset from the right upper-arm joint (player units). */
  stockIn: 0.08,
  stockUp: 0.03,
  stockFwd: 0.0,
  /** Elbow pole directions (player space). */
  poleR: new Vector3(0.7, -1, 0.15),
  poleL: new Vector3(-0.7, -1, 0.15),
  /** Desired hand world orientations (model-space yaw/pitch/roll). */
  wristR: { yaw: 0, pitch: 1.15, roll: -0.35 },
  wristL: { yaw: 0, pitch: 1.15, roll: 0.35 },
  /** Upper-arm axial twist about the solved upper direction. */
  twistR: 0,
  twistL: 0,
  /** Finger segment curl about segment-local Z (sign provisional). */
  fingerCurl: [0.55, 0.75, 0.6],
  fingerCurlSignR: 1,
  fingerCurlSignL: -1,
  thumbYaw: 0.3,
  thumbPitch: 0.2,
  thumbRoll: 0.5,
  /** Static stance (legs) and head. */
  hipSplay: 0.07,
  kneeBend: -0.1,
  headPitch: 0,
  headRoll: 0,
};

/** Procedural lower-body tuning. Upper-body and weapon ownership stay separate. */
export const tololoLocomotionParams = {
  response: 11,
  stopResponse: 14,
  strideRadiansPerUnit: 1.28,
  moveThreshold: 0.12,
  fullWeightSpeed: 1.8,
  runStart: 5.5,
  runFull: 9.5,
  walkThigh: 0.3,
  runThigh: 0.5,
  reverseScale: 0.72,
  strafeThigh: 0.1,
  walkStrafe: 0.2,
  runStrafe: 0.3,
  walkKnee: 0.3,
  runKnee: 0.5,
  ankleCounter: 0.42,
  idleSway: 0.012,
};

export interface TololoLocomotionState {
  phase: number;
  forward: number;
  right: number;
  weight: number;
}

export interface TololoLegPose {
  lowerPitch: number;
  lowerRoll: number;
  thighPitchL: number;
  thighPitchR: number;
  thighRollL: number;
  thighRollR: number;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
  toeL: number;
  toeR: number;
  speed: number;
  run: number;
}

export function newTololoLocomotionState(): TololoLocomotionState {
  return { phase: 0, forward: 0, right: 0, weight: 0 };
}

/** Project a world-space velocity onto Tololo's facing-relative axes. */
export function tololoLocalVelocity(
  velocityX: number, velocityZ: number, yaw: number,
): { forward: number; right: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const forward = velocityX * -sin + velocityZ * -cos;
  const right = velocityX * cos + velocityZ * -sin;
  return {
    forward: forward || 0,
    right: right || 0,
  };
}

function saturate(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function smoothstep(a: number, b: number, v: number): number {
  const t = saturate((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Advance direction blends and distance-driven stride phase without root motion. */
export function stepTololoLocomotion(
  state: TololoLocomotionState,
  velocityX: number,
  velocityZ: number,
  yaw: number,
  grounded: boolean,
  dodging: boolean,
  dt: number,
): TololoLocomotionState {
  const p = tololoLocomotionParams;
  const local = tololoLocalVelocity(velocityX, velocityZ, yaw);
  const enabled = grounded && !dodging;
  const targetForward = enabled ? local.forward : 0;
  const targetRight = enabled ? local.right : 0;
  const targetSpeed = Math.hypot(targetForward, targetRight);
  const currentSpeed = Math.hypot(state.forward, state.right);
  const safeDt = Math.min(0.05, Math.max(0, dt));
  const response = targetSpeed > currentSpeed ? p.response : p.stopResponse;
  const blend = 1 - Math.exp(-response * safeDt);
  state.forward += (targetForward - state.forward) * blend;
  state.right += (targetRight - state.right) * blend;
  const targetWeight = enabled
    ? saturate((targetSpeed - p.moveThreshold) / (p.fullWeightSpeed - p.moveThreshold))
    : 0;
  state.weight += (targetWeight - state.weight) * blend;
  if (enabled && targetSpeed > p.moveThreshold) {
    state.phase = (state.phase + targetSpeed * safeDt * p.strideRadiansPerUnit) % (Math.PI * 2);
  }
  return state;
}

/** Pure lower-body pose sampled from the blended locomotion state. */
export function tololoLegPose(
  state: TololoLocomotionState, time: number,
): TololoLegPose {
  const p = tololoLocomotionParams;
  const speed = Math.hypot(state.forward, state.right);
  const run = smoothstep(p.runStart, p.runFull, speed);
  const dirForward = speed > 1e-4 ? state.forward / speed : 0;
  const dirRight = speed > 1e-4 ? state.right / speed : 0;
  const reverse = dirForward < 0 ? p.reverseScale : 1;
  const stride = Math.sin(state.phase);
  const liftL = Math.max(0, stride);
  const liftR = Math.max(0, -stride);
  const thighAmp = (p.walkThigh + (p.runThigh - p.walkThigh) * run) * state.weight;
  const strafeAmp = (p.walkStrafe + (p.runStrafe - p.walkStrafe) * run) * state.weight;
  const kneeAmp = (p.walkKnee + (p.runKnee - p.walkKnee) * run) * state.weight;
  const forwardSwing = stride * dirForward * thighAmp * reverse;
  const crossSwing = stride * Math.abs(dirRight) * p.strafeThigh * state.weight;
  const lateralSwing = stride * dirRight * strafeAmp;
  const baseThigh = 0.04;
  const baseKnee = tololoHoldParams.kneeBend;
  const thighPitchL = baseThigh + forwardSwing + crossSwing;
  const thighPitchR = baseThigh - forwardSwing - crossSwing;
  const kneeL = baseKnee - liftL * kneeAmp;
  const kneeR = baseKnee - liftR * kneeAmp;
  return {
    lowerPitch: -0.025 * dirForward * state.weight,
    lowerRoll: Math.sin(time * 1.8) * p.idleSway * (1 - state.weight)
      - Math.cos(state.phase * 2) * 0.025 * state.weight,
    thighPitchL,
    thighPitchR,
    thighRollL: tololoHoldParams.hipSplay + lateralSwing,
    thighRollR: -tololoHoldParams.hipSplay + lateralSwing,
    kneeL,
    kneeR,
    ankleL: -thighPitchL * p.ankleCounter - kneeL * 0.18,
    ankleR: -thighPitchR * p.ankleCounter - kneeR * 0.18,
    toeL: -liftL * 0.08 * state.weight,
    toeR: -liftR * 0.08 * state.weight,
    speed,
    run,
  };
}

/** Bind-pose arm measurements (model space, PMX units). Null until measured. */
export interface TololoRestPose {
  shoulderR: Vector3; elbowR: Vector3; wristR: Vector3; midTipR: Vector3;
  shoulderL: Vector3; elbowL: Vector3; wristL: Vector3; midTipL: Vector3;
  shoulderTopR: Vector3;
  upperLenR: number; foreLenR: number; upperLenL: number; foreLenL: number;
  upperDirR: Vector3; foreDirR: Vector3; upperDirL: Vector3; foreDirL: Vector3;
  palmLocalR: Vector3; palmLocalL: Vector3;
}

/**
 * Convert an MMD-model-space bone translation (PMX units, visual-root space)
 * into playerMesh-local units. The visual root carries the single normalizing
 * scale plus a half-turn yaw (TOLOLO_YAW_OFFSET = PI): rotY(PI) maps
 * (x, y, z) -> (-x, y, -z). Pure function — covered by unit tests.
 */
export function tololoModelToPlayer(
  mx: number, my: number, mz: number, scale: number, lift: number, out: Vector3,
): Vector3 {
  out.set(-mx * scale, lift + my * scale, -mz * scale);
  return out;
}

/**
 * Rifle mount point between the rear (right) and front (left) grips.
 * bias 0 = rear grip, 1 = front grip. Pure function — covered by unit tests.
 * (Legacy midpoint strategy; the static hold uses explicit anchors instead.)
 */
export function tololoHoldMount(
  rear: Vector3, front: Vector3, bias: number, out: Vector3,
): Vector3 {
  const b = Math.min(1, Math.max(0, bias));
  out.set(
    rear.x + (front.x - rear.x) * b,
    rear.y + (front.y - rear.y) * b,
    rear.z + (front.z - rear.z) * b,
  );
  return out;
}

/** Inverse of tololoModelToPlayer (player units -> model units). Pure. */
export function tololoPlayerToModel(
  px: number, py: number, pz: number, scale: number, lift: number, out: Vector3,
): Vector3 {
  out.set(-px / scale, (py - lift) / scale, -pz / scale);
  return out;
}

/**
 * Player-local point to world space through the player root
 * (position + yaw + PI, no scale). Pure — covered by unit tests.
 */
export function tololoPlayerToWorld(
  px: number, py: number, pz: number, simPos: Vector3, yaw: number, out: Vector3,
): Vector3 {
  const a = yaw + Math.PI;
  const c = Math.cos(a), s = Math.sin(a);
  out.set(simPos.x + px * c + pz * s, simPos.y + py, simPos.z - px * s + pz * c);
  return out;
}

/** Shortest-arc quaternion rotating unit `from` onto unit `to`. Pure. */
export function tololoQuatFromTo(from: Vector3, to: Vector3, out: Quaternion): Quaternion {
  const d = Math.min(1, Math.max(-1, from.dot(to)));
  if (d > 0.999999) return out.set(0, 0, 0, 1);
  _axis.set(
    from.y * to.z - from.z * to.y,
    from.z * to.x - from.x * to.z,
    from.x * to.y - from.y * to.x,
  );
  if (d < -0.999999) {
    // Opposite vectors: pick any perpendicular axis.
    if (Math.abs(from.x) < 0.9) _axis.set(1, 0, 0);
    else _axis.set(0, 1, 0);
    const px = from.y * _axis.z - from.z * _axis.y;
    const py = from.z * _axis.x - from.x * _axis.z;
    const pz = from.x * _axis.y - from.y * _axis.x;
    _axis.set(px, py, pz);
    _axis.normalize();
    return Quaternion.RotationAxisToRef(_axis, Math.PI, out);
  }
  _axis.normalize();
  return Quaternion.RotationAxisToRef(_axis, Math.acos(d), out);
}

const _axis = /* @__PURE__ */ Vector3.Zero();

/**
 * Two-bone IK: elbow position for root S, target T, lengths L1/L2, pole hint.
 * Returns reach info; elbow is exact when the target is reachable, clamped
 * toward the target otherwise. Pure — covered by unit tests.
 */
export function tololoSolveTwoBoneIk(
  s: Vector3, t: Vector3, l1: number, l2: number, pole: Vector3,
  outElbow: Vector3,
): { clamped: boolean; dist: number } {
  _ikD.copyFrom(t).subtractInPlace(s);
  let dist = _ikD.length();
  const maxReach = l1 + l2 - 1e-5;
  const minReach = Math.abs(l1 - l2) + 1e-5;
  let clamped = false;
  if (dist > maxReach) { dist = maxReach; clamped = true; }
  if (dist < minReach) { dist = minReach; clamped = true; }
  if (_ikD.lengthSquared() < 1e-12) _ikD.set(0, -1, 0);
  else _ikD.normalize();
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const a = l1 * cosA;
  const h = l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // Bend-plane normal from the pole hint.
  const pd = pole.dot(_ikD);
  _ikN.set(pole.x - _ikD.x * pd, pole.y - _ikD.y * pd, pole.z - _ikD.z * pd);
  if (_ikN.lengthSquared() < 1e-10) {
    if (Math.abs(_ikD.x) < 0.9) _ikN.set(1, 0, 0);
    else _ikN.set(0, 1, 0);
    const qx = _ikD.y * _ikN.z - _ikD.z * _ikN.y;
    const qy = _ikD.z * _ikN.x - _ikD.x * _ikN.z;
    const qz = _ikD.x * _ikN.y - _ikD.y * _ikN.x;
    _ikN.set(qx, qy, qz);
  }
  _ikN.normalize();
  outElbow.set(
    s.x + _ikD.x * a + _ikN.x * h,
    s.y + _ikD.y * a + _ikN.y * h,
    s.z + _ikD.z * a + _ikN.z * h,
  );
  return { clamped, dist };
}

const _ikD = /* @__PURE__ */ Vector3.Zero();
const _ikN = /* @__PURE__ */ Vector3.Zero();

/** Seat the shared placeholder rifle in Tololo's right hand (low carry). */
export function mountRifleToHand(mount: RifleMount): void {
  mount.weaponMount.position.copyFrom(TOLOLO_HAND_MOUNT_POS);
  mount.weaponMount.rotation.set(0, TOLOLO_HAND_MOUNT_ROTY, 0);
}

/** Restore the shared hip mount used by the placeholder characters. */
export function restoreRifleHip(mount: RifleMount): void {
  mount.weaponMount.position.copyFrom(HIP_MOUNT_POS);
  mount.weaponMount.rotation.set(0, 0, 0);
}

// Single-flight shared import plus a spare pool. Rationale: babylon-mmd keeps
// loading PMX textures asynchronously after the meshes resolve; disposing a
// root while its textures are still in flight crashes inside the loader
// (unhandled pageerror). So concurrent startRun calls share one import, stale
// results are parked (never disposed mid-load), and spares are reused.
let inflight: Promise<TololoVisual> | null = null;
const spares: TransformNode[] = [];
/** Live animation rigs by visual root. Entries persist while parked. */
const rigByRoot = new Map<TransformNode, TololoRig>();
/** One MmdRuntime per scene (creation/destruction only; updates are manual per active model). */
const runtimeByScene = new Map<Scene, MmdRuntime>();

export function takeSpareTololo(): TransformNode | null {
  const spare = spares.pop() ?? null;
  if (spare) spare.setEnabled(true);
  return spare;
}

export function parkTololoSpare(root: TransformNode): void {
  root.parent = null;
  root.setEnabled(false);
  // Bound growth; gameplay realistically parks zero or one.
  if (spares.length < 3) {
    spares.push(root);
    return;
  }
  // Overflow only: the root was previously attached (textures settled), so
  // destroying its runtime model before disposal is safe. Never dispose a
  // root whose async PMX textures may still be in flight (see above).
  const rig = rigByRoot.get(root);
  if (rig) {
    try {
      rig.runtime.destroyMmdModel(rig.model);
    } catch {
      // Best effort; the root dispose below still runs.
    }
    rigByRoot.delete(root);
  }
  root.dispose();
}

/** Live rig for an attached Tololo root, if it was created with one. */
export function getTololoRig(root: TransformNode): TololoRig | null {
  return rigByRoot.get(root) ?? null;
}

/** Clear presentation state when a run starts or a pooled model is reused. */
export function resetTololoLocomotion(root: TransformNode): void {
  const state = rigByRoot.get(root)?.locomotion;
  if (!state) return;
  state.phase = 0;
  state.forward = 0;
  state.right = 0;
  state.weight = 0;
}

export function tryLoadTololoPmx(scene: Scene, url = TOLOLO_PMX_URL): Promise<TololoVisual> {
  if (inflight) return inflight;
  inflight = loadTololoPmx(scene, url).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function loadTololoPmx(scene: Scene, url: string): Promise<TololoVisual> {
  const started = performance.now();
  try {
    // Minimal registration: model loaders on demand + BMP texture support for
    // the PMX's spa/*.bmp toon/sphere maps. No animation/physics runtime
    // (bind pose only — full animation production is out of scope).
    const { RegisterMmdModelLoaders } = await import("babylon-mmd/esm/Loader/dynamic");
    RegisterMmdModelLoaders();
    const { RegisterDxBmpTextureLoader } = await import("babylon-mmd/esm/Loader/registerDxBmpTextureLoader");
    RegisterDxBmpTextureLoader();
    // Registers the default shared MMD material builder (diffuse + toon +
    // sphere). Without this, geometry imports with no materials at all.
    await import("babylon-mmd/esm/Loader/mmdModelLoader");
    const { SceneLoader } = await import("@babylonjs/core/Loading/sceneLoader");

    const slash = url.lastIndexOf("/");
    const rootUrl = slash >= 0 ? url.slice(0, slash + 1) : "";
    const fileName = slash >= 0 ? url.slice(slash + 1) : url;
    const result = await SceneLoader.ImportMeshAsync("", rootUrl, fileName, scene);
    if (result.meshes.length === 0) throw new Error("PMX import produced no meshes");

    // TRUE-geometry fit. Do NOT use mesh.getBoundingInfo here: babylon-mmd
    // pads every mesh bounding box by boundingBoxMargin (default 10 PMX units
    // per side), which previously produced a ~2x underscale plus a hover
    // offset. Raw vertex positions have no margin.
    // At import time the meshes are parentless at scene origin, so world
    // matrices map directly to PMX model space.
    let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    let vertTotal = 0;
    for (const mesh of result.meshes) {
      const asMesh = mesh as unknown as {
        getVerticesData?: (kind: string) => number[] | null;
        computeWorldMatrix?: (force: boolean) => void;
        getWorldMatrix?: () => { m: number[] | Float32Array };
      };
      const positions = asMesh.getVerticesData?.("position") ?? null;
      if (!positions || !asMesh.computeWorldMatrix || !asMesh.getWorldMatrix) continue;
      asMesh.computeWorldMatrix(true);
      const me = asMesh.getWorldMatrix().m;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
        const wx = me[0]! * x + me[4]! * y + me[8]! * z + me[12]!;
        const wy = me[1]! * x + me[5]! * y + me[9]! * z + me[13]!;
        const wz = me[2]! * x + me[6]! * y + me[10]! * z + me[14]!;
        if (wx < min.x) min.x = wx; if (wx > max.x) max.x = wx;
        if (wy < min.y) min.y = wy; if (wy > max.y) max.y = wy;
        if (wz < min.z) min.z = wz; if (wz > max.z) max.z = wz;
      }
      vertTotal += positions.length / 3;
    }
    const height = max.y - min.y;
    if (!Number.isFinite(height) || height <= 0.01 || vertTotal === 0) {
      for (const mesh of result.meshes) mesh.dispose();
      throw new Error("PMX import produced empty true geometry bounds");
    }
    // Sanity guard: this model measures ~18 PMX units tall. A wildly
    // different number means a swapped model or a loader behavior change.
    if (height < 10 || height > 30) {
      console.warn(`[tololo] unexpected raw height ${height.toFixed(2)} (expected ~18); fit continues`);
    }

    const root = new TransformNode("tololo-visual", scene);
    for (const mesh of result.meshes) {
      if (!mesh.parent) mesh.parent = root;
    }
    // Single normalizing scale on the visual root; playerMesh stays at 1.
    const scale = TOLOLO_TARGET_HEIGHT / height;
    root.scaling.setAll(scale);
    // Feet on the player-root ground plane (y=0 in playerMesh space).
    const lift = -min.y * scale;
    root.position.y = lift;
    root.rotation.y = TOLOLO_YAW_OFFSET;
    console.info(`[tololo] fit: rawHeight=${height.toFixed(2)} verts=${vertTotal} scale=${scale.toFixed(4)} lift=${lift.toFixed(3)}`);

    // Animation runtime (no physics): find the MMD root mesh carrying model
    // metadata + skeleton, then create one MmdModel for procedural posing.
    // Failure here falls back to the bind-pose root (still scaled/grounded);
    // gameplay is never blocked.
    let rig: TololoRig;
    try {
      const mmdRoot = result.meshes.find((m) => {
        const meta = (m as unknown as { metadata?: Record<string, unknown> }).metadata;
        return !!meta && (meta as { isMmdModel?: unknown }).isMmdModel === true
          && (meta as { skeleton?: unknown }).skeleton != null;
      });
      if (!mmdRoot) throw new Error("PMX import produced no MMD root mesh");
      let runtime = runtimeByScene.get(scene);
      if (!runtime) {
        const { MmdRuntime } = await import("babylon-mmd/esm/Runtime/mmdRuntime");
        runtime = new MmdRuntime(scene, null);
        runtimeByScene.set(scene, runtime);
      }
      const model = runtime.createMmdModel(mmdRoot as never, { buildPhysics: false });
      // Deterministic FK control: disable every IK solver (legs included) so
      // procedural rotations are never overwritten by the IK stage. Revisit
      // if grounded IK feet are wanted later.
      model.ikSolverStates.fill(0);
      const bones = new Map<string, IMmdRuntimeBone>();
      for (const b of model.runtimeBones) bones.set(b.name, b);
      rig = {
        runtime, model, bones, scale, lift, rawHeight: height, rest: null,
        lastIkR: false, lastIkL: false, locomotion: newTololoLocomotionState(),
      };
      // Bind-pose arm measurements for the static-hold IK (identity pose is
      // current: nothing has been posed yet on this fresh model).
      rig.rest = measureTololoRest(rig);
      if (!rig.rest) console.warn("[tololo] rest-pose measurement incomplete; static hold disabled for this root");
      rigByRoot.set(root, rig);
      // Console inspection in dev (?dev=1): externalRoot.metadata.tololoRig.
      (root as unknown as { metadata: unknown }).metadata = { tololoRig: rig };
      console.info(`[tololo] runtime: model with ${bones.size} bones, physics off, IK disabled`);
    } catch (rigErr) {
      console.warn("[tololo] animation runtime unavailable, bind pose only:", rigErr);
      // Bind-pose fallback still needs a rig-shaped entry for tick() to skip.
      const fallback = {
        runtime: null, model: null, bones: new Map(), scale, lift, rawHeight: height,
        rest: null, lastIkR: false, lastIkL: false, locomotion: newTololoLocomotionState(),
      };
      rig = fallback as unknown as TololoRig;
    }
    return { status: "pmx", root, approxHeight: TOLOLO_TARGET_HEIGHT, loadMs: performance.now() - started, rig };
  } catch (err) {
    console.warn(`[tololo] PMX load failed (${url}), using placeholder:`, err);
    return { status: "placeholder", reason: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Procedural posing (two-handed hold + locomotion/aim/fire layering).
// ---------------------------------------------------------------------------

const _q = /* @__PURE__ */ Quaternion.Identity();
const _v = /* @__PURE__ */ Vector3.Zero();
const _rear = /* @__PURE__ */ Vector3.Zero();
const _front = /* @__PURE__ */ Vector3.Zero();
const _mid = /* @__PURE__ */ Vector3.Zero();

function setBoneRotation(rig: TololoRig, name: string, yaw: number, pitch: number, roll: number): boolean {
  const bone = rig.bones.get(name);
  if (!bone) return false;
  Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, _q);
  bone.linkedBone.rotationQuaternion = _q.clone();
  return true;
}

/**
 * Absolute two-handed rifle-hold pose with gameplay layering. Every posed
 * bone is written absolutely each tick (no accumulation, no drift):
 * - base: arms forward/inward, elbows flexed, wrists level, slight torso lean
 * - idle: breathing sway on shoulders (tololoPoseParams.breatheAmp)
 * - locomotion: speed-blended arm counter-swing + torso bob phase
 * - aiming: torso/head pitch follows look pitch; tighter elbows
 * - firing: recoil kick on shoulders scaled by Simulation.gunRecoil
 * Legs stay near bind in a slight combat stance (FK, IK disabled); full
 * grounded stepping is deferred until the hold direction is approved.
 */
export function poseTololo(rig: TololoRig, s: TololoPoseState): void {
  if (!rig.model) return;
  const p = tololoPoseParams;
  const walk = Math.min(1, s.speed / 6);
  const phase = s.time * 9;
  const swing = Math.sin(phase) * p.walkSwing * walk;
  const breathe = Math.sin(s.time * 1.8) * p.breatheAmp;
  const kick = Math.min(1, Math.max(0, s.recoil)) * p.recoilKick;
  const aimTight = s.aiming ? 0.12 : 0;
  const lean = p.torsoLean + s.pitch * p.aimLeanGain + (s.reloading ? -0.08 : 0);

  // Torso + neck + head: lean into the shot, head tracks the look pitch
  // (face -Z at rest; positive rotX pitches the face up).
  setBoneRotation(rig, "上半身", 0, lean * 0.5, 0);
  setBoneRotation(rig, "上半身2", 0, lean * 0.5, 0);
  setBoneRotation(rig, "首", 0, s.pitch * p.headGain * 0.5, 0);
  setBoneRotation(rig, "頭", 0, s.pitch * p.headGain * 0.5, 0);

  // Shoulders hold the rifle line; recoil kicks both up, walk swings them.
  const shFwd = p.shoulderFwd + breathe + kick;
  setBoneRotation(rig, "左腕", 0.06, shFwd + swing, -p.shoulderOut);
  setBoneRotation(rig, "右腕", -0.06, shFwd + kick * 0.5 - swing, p.shoulderOut);
  setBoneRotation(rig, "左肩", 0, 0.12, -0.1);
  setBoneRotation(rig, "右肩", 0, 0.12, 0.1);

  // Elbows flex the forearms up to the rifle; aiming tightens the support arm.
  setBoneRotation(rig, "左ひじ", 0.25 + aimTight, p.elbowBend + aimTight, 0);
  setBoneRotation(rig, "右ひじ", -0.15, p.elbowBend * 0.85 + kick * 0.4, 0);
  setBoneRotation(rig, "左手首", 0, p.wristPitch, 0);
  setBoneRotation(rig, "右手首", 0, p.wristPitch + kick * 0.3, 0);

  // Combat stance: thighs slightly forward, soft knees (flexion is -rotX),
  // knees deepen in dodge.
  const crouch = s.dodgeT > 0 ? 0.35 : 0.1 + walk * 0.06;
  setBoneRotation(rig, "左足", 0, crouch * 0.4, 0.07);
  setBoneRotation(rig, "右足", 0, crouch * 0.4, -0.07);
  setBoneRotation(rig, "左ひざ", 0, -crouch, 0);
  setBoneRotation(rig, "右ひざ", 0, -crouch, 0);
  setBoneRotation(rig, "センター", 0, 0, 0);
}

/** Push the current procedural pose into the skin matrices (no animation clip). */
export function updateTololoModel(rig: TololoRig): void {
  if (!rig.model) return;
  rig.model.beforePhysics(null);
  rig.model.afterPhysics();
}

/**
 * Seat the placeholder rifle between the hands: mount position tracks the
 * wrist midpoint (rear-bias tunable), orientation follows the grip line with
 * the look pitch. Replaces the temporary fixed left-wrist offset; combat
 * math is untouched (Simulation.muzzlePos stays authoritative).
 */
export function alignRifleToHands(rig: TololoRig, mount: RifleMount, s: TololoPoseState): void {
  const rear = rig.bones.get("右手首");
  const front = rig.bones.get("左手首");
  if (!rear || !front || !rig.model) return;
  rear.getWorldTranslationToRef(_v);
  tololoModelToPlayer(_v.x, _v.y, _v.z, rig.scale, rig.lift, _rear);
  front.getWorldTranslationToRef(_v);
  tololoModelToPlayer(_v.x, _v.y, _v.z, rig.scale, rig.lift, _front);
  tololoHoldMount(_rear, _front, tololoPoseParams.mountBias, _mid);
  mount.weaponMount.position.copyFrom(_mid);
  // Grip line yaw: rifle long axis (+Z) from rear grip toward front grip,
  // blended with straight-ahead so extreme hand crossings cannot spin the gun.
  const dx = _front.x - _rear.x;
  const dz = _front.z - _rear.z;
  let lineYaw = 0;
  if (Math.abs(dx) + Math.abs(dz) > 1e-4) lineYaw = Math.atan2(dx, dz);
  const blended = lineYaw * 0.35 + TOLOLO_HAND_MOUNT_ROTY * 0.65;
  mount.weaponMount.rotation.set(s.pitch * 0.55, blended, 0);
}

/**
 * Full per-frame visual tick for an attached Tololo root. Static-hold mode
 * (unapproved hold correction in progress) runs the anchored IK hold;
 * legacy layered pose returns only after the hold passes review.
 */
export function tickTololoVisual(
  root: TransformNode, mount: RifleMount, dt: number, s: TololoPoseState,
): void {
  if (!s.alive) return;
  const rig = rigByRoot.get(root);
  if (!rig || !rig.model) return;
  if (tololoLocomotionMode.enabled) {
    stepTololoLocomotion(
      rig.locomotion, s.velocityX, s.velocityZ, s.yaw,
      s.grounded, s.dodgeT > 0, dt,
    );
  }
  if (tololoHoldMode.static) {
    tickTololoStaticHold(root, mount as TololoHoldSim, s);
    return;
  }
  poseTololo(rig, s);
  updateTololoModel(rig);
  alignRifleToHands(rig, mount, s);
}

/** Model-space wrist translation for verification (null when unavailable). */
export function probeTololoWrist(root: TransformNode, name: string, out: Vector3): boolean {
  const rig = rigByRoot.get(root);
  const bone = rig?.bones.get(name);
  if (!rig || !rig.model || !bone) return false;
  bone.getWorldTranslationToRef(out);
  return true;
}

// ---------------------------------------------------------------------------
// Static rifle hold (focused correction, hold status: INCOMPLETE).
// Authoritative chain (no circularity): weapon pose <- shoulder pocket + aim
// pitch; both arms <- weapon anchors via analytic two-bone IK; fingers are
// static curls. Dynamics (breathing/swing/recoil/reload/dodge) stay OFF until
// the static hold passes visual review.
// ---------------------------------------------------------------------------

/** Mount-local anchor features on the placeholder rifle (matches sim.ts). */
const MOUNT_SCALE = 0.6;
const MAIN_LOCAL = new Vector3(0, -0.14, 0.35);
// Support hand grips the receiver over the mag: the placeholder's barrel
// mid-point is beyond her 0.67-unit arm reach (margin kept for upward aim).
// Revisit with a real fore-end when the authored weapon lands.
const SUP_LOCAL = new Vector3(0, 0.02, 0.42);
const STOCK_LOCAL = new Vector3(0, 0.06, -0.58);
const MUZZLE_LOCAL = new Vector3(0, 0.08, 1.45);

const FINGERS_R = [
  "右人指１", "右人指２", "右人指３",
  "右中指１", "右中指２", "右中指３",
  "右小指１", "右小指２", "右小指３",
  "右薬指１", "右薬指２", "右薬指３",
];
const THUMB_R = ["右親指０", "右親指１", "右親指２"];
const FINGERS_L = FINGERS_R.map((n) => n.replace("右", "左"));
const THUMB_L = THUMB_R.map((n) => n.replace("右", "左"));

const _hm = /* @__PURE__ */ Quaternion.Identity();
const _hq = /* @__PURE__ */ Quaternion.Identity();
const _qr = /* @__PURE__ */ Quaternion.Identity();
const _qe = /* @__PURE__ */ Quaternion.Identity();
const _qw = /* @__PURE__ */ Quaternion.Identity();
const _qt = /* @__PURE__ */ Quaternion.Identity();
const _a = /* @__PURE__ */ Vector3.Zero();
const _b = /* @__PURE__ */ Vector3.Zero();
const _c = /* @__PURE__ */ Vector3.Zero();
const _d = /* @__PURE__ */ Vector3.Zero();
const _e = /* @__PURE__ */ Vector3.Zero();
const _f = /* @__PURE__ */ Vector3.Zero();
// Dedicated mount scratch: solveHoldArm reuses _a.._f, so the mount position
// must never live in shared scratch across a solve call (a clobbered mount
// once sent the muzzle override to the ground — see §14).
const _mountPos = /* @__PURE__ */ Vector3.Zero();
const _wpA = /* @__PURE__ */ Vector3.Zero();
const _wpB = /* @__PURE__ */ Vector3.Zero();
const _wpC = /* @__PURE__ */ Vector3.Zero();
const _mpM = /* @__PURE__ */ Vector3.Zero();
const _mpM2 = /* @__PURE__ */ Vector3.Zero();
const _mpM3 = /* @__PURE__ */ Vector3.Zero();
const _mpQ = /* @__PURE__ */ Quaternion.Identity();

function readBoneModel(rig: TololoRig, name: string, out: Vector3): boolean {
  const b = rig.bones.get(name);
  if (!b) return false;
  b.getWorldTranslationToRef(out);
  return true;
}

function setIdentity(rig: TololoRig, name: string): void {
  rig.bones.get(name)?.linkedBone.rotationQuaternion.set(0, 0, 0, 1);
}

/**
 * Bind-pose arm measurements for the IK solver. Resets the hold bones to
 * identity first so the result is valid whenever it is called.
 */
export function measureTololoRest(rig: TololoRig): TololoRestPose | null {
  if (!rig.model) return null;
  for (const n of [
    "上半身", "上半身2", "首", "頭", "センター",
    "左肩", "右肩", "左腕", "右腕", "左ひじ", "右ひじ", "左手首", "右手首",
    ...FINGERS_L, ...FINGERS_R, ...THUMB_L, ...THUMB_R,
  ]) setIdentity(rig, n);
  rig.model.beforePhysics(null);
  rig.model.afterPhysics();
  const v = (n: string): Vector3 | null => {
    const b = rig.bones.get(n);
    if (!b) return null;
    const o = new Vector3();
    b.getWorldTranslationToRef(o);
    return o;
  };
  const shoulderR = v("右腕"); const elbowR = v("右ひじ"); const wristR = v("右手首");
  const midTipR = v("右中指３") ?? v("右中指２");
  const shoulderTopR = v("右肩");
  const shoulderL = v("左腕"); const elbowL = v("左ひじ"); const wristL = v("左手首");
  const midTipL = v("左中指３") ?? v("左中指２");
  if (!shoulderR || !elbowR || !wristR || !midTipR || !shoulderTopR
    || !shoulderL || !elbowL || !wristL || !midTipL) return null;
  const dir = (a: Vector3, b: Vector3): Vector3 => b.subtract(a).normalize();
  const palmLocalR = midTipR.subtract(wristR).scaleInPlace(0.45).clone();
  const palmLocalL = midTipL.subtract(wristL).scaleInPlace(0.45).clone();
  return {
    shoulderR, elbowR, wristR, midTipR, shoulderL, elbowL, wristL, midTipL, shoulderTopR,
    upperLenR: elbowR.subtract(shoulderR).length(),
    foreLenR: wristR.subtract(elbowR).length(),
    upperLenL: elbowL.subtract(shoulderL).length(),
    foreLenL: wristL.subtract(elbowL).length(),
    upperDirR: dir(shoulderR, elbowR), foreDirR: dir(elbowR, wristR),
    upperDirL: dir(shoulderL, elbowL), foreDirL: dir(elbowL, wristL),
    palmLocalR, palmLocalL,
  };
}

/** Bind-pose rest data for an attached root (anatomy checks). */
export function getTololoRest(root: TransformNode): TololoRestPose | null {
  return rigByRoot.get(root)?.rest ?? null;
}

function curlFingers(rig: TololoRig, names: string[], curl: number[], sign: number): void {
  for (let f = 0; f < 4; f++) {
    for (let sgi = 0; sgi < 3; sgi++) {
      const bone = rig.bones.get(names[f * 3 + sgi]!);
      if (!bone) continue;
      Quaternion.RotationYawPitchRollToRef(0, 0, curl[sgi]! * sign, _qt);
      bone.linkedBone.rotationQuaternion = _qt.clone();
    }
  }
}

function poseThumb(rig: TololoRig, names: string[], mirror: number): void {
  const p = tololoHoldParams;
  const angles: [number, number, number][] = [
    [p.thumbYaw * mirror, p.thumbPitch, p.thumbRoll * mirror],
    [0, 0.35, 0.15 * mirror],
    [0, 0.4, 0],
  ];
  names.forEach((n, i) => {
    const bone = rig.bones.get(n);
    if (!bone || !angles[i]) return;
    Quaternion.RotationYawPitchRollToRef(angles[i][0], angles[i][1], angles[i][2], _qt);
    bone.linkedBone.rotationQuaternion = _qt.clone();
  });
}

interface ArmSolution {
  clamped: boolean;
}

/** Solve one arm (model space) and write its three joint rotations. */
function solveHoldArm(
  rig: TololoRig, rest: TololoRestPose, side: "R" | "L",
  shoulder: Vector3, upperLen: number, foreLen: number,
  upperDir0: Vector3, foreDir0: Vector3, palmLocal: Vector3,
  anchorM: Vector3, poleM: Vector3, handEuler: { yaw: number; pitch: number; roll: number },
  twist: number, upperName: string, foreName: string, handName: string,
): ArmSolution {
  // Desired hand orientation first: the wrist joint sits one palm-length
  // behind the grip along the hand axis (wrist origins are not contacts).
  Quaternion.RotationYawPitchRollToRef(handEuler.yaw, handEuler.pitch, handEuler.roll, _hm);
  palmLocal.applyRotationQuaternionToRef(_hm, _a);
  _b.copyFrom(anchorM).subtractInPlace(_a); // wrist target (model)
  const { clamped } = tololoSolveTwoBoneIk(shoulder, _b, upperLen, foreLen, poleM, _c);
  // Upper: shortest arc rest->solved, plus axial twist.
  _c.subtract(shoulder).normalizeToRef(_d);
  tololoQuatFromTo(upperDir0, _d, _qr);
  if (twist !== 0) {
    Quaternion.RotationAxisToRef(_d, twist, _qt);
    _qt.multiplyToRef(_qr, _qr);
  }
  // Forearm: express the desired world direction in the posed upper frame.
  _b.copyFrom(_b).subtractInPlace(_c).normalizeToRef(_e);
  _qr.conjugateToRef(_qt);
  _e.applyRotationQuaternionToRef(_qt, _f);
  tololoQuatFromTo(foreDir0, _f, _qe);
  // Wrist: parent world is Qu*Qe by construction; land exactly on H.
  _qr.multiplyToRef(_qe, _qw);
  _qw.conjugateToRef(_qt);
  _qt.multiplyToRef(_hm, _qw);
  rig.bones.get(upperName)!.linkedBone.rotationQuaternion = _qr.clone();
  rig.bones.get(foreName)!.linkedBone.rotationQuaternion = _qe.clone();
  rig.bones.get(handName)!.linkedBone.rotationQuaternion = _qw.clone();
  return { clamped };
}

/**
 * Single source of truth for the held weapon transform (player space):
 * stock welded to the right-shoulder pocket, barrel +Z pitched with the
 * look (muzzle up on +pitch). Used by the visual tick AND by the
 * synchronous fire-time muzzle computation, so shots can never observe a
 * stale pose. Own scratch only — safe to call anywhere.
 */
export function tololoWeaponPose(
  rest: TololoRestPose, scale: number, lift: number, ms: number, pitch: number,
  outMount: Vector3, outQuat: Quaternion,
): void {
  const p = tololoHoldParams;
  Quaternion.RotationYawPitchRollToRef(0, -pitch, 0, outQuat);
  tololoModelToPlayer(rest.shoulderR.x, rest.shoulderR.y, rest.shoulderR.z, scale, lift, _wpA);
  _wpA.x -= p.stockIn; _wpA.y += p.stockUp; _wpA.z += p.stockFwd;
  _wpB.set(STOCK_LOCAL.x * ms, STOCK_LOCAL.y * ms, STOCK_LOCAL.z * ms);
  _wpB.applyRotationQuaternionToRef(outQuat, _wpC);
  outMount.copyFrom(_wpA).subtractInPlace(_wpC);
}

/**
 * Synchronous barrel-tip world position from the current authoritative
 * (pos/yaw/pitch) state. No IK, no model update, no scene graph reads —
 * cheap enough to call per shot so firing never uses a previous frame.
 */
export function tololoMuzzleWorldFromPose(
  rig: TololoRig, ms: number, pos: Vector3, yaw: number, pitch: number, out: Vector3,
): boolean {
  if (!rig.rest) return false;
  tololoWeaponPose(rig.rest, rig.scale, rig.lift, ms, pitch, _mpM, _mpQ);
  _mpM2.set(MUZZLE_LOCAL.x * ms, MUZZLE_LOCAL.y * ms, MUZZLE_LOCAL.z * ms);
  _mpM2.applyRotationQuaternionToRef(_mpQ, _mpM3);
  _mpM3.addInPlace(_mpM);
  tololoPlayerToWorld(_mpM3.x, _mpM3.y, _mpM3.z, pos, yaw, out);
  return true;
}

/**
 * Static hold tick: weapon follows the right-shoulder pocket + aim pitch;
 * both arms follow the weapon anchors via IK; fingers are static curls.
 * Writes sim.muzzleOverride (honest barrel-tip origin) and contact markers.
 */
export function tickTololoStaticHold(
  root: TransformNode, sim: TololoHoldSim, s: TololoPoseState,
): void {
  const rig = rigByRoot.get(root);
  if (!rig || !rig.model || !rig.rest || !s.alive) return;
  const p = tololoHoldParams;
  const rest = rig.rest;
  const ms = sim.weaponMount.scaling.x || MOUNT_SCALE;

  // The accepted upper-body hold stays static. Locomotion owns lower-body
  // bones only, so the shoulder-derived weapon anchors remain unchanged.
  setBoneRotation(rig, "上半身", 0, 0, 0);
  setBoneRotation(rig, "上半身2", 0, 0, 0);
  setBoneRotation(rig, "首", 0, p.headPitch * 0.5, 0);
  setBoneRotation(rig, "頭", 0, p.headPitch * 0.5, p.headRoll);
  setBoneRotation(rig, "センター", 0, 0, 0);
  if (tololoLocomotionMode.enabled) {
    const legs = tololoLegPose(rig.locomotion, s.time);
    setBoneRotation(rig, "下半身", 0, legs.lowerPitch, legs.lowerRoll);
    setBoneRotation(rig, "左足", 0, legs.thighPitchL, legs.thighRollL);
    setBoneRotation(rig, "右足", 0, legs.thighPitchR, legs.thighRollR);
    setBoneRotation(rig, "左ひざ", 0, legs.kneeL, 0);
    setBoneRotation(rig, "右ひざ", 0, legs.kneeR, 0);
    setBoneRotation(rig, "左足首", 0, legs.ankleL, 0);
    setBoneRotation(rig, "右足首", 0, legs.ankleR, 0);
    setBoneRotation(rig, "左つま先", 0, legs.toeL, 0);
    setBoneRotation(rig, "右つま先", 0, legs.toeR, 0);
  } else {
    setBoneRotation(rig, "下半身", 0, 0, 0);
    setBoneRotation(rig, "左足", 0, -p.hipSplay * 0.4, p.hipSplay);
    setBoneRotation(rig, "右足", 0, -p.hipSplay * 0.4, -p.hipSplay);
    setBoneRotation(rig, "左ひざ", 0, p.kneeBend, 0);
    setBoneRotation(rig, "右ひざ", 0, p.kneeBend, 0);
    setBoneRotation(rig, "左足首", 0, 0, 0);
    setBoneRotation(rig, "右足首", 0, 0, 0);
    setBoneRotation(rig, "左つま先", 0, 0, 0);
    setBoneRotation(rig, "右つま先", 0, 0, 0);
  }

  // Weapon pose from the single shared source (pocket + pitch); the mount
  // lives in dedicated scratch across the IK solves below.
  tololoWeaponPose(rest, rig.scale, rig.lift, ms, s.pitch, _mountPos, _hq);
  sim.weaponMount.position.copyFrom(_mountPos);
  sim.weaponMount.rotation.set(-s.pitch, 0, 0);

  // Anchors to player space, then to model space for the solver.
  _a.set(MAIN_LOCAL.x * ms, MAIN_LOCAL.y * ms, MAIN_LOCAL.z * ms)
    .applyRotationQuaternionToRef(_hq, _c);
  _c.addInPlace(_mountPos);
  _a.set(SUP_LOCAL.x * ms, SUP_LOCAL.y * ms, SUP_LOCAL.z * ms)
    .applyRotationQuaternionToRef(_hq, _d);
  _d.addInPlace(_mountPos);
  const mainM = tololoPlayerToModel(_c.x, _c.y, _c.z, rig.scale, rig.lift, new Vector3());
  const supM = tololoPlayerToModel(_d.x, _d.y, _d.z, rig.scale, rig.lift, new Vector3());
  const poleRM = new Vector3(-p.poleR.x, p.poleR.y, -p.poleR.z).normalize();
  const poleLM = new Vector3(-p.poleL.x, p.poleL.y, -p.poleL.z).normalize();

  const solR = solveHoldArm(rig, rest, "R", rest.shoulderR,
    rest.upperLenR, rest.foreLenR, rest.upperDirR, rest.foreDirR, rest.palmLocalR,
    mainM, poleRM, p.wristR, p.twistR, "右腕", "右ひじ", "右手首");
  const solL = solveHoldArm(rig, rest, "L", rest.shoulderL,
    rest.upperLenL, rest.foreLenL, rest.upperDirL, rest.foreDirL, rest.palmLocalL,
    supM, poleLM, p.wristL, p.twistL, "左腕", "左ひじ", "左手首");
  rig.lastIkR = solR.clamped;
  rig.lastIkL = solL.clamped;

  curlFingers(rig, FINGERS_R, p.fingerCurl, p.fingerCurlSignR);
  curlFingers(rig, FINGERS_L, p.fingerCurl, p.fingerCurlSignL);
  poseThumb(rig, THUMB_R, 1);
  poseThumb(rig, THUMB_L, -1);

  updateTololoModel(rig);

  // Contacts from the live wrist translations + chosen hand orientations.
  Quaternion.RotationYawPitchRollToRef(p.wristR.yaw, p.wristR.pitch, p.wristR.roll, _hm);
  if (readBoneModel(rig, "右手首", _a)) {
    rest.palmLocalR.applyRotationQuaternionToRef(_hm, _b);
    _a.addInPlace(_b);
    tololoModelToPlayer(_a.x, _a.y, _a.z, rig.scale, rig.lift, sim.markerContactR.position);
  }
  Quaternion.RotationYawPitchRollToRef(p.wristL.yaw, p.wristL.pitch, p.wristL.roll, _hm);
  if (readBoneModel(rig, "左手首", _a)) {
    rest.palmLocalL.applyRotationQuaternionToRef(_hm, _b);
    _a.addInPlace(_b);
    tololoModelToPlayer(_a.x, _a.y, _a.z, rig.scale, rig.lift, sim.markerContactL.position);
  }

  // Honest muzzle: manual player->world (no reliance on scene graph freshness).
  _a.set(MUZZLE_LOCAL.x * ms, MUZZLE_LOCAL.y * ms, MUZZLE_LOCAL.z * ms)
    .applyRotationQuaternionToRef(_hq, _b);
  _b.addInPlace(_mountPos);
  const muzzleWorld = tololoPlayerToWorld(_b.x, _b.y, _b.z, sim.pos, sim.yaw, new Vector3());
  sim.muzzleOverride = muzzleWorld;
}

export interface TololoHoldErrors {
  /** Palm-contact to grip-anchor gaps, world units. */
  mainErr: number; supportErr: number; stockErr: number;
  /** |visual muzzle - legacy formula origin| = applied correction size. */
  muzzleGapLegacy: number;
  /** Barrel axis vs look-direction angle, degrees. */
  barrelDeg: number;
  muzzleWorld: Vector3; legacyWorld: Vector3;
  clampedR: boolean; clampedL: boolean;
}

/**
 * World-space hold measurement for the check harness. Reads live transforms
 * only (never poses): hand contacts vs grip anchors, stock vs pocket, visual
 * muzzle vs legacy origin, barrel axis vs look direction.
 */
export function measureTololoHold(
  root: TransformNode, sim: TololoHoldSim, simPos: Vector3, yaw: number, pitch: number,
): TololoHoldErrors | null {
  const rig = rigByRoot.get(root);
  if (!rig || !rig.model || !rig.rest) return null;
  const p = tololoHoldParams;
  const ms = sim.weaponMount.scaling.x || MOUNT_SCALE;
  const mp = sim.weaponMount.position;
  const mq = new Quaternion();
  Quaternion.RotationYawPitchRollToRef(0, sim.weaponMount.rotation.x, 0, mq);

  const anchorWorld = (local: Vector3): Vector3 => {
    _a.set(local.x * ms, local.y * ms, local.z * ms).applyRotationQuaternionToRef(mq, _b);
    _b.addInPlace(mp);
    return tololoPlayerToWorld(_b.x, _b.y, _b.z, simPos, yaw, new Vector3());
  };
  const mainW = anchorWorld(MAIN_LOCAL);
  const supW = anchorWorld(SUP_LOCAL);
  const stockW = anchorWorld(STOCK_LOCAL);
  const muzzleW = anchorWorld(MUZZLE_LOCAL);

  Quaternion.RotationYawPitchRollToRef(p.wristR.yaw, p.wristR.pitch, p.wristR.roll, _hm);
  readBoneModel(rig, "右手首", _a);
  rig.rest.palmLocalR.applyRotationQuaternionToRef(_hm, _b);
  _a.addInPlace(_b);
  tololoModelToPlayer(_a.x, _a.y, _a.z, rig.scale, rig.lift, _c);
  const contactRW = tololoPlayerToWorld(_c.x, _c.y, _c.z, simPos, yaw, new Vector3());
  Quaternion.RotationYawPitchRollToRef(p.wristL.yaw, p.wristL.pitch, p.wristL.roll, _hm);
  readBoneModel(rig, "左手首", _a);
  rig.rest.palmLocalL.applyRotationQuaternionToRef(_hm, _b);
  _a.addInPlace(_b);
  tololoModelToPlayer(_a.x, _a.y, _a.z, rig.scale, rig.lift, _c);
  const contactLW = tololoPlayerToWorld(_c.x, _c.y, _c.z, simPos, yaw, new Vector3());

  tololoModelToPlayer(rig.rest.shoulderR.x, rig.rest.shoulderR.y, rig.rest.shoulderR.z,
    rig.scale, rig.lift, _c);
  _c.x -= p.stockIn; _c.y += p.stockUp; _c.z += p.stockFwd;
  const pocketW = tololoPlayerToWorld(_c.x, _c.y, _c.z, simPos, yaw, new Vector3());

  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = -fz, rz = fx;
  const legacyW = new Vector3(
    simPos.x + fx * 0.8 + rx * 0.35, simPos.y + 1.45, simPos.z + fz * 0.8 + rz * 0.35);

  _a.set(0, 0, 1).applyRotationQuaternionToRef(mq, _b);
  const a2 = yaw + Math.PI;
  const barrelW = new Vector3(
    _b.x * Math.cos(a2) + _b.z * Math.sin(a2), _b.y, -_b.x * Math.sin(a2) + _b.z * Math.cos(a2));
  const cp = Math.cos(pitch);
  const lookW = new Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  const cosB = Math.min(1, Math.max(-1, barrelW.dot(lookW)));
  return {
    mainErr: contactRW.subtract(mainW).length(),
    supportErr: contactLW.subtract(supW).length(),
    stockErr: stockW.subtract(pocketW).length(),
    muzzleGapLegacy: muzzleW.subtract(legacyW).length(),
    barrelDeg: Math.acos(cosB) * 180 / Math.PI,
    muzzleWorld: muzzleW,
    legacyWorld: legacyW,
    clampedR: rig.lastIkR,
    clampedL: rig.lastIkL,
  };
}
