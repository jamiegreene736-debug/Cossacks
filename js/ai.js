// Settlement and battlefield AI. It uses the same costs, queues, construction,
// gathering and population rules as the player; only its decisions are scripted.

import { WORLD, BUILDING_TYPES } from './config.js';
import { applyMoveOrder, applyAttackOrder } from './formations.js';
import {
  assignBuilders, assignGatherers, buildingsOf, findNearestResource, getTownCenter,
  getMillFieldSlots, placeBuilding, queueUnit, setRallyPoint, unitsOf,
} from './economy.js';

const MILITARY_TYPES = new Set(['musk', 'pike', 'cav', 'gun']);

function centroid(units) {
  let x = 0, y = 0;
  for (const unit of units) { x += unit.x; y += unit.y; }
  const n = units.length || 1;
  return { x: x / n, y: y / n };
}

export class Commander {
  constructor(world, side = 1) {
    this.world = world;
    this.side = side;
    this.thinkTimer = 0.5;
    this.attackTimer = 92;
    this.committed = new Set();
    this.planCursor = {};
  }

  update(dt) {
    if (this.world.state !== 'running') return;
    updateDeferredAiOrders(this.world);
    this.thinkTimer -= dt;
    this.attackTimer -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 1;
    this.manageEconomy();
    this.manageProduction();
    this.manageArmy();
  }

  manageEconomy() {
    const world = this.world;
    const side = world.sides[this.side];
    const tc = getTownCenter(world, this.side);
    if (!tc) return;
    const villagers = unitsOf(world, this.side, 'villager');

    // Keep the economy growing, but never bury military production beneath a
    // long villager queue.
    if (villagers.length + tc.queue.filter(item => item.type === 'villager').length < 22
        && tc.queue.length < 2) {
      queueUnit(world, tc, 'villager', 1);
    }

    const priorities = ['food', 'wood', 'food', 'gold', 'wood', 'stone'];
    let idleIndex = 0;
    for (const worker of villagers) {
      if (worker.job) continue;
      const resourceType = priorities[idleIndex++ % priorities.length];
      const target = findNearestResource(world, worker.x, worker.y, resourceType, this.side);
      if (target) assignGatherers(world, [worker], target);
    }

    // Finish one foundation before opening another. This prevents a tiny early
    // workforce from being reassigned across several abandoned building sites.
    const unfinished = buildingsOf(world, this.side).find(building => !building.complete);
    if (unfinished) {
      assignBuilders(world, villagers.slice(0, 4), unfinished);
      return;
    }

    const usedPop = side.population + side.queuedPopulation;
    if (side.popCap - usedPop < 18 && buildingsOf(world, this.side, 'house').length < 29) {
      if (this.tryBuild('house', villagers)) return;
    }

    if (villagers.length >= 3 && this.ensureBuilding('lumber_camp', villagers)) return;
    if (villagers.length >= 4 && this.ensureBuilding('mill', villagers)) return;
    if (villagers.length >= 5 && this.ensureBuilding('barracks', villagers)) return;
    if (villagers.length >= 6 && this.ensureBuilding('mine', villagers)) return;
    if (villagers.length >= 9 && buildingsOf(world, this.side, 'barracks', true).length) {
      if (this.ensureBuilding('stable', villagers)) return;
    }
    if (villagers.length >= 13 && buildingsOf(world, this.side, 'stable', true).length) {
      if (this.ensureBuilding('foundry', villagers)) return;
    }
    if (villagers.length >= 12 && buildingsOf(world, this.side, 'tower').length < 2) {
      if (this.tryBuild('tower', villagers)) return;
    }
    if (villagers.length >= 2 && buildingsOf(world, this.side, 'farm').length < Math.ceil(villagers.length / 4)) {
      this.tryBuild('farm', villagers);
    }
  }

  ensureBuilding(type, villagers) {
    return buildingsOf(this.world, this.side, type).length === 0
      ? this.tryBuild(type, villagers) : false;
  }

