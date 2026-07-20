// Economy, construction, gathering and production queues. The battle simulator
// owns movement/combat; this module owns settlement state and resource rules.

import {
  WORLD, NATIONS, UNIT_TYPES, BUILDING_TYPES, RESOURCE_KEYS,
  STARTING_RESOURCES, GATHER_RATES, MAX_POPULATION,
} from './config.js';
import { applyMoveOrder } from './formations.js';
import {
  fortificationAxis, fortificationCorners, fortificationFrame,
  fortificationsOverlap, fortificationsShareEndpoint,
  isFortificationType, normalizeFortificationOrientation,
  nearestFriendlyFortificationEndpoint,
  pointDistanceToFortification, pointInsideFortification,
  resolveWallStairAttachment, snapFortificationPlacement,
} from './fortifications.js';
import { resolveWorkerAction } from './worker-animation.js';
import { sfx } from './audio.js';
import { assignVillagerPath, clearVillagerPath } from './navigation.js';

let nextEntityId = 100000;

export const MILL_FIELD_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -122 }),
  Object.freeze({ x: 126, y: -82 }),
  Object.freeze({ x: 132, y: 48 }),
  Object.freeze({ x: 76, y: 146 }),
  Object.freeze({ x: -76, y: 146 }),
  Object.freeze({ x: -132, y: 48 }),
  Object.freeze({ x: -126, y: -82 }),
  Object.freeze({ x: 0, y: 122 }),
]);
const MILL_FIELD_PICK_RADIUS = 340;
export const AUTO_BUILD_SEARCH_RADIUS = 420;
const MIN_FULL_REPAIR_SECONDS = 18;
const REPAIR_BUILD_TIME_MULTIPLIER = 1.5;

const FIELD_WORK_POSITIONS = Object.freeze([
  [-0.34, 0.05], [-0.10, 0.06], [0.14, 0.08], [0.36, 0.10],
  [-0.36, 0.18], [-0.12, 0.17], [0.12, 0.19], [0.35, 0.20],
  [-0.30, 0.30], [-0.08, 0.28], [0.16, 0.31], [0.34, 0.27],
]);

export function reserveEntityIds(maxId) {
  if (Number.isFinite(maxId)) nextEntityId = Math.max(nextEntityId, Math.floor(maxId) + 1);
}

function freshResources() {
  return Object.fromEntries(RESOURCE_KEYS.map(key => [key, STARTING_RESOURCES[key] || 0]));
}

function freshRates() {
  return Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
}

export function formatCost(cost = {}) {
  return RESOURCE_KEYS.filter(key => cost[key]).map(key => `${cost[key]} ${key}`).join(' · ');
}

export function hasResources(side, cost = {}) {
  return RESOURCE_KEYS.every(key => (side.resources[key] || 0) + 1e-6 >= (cost[key] || 0));
}

function spendResources(side, cost = {}) {
  if (!hasResources(side, cost)) return false;
  for (const key of RESOURCE_KEYS) side.resources[key] -= cost[key] || 0;
  return true;
}

function refundResources(side, cost = {}, fraction = 1) {
  for (const key of RESOURCE_KEYS) side.resources[key] += (cost[key] || 0) * fraction;
}

export function createBuilding(side, type, x, y, complete = false, options = {}) {
  const def = BUILDING_TYPES[type];
  if (!def) throw new Error(`Unknown building type: ${type}`);
  const building = {
    id: nextEntityId++, entityKind: 'building', side, type,
    x, y, radius: def.radius, w: def.w, h: def.h,
    hp: complete ? def.hp : Math.max(1, def.hp * 0.08), maxHp: def.hp,
    alive: true, selected: false, complete,
    progress: complete ? 1 : 0.02,
    repairing: false, repairProgress: 0, repairStartHp: null,
    fireT: 0, aimAngle: 0,
    queue: [], rallyX: NaN, rallyY: NaN, rallyTargetId: null,
    reload: Math.random() * (def.reload || 0),
    resourceType: def.resource || null,
    amount: def.amount || 0,
  };
  if (def.fortification) {
    building.orientation = normalizeFortificationOrientation(options.orientation);
    if (type === 'gate') building.gateOpen = options.gateOpen !== false;
  }
  if (def.wallAttachment) {
    building.orientation = normalizeFortificationOrientation(options.orientation);
    building.wallId = Number.isFinite(options.wallId) ? options.wallId : null;
    building.stairSide = options.stairSide === -1 ? -1 : 1;
    building.stairAlong = Number.isFinite(options.stairAlong) ? options.stairAlong : 0;
  }
  if (type === 'farm') {
    building.millId = Number.isFinite(options.millId) ? options.millId : null;
    building.fieldSlot = Number.isInteger(options.fieldSlot) ? options.fieldSlot : null;
  }
  return building;
}

function createResource(type, x, y, amount, radius = 38) {
  return {
    id: nextEntityId++, entityKind: 'resource', type, resourceType: type,
    x, y, amount, maxAmount: amount, radius, alive: true,
    seed: Math.random() * 10000,
  };
}

function addResourceCluster(world, type, x, y, amount, radius) {
  const node = createResource(type, x, y, amount, radius);
  world.resources.push(node);
  return node;
}

function seedMapResources(world) {
  const cy = WORLD.h / 2;
  for (const side of [0, 1]) {
    const baseX = side === 0 ? 720 : WORLD.w - 720;
    const dir = side === 0 ? 1 : -1;
    addResourceCluster(world, 'food', baseX + dir * 245, cy - 235, 5200, 46);
    addResourceCluster(world, 'wood', baseX + dir * 385, cy - 20, 14000, 72);
    addResourceCluster(world, 'gold', baseX + dir * 320, cy + 245, 9000, 50);
    addResourceCluster(world, 'stone', baseX + dir * 500, cy - 330, 9000, 52);
  }

  // Rich central deposits create a reason for the two growing settlements to
  // contest the middle rather than turtle indefinitely.
  addResourceCluster(world, 'wood', WORLD.w / 2, cy - 520, 26000, 95);
  addResourceCluster(world, 'wood', WORLD.w / 2, cy + 520, 26000, 95);
  addResourceCluster(world, 'gold', WORLD.w / 2 - 130, cy, 18000, 65);
  addResourceCluster(world, 'stone', WORLD.w / 2 + 150, cy + 100, 18000, 65);
  addResourceCluster(world, 'food', WORLD.w / 2, cy - 235, 9000, 55);
}

export function initializeEconomy(world) {
  world.buildings = [];
  world.resources = [];
  world.events = [];

  seedMapResources(world);
  for (const sideIndex of [0, 1]) {
    const side = world.sides[sideIndex];
    side.resources = freshResources();
    side.incomePerHour = freshRates();
    side.incomeSample = freshRates();
    side.incomeSampleTime = 0;
    side.population = 0;
    side.queuedPopulation = 0;
    side.popCap = BUILDING_TYPES.town_center.popCap;
    side.maxPopulation = MAX_POPULATION;
    side.unitsCreated = 0;
    side.buildingsLost = 0;
    const x = sideIndex === 0 ? 660 : WORLD.w - 660;
    const tc = createBuilding(sideIndex, 'town_center', x, WORLD.h / 2, true);
    world.buildings.push(tc);
    side.townCenterId = tc.id;

    // This is intentionally free: the first frame contains only the Town
    // Center, then its first resident emerges. The player can never be stuck.
    queueUnit(world, tc, 'villager', 1, { free: true, trainTime: 4 });
  }
}

export function buildingsOf(world, side, type = null, completedOnly = false) {
  return world.buildings.filter(b => b.alive && b.side === side
    && (!type || b.type === type) && (!completedOnly || b.complete));
}

export function unitsOf(world, side, type = null) {
  return world.units.filter(u => u.alive && u.side === side && (!type || u.type === type));
}

