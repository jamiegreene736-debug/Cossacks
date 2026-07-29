import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import {
  BUILDING_TYPES,
} from '../js/config.js';
import {
  createBuilding, placeBuilding, stepEconomy, validatePlacement,
} from '../js/economy.js';
import {
  STATION_CONSTRUCTOR_TYPE, STATION_TYPE, TRACK_LENGTH, TRACK_TYPE,
  trackEndpoints,
} from '../js/railways.js';
import {
  RAILWAY_AI_CONFIG, RAILWAY_AI_STATES,
} from '../js/railway-ai.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import { createWorld, spawnUnit, step } from '../js/sim.js';

function makeRailWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman', difficulty: 'low' });
  world.sides[0].resources = { food: 1000, wood: 3000, gold: 3000, stone: 3000 };
  const townCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  const builder = spawnUnit(world, 0, 'villager', townCenter.x + 95, townCenter.y + 25);
  return { world, townCenter, builder };
}

function completeConstructor(world, constructor) {
  constructor.progress = 1;
  constructor.complete = true;
  stepEconomy(world, 1 / 30);
}

function stationSite(townCenter) {
  return { x: townCenter.x + 220, y: townCenter.y + 20 };
}

function forceCommanderThink(commander) {
  commander.thinkTimer = 0;
  commander.update(1);
}

test('villagers can place a station constructor that generates the full station, rails, and train', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const result = placeBuilding(
    world,
    0,
    STATION_CONSTRUCTOR_TYPE,
    stationSite(townCenter).x,
    stationSite(townCenter).y,
    [builder],
    { rotation: 0 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.building.type, STATION_CONSTRUCTOR_TYPE);
  assert.equal(BUILDING_TYPES[STATION_CONSTRUCTOR_TYPE].stationConstructor, true);

  completeConstructor(world, result.building);

  const station = world.buildings.find(building => building.type === STATION_TYPE);
  const tracks = world.buildings.filter(building => building.type === TRACK_TYPE);
  assert.ok(station?.complete);
  assert.equal(result.building.alive, false);
  assert.equal(tracks.length, 4);
  assert.equal(world.trains.length, 1);
  assert.equal(world.trains[0].stationId, station.id);
  assert.ok(tracks.some(track => track.id === world.trains[0].trackId));
});

test('rail placement snaps cleanly to starter track endpoints', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const site = stationSite(townCenter);
  const placed = placeBuilding(world, 0, STATION_CONSTRUCTOR_TYPE, site.x, site.y, [builder]);
  completeConstructor(world, placed.building);
  const eastTrack = world.buildings
    .filter(building => building.type === TRACK_TYPE)
    .sort((a, b) => b.x - a.x)[0];
  const [, eastEnd] = trackEndpoints(eastTrack);
  const validation = validatePlacement(
    world,
    0,
    TRACK_TYPE,
    eastEnd.x + TRACK_LENGTH * 0.5 + 8,
    eastEnd.y + 3,
    { rotation: 0 },
  );

  assert.equal(validation.ok, true);
  assert.equal(Math.round(validation.x), Math.round(eastEnd.x + TRACK_LENGTH * 0.5));
  assert.equal(Math.round(validation.y), Math.round(eastEnd.y));
  const rail = placeBuilding(world, 0, TRACK_TYPE, validation.x, validation.y, [builder], {
    rotation: validation.rotation,
  });
  assert.equal(rail.ok, true);
  const [westEnd] = trackEndpoints(rail.building);
  assert.ok(Math.hypot(westEnd.x - eastEnd.x, westEnd.y - eastEnd.y) <= 1);
});

test('the Hogwarts Express travels from station rails onto villager-built rails', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const site = stationSite(townCenter);
  const placed = placeBuilding(world, 0, STATION_CONSTRUCTOR_TYPE, site.x, site.y, [builder]);
  completeConstructor(world, placed.building);
  const sortedTracks = world.buildings
    .filter(building => building.type === TRACK_TYPE)
    .sort((a, b) => b.x - a.x);
  let current = sortedTracks[0];
  for (let index = 0; index < 3; index++) {
    const [, end] = trackEndpoints(current);
    const validation = validatePlacement(
      world,
      0,
      TRACK_TYPE,
      end.x + TRACK_LENGTH * 0.5,
      end.y,
      { rotation: 0 },
    );
    const placedTrack = placeBuilding(world, 0, TRACK_TYPE, validation.x, validation.y, [builder], {
      rotation: validation.rotation,
    });
    assert.equal(placedTrack.ok, true);
    placedTrack.building.complete = true;
    placedTrack.building.progress = 1;
    current = placedTrack.building;
  }

  const train = world.trains[0];
  const startTrackId = train.trackId;
  for (let tick = 0; tick < 260; tick++) step(world, 1 / 30);

  assert.notEqual(train.trackId, startTrackId);
  assert.equal(train.paused, false);
  assert.ok(train.x > sortedTracks[0].x);
});

