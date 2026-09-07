import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSoakSamples, validateSoakReport } from '../../tools/lib/soak-report.mjs';
const sample = (tick, state = 'playing', retries = 0) => ({ tick, state, retries });
const healthy = Array.from({ length: 231 }, (_, i) => sample(i * 312, i % 3 ? 'playing' : 'dead', Math.floor(i / 3)));
test('full recorded soak with separate deaths and recoveries passes', () => {
  validateSoakReport({ soakSeconds: 600.5, samples: healthy }, 600);
});
test('demonstrated red: rendering without simulation progress fails', () => {
  assert.throws(() => validateSoakSamples([sample(10), sample(10), sample(10)]), /stalled/);
});
test('demonstrated red: dead simulation advances but never respawns', () => {
  assert.throws(() => validateSoakSamples([sample(0, 'dead'), sample(360, 'dead'), sample(720, 'dead')]), /Death failed/);
});
test('demonstrated red: empty, malformed and insufficient acquisition fail', () => {
  for (const samples of [[], [sample(0)], [sample(NaN), sample(1)]]) assert.throws(() => validateSoakSamples(samples));
  assert.throws(() => validateSoakReport({ soakSeconds: 600, samples: [sample(0), sample(72000)] }, 600), /coverage/);
  assert.throws(() => validateSoakReport({ soakSeconds: 5, samples: healthy }, 600), /duration/);
  assert.throws(() => validateSoakReport({ soakSeconds: 600, samples: healthy.map((s, i) => sample(i)) }, 600), /active simulation/);
});
