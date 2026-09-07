import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PhysicsSystem, LAYER_STATIC } from '../../src/physics/PhysicsSystem.js';
import { PlayerSystem, PLAYER_DIMENSIONS } from '../../src/player/PlayerSystem.js';
import { WORLD_BOUNDARY } from '../../src/world/layout.js';

async function physicsWithFloor() {
  const physics = new PhysicsSystem();
  await physics.init({});
  physics.addBox({ minx: -10, miny: -0.2, minz: -10, maxx: 10, maxy: 0, maxz: 10, layers: LAYER_STATIC });
  return physics;
}

test('crouch clearance allows crouching but rejects standing into a ceiling', async () => {
  const physics = await physicsWithFloor();
  physics.addBox({ minx: -1, miny: 1.28, minz: -1, maxx: 1, maxy: 1.5, maxz: 1, layers: LAYER_STATIC });
  const radius = PLAYER_DIMENSIONS.radius;
  const crouchY = PLAYER_DIMENSIONS.crouchHeight * 0.5;
  const standY = PLAYER_DIMENSIONS.standHeight * 0.5;
  assert.equal(physics.capsuleBlocked(0, crouchY, 0, radius, crouchY - radius, LAYER_STATIC), false);
  assert.equal(physics.capsuleBlocked(0, standY, 0, radius, standY - radius, LAYER_STATIC), true);
});

test('capsule movement lands on the floor without penetrating it', async () => {
  const physics = await physicsWithFloor();
  let y = 2.4;
  let velocity = 0;
  let landed = false;
  const halfHeight = PLAYER_DIMENSIONS.standHeight * 0.5 - PLAYER_DIMENSIONS.radius;
  for (let i = 0; i < 180; i++) {
    velocity -= 18 / 120;
    const out = physics.moveCapsule(0, y, 0, PLAYER_DIMENSIONS.radius, halfHeight, 0, velocity / 120, 0, 1 / 120);
    y = out.y;
    if (out.grounded) { landed = true; break; }
  }
  assert.equal(landed, true);
  assert.ok(Math.abs(y - PLAYER_DIMENSIONS.standHeight * 0.5) < 0.03, `landed at ${y}`);
});

test('damage requests are immutable and results identify the player target', () => {
  const player = new PlayerSystem();
  player.position.set(0, 0.9, 0);
  const emitted = [];
  const ctx = { events: { emit: (type, payload) => emitted.push({ type, payload }) } };
  const request = Object.freeze({ target: 'player', from: 'enemy-2', amount: 25, headshot: false });
  player._onDamage(ctx, request);
  assert.equal(player.health, 75);
  assert.equal(request.killed, undefined);
  const taken = emitted.find((event) => event.type === 'damage:taken').payload;
  const hit = emitted.find((event) => event.type === 'combat:hit').payload;
  assert.equal(taken.target, 'player');
  assert.equal(taken.from, 'enemy-2');
  assert.equal(hit.killed, false);
});

test('the player hurtbox tracks crouched dimensions', () => {
  const player = new PlayerSystem();
  player.capsuleHeight = PLAYER_DIMENSIONS.crouchHeight;
  player.stance = 'crouch';
  player.position.set(2, PLAYER_DIMENSIONS.crouchHeight * 0.5, -3);
  const box = player.getHurtbox();
  assert.equal(box.miny, 0);
  assert.equal(box.maxy, PLAYER_DIMENSIONS.crouchHeight);
  assert.equal(box.minx, 2 - PLAYER_DIMENSIONS.radius);
  assert.equal(player.getEyePosition(new THREE.Vector3()).y, PLAYER_DIMENSIONS.crouchEye);
});

test('vault sweep rejects overhead geometry along an otherwise valid route', async () => {
  const makePlayer = () => {
    const player = new PlayerSystem();
    player.position.set(0, PLAYER_DIMENSIONS.standHeight * 0.5, 0);
    player.prevPosition.copy(player.position);
    player._forward.set(0, 0, -1);
    return player;
  };
  const addObstacle = (physics) => physics.addBox({
    minx: -0.5, miny: 0, minz: -0.8, maxx: 0.5, maxy: 0.72, maxz: -0.4, layers: LAYER_STATIC,
  });
  const clearPhysics = await physicsWithFloor();
  addObstacle(clearPhysics);
  assert.equal(makePlayer()._tryStartVault({ events: { emit() {} } }, clearPhysics), true);

  const blockedPhysics = await physicsWithFloor();
  addObstacle(blockedPhysics);
  blockedPhysics.addBox({
    minx: -0.6, miny: 1.45, minz: -1.25, maxx: 0.6, maxy: 2.2, maxz: -0.05, layers: LAYER_STATIC,
  });
  assert.equal(makePlayer()._tryStartVault({ events: { emit() {} } }, blockedPhysics), false);
});

