// Battle simulation: unit behavior, combat, morale, projectiles, particles.
// Runs at a fixed 30hz step; rendering interpolates between steps.
//
// Performance notes for big armies (3,000+ units):
//  - Flat uniform grids rebuilt each tick with counting sort (no GC churn)
//  - Target acquisition is staggered (each unit re-scans every ~0.5s)
//  - Collision separation only runs for units that moved this tick

import { WORLD, NATIONS, UNIT_TYPES, ARMY_SIZES,
         PIKE_VS_CAV, CAV_CHARGE_BONUS, SQUARE_VS_CAV } from './config.js';
import { sfx } from './audio.js';

const PARTICLE_CAP = 900;

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
    target: null, acquireT: Math.random() * 0.5,
    formation: 'line',
    facing: side === 0 ? 1 : -1,
    moving: false, animT: Math.random() * 10, fireT: 0,
    fleeYDrift: 0,
  };
}

function clampPos(u) {
  if (u.x < 30) u.x = 30; else if (u.x > WORLD.w - 30) u.x = WORLD.w - 30;
  if (u.y < 30) u.y = 30; else if (u.y > WORLD.h - 30) u.y = WORLD.h - 30;
}

// ---------- Deployment ----------

function deployBlock(units, cx, cy, dir, ranks, sAcross, sDeep) {
  if (units.length === 0) return 0;
  const files = Math.ceil(units.length / ranks);
  for (let i = 0; i < units.length; i++) {
    const rank = (i / files) | 0;
    const file = i % files;
    const u = units[i];
    u.x = cx - dir * rank * sDeep;
    u.y = cy + (file - (files - 1) / 2) * sAcross;
    clampPos(u);
    u.px = u.x; u.py = u.y;
  }
  return files * sAcross; // block height
}

function deploySide(world, side, nationKey, comp) {
  const dir = side === 0 ? 1 : -1;
  const frontX = side === 0 ? 1150 : WORLD.w - 1150;
  const cy = WORLD.h / 2;
  const groups = { musk: [], pike: [], cav: [], gun: [] };

  for (const type of Object.keys(groups)) {
    for (let i = 0; i < comp[type]; i++) {
      const u = makeUnit(side, nationKey, type, 0, 0);
      groups[type].push(u);
      world.units.push(u);
    }
  }

  const mRanks = Math.min(7, Math.max(3, Math.ceil(comp.musk / 140)));
  const muskH = deployBlock(groups.musk, frontX, cy, dir, mRanks, 12, 15);

  const pRanks = Math.min(5, Math.max(2, Math.ceil(comp.pike / 90)));
  deployBlock(groups.pike, frontX - dir * 130, cy, dir, pRanks, 12, 15);

  const half = Math.ceil(groups.cav.length / 2);
  const wingOff = Math.min(muskH / 2 + 200, WORLD.h / 2 - 220);
  deployBlock(groups.cav.slice(0, half), frontX - dir * 50, cy - wingOff, dir, 4, 15, 18);
  deployBlock(groups.cav.slice(half), frontX - dir * 50, cy + wingOff, dir, 4, 15, 18);

  const guns = groups.gun;
  const gSpacing = Math.min(110, Math.max(48, muskH / Math.max(1, guns.length)));
  for (let i = 0; i < guns.length; i++) {
    const u = guns[i];
    u.x = frontX - dir * 190;
    u.y = cy + (i - (guns.length - 1) / 2) * gSpacing;
    clampPos(u);
    u.px = u.x; u.py = u.y;
  }
}

