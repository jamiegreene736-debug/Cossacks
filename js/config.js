// Static game data for the 18th-century settlement skirmish.

export const WORLD = { w: 5200, h: 3200 };
export const SIM_STEP = 1 / 30;
export const MAX_POPULATION = 1200;

export const RESOURCE_KEYS = ['food', 'wood', 'gold', 'stone'];
export const STARTING_RESOURCES = { food: 240, wood: 320, gold: 120, stone: 120 };

export const NATIONS = {
  england: {
    name: 'England', adjective: 'English',
    coat: '#b33a38', trim: '#f0e7d0', skin: '#e0ad82', roof: '#536274',
    blurb: 'Disciplined redcoats and 15% more food from cultivated fields.',
    mults: { reload: 0.9, farmRate: 1.15 },
  },
  ottoman: {
    name: 'Ottoman Empire', adjective: 'Ottoman',
    coat: '#2f7768', trim: '#d7b64b', skin: '#c99669', roof: '#397466',
    blurb: 'Swift cavalry and villagers train 10% faster.',
    mults: { cavSpeed: 1.15, villagerTrain: 0.9 },
  },
};

// Distances are world pixels and times are seconds. Costs are deliberately
// generous: the economy should support Cossacks-sized armies, not a 200-pop cap.
export const UNIT_TYPES = {
  villager: {
    label: 'Villager', short: 'Villager', hp: 38, speed: 54, radius: 5,
    range: 0, acquire: 0, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 2, meleeRate: 1.5, chase: 0,
    cost: { food: 50 }, trainTime: 6, pop: 1,
  },
  musk: {
    label: 'Musketeers', short: 'Musketeer', hp: 34, speed: 46, radius: 5,
    range: 190, acquire: 275, reload: 4.2, dmg: 11, acc: 0.4,
    meleeDmg: 4, meleeRate: 1.3, chase: 0,
    cost: { food: 28, gold: 18 }, trainTime: 3.2, pop: 1,
  },
  pike: {
    label: 'Pikemen', short: 'Pikeman', hp: 48, speed: 45, radius: 5,
    range: 0, acquire: 210, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 10, meleeRate: 1.05, chase: 160,
    cost: { food: 24, wood: 16 }, trainTime: 2.8, pop: 1,
  },
  cav: {
    label: 'Hussars', short: 'Hussar', hp: 68, speed: 108, radius: 7,
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
    label: 'Town Center', description: 'Heart of the settlement. Trains villagers.',
    w: 132, h: 104, radius: 70, hp: 3200, buildTime: 0,
    cost: {}, popCap: 40, trains: ['villager'], hotkey: 'T',
  },
  house: {
    label: 'House', description: '+40 population capacity.',
    w: 62, h: 52, radius: 34, hp: 650, buildTime: 9,
    cost: { wood: 70 }, popCap: 40, hotkey: 'H',
  },
  farm: {
    label: 'Field', description: 'A cultivated plot attached to a completed Mill. Villagers work within its crop rows.',
    w: 108, h: 82, radius: 52, hp: 420, buildTime: 7,
    cost: { wood: 55 }, resource: 'food', amount: 5000, hotkey: 'F',
  },
  mill: {
    label: 'Mill', description: 'Anchors up to eight attached fields and boosts their food gathering by 20%.',
    w: 70, h: 60, radius: 38, hp: 900, buildTime: 11,
    cost: { wood: 120 }, boost: 'food', hotkey: 'M',
  },
  lumber_camp: {
    label: 'Lumber Camp', description: 'Employs woodcutters and boosts nearby wood gathering by 20%.',
    w: 72, h: 58, radius: 39, hp: 900, buildTime: 10,
    cost: { wood: 105 }, boost: 'wood', workResources: ['wood'], hotkey: 'L',
  },
  mine: {
    label: 'Mining Camp', description: 'Employs miners and boosts nearby gold and stone gathering.',
    w: 74, h: 58, radius: 40, hp: 950, buildTime: 12,
    cost: { wood: 110, stone: 20 }, boost: 'mineral', workResources: ['gold', 'stone'], hotkey: 'N',
  },
  barracks: {
    label: 'Barracks', description: 'Trains musketeers and pikemen in large batches.',
    w: 104, h: 76, radius: 56, hp: 1700, buildTime: 15,
    cost: { wood: 220, stone: 40 }, trains: ['musk', 'pike'], hotkey: 'B',
  },
  stable: {
    label: 'Stable', description: 'Trains fast shock cavalry.',
    w: 112, h: 78, radius: 60, hp: 1650, buildTime: 17,
    cost: { wood: 280, gold: 70 }, trains: ['cav'], hotkey: 'S',
  },
  foundry: {
    label: 'Artillery Foundry', description: 'Builds long-range cannon.',
    w: 116, h: 84, radius: 62, hp: 1900, buildTime: 20,
    cost: { wood: 320, gold: 150, stone: 90 }, trains: ['gun'], hotkey: 'A',
  },
  tower: {
    label: 'Watch Tower', description: 'A garrisoned defensive gun position.',
    w: 52, h: 52, radius: 29, hp: 1400, buildTime: 14,
    cost: { wood: 130, stone: 180 }, attack: 17, range: 330, reload: 3.2, hotkey: 'W',
  },
  wall: {
    label: 'Stone Wall', description: 'Heavy masonry that blocks troops and musket fire.',
    w: 88, h: 22, radius: 46, hp: 1250, buildTime: 7,
    cost: { stone: 25 }, fortification: true, blocksUnits: true, hotkey: 'U',
  },
  gate: {
    label: 'Stone Gate', description: 'A passable fortified opening for a stone wall.',
    w: 104, h: 26, radius: 54, hp: 1650, buildTime: 10,
    cost: { wood: 20, stone: 45 }, fortification: true, gate: true, hotkey: 'G',
  },
};

export const GATHER_RATES = { food: 8.5, wood: 7.5, gold: 5.8, stone: 5.2 };

export const PIKE_VS_CAV = 2.8;
export const CAV_CHARGE_BONUS = 1.8;
export const SQUARE_VS_CAV = 0.35;
