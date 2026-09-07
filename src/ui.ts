// HTML/CSS overlay UI: title, select, HUD, modals. Canvas stays unblocked during play.
import { AttachmentDef } from "./config";
import { UpgradeChoice } from "./progression";
import { Settings } from "./audio";

export interface HudSkill { key: string; name: string; cd: number; cdMax: number; rank: number; }
export interface HudState {
  hp: number; maxHp: number; shield: number; maxShield: number;
  xp: number; xpNext: number; level: number;
  time: number; difficulty: number; loop: number; kills: number;
  ammo: number; mag: number; reloading: boolean;
  skills: HudSkill[]; dodgeCD: number;
  objective: string; relayCharge: number; relayActive: boolean;
  bossActive: boolean; bossName: string; bossHp: number; bossMax: number;
  interact: string | null;
  charName: string; weaponName: string;
}

export interface UIHandlers {
  onPlay(): void;
  onStart(charId: string): void;
  onResume(): void;
  onRestart(): void;
  onTitle(): void;
  onPause(): void;
  onLevelPick(c: UpgradeChoice): void;
  onAttachDecision(accept: boolean): void;
  onFinishRun(): void;
  onContinueLoop(): void;
  onInteract(): void;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export function statLines(a: AttachmentDef | null): string {
  if (!a) return `<span class="dim">Empty</span>`;
  const parts: string[] = [];
  if (a.flatAtk) parts.push(`+${a.flatAtk} ATK`);
  if (a.atkPct) parts.push(`+${Math.round(a.atkPct * 100)}% ATK`);
  if (a.critRate) parts.push(`+${Math.round(a.critRate * 100)}% crit`);
  if (a.critDmg) parts.push(`+${Math.round(a.critDmg * 100)}pp crit dmg`);
  return `<b class="rar-${a.rarity}">[${a.rarity}] ${a.name}</b><br/>${parts.join("<br/>")}`;
}

export class GameUI {
  root: HTMLElement;
  h: UIHandlers;
  els: Record<string, HTMLElement> = {};
  dmgPool: { el: HTMLElement; life: number; sx: number; sy: number }[] = [];
  toastTimer = 0;

  constructor(root: HTMLElement, h: UIHandlers) {
    this.root = root;
    this.h = h;
    root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="dmg-vignette"></div>
        <div id="crosshair"><div class="dot"></div></div>
        <div id="hitmarker">✕</div>
        <div id="hud-top-left"></div>
        <div id="hud-top-center"><div id="objective-line"></div><div id="boss-bar-wrap" class="hidden"><div id="boss-name"></div><div class="bar"><div id="boss-fill"></div></div></div></div>
        <div id="hud-bottom-left">
          <div class="hud-label"><span id="hp-text"></span><span id="lvl-text"></span></div>
          <div class="bar"><div id="hp-fill"></div></div>
          <div class="bar" style="height:9px"><div id="shield-fill"></div></div>
          <div class="bar" style="height:8px"><div id="xp-fill"></div></div>
        </div>
        <div id="hud-bottom-right">
          <div id="ammo"></div>
          <div id="reload-note"></div>
          <div id="abilities"></div>
        </div>
        <div id="killfeed"></div>
        <div id="interact-tip" class="hidden"></div>
        <div id="debug-overlay" class="hidden"></div>
        <div id="dmg-layer" style="position:absolute;inset:0;overflow:hidden"></div>
      </div>
      <div id="toast" class="toast hidden"></div>
      <div id="screen-slot"></div>
      <div id="modal-slot"></div>`;
    const ids = ["hud", "hud-top-left", "objective-line", "boss-bar-wrap", "boss-name", "boss-fill", "hp-text", "lvl-text", "hp-fill", "shield-fill", "xp-fill", "ammo", "reload-note", "abilities", "killfeed", "interact-tip", "debug-overlay", "dmg-layer", "toast", "screen-slot", "modal-slot", "crosshair", "hitmarker", "dmg-vignette"];
    for (const id of ids) this.els[id] = root.querySelector(`#${id}`) as HTMLElement;
    for (let i = 0; i < 28; i++) {
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;font-weight:800;font-size:15px;color:#fff;text-shadow:0 1px 3px #000;opacity:0;transform:translate(-50%,-50%);pointer-events:none";
      this.els["dmg-layer"]!.appendChild(el);
      this.dmgPool.push({ el, life: 0, sx: 0, sy: 0 });
    }
  }

