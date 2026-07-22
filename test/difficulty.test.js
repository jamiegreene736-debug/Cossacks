import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CPU_DIFFICULTIES, DEFAULT_CPU_DIFFICULTY, normalizeCpuDifficulty,
} from '../js/config.js';
import { Commander } from '../js/ai.js';
import { createBuilding } from '../js/economy.js';
import { createWorld, spawnUnit } from '../js/sim.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';

function makeWorld(difficulty) {
  return createWorld({
    playerNation: 'england', enemyNation: 'ottoman', difficulty,
  });
}

test('CPU difficulty defaults safely and scales strategic pressure', () => {
  assert.equal(DEFAULT_CPU_DIFFICULTY, 'hard');
  assert.equal(normalizeCpuDifficulty('LOW'), 'low');
  assert.equal(normalizeCpuDifficulty('unknown'), 'hard');
  assert.equal(createWorld().difficulty, 'hard');

  const low = CPU_DIFFICULTIES.low.ai;
  const medium = CPU_DIFFICULTIES.medium.ai;
  const hard = CPU_DIFFICULTIES.hard.ai;
  assert.ok(low.planningInterval > medium.planningInterval);
  assert.ok(medium.planningInterval > hard.planningInterval);
  assert.ok(low.villagerTarget < medium.villagerTarget);
  assert.ok(medium.villagerTarget < hard.villagerTarget);
  assert.ok(low.firstAttackDelay > medium.firstAttackDelay);
  assert.ok(medium.firstAttackDelay > hard.firstAttackDelay);
  assert.ok(low.maxWaveSize < medium.maxWaveSize);
  assert.ok(medium.maxWaveSize < hard.maxWaveSize);
});

test('difficulty controls normal production batch sizes without changing unit rules', () => {
  const expected = {
    low: { barracks: 3, stable: 2, foundry: 1 },
    medium: { barracks: 4, stable: 2, foundry: 1 },
    hard: { barracks: 5, stable: 3, foundry: 2 },
  };

  for (const difficulty of Object.keys(expected)) {
    const world = makeWorld(difficulty);
    const side = world.sides[1];
    side.resources = { food: 100_000, wood: 100_000, gold: 100_000, stone: 100_000 };
    side.popCap = 1200;
    const barracks = createBuilding(1, 'barracks', 4300, 1300, true);
    const stable = createBuilding(1, 'stable', 4300, 1500, true);
    const foundry = createBuilding(1, 'foundry', 4300, 1700, true);
    world.buildings.push(barracks, stable, foundry);

    const commander = new Commander(world, 1, difficulty);
    commander.manageProduction();

    assert.equal(barracks.queue.length, expected[difficulty].barracks);
    assert.equal(stable.queue.length, expected[difficulty].stable);
    assert.equal(foundry.queue.length, expected[difficulty].foundry);
  }
});

test('difficulty scales the number of troops committed to a late-game wave', () => {
  const committed = {};
  for (const difficulty of Object.keys(CPU_DIFFICULTIES)) {
    const world = makeWorld(difficulty);
    world.time = 360;
    const townCenter = world.buildings.find(building => (
      building.side === 1 && building.type === 'town_center'
    ));
    for (let index = 0; index < 60; index++) {
      spawnUnit(world, 1, 'musk', townCenter.x - 140 - index, townCenter.y + index % 10);
    }
    const commander = new Commander(world, 1, difficulty);
    commander.attackTimer = 0;

    commander.manageArmy();

    committed[difficulty] = commander.committed.size;
    assert.equal(
      world.units.filter(unit => unit.side === 1 && unit.deferredAttack).length,
      committed[difficulty],
    );
  }

  assert.ok(committed.low < committed.medium);
  assert.ok(committed.medium < committed.hard);
});

test('campaign saves retain difficulty while legacy saves preserve original Hard AI', () => {
  const world = makeWorld('low');
  const commander = new Commander(world, 1, 'low');
  const snapshot = createGameSnapshot(world, commander, { x: 660, y: 1600, zoom: 0.9 });
  const restored = restoreGameSnapshot(snapshot);
  assert.equal(restored.world.difficulty, 'low');
  assert.equal(restored.commander.difficulty, 'low');
  assert.equal(snapshot.summary.difficulty, 'low');

  delete snapshot.world.difficulty;
  delete snapshot.commander.difficulty;
  delete snapshot.commanders;
  delete snapshot.summary.difficulty;
  const legacy = restoreGameSnapshot(snapshot);
  assert.equal(legacy.world.difficulty, 'hard');
  assert.equal(legacy.commander.difficulty, 'hard');
  assert.equal(legacy.commander.profile.firstAttackDelay, 92);
});
