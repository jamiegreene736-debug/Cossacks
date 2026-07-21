import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAttackOrder, applyMoveOrder } from '../js/formations.js';
import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { OPENING_PEACE_SECONDS } from '../js/truce.js';

function makeEmptyWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.time = OPENING_PEACE_SECONDS;
  world.buildings = [];
  world.resources = [];
  return world;
}

function spawnAlertPair(type, distance) {
  const world = makeEmptyWorld();
  const soldier = spawnUnit(world, 0, type, 2200, 1500);
  const enemy = spawnUnit(world, 1, 'musk', 2200 + distance, 1500);
  enemy.reload = 999;
  enemy.speed = 0;
  soldier.acquireT = 0;
  applyMoveOrder([soldier], 1800, 1500, 'line');
  return { world, soldier, enemy };
}

for (const [type, distance] of [
  ['musk', 240],
  ['pike', 150],
  ['cav', 250],
  ['gun', 700],
]) {
  test(`${type} soldiers interrupt a march to engage a nearby enemy`, () => {
    const { world, soldier, enemy } = spawnAlertPair(type, distance);
    const marchX = soldier.orderX;

    step(world, 1 / 30);

    assert.equal(soldier.target, enemy);
    assert.ok(soldier.x > 2200, `${type} should advance toward the nearby enemy`);
    assert.equal(soldier.orderX, marchX, 'the interrupted march destination remains available');
    assert.equal(soldier.facing, 1);
  });
}

test('an automatically acquired enemy is attacked without a focus-fire order', () => {
  const world = makeEmptyWorld();
  const soldier = spawnUnit(world, 0, 'musk', 2200, 1500);
  const enemy = spawnUnit(world, 1, 'musk', 2370, 1500);
  soldier.acquireT = 0;
  soldier.reload = 0;
  soldier.acc = 1;
  enemy.reload = 999;
  const startingHp = enemy.hp;
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    step(world, 1 / 30);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(soldier.orderTarget, null);
  assert.equal(soldier.target, enemy);
  assert.ok(enemy.hp < startingHp);
  assert.ok(soldier.fireT > 0, 'the existing musket firing animation is activated');
});

test('soldiers resume their interrupted march after the nearby threat falls', () => {
  const { world, soldier, enemy } = spawnAlertPair('musk', 240);
  step(world, 1 / 30);
  const engagedX = soldier.x;

  damage(world, enemy, enemy.maxHp + 1, soldier);
  step(world, 1 / 30);

  assert.equal(soldier.target, null);
  assert.ok(soldier.x < engagedX, 'the soldier resumes moving toward the original western waypoint');
  assert.equal(soldier.state, 'move');
});

test('an explicit attack order stays focused instead of switching to a nearer enemy', () => {
  const world = makeEmptyWorld();
  const soldier = spawnUnit(world, 0, 'musk', 2200, 1500);
  const orderedTarget = spawnUnit(world, 1, 'musk', 2500, 1500);
  const nearbyEnemy = spawnUnit(world, 1, 'musk', 2300, 1500);
  orderedTarget.reload = 999;
  nearbyEnemy.reload = 999;
  soldier.acquireT = 0;
  applyAttackOrder([soldier], orderedTarget);

  step(world, 1 / 30);

  assert.equal(soldier.orderTarget, orderedTarget);
  assert.equal(soldier.target, orderedTarget);
});

test('villagers still ignore nearby enemies until explicitly ordered to fight', () => {
  const world = makeEmptyWorld();
  const villager = spawnUnit(world, 0, 'villager', 2200, 1500);
  spawnUnit(world, 1, 'musk', 2300, 1500).reload = 999;
  villager.acquireT = 0;
  applyMoveOrder([villager], 1800, 1500, 'line');

  step(world, 1 / 30);

  assert.equal(villager.target, null);
  assert.ok(villager.x < 2200, 'the villager continues the move order instead of auto-engaging');
});
