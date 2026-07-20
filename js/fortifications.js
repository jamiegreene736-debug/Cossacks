// Shared stone-wall geometry for placement, hit testing, movement blocking and
// rendering. Fortifications use two board-aligned axes: a straight frontage and
// the oblique settlement depth axis. Keeping the math here prevents placement,
// simulation and art from quietly disagreeing about where a wall exists.

import { BUILDING_TYPES } from './config.js';

export const FORTIFICATION_ORIENTATIONS = Object.freeze(['horizontal', 'diagonal']);
export const FORTIFICATION_SNAP_DISTANCE = 34;

const AXES = Object.freeze({
  horizontal: Object.freeze({ x: 1, y: 0 }),
  diagonal: Object.freeze({ x: 0.8320502943, y: 0.5547001962 }),
});

export function isFortificationType(type) {
  return Boolean(BUILDING_TYPES[type]?.fortification);
}

export function normalizeFortificationOrientation(orientation) {
  return orientation === 'diagonal' ? 'diagonal' : 'horizontal';
}

export function rotateFortificationOrientation(orientation) {
  return normalizeFortificationOrientation(orientation) === 'horizontal' ? 'diagonal' : 'horizontal';
}

export function fortificationAxis(orientation) {
  const axis = AXES[normalizeFortificationOrientation(orientation)];
  return { x: axis.x, y: axis.y };
}

export function fortificationFrame(type, x, y, orientation, padding = 0) {
  const def = BUILDING_TYPES[type];
  if (!def?.fortification) return null;
  const axis = fortificationAxis(orientation);
  const normal = { x: -axis.y, y: axis.x };
  return {
    x,
    y,
    axis,
    normal,
    halfLength: def.w * 0.5 + padding,
    halfThickness: def.h * 0.5 + padding,
  };
}

export function fortificationCorners(type, x, y, orientation, padding = 0) {
  const frame = fortificationFrame(type, x, y, orientation, padding);
  if (!frame) return [];
  const { axis: a, normal: n, halfLength: hl, halfThickness: ht } = frame;
  return [
    { x: x - a.x * hl - n.x * ht, y: y - a.y * hl - n.y * ht },
    { x: x + a.x * hl - n.x * ht, y: y + a.y * hl - n.y * ht },
    { x: x + a.x * hl + n.x * ht, y: y + a.y * hl + n.y * ht },
    { x: x - a.x * hl + n.x * ht, y: y - a.y * hl + n.y * ht },
  ];
}

export function fortificationEndpoints(entity) {
  const frame = fortificationFrame(entity.type, entity.x, entity.y, entity.orientation);
  if (!frame) return [];
  return [-1, 1].map(sign => ({
    x: frame.x + frame.axis.x * frame.halfLength * sign,
    y: frame.y + frame.axis.y * frame.halfLength * sign,
  }));
}

function pointLocal(frame, x, y) {
  const dx = x - frame.x;
  const dy = y - frame.y;
  return {
    along: dx * frame.axis.x + dy * frame.axis.y,
    across: dx * frame.normal.x + dy * frame.normal.y,
  };
}

export function pointDistanceToFortification(entity, x, y) {
  const frame = fortificationFrame(entity.type, entity.x, entity.y, entity.orientation);
  if (!frame) return Infinity;
  const local = pointLocal(frame, x, y);
  const dx = Math.max(0, Math.abs(local.along) - frame.halfLength);
  const dy = Math.max(0, Math.abs(local.across) - frame.halfThickness);
  return Math.hypot(dx, dy);
}

export function pointInsideFortification(entity, x, y, padding = 0) {
  const frame = fortificationFrame(entity.type, entity.x, entity.y, entity.orientation, padding);
  if (!frame) return false;
  const local = pointLocal(frame, x, y);
  return Math.abs(local.along) <= frame.halfLength
    && Math.abs(local.across) <= frame.halfThickness;
}

function projectedRadius(frame, axis) {
  return frame.halfLength * Math.abs(frame.axis.x * axis.x + frame.axis.y * axis.y)
    + frame.halfThickness * Math.abs(frame.normal.x * axis.x + frame.normal.y * axis.y);
}

