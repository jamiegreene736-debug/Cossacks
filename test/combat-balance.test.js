import test from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_TYPES } from '../js/config.js';
import { createWorld, spawnUnit } from '../js/sim.js';

const MILITARY_TYPES = ['musk', 'pike', 'cav', 'gun'];
const COMBAT_FIELDS = [
  'maxHp', 'speed', 'range', 'minRange', 'acquire', 'reloadTime',
  'dmg', 'acc', 'splash', 'meleeDmg', 'meleeRate', 'chase', 'radius',
];

function combatStats(unit) {
  return Object.fromEntries(COMBAT_FIELDS.map(field => [field, unit[field]]));
}

test('England and Ottoman military units have identical combat power', () => {
  const world = createWorld({ playerNation: 'england', enemyNation: 'ottoman' });

  for (const type of MILITARY_TYPES) {
    const english = spawnUnit(world, 0, type, 800, 1500);
    const ottoman = spawnUnit(world, 1, type, 900, 1500);
    assert.deepEqual(combatStats(english), combatStats(ottoman), `${type} stats must match`);
    assert.equal(english.maxHp, UNIT_TYPES[type].hp);
    assert.equal(english.reloadTime, UNIT_TYPES[type].reload);
    assert.equal(english.meleeDmg, UNIT_TYPES[type].meleeDmg);
  }
});
