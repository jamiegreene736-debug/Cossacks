// Battle simulation: unit behavior, combat, morale, projectiles, particles.
// Runs at a fixed 30hz step; rendering interpolates between steps.
//
// Performance notes for big armies (3,000+ units):
//  - Flat uniform grids rebuilt each tick with counting sort (no GC churn)
//  - Target acquisition is staggered (each unit re-scans every ~0.5s)
//  - Collision separation only runs for units that moved this tick

import {
  WORLD, NATIONS, UNIT_TYPES, BUILDING_TYPES, defaultStartPositionForSlot,
  normalizeCpuDifficulty, PIKE_VS_CAV, CAV_CHARGE_BONUS, SQUARE_VS_CAV,
} from './config.js';
import { normalizeWorldCountry } from './countries.js';
import { sfx } from './audio.js';
import { initializeEconomy, stepEconomy, onUnitKilled, onBuildingDestroyed } from './economy.js';
import { corpseDecalTiming } from './gfx/decals.js';
import {
  dismountWallUnit, lineIntersectsFortification, resolveUnitFortificationCollision,
  updateWallAssignment,
} from './fortifications.js';
import {
  assignVillagerPath, clearVillagerPath, segmentBlocksVillager,
} from './navigation.js';
import { isHostilePair, isPeaceTime } from './truce.js';
import {
  RIVAL_TEAM, areAlliedSides, areHostileEntities, areHostileSides,
  sideFrontDirection, sidePossessiveLabel, teamVictory,
} from './teams.js';

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

export function getUnitRuntimeStats(type) {
  const base = UNIT_TYPES[type];
  if (!base) throw new Error(`Unknown unit type: ${type}`);
  return {
    maxHp: base.hp,
    speed: base.speed,
    range: base.range,
    minRange: base.minRange || 0,
    acquire: base.acquire,
    reloadTime: base.reload,
    dmg: base.dmg,
    acc: base.acc,
    splash: base.splash || 0,
    meleeDmg: base.meleeDmg,
    meleeRate: base.meleeRate,
    chase: base.chase,
    radius: base.radius,
    projectileKind: base.projectileKind || null,
  };
}

function makeUnit(side, nationKey, type, x, y, team = null) {
  const stats = getUnitRuntimeStats(type);
  const definition = UNIT_TYPES[type];
  return {
    id: nextId++, side, team,
    // Worker kinds share the mature villager job/navigation surface while the
    // durable unitType preserves their own balance, renderer and save identity.
    type: definition.worker ? 'villager' : type,
    unitType: type,
    nation: nationKey,
    x, y, px: x, py: y,
    ...stats,
    hp: stats.maxHp,
    reload: Math.random() * stats.reloadTime,
    meleeCd: Math.random() * stats.meleeRate,
    morale: 100, charge: 0,
    state: 'idle', alive: true, selected: false,
    orderX: NaN, orderY: NaN, orderTarget: null,
    navigationPath: null, navigationIndex: 0,
    navigationGoalX: NaN, navigationGoalY: NaN, navigationVersion: 0,
    target: null, acquireT: Math.random() * 0.5,
    formation: 'line',
    facing: team === RIVAL_TEAM ? -1 : 1,
    moving: false, animT: Math.random() * 10, walkPhaseOffset: 0,
    fireT: 0, torchT: 0,
    fleeYDrift: 0,
    job: null,
    workAction: null,
  };
}

function clampPos(u) {
  if (u.x < 30) u.x = 30; else if (u.x > WORLD.w - 30) u.x = WORLD.w - 30;
  if (u.y < 30) u.y = 30; else if (u.y > WORLD.h - 30) u.y = WORLD.h - 30;
}

function normalizeAllyNations(opts, playerNation) {
  const requested = Array.isArray(opts?.allyNations)
    ? opts.allyNations
    : opts?.allyNation ? [opts.allyNation]
      : playerNation === 'england' ? ['hogwarts', 'starwars'] : ['hogwarts'];
  const allies = requested.filter(nation => NATIONS[nation]);
  return allies.length ? [...new Set(allies)] : ['hogwarts'];
}

function legacyTeamForSideIndex(sideIndex) {
  return sideIndex % 2 === 0 ? 0 : RIVAL_TEAM;
}

