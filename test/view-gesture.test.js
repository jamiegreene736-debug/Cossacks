import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginThreeFingerViewGesture, createViewGestureState, endThreeFingerViewGesture,
  readThreeFingerViewGesture, readTrackpadViewGesture,
} from '../js/view-gesture.js';

function wheel(deltaX, deltaY, options = {}) {
  return {
    deltaX,
    deltaY,
    deltaMode: options.deltaMode || 0,
    ctrlKey: Boolean(options.ctrlKey),
  };
}

function touches(x, y = 100, count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    clientX: x + index * 4,
    clientY: y + index * 2,
  }));
}

test('horizontal trackpad deltas accumulate into one deliberate camera turn', () => {
  const state = createViewGestureState();
  assert.deepEqual(readTrackpadViewGesture(state, wheel(30, 3), 0), {
    handled: true, direction: 0,
  });
  assert.deepEqual(readTrackpadViewGesture(state, wheel(45, 2), 20), {
    handled: true, direction: 1,
  });
  assert.deepEqual(readTrackpadViewGesture(state, wheel(120, 0), 40), {
    handled: true, direction: 0,
  }, 'momentum remains latched after the first turn');
});

test('a new swipe after the momentum gap can turn the opposite direction', () => {
  const state = createViewGestureState();
  readTrackpadViewGesture(state, wheel(80, 0), 0);
  assert.deepEqual(readTrackpadViewGesture(state, wheel(-80, 0), 220), {
    handled: true, direction: -1,
  });
});

test('vertical scroll, diagonal noise, and pinch zoom stay out of camera turning', () => {
  const state = createViewGestureState();
  assert.equal(readTrackpadViewGesture(state, wheel(5, 80), 0).handled, false);
  assert.equal(readTrackpadViewGesture(state, wheel(40, 38), 20).handled, false);
  assert.equal(readTrackpadViewGesture(state, wheel(100, 0, { ctrlKey: true }), 40).handled, false);
});

test('line-mode wheel events are normalized before applying the threshold', () => {
  const state = createViewGestureState();
  assert.deepEqual(readTrackpadViewGesture(state, wheel(5, 0, { deltaMode: 1 }), 0), {
    handled: true, direction: 1,
  });
});

test('literal three-touch movement turns once per gesture', () => {
  const state = createViewGestureState();
  assert.equal(beginThreeFingerViewGesture(state, touches(100)), true);
  assert.deepEqual(readThreeFingerViewGesture(state, touches(140)), {
    handled: true, direction: 0,
  });
  assert.deepEqual(readThreeFingerViewGesture(state, touches(170)), {
    handled: true, direction: 1,
  });
  assert.deepEqual(readThreeFingerViewGesture(state, touches(220)), {
    handled: true, direction: 0,
  });

  endThreeFingerViewGesture(state);
  beginThreeFingerViewGesture(state, touches(180));
  assert.deepEqual(readThreeFingerViewGesture(state, touches(100)), {
    handled: true, direction: -1,
  });
});

test('touch gestures require exactly three exposed touch points', () => {
  const state = createViewGestureState();
  assert.equal(beginThreeFingerViewGesture(state, touches(100, 100, 2)), false);
  assert.equal(readThreeFingerViewGesture(state, touches(180)).handled, false);
});
