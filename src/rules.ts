import { PROC, SLOTS_FOR_TYPE, AttachmentDef, SlotKind, WeaponDef, WeaponRankEffect, WeaponType } from "./config";

export interface ShotPlan {
  projectileCount: number;
  ammoCost: number;
  damagePerProjectile: number;
  maxTargetsPerProjectile: number;
  pelletMode: boolean;
}

export function createShotPlan(
  weapon: WeaponDef,
  rankEffect: WeaponRankEffect,
  totalTriggerDamage: number,
  ammo: number,
  unlimitedAmmo: boolean,
): ShotPlan {
  const configuredCount = weapon.projectiles + rankEffect.extraProjectiles;
  const pelletMode = weapon.type === "SG";
  const projectileCount = pelletMode
    ? (unlimitedAmmo || ammo > 0 ? configuredCount : 0)
    : (unlimitedAmmo ? configuredCount : Math.min(configuredCount, Math.max(0, ammo)));
  return {
    projectileCount,
    ammoCost: unlimitedAmmo ? 0 : pelletMode ? (projectileCount > 0 ? 1 : 0) : projectileCount,
    damagePerProjectile: pelletMode ? totalTriggerDamage / configuredCount : totalTriggerDamage,
    maxTargetsPerProjectile: 1 + weapon.pierce + rankEffect.extraPierce,
    pelletMode,
  };
}

export function nextProcDepth(depth: number): number | null {
  if (!Number.isInteger(depth) || depth < 0 || depth >= PROC.MAX_CHAIN) return null;
  return depth + 1;
}

export function isAttachmentCompatible(type: WeaponType, attachment: Pick<AttachmentDef, "slot">): boolean {
  return SLOTS_FOR_TYPE[type].includes(attachment.slot);
}

export function compatibleSlots(type: WeaponType): readonly SlotKind[] {
  return SLOTS_FOR_TYPE[type];
}

export function objectiveComplete(bossDead: boolean, relayCharge: number): boolean {
  return bossDead && relayCharge >= 1;
}

export interface LoopTransition {
  loop: number;
  relayActive: false;
  relayCharge: 0;
  bossSpawned: false;
  bossDead: false;
}

export function nextLoopTransition(currentLoop: number): LoopTransition {
  return {
    loop: Math.max(0, Math.floor(currentLoop)) + 1,
    relayActive: false,
    relayCharge: 0,
    bossSpawned: false,
    bossDead: false,
  };
}
