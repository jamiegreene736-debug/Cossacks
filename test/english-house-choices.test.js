import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

import { BUILDING_TYPES, canNationBuildBuilding } from '../js/config.js';
import { placeBuilding, validatePlacement } from '../js/economy.js';
import {
  getBuildingPresentation, getBuildingProductionArtSpec,
} from '../js/gfx/buildings.js';
import { createWorld, spawnUnit } from '../js/sim.js';

const ENGLISH_HOUSE_CHOICES = Object.freeze({
  house: ['englishHouse', 'english-house.webp'],
  english_cottage: ['englishCottage', 'english-cottage.webp'],
  english_townhouse: ['englishTownhouse', 'english-townhouse.webp'],
  english_mansion: ['englishMansion', 'english-mansion.webp'],
  spooky_house: ['englishSpookyHouse', 'english-spooky-house.webp'],
});

function findBuildableSite(world, side, type) {
  for (let y = 1180; y <= 2320; y += 80) {
    for (let x = 760; x <= 2140; x += 80) {
      const placement = validatePlacement(world, side, type, x, y);
      if (placement.ok) return { x: placement.x, y: placement.y };
    }
  }
  throw new Error(`No valid ${type} site found`);
}

test('England has explicit selectable house choices with deterministic art', async () => {
  for (const [type, [key, filename]] of Object.entries(ENGLISH_HOUSE_CHOICES)) {
    assert.equal(canNationBuildBuilding('england', type), true);
    assert.deepEqual(getBuildingProductionArtSpec('england', type), { key });
    assert.equal(BUILDING_TYPES[type].popCap, BUILDING_TYPES.house.popCap);

    const metadata = await stat(new URL(`../assets/buildings/${filename}`, import.meta.url));
    assert.ok(metadata.size > 75_000, `${filename} should retain rendered architectural detail`);
  }
});

test('English residences preserve a readable human-to-manor scale hierarchy', () => {
  const width = type => getBuildingPresentation(type).displayArtWidth;
  const hierarchy = [
    'house',
    'english_cottage',
    'english_townhouse',
    'spooky_house',
    'english_mansion',
    'town_center',
  ];

  for (let index = 1; index < hierarchy.length; index++) {
    assert.ok(
      width(hierarchy[index]) > width(hierarchy[index - 1]),
      `${hierarchy[index]} should read larger than ${hierarchy[index - 1]}`,
    );
  }
  assert.ok(width('english_mansion') < width('town_center') * 0.85);
});

test('English house choices are gated from non-English builders', () => {
  assert.equal(canNationBuildBuilding('ottoman', 'house'), true);
  assert.equal(canNationBuildBuilding('ottoman', 'english_mansion'), false);
  assert.equal(canNationBuildBuilding('starwars', 'spooky_house'), false);

  const world = createWorld({
    playerNation: 'england',
    enemyNation: 'ottoman',
    allyNations: ['hogwarts', 'starwars'],
    enemyAllyNation: 'nightmare_circus',
  });
  const site = findBuildableSite(world, 0, 'english_mansion');
  assert.equal(validatePlacement(world, 0, 'english_mansion', site.x, site.y).ok, true);

  const rejected = validatePlacement(world, 1, 'english_mansion', site.x, site.y);
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /not available to Ottoman Empire/);
});

test('England marketplace has production art and resource trading metadata', async () => {
  assert.equal(canNationBuildBuilding('england', 'marketplace'), true);
  assert.equal(canNationBuildBuilding('ottoman', 'marketplace'), false);
  assert.equal(BUILDING_TYPES.marketplace.market, true);
  assert.match(BUILDING_TYPES.marketplace.description, /trade/i);
  assert.deepEqual(getBuildingProductionArtSpec('england', 'marketplace'), { key: 'englishMarketplace' });

  const metadata = await stat(new URL('../assets/buildings/english-marketplace.webp', import.meta.url));
  assert.ok(metadata.size > 150_000, 'english-marketplace.webp should retain rendered market-house detail');
});

test('villagers place the selected English house type instead of a random variant', () => {
  const world = createWorld({
    playerNation: 'england',
    enemyNation: 'ottoman',
    allyNations: ['hogwarts', 'starwars'],
    enemyAllyNation: 'nightmare_circus',
  });
  world.sides[0].resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const site = findBuildableSite(world, 0, 'spooky_house');
  const builder = spawnUnit(world, 0, 'villager', site.x - 90, site.y);
  const result = placeBuilding(world, 0, 'spooky_house', site.x, site.y, [builder]);

  assert.equal(result.ok, true);
  assert.equal(result.building.type, 'spooky_house');
  assert.equal(result.building.visualVariant, null);
});
