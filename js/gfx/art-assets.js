// Shared production-art registry. Buildings, civilians, natural-resource
// clusters, terrain accents and military units use pre-rendered sources; every
// consumer still bakes them into its own one-blit runtime cache.

const MILITARY_ART_ROWS = Object.freeze({ england: 0, ottoman: 1 });
const MILITARY_ART_SPECS = Object.freeze({
  musk: Object.freeze({
    key: 'musketeers', file: 'musketeers.webp', columns: 4, rows: 2,
    sourceW: 384, sourceH: 512, w: 44, h: 50, ax: 22, ay: 45.5,
    baseRadiusX: 13, baseRadiusY: 2.8,
  }),
  pike: Object.freeze({
    key: 'partisans', file: 'partisans.webp', columns: 4, rows: 2,
    sourceW: 384, sourceH: 512, w: 44, h: 50, ax: 22, ay: 45.5,
    baseRadiusX: 13, baseRadiusY: 2.8,
  }),
  cav: Object.freeze({
    key: 'cavalry', file: 'cavalry.webp', columns: 4, rows: 2,
    sourceW: 384, sourceH: 512, w: 60, h: 52, ax: 30, ay: 46.5,
    baseRadiusX: 25, baseRadiusY: 3.6,
  }),
  gun: Object.freeze({
    key: 'artillery', file: 'artillery.webp', columns: 2, rows: 2,
    sourceW: 768, sourceH: 512, w: 84, h: 56, ax: 42, ay: 49,
    baseRadiusX: 34, baseRadiusY: 4.2,
  }),
});

const ART_URLS = Object.freeze({
  englishTownCenter: new URL('../../assets/buildings/english-town-center.png', import.meta.url).href,
  englishHouse: new URL('../../assets/buildings/english-house.webp', import.meta.url).href,
  englishMill: new URL('../../assets/buildings/english-mill.webp', import.meta.url).href,
  englishLumberCamp: new URL('../../assets/buildings/english-lumber-camp.webp', import.meta.url).href,
  englishMine: new URL('../../assets/buildings/english-mine.webp', import.meta.url).href,
  englishBarracks: new URL('../../assets/buildings/english-barracks.webp', import.meta.url).href,
  englishStable: new URL('../../assets/buildings/english-stable.webp', import.meta.url).href,
  englishFoundry: new URL('../../assets/buildings/english-foundry.webp', import.meta.url).href,
  englishTower: new URL('../../assets/buildings/english-tower.webp', import.meta.url).href,
  englishConstruction: new URL('../../assets/buildings/english-construction.webp', import.meta.url).href,
  englishFortifications: new URL('../../assets/buildings/english-fortifications.webp', import.meta.url).href,
  englishGateClosed: new URL('../../assets/buildings/english-gate-closed.png', import.meta.url).href,
  englishFortificationConstruction: new URL('../../assets/buildings/english-fortification-construction.webp', import.meta.url).href,
  woodland: new URL('../../assets/resources/woodland.webp', import.meta.url).href,
  berryBushes: new URL('../../assets/resources/berry-bushes.webp', import.meta.url).href,
  stoneOutcrop: new URL('../../assets/resources/stone-outcrop.webp', import.meta.url).href,
  goldOutcrop: new URL('../../assets/resources/gold-outcrop.webp', import.meta.url).href,
  englishMeadow: new URL('../../assets/terrain/english-meadow.jpg', import.meta.url).href,
  countryVegetation: new URL('../../assets/terrain/country-vegetation.webp', import.meta.url).href,
  countryTrees: new URL('../../assets/terrain/country-trees.webp', import.meta.url).href,
  landscapeAccents: new URL('../../assets/terrain/landscape-accents.webp', import.meta.url).href,
  countryRoad: new URL('../../assets/terrain/country-road.jpg', import.meta.url).href,
  countryWater: new URL('../../assets/terrain/country-water.jpg', import.meta.url).href,
  countrySoil: new URL('../../assets/terrain/country-soil.jpg', import.meta.url).href,
  countryStubble: new URL('../../assets/terrain/country-stubble.jpg', import.meta.url).href,
  englishVillager: new URL('../../assets/units/english-villager.webp', import.meta.url).href,
  ottomanVillager: new URL('../../assets/units/ottoman-villager.webp', import.meta.url).href,
  musketeers: new URL('../../assets/units/musketeers.webp', import.meta.url).href,
  partisans: new URL('../../assets/units/partisans.webp', import.meta.url).href,
  cavalry: new URL('../../assets/units/cavalry.webp', import.meta.url).href,
  artillery: new URL('../../assets/units/artillery.webp', import.meta.url).href,
});

const artImages = new Map();
let preloadPromise = null;

function loadArtImage(key, url) {
  return new Promise(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      artImages.set(key, image);
      resolve(true);
    };
    image.onerror = () => {
      console.warn(`Production art could not be loaded (${key}); using the procedural fallback.`);
      resolve(false);
    };
    image.src = url;
  });
}

function preloadProductionArt() {
  if (preloadPromise) return preloadPromise;
  if (typeof Image === 'undefined') return Promise.resolve({ loaded: 0, failed: 0 });

  preloadPromise = Promise.all(
    Object.entries(ART_URLS).map(([key, url]) => loadArtImage(key, url)),
  ).then(results => ({
    loaded: results.filter(Boolean).length,
    failed: results.filter(result => !result).length,
  }));
  return preloadPromise;
}

function getProductionArt(key) {
  return artImages.get(key) || null;
}

export {
  MILITARY_ART_ROWS,
  MILITARY_ART_SPECS,
  preloadProductionArt,
  getProductionArt,
};
