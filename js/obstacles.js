// Shared ground-obstacle geometry. Placement, route finding and simulation all
// use these same oriented footprints so the visible architecture cannot drift
// away from its physical space on the battlefield.

import { BUILDING_TYPES } from './config.js';
import {
  fortificationFrame, isFortificationType, isGateOpen,
} from './fortifications.js';

const COLLISION_EPSILON = 0.05;

function ordinaryStructureFrame(building, padding = 0) {
  const def = BUILDING_TYPES[building?.type];
  if (!def) return null;
  const rotation = Number.isFinite(building.rotation) ? building.rotation : 0;
  const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const normal = { x: -axis.y, y: axis.x };
  const scale = Math.max(1, def.visualScale || 1);
  return {
    x: building.x,
    y: building.y,
    axis,
    normal,
    halfLength: def.w * scale * 0.5 + padding,
    halfThickness: def.h * scale * 0.5 + padding,
  };
}

export function structureObstacleFrame(building, padding = 0) {
  if (!building || !Number.isFinite(building.x) || !Number.isFinite(building.y)) return null;
  if (isFortificationType(building.type) || BUILDING_TYPES[building.type]?.wallAttachment) {
    return fortificationFrame(
      building.type, building.x, building.y, building.orientation, padding,
    );
  }
  return ordinaryStructureFrame(building, padding);
}

export function structureBlocksGround(building) {
  if (!building?.alive) return false;
  const def = BUILDING_TYPES[building.type];
  // Farmers work inside crop rows, so a field is a managed work surface rather
  // than a solid structure. Its placement footprint still blocks other builds.
  if (!def || def.wallAttachment || building.type === 'farm') return false;
  if (building.type === 'wall') return building.complete || building.progress >= 0.24;
  if (def.gate) return building.complete && !isGateOpen(building);
  return true;
}

function localPoint(frame, x, y) {
  const dx = x - frame.x;
  const dy = y - frame.y;
  return {
    along: dx * frame.axis.x + dy * frame.axis.y,
    across: dx * frame.normal.x + dy * frame.normal.y,
  };
}

export function pointInsideStructure(building, x, y, clearance = 0) {
  const frame = structureObstacleFrame(building, clearance);
  if (!frame) return false;
  const local = localPoint(frame, x, y);
  return Math.abs(local.along) <= frame.halfLength
    && Math.abs(local.across) <= frame.halfThickness;
}

export function distanceToStructure(building, x, y) {
  const frame = structureObstacleFrame(building);
  if (!frame) return Infinity;
  const local = localPoint(frame, x, y);
  const dx = Math.max(0, Math.abs(local.along) - frame.halfLength);
  const dy = Math.max(0, Math.abs(local.across) - frame.halfThickness);
  return Math.hypot(dx, dy);
}

export function segmentIntersectsStructure(
  building, x0, y0, x1, y1, clearance = 0,
) {
  const frame = structureObstacleFrame(building, clearance);
  if (!frame) return false;
  const start = localPoint(frame, x0, y0);
  const end = localPoint(frame, x1, y1);
  const dx = end.along - start.along;
  const dy = end.across - start.across;
  let enter = 0;
  let exit = 1;

  const clip = (origin, delta, min, max) => {
    if (Math.abs(delta) < 1e-9) return origin >= min && origin <= max;
    let low = (min - origin) / delta;
    let high = (max - origin) / delta;
    if (low > high) [low, high] = [high, low];
    enter = Math.max(enter, low);
    exit = Math.min(exit, high);
    return enter <= exit;
  };

  return clip(start.along, dx, -frame.halfLength, frame.halfLength)
    && clip(start.across, dy, -frame.halfThickness, frame.halfThickness);
}

function projectedRadius(frame, axis) {
  return frame.halfLength * Math.abs(frame.axis.x * axis.x + frame.axis.y * axis.y)
    + frame.halfThickness * Math.abs(frame.normal.x * axis.x + frame.normal.y * axis.y);
}

export function structuresOverlap(first, second, clearance = 0) {
  const left = structureObstacleFrame(first);
  const right = structureObstacleFrame(second);
  if (!left || !right) return false;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  for (const axis of [left.axis, left.normal, right.axis, right.normal]) {
    const centerDistance = Math.abs(dx * axis.x + dy * axis.y);
    if (centerDistance >= projectedRadius(left, axis) + projectedRadius(right, axis) + clearance) {
      return false;
    }
  }
  return true;
}

export function structureCorners(building, padding = 0) {
  const frame = structureObstacleFrame(building, padding);
  if (!frame) return [];
  const corners = [];
  for (const along of [-frame.halfLength, frame.halfLength]) {
    for (const across of [-frame.halfThickness, frame.halfThickness]) {
      corners.push({
        x: frame.x + frame.axis.x * along + frame.normal.x * across,
        y: frame.y + frame.axis.y * along + frame.normal.y * across,
      });
    }
  }
  return corners;
}

export function resolveUnitStructureCollision(unit, buildings) {
  let collided = false;
  for (const building of buildings) {
    if (!structureBlocksGround(building) || isFortificationType(building.type)) continue;
    const frame = structureObstacleFrame(building, unit.radius || 0);
    if (!frame) continue;
    const local = localPoint(frame, unit.x, unit.y);
    if (Math.abs(local.along) > frame.halfLength
      || Math.abs(local.across) > frame.halfThickness) continue;

    const alongPenetration = frame.halfLength - Math.abs(local.along);
    const acrossPenetration = frame.halfThickness - Math.abs(local.across);
    if (alongPenetration < acrossPenetration) {
      let sign = Math.sign(local.along);
      if (!sign && Number.isFinite(unit.px)) sign = Math.sign(localPoint(frame, unit.px, unit.py).along);
      if (!sign) sign = (unit.id || 0) % 2 ? 1 : -1;
      const push = alongPenetration + COLLISION_EPSILON;
      unit.x += frame.axis.x * push * sign;
      unit.y += frame.axis.y * push * sign;
    } else {
      let sign = Math.sign(local.across);
      if (!sign && Number.isFinite(unit.py)) sign = Math.sign(localPoint(frame, unit.px, unit.py).across);
      if (!sign) sign = (unit.id || 0) % 2 ? -1 : 1;
      const push = acrossPenetration + COLLISION_EPSILON;
      unit.x += frame.normal.x * push * sign;
      unit.y += frame.normal.y * push * sign;
    }
    collided = true;
  }
  return collided;
}
