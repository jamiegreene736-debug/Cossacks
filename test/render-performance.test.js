import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RENDER_DPR, chooseRenderDpr, circleIntersectsBounds, getVisibleWorldBounds,
} from '../js/render-performance.js';

test('render DPR preserves normal displays and caps Retina fill cost', () => {
  assert.equal(chooseRenderDpr(1), 1);
  assert.equal(chooseRenderDpr(2), MAX_RENDER_DPR);
  assert.equal(chooseRenderDpr(3), MAX_RENDER_DPR);
  assert.equal(chooseRenderDpr(0), 1);
});

test('visible world bounds account for zoom, margin, and map edges', () => {
  assert.deepEqual(
    getVisibleWorldBounds({ x: 100, y: 80, zoom: 2 }, 400, 200, 20, 1000, 800),
    { left: 0, right: 220, top: 10, bottom: 150 },
  );
});

test('visibility includes entity radius and an art safety margin', () => {
  const bounds = { left: 100, right: 300, top: 100, bottom: 300 };
  assert.equal(circleIntersectsBounds({ x: 70, y: 180, radius: 12 }, bounds, 20), true);
  assert.equal(circleIntersectsBounds({ x: 50, y: 180, radius: 12 }, bounds, 20), false);
});
