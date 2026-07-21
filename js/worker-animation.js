const WORK_FRAMES = Object.freeze({
  build: 3,
  chop: 5,
  mine: 7,
  farm: 9,
  forage: 11,
});

const COMBAT_FRAMES = Object.freeze({
  ready: 13,
  advance: 14,
  fire: 15,
  reload: 16,
});

const CARRY_FRAMES = Object.freeze({
  woodFirst: 17,
  woodLast: 20,
  resourceFirst: 21,
  resourceLast: 24,
  count: 4,
});

const WOMAN_WORKER_FRAMES = Object.freeze({
  idle: 0,
  walkFirst: 1,
  work: 3,
  deploy: 4,
  aim: 5,
  fire: 6,
  reload: 7,
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
    return first + (((worker.animT * 6) | 0) % CARRY_FRAMES.count);
  }
  if (worker.moving) return 1 + (((worker.animT * 6) | 0) % 2);
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
    return WOMAN_WORKER_FRAMES.walkFirst + (((worker.animT * 6) | 0) & 1);
  }
  return WOMAN_WORKER_FRAMES.idle;
}

export { CARRY_FRAMES, COMBAT_FRAMES, WOMAN_WORKER_FRAMES, WORK_FRAMES };
