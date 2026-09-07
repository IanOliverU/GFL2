// Centralized data-driven configuration. All balance numbers live here.
// Kits are original real-time adaptations for this prototype.

export type WeaponType = "AR" | "RF" | "SG" | "MG";
export type SlotKind = "Muzzle" | "Underbarrel" | "Sight" | "Foregrip" | "Bipod" | "Latch" | "Link";
export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";
export type CharId = "tololo" | "qiongjiu" | "mosin" | "sabrina" | "peritya" | "vepley";
export type EnemyKind = "chaser" | "runner" | "spitter" | "heavy";

export interface WeaponDef {
  name: string;
  type: WeaponType;
  flavor: string;
  damage: number; // per-shot (shotguns: total per shot, divided among pellets)
  fireInterval: number; // seconds between shots
  magSize: number;
  reloadTime: number;
  projectiles: number; // pellets / bullets per trigger pull
  spreadDeg: number; // base spread
  range: number;
  auto: boolean;
  pierce: number; // enemies penetrated beyond first
  critEligible: boolean;
}

export interface SkillDef {
  key: "Q" | "E" | "R";
  name: string;
  desc: string;
  cooldown: number;
  maxRank: number;
}

export interface CharacterDef {
  id: CharId;
  name: string;
  title: string;
  color: string;
  weapon: WeaponDef;
  hp: number;
  moveSpeed: number;
  baseAtk: number;
  baseCritCh: number;
  identity: string;
  skills: [SkillDef, SkillDef, SkillDef];
}

export const SLOTS_FOR_TYPE: Record<WeaponType, SlotKind[]> = {
  AR: ["Muzzle", "Underbarrel", "Sight", "Foregrip"],
  RF: ["Muzzle", "Underbarrel", "Sight", "Bipod"],
  MG: ["Muzzle", "Underbarrel", "Sight", "Bipod"],
  SG: ["Muzzle", "Sight", "Latch", "Link"],
};

