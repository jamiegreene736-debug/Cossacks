// Team helpers for multi-town skirmishes. Side ids remain stable for old 1v1
// and 2v2 code: side 0 is the player, side 1 is the first rival, side 2 is the
// first ally, side 3 is the second rival, and later even sides are extra allies.

export const PLAYER_SIDE = 0;
export const PLAYER_TEAM = 0;
export const RIVAL_TEAM = 1;

export function sideTeam(world, sideIndex) {
  const side = world?.sides?.[sideIndex];
  if (Number.isInteger(side?.team)) return side.team;
  return Number.isInteger(sideIndex) && sideIndex % 2 === 0 ? PLAYER_TEAM : RIVAL_TEAM;
}

export function entityTeam(world, entity) {
  if (Number.isInteger(entity?.team)) return entity.team;
  return sideTeam(world, entity?.side);
}

export function areAlliedSides(world, a, b) {
  return Number.isInteger(a) && Number.isInteger(b) && sideTeam(world, a) === sideTeam(world, b);
}

export function areHostileSides(world, a, b) {
  return Number.isInteger(a) && Number.isInteger(b) && sideTeam(world, a) !== sideTeam(world, b);
}

export function areHostileEntities(world, a, b) {
  return Number.isInteger(a?.side) && Number.isInteger(b?.side)
    && entityTeam(world, a) !== entityTeam(world, b);
}

export function playerTeam(world) {
  return sideTeam(world, PLAYER_SIDE);
}

export function isPlayerTeam(world, sideIndex) {
  return sideTeam(world, sideIndex) === playerTeam(world);
}

export function teamSides(world, team) {
  return (world?.sides || [])
    .map((side, sideIndex) => ({ side, sideIndex }))
    .filter(entry => sideTeam(world, entry.sideIndex) === team)
    .map(entry => entry.sideIndex);
}

export function sideFrontDirection(world, sideIndex) {
  return isPlayerTeam(world, sideIndex) ? 1 : -1;
}

export function hostileUnits(world, sideIndex) {
  return (world?.units || []).filter(unit => unit.alive && areHostileSides(world, sideIndex, unit.side));
}

export function hostileBuildings(world, sideIndex) {
  return (world?.buildings || []).filter(building => (
    building.alive && areHostileSides(world, sideIndex, building.side)
  ));
}

export function liveTownCentersForTeam(world, team) {
  return (world?.buildings || []).filter(building => (
    building.alive
      && building.type === 'town_center'
      && sideTeam(world, building.side) === team
      && world.sides?.[building.side]?.townCenterId === building.id
  ));
}

export function livingTeams(world) {
  const teams = [...new Set((world?.sides || []).map((_side, sideIndex) => sideTeam(world, sideIndex)))];
  return teams.filter(team => liveTownCentersForTeam(world, team).length > 0);
}

export function teamVictory(world) {
  const alive = livingTeams(world);
  if (alive.length === 0) return -2;
  if (alive.length === 1) return alive[0];
  return null;
}

export function nearestHostileTownCenter(world, sideIndex, fromX = 0, fromY = 0) {
  return hostileBuildings(world, sideIndex)
    .filter(building => building.type === 'town_center'
      && world.sides?.[building.side]?.townCenterId === building.id)
    .sort((a, b) => Math.hypot(a.x - fromX, a.y - fromY) - Math.hypot(b.x - fromX, b.y - fromY))[0]
    || null;
}

export function sidePossessiveLabel(world, sideIndex) {
  if (sideIndex === PLAYER_SIDE) return 'Your';
  return isPlayerTeam(world, sideIndex) ? 'Allied' : 'Enemy';
}
