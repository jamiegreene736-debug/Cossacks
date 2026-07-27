import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

import { Commander } from '../js/ai.js';
import {
  BUILDING_TYPES, NATIONS, PRINTABLE_MODELS, canNationBuildBuilding,
} from '../js/config.js';
import {
  createBuilding, queuePrintedModel, stepEconomy,
} from '../js/economy.js';
import {
  getBuildingPresentation, getBuildingProductionArtSpec,
} from '../js/gfx/buildings.js';
import { PRINTED_MODEL_SPRITES } from '../js/gfx/printed-models.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';
import { createWorld } from '../js/sim.js';

function makeShopWorld() {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.sides[0].resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const shop = createBuilding(0, 'printer_shop', 1100, 1500, true, { rotation: Math.PI / 8 });
  world.buildings.push(shop);
  return { world, shop };
}

test('the 3D Printing Shop is universal, substantial, and uses one production art source', async () => {
  for (const nation of Object.keys(NATIONS)) {
    assert.equal(canNationBuildBuilding(nation, 'printer_shop'), true);
    assert.deepEqual(
      getBuildingProductionArtSpec(nation, 'printer_shop'),
      { key: 'universalPrinterShop' },
    );
  }

  const definition = BUILDING_TYPES.printer_shop;
  assert.equal(definition.printable, true);
  assert.ok(getBuildingPresentation('printer_shop').displayArtWidth > definition.w * 1.5);

  const assetUrl = new URL('../assets/buildings/universal-3d-printing-shop.png', import.meta.url);
  const [metadata, png] = await Promise.all([stat(assetUrl), readFile(assetUrl)]);
  assert.ok(metadata.size > 500_000, 'production art should retain detailed source pixels');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 1000);
  assert.ok(png.readUInt32BE(20) >= 600);
  assert.equal(png[25], 6, 'production PNG should contain true RGBA transparency');
});

test('printed collectibles use a substantial transparent four-frame production atlas', async () => {
  const assetUrl = new URL('../assets/items/printed-collectibles.png', import.meta.url);
  const [metadata, png] = await Promise.all([stat(assetUrl), readFile(assetUrl)]);

  assert.ok(metadata.size > 500_000, 'collectibles should retain detailed production pixels');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 1900);
  assert.ok(png.readUInt32BE(20) >= 750);
  assert.equal(png[25], 6, 'collectible atlas should contain RGBA transparency');
  assert.deepEqual(
    Object.values(PRINTED_MODEL_SPRITES).map(sprite => sprite.frame),
    [0, 1, 2, 3],
  );
  for (const sprite of Object.values(PRINTED_MODEL_SPRITES)) {
    assert.ok(sprite.width >= 44);
    assert.ok(sprite.height >= 54);
  }
});

test('print jobs charge resources, progress in order, and make persistent collectibles', () => {
  const { world, shop } = makeShopWorld();
  const before = { ...world.sides[0].resources };

  assert.equal(queuePrintedModel(world, shop, 'unknown').ok, false);
  assert.equal(queuePrintedModel(world, shop, 'trex').ok, true);
  assert.equal(world.sides[0].resources.wood, before.wood - PRINTABLE_MODELS.trex.cost.wood);
  assert.equal(world.sides[0].resources.gold, before.gold - PRINTABLE_MODELS.trex.cost.gold);
  assert.equal(shop.printQueue.length, 1);

  stepEconomy(world, PRINTABLE_MODELS.trex.printTime + 0.01);

  assert.equal(shop.printQueue.length, 0);
  assert.equal(world.printedModels.length, 1);
  assert.equal(world.printedModels[0].type, 'trex');
  assert.equal(world.printedModels[0].shopId, shop.id);
  assert.ok(Math.hypot(
    world.printedModels[0].x - shop.x,
    world.printedModels[0].y - shop.y,
  ) > shop.radius * 0.8);
});

test('a workshop keeps a bounded twelve-piece outdoor gallery', () => {
  const { world, shop } = makeShopWorld();
  for (let index = 0; index < 13; index++) {
    assert.equal(queuePrintedModel(world, shop, index % 2 ? 'robot' : 'stegosaurus').ok, true);
    stepEconomy(world, 10);
  }
  assert.equal(world.printedModels.length, 12);
  assert.equal(shop.printSequence, 13);
});

test('active print jobs and finished models survive campaign save and resume', () => {
  const { world, shop } = makeShopWorld();
  assert.equal(queuePrintedModel(world, shop, 'rocket').ok, true);
  stepEconomy(world, 1);
  world.printedModels.push({
    id: 987654, entityKind: 'printed_model', type: 'robot', side: 0,
    shopId: shop.id, x: 1120, y: 1580, rotation: 0, createdAt: 0, radius: 18,
  });

  const restored = restoreGameSnapshot(createGameSnapshot(
    world,
    new Commander(world, 1),
    { x: 1100, y: 1500, zoom: 1.5, rotation: 0 },
  )).world;
  const restoredShop = restored.buildings.find(building => building.id === shop.id);

  assert.equal(restoredShop.printQueue.length, 1);
  assert.equal(restoredShop.printQueue[0].type, 'rocket');
  assert.ok(restoredShop.printQueue[0].remaining < PRINTABLE_MODELS.rocket.printTime);
  assert.equal(restored.printedModels.length, 1);
  assert.equal(restored.printedModels[0].shopId, restoredShop.id);
  assert.ok(createBuilding(0, 'house', 1400, 1500, true).id > 987654);
});
