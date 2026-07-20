import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDING_TYPES } from '../js/config.js';
import { getBuildingPresentation } from '../js/gfx/buildings.js';

const BUILT_STRUCTURE_TYPES = Object.keys(BUILDING_TYPES).filter(type => type !== 'farm');

test('every completed structure has footprint-derived art and paving metrics', () => {
  for (const type of BUILT_STRUCTURE_TYPES) {
    const def = BUILDING_TYPES[type];
    const presentation = getBuildingPresentation(type);

    assert.ok(presentation, `${type} should have a presentation profile`);
    assert.ok(presentation.artWidth > def.w, `${type} art should include roof overhang`);
    assert.ok(presentation.apronRx >= def.radius, `${type} paving should surround its footprint`);
    assert.ok(presentation.apronRy >= def.h * 0.45, `${type} paving should remain visible in depth`);
  }
});

test('building silhouettes preserve the settlement scale hierarchy', () => {
  const width = type => getBuildingPresentation(type).artWidth;

  assert.ok(width('town_center') > width('stable'));
  assert.ok(width('stable') > width('barracks'));
  assert.ok(width('foundry') > width('barracks'));
  assert.ok(width('stable') > width('mill') * 1.5);
  assert.ok(width('stable') > width('lumber_camp') * 1.5);
  assert.ok(width('barracks') > width('house') * 1.7);
  assert.ok(width('tower') < width('house'));
});
