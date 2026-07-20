// Battle simulation: unit behavior, combat, morale, projectiles, particles.
// Runs at a fixed 30hz step; rendering interpolates between steps.
//
// Performance notes for big armies (3,000+ units):
//  - Flat uniform grids rebuilt each tick with counting sort (no GC churn)
//  - Target acquisition is staggered (each unit re-scans every ~0.5s)
//  - Collision separation only runs for units that moved this tick

import { WORLD, NATIONS, UNIT_TYPES,
         PIKE_VS_CAV, CAV_CHARGE_BONUS, SQUARE_VS_CAV } from './config.js';
import { sfx } from './audio.js';
import { initializeEconomy, stepEconomy, onUnitKilled, onBuildingDestroyed } from './economy.js';
import {
  dismountWallUnit, lineIntersectsFortification, resolveUnitFortificationCollision,
  updateWallAssignment,
} from './fortifications.js';
import {
  assignVillagerPath, clearVillagerPath, segmentBlocksVillager,
} from './navigation.js';

const PARTICLE_CAP = 900;
const blockingFortifications = [];

class FlatGrid {
  constructor(cell, w, h) {
    this.cell = cell;
    this.gw = Math.ceil(w / cell);
    this.gh = Math.ceil(h / cell);
    this.starts = new Int32Array(this.gw * this.gh + 1);
    this.cursor = new Int32Array(this.gw * this.gh + 1);
    this.items = new Int32Array(4096);
    this.cellOf = new Int32Array(4096);
  }

  build(units) {
    const n = units.length;
    if (this.items.length < n) {
      this.items = new Int32Array(n * 2);
      this.cellOf = new Int32Array(n * 2);
    }
    const { starts, cursor, cell, gw, gh, cellOf, items } = this;
    starts.fill(0);
    for (let i = 0; i < n; i++) {
      const u = units[i];
      let cx = (u.x / cell) | 0; if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
      let cy = (u.y / cell) | 0; if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
      const ci = cy * gw + cx;
      cellOf[i] = ci;
      starts[ci + 1]++;
    }
    const cells = gw * gh;
    for (let i = 0; i < cells; i++) starts[i + 1] += starts[i];
    cursor.set(starts);
    for (let i = 0; i < n; i++) items[cursor[cellOf[i]]++] = i;
  }

  forEach(x, y, r, cb) {
    const { cell, gw, gh, starts, items } = this;
    let x0 = ((x - r) / cell) | 0, x1 = ((x + r) / cell) | 0;
    let y0 = ((y - r) / cell) | 0, y1 = ((y + r) / cell) | 0;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= gw) x1 = gw - 1; if (y1 >= gh) y1 = gh - 1;
    for (let cy = y0; cy <= y1; cy++) {
      const rowBase = cy * gw;
      for (let cx = x0; cx <= x1; cx++) {
        const ci = rowBase + cx;
        const end = starts[ci + 1];
        for (let k = starts[ci]; k < end; k++) cb(items[k]);
      }
    }
  }
}

let nextId = 1;

// Save-game restoration replaces the freshly-created entities with their
// persisted counterparts. Keep future spawns above every restored id so a
// resumed long campaign cannot create duplicate unit identities.
export function reserveUnitIds(maxId) {
  if (Number.isFinite(maxId)) nextId = Math.max(nextId, Math.floor(maxId) + 1);
}

