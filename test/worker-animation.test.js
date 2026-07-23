import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARRY_FRAMES, COMBAT_FRAMES, WOMAN_WORKER_FRAMES,
  resolveWorkerAction, getWomanVillagerFrame, getWorkerFrame,
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
  assert.equal(getWorkerFrame(worker), 11);
  worker.animT = 0.5;
  assert.equal(getWorkerFrame(worker), 12);
  worker.workAction = 'farm';
  assert.equal(getWorkerFrame(worker), 14);
});

test('walking workers use all six distance-synchronized civilian poses', () => {
  assert.equal(getWorkerFrame({ state: 'idle', moving: false, animT: 0 }), 0);
  const worker = { state: 'move', type: 'villager', moving: true, gaitDistance: 0 };
  const frames = [];
  for (let index = 0; index < 6; index++) {
    worker.gaitDistance = index * (29 / 6);
    frames.push(getWorkerFrame(worker));
  }
  assert.deepEqual(frames, [1, 2, 3, 4, 5, 6]);
});

test('villagers carrying gathered resources use the laden walking frames', () => {
  const worker = {
    state: 'move', type: 'villager', moving: true, animT: 0, gaitDistance: 0,
    job: {
      kind: 'gather', targetId: 1, carriedAmount: 10, phase: 'deliver', resourceType: 'wood',
    },
  };
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.woodFirst);
  worker.gaitDistance = 29 / 4;
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.woodFirst + 1);
  worker.gaitDistance = 29 * 3 / 4;
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.woodLast);

  worker.job.resourceType = 'stone';
  worker.gaitDistance = 0;
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.resourceFirst);
  worker.gaitDistance = 29 * 3 / 4;
  assert.equal(getWorkerFrame(worker), CARRY_FRAMES.resourceLast);
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

test('woman villagers visibly work, wheel out, fire and reload their cannon', () => {
  const worker = {
    state: 'idle', moving: false, animT: 0, fireT: 0, reload: 0, orderTarget: null,
  };
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.idle);

  worker.moving = true;
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.walkFirst);

  worker.moving = false;
  worker.state = 'work';
  worker.animT = 0.5;
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.work);

  worker.state = 'idle';
  worker.orderTarget = { alive: true };
  worker.moving = true;
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.deploy);

  worker.moving = false;
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.aim);

  worker.fireT = 0.1;
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.fire);

  worker.fireT = 0;
  worker.reload = 4;
  assert.equal(getWomanVillagerFrame(worker), WOMAN_WORKER_FRAMES.reload);
});
