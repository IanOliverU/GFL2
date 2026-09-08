import { describe, expect, it } from "vitest";
import { GZ_SOLIDS, validateGreenZone } from "../src/gz-layout";

describe("green zone layout", () => {
  it("keeps route points, ramps, doors, and caches clear", () => {
    expect(validateGreenZone()).toEqual([]);
  });

  it("detects a blocking box (validator is live)", () => {
    const bad = [...GZ_SOLIDS, { name: "test-block", box: [4, 1, 12, 3, 2, 3] as [number, number, number, number, number, number], solid: true }];
    const problems = validateGreenZone(bad);
    expect(problems.some((p) => p.includes("test-block"))).toBe(true);
  });

  it("keeps solid count bounded for collision cost", () => {
    expect(GZ_SOLIDS.filter((s) => s.solid).length).toBeLessThanOrEqual(24);
  });
});
