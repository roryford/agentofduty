import assert from 'node:assert/strict';

// The input loop samples about every 2.6 seconds. Check every window so a
// temporary stall cannot be concealed by total progress elsewhere in the run.
export function validateSoakSamples(samples) {
  assert.ok(Array.isArray(samples) && samples.length >= 2, 'Insufficient soak samples');
  let deadStart = null, deadRetry = null;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    assert.ok(Number.isSafeInteger(sample.tick) && sample.tick >= 0, 'Invalid soak tick');
    assert.ok(Number.isSafeInteger(sample.retries) && sample.retries >= 0, 'Invalid retry count');
    assert.ok(['playing', 'dead', 'paused'].includes(sample.state), 'Unexpected soak session state');
    if (i > 0) assert.ok(sample.tick >= samples[i - 1].tick, 'Simulation tick moved backwards');
    if (i >= 2) assert.ok(sample.tick > samples[i - 2].tick, 'Simulation stalled across three soak samples');
    if (sample.state === 'dead') {
      if (deadStart === null || deadRetry !== sample.retries) {
        deadStart = sample.tick; deadRetry = sample.retries;
      }
      // Respawn normally takes 300 ticks. Allow sampling slack, never an
      // indefinitely dead session. Retry identity distinguishes separate deaths.
      assert.ok(sample.tick - deadStart <= 600, 'Death failed to recover within five simulated seconds');
    } else { deadStart = null; deadRetry = null; }
  }
}

export function validateSoakReport(report, requiredSeconds) {
  assert.ok(Number.isFinite(requiredSeconds) && requiredSeconds > 0, 'Invalid required soak duration');
  assert.ok(Number.isFinite(report.soakSeconds) && report.soakSeconds >= requiredSeconds, 'Soak duration was not completed');
  validateSoakSamples(report.samples);
  assert.ok(report.samples.length >= Math.max(2, Math.floor(requiredSeconds / 10)), 'Insufficient soak coverage');
  const ticks = report.samples.at(-1).tick - report.samples[0].tick;
  assert.ok(ticks >= Math.max(1, (requiredSeconds - 10) * 120 * 0.75), 'Insufficient active simulation coverage');
}
