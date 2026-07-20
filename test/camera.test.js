import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeViewRotation, rotatedViewHalfExtents, screenPointToWorld,
  screenVectorToWorld, turnView, viewDirectionLabel, worldViewDepth,
} from '../js/camera.js';

test('the opposing view turns exactly half a revolution and remains normalized', () => {
  assert.equal(turnView(0, 1), Math.PI);
  assert.equal(turnView(Math.PI, 1), 0);
  assert.equal(turnView(0, -1), Math.PI);
  assert.equal(normalizeViewRotation(Math.PI * 5), Math.PI);
  assert.equal(viewDirectionLabel(0), 'South');
  assert.equal(viewDirectionLabel(Math.PI), 'North');
});

test('rotated screen input maps to the same point visible beneath the cursor', () => {
  const camera = { x: 1000, y: 1500, zoom: 2, rotation: Math.PI };
  assert.deepEqual(screenPointToWorld(camera, 800, 600, 500, 250), { x: 950, y: 1525 });
  const pan = screenVectorToWorld(camera, 10, -20);
  assert.ok(Math.abs(pan.x + 10) < 1e-9);
  assert.ok(Math.abs(pan.y - 20) < 1e-9);
});

test('view bounds remain complete and depth order reverses behind the wall', () => {
  const extents = rotatedViewHalfExtents({ zoom: 2, rotation: Math.PI }, 400, 200);
  assert.ok(Math.abs(extents.x - 100) < 1e-9);
  assert.ok(Math.abs(extents.y - 50) < 1e-9);
  assert.ok(worldViewDepth({ rotation: 0 }, 100, 200) > worldViewDepth({ rotation: 0 }, 100, 100));
  assert.ok(worldViewDepth({ rotation: Math.PI }, 100, 200)
    < worldViewDepth({ rotation: Math.PI }, 100, 100));
});
