import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import { normalizeAudioSettings } from '../js/audio.js';
import { UNIT_TYPES } from '../js/config.js';
import { createBuilding, getMillFieldSlots, getRallyTarget, setRallyPoint } from '../js/economy.js';
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
  const townCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  setRallyPoint(townCenter, field.x, field.y, field);
  const millWorker = spawnUnit(world, 0, 'villager', 800, 1420);
  millWorker.job = {
    kind: 'gather', targetId: field.id, phase: 'deliver', resourceType: 'food',
    dropoffId: mill.id, carriedAmount: 10,
  };
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
  commander.resourceCursor = 11;
  const alliedCommander = new Commander(world, 2);
  const secondRivalCommander = new Commander(world, 3);

  const gate = createBuilding(0, 'gate', 920, 1380, true, {
    orientation: 'horizontal', gateOpen: false,
  });
  world.buildings.push(gate);
  const encoded = encodeSnapshot(createGameSnapshot(
    world, [commander, alliedCommander, secondRivalCommander],
    { x: 777, y: 888, zoom: 1.4, rotation: Math.PI }, 123456,
  ));
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
  assert.equal(restored.commander.resourceCursor, 11);
  assert.equal(restored.world.mode, '2v2');
  assert.deepEqual(restored.world.sides.map(side => side.team), [0, 1, 0, 1]);
  assert.deepEqual(restored.commanders.map(savedCommander => savedCommander.side), [1, 2, 3]);
  assert.deepEqual(restoredMillWorker.job, {
    kind: 'gather', targetId: field.id, phase: 'deliver', resourceType: 'food',
    dropoffId: mill.id, carriedAmount: 10,
  });
  const restoredField = restored.world.buildings.find(building => building.id === field.id);
  const restoredTownCenter = restored.world.buildings.find(building => building.id === townCenter.id);
  assert.equal(restoredTownCenter.rallyTargetId, field.id);
  assert.equal(getRallyTarget(restored.world, restoredTownCenter), restoredField);
  assert.equal(restoredField.millId, mill.id);
  assert.equal(restoredField.fieldSlot, 2);
  assert.deepEqual(restored.camera, { x: 777, y: 888, zoom: 1.4, rotation: Math.PI });
  assert.equal(restored.world.buildings.find(building => building.id === gate.id).gateOpen, false);

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
  assert.equal(restoredDefender.wallElevation, 40);
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

test('legacy campaign economy ledgers restore missing stone balances and telemetry', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const snapshot = createGameSnapshot(
    world, new Commander(world, 1), { x: 900, y: 1500, zoom: 1 },
  );
  delete snapshot.world.sides[0].resources.stone;
  delete snapshot.world.sides[0].incomeSample.stone;
  snapshot.world.sides[0].incomePerHour.stone = Number.NaN;
  snapshot.world.sides[0].incomeSampleTime = Number.NaN;

  const restoredSide = restoreGameSnapshot(snapshot).world.sides[0];
  assert.equal(restoredSide.resources.stone, 0);
  assert.equal(restoredSide.incomeSample.stone, 0);
  assert.equal(restoredSide.incomePerHour.stone, 0);
  assert.equal(restoredSide.incomeSampleTime, 0);
});

test('legacy campaign villagers receive the current explicit-combat balance on restore', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const villager = spawnUnit(world, 0, 'villager', 900, 1500);
  Object.assign(villager, { range: 0, acquire: 0, reloadTime: 0, dmg: 0, acc: 0 });
  const snapshot = createGameSnapshot(
    world, new Commander(world, 1), { x: 900, y: 1500, zoom: 1 },
  );

  const restored = restoreGameSnapshot(snapshot).world.units.find(unit => unit.id === villager.id);
  assert.equal(restored.range, UNIT_TYPES.villager.range);
  assert.equal(restored.acquire, 0);
  assert.equal(restored.reloadTime, UNIT_TYPES.villager.reload);
  assert.equal(restored.dmg, UNIT_TYPES.villager.dmg);
  assert.equal(restored.acc, UNIT_TYPES.villager.acc);
});

test('restored military units receive equal current stats while preserving health percentage', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const units = ['musk', 'pike', 'cav', 'gun'].flatMap((type, index) => [
    spawnUnit(world, 0, type, 800 + index * 30, 1450),
    spawnUnit(world, 1, type, 900 + index * 30, 1550),
  ]);
  for (const unit of units) {
    Object.assign(unit, {
      hp: 25, maxHp: 100, speed: 999, reloadTime: 0.1, reload: 99,
      dmg: 999, meleeDmg: 999, meleeCd: 99,
    });
  }
  const snapshot = createGameSnapshot(
    world, new Commander(world, 1), { x: 900, y: 1500, zoom: 1 },
  );

  const restored = restoreGameSnapshot(snapshot).world.units.filter(unit => unit.type !== 'villager');
  for (const unit of restored) {
    const baseline = UNIT_TYPES[unit.type];
    assert.equal(unit.maxHp, baseline.hp);
    assert.equal(unit.hp, baseline.hp * 0.25);
    assert.equal(unit.speed, baseline.speed);
    assert.equal(unit.reloadTime, baseline.reload);
    assert.equal(unit.reload, baseline.reload);
    assert.equal(unit.dmg, baseline.dmg);
    assert.equal(unit.meleeDmg, baseline.meleeDmg);
    assert.equal(unit.meleeCd, baseline.meleeRate);
  }
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
