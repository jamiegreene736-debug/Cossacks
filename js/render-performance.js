// Small, pure helpers for keeping the canvas renderer inside a predictable
// pixel budget and excluding world objects that cannot affect this frame.

import { rotatedViewHalfExtents } from './camera.js';

export const MAX_RENDER_DPR = 1.5;

export function chooseRenderDpr(devicePixelRatio) {
  const value = Number(devicePixelRatio);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.min(MAX_RENDER_DPR, value));
}

export function getVisibleWorldBounds(
  camera, viewWidth, viewHeight, margin = 0, worldWidth = Infinity, worldHeight = Infinity,
) {
  const extents = rotatedViewHalfExtents(camera, viewWidth, viewHeight);
  const halfWidth = extents.x + margin;
  const halfHeight = extents.y + margin;
  return {
    left: Math.max(0, camera.x - halfWidth),
    right: Math.min(worldWidth, camera.x + halfWidth),
    top: Math.max(0, camera.y - halfHeight),
    bottom: Math.min(worldHeight, camera.y + halfHeight),
  };
}

export function circleIntersectsBounds(entity, bounds, extraRadius = 0) {
  const radius = Math.max(0, Number(entity?.radius) || 0) + Math.max(0, extraRadius);
  return entity.x + radius >= bounds.left && entity.x - radius <= bounds.right
    && entity.y + radius >= bounds.top && entity.y - radius <= bounds.bottom;
}

export function shouldRenderUnitHealthBar(unit) {
  return Boolean(unit?.alive && unit.type !== 'villager'
    && Number.isFinite(unit.hp) && Number.isFinite(unit.maxHp) && unit.maxHp > 0);
}
