import { describe, expect, it } from "vitest";
import { SLOTS_FOR_TYPE, computeAttack, rollAttachment, type Rarity, type SlotKind, type WeaponType } from "../src/config";
import { isAttachmentCompatible } from "../src/rules";

function seeded(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("attachments", () => {
  it("rolls exactly one/two/three/four distinct nonzero bonuses by rarity", () => {
    const rarities: [Rarity, number][] = [["Common", 1], ["Rare", 2], ["Epic", 3], ["Legendary", 4]];
    for (const [rarity, expected] of rarities) {
      const item = rollAttachment("Muzzle", rarity, seeded(expected), 12);
      const count = [item.flatAtk, item.atkPct, item.critRate, item.critDmg].filter((v) => v !== 0).length;
      expect(count).toBe(expected);
    }
  });

  it("uses the specified ATK formula and percentage-point crit math with clamping", () => {
    const stats = computeAttack(10, [
      { flatAtk: 2, atkPct: 0.1, critRate: 0.7, critDmg: 0.2 },
      { flatAtk: 3, atkPct: 0.1, critRate: 0.4, critDmg: 0.05 },
    ], 0.1);
    expect(stats.totalAtk).toBe(18);
    expect(stats.critCh).toBe(1);
    expect(stats.critMult).toBe(1.75);
  });

  it("enforces the complete compatibility matrix at the equipment boundary", () => {
    const allSlots: SlotKind[] = ["Muzzle", "Underbarrel", "Sight", "Foregrip", "Bipod", "Latch", "Link"];
    for (const type of Object.keys(SLOTS_FOR_TYPE) as WeaponType[]) {
      for (const slot of allSlots) {
        expect(isAttachmentCompatible(type, { slot })).toBe(SLOTS_FOR_TYPE[type].includes(slot));
      }
      expect(SLOTS_FOR_TYPE[type]).toHaveLength(4);
    }
  });
});