export function getTownCenter(world, side) {
  return world.buildings.find(b => b.id === world.sides[side].townCenterId && b.alive) || null;
}

export function getMillFieldSlots(mill) {
  if (!mill) return [];
  return MILL_FIELD_OFFSETS.map((offset, fieldSlot) => ({
    x: mill.x + offset.x,
    y: mill.y + offset.y,
    millId: mill.id,
    fieldSlot,
  }));
}

function completedMillForField(world, field) {
  if (!Number.isFinite(field?.millId)) return null;
  return world.buildings.find(building => building.id === field.millId
    && building.alive && building.complete && building.side === field.side
    && building.type === 'mill') || null;
}

export function isOperationalField(world, field) {
  return Boolean(field?.alive && field.complete && field.type === 'farm'
    && completedMillForField(world, field));
}

export function getFieldWorkPoint(field, workerId) {
  const index = Math.abs(Number(workerId) || 0) % FIELD_WORK_POSITIONS.length;
  const [nx, ny] = FIELD_WORK_POSITIONS[index];
  const angle = (field?.fieldSlot || 0) % 2 ? 0.12 : -0.18;
  const lx = nx * (field?.w || BUILDING_TYPES.farm.w);
  const ly = ny * (field?.h || BUILDING_TYPES.farm.h);
  return {
    x: field.x + lx * Math.cos(angle) - ly * Math.sin(angle),
    y: field.y + lx * Math.sin(angle) + ly * Math.cos(angle),
  };
}

export function getFieldAttachmentStatus(world, side) {
  const mills = world.buildings.filter(building => building.alive && building.complete
    && building.side === side && building.type === 'mill');
  if (!mills.length) return { ok: false, message: 'Build and complete a Mill first.' };
  const occupied = new Set(world.buildings.filter(building => building.alive
    && building.side === side && building.type === 'farm' && Number.isFinite(building.millId)
    && Number.isInteger(building.fieldSlot))
    .map(building => `${building.millId}:${building.fieldSlot}`));
  const openSlots = mills.flatMap(mill => getMillFieldSlots(mill)
    .filter(slot => !occupied.has(`${slot.millId}:${slot.fieldSlot}`)));
  return openSlots.length
    ? { ok: true, message: `${openSlots.length} field plot${openSlots.length === 1 ? '' : 's'} available.`, openSlots }
    : { ok: false, message: 'Every Mill is full. Build another Mill for more fields.' };
}

/**
 * Upgrade pre-link campaign saves to the mill-owned field model. Existing
 * valid links are preserved; legacy fields are moved to the nearest free plot
 * so resumed campaigns obey the same geometry as newly placed fields.
 */
export function repairFieldAttachments(world) {
  const mills = new Map(world.buildings.filter(building => building.alive && building.complete
    && building.type === 'mill').map(building => [building.id, building]));
  const occupied = new Set();
  const pending = [];
  const fields = world.buildings.filter(building => building.alive && building.type === 'farm')
    .sort((a, b) => a.id - b.id);

  for (const field of fields) {
    const mill = mills.get(field.millId);
    const slotValid = Number.isInteger(field.fieldSlot)
      && field.fieldSlot >= 0 && field.fieldSlot < MILL_FIELD_OFFSETS.length;
    const key = `${field.millId}:${field.fieldSlot}`;
    if (mill?.side === field.side && slotValid && !occupied.has(key)) occupied.add(key);
    else pending.push(field);
  }

  let repaired = 0;
  for (const field of pending) {
    const candidates = [...mills.values()].filter(mill => mill.side === field.side)
      .flatMap(mill => getMillFieldSlots(mill))
      .filter(slot => !occupied.has(`${slot.millId}:${slot.fieldSlot}`))
      .sort((a, b) => Math.hypot(field.x - a.x, field.y - a.y)
        - Math.hypot(field.x - b.x, field.y - b.y));
    const slot = candidates[0];
    if (!slot) {
      field.millId = null;
      field.fieldSlot = null;
      continue;
    }
    field.x = slot.x;
    field.y = slot.y;
    field.millId = slot.millId;
    field.fieldSlot = slot.fieldSlot;
    occupied.add(`${slot.millId}:${slot.fieldSlot}`);
    repaired++;
  }
  return repaired;
}

function resolveFieldAttachment(world, side, x, y) {
  const status = getFieldAttachmentStatus(world, side);
  if (!status.ok) return { error: status.message, x, y, millId: null, fieldSlot: null };
  const nearbyMills = world.buildings.filter(building => building.alive && building.complete
    && building.side === side && building.type === 'mill'
    && Math.hypot(x - building.x, y - building.y) <= MILL_FIELD_PICK_RADIUS);
  if (!nearbyMills.length) {
    return { error: 'Place the field beside a completed Mill.', x, y, millId: null, fieldSlot: null };
  }
  const nearbyIds = new Set(nearbyMills.map(mill => mill.id));
  const slot = status.openSlots.filter(candidate => nearbyIds.has(candidate.millId))
    .sort((a, b) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y))[0];
  if (!slot) {
    return { error: 'This Mill is full. Build another Mill for more fields.', x, y, millId: null, fieldSlot: null };
  }
  return slot;
}

export function validatePlacement(world, side, type, x, y, options = {}) {
  const def = BUILDING_TYPES[type];
  if (!def || type === 'town_center') return { ok: false, message: 'That building cannot be placed.' };
  const fortification = isFortificationType(type);
  const wallAttachment = Boolean(def.wallAttachment);
  const fieldAttachment = type === 'farm' ? resolveFieldAttachment(world, side, x, y) : null;
  const stairAttachment = wallAttachment ? resolveWallStairAttachment(world, side, x, y) : null;
  const snapped = fieldAttachment || stairAttachment || (fortification && options.snap !== false
    ? snapFortificationPlacement(world, side, type, x, y, options.orientation)
    : { x, y, orientation: fortification ? normalizeFortificationOrientation(options.orientation) : null,
      snappedToId: null });
  const candidate = {
    type, x: snapped.x, y: snapped.y, orientation: snapped.orientation,
    wallId: snapped.wallId ?? null,
  };
  const placement = {
    x: candidate.x,
    y: candidate.y,
    orientation: candidate.orientation,
    snappedToId: snapped.snappedToId,
    millId: snapped.millId ?? null,
    fieldSlot: snapped.fieldSlot ?? null,
    wallId: snapped.wallId ?? null,
    stairSide: snapped.stairSide ?? null,
    stairAlong: snapped.stairAlong ?? null,
  };
  const reject = message => ({ ok: false, message, ...placement });
  if (fieldAttachment?.error) return reject(fieldAttachment.error);
  if (wallAttachment && !stairAttachment) {
    return reject('Place the staircase beside a completed friendly Stone Wall.');
  }
  const outsideMap = fortification || wallAttachment
    ? fortificationCorners(type, candidate.x, candidate.y, candidate.orientation, 35)
      .some(point => point.x < 0 || point.y < 0 || point.x > WORLD.w || point.y > WORLD.h)
    : candidate.x < def.radius + 35 || candidate.y < def.radius + 35
      || candidate.x > WORLD.w - def.radius - 35 || candidate.y > WORLD.h - def.radius - 35;
  if (outsideMap) {
    return reject('Build inside the map boundary.');
  }
  for (const b of world.buildings) {
    if (!b.alive) continue;
    const existingFortification = isFortificationType(b.type);
    if (wallAttachment && b.id === candidate.wallId) continue;
    if (wallAttachment && (existingFortification || BUILDING_TYPES[b.type]?.wallAttachment)) {
      if (fortificationsOverlap(candidate, b, 1)) {
        return reject('The staircase needs a clear wall-side approach.');
      }
      continue;
    }
    if (fortification && existingFortification) {
      if (fortificationsOverlap(candidate, b, 1)
        && !(b.side === side && fortificationsShareEndpoint(candidate, b))) {
        return reject('That wall section overlaps another fortification.');
      }
      continue;
    }
    const blocked = fortification || wallAttachment
      ? pointDistanceToFortification(candidate, b.x, b.y) < b.radius + 18
      : existingFortification
        ? pointDistanceToFortification(b, candidate.x, candidate.y) < def.radius + 18
        : Math.hypot(candidate.x - b.x, candidate.y - b.y) < def.radius + b.radius + 18;
    if (blocked) {
      return reject('Too close to another building.');
    }
  }
  for (const r of world.resources) {
    if (!r.alive || r.amount <= 0) continue;
    const distance = fortification || wallAttachment
      ? pointDistanceToFortification(candidate, r.x, r.y)
      : Math.hypot(candidate.x - r.x, candidate.y - r.y);
    if (distance < ((fortification || wallAttachment) ? r.radius + 10 : def.radius + r.radius + 10)) {
      return reject('Resource deposits must remain accessible.');
    }
  }
  const nearestOwn = world.buildings.reduce((best, b) => {
    if (!b.alive || b.side !== side) return best;
    return Math.min(best, Math.hypot(candidate.x - b.x, candidate.y - b.y));
  }, Infinity);
  if (nearestOwn > 900) return reject('Build within your settlement frontier.');
  return { ok: true, message: '', ...placement };
}

