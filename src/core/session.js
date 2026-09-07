/** Session lifecycle is simulation state. Presentation may continue while paused. */
export class GameSession {
  constructor({ events, input, lockstep = false, restore = () => ({}) }) {
    this.events = events;
    this.input = input;
    this.lockstep = lockstep;
    this.restore = restore;
    this.state = lockstep ? 'playing' : 'ready';
    this.mode = 'mission';
    this.deathRemaining = 0;
    this.message = '';
    this.elapsed = 0;
    this.retries = 0;
    this.settings = {
      sensitivity: 0.0022, adsSensitivity: 0.65, fov: 80,
      invertY: false, reducedMotion: false, volume: 0.65,
    };
    this._removeDeath = events.on('actor:death', (event) => {
      if (event?.actor !== 'player' || !this.playing) return;
      this.deathRemaining = 2.5;
      this.setState('dead');
    });
  }
  get playing() { return this.state === 'playing'; }
  get simulating() { return this.playing || this.state === 'dead'; }
  setState(state) {
    if (!['ready', 'playing', 'paused', 'dead', 'complete'].includes(state)) {
      throw new Error(`Invalid session state: ${state}`);
    }
    if (state === this.state) return;
    const previous = this.state;
    this.state = state;
    this.events.emit('session:state', { state, previous });
  }
  start() {
    if (this.state !== 'ready' && this.state !== 'paused') return;
    this.message = '';
    this.setState('playing');
  }
  pause() {
    // Dead timers also stop on focus loss. Resume restores the death state.
    if (this.playing || this.state === 'dead') {
      this._resumeDead = this.state === 'dead';
      this.setState('paused');
    }
    this.input.reset();
  }
  resume() {
    if (this.state === 'paused' && this._resumeDead) {
      this._resumeDead = false;
      this.setState('dead');
    } else this.start();
  }
  retry(full = false) {
    const locked = this.input.mouse.locked || this.lockstep;
    const snapshot = this.restore(full);
    this.input.reset();
    this.input.mouse.locked = locked;
    this.input.active = locked;
    this.deathRemaining = 0;
    this._resumeDead = false;
    if (full) { this.elapsed = 0; this.retries = 0; }
    else this.retries++;
    this.events.emit('session:reset', { ...snapshot, full });
    this.setState(locked ? 'playing' : 'paused');
  }
  complete() {
    if (!this.playing) return;
    this.input.reset();
    this.setState('complete');
  }
  advance(h) {
    if (this.playing) this.elapsed += h;
    if (this.state !== 'dead') return;
    this.deathRemaining = Math.max(0, this.deathRemaining - h);
    if (this.deathRemaining === 0) this.retry();
  }
  dispose() { this._removeDeath(); }
}
