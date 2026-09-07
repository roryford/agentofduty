import assert from 'node:assert/strict';
export function checkPractice(s) {
 assert.equal(s.mode, 'practice'); assert.equal(s.state, 'playing');
 assert.equal(s.hostiles, 0, 'Practice must have no live enemies');
 assert.equal(s.enemyColliders, 0, 'Practice must disable enemy collision');
 assert.ok(s.position.every(Number.isFinite) && s.position[1] > -1, 'Player fell outside playable ground');
 assert.ok(Math.abs(s.position[0]) < 60 && Math.abs(s.position[2]) < 60, 'Player escaped world perimeter');
 assert.equal(s.health, 100, 'Practice exploration must remain safe');
}
export function checkAim(s, expected) {
 assert.ok(['hip','ads'].includes(expected), 'An expected aim phase is required');
 if (expected === 'ads') {
  assert.ok(s.ads > .99 && !s.reloading, 'ADS input did not finish aiming');
  assert.equal(s.reticleVisible, true, 'ADS needs a visible reticle');
  assert.ok(Number.isFinite(s.reticlePixels) && s.reticlePixels <= 1, 'ADS reticle is not aligned to screen-center aim');
 } else {
  assert.ok(s.ads < .01, 'Hip input did not leave ADS');
  assert.equal(s.hudHidden, false, 'Hip fire needs a visible crosshair');
  assert.ok(Math.abs(s.hudOffset[0]) <= .5 && Math.abs(s.hudOffset[1]) <= .5, 'HUD crosshair is not centered on game canvas');
 }
}
export function checkMovement(before, after) {
 assert.ok(after.tick - before.tick >= 120, 'Simulation did not advance during movement probe');
 assert.ok(Math.hypot(after.position[0]-before.position[0], after.position[2]-before.position[2]) > 1, 'Movement input did not move the player');
}
export function checkFiring(before, after) {
 assert.ok(after.ammo < before.ammo, 'Trigger input did not fire');
}
export function checkReload(before, during, after) {
 assert.equal(during.reloading, true, 'Reload input did not start reload');
 assert.ok(after.ammo > before.ammo && after.ammo === 30, 'Reload did not refill magazine');
 assert.equal(after.reserve, before.reserve, 'Practice reload must retain unlimited reserve');
}
