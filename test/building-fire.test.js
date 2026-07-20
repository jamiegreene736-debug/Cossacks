import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import { createBuilding } from '../js/economy.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import {
  buildingFireIntensity, createWorld, damage, launchBuildingTorch, spawnUnit, step,
} from '../js/sim.js';

function makeTarget(world, hp = null) {
  const target = createBuilding(1, 'house', 900, 1500, true);
  if (hp !== null) target.hp = hp;
  world.buildings.push(target);
  return target;
}

function advance(world, seconds) {
  const ticks = Math.ceil(seconds * 30);
  for (let index = 0; index < ticks; index++) step(world, 1 / 30);
}

for (const [type, distance] of [['musk', 90], ['pike', 1], ['cav', 2]]) {
  test(`${type} attacks buildings with a visible torch that deals damage on impact`, () => {
    const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
    const target = makeTarget(world);
    const attacker = spawnUnit(world, 0, type, target.x - target.radius - distance, target.y);
    attacker.reload = 0;
    attacker.meleeCd = 0;
    attacker.target = target;
    attacker.orderTarget = target;
    const startingHp = target.hp;

    step(world, 1 / 30);

    const torch = world.projectiles.find(projectile => projectile.kind === 'torch');
    assert.ok(torch, `${type} should launch a torch`);
    assert.equal(torch.attackerId, attacker.id);
    assert.equal(target.hp, startingHp, 'damage waits for the projectile impact');
    assert.ok(attacker.torchT > 0, 'the throw pose stays visible during release');

    advance(world, 1);
    assert.ok(target.hp < startingHp);
    assert.equal(target.ignited, true);
    assert.ok(target.fireImpactCount >= 1);
  });
}

test('fire severity grows as an ignited structure loses health', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const target = makeTarget(world);
  target.ignited = true;
  target.fireImpactCount = 1;
  const healthyIntensity = buildingFireIntensity(target);
  target.hp = target.maxHp * 0.2;
  const criticalIntensity = buildingFireIntensity(target);

  assert.ok(healthyIntensity > 0);
  assert.ok(criticalIntensity > healthyIntensity);
  assert.ok(criticalIntensity <= 1);
});

test('zero health creates a timed collapse and a persistent footprint-sized ruin', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const target = makeTarget(world);
  target.ignited = true;
  target.fireSeed = 1234;

  damage(world, target, target.maxHp + 1, null);

  assert.equal(target.alive, false);
  assert.equal(world.destructions.length, 1);
  assert.deepEqual(
    { type: world.destructions[0].type, w: world.destructions[0].w, h: world.destructions[0].h },
    { type: target.type, w: target.w, h: target.h },
  );
  const ruin = world.pendingDecals.find(decal => decal.kind === 'ruin');
  assert.ok(ruin);
  assert.equal(ruin.w, target.w);
  assert.equal(ruin.h, target.h);

  advance(world, 1.6);
  assert.equal(world.destructions.length, 0, 'collapse sprite expires after revealing the ruin');
  assert.ok(world.pendingDecals.some(decal => decal.kind === 'ruin'));
});

test('active torch, ignition, and collapse state survive a campaign round trip', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const target = makeTarget(world);
  const attacker = spawnUnit(world, 0, 'musk', target.x - 100, target.y);
  launchBuildingTorch(world, attacker, target, 12, true);
  target.ignited = true;
  target.fireImpactCount = 2;
  target.fireSeed = 991;
  world.destructions.push({
    id: 999, type: 'stable', side: 1, nation: 'ottoman', x: 1100, y: 1500,
    w: 120, h: 84, radius: 62, hp: 1, maxHp: 1000, complete: true,
    queue: [], fireSeed: 44, age: 0.4, duration: 1.45,
  });

  const restored = restoreGameSnapshot(createGameSnapshot(
    world, new Commander(world, 1), { x: 900, y: 1500, zoom: 1 },
  )).world;
  const restoredTarget = restored.buildings.find(building => building.id === target.id);
  const restoredTorch = restored.projectiles.find(projectile => projectile.kind === 'torch');

  assert.equal(restoredTarget.ignited, true);
  assert.equal(restoredTarget.fireImpactCount, 2);
  assert.equal(restoredTorch.target, restoredTarget);
  assert.equal(restoredTorch.attackerId, attacker.id);
  assert.equal(restored.destructions[0].age, 0.4);
});
