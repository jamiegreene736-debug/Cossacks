// Formation slot generation and order assignment.
// The battlefield runs west (player) to east (enemy), so formations face
// along an arbitrary vector: "across" spans the front, "depth" goes to the rear.

import { WORLD } from './config.js';
import { MILITARY_WALK_FRAME_COUNT } from './military-animation.js';

const UNIT_FORMATION_FOOTPRINT = Object.freeze({
  villager: Object.freeze({ across: 16, depth: 15 }),
  musk: Object.freeze({ across: 22, depth: 18 }),
  pike: Object.freeze({ across: 22, depth: 18 }),
  cav: Object.freeze({ across: 34, depth: 24 }),
  gun: Object.freeze({ across: 42, depth: 28 }),
});
const ANIMATED_MILITARY_TYPES = new Set(['musk', 'pike', 'cav']);
const HOME_GUARD_TYPE_ORDER = Object.freeze([
  'musk', 'pike', 'cav', 'gun',
  'wizard_duelist', 'witch_duelist', 'moaning_myrtle',
  'starwars_sentinel', 'starwars_blade_guard', 'starwars_skiff_rider',
  'starwars_pulse_cannon',
  'pennywise', 'art_clown', 'twisty_clown', 'captain_spaulding', 'killer_klown',
]);
const HOME_GUARD_TYPE_RANK = new Map(HOME_GUARD_TYPE_ORDER.map((type, index) => [type, index]));
const HOME_GUARD_DISTANCE = 340;
const HOME_GUARD_GROUP_GAP = 34;
const HOME_GUARD_MAP_MARGIN = 72;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unitTypeKey(unit) {
  return unit?.unitType || unit?.type || '';
}

function formationSpacing(units) {
  let across = 13;
  let depth = 15;
  for (const unit of units) {
    const footprint = UNIT_FORMATION_FOOTPRINT[unit.type];
    const radius = Number(unit.radius) || 5;
    across = Math.max(across, footprint?.across || radius * 3.2 + 6);
    depth = Math.max(depth, footprint?.depth || radius * 2.8 + 6);
  }
  return { across, depth };
}

export function getFormationSlots(units, formation) {
  const n = units.length;
  if (n === 0) return [];
  const slots = [];
  const spacing = formationSpacing(units);
  let perRow;
  if (formation === 'square') {
    perRow = Math.max(2, Math.ceil(Math.sqrt(n)));
  } else if (formation === 'column') {
    perRow = Math.max(3, Math.min(8, Math.round(Math.sqrt(n / 2.5))));
  } else { // line
    const ranks = n > 120 ? 4 : n > 40 ? 3 : 2;
    // Preserve a readable battlefield width for Cossacks-scale selections.
    // Wider unit art naturally creates more ranks instead of overflowing the map.
    const maxPerRow = Math.max(6, Math.floor(900 / spacing.across) + 1);
    perRow = Math.min(Math.ceil(n / ranks), maxPerRow);
  }
  const rows = Math.ceil(n / perRow);
  for (let i = 0; i < n; i++) {
    const row = (i / perRow) | 0;
    const col = i % perRow;
    const inRow = row === rows - 1 ? n - row * perRow : perRow;
    slots.push({
      a: (col - (inRow - 1) / 2) * spacing.across, // across the front
      b: row * spacing.depth,                       // depth behind the front rank
      row,
      col,
    });
  }
  return slots;
}

function centroidOf(units) {
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  return { x: cx / units.length, y: cy / units.length };
}

// Order `units` to a destination in `formation`, facing from their current
// centroid toward the destination (or keeping current heading for short moves).
export function applyMoveOrder(units, dx, dy, formation, options = {}) {
  if (units.length === 0) return;
  const c = centroidOf(units);
  let fx = dx - c.x, fy = dy - c.y;
  const len = Math.hypot(fx, fy);
  if (len < 30) {
    const requestedFacing = Math.hypot(options.facingX || 0, options.facingY || 0);
    if (requestedFacing > 0) {
      fx = (options.facingX || 0) / requestedFacing;
      fy = (options.facingY || 0) / requestedFacing;
    } else {
      // Reforming in place: face the enemy side (east for player, west for enemy).
      fx = units[0].side === 0 ? 1 : -1; fy = 0;
    }
  } else {
    fx /= len; fy /= len;
  }
  const rx = -fy, ry = fx; // "across" axis, perpendicular to facing

  const slots = getFormationSlots(units, formation);
  // Pair units to slots without crossing paths: sort both by (across, depth).
  const sortedSlots = slots.slice().sort((p, q) => (p.a - q.a) || (p.b - q.b));
  const sortedUnits = units.slice().sort((p, q) => {
    const pa = (p.x - c.x) * rx + (p.y - c.y) * ry;
    const qa = (q.x - c.x) * rx + (q.y - c.y) * ry;
    if (Math.abs(pa - qa) > 6) return pa - qa;
    const pb = -((p.x - c.x) * fx + (p.y - c.y) * fy);
    const qb = -((q.x - c.x) * fx + (q.y - c.y) * fy);
    return pb - qb;
  });
  const sharedAnimT = sortedUnits.find(unit => ANIMATED_MILITARY_TYPES.has(unit.type))
    ?.animT || 0;
  const sharedGaitDistance = sortedUnits.find(unit => ANIMATED_MILITARY_TYPES.has(unit.type))
    ?.gaitDistance || 0;

  for (let i = 0; i < sortedUnits.length; i++) {
    const u = sortedUnits[i];
    const s = sortedSlots[i];
    u.orderX = dx + rx * s.a - fx * s.b;
    u.orderY = dy + ry * s.a - fy * s.b;
    u.orderTarget = null;
    u.formation = formation;
    if (ANIMATED_MILITARY_TYPES.has(u.type) && !u.moving) {
      u.animT = sharedAnimT;
      u.gaitDistance = sharedGaitDistance;
      // Three coordinated cohorts keep a regiment from changing every large
      // silhouette on the same render frame without returning to random noise.
      u.walkPhaseOffset = ((s.row + s.col * 2) % 3)
        * (MILITARY_WALK_FRAME_COUNT / 3);
    }
    if (u.state === 'flee') continue;
    u.state = 'move';
  }
}

