import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeInviteUrl, readInviteFromLocation, sideForRemoteRole,
} from '../js/multiplayer.js';

test('multiplayer invite URLs preserve the encoded host offer', () => {
  const offer = 'empires1700:abc123';
  const invite = makeInviteUrl('https://example.com/game/?difficulty=low', offer);
  const parsed = readInviteFromLocation(new URL(invite));

  assert.equal(parsed.joinRequested, true);
  assert.equal(parsed.offer, offer);
});

test('multiplayer remote roles map to the intended game sides', () => {
  assert.equal(sideForRemoteRole('ally'), 2);
  assert.equal(sideForRemoteRole('enemy'), 1);
  assert.equal(sideForRemoteRole('unknown'), 2);
});
