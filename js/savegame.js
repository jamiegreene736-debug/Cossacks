// Versioned, local campaign persistence. Runtime-only objects (spatial grids,
// functions and canvas state) are rebuilt on restore; durable entity links are
// stored as ids and rehydrated after the fresh world has been constructed.

import { Commander } from './ai.js';
import {
  NATIONS, DEFAULT_CPU_DIFFICULTY, defaultStartPositionForSide,
  normalizeCpuDifficulty,
} from './config.js';
import {
  repairEconomyLedgers, repairFieldAttachments, reserveEntityIds,
} from './economy.js';
import { createWorld, getUnitRuntimeStats, reserveUnitIds } from './sim.js';
import { PLAYER_TEAM, RIVAL_TEAM } from './teams.js';
import { initializeWitchFlight } from './witch-flight.js';

export const SAVE_KEY = 'empires1700.campaign.v1';
export const SAVE_VERSION = 1;

const NUMBER_TAG = '__empires1700_number__';
const WORLD_ARRAYS = [
  'buildings', 'resources', 'particles', 'flags', 'destructions',
  'pendingDecals', 'decals', 'events',
];
const WORLD_VALUES = [
  'time', 'winner', 'checkT', 'speed', 'killLog', 'sides', 'difficulty', 'navigationVersion',
  'worldCountry',
];

function encodeNumber(value) {
  if (Number.isNaN(value)) return { [NUMBER_TAG]: 'nan' };
  if (value === Infinity) return { [NUMBER_TAG]: 'infinity' };
  if (value === -Infinity) return { [NUMBER_TAG]: '-infinity' };
  return value;
}

function decodeNumber(value) {
  if (!value || typeof value !== 'object' || !(NUMBER_TAG in value)) return value;
  if (value[NUMBER_TAG] === 'nan') return NaN;
  if (value[NUMBER_TAG] === 'infinity') return Infinity;
  if (value[NUMBER_TAG] === '-infinity') return -Infinity;
  return value;
}

export function encodeSnapshot(snapshot) {
  return JSON.stringify(snapshot, (_key, value) => typeof value === 'number' ? encodeNumber(value) : value);
}

export function decodeSnapshot(serialized) {
  return JSON.parse(serialized, (_key, value) => decodeNumber(value));
}

function clone(value) {
  return decodeSnapshot(encodeSnapshot(value));
}

function withoutReferences(entity, omitted) {
  const copy = {};
  for (const [key, value] of Object.entries(entity)) {
    if (!omitted.has(key)) copy[key] = value;
  }
  return clone(copy);
}

function serializeUnit(unit) {
  const copy = withoutReferences(unit, new Set(['target', 'orderTarget', 'deferredAttack']));
  copy.targetId = unit.target?.id ?? null;
  copy.orderTargetId = unit.orderTarget?.id ?? null;
  copy.deferredAttack = unit.deferredAttack
    ? { targetId: unit.deferredAttack.target?.id ?? null, at: unit.deferredAttack.at }
    : null;
  return copy;
}

function serializeProjectile(projectile) {
  const copy = withoutReferences(projectile, new Set(['target']));
  copy.targetId = projectile.target?.id ?? null;
  return copy;
}

function normalizeCommanderList(commanderOrCommanders) {
  return (Array.isArray(commanderOrCommanders) ? commanderOrCommanders : [commanderOrCommanders])
    .filter(Boolean);
}

function serializeCommander(commander) {
  return {
    side: commander.side,
    difficulty: commander.difficulty,
    thinkTimer: commander.thinkTimer,
    attackTimer: commander.attackTimer,
    committed: [...commander.committed],
    planCursor: clone(commander.planCursor),
    resourceCursor: commander.resourceCursor,
  };
}

function campaignSummary(world, savedAt) {
  const player = world.sides[0];
  const alliedSides = world.sides.filter((side, index) => index !== 0 && side.team === player.team);
  const enemySides = world.sides.filter(side => side.team !== player.team);
  return {
    savedAt,
    nation: player.nation,
    allyNations: alliedSides.map(side => side.nation),
    enemyNation: enemySides[0]?.nation || world.sides[1]?.nation,
    enemyNations: enemySides.map(side => side.nation),
    difficulty: normalizeCpuDifficulty(world.difficulty),
    elapsed: world.time,
    population: player.population,
    military: world.units.filter(unit => unit.alive && unit.side === 0 && unit.type !== 'villager').length,
    buildings: world.buildings.filter(building => building.alive && building.side === 0).length,
  };
}

