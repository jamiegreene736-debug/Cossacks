import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('resource trees bake sharp full canopies at close zoom', async () => {
  const source = await readFile(new URL('../js/gfx/buildings.js', import.meta.url), 'utf8');
  const vegetation = source.slice(
    source.indexOf('function bdDrawVegetationFrame'),
    source.indexOf('function bdDrawSoftOrganicStamp'),
  );

  assert.match(source, /const BD_RES_SCALE = 4;/);
  assert.match(source, /function bdDrawSoftSourceRect\(/);
  assert.match(source, /g\.getTransform\(\)/);
  assert.match(
    source,
    /Math\.min\(dw \* bakeScale, sw\)/,
    'berry soft stamps must rasterize at bake density, capped by source texels',
  );
  assert.match(vegetation, /g\.drawImage\(/);
  assert.doesNotMatch(
    vegetation,
    /bdDrawSoftSourceRect|bdVegetationFramePath|g\.clip\(\)/,
    'tree frames must keep their authored alpha silhouette, not a teardrop clip',
  );
  assert.match(
    source,
    /radius \* 2\.15 \+ 64/,
    'organic resource bake boxes must fit full tree crowns',
  );
});

test('terrain country vegetation keeps full authored tree frames', async () => {
  const source = await readFile(new URL('../js/gfx/terrain.js', import.meta.url), 'utf8');
  const vegetation = source.slice(
    source.indexOf('function drawCountryVegetation'),
    source.indexOf('function fillProductionMaterial'),
  );

  assert.match(vegetation, /g\.drawImage\(/);
  assert.doesNotMatch(
    vegetation,
    /countryVegetationFramePath|g\.clip\(\)/,
    'scenery trees must not be clipped to a teardrop path',
  );
});

test('country tree sheet keeps full-resolution vegetation cells', async () => {
  const data = await readFile(
    new URL('../assets/terrain/country-trees.webp', import.meta.url),
  );
  assert.ok(data.byteLength > 200_000, 'country-trees.webp unexpectedly lost source detail');
  assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(data.subarray(8, 12).toString('ascii'), 'WEBP');

  // VP8X canvas size lives at bytes 24..29 as 24-bit little-endian values
  // minus one. The sheet is four 512px tree frames side by side.
  assert.equal(data.subarray(12, 16).toString('ascii'), 'VP8X');
  const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
  const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
  assert.deepEqual({ width, height }, { width: 2048, height: 512 });
});
