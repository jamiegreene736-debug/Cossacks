import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { Commander } from '../js/ai.js';
import {
  BUILDING_TYPES, NATION_TRAINING_ROSTERS, UNIT_TYPES, getTrainableUnitTypes,
} from '../js/config.js';
import {
  WORLD_COUNTRIES, countryFlag, countryParkVariant,
} from '../js/countries.js';
import { createBuilding, queueUnit, stepEconomy } from '../js/economy.js';
import { applyAttackOrder } from '../js/formations.js';
import {
  getBuildingProductionArtSpec, getWizardPlaygroundChildLayout,
} from '../js/gfx/buildings.js';
import { FACTION_CHARACTER_ART_SPECS } from '../js/gfx/art-assets.js';
import { getSpecialProjectileVisualProfile } from '../js/gfx/effects.js';
import { getMilitaryFrame } from '../js/military-animation.js';
import {
  CHARACTER_SCALE_TIERS, getFactionCharacterFrameSources, getFactionCharacterPresentation,
} from '../js/render.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import { createWorld, damage, spawnUnit, step } from '../js/sim.js';
import { OPENING_PEACE_SECONDS } from '../js/truce.js';

function factionWorld(worldCountry = 'GB') {
  return createWorld({
    playerNation: 'england', enemyNation: 'ottoman',
    allyNations: ['hogwarts', 'starwars'], enemyAllyNation: 'nightmare_circus', worldCountry,
  });
}

function advanceCpuOpening(world, seconds, difficulty = 'hard') {
  const commanders = [1, 2, 3, 4].map(sideIndex => new Commander(world, sideIndex, difficulty));
  const dt = 1 / 30;
  for (let tick = 0; tick < seconds * 30; tick++) {
    for (const commander of commanders) commander.update(dt);
    step(world, dt);
  }
}

function militaryStrength(world, sideIndex) {
  const trained = world.units.filter(unit => (
    unit.alive && unit.side === sideIndex && !UNIT_TYPES[unit.unitType]?.worker
  )).length;
  const queued = world.buildings
    .filter(building => building.side === sideIndex)
    .flatMap(building => building.queue)
    .filter(order => !UNIT_TYPES[order.type]?.worker).length;
  return trained + queued;
}

