import { describe, expect, it } from "vitest";
import { CHARACTERS, SKILL1_MAX, SKILL2_MAX, SKILL3_MAX, WEAPON_MAX_RANK, xpForLevel } from "../src/config";
import { applyChoice, eligibleChoices, rollChoices, type UpgradeChoice } from "../src/progression";
import type { PlayerBuild } from "../src/sim";

function build(overrides: Partial<PlayerBuild> = {}): PlayerBuild {
  return {
    charId: "tololo", level: 1, xp: 0, xpNext: xpForLevel(1),
    weaponRank: 1, s1: 1, s2: 1, s3: 1, queuedLevels: 0,
    attachments: { Muzzle: null, Underbarrel: null, Sight: null, Foregrip: null },
    ...overrides,
  };
}

function choice(kind: UpgradeChoice["kind"], toRank: number): UpgradeChoice {
  return { kind, toRank, title: "test", rankLabel: "test", desc: "test" };
}

describe("progression", () => {
  it("starts with four distinct eligible rank-two upgrades and rolls three", () => {
    const initial = build();
    const eligible = eligibleChoices(initial, CHARACTERS[0]!);
    expect(eligible.map((c) => c.kind).sort()).toEqual(["s1", "s2", "s3", "weapon"]);
    expect(eligible.every((c) => c.toRank === 2)).toBe(true);
    const picks = rollChoices(initial, CHARACTERS[0]!, () => 0.42);
    expect(picks).toHaveLength(3);
    expect(new Set(picks.map((c) => c.kind)).size).toBe(3);
    expect(initial.weaponRank).toBe(1);
  });

  it("excludes capped upgrades and offers repeatable survival only when all are capped", () => {
    const almost = build({ weaponRank: WEAPON_MAX_RANK, s1: SKILL1_MAX, s2: SKILL2_MAX, s3: 2 });
    expect(eligibleChoices(almost, CHARACTERS[0]!).map((c) => c.kind)).toEqual(["s3"]);
    const maxed = build({ weaponRank: WEAPON_MAX_RANK, s1: SKILL1_MAX, s2: SKILL2_MAX, s3: SKILL3_MAX });
    expect(rollChoices(maxed, CHARACTERS[0]!, () => 0.5).map((c) => c.kind)).toEqual(["survival"]);
  });

  it("applies exactly one next rank and rejects stale, repeated, fractional and over-cap choices", () => {
    const b = build();
    expect(applyChoice(b, choice("weapon", 2)).applied).toBe(true);
    expect(b.weaponRank).toBe(2);
    expect(applyChoice(b, choice("weapon", 2)).applied).toBe(false);
    expect(applyChoice(b, choice("weapon", 3.5)).applied).toBe(false);
    b.weaponRank = WEAPON_MAX_RANK;
    expect(applyChoice(b, choice("weapon", WEAPON_MAX_RANK + 1)).applied).toBe(false);
    expect(applyChoice(b, choice("survival", 0)).applied).toBe(false);
  });

  it("has a behavior-changing rank-three milestone for every weapon skill", () => {
    for (const character of CHARACTERS) {
      const b = build({ charId: character.id, weaponRank: 2, s1: 2, s2: 2, s3: 2 });
      const descriptions = eligibleChoices(b, character).map((c) => c.desc);
      expect(descriptions).toHaveLength(4);
      expect(descriptions.every((desc) => desc.includes("Milestone:"))).toBe(true);
    }
  });
});
