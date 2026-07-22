import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander, updateDeferredAiOrders } from '../js/ai.js';
import { createBuilding, stepEconomy } from '../js/economy.js';
import { applyAttackOrder } from '../js/formations.js';
import {
  getVillagerAttackTargetAt, issuePrimaryUnitCommand, issueVillagerAttack,
} from '../js/input.js';
import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { areAlliedSides, areHostileSides } from '../js/teams.js';
import {
  formatPeaceTime, isPeaceTime, OPENING_PEACE_SECONDS, peaceTimeRemaining,
} from '../js/truce.js';

function makeWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.buildings = [];
  world.resources = [];
  return world;
}

test('the opening peace counts down from exactly ten simulation minutes', () => {
  const world = makeWorld();
  assert.equal(isPeaceTime(world), true);
  assert.equal(peaceTimeRemaining(world), 600);
  assert.equal(formatPeaceTime(world), '10:00');

  world.time = 60.2;
  assert.equal(formatPeaceTime(world), '9:00');
  world.state = 'paused';
  step(world, 20);
  assert.equal(world.time, 60.2, 'pausing freezes the peace countdown');

  world.time = OPENING_PEACE_SECONDS;
  assert.equal(isPeaceTime(world), false);
  assert.equal(formatPeaceTime(world), '0:00');
});

test('legacy even-side fallback keeps the extra ally on the player team', () => {
  const world = { sides: [{}, {}, {}, {}, {}] };

  assert.equal(areAlliedSides(world, 0, 4), true);
  assert.equal(areHostileSides(world, 4, 1), true);
});

test('hostile orders, acquisition, projectiles, and damage are disarmed during peace', () => {
  const world = makeWorld();
  const attacker = spawnUnit(world, 0, 'musk', 1000, 1500);
  const villager = spawnUnit(world, 0, 'villager', 980, 1500);
  const target = spawnUnit(world, 1, 'musk', 1100, 1500);
  const startingHp = target.hp;
  attacker.acquireT = 0;
  applyAttackOrder([attacker], target);
  attacker.deferredAttack = { target, at: 0 };
  world.projectiles.push({ kind: 'tower', t: 0, dur: 1 });

  assert.equal(issuePrimaryUnitCommand(world, [attacker], target.x, target.y), true);
  assert.equal(getVillagerAttackTargetAt(world, [villager], target.x, target.y), null);
  assert.equal(issueVillagerAttack(world, [villager], target), 0);
  assert.equal(damage(world, target, 10, attacker), false);
  step(world, 1 / 30);

  assert.equal(target.hp, startingHp);
  assert.equal(attacker.target, null);
  assert.equal(attacker.orderTarget, null);
  assert.equal(attacker.deferredAttack, null);
  assert.equal(world.projectiles.length, 0);
});

test('CPU attacks and defensive cannon fire remain locked until peace ends', () => {
  const world = makeWorld();
  const defender = spawnUnit(world, 1, 'musk', 1200, 1500);
  const invader = spawnUnit(world, 0, 'musk', 1250, 1500);
  defender.deferredAttack = { target: invader, at: 0 };
  const tower = createBuilding(1, 'tower', 1200, 1500, true);
  tower.reload = 0;
  world.buildings.push(tower);
  const commander = new Commander(world, 1);
  const attackTimer = commander.attackTimer;

  commander.update(1);
  updateDeferredAiOrders(world);
  stepEconomy(world, 1);

  assert.equal(commander.attackTimer, attackTimer, 'CPU attack delay starts after the treaty');
  assert.equal(defender.orderTarget, null);
  assert.equal(world.projectiles.length, 0);
});

test('combat unlocks on the exact boundary and announces the transition once', () => {
  const world = makeWorld();
  const attacker = spawnUnit(world, 0, 'musk', 1000, 1500);
  const target = spawnUnit(world, 1, 'musk', 1100, 1500);
  world.time = OPENING_PEACE_SECONDS - 0.01;

  step(world, 0.02);
  assert.equal(isPeaceTime(world), false);
  assert.equal(world.events.filter(event => event.text.includes('peace has ended')).length, world.sides.length);
  assert.equal(damage(world, target, 10, attacker), true);
  assert.equal(target.hp, target.maxHp - 10);

  step(world, 1);
  assert.equal(world.events.filter(event => event.text.includes('peace has ended')).length, world.sides.length);
});
