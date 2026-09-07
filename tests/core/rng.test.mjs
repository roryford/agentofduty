import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
test('named combat streams are stable regardless of visual stream activity or creation order',()=>{
 const a=createRng(12),b=createRng(12);for(let i=0;i<100;i++)a.fork('vfx').next();
 assert.deepEqual(Array.from({length:20},a.fork('combat').next),Array.from({length:20},b.fork('combat').next));
 assert.notEqual(a.fork('combat').next(),a.fork('vfx').next());
 assert.throws(()=>a.fork(''),/nonempty/);
});
