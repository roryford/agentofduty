import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPractice, checkAim } from '../../tools/lib/practice-report.mjs';
const safe = {mode:'practice',state:'playing',hostiles:0,enemyColliders:0,position:[0,.9,48],health:100};
test('practice and aim probes accept valid observations',()=>{
 checkPractice(safe);checkAim({ads:1,reloading:false,reticleVisible:true,reticlePixels:.1});
 checkAim({ads:0,hudHidden:false,hudOffset:[0,0]});
});
test('demonstrated red: enemies, falling, and displaced reticles fail the practice probe',()=>{
 for (const bad of [{hostiles:1},{enemyColliders:1},{position:[0,-5,48]},{position:[0,.9,61]}]) assert.throws(()=>checkPractice({...safe,...bad}));
 assert.throws(()=>checkAim({ads:1,reloading:false,reticleVisible:true,reticlePixels:9}));
 assert.throws(()=>checkAim({ads:0,hudHidden:false,hudOffset:[9,0]}));
});
