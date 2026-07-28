import * as THREE from 'three';

/**
 * First-person controller: look, WASD, jump, sprint.
 *
 * Public surface (ctx.get('player')):
 *   position, eye, yaw, pitch, health, maxHealth, alive, velocity
 *   grounded, sprinting, stance, sliding, ads
 *   getLookDir(out), getEyePosition(out)
 *
 * Events: player:state, player:land, player:footstep, damage:taken, actor:death
 */

const EYE_HEIGHT = 1.65;
const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = 1.8;
const HALF_HEIGHT = CAPSULE_HEIGHT * 0.5 - CAPSULE_RADIUS;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 8.0;
const JUMP_SPEED = 6.2;
const GRAVITY = 18;
const MOUSE_SENS = 0.0022;
const LAYER_STATIC = 1;
const RESPAWN_DELAY = 2.5;

export class PlayerSystem {
  static id = 'player';
  static deps = ['physics', 'world'];

  constructor() {
    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.grounded = false;
    this.sprinting = false;
    this.stance = 'stand';
    this.sliding = false;
    this.ads = false;
    /** Seconds until respawn while dead (0 when alive). */
    this.respawnIn = 0;

    this._lookDir = new THREE.Vector3(0, 0, -1);
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._eyeOut = new THREE.Vector3();
    this._footstepAcc = 0;
    this._stateDirty = true;
    this._lockstep = false;
    this._ctx = null;

    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onMouseMove = null;
    this._onMouseDown = null;
    this._onMouseUp = null;
    this._onPointerLock = null;
    this._unsubDamage = null;
  }

  async init(ctx) {
    const world = ctx.get('world');
    const spawn = world.playerSpawn;

    this.position.set(spawn.x, spawn.y + CAPSULE_HEIGHT * 0.5, spawn.z);
    this.prevPosition.copy(this.position);
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.eye.set(this.position.x, this.position.y + (EYE_HEIGHT - CAPSULE_HEIGHT * 0.5), this.position.z);

    this._lockstep =
      new URLSearchParams(window.location.search).get('lockstep') === '1' ||
      window.__LOCKSTEP__ === true;

    this._ctx = ctx;
    this._bindInput(ctx);
    this._applyCamera(ctx, this.eye);

    this._unsubDamage = ctx.events.on('damage:dealt', (payload) => {
      if (!payload || payload.target !== 'player') return;
      this._onDamage(ctx, payload);
    });
  }

