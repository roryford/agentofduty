import { createContext, resizeContext } from './context.js';

/**
 * System contract:
 *   static id; static deps = [];
 *   async init(ctx) {}
 *   fixedUpdate(h, ctx) {}
 *   update(dt, ctx) {}
 *   lateUpdate(dt, ctx) {}
 *   resize(w, h, ctx) {}
 *   dispose() {}
 *
 * Frame order (fixed):
 *   fixedUpdate(h) @ 120Hz -> update(dt) -> lateUpdate(dt) -> render
 * ctx.time.alpha interpolates render transforms between physics ticks.
 *
 * Lockstep: engine does not self-schedule. An external driver pumps exactly N
 * frames via window.__PUMP__ after a fixed bootFrames boot, then signals ready.
 */

/**
 * @typedef {new () => {
 *   init?(ctx: any): void | Promise<void>,
 *   fixedUpdate?(h: number, ctx: any): void,
 *   update?(dt: number, ctx: any): void,
 *   lateUpdate?(dt: number, ctx: any): void,
 *   resize?(w: number, h: number, ctx: any): void,
 *   dispose?(): void,
 * }} SystemClass
 */

export class Engine {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {Partial<import('./config.js').DEFAULT_CONFIG>} [opts.config]
   * @param {boolean} [opts.lockstep]  when true, no rAF; external __PUMP__
   */
  constructor({ canvas, config = {}, lockstep = false }) {
    /** @type {Map<string, object>} */
    this._systems = new Map();
    /** @type {SystemClass[]} */
    this._pending = [];
    /** @type {object[]} */
    this._ordered = [];
    this._lockstep = lockstep;
    this._running = false;
    this._ready = false;
    this._bootLeft = 0;
    this._raf = 0;
    this._lastTs = 0;
    /** Preallocated frame-time ring for perf tooling. */
    this._frameTimes = new Float64Array(512);
    this._frameTimeWrite = 0;
    this._frameTimeCount = 0;
    /** Last-frame draw split (world vs viewmodel). */
    this._drawWorld = 0;
    this._drawView = 0;
    this._triWorld = 0;
    this._triView = 0;

    this.ctx = createContext({
      canvas,
      config,
      systems: this._systems,
    });
    this._bootLeft = this.ctx.config.bootFrames;

    // Perf sample buffer (ms) — zero alloc after construct.
    this._sampleStart = 0;
  }

  /**
   * Register a system class. Instantiated and topo-sorted on init().
   * @param {SystemClass} SystemClass
   */
  add(SystemClass) {
    if (this._running) {
      throw new Error('Cannot add systems after engine has started');
    }
    if (typeof SystemClass !== 'function' || !SystemClass.id) {
      throw new Error('SystemClass must have static id');
    }
    this._pending.push(SystemClass);
    return this;
  }

  /**
   * Topo-sort pending systems by static deps, instantiate, init.
   */
  async init() {
    const classes = topoSort(this._pending);
    this._ordered = [];

    for (const Cls of classes) {
      if (this._systems.has(Cls.id)) {
        throw new Error(`Duplicate system id: ${Cls.id}`);
      }
      const instance = new Cls();
      this._systems.set(Cls.id, instance);
      this._ordered.push(instance);
    }

    // Initial size
    const canvas = this.ctx.canvas;
    const w = canvas.clientWidth || 1280;
    const h = canvas.clientHeight || 720;
    resizeContext(this.ctx, w, h);

    for (const sys of this._ordered) {
      if (typeof sys.init === 'function') {
        await sys.init(this.ctx);
      }
    }

    this._running = true;
    this._ready = false;
    this._bootLeft = this.ctx.config.bootFrames;

    // Prewarm: one silent frame so materials/programs compile before ready.
    this._stepFrame(1 / this.ctx.config.displayHz, true);

    return this;
  }

