import test from 'node:test';
import assert from 'node:assert/strict';

import {
  campaignTrackOrder,
  normalizeAudioSettings,
  pausedMusicMultiplier,
  workerSoundKind,
} from '../js/audio.js';

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
