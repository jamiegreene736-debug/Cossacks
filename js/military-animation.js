// Cached military atlases keep locomotion separate from combat presentation.
// Foot and mounted units travel with their weapon secured, then return to the
// ready pose as soon as movement ends. Artillery retains its compact 2-frame
// idle/fire sheet.

export const MILITARY_FRAME = Object.freeze({
  READY: 0,
  TRAVEL_A: 1,
  TRAVEL_B: 2,
  ATTACK: 3,
});

export function getMilitaryFrame(unit) {
  if (unit.type === 'gun') return unit.fireT > 0 ? 1 : 0;

  if (unit.moving) {
    return MILITARY_FRAME.TRAVEL_A + (((unit.animT * 6) | 0) % 2);
  }

  return unit.fireT > 0 ? MILITARY_FRAME.ATTACK : MILITARY_FRAME.READY;
}
