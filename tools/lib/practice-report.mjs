import assert from 'node:assert/strict';
export function checkPractice(s) {
 assert.equal(s.mode, 'practice'); assert.equal(s.state, 'playing');
 assert.equal(s.hostiles, 0, 'Practice must have no live enemies');
 assert.equal(s.enemyColliders, 0, 'Practice must disable enemy collision');
 assert.ok(s.position.every(Number.isFinite) && s.position[1] > -1, 'Player fell outside playable ground');
 assert.ok(Math.abs(s.position[0]) < 60 && Math.abs(s.position[2]) < 60, 'Player escaped world perimeter');
 assert.equal(s.health, 100, 'Practice exploration must remain safe');
}
export function checkAim(s) {
 if (s.ads > .99 && !s.reloading) {
  assert.equal(s.reticleVisible, true, 'ADS needs a visible reticle');
  assert.ok(Number.isFinite(s.reticlePixels) && s.reticlePixels <= 1, 'ADS reticle is not aligned to screen-center aim');
 } else if (!s.hudHidden) {
  assert.ok(Math.abs(s.hudOffset[0]) <= .5 && Math.abs(s.hudOffset[1]) <= .5, 'HUD crosshair is not centered on game canvas');
 }
}
