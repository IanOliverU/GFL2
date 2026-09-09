// Fixed-step simulation: player, enemies, boss, projectiles, pickups, fields, relay, director.
// Rendering meshes are managed here; UI is notified via callbacks.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import {
  BOSS_DEF, CharId, CHARACTERS, ENEMIES, EnemyKind, PROC, AttachmentDef, SlotKind, Rarity,
  StatBlock, computeAttack, difficultyAt, emptyStats, enemyScale,
  getCharacter, skillRankEffect, weaponRankEffect, xpForLevel,
  SLOTS_FOR_TYPE, rollRarity, rollAttachment,
} from "./config";
import { Input } from "./input";
import { controllerGroundHeightAt, groundHeightAt, isGroundSpawnValid, moveHorizontalSafe, raycastSolid, resolveCircle, WorldRefs } from "./world";
import { synth } from "./audio";
import { createShotPlan, nextProcDepth, objectiveComplete } from "./rules";
import { applyMouseLook, cameraRelativeMove, horizontalBasis } from "./controls";
import { getTololoRig, tololoMuzzleWorldFromPose } from "./tololo-visual";
import {
  applyChaserAngles, buildChaserVisual, chaserNewAnim, chaserPoseAngles,
  chaserStepAnim, chaserWindup, CHASER_STRIKE_DUR,
  type ChaserAnim, type ChaserJoints,
} from "./chaser";

export interface DamageNumber { pos: Vector3; text: string; crit: boolean; }
export interface SimEvents {
  damageNumber(d: DamageNumber): void;
  toast(msg: string): void;
  killfeed(msg: string): void;
  hitmarker(kill: boolean): void;
  shake(amount: number): void;
  pickupAttachment(def: AttachmentDef): void;
  playerDied(): void;
  leveledUp(): void;
  bossSpawned(): void;
  victory(): void;
  healFlash(): void;
}

export interface AttachmentSlots { [slot: string]: AttachmentDef | null; }

export interface PlayerBuild {
  charId: CharId;
  level: number; xp: number; xpNext: number;
  weaponRank: number; s1: number; s2: number; s3: number;
  queuedLevels: number;
  attachments: AttachmentSlots;
}

let nextId = 1;
const STEP_SIZE = 1 / 60;

interface Enemy {
  id: number; kind: EnemyKind | "boss"; elite: boolean;
  pos: Vector3; vel: Vector3; yaw: number;
  hp: number; maxHp: number; speed: number; damage: number;
  radius: number; attackT: number; attackCd: number; attackRange: number;
  slowT: number; slowPct: number; stunT: number; markT: number; markMul: number;
  mesh: Mesh; bodyMat: StandardMaterial; baseEmissive: Color3; flashT: number;
  decideT: number; stuckT: number;
  // Ordinary-chaser articulated visual (null = legacy/other kinds).
  ch?: { joints: ChaserJoints; anim: ChaserAnim } | null;
  // boss state
  bossPhase: number; abilityT: number; abilityKind: number; telegraphT: number;
  Telegraph: Mesh | null;
  kbResist: boolean;
}

interface Orb { pos: Vector3; value: number; mesh: Mesh; life: number; active: boolean; heal: boolean; }
/** Firing-frame debug record: one entry per primary shot (ring of 8). */
export interface ShotDebug {
  id: number; step: number; frameMs: number;
  muzzle: Vector3; aim: Vector3; dir: Vector3;
  tracers: number; tracerA: Vector3 | null; tracerB: Vector3 | null;
}
interface EnemyShot { pos: Vector3; vel: Vector3; life: number; dmg: number; mesh: Mesh; active: boolean; radius: number; }
interface Tracer { mesh: Mesh; life: number; active: boolean; }
interface Flash { mesh: Mesh; life: number; active: boolean; }
interface Spark { mesh: Mesh; vel: Vector3; life: number; active: boolean; }
interface Dying { mesh: Mesh; vest: StandardMaterial | null; t: number; duration: number; }
interface Field {
  kind: "trap" | "snare" | "protect" | "bulwarkPulse" | "finale";
  pos: Vector3; radius: number; duration: number; age: number;
  tickT: number; power: number; mesh: Mesh | null; mesh2: Mesh | null;
  triggered: boolean; owner: string;
}
interface DelayedShot { t: number; targetId: number; power: number; kind: string; dirX?: number; dirZ?: number; cone?: number; }
interface ScheduledBoom { t: number; pos: Vector3; power: number; radius: number; }

function stdMat(scene: Scene, name: string, c: Color3, e?: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = c;
  if (e) m.emissiveColor = e;
  m.specularColor = new Color3(0.1, 0.1, 0.12);
  return m;
}

/** Presentation-only entry point on the existing spherical hit volume. */
export function raySphereEntryPoint(origin: Vector3, dir: Vector3, center: Vector3, radius: number): Vector3 {
  const toCenter = center.subtract(origin);
  const centerT = toCenter.dot(dir);
  const closest = origin.add(dir.scale(centerT));
  const offSq = Math.min(radius * radius, closest.subtract(center).lengthSquared());
  const entryT = Math.max(0, centerT - Math.sqrt(Math.max(0, radius * radius - offSq)));
  return origin.add(dir.scale(entryT));
}

export class Simulation {
  scene: Scene;
  world: WorldRefs;
  events: SimEvents;
  input: Input;
  build!: PlayerBuild;

  // player state
  pos = new Vector3(0, 0, 10);
  vel = new Vector3(0, 0, 0);
  /** Collision-resolved horizontal velocity for presentation only. */
  visualVel = new Vector3(0, 0, 0);
  yaw = Math.PI; pitch = -0.15;
  hp = 100; maxHp = 100; shield = 0; maxShield = 0;
  alive = true;
  ammo = 30; reloading = 0; fireTimer = 0; bloom = 0;
  gunRecoil = 0;
  dodgeT = 0; dodgeCD = 0; iframes = 0;
  aiming = false;
  skillCD = [0, 0, 0];
  // buffs
  overdriveT = 0; executionT = 0; deadeyeShots = 0; deadeyePower = 2.2; deadeyePierce = 2; empowerMagT = 0; empowerMul = 1;
  saturationT = 0; overdriveCount = 0; satTick = 0;
  volleyQueue: DelayedShot[] = [];
  booms: ScheduledBoom[] = [];
  slideT = 0;
  protectFields: Field[] = [];
  traps: Field[] = [];

  enemies: Enemy[] = [];
  orbs: Orb[] = [];
  eshots: EnemyShot[] = [];
  tracers: Tracer[] = [];
  flashes: Flash[] = [];
  sparks: Spark[] = [];
  private dying: Dying[] = [];
  fields: Field[] = [];
  floatT = 0;

  runTime = 0; loop = 0;
  /** Fixed-step counter (tick identity for firing-frame correlation). */
  stepCount = 0;
  /** Recent primary-shot records for the firing investigation harness. */
  shotLog: ShotDebug[] = [];
  private shotSeq = 0;
  private gameplayState = (Math.random() * 0xffffffff) >>> 0 || 0x9e3779b9;
  private cosmeticState = 0x6d2b79f5;
  spawnT = 2; spawnBudget = 0; difficulty = 1;
  relayActive = false; relayCharge = 0; bossSpawned = false; bossDead = false;
  bossRef: Enemy | null = null;
  kills = 0; elitesKilled = 0;
  cachesOpened = 0;
  shakeAmt = 0;

  playerMesh!: Mesh; playerBody!: Mesh; gunMesh!: Mesh; playerHead!: Mesh;
  // Named weapon hardpoint: the PMX carries no firearm, so a clearly
  // identified placeholder rifle rides here. Combat math stays authoritative
  // in muzzlePos()/firePrimary(); the Muzzle node is visual-only.
  weaponMount!: TransformNode; muzzleNode!: TransformNode;
  // Explicit weapon-local anchors on the placeholder rifle (mount-local units,
  // mount scaling 0.6 applies). MainGrip = trigger/mag grip, SupportGrip =
  // fore-end, StockContact = shoulder-pocket face, Muzzle = barrel tip.
  mainGripNode!: TransformNode; supportGripNode!: TransformNode; stockNode!: TransformNode;
  // Dev-only hold-debug markers (captures with ?mark=1). Hidden by default.
  gripMarkers: Mesh[] = [];
  markerContactR!: Mesh; markerContactL!: Mesh;
  // Honest shot origin: world-space barrel tip written each frame by the
  // Tololo visual tick. Null => legacy formula (placeholder characters).
  // Direction logic (muzzle -> camera aim point) is unchanged, so damage,
  // cadence, range, and enemy behavior are preserved.
  muzzleOverride: Vector3 | null = null;
  // External character visual (Tololo PMX art slice). Null => placeholder.
  externalRoot: TransformNode | null = null;
  externalStatus: "placeholder" | "pmx" = "placeholder";
  private bodyScaleY = 1;
  aimPoint = new Vector3(0, 1, 0);
  muzzleOffset = new Vector3(0.35, 1.45, 0.8);

  camPos = new Vector3(0, 3, 16);
  camTarget = new Vector3(0, 1.5, 10);
  sensitivity = 1;
  reverseForward = false;
  reverseStrafe = true;
  invertLookX = true;
  invertLookY = false;

  godmode = false; // dev shortcut hooks (used only by debug query flags)
  debugChaserVisuals = true; // harness switch for same-build perf comparison
  private interrupted = false;

  constructor(scene: Scene, world: WorldRefs, events: SimEvents, input: Input) {
    this.scene = scene; this.world = world; this.events = events; this.input = input;
    this.buildPlayerMesh();
    this.buildPools();
  }

  get def() { return getCharacter(this.build.charId); }

  /**
   * Stage-aware ground height. Green Zone worlds leave these unset and get the
   * legacy heightfield; the tram circuit provides its own (platform + ramps).
   */
  private gh(x: number, z: number): number {
    return this.world.groundHeightAt ? this.world.groundHeightAt(x, z) : groundHeightAt(x, z);
  }

  private cgh(x: number, z: number, currentY: number): number {
    return this.world.controllerGroundHeightAt
      ? this.world.controllerGroundHeightAt(x, z, currentY)
      : controllerGroundHeightAt(x, z, currentY);
  }

  startRun(charId: CharId, loop = 0, keepBuild?: PlayerBuild): void {
    const def = getCharacter(charId);
    this.clearEntities();
    this.loop = loop;
    this.runTime = 0; this.stepCount = 0; this.shotLog = []; this.shotSeq = 0;
    this.cosmeticState = 0x6d2b79f5;
    this.difficulty = difficultyAt(0, loop);
    this.relayActive = false; this.relayCharge = 0;
    this.bossSpawned = false; this.bossDead = false; this.bossRef = null;
    this.kills = 0; this.elitesKilled = 0; this.cachesOpened = 0;
    this.volleyQueue = []; this.booms = [];
    if (keepBuild) {
      this.build = keepBuild;
    } else {
      this.build = {
        charId, level: 1, xp: 0, xpNext: xpForLevel(1),
        weaponRank: 1, s1: 1, s2: 1, s3: 1, queuedLevels: 0, attachments: {},
      };
      for (const s of slotsFor(charId)) this.build.attachments[s] = null;
    }
    this.maxHp = def.hp;
    this.hp = this.maxHp; this.shield = 0; this.maxShield = 0;
    this.alive = true;
    this.pos = new Vector3(4, 0, 12);
    this.vel.set(0, 0, 0);
    this.visualVel.set(0, 0, 0);
    this.yaw = 0; this.pitch = -0.15;
    this.ammo = this.magSize(); this.reloading = 0; this.fireTimer = 0;
    this.skillCD = [0, 0, 0];
    this.overdriveT = 0; this.executionT = 0; this.deadeyeShots = 0; this.deadeyePower = 2.2; this.deadeyePierce = 2;
    this.empowerMagT = 0; this.empowerMul = 1; this.saturationT = 0; this.slideT = 0;
    this.dodgeT = 0; this.dodgeCD = 0; this.iframes = 0; this.aiming = false;
    this.bloom = 0; this.overdriveCount = 0; this.satTick = 0; this.shakeAmt = 0;
    this.muzzleOverride = null;
    this.gunRecoil = 0;
    this.playerBody.rotation.z = 0;
    if (this.externalRoot) this.externalRoot.rotation.z = 0;
    this.interrupted = false;
    this.spawnT = 2.5; this.spawnBudget = 0;
    this.camPos.set(4.9, 3.1, 17.5);
    this.camTarget.set(4, 1.9, 4);
    this.recolorPlayer();
  }

