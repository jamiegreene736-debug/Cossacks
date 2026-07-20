// Shared production-art registry. Buildings, civilians, natural-resource
// clusters and terrain accents use pre-rendered sources; every consumer still
// bakes them into its own one-blit runtime cache.

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

export { preloadProductionArt, getProductionArt };