function affordableCount(side, cost) {
  let count = Infinity;
  for (const resourceType of RESOURCE_KEYS) {
    const price = cost[resourceType] || 0;
    if (price > 0) count = Math.min(count, Math.floor((side.resources[resourceType] || 0) / price));
  }
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function wallPath(points, startX, startY, endX, endY) {
  const path = [{ x: startX, y: startY }];
  for (const point of points || []) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    const previous = path.at(-1);
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) path.push({ x: point.x, y: point.y });
  }
  const last = path.at(-1);
  if (Math.hypot(endX - last.x, endY - last.y) >= 2) path.push({ x: endX, y: endY });
  return path;
}

function wallPathMetrics(path) {
  const lengths = [0];
  for (let index = 1; index < path.length; index++) {
    lengths.push(lengths.at(-1) + Math.hypot(
      path[index].x - path[index - 1].x,
      path[index].y - path[index - 1].y,
    ));
  }
  return { lengths, total: lengths.at(-1) };
}

function pointAlongWallPath(path, metrics, distance) {
  if (path.length === 1 || metrics.total < 0.001) return { ...path[0] };
  const target = Math.max(0, Math.min(metrics.total, distance));
  let index = 1;
  while (index < metrics.lengths.length - 1 && metrics.lengths[index] < target) index++;
  const segmentStart = metrics.lengths[index - 1];
  const segmentLength = Math.max(0.001, metrics.lengths[index] - segmentStart);
  const mix = (target - segmentStart) / segmentLength;
  return {
    x: path[index - 1].x + (path[index].x - path[index - 1].x) * mix,
    y: path[index - 1].y + (path[index].y - path[index - 1].y) * mix,
  };
}

function shortestAngleDifference(from, to) {
  let difference = (to - from) % (Math.PI * 2);
  if (difference <= -Math.PI) difference += Math.PI * 2;
  if (difference > Math.PI) difference -= Math.PI * 2;
  return difference;
}

function initialWallPathAngle(path, fallbackOrientation) {
  for (let index = 1; index < path.length; index++) {
    const dx = path[index].x - path[0].x;
    const dy = path[index].y - path[0].y;
    if (Math.hypot(dx, dy) >= 2) return Math.atan2(dy, dx);
  }
  const axis = fortificationAxis(fallbackOrientation);
  return Math.atan2(axis.y, axis.x);
}

function planCurvedWallRun(world, sideIndex, startX, startY, endX, endY,
  orientation, pathPoints, maxAffordable) {
  const def = BUILDING_TYPES.wall;
  const path = wallPath(pathPoints, startX, startY, endX, endY);
  const metrics = wallPathMetrics(path);
  const requestedCount = Math.max(1, Math.min(256, Math.floor(metrics.total / def.w) + 1));
  const limit = Math.min(requestedCount, maxAffordable);
  const firstAngle = initialWallPathAngle(path, orientation);
  const firstAxis = { x: Math.cos(firstAngle), y: Math.sin(firstAngle) };
  const connection = nearestFriendlyFortificationEndpoint(world, sideIndex, startX, startY);
  const offsetX = connection ? connection.x - startX : 0;
  const offsetY = connection ? connection.y - startY : 0;
  let endpoint = connection
    ? { x: connection.x, y: connection.y }
    : { x: startX - firstAxis.x * def.w * 0.5, y: startY - firstAxis.y * def.w * 0.5 };
  let previousAngle = firstAngle;
  const maxTurn = Math.PI / 8;
  const previewWorld = { ...world, buildings: world.buildings.slice() };
  const segments = [];
  let blockedMessage = '';

  for (let index = 0; index < limit; index++) {
    const target = pointAlongWallPath(path, metrics, Math.min(metrics.total, (index + 0.5) * def.w));
    target.x += offsetX;
    target.y += offsetY;
    const dx = target.x - endpoint.x;
    const dy = target.y - endpoint.y;
    const desiredAngle = Math.hypot(dx, dy) > 2 ? Math.atan2(dy, dx) : previousAngle;
    const turn = Math.max(-maxTurn, Math.min(maxTurn,
      shortestAngleDifference(previousAngle, desiredAngle)));
    const angle = normalizeFortificationOrientation(previousAngle + turn);
    const axis = fortificationAxis(angle);
    const x = endpoint.x + axis.x * def.w * 0.5;
    const y = endpoint.y + axis.y * def.w * 0.5;
    const validation = validatePlacement(previewWorld, sideIndex, 'wall', x, y, {
      orientation: angle,
      snap: false,
    });
    if (!validation.ok) {
      blockedMessage = validation.message;
      break;
    }
    const segment = {
      type: 'wall', x, y, orientation: angle, valid: true,
      connectedToId: index === 0 ? connection?.buildingId ?? null : -(index),
    };
    segments.push(segment);
    previewWorld.buildings.push({
      id: -(index + 1), entityKind: 'building', side: sideIndex,
      alive: true, complete: false, progress: 0.02, radius: def.radius,
      ...segment,
    });
    endpoint = { x: endpoint.x + axis.x * def.w, y: endpoint.y + axis.y * def.w };
    previousAngle = angle;
  }

  if (!segments.length) {
    return { ok: false, segments, requestedCount, message: blockedMessage || 'No wall section fits there.' };
  }
  const cost = { stone: segments.length * def.cost.stone };
  const limitedByResources = requestedCount > maxAffordable;
  const limitedByObstacle = segments.length < limit;
  const suffix = limitedByResources
    ? ' · run shortened to available stone'
    : limitedByObstacle ? ` · stopped: ${blockedMessage}` : '';
  const connectionMessage = connection ? ' · connected to existing wall' : '';
  return {
    ok: true,
    type: 'wall',
    orientation: segments[0].orientation,
    segments,
    requestedCount,
    cost,
    limitedByResources,
    limitedByObstacle,
    curved: segments.some((segment, index) => index > 0
      && Math.abs(shortestAngleDifference(segments[index - 1].orientation, segment.orientation)) > 0.01),
    message: `${segments.length} wall section${segments.length === 1 ? '' : 's'} · ${cost.stone} stone${connectionMessage}${suffix}`,
  };
}

