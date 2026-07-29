// The fortification renderer paints each module along its world axis AS SEEN
// by the current camera (world angle + camera rotation), with elevation kept
// screen-vertical. These tests pin the seam invariant that broke when stamps
// were billboarded: at every cardinal view rotation, the painted socket of a
// module must land on the same screen point as its snapped neighbour's socket.

import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDING_TYPES } from '../js/config.js';
import { fortificationAxis, fortificationEndpoints } from '../js/fortifications.js';
import { snapWallKitPieceToSocket, wallKitSockets } from '../js/wall-kit.js';
import { bdFortViewAngle, setBuildingRefs } from '../js/gfx/buildings.js';

const VIEW_ROTATIONS = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

function withCameraRotation(rotation, run) {
  setBuildingRefs({ camera: { zoom: 1, rotation } });
  try {
    return run();
  } finally {
    setBuildingRefs({ camera: { zoom: 1, rotation: 0 } });
  }
}

function screenPoint(rotation, x, y) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { x: cos * x - sin * y, y: sin * x + cos * y };
}

/** Where the renderer paints a module socket: billboarded stamp centre at the
 * rotated building position, plus halfLength along the VIEW axis. */
function paintedSocket(rotation, building, sign) {
  const centre = screenPoint(rotation, building.x, building.y);
  const viewAxis = fortificationAxis(bdFortViewAngle(building.orientation));
  const halfLength = BUILDING_TYPES[building.type].w * 0.5;
  return {
    x: centre.x + viewAxis.x * halfLength * sign,
    y: centre.y + viewAxis.y * halfLength * sign,
  };
}

test('view angle equals world angle at the default South camera', () => {
  withCameraRotation(0, () => {
    assert.equal(bdFortViewAngle(0), 0);
    assert.ok(Math.abs(bdFortViewAngle(Math.PI / 3) - Math.PI / 3) < 1e-6);
    assert.equal(bdFortViewAngle('horizontal'), 0);
  });
});

test('camera turns rotate the painted wall axis with the world', () => {
  withCameraRotation(Math.PI / 2, () => {
    // A west-to-east wall must paint straight down the screen at East.
    const axis = fortificationAxis(bdFortViewAngle(0));
    assert.ok(Math.abs(axis.x) < 1e-6 && Math.abs(axis.y - 1) < 1e-6);
    // Legacy string orientations take the same turn.
    const legacy = fortificationAxis(bdFortViewAngle('horizontal'));
    assert.ok(Math.abs(legacy.x) < 1e-6 && Math.abs(legacy.y - 1) < 1e-6);
  });
  withCameraRotation(Math.PI, () => {
    const axis = fortificationAxis(bdFortViewAngle(Math.PI / 4));
    const expected = Math.PI / 4 + Math.PI - Math.PI * 2; // normalised wrap
    assert.ok(Math.abs(Math.atan2(axis.y, axis.x) - expected) < 1e-5);
  });
});

test('snapped modules keep coincident painted sockets in all four views', () => {
  // A straight module, a 15-degree bend and a gate chained socket-to-socket,
  // exactly as drag placement produces them.
  const first = { type: 'wall', x: 500, y: 500, orientation: 0 };
  const bendSeat = snapWallKitPieceToSocket(
    'wall', Math.PI / 12, wallKitSockets(first)[1], 'neg',
  );
  const bend = { type: 'wall', x: bendSeat.x, y: bendSeat.y, orientation: Math.PI / 12 };
  const gateSeat = snapWallKitPieceToSocket(
    'gate', Math.PI / 12, wallKitSockets(bend)[1], 'neg',
  );
  const gate = { type: 'gate', x: gateSeat.x, y: gateSeat.y, orientation: Math.PI / 12 };

  for (const [left, right] of [[first, bend], [bend, gate]]) {
    const sharedWorld = fortificationEndpoints(left)[1];
    const neighbourWorld = fortificationEndpoints(right)[0];
    assert.ok(Math.hypot(sharedWorld.x - neighbourWorld.x,
      sharedWorld.y - neighbourWorld.y) < 1e-6, 'world sockets must coincide');

    for (const rotation of VIEW_ROTATIONS) {
      withCameraRotation(rotation, () => {
        const a = paintedSocket(rotation, left, 1);
        const b = paintedSocket(rotation, right, -1);
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(gap < 0.01,
          `painted socket gap ${gap.toFixed(4)} at rotation ${rotation}`);
      });
    }
  }
});

test('painted module length never collapses under a camera turn', () => {
  for (const rotation of VIEW_ROTATIONS) {
    withCameraRotation(rotation, () => {
      for (const orientation of [0, Math.PI / 12, Math.PI / 2, 'diagonal']) {
        const axis = fortificationAxis(bdFortViewAngle(orientation));
        assert.ok(Math.abs(Math.hypot(axis.x, axis.y) - 1) < 1e-6);
      }
    });
  }
});
