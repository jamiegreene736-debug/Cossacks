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

export const WITCH_FLIGHT_HEIGHT = 28;
export const WITCH_HOVER_HEIGHT = 21;
export const WITCH_TAKEOFF_CLEARANCE = 10;
export const WITCH_BANK_LIMIT = 0.38;
const WITCH_MAX_TURN_RATE = 4.4;
const WITCH_PLAYFUL_PERIOD = 7.5;
const WITCH_COURSE_RESET_ANGLE = 0.72;
const WITCH_COURSE_RESET_DISTANCE = 70;

export function isBroomWitch(unit) {
  return unit?.unitType === 'witch_worker' || unit?.unitType === 'witch_duelist'
    || unit?.unitType === 'broom_rider';
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

function normalize(x, y) {
  const length = Math.hypot(x, y);
  return length > 1e-6 ? { x: x / length, y: y / length, length } : { x: 1, y: 0, length: 0 };
}

function seededUnitNoise(unit, salt = 0) {
  const id = Number.isFinite(unit?.id) ? unit.id : 1;
  const n = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function retargetFlightCourse(unit, desiredHeading, distance) {
  const finiteDistance = Number.isFinite(distance) ? distance : 900;
  const lastHeading = Number.isFinite(unit.flightCourseHeading) ? unit.flightCourseHeading : desiredHeading;
  const lastDistance = Number.isFinite(unit.flightCourseDistance) ? unit.flightCourseDistance : finiteDistance;
  const needsCourse = !unit.flightCourse
    || Math.abs(wrapAngle(desiredHeading - lastHeading)) > WITCH_COURSE_RESET_ANGLE
    || finiteDistance > lastDistance + WITCH_COURSE_RESET_DISTANCE;
  if (!needsCourse) {
    unit.flightCourseDistance = finiteDistance;
    return;
  }
  const seed = seededUnitNoise(unit, finiteDistance * 0.013);
  unit.flightCourse = {
    sign: seed < 0.5 ? -1 : 1,
    curvature: 0.18 + seed * 0.26,
    phase: seed * TAU,
    startedAt: unit.flightTime || 0,
  };
  unit.flightCourseHeading = desiredHeading;
  unit.flightCourseDistance = finiteDistance;
}

function obstacleAvoidance(world, unit, dirX, dirY) {
  if (!world) return { x: 0, y: 0, strength: 0 };
  const lookAhead = 34 + Math.min(46, Math.hypot(unit.flightVx || 0, unit.flightVy || 0) * 0.42);
  const probeX = unit.x + dirX * lookAhead;
  const probeY = unit.y + dirY * lookAhead;
  let ax = 0;
  let ay = 0;
  let strength = 0;
  const consider = (x, y, radius, alive = true) => {
    if (!alive) return;
    const dx = probeX - x;
    const dy = probeY - y;
    const safe = Math.max(18, radius + unit.radius + 34);
    const d = Math.hypot(dx, dy);
    if (d >= safe || d < 1e-6) return;
    const weight = (safe - d) / safe;
    ax += dx / d * weight;
    ay += dy / d * weight;
    strength = Math.max(strength, weight);
  };
  for (const building of world.buildings || []) {
    if (!building?.alive) continue;
    consider(building.x, building.y, building.radius || 40, true);
  }
  for (const resource of world.resources || []) {
    if (!resource?.alive || resource.amount <= 0) continue;
    consider(resource.x, resource.y, resource.radius || 28, true);
  }
  return { x: ax, y: ay, strength: clamp(strength, 0, 1) };
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
  unit.flightCourseHeading = Number.isFinite(unit.flightCourseHeading)
    ? unit.flightCourseHeading : unit.flightHeading;
  unit.flightCourseDistance = Number.isFinite(unit.flightCourseDistance)
    ? unit.flightCourseDistance : 0;
  unit.flightPitch = Number.isFinite(unit.flightPitch) ? unit.flightPitch : 0;
  unit.pFlightPitch = Number.isFinite(unit.pFlightPitch) ? unit.pFlightPitch : unit.flightPitch;
  unit.flightPitchVelocity = Number.isFinite(unit.flightPitchVelocity) ? unit.flightPitchVelocity : 0;
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
  unit.pFlightPitch = unit.flightPitch;
  unit.flightThrusted = false;
}

export function moveBroomWitch(unit, directionX, directionY, speed, distance, stopAt, dt, options = {}) {
  initializeWitchFlight(unit);
  const initial = normalize(directionX, directionY);
  const desiredHeading = Math.atan2(initial.y, initial.x);
  retargetFlightCourse(unit, desiredHeading, distance);

  const finiteDistance = Number.isFinite(distance) ? distance : 900;
  const arrivalT = clamp((finiteDistance - stopAt) / 260, 0, 1);
  const airborneT = clamp(unit.flightHeight / Math.max(1, WITCH_FLIGHT_HEIGHT), 0, 1);
  const course = unit.flightCourse || { sign: 1, curvature: 0, phase: 0, startedAt: unit.flightTime || 0 };
  const playful = Math.sin((unit.flightTime - course.startedAt) / WITCH_PLAYFUL_PERIOD * TAU + course.phase) * 0.055;
  const curveWeight = course.sign * course.curvature * (0.22 + arrivalT * 0.78) * airborneT + playful * airborneT;
  const avoidance = obstacleAvoidance(options.world, unit, initial.x, initial.y);
  const steered = normalize(
    initial.x - initial.y * curveWeight + avoidance.x * (0.85 + avoidance.strength),
    initial.y + initial.x * curveWeight + avoidance.y * (0.85 + avoidance.strength),
  );
  unit.flightCurve = curveWeight;
  unit.flightAvoidance = avoidance.strength;

  const steeredHeading = Math.atan2(steered.y, steered.x);
  const headingDelta = wrapAngle(steeredHeading - unit.flightHeading);
  const speedRatio = Math.min(1.45, Math.hypot(unit.flightVx, unit.flightVy) / Math.max(1, speed));
  const maxHeadingStep = WITCH_MAX_TURN_RATE * (0.75 + speedRatio * 0.4) * dt;
  unit.flightHeading += clamp(headingDelta, -maxHeadingStep, maxHeadingStep);
  unit.flightHeading = wrapAngle(unit.flightHeading);
  unit.flightTargetHeading = steeredHeading;
  const turnIntensity = clamp(headingDelta * 0.86 + curveWeight * 0.46 + avoidance.strength * 0.22,
    -WITCH_BANK_LIMIT, WITCH_BANK_LIMIT);
  unit.flightBankTarget = turnIntensity;

  const brakingDistance = Math.max(0, distance - stopAt);
  const acceleration = Math.max(150, speed * 3.1);
  const deceleration = Math.max(190, speed * 3.8);
  const brakingSpeed = Math.sqrt(Math.max(0, 2 * acceleration * brakingDistance));
  const liftLimiter = 0.42 + airborneT * 0.58;
  const targetSpeed = Math.min(speed * (1.03 + Math.abs(curveWeight) * 0.05), brakingSpeed) * liftLimiter;
  const targetVx = steered.x * targetSpeed;
  const targetVy = steered.y * targetSpeed;
  const maxDelta = (targetSpeed < Math.hypot(unit.flightVx, unit.flightVy) ? deceleration : acceleration) * dt;
  unit.flightVx = approach(unit.flightVx, targetVx, maxDelta);
  unit.flightVy = approach(unit.flightVy, targetVy, maxDelta);

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
  const speed = Math.hypot(unit.flightVx, unit.flightVy);

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
      : unit.moving || braking ? WITCH_FLIGHT_HEIGHT + Math.min(6, speed * 0.028) : WITCH_HOVER_HEIGHT;
  const vertical = smoothDamp(
    unit.flightHeight,
    targetHeight,
    unit.flightVerticalVelocity,
    landing ? 0.24 : unit.flightHeight < WITCH_TAKEOFF_CLEARANCE ? 0.18 : 0.28,
    landing ? 82 : 105,
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

  const pitchTarget = landing ? 0.12
    : unit.flightThrusted ? clamp(speed / Math.max(1, unit.speed) * 0.16 - Math.abs(unit.flightBank) * 0.05, -0.08, 0.19)
      : braking ? -0.12 : 0.02;
  const pitch = smoothDamp(unit.flightPitch, pitchTarget, unit.flightPitchVelocity, 0.22, 1.2, dt);
  unit.flightPitch = clamp(pitch.value, -0.18, 0.22);
  unit.flightPitchVelocity = pitch.velocity;

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
  const pitch = unit.pFlightPitch + (unit.flightPitch - unit.pFlightPitch) * alpha;
  const airborne = clamp(height / WITCH_FLIGHT_HEIGHT, 0, 1);
  const hover = (
    Math.sin(unit.flightTime * 2.15 + unit.id * 0.73) * 0.72
    + Math.sin(unit.flightTime * 0.86 + unit.id * 1.91) * 0.36
  ) * airborne;
  const cloakSway = (
    Math.sin(unit.flightTime * 3.8 + unit.id * 0.41) * 0.32
    + Math.sin(unit.flightTime * 1.35 + unit.id * 0.17) * 0.22
  ) * airborne;
  const speed = Math.hypot(unit.flightVx, unit.flightVy);
  const cruiseStretch = clamp(speed / Math.max(1, unit.speed), 0, 1);
  const curve = Number.isFinite(unit.flightCurve) ? unit.flightCurve : 0;
  const avoidance = Number.isFinite(unit.flightAvoidance) ? unit.flightAvoidance : 0;
  const robeFlutter = airborne * (0.3 + cruiseStretch * 0.7)
    * Math.sin(unit.flightTime * (6.2 + cruiseStretch * 2.8) + unit.id * 0.29);
  const casting = unit.fireT > 0;
  const trailAlpha = airborne * (0.25 + cruiseStretch * 0.48 + Math.abs(bank) * 0.22 + (casting ? 0.2 : 0));
  const trailLength = airborne * (10 + cruiseStretch * 34 + Math.abs(bank) * 18 + (casting ? 10 : 0));
  const silhouetteAlpha = airborne * (0.82 + cruiseStretch * 0.12 + (casting ? 0.06 : 0));
  return {
    height,
    airborne,
    speedRatio: cruiseStretch,
    bank,
    pitch,
    curve,
    avoidance,
    robeFlutter,
    castGlow: casting ? Math.min(1, unit.fireT * 5) : 0,
    trailAlpha,
    trailLength,
    silhouetteAlpha,
    motion: {
      phase: 0,
      shiftX: cloakSway,
      shiftY: hover,
      rotation: bank * 1.32 + pitch * 0.22,
      scaleX: 1 + cruiseStretch * 0.025,
      scaleY: 1 - cruiseStretch * 0.018,
      headShiftX: curve * 1.8,
      headShiftY: -hover * 0.32 - pitch * 2.2,
      headRotation: -bank * 0.42 - pitch * 0.28,
      articulateHead: false,
      broomPitch: pitch,
      robeFlutter,
      wakeCurl: curve + avoidance * 0.15,
    },
  };
}
