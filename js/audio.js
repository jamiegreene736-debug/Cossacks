// Layered procedural soundscape via Web Audio. Effects are pooled and throttled
// so a settlement with hundreds of workers and soldiers still sounds broad
// without creating one audio graph per visible animation.

export const AUDIO_KEY = 'empires1700.audio.v1';
const DEFAULT_AUDIO = Object.freeze({
  master: 0.7,
  effects: 0.72,
  music: 0.42,
  pauseMusic: 'duck',
  muted: false,
});
const VALID_PAUSE_MUSIC = new Set(['duck', 'mute']);
const NOTE = 2 ** (1 / 12);
const SIEGE_DAMAGE_MEMORY = 7;

const TRACKS = Object.freeze({
  greenwich: {
    id: 'greenwich', title: 'Greenwich at First Light', nation: 'england', tempo: 82,
    root: 50, scale: [0, 2, 4, 5, 7, 9, 11], color: 'strings',
    chords: [[0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1], [0, 2, 4]],
    motif: [0, 2, 4, 2, 1, 3, 2, null, 4, 3, 2, 0, 1, 2, 0, null],
  },
  bosphorus: {
    id: 'bosphorus', title: 'Watch over the Bosphorus', nation: 'ottoman', tempo: 88,
    root: 50, scale: [0, 1, 4, 5, 7, 8, 10], color: 'lute',
    chords: [[0, 2, 4], [0, 3, 5], [1, 3, 5], [0, 2, 4], [4, 6, 1], [3, 5, 0], [1, 3, 5], [0, 2, 4]],
    motif: [0, 1, 2, 4, 3, 2, 1, null, 0, 4, 3, 2, 1, 0, 1, null],
  },
  lanterns: {
    id: 'lanterns', title: 'Lanterns in the Campaign Camp', nation: 'neutral', tempo: 76,
    root: 48, scale: [0, 2, 3, 5, 7, 8, 10], color: 'reed',
    chords: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1], [0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4]],
    motif: [0, null, 2, 3, 4, null, 3, 2, 1, null, 3, 2, 0, null, 1, null],
  },
  banners: {
    id: 'banners', title: 'Powder and Banners', nation: 'battle', tempo: 104,
    root: 45, scale: [0, 2, 3, 5, 7, 8, 10], color: 'march',
    chords: [[0, 2, 4], [0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4], [5, 0, 2], [4, 6, 1], [0, 2, 4]],
    motif: [0, 2, 3, 4, 3, 2, 0, 2, 4, 3, 2, 1, 2, 1, 0, null],
  },
});