export function fortificationsOverlap(a, b, padding = 0) {
  const fa = fortificationFrame(a.type, a.x, a.y, a.orientation, padding);
  const fb = fortificationFrame(b.type, b.x, b.y, b.orientation, padding);
  if (!fa || !fb) return false;
  const dx = fb.x - fa.x;
  const dy = fb.y - fa.y;
  for (const axis of [fa.axis, fa.normal, fb.axis, fb.normal]) {
    const separation = Math.abs(dx * axis.x + dy * axis.y);
    if (separation >= projectedRadius(fa, axis) + projectedRadius(fb, axis) - 0.01) return false;
  }
  return true;
}

export function fortificationsShareEndpoint(a, b, tolerance = 2.5) {
  const aEnds = fortificationEndpoints(a);
  const bEnds = fortificationEndpoints(b);
  if (!aEnds.length || !bEnds.length || Math.hypot(a.x - b.x, a.y - b.y) < tolerance) return false;
  return aEnds.some(left => bEnds.some(right => Math.hypot(left.x - right.x, left.y - right.y) <= tolerance));
}

export function snapFortificationPlacement(world, side, type, x, y, orientation) {
  const normalized = normalizeFortificationOrientation(orientation);
  const frame = fortificationFrame(type, x, y, normalized);
  if (!frame) return { x, y, orientation: normalized, snappedToId: null };
  let best = null;
  let bestDistance = FORTIFICATION_SNAP_DISTANCE;

  for (const existing of world.buildings) {
    if (!existing.alive || existing.side !== side || !isFortificationType(existing.type)) continue;
    for (const endpoint of fortificationEndpoints(existing)) {
      for (const sign of [-1, 1]) {
        const cx = endpoint.x - frame.axis.x * frame.halfLength * sign;
        const cy = endpoint.y - frame.axis.y * frame.halfLength * sign;
        const distance = Math.hypot(cx - x, cy - y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { x: cx, y: cy, orientation: normalized, snappedToId: existing.id };
        }
      }
    }
  }
  return best || { x, y, orientation: normalized, snappedToId: null };
}

function clipAxis(p, q, range) {
  if (Math.abs(p) < 1e-8) return q >= 0;
  const ratio = q / p;
  if (p < 0) range.min = Math.max(range.min, ratio);
  else range.max = Math.min(range.max, ratio);
  return range.min <= range.max;
}

export function lineIntersectsFortification(x0, y0, x1, y1, entity, padding = 0) {
  const frame = fortificationFrame(entity.type, entity.x, entity.y, entity.orientation, padding);
  if (!frame) return false;
  const start = pointLocal(frame, x0, y0);
  const end = pointLocal(frame, x1, y1);
  const dx = end.along - start.along;
  const dy = end.across - start.across;
  const range = { min: 0, max: 1 };
  return clipAxis(-dx, start.along + frame.halfLength, range)
    && clipAxis(dx, frame.halfLength - start.along, range)
    && clipAxis(-dy, start.across + frame.halfThickness, range)
    && clipAxis(dy, frame.halfThickness - start.across, range);
}

export function resolveUnitFortificationCollision(unit, fortifications) {
  let resolved = false;
  for (const wall of fortifications) {
    if (!wall.alive || wall.type !== 'wall' || (!wall.complete && wall.progress < 0.24)) continue;
    const frame = fortificationFrame(wall.type, wall.x, wall.y, wall.orientation, unit.radius + 1.5);
    const local = pointLocal(frame, unit.x, unit.y);
    if (Math.abs(local.along) >= frame.halfLength || Math.abs(local.across) >= frame.halfThickness) continue;

    const alongPen = frame.halfLength - Math.abs(local.along);
    const acrossPen = frame.halfThickness - Math.abs(local.across);
    let along = local.along;
    let across = local.across;
    if (acrossPen <= alongPen) across = (across < 0 ? -1 : 1) * frame.halfThickness;
    else along = (along < 0 ? -1 : 1) * frame.halfLength;
    unit.x = frame.x + frame.axis.x * along + frame.normal.x * across;
    unit.y = frame.y + frame.axis.y * along + frame.normal.y * across;
    resolved = true;
  }
  return resolved;
}
