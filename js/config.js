// Static game data for the 18th-century settlement skirmish.

export const WORLD = { w: 5200, h: 3200 };
export const SIM_STEP = 1 / 30;
export const MAX_POPULATION = 1200;

export const RESOURCE_KEYS = ['food', 'wood', 'gold', 'stone'];
export const STARTING_RESOURCES = { food: 240, wood: 320, gold: 120, stone: 120 };

// Difficulty changes the rival commander's decisions, never combat stats or
// starting resources. Hard intentionally preserves the original single-mode
// policy so existing simulations and legacy saves keep their former pressure.
export const DEFAULT_CPU_DIFFICULTY = 'hard';
export const CPU_DIFFICULTIES = {
  low: {
    name: 'Low',
    summary: 'A patient rival with a smaller economy and lighter attacks.',
    ai: {
      planningInterval: 1.75,
      villagerTarget: 14,
      villagerQueueLimit: 1,
      builderCount: 2,
      houseBuffer: 12,
      houseLimit: 20,
      farmWorkerRatio: 5,
      towerLimit: 1,
      buildAt: {
        lumber_camp: 4, mill: 6, barracks: 8, mine: 10,
        stable: 12, foundry: 14, tower: 14, castle: 14,
      },
      productionQueueLimit: 4,
      productionBatch: { barracks: 3, stable: 2, foundry: 1 },
      cavalryFallbackTime: 320,
      firstAttackDelay: 160,
      defenseRadius: 560,
      defenseLimit: 60,
      earlyWaveUntil: 270,
      earlyWaveMinimum: 14,
      lateWaveMinimum: 24,
      waveFraction: 0.55,
      maxWaveSize: 100,
      waveRetryDelay: 20,
      earlyAttackInterval: 76,
      lateAttackInterval: 60,
      stagingDelay: 11,
    },
  },
  medium: {
    name: 'Medium',
    summary: 'A balanced rival that expands steadily and attacks in measured waves.',
    ai: {
      planningInterval: 1.25,
      villagerTarget: 18,
      villagerQueueLimit: 2,
      builderCount: 3,
      houseBuffer: 15,
      houseLimit: 24,
      farmWorkerRatio: 4,
      towerLimit: 2,
      buildAt: {
        lumber_camp: 3, mill: 5, barracks: 6, mine: 8,
        stable: 10, foundry: 14, tower: 15, castle: 17,
      },
      productionQueueLimit: 8,
      productionBatch: { barracks: 4, stable: 2, foundry: 1 },
      cavalryFallbackTime: 280,
      firstAttackDelay: 125,
      defenseRadius: 640,
      defenseLimit: 90,
      earlyWaveUntil: 255,
      earlyWaveMinimum: 20,
      lateWaveMinimum: 32,
      waveFraction: 0.7,
      maxWaveSize: 170,
      waveRetryDelay: 16,
      earlyAttackInterval: 62,
      lateAttackInterval: 48,
      stagingDelay: 9,
    },
  },
  hard: {
    name: 'Hard',
    summary: 'The original relentless rival with rapid growth and massed assaults.',
    ai: {
      planningInterval: 1,
      villagerTarget: 22,
      villagerQueueLimit: 2,
      builderCount: 4,
      houseBuffer: 18,
      houseLimit: 29,
      farmWorkerRatio: 4,
      towerLimit: 2,
      buildAt: {
        lumber_camp: 3, mill: 4, barracks: 5, mine: 6,
        stable: 9, foundry: 13, tower: 12, castle: 20,
      },
      productionQueueLimit: 12,
      productionBatch: { barracks: 5, stable: 3, foundry: 2 },
      cavalryFallbackTime: 240,
      firstAttackDelay: 92,
      defenseRadius: 720,
      defenseLimit: 120,
      earlyWaveUntil: 240,
      earlyWaveMinimum: 24,
      lateWaveMinimum: 40,
      waveFraction: 0.8,
      maxWaveSize: 240,
      waveRetryDelay: 12,
      earlyAttackInterval: 52,
      lateAttackInterval: 38,
      stagingDelay: 8,
    },
  },
};

export function normalizeCpuDifficulty(value, fallback = DEFAULT_CPU_DIFFICULTY) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (CPU_DIFFICULTIES[normalized]) return normalized;
  return CPU_DIFFICULTIES[fallback] ? fallback : DEFAULT_CPU_DIFFICULTY;
}

