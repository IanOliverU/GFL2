import { describe, expect, it } from "vitest";
import { getCharacter, weaponRankEffect } from "../src/config";
import { createShotPlan, nextProcDepth } from "../src/rules";

describe("shot planning and bounded procs", () => {
  it("treats Qiongjiu as a three-round burst, not three shotgun pellets", () => {
    const weapon = getCharacter("qiongjiu").weapon;
    const plan = createShotPlan(weapon, weaponRankEffect("AR", 1), 11, 30, false);
    expect(plan.projectileCount).toBe(3);
    expect(plan.ammoCost).toBe(3);
    expect(plan.damagePerProjectile).toBe(11);
    expect(plan.pelletMode).toBe(false);
  });

  it("divides shotgun shell damage across pellets without multiplying a full shell per pellet", () => {
    const weapon = getCharacter("sabrina").weapon;
    const plan = createShotPlan(weapon, weaponRankEffect("SG", 1), 42, 6, false);
    expect(plan.projectileCount).toBe(8);
    expect(plan.ammoCost).toBe(1);
    expect(plan.damagePerProjectile * plan.projectileCount).toBeCloseTo(42);
  });

  it("keeps penetration when rank eight adds projectiles", () => {
    const weapon = getCharacter("tololo").weapon;
    const plan = createShotPlan(weapon, weaponRankEffect("AR", 8), 20, 30, false);
    expect(plan.projectileCount).toBe(2);
    expect(plan.maxTargetsPerProjectile).toBe(2);
    expect(plan.damagePerProjectile).toBe(20);
  });

  it("never permits a follow-up to recursively trigger another follow-up", () => {
    expect(nextProcDepth(0)).toBe(1);
    expect(nextProcDepth(1)).toBeNull();
    expect(nextProcDepth(-1)).toBeNull();
    expect(nextProcDepth(0.5)).toBeNull();
  });
});
