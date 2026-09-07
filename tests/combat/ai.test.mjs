import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AiSystem, chooseCoverPoint, headingForForwardMinusZ, shotHitsPlayer } from '../../src/ai/AiSystem.js';
import { PhysicsSystem, LAYER_STATIC } from '../../src/physics/PhysicsSystem.js';

function loadGlbNodeHierarchy(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'expected binary glTF');
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, 'expected JSON chunk first');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/\0+$/, ''));
  const objects = json.nodes.map((node) => {
    const object = new THREE.Group();
    object.name = node.name ?? '';
    if (node.matrix) {
      object.matrix.fromArray(node.matrix);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
    } else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  json.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) objects[index].add(objects[child]);
  });
  const root = new THREE.Group();
  for (const node of json.scenes[json.scene ?? 0].nodes ?? []) root.add(objects[node]);
  return root;
}

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

test('a corpse finishes hit and muzzle cues after a killing shot', () => {
  const ai = new AiSystem();
  const material = { color: new THREE.Color(0.2, 0.3, 0.4) };
  const enemy = {
    id: 'enemy-0', active: true, alive: true, health: 1,
    flashMats: [material], bases: [{ material, r: 0.2, g: 0.3, b: 0.4 }],
    position: new THREE.Vector3(), prevPosition: new THREE.Vector3(),
    group: { visible: true }, collider: 3, coverId: null, moveAmount: 0,
    flash: 0, hitReact: 0, deathTime: 0, corpseTime: 0,
    muzzle: { visible: true }, muzzleLife: 0.04,
  };
  ai.enemies = [enemy];
  const physics = { setEnabled() {} };
  const player = { getEyePosition(out) { Object.assign(out, { x: 0, y: 1.65, z: 0 }); } };
  const ctx = {
    session: { playing: true },
    events: { emit() {} },
    get: (id) => id === 'physics' ? physics : id === 'player' ? player : {},
  };
  ai._applyDamage(ctx, enemy, { amount: 2, from: 'player' });
  assert.equal(material.color.getHex(), 0xffffff);
  ai.fixedUpdate(0.1, ctx);
  assert.equal(enemy.muzzle.visible, false);
  assert.ok(Math.abs(material.color.r - 0.2) < 1e-6);
  assert.ok(Math.abs(material.color.g - 0.3) < 1e-6);
  assert.ok(Math.abs(material.color.b - 0.4) < 1e-6);
  assert.equal(enemy.group.visible, true);
});

test('regaining line of sight cannot bypass an in-progress reload', () => {
  const ai = new AiSystem();
  ai._rng = { next: () => 0.25, float: (min = 0, max = 1) => (min + max) * 0.5, int: (min) => min };
  const enemy = {
    id: 'enemy-0', active: true, alive: true, health: 100,
    position: new THREE.Vector3(0, 0, 10), prevPosition: new THREE.Vector3(0, 0, 10),
    lastKnown: new THREE.Vector3(), hasLastKnown: true, seesPlayer: false, exposedTime: 0,
    group: new THREE.Group(), collider: 2, role: 'holder', state: 'reload', stateTime: 1.5,
    ammo: 0, burstLeft: 0, shotTimer: 0, flash: 0, hitReact: 0,
    muzzle: { visible: false }, muzzleLife: 0, bases: [], phase: 0, moveAmount: 0,
  };
  ai.enemies = [enemy];
  const player = {
    alive: true, position: new THREE.Vector3(0, 0.9, 0), velocity: { x: 0, z: 0 },
    getEyePosition(out) { Object.assign(out, { x: 0, y: 1.65, z: 0 }); return out; },
    getHurtbox() { return { minx: -0.35, miny: 0, minz: -0.35, maxx: 0.35, maxy: 1.8, maxz: 0.35 }; },
  };
  const physics = { raycast: () => null, setBox() {}, raycastBoxDistance: () => 9.65 };
  const firedWithAmmo = [];
  const ctx = {
    session: { playing: true },
    get: (id) => id === 'player' ? player : id === 'physics' ? physics : { coverPoints: [] },
    events: { emit: (type) => { if (type === 'weapon:fire') firedWithAmmo.push(enemy.ammo); } },
  };
  for (let tick = 0; tick < 120; tick++) ai.fixedUpdate(1 / 120, ctx);
  assert.equal(enemy.state, 'reload');
  assert.equal(enemy.ammo, 0);
  assert.deepEqual(firedWithAmmo, []);
  for (let tick = 0; tick < 120 && firedWithAmmo.length === 0; tick++) ai.fixedUpdate(1 / 120, ctx);
  assert.ok(firedWithAmmo[0] > 0, 'first post-reload shot must follow magazine transfer');
});

test('actual exported aimed rig keeps its muzzle on world -Z', (t) => {
  const defaultAsset = fileURLToPath(new URL('../../public/models/enemy.glb', import.meta.url));
  const hierarchy = loadGlbNodeHierarchy(process.env.AOD_ENEMY_GLB ?? defaultAsset);
  const armR = hierarchy.getObjectByName('arm_r');
  const weaponSocket = hierarchy.getObjectByName('weapon_socket');
  const muzzleSocket = hierarchy.getObjectByName('muzzle_socket');
  if (!armR || !weaponSocket || !muzzleSocket) {
    t.skip('branch predates the corrected articulated enemy asset; set AOD_ENEMY_GLB to verify it');
    return;
  }
  const ai = new AiSystem();
  ai.enemies = [{
    active: true, alive: true, group: hierarchy,
    prevPosition: new THREE.Vector3(), position: new THREE.Vector3(),
    moveAmount: 0, phase: 0, state: 'aim', hitReact: 0,
    rig: {
      armL: hierarchy.getObjectByName('arm_l'), armR,
      legL: hierarchy.getObjectByName('leg_l'), legR: hierarchy.getObjectByName('leg_r'),
      head: hierarchy.getObjectByName('head'), weaponSocket,
    },
    weaponSocketRest: weaponSocket.quaternion.clone(),
    weaponSocketCorrection: new THREE.Quaternion(),
  }];
  ai.update(0, { time: { alpha: 1 } });
  hierarchy.updateMatrixWorld(true);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(muzzleSocket.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(direction.dot(new THREE.Vector3(0, 0, -1)) > 0.995, `muzzle direction was ${direction.toArray()}`);
});