export function planWallRun(
  world, sideIndex, startX, startY, endX, endY, orientation = 'horizontal', pathPoints = null,
) {
  const def = BUILDING_TYPES.wall;
  const side = world?.sides?.[sideIndex];
  if (!side) return { ok: false, segments: [], message: 'The settlement is unavailable.' };
  const maxAffordable = affordableCount(side, def.cost);
  if (maxAffordable < 1) {
    return { ok: false, segments: [], message: `Need ${formatCost(def.cost)} for a wall section.` };
  }
  if (pathPoints) {
    return planCurvedWallRun(
      world, sideIndex, startX, startY, endX, endY, orientation, pathPoints, maxAffordable,
    );
  }

  const first = validatePlacement(world, sideIndex, 'wall', startX, startY, { orientation });
  if (!first.ok) return { ...first, segments: [], requestedCount: 0 };
  const axis = fortificationAxis(first.orientation);
  const projection = (endX - first.x) * axis.x + (endY - first.y) * axis.y;
  const direction = projection < 0 ? -1 : 1;
  const requestedCount = Math.max(1, Math.min(256, Math.floor(Math.abs(projection) / def.w) + 1));
  const limit = Math.min(requestedCount, maxAffordable);
  const previewWorld = { ...world, buildings: world.buildings.slice() };
  const segments = [];
  let blockedMessage = '';

  for (let index = 0; index < limit; index++) {
    const x = first.x + axis.x * def.w * index * direction;
    const y = first.y + axis.y * def.w * index * direction;
    const validation = validatePlacement(previewWorld, sideIndex, 'wall', x, y, {
      orientation: first.orientation,
    });
    if (!validation.ok) {
      blockedMessage = validation.message;
      break;
    }
    const segment = {
      type: 'wall', x: validation.x, y: validation.y,
      orientation: validation.orientation, valid: true,
    };
    segments.push(segment);
    previewWorld.buildings.push({
      id: -(index + 1), entityKind: 'building', side: sideIndex,
      alive: true, complete: false, progress: 0.02, radius: def.radius,
      ...segment,
    });
  }

  if (!segments.length) {
    return { ok: false, segments, requestedCount, message: blockedMessage || 'No wall section fits there.' };
  }
  const cost = { stone: segments.length * def.cost.stone };
  const limitedByResources = requestedCount > maxAffordable;
  const limitedByObstacle = segments.length < limit;
  const suffix = limitedByResources
    ? ' · run shortened to available stone'
    : limitedByObstacle ? ` · stopped: ${blockedMessage}` : '';
  return {
    ok: true,
    type: 'wall',
    orientation: first.orientation,
    segments,
    requestedCount,
    cost,
    limitedByResources,
    limitedByObstacle,
    message: `${segments.length} wall section${segments.length === 1 ? '' : 's'} · ${cost.stone} stone${suffix}`,
  };
}

function assignBuildersToRun(builders, buildings) {
  if (!buildings.length) return;
  const ids = buildings.map(building => building.id);
  for (const worker of builders) {
    if (!worker.alive || worker.side !== buildings[0].side || worker.type !== 'villager') continue;
    worker.job = { kind: 'build', targetId: ids[0], queue: ids.slice(1) };
    worker.workAction = 'build';
    worker.orderTarget = null;
    worker.target = null;
    clearVillagerPath(worker);
  }
}

export function placeWallRun(
  world, sideIndex, startX, startY, endX, endY, builders, orientation = 'horizontal', pathPoints = null,
) {
  const validBuilders = builders.filter(unit => unit.alive && unit.side === sideIndex && unit.type === 'villager');
  if (!validBuilders.length) return { ok: false, message: 'Select at least one villager.' };
  const plan = planWallRun(world, sideIndex, startX, startY, endX, endY, orientation, pathPoints);
  if (!plan.ok) return plan;
  if (!spendResources(world.sides[sideIndex], plan.cost)) {
    return { ok: false, message: `Need ${formatCost(plan.cost)}.` };
  }
  const buildings = plan.segments.map(segment => createBuilding(
    sideIndex, 'wall', segment.x, segment.y, false, { orientation: segment.orientation },
  ));
  world.buildings.push(...buildings);
  world.navigationVersion = (world.navigationVersion || 0) + 1;
  assignBuildersToRun(validBuilders, buildings);
  return {
    ...plan,
    buildings,
    building: buildings[0],
    message: `${buildings.length} wall foundation${buildings.length === 1 ? '' : 's'} placed · ${plan.cost.stone} stone.`,
  };
}

export function placeBuilding(world, sideIndex, type, x, y, builders, options = {}) {
  const side = world.sides[sideIndex];
  const def = BUILDING_TYPES[type];
  const validBuilders = builders.filter(u => u.alive && u.side === sideIndex && u.type === 'villager');
  if (!def) return { ok: false, message: 'Unknown building.' };
  if (!options.ai && validBuilders.length === 0) return { ok: false, message: 'Select at least one villager.' };
  const placement = validatePlacement(world, sideIndex, type, x, y, options);
  if (!placement.ok) return placement;
  if (!spendResources(side, def.cost)) {
    return { ok: false, message: `Need ${formatCost(def.cost)}.` };
  }
  const building = createBuilding(
    sideIndex,
    type,
    placement.x ?? x,
    placement.y ?? y,
    false,
    {
      orientation: placement.orientation,
      millId: placement.millId,
      fieldSlot: placement.fieldSlot,
      wallId: placement.wallId,
      stairSide: placement.stairSide,
      stairAlong: placement.stairAlong,
    },
  );
  world.buildings.push(building);
  world.navigationVersion = (world.navigationVersion || 0) + 1;
  assignBuilders(world, validBuilders, building);
  const message = type === 'farm'
    ? `Field attached to Mill · plot ${building.fieldSlot + 1} of ${MILL_FIELD_OFFSETS.length}.`
    : `${def.label} foundation placed.`;
  return { ok: true, building, message };
}

export function assignBuilders(world, workers, building) {
  if (!building || !building.alive || building.complete) return false;
  let assigned = false;
  for (const worker of workers) {
    if (!worker.alive || worker.type !== 'villager' || worker.side !== building.side) continue;
    worker.job = { kind: 'build', targetId: building.id };
    worker.workAction = 'build';
    worker.orderTarget = null;
    worker.target = null;
    clearVillagerPath(worker);
    assigned = true;
  }
  return assigned;
}

export function isRepairableBuilding(building, side = null) {
  return Boolean(building?.alive && building.entityKind === 'building' && building.complete
    && building.hp < building.maxHp - 0.01
    && (side === null || building.side === side));
}

export function buildingRepairDuration(building) {
  const buildTime = BUILDING_TYPES[building?.type]?.buildTime || 0;
  return Math.max(MIN_FULL_REPAIR_SECONDS, buildTime * REPAIR_BUILD_TIME_MULTIPLIER);
}

export function assignRepairers(world, workers, building) {
  if (!world || !isRepairableBuilding(building)) return false;
  const validWorkers = workers.filter(worker => worker?.alive && worker.type === 'villager'
    && worker.side === building.side);
  if (validWorkers.length === 0) return false;

  const repairAlreadyActive = world.units.some(worker => worker.alive
    && worker.job?.kind === 'repair' && worker.job.targetId === building.id);
  if (!repairAlreadyActive) {
    building.repairStartHp = building.hp;
    building.repairProgress = 0;
  }
  building.repairing = true;
  for (const worker of validWorkers) {
    worker.job = { kind: 'repair', targetId: building.id };
    worker.workAction = 'build';
    worker.orderTarget = null;
    worker.target = null;
    clearVillagerPath(worker);
  }
  return true;
}

export function assignGatherers(world, workers, target) {
  const isFarm = target?.entityKind === 'building' && isOperationalField(world, target);
  const isDeposit = target?.entityKind === 'resource' && target.alive && target.amount > 0;
  const workResources = target?.entityKind === 'building'
    ? BUILDING_TYPES[target.type]?.workResources || [] : [];
  const isWorkplace = workResources.length > 0 && target.complete && target.alive;
  if (!isFarm && !isDeposit && !isWorkplace) return false;
  let assigned = false;
  for (const worker of workers) {
    if (!worker.alive || worker.type !== 'villager') continue;
    if ((isFarm || isWorkplace) && worker.side !== target.side) continue;
    if (isWorkplace) {
      const side = world.sides[worker.side];
      const resourceType = workResources.reduce((best, resource) => (
        (side.resources[resource] || 0) < (side.resources[best] || 0) ? resource : best
      ), workResources[0]);
      worker.job = { kind: 'workplace', targetId: target.id, resourceType };
    } else {
      worker.job = { kind: 'gather', targetId: target.id };
    }
    worker.workAction = resolveWorkerAction(worker.job, target);
    clearVillagerPath(worker);
    worker.orderTarget = null;
    worker.target = null;
    assigned = true;
  }
  return assigned;
}

