import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDING_TYPES } from '../js/config.js';
import { createBuilding, validatePlacement } from '../js/economy.js';
import { pointInsideFortification, toggleGate } from '../js/fortifications.js';
import {
  assignVillagerPath, findUnitPath, findVillagerPath,
} from '../js/navigation.js';
import { pointInsideStructure, structuresOverlap } from '../js/obstacles.js';
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

test('scaled and rotated architectural footprints reject visible building overlap', () => {
  const world = navigationWorld();
  world.buildings = [];
  world.resources = [];
  const barracks = createBuilding(0, 'barracks', 1500, 1600, true, {
    rotation: Math.PI / 4,
  });
  world.buildings.push(barracks);

  const candidate = {
    type: 'marketplace', x: 1645, y: 1600, rotation: 0,
  };
  assert.ok(
    Math.hypot(candidate.x - barracks.x, candidate.y - barracks.y)
      > barracks.radius + BUILDING_TYPES.marketplace.radius + 18,
    'this edge case sits beyond the previous center-radius placement check',
  );
  assert.equal(structuresOverlap(candidate, barracks, 14), true);

  const blocked = validatePlacement(world, 0, candidate.type, candidate.x, candidate.y);
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /another building/i);

  const clear = validatePlacement(world, 0, candidate.type, 1690, 1600);
  assert.equal(clear.ok, true);
});

test('ordinary buildings and stone walls share one placement obstacle model', () => {
  const world = navigationWorld();
  world.buildings = [
    createBuilding(0, 'wall', 1500, 1600, true, { orientation: 'horizontal' }),
  ];
  world.resources = [];

  const blockedBuilding = validatePlacement(world, 0, 'house', 1500, 1600);
  assert.equal(blockedBuilding.ok, false);
  assert.match(blockedBuilding.message, /another building/i);

  const blockedWall = validatePlacement(
    world, 0, 'wall', 1500, 1600, { orientation: 'horizontal', snap: false },
  );
  assert.equal(blockedWall.ok, false);
  assert.match(blockedWall.message, /overlaps/i);
});

test('soldiers receive obstacle routes and never cross a completed building', () => {
  const world = navigationWorld();
  const barracks = createBuilding(0, 'barracks', 1500, 1600, true);
  world.buildings.push(barracks);
  const musketeer = spawnUnit(world, 0, 'musk', 1280, 1600);
  musketeer.orderX = 1720;
  musketeer.orderY = 1600;
  musketeer.state = 'move';

  assert.ok(findUnitPath(
    world, musketeer.x, musketeer.y, musketeer.orderX, musketeer.orderY, musketeer.radius + 2,
  ).length > 1);
  for (let tick = 0; tick < 500 && musketeer.state === 'move'; tick++) {
    step(world, 1 / 30);
    assert.equal(
      pointInsideStructure(barracks, musketeer.x, musketeer.y, musketeer.radius),
      false,
    );
  }

  assert.equal(musketeer.state, 'idle');
  assert.ok(Math.hypot(musketeer.x - 1720, musketeer.y - 1600) < 7);
});

test('legacy or separated units embedded in a building recover to legal ground', () => {
  const world = navigationWorld();
  const mansion = createBuilding(0, 'english_mansion', 1500, 1600, true, {
    rotation: Math.PI / 5,
  });
  world.buildings.push(mansion);
  const villager = spawnUnit(world, 0, 'villager', mansion.x, mansion.y);
  assert.equal(pointInsideStructure(mansion, villager.x, villager.y, villager.radius), true);

  step(world, 1 / 30);

  assert.equal(pointInsideStructure(mansion, villager.x, villager.y, villager.radius), false);
});
