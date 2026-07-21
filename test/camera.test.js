import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampCameraZoom, MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM, normalizeViewRotation,
  rotatedViewHalfExtents, screenPointToWorld, screenVectorToWorld, turnView,
  stepCameraZoom, viewDirectionLabel, viewMirrorsHorizontalFacing, worldViewDepth,
} from '../js/camera.js';

test('the camera turns through all four cardinal views and remains normalized', () => {
  assert.equal(turnView(0, 1), Math.PI / 2);
  assert.equal(turnView(Math.PI / 2, 1), Math.PI);
  assert.equal(turnView(Math.PI, 1), Math.PI * 1.5);
  assert.equal(turnView(Math.PI * 1.5, 1), 0);
  assert.equal(turnView(0, -1), Math.PI * 1.5);
  assert.equal(normalizeViewRotation(Math.PI * 4.5), Math.PI / 2);
  assert.equal(viewDirectionLabel(0), 'South');
  assert.equal(viewDirectionLabel(Math.PI / 2), 'East');
  assert.equal(viewDirectionLabel(Math.PI), 'North');
  assert.equal(viewDirectionLabel(Math.PI * 1.5), 'West');
  assert.equal(viewMirrorsHorizontalFacing(0), false);
  assert.equal(viewMirrorsHorizontalFacing(Math.PI / 2), false);
  assert.equal(viewMirrorsHorizontalFacing(Math.PI), true);
  assert.equal(viewMirrorsHorizontalFacing(Math.PI * 1.5), true);
});

test('camera zoom reaches command altitude without exceeding render limits', () => {
  assert.equal(clampCameraZoom(0.01), MIN_CAMERA_ZOOM);
  assert.equal(clampCameraZoom(0.38), 0.38);
  assert.equal(clampCameraZoom(9), MAX_CAMERA_ZOOM);
  assert.equal(clampCameraZoom(Number.NaN), 1);
  assert.equal(stepCameraZoom(0.5, -1), 0.4);
  assert.equal(stepCameraZoom(MIN_CAMERA_ZOOM, -1), MIN_CAMERA_ZOOM);
  assert.equal(stepCameraZoom(2, 1), MAX_CAMERA_ZOOM);
});

test('rotated screen input maps to the same point visible beneath the cursor', () => {
  const camera = { x: 1000, y: 1500, zoom: 2, rotation: Math.PI };
  assert.deepEqual(screenPointToWorld(camera, 800, 600, 500, 250), { x: 950, y: 1525 });
  const pan = screenVectorToWorld(camera, 10, -20);
  assert.ok(Math.abs(pan.x + 10) < 1e-9);
  assert.ok(Math.abs(pan.y - 20) < 1e-9);
});

test('East and West screen input follows the turned battlefield', () => {
  const east = { x: 1000, y: 1500, zoom: 2, rotation: Math.PI / 2 };
  const west = { ...east, rotation: Math.PI * 1.5 };
  const eastPoint = screenPointToWorld(east, 800, 600, 500, 250);
  const westPoint = screenPointToWorld(west, 800, 600, 500, 250);
  assert.ok(Math.abs(eastPoint.x - 975) < 1e-9);
  assert.ok(Math.abs(eastPoint.y - 1450) < 1e-9);
  assert.ok(Math.abs(westPoint.x - 1025) < 1e-9);
  assert.ok(Math.abs(westPoint.y - 1550) < 1e-9);
});

test('view bounds remain complete and depth order reverses behind the wall', () => {
  const extents = rotatedViewHalfExtents({ zoom: 2, rotation: Math.PI }, 400, 200);
  assert.ok(Math.abs(extents.x - 100) < 1e-9);
  assert.ok(Math.abs(extents.y - 50) < 1e-9);
  assert.ok(worldViewDepth({ rotation: 0 }, 100, 200) > worldViewDepth({ rotation: 0 }, 100, 100));
  assert.ok(worldViewDepth({ rotation: Math.PI }, 100, 200)
    < worldViewDepth({ rotation: Math.PI }, 100, 100));
  const eastExtents = rotatedViewHalfExtents({ zoom: 2, rotation: Math.PI / 2 }, 400, 200);
  assert.ok(Math.abs(eastExtents.x - 50) < 1e-9);
  assert.ok(Math.abs(eastExtents.y - 100) < 1e-9);
});