function makeUnit(side, nationKey, type, x, y) {
  const base = UNIT_TYPES[type];
  const m = NATIONS[nationKey].mults;
  let hp = base.hp, speed = base.speed, meleeDmg = base.meleeDmg, reload = base.reload;
  if (type === 'musk') {
    if (m.muskHp) hp *= m.muskHp;
    if (m.reload) reload *= m.reload;
  } else if (type === 'pike') {
    if (m.pikeHp) hp *= m.pikeHp;
  } else if (type === 'cav') {
    if (m.cavHp) hp *= m.cavHp;
    if (m.cavSpeed) speed *= m.cavSpeed;
    if (m.cavDmg) meleeDmg *= m.cavDmg;
  } else if (type === 'gun') {
    if (m.gunReload) reload *= m.gunReload;
  }
  return {
    id: nextId++, side, type, nation: nationKey,
    x, y, px: x, py: y,
    hp, maxHp: hp, speed,
    range: base.range, minRange: base.minRange || 0, acquire: base.acquire,
    reloadTime: reload, reload: Math.random() * reload,
    dmg: base.dmg, acc: base.acc, splash: base.splash || 0,
    meleeDmg, meleeRate: base.meleeRate,
    meleeCd: Math.random() * base.meleeRate,
    chase: base.chase, radius: base.radius,
    morale: 100, charge: 0,
    state: 'idle', alive: true, selected: false,
    orderX: NaN, orderY: NaN, orderTarget: null,
    navigationPath: null, navigationIndex: 0,
    navigationGoalX: NaN, navigationGoalY: NaN, navigationVersion: 0,
    target: null, acquireT: Math.random() * 0.5,
    formation: 'line',
    facing: side === 0 ? 1 : -1,
    moving: false, animT: Math.random() * 10, fireT: 0,
    fleeYDrift: 0,
    job: null,
    workAction: null,
  };
}

function clampPos(u) {
  if (u.x < 30) u.x = 30; else if (u.x > WORLD.w - 30) u.x = WORLD.w - 30;
  if (u.y < 30) u.y = 30; else if (u.y > WORLD.h - 30) u.y = WORLD.h - 30;
}

export function createWorld(opts) {
  const world = {
    units: [], active: [],
    projectiles: [], particles: [], flags: [],
    pendingDecals: [], decals: [],
    time: 0, state: 'running', winner: -1, checkT: 1,
    speed: 1, killLog: {},
    navigationVersion: 0,
    sepGrid: new FlatGrid(20, WORLD.w, WORLD.h),
    tgtGrid: new FlatGrid(64, WORLD.w, WORLD.h),
    sides: [
      { nation: opts.playerNation || 'england', start: 0, alive: 0, kills: 0, losses: 0 },
      { nation: opts.enemyNation || 'ottoman', start: 0, alive: 0, kills: 0, losses: 0 },
    ],
  };
  world.spawnUnit = (side, type, x, y) => spawnUnit(world, side, type, x, y);
  world.damage = (victim, amount, attacker) => damage(world, victim, amount, attacker);
  initializeEconomy(world);
  return world;
}

export function spawnUnit(world, sideIndex, type, x, y) {
  const side = world.sides[sideIndex];
  const unit = makeUnit(sideIndex, side.nation, type, x, y);
  world.units.push(unit);
  side.alive++;
  side.start++;
  side.unitsCreated++;
  side.population += UNIT_TYPES[type].pop || 1;
  return unit;
}

// ---------- Particles ----------

function spawnParticle(world, p) {
  if (world.particles.length < PARTICLE_CAP) world.particles.push(p);
}

function smokePuff(world, x, y, big) {
  spawnParticle(world, {
    kind: 'smoke', x, y,
    vx: (Math.random() - 0.5) * 6, vy: -6 - Math.random() * 8,
    life: 0, max: big ? 1.6 : 0.9,
    size: big ? 7 : 3.5, grow: big ? 14 : 6,
  });
}

function flash(world, x, y, big) {
  spawnParticle(world, {
    kind: 'flash', x, y, vx: 0, vy: 0,
    life: 0, max: 0.1, size: big ? 9 : 4, grow: 0,
  });
}

// ---------- Damage, morale, death ----------

function flee(world, u) {
  if (u.type === 'gun') return; // crews stand by their guns
  dismountWallUnit(world, u);
  u.state = 'flee';
  u.orderX = NaN;
  u.orderTarget = null;
  u.target = null;
  u.charge = 0;
  u.fleeYDrift = (Math.random() - 0.5) * 0.9;
  clearVillagerPath(u);
}

function maybeBreak(world, u) {
  if (u.state === 'flee' || !u.alive || u.type === 'gun') return;
  if (u.morale < 25) {
    // Armies close to collapse break far more easily.
    const s = world.sides[u.side];
    const desperation = s.alive < s.start * 0.4 ? 0.55 : 0.3;
    if (Math.random() < desperation) flee(world, u);
  }
}

