import * as THREE from 'three';
import { cloneModel, disposeModelInstance, loadModelTemplate, MODELS } from '../assets/gltf.js';

/**
 * Hitscan rifle + first-person viewmodel (Blender GLB with procedural fallback).
 *
 * Public surface (ctx.get('weapons')):
 *   current, firing, recoilPitch, recoilYaw, heat
 *
 * Viewmodel coord contract (after Blender glTF Y-up export):
 *   - Camera space: +X right, +Y up, −Z into scene (barrel aims −Z)
 *   - Blender script builds barrel along −Y / +Z up; export_yup maps that to −Z / +Y
 *   - Hip rest: HIP_POS / HIP_ROT; ADS: ADS_POS / ADS_ROT (smoothed in update)
 *   - Document any new rotation alongside tools/blender/export_hero_meshes.py
 */

const LAYER_STATIC = 1;
const LAYER_ENEMY = 4;
const HIT_MASK = LAYER_STATIC | LAYER_ENEMY;

// Camera-local rest poses
const HIP_POS = { x: 0.28, y: -0.24, z: -0.48 };
const HIP_ROT = { x: 0.05, y: 0.1, z: 0.03 };
// Align holographic optic with screen center when ADS
const ADS_POS = { x: 0.0, y: -0.118, z: -0.28 };
const ADS_ROT = { x: 0.0, y: 0.0, z: 0.0 };
const SPRINT_POS = { x: 0.3, y: -0.34, z: -0.42 };
const SPRINT_ROT = { x: 0.42, y: 0.15, z: 0.18 };
const ADS_SECONDS = 0.2;
const SPRINT_TO_FIRE = 0.22;

/** Aim-relative spread. rightOffset/upOffset are normalized sample coordinates. */
export function computeSpreadDirection(forward, rightOffset, upOffset, spread, out = {}) {
  let fx = forward.x;
  let fy = forward.y;
  let fz = forward.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = normalize(forward x worldUp), with a stable pole fallback.
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  let rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    ry = 0;
    rz = 0;
    rl = 1;
  }
  rx /= rl;
  rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  let dx = fx + rx * rightOffset * spread + ux * upOffset * spread;
  let dy = fy + ry * rightOffset * spread + uy * upOffset * spread;
  let dz = fz + rz * rightOffset * spread + uz * upOffset * spread;
  const dl = Math.hypot(dx, dy, dz) || 1;
  out.x = dx / dl;
  out.y = dy / dl;
  out.z = dz / dl;
  return out;
}

export class WeaponsSystem {
  static id = 'weapons';
  static deps = ['physics', 'player', 'materials'];

  constructor() {
    this.current = {
      id: 'rifle',
      name: 'Rifle',
      ammo: 30,
      reserve: 90,
      magSize: 30,
      rpm: 600,
      damage: 28,
      range: 120,
      spread: 0.004,
      reloadTime: 1.6,
      recoilPitch: 0.018,
      recoilYaw: 0.006,
      recovery: 8,
    };
    this.firing = false;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.heat = 0;
    this._cooldown = 0;
    this._reloading = false;
    this._reloadLeft = 0;
    this._reloadHeld = false;
    this._firePeriod = 60 / this.current.rpm;
    this.handlingState = 'hip';
    this.ads = 0;
    this._adsPrev = 0;
    this._sprintRecovery = 0;

    this._origin = { x: 0, y: 0, z: 0 };
    this._dir = { x: 0, y: 0, z: -1 };
    this._from = { x: 0, y: 0, z: 0 };
    this._to = { x: 0, y: 0, z: 0 };
    this._point = { x: 0, y: 0, z: 0 };
    this._normal = { x: 0, y: 1, z: 0 };
    this._incident = { x: 0, y: 0, z: -1 };
    this._eye = { x: 0, y: 0, z: 0 };
    this._look = { x: 0, y: 0, z: -1 };
    this._rng = null;
    this._lockstep = false;

    this._gun = null;
    this._gunRoot = null;
    this._hand = null;
    this._optic = null;
    this._reticle = null;
    this._gunBase = new THREE.Vector3(HIP_POS.x, HIP_POS.y, HIP_POS.z);
    this._posePos = new THREE.Vector3(HIP_POS.x, HIP_POS.y, HIP_POS.z);
    this._poseRot = new THREE.Euler(HIP_ROT.x, HIP_ROT.y, HIP_ROT.z, 'YXZ');
    this._kickPos = new THREE.Vector3();
    this._kickRot = new THREE.Euler(0, 0, 0, 'YXZ');
    this._bob = 0;
    this._adsBlend = 0;
    this._muzzleFlash = null;
    this._muzzleLife = 0;
    this._geoms = [];
    this._mats = [];
    this._viewLights = [];
    this._usingGltf = false;
    this._unsubReset = null;
    this._magazine = null;
    this._magazineRest = new THREE.Vector3();
    this._magazineRestRotation = new THREE.Euler();
  }