export function createWorld(opts) {
  const size = ARMY_SIZES.find(s => s.id === opts.sizeId) || ARMY_SIZES[0];
  const mult = opts.enemyMult || 1;
  const enemyComp = {};
  for (const [type, n] of Object.entries(size.comp)) {
    enemyComp[type] = Math.round(n * mult);
  }
  const world = {
    units: [], active: [],
    projectiles: [], particles: [], flags: [],
    pendingDecals: [],
    time: 0, state: 'running', winner: -1, checkT: 1,
    speed: 1, killLog: {},
    sizeId: size.id,
    sepGrid: new FlatGrid(20, WORLD.w, WORLD.h),
    tgtGrid: new FlatGrid(64, WORLD.w, WORLD.h),
    sides: [
      { nation: opts.playerNation, start: 0, alive: 0, kills: 0, losses: 0 },
      { nation: opts.enemyNation, start: 0, alive: 0, kills: 0, losses: 0 },
    ],
  };
  deploySide(world, 0, opts.playerNation, size.comp);
  deploySide(world, 1, opts.enemyNation, enemyComp);
  for (const s of world.sides) {
    s.start = world.units.filter(u => u.side === world.sides.indexOf(s)).length;
    s.alive = s.start;
  }
  return world;
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

function flee(u) {
  if (u.type === 'gun') return; // crews stand by their guns
  u.state = 'flee';
  u.orderX = NaN;
  u.orderTarget = null;
  u.target = null;
  u.charge = 0;
  u.fleeYDrift = (Math.random() - 0.5) * 0.9;
}

function maybeBreak(world, u) {
  if (u.state === 'flee' || !u.alive || u.type === 'gun') return;
  if (u.morale < 25) {
    // Armies close to collapse break far more easily.
    const s = world.sides[u.side];
    const desperation = s.alive < s.start * 0.4 ? 0.55 : 0.3;
    if (Math.random() < desperation) flee(u);
  }
}

export function damage(world, victim, amount, attacker) {
  if (!victim.alive) return;
  victim.hp -= amount;
  victim.morale -= amount * 0.25;
  if (victim.morale < 0) victim.morale = 0;
  if (victim.hp <= 0) {
    const cause = attacker ? attacker.type : 'shell';
    world.killLog[cause] = (world.killLog[cause] || 0) + 1;
    kill(world, victim, attacker);
  } else {
    maybeBreak(world, victim);
  }
}

function kill(world, u) {
  u.alive = false;
  u.hp = 0;
  u.state = 'dead';
  u.selected = false;
  const s = world.sides[u.side];
  s.alive--; s.losses++;
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
      if (v.morale < 25 && Math.random() < 0.12) flee(v);
    }
  });
}

// ---------- Firing ----------

// A friendly soldier standing directly in front makes a musketeer hold his
// fire (mostly): only the leading ranks of a deep formation shoot freely.
// This is what makes wide Lines beat deep blobs, as it did historically.
function fireBlocked(world, u, t, d) {
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
  smokePuff(world, u.x + nx * 9, u.y + ny * 9 - 4, false);
  if (Math.random() < 0.5) flash(world, u.x + nx * 8, u.y + ny * 8 - 4, false);
  sfx.musket();
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
    dmg: u.dmg, splash: u.splash,
  });
  smokePuff(world, u.x + nx * 18, u.y + ny * 18 - 5, true);
  flash(world, u.x + nx * 14, u.y + ny * 14 - 4, true);
  sfx.cannon();
}

function explodeShell(world, p) {
  world.pendingDecals.push({ kind: 'crater', x: p.tx, y: p.ty });
  smokePuff(world, p.tx, p.ty - 3, true);
  smokePuff(world, p.tx + 5, p.ty - 6, false);
  flash(world, p.tx, p.ty - 2, true);
  sfx.cannon();
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

  // -- Target upkeep / acquisition (staggered) --
  if (u.target && !u.target.alive) u.target = null;
  if (u.orderTarget && !u.orderTarget.alive) u.orderTarget = null;
  u.acquireT -= dt;
  if (u.acquireT <= 0) {
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

  // -- Choose a destination --
  if (t && !isRanged && (u.orderTarget === t || d <= u.chase)) {
    destX = t.x; destY = t.y; stopAt = meleeReach - 1;
  } else if (t && isRanged && u.orderTarget === t) {
    destX = t.x; destY = t.y; stopAt = Math.max(u.range * 0.85, u.minRange + 20);
  } else if (!Number.isNaN(u.orderX)) {
    destX = u.orderX; destY = u.orderY;
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
      u.orderX = NaN; u.orderY = NaN;
      if (u.state === 'move') u.state = 'idle';
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
  sfx.melee();
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

  for (let i = 0; i < active.length; i++) {
    const u = active[i];
    if (u.alive) updateUnit(world, u, dt);
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
      explodeShell(world, p);
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

  sfx.update(dt);

  // Victory check
  world.checkT -= dt;
  if (world.checkT <= 0) {
    world.checkT = 0.5;
    const [a, b] = world.sides;
    const aDone = a.alive <= Math.max(2, a.start * 0.08);
    const bDone = b.alive <= Math.max(2, b.start * 0.08);
    if (aDone || bDone) {
      world.state = 'ended';
      world.winner = aDone && bDone ? -2 : aDone ? 1 : 0;
    }
  }
}
