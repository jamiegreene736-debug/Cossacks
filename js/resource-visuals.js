// Stable visual identities for natural resource nodes. A node represents one
// coherent place in the landscape: one tree species or one cultivated food
// form. This prevents a gatherable cluster from mixing unrelated trees,
// orchard fruit, berry shrubs, grain, and vegetables in the same footprint.

export const WOOD_RESOURCE_VARIANTS = Object.freeze([
  'oak_copse',
  'birch_grove',
  'pine_stand',
]);

export const FOOD_RESOURCE_VARIANTS = Object.freeze([
  'berry_garden',
  'apple_orchard',
]);

const RESOURCE_VISUAL_PROFILES = Object.freeze({
  oak_copse: Object.freeze({
    type: 'wood', label: 'Oak copse', treeFrame: 0, treeCount: 12,
    treeWidth: 1.45, floor: 'leaf_litter',
  }),
  birch_grove: Object.freeze({
    type: 'wood', label: 'Birch grove', treeFrame: 1, treeCount: 14,
    treeWidth: 1.30, floor: 'light_litter',
  }),
  pine_stand: Object.freeze({
    type: 'wood', label: 'Pine stand', treeFrame: 2, treeCount: 13,
    treeWidth: 1.35, floor: 'needle_litter',
  }),
  berry_garden: Object.freeze({
    type: 'food', label: 'Currant and gooseberry garden', crop: 'berries',
  }),
  apple_orchard: Object.freeze({
    type: 'food', label: 'Apple orchard', crop: 'orchard', treeFrame: 0,
    treeCount: 6, treeWidth: 1.35,
  }),
});

function resourceVariants(type) {
  if (type === 'wood') return WOOD_RESOURCE_VARIANTS;
  if (type === 'food') return FOOD_RESOURCE_VARIANTS;
  return [];
}

function stableVariantIndex(resource, count) {
  const seed = Number.isFinite(resource?.seed) ? Math.floor(resource.seed * 1000) : 0;
  const id = Number.isFinite(resource?.id) ? Math.floor(resource.id) : 0;
  const hash = Math.imul(seed ^ id, 2654435761) >>> 0;
  return count ? hash % count : 0;
}

export function resourceVisualVariant(resource) {
  const variants = resourceVariants(resource?.resourceType || resource?.type);
  if (!variants.length) return null;
  if (variants.includes(resource?.visualVariant)) return resource.visualVariant;
  return variants[stableVariantIndex(resource, variants.length)];
}

export function getResourceVisualProfile(resource) {
  const variant = resourceVisualVariant(resource);
  return variant ? RESOURCE_VISUAL_PROFILES[variant] : null;
}

export function cycleResourceVisualVariant(type, index) {
  const variants = resourceVariants(type);
  if (!variants.length) return null;
  const safeIndex = Number.isFinite(index) ? Math.floor(index) : 0;
  return variants[((safeIndex % variants.length) + variants.length) % variants.length];
}

export function createResourceVisualLayout(resource) {
  const profile = getResourceVisualProfile(resource);
  if (!profile || !profile.treeCount) return [];
  const radius = Math.max(24, Number.isFinite(resource.radius) ? resource.radius : 38);

  if (profile.crop === 'orchard') {
    const positions = [
      [-0.75, -0.34], [0, -0.40], [0.75, -0.31],
      [-0.70, 0.22], [0.05, 0.15], [0.72, 0.25],
    ];
    return positions.map(([x, y], index) => ({
      x: x * radius,
      y: y * radius,
      scale: 0.91 + (index % 3) * 0.045,
      flip: index % 2 === 1,
      harvestRank: index,
    }));
  }

  let state = ((Number.isFinite(resource.seed) ? Math.floor(resource.seed * 1000) : 1)
    ^ Math.imul(Number.isFinite(resource.id) ? resource.id : 1, 2246822519)) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const positions = [];
  for (let index = 0; index < profile.treeCount; index++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random());
    positions.push({
      x: Math.cos(angle) * distance * radius * 0.76,
      y: Math.sin(angle) * distance * radius * 0.47,
      scale: 0.82 + random() * 0.34,
      flip: random() > 0.5,
      harvestRank: random(),
    });
  }
  return positions.sort((a, b) => a.y - b.y || a.x - b.x);
}
