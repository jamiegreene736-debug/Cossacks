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
