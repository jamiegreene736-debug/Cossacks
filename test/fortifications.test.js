import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import {
  assignBuilders, createBuilding, placeBuilding, placeWallRun, planWallRun, validatePlacement,
} from '../js/economy.js';
import {
  assignMusketeersToWall, dismountWallUnit, fortificationAxis,
  fortificationEndpoints, lineIntersectsFortification,
  resolveUnitFortificationCollision, toggleGate, updateWallAssignment,
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

test('dragged wall runs place the longest affordable contiguous prefix', () => {
  const world = makeWorld();
  const worker = builder();
  const plan = planWallRun(world, 0, 660, 1900, 1660, 1900, 'horizontal');

  assert.equal(plan.ok, true);
  assert.equal(plan.requestedCount, 12);
  assert.equal(plan.segments.length, 4, '120 starting stone affords four 25-stone sections');
  assert.equal(plan.limitedByResources, true);
  assert.deepEqual(plan.segments.map(segment => segment.x), [660, 748, 836, 924]);

  const placed = placeWallRun(world, 0, 660, 1900, 1660, 1900, [worker], 'horizontal');
  assert.equal(placed.ok, true);
  assert.equal(placed.buildings.length, 4);
  assert.equal(world.sides[0].resources.stone, 20);
  assert.equal(worker.job.targetId, placed.buildings[0].id);
  assert.deepEqual(worker.job.queue, placed.buildings.slice(1).map(building => building.id));
});

test('a freehand wall run starts on an existing endpoint and keeps every section connected', () => {
  const world = makeWorld();
  world.resources = [];
  world.sides[0].resources.stone = 1000;
  const existing = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  world.buildings.push(existing);
  const existingEnd = fortificationEndpoints(existing)[1];
  const path = [
    { x: existingEnd.x + 3, y: existingEnd.y + 2 },
    { x: 1080, y: 1605 },
    { x: 1190, y: 1650 },
    { x: 1290, y: 1740 },
  ];

  const plan = planWallRun(
    world, 0, path[0].x, path[0].y, path.at(-1).x, path.at(-1).y, 'horizontal', path,
  );

  assert.equal(plan.ok, true);
  assert.ok(plan.segments.length >= 4);
  const first = { ...plan.segments[0], w: 88, h: 28 };
  assert.ok(fortificationEndpoints(first).some(endpoint => (
    Math.hypot(endpoint.x - existingEnd.x, endpoint.y - existingEnd.y) < 0.001
  )));
  for (let index = 1; index < plan.segments.length; index++) {
    const previous = { ...plan.segments[index - 1], w: 88, h: 28 };
    const current = { ...plan.segments[index], w: 88, h: 28 };
    const previousEnds = fortificationEndpoints(previous);
    const currentEnds = fortificationEndpoints(current);
    assert.ok(previousEnds.some(left => currentEnds.some(right => (
      Math.hypot(left.x - right.x, left.y - right.y) < 0.001
    ))), `sections ${index} and ${index + 1} share an exact endpoint`);
  }
  assert.equal(plan.curved, true);
  assert.ok(new Set(plan.segments.map(segment => segment.orientation.toFixed(3))).size > 2);
});

test('a dragged wall stops before the first obstructed section', () => {
  const world = makeWorld();
  world.sides[0].resources.stone = 500;
  world.resources.push({
    id: 999001, entityKind: 'resource', type: 'stone', resourceType: 'stone',
    x: 850, y: 1900, radius: 18, amount: 500, alive: true,
  });
  const plan = planWallRun(world, 0, 660, 1900, 1200, 1900, 'horizontal');

  assert.equal(plan.ok, true);
  assert.equal(plan.segments.length, 2);
  assert.equal(plan.limitedByObstacle, true);
  assert.match(plan.message, /accessible/i);
});

test('one assigned villager constructs a dragged wall run in sequence', () => {
  const world = makeWorld();
  const worker = spawnUnit(world, 0, 'villager', 650, 1840);
  const placed = placeWallRun(world, 0, 660, 1900, 1100, 1900, [worker], 'horizontal');
  for (let tick = 0; tick < 1500; tick++) step(world, 1 / 30);

  assert.equal(placed.buildings.every(building => building.complete), true);
  assert.equal(worker.job, null);
  assert.equal(worker.state, 'idle');
});

test('wall masonry blocks units while a player-controlled gate opens and closes', () => {
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

  const navigationVersion = world.navigationVersion || 0;
  const closed = toggleGate(world, gate);
  assert.equal(closed.ok, true);
  assert.equal(closed.open, false);
  assert.equal(world.navigationVersion, navigationVersion + 1);
  const blockedGateUnit = { x: gate.x, y: gate.y, radius: 5 };
  assert.equal(resolveUnitFortificationCollision(blockedGateUnit, [gate]), true);
  assert.ok(Math.abs(blockedGateUnit.y - gate.y) >= 19.5);

  const opened = toggleGate(world, gate);
  assert.equal(opened.ok, true);
  assert.equal(opened.open, true);
  assert.equal(resolveUnitFortificationCollision({ x: gate.x, y: gate.y, radius: 5 }, [gate]), false);

  world.buildings.push(wall, gate);
  const moving = spawnUnit(world, 0, 'villager', 660, 1760);
  moving.orderX = 660;
  moving.orderY = 1840;
  moving.state = 'move';
  for (let tick = 0; tick < 90; tick++) step(world, 1 / 30);
  assert.ok(moving.y < wall.y, 'the simulation keeps the villager on the near side of the wall');
});

test('stone staircases snap to a completed wall and preserve their attachment', () => {
  const world = makeWorld();
  world.buildings = [];
  world.resources = [];
  world.sides[0].resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const worker = builder();
  const unfinished = createBuilding(0, 'wall', 900, 1600, false, { orientation: 'horizontal' });
  world.buildings.push(unfinished);

  const blocked = validatePlacement(world, 0, 'wall_stairs', 900, 1635);
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /completed friendly Stone Wall/i);

  unfinished.complete = true;
  unfinished.progress = 1;
  const stairs = placeBuilding(world, 0, 'wall_stairs', 900, 1635, [worker]);
  assert.equal(stairs.ok, true);
  assert.equal(stairs.building.wallId, unfinished.id);
  assert.equal(stairs.building.orientation, unfinished.orientation);
  assert.equal(stairs.building.stairSide, 1);
  assert.equal(world.sides[0].resources.stone, 945);
  assert.equal(world.sides[0].resources.wood, 985);
});

