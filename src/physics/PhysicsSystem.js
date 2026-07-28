import * as THREE from 'three';
import { SURFACES } from './surfaces.js';

/**
 * Gray-box physics: AABB colliders, raycast, capsule vs world move.
 *
 * Public surface (via ctx.get('physics')):
 *   addBox({ minx,miny,minz, maxx,maxy,maxz, surface, layers, userData }) -> id
 *   remove(id)
 *   setEnabled(id, bool)
 *   setBox(id, minx..maxz)          // relocate dynamic AABB (enemy)
 *   raycast(ox,oy,oz, dx,dy,dz, maxDist, mask) -> hit | null
 *   moveCapsule(px,py,pz, radius, halfHeight, vx,vy,vz, h, mask) -> void (writes into out)
 *   out: { x,y,z, grounded, hitCeiling }
 *   getCollider(id)
 *
 * Layers (bitmask): STATIC=1, PLAYER=2, ENEMY=4, ALL=0xffffffff
 */

export const LAYER_STATIC = 1;
export const LAYER_PLAYER = 2;
export const LAYER_ENEMY = 4;
export const LAYER_ALL = 0xffffffff;

const MAX_COLLIDERS = 512;

export class PhysicsSystem {
  static id = 'physics';
  static deps = [];

  constructor() {
    // SoA-ish preallocated collider pool
    this._count = 0;
    this._alive = new Uint8Array(MAX_COLLIDERS);
    this._enabled = new Uint8Array(MAX_COLLIDERS);
    this._minX = new Float32Array(MAX_COLLIDERS);
    this._minY = new Float32Array(MAX_COLLIDERS);
    this._minZ = new Float32Array(MAX_COLLIDERS);
    this._maxX = new Float32Array(MAX_COLLIDERS);
    this._maxY = new Float32Array(MAX_COLLIDERS);
    this._maxZ = new Float32Array(MAX_COLLIDERS);
    this._layers = new Uint32Array(MAX_COLLIDERS);
    /** @type {string[]} */
    this._surface = new Array(MAX_COLLIDERS);
    /** @type {(object|null)[]} */
    this._userData = new Array(MAX_COLLIDERS);
    this._free = [];

    // Reused raycast result (callers must copy fields they need)
    this._hit = {
      collider: 0,
      distance: 0,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      surface: SURFACES.concrete,
      userData: null,
    };

    // Capsule move result
    this.out = {
      x: 0,
      y: 0,
      z: 0,
      grounded: false,
      hitCeiling: false,
    };

    // Temps
    this._tmpOrigin = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
  }

  async init(_ctx) {
    for (let i = 0; i < MAX_COLLIDERS; i++) {
      this._surface[i] = SURFACES.concrete;
      this._userData[i] = null;
      this._free.push(MAX_COLLIDERS - 1 - i);
    }
  }

  /**
   * @param {object} desc
   * @returns {number} collider id
   */
  addBox(desc) {
    if (this._free.length === 0) {
      throw new Error('PhysicsSystem: collider pool exhausted');
    }
    const id = this._free.pop();
    this._alive[id] = 1;
    this._enabled[id] = 1;
    this._minX[id] = desc.minx;
    this._minY[id] = desc.miny;
    this._minZ[id] = desc.minz;
    this._maxX[id] = desc.maxx;
    this._maxY[id] = desc.maxy;
    this._maxZ[id] = desc.maxz;
    this._layers[id] = desc.layers ?? LAYER_STATIC;
    this._surface[id] = desc.surface ?? SURFACES.concrete;
    this._userData[id] = desc.userData ?? null;
    this._count += 1;
    return id;
  }

  /**
   * @param {number} id
   */
  remove(id) {
    if (!this._alive[id]) return;
    this._alive[id] = 0;
    this._enabled[id] = 0;
    this._userData[id] = null;
    this._free.push(id);
    this._count -= 1;
  }

  /**
   * @param {number} id
   * @param {boolean} enabled
   */
  setEnabled(id, enabled) {
    if (!this._alive[id]) return;
    this._enabled[id] = enabled ? 1 : 0;
  }

  /**
   * Relocate an existing box (dynamic actors).
   */
  setBox(id, minx, miny, minz, maxx, maxy, maxz) {
    if (!this._alive[id]) return;
    this._minX[id] = minx;
    this._minY[id] = miny;
    this._minZ[id] = minz;
    this._maxX[id] = maxx;
    this._maxY[id] = maxy;
    this._maxZ[id] = maxz;
  }

  getCollider(id) {
    if (!this._alive[id]) return null;
    return {
      id,
      minx: this._minX[id],
      miny: this._minY[id],
      minz: this._minZ[id],
      maxx: this._maxX[id],
      maxy: this._maxY[id],
      maxz: this._maxZ[id],
      surface: this._surface[id],
      layers: this._layers[id],
      userData: this._userData[id],
      enabled: !!this._enabled[id],
    };
  }

