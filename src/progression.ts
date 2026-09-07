// Level-up choice generation: pure logic, unit-tested.
import { CharacterDef, SKILL1_MAX, SKILL2_MAX, SKILL3_MAX, WEAPON_MAX_RANK, skillMilestone, skillRankEffect, weaponRankEffect } from "./config";
import type { PlayerBuild } from "./sim";

export interface UpgradeChoice {
  kind: "weapon" | "s1" | "s2" | "s3" | "survival";
  toRank: number;
  title: string;
  rankLabel: string;
  desc: string;
}

export function eligibleChoices(build: PlayerBuild, def: CharacterDef): UpgradeChoice[] {
  const out: UpgradeChoice[] = [];
  if (build.weaponRank < WEAPON_MAX_RANK) {
    const to = build.weaponRank + 1;
    const fx = weaponRankEffect(def.weapon.type, to);
    out.push({
      kind: "weapon", toRank: to,
      title: `${def.weapon.name} — Rank ${to}`,
      rankLabel: `Weapon ${build.weaponRank} → ${to} (max ${WEAPON_MAX_RANK})`,
      desc: `+12% damage per rank (now ×${fx.dmgMul.toFixed(2)}). Milestone: ${fx.note}.`,
    });
  }
  const skills: { kind: "s1" | "s2" | "s3"; cur: number; max: number; idx: 0 | 1 | 2 }[] = [
    { kind: "s1", cur: build.s1, max: SKILL1_MAX, idx: 0 },
    { kind: "s2", cur: build.s2, max: SKILL2_MAX, idx: 1 },
    { kind: "s3", cur: build.s3, max: SKILL3_MAX, idx: 2 },
  ];
  def.skills.forEach((s, i) => {
    const meta = skills[i]!;
    if (meta.cur < meta.max) {
      const fx = skillRankEffect(meta.idx, Math.min(meta.max, meta.cur + 1));
      const milestone = skillMilestone(def.id, meta.idx, meta.cur + 1);
      out.push({
        kind: meta.kind, toRank: meta.cur + 1,
        title: `${s.name} — Rank ${meta.cur + 1}`,
        rankLabel: `${s.key} skill ${meta.cur} → ${meta.cur + 1} (max ${meta.max})`,
        desc: `${s.desc} Runtime effect: ${fx.note}.${milestone ? ` Milestone: ${milestone}.` : ""}`,
      });
    }
  });
  return out;
}

export function rollChoices(build: PlayerBuild, def: CharacterDef, rand: () => number): UpgradeChoice[] {
  const pool = eligibleChoices(build, def);
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t;
  }
  const picks = pool.slice(0, 3);
  if (picks.length === 0) {
    picks.push({
      kind: "survival", toRank: 0,
      title: "Field Rations",
      rankLabel: "Everything maxed — repeatable",
      desc: "Restore 40 HP and gain +2 max HP.",
    });
  }
  return picks;
}

export function applyChoice(build: PlayerBuild, c: UpgradeChoice): { applied: boolean; maxHpBonus: number; heal: number } {
  const rankFields: Record<Exclude<UpgradeChoice["kind"], "survival">, { key: "weaponRank" | "s1" | "s2" | "s3"; max: number }> = {
    weapon: { key: "weaponRank", max: WEAPON_MAX_RANK },
    s1: { key: "s1", max: SKILL1_MAX },
    s2: { key: "s2", max: SKILL2_MAX },
    s3: { key: "s3", max: SKILL3_MAX },
  };
  if (c.kind === "survival") {
    const fullyMaxed = build.weaponRank >= WEAPON_MAX_RANK && build.s1 >= SKILL1_MAX && build.s2 >= SKILL2_MAX && build.s3 >= SKILL3_MAX;
    return fullyMaxed ? { applied: true, maxHpBonus: 2, heal: 40 } : { applied: false, maxHpBonus: 0, heal: 0 };
  }
  const meta = rankFields[c.kind];
  const current = build[meta.key];
  if (!Number.isInteger(c.toRank) || c.toRank !== current + 1 || c.toRank > meta.max) {
    return { applied: false, maxHpBonus: 0, heal: 0 };
  }
  build[meta.key] = c.toRank;
  return { applied: true, maxHpBonus: 0, heal: 0 };
}
