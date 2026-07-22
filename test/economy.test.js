import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { Commander } from '../js/ai.js';
import { BUILDING_TYPES } from '../js/config.js';
import { OPENING_PEACE_SECONDS } from '../js/truce.js';
import {
  assignBuilders, assignGatherers, AUTO_BUILD_SEARCH_RADIUS,
  createBuilding, findNearestResource, findResourceAt, placeBuilding,
  getBuildingEconomyStats, getEconomyBreakdown, getFieldAttachmentStatus,
  getFieldWorkPoint, getGatherAssignmentStats, getMillFieldSlots,
  getRallyTarget, queueUnit, setRallyPoint, stepEconomy, validatePlacement,
  VILLAGER_CARRY_CAPACITY,
} from '../js/economy.js';

function makeWorld() {
  return createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
}

function advance(world, seconds) {
  const ticks = Math.ceil(seconds * 30);
  for (let i = 0; i < ticks; i++) step(world, 1 / 30);
}

test('a 2v2 skirmish starts with one Town Center per side and no units', () => {
  const world = makeWorld();
  const townCenters = world.buildings.filter(building => building.type === 'town_center');
  assert.equal(world.mode, '2v2');
  assert.equal(world.units.length, 0);
  assert.equal(townCenters.length, 4);
  assert.deepEqual(townCenters.map(building => building.side), [0, 1, 2, 3]);
  assert.deepEqual(world.sides.map(side => side.team), [0, 1, 0, 1]);
  assert.deepEqual(townCenters.map(townCenter => townCenter.queue[0].type), [
    'villager', 'villager', 'wizard_worker', 'circus_worker',
  ]);
  assert.ok(world.buildings.some(building => building.side === 2 && building.type === 'castle'));
  assert.ok(world.sides.every(side => side.population === 0));
});

test('the free first villager emerges and regular training spends resources', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const openingVillagers = world.units.filter(unit => unit.side === 0 && unit.type === 'villager');
  assert.equal(openingVillagers.length, 1);
  const townCenter = world.buildings.find(building => building.side === 0);
  assert.ok(
    Math.abs(openingVillagers[0].x - townCenter.x)
      > townCenter.w * BUILDING_TYPES.town_center.visualScale * 0.62,
    'the first villager should emerge beyond the displayed civic facade',
  );
  const result = queueUnit(world, townCenter, 'villager', 5);
  assert.equal(result.queued, 4);
  assert.equal(world.sides[0].resources.food, 40);
  assert.equal(world.sides[0].queuedPopulation, 4);
});

function clearOpeningQueue(world) {
  const townCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  world.sides[0].queuedPopulation = 0;
  townCenter.queue.length = 0;
  return townCenter;
}

function trainRalliedVillager(world, townCenter) {
  const result = queueUnit(world, townCenter, 'villager', 1, { free: true, trainTime: 0.01 });
  assert.equal(result.ok, true);
  stepEconomy(world, 0.02);
  return world.units.findLast(unit => unit.side === 0 && unit.type === 'villager');
}

test('Town Center resource rallies send newly trained villagers directly to gather', () => {
  const world = makeWorld();
  const townCenter = clearOpeningQueue(world);
  const forest = findNearestResource(world, townCenter.x, townCenter.y, 'wood', 0);

  assert.equal(setRallyPoint(townCenter, forest.x, forest.y, forest), true);
  assert.equal(getRallyTarget(world, townCenter), forest);
  const villager = trainRalliedVillager(world, townCenter);

  assert.deepEqual(villager.job, { kind: 'gather', targetId: forest.id });
  assert.equal(villager.workAction, 'chop');
  assert.equal(Number.isNaN(villager.orderX), true);
});

test('Town Center workplace and construction rallies automatically assign new villagers', () => {
  const world = makeWorld();
  const townCenter = clearOpeningQueue(world);
  const mine = createBuilding(0, 'mine', townCenter.x + 260, townCenter.y + 120, true);
  const house = createBuilding(0, 'house', townCenter.x + 320, townCenter.y - 140, false);
  world.buildings.push(mine, house);

  setRallyPoint(townCenter, mine.x, mine.y, mine);
  const miner = trainRalliedVillager(world, townCenter);
  assert.deepEqual(miner.job, { kind: 'workplace', targetId: mine.id, resourceType: 'gold' });
  assert.equal(miner.workAction, 'mine');

  setRallyPoint(townCenter, house.x, house.y, house);
  const builder = trainRalliedVillager(world, townCenter);
  assert.deepEqual(builder.job, { kind: 'build', targetId: house.id });
  assert.equal(builder.workAction, 'build');
});

