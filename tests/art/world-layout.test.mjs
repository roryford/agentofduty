import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MaterialsSystem } from '../../src/materials/MaterialsSystem.js';
import { PhysicsSystem } from '../../src/physics/PhysicsSystem.js';
import { WorldSystem } from '../../src/world/WorldSystem.js';
import {
  COVER_PROPS,
  isInPlayableRegion,
  WORLD_BOUNDARY,
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

test('continuous perimeter blocks low and airborne escapes at every lot edge', async () => {
  const { world, physics } = await buildWorld();
  const { minx, maxx, minz, maxz } = world.room;
  const inner = WORLD_BOUNDARY.thickness;
  const colliders = world._boundaryColliderIds.map((id) => physics.getCollider(id));
  assert.equal(colliders.length, 4);
  assert.ok(colliders.every((collider) => collider.userData.kind === 'perimeter'));
  assert.ok(colliders.every((collider) => Math.abs(collider.maxy - WORLD_BOUNDARY.height) < 1e-5));

  for (let axis = minx; axis <= maxx; axis += 2) {
    for (const y of [0.45, 1.28, 3.45]) {
      assert.equal(physics.pointBlocked(axis, y, minz + inner * 0.5), true, `north gap at ${axis},${y}`);
      assert.equal(physics.pointBlocked(axis, y, maxz - inner * 0.5), true, `south gap at ${axis},${y}`);
      assert.equal(physics.pointBlocked(minx + inner * 0.5, y, axis), true, `west gap at ${axis},${y}`);
      assert.equal(physics.pointBlocked(maxx - inner * 0.5, y, axis), true, `east gap at ${axis},${y}`);
    }
  }

  const visuals = [];
  for (const root of world._roots) {
    root.traverse((object) => {
      if (object.name.startsWith('perimeter-base-')) visuals.push(object.name);
    });
  }
  assert.deepEqual(new Set(visuals), new Set([
    'perimeter-base-west',
    'perimeter-base-east',
    'perimeter-base-north',
    'perimeter-base-south',
  ]));
  const posts = world._roots[0].getObjectByName('perimeter-posts');
  assert.ok(posts?.isInstancedMesh && posts.count >= 100, 'perimeter fence posts are not continuously visible');

  const traverse = (startX, startZ, dx, dz, height = 0.9) => {
    let x = startX;
    let z = startZ;
    for (let i = 0; i < 50; i++) {
      const result = physics.moveCapsule(x, height, z, 0.35, height - 0.35, dx, 0, dz, 1 / 120);
      x = result.x;
      z = result.z;
    }
    return { x, z };
  };
  const limit = maxx - WORLD_BOUNDARY.thickness - 0.35;
  const rear = traverse(0, limit - 0.5, 0, 0.12);
  const side = traverse(limit - 0.5, 0, 0.12, 0);
  const corners = [
    traverse(limit - 0.5, limit - 0.5, 0.12, 0.12),
    traverse(-limit + 0.5, limit - 0.5, -0.12, 0.12),
    traverse(limit - 0.5, -limit + 0.5, 0.12, -0.12),
    traverse(-limit + 0.5, -limit + 0.5, -0.12, -0.12),
  ];
  const low = traverse(-limit + 0.5, 0, -0.12, 0, 0.625);
  assert.ok(rear.z <= limit + 1e-5, `rear escape reached z=${rear.z}`);
  assert.ok(side.x <= limit + 1e-5, `side escape reached x=${side.x}`);
  for (const corner of corners) {
    assert.ok(
      Math.abs(corner.x) <= limit + 1e-5 && Math.abs(corner.z) <= limit + 1e-5,
      `corner escape reached ${corner.x},${corner.z}`,
    );
  }
  assert.ok(low.x >= -limit - 1e-5, `crouched escape reached x=${low.x}`);
  world.dispose();
});

test('facade glass clears the solid frame along each wall normal', async () => {
  const { world } = await buildWorld();
  let frameBatch = null;
  const glassBatches = [];
  for (const root of world._roots) {
    root.traverse((object) => {
      if (object.name === 'window-frames-batch') frameBatch = object;
      if (object.name.startsWith('window-glass-batch-')) glassBatches.push(object);
    });
  }
  assert.ok(frameBatch?.isInstancedMesh);
  assert.ok(frameBatch.count >= 100, `expected authored window set, got ${frameBatch?.count}`);
  assert.ok(glassBatches.length <= 3, `window glass uses ${glassBatches.length} draw batches`);
  const placementCount = glassBatches.reduce((sum, batch) => sum + batch.count, 0);
  assert.equal(placementCount, frameBatch.count);

  const matrix = new THREE.Matrix4();
  const normals = new Set();
  for (const glass of glassBatches) {
    const frameHalfDepth = frameBatch.geometry.parameters.width * 0.5;
    const glassHalfDepth = glass.geometry.parameters.width * 0.5;
    for (let i = 0; i < glass.count; i++) {
      const placement = glass.userData.placements[i];
      normals.add(placement.normalX);
      glass.getMatrixAt(i, matrix);
      assert.ok(Math.abs(matrix.elements[12] - placement.glassX) < 1e-5);
      const outwardDistance = (placement.glassX - placement.frameX) * placement.normalX;
      assert.ok(
        outwardDistance >= frameHalfDepth + glassHalfDepth,
        `glass remains inside frame: ${outwardDistance} < ${frameHalfDepth + glassHalfDepth}`,
      );
    }
  }
  assert.deepEqual(normals, new Set([-1, 1]));
  world.dispose();
});

test('material system retains non-mirror wet asphalt tuning', () => {
  const source = MaterialsSystem.prototype.init.toString();
  assert.match(source, /roughBase:\s*0\.72/);
  assert.match(source, /normalScale:\s*0\.72/);
});