export const CHARACTERS: CharacterDef[] = [
  {
    id: "tololo", name: "Tololo", title: "Mobile Precision", color: "#ffb454",
    identity: "Mobile precision and burst damage",
    hp: 110, moveSpeed: 7.2, baseAtk: 12, baseCritCh: 0.10,
    weapon: { name: "AK-Alfa", type: "AR", flavor: "Accurate automatic rifle.", damage: 13, fireInterval: 0.13, magSize: 30, reloadTime: 1.5, projectiles: 1, spreadDeg: 1.4, range: 70, auto: true, pierce: 0, critEligible: true },
    skills: [
      { key: "Q", name: "Focus Burst", desc: "Tight 3-round empowered burst (220% ATK each).", cooldown: 6, maxRank: 5 },
      { key: "E", name: "Phase Step", desc: "Dash in move direction; empower next magazine (+25% dmg).", cooldown: 10, maxRank: 5 },
      { key: "R", name: "Overdrive", desc: "8s: +45% fire rate, bonus shot every 4th hit.", cooldown: 32, maxRank: 3 },
    ],
  },
  {
    id: "qiongjiu", name: "Qiongjiu", title: "Mark & Execute", color: "#6fd3ff",
    identity: "Marking and follow-up attacks",
    hp: 105, moveSpeed: 7.0, baseAtk: 12, baseCritCh: 0.12,
    weapon: { name: "QBZ-191", type: "AR", flavor: "Controlled 3-round burst rifle.", damage: 11, fireInterval: 0.22, magSize: 30, reloadTime: 1.5, projectiles: 3, spreadDeg: 2.2, range: 65, auto: true, pierce: 0, critEligible: true },
    skills: [
      { key: "Q", name: "Priority Mark", desc: "Mark aimed enemy 8s: +30% direct dmg taken.", cooldown: 9, maxRank: 5 },
      { key: "E", name: "Support Volley", desc: "Delayed shots at up to 5 visible enemies (150% ATK).", cooldown: 12, maxRank: 5 },
      { key: "R", name: "Execution Window", desc: "6s: primary hits trigger bounded follow-up (60% ATK).", cooldown: 30, maxRank: 3 },
    ],
  },
  {
    id: "mosin", name: "Mosin-Nagant", title: "Long-Line Deadeye", color: "#b8ecff",
    identity: "Precision and piercing damage",
    hp: 100, moveSpeed: 6.6, baseAtk: 14, baseCritCh: 0.20,
    weapon: { name: "Mosin-Nagant", type: "RF", flavor: "Slow, powerful rifle. Right-click scopes.", damage: 55, fireInterval: 1.05, magSize: 5, reloadTime: 2.1, projectiles: 1, spreadDeg: 0.25, range: 110, auto: false, pierce: 1, critEligible: true },
    skills: [
      { key: "Q", name: "Piercing Round", desc: "High-damage shot through up to 4 enemies (300% ATK).", cooldown: 7, maxRank: 5 },
      { key: "E", name: "Shock Trap", desc: "Place visible trap: damage + 50% slow 4s.", cooldown: 13, maxRank: 5 },
      { key: "R", name: "Deadeye", desc: "Empower next 3 shots (+120% dmg, +2 pierce).", cooldown: 30, maxRank: 3 },
    ],
  },
  {
    id: "sabrina", name: "Sabrina", title: "Bulwark Point", color: "#ff8a5c",
    identity: "Close-range control and defense",
    hp: 165, moveSpeed: 6.4, baseAtk: 11, baseCritCh: 0.05,
    weapon: { name: "SPAS-12", type: "SG", flavor: "Pump shotgun, devastating up close.", damage: 42, fireInterval: 0.95, magSize: 6, reloadTime: 2.2, projectiles: 8, spreadDeg: 6.5, range: 22, auto: false, pierce: 0, critEligible: true },
    skills: [
      { key: "Q", name: "Breaching Blast", desc: "Wide blast (180% ATK) that staggers.", cooldown: 7, maxRank: 5 },
      { key: "E", name: "Protective Field", desc: "Zone 8s: 40% damage reduction inside.", cooldown: 16, maxRank: 5 },
      { key: "R", name: "Bulwark", desc: "Shield 120 + 5 short-range pulses (100% ATK).", cooldown: 34, maxRank: 3 },
    ],
  },
  {
    id: "peritya", name: "Peritya", title: "Saturation Gunner", color: "#9dff6f",
    identity: "Sustained fire and area damage",
    hp: 130, moveSpeed: 6.2, baseAtk: 10, baseCritCh: 0.08,
    weapon: { name: "PKP Pecheneg", type: "MG", flavor: "Large magazine; spread grows while firing.", damage: 9, fireInterval: 0.10, magSize: 80, reloadTime: 2.8, projectiles: 1, spreadDeg: 2.0, range: 60, auto: true, pierce: 0, critEligible: true },
    skills: [
      { key: "Q", name: "Suppression Sweep", desc: "Cone attack: 6 ticks of 70% ATK.", cooldown: 8, maxRank: 5 },
      { key: "E", name: "Gravity Snare", desc: "Field 6s: slows + pulls ordinary enemies.", cooldown: 15, maxRank: 5 },
      { key: "R", name: "Saturation Fire", desc: "8s: unlimited mag + small explosive impacts.", cooldown: 36, maxRank: 3 },
    ],
  },
  {
    id: "vepley", name: "Vepley", title: "Knockback Rider", color: "#ff6fd3",
    identity: "Mobility and knockback",
    hp: 115, moveSpeed: 7.6, baseAtk: 11, baseCritCh: 0.10,
    weapon: { name: "Vepr-12", type: "SG", flavor: "Fast semi-auto shotgun, light pellets.", damage: 26, fireInterval: 0.42, magSize: 10, reloadTime: 1.8, projectiles: 6, spreadDeg: 5.5, range: 24, auto: false, pierce: 0, critEligible: true },
    skills: [
      { key: "Q", name: "Concussion Shell", desc: "Explosive shell (200% ATK) with knockback.", cooldown: 6, maxRank: 5 },
      { key: "E", name: "Combat Slide", desc: "Slide + close-range blast (160% ATK).", cooldown: 9, maxRank: 5 },
      { key: "R", name: "Grand Finale", desc: "Telegraphed explosive shells around aim (6x 180% ATK).", cooldown: 32, maxRank: 3 },
    ],
  },
];

