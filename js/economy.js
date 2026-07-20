// Economy, construction, gathering and production queues. The battle simulator
// owns movement/combat; this module owns settlement state and resource rules.

import {
  WORLD, NATIONS, UNIT_TYPES, BUILDING_TYPES, RESOURCE_KEYS,
  STARTING_RESOURCES, GATHER_RATES, MAX_POPULATION,
} from './config.js';
import { applyMoveOrder } from './formations.js';
import { resolveWorkerAction } from './worker-animation.js';

let nextEntityId = 100000;

export function reserveEntityIds(maxId) {
  if (Number.isFinite(maxId)) nextEntityId = Math.max(nextEntityId, Math.floor(maxId) + 1);
}

function freshResources() {
  return Object.fromEntries(RESOURCE_KEYS.map(key => [key, STARTING_RESOURCES[key] || 0]));
}

function freshRates() {
  return Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
}

export function formatCost(cost = {}) {
  return RESOURCE_KEYS.filter(key => cost[key]).map(key => `${cost[key]} ${key}`).join(' · ');
}

export function hasResources(side, cost = {}) {
  return RESOURCE_KEYS.every(key => (side.resources[key] || 0) + 1e-6 >= (cost[key] || 0));
}

function spendResources(side, cost = {}) {
  if (!hasResources(side, cost)) return false;
  for (const key of RESOURCE_KEYS) side.resources[key] -= cost[key] || 0;
  return true;
}

function refundResources(side, cost = {}, fraction = 1) {
  for (const key of RESOURCE_KEYS) side.resources[key] += (cost[key] || 0) * fraction;
}

export function createBuilding(side, type, x, y, complete = false) {
  const def = BUILDING_TYPES[type];
  if (!def) throw new Error(`Unknown building type: ${type}`);
  return {
    id: nextEntityId++, entityKind: 'building', side, type,
    x, y, radius: def.radius, w: def.w, h: def.h,
    hp: complete ? def.hp : Math.max(1, def.hp * 0.08), maxHp: def.hp,
    alive: true, selected: false, complete,
    progress: complete ? 1 : 0.02,
    queue: [], rallyX: NaN, rallyY: NaN,
    reload: Math.random() * (def.reload || 0),
    resourceType: def.resource || null,
    amount: def.amount || 0,
  };
}

function createResource(type, x, y, amount, radius = 38) {
  return {
    id: nextEntityId++, entityKind: 'resource', type, resourceType: type,
    x, y, amount, maxAmount: amount, radius, alive: true,
    seed: Math.random() * 10000,
  };
}

function addResourceCluster(world, type, x, y, amount, radius) {
  const node = createResource(type, x, y, amount, radius);
  world.resources.push(node);
  return node;
}

function seedMapResources(world) {
  const cy = WORLD.h / 2;
  for (const side of [0, 1]) {
    const baseX = side === 0 ? 720 : WORLD.w - 720;
    const dir = side === 0 ? 1 : -1;
    addResourceCluster(world, 'food', baseX + dir * 245, cy - 235, 5200, 46);
    addResourceCluster(world, 'wood', baseX + dir * 385, cy - 20, 14000, 72);
    addResourceCluster(world, 'gold', baseX + dir * 320, cy + 245, 9000, 50);
    addResourceCluster(world, 'stone', baseX + dir * 500, cy - 330, 9000, 52);
  }

  // Rich central deposits create a reason for the two growing settlements to
  // contest the middle rather than turtle indefinitely.
  addResourceCluster(world, 'wood', WORLD.w / 2, cy - 520, 26000, 95);
  addResourceCluster(world, 'wood', WORLD.w / 2, cy + 520, 26000, 95);
  addResourceCluster(world, 'gold', WORLD.w / 2 - 130, cy, 18000, 65);
  addResourceCluster(world, 'stone', WORLD.w / 2 + 150, cy + 100, 18000, 65);
  addResourceCluster(world, 'food', WORLD.w / 2, cy - 235, 9000, 55);
}

