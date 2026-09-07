#!/usr/bin/env node
/**
 * Pixel-diff captures against a locked baseline. Exit nonzero on failure.
 *
 * Usage:
 *   node tools/diff.mjs
 *   node tools/diff.mjs --capture captures --baseline baselines --threshold 0.01
 *
 * Threshold is max fraction of differing pixels (0–1). Default 0 (exact).
 * A small threshold (e.g. 0.001) tolerates subpixel AA drift across GPUs.
 */

import { readFile, readdir, access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { currentBuild, validateManifest, sha256 } from './lib/evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    capture: path.join(ROOT, 'captures'),
    baseline: path.join(ROOT, 'baselines'),
    diffOut: path.join(ROOT, 'captures', 'diff'),
    /** Max fraction of pixels allowed to differ. */
    threshold: 0,
    /** Per-pixel color threshold for pixelmatch (0–1). */
    aa: 0.1,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--capture') args.capture = path.resolve(argv[++i]);
    else if (a === '--baseline') args.baseline = path.resolve(argv[++i]);
    else if (a === '--diff-out') args.diffOut = path.resolve(argv[++i]);
    else if (a === '--threshold') args.threshold = Number(argv[++i]);
    else if (a === '--aa') args.aa = Number(argv[++i]);
    else if (a === '--help') {
      console.log(
        'Usage: node tools/diff.mjs [--capture dir] [--baseline dir] [--threshold frac] [--aa t]',
      );
      process.exit(0);
    } else throw new Error(`Unknown argument ${a}`);
  }
  for (const key of ['threshold', 'aa']) if (!Number.isFinite(args[key]) || args[key] < 0 || args[key] > 1) throw new Error(`Invalid ${key}`);
  return args;
}

async function loadPng(filePath) {
  const buf = await readFile(filePath);
  return PNG.sync.read(buf);
}

async function main() {
  const args = parseArgs(process.argv);
  const shots = JSON.parse(await readFile(path.join(ROOT, 'tools/shots.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(args.capture, 'manifest.json'), 'utf8'));
  validateManifest(manifest, shots);
  const build = await currentBuild();
  if (manifest.provenance.sourceDigest !== build.sourceDigest || manifest.provenance.buildDigest !== build.buildDigest) throw new Error('Stale capture: source or build changed; run npm run visual');
  const baseline = JSON.parse(await readFile(path.join(args.baseline, 'manifest.json'), 'utf8'));
  if (baseline.seed !== manifest.seed || baseline.width !== manifest.width || baseline.height !== manifest.height || baseline.shots?.length !== shots.length) throw new Error('Baseline capture settings or shot set differ');
  for (const shot of shots) {
    const reference = baseline.shots.find(s => s.name === shot.name);
    if (!reference || Object.keys(shot).some(key => reference[key] !== shot[key])) throw new Error(`Baseline definition mismatch: ${shot.name}`);
  }

  try {
    await access(args.capture);
  } catch {
    console.error(`Capture dir missing: ${args.capture}\nRun node tools/capture.mjs first.`);
    process.exit(1);
  }

  try {
    await access(args.baseline);
  } catch {
    console.error(
      `Baseline dir missing: ${args.baseline}\n` +
        `Lock baselines after Phase 1 gate: cp -R captures baselines`,
    );
    process.exit(1);
  }

  const captureFiles = manifest.shots.map(s => s.name + '.png');
  const baselineFiles = (await readdir(args.baseline)).filter((f) => f.endsWith('.png'));
  if (baselineFiles.length !== shots.length || baselineFiles.some(name => !captureFiles.includes(name))) throw new Error('Baseline PNG set differs from declared shots');

  if (baselineFiles.length === 0) {
    console.error('No baseline PNGs found.');
    process.exit(1);
  }

  await mkdir(args.diffOut, { recursive: true });

  let failed = 0;
  let passed = 0;

  for (const name of baselineFiles.sort()) {
    const basePath = path.join(args.baseline, name);
    const shot = manifest.shots.find(s => s.name + '.png' === name);
    const capPath = path.join(args.capture, shot.file);
    if (sha256(await readFile(capPath)) !== shot.sha256) throw new Error(`Capture hash mismatch: ${name}`);

    if (!captureFiles.includes(name)) {
      console.error(`[diff] FAIL ${name}: missing from captures`);
      failed += 1;
      continue;
    }

    const base = await loadPng(basePath);
    const cap = await loadPng(capPath);

    if (base.width !== cap.width || base.height !== cap.height) {
      console.error(
        `[diff] FAIL ${name}: size ${cap.width}x${cap.height} vs baseline ${base.width}x${base.height}`,
      );
      failed += 1;
      continue;
    }

    const diff = new PNG({ width: base.width, height: base.height });
    const mismatched = pixelmatch(
      base.data,
      cap.data,
      diff.data,
      base.width,
      base.height,
      { threshold: args.aa, includeAA: true },
    );

    const total = base.width * base.height;
    const frac = mismatched / total;
    const ok = frac <= args.threshold;

    if (!ok) {
      const diffPath = path.join(args.diffOut, name);
      await writeFile(diffPath, PNG.sync.write(diff));
      console.error(
        `[diff] FAIL ${name}: ${mismatched}/${total} pixels (${(frac * 100).toFixed(4)}%) > threshold ${(args.threshold * 100).toFixed(4)}%`,
      );
      failed += 1;
    } else {
      console.log(
        `[diff] PASS ${name}: ${mismatched}/${total} pixels (${(frac * 100).toFixed(4)}%)`,
      );
      passed += 1;
    }
  }

  // Extra captures not in baseline are warnings, not failures.
  for (const name of captureFiles) {
    if (!baselineFiles.includes(name)) {
      console.warn(`[diff] WARN ${name}: in captures but not in baseline (ignored)`);
    }
  }

  console.log(`[diff] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
