// Game orchestration: engine, states, fixed-step loop, UI flows, persistence.
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Engine } from "@babylonjs/core/Engines/engine";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CHARACTERS, CharId, AttachmentDef, computeAttack, rollAttachment, SLOTS_FOR_TYPE, SlotKind } from "./config";
import { Input } from "./input";
import { buildWorld, WorldRefs } from "./world";
import { Simulation, pendingAttachmentDrops, dropMarkers } from "./sim";
import { GameUI, HudState } from "./ui";
import { eligibleChoices, rollChoices, applyChoice, UpgradeChoice } from "./progression";
import { synth, loadSettings, saveSettings, Settings } from "./audio";
import { tryLoadCharacterAsset } from "./assets";
import { TRAM_SPAWN_POS, TRAM_SPAWN_YAW, buildTramReviewWorld, disposeTramReview, isTramReviewRequested, loadTramReviewStation, tramGroundHeightAt, tramProbeGrid, tramReviewView, tramTrimOutside, type TramReviewLoad } from "./tram-review";
import { getTololoRest, measureTololoHold, mountRifleToHand, parkTololoSpare, resetTololoLocomotion, restoreRifleHip, takeSpareTololo, tickTololoVisual, tololoLocomotionMode, tryLoadTololoPmx } from "./tololo-visual";
import { isAttachmentCompatible, nextLoopTransition } from "./rules";

type State = "title" | "select" | "playing" | "paused" | "levelup" | "equip" | "compare" | "victory" | "defeat";

const STEP = 1 / 60;

export class Game {
  canvas: HTMLCanvasElement;
  ui: GameUI;
  input = new Input();
  engine!: Engine;
  scene!: Scene;
  camera!: FreeCamera;
  world!: WorldRefs;
  sim!: Simulation;
  settings: Settings = loadSettings();
  state: State = "title";
  renderer = "unknown";
  acc = 0; last = 0;
  fps = 60;
  // Tololo art-slice state (unapproved, local review only).
  private visualChar: string | null = null;
  private visualToken = 0;
  // Tram-station suitability review (dev-only, local evaluation, never shipped).
  readonly tramRequested: boolean = isTramReviewRequested(new URLSearchParams(location.search));
  tramLoad: TramReviewLoad | null = null;
  tramStatus: { phase: string; loaded: number; total: number | null; error: string | null } = {
    phase: "idle", loaded: 0, total: null, error: null,
  };
  // Dev-only camera override for art review (?dev=1 console use). Null = gameplay camera.
  debugCamera: { pos: Vector3; target: Vector3 } | null = null;
  dev = new URLSearchParams(location.search);
  devMode = false;
  private levelChoices: UpgradeChoice[] = [];
  private pendingAttach: AttachmentDef | null = null;
  private attachmentQueue: AttachmentDef[] = [];
  private equipReturn: State = "playing";
  private bootError: ((msg: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.canvas = canvas;
    synth.settings = this.settings;
    this.ui = new GameUI(root, {
      onPlay: () => this.toSelect(),
      onStart: (id) => this.startRun(id as CharId),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onTitle: () => this.toTitle(),
      onPause: () => this.pause(),
      onLevelPick: (c) => this.pickLevel(c),
      onAttachDecision: () => { /* unused (dedicated modals) */ },
      onFinishRun: () => this.toTitle(),
      onContinueLoop: () => this.continueLoop(),
      onInteract: () => { /* handled in sim */ },
    });
    this.devMode = this.dev.get("dev") === "1";
  }

  async init(onBootError: (msg: string) => void): Promise<void> {
    this.bootError = onBootError;
    // Engine: WebGPU when supported & init succeeds, else WebGL2.
    const canvas = this.canvas;
    try {
      const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
      if (gpu && this.dev.get("renderer") !== "webgl") {
        const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
        const webgpu = new WebGPUEngine(canvas, { antialias: true });
        await webgpu.initAsync();
        this.engine = webgpu as unknown as Engine;
        this.renderer = "WebGPU";
      } else throw new Error("no-navigator-gpu");
    } catch (err) {
      console.warn("[engine] WebGPU unavailable, falling back to WebGL2:", err);
      try {
        this.engine = new Engine(canvas, true, { antialias: true });
        if (this.engine.webGLVersion < 2) throw new Error("WebGL2 is required by this prototype");
        this.renderer = "WebGL2";
      } catch (err2) {
        onBootError(`Renderer init failed: ${String(err2)}. Try a recent desktop Chrome/Edge.`);
        throw err2;
      }
    }
    this.scene = new Scene(this.engine);
    // Filmic highlight compression for the daylight rig (cf. summer-game).
    // Dev A/B hook (?notonemap=1): perf comparisons, never shipped on.
    this.scene.imageProcessingConfiguration.toneMappingEnabled = this.dev.get("notonemap") !== "1";
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);
    this.camera = new FreeCamera("cam", new Vector3(0, 4, 18), this.scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 300;
    this.scene.activeCamera = this.camera;
    // The simulation owns mouse/keyboard input and writes the camera transform.
    // Attaching Babylon's FreeCamera controls here registers a second, conflicting
    // controller and makes real pointer-lock movement appear inverted or doubled.

    // Green Zone daylight rig: cool sky/ground fill + warm low sun.
    // Shadow maps + sky dome are set up by buildGreenZone (fixed courtyard
    // frustum); values here stay the single source of truth for the sun.
    const hemi = new HemisphericLight("hemi", new Vector3(0.3, 1, 0.2), this.scene);
    hemi.diffuse = new Color3(0.78, 0.87, 1.0);
    hemi.groundColor = new Color3(0.45, 0.42, 0.34);
    hemi.intensity = 1.15;
    const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, 0.35), this.scene);
    dir.diffuse = new Color3(1.0, 0.94, 0.82);
    dir.intensity = 2.2;
    dir.position = new Vector3(28, 42, -14);
    dir.shadowFrustumSize = 90;
    dir.shadowMinZ = 1;
    dir.shadowMaxZ = 140;