export function clearWorkerJobs(units) {
  for (const unit of units) {
    if (unit.type !== 'villager') continue;
    unit.job = null;
    unit.workAction = null;
    clearVillagerPath(unit);
    if (unit.state === 'work') unit.state = 'idle';
  }
}

function populationSpace(side, unitType) {
  const pop = UNIT_TYPES[unitType].pop || 1;
  return side.population + side.queuedPopulation + pop <= Math.min(side.popCap, side.maxPopulation);
}

export function queueUnit(world, building, unitType, count = 1, options = {}) {
  const def = UNIT_TYPES[unitType];
  const bDef = BUILDING_TYPES[building?.type];
  if (!building?.alive || !building.complete || !def || !bDef?.trains?.includes(unitType)) {
    return { ok: false, queued: 0, message: 'That unit cannot be trained here.' };
  }
  const side = world.sides[building.side];
  let queued = 0;
  const wanted = Math.max(1, Math.min(50, count | 0));
  for (let i = 0; i < wanted; i++) {
    if (!populationSpace(side, unitType)) break;
    if (!options.free && !spendResources(side, def.cost)) break;
    const nationMult = unitType === 'villager'
      ? (NATIONS[side.nation].mults.villagerTrain || 1) : 1;
    const total = (options.trainTime ?? def.trainTime) * nationMult;
    building.queue.push({ type: unitType, remaining: total, total });
    side.queuedPopulation += def.pop || 1;
    queued++;
  }
  if (queued === 0) {
    const capFull = !populationSpace(side, unitType);
    return {
      ok: false, queued: 0,
      message: capFull ? 'Population cap reached — build houses.' : `Need ${formatCost(def.cost)}.`,
    };
  }
  return { ok: true, queued, message: `${queued} ${def.label.toLowerCase()} queued.` };
}

function validRallyTarget(building, target) {
  if (!target?.alive) return false;
  if (target.entityKind === 'resource') return target.amount > 0;
  return target.entityKind === 'building' && target.side === building.side;
}

export function setRallyPoint(building, x, y, target = null) {
  if (!building?.alive || !BUILDING_TYPES[building.type]?.trains) return false;
  const durableTarget = validRallyTarget(building, target) ? target : null;
  building.rallyX = durableTarget?.x ?? x;
  building.rallyY = durableTarget?.y ?? y;
  building.rallyTargetId = durableTarget?.id ?? null;
  return true;
}

function findTarget(world, targetId) {
  return world.resources.find(r => r.id === targetId)
    || world.buildings.find(b => b.id === targetId) || null;
}

export function getRallyTarget(world, building) {
  if (!world || !building || !Number.isFinite(building.rallyTargetId)) return null;
  const target = findTarget(world, building.rallyTargetId);
  return validRallyTarget(building, target) ? target : null;
}

function rallyDestination(unit, target, x, y) {
  if (!target) return { x, y };
  const dx = unit.x - target.x;
  const dy = unit.y - target.y;
  const distance = Math.hypot(dx, dy) || 1;
  const reach = target.radius + unit.radius + 8;
  return {
    x: target.x + dx / distance * reach,
    y: target.y + dy / distance * reach,
  };
}

function applyRallyOrder(world, building, unit) {
  if (Number.isNaN(building.rallyX) || Number.isNaN(building.rallyY)) return 'idle';
  const target = getRallyTarget(world, building);
  if (unit.type === 'villager' && target) {
    if (target.entityKind === 'building' && !target.complete
      && assignBuilders(world, [unit], target)) return 'build';
    if (assignGatherers(world, [unit], target)) return 'work';
  }

  const destination = rallyDestination(unit, target, building.rallyX, building.rallyY);
  applyMoveOrder([unit], destination.x, destination.y, 'line');
  if (unit.type === 'villager') assignVillagerPath(world, unit, destination.x, destination.y);
  return 'move';
}

function wallStairConstructionPoint(world, target, worker) {
  if (target.type !== 'wall_stairs' || worker.job?.kind !== 'build') return null;
  const wall = world.buildings.find(building => building.id === target.wallId);
  const frame = wall && fortificationFrame(wall.type, wall.x, wall.y, wall.orientation);
  if (!frame) return null;

  const relativeX = worker.x - frame.x;
  const relativeY = worker.y - frame.y;
  const workerAcross = relativeX * frame.normal.x + relativeY * frame.normal.y;
  const stairSide = target.stairSide === -1 ? -1 : 1;
  const safeAcross = frame.halfThickness + worker.radius + 9;
  let along = target.stairAlong || 0;
  let across = stairSide * (frame.halfThickness + target.h + 9);

  // A staircase can be ordered from the far side of its host wall. Use a
  // wall-side masonry position there (the construction art includes a hoist),
  // rather than sending the villager directly through blocking masonry.
  if (workerAcross * stairSide < 0) {
    across = Math.sign(workerAcross || -stairSide) * safeAcross;
  }

  const x = frame.x + frame.axis.x * along + frame.normal.x * across;
  const y = frame.y + frame.axis.y * along + frame.normal.y * across;
  return {
    x,
    y,
    distance: Math.hypot(worker.x - x, worker.y - y),
    arrivalDistance: 11,
  };
}

function nearestPoint(world, target, worker) {
  const stairPoint = wallStairConstructionPoint(world, target, worker);
  if (stairPoint) return stairPoint;
  if (target.type === 'farm' && target.complete && worker.job?.kind === 'gather') {
    const point = getFieldWorkPoint(target, worker.id);
    return {
      ...point,
      distance: Math.hypot(worker.x - point.x, worker.y - point.y),
      arrivalDistance: 4.5,
    };
  }
  const dx = worker.x - target.x;
  const dy = worker.y - target.y;
  const d = Math.hypot(dx, dy) || 1;
  const reach = target.radius + 7;
  return {
    x: target.x + dx / d * reach,
    y: target.y + dy / d * reach,
    distance: d,
    arrivalDistance: target.radius + 16,
  };
}

function completeBuilding(world, building) {
  if (building.complete) return;
  building.complete = true;
  building.progress = 1;
  building.hp = building.maxHp;
  const def = BUILDING_TYPES[building.type];
  if (def.popCap) {
    const side = world.sides[building.side];
    side.popCap = Math.min(side.maxPopulation, side.popCap + def.popCap);
  }
  if (building.type === 'farm') {
    for (const worker of world.units) {
      if (worker.job?.kind === 'build' && worker.job.targetId === building.id) {
        worker.job = { kind: 'gather', targetId: building.id };
      }
    }
  }
  sfx.buildingComplete(building.type, building.x);
  world.events.push({ side: building.side, text: `${def.label} completed.`, tone: 'good' });
}

function resourceMatchesBoost(boost, resourceType) {
  return boost === resourceType
    || (boost === 'mineral' && (resourceType === 'gold' || resourceType === 'stone'));
}

function findGatherBoostBuilding(world, worker, resourceType, x, y) {
  for (const building of world.buildings) {
    if (!building.alive || !building.complete || building.side !== worker.side) continue;
    if (Math.hypot(x - building.x, y - building.y) > 280) continue;
    if (resourceMatchesBoost(BUILDING_TYPES[building.type].boost, resourceType)) return building;
  }
  return null;
}