export const NATIONS = {
  england: {
    name: 'England', adjective: 'English',
    coat: '#b33a38', trim: '#f0e7d0', skin: '#e0ad82', roof: '#536274',
    headgear: 'tricorn',
    blurb: 'Productive farms yield 15% more food without changing troop strength.',
    mults: { farmRate: 1.15 },
  },
  ottoman: {
    name: 'Ottoman Empire', adjective: 'Ottoman',
    coat: '#2f7768', trim: '#d7b64b', skin: '#c99669', roof: '#397466',
    headgear: 'turban',
    blurb: 'Villagers train 10% faster without changing troop strength.',
    mults: { villagerTrain: 0.9 },
  },
};

// Distances are world pixels and times are seconds. Costs are deliberately
// generous: the economy should support Cossacks-sized armies, not a 200-pop cap.
export const UNIT_TYPES = {
  villager: {
    label: 'Villager', short: 'Villager', hp: 38, speed: 54, radius: 5,
    worker: true,
    // Civilian militia only fire when explicitly ordered. Their shorter range,
    // slower reload, lower accuracy and lower damage keep trained musketeers
    // decisively superior in every sustained fight.
    range: 160, acquire: 0, reload: 6, dmg: 5, acc: 0.27,
    meleeDmg: 2, meleeRate: 1.5, chase: 0,
    cost: { food: 50 }, trainTime: 6, pop: 1,
  },
  woman_villager: {
    label: 'Women Villagers', short: 'Woman Villager', hp: 38, speed: 52, radius: 6,
    // Women share the full economy/construction role while their explicit
    // combat order wheels out a compact falconet. The projectile owns the
    // soldier-only lethal rule; these baseline numbers cover buildings and
    // other civilians without turning the cannon into an area wipe.
    worker: true, cannonWorker: true,
    range: 390, minRange: 60, acquire: 0, reload: 11, dmg: 12, acc: 1,
    meleeDmg: 2, meleeRate: 1.5, chase: 0,
    cost: { food: 75, wood: 25, gold: 15 }, trainTime: 8, pop: 1,
  },
  musk: {
    label: 'Musketeers', short: 'Musketeer', hp: 34, speed: 46, radius: 5,
    range: 190, acquire: 275, reload: 4.2, dmg: 11, acc: 0.4,
    meleeDmg: 4, meleeRate: 1.3, chase: 0,
    cost: { food: 28, gold: 18 }, trainTime: 3.2, pop: 1,
  },
  pike: {
    label: 'Polearm Guards', short: 'Guard', hp: 48, speed: 45, radius: 5,
    range: 0, acquire: 210, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 10, meleeRate: 1.05, chase: 160,
    cost: { food: 24, wood: 16 }, trainTime: 2.8, pop: 1,
  },
  cav: {
    label: 'Cavalry', short: 'Cavalryman', hp: 68, speed: 108, radius: 7,
    range: 0, acquire: 340, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 12, meleeRate: 0.92, chase: 260,
    cost: { food: 55, gold: 44 }, trainTime: 5.5, pop: 2,
  },
  gun: {
    label: 'Cannon', short: 'Cannon', hp: 90, speed: 27, radius: 11,
    range: 670, minRange: 105, acquire: 730, reload: 9.5, dmg: 48, acc: 1,
    meleeDmg: 2, meleeRate: 1.6, chase: 0, splash: 34,
    cost: { wood: 70, gold: 105 }, trainTime: 12, pop: 5,
  },
};

