import test from 'node:test';
import assert from 'node:assert/strict';

import { Commander } from '../js/ai.js';
import { createWorld } from '../js/sim.js';
import {
  FOOD_RESOURCE_VARIANTS,
  WOOD_RESOURCE_VARIANTS,
  createResourceVisualLayout,
  cycleResourceVisualVariant,
  getResourceVisualProfile,
  resourceVisualVariant,
} from '../js/resource-visuals.js';
import { createGameSnapshot, restoreGameSnapshot } from '../js/savegame.js';

test('every natural food and wood node has one coherent visual identity', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const organic = world.resources.filter(resource => (
    resource.resourceType === 'food' || resource.resourceType === 'wood'
  ));

  assert.ok(organic.length > 0);
  for (const resource of organic) {
    const variant = resourceVisualVariant(resource);
    const profile = getResourceVisualProfile(resource);
    const allowed = resource.resourceType === 'wood'
      ? WOOD_RESOURCE_VARIANTS : FOOD_RESOURCE_VARIANTS;
    assert.ok(allowed.includes(variant), `${variant} must belong to ${resource.resourceType}`);
    assert.equal(profile.type, resource.resourceType);
  }
});

test('the world contains separate oak, birch, pine, berry, and orchard sources', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const variants = new Set(world.resources.map(resourceVisualVariant).filter(Boolean));
  for (const variant of [...WOOD_RESOURCE_VARIANTS, ...FOOD_RESOURCE_VARIANTS]) {
    assert.ok(variants.has(variant), `${variant} is missing from the world`);
  }
});

test('resource layouts are deterministic and species profiles never mix tree frames', () => {
  for (let index = 0; index < WOOD_RESOURCE_VARIANTS.length; index++) {
    const resource = {
      id: 9000 + index,
      type: 'wood',
      resourceType: 'wood',
      visualVariant: cycleResourceVisualVariant('wood', index),
      radius: 82,
      seed: 91.25 + index,
    };
    const first = createResourceVisualLayout(resource);
    assert.deepEqual(createResourceVisualLayout(resource), first);
    assert.equal(first.length, getResourceVisualProfile(resource).treeCount);
    assert.ok(first.every(tree => Math.hypot(tree.x, tree.y) < resource.radius));
    assert.ok(first.every(tree => Math.abs(tree.x) < resource.radius * 0.86));
  }
});

test('opening food sites and woods keep separate gameplay footprints', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  for (const side of world.sides) {
    const nearby = world.resources.filter(resource => (
      (resource.resourceType === 'food' || resource.resourceType === 'wood')
      && Math.hypot(resource.x - side.startPosition.x, resource.y - side.startPosition.y) < 650
    ));
    for (let left = 0; left < nearby.length; left++) {
      for (let right = left + 1; right < nearby.length; right++) {
        const a = nearby[left], b = nearby[right];
        assert.ok(
          Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius,
          `${a.visualVariant} overlaps ${b.visualVariant}`,
        );
      }
    }
  }
});

test('resource visual identities survive save and resume', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });
  const commanders = world.sides.slice(1).map(
    (_side, index) => new Commander(world, index + 1, world.difficulty),
  );
  const snapshot = createGameSnapshot(world, commanders, { x: 660, y: 1600, zoom: 0.9 });
  const restored = restoreGameSnapshot(snapshot).world;
  assert.deepEqual(
    restored.resources.map(resource => resource.visualVariant),
    world.resources.map(resource => resource.visualVariant),
  );
});