export function damage(world, victim, amount, attacker) {
  if (!victim.alive) return;
  victim.hp -= amount;
  if (victim.entityKind !== 'building') {
    victim.morale -= amount * 0.25;
    if (victim.morale < 0) victim.morale = 0;
  }
  if (victim.hp <= 0) {
    const cause = attacker ? attacker.type : 'shell';
    world.killLog[cause] = (world.killLog[cause] || 0) + 1;
    kill(world, victim, attacker);
  } else if (victim.entityKind !== 'building') {
    maybeBreak(world, victim);
  }
}

function kill(world, entity) {
  entity.alive = false;
  entity.hp = 0;
  entity.state = 'dead';
  entity.selected = false;
  const s = world.sides[entity.side];
  if (entity.entityKind === 'building') {
    sfx.buildingDestroyed(entity.type, entity.x);
    onBuildingDestroyed(world, entity);
    world.pendingDecals.push({ kind: 'ruin', x: entity.x, y: entity.y, type: entity.type });
    world.events.push({
      side: entity.side,
      text: `${entity.side === 0 ? 'Your' : 'Enemy'} ${entity.type.replaceAll('_', ' ')} was destroyed.`,
      tone: 'danger',
    });
    return;
  }
  const u = entity;
  sfx.unitDeath(u.type, u.x);
  s.alive--; s.losses++;
  onUnitKilled(world, u);
  world.sides[1 - u.side].kills++;
  world.pendingDecals.push({
    kind: u.type === 'gun' ? 'wreck' : 'corpse',
    x: u.x, y: u.y, type: u.type,
    coat: NATIONS[u.nation].coat,
    ang: (Math.random() - 0.5) * 1.4,
  });
  // Watching a comrade fall is bad for everyone nearby.
  const active = world.active;
  world.sepGrid.forEach(u.x, u.y, 40, (i) => {
    const v = active[i];
    if (v !== u && v.alive && v.side === u.side) {
      v.morale -= 4;
      if (v.morale < 0) v.morale = 0;
      if (v.morale < 25 && Math.random() < 0.12) flee(world, v);
    }
  });
}

// ---------- Firing ----------

// A friendly soldier standing directly in front makes a musketeer hold his
// fire (mostly): only the leading ranks of a deep formation shoot freely.
// This is what makes wide Lines beat deep blobs, as it did historically.
function fireBlocked(world, u, t, d) {
  for (const wall of blockingFortifications) {
    if (wall !== t && wall.id !== u.wallMount?.wallId
      && lineIntersectsFortification(u.x, u.y, t.x, t.y, wall, 1)) return true;
  }
  const nx = (t.x - u.x) / d, ny = (t.y - u.y) / d;
  const active = world.active;
  let blocked = false;
  world.sepGrid.forEach(u.x + nx * 9, u.y + ny * 9, 11, (i) => {
    if (blocked) return;
    const v = active[i];
    if (v === u || !v.alive || v.side !== u.side) return;
    const px = v.x - u.x, py = v.y - u.y;
    const along = px * nx + py * ny;
    if (along < 2 || along > 18) return;
    const perp = px * ny - py * nx;
    if (perp > -4 && perp < 4) blocked = true;
  });
  return blocked;
}

function fireMusket(world, u, t, d, accMul = 1) {
  u.reload = u.reloadTime * (0.85 + Math.random() * 0.3);
  u.fireT = 0.13;
  const nx = (t.x - u.x) / d, ny = (t.y - u.y) / d;
  const visualY = u.y - (u.wallElevation || 0);
  smokePuff(world, u.x + nx * 9, visualY + ny * 9 - 4, false);
  if (Math.random() < 0.5) flash(world, u.x + nx * 8, visualY + ny * 8 - 4, false);
  sfx.musket(u.x);
  const hitChance = Math.min(0.95, Math.max(0.08, accMul * u.acc * (1.05 - 0.6 * d / u.range)));
  if (Math.random() < hitChance) {
    damage(world, t, u.dmg * (0.85 + Math.random() * 0.3), u);
  }
}