export function getCharacter(id: CharId): CharacterDef {
  const c = CHARACTERS.find((c) => c.id === id);
  if (!c) throw new Error(`unknown character ${id}`);
  return c;
}

// ---------- Progression ----------
export const WEAPON_MAX_RANK = 8;
export const SKILL1_MAX = 5, SKILL2_MAX = 5, SKILL3_MAX = 3;

export interface WeaponRankEffect {
  dmgMul: number;
  rateMul: number; // multiply fire rate (interval /= rateMul)
  reloadMul: number;
  extraProjectiles: number;
  extraPierce: number;
  note: string;
}

// rank 1 = base. Each entry describes cumulative effect AT that rank.
export function weaponRankEffect(type: WeaponType, rank: number): WeaponRankEffect {
  const dmgMul = 1 + 0.12 * (rank - 1);
  let rateMul = 1, reloadMul = 1, extraProjectiles = 0, extraPierce = 0;
  const notes: string[] = [];
  if (rank >= 3) { reloadMul = 0.85; notes.push("reload 15% faster"); }
  if (rank >= 4) {
    if (type === "SG") { extraProjectiles = 2; notes.push("+2 pellets"); }
    else if (type === "RF") { extraPierce = 1; notes.push("+1 penetration"); }
    else { extraPierce = 1; notes.push("+1 penetration"); }
  }
  if (rank >= 6) { reloadMul = 0.75; notes.push("reload 25% faster total"); }
  if (rank >= 7) { rateMul = 1.25; notes.push("+25% fire rate"); }
  if (rank >= 8) {
    if (type === "SG" || type === "AR" || type === "MG") { extraProjectiles += 1; notes.push("+1 projectile"); }
    else { extraPierce += 1; notes.push("+1 penetration"); }
  }
  return { dmgMul, rateMul, reloadMul, extraProjectiles, extraPierce, note: notes.join(", ") || "damage up" };
}

export interface SkillRankEffect { powerMul: number; cdMul: number; note: string; }

export function skillRankEffect(skillIndex: 0 | 1 | 2, rank: number): SkillRankEffect {
  // skillIndex 0=Q,1=E,2=R
  const powerMul = 1 + 0.15 * (rank - 1);
  let cdMul = 1;
  const notes: string[] = [`potency ×${powerMul.toFixed(2)}`];
  if (rank >= 2) { cdMul = 0.92; notes.push("-8% cooldown"); }
  if (rank >= 4) { cdMul = 0.85; notes.push("-15% cooldown total"); }
  return { powerMul, cdMul, note: notes.join(", ") };
}

