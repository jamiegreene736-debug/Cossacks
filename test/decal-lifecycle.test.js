import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, damage, spawnUnit } from '../js/sim.js';
import {
  CORPSE_DECAL_FADE_SECONDS,
  CORPSE_DECAL_LIFETIME_SECONDS,
  corpseDecalTiming,
  decalOpacity,
  isDecalExpired,
} from '../js/gfx/decals.js';

test('unit death queues a timed corpse decal on the battlefield floor', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  world.time = 31.5;
  const villager = spawnUnit(world, 1, 'villager', 930, 1500);

  damage(world, villager, villager.hp + 1);

  const corpse = world.pendingDecals.find(decal => decal.kind === 'corpse');
  assert.ok(corpse);
  assert.equal(corpse.type, 'villager');
  assert.equal(corpse.side, villager.side);
  assert.equal(corpse.bornAt, world.time);
  assert.equal(corpse.fadeAt, world.time + CORPSE_DECAL_LIFETIME_SECONDS - CORPSE_DECAL_FADE_SECONDS);
  assert.equal(corpse.expiresAt, world.time + CORPSE_DECAL_LIFETIME_SECONDS);
  assert.equal(decalOpacity(corpse, corpse.fadeAt - 1), 1);
  assert.equal(isDecalExpired(corpse, corpse.expiresAt), true);
});

test('corpse decal opacity fades only during the final lifetime window', () => {
  const corpse = { kind: 'corpse', ...corpseDecalTiming(10) };

  assert.equal(decalOpacity(corpse, 10), 1);
  assert.equal(decalOpacity(corpse, corpse.fadeAt), 1);
  assert.equal(decalOpacity(corpse, corpse.expiresAt), 0);
  assert.equal(decalOpacity(corpse, corpse.fadeAt + CORPSE_DECAL_FADE_SECONDS / 2), 0.5);
  assert.equal(isDecalExpired(corpse, corpse.expiresAt - 0.01), false);
  assert.equal(isDecalExpired(corpse, corpse.expiresAt), true);
});
