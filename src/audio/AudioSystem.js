/**
 * Procedural WebAudio SFX — no external samples.
 *
 * Public surface (ctx.get('audio')):
 *   setMaster(gain 0–1)
 *   muted
 *
 * Mix rules:
 *   - Distance attenuation from player eye to event origin
 *   - Surface-specific impact filters
 *   - Enemy fire quieter + rate-limited (squad spam)
 */

const REF_DIST = 4; // full volume within this many meters
const MAX_DIST = 55; // silence beyond
const ENEMY_FIRE_MIN_INTERVAL = 0.055; // ~18Hz cap for enemy shot SFX

export class AudioSystem {
  static id = 'audio';
  static deps = [];

  constructor() {
    this._ctx = null;
    this._master = null;
    this._muted = false;
    this._volume = 0.55;
    this._unsubs = [];
    this._rng = null;
    this._unlocked = false;
    this._lockstep = false;
    this._lastEnemyFireT = 0;
    this._listenerPos = { x: 0, y: 1.6, z: 0 };
  }

  async init(ctx) {
    this._rng = ctx.rng.fork();
    this._lockstep =
      new URLSearchParams(window.location.search).get('lockstep') === '1' ||
      window.__LOCKSTEP__ === true;

    if (!this._lockstep) {
      const unlock = () => {
        this._ensure();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }

    this._unsubs.push(
      ctx.events.on('weapon:fire', (p) => this._gunshot(ctx, p)),
      ctx.events.on('bullet:impact', (p) => this._impact(ctx, p)),
      ctx.events.on('player:footstep', (p) => this._footstep(ctx, p)),
      ctx.events.on('player:land', (p) => this._land(p)),
      ctx.events.on('actor:death', (p) => {
        if (p?.actor === 'player') this._death();
        else this._click(120, 0.07, 0.04);
      }),
      ctx.events.on('weapon:reload', (p) => {
        if (p?.phase === 'start') this._click(400, 0.04, 0.05);
        if (p?.phase === 'end') this._click(220, 0.06, 0.05);
      }),
    );
  }

  lateUpdate(_dt, ctx) {
    this.setMaster(ctx.session.playing ? ctx.session.settings.volume : 0);
    // Track listener for distance mix (player may not be a dep — peek)
    const player = ctx.peek('player');
    if (player && player.eye) {
      this._listenerPos.x = player.eye.x;
      this._listenerPos.y = player.eye.y;
      this._listenerPos.z = player.eye.z;
    } else if (player && player.position) {
      this._listenerPos.x = player.position.x;
      this._listenerPos.y = player.position.y + 1.5;
      this._listenerPos.z = player.position.z;
    }
  }

  _ensure() {
    if (this._lockstep) return null;
    if (this._ctx) return this._ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this._ctx = new AC();
    this._master = this._ctx.createGain();
    this._master.gain.value = this._volume;
    this._master.connect(this._ctx.destination);
    this._unlocked = true;
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(error => console.warn('[audio] resume failed', error));
    return this._ctx;
  }

  setMaster(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._master) this._master.gain.value = this._muted ? 0 : this._volume;
  }

  get muted() {
    return this._muted;
  }

  set muted(v) {
    this._muted = !!v;
    if (this._master) this._master.gain.value = this._muted ? 0 : this._volume;
  }

  /**
   * Distance gain 0..1 from listener to a point-like payload.
   */
  _distGain(point) {
    if (!point) return 1;
    const lx = this._listenerPos.x;
    const ly = this._listenerPos.y;
    const lz = this._listenerPos.z;
    const px = point.x ?? point.ox ?? 0;
    const py = point.y ?? point.oy ?? 0;
    const pz = point.z ?? point.oz ?? 0;
    const d = Math.hypot(px - lx, py - ly, pz - lz);
    if (d <= REF_DIST) return 1;
    if (d >= MAX_DIST) return 0;
    // Inverse-ish falloff
    const t = (d - REF_DIST) / (MAX_DIST - REF_DIST);
    return (1 - t) * (1 - t);
  }

  _originFromFire(p) {
    if (p?.origin) return p.origin;
    return null;
  }

