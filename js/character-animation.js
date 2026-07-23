// Shared locomotion and action presentation for every character renderer.
// Gaits advance from actual ground covered, not elapsed time, so feet cannot
// cycle beneath a stationary unit or slide at a different rate from movement.

export const CHARACTER_WALK_FRAME_COUNT = 6;

const TAU = Math.PI * 2;

const STRIDE_LENGTH = Object.freeze({
  villager: 29,
  musk: 31,
  pike: 31,
  cav: 48,
  gun: 54,
});

function unitStrideLength(unit) {
  if (unit.type === 'cav' || unit.unitType === 'starwars_skiff_rider') return STRIDE_LENGTH.cav;
  if (unit.type === 'gun' || unit.unitType === 'starwars_pulse_cannon') return STRIDE_LENGTH.gun;
  if (unit.type === 'villager') return STRIDE_LENGTH.villager;
  return STRIDE_LENGTH[unit.type] || 31;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function advanceCharacterGait(unit, distance) {
  if (!(distance > 0)) return;
  const currentDistance = Number.isFinite(unit.gaitDistance)
    ? unit.gaitDistance
    : (Number(unit.animT) || 0) * unitStrideLength(unit);
  unit.gaitDistance = currentDistance + distance;
}

export function getCharacterGaitPhase(unit) {
  const distance = Number.isFinite(unit.gaitDistance)
    ? unit.gaitDistance
    : (Number(unit.animT) || 0) * unitStrideLength(unit);
  const offsetFrames = Number.isFinite(unit.walkPhaseOffset) ? unit.walkPhaseOffset : 0;
  return positiveModulo(
    distance / unitStrideLength(unit) + offsetFrames / CHARACTER_WALK_FRAME_COUNT,
    1,
  );
}

export function getCharacterWalkFrame(unit, frameCount = CHARACTER_WALK_FRAME_COUNT) {
  return Math.floor(getCharacterGaitPhase(unit) * frameCount + 1e-9) % frameCount;
}

function attackDuration(unit) {
  if (unit.unitType === 'woman_villager') return 0.52;
  if (unit.type === 'gun' || unit.unitType === 'starwars_pulse_cannon') return 0.25;
  if (unit.projectileKind) return 0.32;
  if (unit.torchT > 0) return 0.18;
  return 0.13;
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function getCharacterMotion(unit, visualFacing = 1) {
  const phase = getCharacterGaitPhase(unit);
  const strideWave = Math.sin(phase * TAU);
  const contactLift = Math.abs(Math.sin(phase * TAU));
  const mounted = unit.type === 'cav' || unit.unitType === 'starwars_skiff_rider';
  const heavy = unit.type === 'gun' || unit.unitType === 'starwars_pulse_cannon';
  const movingWeight = unit.moving ? 1 : 0;
  const bobScale = mounted ? 0.72 : heavy ? 0.18 : unit.type === 'villager' ? 0.52 : 0.62;
  const rollScale = mounted ? 0.012 : heavy ? 0.004 : 0.022;

  let shiftX = strideWave * (mounted ? 0.42 : 0.58) * movingWeight;
  let shiftY = -contactLift * bobScale * movingWeight;
  let rotation = strideWave * rollScale * visualFacing * movingWeight;
  let scaleX = 1;
  let scaleY = 1;

  if (unit.fireT > 0) {
    const progress = 1 - Math.max(0, Math.min(1, unit.fireT / attackDuration(unit)));
    const recoil = Math.sin(smoothstep(progress) * Math.PI);
    const settle = Math.sin(Math.min(1, progress * 1.35) * Math.PI);
    shiftX -= visualFacing * recoil * (heavy ? 1.3 : mounted ? 0.9 : 0.72);
    shiftY += recoil * (heavy ? 0.18 : 0.34);
    rotation -= visualFacing * recoil * (heavy ? 0.008 : 0.035);
    scaleX += settle * (heavy ? 0.006 : 0.018);
    scaleY -= settle * (heavy ? 0.004 : 0.014);
  }

  return {
    phase,
    shiftX,
    shiftY,
    rotation,
    scaleX,
    scaleY,
    // The head counters most of the torso roll and vertical bounce. This keeps
    // the gaze readable while shoulders, coat, weapon and hips transfer weight.
    headShiftX: -shiftX * 0.22,
    headShiftY: -shiftY * 0.58,
    headRotation: -rotation * 0.72,
    articulateHead: !mounted && !heavy && !(unit.fireT > 0),
  };
}