  _bindInput(ctx) {
    const input = ctx.input;
    const canvas = ctx.canvas;

    this._onKeyDown = (e) => {
      input.keys[e.code] = true;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => {
      input.keys[e.code] = false;
    };
    this._onMouseMove = (e) => {
      if (!input.mouse.locked && !this._lockstep) return;
      input.mouse.dx += e.movementX || 0;
      input.mouse.dy += e.movementY || 0;
      input.look.dx += e.movementX || 0;
      input.look.dy += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      input.buttons[e.button] = true;
      if (!this._lockstep && !input.mouse.locked) {
        canvas.requestPointerLock?.();
      }
    };
    this._onMouseUp = (e) => {
      input.buttons[e.button] = false;
    };
    this._onPointerLock = () => {
      input.mouse.locked = document.pointerLockElement === canvas;
      input.active = input.mouse.locked || this._lockstep;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onPointerLock);

    if (this._lockstep) {
      input.active = true;
      input.mouse.locked = true;
    }
  }

  fixedUpdate(h, ctx) {
    // Death → countdown → respawn (prevents soft-lock with frozen camera)
    if (!this.alive) {
      this.prevPosition.copy(this.position);
      this.respawnIn -= h;
      // Death cam: sink eye + look down slightly
      if (this.pitch < 0.55) this.pitch += h * 0.4;
      if (this.respawnIn <= 0) {
        this._respawn(ctx);
      }
      return;
    }

    const input = ctx.input;
    const physics = ctx.get('physics');
    const keys = input.keys;

    const wantSprint = !!(keys['ShiftLeft'] || keys['ShiftRight']);
    const forwardHeld = !!(keys['KeyW'] || keys['ArrowUp']);
    const backHeld = !!(keys['KeyS'] || keys['ArrowDown']);
    const leftHeld = !!(keys['KeyA'] || keys['ArrowLeft']);
    const rightHeld = !!(keys['KeyD'] || keys['ArrowRight']);

    this.sprinting = wantSprint && forwardHeld && !backHeld;
    // ADS: hold RMB or KeyE (not while reloading handled in weapons)
    this.ads = !!(input.buttons[2] || keys['KeyE']);

    const f = (forwardHeld ? 1 : 0) - (backHeld ? 1 : 0);
    const r = (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this._wish.set(0, 0, 0);
    if (f !== 0 || r !== 0) {
      const speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
      this._wish.addScaledVector(this._forward, f);
      this._wish.addScaledVector(this._right, r);
      this._wish.normalize().multiplyScalar(speed);
    }

    if (this.grounded && keys['Space']) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    this.velocity.y -= GRAVITY * h;
    this.velocity.x = this._wish.x;
    this.velocity.z = this._wish.z;

    this.prevPosition.copy(this.position);

    const out = physics.moveCapsule(
      this.position.x,
      this.position.y,
      this.position.z,
      CAPSULE_RADIUS,
      HALF_HEIGHT,
      this.velocity.x * h,
      this.velocity.y * h,
      this.velocity.z * h,
      h,
      LAYER_STATIC,
    );

    this.position.set(out.x, out.y, out.z);

    if (out.grounded) {
      if (!this.grounded && this.velocity.y < -2) {
        ctx.events.emit('player:land', {
          velocity: this.velocity.y,
          surface: 'concrete',
        });
      }
      this.grounded = true;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else {
      this.grounded = false;
    }
    if (out.hitCeiling && this.velocity.y > 0) {
      this.velocity.y = 0;
    }

    const spd = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && spd > 0.5) {
      this._footstepAcc += spd * h;
      const stride = this.sprinting ? 1.6 : 1.2;
      if (this._footstepAcc >= stride) {
        this._footstepAcc = 0;
        ctx.events.emit('player:footstep', {
          position: { x: this.position.x, y: 0, z: this.position.z },
          surface: 'concrete',
          running: this.sprinting,
        });
      }
    } else {
      this._footstepAcc = 0;
    }

    this._stateDirty = true;
  }

  update(_dt, ctx) {
    const input = ctx.input;

    // Always drive the camera (alive or death cam) so the frame never freezes
    if (this.alive && (input.mouse.locked || this._lockstep)) {
      this.yaw -= input.look.dx * MOUSE_SENS;
      this.pitch -= input.look.dy * MOUSE_SENS;
      const lim = Math.PI * 0.5 - 0.01;
      if (this.pitch > lim) this.pitch = lim;
      if (this.pitch < -lim) this.pitch = -lim;
    }

    const a = ctx.time.alpha;
    const ix = this.prevPosition.x + (this.position.x - this.prevPosition.x) * a;
    const iy = this.prevPosition.y + (this.position.y - this.prevPosition.y) * a;
    const iz = this.prevPosition.z + (this.position.z - this.prevPosition.z) * a;

    // Death: lower eye height for a fall-to-ground feel
    const eyeOff = this.alive
      ? EYE_HEIGHT - CAPSULE_HEIGHT * 0.5
      : 0.35 - CAPSULE_HEIGHT * 0.5;
    this.eye.set(ix, iy + eyeOff, iz);
    this._applyCamera(ctx, this.eye);

    if (this.alive && this._stateDirty) {
      ctx.events.emit('player:state', {
        stance: this.stance,
        sprinting: this.sprinting,
        sliding: this.sliding,
        ads: this.ads,
      });
      this._stateDirty = false;
    }
  }

  _applyCamera(ctx, eye) {
    const cam = ctx.camera;
    cam.position.copy(eye);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;
  }

  getLookDir(out = this._lookDir) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  getEyePosition(out = this._eyeOut) {
    // Use logic-eye (non-interpolated) for hitscan determinism
    out.x = this.position.x;
    out.y = this.position.y + (EYE_HEIGHT - CAPSULE_HEIGHT * 0.5);
    out.z = this.position.z;
    return out;
  }

  _onDamage(ctx, payload) {
    if (!this.alive) return;
    const amount = payload.amount || 0;
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    ctx.events.emit('damage:taken', {
      amount,
      from: payload.from ?? null,
      health: this.health,
    });
    if (this.health <= 0) {
      this.alive = false;
      this.respawnIn = RESPAWN_DELAY;
      this.velocity.set(0, 0, 0);
      this.sprinting = false;
      ctx.events.emit('actor:death', {
        actor: 'player',
        point: { x: this.position.x, y: this.position.y, z: this.position.z },
        impulse: payload.point ?? null,
      });
    }
  }

  _respawn(ctx) {
    const world = ctx.get('world');
    const spawn = world.playerSpawn;
    this.position.set(spawn.x, spawn.y + CAPSULE_HEIGHT * 0.5, spawn.z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.respawnIn = 0;
    this.grounded = true;
    this.eye.set(
      this.position.x,
      this.position.y + (EYE_HEIGHT - CAPSULE_HEIGHT * 0.5),
      this.position.z,
    );
    this._applyCamera(ctx, this.eye);
    // Soft refill so death isn't a soft-lock into empty mag
    if (ctx.has('weapons')) {
      const w = ctx.get('weapons');
      if (w.current) {
        w.current.ammo = w.current.magSize;
        if (w.current.reserve < 30) w.current.reserve = 60;
      }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    if (this._ctx) {
      this._ctx.canvas.removeEventListener('mousedown', this._onMouseDown);
    }
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    if (this._unsubDamage) this._unsubDamage();
  }
}
