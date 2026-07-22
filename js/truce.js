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
  const fallbackTeam = side => (Number.isInteger(side) && side % 2 === 0 ? 0 : 1);
  const attackerTeam = Number.isInteger(attacker?.team) ? attacker.team : fallbackTeam(attacker?.side);
  const targetTeam = Number.isInteger(target?.team) ? target.team : fallbackTeam(target?.side);
  return Number.isInteger(attacker?.side)
    && Number.isInteger(target?.side)
    && attackerTeam !== targetTeam;
}