export function initializeEconomy(world) {
  world.buildings = [];
  world.resources = [];
  world.events = [];

  seedMapResources(world);
  for (const sideIndex of [0, 1]) {
    const side = world.sides[sideIndex];
    side.resources = freshResources();
    side.incomePerHour = freshRates();
    side.incomeSample = freshRates();
    side.incomeSampleTime = 0;
    side.population = 0;
    side.queuedPopulation = 0;
    side.popCap = BUILDING_TYPES.town_center.popCap;
    side.maxPopulation = MAX_POPULATION;
    side.unitsCreated = 0;
    side.buildingsLost = 0;
    const x = sideIndex === 0 ? 660 : WORLD.w - 660;
    const tc = createBuilding(sideIndex, 'town_center', x, WORLD.h / 2, true);
    world.buildings.push(tc);
    side.townCenterId = tc.id;

    // This is intentionally free: the first frame contains only the Town
    // Center, then its first resident emerges. The player can never be stuck.
    queueUnit(world, tc, 'villager', 1, { free: true, trainTime: 4 });
  }
}

export function buildingsOf(world, side, type = null, completedOnly = false) {
  return world.buildings.filter(b => b.alive && b.side === side
    && (!type || b.type === type) && (!completedOnly || b.complete));
}

export function unitsOf(world, side, type = null) {
  return world.units.filter(u => u.alive && u.side === side && (!type || u.type === type));
}

export function getTownCenter(world, side) {
  return world.buildings.find(b => b.id === world.sides[side].townCenterId && b.alive) || null;
}

export function validatePlacement(world, side, type, x, y) {
  const def = BUILDING_TYPES[type];
  if (!def || type === 'town_center') return { ok: false, message: 'That building cannot be placed.' };
  const margin = def.radius + 35;
  if (x < margin || y < margin || x > WORLD.w - margin || y > WORLD.h - margin) {
    return { ok: false, message: 'Build inside the map boundary.' };
  }
  for (const b of world.buildings) {
    if (!b.alive) continue;
    if (Math.hypot(x - b.x, y - b.y) < def.radius + b.radius + 18) {
      return { ok: false, message: 'Too close to another building.' };
    }
  }
  for (const r of world.resources) {
    if (!r.alive || r.amount <= 0) continue;
    if (Math.hypot(x - r.x, y - r.y) < def.radius + r.radius + 10) {
      return { ok: false, message: 'Resource deposits must remain accessible.' };
    }
  }
  const nearestOwn = world.buildings.reduce((best, b) => {
    if (!b.alive || b.side !== side) return best;
    return Math.min(best, Math.hypot(x - b.x, y - b.y));
  }, Infinity);
  if (nearestOwn > 900) return { ok: false, message: 'Build within your settlement frontier.' };
  return { ok: true, message: '' };
}

export function placeBuilding(world, sideIndex, type, x, y, builders, options = {}) {
  const side = world.sides[sideIndex];
  const def = BUILDING_TYPES[type];
  const validBuilders = builders.filter(u => u.alive && u.side === sideIndex && u.type === 'villager');
  if (!def) return { ok: false, message: 'Unknown building.' };
  if (!options.ai && validBuilders.length === 0) return { ok: false, message: 'Select at least one villager.' };
  const placement = validatePlacement(world, sideIndex, type, x, y);
  if (!placement.ok) return placement;
  if (!spendResources(side, def.cost)) {
    return { ok: false, message: `Need ${formatCost(def.cost)}.` };
  }
  const building = createBuilding(sideIndex, type, x, y, false);
  world.buildings.push(building);
  assignBuilders(world, validBuilders, building);
  return { ok: true, building, message: `${def.label} foundation placed.` };
}

export function assignBuilders(world, workers, building) {
  if (!building || !building.alive || building.complete) return false;
  let assigned = false;
  for (const worker of workers) {
    if (!worker.alive || worker.type !== 'villager' || worker.side !== building.side) continue;
    worker.job = { kind: 'build', targetId: building.id };
    worker.workAction = 'build';
    worker.orderTarget = null;
    worker.target = null;
    assigned = true;
  }
  return assigned;
}

