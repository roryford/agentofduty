#!/usr/bin/env node
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/server.mjs';
import { positive, assess } from './lib/perf-report.mjs';
const arg = (name, fallback) => { const i = process.argv.indexOf('--'+name); return i < 0 ? fallback : process.argv[i+1]; };
const budget = {
  raf: positive(arg('p95',20), 'p95'),
  gpu: positive(arg('gpu',8), 'gpu'),
  draws: positive(arg('max-draws',512), 'max-draws'),
};
const width = positive(arg('w',1920),'width'), height = positive(arg('h',1080),'height');
const server = await serve(fileURLToPath(new URL('../dist',import.meta.url)));
let browser;
try {
  browser = await chromium.launch({ channel:'chrome', headless:true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
  const page = await browser.newPage({ viewport:{width,height} });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url+'/?benchmark=1&seed=1', {waitUntil:'networkidle'});
  await page.waitForFunction(() => window.__READY__ === true, null, {timeout:30000});
  await page.waitForFunction(() => window.__METRICS__().gpuTimesMs.length >= 240, null, {timeout:30000});
  const metrics = await page.evaluate(() => window.__METRICS__());
  if (errors.length) throw new Error(errors.join('\n'));
  const report = assess(metrics,budget);
  console.log(JSON.stringify({ renderer:metrics.renderer, pixels:metrics.renderPixels, instrumentation:'GPU timer queries enabled; CPU render submission and rAF reported separately', ...report },null,2));
  if (report.failures.length) throw new Error('PERF FAIL: '+report.failures.join('; '));
  console.log('PERF PASS: real GPU, active simulation, valid samples');
} finally {
  if (browser) await browser.close();
  await server.close();
}
