import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILDING_TYPES } from '../js/config.js';
import { createBuilding, stepEconomy } from '../js/economy.js';
import { visibleTowerAttackRange } from '../js/gfx/composite.js';
import { createWorld, spawnUnit, step } from '../js/sim.js';

function advance(world, seconds) {
  const ticks = Math.ceil(seconds * 30);
  for (let index = 0; index < ticks; index++) step(world, 1 / 30);
}

function makeTowerEngagement(distance = 240) {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const tower = createBuilding(0, 'tower', 1200, 1500, true);
  tower.reload = 0;
  world.buildings.push(tower);
  const target = spawnUnit(world, 1, 'musk', tower.x + distance, tower.y);
  target.speed = 0;
  target.acquire = 0;
  target.reload = 999;
  return { world, tower, target };
}

test('selected completed watch towers expose their exact configured attack radius', () => {
  const tower = createBuilding(0, 'tower', 1200, 1500, true);
  tower.selected = true;
  assert.equal(visibleTowerAttackRange(tower), BUILDING_TYPES.tower.range);

  tower.selected = false;
  assert.equal(visibleTowerAttackRange(tower), 0);
  tower.selected = true;
  tower.complete = false;
  assert.equal(visibleTowerAttackRange(tower), 0);
});

test('watch-tower balance stays defensive rather than artillery-strength', () => {
  const tower = BUILDING_TYPES.tower;
  assert.ok(tower.attack <= 14);
  assert.ok(tower.range <= 320);
  assert.ok(tower.reload >= 4);
  assert.ok(tower.accuracy < 0.8);
});

test('tower damage waits for the visible roundshot to reach its target', () => {
  const { world, tower, target } = makeTowerEngagement();
  const startingHp = target.hp;
  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    stepEconomy(world, 1 / 30);
  } finally {
    Math.random = originalRandom;
  }

  const projectile = world.projectiles.find(item => item.kind === 'tower');
  assert.ok(projectile);
  assert.equal(projectile.target, target);
  assert.equal(projectile.attackerId, tower.id);
  assert.equal(projectile.dmg, BUILDING_TYPES.tower.attack);
  assert.equal(projectile.splash, 0);
  assert.equal(target.hp, startingHp, 'firing alone must not apply invisible damage');
  assert.ok(projectile.sy < tower.y - tower.h, 'roundshot starts at the tower battery');
  assert.ok(projectile.arc >= 24, 'roundshot follows a readable ballistic arc');
  assert.ok(tower.fireT > 0);

  advance(world, 0.8);
  assert.equal(world.projectiles.some(item => item.kind === 'tower'), false);
  assert.equal(target.hp, startingHp - BUILDING_TYPES.tower.attack);
  assert.ok(world.particles.some(particle => particle.kind === 'debris'));
  assert.ok(world.particles.some(particle => particle.kind === 'dust'));
});

test('inaccurate tower fire makes a visible miss without splash damage', () => {
  const { world, target } = makeTowerEngagement();
  const startingHp = target.hp;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    stepEconomy(world, 1 / 30);
  } finally {
    Math.random = originalRandom;
  }

  const projectile = world.projectiles.find(item => item.kind === 'tower');
  assert.equal(projectile.hit, false);
  assert.notEqual(projectile.tx, target.x);
  advance(world, 0.8);
  assert.equal(target.hp, startingHp);
});
