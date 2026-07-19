// Procedural sound effects via WebAudio — no audio files needed.
// Musket fire is aggregated: many shots in a short window become one
// louder crackle so 700-man volleys don't spawn 700 oscillators.

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.musketQueue = 0;
    this.musketCooldown = 0;
    this.meleeCooldown = 0;
    this.cannonCooldown = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  noiseBuffer(dur) {
    const len = Math.max(1, (this.ctx.sampleRate * dur) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Called once per shot from the sim; actual playback happens in update().
  musket() { this.musketQueue++; }

  melee() {
    if (!this.ctx || this.muted || this.meleeCooldown > 0) return;
    this.meleeCooldown = 0.09 + Math.random() * 0.06;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1600 + Math.random() * 900, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.07);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.045, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  cannon() {
    if (!this.ctx || this.muted) return;
    if (this.cannonCooldown > 0) return;
    this.cannonCooldown = 0.05;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.4);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(120, t + 0.35);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(filt).connect(ng).connect(this.master);
    src.start(t);
  }

  playMusketBurst(count) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.09);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1500 + Math.random() * 700;
    filt.Q.value = 0.7;
    const g = this.ctx.createGain();
    const vol = Math.min(0.4, 0.06 + 0.045 * count);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  update(dt) {
    if (!this.ctx || this.muted) { this.musketQueue = 0; return; }
    this.musketCooldown -= dt;
    this.meleeCooldown -= dt;
    this.cannonCooldown -= dt;
    if (this.musketQueue > 0 && this.musketCooldown <= 0) {
      this.playMusketBurst(this.musketQueue);
      this.musketQueue = 0;
      this.musketCooldown = 0.06 + Math.random() * 0.05;
    }
  }
}

export const sfx = new Sfx();
