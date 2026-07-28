import * as THREE from 'three';
import {
  cloneModel,
  disposeModelInstance,
  fitHeight,
  loadModelTemplate,
  MODELS,
} from '../assets/gltf.js';

/**
 * Enemy squad — Blender GLB mesh with procedural box fallback.
 */

const LAYER_ENEMY = 4;
const ENEMY_RADIUS = 0.4;
const ENEMY_HEIGHT = 1.8;
const MOVE_SPEED = 4.4;
const REPATH_INTERVAL = 0.45;
const MAX_PATH = 1024;
const ATTACK_RANGE = 20;
const ATTACK_COOLDOWN = 0.9;
const ATTACK_DAMAGE = 7;
const SQUAD_SIZE = 6;
export class AiSystem {
  static id = 'ai';
  static deps = ['physics', 'world', 'player', 'materials'];

  constructor() {
    this.enemies = [];
    this._worldPos = { x: 0, z: 0 };
    this._unsubDamage = null;
    this._geoms = [];
    this._mats = [];
    this._root = null;
    this._rng = null;
    this._attackOrigin = { x: 0, y: 0, z: 0 };
    this._attackDir = { x: 0, y: 0, z: 0 };
    this._enemyTemplate = null;
    this._usingGltf = false;
  }

  async init(ctx) {
    const world = ctx.get('world');
    const physics = ctx.get('physics');
    const materials = ctx.get('materials');
    this._rng = ctx.rng.fork();

    this._root = new THREE.Group();
    this._root.name = 'ai';
    ctx.scene.add(this._root);

    try {
      this._enemyTemplate = await loadModelTemplate(MODELS.enemy);
      this._usingGltf = true;
    } catch (err) {
      console.warn('[ai] enemy.glb failed, procedural fallback', err);
      this._usingGltf = false;
    }

    // Shared geos for procedural HI fallback (always full detail — no far "blob" LOD)
    const bodyGeom = new THREE.BoxGeometry(0.55, 0.75, 0.38);
    const chestGeom = new THREE.BoxGeometry(0.62, 0.45, 0.4);
    const headGeom = new THREE.BoxGeometry(0.36, 0.38, 0.36);
    const armGeom = new THREE.BoxGeometry(0.16, 0.55, 0.16);
    const legGeom = new THREE.BoxGeometry(0.2, 0.7, 0.22);
    this._geoms.push(bodyGeom, chestGeom, headGeom, armGeom, legGeom);
    this._shared = { bodyGeom, chestGeom, headGeom, armGeom, legGeom };

    const base = world.enemySpawn;
    const slots = [
      { x: 0, z: 0 },
      { x: -3.2, z: -6 },
      { x: 3.5, z: -12 },
      { x: -2.4, z: 5 },
      { x: 2.8, z: -18 },
      { x: -1.2, z: 10 },
    ];

    for (let i = 0; i < SQUAD_SIZE; i++) {
      const s = slots[i] || { x: (this._rng.float() - 0.5) * 6, z: i * 7 };
      const x = base.x + s.x + (this._rng.float() - 0.5) * 0.8;
      const z = base.z + s.z + (this._rng.float() - 0.5) * 1.2;
      const cx = Math.max(-5.5, Math.min(5.5, x));
      const enemy = this._spawn(
        physics,
        materials,
        `enemy-${i}`,
        cx,
        z,
        bodyGeom,
        chestGeom,
        headGeom,
        armGeom,
        legGeom,
        i,
      );
      this.enemies.push(enemy);
    }

    this._unsubDamage = ctx.events.on('damage:dealt', (payload) => {
      if (!payload) return;
      const e = this._byId(payload.target);
      if (!e || !e.alive) return;
      this._applyDamage(ctx, e, payload);
    });
  }

