import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getNextIdleVillager, getVillagerStatus, isIdleVillager,
} from '../js/villager-status.js';

function villager(id, overrides = {}) {
  return {
    id,
    alive: true,
    side: 0,
    type: 'villager',
    state: 'idle',
    job: null,
    orderTarget: null,
    target: null,
    orderX: NaN,
    orderY: NaN,
    moving: false,
    ...overrides,
  };
}

test('idle villagers have no job, movement, target, or active state', () => {
  assert.equal(isIdleVillager(villager(1)), true);
  assert.equal(isIdleVillager(villager(2, { job: { kind: 'gather', targetId: 9 } })), false);
  assert.equal(isIdleVillager(villager(3, { state: 'move', orderX: 400, orderY: 500 })), false);
  assert.equal(isIdleVillager(villager(4, { orderTarget: { id: 11 } })), false);
  assert.equal(isIdleVillager(villager(5, { state: 'flee' })), false);
  assert.equal(isIdleVillager(villager(6, { moving: true })), false);
  assert.equal(isIdleVillager(villager(7, { alive: false })), false);
  assert.equal(isIdleVillager({ ...villager(8), type: 'musk' }), false);
});

test('villager status only counts living workers controlled by the requested side', () => {
  const world = {
    units: [
      villager(8),
      villager(3),
      villager(5, { job: { kind: 'build', targetId: 20 } }),
      villager(6, { side: 1 }),
      villager(7, { alive: false }),
      { ...villager(9), type: 'pike' },
    ],
  };

  const status = getVillagerStatus(world, 0);
  assert.equal(status.total, 3);
  assert.equal(status.idle, 2);
  assert.deepEqual(status.idleVillagers.map(unit => unit.id), [8, 3]);
});

test('next-idle selection cycles in stable unit-id order and wraps', () => {
  const world = { units: [villager(14), villager(2), villager(9)] };

  assert.equal(getNextIdleVillager(world, 0)?.id, 2);
  assert.equal(getNextIdleVillager(world, 0, 2)?.id, 9);
  assert.equal(getNextIdleVillager(world, 0, 9)?.id, 14);
  assert.equal(getNextIdleVillager(world, 0, 14)?.id, 2);
  assert.equal(getNextIdleVillager(world, 0, 999)?.id, 2);
  assert.equal(getNextIdleVillager({ units: [villager(1, { state: 'move' })] }, 0), null);
});
