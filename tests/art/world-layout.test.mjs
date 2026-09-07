import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MaterialsSystem } from '../../src/materials/MaterialsSystem.js';
import { PhysicsSystem } from '../../src/physics/PhysicsSystem.js';
import { WorldSystem } from '../../src/world/WorldSystem.js';
import {
  COVER_PROPS,
  isInPlayableRegion,
  WORLD_COVER_POINTS,
  WORLD_ENCOUNTERS,
} from '../../src/world/layout.js';

function fakeMaterialLibrary() {
  const mats = new Map();
  for (const tag of ['asphalt', 'concrete', 'metal', 'plaster']) {
    mats.set(tag, new THREE.MeshStandardMaterial());
  }
  return { get: (tag) => mats.get(tag) || mats.get('concrete') };
}

async function buildWorld() {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        fillText() {},
      }),
    }),
  };
  const physics = new PhysicsSystem();
  await physics.init({});
  const materials = fakeMaterialLibrary();
  const scene = new THREE.Scene();
  const systems = { physics, materials };
  const world = new WorldSystem();
  await world.init({ scene, get: (id) => systems[id] });
  return { world, physics };
}

test('encounter and cover data defines three distinct, playable spaces', () => {
  assert.equal(WORLD_ENCOUNTERS.length, 3);
  assert.deepEqual(WORLD_ENCOUNTERS.map((entry) => entry.id), [
    'south-checkpoint',
    'lantern-court',
    'north-extraction',
  ]);
  assert.equal(new Set(WORLD_COVER_POINTS.map((entry) => entry.id)).size, WORLD_COVER_POINTS.length);
  assert.deepEqual(
    new Set(COVER_PROPS.map((entry) => entry.id)),
    new Set(WORLD_COVER_POINTS.map((entry) => entry.id)),
  );

  for (const encounter of WORLD_ENCOUNTERS) {
    assert.equal(encounter.spawn.y, 0);
    assert.ok(isInPlayableRegion(encounter.spawn.x, encounter.spawn.z), `${encounter.id} spawn`);
    assert.ok(isInPlayableRegion(encounter.exit.x, encounter.exit.z), `${encounter.id} exit`);
    assert.ok(encounter.exit.radius >= 4);
    assert.ok(encounter.enemySpawns.length >= 3);
    for (const enemy of encounter.enemySpawns) {
      assert.ok(isInPlayableRegion(enemy.x, enemy.z), `${encounter.id} enemy ${enemy.x},${enemy.z}`);
      assert.ok(['holder', 'advancer', 'flanker'].includes(enemy.role));
    }
  }
});

test('all mission anchors are physically clear and connected by nav', async () => {
  const { world, physics } = await buildWorld();
  const path = new Int32Array(2048);
  const anchors = [];
  for (const encounter of world.encounters) {
    anchors.push(encounter.spawn, encounter.exit, ...encounter.enemySpawns);
  }
  anchors.push(...world.coverPoints);

  for (const anchor of anchors) {
    assert.equal(
      physics.pointBlocked(anchor.x, 0.9, anchor.z, 1),
      false,
      `anchor intersects collider at ${anchor.x},${anchor.z}`,
    );
    assert.equal(world.isWalkable(anchor.x, anchor.z), true, `anchor is off nav at ${anchor.x},${anchor.z}`);
  }

  for (const encounter of world.encounters) {
    assert.ok(
      world.findPath(encounter.spawn.x, encounter.spawn.z, encounter.exit.x, encounter.exit.z, path) > 1,
      `${encounter.id} spawn-to-exit path`,
    );
    for (const enemy of encounter.enemySpawns) {
      assert.ok(
        world.findPath(enemy.x, enemy.z, encounter.exit.x, encounter.exit.z, path) > 0,
        `${encounter.id} enemy route ${enemy.x},${enemy.z}`,
      );
    }
  }

  assert.ok(world.findPath(3, 13, 3, -13, path) > 1, 'direct road route');
  assert.ok(world.findPath(-12, 13, -12, -13, path) > 1, 'courtyard flank route');
  world.dispose();
});

test('material system retains non-mirror wet asphalt tuning', () => {
  const source = MaterialsSystem.prototype.init.toString();
  assert.match(source, /roughBase:\s*0\.72/);
  assert.match(source, /normalScale:\s*0\.72/);
});
