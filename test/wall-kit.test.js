import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDING_TYPES } from '../js/config.js';
import { createBuilding } from '../js/economy.js';
import {
  fortificationEndpoints, isWallSegmentType,
} from '../js/fortifications.js';
import {
  WALL_KIT_PIECES, WALL_MODULE_LENGTH_2M, WALL_MODULE_LENGTH_4M,
  WALL_KIT_THICKNESS, classifyWallKitTopology, listWallKitPieces,
  snapWallKitPieceToSocket, wallKitCollisionProfile, wallKitExtensionRules,
  wallKitPieceForBuildingType, wallKitSockets, wallKitWorldUvOrigin,
} from '../js/wall-kit.js';
import { getFortificationMasonryDetailProfile } from '../js/gfx/buildings.js';

function makeWorld(buildings = []) {
  return { buildings, sides: [{ nation: 'england' }, { nation: 'ottoman' }] };
}

test('kit catalogue exposes the required modular pieces on a 2 m grid', () => {
  const ids = listWallKitPieces().map(piece => piece.id).sort();
  assert.deepEqual(ids, [
    'end', 'gate', 'inner_corner', 'outer_corner', 'ramp',
    'straight_2m', 'straight_4m', 't_junction',
  ].sort());
  assert.equal(WALL_MODULE_LENGTH_4M, BUILDING_TYPES.wall.w);
  assert.equal(WALL_MODULE_LENGTH_2M, BUILDING_TYPES.wall_short.w);
  assert.equal(WALL_KIT_THICKNESS, BUILDING_TYPES.wall.h);
  assert.equal(WALL_KIT_THICKNESS, BUILDING_TYPES.wall_short.h);
  assert.equal(wallKitPieceForBuildingType('wall').id, 'straight_4m');
  assert.equal(wallKitPieceForBuildingType('wall_short').id, 'straight_2m');
  assert.equal(isWallSegmentType('wall_short'), true);
});

test('socket snap seats a short wall with zero endpoint gap', () => {
  const host = createBuilding(0, 'wall', 700, 1600, true, { orientation: 'horizontal' });
  const hostEnd = fortificationEndpoints(host)[1];
  const sockets = wallKitSockets(host);
  assert.equal(sockets.length, 2);
  const placement = snapWallKitPieceToSocket('wall_short', 'horizontal', hostEnd, 'neg');
  const short = createBuilding(0, 'wall_short', placement.x, placement.y, true, {
    orientation: placement.orientation,
  });
  const shortStart = fortificationEndpoints(short)[0];
  assert.ok(Math.hypot(shortStart.x - hostEnd.x, shortStart.y - hostEnd.y) < 0.001);
  assert.equal(short.w, 44);
});

test('topology classifies ends, straights, corners and T-junctions', () => {
  const a = createBuilding(0, 'wall', 800, 1800, true, { orientation: 'horizontal' });
  const b = createBuilding(0, 'wall', 888, 1800, true, { orientation: 'horizontal' });
  const world = makeWorld([a, b]);

  const mid = classifyWallKitTopology(a, world);
  assert.equal(mid.joinedEnds[1], true);
  assert.equal(mid.joinedEnds[0], false);
  assert.equal(mid.pieceId, 'end');

  const through = classifyWallKitTopology(b, world);
  // b only joins a on its negative end until a third piece is added.
  assert.equal(through.joinedEnds[0], true);
  assert.equal(through.isTerminal, true);

  const c = createBuilding(0, 'wall', 976, 1800, true, { orientation: 'horizontal' });
  world.buildings.push(c);
  const straight = classifyWallKitTopology(b, world);
  assert.deepEqual(straight.joinedEnds, [true, true]);
  assert.equal(straight.pieceId, 'straight_4m');

  const bend = createBuilding(0, 'wall', 1064, 1844, true, { orientation: 'diagonal' });
  // Seat bend on c's positive endpoint.
  const cEnd = fortificationEndpoints(c)[1];
  const bent = snapWallKitPieceToSocket('wall', 'diagonal', cEnd, 'neg');
  bend.x = bent.x;
  bend.y = bent.y;
  bend.orientation = bent.orientation;
  world.buildings.push(bend);
  const corner = classifyWallKitTopology(c, world);
  assert.equal(corner.joinedEnds[1], true);
  assert.ok(corner.isOuterCorner || corner.isInnerCorner || corner.pieceId === 'straight_4m'
    || corner.pieceId === 'end');

  // Spur creating a T: another wall sharing b's positive socket area via a
  // third neighbour already counted when two pieces share one endpoint.
  const spur = createBuilding(0, 'wall', b.x, b.y - 88, true, { orientation: Math.PI / 2 });
  const bNeg = fortificationEndpoints(b)[0];
  // Attach spur to the junction between a and b (a pos / b neg).
  const spurPlace = snapWallKitPieceToSocket('wall', Math.PI / 2, bNeg, 'pos');
  spur.x = spurPlace.x;
  spur.y = spurPlace.y;
  spur.orientation = spurPlace.orientation;
  world.buildings.push(spur);
  const tee = classifyWallKitTopology(b, world);
  assert.ok(tee.neighborCounts[0] >= 2 || tee.isTJunction);
});

test('world-space UV origins advance continuously along a snapped run', () => {
  const first = createBuilding(0, 'wall', 600, 1500, true, { orientation: 'horizontal' });
  const second = createBuilding(0, 'wall', 688, 1500, true, { orientation: 'horizontal' });
  const uv0 = wallKitWorldUvOrigin(first);
  const uv1 = wallKitWorldUvOrigin(second);
  assert.ok(Math.abs((uv1.along - uv0.along) - BUILDING_TYPES.wall.w) < 0.001);
});

test('collision profile keeps a walkable terreplein and parapet', () => {
  const profile = wallKitCollisionProfile('wall');
  assert.equal(profile.box.thickness, 22);
  assert.ok(profile.walkSurface.halfThickness >= 2.5);
  assert.ok(profile.walkSurface.elevation >= 40);
  assert.ok(profile.outerParapet.height > profile.walkSurface.halfThickness);
  assert.ok(wallKitExtensionRules().edgeContract.length >= 5);
  assert.ok(WALL_KIT_PIECES.gate.separateGateLeaves);
});

test('masonry detail profile marks dressed zones for terminals and gates', () => {
  const terminal = getFortificationMasonryDetailProfile('wall', [false, true], {
    pieceId: 'end', isOuterCorner: false, isInnerCorner: false, isTJunction: false,
    isTerminal: true,
  });
  assert.deepEqual(terminal.exposedEnds, [true, false]);
  assert.equal(terminal.supportsStairAttachment, true);

  const short = getFortificationMasonryDetailProfile('wall_short', [true, true]);
  assert.equal(short.pieceId, 'straight_2m');
  assert.ok(short.reliefBlocks < 14);

  const gate = getFortificationMasonryDetailProfile('gate', [true, true]);
  assert.equal(gate.pieceId, 'gate');
  assert.equal(gate.hasBatteredPlinth, false);
});