test('builders automatically continue nearby unfinished structures but ignore distant work', () => {
  const world = makeWorld();
  const first = createBuilding(0, 'house', 1000, 1500, false);
  const nearbyWall = createBuilding(0, 'wall', 1260, 1500, false, { orientation: 'horizontal' });
  const distantHouse = createBuilding(
    0, 'house', nearbyWall.x + AUTO_BUILD_SEARCH_RADIUS + 80, 1500, false,
  );
  first.progress = 0.99;
  nearbyWall.progress = 0.99;
  world.buildings.push(first, nearbyWall, distantHouse);
  const worker = spawnUnit(world, 0, 'villager', first.x + first.radius + 5, first.y);

  assert.equal(assignBuilders(world, [worker], first), true);
  stepEconomy(world, 1);
  assert.equal(first.complete, true);
  stepEconomy(world, 0.01);
  assert.deepEqual(worker.job, { kind: 'build', targetId: nearbyWall.id });

  worker.x = nearbyWall.x + nearbyWall.radius + 5;
  worker.y = nearbyWall.y;
  stepEconomy(world, 1);
  assert.equal(nearbyWall.complete, true);
  stepEconomy(world, 0.01);
  assert.equal(worker.job, null);
  assert.equal(distantHouse.complete, false);
});

test('an explicit wall-run build queue takes priority over opportunistic nearby work', () => {
  const world = makeWorld();
  const first = createBuilding(0, 'wall', 1000, 1500, false, { orientation: 'horizontal' });
  const queuedWall = createBuilding(0, 'wall', 1350, 1500, false, { orientation: 'horizontal' });
  const closerHouse = createBuilding(0, 'house', 1120, 1500, false);
  first.progress = 0.99;
  world.buildings.push(first, queuedWall, closerHouse);
  const worker = spawnUnit(world, 0, 'villager', first.x + first.radius + 5, first.y);
  worker.job = { kind: 'build', targetId: first.id, queue: [queuedWall.id] };

  stepEconomy(world, 1);
  stepEconomy(world, 0.01);

  assert.equal(first.complete, true);
  assert.deepEqual(worker.job, { kind: 'build', targetId: queuedWall.id, queue: [] });
  assert.equal(closerHouse.complete, false);
});

test('ordinary buildings remain waypoints and invalid rally targets fall back to their saved position', () => {
  const world = makeWorld();
  const townCenter = clearOpeningQueue(world);
  const mill = createBuilding(0, 'mill', townCenter.x + 260, townCenter.y, true);
  world.buildings.push(mill);

  setRallyPoint(townCenter, mill.x, mill.y, mill);
  const walker = trainRalliedVillager(world, townCenter);
  assert.equal(walker.job, null);
  assert.equal(walker.state, 'move');
  assert.ok(walker.navigationPath?.length > 0);

  const forest = findNearestResource(world, townCenter.x, townCenter.y, 'wood', 0);
  setRallyPoint(townCenter, forest.x, forest.y, forest);
  forest.amount = 0;
  forest.alive = false;
  assert.equal(getRallyTarget(world, townCenter), null);
  const fallback = trainRalliedVillager(world, townCenter);
  assert.equal(fallback.job, null);
  assert.equal(fallback.orderX, forest.x);
  assert.equal(fallback.orderY, forest.y);
});

test('villagers carry gathered resources to the Town Center before the stockpile increases', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const berries = findNearestResource(world, worker.x, worker.y, 'food', 0);
  const townCenter = world.buildings.find(building => building.side === 0
    && building.type === 'town_center');
  const beforeFood = world.sides[0].resources.food;
  const beforeDeposit = berries.amount;
  worker.x = berries.x + berries.radius + 5;
  worker.y = berries.y;
  assert.equal(assignGatherers(world, [worker], berries), true);
  stepEconomy(world, 1);
  assert.equal(world.sides[0].resources.food, beforeFood);
  assert.ok(berries.amount < beforeDeposit);
  assert.ok(berries.amount >= 0);
  assert.ok(worker.job.carriedAmount > 0);

  stepEconomy(world, 1);
  assert.equal(worker.job.phase, 'deliver');
  assert.equal(worker.job.dropoffId, townCenter.id);
  assert.equal(worker.job.carriedAmount, VILLAGER_CARRY_CAPACITY);

  worker.x = townCenter.x + townCenter.radius + 5;
  worker.y = townCenter.y;
  stepEconomy(world, 0.01);
  assert.equal(world.sides[0].resources.food, beforeFood + VILLAGER_CARRY_CAPACITY);
  assert.deepEqual(worker.job, { kind: 'gather', targetId: berries.id });

  stepEconomy(world, 0.01);
  assert.equal(worker.state, 'move');
  assert.ok(Number.isFinite(worker.orderX));
});

