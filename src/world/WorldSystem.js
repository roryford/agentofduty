import * as THREE from 'three';
import {
  cloneModel,
  fitHeight,
  fitLength,
  loadModelTemplate,
  measure,
  MODELS,
} from '../assets/gltf.js';
import {
  COVER_PROPS,
  isInPlayableRegion,
  NAV_CELL_SIZE,
  WORLD_BOUNDARY,
  WORLD_COVER_POINTS,
  WORLD_ENCOUNTERS,
  WORLD_SIZE,
} from './layout.js';

/**
 * Kestrel District: three connected combat spaces inside the original 120m lot.
 * The player advances north (-Z) from a checkpoint, can loop west through
 * Lantern Court, and finishes under a strongly lit extraction gantry.
 *
 * Public surface (ctx.get('world')):
 *   room, playerSpawn, enemySpawn, encounters, coverPoints, nav
 *   isWalkable, worldToCell, cellToWorld, findPath, cellIndex
 */

const HALF = WORLD_SIZE * 0.5;
const ROAD_HALF = 7;
const SIDEWALK = 3;
const CELL = NAV_CELL_SIZE;
const LAYER_STATIC = 1;

export class WorldSystem {
  static id = 'world';
  static deps = ['physics', 'materials'];

  constructor() {
    this._roots = [];
    this._geoms = [];
    this._matsOwned = [];
    this._texturesOwned = [];
    this._colliderIds = [];
    this._boundaryColliderIds = [];
    this._boxCache = new Map();
    this._facadeWindows = [];
    this._physics = null;

    this.room = {
      minx: -HALF,
      maxx: HALF,
      minz: -HALF,
      maxz: HALF,
      floorY: 0,
    };

    this.encounters = WORLD_ENCOUNTERS;
    this.coverPoints = WORLD_COVER_POINTS;
    this.playerSpawn = WORLD_ENCOUNTERS[0].spawn;
    const firstEnemy = WORLD_ENCOUNTERS[0].enemySpawns[0];
    this.enemySpawn = { x: firstEnemy.x, y: 0, z: firstEnemy.z };

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
    this._physics = physics;

    const root = new THREE.Group();
    root.name = 'kestrel-district';
    this._roots.push(root);
    ctx.scene.add(root);

    const palette = this._createPalette(materials);
    this._buildGround(root, physics, palette);
    this._buildPerimeter(root, physics, palette);
    this._buildArchitecture(root, physics, palette);

    const [dumpsterResult, carResult] = await Promise.allSettled([
      loadModelTemplate(MODELS.dumpster),
      loadModelTemplate(MODELS.car),
    ]);
    this._dumpsterTpl = dumpsterResult.status === 'fulfilled' ? dumpsterResult.value : null;
    this._carTpl = carResult.status === 'fulfilled' ? carResult.value : null;

    this._buildTacticalProps(root, physics, palette);
    this._buildStreetDetail(root, palette);
    this._buildExtractionLandmark(root, physics, palette);
    this._buildNav(physics);
  }

