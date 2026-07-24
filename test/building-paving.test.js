import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILDING_TYPES } from '../js/config.js';
import {
  getBuildingPavingLayout,
  getBuildingPavingStyle,
  getBuildingPresentation,
} from '../js/gfx/buildings.js';

test('building paving is deterministic and forms a complete herringbone courtyard', () => {
  const first = getBuildingPavingLayout(84, 46, 1700);
  const repeated = getBuildingPavingLayout(84, 46, 1700);

  assert.deepEqual(repeated, first);
  assert.ok(first.pavers.length > 120, 'expected a dense field of individual pavers');

  const field = first.pavers.filter((paver) => paver.kind === 'field');
  const border = first.pavers.filter((paver) => paver.kind === 'border');
  assert.equal(border.length, first.borderCount);
  assert.ok(field.some((paver) => paver.angle > 0.70 && paver.angle < 0.88));
  assert.ok(field.some((paver) => paver.angle < -0.70 && paver.angle > -0.88));

  // Tangent header pavers must occupy every quadrant; this is the regression
  // guard against returning to a small entrance patch beneath the building.
  const occupiedQuadrants = new Set(border.map((paver) =>
    `${paver.x < 0 ? 'left' : 'right'}-${paver.y < 0 ? 'rear' : 'front'}`));
  assert.deepEqual(occupiedQuadrants,
    new Set(['left-rear', 'right-rear', 'left-front', 'right-front']));
});

test('weathering remains detailed but moss is sparse', () => {
  const layout = getBuildingPavingLayout(96, 52, 77);
  const mossy = layout.pavers.filter((paver) => paver.moss);
  const chipped = layout.pavers.filter((paver) => paver.chip >= 0);
  const patinated = layout.pavers.filter((paver) => paver.patina);

  assert.ok(mossy.length > 4);
  assert.ok(mossy.length / layout.pavers.length < 0.24);
  assert.ok(chipped.length > mossy.length);
  assert.ok(patinated.length > mossy.length);
  assert.equal(new Set(layout.pavers.map((paver) => paver.tone)).size, 5);
});

test('every ordinary building receives paving beyond its gameplay footprint', () => {
  const pavedTypes = Object.entries(BUILDING_TYPES)
    .filter(([type, definition]) => type !== 'farm' && !definition.fortification);

  for (const [type, definition] of pavedTypes) {
    const presentation = getBuildingPresentation(type, definition);
    const layout = getBuildingPavingLayout(
      presentation.apronRx,
      presentation.apronRy,
      type.length * 1700,
    );

    assert.ok(layout.rx > definition.w * 0.75,
      `${type} paving should extend beyond both side walls`);
    assert.ok(layout.ry > definition.h * 0.5,
      `${type} paving should extend beyond both front and rear walls`);
    assert.ok(layout.borderCount >= 28, `${type} should have a continuous header course`);
  }
});

test('every courtyard shares the building selection footprint centre', () => {
  const pavedTypes = Object.entries(BUILDING_TYPES)
    .filter(([type, definition]) => type !== 'farm' && !definition.fortification);

  for (const [type, definition] of pavedTypes) {
    const presentation = getBuildingPresentation(type, definition);
    assert.equal(
      presentation.pavingCenterY,
      definition.h * 0.22,
      `${type} paving should remain centred beneath its building footprint`,
    );
  }
});

test('StarWars buildings use larger sci-fi paving under their full visual mass', () => {
  assert.equal(getBuildingPavingStyle('starwars'), 'starwars');
  assert.equal(getBuildingPavingStyle('england'), 'brick');

  for (const type of [
    'town_center', 'house', 'mill', 'lumber_camp', 'mine',
    'barracks', 'stable', 'foundry', 'tower', 'castle',
  ]) {
    const def = BUILDING_TYPES[type];
    const normal = getBuildingPresentation(type, def);
    const starwars = getBuildingPresentation(type, def, 'starwars');
    assert.ok(
      starwars.apronRx >= normal.apronRx,
      `${type} StarWars paving should not be narrower than ordinary paving`,
    );
    assert.ok(
      starwars.apronRy >= normal.apronRy,
      `${type} StarWars paving should not be shallower than ordinary paving`,
    );
    assert.ok(
      starwars.apronRx >= starwars.displayArtWidth * 0.58 - 0.001,
      `${type} StarWars paving should reach under the broad rendered facade`,
    );
  }
});
