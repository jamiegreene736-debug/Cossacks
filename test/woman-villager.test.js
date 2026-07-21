import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import { UNIT_TYPES } from '../js/config.js';
import {
  placeBuilding, queueUnit, stepEconomy, validatePlacement,
} from '../js/economy.js';
import { applyAttackOrder } from '../js/formations.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import { createWorld, spawnUnit, step } from '../js/sim.js';

function makeWorld(playerNation = 'england') {
  return createWorld({
    playerNation,
    enemyNation: playerNation === 'england' ? 'ottoman' : 'england',
  });
}

function advance(world, seconds) {
  for (let tick = 0; tick < Math.ceil(seconds * 30); tick++) step(world, 1 / 30);
}

function findHouseSite(world, side, townCenter) {
  for (let radius = 220; radius <= 620; radius += 80) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const x = townCenter.x + Math.cos(angle) * radius;
      const y = townCenter.y + Math.sin(angle) * radius;
      const placement = validatePlacement(world, side, 'house', x, y);
      if (placement.ok) return placement;
    }
  }
  throw new Error(`No valid house site found for side ${side}`);
}

test('both nations can train a woman villager who retains the shared worker role', () => {
  for (const nation of ['england', 'ottoman']) {
    const world = makeWorld(nation);
    const townCenter = world.buildings.find(building => building.side === 0);
    townCenter.queue.length = 0;
    world.sides[0].queuedPopulation = 0;

    const queued = queueUnit(world, townCenter, 'woman_villager', 1, {
      free: true,
      trainTime: 0.01,
    });
    assert.equal(queued.ok, true);
    assert.equal(queued.message, '1 woman villager queued.');
    stepEconomy(world, 0.02);

    const woman = world.units.find(unit => unit.side === 0);
    assert.equal(woman.type, 'villager');
    assert.equal(woman.unitType, 'woman_villager');
    assert.equal(woman.nation, nation);

    const site = findHouseSite(world, 0, townCenter);
    const placed = placeBuilding(world, 0, 'house', site.x, site.y, [woman]);
    assert.equal(placed.ok, true);
    assert.equal(woman.job.kind, 'build');
    advance(world, 24);
    assert.equal(placed.building.complete, true);
  }
});

test('a woman villager cannon direct hit instantly defeats every soldier type', () => {
  for (const type of ['musk', 'pike', 'cav', 'gun']) {
    const world = makeWorld();
    const woman = spawnUnit(world, 0, 'woman_villager', 900, 1500);
    const soldier = spawnUnit(world, 1, type, 1120, 1500);
    woman.reload = 0;
    soldier.acquire = 0;
    soldier.speed = 0;
    applyAttackOrder([woman], soldier);

    advance(world, 1.5);

    assert.equal(soldier.alive, false, `${type} should be defeated by the direct shot`);
    assert.equal(world.killLog.villager, 1);
  }
});

test('the cannon lethal override does not one-shot civilians or buildings', () => {
  const civilianWorld = makeWorld();
  const civilianAttacker = spawnUnit(civilianWorld, 0, 'woman_villager', 900, 1500);
  const civilian = spawnUnit(civilianWorld, 1, 'villager', 1120, 1500);
  civilianAttacker.reload = 0;
  applyAttackOrder([civilianAttacker], civilian);
  advance(civilianWorld, 1.5);
  assert.equal(civilian.alive, true);
  assert.equal(civilian.hp, UNIT_TYPES.villager.hp - UNIT_TYPES.woman_villager.dmg);

  const buildingWorld = makeWorld();
  const buildingAttacker = spawnUnit(buildingWorld, 0, 'woman_villager', 900, 1500);
  const enemyTownCenter = buildingWorld.buildings.find(building => building.side === 1);
  buildingAttacker.x = enemyTownCenter.x - 300;
  buildingAttacker.px = buildingAttacker.x;
  buildingAttacker.y = enemyTownCenter.y;
  buildingAttacker.py = buildingAttacker.y;
  buildingAttacker.reload = 0;
  const startingIntegrity = enemyTownCenter.hp;
  applyAttackOrder([buildingAttacker], enemyTownCenter);
  advance(buildingWorld, 1.5);
  assert.equal(enemyTownCenter.alive, true);
  assert.equal(enemyTownCenter.hp, startingIntegrity - UNIT_TYPES.woman_villager.dmg);
});

test('woman villager identity and cannon balance survive a campaign round trip', () => {
  const world = makeWorld();
  const woman = spawnUnit(world, 0, 'woman_villager', 900, 1500);
  woman.reload = 3.5;
  const snapshot = createGameSnapshot(
    world,
    new Commander(world, 1),
    { x: 900, y: 1500, zoom: 1 },
  );

  const restored = restoreGameSnapshot(snapshot).world.units.find(unit => unit.id === woman.id);
  assert.equal(restored.type, 'villager');
  assert.equal(restored.unitType, 'woman_villager');
  assert.equal(restored.range, UNIT_TYPES.woman_villager.range);
  assert.equal(restored.minRange, UNIT_TYPES.woman_villager.minRange);
  assert.equal(restored.reloadTime, UNIT_TYPES.woman_villager.reload);
});