  // ---------- derived stats ----------
  statMods(): StatBlock[] {
    const out: StatBlock[] = [];
    for (const k of Object.keys(this.build.attachments)) {
      const a = this.build.attachments[k];
      if (a) out.push({ flatAtk: a.flatAtk, atkPct: a.atkPct, critRate: a.critRate, critDmg: a.critDmg });
    }
    return out;
  }
  totalAtk(): number {
    const c = computeAttack(this.def.baseAtk, this.statMods());
    return c.totalAtk;
  }
  critCh(): number {
    return computeAttack(this.def.baseAtk, this.statMods(), this.def.baseCritCh).critCh;
  }
  critMult(): number {
    return computeAttack(this.def.baseAtk, this.statMods(), this.def.baseCritCh).critMult;
  }
  magSize(): number { return this.def.weapon.magSize; }
  reloadTime(): number {
    const fx = weaponRankEffect(this.def.weapon.type, this.build.weaponRank);
    return this.def.weapon.reloadTime * fx.reloadMul;
  }
  fireInterval(): number {
    const fx = weaponRankEffect(this.def.weapon.type, this.build.weaponRank);
    let iv = this.def.weapon.fireInterval / fx.rateMul;
    if (this.overdriveT > 0) iv /= 1.45;
    return iv;
  }
  shotDamage(): number {
    const fx = weaponRankEffect(this.def.weapon.type, this.build.weaponRank);
    let mult = this.totalAtk() / 12;
    mult *= fx.dmgMul;
    if (this.empowerMagT > 0) mult *= this.empowerMul;
    return this.def.weapon.damage * mult;
  }

  // ---------- entities ----------
  private buildPlayerMesh(): void {
    const s = this.scene;
    this.playerMesh = new Mesh("player", s);
    this.playerBody = MeshBuilder.CreateCapsule("pbody", { height: 1.7, radius: 0.42 }, s);
    this.playerBody.parent = this.playerMesh;
    this.playerBody.position.y = 1.0;
    this.playerHead = MeshBuilder.CreateSphere("phead", { diameter: 0.55 }, s);
    this.playerHead.position.y = 2.1; this.playerHead.parent = this.playerMesh;
    this.playerHead.material = stdMat(s, "pskin", new Color3(0.95, 0.82, 0.72));
    this.buildPlaceholderRifle();
    this.recolorPlayer();
  }

  private buildPlaceholderRifle(): void {
    // Clearly identified stand-in firearm (the Tololo PMX ships no weapon).
    // Layout is visual only; Simulation.muzzlePos() remains the shot authority.
    const s = this.scene;
    this.weaponMount = new TransformNode("WeaponMount", s);
    this.weaponMount.parent = this.playerMesh;
    this.weaponMount.position = new Vector3(0.4, 1.35, 0.1);
    // Placeholder scale: a rifle reads ~55% of body height (bind-pose stand-in).
    this.weaponMount.scaling.setAll(0.6);
    const gunMat = stdMat(s, "PLACEHOLDER_RIFLE_MAT", new Color3(0.12, 0.12, 0.15));
    const accent = stdMat(s, "PLACEHOLDER_RIFLE_ACCENT", new Color3(0.9, 0.6, 0.2), new Color3(0.3, 0.18, 0.05));
    this.gunMesh = MeshBuilder.CreateBox("PLACEHOLDER_RIFLE_RECEIVER", { width: 0.16, height: 0.24, depth: 1.1 }, s);
    this.gunMesh.material = gunMat;
    this.gunMesh.parent = this.weaponMount;
    this.gunMesh.position = new Vector3(0, 0.05, 0.35);
    const barrel = MeshBuilder.CreateCylinder("PLACEHOLDER_RIFLE_BARREL", { height: 0.55, diameter: 0.09 }, s);
    barrel.material = gunMat;
    barrel.parent = this.weaponMount;
    barrel.rotation.x = Math.PI / 2;
    barrel.position = new Vector3(0, 0.08, 1.15);
    const mag = MeshBuilder.CreateBox("PLACEHOLDER_RIFLE_MAG", { width: 0.12, height: 0.34, depth: 0.2 }, s);
    mag.material = gunMat;
    mag.parent = this.weaponMount;
    mag.position = new Vector3(0, -0.18, 0.35);
    mag.rotation.x = 0.25;
    const stock = MeshBuilder.CreateBox("PLACEHOLDER_RIFLE_STOCK", { width: 0.14, height: 0.22, depth: 0.45 }, s);
    stock.material = accent;
    stock.parent = this.weaponMount;
    stock.position = new Vector3(0, 0.02, -0.35);
    this.muzzleNode = new TransformNode("Muzzle", s);
    this.muzzleNode.parent = this.weaponMount;
    this.muzzleNode.position = new Vector3(0, 0.08, 1.45);
    // Explicit anchors at the placeholder's actual features (mount-local):
    // mag grip (box at y -0.18 z 0.35), fore-end (receiver front z ~0.8),
    // stock rear face (box rear z -0.575). Names are role labels, not claims
    // about any real-steel model — the rifle stays a labeled placeholder.
    this.mainGripNode = new TransformNode("MainGrip", s);
    this.mainGripNode.parent = this.weaponMount;
    this.mainGripNode.position = new Vector3(0, -0.14, 0.35);
    this.supportGripNode = new TransformNode("SupportGrip", s);
    this.supportGripNode.parent = this.weaponMount;
    // Receiver over the mag: the barrel mid-point is beyond her arm reach,
    // with margin kept for upward aim (see tololo-visual.ts SUP_LOCAL).
    // Placeholder limitation.
    this.supportGripNode.position = new Vector3(0, 0.02, 0.42);
    this.stockNode = new TransformNode("StockContact", s);
    this.stockNode.parent = this.weaponMount;
    this.stockNode.position = new Vector3(0, 0.06, -0.58);
    this.buildGripMarkers();
  }

  private gripMarker(name: string, color: Color3, parent: TransformNode | Mesh, pos: Vector3): Mesh {
    const m = MeshBuilder.CreateSphere(name, { diameter: 0.09 }, this.scene);
    m.material = stdMat(this.scene, `${name}M`, new Color3(0.05, 0.05, 0.05), color);
    m.parent = parent;
    m.position.copyFrom(pos);
    m.isVisible = false;
    (m as Mesh).isPickable = false;
    this.gripMarkers.push(m);
    return m;
  }

  private buildGripMarkers(): void {
    // Anchor markers ride the mount (always co-located with their anchors).
    this.gripMarker("MARK_MainGrip", new Color3(0.2, 1, 0.3), this.weaponMount, this.mainGripNode.position);
    this.gripMarker("MARK_SupportGrip", new Color3(0.3, 0.5, 1), this.weaponMount, this.supportGripNode.position);
    this.gripMarker("MARK_Stock", new Color3(1, 0.55, 0.1), this.weaponMount, this.stockNode.position);
    this.gripMarker("MARK_Muzzle", new Color3(1, 0.15, 0.15), this.weaponMount, this.muzzleNode.position);
    // Hand contact markers are repositioned every visual tick (player space).
    this.markerContactR = this.gripMarker("MARK_ContactR", new Color3(1, 1, 0.3), this.playerMesh, new Vector3());
    this.markerContactL = this.gripMarker("MARK_ContactL", new Color3(1, 1, 1), this.playerMesh, new Vector3());
  }

  setGripMarkersVisible(v: boolean): void {
    for (const m of this.gripMarkers) m.isVisible = v;
  }

  /**
   * Attach (or detach with null) the external Tololo visual. Placeholder rifle stays.
   * Returns the detached previous root, if any — the caller owns it (park for
   * reuse; never dispose a root whose async PMX textures may be in flight).
   */
  setExternalVisual(root: TransformNode | null, status: "placeholder" | "pmx" = "placeholder"): TransformNode | null {
    const detached = this.externalRoot;
    if (detached) {
      detached.parent = null;
      this.externalRoot = null;
    }
    this.externalRoot = root;
    this.externalStatus = root ? status : "placeholder";
    if (!root) this.muzzleOverride = null;
    if (root) {
      root.parent = this.playerMesh;
      root.position.y += 0; // fitting (scale + grounding) is done by the loader
    }
    const usingExternal = !!root;
    this.playerBody.isVisible = !usingExternal;
    this.playerHead.isVisible = !usingExternal;
    this.playerBody.rotation.z = 0;
    if (root) {
      root.rotation.z = 0;
      root.setEnabled(true);
    }
    return detached;
  }

  private recolorPlayer(): void {
    if (!this.playerBody) return;
    const def = this.build ? this.def : CHARACTERS[0]!;
    const col = Color3.FromHexString(def.color);
    this.playerBody.material?.dispose();
    this.playerBody.material = stdMat(this.scene, `pmat-${def.id}-${Date.now()}`, col, col.scale(0.25));
    const bodyScales: Record<CharId, [number, number, number]> = {
      tololo: [0.92, 1.02, 0.92], qiongjiu: [0.88, 1.06, 0.88], mosin: [0.82, 1.12, 0.82],
      sabrina: [1.18, 0.98, 1.12], peritya: [1.05, 1.04, 1.08], vepley: [0.9, 1.0, 0.9],
    };
    const bs = bodyScales[def.id];
    this.bodyScaleY = bs[1];
    this.playerBody.scaling.set(bs[0], bs[1], bs[2]);
    const gunScales: Record<string, [number, number, number]> = {
      AR: [1, 0.9, 1], RF: [0.75, 0.75, 1.55], SG: [1.35, 1.25, 0.85], MG: [1.35, 1.3, 1.35],
    };
    const gs = gunScales[def.weapon.type]!;
    this.gunMesh.scaling.set(gs[0], gs[1], gs[2]);
  }

  private buildPools(): void {
    // XP/heal orbs
    for (let i = 0; i < 90; i++) {
      const m = MeshBuilder.CreateSphere(`orb-${i}`, { diameter: 0.45 }, this.scene);
      m.material = stdMat(this.scene, `orbM-${i}`, new Color3(0.5, 0.7, 1), new Color3(0.3, 0.5, 1));
      m.isVisible = false;
      this.orbs.push({ pos: new Vector3(0, -99, 0), value: 0, mesh: m, life: 0, active: false, heal: false });
    }
    // enemy shots
    for (let i = 0; i < 48; i++) {
      const m = MeshBuilder.CreateSphere(`eshot-${i}`, { diameter: 0.5 }, this.scene);
      m.material = stdMat(this.scene, `eshotM-${i}`, new Color3(1, 0.35, 0.4), new Color3(1, 0.2, 0.25));
      m.isVisible = false;
      this.eshots.push({ pos: new Vector3(0, -99, 0), vel: new Vector3(), life: 0, dmg: 0, mesh: m, active: false, radius: 0.7 });
    }
    // tracers (thin stretched boxes)
    for (let i = 0; i < 40; i++) {
      const m = MeshBuilder.CreateBox(`tracer-${i}`, { width: 0.06, height: 0.06, depth: 1 }, this.scene);
      m.material = stdMat(this.scene, `tracerM-${i}`, new Color3(1, 0.85, 0.5), new Color3(1, 0.7, 0.3));
      m.isVisible = false;
      (m as Mesh).isPickable = false;
      this.tracers.push({ mesh: m, life: 0, active: false });
    }
    // muzzle flash polyhedra (shared mats, restrained single-frame pops)
    const flashMat = stdMat(this.scene, "flashM", new Color3(1, 0.6, 0.2), new Color3(1, 0.5, 0.12));
    for (let i = 0; i < 4; i++) {
      const m = MeshBuilder.CreateSphere(`flash-${i}`, { diameter: 0.5, segments: 2 }, this.scene);
      m.material = flashMat;
      m.scaling.set(0.7, 0.7, 1.4);
      m.isVisible = false;
      (m as Mesh).isPickable = false;
      this.flashes.push({ mesh: m, life: 0, active: false });
    }
    const flashWhiteMat = stdMat(this.scene, "flashWM", new Color3(1, 1, 1), new Color3(1, 1, 1));
    for (let i = 0; i < 2; i++) {
      const m = MeshBuilder.CreateSphere(`flashW-${i}`, { diameter: 0.4, segments: 2 }, this.scene);
      m.material = flashWhiteMat;
      m.isVisible = false;
      (m as Mesh).isPickable = false;
      this.flashes.push({ mesh: m, life: 0, active: false });
    }
    // impact sparks (shared mat, gravity-driven, short-lived)
    const sparkMat = stdMat(this.scene, "sparkM", new Color3(1, 0.7, 0.3), new Color3(1, 0.55, 0.15));
    for (let i = 0; i < 16; i++) {
      const m = MeshBuilder.CreateBox(`spark-${i}`, { width: 0.09, height: 0.09, depth: 0.09 }, this.scene);
      m.material = sparkMat;
      m.isVisible = false;
      (m as Mesh).isPickable = false;
      this.sparks.push({ mesh: m, vel: new Vector3(), life: 0, active: false });
    }
  }

  /** Gameplay-only PRNG, isolated from rendering/audio allocation. */
  gameplayRandom = (): number => {
    let x = this.gameplayState | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.gameplayState = x >>> 0;
    return this.gameplayState / 0x100000000;
  };

  setGameplaySeed(seed: number): void {
    this.gameplayState = (seed >>> 0) || 0x9e3779b9;
  }

  private cosmeticRandom(): number {
    let x = this.cosmeticState | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.cosmeticState = x >>> 0;
    return this.cosmeticState / 0x100000000;
  }

  /** Restrained muzzle flash at the authoritative snapshot position. */
  private spawnFlash(at: Vector3, dir: Vector3, white = false): void {
    const matches = (x: Flash): boolean => x.mesh.name.startsWith("flashW") === white;
    const f = this.flashes.find((x) => matches(x) && !x.active) ?? this.flashes.find(matches);
    if (!f) return;
    f.active = true; f.life = white ? 0.12 : 0.08;
    f.mesh.isVisible = true;
    f.mesh.position.copyFrom(at);
    f.mesh.lookAt(at.add(dir));
    f.mesh.rotate(Vector3.Up(), this.cosmeticRandom() * Math.PI, 0);
  }

