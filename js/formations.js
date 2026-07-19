// Formation slot generation and order assignment.
// The battlefield runs west (player) to east (enemy), so formations face
// along an arbitrary vector: "across" spans the front, "depth" goes to the rear.

function slotSpec(n, formation) {
  const slots = [];
  let perRow, sx, sy;
  if (formation === 'square') {
    perRow = Math.max(2, Math.ceil(Math.sqrt(n)));
    sx = 12; sy = 12;
  } else if (formation === 'column') {
    perRow = Math.max(3, Math.min(8, Math.round(Math.sqrt(n / 2.5))));
    sx = 13; sy = 14;
  } else { // line
    const ranks = n > 120 ? 4 : n > 40 ? 3 : 2;
    perRow = Math.ceil(n / ranks);
    sx = 13; sy = 15;
  }
  const rows = Math.ceil(n / perRow);
  for (let i = 0; i < n; i++) {
    const row = (i / perRow) | 0;
    const col = i % perRow;
    const inRow = row === rows - 1 ? n - row * perRow : perRow;
    slots.push({
      a: (col - (inRow - 1) / 2) * sx,   // across the front
      b: row * sy,                       // depth behind the front rank
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
export function applyMoveOrder(units, dx, dy, formation) {
  if (units.length === 0) return;
  const c = centroidOf(units);
  let fx = dx - c.x, fy = dy - c.y;
  const len = Math.hypot(fx, fy);
  if (len < 30) {
    // Reforming in place: face the enemy side (east for player, west for enemy).
    fx = units[0].side === 0 ? 1 : -1; fy = 0;
  } else {
    fx /= len; fy /= len;
  }
  const rx = -fy, ry = fx; // "across" axis, perpendicular to facing

  const slots = slotSpec(units.length, formation);
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

  for (let i = 0; i < sortedUnits.length; i++) {
    const u = sortedUnits[i];
    const s = sortedSlots[i];
    u.orderX = dx + rx * s.a - fx * s.b;
    u.orderY = dy + ry * s.a - fy * s.b;
    u.orderTarget = null;
    u.formation = formation;
    if (u.state === 'flee') continue;
    u.state = 'move';
  }
}

// Order units to attack one specific enemy unit.
export function applyAttackOrder(units, target) {
  for (const u of units) {
    if (u.state === 'flee') continue;
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
