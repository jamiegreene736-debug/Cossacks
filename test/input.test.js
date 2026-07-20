import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, spawnUnit } from '../js/sim.js';
import {
  assignVillagersToConstruction, isOpenGroundMoveTarget, isSecondaryPointerEvent,
  issueVillagerGroundMove, setBuildingRallyAt, setTownCenterPrimaryRallyAt,
} from '../js/input.js';
import { createBuilding } from '../js/economy.js';

class FakeElement extends EventTarget {
  constructor(tagName = 'DIV') {
    super();
    this.tagName = tagName;
    this.innerWidth = 1280;
    this.innerHeight = 800;
    this.classList = {
      contains: () => false,
      remove: () => {},
      toggle: () => {},
    };
  }

  closest() { return null; }
}

function mouseEvent(type, button, extra = {}) {
  const event = new Event(type);
  Object.defineProperties(event, {
    button: { value: button },
    clientX: { value: extra.clientX || 0 },
    clientY: { value: extra.clientY || 0 },
    shiftKey: { value: Boolean(extra.shiftKey) },
    ctrlKey: { value: Boolean(extra.ctrlKey) },
    metaKey: { value: Boolean(extra.metaKey) },
  });
  return event;
}

function keyEvent(key) {
  const event = new Event('keydown');
  Object.defineProperties(event, {
    key: { value: key },
    ctrlKey: { value: false },
    metaKey: { value: false },
  });
  return event;
}

