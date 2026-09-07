import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPractice, checkAim, checkMovement, checkFiring, checkReload } from '../../tools/lib/practice-report.mjs';
const safe = {mode:'practice',state:'playing',hostiles:0,enemyColliders:0,position:[0,.9,48],health:100};
test('practice and aim probes accept valid observations',()=>{
 checkPractice(safe);checkAim({ads:1,reloading:false,reticleVisible:true,reticlePixels:.1},'ads');
 checkAim({ads:0,hudHidden:false,hudOffset:[0,0]},'hip');
});
test('demonstrated red: enemies, falling, and displaced reticles fail the practice probe',()=>{
 for (const bad of [{hostiles:1},{enemyColliders:1},{position:[0,-5,48]},{position:[0,.9,61]}]) assert.throws(()=>checkPractice({...safe,...bad}));
 assert.throws(()=>checkAim({ads:1,reloading:false,reticleVisible:true,reticlePixels:9},'ads'));
 assert.throws(()=>checkAim({ads:0,hudHidden:false,hudOffset:[9,0]},'hip'));
});

test('demonstrated red: missing ADS, hidden crosshair and inactive controls cannot pass',()=>{
 assert.throws(()=>checkAim({ads:0,hudHidden:false,hudOffset:[0,0]},'ads'));
 assert.throws(()=>checkAim({ads:1,reloading:false,reticleVisible:false,reticlePixels:0},'ads'));
 assert.throws(()=>checkAim({ads:0,hudHidden:true,hudOffset:[0,0]},'hip'));
 const start={tick:10,position:[0,.9,48],ammo:30};
 assert.throws(()=>checkMovement(start,{...start,position:[0,.9,58]}));
 assert.throws(()=>checkMovement(start,{...start,tick:800}));
 assert.throws(()=>checkFiring(start,start));
 assert.throws(()=>checkReload({ammo:20,reserve:90},{reloading:false},{ammo:30,reserve:90}));
});