test('the Town Center accepts carried food, wood, gold, and stone as the universal fallback', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const townCenter = world.buildings.find(building => building.side === 0
    && building.type === 'town_center');

  for (const resourceType of ['food', 'wood', 'gold', 'stone']) {
    const source = findNearestResource(world, worker.x, worker.y, resourceType, 0);
    const before = world.sides[0].resources[resourceType];
    worker.x = source.x + source.radius + 5;
    worker.y = source.y;
    assignGatherers(world, [worker], source);
    stepEconomy(world, 2);
    assert.equal(worker.job.dropoffId, townCenter.id);

    worker.x = townCenter.x + townCenter.radius + 5;
    worker.y = townCenter.y;
    stepEconomy(world, 0.01);
    assert.equal(world.sides[0].resources[resourceType], before + VILLAGER_CARRY_CAPACITY);
  }
});

test('natural stone deliveries update the stockpile and remain visible in hourly telemetry', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0 && unit.type === 'villager');
  const stone = findNearestResource(world, worker.x, worker.y, 'stone', 0);
  const townCenter = world.buildings.find(building => building.side === 0
    && building.type === 'town_center');
  const side = world.sides[0];
  const startingStone = side.resources.stone;

  assert.equal(assignGatherers(world, [worker], stone), true);
  for (let tick = 0; tick < 30 * 30 && side.resources.stone === startingStone; tick++) {
    step(world, 1 / 30);
  }

  assert.equal(side.resources.stone, startingStone + VILLAGER_CARRY_CAPACITY);
  advance(world, 0.75);
  assert.ok(side.incomePerHour.stone > 0, 'the rolling receipt rate remains visible after delivery');
  const stats = getBuildingEconomyStats(world, townCenter);
  const stoneStats = stats.resources.find(row => row.resourceType === 'stone');
  assert.equal(stoneStats.workers, 1);
  assert.equal(stoneStats.projectedPerHour, 18_720);
  assert.equal(stoneStats.actualPerHour, side.incomePerHour.stone);
});

test('food, wood, gold, and stone use their nearer specialized drop-off buildings', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const cases = [
    ['food', 'mill'],
    ['wood', 'lumber_camp'],
    ['gold', 'mine'],
    ['stone', 'mine'],
  ];

  for (const [resourceType, buildingType] of cases) {
    const source = findNearestResource(world, worker.x, worker.y, resourceType, 0);
    const dropoff = createBuilding(
      0, buildingType, source.x + source.radius + 90, source.y, true,
    );
    world.buildings.push(dropoff);
    const before = world.sides[0].resources[resourceType];
    worker.x = source.x + source.radius + 5;
    worker.y = source.y;
    assert.equal(assignGatherers(world, [worker], source), true);

    stepEconomy(world, 2);
    assert.equal(worker.job.phase, 'deliver');
    assert.equal(worker.job.resourceType, resourceType);
    assert.equal(worker.job.dropoffId, dropoff.id);

    worker.x = dropoff.x + dropoff.radius + 5;
    worker.y = dropoff.y;
    stepEconomy(world, 0.01);
    assert.equal(world.sides[0].resources[resourceType], before + VILLAGER_CARRY_CAPACITY);
    assert.deepEqual(worker.job, { kind: 'gather', targetId: source.id });
  }
});

test('an attached field always delivers food to its mill and resumes farming', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const mill = createBuilding(0, 'mill', 1150, 1600, true);
  const slot = getMillFieldSlots(mill)[0];
  const field = createBuilding(0, 'farm', slot.x, slot.y, true, slot);
  world.buildings.push(mill, field);
  const workPoint = getFieldWorkPoint(field, worker.id);
  worker.x = workPoint.x;
  worker.y = workPoint.y;
  assignGatherers(world, [worker], field);

  stepEconomy(world, 1);
  assert.equal(worker.job.phase, 'deliver');
  assert.equal(worker.job.dropoffId, mill.id);
  worker.x = mill.x + mill.radius + 5;
  worker.y = mill.y;
  stepEconomy(world, 0.01);
  assert.deepEqual(worker.job, { kind: 'gather', targetId: field.id });
});

test('a destroyed specialized drop-off reroutes a carried load to the Town Center', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const forest = findNearestResource(world, worker.x, worker.y, 'wood', 0);
  const camp = createBuilding(0, 'lumber_camp', forest.x + forest.radius + 90, forest.y, true);
  const townCenter = world.buildings.find(building => building.side === 0
    && building.type === 'town_center');
  world.buildings.push(camp);
  worker.x = forest.x + forest.radius + 5;
  worker.y = forest.y;
  assignGatherers(world, [worker], forest);
  stepEconomy(world, 2);
  assert.equal(worker.job.dropoffId, camp.id);

  camp.alive = false;
  stepEconomy(world, 0.01);
  assert.equal(worker.job.dropoffId, townCenter.id);
  assert.equal(worker.job.carriedAmount, VILLAGER_CARRY_CAPACITY);
});

