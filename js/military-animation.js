// Cached military atlases keep locomotion separate from combat presentation.
// Foot and mounted units use authored six-pose cycles, then return to ready as
// soon as movement ends. Artillery retains its compact 2-frame idle/fire sheet.

export const MILITARY_WALK_FRAME_COUNT = 6;

const WALK_FRAMES_PER_SECOND = Object.freeze({
  musk: 8,
  pike: 8,
  cav: 10,
});

const WALK_BOB = Object.freeze({
  musk: 0.38,
  pike: 0.34,
  cav: 0.58,
});

export const MILITARY_FRAME = Object.freeze({
  READY: 0,
  WALK_START: 1,
  WALK_END: MILITARY_WALK_FRAME_COUNT,
  ATTACK: MILITARY_WALK_FRAME_COUNT + 1,
});

function getWalkPhase(unit) {
  const framesPerSecond = WALK_FRAMES_PER_SECOND[unit.type] || 8;
  const formationOffset = Number.isFinite(unit.walkPhaseOffset) ? unit.walkPhaseOffset : 0;
  const phase = unit.animT * framesPerSecond + formationOffset;
  return ((phase % MILITARY_WALK_FRAME_COUNT) + MILITARY_WALK_FRAME_COUNT)
    % MILITARY_WALK_FRAME_COUNT;
}

export function getMilitaryFrame(unit) {
  if (unit.type === 'gun' || unit.unitType === 'starwars_pulse_cannon') {
    return unit.fireT > 0 ? 1 : 0;
  }

  if (unit.moving) {
    return MILITARY_FRAME.WALK_START + Math.floor(getWalkPhase(unit));
  }

  return unit.fireT > 0 ? MILITARY_FRAME.ATTACK : MILITARY_FRAME.READY;
}

export function getMilitaryVerticalOffset(unit) {
  if (!unit.moving || unit.type === 'gun') return 0;

  // Contact poses are authored at phases 0 and 3. The whole cached sprite only
  // rises between contacts, keeping boots and hooves grounded at each footfall.
  const phase = getWalkPhase(unit);
  const lift = Math.abs(Math.sin(phase * Math.PI / 3));
  return lift < 1e-9 ? 0 : -lift * (WALK_BOB[unit.type] || 0.35);
}
