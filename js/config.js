// Static game data: world size, nations, unit stats, army sizes.

export const WORLD = { w: 4200, h: 2600 };

// Playable nations of the early 18th century. Coat/trim drive sprite colors;
// mults give each nation a light flavor bonus.
export const NATIONS = {
  russia:  { name: 'Russia',  coat: '#3a5e35', trim: '#c03a30', skin: '#d9a877',
             blurb: 'Hardy infantry (+15% foot HP)',
             mults: { muskHp: 1.15, pikeHp: 1.15 } },
  sweden:  { name: 'Sweden',  coat: '#2a4d8f', trim: '#e8c34a', skin: '#e3b68a',
             blurb: 'Drilled volleys (-15% reload)',
             mults: { reload: 0.85 } },
  france:  { name: 'France',  coat: '#b9b09a', trim: '#31549e', skin: '#e3b68a',
             blurb: 'Fierce cavalry (+20% charge damage)',
             mults: { cavDmg: 1.2 } },
  austria: { name: 'Austria', coat: '#cfc8b8', trim: '#a03030', skin: '#e3b68a',
             blurb: 'Steady gunners (-15% cannon reload)',
             mults: { gunReload: 0.85 } },
  poland:  { name: 'Poland',  coat: '#8f2433', trim: '#e0d8c2', skin: '#e3b68a',
             blurb: 'Winged hussars (+20% cavalry HP)',
             mults: { cavHp: 1.2 } },
  ottoman: { name: 'Ottomans', coat: '#963038', trim: '#3f7d6d', skin: '#c99a68',
             blurb: 'Swift riders (+15% cavalry speed)',
             mults: { cavSpeed: 1.15 } },
};

// Base stats per unit type. Distances in world px, times in seconds.
export const UNIT_TYPES = {
  musk: {
    label: 'Musketeers', hp: 30, speed: 46, radius: 5,
    range: 180, acquire: 260, reload: 4.4, dmg: 10, acc: 0.38,
    meleeDmg: 4, meleeRate: 1.3, chase: 0,
  },
  pike: {
    label: 'Pikemen', hp: 46, speed: 44, radius: 5,
    range: 0, acquire: 200, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 9, meleeRate: 1.1, chase: 150,
  },
  cav: {
    label: 'Hussars', hp: 62, speed: 108, radius: 7,
    range: 0, acquire: 320, reload: 0, dmg: 0, acc: 0,
    meleeDmg: 11, meleeRate: 0.95, chase: 240,
  },
  gun: {
    label: 'Cannon', hp: 80, speed: 26, radius: 11,
    range: 640, minRange: 100, acquire: 700, reload: 10, dmg: 40, acc: 1,
    meleeDmg: 2, meleeRate: 1.6, chase: 0, splash: 30,
  },
};

// Army compositions per battle size (per side).
export const ARMY_SIZES = [
  { id: 'skirmish', label: 'Skirmish', note: '~400 troops',
    comp: { musk: 120, pike: 40, cav: 32, gun: 4 } },
  { id: 'battle', label: 'Battle', note: '~1,200 troops',
    comp: { musk: 370, pike: 120, cav: 90, gun: 10 } },
  { id: 'grand', label: 'Grand Battle', note: '~2,200 troops',
    comp: { musk: 700, pike: 220, cav: 160, gun: 16 } },
  { id: 'epic', label: 'Epic', note: '~3,200 troops',
    comp: { musk: 1020, pike: 320, cav: 240, gun: 24 } },
];

export const SIM_STEP = 1 / 30;

// Damage multipliers for melee matchups.
export const PIKE_VS_CAV = 2.8;
export const CAV_CHARGE_BONUS = 1.8;   // max extra damage multiplier at full gallop
export const SQUARE_VS_CAV = 0.35;     // cavalry damage multiplier vs square formation
