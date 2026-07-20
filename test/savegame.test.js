import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import { normalizeAudioSettings } from '../js/audio.js';
import { createBuilding, getMillFieldSlots } from '../js/economy.js';
import {
  createGameSnapshot, decodeSnapshot, deleteCampaign, encodeSnapshot,
  getCampaignSummary, loadCampaign, restoreGameSnapshot, saveCampaign,
} from '../js/savegame.js';
import { createWorld, spawnUnit } from '../js/sim.js';
import { assignMusketeersToWall, updateWallAssignment } from '../js/fortifications.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('a campaign round trip preserves economy, AI, camera and entity references', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.time = 187.25;
  world.speed = 2;
  world.state = 'paused';
  world.sides[0].resources.wood = 1234.5;
  world.decals.push({ kind: 'crater', x: 222, y: 333 });
  const attacker = spawnUnit(world, 0, 'musk', 900, 1500);
  const defender = spawnUnit(world, 1, 'pike', 1100, 1500);
  const mill = createBuilding(0, 'mill', 760, 1380, true);
  const fieldSlot = getMillFieldSlots(mill)[2];
  const field = createBuilding(0, 'farm', fieldSlot.x, fieldSlot.y, true, fieldSlot);
  world.buildings.push(mill, field);
  const millWorker = spawnUnit(world, 0, 'villager', 800, 1420);
  millWorker.job = { kind: 'gather', targetId: field.id };
  const enemyTownCenter = world.buildings.find(building => building.side === 1);
  attacker.target = defender;
  attacker.orderTarget = enemyTownCenter;
  attacker.selected = true;
  attacker.orderX = NaN;
  defender.deferredAttack = { target: world.buildings[0], at: 194 };
  world.projectiles.push({ kind: 'tower', x: 1, y: 2, target: attacker, t: 0, dur: 1 });

  const commander = new Commander(world, 1);
  commander.thinkTimer = 0.25;
  commander.attackTimer = 41;
  commander.committed.add(defender.id);
  commander.planCursor = { house: 4 };

  const encoded = encodeSnapshot(createGameSnapshot(world, commander, { x: 777, y: 888, zoom: 1.4 }, 123456));
  const restored = restoreGameSnapshot(decodeSnapshot(encoded));
  const restoredAttacker = restored.world.units.find(unit => unit.id === attacker.id);
  const restoredDefender = restored.world.units.find(unit => unit.id === defender.id);
  const restoredMillWorker = restored.world.units.find(unit => unit.id === millWorker.id);

  assert.equal(restored.world.state, 'paused');
  assert.equal(restored.world.time, 187.25);
  assert.equal(restored.world.speed, 2);
  assert.equal(restored.world.sides[0].resources.wood, 1234.5);
  assert.equal(Number.isNaN(restoredAttacker.orderX), true);
  assert.equal(restoredAttacker.selected, false);
  assert.equal(restoredAttacker.target, restoredDefender);
  assert.equal(restoredAttacker.orderTarget.id, enemyTownCenter.id);
  assert.equal(restoredDefender.deferredAttack.target, restored.world.buildings[0]);
  assert.equal(restored.world.projectiles[0].target, restoredAttacker);
  assert.deepEqual(restored.world.decals, world.decals);
  assert.equal(restored.commander.committed.has(defender.id), true);
  assert.deepEqual(restored.commander.planCursor, { house: 4 });
  assert.deepEqual(restoredMillWorker.job, {
    kind: 'gather', targetId: field.id,
  });
  const restoredField = restored.world.buildings.find(building => building.id === field.id);
  assert.equal(restoredField.millId, mill.id);
  assert.equal(restoredField.fieldSlot, 2);
  assert.deepEqual(restored.camera, { x: 777, y: 888, zoom: 1.4 });

  const maxUnitId = Math.max(...restored.world.units.map(unit => unit.id));
  assert.ok(restored.world.spawnUnit(0, 'villager', 700, 1500).id > maxUnitId);
  const maxEntityId = Math.max(...restored.world.buildings.map(building => building.id), ...restored.world.resources.map(resource => resource.id));
  assert.ok(createBuilding(0, 'house', 800, 1500, true).id > maxEntityId);
});

