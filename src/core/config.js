/** Separate submission cost from observed display pacing (vsync has rounding jitter). */
export const PERFORMANCE_BUDGET = Object.freeze({
  cpuP95Ms: 16.67, rafP95Ms: 17.5, rafP99Ms: 25, gpuP50Ms: 8, maxDrawCalls: 512,
});

/**
 * Default engine configuration. Overridable via createConfig(overrides).
 */
export const DEFAULT_CONFIG = Object.freeze({
  /** Master seed for ctx.rng. */
  seed: 0xc0ffee01,
  /** Fixed-step rate (Hz). Frame order: fixedUpdate @ this rate. */
  fixedHz: 120,
  /** Nominal display rate used by lockstep pump dt. */
  displayHz: 60,
  /** Boot frames before lockstep signals ready. */
  bootFrames: 3,
  /** Canvas clear color (night street default). */
  clearColor: 0x0c1018,
  /** WebGL2 only. */
  webgl2: true,
  /** Pixel ratio cap (Retina-friendly but bounded). */
  maxPixelRatio: 2,
  maxRenderPixels: 2560 * 1440,
  /** Perf budgets (asserted by tools/perf.mjs). */
  perf: Object.freeze({
    /** p95 frame time budget in ms at display rate. */
    p95FrameMs: PERFORMANCE_BUDGET.cpuP95Ms,
    /** Max draw calls after ready (world + viewmodel totals). */
    maxDrawCalls: PERFORMANCE_BUDGET.maxDrawCalls,
    /** Shader compiles allowed after ready — must stay 0. */
    maxShaderCompilesAfterReady: 0,
    /** Frames to sample for perf. */
    sampleFrames: 180,
  }),
});

/**
 * @param {Partial<typeof DEFAULT_CONFIG>} [overrides]
 */
export function createConfig(overrides = {}) {
  const seed =
    overrides.seed !== undefined
      ? overrides.seed >>> 0
      : DEFAULT_CONFIG.seed;

  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    seed,
    perf: {
      ...DEFAULT_CONFIG.perf,
      ...(overrides.perf ?? {}),
    },
  };
}
