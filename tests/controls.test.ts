import { describe, expect, it } from "vitest";
import { applyMouseLook, cameraRelativeMove, horizontalBasis } from "../src/controls";

describe("camera-relative controls", () => {
  it("maps WASD to the camera basis without reversing forward or strafe", () => {
    expect(cameraRelativeMove(0, 1, 0)).toEqual({ x: 0, z: -1 });
    expect(cameraRelativeMove(0, -1, 0)).toEqual({ x: 0, z: 1 });
    expect(cameraRelativeMove(-1, 0, 0)).toEqual({ x: -1, z: 0 });
    expect(cameraRelativeMove(1, 0, 0)).toEqual({ x: 1, z: -0 });
  });

  it("keeps forward and right aligned after turning the camera", () => {
    const yaw = -Math.PI / 2;
    const basis = horizontalBasis(yaw);
    const forward = cameraRelativeMove(0, 1, yaw);
    const right = cameraRelativeMove(1, 0, yaw);
    expect(forward.x).toBeCloseTo(basis.forwardX);
    expect(forward.z).toBeCloseTo(basis.forwardZ);
    expect(right.x).toBeCloseTo(basis.rightX);
    expect(right.z).toBeCloseTo(basis.rightZ);
    expect(forward.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(1);
  });

  it("configures forward and strafe polarity independently", () => {
    expect(cameraRelativeMove(0, 1, 0, true, false)).toEqual({ x: 0, z: 1 });
    expect(cameraRelativeMove(1, 0, 0, false, true)).toEqual({ x: -1, z: 0 });
  });

  it("turns right for positive X and looks down for positive Y mouse deltas", () => {
    const start = horizontalBasis(0);
    const look = applyMouseLook(0, 0, 100, 100, 1);
    const after = horizontalBasis(look.yaw);
    expect(after.forwardX).toBeGreaterThan(start.forwardX);
    expect(look.pitch).toBeLessThan(0);
  });

  it("clamps vertical look", () => {
    expect(applyMouseLook(0, 0, 0, 100_000, 1).pitch).toBe(-1.1);
    expect(applyMouseLook(0, 0, 0, -100_000, 1).pitch).toBe(0.55);
  });

  it("keeps horizontal polarity while correcting vertical look", () => {
    const look = applyMouseLook(0, 0, 100, 100, 1, true, false);
    expect(look.yaw).toBeGreaterThan(0);
    expect(look.pitch).toBeLessThan(0);
  });
});
