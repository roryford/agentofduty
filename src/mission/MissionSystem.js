/** Encounter controller. World owns layout; this owns checkpoint progression. */
export class MissionSystem {
  static id = 'mission';
  static deps = ['world', 'ai', 'player'];
  constructor() {
    this.index = 0;
    this.practiceEncounter = 0;
    this.hold = 0;
    this.shots = 0;
    this.hits = 0;
    this.kills = 0;
    this._unsubs = [];
  }
  async init(ctx) {
    this.ctx = ctx;
    const world = ctx.get('world');
    this.encounters = world.encounters || [{
      id: 'checkpoint', name: 'Checkpoint', objective: 'Clear the checkpoint',
      spawn: world.playerSpawn,
      enemySpawns: ctx.get('ai').enemies.map((e) => ({ x: e.position.x, z: e.position.z, role: 'holder' })),
      exit: { x: 0, z: 12, radius: 5 },
    }];
    ctx.session.restore = (full) => this.restore(full);
    this._unsubs.push(
      ctx.events.on('weapon:fire', (p) => { if (p?.from === 'player') this.shots++; }),
      ctx.events.on('combat:hit', (p) => { if (p?.from === 'player' && p.target !== 'player') this.hits++; }),
      ctx.events.on('actor:death', (p) => { if (p?.actor !== 'player') this.kills++; }),
    );
  }
  get current() { return this.encounters[this.index]; }
  get alive() { return this.ctx.get('ai').enemies.filter((e) => e.alive).length; }
  get practice() { return this.ctx.session.mode === 'practice'; }
  configure(mode, encounter = 0) {
    if (!['mission', 'practice'].includes(mode)) throw new Error('Invalid game mode');
    if (!Number.isInteger(encounter) || !this.encounters[encounter]) throw new Error('Invalid practice encounter');
    if (this.ctx.session.playing || this.ctx.session.state === 'dead') throw new Error('Pause before changing mode');
    const wasReady = this.ctx.session.state === 'ready';
    this.ctx.session.mode = mode;
    this.practiceEncounter = encounter;
    this.ctx.session.retry(true);
    if (wasReady) this.ctx.session.setState('ready');
  }
  resetPosition() {
    if (!this.practice) return;
    this.ctx.session.retry();
    this.ctx.session.retries--;
  }
  get objective() {
    if (this.practice) return 'Explore freely · no enemies';
    if (this.alive) return `${this.current.objective} · ${this.alive} hostiles`;
    return this.index === this.encounters.length - 1
      ? `Reach extraction · secure area ${Math.ceil(Math.max(0, 8 - this.hold))}s`
      : 'Area clear · move to the checkpoint';
  }
  restore(full = false) {
    if (full) { this.index = this.practice ? this.practiceEncounter : 0; this.shots = 0; this.hits = 0; this.kills = 0; }
    this.hold = 0;
    return { spawn: this.current.spawn, enemySpawns: this.practice ? [] : this.current.enemySpawns, encounter: this.index, practice: this.practice };
  }
  fixedUpdate(h, ctx) {
    if (this.practice || !ctx.session.playing || this.alive) return;
    const { position } = ctx.get('player');
    const exit = this.current.exit;
    const inside = Math.hypot(position.x - exit.x, position.z - exit.z) <= exit.radius;
    if (!inside) { this.hold = 0; return; }
    if (this.index < this.encounters.length - 1) {
      this.index++;
      ctx.session.retry();
      ctx.session.retries--; // advancing a checkpoint is not a death/retry
      ctx.events.emit('mission:objective', { index: this.index, name: this.current.name });
    } else {
      this.hold += h;
      if (this.hold >= 8) ctx.session.complete();
    }
  }
  dispose() { for (const unsub of this._unsubs) unsub(); }
}
