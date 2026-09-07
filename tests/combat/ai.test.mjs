import assert from 'node:assert/strict';
import test from 'node:test';
import { AiSystem, chooseCoverPoint, shotHitsPlayer } from '../../src/ai/AiSystem.js';
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
