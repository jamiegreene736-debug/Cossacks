import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

import { BUILDING_TYPES } from '../js/config.js';
import {
  bdConstructionArtFrame, BUILDING_HUMAN_REFERENCE_HEIGHT,
  getBuildingConstructionArtWidth, getBuildingPresentation, getFortificationConstructionStage,
  getFortificationMasonryDetailProfile, getFortificationRenderProfile,
  getProductionBuildingVisibleSize, usesFixedFortificationFrameArt,
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
  assert.ok(width('tower') < width('house') * 1.2);
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

test('Hogwarts and StarWars buildings use role-specific presentation scale', () => {
  for (const nation of ['hogwarts', 'starwars']) {
    const townCenter = getBuildingPresentation('town_center', undefined, nation);
    const castle = getBuildingPresentation('castle', undefined, nation);
    const house = getBuildingPresentation('house', undefined, nation);
    const tower = getBuildingPresentation('tower', undefined, nation);
    const defaultTownCenter = getBuildingPresentation('town_center');
    const defaultTower = getBuildingPresentation('tower');

    assert.ok(townCenter.visualScale < defaultTownCenter.visualScale);
    assert.ok(townCenter.displayArtWidth < defaultTownCenter.displayArtWidth);
    assert.ok(townCenter.displayArtWidth > house.displayArtWidth * 2);
    assert.ok(castle.displayArtWidth > townCenter.displayArtWidth);
    assert.equal(tower.visualScale, defaultTower.visualScale);
    assert.ok(tower.visualScale > house.visualScale);
  }
});

test('themed production silhouettes preserve human-readable architectural proportions', () => {
  const hogwarts = {
    house: getProductionBuildingVisibleSize('house', 'hogwarts', 335, 424),
    tower: getProductionBuildingVisibleSize('tower', 'hogwarts', 378, 465),
    townCenter: getProductionBuildingVisibleSize('town_center', 'hogwarts', 531, 705),
    stable: getProductionBuildingVisibleSize('stable', 'hogwarts', 380, 451),
    castle: getProductionBuildingVisibleSize('castle', 'hogwarts', 384, 483),
  };
  const starwars = {
    house: getProductionBuildingVisibleSize('house', 'starwars', 720, 560),
    tower: getProductionBuildingVisibleSize('tower', 'starwars', 720, 560),
    townCenter: getProductionBuildingVisibleSize('town_center', 'starwars', 720, 560),
    stable: getProductionBuildingVisibleSize('stable', 'starwars', 720, 560),
    castle: getProductionBuildingVisibleSize('castle', 'starwars', 720, 560),
  };

  for (const [nation, sizes] of Object.entries({ hogwarts, starwars })) {
    assert.ok(sizes.house.height >= 85, `${nation} housing should exceed a human-scale unit`);
    assert.ok(sizes.tower.height > sizes.house.height * 1.1, `${nation} tower should rise above housing`);
    assert.ok(sizes.stable.width > sizes.house.width * 1.5, `${nation} stable should span more than housing`);
    assert.ok(sizes.townCenter.width > sizes.stable.width * 1.05, `${nation} civic core should dominate a stable`);
    assert.ok(sizes.castle.width > sizes.townCenter.width * 1.55, `${nation} fortress should dominate the civic core`);
  }
});

test('production buildings enforce role-based human height floors across every faction', () => {
  const smallestFactionBuildings = [
    ['england', 'house', 1024, 1024],
    ['ottoman', 'house', 1278, 1230],
    ['hogwarts', 'house', 335, 424],
    ['starwars', 'house', 720, 560],
    ['nightmare_circus', 'house', 350, 439],
    ['hogwarts', 'tower', 378, 465],
    ['starwars', 'barracks', 720, 560],
    ['nightmare_circus', 'barracks', 391, 437],
    ['hogwarts', 'castle', 768, 1024],
    ['nightmare_circus', 'castle', 380, 461],
  ];

  for (const [nation, type, naturalWidth, naturalHeight] of smallestFactionBuildings) {
    const presentation = getBuildingPresentation(type, undefined, nation);
    const visible = getProductionBuildingVisibleSize(type, nation, naturalWidth, naturalHeight);
    assert.ok(
      visible.height >= presentation.minimumDisplayHeight,
      `${nation} ${type} should stand at least ${presentation.minimumHumanHeights} people high`,
    );
    assert.ok(
      visible.humanHeightRatio >= presentation.minimumHumanHeights,
      `${nation} ${type} should report its enforced human-height ratio`,
    );
    assert.equal(
      presentation.minimumDisplayHeight,
      presentation.minimumHumanHeights * BUILDING_HUMAN_REFERENCE_HEIGHT,
    );
  }
});

test('StarWars village buildings stay proportional to human-scale soldiers', () => {
  const expectedHumanHeights = {
    town_center: 5.55,
    house: 3.45,
    mill: 3.55,
    lumber_camp: 3.55,
    mine: 3.55,
    barracks: 4.15,
    stable: 4.15,
    foundry: 4.25,
    tower: 5.15,
    castle: 8.60,
  };

  for (const [type, minimumHumanHeights] of Object.entries(expectedHumanHeights)) {
    const presentation = getBuildingPresentation(type, undefined, 'starwars');
    const visible = getProductionBuildingVisibleSize(type, 'starwars', 720, 560);

    assert.equal(presentation.minimumHumanHeights, minimumHumanHeights);
    assert.ok(
      visible.humanHeightRatio >= minimumHumanHeights - 0.001,
      `starwars ${type} should keep soldiers visibly smaller than the building`,
    );
  }

  const house = getProductionBuildingVisibleSize('house', 'starwars', 720, 560);
  const barracks = getProductionBuildingVisibleSize('barracks', 'starwars', 720, 560);
  const townCenter = getProductionBuildingVisibleSize('town_center', 'starwars', 720, 560);
  assert.ok(house.height > BUILDING_HUMAN_REFERENCE_HEIGHT * 3.4);
  assert.ok(barracks.height > house.height * 1.15);
  assert.ok(townCenter.height > barracks.height * 1.20);
});

test('construction art uses the completed building geometry instead of a fixed global minimum', () => {
  const cases = [
    ['england', 'house', 1024, 1024],
    ['hogwarts', 'tower', 378, 465],
    ['starwars', 'house', 720, 560],
    ['nightmare_circus', 'barracks', 391, 437],
  ];

  for (const [nation, type, naturalWidth, naturalHeight] of cases) {
    const presentation = getBuildingPresentation(type, undefined, nation);
    const visible = getProductionBuildingVisibleSize(type, nation, naturalWidth, naturalHeight);
    const constructionDisplayWidth = getBuildingConstructionArtWidth(
      type,
      nation,
      naturalWidth,
      naturalHeight,
    ) * presentation.visualScale;
    assert.ok(
      constructionDisplayWidth >= visible.width,
      `${nation} ${type} construction should cover the finished silhouette`,
    );
    assert.ok(
      constructionDisplayWidth <= visible.width * 1.16,
      `${nation} ${type} construction should not dwarf its finished silhouette`,
    );
  }
});

test('StarWars source trimming removes authored transparent-canvas scale drift', () => {
  const tower = getProductionBuildingVisibleSize('tower', 'starwars', 720, 560);
  const house = getProductionBuildingVisibleSize('house', 'starwars', 720, 560);
  const castle = getProductionBuildingVisibleSize('castle', 'starwars', 720, 560);

  assert.deepEqual(tower.sourceRect, { x: 220, y: 48, width: 280, height: 512 });
  assert.ok(tower.sourceRect.width < house.sourceRect.width);
  assert.ok(castle.sourceRect.width > house.sourceRect.width);
  assert.ok(tower.height > 220);
});

test('Hogwarts castle source trimming preserves the full masonry without empty headroom', () => {
  const castle = getProductionBuildingVisibleSize('castle', 'hogwarts', 768, 1024);

  assert.deepEqual(castle.sourceRect, { x: 28, y: 482, width: 712, height: 514 });
  assert.ok(castle.width > 360, 'trimmed castle should keep the same detailed broad silhouette');
  assert.ok(castle.height < 275, 'transparent source headroom should not push the castle into the HUD');
  assert.ok(castle.height > castle.minimumDisplayHeight, 'trimmed castle still reads as monumental');
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
    interiorSide: 1,
  });
  assert.deepEqual(getFortificationRenderProfile(right, world), {
    joinedEnds: [true, false],
    useProductionFrame: false,
    interiorSide: 1,
  });
  assert.equal(getFortificationRenderProfile(left, { buildings: [left] }).useProductionFrame, false);
  assert.equal(getFortificationRenderProfile(left, {
    buildings: [left],
    sides: [{ nation: 'ottoman' }],
  }).useProductionFrame, true);
});

test('detailed wall masonry keeps curved, gate and stair attachment contracts explicit', () => {
  const openRun = getFortificationMasonryDetailProfile('wall', [false, false]);
  const connectedRun = getFortificationMasonryDetailProfile('wall', [true, false]);
  const gate = getFortificationMasonryDetailProfile('gate');

  assert.equal(openRun.supportsCurvedRuns, true);
  assert.equal(openRun.supportsGateAttachment, true);
  assert.equal(openRun.supportsStairAttachment, true);
  assert.deepEqual(openRun.exposedEnds, [true, true]);
  assert.deepEqual(connectedRun.exposedEnds, [false, true]);
  assert.ok(openRun.reliefBlocks >= 12);
  assert.equal(openRun.hasBatteredPlinth, true);

  assert.equal(gate.supportsGateAttachment, true);
  assert.equal(gate.supportsStairAttachment, false);
  assert.ok(gate.faceCourses > openRun.faceCourses);
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