  _createPalette(materials) {
    const clone = (tag, color, roughness, metalness) => {
      const mat = materials.get(tag).clone();
      mat.userData.shared = false;
      mat.color.setHex(color);
      if (roughness !== undefined) mat.roughness = roughness;
      if (metalness !== undefined) mat.metalness = metalness;
      this._matsOwned.push(mat);
      return mat;
    };

    const palette = {
      road: clone('asphalt', 0xb8bec8, 0.72, 0),
      court: clone('concrete', 0x77766f, 0.88, 0),
      walk: clone('concrete', 0x97938a, 0.9, 0),
      brick: clone('concrete', 0x6e5148, 0.94, 0),
      stone: clone('concrete', 0x777d82, 0.91, 0),
      plasterBlue: clone('plaster', 0x65717b, 0.89, 0),
      plasterOchre: clone('plaster', 0x90755a, 0.9, 0),
      plasterGreen: clone('plaster', 0x586c65, 0.92, 0),
      metal: clone('metal', 0x727982, 0.56, 0.72),
      darkMetal: clone('metal', 0x30363d, 0.68, 0.8),
      paintedRed: clone('metal', 0x744238, 0.68, 0.35),
      paintedGreen: clone('metal', 0x355a4c, 0.7, 0.32),
      wood: clone('plaster', 0x674c36, 0.85, 0),
    };

    palette.windowWarm = new THREE.MeshStandardMaterial({
      color: 0x3f2b1d,
      emissive: 0xc56f37,
      emissiveIntensity: 0.42,
      roughness: 0.72,
      metalness: 0,
      toneMapped: true,
    });
    palette.windowCool = new THREE.MeshStandardMaterial({
      color: 0x182231,
      emissive: 0x50749a,
      emissiveIntensity: 0.38,
      roughness: 0.78,
      metalness: 0,
      toneMapped: true,
    });
    palette.windowDark = new THREE.MeshStandardMaterial({
      color: 0x101317,
      emissive: 0x101720,
      emissiveIntensity: 0.15,
      roughness: 0.86,
      metalness: 0,
    });
    palette.lightWarm = new THREE.MeshStandardMaterial({
      color: 0xffd2a0,
      emissive: 0xff9b46,
      emissiveIntensity: 2.2,
      roughness: 0.62,
      metalness: 0,
    });
    palette.lightBlue = new THREE.MeshStandardMaterial({
      color: 0xb6d9ff,
      emissive: 0x5f9bd4,
      emissiveIntensity: 2.4,
      roughness: 0.58,
      metalness: 0,
    });
    palette.shadow = new THREE.MeshBasicMaterial({
      color: 0x030507,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this._matsOwned.push(
      palette.windowWarm,
      palette.windowCool,
      palette.windowDark,
      palette.lightWarm,
      palette.lightBlue,
      palette.shadow,
    );
    return palette;
  }

  _buildGround(root, physics, p) {
    const underlayDepth = 0.2;
    this._box(
      root,
      physics,
      0,
      WORLD_BOUNDARY.underlayTop - underlayDepth * 0.5,
      0,
      WORLD_SIZE,
      underlayDepth,
      WORLD_SIZE,
      p.road,
      'concrete',
      { name: 'lot-underlay' },
    );
    this._box(root, physics, 0, -0.14, 0, ROAD_HALF * 2, 0.28, WORLD_SIZE, p.road, 'concrete');
    for (const side of [-1, 1]) {
      this._box(
        root,
        physics,
        side * (ROAD_HALF + SIDEWALK * 0.5),
        -0.08,
        0,
        SIDEWALK,
        0.2,
        WORLD_SIZE,
        p.walk,
        'concrete',
      );
    }

    this._box(root, physics, -19, -0.12, 0, 20, 0.24, 32, p.court, 'concrete');
    this._box(root, physics, -14, -0.11, 13, 10, 0.22, 6, p.court, 'concrete');
    this._box(root, physics, -14, -0.11, -13, 10, 0.22, 6, p.court, 'concrete');

    this._box(root, physics, 35, -0.17, 0, 50, 0.18, WORLD_SIZE, p.road, 'concrete');
    this._box(root, physics, -45, -0.17, 0, 30, 0.18, WORLD_SIZE, p.road, 'concrete');

    const curbGeom = this._sharedBox(0.16, 0.16, WORLD_SIZE);
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeom, p.stone);
      curb.position.set(side * ROAD_HALF, 0.04, 0);
      curb.receiveShadow = true;
      root.add(curb);
    }

    const laneGeom = this._sharedBox(0.16, 0.025, 2.5);
    for (let z = -55; z <= 55; z += 7) {
      if (z > 20 && z < 30) continue;
      const lane = new THREE.Mesh(laneGeom, p.plasterOchre);
      lane.position.set(0, 0.025, z);
      root.add(lane);
    }
    for (const z of [17, -18, -51]) {
      const stripe = new THREE.Mesh(this._sharedBox(10.5, 0.025, 0.18), p.plasterOchre);
      stripe.position.set(0, 0.025, z);
      root.add(stripe);
    }

    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x10151c,
      roughness: 0.24,
      metalness: 0.04,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this._matsOwned.push(puddleMat);
    const puddleGeom = new THREE.CircleGeometry(1, 20);
    this._geoms.push(puddleGeom);
    const puddles = [
      [-2.8, 43, 1.8, 0.6], [3.2, 27, 1.2, 0.5], [-16, 4, 1.5, 0.7],
      [-23, -11, 1.1, 0.55], [2.3, -29, 1.7, 0.65], [-1.8, -47, 1.3, 0.5],
    ];
    for (const [x, z, sx, sy] of puddles) {
      const mesh = new THREE.Mesh(puddleGeom, puddleMat);
      mesh.rotation.x = -Math.PI * 0.5;
      mesh.position.set(x, 0.018, z);
      mesh.scale.set(sx, sy, 1);
      root.add(mesh);
    }
  }

