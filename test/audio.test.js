import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Soundscape,
  campaignTrackOrder,
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
