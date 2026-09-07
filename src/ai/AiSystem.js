import * as THREE from 'three';
import {
  cloneModel,
  disposeModelInstance,
  fitHeight,
  loadModelTemplate,
  MODELS,
} from '../assets/gltf.js';

const LAYER_STATIC = 1;
const LAYER_ENEMY = 4;
const ENEMY_RADIUS = 0.4;
const ENEMY_HEIGHT = 1.8;
const EYE_HEIGHT = 1.45;
const MOVE_SPEED = 3.8;
const MAX_PATH = 1024;
const SQUAD_SIZE = 6;
const MAG_SIZE = 18;
const SHOT_DAMAGE = 8;
const FIRE_INTERVAL = 0.105;
const RELOAD_TIME = 1.75;
const CORPSE_TIME = 8;

/** Heading that rotates a Three.js local -Z forward axis toward an X/Z vector. */
export function headingForForwardMinusZ(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function normalizeWithSpread(forward, rightOffset, upOffset, spread, out) {
  let fx = forward.x;
  let fy = forward.y;
  let fz = forward.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  let rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
    rl = 1;
  }
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  let dx = fx + rx * rightOffset * spread + ux * upOffset * spread;
  let dy = fy + uy * upOffset * spread;
  let dz = fz + rz * rightOffset * spread + uz * upOffset * spread;
  const dl = Math.hypot(dx, dy, dz) || 1;
  out.x = dx / dl;
  out.y = dy / dl;
  out.z = dz / dl;
  return out;
}

