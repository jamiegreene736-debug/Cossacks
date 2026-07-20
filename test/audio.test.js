import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Soundscape,
  campaignTrackOrder,
  findNearestBuildingSiege,
  findNearestAudibleEntity,
  findNearestAudibleMatch,
  normalizeAudioSettings,
  pausedMusicMultiplier,
  workerSoundKind,
} from '../js/audio.js';

function createAudioContext(state = 'running') {
  return {
    state,
    transitions: [],
    async suspend() {
      this.transitions.push('suspend');
      this.state = 'suspended';
    },
    async resume() {
      this.transitions.push('resume');
      this.state = 'running';
    },
  };
}

test('campaign track order starts with the player faction and retains three peaceful cues', () => {
  assert.deepEqual(campaignTrackOrder('england'), ['greenwich', 'lanterns', 'bosphorus']);
  assert.deepEqual(campaignTrackOrder('ottoman'), ['bosphorus', 'lanterns', 'greenwich']);
  assert.equal(new Set(campaignTrackOrder('england')).size, 3);
});

test('pause music can duck smoothly or become fully silent', () => {
  assert.equal(pausedMusicMultiplier(false, 'mute'), 1);
  assert.equal(pausedMusicMultiplier(true, 'duck'), 0.16);
  assert.equal(pausedMusicMultiplier(true, 'mute'), 0);
});

test('audio settings reject unknown pause behavior and clamp every bus', () => {
  assert.deepEqual(normalizeAudioSettings({
    master: -4, effects: 0.25, music: 9, pauseMusic: 'stop', muted: 1,
  }), {
    master: 0, effects: 0.25, music: 1, pauseMusic: 'duck', muted: true,
  });
});

test('page activity suspends all audio while hidden and resumes it when visible', async () => {
  const soundscape = new Soundscape();
  const context = createAudioContext();
  soundscape.ctx = context;

  await soundscape.setPageActive(false);
  assert.equal(context.state, 'suspended');
  assert.deepEqual(context.transitions, ['suspend']);
  assert.equal(soundscape.pageActive, false);

  await soundscape.setPageActive(true);
  assert.equal(context.state, 'running');
  assert.deepEqual(context.transitions, ['suspend', 'resume']);
  assert.equal(soundscape.pageActive, true);
});

test('rapid page activity changes converge on the latest requested state', async () => {
  const soundscape = new Soundscape();
  const context = createAudioContext();
  let releaseSuspend;
  context.suspend = async function suspend() {
    this.transitions.push('suspend');
    await new Promise(resolve => { releaseSuspend = resolve; });
    this.state = 'suspended';
  };
  soundscape.ctx = context;

  const hide = soundscape.setPageActive(false);
  await Promise.resolve();
  const show = soundscape.setPageActive(true);
  releaseSuspend();
  await Promise.all([hide, show]);

  assert.equal(context.state, 'running');
  assert.deepEqual(context.transitions, ['suspend', 'resume']);
  assert.equal(soundscape.pageActivityError, null);
});

test('audio initialization never revives a context while the page is hidden', async () => {
  const soundscape = new Soundscape();
  const context = createAudioContext('suspended');
  soundscape.ctx = context;
  soundscape.pageActive = false;

  soundscape.ensure();
  await soundscape.pageActivityTransition;

  assert.equal(context.state, 'suspended');
  assert.deepEqual(context.transitions, []);
});

test('worker activities select distinct economic sounds', () => {
  const worker = { job: { kind: 'gather' } };
  assert.equal(workerSoundKind(worker, { resourceType: 'wood' }), 'wood');
  assert.equal(workerSoundKind(worker, { resourceType: 'stone' }), 'stone');
  assert.equal(workerSoundKind(worker, { resourceType: 'gold' }), 'gold');
  assert.equal(workerSoundKind(worker, { resourceType: 'food' }), 'harvest');
  assert.equal(workerSoundKind({ job: { kind: 'build' } }, {}), 'build');
  assert.equal(workerSoundKind({ job: { kind: 'workplace', resourceType: 'wood' } }, {}), 'wood');
  assert.equal(workerSoundKind({ job: null }, {}), null);
});