test('building placement supports one-action click-away, secondary-click, and Escape cancellation', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const fakeWindow = new FakeElement('WINDOW');
  const fakeDocument = new FakeElement('DOCUMENT');
  const canvas = new FakeElement('CANVAS');
  const minimap = new FakeElement('CANVAS');
  fakeDocument.getElementById = id => id === 'minimap' ? minimap : null;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;

  try {
    const input = await import('../js/input.js');
    const placements = [];
    let validationOptions = null;
    let wallPlanCalls = 0;
    let placedWallRun = null;
    input.initInput(canvas, minimap, () => ({ state: 'running' }), {
      onPlacement: placement => placements.push(placement),
      onValidatePlacement: (_type, _x, _y, options) => {
        validationOptions = options;
        return { ok: false, message: 'Blocked terrain' };
      },
      onPlanWallRun: (startX, startY, endX, endY, orientation) => {
        wallPlanCalls++;
        return {
          ok: true,
          orientation,
          requestedCount: 3,
          segments: [0, 1, 2].map(index => ({
            type: 'wall', x: startX + index * 88, y: endY, orientation, valid: true,
          })),
          message: '3 wall sections',
        };
      },
      onPlaceWallRun: (...args) => {
        placedWallRun = args;
        return { ok: true, message: '3 wall foundations placed.' };
      },
    });

    input.beginPlacement('house');
    assert.equal(input.getPlacementPreview()?.type, 'house');
    canvas.dispatchEvent(mouseEvent('mousedown', 0, { clientX: 100, clientY: 100 }));
    assert.equal(input.getPlacementPreview()?.type, 'house', 'an invalid terrain click remains retryable');

    fakeDocument.dispatchEvent(mouseEvent('mousedown', 0));
    assert.equal(input.getPlacementPreview(), null, 'a primary click outside the canvas cancels');

    input.beginPlacement('farm');
    canvas.dispatchEvent(mouseEvent('mousedown', 2));
    assert.equal(input.getPlacementPreview(), null, 'a Mac secondary click cancels');

    input.beginPlacement('mill');
    fakeWindow.dispatchEvent(keyEvent('Escape'));
    assert.equal(input.getPlacementPreview(), null, 'Escape cancels');

    input.beginPlacement('wall');
    assert.equal(input.getPlacementPreview()?.orientation, 'horizontal');
    fakeWindow.dispatchEvent(keyEvent('r'));
    assert.equal(input.getPlacementPreview()?.orientation, 'diagonal');
    assert.equal(validationOptions?.orientation, 'diagonal');
    canvas.dispatchEvent(mouseEvent('mousedown', 0, { clientX: 200, clientY: 220 }));
    fakeWindow.dispatchEvent(mouseEvent('mousemove', 0, { clientX: 480, clientY: 300 }));
    assert.equal(input.getPlacementPreview()?.segments.length, 3);
    fakeWindow.dispatchEvent(mouseEvent('mouseup', 0, { clientX: 480, clientY: 300 }));
    assert.ok(wallPlanCalls >= 2);
    assert.equal(placedWallRun?.at(-2), 'diagonal');
    assert.ok(placedWallRun?.at(-1).length >= 2, 'the drag forwards its sampled curve path');
    assert.equal(input.getPlacementPreview(), null);
    input.cancelPlacement();
    assert.equal(placements.filter(placement => placement === null).length, 4);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

function makeWorld() {
  return createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
}

function findOpenPoint(world) {
  for (let y = 240; y <= 2960; y += 160) {
    for (let x = 240; x <= 4960; x += 160) {
      if (isOpenGroundMoveTarget(world, x, y)) return { x, y };
    }
  }
  throw new Error('Expected the generated battlefield to contain open ground.');
}

test('open-ground move targets exclude units, buildings, and resources', () => {
  const world = makeWorld();
  const open = findOpenPoint(world);
  const building = world.buildings[0];
  const resource = world.resources[0];

  assert.equal(isOpenGroundMoveTarget(world, open.x, open.y), true);
  assert.equal(isOpenGroundMoveTarget(world, building.x, building.y), false);
  assert.equal(isOpenGroundMoveTarget(world, resource.x, resource.y), false);
});

test('Mac secondary clicks accept both trackpad button 2 and Control-click', () => {
  assert.equal(isSecondaryPointerEvent(mouseEvent('mousedown', 2)), true);
  assert.equal(isSecondaryPointerEvent(mouseEvent('mousedown', 0, { ctrlKey: true })), true);
  assert.equal(isSecondaryPointerEvent(mouseEvent('mousedown', 0)), false);
  assert.equal(isSecondaryPointerEvent(mouseEvent('mousedown', 0, { metaKey: true })), false);
});

test('production buildings retain the clicked resource or friendly building as their rally target', () => {
  const world = makeWorld();
  const townCenter = world.buildings.find(building => building.side === 0);
  const forest = world.resources.find(resource => resource.resourceType === 'wood');
  const mill = createBuilding(0, 'mill', 900, 1600, true);
  world.buildings.push(mill);

  const forestRally = setBuildingRallyAt(world, [townCenter], forest.x, forest.y);
  assert.equal(forestRally.target, forest);
  assert.equal(townCenter.rallyTargetId, forest.id);
  assert.equal(townCenter.rallyX, forest.x);
  assert.equal(townCenter.rallyY, forest.y);

  const buildingRally = setBuildingRallyAt(world, [townCenter], mill.x, mill.y);
  assert.equal(buildingRally.target, mill);
  assert.equal(townCenter.rallyTargetId, mill.id);

  const open = findOpenPoint(world);
  const groundRally = setBuildingRallyAt(world, [townCenter], open.x, open.y);
  assert.equal(groundRally.target, null);
  assert.equal(townCenter.rallyTargetId, null);
  assert.equal(townCenter.rallyX, open.x);
  assert.equal(townCenter.rallyY, open.y);
});

test('a primary click gives a selected Town Center a resource or worksite rally', () => {
  const world = makeWorld();
  const townCenter = world.buildings.find(building => building.side === 0);
  const berries = world.resources.find(resource => resource.resourceType === 'food');
  const unfinishedWall = createBuilding(0, 'wall', 900, 1600, false, { orientation: 'horizontal' });
  world.buildings.push(unfinishedWall);

  const foodRally = setTownCenterPrimaryRallyAt(
    world, [townCenter], berries.x, berries.y,
  );
  assert.equal(foodRally.target, berries);
  assert.equal(townCenter.rallyTargetId, berries.id);

  const buildRally = setTownCenterPrimaryRallyAt(
    world, [townCenter], unfinishedWall.x, unfinishedWall.y,
  );
  assert.equal(buildRally.target, unfinishedWall);
  assert.equal(townCenter.rallyTargetId, unfinishedWall.id);

  const open = findOpenPoint(world);
  assert.equal(setTownCenterPrimaryRallyAt(world, [townCenter], open.x, open.y), null);
  assert.equal(setTownCenterPrimaryRallyAt(world, [unfinishedWall], berries.x, berries.y), null);
});

test('a villager ground click clears work and creates a routed destination flag', () => {
  const world = makeWorld();
  const villager = spawnUnit(world, 0, 'villager', 720, 1420);
  const soldier = spawnUnit(world, 0, 'musk', 735, 1440);
  const target = findOpenPoint(world);
  villager.job = { kind: 'gather', targetId: world.resources[0].id };

  assert.equal(issueVillagerGroundMove(world, [villager, soldier], target.x, target.y), true);
  assert.equal(villager.job, null);
  assert.equal(villager.state, 'move');
  assert.equal(soldier.state, 'move');
  assert.equal(Number.isFinite(villager.orderX), true);
  assert.equal(Number.isFinite(villager.orderY), true);
  assert.ok(villager.navigationPath?.length > 0);

  const flag = world.flags.at(-1);
  assert.equal(flag.kind, 'move');
  assert.equal(flag.route, true);
  assert.equal(flag.x, target.x);
  assert.equal(flag.y, target.y);
  assert.equal(Number.isFinite(flag.fromX), true);
  assert.equal(Number.isFinite(flag.fromY), true);
  assert.ok(flag.life > 1.2);
});

test('selected villagers can take over any unfinished friendly construction', () => {
  const world = makeWorld();
  const first = spawnUnit(world, 0, 'villager', 720, 1420);
  const second = spawnUnit(world, 0, 'villager', 735, 1420);
  const wall = createBuilding(0, 'wall', 900, 1600, false, { orientation: 'horizontal' });
  const enemyWall = createBuilding(1, 'wall', 1100, 1600, false, { orientation: 'horizontal' });
  world.buildings.push(wall, enemyWall);

  assert.equal(assignVillagersToConstruction(world, [first, second], wall), true);
  assert.deepEqual(first.job, { kind: 'build', targetId: wall.id });
  assert.deepEqual(second.job, { kind: 'build', targetId: wall.id });
  assert.equal(assignVillagersToConstruction(world, [first], enemyWall), false);
  wall.complete = true;
  assert.equal(assignVillagersToConstruction(world, [first], wall), false);
});

test('primary ground movement requires a villager and refuses occupied terrain', () => {
  const world = makeWorld();
  const villager = spawnUnit(world, 0, 'villager', 720, 1420);
  const soldier = spawnUnit(world, 0, 'musk', 735, 1440);
  const open = findOpenPoint(world);
  const townCenter = world.buildings[0];

  assert.equal(issueVillagerGroundMove(world, [soldier], open.x, open.y), false);
  assert.equal(issueVillagerGroundMove(world, [villager], townCenter.x, townCenter.y), false);
  assert.equal(Number.isNaN(villager.orderX), true);
  assert.equal(world.flags.length, 0);
});
