import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RENDER_DPR, chooseRenderDpr, circleIntersectsBounds, getVisibleWorldBounds,
  shouldRenderUnitHealthBar,
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

test('unit health bars stay quiet until soldiers need combat status', () => {
  const soldier = { alive: true, type: 'musk', unitType: 'musk', hp: 34, maxHp: 34 };
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, side: 0 }), false);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, selected: true }), true);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, fireT: 0.1 }), true);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, healthBarT: 2 }), true);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, target: { alive: true } }), false);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, side: 1, hp: 8 }), true);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, type: 'villager' }), false);
  assert.equal(shouldRenderUnitHealthBar({
    alive: true, type: 'villager', unitType: 'witch_worker', hp: 38, maxHp: 38,
  }), false);
  assert.equal(shouldRenderUnitHealthBar({
    alive: true, type: 'witch_worker', unitType: 'witch_worker', hp: 38, maxHp: 38,
  }), false);
  assert.equal(shouldRenderUnitHealthBar({ ...soldier, alive: false }), false);
});