export function skillMilestone(charId: CharId, skillIndex: 0 | 1 | 2, rank: number): string | null {
  if (rank !== 3 && rank !== 5) return null;
  const rankThree: Record<CharId, [string, string, string]> = {
    tololo: ["Focus Burst fires 4 rounds", "dash distance increases from 8m to 10m", "Overdrive gains bonus duration"],
    qiongjiu: ["mark duration increases from 8s to 12s", "Support Volley gains a sixth target", "Execution Window gains bonus duration"],
    mosin: ["Piercing Round gains one penetration", "Shock Trap radius increases", "Deadeye gains a fourth shot and +1 penetration"],
    sabrina: ["Breaching Blast cone widens from 55° to 65°", "Protective Field radius increases by 1.5m", "Bulwark emits 7 pulses and gains 80 shield"],
    peritya: ["Suppression Sweep cone widens from 28° to 35°", "Gravity Snare radius increases by 1.5m", "Saturation Fire gains bonus duration"],
    vepley: ["Concussion Shell blast radius increases", "Combat Slide distance increases from 6.6m to 8m", "Grand Finale launches 8 shells"],
  };
  const rankFive: Record<CharId, [string, string, string]> = {
    tololo: ["Focus Burst fires 5 rounds", "dash distance increases to 12m", "maximum rank reached"],
    qiongjiu: ["mark duration increases to 14s", "Support Volley gains a seventh target", "maximum rank reached"],
    mosin: ["Piercing Round gains another penetration", "Shock Trap reaches maximum radius and damage", "maximum rank reached"],
    sabrina: ["Breaching Blast stagger increases to 1.4s", "Protective Field reaches 64% damage reduction", "maximum rank reached"],
    peritya: ["Suppression Sweep gains 2 ticks", "Gravity Snare reaches 80% slow", "maximum rank reached"],
    vepley: ["Concussion Shell reaches maximum radius and damage", "Combat Slide reaches maximum blast range", "maximum rank reached"],
  };
  return (rank === 3 ? rankThree : rankFive)[charId][skillIndex];
}

export function xpForLevel(level: number): number {
  return Math.round(10 + level * 7 + level * level * 0.6);
}

// ---------- Attachments ----------
export interface AttachmentDef {
  id: string;
  slot: SlotKind;
  rarity: Rarity;
  name: string;
  flatAtk: number;
  atkPct: number; // 0.10 = +10%
  critRate: number; // 0.05 = +5pp
  critDmg: number; // 0.20 = +20pp (150%->170%)
}

const RARITY_STAT_COUNT: Record<Rarity, number> = { Common: 1, Rare: 2, Epic: 3, Legendary: 4 };
const RARITY_NAMES: Record<SlotKind, Record<Rarity, string>> = {
  Muzzle: { Common: "Range Muzzle", Rare: "Tuned Muzzle", Epic: "Precision Muzzle", Legendary: "Calamity Muzzle" },
  Underbarrel: { Common: "Grip Tape", Rare: "Stable Grip", Epic: "Gyro Grip", Legendary: "Anchor Grip" },
  Sight: { Common: "Reflex Sight", Rare: "Holo Sight", Epic: "Tactical Sight", Legendary: "Eagle Sight" },
  Foregrip: { Common: "Polymer Foregrip", Rare: "Ergo Foregrip", Epic: "Assault Foregrip", Legendary: "Titan Foregrip" },
  Bipod: { Common: "Field Bipod", Rare: "Steady Bipod", Epic: "Siege Bipod", Legendary: "Bedrock Bipod" },
  Latch: { Common: "Shell Latch", Rare: "Rapid Latch", Epic: "Tactical Latch", Legendary: "Storm Latch" },
  Link: { Common: "Shot Link", Rare: "Heavy Link", Epic: "Breacher Link", Legendary: "Judgment Link" },
};

export interface StatBlock { flatAtk: number; atkPct: number; critRate: number; critDmg: number; }

export function emptyStats(): StatBlock { return { flatAtk: 0, atkPct: 0, critRate: 0, critDmg: 0 }; }

export function rollAttachment(slot: SlotKind, rarity: Rarity, rand: () => number, baseAtk: number): AttachmentDef {
  const count = RARITY_STAT_COUNT[rarity];
  // pick `count` distinct stats out of 4
  const pool: (keyof StatBlock)[] = ["flatAtk", "atkPct", "critRate", "critDmg"];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t; }
  const chosen = pool.slice(0, count);
  const s = emptyStats();
  const tier = rarity === "Common" ? 0 : rarity === "Rare" ? 1 : rarity === "Epic" ? 2 : 3;
  for (const k of chosen) {
    const q = 0.7 + rand() * 0.6; // quality jitter, higher rarities scale via base ranges below
    if (k === "flatAtk") s.flatAtk = Math.round((3 + tier * 3 + baseAtk * (0.10 + tier * 0.08)) * q);
    if (k === "atkPct") s.atkPct = round2((0.04 + tier * 0.035 + rand() * 0.03) * q + 0.02 * tier);
    if (k === "critRate") s.critRate = round2(0.03 + tier * 0.025 + rand() * 0.03);
    if (k === "critDmg") s.critDmg = round2(0.10 + tier * 0.10 + rand() * 0.08);
  }
  return { id: `${slot}-${rarity}-${Math.floor(rand() * 1e9).toString(36)}`, slot, rarity, name: RARITY_NAMES[slot][rarity], ...s };
}

