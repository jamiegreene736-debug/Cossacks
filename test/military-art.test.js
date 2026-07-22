import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BUILDING_TYPES, NATIONS } from '../js/config.js';
import {
  getProductionFrameSlice, MILITARY_ART_ROWS, MILITARY_ART_SPECS,
  FACTION_CHARACTER_ART_SPECS,
  VILLAGER_CARRY_ART_SPECS, VILLAGER_COMBAT_ART_SPEC,
  WOMAN_VILLAGER_ART_SPECS, WOMAN_VILLAGER_CANNON_ART_SPEC,
} from '../js/gfx/art-assets.js';

const MILITARY_BUILDINGS = ['barracks', 'stable', 'foundry'];
const CLASSIC_NATIONS = Object.keys(MILITARY_ART_ROWS);

function readLosslessWebpSize(data) {
  assert.equal(data.subarray(12, 16).toString(), 'VP8L');
  assert.equal(data[20], 0x2f, 'invalid VP8L signature');
  return {
    width: 1 + data[21] + ((data[22] & 0x3f) << 8),
    height: 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10),
  };
}

test('every trainable military unit has a production-art sheet', () => {
  const roster = MILITARY_BUILDINGS.flatMap(type => BUILDING_TYPES[type].trains);
  assert.deepEqual([...new Set(roster)].sort(), Object.keys(MILITARY_ART_SPECS).sort());

  for (const type of roster) {
    const spec = MILITARY_ART_SPECS[type];
    assert.equal(spec.ax, spec.w / 2, `${type} must mirror around the visual centre`);
    assert.ok(spec.ay > 0 && spec.ay < spec.h, `${type} needs an in-frame ground anchor`);
    assert.ok(spec.baseRadiusX > 0 && spec.baseRadiusX <= spec.w / 2);
    assert.ok(spec.baseRadiusY > 0 && spec.baseRadiusY < spec.h - spec.ay + 1);
    assert.ok(spec.columns >= (type === 'gun' ? 2 : 4));
    assert.equal(spec.rows, CLASSIC_NATIONS.length);
  }
});

test('each nation addresses a unique in-range military-art row', () => {
  const nationKeys = CLASSIC_NATIONS;
  assert.deepEqual(Object.keys(MILITARY_ART_ROWS).sort(), nationKeys.sort());
  assert.equal(new Set(Object.values(MILITARY_ART_ROWS)).size, nationKeys.length);

  for (const row of Object.values(MILITARY_ART_ROWS)) {
    for (const spec of Object.values(MILITARY_ART_SPECS)) {
      assert.ok(row >= 0 && row < spec.rows);
    }
  }
});

test('each detailed military pose has an isolated, in-range source bound', () => {
  for (const [type, spec] of Object.entries(MILITARY_ART_SPECS)) {
    if (!spec.frameXBounds) continue;

    for (const nationKey of CLASSIC_NATIONS) {
      const bounds = spec.frameXBounds[nationKey];
      assert.equal(bounds.length, spec.columns, `${type}/${nationKey} needs every pose bounded`);

      for (let frame = 0; frame < bounds.length; frame++) {
        const [sourceX, sourceEndX] = bounds[frame];
        assert.ok(sourceX >= 0 && sourceX < sourceEndX, `${type}/${nationKey}/${frame} has invalid bounds`);
        assert.ok(sourceEndX <= spec.sourceW * spec.columns, `${type}/${nationKey}/${frame} exceeds its sheet`);

        const cellCenter = (frame + 0.5) * spec.sourceW;
        assert.ok(
          sourceX < cellCenter && sourceEndX > cellCenter,
          `${type}/${nationKey}/${frame} must still target its own grid cell`,
        );
      }
    }
  }
});

test('isolated production poses are centered without enlarging their source scale', () => {
  const spec = MILITARY_ART_SPECS.musk;
  const slice = getProductionFrameSlice(spec.sourceW, 2, spec.frameXBounds.england, spec.w);

  assert.equal(slice.sourceX, 837);
  assert.equal(slice.sourceW, 196);
  assert.equal(slice.destW, spec.w * (196 / spec.sourceW));
  assert.equal(slice.destX, (spec.w - slice.destW) / 2);
  assert.ok(slice.destX > 0, 'the detached neighboring attack pose must not fill the march frame');

  assert.deepEqual(getProductionFrameSlice(384, 2, undefined, 44), {
    sourceX: 768,
    sourceW: 384,
    destX: 0,
    destW: 44,
  });
});

test('military art assets are checked-in WebP files with substantial source detail', async () => {
  for (const spec of Object.values(MILITARY_ART_SPECS)) {
    const assetUrl = new URL(`../assets/units/${spec.file}`, import.meta.url);
    const data = await readFile(assetUrl);
    assert.equal(data.subarray(0, 4).toString(), 'RIFF', spec.file);
    assert.equal(data.subarray(8, 12).toString(), 'WEBP', spec.file);
    assert.ok(data.byteLength > 100_000, `${spec.file} unexpectedly lost its source detail`);
    assert.deepEqual(readLosslessWebpSize(data), {
      width: spec.sourceW * spec.columns,
      height: spec.sourceH * spec.rows,
    });
  }
});

