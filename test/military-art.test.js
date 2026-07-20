import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BUILDING_TYPES, NATIONS } from '../js/config.js';
import { MILITARY_ART_ROWS, MILITARY_ART_SPECS } from '../js/gfx/art-assets.js';

const MILITARY_BUILDINGS = ['barracks', 'stable', 'foundry'];

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
    assert.equal(spec.rows, Object.keys(NATIONS).length);
  }
});

test('each nation addresses a unique in-range military-art row', () => {
  const nationKeys = Object.keys(NATIONS);
  assert.deepEqual(Object.keys(MILITARY_ART_ROWS).sort(), nationKeys.sort());
  assert.equal(new Set(Object.values(MILITARY_ART_ROWS)).size, nationKeys.length);

  for (const row of Object.values(MILITARY_ART_ROWS)) {
    for (const spec of Object.values(MILITARY_ART_SPECS)) {
      assert.ok(row >= 0 && row < spec.rows);
    }
  }
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

test('procedural fallbacks retain nation-specific headgear', () => {
  assert.equal(NATIONS.england.headgear, 'tricorn');
  assert.equal(NATIONS.ottoman.headgear, 'turban');
});
