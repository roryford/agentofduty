import * as THREE from 'three';

/**
 * Render pipeline config + shader prewarm.
 * Engine still issues the final renderer.render; this system owns quality settings.
 *
 * Public surface (ctx.get('render')):
 *   prewarmed: boolean
 *   setExposure(n)
 *
 * Traps handled:
 *   - Prewarm all materials under the full light graph before ready
 *   - Tone mapping ACES for night HDR practicals
 *   - Shadow path reserved (disabled Phase 2; contact via decals later)
 */

export class RenderSystem {
  static id = 'render';
  static deps = ['materials', 'sky'];

  constructor() {
    this.prewarmed = false;
    this._exposure = 1.7;
  }

  async init(ctx) {
    const r = ctx.renderer;

    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this._exposure;
    r.shadowMap.enabled = false;

    // Ensure pixel ratio cap (Retina)
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, ctx.config.maxPixelRatio));

    // Prewarm materials against live scene (lights already added by sky)
    const materials = ctx.get('materials');
    materials.prewarm(r, ctx.scene, ctx.camera);

    // Extra compile of full scene graph once meshes exist — world/ai init after
    // render in deps? world depends on materials+physics, not render.
    // Order: physics, materials, sky, render, world, ...
    // World meshes not yet created. Defer full-scene compile to late init via
    // a one-shot in update until world exists, or world triggers prewarm.
    this._needsSceneCompile = true;
    this.prewarmed = true;
  }

  /**
   * Called once after all systems init — engine inits systems in order, so
   * world/ai exist after render.init. Use first update for full-scene compile
   * while still before ready (boot frames).
   */
  update(_dt, ctx) {
    if (!this._needsSceneCompile) return;
    if (!ctx.has('world')) return;
    this._needsSceneCompile = false;
    // Full scene compile with all meshes + lights present
    ctx.renderer.compile(ctx.scene, ctx.camera);
    if (ctx.viewScene.children.length > 0) {
      ctx.renderer.compile(ctx.viewScene, ctx.viewCamera);
    }
  }

  setExposure(n) {
    this._exposure = n;
  }

  lateUpdate(_dt, ctx) {
    if (ctx.renderer.toneMappingExposure !== this._exposure) {
      ctx.renderer.toneMappingExposure = this._exposure;
    }
  }

  dispose() {}
}
