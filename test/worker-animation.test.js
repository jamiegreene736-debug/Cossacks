import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWorkerAction, getWorkerFrame } from '../js/worker-animation.js';

test('worker jobs resolve to historically legible tool actions', () => {
  const gather = { kind: 'gather', targetId: 7 };
  assert.equal(resolveWorkerAction({ kind: 'build', targetId: 1 }, {}), 'build');
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
