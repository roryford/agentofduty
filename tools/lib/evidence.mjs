import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = data => createHash('sha256').update(data).digest('hex');

async function filesUnder(root, relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported evidence input: ${name}`);
  }
  return files;
}

async function digest(root, files) {
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name).update('\0').update(sha256(await readFile(path.join(root, name)))).update('\0');
  return hash.digest('hex');
}

export async function sourceDigest(root = ROOT) {
  const files = ['package.json', 'package-lock.json', 'vite.config.js', 'index.html'];
  for (const directory of ['src', 'public', 'tools']) files.push(...await filesUnder(root, directory));
  return digest(root, files);
}

export async function buildDigest(root = ROOT) {
  return digest(root, (await filesUnder(root, 'dist')).filter(file => file !== 'dist/evidence-build.json'));
}

export function revision(root = ROOT) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return { revision: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) };
}

export async function currentBuild(root = ROOT) {
  const receipt = JSON.parse(await readFile(path.join(root, 'dist/evidence-build.json'), 'utf8'));
  if (receipt.status !== 'complete' || receipt.sourceDigest !== await sourceDigest(root) || receipt.buildDigest !== await buildDigest(root)) {
    throw new Error('Stale build: run npm run build before capture/diff');
  }
  return receipt;
}

export function validateManifest(manifest, shots) {
  if (manifest.schemaVersion !== 1 || manifest.status !== 'complete' || !manifest.runId || !manifest.provenance?.sourceDigest) {
    throw new Error('Missing or incomplete capture provenance; run npm run capture');
  }
  if (!Array.isArray(manifest.shots) || manifest.shots.length !== shots.length) throw new Error('Capture shot set is incomplete');
  for (const [index, shot] of shots.entries()) {
    const captured = manifest.shots[index];
    if (Object.keys(shot).some(key => captured[key] !== shot[key]) || !/^[a-f0-9]{64}$/.test(captured.sha256 || '')) {
      throw new Error(`Capture definition/hash mismatch: ${shot.name}`);
    }
    if (captured.file !== `runs/${manifest.runId}/${shot.name}.png`) throw new Error(`Invalid capture path: ${shot.name}`);
  }
  if (!/^run-[a-zA-Z0-9]+$/.test(manifest.runId)) throw new Error('Invalid capture run ID');
}