  showHud(v: boolean): void { this.els["hud"]!.classList.toggle("hidden", !v); }

  toast(msg: string, ms = 2600): void {
    const t = this.els["toast"]!;
    t.textContent = msg;
    t.classList.remove("hidden");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add("hidden"), ms);
  }

  killfeed(msg: string): void {
    const k = this.els["killfeed"]!;
    const div = document.createElement("div");
    div.textContent = msg;
    k.prepend(div);
    while (k.children.length > 5) k.lastChild?.remove();
    window.setTimeout(() => div.remove(), 6000);
  }

  damageNumber(text: string, crit: boolean, sx: number, sy: number): void {
    const d = this.dmgPool.find((d) => d.life <= 0) ?? this.dmgPool[0]!;
    d.life = 0.8; d.sx = sx; d.sy = sy;
    d.el.textContent = text;
    d.el.style.color = crit ? "#ffd54a" : "#fff";
    d.el.style.fontSize = crit ? "20px" : "15px";
    d.el.style.opacity = "1";
  }

  tickDamageNumbers(dt: number): void {
    for (const d of this.dmgPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.sy -= dt * 46;
      d.el.style.left = `${d.sx}px`;
      d.el.style.top = `${d.sy}px`;
      d.el.style.opacity = Math.max(0, Math.min(1, d.life / 0.4)).toString();
    }
  }

  hitmarker(kill: boolean): void {
    const h = this.els["hitmarker"]!;
    h.style.opacity = "1";
    h.style.color = kill ? "#ff5c5c" : "#fff";
    window.setTimeout(() => { h.style.opacity = "0"; }, 90);
  }

  updateHud(s: HudState): void {
    this.els["hp-text"]!.textContent = `HP ${Math.ceil(s.hp)}/${s.maxHp}${s.shield > 0 ? ` (+${Math.ceil(s.shield)})` : ""}`;
    this.els["lvl-text"]!.textContent = `Lv ${s.level} • ${s.charName}`;
    (this.els["hp-fill"]! as HTMLElement).style.width = `${Math.max(0, (s.hp / s.maxHp) * 100)}%`;
    (this.els["shield-fill"]! as HTMLElement).style.width = s.maxShield > 0 ? `${(s.shield / s.maxShield) * 100}%` : "0%";
    (this.els["xp-fill"]! as HTMLElement).style.width = `${Math.min(100, (s.xp / s.xpNext) * 100)}%`;
    this.els["ammo"]!.innerHTML = `${s.ammo} <small>/ ${s.mag}</small>`;
    this.els["reload-note"]!.textContent = s.reloading ? "RELOADING…" : "";
    this.els["hud-top-left"]!.innerHTML =
      `⏱ ${fmtTime(s.time)} &nbsp; ☠ ${s.kills} &nbsp; ⟳ loop ${s.loop}<br/>` +
      `<span class="dim">difficulty ${s.difficulty.toFixed(1)} • ${s.weaponName}</span>`;
    const pct = Math.round(s.relayCharge * 100);
    this.els["objective-line"]!.innerHTML = s.relayActive
      ? `RELAY <b id="objective-flash">${pct}%</b> — stay in the ring ${s.bossActive ? "• boss active" : ""}<br/><span class="dim">${s.objective}</span>`
      : `<span class="dim">${s.objective}</span>`;
    // boss
    this.els["boss-bar-wrap"]!.classList.toggle("hidden", !s.bossActive);
    if (s.bossActive) {
      this.els["boss-name"]!.textContent = s.bossName;
      (this.els["boss-fill"]! as HTMLElement).style.width = `${Math.max(0, (s.bossHp / s.bossMax) * 100)}%`;
    }
    // abilities
    const ab = this.els["abilities"]!;
    ab.innerHTML = "";
    for (const sk of s.skills) {
      const d = document.createElement("div");
      d.className = "ab";
      d.innerHTML = `<b>${sk.key}</b><span>${sk.name}◈${sk.rank}</span>` +
        (sk.cd > 0.05 ? `<div class="cd">${sk.cd.toFixed(1)}</div>` : "") +
        (s.dodgeCD > 0.05 && sk.key === "D" ? `<div class="cd">${s.dodgeCD.toFixed(1)}</div>` : "");
      ab.appendChild(d);
    }
    const dd = document.createElement("div");
    dd.className = "ab";
    dd.innerHTML = `<b>Ctrl</b><span>dodge</span>` + (s.dodgeCD > 0.05 ? `<div class="cd">${s.dodgeCD.toFixed(1)}</div>` : "");
    ab.appendChild(dd);
    const tip = this.els["interact-tip"]!;
    if (s.interact) { tip.textContent = `[F] ${s.interact}`; tip.classList.remove("hidden"); }
    else tip.classList.add("hidden");
  }