    // Isolated review route: the Green Zone and the station are never loaded
    // together. Normal gameplay (including all tests) always builds the
    // Green Zone; the station world exists only with ?dev=1&scene=tram-review.
    this.world = this.tramRequested ? buildTramReviewWorld(this.scene) : buildWorld(this.scene);
    this.sim = new Simulation(this.scene, this.world, {
      damageNumber: (d) => {
        const p = this.worldToScreen(d.pos);
        if (p) this.ui.damageNumber(d.text, d.crit, p.x, p.y);
      },
      toast: (m) => this.ui.toast(m),
      killfeed: (m) => this.ui.killfeed(m),
      hitmarker: (k) => this.ui.hitmarker(k),
      shake: (a) => { if (this.settings.shake) this.sim.addShake(a); },
      pickupAttachment: (def) => this.onAttachmentFound(def),
      playerDied: () => this.onDeath(),
      leveledUp: () => this.openLevelUp(),
      bossSpawned: () => undefined,
      victory: () => this.onVictory(),
      healFlash: () => this.ui.flashHeal(),
    }, this.input);
    // Hold-debug markers (grip anchors, contacts, stock, muzzle) for captures
    // with ?mark=1. Hidden by default so review captures stay clean.
    if (this.dev.get("mark") === "1") this.sim.setGripMarkersVisible(true);
    if (this.devMode) {
      // Text-only hold inspection for the check harness (no screenshots).
      (window as unknown as { __tololoHold: unknown }).__tololoHold = {
        measure: () => this.sim.externalRoot && this.sim.externalStatus === "pmx"
          ? measureTololoHold(this.sim.externalRoot, this.sim, this.sim.pos, this.sim.yaw, this.sim.pitch)
          : null,
        rest: () => (this.sim.externalRoot ? getTololoRest(this.sim.externalRoot) : null),
        locomotionEnabled: (enabled: boolean) => { tololoLocomotionMode.enabled = enabled; },
      };
      // Tram-station review controls for the browser harness (dev only).
      (window as unknown as { __tramReview: unknown }).__tramReview = {
        status: () => ({ ...this.tramStatus, requested: this.tramRequested, loaded: !!this.tramLoad }),
        stats: () => this.tramLoad?.stats ?? null,
        timings: () => this.tramLoad?.timings ?? null,
        view: (name: string) => {
          const v = tramReviewView(name);
          this.debugCamera = { pos: v.pos, target: v.target };
        },
        play: () => { this.debugCamera = null; },
        exit: () => this.exitTramReview(),
        probeGrid: (x0: number, x1: number, xs: number, z0: number, z1: number, zs: number, originY = 120) =>
          tramProbeGrid(this.scene, x0, x1, xs, z0, z1, zs, originY),
        trimOutside: (x0: number, x1: number, z0: number, z1: number) =>
          this.tramLoad ? tramTrimOutside(this.tramLoad, x0, x1, z0, z1) : null,
        groundAt: (x: number, z: number) => tramGroundHeightAt(x, z),
      };
    }
    this.applyControlSettings();

