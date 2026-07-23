import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceCharacterGait, getCharacterGaitPhase, getCharacterMotion, getCharacterWalkFrame,
} from '../js/character-animation.js';

test('gait phase advances from actual travel and remains planted while stopped', () => {
  const unit = { type: 'musk', moving: true, gaitDistance: 0, walkPhaseOffset: 0 };
  assert.equal(getCharacterWalkFrame(unit), 0);
  advanceCharacterGait(unit, 31 / 6);
  assert.equal(getCharacterWalkFrame(unit), 1);
  unit.animT = 900;
  assert.equal(getCharacterWalkFrame(unit), 1, 'elapsed time cannot slide planted feet');
});

test('a full stride returns to contact and preserves formation offsets', () => {
  const unit = { type: 'pike', moving: true, gaitDistance: 31, walkPhaseOffset: 0 };
  assert.ok(getCharacterGaitPhase(unit) < 1e-9);
  unit.walkPhaseOffset = 2;
  assert.equal(getCharacterWalkFrame(unit), 2);
});

test('walking transfers torso weight while stabilizing the head', () => {
  const unit = { type: 'villager', moving: true, gaitDistance: 29 / 4, fireT: 0 };
  const motion = getCharacterMotion(unit, 1);
  assert.ok(motion.shiftY < -0.4);
  assert.ok(Math.abs(motion.rotation) > 0.01);
  assert.equal(Math.sign(motion.headRotation), -Math.sign(motion.rotation));
  assert.equal(motion.articulateHead, true);
});

test('attack recoil has follow-through and heavy artillery stays restrained', () => {
  const infantry = getCharacterMotion({
    type: 'musk', moving: false, gaitDistance: 0, fireT: 0.065,
  }, 1);
  const artillery = getCharacterMotion({
    type: 'gun', moving: false, gaitDistance: 0, fireT: 0.125,
  }, 1);
  assert.ok(Math.abs(infantry.rotation) > Math.abs(artillery.rotation));
  assert.ok(infantry.shiftX < 0);
  assert.equal(artillery.articulateHead, false);
});