test('an exhausted source delivers its final partial load without becoming negative', () => {
  const world = makeWorld();
  advance(world, 4.1);
  const worker = world.units.find(unit => unit.side === 0);
  const berries = findNearestResource(world, worker.x, worker.y, 'food', 0);
  const townCenter = world.buildings.find(building => building.side === 0
    && building.type === 'town_center');
  berries.amount = 3;
  worker.x = berries.x + berries.radius + 5;
  worker.y = berries.y;
  const beforeFood = world.sides[0].resources.food;
  assignGatherers(world, [worker], berries);
  stepEconomy(world, 1);
  assert.equal(berries.amount, 0);
  assert.equal(berries.alive, false);
  assert.equal(worker.job.carriedAmount, 3);

  worker.x = townCenter.x + townCenter.radius + 5;
  worker.y = townCenter.y;
  stepEconomy(world, 0.01);
  assert.equal(world.sides[0].resources.food, beforeFood + 3);
  assert.equal(worker.job, null);
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
  const beforeFood = world.sides[0].resources.food;
  stepEconomy(world, 2);
  assert.equal(world.sides[0].resources.food, beforeFood);
  const townCenter = world.buildings.find(building => building.side === 0
    && building.type === 'town_center');
  worker.x = townCenter.x + townCenter.radius + 5;
  worker.y = townCenter.y;
  world.sides[0].incomeSampleTime = 0;
  stepEconomy(world, 0.75);
  const breakdown = getEconomyBreakdown(world, 0);
  assert.equal(breakdown.food.workers, 1);
  assert.equal(breakdown.food.projectedPerHour, 30_600);
  assert.ok(breakdown.food.actualPerHour > 0);
  assert.ok(breakdown.food.actualPerHour < 48_000);
  assert.equal(breakdown.wood.actualPerHour, 0);

  const sampledRate = breakdown.food.actualPerHour;
  stepEconomy(world, 0.75);
  assert.ok(world.sides[0].incomePerHour.food > 0);
  assert.ok(world.sides[0].incomePerHour.food < sampledRate);
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

  const mill = createBuilding(0, 'mill', 1150, 1600, true);
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
  assert.equal(validatePlacement(world, 0, 'house', 660, 1152).ok, false);
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
  for (const building of world.buildings.filter(candidate => candidate.type === 'town_center')) {
    building.queue.length = 0;
  }
  for (const side of world.sides) side.queuedPopulation = 0;
  for (let i = 0; i < 520; i++) {
    spawnUnit(world, 0, i % 5 === 0 ? 'pike' : 'musk', 1800 + (i % 26) * 12, 900 + ((i / 26) | 0) * 14);
    spawnUnit(world, 1, i % 6 === 0 ? 'cav' : 'musk', 3100 - (i % 26) * 12, 900 + ((i / 26) | 0) * 14);
  }
  advance(world, 2);
  assert.equal(world.units.length, 1040);
  assert.equal(world.state, 'running');
  assert.ok(world.units.every(unit => Number.isFinite(unit.x) && Number.isFinite(unit.y)));
});

test('destroying both rival Town Centers decides the 2v2 match', () => {
  const world = makeWorld();
  const firstRivalTownCenter = world.buildings.find(building => building.side === 1);
  const secondRivalTownCenter = world.buildings.find(building => building.side === 3);
  damage(world, firstRivalTownCenter, firstRivalTownCenter.maxHp + 1, null);
  step(world, 1 / 30);
  // Victory checks are intentionally staggered to avoid per-tick scans.
  advance(world, 1.1);
  assert.equal(world.state, 'running');
  assert.equal(world.winner, -1);

  damage(world, secondRivalTownCenter, secondRivalTownCenter.maxHp + 1, null);
  advance(world, 1.1);
  assert.equal(world.state, 'ended');
  assert.equal(world.winner, 0);
});

test('hostile soldiers mark building damage for siege ambience without treating villagers as attackers', () => {
  const world = makeWorld();
  const building = world.buildings.find(candidate => candidate.side === 1);
  const soldier = spawnUnit(world, 0, 'pike', building.x - 40, building.y);
  const villager = spawnUnit(world, 0, 'villager', building.x - 30, building.y);
  world.time = OPENING_PEACE_SECONDS + 12.5;

  damage(world, building, 10, villager);
  assert.equal(building.lastHostileUnitDamageAt, undefined);
  damage(world, building, 10, soldier);
  assert.equal(building.lastHostileUnitDamageAt, OPENING_PEACE_SECONDS + 12.5);
  assert.equal(building.lastHostileUnitSide, 0);
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
