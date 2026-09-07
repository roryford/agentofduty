/** Real menu/input regression for enemy-free exploration, escape prevention and aim. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from './lib/server.mjs';
import { checkPractice, checkAim, checkMovement, checkFiring, checkReload } from './lib/practice-report.mjs';
const server=await serve(new URL('../dist/',import.meta.url).pathname);
let browser;
try {
 browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-gl=angle',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],samples=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(server.url);await page.waitForFunction(()=>window.__READY__);
 const observe=()=>page.evaluate(()=>{
  const c=window.__ENGINE__.ctx,p=c.get('player'),w=c.get('weapons'),ai=c.get('ai'),m=c.get('mission');
  const cross=document.querySelector('.aim-cross'),r=c.canvas.getBoundingClientRect(),h=cross.getBoundingClientRect();
  const point=w._reticle.position.clone();w._reticle.getWorldPosition(point);point.project(c.viewCamera);
  return {fov:c.session.settings.fov,mode:c.session.mode,state:c.session.state,hostiles:ai.enemies.filter(e=>e.alive).length,enemyColliders:ai.enemies.filter(e=>c.get('physics')._enabled[e.collider]).length,
   tick:c.time.fixedFrame,position:p.position.toArray(),health:p.health,area:m.index,ads:w.ads,reloading:w._reloading,ammo:w.current.ammo,reserve:w.current.reserve,
   reticleVisible:w.reticleVisible,reticlePixels:Math.hypot(point.x*r.width/2,point.y*r.height/2),hudHidden:cross.hidden,hudOffset:[h.x+h.width/2-r.x-r.width/2,h.y+h.height/2-r.y-r.height/2]};
 });
 await page.getByLabel('MODE',{exact:true}).selectOption('practice');
 await page.waitForFunction(()=>window.__ENGINE__.ctx.session.mode==='practice');
 for(const area of [0,1,2]){
  await page.getByLabel('STARTING AREA',{exact:true}).selectOption(String(area));
  await page.getByRole('button',{name:/DEPLOY|RESUME/}).click();await page.waitForFunction(()=>window.__ENGINE__.ctx.session.playing);
  let s=await observe();checkPractice(s);assert.equal(s.area,area);samples.push(s);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__ENGINE__.ctx.session.state==='paused');
 }
 await page.getByLabel('STARTING AREA',{exact:true}).selectOption('0');
 await page.getByRole('button',{name:'RESUME'}).click();await page.waitForFunction(()=>window.__ENGINE__.ctx.session.playing);
 const beforeMove=await observe();
 await page.keyboard.down('KeyS');await page.keyboard.down('ShiftLeft');await page.waitForTimeout(3500);await page.keyboard.up('KeyS');await page.keyboard.up('ShiftLeft');
 await page.keyboard.down('KeyD');await page.keyboard.down('KeyS');await page.waitForTimeout(2500);await page.keyboard.up('KeyD');await page.keyboard.up('KeyS');
 checkPractice(await observe());checkMovement(beforeMove,await observe());
 for(const viewport of [{width:1280,height:720,fov:80},{width:900,height:1000,fov:65},{width:1800,height:720,fov:100}]){
  await page.setViewportSize({width:viewport.width,height:viewport.height});await page.waitForTimeout(150);
  if(viewport.fov!==80){
   await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__ENGINE__.ctx.session.state==='paused');
   if(!await page.locator('details').evaluate(el=>el.open))await page.locator('summary').click();
   await page.getByLabel('FIELD OF VIEW',{exact:true}).focus();await page.keyboard.press(viewport.fov===65?'Home':'End');
   await page.waitForFunction(value=>window.__ENGINE__.ctx.session.settings.fov===value,viewport.fov,{timeout:2000});
   assert.equal((await observe()).fov,viewport.fov);
   await page.getByRole('button',{name:'RESUME'}).click();await page.waitForFunction(()=>window.__ENGINE__.ctx.session.playing);
  }
  checkAim(await observe(),'hip');const beforeFire=await observe();await page.keyboard.down('KeyE');await page.waitForTimeout(400);
  for(let i=0;i<12;i++){
   if(i===2){await page.mouse.down();await page.keyboard.down('KeyA');}
   const s=await observe();checkAim(s,'ads');checkPractice(s);samples.push(s);await page.waitForTimeout(40);
  }
  checkFiring(beforeFire,await observe());
  await page.mouse.up();await page.keyboard.up('KeyA');await page.keyboard.up('KeyE');await page.waitForTimeout(300);
 }
 const beforeReload=await observe();
 await page.keyboard.press('KeyR',{delay:60});await page.waitForTimeout(300);const duringReload=await observe();
 await page.waitForTimeout(2400);checkReload(beforeReload,duringReload,await observe());
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__ENGINE__.ctx.session.state==='paused');
 await page.getByRole('button',{name:'RESET POSITION'}).click();
 assert.ok(Math.abs((await observe()).position[2]-48)<.1);
 await mkdir(new URL('../captures/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../captures/practice-menu.png',import.meta.url).pathname});
 await page.getByLabel('MODE',{exact:true}).selectOption('mission');
 assert.ok((await observe()).hostiles>0);assert.equal((await observe()).area,0);
 assert.deepEqual(errors,[]);
 await writeFile(new URL('../captures/practice-report.json',import.meta.url),JSON.stringify({input:'DOM menu/keyboard/mouse only; state read for assertions',samples},null,2)+'\n');
 console.log('PRACTICE PASS: menu, three areas, retreat/side containment, moving/firing ADS, three aspect ratios, reload, reset, return to mission');
}finally{await browser?.close();await server.close();}