export function createGameSnapshot(world, commanderOrCommanders, camera, savedAt = Date.now()) {
  const commanders = normalizeCommanderList(commanderOrCommanders);
  if (!world || commanders.length === 0) throw new Error('A running campaign is required to save.');
  const worldData = {
    units: world.units.map(serializeUnit),
    projectiles: world.projectiles.map(serializeProjectile),
  };
  for (const key of WORLD_ARRAYS) worldData[key] = clone(world[key] || []);
  for (const key of WORLD_VALUES) worldData[key] = clone(world[key]);

  return {
    version: SAVE_VERSION,
    savedAt,
    summary: campaignSummary(world, savedAt),
    world: worldData,
    commander: serializeCommander(commanders[0]),
    commanders: commanders.map(serializeCommander),
    camera: {
      x: Number(camera?.x) || defaultStartPositionForSide(world.sides, 0).x,
      y: Number(camera?.y) || defaultStartPositionForSide(world.sides, 0).y,
      zoom: Number(camera?.zoom) || 0.9,
      rotation: Number(camera?.rotation) || 0,
    },
  };
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== SAVE_VERSION) throw new Error('This campaign save uses an unsupported version.');
  const data = snapshot.world;
  if (!data || !Array.isArray(data.units) || !Array.isArray(data.buildings) || !Array.isArray(data.resources)) {
    throw new Error('The campaign save is incomplete.');
  }
  if (!Array.isArray(data.sides) || data.sides.length < 2
      || data.sides.some(side => !NATIONS[side?.nation])) {
    throw new Error('The campaign save contains an unknown nation.');
  }
}

function legacyTeamForSideIndex(sideIndex) {
  return sideIndex % 2 === 0 ? PLAYER_TEAM : RIVAL_TEAM;
}

function repairSideTeams(world) {
  for (let sideIndex = 0; sideIndex < world.sides.length; sideIndex++) {
    const side = world.sides[sideIndex];
    if (!Number.isInteger(side.team)) {
      side.team = legacyTeamForSideIndex(sideIndex);
    }
    side.controller = sideIndex === 0 ? 'human' : side.controller || 'ai';
    if (!side.startPosition) side.startPosition = defaultStartPositionForSide(world.sides, sideIndex);
  }
  for (const unit of world.units || []) {
    if (!Number.isInteger(unit.team)) unit.team = world.sides[unit.side]?.team ?? null;
  }
  for (const building of world.buildings || []) {
    if (!Number.isInteger(building.team)) building.team = world.sides[building.side]?.team ?? null;
  }
}

function applyCurrentUnitBalance(unit) {
  const previousMaxHp = Number(unit.maxHp);
  const previousHp = Number(unit.hp);
  const healthRatio = Number.isFinite(previousMaxHp) && previousMaxHp > 0 && Number.isFinite(previousHp)
    ? Math.max(0, Math.min(1, previousHp / previousMaxHp)) : 1;
  const stats = getUnitRuntimeStats(unit.unitType || unit.type);
  Object.assign(unit, stats);
  unit.hp = stats.maxHp * healthRatio;
  unit.reload = Math.max(0, Math.min(Number(unit.reload) || 0, stats.reloadTime));
  unit.meleeCd = Math.max(0, Math.min(Number(unit.meleeCd) || 0, stats.meleeRate));
}

