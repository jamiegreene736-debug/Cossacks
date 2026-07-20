import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

import { BUILDING_TYPES } from '../js/config.js';
import { bdConstructionArtFrame, getBuildingPresentation } from '../js/gfx/buildings.js';

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

test('production construction art advances continuously through four authored stages', () => {
  assert.deepEqual(bdConstructionArtFrame(-1), { from: 0, to: 1, mix: 0 });
  assert.deepEqual(bdConstructionArtFrame(1), { from: 3, to: 3, mix: 0 });

  const firstHandoff = bdConstructionArtFrame(0.25);
  assert.equal(firstHandoff.from, 1);
  assert.equal(firstHandoff.to, 2);
  assert.equal(firstHandoff.mix, 0);

  const blend = bdConstructionArtFrame(0.49);
  assert.equal(blend.from, 1);
  assert.equal(blend.to, 2);
  assert.ok(blend.mix > 0 && blend.mix < 1);
});

test('the closed gate uses a substantial transparent production render', async () => {
  const url = new URL('../assets/buildings/english-gate-closed.png', import.meta.url);
  const [metadata, header] = await Promise.all([stat(url), readFile(url)]);
  assert.ok(metadata.size > 1_000_000, 'closed-gate source should retain high-resolution masonry detail');
  assert.deepEqual([...header.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(header[25], 6, 'closed-gate source must preserve an RGBA transparency channel');
});