export function createWorld(opts) {
  const playerNation = opts?.playerNation || 'england';
  const enemyNation = opts?.enemyNation || (playerNation === 'england' ? 'ottoman' : 'england');
  const allyNations = normalizeAllyNations(opts, playerNation);
  const enemyAllyNation = opts?.enemyAllyNation || 'nightmare_circus';
  const extraAllies = allyNations.slice(1);
  const defaultSides = [
    {
      nation: playerNation, team: 0, controller: 'human',
      label: 'Your town', startPosition: defaultStartPositionForSlot(0, 0),
    },
    {
      nation: enemyNation, team: RIVAL_TEAM, controller: 'ai',
      label: 'Rival town', startPosition: defaultStartPositionForSlot(RIVAL_TEAM, 0),
    },
    {
      nation: allyNations[0], team: 0, controller: 'ai',
      label: 'Allied town', startPosition: defaultStartPositionForSlot(0, 1),
    },
    {
      nation: enemyAllyNation, team: RIVAL_TEAM, controller: 'ai',
      label: 'Rival ally', startPosition: defaultStartPositionForSlot(RIVAL_TEAM, 1),
    },
    ...extraAllies.map((nation, index) => ({
      nation, team: 0, controller: 'ai',
      label: 'Allied town', startPosition: defaultStartPositionForSlot(0, index + 2),
    })),
  ];
  const sides = Array.isArray(opts?.sides) && opts.sides.length >= 2
    ? opts.sides.map((side, sideIndex) => ({
      ...defaultSides[Math.min(sideIndex, defaultSides.length - 1)],
      ...side,
      nation: NATIONS[side?.nation] ? side.nation : defaultSides[Math.min(sideIndex, defaultSides.length - 1)].nation,
      team: Number.isInteger(side?.team) ? side.team
        : defaultSides[sideIndex]?.team ?? legacyTeamForSideIndex(sideIndex),
      controller: sideIndex === 0 ? 'human' : side?.controller || 'ai',
      start: 0,
      alive: 0,
      kills: 0,
      losses: 0,
    }))
    : defaultSides.map(side => ({ ...side, start: 0, alive: 0, kills: 0, losses: 0 }));
  const world = {
    units: [], active: [],
    projectiles: [], particles: [], flags: [], destructions: [],
    pendingDecals: [], decals: [],
    time: 0, state: 'running', winner: -1, checkT: 1,
    speed: 1, killLog: {},
    difficulty: normalizeCpuDifficulty(opts?.difficulty),
    navigationVersion: 0,
    sepGrid: new FlatGrid(20, WORLD.w, WORLD.h),
    tgtGrid: new FlatGrid(64, WORLD.w, WORLD.h),
    mode: sides.length > 4 ? 'allied' : sides.length >= 4 ? '2v2' : '1v1',
    worldCountry: normalizeWorldCountry(opts?.worldCountry),
    sides,
  };
  world.spawnUnit = (side, type, x, y) => spawnUnit(world, side, type, x, y);
  world.damage = (victim, amount, attacker) => damage(world, victim, amount, attacker);
  initializeEconomy(world);
  return world;
}

export function spawnUnit(world, sideIndex, type, x, y) {
  const side = world.sides[sideIndex];
  const unit = makeUnit(sideIndex, side.nation, type, x, y, side.team);
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
  if (!victim.alive) return false;
  if (victim.entityKind === 'building' && BUILDING_TYPES[victim.type]?.peacefulCivic) return false;
  if (isPeaceTime(world) && isHostilePair(attacker, victim)) return false;
  victim.hp -= amount;
  if (victim.entityKind === 'building' && attacker?.alive && attacker.entityKind !== 'building'
    && attacker.type !== 'villager' && areHostileEntities(world, attacker, victim)) {
    victim.lastHostileUnitDamageAt = world.time;
    victim.lastHostileUnitSide = attacker.side;
  }
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
  return true;
}

export function buildingFireIntensity(building) {
  if (!building?.alive || !building.complete || !building.ignited) return 0;
  const health = Math.max(0, building.hp / Math.max(1, building.maxHp));
  const severity = Math.min(1, 0.28 + (1 - health) * 0.88
    + Math.min(0.2, (building.fireImpactCount || 1) * 0.025));
  const suppression = building.repairing
    ? Math.max(0, Math.min(0.9, (building.repairProgress || 0) * 0.9)) : 0;
  return severity * (1 - suppression);
}

function igniteBuilding(building) {
  if (!building?.alive || building.entityKind !== 'building') return;
  building.ignited = true;
  building.fireImpactCount = (building.fireImpactCount || 0) + 1;
  building.fireEmitT = Math.min(building.fireEmitT ?? 0.04, 0.04);
  if (!Number.isFinite(building.fireSeed)) {
    building.fireSeed = ((building.id || 1) * 2654435761) >>> 0;
  }
}