  /**
   * Ray vs AABB. Returns this._hit or null. Do not retain across calls without copying.
   * @param {number} ox
   * @param {number} oy
   * @param {number} oz
   * @param {number} dx  direction (will be normalized)
   * @param {number} dy
   * @param {number} dz
   * @param {number} maxDist
   * @param {number} [mask]
   * @param {number} [ignoreId] collider id to skip
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = LAYER_ALL, ignoreId = -1) {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-8) return null;
    const inv = 1 / len;
    const rdx = dx * inv;
    const rdy = dy * inv;
    const rdz = dz * inv;

    let bestT = maxDist;
    let bestId = -1;
    let bestNx = 0;
    let bestNy = 1;
    let bestNz = 0;

    for (let i = 0; i < MAX_COLLIDERS; i++) {
      if (!this._alive[i] || !this._enabled[i]) continue;
      if (i === ignoreId) continue;
      if ((this._layers[i] & mask) === 0) continue;

      const hit = rayAabb(
        ox,
        oy,
        oz,
        rdx,
        rdy,
        rdz,
        this._minX[i],
        this._minY[i],
        this._minZ[i],
        this._maxX[i],
        this._maxY[i],
        this._maxZ[i],
        bestT,
      );
      if (hit && hit.t < bestT && hit.t >= 0) {
        bestT = hit.t;
        bestId = i;
        bestNx = hit.nx;
        bestNy = hit.ny;
        bestNz = hit.nz;
      }
    }

    if (bestId < 0) return null;

    const h = this._hit;
    h.collider = bestId;
    h.distance = bestT;
    h.pointX = ox + rdx * bestT;
    h.pointY = oy + rdy * bestT;
    h.pointZ = oz + rdz * bestT;
    h.normalX = bestNx;
    h.normalY = bestNy;
    h.normalZ = bestNz;
    h.surface = this._surface[bestId];
    h.userData = this._userData[bestId];
    return h;
  }

  /**
   * Axis-separated capsule (vertical) vs world AABBs.
   * Position is capsule center. halfHeight is center-to-sphere-center (total height = 2*halfHeight + 2*radius? )
   * Convention: total capsule height H includes hemispheres; radius R;
   * center at mid-height. halfHeight = H/2 - R (cylinder half).
   * Writes into this.out.
   */
  moveCapsule(px, py, pz, radius, halfHeight, vx, vy, vz, _h, mask = LAYER_STATIC) {
    let x = px + vx;
    let y = py + vy;
    let z = pz + vz;
    let grounded = false;
    let hitCeiling = false;

    // X then Z then Y — classic character controller order
    const pad = radius;

    // --- X ---
    {
      const minx = x - pad;
      const maxx = x + pad;
      const miny = y - halfHeight - radius + 0.02;
      const maxy = y + halfHeight + radius - 0.02;
      const minz = z - pad * 0.9;
      const maxz = z + pad * 0.9;
      const corr = this._resolveAxis(minx, miny, minz, maxx, maxy, maxz, 0, mask);
      x += corr;
    }
    // --- Z ---
    {
      const minx = x - pad * 0.9;
      const maxx = x + pad * 0.9;
      const miny = y - halfHeight - radius + 0.02;
      const maxy = y + halfHeight + radius - 0.02;
      const minz = z - pad;
      const maxz = z + pad;
      const corr = this._resolveAxis(minx, miny, minz, maxx, maxy, maxz, 2, mask);
      z += corr;
    }
    // --- Y ---
    {
      const minx = x - pad * 0.9;
      const maxx = x + pad * 0.9;
      const miny = y - halfHeight - radius;
      const maxy = y + halfHeight + radius;
      const minz = z - pad * 0.9;
      const maxz = z + pad * 0.9;
      const before = y;
      const corr = this._resolveAxis(minx, miny, minz, maxx, maxy, maxz, 1, mask);
      y += corr;
      if (corr > 0 && before + vy <= py + 1e-5) grounded = true;
      if (corr < 0 && vy > 0) hitCeiling = true;
      // Ground snap probe
      if (!grounded && vy <= 0) {
        const probe = this.raycast(
          x,
          y,
          z,
          0,
          -1,
          0,
          halfHeight + radius + 0.08,
          mask,
        );
        if (probe) {
          const feet = y - halfHeight - radius;
          const groundY = probe.pointY;
          if (feet - groundY < 0.08 && feet - groundY > -0.02) {
            y += groundY - feet;
            grounded = true;
          }
        }
      }
    }

    this.out.x = x;
    this.out.y = y;
    this.out.z = z;
    this.out.grounded = grounded;
    this.out.hitCeiling = hitCeiling;
    return this.out;
  }