export function assignGatherers(world, workers, target) {
  const isFarm = target?.entityKind === 'building' && target.type === 'farm'
    && target.complete && target.alive;
  const isDeposit = target?.entityKind === 'resource' && target.alive && target.amount > 0;
  const workResources = target?.entityKind === 'building'
    ? BUILDING_TYPES[target.type]?.workResources || [] : [];
  const isWorkplace = workResources.length > 0 && target.complete && target.alive;
  if (!isFarm && !isDeposit && !isWorkplace) return false;
  let assigned = false;
  for (const worker of workers) {
    if (!worker.alive || worker.type !== 'villager') continue;
    if ((isFarm || isWorkplace) && worker.side !== target.side) continue;
    if (isWorkplace) {
      const side = world.sides[worker.side];
      const resourceType = workResources.reduce((best, resource) => (
        (side.resources[resource] || 0) < (side.resources[best] || 0) ? resource : best
      ), workResources[0]);
      worker.job = { kind: 'workplace', targetId: target.id, resourceType };
    } else {
      worker.job = { kind: 'gather', targetId: target.id };
    }
    worker.workAction = resolveWorkerAction(worker.job, target);
    worker.orderTarget = null;
    worker.target = null;
    assigned = true;
  }
  return assigned;
}

export function clearWorkerJobs(units) {
  for (const unit of units) {
    if (unit.type !== 'villager') continue;
    unit.job = null;
    unit.workAction = null;
    if (unit.state === 'work') unit.state = 'idle';
  }
}

function populationSpace(side, unitType) {
  const pop = UNIT_TYPES[unitType].pop || 1;
  return side.population + side.queuedPopulation + pop <= Math.min(side.popCap, side.maxPopulation);
}

export function queueUnit(world, building, unitType, count = 1, options = {}) {
  const def = UNIT_TYPES[unitType];
  const bDef = BUILDING_TYPES[building?.type];
  if (!building?.alive || !building.complete || !def || !bDef?.trains?.includes(unitType)) {
    return { ok: false, queued: 0, message: 'That unit cannot be trained here.' };
  }
  const side = world.sides[building.side];
  let queued = 0;
  const wanted = Math.max(1, Math.min(50, count | 0));
  for (let i = 0; i < wanted; i++) {
    if (!populationSpace(side, unitType)) break;
    if (!options.free && !spendResources(side, def.cost)) break;
    const nationMult = unitType === 'villager'
      ? (NATIONS[side.nation].mults.villagerTrain || 1) : 1;
    const total = (options.trainTime ?? def.trainTime) * nationMult;
    building.queue.push({ type: unitType, remaining: total, total });
    side.queuedPopulation += def.pop || 1;
    queued++;
  }
  if (queued === 0) {
    const capFull = !populationSpace(side, unitType);
    return {
      ok: false, queued: 0,
      message: capFull ? 'Population cap reached — build houses.' : `Need ${formatCost(def.cost)}.`,
    };
  }
  return { ok: true, queued, message: `${queued} ${def.label.toLowerCase()} queued.` };
}

export function setRallyPoint(building, x, y) {
  if (!building?.alive || !BUILDING_TYPES[building.type]?.trains) return false;
  building.rallyX = x;
  building.rallyY = y;
  return true;
}

function findTarget(world, targetId) {
  return world.resources.find(r => r.id === targetId)
    || world.buildings.find(b => b.id === targetId) || null;
}

function nearestPoint(target, worker) {
  const dx = worker.x - target.x;
  const dy = worker.y - target.y;
  const d = Math.hypot(dx, dy) || 1;
  const reach = target.radius + 7;
  return { x: target.x + dx / d * reach, y: target.y + dy / d * reach, distance: d };
}