function fireCannon(world, u, t, d) {
  u.reload = u.reloadTime * (0.85 + Math.random() * 0.3);
  u.fireT = 0.25;
  const nx = (t.x - u.x) / d, ny = (t.y - u.y) / d;
  const scatterR = Math.random() * (10 + d * 0.075);
  const scatterA = Math.random() * Math.PI * 2;
  const tx = t.x + Math.cos(scatterA) * scatterR;
  const ty = t.y + Math.sin(scatterA) * scatterR;
  const flightD = Math.hypot(tx - u.x, ty - u.y);
  world.projectiles.push({
    sx: u.x + nx * 16, sy: u.y + ny * 16 - 4,
    x: u.x + nx * 16, y: u.y + ny * 16 - 4, px: u.x, py: u.y,
    tx, ty, t: 0,
    dur: Math.min(2.0, Math.max(0.5, flightD / 320)),
    arc: Math.min(90, Math.max(18, flightD * 0.16)),
    dmg: u.dmg, splash: u.splash, target: t,
  });
  smokePuff(world, u.x + nx * 18, u.y + ny * 18 - 5, true);
  flash(world, u.x + nx * 14, u.y + ny * 14 - 4, true);
  sfx.cannonFire(u.x);
}

function explodeShell(world, p) {
  world.pendingDecals.push({ kind: 'crater', x: p.tx, y: p.ty });
  smokePuff(world, p.tx, p.ty - 3, true);
  smokePuff(world, p.tx + 5, p.ty - 6, false);
  flash(world, p.tx, p.ty - 2, true);
  sfx.cannonImpact(p.tx);
  if (p.target?.alive && p.target.entityKind === 'building') {
    const d = Math.hypot(p.target.x - p.tx, p.target.y - p.ty);
    if (d <= p.target.radius + p.splash) damage(world, p.target, p.dmg, null);
  }
  const active = world.active;
  world.tgtGrid.forEach(p.tx, p.ty, p.splash, (i) => {
    const v = active[i];
    if (!v.alive) return;
    const d = Math.hypot(v.x - p.tx, v.y - p.ty);
    if (d <= p.splash) {
      // Roundshot doesn't check uniforms — friendly fire is real.
      damage(world, v, p.dmg * (1 - 0.75 * d / p.splash), null);
    }
  });
}

// ---------- Per-unit behavior ----------