  flashDamage(): void {
    const v = this.els["dmg-vignette"]!;
    v.style.boxShadow = "inset 0 0 140px rgba(255,40,40,.55)";
    window.setTimeout(() => { v.style.boxShadow = "inset 0 0 120px rgba(255,40,40,0)"; }, 130);
  }
  flashHeal(): void {
    const v = this.els["dmg-vignette"]!;
    v.style.boxShadow = "inset 0 0 140px rgba(80,255,150,.4)";
    window.setTimeout(() => { v.style.boxShadow = "inset 0 0 120px rgba(255,40,40,0)"; }, 160);
  }

  setDebug(visible: boolean, text: string): void {
    this.els["debug-overlay"]!.classList.toggle("hidden", !visible);
    if (visible) this.els["debug-overlay"]!.textContent = text;
  }

  clearOverlays(): void {
    this.els["screen-slot"]!.innerHTML = "";
    this.els["modal-slot"]!.innerHTML = "";
  }

  resetTransient(): void {
    window.clearTimeout(this.toastTimer);
    this.els["toast"]!.classList.add("hidden");
    this.els["killfeed"]!.innerHTML = "";
    this.els["hitmarker"]!.style.opacity = "0";
    this.els["dmg-vignette"]!.style.boxShadow = "inset 0 0 120px rgba(255,40,40,0)";
    for (const d of this.dmgPool) {
      d.life = 0;
      d.el.style.opacity = "0";
    }
  }

  showTitle(best: Settings, onControls: () => void, onSettings: () => void): void {
    this.showHud(false);
    const bestLine = best.wins > 0 || best.bestTime > 0
      ? `Best run: ${fmtTime(best.bestTime)} • Lv ${best.bestLevel} • loop ${best.bestLoop} • victories ${best.wins}`
      : "No runs recorded yet.";
    this.els["screen-slot"]!.innerHTML = `
      <div class="screen"><div class="card">
        <h1>GFL2 ROGUELITE <span class="sub">// Outpost Relay</span></h1>
        <p class="dim">A single-player action roguelite prototype. Six dolls, one relay, one Warden. Build strength, charge the relay, kill the boss — both are required for victory.</p>
        <p class="dim">${bestLine}</p>
        <p class="dim">⚠ Placeholder stylized characters stand in for GFL2 likenesses (no official assets bundled). WASD + mouse. Click Play, then click the canvas to lock aim.</p>
        <div class="row wrap mt">
          <button class="primary" id="b-play">Play</button>
          <button id="b-controls">Controls</button>
          <button id="b-settings">Settings</button>
        </div>
      </div></div>`;
    (this.els["screen-slot"]!.querySelector("#b-play") as HTMLButtonElement).onclick = () => this.h.onPlay();
    (this.els["screen-slot"]!.querySelector("#b-controls") as HTMLButtonElement).onclick = () => onControls();
    (this.els["screen-slot"]!.querySelector("#b-settings") as HTMLButtonElement).onclick = () => onSettings();
  }

