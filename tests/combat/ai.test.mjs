import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { AiSystem, chooseCoverPoint, headingForForwardMinusZ, shotHitsPlayer } from '../../src/ai/AiSystem.js';
import { PhysicsSystem, LAYER_STATIC } from '../../src/physics/PhysicsSystem.js';

test('cover reservations are exclusive and flankers prefer lateral anchors', () => {
  const points = [
    { id: 'front', x: 0, z: 8, height: 1 },
    { id: 'left', x: -7, z: 7, height: 1 },
    { id: 'right', x: 7, z: 7, height: 1 },
  ];
  const reserved = new Map([['left', 'enemy-0']]);
  const flank = chooseCoverPoint(points, reserved, { x: 0, z: 14 }, { x: 0, z: 0 }, 'flanker');
  assert.equal(flank.id, 'right');
  reserved.set('right', 'enemy-1');
  assert.equal(chooseCoverPoint(points, reserved, { x: 0, z: 14 }, { x: 0, z: 0 }, 'holder').id, 'front');
});

test('enemy shots hit the live player box and solid cover blocks them', async () => {
  const physics = new PhysicsSystem();
  await physics.init({});
  const player = {
    getHurtbox: () => ({ minx: -0.35, miny: 0, minz: -0.35, maxx: 0.35, maxy: 1.8, maxz: 0.35 }),
  };
  const origin = { x: 0, y: 1.45, z: 10 };
  const dir = { x: 0, y: 0, z: -1 };
  const clear = shotHitsPlayer(physics, player, origin, dir);
  assert.ok(clear);
  assert.ok(clear.point.z > 0.3 && clear.point.z < 0.4);
  physics.addBox({ minx: -1, miny: 0, minz: 4, maxx: 1, maxy: 2, maxz: 5, layers: LAYER_STATIC });
  assert.equal(shotHitsPlayer(physics, player, origin, dir), null);
});

test('enemy damage resolves without mutating the request and keeps a visible corpse', () => {
  const ai = new AiSystem();
  const enemy = {
    id: 'enemy-0', alive: true, health: 20, flashMats: [], bases: [],
    position: { x: 1, y: 0, z: 2 }, state: 'aim', group: { visible: true },
    collider: 4, coverId: null, moveAmount: 1,
  };
  const emitted = [];
  const ctx = {
    events: { emit: (type, payload) => emitted.push({ type, payload }) },
    get: () => ({ setEnabled: () => {} }),
  };
  const request = Object.freeze({ target: enemy.id, from: 'player', amount: 28, headshot: false });
  ai._applyDamage(ctx, enemy, request);
  assert.equal(request.killed, undefined);
  assert.equal(enemy.alive, false);
  assert.equal(enemy.group.visible, true);
  assert.equal(emitted.find((event) => event.type === 'combat:hit').payload.killed, true);
});

test('heading rotates an authored -Z forward axis toward its target', () => {
  for (const target of [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: -0.4, z: 0.8 }]) {
    const yaw = headingForForwardMinusZ(target.x, target.z);
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const length = Math.hypot(target.x, target.z);
    assert.ok(Math.abs(forward.x - target.x / length) < 1e-10);
    assert.ok(Math.abs(forward.z - target.z / length) < 1e-10);
  }
});

test('AI displacement and stuck recovery cannot cross static geometry', async () => {
  const physics = new PhysicsSystem();
  await physics.init({});
  physics.addBox({ minx: 0.5, miny: 0, minz: -2, maxx: 0.7, maxy: 2, maxz: 2, layers: LAYER_STATIC });
  const ai = new AiSystem();
  const enemy = { position: { x: 0, z: 0 } };
  ai._moveThroughWorld(enemy, physics, 2, 0, 1 / 120);
  assert.ok(enemy.position.x <= 0.101, `enemy crossed wall to ${enemy.position.x}`);
});

test('cover selection uses last-known position after sight is lost', () => {
  const ai = new AiSystem();
  ai._rng = { float: () => 0 };
  const enemy = {
    id: 'enemy-0', state: 'search', seesPlayer: false, hasLastKnown: true,
    position: { x: 0, z: 20 }, lastKnown: { x: 0, z: 0 }, role: 'holder', coverId: null,
  };
  const world = { coverPoints: [{ id: 'known-cover', x: 0, z: 8, height: 1 }] };
  ai._enterMove(enemy, world, { position: { x: 100, z: 100 } });
  assert.equal(enemy.coverId, 'known-cover');
  assert.equal(enemy.goalZ, 8);
});

test('miss tracers stop and impact at the first static cover hit', async () => {
  const physics = new PhysicsSystem();
  await physics.init({});
  physics.addBox({ minx: -1, miny: 0, minz: 4, maxx: 1, maxy: 2, maxz: 5, layers: LAYER_STATIC, surface: 'concrete' });
  const events = [];
  const player = {
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, z: 0 },
    getEyePosition(out) { Object.assign(out, { x: 0, y: 1.45, z: 0 }); return out; },
    getHurtbox() { return { minx: -0.35, miny: 0, minz: -0.35, maxx: 0.35, maxy: 1.8, maxz: 0.35 }; },
  };
  const ai = new AiSystem();
  ai._rng = { next: () => 0.25, float: (min = 0, max = 1) => (min + max) * 0.5 };
  const enemy = { id: 'enemy-0', position: { x: 0, z: 10 }, exposedTime: 4, muzzle: { visible: false }, muzzleLife: 0 };
  const ctx = {
    get: (id) => id === 'player' ? player : physics,
    events: { emit: (type, payload) => events.push({ type, payload }) },
  };
  ai._fire(ctx, enemy, 10);
  const tracer = events.find((event) => event.type === 'bullet:tracer').payload;
  assert.ok(Math.abs(tracer.to.z - 5) < 1e-6);
  assert.equal(events.filter((event) => event.type === 'bullet:impact').length, 1);
  assert.equal(events.filter((event) => event.type === 'damage:dealt').length, 0);
});

test('reload state has a distinct visible support-arm pose', () => {
  const ai = new AiSystem();
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  ai.enemies = [{
    active: true, alive: true, group: new THREE.Group(),
    prevPosition: new THREE.Vector3(), position: new THREE.Vector3(),
    moveAmount: 0, phase: 0, state: 'reload', hitReact: 0,
    rig: { armL, armR, legL: null, legR: null, head: null },
  }];
  ai.update(0, { time: { alpha: 1 } });
  assert.ok(armL.rotation.z < -0.7);
  assert.ok(armR.rotation.x > 0.8);
});
