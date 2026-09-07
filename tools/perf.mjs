import { PERFORMANCE_BUDGET as B } from '../src/core/config.js';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/server.mjs';
import { positive, assess, assertBoot } from './lib/perf-report.mjs';
const arg = (name, fallback) => { const i = process.argv.indexOf('--'+name); return i < 0 ? fallback : process.argv[i+1]; };
const budget = {
  cpu: B.cpuP95Ms, p99: B.rafP99Ms,
  raf: positive(arg('p95',B.rafP95Ms), 'p95'),
  gpu: positive(arg('gpu',B.gpuP50Ms), 'gpu'),
  draws: positive(arg('max-draws',B.maxDrawCalls), 'max-draws'),
};
const width = positive(arg('w',2560),'width'), height = positive(arg('h',1440),'height');
const server = await serve(fileURLToPath(new URL('../dist',import.meta.url)));
let browser;
try {
  browser = await chromium.launch({ channel:'chrome', headless:true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
  const page = await browser.newPage({ viewport:{width,height} });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const coldStart = performance.now();
  await page.goto(server.url+'/?benchmark=1&seed=1', {waitUntil:'networkidle'});
  await page.waitForFunction(() => window.__READY__ === true, null, {timeout:30000});
  const readyMs = performance.now() - coldStart;
  assertBoot(readyMs);
  console.log(`[perf] local cold boot ${readyMs.toFixed(0)}ms`);
  const encounters = await page.evaluate(() => window.__ENGINE__.ctx.get('mission').encounters.length);
  for (let encounter=0;encounter<encounters;encounter++) {
    await page.evaluate(index => {
      const c = window.__ENGINE__.ctx;
      c.get('mission').index = index; c.session.retry();
    }, encounter);
    await page.waitForTimeout(1500);
    const firstTick = await page.evaluate(() => {
      const engine = window.__ENGINE__;
      engine._rafTimes.length = 0;
      engine.gpuTimer.samples.length = 0;
      engine._frameTimeCount = 0; engine._frameTimeWrite = 0;
      window.__PERF_SAMPLING__ = true; window.__PERF_PEAK_DRAWS__ = 0;
      const sample = () => {
        if (!window.__PERF_SAMPLING__) return;
        window.__PERF_PEAK_DRAWS__ = Math.max(window.__PERF_PEAK_DRAWS__,window.__METRICS__().drawCalls);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return engine.ctx.time.fixedFrame;
    });
    await page.waitForFunction(() => { const m = window.__METRICS__(); return m.gpuTimesMs.length >= 240 && m.rafTimesMs.length >= 240; }, null, {timeout:30000});
    const metrics = await page.evaluate(() => {
      window.__PERF_SAMPLING__ = false;
      return {...window.__METRICS__(),drawCalls:window.__PERF_PEAK_DRAWS__};
    });
    metrics.simulatedTicks = metrics.fixedFrame - firstTick;
    if (errors.length) throw new Error(errors.join('\n'));
    const report = assess(metrics,budget);
    console.log(JSON.stringify({ encounter, renderer:metrics.renderer, pixels:metrics.renderPixels, peakDrawCalls:metrics.drawCalls, instrumentation:'Stationary combat per encounter; GPU timer queries enabled; CPU submission and rAF separate', ...report },null,2));
    if (report.failures.length) throw new Error('PERF FAIL: '+report.failures.join('; '));
  }
  console.log('PERF PASS: real GPU, active simulation, valid samples');
} finally {
  if (browser) await browser.close();
  await server.close();
}