function gatherProfileAt(world, worker, target, x, y, resourceOverride = null) {
  const resourceType = resourceOverride || target?.resourceType;
  if (!resourceType || !GATHER_RATES[resourceType]) return null;
  let mult = 1;
  const nation = NATIONS[world.sides[worker.side].nation];
  if (resourceType === 'food' && target?.type === 'farm') mult *= nation.mults.farmRate || 1;
  const beforeBuildingBoost = mult;
  const boostBuilding = findGatherBoostBuilding(world, worker, resourceType, x, y);
  if (boostBuilding) mult *= 1.2;
  const basePerHour = GATHER_RATES[resourceType] * 3600;
  return {
    resourceType,
    target,
    worker,
    multiplier: mult,
    basePerHour,
    projectedPerHour: basePerHour * mult,
    boostBuildingId: boostBuilding?.id ?? null,
    boostBonusPerHour: boostBuilding ? basePerHour * beforeBuildingBoost * 0.2 : 0,
  };
}

function gatherProfile(world, worker) {
  if (worker.job?.kind !== 'gather' && worker.job?.kind !== 'workplace') return null;
  const target = findTarget(world, worker.job.targetId);
  if (!target?.alive) return null;
  if (worker.job.kind === 'workplace') {
    const workResources = BUILDING_TYPES[target.type]?.workResources || [];
    if (target.entityKind !== 'building' || !target.complete || target.side !== worker.side
      || !workResources.includes(worker.job.resourceType)) return null;
    return gatherProfileAt(
      world, worker, target, target.x, target.y, worker.job.resourceType,
    );
  }
  if (target.amount <= 0) return null;
  if (target.type === 'farm' && !isOperationalField(world, target)) return null;
  if (target.entityKind === 'building' && (!target.complete || target.side !== worker.side)) return null;
  return gatherProfileAt(world, worker, target, target.x, target.y);
}

export function getEconomyBreakdown(world, sideIndex, workers = null) {
  const result = Object.fromEntries(RESOURCE_KEYS.map(resourceType => [resourceType, {
    resourceType,
    workers: 0,
    projectedPerHour: 0,
    actualPerHour: world.sides[sideIndex].incomePerHour?.[resourceType] || 0,
    boostPerHour: 0,
  }]));
  const candidates = workers || world.units.filter(unit => unit.alive
    && unit.side === sideIndex && unit.type === 'villager');
  for (const worker of candidates) {
    if (!worker.alive || worker.side !== sideIndex || worker.type !== 'villager') continue;
    const profile = gatherProfile(world, worker);
    if (!profile) continue;
    const row = result[profile.resourceType];
    row.workers++;
    row.projectedPerHour += profile.projectedPerHour;
    row.boostPerHour += profile.boostBonusPerHour;
  }
  return result;
}

export function getGatherAssignmentStats(world, workers, target) {
  if (!target?.alive) return null;
  const workResources = target.entityKind === 'building'
    ? BUILDING_TYPES[target.type]?.workResources || [] : [];
  const isWorkplace = workResources.length > 0 && target.complete;
  const resourceType = isWorkplace
    ? workResources.reduce((best, resource) => {
      const side = world.sides[workers[0]?.side ?? target.side];
      return (side.resources[resource] || 0) < (side.resources[best] || 0) ? resource : best;
    }, workResources[0])
    : target.resourceType;
  if (!resourceType || (!isWorkplace && target.amount <= 0)) return null;
  const validWorkers = workers.filter(worker => worker.alive && worker.type === 'villager'
    && (target.entityKind !== 'building' || target.side === worker.side));
  let projectedPerHour = 0;
  for (const worker of validWorkers) {
    const profile = gatherProfileAt(world, worker, target, target.x, target.y, resourceType);
    projectedPerHour += profile?.projectedPerHour || 0;
  }
  return {
    resourceType,
    workers: validWorkers.length,
    projectedPerHour,
    amount: isWorkplace ? null : target.amount,
    renewable: isWorkplace,
    assignedWorkers: world.units.filter(worker => worker.alive && worker.type === 'villager'
      && worker.job?.targetId === target.id
      && (worker.job.kind === 'gather' || worker.job.kind === 'workplace')).length,
  };
}

export function getBuildingEconomyStats(world, building) {
  if (!building?.alive || !building.complete) return null;
  const def = BUILDING_TYPES[building.type];
  if (!building.resourceType && !def.boost && !def.workResources?.length) return null;
  const resources = Object.fromEntries(RESOURCE_KEYS.map(resourceType => [resourceType, {
    resourceType, workers: 0, projectedPerHour: 0, bonusPerHour: 0,
  }]));
  for (const worker of world.units) {
    if (!worker.alive || worker.side !== building.side || worker.type !== 'villager') continue;
    const profile = gatherProfile(world, worker);
    if (!profile) continue;
    const belongsToFarm = building.resourceType && profile.target.id === building.id;
    const employedHere = worker.job?.kind === 'workplace' && worker.job.targetId === building.id;
    const boostedHere = def.boost && profile.boostBuildingId === building.id;
    if (!belongsToFarm && !employedHere && !boostedHere) continue;
    const row = resources[profile.resourceType];
    row.workers++;
    row.projectedPerHour += profile.projectedPerHour;
    row.bonusPerHour += boostedHere ? profile.boostBonusPerHour : 0;
  }
  const activeResources = RESOURCE_KEYS.map(key => resources[key])
    .filter(row => row.workers > 0 || row.resourceType === building.resourceType
      || def.workResources?.includes(row.resourceType)
      || resourceMatchesBoost(def.boost, row.resourceType));
  return {
    buildingId: building.id,
    radius: def.boost ? 280 : 0,
    remaining: building.resourceType ? building.amount : null,
    resources: activeResources,
    workers: activeResources.reduce((sum, row) => sum + row.workers, 0),
    projectedPerHour: activeResources.reduce((sum, row) => sum + row.projectedPerHour, 0),
    bonusPerHour: activeResources.reduce((sum, row) => sum + row.bonusPerHour, 0),
  };
}

function nearbyUnfinishedConstruction(world, worker, origin) {
  const originX = Number.isFinite(origin?.x) ? origin.x : worker.x;
  const originY = Number.isFinite(origin?.y) ? origin.y : worker.y;
  let nearest = null;
  let nearestDistance = AUTO_BUILD_SEARCH_RADIUS;
  for (const building of world.buildings) {
    if (!building.alive || building.complete || building.side !== worker.side
      || building.id === origin?.id) continue;
    const distance = Math.hypot(building.x - originX, building.y - originY);
    if (distance > nearestDistance) continue;
    nearest = building;
    nearestDistance = distance;
  }
  return nearest;
}

function advanceBuildQueue(world, worker, origin = null) {
  const queue = Array.isArray(worker.job?.queue) ? worker.job.queue : [];
  while (queue.length) {
    const targetId = queue.shift();
    const target = world.buildings.find(building => building.id === targetId);
    if (!target?.alive || target.complete) continue;
    worker.job = { kind: 'build', targetId, queue };
    worker.workAction = 'build';
    return true;
  }
  const nearby = nearbyUnfinishedConstruction(world, worker, origin);
  if (nearby) {
    worker.job = { kind: 'build', targetId: nearby.id };
    worker.workAction = 'build';
    clearVillagerPath(worker);
    return true;
  }
  return false;
}

