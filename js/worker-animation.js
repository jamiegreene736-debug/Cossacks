const WORK_FRAMES = Object.freeze({
  build: 3,
  chop: 5,
  mine: 7,
  farm: 9,
  forage: 11,
});

const RESOURCE_ACTIONS = Object.freeze({
  wood: 'chop',
  gold: 'mine',
  stone: 'mine',
  food: 'forage',
});

export function resolveWorkerAction(job, target) {
  if (job?.kind === 'build') return 'build';
  if (job?.kind !== 'gather' || !target) return null;
  if (target.entityKind === 'building' && target.type === 'farm') return 'farm';
  return RESOURCE_ACTIONS[target.resourceType] || null;
}

export function getWorkerFrame(worker) {
  if (worker.state === 'work') {
    const action = WORK_FRAMES[worker.workAction]
      ? worker.workAction
      : worker.job?.kind === 'build' ? 'build' : 'chop';
    const strikePhase = ((worker.animT * 2) | 0) & 1;
    return WORK_FRAMES[action] + strikePhase;
  }
  if (worker.moving) return 1 + (((worker.animT * 6) | 0) % 2);
  return 0;
}

export { WORK_FRAMES };
