// Static game data for the 18th-century settlement skirmish.

export const WORLD = { w: 6600, h: 4200 };
export const SIM_STEP = 1 / 30;
export const MAX_POPULATION = 1200;

export const RESOURCE_KEYS = ['food', 'wood', 'gold', 'stone'];
export const STARTING_RESOURCES = { food: 240, wood: 320, gold: 120, stone: 120 };

const PLAYER_TEAM_ID = 0;
const RIVAL_TEAM_ID = 1;

export const TEAM_START_SLOTS = Object.freeze({
  player: Object.freeze([
    Object.freeze({ x: 820, y: 0.50 }),
    Object.freeze({ x: 2140, y: 0.22 }),
    Object.freeze({ x: 2140, y: 0.78 }),
  ]),
  rival: Object.freeze([
    Object.freeze({ x: WORLD.w - 820, y: 0.50 }),
    Object.freeze({ x: WORLD.w - 2140, y: 0.78 }),
    Object.freeze({ x: WORLD.w - 2140, y: 0.22 }),
  ]),
});

export function defaultStartPositionForSlot(team, slot) {
  const rival = team === RIVAL_TEAM_ID;
  const starts = rival ? TEAM_START_SLOTS.rival : TEAM_START_SLOTS.player;
  const start = starts[slot] || {
    x: rival ? WORLD.w - 820 : 820,
    y: Math.min(0.86, 0.20 + slot * 0.16),
  };
  return { x: start.x, y: WORLD.h * start.y };
}

function legacyTeamForSideIndex(sideIndex) {
  return sideIndex % 2 === 0 ? PLAYER_TEAM_ID : RIVAL_TEAM_ID;
}