test('station, rails, and train survive campaign save and resume', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const site = stationSite(townCenter);
  const placed = placeBuilding(world, 0, STATION_CONSTRUCTOR_TYPE, site.x, site.y, [builder]);
  completeConstructor(world, placed.building);
  step(world, 1);

  const restored = restoreGameSnapshot(createGameSnapshot(
    world,
    new Commander(world, 1),
    { x: townCenter.x, y: townCenter.y, zoom: 1, rotation: 0 },
  )).world;

  assert.equal(restored.buildings.some(building => building.type === STATION_TYPE), true);
  assert.equal(restored.buildings.filter(building => building.type === TRACK_TYPE).length, 4);
  assert.equal(restored.trains.length, 1);
  assert.equal(restored.trains[0].entityKind, 'train');
  assert.ok(restored.buildings.some(building => building.id === restored.trains[0].trackId));
});

test('commander AI crafts, places, and builds a Hogwarts station constructor goal', () => {
  const { world } = makeRailWorld();
  const commander = new Commander(world, 0, 'low');

  forceCommanderThink(commander);
  assert.equal(commander.railway.state, RAILWAY_AI_STATES.CRAFT_STATION_CONSTRUCTOR);
  assert.equal(commander.railway.stationConstructorReady, true);

  forceCommanderThink(commander);
  const constructor = world.buildings.find(building => building.type === STATION_CONSTRUCTOR_TYPE);
  assert.ok(constructor);
  assert.equal(constructor.complete, false);
  assert.equal(commander.railway.state, RAILWAY_AI_STATES.PLACE_STATION);
  assert.ok(world.units.some(unit => unit.job?.kind === 'build' && unit.job.targetId === constructor.id));
});

test('commander AI inspects the generated station and train before extending rails', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const commander = new Commander(world, 0, 'low');
  const placed = placeBuilding(
    world,
    0,
    STATION_CONSTRUCTOR_TYPE,
    stationSite(townCenter).x,
    stationSite(townCenter).y,
    [builder],
    { rotation: 0 },
  );
  completeConstructor(world, placed.building);
  const station = world.buildings.find(building => building.type === STATION_TYPE);
  builder.job = null;
  builder.state = 'idle';

  forceCommanderThink(commander);

  assert.equal(commander.railway.state, RAILWAY_AI_STATES.INSPECT_STATION);
  assert.ok(commander.railway.inspectedStationIds.includes(station.id));
  assert.equal(builder.job?.kind, 'railway_inspect');
});

test('commander AI repairs damaged rail before expanding the railway', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const commander = new Commander(world, 0, 'low');
  const placed = placeBuilding(world, 0, STATION_CONSTRUCTOR_TYPE, stationSite(townCenter).x, stationSite(townCenter).y, [builder]);
  completeConstructor(world, placed.building);
  const station = world.buildings.find(building => building.type === STATION_TYPE);
  commander.railway.inspectedStationIds.push(station.id);
  const damaged = world.buildings.find(building => building.type === TRACK_TYPE);
  damaged.hp = damaged.maxHp * 0.45;
  builder.job = null;
  builder.state = 'idle';

  forceCommanderThink(commander);

  assert.equal(commander.railway.state, RAILWAY_AI_STATES.MAINTAIN_REPAIR_TRACK);
  assert.equal(builder.job?.kind, 'repair');
  assert.equal(builder.job?.targetId, damaged.id);
});

