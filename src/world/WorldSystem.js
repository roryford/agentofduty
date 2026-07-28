import * as THREE from 'three';
import {
  cloneModel,
  fitHeight,
  fitLength,
  loadModelTemplate,
  measure,
  MODELS,
} from '../assets/gltf.js';

/**
 * Night rain-slicked street ~120×120m.
 *
 * Public surface (ctx.get('world')):
 *   room, playerSpawn, enemySpawn, nav
 *   isWalkable, worldToCell, cellToWorld, findPath, cellIndex
 */

const SIZE = 120;
const HALF = SIZE / 2;
const ROAD_HALF = 7; // roadway ±X
const SIDEWALK = 3;
const CELL = 2.0;
const LAYER_STATIC = 1;

export class WorldSystem {
  static id = 'world';
  static deps = ['physics', 'materials'];

  constructor() {
    this._roots = [];
    this._geoms = [];
    this._matsOwned = [];
    this._colliderIds = [];
    /** Instanced meshes for dispose */
    this._instanced = [];

    this.room = {
      minx: -HALF,
      maxx: HALF,
      minz: -HALF,
      maxz: HALF,
      floorY: 0,
    };

    // Looking down -Z; enemies spawn mid-block so they read in first 2s of play
    this.playerSpawn = { x: 0, y: 0, z: HALF - 12, yaw: 0 };
    this.enemySpawn = { x: 1.2, y: 0, z: 22 };

    this.nav = {
      cellSize: CELL,
      sizeX: 0,
      sizeZ: 0,
      originX: 0,
      originZ: 0,
    };

    this._walk = null;
    this._came = null;
    this._gScore = null;
    this._fScore = null;
    this._closed = null;
    this._heap = null;
    this._heapN = 0;
    this._tmpCell = { cx: 0, cz: 0 };
    this._tmpWorld = { x: 0, z: 0 };
  }

  async init(ctx) {
    const physics = ctx.get('physics');
    const materials = ctx.get('materials');
    const rng = ctx.rng.fork();

    const matRoad = materials.get('asphalt');
    const matWalk = materials.get('concrete');
    const matBldg = materials.get('concrete');
    const matMetal = materials.get('metal');
    const matPlaster = materials.get('plaster');

    const root = new THREE.Group();
    root.name = 'world';
    this._roots.push(root);
    ctx.scene.add(root);

    // --- Ground slabs (road + sidewalks) ---------------------------------
    // Road
    this._box(root, physics, 0, -0.12, 0, ROAD_HALF * 2, 0.24, SIZE, matRoad, 'concrete');
    // Sidewalks L/R
    const walkW = SIDEWALK;
    const walkX = ROAD_HALF + walkW * 0.5;
    this._box(root, physics, -walkX, -0.08, 0, walkW, 0.2, SIZE, matWalk, 'concrete');
    this._box(root, physics, walkX, -0.08, 0, walkW, 0.2, SIZE, matWalk, 'concrete');
    // Outer lots (slightly darker asphalt beyond sidewalk)
    const lotW = HALF - ROAD_HALF - SIDEWALK;
    const lotX = ROAD_HALF + SIDEWALK + lotW * 0.5;
    this._box(root, physics, -lotX, -0.14, 0, lotW, 0.22, SIZE, matRoad, 'concrete');
    this._box(root, physics, lotX, -0.14, 0, lotW, 0.22, SIZE, matRoad, 'concrete');

    // Curb strips (visual only — thin metal)
    const curbGeom = new THREE.BoxGeometry(0.15, 0.18, SIZE);
    this._geoms.push(curbGeom);
    for (const sx of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeom, matMetal);
      curb.position.set(sx * ROAD_HALF, 0.05, 0);
      root.add(curb);
    }

