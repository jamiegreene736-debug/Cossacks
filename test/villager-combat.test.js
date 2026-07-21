import test from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_TYPES } from '../js/config.js';
import { createBuilding } from '../js/economy.js';
import { applyAttackOrder } from '../js/formations.js';
import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { OPENING_PEACE_SECONDS } from '../js/truce.js';

function makeWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.time = OPENING_PEACE_SECONDS;
  return world;
}

test('civilian muskets are deliberately weaker and never auto-acquire enemies', () => {
  const villagerStats = UNIT_TYPES.villager;
  const soldierStats = UNIT_TYPES.musk;
  assert.ok(villagerStats.dmg < soldierStats.dmg);
  assert.ok(villagerStats.range < soldierStats.range);
  assert.ok(villagerStats.reload > soldierStats.reload);
  assert.ok(villagerStats.acc < soldierStats.acc);
  assert.equal(villagerStats.acquire, 0);

  const world = makeWorld();
  const villager = spawnUnit(world, 0, 'villager', 2400, 1500);
  spawnUnit(world, 1, 'musk', 2500, 1500);
  villager.acquireT = 0;
  step(world, 1 / 30);
  assert.equal(villager.target, null, 'villagers only arm when the player explicitly orders an attack');
});

test('an explicit order makes a villager advance, face, and fire at a soldier', () => {
  const world = makeWorld();
  const villager = spawnUnit(world, 0, 'villager', 2200, 1500);
  const enemy = spawnUnit(world, 1, 'musk', 2600, 1500);
  applyAttackOrder([villager], enemy);

  for (let index = 0; index < 60; index++) step(world, 1 / 30);
  assert.ok(villager.x > 2200, 'the villager advances toward musket range');
  assert.equal(villager.facing, 1);
  assert.equal(villager.orderTarget, enemy);

  villager.x = enemy.x - 100;
  villager.px = villager.x;
  villager.reload = 0;
  const startingHp = enemy.hp;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    step(world, 1 / 30);
  } finally {
    Math.random = originalRandom;
  }
  const dealt = startingHp - enemy.hp;
  assert.ok(dealt > 0 && dealt < UNIT_TYPES.musk.dmg, `expected reduced civilian damage, received ${dealt}`);
  assert.ok(villager.fireT > 0);
  assert.ok(villager.reload > UNIT_TYPES.musk.reload);
});

test('villagers can damage enemy buildings and holster after a target falls', () => {
  const world = makeWorld();
  const villager = spawnUnit(world, 0, 'villager', 2400, 1500);
  const building = createBuilding(1, 'house', 2510, 1500, true);
  world.buildings.push(building);
  applyAttackOrder([villager], building);
  villager.reload = 0;

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    step(world, 1 / 30);
  } finally {
    Math.random = originalRandom;
  }
  assert.ok(building.hp < building.maxHp);

  damage(world, building, building.maxHp + 1, villager);
  step(world, 1 / 30);
  assert.equal(villager.orderTarget, null);
  assert.equal(villager.state, 'idle');
});
