#!/usr/bin/env node
/** Real DOM input smoke/soak. No injected movement, damage, or mission state. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from './lib/server.mjs';
import { validateSoakSamples, validateSoakReport } from './lib/soak-report.mjs';

let soakSeconds = 0;
const args = process.argv.slice(2);
if (args.length) {
  if (args[0] !== '--seconds' || args.length > 2) throw new Error('Unknown play arguments');
  if (args.length !== 2 || args[1].trim() === '' || !Number.isFinite(Number(args[1])) || Number(args[1]) < 0) throw new Error('Invalid soak seconds');
  soakSeconds = Number(args[1]);
}
const server = await serve(new URL('../dist/', import.meta.url).pathname);
let browser;
const errors = [];
const evidence = { input: 'Playwright DOM keyboard/mouse; unmodified gameplay state', checks: [], samples: [] };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(server.url + '/?seed=7');
  await page.waitForFunction(() => window.__READY__);
  const snapshot = () => page.evaluate(() => {
    const c = window.__ENGINE__.ctx, p = c.get('player'), w = c.get('weapons');
    return { state: c.session.state, health: p.health, position: p.position.toArray(), ammo: w.current.ammo,
      reserve: w.current.reserve, ads: p.ads, stance: p.stance, tick: c.time.fixedFrame,
      enemies: c.get('ai').enemies.map(e => [e.position.x,e.position.z,e.health,e.alive]),
      keys: Object.keys(c.input.keys).filter(k => c.input.keys[k]), buttons: Object.keys(c.input.buttons).filter(k => c.input.buttons[k]),
      geometries: c.renderer.info.memory.geometries, textures: c.renderer.info.memory.textures,
      programs: c.renderer.info.programs.length, retries: c.session.retries };
  });
  const shot = name => page.screenshot({ path: new URL(`../captures/live-${name}.png`, import.meta.url).pathname });
  await mkdir(new URL('../captures/', import.meta.url), { recursive: true });
  const ready = await snapshot();
  assert.equal(ready.state, 'ready');
  await shot('ready');
  await page.waitForTimeout(30000);
  assert.deepEqual(await snapshot(), ready, 'Ready scene must be frozen for 30 seconds');
  evidence.checks.push('30-second ready freeze');
  await page.getByRole('button', { name: 'DEPLOY' }).click();
  await page.waitForFunction(() => window.__ENGINE__.ctx.session.playing);
  assert.equal((await snapshot()).ammo, ready.ammo, 'Deploy click must not fire');
  await page.keyboard.down('KeyD'); await page.waitForTimeout(180); await page.keyboard.up('KeyD');
  assert.notDeepEqual((await snapshot()).position, ready.position, 'Real movement input must move player');
  await page.keyboard.down('KeyE'); await page.waitForTimeout(230);
  assert.equal((await snapshot()).ads, true, 'Held E must aim');
  await shot('ads');
  await page.keyboard.up('KeyE');
  await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
  const fired = await snapshot();
  assert.ok(fired.ammo < ready.ammo, 'Held trigger must spend ammunition');
  await page.keyboard.press('KeyR', { delay: 60 }); await page.waitForTimeout(450);
  assert.equal(await page.locator('.weapon-status').textContent(), 'RELOADING', 'R must start reload');
  await shot('reload');
  await page.waitForTimeout(2200);
  const reloaded = await snapshot();
  assert.equal(reloaded.ammo, ready.ammo, 'Reload must refill magazine');
  assert.equal(reloaded.ammo + reloaded.reserve, fired.ammo + fired.reserve, 'Reload conserves ammunition');
  evidence.checks.push('deploy does not fire', 'real movement', 'held ADS', 'held automatic fire', 'reload conserves ammo');
  // Lose pointer lock while inputs are held; resume must not inherit either input.
  await page.keyboard.down('KeyW'); await page.mouse.down(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__ENGINE__.ctx.session.state === 'paused');
  await page.keyboard.up('KeyW'); await page.mouse.up();
  const paused = await snapshot();
  assert.equal(paused.keys.length, 0); assert.equal(paused.buttons.length, 0);
  await shot('pause');
  await page.waitForTimeout(30000);
  assert.deepEqual(await snapshot(), paused, 'Paused scene must be frozen for 30 seconds');
  evidence.checks.push('held input cleared on Escape', '30-second pause freeze');
  await page.getByRole('button', { name: 'RESTART MISSION' }).click();
  await page.getByRole('button', { name: 'RESUME' }).click();
  await page.waitForFunction(() => window.__ENGINE__.ctx.session.playing);
  const start = Date.now();
  const resourceStart = await snapshot();
  while ((Date.now() - start) / 1000 < soakSeconds) {
    for (const key of ['KeyD','KeyA','KeyW','KeyS','KeyC','Space']) {
      await page.keyboard.down(key); await page.waitForTimeout(250); await page.keyboard.up(key);
    }
    await page.keyboard.down('KeyE'); await page.mouse.down(); await page.waitForTimeout(500);
    await page.mouse.up(); await page.keyboard.up('KeyE'); await page.keyboard.press('KeyR', { delay: 60 });
    await page.waitForTimeout(500);
    const sample = await snapshot();
    assert.ok(sample.position.every(Number.isFinite), 'Position must remain finite');
    assert.ok(sample.health >= 0 && sample.health <= 100, 'Health must remain valid');
    assert.ok(sample.ammo >= 0 && sample.reserve >= 0, 'Ammo must remain nonnegative');
    assert.ok(sample.geometries <= resourceStart.geometries + 4 && sample.textures <= resourceStart.textures + 2, 'GPU resources must remain bounded');
    assert.equal(sample.programs, resourceStart.programs, 'No new shader programs after ready');
    evidence.samples.push(sample);
    if (evidence.samples.length >= 2) validateSoakSamples(evidence.samples);
    if (sample.state === 'paused') {
      await page.getByRole('button', { name: 'RESUME' }).click();
    }
    if (evidence.samples.length % 10 === 0) console.log(`[play] ${Math.round((Date.now()-start)/1000)}s, retries ${sample.retries}, health ${sample.health}`);
  }
  evidence.soakSeconds = (Date.now() - start) / 1000;
  assert.deepEqual(errors, [], 'Browser must have no runtime errors');
  if (soakSeconds > 0) validateSoakReport(evidence, soakSeconds);
  await writeFile(new URL('../captures/play-report.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log('PLAY PASS', JSON.stringify({ checks: evidence.checks, soakSeconds: evidence.soakSeconds, samples: evidence.samples.length }));
} finally { await browser?.close(); await server.close(); }
