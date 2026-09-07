import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import {
  ENEMY_ARTICULATION_GROUPS,
  resolveEnemyRig,
} from '../../src/assets/gltf.js';

async function readGlbJson(path) {
  const bytes = await readFile(new URL(path, import.meta.url));
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('utf8', 16, 20), 'JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
}

function nodeIndex(json, name) {
  return json.nodes.findIndex((node) => node.name === name);
}

function isDescendant(json, ancestorName, childName) {
  const ancestor = nodeIndex(json, ancestorName);
  const child = nodeIndex(json, childName);
  if (ancestor < 0 || child < 0) return false;
  const pending = [...(json.nodes[ancestor].children || [])];
  while (pending.length) {
    const index = pending.pop();
    if (index === child) return true;
    pending.push(...(json.nodes[index].children || []));
  }
  return false;
}

test('enemy GLB contains the direct-pivot and attachment hierarchy', async () => {
  const json = await readGlbJson('../../public/models/enemy.glb');
  assert.ok(nodeIndex(json, 'enemy_rig') >= 0);
  for (const joint of ENEMY_ARTICULATION_GROUPS) {
    assert.ok(nodeIndex(json, joint) >= 0, `missing ${joint}`);
    assert.ok(isDescendant(json, 'enemy_rig', joint), `${joint} is outside enemy_rig`);
  }
  assert.ok(isDescendant(json, 'arm_r', 'weapon_socket'));
  assert.ok(isDescendant(json, 'weapon_socket', 'muzzle_socket'));

  const vertexCount = (json.meshes || []).reduce(
    (sum, mesh) => sum + mesh.primitives.reduce(
      (meshSum, primitive) => meshSum + json.accessors[primitive.attributes.POSITION].count,
      0,
    ),
    0,
  );
  assert.ok(vertexCount > 2_000, `enemy detail unexpectedly low: ${vertexCount}`);
  assert.ok(vertexCount < 80_000, `enemy geometry budget exceeded: ${vertexCount}`);
});

test('hero GLBs stay present and within the asset budget', async () => {
  for (const name of ['rifle', 'enemy', 'dumpster', 'car']) {
    const info = await stat(new URL(`../../public/models/${name}.glb`, import.meta.url));
    assert.ok(info.size > 50_000, `${name} appears to be a placeholder`);
    assert.ok(info.size < 2_000_000, `${name} exceeds 2 MB`);
  }
});

test('rifle GLB leaves the runtime holo unobstructed and exposes reload parts', async () => {
  const json = await readGlbJson('../../public/models/rifle.glb');
  assert.ok(nodeIndex(json, 'rifle') >= 0);
  assert.ok(isDescendant(json, 'rifle', 'magazine'));
  assert.ok(isDescendant(json, 'rifle', 'muzzle_socket'));
  assert.equal(nodeIndex(json, 'optic'), -1, 'obsolete baked cylindrical optic returned');
  assert.equal(nodeIndex(json, 'optic_mount'), -1, 'obsolete optic mount returned');
});

test('runtime rig resolver degrades missing nodes to null', () => {
  const nodes = new Map([
    ['enemy_rig', { name: 'enemy_rig' }],
    ['arm_l', { name: 'arm_l' }],
  ]);
  const rig = resolveEnemyRig({
    getObjectByName: (name) => nodes.get(name) || null,
  });
  assert.equal(rig.root.name, 'enemy_rig');
  assert.equal(rig.joints.arm_l.name, 'arm_l');
  assert.equal(rig.joints.arm_r, null);
  assert.equal(rig.weaponSocket, null);
});
