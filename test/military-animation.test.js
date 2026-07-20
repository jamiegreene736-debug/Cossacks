import assert from 'node:assert/strict';
import test from 'node:test';

import { getMilitaryFrame, MILITARY_FRAME } from '../js/military-animation.js';

test('moving troops always use the secured-weapon travel cycle', () => {
  const unit = { type: 'musk', moving: true, fireT: 1, animT: 0 };
  assert.equal(getMilitaryFrame(unit), MILITARY_FRAME.TRAVEL_A);

  unit.animT = 0.2;
  assert.equal(getMilitaryFrame(unit), MILITARY_FRAME.TRAVEL_B);
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
