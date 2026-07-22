import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

import { Commander } from '../js/ai.js';
import {
  BUILDING_TYPES, NATION_TRAINING_ROSTERS, UNIT_TYPES, getTrainableUnitTypes,
} from '../js/config.js';
import {
  WORLD_COUNTRIES, countryFlag, countryParkVariant,
} from '../js/countries.js';
import { createBuilding, queueUnit, stepEconomy } from '../js/economy.js';
import { applyAttackOrder } from '../js/formations.js';
import { getBuildingProductionArtSpec } from '../js/gfx/buildings.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { OPENING_PEACE_SECONDS } from '../js/truce.js';

function factionWorld(worldCountry = 'GB') {
  return createWorld({
    playerNation: 'england', enemyNation: 'ottoman',
    allyNation: 'hogwarts', enemyAllyNation: 'nightmare_circus', worldCountry,
  });
}

test('the world catalogue represents 193 UN members and two observer states exactly once', () => {
  assert.equal(WORLD_COUNTRIES.length, 195);
  assert.equal(new Set(WORLD_COUNTRIES.map(country => country.code)).size, 195);
  assert.equal(new Set(WORLD_COUNTRIES.map(country => country.name)).size, 195);
  assert.equal(countryFlag('GB'), '🇬🇧');
  assert.ok(WORLD_COUNTRIES.some(country => country.name === 'Holy See'));
  assert.ok(WORLD_COUNTRIES.some(country => country.name === 'State of Palestine'));
  assert.deepEqual(new Set(WORLD_COUNTRIES.map(country => countryParkVariant(country.code))),
    new Set([0, 1, 2, 3, 4]));
  assert.equal(countryParkVariant('GB'), 0, 'England uses the formal garden family');
  assert.equal(countryParkVariant('JP'), 1, 'Japan uses the East Asian garden family');
  assert.equal(countryParkVariant('BR'), 2, 'Brazil uses the tropical garden family');
  assert.equal(countryParkVariant('OM'), 3, 'Oman uses the oasis garden family');
  assert.equal(countryParkVariant('CH'), 4, 'Switzerland uses the alpine garden family');
});

test('the authored 2v2 story launches England and Hogwarts against both enemy realms', () => {
  const world = factionWorld('JP');
  assert.deepEqual(world.sides.map(side => side.nation), [
    'england', 'ottoman', 'hogwarts', 'nightmare_circus',
  ]);
  assert.deepEqual(world.sides.map(side => side.team), [0, 1, 0, 1]);
  assert.equal(world.worldCountry, 'JP');

  const alliedTypes = world.buildings
    .filter(building => building.side === 2)
    .map(building => building.type);
  assert.deepEqual(new Set(alliedTypes), new Set([
    'town_center', 'house', 'school', 'castle', 'pool', 'beach', 'park', 'playground',
  ]));
  assert.ok(world.buildings.filter(building => building.side === 2).every(building => building.complete));
  assert.equal(world.sides[2].resources.stone, 120, 'the allied castle and civic district are free');
});

test('Hogwarts trains wizards, witches, and Moaning Myrtle from faction buildings', () => {
  const world = factionWorld();
  const townCenter = world.buildings.find(building => building.side === 2 && building.type === 'town_center');
  townCenter.queue.length = 0;
  world.sides[2].queuedPopulation = 0;
  world.sides[2].resources.gold = 1000;
  const queued = queueUnit(world, townCenter, 'moaning_myrtle', 1, { trainTime: 0.01 });
  assert.equal(queued.ok, true);
  stepEconomy(world, 0.02);
  const myrtle = world.units.find(unit => unit.side === 2 && unit.unitType === 'moaning_myrtle');
  assert.ok(myrtle);
  assert.equal(myrtle.projectileKind, 'spectral');
  assert.deepEqual(getTrainableUnitTypes('hogwarts', 'town_center'), [
    'wizard_worker', 'witch_worker', 'moaning_myrtle',
  ]);
  assert.equal(queueUnit(world, townCenter, 'pennywise', 1, { free: true }).ok, false);
});