function completeBuilding(world, building) {
  if (building.complete) return;
  building.complete = true;
  building.progress = 1;
  building.hp = building.maxHp;
  const def = BUILDING_TYPES[building.type];
  if (def.popCap) {
    const side = world.sides[building.side];
    side.popCap = Math.min(side.maxPopulation, side.popCap + def.popCap);
  }
  if (building.type === 'farm') {
    for (const worker of world.units) {
      if (worker.job?.kind === 'build' && worker.job.targetId === building.id) {
        worker.job = { kind: 'gather', targetId: building.id };
      }
    }
  }
  world.events.push({ side: building.side, text: `${def.label} completed.`, tone: 'good' });
}

function resourceMatchesBoost(boost, resourceType) {
  return boost === resourceType
    || (boost === 'mineral' && (resourceType === 'gold' || resourceType === 'stone'));
}

function findGatherBoostBuilding(world, worker, resourceType, x, y) {
  for (const building of world.buildings) {
    if (!building.alive || !building.complete || building.side !== worker.side) continue;
    if (Math.hypot(x - building.x, y - building.y) > 280) continue;
    if (resourceMatchesBoost(BUILDING_TYPES[building.type].boost, resourceType)) return building;
  }
  return null;
}

function gatherProfileAt(world, worker, target, x, y, resourceOverride = null) {
  const resourceType = resourceOverride || target?.resourceType;
  if (!resourceType || !GATHER_RATES[resourceType]) return null;
  let mult = 1;
  const nation = NATIONS[world.sides[worker.side].nation];
  if (resourceType === 'food' && target?.type === 'farm') mult *= nation.mults.farmRate || 1;
  const beforeBuildingBoost = mult;
  const boostBuilding = findGatherBoostBuilding(world, worker, resourceType, x, y);
  if (boostBuilding) mult *= 1.2;
  const basePerHour = GATHER_RATES[resourceType] * 3600;
  return {
    resourceType,
    target,
    worker,
    multiplier: mult,
    basePerHour,
    projectedPerHour: basePerHour * mult,
    boostBuildingId: boostBuilding?.id ?? null,
    boostBonusPerHour: boostBuilding ? basePerHour * beforeBuildingBoost * 0.2 : 0,
  };
}

function gatherProfile(world, worker) {
  if (worker.job?.kind !== 'gather' && worker.job?.kind !== 'workplace') return null;
  const target = findTarget(world, worker.job.targetId);
  if (!target?.alive) return null;
  if (worker.job.kind === 'workplace') {
    const workResources = BUILDING_TYPES[target.type]?.workResources || [];
    if (target.entityKind !== 'building' || !target.complete || target.side !== worker.side
      || !workResources.includes(worker.job.resourceType)) return null;
    return gatherProfileAt(
      world, worker, target, target.x, target.y, worker.job.resourceType,
    );
  }
  if (target.amount <= 0) return null;
  if (target.entityKind === 'building' && (!target.complete || target.side !== worker.side)) return null;
  return gatherProfileAt(world, worker, target, target.x, target.y);
}

export function getEconomyBreakdown(world, sideIndex, workers = null) {
  const result = Object.fromEntries(RESOURCE_KEYS.map(resourceType => [resourceType, {
    resourceType,
    workers: 0,
    projectedPerHour: 0,
    actualPerHour: world.sides[sideIndex].incomePerHour?.[resourceType] || 0,
    boostPerHour: 0,
  }]));
  const candidates = workers || world.units.filter(unit => unit.alive
    && unit.side === sideIndex && unit.type === 'villager');
  for (const worker of candidates) {
    if (!worker.alive || worker.side !== sideIndex || worker.type !== 'villager') continue;
    const profile = gatherProfile(world, worker);
    if (!profile) continue;
    const row = result[profile.resourceType];
    row.workers++;
    row.projectedPerHour += profile.projectedPerHour;
    row.boostPerHour += profile.boostBonusPerHour;
  }
  return result;
}