/** Pure cover ranking used by the squad and node tests. */
export function chooseCoverPoint(points, reservations, enemy, target, role = 'holder') {
  let best = null;
  let bestScore = Infinity;
  const toTargetX = target.x - enemy.x;
  const toTargetZ = target.z - enemy.z;
  const targetLen = Math.hypot(toTargetX, toTargetZ) || 1;
  for (const point of points ?? []) {
    if (reservations.has(point.id)) continue;
    const enemyDist = Math.hypot(point.x - enemy.x, point.z - enemy.z);
    const targetDist = Math.hypot(point.x - target.x, point.z - target.z);
    if (targetDist < 4 || targetDist > 28) continue;
    const lateral = Math.abs(
      ((point.x - target.x) * toTargetZ - (point.z - target.z) * toTargetX) / targetLen,
    );
    const desiredRange = role === 'holder' ? 15 : role === 'flanker' ? 10 : 12;
    let score = enemyDist * 0.75 + Math.abs(targetDist - desiredRange);
    if (role === 'flanker') score -= lateral * 1.25;
    if ((point.height ?? 1) < 0.65) score += 3;
    if (score < bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

/** Resolve an enemy shot against static cover and the player's live 3D bounds. */
export function shotHitsPlayer(physics, player, origin, dir, maxDist = 80, out = null) {
  const bounds = player.getHurtbox();
  const playerDistance = physics.raycastBoxDistance(
    origin.x,
    origin.y,
    origin.z,
    dir.x,
    dir.y,
    dir.z,
    maxDist,
    bounds,
  );
  if (!Number.isFinite(playerDistance)) return null;
  const cover = physics.raycast(
    origin.x,
    origin.y,
    origin.z,
    dir.x,
    dir.y,
    dir.z,
    maxDist,
    LAYER_STATIC,
  );
  if (cover && cover.distance < playerDistance) return null;
  const result = out ?? { distance: 0, point: { x: 0, y: 0, z: 0 } };
  result.distance = playerDistance;
  result.point.x = origin.x + dir.x * playerDistance;
  result.point.y = origin.y + dir.y * playerDistance;
  result.point.z = origin.z + dir.z * playerDistance;
  return result;
}

export class AiSystem {
  static id = 'ai';
  static deps = ['physics', 'world', 'player', 'materials'];

  constructor() {
    this.enemies = [];
    this._root = null;
    this._enemyTemplate = null;
    this._usingGltf = false;
    this._rng = null;
    this._ctx = null;
    this._unsubs = [];
    this._geoms = [];
    this._mats = [];
    this._reservations = new Map();
    this._activeFlankerId = null;
    this._worldPos = { x: 0, z: 0 };
    this._origin = { x: 0, y: 0, z: 0 };
    this._dir = { x: 0, y: 0, z: -1 };
    this._aim = { x: 0, y: 0, z: -1 };
    this._eye = { x: 0, y: 0, z: 0 };
    this._tracerTo = { x: 0, y: 0, z: 0 };
    this._shotResult = { distance: 0, point: { x: 0, y: 0, z: 0 } };
    this._impactPoint = { x: 0, y: 0, z: 0 };
    this._impactNormal = { x: 0, y: 1, z: 0 };
    this._incident = { x: 0, y: 0, z: -1 };
  }

  get aliveCount() {
    let count = 0;
    for (const enemy of this.enemies) if (enemy.active && enemy.alive) count += 1;
    return count;
  }

  async init(ctx) {
    this._ctx = ctx;
    this._rng = ctx.rng.fork('ai');
    this._root = new THREE.Group();
    this._root.name = 'ai';
    ctx.scene.add(this._root);
    try {
      this._enemyTemplate = await loadModelTemplate(MODELS.enemy);
      this._usingGltf = true;
    } catch (err) {
      console.warn('[ai] enemy.glb failed, procedural fallback', err);
    }

    const bodyGeom = new THREE.BoxGeometry(0.55, 0.75, 0.38);
    const chestGeom = new THREE.BoxGeometry(0.62, 0.45, 0.4);
    const headGeom = new THREE.BoxGeometry(0.36, 0.38, 0.36);
    const armGeom = new THREE.BoxGeometry(0.16, 0.55, 0.16);
    armGeom.translate(0, -0.25, 0);
    const legGeom = new THREE.BoxGeometry(0.2, 0.7, 0.22);
    legGeom.translate(0, -0.32, 0);
    const muzzleGeom = new THREE.SphereGeometry(0.055, 6, 4);
    const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffbd55 });
    this._geoms.push(bodyGeom, chestGeom, headGeom, armGeom, legGeom, muzzleGeom);
    this._mats.push(muzzleMat);
    this._shared = { bodyGeom, chestGeom, headGeom, armGeom, legGeom, muzzleGeom, muzzleMat };

    const base = ctx.get('world').enemySpawn;
    for (let i = 0; i < SQUAD_SIZE; i++) {
      this.enemies.push(this._spawn(ctx, `enemy-${i}`, base.x, base.z + i * 2, i));
    }
    this.reset({}, ctx);
    this._unsubs.push(
      ctx.events.on('damage:dealt', (payload) => {
        const enemy = payload ? this._byId(payload.target) : null;
        if (enemy?.alive) this._applyDamage(ctx, enemy, payload);
      }),
      ctx.events.on('session:reset', (payload) => this.reset(payload, ctx)),
    );
  }

  _spawn(ctx, id, x, z, index) {
    const physics = ctx.get('physics');
    const materials = ctx.get('materials');
    const group = new THREE.Group();
    group.name = id;
    const flashMats = [];
    let model = null;
    if (this._usingGltf && this._enemyTemplate) {
      model = cloneModel(this._enemyTemplate);
      fitHeight(model, ENEMY_HEIGHT);
      model.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          flashMats.push(material);
        }
      });
      group.add(model);
    } else {
      const bodyMat = materials.getUnique('flesh');
      const headMat = materials.getUnique('flesh');
      const clothMat = materials.getUnique('plaster');
      const colors = [0x9a443d, 0x83503c, 0x873c4f, 0x96523d];
      bodyMat.color.setHex(colors[index % colors.length]);
      headMat.color.setHex(0xb76f61);
      clothMat.color.setHex(0x252a31);
      this._mats.push(bodyMat, headMat, clothMat);
      flashMats.push(bodyMat, headMat);
      const legL = new THREE.Group();
      legL.name = 'leg_l';
      legL.position.set(-0.14, 0.68, 0);
      legL.add(new THREE.Mesh(this._shared.legGeom, clothMat));
      const legR = new THREE.Group();
      legR.name = 'leg_r';
      legR.position.set(0.14, 0.68, 0);
      legR.add(new THREE.Mesh(this._shared.legGeom, clothMat));
      const torso = new THREE.Mesh(this._shared.bodyGeom, bodyMat);
      torso.position.set(0, 0.95, 0);
      const chest = new THREE.Mesh(this._shared.chestGeom, clothMat);
      chest.position.set(0, 1.25, 0);
      const head = new THREE.Group();
      head.name = 'head';
      head.position.set(0, 1.52, 0);
      const headMesh = new THREE.Mesh(this._shared.headGeom, headMat);
      headMesh.position.y = 0.16;
      head.add(headMesh);
      const armL = new THREE.Group();
      armL.name = 'arm_l';
      armL.position.set(-0.4, 1.38, 0);
      armL.add(new THREE.Mesh(this._shared.armGeom, bodyMat));
      const armR = new THREE.Group();
      armR.name = 'arm_r';
      armR.position.set(0.4, 1.38, 0);
      armR.add(new THREE.Mesh(this._shared.armGeom, bodyMat));
      group.add(legL, legR, torso, chest, head, armL, armR);
    }
    const muzzle = new THREE.Mesh(this._shared.muzzleGeom, this._shared.muzzleMat);
    muzzle.name = `${id}-muzzle-cue`;
    muzzle.visible = false;
    const muzzleSocket = group.getObjectByName('muzzle_socket');
    if (muzzleSocket) muzzleSocket.add(muzzle);
    else {
      muzzle.position.set(0.28, 1.25, -0.55);
      group.add(muzzle);
    }
    group.position.set(x, 0, z);
    this._root.add(group);
    const collider = physics.addBox({
      minx: x - ENEMY_RADIUS,
      miny: 0,
      minz: z - ENEMY_RADIUS,
      maxx: x + ENEMY_RADIUS,
      maxy: ENEMY_HEIGHT,
      maxz: z + ENEMY_RADIUS,
      surface: 'flesh',
      layers: LAYER_ENEMY,
      userData: { kind: 'enemy', actorId: id, headY: 1.5 },
    });
    const bases = flashMats.map((material) => ({
      material,
      r: material.color?.r ?? 1,
      g: material.color?.g ?? 1,
      b: material.color?.b ?? 1,
    }));
    const weaponSocket = group.getObjectByName('weapon_socket');
    return {
      id,
      active: true,
      alive: true,
      health: 100,
      maxHealth: 100,
      role: 'holder',
      state: 'unaware',
      stateTime: 0,
      position: new THREE.Vector3(x, 0, z),
      prevPosition: new THREE.Vector3(x, 0, z),
      lastKnown: new THREE.Vector3(x, 0, z),
      hasLastKnown: false,
      seesPlayer: false,
      exposedTime: 0,
      group,
      model,
      collider,
      flashMats,
      bases,
      flash: 0,
      hitReact: 0,
      deathTime: 0,
      corpseTime: 0,
      muzzle,
      muzzleLife: 0,
      path: new Int32Array(MAX_PATH),
      pathLen: 0,
      pathIndex: 0,
      repathIn: 0,
      coverId: null,
      goalX: x,
      goalZ: z,
      burstLeft: 0,
      shotTimer: 0,
      ammo: MAG_SIZE,
      phase: index * 0.7,
      moveAmount: 0,
      stuckTime: 0,
      rig: {
        armL: group.getObjectByName('arm_l'),
        armR: group.getObjectByName('arm_r'),
        legL: group.getObjectByName('leg_l'),
        legR: group.getObjectByName('leg_r'),
        head: group.getObjectByName('head'),
        weaponSocket,
      },
      weaponSocketRest: weaponSocket?.quaternion.clone() ?? null,
      weaponSocketCorrection: new THREE.Quaternion(),
    };
  }

  reset(payload = {}, ctx = this._ctx) {
    if (!ctx || this.enemies.length === 0) return;
    this._rng = ctx.rng.fork('ai');
    this._reservations.clear();
    this._activeFlankerId = null;
    const world = ctx.get('world');
    const physics = ctx.get('physics');
    const base = world.enemySpawn;
    const fallback = [
      { x: base.x, z: base.z, role: 'holder' },
      { x: base.x - 3.2, z: base.z - 6, role: 'advancer' },
      { x: base.x + 3.5, z: base.z - 12, role: 'flanker' },
      { x: base.x - 2.4, z: base.z + 5, role: 'holder' },
      { x: base.x + 2.8, z: base.z - 18, role: 'advancer' },
      { x: base.x - 1.2, z: base.z + 10, role: 'holder' },
    ];
    const spawns = Array.isArray(payload.enemySpawns) ? payload.enemySpawns : fallback;
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      const spawn = spawns[i];
      if (!spawn) {
        enemy.active = false;
        enemy.alive = false;
        enemy.group.visible = false;
        physics.setEnabled(enemy.collider, false);
        continue;
      }
      enemy.active = true;
      enemy.alive = true;
      enemy.health = enemy.maxHealth;
      enemy.role = spawn.role ?? (i === 2 ? 'flanker' : i % 2 ? 'advancer' : 'holder');
      if (enemy.role === 'flanker') {
        if (this._activeFlankerId) enemy.role = 'advancer';
        else this._activeFlankerId = enemy.id;
      }
      enemy.state = 'unaware';
      enemy.stateTime = 0.15 + i * 0.05;
      enemy.position.set(spawn.x, 0, spawn.z);
      enemy.prevPosition.copy(enemy.position);
      enemy.lastKnown.copy(enemy.position);
      enemy.hasLastKnown = false;
      enemy.seesPlayer = false;
      enemy.exposedTime = 0;
      enemy.flash = 0;
      enemy.hitReact = 0;
      enemy.deathTime = 0;
      enemy.corpseTime = 0;
      enemy.muzzleLife = 0;
      enemy.muzzle.visible = false;
      enemy.pathLen = 0;
      enemy.pathIndex = 0;
      enemy.repathIn = 0;
      enemy.coverId = null;
      enemy.goalX = spawn.x;
      enemy.goalZ = spawn.z;
      enemy.burstLeft = 0;
      enemy.shotTimer = 0;
      enemy.ammo = MAG_SIZE;
      enemy.stuckTime = 0;
      enemy.group.visible = true;
      enemy.group.rotation.set(0, spawn.yaw ?? 0, 0);
      for (const baseColor of enemy.bases) {
        baseColor.material.color?.setRGB?.(baseColor.r, baseColor.g, baseColor.b);
      }
      physics.setEnabled(enemy.collider, true);
      this._syncCollider(physics, enemy);
    }
  }

  fixedUpdate(h, ctx) {
    if (ctx.session ? !ctx.session.playing : ctx.input?.active === false) return;
    const player = ctx.get('player');
    const physics = ctx.get('physics');
    const world = ctx.get('world');
    player.getEyePosition(this._eye);
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;
      enemy.prevPosition.copy(enemy.position);
      // Hit and muzzle cues finish even when the killing shot arrived mid-flash.
      this._updateCues(enemy, h);
      if (!enemy.alive) {
        enemy.deathTime += h;
        enemy.corpseTime += h;
        if (enemy.corpseTime >= CORPSE_TIME) enemy.group.visible = false;
        continue;
      }
      const dx = player.position.x - enemy.position.x;
      const dz = player.position.z - enemy.position.z;
      const distance = Math.hypot(dx, dz);
      const sightDx = this._eye.x - enemy.position.x;
      const sightDy = this._eye.y - EYE_HEIGHT;
      const sightDz = this._eye.z - enemy.position.z;
      const sightDistance = Math.hypot(sightDx, sightDy, sightDz);
      const obstruction = sightDistance < 45
        ? physics.raycast(enemy.position.x, EYE_HEIGHT, enemy.position.z, sightDx, sightDy, sightDz, sightDistance, LAYER_STATIC)
        : null;
      const sees = player.alive && sightDistance < 45 && (!obstruction || obstruction.distance >= sightDistance - 0.25);
      if (sees) {
        enemy.lastKnown.set(player.position.x, 0, player.position.z);
        enemy.hasLastKnown = true;
        enemy.exposedTime += h;
        if (
          enemy.state !== 'reload' &&
          (!enemy.seesPlayer || enemy.state === 'unaware' || enemy.state === 'search')
        ) {
          enemy.state = 'acquire';
          enemy.stateTime = 0.22 + this._rng.float(0, 0.22);
        }
      } else {
        enemy.exposedTime = 0;
        if (enemy.seesPlayer && ['aim', 'burst', 'recover'].includes(enemy.state)) {
          enemy.state = 'search';
          enemy.stateTime = 3;
          enemy.burstLeft = 0;
        }
      }
      enemy.seesPlayer = sees;
      enemy.stateTime -= h;

      switch (enemy.state) {
        case 'unaware':
          if (enemy.stateTime <= 0 && enemy.hasLastKnown) this._enterMove(enemy, world, player);
          break;
        case 'acquire':
          if (enemy.stateTime <= 0) {
            if (sees && distance < (enemy.role === 'holder' ? 24 : 18)) this._enterAim(enemy);
            else this._enterMove(enemy, world, player);
          }
          break;
        case 'move':
          this._moveEnemy(enemy, i, h, world, physics);
          if ((sees && distance < 22 && enemy.stateTime <= 0) || this._atGoal(enemy)) this._enterAim(enemy);
          break;
        case 'aim':
          if (!sees) {
            enemy.state = 'search';
            enemy.stateTime = 3;
          } else if (enemy.stateTime <= 0) {
            enemy.state = 'burst';
            enemy.burstLeft = 2 + this._rng.int(0, 2);
            enemy.shotTimer = 0;
          }
          break;
        case 'burst':
          if (!sees) {
            enemy.state = 'search';
            enemy.stateTime = 3;
          } else {
            enemy.shotTimer -= h;
            if (enemy.ammo <= 0) {
              enemy.state = 'reload';
              enemy.stateTime = RELOAD_TIME;
            } else if (enemy.shotTimer <= 0 && enemy.burstLeft > 0) {
              this._fire(ctx, enemy, distance);
              enemy.ammo -= 1;
              enemy.burstLeft -= 1;
              enemy.shotTimer += FIRE_INTERVAL;
            }
            if (enemy.ammo <= 0) {
              enemy.state = 'reload';
              enemy.stateTime = RELOAD_TIME;
            } else if (enemy.burstLeft <= 0) {
              enemy.state = 'recover';
              enemy.stateTime = 0.5 + this._rng.float(0, 0.45);
            }
          }
          break;
        case 'recover':
          if (enemy.stateTime <= 0) {
            if (sees && enemy.role === 'holder') this._enterAim(enemy);
            else this._enterMove(enemy, world, player);
          }
          break;
        case 'reload':
          if (enemy.stateTime <= 0) {
            enemy.ammo = MAG_SIZE;
            if (sees) this._enterAim(enemy);
            else this._enterMove(enemy, world, player);
          }
          break;
        case 'search':
          if (enemy.hasLastKnown) {
            enemy.goalX = enemy.lastKnown.x;
            enemy.goalZ = enemy.lastKnown.z;
            this._moveEnemy(enemy, i, h, world, physics);
          }
          if (enemy.stateTime <= 0) {
            enemy.state = 'unaware';
            enemy.stateTime = 0.5;
            enemy.hasLastKnown = false;
          }
          break;
      }

      const faceX = enemy.seesPlayer
        ? player.position.x - enemy.position.x
        : enemy.hasLastKnown
          ? enemy.lastKnown.x - enemy.position.x
          : 0;
      const faceZ = enemy.seesPlayer
        ? player.position.z - enemy.position.z
        : enemy.hasLastKnown
          ? enemy.lastKnown.z - enemy.position.z
          : 0;
      if (faceX * faceX + faceZ * faceZ > 1e-5 && enemy.state !== 'move') {
        enemy.group.rotation.y = headingForForwardMinusZ(faceX, faceZ);
      }
      this._syncCollider(physics, enemy);
    }
  }

  _enterAim(enemy) {
    enemy.state = 'aim';
    enemy.stateTime = 0.2 + this._rng.float(0, 0.18);
    enemy.moveAmount = 0;
  }

  _enterMove(enemy, world, player) {
    enemy.state = 'move';
    enemy.stateTime = 0.7 + this._rng.float(0, 0.8);
    this._releaseCover(enemy);
    const knownTarget = enemy.seesPlayer ? player.position : enemy.hasLastKnown ? enemy.lastKnown : enemy.position;
    const cover = chooseCoverPoint(world.coverPoints, this._reservations, enemy.position, knownTarget, enemy.role);
    if (cover) {
      enemy.coverId = cover.id;
      this._reservations.set(cover.id, enemy.id);
      enemy.goalX = cover.x;
      enemy.goalZ = cover.z;
    } else if (enemy.hasLastKnown) {
      const side = enemy.role === 'flanker' ? (Number(enemy.id.slice(-1)) % 2 ? -1 : 1) * 5 : 0;
      const toX = enemy.lastKnown.x - enemy.position.x;
      const toZ = enemy.lastKnown.z - enemy.position.z;
      const len = Math.hypot(toX, toZ) || 1;
      enemy.goalX = enemy.lastKnown.x + (-toZ / len) * side;
      enemy.goalZ = enemy.lastKnown.z + (toX / len) * side;
    }
    enemy.repathIn = 0;
  }

  _moveEnemy(enemy, index, h, world, physics) {
    enemy.repathIn -= h;
    if (enemy.repathIn <= 0 || enemy.pathIndex >= enemy.pathLen) {
      enemy.repathIn = 0.4 + this._rng.float(0, 0.16);
      enemy.pathLen = world.findPath(enemy.position.x, enemy.position.z, enemy.goalX, enemy.goalZ, enemy.path);
      enemy.pathIndex = enemy.pathLen > 1 ? 1 : 0;
    }
    let moveX = 0;
    let moveZ = 0;
    if (enemy.pathIndex < enemy.pathLen) {
      const cell = enemy.path[enemy.pathIndex];
      const cx = cell % world.nav.sizeX;
      const cz = (cell / world.nav.sizeX) | 0;
      const waypoint = world.cellToWorld(cx, cz, this._worldPos);
      moveX = waypoint.x - enemy.position.x;
      moveZ = waypoint.z - enemy.position.z;
      const distance = Math.hypot(moveX, moveZ);
      if (distance < 0.28) enemy.pathIndex += 1;
      else {
        moveX /= distance;
        moveZ /= distance;
      }
    }
    // Separation prevents a reserved anchor from collapsing the whole squad.
    for (let i = 0; i < this.enemies.length; i++) {
      if (i === index) continue;
      const other = this.enemies[i];
      if (!other.active || !other.alive) continue;
      const sx = enemy.position.x - other.position.x;
      const sz = enemy.position.z - other.position.z;
      const distance = Math.hypot(sx, sz);
      if (distance > 0.01 && distance < 1.1) {
        const strength = (1.1 - distance) / 1.1;
        moveX += (sx / distance) * strength * 1.4;
        moveZ += (sz / distance) * strength * 1.4;
      }
    }
    const moveLen = Math.hypot(moveX, moveZ);
    const beforeX = enemy.position.x;
    const beforeZ = enemy.position.z;
    if (moveLen > 1e-4) {
      moveX /= moveLen;
      moveZ /= moveLen;
      const speed = MOVE_SPEED * (enemy.role === 'flanker' ? 1.08 : enemy.role === 'holder' ? 0.82 : 1);
      this._moveThroughWorld(enemy, physics, moveX * speed * h, moveZ * speed * h, h);
      enemy.group.rotation.y = headingForForwardMinusZ(moveX, moveZ);
      enemy.phase += speed * h * 2.4;
    }
    enemy.moveAmount = Math.hypot(enemy.position.x - beforeX, enemy.position.z - beforeZ) / Math.max(h, 1e-6);
    if (enemy.moveAmount < 0.05) enemy.stuckTime += h;
    else enemy.stuckTime = 0;
    if (enemy.stuckTime > 0.8) {
      const sign = Number(enemy.id.slice(-1)) % 2 ? -1 : 1;
      this._moveThroughWorld(
        enemy,
        physics,
        Math.cos(enemy.group.rotation.y) * sign * 0.45,
        -Math.sin(enemy.group.rotation.y) * sign * 0.45,
        h,
      );
      enemy.pathLen = 0;
      enemy.repathIn = 0;
      enemy.stuckTime = 0;
    }
  }

  _moveThroughWorld(enemy, physics, dx, dz, h) {
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / (ENEMY_RADIUS * 0.4)));
    const halfHeight = ENEMY_HEIGHT * 0.5 - ENEMY_RADIUS;
    for (let i = 0; i < steps; i++) {
      const moved = physics.moveCapsule(
        enemy.position.x,
        ENEMY_HEIGHT * 0.5,
        enemy.position.z,
        ENEMY_RADIUS,
        halfHeight,
        dx / steps,
        0,
        dz / steps,
        h / steps,
        LAYER_STATIC,
      );
      enemy.position.x = moved.x;
      enemy.position.z = moved.z;
    }
  }

  _atGoal(enemy) {
    return Math.hypot(enemy.position.x - enemy.goalX, enemy.position.z - enemy.goalZ) < 0.7;
  }

  _fire(ctx, enemy, distance) {
    const player = ctx.get('player');
    const physics = ctx.get('physics');
    player.getEyePosition(this._eye);
    this._origin.x = enemy.position.x;
    this._origin.y = EYE_HEIGHT;
    this._origin.z = enemy.position.z;
    this._aim.x = this._eye.x - this._origin.x;
    this._aim.y = this._eye.y - this._origin.y;
    this._aim.z = this._eye.z - this._origin.z;
    const movingPenalty = Math.min(0.012, Math.hypot(player.velocity.x, player.velocity.z) * 0.0015);
    const settleBonus = Math.min(0.008, enemy.exposedTime * 0.002);
    const spread = Math.max(0.008, 0.012 + distance * 0.00035 + movingPenalty - settleBonus);
    const seed = (this._rng.next() * 0x100000000) >>> 0;
    normalizeWithSpread(
      this._aim,
      this._rng.float(-1, 1),
      this._rng.float(-1, 1),
      spread,
      this._dir,
    );
    enemy.muzzleLife = 0.045;
    enemy.muzzle.visible = true;
    ctx.events.emit('weapon:fire', {
      from: enemy.id,
      weapon: 'enemy-smg',
      origin: this._origin,
      dir: this._dir,
      seed,
    });
    const cover = physics.raycast(
      this._origin.x,
      this._origin.y,
      this._origin.z,
      this._dir.x,
      this._dir.y,
      this._dir.z,
      80,
      LAYER_STATIC,
    );
    const coverDistance = cover?.distance ?? Infinity;
    if (cover) {
      this._impactPoint.x = cover.pointX;
      this._impactPoint.y = cover.pointY;
      this._impactPoint.z = cover.pointZ;
      this._impactNormal.x = cover.normalX;
      this._impactNormal.y = cover.normalY;
      this._impactNormal.z = cover.normalZ;
    }
    const coverSurface = cover?.surface;
    const result = shotHitsPlayer(physics, player, this._origin, this._dir, 80, this._shotResult);
    const tracerDistance = result?.distance ?? (Number.isFinite(coverDistance) ? coverDistance : Math.min(80, distance + 8));
    this._tracerTo.x = this._origin.x + this._dir.x * tracerDistance;
    this._tracerTo.y = this._origin.y + this._dir.y * tracerDistance;
    this._tracerTo.z = this._origin.z + this._dir.z * tracerDistance;
    ctx.events.emit('bullet:tracer', { from: this._origin, to: this._tracerTo, speed: 360 });
    if (!result && cover) {
      this._incident.x = this._dir.x;
      this._incident.y = this._dir.y;
      this._incident.z = this._dir.z;
      ctx.events.emit('bullet:impact', {
        point: this._impactPoint,
        normal: this._impactNormal,
        surface: coverSurface,
        incident: this._incident,
        damage: 0,
      });
    }
    if (result) {
      ctx.events.emit('damage:dealt', {
        target: 'player',
        from: enemy.id,
        amount: SHOT_DAMAGE,
        headshot: result.point.y > player.getHurtbox().maxy - 0.28,
        point: result.point,
      });
    }
  }

  _updateCues(enemy, h) {
    enemy.hitReact = Math.max(0, enemy.hitReact - h * 4);
    if (enemy.flash > 0) {
      enemy.flash -= h;
      if (enemy.flash <= 0) {
        for (const baseColor of enemy.bases) {
          baseColor.material.color?.setRGB?.(baseColor.r, baseColor.g, baseColor.b);
        }
      }
    }
    if (enemy.muzzleLife > 0) {
      enemy.muzzleLife -= h;
      if (enemy.muzzleLife <= 0) enemy.muzzle.visible = false;
    }
  }

  update(_dt, ctx) {
    const alpha = ctx.time.alpha ?? 1;
    for (const enemy of this.enemies) {
      if (!enemy.active || !enemy.group.visible) continue;
      enemy.group.position.x = enemy.prevPosition.x + (enemy.position.x - enemy.prevPosition.x) * alpha;
      enemy.group.position.y = 0;
      enemy.group.position.z = enemy.prevPosition.z + (enemy.position.z - enemy.prevPosition.z) * alpha;
      const rig = enemy.rig;
      if (!enemy.alive) {
        const fall = Math.min(1, enemy.deathTime / 0.55);
        enemy.group.rotation.z = fall * (Number(enemy.id.slice(-1)) % 2 ? -1 : 1) * 1.35;
        enemy.group.position.y = -fall * 0.22;
        continue;
      }
      enemy.group.rotation.z = 0;
      const moving = Math.min(1, enemy.moveAmount / MOVE_SPEED);
      const stride = Math.sin(enemy.phase) * 0.65 * moving;
      if (rig.legL) rig.legL.rotation.x = stride;
      if (rig.legR) rig.legR.rotation.x = -stride;
      const aiming = ['aim', 'burst', 'recover'].includes(enemy.state) ? 1 : 0;
      const reloading = enemy.state === 'reload' ? 1 : 0;
      // Limbs hang along local -Y. Positive X rotation brings the hands toward
      // the authored -Z weapon axis; reload folds the support arm across the mag.
      if (rig.armL) rig.armL.rotation.x = -0.35 * moving + 1.05 * aiming + 0.62 * reloading + stride * 0.2;
      if (rig.armR) rig.armR.rotation.x = 0.35 * moving + 1.18 * aiming + 0.92 * reloading - stride * 0.2;
      if (rig.armL) rig.armL.rotation.z = -0.32 * aiming - 0.78 * reloading;
      if (rig.armR) rig.armR.rotation.z = 0.18 * aiming + 0.3 * reloading;
      if (rig.weaponSocket && enemy.weaponSocketRest && rig.armR) {
        if (aiming) {
          // The authored rifle already points along local -Z. Cancel the arm
          // pivot rotation at its socket so raising the arm does not pitch the
          // barrel upward; the socket position still follows the hand.
          enemy.weaponSocketCorrection.copy(rig.armR.quaternion).invert();
          rig.weaponSocket.quaternion.copy(enemy.weaponSocketCorrection).multiply(enemy.weaponSocketRest);
        } else {
          rig.weaponSocket.quaternion.copy(enemy.weaponSocketRest);
        }
      }
      if (rig.head) {
        rig.head.rotation.y = Math.sin(enemy.phase * 0.35) * 0.08 * (1 - aiming);
        rig.head.rotation.z = enemy.hitReact * 0.14;
      }
    }
  }

  _applyDamage(ctx, enemy, payload) {
    const amount = Math.max(0, payload.amount || 0);
    enemy.health = Math.max(0, enemy.health - amount);
    enemy.flash = 0.08;
    enemy.hitReact = 1;
    for (const material of enemy.flashMats) material.color?.setRGB?.(1, 1, 1);
    const killed = enemy.health <= 0;
    const result = {
      target: enemy.id,
      from: payload.from ?? null,
      amount,
      health: enemy.health,
      headshot: !!payload.headshot,
      killed,
      point: payload.point ?? null,
    };
    ctx.events.emit('damage:taken', result);
    ctx.events.emit('combat:hit', result);
    if (killed) {
      enemy.alive = false;
      enemy.state = 'dead';
      enemy.deathTime = 0;
      enemy.corpseTime = 0;
      enemy.moveAmount = 0;
      ctx.get('physics').setEnabled(enemy.collider, false);
      this._releaseCover(enemy);
      if (this._activeFlankerId === enemy.id) this._activeFlankerId = null;
      ctx.events.emit('actor:death', {
        actor: enemy.id,
        from: payload.from ?? null,
        headshot: !!payload.headshot,
        point: { x: enemy.position.x, y: 1, z: enemy.position.z },
        impulse: payload.point ?? null,
      });
    }
  }

  _releaseCover(enemy) {
    if (enemy.coverId !== null && this._reservations.get(enemy.coverId) === enemy.id) {
      this._reservations.delete(enemy.coverId);
    }
    enemy.coverId = null;
  }

  _syncCollider(physics, enemy) {
    physics.setBox(
      enemy.collider,
      enemy.position.x - ENEMY_RADIUS,
      0,
      enemy.position.z - ENEMY_RADIUS,
      enemy.position.x + ENEMY_RADIUS,
      ENEMY_HEIGHT,
      enemy.position.z + ENEMY_RADIUS,
    );
  }

  _byId(id) {
    for (const enemy of this.enemies) if (enemy.id === id) return enemy;
    return null;
  }

  getEnemy(id) {
    return this._byId(id);
  }

  dispose() {
    for (const unsub of this._unsubs) unsub();
    for (const enemy of this.enemies) {
      if (enemy.model) disposeModelInstance(enemy.model);
    }
    this._root?.parent?.remove(this._root);
    for (const geometry of this._geoms) geometry.dispose();
    for (const material of this._mats) material.dispose();
    this.enemies.length = 0;
    this._reservations.clear();
  }
}
