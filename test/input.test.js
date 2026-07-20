import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement extends EventTarget {
  constructor(tagName = 'DIV') {
    super();
    this.tagName = tagName;
    this.innerWidth = 1280;
    this.innerHeight = 800;
    this.classList = {
      contains: () => false,
      remove: () => {},
      toggle: () => {},
    };
  }

  closest() { return null; }
}

function mouseEvent(type, button, extra = {}) {
  const event = new Event(type);
  Object.defineProperties(event, {
    button: { value: button },
    clientX: { value: extra.clientX || 0 },
    clientY: { value: extra.clientY || 0 },
    shiftKey: { value: Boolean(extra.shiftKey) },
  });
  return event;
}

function keyEvent(key) {
  const event = new Event('keydown');
  Object.defineProperties(event, {
    key: { value: key },
    ctrlKey: { value: false },
    metaKey: { value: false },
  });
  return event;
}

test('building placement supports one-action click-away, secondary-click, and Escape cancellation', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const fakeWindow = new FakeElement('WINDOW');
  const fakeDocument = new FakeElement('DOCUMENT');
  const canvas = new FakeElement('CANVAS');
  const minimap = new FakeElement('CANVAS');
  fakeDocument.getElementById = id => id === 'minimap' ? minimap : null;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;

  try {
    const input = await import('../js/input.js');
    const placements = [];
    input.initInput(canvas, minimap, () => ({ state: 'running' }), {
      onPlacement: placement => placements.push(placement),
      onValidatePlacement: () => ({ ok: false, message: 'Blocked terrain' }),
    });

    input.beginPlacement('house');
    assert.equal(input.getPlacementPreview()?.type, 'house');
    canvas.dispatchEvent(mouseEvent('mousedown', 0, { clientX: 100, clientY: 100 }));
    assert.equal(input.getPlacementPreview()?.type, 'house', 'an invalid terrain click remains retryable');

    fakeDocument.dispatchEvent(mouseEvent('mousedown', 0));
    assert.equal(input.getPlacementPreview(), null, 'a primary click outside the canvas cancels');

    input.beginPlacement('farm');
    canvas.dispatchEvent(mouseEvent('mousedown', 2));
    assert.equal(input.getPlacementPreview(), null, 'a Mac secondary click cancels');

    input.beginPlacement('mill');
    fakeWindow.dispatchEvent(keyEvent('Escape'));
    assert.equal(input.getPlacementPreview(), null, 'Escape cancels');
    assert.equal(placements.filter(placement => placement === null).length, 3);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
