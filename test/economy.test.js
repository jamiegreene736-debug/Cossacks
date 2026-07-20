import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { Commander } from '../js/ai.js';
import {
  assignGatherers, createBuilding, findNearestResource, findResourceAt, placeBuilding,
  getBuildingEconomyStats, getEconomyBreakdown, getFieldAttachmentStatus,
  getFieldWorkPoint, getGatherAssignmentStats, getMillFieldSlots,
  queueUnit, stepEconomy, validatePlacement,
} from '../js/economy.js';

function makeWorld() {
  return createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
}

function advance(world, seconds) {
  const ticks = Math.ceil(seconds * 30);
  for (let i = 0; i < ticks; i++) step(world, 1 / 30);
}

test('a skirmish starts with exactly one Town Center per side and no units', () => {
  const world = makeWorld();
  assert.equal(world.units.length, 0);
  assert.deepEqual(world.buildings.map(building => building.type), ['town_center', 'town_center']);
  assert.equal(world.buildings[0].queue[0].type, 'villager');
  assert.equal(world.sides[0].population, 0);
});

test('the free first villager emerges and regular training spends resources', () => {
  const world = makeWorld();
  advance(world, 4.1);
  assert.equal(world.units.filter(unit => unit.side === 0 && unit.type === 'villager').length, 1);
  const townCenter = world.buildings.find(building => building.side === 0);
  const result = queueUnit(world, townCenter, 'villager', 5);
  assert.equal(result.queued, 4);
  assert.equal(world.sides[0].resources.food, 40);
  assert.equal(world.sides[0].queuedPopulation, 4);
});

test('villagers gather from deposits without allowing resource values to go negative', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const berries = findNearestResource(world, worker.x, worker.y, 'food', 0);
  const beforeFood = world.sides[0].resources.food;
  const beforeDeposit = berries.amount;
  worker.x = berries.x + berries.radius + 5;
  worker.y = berries.y;
  assert.equal(assignGatherers(world, [worker], berries), true);
  stepEconomy(world, 1);
  assert.ok(world.sides[0].resources.food > beforeFood);
  assert.ok(berries.amount < beforeDeposit);
  assert.ok(berries.amount >= 0);
});

test('arriving workers face their target and expose the matching work animation', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const targets = [
    [findNearestResource(world, worker.x, worker.y, 'wood', 0), 'chop'],
    [findNearestResource(world, worker.x, worker.y, 'stone', 0), 'mine'],
    [findNearestResource(world, worker.x, worker.y, 'gold', 0), 'mine'],
    [findNearestResource(world, worker.x, worker.y, 'food', 0), 'forage'],
  ];
  const mill = createBuilding(0, 'mill', 900, 1600, true);
  const farmSlot = getMillFieldSlots(mill)[3];
  const farm = createBuilding(0, 'farm', farmSlot.x, farmSlot.y, true, farmSlot);
  world.buildings.push(mill, farm);
  targets.push([farm, 'farm']);

  for (const [target, expectedAction] of targets) {
    const workPoint = target.type === 'farm' ? getFieldWorkPoint(target, worker.id) : null;
    worker.x = workPoint?.x ?? target.x - target.radius - 5;
    worker.y = workPoint?.y ?? target.y;
    worker.facing = -1;
    assert.equal(assignGatherers(world, [worker], target), true);
    stepEconomy(world, 1 / 30);
    assert.equal(worker.state, 'work');
    assert.equal(worker.workAction, expectedAction);
    assert.equal(worker.facing, target.type === 'farm' ? (worker.id % 2 ? 1 : -1) : 1);
  }
});

test('economy telemetry separates assigned hourly output from sampled live income', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const berries = findNearestResource(world, worker.x, worker.y, 'food', 0);
  worker.x = berries.x + berries.radius + 5;
  worker.y = berries.y;
  assert.equal(assignGatherers(world, [worker], berries), true);

  const preview = getGatherAssignmentStats(world, [worker], berries);
  assert.equal(preview.workers, 1);
  assert.equal(preview.projectedPerHour, 30_600);

  world.sides[0].incomeSampleTime = 0;
  world.sides[0].incomeSample = { food: 0, wood: 0, gold: 0, stone: 0 };
  stepEconomy(world, 0.75);
  const breakdown = getEconomyBreakdown(world, 0);
  assert.equal(breakdown.food.workers, 1);
  assert.equal(breakdown.food.projectedPerHour, 30_600);
  assert.ok(Math.abs(breakdown.food.actualPerHour - 30_600) < 0.001);
  assert.equal(breakdown.wood.actualPerHour, 0);
});

