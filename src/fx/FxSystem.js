import * as THREE from 'three';

/**
 * Impacts, decals, tracers, muzzle flash, camera shake.
 * Preallocated pools — zero per-frame alloc.
 *
 * Listens: weapon:fire, bullet:impact, bullet:tracer, player:land, actor:death
 */

const MAX_DECALS = 48;
const MAX_PARTICLES = 64;
const MAX_TRACERS = 16;

export class FxSystem {
  static id = 'fx';
  static deps = ['player'];

  constructor() {
    this._root = null;
    this._geoms = [];
    this._mats = [];
    this._unsubs = [];

    // Decals
    this._decalMesh = null;
    this._decalLife = new Float32Array(MAX_DECALS);
    this._decalCursor = 0;

    // Particles (points)
    this._particlePos = null;
    this._particleVel = null;
    this._particleLife = new Float32Array(MAX_PARTICLES);
    this._particleMax = new Float32Array(MAX_PARTICLES);
    this._pCursor = 0;
    this._points = null;

    // Tracers
    this._tracers = [];
    this._tracerMat = null;

    // Muzzle
    this._muzzle = null;
    this._muzzleLife = 0;

    // Shake
    this.shake = 0;
    this._shakeV = { x: 0, y: 0, z: 0 };

    this._tmp = new THREE.Vector3();
    this._tmpN = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._yAxis = new THREE.Vector3(0, 1, 0);
  }