  _gunshot(ctx, p) {
    const ac = this._ensure();
    if (!ac || this._muted) return;

    const enemy = p?.weapon === 'enemy-smg';
    const now = ctx?.time?.elapsed ?? ac.currentTime;

    if (enemy) {
      if (now - this._lastEnemyFireT < ENEMY_FIRE_MIN_INTERVAL) return;
      this._lastEnemyFireT = now;
    }

    let distG = 1;
    if (enemy) {
      distG = this._distGain(this._originFromFire(p));
      if (distG < 0.02) return;
    }

    const t0 = ac.currentTime;
    // Enemy quieter base; player full
    const base = enemy ? 0.1 : 0.48;
    const amp = base * distG;

    const dur = enemy ? 0.05 : 0.1;
    const buf = ac.createBuffer(1, (ac.sampleRate * dur) | 0, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      data[i] = (this._rng.float() * 2 - 1) * env * env;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = enemy ? 1400 : 900;
    bp.Q.value = enemy ? 0.5 : 0.7;
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(0.001, amp), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this._master);
    src.start(t0);

    if (!enemy) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.08);
      const og = ac.createGain();
      og.gain.setValueAtTime(0.28, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      osc.connect(og);
      og.connect(this._master);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    } else {
      // Tiny distant thump for enemy
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t0);
      osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.05);
      const og = ac.createGain();
      og.gain.setValueAtTime(Math.max(0.001, 0.06 * distG), t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(og);
      og.connect(this._master);
      osc.start(t0);
      osc.stop(t0 + 0.07);
    }
  }

  _impact(ctx, p) {
    const ac = this._ensure();
    if (!ac || this._muted) return;

    const distG = this._distGain(p?.point);
    if (distG < 0.02) return;

    const surface = p?.surface || 'concrete';
    const t0 = ac.currentTime;

    // Per-surface mix
    let type = 'bandpass';
    let freq = 900;
    let q = 0.8;
    let amp = 0.2;
    let dur = 0.07;

    switch (surface) {
      case 'flesh':
        type = 'lowpass';
        freq = 380;
        amp = 0.32;
        dur = 0.09;
        break;
      case 'metal':
        type = 'highpass';
        freq = 2800;
        q = 1.4;
        amp = 0.2;
        dur = 0.1;
        break;
      case 'glass':
        type = 'highpass';
        freq = 4200;
        q = 2;
        amp = 0.16;
        dur = 0.08;
        break;
      case 'wood':
        type = 'bandpass';
        freq = 700;
        amp = 0.22;
        dur = 0.08;
        break;
      case 'dirt':
      case 'sand':
        type = 'lowpass';
        freq = 500;
        amp = 0.14;
        dur = 0.06;
        break;
      case 'water':
        type = 'lowpass';
        freq = 300;
        amp = 0.12;
        dur = 0.1;
        break;
      case 'concrete':
      case 'plaster':
      default:
        type = 'bandpass';
        freq = 850;
        amp = 0.2;
        dur = 0.07;
        break;
    }

    amp *= distG;

    const buf = ac.createBuffer(1, (ac.sampleRate * dur) | 0, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      data[i] = (this._rng.float() * 2 - 1) * env;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(0.001, amp), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    // Metal: short ring
    if (surface === 'metal' || surface === 'glass') {
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(surface === 'glass' ? 2400 : 1200, t0);
      osc.frequency.exponentialRampToValueAtTime(400, t0 + dur);
      const og = ac.createGain();
      og.gain.setValueAtTime(Math.max(0.001, amp * 0.35), t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(og);
      og.connect(this._master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    src.connect(f);
    f.connect(g);
    g.connect(this._master);
    src.start(t0);
  }

  _footstep(ctx, p) {
    const ac = this._ensure();
    if (!ac || this._muted) return;
    const t0 = ac.currentTime;
    const running = !!p?.running;
    const surface = p?.surface || 'concrete';

    let freq = running ? 90 : 70;
    let amp = running ? 0.07 : 0.045;
    if (surface === 'metal') {
      freq *= 1.4;
      amp *= 0.9;
    } else if (surface === 'dirt' || surface === 'sand') {
      freq *= 0.75;
      amp *= 0.8;
    }

    const osc = ac.createOscillator();
    osc.type = surface === 'metal' ? 'square' : 'triangle';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(amp, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = surface === 'metal' ? 1800 : 900;
    osc.connect(f);
    f.connect(g);
    g.connect(this._master);
    osc.start(t0);
    osc.stop(t0 + 0.06);
  }

  _land(p) {
    const ac = this._ensure();
    if (!ac || this._muted) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t0);
    osc.frequency.exponentialRampToValueAtTime(30, t0 + 0.12);
    const g = ac.createGain();
    const v = Math.min(1, Math.abs(p?.velocity || 4) / 10);
    g.gain.setValueAtTime(0.2 * v, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    osc.connect(g);
    g.connect(this._master);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  _death() {
    const ac = this._ensure();
    if (!ac || this._muted) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.35);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    osc.connect(f);
    f.connect(g);
    g.connect(this._master);
    osc.start(t0);
    osc.stop(t0 + 0.42);
  }

  _click(freq, dur, amp = 0.06) {
    const ac = this._ensure();
    if (!ac || this._muted) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(amp, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this._master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  dispose() {
    for (const u of this._unsubs) u();
    this._unsubs.length = 0;
    if (this._ctx) {
      this._ctx.close();
      this._ctx = null;
    }
  }
}
