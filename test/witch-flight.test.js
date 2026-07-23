import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

import { Commander } from '../js/ai.js';
import { WITCH_BROOM_ART_SPEC } from '../js/gfx/art-assets.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import { createWorld, spawnUnit, step } from '../js/sim.js';
import {
  WITCH_BANK_LIMIT, WITCH_FLIGHT_FRAME, WITCH_FLIGHT_HEIGHT,
  getWitchFlightFrame, isBroomWitch, isWitchGrounded, moveBroomWitch,
  smoothDamp, stepWitchFlight,
} from '../js/witch-flight.js';

function factionWorld() {
  const world = createWorld({
    playerNation: 'england',
    enemyNation: 'ottoman',
    allyNations: ['hogwarts', 'starwars'],
    enemyAllyNation: 'nightmare_circus',
  });
  world.state = 'running';
  return world;
}

test('only witch workers and duelists use the broom-flight controller', () => {
  assert.equal(isBroomWitch({ unitType: 'witch_worker' }), true);
  assert.equal(isBroomWitch({ unitType: 'witch_duelist' }), true);
  assert.equal(isBroomWitch({ unitType: 'wizard_worker' }), false);
  assert.equal(isBroomWitch({ unitType: 'moaning_myrtle' }), false);
});
test('the flight spring approaches altitude without overshooting', () => {
  let height = 0;
  let velocity = 0;
  for (let tick = 0; tick < 180; tick++) {
    const next = smoothDamp(height, WITCH_FLIGHT_HEIGHT, velocity, 0.24, 90, 1 / 30);
    height = next.value;
    velocity = next.velocity;
    assert.ok(height >= 0);
    assert.ok(height <= WITCH_FLIGHT_HEIGHT);
  }
  assert.ok(Math.abs(height - WITCH_FLIGHT_HEIGHT) < 0.001);
});

test('witch travel accelerates into flight without advancing a foot gait', () => {
  const world = factionWorld();
  const witch = spawnUnit(world, 2, 'witch_duelist', 2000, 1200);
  witch.gaitDistance = 17;
  witch.orderX = witch.x + 700;
  witch.orderY = witch.y;
  witch.state = 'move';
  const startingX = witch.x;

  step(world, 1 / 30);
  const firstStep = witch.x - startingX;
  assert.ok(firstStep > 0);
  assert.ok(firstStep < witch.speed / 30, 'launch acceleration starts below full cruise speed');
  assert.equal(witch.gaitDistance, 17, 'broom travel never cycles walking feet');

  for (let tick = 0; tick < 45; tick++) step(world, 1 / 30);
  assert.ok(witch.flightHeight > WITCH_FLIGHT_HEIGHT * 0.9);
  assert.ok(['cruise', 'bank'].includes(witch.flightState));
  assert.ok(Math.hypot(witch.flightVx, witch.flightVy) > witch.speed * 0.9);
});

test('turning produces a bounded bank and braking returns it to level flight', () => {
  const witch = {
    id: 41, unitType: 'witch_duelist', type: 'witch_duelist',
    speed: 50, facing: 1, x: 100, y: 100, moving: false, fireT: 0, state: 'move',
  };
  for (let tick = 0; tick < 20; tick++) {
    moveBroomWitch(witch, 1, 0, witch.speed, 500, 5, 1 / 30);
    stepWitchFlight(witch, 1 / 30);
  }
  for (let tick = 0; tick < 12; tick++) {
    moveBroomWitch(witch, 0, 1, witch.speed, 500, 5, 1 / 30);
    stepWitchFlight(witch, 1 / 30);
  }
  assert.ok(Math.abs(witch.flightBank) > 0.02);
  assert.ok(Math.abs(witch.flightBank) <= WITCH_BANK_LIMIT);

  witch.state = 'idle';
  for (let tick = 0; tick < 45; tick++) stepWitchFlight(witch, 1 / 30);
  assert.ok(Math.abs(witch.flightBank) < 0.002);
  assert.equal(witch.flightState, 'hover');
});

