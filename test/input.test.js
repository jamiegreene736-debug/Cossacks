import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, spawnUnit } from '../js/sim.js';
import { isOpenGroundMoveTarget, issueVillagerGroundMove } from '../js/input.js';

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
    input.initInput(canvas, minimap, () => ({ state: 'running' }), {
      onPlacement: placement => placements.push(placement),
      onValidatePlacement: () => ({ ok: false, message: 'Blocked terrain' }),
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
    assert.equal(placements.filter(placement => placement === null).length, 3);
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

  const flag = world.flags.at(-1);
  assert.equal(flag.kind, 'move');
  assert.equal(flag.route, true);
  assert.equal(flag.x, target.x);
  assert.equal(flag.y, target.y);
  assert.equal(Number.isFinite(flag.fromX), true);
  assert.equal(Number.isFinite(flag.fromY), true);
  assert.ok(flag.life > 1.2);
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