test('wall staircases always snap to the settlement-facing inside face', () => {
  const world = makeWorld();
  world.buildings = [];
  world.resources = [];
  world.sides[0].resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const townCenter = createBuilding(0, 'town_center', 900, 1780, true);
  world.sides[0].townCenterId = townCenter.id;
  const wall = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  world.buildings.push(townCenter, wall);

  const clickedInside = validatePlacement(world, 0, 'wall_stairs', 900, 1635);
  const clickedAcrossWall = validatePlacement(world, 0, 'wall_stairs', 900, 1585);

  assert.equal(clickedInside.ok, true);
  assert.equal(clickedAcrossWall.ok, true);
  assert.equal(clickedInside.stairSide, 1);
  assert.equal(clickedAcrossWall.stairSide, 1);
  assert.equal(clickedInside.x, clickedAcrossWall.x);
  assert.equal(clickedInside.y, clickedAcrossWall.y);
  assert.ok(clickedInside.y > wall.y, 'the stairs occupy the wall face toward the Town Center');
});

test('a staircase builder uses an accessible work face instead of stalling against the wall', () => {
  const world = makeWorld();
  world.resources = [];
  const wall = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  const stairs = createBuilding(0, 'wall_stairs', 900, 1635, false, {
    orientation: 'horizontal', wallId: wall.id, stairSide: 1, stairAlong: 0,
  });
  world.buildings.push(wall, stairs);
  const worker = spawnUnit(world, 0, 'villager', 900, 1550);
  assignBuilders(world, [worker], stairs);

  for (let tick = 0; tick < 900 && !stairs.complete; tick++) step(world, 1 / 30);

  assert.equal(stairs.complete, true);
  assert.ok(worker.y < wall.y, 'the villager uses the reachable wall-side hoist position');
});