  tryBuild(type, villagers) {
    const freeWorkers = villagers.filter(worker => !worker.job).slice(0, 3);
    const builders = freeWorkers.length ? freeWorkers : villagers.slice(0, 3);
    if (builders.length === 0) return false;
    const tc = getTownCenter(this.world, this.side);
    if (!tc) return false;
    if (type === 'farm') {
      const mills = buildingsOf(this.world, this.side, 'mill', true);
      for (const mill of mills) {
        for (const slot of getMillFieldSlots(mill)) {
          const result = placeBuilding(
            this.world, this.side, type, slot.x, slot.y, builders, { ai: true },
          );
          if (result.ok) return true;
          if (result.message?.startsWith('Need ')) return false;
        }
      }
      return false;
    }
    const dir = this.side === 0 ? 1 : -1;
    const plans = {
      house: [[20, -185], [20, 185], [125, -205], [125, 205], [245, -260], [245, 275]],
      mill: [[145, -325]],
      lumber_camp: [[235, 75]],
      mine: [[245, 350]],
      barracks: [[260, -110]],
      stable: [[390, 190]],
      foundry: [[410, -205]],
      tower: [[520, -285], [520, 285]],
    };
    const options = plans[type] || [[250, 0]];
    const cursor = this.planCursor[type] || 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const base = options[(cursor + attempt) % options.length];
      const ring = Math.floor((cursor + attempt) / options.length);
      const x = tc.x + dir * (base[0] + ring * 95);
      const y = tc.y + base[1] + (ring % 2 ? 70 : 0);
      const result = placeBuilding(this.world, this.side, type, x, y, builders, { ai: true });
      if (result.ok) {
        this.planCursor[type] = cursor + attempt + 1;
        return true;
      }
      // A resource shortage cannot be solved by trying another tile.
      if (result.message?.startsWith('Need ')) return false;
    }
    return false;
  }

  manageProduction() {
    const world = this.world;
    const military = unitsOf(world, this.side).filter(unit => MILITARY_TYPES.has(unit.type));
    const hasFoundry = buildingsOf(world, this.side, 'foundry').length > 0;
    for (const building of buildingsOf(world, this.side, null, true)) {
      const trains = BUILDING_TYPES[building.type].trains || [];
      if (trains.length === 0 || building.type === 'town_center' || building.queue.length >= 12) continue;
      if (building.type === 'barracks') {
        queueUnit(world, building, !hasFoundry || military.length % 3 === 0 ? 'pike' : 'musk', 5);
      } else if (building.type === 'stable') {
        if (hasFoundry || world.time > 240) queueUnit(world, building, 'cav', 3);
      } else if (building.type === 'foundry') {
        queueUnit(world, building, 'gun', 2);
      }
      setRallyPoint(building, WORLD.w / 2 + (this.side === 0 ? -420 : 420), WORLD.h / 2);
    }
  }

  manageArmy() {
    const world = this.world;
    const tc = getTownCenter(world, this.side);
    if (!tc) return;
    const enemyUnits = unitsOf(world, 1 - this.side);
    const defenders = unitsOf(world, this.side).filter(unit => MILITARY_TYPES.has(unit.type));
    const nearbyEnemy = enemyUnits.find(unit => Math.hypot(unit.x - tc.x, unit.y - tc.y) < 720);
    if (nearbyEnemy && defenders.length) {
      applyAttackOrder(defenders.slice(0, 120), nearbyEnemy);
      return;
    }

    for (const id of [...this.committed]) {
      if (!world.units.some(unit => unit.id === id && unit.alive)) this.committed.delete(id);
    }
    if (this.attackTimer > 0) return;
    const ready = defenders.filter(unit => !this.committed.has(unit.id));
    const minimumWave = world.time < 240 ? 24 : 40;
    if (ready.length < minimumWave) {
      this.attackTimer = 12;
      return;
    }
    const waveSize = Math.min(240, Math.max(minimumWave, Math.floor(ready.length * 0.8)));
    const wave = ready.slice(0, waveSize);
    const enemyTc = getTownCenter(world, 1 - this.side);
    if (!enemyTc) return;
    for (const unit of wave) this.committed.add(unit.id);
    const center = centroid(wave);
    // Dress the wave into a broad line before the final attack order. The
    // brief staging move produces the Cossacks-like wall of troops.
    const stageX = center.x + (enemyTc.x - center.x) * 0.22;
    applyMoveOrder(wave, stageX, center.y, 'line');
    for (const unit of wave) unit.deferredAttack = { target: enemyTc, at: world.time + 8 };
    this.attackTimer = world.time < 300 ? 52 : 38;
    world.events.push({ side: 0, text: 'Enemy formations are marching on your settlement!', tone: 'danger' });
  }
}

export function updateDeferredAiOrders(world) {
  for (const unit of world.units) {
    if (!unit.alive || !unit.deferredAttack || world.time < unit.deferredAttack.at) continue;
    const target = unit.deferredAttack.target;
    unit.deferredAttack = null;
    if (target.alive) applyAttackOrder([unit], target);
  }
}
