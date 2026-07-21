import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const TERRAIN_JPEGS = [
  'country-road.jpg',
  'country-soil.jpg',
  'country-stubble.jpg',
  'country-water.jpg',
  'english-meadow.jpg',
];

function readJpegSize(data) {
  assert.equal(data[0], 0xff);
  assert.equal(data[1], 0xd8);
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = data.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        width: data.readUInt16BE(offset + 7),
        height: data.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG size marker not found');
}

test('landscape material sources retain full-resolution surface detail', async () => {
  for (const filename of TERRAIN_JPEGS) {
    const data = await readFile(new URL(`../assets/terrain/${filename}`, import.meta.url));
    assert.ok(data.byteLength > 200_000, `${filename} unexpectedly lost source detail`);
    assert.deepEqual(readJpegSize(data), { width: 1024, height: 1024 }, filename);
  }
});

test('terrain keeps photographic material detail through inspection zoom', async () => {
  const source = await readFile(new URL('../js/gfx/terrain.js', import.meta.url), 'utf8');

  assert.match(source, /const TERRAIN_SCALE = 1\.5;/);
  assert.match(source, /function setPatternNativeScale\(pattern, scale\)/);
  assert.match(source, /pattern\.setTransform\(new DOMMatrix\(\)\.scaleSelf\(1 \/ scale, 1 \/ scale\)\)/);
  assert.match(source, /paintMeadowTexture\(g, S\)/);
  assert.match(source, /setPatternNativeScale\(pattern, scale\);/);
  assert.match(source, /setPatternNativeScale\(roadPattern, TERRAIN_SCALE\);/);
  assert.equal(
    source.match(/setPatternNativeScale\(waterPattern, TERRAIN_SCALE\);/g)?.length,
    2,
    'both puddle and stream water must retain native source density',
  );
});

test('terrain composition lights the ground before upright scenery', async () => {
  const source = await readFile(new URL('../js/gfx/terrain.js', import.meta.url), 'utf8');
  const build = source.slice(source.lastIndexOf('function buildTerrain()'));

  const meadow = build.indexOf('paintMeadowTexture(g, S)');
  const relief = build.indexOf('paintGrassRelief(g, S)');
  const grass = build.indexOf('paintFlock(g)');
  const litter = build.indexOf('paintGroundLitter(g, 8200)');
  const boardLighting = build.indexOf('paintBoardAO(g, 260, 160, seed + 17)');
  const grain = build.indexOf('paintGrain(g, S)');
  const scenery = build.indexOf('placeWoods(g, road, stream, parcels)');

  for (const layer of [meadow, relief, grass, litter, boardLighting, grain, scenery]) {
    assert.ok(layer >= 0, 'every landscape-detail layer must remain wired into the terrain bake');
  }
  assert.ok(meadow < relief, 'micro-relief must shape the meadow material');
  assert.ok(relief < grass && grass < litter, 'grass depth layers must build from broad to fine');
  assert.ok(litter < boardLighting && boardLighting < grain, 'ground incidents must share the board lighting');
  assert.ok(grain < scenery, 'ground grain must not muddy upright trees and rock facets');
});

test('flock selection follows the local turf-to-straw material field', async () => {
  const source = await readFile(new URL('../js/gfx/terrain.js', import.meta.url), 'utf8');
  const flock = source.slice(source.indexOf('function paintFlock(g)'), source.indexOf('function paintHeroTufts(g, count)'));

  assert.match(flock, /sampleField\(x \+ TILE \* 0\.5, y \+ TILE \* 0\.5\)/);
  assert.match(flock, /field > 0\.74/);
  assert.match(flock, /calmness\(x \+ TILE \* 0\.5, y \+ TILE \* 0\.5\)/);
});