  /**
   * Push capsule AABB out of overlapping boxes on one axis.
   * axis: 0=x, 1=y, 2=z. Returns delta along that axis.
   */
  _resolveAxis(minx, miny, minz, maxx, maxy, maxz, axis, mask) {
    let corr = 0;
    for (let i = 0; i < MAX_COLLIDERS; i++) {
      if (!this._alive[i] || !this._enabled[i]) continue;
      if ((this._layers[i] & mask) === 0) continue;

      const bminx = this._minX[i];
      const bminy = this._minY[i];
      const bminz = this._minZ[i];
      const bmaxx = this._maxX[i];
      const bmaxy = this._maxY[i];
      const bmaxz = this._maxZ[i];

      const aminx = minx + (axis === 0 ? corr : 0);
      const aminy = miny + (axis === 1 ? corr : 0);
      const aminz = minz + (axis === 2 ? corr : 0);
      const amaxx = maxx + (axis === 0 ? corr : 0);
      const amaxy = maxy + (axis === 1 ? corr : 0);
      const amaxz = maxz + (axis === 2 ? corr : 0);

      if (
        aminx >= bmaxx ||
        amaxx <= bminx ||
        aminy >= bmaxy ||
        amaxy <= bminy ||
        aminz >= bmaxz ||
        amaxz <= bminz
      ) {
        continue;
      }

      // Overlap depths
      const ox1 = amaxx - bminx;
      const ox2 = bmaxx - aminx;
      const oy1 = amaxy - bminy;
      const oy2 = bmaxy - aminy;
      const oz1 = amaxz - bminz;
      const oz2 = bmaxz - aminz;
      const ox = ox1 < ox2 ? -ox1 : ox2;
      const oy = oy1 < oy2 ? -oy1 : oy2;
      const oz = oz1 < oz2 ? -oz1 : oz2;

      if (axis === 0) {
        // Prefer resolving on X only if it's the primary penetration
        if (Math.abs(ox) <= Math.abs(oy) + 1e-4 && Math.abs(ox) <= Math.abs(oz) + 1e-4) {
          corr += ox;
        }
      } else if (axis === 1) {
        if (Math.abs(oy) <= Math.abs(ox) + 1e-4 && Math.abs(oy) <= Math.abs(oz) + 1e-4) {
          corr += oy;
        }
      } else {
        if (Math.abs(oz) <= Math.abs(ox) + 1e-4 && Math.abs(oz) <= Math.abs(oy) + 1e-4) {
          corr += oz;
        }
      }
    }
    return corr;
  }

  /**
   * Is a world-space point inside any solid (STATIC) box?
   */
  pointBlocked(x, y, z, mask = LAYER_STATIC) {
    for (let i = 0; i < MAX_COLLIDERS; i++) {
      if (!this._alive[i] || !this._enabled[i]) continue;
      if ((this._layers[i] & mask) === 0) continue;
      if (
        x >= this._minX[i] &&
        x <= this._maxX[i] &&
        y >= this._minY[i] &&
        y <= this._maxY[i] &&
        z >= this._minZ[i] &&
        z <= this._maxZ[i]
      ) {
        return true;
      }
    }
    return false;
  }

  dispose() {
    this._count = 0;
    this._free.length = 0;
    for (let i = 0; i < MAX_COLLIDERS; i++) {
      this._alive[i] = 0;
      this._enabled[i] = 0;
      this._userData[i] = null;
      this._free.push(i);
    }
  }
}

/**
 * Slab ray/AABB. Returns {t, nx, ny, nz} or null.
 * Mutates a reused object via closure-local — returns plain object; called often.
 * Preallocate one result to avoid GC in hot path.
 */
const _rayHit = { t: 0, nx: 0, ny: 1, nz: 0 };

function rayAabb(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxT) {
  let tmin = 0;
  let tmax = maxT;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  // X
  if (Math.abs(dx) < 1e-12) {
    if (ox < minx || ox > maxx) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minx - ox) * inv;
    let t2 = (maxx - ox) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    } else {
      n = -1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y
  if (Math.abs(dy) < 1e-12) {
    if (oy < miny || oy > maxy) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (miny - oy) * inv;
    let t2 = (maxy - oy) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    } else {
      n = -1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Z
  if (Math.abs(dz) < 1e-12) {
    if (oz < minz || oz > maxz) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (minz - oz) * inv;
    let t2 = (maxz - oz) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    } else {
      n = -1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = 0;
      nz = n;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > maxT) return null;
  _rayHit.t = tmin;
  _rayHit.nx = nx;
  _rayHit.ny = ny;
  _rayHit.nz = nz;
  return _rayHit;
}
