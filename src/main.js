import { MissionSystem } from './mission/MissionSystem.js';
import { Engine } from './core/index.js';
import { PhysicsSystem } from './physics/PhysicsSystem.js';
import { MaterialsSystem } from './materials/MaterialsSystem.js';
import { SkySystem } from './sky/SkySystem.js';
import { RenderSystem } from './render/RenderSystem.js';
import { WorldSystem } from './world/WorldSystem.js';
import { PlayerSystem } from './player/PlayerSystem.js';
import { WeaponsSystem } from './weapons/WeaponsSystem.js';
import { AiSystem } from './ai/AiSystem.js';
import { FxSystem } from './fx/FxSystem.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { UiSystem } from './ui/UiSystem.js';

/**
 * Boot entry. Composition root — registers systems, then starts or locksteps.
 *
 * Lockstep (tools/capture, tools/perf):
 *   ?lockstep=1&seed=N  OR  window.__LOCKSTEP__ = true before module load
 *   After bootFrames, window.__READY__ becomes true.
 *   External driver pumps via window.__PUMP__(n).
 */

function readQuery() {
  const q = new URLSearchParams(window.location.search);
  return {
    lockstep: q.get('lockstep') === '1' || window.__LOCKSTEP__ === true,
    seed: q.has('seed') ? Number(q.get('seed')) >>> 0 : undefined,
    width: q.has('w') ? Number(q.get('w')) | 0 : 1280,
    height: q.has('h') ? Number(q.get('h')) | 0 : 720,
  };
}

function installHooks(engine, lockstep) {
  // Pump exactly N display frames (lockstep driver).
  window.__PUMP__ = (n = 1) => {
    engine.pump(n);
    return {
      frame: engine.ctx.time.frame,
      ready: engine.ready,
      fixedFrame: engine.ctx.time.fixedFrame,
    };
  };

  Object.defineProperty(window, '__READY__', {
    configurable: true,
    get() {
      return engine.ready;
    },
  });

  window.__ENGINE__ = engine;

  window.__METRICS__ = () => {
    const ctx = engine.ctx;
    const buf = engine.frameTimeBuffer();
    const times = [];
    const n = buf.count;
    const len = buf.times.length;
    // Read ring buffer in chronological order.
    const start = n < len ? 0 : buf.write;
    for (let i = 0; i < n; i++) {
      times.push(buf.times[(start + i) % len]);
    }
    const prog = ctx._programStats;
    const draws = engine.drawStats();
    return {
      frame: ctx.time.frame,
      fixedFrame: ctx.time.fixedFrame,
      ready: engine.ready,
      frameTimesMs: times,
      rafTimesMs: engine._rafTimes.slice(-240),
      gpuTimesMs: engine.gpuTimer.samples.slice(-240),
      renderer: engine.rendererName,
      renderPixels: ctx.canvas.width * ctx.canvas.height,
      // Honest totals (world + viewmodel). Prefer these over renderer.info alone.
      drawCalls: draws.total,
      drawCallsWorld: draws.world,
      drawCallsView: draws.view,
      triangles: draws.trianglesTotal,
      trianglesWorld: draws.trianglesWorld,
      trianglesView: draws.trianglesView,
      programs: ctx.renderer.info.programs?.length ?? prog?.total ?? 0,
      shaderCompilesTotal: prog?.total ?? 0,
      shaderCompilesAfterReady: prog?.afterReady ?? 0,
      seed: ctx.config.seed,
    };
  };

  // Resize helper for tools.
  window.__RESIZE__ = (w, h) => {
    engine.resize(w, h);
  };

  if (!lockstep) {
    window.addEventListener('resize', () => {
      // The renderer assigns explicit CSS pixels to the canvas. Reading its
      // previous client size here keeps an old viewport after panel resizing.
      engine.resize(window.innerWidth, window.innerHeight);
    });
  }
}

async function main() {
  const opts = readQuery();
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('#game canvas not found');
  }

  // Fixed capture size in lockstep so baselines are stable.
  if (opts.lockstep) {
    canvas.style.width = `${opts.width}px`;
    canvas.style.height = `${opts.height}px`;
    canvas.width = opts.width;
    canvas.height = opts.height;
  }

  const config = { benchmark: new URLSearchParams(window.location.search).get('benchmark') === '1' };
  if (opts.seed !== undefined && !Number.isNaN(opts.seed)) {
    config.seed = opts.seed;
  }

  const engine = new Engine({
    canvas,
    config,
    lockstep: opts.lockstep,
  });

  // Systems topo-sorted via static deps.
  engine
    .add(PhysicsSystem)
    .add(MaterialsSystem)
    .add(SkySystem)
    .add(RenderSystem)
    .add(WorldSystem)
    .add(PlayerSystem)
    .add(WeaponsSystem)
    .add(AiSystem)
    .add(MissionSystem)
    .add(FxSystem)
    .add(AudioSystem)
    .add(UiSystem);

  installHooks(engine, opts.lockstep);
  await engine.init();
  engine.ctx.events.emit('session:reset', { ...engine.ctx.get('mission').restore(true), full: true });

  // Force sized surface after init (init may have used clientWidth).
  if (opts.lockstep) {
    engine.resize(opts.width, opts.height);
  } else {
    engine.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  // 3-frame boot (fixed by config.bootFrames). After this, __READY__ is true.
  engine.pump(engine.ctx.config.bootFrames);

  if (opts.lockstep) {
    // Do not self-schedule. Tools drive via __PUMP__.
    window.__BOOT_COMPLETE__ = true;
  } else {
    engine.start();
  }
}

main().catch((err) => {
  console.error(err);
  window.__BOOT_ERROR__ = String(err && err.stack ? err.stack : err);
});
