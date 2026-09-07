import * as THREE from 'three';
import { createConfig } from './config.js';
import { createEvents } from './events.js';
import { createInput } from './input.js';
import { createRng } from './rng.js';
import { GameSession } from './session.js';
import { createTime } from './time.js';

/**
 * @typedef {object} EngineContext
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {THREE.Scene} viewScene
 * @property {THREE.PerspectiveCamera} viewCamera
 * @property {HTMLCanvasElement} canvas
 * @property {THREE.WebGLRenderer} renderer
 * @property {ReturnType<typeof createConfig>} config
 * @property {ReturnType<typeof createEvents>} events
 * @property {ReturnType<typeof createInput>} input
 * @property {ReturnType<typeof createTime>} time
 * @property {ReturnType<typeof createRng>} rng
 * @property {(id: string) => object} get
 * @property {(id: string) => object | null} peek
 * @property {(id: string) => boolean} has
 */

/**
 * Build the shared ctx object. Systems resolve each other at runtime via get/peek/has.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {Partial<ReturnType<typeof createConfig>>} [opts.config]
 * @param {Map<string, object>} opts.systems
 * @returns {EngineContext}
 */
export function createContext({ canvas, config: configOverrides = {}, systems }) {
  const config = createConfig(configOverrides);
  const events = createEvents();
  const input = createInput();
  const time = createTime(config.fixedHz);
  const rng = createRng(config.seed);

  // --- WebGL2 renderer ---------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
    // Force WebGL2
    context: canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // needed for tools/capture screenshots
    }),
  });

  if (!renderer.capabilities.isWebGL2) {
    throw new Error('WebGL2 is required');
  }

  renderer.setClearColor(config.clearColor, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.maxPixelRatio));
  renderer.autoClear = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  // Track shader program creation for perf gate (zero compiles after ready).
  const gl = renderer.getContext();
  const programStats = { total: 0, afterReady: 0, ready: false };
  const _createProgram = gl.createProgram.bind(gl);
  gl.createProgram = () => {
    programStats.total += 1;
    if (programStats.ready) programStats.afterReady += 1;
    return _createProgram();
  };

  // --- Scenes / cameras --------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.clearColor);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
  camera.position.set(0, 1.6, 0);
  scene.add(camera);

  // Viewmodel layer (weapon camera) — empty until weapons pass.
  const viewScene = new THREE.Scene();
  const viewCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
  viewScene.add(viewCamera);

  /** @type {EngineContext} */
  const ctx = {
    scene,
    camera,
    viewScene,
    viewCamera,
    canvas,
    renderer,
    config,
    events,
    input,
    time,
    rng,
    session: new GameSession({ events, input, lockstep: config.lockstep || config.benchmark }),
    get(id) {
      const sys = systems.get(id);
      if (!sys) throw new Error(`System not found: ${id}`);
      return sys;
    },
    peek(id) {
      return systems.get(id) ?? null;
    },
    has(id) {
      return systems.has(id);
    },
  };

  // Non-enumerable diagnostics for tools (not part of the public contract).
  Object.defineProperty(ctx, '_programStats', {
    value: programStats,
    enumerable: false,
  });

  return ctx;
}

/**
 * Apply canvas size to renderer and cameras.
 * @param {EngineContext} ctx
 * @param {number} w
 * @param {number} h
 */
export function resizeContext(ctx, w, h) {
  const width = Math.max(1, w | 0);
  const height = Math.max(1, h | 0);
  const ratio = Math.min(window.devicePixelRatio || 1, ctx.config.maxPixelRatio,
    Math.sqrt((ctx.config.maxRenderPixels || 3686400) / (width * height)));
  ctx.renderer.setPixelRatio(ratio);
  ctx.renderer.setSize(width, height, false);
  const aspect = width / height;
  ctx.camera.aspect = aspect;
  ctx.camera.updateProjectionMatrix();
  ctx.viewCamera.aspect = aspect;
  ctx.viewCamera.updateProjectionMatrix();
  // CSS size (backing store is set by setSize via pixel ratio).
  ctx.canvas.style.width = `${width}px`;
  ctx.canvas.style.height = `${height}px`;
}
