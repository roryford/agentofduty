import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  AIM_RETICLE_DEPTH,
  WeaponsSystem,
  computeSpreadDirection,
  createAimReticleAnchor,
} from '../../src/weapons/WeaponsSystem.js';

function readGlbJson(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.toString('ascii', 16, 20);
  assert.equal(jsonType, 'JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/u, '').trim());
}

function projectedNdc(camera, object) {
  camera.updateMatrixWorld(true);
  return object.getWorldPosition(new THREE.Vector3()).project(camera);
}

test('shipped rifle has one runtime optic contract and an explicit muzzle socket', () => {
  const gltf = readGlbJson(new URL('../../public/models/rifle.glb', import.meta.url));
  const names = gltf.nodes.map((node) => node.name ?? '');
  assert.ok(names.includes('muzzle_socket'));
  assert.ok(names.includes('magazine'));
  assert.deepEqual(names.filter((name) => /optic|reticle|holo/i.test(name)), []);
});

test('ADS marker and optic window project to the hitscan axis at varied aspect and FOV', () => {
  const weapon = new WeaponsSystem();
  const viewCamera = new THREE.PerspectiveCamera(42, 16 / 9, 0.01, 10);
  const worldCamera = new THREE.PerspectiveCamera(80, 16 / 9, 0.01, 200);
  const mount = new THREE.Group();
  viewCamera.add(mount);
  weapon._gunRoot = mount;
  weapon._buildOptic(mount);
  weapon._reticleAnchor = createAimReticleAnchor(viewCamera, weapon._reticle);
  weapon.ads = 1;
  weapon._adsPrev = 1;
  weapon._kickPos.set(0.08, 0.07, 0.05);
  weapon._kickRot.set(-0.14, 0.08, 0.05);
  weapon._bob = 1.3;

  const player = {
    alive: true,
    ads: true,
    sprinting: false,
    grounded: true,
    velocity: { x: 4, z: 3 },
    getEyePosition(out) { return Object.assign(out, { x: 0, y: 1.65, z: 0 }); },
    getLookDir(out) { return Object.assign(out, { x: 0, y: 0, z: -1 }); },
  };
  const physics = { raycast: () => ({ distance: 0.1 }) };
  const ctx = {
    camera: worldCamera,
    viewCamera,
    session: { settings: { fov: 96, reducedMotion: false } },
    time: { alpha: 1 },
    get: (id) => id === 'player' ? player : physics,
  };
  weapon.update(1 / 60, ctx);

  assert.equal(weapon._reticleAnchor.parent, viewCamera);
  assert.equal(mount.getObjectByName('holo_reticle'), undefined);
  assert.equal(weapon._reticleAnchor.visible, true);
  assert.equal(weapon._reticleAnchor.position.z, AIM_RETICLE_DEPTH);

  const frontGlass = mount.getObjectByName('optic_glass_front');
  const rearGlass = mount.getObjectByName('optic_glass_rear');
  assert.ok(frontGlass && rearGlass);

  for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
    for (const fov of [42, 55, 75]) {
      viewCamera.aspect = aspect;
      viewCamera.fov = fov;
      viewCamera.updateProjectionMatrix();
      for (const object of [weapon._reticle, frontGlass, rearGlass]) {
        const ndc = projectedNdc(viewCamera, object);
        assert.ok(Math.abs(ndc.x) < 1e-12, `${object.name} x=${ndc.x} at ${aspect}/${fov}`);
        assert.ok(Math.abs(ndc.y) < 1e-12, `${object.name} y=${ndc.y} at ${aspect}/${fov}`);
      }
    }
  }

  const cameraRay = new THREE.Vector3(0, 0, 0.5)
    .unproject(worldCamera)
    .sub(worldCamera.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const hitscanRay = computeSpreadDirection({ x: 0, y: 0, z: -1 }, 0, 0, 0.001);
  assert.ok(cameraRay.distanceTo(new THREE.Vector3(hitscanRay.x, hitscanRay.y, hitscanRay.z)) < 1e-12);

  weapon._reticleAnchor.parent.remove(weapon._reticleAnchor);
  for (const geometry of weapon._geoms) geometry.dispose();
  for (const material of weapon._mats) material.dispose();
});

test('the optic marker appears only once ADS alignment is complete', () => {
  const weapon = new WeaponsSystem();
  const viewCamera = new THREE.PerspectiveCamera(42, 16 / 9, 0.01, 10);
  const worldCamera = new THREE.PerspectiveCamera(80, 16 / 9, 0.01, 200);
  const mount = new THREE.Group();
  viewCamera.add(mount);
  weapon._gunRoot = mount;
  weapon._buildOptic(mount);
  weapon._reticleAnchor = createAimReticleAnchor(viewCamera, weapon._reticle);
  const player = {
    alive: true,
    ads: true,
    sprinting: false,
    grounded: true,
    velocity: { x: 0, z: 0 },
    getEyePosition(out) { return Object.assign(out, { x: 0, y: 1.65, z: 0 }); },
    getLookDir(out) { return Object.assign(out, { x: 0, y: 0, z: -1 }); },
  };
  const ctx = {
    camera: worldCamera,
    viewCamera,
    session: { settings: { fov: 80 } },
    time: { alpha: 1 },
    get: (id) => id === 'player' ? player : { raycast: () => null },
  };

  weapon.ads = weapon._adsPrev = 0.97;
  weapon.update(1 / 60, ctx);
  assert.equal(weapon._reticleAnchor.visible, false);
  weapon.ads = weapon._adsPrev = 0.98;
  weapon.update(1 / 60, ctx);
  assert.equal(weapon._reticleAnchor.visible, true);
  weapon._reloading = true;
  weapon.update(1 / 60, ctx);
  assert.equal(weapon._reticleAnchor.visible, false);

  weapon._reticleAnchor.parent.remove(weapon._reticleAnchor);
  for (const geometry of weapon._geoms) geometry.dispose();
  for (const material of weapon._mats) material.dispose();
});
