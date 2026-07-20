// Command-time villager navigation. A compact world grid keeps route searches
// deterministic and bounded, while exact line-of-sight checks smooth the grid
// result back into natural-looking waypoints around walls and settlement props.

import { BUILDING_TYPES, WORLD } from './config.js';
import {
  isFortificationType, lineIntersectsFortification, pointInsideFortification,
} from './fortifications.js';

export const NAV_CELL = 32;
const COLS = Math.ceil(WORLD.w / NAV_CELL);
const ROWS = Math.ceil(WORLD.h / NAV_CELL);
const NODE_COUNT = COLS * ROWS;
const SQRT2 = Math.SQRT2;
const DIRECTIONS = Object.freeze([
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
]);

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-8) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / length2));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

function blocksNavigation(building) {
  if (!building.alive) return false;
  const def = BUILDING_TYPES[building.type];
  return !def?.gate;
}

export function pointBlocksVillager(world, x, y, clearance = 7) {
  if (x < clearance || y < clearance || x > WORLD.w - clearance || y > WORLD.h - clearance) return true;
  for (const building of world.buildings) {
    if (!blocksNavigation(building)) continue;
    if (isFortificationType(building.type)) {
      if (pointInsideFortification(building, x, y, clearance)) return true;
    } else if (Math.hypot(x - building.x, y - building.y) <= building.radius + clearance) {
      return true;
    }
  }
  for (const resource of world.resources) {
    if (resource.alive && resource.amount > 0
      && Math.hypot(x - resource.x, y - resource.y) <= resource.radius + clearance) return true;
  }
  return false;
}

export function segmentBlocksVillager(world, x0, y0, x1, y1, clearance = 7) {
  for (const building of world.buildings) {
    if (!blocksNavigation(building)) continue;
    if (isFortificationType(building.type)) {
      if (lineIntersectsFortification(x0, y0, x1, y1, building, clearance)) return true;
    } else if (distanceToSegment(building.x, building.y, x0, y0, x1, y1)
      <= building.radius + clearance) return true;
  }
  for (const resource of world.resources) {
    if (resource.alive && resource.amount > 0
      && distanceToSegment(resource.x, resource.y, x0, y0, x1, y1)
        <= resource.radius + clearance) return true;
  }
  return false;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(node, priority) {
    const item = { node, priority };
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].priority <= priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (!this.items.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.items.length) break;
      const right = left + 1;
      const child = right < this.items.length
        && this.items[right].priority < this.items[left].priority ? right : left;
      if (this.items[child].priority >= last.priority) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = last;
    return first;
  }

  get length() { return this.items.length; }
}

function nodeX(index) { return index % COLS; }
function nodeY(index) { return Math.floor(index / COLS); }
function nodeIndex(x, y) { return y * COLS + x; }
function worldPoint(index) {
  return {
    x: Math.min(WORLD.w - 1, nodeX(index) * NAV_CELL + NAV_CELL * 0.5),
    y: Math.min(WORLD.h - 1, nodeY(index) * NAV_CELL + NAV_CELL * 0.5),
  };
}

function containingNode(x, y) {
  const col = Math.max(0, Math.min(COLS - 1, Math.floor(x / NAV_CELL)));
  const row = Math.max(0, Math.min(ROWS - 1, Math.floor(y / NAV_CELL)));
  return nodeIndex(col, row);
}

function nearestNavigableNode(world, x, y, clearance) {
  const origin = containingNode(x, y);
  const ox = nodeX(origin);
  const oy = nodeY(origin);
  let best = -1;
  let bestDistance = Infinity;
  for (let radius = 0; radius <= 6; radius++) {
    for (let row = oy - radius; row <= oy + radius; row++) {
      for (let col = ox - radius; col <= ox + radius; col++) {
        if (col < 0 || row < 0 || col >= COLS || row >= ROWS) continue;
        if (radius > 0 && Math.abs(col - ox) !== radius && Math.abs(row - oy) !== radius) continue;
        const index = nodeIndex(col, row);
        const point = worldPoint(index);
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance >= bestDistance || pointBlocksVillager(world, point.x, point.y, clearance)
          || segmentBlocksVillager(world, x, y, point.x, point.y, clearance)) continue;
        best = index;
        bestDistance = distance;
      }
    }
    if (best >= 0) return best;
  }
  return best;
}

