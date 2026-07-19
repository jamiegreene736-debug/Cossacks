// Enemy commander: groups the AI army into brigades and issues orders
// every few seconds — infantry advances in line, artillery unlimbers at
// range, cavalry swings wide and charges the flanks.

import { WORLD } from './config.js';
import { applyMoveOrder, applyAttackOrder, haltOrder } from './formations.js';

function centroid(units) {
  let x = 0, y = 0;
  for (const u of units) { x += u.x; y += u.y; }
  const n = units.length || 1;
  return { x: x / n, y: y / n };
}

function nearestFoe(from, foes) {
  let best = null, bestD = Infinity;
  for (const f of foes) {
    const d = Math.hypot(f.x - from.x, f.y - from.y);
    if (d < bestD) { bestD = d; best = f; }
  }
  return { foe: best, dist: bestD };
}

// Re-slotting a marching block every few seconds strings it out into
// stragglers, so only issue a fresh move order when the destination has
// genuinely changed (or enough time has passed to warrant a re-form).
function orderedMove(world, b, units, x, y, formation) {
  const lo = b.lastOrder;
  if (lo && Math.hypot(lo.x - x, lo.y - y) < 140 && world.time - lo.t < 14) return;
  b.lastOrder = { x, y, t: world.time };
  applyMoveOrder(units, x, y, formation);
}

export class Commander {
  constructor(world, side = 1) {
    this.world = world;
    this.side = side;
    this.t = 1.5;
    this.cavCommitted = false;

    const mine = world.units.filter(u => u.side === side);
    const musks = mine.filter(u => u.type === 'musk').sort((a, b) => a.y - b.y);
    const cavs = mine.filter(u => u.type === 'cav').sort((a, b) => a.y - b.y);
    const mh = Math.ceil(musks.length / 2);
    const ch = Math.ceil(cavs.length / 2);
    this.brigades = [
      { role: 'inf', units: musks.slice(0, mh) },
      { role: 'inf', units: musks.slice(mh) },
      { role: 'pike', units: mine.filter(u => u.type === 'pike') },
      { role: 'cav', wing: 'N', phase: 'hold', units: cavs.slice(0, ch) },
      { role: 'cav', wing: 'S', phase: 'hold', units: cavs.slice(ch) },
      { role: 'guns', units: mine.filter(u => u.type === 'gun') },
    ];
  }

  update(dt) {
    if (this.world.state !== 'running') return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 3;
    this.decide();
  }

  decide() {
    const world = this.world;
    const foes = [];
    for (const u of world.units) if (u.alive && u.side !== this.side) foes.push(u);
    if (foes.length === 0) return;
    const foeC = centroid(foes);

    let infEngaged = false;
    let anyAssault = false;

    for (const b of this.brigades) {
      b.units = b.units.filter(u => u.alive);
      if (b.units.length === 0) continue;
      const bc = centroid(b.units);
      const { foe, dist } = nearestFoe(bc, foes);

      // distance from the brigade's leading unit to that foe — centroid
      // distance overstates the gap for deep formations
      let minD = Infinity;
      for (const u of b.units) {
        const d = Math.hypot(foe.x - u.x, foe.y - u.y);
        if (d < minD) minD = d;
      }

      if (b.role === 'inf') {
        if (minD <= 170) infEngaged = true;
        if (!b.stage) b.stage = 'approach';

        if (b.stage === 'approach') {
          if (b.stageT === undefined && minD < 420) b.stageT = world.time;
          if (minD < 230 || (b.stageT !== undefined && world.time - b.stageT > 30)) {
            b.stage = 'assault'; // enemy closing, or we've dressed ranks long enough
          } else {
            // Stage the brigade ~330 out, beyond musket and auto-engage
            // range, so the whole line steps off together instead of
            // feeding itself into the defender's fire one rank at a time.
            const stageX = foe.x - (foe.x - bc.x) / dist * 330;
            const stageY = foe.y - (foe.y - bc.y) / dist * 330;
            orderedMove(world, b, b.units, stageX, stageY, 'line');
            let arrived = 0;
            for (const u of b.units) if (Number.isNaN(u.orderX)) arrived++;
            if (arrived >= b.units.length * 0.75) b.stage = 'assault';
          }
        }
        if (b.stage === 'assault') {
          anyAssault = true;
          if (minD > 165) {
            const vx = foe.x - bc.x, vy = foe.y - bc.y;
            const k = Math.max(0.05, (dist - 120) / dist);
            orderedMove(world, b, b.units, bc.x + vx * k, bc.y + vy * k, 'line');
          }
        }
      } else if (b.role === 'pike') {
        if (minD < 200) {
          applyAttackOrder(b.units, foe);
        } else {
          // Screen the infantry: hold slightly behind the foot line.
          const infUnits = this.brigades[0].units.concat(this.brigades[1].units);
          if (infUnits.length) {
            const ic = centroid(infUnits);
            const dir = this.side === 1 ? 1 : -1; // rear is east for the AI
            orderedMove(world, b, b.units, ic.x + dir * 120, ic.y, 'line');
          }
        }
      } else if (b.role === 'guns') {
        if (minD > 480) {
          const vx = foe.x - bc.x, vy = foe.y - bc.y;
          const k = (dist - 440) / dist;
          orderedMove(world, b, b.units, bc.x + vx * k, bc.y + vy * k, 'line');
        } else {
          haltOrder(b.units);
        }
      } else if (b.role === 'cav') {
        if (!this.cavCommitted) continue;
        if (b.phase === 'hold') b.phase = 'flank';
        if (b.phase === 'flank') {
          const wpX = foeC.x + (this.side === 1 ? -80 : 80);
          const wpY = b.wing === 'N' ? 260 : WORLD.h - 260;
          if (Math.hypot(bc.x - wpX, bc.y - wpY) < 260 || dist < 120) {
            b.phase = 'charge';
          } else {
            orderedMove(world, b, b.units, wpX, wpY, 'column');
          }
        }
        if (b.phase === 'charge') {
          // Ride down the guns first, then whatever is nearest.
          const gunFoes = foes.filter(f => f.type === 'gun');
          let target = foe;
          if (gunFoes.length) target = nearestFoe(bc, gunFoes).foe;
          applyAttackOrder(b.units, target);
        }
      }
    }

    if (!this.cavCommitted && (infEngaged || anyAssault || world.time > 75)) {
      this.cavCommitted = true;
    }
  }
}
