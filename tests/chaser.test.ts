import { describe, expect, it } from "vitest";
import {
  CHASER_STRIKE_DUR,
  chaserNewAnim,
  chaserPoseAngles,
  chaserStepAnim,
  chaserWindup,
} from "../src/chaser";

describe("ordinary Chaser animation kernel", () => {
  it("creates independent animation state for every enemy", () => {
    const a = chaserNewAnim();
    const b = chaserNewAnim();
    chaserStepAnim(a, 0.1, 4);
    expect(a.phase).toBeGreaterThan(0);
    expect(a.speedSm).toBeGreaterThan(0);
    expect(b).toEqual(chaserNewAnim());
  });

  it("matches locomotion weight to measured speed and settles when stopped", () => {
    const a = chaserNewAnim();
    chaserStepAnim(a, 0.1, 4);
    const moving = a.speedSm;
    for (let i = 0; i < 20; i++) chaserStepAnim(a, 0.1, 0);
    expect(moving).toBeGreaterThan(0.5);
    expect(a.speedSm).toBeLessThan(0.01);
  });

  it("telegraphs only near reach as the authoritative attack time approaches", () => {
    expect(chaserWindup(4, 2.2, 0)).toBe(0);
    expect(chaserWindup(2.5, 2.2, 2)).toBe(0);
    expect(chaserWindup(2.5, 2.2, 0.3)).toBeGreaterThan(0);
    expect(chaserWindup(2.2, 2.2, 0)).toBe(1);
  });

  it("layers strike and flinch without changing locomotion inputs", () => {
    const base = chaserPoseAngles({ speedFactor: 0, phase: 0, time: 0, windup: 0, strike: 0, flinch: 0, stunned: false });
    const strike = chaserPoseAngles({ speedFactor: 0, phase: 0, time: 0, windup: 0, strike: 0.5, flinch: 0, stunned: false });
    const flinch = chaserPoseAngles({ speedFactor: 0, phase: 0, time: 0, windup: 0, strike: 0, flinch: 1, stunned: false });
    expect(strike.shRX).toBeGreaterThan(base.shRX + 0.7);
    expect(strike.torsoX).toBeGreaterThan(base.torsoX);
    expect(flinch.torsoX).toBeLessThan(base.torsoX);
  });

  it("keeps the damage-event contact continuous with full anticipation", () => {
    const windup = chaserPoseAngles({ speedFactor: 0, phase: 0, time: 0, windup: 1, strike: 0, flinch: 0, stunned: false });
    const firstStrikeStep = chaserPoseAngles({
      speedFactor: 0, phase: 0, time: 0, windup: 0,
      strike: (1 / 60) / CHASER_STRIKE_DUR,
      flinch: 0, stunned: false,
    });
    expect(Math.abs(firstStrikeStep.shRX - windup.shRX)).toBeLessThan(0.1);
    expect(Math.abs(firstStrikeStep.torsoX - windup.torsoX)).toBeLessThan(0.1);
    expect(firstStrikeStep.shRX).toBeGreaterThan(0.7);
  });

  it("shows a cosmetic flinch even while stunned", () => {
    const stunned = chaserPoseAngles({ speedFactor: 0, phase: 0, time: 0.02, windup: 0, strike: 0, flinch: 0, stunned: true });
    const hit = chaserPoseAngles({ speedFactor: 0, phase: 0, time: 0.02, windup: 0, strike: 0, flinch: 1, stunned: true });
    expect(hit.torsoX).toBeLessThan(stunned.torsoX);
    expect(hit.headX).toBeLessThan(stunned.headX);
  });

  it("expires reaction timers without underflow", () => {
    const a = chaserNewAnim();
    a.flinchT = 0.18;
    a.strikeT = CHASER_STRIKE_DUR;
    chaserStepAnim(a, 1, 0);
    expect(a.flinchT).toBe(0);
    expect(a.strikeT).toBe(0);
  });
});
