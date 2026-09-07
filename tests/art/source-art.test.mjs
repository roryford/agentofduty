import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('source images remain available outside the runtime public directory', async () => {
  const root = new URL('../../', import.meta.url);
  assert.deepEqual(await readdir(new URL('public/models/textures/',root)), ['facade_albedo.jpg']);
  for (const file of ['car_albedo.jpg','dumpster_albedo.jpg','enemy_albedo.jpg','rifle_albedo.jpg','roughness.jpg']) {
    const data = await readFile(new URL('art-source/textures/'+file,root));
    assert.equal(data.readUInt16BE(0),0xffd8);
  }
  for (const file of ['enemy_concept.jpg','rifle_concept.jpg']) {
    assert.equal((await readFile(new URL('art-source/concepts/'+file,root))).readUInt16BE(0),0xffd8);
  }
});