test('commander AI extends railway with capped connected track and then interacts with the train', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const commander = new Commander(world, 0, 'low');
  const placed = placeBuilding(world, 0, STATION_CONSTRUCTOR_TYPE, stationSite(townCenter).x, stationSite(townCenter).y, [builder]);
  completeConstructor(world, placed.building);
  const station = world.buildings.find(building => building.type === STATION_TYPE);
  commander.railway.inspectedStationIds.push(station.id);
  builder.job = null;
  builder.state = 'idle';

  forceCommanderThink(commander);
  const newTrack = world.buildings.find(building => (
    building.type === TRACK_TYPE && !building.complete
  ));
  assert.ok(newTrack);
  assert.equal(commander.railway.state, RAILWAY_AI_STATES.BUILD_EXTEND_TRACK);
  assert.equal(builder.job?.kind, 'build');
  newTrack.complete = true;
  newTrack.progress = 1;
  newTrack.hp = newTrack.maxHp;

  for (let index = world.buildings.filter(building => building.type === TRACK_TYPE).length;
    index < RAILWAY_AI_CONFIG.minTracksBeforeTrainInteraction; index += 1) {
    const current = world.buildings.filter(building => building.type === TRACK_TYPE)
      .sort((a, b) => b.x - a.x)[0];
    const [, end] = trackEndpoints(current);
    const validation = validatePlacement(world, 0, TRACK_TYPE, end.x + TRACK_LENGTH * 0.5, end.y, {
      rotation: 0,
    });
    const rail = placeBuilding(world, 0, TRACK_TYPE, validation.x, validation.y, [builder], {
      rotation: validation.rotation,
    });
    rail.building.complete = true;
    rail.building.progress = 1;
    rail.building.hp = rail.building.maxHp;
  }
  commander.railway.nextTrackAt = world.time + 100;
  commander.railway.nextTrainInteractionAt = 0;
  builder.job = null;
  builder.state = 'idle';

  forceCommanderThink(commander);

  assert.equal(commander.railway.state, RAILWAY_AI_STATES.INTERACT_WITH_TRAIN);
  assert.equal(builder.job?.kind, 'railway_interact');
});

test('commander AI does not build railway forever after reaching the track cap', () => {
  const { world, townCenter, builder } = makeRailWorld();
  const commander = new Commander(world, 0, 'low');
  const placed = placeBuilding(world, 0, STATION_CONSTRUCTOR_TYPE, stationSite(townCenter).x, stationSite(townCenter).y, [builder]);
  completeConstructor(world, placed.building);
  const station = world.buildings.find(building => building.type === STATION_TYPE);
  commander.railway.inspectedStationIds.push(station.id);

  while (world.buildings.filter(building => building.type === TRACK_TYPE).length < RAILWAY_AI_CONFIG.maxTracks) {
    const index = world.buildings.filter(building => building.type === TRACK_TYPE).length;
    const rail = createBuilding(0, TRACK_TYPE, townCenter.x + 900 + index * TRACK_LENGTH, townCenter.y + 720, true, {
      rotation: 0,
    });
    world.buildings.push(rail);
  }
  const before = world.buildings.length;
  commander.railway.nextTrainInteractionAt = world.time + 100;
  builder.job = null;
  builder.state = 'idle';

  forceCommanderThink(commander);

  assert.equal(world.buildings.length, before);
  assert.equal(commander.railway.state, RAILWAY_AI_STATES.NORMAL_ROUTINE);
});

test('railway AI commander state survives save and resume', () => {
  const { world, townCenter, builder } = makeRailWorld();
  world.sides[1].nation = 'england';
  world.sides[1].resources = { food: 1000, wood: 3000, gold: 3000, stone: 3000 };
  const commander = new Commander(world, 1, 'low');
  const enemyTownCenter = world.buildings.find(building => building.side === 1 && building.type === 'town_center');
  const enemyBuilder = spawnUnit(world, 1, 'villager', enemyTownCenter.x - 95, enemyTownCenter.y + 25);
  const placed = placeBuilding(
    world,
    1,
    STATION_CONSTRUCTOR_TYPE,
    enemyTownCenter.x - 220,
    enemyTownCenter.y + 20,
    [enemyBuilder],
    { rotation: Math.PI },
  );
  completeConstructor(world, placed.building);
  const station = world.buildings.find(building => building.type === STATION_TYPE);
  commander.railway.state = RAILWAY_AI_STATES.INSPECT_STATION;
  commander.railway.inspectedStationIds.push(station.id);
  commander.railway.nextTrackAt = 123;

  const restored = restoreGameSnapshot(createGameSnapshot(
    world,
    commander,
    { x: townCenter.x, y: townCenter.y, zoom: 1, rotation: 0 },
  )).commander;

  assert.equal(restored.railway.state, RAILWAY_AI_STATES.INSPECT_STATION);
  assert.deepEqual(restored.railway.inspectedStationIds, [station.id]);
  assert.equal(restored.railway.nextTrackAt, 123);
});
