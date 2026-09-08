import { describe, expect, it } from "vitest";
import { Input, suppressContextMenuWithin } from "../src/input";
import { nextLoopTransition, objectiveComplete } from "../src/rules";

describe("run transitions", () => {
  it("requires both full relay charge and boss defeat in either order", () => {
    expect(objectiveComplete(false, 0)).toBe(false);
    expect(objectiveComplete(true, 0.99)).toBe(false);
    expect(objectiveComplete(false, 1)).toBe(false);
    expect(objectiveComplete(true, 1)).toBe(true);
    expect(objectiveComplete(true, 1.5)).toBe(true);
  });

  it("increments loop and resets every encounter objective flag", () => {
    expect(nextLoopTransition(2)).toEqual({ loop: 3, relayActive: false, relayCharge: 0, bossSpawned: false, bossDead: false });
    expect(nextLoopTransition(-10).loop).toBe(1);
  });

  it("clears held and edge-triggered input when leaving gameplay", () => {
    const input = new Input();
    input.keys.add("KeyW");
    input.pressed.add("KeyQ");
    input.mouseDown = true;
    input.rmbDown = true;
    input.lookDX = 8;
    input.releaseAll();
    expect(input.keys.size).toBe(0);
    expect(input.pressed.size).toBe(0);
    expect(input.mouseDown).toBe(false);
    expect(input.rmbDown).toBe(false);
    expect(input.lookDX).toBe(0);
  });

  it("suppresses context menus only while game-owned surfaces are installed", () => {
    const canvas = new EventTarget();
    const overlay = new EventTarget();
    const cleanup = suppressContextMenuWithin(canvas, overlay);
    const canvasMenu = new Event("contextmenu", { cancelable: true });
    const overlayMenu = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(canvasMenu);
    overlay.dispatchEvent(overlayMenu);
    expect(canvasMenu.defaultPrevented).toBe(true);
    expect(overlayMenu.defaultPrevented).toBe(true);
    cleanup();
    const afterCleanup = new Event("contextmenu", { cancelable: true });
    overlay.dispatchEvent(afterCleanup);
    expect(afterCleanup.defaultPrevented).toBe(false);
  });
});