function updateWorkers(world, dt) {
  for (const building of world.buildings) building.repairing = false;

  for (const worker of world.units) {
    if (!worker.alive || worker.type !== 'villager' || !worker.job) continue;
    const target = findTarget(world, worker.job.targetId);
    if (!target || !target.alive) {
      if (worker.job.kind === 'build' && advanceBuildQueue(world, worker, target)) continue;
      worker.job = null;
      worker.workAction = null;
      if (worker.state === 'work') worker.state = 'idle';
      continue;
    }
    if (worker.job.kind === 'build' && target.complete) {
      if (target.type === 'farm') worker.job = { kind: 'gather', targetId: target.id };
      else if (!advanceBuildQueue(world, worker, target)) worker.job = null;
      worker.workAction = resolveWorkerAction(worker.job, target);
      if (!worker.job && worker.state === 'work') worker.state = 'idle';
      continue;
    }
    if (worker.job.kind === 'repair' && !isRepairableBuilding(target, worker.side)) {
      worker.job = null;
      worker.workAction = null;
      if (worker.state === 'work') worker.state = 'idle';
      continue;
    }
    if (worker.job.kind === 'repair') target.repairing = true;
    const point = nearestPoint(world, target, worker);
    // Movement stops within five pixels of its assigned slot, so the work
    // threshold includes that tolerance and avoids workers orbiting a site.
    if (point.distance > point.arrivalDistance) {
      worker.orderX = point.x;
      worker.orderY = point.y;
      worker.state = 'move';
      worker.workAction = null;
      continue;
    }
    worker.orderX = NaN;
    worker.orderY = NaN;
    worker.state = 'work';
    worker.workAction = resolveWorkerAction(worker.job, target);
    if (target.type === 'farm' && worker.job.kind === 'gather') {
      worker.facing = worker.id % 2 ? 1 : -1;
    } else if (Math.abs(target.x - worker.x) > 0.5) {
      worker.facing = target.x > worker.x ? 1 : -1;
    }
    worker.animT += dt * 1.4;

    if (worker.job.kind === 'build') {
      if (target.entityKind !== 'building' || target.complete) { worker.job = null; continue; }
      const def = BUILDING_TYPES[target.type];
      target.progress = Math.min(1, target.progress + dt / Math.max(1, def.buildTime));
      target.hp = Math.max(target.hp, target.maxHp * target.progress);
      if (target.progress >= 1) completeBuilding(world, target);
      continue;
    }

    if (worker.job.kind === 'repair') {
      const startHp = Number.isFinite(target.repairStartHp)
        ? Math.min(target.repairStartHp, target.hp) : target.hp;
      target.repairStartHp = startHp;
      target.hp = Math.min(
        target.maxHp,
        target.hp + target.maxHp / buildingRepairDuration(target) * dt,
      );
      const repairSpan = Math.max(1, target.maxHp - startHp);
      target.repairProgress = Math.max(0, Math.min(1, (target.hp - startHp) / repairSpan));
      if (target.repairProgress >= 0.72) {
        target.ignited = false;
        target.fireImpactCount = 0;
        target.fireEmitT = 0;
      }
      if (target.hp >= target.maxHp - 0.01) {
        target.hp = target.maxHp;
        target.repairProgress = 1;
        target.repairing = false;
        target.ignited = false;
        target.fireImpactCount = 0;
        target.fireEmitT = 0;
        for (const repairer of world.units) {
          if (repairer.job?.kind !== 'repair' || repairer.job.targetId !== target.id) continue;
          repairer.job = null;
          repairer.workAction = null;
          if (repairer.state === 'work') repairer.state = 'idle';
        }
        const label = BUILDING_TYPES[target.type]?.label || 'Building';
        sfx.buildingComplete(target.type, target.x);
        world.events.push({ side: target.side, text: `${label} repaired.`, tone: 'good' });
      }
      continue;
    }

    if (worker.job.kind === 'gather') {
      const resourceType = target.resourceType;
      if (!resourceType || target.amount <= 0 || (target.entityKind === 'building' && !target.complete)
        || (target.type === 'farm' && !isOperationalField(world, target))) {
        worker.job = null;
        worker.workAction = null;
        worker.state = 'idle';
        continue;
      }
      const profile = gatherProfileAt(world, worker, target, worker.x, worker.y);
      const gathered = Math.min(target.amount, GATHER_RATES[resourceType] * (profile?.multiplier || 1) * dt);
      target.amount -= gathered;
      const side = world.sides[worker.side];
      side.resources[resourceType] += gathered;
      side.incomeSample[resourceType] += gathered;
      if (target.amount <= 0) {
        target.amount = 0;
        if (target.entityKind === 'resource') target.alive = false;
        worker.job = null;
        worker.workAction = null;
        worker.state = 'idle';
      }
      continue;
    }

    if (worker.job.kind === 'workplace') {
      const workResources = BUILDING_TYPES[target.type]?.workResources || [];
      const resourceType = worker.job.resourceType;
      if (target.entityKind !== 'building' || !target.complete || target.side !== worker.side
        || !workResources.includes(resourceType)) {
        worker.job = null;
        worker.workAction = null;
        worker.state = 'idle';
        continue;
      }
      const profile = gatherProfileAt(
        world, worker, target, worker.x, worker.y, resourceType,
      );
      const produced = GATHER_RATES[resourceType] * (profile?.multiplier || 1) * dt;
      const side = world.sides[worker.side];
      side.resources[resourceType] += produced;
      side.incomeSample[resourceType] += produced;
    }
  }
}

function updateIncomeTelemetry(world, dt) {
  for (const side of world.sides) {
    side.incomeSampleTime += dt;
    if (side.incomeSampleTime < 0.75) continue;
    for (const resourceType of RESOURCE_KEYS) {
      side.incomePerHour[resourceType] = side.incomeSample[resourceType]
        / side.incomeSampleTime * 3600;
      side.incomeSample[resourceType] = 0;
    }
    side.incomeSampleTime = 0;
  }
}

function spawnFromQueue(world, building, unitType) {
  const side = world.sides[building.side];
  side.queuedPopulation = Math.max(0, side.queuedPopulation - (UNIT_TYPES[unitType].pop || 1));
  const dir = building.side === 0 ? 1 : -1;
  const angle = Math.random() * Math.PI - Math.PI / 2;
  // Production exits must clear the painted architecture, not only its compact
  // simulation radius. Enlarging the civic hall otherwise caused its first
  // villager to emerge underneath the right-hand façade.
  const visualScale = BUILDING_TYPES[building.type]?.visualScale || 1;
  const visualExit = Math.max(building.radius, building.w * visualScale * 0.62) + 24;
  const x = building.x + dir * visualExit + Math.cos(angle) * 18;
  const y = building.y + Math.sin(angle) * (building.radius + 14);
  const unit = world.spawnUnit(building.side, unitType, x, y);
  sfx.unitReady(building.x);
  applyRallyOrder(world, building, unit);
  if (unitType === 'villager') {
    world.events.push({ side: building.side, text: 'A villager is ready.', tone: 'good' });
  }
}

function updateQueues(world, dt) {
  for (const building of world.buildings) {
    if (!building.alive || !building.complete || building.queue.length === 0) continue;
    const item = building.queue[0];
    item.remaining -= dt;
    if (item.remaining <= 0) {
      building.queue.shift();
      spawnFromQueue(world, building, item.type);
    }
  }
}

function updateTowers(world, dt) {
  for (const tower of world.buildings) {
    if (!tower.alive || !tower.complete || tower.type !== 'tower') continue;
    const def = BUILDING_TYPES.tower;
    tower.fireT = Math.max(0, (tower.fireT || 0) - dt);
    tower.reload -= dt;
    if (tower.reload > 0) continue;
    let target = null;
    let best = def.range;
    for (const unit of world.units) {
      if (!unit.alive || unit.side === tower.side) continue;
      const d = Math.hypot(unit.x - tower.x, unit.y - tower.y);
      if (d <= best) { best = d; target = unit; }
    }
    if (!target) continue;

    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / distance;
    const ny = dy / distance;
    const hit = Math.random() < def.accuracy;
    const scatter = hit ? 0 : 18 + distance * 0.035;
    const scatterAngle = Math.random() * Math.PI * 2;
    const muzzleReach = 11 * (def.visualScale || 1);
    const muzzleHeight = tower.h * 1.05 * (def.visualScale || 1);
    const sx = tower.x + nx * muzzleReach;
    const sy = tower.y - muzzleHeight + ny * 5;
    const tx = target.x + Math.cos(scatterAngle) * scatter;
    const ty = target.y + Math.sin(scatterAngle) * scatter;
    const flightDistance = Math.hypot(tx - sx, ty - sy);

    tower.reload = def.reload;
    tower.fireT = 0.28;
    tower.aimAngle = Math.atan2(dy, dx);
    sfx.towerShot(tower.x);
    world.projectiles.push({
      kind: 'tower', sx, sy, x: sx, y: sy, px: sx, py: sy,
      tx, ty, t: 0,
      dur: Math.min(1.05, Math.max(0.45, flightDistance / 390)),
      arc: Math.min(72, Math.max(24, flightDistance * 0.18)),
      dmg: def.attack, splash: 0, hit, target, attackerId: tower.id,
    });
  }
}

