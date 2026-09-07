import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../../src/core/session.js';
import { createEvents } from '../../src/core/events.js';
import { createInput } from '../../src/core/input.js';
function fixture(lockstep = false) {
  const events = createEvents(), input = createInput();
  const session = new GameSession({ events, input, lockstep, restore: () => ({ spawn: { x: 1 }, enemySpawns: [] }) });
  return { events, input, session };
}
test('ready and paused never accumulate gameplay time', () => {
  const { session } = fixture();
  for (let i = 0; i < 3600; i++) session.advance(1/120);
  assert.equal(session.elapsed, 0);
  session.start(); session.advance(1); session.pause(); session.advance(30);
  assert.equal(session.elapsed, 1);
});
test('losing focus clears all held input and resumes an interrupted death', () => {
  const { session, input, events } = fixture(true);
  input.keys.KeyW = true; input.buttons[0] = true;
  events.emit('actor:death', { actor: 'player' });
  session.advance(1); session.pause(); session.advance(30);
  assert.deepEqual(Object.keys(input.keys), []);
  assert.deepEqual(Object.keys(input.buttons), []);
  assert.equal(session.deathRemaining, 1.5);
  session.resume(); assert.equal(session.state, 'dead');
});
test('only player death changes the session, retry restores before reset notification', () => {
  const { session, events } = fixture(true);
  events.emit('actor:death', { actor: 'enemy-1' });
  assert.equal(session.state, 'playing');
  let restores = 0, resets = 0;
  session.restore = () => { restores++; return { spawn: { x: 7 } }; };
  events.on('session:reset', p => { assert.equal(restores, 1); assert.equal(p.spawn.x, 7); resets++; });
  events.emit('actor:death', { actor: 'player' }); session.advance(3);
  assert.equal(resets, 1); assert.equal(session.state, 'playing'); assert.equal(session.retries, 1);
});
test('restart clears run statistics and cannot revive via ordinary start after victory', () => {
  const { session } = fixture(true);
  session.elapsed = 100; session.retries = 3; session.complete(); session.start();
  assert.equal(session.state, 'complete');
  session.retry(true); assert.equal(session.elapsed, 0); assert.equal(session.retries, 0);
});
test('invalid states report errors rather than silently creating inert sessions', () => {
  assert.throws(() => fixture().session.setState('garbage'), /Invalid session state/);
});
test('restore failures are surfaced and no reset is falsely reported', () => {
  const { session, events } = fixture(); let resets = 0;
  events.on('session:reset', () => resets++);
  session.restore = () => { throw new Error('checkpoint missing'); };
  assert.throws(() => session.retry(), /checkpoint missing/);
  assert.equal(resets, 0);
});