test('vault eye and reported hurtbox stay inside the swept tucked bounds', () => {
  const player = new PlayerSystem();
  player.vaulting = true;
  player._vaultStart.set(0, 0.9, 0);
  player._vaultEnd.set(0, 0.9, -1.4);
  for (let i = 0; i <= 12; i++) {
    player._sampleVault(i / 12, player.position);
    const box = player.getHurtbox();
    const eye = player.getEyePosition(new THREE.Vector3());
    assert.ok(Math.abs((box.maxy - box.miny) - 1.2) < 1e-9);
    assert.ok(eye.y > box.miny && eye.y < box.maxy, `eye ${eye.y} escaped ${box.miny}..${box.maxy}`);
  }
});

test('perimeter height rejects vaulting and contains a full running jump', async () => {
  const physics = await physicsWithFloor();
  physics.addBox({
    minx: -10,
    miny: 0,
    minz: -2,
    maxx: 10,
    maxy: WORLD_BOUNDARY.height,
    maxz: -1.2,
    layers: LAYER_STATIC,
  });
  const player = new PlayerSystem();
  player.position.set(0, PLAYER_DIMENSIONS.standHeight * 0.5, -0.6);
  player.prevPosition.copy(player.position);
  player.grounded = true;
  player._forward.set(0, 0, -1);
  assert.equal(player._tryStartVault({ events: { emit() {} } }, physics), false);

  const ctx = {
    input: {
      keys: { KeyW: true, Space: true },
      buttons: {},
      mouse: { locked: true },
      look: { dx: 0, dy: 0 },
    },
    events: { emit() {} },
    session: { playing: true, retry: () => assert.fail('contained jump triggered recovery') },
    get: (id) => id === 'physics'
      ? physics
      : { room: { minx: -10, maxx: 10, minz: -10, maxz: 10, floorY: 0 } },
  };
  let closest = Infinity;
  for (let i = 0; i < 180; i++) {
    player.fixedUpdate(1 / 120, ctx);
    closest = Math.min(closest, player.position.z);
  }
  assert.ok(closest >= -1.2 + PLAYER_DIMENSIONS.radius - 1e-5, `jump crossed wall at z=${closest}`);
  assert.equal(player.grounded, true);
});

test('falling below or leaving the lot retries the current checkpoint', () => {
  const room = { minx: -60, maxx: 60, minz: -60, maxz: 60, floorY: 0 };
  const escapes = [
    [0, -5.01, 0],
    [-60.01, 0.9, 0],
    [60.01, 0.9, 0],
    [0, 0.9, -60.01],
    [0, 0.9, 60.01],
  ];
  for (const [x, y, z] of escapes) {
    const player = new PlayerSystem();
    player.position.set(x, y, z);
    let retries = 0;
    player.fixedUpdate(1 / 120, {
      session: { playing: true, retry: () => { retries += 1; } },
      get: (id) => {
        assert.equal(id, 'world');
        return { room };
      },
    });
    assert.equal(retries, 1, `escape at ${x},${y},${z} did not restore checkpoint`);
  }
});

test('explicit pause clears input and exits pointer lock', () => {
  const player = new PlayerSystem();
  const canvas = {};
  let resets = 0;
  let pauses = 0;
  let exits = 0;
  const previousDocument = globalThis.document;
  globalThis.document = { pointerLockElement: canvas, exitPointerLock: () => { exits += 1; } };
  try {
    player._pauseControl({
      input: { reset: () => { resets += 1; } },
      session: { pause: () => { pauses += 1; } },
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.equal(resets, 1);
  assert.equal(pauses, 1);
  assert.equal(exits, 1);
});

test('menu Space keeps its native behavior until gameplay is active', () => {
  const player = new PlayerSystem();
  const listeners = {};
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    removeEventListener() {},
  };
  globalThis.document = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    removeEventListener() {},
    pointerLockElement: null,
  };
  const session = { playing: false, pause() {} };
  const input = {
    keys: {}, buttons: {}, mouse: { locked: false, dx: 0, dy: 0 }, look: { dx: 0, dy: 0 },
    active: false, reset() {},
  };
  const canvas = { addEventListener() {}, removeEventListener() {} };
  try {
    player._bindInput({ input, canvas, session });
    let prevented = 0;
    listeners.keydown({ code: 'Space', preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 0);
    assert.equal(input.keys.Space, undefined);
    session.playing = true;
    listeners.keydown({ code: 'Space', preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 1);
    assert.equal(input.keys.Space, true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