function round2(n: number) { return Math.round(n * 100) / 100; }

export function rarityWeight(rarity: Rarity, luck: number): number {
  // luck 0..~3 shifts toward high rarities
  const base: Record<Rarity, number> = { Common: 55, Rare: 28, Epic: 12, Legendary: 5 };
  const boost: Record<Rarity, number> = { Common: -8, Rare: -1, Epic: 4, Legendary: 5 };
  return Math.max(1, base[rarity] + boost[rarity] * luck);
}

export function rollRarity(rand: () => number, luck: number): Rarity {
  const order: Rarity[] = ["Common", "Rare", "Epic", "Legendary"];
  const ws = order.map((r) => rarityWeight(r, luck));
  const total = ws.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < order.length; i++) { x -= ws[i]!; if (x <= 0) return order[i]!; }
  return "Common";
}

// Total ATK = (base + flat) * (1 + pct). Crit chance clamped 0..1. Crit mult = 1.5 + bonus.
export function computeAttack(baseAtk: number, mods: StatBlock[], baseCritChance = 0): { totalAtk: number; critCh: number; critMult: number; flat: number; pct: number } {
  let flat = 0, pct = 0, cr = 0, cd = 0;
  for (const m of mods) { flat += m.flatAtk; pct += m.atkPct; cr += m.critRate; cd += m.critDmg; }
  return { totalAtk: (baseAtk + flat) * (1 + pct), critCh: clamp01(baseCritChance + cr, 0, 1), critMult: 1.5 + cd, flat, pct };
}

export function clamp01(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
export { clamp01 as clamp };

// ---------- Enemies ----------
export interface EnemyDef {
  kind: EnemyKind; name: string;
  hp: number; speed: number; damage: number; xp: number;
  attackRange: number; attackCd: number; radius: number; score: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  chaser: { kind: "chaser", name: "Stalker", hp: 42, speed: 4.2, damage: 12, xp: 6, attackRange: 2.2, attackCd: 1.2, radius: 0.7, score: 1 },
  runner: { kind: "runner", name: "Dart", hp: 22, speed: 6.8, damage: 8, xp: 5, attackRange: 2.0, attackCd: 0.9, radius: 0.55, score: 1 },
  spitter: { kind: "spitter", name: "Spitter", hp: 34, speed: 3.4, damage: 10, xp: 8, attackRange: 26, attackCd: 2.4, radius: 0.65, score: 2 },
  heavy: { kind: "heavy", name: "Bulwark", hp: 150, speed: 2.4, damage: 22, xp: 16, attackRange: 4.2, attackCd: 2.6, radius: 1.1, score: 4 },
};

export const BOSS_DEF = {
  name: "Outpost Warden", hp: 2600, speed: 3.2, damage: 18, xp: 120, radius: 1.6,
  slamDamage: 30, slamRadius: 8, volleyCount: 12, summonCount: 3,
};

export function difficultyAt(runTime: number, loop: number): number {
  return 1 + runTime / 75 + loop * 1.2;
}

export function enemyScale(difficulty: number): { hpMul: number; dmgMul: number } {
  return { hpMul: 1 + (difficulty - 1) * 0.55, dmgMul: 1 + (difficulty - 1) * 0.22 };
}

// Bounded proc helper: follow-ups must never recurse.
export const PROC = { MAX_CHAIN: 1, QIONGJIU_FOLLOW_PCT: 0.6, TOLOLO_BONUS_EVERY: 4 };
