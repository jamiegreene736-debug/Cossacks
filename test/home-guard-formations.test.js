import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import { WORLD } from '../js/config.js';
import { createBuilding, getTownCenter } from '../js/economy.js';
import { createWorld, spawnUnit } from '../js/sim.js';

function averageOrderY(units) {
  return units.reduce((sum, unit) => sum + unit.orderY, 0) / units.length;
}

test('allied AI home guards form type-separated rows near their own Town Center', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const allySide = 2;
  const townCenter = getTownCenter(world, allySide);
  const commander = new Commander(world, allySide, 'low');
  const soldiers = [
    'wizard_duelist', 'wizard_duelist',
    'witch_duelist', 'witch_duelist',
    'broom_rider', 'broom_rider',
    'moaning_myrtle', 'moaning_myrtle',
  ].map((unitType, index) => spawnUnit(
    world,
    allySide,
    unitType,
    townCenter.x + 330 + (index % 2) * 4,
    townCenter.y + (index - 2) * 3,
  ));

  const assignments = commander.arrangeHomeGuard();

  assert.deepEqual(assignments.map(assignment => assignment.type), [
    'wizard_duelist', 'witch_duelist', 'broom_rider', 'moaning_myrtle',
  ]);
  for (const soldier of soldiers) {
    assert.equal(soldier.state, 'move');
    assert.ok(Number.isFinite(soldier.orderX));
    assert.ok(Number.isFinite(soldier.orderY));
    assert.ok(soldier.orderX > townCenter.x + 250, 'allied troops should form up toward the front, not behind town');
    const distanceFromTownCenter = Math.hypot(
      soldier.orderX - townCenter.x,
      soldier.orderY - townCenter.y,
    );
    assert.ok(distanceFromTownCenter > townCenter.radius + 150, 'home guards should not stand on the Town Center');
    assert.ok(distanceFromTownCenter < 520, 'home guards should stay near their Town Center');
  }

  const byType = new Map();
  for (const soldier of soldiers) {
    if (!byType.has(soldier.unitType)) byType.set(soldier.unitType, []);
    byType.get(soldier.unitType).push(soldier);
  }
  const rows = [...byType.entries()].map(([unitType, units]) => ({
    unitType,
    y: averageOrderY(units),
  })).sort((a, b) => a.y - b.y);
  for (let index = 1; index < rows.length; index++) {
    assert.ok(
      rows[index].y - rows[index - 1].y > 30,
      `${rows[index - 1].unitType} and ${rows[index].unitType} should occupy distinct rows`,
    );
  }
});

test('rival production rallies soldiers beside its Town Center instead of the map center', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const rivalSide = 1;
  const townCenter = getTownCenter(world, rivalSide);
  const barracks = createBuilding(
    rivalSide,
    'barracks',
    townCenter.x - 260,
    townCenter.y - 120,
    true,
    { team: world.sides[rivalSide].team },
  );
  world.buildings.push(barracks);
  Object.assign(world.sides[rivalSide].resources, {
    food: 1200, wood: 1200, gold: 1200, stone: 1200,
  });

  const commander = new Commander(world, rivalSide, 'low');
  commander.manageProduction();

  assert.ok(Number.isFinite(barracks.rallyX));
  assert.ok(Number.isFinite(barracks.rallyY));
  assert.ok(barracks.rallyX < townCenter.x - 250, 'rival troops should rally on the settlement front');
  assert.ok(
    Math.hypot(barracks.rallyX - townCenter.x, barracks.rallyY - townCenter.y) < 460,
    'rival rally should remain close to its own Town Center',
  );
  assert.ok(
    Math.abs(barracks.rallyX - WORLD.w / 2) > 900,
    'rival rally should no longer use the shared map-center staging point',
  );
});
