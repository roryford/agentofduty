import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { ROOT, sourceDigest, buildDigest, revision } from './lib/evidence.mjs';

const before = await sourceDigest();
await mkdir(`${ROOT}/dist`, {recursive:true});
await writeFile(`${ROOT}/dist/evidence-build.json`, JSON.stringify({status:'incomplete'})+'\n');
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: ROOT, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Build failed (${result.status ?? result.signal})`);
if (before !== await sourceDigest()) throw new Error('Source changed during build; rebuild');
await writeFile(`${ROOT}/dist/evidence-build.json`, JSON.stringify({
  status:'complete', ...revision(), builtAt: new Date().toISOString(), sourceDigest: before,
  buildDigest: await buildDigest(),
}, null, 2) + '\n');
