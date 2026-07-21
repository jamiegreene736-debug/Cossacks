import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMoveOrder, getFormationSlots } from '../js/formations.js';

function unit(id, type, x, y, animT = id) {
  return {
    id, type, x, y, animT, side: 0, state: 'idle',
    orderX: NaN, orderY: NaN, orderTarget: null,
  };
}

test('formation slots reserve the visual footprint of infantry and mounted units', () => {
  const infantrySlots = getFormationSlots(
    Array.from({ length: 8 }, (_, index) => unit(index, 'musk', 0, 0)),
    'line',
  );
  const cavalrySlots = getFormationSlots(
    Array.from({ length: 8 }, (_, index) => unit(index, 'cav', 0, 0)),
    'line',
  );

  assert.equal(infantrySlots[1].a - infantrySlots[0].a, 22);
  assert.equal(cavalrySlots[1].a - cavalrySlots[0].a, 34);
  assert.equal(cavalrySlots.at(-1).b, 24);
});

test('large lines add ranks instead of exceeding the readable battlefield width', () => {
  const slots = getFormationSlots(
    Array.from({ length: 1200 }, (_, index) => unit(index, 'musk', 0, 0)),
    'line',
  );
  const across = slots.map(slot => slot.a);
  const rows = new Set(slots.map(slot => slot.row));

  assert.ok(Math.max(...across) - Math.min(...across) <= 900);
  assert.ok(rows.size > 4);
});

test('a regiment shares one clock with stable three-cohort gait offsets', () => {
  const units = [
    unit(11, 'musk', 100, 100, 7.1),
    unit(12, 'musk', 120, 100, 2.4),
    unit(13, 'pike', 140, 100, 9.8),
    unit(14, 'cav', 160, 100, 4.2),
  ];

  applyMoveOrder(units, 500, 100, 'line');

  assert.equal(new Set(units.map(entry => entry.animT)).size, 1);
  assert.deepEqual([...new Set(units.map(entry => entry.walkPhaseOffset))].sort(), [0, 2, 4]);
  assert.ok(units.every(entry => entry.state === 'move'));
});

test('a solo unit starts at the contact pose without a formation offset', () => {
  const cavalry = unit(20, 'cav', 100, 100, 5);
  applyMoveOrder([cavalry], 500, 100, 'line');

  assert.equal(cavalry.walkPhaseOffset, 0);
  assert.equal(cavalry.orderX, 500);
  assert.equal(cavalry.orderY, 100);
});

test('reissuing a waypoint preserves an active regiment gait without a pose snap', () => {
  const first = { ...unit(30, 'musk', 100, 100, 3.25), moving: true, walkPhaseOffset: 2 };
  const second = { ...unit(31, 'musk', 130, 100, 3.25), moving: true, walkPhaseOffset: 4 };

  applyMoveOrder([first, second], 600, 140, 'line');

  assert.deepEqual(
    [first.animT, first.walkPhaseOffset, second.animT, second.walkPhaseOffset],
    [3.25, 2, 3.25, 4],
  );
});
