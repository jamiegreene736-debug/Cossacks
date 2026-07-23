import { CHARACTER_WALK_FRAME_COUNT, getCharacterWalkFrame } from './character-animation.js';

export const WORKER_WALK_FRAME_COUNT = CHARACTER_WALK_FRAME_COUNT;

const WORK_FRAMES = Object.freeze({
  build: 7,
  chop: 9,
  mine: 11,
  farm: 13,
  forage: 15,
});

const COMBAT_FRAMES = Object.freeze({
  ready: 17,
  advance: 18,
  fire: 19,
  reload: 20,
});

const CARRY_FRAMES = Object.freeze({
  woodFirst: 21,
  woodLast: 24,
  resourceFirst: 25,
  resourceLast: 28,
  count: 4,
});

const WOMAN_WORKER_FRAMES = Object.freeze({
  idle: 0,
  walkFirst: 1,
  walkLast: CHARACTER_WALK_FRAME_COUNT,
  work: 7,
  deploy: 8,
  aim: 9,
  fire: 10,
  reload: 11,
});

const RESOURCE_ACTIONS = Object.freeze({
  wood: 'chop',
  gold: 'mine',
  stone: 'mine',
  food: 'forage',
});

export function resolveWorkerAction(job, target) {
  if (job?.kind === 'build' || job?.kind === 'repair') return 'build';
  if (job?.kind === 'workplace') return RESOURCE_ACTIONS[job.resourceType] || null;
  if (job?.kind !== 'gather' || !target) return null;
  if (target.entityKind === 'building' && target.type === 'farm') return 'farm';
  return RESOURCE_ACTIONS[target.resourceType] || null;
}

export function getWorkerFrame(worker, combatReady = false) {
  if (worker.fireT > 0) return COMBAT_FRAMES.fire;
  if (worker.orderTarget) {
    if (worker.moving) return COMBAT_FRAMES.advance;
    if (worker.reload > 0) return COMBAT_FRAMES.reload;
    return COMBAT_FRAMES.ready;
  }
  if (combatReady) return COMBAT_FRAMES.ready;
  if (worker.state === 'work') {
    const action = WORK_FRAMES[worker.workAction]
      ? worker.workAction
      : worker.job?.kind === 'build' || worker.job?.kind === 'repair' ? 'build' : 'chop';
    const strikePhase = ((worker.animT * 2) | 0) & 1;
    return WORK_FRAMES[action] + strikePhase;
  }
  if (worker.moving && (Number(worker.job?.carriedAmount) || 0) > 0) {
    const first = worker.job?.resourceType === 'wood'
      ? CARRY_FRAMES.woodFirst : CARRY_FRAMES.resourceFirst;
    return first + getCharacterWalkFrame(worker, CARRY_FRAMES.count);
  }
  if (worker.moving) return 1 + getCharacterWalkFrame(worker, WORKER_WALK_FRAME_COUNT);
  return 0;
}

export function getWomanVillagerFrame(worker, combatReady = false) {
  if (worker.fireT > 0) return WOMAN_WORKER_FRAMES.fire;
  if (worker.orderTarget) {
    if (worker.moving) return WOMAN_WORKER_FRAMES.deploy;
    if (worker.reload > 0) return WOMAN_WORKER_FRAMES.reload;
    return WOMAN_WORKER_FRAMES.aim;
  }
  if (combatReady) return WOMAN_WORKER_FRAMES.aim;
  if (worker.state === 'work') {
    return ((worker.animT * 2) | 0) & 1
      ? WOMAN_WORKER_FRAMES.work : WOMAN_WORKER_FRAMES.idle;
  }
  if (worker.moving) {
    return WOMAN_WORKER_FRAMES.walkFirst + getCharacterWalkFrame(worker);
  }
  return WOMAN_WORKER_FRAMES.idle;
}

export { CARRY_FRAMES, COMBAT_FRAMES, WOMAN_WORKER_FRAMES, WORK_FRAMES };