function updateUnit(world, u, dt) {
  u.reload -= dt;
  u.meleeCd -= dt;
  u.fireT -= dt;
  u.moving = false;

  if (u.state === 'flee') {
    const dirX = u.side === 0 ? -1 : 1;
    u.x += dirX * u.speed * 1.2 * dt;
    u.y += u.fleeYDrift * u.speed * 0.5 * dt;
    clampPos(u);
    u.moving = true;
    u.animT += dt * 1.4;
    u.facing = dirX > 0 ? 1 : -1;
    u.morale += 8 * dt;
    if (u.morale > 60) { u.state = 'idle'; u.morale = 60; }
    return;
  }

  if (u.morale < 100) u.morale = Math.min(100, u.morale + 1.5 * dt);

  const wallState = updateWallAssignment(world, u);
  if (wallState === 'mounted') u.state = 'wall';

  // -- Target upkeep / acquisition (staggered) --
  if (u.target && !u.target.alive) u.target = null;
  if (u.orderTarget && !u.orderTarget.alive) u.orderTarget = null;
  u.acquireT -= dt;
  if (u.acquire > 0 && u.acquireT <= 0) {
    u.acquireT = 0.35 + Math.random() * 0.35;
    if (u.orderTarget) {
      u.target = u.orderTarget;
    } else {
      let best = null, bestD = Infinity;
      if (u.target) {
        const d = Math.hypot(u.target.x - u.x, u.target.y - u.y);
        if (d <= u.acquire) { best = u.target; bestD = d * 0.8; } // sticky
      }
      const active = world.active;
      world.tgtGrid.forEach(u.x, u.y, u.acquire, (i) => {
        const v = active[i];
        if (v.side === u.side || !v.alive) return;
        const dx = v.x - u.x, dy = v.y - u.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD && d <= u.acquire) { bestD = d; best = v; }
      });
      // Buildings are few, so checking them only after the spatial unit scan
      // remains cheap and lets idle soldiers finish an exposed settlement.
      if (!best) {
        for (const building of world.buildings) {
          if (!building.alive || building.side === u.side) continue;
          const d = Math.hypot(building.x - u.x, building.y - u.y) - building.radius;
          if (d < bestD && d <= u.acquire) { bestD = d; best = building; }
        }
      }
      u.target = best;
    }
  }

  const t = u.target;
  let d = Infinity, meleeReach = 0;
  if (t) {
    d = Math.hypot(t.x - u.x, t.y - u.y);
    meleeReach = u.radius + t.radius + 3;
  }

  const isRanged = u.range > 0;
  let destX = NaN, destY = NaN, stopAt = 5;

  if (t && isRanged && d <= u.range && d >= u.minRange) {
    // Stand and shoot.
    u.facing = t.x > u.x ? 1 : -1;
    if (u.reload <= 0) {
      let rate = 1;
      if (u.formation === 'square') rate = 0.75;
      if (u.type !== 'gun' && fireBlocked(world, u, t, d)) {
        // rear rank: mostly hold fire, sometimes shoot past shoulders
        if (Math.random() < 0.2) fireMusket(world, u, t, d, 0.7);
        else u.reload = 0.6 + Math.random() * 0.9;
      } else if (rate === 1 || Math.random() < rate) {
        if (u.type === 'gun') fireCannon(world, u, t, d);
        else fireMusket(world, u, t, d);
      } else {
        u.reload = 0.3;
      }
    }
    // Melee defense if enemy is on top of us anyway.
    if (t && d <= meleeReach && u.meleeCd <= 0) meleeStrike(world, u, t);
    return;
  }

  if (t && !isRanged && d <= meleeReach) {
    // In melee contact.
    u.facing = t.x > u.x ? 1 : -1;
    if (u.meleeCd <= 0) meleeStrike(world, u, t);
    u.charge = Math.max(0, u.charge - dt * 2);
    return;
  }

  // Wall defenders hold their authored firing positions. An explicit ground
  // move uses the staircase and clears this state in the input layer.
  if (u.wallMount) return;

  // -- Choose a destination --
  if (t && !isRanged && (u.orderTarget === t || d <= u.chase)) {
    destX = t.x; destY = t.y; stopAt = meleeReach - 1;
  } else if (t && isRanged && u.orderTarget === t) {
    destX = t.x; destY = t.y; stopAt = Math.max(u.range * 0.85, u.minRange + 20);
  } else if (!Number.isNaN(u.orderX)) {
    if (u.type === 'villager' && u.navigationPath?.length) {
      let waypoint = u.navigationPath[u.navigationIndex];
      if (u.navigationVersion !== world.navigationVersion) {
        u.navigationVersion = world.navigationVersion;
        if (segmentBlocksVillager(world, u.x, u.y, waypoint.x, waypoint.y, u.radius + 2)) {
          if (!assignVillagerPath(world, u, u.navigationGoalX, u.navigationGoalY)) {
            u.orderX = NaN;
            u.orderY = NaN;
            clearVillagerPath(u);
            if (u.state === 'move') u.state = 'idle';
            return;
          }
          waypoint = u.navigationPath[0];
        }
      }
      destX = waypoint.x;
      destY = waypoint.y;
    } else {
      destX = u.orderX; destY = u.orderY;
    }
  } else if (t && isRanged && u.type !== 'gun' && d > u.range) {
    // No standing order and a foe just out of range: step up and engage,
    // otherwise lines deadlock staring at each other from 200 paces.
    destX = t.x; destY = t.y; stopAt = u.range * 0.9;
  } else if (t && isRanged && u.minRange > 0 && d < u.minRange) {
    // Cannon too close: crew nudges back.
    destX = u.x + (u.x - t.x) / d * 40;
    destY = u.y + (u.y - t.y) / d * 40;
  }

  if (!Number.isNaN(destX)) {
    const mx = destX - u.x, my = destY - u.y;
    const md = Math.hypot(mx, my);
    if (md > stopAt) {
      let sp = u.speed;
      if (u.formation === 'column') sp *= 1.15;
      else if (u.formation === 'square') sp *= 0.8;
      const nx = mx / md, ny = my / md;
      u.x += nx * sp * dt;
      u.y += ny * sp * dt;
      clampPos(u);
      u.moving = true;
      u.animT += dt;
      if (Math.abs(nx) > 0.25) u.facing = nx > 0 ? 1 : -1;
      if (u.type === 'cav') u.charge = Math.min(1, u.charge + dt / 1.4);
    } else if (!Number.isNaN(u.orderX)) {
      const hasNextWaypoint = u.type === 'villager' && u.navigationPath?.length
        && u.navigationIndex < u.navigationPath.length - 1;
      if (hasNextWaypoint) {
        u.navigationIndex++;
      } else {
        u.orderX = NaN; u.orderY = NaN;
        clearVillagerPath(u);
        if (u.state === 'move') u.state = 'idle';
      }
    }
  } else if (u.type === 'cav') {
    u.charge = Math.max(0, u.charge - dt * 2);
  }
}