  showControls(back: () => void): void {
    this.els["screen-slot"]!.innerHTML = `
      <div class="screen"><div class="card">
        <h1>Controls</h1>
        <table class="controls-table">
          <tr><td>WASD</td><td>Camera-relative movement</td></tr>
          <tr><td>Mouse</td><td>Camera look / aiming (click canvas to lock)</td></tr>
          <tr><td>LMB</td><td>Primary fire (hold for cadence)</td></tr>
          <tr><td>RMB</td><td>Aim / zoom (scoped on Mosin-Nagant)</td></tr>
          <tr><td>Space</td><td>Jump</td></tr>
          <tr><td>Shift</td><td>Sprint</td></tr>
          <tr><td>Ctrl</td><td>Dodge (i-frames, 2s cooldown)</td></tr>
          <tr><td>Q / E / R</td><td>Skills (R = ultimate)</td></tr>
          <tr><td>F</td><td>Interact (relay / caches / pickups)</td></tr>
          <tr><td>Tab</td><td>Equipment &amp; stats</td></tr>
          <tr><td>Esc / P</td><td>Pause</td></tr>
        </table>
        <div class="row mt"><button id="b-back">Back</button></div>
      </div></div>`;
    (this.els["screen-slot"]!.querySelector("#b-back") as HTMLButtonElement).onclick = back;
  }

  showSettings(s: Settings, onChange: (s: Settings) => void, back: () => void): void {
    const row = (label: string, id: string, min: string, max: string, step: string, val: number): string =>
      `<div class="setting-row"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"/></div>`;
    this.els["screen-slot"]!.innerHTML = `
      <div class="screen"><div class="card">
        <h1>Settings</h1>
        ${row("Master volume", "s-master", "0", "1", "0.05", s.master)}
        ${row("SFX volume", "s-sfx", "0", "1", "0.05", s.sfx)}
        ${row("UI volume", "s-ui", "0", "1", "0.05", s.ui)}
        ${row("Look sensitivity", "s-sens", "0.3", "2.5", "0.1", s.sensitivity)}
        <div class="setting-row"><span>Reverse W / S</span><input type="checkbox" id="s-reverse-forward" ${s.reverseForward ? "checked" : ""}/></div>
        <div class="setting-row"><span>Reverse A / D</span><input type="checkbox" id="s-reverse-strafe" ${s.reverseStrafe ? "checked" : ""}/></div>
        <div class="setting-row"><span>Invert horizontal look</span><input type="checkbox" id="s-invert-x" ${s.invertLookX ? "checked" : ""}/></div>
        <div class="setting-row"><span>Invert vertical look</span><input type="checkbox" id="s-invert-y" ${s.invertLookY ? "checked" : ""}/></div>
        <div class="setting-row"><span>Camera shake</span><input type="checkbox" id="s-shake" ${s.shake ? "checked" : ""}/></div>
        <div class="setting-row"><span>Debug overlay</span><input type="checkbox" id="s-debug" ${s.debug ? "checked" : ""}/></div>
        <div class="row mt"><button id="b-back">Back</button></div>
      </div></div>`;
    const q = (id: string): HTMLInputElement => this.els["screen-slot"]!.querySelector(id) as HTMLInputElement;
    const commit = (): void => {
      s.master = parseFloat(q("#s-master").value); s.sfx = parseFloat(q("#s-sfx").value);
      s.ui = parseFloat(q("#s-ui").value); s.sensitivity = parseFloat(q("#s-sens").value);
      s.reverseForward = q("#s-reverse-forward").checked;
      s.reverseStrafe = q("#s-reverse-strafe").checked;
      s.invertLookX = q("#s-invert-x").checked; s.invertLookY = q("#s-invert-y").checked;
      s.shake = q("#s-shake").checked; s.debug = q("#s-debug").checked;
      onChange(s);
    };
    for (const id of ["#s-master", "#s-sfx", "#s-ui", "#s-sens", "#s-reverse-forward", "#s-reverse-strafe", "#s-invert-x", "#s-invert-y", "#s-shake", "#s-debug"]) q(id).oninput = commit;
    (this.els["screen-slot"]!.querySelector("#b-back") as HTMLButtonElement).onclick = back;
  }

