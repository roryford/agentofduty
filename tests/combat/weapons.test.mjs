import assert from 'node:assert/strict';
import test from 'node:test';
import { WeaponsSystem, computeSpreadDirection, createMuzzleFlashGeometry } from '../../src/weapons/WeaponsSystem.js';

function deterministicRng() {
  let n = 0;
  return {
    next: () => ((++n * 2654435761) >>> 0) / 4294967296,
    float: (min = 0, max = 1) => min + ((((++n * 2654435761) >>> 0) / 4294967296) * (max - min)),
  };
}

function weaponHarness() {
  const weapon = new WeaponsSystem();
  weapon._rng = deterministicRng();
  const events = [];
  const physics = { raycast: () => null };
  const player = {
    alive: true, ads: false, sprinting: false, pitch: 0, yaw: 0,
    velocity: { x: 0, z: 0 },
    getEyePosition(out) { Object.assign(out, { x: 0, y: 1.65, z: 0 }); return out; },
    getLookDir(out) { Object.assign(out, { x: 0, y: 0, z: -1 }); return out; },
  };
  const ctx = {
    session: { playing: true },
    input: { buttons: { 0: true }, keys: {} },
    time: { fixedFrame: 0 },
    events: { emit: (type, payload) => events.push({ type, payload }) },
    get: (id) => id === 'player' ? player : physics,
  };
  return { weapon, player, ctx, events };
}

test('spread stays orthogonal and equal at different aim headings', () => {
  const directions = [
    { x: 0, y: 0, z: -1 },
    { x: -1, y: 0, z: 0 },
    { x: 0.3, y: 0.5, z: -0.8124038405 },
  ];
  const offsets = directions.map((forward) => {
    const result = computeSpreadDirection(forward, 0.75, -0.4, 0.02);
    const fl = Math.hypot(forward.x, forward.y, forward.z);
    return (result.x * forward.x + result.y * forward.y + result.z * forward.z) / fl;
  });
  assert.ok(Math.max(...offsets) - Math.min(...offsets) < 1e-10);
  for (const dot of offsets) assert.ok(dot < 1 && dot > 0.999);
});

test('muzzle flash uses a filled star silhouette without a square background', () => {
  const geometry = createMuzzleFlashGeometry(8);
  const positions = geometry.getAttribute('position');
  assert.equal(positions.count, 48);
  const radii = new Set();
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getY(i));
    if (radius > 0) radii.add(radius.toFixed(3));
  }
  assert.deepEqual([...radii].sort(), ['0.017', '0.045']);
  geometry.dispose();
});

test('fixed fire cadence is 600 rpm and emits player-qualified shots', () => {
  const { weapon, ctx, events } = weaponHarness();
  for (let i = 0; i < 120; i++) {
    ctx.time.fixedFrame = i;
    weapon.fixedUpdate(1 / 120, ctx);
  }
  const shots = events.filter((event) => event.type === 'weapon:fire');
  assert.equal(shots.length, 10);
  assert.ok(shots.every((shot) => shot.payload.from === 'player'));
  assert.equal(weapon.current.ammo, 20);
});

test('600 rpm stays on exact 12-tick intervals over ten seconds', () => {
  const { weapon, ctx, events } = weaponHarness();
  weapon.current.ammo = 1000;
  const shotFrames = [];
  const emit = ctx.events.emit;
  ctx.events.emit = (type, payload) => {
    emit(type, payload);
    if (type === 'weapon:fire') shotFrames.push(ctx.time.fixedFrame);
  };
  for (let frame = 0; frame < 1200; frame++) {
    ctx.time.fixedFrame = frame;
    weapon.fixedUpdate(1 / 120, ctx);
  }
  assert.equal(shotFrames.length, 100);
  for (let i = 1; i < shotFrames.length; i++) assert.equal(shotFrames[i] - shotFrames[i - 1], 12);
  assert.equal(events.filter((event) => event.type === 'weapon:fire').length, 100);
});

test('reload conserves ammunition and reset cancels an in-flight reload', () => {
  const { weapon, ctx } = weaponHarness();
  ctx.input.buttons[0] = false;
  weapon.current.ammo = 8;
  weapon.current.reserve = 7;
  weapon._startReload(ctx);
  for (let i = 0; i < 193; i++) weapon.fixedUpdate(1 / 120, ctx);
  assert.equal(weapon.current.ammo, 15);
  assert.equal(weapon.current.reserve, 0);
  assert.equal(weapon.current.ammo + weapon.current.reserve, 15);
  weapon.current.ammo = 4;
  weapon.current.reserve = 11;
  weapon._startReload(ctx);
  weapon.reset({}, { events: ctx.events, rng: { fork: () => deterministicRng() } });
  assert.equal(weapon._reloading, false);
  assert.equal(weapon.current.ammo, 30);
  assert.equal(weapon.current.reserve, 90);
  weapon.fixedUpdate(2, ctx);
  assert.equal(weapon.current.ammo + weapon.current.reserve, 120);
});

test('sprint-to-fire delay blocks shots until recovery elapses', () => {
  const { weapon, player, ctx, events } = weaponHarness();
  player.sprinting = true;
  for (let i = 0; i < 12; i++) weapon.fixedUpdate(1 / 120, ctx);
  player.sprinting = false;
  for (let i = 0; i < 20; i++) weapon.fixedUpdate(1 / 120, ctx);
  assert.equal(events.filter((event) => event.type === 'weapon:fire').length, 0);
  for (let i = 0; i < 8; i++) weapon.fixedUpdate(1 / 120, ctx);
  assert.equal(events.filter((event) => event.type === 'weapon:fire').length, 1);
});
