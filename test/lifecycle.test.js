import test from 'node:test';
import assert from 'node:assert/strict';

import { bindPageLifecycle } from '../js/lifecycle.js';

function createLifecycleTargets(initialVisibility = 'visible') {
  const documentTarget = new EventTarget();
  documentTarget.visibilityState = initialVisibility;
  const windowTarget = new EventTarget();
  return { documentTarget, windowTarget };
}

test('hiding a running game saves and suspends without exiting', () => {
  const { documentTarget, windowTarget } = createLifecycleTargets();
  const calls = [];
  bindPageLifecycle({
    documentTarget,
    windowTarget,
    onSave: () => { calls.push('save'); return true; },
    onPageActivity: active => calls.push(active ? 'active' : 'inactive'),
    onExit: () => calls.push('exit'),
  });
  calls.length = 0;

  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));

  assert.deepEqual(calls, ['inactive', 'save']);
});

test('page exit reuses the hidden save and always performs final teardown', () => {
  const { documentTarget, windowTarget } = createLifecycleTargets();
  const calls = [];
  bindPageLifecycle({
    documentTarget,
    windowTarget,
    onSave: () => { calls.push('save'); return true; },
    onPageActivity: active => calls.push(active ? 'active' : 'inactive'),
    onExit: () => calls.push('exit'),
  });
  calls.length = 0;

  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  windowTarget.dispatchEvent(new Event('pagehide'));

  assert.deepEqual(calls, ['inactive', 'save', 'inactive', 'exit']);
});

test('pagehide without visibilitychange still silences, saves, and exits', () => {
  const { documentTarget, windowTarget } = createLifecycleTargets();
  const calls = [];
  bindPageLifecycle({
    documentTarget,
    windowTarget,
    onSave: () => { calls.push('save'); return true; },
    onPageActivity: active => calls.push(active ? 'active' : 'inactive'),
    onExit: () => calls.push('exit'),
  });
  calls.length = 0;

  windowTarget.dispatchEvent(new Event('pagehide'));

  assert.deepEqual(calls, ['inactive', 'save', 'exit']);
});

test('a failed hidden save is retried during page exit', () => {
  const { documentTarget, windowTarget } = createLifecycleTargets();
  let attempts = 0;
  bindPageLifecycle({
    documentTarget,
    windowTarget,
    onSave: () => ++attempts > 1,
    onPageActivity: () => {},
    onExit: () => {},
  });

  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  windowTarget.dispatchEvent(new Event('pagehide'));

  assert.equal(attempts, 2);
});

test('window blur is a fallback for embedded browser surfaces that do not hide the document', () => {
  const { documentTarget, windowTarget } = createLifecycleTargets();
  const calls = [];
  bindPageLifecycle({
    documentTarget,
    windowTarget,
    onSave: () => { calls.push('save'); return true; },
    onPageActivity: active => calls.push(active ? 'active' : 'inactive'),
    onExit: () => calls.push('exit'),
  });
  calls.length = 0;

  windowTarget.dispatchEvent(new Event('blur'));
  windowTarget.dispatchEvent(new Event('focus'));

  assert.deepEqual(calls, ['inactive', 'save', 'active']);
});

test('beforeunload handles tab close once even when pagehide follows', () => {
  const { documentTarget, windowTarget } = createLifecycleTargets();
  const calls = [];
  bindPageLifecycle({
    documentTarget,
    windowTarget,
    onSave: () => { calls.push('save'); return true; },
    onPageActivity: active => calls.push(active ? 'active' : 'inactive'),
    onExit: () => calls.push('exit'),
  });
  calls.length = 0;

  windowTarget.dispatchEvent(new Event('beforeunload'));
  windowTarget.dispatchEvent(new Event('pagehide'));

  assert.deepEqual(calls, ['inactive', 'save', 'exit']);
});