  /** Impact burst at a hit location (3 chips, 6 + white core on crit). */
  private impactBurst(at: Vector3, crit: boolean): void {
    if (crit) this.spawnFlash(at, new Vector3(0, 1, 0), true);
    const count = crit ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const s = this.sparks.find((candidate) => !candidate.active)
        ?? this.sparks.reduce((oldest, candidate) => candidate.life < oldest.life ? candidate : oldest);
      s.active = true; s.life = 0.28;
      s.mesh.isVisible = true;
      s.mesh.position.copyFrom(at);
      s.vel.set((this.cosmeticRandom() - 0.5) * 7, 1.5 + this.cosmeticRandom() * 4, (this.cosmeticRandom() - 0.5) * 7);
      s.mesh.rotation.set(this.cosmeticRandom() * 3, this.cosmeticRandom() * 3, 0);
    }
  }

  clearTransientPresentation(): void {
    for (const t of this.tracers) { t.active = false; t.mesh.isVisible = false; }
    for (const f of this.flashes) { f.active = false; f.mesh.isVisible = false; }
    for (const s of this.sparks) { s.active = false; s.mesh.isVisible = false; }
  }

  private updateFx(dt: number): void {
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) { f.active = false; f.mesh.isVisible = false; }
    }
    for (const s of this.sparks) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; s.mesh.isVisible = false; continue; }
      s.vel.y -= 22 * dt;
      s.mesh.position.x += s.vel.x * dt;
      s.mesh.position.y += s.vel.y * dt;
      s.mesh.position.z += s.vel.z * dt;
      if (s.mesh.position.y < 0.03) { s.mesh.position.y = 0.03; s.vel.y *= -0.4; }
    }
    // Death cleanup: fall + sink, then dispose the per-instance material.
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i]!;
      d.t -= dt;
      const k = Math.max(0, d.t / d.duration);
      d.mesh.rotation.x = -1.35 * (1 - k);
      if (d.t < d.duration * 0.35) d.mesh.position.y -= dt * 0.8;
      if (d.t <= 0) {
        d.mesh.dispose(false, false);
        d.vest?.dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  private clearEntities(): void {
    for (const e of this.enemies) {
      e.mesh.dispose(false, !e.ch);
      if (e.ch) e.bodyMat.dispose();
      e.Telegraph?.dispose(false, true);
    }
    this.enemies = [];
    this.bossRef = null;
    for (const d of this.dying) { d.mesh.dispose(false, false); d.vest?.dispose(); }
    this.dying = [];
    for (const o of this.orbs) { o.active = false; o.mesh.isVisible = false; }
    for (const s of this.eshots) { s.active = false; s.mesh.isVisible = false; }
    this.clearTransientPresentation();
    for (const f of this.fields) { f.mesh?.dispose(false, true); f.mesh2?.dispose(false, true); }
    this.fields = [];
    this.traps = []; this.protectFields = [];
    pendingAttachmentDrops.length = 0;
    for (const marker of dropMarkers.values()) marker.dispose(false, true);
    dropMarkers.clear();
    // reset caches
    for (const c of this.world.caches) {
      c.taken = false;
      c.mesh.isVisible = true;
      if (c.glow) c.glow.isVisible = true;
    }
    this.world.relayRing.material = this.world.relayRing.material; // keep
  }

  // ---------- main fixed update ----------
  update(dt: number): void {
    if (!this.alive) return;
    this.interrupted = false;
    this.stepCount++;
    this.runTime += dt;
    // Age effects before producers so a fresh 50 ms flash survives every
    // capped three-step catch-up frame and remains visible for one render.
    this.updateFx(dt);
    this.difficulty = difficultyAt(this.runTime, this.loop);
    this.updatePlayer(dt);
    if (this.interrupted || !this.alive) return;
    this.updateDirector(dt);
    if (this.interrupted || !this.alive) return;
    this.updateEnemies(dt);
    if (this.interrupted || !this.alive) return;
    this.updateShots(dt);
    if (this.interrupted || !this.alive) return;
    this.updateOrbs(dt);
    if (this.interrupted || !this.alive) return;
    this.updateFields(dt);
    if (this.interrupted || !this.alive) return;
    this.updateDelayed(dt);
    if (this.interrupted || !this.alive) return;
    this.updateRelay(dt);
    if (this.interrupted || !this.alive) return;
    this.updateCameraVisuals(dt);
  }

  // ----- player -----
  private updatePlayer(dt: number): void {
    const def = this.def;
    const startX = this.pos.x;
    const startZ = this.pos.z;
    // look
    const { dx, dy } = this.input.consumeLook();
    const look = applyMouseLook(this.yaw, this.pitch, dx, dy, this.sensitivity, this.invertLookX, this.invertLookY);
    this.yaw = look.yaw;
    this.pitch = look.pitch;
    this.aiming = this.input.rmbDown;

    const ax = this.input.moveAxes();
    const sprint = this.input.keys.has("ShiftLeft") || this.input.keys.has("ShiftRight");
    const speed = def.moveSpeed * (sprint ? 1.45 : 1) * (this.aiming ? 0.6 : 1) * (this.slideT > 0 ? 1.7 : 1);
    // camera-relative
    const move = cameraRelativeMove(ax.x, ax.z, this.yaw, this.reverseForward, this.reverseStrafe);
    let mx = move.x;
    let mz = move.z;
    const accel = this.grounded() ? 46 : 16;
    this.vel.x += (mx * speed - this.vel.x) * Math.min(1, accel * dt / Math.max(1, speed));
    this.vel.z += (mz * speed - this.vel.z) * Math.min(1, accel * dt / Math.max(1, speed));

    // jump / gravity
    const g = this.cgh(this.pos.x, this.pos.z, this.pos.y);
    if (this.input.wasPressed("Space") && this.pos.y <= g + 0.05) {
      this.vel.y = 7.4;
      this.pos.y += 0.02;
    }
    this.vel.y -= 21 * dt;
    moveHorizontalSafe(this.pos, this.vel.x * dt, this.vel.z * dt, 0.55, this.world.colliders, this.world.bounds);
    this.pos.y += this.vel.y * dt;
    const g2 = this.cgh(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g2) { this.pos.y = g2; this.vel.y = 0; }
    // snap down small steps (ramps)
    const g3 = this.cgh(this.pos.x, this.pos.z, this.pos.y);
    if (this.vel.y <= 0 && this.pos.y - g3 < 1.2 && this.pos.y >= g3) { this.pos.y = g3; this.vel.y = 0; }
    // Unlike vel, this reflects sliding/stopping after collision resolution.
    this.visualVel.set((this.pos.x - startX) / dt, 0, (this.pos.z - startZ) / dt);

    // dodge (Ctrl)
    this.dodgeCD = Math.max(0, this.dodgeCD - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    if ((this.input.wasPressed("ControlLeft") || this.input.wasPressed("ControlRight")) && this.dodgeCD <= 0 && this.dodgeT <= 0) {
      this.dodgeT = 0.32; this.dodgeCD = 2.0; this.iframes = Math.max(this.iframes, 0.35);
      synth.ability();
      // burst velocity in move dir (or facing)
      let dx2 = mx, dz2 = mz;
      if (ax.x === 0 && ax.z === 0) {
        const basis = horizontalBasis(this.yaw);
        const sign = this.reverseForward ? -1 : 1;
        dx2 = basis.forwardX * sign;
        dz2 = basis.forwardZ * sign;
      }
      this.vel.x = dx2 * 17; this.vel.z = dz2 * 17;
      this.events.shake(0.15);
    }
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      // Regular movement is sub-stepped through moveHorizontalSafe.
    }
    // shield regen? no; shield decays slowly after bulwark
    if (this.maxShield > 0 && this.shield <= 0) this.maxShield = 0;

    // cooldowns
    for (let i = 0; i < 3; i++) this.skillCD[i] = Math.max(0, this.skillCD[i]! - dt);
    this.overdriveT = Math.max(0, this.overdriveT - dt);
    this.executionT = Math.max(0, this.executionT - dt);
    this.saturationT = Math.max(0, this.saturationT - dt);
    this.slideT = Math.max(0, this.slideT - dt);
    this.bloom = Math.max(0, this.bloom - dt * 6);
    this.gunRecoil = Math.max(0, this.gunRecoil - dt * 5);

    // reload
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo = this.magSize(); }
    } else if (this.ammo <= 0) {
      this.startReload();
    }

    // firing
    this.fireTimer -= dt;
    if (this.input.mouseDown && this.reloading <= 0 && this.fireTimer <= 0) {
      if (this.ammo > 0 || this.saturationT > 0) this.firePrimary();
      else this.startReload();
    }
    // semi-auto shotguns: require re-click? Spec says hold for repeated fire at cadence — allow hold for all.
    void def;

    // skills
    if (this.input.wasPressed("KeyQ")) this.castSkill(0);
    if (this.input.wasPressed("KeyE")) this.castSkill(1);
    if (this.input.wasPressed("KeyR")) this.castSkill(2);

    // interact
    if (this.input.wasPressed("KeyF")) this.tryInteract();

    if (this.saturationT > 0) this.satTick = Math.max(0, this.satTick - dt);

    // player mesh transform
    this.playerMesh.position.copyFrom(this.pos);
    this.playerMesh.rotation.y = this.yaw + Math.PI;
    // lean / run bob
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.playerBody.position.y = 1.0 + Math.sin(this.runTime * 11) * 0.05 * Math.min(1, spd / 6);
    this.playerBody.scaling.y = this.bodyScaleY * (this.dodgeT > 0 ? 0.8 : 1);
    this.gunMesh.position.z = 0.35 - this.gunRecoil * 0.35;
  }

  grounded(): boolean {
    return this.pos.y <= this.cgh(this.pos.x, this.pos.z, this.pos.y) + 0.05;
  }

  private startReload(): void {
    if (this.reloading > 0 || this.ammo >= this.magSize() || this.saturationT > 0) return;
    this.reloading = this.reloadTime();
    synth.reload();
  }

  muzzlePos(): Vector3 {
    // Honest origin, computed synchronously from the CURRENT authoritative
    // (pos/yaw/pitch) state — never a previous frame's pose. The visual tick
    // writes muzzleOverride as a fallback (rest not yet measured, etc.);
    // otherwise the legacy hip-height formula. Only the ray START moves —
    // direction is recomputed muzzle -> aim point at every call site, so
    // damage, cadence, spread, range, and wall/enemy tests behave identically.
    if (this.externalStatus === "pmx" && this.externalRoot) {
      const rig = getTololoRig(this.externalRoot);
      if (rig?.rest) {
        const out = new Vector3();
        if (tololoMuzzleWorldFromPose(rig, this.weaponMount.scaling.x || 0.6,
          this.pos, this.yaw, this.pitch, out)) return out;
      }
    }
    if (this.muzzleOverride) return this.muzzleOverride.clone();
    const f = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new Vector3(-f.z, 0, f.x);
    return new Vector3(
      this.pos.x + f.x * 0.8 + r.x * 0.35,
      this.pos.y + 1.45,
      this.pos.z + f.z * 0.8 + r.z * 0.35,
    );
  }

  private aimDir(spreadDeg: number): Vector3 {
    // Aim from camera through crosshair; then direction from muzzle toward aim point.
    const dir = new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    if (spreadDeg > 0) {
      const s = (spreadDeg * Math.PI) / 180;
      dir.x += (this.gameplayRandom() - 0.5) * 2 * s;
      dir.y += (this.gameplayRandom() - 0.5) * 2 * s;
      dir.z += (this.gameplayRandom() - 0.5) * 2 * s;
      dir.normalize();
    }
    return dir;
  }

  private computeAimPoint(): void {
    // Camera-center ray; find wall/enemy limited point for muzzle validation.
    const origin = this.cameraOrigin();
    const dir = this.camTarget.subtract(this.camPos).normalize();
    const wallD = raycastSolid(origin, dir, this.def.weapon.range + 30, this.world.colliders);
    let best = Math.min(wallD, this.def.weapon.range);
    // enemies: sphere intersect
    for (const e of this.enemies) {
      const to = e.pos.clone(); to.y += 1.1;
      const oc = to.subtract(origin);
      const t = oc.dot(dir);
      if (t < 0 || t > best) continue;
      const perp = origin.add(dir.scale(t)).subtract(to).length();
      if (perp < e.radius + 0.5) best = t;
    }
    this.aimPoint = origin.add(dir.scale(best));
  }

  private cameraOrigin(): Vector3 {
    return this.camPos.clone();
  }

  firePrimary(isProc = false, dmgMulOverride?: number): void {
    const def = this.def;
    this.computeAimPoint();
    const muzzle = this.muzzlePos();
    const fx = weaponRankEffect(def.weapon.type, this.build.weaponRank);
    const baseShot = (dmgMulOverride ?? 1) * this.shotDamage();
    // deadeye consume
    let dmgMul = 1;
    const deadeye = this.deadeyeShots > 0 && !isProc;
    if (deadeye) dmgMul *= this.deadeyePower;
    const shotFx = deadeye ? { ...fx, extraPierce: fx.extraPierce + this.deadeyePierce } : fx;
    const plan = createShotPlan(def.weapon, shotFx, baseShot * dmgMul, this.ammo, isProc || this.saturationT > 0);
    if (plan.projectileCount <= 0) { this.startReload(); return; }
    if (!isProc) {
      this.ammo = Math.max(0, this.ammo - plan.ammoCost);
      this.fireTimer = this.fireInterval();
      this.gunRecoil = Math.min(1, this.gunRecoil + (def.weapon.type === "SG" || def.weapon.type === "RF" ? 0.8 : 0.28));
      if (def.id === "peritya") this.bloom = Math.min(1, this.bloom + 0.08);
      if (deadeye) this.deadeyeShots--;
    }
    const spread = def.weapon.spreadDeg * (this.aiming ? 0.45 : 1) + (def.id === "peritya" ? this.bloom * 5 : 0);
    // muzzle-to-target validation: recompute dir from muzzle to aim point
    const toAim = this.aimPoint.subtract(muzzle);
    const distAim = toAim.length();
    const baseDir = distAim > 0.001 ? toAim.scale(1 / distAim) : this.aimDir(0);
    // One consistent firing snapshot for this shot: hit detection, tracers,
    // and any muzzle effect share these COPIES (pooled effects never retain
    // the live transform). Existing shots continue independently afterwards.
    const shotId = ++this.shotSeq;
    this.shotLog.push({
      id: shotId, step: this.stepCount, frameMs: performance.now(),
      muzzle: muzzle.clone(), aim: this.aimPoint.clone(), dir: baseDir.clone(),
      tracers: 0, tracerA: null, tracerB: null,
    });
    if (this.shotLog.length > 8) this.shotLog.shift();
    if (!isProc) this.spawnFlash(muzzle, baseDir);
    let anyHit = false, anyKill = false;
    let saturationImpact: Vector3 | null = null;
    for (let p = 0; p < plan.projectileCount; p++) {
      const dir = baseDir.clone();
      if (spread > 0) {
        const s = (spread * Math.PI) / 180;
        dir.x += (this.gameplayRandom() - 0.5) * 2 * s;
        dir.y += (this.gameplayRandom() - 0.5) * 2 * s;
        dir.z += (this.gameplayRandom() - 0.5) * 2 * s;
        dir.normalize();
      }
      const wallD = raycastSolid(muzzle, dir, def.weapon.range, this.world.colliders);
      // gather enemy hits along ray (sorted), with pierce count
      const hits = this.rayEnemies(muzzle, dir, Math.min(wallD, def.weapon.range), plan.maxTargetsPerProjectile);
      if (hits.length === 0) {
        const end = muzzle.add(dir.scale(Math.min(wallD, def.weapon.range)));
        this.spawnTracer(muzzle, end, shotId);
        continue;
      }
      for (const h of hits) {
        const crit = def.weapon.critEligible && this.gameplayRandom() < this.critCh();
        const dmg = plan.damagePerProjectile * (crit ? this.critMult() : 1);
        const center = new Vector3(h.pos.x, h.pos.y + 1.0, h.pos.z);
        const hitAt = raySphereEntryPoint(muzzle, dir, center, h.radius + 0.55);
        const killed = this.damageEnemy(h, dmg, { direct: true, crit, isProc, knockback: def.weapon.type === "SG" ? 2.2 : 0 });
        this.impactBurst(hitAt, crit);
        anyHit = true; if (killed) anyKill = true;
        saturationImpact ??= h.pos.clone();
        this.spawnTracer(muzzle, hitAt, shotId);
        const followDepth = nextProcDepth(isProc ? PROC.MAX_CHAIN : 0);
        if (followDepth !== null && !killed) {
          // Tololo overdrive bonus shot every 4th hit
          if (this.overdriveT > 0 && def.id === "tololo") {
            this.overdriveCount++;
            if (this.overdriveCount % PROC.TOLOLO_BONUS_EVERY === 0) {
              if (this.damageEnemy(h, this.totalAtk() * 0.8, { isProc: true, knockback: 0 })) anyKill = true;
            }
          }
          // Qiongjiu execution follow-up (bounded, never recurses)
          if (this.executionT > 0 && def.id === "qiongjiu") {
            if (this.damageEnemy(h, this.totalAtk() * PROC.QIONGJIU_FOLLOW_PCT, { isProc: true, knockback: 0 })) anyKill = true;
          }
        }
      }
    }
    if (!isProc && def.id === "peritya" && this.saturationT > 0 && saturationImpact && this.satTick <= 0) {
      this.satTick = 0.35;
      this.explodeAt(saturationImpact, 4.5, this.totalAtk() * 0.6, false);
    }
    if (!isProc) {
      synth.fire(def.weapon.type);
      if (anyHit) { this.events.hitmarker(anyKill); synth.impact(); }
      if (this.ammo <= 0 && this.saturationT <= 0) this.startReload();
      if (this.empowerMagT > 0 && this.ammo <= 0) this.empowerMagT = 0;
    }
  }

  private rayEnemies(origin: Vector3, dir: Vector3, maxDist: number, maxHits: number): Enemy[] {
    const out: { e: Enemy; t: number }[] = [];
    for (const e of this.enemies) {
      const c = new Vector3(e.pos.x, e.pos.y + 1.0, e.pos.z);
      const oc = c.subtract(origin);
      const t = oc.dot(dir);
      if (t < 0.5 || t > maxDist) continue;
      const closest = origin.add(dir.scale(t));
      if (closest.subtract(c).length() < e.radius + 0.55) out.push({ e, t });
    }
    out.sort((a, b) => a.t - b.t);
    return out.slice(0, Math.max(1, maxHits)).map((o) => o.e);
  }

  private spawnTracer(a: Vector3, b: Vector3, shotId?: number): void {
    if (shotId !== undefined) {
      const log = this.shotLog.find((e) => e.id === shotId);
      if (log) {
        log.tracers++;
        if (!log.tracerA) { log.tracerA = a.clone(); log.tracerB = b.clone(); }
      }
    }
    const t = this.tracers.find((t) => !t.active);
    if (!t) return;
    t.active = true; t.life = 0.07;
    t.mesh.isVisible = true;
    const mid = a.add(b).scale(0.5);
    t.mesh.position.copyFrom(mid);
    t.mesh.lookAt(b);
    const len = Math.max(0.5, a.subtract(b).length());
    t.mesh.scaling.set(1, 1, len);
  }

  // ----- skills -----
  castSkill(idx: 0 | 1 | 2): void {
    if (this.skillCD[idx]! > 0 || !this.alive) return;
    const id = this.build.charId;
    const rank = idx === 0 ? this.build.s1 : idx === 1 ? this.build.s2 : this.build.s3;
    const fx = skillRankEffect(idx, rank);
    const cd = this.def.skills[idx]!.cooldown * fx.cdMul;
    const ok = this.execSkill(id, idx, rank, fx.powerMul);
    if (ok) {
      this.skillCD[idx] = cd;
      if (idx === 2) synth.ult(); else synth.ability();
    }
  }

  private execSkill(id: CharId, idx: number, rank: number, pow: number): boolean {
    this.computeAimPoint();
    const muzzle = this.muzzlePos();
    if (id === "tololo") {
      if (idx === 0) {
        const rounds = rank >= 5 ? 5 : rank >= 3 ? 4 : 3;
        for (let i = 0; i < rounds; i++) {
          const dir = this.muzzleDirToAim();
          const wallD = raycastSolid(muzzle, dir, 80, this.world.colliders);
          const hits = this.rayEnemies(muzzle, dir, Math.min(wallD, 80), 1);
          const tgt = hits[0];
          const crit = this.gameplayRandom() < this.critCh();
          const dmg = this.totalAtk() * 2.2 * pow * (crit ? this.critMult() : 1);
          if (tgt) { this.damageEnemy(tgt, dmg, { direct: true, crit, isProc: true }); this.spawnTracer(muzzle, new Vector3(tgt.pos.x, tgt.pos.y + 1.1, tgt.pos.z)); }
          else this.spawnTracer(muzzle, muzzle.add(dir.scale(Math.min(wallD, 60))));
        }
        synth.fire("RF");
        return true;
      }
      if (idx === 1) {
        const ax = this.input.moveAxes();
        const basis = horizontalBasis(this.yaw);
        const move = cameraRelativeMove(ax.x, ax.z, this.yaw, this.reverseForward, this.reverseStrafe);
        const sign = this.reverseForward ? -1 : 1;
        const dx = ax.x === 0 && ax.z === 0 ? basis.forwardX * sign : move.x;
        const dz = ax.x === 0 && ax.z === 0 ? basis.forwardZ * sign : move.z;
        const dashDistance = rank >= 5 ? 12 : rank >= 3 ? 10 : 8;
        moveHorizontalSafe(this.pos, dx * dashDistance, dz * dashDistance, 0.55, this.world.colliders, this.world.bounds);
        this.iframes = Math.max(this.iframes, 0.3);
        this.empowerMagT = 999; this.empowerMul = 1 + 0.25 * pow;
        this.ammo = this.magSize();
        this.reloading = 0;
        this.events.toast(`Phase Step — next magazine +${Math.round((this.empowerMul - 1) * 100)}%`);
        return true;
      }
      // R overdrive
      this.overdriveT = 8 * pow + (rank >= 3 ? 1.5 : 0);
      this.overdriveCount = 0;
      this.events.toast("Overdrive engaged!");
      return true;
    }
    if (id === "qiongjiu") {
      if (idx === 0) {
        const dir = this.muzzleDirToAim();
        const wallD = raycastSolid(muzzle, dir, 70, this.world.colliders);
        const hits = this.rayEnemies(muzzle, dir, Math.min(70, wallD), 1);
        const tgt = hits[0];
        if (!tgt) { this.events.toast("No target marked"); return false; }
        tgt.markT = rank >= 5 ? 14 : rank >= 3 ? 12 : 8;
        tgt.markMul = 1 + 0.3 * pow;
        this.events.toast(`Marked ${tgt.kind === "boss" ? "BOSS" : tgt.kind} (+${Math.round((tgt.markMul - 1) * 100)}% dmg)`);
        return true;
      }
      if (idx === 1) {
        const maxTargets = rank >= 5 ? 7 : rank >= 3 ? 6 : 5;
        const vis = this.visibleEnemies(45).slice(0, maxTargets);
        if (vis.length === 0) { this.events.toast("No visible enemies"); return false; }
        // prioritize marked
        vis.sort((a, b) => (b.markT > 0 ? 1 : 0) - (a.markT > 0 ? 1 : 0));
        vis.forEach((e, i) => this.volleyQueue.push({ t: 0.18 * (i + 1), targetId: e.id, power: 1.5 * pow, kind: "volley" }));
        return true;
      }
      this.executionT = 6 * pow + (rank >= 3 ? 1.5 : 0);
      this.events.toast("Execution Window open!");
      return true;
    }
    if (id === "mosin") {
      if (idx === 0) {
        const dir = this.muzzleDirToAim();
        const wallD = raycastSolid(muzzle, dir, 110, this.world.colliders);
        const hits = this.rayEnemies(muzzle, dir, Math.min(wallD, 110), 4 + (rank >= 3 ? 1 : 0) + (rank >= 5 ? 1 : 0));
        if (hits.length === 0) this.spawnTracer(muzzle, muzzle.add(dir.scale(Math.min(wallD, 80))));
        for (const h of hits) {
          const crit = this.gameplayRandom() < Math.min(1, this.critCh() + 0.15);
          this.damageEnemy(h, this.totalAtk() * 3.0 * pow * (crit ? this.critMult() : 1), { direct: true, crit, isProc: true });
        this.spawnTracer(muzzle, new Vector3(h.pos.x, h.pos.y + 1.1, h.pos.z));
        }
        synth.fire("RF");
        this.events.shake(0.35);
        return true;
      }
      if (idx === 1) {
        const f = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const p = new Vector3(this.pos.x + f.x * 4, 0, this.pos.z + f.z * 4);
        p.y = this.gh(p.x, p.z);
        const mesh = MeshBuilder.CreateDisc(`trap-${Date.now()}`, { radius: 3 + rank * 0.3, tessellation: 32 }, this.scene);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position = new Vector3(p.x, p.y + 0.1, p.z);
        mesh.material = stdMat(this.scene, `trapM-${Date.now()}`, new Color3(0.3, 0.8, 1), new Color3(0.2, 0.6, 0.9));
        this.fields.push({ kind: "trap", pos: p.clone(), radius: 3.2 + rank * 0.3, duration: 30, age: 0, tickT: 0, power: 1.2 * pow, mesh, mesh2: null, triggered: false, owner: "mosin" });
        synth.trap();
        return true;
      }
      this.deadeyeShots = rank >= 3 ? 4 : 3;
      this.deadeyePower = 1 + 1.2 * pow;
      this.deadeyePierce = rank >= 3 ? 3 : 2;
      this.events.toast(`Deadeye: next ${this.deadeyeShots} shots empowered`);
      return true;
    }
    if (id === "sabrina") {
      if (idx === 0) {
        const dir = this.muzzleDirToAim();
        const hits = this.coneEnemies(muzzle, dir, 14 + rank, rank >= 3 ? 65 : 55);
        for (const h of hits) {
          const crit = this.gameplayRandom() < this.critCh();
          this.damageEnemy(h, this.totalAtk() * 1.8 * pow * (crit ? this.critMult() : 1), { direct: true, crit, isProc: true, knockback: h.kind === "boss" ? 0 : 6, stun: rank >= 5 ? 1.4 : 0.9 });
        }
        synth.fire("SG");
        this.events.shake(0.4);
        this.spawnTracer(muzzle, muzzle.add(dir.scale(10)));
        return true;
      }
      if (idx === 1) {
        const p = this.pos.clone(); p.y = this.gh(p.x, p.z);
        const mesh = MeshBuilder.CreateDisc(`prot-${Date.now()}`, { radius: 6 + (rank >= 3 ? 1.5 : 0), tessellation: 40 }, this.scene);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position = new Vector3(p.x, p.y + 0.12, p.z);
        mesh.material = stdMat(this.scene, `protM-${Date.now()}`, new Color3(0.3, 0.7, 1), new Color3(0.2, 0.5, 0.9));
        const f: Field = { kind: "protect", pos: p.clone(), radius: 6 + (rank >= 3 ? 1.5 : 0), duration: 8 + (rank >= 4 ? 3 : 0), age: 0, tickT: 0, power: 0.4 * pow, mesh, mesh2: null, triggered: false, owner: "sabrina" };
        this.fields.push(f); this.protectFields.push(f);
        return true;
      }
      // R bulwark
      const amt = 120 * pow + (rank >= 3 ? 80 : 0);
      this.shield = Math.min(300, this.shield + amt);
      this.maxShield = Math.max(this.maxShield, this.shield);
      const pulses = rank >= 3 ? 7 : 5;
      for (let i = 0; i < pulses; i++) this.booms.push({ t: 0.4 * (i + 1), pos: this.pos.clone(), power: 1.0 * pow, radius: 7 });
      this.events.toast(`Bulwark shield +${Math.round(amt)}`);
      return true;
    }
    if (id === "peritya") {
      if (idx === 0) {
        const dir = this.muzzleDirToAim();
        const ticks = rank >= 5 ? 8 : 6;
        const cone = rank >= 3 ? 35 : 28;
        for (let i = 0; i < ticks; i++) this.volleyQueue.push({ t: 0.18 * (i + 1), targetId: -1, power: 0.7 * pow, kind: "sweep", dirX: dir.x, dirZ: dir.z, cone });
        return true;
      }
      if (idx === 1) {
        const p = this.aimPoint.clone(); p.y = this.gh(p.x, p.z);
        const mesh = MeshBuilder.CreateDisc(`snare-${Date.now()}`, { radius: 7, tessellation: 40 }, this.scene);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position = new Vector3(p.x, p.y + 0.12, p.z);
        mesh.material = stdMat(this.scene, `snareM-${Date.now()}`, new Color3(0.6, 0.3, 1), new Color3(0.4, 0.2, 0.8));
        this.fields.push({ kind: "snare", pos: p.clone(), radius: 7 + (rank >= 3 ? 1.5 : 0), duration: 6 + (rank >= 4 ? 2 : 0), age: 0, tickT: 0, power: 0.5 * pow, mesh, mesh2: null, triggered: false, owner: "peritya" });
        return true;
      }
      this.saturationT = 8 * pow + (rank >= 3 ? 1.5 : 0);
      this.satTick = 0;
      this.reloading = 0;
      this.events.toast("Saturation Fire — unlimited mag!");
      return true;
    }
    // vepley
    if (idx === 0) {
      this.explodeAt(this.aimPoint.clone(), 5 + rank * 0.3, this.totalAtk() * 2.0 * pow, true);
      synth.fire("SG");
      this.events.shake(0.45);
      return true;
    }
    if (idx === 1) {
      const ax = this.input.moveAxes();
      const basis = horizontalBasis(this.yaw);
      const move = cameraRelativeMove(ax.x, ax.z, this.yaw, this.reverseForward, this.reverseStrafe);
      const sign = this.reverseForward ? -1 : 1;
      const dx = ax.x === 0 && ax.z === 0 ? basis.forwardX * sign : move.x;
      const dz = ax.x === 0 && ax.z === 0 ? basis.forwardZ * sign : move.z;
      const blastDir = new Vector3(basis.forwardX, 0, basis.forwardZ);
      const slideDistance = rank >= 3 ? 8 : 6.6;
      moveHorizontalSafe(this.pos, dx * slideDistance, dz * slideDistance, 0.55, this.world.colliders, this.world.bounds);
      this.slideT = 0.5; this.iframes = Math.max(this.iframes, 0.3);
      const slideMuzzle = this.muzzlePos();
      for (const h of this.coneEnemies(slideMuzzle, blastDir, 10 + rank, 70)) {
        this.damageEnemy(h, this.totalAtk() * 1.6 * pow, { isProc: true, knockback: h.kind === "boss" ? 0 : 7 });
      }
      synth.fire("SG");
      return true;
    }
    // R grand finale
    {
      const center = this.aimPoint.clone();
      const n = rank >= 3 ? 8 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 3 + (i % 3) * 2.5;
        const p = new Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
        p.y = this.gh(p.x, p.z);
        // telegraph disc
        const mesh = MeshBuilder.CreateDisc(`fin-${Date.now()}-${i}`, { radius: 3.4, tessellation: 28 }, this.scene);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position = new Vector3(p.x, p.y + 0.1, p.z);
        mesh.material = stdMat(this.scene, `finM-${Date.now()}-${i}`, new Color3(1, 0.4, 0.3), new Color3(0.9, 0.25, 0.15));
        this.fields.push({ kind: "finale", pos: p.clone(), radius: 3.6, duration: 0.9 + i * 0.12, age: 0, tickT: 0, power: 1.8 * pow, mesh, mesh2: null, triggered: false, owner: "vepley" });
      }
      return true;
    }
  }

  private muzzleDirToAim(): Vector3 {
    const m = this.muzzlePos();
    const d = this.aimPoint.subtract(m);
    if (d.length() < 0.01) return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return d.normalize();
  }

  private visibleEnemies(maxDist: number): Enemy[] {
    const out: Enemy[] = [];
    const m = this.muzzlePos();
    for (const e of this.enemies) {
      const t = new Vector3(e.pos.x, e.pos.y + 1, e.pos.z);
      const d = t.subtract(m);
      const dist = d.length();
      if (dist > maxDist) continue;
      const dir = d.scale(1 / dist);
      const wallD = raycastSolid(m, dir, dist, this.world.colliders);
      if (wallD < dist - 0.6) continue;
      out.push(e);
    }
    return out;
  }

  private coneEnemies(origin: Vector3, dir: Vector3, range: number, halfAngleDeg: number): Enemy[] {
    const out: Enemy[] = [];
    const cosT = Math.cos((halfAngleDeg * Math.PI) / 180);
    for (const e of this.enemies) {
      const to = new Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
      const dist = to.length();
      if (dist > range + e.radius) continue;
      to.normalize();
      const flat = new Vector3(dir.x, 0, dir.z);
      if (flat.length() < 1e-4) flat.set(0, 0, -1);
      flat.normalize();
      if (to.dot(flat) < cosT && dist > 1.5) continue;
      const target = new Vector3(e.pos.x, e.pos.y + 1, e.pos.z);
      const sight = target.subtract(origin);
      const sightDist = sight.length();
      if (sightDist > 0.01 && raycastSolid(origin, sight.scale(1 / sightDist), sightDist, this.world.colliders) < sightDist - 0.5) continue;
      out.push(e);
    }
    return out;
  }

  explodeAt(center: Vector3, radius: number, damage: number, knockPlayerEnemies: boolean): void {
    synth.explode();
    this.events.shake(0.4);
    // visual: expanding sphere flash (pooled tracer hack: use a temp mesh with disposal timer via fields)
    const mesh = MeshBuilder.CreateSphere(`boom-${Date.now()}-${Math.floor(this.cosmeticRandom() * 1e6)}`, { diameter: radius * 1.2 }, this.scene);
    mesh.position = new Vector3(center.x, center.y + 1, center.z);
    mesh.material = stdMat(this.scene, `boomM-${Date.now()}`, new Color3(1, 0.6, 0.25), new Color3(1, 0.45, 0.15));
    this.fields.push({ kind: "bulwarkPulse", pos: center.clone(), radius: 0, duration: 0.22, age: 0, tickT: 0, power: 0, mesh, mesh2: null, triggered: false, owner: "fx" });
    for (const e of [...this.enemies]) {
      const target = new Vector3(e.pos.x, e.pos.y + 1, e.pos.z);
      const blastOrigin = new Vector3(center.x, center.y + 0.3, center.z);
      const delta = target.subtract(blastOrigin);
      const d = delta.length();
      if (d < radius + e.radius) {
        if (d > 0.01 && raycastSolid(blastOrigin, delta.scale(1 / d), d, this.world.colliders) < d - 0.6) continue;
        const crit = this.gameplayRandom() < this.critCh();
        this.damageEnemy(e, damage * (crit ? this.critMult() : 1), { crit, isProc: true, knockback: knockPlayerEnemies && e.kind !== "boss" ? 8 : 0, from: center });
      }
    }
  }

  damageEnemy(e: Enemy, amount: number, opts: { direct?: boolean; isProc?: boolean; knockback?: number; from?: Vector3; crit?: boolean; stun?: number } = {}): boolean {
    if (!this.enemies.includes(e)) return false;
    if (opts.direct && e.markT > 0) amount *= e.markMul;
    e.hp -= amount;
    e.flashT = 0.09;
    if (e.ch) e.ch.anim.flinchT = Math.max(e.ch.anim.flinchT, 0.18);
    this.events.damageNumber({ pos: new Vector3(e.pos.x, e.pos.y + 2.2, e.pos.z), text: Math.round(amount).toString(), crit: !!opts.crit });
    if (opts.knockback && e.kind !== "boss" && !e.kbResist) {
      const away = opts.from ? new Vector3(e.pos.x - opts.from.x, 0, e.pos.z - opts.from.z) : new Vector3(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z);
      const l = away.length() || 1;
      moveHorizontalSafe(e.pos, (away.x / l) * opts.knockback * 0.35, (away.z / l) * opts.knockback * 0.35, e.radius, this.world.colliders, this.world.bounds);
    }
    if (opts.stun) e.stunT = Math.max(e.stunT, opts.stun * (e.kind === "boss" ? 0.35 : 1));
    if (e.hp <= 0) {
      this.killEnemy(e);
      return true;
    }
    return false;
  }

  private killEnemy(e: Enemy): void {
    const idx = this.enemies.indexOf(e);
    if (idx < 0) return;
    this.enemies.splice(idx, 1);
    e.Telegraph?.dispose(false, true);
    if (e.ch) {
      // Keep the articulated body briefly for a readable in-place death.
      // It is no longer authoritative or collidable once removed above.
      this.dying.push({ mesh: e.mesh, vest: e.bodyMat, t: 0.75, duration: 0.75 });
    } else {
      e.mesh.dispose(false, true);
    }
    this.kills++;
    if (e.kind === "boss") {
      this.bossDead = true;
      this.bossRef = null;
      // Grant boss XP directly so victory cannot strand an uncollectable orb.
      this.addXp(BOSS_DEF.xp, false);
      this.events.killfeed(`Warden destroyed`);
      this.events.toast("Boss defeated! Charge the relay to finish.");
      if (objectiveComplete(this.bossDead, this.relayCharge)) {
        this.interrupted = true;
        this.events.victory();
      }
      return;
    }
    this.dropOrb(e.pos, e.elite ? ENEMIES[e.kind as EnemyKind].xp * 3 : ENEMIES[e.kind as EnemyKind].xp, false);
    if (this.gameplayRandom() < (e.elite ? 1.0 : 0.03)) {
      // attachment drop: elite always, normal rarely... normal heals instead
      if (e.elite) { this.elitesKilled++; this.dropAttachment(e.pos); }
      else this.dropOrb(e.pos, 0, true);
    } else if (!e.elite && this.gameplayRandom() < 0.06) {
      this.dropOrb(e.pos, 0, true);
    }
  }

  private dropOrb(pos: Vector3, value: number, heal: boolean): void {
    const o = this.orbs.find((candidate) => !candidate.active) ?? this.orbs.reduce((oldest, candidate) => candidate.life < oldest.life ? candidate : oldest);
    o.active = true; o.value = value; o.heal = heal; o.life = 40;
    const ox = pos.x + (this.gameplayRandom() - 0.5) * 1.5;
    const oz = pos.z + (this.gameplayRandom() - 0.5) * 1.5;
    o.pos.set(ox, this.gh(ox, oz) + 1, oz);
    o.mesh.isVisible = true;
    o.mesh.position.copyFrom(o.pos);
    const m = o.mesh.material as StandardMaterial;
    if (heal) { m.diffuseColor = new Color3(0.3, 1, 0.5); m.emissiveColor = new Color3(0.2, 0.8, 0.35); }
    else { m.diffuseColor = new Color3(0.5, 0.7, 1); m.emissiveColor = new Color3(0.3, 0.5, 1); }
  }

  private dropAttachment(pos: Vector3): void {
    // rarity luck scales with time + loop
    const luck = Math.min(3, this.runTime / 240 + this.loop);
    const rarity = rollRarity(this.gameplayRandom, luck);
    const slots = slotsFor(this.build.charId);
    const slot = slots[Math.floor(this.gameplayRandom() * slots.length)]!;
    const def = rollAttachment(slot, rarity, this.gameplayRandom, this.def.baseAtk);
    // The renderer creates one marker per pending world drop.
    pendingAttachmentDrops.push({ pos: pos.clone(), def });
    this.events.toast(`Attachment dropped [${def.rarity}] — walk over (F near caches too)`);
  }

  private rollRarityLocal(luck: number): Rarity {
    return rollRarity(this.gameplayRandom, luck);
  }
  private rollAttachmentLocal(slot: SlotKind, rarity: Rarity): AttachmentDef {
    return rollAttachment(slot, rarity, this.gameplayRandom, this.def.baseAtk);
  }

  // ----- director -----
  private updateDirector(dt: number): void {
    const maxPop = Math.min(34, 14 + this.loop * 4 + Math.floor(this.runTime / 90));
    const pressure = (0.38 + this.difficulty * 0.13) * (this.relayActive ? 1.4 : 1);
    this.spawnBudget = Math.min(14, this.spawnBudget + dt * pressure);
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.enemies.length >= maxPop || this.spawnBudget < 1) return;
    this.spawnT = Math.max(0.22, 0.7 - this.difficulty * 0.025);
    const unlocked: EnemyKind[] = ["chaser"];
    if (this.runTime > 20) unlocked.push("runner");
    if (this.runTime > 75) unlocked.push("spitter");
    if (this.runTime > 150) unlocked.push("heavy");
    const affordable = unlocked.filter((kind) => ENEMIES[kind].score <= this.spawnBudget);
    if (affordable.length === 0) return;
    // Weight toward affordable tougher units as pressure rises while retaining variety.
    affordable.sort((a, b) => ENEMIES[a].score - ENEMIES[b].score);
    const bias = Math.pow(this.gameplayRandom(), Math.max(0.35, 1.3 - this.difficulty * 0.08));
    const kind = affordable[Math.min(affordable.length - 1, Math.floor(bias * affordable.length))]!;
    const spawned = this.spawnEnemy(kind);
    if (spawned) this.spawnBudget = Math.max(0, this.spawnBudget - ENEMIES[kind].score * (spawned.elite ? 1.8 : 1));
  }

  spawnEnemy(forceKind?: EnemyKind, forcePos?: Vector3, eliteOverride?: boolean): Enemy | null {
    const t = this.runTime;
    let kind: EnemyKind = forceKind ?? "chaser";
    if (!forceKind) {
      const r = this.gameplayRandom();
      const unlockRunner = t > 20, unlockSpitter = t > 75, unlockHeavy = t > 150;
      if (unlockHeavy && r < 0.12 + this.loop * 0.02) kind = "heavy";
      else if (unlockSpitter && r < 0.34) kind = "spitter";
      else if (unlockRunner && r < 0.62) kind = "runner";
      else kind = "chaser";
    }
    const base = ENEMIES[kind];
    const scale = enemyScale(this.difficulty);
    const elite = eliteOverride ?? this.gameplayRandom() < Math.min(0.16, 0.03 + t / 900 + this.loop * 0.03 + (this.relayActive ? 0.04 : 0));
    let pos: Vector3;
    if (forcePos) pos = forcePos.clone();
    else {
      // valid reachable ground outside safety radius 18, within 55
      let p: Vector3 | null = null;
      for (let tries = 0; tries < 12; tries++) {
        const c = this.world.spawnPoints[Math.floor(this.gameplayRandom() * this.world.spawnPoints.length)]!;
        const jx = c.x + (this.gameplayRandom() - 0.5) * 10, jz = c.z + (this.gameplayRandom() - 0.5) * 10;
        const d = Math.hypot(jx - this.pos.x, jz - this.pos.z);
        if (d < 18 || d > 60) continue;
        const candidate = new Vector3(jx, this.gh(jx, jz), jz);
        if (!isGroundSpawnValid(candidate, base.radius, this.world.colliders)) continue;
        p = candidate;
        break;
      }
      if (!p) return null;
      pos = p;
    }
    pos.y = this.gh(pos.x, pos.z);
    const e = this.makeEnemyMesh(kind, elite, pos);
    e.hp = e.maxHp = Math.round(base.hp * scale.hpMul * (elite ? 2.4 : 1) * (1 + this.loop * 0.5));
    e.speed = base.speed * (elite ? 1.1 : 1) * (0.9 + this.gameplayRandom() * 0.2);
    e.damage = Math.round(base.damage * scale.dmgMul * (elite ? 1.4 : 1));
    e.attackCd = base.attackCd; e.attackRange = base.attackRange;
    this.enemies.push(e);
    return e;
  }

  private makeEnemyMesh(kind: EnemyKind | "boss", elite: boolean, pos: Vector3): Enemy {
    const s = this.scene;
    const root = new Mesh(`enemy-${nextId++}`, s);
    let body: Mesh;
    let color = new Color3(0.75, 0.2, 0.2);
    let emis = new Color3(0.4, 0.05, 0.05);
    let radius = 0.7;
    let m: StandardMaterial | null = null;
    let ch: Enemy["ch"] = null;
    if (kind === "chaser" && this.debugChaserVisuals) {
      radius = 0.7;
      try {
        // Original articulated trooper; any failure keeps the legacy box.
        const built = buildChaserVisual(s, root, elite);
        body = built.joints.vestMesh;
        m = built.vestMat;
        emis = m.emissiveColor.clone();
        color = elite ? new Color3(1, 0.8, 0.3) : new Color3(0.3, 0.3, 0.33);
        ch = { joints: built.joints, anim: chaserNewAnim() };
      } catch (err) {
        console.warn("[chaser] articulated visual failed; using legacy fallback", err);
        // The builder is transactional; this guards only unexpected leftovers.
        for (const child of root.getChildren()) child.dispose(false);
        ch = null;
      }
    }
    if (!ch) {
      if (kind === "chaser") { color = new Color3(0.75, 0.2, 0.2); emis = new Color3(0.4, 0.05, 0.05); body = MeshBuilder.CreateBox("b", { width: 1.1, height: 1.5, depth: 0.9 }, s); body.position.y = 1.0; radius = 0.7; }
      else if (kind === "runner") { color = new Color3(1, 0.55, 0.2); emis = new Color3(0.5, 0.2, 0.05); body = MeshBuilder.CreateSphere("b", { diameter: 1.0 }, s); body.position.y = 0.8; radius = 0.55; }
      else if (kind === "spitter") { color = new Color3(0.6, 0.3, 0.9); emis = new Color3(0.3, 0.1, 0.5); body = MeshBuilder.CreateCylinder("b", { height: 1.9, diameterTop: 0.7, diameterBottom: 1.1 }, s); body.position.y = 1.1; radius = 0.65; }
      else if (kind === "heavy") { color = new Color3(0.5, 0.12, 0.15); emis = new Color3(0.35, 0.08, 0.08); body = MeshBuilder.CreateBox("b", { width: 1.9, height: 2.4, depth: 1.6 }, s); body.position.y = 1.4; radius = 1.1; }
      else { color = new Color3(0.9, 0.15, 0.3); emis = new Color3(0.6, 0.1, 0.2); body = MeshBuilder.CreateCylinder("b", { height: 3.2, diameterTop: 1.6, diameterBottom: 2.4 }, s); body.position.y = 1.8; radius = 1.6; }
    }
    // Articulated Chaser keeps its joint hierarchy + body material untouched.
    const mat = m ?? stdMat(s, `emat-${nextId}`, elite ? new Color3(1, 0.8, 0.3) : color!, elite ? new Color3(0.5, 0.35, 0.1) : emis!);
    if (!ch) {
      body!.parent = root;
      body!.material = mat;
    }
    if (!ch) {
      const eye = MeshBuilder.CreateSphere("eye", { diameter: 0.3 }, s);
      eye.parent = root; eye.position.y = kind === "boss" ? 2.6 : 1.5; eye.position.z = -0.55;
      eye.material = stdMat(s, `eye-${nextId}`, new Color3(1, 0.9, 0.4), new Color3(1, 0.7, 0.2));
    }
    if (elite) {
      if (!ch) {
        const crown = MeshBuilder.CreateTorus(`crown`, { diameter: 1.6, thickness: 0.18 }, s);
        crown.parent = root; crown.position.y = kind === "chaser" ? 2.25 : 2.4;
        crown.material = stdMat(s, `crownM-${nextId}`, new Color3(1, 0.85, 0.35), new Color3(0.9, 0.6, 0.15));
      }
      root.scaling.setAll(1.22);
    }
    if (kind === "boss") root.scaling.setAll(1.3);
    root.position.copyFrom(pos);
    return {
      id: nextId++, kind, elite, pos: pos.clone(), vel: new Vector3(), yaw: 0,
      hp: 10, maxHp: 10, speed: 4, damage: 10, radius,
      attackT: 1 + this.gameplayRandom(), attackCd: 1.5, attackRange: 2.2,
      slowT: 0, slowPct: 0, stunT: 0, markT: 0, markMul: 1,
      mesh: root, bodyMat: mat, baseEmissive: (ch ? emis : elite ? new Color3(0.5, 0.35, 0.1) : emis).clone(), flashT: 0, decideT: this.gameplayRandom() * 0.3, stuckT: 0,
      ch: ch ?? null,
      bossPhase: 0, abilityT: 4, abilityKind: 0, telegraphT: 0, Telegraph: null,
      kbResist: kind === "boss" || kind === "heavy",
    };
  }

  spawnBoss(): void {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    // Stage-aware arrival: Green Zone keeps the legacy east-arena point;
    // the tram circuit supplies an in-circuit gate (previous preview data).
    const spawn = this.world.bossSpawn ?? new Vector3(46, 0, 2);
    const p = new Vector3(spawn.x, this.gh(spawn.x, spawn.z), spawn.z);
    const e = this.makeEnemyMesh("boss", false, p);
    const hpMul = (1 + this.loop * 0.6) * (1 + this.runTime / 600);
    e.hp = e.maxHp = Math.round(BOSS_DEF.hp * hpMul);
    e.speed = BOSS_DEF.speed; e.damage = BOSS_DEF.damage; e.attackRange = 3.4; e.attackCd = 1.4;
    e.abilityT = 3;
    this.enemies.push(e);
    this.bossRef = e;
    synth.bossWarn();
    this.events.bossSpawned();
    this.events.toast("⚠ OUTPOST WARDEN detected in the east arena");
  }

  // ----- enemies update (staggered decisions, separation grid) -----
  private updateEnemies(dt: number): void {
    // separation via spatial hash
    const cell = 4;
    const grid = new Map<string, Enemy[]>();
    for (const e of this.enemies) {
      const k = `${Math.floor(e.pos.x / cell)},${Math.floor(e.pos.z / cell)}`;
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(e);
    }
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) continue;
      if (e.ch) { e.ch.anim.moveX = 0; e.ch.anim.moveZ = 0; }
      e.flashT = Math.max(0, e.flashT - dt);
      e.slowT = Math.max(0, e.slowT - dt);
      e.stunT = Math.max(0, e.stunT - dt);
      e.markT = Math.max(0, e.markT - dt);
      e.attackT -= dt;
      // hit flash
      e.bodyMat.emissiveColor = e.flashT > 0 ? new Color3(1, 1, 1) : e.markT > 0 ? new Color3(0.8, 0.55, 0.08) : e.baseEmissive;
      // gravity snare pull
      for (const f of this.fields) {
        if (f.kind !== "snare") continue;
        const d = new Vector3(f.pos.x - e.pos.x, 0, f.pos.z - e.pos.z).length();
        if (d < f.radius && !e.kbResist) {
          const pull = new Vector3(f.pos.x - e.pos.x, 0, f.pos.z - e.pos.z).normalize().scale((4 + f.power * 4) * dt);
          moveHorizontalSafe(e.pos, pull.x, pull.z, e.radius, this.world.colliders, this.world.bounds);
          e.slowT = 0.3; e.slowPct = f.power;
        } else if (d < f.radius) { e.slowT = 0.3; e.slowPct = f.power * 0.55; }
      }
      // shock trap trigger
      for (const f of this.fields) {
        if (f.kind !== "trap" || f.triggered) continue;
        const d = new Vector3(f.pos.x - e.pos.x, 0, f.pos.z - e.pos.z).length();
        if (d < f.radius) {
          f.triggered = true;
          this.explodeTrap(f);
          break;
        }
      }
      if (!this.enemies.includes(e)) continue;
      if (e.stunT > 0) { this.syncEnemyMesh(e, dt); continue; }
      if (e.kind === "boss") { this.updateBoss(e, dt); continue; }
      e.decideT -= dt;
      const toPlayer = new Vector3(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z);
      const dist = toPlayer.length();
      const dir = dist > 0.001 ? toPlayer.scale(1 / dist) : new Vector3(0, 0, -1);
      const slowed = e.slowT > 0 ? 1 - e.slowPct : 1;
      if (e.kind === "spitter") {
        // keep distance, fire projectiles
        let mvx = 0, mvz = 0;
        if (dist > 24) { mvx = dir.x; mvz = dir.z; }
        else if (dist < 12) { mvx = -dir.x; mvz = -dir.z; }
        else { mvx = -dir.z * 0.6; mvz = dir.x * 0.6; }
        this.moveEnemy(e, mvx, mvz, e.speed * slowed * dt);
        if (e.attackT <= 0 && dist < 30) {
          // line of sight check
          const from = new Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z);
          const tgt = new Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z);
          const d = tgt.subtract(from); const distT = d.length(); const dd = d.scale(1 / distT);
          if (raycastSolid(from, dd, distT, this.world.colliders) >= distT - 0.5) {
            e.attackT = e.attackCd * (0.9 + this.gameplayRandom() * 0.3);
            this.fireEnemyShot(e, tgt);
          } else e.attackT = 0.4;
        }
      } else if (e.kind === "heavy") {
        // slow advance + telegraphed slam
        if (e.telegraphT > 0) {
          e.telegraphT -= dt;
          if (e.Telegraph) {
            const s = 1 + Math.sin(this.runTime * 20) * 0.05;
            e.Telegraph.scaling.set(s, s, 1);
          }
          if (e.telegraphT <= 0) {
            // slam
            e.Telegraph?.dispose(false, true); e.Telegraph = null;
            const d = new Vector3(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z).length();
            if (d < 5.5 && Math.abs(this.pos.y - e.pos.y) < 3) this.damagePlayer(e.damage * 1.4);
            synth.explode();
            this.events.shake(0.4);
          }
        } else {
          this.moveEnemy(e, dir.x, dir.z, e.speed * slowed * dt);
          if (dist < e.attackRange && e.attackT <= 0) {
            e.attackT = e.attackCd;
            if (dist < 3.2 && Math.abs(this.pos.y - e.pos.y) < 2.8) this.damagePlayer(e.damage);
            else {
              // telegraphed slam
              e.telegraphT = 0.9;
              const disc = MeshBuilder.CreateDisc(`htele-${e.id}`, { radius: 5.5, tessellation: 32 }, this.scene);
              disc.rotation.x = -Math.PI / 2;
              disc.position = new Vector3(e.pos.x, this.gh(e.pos.x, e.pos.z) + 0.15, e.pos.z);
              disc.material = stdMat(this.scene, `hteleM-${e.id}-${Date.now()}`, new Color3(1, 0.3, 0.25), new Color3(0.8, 0.15, 0.1));
              e.Telegraph = disc;
              synth.bossWarn();
            }
          }
        }
      } else {
        // chaser / runner melee
        this.moveEnemy(e, dir.x, dir.z, e.speed * slowed * dt);
        if (dist < e.attackRange && Math.abs(this.pos.y - e.pos.y) < 2.4 && e.attackT <= 0) {
          e.attackT = e.attackCd;
          if (e.ch) e.ch.anim.strikeT = CHASER_STRIKE_DUR;
          this.damagePlayer(e.damage);
        }
      }
      // separation (same + neighbor cells)
      const cx = Math.floor(e.pos.x / cell), cz = Math.floor(e.pos.z / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const arr = grid.get(`${gx},${gz}`);
        if (!arr) continue;
        for (const o of arr) {
          if (o === e) continue;
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
          const rr = e.radius + o.radius + 0.25;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = ((rr - d) / d) * 0.5 * 60 * dt * 0.016 * 60 * 0.016;
            void push;
            moveHorizontalSafe(e.pos, (dx / d) * 2.2 * dt, (dz / d) * 2.2 * dt, e.radius, this.world.colliders, this.world.bounds);
          }
        }
      }
      // prevent indefinite unreachable accumulation: if far above/below player height for long, teleport nearer
      resolveCircle(e.pos, e.radius, this.world.colliders);
      e.pos.x = Math.max(-this.world.bounds + e.radius, Math.min(this.world.bounds - e.radius, e.pos.x));
      e.pos.z = Math.max(-this.world.bounds + e.radius, Math.min(this.world.bounds - e.radius, e.pos.z));
      const gy = this.cgh(e.pos.x, e.pos.z, e.pos.y);
      // enemies climb ramps/stairs smoothly, can't fly
      if (e.pos.y < gy - 0.5 || e.pos.y > gy + 2.5) e.pos.y = gy;
      else e.pos.y += (gy - e.pos.y) * Math.min(1, 10 * dt);
      this.syncEnemyMesh(e, dt);
    }
  }

  private moveEnemy(e: Enemy, dx: number, dz: number, distance: number): void {
    const inputLength = Math.hypot(dx, dz);
    if (inputLength < 0.001 || distance <= 0) return;
    let mx = dx / inputLength;
    let mz = dz / inputLength;
    let moveDistance = distance * Math.min(1, inputLength);

    // Route between elevations through one of the two walkway ramps.
    if (Math.abs(this.pos.y - e.pos.y) > 2.5) {
      const leftDist = Math.hypot(e.pos.x + 45, e.pos.z + 30);
      const rightDist = Math.hypot(e.pos.x - 45, e.pos.z + 30);
      const rampX = leftDist < rightDist ? -45 : 45;
      const rampZ = e.pos.y > 4.5 ? -35 : -29;
      const rx = rampX - e.pos.x;
      const rz = rampZ - e.pos.z;
      const rl = Math.hypot(rx, rz) || 1;
      mx = rx / rl; mz = rz / rl;
    }

    // Cheap obstacle steering avoids direct-pressure deadlocks around buildings.
    const probe = new Vector3(e.pos.x, e.pos.y + 1, e.pos.z);
    if (raycastSolid(probe, new Vector3(mx, 0, mz), e.radius + 1.2, this.world.colliders) < e.radius + 1.1) {
      const side = e.id % 2 === 0 ? 1 : -1;
      const ox = mx;
      mx = -mz * side;
      mz = ox * side;
      moveDistance *= 0.9;
    }

    const sx = e.pos.x, sz = e.pos.z;
    moveHorizontalSafe(e.pos, mx * moveDistance, mz * moveDistance, e.radius, this.world.colliders, this.world.bounds);
    const movedX = e.pos.x - sx, movedZ = e.pos.z - sz;
    const moved = Math.hypot(movedX, movedZ);
    if (e.ch) { e.ch.anim.moveX += movedX; e.ch.anim.moveZ += movedZ; }
    if (moved < moveDistance * 0.15) e.stuckT += STEP_SIZE;
    else e.stuckT = Math.max(0, e.stuckT - STEP_SIZE * 2);

    if (e.stuckT > 3.5) {
      const candidates = this.world.spawnPoints.filter((p) => {
        const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
        return d >= 14 && d <= 55 && isGroundSpawnValid(p, e.radius, this.world.colliders);
      });
      const p = candidates[e.id % Math.max(1, candidates.length)];
      if (p) e.pos.copyFrom(p);
      e.stuckT = 0;
    }
  }

  private syncEnemyMesh(e: Enemy, dt: number): void {
    e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
    const toPlayer = new Vector3(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z);
    if (e.ch) {
      const a = e.ch.anim;
      const moved = Math.hypot(a.moveX, a.moveZ);
      const actualSpeed = dt > 0 ? moved / dt : 0;
      const holdFacing = a.strikeT > 0 || a.flinchT > 0 || e.stunT > 0;
      if (!holdFacing && moved > 0.001) e.yaw = Math.atan2(-a.moveX, -a.moveZ);
      else if (toPlayer.lengthSquared() > 0.01) e.yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
      chaserStepAnim(a, dt, actualSpeed);
      const distance = toPlayer.length();
      const strikeActive = a.strikeT > 0;
      const farLod = distance > 28;
      e.ch.joints.hips.setEnabled(!farLod);
      e.ch.joints.lodMesh.setEnabled(farLod);
      applyChaserAngles(e.ch.joints, chaserPoseAngles({
        speedFactor: a.speedSm,
        phase: a.phase,
        time: this.runTime + e.id * 0.17,
        windup: strikeActive ? 0 : chaserWindup(distance, e.attackRange, e.attackT),
        strike: strikeActive ? 1 - a.strikeT / CHASER_STRIKE_DUR : 0,
        flinch: a.flinchT / 0.18,
        stunned: e.stunT > 0,
      }));
    } else if (toPlayer.lengthSquared() > 0.01) {
      e.yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
    }
    e.mesh.rotation.y = e.yaw;
    // Legacy silhouettes keep their old walk bob. Articulated feet remain
    // grounded while locomotion is applied only to the joint hierarchy.
    if (!e.ch) e.mesh.position.y += Math.abs(Math.sin(this.runTime * 8 + e.id)) * 0.06;
  }

  private fireEnemyShot(e: Enemy, tgt: Vector3): void {
    const s = this.eshots.find((shot) => !shot.active) ?? this.eshots.reduce((oldest, shot) => shot.life < oldest.life ? shot : oldest);
    s.active = true; s.life = 4; s.dmg = e.damage;
    s.pos.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
    const d = tgt.subtract(s.pos);
    const l = d.length() || 1;
    const speed = 16;
    s.vel = d.scale(speed / l);
    s.mesh.isVisible = true;
    s.mesh.position.copyFrom(s.pos);
    synth.fire("MG");
  }

  private updateBoss(e: Enemy, dt: number): void {
    const hpRatio = e.hp / e.maxHp;
    e.bossPhase = hpRatio <= 0.33 ? 2 : hpRatio <= 0.66 ? 1 : 0;
    const toPlayer = new Vector3(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z);
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.scale(1 / dist) : new Vector3(0, 0, -1);
    const slowed = e.slowT > 0 ? 1 - e.slowPct * 0.5 : 1; // bosses resist slows
    if (e.telegraphT > 0) {
      e.telegraphT -= dt;
      if (e.telegraphT <= 0) {
        // resolve ability
        if (e.abilityKind === 0) {
          // slam ring
          const d = new Vector3(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z).length();
          if (d < BOSS_DEF.slamRadius && Math.abs(this.pos.y - e.pos.y) < 3) this.damagePlayer(BOSS_DEF.slamDamage * (1 + this.loop * 0.2 + e.bossPhase * 0.12));
          synth.explode(); this.events.shake(0.6);
        } else if (e.abilityKind === 1) {
          // radial volley
          const n = BOSS_DEF.volleyCount + e.bossPhase * 3;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + this.gameplayRandom() * 0.3;
            const s = this.eshots.find((shot) => !shot.active) ?? this.eshots.reduce((oldest, shot) => shot.life < oldest.life ? shot : oldest);
            s.active = true; s.life = 5; s.dmg = e.damage;
            s.pos.set(e.pos.x, e.pos.y + 2, e.pos.z);
            s.vel = new Vector3(Math.cos(a) * 13, 1.5, Math.sin(a) * 13);
            s.mesh.isVisible = true;
          }
          synth.fire("SG");
        } else {
          // summon adds (bounded)
          for (let i = 0; i < BOSS_DEF.summonCount + e.bossPhase && this.enemies.length < 30; i++) {
            const a = this.gameplayRandom() * Math.PI * 2;
            const p = new Vector3(e.pos.x + Math.cos(a) * 5, 0, e.pos.z + Math.sin(a) * 5);
            p.y = this.gh(p.x, p.z);
            this.spawnEnemy(this.gameplayRandom() < 0.5 ? "chaser" : "runner", p, false);
          }
          this.events.toast("Warden calls reinforcements!");
        }
        e.Telegraph?.dispose(false, true); e.Telegraph = null;
        e.abilityT = Math.max(1.8, 4.5 - this.loop * 0.4 - this.runTime / 300 - e.bossPhase * 0.45);
      }
      this.syncEnemyMesh(e, dt);
      return;
    }
    // chase slowly
    this.moveEnemy(e, dir.x, dir.z, e.speed * (1 + e.bossPhase * 0.12) * slowed * dt);
    e.pos.y = this.cgh(e.pos.x, e.pos.z, e.pos.y);
    // melee
    if (dist < e.attackRange && Math.abs(this.pos.y - e.pos.y) < 2.8 && e.attackT <= 0) {
      e.attackT = e.attackCd;
      this.damagePlayer(e.damage);
    }
    e.attackT -= 0; // already ticked
    e.abilityT -= dt;
    if (e.abilityT <= 0) {
      // pick ability by range/phase: cycle 0 slam (close), 1 volley, 2 summon
      e.abilityKind = (e.abilityKind + 1) % 3;
      if (e.abilityKind === 0 && dist > 12) e.abilityKind = 1;
      e.telegraphT = e.abilityKind === 0 ? 1.0 : e.abilityKind === 1 ? 0.8 : 1.2;
      const disc = MeshBuilder.CreateDisc(`btele-${e.id}-${Date.now()}`, {
        radius: e.abilityKind === 0 ? BOSS_DEF.slamRadius : e.abilityKind === 1 ? 3 : 6, tessellation: 40,
      }, this.scene);
      disc.rotation.x = -Math.PI / 2;
      const px = e.abilityKind === 0 ? e.pos.x : e.pos.x;
      const pz = e.abilityKind === 0 ? e.pos.z : e.pos.z;
      disc.position = new Vector3(px, this.gh(px, pz) + 0.15, pz);
      disc.material = stdMat(this.scene, `bteleM-${Date.now()}`, new Color3(1, 0.25, 0.2), new Color3(0.85, 0.12, 0.1));
      e.Telegraph = disc;
      synth.bossWarn();
      this.events.toast(e.abilityKind === 0 ? "⚠ Warden winds up a SLAM" : e.abilityKind === 1 ? "⚠ Warden charges a VOLLEY" : "⚠ Warden signaling reinforcements");
    }
    this.syncEnemyMesh(e, dt);
  }

  // ----- shots / orbs / fields -----
  private updateShots(dt: number): void {
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.life -= dt;
      s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt; s.pos.z += s.vel.z * dt;
      s.vel.y -= 4 * dt;
      const g = this.gh(s.pos.x, s.pos.z);
      let dead = s.life <= 0 || s.pos.y < g;
      // hit player
      const d = new Vector3(s.pos.x - this.pos.x, s.pos.y - (this.pos.y + 1.2), s.pos.z - this.pos.z).length();
      if (d < 0.9) { this.damagePlayer(s.dmg); dead = true; }
      // hit wall
      if (!dead && raycastSolid(s.pos, s.vel.clone().normalize(), 0.6, this.world.colliders) < 0.5) dead = true;
      if (dead) { s.active = false; s.mesh.isVisible = false; continue; }
      s.mesh.position.copyFrom(s.pos);
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; t.mesh.isVisible = false; }
    }
  }

  private updateOrbs(dt: number): void {
    for (const o of this.orbs) {
      if (!o.active) continue;
      o.life -= dt;
      if (o.life <= 0) { o.active = false; o.mesh.isVisible = false; continue; }
      const to = new Vector3(this.pos.x - o.pos.x, (this.pos.y + 1) - o.pos.y, this.pos.z - o.pos.z);
      const d = to.length();
      if (d < 6.5) { // modest attraction radius
        const pull = Math.min(1, (7 - d) / 7 + 0.25) * 14 * dt;
        o.pos.addInPlace(to.normalize().scale(Math.min(d, pull)));
      }
      o.mesh.position.copyFrom(o.pos);
      (o.mesh.rotation as Vector3).y += dt * 3;
      if (d < 1.4) {
        o.active = false; o.mesh.isVisible = false;
        if (o.heal) { this.hp = Math.min(this.maxHp, this.hp + 18); this.events.healFlash(); synth.pickup(); }
        else { this.addXp(o.value); synth.pickup(); }
      }
    }
    // attachment drops pickup by proximity
    for (let i = pendingAttachmentDrops.length - 1; i >= 0; i--) {
      const p = pendingAttachmentDrops[i]!;
      if (new Vector3(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).length() < 2.2) {
        pendingAttachmentDrops.splice(i, 1);
        dropMarkers.get(p.def.id)?.dispose(false, true);
        dropMarkers.delete(p.def.id);
        this.interrupted = true;
        this.events.pickupAttachment(p.def);
        break;
      }
    }
    // drop marker pulse
    for (const [, m] of dropMarkers) m.rotation.y += dt * 2;
  }

  addXp(v: number, notify = true): void {
    this.build.xp += v;
    while (this.build.xp >= this.build.xpNext) {
      this.build.xp -= this.build.xpNext;
      this.build.level++;
      this.build.xpNext = xpForLevel(this.build.level);
      this.build.queuedLevels++;
      // small survival heal on level
      this.hp = Math.min(this.maxHp, this.hp + 10);
    }
    if (notify && this.build.queuedLevels > 0) {
      this.interrupted = true;
      this.events.leveledUp();
    }
  }

  private explodeTrap(f: Field): void {
    f.age = f.duration; // expire after trigger
    f.mesh?.dispose(false, true); f.mesh = null;
    const at = f.pos.clone();
    for (const e of [...this.enemies]) {
      const d = new Vector3(e.pos.x - at.x, 0, e.pos.z - at.z).length();
      if (d < f.radius + e.radius) {
        this.damageEnemy(e, this.totalAtk() * f.power, { isProc: true });
        if (e.kind !== "boss") { e.slowT = 4; e.slowPct = 0.5; }
        else { e.slowT = 2; e.slowPct = 0.25; }
      }
    }
    synth.explode();
  }

  private updateFields(dt: number): void {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i]!;
      f.age += dt;
      if (f.kind === "protect") {
        if (f.mesh) { f.mesh.rotation.z += dt * 0.4; }
      }
      if (f.kind === "finale" && f.age >= f.duration && !f.triggered) {
        f.triggered = true;
        f.mesh?.dispose(false, true); f.mesh = null;
        this.explodeAt(f.pos, f.radius, this.totalAtk() * f.power, true);
      }
      if (f.kind === "bulwarkPulse" && f.mesh) {
        const t = f.age / f.duration;
        f.mesh.scaling.setAll(0.5 + t * 1.4);
      }
      if (f.age >= f.duration) {
        f.mesh?.dispose(false, true); f.mesh2?.dispose(false, true);
        this.fields.splice(i, 1);
        const pi = this.protectFields.indexOf(f);
        if (pi >= 0) this.protectFields.splice(pi, 1);
      }
    }
    // scheduled AoE (bulwark pulses follow player)
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i]!;
      b.t -= dt;
      if (b.t <= 0) {
        this.booms.splice(i, 1);
        const at = b.pos.clone();
        // bulwark pulses centered on player at fire time move with player: use current pos
        const center = new Vector3(this.pos.x, this.pos.y, this.pos.z);
        void at;
        this.explodeAt(center, b.radius, this.totalAtk() * b.power, false);
      }
    }
    // delayed volley shots
    // (handled in updateDelayed)
  }

  private updateDelayed(dt: number): void {
    for (let i = this.volleyQueue.length - 1; i >= 0; i--) {
      const v = this.volleyQueue[i]!;
      v.t -= dt;
      if (v.t > 0) continue;
      this.volleyQueue.splice(i, 1);
      if (v.kind === "volley") {
        const e = this.enemies.find((e) => e.id === v.targetId);
        const targets = e && this.enemies.includes(e) ? [e] : this.visibleEnemies(45).slice(0, 1);
        for (const t of targets) {
          const from = this.muzzlePos();
          const aim = new Vector3(t.pos.x, t.pos.y + 1.1, t.pos.z);
          const dir = aim.subtract(from).normalize();
          const wallD = raycastSolid(from, dir, 50, this.world.colliders);
          const dist = aim.subtract(from).length();
          this.spawnTracer(from, aim);
          if (wallD >= dist - 0.5) {
            const crit = this.gameplayRandom() < this.critCh();
            const dmg = this.totalAtk() * v.power * (crit ? this.critMult() : 1);
            this.damageEnemy(t, dmg, { direct: true, crit, isProc: true });
          }
        }
        synth.fire("AR");
      } else if (v.kind === "sweep") {
        // suppression cone from player facing
        const m = this.muzzlePos();
        const dir = new Vector3(v.dirX ?? -Math.sin(this.yaw), 0, v.dirZ ?? -Math.cos(this.yaw)).normalize();
        for (const h of this.coneEnemies(m, dir, 20, v.cone ?? 28)) {
          const crit = this.gameplayRandom() < this.critCh();
          this.damageEnemy(h, this.totalAtk() * v.power * (crit ? this.critMult() : 1), { direct: true, crit, isProc: true });
        }
        this.spawnTracer(m, m.add(dir.scale(16)));
        synth.fire("MG");
      }
    }
  }

  private updateRelay(dt: number): void {
    if (!this.relayActive || this.relayCharge >= 1) return;
    const d = new Vector3(this.pos.x - this.world.relayPos.x, 0, this.pos.z - this.world.relayPos.z).length();
    if (d < this.world.relayRadius && this.alive) {
      this.relayCharge = Math.min(1, this.relayCharge + dt / 75); // ~75s inside to full
      if (this.relayCharge >= 1) {
        this.events.toast("Relay fully charged!");
        if (objectiveComplete(this.bossDead, this.relayCharge)) {
          this.interrupted = true;
          this.events.victory();
        }
      }
    }
    // leaving pauses (no decay) — per spec
  }

  activateRelay(): void {
    if (this.relayActive) return;
    this.relayActive = true;
    this.spawnBoss();
    this.events.toast("Relay activated — stay in the ring to charge. Boss inbound!");
  }

  private updateCameraVisuals(dt: number): void {
    void dt;
    // beacon pulse
    const t = this.runTime;
    for (const m of this.world.towerMeshes) m.rotation.y += dt * 0.3;
    this.world.relayRing.scaling.setAll(1 + Math.sin(t * 3) * 0.02);
  }

  tryInteract(): void {
    // relay
    const rd = new Vector3(this.pos.x - this.world.relayPos.x, 0, this.pos.z - this.world.relayPos.z).length();
    if (rd < this.world.relayRadius + 2 && !this.relayActive) {
      this.activateRelay();
      return;
    }
    // caches
    for (const c of this.world.caches) {
      if (c.taken) continue;
      const d = new Vector3(this.pos.x - c.pos.x, 0, this.pos.z - c.pos.z).length();
      if (d < 3) {
        c.taken = true;
        c.mesh.isVisible = false;
        if (c.glow) c.glow.isVisible = false;
        this.cachesOpened++;
        // cache attachment: luck scales with caches opened
        const luck = Math.min(2.5, 0.4 + this.cachesOpened * 0.25 + this.loop);
        const rarity = this.rollRarityLocal(luck);
        const slots = slotsFor(this.build.charId);
        const slot = slots[Math.floor(this.gameplayRandom() * slots.length)]!;
        const def = this.rollAttachmentLocal(slot, rarity);
        synth.levelup();
        this.interrupted = true;
        this.events.pickupAttachment(def);
        return;
      }
    }
  }

  nearestInteractable(): string | null {
    const rd = new Vector3(this.pos.x - this.world.relayPos.x, 0, this.pos.z - this.world.relayPos.z).length();
    if (rd < this.world.relayRadius + 2 && !this.relayActive) return "Activate Relay";
    for (const c of this.world.caches) {
      if (c.taken) continue;
      const d = new Vector3(this.pos.x - c.pos.x, 0, this.pos.z - c.pos.z).length();
      if (d < 3.2) return "Open Cache";
    }
    return null;
  }

  protectionReduction(): number {
    let reduction = 0;
    for (const f of this.protectFields) {
      const d = new Vector3(this.pos.x - f.pos.x, 0, this.pos.z - f.pos.z).length();
      if (d < f.radius) reduction = Math.max(reduction, f.power);
    }
    return reduction;
  }

  damagePlayer(amount: number): void {
    if (!this.alive || this.godmode) return;
    if (this.iframes > 0 || this.dodgeT > 0) return;
    let dmg = amount;
    dmg *= 1 - this.protectionReduction();
    if (this.slideT > 0) dmg *= 0.8;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    synth.hurt();
    this.events.shake(Math.min(0.7, 0.25 + dmg / 60));
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.playerBody.rotation.z = 1.2;
      // Mirror the death pose onto the external visual (procedural only).
      if (this.externalRoot) this.externalRoot.rotation.z = 1.2;
      this.interrupted = true;
      this.events.playerDied();
    }
  }

  // camera update (render thread, uses render dt)
  updateCamera(rdt: number, shakeEnabled: boolean): void {
    const dist = this.aiming ? 3.2 : 5.6;
    const pivot = new Vector3(this.pos.x, this.pos.y + 1.9, this.pos.z);
    const dir = new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // camera behind player
    const back = dir.scale(-dist);
    // shoulder offset
    const right = new Vector3(-dir.z, 0, dir.x).normalize().scale(0.9);
    let desired = pivot.add(back).add(right);
    desired.y += 0.4;
    // camera collision: ray from pivot toward desired
    const cd = desired.subtract(pivot);
    const len = cd.length();
    if (len > 0.001) {
      const n = cd.scale(1 / len);
      const hit = raycastSolid(pivot, n, len, this.world.colliders);
      if (hit < len) desired = pivot.add(n.scale(Math.max(0.6, hit - 0.35)));
    }
    const k = 1 - Math.pow(0.0001, rdt);
    Vector3.LerpToRef(this.camPos, desired, Math.min(1, k), this.camPos);
    Vector3.LerpToRef(this.camTarget, pivot.add(dir.scale(8)), Math.min(1, k), this.camTarget);
    if (shakeEnabled && this.shakeAmt > 0.003) {
      this.camPos.x += (this.cosmeticRandom() - 0.5) * this.shakeAmt;
      this.camPos.y += (this.cosmeticRandom() - 0.5) * this.shakeAmt;
    }
    this.shakeAmt *= Math.pow(0.02, rdt);
  }

  addShake(a: number): void { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }
}

export function slotsFor(charId: CharId): SlotKind[] {
  return SLOTS_FOR_TYPE[getCharacter(charId).weapon.type];
}

// Pending world-space attachment drops (rendered as markers by game layer)
export interface AttachmentDrop { pos: Vector3; def: AttachmentDef; }
export const pendingAttachmentDrops: AttachmentDrop[] = [];
export const dropMarkers = new Map<string, Mesh>();

export { emptyStats };