function kill(world, entity, attacker = null) {
  entity.alive = false;
  entity.hp = 0;
  entity.state = 'dead';
  entity.selected = false;
  const s = world.sides[entity.side];
  if (entity.entityKind === 'building') {
    sfx.buildingDestroyed(entity.type, entity.x);
    onBuildingDestroyed(world, entity);
    world.pendingDecals.push({
      kind: 'ruin', x: entity.x, y: entity.y, type: entity.type,
      w: entity.w, h: entity.h, side: entity.side, seed: entity.fireSeed,
    });
    if (!world.destructions) world.destructions = [];
    world.destructions.push({
      id: entity.id, type: entity.type, side: entity.side,
      x: entity.x, y: entity.y, w: entity.w, h: entity.h, radius: entity.radius,
      nation: world.sides[entity.side].nation,
      hp: 1, maxHp: entity.maxHp, complete: true, queue: [],
      fireSeed: entity.fireSeed || ((entity.id * 2654435761) >>> 0),
      age: 0, duration: 1.45,
    });
    world.events.push({
      side: entity.side,
      text: `${sidePossessiveLabel(world, entity.side)} ${entity.type.replaceAll('_', ' ')} was destroyed.`,
      tone: 'danger',
    });
    return;
  }
  const u = entity;
  sfx.unitDeath(u.type, u.x);
  s.alive--; s.losses++;
  onUnitKilled(world, u);
  if (Number.isInteger(attacker?.side) && areHostileSides(world, attacker.side, u.side)) {
    world.sides[attacker.side].kills++;
  }
  world.pendingDecals.push({
    kind: u.type === 'gun' ? 'wreck' : 'corpse',
    x: u.x, y: u.y, type: u.type,
    side: u.side, coat: NATIONS[u.nation].coat,
    ang: (Math.random() - 0.5) * 1.4,
    seed: ((Math.imul(u.id || 1, 2654435761) ^ Math.imul(Math.round(world.time * 30), 2246822519)) >>> 0),
    ...(u.type === 'gun' ? {} : corpseDecalTiming(world.time)),
  });
  // Watching a comrade fall is bad for everyone nearby.
  const active = world.active;
  world.sepGrid.forEach(u.x, u.y, 40, (i) => {
    const v = active[i];
    if (v !== u && v.alive && areAlliedSides(world, v.side, u.side)) {
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
  if (u.projectileKind) {
    fireSpecialBolt(world, u, t, d, accMul);
    return;
  }
  if (t.entityKind === 'building' && u.type !== 'villager') {
    launchBuildingTorch(world, u, t, u.dmg * (0.85 + Math.random() * 0.3), true);
    return;
  }
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

function fireSpecialBolt(world, u, target, distance, accMul = 1) {
  u.reload = u.reloadTime * (0.9 + Math.random() * 0.2);
  u.fireT = 0.32;
  const nx = (target.x - u.x) / Math.max(1, distance);
  const ny = (target.y - u.y) / Math.max(1, distance);
  const muzzleX = u.x + nx * 10;
  const muzzleY = u.y + ny * 10 - 13;
  const hitChance = Math.min(0.98, Math.max(0.18,
    accMul * u.acc * (1.08 - 0.42 * distance / Math.max(1, u.range))));
  const hit = Math.random() < hitChance;
  const scatter = hit ? 0 : 20 + distance * 0.08;
  const angle = Math.random() * Math.PI * 2;
  const tx = target.x + Math.cos(angle) * scatter;
  const ty = target.y + Math.sin(angle) * scatter;
  world.projectiles.push({
    kind: u.projectileKind,
    sx: muzzleX, sy: muzzleY, x: muzzleX, y: muzzleY, px: muzzleX, py: muzzleY,
    tx, ty, t: 0, dur: Math.min(0.78, Math.max(0.22, distance / 520)), arc: 0,
    dmg: u.dmg, splash: u.splash || 0, target, hit, attackerId: u.id,
  });
  flash(world, muzzleX, muzzleY, u.projectileKind === 'cotton_candy');
  sfx.specialShot(u.projectileKind, u.x);
}

function impactSpecialBolt(world, projectile) {
  const attacker = world.units.find(unit => unit.id === projectile.attackerId) || null;
  flash(world, projectile.tx, projectile.ty - 3, projectile.kind === 'cotton_candy');
  sfx.specialImpact(projectile.kind, projectile.tx);
  if (!projectile.hit) return;
  if (projectile.target?.alive) damage(world, projectile.target, projectile.dmg, attacker);
  if (projectile.splash <= 0) return;
  world.tgtGrid.forEach(projectile.tx, projectile.ty, projectile.splash, index => {
    const unit = world.active[index];
    if (!unit?.alive || unit === projectile.target || areAlliedSides(world, unit.side, attacker?.side)) return;
    const distance = Math.hypot(unit.x - projectile.tx, unit.y - projectile.ty);
    if (distance <= projectile.splash) {
      damage(world, unit, projectile.dmg * (1 - 0.65 * distance / projectile.splash), attacker);
    }
  });
}

export function launchBuildingTorch(world, u, building, amount, usesReload = false) {
  if (!u?.alive || !building?.alive || building.entityKind !== 'building') return null;
  if (isPeaceTime(world) && isHostilePair(u, building)) return null;
  if (usesReload) u.reload = u.reloadTime * (0.85 + Math.random() * 0.3);
  const dx = building.x - u.x;
  const dy = building.y - u.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / distance;
  const ny = dy / distance;
  const visualY = u.y - (u.wallElevation || 0);
  const startReach = u.type === 'cav' ? 12 : 8;
  const projectile = {
    kind: 'torch', sx: u.x + nx * startReach, sy: visualY + ny * startReach - 9,
    x: u.x + nx * startReach, y: visualY + ny * startReach - 9,
    px: u.x + nx * startReach, py: visualY + ny * startReach - 9,
    tx: building.x + nx * Math.min(building.radius * 0.24, 18),
    ty: building.y - Math.max(9, building.h * 0.38),
    t: 0, dur: Math.min(0.92, Math.max(0.38, distance / 185)),
    arc: Math.min(42, Math.max(16, distance * 0.16)),
    dmg: amount, splash: 0, target: building, attackerId: u.id,
  };
  world.projectiles.push(projectile);
  u.torchT = 0.48;
  u.fireT = Math.max(u.fireT, 0.18);
  u.facing = dx >= 0 ? 1 : -1;
  sfx.torchThrow(u.x, u.type === 'cav');
  return projectile;
}

function impactTorch(world, projectile) {
  const target = projectile.target;
  flash(world, projectile.tx, projectile.ty, false);
  smokePuff(world, projectile.tx, projectile.ty - 2, false);
  for (let index = 0; index < 6; index++) {
    const angle = Math.random() * Math.PI * 2;
    spawnParticle(world, {
      kind: 'ember', x: projectile.tx, y: projectile.ty,
      vx: Math.cos(angle) * (18 + Math.random() * 36),
      vy: Math.sin(angle) * 18 - 24 - Math.random() * 22,
      life: 0, max: 0.35 + Math.random() * 0.45,
      size: 1.7 + Math.random() * 1.6, grow: 0,
    });
  }
  sfx.torchImpact(projectile.tx);
  if (!target?.alive || target.entityKind !== 'building') return;
  igniteBuilding(target);
  const attacker = world.units.find(unit => unit.id === projectile.attackerId) || null;
  damage(world, target, projectile.dmg, attacker);
}

function impactTowerShot(world, projectile) {
  flash(world, projectile.tx, projectile.ty - 2, true);
  smokePuff(world, projectile.tx, projectile.ty - 4, false);
  smokePuff(world, projectile.tx + 5, projectile.ty - 7, false);
  for (let index = 0; index < 7; index++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 42;
    spawnParticle(world, {
      kind: 'debris', x: projectile.tx, y: projectile.ty - 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.48 - 18 - Math.random() * 22,
      life: 0, max: 0.42 + Math.random() * 0.42,
      size: 1.7 + Math.random() * 1.9, grow: 0, v: index, st: 0,
    });
  }
  for (let index = 0; index < 2; index++) {
    spawnParticle(world, {
      kind: 'dust', x: projectile.tx + (index ? 5 : -4), y: projectile.ty,
      vx: (index ? 1 : -1) * (8 + Math.random() * 8), vy: -5 - Math.random() * 7,
      life: 0, max: 0.48 + Math.random() * 0.26,
      size: 4.8 + Math.random() * 2.2, grow: 0.8, v: index, st: 0,
    });
  }
  sfx.towerImpact(projectile.tx);

  const target = projectile.target;
  if (projectile.hit === false || !target?.alive || target.entityKind === 'building') return;
  const attacker = world.buildings.find(building => building.id === projectile.attackerId) || null;
  damage(world, target, projectile.dmg, attacker);
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

function fireWomanVillagerCannon(world, u, target, distance) {
  u.reload = u.reloadTime;
  u.fireT = 0.52;
  const nx = (target.x - u.x) / distance;
  const ny = (target.y - u.y) / distance;
  const muzzleX = u.x + nx * 30;
  const muzzleY = u.y + ny * 30 - 7;
  const flightDistance = Math.hypot(target.x - muzzleX, target.y - muzzleY);
  world.projectiles.push({
    kind: 'woman_cannon',
    sx: muzzleX, sy: muzzleY,
    x: muzzleX, y: muzzleY, px: muzzleX, py: muzzleY,
    tx: target.x, ty: target.y, t: 0,
    dur: Math.min(1.1, Math.max(0.32, flightDistance / 430)),
    arc: Math.min(56, Math.max(12, flightDistance * 0.11)),
    dmg: u.dmg, splash: 0, target, attackerId: u.id,
  });
  smokePuff(world, muzzleX, muzzleY, true);
  smokePuff(world, muzzleX - nx * 4, muzzleY - ny * 4 - 2, false);
  flash(world, muzzleX, muzzleY, true);
  sfx.cannonFire(u.x);
}

function explodeShell(world, p) {
  world.pendingDecals.push({ kind: 'crater', x: p.tx, y: p.ty });
  smokePuff(world, p.tx, p.ty - 3, true);
  smokePuff(world, p.tx + 5, p.ty - 6, false);
  flash(world, p.tx, p.ty - 2, true);
  sfx.cannonImpact(p.tx);
  if (p.kind === 'woman_cannon') {
    const target = p.target;
    const attacker = world.units.find(unit => unit.id === p.attackerId) || null;
    if (target?.alive) {
      const soldier = target.entityKind !== 'building' && target.type !== 'villager';
      damage(world, target, soldier ? target.hp + target.maxHp + 1 : p.dmg, attacker);
    }
    return;
  }
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
  u.torchT = Math.max(0, (u.torchT || 0) - dt);
  u.moving = false;

  if (u.state === 'flee') {
    const dirX = -sideFrontDirection(world, u.side);
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
  // A saved or queued hostile order cannot leak through the opening treaty.
  // Movement orders remain intact so both realms can scout and form ranks.
  const peaceActive = isPeaceTime(world);
  if (peaceActive) {
    u.target = null;
    u.orderTarget = null;
    u.deferredAttack = null;
  }
  if (u.target && !u.target.alive) u.target = null;
  if (u.orderTarget && !u.orderTarget.alive) {
    u.orderTarget = null;
    if (u.type === 'villager') clearVillagerPath(u);
    if (u.state === 'move' && Number.isNaN(u.orderX)) u.state = 'idle';
  }
  u.acquireT -= dt;
  if (!peaceActive && u.acquire > 0 && u.acquireT <= 0) {
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
        if (!v.alive || areAlliedSides(world, v.side, u.side)) return;
        const dx = v.x - u.x, dy = v.y - u.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD && d <= u.acquire) { bestD = d; best = v; }
      });
      // Buildings are few, so checking them only after the spatial unit scan
      // remains cheap and lets idle soldiers finish an exposed settlement.
      if (!best) {
        for (const building of world.buildings) {
          if (!building.alive || BUILDING_TYPES[building.type]?.peacefulCivic
              || areAlliedSides(world, building.side, u.side)) continue;
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
  // A normal march is an attack-move for trained troops: nearby hostiles
  // temporarily take priority, but orderX/orderY stay intact so the formation
  // resumes its original destination after the skirmish. Villagers keep their
  // explicit-only militia behavior because their acquire radius is zero.
  const automaticEngagement = u.acquire > 0 && (isRanged || d <= u.chase);
  const shouldEngageTarget = Boolean(t && (u.orderTarget === t || automaticEngagement));
  // Working residents must enter the economy module's 4.5px arrival band;
  // the generic 5px formation stop left some deterministic field rows idle.
  let destX = NaN, destY = NaN, stopAt = u.type === 'villager' && u.job ? 3.5 : 5;

  if (t && isRanged && d <= u.range && d >= u.minRange) {
    // Stand and shoot.
    u.facing = t.x > u.x ? 1 : -1;
    if (u.reload <= 0) {
      let rate = 1;
      if (u.formation === 'square') rate = 0.75;
      const cannonWorker = u.unitType === 'woman_villager';
      if (u.type !== 'gun' && !cannonWorker && fireBlocked(world, u, t, d)) {
        // rear rank: mostly hold fire, sometimes shoot past shoulders
        if (Math.random() < 0.2) fireMusket(world, u, t, d, 0.7);
        else u.reload = 0.6 + Math.random() * 0.9;
      } else if (rate === 1 || Math.random() < rate) {
        if (u.type === 'gun') fireCannon(world, u, t, d);
        else if (cannonWorker) fireWomanVillagerCannon(world, u, t, d);
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
  if (t && isRanged && shouldEngageTarget && u.minRange > 0 && d < u.minRange) {
    // Cannon crew under pressure: create enough space to unlimber and fire.
    const safeDistance = Math.max(1, d);
    destX = u.x + (u.x - t.x) / safeDistance * 40;
    destY = u.y + (u.y - t.y) / safeDistance * 40;
  } else if (t && !isRanged && shouldEngageTarget) {
    destX = t.x; destY = t.y; stopAt = meleeReach - 1;
  } else if (t && isRanged && shouldEngageTarget) {
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
  if (t.entityKind === 'building') {
    launchBuildingTorch(world, u, t, dmg);
  } else {
    sfx.melee(u.x, u.type === 'cav' || t.type === 'cav');
    damage(world, t, dmg, u);
  }
}

function stepBuildingFires(world, dt) {
  for (const building of world.buildings) {
    const intensity = buildingFireIntensity(building);
    if (intensity <= 0) continue;
    building.fireEmitT = (building.fireEmitT || 0) - dt;
    if (building.fireEmitT > 0) continue;
    building.fireEmitT = 0.22 - intensity * 0.11 + Math.random() * 0.07;
    const spread = Math.max(8, building.w * 0.3);
    const x = building.x + (Math.random() - 0.5) * spread;
    const y = building.y - building.h * (0.28 + Math.random() * 0.32);
    smokePuff(world, x, y, intensity > 0.7);
    if (Math.random() < 0.38 + intensity * 0.5) {
      spawnParticle(world, {
        kind: 'ember', x, y: y + 5,
        vx: (Math.random() - 0.5) * 15, vy: -22 - Math.random() * 28,
        life: 0, max: 0.45 + Math.random() * 0.85,
        size: 1.4 + intensity * 2.1, grow: 0,
      });
    }
  }
}

// ---------- Main step ----------

export function step(world, dt) {
  if (world.state !== 'running') return;
  const peaceWasActive = isPeaceTime(world);
  // Attack projectiles serialized by an older build are disarmed rather than
  // being allowed to land during the newly enforced treaty.
  if (peaceWasActive && world.projectiles.length) world.projectiles.length = 0;
  world.time += dt;
  if (peaceWasActive && !isPeaceTime(world)) {
    for (let side = 0; side < world.sides.length; side++) {
      world.events.push({
        side,
        text: 'The ten-minute peace has ended. Combat is now permitted.',
        tone: side === 0 ? 'danger' : 'good',
      });
    }
  }

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
  stepBuildingFires(world, dt);

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
          // Exact overlaps used to pick a new random escape direction every
          // tick, which made dense moving ranks visibly jitter. A unit-id pair
          // now always separates along the same opposing vector.
          const lowId = Math.min(u.id, v.id);
          const highId = Math.max(u.id, v.id);
          const hash = ((lowId * 73856093) ^ (highId * 19349663)) >>> 0;
          const angle = hash / 0xffffffff * Math.PI * 2;
          const sign = u.id === lowId ? 1 : -1;
          u.x += Math.cos(angle) * minD * 0.25 * sign;
          u.y += Math.sin(angle) * minD * 0.25 * sign;
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
      if (p.kind === 'tower') impactTowerShot(world, p);
      else if (p.kind === 'torch') impactTorch(world, p);
      else if (['arcane', 'spectral', 'nightmare', 'cotton_candy', 'plasma', 'ion'].includes(p.kind)) {
        impactSpecialBolt(world, p);
      }
      else explodeShell(world, p);
      world.projectiles.splice(i, 1);
    }
  }

  for (let index = world.destructions.length - 1; index >= 0; index--) {
    const destruction = world.destructions[index];
    destruction.age += dt;
    if (destruction.age >= destruction.duration) world.destructions.splice(index, 1);
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
    const winner = teamVictory(world);
    if (winner !== null) {
      world.state = 'ended';
      world.winner = winner;
    }
  }
}
