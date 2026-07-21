import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

import { BUILDING_TYPES } from '../js/config.js';
import {
  bdConstructionArtFrame, getBuildingPresentation, getFortificationConstructionStage,
  getFortificationRenderProfile,
  usesFixedFortificationFrameArt,
} from '../js/gfx/buildings.js';
import { MILITARY_ART_SPECS } from '../js/gfx/art-assets.js';

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
  const width = type => getBuildingPresentation(type).displayArtWidth;

  assert.ok(width('town_center') > width('stable'));
  assert.ok(width('stable') > width('barracks'));
  assert.ok(width('foundry') > width('barracks'));
  assert.ok(width('stable') > width('mill') * 1.5);
  assert.ok(width('stable') > width('lumber_camp') * 1.5);
  assert.ok(width('barracks') > width('house') * 1.7);
  assert.ok(width('tower') < width('house'));
  assert.ok(width('gate') > width('wall'));
});

test('displayed architecture remains decisively larger than human-scale units', () => {
  const infantryWidth = Math.max(MILITARY_ART_SPECS.musk.w, MILITARY_ART_SPECS.pike.w);
  const architecturalTypes = BUILT_STRUCTURE_TYPES.filter(type => type !== 'wall_stairs');

  for (const type of architecturalTypes) {
    const presentation = getBuildingPresentation(type);
    assert.ok(
      presentation.displayArtWidth >= infantryWidth * 2,
      `${type} should read at no less than twice an infantryman's width`,
    );
    assert.ok(presentation.visualScale >= 1.25, `${type} should use the architectural scale tier`);
  }

  assert.ok(BUILDING_TYPES.town_center.visualScale > BUILDING_TYPES.house.visualScale);
  assert.ok(BUILDING_TYPES.wall.visualScale > BUILDING_TYPES.barracks.visualScale);
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

test('wall construction starts as a surveyed trench before masonry and scaffold rise', () => {
  assert.deepEqual(getFortificationConstructionStage(0), {
    length: 0, height: 0, scaffold: 0, crown: 0,
  });

  const footing = getFortificationConstructionStage(0.10);
  assert.ok(footing.length > 0 && footing.length < 0.5);
  assert.equal(footing.height, 0);
  assert.ok(footing.scaffold > 0 && footing.scaffold < 0.2);

  const masonry = getFortificationConstructionStage(0.50);
  assert.equal(masonry.length, 1);
  assert.ok(masonry.height > 0.5 && masonry.height < 0.6);
  assert.equal(masonry.scaffold, 1);
  assert.equal(masonry.crown, 0);

  assert.deepEqual(getFortificationConstructionStage(1), {
    length: 1, height: 1, scaffold: 1, crown: 1,
  });
});

test('freehand walls bypass fixed frames while snapped orientations can use them', () => {
  assert.equal(usesFixedFortificationFrameArt({ orientation: 'horizontal' }), true);
  assert.equal(usesFixedFortificationFrameArt({ orientation: 'diagonal' }), true);
  assert.equal(usesFixedFortificationFrameArt({ orientation: 0 }), false);
  assert.equal(usesFixedFortificationFrameArt({ orientation: Math.PI / 7 }), false);
});

test('connected wall frames expose only the two ends of the complete run', () => {
  const left = {
    type: 'wall', x: 0, y: 0, orientation: 'horizontal',
    side: 0, alive: true, complete: true,
  };
  const right = {
    ...left, x: BUILDING_TYPES.wall.w,
  };
  const world = { buildings: [left, right] };

  assert.deepEqual(getFortificationRenderProfile(left, world), {
    joinedEnds: [false, true],
    useProductionFrame: false,
  });
  assert.deepEqual(getFortificationRenderProfile(right, world), {
    joinedEnds: [true, false],
    useProductionFrame: false,
  });
  assert.equal(getFortificationRenderProfile(left, { buildings: [left] }).useProductionFrame, true);
});

test('the closed gate uses a substantial transparent production render', async () => {
  const url = new URL('../assets/buildings/english-gate-closed.png', import.meta.url);
  const [metadata, header] = await Promise.all([stat(url), readFile(url)]);
  assert.ok(metadata.size > 1_000_000, 'closed-gate source should retain high-resolution masonry detail');
  assert.deepEqual([...header.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(header[25], 6, 'closed-gate source must preserve an RGBA transparency channel');
});

test('curved walls use a substantial high-resolution masonry material', async () => {
  const sources = [
    ['fortification-masonry.webp', 500_000],
    ['fortification-walkway.webp', 450_000],
  ];
  for (const [file, minimumBytes] of sources) {
    const url = new URL(`../assets/buildings/${file}`, import.meta.url);
    const [metadata, header] = await Promise.all([stat(url), readFile(url)]);
    assert.ok(metadata.size > minimumBytes, `${file} should retain weathered source detail`);
    assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(header.subarray(8, 12).toString('ascii'), 'WEBP');
  }
});
