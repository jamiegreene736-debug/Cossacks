import test from 'node:test';
import assert from 'node:assert/strict';
import { open, stat } from 'node:fs/promises';

import {
  getArchitectureProductionArtSpec,
  getBuildingProductionArtSpec,
} from '../js/gfx/buildings.js';

const OTTOMAN_BUILDING_ART = Object.freeze({
  town_center: ['ottomanTownCenter', 'ottoman-town-center.webp'],
  house: ['ottomanHouse', 'ottoman-house.webp'],
  mill: ['ottomanMill', 'ottoman-mill.webp'],
  lumber_camp: ['ottomanLumberCamp', 'ottoman-lumber-camp.webp'],
  mine: ['ottomanMine', 'ottoman-mine.webp'],
  barracks: ['ottomanBarracks', 'ottoman-barracks.webp'],
  stable: ['ottomanStable', 'ottoman-stable.webp'],
  foundry: ['ottomanFoundry', 'ottoman-foundry.webp'],
  tower: ['ottomanTower', 'ottoman-tower.webp'],
  castle: ['ottomanCastle', 'ottoman-grand-artillery-castle.webp'],
});

const OTTOMAN_SUPPORT_ART = Object.freeze({
  construction: ['ottomanConstruction', 'ottoman-construction.webp'],
  fortifications: ['ottomanFortifications', 'ottoman-fortifications.webp'],
  fortificationConstruction: [
    'ottomanFortificationConstruction',
    'ottoman-fortification-construction.webp',
  ],
  gateClosed: ['ottomanGateClosed', 'ottoman-gate-closed.webp'],
});

async function assertDetailedWebp(filename) {
  const source = new URL(`../assets/buildings/${filename}`, import.meta.url);
  const metadata = await stat(source);
  assert.ok(metadata.size > 350_000, `${filename} should retain high-resolution detail`);

  const handle = await open(source, 'r');
  try {
    const header = Buffer.alloc(12);
    await handle.read(header, 0, header.length, 0);
    assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(header.subarray(8, 12).toString('ascii'), 'WEBP');
  } finally {
    await handle.close();
  }
}

test('every Ottoman completed building selects its own production artwork', async () => {
  for (const [type, [key, filename]] of Object.entries(OTTOMAN_BUILDING_ART)) {
    assert.deepEqual(getBuildingProductionArtSpec('ottoman', type), { key });
    assert.notEqual(getBuildingProductionArtSpec('england', type)?.key, key);
    await assertDetailedWebp(filename);
  }
});

test('Ottoman construction, wall, and gate states never reuse English artwork', async () => {
  const ottoman = getArchitectureProductionArtSpec('ottoman');
  const england = getArchitectureProductionArtSpec('england');

  for (const [state, [key, filename]] of Object.entries(OTTOMAN_SUPPORT_ART)) {
    assert.equal(ottoman[state], key);
    assert.notEqual(england[state], key);
    await assertDetailedWebp(filename);
  }
});