function clampVolume(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export function normalizeAudioSettings(settings = {}) {
  return {
    master: clampVolume(settings.master, DEFAULT_AUDIO.master),
    effects: clampVolume(settings.effects, DEFAULT_AUDIO.effects),
    music: clampVolume(settings.music, DEFAULT_AUDIO.music),
    pauseMusic: VALID_PAUSE_MUSIC.has(settings.pauseMusic) ? settings.pauseMusic : DEFAULT_AUDIO.pauseMusic,
    muted: Boolean(settings.muted),
  };
}

export function campaignTrackOrder(playerNation) {
  const factionTrack = playerNation === 'ottoman' ? 'bosphorus' : 'greenwich';
  const rivalTrack = factionTrack === 'greenwich' ? 'bosphorus' : 'greenwich';
  return [factionTrack, 'lanterns', rivalTrack];
}

export function pausedMusicMultiplier(paused, pauseMusic) {
  if (!paused) return 1;
  return pauseMusic === 'mute' ? 0 : 0.16;
}

export function workerSoundKind(worker, target) {
  if (worker?.job?.kind === 'build') return 'build';
  if (worker?.job?.kind !== 'gather' && worker?.job?.kind !== 'workplace') return null;
  const kind = worker.job.resourceType || target?.resourceType;
  return kind === 'food' ? 'harvest' : ['wood', 'gold', 'stone'].includes(kind) ? kind : null;
}

export function findNearestAudibleMatch(entities, listenerX, predicate) {
  let nearest = null;
  let nearestDistance = Infinity;
  let count = 0;
  for (const entity of entities || []) {
    if (!predicate(entity)) continue;
    count++;
    const distance = Math.abs(entity.x - listenerX);
    if (distance < nearestDistance) {
      nearest = entity;
      nearestDistance = distance;
    }
  }
  return { entity: nearest, count };
}

export function findNearestAudibleEntity(entities, listenerX, predicate) {
  return findNearestAudibleMatch(entities, listenerX, predicate).entity;
}

export function findNearestBuildingSiege(world, listenerX, damageMemory = SIEGE_DAMAGE_MEMORY) {
  const time = Number(world?.time) || 0;
  const sieges = new Map();
  for (const unit of world?.units || []) {
    if (!unit.alive || unit.type === 'villager') continue;
    const target = unit.target?.entityKind === 'building' ? unit.target
      : !unit.target && unit.orderTarget?.entityKind === 'building' ? unit.orderTarget : null;
    if (!target?.alive || !target.complete || target.side === unit.side || target.hp >= target.maxHp) continue;

    const recentDamage = Number.isFinite(target.lastHostileUnitDamageAt)
      && time - target.lastHostileUnitDamageAt <= damageMemory;
    if (!recentDamage && !(unit.fireT > 0)) continue;
    const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
    const unitRadius = Number(unit.radius) || 0;
    const targetRadius = Number(target.radius) || 0;
    const engagementRange = unit.range > 0
      ? unit.range + 24 : unitRadius + targetRadius + 12;
    if (distance > engagementRange) continue;

    const siege = sieges.get(target) || { building: target, attackers: 0, severity: 0 };
    siege.attackers++;
    siege.severity = Math.max(0, Math.min(1, 1 - target.hp / Math.max(1, target.maxHp)));
    sieges.set(target, siege);
  }

  let nearest = null;
  let nearestDistance = Infinity;
  for (const siege of sieges.values()) {
    const distance = Math.abs(siege.building.x - listenerX);
    if (distance < nearestDistance) {
      nearest = siege;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function midiToHz(midi) { return 440 * NOTE ** (midi - 69); }
function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.pageActive = globalThis.document?.visibilityState !== 'hidden';
    this.pageActivityTransition = Promise.resolve();
    this.pageActivityError = null;
    this.master = null;
    this.effects = null;
    this.music = null;
    this.ambience = null;
    this.reverb = null;
    this.settings = this.readSettings();
    this.muted = this.settings.muted;
    this.paused = false;
    this.listenerX = 0;
    this.noise = null;
    this.activeMusicNodes = new Set();
    this.musicNextTime = Infinity;
    this.trackBag = [];
    this.currentTrack = null;
    this.pendingTrack = null;
    this.scheduledTrack = null;
    this.lastScheduledTrack = null;
    this.playerNation = 'england';
    this.musketQueue = 0;
    this.musketX = 0;
    this.workCooldown = 0;
    this.movementCooldown = 0;
    this.natureCooldown = 2 + Math.random() * 4;
    this.siegeScanCooldown = 0;
    this.siegeFireCooldown = 0;
    this.siegeShoutCooldown = 0;
    this.activeSiege = null;
    this.meleeCooldown = 0;
    this.cannonCooldown = 0;
    this.collapseCooldown = 0;
    this.commandCooldown = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.pageActive && this.ctx.state === 'suspended') this.setPageActive(true);
      return;
    }
    if (!this.pageActive) return;
    const AC = globalThis.window && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.effects = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.ambience = this.ctx.createGain();
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -13;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;
    this.reverb = this.createReverb();
    const reverbReturn = this.ctx.createGain();
    reverbReturn.gain.value = 0.22;
    this.effects.connect(this.master);
    this.music.connect(this.master);
    this.ambience.connect(this.master);
    this.reverb.connect(reverbReturn).connect(this.master);
    this.master.connect(compressor).connect(this.ctx.destination);
    this.noise = this.createNoiseBuffer(3);
    this.startFieldAmbience();
    this.syncGains(true);
  }

  setPageActive(active) {
    this.pageActive = Boolean(active);
    if (!this.pageActive && this.ctx && this.master) {
      const time = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(time);
      this.master.gain.setValueAtTime(0, time);
    }
    const reconcileContextState = async () => {
      const context = this.ctx;
      if (!context || context.state === 'closed') return;
      if (this.pageActive && context.state === 'suspended') await context.resume();
      else if (!this.pageActive && context.state === 'running') await context.suspend();
      if (this.pageActive && this.master) this.syncGains(true);
    };
    // Serialize browser lifecycle promises so the newest visibility state always wins.
    this.pageActivityTransition = this.pageActivityTransition
      .then(reconcileContextState, reconcileContextState)
      .then(
        () => { this.pageActivityError = null; },
        error => { this.pageActivityError = error?.message || String(error); },
      );
    return this.pageActivityTransition;
  }

  createNoiseBuffer(duration) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index++) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.72 + white * 0.28;
      data[index] = white * 0.72 + previous * 0.28;
    }
    return buffer;
  }

  createReverb() {
    const convolver = this.ctx.createConvolver();
    const length = Math.floor(this.ctx.sampleRate * 1.85);
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        const decay = (1 - index / length) ** 2.7;
        data[index] = (Math.random() * 2 - 1) * decay;
      }
    }
    convolver.buffer = impulse;
    return convolver;
  }

  startFieldAmbience() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const wind = this.ctx.createBiquadFilter();
    wind.type = 'bandpass';
    wind.frequency.value = 310;
    wind.Q.value = 0.34;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.075;
    source.connect(wind).connect(gain).connect(this.ambience);
    source.start();
  }

  readSettings() {
    try {
      const stored = globalThis.localStorage?.getItem(AUDIO_KEY);
      return stored ? normalizeAudioSettings(JSON.parse(stored)) : { ...DEFAULT_AUDIO };
    } catch (_error) {
      return { ...DEFAULT_AUDIO };
    }
  }

  persistSettings() {
    try { globalThis.localStorage?.setItem(AUDIO_KEY, JSON.stringify(this.settings)); } catch (_error) { /* optional */ }
  }

  syncGains(immediate = false) {
    if (!this.ctx) return;
    const time = this.ctx.currentTime;
    const masterLevel = this.settings.muted ? 0 : this.settings.master;
    const pauseLevel = pausedMusicMultiplier(this.paused, this.settings.pauseMusic);
    const values = [
      [this.master.gain, masterLevel],
      [this.effects.gain, this.settings.effects],
      [this.music.gain, this.settings.music * pauseLevel],
      [this.ambience.gain, this.paused ? 0.018 : 0.12],
    ];
    for (const [param, value] of values) {
      param.cancelScheduledValues(time);
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, time, this.paused ? 0.12 : 0.035);
    }
    this.muted = this.settings.muted;
  }

  getSettings() { return { ...this.settings }; }
  getNowPlaying() { return this.currentTrack ? TRACKS[this.currentTrack].title : 'Campaign score preparing…'; }
  getDiagnostics() {
    return {
      context: this.ctx?.state || 'unavailable',
      pageActive: this.pageActive,
      pageActivityError: this.pageActivityError,
      track: this.getNowPlaying(),
      paused: this.paused,
      gains: this.ctx ? {
        master: this.master.gain.value,
        effects: this.effects.gain.value,
        music: this.music.gain.value,
        ambience: this.ambience.gain.value,
      } : null,
      siege: this.activeSiege ? {
        buildingId: this.activeSiege.building.id,
        attackers: this.activeSiege.attackers,
        severity: this.activeSiege.severity,
      } : null,
    };
  }

  setSettings(next) {
    this.settings = normalizeAudioSettings({ ...this.settings, ...next });
    this.muted = this.settings.muted;
    this.syncGains();
    this.persistSettings();
    return this.getSettings();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this.syncGains();
  }

  startBattle(world) {
    this.ensure();
    if (!this.ctx) return;
    this.stopScheduledMusic();
    this.playerNation = world?.sides?.[0]?.nation || 'england';
    this.trackBag = [];
    this.currentTrack = null;
    this.pendingTrack = null;
    this.scheduledTrack = null;
    this.lastScheduledTrack = null;
    this.musicNextTime = this.ctx.currentTime + 0.12;
    this.siegeScanCooldown = 0;
    this.siegeFireCooldown = 0;
    this.siegeShoutCooldown = 0;
    this.activeSiege = null;
    this.setPaused(false);
  }

  stopBattle() {
    this.stopScheduledMusic();
    this.currentTrack = null;
    this.pendingTrack = null;
    this.scheduledTrack = null;
    this.lastScheduledTrack = null;
    this.musicNextTime = Infinity;
    this.activeSiege = null;
    if (this.ctx) {
      const time = this.ctx.currentTime;
      this.ambience.gain.cancelScheduledValues(time);
      this.ambience.gain.setTargetAtTime(0, time, 0.08);
    }
  }

  stopScheduledMusic() {
    for (const node of this.activeMusicNodes) {
      try { node.stop(); } catch (_error) { /* already ended */ }
    }
    this.activeMusicNodes.clear();
  }

  spatialPan(x) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(-0.85, Math.min(0.85, (x - this.listenerX) / 900));
  }

  spatialLevel(x) {
    if (!Number.isFinite(x)) return 1;
    return Math.max(0.18, 1 / (1 + Math.abs(x - this.listenerX) / 1250));
  }

  route(node, bus, pan = 0, reverbAmount = 0) {
    let output = node;
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      output.connect(panner);
      output = panner;
    }
    output.connect(bus);
    if (reverbAmount > 0) {
      const send = this.ctx.createGain();
      send.gain.value = reverbAmount;
      output.connect(send).connect(this.reverb);
    }
  }

  tone(frequency, time, duration, options = {}) {
    if (!this.ctx) return null;
    const oscillator = this.ctx.createOscillator();
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), time);
    if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), time + duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = options.filterType || 'lowpass';
    filter.frequency.value = options.filter || 8000;
    filter.Q.value = options.q || 0.4;
    const gain = this.ctx.createGain();
    const attack = Math.min(duration * 0.45, options.attack ?? 0.004);
    const releaseStart = Math.max(time + attack, time + duration - (options.release ?? duration * 0.7));
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.volume ?? 0.05), time + attack);
    gain.gain.setValueAtTime(Math.max(0.0002, options.volume ?? 0.05), releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(filter).connect(gain);
    this.route(gain, options.bus || this.effects, options.pan || 0, options.reverb || 0);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    if (options.bus === this.music) this.trackMusicNode(oscillator);
    return oscillator;
  }

  noiseBurst(time, duration, options = {}) {
    if (!this.ctx || !this.noise) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = options.filterType || 'bandpass';
    filter.frequency.value = options.filter || 1000;
    filter.Q.value = options.q || 0.7;
    const gain = this.ctx.createGain();
    const attack = Math.min(duration * 0.25, options.attack ?? 0.002);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.volume ?? 0.05), time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain);
    this.route(gain, options.bus || this.effects, options.pan || 0, options.reverb || 0);
    const maxOffset = Math.max(0, this.noise.duration - duration - 0.01);
    source.start(time, Math.random() * maxOffset, duration);
    if (options.bus === this.music) this.trackMusicNode(source);
  }

  trackMusicNode(node) {
    this.activeMusicNodes.add(node);
    node.addEventListener?.('ended', () => this.activeMusicNodes.delete(node), { once: true });
  }

  musket(x) {
    this.musketX = (this.musketX * this.musketQueue + (Number.isFinite(x) ? x : this.listenerX)) / (this.musketQueue + 1);
    this.musketQueue++;
  }

  playMusketBurst(count) {
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(this.musketX);
    const level = this.spatialLevel(this.musketX);
    const volume = Math.min(0.46, (0.07 + Math.log2(count + 1) * 0.075) * level);
    this.noiseBurst(time, 0.035, { filter: 2800, q: 0.48, volume, pan, reverb: 0.1 });
    this.noiseBurst(time + 0.012, 0.14, { filter: 820, q: 0.55, volume: volume * 0.58, pan, reverb: 0.24 });
    this.tone(96, time, 0.16, { type: 'triangle', endFrequency: 48, volume: volume * 0.22, pan, reverb: 0.18 });
    this.noiseBurst(time + 0.075, 0.48, { filter: 1250, q: 0.24, volume: volume * 0.13, pan, reverb: 0.55 });
  }

  melee(x, heavy = false) {
    if (!this.ctx || this.muted || this.meleeCooldown > 0) return;
    this.meleeCooldown = 0.075 + Math.random() * 0.075;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x) * (heavy ? 1.18 : 1);
    const ring = 860 + Math.random() * 1050;
    this.noiseBurst(time, 0.045, { filter: 1900, q: 1.2, volume: 0.08 * level, pan, reverb: 0.12 });
    this.tone(ring, time, 0.13, { type: 'triangle', endFrequency: ring * 0.64, volume: 0.045 * level, pan, reverb: 0.22 });
    this.tone(ring * 1.47, time + 0.004, 0.09, { type: 'sine', volume: 0.025 * level, pan, reverb: 0.25 });
  }

  cannonFire(x) {
    if (!this.ctx || this.muted || this.cannonCooldown > 0) return;
    this.cannonCooldown = 0.055;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.noiseBurst(time, 0.48, { filterType: 'lowpass', filter: 760, q: 0.35, volume: 0.55 * level, pan, reverb: 0.3 });
    this.tone(72, time, 0.72, { endFrequency: 25, volume: 0.55 * level, pan, reverb: 0.34 });
    this.noiseBurst(time + 0.16, 0.82, { filter: 260, q: 0.3, volume: 0.13 * level, pan, reverb: 0.62 });
  }

  cannonImpact(x) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.tone(54, time, 0.52, { endFrequency: 24, volume: 0.44 * level, pan, reverb: 0.28 });
    this.noiseBurst(time, 0.28, { filterType: 'lowpass', filter: 1150, volume: 0.4 * level, pan, reverb: 0.24 });
    for (let index = 0; index < 4; index++) {
      const delay = 0.025 + Math.random() * 0.14;
      this.noiseBurst(time + delay, 0.04 + Math.random() * 0.06, {
        filter: 1000 + Math.random() * 1800, q: 1.4, volume: 0.055 * level, pan, reverb: 0.3,
      });
    }
  }

  towerShot(x) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.noiseBurst(time, 0.05, { filter: 2100, volume: 0.13 * level, pan, reverb: 0.2 });
    this.tone(118, time, 0.12, { endFrequency: 55, volume: 0.05 * level, pan, reverb: 0.12 });
  }

  work(kind, x) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    if (kind === 'wood') {
      this.noiseBurst(time, 0.06, { filter: 740, q: 1.1, volume: 0.1 * level, pan, reverb: 0.08 });
      this.tone(122, time, 0.11, { type: 'triangle', endFrequency: 82, volume: 0.085 * level, pan, reverb: 0.08 });
    } else if (kind === 'stone' || kind === 'gold') {
      const ring = kind === 'gold' ? 1480 : 1040;
      this.noiseBurst(time, 0.045, { filter: 2200, q: 1.4, volume: 0.075 * level, pan, reverb: 0.13 });
      this.tone(ring, time, kind === 'gold' ? 0.25 : 0.16, { type: 'triangle', endFrequency: ring * 0.72, volume: 0.055 * level, pan, reverb: 0.24 });
      this.tone(ring * 1.42, time, 0.13, { type: 'sine', volume: 0.024 * level, pan, reverb: 0.2 });
    } else if (kind === 'build') {
      this.noiseBurst(time, 0.045, { filter: 1180, q: 0.9, volume: 0.075 * level, pan, reverb: 0.09 });
      this.tone(178, time, 0.1, { type: 'triangle', endFrequency: 112, volume: 0.07 * level, pan, reverb: 0.1 });
    } else {
      this.noiseBurst(time, 0.18, { filter: 2100, q: 0.35, volume: 0.05 * level, pan, reverb: 0.04 });
      this.noiseBurst(time + 0.07, 0.12, { filter: 3200, q: 0.4, volume: 0.03 * level, pan, reverb: 0.03 });
    }
  }

  buildingFire(x, severity, attackers) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const force = Math.min(1.35, 0.72 + Math.max(0.2, severity) * 0.62
      + Math.log2(Math.max(1, attackers)) * 0.08);
    const level = this.spatialLevel(x) * force;
    const duration = 0.72 + Math.random() * 0.42;

    // Two overlapping noise bands form a continuous flame bed: low turbulent
    // air below, dry timber hiss above. Short randomized pops keep it alive.
    this.noiseBurst(time, duration, {
      filterType: 'lowpass', filter: 460 + Math.random() * 180, q: 0.28,
      volume: 0.052 * level, pan, reverb: 0.16,
    });
    this.noiseBurst(time + 0.025, duration * 0.78, {
      filter: 1250 + Math.random() * 650, q: 0.52,
      volume: 0.034 * level, pan, reverb: 0.12,
    });
    const crackles = 2 + Math.min(3, Math.floor(severity * 5));
    for (let index = 0; index < crackles; index++) {
      const delay = 0.06 + Math.random() * duration * 0.72;
      this.noiseBurst(time + delay, 0.025 + Math.random() * 0.04, {
        filter: 2650 + Math.random() * 2100, q: 1.7,
        volume: (0.042 + Math.random() * 0.035) * level, pan, reverb: 0.11,
      });
    }
    if (Math.random() < 0.42) {
      this.tone(68 + Math.random() * 22, time, 0.42, {
        type: 'triangle', endFrequency: 34, volume: 0.027 * level, pan, reverb: 0.2,
      });
    }
  }

  siegeShouts(x, attackers) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x) * Math.min(1.2, 0.72 + Math.log2(attackers + 1) * 0.14);
    const voices = Math.min(3, 1 + Math.floor(Math.log2(Math.max(1, attackers))));
    for (let index = 0; index < voices; index++) {
      const delay = index * (0.08 + Math.random() * 0.1);
      const base = 112 + Math.random() * 58;
      const duration = 0.25 + Math.random() * 0.22;
      const voicePan = Math.max(-0.9, Math.min(0.9, pan + (Math.random() - 0.5) * 0.18));
      // A sawtooth carrier through two vocal-formant bands makes a short,
      // distant human cry without shipping or repeatedly looping a sample.
      this.tone(base, time + delay, duration, {
        type: 'sawtooth', endFrequency: base * (0.68 + Math.random() * 0.18),
        filterType: 'bandpass', filter: 680 + Math.random() * 260, q: 1.15,
        volume: 0.028 * level, pan: voicePan, reverb: 0.62,
      });
      this.tone(base * 1.015, time + delay, duration * 0.92, {
        type: 'sawtooth', endFrequency: base * 0.74,
        filterType: 'bandpass', filter: 1380 + Math.random() * 520, q: 1.45,
        volume: 0.014 * level, pan: voicePan, reverb: 0.68,
      });
      this.noiseBurst(time + delay, duration * 0.7, {
        filter: 980 + Math.random() * 620, q: 0.72,
        volume: 0.011 * level, pan: voicePan, reverb: 0.58,
      });
    }
  }

  buildingPlaced(x) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    this.noiseBurst(time, 0.12, { filterType: 'lowpass', filter: 680, volume: 0.13, pan, reverb: 0.08 });
    this.tone(92, time, 0.16, { endFrequency: 58, volume: 0.09, pan, reverb: 0.08 });
  }

  buildingComplete(_type, x) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.work('build', x);
    this.tone(392, time + 0.08, 0.28, { type: 'triangle', volume: 0.045 * level, pan, reverb: 0.36 });
    this.tone(523.25, time + 0.19, 0.42, { type: 'triangle', volume: 0.04 * level, pan, reverb: 0.42 });
  }

  buildingDestroyed(_type, x) {
    if (!this.ctx || this.muted || this.collapseCooldown > 0) return;
    this.collapseCooldown = 0.16;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.tone(62, time, 0.85, { endFrequency: 24, volume: 0.42 * level, pan, reverb: 0.34 });
    this.noiseBurst(time, 0.72, { filterType: 'lowpass', filter: 920, volume: 0.38 * level, pan, reverb: 0.28 });
    for (let index = 0; index < 6; index++) {
      const delay = 0.08 + index * 0.075 + Math.random() * 0.05;
      this.noiseBurst(time + delay, 0.07, { filter: 520 + Math.random() * 1700, q: 0.8, volume: 0.075 * level, pan, reverb: 0.2 });
      this.tone(95 + Math.random() * 90, time + delay, 0.12, { type: 'triangle', endFrequency: 58, volume: 0.04 * level, pan, reverb: 0.12 });
    }
  }

  unitDeath(type, x) {
    if (!this.ctx || this.muted || this.commandCooldown > 0) return;
    this.commandCooldown = 0.045;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.noiseBurst(time, 0.12, { filterType: 'lowpass', filter: type === 'gun' ? 620 : 940, volume: 0.055 * level, pan, reverb: 0.08 });
    this.tone(type === 'cav' ? 82 : 112, time, 0.16, { endFrequency: 54, volume: 0.035 * level, pan, reverb: 0.07 });
  }

  command(kind = 'move') {
    if (!this.ctx || this.muted || this.commandCooldown > 0) return;
    this.commandCooldown = 0.035;
    const time = this.ctx.currentTime;
    const frequencies = { attack: 176, gather: 330, rally: 294, build: 247, train: 262, select: 392, move: 220 };
    const frequency = frequencies[kind] || frequencies.move;
    this.tone(frequency, time, 0.08, { type: 'triangle', endFrequency: frequency * 0.86, volume: 0.027, reverb: 0.08 });
    if (kind === 'attack') this.tone(frequency * 0.75, time + 0.045, 0.11, { type: 'triangle', volume: 0.025, reverb: 0.08 });
  }

  unitReady(x) {
    if (!this.ctx || this.muted) return;
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(x);
    const level = this.spatialLevel(x);
    this.tone(294, time, 0.14, { type: 'triangle', volume: 0.038 * level, pan, reverb: 0.2 });
    this.tone(440, time + 0.09, 0.24, { type: 'triangle', volume: 0.034 * level, pan, reverb: 0.25 });
  }

  updateWorkSounds(dt, world) {
    this.workCooldown -= dt;
    if (this.workCooldown > 0 || world?.state !== 'running') return;
    const workers = findNearestAudibleMatch(world.units, this.listenerX,
      unit => unit.alive && unit.type === 'villager' && unit.state === 'work' && unit.job);
    const worker = workers.entity;
    if (!worker) {
      this.workCooldown = 0.35;
      return;
    }
    const target = world.resources.find(resource => resource.id === worker.job.targetId)
      || world.buildings.find(building => building.id === worker.job.targetId);
    const kind = workerSoundKind(worker, target);
    if (kind) this.work(kind, worker.x);
    this.workCooldown = Math.max(0.22, 0.78 / Math.sqrt(Math.min(9, workers.count)))
      + Math.random() * 0.12;
  }

  updateMovementSounds(dt, world) {
    this.movementCooldown -= dt;
    if (this.movementCooldown > 0 || world?.state !== 'running') return;
    const movers = findNearestAudibleMatch(world.units, this.listenerX,
      candidate => candidate.alive && candidate.moving);
    const unit = movers.entity;
    if (!unit) {
      this.movementCooldown = 0.18;
      return;
    }
    const time = this.ctx.currentTime;
    const pan = this.spatialPan(unit.x);
    const level = this.spatialLevel(unit.x);
    if (unit.type === 'cav') {
      this.tone(92, time, 0.09, { type: 'triangle', endFrequency: 58, volume: 0.052 * level, pan, reverb: 0.06 });
      this.noiseBurst(time, 0.055, { filterType: 'lowpass', filter: 680, volume: 0.045 * level, pan, reverb: 0.04 });
      this.tone(108, time + 0.11, 0.075, { type: 'triangle', endFrequency: 65, volume: 0.042 * level, pan, reverb: 0.05 });
    } else if (unit.type === 'gun') {
      this.noiseBurst(time, 0.16, { filter: 520, q: 1.1, volume: 0.045 * level, pan, reverb: 0.06 });
      this.tone(136, time, 0.18, { type: 'triangle', endFrequency: 88, volume: 0.025 * level, pan, reverb: 0.08 });
    } else {
      this.noiseBurst(time, 0.07, { filterType: 'lowpass', filter: 820, volume: 0.026 * level, pan, reverb: 0.025 });
    }
    this.movementCooldown = Math.max(0.095, 0.42 / Math.sqrt(Math.min(16, movers.count)))
      + Math.random() * 0.045;
  }

  updateNatureSounds(dt, world) {
    this.natureCooldown -= dt;
    if (this.natureCooldown > 0 || world?.state !== 'running') return;
    if (this.combatIntensity(world) >= 5) {
      this.natureCooldown = 1.5;
      return;
    }
    const time = this.ctx.currentTime;
    const pan = Math.random() * 1.4 - 0.7;
    const start = 1850 + Math.random() * 750;
    this.tone(start, time, 0.11, { type: 'sine', endFrequency: start * 1.22, volume: 0.012, pan, reverb: 0.55 });
    this.tone(start * 1.08, time + 0.16, 0.13, { type: 'sine', endFrequency: start * 1.34, volume: 0.01, pan, reverb: 0.6 });
    this.natureCooldown = 5 + Math.random() * 11;
  }

  updateSiegeSounds(dt, world) {
    this.siegeScanCooldown -= dt;
    this.siegeFireCooldown -= dt;
    this.siegeShoutCooldown -= dt;
    if (world?.state !== 'running' || this.muted) {
      this.activeSiege = null;
      return;
    }

    if (this.siegeScanCooldown <= 0) {
      const previousId = this.activeSiege?.building.id;
      this.activeSiege = findNearestBuildingSiege(world, this.listenerX);
      this.siegeScanCooldown = 0.18;
      if (this.activeSiege && this.activeSiege.building.id !== previousId) {
        this.siegeFireCooldown = 0;
        this.siegeShoutCooldown = 0.35 + Math.random() * 0.45;
      }
    }

    const siege = this.activeSiege;
    if (!siege?.building.alive) return;
    if (this.siegeFireCooldown <= 0) {
      this.buildingFire(siege.building.x, siege.severity, siege.attackers);
      this.siegeFireCooldown = 0.56 + Math.random() * 0.34;
    }
    if (this.siegeShoutCooldown <= 0) {
      this.siegeShouts(siege.building.x, siege.attackers);
      this.siegeShoutCooldown = Math.max(1.55, 4.4 / Math.sqrt(Math.min(16, siege.attackers)))
        + Math.random() * 1.55;
    }
  }

  combatIntensity(world) {
    let engaged = world?.projectiles?.length || 0;
    for (const unit of world?.units || []) {
      if (unit.alive && (unit.target?.alive || unit.fireT > 0)) engaged++;
      if (engaged >= 18) break;
    }
    return engaged;
  }

  nextTrack(world) {
    const battle = this.combatIntensity(world) >= 10;
    if (battle) return 'banners';
    if (!this.trackBag.length) {
      const order = campaignTrackOrder(this.playerNation);
      this.trackBag = this.lastScheduledTrack ? shuffled(order) : order;
      if (this.trackBag.length > 1 && this.trackBag[0] === this.lastScheduledTrack) {
        [this.trackBag[0], this.trackBag[1]] = [this.trackBag[1], this.trackBag[0]];
      }
    }
    return this.trackBag.shift();
  }

  scheduleTrackBar(trackId, barIndex, startTime) {
    const track = TRACKS[trackId];
    const beat = 60 / track.tempo;
    const bar = beat * 4;
    const scaleNote = (degree, octave = 0) => midiToHz(track.root + track.scale[((degree % 7) + 7) % 7] + 12 * octave);
    const chord = track.chords[barIndex];
    for (let voice = 0; voice < chord.length; voice++) {
      const degree = chord[voice];
      const options = track.color === 'lute'
        ? { type: 'triangle', attack: 0.006, release: bar * 0.7, filter: 1900, volume: 0.017 }
        : { type: 'sawtooth', attack: 0.32, release: 0.75, filter: track.color === 'march' ? 1250 : 980, volume: 0.011 };
      this.tone(scaleNote(degree, voice === 2 ? 0 : -1), startTime, bar * 0.96, {
        ...options, bus: this.music, pan: (voice - 1) * 0.28, reverb: 0.56,
      });
    }
    this.tone(scaleNote(chord[0], -2), startTime, beat * 1.75, {
      type: 'triangle', attack: 0.035, release: 0.6, filter: 620, volume: 0.027,
      bus: this.music, pan: -0.08, reverb: 0.18,
    });
    this.tone(scaleNote(chord[0], -2), startTime + beat * 2, beat * 1.7, {
      type: 'triangle', attack: 0.025, release: 0.55, filter: 580, volume: 0.022,
      bus: this.music, pan: 0.08, reverb: 0.16,
    });
    for (let step = 0; step < 8; step++) {
      const degree = track.motif[(barIndex * 2 + step) % track.motif.length];
      if (degree === null) continue;
      const noteTime = startTime + step * beat / 2;
      const isLute = track.color === 'lute';
      this.tone(scaleNote(degree, 0), noteTime, isLute ? beat * 0.72 : beat * 0.92, {
        type: isLute ? 'triangle' : track.color === 'reed' ? 'square' : 'triangle',
        attack: isLute ? 0.005 : 0.045,
        release: isLute ? 0.48 : 0.28,
        filter: isLute ? 2400 : track.color === 'reed' ? 1250 : 1800,
        volume: isLute ? 0.028 : 0.021,
        bus: this.music, pan: step % 2 ? 0.2 : -0.2, reverb: isLute ? 0.36 : 0.5,
      });
    }
    if (track.color === 'lute' || track.color === 'march') {
      for (const drumBeat of track.color === 'march' ? [0, 1, 2, 3] : [0, 1.5, 2.75]) {
        const drumTime = startTime + drumBeat * beat;
        this.noiseBurst(drumTime, 0.1, { filterType: 'lowpass', filter: 480, volume: track.color === 'march' ? 0.035 : 0.022, bus: this.music, pan: -0.12, reverb: 0.18 });
        this.tone(track.color === 'march' ? 92 : 118, drumTime, 0.12, { endFrequency: 62, volume: 0.024, bus: this.music, pan: -0.12, reverb: 0.12 });
      }
    }
    this.lastScheduledTrack = trackId;
    if (barIndex === 0) {
      if (startTime <= this.ctx.currentTime + 0.12) this.currentTrack = trackId;
      else this.pendingTrack = { id: trackId, startTime };
    }
    this.musicNextTime = startTime + bar + (barIndex === track.chords.length - 1 ? 0.9 : 0);
  }

  scheduleNextMusicBar(world) {
    if (!this.scheduledTrack || this.scheduledTrack.bar >= TRACKS[this.scheduledTrack.id].chords.length) {
      this.scheduledTrack = { id: this.nextTrack(world), bar: 0 };
    }
    const startTime = Math.max(this.ctx.currentTime + 0.08, this.musicNextTime);
    this.scheduleTrackBar(this.scheduledTrack.id, this.scheduledTrack.bar, startTime);
    this.scheduledTrack.bar++;
  }

  update(dt, world, listenerX = this.listenerX) {
    if (!this.ctx || !this.pageActive || this.ctx.state !== 'running') return;
    this.listenerX = Number.isFinite(listenerX) ? listenerX : this.listenerX;
    if (this.pendingTrack && this.ctx.currentTime >= this.pendingTrack.startTime) {
      this.currentTrack = this.pendingTrack.id;
      this.pendingTrack = null;
    }
    this.musketCooldown -= dt;
    this.meleeCooldown -= dt;
    this.cannonCooldown -= dt;
    this.collapseCooldown -= dt;
    this.commandCooldown -= dt;
    if (!this.muted && this.musketQueue > 0 && this.musketCooldown <= 0) {
      this.playMusketBurst(this.musketQueue);
      this.musketQueue = 0;
      this.musketCooldown = 0.055 + Math.random() * 0.055;
    } else if (this.muted) {
      this.musketQueue = 0;
    }
    this.updateWorkSounds(dt, world);
    this.updateMovementSounds(dt, world);
    this.updateSiegeSounds(dt, world);
    this.updateNatureSounds(dt, world);
    if (world && this.musicNextTime <= this.ctx.currentTime + 1) {
      this.scheduleNextMusicBar(world);
    }
  }
}

export const sfx = new Soundscape();