test('economic-building readouts attribute workers and the exact 20% local bonus', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const berries = findNearestResource(world, worker.x, worker.y, 'food', 0);
  const mill = createBuilding(0, 'mill', berries.x + 180, berries.y, true);
  world.buildings.push(mill);
  worker.x = berries.x + berries.radius + 5;
  worker.y = berries.y;
  assignGatherers(world, [worker], berries);

  const stats = getBuildingEconomyStats(world, mill);
  assert.equal(stats.workers, 1);
  assert.equal(stats.resources[0].resourceType, 'food');
  assert.equal(stats.resources[0].projectedPerHour, 36_720);
  assert.ok(Math.abs(stats.resources[0].bonusPerHour - 6_120) < 0.001);
});

test('completed non-farm economic buildings accept villagers as renewable workplaces', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const camp = createBuilding(0, 'lumber_camp', worker.x + 120, worker.y, true);
  world.buildings.push(camp);
  worker.x = camp.x + camp.radius + 5;
  worker.y = camp.y;
  const beforeWood = world.sides[0].resources.wood;

  assert.equal(findResourceAt(world, camp.x, camp.y), camp);
  assert.equal(assignGatherers(world, [worker], camp), true);
  assert.deepEqual(worker.job, { kind: 'workplace', targetId: camp.id, resourceType: 'wood' });

  const preview = getGatherAssignmentStats(world, [worker], camp);
  assert.equal(preview.renewable, true);
  assert.equal(preview.resourceType, 'wood');
  assert.equal(preview.projectedPerHour, 32_400);

  stepEconomy(world, 1);
  assert.ok(world.sides[0].resources.wood > beforeWood);
  const stats = getBuildingEconomyStats(world, camp);
  assert.equal(stats.workers, 1);
  assert.equal(stats.resources.find(row => row.resourceType === 'wood').projectedPerHour, 32_400);
});

test('fields require a completed mill, snap to its plots, and store the parent link', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  assert.equal(validatePlacement(world, 0, 'farm', 900, 1500).ok, false);
  assert.match(validatePlacement(world, 0, 'farm', 900, 1500).message, /Mill first/);

  const mill = createBuilding(0, 'mill', 980, 1600, true);
  world.buildings.push(mill);
  const requested = { x: mill.x + 12, y: mill.y - 145 };
  const preview = validatePlacement(world, 0, 'farm', requested.x, requested.y);
  assert.equal(preview.ok, true);
  assert.equal(preview.millId, mill.id);
  assert.equal(preview.fieldSlot, 0);
  assert.notDeepEqual({ x: preview.x, y: preview.y }, requested);

  const result = placeBuilding(world, 0, 'farm', requested.x, requested.y, [worker]);
  assert.equal(result.ok, true);
  assert.equal(result.building.millId, mill.id);
  assert.equal(result.building.fieldSlot, 0);
  assert.match(result.message, /attached to Mill/);
});

test('a mill exposes eight field plots and another mill is required when they are full', () => {
  const world = makeWorld();
  const mill = createBuilding(0, 'mill', 1000, 1600, true);
  world.buildings.push(mill);
  for (const slot of getMillFieldSlots(mill)) {
    world.buildings.push(createBuilding(0, 'farm', slot.x, slot.y, true, slot));
  }
  assert.equal(getFieldAttachmentStatus(world, 0).ok, false);
  assert.match(getFieldAttachmentStatus(world, 0).message, /another Mill/);
  assert.equal(validatePlacement(world, 0, 'farm', mill.x, mill.y).ok, false);
});

test('farmers walk to stable work rows inside an attached field', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const mill = createBuilding(0, 'mill', 980, 1600, true);
  const slot = getMillFieldSlots(mill)[2];
  const field = createBuilding(0, 'farm', slot.x, slot.y, true, slot);
  world.buildings.push(mill, field);
  worker.x = field.x - 80;
  worker.y = field.y;
  const destination = getFieldWorkPoint(field, worker.id);
  assert.equal(assignGatherers(world, [worker], field), true);
  for (let tick = 0; tick < 480 && worker.state !== 'work'; tick++) step(world, 1 / 30);
  assert.equal(worker.state, 'work');
  assert.equal(worker.workAction, 'farm');
  assert.ok(Math.hypot(worker.x - destination.x, worker.y - destination.y) <= 5);
  assert.ok(Math.abs(worker.x - field.x) < field.w * 0.45);
  assert.ok(Math.abs(worker.y - field.y) < field.h * 0.4);
  assert.equal(assignGatherers(world, [worker], mill), false);
});

