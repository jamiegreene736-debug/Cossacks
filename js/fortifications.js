// Shared stone-wall geometry for placement, hit testing, movement blocking and
// rendering. Fortifications use two board-aligned axes: a straight frontage and
// the oblique settlement depth axis. Keeping the math here prevents placement,
// simulation and art from quietly disagreeing about where a wall exists.

import { BUILDING_TYPES, WORLD } from './config.js';

export const FORTIFICATION_ORIENTATIONS = Object.freeze(['horizontal', 'diagonal']);
export const FORTIFICATION_SNAP_DISTANCE = 34;
export const FORTIFICATION_ENDPOINT_PICK_DISTANCE = 64;
export const WALL_WALK_ELEVATION = 30;
export const WALL_STAIR_ATTACH_DISTANCE = 58;

const AXES = Object.freeze({
  horizontal: Object.freeze({ x: 1, y: 0 }),
  diagonal: Object.freeze({ x: 0.8320502943, y: 0.5547001962 }),
});

export function isFortificationType(type) {
  return Boolean(BUILDING_TYPES[type]?.fortification);
}

export function isGateOpen(building) {
  return building?.type === 'gate' && building.gateOpen !== false;
}

export function setGateOpen(world, building, open) {
  if (!world || !building?.alive || !building.complete || building.type !== 'gate') {
    return { ok: false, message: 'Select a completed friendly Stone Gate.' };
  }
  const next = Boolean(open);
  if (building.gateOpen === next) {
    return { ok: true, open: next, message: `Gate is already ${next ? 'open' : 'closed'}.` };
  }
  building.gateOpen = next;
  world.navigationVersion = (world.navigationVersion || 0) + 1;
  return {
    ok: true,
    open: next,
    message: next ? 'Stone Gate opened. Passage is clear.' : 'Stone Gate closed. Passage is barred.',
  };
}

export function toggleGate(world, building) {
  return setGateOpen(world, building, !isGateOpen(building));
}

export function normalizeFortificationOrientation(orientation) {
  if (Number.isFinite(orientation)) {
    let angle = orientation % (Math.PI * 2);
    if (angle <= -Math.PI) angle += Math.PI * 2;
    if (angle > Math.PI) angle -= Math.PI * 2;
    return angle;
  }
  return orientation === 'diagonal' ? 'diagonal' : 'horizontal';
}

export function rotateFortificationOrientation(orientation) {
  if (Number.isFinite(orientation)) return normalizeFortificationOrientation(orientation + Math.PI / 4);
  return normalizeFortificationOrientation(orientation) === 'horizontal' ? 'diagonal' : 'horizontal';
}

export function fortificationAxis(orientation) {
  const normalized = normalizeFortificationOrientation(orientation);
  if (Number.isFinite(normalized)) return { x: Math.cos(normalized), y: Math.sin(normalized) };
  const axis = AXES[normalized];
  return { x: axis.x, y: axis.y };
}