export function restoreGameSnapshot(snapshot) {
  validateSnapshot(snapshot);
  const data = snapshot.world;
  // Saves made before difficulty selection used today's Hard policy.
  const difficulty = normalizeCpuDifficulty(
    data.difficulty || snapshot.commander?.difficulty,
    DEFAULT_CPU_DIFFICULTY,
  );
  const world = createWorld({
    playerNation: data.sides[0].nation,
    enemyNation: data.sides[1].nation,
    difficulty,
    worldCountry: data.worldCountry,
    sides: data.sides,
  });

  for (const key of WORLD_ARRAYS) world[key] = clone(data[key] || []);
  for (const key of WORLD_VALUES) {
    if (data[key] !== undefined) world[key] = clone(data[key]);
  }
  world.difficulty = difficulty;
  world.units = clone(data.units);
  world.projectiles = clone(data.projectiles || []);
  world.active = [];
  world.state = 'paused';
  repairSideTeams(world);
  repairEconomyLedgers(world);
  repairFieldAttachments(world);

  const entities = new Map();
  for (const entity of [...world.units, ...world.buildings, ...world.resources]) entities.set(entity.id, entity);
  for (const unit of world.units) {
    applyCurrentUnitBalance(unit);
    initializeWitchFlight(unit);
    unit.selected = false;
    unit.target = entities.get(unit.targetId) || null;
    unit.orderTarget = entities.get(unit.orderTargetId) || null;
    if (unit.deferredAttack) {
      const target = entities.get(unit.deferredAttack.targetId);
      unit.deferredAttack = target ? { target, at: unit.deferredAttack.at } : null;
    }
    delete unit.targetId;
    delete unit.orderTargetId;
  }
  for (const building of world.buildings) {
    building.selected = false;
    if (building.type === 'gate' && typeof building.gateOpen !== 'boolean') building.gateOpen = true;
  }
  for (const projectile of world.projectiles) {
    projectile.target = entities.get(projectile.targetId) || null;
    delete projectile.targetId;
  }

  reserveUnitIds(Math.max(0, ...world.units.map(unit => unit.id)));
  reserveEntityIds(Math.max(99999, ...world.buildings.map(building => building.id), ...world.resources.map(resource => resource.id)));

  const commanderSnapshots = Array.isArray(snapshot.commanders) && snapshot.commanders.length
    ? snapshot.commanders : snapshot.commander ? [snapshot.commander] : [];
  const aiSides = world.sides
    .map((_side, sideIndex) => sideIndex)
    .filter(sideIndex => sideIndex !== 0);
  const restoredCommanders = commanderSnapshots.length
    ? commanderSnapshots.map(saved => {
      const side = saved?.side ?? 1;
      const commander = new Commander(world, side, saved?.difficulty || difficulty);
      commander.thinkTimer = Number(saved?.thinkTimer) || 0;
      commander.attackTimer = Number(saved?.attackTimer) || 0;
      commander.committed = new Set(saved?.committed || []);
      commander.planCursor = clone(saved?.planCursor || {});
      commander.resourceCursor = Math.max(0, Number(saved?.resourceCursor) || 0);
      return commander;
    })
    : [];
  const commandersBySide = new Map(restoredCommanders.map(commander => [commander.side, commander]));
  for (const sideIndex of aiSides) {
    if (!commandersBySide.has(sideIndex)) {
      commandersBySide.set(sideIndex, new Commander(world, sideIndex, difficulty));
    }
  }
  const commanders = aiSides.map(sideIndex => commandersBySide.get(sideIndex));

  const savedCamera = snapshot.camera || {};
  return {
    world,
    commander: commanders[0] || null,
    commanders,
    camera: {
      x: Number(savedCamera.x) || 660,
      y: Number(savedCamera.y) || 1600,
      zoom: Number(savedCamera.zoom) || 0.9,
      rotation: Number(savedCamera.rotation) || 0,
    },
  };
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('Campaign storage is unavailable in this browser.');
  }
  return storage;
}

export function saveCampaign(world, commander, camera, storage = globalThis.localStorage) {
  const snapshot = createGameSnapshot(world, commander, camera);
  requireStorage(storage).setItem(SAVE_KEY, encodeSnapshot(snapshot));
  return snapshot.summary;
}

export function loadCampaign(storage = globalThis.localStorage) {
  const serialized = requireStorage(storage).getItem(SAVE_KEY);
  if (!serialized) return null;
  const snapshot = decodeSnapshot(serialized);
  validateSnapshot(snapshot);
  return snapshot;
}

export function getCampaignSummary(storage = globalThis.localStorage) {
  try {
    const snapshot = loadCampaign(storage);
    return snapshot?.summary || null;
  } catch (_error) {
    return { corrupt: true };
  }
}

export function deleteCampaign(storage = globalThis.localStorage) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  storage.removeItem(SAVE_KEY);
}
