#!/usr/bin/env node
/** Integrated deterministic lifecycle scenarios. State staging is explicit, not a playthrough. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from './lib/server.mjs';
const server=await serve(new URL('../dist/',import.meta.url).pathname);
let browser;
try {
 browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
 for(const seed of [1,7,42]) {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(server.url+`/?lockstep=1&seed=${seed}`);
  await page.waitForFunction(()=>window.__BOOT_COMPLETE__&&window.__READY__);
  const result=await page.evaluate(()=>{
   const c=window.__ENGINE__.ctx,p=c.get('player'),w=c.get('weapons'),ai=c.get('ai'),m=c.get('mission'),s=c.session;
   const checks=[];
   const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
   const resetSnapshot=()=>JSON.stringify({x:p.position.x,z:p.position.z,health:p.health,ammo:w.current.ammo,reserve:w.current.reserve,enemies:ai.enemies.filter(e=>e.active).map(e=>[e.position.x,e.position.z,e.health,e.alive]),inactiveColliders:ai.enemies.filter(e=>!e.active&&c.get('physics').getCollider(e.collider).enabled).length});
   s.retry(true);const initial=resetSnapshot();
   check(ai.enemies.filter(e=>!e.active).every(e=>!c.get('physics').getCollider(e.collider).enabled),'unused pool actors have disabled colliders');
   const first=ai.enemies.find(e=>e.alive),health=p.health;
   let outcome=null;const off=c.events.on('combat:hit',e=>{outcome=e;});
   const request=Object.freeze({target:first.id,from:'player',amount:1,headshot:false,point:Object.freeze({x:first.position.x,y:1,z:first.position.z})});
   c.events.emit('damage:dealt',request);off();
   check(p.health===health&&c.get('ui').hurt===0,'enemy damage does not hurt player or flash player UI');
   check(outcome?.target===first.id&&outcome.amount===1,'target resolves immutable damage request');
   for(let i=0;i<3;i++){
    s.retry(true);c.input.buttons[0]=true;window.__PUMP__(10);c.input.buttons[0]=false;c.input.keys.KeyR=true;window.__PUMP__(1);
    c.events.emit('damage:dealt',{target:'player',from:'enemy-0',amount:1000,point:{x:p.eye.x,y:p.eye.y,z:p.eye.z}});
    check(s.state==='dead','player death enters countdown');
    s.pause();const remaining=s.deathRemaining;window.__PUMP__(180);
    check(s.state==='paused'&&s.deathRemaining===remaining,'paused death countdown is frozen');
    s.resume();window.__PUMP__(151);
    check(s.playing&&p.alive,'death countdown restores playable checkpoint');
    s.retry(true);check(resetSnapshot()===initial,'whole encounter reset is repeatable');
    check(!w._reloading&&w.ads===0,'retry cancels reload and ADS');
   }
   check(m.encounters.length===3,'mission contains three encounters');
   for(let index=0;index<3;index++){
    check(m.index===index,'checkpoint index matches expected progression');
    for(const e of ai.enemies)if(e.alive)c.events.emit('damage:dealt',{target:e.id,from:'player',amount:1000,point:{x:e.position.x,y:1,z:e.position.z}});
    const exit=m.current.exit;
    p.position.x=exit.x;p.position.z=exit.z;p.prevPosition.copy(p.position);
    window.__PUMP__(index===2?490:1);
   }
   check(s.state==='complete','clearing all encounters and holding extraction wins');
   const tick=c.time.fixedFrame;window.__PUMP__(120);check(c.time.fixedFrame===tick,'victory freezes simulation');
   s.retry(true);check(m.index===0&&s.playing&&resetSnapshot()===initial,'restart after completion restores whole mission');
   return{checks,metrics:window.__METRICS__()};
  });
  assert.deepEqual(errors,[]);assert.equal(result.metrics.shaderCompilesAfterReady,0);
  console.log(`[scenarios] seed ${seed}: ${result.checks.length} integrated assertions passed`);
  await page.close();
 }
 const fallback=await browser.newPage();const fallbackErrors=[];
 fallback.on('pageerror',error=>fallbackErrors.push(String(error)));
 await fallback.route('**/models/*.glb',route=>route.fulfill({status:404,body:'Intentional missing-asset fixture'}));
 await fallback.goto(server.url+'/?lockstep=1&seed=1');
 await fallback.waitForFunction(()=>window.__BOOT_COMPLETE__&&window.__READY__);
 const fallbackState=await fallback.evaluate(()=>{
  window.__PUMP__(30);const c=window.__ENGINE__.ctx;
  return {rifle:c.get('weapons')._usingGltf,enemy:c.get('ai')._usingGltf,alive:c.get('ai').aliveCount,ready:window.__READY__,compiles:window.__METRICS__().shaderCompilesAfterReady};
 });
 assert.deepEqual(fallbackErrors,[]);assert.equal(fallbackState.ready,true);
 assert.equal(fallbackState.rifle,false);assert.equal(fallbackState.enemy,false);
 assert.ok(fallbackState.alive>0);assert.equal(fallbackState.compiles,0);
 console.log('[scenarios] deliberately missing GLBs: procedural fallback remains playable');
 await fallback.close();
}finally{await browser?.close();await server.close();}