export function getGatherAssignmentStats(world, workers, target) {
  if (!target?.alive) return null;
  const workResources = target.entityKind === 'building'
    ? BUILDING_TYPES[target.type]?.workResources || [] : [];
  const isWorkplace = workResources.length > 0 && target.complete;
  const resourceType = isWorkplace
    ? workResources.reduce((best, resource) => {
      const side = world.sides[workers[0]?.side ?? target.side];
      return (side.resources[resource] || 0) < (side.resources[best] || 0) ? resource : best;
    }, workResources[0])
    : target.resourceType;
  if (!resourceType || (!isWorkplace && target.amount <= 0)) return null;
  const validWorkers = workers.filter(worker => worker.alive && worker.type === 'villager'
    && (target.entityKind !== 'building' || target.side === worker.side));
  let projectedPerHour = 0;
  for (const worker of validWorkers) {
    const profile = gatherProfileAt(world, worker, target, target.x, target.y, resourceType);
    projectedPerHour += profile?.projectedPerHour || 0;
  }
  return {
    resourceType,
    workers: validWorkers.length,
    projectedPerHour,
    amount: isWorkplace ? null : target.amount,
    renewable: isWorkplace,
    assignedWorkers: world.units.filter(worker => worker.alive && worker.type === 'villager'
      && worker.job?.targetId === target.id
      && (worker.job.kind === 'gather' || worker.job.kind === 'workplace')).length,
  };
}

export function getBuildingEconomyStats(world, building) {
  if (!building?.alive || !building.complete) return null;
  const def = BUILDING_TYPES[building.type];
  if (!building.resourceType && !def.boost && !def.workResources?.length) return null;
  const resources = Object.fromEntries(RESOURCE_KEYS.map(resourceType => [resourceType, {
    resourceType, workers: 0, projectedPerHour: 0, bonusPerHour: 0,
  }]));
  for (const worker of world.units) {
    if (!worker.alive || worker.side !== building.side || worker.type !== 'villager') continue;
    const profile = gatherProfile(world, worker);
    if (!profile) continue;
    const belongsToFarm = building.resourceType && profile.target.id === building.id;
    const employedHere = worker.job?.kind === 'workplace' && worker.job.targetId === building.id;
    const boostedHere = def.boost && profile.boostBuildingId === building.id;
    if (!belongsToFarm && !employedHere && !boostedHere) continue;
    const row = resources[profile.resourceType];
    row.workers++;
    row.projectedPerHour += profile.projectedPerHour;
    row.bonusPerHour += boostedHere ? profile.boostBonusPerHour : 0;
  }
  const activeResources = RESOURCE_KEYS.map(key => resources[key])
    .filter(row => row.workers > 0 || row.resourceType === building.resourceType
      || def.workResources?.includes(row.resourceType)
      || resourceMatchesBoost(def.boost, row.resourceType));
  return {
    buildingId: building.id,
    radius: def.boost ? 280 : 0,
    remaining: building.resourceType ? building.amount : null,
    resources: activeResources,
    workers: activeResources.reduce((sum, row) => sum + row.workers, 0),
    projectedPerHour: activeResources.reduce((sum, row) => sum + row.projectedPerHour, 0),
    bonusPerHour: activeResources.reduce((sum, row) => sum + row.bonusPerHour, 0),
  };
}