test('musketeers use a completed staircase, hold wall slots, and keep moderate range', () => {
  const world = makeWorld();
  world.buildings = [];
  world.resources = [];
  const wall = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  const stairs = createBuilding(0, 'wall_stairs', 900, 1633, true, {
    orientation: 'horizontal', wallId: wall.id, stairSide: 1, stairAlong: 0,
  });
  world.buildings.push(wall, stairs);
  const musketeer = spawnUnit(world, 0, 'musk', stairs.x, stairs.y);

  const order = assignMusketeersToWall(world, [musketeer], wall);
  assert.equal(order.assigned, 1);
  assert.equal(updateWallAssignment(world, musketeer), 'mounted');
  assert.equal(musketeer.wallMount.wallId, wall.id);
  assert.equal(musketeer.wallElevation, 40);
  assert.equal(musketeer.range, 190, 'the firing walk does not turn a musket into artillery');

  const mounted = { x: musketeer.x, y: musketeer.y };
  for (let tick = 0; tick < 30; tick++) step(world, 1 / 30);
  assert.deepEqual({ x: musketeer.x, y: musketeer.y }, mounted);

  dismountWallUnit(world, musketeer);
  assert.equal(musketeer.wallMount, null);
  assert.equal(musketeer.wallElevation, 0);
  assert.ok(Math.hypot(musketeer.x - stairs.x, musketeer.y - stairs.y) <= 9);
});

test('a wall-top musketeer can fire over its host masonry at nearby enemies', () => {
  const world = makeWorld();
  world.buildings = [];
  world.resources = [];
  const wall = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  const stairs = createBuilding(0, 'wall_stairs', 900, 1633, true, {
    orientation: 'horizontal', wallId: wall.id, stairSide: 1, stairAlong: 0,
  });
  world.buildings.push(wall, stairs);
  const defender = spawnUnit(world, 0, 'musk', stairs.x, stairs.y);
  const enemy = spawnUnit(world, 1, 'musk', 900, 1490);
  defender.reload = 0;
  defender.acc = 1;
  defender.acquireT = 0;
  enemy.reload = 999;
  assignMusketeersToWall(world, [defender], wall);
  updateWallAssignment(world, defender);

  const startingHp = enemy.hp;
  const oldRandom = Math.random;
  Math.random = () => 0;
  try {
    for (let tick = 0; tick < 12 && enemy.hp === startingHp; tick++) step(world, 1 / 30);
  } finally {
    Math.random = oldRandom;
  }
  assert.ok(enemy.hp < startingHp, 'the host wall must not block its defender’s musket fire');
  assert.ok(defender.wallMount, 'the defender remains on the firing walk while engaging');
});

test('destroying a host wall collapses its staircase and safely dismounts defenders', () => {
  const world = makeWorld();
  const wall = createBuilding(0, 'wall', 900, 1600, true, { orientation: 'horizontal' });
  const stairs = createBuilding(0, 'wall_stairs', 900, 1633, true, {
    orientation: 'horizontal', wallId: wall.id, stairSide: 1, stairAlong: 0,
  });
  world.buildings.push(wall, stairs);
  const defender = spawnUnit(world, 0, 'musk', stairs.x, stairs.y);
  assignMusketeersToWall(world, [defender], wall);
  updateWallAssignment(world, defender);

  damage(world, wall, wall.maxHp + 1, null);
  assert.equal(stairs.alive, false);
  step(world, 1 / 30);
  assert.equal(defender.wallMount, null);
  assert.equal(defender.wallElevation, 0);
  assert.ok(Math.hypot(defender.x - stairs.x, defender.y - stairs.y) <= 9);
});
