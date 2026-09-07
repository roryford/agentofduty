export function positive(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be positive and finite`);
  return n;
}
export function statistics(values, name, minimum = 60) {
  if (!Array.isArray(values) || values.length < minimum || values.some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error(`${name}: missing or invalid samples (need ${minimum})`);
  }
  const sorted = [...values].sort((a,b) => a-b);
  const at = p => sorted[Math.min(sorted.length-1, Math.ceil(p*sorted.length)-1)];
  return { n: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) };
}
export function assess(metrics, budget) {
  if (!metrics || !metrics.ready) throw new Error('Game never became ready');
  if (!metrics.renderer || /swiftshader|software|llvmpipe/i.test(metrics.renderer)) throw new Error(`Real GPU required, got ${metrics.renderer}`);
  const cpu = statistics(metrics.frameTimesMs, 'CPU');
  const raf = statistics(metrics.rafTimesMs, 'rAF');
  const gpu = statistics(metrics.gpuTimesMs, 'GPU');
  const failures = [];
  for (const key of ['drawCalls','shaderCompilesAfterReady']) {
    if (!Number.isFinite(metrics[key]) || metrics[key] < 0) throw new Error(`Missing ${key}`);
  }
  if (raf.p95 > budget.raf) failures.push(`rAF p95 ${raf.p95.toFixed(2)} > ${budget.raf}ms`);
  if (gpu.p50 > budget.gpu) failures.push(`GPU p50 ${gpu.p50.toFixed(2)} > ${budget.gpu}ms`);
  if (metrics.drawCalls > budget.draws) failures.push(`draw calls ${metrics.drawCalls} > ${budget.draws}`);
  if (metrics.shaderCompilesAfterReady !== 0) failures.push(`post-ready compiles ${metrics.shaderCompilesAfterReady}`);
  return { cpu, raf, gpu, failures };
}
