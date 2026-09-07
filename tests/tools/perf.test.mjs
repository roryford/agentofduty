import test from 'node:test';
import assert from 'node:assert/strict';
import { positive, statistics, assess } from '../../tools/lib/perf-report.mjs';
const good = () => ({ready:true, simulatedTicks:200, renderer:'ANGLE Metal hardware',frameTimesMs:Array(100).fill(2),rafTimesMs:Array(100).fill(16.7),gpuTimesMs:Array(100).fill(4),drawCalls:200,shaderCompilesAfterReady:0});
const budget = {raf:20,gpu:8,draws:300};
test('valid device sample passes',()=>assert.deepEqual(assess(good(),budget).failures,[]));
test('demonstrated red: slow GPU, missed frames, excess draws and compiles all fail',()=>{
 const m=good();m.rafTimesMs.fill(40);m.gpuTimesMs.fill(12);m.drawCalls=500;m.shaderCompilesAfterReady=1;
 assert.equal(assess(m,budget).failures.length,5);
});
test('empty, NaN, negative and insufficient samples cannot produce a green',()=>{
 for(const x of [[],[1],Array(100).fill(NaN),Array(100).fill(-1)])assert.throws(()=>statistics(x,'test'),/invalid samples/);
 for(const key of ['gpuTimesMs','rafTimesMs','frameTimesMs','drawCalls','shaderCompilesAfterReady']){
  const m=good();delete m[key];assert.throws(()=>assess(m,budget));
 }
});
test('software renderer and invalid budgets are reported',()=>{
 const m=good();m.renderer='SwiftShader';assert.throws(()=>assess(m,budget),/Real GPU/);
 for(const n of [undefined,0,-1,NaN,Infinity])assert.throws(()=>positive(n,'budget'));
});

test('paused simulation cannot pass by rendering a static scene quickly',()=>{const m=good();m.simulatedTicks=0;assert.throws(()=>assess(m,budget),/Simulation did not advance/);});