  showSelect(chars: { id: string; name: string; title: string; color: string; weapon: string; wtype: string; identity: string; skills: string[] }[]): void {
    this.showHud(false);
    const cards = chars.map((c) => `
      <button class="char-card" data-id="${c.id}">
        <span class="swatch" style="background:${c.color}"></span>
        <span class="char-title">${c.name} <span class="dim">· ${c.title}</span></span>
        <span class="tag">${c.weapon}</span><span class="tag">${c.wtype}</span>
        <span class="char-copy">${c.identity}</span>
        <span class="char-copy">${c.skills.map((s) => `◈ ${s}`).join("<br/>")}</span>
      </button>`).join("");
    this.els["screen-slot"]!.innerHTML = `
      <div class="screen"><div class="card">
        <h1>Select your doll</h1>
        <p class="dim">All kits are original real-time adaptations for this prototype. Click a card, then Deploy.</p>
        <div class="grid-select">${cards}</div>
        <div class="row mt spread"><button id="b-back2">Back</button><button class="primary" id="b-go" disabled>Deploy</button></div>
      </div></div>`;
    let sel: string | null = null;
    const go = this.els["screen-slot"]!.querySelector("#b-go") as HTMLButtonElement;
    this.els["screen-slot"]!.querySelectorAll(".char-card").forEach((el) => {
      (el as HTMLButtonElement).onclick = () => {
        this.els["screen-slot"]!.querySelectorAll(".char-card").forEach((x) => x.classList.remove("selected"));
        el.classList.add("selected");
        sel = (el as HTMLElement).dataset["id"]!;
        go.disabled = false;
      };
    });
    (this.els["screen-slot"]!.querySelector("#b-back2") as HTMLButtonElement).onclick = () => this.h.onTitle();
    go.onclick = () => { if (sel) this.h.onStart(sel); };
  }