test('witch workers land before beginning an assigned economic action', () => {
  const world = factionWorld();
  const witch = spawnUnit(world, 2, 'witch_worker', 1950, 1200);
  const resource = world.resources.find(entry => entry.alive && entry.amount > 0);
  witch.x = resource.x;
  witch.y = resource.y;
  witch.px = witch.x;
  witch.py = witch.y;
  witch.flightHeight = WITCH_FLIGHT_HEIGHT;
  witch.pFlightHeight = WITCH_FLIGHT_HEIGHT;
  witch.job = { kind: 'gather', targetId: resource.id };
  witch.state = 'move';

  step(world, 1 / 30);
  assert.equal(witch.state, 'land');
  assert.equal(witch.workAction, null);
  assert.ok(witch.flightHeight > 0);

  for (let tick = 0; tick < 90 && witch.state !== 'work'; tick++) step(world, 1 / 30);
  assert.equal(witch.state, 'work');
  assert.equal(isWitchGrounded(witch), true);
  assert.ok(witch.workAction);
});

test('mounted casting and landing select explicit authored poses', () => {
  const witch = {
    id: 8, unitType: 'witch_duelist', type: 'witch_duelist',
    speed: 50, facing: 1, state: 'idle', moving: false, fireT: 0.2,
    flightHeight: WITCH_FLIGHT_HEIGHT, pFlightHeight: WITCH_FLIGHT_HEIGHT,
  };
  stepWitchFlight(witch, 1 / 30);
  assert.equal(witch.flightState, 'cast');
  assert.equal(getWitchFlightFrame(witch), WITCH_FLIGHT_FRAME.cast);
  witch.fireT = 0;
  witch.state = 'land';
  stepWitchFlight(witch, 1 / 30);
  assert.equal(getWitchFlightFrame(witch), WITCH_FLIGHT_FRAME.land);
});

test('flight height, velocity, bank, and transition survive save and resume', () => {
  const world = factionWorld();
  const witch = spawnUnit(world, 2, 'witch_duelist', 2100, 1300);
  Object.assign(witch, {
    flightHeight: 15.25,
    pFlightHeight: 14.75,
    flightVerticalVelocity: 2.5,
    flightVx: 37,
    flightVy: -12,
    flightBank: 0.08,
    pFlightBank: 0.06,
    flightBankVelocity: -0.2,
    flightState: 'bank',
  });
  const commanders = world.sides.slice(1).map((_side, side) => new Commander(world, side + 1));
  const restored = restoreGameSnapshot(
    createGameSnapshot(world, commanders, { x: 2000, y: 1300, zoom: 1 }),
  ).world.units.find(unit => unit.id === witch.id);

  assert.equal(restored.flightHeight, 15.25);
  assert.equal(restored.flightVerticalVelocity, 2.5);
  assert.equal(restored.flightVx, 37);
  assert.equal(restored.flightVy, -12);
  assert.equal(restored.flightBank, 0.08);
  assert.equal(restored.flightState, 'bank');
});

test('legacy witch saves receive safe grounded flight defaults', () => {
  const world = factionWorld();
  const witch = spawnUnit(world, 2, 'witch_worker', 2100, 1300);
  const commanders = world.sides.slice(1).map((_side, side) => new Commander(world, side + 1));
  const snapshot = createGameSnapshot(world, commanders, { x: 2000, y: 1300, zoom: 1 });
  const savedWitch = snapshot.world.units.find(unit => unit.id === witch.id);
  for (const key of Object.keys(savedWitch)) {
    if (key.startsWith('flight') || key.startsWith('pFlight')) delete savedWitch[key];
  }
  const restored = restoreGameSnapshot(snapshot).world.units.find(unit => unit.id === witch.id);
  assert.equal(restored.flightHeight, 0);
  assert.equal(restored.flightVx, 0);
  assert.equal(restored.flightBank, 0);
  assert.equal(restored.flightState, 'grounded');
});

test('the broom atlas contains eight substantial high-resolution production cells', async () => {
  assert.equal(WITCH_BROOM_ART_SPEC.columns, 8);
  assert.equal(WITCH_BROOM_ART_SPEC.sourceW, 272);
  assert.equal(WITCH_BROOM_ART_SPEC.sourceH, 724);
  const asset = await stat(new URL('../assets/units/witch-broom-flight.webp', import.meta.url));
  assert.ok(asset.size > 150_000);
});
