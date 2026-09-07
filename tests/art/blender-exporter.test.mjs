import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Blender bevel applies successfully and reports modifier failures', () => {
  const blender = process.env.BLENDER || 'blender';
  const result = spawnSync(
    blender,
    ['--background', '--python', 'tests/art/blender-bevel-check.py'],
    {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      timeout: 30_000,
    },
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /BLENDER_BEVEL_CHECK_OK/);
});