export function fortificationFrame(type, x, y, orientation, padding = 0) {
  const def = BUILDING_TYPES[type];
  if (!def?.fortification && !def?.wallAttachment) return null;
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

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function isCompletedWallWalkSegment(entity, side = null) {
  return Boolean(entity?.alive && entity.complete && (entity.type === 'wall' || entity.type === 'gate')
    && (side === null || entity.side === side));
}

export function resolveWallStairAttachment(world, side, x, y) {
  const stairDef = BUILDING_TYPES.wall_stairs;
  let best = null;
  let bestDistance = WALL_STAIR_ATTACH_DISTANCE;

  for (const wall of world.buildings) {
    if (!isCompletedWallWalkSegment(wall, side) || wall.type !== 'wall') continue;
    const frame = fortificationFrame(wall.type, wall.x, wall.y, wall.orientation);
    const local = pointLocal(frame, x, y);
    const along = clamp(local.along, -frame.halfLength + stairDef.w * 0.55,
      frame.halfLength - stairDef.w * 0.55);
    const reference = interiorReferencePoint(world, side, wall);
    const referenceAcross = (reference.x - frame.x) * frame.normal.x
      + (reference.y - frame.y) * frame.normal.y;
    const sideSign = referenceAcross < 0 ? -1 : 1;
    const across = sideSign * (frame.halfThickness + stairDef.h * 0.5 - 3);
    const stairX = frame.x + frame.axis.x * along + frame.normal.x * across;
    const stairY = frame.y + frame.axis.y * along + frame.normal.y * across;
    const distance = Math.hypot(stairX - x, stairY - y);
    if (distance > bestDistance) continue;

    const duplicate = world.buildings.some(building => building.alive
      && building.type === 'wall_stairs' && building.wallId === wall.id
      && Math.abs((building.stairAlong || 0) - along) < stairDef.w * 0.82);
    if (duplicate) continue;
    bestDistance = distance;
    best = {
      x: stairX,
      y: stairY,
      orientation: wall.orientation,
      wallId: wall.id,
      stairSide: sideSign,
      stairAlong: along,
      snappedToId: wall.id,
    };
  }
  return best;
}

function interiorReferencePoint(world, side, wall) {
  const townCenterId = world.sides?.[side]?.townCenterId;
  const townCenter = world.buildings.find(building => building.alive && building.side === side
    && building.type === 'town_center' && (building.id === townCenterId || townCenterId == null));
  if (townCenter) return townCenter;
  const settlementBuilding = world.buildings.filter(building => building.alive
    && building.side === side && !isFortificationType(building.type)
    && !BUILDING_TYPES[building.type]?.wallAttachment)
    .sort((left, right) => Math.hypot(left.x - wall.x, left.y - wall.y)
      - Math.hypot(right.x - wall.x, right.y - wall.y))[0];
  if (settlementBuilding) return settlementBuilding;
  return {
    x: side === 0 ? WORLD.w * 0.2 : WORLD.w * 0.8,
    y: WORLD.h * 0.5,
  };
}

function connectedWallWalk(world, start) {
  if (!isCompletedWallWalkSegment(start)) return [];
  const connected = [];
  const pending = [start];
  const visited = new Set();
  while (pending.length) {
    const segment = pending.shift();
    if (!segment || visited.has(segment.id)) continue;
    visited.add(segment.id);
    connected.push(segment);
    for (const candidate of world.buildings) {
      if (visited.has(candidate.id) || candidate.side !== start.side
        || !isCompletedWallWalkSegment(candidate)) continue;
      if (fortificationsShareEndpoint(segment, candidate, 3.5)) pending.push(candidate);
    }
  }
  return connected;
}

function wallWalkTarget(world, target) {
  if (!target?.alive || !target.complete) return null;
  if (target.type === 'wall' || target.type === 'gate') return target;
  if (target.type !== 'wall_stairs') return null;
  return world.buildings.find(building => building.id === target.wallId) || null;
}

function wallSlot(segment, slotIndex) {
  const fractions = segment.type === 'gate'
    ? [-0.72, -0.36, 0.36, 0.72]
    : [-0.72, -0.36, 0, 0.36, 0.72];
  const fraction = fractions[slotIndex];
  if (fraction == null) return null;
  const frame = fortificationFrame(segment.type, segment.x, segment.y, segment.orientation);
  return {
    wallId: segment.id,
    slotIndex,
    x: segment.x + frame.axis.x * frame.halfLength * fraction,
    y: segment.y + frame.axis.y * frame.halfLength * fraction,
    elevation: segment.type === 'gate' ? 43 : WALL_WALK_ELEVATION,
  };
}

function wallWalkSlots(world, target) {
  const start = wallWalkTarget(world, target);
  if (!start) return [];
  const connected = connectedWallWalk(world, start);
  connected.sort((left, right) => {
    if (left.id === start.id) return -1;
    if (right.id === start.id) return 1;
    return Math.hypot(left.x - start.x, left.y - start.y)
      - Math.hypot(right.x - start.x, right.y - start.y);
  });
  const slots = [];
  for (const segment of connected) {
    const count = segment.type === 'gate' ? 4 : 5;
    for (let slotIndex = 0; slotIndex < count; slotIndex++) {
      slots.push(wallSlot(segment, slotIndex));
    }
  }
  return slots;
}

function accessStairs(world, segments) {
  const segmentIds = new Set(segments.map(segment => segment.id));
  return world.buildings.filter(building => building.alive && building.complete
    && building.type === 'wall_stairs' && segmentIds.has(building.wallId));
}

function wallAssignmentKey(assignment) {
  return `${assignment.wallId}:${assignment.slotIndex}`;
}

export function assignMusketeersToWall(world, units, target) {
  const start = wallWalkTarget(world, target);
  if (!start || start.side !== units.find(unit => unit.alive)?.side) {
    return { assigned: 0, capacity: 0, message: 'Choose a completed friendly wall or staircase.' };
  }
  const segments = connectedWallWalk(world, start);
  const stairs = accessStairs(world, segments);
  if (!stairs.length) {
    return { assigned: 0, capacity: 0, message: 'Build and complete a Stone Staircase on this wall first.' };
  }

  const occupied = new Set();
  for (const unit of world.units) {
    if (!unit.alive || units.includes(unit)) continue;
    const assignment = unit.wallMount || unit.wallOrder;
    if (assignment) occupied.add(wallAssignmentKey(assignment));
  }
  const slots = wallWalkSlots(world, start).filter(slot => !occupied.has(wallAssignmentKey(slot)));
  const eligible = units.filter(unit => unit.alive && unit.side === start.side && unit.type === 'musk'
    && unit.state !== 'flee');
  let assigned = 0;
  for (const unit of eligible) {
    const slot = slots.shift();
    if (!slot) break;
    const stair = stairs.reduce((best, candidate) => {
      const distance = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
      return !best || distance < best.distance ? { stair: candidate, distance } : best;
    }, null)?.stair;
    if (!stair) break;
    unit.wallMount = null;
    unit.wallElevation = 0;
    unit.wallOrder = { ...slot, stairId: stair.id };
    unit.orderX = stair.x;
    unit.orderY = stair.y;
    unit.orderTarget = null;
    unit.target = null;
    unit.state = 'move';
    assigned++;
  }
  const capacity = assigned + slots.length;
  const message = assigned
    ? `${assigned} musketeer${assigned === 1 ? '' : 's'} ordered to the wall walk.`
    : 'That wall walk has no open firing positions.';
  return { assigned, capacity, message };
}

export function updateWallAssignment(world, unit) {
  if (unit.wallMount) {
    const wall = world.buildings.find(building => building.id === unit.wallMount.wallId);
    const stair = world.buildings.find(building => building.id === unit.wallMount.stairId);
    const slot = wall && wallSlot(wall, unit.wallMount.slotIndex);
    if (!isCompletedWallWalkSegment(wall, unit.side) || !stair?.alive || !stair.complete
      || stair.type !== 'wall_stairs' || !slot) {
      dismountWallUnit(world, unit);
      return 'dismounted';
    }
    unit.x = slot.x;
    unit.y = slot.y;
    unit.px = slot.x;
    unit.py = slot.y;
    unit.wallElevation = slot.elevation;
    return 'mounted';
  }
  if (!unit.wallOrder) return 'none';
  const stair = world.buildings.find(building => building.id === unit.wallOrder.stairId);
  const wall = world.buildings.find(building => building.id === unit.wallOrder.wallId);
  if (!stair?.alive || !stair.complete || stair.type !== 'wall_stairs'
    || !isCompletedWallWalkSegment(wall, unit.side) || stair.wallId == null) {
    unit.wallOrder = null;
    return 'cancelled';
  }
  if (Math.hypot(unit.x - stair.x, unit.y - stair.y) > 11) return 'approaching';
  const slot = wallSlot(wall, unit.wallOrder.slotIndex);
  if (!slot) {
    unit.wallOrder = null;
    return 'cancelled';
  }
  unit.wallMount = { ...slot, stairId: stair.id };
  unit.wallOrder = null;
  unit.wallElevation = slot.elevation;
  unit.x = slot.x;
  unit.y = slot.y;
  unit.px = slot.x;
  unit.py = slot.y;
  unit.orderX = NaN;
  unit.orderY = NaN;
  unit.state = 'wall';
  unit.moving = false;
  return 'mounted';
}

export function dismountWallUnit(world, unit) {
  const assignment = unit.wallMount || unit.wallOrder;
  const stair = assignment
    ? world.buildings.find(building => building.id === assignment.stairId) : null;
  if (stair) {
    const frame = fortificationFrame(stair.type, stair.x, stair.y, stair.orientation);
    const side = stair.stairSide || 1;
    unit.x = stair.x + frame.normal.x * side * 8;
    unit.y = stair.y + frame.normal.y * side * 8;
    unit.px = unit.x;
    unit.py = unit.y;
  }
  unit.wallMount = null;
  unit.wallOrder = null;
  unit.wallElevation = 0;
  if (unit.state === 'wall') unit.state = 'idle';
}

export function dismountWallUnits(world, units) {
  for (const unit of units) {
    if (unit.wallMount || unit.wallOrder) dismountWallUnit(world, unit);
  }
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

export function nearestFriendlyFortificationEndpoint(world, side, x, y,
  maxDistance = FORTIFICATION_ENDPOINT_PICK_DISTANCE) {
  let best = null;
  let bestDistance = maxDistance;
  for (const building of world.buildings) {
    if (!building.alive || building.side !== side || !isFortificationType(building.type)) continue;
    for (const endpoint of fortificationEndpoints(building)) {
      const distance = Math.hypot(endpoint.x - x, endpoint.y - y);
      if (distance > bestDistance) continue;
      bestDistance = distance;
      best = { ...endpoint, buildingId: building.id, distance };
    }
  }
  return best;
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
    const solidWall = wall.type === 'wall' && (wall.complete || wall.progress >= 0.24);
    const closedGate = wall.type === 'gate' && wall.complete && !isGateOpen(wall);
    if (!wall.alive || (!solidWall && !closedGate)) continue;
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
