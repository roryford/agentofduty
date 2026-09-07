import * as THREE from 'three';

/** First-person controller with simulation-owned stance, vault and health. */

export const PLAYER_DIMENSIONS = Object.freeze({
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.25,
  standEye: 1.65,
  crouchEye: 1.08,
});

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 3.0;
const SPRINT_SPEED = 8.0;
const JUMP_SPEED = 6.2;
const GRAVITY = 18;
const LAYER_STATIC = 1;
const REGEN_DELAY = 4;
const REGEN_RATE = 18;
const VAULT_DURATION = 0.34;
const VAULT_ARC = 1.0;
const VAULT_COLLISION_HEIGHT = 1.15;

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function sessionPlaying(ctx, lockstep) {
  return ctx.session ? ctx.session.playing === true : lockstep || ctx.input.active === true;
}

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
    this.vaulting = false;
    this.respawnIn = 0;
    this.capsuleRadius = PLAYER_DIMENSIONS.radius;
    this.capsuleHeight = PLAYER_DIMENSIONS.standHeight;

    this._lookDir = new THREE.Vector3(0, 0, -1);
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._eyeOut = new THREE.Vector3();
    this._hurtbox = { minx: 0, miny: 0, minz: 0, maxx: 0, maxy: 0, maxz: 0 };
    this._footstepAcc = 0;
    this._stateDirty = true;
    this._lockstep = false;
    this._ctx = null;
    this._jumpHeld = false;
    this._crouchHeld = false;
    this._timeSinceDamage = Infinity;
    this._vaultTime = 0;
    this._vaultStart = new THREE.Vector3();
    this._vaultEnd = new THREE.Vector3();
    this._vaultSample = new THREE.Vector3();
    this._unsubs = [];
  }

  async init(ctx) {
    this._ctx = ctx;
    this._lockstep =
      new URLSearchParams(window.location.search).get('lockstep') === '1' ||
      window.__LOCKSTEP__ === true;
    this.reset({ spawn: ctx.get('world').playerSpawn }, ctx);
    this._bindInput(ctx);
    this._applyCamera(ctx, this.eye);
    this._unsubs.push(
      ctx.events.on('damage:dealt', (payload) => {
        if (payload?.target === 'player') this._onDamage(ctx, payload);
      }),
      ctx.events.on('session:reset', (payload) => this.reset(payload, ctx)),
    );
  }

  _bindInput(ctx) {
    const input = ctx.input;
    const canvas = ctx.canvas;
    this._onKeyDown = (e) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this._pauseControl(ctx);
        return;
      }
      if (!sessionPlaying(ctx, this._lockstep)) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      input.keys[e.code] = true;
    };
    this._onKeyUp = (e) => {
      input.keys[e.code] = false;
    };
    this._onMouseMove = (e) => {
      if (!sessionPlaying(ctx, this._lockstep) || (!input.mouse.locked && !this._lockstep)) return;
      input.mouse.dx += e.movementX || 0;
      input.mouse.dy += e.movementY || 0;
      input.look.dx += e.movementX || 0;
      input.look.dy += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this._lockstep && !input.mouse.locked) {
        // The acquisition click starts play and is deliberately never a shot.
        try {
          const pending = canvas.requestPointerLock?.();
          if (pending?.catch) pending.catch((err) => this._reportPointerLockFailure(ctx, err));
        } catch (err) {
          this._reportPointerLockFailure(ctx, err);
        }
        return;
      }
      if (sessionPlaying(ctx, this._lockstep)) input.buttons[e.button] = true;
    };
    this._onMouseUp = (e) => {
      input.buttons[e.button] = false;
    };
    this._onPointerLock = () => {
      const locked = document.pointerLockElement === canvas;
      input.mouse.locked = locked;
      input.active = locked || this._lockstep;
      if (locked) (ctx.session?.resume ?? ctx.session?.start)?.call(ctx.session);
      else if (!this._lockstep) {
        input.reset();
        ctx.session?.pause?.();
      }
    };
    this._onPointerLockError = (event) => this._reportPointerLockFailure(ctx, event?.error);
    this._onBlur = () => {
      if (this._lockstep) return;
      this._pauseControl(ctx);
    };
    this._onVisibility = () => {
      if (document.hidden) this._onBlur();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onPointerLock);
    document.addEventListener('pointerlockerror', this._onPointerLockError);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVisibility);
    if (this._lockstep) {
      input.active = true;
      input.mouse.locked = true;
    }
  }

  _reportPointerLockFailure(ctx, err) {
    const message = err?.message || ctx.session?.message ||
      'This browser could not capture the mouse. Open the game in Chrome, then click Deploy again.';
    if (ctx.session) ctx.session.message = message;
    else console.warn(`[player] ${message}`);
  }

  _pauseControl(ctx) {
    if (this._lockstep) return;
    ctx.input.reset();
    ctx.session?.pause?.();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  fixedUpdate(h, ctx) {
    if (!this.alive) {
      this.prevPosition.copy(this.position);
      this.respawnIn = Math.max(0, ctx.session?.deathRemaining ?? 0);
      if (this.pitch < 0.42) this.pitch = Math.min(0.42, this.pitch + h * 0.32);
      return;
    }
    if (!sessionPlaying(ctx, this._lockstep)) return;

    const input = ctx.input;
    const physics = ctx.get('physics');
    const keys = input.keys;
    const forwardHeld = !!(keys.KeyW || keys.ArrowUp);
    const backHeld = !!(keys.KeyS || keys.ArrowDown);
    const leftHeld = !!(keys.KeyA || keys.ArrowLeft);
    const rightHeld = !!(keys.KeyD || keys.ArrowRight);
    const jumpHeld = !!keys.Space;
    const jumpPressed = jumpHeld && !this._jumpHeld;
    this._jumpHeld = jumpHeld;

    const wantCrouch = !!(keys.KeyC || keys.ControlLeft || keys.ControlRight);
    if (wantCrouch !== this._crouchHeld) {
      this._crouchHeld = wantCrouch;
      this._setCrouched(wantCrouch, physics);
    } else if (!wantCrouch && this.stance === 'crouch') {
      this._setCrouched(false, physics);
    }

    const wantSprint = !!(keys.ShiftLeft || keys.ShiftRight);
    this.sprinting = wantSprint && forwardHeld && !backHeld && this.stance === 'stand' && !this.vaulting;
    this.ads = !!(input.buttons[2] || keys.KeyE) && !this.sprinting && !this.vaulting;

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.vaulting) {
      this._advanceVault(h, ctx);
      this._updateHealth(h);
      this._stateDirty = true;
      return;
    }

    const f = (forwardHeld ? 1 : 0) - (backHeld ? 1 : 0);
    const r = (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);
    this._wish.set(0, 0, 0);
    if (f !== 0 || r !== 0) {
      const speed = this.stance === 'crouch' ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
      this._wish.addScaledVector(this._forward, f).addScaledVector(this._right, r);
      this._wish.normalize().multiplyScalar(speed);
    }

    if (this.grounded && jumpPressed) {
      if (!forwardHeld || !this._tryStartVault(ctx, physics)) {
        this.velocity.y = JUMP_SPEED;
        this.grounded = false;
      }
    }

    this.velocity.y -= GRAVITY * h;
    this.velocity.x = this._wish.x;
    this.velocity.z = this._wish.z;
    this.prevPosition.copy(this.position);
    const halfHeight = this.capsuleHeight * 0.5 - this.capsuleRadius;
    const out = physics.moveCapsule(
      this.position.x,
      this.position.y,
      this.position.z,
      this.capsuleRadius,
      halfHeight,
      this.velocity.x * h,
      this.velocity.y * h,
      this.velocity.z * h,
      h,
      LAYER_STATIC,
    );
    this.position.set(out.x, out.y, out.z);
    if (out.grounded) {
      if (!this.grounded && this.velocity.y < -2) {
        ctx.events.emit('player:land', { velocity: this.velocity.y, surface: 'concrete' });
      }
      this.grounded = true;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else this.grounded = false;
    if (out.hitCeiling && this.velocity.y > 0) this.velocity.y = 0;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && speed > 0.5) {
      this._footstepAcc += speed * h;
      const stride = this.sprinting ? 1.6 : this.stance === 'crouch' ? 0.9 : 1.2;
      if (this._footstepAcc >= stride) {
        this._footstepAcc = 0;
        ctx.events.emit('player:footstep', {
          position: { x: this.position.x, y: this.position.y - this.capsuleHeight * 0.5, z: this.position.z },
          surface: 'concrete',
          running: this.sprinting,
        });
      }
    } else this._footstepAcc = 0;

    this._updateHealth(h);
    this._stateDirty = true;
  }

  _setCrouched(crouched, physics) {
    const targetHeight = crouched ? PLAYER_DIMENSIONS.crouchHeight : PLAYER_DIMENSIONS.standHeight;
    if (targetHeight === this.capsuleHeight) return true;
    const feet = this.position.y - this.capsuleHeight * 0.5;
    const targetY = feet + targetHeight * 0.5;
    const halfHeight = targetHeight * 0.5 - this.capsuleRadius;
    if (!crouched && physics.capsuleBlocked(
      this.position.x,
      targetY,
      this.position.z,
      this.capsuleRadius,
      halfHeight,
      LAYER_STATIC,
    )) return false;
    this.position.y = targetY;
    this.prevPosition.y = targetY;
    this.capsuleHeight = targetHeight;
    this.stance = crouched ? 'crouch' : 'stand';
    return true;
  }

  _tryStartVault(ctx, physics) {
    if (this.stance !== 'stand') return false;
    const feet = this.position.y - this.capsuleHeight * 0.5;
    const fx = this._forward.x;
    const fz = this._forward.z;
    const low = physics.raycast(this.position.x, feet + 0.48, this.position.z, fx, 0, fz, 0.85, LAYER_STATIC);
    if (!low) return false;
    const obstacle = physics.getCollider(low.collider);
    if (!obstacle || obstacle.maxy - feet > 0.9) return false;
    const high = physics.raycast(this.position.x, feet + 1.28, this.position.z, fx, 0, fz, 0.95, LAYER_STATIC);
    if (high) return false;
    const targetX = this.position.x + fx * (low.distance + 1.0);
    const targetZ = this.position.z + fz * (low.distance + 1.0);
    const ground = physics.raycast(targetX, feet + 2.0, targetZ, 0, -1, 0, 3.0, LAYER_STATIC);
    if (!ground || ground.normalY < 0.6) return false;
    const targetY = ground.pointY + PLAYER_DIMENSIONS.standHeight * 0.5;
    const halfHeight = PLAYER_DIMENSIONS.standHeight * 0.5 - this.capsuleRadius;
    if (physics.capsuleBlocked(targetX, targetY + 0.02, targetZ, this.capsuleRadius, halfHeight, LAYER_STATIC)) return false;
    this._vaultStart.copy(this.position);
    this._vaultEnd.set(targetX, targetY, targetZ);
    const vaultHalfHeight = VAULT_COLLISION_HEIGHT * 0.5 - this.capsuleRadius;
    for (let i = 1; i < 12; i++) {
      this._sampleVault(i / 12, this._vaultSample);
      if (physics.capsuleBlocked(
        this._vaultSample.x,
        this._vaultSample.y,
        this._vaultSample.z,
        this.capsuleRadius,
        vaultHalfHeight,
        LAYER_STATIC,
      )) return false;
    }
    this.vaulting = true;
    this.grounded = false;
    this.sprinting = false;
    this.ads = false;
    this._vaultTime = 0;
    this.velocity.set(0, 0, 0);
    ctx.events.emit('player:state', { stance: this.stance, sprinting: false, sliding: false, ads: false, vaulting: true });
    return true;
  }

  _advanceVault(h, ctx) {
    this.prevPosition.copy(this.position);
    this._vaultTime += h;
    const t = Math.min(1, this._vaultTime / VAULT_DURATION);
    this._sampleVault(t, this.position);
    if (t >= 1) {
      this.position.copy(this._vaultEnd);
      this.prevPosition.copy(this.position);
      this.vaulting = false;
      this.grounded = true;
      ctx.events.emit('player:land', { velocity: -3, surface: 'concrete' });
    }
  }

  _sampleVault(t, out) {
    // Lift before advancing and finish the traverse before descending.
    const travel = smoothstep(Math.max(0, Math.min(1, (t - 0.18) / 0.64)));
    out.lerpVectors(this._vaultStart, this._vaultEnd, travel);
    out.y += Math.sin(t * Math.PI) * VAULT_ARC;
    return out;
  }

  _updateHealth(h) {
    this._timeSinceDamage += h;
    if (this._timeSinceDamage >= REGEN_DELAY && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + REGEN_RATE * h);
    }
  }

  update(_dt, ctx) {
    const input = ctx.input;
    if (this.alive && sessionPlaying(ctx, this._lockstep) && (input.mouse.locked || this._lockstep)) {
      const settings = ctx.session?.settings;
      const sensitivity = settings?.sensitivity ?? 0.0022;
      const adsScale = this.ads ? settings?.adsSensitivity ?? 0.65 : 1;
      const invert = settings?.invertY ? -1 : 1;
      this.yaw -= input.look.dx * sensitivity * adsScale;
      this.pitch -= input.look.dy * sensitivity * adsScale * invert;
      const limit = Math.PI * 0.5 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    }
    const a = ctx.time.alpha;
    const ix = this.prevPosition.x + (this.position.x - this.prevPosition.x) * a;
    const iy = this.prevPosition.y + (this.position.y - this.prevPosition.y) * a;
    const iz = this.prevPosition.z + (this.position.z - this.prevPosition.z) * a;
    const feet = iy - this.capsuleHeight * 0.5;
    const eyeHeight = this.alive
      ? this.stance === 'crouch' ? PLAYER_DIMENSIONS.crouchEye : PLAYER_DIMENSIONS.standEye
      : 0.35;
    this.eye.set(ix, feet + eyeHeight, iz);
    this._applyCamera(ctx, this.eye);
    if (this.alive && this._stateDirty) {
      ctx.events.emit('player:state', {
        stance: this.stance,
        sprinting: this.sprinting,
        sliding: false,
        ads: this.ads,
        vaulting: this.vaulting,
      });
      this._stateDirty = false;
    }
  }

  _applyCamera(ctx, eye) {
    ctx.camera.position.copy(eye);
    ctx.camera.rotation.order = 'YXZ';
    ctx.camera.rotation.y = this.yaw;
    ctx.camera.rotation.x = this.pitch;
  }

  getLookDir(out = this._lookDir) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  getEyePosition(out = this._eyeOut) {
    const feet = this.position.y - this.capsuleHeight * 0.5;
    out.x = this.position.x;
    out.y = feet + (this.stance === 'crouch' ? PLAYER_DIMENSIONS.crouchEye : PLAYER_DIMENSIONS.standEye);
    out.z = this.position.z;
    return out;
  }

  getHurtbox(out = this._hurtbox) {
    const r = this.capsuleRadius;
    const height = this.vaulting ? VAULT_COLLISION_HEIGHT : this.capsuleHeight;
    out.minx = this.position.x - r;
    out.maxx = this.position.x + r;
    out.miny = this.position.y - height * 0.5;
    out.maxy = this.position.y + height * 0.5;
    out.minz = this.position.z - r;
    out.maxz = this.position.z + r;
    return out;
  }

  _onDamage(ctx, payload) {
    if (!this.alive) return;
    const amount = Math.max(0, payload.amount || 0);
    this.health = Math.max(0, this.health - amount);
    this._timeSinceDamage = 0;
    const killed = this.health <= 0;
    const result = {
      target: 'player',
      from: payload.from ?? null,
      amount,
      health: this.health,
      headshot: !!payload.headshot,
      killed,
      point: payload.point ?? null,
    };
    ctx.events.emit('damage:taken', result);
    ctx.events.emit('combat:hit', result);
    if (killed) {
      this.alive = false;
      this.velocity.set(0, 0, 0);
      this.sprinting = false;
      this.ads = false;
      this.vaulting = false;
      ctx.events.emit('actor:death', {
        actor: 'player',
        from: payload.from ?? null,
        headshot: !!payload.headshot,
        point: { x: this.position.x, y: this.position.y, z: this.position.z },
        impulse: payload.point ?? null,
      });
    }
  }

  reset(payload = {}, ctx = this._ctx) {
    if (!ctx) return;
    const spawn = payload.spawn ?? ctx.get('world').playerSpawn;
    this.capsuleHeight = PLAYER_DIMENSIONS.standHeight;
    this.position.set(spawn.x, (spawn.y ?? 0) + this.capsuleHeight * 0.5, spawn.z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.respawnIn = 0;
    this.grounded = true;
    this.sprinting = false;
    this.stance = 'stand';
    this.ads = false;
    this.vaulting = false;
    this._jumpHeld = !!ctx.input.keys.Space;
    this._crouchHeld = false;
    this._timeSinceDamage = Infinity;
    this._footstepAcc = 0;
    this.getEyePosition(this.eye);
    this._applyCamera(ctx, this.eye);
    this._stateDirty = true;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this._ctx?.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;
  }
}
