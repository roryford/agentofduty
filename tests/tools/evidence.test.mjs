import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { sourceDigest, buildDigest, currentBuild, validateManifest } from '../../tools/lib/evidence.mjs';

test('evidence module resolves the repo with only import.meta.url, as on Node 18', async () => {
  const url = new URL('../../tools/lib/evidence.mjs', import.meta.url);
  const source = await readFile(url, 'utf8');
  // Execute the real module with the older metadata surface, without changing
  // its code. Builtin imports remain real; no filesystem or path mocks.
  const setup = `import.meta.url = ${JSON.stringify(url.href)}; delete import.meta.dirname; delete import.meta.filename;\n`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(setup + source).toString('base64')}`);
  assert.equal(module.ROOT, path.resolve(fileURLToPath(new URL('../../', import.meta.url))));
  assert.equal(await module.sourceDigest(), await sourceDigest());
});

test('build receipt rejects changed source, changed output and missing receipt', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aod-evidence-test-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  for (const dir of ['src','public','tools','dist']) await mkdir(path.join(root,dir));
  for (const file of ['package.json','package-lock.json','vite.config.js','index.html','src/main.js','dist/index.html']) await writeFile(path.join(root,file),'original');
  await assert.rejects(currentBuild(root), /ENOENT/);
  const receipt = {status:'complete',sourceDigest:await sourceDigest(root),buildDigest:await buildDigest(root)};
  await writeFile(path.join(root,'dist/evidence-build.json'),JSON.stringify(receipt));
  assert.deepEqual(await currentBuild(root),receipt);
  await writeFile(path.join(root,'dist/evidence-build.json'),JSON.stringify({...receipt,status:'incomplete'}));
  await assert.rejects(currentBuild(root),/Stale build/);
  await writeFile(path.join(root,'dist/evidence-build.json'),JSON.stringify(receipt));
  await writeFile(path.join(root,'src/main.js'),'changed');
  await assert.rejects(currentBuild(root),/Stale build/);
  await writeFile(path.join(root,'src/main.js'),'original');
  await writeFile(path.join(root,'dist/index.html'),'changed');
  await assert.rejects(currentBuild(root),/Stale build/);
});

test('capture provenance rejects incomplete, old, missing and mismatched shots', () => {
  const shots = [{name:'ready',frame:0,ui:true}];
  const good = {schemaVersion:1,status:'complete',runId:'run-abcdef',provenance:{sourceDigest:'digest'},shots:[{...shots[0],file:'runs/run-abcdef/ready.png',sha256:'a'.repeat(64)}]};
  assert.doesNotThrow(()=>validateManifest(good,shots));
  for (const broken of [{}, {...good,status:'incomplete'}, {...good,shots:[]}, {...good,shots:[{...good.shots[0],frame:1}]}, {...good,shots:[{...good.shots[0],sha256:null}]}, {...good,runId:'../escape'}]) {
    assert.throws(()=>validateManifest(broken,shots));
  }
});