  /**
   * Interactive mode: self-schedule via requestAnimationFrame.
   * Forbidden when lockstep is true.
   */
  start() {
    if (this._lockstep) {
      throw new Error('Engine is in lockstep mode; use window.__PUMP__');
    }
    if (!this._running) {
      throw new Error('Call init() before start()');
    }
    this._lastTs = 0;
    const loop = (ts) => {
      this._raf = requestAnimationFrame(loop);
      if (this._lastTs === 0) {
        this._lastTs = ts;
        return;
      }
      let dt = (ts - this._lastTs) / 1000;
      this._lastTs = ts;
      // Clamp spiral-of-death
      if (dt > 0.1) dt = 0.1;
      this._stepFrame(dt, false);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  /**
   * Pump exactly n display frames with fixed display dt.
   * Used by lockstep tools (capture / perf).
   * @param {number} n
   */
  pump(n) {
    if (!this._running) {
      throw new Error('Engine not initialized');
    }
    const dt = 1 / this.ctx.config.displayHz;
    const count = n | 0;
    for (let i = 0; i < count; i++) {
      this._stepFrame(dt, false);
    }
  }

  /**
   * @param {number} w
   * @param {number} h
   */
  resize(w, h) {
    resizeContext(this.ctx, w, h);
    for (const sys of this._ordered) {
      if (typeof sys.resize === 'function') sys.resize(w, h, this.ctx);
    }
    this.ctx.events.emit('resize', { width: w, height: h });
  }

  dispose() {
    this.stop();
    for (let i = this._ordered.length - 1; i >= 0; i--) {
      const sys = this._ordered[i];
      if (typeof sys.dispose === 'function') sys.dispose();
    }
    this._ordered.length = 0;
    this._systems.clear();
    this.ctx.events.clear();
    this.ctx.renderer.dispose();
    this._running = false;
    this._ready = false;
  }

  get ready() {
    return this._ready;
  }

  /**
   * Snapshot of recent frame times (ms) for tools/perf.mjs.
   * @returns {{ times: Float64Array, count: number, write: number }}
   */
  frameTimeBuffer() {
    return {
      times: this._frameTimes,
      count: this._frameTimeCount,
      write: this._frameTimeWrite,
    };
  }

  // -----------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {boolean} silent  boot/prewarm: still advances time, no ready side-effects
   */
  _stepFrame(dt, silent) {
    const t0 = performance.now();
    const ctx = this.ctx;
    const time = ctx.time;
    const h = time.fixedDt;

    time.dt = dt;
    time.elapsed += dt;
    time.accumulator += dt;

    // fixedUpdate @ 120Hz
    // Cap steps per frame to avoid death spiral on long stalls.
    let steps = 0;
    const maxSteps = 8;
    while (time.accumulator >= h && steps < maxSteps) {
      for (const sys of this._ordered) {
        if (typeof sys.fixedUpdate === 'function') sys.fixedUpdate(h, ctx);
      }
      time.accumulator -= h;
      time.fixedFrame += 1;
      steps += 1;
    }
    // Drop residual if we hit the cap so alpha stays meaningful.
    if (steps === maxSteps && time.accumulator >= h) {
      time.accumulator = time.accumulator % h;
    }

    // alpha for render interpolation between physics ticks
    time.alpha = time.accumulator / h;

    // update(dt)
    for (const sys of this._ordered) {
      if (typeof sys.update === 'function') sys.update(dt, ctx);
    }

    // lateUpdate(dt)
    for (const sys of this._ordered) {
      if (typeof sys.lateUpdate === 'function') sys.lateUpdate(dt, ctx);
    }

    // render
    this._render();

    ctx.input.endFrame();
    time.frame += 1;

    const t1 = performance.now();
    if (!silent) {
      this._recordFrameTime(t1 - t0);
      this._advanceBoot();
    }
  }

  _render() {
    const { renderer, scene, camera, viewScene, viewCamera } = this.ctx;
    const info = renderer.info;

    // World pass
    renderer.autoClear = true;
    renderer.render(scene, camera);
    this._drawWorld = info.render.calls;
    this._triWorld = info.render.triangles;

    // Viewmodel pass — clear depth so the gun draws on top of the world.
    this._drawView = 0;
    this._triView = 0;
    if (viewScene.children.length > 0 && viewCamera.children.length > 0) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
      // After second pass, info is view-only; total = world + view
      this._drawView = info.render.calls;
      this._triView = info.render.triangles;
      renderer.autoClear = true;
    }
  }

  /**
   * Honest draw stats: world and viewmodel measured separately.
   * `drawCalls` = world + view (prefer this over renderer.info alone).
   */
  drawStats() {
    const world = this._drawWorld | 0;
    const view = this._drawView | 0;
    return {
      world,
      view,
      total: world + view,
      trianglesWorld: this._triWorld | 0,
      trianglesView: this._triView | 0,
      trianglesTotal: (this._triWorld | 0) + (this._triView | 0),
    };
  }

  _recordFrameTime(ms) {
    const i = this._frameTimeWrite;
    this._frameTimes[i] = ms;
    this._frameTimeWrite = (i + 1) % this._frameTimes.length;
    if (this._frameTimeCount < this._frameTimes.length) {
      this._frameTimeCount += 1;
    }
  }

  _advanceBoot() {
    if (this._ready) return;
    if (this._bootLeft > 0) {
      this._bootLeft -= 1;
    }
    if (this._bootLeft === 0) {
      // Mark ready: from this point shader compiles are counted as after-ready.
      this._ready = true;
      const stats = this.ctx._programStats;
      if (stats) stats.ready = true;
    }
  }
}

/**
 * Kahn topo-sort of system classes by static deps.
 * @param {SystemClass[]} classes
 * @returns {SystemClass[]}
 */
function topoSort(classes) {
  /** @type {Map<string, SystemClass>} */
  const byId = new Map();
  for (const Cls of classes) {
    if (byId.has(Cls.id)) {
      throw new Error(`Duplicate system id during sort: ${Cls.id}`);
    }
    byId.set(Cls.id, Cls);
  }

  /** @type {Map<string, string[]>} */
  const depsOf = new Map();
  /** @type {Map<string, number>} */
  const indegree = new Map();
  /** @type {Map<string, string[]>} */
  const dependents = new Map();

  for (const Cls of classes) {
    const deps = Array.isArray(Cls.deps) ? Cls.deps : [];
    depsOf.set(Cls.id, deps);
    indegree.set(Cls.id, 0);
    if (!dependents.has(Cls.id)) dependents.set(Cls.id, []);
  }

  for (const Cls of classes) {
    const deps = depsOf.get(Cls.id);
    for (const d of deps) {
      if (!byId.has(d)) {
        throw new Error(`System "${Cls.id}" depends on missing "${d}"`);
      }
      indegree.set(Cls.id, (indegree.get(Cls.id) ?? 0) + 1);
      dependents.get(d).push(Cls.id);
    }
  }

  /** @type {string[]} */
  const queue = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  // Stable: preserve registration order among zero-indegree nodes.
  queue.sort((a, b) => {
    const ia = classes.findIndex((c) => c.id === a);
    const ib = classes.findIndex((c) => c.id === b);
    return ia - ib;
  });

  /** @type {SystemClass[]} */
  const sorted = [];
  while (queue.length) {
    const id = queue.shift();
    sorted.push(byId.get(id));
    for (const depId of dependents.get(id) ?? []) {
      const next = (indegree.get(depId) ?? 1) - 1;
      indegree.set(depId, next);
      if (next === 0) queue.push(depId);
    }
  }

  if (sorted.length !== classes.length) {
    throw new Error('Cyclic system dependency detected');
  }
  return sorted;
}