  async init(ctx) {
    this._rng = ctx.rng.fork('weapons');
    this._firePeriod = 60 / this.current.rpm;
    this._lockstep =
      new URLSearchParams(window.location.search).get('lockstep') === '1' ||
      window.__LOCKSTEP__ === true;

    await this._buildViewmodel(ctx);
    this._unsubReset = ctx.events.on('session:reset', (payload) => this.reset(payload, ctx));
  }

  async _buildViewmodel(ctx) {
    const mount = new THREE.Group();
    mount.name = 'viewmodel_mount';
    mount.frustumCulled = false;

    // Prefer Blender rifle (barrel −Z after export_yup — see coord contract above)
    try {
      const template = await loadModelTemplate(MODELS.rifle);
      const gun = cloneModel(template);
      gun.name = 'viewmodel_rifle_glb';
      gun.rotation.set(0, 0, 0);
      gun.scale.setScalar(1.2);
      gun.traverse((o) => {
        if (o.isMesh) o.frustumCulled = false;
      });
      mount.add(gun);
      this._gun = gun;
      this._usingGltf = true;
    } catch (err) {
      console.warn('[weapons] rifle.glb failed, procedural fallback', err);
      this._buildProceduralGun(mount);
      this._usingGltf = false;
    }

    this._buildHand(mount);
    this._buildOptic(mount);
    this._magazine = this._gun?.getObjectByName?.('magazine') ?? null;
    if (!this._magazine) {
      const magMaterial = new THREE.MeshStandardMaterial({ color: 0x24282d, metalness: 0.55, roughness: 0.5 });
      const magGeometry = new THREE.BoxGeometry(0.045, 0.105, 0.055);
      this._mats.push(magMaterial);
      this._geoms.push(magGeometry);
      this._magazine = new THREE.Mesh(magGeometry, magMaterial);
      this._magazine.name = 'magazine';
      this._magazine.position.set(0, -0.075, 0.035);
      this._magazine.rotation.x = -0.12;
      mount.add(this._magazine);
    }
    this._magazineRest.copy(this._magazine.position);
    this._magazineRestRotation.copy(this._magazine.rotation);

    // Muzzle flash tip
    const glow = new THREE.MeshBasicMaterial({
      color: 0xffb040,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._mats.push(glow);
    const flashGeom = new THREE.PlaneGeometry(0.07, 0.07);
    this._geoms.push(flashGeom);
    this._muzzleFlash = new THREE.Mesh(flashGeom, glow);
    this._muzzleFlash.position.set(0, 0.02, -0.48);
    this._muzzleFlash.visible = false;
    this._muzzleFlash.frustumCulled = false;
    mount.add(this._muzzleFlash);
    this._glowMat = glow;

    mount.position.copy(this._posePos);
    mount.rotation.copy(this._poseRot);

    const amb = new THREE.AmbientLight(0xb0c0d8, 1.6);
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    key.position.set(0.6, 0.9, 0.7);
    const fill = new THREE.DirectionalLight(0x7090c0, 1.1);
    fill.position.set(-0.7, 0.3, 0.4);
    const rim = new THREE.DirectionalLight(0xd0e0ff, 0.9);
    rim.position.set(0.0, 0.4, -0.9);
    this._viewLights.push(amb, key, fill, rim);

    if (!ctx.viewCamera.parent) ctx.viewScene.add(ctx.viewCamera);
    ctx.viewCamera.add(mount);
    ctx.viewScene.add(amb);
    ctx.viewScene.add(key);
    ctx.viewScene.add(fill);
    ctx.viewScene.add(rim);

    this._gunRoot = mount;
  }

  _buildProceduralGun(mount) {
    const body = new THREE.MeshStandardMaterial({
      color: 0x3c424c,
      metalness: 0.55,
      roughness: 0.48,
      emissive: 0x141820,
      emissiveIntensity: 0.2,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x6a7280,
      metalness: 0.85,
      roughness: 0.32,
      emissive: 0x181c24,
      emissiveIntensity: 0.18,
    });
    this._mats.push(body, steel);
    const g = new THREE.Group();
    const box = (w, h, d, x, y, z, mat) => {
      const geom = new THREE.BoxGeometry(w, h, d);
      this._geoms.push(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false;
      g.add(m);
    };
    box(0.09, 0.1, 0.28, 0, 0, 0, body);
    const cyl = new THREE.CylinderGeometry(0.014, 0.016, 0.4, 10);
    this._geoms.push(cyl);
    const barrel = new THREE.Mesh(cyl, steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.35);
    barrel.frustumCulled = false;
    g.add(barrel);
    mount.add(g);
    this._gun = g;
  }

  /** Gloved support hand under the handguard — dark green tactical glove. */
  _buildHand(mount) {
    const glove = new THREE.MeshStandardMaterial({
      color: 0x1a2e1a,
      roughness: 0.88,
      metalness: 0.08,
      emissive: 0x061206,
      emissiveIntensity: 0.12,
    });
    const knuckle = new THREE.MeshStandardMaterial({
      color: 0x0f1a0f,
      roughness: 0.75,
      metalness: 0.15,
      emissive: 0x040804,
      emissiveIntensity: 0.08,
    });
    this._mats.push(glove, knuckle);

    const hand = new THREE.Group();
    hand.name = 'viewmodel_hand';
    const box = (w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) => {
      const geom = new THREE.BoxGeometry(w, h, d);
      this._geoms.push(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.frustumCulled = false;
      hand.add(m);
    };
    // Wrist / forearm stump
    box(0.05, 0.05, 0.1, 0.02, -0.08, -0.02, glove, 0.2, 0, 0.1);
    // Palm under handguard
    box(0.055, 0.03, 0.07, 0.0, -0.07, -0.14, glove, 0.15, 0, 0);
    // Fingers curled over
    box(0.05, 0.025, 0.04, 0.0, -0.045, -0.18, knuckle, 0.6, 0, 0);
    // Thumb
    box(0.02, 0.025, 0.04, -0.035, -0.055, -0.12, glove, 0.3, 0.4, 0.2);

    hand.position.set(0.02, -0.02, 0.02);
    mount.add(hand);
    this._hand = hand;
  }

  /**
   * Holographic optic on the rail — glass + glowing reticle you aim through in ADS.
   * Positioned on top of the receiver so ADS_POS puts the reticle on screen center.
   */
  _buildOptic(mount) {
    const optic = new THREE.Group();
    optic.name = 'viewmodel_optic';

    const housing = new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      metalness: 0.7,
      roughness: 0.4,
      emissive: 0x080a0c,
      emissiveIntensity: 0.1,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88aacc,
      metalness: 0.1,
      roughness: 0.15,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: 0x204060,
      emissiveIntensity: 0.15,
    });
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xff3030,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._mats.push(housing, glassMat, reticleMat);

    const box = (w, h, d, x, y, z, mat) => {
      const geom = new THREE.BoxGeometry(w, h, d);
      this._geoms.push(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false;
      optic.add(m);
      return m;
    };

    // Rail mount base
    box(0.028, 0.012, 0.06, 0, 0.07, -0.02, housing);
    // Open front/rear rims: four rails per plane, never an opaque pane.
    for (const z of [0, -0.055]) {
      box(0.04, 0.006, 0.008, 0, 0.116, z, housing);
      box(0.04, 0.006, 0.008, 0, 0.084, z, housing);
      box(0.006, 0.038, 0.008, -0.017, 0.1, z, housing);
      box(0.006, 0.038, 0.008, 0.017, 0.1, z, housing);
    }
    box(0.008, 0.038, 0.055, -0.016, 0.1, -0.027, housing); // left
    box(0.008, 0.038, 0.055, 0.016, 0.1, -0.027, housing); // right
    box(0.04, 0.008, 0.055, 0, 0.116, -0.027, housing); // top
    box(0.04, 0.008, 0.055, 0, 0.084, -0.027, housing); // bottom

    // Glass panes (see-through)
    const glassGeom = new THREE.PlaneGeometry(0.028, 0.028);
    this._geoms.push(glassGeom);
    const glassFront = new THREE.Mesh(glassGeom, glassMat);
    glassFront.position.set(0, 0.1, -0.052);
    glassFront.frustumCulled = false;
    optic.add(glassFront);
    const glassRear = new THREE.Mesh(glassGeom, glassMat);
    glassRear.position.set(0, 0.1, -0.002);
    glassRear.frustumCulled = false;
    optic.add(glassRear);

    // Holo reticle — small cross + center dot floating in the window
    const reticle = new THREE.Group();
    reticle.name = 'holo_reticle';
    const makeBar = (w, h, x, y) => {
      const g = new THREE.PlaneGeometry(w, h);
      this._geoms.push(g);
      const m = new THREE.Mesh(g, reticleMat);
      m.position.set(x, y, 0);
      m.frustumCulled = false;
      reticle.add(m);
    };
    makeBar(0.012, 0.0012, 0, 0); // horizontal
    makeBar(0.0012, 0.012, 0, 0); // vertical
    const dotG = new THREE.CircleGeometry(0.0018, 10);
    this._geoms.push(dotG);
    const dot = new THREE.Mesh(dotG, reticleMat);
    dot.position.set(0, 0, 0.001);
    dot.frustumCulled = false;
    reticle.add(dot);
    // Sit reticle mid-window, facing camera (−Z)
    reticle.position.set(0, 0.1, -0.028);
    optic.add(reticle);
    this._reticle = reticle;

    // Mount sits on receiver top (camera-local, barrel −Z)
    optic.position.set(0, 0, 0);
    mount.add(optic);
    this._optic = optic;
  }

  fixedUpdate(h, ctx) {
    const player = ctx.get('player');
    if (!player.alive || (ctx.session ? !ctx.session.playing : ctx.input.active === false)) {
      this.firing = false;
      return;
    }

    // Recover exactly the camera impulse still owned by the weapon.
    const oldPitch = this.recoilPitch;
    const oldYaw = this.recoilYaw;
    const recovery = Math.exp(-this.current.recovery * h);
    this.recoilPitch *= recovery;
    this.recoilYaw *= recovery;
    player.pitch += this.recoilPitch - oldPitch;
    player.yaw += this.recoilYaw - oldYaw;
    this.heat = Math.max(0, this.heat - h * 1.5);

    this._kickPos.x *= Math.exp(-12 * h);
    this._kickPos.y *= Math.exp(-12 * h);
    this._kickPos.z *= Math.exp(-14 * h);
    this._kickRot.x *= Math.exp(-10 * h);
    this._kickRot.y *= Math.exp(-10 * h);
    this._kickRot.z *= Math.exp(-10 * h);

    this._cooldown = Math.max(0, this._cooldown - h);
    this._sprintRecovery = player.sprinting ? SPRINT_TO_FIRE : Math.max(0, this._sprintRecovery - h);
    if (this._reloading) {
      this._reloadLeft -= h;
      if (this._reloadLeft <= 0) {
        const need = this.current.magSize - this.current.ammo;
        const take = need < this.current.reserve ? need : this.current.reserve;
        this.current.ammo += take;
        this.current.reserve -= take;
        this._reloading = false;
        this._reloadLeft = 0;
        ctx.events.emit('weapon:reload', { weapon: this.current.id, phase: 'end' });
      }
    }

    this._adsPrev = this.ads;
    const adsTarget = player.ads && !this._reloading && !player.sprinting ? 1 : 0;
    const adsStep = h / ADS_SECONDS;
    this.ads += Math.sign(adsTarget - this.ads) * Math.min(Math.abs(adsTarget - this.ads), adsStep);

    if (this._muzzleLife > 0) {
      this._muzzleLife -= h;
      if (this._muzzleFlash) {
        const a = Math.max(0, this._muzzleLife / 0.04);
        this._glowMat.opacity = a * 0.85;
        this._muzzleFlash.visible = a > 0.05;
        this._muzzleFlash.scale.setScalar(0.7 + a * 0.6);
      }
    }

    const input = ctx.input;
    const wantFire = !!(input.buttons[0] || input.keys['KeyF']);
    const wantReload = !!input.keys['KeyR'];

    const fire = wantFire;
    const reloadPressed = wantReload && !this._reloadHeld;
    this._reloadHeld = wantReload;

    if (
      reloadPressed &&
      !this._reloading &&
      this.current.ammo < this.current.magSize &&
      this.current.reserve > 0
    ) {
      this._startReload(ctx);
    }

    this.firing = false;
    if (fire && !this._reloading && this._cooldown <= 0 && this._sprintRecovery <= 0) {
      if (this.current.ammo > 0) {
        this._fire(ctx, player);
        this._cooldown = this._firePeriod;
        this.firing = true;
      } else if (this.current.reserve > 0) {
        this._startReload(ctx);
      }
    }

    this.handlingState = this._reloading
      ? 'reload'
      : player.sprinting
        ? 'sprint'
        : this._sprintRecovery > 0
          ? 'sprint-recovery'
          : this.ads > 0.98
            ? 'ads'
            : 'hip';
  }

  update(dt, ctx) {
    if (!this._gunRoot) return;
    const player = ctx.get('player');

    // Hide gun while dead
    this._gunRoot.visible = player.alive;
    if (!player.alive) return;

    // Presentation interpolates the fixed-tick handling state.
    const alpha = ctx.time.alpha ?? 1;
    const a = this._adsPrev + (this.ads - this._adsPrev) * alpha;
    this._adsBlend = a;

    // FOV punch on ADS
    const hipFov = 55;
    const adsFov = 42;
    ctx.viewCamera.fov = hipFov + (adsFov - hipFov) * a;
    ctx.viewCamera.updateProjectionMatrix();
    // World camera slight ADS zoom
    const baseFov = ctx.session?.settings?.fov ?? 80;
    const worldFov = baseFov + (baseFov * 0.78 - baseFov) * a;
    if (Math.abs(ctx.camera.fov - worldFov) > 0.01) {
      ctx.camera.fov = worldFov;
      ctx.camera.updateProjectionMatrix();
    }

    // Smoothed pose hip → ADS
    this._posePos.x = HIP_POS.x + (ADS_POS.x - HIP_POS.x) * a;
    this._posePos.y = HIP_POS.y + (ADS_POS.y - HIP_POS.y) * a;
    this._posePos.z = HIP_POS.z + (ADS_POS.z - HIP_POS.z) * a;
    this._poseRot.x = HIP_ROT.x + (ADS_ROT.x - HIP_ROT.x) * a;
    this._poseRot.y = HIP_ROT.y + (ADS_ROT.y - HIP_ROT.y) * a;
    this._poseRot.z = HIP_ROT.z + (ADS_ROT.z - HIP_ROT.z) * a;

    const sprintBlend = player.sprinting ? 1 : Math.min(1, this._sprintRecovery / SPRINT_TO_FIRE);
    this._posePos.x += (SPRINT_POS.x - HIP_POS.x) * sprintBlend * (1 - a);
    this._posePos.y += (SPRINT_POS.y - HIP_POS.y) * sprintBlend * (1 - a);
    this._posePos.z += (SPRINT_POS.z - HIP_POS.z) * sprintBlend * (1 - a);
    this._poseRot.x += (SPRINT_ROT.x - HIP_ROT.x) * sprintBlend * (1 - a);
    this._poseRot.y += (SPRINT_ROT.y - HIP_ROT.y) * sprintBlend * (1 - a);
    this._poseRot.z += (SPRINT_ROT.z - HIP_ROT.z) * sprintBlend * (1 - a);

    const spd = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.grounded && spd > 0.4 && a < 0.5) {
      this._bob += dt * (player.sprinting ? 14 : 10);
    } else {
      this._bob *= 0.9;
    }
    const motionScale = ctx.session?.settings?.reducedMotion ? 0.25 : 1;
    const bobScale = (1 - a * 0.85) * Math.min(1, spd / 5) * motionScale;
    const bobY = Math.sin(this._bob) * 0.012 * bobScale;
    const bobX = Math.cos(this._bob * 0.5) * 0.008 * bobScale;

    let reloadDip = 0;
    let reloadYaw = 0;
    if (this._reloading) {
      const t = 1 - this._reloadLeft / this.current.reloadTime;
      const wave = Math.sin(t * Math.PI);
      reloadDip = -0.12 * wave;
      reloadYaw = 0.35 * wave;
    }

    let wallLower = 0;
    const physics = ctx.get('physics');
    player.getEyePosition(this._eye);
    player.getLookDir(this._look);
    const wall = physics.raycast(this._eye.x, this._eye.y, this._eye.z, this._look.x, this._look.y, this._look.z, 0.75, LAYER_STATIC);
    if (wall) wallLower = (1 - wall.distance / 0.75) * 0.16;

    // ADS: less kick translation
    const kickScale = (1 - a * 0.55) * motionScale;
    this._gunRoot.position.set(
      this._posePos.x + bobX + this._kickPos.x * kickScale,
      this._posePos.y + bobY + this._kickPos.y * kickScale + reloadDip - wallLower,
      this._posePos.z + this._kickPos.z * kickScale,
    );
    this._gunRoot.rotation.set(
      this._poseRot.x + this._kickRot.x * kickScale,
      this._poseRot.y + this._kickRot.y * kickScale + reloadYaw,
      this._poseRot.z + this._kickRot.z * kickScale,
    );

    // The support hand remains visible through ADS and moves with the magazine.
    if (this._hand) {
      this._hand.visible = true;
      const reloadT = this._reloading ? 1 - this._reloadLeft / this.current.reloadTime : 0;
      const reach = this._reloading ? Math.sin(Math.min(1, reloadT * 1.25) * Math.PI) : 0;
      this._hand.position.y = -0.02 - a * 0.025 - reach * 0.11;
      this._hand.position.z = 0.02 + reach * 0.12;
      this._hand.rotation.x = reach * 0.45;
    }
    if (this._magazine) {
      const reloadT = this._reloading ? 1 - this._reloadLeft / this.current.reloadTime : 0;
      const remove = reloadT < 0.5 ? Math.sin(reloadT * Math.PI) : Math.sin((1 - reloadT) * Math.PI);
      this._magazine.position.copy(this._magazineRest);
      this._magazine.position.y -= Math.max(0, remove) * 0.14;
      this._magazine.position.z += Math.max(0, remove) * 0.06;
      this._magazine.rotation.copy(this._magazineRestRotation);
      this._magazine.rotation.x += Math.max(0, remove) * 0.35;
    }

    // Reticle brightens in ADS (easier to "look through" the optic)
    if (this._reticle) {
      this._reticle.visible = true;
      const scale = 0.85 + a * 0.35;
      this._reticle.scale.setScalar(scale);
      this._reticle.traverse((o) => {
        if (o.isMesh && o.material && o.material.opacity !== undefined) {
          o.material.opacity = 0.55 + a * 0.45;
        }
      });
    }
  }

  _startReload(ctx) {
    if (this._reloading) return;
    this._reloading = true;
    this._reloadLeft = this.current.reloadTime;
    ctx.events.emit('weapon:reload', { weapon: this.current.id, phase: 'start' });
  }

  reset(_payload = {}, ctx) {
    if (this._reloading) ctx?.events.emit('weapon:reload', { weapon: this.current.id, phase: 'cancel' });
    this.current.ammo = this.current.magSize;
    this.current.reserve = 90;
    this.firing = false;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.heat = 0;
    this._cooldown = 0;
    this._reloading = false;
    this._reloadLeft = 0;
    this._reloadHeld = false;
    this._sprintRecovery = 0;
    this.handlingState = 'hip';
    this.ads = 0;
    this._adsPrev = 0;
    this._adsBlend = 0;
    this._kickPos.set(0, 0, 0);
    this._kickRot.set(0, 0, 0);
    this._muzzleLife = 0;
    if (this._muzzleFlash) this._muzzleFlash.visible = false;
    if (ctx?.rng) this._rng = ctx.rng.fork('weapons');
  }

  _fire(ctx, player) {
    const physics = ctx.get('physics');
    const w = this.current;

    player.getEyePosition(this._eye);
    player.getLookDir(this._look);

    const seed = (this._rng.next() * 0x100000000) >>> 0;
    const kickP = w.recoilPitch * (1 + this.heat * 0.4);
    const kickY = w.recoilYaw * (this._rng.float() - 0.5) * 2 * (1 + this.heat * 0.3);
    this.recoilPitch += kickP;
    this.recoilYaw += kickY;
    this.heat = Math.min(1.5, this.heat + 0.12);
    player.pitch += kickP;
    player.yaw += kickY;

    this._kickPos.z += 0.035;
    this._kickPos.y += 0.012;
    this._kickRot.x -= 0.06;
    this._kickRot.y += kickY * 2;
    this._kickRot.z += (this._rng.float() - 0.5) * 0.04;
    this._muzzleLife = 0.04;
    if (this._muzzleFlash) {
      this._muzzleFlash.visible = true;
      this._glowMat.opacity = 0.9;
      this._muzzleFlash.scale.setScalar(1);
    }

    // ADS tightens spread
    const ads = this.ads;
    const spread = w.spread * (1 + this.heat * 1.5) * (1 - ads * 0.75);
    const jx = (this._rng.float() - 0.5) * 2 * spread;
    const jy = (this._rng.float() - 0.5) * 2 * spread;
    computeSpreadDirection(this._look, jx / spread, jy / spread, spread, this._dir);
    const dx = this._dir.x;
    const dy = this._dir.y;
    const dz = this._dir.z;

    const ox = this._eye.x;
    const oy = this._eye.y;
    const oz = this._eye.z;

    this._origin.x = ox;
    this._origin.y = oy;
    this._origin.z = oz;
    this._dir.x = dx;
    this._dir.y = dy;
    this._dir.z = dz;

    ctx.events.emit('weapon:fire', {
      from: 'player',
      weapon: w.id,
      origin: this._origin,
      dir: this._dir,
      seed,
    });

    w.ammo -= 1;

    const hit = physics.raycast(ox, oy, oz, dx, dy, dz, w.range, HIT_MASK, -1);

    this._from.x = ox;
    this._from.y = oy;
    this._from.z = oz;

    if (!hit) {
      this._to.x = ox + dx * w.range;
      this._to.y = oy + dy * w.range;
      this._to.z = oz + dz * w.range;
      ctx.events.emit('bullet:tracer', { from: this._from, to: this._to, speed: 400 });
      return;
    }

    this._to.x = hit.pointX;
    this._to.y = hit.pointY;
    this._to.z = hit.pointZ;
    ctx.events.emit('bullet:tracer', { from: this._from, to: this._to, speed: 400 });

    this._point.x = hit.pointX;
    this._point.y = hit.pointY;
    this._point.z = hit.pointZ;
    this._normal.x = hit.normalX;
    this._normal.y = hit.normalY;
    this._normal.z = hit.normalZ;
    this._incident.x = dx;
    this._incident.y = dy;
    this._incident.z = dz;

    ctx.events.emit('bullet:impact', {
      point: this._point,
      normal: this._normal,
      surface: hit.surface,
      incident: this._incident,
      damage: w.damage,
    });

    const ud = hit.userData;
    if (ud && ud.kind === 'enemy' && ud.actorId) {
      const headshot = !!(ud.headY !== undefined && hit.pointY >= ud.headY);
      const amount = headshot ? w.damage * 1.5 : w.damage;
      ctx.events.emit('damage:dealt', {
        target: ud.actorId,
        amount,
        headshot,
        point: this._point,
        from: 'player',
      });
    }
  }

  dispose() {
    if (this._unsubReset) this._unsubReset();
    if (this._gunRoot) {
      this._gunRoot.parent?.remove(this._gunRoot);
      if (this._usingGltf && this._gun) disposeModelInstance(this._gun);
      this._gunRoot = null;
      this._gun = null;
    }
    for (const l of this._viewLights) l.parent?.remove(l);
    this._viewLights.length = 0;
    for (const g of this._geoms) g.dispose();
    for (const m of this._mats) m.dispose();
  }
}