  showLevelUp(choices: UpgradeChoice[], level: number): void {
    const cards = choices.map((c, i) => `
      <button class="up-card" data-i="${i}">
        <span class="up-title">${c.title}</span>
        <span class="rank">${c.rankLabel}</span>
        <span class="up-copy">${c.desc}</span>
      </button>`).join("");
    this.els["modal-slot"]!.innerHTML = `
      <div class="modal"><div class="modal-card">
        <h2 style="margin:0">Level ${level} — choose one</h2>
        <p class="dim">Simulation paused. Exactly one upgrade applies.</p>
        <div class="cards3">${cards}</div>
      </div></div>`;
    this.els["modal-slot"]!.querySelectorAll(".up-card").forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.onLevelPick(choices[parseInt((el as HTMLElement).dataset["i"]!, 10)]!);
    });
  }

  showAttachmentPick(def: AttachmentDef, onTake: (d: AttachmentDef) => void, onLeave: () => void): void {
    this.els["modal-slot"]!.innerHTML = `
      <div class="modal"><div class="modal-card" style="width:min(520px,94vw)">
        <h2 style="margin:0">Attachment found</h2>
        <p>${statLines(def)}</p>
        <p class="dim">Compatible slot: <b>${def.slot}</b>. Empty slots equip instantly; occupied slots open a comparison.</p>
        <div class="row"><button class="primary" id="a-take">Take</button><button id="a-leave">Leave</button></div>
      </div></div>`;
    (this.els["modal-slot"]!.querySelector("#a-take") as HTMLButtonElement).onclick = () => onTake(def);
    (this.els["modal-slot"]!.querySelector("#a-leave") as HTMLButtonElement).onclick = () => onLeave();
  }

  showAttachmentCompare(oldA: AttachmentDef | null, next: AttachmentDef, delta: string, onAccept: () => void, onDecline: () => void): void {
    this.els["modal-slot"]!.innerHTML = `
      <div class="modal"><div class="modal-card" style="width:min(640px,94vw)">
        <h2 style="margin:0">Compare — ${next.slot} slot</h2>
        <div class="row wrap spread">
          <div style="flex:1;min-width:220px"><h3>Equipped</h3><p>${statLines(oldA)}</p></div>
          <div style="flex:1;min-width:220px"><h3>New</h3><p>${statLines(next)}</p></div>
        </div>
        <table class="stat-table">${delta}</table>
        <div class="row mt"><button class="primary" id="c-yes">Equip (discard old)</button><button id="c-no">Keep old</button></div>
      </div></div>`;
    (this.els["modal-slot"]!.querySelector("#c-yes") as HTMLButtonElement).onclick = onAccept;
    (this.els["modal-slot"]!.querySelector("#c-no") as HTMLButtonElement).onclick = onDecline;
  }

  showEquipment(slots: { slot: string; def: AttachmentDef | null }[], statsHtml: string, onClose: () => void): void {
    const grid = slots.map((s) => `<div class="slot"><h4>${s.slot}</h4>${statLines(s.def)}</div>`).join("");
    this.els["modal-slot"]!.innerHTML = `
      <div class="modal"><div class="modal-card">
        <h2 style="margin:0">Equipment &amp; Doll (Tab to close)</h2>
        <div class="equip-grid mt">${grid}</div>
        <table class="stat-table">${statsHtml}</table>
        <div class="row mt"><button class="primary" id="e-close">Close</button></div>
      </div></div>`;
    (this.els["modal-slot"]!.querySelector("#e-close") as HTMLButtonElement).onclick = onClose;
  }

  showPause(onResume: () => void, onRestart: () => void, onTitle: () => void): void {
    this.els["modal-slot"]!.innerHTML = `
      <div class="modal"><div class="modal-card" style="width:min(440px,94vw)">
        <h2 style="margin:0">Paused</h2>
        <p class="dim">Combat, cooldowns and the difficulty timer are suspended.</p>
        <div class="row wrap"><button class="primary" id="p-res">Resume</button><button id="p-rest">Restart</button><button id="p-title">Title</button></div>
      </div></div>`;
    (this.els["modal-slot"]!.querySelector("#p-res") as HTMLButtonElement).onclick = onResume;
    (this.els["modal-slot"]!.querySelector("#p-rest") as HTMLButtonElement).onclick = onRestart;
    (this.els["modal-slot"]!.querySelector("#p-title") as HTMLButtonElement).onclick = onTitle;
  }

  showVictory(lines: string, canLoop: boolean): void {
    this.showHud(false);
    this.els["screen-slot"]!.innerHTML = `
      <div class="screen"><div class="card" style="text-align:center">
        <h1>✔ RELAY COMPLETE <span class="sub">— Warden down</span></h1>
        <p class="dim">${lines}</p>
        <div class="row wrap" style="justify-content:center">
          <button id="v-finish">Finish Run</button>
          ${canLoop ? `<button class="primary" id="v-loop">Continue Loop (harder)</button>` : ""}
        </div>
      </div></div>`;
    (this.els["screen-slot"]!.querySelector("#v-finish") as HTMLButtonElement).onclick = () => this.h.onFinishRun();
    const loop = this.els["screen-slot"]!.querySelector("#v-loop") as HTMLButtonElement | null;
    if (loop) loop.onclick = () => this.h.onContinueLoop();
  }

  showDefeat(lines: string): void {
    this.showHud(false);
    this.els["screen-slot"]!.innerHTML = `
      <div class="screen"><div class="card" style="text-align:center">
        <h1>✕ DOLL DOWN</h1>
        <p class="dim">${lines}</p>
        <div class="row wrap" style="justify-content:center">
          <button class="primary" id="d-re">Retry</button><button id="d-title">Title</button>
        </div>
      </div></div>`;
    (this.els["screen-slot"]!.querySelector("#d-re") as HTMLButtonElement).onclick = () => this.h.onRestart();
    (this.els["screen-slot"]!.querySelector("#d-title") as HTMLButtonElement).onclick = () => this.h.onTitle();
  }

  closeModal(): void { this.els["modal-slot"]!.innerHTML = ""; }
  closeScreens(): void { this.els["screen-slot"]!.innerHTML = ""; }
}
