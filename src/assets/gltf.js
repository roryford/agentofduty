import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

/**
 * Shared GLTF loading for hybrid Blender hero meshes.
 * Textures/lights/audio stay procedural — only hero meshes ship as GLB.
 */

const loader = new GLTFLoader();
/** @type {Map<string, Promise<THREE.Group>>} */
const cache = new Map();

/**
 * Load a GLB/GLTF once; returns a cloneable template Group (scene root).
 * @param {string} url  e.g. './models/rifle.glb'
 * @returns {Promise<THREE.Group>}
 */
export function loadModelTemplate(url) {
  let p = cache.get(url);
  if (p) return p;

  p = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            o.frustumCulled = true;
            // Ensure materials work under our night lighting
            if (o.material) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              for (const m of mats) {
                if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
                  m.envMapIntensity = m.envMapIntensity ?? 0.5;
                  m.needsUpdate = true;
                }
              }
            }
          }
        });
        root.updateMatrixWorld(true);
        resolve(root);
      },
      undefined,
      (err) => reject(err),
    );
  });

  cache.set(url, p);
  return p;
}

/**
 * Deep-clone a loaded template for a new instance.
 * @param {THREE.Object3D} template
 * @returns {THREE.Object3D}
 */
export function cloneModel(template) {
  const c = template.clone(true);
  // Clone materials so flash/tint doesn't leak across instances
  c.traverse((o) => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => m.clone());
      } else {
        o.material = o.material.clone();
      }
    }
  });
  return c;
}

/**
 * Uniform-scale an object so its bounding-box height matches `targetHeight`.
 * Places feet on y=0. Returns measured size after fit.
 * @param {THREE.Object3D} obj
 * @param {number} targetHeight
 * @returns {{x:number,y:number,z:number}}
 */
export function fitHeight(obj, targetHeight) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 1e-6) return { x: size.x, y: size.y, z: size.z };
  const s = targetHeight / size.y;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  // Feet on ground
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  const final = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return { x: final.x, y: final.y, z: final.z };
}

/**
 * Fit longest horizontal axis to targetLength (keeps aspect). Feet on y=0.
 * @param {THREE.Object3D} obj
 * @param {number} targetLength
 */
export function fitLength(obj, targetLength) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const long = Math.max(size.x, size.z);
  if (long < 1e-6) return { x: size.x, y: size.y, z: size.z };
  const s = targetLength / long;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  const final = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return { x: final.x, y: final.y, z: final.z };
}

/**
 * World-space AABB size after current transform.
 * @param {THREE.Object3D} obj
 */
export function measure(obj) {
  obj.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return { x: size.x, y: size.y, z: size.z };
}

/**
 * Dispose geometry + materials on a loaded instance (not the shared template).
 * @param {THREE.Object3D} root
 */
export function disposeModelInstance(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose?.();
    }
  });
}

/** Vite base-relative model URLs */
export const MODELS = {
  rifle: './models/rifle.glb',
  enemy: './models/enemy.glb',
  dumpster: './models/dumpster.glb',
  car: './models/car.glb',
};