  _spawn(physics, materials, id, x, z, bodyGeom, chestGeom, headGeom, armGeom, legGeom, idx) {
    const group = new THREE.Group();
    group.name = id;

    /** @type {THREE.Material[]} */
    const flashMats = [];

    // Always full detail (same mesh near and far — no LO blob)
    if (this._usingGltf && this._enemyTemplate) {
      const mesh = cloneModel(this._enemyTemplate);
      fitHeight(mesh, ENEMY_HEIGHT);
      mesh.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.emissive && m.name) {
              const n = m.name.toLowerCase();
              if (n.includes('flesh') || n.includes('head') || n.includes('helm')) {
                m.emissive.setHex(0x401010);
                m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.3);
              }
            }
            flashMats.push(m);
          }
        }
      });
      group.add(mesh);
    } else {
      const bodyMat = materials.getUnique('flesh');
      const headMat = materials.getUnique('flesh');
      const clothMat = materials.getUnique('plaster');
      const hues = [0xe04040, 0xd05030, 0xc03050, 0xe06040];
      const col = hues[idx % hues.length];
      bodyMat.color.setHex(col);
      bodyMat.emissive.setHex(0x401010);
      bodyMat.emissiveIntensity = 0.45;
      headMat.color.setHex(0xff7060);
      headMat.emissive.setHex(0x501818);
      headMat.emissiveIntensity = 0.55;
      clothMat.color.setHex(0x2a2430);
      this._mats.push(bodyMat, headMat, clothMat);
      flashMats.push(bodyMat, headMat);

      const legsL = new THREE.Mesh(legGeom, clothMat);
      legsL.position.set(-0.14, 0.35, 0);
      const legsR = new THREE.Mesh(legGeom, clothMat);
      legsR.position.set(0.14, 0.35, 0);
      const torso = new THREE.Mesh(bodyGeom, bodyMat);
      torso.position.set(0, 0.95, 0);
      const chest = new THREE.Mesh(chestGeom, clothMat);
      chest.position.set(0, 1.25, 0);
      const head = new THREE.Mesh(headGeom, headMat);
      head.position.set(0, 1.68, 0);
      const armL = new THREE.Mesh(armGeom, bodyMat);
      armL.position.set(-0.4, 1.15, 0);
      const armR = new THREE.Mesh(armGeom, bodyMat);
      armR.position.set(0.4, 1.15, 0);
      group.add(legsL, legsR, torso, chest, head, armL, armR);
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

    const bases = flashMats.map((m) => ({
      m,
      r: m.color?.r ?? 1,
      g: m.color?.g ?? 1,
      b: m.color?.b ?? 1,
    }));

    return {
      id,
      alive: true,
      health: 100,
      maxHealth: 100,
      position: new THREE.Vector3(x, 0, z),
      prevPosition: new THREE.Vector3(x, 0, z),
      group,
      flashMats,
      bases,
      collider,
      pathLen: 0,
      pathIndex: 0,
      path: new Int32Array(MAX_PATH),
      repathIn: idx * 0.12,
      flash: 0,
      attackCd: 0.8 + idx * 0.25,
      aggression: 0.45 + this._rng.float() * 0.55,
      phase: idx * 0.7,
      gltf: this._usingGltf,
    };
  }

  fixedUpdate(h, ctx) {
    const player = ctx.get('player');
    const world = ctx.get('world');
    const physics = ctx.get('physics');

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;

      e.prevPosition.copy(e.position);
      e.phase += h * (2 + e.aggression);

      if (e.flash > 0) {
        e.flash -= h;
        if (e.flash <= 0) {
          for (const b of e.bases) {
            b.m.color?.setRGB?.(b.r, b.g, b.b);
          }
        }
      }

      const dx = player.position.x - e.position.x;
      const dz = player.position.z - e.position.z;
      const dist = Math.hypot(dx, dz);

      let goalX = player.position.x;
      let goalZ = player.position.z;
      const ring = 4 + (i % 3) * 2.5;
      if (dist < ATTACK_RANGE + 5) {
        const ang = Math.atan2(dx, dz) + (i - 2.5) * 0.35;
        goalX = player.position.x - Math.sin(ang) * ring;
        goalZ = player.position.z - Math.cos(ang) * ring;
      }

      e.repathIn -= h;
      if (e.repathIn <= 0 || e.pathIndex >= e.pathLen) {
        e.repathIn = REPATH_INTERVAL * (0.85 + this._rng.float() * 0.4);
        const len = world.findPath(e.position.x, e.position.z, goalX, goalZ, e.path);
        e.pathLen = len;
        e.pathIndex = len > 1 ? 1 : 0;
      }

      if (e.pathLen > 0 && e.pathIndex < e.pathLen) {
        const cell = e.path[e.pathIndex];
        const sizeX = world.nav.sizeX;
        const cx = cell % sizeX;
        const cz = (cell / sizeX) | 0;
        const wp = world.cellToWorld(cx, cz, this._worldPos);
        const tx = wp.x - e.position.x;
        const tz = wp.z - e.position.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.3) {
          e.pathIndex += 1;
        } else {
          const speed = MOVE_SPEED * (0.8 + e.aggression * 0.35);
          const step = speed * h;
          const s = step < d ? step / d : 1;
          e.position.x += tx * s;
          e.position.z += tz * s;
        }
      }

      if (dx * dx + dz * dz > 1e-6) {
        e.group.rotation.y = Math.atan2(dx, dz);
      }

      e.attackCd -= h;
      if (player.alive && e.attackCd <= 0 && dist < ATTACK_RANGE && dist > 0.5) {
        const ox = e.position.x;
        const oy = 1.45;
        const oz = e.position.z;
        const lx = player.position.x - ox;
        const ly = 1.6 - oy;
        const lz = player.position.z - oz;
        const hit = physics.raycast(ox, oy, oz, lx, ly, lz, dist + 0.5, 1, -1);
        const clear = !hit || hit.distance > dist - 0.4;
        if (clear) {
          e.attackCd = ATTACK_COOLDOWN * (0.65 + this._rng.float() * 0.7);
          this._attackOrigin.x = ox;
          this._attackOrigin.y = oy;
          this._attackOrigin.z = oz;
          const inv = 1 / (dist || 1);
          this._attackDir.x = lx * inv;
          this._attackDir.y = ly * inv;
          this._attackDir.z = lz * inv;
          ctx.events.emit('weapon:fire', {
            weapon: 'enemy-smg',
            origin: this._attackOrigin,
            dir: this._attackDir,
            seed: (this._rng.next() * 0x100000000) >>> 0,
          });
          ctx.events.emit('damage:dealt', {
            target: 'player',
            amount: ATTACK_DAMAGE,
            headshot: false,
            killed: false,
            point: { x: player.position.x, y: 1.4, z: player.position.z },
            from: e.id,
          });
        } else {
          e.attackCd = 0.2;
        }
      }

      this._syncCollider(physics, e, e.position.x, e.position.z);
    }
  }

  update(_dt, ctx) {
    const a = ctx.time.alpha;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      const x = e.prevPosition.x + (e.position.x - e.prevPosition.x) * a;
      const z = e.prevPosition.z + (e.position.z - e.prevPosition.z) * a;
      e.group.position.x = x;
      e.group.position.y = 0;
      e.group.position.z = z;
    }
  }

  _syncCollider(physics, e, x, z) {
    physics.setBox(
      e.collider,
      x - ENEMY_RADIUS,
      0,
      z - ENEMY_RADIUS,
      x + ENEMY_RADIUS,
      ENEMY_HEIGHT,
      z + ENEMY_RADIUS,
    );
  }

  _byId(id) {
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].id === id) return this.enemies[i];
    }
    return null;
  }

  getEnemy(id) {
    return this._byId(id);
  }

  _applyDamage(ctx, e, payload) {
    const amount = payload.amount || 0;
    e.health -= amount;
    if (e.health < 0) e.health = 0;

    e.flash = 0.08;
    for (const m of e.flashMats) {
      m.color?.setRGB?.(1, 1, 1);
    }

    ctx.events.emit('damage:taken', {
      amount,
      from: payload.from ?? null,
      health: e.health,
    });

    const killed = e.health <= 0;
    payload.killed = killed;

    if (killed) {
      e.alive = false;
      ctx.get('physics').remove(e.collider);
      e.group.visible = false;
      ctx.events.emit('actor:death', {
        actor: e.id,
        point: { x: e.position.x, y: e.position.y + 1, z: e.position.z },
        impulse: payload.point ?? null,
      });
    }
  }

  dispose() {
    if (this._unsubDamage) this._unsubDamage();
    if (this._root) {
      for (const e of this.enemies) {
        if (e.gltf) disposeModelInstance(e.group);
      }
      this._root.parent?.remove(this._root);
    }
    for (const g of this._geoms) g.dispose();
    for (const m of this._mats) m.dispose();
    this.enemies.length = 0;
  }
}