function heuristic(index, goal) {
  const dx = Math.abs(nodeX(index) - nodeX(goal));
  const dy = Math.abs(nodeY(index) - nodeY(goal));
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

function reconstruct(cameFrom, goal) {
  const path = [];
  let current = goal;
  while (current >= 0) {
    path.push(worldPoint(current));
    current = cameFrom[current];
  }
  path.reverse();
  return path;
}

function smoothPath(world, start, gridPath, goal, clearance) {
  const candidates = gridPath.slice();
  candidates.push(goal);
  const result = [];
  let anchor = start;
  let index = 0;
  while (index < candidates.length) {
    if (segmentBlocksVillager(
      world, anchor.x, anchor.y, candidates[index].x, candidates[index].y, clearance,
    )) return [];
    let furthest = index;
    while (furthest + 1 < candidates.length
      && !segmentBlocksVillager(
        world, anchor.x, anchor.y, candidates[furthest + 1].x, candidates[furthest + 1].y, clearance,
      )) furthest++;
    const waypoint = candidates[furthest];
    result.push({ x: waypoint.x, y: waypoint.y });
    anchor = waypoint;
    index = furthest + 1;
  }
  return result;
}

export function findVillagerPath(world, startX, startY, goalX, goalY, clearance = 7) {
  const start = { x: startX, y: startY };
  const goal = { x: goalX, y: goalY };
  if (!segmentBlocksVillager(world, startX, startY, goalX, goalY, clearance)) return [goal];

  const startNode = nearestNavigableNode(world, startX, startY, clearance);
  const goalNode = nearestNavigableNode(world, goalX, goalY, clearance);
  if (startNode < 0 || goalNode < 0) return [];
  const open = new MinHeap();
  const cameFrom = new Int32Array(NODE_COUNT);
  const scores = new Float64Array(NODE_COUNT);
  const closed = new Uint8Array(NODE_COUNT);
  const blocked = new Int8Array(NODE_COUNT);
  cameFrom.fill(-1);
  scores.fill(Infinity);
  blocked.fill(-1);
  scores[startNode] = 0;
  open.push(startNode, heuristic(startNode, goalNode));

  const nodeBlocked = index => {
    if (blocked[index] < 0) {
      const point = worldPoint(index);
      blocked[index] = pointBlocksVillager(world, point.x, point.y, clearance) ? 1 : 0;
    }
    return blocked[index] === 1;
  };

  while (open.length) {
    const entry = open.pop();
    const current = entry.node;
    if (closed[current]) continue;
    if (current === goalNode) {
      return smoothPath(world, start, reconstruct(cameFrom, goalNode), goal, clearance);
    }
    closed[current] = 1;
    const cx = nodeX(current);
    const cy = nodeY(current);
    for (const [dx, dy, cost] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const neighbor = nodeIndex(nx, ny);
      if (closed[neighbor] || nodeBlocked(neighbor)) continue;
      if (dx && dy) {
        if (nodeBlocked(nodeIndex(cx + dx, cy)) || nodeBlocked(nodeIndex(cx, cy + dy))) continue;
      }
      const tentative = scores[current] + cost;
      if (tentative + 1e-8 >= scores[neighbor]) continue;
      cameFrom[neighbor] = current;
      scores[neighbor] = tentative;
      open.push(neighbor, tentative + heuristic(neighbor, goalNode));
    }
  }
  return [];
}

export function assignVillagerPath(world, unit, goalX, goalY) {
  if (!unit?.alive || unit.type !== 'villager') return false;
  const path = findVillagerPath(world, unit.x, unit.y, goalX, goalY, unit.radius + 2);
  unit.navigationPath = path;
  unit.navigationIndex = 0;
  unit.navigationGoalX = goalX;
  unit.navigationGoalY = goalY;
  unit.navigationVersion = world.navigationVersion || 0;
  return path.length > 0;
}

export function clearVillagerPath(unit) {
  unit.navigationPath = null;
  unit.navigationIndex = 0;
  unit.navigationGoalX = NaN;
  unit.navigationGoalY = NaN;
  unit.navigationVersion = 0;
}
