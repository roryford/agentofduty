import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../..', import.meta.url);
const RUN_OPTIONS = {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  timeout: 30_000,
};

function assetBlenderCommand() {
  const packageJson = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
  const tokens = packageJson.scripts.assets.trim().split(/\s+/);
  const pythonIndex = tokens.indexOf('--python');
  const exitCodeIndex = tokens.indexOf('--python-exit-code');

  assert.ok(pythonIndex > 0, 'assets script must invoke an exporter with --python');
  assert.ok(exitCodeIndex > 0, 'assets script must propagate Python failures with --python-exit-code');
  assert.equal(tokens[exitCodeIndex + 1], '1', 'assets script must use --python-exit-code 1');
  assert.ok(exitCodeIndex < pythonIndex, '--python-exit-code must precede the exporter invocation');

  return {
    executable: process.env.BLENDER || tokens[0],
    startupArgs: tokens.slice(1, pythonIndex),
  };
}

function runBlender(args) {
  const command = assetBlenderCommand();
  const result = spawnSync(command.executable, [...command.startupArgs, ...args], RUN_OPTIONS);

  assert.ifError(result.error);
  return result;
}

test('Blender bevel applies successfully and reports modifier failures', () => {
  const result = runBlender(['--python', 'tests/art/blender-bevel-check.py']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /BLENDER_BEVEL_CHECK_OK/);
});

test('Blender CLI returns nonzero for an uncaught exporter exception', () => {
  const marker = 'INTENTIONAL_BLENDER_EXPORT_FAILURE';
  const result = runBlender(['--python-expr', `raise RuntimeError('${marker}')`]);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, new RegExp(marker));
});
