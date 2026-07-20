import test from 'node:test';
import assert from 'node:assert/strict';

import { createBuilding } from '../js/economy.js';
import { pointInsideFortification, toggleGate } from '../js/fortifications.js';
import { assignVillagerPath, findVillagerPath } from '../js/navigation.js';
import { createWorld, spawnUnit, step } from '../js/sim.js';

function navigationWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.buildings = world.buildings.filter(building => building.type === 'town_center');
  world.resources = [];
  return world;
}

function addWallRun(world, type = 'wall') {
  const pieces = [];
  for (let x = 700; x <= 1052; x += 88) {
    const piece = createBuilding(0, type, x, 1600, true, { orientation: 'horizontal' });
    world.buildings.push(piece);
    pieces.push(piece);
  }
  return pieces;
}

test('villager navigation goes around walls while treating a stone gate as an opening', () => {
  const world = navigationWorld();
  addWallRun(world);
  const around = findVillagerPath(world, 876, 1500, 876, 1700, 7);
  assert.ok(around.length >= 3);
  assert.ok(around.some(waypoint => waypoint.x > 1096 || waypoint.x < 656));

  world.buildings = world.buildings.filter(building => building.type === 'town_center');
  const gate = createBuilding(0, 'gate', 876, 1600, true, { orientation: 'horizontal' });
  world.buildings.push(gate);
  assert.deepEqual(findVillagerPath(world, 876, 1500, 876, 1700, 7), [{ x: 876, y: 1700 }]);

  toggleGate(world, gate);
  const barred = findVillagerPath(world, 876, 1500, 876, 1700, 7);
  assert.ok(barred.length >= 3);
  assert.ok(barred.some(waypoint => waypoint.x > 936 || waypoint.x < 816));

  toggleGate(world, gate);
  assert.deepEqual(findVillagerPath(world, 876, 1500, 876, 1700, 7), [{ x: 876, y: 1700 }]);
});

test('a routed villager reaches a waypoint beyond a wall without crossing masonry', () => {
  const world = navigationWorld();
  const walls = addWallRun(world);
  const villager = spawnUnit(world, 0, 'villager', 876, 1500);
  villager.orderX = 876;
  villager.orderY = 1700;
  villager.state = 'move';
  assert.equal(assignVillagerPath(world, villager, 876, 1700), true);

  for (let tick = 0; tick < 500 && villager.state === 'move'; tick++) {
    step(world, 1 / 30);
    assert.equal(
      walls.some(wall => pointInsideFortification(wall, villager.x, villager.y, villager.radius)),
      false,
    );
  }
  assert.equal(villager.state, 'idle');
  assert.ok(Math.hypot(villager.x - 876, villager.y - 1700) < 7);
});

test('settlement buildings and resource deposits are navigation obstacles', () => {
  const world = navigationWorld();
  world.buildings.push(createBuilding(0, 'barracks', 1500, 1600, true));
  world.resources.push({
    id: 999002, entityKind: 'resource', type: 'wood', resourceType: 'wood',
    x: 1640, y: 1600, radius: 45, amount: 1000, alive: true,
  });
  const path = findVillagerPath(world, 1250, 1600, 1850, 1600, 7);
  assert.ok(path.length > 1);
  assert.ok(path.some(waypoint => Math.abs(waypoint.y - 1600) > 70));
});