test('destroying a mill removes its attached fields and releases their farmers', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const mill = createBuilding(0, 'mill', 980, 1600, true);
  const slot = getMillFieldSlots(mill)[1];
  const field = createBuilding(0, 'farm', slot.x, slot.y, true, slot);
  world.buildings.push(mill, field);
  assignGatherers(world, [worker], field);

  damage(world, mill, mill.maxHp + 1, null);

  assert.equal(field.alive, false);
  assert.equal(worker.job, null);
  assert.ok(world.events.some(event => /attached field lost with the Mill/.test(event.text)));
});

test('construction validates collisions, consumes costs, and expands population on completion', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  assert.equal(validatePlacement(world, 0, 'house', 660, 1600).ok, false);
  const result = placeBuilding(world, 0, 'house', 835, 1765, [worker]);
  assert.equal(result.ok, true);
  assert.equal(world.sides[0].resources.wood, 250);
  const house = result.building;
  worker.x = house.x + house.radius + 5;
  worker.y = house.y;
  for (let i = 0; i < 300; i++) stepEconomy(world, 1 / 30);
  assert.equal(house.complete, true);
  assert.equal(world.sides[0].popCap, 80);
});

test('bulk queues reserve population and can produce Cossacks-scale regiments', () => {
  const world = makeWorld();
  const side = world.sides[0];
  side.resources = { food: 100000, wood: 100000, gold: 100000, stone: 100000 };
  side.popCap = 1200;
  const barracks = createBuilding(0, 'barracks', 900, 1600, true);
  world.buildings.push(barracks);
  const queued = queueUnit(world, barracks, 'musk', 50);
  assert.equal(queued.queued, 50);
  assert.equal(side.queuedPopulation, 51); // includes the free first villager
  for (let i = 0; i < 5000; i++) stepEconomy(world, 1 / 30);
  assert.equal(world.units.filter(unit => unit.side === 0 && unit.type === 'musk').length, 50);
  assert.equal(side.queuedPopulation, 0);
});

test('mass-unit combat stepping remains stable with more than one thousand soldiers', () => {
  const world = makeWorld();
  world.buildings[0].queue.length = 0;
  world.buildings[1].queue.length = 0;
  world.sides[0].queuedPopulation = 0;
  world.sides[1].queuedPopulation = 0;
  for (let i = 0; i < 520; i++) {
    spawnUnit(world, 0, i % 5 === 0 ? 'pike' : 'musk', 1800 + (i % 26) * 12, 900 + ((i / 26) | 0) * 14);
    spawnUnit(world, 1, i % 6 === 0 ? 'cav' : 'musk', 3100 - (i % 26) * 12, 900 + ((i / 26) | 0) * 14);
  }
  advance(world, 2);
  assert.equal(world.units.length, 1040);
  assert.equal(world.state, 'running');
  assert.ok(world.units.every(unit => Number.isFinite(unit.x) && Number.isFinite(unit.y)));
});

test('destroying a Town Center decides the match', () => {
  const world = makeWorld();
  const enemyTownCenter = world.buildings.find(building => building.side === 1);
  damage(world, enemyTownCenter, enemyTownCenter.maxHp + 1, null);
  step(world, 1 / 30);
  // Victory checks are intentionally staggered to avoid per-tick scans.
  advance(world, 1.1);
  assert.equal(world.state, 'ended');
  assert.equal(world.winner, 0);
});

test('the rival grows an economy and fields an army through normal production', () => {
  const world = makeWorld();
  const playerTownCenter = world.buildings.find(building => building.side === 0);
  playerTownCenter.hp = playerTownCenter.maxHp = 1_000_000;
  const commander = new Commander(world, 1);
  for (let i = 0; i < 7200; i++) {
    step(world, 1 / 30);
    commander.update(1 / 30);
  }
  const completedBarracks = world.buildings.some(building => building.alive
    && building.side === 1 && building.type === 'barracks' && building.complete);
  const enemyMilitary = world.units.filter(unit => unit.alive
    && unit.side === 1 && unit.type !== 'villager').length;
  assert.equal(completedBarracks, true);
  assert.ok(world.units.filter(unit => unit.alive && unit.side === 1 && unit.type === 'villager').length >= 10);
  assert.ok(enemyMilitary >= 10);
});