function useSeededRandom(seed, callback) {
  const originalRandom = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function webpDimensions(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (chunk === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(data + 4, 3),
        height: 1 + buffer.readUIntLE(data + 7, 3),
      };
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(data + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    offset = data + size + (size % 2);
  }
  throw new Error('Unsupported WebP encoding');
}

function webpHasAlpha(buffer) {
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (chunk === 'VP8X') return (buffer[data] & 0x10) !== 0;
    if (chunk === 'VP8L') return ((buffer.readUInt32LE(data + 1) >>> 28) & 1) === 1;
    offset = data + size + (size % 2);
  }
  return false;
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

test('the authored allied story launches England, Hogwarts, and StarWars against both enemy realms', () => {
  const world = factionWorld('JP');
  assert.deepEqual(world.sides.map(side => side.nation), [
    'england', 'ottoman', 'hogwarts', 'nightmare_circus', 'starwars',
  ]);
  assert.deepEqual(world.sides.map(side => side.team), [0, 1, 0, 1, 0]);
  assert.equal(world.mode, 'allied');
  assert.equal(world.worldCountry, 'JP');

  const alliedTypes = world.buildings
    .filter(building => building.side === 2)
    .map(building => building.type);
  assert.deepEqual(new Set(alliedTypes), new Set([
    'town_center', 'house', 'mill', 'lumber_camp', 'mine', 'barracks', 'stable',
    'foundry', 'tower', 'school', 'castle', 'pool', 'beach', 'park', 'playground',
  ]));
  assert.ok(world.buildings.filter(building => building.side === 2).every(building => building.complete));
  assert.equal(world.sides[2].resources.stone, 120, 'the allied castle and civic district are free');

  const starWarsTypes = world.buildings
    .filter(building => building.side === 4)
    .map(building => building.type);
  assert.deepEqual(new Set(starWarsTypes), new Set([
    'town_center', 'house', 'mill', 'lumber_camp', 'mine',
    'barracks', 'stable', 'foundry', 'tower', 'castle',
  ]));
  assert.ok(world.buildings.filter(building => building.side === 4).every(building => building.complete));
});

test('all non-woman villagers share the same economy and militia balance', () => {
  const balancedWorkerFields = [
    'hp', 'speed', 'radius', 'range', 'acquire', 'reload', 'dmg', 'acc',
    'meleeDmg', 'meleeRate', 'chase', 'cost', 'trainTime', 'pop',
  ];
  const standard = UNIT_TYPES.villager;
  for (const unitType of [
    'wizard_worker', 'witch_worker', 'circus_worker',
    'starwars_mechanic', 'starwars_robed_villager',
  ]) {
    const worker = UNIT_TYPES[unitType];
    assert.equal(worker.worker, true);
    for (const field of balancedWorkerFields) {
      assert.deepEqual(worker[field], standard[field], `${unitType} should match villager ${field}`);
    }
  }
  assert.notDeepEqual(UNIT_TYPES.woman_villager.cost, standard.cost);
  assert.ok(UNIT_TYPES.woman_villager.range > standard.range);
});

test('themed soldiers keep faction visuals but use equal combat archetype costs and power', () => {
  const fields = [
    'hp', 'speed', 'radius', 'range', 'acquire', 'reload', 'dmg', 'acc',
    'meleeDmg', 'meleeRate', 'chase', 'cost', 'trainTime', 'pop',
  ];
  const groups = [
    ['musk', ['wizard_duelist', 'captain_spaulding', 'starwars_sentinel']],
    ['pike', ['witch_duelist', 'art_clown', 'twisty_clown', 'starwars_blade_guard']],
    ['cav', ['broom_rider', 'pennywise', 'starwars_skiff_rider']],
    ['gun', ['moaning_myrtle', 'killer_klown', 'starwars_pulse_cannon']],
  ];
  for (const [standardType, themedTypes] of groups) {
    const standard = UNIT_TYPES[standardType];
    for (const unitType of themedTypes) {
      const unit = UNIT_TYPES[unitType];
      for (const field of fields) {
        assert.deepEqual(unit[field], standard[field], `${unitType} should match ${standardType} ${field}`);
      }
    }
  }
  assert.equal(UNIT_TYPES.starwars_sentinel.projectileKind, 'plasma');
  assert.equal(UNIT_TYPES.wizard_duelist.projectileKind, 'arcane');
  assert.equal(UNIT_TYPES.broom_rider.projectileKind, 'arcane');
  assert.equal(UNIT_TYPES.killer_klown.projectileKind, 'cotton_candy');
});

test('every CPU faction queues the same army batch from equivalent production buildings', () => {
  const world = factionWorld();
  for (const sideIndex of [1, 2, 3, 4]) {
    const side = world.sides[sideIndex];
    side.resources = { food: 100_000, wood: 100_000, gold: 100_000, stone: 100_000 };
    side.popCap = 1200;
    side.queuedPopulation = 0;
    world.buildings = world.buildings.filter(building => (
      building.side !== sideIndex
        || !['barracks', 'stable', 'foundry', 'castle'].includes(building.type)
    ));
    const townCenter = world.buildings.find(building => (
      building.side === sideIndex && building.type === 'town_center'
    ));
    const barracks = createBuilding(sideIndex, 'barracks', townCenter.x + 120, townCenter.y - 170, true, {
      team: side.team,
    });
    const stable = createBuilding(sideIndex, 'stable', townCenter.x + 245, townCenter.y, true, {
      team: side.team,
    });
    const foundry = createBuilding(sideIndex, 'foundry', townCenter.x + 120, townCenter.y + 170, true, {
      team: side.team,
    });
    world.buildings.push(barracks, stable, foundry);

    const commander = new Commander(world, sideIndex, 'hard');
    commander.manageProduction();

    assert.equal(barracks.queue.length, 4, `${side.nation} barracks batch`);
    assert.equal(stable.queue.length, 2, `${side.nation} stable batch`);
    assert.equal(foundry.queue.length, 1, `${side.nation} foundry batch`);
  }
});

test('all CPU factions develop comparable opening armies', () => {
  useSeededRandom(1700, () => {
    const world = factionWorld();
    advanceCpuOpening(world, 480);

    const strengths = [1, 2, 3, 4].map(sideIndex => militaryStrength(world, sideIndex));
    const weakest = Math.min(...strengths);
    const strongest = Math.max(...strengths);

    assert.ok(weakest >= 90, `weakest CPU army should be battle-ready, got ${strengths.join(', ')}`);
    assert.ok(strongest / weakest <= 1.6, `CPU army spread should stay fair, got ${strengths.join(', ')}`);
  });
});

test('every faction character shares the same human-scale presentation tiers', () => {
  for (const [nation, spec] of Object.entries(FACTION_CHARACTER_ART_SPECS)) {
    for (const unitType of Object.keys(spec.unitRows)) {
      const presentation = getFactionCharacterPresentation(unitType);
      const expectedTier = presentation.worker ? CHARACTER_SCALE_TIERS.worker
        : presentation.equipment ? CHARACTER_SCALE_TIERS.equipment
          : presentation.mounted ? CHARACTER_SCALE_TIERS.mounted
            : CHARACTER_SCALE_TIERS.infantry;
      assert.equal(
        presentation.standingHeight,
        expectedTier.height,
        `${nation} ${unitType} should use the shared ${presentation.worker ? 'worker' : 'combat'} height`,
      );
      assert.equal(presentation.standingWidth, expectedTier.width);
      assert.ok(
        presentation.standingHeight <= CHARACTER_SCALE_TIERS.equipment.height,
        `${nation} ${unitType} should never approach building-scale height`,
      );
    }
  }

  assert.equal(getFactionCharacterPresentation('circus_worker').standingHeight, 44);
  assert.equal(getFactionCharacterPresentation('pennywise').standingHeight, 50);
  assert.equal(getFactionCharacterPresentation('killer_klown').standingHeight, 56);
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
  assert.deepEqual(getTrainableUnitTypes('hogwarts', 'stable'), ['broom_rider']);
  assert.equal(queueUnit(world, townCenter, 'pennywise', 1, { free: true }).ok, false);
});

test('StarWars trains detailed villagers and galactic defenders from faction buildings', () => {
  const world = factionWorld();
  const townCenter = world.buildings.find(building => building.side === 4 && building.type === 'town_center');
  townCenter.queue.length = 0;
  world.sides[4].queuedPopulation = 0;
  world.sides[4].resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const worker = queueUnit(world, townCenter, 'starwars_robed_villager', 1, { trainTime: 0.01 });
  assert.equal(worker.ok, true);
  stepEconomy(world, 0.02);
  const villager = world.units.find(unit => unit.side === 4 && unit.unitType === 'starwars_robed_villager');
  assert.ok(villager);
  assert.equal(villager.type, 'villager');
  assert.equal(villager.projectileKind, 'plasma');
  assert.deepEqual(getTrainableUnitTypes('starwars', 'town_center'), [
    'starwars_mechanic', 'starwars_robed_villager',
  ]);
  assert.deepEqual(getTrainableUnitTypes('starwars', 'castle'), [
    'starwars_sentinel', 'starwars_blade_guard', 'starwars_skiff_rider',
    'starwars_pulse_cannon',
  ]);
  assert.equal(queueUnit(world, townCenter, 'moaning_myrtle', 1, { free: true }).ok, false);
});

test('StarWars attacks retain distinct authored weapon and effect contracts', () => {
  assert.deepEqual(getFactionCharacterFrameSources('starwars_pulse_cannon'), [0, 2]);
  assert.equal(getMilitaryFrame({
    type: 'starwars_pulse_cannon', unitType: 'starwars_pulse_cannon', fireT: 0.1, moving: false,
  }), 1);
  assert.equal(getFactionCharacterFrameSources('starwars_sentinel').at(-1), 2);
  assert.deepEqual(getFactionCharacterFrameSources('starwars_sentinel').slice(1, 7), [1, 0, 3, 1, 0, 3]);
  assert.equal(getFactionCharacterFrameSources('starwars_mechanic').length, 29);

  const plasma = getSpecialProjectileVisualProfile('plasma');
  const ion = getSpecialProjectileVisualProfile('ion');
  assert.equal(plasma.shape, 'orb');
  assert.equal(ion.shape, 'discharge');
  assert.ok(ion.trail > plasma.trail);
  assert.notEqual(plasma.shell, ion.shell);
});

test('allied StarWars defenses do not target England or Hogwarts units', () => {
  const world = factionWorld();
  world.time = OPENING_PEACE_SECONDS;
  const castle = world.buildings.find(building => building.side === 4 && building.type === 'castle');
  castle.reload = 0;
  const englishWorker = spawnUnit(world, 0, 'villager', castle.x - 55, castle.y - 35);
  const hogwartsWorker = spawnUnit(world, 2, 'wizard_worker', castle.x + 45, castle.y + 20);
  for (let tick = 0; tick < 120; tick++) step(world, 1 / 30);

  assert.equal(englishWorker.hp, englishWorker.maxHp);
  assert.equal(hogwartsWorker.hp, hogwartsWorker.maxHp);
  assert.equal(world.projectiles.some(projectile => projectile.kind === 'castle'), false);
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

test('Nightmare Circus projectiles use dimensional smoke and spun-sugar treatments', () => {
  const nightmare = getSpecialProjectileVisualProfile('nightmare');
  const cottonCandy = getSpecialProjectileVisualProfile('cotton_candy');
  assert.equal(nightmare.shape, 'nightmare');
  assert.equal(cottonCandy.shape, 'spun_sugar');
  assert.ok(nightmare.trail >= 34);
  assert.ok(cottonCandy.trail >= 34);
  assert.notEqual(nightmare.shell, cottonCandy.shell);
});

test('magic attacks travel visibly while protected parks and children cannot be damaged', () => {
  const world = factionWorld();
  world.time = OPENING_PEACE_SECONDS;
  const wizard = spawnUnit(world, 2, 'wizard_duelist', 900, 1500);
  const sentinel = spawnUnit(world, 4, 'starwars_sentinel', 940, 1620);
  const clown = spawnUnit(world, 3, 'captain_spaulding', 1080, 1500);
  wizard.reload = 0;
  sentinel.reload = 0;
  clown.acquire = 0;
  applyAttackOrder([wizard], clown);
  applyAttackOrder([sentinel], clown);
  step(world, 1 / 30);
  assert.ok(world.projectiles.some(projectile => projectile.kind === 'arcane'));
  assert.ok(world.projectiles.some(projectile => projectile.kind === 'plasma'));

  const playground = world.buildings.find(building => building.type === 'playground');
  const integrity = playground.hp;
  assert.equal(BUILDING_TYPES.playground.peacefulCivic, true);
  assert.equal(damage(world, playground, integrity + 1, clown), false);
  assert.equal(playground.alive, true);
  assert.equal(playground.hp, integrity);
});

test('the protected playground contains animated wizard boys and girls at play', () => {
  const morning = getWizardPlaygroundChildLayout(15, 12345);
  const later = getWizardPlaygroundChildLayout(18.4, 12345);
  assert.equal(morning.length, 8);
  assert.ok(morning.some(child => child.gender === 'boy'));
  assert.ok(morning.some(child => child.gender === 'girl'));
  assert.deepEqual(new Set(morning.map(child => child.play)), new Set([
    'wand-chase', 'rope-bridge', 'slide', 'swing',
    'sandbox-spell', 'spell-circle', 'tower-lookout',
  ]));
  assert.ok(morning.every(child => child.x >= -64 && child.x <= 64));
  assert.ok(morning.every(child => child.y >= -36 && child.y <= 42));
  assert.ok(morning.every(child => child.scale >= 0.74 && child.scale <= 1.01));
  assert.ok(morning.some((child, index) => (
    Math.hypot(child.x - later[index].x, child.y - later[index].y) > 2
  )), 'at least one wizard child should visibly move between frames');
});

test('fantasy architecture is backed by substantial high-detail production assets', async () => {
  const fixtures = [
    ['hogwarts', 'town_center', 'hogwartsTownCenter', 'hogwarts-town-center.webp', 160_000],
    ['hogwarts', 'house', 'hogwartsHouse', 'hogwarts-house.webp', 160_000],
    ['hogwarts', 'mill', 'hogwartsMill', 'hogwarts-mill.webp', 160_000],
    ['hogwarts', 'lumber_camp', 'hogwartsLumberCamp', 'hogwarts-lumber-camp.webp', 160_000],
    ['hogwarts', 'mine', 'hogwartsMine', 'hogwarts-mine.webp', 160_000],
    ['hogwarts', 'barracks', 'hogwartsBarracks', 'hogwarts-barracks.webp', 160_000],
    ['hogwarts', 'stable', 'hogwartsStable', 'hogwarts-stable.webp', 160_000],
    ['hogwarts', 'foundry', 'hogwartsFoundry', 'hogwarts-foundry.webp', 160_000],
    ['hogwarts', 'tower', 'hogwartsTower', 'hogwarts-tower.webp', 160_000],
    ['hogwarts', 'castle', 'hogwartsCastle', 'hogwarts-castle.webp', 300_000],
    ['hogwarts', 'school', 'hogwartsGreatHall', 'hogwarts-great-hall.webp', 160_000],
    ['hogwarts', 'pool', 'hogwartsPool', 'hogwarts-pool.webp', 160_000],
    ['hogwarts', 'beach', 'hogwartsBeach', 'hogwarts-beach.webp', 160_000],
    ['england', 'playground', 'worldPlayground', 'world-playground.webp', 600_000],
    ['nightmare_circus', 'town_center', 'circusTownCenter', 'circus-town-center.webp', 130_000],
    ['nightmare_circus', 'castle', 'circusCastle', 'circus-castle.webp', 130_000],
    ['starwars', 'town_center', 'starwarsTownCenter', 'starwars-town-center.webp', 190_000],
    ['starwars', 'house', 'starwarsHouse', 'starwars-house.webp', 190_000],
    ['starwars', 'mill', 'starwarsMill', 'starwars-mill.webp', 190_000],
    ['starwars', 'lumber_camp', 'starwarsLumberCamp', 'starwars-lumber-camp.webp', 190_000],
    ['starwars', 'mine', 'starwarsMine', 'starwars-mine.webp', 190_000],
    ['starwars', 'barracks', 'starwarsBarracks', 'starwars-barracks.webp', 190_000],
    ['starwars', 'stable', 'starwarsStable', 'starwars-stable.webp', 190_000],
    ['starwars', 'foundry', 'starwarsFoundry', 'starwars-foundry.webp', 190_000],
    // The tower deliberately has a narrow silhouette and substantially more
    // transparent canvas than the other buildings; lossless source detail is
    // therefore retained at a smaller byte size.
    ['starwars', 'tower', 'starwarsTower', 'starwars-tower.webp', 120_000],
    ['starwars', 'castle', 'starwarsCastle', 'starwars-castle.webp', 190_000],
  ];
  for (const [nation, type, key, filename, minimumBytes] of fixtures) {
    assert.deepEqual(getBuildingProductionArtSpec(nation, type), { key });
    const assetUrl = new URL(`../assets/buildings/${filename}`, import.meta.url);
    const metadata = await stat(assetUrl);
    assert.ok(metadata.size > minimumBytes, `${filename} should retain its source depth`);
    if (filename === 'hogwarts-castle.webp') {
      assert.deepEqual(webpDimensions(await readFile(assetUrl)), { width: 768, height: 1024 });
    }
    if (filename === 'world-playground.webp') {
      const playground = await readFile(assetUrl);
      assert.deepEqual(webpDimensions(playground), { width: 1136, height: 968 });
      assert.equal(webpHasAlpha(playground), true, 'playground canvas must retain real transparency');
    }
  }
});

test('the Great Hall keeps its opacity-corrected production artwork', async () => {
  const assetUrl = new URL('../assets/buildings/hogwarts-great-hall.webp', import.meta.url);
  const digest = createHash('sha256').update(await readFile(assetUrl)).digest('hex');
  assert.equal(
    digest,
    '6bfd78d85ca5b43e0da834c534123a15cb164ef888d98b626c3a5afac810d97c',
    'the alpha-corrected masonry must not regress to the translucent source sprite',
  );
});

test('world-country identity and fantasy units survive save and resume', () => {
  const world = factionWorld('OM');
  const myrtle = spawnUnit(world, 2, 'moaning_myrtle', 800, 1800);
  const broomRider = spawnUnit(world, 2, 'broom_rider', 880, 1880);
  const pennywise = spawnUnit(world, 3, 'pennywise', 4200, 1800);
  const sentinel = spawnUnit(world, 4, 'starwars_sentinel', 820, 1960);
  const snapshot = createGameSnapshot(world, [
    new Commander(world, 1), new Commander(world, 2), new Commander(world, 3), new Commander(world, 4),
  ], {
    x: 2600, y: 1600, zoom: 0.8,
  });
  assert.deepEqual(snapshot.summary.allyNations, ['hogwarts', 'starwars']);
  assert.deepEqual(snapshot.summary.enemyNations, ['ottoman', 'nightmare_circus']);
  const restored = restoreGameSnapshot(snapshot).world;
  assert.equal(restored.worldCountry, 'OM');
  assert.equal(restored.units.find(unit => unit.id === myrtle.id).unitType, 'moaning_myrtle');
  assert.equal(restored.units.find(unit => unit.id === broomRider.id).unitType, 'broom_rider');
  assert.equal(restored.units.find(unit => unit.id === pennywise.id).unitType, 'pennywise');
  assert.equal(restored.units.find(unit => unit.id === sentinel.id).unitType, 'starwars_sentinel');
});
