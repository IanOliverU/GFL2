import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  tololoHoldMount, tololoModelToPlayer, tololoPlayerToModel, tololoPlayerToWorld,
  tololoPoseParams, tololoQuatFromTo, tololoSolveTwoBoneIk,
} from "../src/tololo-visual";

describe("tololo model-to-player mapping", () => {
  it("applies the half-turn yaw (x/z flip) plus scale and lift", () => {
    const out = new Vector3();
    tololoModelToPlayer(1, 2, 3, 0.1175, 0, out);
    expect(out.x).toBeCloseTo(-0.1175);
    expect(out.y).toBeCloseTo(0.235);
    expect(out.z).toBeCloseTo(-0.3525);
  });

  it("grounds model-space feet at the player-root plane", () => {
    const out = new Vector3();
    tololoModelToPlayer(0.5, 0, -0.5, 0.1175, 0.0, out);
    expect(out.y).toBeCloseTo(0);
  });
});

describe("tololo hold mount", () => {
  it("sits between the grips at the rear bias", () => {
    const rear = new Vector3(0.2, 1.4, 0.3);
    const front = new Vector3(-0.2, 1.35, 0.5);
    const out = new Vector3();
    tololoHoldMount(rear, front, 0.35, out);
    expect(out.x).toBeCloseTo(0.06);
    expect(out.y).toBeCloseTo(1.3825);
    expect(out.z).toBeCloseTo(0.37);
  });

  it("clamps the bias to the grip segment", () => {
    const rear = new Vector3(0, 0, 0);
    const front = new Vector3(1, 0, 0);
    const out = new Vector3();
    tololoHoldMount(rear, front, 9, out);
    expect(out.x).toBeCloseTo(1);
    tololoHoldMount(rear, front, -9, out);
    expect(out.x).toBeCloseTo(0);
  });
});

describe("tololo player/model/world conversions", () => {
  it("round-trips model -> player -> model", () => {
    const p = new Vector3();
    const m = new Vector3();
    tololoModelToPlayer(3.1, 12.7, -4.2, 0.1175, 0.0, p);
    tololoPlayerToModel(p.x, p.y, p.z, 0.1175, 0.0, m);
    expect(m.x).toBeCloseTo(3.1);
    expect(m.y).toBeCloseTo(12.7);
    expect(m.z).toBeCloseTo(-4.2);
  });

  it("maps player-local through the yaw+PI root at yaw 0", () => {
    const out = new Vector3();
    tololoPlayerToWorld(0.5, 1.7, 0.49, new Vector3(10, 0, 10), 0, out);
    expect(out.x).toBeCloseTo(9.5);
    expect(out.y).toBeCloseTo(1.7);
    expect(out.z).toBeCloseTo(9.51);
  });
});

describe("tololo shortest-arc quaternion", () => {
  it("is identity for identical directions", () => {
    const q = new Quaternion();
    tololoQuatFromTo(new Vector3(0, -1, 0), new Vector3(0, -1, 0), q);
    expect(q.w).toBeCloseTo(1);
  });

  it("swings down onto model-forward", () => {
    const q = new Quaternion();
    tololoQuatFromTo(new Vector3(0, -1, 0), new Vector3(0, 0, -1), q);
    const r = new Vector3(0, -1, 0).applyRotationQuaternion(q);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(-1);
  });
});

describe("tololo two-bone IK", () => {
  it("places the elbow exactly on both segment lengths", () => {
    const elbow = new Vector3();
    const r = tololoSolveTwoBoneIk(
      new Vector3(0, 0, 0), new Vector3(0, -1, 1), 1, 1,
      new Vector3(0.7, -1, 0.15), elbow);
    expect(r.clamped).toBe(false);
    expect(elbow.subtract(new Vector3(0, 0, 0)).length()).toBeCloseTo(1);
    expect(new Vector3(0, -1, 1).subtract(elbow).length()).toBeCloseTo(1);
  });

  it("clamps unreachable targets along the reach direction", () => {
    const elbow = new Vector3();
    const r = tololoSolveTwoBoneIk(
      new Vector3(0, 0, 0), new Vector3(0, -5, 0), 1, 1,
      new Vector3(0.7, -1, 0.15), elbow);
    expect(r.clamped).toBe(true);
    expect(elbow.y).toBeCloseTo(-1);
  });
});

describe("tololo pose params", () => {
  it("stays within sane joint ranges", () => {
    for (const v of Object.values(tololoPoseParams)) {
      expect(Math.abs(v)).toBeLessThanOrEqual(1.6);
    }
  });
});