function meleeStrike(world, u, t) {
  u.meleeCd = u.meleeRate * (0.85 + Math.random() * 0.3);
  u.fireT = 0.12;
  let dmg = u.meleeDmg * (0.8 + Math.random() * 0.4);
  if (u.type === 'pike' && t.type === 'cav') dmg *= PIKE_VS_CAV;
  if (u.type === 'cav') {
    dmg *= 1 + CAV_CHARGE_BONUS * u.charge;
    if (t.formation === 'square' && t.type !== 'cav') dmg *= SQUARE_VS_CAV;
    u.charge = Math.max(0, u.charge - 0.5);
  }
  sfx.melee(u.x, u.type === 'cav' || t.type === 'cav');
  damage(world, t, dmg, u);
}

// ---------- Main step ----------

export function step(world, dt) {
  if (world.state !== 'running') return;
  world.time += dt;

  const active = world.active;
  active.length = 0;
  for (const u of world.units) {
    if (u.alive) {
      u.px = u.x; u.py = u.y;
      active.push(u);
    }
  }

  world.sepGrid.build(active);
  world.tgtGrid.build(active);

  stepEconomy(world, dt);

  blockingFortifications.length = 0;
  for (const building of world.buildings) {
    const blockingWall = building.type === 'wall'
      && (building.complete || building.progress >= 0.24);
    const blockingGate = building.type === 'gate' && building.complete
      && building.gateOpen === false;
    if (building.alive && (blockingWall || blockingGate)) {
      blockingFortifications.push(building);
    }
  }

  for (let i = 0; i < active.length; i++) {
    const u = active[i];
    if (u.alive) {
      updateUnit(world, u, dt);
      if (u.moving) resolveUnitFortificationCollision(u, blockingFortifications);
    }
  }

  // Separation: only movers get pushed, so standing lines stay crisp.
  for (let i = 0; i < active.length; i++) {
    const u = active[i];
    if (!u.alive || !u.moving) continue;
    world.sepGrid.forEach(u.x, u.y, 20, (j) => {
      const v = active[j];
      if (v === u || !v.alive) return;
      const dx = u.x - v.x, dy = u.y - v.y;
      const minD = u.radius + v.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD * minD) {
        if (d2 > 0.0001) {
          const dd = Math.sqrt(d2);
          const push = (minD - dd) * 0.5;
          u.x += dx / dd * push;
          u.y += dy / dd * push;
        } else {
          u.x += Math.random() - 0.5;
          u.y += Math.random() - 0.5;
        }
      }
    });
    resolveUnitFortificationCollision(u, blockingFortifications);
    clampPos(u);
  }

  // Projectiles
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    p.px = p.x; p.py = p.y;
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * k;
    p.y = p.sy + (p.ty - p.sy) * k - Math.sin(Math.PI * k) * p.arc;
    if (p.t >= p.dur) {
      if (p.kind === 'tower') flash(world, p.tx, p.ty, false);
      else explodeShell(world, p);
      world.projectiles.splice(i, 1);
    }
  }

  // Particles
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.life += dt;
    if (p.life >= p.max) { world.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === 'smoke') p.size += p.grow * dt;
  }

  // Order flags
  for (let i = world.flags.length - 1; i >= 0; i--) {
    world.flags[i].life -= dt;
    if (world.flags[i].life <= 0) world.flags.splice(i, 1);
  }

  // A settlement survives as long as its Town Center does. This keeps the
  // objective legible even with hundreds of units and many outlying farms.
  world.checkT -= dt;
  if (world.checkT <= 0) {
    world.checkT = 0.5;
    const aDone = !world.buildings.some(b => b.alive && b.id === world.sides[0].townCenterId);
    const bDone = !world.buildings.some(b => b.alive && b.id === world.sides[1].townCenterId);
    if (aDone || bDone) {
      world.state = 'ended';
      world.winner = aDone && bDone ? -2 : aDone ? 1 : 0;
    }
  }
}