export function homeGuardRallyPoint(townCenter, frontDirection = 1, options = {}) {
  const dir = frontDirection < 0 ? -1 : 1;
  const distance = Number.isFinite(options.distance) ? options.distance : HOME_GUARD_DISTANCE;
  return {
    x: clamp(townCenter.x + dir * distance, HOME_GUARD_MAP_MARGIN, WORLD.w - HOME_GUARD_MAP_MARGIN),
    y: clamp(townCenter.y, HOME_GUARD_MAP_MARGIN, WORLD.h - HOME_GUARD_MAP_MARGIN),
  };
}

function formationAcrossSpan(units, formation) {
  const slots = getFormationSlots(units, formation);
  if (slots.length === 0) return 0;
  const spacing = formationSpacing(units);
  let min = Infinity;
  let max = -Infinity;
  for (const slot of slots) {
    min = Math.min(min, slot.a);
    max = Math.max(max, slot.a);
  }
  return Math.max(spacing.across, max - min + spacing.across);
}

export function applyHomeGuardFormation(units, townCenter, frontDirection = 1, options = {}) {
  if (!townCenter) return [];
  const liveUnits = units.filter(unit => unit?.alive);
  if (liveUnits.length === 0) return [];

  const formation = options.formation || 'line';
  const groupsByType = new Map();
  for (const unit of liveUnits) {
    const key = unitTypeKey(unit);
    if (!groupsByType.has(key)) groupsByType.set(key, []);
    groupsByType.get(key).push(unit);
  }

  const plans = [...groupsByType.entries()]
    .sort(([a], [b]) => {
      const rankA = HOME_GUARD_TYPE_RANK.get(a) ?? 999;
      const rankB = HOME_GUARD_TYPE_RANK.get(b) ?? 999;
      return rankA - rankB || a.localeCompare(b);
    })
    .map(([type, groupUnits]) => ({
      type,
      units: groupUnits.slice().sort((a, b) => a.id - b.id),
      acrossSpan: formationAcrossSpan(groupUnits, formation),
    }));

  const gap = Number.isFinite(options.groupGap) ? options.groupGap : HOME_GUARD_GROUP_GAP;
  const totalAcross = plans.reduce((sum, plan) => sum + plan.acrossSpan, 0)
    + Math.max(0, plans.length - 1) * gap;
  const rally = homeGuardRallyPoint(townCenter, frontDirection, options);
  const dir = frontDirection < 0 ? -1 : 1;
  let cursor = -totalAcross / 2;
  const assignments = [];

  for (const plan of plans) {
    const y = clamp(
      rally.y + cursor + plan.acrossSpan / 2,
      HOME_GUARD_MAP_MARGIN,
      WORLD.h - HOME_GUARD_MAP_MARGIN,
    );
    applyMoveOrder(plan.units, rally.x, y, formation, { facingX: dir, facingY: 0 });
    assignments.push({
      type: plan.type,
      count: plan.units.length,
      x: rally.x,
      y,
      acrossSpan: plan.acrossSpan,
    });
    cursor += plan.acrossSpan + gap;
  }

  return assignments;
}

// Order units to attack one specific enemy unit.
export function applyAttackOrder(units, target) {
  const orderedUnits = units.slice().sort((a, b) => a.id - b.id);
  const sharedAnimT = orderedUnits.find(unit => ANIMATED_MILITARY_TYPES.has(unit.type))
    ?.animT || 0;
  const sharedGaitDistance = orderedUnits.find(unit => ANIMATED_MILITARY_TYPES.has(unit.type))
    ?.gaitDistance || 0;
  for (let index = 0; index < orderedUnits.length; index++) {
    const u = orderedUnits[index];
    if (u.state === 'flee') continue;
    if (ANIMATED_MILITARY_TYPES.has(u.type) && !u.moving) {
      u.animT = sharedAnimT;
      u.gaitDistance = sharedGaitDistance;
      u.walkPhaseOffset = (index % 3) * (MILITARY_WALK_FRAME_COUNT / 3);
    }
    u.orderTarget = target;
    u.orderX = NaN;
    u.target = target;
    u.state = 'move';
  }
}

export function haltOrder(units) {
  for (const u of units) {
    u.orderX = NaN;
    u.orderTarget = null;
    if (u.state === 'move') u.state = 'idle';
  }
}
