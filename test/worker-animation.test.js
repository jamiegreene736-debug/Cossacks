import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARRY_FRAMES, COMBAT_FRAMES, resolveWorkerAction, getWorkerFrame,
} from '../js/worker-animation.js';

test('worker jobs resolve to historically legible tool actions', () => {
  const gather = { kind: 'gather', targetId: 7 };
  assert.equal(resolveWorkerAction({ kind: 'build', targetId: 1 }, {}), 'build');
  assert.equal(resolveWorkerAction({ kind: 'repair', targetId: 2 }, {}), 'build');
  assert.equal(resolveWorkerAction(gather, { entityKind: 'resource', resourceType: 'wood' }), 'chop');
  assert.equal(resolveWorkerAction(gather, { entityKind: 'resource', resourceType: 'stone' }), 'mine');
  assert.equal(resolveWorkerAction(gather, { entityKind: 'resource', resourceType: 'gold' }), 'mine');
  assert.equal(resolveWorkerAction(gather, { entityKind: 'resource', resourceType: 'food' }), 'forage');
  assert.equal(resolveWorkerAction(gather, {
    entityKind: 'building', type: 'farm', resourceType: 'food',
  }), 'farm');
  assert.equal(resolveWorkerAction({
    kind: 'workplace', targetId: 9, resourceType: 'food',
  }, { entityKind: 'building', type: 'mill' }), 'forage');
  assert.equal(resolveWorkerAction({
    kind: 'workplace', targetId: 10, resourceType: 'stone',
  }, { entityKind: 'building', type: 'mine' }), 'mine');
});

test('work animation alternates two cached frames for each tool', () => {
  const worker = { state: 'work', moving: false, workAction: 'mine', animT: 0 };
  assert.equal(getWorkerFrame(worker), 7);
  worker.animT = 0.5;
  assert.equal(getWorkerFrame(worker), 8);
  worker.workAction = 'farm';
  assert.equal(getWorkerFrame(worker), 10);
});

test('walking and idle workers keep the established civilian frames', () => {
  assert.equal(getWorkerFrame({ state: 'idle', moving: false, animT: 0 }), 0);
  assert.equal(getWorkerFrame({ state: 'move', moving: true, animT: 0 }), 1);
  assert.equal(getWorkerFrame({ state: 'move', moving: true, animT: 0.2 }), 2);
});

test('villagers carrying gathered resources use the laden walking frames', () => {
  const worker = {
    state: 'move', moving: true, animT: 0,
    job: { kind: 'gather', targetId: 1, carriedAmount: 10, phase: 'deliver' },
  };
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.first);
  worker.animT = 0.2;
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.second);
});

test('villagers visibly draw, advance, fire, reload and holster their muskets', () => {
  const worker = {
    state: 'idle', moving: false, animT: 0, fireT: 0, reload: 0, orderTarget: null,
  };
  assert.equal(getWorkerFrame(worker, true), COMBAT_FRAMES.ready);

  worker.orderTarget = { alive: true };
  worker.moving = true;
  assert.equal(getWorkerFrame(worker), COMBAT_FRAMES.advance);

  worker.moving = false;
  worker.fireT = 0.1;
  assert.equal(getWorkerFrame(worker), COMBAT_FRAMES.fire);

  worker.fireT = 0;
  worker.reload = 4;
  assert.equal(getWorkerFrame(worker), COMBAT_FRAMES.reload);

  worker.orderTarget = null;
  assert.equal(getWorkerFrame(worker), 0, 'a completed or replaced attack order holsters the musket');
});
