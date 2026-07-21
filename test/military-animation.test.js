import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMilitaryFrame, getMilitaryVerticalOffset, MILITARY_FRAME, MILITARY_WALK_FRAME_COUNT,
} from '../js/military-animation.js';

test('moving troops advance through all six secured-weapon walk poses', () => {
  const unit = { type: 'musk', moving: true, fireT: 1, animT: 0 };
  const frames = [];
  for (let index = 0; index < MILITARY_WALK_FRAME_COUNT; index++) {
    unit.animT = index / 8;
    frames.push(getMilitaryFrame(unit));
  }

  assert.deepEqual(frames, [1, 2, 3, 4, 5, 6]);
  unit.animT = MILITARY_WALK_FRAME_COUNT / 8;
  assert.equal(getMilitaryFrame(unit), MILITARY_FRAME.WALK_START);
});

test('formation offsets produce coordinated stride cohorts without changing speed', () => {
  const unit = { type: 'pike', moving: true, fireT: 0, animT: 0, walkPhaseOffset: 2 };
  assert.equal(getMilitaryFrame(unit), 3);

  unit.walkPhaseOffset = 4;
  assert.equal(getMilitaryFrame(unit), 5);
});

test('stopped troops return to ready and attack presentation', () => {
  const unit = { type: 'cav', moving: false, fireT: 0, animT: 0 };
  assert.equal(getMilitaryFrame(unit), MILITARY_FRAME.READY);

  unit.fireT = 0.1;
  assert.equal(getMilitaryFrame(unit), MILITARY_FRAME.ATTACK);
});

test('artillery keeps its two-frame idle and fire contract', () => {
  assert.equal(getMilitaryFrame({ type: 'gun', moving: true, fireT: 0, animT: 2 }), 0);
  assert.equal(getMilitaryFrame({ type: 'gun', moving: false, fireT: 0.1, animT: 2 }), 1);
});

test('walk bob is continuous between grounded contact poses', () => {
  const unit = { type: 'musk', moving: true, animT: 0, walkPhaseOffset: 0 };
  assert.equal(getMilitaryVerticalOffset(unit), 0);

  unit.animT = 1 / 8;
  assert.ok(getMilitaryVerticalOffset(unit) < -0.3);

  unit.animT = 3 / 8;
  assert.ok(Math.abs(getMilitaryVerticalOffset(unit)) < 1e-9);
  unit.moving = false;
  assert.equal(getMilitaryVerticalOffset(unit), 0);
});
