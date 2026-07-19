import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { Commander } from '../js/ai.js';
import {
  assignGatherers, createBuilding, findNearestResource, placeBuilding,
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
