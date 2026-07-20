// Gesture recognition stays independent from DOM wiring so trackpad momentum
// and touch thresholds remain deterministic and testable.

export const TRACKPAD_VIEW_THRESHOLD = 72;
export const TRACKPAD_VIEW_IDLE_MS = 180;
export const TOUCH_VIEW_THRESHOLD = 64;

const HORIZONTAL_DOMINANCE = 1.2;

export function createViewGestureState() {
  return {
    wheelX: 0,
    wheelLastAt: -Infinity,
    wheelLatched: false,
    touchActive: false,
    touchLatched: false,
    touchStartX: 0,
    touchStartY: 0,
  };
}

function scaleWheelDelta(value, deltaMode, viewportSize) {
  if (deltaMode === 1) return value * 16;
  if (deltaMode === 2) return value * Math.max(320, viewportSize || 800);
  return value;
}

export function readTrackpadViewGesture(state, event, now, viewportWidth = 800) {
  const dx = scaleWheelDelta(Number(event?.deltaX) || 0, event?.deltaMode, viewportWidth);
  const dy = scaleWheelDelta(Number(event?.deltaY) || 0, event?.deltaMode, viewportWidth);
  const horizontal = !event?.ctrlKey
    && Math.abs(dx) >= 0.5
    && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE;
  if (!horizontal) return { handled: false, direction: 0 };

  const eventTime = Number.isFinite(now) ? now : 0;
  if (eventTime - state.wheelLastAt > TRACKPAD_VIEW_IDLE_MS) {
    state.wheelX = 0;
    state.wheelLatched = false;
  }
  state.wheelLastAt = eventTime;
  if (state.wheelLatched) return { handled: true, direction: 0 };

  state.wheelX += dx;
  if (Math.abs(state.wheelX) < TRACKPAD_VIEW_THRESHOLD) {
    return { handled: true, direction: 0 };
  }
  const direction = Math.sign(state.wheelX);
  state.wheelX = 0;
  state.wheelLatched = true;
  return { handled: true, direction };
}

function touchCentroid(touches) {
  if (!touches || touches.length !== 3) return null;
  let x = 0;
  let y = 0;
  for (let index = 0; index < touches.length; index++) {
    x += Number(touches[index].clientX) || 0;
    y += Number(touches[index].clientY) || 0;
  }
  return { x: x / touches.length, y: y / touches.length };
}

export function beginThreeFingerViewGesture(state, touches) {
  const point = touchCentroid(touches);
  if (!point) {
    endThreeFingerViewGesture(state);
    return false;
  }
  state.touchActive = true;
  state.touchLatched = false;
  state.touchStartX = point.x;
  state.touchStartY = point.y;
  return true;
}

export function readThreeFingerViewGesture(state, touches) {
  const point = touchCentroid(touches);
  if (!state.touchActive || !point) return { handled: false, direction: 0 };
  if (state.touchLatched) return { handled: true, direction: 0 };

  const dx = point.x - state.touchStartX;
  const dy = point.y - state.touchStartY;
  if (Math.abs(dx) < TOUCH_VIEW_THRESHOLD
      || Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_DOMINANCE) {
    return { handled: true, direction: 0 };
  }
  state.touchLatched = true;
  return { handled: true, direction: Math.sign(dx) };
}

export function endThreeFingerViewGesture(state) {
  state.touchActive = false;
  state.touchLatched = false;
  state.touchStartX = 0;
  state.touchStartY = 0;
}