export function defaultStartPositionForSide(sides, sideIndex) {
  const side = sides?.[sideIndex];
  const team = Number.isInteger(side?.team) ? side.team : legacyTeamForSideIndex(sideIndex);
  const slot = (sides || []).slice(0, sideIndex).filter((previousSide, previousIndex) => {
    const previousTeam = Number.isInteger(previousSide?.team)
      ? previousSide.team : legacyTeamForSideIndex(previousIndex);
    return previousTeam === team;
  }).length;
  return defaultStartPositionForSlot(team, slot);
}

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
  hogwarts: {
    name: 'Hogwarts', adjective: 'Hogwarts', playable: false,
    coat: '#243b68', trim: '#d9b84f', skin: '#d7ad8c', roof: '#313845',
    headgear: 'wizard_hat',
    blurb: 'An allied school of witchcraft and wizardry protected by ancient magic.',
    mults: { villagerTrain: 0.92 },
  },
  starwars: {
    name: 'StarWars', adjective: 'StarWars', playable: false,
    coat: '#233d63', trim: '#66d9ff', skin: '#d9aa82', roof: '#5b6473',
    headgear: 'visor',
    blurb: 'An allied galactic frontier town of moisture engineers, robed travelers, and luminous defenders.',
    mults: { villagerTrain: 0.94 },
  },
  nightmare_circus: {
    name: 'Nightmare Circus', adjective: 'Nightmare Circus', playable: false,
    coat: '#7f151d', trim: '#d6c7a5', skin: '#c9a184', roof: '#241e24',
    headgear: 'clown',
    blurb: 'A hostile carnival whose tents produce a curated legion of creepy clowns.',
    mults: { villagerTrain: 0.88 },
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
    label: 'Women Villagers', short: 'Woman Villager', hp: 38, speed: 52, radius: 5,
    // Women share the full economy/construction role while their explicit
    // combat order wheels out a compact falconet. The projectile owns the
    // soldier-only lethal rule; these baseline numbers cover buildings and
    // other civilians without turning the cannon into an area wipe.
    worker: true, cannonWorker: true,
    range: 390, minRange: 60, acquire: 0, reload: 11, dmg: 12, acc: 1,
    meleeDmg: 2, meleeRate: 1.5, chase: 0,
    cost: { food: 75, wood: 25, gold: 15 }, trainTime: 8, pop: 1,
  },
  wizard_worker: {
    label: 'Wizards', short: 'Wizard', hp: 42, speed: 55, radius: 6,
    worker: true, projectileKind: 'arcane',
    range: 205, acquire: 0, reload: 4.8, dmg: 8, acc: 0.72,
    meleeDmg: 3, meleeRate: 1.4, chase: 0,
    cost: { food: 55, gold: 8 }, trainTime: 6, pop: 1,
  },
  witch_worker: {
    label: 'Witches', short: 'Witch', hp: 40, speed: 56, radius: 6,
    worker: true, projectileKind: 'arcane',
    range: 210, acquire: 0, reload: 4.5, dmg: 8, acc: 0.75,
    meleeDmg: 3, meleeRate: 1.4, chase: 0,
    cost: { food: 55, gold: 8 }, trainTime: 6, pop: 1,
  },
  circus_worker: {
    label: 'Circus Hands', short: 'Circus Hand', hp: 42, speed: 54, radius: 6,
    worker: true,
    range: 0, acquire: 0, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 3, meleeRate: 1.35, chase: 0,
    cost: { food: 48 }, trainTime: 5.5, pop: 1,
  },
  starwars_mechanic: {
    label: 'StarWars Mechanics', short: 'Mechanic', hp: 43, speed: 55, radius: 6,
    worker: true, projectileKind: 'plasma',
    range: 185, acquire: 0, reload: 5.2, dmg: 7, acc: 0.64,
    meleeDmg: 3, meleeRate: 1.35, chase: 0,
    cost: { food: 52, gold: 4 }, trainTime: 5.8, pop: 1,
  },
  starwars_robed_villager: {
    label: 'StarWars Villagers', short: 'Robed Villager', hp: 40, speed: 56, radius: 6,
    worker: true, projectileKind: 'plasma',
    range: 195, acquire: 0, reload: 5.0, dmg: 7, acc: 0.68,
    meleeDmg: 3, meleeRate: 1.35, chase: 0,
    cost: { food: 54, gold: 5 }, trainTime: 6, pop: 1,
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
  wizard_duelist: {
    label: 'Wizard Duelists', short: 'Wizard Duelist', hp: 42, speed: 48, radius: 6,
    projectileKind: 'arcane', range: 250, acquire: 325, reload: 3.6, dmg: 13, acc: 0.86,
    meleeDmg: 5, meleeRate: 1.2, chase: 0,
    cost: { food: 34, gold: 28 }, trainTime: 3.8, pop: 1,
  },
  witch_duelist: {
    label: 'Witch Duelists', short: 'Witch Duelist', hp: 46, speed: 50, radius: 6,
    projectileKind: 'arcane', range: 225, acquire: 305, reload: 3.1, dmg: 11, acc: 0.9,
    meleeDmg: 5, meleeRate: 1.15, chase: 0,
    cost: { food: 32, gold: 26 }, trainTime: 3.5, pop: 1,
  },
  moaning_myrtle: {
    label: 'Moaning Myrtles', short: 'Moaning Myrtle', hp: 58, speed: 70, radius: 7,
    projectileKind: 'spectral', range: 330, acquire: 390, reload: 5.8, dmg: 19, acc: 0.96,
    meleeDmg: 4, meleeRate: 1.3, chase: 0,
    cost: { gold: 80 }, trainTime: 9, pop: 2,
  },
  pennywise: {
    label: 'Pennywises', short: 'Pennywise', hp: 82, speed: 76, radius: 8,
    range: 0, acquire: 355, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 17, meleeRate: 0.9, chase: 285,
    cost: { food: 62, gold: 46 }, trainTime: 6, pop: 2,
  },
  art_clown: {
    label: 'Art Clowns', short: 'Art the Clown', hp: 64, speed: 55, radius: 7,
    range: 0, acquire: 260, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 14, meleeRate: 0.82, chase: 205,
    cost: { food: 38, wood: 18 }, trainTime: 3.5, pop: 1,
  },
  twisty_clown: {
    label: 'Twisty Clowns', short: 'Twisty', hp: 76, speed: 48, radius: 8,
    range: 0, acquire: 250, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 20, meleeRate: 1.15, chase: 185,
    cost: { food: 48, wood: 28 }, trainTime: 4.5, pop: 2,
  },
  captain_spaulding: {
    label: 'Captain Spauldings', short: 'Captain Spaulding', hp: 46, speed: 45, radius: 7,
    projectileKind: 'nightmare', range: 235, acquire: 310, reload: 4.4, dmg: 15, acc: 0.68,
    meleeDmg: 5, meleeRate: 1.2, chase: 0,
    cost: { food: 36, gold: 26 }, trainTime: 4.1, pop: 1,
  },
  killer_klown: {
    label: 'Killer Klowns', short: 'Killer Klown', hp: 105, speed: 34, radius: 11,
    projectileKind: 'cotton_candy', range: 560, minRange: 80, acquire: 625,
    reload: 8.4, dmg: 42, acc: 1, splash: 28,
    meleeDmg: 4, meleeRate: 1.5, chase: 0,
    cost: { wood: 62, gold: 92 }, trainTime: 11, pop: 4,
  },
  starwars_sentinel: {
    label: 'StarWars Sentinels', short: 'Sentinel', hp: 42, speed: 50, radius: 6,
    projectileKind: 'plasma', range: 255, acquire: 330, reload: 3.4, dmg: 12, acc: 0.82,
    meleeDmg: 5, meleeRate: 1.15, chase: 0,
    cost: { food: 34, gold: 24 }, trainTime: 3.8, pop: 1,
  },
  starwars_blade_guard: {
    label: 'StarWars Blade Guards', short: 'Blade Guard', hp: 62, speed: 60, radius: 7,
    range: 0, acquire: 260, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 17, meleeRate: 0.92, chase: 220,
    cost: { food: 38, gold: 30 }, trainTime: 4.2, pop: 1,
  },
  starwars_skiff_rider: {
    label: 'StarWars Skiff Riders', short: 'Skiff Rider', hp: 72, speed: 112, radius: 8,
    projectileKind: 'plasma', range: 190, acquire: 310, reload: 4.2, dmg: 10, acc: 0.7,
    meleeDmg: 8, meleeRate: 1.05, chase: 250,
    cost: { food: 58, gold: 48 }, trainTime: 5.6, pop: 2,
  },
  starwars_pulse_cannon: {
    label: 'StarWars Pulse Cannons', short: 'Pulse Cannon', hp: 98, speed: 31, radius: 11,
    projectileKind: 'ion', range: 610, minRange: 95, acquire: 690,
    reload: 8.8, dmg: 44, acc: 1, splash: 30,
    meleeDmg: 3, meleeRate: 1.5, chase: 0,
    cost: { wood: 72, gold: 110 }, trainTime: 11.5, pop: 5,
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
  english_cottage: {
    label: 'Country Cottage', description: '+40 population capacity. English housing choice.',
    w: 66, h: 54, radius: 36, visualScale: 1.28, hp: 650, buildTime: 9,
    cost: { wood: 70 }, popCap: 40, hotkey: 'V',
    buildNations: ['england'], housingChoice: true,
  },
  english_townhouse: {
    label: 'Brick Townhouse', description: '+40 population capacity. English housing choice.',
    w: 76, h: 62, radius: 42, visualScale: 1.28, hp: 700, buildTime: 10,
    cost: { wood: 80, stone: 10 }, popCap: 40, hotkey: 'R',
    buildNations: ['england'], housingChoice: true,
  },
  english_mansion: {
    label: 'Manor House', description: '+40 population capacity. English housing choice.',
    w: 106, h: 84, radius: 58, visualScale: 1.26, hp: 850, buildTime: 12,
    cost: { wood: 100, stone: 35 }, popCap: 40, hotkey: 'Q',
    buildNations: ['england'], housingChoice: true,
  },
  spooky_house: {
    label: 'Spooky House', description: '+40 population capacity. English gothic housing choice.',
    w: 92, h: 78, radius: 52, visualScale: 1.28, hp: 760, buildTime: 11,
    cost: { wood: 90, stone: 25 }, popCap: 40, hotkey: 'Z',
    buildNations: ['england'], housingChoice: true,
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
  marketplace: {
    label: 'Marketplace',
    description: 'English market house where merchants trade one stockpiled resource for another.',
    w: 118, h: 86, radius: 64, visualScale: 1.26, hp: 1450, buildTime: 14,
    cost: { wood: 180, stone: 60 }, buildNations: ['england'], market: true, hotkey: 'K',
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
  school: {
    label: 'Great Hall School', description: 'A grand allied school where magical residents study together.',
    w: 132, h: 92, radius: 70, visualScale: 1.34, hp: 2400, buildTime: 22,
    cost: { wood: 260, stone: 420 }, hotkey: 'D',
  },
  pool: {
    label: 'Enchanted Pool', description: 'A carved-stone bath and swimming pool for the allied settlement.',
    w: 118, h: 88, radius: 64, visualScale: 1.25, hp: 1700, buildTime: 18,
    cost: { wood: 140, stone: 260 }, hotkey: 'O',
  },
  beach: {
    label: 'Black Lake Beach', description: 'A lakeside beach, dock and boathouse for peaceful recreation.',
    w: 138, h: 96, radius: 74, visualScale: 1.25, hp: 1500, buildTime: 16,
    cost: { wood: 180, stone: 80 }, hotkey: 'J',
  },
  park: {
    label: 'World Park', description: 'A peaceful park whose regional design follows the selected world country.',
    w: 156, h: 112, radius: 82, visualScale: 1.25, hp: 999999, buildTime: 13,
    cost: { wood: 90, stone: 30 }, peacefulCivic: true, variants: 5, hotkey: 'P',
  },
  playground: {
    label: 'Inclusive Playground', description: 'A protected civic playground where children remain non-combatants.',
    w: 158, h: 116, radius: 84, visualScale: 1.25, hp: 999999, buildTime: 13,
    cost: { wood: 110, stone: 20 }, peacefulCivic: true, hotkey: 'Y',
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

export function canNationBuildBuilding(nation, buildingType) {
  const def = BUILDING_TYPES[buildingType];
  if (!def) return false;
  if (!def.buildNations) return true;
  return def.buildNations.includes(nation);
}

const DEFAULT_TRAINING_ROSTER = Object.freeze({
  town_center: Object.freeze(['villager', 'woman_villager']),
  barracks: Object.freeze(['musk', 'pike']),
  stable: Object.freeze(['cav']),
  foundry: Object.freeze(['gun']),
  castle: Object.freeze(['musk', 'pike', 'cav', 'gun']),
});

export const NATION_TRAINING_ROSTERS = Object.freeze({
  hogwarts: Object.freeze({
    town_center: Object.freeze(['wizard_worker', 'witch_worker', 'moaning_myrtle']),
    barracks: Object.freeze(['wizard_duelist', 'witch_duelist']),
    stable: Object.freeze(['witch_duelist']),
    foundry: Object.freeze(['moaning_myrtle']),
    castle: Object.freeze(['wizard_duelist', 'witch_duelist', 'moaning_myrtle']),
  }),
  starwars: Object.freeze({
    town_center: Object.freeze(['starwars_mechanic', 'starwars_robed_villager']),
    barracks: Object.freeze(['starwars_sentinel', 'starwars_blade_guard']),
    stable: Object.freeze(['starwars_skiff_rider']),
    foundry: Object.freeze(['starwars_pulse_cannon']),
    castle: Object.freeze([
      'starwars_sentinel', 'starwars_blade_guard', 'starwars_skiff_rider',
      'starwars_pulse_cannon',
    ]),
  }),
  nightmare_circus: Object.freeze({
    town_center: Object.freeze(['circus_worker']),
    barracks: Object.freeze(['pennywise', 'art_clown', 'twisty_clown']),
    stable: Object.freeze(['pennywise']),
    foundry: Object.freeze(['captain_spaulding', 'killer_klown']),
    castle: Object.freeze([
      'pennywise', 'art_clown', 'twisty_clown', 'captain_spaulding', 'killer_klown',
    ]),
  }),
});

export function getTrainableUnitTypes(nation, buildingType) {
  return NATION_TRAINING_ROSTERS[nation]?.[buildingType]
    || DEFAULT_TRAINING_ROSTER[buildingType]
    || BUILDING_TYPES[buildingType]?.trains
    || [];
}

export const GATHER_RATES = { food: 8.5, wood: 7.5, gold: 5.8, stone: 5.2 };

export const PIKE_VS_CAV = 2.8;
export const CAV_CHARGE_BONUS = 1.8;
export const SQUARE_VS_CAV = 0.35;