export const BUILDING_TYPES = {
  town_center: {
    label: 'Town Center', description: 'Heart of the settlement. Trains villagers and accepts every carried resource.',
    w: 132, h: 104, radius: 70, visualScale: 1.35, hp: 3200, buildTime: 0,
    cost: {}, popCap: 40, trains: ['villager', 'woman_villager'], hotkey: 'T',
  },
  house: {
    label: 'House', description: '+40 population capacity.',
    w: 62, h: 52, radius: 34, visualScale: 1.28, hp: 650, buildTime: 9,
    cost: { wood: 70 }, popCap: 40, hotkey: 'H',
  },
  farm: {
    label: 'Field', description: 'A cultivated plot attached to a completed Mill. Villagers work within its crop rows.',
    w: 108, h: 82, radius: 52, visualScale: 1, hp: 420, buildTime: 7,
    cost: { wood: 55 }, resource: 'food', amount: 5000, hotkey: 'F',
  },
  mill: {
    label: 'Mill', description: 'Accepts food, anchors up to eight fields, and boosts nearby food gathering by 20%.',
    w: 70, h: 60, radius: 38, visualScale: 1.25, hp: 900, buildTime: 11,
    cost: { wood: 120 }, boost: 'food', hotkey: 'M',
  },
  lumber_camp: {
    label: 'Lumber Camp', description: 'Accepts wood, employs woodcutters, and boosts nearby wood gathering by 20%.',
    w: 72, h: 58, radius: 39, visualScale: 1.28, hp: 900, buildTime: 10,
    cost: { wood: 105 }, boost: 'wood', workResources: ['wood'], hotkey: 'L',
  },
  mine: {
    label: 'Mining Camp', description: 'Accepts gold and stone, employs miners, and boosts nearby mineral gathering.',
    w: 74, h: 58, radius: 40, visualScale: 1.26, hp: 950, buildTime: 12,
    cost: { wood: 110, stone: 20 }, boost: 'mineral', workResources: ['gold', 'stone'], hotkey: 'N',
  },
  barracks: {
    label: 'Barracks', description: 'Trains musketeers and pikemen in large batches.',
    w: 104, h: 76, radius: 56, visualScale: 1.26, hp: 1700, buildTime: 15,
    cost: { wood: 220, stone: 40 }, trains: ['musk', 'pike'], hotkey: 'B',
  },
  stable: {
    label: 'Stable', description: 'Trains fast shock cavalry.',
    w: 112, h: 78, radius: 60, visualScale: 1.26, hp: 1650, buildTime: 17,
    cost: { wood: 280, gold: 70 }, trains: ['cav'], hotkey: 'S',
  },
  foundry: {
    label: 'Artillery Foundry', description: 'Builds long-range cannon.',
    w: 116, h: 84, radius: 62, visualScale: 1.26, hp: 1900, buildTime: 20,
    cost: { wood: 320, gold: 150, stone: 90 }, trains: ['gun'], hotkey: 'A',
  },
  tower: {
    label: 'Watch Tower', description: 'A garrisoned defensive gun position.',
    w: 52, h: 52, radius: 29, visualScale: 1.28, hp: 1400, buildTime: 14,
    cost: { wood: 130, stone: 180 },
    attack: 14, range: 320, reload: 4.0, accuracy: 0.78, hotkey: 'W',
  },
  castle: {
    label: 'Grand Artillery Castle',
    description: 'A bastioned late-game fortress that fires cannon volleys and musters every military arm.',
    w: 216, h: 168, radius: 118, visualScale: 1.25, hp: 8500, buildTime: 52,
    cost: { wood: 900, gold: 650, stone: 1400 },
    trains: ['musk', 'pike', 'cav', 'gun'],
    attackKind: 'cannon', attack: 30, splash: 30, volley: 3,
    range: 590, reload: 8.5, hotkey: 'C',
  },
  wall: {
    label: 'Stone Wall', description: 'Heavy masonry that blocks troops and musket fire.',
    w: 88, h: 22, radius: 46, visualScale: 1.32, hp: 1250, buildTime: 7,
    cost: { stone: 25 }, fortification: true, blocksUnits: true, hotkey: 'U',
  },
  gate: {
    label: 'Stone Gate', description: 'A fortified passage that can be opened or barred on command.',
    w: 104, h: 26, radius: 54, visualScale: 1.32, hp: 1650, buildTime: 10,
    cost: { wood: 20, stone: 45 }, fortification: true, gate: true, hotkey: 'G',
  },
  wall_stairs: {
    label: 'Stone Staircase',
    description: 'Wall-side steps that let musketeers occupy the protected firing walk.',
    // Stair geometry already derives its rise from WALL_WALK_ELEVATION, so it
    // only needs a slight breadth adjustment rather than the wall's full scale.
    w: 36, h: 50, radius: 29, visualScale: 1.05, hp: 760, buildTime: 9,
    cost: { wood: 15, stone: 55 }, wallAttachment: true, hotkey: 'X',
  },
};

export const GATHER_RATES = { food: 8.5, wood: 7.5, gold: 5.8, stone: 5.2 };

export const PIKE_VS_CAV = 2.8;
export const CAV_CHARGE_BONUS = 1.8;
export const SQUARE_VS_CAV = 0.35;
