import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

import { BUILDING_TYPES } from '../js/config.js';
import { createBuilding, queueUnit } from '../js/economy.js';
import {
  getBuildingPresentation,
  getBuildingProductionArtSpec,
} from '../js/gfx/buildings.js';
import { createWorld, spawnUnit, step } from '../js/sim.js';

const MILITARY_ROSTER = ['musk', 'pike', 'cav', 'gun'];

function makeWorld() {
  return createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
}

test('the Grand Artillery Castle is an expensive late-game fortress', () => {
  const castle = BUILDING_TYPES.castle;
  const tower = BUILDING_TYPES.tower;

  assert.deepEqual(castle.trains, MILITARY_ROSTER);
  assert.ok(castle.cost.wood >= tower.cost.wood * 6);
  assert.ok(castle.cost.stone >= tower.cost.stone * 7);
  assert.ok(castle.cost.gold >= 600);
  assert.ok(castle.buildTime >= 50);
  assert.ok(castle.hp > BUILDING_TYPES.town_center.hp * 2.5);
  assert.ok(castle.radius > tower.radius * 4);
  assert.ok(castle.range > tower.range * 1.7);
  assert.equal(castle.attackKind, 'cannon');
  assert.equal(castle.volley, 3);
});

test('castle presentation is the largest piece in the settlement hierarchy', () => {
  const castle = getBuildingPresentation('castle');
  const townCenter = getBuildingPresentation('town_center');

  assert.ok(castle.displayArtWidth > townCenter.displayArtWidth * 1.5);
  assert.ok(castle.apronRx >= BUILDING_TYPES.castle.radius);
  assert.ok(castle.apronRy >= BUILDING_TYPES.castle.h * 0.5);
});

test('both nations use substantial production castle artwork', async () => {
  const assets = [
    ['england', 'english-grand-artillery-castle.webp'],
    ['ottoman', 'ottoman-grand-artillery-castle.webp'],
  ];

  for (const [nation, filename] of assets) {
    const art = getBuildingProductionArtSpec(nation, 'castle');
    assert.ok(art?.key, `${nation} should select production castle art`);
    const source = new URL(`../assets/buildings/${filename}`, import.meta.url);
    assert.ok((await stat(source)).size > 350_000,
      `${filename} should retain high-resolution architectural detail`);
  }
});

test('a completed castle can queue infantry, cavalry, and artillery', () => {
  const world = makeWorld();
  const castle = createBuilding(0, 'castle', 1150, 1500, true);
  world.buildings.push(castle);
  world.sides[0].popCap = world.sides[0].maxPopulation;

  for (const type of MILITARY_ROSTER) {
    const result = queueUnit(world, castle, type, 1, { free: true });
    assert.equal(result.ok, true, `${type} should be trainable at the castle`);
  }
  assert.deepEqual(castle.queue.map(item => item.type), MILITARY_ROSTER);
});

test('castle cannon volleys reach beyond watch towers and deal damage on impact', () => {
  const world = makeWorld();
  const castle = createBuilding(0, 'castle', 1400, 1500, true);
  const target = spawnUnit(world, 1, 'gun', castle.x + 440, castle.y);
  castle.reload = 0;
  target.acquire = 0;
  target.speed = 0;
  target.reload = 999;
  world.buildings.push(castle);
  const startingHp = target.hp;

  step(world, 1 / 30);

  const volley = world.projectiles.filter(projectile => projectile.kind === 'castle');
  assert.equal(volley.length, BUILDING_TYPES.castle.volley);
  assert.equal(target.hp, startingHp, 'castle shells should not apply hitscan damage');
  assert.ok(440 > BUILDING_TYPES.tower.range);
  assert.ok(440 < BUILDING_TYPES.castle.range);
  for (let tick = 0; tick < 75; tick++) step(world, 1 / 30);
  assert.ok(target.hp < startingHp, 'at least one round should damage the target after impact');
  assert.ok(world.pendingDecals.some(decal => decal.kind === 'crater'));
});