  _buildPerimeter(root, physics, p) {
    const { minx, maxx, minz, maxz } = this.room;
    const { thickness, height, baseHeight, postSpacing } = WORLD_BOUNDARY;
    const inset = thickness * 0.5;
    const width = maxx - minx;
    const depth = maxz - minz;
    const walls = [
      { id: 'west', x: minx + inset, z: 0, w: thickness, d: depth },
      { id: 'east', x: maxx - inset, z: 0, w: thickness, d: depth },
      { id: 'north', x: 0, z: minz + inset, w: width, d: thickness },
      { id: 'south', x: 0, z: maxz - inset, w: width, d: thickness },
    ];

    for (const wall of walls) {
      const collider = this._box(
        root,
        physics,
        wall.x,
        height * 0.5,
        wall.z,
        wall.w,
        height,
        wall.d,
        p.stone,
        'concrete',
        { visual: false, kind: 'perimeter' },
      );
      this._boundaryColliderIds.push(collider);

      const base = new THREE.Mesh(this._sharedBox(wall.w, baseHeight, wall.d), p.stone);
      base.name = `perimeter-base-${wall.id}`;
      base.position.set(wall.x, baseHeight * 0.5, wall.z);
      base.receiveShadow = true;
      root.add(base);

      for (const y of [1.55, 2.65, 3.45]) {
        const rail = new THREE.Mesh(
          this._sharedBox(
            wall.w === thickness ? 0.1 : wall.w,
            0.1,
            wall.d === thickness ? 0.1 : wall.d,
          ),
          p.darkMetal,
        );
        rail.name = `perimeter-rail-${wall.id}`;
        rail.position.set(wall.x, y, wall.z);
        root.add(rail);
      }
    }

    const postPositions = [];
    for (let axis = minx + inset; axis <= maxx - inset + 1e-6; axis += postSpacing) {
      postPositions.push([axis, minz + inset], [axis, maxz - inset]);
    }
    for (let axis = minz + inset; axis <= maxz - inset + 1e-6; axis += postSpacing) {
      postPositions.push([minx + inset, axis], [maxx - inset, axis]);
    }
    const postHeight = height - baseHeight;
    const posts = new THREE.InstancedMesh(
      this._sharedBox(0.13, postHeight, 0.13),
      p.darkMetal,
      postPositions.length,
    );
    posts.name = 'perimeter-posts';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < postPositions.length; i++) {
      const [x, z] = postPositions[i];
      posts.setMatrixAt(i, matrix.makeTranslation(x, baseHeight + postHeight * 0.5, z));
    }
    posts.instanceMatrix.needsUpdate = true;
    root.add(posts);
  }

  _buildArchitecture(root, physics, p) {
    const east = [
      { z: 48, w: 20, h: 12, d: 11, mat: p.brick, shop: 'KITE NOODLES', accent: 0xd37b3f },
      { z: 27, w: 18, h: 9, d: 9, mat: p.plasterGreen, shop: 'MERCY PHARMACY', accent: 0x4f8f76 },
      { z: 5, w: 22, h: 15, d: 12, mat: p.stone, shop: 'NORTHLINE', accent: 0x527ca5 },
      { z: -20, w: 22, h: 11, d: 10, mat: p.plasterOchre, shop: 'KESTREL REPAIR', accent: 0xba6d3e },
      { z: -45, w: 24, h: 17, d: 13, mat: p.brick, shop: 'MARKET 24', accent: 0xb99345 },
    ];
    for (const b of east) this._buildingX(root, physics, 1, b, p);

    const westStreet = [
      { z: 45, w: 26, h: 15, d: 12, mat: p.plasterBlue, shop: 'SOUTH TRANSIT', accent: 0x546c88 },
      { z: 25, w: 10, h: 10, d: 10, mat: p.brick, shop: 'TEA HOUSE', accent: 0xa95d45 },
      { z: -31, w: 20, h: 13, d: 11, mat: p.stone, shop: 'CIVIC STORES', accent: 0x687b87 },
      { z: -51, w: 16, h: 16, d: 12, mat: p.plasterGreen, shop: 'NORTH DEPOT', accent: 0x557f73 },
    ];
    for (const b of westStreet) this._buildingX(root, physics, -1, b, p);

    this._buildingX(
      root,
      physics,
      -1,
      { z: 0, w: 32, h: 12, d: 8, facadeX: -30, mat: p.brick, shop: 'LANTERN COURT', accent: 0xb85d3d },
      p,
    );
    this._buildingZ(root, physics, -1, -20, 18.8, 18, 10, 4, p.plasterOchre, p);
    this._buildingZ(root, physics, 1, -20, -18.8, 18, 13, 4, p.plasterBlue, p);

    this._box(root, physics, 0, 7, -61.5, 42, 14, 3, p.stone, 'concrete');
    this._box(root, physics, 0, 6, 61.5, 38, 12, 3, p.brick, 'concrete');
    this._flushFacadeWindows(root, p.darkMetal);
  }

  _buildingX(root, physics, side, spec, p) {
    const faceX = spec.facadeX ?? side * 10.5;
    const cx = faceX + side * spec.d * 0.5;
    this._box(root, physics, cx, spec.h * 0.5, spec.z, spec.d, spec.h, spec.w, spec.mat, 'concrete');

    const trim = new THREE.Mesh(this._sharedBox(0.22, 0.22, spec.w * 0.92), p.darkMetal);
    trim.position.set(faceX - side * 0.12, spec.h - 0.45, spec.z);
    root.add(trim);

    const floors = Math.max(2, Math.floor(spec.h / 3.1));
    const cols = Math.max(2, Math.floor(spec.w / 3.2));
    const winMats = [p.windowWarm, p.windowDark, p.windowCool, p.windowDark];
    for (let floor = 1; floor < floors; floor++) {
      for (let col = 0; col < cols; col++) {
        const mat = winMats[(floor * 3 + col + (side > 0 ? 1 : 0)) % winMats.length];
        const z = spec.z - spec.w * 0.5 + 1.8 + col * ((spec.w - 3.6) / Math.max(1, cols - 1));
        this._windowX(
          root,
          faceX - side * 0.045,
          floor * 3.0 + 1.0,
          z,
          mat,
          p.darkMetal,
          -side,
        );
      }
    }

    if (spec.shop) {
      const glass = new THREE.Mesh(this._sharedBox(0.08, 2.25, Math.min(5.8, spec.w * 0.52)), p.windowWarm);
      glass.position.set(faceX - side * 0.07, 1.35, spec.z);
      root.add(glass);
      const frontage = Math.min(5.8, spec.w * 0.52);
      for (const offset of [-frontage * 0.28, 0, frontage * 0.28]) {
        const mullion = new THREE.Mesh(this._sharedBox(0.12, 2.28, 0.09), p.darkMetal);
        mullion.position.set(faceX - side * 0.13, 1.35, spec.z + offset);
        root.add(mullion);
      }
      const sill = new THREE.Mesh(this._sharedBox(0.15, 0.14, frontage), p.darkMetal);
      sill.position.set(faceX - side * 0.12, 0.24, spec.z);
      root.add(sill);
      const canopy = new THREE.Mesh(this._sharedBox(1.25, 0.13, Math.min(6.2, spec.w * 0.56)), p.darkMetal);
      canopy.position.set(faceX - side * 0.62, 2.65, spec.z);
      root.add(canopy);
      this._addSignX(root, faceX - side * 0.13, 3.35, spec.z, side, spec.shop, spec.accent);
    }
  }

  _buildingZ(root, physics, side, x, faceZ, width, height, depth, mat, p) {
    const cz = faceZ + side * depth * 0.5;
    this._box(root, physics, x, height * 0.5, cz, width, height, depth, mat, 'concrete');
    for (let col = 0; col < 5; col++) {
      const wx = x - width * 0.5 + 2.2 + col * 3.4;
      const frame = new THREE.Mesh(this._sharedBox(1.9, 1.6, 0.08), p.darkMetal);
      frame.position.set(wx, 4.2, faceZ - side * 0.045);
      root.add(frame);
      const glass = new THREE.Mesh(this._sharedBox(1.55, 1.25, 0.06), col % 3 === 0 ? p.windowWarm : p.windowDark);
      glass.position.set(wx, 4.2, faceZ - side * 0.085);
      root.add(glass);
    }
  }

  _windowX(root, x, y, z, glassMat, frameMat, normalX) {
    this._facadeWindows.push({ x, y, z, normalX, glassMat, frameMat });
  }

  _flushFacadeWindows(root, frameMat) {
    if (this._facadeWindows.length === 0) return;
    const matrix = new THREE.Matrix4();
    const frameGeometry = this._sharedBox(0.08, 1.55, 1.85);
    const glassGeometry = this._sharedBox(0.06, 1.22, 1.5);
    const frames = new THREE.InstancedMesh(frameGeometry, frameMat, this._facadeWindows.length);
    frames.name = 'window-frames-batch';
    frames.receiveShadow = true;
    for (let i = 0; i < this._facadeWindows.length; i++) {
      const window = this._facadeWindows[i];
      frames.setMatrixAt(i, matrix.makeTranslation(window.x, window.y, window.z));
    }
    frames.instanceMatrix.needsUpdate = true;
    root.add(frames);

    const byMaterial = new Map();
    for (const window of this._facadeWindows) {
      let placements = byMaterial.get(window.glassMat);
      if (!placements) {
        placements = [];
        byMaterial.set(window.glassMat, placements);
      }
      placements.push(window);
    }
    let batch = 0;
    for (const [material, placements] of byMaterial) {
      const glass = new THREE.InstancedMesh(glassGeometry, material, placements.length);
      glass.name = `window-glass-batch-${batch++}`;
      glass.userData.placements = placements.map((window) => ({
        frameX: window.x,
        glassX: window.x + window.normalX * 0.075,
        normalX: window.normalX,
      }));
      for (let i = 0; i < placements.length; i++) {
        const window = placements[i];
        matrix.makeTranslation(window.x + window.normalX * 0.075, window.y, window.z);
        glass.setMatrixAt(i, matrix);
      }
      glass.instanceMatrix.needsUpdate = true;
      root.add(glass);
    }
  }

  _addSignX(root, x, y, z, side, text, color) {
    const mat = this._makeSignMaterial(text, color);
    const sign = new THREE.Mesh(this._sharedBox(0.1, 0.72, Math.min(5.8, 1.25 + text.length * 0.25)), mat);
    sign.position.set(x, y, z);
    sign.rotation.y = side > 0 ? 0 : Math.PI;
    root.add(sign);
  }

  _makeSignMaterial(text, background) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = `#${background.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#f2e2c4';
    g.font = '700 48px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, canvas.width * 0.5, canvas.height * 0.54, canvas.width - 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this._texturesOwned.push(texture);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0x70502d,
      emissiveIntensity: 0.55,
      roughness: 0.72,
      metalness: 0,
    });
    this._matsOwned.push(mat);
    return mat;
  }

  _buildTacticalProps(root, physics, p) {
    for (const prop of COVER_PROPS) {
      switch (prop.type) {
        case 'car': this._addCar(root, physics, prop, p); break;
        case 'dumpster': this._addDumpster(root, physics, prop, p); break;
        case 'barrier': this._addBarrier(root, physics, prop, p); break;
        case 'booth': this._addBooth(root, physics, prop, p); break;
        case 'planter': this._addPlanter(root, physics, prop, p); break;
        default: this._addCrates(root, physics, prop, p); break;
      }
    }
  }

  _addCar(root, physics, prop, p) {
    if (this._carTpl) {
      const car = cloneModel(this._carTpl);
      car.rotation.y = prop.yaw;
      fitLength(car, 4.58);
      car.position.x = prop.x;
      car.position.z = prop.z;
      root.add(car);
      const sz = measure(car);
      this._box(root, physics, prop.x, sz.y * 0.5, prop.z, sz.x, sz.y, sz.z, p.metal, 'metal', { visual: false });
    } else {
      this._box(root, physics, prop.x, 0.55, prop.z, 1.85, 1.1, 4.58, p.paintedRed, 'metal');
      const cab = new THREE.Mesh(this._sharedBox(1.65, 0.48, 2.15), p.windowDark);
      cab.position.set(prop.x, 1.14, prop.z);
      root.add(cab);
    }
    this._contactShadow(root, prop.x, prop.z, 2.35, 1.05, p.shadow, prop.yaw);
  }

  _addDumpster(root, physics, prop, p) {
    if (this._dumpsterTpl) {
      const bin = cloneModel(this._dumpsterTpl);
      fitHeight(bin, 1.25);
      bin.position.x = prop.x;
      bin.position.z = prop.z;
      bin.rotation.y = prop.yaw;
      root.add(bin);
      const sz = measure(bin);
      this._box(root, physics, prop.x, sz.y * 0.5, prop.z, sz.x, sz.y, sz.z, p.paintedGreen, 'metal', { visual: false });
    } else {
      this._box(root, physics, prop.x, 0.62, prop.z, 2.05, 1.25, 1.15, p.paintedGreen, 'metal');
    }
    this._contactShadow(root, prop.x, prop.z, 1.15, 0.7, p.shadow, prop.yaw);
  }

  _addBarrier(root, physics, prop, p) {
    this._box(root, physics, prop.x, 0.46, prop.z, 2.5, 0.92, 0.65, p.stone, 'concrete', { yaw: prop.yaw });
    const cap = new THREE.Mesh(this._sharedBox(2.1, 0.12, 0.48), p.plasterOchre);
    cap.position.set(prop.x, 0.9, prop.z);
    cap.rotation.y = prop.yaw;
    root.add(cap);
    this._contactShadow(root, prop.x, prop.z, 1.35, 0.48, p.shadow, prop.yaw);
  }

  _addCrates(root, physics, prop, p) {
    this._box(root, physics, prop.x, 0.52, prop.z, 1.15, 1.04, 1.0, p.wood, 'wood', { yaw: prop.yaw });
    this._box(root, physics, prop.x + 0.8, 0.36, prop.z + 0.15, 0.75, 0.72, 0.75, p.wood, 'wood', { yaw: -prop.yaw });
    for (const y of [0.16, 0.82]) {
      const band = new THREE.Mesh(this._sharedBox(1.19, 0.05, 1.04), p.darkMetal);
      band.position.set(prop.x, y, prop.z);
      band.rotation.y = prop.yaw;
      root.add(band);
    }
    this._contactShadow(root, prop.x + 0.25, prop.z, 1.1, 0.7, p.shadow, prop.yaw);
  }

  _addBooth(root, physics, prop, p) {
    this._box(root, physics, prop.x, 0.72, prop.z, 1.65, 1.44, 1.5, p.darkMetal, 'metal');
    const window = new THREE.Mesh(this._sharedBox(1.0, 0.5, 0.06), p.windowCool);
    window.position.set(prop.x, 1.02, prop.z - 0.78);
    root.add(window);
    const roof = new THREE.Mesh(this._sharedBox(2.05, 0.12, 1.85), p.paintedRed);
    roof.position.set(prop.x, 1.52, prop.z);
    root.add(roof);
    this._contactShadow(root, prop.x, prop.z, 1.1, 0.9, p.shadow, 0);
  }

  _addPlanter(root, physics, prop, p) {
    this._box(root, physics, prop.x, 0.42, prop.z, 2.4, 0.84, 0.75, p.stone, 'concrete');
    const soil = new THREE.Mesh(this._sharedBox(2.05, 0.06, 0.5), p.wood);
    soil.position.set(prop.x, 0.86, prop.z);
    root.add(soil);
    for (const x of [-0.7, 0, 0.65]) {
      const geometry = new THREE.IcosahedronGeometry(0.34, 1);
      this._geoms.push(geometry);
      const shrub = new THREE.Mesh(geometry, p.plasterGreen);
      shrub.position.set(prop.x + x, 1.12, prop.z);
      root.add(shrub);
    }
    this._contactShadow(root, prop.x, prop.z, 1.35, 0.55, p.shadow, 0);
  }

  _contactShadow(root, x, z, sx, sz, mat, yaw) {
    const geometry = new THREE.CircleGeometry(1, 16);
    this._geoms.push(geometry);
    const shadow = new THREE.Mesh(geometry, mat);
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.rotation.z = yaw;
    shadow.position.set(x, 0.014, z);
    shadow.scale.set(sx, sz, 1);
    root.add(shadow);
  }

  _buildStreetDetail(root, p) {
    const grateGeom = this._sharedBox(0.75, 0.025, 0.38);
    for (const z of [-46, -30, -14, 3, 20, 37, 51]) {
      for (const side of [-1, 1]) {
        const grate = new THREE.Mesh(grateGeom, p.darkMetal);
        grate.position.set(side * 6.35, 0.025, z);
        root.add(grate);
      }
    }

    this._beamBetween(root, new THREE.Vector3(-29.8, 7.2, 8), new THREE.Vector3(-9.8, 6.2, 8), 0.025, p.darkMetal);
    this._beamBetween(root, new THREE.Vector3(-29.8, 8.0, -5), new THREE.Vector3(-9.8, 6.7, -5), 0.022, p.darkMetal);
    this._beamBetween(root, new THREE.Vector3(-10.2, 7.1, -27), new THREE.Vector3(10.2, 8.3, -27), 0.025, p.darkMetal);

    const bulbGeom = new THREE.SphereGeometry(0.09, 8, 6);
    this._geoms.push(bulbGeom);
    for (let i = 0; i < 7; i++) {
      const bulb = new THREE.Mesh(bulbGeom, p.lightWarm);
      bulb.position.set(-27 + i * 2.5, 4.6 - Math.sin((i / 6) * Math.PI) * 0.45, 5.5);
      root.add(bulb);
    }

    const rubble = [
      [-28.2, 14.3, 0.42, 0.18, 0.36], [-27.5, 14.7, 0.28, 0.24, 0.31],
      [-10.7, -11.3, 0.36, 0.21, 0.26], [8.9, -7.5, 0.45, 0.17, 0.32],
      [8.7, 41.5, 0.3, 0.2, 0.38],
    ];
    for (const [x, z, w, h, d] of rubble) {
      const mesh = new THREE.Mesh(this._sharedBox(w, h, d), p.stone);
      mesh.position.set(x, h * 0.5, z);
      mesh.rotation.set(0.15, x * 0.07, 0.12);
      root.add(mesh);
    }
  }

  _buildExtractionLandmark(root, physics, p) {
    this._box(root, physics, -5.6, 1.8, -53, 0.6, 3.6, 0.7, p.darkMetal, 'metal');
    this._box(root, physics, 5.6, 1.8, -53, 0.6, 3.6, 0.7, p.darkMetal, 'metal');
    const lintel = new THREE.Mesh(this._sharedBox(11.8, 0.28, 0.55), p.lightBlue);
    lintel.position.set(0, 3.55, -53);
    root.add(lintel);

    const mastGeom = new THREE.CylinderGeometry(0.12, 0.18, 8, 10);
    const ringGeom = new THREE.TorusGeometry(0.75, 0.08, 8, 24);
    this._geoms.push(mastGeom, ringGeom);
    const mast = new THREE.Mesh(mastGeom, p.darkMetal);
    mast.position.set(0, 4, -57);
    root.add(mast);
    for (const y of [5.8, 7.0]) {
      const ring = new THREE.Mesh(ringGeom, p.lightBlue);
      ring.position.set(0, y, -57);
      ring.rotation.x = Math.PI * 0.5;
      root.add(ring);
    }
    const beaconGeom = new THREE.SphereGeometry(0.24, 12, 8);
    this._geoms.push(beaconGeom);
    const beacon = new THREE.Mesh(beaconGeom, p.lightBlue);
    beacon.position.set(0, 8.1, -57);
    root.add(beacon);
  }

  _beamBetween(root, a, b, radius, material) {
    const delta = new THREE.Vector3().subVectors(b, a);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 6);
    this._geoms.push(geometry);
    const beam = new THREE.Mesh(geometry, material);
    beam.position.copy(a).add(b).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    root.add(beam);
  }

  _sharedBox(w, h, d) {
    const key = `${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}`;
    let geometry = this._boxCache.get(key);
    if (!geometry) {
      geometry = new THREE.BoxGeometry(w, h, d);
      this._geoms.push(geometry);
      this._boxCache.set(key, geometry);
    }
    return geometry;
  }

  _box(root, physics, x, y, z, w, h, d, material, surface, opts = {}) {
    if (opts.visual !== false) {
      const mesh = new THREE.Mesh(this._sharedBox(w, h, d), material);
      if (opts.name) mesh.name = opts.name;
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
      minx: x - hx, miny: y - hy, minz: z - hz,
      maxx: x + hx, maxy: y + hy, maxz: z + hz,
      surface, layers: LAYER_STATIC, userData: { kind: opts.kind ?? 'world' },
    });
    this._colliderIds.push(id);
    return id;
  }

  _buildNav(physics) {
    const { minx, maxx, minz, maxz } = this.room;
    const sizeX = Math.floor((maxx - minx) / CELL);
    const sizeZ = Math.floor((maxz - minz) / CELL);
    this.nav.sizeX = sizeX;
    this.nav.sizeZ = sizeZ;
    this.nav.originX = minx + CELL * 0.5;
    this.nav.originZ = minz + CELL * 0.5;

    const count = sizeX * sizeZ;
    this._walk = new Uint8Array(count);
    this._came = new Int32Array(count);
    this._gScore = new Float32Array(count);
    this._fScore = new Float32Array(count);
    this._closed = new Uint8Array(count);
    this._heap = new Int32Array(count);

    for (let cz = 0; cz < sizeZ; cz++) {
      for (let cx = 0; cx < sizeX; cx++) {
        const x = this.nav.originX + cx * CELL;
        const z = this.nav.originZ + cz * CELL;
        let walkable = isInPlayableRegion(x, z);
        if (walkable) {
          const r = 0.42;
          walkable = !(
            physics.pointBlocked(x, 0.9, z, LAYER_STATIC) ||
            physics.pointBlocked(x + r, 0.9, z, LAYER_STATIC) ||
            physics.pointBlocked(x - r, 0.9, z, LAYER_STATIC) ||
            physics.pointBlocked(x, 0.9, z + r, LAYER_STATIC) ||
            physics.pointBlocked(x, 0.9, z - r, LAYER_STATIC)
          );
        }
        this._walk[cz * sizeX + cx] = walkable ? 1 : 0;
      }
    }

    for (const encounter of this.encounters) {
      this._forceWalkable(encounter.spawn.x, encounter.spawn.z);
      this._forceWalkable(encounter.exit.x, encounter.exit.z);
      for (const enemy of encounter.enemySpawns) this._forceWalkable(enemy.x, enemy.z);
    }
    for (const cover of this.coverPoints) this._forceWalkable(cover.x, cover.z);
  }

  _forceWalkable(x, z) {
    const cell = this.worldToCell(x, z);
    if (!cell) return;
    this._walk[cell.cz * this.nav.sizeX + cell.cx] = 1;
  }

  isWalkable(x, z) {
    const cell = this.worldToCell(x, z);
    if (!cell) return false;
    return this._walk[cell.cz * this.nav.sizeX + cell.cx] === 1;
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
    const startCell = this.worldToCell(sx, sz);
    if (!startCell) return 0;
    const startCx = startCell.cx;
    const startCz = startCell.cz;
    const goalCell = this.worldToCell(gx, gz);
    if (!goalCell) return 0;
    const goalCx = goalCell.cx;
    const goalCz = goalCell.cz;

    const sizeX = this.nav.sizeX;
    const sizeZ = this.nav.sizeZ;
    const start = this.cellIndex(startCx, startCz);
    const goal = this.cellIndex(goalCx, goalCz);
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
    this._fScore[start] = heuristic(startCx, startCz, goalCx, goalCz);
    this._heapPush(start);

    while (this._heapN > 0) {
      const current = this._heapPop();
      if (current === goal) {
        let length = 0;
        let cursor = goal;
        while (cursor !== -1) {
          length += 1;
          cursor = this._came[cursor];
        }
        if (length > outPath.length) length = outPath.length;
        cursor = goal;
        for (let i = length - 1; i >= 0; i--) {
          outPath[i] = cursor;
          cursor = this._came[cursor];
        }
        return length;
      }
      if (this._closed[current]) continue;
      this._closed[current] = 1;
      const cx = current % sizeX;
      const cz = (current / sizeX) | 0;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue;
          if (dx !== 0 && dz !== 0) {
            if (!this._walk[cz * sizeX + nx] || !this._walk[nz * sizeX + cx]) continue;
          }
          const next = nz * sizeX + nx;
          if (!this._walk[next] || this._closed[next]) continue;
          const tentative = this._gScore[current] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
          if (tentative >= this._gScore[next]) continue;
          this._came[next] = current;
          this._gScore[next] = tentative;
          this._fScore[next] = tentative + heuristic(nx, nz, goalCx, goalCz);
          this._heapPush(next);
        }
      }
    }
    return 0;
  }

  _heapPush(index) {
    const heap = this._heap;
    let at = this._heapN;
    heap[at] = index;
    this._heapN = at + 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this._fScore[heap[parent]] <= this._fScore[heap[at]]) break;
      const temp = heap[parent];
      heap[parent] = heap[at];
      heap[at] = temp;
      at = parent;
    }
  }

  _heapPop() {
    const heap = this._heap;
    const result = heap[0];
    this._heapN -= 1;
    if (this._heapN === 0) return result;
    heap[0] = heap[this._heapN];
    let at = 0;
    while (true) {
      const left = at * 2 + 1;
      const right = left + 1;
      let smallest = at;
      if (left < this._heapN && this._fScore[heap[left]] < this._fScore[heap[smallest]]) smallest = left;
      if (right < this._heapN && this._fScore[heap[right]] < this._fScore[heap[smallest]]) smallest = right;
      if (smallest === at) break;
      const temp = heap[at];
      heap[at] = heap[smallest];
      heap[smallest] = temp;
      at = smallest;
    }
    return result;
  }

  dispose() {
    for (const id of this._colliderIds) this._physics?.remove(id);
    for (const root of this._roots) root.parent?.remove(root);
    for (const geometry of new Set(this._geoms)) geometry.dispose();
    for (const material of new Set(this._matsOwned)) material.dispose();
    for (const texture of new Set(this._texturesOwned)) texture.dispose();
    this._roots.length = 0;
    this._geoms.length = 0;
    this._matsOwned.length = 0;
    this._texturesOwned.length = 0;
    this._colliderIds.length = 0;
    this._boundaryColliderIds.length = 0;
    this._boxCache.clear();
    this._facadeWindows.length = 0;
    this._physics = null;
  }
}

function heuristic(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}