test('local campaign storage exposes metadata and supports discard', () => {
  const storage = memoryStorage();
  const world = createWorld({ playerNation: 'ottoman', enemyNation: 'england' });
  const commander = new Commander(world, 1);
  world.state = 'paused';
  world.time = 64;

  const summary = saveCampaign(world, commander, { x: 1, y: 2, zoom: 1 }, storage);
  assert.equal(summary.nation, 'ottoman');
  assert.equal(getCampaignSummary(storage).elapsed, 64);
  assert.equal(loadCampaign(storage).version, 1);
  deleteCampaign(storage);
  assert.equal(loadCampaign(storage), null);
});

test('wall staircase links and mounted firing positions survive save and resume', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const wall = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  const stairs = createBuilding(0, 'wall_stairs', 900, 1633, true, {
    orientation: 'horizontal', wallId: wall.id, stairSide: 1, stairAlong: 0,
  });
  world.buildings.push(wall, stairs);
  const defender = spawnUnit(world, 0, 'musk', stairs.x, stairs.y);
  assignMusketeersToWall(world, [defender], wall);
  updateWallAssignment(world, defender);

  const restored = restoreGameSnapshot(createGameSnapshot(
    world, new Commander(world, 1), { x: 900, y: 1600, zoom: 1 },
  )).world;
  const restoredStairs = restored.buildings.find(building => building.id === stairs.id);
  const restoredDefender = restored.units.find(unit => unit.id === defender.id);
  assert.equal(restoredStairs.wallId, wall.id);
  assert.equal(restoredStairs.stairSide, 1);
  assert.equal(restoredDefender.wallMount.wallId, wall.id);
  assert.equal(restoredDefender.wallMount.stairId, stairs.id);
  assert.equal(restoredDefender.wallElevation, 30);
});

test('legacy standalone fields attach to the nearest completed mill on restore', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const mill = createBuilding(0, 'mill', 900, 1500, true);
  const legacyField = createBuilding(0, 'farm', 1040, 1460, true);
  world.buildings.push(mill, legacyField);
  const snapshot = createGameSnapshot(world, new Commander(world, 1), { x: 900, y: 1500, zoom: 1 });

  const restored = restoreGameSnapshot(snapshot).world;
  const field = restored.buildings.find(building => building.id === legacyField.id);
  const expected = getMillFieldSlots(restored.buildings.find(building => building.id === mill.id))
    .find(slot => slot.fieldSlot === field.fieldSlot);
  assert.equal(field.millId, mill.id);
  assert.ok(Number.isInteger(field.fieldSlot));
  assert.deepEqual({ x: field.x, y: field.y }, { x: expected.x, y: expected.y });
});

test('campaigns saved before navigation versioning still restore', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const snapshot = createGameSnapshot(world, new Commander(world, 1), { x: 900, y: 1500, zoom: 1 });
  delete snapshot.world.navigationVersion;

  assert.equal(restoreGameSnapshot(snapshot).world.navigationVersion, 0);
});

test('a maximum-scale army remains within a normal localStorage budget', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  for (let index = 0; index < 2400; index++) {
    spawnUnit(world, index % 2, index % 5 === 0 ? 'cav' : 'musk', 100 + index, 1200 + index % 40);
  }
  const encoded = encodeSnapshot(createGameSnapshot(world, new Commander(world, 1), { x: 1, y: 2, zoom: 1 }));
  assert.ok(encoded.length < 4_500_000, `save was unexpectedly large: ${encoded.length} bytes`);
});

test('audio settings clamp invalid values and preserve mute state', () => {
  assert.deepEqual(normalizeAudioSettings({ master: 2, effects: -1, music: 0.55, pauseMusic: 'mute', muted: true }), {
    master: 1, effects: 0, music: 0.55, pauseMusic: 'mute', muted: true,
  });
  assert.deepEqual(normalizeAudioSettings({ master: 'bad' }), {
    master: 0.7, effects: 0.72, music: 0.42, pauseMusic: 'duck', muted: false,
  });
});
