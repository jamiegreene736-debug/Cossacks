import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, spawnUnit, step } from '../js/sim.js';
import { WORLD } from '../js/config.js';
import { OPENING_PEACE_SECONDS } from '../js/truce.js';
import {
  assignVillagersToConstruction, assignVillagersToRepair, canPlayerSelectEntity,
  findPlayerSelectableEntityAt, getVillagerAttackTargetAt, getVillagerRepairTargetAt,
  isOpenGroundMoveTarget,
  isSecondaryPointerEvent, issuePrimaryUnitCommand, issueVillagerAttack,
  issueVillagerGroundMove, setBuildingRallyAt, setControlledSide, setTownCenterPrimaryRallyAt,
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
    shiftKey: { value: false },
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
    fakeWindow.dispatchEvent(keyEvent('e'));
    assert.equal(Math.round(input.getPlacementPreview()?.rotation * 180 / Math.PI), 15);
    assert.equal(Math.round(validationOptions?.rotation * 180 / Math.PI), 15);
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

test('building placement rotation is forwarded to the placement command', async () => {
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
    let placedOptions = null;
    input.initInput(canvas, minimap, () => ({ state: 'running' }), {
      onValidatePlacement: (_type, x, y, options) => ({ ok: true, x, y, rotation: options.rotation }),
      onPlaceBuilding: (_type, _x, _y, _workers, options) => {
        placedOptions = options;
        return { ok: true, message: 'placed' };
      },
    });

    input.beginPlacement('barracks');
    input.setPlacementRotationDegrees(225);
    assert.equal(Math.round(input.getPlacementPreview()?.rotation * 180 / Math.PI), 225);
    canvas.dispatchEvent(mouseEvent('mousedown', 0, { clientX: 210, clientY: 180 }));
    assert.equal(Math.round(placedOptions?.rotation * 180 / Math.PI), 225);
    assert.equal(input.getPlacementPreview(), null);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

function makeWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.time = OPENING_PEACE_SECONDS;
  return world;
}

function findOpenPoint(world) {
  for (let y = 240; y <= WORLD.h - 240; y += 160) {
    for (let x = 240; x <= WORLD.w - 240; x += 160) {
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

test('allied buildings are selectable inspection targets without granting allied unit control', () => {
  setControlledSide(0);
  const world = createWorld({
    playerNation: 'england',
    enemyNation: 'ottoman',
    allyNations: ['hogwarts', 'starwars'],
    enemyAllyNation: 'nightmare_circus',
  });
  const playerTownCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  const hogwartsCastle = world.buildings.find(building => building.side === 2 && building.type === 'castle');
  const enemyTownCenter = world.buildings.find(building => building.side === 1 && building.type === 'town_center');
  const alliedWorker = spawnUnit(world, 2, 'wizard_worker', hogwartsCastle.x + 180, hogwartsCastle.y);

  assert.equal(canPlayerSelectEntity(world, playerTownCenter), true);
  assert.equal(canPlayerSelectEntity(world, hogwartsCastle), true);
  assert.equal(canPlayerSelectEntity(world, alliedWorker), false);
  assert.equal(canPlayerSelectEntity(world, enemyTownCenter), false);
  assert.equal(findPlayerSelectableEntityAt(world, hogwartsCastle.x, hogwartsCastle.y), hogwartsCastle);
  assert.equal(findPlayerSelectableEntityAt(world, enemyTownCenter.x, enemyTownCenter.y), null);
});

test('controlled side can switch for a guest ally or enemy player', () => {
  const world = createWorld({
    playerNation: 'england',
    enemyNation: 'ottoman',
    allyNations: ['hogwarts', 'starwars'],
    enemyAllyNation: 'nightmare_circus',
  });
  const englandTownCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  const hogwartsTownCenter = world.buildings.find(building => building.side === 2 && building.type === 'town_center');
  const ottomanTownCenter = world.buildings.find(building => building.side === 1 && building.type === 'town_center');
  const hogwartsWorker = spawnUnit(world, 2, 'wizard_worker', hogwartsTownCenter.x + 140, hogwartsTownCenter.y);
  const ottomanWorker = spawnUnit(world, 1, 'villager', ottomanTownCenter.x - 140, ottomanTownCenter.y);
  const open = findOpenPoint(world);

  try {
    setControlledSide(2);
    assert.equal(canPlayerSelectEntity(world, hogwartsWorker), true);
    assert.equal(canPlayerSelectEntity(world, englandTownCenter), true, 'same-team buildings remain inspectable');
    assert.equal(canPlayerSelectEntity(world, ottomanWorker), false);
    assert.equal(issuePrimaryUnitCommand(world, [hogwartsWorker], open.x, open.y), true);
    assert.equal(hogwartsWorker.orderX, open.x);

    setControlledSide(1);
    assert.equal(canPlayerSelectEntity(world, ottomanWorker), true);
    assert.equal(canPlayerSelectEntity(world, hogwartsWorker), false);
  } finally {
    setControlledSide(0);
  }
});

test('production buildings retain the clicked resource or friendly building as their rally target', () => {
  const world = makeWorld();
  const townCenter = world.buildings.find(building => building.side === 0);
  const forest = world.resources.find(resource => resource.resourceType === 'wood');
  const mill = createBuilding(0, 'mill', 1200, 1720, true);
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
  const wallSite = findOpenPoint(world);
  const unfinishedWall = createBuilding(0, 'wall', wallSite.x, wallSite.y, false, { orientation: 'horizontal' });
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

test('primary ground clicks issue waypoints to infantry, cavalry, and artillery', () => {
  const world = makeWorld();
  const units = [
    spawnUnit(world, 0, 'musk', 720, 1420),
    spawnUnit(world, 0, 'pike', 735, 1440),
    spawnUnit(world, 0, 'cav', 750, 1460),
    spawnUnit(world, 0, 'gun', 765, 1480),
  ];
  const target = findOpenPoint(world);
  const startingPositions = units.map(unit => ({ x: unit.x, y: unit.y }));

  assert.equal(issuePrimaryUnitCommand(world, units, target.x, target.y, 'column'), true);
  for (const unit of units) {
    assert.equal(unit.state, 'move');
    assert.equal(unit.formation, 'column');
    assert.equal(Number.isFinite(unit.orderX), true);
    assert.equal(Number.isFinite(unit.orderY), true);
    assert.equal(unit.orderTarget, null);
  }
  assert.deepEqual(
    { kind: world.flags.at(-1).kind, x: world.flags.at(-1).x, y: world.flags.at(-1).y },
    { kind: 'move', x: target.x, y: target.y },
  );
  for (let frame = 0; frame < 30; frame++) step(world, 1 / 30);
  units.forEach((unit, index) => {
    assert.ok(
      Math.hypot(unit.x - startingPositions[index].x, unit.y - startingPositions[index].y) > 5,
      `${unit.type} should advance toward its waypoint`,
    );
  });
});

test('primary enemy clicks focus the whole mobile selection on that target', () => {
  const world = makeWorld();
  const targetPoint = findOpenPoint(world);
  const enemy = spawnUnit(world, 1, 'cav', targetPoint.x, targetPoint.y);
  const units = [
    spawnUnit(world, 0, 'musk', 720, 1420),
    spawnUnit(world, 0, 'cav', 750, 1460),
    spawnUnit(world, 0, 'gun', 780, 1500),
  ];

  assert.equal(issuePrimaryUnitCommand(world, units, enemy.x, enemy.y), true);
  for (const unit of units) {
    assert.equal(unit.state, 'move');
    assert.equal(unit.orderTarget, enemy);
    assert.equal(unit.target, enemy);
    assert.equal(Number.isNaN(unit.orderX), true);
  }
  assert.equal(world.flags.at(-1).kind, 'attack');
  assert.equal(world.flags.at(-1).x, enemy.x);
  assert.equal(world.flags.at(-1).y, enemy.y);
});

test('selected villagers can explicitly attack enemy soldiers and buildings', () => {
  const world = makeWorld();
  const villager = spawnUnit(world, 0, 'villager', 720, 1420);
  const friendlySoldier = spawnUnit(world, 0, 'musk', 735, 1440);
  const enemySoldier = spawnUnit(world, 1, 'musk', 900, 1420);
  const enemyBuilding = createBuilding(1, 'house', 1100, 1420, true);
  world.buildings.push(enemyBuilding);
  villager.job = { kind: 'gather', targetId: world.resources[0].id };
  villager.navigationPath = [{ x: 800, y: 1420 }];

  assert.equal(getVillagerAttackTargetAt(world, [villager], enemySoldier.x, enemySoldier.y), enemySoldier);
  assert.equal(getVillagerAttackTargetAt(world, [villager], enemyBuilding.x, enemyBuilding.y), enemyBuilding);
  assert.equal(getVillagerAttackTargetAt(world, [villager], friendlySoldier.x, friendlySoldier.y), null);

  assert.equal(issueVillagerAttack(world, [villager, friendlySoldier], enemySoldier), 1);
  assert.equal(villager.job, null);
  assert.equal(villager.navigationPath, null);
  assert.equal(villager.orderTarget, enemySoldier);
  assert.equal(villager.target, enemySoldier);
  assert.equal(villager.state, 'move');
  assert.equal(friendlySoldier.orderTarget, null, 'the primary-click interaction arms villagers only');
  assert.equal(world.flags.at(-1).attack, true);

  assert.equal(issueVillagerAttack(world, [villager], friendlySoldier), 0);
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

test('selected villagers can target and repair only damaged friendly completed buildings', () => {
  const world = makeWorld();
  const first = spawnUnit(world, 0, 'villager', 720, 1420);
  const second = spawnUnit(world, 0, 'villager', 735, 1420);
  const damaged = createBuilding(0, 'house', 980, 1700, true);
  damaged.hp = damaged.maxHp * 0.35;
  damaged.ignited = true;
  const enemy = createBuilding(1, 'house', 1180, 1700, true);
  enemy.hp = enemy.maxHp * 0.35;
  const intact = createBuilding(0, 'house', 1380, 1700, true);
  world.buildings.push(damaged, enemy, intact);

  assert.equal(getVillagerRepairTargetAt(
    world, [first, second], damaged.x, damaged.y,
  ), damaged);
  assert.equal(getVillagerRepairTargetAt(world, [first], enemy.x, enemy.y), null);
  assert.equal(getVillagerRepairTargetAt(world, [first], intact.x, intact.y), null);
  assert.equal(assignVillagersToRepair(world, [first, second], damaged), true);
  assert.deepEqual(first.job, { kind: 'repair', targetId: damaged.id });
  assert.deepEqual(second.job, { kind: 'repair', targetId: damaged.id });
  assert.equal(assignVillagersToRepair(world, [first], enemy), false);
  assert.equal(assignVillagersToRepair(world, [first], intact), false);
});

test('villager-only movement helper still requires a villager and refuses occupied terrain', () => {
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
