import {
  createGameSnapshot, decodeSnapshot, encodeSnapshot, restoreGameSnapshot,
} from './savegame.js';

export const MULTIPLAYER_ROLES = Object.freeze({
  ally: Object.freeze({
    key: 'ally',
    label: 'Ally',
    side: 2,
    description: 'The guest commands your allied town.',
  }),
  enemy: Object.freeze({
    key: 'enemy',
    label: 'Enemy',
    side: 1,
    description: 'The guest commands the rival town against you.',
  }),
});

const PROTOCOL_VERSION = 1;
const SIGNAL_PREFIX = 'empires1700:';
const ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
  Object.freeze({ urls: 'stun:stun1.l.google.com:19302' }),
]);

function signalEncode(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${SIGNAL_PREFIX}${btoa(binary)}`;
}

function signalDecode(value) {
  const text = String(value || '').trim();
  const encoded = text.startsWith(SIGNAL_PREFIX) ? text.slice(SIGNAL_PREFIX.length) : text;
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function waitForIceGathering(peer) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', done);
      resolve();
    }, 1800);
    const done = () => {
      if (peer.iceGatheringState !== 'complete') return;
      clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    peer.addEventListener('icegatheringstatechange', done);
  });
}

function createPeer() {
  if (typeof RTCPeerConnection !== 'function') {
    throw new Error('This browser does not support WebRTC peer connections.');
  }
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

export function makeInviteUrl(baseUrl, offer) {
  const url = new URL(baseUrl);
  url.searchParams.set('multiplayer', 'join');
  url.hash = `offer=${encodeURIComponent(offer)}`;
  return url.toString();
}

export function readInviteFromLocation(location = globalThis.location) {
  const params = new URLSearchParams(location?.search || '');
  const hash = new URLSearchParams(String(location?.hash || '').replace(/^#/, ''));
  return {
    joinRequested: params.get('multiplayer') === 'join',
    offer: hash.get('offer') || '',
  };
}

export function sideForRemoteRole(role) {
  return MULTIPLAYER_ROLES[role]?.side ?? MULTIPLAYER_ROLES.ally.side;
}

export function createMultiplayerSession(callbacks = {}) {
  let peer = null;
  let channel = null;
  let mode = 'offline';
  let remoteRole = 'ally';
  let status = 'Offline';

  const setStatus = next => {
    status = next;
    callbacks.onStatus?.(status);
  };

  const attachChannel = nextChannel => {
    channel = nextChannel;
    channel.addEventListener('open', () => {
      setStatus(mode === 'host' ? 'Guest connected' : 'Connected to host');
      callbacks.onOpen?.();
    });
    channel.addEventListener('close', () => setStatus('Peer disconnected'));
    channel.addEventListener('error', () => setStatus('Connection error'));
    channel.addEventListener('message', event => {
      try {
        callbacks.onMessage?.(JSON.parse(event.data));
      } catch (_error) {
        setStatus('Ignored unreadable multiplayer message');
      }
    });
  };

  const reset = () => {
    channel?.close?.();
    peer?.close?.();
    channel = null;
    peer = null;
    mode = 'offline';
    setStatus('Offline');
  };

  const send = message => {
    if (channel?.readyState !== 'open') return false;
    channel.send(JSON.stringify({
      protocol: PROTOCOL_VERSION,
      ...message,
    }));
    return true;
  };

  return {
    get mode() { return mode; },
    get role() { return remoteRole; },
    get remoteSide() { return sideForRemoteRole(remoteRole); },
    get connected() { return channel?.readyState === 'open'; },
    get status() { return status; },
    reset,
    send,
    async createHostOffer(role = 'ally') {
      reset();
      mode = 'host';
      remoteRole = MULTIPLAYER_ROLES[role] ? role : 'ally';
      setStatus('Creating invite');
      peer = createPeer();
      attachChannel(peer.createDataChannel('empires1700'));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      setStatus('Invite ready');
      return signalEncode({
        protocol: PROTOCOL_VERSION,
        mode: 'host',
        role: remoteRole,
        description: peer.localDescription,
      });
    },
    async acceptGuestAnswer(answerText) {
      if (mode !== 'host' || !peer) throw new Error('Create an invite before applying an answer.');
      const answer = signalDecode(answerText);
      if (answer.protocol !== PROTOCOL_VERSION || answer.mode !== 'guest-answer') {
        throw new Error('That answer code does not match this game.');
      }
      await peer.setRemoteDescription(answer.description);
      setStatus('Waiting for guest connection');
    },
    async joinFromOffer(offerText) {
      reset();
      const offer = signalDecode(offerText);
      if (offer.protocol !== PROTOCOL_VERSION || offer.mode !== 'host') {
        throw new Error('That invite code does not match this game.');
      }
      mode = 'guest';
      remoteRole = MULTIPLAYER_ROLES[offer.role] ? offer.role : 'ally';
      setStatus('Joining host');
      peer = createPeer();
      peer.addEventListener('datachannel', event => attachChannel(event.channel));
      await peer.setRemoteDescription(offer.description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);
      setStatus('Answer ready');
      return signalEncode({
        protocol: PROTOCOL_VERSION,
        mode: 'guest-answer',
        role: remoteRole,
        description: peer.localDescription,
      });
    },
  };
}

export function createMultiplayerSnapshot(world, commanders, camera) {
  return createGameSnapshot(world, commanders, camera, Date.now());
}

export function encodeMultiplayerSnapshot(snapshot) {
  return encodeSnapshot(snapshot);
}

export function restoreMultiplayerSnapshot(serialized) {
  return restoreGameSnapshot(decodeSnapshot(serialized));
}
