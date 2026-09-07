import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PhysicsSystem, LAYER_STATIC } from '../../src/physics/PhysicsSystem.js';
import { PlayerSystem, PLAYER_DIMENSIONS } from '../../src/player/PlayerSystem.js';

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