test('Nightmare Circus AI production rotates through its five hostile clown identities', () => {
  const world = factionWorld();
  const side = world.sides[3];
  side.resources = { food: 100_000, wood: 100_000, gold: 100_000, stone: 100_000 };
  side.popCap = 1200;
  for (const type of ['barracks', 'stable', 'foundry', 'castle']) {
    world.buildings.push(createBuilding(3, type, 4300, 1000 + world.buildings.length * 30, true));
  }
  const commander = new Commander(world, 3, 'hard');
  commander.manageProduction();
  const queued = world.buildings
    .filter(building => building.side === 3)
    .flatMap(building => building.queue.map(item => item.type));
  const circusRoster = new Set(Object.values(NATION_TRAINING_ROSTERS.nightmare_circus).flat());
  assert.ok(queued.length > 0);
  assert.ok(queued.every(unitType => circusRoster.has(unitType)));
  for (const unitType of ['pennywise', 'art_clown', 'twisty_clown', 'captain_spaulding', 'killer_klown']) {
    assert.ok(UNIT_TYPES[unitType], `${unitType} should be a distinct combat identity`);
  }
});

test('magic attacks travel visibly while protected parks and children cannot be damaged', () => {
  const world = factionWorld();
  world.time = OPENING_PEACE_SECONDS;
  const wizard = spawnUnit(world, 2, 'wizard_duelist', 900, 1500);
  const clown = spawnUnit(world, 3, 'captain_spaulding', 1080, 1500);
  wizard.reload = 0;
  clown.acquire = 0;
  applyAttackOrder([wizard], clown);
  step(world, 1 / 30);
  assert.ok(world.projectiles.some(projectile => projectile.kind === 'arcane'));

  const playground = world.buildings.find(building => building.type === 'playground');
  const integrity = playground.hp;
  assert.equal(BUILDING_TYPES.playground.peacefulCivic, true);
  assert.equal(damage(world, playground, integrity + 1, clown), false);
  assert.equal(playground.alive, true);
  assert.equal(playground.hp, integrity);
});

test('fantasy architecture is backed by substantial high-detail production assets', async () => {
  const fixtures = [
    ['hogwarts', 'town_center', 'hogwartsTownCenter', 'hogwarts-town-center.webp'],
    ['hogwarts', 'school', 'hogwartsGreatHall', 'hogwarts-great-hall.webp'],
    ['hogwarts', 'pool', 'hogwartsPool', 'hogwarts-pool.webp'],
    ['hogwarts', 'beach', 'hogwartsBeach', 'hogwarts-beach.webp'],
    ['nightmare_circus', 'town_center', 'circusTownCenter', 'circus-town-center.webp'],
    ['nightmare_circus', 'castle', 'circusCastle', 'circus-castle.webp'],
  ];
  for (const [nation, type, key, filename] of fixtures) {
    assert.deepEqual(getBuildingProductionArtSpec(nation, type), { key });
    const metadata = await stat(new URL(`../assets/buildings/${filename}`, import.meta.url));
    assert.ok(metadata.size > 130_000, `${filename} should retain its source depth`);
  }
});

test('world-country identity and fantasy units survive save and resume', () => {
  const world = factionWorld('OM');
  const myrtle = spawnUnit(world, 2, 'moaning_myrtle', 800, 1800);
  const pennywise = spawnUnit(world, 3, 'pennywise', 4200, 1800);
  const snapshot = createGameSnapshot(world, [new Commander(world, 1), new Commander(world, 2), new Commander(world, 3)], {
    x: 2600, y: 1600, zoom: 0.8,
  });
  assert.deepEqual(snapshot.summary.allyNations, ['hogwarts']);
  assert.deepEqual(snapshot.summary.enemyNations, ['ottoman', 'nightmare_circus']);
  const restored = restoreGameSnapshot(snapshot).world;
  assert.equal(restored.worldCountry, 'OM');
  assert.equal(restored.units.find(unit => unit.id === myrtle.id).unitType, 'moaning_myrtle');
  assert.equal(restored.units.find(unit => unit.id === pennywise.id).unitType, 'pennywise');
});
