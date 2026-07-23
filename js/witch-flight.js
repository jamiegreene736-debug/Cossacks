const TAU = Math.PI * 2;

export const WITCH_FLIGHT_FRAME = Object.freeze({
  grounded: 0,
  launch: 1,
  hover: 2,
  cruise: 3,
  bank: 4,
  brake: 5,
  cast: 6,
  land: 7,
});

export const WITCH_FLIGHT_HEIGHT = 16;
export const WITCH_HOVER_HEIGHT = 13;
export const WITCH_BANK_LIMIT = 0.14;

export function isBroomWitch(unit) {
  return unit?.unitType === 'witch_worker' || unit?.unitType === 'witch_duelist';
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function approach(current, target, maxDelta) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function wrapAngle(value) {
  let wrapped = value % TAU;
  if (wrapped > Math.PI) wrapped -= TAU;
  if (wrapped < -Math.PI) wrapped += TAU;
  return wrapped;
}

// Stable critically damped spring. It follows the Game Programming Gems
// SmoothDamp form: fast response without the altitude overshoot that makes a
// hovering figure look as if it is bouncing on invisible steps.
export function smoothDamp(
  current,
  target,
  velocity,
  smoothTime,
  maxSpeed,
  dt,
) {
  const safeTime = Math.max(0.0001, smoothTime);
  const omega = 2 / safeTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const originalTarget = target;
  const maxChange = maxSpeed * safeTime;
  let change = clamp(current - target, -maxChange, maxChange);
  target = current - change;
  const temporary = (velocity + omega * change) * dt;
  let nextVelocity = (velocity - omega * temporary) * decay;
  let value = target + (change + temporary) * decay;

  if ((originalTarget - current > 0) === (value > originalTarget)) {
    value = originalTarget;
    nextVelocity = 0;
  }
  return { value, velocity: nextVelocity };
}

export function initializeWitchFlight(unit) {
  if (!isBroomWitch(unit)) return unit;
  unit.flightHeight = Number.isFinite(unit.flightHeight) ? Math.max(0, unit.flightHeight) : 0;
  unit.pFlightHeight = Number.isFinite(unit.pFlightHeight)
    ? Math.max(0, unit.pFlightHeight) : unit.flightHeight;
  unit.flightVerticalVelocity = Number.isFinite(unit.flightVerticalVelocity)
    ? unit.flightVerticalVelocity : 0;
  unit.flightVx = Number.isFinite(unit.flightVx) ? unit.flightVx : 0;
  unit.flightVy = Number.isFinite(unit.flightVy) ? unit.flightVy : 0;
  unit.flightHeading = Number.isFinite(unit.flightHeading)
    ? unit.flightHeading : unit.facing >= 0 ? 0 : Math.PI;
  unit.flightTargetHeading = Number.isFinite(unit.flightTargetHeading)
    ? unit.flightTargetHeading : unit.flightHeading;
  unit.flightBank = Number.isFinite(unit.flightBank) ? unit.flightBank : 0;
  unit.pFlightBank = Number.isFinite(unit.pFlightBank) ? unit.pFlightBank : unit.flightBank;
  unit.flightBankVelocity = Number.isFinite(unit.flightBankVelocity)
    ? unit.flightBankVelocity : 0;
  unit.flightBankTarget = Number.isFinite(unit.flightBankTarget) ? unit.flightBankTarget : 0;
  unit.flightTime = Number.isFinite(unit.flightTime) ? unit.flightTime : 0;
  unit.flightState = typeof unit.flightState === 'string' ? unit.flightState : 'grounded';
  if (typeof unit.flightThrusted !== 'boolean') unit.flightThrusted = false;
  return unit;
}

export function snapshotWitchFlight(unit) {
  if (!isBroomWitch(unit)) return;
  initializeWitchFlight(unit);
  unit.pFlightHeight = unit.flightHeight;
  unit.pFlightBank = unit.flightBank;
  unit.flightThrusted = false;
}

export function moveBroomWitch(unit, directionX, directionY, speed, distance, stopAt, dt) {
  initializeWitchFlight(unit);
  const desiredHeading = Math.atan2(directionY, directionX);
  const headingDelta = wrapAngle(desiredHeading - unit.flightHeading);
  const maxHeadingStep = 5.2 * dt;
  unit.flightHeading += clamp(headingDelta, -maxHeadingStep, maxHeadingStep);
  unit.flightTargetHeading = desiredHeading;
  unit.flightBankTarget = clamp(headingDelta * 0.7, -WITCH_BANK_LIMIT, WITCH_BANK_LIMIT);

  const brakingDistance = Math.max(0, distance - stopAt);
  const acceleration = Math.max(170, speed * 3.8);
  const brakingSpeed = Math.sqrt(Math.max(0, 2 * acceleration * brakingDistance));
  const targetSpeed = Math.min(speed, brakingSpeed);
  const targetVx = directionX * targetSpeed;
  const targetVy = directionY * targetSpeed;
  unit.flightVx = approach(unit.flightVx, targetVx, acceleration * dt);
  unit.flightVy = approach(unit.flightVy, targetVy, acceleration * dt);

  let stepX = unit.flightVx * dt;
  let stepY = unit.flightVy * dt;
  const stepDistance = Math.hypot(stepX, stepY);
  if (stepDistance > brakingDistance && stepDistance > 0) {
    const scale = brakingDistance / stepDistance;
    stepX *= scale;
    stepY *= scale;
    unit.flightVx = 0;
    unit.flightVy = 0;
  }
  unit.x += stepX;
  unit.y += stepY;
  unit.flightThrusted = true;
  unit.moving = Math.hypot(unit.flightVx, unit.flightVy) > 0.5;
  if (Math.abs(unit.flightVx) > 1.5) unit.facing = unit.flightVx > 0 ? 1 : -1;
  return Math.hypot(stepX, stepY);
}

export function stepWitchFlight(unit, dt) {
  if (!isBroomWitch(unit)) return;
  initializeWitchFlight(unit);
  unit.flightTime += dt;

  const landing = unit.state === 'land' || unit.state === 'work' || Boolean(unit.wallMount);
  const casting = unit.fireT > 0;
  const braking = !unit.flightThrusted && Math.hypot(unit.flightVx, unit.flightVy) > 0.5;

  if (!unit.flightThrusted) {
    const deceleration = landing ? 420 : 230;
    unit.flightVx = approach(unit.flightVx, 0, deceleration * dt);
    unit.flightVy = approach(unit.flightVy, 0, deceleration * dt);
    if (!landing) {
      unit.x += unit.flightVx * dt;
      unit.y += unit.flightVy * dt;
    } else {
      unit.flightVx = 0;
      unit.flightVy = 0;
    }
    unit.moving = Math.hypot(unit.flightVx, unit.flightVy) > 0.5;
    unit.flightBankTarget = 0;
  }

  const targetHeight = landing
    ? 0
    : casting ? WITCH_FLIGHT_HEIGHT + 2
      : unit.moving || braking ? WITCH_FLIGHT_HEIGHT : WITCH_HOVER_HEIGHT;
  const vertical = smoothDamp(
    unit.flightHeight,
    targetHeight,
    unit.flightVerticalVelocity,
    landing ? 0.18 : 0.24,
    90,
    dt,
  );
  unit.flightHeight = Math.max(0, vertical.value);
  unit.flightVerticalVelocity = vertical.velocity;

  const bank = smoothDamp(
    unit.flightBank,
    landing ? 0 : unit.flightBankTarget,
    unit.flightBankVelocity,
    0.16,
    1.4,
    dt,
  );
  unit.flightBank = clamp(bank.value, -WITCH_BANK_LIMIT, WITCH_BANK_LIMIT);
  unit.flightBankVelocity = bank.velocity;

  if (landing && unit.flightHeight <= 0.18) {
    unit.flightHeight = 0;
    unit.flightVerticalVelocity = 0;
    unit.flightState = unit.state === 'work' ? 'grounded' : 'grounded';
  } else if (casting) {
    unit.flightState = 'cast';
  } else if (landing) {
    unit.flightState = 'land';
  } else if (unit.flightHeight < targetHeight * 0.72) {
    unit.flightState = 'launch';
  } else if (Math.abs(unit.flightBank) > 0.045) {
    unit.flightState = 'bank';
  } else if (braking) {
    unit.flightState = 'brake';
  } else if (unit.moving) {
    unit.flightState = 'cruise';
  } else {
    unit.flightState = 'hover';
  }
  unit.flightThrusted = false;
}

export function isWitchGrounded(unit) {
  return !isBroomWitch(unit) || (Number(unit.flightHeight) || 0) <= 0.2;
}

export function getWitchFlightFrame(unit) {
  if (!isBroomWitch(unit)) return WITCH_FLIGHT_FRAME.grounded;
  return WITCH_FLIGHT_FRAME[unit.flightState] ?? WITCH_FLIGHT_FRAME.hover;
}

export function getWitchFlightVisual(unit, alpha = 1) {
  initializeWitchFlight(unit);
  const height = unit.pFlightHeight + (unit.flightHeight - unit.pFlightHeight) * alpha;
  const bank = unit.pFlightBank + (unit.flightBank - unit.pFlightBank) * alpha;
  const airborne = clamp(height / WITCH_FLIGHT_HEIGHT, 0, 1);
  const hover = Math.sin(unit.flightTime * 2.2 + unit.id * 0.73) * 0.42 * airborne;
  const speed = Math.hypot(unit.flightVx, unit.flightVy);
  const cruiseStretch = clamp(speed / Math.max(1, unit.speed), 0, 1);
  return {
    height,
    motion: {
      phase: 0,
      shiftX: 0,
      shiftY: hover,
      rotation: bank,
      scaleX: 1 + cruiseStretch * 0.008,
      scaleY: 1 - cruiseStretch * 0.006,
      headShiftX: 0,
      headShiftY: -hover * 0.32,
      headRotation: -bank * 0.38,
      articulateHead: false,
    },
  };
}