function updateWorkers(world, dt) {
  for (const worker of world.units) {
    if (!worker.alive || worker.type !== 'villager' || !worker.job) continue;
    const target = findTarget(world, worker.job.targetId);
    if (!target || !target.alive) {
      worker.job = null;
      worker.workAction = null;
      if (worker.state === 'work') worker.state = 'idle';
      continue;
    }
    if (worker.job.kind === 'build' && target.complete) {
      worker.job = target.type === 'farm' ? { kind: 'gather', targetId: target.id } : null;
      worker.workAction = resolveWorkerAction(worker.job, target);
      if (!worker.job && worker.state === 'work') worker.state = 'idle';
      continue;
    }
    const point = nearestPoint(target, worker);
    // Movement stops within five pixels of its assigned slot, so the work
    // threshold includes that tolerance and avoids workers orbiting a site.
    if (point.distance > target.radius + 16) {
      worker.orderX = point.x;
      worker.orderY = point.y;
      worker.state = 'move';
      worker.workAction = null;
      continue;
    }
    worker.orderX = NaN;
    worker.orderY = NaN;
    worker.state = 'work';
    worker.workAction = resolveWorkerAction(worker.job, target);
    if (Math.abs(target.x - worker.x) > 0.5) worker.facing = target.x > worker.x ? 1 : -1;
    worker.animT += dt * 1.4;

    if (worker.job.kind === 'build') {
      if (target.entityKind !== 'building' || target.complete) { worker.job = null; continue; }
      const def = BUILDING_TYPES[target.type];
      target.progress = Math.min(1, target.progress + dt / Math.max(1, def.buildTime));
      target.hp = Math.max(target.hp, target.maxHp * target.progress);
      if (target.progress >= 1) completeBuilding(world, target);
      continue;
    }

    if (worker.job.kind === 'gather') {
      const resourceType = target.resourceType;
      if (!resourceType || target.amount <= 0 || (target.entityKind === 'building' && !target.complete)) {
        worker.job = null;
        worker.workAction = null;
        worker.state = 'idle';
        continue;
      }
      const profile = gatherProfileAt(world, worker, target, worker.x, worker.y);
      const gathered = Math.min(target.amount, GATHER_RATES[resourceType] * (profile?.multiplier || 1) * dt);
      target.amount -= gathered;
      const side = world.sides[worker.side];
      side.resources[resourceType] += gathered;
      side.incomeSample[resourceType] += gathered;
      if (target.amount <= 0) {
        target.amount = 0;
        if (target.entityKind === 'resource') target.alive = false;
        worker.job = null;
        worker.workAction = null;
        worker.state = 'idle';
      }
      continue;
    }

    if (worker.job.kind === 'workplace') {
      const workResources = BUILDING_TYPES[target.type]?.workResources || [];
      const resourceType = worker.job.resourceType;
      if (target.entityKind !== 'building' || !target.complete || target.side !== worker.side
        || !workResources.includes(resourceType)) {
        worker.job = null;
        worker.workAction = null;
        worker.state = 'idle';
        continue;
      }
      const profile = gatherProfileAt(
        world, worker, target, worker.x, worker.y, resourceType,
      );
      const produced = GATHER_RATES[resourceType] * (profile?.multiplier || 1) * dt;
      const side = world.sides[worker.side];
      side.resources[resourceType] += produced;
      side.incomeSample[resourceType] += produced;
    }
  }
}

function updateIncomeTelemetry(world, dt) {
  for (const side of world.sides) {
    side.incomeSampleTime += dt;
    if (side.incomeSampleTime < 0.75) continue;
    for (const resourceType of RESOURCE_KEYS) {
      side.incomePerHour[resourceType] = side.incomeSample[resourceType]
        / side.incomeSampleTime * 3600;
      side.incomeSample[resourceType] = 0;
    }
    side.incomeSampleTime = 0;
  }
}

function spawnFromQueue(world, building, unitType) {
  const side = world.sides[building.side];
  side.queuedPopulation = Math.max(0, side.queuedPopulation - (UNIT_TYPES[unitType].pop || 1));
  const dir = building.side === 0 ? 1 : -1;
  const angle = Math.random() * Math.PI - Math.PI / 2;
  const x = building.x + dir * (building.radius + 24) + Math.cos(angle) * 18;
  const y = building.y + Math.sin(angle) * (building.radius + 14);
  const unit = world.spawnUnit(building.side, unitType, x, y);
  if (!Number.isNaN(building.rallyX)) {
    applyMoveOrder([unit], building.rallyX, building.rallyY, 'line');
  }
  if (unitType === 'villager') {
    world.events.push({ side: building.side, text: 'A villager is ready.', tone: 'good' });
  }
}

function updateQueues(world, dt) {
  for (const building of world.buildings) {
    if (!building.alive || !building.complete || building.queue.length === 0) continue;
    const item = building.queue[0];
    item.remaining -= dt;
    if (item.remaining <= 0) {
      building.queue.shift();
      spawnFromQueue(world, building, item.type);
    }
  }
}