    // Center lane dashes — bright paint
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xc8c090,
      emissive: 0x3a3820,
      emissiveIntensity: 0.35,
      roughness: 0.85,
      metalness: 0,
    });
    this._matsOwned.push(dashMat);
    const dashGeom = new THREE.BoxGeometry(0.22, 0.03, 2.8);
    this._geoms.push(dashGeom);
    for (let z = -HALF + 4; z < HALF - 2; z += 7) {
      const dash = new THREE.Mesh(dashGeom, dashMat);
      dash.position.set(0, 0.03, z);
      root.add(dash);
    }

    // Wet puddle patches (dark glossy discs on road)
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c12,
      metalness: 0.15,
      roughness: 0.08,
      envMapIntensity: 1,
    });
    this._matsOwned.push(puddleMat);
    const puddleGeom = new THREE.CircleGeometry(1.4, 16);
    this._geoms.push(puddleGeom);
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(puddleGeom, puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(
        rng.float(-4.5, 4.5),
        0.02,
        rng.float(-HALF + 8, HALF - 8),
      );
      p.scale.set(rng.float(0.6, 1.8), rng.float(0.5, 1.4), 1);
      root.add(p);
    }

    // Window glass + dark frames
    const winWarm = new THREE.MeshStandardMaterial({
      color: 0x2a1c08,
      emissive: 0xffb060,
      emissiveIntensity: 1.4,
      roughness: 0.65,
      metalness: 0,
      toneMapped: true,
    });
    const winCool = new THREE.MeshStandardMaterial({
      color: 0x0a1420,
      emissive: 0x70a0e0,
      emissiveIntensity: 1.2,
      roughness: 0.65,
      metalness: 0,
    });
    const winDim = new THREE.MeshStandardMaterial({
      color: 0x0c0c10,
      emissive: 0x3a4555,
      emissiveIntensity: 0.45,
      roughness: 0.8,
      metalness: 0,
    });
    const winFrame = new THREE.MeshStandardMaterial({
      color: 0x0e1014,
      metalness: 0.35,
      roughness: 0.75,
      emissive: 0x000000,
    });
    this._matsOwned.push(winWarm, winCool, winDim, winFrame);
    this._winMats = [winWarm, winCool, winDim];
    this._winFrame = winFrame;

    // Brighter prop material so cover isn't pure black silhouette
    this._propMat = new THREE.MeshStandardMaterial({
      color: 0x5a6070,
      metalness: 0.55,
      roughness: 0.45,
      emissive: 0x12151c,
      emissiveIntensity: 0.2,
    });
    this._carBodyMat = new THREE.MeshStandardMaterial({
      color: 0x3a4558,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x0a1018,
      emissiveIntensity: 0.15,
    });
    this._carCabinMat = new THREE.MeshStandardMaterial({
      color: 0x1a2030,
      metalness: 0.3,
      roughness: 0.25,
      emissive: 0x102030,
      emissiveIntensity: 0.4,
    });
    this._matsOwned.push(this._propMat, this._carBodyMat, this._carCabinMat);

    // --- Building masses lining the street --------------------------------
    const facade = ROAD_HALF + SIDEWALK + 0.5;
    this._buildBlockRow(root, physics, matBldg, matPlaster, matMetal, -1, facade, rng);
    this._buildBlockRow(root, physics, matBldg, matPlaster, matMetal, 1, facade, rng);

    // End-cap buildings (close the vista)
    this._box(root, physics, 0, 6, -HALF + 2, 40, 12, 4, matBldg, 'concrete');
    this._box(root, physics, 0, 5, HALF - 2, 36, 10, 4, matBldg, 'concrete');

    // Optional Blender hero props
    try {
      this._dumpsterTpl = await loadModelTemplate(MODELS.dumpster);
    } catch {
      this._dumpsterTpl = null;
    }
    try {
      this._carTpl = await loadModelTemplate(MODELS.car);
    } catch {
      this._carTpl = null;
    }

    // --- Street cover / props --------------------------------------------
    this._scatterCover(root, physics, matMetal, matBldg, rng);

    // Parked cars along curbs
    this._parkedCars(root, physics, matMetal, matPlaster, rng);

    this._buildNav(physics);
  }

  /**
   * Row of buildings on one side of the street.
   * @param {-1|1} side
   */
  _buildBlockRow(root, physics, matBldg, matPlaster, matMetal, side, facade, rng) {
    let z = -HALF + 6;
    while (z < HALF - 6) {
      const depth = rng.float(8, 16);
      const width = rng.float(10, 22);
      const height = rng.float(8, 22);
      const gap = rng.float(1.5, 4.5);
      const cx = side * (facade + depth * 0.5 + rng.float(0, 2));
      const cz = z + width * 0.5;

      // Main mass
      this._box(root, physics, cx, height * 0.5, cz, depth, height, width, matBldg, 'concrete');

      // Roofline setback
      if (height > 12 && rng.float() > 0.4) {
        const h2 = rng.float(3, 6);
        this._box(
          root,
          physics,
          cx + side * 1.2,
          height + h2 * 0.5,
          cz,
          depth * 0.55,
          h2,
          width * 0.7,
          matPlaster,
          'plaster',
        );
      }

      // Window grid on street façade (normal ±X): thin in X, tall in Y, wide in Z
      const floors = Math.max(2, (height / 3.1) | 0);
      const cols = Math.max(2, (width / 3.2) | 0);
      const faceX = cx - side * (depth * 0.5 - 0.02);
      for (let f = 1; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          if (rng.float() > 0.72) continue; // dark rooms
          const wy = f * 3.05 + 1.15;
          const wz =
            cz - width * 0.5 + 1.8 + c * ((width - 3.6) / Math.max(1, cols - 1));
          const mat = this._winMats[(f + c) % this._winMats.length];
          // size = (thickness X, height Y, width Z) for ±X-facing walls
          const frame = new THREE.Mesh(
            this._sharedBox(0.06, 1.4, 1.7),
            this._winFrame,
          );
          frame.position.set(faceX, wy, wz);
          root.add(frame);
          // Glass slightly proud of frame toward street
          const glass = new THREE.Mesh(this._sharedBox(0.04, 1.1, 1.35), mat);
          glass.position.set(faceX - side * 0.04, wy, wz);
          root.add(glass);
        }
      }

      // Floor ledge along façade
      if (rng.float() > 0.35) {
        const ledge = new THREE.Mesh(
          this._sharedBox(0.28, 0.16, width * 0.9),
          matMetal,
        );
        ledge.position.set(faceX - side * 0.12, height * 0.45, cz);
        root.add(ledge);
      }

      z += width + gap;
    }
  }

  _sharedBox(w, h, d) {
    // Cache a few sizes — simple map by key
    if (!this._boxCache) this._boxCache = new Map();
    const key = `${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}`;
    let g = this._boxCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this._geoms.push(g);
      this._boxCache.set(key, g);
    }
    return g;
  }

  _scatterCover(root, physics, matMetal, matBldg, rng) {
    // Dumpsters / barriers in road margins (keep center lane open)
    const spots = [];
    for (let z = -HALF + 10; z < HALF - 10; z += 9) {
      for (const side of [-1, 1]) {
        if (rng.float() > 0.35) {
          spots.push({
            x: side * (ROAD_HALF - 1.2 + rng.float(0, 0.6)),
            z: z + rng.float(-2, 2),
            w: rng.float(1.4, 2.4),
            d: rng.float(1.0, 1.8),
            h: rng.float(1.0, 1.6),
            metal: rng.float() > 0.45,
          });
        }
      }
      // Occasional center-offset cover (not dead-center)
      if (rng.float() > 0.55) {
        spots.push({
          x: rng.float(-3.5, 3.5),
          z: z + rng.float(-1, 1),
          w: rng.float(1.2, 2.0),
          d: rng.float(1.2, 2.2),
          h: rng.float(0.9, 1.4),
          metal: rng.float() > 0.5,
        });
      }
    }

    for (const s of spots) {
      const yaw = rng.float(-0.15, 0.15);
      if (s.metal && this._dumpsterTpl && rng.float() > 0.3) {
        const d = cloneModel(this._dumpsterTpl);
        // Real commercial dumpster ~2.05m long, 1.25m tall
        fitHeight(d, 1.25);
        d.position.x = s.x;
        d.position.z = s.z;
        d.rotation.y = yaw + (rng.float() > 0.5 ? Math.PI / 2 : 0);
        root.add(d);
        const sz = measure(d);
        this._box(
          root,
          physics,
          s.x,
          sz.y * 0.5,
          s.z,
          Math.max(sz.x, 0.8),
          sz.y,
          Math.max(sz.z, 0.8),
          this._propMat,
          'metal',
          { yaw, visual: false },
        );
      } else {
        // Concrete jersey barriers — squat and wide, not bin-shaped
        const w = rng.float(1.8, 2.6);
        const h = rng.float(0.85, 1.1);
        const d = rng.float(0.55, 0.75);
        this._box(
          root,
          physics,
          s.x,
          h * 0.5,
          s.z,
          w,
          h,
          d,
          s.metal ? this._propMat : matBldg,
          s.metal ? 'metal' : 'concrete',
          { yaw },
        );
      }
    }
  }

  _parkedCars(root, physics, matMetal, matBody, rng) {
    // Park along curb, long axis parallel to street (±Z)
    for (let z = -HALF + 16; z < HALF - 16; z += 16) {
      for (const side of [-1, 1]) {
        if (rng.float() > 0.35) continue;
        // Curb pocket — outside roadway, on sidewalk edge
        const x = side * (ROAD_HALF + 2.4 + rng.float(0, 0.5));
        if (this._carTpl) {
          const car = cloneModel(this._carTpl);
          // Model length is along X in Blender export; rotate so length // street Z
          car.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          // Compact sedan overall length ~4.55 m
          fitLength(car, 4.55);
          car.position.x = x;
          car.position.z = z;
          // re-ground after rotate+fit
          car.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(car);
          car.position.y -= box.min.y;
          root.add(car);
          const sz = measure(car);
          this._box(
            root,
            physics,
            x,
            sz.y * 0.5,
            z,
            sz.x,
            sz.y,
            sz.z,
            this._carBodyMat,
            'metal',
            { visual: false },
          );
        } else {
          // Fallback boxes at real sedan scale
          const len = 4.5;
          const w = 1.85;
          const h = 1.45;
          this._box(root, physics, x, h * 0.4, z, w, h * 0.7, len, this._carBodyMat, 'metal');
          this._box(
            root,
            physics,
            x,
            h * 0.85,
            z,
            w * 0.88,
            h * 0.4,
            len * 0.45,
            this._carCabinMat,
            'metal',
          );
        }
      }
    }
  }

  _box(root, physics, x, y, z, w, h, d, mat, surface, opts = {}) {
    if (opts.visual !== false) {
      const geom = this._sharedBox(w, h, d);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      if (opts.yaw) mesh.rotation.y = opts.yaw;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      root.add(mesh);
    }

    const hx = w * 0.5;
    const hy = h * 0.5;
    const hz = d * 0.5;
    const id = physics.addBox({
      minx: x - hx,
      miny: y - hy,
      minz: z - hz,
      maxx: x + hx,
      maxy: y + hy,
      maxz: z + hz,
      surface,
      layers: LAYER_STATIC,
      userData: { kind: 'world' },
    });
    this._colliderIds.push(id);
  }

  _buildNav(physics) {
    const { minx, maxx, minz, maxz } = this.room;
    const sizeX = Math.floor((maxx - minx) / CELL);
    const sizeZ = Math.floor((maxz - minz) / CELL);
    this.nav.sizeX = sizeX;
    this.nav.sizeZ = sizeZ;
    this.nav.originX = minx + CELL * 0.5;
    this.nav.originZ = minz + CELL * 0.5;

    const n = sizeX * sizeZ;
    this._walk = new Uint8Array(n);
    this._came = new Int32Array(n);
    this._gScore = new Float32Array(n);
    this._fScore = new Float32Array(n);
    this._closed = new Uint8Array(n);
    this._heap = new Int32Array(n);

    const probeY = 0.9;
    // Walkable = road + sidewalk band (not deep lots / building interiors)
    const walkLimit = ROAD_HALF + SIDEWALK - 0.3;
    for (let cz = 0; cz < sizeZ; cz++) {
      for (let cx = 0; cx < sizeX; cx++) {
        const wx = this.nav.originX + cx * CELL;
        const wz = this.nav.originZ + cz * CELL;
        let walkable = Math.abs(wx) <= walkLimit;
        if (walkable) {
          let blocked = physics.pointBlocked(wx, probeY, wz, LAYER_STATIC);
          if (!blocked) {
            const r = 0.4;
            blocked =
              physics.pointBlocked(wx + r, probeY, wz, LAYER_STATIC) ||
              physics.pointBlocked(wx - r, probeY, wz, LAYER_STATIC) ||
              physics.pointBlocked(wx, probeY, wz + r, LAYER_STATIC) ||
              physics.pointBlocked(wx, probeY, wz - r, LAYER_STATIC);
          }
          walkable = !blocked;
        }
        this._walk[cz * sizeX + cx] = walkable ? 1 : 0;
      }
    }

    this._forceWalkable(this.playerSpawn.x, this.playerSpawn.z);
    this._forceWalkable(this.enemySpawn.x, this.enemySpawn.z);
  }

  _forceWalkable(x, z) {
    const c = this.worldToCell(x, z);
    if (!c) return;
    this._walk[c.cz * this.nav.sizeX + c.cx] = 1;
    // Clear neighborhood so spawn isn't a single island
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = c.cx + dx;
        const nz = c.cz + dz;
        if (nx >= 0 && nz >= 0 && nx < this.nav.sizeX && nz < this.nav.sizeZ) {
          this._walk[nz * this.nav.sizeX + nx] = 1;
        }
      }
    }
  }

  isWalkable(x, z) {
    const c = this.worldToCell(x, z);
    if (!c) return false;
    return this._walk[c.cz * this.nav.sizeX + c.cx] === 1;
  }

  worldToCell(x, z) {
    const cx = Math.round((x - this.nav.originX) / CELL);
    const cz = Math.round((z - this.nav.originZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.nav.sizeX || cz >= this.nav.sizeZ) return null;
    this._tmpCell.cx = cx;
    this._tmpCell.cz = cz;
    return this._tmpCell;
  }

  cellToWorld(cx, cz, out = this._tmpWorld) {
    out.x = this.nav.originX + cx * CELL;
    out.z = this.nav.originZ + cz * CELL;
    return out;
  }

  cellIndex(cx, cz) {
    return cz * this.nav.sizeX + cx;
  }

  findPath(sx, sz, gx, gz, outPath) {
    const sc = this.worldToCell(sx, sz);
    const gc = this.worldToCell(gx, gz);
    if (!sc || !gc) return 0;

    const sizeX = this.nav.sizeX;
    const sizeZ = this.nav.sizeZ;
    const start = this.cellIndex(sc.cx, sc.cz);
    const goal = this.cellIndex(gc.cx, gc.cz);

    if (!this._walk[start] || !this._walk[goal]) return 0;
    if (start === goal) {
      outPath[0] = start;
      return 1;
    }

    this._came.fill(-1);
    this._gScore.fill(1e20);
    this._fScore.fill(1e20);
    this._closed.fill(0);
    this._heapN = 0;

    this._gScore[start] = 0;
    this._fScore[start] = heuristic(sc.cx, sc.cz, gc.cx, gc.cz);
    this._heapPush(start);

    const goalCx = gc.cx;
    const goalCz = gc.cz;

    while (this._heapN > 0) {
      const current = this._heapPop();
      if (current === goal) {
        let len = 0;
        let cur = goal;
        while (cur !== -1) {
          len += 1;
          cur = this._came[cur];
        }
        if (len > outPath.length) len = outPath.length;
        cur = goal;
        for (let i = len - 1; i >= 0; i--) {
          outPath[i] = cur;
          cur = this._came[cur];
        }
        return len;
      }
      if (this._closed[current]) continue;
      this._closed[current] = 1;

      const ccx = current % sizeX;
      const ccz = (current / sizeX) | 0;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = ccx + dx;
          const nz = ccz + dz;
          if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue;
          if (dx !== 0 && dz !== 0) {
            if (!this._walk[ccz * sizeX + nx] || !this._walk[nz * sizeX + ccx]) continue;
          }
          const ni = nz * sizeX + nx;
          if (!this._walk[ni] || this._closed[ni]) continue;
          const step = dx !== 0 && dz !== 0 ? 1.41421356 : 1;
          const tent = this._gScore[current] + step;
          if (tent >= this._gScore[ni]) continue;
          this._came[ni] = current;
          this._gScore[ni] = tent;
          this._fScore[ni] = tent + heuristic(nx, nz, goalCx, goalCz);
          this._heapPush(ni);
        }
      }
    }
    return 0;
  }

  _heapPush(i) {
    const heap = this._heap;
    let n = this._heapN;
    heap[n] = i;
    this._heapN = n + 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this._fScore[heap[p]] <= this._fScore[heap[n]]) break;
      const tmp = heap[p];
      heap[p] = heap[n];
      heap[n] = tmp;
      n = p;
    }
  }

  _heapPop() {
    const heap = this._heap;
    const out = heap[0];
    this._heapN -= 1;
    if (this._heapN === 0) return out;
    heap[0] = heap[this._heapN];
    let n = 0;
    const end = this._heapN;
    for (;;) {
      const l = n * 2 + 1;
      const r = l + 1;
      let smallest = n;
      if (l < end && this._fScore[heap[l]] < this._fScore[heap[smallest]]) smallest = l;
      if (r < end && this._fScore[heap[r]] < this._fScore[heap[smallest]]) smallest = r;
      if (smallest === n) break;
      const tmp = heap[n];
      heap[n] = heap[smallest];
      heap[smallest] = tmp;
      n = smallest;
    }
    return out;
  }

  dispose() {
    for (const root of this._roots) root.parent?.remove(root);
    for (const g of this._geoms) g.dispose();
    for (const m of this._matsOwned) m.dispose();
    this._roots.length = 0;
    this._geoms.length = 0;
    this._matsOwned.length = 0;
    this._colliderIds.length = 0;
    this._boxCache = null;
  }
}

function heuristic(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}