test('ambient sound selection finds the closest matching entity without sorting the army', () => {
  const entities = [
    { id: 1, x: 900, moving: true },
    { id: 2, x: 120, moving: false },
    { id: 3, x: 260, moving: true },
  ];
  assert.equal(findNearestAudibleEntity(entities, 100, entity => entity.moving)?.id, 3);
  assert.equal(findNearestAudibleEntity(entities, 100, entity => entity.id === 99), null);
  assert.equal(findNearestAudibleMatch(entities, 100, entity => entity.moving).count, 2);
});

test('siege ambience selects the nearest recently attacked building and counts engaged soldiers', () => {
  const near = {
    id: 20, entityKind: 'building', side: 0, x: 500, y: 400, radius: 60,
    hp: 640, maxHp: 1000, alive: true, complete: true, lastHostileUnitDamageAt: 96,
  };
  const far = {
    id: 21, entityKind: 'building', side: 1, x: 1800, y: 400, radius: 60,
    hp: 300, maxHp: 1000, alive: true, complete: true, lastHostileUnitDamageAt: 99,
  };
  const melee = { alive: true, type: 'pike', side: 1, x: 550, y: 400, radius: 7, range: 0, target: near };
  const musketeer = { alive: true, type: 'musk', side: 1, x: 650, y: 400, radius: 7, range: 190, orderTarget: near };
  const distant = { alive: true, type: 'musk', side: 0, x: 1800, y: 400, radius: 7, range: 190, target: far };
  const world = { time: 100, units: [melee, musketeer, distant] };

  const siege = findNearestBuildingSiege(world, 480);
  assert.equal(siege.building, near);
  assert.equal(siege.attackers, 2);
  assert.ok(Math.abs(siege.severity - 0.36) < 0.001);
});

test('siege ambience ignores stale, friendly, idle, villager, and out-of-range attacks', () => {
  const building = {
    id: 30, entityKind: 'building', side: 0, x: 500, y: 400, radius: 60,
    hp: 500, maxHp: 1000, alive: true, complete: true, lastHostileUnitDamageAt: 80,
  };
  const base = { alive: true, type: 'pike', x: 545, y: 400, radius: 7, range: 0, target: building };
  const world = {
    time: 100,
    units: [
      { ...base, side: 0 },
      { ...base, side: 1, type: 'villager' },
      { ...base, side: 1, target: null },
      { ...base, side: 1, x: 900 },
    ],
  };
  assert.equal(findNearestBuildingSiege(world, 500), null);

  building.lastHostileUnitDamageAt = 99;
  world.units.push({ ...base, side: 1, fireT: 0.1 });
  assert.equal(findNearestBuildingSiege(world, 500)?.attackers, 1);
});

test('siege sound scheduling is layered, rate-limited, and silenced when muted', () => {
  const building = {
    id: 40, entityKind: 'building', side: 0, x: 500, y: 400, radius: 60,
    hp: 420, maxHp: 1000, alive: true, complete: true, lastHostileUnitDamageAt: 99,
  };
  const attacker = {
    alive: true, type: 'pike', side: 1, x: 545, y: 400,
    radius: 7, range: 0, target: building,
  };
  const world = { time: 100, state: 'running', units: [attacker] };
  const soundscape = new Soundscape();
  const calls = [];
  soundscape.buildingFire = (...args) => calls.push(['fire', ...args]);
  soundscape.siegeShouts = (...args) => calls.push(['shout', ...args]);

  soundscape.updateSiegeSounds(0.2, world);
  assert.deepEqual(calls.map(call => call[0]), ['fire']);
  soundscape.updateSiegeSounds(0.9, world);
  assert.deepEqual(calls.map(call => call[0]), ['fire', 'fire', 'shout']);
  soundscape.updateSiegeSounds(0.01, world);
  assert.deepEqual(calls.map(call => call[0]), ['fire', 'fire', 'shout']);
  assert.ok(soundscape.siegeFireCooldown > 0.5);
  assert.ok(soundscape.siegeShoutCooldown > 1.5);

  soundscape.muted = true;
  soundscape.updateSiegeSounds(10, world);
  assert.equal(soundscape.activeSiege, null);
  assert.deepEqual(calls.map(call => call[0]), ['fire', 'fire', 'shout']);
});