function updateTowers(world, dt) {
  for (const tower of world.buildings) {
    if (!tower.alive || !tower.complete || tower.type !== 'tower') continue;
    const def = BUILDING_TYPES.tower;
    tower.reload -= dt;
    if (tower.reload > 0) continue;
    let target = null;
    let best = def.range;
    for (const unit of world.units) {
      if (!unit.alive || unit.side === tower.side) continue;
      const d = Math.hypot(unit.x - tower.x, unit.y - tower.y);
      if (d < best) { best = d; target = unit; }
    }
    if (!target) continue;
    tower.reload = def.reload;
    world.damage(target, def.attack, tower);
    world.projectiles.push({
      kind: 'tower', sx: tower.x, sy: tower.y - 42,
      x: tower.x, y: tower.y - 42, px: tower.x, py: tower.y - 42,
      tx: target.x, ty: target.y, t: 0, dur: Math.max(0.25, best / 520),
      arc: Math.min(45, best * 0.09), dmg: 0, splash: 0,
    });
  }
}

export function stepEconomy(world, dt) {
  updateWorkers(world, dt);
  updateIncomeTelemetry(world, dt);
  updateQueues(world, dt);
  updateTowers(world, dt);
}

export function onUnitKilled(world, unit) {
  const side = world.sides[unit.side];
  side.population = Math.max(0, side.population - (UNIT_TYPES[unit.type].pop || 1));
}

export function onBuildingDestroyed(world, building) {
  const side = world.sides[building.side];
  side.buildingsLost++;
  const def = BUILDING_TYPES[building.type];
  if (def.popCap && building.complete) side.popCap = Math.max(0, side.popCap - def.popCap);
  for (const item of building.queue) {
    const unit = UNIT_TYPES[item.type];
    side.queuedPopulation = Math.max(0, side.queuedPopulation - (unit.pop || 1));
    refundResources(side, unit.cost, 0.5);
  }
  building.queue.length = 0;
  for (const worker of world.units) {
    if (worker.job?.targetId === building.id) worker.job = null;
  }
}

export function findNearestResource(world, x, y, resourceType, side = null) {
  let best = null;
  let bestDistance = Infinity;
  const candidates = world.resources.concat(world.buildings.filter(b => b.type === 'farm'));
  for (const target of candidates) {
    if (!target.alive || target.amount <= 0 || target.resourceType !== resourceType) continue;
    if (target.entityKind === 'building' && (!target.complete || (side !== null && target.side !== side))) continue;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < bestDistance) { best = target; bestDistance = distance; }
  }
  return best;
}

export function findEntityAt(world, x, y, sideFilter = null) {
  let best = null;
  let bestDistance = Infinity;
  for (const unit of world.units) {
    if (!unit.alive || (sideFilter !== null && unit.side !== sideFilter)) continue;
    const distance = Math.hypot(unit.x - x, unit.y - y);
    if (distance <= unit.radius + 10 && distance < bestDistance) {
      best = unit; bestDistance = distance;
    }
  }
  for (const building of world.buildings) {
    if (!building.alive || (sideFilter !== null && building.side !== sideFilter)) continue;
    const distance = Math.hypot(building.x - x, building.y - y);
    if (distance <= building.radius && distance < bestDistance + 20) {
      best = building; bestDistance = distance;
    }
  }
  return best;
}

export function findResourceAt(world, x, y) {
  let best = null;
  let bestDistance = Infinity;
  const targets = world.resources.concat(world.buildings.filter(building => {
    const def = BUILDING_TYPES[building.type];
    return building.type === 'farm' || def.workResources?.length;
  }));
  for (const target of targets) {
    const isWorkplace = target.entityKind === 'building'
      && BUILDING_TYPES[target.type]?.workResources?.length;
    if (!target.alive || (target.entityKind === 'building' && !target.complete)
      || (!isWorkplace && target.amount <= 0)) continue;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= target.radius + 16 && distance < bestDistance) {
      best = target; bestDistance = distance;
    }
  }
  return best;
}