    this.input.attach(canvas, () => {
      // pointer lock change: leaving lock while playing => pause
      if (!this.input.locked && this.state === "playing") this.pause();
    }, () => {
      if (this.state === "playing") {
        this.pause();
        this.ui.toast("Pointer lock was unavailable. Resume and click the canvas to retry.");
      }
    });
    canvas.addEventListener("click", () => {
      if (this.state === "playing" && !this.input.locked) this.requestGameplayLock();
    });
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Tab") {
        if (this.state === "playing" || this.state === "equip") { e.preventDefault(); this.toggleEquip(); }
      }
      if (e.code === "Escape" || e.code === "KeyP") {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
        else if (this.state === "equip") this.toggleEquip();
      }
      // dev shortcuts (clearly separated, only with ?dev=1)
      if (this.devMode && this.state === "playing") {
        if (e.code === "KeyK") { for (const en of [...this.sim.enemies]) this.sim.damageEnemy(en, 1e6, { isProc: true }); }
        if (e.code === "KeyL") this.sim.addXp(60);
        if (e.code === "KeyB") this.sim.spawnBoss();
        if (e.code === "KeyC") { this.sim.relayActive = true; this.sim.relayCharge = Math.min(1, this.sim.relayCharge + 0.25); this.sim.spawnBoss(); }
      }
    });
    window.addEventListener("blur", () => { if (this.state === "playing") this.pause(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "playing") this.pause(); });
    window.addEventListener("resize", () => this.engine.resize());

    // initial camera placement
    this.sim.startRun("tololo");
    this.sim.updateCamera(0.016, false);
    this.syncCamera(0.016);

    this.toTitle();
    this.last = performance.now();
    this.engine.runRenderLoop(() => this.frame());
  }

  // ---------- states ----------
  toTitle(): void {
    if (this.tramLoad) this.exitTramReview();
    this.state = "title";
    this.releaseGameplayInput();
    this.attachmentQueue = [];
    this.pendingAttach = null;
    this.ui.clearOverlays();
    this.ui.resetTransient();
    this.ui.showTitle(this.settings,
      () => this.ui.showControls(() => this.toTitle()),
      () => this.ui.showSettings(this.settings, (s) => { this.settings = s; synth.settings = s; this.applyControlSettings(); saveSettings(s); }, () => this.toTitle()));
  }

  private applyControlSettings(): void {
    this.sim.sensitivity = this.settings.sensitivity;
    this.sim.reverseForward = this.settings.reverseForward;
    this.sim.reverseStrafe = this.settings.reverseStrafe;
    this.sim.invertLookX = this.settings.invertLookX;
    this.sim.invertLookY = this.settings.invertLookY;
  }

  toSelect(): void {
    this.state = "select";
    this.ui.clearOverlays();
    synth.ui();
    this.ui.showSelect(CHARACTERS.map((c) => ({
      id: c.id, name: c.name, title: c.title, color: c.color,
      weapon: c.weapon.name, wtype: c.weapon.type, identity: c.identity,
      skills: [`Q ${c.skills[0]!.name}`, `E ${c.skills[1]!.name}`, `R ${c.skills[2]!.name}`],
    })));
  }

  startRun(charId: CharId): void {
    this.ui.clearOverlays();
    this.ui.closeModal();
    this.ui.resetTransient();
    this.sim.startRun(charId);
    if (this.sim.externalRoot) resetTololoLocomotion(this.sim.externalRoot);
    this.attachmentQueue = [];
    this.pendingAttach = null;
    this.state = "playing";
    this.acc = 0;
    this.ui.showHud(true);
    this.ui.toast(`${this.sim.def.name} deployed — find the relay tower, then hold the ring.`, 3600);
    void tryLoadCharacterAsset(this.scene, charId).then((r) => {
      if (r === "placeholder") console.info("[assets] using stylized placeholder for", charId);
    });
    // Tololo art slice: swap the placeholder body for the staged PMX visual.
    // Failure keeps the placeholder; combat math and controls are untouched.
    if (this.visualChar !== charId) {
      this.visualToken++;
      this.visualChar = charId;
      const detached = this.sim.setExternalVisual(null);
      if (detached) parkTololoSpare(detached);
      restoreRifleHip(this.sim);
      this.debugCamera = null;
    }
    if (charId === "tololo" && this.sim.externalStatus !== "pmx") {
      const spare = takeSpareTololo();
      if (spare) {
        resetTololoLocomotion(spare);
        this.sim.setExternalVisual(spare, "pmx");
        mountRifleToHand(this.sim);
      } else {
        const token = ++this.visualToken;
        void tryLoadTololoPmx(this.scene).then((res) => {
          if (res.status !== "pmx") return;
          if (token !== this.visualToken || this.visualChar !== "tololo") {
            // Stale winner of a rapid restart chain: park, never dispose
            // mid-load (see tololo-visual.ts).
            parkTololoSpare(res.root);
            return;
          }
          this.sim.setExternalVisual(res.root, "pmx");
          mountRifleToHand(this.sim);
          console.info(`[tololo] PMX visual attached in ${res.loadMs.toFixed(0)}ms`);
        });
      }
    }
    this.requestGameplayLock();
    this.last = performance.now();
  }

  restart(): void {
    const id = this.sim.build?.charId ?? "tololo";
    this.startRun(id);
    this.placeTramSpawn();
  }

  /**
   * Tram circuit spawn placement: startRun resets to the Green Zone pad, so
   * restart/loop/enter paths re-place inside the circuit when the review
   * world is active. Green Zone behavior untouched (no-op there).
   */
  private placeTramSpawn(): void {
    if (!this.tramRequested || !this.tramLoad) return;
    const spawn = this.sim.world.playerSpawn;
    if (!spawn) return;
    this.sim.pos.copyFrom(spawn.pos);
    this.sim.pos.y = spawn.pos.y;
    this.sim.vel.set(0, 0, 0);
    this.sim.visualVel.set(0, 0, 0);
    this.sim.yaw = spawn.yaw;
    this.sim.pitch = -0.08;
    this.sim.playerMesh.position.copyFrom(this.sim.pos);
    this.sim.updateCamera(1, false);
  }

  /**
   * Tram-station review entry (dev-only, explicit ?dev=1&scene=tram-review).
   * Loads the unmodified station GLB over the review-only flat world, places
   * Tololo on the marked test lane, and frames the overview camera. The Green
   * Zone was never built in this mode, so both environments cannot coexist.
   * Tololo locomotion, rifle hold, firing origin, and camera controls are
   * reused untouched. Failure leaves the flat lane playable and reports a
   * useful message; normal Green Zone play is unaffected (reload without the
   * scene parameter).
   */
  async enterTramReview(): Promise<boolean> {
    if (!this.tramRequested || this.tramLoad) return !!this.tramLoad;
    this.tramStatus = { phase: "loading", loaded: 0, total: null, error: null };
    this.ui.toast("Tram review: loading station…", 3600);
    try {
      this.tramLoad = await loadTramReviewStation(this.scene, (loaded, total) => {
        this.tramStatus = { phase: "loading", loaded, total, error: null };
      });
      this.sim.pos.copyFrom(TRAM_SPAWN_POS);
      this.sim.vel.set(0, 0, 0);
      this.sim.visualVel.set(0, 0, 0);
      this.sim.yaw = TRAM_SPAWN_YAW;
      this.sim.pitch = -0.08;
      this.sim.playerMesh.position.copyFrom(this.sim.pos);
      this.sim.updateCamera(1, false);
      const v = tramReviewView("overview");
      this.debugCamera = { pos: v.pos, target: v.target };
      this.tramStatus = {
        phase: "ready", loaded: this.tramLoad.timings.loadedBytes,
        total: this.tramLoad.timings.totalBytes, error: null,
      };
      this.ui.toast("Tram review ready — connected circuit playable (apron, kiosk passage, platform).", 3600);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.tramStatus = { phase: "failed", loaded: 0, total: null, error: msg };
      this.ui.toast(`Tram review failed: ${msg} — flat ground still playable.`, 6000);
      console.warn("[tram-review] load failed:", err);
      return false;
    }
  }

  /** Dispose the review station and its review-only props (Green Zone was never built). */
  exitTramReview(): void {
    if (!this.tramLoad) return;
    disposeTramReview(this.scene, this.tramLoad);
    this.tramLoad = null;
    this.debugCamera = null;
    this.tramStatus = { phase: "idle", loaded: 0, total: null, error: null };
    this.ui.toast("Tram review unloaded.", 2600);
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.releaseGameplayInput();
    this.ui.showPause(() => this.resume(), () => this.restart(), () => this.toTitle());
  }

  resume(): void {
    if (this.state !== "paused" && this.state !== "equip") return;
    this.ui.closeModal();
    this.state = "playing";
    this.acc = 0;
    this.last = performance.now();
    this.requestGameplayLock();
  }

  toggleEquip(): void {
    if (this.state === "playing") {
      this.equipReturn = "playing";
      this.state = "equip";
      this.releaseGameplayInput();
      this.ui.showEquipment(this.equipSlots(), this.equipStats(), () => this.toggleEquip());
    } else if (this.state === "equip") {
      this.ui.closeModal();
      this.state = this.equipReturn;
      this.acc = 0;
      this.requestGameplayLock();
    }
  }

  onDeath(): void {
    if (this.state === "victory" || this.state === "defeat") return;
    this.state = "defeat";
    this.releaseGameplayInput();
    this.ui.closeModal();
    this.attachmentQueue = [];
    this.pendingAttach = null;
    this.ui.resetTransient();
    this.ui.flashDamage();
    const b = this.sim.build;
    const lines = `${this.sim.def.name} • Lv ${b.level} • ${Math.floor(this.sim.runTime / 60)}:${String(Math.floor(this.sim.runTime % 60)).padStart(2, "0")} • ${this.sim.kills} kills • relay ${Math.round(this.sim.relayCharge * 100)}% • loop ${this.sim.loop}`;
    this.recordBest(false);
    this.ui.showDefeat(lines);
  }

  onVictory(): void {
    if (this.state === "victory" || this.state === "defeat") return;
    this.state = "victory";
    this.releaseGameplayInput();
    this.ui.closeModal();
    this.attachmentQueue = [];
    this.pendingAttach = null;
    this.ui.resetTransient();
    this.recordBest(true);
    const b = this.sim.build;
    const lines = `${this.sim.def.name} • Lv ${b.level} • time ${Math.floor(this.sim.runTime / 60)}:${String(Math.floor(this.sim.runTime % 60)).padStart(2, "0")} • ${this.sim.kills} kills • loop ${this.sim.loop}. Continuing grants a high-rarity attachment and harder pressure.`;
    this.ui.showVictory(lines, true);
    synth.levelup();
  }

  continueLoop(): void {
    // Retain build, raise difficulty, reset encounter, replenish rewards, no stale entities.
    const keep = this.sim.build;
    const bonusMax = this.sim.maxHp - this.sim.def.hp;
    const loop = nextLoopTransition(this.sim.loop).loop;
    this.sim.startRun(keep.charId, loop, keep);
    this.placeTramSpawn();
    this.sim.maxHp = this.sim.def.hp + Math.max(0, bonusMax);
    this.sim.hp = this.sim.maxHp;
    this.sim.relayActive = false;
    this.ui.clearOverlays();
    this.ui.showHud(true);
    this.state = "playing";
    this.acc = 0;
    this.ui.toast(`Loop ${loop} — pressure rising. Relay reset; caches restocked.`, 3600);
    // Grant after entering the new run so occupied slots can open comparison.
    this.grantLoopReward();
    this.processModalQueue();
    if (this.state === "playing") this.requestGameplayLock();
  }

  private grantLoopReward(): void {
    // Epic or Legendary for a random compatible slot
    const slots = slotsForChar(this.sim.build.charId);
    const slot = slots[Math.floor(this.sim.gameplayRandom() * slots.length)]!;
    const rarity = this.sim.gameplayRandom() < 0.45 ? "Legendary" : "Epic";
    const def = rollAttachment(slot, rarity, this.sim.gameplayRandom, this.sim.def.baseAtk);
    this.onAttachmentFound(def);
  }

  private recordBest(won: boolean): void {
    const s = this.settings;
    s.bestTime = Math.max(s.bestTime, Math.floor(this.sim.runTime));
    s.bestLevel = Math.max(s.bestLevel, this.sim.build.level);
    s.bestLoop = Math.max(s.bestLoop, this.sim.loop);
    if (won) s.wins++;
    this.settings = s;
    saveSettings(s);
  }

  // ---------- level ups ----------
  openLevelUp(): void {
    if (this.state !== "playing") return; // queue: will reopen after current modal
    const build = this.sim.build;
    if (build.queuedLevels <= 0) return;
    this.state = "levelup";
    this.releaseGameplayInput();
    this.levelChoices = rollChoices(build, this.sim.def, this.sim.gameplayRandom);
    synth.levelup();
    this.ui.showLevelUp(this.levelChoices, build.level);
  }

  pickLevel(c: UpgradeChoice): void {
    const build = this.sim.build;
    if (this.state !== "levelup" || build.queuedLevels <= 0) return;
    const offered = this.levelChoices.some((offeredChoice) => offeredChoice.kind === c.kind && offeredChoice.toRank === c.toRank);
    if (!offered) return;
    const r = applyChoice(build, c);
    if (!r.applied) return;
    if (c.kind === "survival") {
      this.sim.maxHp += r.maxHpBonus;
      this.sim.hp = Math.min(this.sim.maxHp, this.sim.hp + r.heal);
    }
    build.queuedLevels--;
    synth.ui();
    this.ui.toast(`Upgrade applied: ${c.title}`);
    // ammo refresh on weapon upgrade for feel
    if (c.kind === "weapon") { this.sim.ammo = this.sim.magSize(); this.sim.reloading = 0; }
    if (build.queuedLevels > 0) {
      // chain queued levels
      this.levelChoices = rollChoices(build, this.sim.def, this.sim.gameplayRandom);
      this.ui.showLevelUp(this.levelChoices, build.level);
    } else {
      this.finishModalFlow();
    }
  }

  // ---------- attachments ----------
  onAttachmentFound(def: AttachmentDef): void {
    if (this.state === "victory" || this.state === "defeat") return;
    if (!isAttachmentCompatible(this.sim.def.weapon.type, def)) {
      console.warn(`[attachments] rejected incompatible ${def.slot} for ${this.sim.def.weapon.type}`);
      return;
    }
    if (this.state !== "playing") {
      this.attachmentQueue.push(def);
      return;
    }
    const cur = this.sim.build.attachments[def.slot] ?? null;
    if (!cur) {
      // empty slot: equip directly per spec
      this.sim.build.attachments[def.slot] = def;
      synth.pickup();
      this.ui.toast(`Equipped [${def.rarity}] ${def.name} → ${def.slot}`);
      this.processModalQueue();
      return;
    }
    // occupied: paused comparison
    this.pendingAttach = def;
    this.equipReturn = this.state === "playing" ? "playing" : this.state;
    this.state = "compare";
    this.releaseGameplayInput();
    const delta = this.compareStats(cur, def);
    this.ui.showAttachmentCompare(cur, def,
      delta,
      () => { // accept: discard old, no duplication
        if (this.state !== "compare" || this.pendingAttach?.id !== def.id) return;
        if (this.pendingAttach) this.sim.build.attachments[def.slot] = this.pendingAttach;
        this.pendingAttach = null;
        synth.pickup();
        this.finishModalFlow();
      },
      () => { // decline: new one discarded
        if (this.state !== "compare" || this.pendingAttach?.id !== def.id) return;
        this.pendingAttach = null;
        synth.ui();
        this.finishModalFlow();
      });
  }

  private finishModalFlow(): void {
    this.ui.closeModal();
    this.state = "playing";
    this.acc = 0;
    this.processModalQueue();
    if (this.state === "playing") this.requestGameplayLock();
  }

  private requestGameplayLock(): void {
    this.input.enabled = true;
    if (this.devMode && this.dev.get("nolock") === "1") return;
    this.input.requestLock();
  }

  private releaseGameplayInput(): void {
    // Disable immediately while pointer-lock release is still asynchronous.
    this.input.enabled = false;
    this.input.releaseAll();
    this.sim.aiming = false;
    this.sim.clearTransientPresentation();
    this.input.exitLock();
  }

  private processModalQueue(): void {
    if (this.state !== "playing") return;
    if (this.sim.build.queuedLevels > 0) {
      this.openLevelUp();
      return;
    }
    const next = this.attachmentQueue.shift();
    if (next) this.onAttachmentFound(next);
  }

  tryEquipDrop(def: AttachmentDef): void {
    // From cache modal "Take": same rules as world drops.
    this.ui.closeModal();
    if (this.state !== "playing") { this.state = "playing"; }
    this.onAttachmentFound(def);
  }

  private compareStats(oldA: AttachmentDef, next: AttachmentDef): string {
    const curMods = Object.values(this.sim.build.attachments).filter((a): a is AttachmentDef => !!a);
    const afterMods = curMods.filter((a) => a.slot !== next.slot).concat([next]);
    const b = computeAttack(this.sim.def.baseAtk, curMods);
    const a = computeAttack(this.sim.def.baseAtk, afterMods);
    const row = (label: string, bv: string, av: string, good: boolean): string =>
      `<tr><td>${label}</td><td>${bv}</td><td class="${good ? "pos" : "neg"}">${av}</td></tr>`;
    const atkGood = a.totalAtk >= b.totalAtk;
    const ccGood = (this.sim.def.baseCritCh + afterMods.reduce((x, m) => x + m.critRate, 0)) >= (this.sim.def.baseCritCh + curMods.reduce((x, m) => x + m.critRate, 0));
    return (
      row("Total ATK", b.totalAtk.toFixed(1), a.totalAtk.toFixed(1), atkGood) +
      row("Crit chance", `${Math.round(Math.min(1, this.sim.def.baseCritCh + curMods.reduce((x, m) => x + m.critRate, 0)) * 100)}%`, `${Math.round(Math.min(1, this.sim.def.baseCritCh + afterMods.reduce((x, m) => x + m.critRate, 0)) * 100)}%`, ccGood) +
      row("Crit damage", `${Math.round((1.5 + curMods.reduce((x, m) => x + m.critDmg, 0)) * 100)}%`, `${Math.round((1.5 + afterMods.reduce((x, m) => x + m.critDmg, 0)) * 100)}%`, a.critMult >= b.critMult)
    );
  }

  private equipSlots(): { slot: string; def: AttachmentDef | null }[] {
    return Object.entries(this.sim.build.attachments).map(([slot, def]) => ({ slot, def: def ?? null }));
  }

  private equipStats(): string {
    const mods = Object.values(this.sim.build.attachments).filter((a): a is AttachmentDef => !!a);
    const c = computeAttack(this.sim.def.baseAtk, mods, this.sim.def.baseCritCh);
    const cc = c.critCh;
    const row = (l: string, v: string): string => `<tr><td>${l}</td><td>${v}</td></tr>`;
    return row("Character", `${this.sim.def.name} • ${this.sim.def.weapon.name} R${this.sim.build.weaponRank} • Q${this.sim.build.s1}/E${this.sim.build.s2}/R${this.sim.build.s3}`) +
      row("Base ATK", `${this.sim.def.baseAtk} (+${c.flat} flat, +${Math.round(c.pct * 100)}%)`) +
      row("Total ATK", `<b>${c.totalAtk.toFixed(1)}</b> = (base + flat) × (1 + ATK%)`) +
      row("Crit chance", `${Math.round(cc * 100)}% (capped 0–100%)`) +
      row("Crit damage", `${Math.round(c.critMult * 100)}%`) +
      row("Shot damage", `${this.sim.shotDamage().toFixed(1)} (shotguns split across pellets)`);
  }

  // ---------- per-frame ----------
  private frame(): void {
    const now = performance.now();
    let rdt = (now - this.last) / 1000;
    this.last = now;
    if (rdt > 0.25) rdt = 0.25;
    this.fps += ((1 / Math.max(1e-3, rdt)) - this.fps) * 0.05;

    const playing = this.state === "playing";
    if (playing) {
      this.acc += rdt;
      let steps = 0;
      while (this.acc >= STEP && steps < 3) {
        this.sim.update(STEP);
        this.input.endStep();
        this.acc -= STEP;
        steps++;
        if (this.state !== "playing") break;
      }
      if (steps === 3) this.acc = 0;
      if (this.state === "playing" && this.sim.build.queuedLevels > 0) this.openLevelUp();
    }

    // Tololo procedural visual: pose + skin upload + rifle seating.
    // Render-dt driven (not fixed-step); frozen while paused; combat untouched.
    if (playing && this.sim.externalStatus === "pmx" && this.sim.externalRoot) {
      const spd = Math.hypot(this.sim.visualVel.x, this.sim.visualVel.z);
      tickTololoVisual(this.sim.externalRoot, this.sim, rdt, {
        speed: spd,
        velocityX: this.sim.visualVel.x,
        velocityZ: this.sim.visualVel.z,
        yaw: this.sim.yaw,
        grounded: this.sim.grounded(),
        aiming: this.sim.aiming,
        pitch: this.sim.pitch,
        recoil: this.sim.gunRecoil,
        reloading: this.sim.reloading > 0,
        dodgeT: this.sim.dodgeT,
        alive: this.sim.alive,
        time: this.sim.runTime,
      });
    }

    // markers for world attachment drops
    this.syncDropMarkers();

    // camera + crosshair
    if (this.state !== "title" && this.state !== "select") {
      this.sim.updateCamera(rdt, this.settings.shake);
      this.syncCamera(rdt);
      this.ui.updateHud(this.hudSnapshot());
    } else {
      // slow orbit behind title for composition
      const t = now / 1000;
      this.camera.position.set(Math.sin(t * 0.1) * 26, 12, 20 + Math.cos(t * 0.1) * 8);
      this.camera.setTarget(new Vector3(0, 4, -8));
    }
    this.ui.tickDamageNumbers(rdt);
    if (this.settings.debug && (this.state === "playing" || this.state === "paused")) {
      this.ui.setDebug(true,
        `${this.renderer} • ${this.fps.toFixed(0)} fps • enemies ${this.sim.enemies.length} • shots ${this.sim.eshots.filter((s) => s.active).length} • orbs ${this.sim.orbs.filter((o) => o.active).length}\n` +
        `pos ${this.sim.pos.x.toFixed(1)},${this.sim.pos.y.toFixed(1)},${this.sim.pos.z.toFixed(1)} • charge ${(this.sim.relayCharge * 100).toFixed(0)}% • diff ${this.sim.difficulty.toFixed(2)}` +
        (this.devMode ? `\nDEV: K kill-all L level B boss C charge` : ""));
    } else this.ui.setDebug(false, "");

    this.scene.render();
  }

  private syncDropMarkers(): void {
    for (const d of pendingAttachmentDrops) {
      if (!dropMarkers.has(d.def.id)) {
        const m = MeshBuilder.CreatePolyhedron(`drop-${d.def.id}`, { type: 1, size: 0.8 }, this.scene);
        const color = d.def.rarity === "Legendary" ? new Color3(1, 0.7, 0.2) : d.def.rarity === "Epic" ? new Color3(0.75, 0.5, 1) : d.def.rarity === "Rare" ? new Color3(0.4, 0.7, 1) : new Color3(0.7, 0.75, 0.8);
        const mt = new StandardMaterial(`dropM-${d.def.id}`, this.scene);
        mt.diffuseColor = color; mt.emissiveColor = color.scale(0.7);
        m.material = mt;
        m.position = new Vector3(d.pos.x, d.pos.y + 1.2, d.pos.z);
        dropMarkers.set(d.def.id, m);
      }
    }
    // click-F near drop handled by proximity pickup in sim; F also tries caches/relay:
    void 0;
  }

  private syncCamera(rdt: number): void {
    void rdt;
    if (this.debugCamera) {
      this.camera.position.copyFrom(this.debugCamera.pos);
      this.camera.setTarget(this.debugCamera.target);
      return;
    }
    this.camera.position.copyFrom(this.sim.camPos);
    this.camera.setTarget(this.sim.camTarget);
    const aiming = this.sim.aiming;
    const scoped = aiming && this.sim.build.charId === "mosin";
    const wantFov = scoped ? 0.45 : aiming ? 0.75 : 1.0;
    this.camera.fov += (wantFov - this.camera.fov) * 0.18;
  }

  private hudSnapshot(): HudState {
    const s = this.sim;
    const b = s.build;
    const boss = s.bossRef;
    return {
      hp: s.hp, maxHp: s.maxHp, shield: s.shield, maxShield: Math.max(s.maxShield, s.shield),
      xp: b.xp, xpNext: b.xpNext, level: b.level,
      time: s.runTime, difficulty: s.difficulty, loop: s.loop, kills: s.kills,
      ammo: s.ammo, mag: s.magSize(), reloading: s.reloading > 0,
      skills: [
        { key: "Q", name: s.def.skills[0]!.name, cd: s.skillCD[0]!, cdMax: s.def.skills[0]!.cooldown, rank: b.s1 },
        { key: "E", name: s.def.skills[1]!.name, cd: s.skillCD[1]!, cdMax: s.def.skills[1]!.cooldown, rank: b.s2 },
        { key: "R", name: s.def.skills[2]!.name, cd: s.skillCD[2]!, cdMax: s.def.skills[2]!.cooldown, rank: b.s3 },
      ],
      dodgeCD: s.dodgeCD,
      objective: s.relayActive ? "Charge inside the ring + kill the Warden" : "Explore, level up, then press F at the relay tower",
      relayCharge: s.relayCharge, relayActive: s.relayActive,
      bossActive: !!boss && s.bossSpawned && !s.bossDead,
      bossName: "OUTPOST WARDEN", bossHp: boss?.hp ?? 0, bossMax: boss?.maxHp ?? 1,
      interact: s.nearestInteractable(),
      charName: s.def.name, weaponName: s.def.weapon.name,
    };
  }

  private worldToScreen(p: Vector3): { x: number; y: number } | null {
    const v = Vector3.Project(p, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()));
    if (v.z > 1) return null;
    return { x: v.x, y: v.y };
  }
}

function slotsForChar(charId: CharId): SlotKind[] {
  const c = CHARACTERS.find((candidate) => candidate.id === charId)!;
  return SLOTS_FOR_TYPE[c.weapon.type];
}

// Re-export for tests
export { eligibleChoices };
