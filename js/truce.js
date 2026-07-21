// Shared opening-peace policy. Keeping the clock and hostile-action predicate
// in one dependency-free module lets input, AI, simulation, defenses and the
// HUD agree on the exact frame when combat becomes legal.

export const OPENING_PEACE_SECONDS = 10 * 60;

export function peaceTimeRemaining(world) {
  const elapsed = Math.max(0, Number(world?.time) || 0);
  return Math.max(0, OPENING_PEACE_SECONDS - elapsed);
}

export function isPeaceTime(world) {
  return peaceTimeRemaining(world) > 0;
}

export function formatPeaceTime(world) {
  const total = Math.ceil(peaceTimeRemaining(world));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function isHostilePair(attacker, target) {
  return Number.isInteger(attacker?.side)
    && Number.isInteger(target?.side)
    && attacker.side !== target.side;
}