  async init(ctx) {
    this._root = new THREE.Group();
    this._root.name = 'fx';
    ctx.scene.add(this._root);

    // Impact marks: small dark discs (not full planes — avoids camera-facing cards)
    const decalGeom = new THREE.CircleGeometry(0.09, 10);
    this._geoms.push(decalGeom);

    this._decals = [];
    for (let i = 0; i < MAX_DECALS; i++) {
      const decalMat = new THREE.MeshBasicMaterial({
        color: 0x050505,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      });
      this._mats.push(decalMat);
      const m = new THREE.Mesh(decalGeom, decalMat);
      m.visible = false;
      m.renderOrder = 2;
      this._root.add(m);
      this._decals.push(m);
      this._decalLife[i] = 0;
    }

    // Particles
    const pGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeom.setDrawRange(0, 0);
    this._geoms.push(pGeom);
    this._particlePos = positions;
    this._particleVel = new Float32Array(MAX_PARTICLES * 3);

    const pMat = new THREE.PointsMaterial({
      color: 0xffcc88,
      size: 0.05,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    this._mats.push(pMat);
    this._points = new THREE.Points(pGeom, pMat);
    this._points.frustumCulled = false;
    this._points.renderOrder = 4;
    // Hide until first burst — avoids a zero-point cloud at origin.
    this._points.visible = false;
    this._root.add(this._points);

    // Tracer lines
    this._tracerMat = new THREE.LineBasicMaterial({
      color: 0xffe0a0,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this._mats.push(this._tracerMat);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array(6);
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      this._geoms.push(g);
      const line = new THREE.Line(g, this._tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      this._root.add(line);
      this._tracers.push({ line, life: 0, arr });
    }

    // Muzzle flash — small additive billboard
    const muzzleGeom = new THREE.PlaneGeometry(0.12, 0.12);
    this._geoms.push(muzzleGeom);
    const muzzleMat = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._mats.push(muzzleMat);
    this._muzzle = new THREE.Mesh(muzzleGeom, muzzleMat);
    this._muzzle.visible = false;
    this._muzzle.frustumCulled = false;
    this._muzzle.renderOrder = 3;
    this._root.add(this._muzzle);

    this._unsubs.push(
      ctx.events.on('weapon:fire', (p) => this._onFire(ctx, p)),
      ctx.events.on('bullet:impact', (p) => this._onImpact(ctx, p)),
      ctx.events.on('bullet:tracer', (p) => this._onTracer(p)),
      ctx.events.on('player:land', (p) => {
        this.shake = Math.min(0.4, this.shake + Math.min(0.25, Math.abs(p?.velocity || 0) * 0.02));
      }),
      ctx.events.on('actor:death', (p) => {
        if (p?.point) this._burst(p.point.x, p.point.y, p.point.z, 0xff4422, 14);
        this.shake = Math.min(0.5, this.shake + 0.15);
      }),
    );
  }

  _onFire(ctx, p) {
    this.shake = Math.min(0.55, this.shake + 0.08);
    if (!p?.origin || !p?.dir) return;
    // Particles + shake only (no world-space muzzle plane — fights the wet specular).
    const col = p.weapon === 'enemy-smg' ? 0xff8844 : 0xffaa44;
    const n = p.weapon === 'enemy-smg' ? 2 : 4;
    this._burst(
      p.origin.x + (p.dir?.x || 0) * 0.4,
      p.origin.y + (p.dir?.y || 0) * 0.4,
      p.origin.z + (p.dir?.z || 0) * 0.4,
      col,
      n,
    );
  }

  _onImpact(ctx, p) {
    if (!p?.point || !p?.normal) return;
    const { point, normal, surface } = p;
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return;
    }
    // Particle bursts only — projected discs were reading as large floating cards
    // under wet-specular lighting. Decal pool kept for a later contact-shadow pass.
    const color = surface === 'flesh' ? 0xaa2222 : surface === 'metal' ? 0xccccaa : 0x888870;
    this._burst(point.x, point.y, point.z, color, surface === 'flesh' ? 12 : 5);
    if (surface === 'flesh') {
      this.shake = Math.min(0.5, this.shake + 0.05);
    }
  }

  _onTracer(p) {
    if (!p?.from || !p?.to) return;
    let t = null;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this._tracers[i].life <= 0) {
        t = this._tracers[i];
        break;
      }
    }
    if (!t) t = this._tracers[0];
    const a = t.arr;
    a[0] = p.from.x;
    a[1] = p.from.y;
    a[2] = p.from.z;
    a[3] = p.to.x;
    a[4] = p.to.y;
    a[5] = p.to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.06;
  }

  _spawnDecal(point, normal, surface) {
    const i = this._decalCursor;
    this._decalCursor = (this._decalCursor + 1) % MAX_DECALS;
    const m = this._decals[i];
    this._tmpN.set(normal.x, normal.y, normal.z);
    if (this._tmpN.lengthSq() < 1e-8) this._tmpN.set(0, 1, 0);
    else this._tmpN.normalize();

    m.position.set(
      point.x + this._tmpN.x * 0.015,
      point.y + this._tmpN.y * 0.015,
      point.z + this._tmpN.z * 0.015,
    );
    // PlaneGeometry faces +Z; orient so +Z aligns with surface normal.
    m.lookAt(
      m.position.x + this._tmpN.x,
      m.position.y + this._tmpN.y,
      m.position.z + this._tmpN.z,
    );
    const scale = 0.7 + (i % 5) * 0.08;
    m.scale.setScalar(scale);
    m.material.color.setHex(surface === 'metal' ? 0x222018 : 0x050505);
    m.material.opacity = 0.75;
    m.visible = true;
    this._decalLife[i] = 14;
  }

  _burst(x, y, z, color, count) {
    this._points.visible = true;
    this._points.material.color.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this._pCursor;
      this._pCursor = (this._pCursor + 1) % MAX_PARTICLES;
      const o = i * 3;
      this._particlePos[o] = x;
      this._particlePos[o + 1] = y;
      this._particlePos[o + 2] = z;
      const a = (i * 1.618 + n) * 6.28;
      const elev = ((i * 0.37) % 1) * 1.2 - 0.1;
      const sp = 1.5 + (i % 5) * 0.4;
      this._particleVel[o] = Math.cos(a) * sp;
      this._particleVel[o + 1] = Math.abs(Math.sin(elev)) * sp + 1;
      this._particleVel[o + 2] = Math.sin(a) * sp;
      this._particleLife[i] = 0.28 + (i % 4) * 0.04;
      this._particleMax[i] = this._particleLife[i];
    }
    this._points.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, ctx) {
    // Decals fade
    for (let i = 0; i < MAX_DECALS; i++) {
      if (this._decalLife[i] > 0) {
        this._decalLife[i] -= dt;
        if (this._decalLife[i] <= 0) this._decals[i].visible = false;
      }
    }

    // Particles — pack live ones into front of buffer for drawRange
    let alive = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this._particleLife[i] <= 0) continue;
      this._particleLife[i] -= dt;
      if (this._particleLife[i] <= 0) {
        this._particleLife[i] = 0;
        continue;
      }
      const o = i * 3;
      this._particleVel[o + 1] -= 9 * dt;
      this._particlePos[o] += this._particleVel[o] * dt;
      this._particlePos[o + 1] += this._particleVel[o + 1] * dt;
      this._particlePos[o + 2] += this._particleVel[o + 2] * dt;
      alive += 1;
    }
    this._points.geometry.attributes.position.needsUpdate = true;
    this._points.visible = alive > 0;
    this._points.material.opacity = alive > 0 ? 0.9 : 0;

    // Tracers
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this._tracers[i];
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
    }

    // Muzzle
    if (this._muzzleLife > 0) {
      this._muzzleLife -= dt;
      this._muzzle.material.opacity = Math.max(0, this._muzzleLife / 0.04);
      if (this._muzzleLife <= 0) this._muzzle.visible = false;
    }

    // Camera shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake;
      const t = ctx.time.elapsed * 40;
      const cam = ctx.camera;
      cam.position.x += Math.sin(t * 1.7) * s * 0.03;
      cam.position.y += Math.cos(t * 2.1) * s * 0.025;
      cam.position.z += Math.sin(t * 1.3) * s * 0.02;
    }
  }

  dispose() {
    for (const u of this._unsubs) u();
    this._unsubs.length = 0;
    if (this._root) this._root.parent?.remove(this._root);
    for (const g of this._geoms) g.dispose();
    for (const m of this._mats) m.dispose();
  }
}