test('foot and mounted troops have lossless six-pose walk sheets', async () => {
  for (const [type, spec] of Object.entries(MILITARY_ART_SPECS)) {
    if (type === 'gun') continue;
    const walk = spec.walk;
    assert.equal(walk.columns, 6, `${type} needs a complete six-pose cycle`);
    assert.equal(walk.rows, CLASSIC_NATIONS.length);

    const data = await readFile(new URL(`../assets/units/${walk.file}`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF', walk.file);
    assert.equal(data.subarray(8, 12).toString(), 'WEBP', walk.file);
    assert.ok(data.byteLength > 500_000, `${walk.file} unexpectedly lost its source detail`);
    assert.deepEqual(readLosslessWebpSize(data), {
      width: walk.sourceW * walk.columns,
      height: walk.sourceH * walk.rows,
    });
  }
});

test('procedural fallbacks retain nation-specific headgear', () => {
  assert.equal(NATIONS.england.headgear, 'tricorn');
  assert.equal(NATIONS.ottoman.headgear, 'turban');
});

test('civilian musket poses provide a detailed nation-specific production sheet', async () => {
  const spec = VILLAGER_COMBAT_ART_SPEC;
  assert.equal(spec.columns, 4, 'ready, advance, fire and reload poses are all required');
  assert.equal(spec.rows, CLASSIC_NATIONS.length);
  const data = await readFile(new URL(`../assets/units/${spec.file}`, import.meta.url));
  assert.equal(data.subarray(0, 4).toString(), 'RIFF');
  assert.equal(data.subarray(8, 12).toString(), 'WEBP');
  assert.ok(data.byteLength > 300_000, 'civilian musket art unexpectedly lost source detail');
  assert.deepEqual(readLosslessWebpSize(data), {
    width: spec.sourceW * spec.columns,
    height: spec.sourceH * spec.rows,
  });
});

test('each nation has detailed firewood and resource carrying walk cycles', async () => {
  assert.deepEqual(Object.keys(VILLAGER_CARRY_ART_SPECS).sort(), [...CLASSIC_NATIONS].sort());

  for (const [nationKey, spec] of Object.entries(VILLAGER_CARRY_ART_SPECS)) {
    assert.equal(spec.columns, 4, `${nationKey} needs a complete four-pose carry cycle`);
    assert.equal(spec.rows, 2, `${nationKey} needs firewood and general-resource rows`);
    const data = await readFile(new URL(`../assets/units/${spec.file}`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF', spec.file);
    assert.equal(data.subarray(8, 12).toString(), 'WEBP', spec.file);
    assert.ok(data.byteLength > 500_000, `${spec.file} unexpectedly lost its source detail`);
    assert.deepEqual(readLosslessWebpSize(data), {
      width: spec.sourceW * spec.columns,
      height: spec.sourceH * spec.rows,
    });
  }
});

test('each nation has detailed woman worker poses and a complete cannon sequence', async () => {
  assert.deepEqual(Object.keys(WOMAN_VILLAGER_ART_SPECS).sort(), [...CLASSIC_NATIONS].sort());

  for (const [nationKey, spec] of Object.entries(WOMAN_VILLAGER_ART_SPECS)) {
    assert.equal(spec.columns, 4, `${nationKey} needs idle, walk and construction poses`);
    assert.equal(spec.rows, 1);
    const data = await readFile(new URL(`../assets/units/${spec.file}`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF', spec.file);
    assert.equal(data.subarray(8, 12).toString(), 'WEBP', spec.file);
    assert.ok(data.byteLength > 200_000, `${spec.file} unexpectedly lost its source detail`);
    assert.deepEqual(readLosslessWebpSize(data), {
      width: spec.sourceW * spec.columns,
      height: spec.sourceH,
    });
  }

  const cannon = WOMAN_VILLAGER_CANNON_ART_SPEC;
  assert.equal(cannon.columns, 4, 'deploy, aim, fire and reload poses are all required');
  assert.equal(cannon.rows, CLASSIC_NATIONS.length);
  const data = await readFile(new URL(`../assets/units/${cannon.file}`, import.meta.url));
  assert.ok(data.byteLength > 700_000, 'cannon art unexpectedly lost its source detail');
  assert.deepEqual(readLosslessWebpSize(data), {
    width: cannon.sourceW * cannon.columns,
    height: cannon.sourceH * cannon.rows,
  });
});

test('fantasy factions use dedicated complete character sheets instead of historical rows', async () => {
  const expectedRows = { hogwarts: 3, starwars: 6, nightmare_circus: 5 };
  for (const [nation, spec] of Object.entries(FACTION_CHARACTER_ART_SPECS)) {
    assert.equal(spec.columns, 4);
    assert.equal(spec.rows, expectedRows[nation]);
    assert.ok(Object.keys(spec.unitRows).length >= 5);
    assert.ok(Object.values(spec.unitRows).every(row => row >= 0 && row < spec.rows));
    const data = await readFile(new URL(`../assets/units/${spec.file}`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF', spec.file);
    assert.equal(data.subarray(8, 12).toString(), 'WEBP', spec.file);
    assert.ok(data.byteLength > 400_000, `${spec.file} should retain detailed character art`);
    assert.deepEqual(readLosslessWebpSize(data), {
      width: spec.sourceW * spec.columns,
      height: spec.sourceH * spec.rows,
    });
  }
});
