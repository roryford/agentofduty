import * as THREE from 'three';
import {
  genAsphalt,
  genConcrete,
  genMetal,
  genFlesh,
  genPlaster,
} from './proc.js';

/** Optional Imagine facade overlay (hybrid art path). */
const FACADE_URL = './models/textures/facade_albedo.jpg';

/**
 * Procedural PBR material library.
 *
 * Public surface (ctx.get('materials')):
 *   get(tag) -> THREE.MeshStandardMaterial  (shared; do not dispose)
 *   getUnique(tag) -> cloned material (caller owns dispose)
 *   tags: string[]
 *   prewarm(renderer, scene, camera) -> void  // force program compile
 *
 * Tags align with physics surface tags where relevant:
 *   asphalt, concrete, metal, flesh, plaster, rubber
 *
 * Quality: albedo 0.02–0.9, metalness 0|1, normal+roughness variation.
 */

const TEX_SIZE = 512;

export class MaterialsSystem {
  static id = 'materials';
  static deps = [];

  constructor() {
    /** @type {Map<string, THREE.MeshStandardMaterial>} */
    this._mats = new Map();
    /** @type {THREE.Texture[]} */
    this._textures = [];
    this.tags = ['asphalt', 'concrete', 'metal', 'flesh', 'plaster', 'rubber'];
    this._seed = 1;
  }

  async init(ctx) {
    this._seed = ctx.config.seed ^ 0x4d415453;
    const rng = ctx.rng.fork();

    this._register(
      'asphalt',
      genAsphalt(TEX_SIZE, (rng.next() * 1e9) | 0),
      { metalness: 0, envIntensity: 0.55, repeat: 18, roughBase: 0.55 },
    );
    this._register(
      'concrete',
      genConcrete(TEX_SIZE, (rng.next() * 1e9) | 0),
      { metalness: 0, envIntensity: 0.4, repeat: 8, roughBase: 0.75 },
    );
    this._register(
      'metal',
      genMetal(TEX_SIZE, (rng.next() * 1e9) | 0),
      { metalness: 1, envIntensity: 1.0, repeat: 4, roughBase: 0.4 },
    );
    this._register(
      'flesh',
      genFlesh(TEX_SIZE, (rng.next() * 1e9) | 0),
      { metalness: 0, envIntensity: 0.25, repeat: 2, roughBase: 0.65 },
    );
    this._register(
      'plaster',
      genPlaster(TEX_SIZE, (rng.next() * 1e9) | 0),
      { metalness: 0, envIntensity: 0.35, repeat: 5, roughBase: 0.8 },
    );
    this._register(
      'rubber',
      genAsphalt(TEX_SIZE, (rng.next() * 1e9) | 0),
      { metalness: 0, envIntensity: 0.2, repeat: 3, roughBoost: 0.35, roughBase: 0.9 },
    );

    // Alias physics tags
    this._mats.set('dirt', this._mats.get('asphalt'));
    this._mats.set('wood', this._mats.get('concrete'));
    this._mats.set('glass', this._mats.get('metal'));
    this._mats.set('water', this._mats.get('asphalt'));
    this._mats.set('foliage', this._mats.get('concrete'));
    this._mats.set('fabric', this._mats.get('flesh'));

    // Imagine façade texture layered onto buildings (best-effort)
    await this._tryLoadFacade();
  }

  /**
   * Replace concrete albedo with Imagine facade if present.
   */
  async _tryLoadFacade() {
    try {
      const loader = new THREE.TextureLoader();
      const tex = await new Promise((resolve, reject) => {
        loader.load(FACADE_URL, resolve, undefined, reject);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(4, 4);
      tex.anisotropy = 16;
      tex.generateMipmaps = true;
      const concrete = this._mats.get('concrete');
      if (concrete) {
        // Keep procedural as fallback detail: use Imagine as primary map
        if (concrete.map) {
          // dispose old procedural albedo only if we fully replace
          const old = concrete.map;
          concrete.map = tex;
          old.dispose();
        } else {
          concrete.map = tex;
        }
        concrete.needsUpdate = true;
        this._textures.push(tex);
      }
    } catch {
      // Procedural concrete remains
    }
  }

  /**
   * @param {string} tag
   * @param {{ albedo: Uint8ClampedArray, rough: Uint8ClampedArray, normal: Uint8ClampedArray, metalness?: number }} maps
   * @param {{ metalness: number, envIntensity: number, repeat: number, roughBoost?: number }} opts
   */
  _register(tag, maps, opts) {
    const albedo = this._tex(maps.albedo, true);
    const rough = this._tex(maps.rough, false);
    const normal = this._tex(maps.normal, false);

    albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
    rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    albedo.repeat.set(opts.repeat, opts.repeat);
    rough.repeat.set(opts.repeat, opts.repeat);
    normal.repeat.set(opts.repeat, opts.repeat);

    // Roughness map is grayscale in R; three uses green channel for roughness when
    // combined — standalone roughnessMap uses G. Our bake stores in RGB equally.
    const roughMul =
      opts.roughBase !== undefined
        ? opts.roughBase
        : opts.roughBoost !== undefined
          ? 0.55 + opts.roughBoost
          : 0.7;
    const mat = new THREE.MeshStandardMaterial({
      map: albedo,
      roughnessMap: rough,
      normalMap: normal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      metalness: maps.metalness !== undefined ? maps.metalness : opts.metalness,
      roughness: roughMul,
      color: 0xffffff,
      envMapIntensity: opts.envIntensity,
      flatShading: false,
    });
    mat.name = `mat_${tag}`;
    // Prevent accidental disposal of shared assets
    mat.userData.shared = true;
    this._mats.set(tag, mat);
  }

  /**
   * @param {Uint8ClampedArray} data
   * @param {boolean} srgb
   */
  _tex(data, srgb) {
    const tex = new THREE.DataTexture(data, TEX_SIZE, TEX_SIZE, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    this._textures.push(tex);
    return tex;
  }

  /**
   * Shared material for a surface tag. Never dispose.
   * @param {string} tag
   */
  get(tag) {
    const m = this._mats.get(tag) || this._mats.get('concrete');
    if (!m) throw new Error(`materials: unknown tag ${tag}`);
    return m;
  }

  /**
   * Unique clone for instances that need independent color flash etc.
   * Caller must dispose.
   * @param {string} tag
   */
  getUnique(tag) {
    const base = this.get(tag);
    const clone = base.clone();
    clone.userData.shared = false;
    return clone;
  }

  /**
   * Force-compile all materials with a full light count so runtime toggles
   * never recompile (ballast lights stay visible:true).
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  prewarm(renderer, scene, camera) {
    // Compile off-camera so a leftover mesh can never appear in capture.
    const dummy = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05));
    dummy.frustumCulled = false;
    dummy.position.set(0, -999, 0);
    dummy.visible = true;
    const seen = new Set();
    scene.add(dummy);
    for (const mat of this._mats.values()) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      dummy.material = mat;
      renderer.compile(scene, camera);
    }
    scene.remove(dummy);
    dummy.geometry.dispose();
  }

  dispose() {
    for (const mat of new Set(this._mats.values())) {
      mat.dispose();
    }
    this._mats.clear();
    for (const t of this._textures) t.dispose();
    this._textures.length = 0;
  }
}