function nearestEnemyUnitsInRange(world, building, range, limit) {
  const targets = [];
  for (const unit of world.units) {
    if (!unit.alive || unit.side === building.side) continue;
    const distance = Math.hypot(unit.x - building.x, unit.y - building.y);
    if (distance > range) continue;
    targets.push({ unit, distance });
    targets.sort((a, b) => a.distance - b.distance);
    if (targets.length > limit) targets.pop();
  }
  return targets;
}

function fireCastleVolley(world, castle, def, targets) {
  const ports = [
    { x: -54, y: -70 },
    { x: 0, y: -86 },
    { x: 54, y: -70 },
  ];
  const volley = Math.max(1, def.volley || 1);
  for (let index = 0; index < volley; index++) {
    const target = targets[index % targets.length];
    const port = ports[index % ports.length];
    const sx = castle.x + port.x;
    const sy = castle.y + port.y;
    const scatterRadius = Math.min(def.splash * 0.45, 4 + target.distance * 0.018);
    const scatterDistance = Math.random() * scatterRadius;
    const scatterAngle = Math.random() * Math.PI * 2;
    const tx = target.unit.x + Math.cos(scatterAngle) * scatterDistance;
    const ty = target.unit.y + Math.sin(scatterAngle) * scatterDistance;
    const flightDistance = Math.hypot(tx - sx, ty - sy);
    world.projectiles.push({
      kind: 'castle', sx, sy, x: sx, y: sy, px: sx, py: sy,
      tx, ty, t: 0,
      dur: Math.min(2, Math.max(0.5, flightDistance / 320)),
      arc: Math.min(96, Math.max(24, flightDistance * 0.16)),
      dmg: def.attack, splash: def.splash, target: target.unit,
    });
  }
  sfx.cannonFire(castle.x);
}

function updateCastles(world, dt) {
  const def = BUILDING_TYPES.castle;
  for (const building of world.buildings) {
    if (!building.alive || !building.complete || building.type !== 'castle') continue;
    building.reload -= dt;
    if (building.reload > 0) continue;
    const targets = nearestEnemyUnitsInRange(
      world, building, def.range, Math.max(1, def.volley || 1),
    );
    if (!targets.length) continue;
    building.reload = def.reload;
    fireCastleVolley(world, building, def, targets);
  }
}

export function stepEconomy(world, dt) {
  updateWorkers(world, dt);
  updateIncomeTelemetry(world, dt);
  updateQueues(world, dt);
  updateTowers(world, dt);
  updateCastles(world, dt);
}

export function onUnitKilled(world, unit) {
  const side = world.sides[unit.side];
  side.population = Math.max(0, side.population - (UNIT_TYPES[unit.type].pop || 1));
}

export function onBuildingDestroyed(world, building) {
  world.navigationVersion = (world.navigationVersion || 0) + 1;
  const side = world.sides[building.side];
  side.buildingsLost++;
  const def = BUILDING_TYPES[building.type];
  if (def.popCap && building.complete) side.popCap = Math.max(0, side.popCap - def.popCap);
  for (const item of building.queue) {
    const unit = UNIT_TYPES[item.type];
    side.queuedPopulation = Math.max(0, side.queuedPopulation - (unit.pop || 1));
    refundResources(side, unit.cost, 0.5);
  }
  building.queue.length = 0;
  const removedFieldIds = new Set();
  if (building.type === 'mill') {
    for (const field of world.buildings) {
      if (!field.alive || field.type !== 'farm' || field.millId !== building.id) continue;
      field.alive = false;
      field.selected = false;
      removedFieldIds.add(field.id);
    }
    if (removedFieldIds.size) {
      world.events.push({
        side: building.side,
        text: `${removedFieldIds.size} attached field${removedFieldIds.size === 1 ? '' : 's'} lost with the Mill.`,
        tone: 'danger',
      });
    }
  }
  if (building.type === 'wall') {
    let removed = 0;
    for (const staircase of world.buildings) {
      if (!staircase.alive || staircase.type !== 'wall_stairs' || staircase.wallId !== building.id) continue;
      staircase.alive = false;
      staircase.selected = false;
      removed++;
    }
    if (removed) {
      world.events.push({
        side: building.side,
        text: `${removed} attached Stone Staircase${removed === 1 ? '' : 's'} collapsed with the wall.`,
        tone: 'danger',
      });
    }
  }
  for (const worker of world.units) {
    if (worker.job?.targetId === building.id || removedFieldIds.has(worker.job?.targetId)) {
      worker.job = null;
      worker.workAction = null;
      if (worker.state === 'work') worker.state = 'idle';
    }
  }
}

export function findNearestResource(world, x, y, resourceType, side = null) {
  let best = null;
  let bestDistance = Infinity;
  const candidates = world.resources.concat(world.buildings.filter(b => b.type === 'farm'));
  for (const target of candidates) {
    if (!target.alive || target.amount <= 0 || target.resourceType !== resourceType) continue;
    if (target.type === 'farm' && !isOperationalField(world, target)) continue;
    if (target.entityKind === 'building' && (!target.complete || (side !== null && target.side !== side))) continue;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < bestDistance) { best = target; bestDistance = distance; }
  }
  return best;
}

export function findEntityAt(world, x, y, sideFilter = null) {
  let best = null;
  let bestDistance = Infinity;
  for (const unit of world.units) {
    if (!unit.alive || (sideFilter !== null && unit.side !== sideFilter)) continue;
    const distance = Math.hypot(unit.x - x, unit.y - y);
    if (distance <= unit.radius + 10 && distance < bestDistance) {
      best = unit; bestDistance = distance;
    }
  }
  for (const building of world.buildings) {
    if (!building.alive || (sideFilter !== null && building.side !== sideFilter)) continue;
    const distance = Math.hypot(building.x - x, building.y - y);
    const def = BUILDING_TYPES[building.type];
    const visualScale = def?.visualScale || 1;
    const contains = isFortificationType(building.type) || def?.wallAttachment
      ? pointInsideFortification(building, x, y, 8 + def.w * (visualScale - 1))
      : distance <= Math.max(building.radius * visualScale, def.w * visualScale * 0.75);
    if (contains && distance < bestDistance + 20) {
      best = building; bestDistance = distance;
    }
  }
  return best;
}

export function findResourceAt(world, x, y) {
  let best = null;
  let bestDistance = Infinity;
  const targets = world.resources.concat(world.buildings.filter(building => {
    const def = BUILDING_TYPES[building.type];
    return building.type === 'farm' || def.workResources?.length;
  }));
  for (const target of targets) {
    const isWorkplace = target.entityKind === 'building'
      && BUILDING_TYPES[target.type]?.workResources?.length;
    if (!target.alive || (target.entityKind === 'building' && !target.complete)
      || (!isWorkplace && target.amount <= 0)) continue;
    if (target.type === 'farm' && !isOperationalField(world, target)) continue;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= target.radius + 16 && distance < bestDistance) {
      best = target; bestDistance = distance;
    }
  }
  return best;
}
