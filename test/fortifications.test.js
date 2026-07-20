import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, spawnUnit, step } from '../js/sim.js';
import { createBuilding, placeBuilding, validatePlacement } from '../js/economy.js';
import {
  fortificationAxis, fortificationEndpoints, lineIntersectsFortification,
  resolveUnitFortificationCollision,
} from '../js/fortifications.js';

function makeWorld() {
  return createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
}

function builder() {
  return { id: 99, alive: true, side: 0, type: 'villager', job: null };
}

test('stone walls and gates snap into a connected fortification run', () => {
  const world = makeWorld();
  const worker = builder();

  const first = placeBuilding(world, 0, 'wall', 660, 1800, [worker], { orientation: 'horizontal' });
  assert.equal(first.ok, true);
  assert.equal(first.building.orientation, 'horizontal');
  assert.equal(world.sides[0].resources.stone, 95);

  const nextPreview = validatePlacement(world, 0, 'wall', 746, 1803, { orientation: 'horizontal' });
  assert.equal(nextPreview.ok, true);
  assert.equal(nextPreview.snappedToId, first.building.id);
  assert.equal(nextPreview.x, 748);
  assert.equal(nextPreview.y, 1800);

  const second = placeBuilding(world, 0, 'wall', 746, 1803, [worker], { orientation: 'horizontal' });
  assert.equal(second.ok, true);
  assert.deepEqual(fortificationEndpoints(first.building)[1], fortificationEndpoints(second.building)[0]);

  const gate = placeBuilding(world, 0, 'gate', 844, 1801, [worker], { orientation: 'horizontal' });
  assert.equal(gate.ok, true);
  assert.equal(gate.building.x, 844);
  assert.equal(gate.building.y, 1800);
  assert.equal(gate.building.orientation, 'horizontal');
  assert.equal(world.sides[0].resources.stone, 25);
  assert.equal(world.sides[0].resources.wood, 300);

  const duplicate = validatePlacement(world, 0, 'wall', 660, 1800, { orientation: 'horizontal' });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /overlaps/i);
});

test('a rotated wall snaps to an endpoint to form an isometric corner', () => {
  const world = makeWorld();
  const first = createBuilding(0, 'wall', 660, 1800, true, { orientation: 'horizontal' });
  world.buildings.push(first);
  const endpoint = fortificationEndpoints(first)[1];
  const diagonal = fortificationAxis('diagonal');
  const expected = { x: endpoint.x + diagonal.x * 44, y: endpoint.y + diagonal.y * 44 };

  const preview = validatePlacement(
    world,
    0,
    'wall',
    expected.x + 4,
    expected.y - 3,
    { orientation: 'diagonal' },
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.snappedToId, first.id);
  assert.ok(Math.abs(preview.x - expected.x) < 0.001);
  assert.ok(Math.abs(preview.y - expected.y) < 0.001);
});

test('wall masonry blocks units and fire while a gate remains passable', () => {
  const world = makeWorld();
  const wall = createBuilding(0, 'wall', 660, 1800, true, { orientation: 'horizontal' });
  const gate = createBuilding(0, 'gate', 820, 1800, true, { orientation: 'horizontal' });

  assert.equal(lineIntersectsFortification(660, 1740, 660, 1860, wall), true);
  assert.equal(lineIntersectsFortification(500, 1700, 600, 1700, wall), false);

  const unit = { x: 660, y: 1800, radius: 5 };
  assert.equal(resolveUnitFortificationCollision(unit, [wall, gate]), true);
  assert.ok(Math.abs(unit.y - wall.y) >= 17.5);

  const gateUnit = { x: gate.x, y: gate.y, radius: 5 };
  assert.equal(resolveUnitFortificationCollision(gateUnit, [gate]), false);
  assert.deepEqual(gateUnit, { x: gate.x, y: gate.y, radius: 5 });

  world.buildings.push(wall, gate);
  const moving = spawnUnit(world, 0, 'villager', 660, 1760);
  moving.orderX = 660;
  moving.orderY = 1840;
  moving.state = 'move';
  for (let tick = 0; tick < 90; tick++) step(world, 1 / 30);
  assert.ok(moving.y < wall.y, 'the simulation keeps the villager on the near side of the wall');
});
